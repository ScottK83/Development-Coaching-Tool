/**
 * Team Snapshot Module
 * Generates shareable team performance graphics for Teams chat.
 * Shows each associate's metrics with green/yellow/red target indicators
 * and above/below center average markers.
 */
(function() {
    'use strict';

    var STORAGE_PREFIX = 'devCoachingTool_';

    // Key metrics to show in snapshot
    var SNAPSHOT_METRICS = [
        'totalCalls', 'scheduleAdherence',
        'transfers', 'transfersCount', 'aht', 'acw',
        'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions',
        'reliability',
        'cxRepOverall', 'fcr', 'overallExperience'
    ];

    // Short labels for the graphic header
    var SHORT_LABELS = {
        totalCalls: 'Calls',
        scheduleAdherence: 'Adh',
        cxRepOverall: 'CX Rep',
        fcr: 'FCR',
        overallExperience: 'Exp',
        transfers: 'Xfer%',
        transfersCount: '#Xfer',
        aht: 'AHT',
        acw: 'ACW',
        overallSentiment: 'Sent',
        positiveWord: '+Word',
        negativeWord: '-Word',
        managingEmotions: 'Emot',
        reliability: 'Rel'
    };

    var SURVEY_WEIGHTED_SNAP = { cxRepOverall: true, fcr: true, overallExperience: true };
    var CUMULATIVE_SNAP = { reliability: true };

    /**
     * Compute weighted team average for a metric across snapshot rows.
     * Rate metrics: weighted by totalCalls or surveyTotal.
     * Cumulative metrics (reliability): summed.
     * Returns null if no data.
     */
    function computeTeamMetricValue(rows, metricKey) {
        if (CUMULATIVE_SNAP[metricKey]) {
            var sum = 0, hasData = false;
            rows.forEach(function(row) {
                var cell = row.cells.find(function(c) { return c.metricKey === metricKey; });
                if (cell && cell.hasValue && cell.value !== 0) { sum += cell.value; hasData = true; }
            });
            return hasData ? sum : null;
        }

        var wSum = 0, wCount = 0;
        rows.forEach(function(row) {
            var cell = row.cells.find(function(c) { return c.metricKey === metricKey; });
            if (!cell || !cell.hasValue || cell.value === 0) return;
            var w = 1;
            if (SURVEY_WEIGHTED_SNAP[metricKey]) {
                w = row.surveyTotal > 0 ? row.surveyTotal : 0;
            } else {
                w = row.totalCalls > 0 ? row.totalCalls : 1;
            }
            if (w > 0) { wSum += cell.value * w; wCount += w; }
        });
        return wCount > 0 ? wSum / wCount : null;
    }

    function getMetrics() {
        return window.DevCoachModules?.metrics || {};
    }

    function getRegistry() {
        return window.METRICS_REGISTRY || {};
    }

    function escapeHtml(text) {
        var str = String(text ?? '');
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function getWeeklyData() {
        // Try the live global first, fall back to loading from storage
        var storage = window.DevCoachModules?.storage;
        if (storage?.loadWeeklyData) return storage.loadWeeklyData();
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + 'weeklyData');
            return raw ? JSON.parse(raw) : {};
        } catch(e) { return {}; }
    }

    function getYtdData() {
        var storage = window.DevCoachModules?.storage;
        if (storage?.loadYtdData) return storage.loadYtdData();
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + 'ytdData');
            return raw ? JSON.parse(raw) : {};
        } catch(e) { return {}; }
    }

    function getMyTeamMembers() {
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + 'myTeamMembers');
            return raw ? JSON.parse(raw) : {};
        } catch(e) { return {}; }
    }

    // ============================================
    // DATA RETRIEVAL
    // ============================================

    /**
     * Get all available period keys from weeklyData and ytdData
     */
    function getAvailablePeriods() {
        var periods = [];
        var weeklyData = getWeeklyData();
        var ytdData = getYtdData();

        Object.keys(weeklyData).forEach(function(key) {
            var data = weeklyData[key];
            var meta = data?.metadata || {};
            var pType = meta.periodType || 'week';
            var label = meta.label || formatPeriodLabel(key, pType);
            periods.push({ key: key, label: label, type: pType, source: 'weekly' });
        });

        Object.keys(ytdData).forEach(function(key) {
            var data = ytdData[key];
            var meta = data?.metadata || {};
            var pType = meta.periodType || 'ytd';
            var label = meta.label || formatPeriodLabel(key, pType);
            periods.push({ key: key, label: label, type: pType, source: 'ytd' });
        });

        // Sort newest first
        periods.sort(function(a, b) {
            var aDate = a.key.split('|')[0] || '';
            var bDate = b.key.split('|')[0] || '';
            return bDate.localeCompare(aDate);
        });

        return periods;
    }

    function formatPeriodLabel(key, type) {
        var parts = key.split('|');
        var endDate = parts[0] || '';
        var prefix = type === 'daily' ? 'Daily:' : type === 'week' ? 'Week ending' : type === 'month' ? 'Month ending' : 'YTD ending';
        return prefix + ' ' + endDate;
    }

    /**
     * Get employees for a given period key
     */
    function getEmployeesForPeriod(periodKey, source) {
        var dataSource = source === 'ytd' ? getYtdData() : getWeeklyData();
        var periodData = dataSource[periodKey];
        if (!periodData) return [];
        return periodData.employees || [];
    }

    /**
     * Get team members filter for a period
     */
    function getTeamFilter(periodKey) {
        var myTeamMembers = getMyTeamMembers();
        // Try exact key match first
        if (myTeamMembers[periodKey] && myTeamMembers[periodKey].length > 0) {
            return myTeamMembers[periodKey];
        }
        // Fall back to team filter module's resolved context (handles YTD keys)
        var teamFilter = window.DevCoachModules?.teamFilter;
        if (teamFilter?.getTeamSelectionContext) {
            var ctx = teamFilter.getTeamSelectionContext();
            if (ctx.weekKey && ctx.selectedMembers && ctx.selectedMembers.length > 0) {
                return ctx.selectedMembers;
            }
        }
        return [];
    }

    /**
     * Get center averages for a period
     */
    function getCenterAverages(periodKey) {
        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + 'callCenterAverages');
            var all = raw ? JSON.parse(raw) : {};
            return all[periodKey] || null;
        } catch(e) {
            return null;
        }
    }

    // ============================================
    // CENTER AVERAGE INPUT
    // ============================================

    function buildCenterAvgInputRow() {
        var registry = getRegistry();
        var cells = SNAPSHOT_METRICS.map(function(key) {
            var unit = registry[key]?.unit || '%';
            var placeholder = unit === 'sec' ? '0' : unit === 'hrs' ? '0.0' : '0.0';
            return '<td style="padding: 4px;"><input type="text" id="snapCenterAvg_' + key + '" ' +
                'placeholder="' + placeholder + '" ' +
                'style="width: 60px; padding: 4px; text-align: center; border: 1px solid #ccc; border-radius: 3px; font-size: 0.85em;" /></td>';
        }).join('');

        return '<tr style="background: #e3f2fd;">' +
            '<td style="padding: 6px 8px; font-weight: 600; color: #1565c0; white-space: nowrap;">' +
            'Center Avg<br><span style="font-size: 0.7em; font-weight: 400; color: #1976d2;">' +
            'Headcount: <input type="number" id="snapCenterHeadcount" value="144" min="1" ' +
            'style="width: 45px; padding: 2px; text-align: center; border: 1px solid #90caf9; border-radius: 3px; font-size: 0.85em;" />' +
            '</span></td>' +
            cells + '</tr>';
    }

    function loadCenterAvgInputs(periodKey) {
        var avg = getCenterAverages(periodKey);
        if (!avg) return;

        // Map center avg keys to our metric keys
        // Storage uses: adherence, repSatisfaction, sentiment (from AVERAGE_FORM_FIELD_MAP)
        var keyMap = {
            scheduleAdherence: avg.adherence ?? avg.scheduleAdherence,
            cxRepOverall: avg.repSatisfaction ?? avg.cxRepOverall,
            fcr: avg.fcr,
            overallExperience: avg.overallExperience,
            transfers: avg.transfers,
            aht: avg.aht,
            acw: avg.acw,
            overallSentiment: avg.sentiment ?? avg.overallSentiment,
            positiveWord: avg.positiveWord,
            negativeWord: avg.negativeWord,
            managingEmotions: avg.managingEmotions,
            reliability: avg.reliability
        };

        SNAPSHOT_METRICS.forEach(function(key) {
            var input = document.getElementById('snapCenterAvg_' + key);
            if (input && keyMap[key] !== undefined && keyMap[key] !== null) {
                input.value = keyMap[key];
            }
        });
    }

    function readCenterAvgInputs() {
        var avgs = {};

        SNAPSHOT_METRICS.forEach(function(key) {
            var input = document.getElementById('snapCenterAvg_' + key);
            if (input && input.value.trim() !== '') {
                var val = parseFloat(input.value.trim());
                if (!isNaN(val)) {
                    avgs[key] = val;
                }
            }
        });
        return avgs;
    }

    /**
     * Save center averages from snapshot inputs back to storage
     * so they cascade through the entire app.
     */
    function saveCenterAvgsToStorage(periodKey, centerAvgs) {
        if (!periodKey || !centerAvgs || Object.keys(centerAvgs).length === 0) return;

        // Map snapshot metric keys to storage format
        var storageAvg = {};
        if (centerAvgs.scheduleAdherence !== undefined) storageAvg.adherence = centerAvgs.scheduleAdherence;
        if (centerAvgs.cxRepOverall !== undefined) storageAvg.repSatisfaction = centerAvgs.cxRepOverall;
        if (centerAvgs.fcr !== undefined) storageAvg.fcr = centerAvgs.fcr;
        if (centerAvgs.overallExperience !== undefined) storageAvg.overallExperience = centerAvgs.overallExperience;
        if (centerAvgs.transfers !== undefined) storageAvg.transfers = centerAvgs.transfers;
        if (centerAvgs.aht !== undefined) storageAvg.aht = centerAvgs.aht;
        if (centerAvgs.acw !== undefined) storageAvg.acw = centerAvgs.acw;
        if (centerAvgs.overallSentiment !== undefined) storageAvg.sentiment = centerAvgs.overallSentiment;
        if (centerAvgs.positiveWord !== undefined) storageAvg.positiveWord = centerAvgs.positiveWord;
        if (centerAvgs.negativeWord !== undefined) storageAvg.negativeWord = centerAvgs.negativeWord;
        if (centerAvgs.managingEmotions !== undefined) storageAvg.managingEmotions = centerAvgs.managingEmotions;
        if (centerAvgs.reliability !== undefined) storageAvg.reliability = centerAvgs.reliability;
        storageAvg.lastUpdated = new Date().toISOString();

        try {
            var raw = localStorage.getItem(STORAGE_PREFIX + 'callCenterAverages');
            var all = raw ? JSON.parse(raw) : {};
            all[periodKey] = storageAvg;
            localStorage.setItem(STORAGE_PREFIX + 'callCenterAverages', JSON.stringify(all));
        } catch(e) {
            console.error('Failed to save center averages from snapshot:', e);
        }
    }

    // ============================================
    // SNAPSHOT DATA ASSEMBLY
    // ============================================

    function assembleSnapshotData(periodKey, source) {
        var employees = getEmployeesForPeriod(periodKey, source);
        var teamFilter = getTeamFilter(periodKey);
        var centerAvgs = readCenterAvgInputs();
        var metrics = getMetrics();

        // Filter to team members if filter is set
        if (teamFilter.length > 0) {
            employees = employees.filter(function(emp) {
                return teamFilter.indexOf(emp.name) !== -1;
            });
        }

        // Exclude absent employees (0 calls) if checkbox is checked
        var excludeAbsent = document.getElementById('snapshotExcludeAbsent');
        if (excludeAbsent && excludeAbsent.checked) {
            employees = employees.filter(function(emp) {
                var calls = parseInt(emp.totalCalls);
                return !isNaN(calls) && calls > 0;
            });
        }

        // Sort by name
        employees.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        var rows = employees.map(function(emp) {
            var cells = SNAPSHOT_METRICS.map(function(metricKey) {
                var value = emp[metricKey];
                var numValue = parseFloat(value);
                var hasValue = value !== undefined && value !== null && value !== '' && !isNaN(numValue);

                var registry = getRegistry();
                var target = registry[metricKey]?.target;
                var meetsTarget = false;
                var centerAvg = centerAvgs[metricKey];
                var aboveAvg = null;

                if (hasValue && target) {
                    meetsTarget = metrics.isMetricMeetingTarget?.(metricKey, numValue, target.value) || false;
                }

                var avgDelta = null;
                if (hasValue && centerAvg !== undefined && !isNaN(centerAvg)) {
                    var isReverse = metrics.isReverseMetric?.(metricKey) || false;
                    aboveAvg = isReverse ? (numValue <= centerAvg) : (numValue >= centerAvg);
                    // Delta: positive = good direction, negative = bad direction
                    avgDelta = isReverse ? (centerAvg - numValue) : (numValue - centerAvg);
                }

                var displayValue = hasValue ? metrics.formatMetricValue?.(metricKey, numValue) || String(numValue) : 'N/A';

                return {
                    metricKey: metricKey,
                    value: numValue,
                    displayValue: displayValue,
                    hasValue: hasValue,
                    meetsTarget: meetsTarget,
                    aboveAvg: aboveAvg,
                    avgDelta: avgDelta
                };
            });

            return {
                name: emp.firstName || emp.name?.split(',')[0]?.trim() || emp.name || 'Unknown',
                fullName: emp.name || 'Unknown',
                totalCalls: parseInt(emp.totalCalls, 10) || 0,
                surveyTotal: parseInt(emp.surveyTotal, 10) || 0,
                cells: cells
            };
        });

        return {
            rows: rows,
            centerAvgs: centerAvgs,
            periodKey: periodKey,
            source: source
        };
    }

    // ============================================
    // FOCUS OF THE DAY
    // ============================================

    function determineFocusMetric(snapshotData) {
        var registry = getRegistry();
        var metrics = getMetrics();
        var metricMissCount = {};

        // Only consider metrics that have a defined target
        SNAPSHOT_METRICS.forEach(function(key) {
            var def = registry[key];
            if (!def?.target) return; // skip metrics with no target
            metricMissCount[key] = { total: 0, missing: 0 };
        });

        snapshotData.rows.forEach(function(row) {
            row.cells.forEach(function(cell) {
                if (!cell.hasValue) return;
                if (!metricMissCount[cell.metricKey]) return; // skip metrics with no target
                metricMissCount[cell.metricKey].total++;
                if (!cell.meetsTarget) {
                    metricMissCount[cell.metricKey].missing++;
                }
            });
        });

        var worstMetric = null;
        var worstPct = -1;

        Object.keys(metricMissCount).forEach(function(key) {
            var data = metricMissCount[key];
            if (data.total === 0) return;
            var pct = data.missing / data.total;
            if (pct > worstPct) {
                worstPct = pct;
                worstMetric = key;
            }
        });

        if (!worstMetric || worstPct === 0) return null;

        var def = registry[worstMetric];
        return {
            metricKey: worstMetric,
            label: def?.label || worstMetric,
            icon: def?.icon || '',
            tip: def?.defaultTip || '',
            missCount: metricMissCount[worstMetric].missing,
            totalCount: metricMissCount[worstMetric].total,
            missPct: Math.round(worstPct * 100)
        };
    }

    // ============================================
    // GRAPHIC RENDERING
    // ============================================

    function renderSnapshotGraphic(snapshotData, periodLabel) {
        var container = document.getElementById('snapshotGraphicContainer');
        if (!container) return;

        var focus = determineFocusMetric(snapshotData);
        var registry = getRegistry();
        var now = new Date();
        var dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

        // Smart column ordering: metrics with real data first, all-zero metrics pushed to end
        var metricsWithData = [];
        var metricsAllZero = [];
        SNAPSHOT_METRICS.forEach(function(key) {
            var hasNonZero = snapshotData.rows.some(function(row) {
                var cell = row.cells.find(function(c) { return c.metricKey === key; });
                return cell && cell.hasValue && cell.value !== 0;
            });
            var hasAnyValue = snapshotData.rows.some(function(row) {
                var cell = row.cells.find(function(c) { return c.metricKey === key; });
                return cell && cell.hasValue;
            });
            if (hasNonZero) {
                metricsWithData.push(key);
            } else if (hasAnyValue) {
                metricsAllZero.push(key);  // all zeros — push to end
            }
            // no data at all — excluded entirely
        });
        var visibleMetrics = metricsWithData.concat(metricsAllZero);

        // Build header row
        var headerCells = visibleMetrics.map(function(key) {
            var def = registry[key];
            return '<th style="padding: 6px 4px; font-size: 0.7em; font-weight: 700; color: #475569; text-align: center; ' +
                'border-bottom: 2px solid #cbd5e1; white-space: nowrap;">' +
                (def?.icon || '') + '<br>' + SHORT_LABELS[key] + '</th>';
        }).join('');

        // Build data rows
        var dataRows = snapshotData.rows.map(function(row, idx) {
            var bgColor = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
            var filteredCells = row.cells.filter(function(c) { return visibleMetrics.indexOf(c.metricKey) !== -1; });
            var cells = filteredCells.map(function(cell) {
                var bg = '#ffffff';
                var color = '#334155';
                var indicator = '';

                if (cell.hasValue) {
                    if (cell.meetsTarget) {
                        bg = '#dcfce7'; // green
                        color = '#166534';
                    } else {
                        bg = '#fee2e2'; // red
                        color = '#991b1b';
                    }

                    if (cell.avgDelta !== null && cell.avgDelta !== undefined) {
                        var deltaAbs = Math.abs(cell.avgDelta);
                        var registry = getRegistry();
                        var unit = registry[cell.metricKey]?.unit || '%';
                        var deltaStr;
                        if (unit === 'sec') {
                            deltaStr = Math.round(deltaAbs) + 's';
                        } else if (unit === 'hrs') {
                            deltaStr = deltaAbs.toFixed(1) + 'h';
                        } else if (unit === '#') {
                            deltaStr = Math.round(deltaAbs).toString();
                        } else {
                            deltaStr = deltaAbs.toFixed(1);
                        }

                        if (cell.aboveAvg === true) {
                            indicator = '<br><span style="color: #16a34a; font-size: 0.65em; font-weight: 700;">+' + deltaStr + '</span>';
                        } else if (cell.aboveAvg === false) {
                            indicator = '<br><span style="color: #dc2626; font-size: 0.65em; font-weight: 700;">-' + deltaStr + '</span>';
                        }
                    }
                }

                return '<td style="padding: 5px 4px; text-align: center; font-size: 0.8em; font-weight: 600; ' +
                    'background: ' + bg + '; color: ' + color + '; border-bottom: 1px solid #e2e8f0;">' +
                    (cell.hasValue ? escapeHtml(cell.displayValue) + indicator : '<span style="color: #94a3b8;">--</span>') +
                    '</td>';
            }).join('');

            return '<tr style="background: ' + bgColor + ';">' +
                '<td style="padding: 6px 10px; font-weight: 600; font-size: 0.85em; color: #1e293b; ' +
                'border-bottom: 1px solid #e2e8f0; white-space: nowrap;">' + escapeHtml(row.name) + '</td>' +
                cells + '</tr>';
        }).join('');

        // Build team avg row (computed from employee data)
        var centerAvgs = snapshotData.centerAvgs;
        var hasCenterAvgs = Object.keys(centerAvgs).length > 0;
        var teamAvgCells = visibleMetrics.map(function(key) {
            var avg = computeTeamMetricValue(snapshotData.rows, key);
            if (avg === null) {
                return '<td style="padding: 5px 4px; text-align: center; font-size: 0.75em; font-weight: 700; ' +
                    'color: #7c3aed; background: #f5f3ff; border-bottom: 2px solid #c4b5fd;">--</td>';
            }
            var metrics = getMetrics();
            var display = metrics.formatMetricValue?.(key, avg) || String(Math.round(avg * 10) / 10);

            // Check target
            var def = registry[key];
            var target = def?.target;
            var meetsTarget = target ? (metrics.isMetricMeetingTarget?.(key, avg, target.value) || false) : null;

            // Check vs center avg
            var centerVal = centerAvgs[key];
            var isReverse = metrics.isReverseMetric?.(key) || false;
            var beatsCenterAvg = (hasCenterAvgs && centerVal !== undefined && !isNaN(centerVal))
                ? (isReverse ? avg <= centerVal : avg >= centerVal)
                : null;

            // Determine colors: green if meets target, red if not, purple if no target
            var bg, color;
            if (meetsTarget === true) {
                bg = '#dcfce7'; color = '#166534';
            } else if (meetsTarget === false) {
                bg = '#fee2e2'; color = '#991b1b';
            } else {
                bg = '#f5f3ff'; color = '#7c3aed';
            }

            // Add center avg comparison indicator
            var indicator = '';
            if (beatsCenterAvg === true) {
                indicator = '<br><span style="font-size: 0.65em; color: #16a34a;">\u25B2 above ctr</span>';
            } else if (beatsCenterAvg === false) {
                indicator = '<br><span style="font-size: 0.65em; color: #dc2626;">\u25BC below ctr</span>';
            }

            return '<td style="padding: 5px 4px; text-align: center; font-size: 0.75em; font-weight: 700; ' +
                'color: ' + color + '; background: ' + bg + '; border-bottom: 2px solid #c4b5fd;">' +
                escapeHtml(display) + indicator + '</td>';
        }).join('');
        var teamAvgRow = '<tr><td style="padding: 5px 10px; font-weight: 700; font-size: 0.8em; color: #7c3aed; ' +
            'background: #f5f3ff; border-bottom: 2px solid #c4b5fd; white-space: nowrap;">Team Avg</td>' + teamAvgCells + '</tr>';

        // Build center avg row
        var centerRow = '';
        if (hasCenterAvgs) {
            var centerCells = visibleMetrics.map(function(key) {
                var val = centerAvgs[key];
                var metrics = getMetrics();
                var display = (val !== undefined && !isNaN(val)) ? (metrics.formatMetricValue?.(key, val) || String(val)) : '--';
                return '<td style="padding: 5px 4px; text-align: center; font-size: 0.75em; font-weight: 700; ' +
                    'color: #1565c0; background: #e3f2fd; border-bottom: 2px solid #90caf9;">' + escapeHtml(display) + '</td>';
            }).join('');
            centerRow = '<tr><td style="padding: 5px 10px; font-weight: 700; font-size: 0.8em; color: #1565c0; ' +
                'background: #e3f2fd; border-bottom: 2px solid #90caf9; white-space: nowrap;">Center Avg</td>' + centerCells + '</tr>';
        }

        // Build target row
        var targetCells = visibleMetrics.map(function(key) {
            var def = registry[key];
            var target = def?.target;
            if (!target) return '<td style="padding: 4px; text-align: center; font-size: 0.7em; color: #64748b; background: #f1f5f9;">--</td>';
            var prefix = target.type === 'min' ? '\u2265' : '\u2264';
            var unit = def?.unit || '';
            var valStr = unit === 'sec' ? target.value + 's' : unit === 'hrs' ? target.value + 'h' : target.value + '%';
            return '<td style="padding: 4px; text-align: center; font-size: 0.7em; color: #64748b; ' +
                'background: #f1f5f9; border-bottom: 1px solid #e2e8f0;">' + prefix + valStr + '</td>';
        }).join('');
        var targetRow = '<tr><td style="padding: 4px 10px; font-size: 0.7em; color: #64748b; font-weight: 600; ' +
            'background: #f1f5f9; border-bottom: 1px solid #e2e8f0; white-space: nowrap;">Target</td>' + targetCells + '</tr>';

        // Focus of the Day
        var focusHtml = '';
        if (focus) {
            focusHtml = '<div style="margin-top: 12px; padding: 10px 14px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); ' +
                'border-radius: 8px; border-left: 4px solid #f59e0b;">' +
                '<div style="font-weight: 700; font-size: 0.9em; color: #92400e; margin-bottom: 4px;">' +
                focus.icon + ' Focus of the Day: ' + escapeHtml(focus.label) + '</div>' +
                '<div style="font-size: 0.8em; color: #78350f;">' +
                focus.missCount + ' of ' + focus.totalCount + ' associates below target (' + focus.missPct + '% miss rate)</div>' +
                '<div style="font-size: 0.78em; color: #92400e; margin-top: 4px; font-style: italic;">' +
                escapeHtml(focus.tip) + '</div></div>';
        }

        // Legend
        var legendHtml = '<div style="display: flex; gap: 14px; margin-top: 10px; flex-wrap: wrap; align-items: center; ' +
            'padding: 8px 12px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">' +
            '<span style="font-size: 0.72em; font-weight: 600; color: #334155; margin-right: 2px;">Legend:</span>' +
            '<span style="font-size: 0.72em; color: #475569;">' +
            '<span style="display: inline-block; width: 12px; height: 12px; background: #dcfce7; border: 1px solid #86efac; ' +
            'border-radius: 2px; vertical-align: middle; margin-right: 3px;"></span> Meeting Target</span>' +
            '<span style="font-size: 0.72em; color: #475569;">' +
            '<span style="display: inline-block; width: 12px; height: 12px; background: #fee2e2; border: 1px solid #fca5a5; ' +
            'border-radius: 2px; vertical-align: middle; margin-right: 3px;"></span> Below Target</span>' +
            '<span style="font-size: 0.72em; color: #475569;">' +
            '<span style="color: #16a34a; font-weight: 700;">+2.1</span> = 2.1 above center avg</span>' +
            '<span style="font-size: 0.72em; color: #475569;">' +
            '<span style="color: #dc2626; font-weight: 700;">-3.5</span> = 3.5 below center avg</span>' +
            '</div>';

        // Assemble the full graphic
        var html = '<div id="snapshotExportArea" style="background: #ffffff; border-radius: 12px; padding: 20px; ' +
            'font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 900px; ' +
            'box-shadow: 0 2px 12px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0;">' +
            // Title bar
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; ' +
            'padding-bottom: 10px; border-bottom: 2px solid #3b82f6;">' +
            '<div><div style="font-size: 1.15em; font-weight: 800; color: #1e293b;">Team Performance Snapshot</div>' +
            '<div style="font-size: 0.8em; color: #64748b;">' + escapeHtml(periodLabel) + '</div></div>' +
            '<div style="font-size: 0.75em; color: #94a3b8;">Generated ' + escapeHtml(dateStr) + '</div></div>' +
            // Table
            '<div style="overflow-x: auto;">' +
            '<table style="width: 100%; border-collapse: collapse; border-spacing: 0;">' +
            '<thead><tr><th style="padding: 6px 10px; text-align: left; font-size: 0.75em; font-weight: 700; ' +
            'color: #475569; border-bottom: 2px solid #cbd5e1;">Associate</th>' + headerCells + '</tr></thead>' +
            '<tbody>' + targetRow + dataRows + teamAvgRow + centerRow + '</tbody>' +
            '</table></div>' +
            // Legend
            legendHtml +
            // Focus
            focusHtml +
            '</div>';

        container.innerHTML = html;

        // Show the export buttons
        var exportBtns = document.getElementById('snapshotExportBtns');
        if (exportBtns) exportBtns.style.display = 'flex';
    }

    // ============================================
    // SCORECARD (simplified center avg comparison)
    // ============================================

    function generateScorecard() {
        var select = document.getElementById('snapshotPeriodSelect');
        if (!select || !select.value) {
            alert('Please select a period first.');
            return;
        }

        var parts = select.value.split('|');
        var source = parts[parts.length - 1];
        var periodKey = parts.slice(0, -1).join('|');

        var periods = getAvailablePeriods();
        var period = periods.find(function(p) { return p.key === periodKey && p.source === source; });
        var periodLabel = period ? period.label : periodKey;

        var snapshotData = assembleSnapshotData(periodKey, source);
        saveCenterAvgsToStorage(periodKey, snapshotData.centerAvgs);
        renderScorecardGraphic(snapshotData, periodLabel);
    }

    function renderScorecardGraphic(snapshotData, periodLabel) {
        var container = document.getElementById('snapshotGraphicContainer');
        if (!container) return;

        var registry = getRegistry();
        var metrics = getMetrics();
        var centerAvgs = snapshotData.centerAvgs;
        var hasCenterAvgs = Object.keys(centerAvgs).length > 0;
        var now = new Date();
        var dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

        if (!hasCenterAvgs) {
            container.innerHTML = '<div style="padding: 30px; text-align: center; color: #dc2626; font-weight: 600;">No center averages entered. Fill in the Center Avg row above first.</div>';
            return;
        }

        // Only show metrics that have center avg data AND employee data
        var visibleMetrics = SNAPSHOT_METRICS.filter(function(key) {
            if (centerAvgs[key] === undefined || isNaN(centerAvgs[key])) return false;
            return snapshotData.rows.some(function(row) {
                var cell = row.cells.find(function(c) { return c.metricKey === key; });
                return cell && cell.hasValue && cell.value !== 0;
            });
        });

        if (visibleMetrics.length === 0) {
            container.innerHTML = '<div style="padding: 30px; text-align: center; color: #dc2626; font-weight: 600;">No matching metrics with center averages to compare.</div>';
            return;
        }

        // Header cells
        var headerCells = visibleMetrics.map(function(key) {
            var def = registry[key];
            return '<th style="padding: 8px 6px; font-size: 0.75em; font-weight: 700; color: #1e293b; text-align: center; ' +
                'border-bottom: 3px solid #3b82f6; background: #f0f9ff;">' +
                SHORT_LABELS[key] + '</th>';
        }).join('');

        // Data rows - just value + arrow/delta
        var dataRows = snapshotData.rows.map(function(row, idx) {
            var bgColor = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
            var cells = visibleMetrics.map(function(key) {
                var cell = row.cells.find(function(c) { return c.metricKey === key; });
                if (!cell || !cell.hasValue) {
                    return '<td style="padding: 6px 4px; text-align: center; font-size: 0.85em; color: #94a3b8; ' +
                        'border-bottom: 1px solid #e2e8f0;">--</td>';
                }

                var unit = registry[key]?.unit || '%';
                var deltaStr = '';
                var arrow = '';
                var bg = bgColor;
                var fontColor = '#334155';

                if (cell.avgDelta !== null && cell.avgDelta !== undefined) {
                    var deltaAbs = Math.abs(cell.avgDelta);
                    if (unit === 'sec') {
                        deltaStr = Math.round(deltaAbs) + 's';
                    } else if (unit === 'hrs') {
                        deltaStr = deltaAbs.toFixed(1) + 'h';
                    } else if (unit === '#') {
                        deltaStr = Math.round(deltaAbs).toString();
                    } else {
                        deltaStr = deltaAbs.toFixed(1) + '%';
                    }

                    if (cell.aboveAvg === true) {
                        arrow = '<span style="color: #16a34a; font-weight: 800; font-size: 1.1em;">\u25B2</span>';
                        bg = '#f0fdf4';
                        fontColor = '#166534';
                    } else if (cell.aboveAvg === false) {
                        arrow = '<span style="color: #dc2626; font-weight: 800; font-size: 1.1em;">\u25BC</span>';
                        bg = '#fef2f2';
                        fontColor = '#991b1b';
                    }
                }

                return '<td style="padding: 6px 4px; text-align: center; border-bottom: 1px solid #e2e8f0; background: ' + bg + ';">' +
                    '<div style="font-size: 0.85em; font-weight: 600; color: ' + fontColor + ';">' + escapeHtml(cell.displayValue) + '</div>' +
                    (arrow ? '<div style="font-size: 0.75em; line-height: 1.2;">' + arrow + ' <span style="color: ' + fontColor + '; font-weight: 700;">' + deltaStr + '</span></div>' : '') +
                    '</td>';
            }).join('');

            return '<tr style="background: ' + bgColor + ';">' +
                '<td style="padding: 8px 12px; font-weight: 700; font-size: 0.9em; color: #1e293b; ' +
                'border-bottom: 1px solid #e2e8f0; white-space: nowrap;">' + escapeHtml(row.name) + '</td>' +
                cells + '</tr>';
        }).join('');

        // Team average row
        var teamAvgCells = visibleMetrics.map(function(key) {
            var avg = computeTeamMetricValue(snapshotData.rows, key);
            if (avg === null) {
                return '<td style="padding: 6px 4px; text-align: center; font-size: 0.85em; font-weight: 700; ' +
                    'color: #7c3aed; background: #f5f3ff; border-top: 3px solid #7c3aed;">--</td>';
            }
            var display = metrics.formatMetricValue?.(key, avg) || String(Math.round(avg * 10) / 10);
            var centerVal = centerAvgs[key];
            var isReverse = metrics.isReverseMetric?.(key) || false;
            var beats = isReverse ? (avg <= centerVal) : (avg >= centerVal);
            var delta = isReverse ? (centerVal - avg) : (avg - centerVal);
            var unit = registry[key]?.unit || '%';
            var deltaAbs = Math.abs(delta);
            var deltaStr;
            if (unit === 'sec') { deltaStr = Math.round(deltaAbs) + 's'; }
            else if (unit === 'hrs') { deltaStr = deltaAbs.toFixed(1) + 'h'; }
            else if (unit === '#') { deltaStr = Math.round(deltaAbs).toString(); }
            else { deltaStr = deltaAbs.toFixed(1) + '%'; }

            var arrow, fontColor, bg;
            if (beats) {
                arrow = '<span style="color: #16a34a; font-weight: 800; font-size: 1.1em;">\u25B2</span>';
                fontColor = '#166534'; bg = '#dcfce7';
            } else {
                arrow = '<span style="color: #dc2626; font-weight: 800; font-size: 1.1em;">\u25BC</span>';
                fontColor = '#991b1b'; bg = '#fee2e2';
            }

            return '<td style="padding: 6px 4px; text-align: center; font-weight: 700; ' +
                'background: ' + bg + '; border-top: 3px solid #7c3aed;">' +
                '<div style="font-size: 0.85em; color: ' + fontColor + ';">' + escapeHtml(display) + '</div>' +
                '<div style="font-size: 0.75em; line-height: 1.2;">' + arrow + ' <span style="color: ' + fontColor + '; font-weight: 700;">' + deltaStr + '</span></div>' +
                '</td>';
        }).join('');

        // Center avg row (reference)
        var centerCells = visibleMetrics.map(function(key) {
            var val = centerAvgs[key];
            var display = (val !== undefined && !isNaN(val)) ? (metrics.formatMetricValue?.(key, val) || String(val)) : '--';
            return '<td style="padding: 6px 4px; text-align: center; font-size: 0.85em; font-weight: 600; ' +
                'color: #1565c0; background: #e3f2fd; border-top: 2px solid #90caf9;">' + escapeHtml(display) + '</td>';
        }).join('');

        // Count above/below for summary
        var aboveCount = 0, belowCount = 0;
        visibleMetrics.forEach(function(key) {
            var avg = computeTeamMetricValue(snapshotData.rows, key);
            if (avg === null) return;
            var centerVal = centerAvgs[key];
            var isReverse = metrics.isReverseMetric?.(key) || false;
            var beats = isReverse ? (avg <= centerVal) : (avg >= centerVal);
            if (beats) aboveCount++; else belowCount++;
        });

        var summaryText = aboveCount + ' of ' + visibleMetrics.length + ' metrics above center average';
        var summaryColor = belowCount === 0 ? '#16a34a' : belowCount <= 2 ? '#d97706' : '#dc2626';

        // Assemble
        var html = '<div id="snapshotExportArea" style="background: #ffffff; border-radius: 12px; padding: 20px; ' +
            'font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 900px; ' +
            'box-shadow: 0 2px 12px rgba(15, 23, 42, 0.08); border: 1px solid #e2e8f0;">' +
            // Title
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; ' +
            'padding-bottom: 10px; border-bottom: 3px solid #f59e0b;">' +
            '<div><div style="font-size: 1.2em; font-weight: 800; color: #1e293b;">\u26A1 Team vs Center Average</div>' +
            '<div style="font-size: 0.85em; color: #64748b; margin-top: 2px;">' + escapeHtml(periodLabel) + '</div></div>' +
            '<div style="text-align: right;"><div style="font-size: 0.75em; color: #94a3b8;">' + escapeHtml(dateStr) + '</div>' +
            '<div style="font-size: 0.82em; font-weight: 700; color: ' + summaryColor + '; margin-top: 2px;">' + summaryText + '</div></div></div>' +
            // Table
            '<div style="overflow-x: auto;">' +
            '<table style="width: 100%; border-collapse: collapse; border-spacing: 0;">' +
            '<thead><tr><th style="padding: 8px 12px; text-align: left; font-size: 0.8em; font-weight: 700; ' +
            'color: #1e293b; border-bottom: 3px solid #3b82f6; background: #f0f9ff;">Name</th>' + headerCells + '</tr></thead>' +
            '<tbody>' + dataRows +
            '<tr><td style="padding: 8px 12px; font-weight: 800; font-size: 0.9em; color: #7c3aed; ' +
            'background: #f5f3ff; border-top: 3px solid #7c3aed; white-space: nowrap;">Team Avg</td>' + teamAvgCells + '</tr>' +
            '<tr><td style="padding: 8px 12px; font-weight: 700; font-size: 0.85em; color: #1565c0; ' +
            'background: #e3f2fd; border-top: 2px solid #90caf9; white-space: nowrap;">Center Avg</td>' + centerCells + '</tr>' +
            '</tbody></table></div>' +
            // Legend
            '<div style="display: flex; gap: 16px; margin-top: 10px; padding: 8px 12px; background: #f8fafc; ' +
            'border-radius: 6px; border: 1px solid #e2e8f0; align-items: center;">' +
            '<span style="font-size: 0.75em; font-weight: 600; color: #334155;">Legend:</span>' +
            '<span style="font-size: 0.75em; color: #16a34a; font-weight: 700;">\u25B2 Above center avg</span>' +
            '<span style="font-size: 0.75em; color: #dc2626; font-weight: 700;">\u25BC Below center avg</span>' +
            '<span style="font-size: 0.75em; color: #64748b;">Delta shows distance from center average</span>' +
            '</div></div>';

        container.innerHTML = html;

        // Show the export buttons
        var exportBtns = document.getElementById('snapshotExportBtns');
        if (exportBtns) exportBtns.style.display = 'flex';
    }

    // ============================================
    // EXPORT TO IMAGE
    // ============================================

    function exportSnapshotAsImage() {
        var el = document.getElementById('snapshotExportArea');
        if (!el) return;

        if (typeof html2canvas !== 'function') {
            alert('html2canvas library not loaded.');
            return;
        }

        html2canvas(el, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false
        }).then(function(canvas) {
            var link = document.createElement('a');
            link.download = 'team-snapshot-' + new Date().toISOString().slice(0, 10) + '.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
        }).catch(function(err) {
            console.error('Snapshot export failed:', err);
            alert('Failed to export image. Check console for details.');
        });
    }

    function copySnapshotToClipboard() {
        var el = document.getElementById('snapshotExportArea');
        if (!el) return;

        if (typeof html2canvas !== 'function') {
            alert('html2canvas library not loaded.');
            return;
        }

        html2canvas(el, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false
        }).then(function(canvas) {
            canvas.toBlob(function(blob) {
                if (!blob) {
                    alert('Failed to create image blob.');
                    return;
                }
                try {
                    var item = new ClipboardItem({ 'image/png': blob });
                    navigator.clipboard.write([item]).then(function() {
                        var toast = window.DevCoachModules?.uiUtils?.showToast;
                        if (toast) {
                            toast('Snapshot copied to clipboard! Paste into Teams.');
                        } else {
                            alert('Copied to clipboard! Paste into Teams.');
                        }
                    }).catch(function(err) {
                        console.error('Clipboard write failed:', err);
                        alert('Clipboard access denied. Use the Download button instead.');
                    });
                } catch(e) {
                    console.error('ClipboardItem not supported:', e);
                    alert('Your browser does not support clipboard image copy. Use the Download button instead.');
                }
            }, 'image/png');
        });
    }

    // ============================================
    // PERIOD SELECTOR
    // ============================================

    var _allPeriods = [];

    function populatePeriodDropdown(filterType) {
        var select = document.getElementById('snapshotPeriodSelect');
        if (!select) return;

        // Cache periods on first call
        if (!filterType || _allPeriods.length === 0) {
            _allPeriods = getAvailablePeriods();
        }

        var type = filterType || 'all';
        var filtered = type === 'all' ? _allPeriods : _allPeriods.filter(function(p) {
            return p.type === type;
        });

        select.innerHTML = '<option value="">-- Select a period (' + filtered.length + ' available) --</option>';

        filtered.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.key + '|' + p.source;
            opt.textContent = p.label;
            select.appendChild(opt);
        });
    }

    function onPeriodTypeChange(e) {
        var radio = e.target;
        if (!radio || radio.type !== 'radio') return;

        var filterType = radio.value;
        populatePeriodDropdown(filterType);

        // Style the active pill
        var container = document.getElementById('snapshotPeriodTypeFilter');
        if (container) {
            var labels = container.querySelectorAll('label');
            labels.forEach(function(label) {
                var input = label.querySelector('input');
                if (input && input.checked) {
                    label.style.background = '#3b82f6';
                    label.style.color = '#fff';
                    label.style.borderColor = '#3b82f6';
                } else {
                    label.style.background = '#f1f5f9';
                    label.style.color = '#475569';
                    label.style.borderColor = '#e2e8f0';
                }
            });
        }
    }

    function onPeriodChange() {
        var select = document.getElementById('snapshotPeriodSelect');
        if (!select || !select.value) return;

        var parts = select.value.split('|');
        var periodKey = parts.slice(0, -1).join('|'); // rejoin in case key contains |
        var source = parts[parts.length - 1];

        // Pre-populate the data grid preview (rebuilds center avg inputs)
        renderDataEntryGrid(periodKey, source);

        // Load existing center averages into the input fields (must be after grid render)
        loadCenterAvgInputs(periodKey);
    }

    // ============================================
    // DATA ENTRY GRID (preview + manual override)
    // ============================================

    function renderDataEntryGrid(periodKey, source) {
        var gridContainer = document.getElementById('snapshotDataGrid');
        if (!gridContainer) return;

        var employees = getEmployeesForPeriod(periodKey, source);
        var teamFilter = getTeamFilter(periodKey);

        if (teamFilter.length > 0) {
            employees = employees.filter(function(emp) {
                return teamFilter.indexOf(emp.name) !== -1;
            });
        }

        employees.sort(function(a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        if (employees.length === 0) {
            gridContainer.innerHTML = '<p style="color: #94a3b8; text-align: center; padding: 20px;">No employees found for this period.</p>';
            return;
        }

        var registry = getRegistry();

        // Header
        var headerCells = SNAPSHOT_METRICS.map(function(key) {
            return '<th style="padding: 6px 4px; font-size: 0.75em; font-weight: 600; color: #475569; text-align: center; ' +
                'border-bottom: 2px solid #cbd5e1;">' + SHORT_LABELS[key] + '</th>';
        }).join('');

        // Employee rows (read-only preview from data)
        var rows = employees.map(function(emp, idx) {
            var bg = idx % 2 === 0 ? '#fff' : '#f8fafc';
            var firstName = emp.firstName || emp.name?.split(',')[0]?.trim() || emp.name || 'Unknown';
            var cells = SNAPSHOT_METRICS.map(function(key) {
                var val = emp[key];
                var metrics = getMetrics();
                var display = (val !== undefined && val !== null && val !== '' && !isNaN(parseFloat(val)))
                    ? (metrics.formatMetricValue?.(key, val) || String(val))
                    : '--';
                return '<td style="padding: 5px 4px; text-align: center; font-size: 0.82em; color: #334155; ' +
                    'border-bottom: 1px solid #e2e8f0;">' + escapeHtml(display) + '</td>';
            }).join('');
            return '<tr style="background: ' + bg + ';"><td style="padding: 5px 8px; font-weight: 600; font-size: 0.82em; ' +
                'color: #1e293b; border-bottom: 1px solid #e2e8f0; white-space: nowrap;">' + escapeHtml(firstName) + '</td>' + cells + '</tr>';
        }).join('');

        // Center avg input row
        var centerRow = buildCenterAvgInputRow();

        gridContainer.innerHTML = '<div style="overflow-x: auto;">' +
            '<table style="width: 100%; border-collapse: collapse;">' +
            '<thead><tr><th style="padding: 6px 8px; text-align: left; font-size: 0.75em; font-weight: 600; color: #475569; ' +
            'border-bottom: 2px solid #cbd5e1;">Name</th>' + headerCells + '</tr></thead>' +
            '<tbody>' + rows + centerRow + '</tbody></table></div>';

        // Show generate button area
        var genArea = document.getElementById('snapshotGenerateArea');
        if (genArea) genArea.style.display = 'block';
    }

    // ============================================
    // GENERATE SNAPSHOT
    // ============================================

    function generateSnapshot() {
        var select = document.getElementById('snapshotPeriodSelect');
        if (!select || !select.value) {
            alert('Please select a period first.');
            return;
        }

        var parts = select.value.split('|');
        var source = parts[parts.length - 1];
        var periodKey = parts.slice(0, -1).join('|');

        var periods = getAvailablePeriods();
        var period = periods.find(function(p) { return p.key === periodKey && p.source === source; });
        var periodLabel = period ? period.label : periodKey;

        var snapshotData = assembleSnapshotData(periodKey, source);
        saveCenterAvgsToStorage(periodKey, snapshotData.centerAvgs);
        renderSnapshotGraphic(snapshotData, periodLabel);
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    function initializeTeamSnapshot() {
        _allPeriods = []; // reset cache on re-init
        populatePeriodDropdown();

        // Bind period type radio filter
        var periodTypeFilter = document.getElementById('snapshotPeriodTypeFilter');
        if (periodTypeFilter) {
            periodTypeFilter.removeEventListener('change', onPeriodTypeChange);
            periodTypeFilter.addEventListener('change', onPeriodTypeChange);
        }

        // Bind event listeners
        var periodSelect = document.getElementById('snapshotPeriodSelect');
        if (periodSelect) {
            periodSelect.removeEventListener('change', onPeriodChange);
            periodSelect.addEventListener('change', onPeriodChange);
        }

        var generateBtn = document.getElementById('snapshotGenerateBtn');
        if (generateBtn) {
            generateBtn.removeEventListener('click', generateSnapshot);
            generateBtn.addEventListener('click', generateSnapshot);
        }

        var downloadBtn = document.getElementById('snapshotDownloadBtn');
        if (downloadBtn) {
            downloadBtn.removeEventListener('click', exportSnapshotAsImage);
            downloadBtn.addEventListener('click', exportSnapshotAsImage);
        }

        var copyBtn = document.getElementById('snapshotCopyBtn');
        if (copyBtn) {
            copyBtn.removeEventListener('click', copySnapshotToClipboard);
            copyBtn.addEventListener('click', copySnapshotToClipboard);
        }

        var scorecardBtn = document.getElementById('scorecardGenerateBtn');
        if (scorecardBtn) {
            scorecardBtn.removeEventListener('click', generateScorecard);
            scorecardBtn.addEventListener('click', generateScorecard);
        }

        var sampleBtn = document.getElementById('snapshotSampleDataBtn');
        if (sampleBtn) {
            sampleBtn.removeEventListener('click', loadSampleData);
            sampleBtn.addEventListener('click', loadSampleData);
        }

        // Hide export buttons until snapshot is generated
        var exportBtns = document.getElementById('snapshotExportBtns');
        if (exportBtns) exportBtns.style.display = 'none';

        // Clear previous graphic
        var graphicContainer = document.getElementById('snapshotGraphicContainer');
        if (graphicContainer) graphicContainer.innerHTML = '';
    }

    // ============================================
    // SAMPLE DATA (for preview/demo)
    // ============================================

    function loadSampleData() {
        var sampleEmployees = [
            { name: 'Anderson, Mike', firstName: 'Mike', scheduleAdherence: 95.2, cxRepOverall: 84.1, fcr: 76.3, overallExperience: 78.0, transfers: 4.8, aht: 410, acw: 52, overallSentiment: 91.2, positiveWord: 92.0, negativeWord: 88.5, managingEmotions: 96.1, reliability: 12.0 },
            { name: 'Baker, Sarah', firstName: 'Sarah', scheduleAdherence: 88.4, cxRepOverall: 79.5, fcr: 68.2, overallExperience: 71.0, transfers: 7.1, aht: 445, acw: 65, overallSentiment: 86.0, positiveWord: 84.2, negativeWord: 80.1, managingEmotions: 93.5, reliability: 20.5 },
            { name: 'Clark, James', firstName: 'James', scheduleAdherence: 96.1, cxRepOverall: 88.3, fcr: 81.5, overallExperience: 82.0, transfers: 3.2, aht: 388, acw: 48, overallSentiment: 93.8, positiveWord: 95.1, negativeWord: 90.2, managingEmotions: 97.8, reliability: 8.0 },
            { name: 'Davis, Emily', firstName: 'Emily', scheduleAdherence: 91.7, cxRepOverall: 82.6, fcr: 74.1, overallExperience: 76.0, transfers: 5.9, aht: 432, acw: 58, overallSentiment: 89.4, positiveWord: 88.0, negativeWord: 85.3, managingEmotions: 95.2, reliability: 15.0 },
            { name: 'Evans, Chris', firstName: 'Chris', scheduleAdherence: 93.5, cxRepOverall: 76.8, fcr: 70.5, overallExperience: 68.0, transfers: 8.3, aht: 468, acw: 72, overallSentiment: 84.1, positiveWord: 82.5, negativeWord: 78.9, managingEmotions: 91.0, reliability: 22.0 },
            { name: 'Foster, Lisa', firstName: 'Lisa', scheduleAdherence: 97.3, cxRepOverall: 90.2, fcr: 79.8, overallExperience: 80.0, transfers: 2.9, aht: 395, acw: 44, overallSentiment: 95.1, positiveWord: 96.3, negativeWord: 91.8, managingEmotions: 98.5, reliability: 6.0 },
            { name: 'Garcia, Alex', firstName: 'Alex', scheduleAdherence: 89.8, cxRepOverall: 81.0, fcr: 72.0, overallExperience: 73.0, transfers: 6.5, aht: 440, acw: 62, overallSentiment: 87.5, positiveWord: 86.1, negativeWord: 83.0, managingEmotions: 94.0, reliability: 18.0 },
            { name: 'Harris, Tom', firstName: 'Tom', scheduleAdherence: 94.6, cxRepOverall: 85.7, fcr: 75.9, overallExperience: 77.0, transfers: 5.1, aht: 415, acw: 55, overallSentiment: 90.8, positiveWord: 90.0, negativeWord: 86.7, managingEmotions: 96.0, reliability: 10.0 }
        ];

        var sampleCenterAvgs = {
            scheduleAdherence: 93.0,
            cxRepOverall: 83.5,
            fcr: 74.0,
            overallExperience: 75.5,
            transfers: 5.5,
            aht: 420,
            acw: 57,
            overallSentiment: 89.5,
            positiveWord: 88.0,
            negativeWord: 85.0,
            managingEmotions: 95.5,
            reliability: 14.0
        };

        // Build snapshot data directly (bypass period selection)
        var rows = sampleEmployees.map(function(emp) {
            var cells = SNAPSHOT_METRICS.map(function(metricKey) {
                var value = emp[metricKey];
                var numValue = parseFloat(value);
                var hasValue = value !== undefined && value !== null && !isNaN(numValue);
                var registry = getRegistry();
                var metrics = getMetrics();
                var target = registry[metricKey]?.target;
                var meetsTarget = false;
                var centerAvg = sampleCenterAvgs[metricKey];
                var aboveAvg = null;

                if (hasValue && target) {
                    meetsTarget = metrics.isMetricMeetingTarget?.(metricKey, numValue, target.value) || false;
                }
                var avgDelta = null;
                if (hasValue && centerAvg !== undefined) {
                    var isReverse = metrics.isReverseMetric?.(metricKey) || false;
                    aboveAvg = isReverse ? (numValue <= centerAvg) : (numValue >= centerAvg);
                    avgDelta = isReverse ? (centerAvg - numValue) : (numValue - centerAvg);
                }
                var displayValue = hasValue ? (metrics.formatMetricValue?.(metricKey, numValue) || String(numValue)) : 'N/A';

                return { metricKey: metricKey, value: numValue, displayValue: displayValue, hasValue: hasValue, meetsTarget: meetsTarget, aboveAvg: aboveAvg, avgDelta: avgDelta };
            });
            return { name: emp.firstName, fullName: emp.name, cells: cells };
        });

        var snapshotData = { rows: rows, centerAvgs: sampleCenterAvgs, periodKey: 'sample', source: 'sample' };
        renderSnapshotGraphic(snapshotData, 'Daily: Mon, Mar 17, 2026 (Sample Data)');

        var toast = window.DevCoachModules?.uiUtils?.showToast;
        if (toast) toast('Sample data loaded! Preview generated below.');
    }

    // ============================================
    // EXPORTS
    // ============================================

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.teamSnapshot = {
        initializeTeamSnapshot: initializeTeamSnapshot,
        generateSnapshot: generateSnapshot,
        generateScorecard: generateScorecard,
        exportSnapshotAsImage: exportSnapshotAsImage,
        copySnapshotToClipboard: copySnapshotToClipboard,
        populatePeriodDropdown: populatePeriodDropdown,
        loadSampleData: loadSampleData
    };

    // Convenience globals
    window.initializeTeamSnapshot = initializeTeamSnapshot;
    window.loadSnapshotSampleData = loadSampleData;
})();
