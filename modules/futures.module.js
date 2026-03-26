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
    function _metricMeetsTarget(metricKey, value) {
        return typeof window.metricMeetsTarget === 'function' ? window.metricMeetsTarget(metricKey, value) : false;
    }
    function _isReverseMetric(metricKey) {
        return typeof window.isReverseMetric === 'function' ? window.isReverseMetric(metricKey) : false;
    }
    function _escapeHtml(str) {
        var mod = window.DevCoachModules?.sharedUtils;
        if (mod?.escapeHtml) return mod.escapeHtml(str);
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function _getRatingScore(metricKey, value, year) {
        return typeof window.getMetricRatingScore === 'function' ? window.getMetricRatingScore(metricKey, value, year) : null;
    }

    // Metrics to project (the meaningful ones with targets)
    var FUTURES_METRICS = [
        'scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience',
        'transfers', 'overallSentiment', 'positiveWord', 'negativeWord',
        'managingEmotions', 'aht', 'acw', 'holdTime', 'reliability'
    ];

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
        // Estimate total weeks: 52 per year
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

    /**
     * Get the YTD average for an employee on a metric.
     * Computes the real average from all weekly data for the current year.
     * Falls back to YTD uploads only when no weekly data exists.
     */
    function getBestYtdValueForEmployee(employeeName, metricKey, currentYear, yearKeys) {
        // Primary: calculate average from all weekly data for the year
        var wData = _getWeeklyData();
        var sum = 0;
        var count = 0;

        yearKeys.forEach(function (weekKey) {
            var period = wData[weekKey];
            if (!period || !period.employees) return;
            period.employees.forEach(function (emp) {
                if (emp.name === employeeName) {
                    var val = parseFloat(emp[metricKey]);
                    if (!isNaN(val)) {
                        sum += val;
                        count++;
                    }
                }
            });
        });

        if (count > 0) {
            return { value: sum / count, count: count, source: count + ' weeks averaged' };
        }

        // Fallback: check YTD uploads if employee has no weekly data
        var ytd = _getYtdData();
        var bestVal = null;
        var bestDate = 0;
        var bestLabel = '';

        Object.keys(ytd).forEach(function (periodKey) {
            var period = ytd[periodKey];
            var meta = period?.metadata || {};
            var endStr = meta.endDate || (periodKey.includes('|') ? periodKey.split('|')[1] : '');
            var endDate = endStr ? new Date(endStr) : null;
            if (!endDate || isNaN(endDate) || endDate.getFullYear() !== currentYear) return;

            (period.employees || []).forEach(function (emp) {
                if (emp.name === employeeName) {
                    var val = parseFloat(emp[metricKey]);
                    if (!isNaN(val) && endDate.getTime() > bestDate) {
                        bestVal = val;
                        bestDate = endDate.getTime();
                        bestLabel = meta.label || periodKey;
                    }
                }
            });
        });

        if (bestVal !== null) {
            return { value: bestVal, count: 1, source: bestLabel };
        }

        return null;
    }

    /**
     * Calculate what an employee needs to average for the rest of the year
     * to hit a specific target.
     *
     * For "min" metrics: (target * totalWeeks - currentAvg * weeksCompleted) / weeksRemaining
     * For "max" metrics: same formula (they need to be at or below target)
     */
    function calculateRequiredAverage(currentAvg, weeksCompleted, weeksRemaining, target) {
        if (weeksRemaining <= 0) return null; // year is done
        var totalNeeded = target * (weeksCompleted + weeksRemaining);
        var currentTotal = currentAvg * weeksCompleted;
        var required = (totalNeeded - currentTotal) / weeksRemaining;
        return required;
    }

    /**
     * Determine if a required average is achievable
     * For percentage metrics: must be between 0 and 100
     * For time metrics: must be >= 0
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

        // Get unique team member names from latest week
        var teamMembers = [];
        if (latestKey && wData[latestKey]) {
            var members = _getTeamMembersForWeek(latestKey);
            var allEmps = (wData[latestKey].employees || []).map(function (e) { return e.name; });
            teamMembers = members.length > 0 ? allEmps.filter(function (n) { return members.includes(n); }) : allEmps;
        }

        var targets = window.DevCoachModules?.metricProfiles?.TARGETS_BY_YEAR?.[currentYear] || {};
        var ratingBands = window.DevCoachModules?.metricProfiles?.RATING_BANDS_BY_YEAR?.[currentYear] || {};

        var results = [];
        teamMembers.forEach(function (empName) {
            var empResult = {
                name: empName,
                metrics: {}
            };

            FUTURES_METRICS.forEach(function (metricKey) {
                var targetConfig = targets[metricKey];
                if (!targetConfig) return;

                var bestData = getBestYtdValueForEmployee(empName, metricKey, currentYear, weekInfo.yearKeys);
                if (!bestData) return;

                var currentAvg = bestData.value;
                var dataSource = bestData.source;
                var meetTarget = targetConfig.value;
                var isReverse = targetConfig.type === 'max';

                // Determine "exceed" target from rating bands (score 3)
                var exceedTarget = meetTarget;
                var bandConfig = ratingBands[metricKey];
                if (bandConfig) {
                    exceedTarget = isReverse ? bandConfig.score3.max : bandConfig.score3.min;
                }

                var requiredToMeet = calculateRequiredAverage(currentAvg, weekInfo.weeksCompleted, weekInfo.weeksRemaining, meetTarget);
                var requiredToExceed = calculateRequiredAverage(currentAvg, weekInfo.weeksCompleted, weekInfo.weeksRemaining, exceedTarget);

                // Determine current status
                var currentlyMeeting = isReverse ? (currentAvg <= meetTarget) : (currentAvg >= meetTarget);
                var currentlyExceeding = bandConfig
                    ? (isReverse ? (currentAvg <= exceedTarget) : (currentAvg >= exceedTarget))
                    : currentlyMeeting;

                empResult.metrics[metricKey] = {
                    currentAvg: currentAvg,
                    dataSource: dataSource,
                    meetTarget: meetTarget,
                    exceedTarget: exceedTarget,
                    requiredToMeet: requiredToMeet,
                    requiredToExceed: requiredToExceed,
                    meetAchievable: requiredToMeet !== null ? isAchievable(metricKey, requiredToMeet) : null,
                    exceedAchievable: requiredToExceed !== null ? isAchievable(metricKey, requiredToExceed) : null,
                    currentlyMeeting: currentlyMeeting,
                    currentlyExceeding: currentlyExceeding,
                    isReverse: isReverse,
                    hasExceedBand: !!bandConfig
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

            // Show data source if available
            var firstMetric = Object.keys(emp.metrics)[0];
            var source = firstMetric ? emp.metrics[firstMetric].dataSource : null;
            if (source) {
                html += '<p style="margin: 0 0 12px 0; color: #666; font-size: 0.85em;">Source: ' + _escapeHtml(source) + '</p>';
            }

            // Table
            html += '<div style="overflow-x: auto;">';
            html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
            html += '<thead><tr style="background: #f5f5f5;">';
            html += '<th style="padding: 10px 8px; text-align: left; border-bottom: 2px solid #ddd;">Metric</th>';
            html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">YTD Avg</th>';
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

                // Current YTD average
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
                if (m.currentlyMeeting) {
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
                    if (mm.requiredToMeet !== null && !mm.meetAchievable) notAchievableCount++;
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
