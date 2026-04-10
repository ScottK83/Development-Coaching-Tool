(function () {
    'use strict';

    /* ── Global helpers accessed via window ── */
    function _getWeeklyData() {
        return typeof weeklyData !== 'undefined' ? weeklyData : {};
    }
    function _getTeamMembersForWeek(weekKey) {
        return typeof window.getTeamMembersForWeek === 'function' ? window.getTeamMembersForWeek(weekKey) : [];
    }
    function _getWeeklyKeysSorted() {
        return typeof window.getWeeklyKeysSorted === 'function' ? window.getWeeklyKeysSorted() : Object.keys(_getWeeklyData());
    }
    function _formatMetricDisplay(key, value) {
        return typeof window.formatMetricDisplay === 'function' ? window.formatMetricDisplay(key, value) : String(value);
    }
    function _isReverseMetric(metricKey) {
        return typeof window.isReverseMetric === 'function' ? window.isReverseMetric(metricKey) : false;
    }
    function _escapeHtml(str) {
        var mod = window.DevCoachModules?.sharedUtils;
        if (mod?.escapeHtml) return mod.escapeHtml(str);
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function _getCoachingHistoryForEmployee(name) {
        return typeof window.getCoachingHistoryForEmployee === 'function' ? window.getCoachingHistoryForEmployee(name) : [];
    }

    // Core metrics for Q1 review
    var Q1_METRICS = [
        'scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience',
        'transfers', 'overallSentiment', 'positiveWord', 'negativeWord',
        'managingEmotions', 'aht', 'acw', 'holdTime', 'reliability'
    ];

    /**
     * Get all weekly keys that fall within Q1 (Jan 1 - Mar 31) of the given year
     */
    function getQ1WeekKeys(year) {
        var keys = _getWeeklyKeysSorted();
        return keys.filter(function (k) {
            var parts = k.split('|');
            var endStr = parts[1] || '';
            var dateParts = endStr.split('-');
            var y = parseInt(dateParts[0], 10);
            var m = parseInt(dateParts[1], 10);
            return y === year && m >= 1 && m <= 3;
        });
    }

    // Metrics weighted by surveyTotal (not totalCalls)
    var SURVEY_WEIGHTED = new Set(['cxRepOverall', 'fcr', 'overallExperience']);
    // Cumulative metrics that should be summed, not averaged
    var CUMULATIVE_METRICS = new Set(['reliability']);

    /**
     * Aggregate Q1 data for all employees from weekly data.
     * Uses weighted averages for rate metrics, sums for cumulative metrics.
     * Filters to one source type to avoid double-counting overlapping periods.
     */
    function aggregateQ1Data(q1Keys) {
        var wData = _getWeeklyData();

        // Filter to one source type (prefer 'week')
        var sourceTypePriority = ['week', 'month', 'quarter', 'custom', 'daily'];
        var periodsByType = {};
        q1Keys.forEach(function (weekKey) {
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
        var filteredKeys = chosenType ? periodsByType[chosenType] : q1Keys;

        var empAgg = {};

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

                // Reliability: cumulative hours — take the highest (most complete) value
                var rel = parseFloat(emp.reliability);
                if (Number.isFinite(rel) && rel > agg.reliability) agg.reliability = rel;

                Q1_METRICS.forEach(function (mk) {
                    if (CUMULATIVE_METRICS.has(mk)) return; // handled above
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

        // Finalize weighted averages
        var result = {};
        Object.keys(empAgg).forEach(function (name) {
            var agg = empAgg[name];
            var emp = { name: name, reliability: agg.reliability, totalCalls: agg.totalCalls };

            Q1_METRICS.forEach(function (mk) {
                if (CUMULATIVE_METRICS.has(mk)) return;
                var totalWeight = agg.weightedCounts[mk] || 0;
                if (totalWeight > 0) {
                    emp[mk] = agg.weightedSums[mk] / totalWeight;
                }
            });

            result[name] = emp;
        });

        return { employees: result, periodCount: filteredKeys.length };
    }

    /**
     * Get per-week values for trend calculation
     */
    function getWeeklyValues(employeeName, metricKey, q1Keys) {
        var wData = _getWeeklyData();
        var values = [];

        q1Keys.forEach(function (weekKey) {
            var period = wData[weekKey];
            if (!period || !period.employees) return;
            period.employees.forEach(function (emp) {
                if (emp.name === employeeName) {
                    var val = parseFloat(emp[metricKey]);
                    if (!isNaN(val)) {
                        values.push({ weekKey: weekKey, value: val });
                    }
                }
            });
        });

        return values;
    }

    /**
     * Calculate trend direction: improving, declining, or stable
     */
    function calculateTrend(values, isReverse) {
        if (values.length < 3) return { direction: 'insufficient', delta: 0 };

        // Compare first half average to second half average
        var mid = Math.floor(values.length / 2);
        var firstHalf = values.slice(0, mid);
        var secondHalf = values.slice(mid);

        var firstAvg = firstHalf.reduce(function (s, v) { return s + v.value; }, 0) / firstHalf.length;
        var secondAvg = secondHalf.reduce(function (s, v) { return s + v.value; }, 0) / secondHalf.length;

        var delta = secondAvg - firstAvg;
        var threshold = Math.abs(firstAvg) * 0.02; // 2% change threshold

        if (Math.abs(delta) < threshold) return { direction: 'stable', delta: delta };

        // For reverse metrics (lower is better), a negative delta is improving
        if (isReverse) {
            return { direction: delta < 0 ? 'improving' : 'declining', delta: delta };
        }
        return { direction: delta > 0 ? 'improving' : 'declining', delta: delta };
    }

    /**
     * Get the latest YTD period data if available
     */
    function getLatestYtdPeriod() {
        var ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        var keys = Object.keys(ytd);
        if (!keys.length) return null;

        var latest = keys.reduce(function (best, key) {
            var endDate = ytd[key]?.metadata?.endDate || '';
            var bestEnd = ytd[best]?.metadata?.endDate || '';
            return endDate > bestEnd ? key : best;
        });
        return { key: latest, data: ytd[latest] };
    }

    /**
     * Build full review data for all team members.
     * Uses YTD data as primary source when available, falls back to Q1 weekly aggregation.
     */
    function buildQ1ReviewData() {
        var currentYear = new Date().getFullYear();
        var q1Keys = getQ1WeekKeys(currentYear);
        var wData = _getWeeklyData();

        // Check for YTD data (preferred source of truth)
        var ytdPeriod = getLatestYtdPeriod();
        var hasYtdData = ytdPeriod && Array.isArray(ytdPeriod.data?.employees) && ytdPeriod.data.employees.length > 0;
        var dataSource = hasYtdData ? 'ytd' : 'weekly';
        var periodLabel = '';

        if (hasYtdData) {
            var meta = ytdPeriod.data.metadata || {};
            var startDate = meta.startDate || '';
            var endDate = meta.endDate || '';
            periodLabel = startDate && endDate ? startDate + ' to ' + endDate : 'YTD';
        }

        // Get team members from the best available source
        var teamFilterContext = (function() {
            var tf = window.DevCoachModules?.teamFilter;
            return tf?.getTeamSelectionContext ? tf.getTeamSelectionContext() : { isFiltering: false };
        })();
        var isIncluded = function(name) {
            var tf = window.DevCoachModules?.teamFilter;
            if (tf?.isAssociateIncludedByTeamFilter) return tf.isAssociateIncludedByTeamFilter(name, teamFilterContext);
            return true;
        };

        var teamMembers = [];
        if (hasYtdData) {
            teamMembers = ytdPeriod.data.employees
                .map(function (e) { return e.name; })
                .filter(function (n) { return n && isIncluded(n); });
        } else {
            var latestKey = q1Keys.length > 0 ? q1Keys[q1Keys.length - 1] : null;
            if (latestKey && wData[latestKey]) {
                teamMembers = (wData[latestKey].employees || [])
                    .map(function (e) { return e.name; })
                    .filter(function (n) { return n && isIncluded(n); });
            }
        }

        teamMembers.sort(function (a, b) {
            var aFirst = (a || '').split(/[\s,]+/)[0].toLowerCase();
            var bFirst = (b || '').split(/[\s,]+/)[0].toLowerCase();
            return aFirst.localeCompare(bFirst);
        });

        var targets = window.DevCoachModules?.metricProfiles?.TARGETS_BY_YEAR?.[currentYear] || {};
        var ratingBands = window.DevCoachModules?.metricProfiles?.RATING_BANDS_BY_YEAR?.[currentYear] || {};

        // Build employee lookup: YTD data if available, else Q1 aggregation
        var aggEmployees;
        var q1Agg = { employees: {}, periodCount: 0 };
        if (hasYtdData) {
            aggEmployees = {};
            ytdPeriod.data.employees.forEach(function (emp) {
                if (emp && emp.name) aggEmployees[emp.name] = emp;
            });
            // Still aggregate Q1 weekly data for trend/period info if available
            if (q1Keys.length > 0) q1Agg = aggregateQ1Data(q1Keys);
        } else {
            q1Agg = aggregateQ1Data(q1Keys);
            aggEmployees = q1Agg.employees;
        }

        var results = [];
        teamMembers.forEach(function (empName) {
            var aggEmp = aggEmployees[empName];
            if (!aggEmp) return;

            var strengths = [];
            var improvements = [];
            var metrics = {};

            Q1_METRICS.forEach(function (metricKey) {
                var targetConfig = targets[metricKey];
                if (!targetConfig) return;

                var isCumulative = CUMULATIVE_METRICS.has(metricKey);
                var metricValue = isCumulative ? aggEmp.reliability : aggEmp[metricKey];
                if (metricValue === undefined || metricValue === null) return;

                var isReverse = targetConfig.type === 'max';
                var meetsTarget = isReverse ? (metricValue <= targetConfig.value) : (metricValue >= targetConfig.value);

                var weeklyVals = getWeeklyValues(empName, metricKey, q1Keys);
                // Trend is per-week values (not cumulative), so still meaningful for rate metrics
                var trend = isCumulative ? { direction: 'stable', delta: 0 } : calculateTrend(weeklyVals, isReverse);

                var bandConfig = ratingBands[metricKey];
                var exceedTarget = null;
                var isExceeding = false;
                if (bandConfig) {
                    exceedTarget = isReverse ? bandConfig.score3.max : bandConfig.score3.min;
                    isExceeding = isReverse ? (metricValue <= exceedTarget) : (metricValue >= exceedTarget);
                }

                var gap = isReverse
                    ? targetConfig.value - metricValue
                    : metricValue - targetConfig.value;

                var metricData = {
                    average: metricValue,
                    isCumulative: isCumulative,
                    weeksOfData: q1Agg.periodCount,
                    target: targetConfig.value,
                    exceedTarget: exceedTarget,
                    meetsTarget: meetsTarget,
                    isExceeding: isExceeding,
                    trend: trend,
                    gap: gap,
                    isReverse: isReverse,
                    weeklyValues: weeklyVals
                };

                metrics[metricKey] = metricData;

                if (meetsTarget) {
                    strengths.push({ metricKey: metricKey, data: metricData });
                } else {
                    improvements.push({ metricKey: metricKey, data: metricData });
                }
            });

            // Sort strengths by gap (biggest wins first)
            strengths.sort(function (a, b) { return Math.abs(b.data.gap) - Math.abs(a.data.gap); });
            // Sort improvements by gap (biggest gaps first)
            improvements.sort(function (a, b) { return Math.abs(a.data.gap) - Math.abs(b.data.gap); });

            // Get coaching history for Q1
            var history = _getCoachingHistoryForEmployee(empName);
            var q1Start = new Date(currentYear, 0, 1);
            var q1End = new Date(currentYear, 2, 31, 23, 59, 59);
            var q1Coachings = history.filter(function (h) {
                var d = new Date(h.generatedAt);
                return d >= q1Start && d <= q1End;
            });

            // On/Off Tracker score
            var onOffResult = null;
            var onOffMod = window.DevCoachModules?.onOffTracker;
            if (onOffMod?.calculateYearEndOnOffMirror && aggEmp) {
                onOffResult = onOffMod.calculateYearEndOnOffMirror(aggEmp, currentYear);
            }

            results.push({
                name: empName,
                metrics: metrics,
                strengths: strengths,
                improvements: improvements,
                q1CoachingCount: q1Coachings.length,
                lastCoached: q1Coachings.length > 0 ? q1Coachings[0].generatedAt : null,
                onOffResult: onOffResult
            });
        });

        var periodsUsed = hasYtdData ? 1 : q1Keys.length;

        return {
            year: currentYear,
            q1Keys: q1Keys,
            weeksInQ1: hasYtdData ? periodsUsed : q1Keys.length,
            employees: results,
            dataSource: dataSource,
            periodLabel: periodLabel
        };
    }

    /**
     * Generate CoPilot prompt for Q1 conversation prep
     */
    function generateQ1CopilotPrompt(empData, q1Data) {
        var metric = window.METRICS_REGISTRY;
        var lines = [];

        lines.push('You are helping a call center supervisor write a Q1 check-in review for an employee.');
        lines.push('The output will be pasted directly into the employee\'s Q1 check-in form under the "Business Connection" section.');
        lines.push('Write ABOUT the employee in third person (e.g., "John has demonstrated..." or "[Employee Name] has shown..."), NOT as a conversation script.');
        lines.push('');
        lines.push('EMPLOYEE: ' + empData.name);
        lines.push('PERIOD: Q1 ' + q1Data.year + ' (' + q1Data.weeksInQ1 + ' weeks of data)');
        lines.push('COACHING SESSIONS THIS QUARTER: ' + empData.q1CoachingCount);
        lines.push('');

        // Strengths
        lines.push('STRENGTHS (Meeting/Exceeding Target):');
        if (empData.strengths.length === 0) {
            lines.push('- None currently meeting target');
        } else {
            empData.strengths.forEach(function (s) {
                var m = metric[s.metricKey];
                var label = m ? m.label : s.metricKey;
                var trendArrow = s.data.trend.direction === 'improving' ? ' (trending up)' :
                    s.data.trend.direction === 'declining' ? ' (trending down)' : '';
                lines.push('- ' + label + ': ' + _formatMetricDisplay(s.metricKey, s.data.average) +
                    ' (target: ' + _formatMetricDisplay(s.metricKey, s.data.target) + ')' + trendArrow);
            });
        }

        lines.push('');
        lines.push('IMPROVEMENT AREAS (Below Target):');
        if (empData.improvements.length === 0) {
            lines.push('- All metrics meeting target');
        } else {
            empData.improvements.forEach(function (s) {
                var m = metric[s.metricKey];
                var label = m ? m.label : s.metricKey;
                var trendArrow = s.data.trend.direction === 'improving' ? ' (trending up)' :
                    s.data.trend.direction === 'declining' ? ' (trending down)' : '';
                lines.push('- ' + label + ': ' + _formatMetricDisplay(s.metricKey, s.data.average) +
                    ' (target: ' + _formatMetricDisplay(s.metricKey, s.data.target) +
                    ', gap: ' + Math.abs(s.data.gap).toFixed(1) + ')' + trendArrow);
            });
        }

        lines.push('');
        lines.push('INSTRUCTIONS:');
        lines.push('Write a Q1 Business Connection check-in summary for this employee. This text will be pasted directly into their review form. Include:');
        lines.push('1. An opening statement summarizing their overall Q1 performance');
        lines.push('2. Highlight their top 2-3 strengths with specific metric results that show business impact');
        lines.push('3. Identify 1-2 key development areas with specific, actionable goals for Q2');
        lines.push('4. A closing statement on their trajectory and expected contributions going forward');
        lines.push('');
        lines.push('TONE: Professional, supportive, and results-oriented. Written in third person about the employee.');
        lines.push('This is formal review text, not a conversation script. Do not use "you" or write as if speaking to the employee.');
        lines.push('Keep the total to about 200-300 words.');

        return lines.join('\n');
    }

    /**
     * Render the Q1 Review Prep view
     */
    function renderQ1Review() {
        var container = document.getElementById('q1ReviewContent');
        if (!container) return;

        var data = buildQ1ReviewData();

        if (data.employees.length === 0) {
            container.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 40px;">No data available. Upload weekly or YTD data to see review prep.</p>';
            return;
        }

        var html = '';

        // Header
        html += '<div style="margin-bottom: 20px; padding: 15px; background: #ede7f6; border-radius: 8px; border-left: 4px solid #7c4dff;">';
        if (data.dataSource === 'ytd') {
            html += '<strong>' + data.year + ' Review Prep</strong> &mdash; YTD data (' + data.periodLabel + ')';
        } else {
            html += '<strong>Q1 ' + data.year + ' Review Prep</strong> &mdash; ' + data.weeksInQ1 + ' weeks of data (Jan - Mar)';
        }
        html += '</div>';

        // Employee selector
        html += '<div style="margin-bottom: 20px; padding: 15px; background: #fff; border-radius: 8px; border: 1px solid #ddd;">';
        html += '<label for="q1ReviewEmployeeSelect" style="font-weight: bold; display: block; margin-bottom: 8px;">Select Associate:</label>';
        html += '<select id="q1ReviewEmployeeSelect" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 1em; cursor: pointer;">';
        html += '<option value="">-- Choose an associate --</option>';
        data.employees.forEach(function (emp) {
            html += '<option value="' + _escapeHtml(emp.name) + '">' + _escapeHtml(emp.name) + '</option>';
        });
        html += '</select>';
        html += '</div>';

        // Content area
        html += '<div id="q1ReviewDetail"></div>';

        container.innerHTML = html;

        // Bind select
        var select = document.getElementById('q1ReviewEmployeeSelect');
        if (select) {
            select.addEventListener('change', function () {
                renderQ1EmployeeDetail(data, select.value);
            });
        }
    }

    function renderQ1EmployeeDetail(q1Data, employeeName) {
        var detailContainer = document.getElementById('q1ReviewDetail');
        if (!detailContainer) return;

        if (!employeeName) {
            detailContainer.innerHTML = '';
            return;
        }

        var emp = q1Data.employees.find(function (e) { return e.name === employeeName; });
        if (!emp) {
            detailContainer.innerHTML = '<p style="color: #999; text-align: center;">No data for this employee.</p>';
            return;
        }

        var html = '';
        var metric = window.METRICS_REGISTRY;

        // Overview card
        var totalMetrics = Object.keys(emp.metrics).length;
        var meetingCount = emp.strengths.length;
        var belowCount = emp.improvements.length;
        var improvingCount = 0;
        var decliningCount = 0;
        Object.keys(emp.metrics).forEach(function (mk) {
            if (emp.metrics[mk].trend.direction === 'improving') improvingCount++;
            if (emp.metrics[mk].trend.direction === 'declining') decliningCount++;
        });

        // On/Off Tracker Score Card
        if (emp.onOffResult) {
            var onOffMod = window.DevCoachModules?.onOffTracker;
            if (onOffMod?.buildOnOffScoreTableHtml) {
                html += '<div style="margin-bottom: 20px; padding: 20px; background: #fff; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
                html += '<h3 style="margin-top: 0; color: #1a1a2e;">On/Off Track Score</h3>';
                if (emp.onOffResult.isComplete) {
                    var avg = emp.onOffResult.ratingAverage;
                    var trackColor = avg >= 2.5 ? '#2e7d32' : (avg >= 1.5 ? '#f57f17' : '#c62828');
                    html += '<div style="margin-bottom: 12px; padding: 10px 16px; border-radius: 8px; display: inline-block; background: ' + trackColor + '; color: white; font-weight: bold; font-size: 1.1em;">';
                    html += emp.onOffResult.trackLabel + ' (' + avg.toFixed(2) + ')';
                    html += '</div>';
                }
                html += onOffMod.buildOnOffScoreTableHtml(emp.onOffResult, q1Data.year);
                html += '</div>';
            }
        }

        html += '<div style="margin-bottom: 20px; padding: 20px; background: #fff; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
        html += '<h3 style="margin-top: 0; color: #1a1a2e;">' + _escapeHtml(emp.name) + ' &mdash; ' + (q1Data.dataSource === 'ytd' ? 'YTD' : 'Q1') + ' Overview</h3>';

        // Summary badges
        html += '<div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px;">';
        html += '<span style="padding: 8px 16px; border-radius: 16px; background: #e8f5e9; color: #2e7d32; font-weight: bold;">' + meetingCount + '/' + totalMetrics + ' Meeting Target</span>';
        html += '<span style="padding: 8px 16px; border-radius: 16px; background: #e3f2fd; color: #1565c0; font-weight: bold;">' + improvingCount + ' Trending Up</span>';
        if (decliningCount > 0) {
            html += '<span style="padding: 8px 16px; border-radius: 16px; background: #fbe9e7; color: #c62828; font-weight: bold;">' + decliningCount + ' Trending Down</span>';
        }
        html += '<span style="padding: 8px 16px; border-radius: 16px; background: #f3e5f5; color: #6a1b9a; font-weight: bold;">' + emp.q1CoachingCount + ' Coaching Sessions</span>';
        html += '</div>';

        // Strengths section
        html += '<div style="margin-bottom: 16px;">';
        html += '<h4 style="color: #2e7d32; margin-bottom: 8px;">Strengths</h4>';
        if (emp.strengths.length === 0) {
            html += '<p style="color: #999; font-style: italic;">No metrics currently meeting target</p>';
        } else {
            html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;">';
            emp.strengths.forEach(function (s) {
                var m = metric[s.metricKey];
                var icon = m ? m.icon : '';
                var label = m ? m.label : s.metricKey;
                var trendIcon = s.data.trend.direction === 'improving' ? ' <span style="color: #2e7d32;">&#9650;</span>' :
                    s.data.trend.direction === 'declining' ? ' <span style="color: #e65100;">&#9660;</span>' : '';
                var exceedBadge = s.data.isExceeding ? ' <span style="background: #1565c0; color: white; padding: 1px 6px; border-radius: 8px; font-size: 0.75em;">Exceeding</span>' : '';

                html += '<div style="padding: 10px 14px; background: #f1f8e9; border-radius: 6px; border-left: 3px solid #4caf50;">';
                html += '<strong>' + icon + ' ' + _escapeHtml(label) + '</strong>' + exceedBadge + trendIcon + '<br>';
                html += '<span style="font-size: 1.1em; font-weight: bold;">' + _formatMetricDisplay(s.metricKey, s.data.average) + '</span>';
                html += ' <span style="color: #666; font-size: 0.85em;">(target: ' + _formatMetricDisplay(s.metricKey, s.data.target) + ')</span>';
                html += '</div>';
            });
            html += '</div>';
        }
        html += '</div>';

        // Improvement areas
        html += '<div style="margin-bottom: 16px;">';
        html += '<h4 style="color: #c62828; margin-bottom: 8px;">Improvement Areas</h4>';
        if (emp.improvements.length === 0) {
            html += '<p style="color: #2e7d32; font-style: italic;">All metrics meeting target!</p>';
        } else {
            html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px;">';
            emp.improvements.forEach(function (s) {
                var m = metric[s.metricKey];
                var icon = m ? m.icon : '';
                var label = m ? m.label : s.metricKey;
                var trendIcon = s.data.trend.direction === 'improving' ? ' <span style="color: #2e7d32;">&#9650;</span>' :
                    s.data.trend.direction === 'declining' ? ' <span style="color: #c62828;">&#9660;</span>' : '';
                var gapText = Math.abs(s.data.gap).toFixed(1);

                html += '<div style="padding: 10px 14px; background: #fff3e0; border-radius: 6px; border-left: 3px solid #ff9800;">';
                html += '<strong>' + icon + ' ' + _escapeHtml(label) + '</strong>' + trendIcon + '<br>';
                html += '<span style="font-size: 1.1em; font-weight: bold; color: #e65100;">' + _formatMetricDisplay(s.metricKey, s.data.average) + '</span>';
                html += ' <span style="color: #666; font-size: 0.85em;">(target: ' + _formatMetricDisplay(s.metricKey, s.data.target) + ', gap: ' + gapText + ')</span>';
                html += '</div>';
            });
            html += '</div>';
        }
        html += '</div>';

        html += '</div>';

        // Full metrics table with trends
        html += '<div style="margin-bottom: 20px; padding: 20px; background: #fff; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
        html += '<h4 style="margin-top: 0; color: #1a1a2e;">Full Q1 Metrics Breakdown</h4>';
        html += '<div style="overflow-x: auto;">';
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">';
        html += '<thead><tr style="background: #f5f5f5;">';
        html += '<th style="padding: 10px 8px; text-align: left; border-bottom: 2px solid #ddd;">Metric</th>';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Q1 Avg</th>';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Target</th>';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Gap</th>';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Trend</th>';
        html += '<th style="padding: 10px 8px; text-align: center; border-bottom: 2px solid #ddd;">Status</th>';
        html += '</tr></thead><tbody>';

        Q1_METRICS.forEach(function (metricKey) {
            var md = emp.metrics[metricKey];
            if (!md) return;
            var m = metric[metricKey];
            if (!m) return;

            var rowBg = md.meetsTarget ? (md.isExceeding ? '#e8f5e9' : '#f1f8e9') : '#fff3e0';

            html += '<tr style="background: ' + rowBg + '; border-bottom: 1px solid #eee;">';
            html += '<td style="padding: 8px;">' + (m.icon || '') + ' ' + _escapeHtml(m.label) + '</td>';
            html += '<td style="padding: 8px; text-align: center; font-weight: bold;">' + _formatMetricDisplay(metricKey, md.average) + '</td>';
            html += '<td style="padding: 8px; text-align: center; color: #666;">' + _formatMetricDisplay(metricKey, md.target) + '</td>';

            // Gap
            var gapColor = md.meetsTarget ? '#2e7d32' : '#c62828';
            var gapSign = md.gap >= 0 ? '+' : '';
            html += '<td style="padding: 8px; text-align: center; color: ' + gapColor + '; font-weight: bold;">' + gapSign + md.gap.toFixed(1) + '</td>';

            // Trend
            var trendText, trendColor;
            if (md.trend.direction === 'insufficient') {
                trendText = '&mdash;';
                trendColor = '#aaa';
            } else if (md.trend.direction === 'improving') {
                trendText = '&#9650; Improving';
                trendColor = '#2e7d32';
            } else if (md.trend.direction === 'declining') {
                trendText = '&#9660; Declining';
                trendColor = '#c62828';
            } else {
                trendText = '&#9644; Stable';
                trendColor = '#666';
            }
            html += '<td style="padding: 8px; text-align: center; color: ' + trendColor + ';">' + trendText + '</td>';

            // Status
            var statusText, statusBg;
            if (md.isExceeding) {
                statusText = 'Exceeding';
                statusBg = '#2e7d32';
            } else if (md.meetsTarget) {
                statusText = 'Meeting';
                statusBg = '#f57f17';
            } else {
                statusText = 'Below';
                statusBg = '#c62828';
            }
            html += '<td style="padding: 8px; text-align: center;"><span style="display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 0.85em; font-weight: bold; color: white; background: ' + statusBg + ';">' + statusText + '</span></td>';

            html += '</tr>';
        });

        html += '</tbody></table>';
        html += '</div></div>';

        // CoPilot prompt generation
        html += '<div style="margin-bottom: 20px; padding: 20px; background: #fff; border-radius: 8px; border: 1px solid #7c4dff; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
        html += '<h4 style="margin-top: 0; color: #4a148c;">Q1 Conversation Prep</h4>';
        html += '<p style="color: #666; font-size: 0.9em; margin-bottom: 12px;">Generate a conversation guide for your Q1 review with ' + _escapeHtml(emp.name) + '. Copy the prompt below and paste it into CoPilot.</p>';
        html += '<div style="display: flex; gap: 10px; margin-bottom: 12px;">';
        html += '<button type="button" id="q1CopyPromptBtn" class="btn-secondary" style="background: #7c4dff; color: white; padding: 8px 20px; font-weight: bold;">Copy Q1 Prompt</button>';
        html += '<button type="button" id="q1OpenCopilotBtn" class="btn-secondary" style="background: #1565c0; color: white; padding: 8px 20px; font-weight: bold;">Open CoPilot</button>';
        html += '</div>';
        html += '<textarea id="q1PromptTextarea" readonly style="width: 100%; min-height: 200px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 0.85em; resize: vertical; background: #fafafa;">';
        html += _escapeHtml(generateQ1CopilotPrompt(emp, q1Data));
        html += '</textarea>';
        html += '</div>';

        // Quick talking points
        html += '<div style="margin-bottom: 20px; padding: 20px; background: #fff; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
        html += '<h4 style="margin-top: 0; color: #1a1a2e;">Quick Talking Points</h4>';
        html += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">';

        // Celebrate column
        html += '<div style="padding: 15px; background: #e8f5e9; border-radius: 8px;">';
        html += '<h5 style="margin-top: 0; color: #2e7d32;">Celebrate</h5>';
        html += '<ul style="margin: 0; padding-left: 18px; color: #333;">';
        if (emp.strengths.length === 0) {
            html += '<li style="color: #999;">Acknowledge effort and progress</li>';
        } else {
            emp.strengths.slice(0, 3).forEach(function (s) {
                var m = metric[s.metricKey];
                html += '<li>' + (m ? m.label : s.metricKey) + ' at <strong>' + _formatMetricDisplay(s.metricKey, s.data.average) + '</strong>';
                if (s.data.isExceeding) html += ' (exceeding!)';
                html += '</li>';
            });
        }
        // Note improving trends even in below-target metrics
        emp.improvements.forEach(function (s) {
            if (s.data.trend.direction === 'improving') {
                var m = metric[s.metricKey];
                html += '<li>' + (m ? m.label : s.metricKey) + ' is trending up (acknowledge the effort)</li>';
            }
        });
        html += '</ul></div>';

        // Coach column
        html += '<div style="padding: 15px; background: #fff3e0; border-radius: 8px;">';
        html += '<h5 style="margin-top: 0; color: #e65100;">Coach & Develop</h5>';
        html += '<ul style="margin: 0; padding-left: 18px; color: #333;">';
        if (emp.improvements.length === 0) {
            html += '<li style="color: #2e7d32;">Focus on maintaining excellent performance</li>';
        } else {
            emp.improvements.slice(0, 3).forEach(function (s) {
                var m = metric[s.metricKey];
                html += '<li>' + (m ? m.label : s.metricKey) + ': needs <strong>' + Math.abs(s.data.gap).toFixed(1) + '</strong> improvement to reach target';
                if (s.data.trend.direction === 'declining') html += ' <span style="color: #c62828;">(declining)</span>';
                html += '</li>';
            });
        }
        html += '</ul></div>';

        html += '</div></div>';

        detailContainer.innerHTML = html;

        // Bind buttons
        var copyBtn = document.getElementById('q1CopyPromptBtn');
        var copilotBtn = document.getElementById('q1OpenCopilotBtn');
        var textarea = document.getElementById('q1PromptTextarea');

        if (copyBtn && textarea) {
            copyBtn.addEventListener('click', function () {
                navigator.clipboard.writeText(textarea.value).then(function () {
                    copyBtn.textContent = 'Copied!';
                    setTimeout(function () { copyBtn.textContent = 'Copy Q1 Prompt'; }, 2000);
                });
            });
        }

        if (copilotBtn) {
            copilotBtn.addEventListener('click', function () {
                if (typeof window.openCopilotWithPrompt === 'function') {
                    window.openCopilotWithPrompt(textarea ? textarea.value : '');
                } else {
                    window.open('https://copilot.microsoft.com', '_blank');
                }
            });
        }
    }

    /* ── Module export ── */
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.q1Review = {
        renderQ1Review: renderQ1Review,
        buildQ1ReviewData: buildQ1ReviewData,
        generateQ1CopilotPrompt: generateQ1CopilotPrompt
    };

    window.renderQ1Review = renderQ1Review;
})();
