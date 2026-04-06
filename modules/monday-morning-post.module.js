// ============================================
// MONDAY MORNING POST MODULE
// Generates a team-wide encouragement post
// with wins, opportunities, and a hot tip —
// ready to copy into Teams on Monday mornings.
// ============================================
(function () {
    'use strict';

    var STORAGE_PREFIX = 'devCoachingTool_';

    // Metrics to skip in the team post (volume/cumulative, or redundant)
    var POST_SKIP_METRICS = { totalCalls: true, reliability: true, transfersCount: true };
    // Survey-backed metrics — skip if team has no survey data
    var SURVEY_METRICS = { cxRepOverall: true, fcr: true, overallExperience: true };

    // ============================================
    // PHRASE POOLS
    // ============================================

    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    var OPENERS = [
        'Good morning team! 🌟 Happy Monday — here\'s where we stand heading into this week.',
        'Good morning everyone! ☀️ Let\'s kick off the week with a look at our numbers.',
        'Happy Monday team! 🚀 Here\'s your weekly team performance update.',
        'Morning team! 🌅 New week, new opportunities — let\'s see where we\'re at.',
        'Good morning! 💪 Quick Monday check-in on where we stand as a team.',
    ];

    var NO_WINS_LINES = [
        'Numbers were tough this period — I see the effort and I appreciate it.',
        'It was a challenging stretch, but the effort doesn\'t go unnoticed.',
        'Not where we want to be yet, but every week is a fresh start.',
    ];

    var CLOSERS = [
        'Let\'s make it a great week. I\'m here if anyone needs anything! 💪',
        'Appreciate each of you — let\'s build on our wins and chip away at those opportunities. 🙌',
        'Let\'s go get it this week. Reach out anytime if you need support.',
        'Keep doing your thing. I\'m proud of this team and I\'m here for you. ✅',
        'One day at a time — let\'s make this week count. You got this! 🔥',
    ];

    // ============================================
    // DATA ACCESS HELPERS
    // ============================================

    function getWeeklyData() {
        var storage = window.DevCoachModules?.storage;
        if (storage?.loadWeeklyData) return storage.loadWeeklyData() || {};
        try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'weeklyData') || '{}'); } catch (e) { return {}; }
    }

    function getYtdData() {
        var storage = window.DevCoachModules?.storage;
        if (storage?.loadYtdData) return storage.loadYtdData() || {};
        try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'ytdData') || '{}'); } catch (e) { return {}; }
    }

    function getAllData() {
        return Object.assign({}, getWeeklyData(), getYtdData());
    }

    function getRegistry() {
        return window.METRICS_REGISTRY || {};
    }

    function isReverseMetric(key) {
        return typeof window.isReverseMetric === 'function'
            ? window.isReverseMetric(key)
            : ['transfers', 'transfersCount', 'aht', 'holdTime', 'acw', 'reliability'].includes(key);
    }

    function formatMetricDisplay(key, value) {
        return typeof window.formatMetricDisplay === 'function'
            ? window.formatMetricDisplay(key, value)
            : String(parseFloat(value).toFixed(1));
    }

    function getTeamFilterContext() {
        var tf = window.DevCoachModules?.teamFilter;
        return tf?.getTeamSelectionContext ? tf.getTeamSelectionContext() : { isFiltering: false, selectedSet: null };
    }

    function isIncluded(name, ctx) {
        var tf = window.DevCoachModules?.teamFilter;
        return tf?.isAssociateIncludedByTeamFilter
            ? tf.isAssociateIncludedByTeamFilter(name, ctx)
            : true;
    }

    function showToast(msg) {
        if (typeof window.showToast === 'function') window.showToast(msg);
    }

    // ============================================
    // PERIOD UTILITIES
    // ============================================

    // Returns array of { key, label, periodType, endDate } sorted newest first
    function getAllPeriods() {
        var all = getAllData();
        var periods = Object.keys(all).map(function (key) {
            var meta = all[key]?.metadata || {};
            var endDate = meta.endDate || key.split('|')[1] || key.split('|')[0] || '';
            var periodType = meta.periodType || 'week';
            var label = meta.label || formatPeriodLabel(periodType, endDate, meta);
            return { key: key, label: label, periodType: periodType, endDate: endDate };
        });
        periods.sort(function (a, b) { return b.endDate.localeCompare(a.endDate); });
        return periods;
    }

    function formatPeriodLabel(type, endDate, meta) {
        if (meta.label) return meta.label;
        if (!endDate) return 'Unknown period';
        try {
            var d = new Date(endDate + 'T00:00:00');
            if (type === 'month') return d.toLocaleString('default', { month: 'long', year: 'numeric' });
            if (type === 'quarter') {
                var q = Math.ceil((d.getMonth() + 1) / 3);
                return 'Q' + q + ' ' + d.getFullYear();
            }
            // week / daily / custom
            var mm = String(d.getMonth() + 1).padStart(2, '0');
            var dd = String(d.getDate()).padStart(2, '0');
            var yyyy = d.getFullYear();
            return 'Week ending ' + mm + '/' + dd + '/' + yyyy;
        } catch (e) {
            return endDate;
        }
    }

    // ============================================
    // TEAM AVERAGES
    // ============================================

    function computeTeamAverages(periodKey) {
        var all = getAllData();
        var period = all[periodKey];
        if (!period) return null;

        var employees = (period.employees || []).filter(function (e) {
            return isIncluded(e.name, getTeamFilterContext());
        });
        if (!employees.length) return null;

        var registry = getRegistry();
        var hasSurveyData = employees.some(function (e) {
            var st = parseInt(e.surveyTotal, 10);
            return Number.isFinite(st) && st > 0;
        });

        var averages = {};
        Object.keys(registry).forEach(function (key) {
            if (POST_SKIP_METRICS[key]) return;
            if (SURVEY_METRICS[key] && !hasSurveyData) return;

            var isSurveyWeighted = SURVEY_METRICS[key];
            var wSum = 0, wTotal = 0;

            employees.forEach(function (emp) {
                var val = parseFloat(emp[key]);
                if (!Number.isFinite(val)) return;

                var w = 1;
                if (isSurveyWeighted) {
                    var st = parseInt(emp.surveyTotal, 10);
                    w = (Number.isFinite(st) && st > 0) ? st : 0;
                } else {
                    var tc = parseInt(emp.totalCalls, 10);
                    w = (Number.isFinite(tc) && tc > 0) ? tc : 1;
                }
                if (w > 0) { wSum += val * w; wTotal += w; }
            });

            if (wTotal > 0) averages[key] = wSum / wTotal;
        });

        return averages;
    }

    // ============================================
    // POST BUILDER
    // ============================================

    function buildPost(averages, periodLabel) {
        if (!averages) return null;

        var registry = getRegistry();
        var wins = [];
        var opps = [];

        Object.keys(averages).forEach(function (key) {
            var def = registry[key];
            if (!def || !def.target) return;

            var val = averages[key];
            var targetVal = def.target.value;
            var label = def.label || key;
            var unit = def.unit || '%';
            var formatted = formatMetricDisplay(key, val);
            var targetStr = formatMetricDisplay(key, targetVal);
            var reverse = isReverseMetric(key);

            var meeting = reverse ? (val <= targetVal) : (val >= targetVal);

            if (meeting) {
                wins.push({ key: key, label: label, formatted: formatted });
            } else {
                var gap = Math.abs(val - targetVal);
                var gapStr = formatMetricDisplay(key, gap);
                var direction = reverse ? '≤' : '≥';
                opps.push({
                    key: key, label: label, formatted: formatted,
                    targetStr: targetStr, gapStr: gapStr,
                    direction: direction, gap: gap, unit: unit
                });
            }
        });

        // Sort opps by relative gap size (biggest miss first)
        opps.sort(function (a, b) { return b.gap - a.gap; });

        var lines = [];
        lines.push(pick(OPENERS));
        lines.push('');
        lines.push('📅 ' + periodLabel + ':');
        lines.push('');

        if (wins.length) {
            lines.push('✅ TEAM WINS');
            wins.forEach(function (w) {
                lines.push('  • ' + w.label + ': ' + w.formatted);
            });
        } else {
            lines.push('✅ TEAM WINS');
            lines.push('  • ' + pick(NO_WINS_LINES));
        }

        lines.push('');

        if (opps.length) {
            lines.push('🎯 FOCUS AREAS');
            opps.forEach(function (o) {
                lines.push('  • ' + o.label + ': ' + o.formatted + ' (target ' + o.direction + ' ' + o.targetStr + ')');
            });
        } else {
            lines.push('🎯 FOCUS AREAS');
            lines.push('  • We\'re hitting target across the board — incredible team effort! 🏆');
        }

        return { lines: lines, topOpp: opps.length ? opps[0] : null };
    }

    // ============================================
    // TIP FETCHING
    // ============================================

    async function fetchTipForMetric(metricKey) {
        if (!metricKey) return null;
        try {
            var tips = await (typeof loadServerTips === 'function' ? loadServerTips() : Promise.resolve({}));
            var pool = tips[metricKey] || [];
            if (!pool.length) return null;
            return { key: metricKey, tip: pick(pool) };
        } catch (e) {
            return null;
        }
    }

    // ============================================
    // POST ASSEMBLY
    // ============================================

    async function generateFullPost(periodKey, periodLabel) {
        var averages = computeTeamAverages(periodKey);
        if (!averages || !Object.keys(averages).length) return null;

        var { lines, topOpp } = buildPost(averages, periodLabel);

        // Tip section
        var tipResult = topOpp ? await fetchTipForMetric(topOpp.key) : null;

        lines.push('');
        lines.push('💡 TEAM TIP OF THE WEEK');
        if (tipResult) {
            var registry = getRegistry();
            var tipLabel = registry[tipResult.key]?.label || tipResult.key;
            lines.push('  Topic: ' + tipLabel);
            lines.push('  "' + tipResult.tip + '"');
        } else {
            lines.push('  Keep showing up, stay focused, and take it one call at a time. 🎯');
        }

        lines.push('');
        lines.push(pick(CLOSERS));

        return lines.join('\n');
    }

    // ============================================
    // UI
    // ============================================

    var initialized = false;

    function initializeMondayPost() {
        renderPeriodSelectors();
        if (!initialized) {
            document.getElementById('mondayPostGenerateBtn')?.addEventListener('click', onGenerate);
            document.getElementById('mondayPostCopyBtn')?.addEventListener('click', onCopy);
            initialized = true;
        }
    }

    function renderPeriodSelectors() {
        var periods = getAllPeriods();
        var weekSelect = document.getElementById('mondayPostWeekSelect');
        var monthSelect = document.getElementById('mondayPostMonthSelect');
        var quarterSelect = document.getElementById('mondayPostQuarterSelect');

        if (!weekSelect) return;

        function populateSelect(sel, type) {
            if (!sel) return;
            var filtered = periods.filter(function (p) { return p.periodType === type; });
            sel.innerHTML = filtered.length
                ? filtered.map(function (p) {
                    return '<option value="' + escHtml(p.key) + '">' + escHtml(p.label) + '</option>';
                }).join('')
                : '<option value="">— no ' + type + ' data —</option>';
        }

        populateSelect(weekSelect, 'week');
        populateSelect(monthSelect, 'month');
        populateSelect(quarterSelect, 'quarter');

        // Show/hide period-type rows
        updatePeriodTypeVisibility();
        document.getElementById('mondayPostPeriodType')?.addEventListener('change', updatePeriodTypeVisibility);
    }

    function updatePeriodTypeVisibility() {
        var type = document.getElementById('mondayPostPeriodType')?.value || 'week';
        ['week', 'month', 'quarter'].forEach(function (t) {
            var row = document.getElementById('mondayPost' + capitalize(t) + 'Row');
            if (row) row.style.display = (t === type) ? 'block' : 'none';
        });
    }

    function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

    function escHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function getSelectedPeriod() {
        var type = document.getElementById('mondayPostPeriodType')?.value || 'week';
        var selectId = 'mondayPost' + capitalize(type) + 'Select';
        var sel = document.getElementById(selectId);
        var key = sel?.value;
        if (!key) return null;

        var all = getAllData();
        var meta = all[key]?.metadata || {};
        var endDate = meta.endDate || key.split('|')[1] || '';
        var label = formatPeriodLabel(type, endDate, meta);
        return { key: key, label: label, periodType: type };
    }

    async function onGenerate() {
        var btn = document.getElementById('mondayPostGenerateBtn');
        var outputArea = document.getElementById('mondayPostOutput');
        var copyBtn = document.getElementById('mondayPostCopyBtn');

        var selected = getSelectedPeriod();
        if (!selected) {
            showToast('No data available for the selected period type.');
            return;
        }

        if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating...'; }
        if (outputArea) outputArea.value = '';
        if (copyBtn) copyBtn.style.display = 'none';

        try {
            var post = await generateFullPost(selected.key, selected.label);
            if (!post) {
                if (outputArea) outputArea.value = 'No team data found for this period. Make sure data is uploaded for this period.';
            } else {
                if (outputArea) outputArea.value = post;
                if (copyBtn) copyBtn.style.display = 'inline-block';
            }
        } catch (err) {
            if (outputArea) outputArea.value = 'Error generating post: ' + err.message;
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '📝 Generate Post'; }
        }
    }

    function onCopy() {
        var outputArea = document.getElementById('mondayPostOutput');
        if (!outputArea || !outputArea.value) return;
        navigator.clipboard.writeText(outputArea.value).then(function () {
            showToast('✅ Post copied to clipboard!');
        }).catch(function () {
            // Fallback
            outputArea.select();
            document.execCommand('copy');
            showToast('✅ Post copied!');
        });
    }

    // ============================================
    // EXPORT
    // ============================================

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.mondayPost = {
        initializeMondayPost: initializeMondayPost
    };

})();
