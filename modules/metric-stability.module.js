(function () {
    'use strict';

    // ============================================
    // METRIC STABILITY MODULE
    // Surfaces three derived analyses from existing data:
    //   1. Volatility — std dev of each rep's metric across weekly uploads
    //   2. Streaks — consecutive weeks above/below target per rep × metric
    //   3. Tip Effectiveness — for tips that have been issued, did the
    //      target metric actually move in the weeks after?
    // ============================================

    const STORAGE_PREFIX = window.DevCoachConstants?.STORAGE_PREFIX || 'devCoachingTool_';

    // Metrics worth analyzing for stability/streaks (have meaningful targets,
    // not raw counts). Skips totalCalls and transfersCount.
    const STABILITY_METRICS = [
        'scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience',
        'transfers', 'overallSentiment', 'positiveWord', 'negativeWord',
        'managingEmotions', 'aht', 'acw', 'holdTime'
    ];

    // Tip effectiveness window: how many weeks before/after the tip date
    // we average to compute baseline vs. follow-up. 3 weeks each side
    // smooths week-to-week noise without diluting the signal.
    const TIP_WINDOW_WEEKS = 3;

    // Minimum weekly samples needed to compute volatility — fewer than this
    // and the std dev is too noisy to be meaningful.
    const MIN_VOLATILITY_SAMPLES = 4;

    // Minimum number of times a tip must have been used (across all reps)
    // before its average delta is shown. Prevents a single coincidental
    // metric jump from anointing one tip as "best".
    const MIN_TIP_USAGE_FOR_AGGREGATE = 3;

    function escapeHtml(s) {
        const u = window.DevCoachModules?.sharedUtils?.escapeHtml;
        if (u) return u(s);
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function fmt(metricKey, value) {
        if (typeof window.formatMetricDisplay === 'function') {
            return window.formatMetricDisplay(metricKey, value);
        }
        return String(value);
    }

    function metricLabel(metricKey) {
        return window.METRICS_REGISTRY?.[metricKey]?.label || metricKey;
    }

    function isReverse(metricKey) {
        return window.METRICS_REGISTRY?.[metricKey]?.isReverse === true;
    }

    function unitOf(metricKey) {
        return window.METRICS_REGISTRY?.[metricKey]?.unit || '%';
    }

    function getYearTarget(metricKey, year) {
        const profile = window.DevCoachModules?.metricProfiles;
        if (profile?.getYearTarget) {
            const t = profile.getYearTarget(metricKey, year);
            if (t) return t;
        }
        const reg = window.METRICS_REGISTRY?.[metricKey]?.target;
        return reg || null;
    }

    function meetsTarget(metricKey, value, year) {
        const target = getYearTarget(metricKey, year);
        if (!target) return null;
        const num = parseFloat(value);
        if (!Number.isFinite(num)) return null;
        if (target.type === 'min') return num >= target.value;
        if (target.type === 'max') return num <= target.value;
        return null;
    }

    /**
     * Returns weekly periods (periodType === 'week') sorted by end date asc,
     * each as { key, endDate (ms), period }.
     */
    function getSortedWeeklyPeriods() {
        const wData = (typeof weeklyData !== 'undefined') ? weeklyData : {};
        const out = [];
        Object.keys(wData).forEach(function (key) {
            const period = wData[key];
            if (!period || !period.employees) return;
            const meta = period.metadata || {};
            // Only true full-week uploads contribute to stability/streaks.
            // week-in-progress, monthly, quarterly aggregates would
            // double-count and distort variance.
            if (meta.periodType && meta.periodType !== 'week') return;
            const endStr = meta.endDate || (key.includes('|') ? key.split('|')[1] : '');
            const endDate = endStr ? Date.parse(endStr) : NaN;
            if (!Number.isFinite(endDate)) return;
            out.push({ key: key, endDate: endDate, period: period });
        });
        out.sort(function (a, b) { return a.endDate - b.endDate; });
        return out;
    }

    /**
     * Get a rep's metric value for a given period, parsed to number,
     * or null if missing/invalid.
     */
    function getNumericMetric(period, employeeName, metricKey) {
        if (!period || !period.employees) return null;
        const emp = period.employees.find(function (e) { return e && e.name === employeeName; });
        if (!emp) return null;
        const raw = emp[metricKey];
        if (raw === undefined || raw === null || raw === '') return null;
        const num = parseFloat(raw);
        return Number.isFinite(num) ? num : null;
    }

    /**
     * Collect every rep name that appears in weekly uploads.
     */
    function collectAllRepNames(weeklyPeriods) {
        const set = new Set();
        weeklyPeriods.forEach(function (w) {
            (w.period.employees || []).forEach(function (e) {
                if (e && e.name) set.add(e.name);
            });
        });
        return Array.from(set);
    }

    function teamRoster() {
        if (typeof window.getTeamMembersForWeek === 'function') {
            const latestKey = (typeof window.getLatestWeeklyKey === 'function')
                ? window.getLatestWeeklyKey()
                : null;
            const members = window.getTeamMembersForWeek(latestKey);
            if (Array.isArray(members) && members.length > 0) return members;
        }
        return null;
    }

    // -------- VOLATILITY --------

    function stdDev(values) {
        if (!values.length) return 0;
        const mean = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
        const variance = values.reduce(function (acc, v) {
            const d = v - mean;
            return acc + d * d;
        }, 0) / values.length;
        return { mean: mean, sd: Math.sqrt(variance) };
    }

    /**
     * Compute volatility per rep × metric.
     * Returns array of { name, metricKey, samples, mean, sd, cv, min, max, range }.
     */
    function computeVolatility(weeklyPeriods, repNames) {
        const rows = [];
        repNames.forEach(function (name) {
            STABILITY_METRICS.forEach(function (metricKey) {
                const series = [];
                weeklyPeriods.forEach(function (w) {
                    const v = getNumericMetric(w.period, name, metricKey);
                    if (v !== null) series.push(v);
                });
                if (series.length < MIN_VOLATILITY_SAMPLES) return;
                const { mean, sd } = stdDev(series);
                const cv = mean !== 0 ? sd / Math.abs(mean) : 0;
                const min = Math.min.apply(null, series);
                const max = Math.max.apply(null, series);
                rows.push({
                    name: name,
                    metricKey: metricKey,
                    samples: series.length,
                    mean: mean,
                    sd: sd,
                    cv: cv,
                    min: min,
                    max: max,
                    range: max - min
                });
            });
        });
        return rows;
    }

    // -------- STREAKS --------

    /**
     * For a rep × metric, compute current streak (above or below target) and
     * historical best/worst streaks.
     * Returns null if no sufficient data, otherwise:
     *   { name, metricKey, currentLen, currentDirection, longestAbove, longestBelow, totalWeeks }
     */
    function computeStreakForRep(weeklyPeriods, name, metricKey) {
        // Sequence: per-week boolean (true = met, false = missed, null = no data).
        const seq = weeklyPeriods.map(function (w) {
            const v = getNumericMetric(w.period, name, metricKey);
            if (v === null) return null;
            const year = new Date(w.endDate).getFullYear();
            const m = meetsTarget(metricKey, v, year);
            return m;
        }).filter(function (b) { return b !== null; });

        if (seq.length < 2) return null;

        // Current streak: walk back from most recent week.
        const last = seq[seq.length - 1];
        let curLen = 0;
        for (let i = seq.length - 1; i >= 0; i--) {
            if (seq[i] === last) curLen++;
            else break;
        }

        // Longest above & below.
        let longestAbove = 0, longestBelow = 0;
        let runAbove = 0, runBelow = 0;
        seq.forEach(function (m) {
            if (m === true) {
                runAbove++; runBelow = 0;
                if (runAbove > longestAbove) longestAbove = runAbove;
            } else {
                runBelow++; runAbove = 0;
                if (runBelow > longestBelow) longestBelow = runBelow;
            }
        });

        return {
            name: name,
            metricKey: metricKey,
            currentLen: curLen,
            currentDirection: last ? 'above' : 'below',
            longestAbove: longestAbove,
            longestBelow: longestBelow,
            totalWeeks: seq.length
        };
    }

    function computeStreaks(weeklyPeriods, repNames) {
        const rows = [];
        repNames.forEach(function (name) {
            STABILITY_METRICS.forEach(function (metricKey) {
                const r = computeStreakForRep(weeklyPeriods, name, metricKey);
                if (r) rows.push(r);
            });
        });
        return rows;
    }

    // -------- TIP EFFECTIVENESS --------

    function loadTipUsageHistory() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'tipUsageHistory') || '{}');
        } catch (_e) {
            return {};
        }
    }

    /**
     * Average a rep's metric over weekly periods whose endDate falls within
     * [startMs, endMs]. Returns null if no samples in window.
     */
    function avgInWindow(weeklyPeriods, name, metricKey, startMs, endMs) {
        const vals = [];
        weeklyPeriods.forEach(function (w) {
            if (w.endDate < startMs || w.endDate > endMs) return;
            const v = getNumericMetric(w.period, name, metricKey);
            if (v !== null) vals.push(v);
        });
        if (!vals.length) return null;
        return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    }

    /**
     * Signed delta where positive = improvement (accounts for isReverse).
     */
    function improvementDelta(metricKey, baseline, followup) {
        if (baseline === null || followup === null) return null;
        return isReverse(metricKey) ? (baseline - followup) : (followup - baseline);
    }

    /**
     * For each (rep, metric, tip) triple in tipUsageHistory, compute
     * baseline (3 weeks before first use) and follow-up (3 weeks after).
     * Aggregates per tip text across all reps.
     *
     * Returns:
     *   { perTipUse: [{name, metricKey, tip, usedAt, baseline, followup, delta}],
     *     perTipAggregate: [{tip, metricKey, uses, avgDelta, improvedCount}] }
     */
    function computeTipEffectiveness(weeklyPeriods) {
        const history = loadTipUsageHistory();
        const perTipUse = [];

        Object.keys(history).forEach(function (empName) {
            const byMetric = history[empName] || {};
            Object.keys(byMetric).forEach(function (metricKey) {
                const entries = byMetric[metricKey];
                if (!Array.isArray(entries)) return;

                // For each unique tip text, use the FIRST usage as anchor —
                // re-issuing the same tip later doesn't reset the baseline.
                const firstUseByTip = {};
                entries.forEach(function (entry) {
                    if (!entry || !entry.tip || !entry.usedAt) return;
                    const t = Date.parse(entry.usedAt);
                    if (!Number.isFinite(t)) return;
                    if (firstUseByTip[entry.tip] === undefined || t < firstUseByTip[entry.tip]) {
                        firstUseByTip[entry.tip] = t;
                    }
                });

                Object.keys(firstUseByTip).forEach(function (tipText) {
                    const anchorMs = firstUseByTip[tipText];
                    const weekMs = 7 * 24 * 60 * 60 * 1000;
                    const baseStart = anchorMs - TIP_WINDOW_WEEKS * weekMs;
                    const baseEnd = anchorMs - 1;
                    const followStart = anchorMs + 1;
                    const followEnd = anchorMs + TIP_WINDOW_WEEKS * weekMs;

                    const baseline = avgInWindow(weeklyPeriods, empName, metricKey, baseStart, baseEnd);
                    const followup = avgInWindow(weeklyPeriods, empName, metricKey, followStart, followEnd);
                    const delta = improvementDelta(metricKey, baseline, followup);

                    if (delta === null) return;
                    perTipUse.push({
                        name: empName,
                        metricKey: metricKey,
                        tip: tipText,
                        usedAt: anchorMs,
                        baseline: baseline,
                        followup: followup,
                        delta: delta
                    });
                });
            });
        });

        // Aggregate by (tip text + metricKey).
        const aggMap = {};
        perTipUse.forEach(function (use) {
            const k = use.metricKey + '||' + use.tip;
            if (!aggMap[k]) {
                aggMap[k] = {
                    tip: use.tip,
                    metricKey: use.metricKey,
                    uses: 0,
                    sumDelta: 0,
                    improvedCount: 0
                };
            }
            const agg = aggMap[k];
            agg.uses++;
            agg.sumDelta += use.delta;
            if (use.delta > 0) agg.improvedCount++;
        });

        const perTipAggregate = Object.keys(aggMap).map(function (k) {
            const a = aggMap[k];
            return {
                tip: a.tip,
                metricKey: a.metricKey,
                uses: a.uses,
                avgDelta: a.sumDelta / a.uses,
                improvedCount: a.improvedCount,
                improvedPct: a.improvedCount / a.uses
            };
        });

        return { perTipUse: perTipUse, perTipAggregate: perTipAggregate };
    }

    // -------- RENDERING --------

    function deltaCell(metricKey, delta) {
        // delta is already sign-normalized (positive = improvement).
        const unit = unitOf(metricKey);
        const abs = Math.abs(delta);
        const formatted = unit === 'sec'
            ? Math.round(abs) + ' sec'
            : unit === 'hrs'
                ? abs.toFixed(2) + ' hrs'
                : abs.toFixed(1) + (unit === '%' ? ' pts' : '');
        if (delta > 0.05) {
            return '<span style="color:#2e7d32;font-weight:600;">▲ ' + formatted + '</span>';
        }
        if (delta < -0.05) {
            return '<span style="color:#c62828;font-weight:600;">▼ ' + formatted + '</span>';
        }
        return '<span style="color:#666;">≈ flat</span>';
    }

    function renderVolatilityTable(volatilityRows, teamFilter) {
        if (!volatilityRows.length) {
            return '<p style="color:#666;font-style:italic;">Need at least ' + MIN_VOLATILITY_SAMPLES + ' weekly uploads per rep to compute volatility.</p>';
        }
        // Show top 20 most volatile rep × metric pairs (highest CV).
        // Filter to team if a team roster is selected.
        const filtered = teamFilter
            ? volatilityRows.filter(function (r) { return teamFilter.indexOf(r.name) !== -1; })
            : volatilityRows;
        const sorted = filtered.slice().sort(function (a, b) { return b.cv - a.cv; }).slice(0, 20);

        let html = '<table style="width:100%;border-collapse:collapse;font-size:0.9em;">';
        html += '<thead><tr style="background:#ede7f6;">';
        html += '<th style="text-align:left;padding:8px;border-bottom:2px solid #9c27b0;">Rep</th>';
        html += '<th style="text-align:left;padding:8px;border-bottom:2px solid #9c27b0;">Metric</th>';
        html += '<th style="text-align:right;padding:8px;border-bottom:2px solid #9c27b0;">Avg</th>';
        html += '<th style="text-align:right;padding:8px;border-bottom:2px solid #9c27b0;">Std Dev</th>';
        html += '<th style="text-align:right;padding:8px;border-bottom:2px solid #9c27b0;">Range</th>';
        html += '<th style="text-align:right;padding:8px;border-bottom:2px solid #9c27b0;">Weeks</th>';
        html += '</tr></thead><tbody>';

        sorted.forEach(function (r) {
            html += '<tr style="border-bottom:1px solid #eee;">';
            html += '<td style="padding:8px;">' + escapeHtml(r.name) + '</td>';
            html += '<td style="padding:8px;">' + escapeHtml(metricLabel(r.metricKey)) + '</td>';
            html += '<td style="padding:8px;text-align:right;">' + escapeHtml(fmt(r.metricKey, r.mean)) + '</td>';
            html += '<td style="padding:8px;text-align:right;font-weight:600;">' + escapeHtml(fmt(r.metricKey, r.sd)) + '</td>';
            html += '<td style="padding:8px;text-align:right;color:#666;">' + escapeHtml(fmt(r.metricKey, r.min)) + ' – ' + escapeHtml(fmt(r.metricKey, r.max)) + '</td>';
            html += '<td style="padding:8px;text-align:right;color:#666;">' + r.samples + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        html += '<p style="color:#666;font-size:0.85em;margin-top:8px;">Higher std dev = less consistent week to week. Sorted by coefficient of variation (relative volatility).</p>';
        return html;
    }

    function renderStreaksTable(streakRows, teamFilter) {
        if (!streakRows.length) {
            return '<p style="color:#666;font-style:italic;">No streak data yet — need weekly uploads with target-comparable metrics.</p>';
        }
        const filtered = teamFilter
            ? streakRows.filter(function (r) { return teamFilter.indexOf(r.name) !== -1; })
            : streakRows;

        // Two leaderboards: hottest current above-target streaks, longest current below-target streaks.
        const above = filtered
            .filter(function (r) { return r.currentDirection === 'above' && r.currentLen >= 2; })
            .sort(function (a, b) { return b.currentLen - a.currentLen; })
            .slice(0, 12);

        const below = filtered
            .filter(function (r) { return r.currentDirection === 'below' && r.currentLen >= 2; })
            .sort(function (a, b) { return b.currentLen - a.currentLen; })
            .slice(0, 12);

        function streakTable(title, rows, color) {
            if (!rows.length) {
                return '<div style="flex:1;min-width:300px;">'
                    + '<h4 style="color:' + color + ';margin:0 0 8px;">' + title + '</h4>'
                    + '<p style="color:#666;font-style:italic;font-size:0.9em;">None right now.</p>'
                    + '</div>';
            }
            let h = '<div style="flex:1;min-width:300px;">';
            h += '<h4 style="color:' + color + ';margin:0 0 8px;">' + title + '</h4>';
            h += '<table style="width:100%;border-collapse:collapse;font-size:0.9em;">';
            h += '<thead><tr style="background:#f5f5f5;">';
            h += '<th style="text-align:left;padding:6px;">Rep</th>';
            h += '<th style="text-align:left;padding:6px;">Metric</th>';
            h += '<th style="text-align:right;padding:6px;">Wks</th>';
            h += '</tr></thead><tbody>';
            rows.forEach(function (r) {
                h += '<tr style="border-bottom:1px solid #eee;">';
                h += '<td style="padding:6px;">' + escapeHtml(r.name) + '</td>';
                h += '<td style="padding:6px;">' + escapeHtml(metricLabel(r.metricKey)) + '</td>';
                h += '<td style="padding:6px;text-align:right;font-weight:700;color:' + color + ';">' + r.currentLen + '</td>';
                h += '</tr>';
            });
            h += '</tbody></table>';
            h += '</div>';
            return h;
        }

        return '<div style="display:flex;gap:24px;flex-wrap:wrap;">'
            + streakTable('🔥 On a roll (current weeks above target)', above, '#2e7d32')
            + streakTable('🧊 Stuck below (current weeks missing target)', below, '#c62828')
            + '</div>';
    }

    function renderTipEffectiveness(tipResult) {
        const perUse = tipResult.perTipUse;
        const agg = tipResult.perTipAggregate;

        if (!perUse.length) {
            return '<p style="color:#666;font-style:italic;">No tip-effectiveness data yet. Tips need to be issued (via coaching emails) and have at least one full week of metric data on either side of the issue date.</p>';
        }

        // Aggregated leaderboard: tips with ≥ MIN_TIP_USAGE_FOR_AGGREGATE uses.
        const eligibleAgg = agg.filter(function (a) { return a.uses >= MIN_TIP_USAGE_FOR_AGGREGATE; });
        const topMovers = eligibleAgg.slice().sort(function (a, b) { return b.avgDelta - a.avgDelta; }).slice(0, 10);
        const bottomMovers = eligibleAgg.slice().sort(function (a, b) { return a.avgDelta - b.avgDelta; }).slice(0, 5);

        let html = '';

        if (eligibleAgg.length) {
            html += '<h4 style="margin:0 0 8px;color:#2e7d32;">🏆 Tips that moved the needle (avg delta across reps)</h4>';
            html += '<p style="color:#666;font-size:0.85em;margin:0 0 8px;">Only tips used ' + MIN_TIP_USAGE_FOR_AGGREGATE + '+ times are shown. Delta = avg metric value in the ' + TIP_WINDOW_WEEKS + ' weeks after the tip was issued, vs. the ' + TIP_WINDOW_WEEKS + ' weeks before.</p>';
            html += '<table style="width:100%;border-collapse:collapse;font-size:0.9em;margin-bottom:20px;">';
            html += '<thead><tr style="background:#e8f5e9;">';
            html += '<th style="text-align:left;padding:8px;border-bottom:2px solid #2e7d32;">Tip</th>';
            html += '<th style="text-align:left;padding:8px;border-bottom:2px solid #2e7d32;">Metric</th>';
            html += '<th style="text-align:right;padding:8px;border-bottom:2px solid #2e7d32;">Uses</th>';
            html += '<th style="text-align:right;padding:8px;border-bottom:2px solid #2e7d32;">% improved</th>';
            html += '<th style="text-align:right;padding:8px;border-bottom:2px solid #2e7d32;">Avg delta</th>';
            html += '</tr></thead><tbody>';
            topMovers.forEach(function (a) {
                html += '<tr style="border-bottom:1px solid #eee;">';
                html += '<td style="padding:8px;max-width:380px;">' + escapeHtml(a.tip) + '</td>';
                html += '<td style="padding:8px;">' + escapeHtml(metricLabel(a.metricKey)) + '</td>';
                html += '<td style="padding:8px;text-align:right;">' + a.uses + '</td>';
                html += '<td style="padding:8px;text-align:right;">' + Math.round(a.improvedPct * 100) + '%</td>';
                html += '<td style="padding:8px;text-align:right;">' + deltaCell(a.metricKey, a.avgDelta) + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';

            if (bottomMovers.length && bottomMovers[0].avgDelta < 0) {
                html += '<h4 style="margin:0 0 8px;color:#c62828;">⚠️ Tips that haven\'t helped (avg delta negative)</h4>';
                html += '<table style="width:100%;border-collapse:collapse;font-size:0.9em;margin-bottom:20px;">';
                html += '<thead><tr style="background:#ffebee;">';
                html += '<th style="text-align:left;padding:8px;border-bottom:2px solid #c62828;">Tip</th>';
                html += '<th style="text-align:left;padding:8px;border-bottom:2px solid #c62828;">Metric</th>';
                html += '<th style="text-align:right;padding:8px;border-bottom:2px solid #c62828;">Uses</th>';
                html += '<th style="text-align:right;padding:8px;border-bottom:2px solid #c62828;">Avg delta</th>';
                html += '</tr></thead><tbody>';
                bottomMovers.forEach(function (a) {
                    if (a.avgDelta >= 0) return;
                    html += '<tr style="border-bottom:1px solid #eee;">';
                    html += '<td style="padding:8px;max-width:380px;">' + escapeHtml(a.tip) + '</td>';
                    html += '<td style="padding:8px;">' + escapeHtml(metricLabel(a.metricKey)) + '</td>';
                    html += '<td style="padding:8px;text-align:right;">' + a.uses + '</td>';
                    html += '<td style="padding:8px;text-align:right;">' + deltaCell(a.metricKey, a.avgDelta) + '</td>';
                    html += '</tr>';
                });
                html += '</tbody></table>';
            }
        } else {
            html += '<p style="color:#666;font-style:italic;margin-bottom:20px;">Not enough tip-usage history yet to surface aggregate winners (need ' + MIN_TIP_USAGE_FOR_AGGREGATE + '+ uses per tip).</p>';
        }

        // Per-rep recent log: 15 most recent tip applications with measurable outcomes.
        const recent = perUse.slice().sort(function (a, b) { return b.usedAt - a.usedAt; }).slice(0, 15);
        html += '<h4 style="margin:16px 0 8px;color:#1565c0;">📋 Recent tip outcomes (per rep)</h4>';
        html += '<table style="width:100%;border-collapse:collapse;font-size:0.9em;">';
        html += '<thead><tr style="background:#e3f2fd;">';
        html += '<th style="text-align:left;padding:8px;border-bottom:2px solid #1565c0;">Rep</th>';
        html += '<th style="text-align:left;padding:8px;border-bottom:2px solid #1565c0;">Metric</th>';
        html += '<th style="text-align:left;padding:8px;border-bottom:2px solid #1565c0;">Issued</th>';
        html += '<th style="text-align:right;padding:8px;border-bottom:2px solid #1565c0;">Before → After</th>';
        html += '<th style="text-align:right;padding:8px;border-bottom:2px solid #1565c0;">Delta</th>';
        html += '</tr></thead><tbody>';
        recent.forEach(function (u) {
            const dStr = new Date(u.usedAt).toISOString().slice(0, 10);
            html += '<tr style="border-bottom:1px solid #eee;">';
            html += '<td style="padding:8px;">' + escapeHtml(u.name) + '</td>';
            html += '<td style="padding:8px;">' + escapeHtml(metricLabel(u.metricKey)) + '</td>';
            html += '<td style="padding:8px;color:#666;">' + dStr + '</td>';
            html += '<td style="padding:8px;text-align:right;color:#666;">'
                + escapeHtml(fmt(u.metricKey, u.baseline)) + ' → ' + escapeHtml(fmt(u.metricKey, u.followup))
                + '</td>';
            html += '<td style="padding:8px;text-align:right;">' + deltaCell(u.metricKey, u.delta) + '</td>';
            html += '</tr>';
        });
        html += '</tbody></table>';

        return html;
    }

    function render(container) {
        if (!container) return;

        const weeklyPeriods = getSortedWeeklyPeriods();
        const teamFilter = teamRoster();

        if (!weeklyPeriods.length) {
            container.innerHTML = '<div style="padding:24px;background:#fff3cd;border-left:4px solid #ffc107;border-radius:4px;">'
                + '<strong>⚠️ No weekly data yet.</strong>'
                + '<p style="margin:6px 0 0;">Upload some weekly PowerBI data to see volatility, streaks, and tip effectiveness.</p>'
                + '</div>';
            return;
        }

        // Default to team scope if a team roster is set; else all reps.
        const repNames = teamFilter && teamFilter.length
            ? teamFilter
            : collectAllRepNames(weeklyPeriods);

        const volatility = computeVolatility(weeklyPeriods, repNames);
        const streaks = computeStreaks(weeklyPeriods, repNames);
        const tipResult = computeTipEffectiveness(weeklyPeriods);

        const scopeLabel = teamFilter && teamFilter.length
            ? 'Showing your team (' + teamFilter.length + ' reps) across ' + weeklyPeriods.length + ' weekly upload(s).'
            : 'Showing all ' + repNames.length + ' reps across ' + weeklyPeriods.length + ' weekly upload(s).';

        let html = '';
        html += '<div style="background:#fff;padding:16px;border-radius:8px;margin-bottom:16px;border-left:4px solid #9c27b0;">';
        html += '<h3 style="margin:0 0 4px;color:#6a1b9a;">📊 Patterns & Stability</h3>';
        html += '<p style="margin:0;color:#666;font-size:0.9em;">' + escapeHtml(scopeLabel) + '</p>';
        html += '</div>';

        html += '<div style="background:#fff;padding:16px;border-radius:8px;margin-bottom:16px;">';
        html += '<h3 style="margin:0 0 12px;color:#6a1b9a;">📈 Consistency (week-to-week volatility)</h3>';
        html += renderVolatilityTable(volatility, null);
        html += '</div>';

        html += '<div style="background:#fff;padding:16px;border-radius:8px;margin-bottom:16px;">';
        html += '<h3 style="margin:0 0 12px;color:#6a1b9a;">🔥 Streaks (consecutive weeks vs target)</h3>';
        html += renderStreaksTable(streaks, null);
        html += '</div>';

        html += '<div style="background:#fff;padding:16px;border-radius:8px;">';
        html += '<h3 style="margin:0 0 12px;color:#6a1b9a;">💡 Tip effectiveness</h3>';
        html += renderTipEffectiveness(tipResult);
        html += '</div>';

        container.innerHTML = html;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.metricStability = {
        render: render,
        // exposed for testing / re-use elsewhere
        computeVolatility: computeVolatility,
        computeStreaks: computeStreaks,
        computeTipEffectiveness: computeTipEffectiveness,
        getSortedWeeklyPeriods: getSortedWeeklyPeriods
    };
})();
