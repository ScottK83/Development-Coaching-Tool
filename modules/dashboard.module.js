/* ========================================
   DASHBOARD MODULE
   Landing page showing top coaching priorities
   and team performance summary
   ======================================== */

(function() {
    'use strict';

    var STORAGE_PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';

    function escapeHtml(text) {
        var mod = window.DevCoachModules?.sharedUtils;
        if (mod?.escapeHtml) return mod.escapeHtml(text);
        return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function getTeamFilterContext() {
        var teamFilter = window.DevCoachModules?.teamFilter;
        if (teamFilter?.getTeamSelectionContext) {
            return teamFilter.getTeamSelectionContext();
        }
        return { isFiltering: false, selectedSet: null };
    }

    function isIncludedByTeamFilter(employeeName, filterContext) {
        var teamFilter = window.DevCoachModules?.teamFilter;
        if (teamFilter?.isAssociateIncludedByTeamFilter) {
            return teamFilter.isAssociateIncludedByTeamFilter(employeeName, filterContext);
        }
        return true;
    }

    function getLatestWeekKey(wData) {
        var keys = Object.keys(wData);
        if (!keys.length) return null;
        keys.sort(function(a, b) {
            var aEnd = a.split('|')[1] || a.split('|')[0] || '';
            var bEnd = b.split('|')[1] || b.split('|')[0] || '';
            return bEnd.localeCompare(aEnd);
        });
        return keys[0];
    }

    function getEmployeesForWeek(wData, weekKey) {
        var week = wData[weekKey];
        if (!week) return [];
        return Array.isArray(week.employees) ? week.employees : [];
    }

    function getFirstName(emp) {
        var name = emp.firstName || emp.name || 'Unknown';
        if (name.indexOf(',') !== -1) return name.split(',')[0].trim();
        return name;
    }

    var SURVEY_BACKED_METRICS = { cxRepOverall: true, fcr: true, overallExperience: true };
    // Cumulative metrics don't make sense as coaching triggers —
    // reliability is total hours for the year, not a weekly rate
    var SKIP_ON_DASHBOARD = { transfersCount: true, reliability: true };

    // Judged against the year's target as printed, the way Numbers and Rankings
    // judge it. This asked window.DevCoachModules.metrics, which nothing ever
    // registered, and fell back to the registry's year-less target compared
    // raw, so 92.96 adherence was a miss here and "93%, met" everywhere else.
    function evaluateEmployee(emp, year) {
        var registry = window.METRICS_REGISTRY || {};
        var profiles = window.DevCoachModules?.metricProfiles;
        var missed = [];
        var metCount = 0;
        var totalMetrics = 0;
        var scorecard = [];

        // Skip survey-backed metrics when employee has no surveys
        var surveyTotal = parseInt(emp.surveyTotal, 10);
        var hasSurveys = Number.isInteger(surveyTotal) && surveyTotal > 0;

        var keys = Object.keys(registry);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var def = registry[key];
            if (!def || !def.target) continue;
            if (SKIP_ON_DASHBOARD[key]) continue;

            // Don't flag survey metrics when there are no surveys
            if (SURVEY_BACKED_METRICS[key] && !hasSurveys) continue;

            var value = emp[key];
            var num = parseFloat(value);
            if (isNaN(num) || value === undefined || value === null || value === '') continue;

            totalMetrics++;
            var target = profiles?.getYearTarget?.(key, year) || def.target;
            var meetingTarget = typeof profiles?.valueMeetsTarget === 'function'
                ? profiles.valueMeetsTarget(key, num, target)
                : (target.type === 'min' ? num >= target.value : num <= target.value);

            if (SCORECARD_KEYS.indexOf(key) !== -1) scorecard.push({ metricKey: key, meetsTarget: !!meetingTarget });

            if (meetingTarget) {
                metCount++;
            } else {
                // Calculate gap
                var gap = Math.abs(num - target.value);
                var unit = def.unit || '%';
                // Normalize: percentage gaps weigh more than seconds
                var normalizedGap = unit === 'sec' ? gap / 10 : unit === 'hrs' ? gap * 5 : gap;

                missed.push({
                    key: key,
                    icon: def.icon || '',
                    label: def.label || key,
                    value: num,
                    targetValue: target.value,
                    targetType: target.type,
                    gap: gap,
                    normalizedGap: normalizedGap,
                    unit: unit
                });
            }
        }

        missed.sort(function(a, b) { return b.normalizedGap - a.normalizedGap; });

        var totalGap = 0;
        for (var j = 0; j < missed.length; j++) totalGap += missed[j].normalizedGap;

        return {
            name: emp.name || 'Unknown',
            firstName: getFirstName(emp),
            missedCount: missed.length,
            metCount: metCount,
            totalMetrics: totalMetrics,
            totalGap: totalGap,
            worstMetrics: missed.slice(0, 3),
            meetsAll: missed.length === 0,
            status: statusFor(scorecard)
        };
    }

    // The four on the scorecard, the same four the Today page's badge reads.
    var SCORECARD_KEYS = ['aht', 'scheduleAdherence', 'overallSentiment', 'cxRepOverall'];

    /*
     * The Today page's split, so the two pages say the same thing about the
     * same person (many hats review, 2026-11-03, S3). This page used to count
     * "Meeting All Targets" across every metric on the card, which nobody
     * hits, so it read "0 Meeting All Targets" and "17 Need Coaching" in red
     * for a team that was mostly doing fine.
     */
    function statusFor(scorecard) {
        var badge = window.DevCoachModules?.morningPulse?.getStatusBadge;
        if (typeof badge === 'function') {
            var b = badge(scorecard);
            if (b && b.label) return { label: b.label, icon: b.icon, met: b.met, measured: b.measured };
        }
        var measured = scorecard.length;
        var met = scorecard.filter(function(m) { return m.meetsTarget; }).length;
        var label = measured < 2 ? 'Steady'
            : met === measured ? 'Crushing It'
            : (met === 0 || (met === 1 && measured >= 4)) ? 'Needs Support'
            : met / measured >= 0.6 ? 'Doing Good' : 'Watch';
        return { label: label, icon: '', met: met, measured: measured };
    }

    var STATUS_ORDER = [
        { label: 'Crushing It', icon: '🟢', callout: 'callout callout-good', tone: 'tone-good' },
        { label: 'Doing Good', icon: '🔵', callout: 'callout callout-info', tone: 'tone-info' },
        { label: 'Watch', icon: '🟡', callout: 'callout callout-warn', tone: 'tone-warn' },
        { label: 'Needs Support', icon: '🔴', callout: 'callout callout-bad', tone: 'tone-bad' }
    ];

    function formatMetricPill(m) {
        var format = typeof window.formatMetricDisplay === 'function' ? window.formatMetricDisplay : function (key, v) { return String(v); };
        var display = format(m.key, m.value);
        var targetDisplay = format(m.key, m.targetValue);
        var prefix = m.targetType === 'min' ? '\u2265' : '\u2264';

        return '<span class="pill pill-bad" style="padding: 3px 8px; margin: 2px 3px; font-size: 0.8em;">' +
            escapeHtml(m.icon + ' ' + m.label) + ': ' + escapeHtml(display) +
            ' <span style="font-weight: 400; opacity: 0.7;">(target ' + prefix + escapeHtml(targetDisplay) + ')</span></span>';
    }

    function formatGreenPill(text) {
        return '<span class="pill pill-good" style="padding: 3px 8px; margin: 2px 3px; font-size: 0.8em;">' + escapeHtml(text) + '</span>';
    }

    function renderDashboard(container, priorities, teamStats, weekLabel) {
        var html = '';

        // Header
        html += '<div style="margin-bottom: 20px;">' +
            '<h2 style="margin: 0 0 6px 0; font-size: 1.4em; color: var(--text-primary);">Year to date</h2>' +
            '<p style="margin: 0; color: var(--text-secondary); font-size: 0.9em;">' + escapeHtml(weekLabel) + '</p></div>';

        // Team summary bar
        html += '<div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px;">';
        html += '<div style="flex: 1; min-width: 120px; padding: 16px; background: var(--bg-surface-raised); border-radius: 10px; border: 1px solid var(--border); text-align: center;">' +
            '<div class="text-primary" style="font-size: 2em; font-weight: 700;">' + teamStats.total + '</div>' +
            '<div style="font-size: 0.82em; color: var(--text-secondary);">In this file</div></div>';
        STATUS_ORDER.forEach(function(st) {
            var count = (teamStats.byStatus && teamStats.byStatus[st.label]) || 0;
            html += '<div class="' + st.callout + '" style="flex: 1; min-width: 120px; padding: 16px; border-radius: 10px; text-align: center;">' +
                '<div class="' + st.tone + '" style="font-size: 2em; font-weight: 700;">' + count + '</div>' +
                '<div class="' + st.tone + '" style="font-size: 0.82em;">' + st.icon + ' ' + st.label + '</div></div>';
        });
        html += '</div>';
        html += '<div class="text-secondary" style="font-size: 0.82em; margin: -14px 0 20px;">Judged on the scorecard four (Adherence, AHT, Sentiment, Rep Sat), the same way as the Today page.</div>';

        // The roster said 18 and this said 17 with nothing to say why.
        if (teamStats.missing && teamStats.missing.length) {
            html += '<div class="callout" style="padding: 10px 14px; border-radius: 8px; margin: -8px 0 20px; font-size: 0.86em;">' +
                'Not in this year to date file: ' + teamStats.missing.map(escapeHtml).join(', ') + '.</div>';
        }

        // The Year-End KPI Scorecard that sat here was a copy of Score Card's
        // team summary (People > Numbers), which is its one home now.

        // Coaching priorities
        if (priorities.length > 0) {
            html += '<h3 style="margin: 0 0 12px 0; font-size: 1.1em; color: var(--text-secondary);">Who to coach first</h3>';

            for (var i = 0; i < priorities.length; i++) {
                var p = priorities[i];

                html += '<div style="padding: 14px 18px; margin-bottom: 10px; background: var(--bg-surface); ' +
                    'border-radius: 10px; border: 1px solid var(--border);">';

                // Name row with coach button
                html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">';
                html += '<div><span style="font-weight: 700; font-size: 1.05em; color: var(--text-primary);">' + escapeHtml(p.firstName) + '</span>' +
                    ' <span style="font-size: 0.8em; color: var(--text-tertiary);">' + escapeHtml((p.status && p.status.label) || '') +
                    (p.status && p.status.measured ? ', ' + p.status.met + ' of ' + p.status.measured + ' on the scorecard' : '') + '</span></div>';
                // The name rides in a data attribute, not inside the inline
                // script, so no name can break out of the handler.
                html += '<button type="button" data-coach-name="' + escapeHtml(p.name) + '" ' +
                    'onclick="window.DevCoachModules?.dashboard?.coachNow(this.dataset.coachName)" ' +
                    'class="btn-secondary" style="padding: 6px 14px; font-size: 0.82em;">Coach Now \u2192</button>';
                html += '</div>';

                // Metric pills
                html += '<div>';
                for (var j = 0; j < p.worstMetrics.length; j++) {
                    html += formatMetricPill(p.worstMetrics[j]);
                }
                html += '</div>';

                html += '</div>';
            }
        }

        // Associates meeting all targets
        html += renderStarPerformers(teamStats.starNames);

        // Hot Tip of the Day widget
        html += renderHotTipWidget();

        container.innerHTML = html;
    }

    function getRandomTip() {
        try {
            var raw = (function(){var v=window.DevCoachModules?.storage?.readStore?.('metricCoachingTips');return v===undefined||v===null?null:JSON.stringify(v);})();
            var tips = raw ? JSON.parse(raw) : {};
            var allTips = [];
            var keys = Object.keys(tips);
            for (var i = 0; i < keys.length; i++) {
                var metricTips = tips[keys[i]];
                if (Array.isArray(metricTips)) {
                    for (var j = 0; j < metricTips.length; j++) {
                        if (metricTips[j]) allTips.push(metricTips[j]);
                    }
                }
            }
            if (!allTips.length) return null;
            return allTips[Math.floor(Math.random() * allTips.length)];
        } catch(e) { return null; }
    }

    function renderHotTipWidget() {
        var tip = getRandomTip();
        if (!tip) return '';
        return '<div class="callout callout-info" style="margin-top: 20px; padding: 14px 18px; border-radius: 10px;">' +
            '<div class="card-title" style="font-size: 0.95em; margin-bottom: 6px;">Tip of the Day</div>' +
            '<div style="font-size: 0.88em; line-height: 1.5;">' + escapeHtml(tip) + '</div></div>';
    }

    function renderStarPerformers(names) {
        if (!names || !names.length) return '';
        var html = '<h3 style="margin: 20px 0 12px 0; font-size: 1.1em; color: var(--green-text);">Crushing It, every scorecard number on target</h3>';
        html += '<div style="display: flex; flex-wrap: wrap; gap: 6px;">';
        for (var i = 0; i < names.length; i++) {
            html += formatGreenPill('\u2713 ' + names[i]);
        }
        html += '</div>';
        return html;
    }

    function formatWeekLabel(weekKey) {
        return typeof window.formatWeekLabel === 'function' ? window.formatWeekLabel(weekKey) : weekKey;
    }

    function getYtdData() {
        return window.DevCoachModules?.storage?.loadYtdData?.() || {};
    }

    function initializeDashboard() {
        var container = document.getElementById('dashboardContent');
        if (!container) return;

        // Dashboard is YTD-only. Real YTD uploads are the source of truth
        var wData = getYtdData();
        var weekKey = getLatestWeekKey(wData);

        if (!weekKey) {
            container.innerHTML = '<div style="text-align: center; padding: 60px 20px;">' +
                '<div style="font-size: 3em; margin-bottom: 16px;">📊</div>' +
                '<h2 style="color: var(--text-secondary); margin: 0 0 8px 0;">Welcome to the Coaching Tool</h2>' +
                '<p style="color: var(--text-tertiary); margin: 0 0 20px 0;">Upload a YTD report to see coaching priorities.</p>' +
                '<button type="button" onclick="showOnlySection(\'uploadSection\')" ' +
                'class="btn-primary" style="padding: 10px 24px; font-size: 1em;">Upload Data</button></div>';
            return;
        }

        var employees = getEmployeesForWeek(wData, weekKey);
        var filterContext = getTeamFilterContext();

        if (filterContext.isFiltering) {
            employees = employees.filter(function(emp) {
                return isIncludedByTeamFilter(emp.name, filterContext);
            });
        }

        // Evaluate all employees, against the targets of the year the file covers
        var endText = weekKey.split('|')[1] || weekKey.split('|')[0] || '';
        var year = parseInt(endText.slice(0, 4), 10) || new Date().getFullYear();
        var evaluated = employees.map(function(emp) { return evaluateEmployee(emp, year); });

        // Who to coach first: Needs Support, then Watch, biggest gap first.
        var rank = { 'Needs Support': 0, 'Watch': 1 };
        var needCoaching = evaluated
            .filter(function(e) { return e.status && rank[e.status.label] !== undefined; })
            .sort(function(a, b) {
                return (rank[a.status.label] - rank[b.status.label]) || (b.totalGap - a.totalGap);
            });
        var crushing = evaluated.filter(function(e) { return e.status && e.status.label === 'Crushing It'; });

        var byStatus = {};
        evaluated.forEach(function(e) {
            var label = e.status ? e.status.label : 'Steady';
            byStatus[label] = (byStatus[label] || 0) + 1;
        });

        var teamStats = {
            total: evaluated.length,
            byStatus: byStatus,
            missing: missingFromFile(employees, filterContext),
            starNames: crushing.map(function(e) { return e.firstName; }).sort()
        };

        var weekLabel = 'YTD data through ' + formatWeekLabel(weekKey);
        renderDashboard(container, needCoaching, teamStats, weekLabel);
    }

    /*
     * Roster names with no row in the year to date file. The team bar said
     * "All of my team (18)" beside "17 Team Members" with no reason given.
     * Only the people in scope: a picked team member, or the whole roster.
     */
    function missingFromFile(employees, filterContext) {
        var roster = window.DevCoachModules?.teamScope?.getMyTeamRoster?.() || [];
        if (!roster.length) return [];
        var inFile = {};
        (employees || []).forEach(function(emp) { if (emp && emp.name) inFile[emp.name] = true; });
        return roster.filter(function(name) {
            if (inFile[name]) return false;
            return !filterContext || !filterContext.isFiltering || isIncludedByTeamFilter(name, filterContext);
        }).sort();
    }

    function coachNow(employeeName) {
        // Set the person first: every registered picker adopts it as it
        // populates, so this no longer has to race the Coaching tab's render
        // on a 100ms timer and hope the options exist by then.
        window.DevCoachModules?.selectedAssociate?.set(employeeName);

        // Coaching lives under People now. Its own button mounts the panel and
        // draws it, so this goes through the button rather than repeating that.
        if (typeof showOnlySection === 'function') showOnlySection('peopleSection');
        if (typeof populatePeoplePicker === 'function') populatePeoplePicker();
        document.getElementById('subNavPeCoach')?.click();
    }

    // Export
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.dashboard = {
        initializeDashboard: initializeDashboard,
        coachNow: coachNow,
        // Exported so how a person is judged, and how a miss prints, can be
        // checked without a DOM.
        evaluateEmployee: evaluateEmployee,
        statusFor: statusFor,
        missingFromFile: missingFromFile,
        formatMetricPill: formatMetricPill
    };
    window.initializeDashboard = initializeDashboard;
})();
