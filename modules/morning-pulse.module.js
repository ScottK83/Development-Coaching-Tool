(function() {
    'use strict';

    // ============================================
    // MORNING PULSE MODULE
    // Team-wide weekly trajectory briefing with
    // per-person quick check-in generation.
    //
    // Compares across recent uploads (e.g. Mon-Wed)
    // to show who improved, who dipped, and by how
    // much — so you can say "You made the biggest
    // jump in FCR this week."
    // ============================================

    // Volume-only metrics excluded from pulse messages (no target to coach against)
    const PULSE_EXCLUDED_METRICS = ['totalCalls', 'reliability'];
    const PULSE_SELECTION_STORAGE_KEY = 'devCoachingTool_morningPulseSelection';

    // --- Phrase pools (randomized to avoid sounding templated) ---
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    const GREETINGS = [
        name => `Hey ${name}!`,
        name => `Hi ${name}!`,
        name => `What's up ${name}!`,
        name => `Hey there ${name}!`,
        name => `${name}!`,
    ];
    const DATA_IN = [
        date => `Your numbers for the week of ${date} just came in.`,
        date => `Got your data for the week of ${date}.`,
        date => `Just pulled up your week of ${date} numbers.`,
        date => `Your stats from the week of ${date} are in.`,
        date => `Took a look at your week of ${date} performance.`,
    ];
    const JUMP_INTROS = [
        (label, delta, range) => `Huge improvement in ${label}, ${delta}! (${range})`,
        (label, delta, range) => `Big move in ${label} this week, ${delta}! (${range})`,
        (label, delta, range) => `Love seeing ${label} move like that, ${delta}! (${range})`,
        (label, delta, range) => `${label} really stood out this week, ${delta}! (${range})`,
        (label, delta, range) => `You crushed it on ${label}, ${delta}! (${range})`,
    ];
    const PLUS_SOLID = [
        (label, val) => `Plus you're solid on ${label} at ${val}.`,
        (label, val) => `And ${label} sitting at ${val} is great too.`,
        (label, val) => `${label} at ${val} is right where it needs to be.`,
        (label, val) => `Also, ${label} at ${val}? Nice.`,
    ];
    const TWO_WINS = [
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2}? That's solid.`,
        (l1, v1, l2, v2) => `Loving ${l1} at ${v1} and ${l2} at ${v2}!`,
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2} are looking great!`,
        (l1, v1, l2, v2) => `Really strong showing on ${l1} (${v1}) and ${l2} (${v2}).`,
    ];
    const ONE_WIN = [
        (label, val) => `${label} at ${val} is looking great!`,
        (label, val) => `Solid work on ${label} at ${val}!`,
        (label, val) => `${label} at ${val}? Love to see it.`,
        (label, val) => `Nice job keeping ${label} at ${val}.`,
    ];
    const NO_WINS = [
        'I see you putting in the effort and I appreciate it!',
        'Appreciate you showing up and grinding this week.',
        'I know the numbers don\'t always show it, but the effort matters.',
        'Keep pushing, I see the work you\'re putting in.',
    ];
    const FOCUS_INTROS = [
        (label, val, target) => `One thing to zero in on: ${label} (at ${val}, target is ${target}).`,
        (label, val, target) => `Let's work on getting ${label} closer to target (${val} vs ${target}).`,
        (label, val, target) => `Area to focus on: ${label} sitting at ${val}, we want ${target}.`,
        (label, val, target) => `Your focus this week: ${label} (currently ${val}, target ${target}).`,
    ];
    const CLOSERS = [
        'Keep it up! Let me know if you need anything.',
        'Solid week. I\'m here if you want to chat about anything.',
        'Keep doing your thing. Reach out if you need me.',
        'Good stuff. Let\'s keep the momentum going.',
        'Nice work this week. My door\'s always open.',
    ];
    const HF_OPENERS = [
        name => `Hey ${name}! \uD83C\uDF89`,
        name => `${name}! \uD83C\uDF89\uD83D\uDE4C`,
        name => `Yo ${name}! \uD83C\uDF89`,
        name => `What a week, ${name}! \uD83C\uDF89`,
    ];
    const HF_JUMP = [
        (label, delta, range) => `Incredible jump in ${label}, ${delta}! (${range}) That kind of growth stands out.`,
        (label, delta, range) => `You moved ${label} in a big way this week, ${delta}! (${range}) That's impressive.`,
        (label, delta, range) => `${label} took a huge leap, ${delta}! (${range}) Love to see it.`,
        (label, delta, range) => `The progress on ${label} is awesome, ${delta}! (${range}) Keep that energy.`,
    ];
    const HF_TWO_WINS = [
        (l1, v1, l2, v2) => `Your ${l1} at ${v1} and ${l2} at ${v2} were outstanding!`,
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2}? Absolutely killing it!`,
        (l1, v1, l2, v2) => `Crushed it on ${l1} (${v1}) and ${l2} (${v2}) this week!`,
    ];
    const HF_ONE_WIN = [
        (label, val) => `Your ${label} at ${val} was outstanding!`,
        (label, val) => `${label} at ${val}? That's what I'm talking about!`,
        (label, val) => `Killed it on ${label} at ${val} this week!`,
    ];
    const HF_NO_WINS = [
        'I wanted to recognize your effort this week. You showed up and put in the work, and that matters.',
        'Just want you to know I see the grind. Keep at it.',
        'Appreciate the effort you put in this week. It doesn\'t go unnoticed.',
    ];
    const HF_EXTRAS = [
        extras => `On top of that, ${extras}... you're on a roll!`,
        extras => `And ${extras} too? You're firing on all cylinders.`,
        extras => `Plus ${extras}. Just an all-around great week.`,
        extras => `Not to mention ${extras}. Seriously impressive.`,
    ];
    const HF_CONSISTENCY = [
        (on, total) => `${on} out of ${total} metrics hitting target, that's consistency right there.`,
        (on, total) => `${on} of ${total} metrics on target. That's not luck, that's discipline.`,
        (on, total) => `Hitting target on ${on} out of ${total} metrics. Consistency is your thing.`,
    ];
    const HF_CLOSERS = [
        'Proud of you. Enjoy your weekend!',
        'Have a great weekend. You earned it!',
        'Enjoy the weekend, you deserve it!',
        'Great week. Go relax, you\'ve earned it!',
        'Awesome job. Have a good one!',
    ];
    // Monthly review phrases
    const MO_GREETINGS = [
        (name, month) => `Hey ${name}! Here's your ${month} recap.`,
        (name, month) => `${name}! Let's look at how ${month} went.`,
        (name, month) => `Hey ${name}, wrapping up ${month} for you.`,
        (name, month) => `${name}, your ${month} numbers are in. Let's talk about it.`,
    ];
    const MO_JUMP = [
        (label, delta, range) => `Big month for ${label}, ${delta}! (${range})`,
        (label, delta, range) => `${label} moved nicely this month, ${delta}. (${range})`,
        (label, delta, range) => `Standout improvement: ${label} at ${delta}. (${range})`,
    ];
    const MO_TWO_WINS = [
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2} were strong all month.`,
        (l1, v1, l2, v2) => `Consistently solid on ${l1} (${v1}) and ${l2} (${v2}).`,
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2}? Month-long wins right there.`,
    ];
    const MO_ONE_WIN = [
        (label, val) => `${label} at ${val} was a highlight for the month.`,
        (label, val) => `Really solid month on ${label} at ${val}.`,
    ];
    const MO_NO_WINS = [
        'This month was a grind but I see the effort.',
        'Not the month we wanted, but we\'re going to build on it.',
        'Tough month, but we\'ve got a clean slate ahead.',
    ];
    const MO_FOCUS = [
        (label, val, target) => `Heading into next month, let's target ${label} (${val} vs goal of ${target}).`,
        (label, val, target) => `For next month, the priority is ${label} (sitting at ${val}, target ${target}).`,
        (label, val, target) => `Main focus going forward: ${label} at ${val}, we need ${target}.`,
    ];
    const MO_CONSISTENCY = [
        (on, total) => `You hit target on ${on} of ${total} metrics for the month.`,
        (on, total) => `${on} out of ${total} metrics at or above target this month.`,
    ];
    const MO_CLOSERS = [
        'Let\'s carry this into next month. I\'m here if you want to go over anything.',
        'Solid month overall. Let me know if you want to sit down and talk through it.',
        'Good work this month. Let\'s keep building.',
        'On to the next one. Reach out if you need anything.',
    ];
    const QTR_GREETINGS = [
        (name, quarter) => `Hey ${name}! Here\'s your ${quarter} recap.`,
        (name, quarter) => `${name}, let\'s look at how ${quarter} shaped up.`,
        (name, quarter) => `Hey ${name}, wrapping up ${quarter} for you.`,
        (name, quarter) => `${name}, your ${quarter} numbers are in. Let\'s talk about it.`,
    ];
    const QTR_JUMP = [
        (label, delta, range) => `Big quarter for ${label}, ${delta}! (${range})`,
        (label, delta, range) => `${label} moved nicely this quarter, ${delta}. (${range})`,
        (label, delta, range) => `Standout improvement: ${label} at ${delta}. (${range})`,
    ];
    const QTR_TWO_WINS = [
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2} were strong all quarter.`,
        (l1, v1, l2, v2) => `Consistently solid on ${l1} (${v1}) and ${l2} (${v2}).`,
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2}? Quarter-long wins right there.`,
    ];
    const QTR_ONE_WIN = [
        (label, val) => `${label} at ${val} was a highlight for the quarter.`,
        (label, val) => `Really solid quarter on ${label} at ${val}.`,
    ];
    const QTR_NO_WINS = [
        'This quarter was a grind but I see the effort.',
        'Not the quarter we wanted, but we\'re going to build on it.',
        'Tough quarter, but we\'ve got a clean slate ahead.',
    ];
    const QTR_FOCUS = [
        (label, val, target) => `Heading into next quarter, let\'s target ${label} (${val} vs goal of ${target}).`,
        (label, val, target) => `For next quarter, the priority is ${label} (sitting at ${val}, target ${target}).`,
        (label, val, target) => `Main focus going forward: ${label} at ${val}, we need ${target}.`,
    ];
    const QTR_CONSISTENCY = [
        (on, total) => `You hit target on ${on} of ${total} metrics for the quarter.`,
        (on, total) => `${on} out of ${total} metrics at or above target this quarter.`,
    ];
    const QTR_CLOSERS = [
        'Let\'s carry this into next quarter. I\'m here if you want to go over anything.',
        'Solid quarter overall. Let me know if you want to sit down and talk through it.',
        'Good work this quarter. Let\'s keep building.',
        'On to the next one. Reach out if you need anything.',
    ];

    // --- Data helpers ---

    function getAllSortedKeys() {
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        return Object.keys(weekly).filter(k => {
            const p = weekly[k];
            const pt = p?.metadata?.periodType;
            return !pt || pt === 'week' || pt === 'daily';
        }).sort();
    }

    function getPeriodData(weekKey) {
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        return weekly[weekKey] || null;
    }

    function getPeriodKeys(periodType) {
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        if (periodType === 'week') return getAllSortedKeys();
        return Object.keys(weekly)
            .filter(k => weekly[k]?.metadata?.periodType === periodType)
            .sort();
    }

    function loadPulseSelection() {
        try {
            const raw = localStorage.getItem(PULSE_SELECTION_STORAGE_KEY);
            if (!raw) return { periodType: 'week', periodKey: null };
            const parsed = JSON.parse(raw);
            return {
                periodType: ['week', 'month', 'quarter'].includes(parsed?.periodType) ? parsed.periodType : 'week',
                periodKey: parsed?.periodKey || null
            };
        } catch (e) {
            return { periodType: 'week', periodKey: null };
        }
    }

    function savePulseSelection(selection) {
        try {
            localStorage.setItem(PULSE_SELECTION_STORAGE_KEY, JSON.stringify({
                periodType: selection?.periodType || 'week',
                periodKey: selection?.periodKey || null
            }));
        } catch (e) { /* ignore storage failure */ }
    }

    function getMonthName(weekKey) {
        const period = getPeriodData(weekKey);
        const meta = period?.metadata?.endDate;
        const d = meta ? new Date(meta + 'T00:00:00') : getPeriodEndDate(weekKey);
        return d.toLocaleString('default', { month: 'long', year: 'numeric' });
    }

    function getQuarterName(weekKey) {
        const period = getPeriodData(weekKey);
        if (period?.metadata?.label) return period.metadata.label;
        const meta = period?.metadata?.endDate;
        const d = meta ? new Date(meta + 'T00:00:00') : getPeriodEndDate(weekKey);
        const quarter = Math.floor(d.getMonth() / 3) + 1;
        return `Q${quarter} ${d.getFullYear()}`;
    }

    function getPeriodDisplayLabel(periodType, periodKey) {
        if (!periodKey) return '';
        if (periodType === 'month') return getMonthName(periodKey);
        if (periodType === 'quarter') return getQuarterName(periodKey);
        return getEndDateLabel(periodKey, getPeriodData(periodKey));
    }

    function getPeriodContextLabel(periodType) {
        if (periodType === 'month') return 'this month';
        if (periodType === 'quarter') return 'this quarter';
        return 'this week';
    }

    function getReviewButtonLabel(periodType) {
        if (periodType === 'quarter') return '📈 Quarterly Review';
        if (periodType === 'month') return '📅 Monthly Review';
        return '💬 Check-in';
    }

    function getReviewMessageType(periodType) {
        if (periodType === 'quarter') return 'quarterly';
        if (periodType === 'month') return 'monthly';
        return 'checkin';
    }

    function getPeriodEndDate(weekKey) {
        const period = getPeriodData(weekKey);
        const meta = period?.metadata?.endDate;
        if (meta) return new Date(meta + 'T00:00:00');
        const parts = weekKey.split('|');
        return new Date((parts[1] || parts[0]) + 'T00:00:00');
    }

    function getEndDateLabel(weekKey, period) {
        const meta = period?.metadata?.endDate;
        if (meta && typeof formatDateMMDDYYYY === 'function') return formatDateMMDDYYYY(meta);
        const parts = weekKey.split('|');
        const raw = parts[1] || parts[0];
        return typeof formatDateMMDDYYYY === 'function' ? formatDateMMDDYYYY(raw) : raw;
    }

    function getFilteredEmployees(period) {
        if (!period?.employees) return [];
        const ctx = typeof getTeamSelectionContext === 'function' ? getTeamSelectionContext() : null;
        return period.employees
            .filter(emp => emp?.name)
            .filter(emp => typeof isAssociateIncludedByTeamFilter === 'function'
                ? isAssociateIncludedByTeamFilter(emp.name, ctx)
                : true)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    // Find the recent window of uploads: latest key + the earliest key
    // within the trailing 7 calendar days (the "work week" window).
    // Returns { latestKey, baselineKey, allRecentKeys }
    function getWeekWindow(selectedLatestKey) {
        const allKeys = getAllSortedKeys();
        if (!allKeys.length) return null;

        const latestKey = selectedLatestKey && allKeys.includes(selectedLatestKey)
            ? selectedLatestKey
            : allKeys[allKeys.length - 1];
        const latestDate = getPeriodEndDate(latestKey);

        // Look back up to 7 calendar days for the baseline
        const cutoff = new Date(latestDate);
        cutoff.setDate(cutoff.getDate() - 7);

        const recentKeys = allKeys.filter(k => {
            const d = getPeriodEndDate(k);
            return d >= cutoff && d <= latestDate;
        });

        // Baseline = earliest in the window
        const baselineKey = recentKeys.length > 1 ? recentKeys[0] : null;

        return { latestKey, baselineKey, allRecentKeys: recentKeys };
    }

    function getPeriodWindow(periodType, selectedLatestKey) {
        if (periodType === 'week') return getWeekWindow(selectedLatestKey);

        const keys = getPeriodKeys(periodType);
        if (!keys.length) return null;

        const latestKey = selectedLatestKey && keys.includes(selectedLatestKey)
            ? selectedLatestKey
            : keys[keys.length - 1];
        const idx = keys.indexOf(latestKey);
        const baselineKey = idx > 0 ? keys[idx - 1] : null;
        return { latestKey, baselineKey, allRecentKeys: baselineKey ? [baselineKey, latestKey] : [latestKey] };
    }

    // Calculate per-metric deltas between baseline and latest for one employee
    // Skip comparison if baseline had too few calls (employee was likely absent)
    const MIN_BASELINE_CALLS = 20;

    function calcWeekDeltas(empName, baselineKey, latestKey) {
        const basePeriod = getPeriodData(baselineKey);
        const latestPeriod = getPeriodData(latestKey);
        const baseEmp = basePeriod?.employees?.find(e => e.name === empName);
        const latestEmp = latestPeriod?.employees?.find(e => e.name === empName);
        if (!baseEmp || !latestEmp) return [];

        // If baseline had barely any calls, the data is noise
        const baseCalls = parseInt(baseEmp.totalCalls, 10);
        if (!Number.isFinite(baseCalls) || baseCalls < MIN_BASELINE_CALLS) return [];

        const registry = typeof METRICS_REGISTRY !== 'undefined' ? METRICS_REGISTRY : {};
        const deltas = [];

        Object.keys(registry).filter(k => !PULSE_EXCLUDED_METRICS.includes(k)).forEach(metricKey => {
            const baseVal = parseFloat(baseEmp[metricKey]);
            const latestVal = parseFloat(latestEmp[metricKey]);
            if (!Number.isFinite(baseVal) || !Number.isFinite(latestVal)) return;

            const delta = typeof metricDelta === 'function'
                ? metricDelta(metricKey, latestVal, baseVal)
                : latestVal - baseVal;

            deltas.push({
                metricKey,
                label: registry[metricKey]?.label || metricKey,
                baseValue: baseVal,
                latestValue: latestVal,
                delta,
                absDelta: Math.abs(delta)
            });
        });

        return deltas;
    }

    // Find the single biggest positive jump for an employee
    function getBiggestJump(deltas) {
        const improvements = deltas.filter(d => d.delta > 0);
        if (!improvements.length) return null;
        return improvements.reduce((best, d) => d.delta > best.delta ? d : best);
    }

    // --- Analysis (reuses existing analyzeTrendMetrics for current snapshot) ---

    function analyzeCurrentSnapshot(emp, centerAvgs, weekKey) {
        const analyzeFn = window.DevCoachModules?.metricTrends?.analyzeTrendMetrics
            || window.analyzeTrendMetrics;
        if (!analyzeFn) return null;

        // Get previous period for trend direction
        let prevEmp = null;
        const keys = typeof getWeeklyKeysSorted === 'function' ? getWeeklyKeysSorted() : [];
        const idx = keys.indexOf(weekKey);
        if (idx > 0) {
            const prevPeriod = getPeriodData(keys[idx - 1]);
            prevEmp = prevPeriod?.employees?.find(e => e.name === emp.name) || null;
        }

        return analyzeFn(emp, centerAvgs, null, prevEmp, {
            employeeName: emp.name,
            weekKey: weekKey,
            periodType: 'week'
        });
    }

    function pickFocalPoint(allMetrics) {
        const needsFocus = allMetrics
            .filter(m => m.classification === 'Needs Focus')
            .sort((a, b) => {
                const riskA = (a.gapFromTarget || 0) + (a.trendDirection === 'declining' ? 2 : 0);
                const riskB = (b.gapFromTarget || 0) + (b.trendDirection === 'declining' ? 2 : 0);
                return riskB - riskA;
            });
        if (needsFocus.length) return needsFocus[0];

        const watchArea = allMetrics
            .filter(m => m.classification === 'Watch Area')
            .sort((a, b) => (b.gapFromTarget || 0) - (a.gapFromTarget || 0));
        if (watchArea.length) return watchArea[0];

        return null;
    }

    function getStatusBadge(allMetrics) {
        const needsFocus = allMetrics.filter(m => m.classification === 'Needs Focus').length;
        const exceeding = allMetrics.filter(m => m.classification === 'Exceeding Expectation').length;
        const onTrack = allMetrics.filter(m => m.classification === 'On Track').length;

        if (needsFocus >= 3) return { label: 'Needs Support', color: '#e53935', bg: '#ffebee', icon: '\uD83D\uDD34' };
        if (needsFocus >= 1) return { label: 'Watch', color: '#fb8c00', bg: '#fff3e0', icon: '\uD83D\uDFE1' };
        if (exceeding >= 3) return { label: 'Crushing It', color: '#2e7d32', bg: '#e8f5e9', icon: '\uD83D\uDFE2' };
        if (onTrack + exceeding >= allMetrics.length * 0.7) return { label: 'Solid', color: '#1e88e5', bg: '#e3f2fd', icon: '\uD83D\uDD35' };
        return { label: 'Steady', color: '#78909c', bg: '#eceff1', icon: '\u26AA' };
    }

    // --- Formatting helpers ---

    function fmtVal(metricKeyOrObj, value) {
        const key = typeof metricKeyOrObj === 'object' ? metricKeyOrObj.metricKey : metricKeyOrObj;
        const val = value !== undefined ? value : (typeof metricKeyOrObj === 'object' ? metricKeyOrObj.employeeValue : 0);
        if (typeof formatMetricDisplay === 'function') return formatMetricDisplay(key, val);
        const unit = window.METRICS_REGISTRY?.[key]?.unit || '';
        if (unit === '#') return Math.round(val).toString();
        if (unit === 'sec') return Math.round(val) + 's';
        if (unit === 'hrs') return val.toFixed(1) + ' hrs';
        return val.toFixed(1) + '%';
    }

    function fmtTarget(metric) {
        if (typeof formatMetricDisplay === 'function') return formatMetricDisplay(metric.metricKey, metric.target);
        return metric.target + '';
    }

    function fmtRange(metricKey, baseVal, latestVal) {
        const reverse = typeof isReverseMetric === 'function' && isReverseMetric(metricKey);
        if (reverse) return `down from ${fmtVal(metricKey, baseVal)} to ${fmtVal(metricKey, latestVal)}`;
        return `${fmtVal(metricKey, baseVal)} \u2192 ${fmtVal(metricKey, latestVal)}`;
    }

    function fmtDelta(metricKey, delta) {
        const unit = window.METRICS_REGISTRY?.[metricKey]?.unit || '';
        const reverse = typeof isReverseMetric === 'function' && isReverseMetric(metricKey);
        const displayDelta = reverse ? -delta : delta;
        const sign = displayDelta > 0 ? '+' : '';
        if (unit === '#') return sign + Math.round(displayDelta).toString();
        if (unit === 'sec') return sign + Math.round(displayDelta) + 's';
        if (unit === 'hrs') return sign + displayDelta.toFixed(1) + ' hrs';
        return sign + displayDelta.toFixed(1) + '%';
    }

    // --- Card rendering ---

    function buildEmployeeCard(emp, analysis, weekDeltas, biggestJump, options = {}) {
        const allMetrics = (analysis.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));
        const badge = getStatusBadge(allMetrics);
        const focalPoint = pickFocalPoint(allMetrics);
        const deltaContextLabel = options.deltaContextLabel || 'this week';
        const periodType = options.periodType || 'week';

        const wins = allMetrics
            .filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track')
            .sort((a, b) => {
                if (a.classification !== b.classification) return a.classification === 'Exceeding Expectation' ? -1 : 1;
                const mA = a.targetType === 'min' ? a.employeeValue - a.target : a.target - a.employeeValue;
                const mB = b.targetType === 'min' ? b.employeeValue - b.target : b.target - b.employeeValue;
                return mB - mA;
            })
            .slice(0, 2);

        const opportunities = allMetrics
            .filter(m => m.classification === 'Needs Focus' || m.classification === 'Watch Area')
            .sort((a, b) => (b.gapFromTarget || 0) - (a.gapFromTarget || 0))
            .slice(0, 2);

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(emp.name)
            : emp.name.split(/[\s,]+/)[0];

        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => String(s));

        const trendArrow = (dir, metricKey) => {
            const reverse = typeof isReverseMetric === 'function' && isReverseMetric(metricKey);
            if (dir === 'improving') return `<span style="color:#2e7d32;" title="Improving">${reverse ? '\u25BC' : '\u25B2'}</span>`;
            if (dir === 'declining') return `<span style="color:#e53935;" title="Declining">${reverse ? '\u25B2' : '\u25BC'}</span>`;
            return '<span style="color:#9e9e9e;" title="Stable">\u2015</span>';
        };

        // Wins section
        let winsHtml = '';
        if (wins.length) {
            winsHtml = wins.map(m => {
                // Find this metric's week delta if available
                const wd = weekDeltas.find(d => d.metricKey === m.metricKey);
                const deltaTag = wd && wd.delta > 0
                    ? ` <span style="color:#1b5e20; font-size:0.85em;">(${fmtDelta(m.metricKey, wd.delta)} ${deltaContextLabel})</span>`
                    : '';
                return `<div style="font-size:0.85em; color:#2e7d32; padding:2px 0;">` +
                    `${trendArrow(m.trendDirection, m.metricKey)} ${escapeHtml(m.label)}: <strong>${fmtVal(m)}</strong>${deltaTag}</div>`;
            }).join('');
        } else {
            winsHtml = '<div style="font-size:0.85em; color:#999;">No metrics at target yet</div>';
        }

        // Opportunities section
        let oppsHtml = '';
        if (opportunities.length) {
            oppsHtml = opportunities.map(m => {
                const wd = weekDeltas.find(d => d.metricKey === m.metricKey);
                const deltaTag = wd && wd.delta !== 0
                    ? ` <span style="color:${wd.delta > 0 ? '#1b5e20' : '#b71c1c'}; font-size:0.85em;">(${fmtDelta(m.metricKey, wd.delta)})</span>`
                    : '';
                return `<div style="font-size:0.85em; color:#c62828; padding:2px 0;">` +
                    `${trendArrow(m.trendDirection, m.metricKey)} ${escapeHtml(m.label)}: <strong>${fmtVal(m)}</strong> ` +
                    `<span style="color:#999;">(target: ${fmtTarget(m)})</span>${deltaTag}</div>`;
            }).join('');
        } else {
            oppsHtml = '<div style="font-size:0.85em; color:#999;">All metrics on track!</div>';
        }

        // Biggest improvement callout (only if we have multi-day data)
        let jumpHtml = '';
        if (biggestJump && biggestJump.delta > 0) {
            jumpHtml = `<div style="padding:6px 10px; background:#e8f5e9; border-radius:4px; font-size:0.83em; color:#1b5e20; border-left:3px solid #4caf50;">` +
                `\uD83D\uDE80 <strong>Biggest improvement:</strong> ${escapeHtml(biggestJump.label)} ${fmtDelta(biggestJump.metricKey, biggestJump.delta)} ${deltaContextLabel} ` +
                `(${fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue)})</div>`;
        }

        // Focal point
        let focalHtml = '';
        if (focalPoint) {
            const dirLabel = focalPoint.trendDirection === 'declining' ? ' and declining' : '';
            focalHtml = `<div style="padding:8px; background:#fff3e0; border-radius:4px; border-left:3px solid #ff9800; font-size:0.85em;">` +
                `<strong>\uD83C\uDFAF Focus:</strong> ${escapeHtml(focalPoint.label)} \u2014 currently ${fmtVal(focalPoint)} vs target ${fmtTarget(focalPoint)}${dirLabel}</div>`;
        } else {
            focalHtml = `<div style="padding:8px; background:#e8f5e9; border-radius:4px; border-left:3px solid #4caf50; font-size:0.85em;">` +
                `<strong>\u2705 On track!</strong> Keep up the consistency.</div>`;
        }

        return `<div class="pulse-card" data-employee="${escapeHtml(emp.name)}" style="background:#fff; border-radius:8px; border:1px solid #e0e0e0; padding:16px; display:flex; flex-direction:column; gap:10px; transition: box-shadow 0.2s;">` +
            `<div style="display:flex; justify-content:space-between; align-items:center;">` +
                `<div style="font-weight:700; font-size:1.05em; color:#333;">${escapeHtml(firstName)}</div>` +
                `<div style="font-size:0.8em; font-weight:600; padding:3px 10px; border-radius:12px; color:${badge.color}; background:${badge.bg};">${badge.icon} ${badge.label}</div>` +
            `</div>` +
            jumpHtml +
            `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">` +
                `<div><div style="font-weight:600; font-size:0.8em; color:#666; margin-bottom:4px;">Wins</div>${winsHtml}</div>` +
                `<div><div style="font-weight:600; font-size:0.8em; color:#666; margin-bottom:4px;">Opportunities</div>${oppsHtml}</div>` +
            `</div>` +
            focalHtml +
            `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:auto;">` +
                (periodType === 'week'
                    ? `<button type="button" class="pulse-checkin-btn" data-employee="${escapeHtml(emp.name)}" ` +
                        `style="flex:1; min-width:0; background:linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">\uD83D\uDCAC Check-in</button>` +
                      `<button type="button" class="pulse-highfive-btn" data-employee="${escapeHtml(emp.name)}" ` +
                        `style="flex:1; min-width:0; background:linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">\uD83C\uDF89 High-Five</button>`
                    : `<button type="button" class="pulse-review-btn" data-employee="${escapeHtml(emp.name)}" ` +
                        `style="flex-basis:100%; background:linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">${getReviewButtonLabel(periodType)}</button>`) +
            `</div>` +
        `</div>`;
    }

    // --- Check-in message generation ---

    async function generateCheckinMessage(employeeName, latestKey, baselineKey) {
        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const endDate = getEndDateLabel(latestKey, period);

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        if (!analysis) return null;

        const allMetrics = (analysis.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));

        // Week trajectory
        const weekDeltas = baselineKey ? calcWeekDeltas(employeeName, baselineKey, latestKey) : [];
        const biggestJump = getBiggestJump(weekDeltas);

        const wins = allMetrics
            .filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track')
            .sort((a, b) => {
                if (a.classification !== b.classification) return a.classification === 'Exceeding Expectation' ? -1 : 1;
                const mA = a.targetType === 'min' ? a.employeeValue - a.target : a.target - a.employeeValue;
                const mB = b.targetType === 'min' ? b.employeeValue - b.target : b.target - b.employeeValue;
                return mB - mA;
            })
            .slice(0, 2);

        const focalPoint = pickFocalPoint(allMetrics);

        // Build praise — lead with biggest jump if we have trajectory data
        let praiseText = '';
        if (biggestJump && biggestJump.delta > 0) {
            praiseText = pick(JUMP_INTROS)(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue));
            if (wins.length > 0 && wins[0].metricKey !== biggestJump.metricKey) {
                praiseText += ` ${pick(PLUS_SOLID)(wins[0].label, fmtVal(wins[0]))}`;
            }
        } else if (wins.length >= 2) {
            praiseText = pick(TWO_WINS)(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]));
        } else if (wins.length === 1) {
            praiseText = pick(ONE_WIN)(wins[0].label, fmtVal(wins[0]));
        } else {
            praiseText = pick(NO_WINS);
        }

        // Build focus with tip
        let focusText = '';
        if (focalPoint) {
            const metricKey = focalPoint.metricKey;
            let tipText = '';
            try {
                const allTips = typeof loadServerTips === 'function' ? await loadServerTips() : {};
                const metricTips = allTips[metricKey] || [];
                if (metricTips.length > 0) {
                    const tip = typeof selectSmartTip === 'function'
                        ? selectSmartTip({ employeeId: employeeName, metricKey, severity: 'medium', tips: metricTips })
                        : metricTips[Math.floor(Math.random() * metricTips.length)];
                    if (tip) tipText = tip;
                }
            } catch (e) { /* no tips */ }

            focusText = `\uD83C\uDFAF ${pick(FOCUS_INTROS)(focalPoint.label, fmtVal(focalPoint), fmtTarget(focalPoint))}`;
            if (tipText) {
                const cleanTip = tipText.replace(/^(Practice this|Try this|Tip|Focus on this)\s*:\s*/i, '').trim();
                focusText += ` \uD83D\uDCA1 ${cleanTip.charAt(0).toUpperCase() + cleanTip.slice(1)}`;
            }
        }

        let message = `${pick(GREETINGS)(firstName)} \uD83D\uDC4B ${pick(DATA_IN)(endDate)} ${praiseText}`;
        if (focusText) message += `\n\n${focusText}`;
        message += `\n\n${pick(CLOSERS)}`;

        return message;
    }

    // --- Weekend High-Five message generation ---

    async function generateHighFiveMessage(employeeName, latestKey, baselineKey) {
        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const endDate = getEndDateLabel(latestKey, period);

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        if (!analysis) return null;

        const allMetrics = (analysis.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));
        const weekDeltas = baselineKey ? calcWeekDeltas(employeeName, baselineKey, latestKey) : [];
        const biggestJump = getBiggestJump(weekDeltas);

        // Get all wins sorted by how far above target
        const wins = allMetrics
            .filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track')
            .sort((a, b) => {
                if (a.classification !== b.classification) return a.classification === 'Exceeding Expectation' ? -1 : 1;
                const mA = a.targetType === 'min' ? a.employeeValue - a.target : a.target - a.employeeValue;
                const mB = b.targetType === 'min' ? b.employeeValue - b.target : b.target - b.employeeValue;
                return mB - mA;
            });

        // Build the celebration — no coaching, no focus areas, pure praise
        let message = pick(HF_OPENERS)(firstName);

        if (biggestJump && biggestJump.delta > 0) {
            message += ` ${pick(HF_JUMP)(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue))} \uD83D\uDD25`;
        } else if (wins.length >= 2) {
            message += ` ${pick(HF_TWO_WINS)(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]))} \uD83D\uDD25\uD83D\uDCAA`;
        } else if (wins.length === 1) {
            message += ` ${pick(HF_ONE_WIN)(wins[0].label, fmtVal(wins[0]))} \uD83D\uDD25`;
        } else {
            message += ` ${pick(HF_NO_WINS)} \uD83D\uDCAA`;
        }

        // Add more wins if available
        if (wins.length > 2 && biggestJump) {
            const extraWins = wins.filter(w => w.metricKey !== biggestJump.metricKey).slice(0, 2);
            if (extraWins.length > 0) {
                const extras = extraWins.map(w => `${w.label} at ${fmtVal(w)}`).join(' and ');
                message += ` ${pick(HF_EXTRAS)(extras)}`;
            }
        }

        // Count how many metrics are on track
        const onTrackCount = allMetrics.filter(m => m.meetsTarget).length;
        if (onTrackCount >= allMetrics.length * 0.7 && allMetrics.length > 3) {
            message += `\n\n${pick(HF_CONSISTENCY)(onTrackCount, allMetrics.length)} \u2B50`;
        }

        message += `\n\n${pick(HF_CLOSERS)} \uD83D\uDE80`;

        return message;
    }

    // --- Monthly check-in message generation ---

    async function generateMonthlyCheckinMessage(employeeName, monthKey, prevMonthKey) {
        return generatePeriodReviewMessage(employeeName, monthKey, prevMonthKey, 'month');
    }

    async function generateQuarterlyCheckinMessage(employeeName, quarterKey, prevQuarterKey) {
        return generatePeriodReviewMessage(employeeName, quarterKey, prevQuarterKey, 'quarter');
    }

    async function generatePeriodReviewMessage(employeeName, periodKey, prevPeriodKey, periodType) {
        const period = getPeriodData(periodKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const periodName = periodType === 'quarter' ? getQuarterName(periodKey) : getMonthName(periodKey);
        const reviewCopy = periodType === 'quarter'
            ? {
                greetings: QTR_GREETINGS,
                jump: QTR_JUMP,
                twoWins: QTR_TWO_WINS,
                oneWin: QTR_ONE_WIN,
                noWins: QTR_NO_WINS,
                focus: QTR_FOCUS,
                consistency: QTR_CONSISTENCY,
                closers: QTR_CLOSERS
            }
            : {
                greetings: MO_GREETINGS,
                jump: MO_JUMP,
                twoWins: MO_TWO_WINS,
                oneWin: MO_ONE_WIN,
                noWins: MO_NO_WINS,
                focus: MO_FOCUS,
                consistency: MO_CONSISTENCY,
                closers: MO_CLOSERS
            };

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(periodKey) || {}
            : {};

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, periodKey);
        if (!analysis) return null;

        const allMetrics = (analysis.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));
        const periodDeltas = prevPeriodKey ? calcWeekDeltas(employeeName, prevPeriodKey, periodKey) : [];
        const biggestJump = getBiggestJump(periodDeltas);

        const wins = allMetrics
            .filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track')
            .sort((a, b) => {
                if (a.classification !== b.classification) return a.classification === 'Exceeding Expectation' ? -1 : 1;
                const mA = a.targetType === 'min' ? a.employeeValue - a.target : a.target - a.employeeValue;
                const mB = b.targetType === 'min' ? b.employeeValue - b.target : b.target - b.employeeValue;
                return mB - mA;
            })
            .slice(0, 3);

        const focalPoint = pickFocalPoint(allMetrics);

        let praiseText = '';
        if (biggestJump && biggestJump.delta > 0) {
            praiseText = pick(reviewCopy.jump)(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue));
            if (wins.length > 0 && wins[0].metricKey !== biggestJump.metricKey) {
                praiseText += ` ${pick(PLUS_SOLID)(wins[0].label, fmtVal(wins[0]))}`;
            }
        } else if (wins.length >= 2) {
            praiseText = pick(reviewCopy.twoWins)(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]));
        } else if (wins.length === 1) {
            praiseText = pick(reviewCopy.oneWin)(wins[0].label, fmtVal(wins[0]));
        } else {
            praiseText = pick(reviewCopy.noWins);
        }

        const onTrackCount = allMetrics.filter(m => m.meetsTarget).length;
        let consistencyText = '';
        if (allMetrics.length > 3) {
            consistencyText = pick(reviewCopy.consistency)(onTrackCount, allMetrics.length);
        }

        let focusText = '';
        if (focalPoint) {
            const metricKey = focalPoint.metricKey;
            let tipText = '';
            try {
                const allTips = typeof loadServerTips === 'function' ? await loadServerTips() : {};
                const metricTips = allTips[metricKey] || [];
                if (metricTips.length > 0) {
                    const tip = typeof selectSmartTip === 'function'
                        ? selectSmartTip({ employeeId: employeeName, metricKey, severity: 'medium', tips: metricTips })
                        : metricTips[Math.floor(Math.random() * metricTips.length)];
                    if (tip) tipText = tip;
                }
            } catch (e) { /* no tips */ }

            focusText = `🎯 ${pick(reviewCopy.focus)(focalPoint.label, fmtVal(focalPoint), fmtTarget(focalPoint))}`;
            if (tipText) {
                const cleanTip = tipText.replace(/^(Practice this|Try this|Tip|Focus on this)\s*:\s*/i, '').trim();
                focusText += ` 💡 ${cleanTip.charAt(0).toUpperCase() + cleanTip.slice(1)}`;
            }
        }

        let message = `${pick(reviewCopy.greetings)(firstName, periodName)} ${praiseText}`;
        if (consistencyText) message += `\n\n${consistencyText}`;
        if (focusText) message += `\n\n${focusText}`;
        message += `\n\n${pick(reviewCopy.closers)}`;

        return message;
    }

    // --- Summary bar ---

    function buildSummaryBar(cardData, numUploads, periodType, hasComparison) {
        const counts = { red: 0, yellow: 0, green: 0, blue: 0, gray: 0 };
        cardData.forEach(d => {
            const badge = getStatusBadge(d.analysis.allMetrics || []);
            if (badge.icon.includes('\uD83D\uDD34')) counts.red++;
            else if (badge.icon.includes('\uD83D\uDFE1')) counts.yellow++;
            else if (badge.icon.includes('\uD83D\uDFE2')) counts.green++;
            else if (badge.icon.includes('\uD83D\uDD35')) counts.blue++;
            else counts.gray++;
        });

        const uploadsNote = periodType === 'week'
            ? (numUploads > 1
                ? `<span style="color:#1a237e; font-weight:600;">${numUploads} uploads in selected week</span>`
                : '<span style="color:#999;">1 upload (no trajectory yet)</span>')
            : (hasComparison
                ? `<span style="color:#1a237e; font-weight:600;">Compared to previous ${periodType}</span>`
                : `<span style="color:#999;">No previous ${periodType} to compare</span>`);

        return `<div style="display:flex; gap:16px; flex-wrap:wrap; padding:14px 18px; background:linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); border-radius:8px; margin-bottom:16px; align-items:center;">` +
            `<div style="font-weight:700; font-size:1em; color:#333;">Team Pulse</div>` +
            `<div style="display:flex; gap:12px; flex-wrap:wrap; font-size:0.9em;">` +
                (counts.red > 0 ? `<span style="color:#e53935; font-weight:600;">\uD83D\uDD34 ${counts.red} Needs Support</span>` : '') +
                (counts.yellow > 0 ? `<span style="color:#fb8c00; font-weight:600;">\uD83D\uDFE1 ${counts.yellow} Watch</span>` : '') +
                (counts.blue > 0 ? `<span style="color:#1e88e5; font-weight:600;">\uD83D\uDD35 ${counts.blue} Solid</span>` : '') +
                (counts.green > 0 ? `<span style="color:#2e7d32; font-weight:600;">\uD83D\uDFE2 ${counts.green} Crushing It</span>` : '') +
                (counts.gray > 0 ? `<span style="color:#78909c; font-weight:600;">\u26AA ${counts.gray} Steady</span>` : '') +
            `</div>` +
            `<div style="margin-left:auto; font-size:0.85em; color:#666;">${cardData.length} associates \u2022 ${uploadsNote}</div>` +
        `</div>`;
    }

    // --- Modal ---

    function showCheckinModal(employeeName, message, latestKey, baselineKey, messageType) {
        const existing = document.getElementById('pulseCheckinModal');
        if (existing) existing.remove();

        const isHighFive = messageType === 'highfive';
        const isMonthly = messageType === 'monthly';
        const isQuarterly = messageType === 'quarterly';
        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

        const titleIcon = isQuarterly ? '\uD83D\uDCC8' : isMonthly ? '\uD83D\uDCC5' : isHighFive ? '\uD83C\uDF89' : '\uD83D\uDCAC';
        const titleText = isQuarterly ? `Quarterly Review for ${escapeHtml(firstName)}` : isMonthly ? `Monthly Review for ${escapeHtml(firstName)}` : isHighFive ? `Weekend High-Five for ${escapeHtml(firstName)}` : `Check-in for ${escapeHtml(firstName)}`;
        const copyGradient = isQuarterly
            ? 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)'
            : isMonthly
            ? 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)'
            : isHighFive
            ? 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)'
            : 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)';

        const overlay = document.createElement('div');
        overlay.id = 'pulseCheckinModal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';

        overlay.innerHTML = `<div style="background:white; border-radius:12px; max-width:560px; width:100%; max-height:80vh; overflow-y:auto; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,0.3);">` +
            `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">` +
                `<h3 style="margin:0; color:#1a237e;">${titleIcon} ${titleText}</h3>` +
                `<button id="pulseCheckinClose" style="background:none; border:none; font-size:1.4em; cursor:pointer; color:#999; padding:4px 8px;">\u2715</button>` +
            `</div>` +
            `<textarea id="pulseCheckinText" style="width:100%; height:180px; padding:14px; border:1px solid #ddd; border-radius:6px; font-size:0.95em; color:#333; background:#f9f9f9; resize:vertical; font-family:inherit;">${escapeHtml(message)}</textarea>` +
            `<div style="display:flex; gap:10px; margin-top:14px;">` +
                `<button id="pulseCheckinCopy" style="flex:1; background:${copyGradient}; color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">\uD83D\uDCCB Copy to Clipboard</button>` +
                `<button id="pulseCheckinRegenerate" style="flex:1; background:#f5f5f5; color:#333; border:1px solid #ddd; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">\uD83D\uDD04 Regenerate</button>` +
            `</div>` +
        `</div>`;

        document.body.appendChild(overlay);

        document.getElementById('pulseCheckinClose').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        document.getElementById('pulseCheckinCopy').addEventListener('click', async () => {
            const textarea = document.getElementById('pulseCheckinText');
            try {
                await navigator.clipboard.writeText(textarea.value);
                if (typeof showToast === 'function') showToast('Copied!', 2000);
            } catch (e) { textarea.select(); }
        });

        const generateFn = isQuarterly ? generateQuarterlyCheckinMessage : isMonthly ? generateMonthlyCheckinMessage : isHighFive ? generateHighFiveMessage : generateCheckinMessage;
        document.getElementById('pulseCheckinRegenerate').addEventListener('click', async () => {
            const regenBtn = document.getElementById('pulseCheckinRegenerate');
            regenBtn.textContent = '\u23F3 Regenerating...';
            regenBtn.disabled = true;
            try {
                const newMessage = await generateFn(employeeName, latestKey, baselineKey);
                if (newMessage) {
                    document.getElementById('pulseCheckinText').value = newMessage;
                    try {
                        await navigator.clipboard.writeText(newMessage);
                        if (typeof showToast === 'function') showToast('New check-in copied!', 2000);
                    } catch (e) { /* ok */ }
                }
            } finally {
                regenBtn.textContent = '\uD83D\uDD04 Regenerate';
                regenBtn.disabled = false;
            }
        });
    }

    // --- Main render ---

    function renderMorningPulse(container) {
        if (!container) return;

        const selection = loadPulseSelection();
        const periodType = selection.periodType || 'week';
        const availableKeys = getPeriodKeys(periodType);
        const window_ = getPeriodWindow(periodType, selection.periodKey);
        const selectedKey = window_?.latestKey || null;

        if (selection.periodKey !== selectedKey) {
            savePulseSelection({ periodType, periodKey: selectedKey });
        }

        const optionsHtml = availableKeys.length
            ? availableKeys.slice().reverse().map(key => {
                const selectedAttr = key === selectedKey ? ' selected' : '';
                return `<option value="${key}"${selectedAttr}>${getPeriodDisplayLabel(periodType, key)}</option>`;
            }).join('')
            : '<option value="">No periods available</option>';

        const controlsHtml = `<div style="margin-bottom:16px; padding:16px; background:#fff; border:1px solid #e0e7ff; border-radius:10px; display:grid; grid-template-columns:180px 1fr; gap:12px; align-items:end;">` +
            `<div>` +
                `<label for="pulsePeriodTypeSelect" style="display:block; font-size:0.85em; font-weight:600; color:#475569; margin-bottom:6px;">Period Type</label>` +
                `<select id="pulsePeriodTypeSelect" style="width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:0.95em;">` +
                    `<option value="week"${periodType === 'week' ? ' selected' : ''}>Week</option>` +
                    `<option value="month"${periodType === 'month' ? ' selected' : ''}>Month</option>` +
                    `<option value="quarter"${periodType === 'quarter' ? ' selected' : ''}>Quarter</option>` +
                `</select>` +
            `</div>` +
            `<div>` +
                `<label for="pulsePeriodKeySelect" style="display:block; font-size:0.85em; font-weight:600; color:#475569; margin-bottom:6px;">Selected ${periodType}</label>` +
                `<select id="pulsePeriodKeySelect" style="width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:0.95em;"${availableKeys.length ? '' : ' disabled'}>${optionsHtml}</select>` +
            `</div>` +
        `</div>`;

        if (!window_) {
            container.innerHTML = controlsHtml + '<div style="padding:20px; color:#666; text-align:center;">No data available for that period type yet.</div>';
            bindPulseControls(container);
            return;
        }

        const { latestKey, baselineKey, allRecentKeys } = window_;
        const period = getPeriodData(latestKey);
        if (!period) {
            container.innerHTML = controlsHtml + '<div style="padding:20px; color:#666; text-align:center;">Could not load period data.</div>';
            bindPulseControls(container);
            return;
        }

        const endDate = getPeriodDisplayLabel(periodType, latestKey);
        const employees = getFilteredEmployees(period);

        if (!employees.length) {
            container.innerHTML = controlsHtml + '<div style="padding:20px; color:#666; text-align:center;">No team members found for the selected period.</div>';
            bindPulseControls(container);
            return;
        }

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        // Build card data for each employee
        const cardData = [];
        employees.forEach(emp => {
            const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
            if (!analysis || !analysis.allMetrics?.length) return;

            const weekDeltas = baselineKey ? calcWeekDeltas(emp.name, baselineKey, latestKey) : [];
            const biggestJump = getBiggestJump(weekDeltas);

            cardData.push({ emp, analysis, weekDeltas, biggestJump });
        });

        // Sort: needs support first, then watch, then others
        const badgePriority = { '\uD83D\uDD34': 0, '\uD83D\uDFE1': 1, '\u26AA': 2, '\uD83D\uDD35': 3, '\uD83D\uDFE2': 4 };
        cardData.sort((a, b) => {
            const ba = getStatusBadge(a.analysis.allMetrics || []);
            const bb = getStatusBadge(b.analysis.allMetrics || []);
            const pa = Object.entries(badgePriority).find(([k]) => ba.icon.includes(k));
            const pb = Object.entries(badgePriority).find(([k]) => bb.icon.includes(k));
            return (pa ? pa[1] : 5) - (pb ? pb[1] : 5);
        });

        let html = '';

        // Header
        const baseDate = baselineKey ? getPeriodDisplayLabel(periodType, baselineKey) : null;
        const rangeText = baseDate && baseDate !== endDate ? `${baseDate} \u2013 ${endDate}` : endDate;
        const pulseDescription = periodType === 'week'
            ? 'Your team\'s weekly trajectory at a glance. Use "Check-in" for coaching or "High-Five" for a Friday shoutout.'
            : periodType === 'month'
            ? 'Your team\'s monthly snapshot. Use each card to generate an individual monthly review.'
            : 'Your team\'s quarterly snapshot. Use each card to generate an individual quarterly review.';
        html += controlsHtml + `<div style="margin-bottom:16px;">` +
            `<h3 style="color:#1a237e; margin:0 0 6px 0;">\u2600\uFE0F Morning Pulse \u2014 ${rangeText}</h3>` +
            `<p style="color:#666; margin:0; font-size:0.9em;">${pulseDescription}</p>` +
        `</div>`;

        // Summary bar
        html += buildSummaryBar(cardData, allRecentKeys.length, periodType, Boolean(baselineKey));

        // Card grid
        html += `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">`;
        cardData.forEach(d => {
            html += buildEmployeeCard(d.emp, d.analysis, d.weekDeltas, d.biggestJump, {
                periodType,
                deltaContextLabel: getPeriodContextLabel(periodType)
            });
        });
        html += `</div>`;

        container.innerHTML = html;
        bindPulseControls(container);

        // Bind check-in buttons
        container.querySelectorAll('.pulse-checkin-btn').forEach(btn => {
            btn.addEventListener('click', async function() {
                const empName = this.dataset.employee;
                const originalText = this.textContent;
                this.textContent = '\u23F3 Generating...';
                this.disabled = true;

                try {
                    const message = await generateCheckinMessage(empName, latestKey, baselineKey);
                    if (!message) {
                        if (typeof showToast === 'function') showToast('Could not generate check-in for ' + empName, 3000);
                        return;
                    }
                    showCheckinModal(empName, message, latestKey, baselineKey, 'checkin');

                    try {
                        await navigator.clipboard.writeText(message);
                        if (typeof showToast === 'function') showToast('Check-in copied to clipboard!', 3000);
                    } catch (e) { /* clipboard not available */ }
                } finally {
                    this.textContent = originalText;
                    this.disabled = false;
                }
            });
        });

        // Bind high-five buttons
        container.querySelectorAll('.pulse-highfive-btn').forEach(btn => {
            btn.addEventListener('click', async function() {
                const empName = this.dataset.employee;
                const originalText = this.textContent;
                this.textContent = '\u23F3 Generating...';
                this.disabled = true;

                try {
                    const message = await generateHighFiveMessage(empName, latestKey, baselineKey);
                    if (!message) {
                        if (typeof showToast === 'function') showToast('Could not generate high-five for ' + empName, 3000);
                        return;
                    }
                    showCheckinModal(empName, message, latestKey, baselineKey, 'highfive');

                    try {
                        await navigator.clipboard.writeText(message);
                        if (typeof showToast === 'function') showToast('High-five copied to clipboard!', 3000);
                    } catch (e) { /* clipboard not available */ }
                } finally {
                    this.textContent = originalText;
                    this.disabled = false;
                }
            });
        });

        // Bind month / quarter review buttons
        if (periodType !== 'week') {
            container.querySelectorAll('.pulse-review-btn').forEach(btn => {
                btn.addEventListener('click', async function() {
                    const empName = this.dataset.employee;
                    const originalText = this.textContent;
                    this.textContent = '\u23F3 Generating...';
                    this.disabled = true;

                    const generateFn = periodType === 'quarter' ? generateQuarterlyCheckinMessage : generateMonthlyCheckinMessage;
                    const messageType = getReviewMessageType(periodType);
                    const reviewLabel = periodType === 'quarter' ? 'quarterly review' : 'monthly review';

                    try {
                        const message = await generateFn(empName, latestKey, baselineKey);
                        if (!message) {
                            if (typeof showToast === 'function') showToast('Could not generate ' + reviewLabel + ' for ' + empName, 3000);
                            return;
                        }
                        showCheckinModal(empName, message, latestKey, baselineKey, messageType);

                        try {
                            await navigator.clipboard.writeText(message);
                            if (typeof showToast === 'function') showToast((periodType === 'quarter' ? 'Quarterly' : 'Monthly') + ' review copied to clipboard!', 3000);
                        } catch (e) { /* clipboard not available */ }
                    } finally {
                        this.textContent = originalText;
                        this.disabled = false;
                    }
                });
            });
        }
    }

    function bindPulseControls(container) {
        const typeSelect = container.querySelector('#pulsePeriodTypeSelect');
        const keySelect = container.querySelector('#pulsePeriodKeySelect');

        if (typeSelect) {
            typeSelect.addEventListener('change', function() {
                const nextType = this.value || 'week';
                const nextKeys = getPeriodKeys(nextType);
                savePulseSelection({
                    periodType: nextType,
                    periodKey: nextKeys.length ? nextKeys[nextKeys.length - 1] : null
                });
                renderMorningPulse(container);
            });
        }

        if (keySelect) {
            keySelect.addEventListener('change', function() {
                const current = loadPulseSelection();
                savePulseSelection({
                    periodType: current.periodType || 'week',
                    periodKey: this.value || null
                });
                renderMorningPulse(container);
            });
        }
    }

    // Initialize - called when the Morning Pulse tab is activated
    function initializeMorningPulse() {
        const container = document.getElementById('morningPulseContainer');
        renderMorningPulse(container);
    }

    // Export
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.morningPulse = {
        initializeMorningPulse,
        renderMorningPulse,
        generateCheckinMessage,
        generateHighFiveMessage,
        generateMonthlyCheckinMessage,
        generateQuarterlyCheckinMessage
    };
})();


