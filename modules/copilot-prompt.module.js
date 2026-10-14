(function() {
    'use strict';

    /* ── What the coaching log really holds ──

       script.js recordCoachingEvent saves { employeeId, weekEnding,
       metricsCoached, suggestions, aiAssisted, generatedAt } and nothing else.
       This summary read latestSession.celebrate and needsCoaching, which no
       call site has ever saved, so every Verint note took the no-wins branch
       ("acknowledged their efforts to improve") and listed no focus areas,
       however the associate was doing.

       So the wins are read where they live: the associate's row in the
       period the session was about (weekEnding when it is a date, otherwise
       the newest week on or before the day it was logged). The focus areas
       are what the session coached, metricsCoached.

       Scott, 2026-10-14: every piece of feedback carries positive feedback.
       With nothing on target, the note names the best true thing instead
       (messageVoice.truePositive): moved the right way since the period
       before, better than the center average, closest to goal, and only then
       the effort. Reliability is never a win or a focus here, a 0 second
       handle time is no calls rather than a win, and a survey metric nobody
       answered is left out rather than read as 0%. */

    // The coaching metrics, for a load order without metric-trends.
    const COACHING_METRIC_FALLBACK = [
        'scheduleAdherence', 'aht', 'overallSentiment', 'cxRepOverall', 'fcr', 'overallExperience',
        'transfers', 'positiveWord', 'negativeWord', 'managingEmotions', 'acw', 'holdTime'
    ];
    // Where the stored center averages keep each metric.
    const CENTER_AVG_KEY = { scheduleAdherence: 'adherence', overallSentiment: 'sentiment', cxRepOverall: 'repSatisfaction' };
    const SURVEY_COUNT_FALLBACK = { cxRepOverall: 'repSurveyTotal', fcr: 'fcrSurveyTotal', overallExperience: 'surveyTotal' };
    const MAX_WINS = 3;

    function registry() {
        return window.METRICS_REGISTRY || {};
    }

    function formatValue(key, value) {
        if (typeof window.formatMetricDisplay === 'function') return window.formatMetricDisplay(key, value);
        return String(value);
    }

    function labelFor(key) {
        return registry()[key]?.label || key;
    }

    function periodEnd(key, period) {
        const end = period?.metadata?.endDate || (String(key).indexOf('|') > -1 ? String(key).split('|')[1] : '');
        return String(end || '').slice(0, 10);
    }

    // Every uploaded period this associate is in, weekly store first.
    function periodsWith(employeeId, context) {
        const weekly = context.weeklyData || (typeof weeklyData !== 'undefined' ? weeklyData : null) || {};
        const ytd = context.ytdData || (typeof ytdData !== 'undefined' ? ytdData : null) || {};
        const out = [];
        [weekly, ytd].forEach((store) => {
            Object.keys(store || {}).forEach((key) => {
                const period = store[key];
                const employee = (period?.employees || []).find(emp => emp && emp.name === employeeId);
                if (!employee) return;
                out.push({ key, period, employee, end: periodEnd(key, period), type: period?.metadata?.periodType || 'week' });
            });
        });
        return out;
    }

    const TYPE_ORDER = { week: 0, 'week-in-progress': 1, month: 2, 'month-agg': 3, quarter: 4, ytd: 5 };
    function typeRank(p) {
        return Object.prototype.hasOwnProperty.call(TYPE_ORDER, p.type) ? TYPE_ORDER[p.type] : 6;
    }

    // The period a session was about: its weekEnding when that is a date,
    // otherwise the newest week on or before the day it was logged.
    function resolveSessionPeriod(employeeId, session, context = {}) {
        const all = periodsWith(employeeId, context);
        if (!all.length) return null;
        const ending = String(session?.weekEnding || '');
        const wanted = /^\d{4}-\d{2}-\d{2}/.test(ending) ? ending.slice(0, 10) : '';
        if (wanted) {
            const exact = all.filter(p => p.end === wanted).sort((a, b) => typeRank(a) - typeRank(b));
            if (exact.length) return exact[0];
        }
        const day = String(session?.generatedAt || '').slice(0, 10);
        const weeks = all.filter(p => p.type === 'week');
        const pool = weeks.length ? weeks : all;
        const onOrBefore = day ? pool.filter(p => p.end && p.end <= day) : pool;
        return (onOrBefore.length ? onOrBefore : pool)
            .slice()
            .sort((a, b) => b.end.localeCompare(a.end) || typeRank(a) - typeRank(b))[0];
    }

    // The same kind of period, just before, for "moved the right way".
    function priorPeriod(employeeId, current, context = {}) {
        if (!current) return null;
        return periodsWith(employeeId, context)
            .filter(p => p.type === current.type && p.end && p.end < current.end)
            .sort((a, b) => b.end.localeCompare(a.end))[0] || null;
    }

    // The center over the same period: the stored averages, else the same
    // weighted arithmetic over the period's own rows (morningPulse owns it).
    function centerFor(current) {
        if (!current) return {};
        const pulse = window.DevCoachModules?.morningPulse;
        if (typeof pulse?.centerAveragesFor === 'function') {
            const found = pulse.centerAveragesFor(current.key);
            if (found && Object.keys(found).length) return found;
        }
        if (typeof getCallCenterAverageForPeriod === 'function') {
            const stored = getCallCenterAverageForPeriod(current.key);
            if (stored) return stored;
        }
        if (typeof calculateCenterAveragesFromEmployees === 'function') {
            return calculateCenterAveragesFromEmployees(current.period?.employees || []) || {};
        }
        return {};
    }

    function metricKeys() {
        const order = typeof window.getMetricOrder === 'function' ? window.getMetricOrder() : null;
        const keys = Array.isArray(order) && order.length
            ? order.map(item => item && item.key).filter(Boolean)
            : COACHING_METRIC_FALLBACK;
        return keys.filter(key => key !== 'reliability');
    }

    function hasSurveysBehind(employee, key) {
        const shared = window.DevCoachModules?.coachingEmail?.hasSurveysBehind;
        if (typeof shared === 'function') return shared(employee, key);
        const weigh = window.DevCoachModules?.metricsRegistryHelpers?.getSurveyWeight || window.getSurveyWeight;
        if (typeof weigh === 'function') {
            const count = weigh(key, employee);
            return count === null || count > 0;
        }
        const field = SURVEY_COUNT_FALLBACK[key];
        if (!field) return true;
        const own = parseInt(employee?.[field], 10);
        const count = Number.isInteger(own) ? own : parseInt(employee?.surveyTotal, 10);
        return Number.isInteger(count) && count > 0;
    }

    function tookNoCalls(employee) {
        const shared = window.DevCoachModules?.morningPulse?.tookNoCalls;
        if (typeof shared === 'function') return !!shared(employee);
        if (!employee) return true;
        const aht = parseFloat(employee.aht);
        if (Number.isFinite(aht)) return aht <= 0;
        const calls = parseInt(employee.totalCalls, 10);
        return Number.isFinite(calls) && calls <= 0;
    }

    function targetFor(key, year) {
        const yearTarget = window.DevCoachModules?.metricProfiles?.getYearTarget?.(key, year);
        if (yearTarget && Number.isFinite(Number(yearTarget.value))) return yearTarget;
        const fallback = registry()[key]?.target;
        return fallback && Number.isFinite(Number(fallback.value)) ? fallback : null;
    }

    function meetsTarget(key, value, target) {
        const judged = window.DevCoachModules?.metricProfiles?.valueMeetsTarget?.(key, value, target);
        if (judged === true || judged === false) return judged;
        return target.type === 'max' ? value <= Number(target.value) : value >= Number(target.value);
    }

    // The metrics this row can honestly speak for, each judged against the
    // year's goal. Not the hours, not a survey nobody answered, not a 0.
    function readings(employee, year) {
        if (!employee) return [];
        const out = [];
        metricKeys().forEach((key) => {
            const raw = employee[key];
            if (raw === null || raw === undefined || raw === '' || raw === 'N/A') return;
            const value = parseFloat(raw);
            if (!Number.isFinite(value) || value === 0) return;
            if (!hasSurveysBehind(employee, key)) return;
            const target = targetFor(key, year);
            if (!target) return;
            const goal = Number(target.value);
            const ahead = target.type === 'max' ? goal - value : value - goal;
            out.push({
                key,
                label: labelFor(key),
                value,
                target,
                meets: meetsTarget(key, value, target),
                margin: goal ? ahead / Math.abs(goal) : 0
            });
        });
        return out;
    }

    // "24 seconds", "1.4 points". A move in words, never "+1.4%".
    function amountInWords(key, size) {
        const unit = registry()[key]?.unit;
        const abs = Math.abs(Number(size));
        if (unit === 'sec') {
            const s = Math.max(1, Math.round(abs));
            return `${s} ${s === 1 ? 'second' : 'seconds'}`;
        }
        const n = Math.max(0.1, Math.round(abs * 10) / 10);
        if (unit === '%') return `${n} ${n === 1 ? 'point' : 'points'}`;
        return String(n);
    }

    const PERIOD_WORD = { week: 'week', 'week-in-progress': 'week', month: 'month', 'month-agg': 'month', quarter: 'quarter' };

    /**
     * The positive opening of the Verint note, in the past tense: the goals
     * on target, or with none, the best true thing about the period.
     * Returns { kind, labels, text }; kind 'wins' carries the labels.
     */
    function sessionPositive(firstName, current, prior) {
        const year = parseInt(String(current?.end || '').slice(0, 4), 10) || new Date().getFullYear();
        const employee = current?.employee || null;
        const noCalls = !!employee && tookNoCalls(employee);
        const read = noCalls ? [] : readings(employee, year);

        const wins = read.filter(r => r.meets).sort((a, b) => b.margin - a.margin).slice(0, MAX_WINS);
        if (wins.length) {
            return { kind: 'wins', labels: wins.map(r => r.label), text: '' };
        }

        const priorRead = {};
        if (prior?.employee && !tookNoCalls(prior.employee)) {
            readings(prior.employee, year).forEach((r) => { priorRead[r.key] = r.value; });
        }
        const center = noCalls ? {} : centerFor(current);
        const rows = read.map((r) => {
            const centerValue = parseFloat(center[CENTER_AVG_KEY[r.key] || r.key]);
            return {
                key: r.key,
                label: r.label,
                value: r.value,
                target: Number(r.target.value),
                prior: Number.isFinite(priorRead[r.key]) ? priorRead[r.key] : null,
                center: Number.isFinite(centerValue) && centerValue > 0 ? centerValue : null
            };
        });

        const voice = window.DevCoachModules?.messageVoice;
        const best = typeof voice?.truePositive === 'function'
            ? voice.truePositive(rows, { ongoing: false, tookNoCalls: noCalls })
            : { kind: 'effort' };
        const row = rows.find(item => item.key === best.key);
        const label = row ? row.label : '';

        let text;
        if (row && best.kind === 'atGoal') {
            text = `I recognized ${firstName} for ${label} on target at ${formatValue(row.key, row.value)}.`;
        } else if (row && best.kind === 'improved') {
            const word = PERIOD_WORD[prior?.type] || 'period';
            text = `I recognized ${firstName} for moving ${label} the right way, ${row.value > row.prior ? 'up' : 'down'} `
                + `${amountInWords(row.key, row.value - row.prior)} from the ${word} before.`;
        } else if (row && best.kind === 'aboveCenter') {
            text = `I recognized ${firstName} for ${label} of ${formatValue(row.key, row.value)}, `
                + `better than the center average of ${formatValue(row.key, row.center)}.`;
        } else if (row && best.kind === 'closest') {
            text = `I recognized ${firstName} for ${label}, the closest to goal at ${formatValue(row.key, row.value)} `
                + `against the ${formatValue(row.key, row.target)} goal, a strong base to build on.`;
        } else {
            text = `I recognized ${firstName} for the effort they are putting in.`;
        }
        return { kind: row ? best.kind : 'effort', labels: label ? [label] : [], text };
    }

    // What the session coached, as names. Never the hours, and never a
    // survey metric the period shows nobody answered.
    function focusLabels(session, current) {
        const employee = current?.employee || null;
        const seen = new Set();
        const out = [];
        (Array.isArray(session?.metricsCoached) ? session.metricsCoached : []).forEach((key) => {
            if (!key || key === 'reliability' || seen.has(key)) return;
            if (employee && !hasSurveysBehind(employee, key)) return;
            seen.add(key);
            out.push(labelFor(key));
        });
        return out;
    }

    function generateVerintSummary(context = {}) {
        const doc = context.document || document;
        const nav = context.navigator || navigator;
        const showToast = context.showToast || function() {};
        const toNonEmptyString = window.DevCoachModules?.sharedUtils?.toNonEmptyString || ((value) => (typeof value === 'string' ? value.trim() : ''));
        const joinWithConjunction = window.DevCoachModules?.sharedUtils?.joinWithConjunction || ((items) => (Array.isArray(items) ? items.filter(Boolean).join(', ') : ''));

        // #employeeSelect and #employeeName have not existed in index.html for a
        // long time, so this read always came back empty and the button did
        // nothing at all. The picker on the Coaching tab, where the button
        // lives, is #coachingEmployeeSelect.
        const employeeSelect = doc.getElementById('coachingEmployeeSelect');
        const selectedEmployeeId = toNonEmptyString(employeeSelect?.value);

        if (!selectedEmployeeId) {
            showToast('Choose an associate first.', 3000);
            return;
        }

        const history = context.getCoachingHistoryForEmployee?.(selectedEmployeeId) || [];

        if (history.length > 0) {
            const cleanLabel = (item) => {
                if (!item) return '';
                const match = item.match(/^\-\s*(.+?):/);
                if (match) return match[1].trim();
                return item.replace(/^-/, '').split(':')[0].trim();
            };

            const firstName = context.getEmployeeNickname?.(selectedEmployeeId) || selectedEmployeeId.split(' ')[0];

            const latestSession = history[0];
            const date = new Date(latestSession.generatedAt).toLocaleDateString();
            const current = resolveSessionPeriod(selectedEmployeeId, latestSession, context);
            const prior = priorPeriod(selectedEmployeeId, current, context);

            // An entry written with these lists (no call site saves them
            // today) keeps them; otherwise the period itself is read.
            const legacyWins = (latestSession.celebrate || []).map(cleanLabel).filter(Boolean);
            const legacyOpps = (latestSession.needsCoaching || []).map(cleanLabel).filter(Boolean);
            const positive = legacyWins.length
                ? { kind: 'wins', labels: legacyWins, text: '' }
                : sessionPositive(firstName, current, prior);
            const oppLabels = legacyOpps.length ? legacyOpps : focusLabels(latestSession, current);

            let verintText = `Coaching Session with ${firstName} - ${date}\n\n`;

            if (positive.kind === 'wins') {
                verintText += `I recognized ${firstName} for their strong performance in ${joinWithConjunction(positive.labels)}.`;
                verintText += ' Encouraged them to keep up the great work in these areas.\n\n';
            } else {
                verintText += `${positive.text} Encouraged them to keep building on it.\n\n`;
            }

            if (oppLabels.length > 0) {
                verintText += `We reviewed development opportunities in ${joinWithConjunction(oppLabels)}`;
                verintText += `. We discussed specific strategies and tips to help improve performance in these metrics. ${firstName} acknowledged the feedback and committed to implementing the discussed improvements.\n\n`;
            }

            verintText += 'Action Items:\n';
            if (oppLabels.length > 0) {
                oppLabels.forEach(metric => {
                    verintText += `• Focus on improving ${metric}\n`;
                });
            } else {
                verintText += '• Continue current performance level\n';
            }

            verintText += '\nNext Steps: Follow up next week to review progress and provide additional support as needed.';

            if (history.length > 1) {
                verintText += `\n\n--- Previous Coaching Sessions: ${history.length - 1} ---`;
            }

            const outputElement = doc.getElementById('verintSummaryOutput');
            if (outputElement) outputElement.value = verintText;

            const summarySection = doc.getElementById('verintSummarySection');
            if (summarySection) summarySection.style.display = 'block';

            // Through the shared helper, which has a fallback for when the async
            // clipboard is unavailable. This used to call writeText directly with
            // no fallback at all, so a non-secure context failed outright.
            if (typeof window.copyToClipboard === 'function') {
                window.copyToClipboard(verintText, { message: '✅ Verint coaching notes copied to clipboard!' });
            } else {
                nav.clipboard.writeText(verintText).then(() => {
                    showToast('✅ Verint coaching notes copied to clipboard!', 3000);
                }).catch(() => showToast('⚠️ Could not copy. The text is displayed above.', 3000));
            }
            return verintText;
        } else {
            const outputElement = doc.getElementById('verintSummaryOutput');
            if (outputElement) outputElement.value = `No coaching history found for ${selectedEmployeeId}. Generate a coaching email first.`;
            const summarySection = doc.getElementById('verintSummarySection');
            if (summarySection) summarySection.style.display = 'block';
        }
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.copilotPrompt = {
        generateVerintSummary,
        resolveSessionPeriod,
        sessionPositive
    };
})();
