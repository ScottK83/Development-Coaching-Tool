(function () {
    'use strict';

    // ============================================
    // PATTERN MEMORY
    // Cross-week behavioral pattern detection per rep
    // ============================================

    // Per-module scope filter: metrics we surface cross-week patterns for.
    // Excludes ACW and hold time because their week-to-week variance
    // rarely signals coachable change — they're support metrics.
    const TRACKED_METRICS = ['scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience', 'transfers', 'aht', 'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions', 'reliability'];
    const LOOKBACK_WEEKS = 12;
    const MIN_WEEKS_FOR_PATTERN = 4;
    const MIN_CALLS_FOR_DATAPOINT = 20;

    function toFinite(v) {
        if (v === '' || v === null || v === undefined) return null;
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    }

    function isReverseKey(metricKey) {
        return window.METRICS_REGISTRY?.[metricKey]?.isReverse === true;
    }

    function metricLabel(metricKey) {
        return window.METRICS_REGISTRY?.[metricKey]?.label || metricKey;
    }

    function mean(arr) {
        if (!arr.length) return 0;
        return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

    function stddev(arr) {
        if (arr.length < 2) return 0;
        const m = mean(arr);
        const variance = arr.reduce((sum, v) => sum + (v - m) * (v - m), 0) / (arr.length - 1);
        return Math.sqrt(variance);
    }

    function getSortedWeeklyKeys(weeklyData) {
        if (!weeklyData) return [];
        return Object.keys(weeklyData)
            .filter(k => {
                const pt = weeklyData[k]?.metadata?.periodType;
                return !pt || pt === 'week';
            })
            .sort();
    }

    // Pull the last N weeks of values for one rep on one metric
    function buildSeries(weeklyData, sortedKeys, empName, metricKey) {
        const series = [];
        const recent = sortedKeys.slice(-LOOKBACK_WEEKS);
        recent.forEach(weekKey => {
            const period = weeklyData[weekKey];
            const emp = period?.employees?.find(e => e.name === empName);
            if (!emp) return;
            const calls = parseInt(emp.totalCalls, 10);
            if (!Number.isFinite(calls) || calls < MIN_CALLS_FOR_DATAPOINT) return;
            const value = toFinite(emp[metricKey]);
            if (value === null) return;
            series.push({ weekKey, value });
        });
        return series;
    }

    // Reverse-aware comparison: returns true if `curr` is worse than `prev`
    function isWorse(metricKey, prev, curr) {
        return isReverseKey(metricKey) ? curr > prev : curr < prev;
    }
    function isBetter(metricKey, prev, curr) {
        return isReverseKey(metricKey) ? curr < prev : curr > prev;
    }

    // --- Pattern detectors ---

    function detectSustainedDecline(series, metricKey) {
        if (series.length < MIN_WEEKS_FOR_PATTERN) return null;
        let streak = 1;
        for (let i = series.length - 1; i > 0; i--) {
            if (isWorse(metricKey, series[i - 1].value, series[i].value)) {
                streak++;
            } else {
                break;
            }
        }
        if (streak >= 3) {
            const startIdx = series.length - streak;
            return {
                type: 'declining',
                severity: streak >= 4 ? 'high' : 'medium',
                metricKey,
                weeks: streak,
                startValue: series[startIdx].value,
                endValue: series[series.length - 1].value
            };
        }
        return null;
    }

    function detectSustainedImprovement(series, metricKey) {
        if (series.length < MIN_WEEKS_FOR_PATTERN) return null;
        let streak = 1;
        for (let i = series.length - 1; i > 0; i--) {
            if (isBetter(metricKey, series[i - 1].value, series[i].value)) {
                streak++;
            } else {
                break;
            }
        }
        if (streak >= 3) {
            const startIdx = series.length - streak;
            return {
                type: 'improving',
                severity: 'positive',
                metricKey,
                weeks: streak,
                startValue: series[startIdx].value,
                endValue: series[series.length - 1].value
            };
        }
        return null;
    }

    function detectCliffDrop(series, metricKey) {
        if (series.length < MIN_WEEKS_FOR_PATTERN + 1) return null;
        const prior = series.slice(0, -1).map(s => s.value);
        const latest = series[series.length - 1].value;
        const m = mean(prior);
        const sd = stddev(prior);
        if (sd === 0) return null;
        const distance = isReverseKey(metricKey) ? (latest - m) / sd : (m - latest) / sd;
        if (distance >= 2) {
            return {
                type: 'cliff-drop',
                severity: distance >= 2.5 ? 'high' : 'medium',
                metricKey,
                latestValue: latest,
                personalAverage: m,
                stddevDistance: distance
            };
        }
        return null;
    }

    function detectVolatility(series, metricKey) {
        if (series.length < MIN_WEEKS_FOR_PATTERN + 2) return null;
        const values = series.map(s => s.value);
        const m = mean(values);
        const sd = stddev(values);
        if (m === 0) return null;
        const coefficientOfVariation = Math.abs(sd / m);

        // Check if there's a clear trend — if so, volatility is expected, skip
        const firstHalfMean = mean(values.slice(0, Math.floor(values.length / 2)));
        const secondHalfMean = mean(values.slice(Math.floor(values.length / 2)));
        const hasTrend = Math.abs(secondHalfMean - firstHalfMean) > sd * 0.8;
        if (hasTrend) return null;

        // Per-metric CoV thresholds — % metrics tolerate less variance than seconds metrics
        const threshold = ['aht', 'acw', 'holdTime', 'reliability'].includes(metricKey) ? 0.20 : 0.10;
        if (coefficientOfVariation >= threshold) {
            return {
                type: 'volatile',
                severity: coefficientOfVariation >= threshold * 1.5 ? 'medium' : 'low',
                metricKey,
                mean: m,
                stddev: sd,
                coefficientOfVariation
            };
        }
        return null;
    }

    // --- Main scan ---

    function scanEmployee(weeklyData, sortedKeys, empName) {
        const patterns = [];
        TRACKED_METRICS.forEach(metricKey => {
            const series = buildSeries(weeklyData, sortedKeys, empName, metricKey);
            if (series.length < MIN_WEEKS_FOR_PATTERN) return;
            const detected = [
                detectSustainedDecline(series, metricKey),
                detectSustainedImprovement(series, metricKey),
                detectCliffDrop(series, metricKey),
                detectVolatility(series, metricKey)
            ].filter(Boolean);
            detected.forEach(p => patterns.push({ ...p, series }));
        });
        return patterns;
    }

    function runPatternScan(weeklyData) {
        if (!weeklyData) return { reps: [], summary: {} };
        const sortedKeys = getSortedWeeklyKeys(weeklyData);
        if (sortedKeys.length < MIN_WEEKS_FOR_PATTERN) {
            return {
                reps: [],
                summary: { insufficientHistory: true, weeksAvailable: sortedKeys.length }
            };
        }

        // Gather the union of rep names across the lookback window
        const recentKeys = sortedKeys.slice(-LOOKBACK_WEEKS);
        const nameSet = new Set();
        recentKeys.forEach(weekKey => {
            (weeklyData[weekKey]?.employees || []).forEach(emp => {
                if (emp?.name) nameSet.add(emp.name);
            });
        });

        // Apply team filter if available
        const ctx = typeof window.getTeamSelectionContext === 'function' ? window.getTeamSelectionContext() : null;
        const isIncluded = typeof window.isAssociateIncludedByTeamFilter === 'function'
            ? (name) => window.isAssociateIncludedByTeamFilter(name, ctx)
            : () => true;

        const reps = [];
        Array.from(nameSet).sort().forEach(name => {
            if (!isIncluded(name)) return;
            const patterns = scanEmployee(weeklyData, sortedKeys, name);
            if (patterns.length) reps.push({ name, patterns });
        });

        // Sort reps by severity: most high-severity negative patterns first,
        // then positive-only reps last.
        const severityScore = (p) => {
            if (p.type === 'improving') return 0;
            if (p.severity === 'high') return 3;
            if (p.severity === 'medium') return 2;
            return 1;
        };
        reps.forEach(r => {
            r.score = r.patterns.reduce((sum, p) => sum + severityScore(p), 0);
        });
        reps.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

        const summary = {
            totalReps: reps.length,
            declining: reps.filter(r => r.patterns.some(p => p.type === 'declining')).length,
            improving: reps.filter(r => r.patterns.some(p => p.type === 'improving')).length,
            cliff: reps.filter(r => r.patterns.some(p => p.type === 'cliff-drop')).length,
            volatile: reps.filter(r => r.patterns.some(p => p.type === 'volatile')).length,
            weeksAnalyzed: Math.min(sortedKeys.length, LOOKBACK_WEEKS)
        };

        return { reps, summary };
    }

    // --- UI ---

    function formatMetricValue(metricKey, value) {
        if (typeof window.formatMetricDisplay === 'function') return window.formatMetricDisplay(metricKey, value);
        const unit = window.METRICS_REGISTRY?.[metricKey]?.unit || '';
        if (unit === 'sec') return Math.round(value) + 's';
        if (unit === 'hrs') return value.toFixed(1) + ' hrs';
        return value.toFixed(1) + '%';
    }

    function describePattern(p) {
        const label = metricLabel(p.metricKey);
        if (p.type === 'declining') {
            return `📉 <strong>${label}</strong> has been declining ${p.weeks} weeks running — ${formatMetricValue(p.metricKey, p.startValue)} → ${formatMetricValue(p.metricKey, p.endValue)}`;
        }
        if (p.type === 'improving') {
            return `📈 <strong>${label}</strong> improving ${p.weeks} weeks in a row — ${formatMetricValue(p.metricKey, p.startValue)} → ${formatMetricValue(p.metricKey, p.endValue)}`;
        }
        if (p.type === 'cliff-drop') {
            return `⚡ <strong>${label}</strong> dropped to ${formatMetricValue(p.metricKey, p.latestValue)} — well below their normal ${formatMetricValue(p.metricKey, p.personalAverage)} (${p.stddevDistance.toFixed(1)}σ below personal norm)`;
        }
        if (p.type === 'volatile') {
            return `🎢 <strong>${label}</strong> is swinging week to week without a clear direction — averaging ${formatMetricValue(p.metricKey, p.mean)} ± ${formatMetricValue(p.metricKey, p.stddev)}`;
        }
        return '';
    }

    function severityColor(severity) {
        if (severity === 'high') return { bg: '#ffebee', text: '#c62828', border: '#ef5350' };
        if (severity === 'medium') return { bg: '#fff3e0', text: '#ef6c00', border: '#ff9800' };
        if (severity === 'positive') return { bg: '#e8f5e9', text: '#2e7d32', border: '#66bb6a' };
        return { bg: '#e3f2fd', text: '#1565c0', border: '#42a5f5' };
    }

    function showPatternMemoryModal() {
        const existing = document.getElementById('patternMemoryModal');
        if (existing) existing.remove();

        const weeklyData = typeof window.weeklyData !== 'undefined' ? window.weeklyData : {};
        const { reps, summary } = runPatternScan(weeklyData);

        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

        let bodyHtml;
        if (summary.insufficientHistory) {
            bodyHtml = `<div style="padding:40px; text-align:center; color:#546e7a;">` +
                `<div style="font-size:3em; margin-bottom:12px;">\uD83D\uDCC5</div>` +
                `<div style="font-size:1.1em; font-weight:600;">Not enough history yet.</div>` +
                `<div style="color:#999; font-size:0.9em; margin-top:8px;">Pattern detection needs at least ${MIN_WEEKS_FOR_PATTERN} weekly uploads. You currently have ${summary.weeksAvailable}.</div>` +
            `</div>`;
        } else if (!reps.length) {
            bodyHtml = `<div style="padding:40px; text-align:center; color:#2e7d32;">` +
                `<div style="font-size:3em; margin-bottom:12px;">\u2705</div>` +
                `<div style="font-size:1.15em; font-weight:600;">No notable patterns right now.</div>` +
                `<div style="color:#666; font-size:0.9em; margin-top:8px;">Nobody is in a sustained slide, cliff drop, or volatile stretch over the last ${summary.weeksAnalyzed} weeks.</div>` +
            `</div>`;
        } else {
            bodyHtml = reps.map(rep => {
                const patternsHtml = rep.patterns.map(p => {
                    const colors = severityColor(p.severity);
                    return `<div style="padding:10px 12px; margin-top:8px; background:${colors.bg}; border-left:3px solid ${colors.border}; border-radius:4px; color:${colors.text}; font-size:0.9em; line-height:1.45;">` +
                        describePattern(p) +
                    `</div>`;
                }).join('');
                return `<div style="margin-bottom:18px; padding:14px; border:1px solid #e0e0e0; border-radius:10px; background:#fff;">` +
                    `<div style="font-weight:700; color:#1a237e; font-size:1.05em;">${escapeHtml(rep.name)}</div>` +
                    patternsHtml +
                `</div>`;
            }).join('');
        }

        const overlay = document.createElement('div');
        overlay.id = 'patternMemoryModal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';

        overlay.innerHTML = `<div style="background:#fff; border-radius:14px; max-width:760px; width:100%; max-height:90vh; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(0,0,0,0.35);">` +
            `<div style="padding:20px 24px; border-bottom:1px solid #eceff1; display:flex; justify-content:space-between; align-items:center;">` +
                `<div>` +
                    `<h2 style="margin:0; color:#1a237e; font-size:1.25em;">\uD83E\uDDE0 Pattern Memory</h2>` +
                    `<div style="margin-top:6px; font-size:0.88em; color:#546e7a;">` +
                        (summary.insufficientHistory
                            ? `Need more weekly history`
                            : `${summary.totalReps || 0} rep${summary.totalReps === 1 ? '' : 's'} with patterns \u2022 ` +
                              `<span style="color:#c62828; font-weight:600;">${summary.declining || 0} declining</span> \u2022 ` +
                              `<span style="color:#ef6c00; font-weight:600;">${summary.cliff || 0} cliff drops</span> \u2022 ` +
                              `<span style="color:#1565c0; font-weight:600;">${summary.volatile || 0} volatile</span> \u2022 ` +
                              `<span style="color:#2e7d32; font-weight:600;">${summary.improving || 0} improving</span>`) +
                    `</div>` +
                `</div>` +
                `<button id="patternMemoryClose" style="background:none; border:none; font-size:1.6em; cursor:pointer; color:#999;">\u2715</button>` +
            `</div>` +
            `<div style="padding:16px 24px; overflow-y:auto; flex:1; background:#fafbfc;">${bodyHtml}</div>` +
            `<div style="padding:14px 24px; border-top:1px solid #eceff1; text-align:right;">` +
                `<button id="patternMemoryCloseBtn" style="background:#1a237e; color:#fff; border:none; border-radius:6px; padding:10px 20px; cursor:pointer; font-weight:bold;">Close</button>` +
            `</div>` +
        `</div>`;

        document.body.appendChild(overlay);
        document.getElementById('patternMemoryClose').addEventListener('click', () => overlay.remove());
        document.getElementById('patternMemoryCloseBtn').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.patternMemory = {
        runPatternScan,
        showPatternMemoryModal
    };
})();
