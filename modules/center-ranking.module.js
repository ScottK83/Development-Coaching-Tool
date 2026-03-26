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
        var weeklyData = typeof window.weeklyData !== 'undefined' ? window.weeklyData : {};
        var ytdData = typeof window.ytdData !== 'undefined' ? window.ytdData : {};

        // Find the period with the most employees (likely a full center upload)
        var bestPeriod = null;
        var bestCount = 0;
        var bestSource = '';
        var bestKey = '';

        // Check YTD data first (source of truth)
        Object.entries(ytdData).forEach(function (entry) {
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
        Object.entries(weeklyData).forEach(function (entry) {
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

        // Sort: highest ratingAverage first, reliability (lower = better) as tiebreaker
        rankings.sort(function (a, b) {
            if (b.ratingAverage !== a.ratingAverage) return b.ratingAverage - a.ratingAverage;
            return a.reliability - b.reliability; // lower reliability hours = better
        });

        // Assign ranks (handle ties)
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
                html += '<div style="margin-top: 4px; font-size: 0.85em; color: #555;">Rating: ' + r.ratingAverage.toFixed(2) + ' &mdash; ' + _escapeHtml(r.trackLabel) + '</div>';
                html += '<div style="font-size: 0.8em; color: #888;">Reliability: ' + _formatMetricDisplay('reliability', r.reliability) + '</div>';
                html += '</div>';
            });

            html += '</div></div>';
        }

        // Full ranking table
        html += '<div style="padding: 20px; background: #fff; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
        html += '<h4 style="margin-top: 0; color: #1a1a2e;">Full Center Rankings</h4>';
        html += '<div style="overflow-x: auto;">';
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
        html += '<thead><tr style="background: #f5f5f5;">';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd; width: 50px;">Rank</th>';
        html += '<th style="padding: 10px 8px; text-align: left; border-bottom: 2px solid #ddd;">Name</th>';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Rating Avg</th>';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Status</th>';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">AHT</th>';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Adherence</th>';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Sentiment</th>';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Assoc Overall</th>';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Reliability</th>';
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

            // Rating average
            html += '<td style="padding: 8px; text-align: center; font-weight: bold;">' + r.ratingAverage.toFixed(2) + '</td>';

            // Status badge
            html += '<td style="padding: 8px; text-align: center;"><span style="display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 0.8em; font-weight: bold; color: white; background: ' + statusColor + ';">';
            if (r.trackStatusValue === 'on-track-exceptional') html += 'Exceptional';
            else if (r.trackStatusValue === 'on-track-successful') html += 'Successful';
            else html += 'Off Track';
            html += '</span></td>';

            // Individual scores with values
            var metricPairs = [
                { score: r.scores.aht, value: r.values.aht, key: 'aht' },
                { score: r.scores.adherence, value: r.values.adherence, key: 'scheduleAdherence' },
                { score: r.scores.sentiment, value: r.values.sentiment, key: 'overallSentiment' },
                { score: r.scores.associateOverall, value: r.values.associateOverall, key: 'cxRepOverall' },
                { score: null, value: r.reliability, key: 'reliability' }
            ];

            metricPairs.forEach(function (mp) {
                var display = mp.value !== null && mp.value !== undefined ? _formatMetricDisplay(mp.key, mp.value) : '--';
                var color = mp.score !== null ? scoreColor(mp.score) : '#333';
                var scoreBadge = mp.score !== null ? ' <span style="font-size: 0.7em; opacity: 0.7;">(' + mp.score + ')</span>' : '';
                html += '<td style="padding: 8px; text-align: center; color: ' + color + ';">' + display + scoreBadge + '</td>';
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
