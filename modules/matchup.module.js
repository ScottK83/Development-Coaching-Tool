(function () {
    'use strict';

    var STORAGE_PREFIX = 'devCoachingTool_';

    function _escapeHtml(str) {
        var mod = window.DevCoachModules?.sharedUtils;
        if (mod?.escapeHtml) return mod.escapeHtml(str);
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _formatMetricDisplay(key, value) {
        return typeof window.formatMetricDisplay === 'function' ? window.formatMetricDisplay(key, value) : String(value);
    }

    function _getSupervisors() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'employeeSupervisors') || '{}');
        } catch (_e) { return {}; }
    }

    function _getTeamMembersForWeek(weekKey) {
        return typeof window.getTeamMembersForWeek === 'function' ? window.getTeamMembersForWeek(weekKey) : [];
    }

    function _getLatestWeeklyKey() {
        return typeof window.getLatestWeeklyKey === 'function' ? window.getLatestWeeklyKey() : null;
    }

    // Metric definitions for matchup comparison
    // Each has: key (values obj key), label, lowerIsBetter flag, formatKey (for formatMetricDisplay)
    var MATCHUP_METRICS = [
        { key: 'aht',              label: 'AHT',             lowerIsBetter: true,  formatKey: 'aht' },
        { key: 'adherence',        label: 'Adherence',       lowerIsBetter: false, formatKey: 'scheduleAdherence' },
        { key: 'sentiment',        label: 'Sentiment',       lowerIsBetter: false, formatKey: 'overallSentiment' },
        { key: 'associateOverall', label: 'Assoc Overall',   lowerIsBetter: false, formatKey: 'cxRepOverall' },
        { key: 'reliability',      label: 'Reliability',     lowerIsBetter: true,  formatKey: 'reliability', isTopLevel: true }
    ];

    /**
     * Build matchup data: groups all ranked employees by supervisor,
     * computes team averages, and determines wins per metric.
     */
    function buildMatchupData() {
        var ranking = window.DevCoachModules?.centerRanking;
        if (!ranking?.buildCenterRankings) return null;

        var data = ranking.buildCenterRankings();
        if (!data || !data.rankings.length) return null;

        var supervisors = _getSupervisors();

        // Determine "my team" label — agents with no supervisor assignment
        // who ARE in the user's team members list
        var latestKey = _getLatestWeeklyKey();
        var teamFilter = window.DevCoachModules?.teamFilter;
        if (!latestKey && teamFilter?.getTeamSelectionContext) {
            latestKey = teamFilter.getTeamSelectionContext().weekKey || '';
        }
        var myTeamSet = new Set(latestKey ? _getTeamMembersForWeek(latestKey) : []);

        // Group employees by supervisor
        var teams = {};  // supervisor name -> [ranked employee objects]
        var MY_TEAM = 'My Team';

        data.rankings.forEach(function (r) {
            var sup = supervisors[r.name] || '';
            if (!sup) {
                // If they're on my team, label as "My Team"; otherwise skip
                if (myTeamSet.has(r.name)) {
                    sup = MY_TEAM;
                } else {
                    sup = 'Unassigned';
                }
            }
            if (!teams[sup]) teams[sup] = [];
            teams[sup].push(r);
        });

        // Only include teams that have at least 1 member
        // (Unassigned is kept but displayed last)
        var teamNames = Object.keys(teams).sort(function (a, b) {
            if (a === MY_TEAM) return -1;
            if (b === MY_TEAM) return 1;
            if (a === 'Unassigned') return 1;
            if (b === 'Unassigned') return -1;
            return a.localeCompare(b);
        });

        // Compute team averages per metric
        var teamStats = {};
        teamNames.forEach(function (name) {
            var members = teams[name];
            var stats = { name: name, count: members.length, averages: {}, totalComposite: 0, wins: 0, losses: 0, ties: 0 };

            MATCHUP_METRICS.forEach(function (m) {
                var vals = members.map(function (r) {
                    return m.isTopLevel ? r[m.key] : (r.values ? r.values[m.key] : null);
                }).filter(function (v) { return v !== null && v !== undefined && !isNaN(v); });

                if (vals.length > 0) {
                    stats.averages[m.key] = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
                } else {
                    stats.averages[m.key] = null;
                }
            });

            // Average composite rank
            var composites = members.map(function (r) { return r.compositeScore; }).filter(function (v) { return v !== Infinity; });
            stats.totalComposite = composites.length > 0
                ? composites.reduce(function (a, b) { return a + b; }, 0) / composites.length
                : Infinity;

            // Average rating
            var ratings = members.map(function (r) { return r.ratingAverage; }).filter(function (v) { return v != null; });
            stats.avgRating = ratings.length > 0
                ? ratings.reduce(function (a, b) { return a + b; }, 0) / ratings.length
                : 0;

            teamStats[name] = stats;
        });

        // Head-to-head: compare My Team vs each rival on each metric
        var myStats = teamStats[MY_TEAM];
        if (myStats) {
            teamNames.forEach(function (name) {
                if (name === MY_TEAM || name === 'Unassigned') return;
                var rival = teamStats[name];
                MATCHUP_METRICS.forEach(function (m) {
                    var myVal = myStats.averages[m.key];
                    var rivalVal = rival.averages[m.key];
                    if (myVal === null || rivalVal === null) return;

                    var myWins;
                    if (m.lowerIsBetter) {
                        myWins = myVal < rivalVal;
                    } else {
                        myWins = myVal > rivalVal;
                    }
                    var tie = Math.abs(myVal - rivalVal) < 0.01;

                    if (tie) {
                        myStats.ties++;
                        rival.ties++;
                    } else if (myWins) {
                        myStats.wins++;
                        rival.losses++;
                    } else {
                        myStats.losses++;
                        rival.wins++;
                    }
                });
            });
        }

        return {
            teams: teams,
            teamNames: teamNames,
            teamStats: teamStats,
            rankings: data.rankings,
            totalEmployees: data.totalEmployees,
            source: data.source
        };
    }

    /**
     * Render the full Matchup view
     */
    function renderMatchup() {
        var container = document.getElementById('subSectionTaMatchup');
        if (!container) return;

        var data = buildMatchupData();
        if (!data) {
            container.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 40px;">No matchup data available. Upload a full center data set (30+ employees) and assign supervisors in Settings > Team Members.</p>';
            return;
        }

        // Check if any supervisors are actually assigned (besides My Team and Unassigned)
        var rivalTeams = data.teamNames.filter(function (n) { return n !== 'My Team' && n !== 'Unassigned'; });
        if (rivalTeams.length === 0) {
            container.innerHTML =
                '<div style="padding: 30px; text-align: center;">' +
                '<h3 style="color: #e65100;">🥊 Team Matchup</h3>' +
                '<p style="color: #666; max-width: 500px; margin: 0 auto;">No rival teams found. Go to <strong>Settings > Team Members</strong> and type a supervisor name (e.g. "Nicole P") next to their agents to set up matchups.</p>' +
                '</div>';
            return;
        }

        var html = '';

        // Header
        html += '<div style="margin-bottom: 20px; padding: 15px; background: #fff3e0; border-radius: 8px; border-left: 4px solid #e65100;">';
        html += '<strong>🥊 Team Matchup</strong> &mdash; ' + data.totalEmployees + ' employees across ' + data.teamNames.length + ' teams';
        html += '<br><span style="color: #666; font-size: 0.85em;">Source: ' + _escapeHtml(data.source) + '</span>';
        html += '</div>';

        // Scoreboard: My Team vs each rival
        var myStats = data.teamStats['My Team'];
        if (myStats) {
            rivalTeams.forEach(function (rivalName) {
                var rival = data.teamStats[rivalName];
                html += _renderHeadToHead(myStats, rival, data);
            });
        }

        // Team Rankings table
        html += _renderTeamRankings(data);

        // Per-team member breakdown
        data.teamNames.forEach(function (teamName) {
            if (teamName === 'Unassigned') return;
            html += _renderTeamRoster(teamName, data);
        });

        container.innerHTML = html;
    }

    function _renderHeadToHead(myStats, rivalStats, data) {
        var html = '<div style="margin-bottom: 20px; padding: 20px; background: #fff; border-radius: 12px; border: 2px solid #e65100; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">';

        // Team names header
        html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">';
        html += '<div style="text-align: center; flex: 1;">';
        html += '<div style="font-size: 1.3em; font-weight: bold; color: #1565c0;">My Team</div>';
        html += '<div style="font-size: 0.85em; color: #666;">' + myStats.count + ' agents</div>';
        html += '</div>';
        html += '<div style="font-size: 1.5em; font-weight: bold; color: #e65100; padding: 0 20px;">VS</div>';
        html += '<div style="text-align: center; flex: 1;">';
        html += '<div style="font-size: 1.3em; font-weight: bold; color: #c62828;">' + _escapeHtml(rivalStats.name) + '</div>';
        html += '<div style="font-size: 0.85em; color: #666;">' + rivalStats.count + ' agents</div>';
        html += '</div>';
        html += '</div>';

        // Metric-by-metric bars
        MATCHUP_METRICS.forEach(function (m) {
            var myVal = myStats.averages[m.key];
            var rivalVal = rivalStats.averages[m.key];
            if (myVal === null || rivalVal === null) return;

            var myWins, tie;
            if (m.lowerIsBetter) {
                myWins = myVal < rivalVal;
                tie = Math.abs(myVal - rivalVal) < 0.01;
            } else {
                myWins = myVal > rivalVal;
                tie = Math.abs(myVal - rivalVal) < 0.01;
            }

            var myColor = tie ? '#666' : (myWins ? '#2e7d32' : '#c62828');
            var rivalColor = tie ? '#666' : (myWins ? '#c62828' : '#2e7d32');
            var myBg = tie ? '#f5f5f5' : (myWins ? '#e8f5e9' : '#fbe9e7');
            var rivalBg = tie ? '#f5f5f5' : (myWins ? '#fbe9e7' : '#e8f5e9');
            var icon = tie ? '🤝' : (myWins ? '✅' : '❌');

            html += '<div style="display: flex; align-items: center; margin-bottom: 8px; gap: 8px;">';
            // My team value
            html += '<div style="flex: 1; text-align: right; padding: 8px 12px; background: ' + myBg + '; border-radius: 6px;">';
            html += '<span style="font-weight: bold; color: ' + myColor + ';">' + _formatMetricDisplay(m.formatKey, myVal) + '</span>';
            html += '</div>';
            // Metric label
            html += '<div style="width: 110px; text-align: center; font-size: 0.85em; font-weight: 600; color: #555;">' + icon + ' ' + m.label + '</div>';
            // Rival value
            html += '<div style="flex: 1; text-align: left; padding: 8px 12px; background: ' + rivalBg + '; border-radius: 6px;">';
            html += '<span style="font-weight: bold; color: ' + rivalColor + ';">' + _formatMetricDisplay(m.formatKey, rivalVal) + '</span>';
            html += '</div>';
            html += '</div>';
        });

        // Overall record for this matchup
        var myWinsTotal = 0, rivalWinsTotal = 0, tiesTotal = 0;
        MATCHUP_METRICS.forEach(function (m) {
            var myVal = myStats.averages[m.key];
            var rivalVal = rivalStats.averages[m.key];
            if (myVal === null || rivalVal === null) return;
            var tie = Math.abs(myVal - rivalVal) < 0.01;
            if (tie) { tiesTotal++; return; }
            var myWins = m.lowerIsBetter ? (myVal < rivalVal) : (myVal > rivalVal);
            if (myWins) myWinsTotal++; else rivalWinsTotal++;
        });

        var recordColor = myWinsTotal > rivalWinsTotal ? '#2e7d32' : (myWinsTotal < rivalWinsTotal ? '#c62828' : '#666');
        html += '<div style="text-align: center; margin-top: 12px; padding: 10px; background: #f5f5f5; border-radius: 8px;">';
        html += '<span style="font-size: 1.2em; font-weight: bold; color: ' + recordColor + ';">';
        html += myWinsTotal + 'W - ' + rivalWinsTotal + 'L';
        if (tiesTotal > 0) html += ' - ' + tiesTotal + 'T';
        html += '</span>';
        html += '</div>';

        html += '</div>';
        return html;
    }

    function _renderTeamRankings(data) {
        // Sort teams by avg composite score (lower = better), skip Unassigned
        var sortedTeams = data.teamNames
            .filter(function (n) { return n !== 'Unassigned'; })
            .map(function (n) { return data.teamStats[n]; })
            .sort(function (a, b) { return a.totalComposite - b.totalComposite; });

        var html = '<div style="margin-bottom: 20px; padding: 20px; background: #fff; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
        html += '<h4 style="margin-top: 0; color: #1a1a2e;">Team Power Rankings</h4>';

        html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.88em;">';
        html += '<thead><tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">';
        html += '<th style="padding: 8px; text-align: center; width: 40px;">#</th>';
        html += '<th style="padding: 8px; text-align: left;">Team</th>';
        html += '<th style="padding: 8px; text-align: center;">Agents</th>';
        html += '<th style="padding: 8px; text-align: center;">Avg Score</th>';
        html += '<th style="padding: 8px; text-align: center;">Avg Rank</th>';

        MATCHUP_METRICS.forEach(function (m) {
            html += '<th style="padding: 8px; text-align: center;">' + m.label + '</th>';
        });

        html += '<th style="padding: 8px; text-align: center;">Record</th>';
        html += '</tr></thead><tbody>';

        sortedTeams.forEach(function (team, idx) {
            var isMyTeam = team.name === 'My Team';
            var rowBg = isMyTeam ? '#e8eaf6' : (idx % 2 === 0 ? '#fff' : '#fafafa');
            var fontWeight = isMyTeam ? 'bold' : 'normal';

            html += '<tr style="background: ' + rowBg + '; border-bottom: 1px solid #eee; font-weight: ' + fontWeight + ';">';
            html += '<td style="padding: 8px; text-align: center; font-weight: bold;">' + (idx + 1) + '</td>';
            html += '<td style="padding: 8px;">' + (isMyTeam ? '<span style="color: #1565c0;">★ </span>' : '') + _escapeHtml(team.name) + '</td>';
            html += '<td style="padding: 8px; text-align: center;">' + team.count + '</td>';
            html += '<td style="padding: 8px; text-align: center;">' + (team.avgRating ? team.avgRating.toFixed(2) : '--') + '</td>';
            html += '<td style="padding: 8px; text-align: center;">' + (team.totalComposite !== Infinity ? team.totalComposite.toFixed(1) : '--') + '</td>';

            MATCHUP_METRICS.forEach(function (m) {
                var val = team.averages[m.key];
                html += '<td style="padding: 8px; text-align: center;">' + (val !== null ? _formatMetricDisplay(m.formatKey, val) : '--') + '</td>';
            });

            html += '<td style="padding: 8px; text-align: center;">';
            var wColor = team.wins > team.losses ? '#2e7d32' : (team.wins < team.losses ? '#c62828' : '#666');
            html += '<span style="color: ' + wColor + '; font-weight: bold;">' + team.wins + 'W-' + team.losses + 'L</span>';
            html += '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }

    function _renderTeamRoster(teamName, data) {
        var members = data.teams[teamName] || [];
        if (members.length === 0) return '';

        var isMyTeam = teamName === 'My Team';
        var borderColor = isMyTeam ? '#1565c0' : '#e65100';
        var headerBg = isMyTeam ? '#e3f2fd' : '#fff3e0';

        var html = '<div style="margin-bottom: 16px; border-radius: 8px; border: 1px solid #ddd; overflow: hidden;">';
        html += '<div style="padding: 12px 16px; background: ' + headerBg + '; border-left: 4px solid ' + borderColor + ';">';
        html += '<strong>' + _escapeHtml(teamName) + '</strong> <span style="color: #666; font-size: 0.85em;">(' + members.length + ' agents)</span>';
        html += '</div>';

        html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.82em;">';
        html += '<thead><tr style="background: #f5f5f5;">';
        html += '<th style="padding: 6px 8px; text-align: center; width: 35px;">#</th>';
        html += '<th style="padding: 6px 8px; text-align: left;">Name</th>';
        html += '<th style="padding: 6px 8px; text-align: center;">Score</th>';
        html += '<th style="padding: 6px 8px; text-align: center;">Center Rank</th>';

        MATCHUP_METRICS.forEach(function (m) {
            html += '<th style="padding: 6px 8px; text-align: center;">' + m.label + '</th>';
        });

        html += '</tr></thead><tbody>';

        // Sort members within team by composite score
        var sorted = members.slice().sort(function (a, b) { return a.compositeScore - b.compositeScore; });

        sorted.forEach(function (r, idx) {
            var statusColor = r.trackStatusValue === 'on-track-exceptional' ? '#2e7d32' :
                r.trackStatusValue === 'on-track-successful' ? '#f57f17' : '#c62828';

            html += '<tr style="border-bottom: 1px solid #eee; background: ' + (idx % 2 === 0 ? '#fff' : '#fafafa') + ';">';
            html += '<td style="padding: 5px 8px; text-align: center; font-weight: bold;">' + (idx + 1) + '</td>';
            html += '<td style="padding: 5px 8px;">' + _escapeHtml(r.name) + '</td>';
            html += '<td style="padding: 5px 8px; text-align: center; color: ' + statusColor + '; font-weight: bold;">' + r.ratingAverage.toFixed(2) + '</td>';
            html += '<td style="padding: 5px 8px; text-align: center;">#' + r.rank + ' <span style="font-size: 0.75em; color: #888;">of ' + data.totalEmployees + '</span></td>';

            MATCHUP_METRICS.forEach(function (m) {
                var val = m.isTopLevel ? r[m.key] : (r.values ? r.values[m.key] : null);
                var metricRank = r.metricRanks?.[m.key] || '?';
                var display = val !== null && val !== undefined ? _formatMetricDisplay(m.formatKey, val) : '--';
                html += '<td style="padding: 5px 8px; text-align: center;">' + display + ' <span style="font-size: 0.72em; color: #888;">#' + metricRank + '</span></td>';
            });

            html += '</tr>';
        });

        html += '</tbody></table></div>';
        return html;
    }

    /* ── Module export ── */
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.matchup = {
        renderMatchup: renderMatchup,
        buildMatchupData: buildMatchupData
    };
})();
