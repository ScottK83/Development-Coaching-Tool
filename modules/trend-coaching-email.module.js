(function() {
    'use strict';

    // A difference in the metric's own unit. "+12.0%" on AHT read as a
    // percentage of something when it was twelve seconds.
    //
    // Spelled out, with no trailing ".0": "5 points", "1.1 points", "18
    // seconds". "5.0 pts" read like a stat sheet in an email meant to
    // celebrate people (Scott, 2026-10-14).
    function formatDifference(context, metricKey, amount) {
        const unit = context.metricsRegistry?.[metricKey]?.unit || '%';
        const size = Math.abs(Number(amount) || 0);
        const oneDecimal = size.toFixed(1).replace(/\.0$/, '');
        const plural = (count, word) => `${count} ${word}${count === '1' ? '' : 's'}`;
        if (unit === 'sec') return plural(String(Math.round(size)), 'second');
        if (unit === 'hrs') return plural(oneDecimal, 'hour');
        if (unit === '%') return plural(oneDecimal, 'point');
        return oneDecimal;
    }

    function isIncludedByTeamFilter(context = {}, employeeName = '') {
        const includeFn = typeof context.isAssociateIncludedByTeamFilter === 'function'
            ? context.isAssociateIncludedByTeamFilter
            : () => true;
        return includeFn(employeeName);
    }

    /**
     * The newest period and the one before it, of the same kind.
     *
     * getWeeklyKeysSorted merges the weekly and year-to-date stores and every
     * period type there is, so "the last two keys" was often a week against
     * the year-to-date file, or a key that is not in weeklyData at all and
     * read as "no data for this employee". Scott, 2026-10-14. Completed weeks
     * are preferred when there are any, because this is the weekly email; the
     * caller can name another type with context.periodType.
     */
    function pickComparisonKeys(context = {}) {
        const store = context.weeklyData || {};
        const keys = (context.getWeeklyKeysSorted?.() || [])
            .filter(key => Object.prototype.hasOwnProperty.call(store, key));
        const typeOf = (key) => store[key]?.metadata?.periodType || 'week';
        if (!keys.length) return { latestKey: null, previousKey: null, periodType: context.periodType || 'week' };

        const periodType = context.periodType
            || (keys.some(key => typeOf(key) === 'week') ? 'week' : typeOf(keys[keys.length - 1]));
        const sameType = keys.filter(key => typeOf(key) === periodType);
        return {
            latestKey: sameType[sameType.length - 1] || null,
            previousKey: sameType[sameType.length - 2] || null,
            periodType
        };
    }

    /**
     * Did anybody answer the survey behind this metric? A 0 with no surveys
     * is an empty column, and a zero-survey associate was told "Currently 0.0,
     * Target 75.0" about Overall Experience (Scott, 2026-10-14).
     */
    const SURVEY_COUNT_FALLBACK = { cxRepOverall: 'repSurveyTotal', fcr: 'fcrSurveyTotal', overallExperience: 'surveyTotal' };

    function hasSurveysBehind(employee, metricKey) {
        const weigh = window.DevCoachModules?.metricsRegistryHelpers?.getSurveyWeight || window.getSurveyWeight;
        if (typeof weigh === 'function') {
            const count = weigh(metricKey, employee);
            return count === null || count > 0;
        }
        const field = SURVEY_COUNT_FALLBACK[metricKey];
        if (!field) return true;
        const own = parseInt(employee?.[field], 10);
        const count = Number.isInteger(own) ? own : parseInt(employee?.surveyTotal, 10);
        return Number.isInteger(count) && count > 0;
    }

    function hasValue(value) {
        return value !== undefined && value !== null && value !== '' && Number.isFinite(parseFloat(value));
    }

    // With its unit: "604s", "93%", "18 hrs". formatMetricValue on its own
    // prints "604" and "93.0", and Copilot passes that on as it is.
    function show(context, metricKey, value) {
        const format = (typeof context.formatMetricDisplay === 'function' && context.formatMetricDisplay)
            || (typeof window.formatMetricDisplay === 'function' && window.formatMetricDisplay)
            || context.formatMetricValue;
        const num = parseFloat(value);
        return typeof format === 'function' ? String(format(metricKey, num)) : String(num);
    }

    function goalText(context, metricKey) {
        const metric = context.metricsRegistry?.[metricKey] || {};
        const target = metric.target?.value;
        if (target === undefined || target === null) return '';
        return `goal ${show(context, metricKey, target)} or ${metric.isReverse ? 'lower' : 'better'}`;
    }

    const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function shortDate(iso) {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        const month = match ? SHORT_MONTHS[parseInt(match[2], 10) - 1] : '';
        return month ? `${month} ${parseInt(match[3], 10)}` : '';
    }

    // "the week of Oct 5", from the day the period started. The prompt said
    // "week ending 10/09/2026", which is a date nobody says out loud.
    function periodPhrase(key, period, periodType) {
        const meta = period?.metadata || {};
        const parts = String(key || '').split('|');
        const start = shortDate(meta.startDate || (parts.length > 1 ? parts[0] : ''));
        const end = shortDate(meta.endDate || parts[1] || '');
        if (periodType === 'month' && start) return `the month starting ${start}`;
        if (start) return `the week of ${start}`;
        return end ? `the week ending ${end}` : 'this period';
    }

    // How far a gap is from the goal, as a share of it, so seconds and
    // percentages can be ranked together.
    function shortfall(context, metricKey, value) {
        const metric = context.metricsRegistry?.[metricKey] || {};
        const target = parseFloat(metric.target?.value);
        if (!Number.isFinite(target) || target === 0) return 0;
        const behind = metric.isReverse ? value - target : target - value;
        return behind / Math.abs(target);
    }

    const MAX_FOCUS = 2;
    const MAX_WINS = 3;

    /*
     * No handle time is no calls (Scott, 2026-10-14): a 0 second time sits
     * under the goal, so read as a number it was a win for someone who was
     * out all week. The morning pulse owns the rule; this is its copy for
     * when that module is not loaded.
     */
    function tookNoCalls(employee) {
        const pulse = window.DevCoachModules?.morningPulse;
        if (typeof pulse?.tookNoCalls === 'function') return pulse.tookNoCalls(employee);
        if (!employee) return true;
        const aht = parseFloat(employee.aht);
        if (Number.isFinite(aht)) return aht <= 0;
        const calls = parseInt(employee.totalCalls, 10);
        return Number.isFinite(calls) && calls <= 0;
    }

    function isZeroTime(context, metricKey, value) {
        return context.metricsRegistry?.[metricKey]?.unit === 'sec' && Number(value) <= 0;
    }

    /*
     * The best true thing to praise when nothing is at goal. Scott,
     * 2026-10-14: "in every piece of feedback ... provide positive feedback."
     * Every measured metric is offered, not only the two biggest misses, so
     * a real move on a third one is not lost.
     */
    function findTruePositive(rows, ongoing, noCalls) {
        const find = window.DevCoachModules?.messageVoice?.truePositive;
        const found = typeof find === 'function' ? find(rows, { ongoing, tookNoCalls: noCalls }) : null;
        return found || {
            kind: 'effort', key: '', label: '',
            text: ongoing ? 'I see the effort you\'re putting in, and it matters.' : 'I saw the effort you put in, and it matters.'
        };
    }

    async function generateIndividualCoachingEmail(context = {}) {
        const employeeName = context.employeeName;
        const { latestKey, previousKey, periodType } = pickComparisonKeys(context);
        if (!latestKey) {
            context.showToast?.('Not enough data to generate coaching email', 3000);
            return;
        }

        const latestWeek = context.weeklyData?.[latestKey];
        const previousWeek = previousKey ? context.weeklyData?.[previousKey] : null;

        const currentEmp = latestWeek?.employees?.find(e => e.name === employeeName);
        const previousEmp = previousWeek?.employees?.find(e => e.name === employeeName);

        if (!currentEmp) {
            context.showToast?.('No data found for this employee', 3000);
            return;
        }

        const allTips = await (context.loadServerTips?.() || Promise.resolve({}));
        const copilotPrompt = buildIndividualCoachingPrompt(context, {
            employeeName, currentEmp, previousEmp, latestKey, latestWeek, periodType, allTips
        });

        context.openCopilotWithPrompt?.(copilotPrompt, 'Individual Coaching Email');
    }

    /**
     * The Copilot prompt for one associate, from the newest period and the one
     * before it. Pure, so it can be read and tested without a browser.
     *
     * Scott, 2026-10-14: it asked for "a brief, factual coaching email",
     * handed over every miss with a garbled trend line ("Currently 604,
     * Target 426 to fell vs last period"), and set no emoji or dash rule.
     */
    function buildIndividualCoachingPrompt(context = {}, input = {}) {
        const { employeeName = '', currentEmp = {}, previousEmp = null, latestKey = '', latestWeek = null, periodType = 'week' } = input;
        const allTips = input.allTips || {};
        const periodWord = periodType === 'month' ? 'month' : 'week';

        const metricsToAnalyze = ['scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht', 'overallSentiment'];
        const wins = [];
        const opportunities = [];
        const praiseRows = [];
        const ongoing = periodType === 'week-in-progress';
        const noCalls = tookNoCalls(currentEmp);
        const centerAverages = (() => {
            try { return context.getCenterAverageForWeek?.(latestKey) || null; } catch (e) { return null; }
        })();

        metricsToAnalyze.forEach(metricKey => {
            const current = currentEmp[metricKey];
            if (!hasValue(current)) return;
            // Nobody answered, so there is nothing to praise or coach.
            if (!hasSurveysBehind(currentEmp, metricKey)) return;

            const metric = context.metricsRegistry?.[metricKey] || {};
            const value = parseFloat(current);
            // A 0 second handle time is no calls, not a win.
            if (isZeroTime(context, metricKey, value)) return;
            const entry = {
                metricKey,
                metric: metric.label || metricKey,
                value: show(context, metricKey, value),
                goal: goalText(context, metricKey),
                gap: shortfall(context, metricKey, value)
            };

            const previous = previousEmp?.[metricKey];
            const hasPrior = hasValue(previous) && hasSurveysBehind(previousEmp, metricKey) && !isZeroTime(context, metricKey, previous);
            if (hasPrior) {
                // metricDelta is normalized to performance, so on AHT and
                // Transfers a positive trend means the number came down.
                entry.trend = context.metricDelta?.(metricKey, value, parseFloat(previous)) || 0;
                entry.previous = show(context, metricKey, previous);
            }

            const centerValue = parseFloat(centerAverages?.[metricKey]);
            praiseRows.push({
                key: metricKey,
                label: metric.label || metricKey,
                value,
                target: metric.target?.value,
                prior: hasPrior ? parseFloat(previous) : null,
                center: Number.isFinite(centerValue) && centerValue > 0 ? centerValue : null
            });

            if (context.metricMeetsTarget?.(metricKey, current)) {
                // With no calls behind the period, a number at goal is not praise.
                if (!noCalls) wins.push(entry);
                return;
            }
            const tips = allTips[metricKey] || [];
            entry.tip = tips.length ? tips[Math.floor(Math.random() * tips.length)] : null;
            opportunities.push(entry);
        });

        const topWins = wins.sort((a, b) => a.gap - b.gap).slice(0, MAX_WINS);
        const topFocus = opportunities.sort((a, b) => b.gap - a.gap).slice(0, MAX_FOCUS);

        // "from 95.1% to 96.2%" rather than a rose/fell verdict the reader
        // has to square with the numbers.
        const movement = (entry) => {
            if (!entry.previous || !entry.trend || entry.previous === entry.value) return '';
            return ` It moved from ${entry.previous} to ${entry.value} since last ${periodWord}, ${entry.trend > 0 ? 'an improvement' : 'a step back'}.`;
        };

        // Nothing at goal: the email opens on the best true positive instead,
        // and the instructions below say so rather than "the wins".
        const positive = topWins.length ? null : findTruePositive(praiseRows, ongoing, noCalls);

        const winsText = topWins.length
            ? topWins.map(w => `- ${w.metric}: ${w.value}, ${w.goal}.${movement(w)}`).join('\n')
            : `- ${positive.text}`;

        const focusText = topFocus.length
            ? topFocus.map(o => `- ${o.metric}: ${o.value}, ${o.goal}.${movement(o)}${o.tip ? `\n  Tip to share: ${o.tip}` : ''}`).join('\n')
            : '- Nothing below goal. Make the whole email a thank you.';

        const preferredName = context.getEmployeeNickname?.(employeeName) || currentEmp.firstName || String(employeeName).split(' ')[0];
        const when = periodPhrase(latestKey, latestWeek, periodType);

        const praiseHeading = positive ? 'THE POSITIVE TO OPEN WITH:' : 'WINS TO CELEBRATE:';
        const praiseRule = positive
            ? `Open by thanking ${preferredName}, then lead with the positive above${positive.key ? ', with its number,' : ''} said warmly in your own words and why it matters to customers or the team. Praise only what is listed: do not invent a win and do not say that nothing is at goal`
            : `Open by thanking ${preferredName}, then celebrate the wins first and be specific: name the number and why it matters to customers or the team`;

        return `Write a short, warm coaching email to ${preferredName} about ${when}, from me, their supervisor.

${praiseHeading}
${winsText}

FOCUS AREAS (at most two):
${focusText}

HOW TO WRITE IT:
- ${praiseRule}
- Then the focus areas, each with its number and its goal, framed as the next goal to reach, with the tip rewritten in your own words
- Every metric states its own goal. On a "lower" goal such as Average Handle Time or Transfers, a number that fell is an improvement and a number that rose is a setback. Never describe a rise on one of those as progress
- Keep every number true to what is given, but say it the way a person says it out loud ("you're at 91%, and the goal is 93%", "down 40 seconds, from 600 to 560"), in short paragraphs, never a list of figures or bullets
- ${ongoing ? 'The period is still going, so use the present tense' : 'The period is over, so use the past tense'}
- Do not mention attendance, reliability or any metric not listed above
- Close with encouragement and confidence in them
- Under 200 words, at most 2 emojis, no em dashes or dashes used as punctuation
- Return only the email body`;
    }

    async function generateGroupCoachingEmail(context = {}) {
        const { latestKey, previousKey, periodType } = pickComparisonKeys(context);
        if (!latestKey || !previousKey) {
            context.showToast?.('Not enough data to generate group email', 3000);
            return;
        }

        const latestWeek = context.weeklyData?.[latestKey];
        const previousWeek = context.weeklyData?.[previousKey];

        if (!latestWeek?.employees || !previousWeek?.employees) {
            context.showToast?.('Not enough employee data', 3000);
            return;
        }

        const endDate = periodPhrase(latestKey, latestWeek, periodType);

        const centerAvg = context.getCenterAverageForWeek?.(latestKey);
        const allTips = await (context.loadServerTips?.() || Promise.resolve({}));

        const teamAnalysis = {
            rockstars: [],
            topPerformers: [],
            improving: [],
            needsSupport: [],
            commonOpportunities: {},
            teamWins: [],
            metricChampions: {}
        };

        latestWeek.employees.forEach(emp => {
            if (!isIncludedByTeamFilter(context, emp?.name)) return;
            const prevEmp = previousWeek.employees.find(e => e.name === emp.name);
            if (!prevEmp) return;

            let meetsAllTargets = true;
            let hasImprovement = false;
            let needsHelp = false;

            ['scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht', 'overallSentiment'].forEach(metricKey => {
                const current = emp[metricKey];
                const prev = prevEmp[metricKey];
                const metric = context.metricsRegistry?.[metricKey] || {};

                if (current === undefined || current === null || current === '') return;
                // A survey nobody answered is not a 0 to count as a miss.
                if (!hasSurveysBehind(emp, metricKey)) return;

                const meetsTarget = context.metricMeetsTarget?.(metricKey, current);
                if (!meetsTarget) {
                    meetsAllTargets = false;
                    teamAnalysis.commonOpportunities[metricKey] = (teamAnalysis.commonOpportunities[metricKey] || 0) + 1;
                }

                const centerValue = centerAvg?.[metricKey];
                if (centerValue !== undefined && centerValue !== null) {
                    const currentFloat = parseFloat(current);
                    const centerFloat = parseFloat(centerValue);
                    // The registry records direction as `isReverse`; there is no
                    // `higherIsBetter` on it. Reading one that never existed meant
                    // every metric took the lower-is-better branch, so on adherence,
                    // sentiment, FCR and the rest this named people who were BELOW
                    // the centre average as champions.
                    const higherIsBetter = metric.isReverse !== true;
                    const beatsCenterAvg = higherIsBetter ? currentFloat > centerFloat : currentFloat < centerFloat;
                    if (beatsCenterAvg) {
                        const delta = higherIsBetter ? currentFloat - centerFloat : centerFloat - currentFloat;
                        if (delta > 0) {
                            if (!teamAnalysis.metricChampions[metricKey]) {
                                teamAnalysis.metricChampions[metricKey] = [];
                            }
                            teamAnalysis.metricChampions[metricKey].push({ name: emp.name, value: current, delta });
                        }
                    }
                }

                if (hasValue(prev) && hasSurveysBehind(prevEmp, metricKey)) {
                    const delta = context.metricDelta?.(metricKey, parseFloat(current), parseFloat(prev));
                    if (delta > 5) hasImprovement = true;
                    if (delta < -5) needsHelp = true;
                }
            });

            if (hasImprovement) {
                const improvingMetrics = [];
                ['scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht', 'overallSentiment'].forEach(metricKey => {
                    const current = emp[metricKey];
                    const prev = prevEmp?.[metricKey];
                    if (current === undefined || prev === undefined || current === null || prev === null || current === '' || prev === '') return;
                    if (!hasSurveysBehind(emp, metricKey) || !hasSurveysBehind(prevEmp, metricKey)) return;
                    const delta = context.metricDelta?.(metricKey, parseFloat(current), parseFloat(prev));
                    if (delta > 5) {
                        const metric = context.metricsRegistry?.[metricKey] || {};
                        improvingMetrics.push({
                            metric: metric.label || metricKey,
                            empValue: show(context, metricKey, current),
                            // "up 18s" on handle time read as a step back.
                            trend: `${formatDifference(context, metricKey, delta)} better than last week`
                        });
                    }
                });
                teamAnalysis.improving.push({ name: emp.name, metrics: improvingMetrics });
            } else if (meetsAllTargets) {
                teamAnalysis.topPerformers.push(emp.name);
            } else if (needsHelp) {
                teamAnalysis.needsSupport.push(emp.name);
            }
        });

        Object.keys(teamAnalysis.metricChampions).forEach(metricKey => {
            teamAnalysis.metricChampions[metricKey].sort((a, b) => b.delta - a.delta);
            teamAnalysis.metricChampions[metricKey] = teamAnalysis.metricChampions[metricKey].slice(0, 3);
        });

        const topOpportunities = Object.entries(teamAnalysis.commonOpportunities)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([metricKey, count]) => {
                const metric = context.metricsRegistry?.[metricKey] || {};
                const tips = allTips[metricKey] || [];
                const randomTip = tips.length ? tips[Math.floor(Math.random() * tips.length)] : null;
                return { metric: metric?.label || metricKey, count, tip: randomTip };
            });

        if (teamAnalysis.improving.length > 0) {
            teamAnalysis.teamWins.push(`- ${teamAnalysis.improving.length} rockstars showing strong improvement and momentum`);
        }
        if (teamAnalysis.topPerformers.length > 0) {
            teamAnalysis.teamWins.push(`- ${teamAnalysis.topPerformers.length} team members meeting every goal`);
        }

        let winsText = 'TEAM WINS & CELEBRATIONS:\n';
        if (teamAnalysis.teamWins.length > 0) {
            teamAnalysis.teamWins.forEach(win => {
                winsText += `${win}\n`;
            });
        } else {
            winsText += '- Team is working hard and showing effort\n';
        }

        let rockstarsText = '';
        if (teamAnalysis.improving.length > 0) {
            // No emojis in the data. Copilot copies them through, and the
            // email has a budget of two (Scott, 2026-10-13).
            rockstarsText = '\nROCKSTARS, SHOWING BIG IMPROVEMENT:\n';
            rockstarsText += 'These team members made strong gains on last week:\n';
            teamAnalysis.improving.slice(0, 5).forEach(rockstar => {
                rockstarsText += `\n${rockstar.name}:\n`;
                if (rockstar.metrics && rockstar.metrics.length > 0) {
                    rockstar.metrics.forEach(m => {
                        rockstarsText += `  • ${m.metric}: ${m.empValue} (${m.trend})\n`;
                    });
                }
            });
        }

        let championText = '';
        const topMetricsToHighlight = Object.entries(teamAnalysis.metricChampions)
            .filter(([_, champs]) => champs.length > 0)
            .slice(0, 3);
        if (topMetricsToHighlight.length > 0) {
            championText = '\nMETRIC CHAMPIONS:\n';
            topMetricsToHighlight.forEach(([metricKey, champions]) => {
                const metric = context.metricsRegistry?.[metricKey] || {};
                championText += `\n${metric.label || metricKey} Leaders:\n`;
                const reverse = metric.isReverse === true;
                champions.forEach((champ, idx) => {
                    const shown = show(context, metricKey, champ.value);
                    championText += `  ${idx + 1}. ${champ.name}: ${shown} (${formatDifference(context, metricKey, champ.delta)} ${reverse ? 'better than' : 'above'} the center average)\n`;
                });
            });
        }

        let recognitionText = '';
        if (teamAnalysis.topPerformers.length > 0) {
            recognitionText = '\nCONSISTENT PERFORMERS (meeting every goal):\n';
            teamAnalysis.topPerformers.slice(0, 8).forEach(name => {
                recognitionText += `- ${name}\n`;
            });
        }

        let opportunitiesText = '\nTEAM DEVELOPMENT OPPORTUNITIES:\n';
        if (topOpportunities.length > 0) {
            topOpportunities.forEach(opp => {
                opportunitiesText += `- ${opp.metric} (${opp.count} team members below goal)\n`;
                if (opp.tip) {
                    opportunitiesText += `  Tip: ${opp.tip}\n`;
                }
            });
        } else {
            opportunitiesText += '- Continue current momentum and consistency\n';
        }

        const copilotPrompt = `Write a HIGH-ENERGY, MOTIVATIONAL team-wide email for ${endDate}.

${winsText}
${rockstarsText}
${championText}
${recognitionText}
${opportunitiesText}

CRITICAL REQUIREMENTS:
- This is a GROUP email going to the entire call center team
- CALL OUT the rockstars who are KILLING IT and beating the call center average by name
- Make it EXCITING and CELEBRATORY for top performers
- Use phrases like "crushing it", "blowing the average out of the water", "absolutely dominating"
- Make everyone not on the list want to be recognized next week, without calling anybody out for missing it
- Be specific with numbers and metrics where people are excelling
- Frame development opportunities positively as "join the winners circle"

TONE & STYLE:
- HIGH ENERGY, MOTIVATIONAL, and CELEBRATORY
- Call out winners by name with specific achievements
- Make top performers feel like ROCKSTARS
- Professional but exciting and engaging
- Use bullet points for impact, and at most 2 emojis in the whole email
- Do NOT use em dashes, or hyphens with spaces around them, anywhere in the email
- Do not mention attendance or reliability
- Keep it concise but impactful (under 350 words)

SUBJECT LINE:
This week's rockstars, ${endDate}

Please generate the coaching email now with HIGH ENERGY celebrating our top performers!`;

        if (typeof context.openCopilotWithPrompt === 'function') {
            context.openCopilotWithPrompt(copilotPrompt, 'Group Coaching Email');
            return;
        }

        handOffToCopilot(copilotPrompt, {
            message: '📋 Group email prompt copied. Paste into CoPilot with Ctrl+V'
        });
    }


    // Opens the Copilot tab inside the click, then copies, then reports what
    // actually happened. See sharedUtils.copyPromptAndOpenCopilot.
    function handOffToCopilot(text, options) {
        return window.DevCoachModules.sharedUtils.copyPromptAndOpenCopilot(text, options);
    }

    async function generateTrendCoachingEmail(context = {}) {
        const employeeName = context.selectedEmployeeName || '';
        if (employeeName) {
            await generateIndividualCoachingEmail({ ...context, employeeName });
            return;
        }
        await generateGroupCoachingEmail(context);
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.trendCoachingEmail = {
        generateTrendCoachingEmail,
        generateIndividualCoachingEmail,
        generateGroupCoachingEmail,
        buildIndividualCoachingPrompt,
        pickComparisonKeys,
        formatDifference
    };
})();