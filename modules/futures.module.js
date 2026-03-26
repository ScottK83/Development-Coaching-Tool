(function () {
    'use strict';

    /* ── Global helpers accessed via window ── */
    function _getWeeklyData() {
        return typeof weeklyData !== 'undefined' ? weeklyData : {};
    }
    function _getYtdData() {
        return typeof ytdData !== 'undefined' ? ytdData : {};
    }
    function _getWeeklyKeysSorted() {
        return typeof window.getWeeklyKeysSorted === 'function' ? window.getWeeklyKeysSorted() : Object.keys(_getWeeklyData());
    }
    function _getTeamMembersForWeek(weekKey) {
        return typeof window.getTeamMembersForWeek === 'function' ? window.getTeamMembersForWeek(weekKey) : [];
    }
    function _formatMetricDisplay(key, value) {
        return typeof window.formatMetricDisplay === 'function' ? window.formatMetricDisplay(key, value) : String(value);
    }
    function _escapeHtml(str) {
        var mod = window.DevCoachModules?.sharedUtils;
        if (mod?.escapeHtml) return mod.escapeHtml(str);
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Metrics to project (the meaningful ones with targets)
    var FUTURES_METRICS = [
        'scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience',
        'transfers', 'overallSentiment', 'positiveWord', 'negativeWord',
        'managingEmotions', 'aht', 'acw', 'holdTime', 'reliability'
    ];

    // Cumulative metrics are summed across periods, not averaged.
    // The "need to average" projection doesn't apply — it's "budget remaining".
    var CUMULATIVE_METRICS = new Set(['reliability']);

    /**
     * Estimate total weeks in the year and weeks completed based on uploaded data
     */
    function estimateWeekCounts() {
        var currentYear = new Date().getFullYear();
        var keys = _getWeeklyKeysSorted();
        var yearKeys = keys.filter(function (k) {
            var endStr = k.split('|')[1] || '';
            return parseInt(endStr.split('-')[0], 10) === currentYear;
        });

        var weeksCompleted = yearKeys.length;
        var totalWeeks = 52;
        var weeksRemaining = Math.max(0, totalWeeks - weeksCompleted);

        return {
            currentYear: currentYear,
            weeksCompleted: weeksCompleted,
            totalWeeks: totalWeeks,
            weeksRemaining: weeksRemaining,
            yearKeys: yearKeys
        };
    }

    // Metrics that should be weighted by surveyTotal instead of totalCalls
    var SURVEY_WEIGHTED = new Set(['cxRepOverall', 'fcr', 'overallExperience']);

    // Rate metrics that get weighted-averaged (matches buildYtdAggregateForYear)
    var RATE_METRICS = new Set([
        'scheduleAdherence', 'transfers', 'cxRepOverall', 'fcr', 'overallExperience',
        'aht', 'talkTime', 'acw', 'holdTime', 'overallSentiment', 'managingEmotions',
        'negativeWord', 'positiveWord'
    ]);

    /**
     * Aggregate YTD values directly from weekly data uploads.
     * Uses the same rules as buildYtdAggregateForYear but WITHOUT the
     * anchor pattern, so it always reflects the actual weekly uploads.
     *
     * - Rate metrics: weighted average (by totalCalls or surveyTotal)
     * - Cumulative metrics (reliability): summed
     */
    function aggregateFromWeeklyData(yearKeys) {
        var wData = _getWeeklyData();

        // Filter to one source type to avoid double-counting overlapping periods
        // (e.g., weekly + monthly/quarterly covering the same timeframe).
        // Matches buildYtdAggregateForYear's sourceTypePriority logic.
        var sourceTypePriority = ['week', 'month', 'quarter', 'custom', 'daily'];
        var periodsByType = {};
        yearKeys.forEach(function (weekKey) {
            var period = wData[weekKey];
            if (!period) return;
            var pType = period.metadata?.periodType || 'week';
            if (!periodsByType[pType]) periodsByType[pType] = [];
            periodsByType[pType].push(weekKey);
        });

        var chosenType = null;
        for (var i = 0; i < sourceTypePriority.length; i++) {
            if (periodsByType[sourceTypePriority[i]] && periodsByType[sourceTypePriority[i]].length > 0) {
                chosenType = sourceTypePriority[i];
                break;
            }
        }
        var filteredKeys = chosenType ? periodsByType[chosenType] : yearKeys;

        var empAgg = {}; // { name: { totalCalls, surveyTotal, reliability, weightedSums, weightedCounts } }

        filteredKeys.forEach(function (weekKey) {
            var period = wData[weekKey];
            if (!period || !period.employees) return;

            period.employees.forEach(function (emp) {
                if (!emp || !emp.name) return;

                if (!empAgg[emp.name]) {
                    empAgg[emp.name] = {
                        name: emp.name,
                        totalCalls: 0,
                        surveyTotal: 0,
                        reliability: 0,
                        weightedSums: {},
                        weightedCounts: {}
                    };
                }

                var agg = empAgg[emp.name];
                var tc = parseInt(emp.totalCalls, 10);
                var st = parseInt(emp.surveyTotal, 10);

                agg.totalCalls += Number.isInteger(tc) ? tc : 0;
                agg.surveyTotal += Number.isInteger(st) ? st : 0;

                // Reliability: sum (cumulative hours)
                var rel = parseFloat(emp.reliability);
                if (Number.isFinite(rel)) agg.reliability += rel;

                // Rate metrics: accumulate weighted sums
                RATE_METRICS.forEach(function (mk) {
                    var val = parseFloat(emp[mk]);
                    if (!Number.isFinite(val)) return;

                    var weight = 1;
                    if (SURVEY_WEIGHTED.has(mk)) {
                        weight = Number.isInteger(st) && st > 0 ? st : 0;
                    } else {
                        weight = Number.isInteger(tc) && tc > 0 ? tc : 1;
                    }
                    if (weight <= 0) return;

                    agg.weightedSums[mk] = (agg.weightedSums[mk] || 0) + (val * weight);
                    agg.weightedCounts[mk] = (agg.weightedCounts[mk] || 0) + weight;
                });
            });
        });

        // Finalize: compute weighted averages
        var employees = [];
        Object.keys(empAgg).forEach(function (name) {
            var agg = empAgg[name];
            var result = { name: name, reliability: agg.reliability, totalCalls: agg.totalCalls };

            RATE_METRICS.forEach(function (mk) {
                var totalWeight = agg.weightedCounts[mk] || 0;
                if (totalWeight > 0) {
                    result[mk] = agg.weightedSums[mk] / totalWeight;
                }
            });

            employees.push(result);
        });

        var sourceLabel = filteredKeys.length + ' ' + (chosenType || 'period') + (filteredKeys.length !== 1 ? 's' : '') + ' aggregated';
        return employees.length > 0
            ? { employees: employees, source: sourceLabel, periodCount: filteredKeys.length, periodType: chosenType }
            : null;
    }

    /**
     * Calculate what an employee needs to average for the rest of the year
     * to hit a specific target (for rate/averaged metrics only).
     */
    function calculateRequiredAverage(currentAvg, weeksCompleted, weeksRemaining, target) {
        if (weeksRemaining <= 0) return null;
        var totalNeeded = target * (weeksCompleted + weeksRemaining);
        var currentTotal = currentAvg * weeksCompleted;
        var required = (totalNeeded - currentTotal) / weeksRemaining;
        return required;
    }

    /**
     * Determine if a required average is achievable
     */
    function isAchievable(metricKey, requiredAvg) {
        var metric = window.METRICS_REGISTRY[metricKey];
        if (!metric) return true;
        if (requiredAvg < 0) return false;
        if (metric.unit === '%' && requiredAvg > 100) return false;
        return true;
    }

    /**
     * Build futures projection data for all team members
     */
    function buildFuturesData() {
        var weekInfo = estimateWeekCounts();
        var currentYear = weekInfo.currentYear;
        var wData = _getWeeklyData();
        var latestKey = weekInfo.yearKeys.length > 0 ? weekInfo.yearKeys[weekInfo.yearKeys.length - 1] : null;

        // Get team members from latest week
        var teamMembers = [];
        if (latestKey && wData[latestKey]) {
            var members = _getTeamMembersForWeek(latestKey);
            var allEmps = (wData[latestKey].employees || []).map(function (e) { return e.name; });
            teamMembers = members.length > 0 ? allEmps.filter(function (n) { return members.includes(n); }) : allEmps;
        }

        // Aggregate directly from weekly data (proper weighted averages + sums)
        // Filters to one source type to avoid double-counting overlapping periods
        var ytdResult = aggregateFromWeeklyData(weekInfo.yearKeys);
        var ytdEmployees = ytdResult ? ytdResult.employees : [];
        var ytdSource = ytdResult ? ytdResult.source : '';

        // Use the actual filtered period count for projection math
        if (ytdResult && ytdResult.periodCount) {
            weekInfo.weeksCompleted = ytdResult.periodCount;
            weekInfo.weeksRemaining = Math.max(0, weekInfo.totalWeeks - weekInfo.weeksCompleted);
        }

        var targets = window.DevCoachModules?.metricProfiles?.TARGETS_BY_YEAR?.[currentYear] || {};
        var ratingBands = window.DevCoachModules?.metricProfiles?.RATING_BANDS_BY_YEAR?.[currentYear] || {};

        var results = [];
        teamMembers.forEach(function (empName) {
            // Find this employee in the aggregated YTD data
            var ytdEmp = null;
            for (var i = 0; i < ytdEmployees.length; i++) {
                if (ytdEmployees[i].name === empName) {
                    ytdEmp = ytdEmployees[i];
                    break;
                }
            }
            if (!ytdEmp) return;

            var empResult = {
                name: empName,
                dataSource: ytdSource,
                metrics: {}
            };

            FUTURES_METRICS.forEach(function (metricKey) {
                var targetConfig = targets[metricKey];
                if (!targetConfig) return;

                var val = parseFloat(ytdEmp[metricKey]);
                if (isNaN(val)) return;

                var currentValue = val;
                var meetTarget = targetConfig.value;
                var isReverse = targetConfig.type === 'max';
                var isCumulative = CUMULATIVE_METRICS.has(metricKey);

                // Determine "exceed" target from rating bands (score 3)
                var exceedTarget = meetTarget;
                var bandConfig = ratingBands[metricKey];
                if (bandConfig) {
                    exceedTarget = isReverse ? bandConfig.score3.max : bandConfig.score3.min;
                }

                var requiredToMeet = null;
                var requiredToExceed = null;
                var meetAchievable = null;
                var exceedAchievable = null;
                var currentlyMeeting, currentlyExceeding;
                var budgetRemaining = null;
                var exceedBudgetRemaining = null;

                if (isCumulative) {
                    // Cumulative metrics (reliability): compare total used vs annual max
                    currentlyMeeting = currentValue <= meetTarget;
                    currentlyExceeding = bandConfig
                        ? (currentValue <= exceedTarget)
                        : currentlyMeeting;
                    budgetRemaining = meetTarget - currentValue;
                    exceedBudgetRemaining = bandConfig ? exceedTarget - currentValue : null;
                } else {
                    // Rate metrics: use weighted average projection
                    currentlyMeeting = isReverse ? (currentValue <= meetTarget) : (currentValue >= meetTarget);
                    currentlyExceeding = bandConfig
                        ? (isReverse ? (currentValue <= exceedTarget) : (currentValue >= exceedTarget))
                        : currentlyMeeting;

                    requiredToMeet = calculateRequiredAverage(currentValue, weekInfo.weeksCompleted, weekInfo.weeksRemaining, meetTarget);
                    requiredToExceed = calculateRequiredAverage(currentValue, weekInfo.weeksCompleted, weekInfo.weeksRemaining, exceedTarget);
                    meetAchievable = requiredToMeet !== null ? isAchievable(metricKey, requiredToMeet) : null;
                    exceedAchievable = requiredToExceed !== null ? isAchievable(metricKey, requiredToExceed) : null;
                }

                empResult.metrics[metricKey] = {
                    currentAvg: currentValue,
                    meetTarget: meetTarget,
                    exceedTarget: exceedTarget,
                    requiredToMeet: requiredToMeet,
                    requiredToExceed: requiredToExceed,
                    meetAchievable: meetAchievable,
                    exceedAchievable: exceedAchievable,
                    currentlyMeeting: currentlyMeeting,
                    currentlyExceeding: currentlyExceeding,
                    isReverse: isReverse,
                    hasExceedBand: !!bandConfig,
                    isCumulative: isCumulative,
                    budgetRemaining: budgetRemaining,
                    exceedBudgetRemaining: exceedBudgetRemaining
                };
            });

            results.push(empResult);
        });

        return {
            weekInfo: weekInfo,
            employees: results
        };
    }

    /**
     * Render the futures projection table
     */
    function renderFutures() {
        var container = document.getElementById('futuresContent');
        if (!container) return;

        var data = buildFuturesData();
        var weekInfo = data.weekInfo;

        if (data.employees.length === 0) {
            container.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 40px;">No data available. Upload weekly data to see projections.</p>';
            return;
        }

        var html = '';

        // Summary header
        html += '<div style="margin-bottom: 20px; padding: 15px; background: #e8f5e9; border-radius: 8px; border-left: 4px solid #4caf50;">';
        html += '<strong>Year Progress:</strong> ' + weekInfo.weeksCompleted + ' weeks completed, ' + weekInfo.weeksRemaining + ' weeks remaining in ' + weekInfo.currentYear;
        html += '</div>';

        // Employee selector
        html += '<div style="margin-bottom: 20px; padding: 15px; background: #fff; border-radius: 8px; border: 1px solid #ddd;">';
        html += '<label for="futuresEmployeeSelect" style="font-weight: bold; display: block; margin-bottom: 8px;">Select Associate:</label>';
        html += '<select id="futuresEmployeeSelect" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; cursor: pointer;">';
        html += '<option value="__all__">All Team Members</option>';
        data.employees.forEach(function (emp) {
            html += '<option value="' + _escapeHtml(emp.name) + '">' + _escapeHtml(emp.name) + '</option>';
        });
        html += '</select>';
        html += '</div>';

        // Content area
        html += '<div id="futuresTableContainer"></div>';

        container.innerHTML = html;

        // Bind employee select
        var select = document.getElementById('futuresEmployeeSelect');
        if (select) {
            select.addEventListener('change', function () {
                renderFuturesTable(data, select.value);
            });
        }

        // Initial render
        renderFuturesTable(data, '__all__');
    }

    function renderFuturesTable(data, selectedEmployee) {
        var tableContainer = document.getElementById('futuresTableContainer');
        if (!tableContainer) return;

        var employees = selectedEmployee === '__all__'
            ? data.employees
            : data.employees.filter(function (e) { return e.name === selectedEmployee; });

        if (employees.length === 0) {
            tableContainer.innerHTML = '<p style="color: #94a3b8; text-align: center;">No data for selected employee.</p>';
            return;
        }

        var html = '';

        employees.forEach(function (emp) {
            html += '<div style="margin-bottom: 24px; padding: 20px; background: #fff; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
            html += '<h3 style="margin-top: 0; color: #1a1a2e; border-bottom: 2px solid #4caf50; padding-bottom: 8px;">' + _escapeHtml(emp.name) + '</h3>';

            if (emp.dataSource) {
                html += '<p style="margin: 0 0 12px 0; color: #666; font-size: 0.85em;">Source: ' + _escapeHtml(emp.dataSource) + '</p>';
            }

            // Table
            html += '<div style="overflow-x: auto;">';
            html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
            html += '<thead><tr style="background: #f5f5f5;">';
            html += '<th style="padding: 10px 8px; text-align: left; border-bottom: 2px solid #ddd;">Metric</th>';
            html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">YTD</th>';
            html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Target</th>';
            html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Status</th>';
            html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd; background: #e8f5e9;">Need to Meet</th>';
            html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd; background: #e3f2fd;">Need to Exceed</th>';
            html += '</tr></thead><tbody>';

            var metricKeys = Object.keys(emp.metrics);
            if (metricKeys.length === 0) {
                html += '<tr><td colspan="6" style="padding: 15px; text-align: center; color: #999;">No metric data available</td></tr>';
            }

            metricKeys.forEach(function (metricKey) {
                var m = emp.metrics[metricKey];
                var metric = window.METRICS_REGISTRY[metricKey];
                if (!metric) return;

                var icon = metric.icon || '';
                var label = metric.label || metricKey;

                // Row background based on status
                var rowBg = m.currentlyMeeting ? '#f1f8e9' : '#fff3e0';
                if (m.currentlyExceeding) rowBg = '#e8f5e9';

                html += '<tr style="background: ' + rowBg + '; border-bottom: 1px solid #eee;">';

                // Metric name
                html += '<td style="padding: 8px; font-weight: 500;">' + icon + ' ' + _escapeHtml(label) + '</td>';

                // Current YTD value
                html += '<td style="padding: 8px; text-align: center; font-weight: bold;">' + _formatMetricDisplay(metricKey, m.currentAvg) + '</td>';

                // Target
                html += '<td style="padding: 8px; text-align: center; color: #666;">' + _formatMetricDisplay(metricKey, m.meetTarget) + '</td>';

                // Status badge
                var statusText, statusColor;
                if (m.currentlyExceeding) {
                    statusText = 'Exceeding';
                    statusColor = '#2e7d32';
                } else if (m.currentlyMeeting) {
                    statusText = 'Meeting';
                    statusColor = '#f57f17';
                } else {
                    statusText = 'Below';
                    statusColor = '#c62828';
                }
                html += '<td style="padding: 8px; text-align: center;"><span style="display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 0.85em; font-weight: bold; color: white; background: ' + statusColor + ';">' + statusText + '</span></td>';

                // Required to meet
                html += '<td style="padding: 8px; text-align: center; background: rgba(232,245,233,0.3);">';
                if (m.isCumulative) {
                    if (m.currentlyMeeting) {
                        html += '<span style="color: #2e7d32; font-weight: bold;">' + _formatMetricDisplay(metricKey, m.budgetRemaining) + ' remaining</span>';
                    } else {
                        html += '<span style="color: #c62828; font-weight: bold;">Over by ' + _formatMetricDisplay(metricKey, Math.abs(m.budgetRemaining)) + '</span>';
                    }
                } else if (m.currentlyMeeting) {
                    html += '<span style="color: #2e7d32; font-weight: bold;">On track</span>';
                } else if (m.requiredToMeet !== null && m.meetAchievable) {
                    html += '<span style="color: #e65100; font-weight: bold;">' + _formatMetricDisplay(metricKey, m.requiredToMeet) + '</span>';
                } else if (m.requiredToMeet !== null && !m.meetAchievable) {
                    html += '<span style="color: #c62828; font-size: 0.85em;">Not achievable</span>';
                } else {
                    html += '<span style="color: #999;">N/A</span>';
                }
                html += '</td>';

                // Required to exceed
                html += '<td style="padding: 8px; text-align: center; background: rgba(227,242,253,0.3);">';
                if (!m.hasExceedBand) {
                    html += '<span style="color: #999; font-size: 0.85em;">No band</span>';
                } else if (m.isCumulative) {
                    if (m.currentlyExceeding) {
                        html += '<span style="color: #1565c0; font-weight: bold;">' + _formatMetricDisplay(metricKey, m.exceedBudgetRemaining) + ' remaining</span>';
                    } else {
                        html += '<span style="color: #c62828; font-weight: bold;">Over by ' + _formatMetricDisplay(metricKey, Math.abs(m.exceedBudgetRemaining)) + '</span>';
                    }
                } else if (m.currentlyExceeding) {
                    html += '<span style="color: #1565c0; font-weight: bold;">On track</span>';
                } else if (m.requiredToExceed !== null && m.exceedAchievable) {
                    html += '<span style="color: #1565c0; font-weight: bold;">' + _formatMetricDisplay(metricKey, m.requiredToExceed) + '</span>';
                } else if (m.requiredToExceed !== null && !m.exceedAchievable) {
                    html += '<span style="color: #c62828; font-size: 0.85em;">Not achievable</span>';
                } else {
                    html += '<span style="color: #999;">N/A</span>';
                }
                html += '</td>';

                html += '</tr>';
            });

            html += '</tbody></table>';
            html += '</div>';

            // Summary callout
            var meetingCount = 0;
            var exceedingCount = 0;
            var belowCount = 0;
            var notAchievableCount = 0;
            metricKeys.forEach(function (mk) {
                var mm = emp.metrics[mk];
                if (mm.currentlyExceeding) exceedingCount++;
                else if (mm.currentlyMeeting) meetingCount++;
                else {
                    belowCount++;
                    if (!mm.isCumulative && mm.requiredToMeet !== null && !mm.meetAchievable) notAchievableCount++;
                }
            });

            html += '<div style="margin-top: 12px; display: flex; gap: 12px; flex-wrap: wrap;">';
            if (exceedingCount > 0) {
                html += '<span style="padding: 6px 14px; border-radius: 16px; background: #e8f5e9; color: #2e7d32; font-weight: bold; font-size: 0.9em;">' + exceedingCount + ' Exceeding</span>';
            }
            if (meetingCount > 0) {
                html += '<span style="padding: 6px 14px; border-radius: 16px; background: #fff8e1; color: #f57f17; font-weight: bold; font-size: 0.9em;">' + meetingCount + ' Meeting</span>';
            }
            if (belowCount > 0) {
                html += '<span style="padding: 6px 14px; border-radius: 16px; background: #fbe9e7; color: #c62828; font-weight: bold; font-size: 0.9em;">' + belowCount + ' Below</span>';
            }
            if (notAchievableCount > 0) {
                html += '<span style="padding: 6px 14px; border-radius: 16px; background: #f8d7da; color: #721c24; font-weight: bold; font-size: 0.9em;">' + notAchievableCount + ' Not Achievable</span>';
            }
            html += '</div>';

            html += '</div>';
        });

        tableContainer.innerHTML = html;
    }

    /* ── Module export ── */
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.futures = {
        renderFutures: renderFutures,
        buildFuturesData: buildFuturesData
    };

    window.renderFutures = renderFutures;
})();
