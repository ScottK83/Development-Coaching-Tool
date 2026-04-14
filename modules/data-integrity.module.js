(function () {
    'use strict';

    // ============================================
    // DATA INTEGRITY SCAN
    // Anomaly detection across weekly uploads
    // ============================================

    const TRACKED_METRICS = ['scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience', 'transfers', 'aht', 'acw', 'holdTime', 'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions', 'reliability'];
    const JUMP_THRESHOLDS = {
        scheduleAdherence: 10,
        cxRepOverall: 25,
        fcr: 25,
        overallExperience: 25,
        transfers: 5,
        aht: 120,
        acw: 30,
        holdTime: 30,
        overallSentiment: 15,
        positiveWord: 15,
        negativeWord: 15,
        managingEmotions: 15,
        reliability: 10
    };
    const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

    function getMetricLabel(key) {
        const registry = window.METRICS_REGISTRY || {};
        return registry[key]?.label || key;
    }

    function toFiniteNumber(value) {
        if (value === '' || value === null || value === undefined) return null;
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : null;
    }

    function getSortedWeeklyKeys(weeklyData) {
        if (!weeklyData) return [];
        return Object.keys(weeklyData)
            .filter(k => {
                const pt = weeklyData[k]?.metadata?.periodType;
                return !pt || pt === 'week' || pt === 'week-in-progress' || pt === 'custom';
            })
            .sort();
    }

    function parseKeyEndDate(weekKey) {
        const parts = weekKey.split('|');
        const raw = parts[1] || parts[0];
        return new Date(raw + 'T00:00:00');
    }

    // --- Individual check functions ---

    function checkSurveyTotalExceedsCalls(weeklyData) {
        const issues = [];
        Object.keys(weeklyData || {}).forEach(weekKey => {
            const period = weeklyData[weekKey];
            const emps = period?.employees || [];
            emps.forEach(emp => {
                const surveys = parseInt(emp?.surveyTotal, 10);
                const calls = parseInt(emp?.totalCalls, 10);
                if (Number.isFinite(surveys) && Number.isFinite(calls) && calls > 0 && surveys > calls) {
                    issues.push({
                        severity: 'high',
                        category: 'Impossible data',
                        message: `${emp.name}: ${surveys} surveys recorded against only ${calls} calls`,
                        weekKey
                    });
                }
            });
        });
        return issues;
    }

    function checkImpossibleMetricValues(weeklyData) {
        const issues = [];
        Object.keys(weeklyData || {}).forEach(weekKey => {
            const period = weeklyData[weekKey];
            const emps = period?.employees || [];
            emps.forEach(emp => {
                TRACKED_METRICS.forEach(metricKey => {
                    const val = toFiniteNumber(emp?.[metricKey]);
                    if (val === null) return;
                    const unit = window.METRICS_REGISTRY?.[metricKey]?.unit || '';
                    if (unit === '%' && val > 100) {
                        issues.push({
                            severity: 'high',
                            category: 'Impossible data',
                            message: `${emp.name}: ${getMetricLabel(metricKey)} = ${val.toFixed(1)}% (above 100%)`,
                            weekKey
                        });
                    }
                    if (val < 0) {
                        issues.push({
                            severity: 'high',
                            category: 'Impossible data',
                            message: `${emp.name}: ${getMetricLabel(metricKey)} is negative (${val})`,
                            weekKey
                        });
                    }
                });
            });
        });
        return issues;
    }

    function checkDuplicateEmployees(weeklyData) {
        const issues = [];
        Object.keys(weeklyData || {}).forEach(weekKey => {
            const emps = weeklyData[weekKey]?.employees || [];
            const seen = new Map();
            emps.forEach(emp => {
                const name = (emp?.name || '').trim();
                if (!name) return;
                seen.set(name, (seen.get(name) || 0) + 1);
            });
            seen.forEach((count, name) => {
                if (count > 1) {
                    issues.push({
                        severity: 'high',
                        category: 'Duplicate rows',
                        message: `${name} appears ${count} times in the same upload`,
                        weekKey
                    });
                }
            });
        });
        return issues;
    }

    function checkMetricJumps(weeklyData) {
        const issues = [];
        const keys = getSortedWeeklyKeys(weeklyData);
        for (let i = 1; i < keys.length; i++) {
            const prev = weeklyData[keys[i - 1]]?.employees || [];
            const curr = weeklyData[keys[i]]?.employees || [];
            const prevByName = new Map(prev.map(e => [e.name, e]));
            curr.forEach(emp => {
                const prevEmp = prevByName.get(emp.name);
                if (!prevEmp) return;
                const prevCalls = parseInt(prevEmp.totalCalls, 10);
                const currCalls = parseInt(emp.totalCalls, 10);
                if (!Number.isFinite(prevCalls) || !Number.isFinite(currCalls) || prevCalls < 20 || currCalls < 20) return;
                TRACKED_METRICS.forEach(metricKey => {
                    const pv = toFiniteNumber(prevEmp[metricKey]);
                    const cv = toFiniteNumber(emp[metricKey]);
                    if (pv === null || cv === null) return;
                    const threshold = JUMP_THRESHOLDS[metricKey];
                    if (!threshold) return;
                    const delta = Math.abs(cv - pv);
                    if (delta >= threshold) {
                        issues.push({
                            severity: delta >= threshold * 1.5 ? 'high' : 'medium',
                            category: 'Big metric swing',
                            message: `${emp.name}: ${getMetricLabel(metricKey)} moved ${pv.toFixed(1)} → ${cv.toFixed(1)} (Δ ${delta.toFixed(1)})`,
                            weekKey: keys[i]
                        });
                    }
                });
            });
        }
        return issues;
    }

    function checkMissingWeeks(weeklyData) {
        const issues = [];
        const keys = getSortedWeeklyKeys(weeklyData).filter(k => {
            const pt = weeklyData[k]?.metadata?.periodType;
            return !pt || pt === 'week';
        });
        for (let i = 1; i < keys.length; i++) {
            const prevEnd = parseKeyEndDate(keys[i - 1]);
            const currEnd = parseKeyEndDate(keys[i]);
            const diffDays = Math.round((currEnd - prevEnd) / (1000 * 60 * 60 * 24));
            if (diffDays > 10 && diffDays <= 60) {
                const gaps = Math.floor(diffDays / 7) - 1;
                if (gaps >= 1) {
                    issues.push({
                        severity: 'medium',
                        category: 'Missing uploads',
                        message: `Gap of ${diffDays} days between uploads (${gaps} week${gaps === 1 ? '' : 's'} likely missing)`,
                        weekKey: keys[i]
                    });
                }
            }
        }
        return issues;
    }

    function checkRosterDropouts(weeklyData) {
        const issues = [];
        const keys = getSortedWeeklyKeys(weeklyData);
        if (keys.length < 2) return issues;
        for (let i = 1; i < keys.length; i++) {
            const prevEmps = weeklyData[keys[i - 1]]?.employees || [];
            const currEmps = weeklyData[keys[i]]?.employees || [];
            const currNames = new Set(currEmps.map(e => e.name));
            const droppedNames = prevEmps
                .filter(e => parseInt(e.totalCalls, 10) >= 20)
                .map(e => e.name)
                .filter(name => !currNames.has(name));
            if (droppedNames.length >= 3) {
                issues.push({
                    severity: 'medium',
                    category: 'Roster changes',
                    message: `${droppedNames.length} reps in the prior upload are missing this week: ${droppedNames.slice(0, 5).join(', ')}${droppedNames.length > 5 ? '…' : ''}`,
                    weekKey: keys[i]
                });
            }
        }
        return issues;
    }

    function checkEmptyMetricColumns(weeklyData) {
        const issues = [];
        const keys = getSortedWeeklyKeys(weeklyData);
        keys.forEach(weekKey => {
            const emps = weeklyData[weekKey]?.employees || [];
            if (!emps.length) return;
            const emptyMetrics = TRACKED_METRICS.filter(metricKey => {
                const populated = emps.filter(e => toFiniteNumber(e?.[metricKey]) !== null).length;
                return populated === 0;
            });
            if (emptyMetrics.length >= 4) {
                issues.push({
                    severity: 'medium',
                    category: 'Missing metric columns',
                    message: `${emptyMetrics.length} metrics empty for the whole week: ${emptyMetrics.map(getMetricLabel).join(', ')}`,
                    weekKey
                });
            }
        });
        return issues;
    }

    // --- Scan runner ---

    function runDataIntegrityScan(weeklyData, ytdData) {
        const checks = [
            checkSurveyTotalExceedsCalls,
            checkImpossibleMetricValues,
            checkDuplicateEmployees,
            checkMetricJumps,
            checkMissingWeeks,
            checkRosterDropouts,
            checkEmptyMetricColumns
        ];
        const issues = [];
        checks.forEach(fn => {
            try {
                const results = fn(weeklyData, ytdData);
                if (Array.isArray(results)) issues.push(...results);
            } catch (e) {
                console.warn('[data-integrity] check failed:', fn.name, e);
            }
        });
        issues.sort((a, b) => {
            const rankDelta = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
            if (rankDelta !== 0) return rankDelta;
            return (b.weekKey || '').localeCompare(a.weekKey || '');
        });
        const summary = {
            total: issues.length,
            high: issues.filter(i => i.severity === 'high').length,
            medium: issues.filter(i => i.severity === 'medium').length,
            low: issues.filter(i => i.severity === 'low').length,
            byCategory: issues.reduce((acc, i) => {
                acc[i.category] = (acc[i.category] || 0) + 1;
                return acc;
            }, {})
        };
        return { issues, summary };
    }

    // --- Modal UI ---

    function formatWeekLabel(weekKey, weeklyData) {
        const period = weeklyData?.[weekKey];
        const end = period?.metadata?.endDate || (weekKey.includes('|') ? weekKey.split('|')[1] : weekKey);
        if (typeof window.formatDateMMDDYYYY === 'function') return window.formatDateMMDDYYYY(end);
        return end;
    }

    function severityBadge(severity) {
        if (severity === 'high') return '<span style="display:inline-block; padding:2px 8px; border-radius:10px; background:#ffebee; color:#c62828; font-size:0.75em; font-weight:700;">HIGH</span>';
        if (severity === 'medium') return '<span style="display:inline-block; padding:2px 8px; border-radius:10px; background:#fff3e0; color:#ef6c00; font-size:0.75em; font-weight:700;">MED</span>';
        return '<span style="display:inline-block; padding:2px 8px; border-radius:10px; background:#e3f2fd; color:#1565c0; font-size:0.75em; font-weight:700;">LOW</span>';
    }

    function showDataIntegrityModal() {
        const existing = document.getElementById('dataIntegrityModal');
        if (existing) existing.remove();

        const weeklyData = typeof window.weeklyData !== 'undefined' ? window.weeklyData : {};
        const ytdData = typeof window.ytdData !== 'undefined' ? window.ytdData : {};
        const { issues, summary } = runDataIntegrityScan(weeklyData, ytdData);

        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

        const groupedByWeek = new Map();
        issues.forEach(issue => {
            const key = issue.weekKey || '—';
            if (!groupedByWeek.has(key)) groupedByWeek.set(key, []);
            groupedByWeek.get(key).push(issue);
        });
        const sortedWeekKeys = Array.from(groupedByWeek.keys()).sort((a, b) => b.localeCompare(a));

        let bodyHtml;
        if (issues.length === 0) {
            bodyHtml = `<div style="padding:40px; text-align:center; color:#2e7d32;">` +
                `<div style="font-size:3em; margin-bottom:12px;">\u2705</div>` +
                `<div style="font-size:1.15em; font-weight:600;">No anomalies found.</div>` +
                `<div style="color:#666; font-size:0.9em; margin-top:8px;">Your upload history looks clean.</div>` +
            `</div>`;
        } else {
            bodyHtml = sortedWeekKeys.map(weekKey => {
                const list = groupedByWeek.get(weekKey);
                const label = weekKey === '—' ? 'No period' : formatWeekLabel(weekKey, weeklyData);
                return `<div style="margin-bottom:18px;">` +
                    `<div style="font-weight:700; color:#1a237e; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid #e0e0e0;">${escapeHtml(label)} <span style="color:#999; font-weight:400; font-size:0.85em;">(${list.length} issue${list.length === 1 ? '' : 's'})</span></div>` +
                    list.map(issue => `<div style="display:flex; align-items:flex-start; gap:10px; padding:8px 0; font-size:0.9em;">` +
                        `<div style="flex-shrink:0; width:52px;">${severityBadge(issue.severity)}</div>` +
                        `<div style="flex:1;">` +
                            `<div style="color:#424242;">${escapeHtml(issue.message)}</div>` +
                            `<div style="color:#9e9e9e; font-size:0.82em; margin-top:2px;">${escapeHtml(issue.category)}</div>` +
                        `</div>` +
                    `</div>`).join('') +
                `</div>`;
            }).join('');
        }

        const overlay = document.createElement('div');
        overlay.id = 'dataIntegrityModal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';

        overlay.innerHTML = `<div style="background:#fff; border-radius:14px; max-width:760px; width:100%; max-height:90vh; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(0,0,0,0.35);">` +
            `<div style="padding:20px 24px; border-bottom:1px solid #eceff1; display:flex; justify-content:space-between; align-items:center;">` +
                `<div>` +
                    `<h2 style="margin:0; color:#1a237e; font-size:1.25em;">\uD83D\uDD0D Data Health Check</h2>` +
                    `<div style="margin-top:6px; font-size:0.88em; color:#546e7a;">` +
                        `${summary.total} issue${summary.total === 1 ? '' : 's'} found \u2022 ` +
                        `<span style="color:#c62828; font-weight:600;">${summary.high} high</span> \u2022 ` +
                        `<span style="color:#ef6c00; font-weight:600;">${summary.medium} medium</span> \u2022 ` +
                        `<span style="color:#1565c0; font-weight:600;">${summary.low} low</span>` +
                    `</div>` +
                `</div>` +
                `<button id="dataIntegrityClose" style="background:none; border:none; font-size:1.6em; cursor:pointer; color:#999;">\u2715</button>` +
            `</div>` +
            `<div style="padding:16px 24px; overflow-y:auto; flex:1;">${bodyHtml}</div>` +
            `<div style="padding:14px 24px; border-top:1px solid #eceff1; text-align:right;">` +
                `<button id="dataIntegrityCloseBtn" style="background:#1a237e; color:#fff; border:none; border-radius:6px; padding:10px 20px; cursor:pointer; font-weight:bold;">Close</button>` +
            `</div>` +
        `</div>`;

        document.body.appendChild(overlay);
        document.getElementById('dataIntegrityClose').addEventListener('click', () => overlay.remove());
        document.getElementById('dataIntegrityCloseBtn').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.dataIntegrity = {
        runDataIntegrityScan,
        showDataIntegrityModal
    };
    window.showDataIntegrityModal = showDataIntegrityModal;
})();
