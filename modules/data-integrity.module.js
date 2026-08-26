(function () {
    'use strict';

    // ============================================
    // DATA INTEGRITY SCAN
    // Anomaly detection across weekly uploads
    // ============================================

    // Per-module scope filter: metrics whose data-quality we scan. Broader
    // than pattern-memory's list because "impossible values" and "big swings"
    // checks are useful for ACW/hold-time too.
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

    // Scanning is deterministic, so the same anomalies resurface every time you
    // open the modal. Once you've looked at a batch and decided it's fine, it
    // should stop shouting — but the underlying uploads are untouched, so this
    // is a "seen it" list, not a delete.
    const REVIEWED_KEY = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX || 'devCoachingTool_') + 'dataHealthReviewed';

    function issueFingerprint(issue) {
        return `${issue.weekKey || ''}|${issue.category || ''}|${issue.message || ''}`;
    }

    function loadReviewed() {
        try {
            const raw = localStorage.getItem(REVIEWED_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return new Set(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
            return new Set();
        }
    }

    function saveReviewed(set) {
        try {
            localStorage.setItem(REVIEWED_KEY, JSON.stringify(Array.from(set)));
        } catch (e) { /* storage blocked — the scan still runs */ }
    }

    // Only keeps fingerprints that a current scan can still produce, so the
    // list doesn't accumulate entries for uploads that were long since deleted.
    function markReviewed(issues) {
        saveReviewed(new Set((issues || []).map(issueFingerprint)));
    }

    function clearReviewed() {
        try {
            localStorage.removeItem(REVIEWED_KEY);
        } catch (e) { /* nothing to do */ }
    }

    function getMetricLabel(key) {
        const registry = window.METRICS_REGISTRY || {};
        return registry[key]?.label || key;
    }

    function toFiniteNumber(value) {
        if (value === '' || value === null || value === undefined) return null;
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : null;
    }

    // Week-shaped, including partials. The stricter "did this week finish"
    // question lives in checkMissingWeeks and is a different one — they used to
    // be two spellings sitting in this file disagreeing with each other.
    function getSortedWeeklyKeys(weeklyData) {
        if (!weeklyData) return [];
        const index = window.DevCoachModules?.periodIndex;
        if (!index) return [];
        return index.weekLikeKeys(index.buildIndex({ weeklyData: weeklyData }));
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
        // Only finished weeks can leave a gap — a partial week is not a
        // missing one.
        const index = window.DevCoachModules?.periodIndex;
        const keys = index ? index.completeWeekKeys(index.buildIndex({ weeklyData: weeklyData })) : [];
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
        if (severity === 'high') return '<span style="display:inline-block; padding:2px 8px; border-radius:10px; background:var(--red-soft); color:var(--red-text); font-size:0.75em; font-weight:700;">HIGH</span>';
        if (severity === 'medium') return '<span style="display:inline-block; padding:2px 8px; border-radius:10px; background:#fff3e0; color:#ef6c00; font-size:0.75em; font-weight:700;">MED</span>';
        return '<span style="display:inline-block; padding:2px 8px; border-radius:10px; background:#e3f2fd; color:#1565c0; font-size:0.75em; font-weight:700;">LOW</span>';
    }

    function showDataIntegrityModal() {
        const existing = document.getElementById('dataIntegrityModal');
        if (existing) existing.remove();

        // script.js declares these with `let`, so they never land on `window`.
        // Fall back to the storage module, same as team-snapshot/dashboard.
        const weeklyData = (typeof window.weeklyData === 'object' && window.weeklyData)
            ? window.weeklyData
            : (window.DevCoachModules?.storage?.loadWeeklyData?.() || {});
        const ytdData = (typeof window.ytdData === 'object' && window.ytdData)
            ? window.ytdData
            : (window.DevCoachModules?.storage?.loadYtdData?.() || {});
        const { issues } = runDataIntegrityScan(weeklyData, ytdData);

        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

        const overlay = document.createElement('div');
        overlay.id = 'dataIntegrityModal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';

        // View state only. It never changes what was scanned, just whether
        // findings you already signed off on are on screen.
        let showAll = false;

        function issueListHtml(list) {
            const groupedByWeek = new Map();
            list.forEach(issue => {
                const key = issue.weekKey || 'no-period';
                if (!groupedByWeek.has(key)) groupedByWeek.set(key, []);
                groupedByWeek.get(key).push(issue);
            });
            const sortedWeekKeys = Array.from(groupedByWeek.keys()).sort((a, b) => b.localeCompare(a));

            return sortedWeekKeys.map(weekKey => {
                const group = groupedByWeek.get(weekKey);
                const label = weekKey === 'no-period' ? 'No period' : formatWeekLabel(weekKey, weeklyData);
                return `<div style="margin-bottom:18px;">` +
                    `<div style="font-weight:700; color:#1a237e; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid var(--border);">${escapeHtml(label)} <span style="color:var(--text-tertiary); font-weight:400; font-size:0.85em;">(${group.length} issue${group.length === 1 ? '' : 's'})</span></div>` +
                    group.map(issue => `<div style="display:flex; align-items:flex-start; gap:10px; padding:8px 0; font-size:0.9em;">` +
                        `<div style="flex-shrink:0; width:52px;">${severityBadge(issue.severity)}</div>` +
                        `<div style="flex:1;">` +
                            `<div style="color:#424242;">${escapeHtml(issue.message)}</div>` +
                            `<div style="color:var(--text-tertiary); font-size:0.82em; margin-top:2px;">${escapeHtml(issue.category)}</div>` +
                        `</div>` +
                    `</div>`).join('') +
                `</div>`;
            }).join('');
        }

        function emptyStateHtml(reviewedCount) {
            const note = reviewedCount
                ? `${reviewedCount} finding${reviewedCount === 1 ? '' : 's'} you already cleared ${reviewedCount === 1 ? 'is' : 'are'} hidden.`
                : 'Your upload history looks clean.';
            return `<div style="padding:40px; text-align:center; color:var(--green-text);">` +
                `<div style="font-size:3em; margin-bottom:12px;">✅</div>` +
                `<div style="font-size:1.15em; font-weight:600;">Nothing new to look at.</div>` +
                `<div style="color:var(--text-secondary); font-size:0.9em; margin-top:8px;">${escapeHtml(note)}</div>` +
            `</div>`;
        }

        function paint() {
            const reviewed = loadReviewed();
            const unreviewed = issues.filter(issue => !reviewed.has(issueFingerprint(issue)));
            const hiddenCount = issues.length - unreviewed.length;
            const visible = showAll ? issues : unreviewed;

            const counts = {
                high: visible.filter(i => i.severity === 'high').length,
                medium: visible.filter(i => i.severity === 'medium').length,
                low: visible.filter(i => i.severity === 'low').length
            };

            const bodyHtml = visible.length ? issueListHtml(visible) : emptyStateHtml(hiddenCount);

            const hiddenNote = hiddenCount && !showAll
                ? ` • <span style="color:var(--text-tertiary);">${hiddenCount} cleared and hidden</span>`
                : '';

            overlay.innerHTML = `<div style="background:var(--bg-surface); border-radius:14px; max-width:760px; width:100%; max-height:90vh; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(0,0,0,0.35);">` +
                `<div style="padding:20px 24px; border-bottom:1px solid #eceff1; display:flex; justify-content:space-between; align-items:center;">` +
                    `<div>` +
                        `<h2 style="margin:0; color:#1a237e; font-size:1.25em;">🔍 Data Health Check</h2>` +
                        `<div style="margin-top:6px; font-size:0.88em; color:#546e7a;">` +
                            `${visible.length} issue${visible.length === 1 ? '' : 's'} shown • ` +
                            `<span style="color:var(--red-text); font-weight:600;">${counts.high} high</span> • ` +
                            `<span style="color:#ef6c00; font-weight:600;">${counts.medium} medium</span> • ` +
                            `<span style="color:#1565c0; font-weight:600;">${counts.low} low</span>` +
                            hiddenNote +
                        `</div>` +
                    `</div>` +
                    `<button id="dataIntegrityClose" style="background:none; border:none; font-size:1.6em; cursor:pointer; color:var(--text-tertiary);">✕</button>` +
                `</div>` +
                `<div style="padding:16px 24px; overflow-y:auto; flex:1;">${bodyHtml}</div>` +
                `<div style="padding:14px 24px; border-top:1px solid #eceff1; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">` +
                    `<div style="display:flex; gap:8px; flex-wrap:wrap;">` +
                        (issues.length
                            ? `<button id="dataIntegrityWipe" style="background:#7b1fa2; color:#fff; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">🧹 Clear these. Seen them</button>`
                            : '') +
                        (hiddenCount
                            ? `<button id="dataIntegrityToggle" style="background:var(--bg-surface-raised); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; padding:10px 16px; cursor:pointer;">${showAll ? 'Hide cleared' : `Show cleared (${hiddenCount})`}</button>`
                            : '') +
                        (hiddenCount
                            ? `<button id="dataIntegrityRestore" style="background:none; color:var(--text-secondary); border:1px solid var(--border); border-radius:6px; padding:10px 16px; cursor:pointer;">Bring them all back</button>`
                            : '') +
                    `</div>` +
                    `<button id="dataIntegrityCloseBtn" style="background:#1a237e; color:#fff; border:none; border-radius:6px; padding:10px 20px; cursor:pointer; font-weight:bold;">Close</button>` +
                `</div>` +
            `</div>`;

            overlay.querySelector('#dataIntegrityClose').addEventListener('click', () => overlay.remove());
            overlay.querySelector('#dataIntegrityCloseBtn').addEventListener('click', () => overlay.remove());

            const wipeBtn = overlay.querySelector('#dataIntegrityWipe');
            if (wipeBtn) {
                wipeBtn.addEventListener('click', () => {
                    // Marks every finding this scan produced, so the list comes
                    // back empty until something genuinely new turns up. The
                    // uploads themselves are untouched.
                    markReviewed(issues);
                    showAll = false;
                    paint();
                });
            }

            const toggleBtn = overlay.querySelector('#dataIntegrityToggle');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => {
                    showAll = !showAll;
                    paint();
                });
            }

            const restoreBtn = overlay.querySelector('#dataIntegrityRestore');
            if (restoreBtn) {
                restoreBtn.addEventListener('click', () => {
                    clearReviewed();
                    showAll = false;
                    paint();
                });
            }
        }

        document.body.appendChild(overlay);
        paint();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.dataIntegrity = {
        runDataIntegrityScan,
        showDataIntegrityModal,
        issueFingerprint,
        loadReviewed,
        markReviewed,
        clearReviewed
    };
})();
