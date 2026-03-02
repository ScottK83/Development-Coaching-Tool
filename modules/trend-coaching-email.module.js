(function() {
    'use strict';

    function isIncludedByTeamFilter(context = {}, employeeName = '') {
        const includeFn = typeof context.isAssociateIncludedByTeamFilter === 'function'
            ? context.isAssociateIncludedByTeamFilter
            : () => true;
        return includeFn(employeeName);
    }

    async function generateIndividualCoachingEmail(context = {}) {
        const employeeName = context.employeeName;
        const keys = context.getWeeklyKeysSorted?.() || [];
        if (keys.length < 2) {
            context.showToast?.('Not enough data to generate coaching email', 3000);
            return;
        }

        const latestKey = keys[keys.length - 1];
        const previousKey = keys[keys.length - 2];
        const latestWeek = context.weeklyData?.[latestKey];
        const previousWeek = context.weeklyData?.[previousKey];

        const currentEmp = latestWeek?.employees?.find(e => e.name === employeeName);
        const previousEmp = previousWeek?.employees?.find(e => e.name === employeeName);

        if (!currentEmp) {
            context.showToast?.('No data found for this employee', 3000);
            return;
        }

        const endDate = latestWeek?.metadata?.endDate
            ? context.formatDateMMDDYYYY?.(latestWeek.metadata.endDate)
            : (latestKey?.split('|')[1] ? context.formatDateMMDDYYYY?.(latestKey.split('|')[1]) : 'this period');

        const allTips = await (context.loadServerTips?.() || Promise.resolve({}));

        const metricsToAnalyze = ['scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht', 'overallSentiment'];
        const wins = [];
        const opportunities = [];

        metricsToAnalyze.forEach(metricKey => {
            const current = currentEmp[metricKey];
            if (current === undefined || current === null || current === '') return;

            const metric = context.metricsRegistry?.[metricKey] || {};
            const meetsTarget = context.metricMeetsTarget?.(metricKey, current);

            if (meetsTarget) {
                wins.push({
                    metricKey,
                    metric: metric.label || metricKey,
                    value: context.formatMetricValue?.(metricKey, parseFloat(current))
                });
                return;
            }

            const previous = previousEmp?.[metricKey];
            const trend = previous !== undefined ? context.metricDelta?.(metricKey, parseFloat(current), parseFloat(previous)) : 0;
            const tips = allTips[metricKey] || [];
            const randomTip = tips.length ? tips[Math.floor(Math.random() * tips.length)] : null;

            opportunities.push({
                metricKey,
                metric: metric.label || metricKey,
                value: context.formatMetricValue?.(metricKey, parseFloat(current)),
                target: context.formatMetricValue?.(metricKey, metric.target?.value),
                trend,
                tip: randomTip
            });
        });

        let winsText = '';
        if (wins.length > 0) {
            winsText = 'WINS:\n';
            wins.forEach(w => {
                winsText += `- ${w.metric}: ${w.value}\n`;
            });
            winsText += '\n';
        }

        let opportunitiesText = '';
        let improvementTipsText = '';
        if (opportunities.length > 0) {
            opportunitiesText = 'OPPORTUNITIES:\n';
            opportunitiesText += opportunities.map(opp => {
                let text = `- ${opp.metric}: Currently ${opp.value}, Target ${opp.target}`;
                if (opp.trend !== 0) {
                    text += ` (${opp.trend > 0 ? 'improving' : 'declining'})`;
                }
                return text;
            }).join('\n');
            opportunitiesText += '\n\n';

            improvementTipsText = 'HOW TO IMPROVE:\n';
            opportunities.forEach(opp => {
                if (opp.tip) {
                    improvementTipsText += `- ${opp.metric}: ${opp.tip}\n`;
                }
            });
            improvementTipsText += '\n';
        }

        const preferredName = context.getEmployeeNickname?.(employeeName) || currentEmp.firstName || employeeName.split(' ')[0];
        const copilotPrompt = `Draft a brief, factual coaching email for ${preferredName} (week ending ${endDate}).

${winsText}
${opportunitiesText}
${improvementTipsText}
Keep it to 2-3 sentences + three bullet-point lists. Be direct and encouraging.`;

        context.openCopilotWithPrompt?.(copilotPrompt, 'Individual Coaching Email');
    }

    async function generateGroupCoachingEmail(context = {}) {
        const keys = context.getWeeklyKeysSorted?.() || [];
        if (keys.length < 2) {
            context.showToast?.('Not enough data to generate group email', 3000);
            return;
        }

        const latestKey = keys[keys.length - 1];
        const previousKey = keys[keys.length - 2];
        const latestWeek = context.weeklyData?.[latestKey];
        const previousWeek = context.weeklyData?.[previousKey];

        if (!latestWeek?.employees || !previousWeek?.employees) {
            context.showToast?.('Not enough employee data', 3000);
            return;
        }

        const endDate = latestWeek?.metadata?.endDate
            ? context.formatDateMMDDYYYY?.(latestWeek.metadata.endDate)
            : (latestKey?.split('|')[1] ? context.formatDateMMDDYYYY?.(latestKey.split('|')[1]) : 'this period');

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

                const meetsTarget = context.metricMeetsTarget?.(metricKey, current);
                if (!meetsTarget) {
                    meetsAllTargets = false;
                    teamAnalysis.commonOpportunities[metricKey] = (teamAnalysis.commonOpportunities[metricKey] || 0) + 1;
                }

                const centerValue = centerAvg?.[metricKey];
                if (centerValue !== undefined && centerValue !== null) {
                    const currentFloat = parseFloat(current);
                    const centerFloat = parseFloat(centerValue);
                    const beatsCenterAvg = metric.higherIsBetter ? currentFloat > centerFloat : currentFloat < centerFloat;
                    if (beatsCenterAvg) {
                        const delta = metric.higherIsBetter ? currentFloat - centerFloat : centerFloat - currentFloat;
                        if (delta > 0) {
                            if (!teamAnalysis.metricChampions[metricKey]) {
                                teamAnalysis.metricChampions[metricKey] = [];
                            }
                            teamAnalysis.metricChampions[metricKey].push({ name: emp.name, value: current, delta });
                        }
                    }
                }

                if (prev !== undefined) {
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
                    const delta = context.metricDelta?.(metricKey, parseFloat(current), parseFloat(prev));
                    if (delta > 5) {
                        const metric = context.metricsRegistry?.[metricKey] || {};
                        improvingMetrics.push({
                            metric: metric.label,
                            empValue: context.formatMetricValue?.(metricKey, parseFloat(current)),
                            trend: `+${delta.toFixed(1)}%`
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
            teamAnalysis.teamWins.push(`🔥 ${teamAnalysis.improving.length} ROCKSTARS showing strong improvement and momentum`);
        }
        if (teamAnalysis.topPerformers.length > 0) {
            teamAnalysis.teamWins.push(`⭐ ${teamAnalysis.topPerformers.length} team members meeting all targets`);
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
            rockstarsText = '\n🏆 ROCKSTARS - SHOWING INCREDIBLE IMPROVEMENT:\n';
            rockstarsText += 'These team members are CRUSHING IT with strong week-over-week gains:\n';
            teamAnalysis.improving.slice(0, 5).forEach(rockstar => {
                rockstarsText += `\n${rockstar.name} - IMPROVING BIG TIME:\n`;
                if (rockstar.metrics && rockstar.metrics.length > 0) {
                    rockstar.metrics.forEach(m => {
                        rockstarsText += `  • ${m.metric}: ${m.empValue} (${m.trend} improvement!)\n`;
                    });
                }
            });
        }

        let championText = '';
        const topMetricsToHighlight = Object.entries(teamAnalysis.metricChampions)
            .filter(([_, champs]) => champs.length > 0)
            .slice(0, 3);
        if (topMetricsToHighlight.length > 0) {
            championText = '\n🎯 METRIC CHAMPIONS:\n';
            topMetricsToHighlight.forEach(([metricKey, champions]) => {
                const metric = context.metricsRegistry?.[metricKey] || {};
                championText += `\n${metric.label} Leaders:\n`;
                champions.forEach((champ, idx) => {
                    championText += `  ${idx + 1}. ${champ.name} - ${champ.value} (${champ.delta.toFixed(1)} above center avg!)\n`;
                });
            });
        }

        let recognitionText = '';
        if (teamAnalysis.topPerformers.length > 0) {
            recognitionText = '\n✅ CONSISTENT PERFORMERS (Meeting All Targets):\n';
            teamAnalysis.topPerformers.slice(0, 8).forEach(name => {
                recognitionText += `- ${name}\n`;
            });
        }

        let opportunitiesText = '\nTEAM DEVELOPMENT OPPORTUNITIES:\n';
        if (topOpportunities.length > 0) {
            topOpportunities.forEach(opp => {
                opportunitiesText += `- ${opp.metric} (${opp.count} team members need support)\n`;
                if (opp.tip) {
                    opportunitiesText += `  💡 TIP: ${opp.tip}\n`;
                }
            });
        } else {
            opportunitiesText += '- Continue current momentum and consistency\n';
        }

        const copilotPrompt = `Write a HIGH-ENERGY, MOTIVATIONAL team-wide email for the week ending ${endDate}.

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
- Create FOMO for those not on the list - make them want to be recognized next week
- Be specific with numbers and metrics where people are excelling
- Frame development opportunities positively as "join the winners circle"

TONE & STYLE:
- HIGH ENERGY, MOTIVATIONAL, and CELEBRATORY
- Call out winners by name with specific achievements
- Make top performers feel like ROCKSTARS
- Professional but exciting and engaging
- Use bullet points and emojis (🔥⭐🏆💪🎯) for impact
- Do NOT use em dashes (—) anywhere in the email
- Keep it concise but impactful (under 350 words)

SUBJECT LINE:
🔥 This Week's ROCKSTARS - Week of ${endDate}

Please generate the coaching email now with HIGH ENERGY celebrating our top performers!`;

        if (typeof context.openCopilotWithPrompt === 'function') {
            context.openCopilotWithPrompt(copilotPrompt, 'Group Coaching Email');
            return;
        }

        navigator.clipboard.writeText(copilotPrompt).then(() => {
            alert('✅ Group email prompt copied!\n\nCtrl+V and Enter to paste into Copilot.');
            window.open('https://copilot.microsoft.com', '_blank');
            context.showToast?.('Prompt copied! Paste into CoPilot to generate the email.', 3000);
        }).catch((err) => {
            console.error('Failed to copy:', err);
            alert('⚠️ Failed to copy prompt to clipboard. Please try again.');
        });
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
        generateGroupCoachingEmail
    };
})();