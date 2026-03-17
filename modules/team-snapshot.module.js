/**
 * Team Snapshot Module
 * Generates shareable team performance graphics for Teams chat.
 * Shows each associate's metrics with green/yellow/red target indicators
 * and above/below center average markers.
 */
(function() {
    'use strict';

    var STORAGE_PREFIX = 'devCoachingTool_';

    // Key metrics to show in snapshot (compact set for readability)
    var SNAPSHOT_METRICS = [
        'scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience',
        'transfers', 'aht', 'acw', 'overallSentiment', 'reliability'
    ];

    // Short labels for the graphic header
    var SHORT_LABELS = {
        scheduleAdherence: 'Adh',
        cxRepOverall: 'CX Rep',
        fcr: 'FCR',
        overallExperience: 'Exp',
        transfers: 'Xfer',
        aht: 'AHT',
        acw: 'ACW',
        overallSentiment: 'Sent',
        reliability: 'Rel'
    };

    function getMetrics() {
        return window.DevCoachModules?.metrics || {};
    }

    function getRegistry() {
        return window.METRICS_REGISTRY || {};
    }

    function escapeHtml(text) {
        return window.DevCoachModules?.sharedUtils?.escapeHtml?.(text) || String(text || '');
    }

    // ============================================
    // DATA RETRIEVAL
    // ============================================

    /**
     * Get all available period keys from weeklyData and ytdData
     */
    function getAvailablePeriods() {
        var periods = [];
        var weeklyData = window.weeklyData || {};
        var ytdData = window.ytdData || {};

        Object.keys(weeklyData).forEach(function(key) {
            var data = weeklyData[key];
            var meta = data?.metadata || {};
            var label = meta.label || formatPeriodLabel(key, 'week');
            periods.push({ key: key, label: label, type: 'week', source: 'weekly' });
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
        var dataSource = source === 'ytd' ? (window.ytdData || {}) : (window.weeklyData || {});
        var periodData = dataSource[periodKey];
        if (!periodData) return [];
        return periodData.employees || [];
    }

    /**
     * Get team members filter for a period
     */
    function getTeamFilter(periodKey) {
        var myTeamMembers = window.myTeamMembers || {};
        return myTeamMembers[periodKey] || [];
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
            '<td style="padding: 6px 8px; font-weight: 600; color: #1565c0; white-space: nowrap;">Center Avg</td>' +
            cells + '</tr>';
    }

    function loadCenterAvgInputs(periodKey) {
        var avg = getCenterAverages(periodKey);
        if (!avg) return;

        // Map center avg keys to our metric keys
        var keyMap = {
            scheduleAdherence: avg.adherence ?? avg.scheduleAdherence,
            cxRepOverall: avg.repSatisfaction ?? avg.cxRepOverall,
            fcr: avg.fcr,
            overallExperience: avg.overallExperience,
            transfers: avg.transfers,
            aht: avg.aht,
            acw: avg.acw,
            overallSentiment: avg.sentiment ?? avg.overallSentiment,
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
                avgs[key] = parseFloat(input.value.trim());
            }
        });
        return avgs;
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

                if (hasValue && centerAvg !== undefined && !isNaN(centerAvg)) {
                    var isReverse = metrics.isReverseMetric?.(metricKey) || false;
                    aboveAvg = isReverse ? (numValue <= centerAvg) : (numValue >= centerAvg);
                }

                var displayValue = hasValue ? metrics.formatMetricValue?.(metricKey, numValue) || String(numValue) : 'N/A';

                return {
                    metricKey: metricKey,
                    value: numValue,
                    displayValue: displayValue,
                    hasValue: hasValue,
                    meetsTarget: meetsTarget,
                    aboveAvg: aboveAvg
                };
            });

            return {
                name: emp.firstName || emp.name?.split(',')[0]?.trim() || emp.name || 'Unknown',
                fullName: emp.name || 'Unknown',
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

        SNAPSHOT_METRICS.forEach(function(key) {
            metricMissCount[key] = { total: 0, missing: 0 };
        });

        snapshotData.rows.forEach(function(row) {
            row.cells.forEach(function(cell) {
                if (!cell.hasValue) return;
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

        // Build header row
        var headerCells = SNAPSHOT_METRICS.map(function(key) {
            var def = registry[key];
            return '<th style="padding: 6px 4px; font-size: 0.7em; font-weight: 700; color: #475569; text-align: center; ' +
                'border-bottom: 2px solid #cbd5e1; white-space: nowrap;">' +
                (def?.icon || '') + '<br>' + SHORT_LABELS[key] + '</th>';
        }).join('');

        // Build data rows
        var dataRows = snapshotData.rows.map(function(row, idx) {
            var bgColor = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
            var cells = row.cells.map(function(cell) {
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

                    if (cell.aboveAvg === true) {
                        indicator = ' <span style="color: #16a34a; font-size: 0.75em; font-weight: 700;">&#9650;</span>';
                    } else if (cell.aboveAvg === false) {
                        indicator = ' <span style="color: #dc2626; font-size: 0.75em; font-weight: 700;">&#9660;</span>';
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

        // Build center avg row
        var centerAvgs = snapshotData.centerAvgs;
        var hasCenterAvgs = Object.keys(centerAvgs).length > 0;
        var centerRow = '';
        if (hasCenterAvgs) {
            var centerCells = SNAPSHOT_METRICS.map(function(key) {
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
        var targetCells = SNAPSHOT_METRICS.map(function(key) {
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
        var legendHtml = '<div style="display: flex; gap: 16px; margin-top: 8px; flex-wrap: wrap; align-items: center;">' +
            '<span style="font-size: 0.72em; color: #475569;">' +
            '<span style="display: inline-block; width: 12px; height: 12px; background: #dcfce7; border: 1px solid #86efac; ' +
            'border-radius: 2px; vertical-align: middle; margin-right: 3px;"></span> Meeting Target</span>' +
            '<span style="font-size: 0.72em; color: #475569;">' +
            '<span style="display: inline-block; width: 12px; height: 12px; background: #fee2e2; border: 1px solid #fca5a5; ' +
            'border-radius: 2px; vertical-align: middle; margin-right: 3px;"></span> Below Target</span>' +
            '<span style="font-size: 0.72em; color: #475569;">' +
            '<span style="color: #16a34a; font-weight: 700;">&#9650;</span> Above Center Avg</span>' +
            '<span style="font-size: 0.72em; color: #475569;">' +
            '<span style="color: #dc2626; font-weight: 700;">&#9660;</span> Below Center Avg</span>' +
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
            '<tbody>' + targetRow + dataRows + centerRow + '</tbody>' +
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

    function populatePeriodDropdown() {
        var select = document.getElementById('snapshotPeriodSelect');
        if (!select) return;

        var periods = getAvailablePeriods();
        select.innerHTML = '<option value="">-- Select a period --</option>';

        periods.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.key + '|' + p.source;
            opt.textContent = p.label;
            select.appendChild(opt);
        });
    }

    function onPeriodChange() {
        var select = document.getElementById('snapshotPeriodSelect');
        if (!select || !select.value) return;

        var parts = select.value.split('|');
        var periodKey = parts.slice(0, -1).join('|'); // rejoin in case key contains |
        var source = parts[parts.length - 1];

        // Load existing center averages into the input fields
        loadCenterAvgInputs(periodKey);

        // Pre-populate the data grid preview
        renderDataEntryGrid(periodKey, source);
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
        renderSnapshotGraphic(snapshotData, periodLabel);
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    function initializeTeamSnapshot() {
        populatePeriodDropdown();

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

        // Hide export buttons until snapshot is generated
        var exportBtns = document.getElementById('snapshotExportBtns');
        if (exportBtns) exportBtns.style.display = 'none';

        // Clear previous graphic
        var graphicContainer = document.getElementById('snapshotGraphicContainer');
        if (graphicContainer) graphicContainer.innerHTML = '';
    }

    // ============================================
    // EXPORTS
    // ============================================

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.teamSnapshot = {
        initializeTeamSnapshot: initializeTeamSnapshot,
        generateSnapshot: generateSnapshot,
        exportSnapshotAsImage: exportSnapshotAsImage,
        copySnapshotToClipboard: copySnapshotToClipboard,
        populatePeriodDropdown: populatePeriodDropdown
    };

    // Convenience global
    window.initializeTeamSnapshot = initializeTeamSnapshot;
})();
