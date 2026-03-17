/* ========================================
   DASHBOARD MODULE
   Landing page showing top coaching priorities
   and team performance summary
   ======================================== */

(function() {
    'use strict';

    var STORAGE_PREFIX = 'devCoachingTool_';

    function escapeHtml(text) {
        return window.DevCoachModules?.sharedUtils?.escapeHtml?.(text) || String(text || '');
    }

    function getWeeklyData() {
        var storage = window.DevCoachModules?.storage;
        if (storage?.loadWeeklyData) return storage.loadWeeklyData() || {};
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + 'weeklyData');
            return raw ? JSON.parse(raw) : {};
        } catch(e) { return {}; }
    }

    function getTeamFilter(weekKey) {
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + 'myTeamMembers');
            var all = raw ? JSON.parse(raw) : {};
            return Array.isArray(all[weekKey]) ? all[weekKey] : [];
        } catch(e) { return []; }
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

    function evaluateEmployee(emp) {
        var registry = window.METRICS_REGISTRY || {};
        var metrics = window.DevCoachModules?.metrics || {};
        var missed = [];
        var metCount = 0;
        var totalMetrics = 0;

        var keys = Object.keys(registry);
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var def = registry[key];
            if (!def || !def.target) continue;

            var value = emp[key];
            var num = parseFloat(value);
            if (isNaN(num) || value === undefined || value === null || value === '') continue;

            totalMetrics++;
            var target = def.target;
            var meetingTarget = metrics.isMetricMeetingTarget
                ? metrics.isMetricMeetingTarget(key, num, target.value)
                : (target.type === 'min' ? num >= target.value : num <= target.value);

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
            meetsAll: missed.length === 0
        };
    }

    function formatMetricPill(m) {
        var metrics = window.DevCoachModules?.metrics || {};
        var display = metrics.formatMetricValue ? metrics.formatMetricValue(m.key, m.value) : String(m.value);
        var targetDisplay = metrics.formatMetricValue ? metrics.formatMetricValue(m.key, m.targetValue) : String(m.targetValue);
        var prefix = m.targetType === 'min' ? '\u2265' : '\u2264';

        return '<span style="display: inline-block; padding: 3px 8px; margin: 2px 3px; border-radius: 12px; ' +
            'font-size: 0.8em; font-weight: 600; background: #fee2e2; color: #991b1b;">' +
            escapeHtml(m.icon + ' ' + m.label) + ': ' + escapeHtml(display) +
            ' <span style="font-weight: 400; opacity: 0.7;">(target ' + prefix + escapeHtml(targetDisplay) + ')</span></span>';
    }

    function formatGreenPill(text) {
        return '<span style="display: inline-block; padding: 3px 8px; margin: 2px 3px; border-radius: 12px; ' +
            'font-size: 0.8em; font-weight: 600; background: #dcfce7; color: #166534;">' + escapeHtml(text) + '</span>';
    }

    function renderDashboard(container, priorities, teamStats, weekLabel) {
        var html = '';

        // Header
        html += '<div style="margin-bottom: 20px;">' +
            '<h2 style="margin: 0 0 6px 0; font-size: 1.4em; color: #1e293b;">Dashboard</h2>' +
            '<p style="margin: 0; color: #64748b; font-size: 0.9em;">Week ending ' + escapeHtml(weekLabel) + '</p></div>';

        // Team summary bar
        html += '<div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px;">';
        html += '<div style="flex: 1; min-width: 140px; padding: 16px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; text-align: center;">' +
            '<div style="font-size: 2em; font-weight: 700; color: #334155;">' + teamStats.total + '</div>' +
            '<div style="font-size: 0.82em; color: #64748b;">Team Members</div></div>';
        html += '<div style="flex: 1; min-width: 140px; padding: 16px; background: #dcfce7; border-radius: 10px; border: 1px solid #bbf7d0; text-align: center;">' +
            '<div style="font-size: 2em; font-weight: 700; color: #166534;">' + teamStats.meetingAll + '</div>' +
            '<div style="font-size: 0.82em; color: #166534;">Meeting All Targets</div></div>';
        html += '<div style="flex: 1; min-width: 140px; padding: 16px; background: #fee2e2; border-radius: 10px; border: 1px solid #fecaca; text-align: center;">' +
            '<div style="font-size: 2em; font-weight: 700; color: #991b1b;">' + teamStats.needCoaching + '</div>' +
            '<div style="font-size: 0.82em; color: #991b1b;">Need Coaching</div></div>';
        html += '</div>';

        // Coaching priorities
        if (priorities.length > 0) {
            html += '<h3 style="margin: 0 0 12px 0; font-size: 1.1em; color: #475569;">Top Coaching Priorities</h3>';

            for (var i = 0; i < priorities.length; i++) {
                var p = priorities[i];
                var rank = i + 1;
                var borderColor = rank <= 3 ? '#ef4444' : '#f59e0b';

                html += '<div style="padding: 14px 18px; margin-bottom: 10px; background: white; ' +
                    'border-radius: 10px; border: 1px solid #e2e8f0; border-left: 4px solid ' + borderColor + '; ' +
                    'box-shadow: 0 1px 3px rgba(0,0,0,0.06);">';

                // Name row with coach button
                html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">';
                html += '<div><span style="font-weight: 700; font-size: 1.05em; color: #1e293b;">' + escapeHtml(p.firstName) + '</span>' +
                    ' <span style="font-size: 0.8em; color: #94a3b8;">' + p.metCount + '/' + p.totalMetrics + ' targets met</span></div>';
                html += '<button type="button" onclick="window.DevCoachModules?.dashboard?.coachNow(\'' +
                    escapeHtml(p.name.replace(/'/g, "\\'")) + '\')" ' +
                    'style="padding: 6px 14px; background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; ' +
                    'border: none; border-radius: 6px; font-size: 0.82em; font-weight: 600; cursor: pointer;">Coach Now \u2192</button>';
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
        var stars = priorities.filter(function(p) { return false; }); // not in priorities
        var allMeeting = [];
        // We need the full list, not just priorities
        html += renderStarPerformers(teamStats.starNames);

        container.innerHTML = html;
    }

    function renderStarPerformers(names) {
        if (!names || !names.length) return '';
        var html = '<h3 style="margin: 20px 0 12px 0; font-size: 1.1em; color: #166534;">Meeting All Targets</h3>';
        html += '<div style="display: flex; flex-wrap: wrap; gap: 6px;">';
        for (var i = 0; i < names.length; i++) {
            html += formatGreenPill('\u2713 ' + names[i]);
        }
        html += '</div>';
        return html;
    }

    function formatWeekLabel(weekKey) {
        var parts = weekKey.split('|');
        var endDate = parts[1] || parts[0] || '';
        if (!endDate) return weekKey;
        try {
            var d = new Date(endDate + 'T12:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch(e) { return endDate; }
    }

    function initializeDashboard() {
        var container = document.getElementById('dashboardContent');
        if (!container) return;

        var wData = getWeeklyData();
        var weekKey = getLatestWeekKey(wData);

        if (!weekKey) {
            container.innerHTML = '<div style="text-align: center; padding: 60px 20px;">' +
                '<div style="font-size: 3em; margin-bottom: 16px;">📊</div>' +
                '<h2 style="color: #475569; margin: 0 0 8px 0;">Welcome to the Coaching Tool</h2>' +
                '<p style="color: #94a3b8; margin: 0 0 20px 0;">Upload your first week of data to see coaching priorities.</p>' +
                '<button type="button" onclick="showOnlySection(\'coachingForm\')" ' +
                'style="padding: 10px 24px; background: #2563eb; color: white; border: none; border-radius: 8px; ' +
                'font-size: 1em; cursor: pointer; font-weight: 600;">Upload Data</button></div>';
            return;
        }

        var employees = getEmployeesForWeek(wData, weekKey);
        var teamFilter = getTeamFilter(weekKey);

        if (teamFilter.length > 0) {
            employees = employees.filter(function(emp) {
                return teamFilter.indexOf(emp.name) !== -1;
            });
        }

        // Evaluate all employees
        var evaluated = employees.map(evaluateEmployee);

        // Separate into needs-coaching vs meeting-all
        var needCoaching = evaluated.filter(function(e) { return !e.meetsAll; });
        var meetingAll = evaluated.filter(function(e) { return e.meetsAll; });

        // Sort by total gap descending (worst first)
        needCoaching.sort(function(a, b) { return b.totalGap - a.totalGap; });

        var teamStats = {
            total: evaluated.length,
            meetingAll: meetingAll.length,
            needCoaching: needCoaching.length,
            starNames: meetingAll.map(function(e) { return e.firstName; }).sort()
        };

        var weekLabel = formatWeekLabel(weekKey);
        renderDashboard(container, needCoaching, teamStats, weekLabel);
    }

    function coachNow(employeeName) {
        if (typeof showOnlySection === 'function') showOnlySection('coachingEmailSection');
        if (typeof showSubSection === 'function') showSubSection('subSectionCoachingEmail', 'subNavCoachingEmail');
        if (typeof initializeCoachingEmail === 'function') initializeCoachingEmail();

        setTimeout(function() {
            var select = document.getElementById('coachingEmployeeSelect');
            if (select) {
                select.value = employeeName;
                select.dispatchEvent(new Event('change'));
            }
        }, 100);
    }

    // Export
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.dashboard = {
        initializeDashboard: initializeDashboard,
        coachNow: coachNow
    };
    window.initializeDashboard = initializeDashboard;
})();
