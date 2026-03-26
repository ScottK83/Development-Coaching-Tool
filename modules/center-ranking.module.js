(function () {
    'use strict';

    function _escapeHtml(str) {
        var mod = window.DevCoachModules?.sharedUtils;
        if (mod?.escapeHtml) return mod.escapeHtml(str);
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function _formatMetricDisplay(key, value) {
        return typeof window.formatMetricDisplay === 'function' ? window.formatMetricDisplay(key, value) : String(value);
    }
    function _getTeamMembersForWeek(weekKey) {
        return typeof window.getTeamMembersForWeek === 'function' ? window.getTeamMembersForWeek(weekKey) : [];
    }
    function _getLatestWeeklyKey() {
        return typeof window.getLatestWeeklyKey === 'function' ? window.getLatestWeeklyKey() : null;
    }
    function _getWeeklyData() {
        return typeof weeklyData !== 'undefined' ? weeklyData : {};
    }
    function _getYtdData() {
        return typeof ytdData !== 'undefined' ? ytdData : {};
    }

    /**
     * Score an employee using the On/Off track 5-metric system.
     * Returns { ratingAverage, trackLabel, scores, values, reliability } or null.
     */
    function scoreEmployee(emp, year) {
        var onOff = window.DevCoachModules?.onOffTracker;
        if (!onOff?.calculateYearEndOnOffMirror) return null;

        var result = onOff.calculateYearEndOnOffMirror(emp, year);
        if (!result || !result.isComplete) return null;

        return {
            ratingAverage: result.ratingAverage,
            trackLabel: result.trackLabel,
            trackStatusValue: result.trackStatusValue,
            scores: result.scores,
            values: result.values,
            reliability: parseFloat(emp.reliability) || 0
        };
    }

    /**
     * Build rankings from the best available data source for a year.
     * Uses getLatestYearPeriodForEmployee logic via YTD data, or falls
     * back to the latest weekly upload with the most employees.
     */
    function buildCenterRankings() {
        var currentYear = new Date().getFullYear();
        var wData = _getWeeklyData();
        var yData = _getYtdData();

        // Find the period with the most employees (likely a full center upload)
        var bestPeriod = null;
        var bestCount = 0;
        var bestSource = '';
        var bestKey = '';

        // Check YTD data first (source of truth)
        Object.entries(yData).forEach(function (entry) {
            var key = entry[0];
            var period = entry[1];
            var meta = period?.metadata || {};
            var endStr = meta.endDate || (key.includes('|') ? key.split('|')[1] : '');
            var endYear = parseInt(String(endStr).split('-')[0], 10);
            if (endYear !== currentYear) return;
            var count = (period.employees || []).length;
            if (count > bestCount) {
                bestPeriod = period;
                bestCount = count;
                bestSource = meta.label || 'YTD upload';
                bestKey = key;
            }
        });

        // Check weekly data if no YTD or weekly has more employees
        Object.entries(wData).forEach(function (entry) {
            var key = entry[0];
            var period = entry[1];
            var meta = period?.metadata || {};
            var endStr = meta.endDate || (key.includes('|') ? key.split('|')[1] : '');
            var endYear = parseInt(String(endStr).split('-')[0], 10);
            if (endYear !== currentYear) return;
            var count = (period.employees || []).length;
            if (count > bestCount) {
                bestPeriod = period;
                bestCount = count;
                bestSource = meta.label || key;
                bestKey = key;
            }
        });

        if (!bestPeriod || bestCount === 0) return null;

        // Score every employee
        var rankings = [];
        (bestPeriod.employees || []).forEach(function (emp) {
            if (!emp || !emp.name) return;
            var score = scoreEmployee(emp, currentYear);
            if (!score) return;

            rankings.push({
                name: emp.name,
                ratingAverage: score.ratingAverage,
                trackLabel: score.trackLabel,
                trackStatusValue: score.trackStatusValue,
                scores: score.scores,
                values: score.values,
                reliability: score.reliability
            });
        });

        // Rank by each individual metric (lower rank = better)
        var metricRankKeys = [
            { key: 'aht', field: 'values.aht', reverse: true },         // lower AHT = better
            { key: 'adherence', field: 'values.adherence', reverse: false }, // higher = better
            { key: 'sentiment', field: 'values.sentiment', reverse: false }, // higher = better
            { key: 'associateOverall', field: 'values.associateOverall', reverse: false }, // higher = better
            { key: 'reliability', field: 'reliability', reverse: true }  // lower hours = better
        ];

        metricRankKeys.forEach(function (mk) {
            // Sort a copy to determine ranks for this metric
            var sorted = rankings.slice().sort(function (a, b) {
                var aVal = mk.field.includes('.') ? a.values[mk.field.split('.')[1]] : a[mk.field];
                var bVal = mk.field.includes('.') ? b.values[mk.field.split('.')[1]] : b[mk.field];
                aVal = aVal !== null && aVal !== undefined ? aVal : (mk.reverse ? Infinity : -Infinity);
                bVal = bVal !== null && bVal !== undefined ? bVal : (mk.reverse ? Infinity : -Infinity);
                return mk.reverse ? (aVal - bVal) : (bVal - aVal);
            });

            // Assign metric rank to each employee
            sorted.forEach(function (emp, idx) {
                if (!emp.metricRanks) emp.metricRanks = {};
                emp.metricRanks[mk.key] = idx + 1;
            });
        });

        // Composite rank = average of all 5 metric ranks (lower = better)
        rankings.forEach(function (r) {
            var ranks = r.metricRanks || {};
            var sum = (ranks.aht || 0) + (ranks.adherence || 0) + (ranks.sentiment || 0) +
                (ranks.associateOverall || 0) + (ranks.reliability || 0);
            r.compositeScore = sum / 5;
        });

        // Sort by composite score (lower = better), reliability rank as tiebreaker
        rankings.sort(function (a, b) {
            if (a.compositeScore !== b.compositeScore) return a.compositeScore - b.compositeScore;
            return (a.metricRanks?.reliability || 0) - (b.metricRanks?.reliability || 0);
        });

        // Assign overall rank
        rankings.forEach(function (r, i) { r.rank = i + 1; });

        // Identify team members
        var latestKey = _getLatestWeeklyKey();
        var teamMembers = latestKey ? _getTeamMembersForWeek(latestKey) : [];
        var teamSet = new Set(teamMembers);

        return {
            rankings: rankings,
            totalEmployees: rankings.length,
            source: bestSource,
            periodKey: bestKey,
            teamMembers: teamSet
        };
    }

    /**
     * Render the center ranking view
     */
    function renderCenterRanking() {
        var container = document.getElementById('centerRankingContent');
        if (!container) return;

        var data = buildCenterRankings();
        if (!data || data.rankings.length === 0) {
            container.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 40px;">No ranking data available. Upload a full center data set (30+ employees) to see rankings.</p>';
            return;
        }

        var html = '';

        // Header
        html += '<div style="margin-bottom: 20px; padding: 15px; background: #e3f2fd; border-radius: 8px; border-left: 4px solid #1565c0;">';
        html += '<strong>Center Rankings</strong> &mdash; ' + data.totalEmployees + ' employees scored';
        html += '<br><span style="color: #666; font-size: 0.85em;">Source: ' + _escapeHtml(data.source) + ' | Ranked by On/Off Track score (reliability as tiebreaker)</span>';
        html += '</div>';

        // Team summary
        var teamRanks = data.rankings.filter(function (r) { return data.teamMembers.has(r.name); });
        if (teamRanks.length > 0) {
            html += '<div style="margin-bottom: 20px; padding: 15px; background: #fff; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
            html += '<h4 style="margin-top: 0; color: #1a1a2e;">Your Team</h4>';
            html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px;">';

            teamRanks.forEach(function (r) {
                var statusColor = r.trackStatusValue === 'on-track-exceptional' ? '#2e7d32' :
                    r.trackStatusValue === 'on-track-successful' ? '#f57f17' : '#c62828';
                var statusBg = r.trackStatusValue === 'on-track-exceptional' ? '#e8f5e9' :
                    r.trackStatusValue === 'on-track-successful' ? '#fff8e1' : '#fbe9e7';
                var percentile = Math.round((1 - (r.rank - 1) / data.totalEmployees) * 100);

                html += '<div style="padding: 12px 16px; background: ' + statusBg + '; border-radius: 8px; border-left: 4px solid ' + statusColor + ';">';
                html += '<div style="font-weight: bold; font-size: 1.05em;">' + _escapeHtml(r.name) + '</div>';
                html += '<div style="margin-top: 4px;">';
                html += '<span style="font-size: 1.3em; font-weight: bold; color: ' + statusColor + ';">#' + r.rank + '</span>';
                html += ' <span style="color: #666; font-size: 0.85em;">of ' + data.totalEmployees + ' (top ' + percentile + '%)</span>';
                html += '</div>';
                html += '<div style="margin-top: 4px; font-size: 0.85em; color: #555;">' + _escapeHtml(r.trackLabel) + ' &mdash; Avg rank: ' + r.compositeScore.toFixed(1) + '</div>';
                html += '<div style="font-size: 0.8em; color: #888;">Reliability: ' + _formatMetricDisplay('reliability', r.reliability) + ' (#' + (r.metricRanks?.reliability || '?') + ')</div>';
                html += '</div>';
            });

            html += '</div></div>';
        }

        // Full ranking table
        html += '<div style="padding: 20px; background: #fff; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
        html += '<h4 style="margin-top: 0; color: #1a1a2e;">Full Center Rankings</h4>';
        html += '<p style="margin: 0 0 12px 0; color: #666; font-size: 0.85em;">Ranked by average position across all 5 metrics. Each metric shows the value and individual rank (#).</p>';
        html += '<div style="overflow-x: auto;">';
        html += '<table style="width: 100%; min-width: 900px; border-collapse: collapse; font-size: 0.88em;">';
        html += '<thead><tr style="background: #f5f5f5;">';
        html += '<th style="padding: 8px 6px; text-align: center; border-bottom: 2px solid #ddd; width: 45px;">Rank</th>';
        html += '<th style="padding: 8px 6px; text-align: left; border-bottom: 2px solid #ddd; min-width: 130px;">Name</th>';
        html += '<th style="padding: 8px 6px; text-align: center; border-bottom: 2px solid #ddd;">Avg Rank</th>';
        html += '<th style="padding: 8px 6px; text-align: center; border-bottom: 2px solid #ddd;">Status</th>';
        html += '<th style="padding: 8px 6px; text-align: center; border-bottom: 2px solid #ddd;">AHT</th>';
        html += '<th style="padding: 8px 6px; text-align: center; border-bottom: 2px solid #ddd;">Adherence</th>';
        html += '<th style="padding: 8px 6px; text-align: center; border-bottom: 2px solid #ddd;">Sentiment</th>';
        html += '<th style="padding: 8px 6px; text-align: center; border-bottom: 2px solid #ddd;">Assoc Overall</th>';
        html += '<th style="padding: 8px 6px; text-align: center; border-bottom: 2px solid #ddd;">Reliability</th>';
        html += '</tr></thead><tbody>';

        data.rankings.forEach(function (r) {
            var isTeam = data.teamMembers.has(r.name);
            var rowBg = isTeam ? '#e8eaf6' : (r.rank % 2 === 0 ? '#fafafa' : '#fff');
            var fontWeight = isTeam ? 'bold' : 'normal';

            var statusColor = r.trackStatusValue === 'on-track-exceptional' ? '#2e7d32' :
                r.trackStatusValue === 'on-track-successful' ? '#f57f17' : '#c62828';

            var scoreColor = function (s) {
                if (s === 3) return '#2e7d32';
                if (s === 2) return '#f57f17';
                return '#c62828';
            };

            html += '<tr style="background: ' + rowBg + '; border-bottom: 1px solid #eee; font-weight: ' + fontWeight + ';">';

            // Rank
            html += '<td style="padding: 8px; text-align: center; font-size: 1.1em; font-weight: bold;">' + r.rank + '</td>';

            // Name (highlight team members)
            html += '<td style="padding: 8px;">';
            if (isTeam) html += '<span style="color: #1565c0;">&#9733; </span>';
            html += _escapeHtml(r.name) + '</td>';

            // Composite average rank
            html += '<td style="padding: 8px; text-align: center; font-weight: bold;">' + r.compositeScore.toFixed(1) + '</td>';

            // Status badge
            html += '<td style="padding: 8px; text-align: center;"><span style="display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold; color: white; background: ' + statusColor + ';">';
            if (r.trackStatusValue === 'on-track-exceptional') html += 'Exceptional';
            else if (r.trackStatusValue === 'on-track-successful') html += 'Successful';
            else html += 'Off Track';
            html += '</span></td>';

            // Individual scores with values
            var metricPairs = [
                { score: r.scores.aht, value: r.values.aht, key: 'aht', rankKey: 'aht' },
                { score: r.scores.adherence, value: r.values.adherence, key: 'scheduleAdherence', rankKey: 'adherence' },
                { score: r.scores.sentiment, value: r.values.sentiment, key: 'overallSentiment', rankKey: 'sentiment' },
                { score: r.scores.associateOverall, value: r.values.associateOverall, key: 'cxRepOverall', rankKey: 'associateOverall' },
                { score: null, value: r.reliability, key: 'reliability', rankKey: 'reliability' }
            ];

            metricPairs.forEach(function (mp) {
                var display = mp.value !== null && mp.value !== undefined ? _formatMetricDisplay(mp.key, mp.value) : '--';
                var color = mp.score !== null ? scoreColor(mp.score) : '#333';
                var metricRank = r.metricRanks?.[mp.rankKey] || '?';
                var rankColor = metricRank <= 10 ? '#2e7d32' : metricRank <= Math.round(data.totalEmployees * 0.5) ? '#666' : '#c62828';
                html += '<td style="padding: 6px; text-align: center; color: ' + color + ';">' +
                    display + ' <span style="font-size: 0.75em; color: ' + rankColor + ';">#' + metricRank + '</span></td>';
            });

            html += '</tr>';
        });

        html += '</tbody></table>';
        html += '</div></div>';

        container.innerHTML = html;
    }

    /* ── Module export ── */
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.centerRanking = {
        renderCenterRanking: renderCenterRanking,
        buildCenterRankings: buildCenterRankings
    };

    window.renderCenterRanking = renderCenterRanking;
})();
