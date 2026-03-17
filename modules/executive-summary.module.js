/* ========================================
   EXECUTIVE SUMMARY MODULE
   Yearly summary, executive summary cards,
   trend charts, and copilot email generation
   ======================================== */

(function() {
    'use strict';

    // ============================================
    // CONSTANTS
    // ============================================

    var STORAGE_PREFIX = 'devCoachingTool_';

    // ============================================
    // HELPERS - access globals
    // ============================================

    function getWeeklyData() {
        return window.DevCoachModules?.storage?.loadWeeklyData?.() || {};
    }

    function getMetricsRegistry() {
        return window.METRICS_REGISTRY || {};
    }

    function getMetricOrder() {
        return typeof window.getMetricOrder === 'function' ? window.getMetricOrder() : [];
    }

    function getTeamSelectionContext() {
        var teamFilter = window.DevCoachModules?.teamFilter;
        if (teamFilter?.getTeamSelectionContext) return teamFilter.getTeamSelectionContext();
        return typeof window.getTeamSelectionContext === 'function' ? window.getTeamSelectionContext() : {};
    }

    function isAssociateIncludedByTeamFilter(name, context) {
        var teamFilter = window.DevCoachModules?.teamFilter;
        if (teamFilter?.isAssociateIncludedByTeamFilter) return teamFilter.isAssociateIncludedByTeamFilter(name, context);
        return typeof window.isAssociateIncludedByTeamFilter === 'function' ? window.isAssociateIncludedByTeamFilter(name, context) : true;
    }

    function filterAssociateNamesByTeamSelection(names) {
        var teamFilter = window.DevCoachModules?.teamFilter;
        if (teamFilter?.filterAssociateNamesByTeamSelection) return teamFilter.filterAssociateNamesByTeamSelection(names);
        return typeof window.filterAssociateNamesByTeamSelection === 'function' ? window.filterAssociateNamesByTeamSelection(names) : names;
    }

    function escapeHtml(text) {
        return typeof window.escapeHtml === 'function' ? window.escapeHtml(text) : String(text);
    }

    function showToast(message, duration) {
        if (typeof window.showToast === 'function') window.showToast(message, duration);
    }

    function formatDateMMDDYYYY(dateString) {
        return typeof window.formatDateMMDDYYYY === 'function' ? window.formatDateMMDDYYYY(dateString) : dateString;
    }

    function formatWeekLabel(weekKey) {
        return typeof window.formatWeekLabel === 'function' ? window.formatWeekLabel(weekKey) : weekKey;
    }

    function formatMetricDisplay(key, value) {
        return typeof window.formatMetricDisplay === 'function' ? window.formatMetricDisplay(key, value) : String(value);
    }

    function formatMetricValue(key, value) {
        return typeof window.formatMetricValue === 'function' ? window.formatMetricValue(key, value) : String(value);
    }

    function metricMeetsTarget(metricKey, value) {
        return typeof window.metricMeetsTarget === 'function' ? window.metricMeetsTarget(metricKey, value) : false;
    }

    function metricGapToTarget(metricKey, value) {
        return typeof window.metricGapToTarget === 'function' ? window.metricGapToTarget(metricKey, value) : 0;
    }

    function getTrendDeltaThreshold(metricKey) {
        return typeof window.getTrendDeltaThreshold === 'function' ? window.getTrendDeltaThreshold(metricKey) : null;
    }

    function getYearEndOnOffScoreOrFallback(metricKey, value, scoreYear) {
        return typeof window.getYearEndOnOffScoreOrFallback === 'function' ? window.getYearEndOnOffScoreOrFallback(metricKey, value, scoreYear) : null;
    }

    function isReverseMetric(metricKey) {
        return typeof window.isReverseMetric === 'function' ? window.isReverseMetric(metricKey) : false;
    }

    function loadServerTips() {
        return typeof window.loadServerTips === 'function' ? window.loadServerTips() : Promise.resolve({});
    }

    function bindElementOnce(element, eventName, handler) {
        if (typeof window.bindElementOnce === 'function') window.bindElementOnce(element, eventName, handler);
    }

    function renderSupervisorIntelligence() {
        if (typeof window.renderSupervisorIntelligence === 'function') window.renderSupervisorIntelligence();
    }

    function getWeeklyKeysSorted() {
        return typeof window.getWeeklyKeysSorted === 'function' ? window.getWeeklyKeysSorted() : Object.keys(getWeeklyData());
    }

    function getLatestWeeklyKey() {
        return typeof window.getLatestWeeklyKey === 'function' ? window.getLatestWeeklyKey() : null;
    }

    // ============================================
    // YEARLY AVERAGE / PREVIOUS PERIOD DATA
    // ============================================

    function getYearlyAverageForEmployee(employeeName, metricKey) {
        /**
         * Calculate employee's yearly average (Jan 1 - current date) for a specific metric
         * Returns: { value: number, count: number } or null if no data
         */
        var currentYear = new Date().getFullYear();
        var weeklyData = getWeeklyData();

        var sums = {};
        var counts = {};

        Object.entries(weeklyData).forEach(function(entry) {
            var weekKey = entry[0];
            var weekData = entry[1];
            var parts = weekKey.split('|');
            var endDateStr = parts[1] || '';
            var endYear = parseInt(endDateStr.split('-')[0], 10);

            // Only include data from current year up to today
            if (endYear === currentYear) {
                (weekData.employees || []).forEach(function(emp) {
                    if (emp.name === employeeName) {
                        var value = parseFloat(emp[metricKey]);
                        if (!isNaN(value)) {
                            sums[metricKey] = (sums[metricKey] || 0) + value;
                            counts[metricKey] = (counts[metricKey] || 0) + 1;
                        }
                    }
                });
            }
        });

        if (counts[metricKey] && counts[metricKey] > 0) {
            return {
                value: parseFloat((sums[metricKey] / counts[metricKey]).toFixed(2)),
                count: counts[metricKey]
            };
        }

        return null;
    }

    function getPreviousPeriodData(currentWeekKey, periodType) {
        /**
         * Find the previous period's data based on period type
         * Returns: weekKey of previous period or null
         */
        var weeklyData = getWeeklyData();
        var parts = currentWeekKey.split('|');
        var endStr = parts[1] || '';
        var endParts = endStr.split('-').map(Number);
        var endYear = endParts[0];
        var endMonth = endParts[1];
        var endDay = endParts[2];
        var endDate = new Date(endYear, endMonth - 1, endDay);

        var previousPeriodEnd = null;

        if (periodType === 'week') {
            previousPeriodEnd = new Date(endDate);
            previousPeriodEnd.setDate(previousPeriodEnd.getDate() - 7);
        } else if (periodType === 'month') {
            previousPeriodEnd = new Date(endYear, endMonth - 2, endDay);
        } else if (periodType === 'quarter') {
            previousPeriodEnd = new Date(endDate);
            previousPeriodEnd.setMonth(previousPeriodEnd.getMonth() - 3);
        } else if (periodType === 'ytd') {
            return null;
        }

        if (!previousPeriodEnd) return null;

        var prevEndStr = previousPeriodEnd.getFullYear() + '-' +
            String(previousPeriodEnd.getMonth() + 1).padStart(2, '0') + '-' +
            String(previousPeriodEnd.getDate()).padStart(2, '0');

        var sortedKeys = Object.keys(weeklyData).sort().reverse();
        for (var i = 0; i < sortedKeys.length; i++) {
            var key = sortedKeys[i];
            if (!key.includes(prevEndStr)) continue;
            var metadata = weeklyData[key]?.metadata || {};
            var keyPeriodType = metadata.periodType || 'week';
            if (keyPeriodType !== periodType) continue;
            return key;
        }

        return null;
    }

    // ============================================
    // EXECUTIVE SUMMARY ACTIVE YEAR
    // ============================================

    function getExecutiveSummaryActiveYear(allWeeks) {
        var weeklyData = getWeeklyData();
        var years = allWeeks.map(function(weekKey) {
            var metadataEndDate = weeklyData[weekKey]?.metadata?.endDate;
            var fallbackEndDate = weekKey.includes('|') ? weekKey.split('|')[1] : '';
            var endDateText = metadataEndDate || fallbackEndDate;
            var parsedYear = parseInt(String(endDateText || '').slice(0, 4), 10);
            return Number.isInteger(parsedYear) ? parsedYear : null;
        }).filter(Number.isInteger);

        return years.length ? Math.max.apply(null, years) : new Date().getFullYear();
    }

    // ============================================
    // AGGREGATE METRICS
    // ============================================

    function buildExecutiveSummaryAggregateMetrics(allWeeks, selectedAssociate) {
        selectedAssociate = selectedAssociate || '';
        var weeklyData = getWeeklyData();
        var metricKeys = getMetricOrder().map(function(item) { return item.key; });
        var activeYear = getExecutiveSummaryActiveYear(allWeeks);
        var metrics = {
            totalWeeks: 0,
            totalEmployees: new Set(),
            averagesByMetric: {},
            activeYear: activeYear,
            selectedAssociate: selectedAssociate
        };

        metricKeys.forEach(function(metricKey) {
            metrics.averagesByMetric[metricKey] = [];
        });

        var teamFilterContext = getTeamSelectionContext();

        allWeeks.forEach(function(weekKey) {
            var week = weeklyData[weekKey];
            if (!week || !week.employees) return;

            var metadataEndDate = week?.metadata?.endDate;
            var fallbackEndDate = weekKey.includes('|') ? weekKey.split('|')[1] : '';
            var endDateText = metadataEndDate || fallbackEndDate;
            var endYear = parseInt(String(endDateText || '').slice(0, 4), 10);
            if (!Number.isInteger(endYear) || endYear !== activeYear) return;

            metrics.totalWeeks += 1;

            week.employees.forEach(function(emp) {
                if (!emp?.name) return;
                if (selectedAssociate && emp.name !== selectedAssociate) return;
                if (!isAssociateIncludedByTeamFilter(emp.name, teamFilterContext)) return;

                metrics.totalEmployees.add(emp.name);

                metricKeys.forEach(function(metricKey) {
                    var value = parseFloat(emp[metricKey]);
                    if (!Number.isFinite(value)) return;
                    metrics.averagesByMetric[metricKey].push(value);
                });
            });
        });

        return metrics;
    }

    // ============================================
    // AVERAGES
    // ============================================

    function calculateExecutiveSummaryAverages(metrics) {
        var averages = {};
        Object.keys(metrics.averagesByMetric || {}).forEach(function(metricKey) {
            var values = metrics.averagesByMetric[metricKey] || [];
            if (!values.length) {
                averages[metricKey] = null;
                return;
            }
            averages[metricKey] = values.reduce(function(sum, value) { return sum + value; }, 0) / values.length;
        });
        return averages;
    }

    // ============================================
    // METRIC CARD STYLE
    // ============================================

    function getExecutiveSummaryMetricCardStyle(metricKey, averageValue, reviewYear) {
        var neutralStyle = {
            background: 'linear-gradient(135deg, #90a4ae 0%, #78909c 100%)',
            textColor: '#ffffff'
        };

        if (!Number.isFinite(averageValue)) return neutralStyle;

        var onOffMetrics = new Set(['aht', 'scheduleAdherence', 'overallSentiment', 'cxRepOverall', 'reliability']);
        if (onOffMetrics.has(metricKey)) {
            var score = getYearEndOnOffScoreOrFallback(metricKey, averageValue, reviewYear);
            if (score === 3) return { background: 'linear-gradient(135deg, #2e7d32 0%, #43a047 100%)', textColor: '#ffffff' };
            if (score === 2) return { background: 'linear-gradient(135deg, #f0de87 0%, #e6c65a 100%)', textColor: '#222222' };
            if (score === 1) return { background: 'linear-gradient(135deg, #c62828 0%, #ef5350 100%)', textColor: '#ffffff' };
        }

        if (metricMeetsTarget(metricKey, averageValue)) {
            return { background: 'linear-gradient(135deg, #2e7d32 0%, #43a047 100%)', textColor: '#ffffff' };
        }

        var gap = Math.abs(metricGapToTarget(metricKey, averageValue));
        var thresholdObj = getTrendDeltaThreshold(metricKey);
        var threshold = thresholdObj?.value || 0;
        if (threshold > 0 && gap <= threshold) {
            return { background: 'linear-gradient(135deg, #f0de87 0%, #e6c65a 100%)', textColor: '#222222' };
        }

        return { background: 'linear-gradient(135deg, #c62828 0%, #ef5350 100%)', textColor: '#ffffff' };
    }

    // ============================================
    // CARD BUILDING & RENDERING
    // ============================================

    function buildExecutiveSummaryCards(metrics, averages) {
        var METRICS_REGISTRY = getMetricsRegistry();
        var reviewYear = metrics.activeYear || new Date().getFullYear();
        var metricCards = getMetricOrder().map(function(item) {
            var key = item.key;
            var metricDef = METRICS_REGISTRY[key];
            if (!metricDef) return null;

            var averageValue = averages[key];
            var style = getExecutiveSummaryMetricCardStyle(key, averageValue, reviewYear);

            return {
                label: 'Avg ' + metricDef.label,
                value: Number.isFinite(averageValue) ? formatMetricDisplay(key, averageValue) : 'N/A',
                icon: '\u{1F4C8}',
                background: style.background,
                textColor: style.textColor
            };
        }).filter(Boolean);

        return [
            { label: 'Total Data Periods', value: metrics.totalWeeks, icon: '\u{1F4CA}' },
            { label: 'Total Employees', value: metrics.totalEmployees.size, icon: '\u{1F465}' }
        ].concat(metricCards).map(function(card) {
            return {
                background: card.background || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                textColor: card.textColor || '#ffffff',
                label: card.label,
                value: card.value,
                icon: card.icon
            };
        });
    }

    function renderExecutiveSummaryCardsHtml(cards) {
        return cards.map(function(card) {
            return '\n            <div style="padding: 20px; background: ' + card.background + '; color: ' + card.textColor + '; border-radius: 8px; text-align: center;">\n                <div style="font-size: 2em; margin-bottom: 8px;">' + card.icon + '</div>\n                <div style="font-size: 1.8em; font-weight: bold; margin-bottom: 4px;">' + card.value + '</div>\n                <div style="font-size: 0.9em; opacity: 0.9;">' + card.label + '</div>\n            </div>\n        ';
        }).join('');
    }

    // ============================================
    // RENDER EXECUTIVE SUMMARY
    // ============================================

    function renderExecutiveSummary() {
        var container = document.getElementById('executiveSummaryContainer');
        if (!container) return;

        var weeklyData = getWeeklyData();
        var allWeeks = Object.keys(weeklyData);

        if (allWeeks.length === 0) {
            container.innerHTML = '<p style="color: #666; font-style: italic;">No data uploaded yet. Upload some weekly data to see the executive summary!</p>';
            return;
        }

        var selectedAssociate = document.getElementById('summaryAssociateSelect')?.value || '';
        var metrics = buildExecutiveSummaryAggregateMetrics(allWeeks, selectedAssociate);
        var averages = calculateExecutiveSummaryAverages(metrics);
        var cards = buildExecutiveSummaryCards(metrics, averages);

        var html = '<div style="margin-bottom: 30px;">';
        var scopeLabel = selectedAssociate
            ? 'Performance Overview \u2014 ' + escapeHtml(selectedAssociate) + ' (' + metrics.activeYear + ' YTD)'
            : 'Performance Overview (' + metrics.activeYear + ' YTD)';
        html += '<h3>' + scopeLabel + '</h3>';
        html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 20px;">';
        html += renderExecutiveSummaryCardsHtml(cards);

        html += '</div></div>';

        container.innerHTML = html;
        renderSupervisorIntelligence();

        // Initialize the new yearly individual summary section
        initializeYearlyIndividualSummary();
    }

    // ============================================
    // ASSOCIATE CHANGE HANDLER
    // ============================================

    function handleExecutiveSummaryAssociateChange() {
        renderExecutiveSummary();
        loadExecutiveSummaryData();
        renderYearlySummaryTrendCharts();
        syncOneOnOneAssociateSelect();
    }

    // ============================================
    // YEARLY INDIVIDUAL SUMMARY INIT
    // ============================================

    function initializeYearlyIndividualSummary() {
        populateExecutiveSummaryAssociate();
        populateOneOnOneAssociateSelect();

        var summaryAssociateSelect = document.getElementById('summaryAssociateSelect');
        bindElementOnce(summaryAssociateSelect, 'change', handleExecutiveSummaryAssociateChange);
    }

    // ============================================
    // CALLOUTS & SAVED NOTES TEXT
    // ============================================

    function buildExecutiveSummaryCallouts(latestKey, latestWeek) {
        var delegated = window.DevCoachModules?.trendIntelligence?.buildExecutiveSummaryCallouts?.({
            latestWeek: latestWeek,
            centerAvg: latestKey ? getCenterAverageForWeek(latestKey) : null,
            metricsRegistry: getMetricsRegistry(),
            isReverseMetric: isReverseMetric,
            formatMetricValue: formatMetricValue,
            isAssociateIncludedByTeamFilter: isAssociateIncludedByTeamFilter
        });
        return Array.isArray(delegated) ? delegated : [];
    }

    function buildExecutiveSummarySavedNotesText(associate) {
        var saved = getExecutiveSummaryNotesStore();
        var employeeNotes = saved[associate] || {};
        var ytdNotes = employeeNotes['ytd-summary'] || {};

        var delegated = window.DevCoachModules?.trendIntelligence?.buildExecutiveSummarySavedNotesText?.(ytdNotes);
        return delegated || 'SAVED RISK NOTES:\n- No saved red flags or phishing notes.\n';
    }

    // ============================================
    // COPILOT EMAIL GENERATION
    // ============================================

    async function generateExecutiveSummaryCopilotEmail() {
        var associate = document.getElementById('summaryAssociateSelect')?.value;
        if (!associate) {
            showToast('Select an associate first', 3000);
            return;
        }

        var latestKey = getLatestWeeklyKey();
        var weeklyData = getWeeklyData();
        var latestWeek = latestKey ? weeklyData[latestKey] : null;
        if (!latestKey || !latestWeek) {
            showToast('No weekly data available', 3000);
            return;
        }

        var endDate = latestWeek?.metadata?.endDate
            ? formatDateMMDDYYYY(latestWeek.metadata.endDate)
            : (latestKey?.split('|')[1] ? formatDateMMDDYYYY(latestKey.split('|')[1]) : 'this period');

        // Load tips from CSV
        var allTips = await loadServerTips();

        // Build individual wins callouts
        var individualWins = buildExecutiveSummaryCallouts(latestKey, latestWeek);
        var individualWinsText = '';
        if (individualWins.length > 0) {
            individualWinsText = 'INDIVIDUAL WINS (Team Members Crushing Metrics vs Call Center Average):\\n';
            individualWins.forEach(function(item) {
                individualWinsText += '- ' + item.name + ': ' + item.metric + ' at ' + item.value + ' vs center ' + item.center + ' (' + item.diff + ')\\n';
            });
        } else {
            individualWinsText = 'INDIVIDUAL WINS: No call center averages configured yet.\\n';
        }

        // Build team performance vs center average
        var teamPerformance = buildTeamVsCenterAnalysis(latestKey, latestWeek);
        var teamPerformanceText = 'TEAM PERFORMANCE vs CALL CENTER AVERAGE:\\n';
        if (teamPerformance.length > 0) {
            teamPerformance.forEach(function(item) {
                var indicator = item.diff > 0 ? '\u2713' : item.diff < 0 ? '\u2717' : '=';
                teamPerformanceText += indicator + ' ' + item.metric + ': Team ' + item.teamValue + ' vs Center ' + item.centerValue + ' (' + item.diffFormatted + ')\\n';
            });
        } else {
            teamPerformanceText += 'No call center averages configured yet.\\n';
        }

        // Find biggest opportunity and get a tip
        var focusAreaText = '';
        var biggestOpportunity = teamPerformance.find(function(item) { return item.diff < 0; });
        if (biggestOpportunity && allTips[biggestOpportunity.metricKey]) {
            var tips = allTips[biggestOpportunity.metricKey] || [];
            var randomTip = tips[Math.floor(Math.random() * tips.length)];
            focusAreaText = 'TEAM FOCUS AREA & TIP:\\n- ' + biggestOpportunity.metric + ': Team needs improvement (' + biggestOpportunity.diffFormatted + ' below center)\\n- Tip: ' + randomTip + '\\n';
        } else {
            focusAreaText = 'TEAM FOCUS AREA: Team is performing well across all metrics!\\n';
        }

        var savedNotesText = buildExecutiveSummarySavedNotesText(associate);

        var copilotPrompt = window.DevCoachModules?.trendIntelligence?.buildExecutiveSummaryCopilotPrompt?.({
            endDate: endDate,
            individualWinsText: individualWinsText,
            teamPerformanceText: teamPerformanceText,
            focusAreaText: focusAreaText,
            savedNotesText: savedNotesText
        }) || '';

        if (!copilotPrompt) {
            showToast('Trend Intelligence module not available. Refresh and try again.', 3500);
            return;
        }

        // Call Copilot with the prompt
        openCopilotWithPrompt(copilotPrompt, 'Executive Summary Email');
    }

    // ============================================
    // OFFLINE COPILOT SUPPORT
    // ============================================

    function openCopilotWithPrompt(prompt, title) {
        title = title || 'CoPilot';
        var encodedPrompt = encodeURIComponent(prompt);
        var copilotUrl = 'https://copilot.microsoft.com/?showconv=1&sendquery=1&q=' + encodedPrompt;

        // Try to open Copilot; if offline or browser blocks it, offer clipboard fallback
        var windowRef = window.open(copilotUrl, '_blank');

        // If window is null or blocked, provide clipboard alternative
        if (!windowRef) {
            navigator.clipboard.writeText(prompt).then(function() {
                showToast('\u2705 Prompt copied to clipboard! Open Copilot and paste it there.', 5000);
                alert(title + ' prompt copied to clipboard.\n\n1. Go to https://copilot.microsoft.com\n2. Paste the prompt (Ctrl+V)\n3. Let CoPilot generate the email\n\nThis feature requires internet connection for Copilot.');
            }).catch(function() {
                // Fallback if clipboard also fails
                var tempDiv = document.createElement('div');
                tempDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.2); max-width: 600px; z-index: 10001;';
                tempDiv.innerHTML = '\n                <h3 style="margin-top: 0;">\u{1F4CB} Copy This Prompt</h3>\n                <p>Clipboard failed. Copy this text and paste at <a href="https://copilot.microsoft.com" target="_blank">copilot.microsoft.com</a>:</p>\n                <textarea readonly style="width: 100%; height: 200px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 0.85em;">' + escapeHtml(prompt) + '</textarea>\n                <button onclick="this.parentElement.parentElement.removeChild(this.parentElement);" style="margin-top: 10px; padding: 8px 16px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>\n            ';
                document.body.appendChild(tempDiv);
            });
        } else {
            showToast('Opening CoPilot with your prompt...', 3000);
        }
    }

    // ============================================
    // TEAM VS CENTER ANALYSIS
    // ============================================

    function buildTeamVsCenterAnalysis(latestKey, latestWeek) {
        var delegated = window.DevCoachModules?.trendIntelligence?.buildTeamVsCenterAnalysis?.({
            latestWeek: latestWeek,
            centerAvg: latestKey ? getCenterAverageForWeek(latestKey) : null,
            metricsRegistry: getMetricsRegistry(),
            isReverseMetric: isReverseMetric,
            formatMetricValue: formatMetricValue,
            isAssociateIncludedByTeamFilter: isAssociateIncludedByTeamFilter
        });
        return Array.isArray(delegated) ? delegated : [];
    }

    // ============================================
    // ONE-ON-ONE ASSOCIATE SELECT
    // ============================================

    function populateOneOnOneAssociateSelect() {
        var select = document.getElementById('oneOnOneAssociateSelect');
        if (!select) return;

        var weeklyData = getWeeklyData();
        var allEmployees = new Set();
        var teamFilterContext = getTeamSelectionContext();
        for (var weekKey in weeklyData) {
            var week = weeklyData[weekKey];
            if (week.employees && Array.isArray(week.employees)) {
                week.employees.forEach(function(emp) {
                    if (emp.name && isAssociateIncludedByTeamFilter(emp.name, teamFilterContext)) {
                        allEmployees.add(emp.name);
                    }
                });
            }
        }

        var sortedEmployees = Array.from(allEmployees).sort();
        select.innerHTML = '<option value="">-- Choose an associate --</option>';
        sortedEmployees.forEach(function(name) {
            var option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });

        syncOneOnOneAssociateSelect();
    }

    function syncOneOnOneAssociateSelect() {
        var select = document.getElementById('oneOnOneAssociateSelect');
        var summarySelect = document.getElementById('summaryAssociateSelect');
        if (!select || !summarySelect) return;
        if (summarySelect.value && select.value !== summarySelect.value) {
            select.value = summarySelect.value;
        }
    }

    // ============================================
    // POPULATE EXECUTIVE SUMMARY ASSOCIATE
    // ============================================

    function populateExecutiveSummaryAssociate() {
        var select = document.getElementById('summaryAssociateSelect');
        if (!select) return;
        var currentSelection = select.value;

        var weeklyData = getWeeklyData();
        var allEmployees = new Set();

        // Collect all unique employee names from weeklyData
        for (var weekKey in weeklyData) {
            var week = weeklyData[weekKey];
            if (week.employees && Array.isArray(week.employees)) {
                week.employees.forEach(function(emp) {
                    if (!emp.name) return;
                    allEmployees.add(emp.name);
                });
            }
        }

        // Sort and populate dropdown
        var sortedEmployees = filterAssociateNamesByTeamSelection(Array.from(allEmployees)).sort();
        select.innerHTML = '<option value="">-- Choose an associate --</option>';
        sortedEmployees.forEach(function(name) {
            var option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });

        if (currentSelection && sortedEmployees.includes(currentSelection)) {
            select.value = currentSelection;
        }
    }

    // ============================================
    // LOAD EXECUTIVE SUMMARY DATA
    // ============================================

    function loadExecutiveSummaryData() {
        var associate = document.getElementById('summaryAssociateSelect').value;
        var periodType = 'ytd'; // Always use Year-to-Date

        if (!associate) {
            setExecutiveSummaryVisibility(false);
            return;
        }

        var matchingPeriods = collectExecutiveSummaryPeriodsForAssociate(associate);

        // Populate data table
        populateExecutiveSummaryTable(associate, matchingPeriods, periodType);

        // Display metric trend charts
        renderYearlySummaryTrendCharts();

        setExecutiveSummaryVisibility(true);
    }

    // ============================================
    // VISIBILITY
    // ============================================

    function setExecutiveSummaryVisibility(isVisible) {
        var dataContainer = document.getElementById('summaryDataContainer');
        var chartsContainer = document.getElementById('summaryChartsContainer');
        var display = isVisible ? 'block' : 'none';

        if (dataContainer) dataContainer.style.display = display;
        if (chartsContainer) chartsContainer.style.display = display;
    }

    // ============================================
    // COLLECT PERIODS FOR ASSOCIATE
    // ============================================

    function collectExecutiveSummaryPeriodsForAssociate(associate) {
        var weeklyData = getWeeklyData();
        var matchingPeriods = [];
        for (var weekKey in weeklyData) {
            var weekData = weeklyData[weekKey];
            var employee = weekData?.employees?.find(function(e) { return e.name === associate; });
            if (!employee) continue;

            matchingPeriods.push({
                weekKey: weekKey,
                label: weekData.metadata?.label || weekKey,
                employee: employee,
                centerAverage: getCenterAverageForWeek(weekKey),
                startDate: weekData.metadata?.startDate,
                endDate: weekData.metadata?.endDate
            });
        }
        return matchingPeriods;
    }

    // ============================================
    // YTD AVERAGES
    // ============================================

    function calculateExecutiveSummaryYtdAverages(periods) {
        var sums = {
            scheduleAdherence: { total: 0, count: 0 },
            overallExperience: { total: 0, count: 0 },
            fcr: { total: 0, count: 0 },
            transfers: { total: 0, count: 0 }
        };

        periods.forEach(function(period) {
            if (!period.employee) return;

            Object.keys(sums).forEach(function(metricKey) {
                var value = period.employee[metricKey];
                if (value === undefined || value === null || value === '') return;
                sums[metricKey].total += parseFloat(value);
                sums[metricKey].count += 1;
            });
        });

        var average = function(metricKey) {
            return sums[metricKey].count > 0
                ? (sums[metricKey].total / sums[metricKey].count).toFixed(1)
                : 0;
        };

        return {
            avgAdherence: average('scheduleAdherence'),
            avgExperience: average('overallExperience'),
            avgFCR: average('fcr'),
            avgTransfers: average('transfers')
        };
    }

    // ============================================
    // POPULATE EXECUTIVE SUMMARY TABLE
    // ============================================

    function populateExecutiveSummaryTable(associate, periods, periodType) {
        var tbody = document.getElementById('summaryDataTable');
        tbody.innerHTML = '';

        // Create a single YTD summary row instead of showing all periods
        var ytdAvgs = calculateExecutiveSummaryYtdAverages(periods);
        var avgAdherence = ytdAvgs.avgAdherence;
        var avgExperience = ytdAvgs.avgExperience;
        var avgFCR = ytdAvgs.avgFCR;
        var avgTransfers = ytdAvgs.avgTransfers;

        var row = document.createElement('tr');
        row.innerHTML = '\n        <td style="padding: 12px; border: 1px solid #ddd; background: #f9f9f9; font-weight: bold;">Year-to-Date Summary</td>\n        <td style="padding: 12px; border: 1px solid #ddd;">' + avgAdherence + '%</td>\n        <td style="padding: 12px; border: 1px solid #ddd;">' + avgExperience + '</td>\n        <td style="padding: 12px; border: 1px solid #ddd;">' + avgFCR + '%</td>\n        <td style="padding: 12px; border: 1px solid #ddd;">' + avgTransfers + '</td>\n        <td style="padding: 12px; border: 1px solid #ddd;">\n            <input type="text" class="redflags-input" data-week="ytd-summary" placeholder="Add red flags..." \n                style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">\n        </td>\n        <td style="padding: 12px; border: 1px solid #ddd;">\n            <input type="text" class="phishing-input" data-week="ytd-summary" placeholder="Phishing attempts..." \n                style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">\n        </td>\n    ';
        tbody.appendChild(row);

        // Load saved red flags and phishing data
        loadExecutiveSummaryNotes(associate);
    }

    // ============================================
    // NOTES STORE & PERSISTENCE
    // ============================================

    function getExecutiveSummaryNotesStore() {
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + 'executiveSummaryNotes');
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.error('Failed to parse executiveSummaryNotes:', e);
            return {};
        }
    }

    function bindExecutiveSummaryNotesInputs(selector, noteKey, associate, employeeNotes) {
        document.querySelectorAll(selector).forEach(function(input) {
            var weekKey = input.dataset.week;
            input.value = employeeNotes[weekKey]?.[noteKey] || '';
            bindElementOnce(input, 'input', function() { saveExecutiveSummaryNotes(associate); });
            bindElementOnce(input, 'change', function() { saveExecutiveSummaryNotes(associate); });
        });
    }

    function saveExecutiveSummaryNoteFields(saved, associate, selector, noteKey) {
        document.querySelectorAll(selector).forEach(function(input) {
            var weekKey = input.dataset.week;
            if (!saved[associate][weekKey]) saved[associate][weekKey] = {};
            saved[associate][weekKey][noteKey] = input.value;
        });
    }

    function loadExecutiveSummaryNotes(associate) {
        var saved = getExecutiveSummaryNotesStore();
        var employeeNotes = saved[associate] || {};

        bindExecutiveSummaryNotesInputs('.redflags-input', 'redFlags', associate, employeeNotes);
        bindExecutiveSummaryNotesInputs('.phishing-input', 'phishing', associate, employeeNotes);
    }

    function saveExecutiveSummaryNotes(associate) {
        var saved = getExecutiveSummaryNotesStore();

        if (!saved[associate]) {
            saved[associate] = {};
        }

        saveExecutiveSummaryNoteFields(saved, associate, '.redflags-input', 'redFlags');
        saveExecutiveSummaryNoteFields(saved, associate, '.phishing-input', 'phishing');

        localStorage.setItem(STORAGE_PREFIX + 'executiveSummaryNotes', JSON.stringify(saved));
        showToast('Notes saved for ' + associate, 3000);
    }

    // ============================================
    // YEARLY SUMMARY TREND CHARTS
    // ============================================

    function getYearlySummaryMetricsToShow() {
        return ['scheduleAdherence', 'overallExperience', 'cxRepOverall', 'fcr', 'transfers', 'aht', 'acw', 'holdTime', 'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions', 'reliability'];
    }

    function collectYearlySummaryTrendData(employeeName, keys, metricsToShow) {
        var weeklyData = getWeeklyData();
        var trendData = {};

        metricsToShow.forEach(function(metricKey) {
            trendData[metricKey] = [];
            keys.forEach(function(weekKey) {
                var week = weeklyData[weekKey];
                var emp = week?.employees?.find(function(e) { return e.name === employeeName; });
                if (emp && emp[metricKey] !== undefined && emp[metricKey] !== null && emp[metricKey] !== '') {
                    trendData[metricKey].push({
                        weekKey: weekKey,
                        value: parseFloat(emp[metricKey]),
                        label: formatWeekLabel(weekKey)
                    });
                }
            });
        });

        return trendData;
    }

    function initializeYearlySummaryChartsContainer(chartsContainer) {
        chartsContainer.innerHTML = '<h4 style="margin: 0 0 20px 0; color: #ff9800; font-size: 1.3em;">\u{1F4CA} Weekly Metric Trends</h4>';

        var chartsGrid = document.createElement('div');
        chartsGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px;';
        chartsContainer.appendChild(chartsGrid);
        return chartsGrid;
    }

    function buildYearlySummaryChartCard(chartsGrid) {
        var chartContainer = document.createElement('div');
        chartContainer.style.cssText = 'background: white; padding: 15px; border-radius: 8px; border: 1px solid #e0e0e0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);';

        var canvas = document.createElement('canvas');
        canvas.style.cssText = 'max-height: 250px;';

        chartContainer.appendChild(canvas);
        chartsGrid.appendChild(chartContainer);

        return canvas;
    }

    function renderYearlySummaryMetricChart(canvas, metric, metricKey, data) {
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: data.map(function(d) { return d.label; }),
                datasets: [{
                    label: metric.label || metricKey,
                    data: data.map(function(d) { return d.value; }),
                    backgroundColor: 'rgba(255, 152, 0, 0.6)',
                    borderColor: 'rgba(255, 152, 0, 1)',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    title: {
                        display: true,
                        text: (metric.label || metricKey) + ' Trend',
                        font: { size: 14, weight: 'bold' }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: metric.unit === '%',
                        title: {
                            display: true,
                            text: metric.unit || ''
                        }
                    }
                }
            }
        });
    }

    function renderYearlySummaryTrendCharts() {
        var chartsContainer = document.getElementById('summaryChartsContainer');
        if (!chartsContainer) return;

        var employeeName = document.getElementById('summaryAssociateSelect')?.value;

        if (!employeeName) {
            chartsContainer.innerHTML = '';
            return;
        }

        var keys = getWeeklyKeysSorted();
        if (keys.length < 2) {
            chartsContainer.innerHTML = '<p style="color: #999; padding: 20px;">Not enough weekly data to show trends (need at least 2 weeks).</p>';
            return;
        }

        var METRICS_REGISTRY = getMetricsRegistry();
        var metricsToShow = getYearlySummaryMetricsToShow();
        var trendData = collectYearlySummaryTrendData(employeeName, keys, metricsToShow);
        var chartsGrid = initializeYearlySummaryChartsContainer(chartsContainer);

        // Create bar charts for each metric
        metricsToShow.forEach(function(metricKey) {
            var metric = METRICS_REGISTRY[metricKey];
            var data = trendData[metricKey];

            if (!data || data.length < 1) return;

            var canvas = buildYearlySummaryChartCard(chartsGrid);
            renderYearlySummaryMetricChart(canvas, metric, metricKey, data);
        });
    }

    // ============================================
    // CENTER AVERAGE FOR WEEK
    // ============================================

    function getCenterAverageForWeek(weekKey) {
        // Load call center averages from localStorage
        var callCenterAverages = {};
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + 'callCenterAverages');
            if (raw) callCenterAverages = JSON.parse(raw);
        } catch (e) {
            console.error('Failed to parse callCenterAverages:', e);
        }
        var avg = callCenterAverages[weekKey];

        if (!avg || Object.keys(avg).length === 0) {
            return null;
        }

        // Map center average keys to employee data keys for consistency
        // Center averages use: adherence, repSatisfaction
        // Email metrics use: scheduleAdherence, cxRepOverall
        return {
            scheduleAdherence: avg.adherence,
            overallExperience: avg.overallExperience,
            cxRepOverall: avg.repSatisfaction,
            fcr: avg.fcr,
            transfers: avg.transfers,
            overallSentiment: avg.sentiment,
            positiveWord: avg.positiveWord,
            negativeWord: avg.negativeWord,
            managingEmotions: avg.managingEmotions,
            aht: avg.aht,
            acw: avg.acw,
            holdTime: avg.holdTime,
            reliability: avg.reliability
        };
    }

    // ============================================
    // MODULE EXPORT
    // ============================================

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.executiveSummary = {
        getYearlyAverageForEmployee: getYearlyAverageForEmployee,
        getPreviousPeriodData: getPreviousPeriodData,
        getExecutiveSummaryActiveYear: getExecutiveSummaryActiveYear,
        buildExecutiveSummaryAggregateMetrics: buildExecutiveSummaryAggregateMetrics,
        calculateExecutiveSummaryAverages: calculateExecutiveSummaryAverages,
        getExecutiveSummaryMetricCardStyle: getExecutiveSummaryMetricCardStyle,
        buildExecutiveSummaryCards: buildExecutiveSummaryCards,
        renderExecutiveSummaryCardsHtml: renderExecutiveSummaryCardsHtml,
        renderExecutiveSummary: renderExecutiveSummary,
        handleExecutiveSummaryAssociateChange: handleExecutiveSummaryAssociateChange,
        initializeYearlyIndividualSummary: initializeYearlyIndividualSummary,
        buildExecutiveSummaryCallouts: buildExecutiveSummaryCallouts,
        buildExecutiveSummarySavedNotesText: buildExecutiveSummarySavedNotesText,
        generateExecutiveSummaryCopilotEmail: generateExecutiveSummaryCopilotEmail,
        openCopilotWithPrompt: openCopilotWithPrompt,
        buildTeamVsCenterAnalysis: buildTeamVsCenterAnalysis,
        populateOneOnOneAssociateSelect: populateOneOnOneAssociateSelect,
        syncOneOnOneAssociateSelect: syncOneOnOneAssociateSelect,
        populateExecutiveSummaryAssociate: populateExecutiveSummaryAssociate,
        loadExecutiveSummaryData: loadExecutiveSummaryData,
        setExecutiveSummaryVisibility: setExecutiveSummaryVisibility,
        collectExecutiveSummaryPeriodsForAssociate: collectExecutiveSummaryPeriodsForAssociate,
        calculateExecutiveSummaryYtdAverages: calculateExecutiveSummaryYtdAverages,
        populateExecutiveSummaryTable: populateExecutiveSummaryTable,
        getExecutiveSummaryNotesStore: getExecutiveSummaryNotesStore,
        bindExecutiveSummaryNotesInputs: bindExecutiveSummaryNotesInputs,
        saveExecutiveSummaryNoteFields: saveExecutiveSummaryNoteFields,
        loadExecutiveSummaryNotes: loadExecutiveSummaryNotes,
        saveExecutiveSummaryNotes: saveExecutiveSummaryNotes,
        getYearlySummaryMetricsToShow: getYearlySummaryMetricsToShow,
        collectYearlySummaryTrendData: collectYearlySummaryTrendData,
        initializeYearlySummaryChartsContainer: initializeYearlySummaryChartsContainer,
        buildYearlySummaryChartCard: buildYearlySummaryChartCard,
        renderYearlySummaryMetricChart: renderYearlySummaryMetricChart,
        renderYearlySummaryTrendCharts: renderYearlySummaryTrendCharts,
        getCenterAverageForWeek: getCenterAverageForWeek
    };

    // Maintain backward compatibility with existing global references
    window.getYearlyAverageForEmployee = getYearlyAverageForEmployee;
    window.getPreviousPeriodData = getPreviousPeriodData;
    window.getExecutiveSummaryActiveYear = getExecutiveSummaryActiveYear;
    window.buildExecutiveSummaryAggregateMetrics = buildExecutiveSummaryAggregateMetrics;
    window.calculateExecutiveSummaryAverages = calculateExecutiveSummaryAverages;
    window.getExecutiveSummaryMetricCardStyle = getExecutiveSummaryMetricCardStyle;
    window.buildExecutiveSummaryCards = buildExecutiveSummaryCards;
    window.renderExecutiveSummaryCardsHtml = renderExecutiveSummaryCardsHtml;
    window.renderExecutiveSummary = renderExecutiveSummary;
    window.handleExecutiveSummaryAssociateChange = handleExecutiveSummaryAssociateChange;
    window.initializeYearlyIndividualSummary = initializeYearlyIndividualSummary;
    window.buildExecutiveSummaryCallouts = buildExecutiveSummaryCallouts;
    window.buildExecutiveSummarySavedNotesText = buildExecutiveSummarySavedNotesText;
    window.generateExecutiveSummaryCopilotEmail = generateExecutiveSummaryCopilotEmail;
    window.openCopilotWithPrompt = openCopilotWithPrompt;
    window.buildTeamVsCenterAnalysis = buildTeamVsCenterAnalysis;
    window.populateOneOnOneAssociateSelect = populateOneOnOneAssociateSelect;
    window.syncOneOnOneAssociateSelect = syncOneOnOneAssociateSelect;
    window.populateExecutiveSummaryAssociate = populateExecutiveSummaryAssociate;
    window.loadExecutiveSummaryData = loadExecutiveSummaryData;
    window.setExecutiveSummaryVisibility = setExecutiveSummaryVisibility;
    window.collectExecutiveSummaryPeriodsForAssociate = collectExecutiveSummaryPeriodsForAssociate;
    window.calculateExecutiveSummaryYtdAverages = calculateExecutiveSummaryYtdAverages;
    window.populateExecutiveSummaryTable = populateExecutiveSummaryTable;
    window.getExecutiveSummaryNotesStore = getExecutiveSummaryNotesStore;
    window.bindExecutiveSummaryNotesInputs = bindExecutiveSummaryNotesInputs;
    window.saveExecutiveSummaryNoteFields = saveExecutiveSummaryNoteFields;
    window.loadExecutiveSummaryNotes = loadExecutiveSummaryNotes;
    window.saveExecutiveSummaryNotes = saveExecutiveSummaryNotes;
    window.getYearlySummaryMetricsToShow = getYearlySummaryMetricsToShow;
    window.collectYearlySummaryTrendData = collectYearlySummaryTrendData;
    window.initializeYearlySummaryChartsContainer = initializeYearlySummaryChartsContainer;
    window.buildYearlySummaryChartCard = buildYearlySummaryChartCard;
    window.renderYearlySummaryMetricChart = renderYearlySummaryMetricChart;
    window.renderYearlySummaryTrendCharts = renderYearlySummaryTrendCharts;
    window.getCenterAverageForWeek = getCenterAverageForWeek;

})();
