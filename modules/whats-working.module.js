(function() {
    'use strict';

    /**
     * What's working, what isn't, and where to pivot.
     *
     * Scott, 2026-10-25: "tracking trends, seeing what's working, what's not,
     * where we may need to pivot." The pieces existed in four places that did
     * not agree: the Intelligence page compared the team to the center for the
     * latest single week (one person moves an 18 person team's share by five
     * points), the Patterns tab credited a tip with any week the whole floor
     * improved and counted every drafted message as a tip given, and the
     * coaching outcomes sat under one associate on the Coach page.
     *
     * One page, four questions:
     *
     *   1. Where is the team against the center, over weeks, not one week?
     *      Share of the team at the year's goal, the last 4 weekly uploads
     *      against the 8 before them and against the whole center.
     *   2. Did the coaching move it? Every coaching that went out, judged one
     *      week and three weeks later against how the rest of the team moved
     *      (coaching-outcomes).
     *   3. Which tips land? The same, per tip, and nothing called working on
     *      fewer than five results.
     *   4. What do the calls show? The saved scorecards added up: which lines
     *      are missed most, and by whom.
     *
     * The builders are pure (data in, rows out) so the numbers are tested;
     * render() is the only part that reads the app's globals.
     */

    const METRICS = [
        'scheduleAdherence', 'aht', 'acw', 'holdTime', 'transfers',
        'cxRepOverall', 'fcr', 'overallExperience',
        'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions'
    ];

    const RECENT_WEEKS = 4;
    const EARLIER_WEEKS = 8;
    // A team week with fewer people measured than this is too thin to count.
    const MIN_PEOPLE = 3;
    // Ten points of the team at goal is about two people on a team of 18.
    const PIVOT_POINTS = 0.10;
    const SLIPPING_POINTS = 0.05;
    // Below this many results nothing is called working or not.
    const MIN_RESULTS = 5;
    const CALL_WINDOW_DAYS = 90;
    const MIN_SCORED_CALLS = 3;

    const CALL_METRICS = { aht: true, acw: true, holdTime: true, transfers: true };

    function modules() {
        return window.DevCoachModules || {};
    }

    function labelOf(metricKey) {
        return (window.METRICS_REGISTRY || {})[metricKey]?.label || metricKey;
    }

    const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // "Oct 18", the way the messages say a date.
    function shortDate(iso) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
        return match ? `${SHORT_MONTHS[parseInt(match[2], 10) - 1]} ${parseInt(match[3], 10)}` : String(iso || '');
    }

    function pct(share) {
        return share === null || share === undefined ? '' : `${Math.round(share * 100)}%`;
    }

    function endOf(weeklyData, key) {
        return String(weeklyData[key]?.metadata?.endDate || String(key).split('|')[1] || key);
    }

    function weekKeys(weeklyData) {
        return Object.keys(weeklyData || {})
            .filter(key => (weeklyData[key]?.metadata?.periodType || 'week') === 'week')
            .sort((a, b) => endOf(weeklyData, a).localeCompare(endOf(weeklyData, b)));
    }

    // A number that can be judged: calls behind a call metric, surveys behind
    // a survey metric, and never a 0 second handle time.
    function measuredValue(emp, metricKey, helpers) {
        const value = parseFloat(emp?.[metricKey]);
        if (!Number.isFinite(value)) return null;
        if (CALL_METRICS[metricKey]) {
            const calls = parseFloat(emp.totalCalls);
            if (Number.isFinite(calls) && calls <= 0) return null;
            if (metricKey === 'aht' && value === 0) return null;
        }
        const weight = helpers?.getSurveyWeight ? helpers.getSurveyWeight(metricKey, emp) : null;
        if (weight !== null && weight !== undefined && !(weight > 0)) return null;
        return value;
    }

    function shareAtGoal(employees, metricKey, year, deps) {
        let measured = 0;
        let met = 0;
        (employees || []).forEach(emp => {
            const value = measuredValue(emp, metricKey, deps.helpers);
            if (value === null) return;
            const meets = deps.meets(metricKey, value, year);
            if (meets === null || meets === undefined) return;
            measured += 1;
            if (meets) met += 1;
        });
        return { met, measured, share: measured ? met / measured : null };
    }

    function averageShare(weeks, pick, minPeople) {
        const shares = weeks
            .map(pick)
            .filter(item => item && item.measured >= minPeople && item.share !== null)
            .map(item => item.share);
        return shares.length ? shares.reduce((sum, share) => sum + share, 0) / shares.length : null;
    }

    /**
     * 1. The team against the center, metric by metric.
     *
     * `team` is the list of names on the team, or null when no team is set
     * (then only the center is shown). `deps.meets(metricKey, value, year)`
     * judges a value against that year's goal.
     */
    function buildTeamTrend(weeklyData, team, deps) {
        const keys = weekKeys(weeklyData);
        const recentKeys = keys.slice(-RECENT_WEEKS);
        const earlierKeys = keys.slice(-(RECENT_WEEKS + EARLIER_WEEKS), -RECENT_WEEKS);
        const teamSet = Array.isArray(team) && team.length ? new Set(team) : null;

        const weeks = (list) => list.map(key => {
            const employees = weeklyData[key]?.employees || [];
            const year = Number(endOf(weeklyData, key).slice(0, 4)) || new Date().getFullYear();
            return {
                key,
                year,
                all: employees,
                team: teamSet ? employees.filter(emp => teamSet.has(String(emp?.name || '').trim())) : null
            };
        });
        const recent = weeks(recentKeys);
        const earlier = weeks(earlierKeys);

        const rows = METRICS.map(metricKey => {
            const teamShare = (week) => (week.team ? shareAtGoal(week.team, metricKey, week.year, deps) : null);
            const centerShare = (week) => shareAtGoal(week.all, metricKey, week.year, deps);
            const latestWeek = recent[recent.length - 1];

            const row = {
                metricKey,
                label: labelOf(metricKey),
                teamRecent: teamSet ? averageShare(recent, teamShare, MIN_PEOPLE) : null,
                teamEarlier: teamSet ? averageShare(earlier, teamShare, MIN_PEOPLE) : null,
                centerRecent: averageShare(recent, centerShare, 1),
                centerEarlier: averageShare(earlier, centerShare, 1),
                latest: latestWeek ? (teamSet ? teamShare(latestWeek) : centerShare(latestWeek)) : null
            };
            row.read = readOf(row, Boolean(teamSet));
            return row;
        });

        const order = { pivot: 0, watch: 1, working: 2, unknown: 3 };
        rows.sort((a, b) => order[a.read] - order[b.read]
            || ((a.teamRecent ?? a.centerRecent ?? 1) - (b.teamRecent ?? b.centerRecent ?? 1)));

        return {
            rows,
            hasTeam: Boolean(teamSet),
            teamSize: teamSet ? teamSet.size : 0,
            recentWeeks: recentKeys.length,
            earlierWeeks: earlierKeys.length,
            latestEnd: recentKeys.length ? endOf(weeklyData, recentKeys[recentKeys.length - 1]) : ''
        };
    }

    function readOf(row, hasTeam) {
        const now = hasTeam ? row.teamRecent : row.centerRecent;
        const before = hasTeam ? row.teamEarlier : row.centerEarlier;
        if (now === null) return 'unknown';
        const behindCenter = hasTeam && row.centerRecent !== null && now <= row.centerRecent - PIVOT_POINTS;
        const falling = before !== null && now <= before - PIVOT_POINTS;
        if (behindCenter || falling) return 'pivot';
        const slipping = before !== null && now < before - SLIPPING_POINTS;
        const atOrAhead = !hasTeam || (row.centerRecent !== null && now >= row.centerRecent);
        return atOrAhead && !slipping ? 'working' : 'watch';
    }

    // The row's story in one or two plain sentences.
    function rowSentence(row, hasTeam) {
        const now = hasTeam ? row.teamRecent : row.centerRecent;
        const before = hasTeam ? row.teamEarlier : row.centerEarlier;
        if (now === null) return 'Not enough of the team measured to say.';
        const who = hasTeam ? 'the team' : 'the center';
        const parts = [`${pct(now)} of ${who} at goal over the last ${RECENT_WEEKS} weeks`];
        if (hasTeam && row.centerRecent !== null) parts[0] += `, against ${pct(row.centerRecent)} across the center`;
        let text = `${parts[0]}.`;
        if (before !== null) {
            const move = Math.round((now - before) * 100);
            if (move >= 5) text += ` Up from ${pct(before)} the ${EARLIER_WEEKS} weeks before.`;
            else if (move <= -5) text += ` Down from ${pct(before)} the ${EARLIER_WEEKS} weeks before.`;
            else text += ` About the same as the ${EARLIER_WEEKS} weeks before.`;
        }
        return text;
    }

    /**
     * 2 and 3. The coaching that went out, judged afterwards. `outcomes` is
     * coachingOutcomes.buildOutcomes() for the people on the team.
     */
    function buildCoachingResults(outcomes, outcomesModule) {
        const list = Array.isArray(outcomes) ? outcomes : [];
        const byMetric = outcomesModule?.summarizeByMetric ? outcomesModule.summarizeByMetric(list) : [];
        const byTip = outcomesModule?.summarizeBySuggestion ? outcomesModule.summarizeBySuggestion(list) : [];
        const settled = list.filter(item => item.verdict !== 'pending').length;
        const bySource = {};
        list.forEach(item => {
            const source = item.source || 'other';
            bySource[source] = (bySource[source] || 0) + 1;
        });
        return {
            total: list.length,
            settled,
            waiting: list.length - settled,
            bySource,
            metrics: byMetric.map(row => Object.assign({}, row, { enough: row.total >= MIN_RESULTS })),
            tipsWithRate: byTip.filter(row => row.rate !== null),
            tipsWaiting: byTip.filter(row => row.rate === null).length
        };
    }

    /**
     * 4. The saved scorecards added up. `callLogs` is callListeningLogs
     * ({ name: [entry] }); `lines` is callScorecard.LINES for the labels.
     */
    function buildCallTrends(callLogs, team, lines, options = {}) {
        const sinceIso = options.sinceIso || '';
        const teamSet = Array.isArray(team) && team.length ? new Set(team) : null;
        const lineStats = {};
        (lines || []).forEach(def => { lineStats[def.key] = { key: def.key, label: def.label, missed: 0, met: 0 }; });
        const people = [];
        let scored = 0;
        let overGoal = 0;
        let timed = 0;

        Object.keys(callLogs || {}).forEach(name => {
            if (teamSet && !teamSet.has(name)) return;
            const calls = (callLogs[name] || []).filter(entry => entry?.scorecard?.lines?.length
                && (!sinceIso || String(entry.listenedOn || '') >= sinceIso));
            if (!calls.length) return;

            const misses = {};
            let met = 0;
            let applied = 0;
            calls.forEach(entry => {
                scored += 1;
                const n = entry.scorecard.numbers || {};
                if (n.lengthSeconds && n.goalSeconds) {
                    timed += 1;
                    if (n.lengthSeconds > n.goalSeconds) overGoal += 1;
                }
                entry.scorecard.lines.forEach(item => {
                    const stat = lineStats[item.key];
                    if (!stat) return;
                    if (item.verdict === 'missed') {
                        stat.missed += 1;
                        misses[item.key] = (misses[item.key] || 0) + 1;
                        applied += 1;
                    } else if (item.verdict === 'yes') {
                        stat.met += 1;
                        met += 1;
                        applied += 1;
                    }
                });
            });

            const topMiss = Object.keys(misses).sort((a, b) => misses[b] - misses[a])[0] || '';
            people.push({
                name,
                calls: calls.length,
                met,
                applied,
                share: applied ? met / applied : null,
                topMiss: topMiss ? { key: topMiss, label: lineStats[topMiss]?.label || topMiss, count: misses[topMiss] } : null
            });
        });

        const lineRows = Object.values(lineStats)
            .filter(stat => stat.missed + stat.met > 0)
            .map(stat => Object.assign(stat, { applied: stat.missed + stat.met, missRate: stat.missed / (stat.missed + stat.met) }))
            .sort((a, b) => b.missRate - a.missRate || b.missed - a.missed);

        people.sort((a, b) => (a.share ?? 1) - (b.share ?? 1));
        return { scored, enough: scored >= MIN_SCORED_CALLS, lines: lineRows, people, timed, overGoal };
    }

    /* ── Saying it ── */

    const READ_PILL = {
        working: '<span class="pill pill-good">Working</span>',
        watch: '<span class="pill pill-warn">Watch</span>',
        pivot: '<span class="pill pill-bad">Pivot</span>',
        unknown: '<span class="pill">Not enough yet</span>'
    };

    function teamTrendHtml(trend, esc) {
        if (!trend.recentWeeks) {
            return '<p class="text-secondary">Upload a few weeks of data and this fills in.</p>';
        }
        const who = trend.hasTeam ? `your ${trend.teamSize}` : 'the whole center';
        const intro = `<p class="text-secondary" style="margin-top:0;">Share of ${esc(who)} at this year's goal, averaged over the last ${trend.recentWeeks} weekly uploads (through ${esc(shortDate(trend.latestEnd))}). Pivot means behind the center by ten points or more, or down ten points on the weeks before. One person moves a team share by about ${trend.hasTeam && trend.teamSize ? Math.round(100 / trend.teamSize) : 5} points, so read these as direction.</p>`;
        const rows = trend.rows.map(row => `<tr>
            <td>${esc(row.label)}</td>
            <td>${READ_PILL[row.read]}</td>
            <td>${esc(rowSentence(row, trend.hasTeam))}</td>
            <td class="text-muted-sm">${row.latest && row.latest.measured ? `${row.latest.met} of ${row.latest.measured} last week` : ''}</td>
        </tr>`).join('');
        const setTeam = trend.hasTeam ? '' : '<p class="text-muted-sm">Tick your team in Settings, Team Members, to set it against the center.</p>';
        return `${intro}<table class="data-table"><thead><tr><th>Goal</th><th>Read</th><th>What the numbers say</th><th>Latest</th></tr></thead><tbody>${rows}</tbody></table>${setTeam}`;
    }

    function rate(part, whole) {
        return whole ? `${part} of ${whole}` : '';
    }

    function coachingHtml(results, esc) {
        if (!results.total) {
            return '<p class="text-secondary" style="margin-top:0;">Nothing logged yet. Coaching is logged when it goes out: a call sent to Verint or emailed, a Today message marked sent, a Coach page prompt. Once a week or three of uploads follow it, this says whether it moved.</p>';
        }
        // Records from before the channel was kept (2026-10-26) are counted
        // in the total and not named.
        const named = { call: 'from calls', today: 'from Today', coach: 'from the Coach page', trend: 'from trend emails' };
        const sources = Object.keys(results.bySource).filter(key => named[key]).map(key => `${results.bySource[key]} ${named[key]}`);
        const fromWhere = sources.length ? ` (${sources.join(', ')})` : '';
        const pieces = `${results.total} piece${results.total === 1 ? '' : 's'}`;
        const have = (n) => `${n} ${n === 1 ? 'has' : 'have'}`;
        const are = (n) => `${n} ${n === 1 ? 'is' : 'are'}`;
        const intro = `<p class="text-secondary" style="margin-top:0;">${pieces} of coaching on the team${esc(fromWhere)}. ${have(results.settled)} the week after uploaded; ${are(results.waiting)} waiting. "Beat the team" means the number moved more than the rest of the team's did over the same weeks, which is the fair test: a week where everyone improved is not evidence the coaching did it.</p>`;
        const rows = results.metrics.map(row => `<tr>
            <td>${esc(row.label)}</td>
            <td>${row.total}</td>
            <td>${esc(rate(row.moved, row.total))}</td>
            <td>${esc(rate(row.beatTeam, row.comparable))}</td>
            <td>${esc(rate(row.moved3, row.total3))}</td>
            <td>${esc(rate(row.beatTeam3, row.comparable3))}</td>
            <td>${row.enough ? '' : '<span class="pill">Too few to call</span>'}</td>
        </tr>`).join('');
        return `${intro}<table class="data-table"><thead><tr><th>Goal</th><th>Coached</th><th>Moved, 1 week</th><th>Beat the team, 1 week</th><th>Moved, 3 weeks</th><th>Beat the team, 3 weeks</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function tipsHtml(results, esc) {
        if (!results.tipsWithRate.length) {
            const waiting = results.tipsWaiting
                ? `${results.tipsWaiting} tips have gone out; none has ${MIN_RESULTS} results yet, so none is called working or not.`
                : 'No tips have gone out with a result yet.';
            return `<p class="text-secondary" style="margin-top:0;">${esc(waiting)}</p>`;
        }
        const rows = results.tipsWithRate.slice(0, 10).map(row => `<tr>
            <td>${esc(labelOf(row.metricKey))}</td>
            <td>${esc(row.text)}</td>
            <td>${Math.round(row.rate * 100)}% ${esc(row.rateBasis)}</td>
            <td class="text-muted-sm">${row.rateSample} results, ${row.people} people</td>
        </tr>`).join('');
        return `<table class="data-table"><thead><tr><th>Goal</th><th>Tip</th><th>Landed</th><th>Out of</th></tr></thead><tbody>${rows}</tbody></table>`
            + (results.tipsWaiting ? `<p class="text-muted-sm">${results.tipsWaiting} more tips are waiting for ${MIN_RESULTS} results.</p>` : '');
    }

    function callsHtml(calls, esc) {
        if (!calls.enough) {
            return `<p class="text-secondary" style="margin-top:0;">${calls.scored ? `${calls.scored} call${calls.scored === 1 ? '' : 's'} scored in the last ${CALL_WINDOW_DAYS} days.` : 'No scored calls yet.'} Paste a few calls on People, Calls, and the scorecards add up here: which lines are missed most, and by whom.</p>`;
        }
        const lines = calls.lines.map(row => `<tr>
            <td>${esc(row.label)}</td>
            <td>${esc(rate(row.missed, row.applied))}</td>
            <td>${row.missRate >= 0.5 ? '<span class="pill pill-bad">Most calls</span>' : (row.missRate >= 0.25 ? '<span class="pill pill-warn">Often</span>' : '')}</td>
        </tr>`).join('');
        const people = calls.people.map(person => `<tr>
            <td>${esc(person.name)}</td>
            <td>${person.calls}</td>
            <td>${esc(rate(person.met, person.applied))}</td>
            <td>${person.topMiss ? esc(`${person.topMiss.label} (${person.topMiss.count})`) : ''}</td>
        </tr>`).join('');
        const length = calls.timed ? `<p class="text-muted-sm">${calls.overGoal} of ${calls.timed} timed calls ran over the handle time goal.</p>` : '';
        return `<p class="text-secondary" style="margin-top:0;">${calls.scored} calls scored in the last ${CALL_WINDOW_DAYS} days, as you left the scorecards. The line missed on the most calls is the one worth a huddle.</p>
            <table class="data-table"><thead><tr><th>Line</th><th>Missed</th><th></th></tr></thead><tbody>${lines}</tbody></table>${length}
            <table class="data-table" style="margin-top: var(--space-3);"><thead><tr><th>Associate</th><th>Calls</th><th>Lines met</th><th>Missed most</th></tr></thead><tbody>${people}</tbody></table>`;
    }

    // One associate's saved scorecards, newest eight, for the top of their
    // call history on People, Calls. Read from the cards as Scott left them,
    // so a corrected line counts the way he corrected it.
    const ASSOCIATE_CALLS = 8;
    const MAX_MISSES_NAMED = 3;

    function buildAssociateCallsHtml(name, entries, lines, esc) {
        const scored = (Array.isArray(entries) ? entries : [])
            .filter(entry => entry?.scorecard?.lines?.length)
            .sort((a, b) => String(b.listenedOn || '').localeCompare(String(a.listenedOn || '')))
            .slice(0, ASSOCIATE_CALLS);
        if (scored.length < 2) return '';

        const calls = buildCallTrends({ [name]: scored }, [name], lines);
        const person = calls.people[0];
        if (!person || !person.applied) return '';
        const missed = calls.lines.filter(line => line.missed > 0).slice(0, MAX_MISSES_NAMED)
            .map(line => `${line.label} on ${line.missed} of ${line.applied}`);
        const sentences = [`Over the last ${scored.length} scored calls, ${person.met} of the ${person.applied} lines that applied were met.`];
        if (missed.length) sentences.push(`Missed most: ${missed.join('; ')}.`);
        else sentences.push('Nothing missed more than once.');
        if (calls.timed) sentences.push(`${calls.overGoal} of ${calls.timed} ran over the handle time goal.`);
        return `<div class="card-sunken" style="margin-bottom: var(--space-3);"><span class="eyebrow">Scorecards</span><p style="margin: 4px 0 0;">${esc(sentences.join(' '))}</p></div>`;
    }

    function buildPageHtml(model, esc) {
        const card = (title, body) => `<div class="card"><h3 class="section-title" style="margin:0 0 8px;">${esc(title)}</h3>${body}</div>`;
        return [
            card('Where to keep going, and where to pivot', teamTrendHtml(model.trend, esc)),
            card('Did the coaching move it?', coachingHtml(model.coaching, esc)),
            card('Which tips land', tipsHtml(model.coaching, esc)),
            card('What the calls show', callsHtml(model.calls, esc))
        ].join('');
    }

    /* ── The page ── */

    function render(container) {
        if (!container) return;
        const m = modules();
        const esc = m.sharedUtils?.escapeHtml || ((value) => String(value == null ? '' : value));
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        const logs = typeof callListeningLogs !== 'undefined' ? callListeningLogs : {};

        const context = m.teamFilter?.getTeamSelectionContext?.() || null;
        const team = context && context.isFiltering ? context.selectedMembers : null;
        const deps = {
            helpers: m.metricsRegistryHelpers,
            meets: (metricKey, value, year) => m.metricProfiles?.meetsYearTarget?.(metricKey, value, year)
        };

        const outcomes = m.coachingOutcomes?.buildOutcomes
            ? m.coachingOutcomes.buildOutcomes().filter(item => !team || team.includes(item.employee))
            : [];
        const since = new Date(Date.now() - CALL_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        const model = {
            trend: buildTeamTrend(weekly, team, deps),
            coaching: buildCoachingResults(outcomes, m.coachingOutcomes),
            calls: buildCallTrends(logs, team, m.callScorecard?.LINES || [], { sinceIso: since })
        };
        container.innerHTML = buildPageHtml(model, esc);
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.whatsWorking = {
        METRICS,
        RECENT_WEEKS,
        EARLIER_WEEKS,
        MIN_RESULTS,
        buildTeamTrend,
        readOf,
        rowSentence,
        buildCoachingResults,
        buildCallTrends,
        buildAssociateCallsHtml,
        buildPageHtml,
        render
    };
})();
