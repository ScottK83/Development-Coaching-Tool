(function() {
    'use strict';

    // ============================================
    // MORNING PULSE MODULE
    // Team-wide weekly trajectory briefing with
    // per-person quick check-in generation.
    //
    // Compares across recent uploads (e.g. Mon-Wed)
    // to show who improved, who dipped, and by how
    // much — so you can say "You made the biggest
    // jump in FCR this week."
    // ============================================

    // --- Data helpers ---

    function getAllSortedKeys() {
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        const allKeys = Object.keys(weekly).concat(Object.keys(ytd)).sort();
        return allKeys;
    }

    function getPeriodData(weekKey) {
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        return weekly[weekKey] || ytd[weekKey] || null;
    }

    function getPeriodEndDate(weekKey) {
        const period = getPeriodData(weekKey);
        const meta = period?.metadata?.endDate;
        if (meta) return new Date(meta + 'T00:00:00');
        const parts = weekKey.split('|');
        return new Date((parts[1] || parts[0]) + 'T00:00:00');
    }

    function getEndDateLabel(weekKey, period) {
        const meta = period?.metadata?.endDate;
        if (meta && typeof formatDateMMDDYYYY === 'function') return formatDateMMDDYYYY(meta);
        const parts = weekKey.split('|');
        const raw = parts[1] || parts[0];
        return typeof formatDateMMDDYYYY === 'function' ? formatDateMMDDYYYY(raw) : raw;
    }

    function getFilteredEmployees(period) {
        if (!period?.employees) return [];
        const ctx = typeof getTeamSelectionContext === 'function' ? getTeamSelectionContext() : null;
        return period.employees
            .filter(emp => emp?.name)
            .filter(emp => typeof isAssociateIncludedByTeamFilter === 'function'
                ? isAssociateIncludedByTeamFilter(emp.name, ctx)
                : true)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    // Find the recent window of uploads: latest key + the earliest key
    // within the trailing 7 calendar days (the "work week" window).
    // Returns { latestKey, baselineKey, allRecentKeys }
    function getWeekWindow() {
        const allKeys = getAllSortedKeys();
        if (!allKeys.length) return null;

        const latestKey = allKeys[allKeys.length - 1];
        const latestDate = getPeriodEndDate(latestKey);

        // Look back up to 7 calendar days for the baseline
        const cutoff = new Date(latestDate);
        cutoff.setDate(cutoff.getDate() - 7);

        const recentKeys = allKeys.filter(k => {
            const d = getPeriodEndDate(k);
            return d >= cutoff && d <= latestDate;
        });

        // Baseline = earliest in the window
        const baselineKey = recentKeys.length > 1 ? recentKeys[0] : null;

        return { latestKey, baselineKey, allRecentKeys: recentKeys };
    }

    // Calculate per-metric deltas between baseline and latest for one employee
    function calcWeekDeltas(empName, baselineKey, latestKey) {
        const basePeriod = getPeriodData(baselineKey);
        const latestPeriod = getPeriodData(latestKey);
        const baseEmp = basePeriod?.employees?.find(e => e.name === empName);
        const latestEmp = latestPeriod?.employees?.find(e => e.name === empName);
        if (!baseEmp || !latestEmp) return [];

        const registry = typeof METRICS_REGISTRY !== 'undefined' ? METRICS_REGISTRY : {};
        const deltas = [];

        Object.keys(registry).forEach(metricKey => {
            const baseVal = parseFloat(baseEmp[metricKey]);
            const latestVal = parseFloat(latestEmp[metricKey]);
            if (!Number.isFinite(baseVal) || !Number.isFinite(latestVal)) return;

            const delta = typeof metricDelta === 'function'
                ? metricDelta(metricKey, latestVal, baseVal)
                : latestVal - baseVal;

            deltas.push({
                metricKey,
                label: registry[metricKey]?.label || metricKey,
                baseValue: baseVal,
                latestValue: latestVal,
                delta,
                absDelta: Math.abs(delta)
            });
        });

        return deltas;
    }

    // Find the single biggest positive jump for an employee
    function getBiggestJump(deltas) {
        const improvements = deltas.filter(d => d.delta > 0);
        if (!improvements.length) return null;
        return improvements.reduce((best, d) => d.delta > best.delta ? d : best);
    }

    // --- Analysis (reuses existing analyzeTrendMetrics for current snapshot) ---

    function analyzeCurrentSnapshot(emp, centerAvgs, weekKey) {
        const analyzeFn = window.DevCoachModules?.metricTrends?.analyzeTrendMetrics
            || window.analyzeTrendMetrics;
        if (!analyzeFn) return null;

        // Get previous period for trend direction
        let prevEmp = null;
        const keys = typeof getWeeklyKeysSorted === 'function' ? getWeeklyKeysSorted() : [];
        const idx = keys.indexOf(weekKey);
        if (idx > 0) {
            const prevPeriod = getPeriodData(keys[idx - 1]);
            prevEmp = prevPeriod?.employees?.find(e => e.name === emp.name) || null;
        }

        return analyzeFn(emp, centerAvgs, null, prevEmp, {
            employeeName: emp.name,
            weekKey: weekKey,
            periodType: 'week'
        });
    }

    function pickFocalPoint(allMetrics) {
        const needsFocus = allMetrics
            .filter(m => m.classification === 'Needs Focus')
            .sort((a, b) => {
                const riskA = (a.gapFromTarget || 0) + (a.trendDirection === 'declining' ? 2 : 0);
                const riskB = (b.gapFromTarget || 0) + (b.trendDirection === 'declining' ? 2 : 0);
                return riskB - riskA;
            });
        if (needsFocus.length) return needsFocus[0];

        const watchArea = allMetrics
            .filter(m => m.classification === 'Watch Area')
            .sort((a, b) => (b.gapFromTarget || 0) - (a.gapFromTarget || 0));
        if (watchArea.length) return watchArea[0];

        return null;
    }

    function getStatusBadge(allMetrics) {
        const needsFocus = allMetrics.filter(m => m.classification === 'Needs Focus').length;
        const exceeding = allMetrics.filter(m => m.classification === 'Exceeding Expectation').length;
        const onTrack = allMetrics.filter(m => m.classification === 'On Track').length;

        if (needsFocus >= 3) return { label: 'Needs Support', color: '#e53935', bg: '#ffebee', icon: '\uD83D\uDD34' };
        if (needsFocus >= 1) return { label: 'Watch', color: '#fb8c00', bg: '#fff3e0', icon: '\uD83D\uDFE1' };
        if (exceeding >= 3) return { label: 'Crushing It', color: '#2e7d32', bg: '#e8f5e9', icon: '\uD83D\uDFE2' };
        if (onTrack + exceeding >= allMetrics.length * 0.7) return { label: 'Solid', color: '#1e88e5', bg: '#e3f2fd', icon: '\uD83D\uDD35' };
        return { label: 'Steady', color: '#78909c', bg: '#eceff1', icon: '\u26AA' };
    }

    // --- Formatting helpers ---

    function fmtVal(metricKeyOrObj, value) {
        const key = typeof metricKeyOrObj === 'object' ? metricKeyOrObj.metricKey : metricKeyOrObj;
        const val = value !== undefined ? value : (typeof metricKeyOrObj === 'object' ? metricKeyOrObj.employeeValue : 0);
        if (typeof formatMetricDisplay === 'function') return formatMetricDisplay(key, val);
        const unit = window.METRICS_REGISTRY?.[key]?.unit || '';
        if (unit === 'sec') return Math.round(val) + 's';
        if (unit === 'hrs') return val.toFixed(1) + ' hrs';
        return val.toFixed(1) + '%';
    }

    function fmtTarget(metric) {
        if (typeof formatMetricDisplay === 'function') return formatMetricDisplay(metric.metricKey, metric.target);
        return metric.target + '';
    }

    function fmtDelta(metricKey, delta) {
        const unit = window.METRICS_REGISTRY?.[metricKey]?.unit || '';
        const sign = delta > 0 ? '+' : '';
        if (unit === 'sec') return sign + Math.round(delta) + 's';
        if (unit === 'hrs') return sign + delta.toFixed(1) + ' hrs';
        return sign + delta.toFixed(1) + '%';
    }

    // --- Card rendering ---

    function buildEmployeeCard(emp, analysis, weekDeltas, biggestJump) {
        const allMetrics = analysis.allMetrics || [];
        const badge = getStatusBadge(allMetrics);
        const focalPoint = pickFocalPoint(allMetrics);
        const hasTrajectory = weekDeltas.length > 0;

        const wins = allMetrics
            .filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track')
            .sort((a, b) => {
                if (a.classification !== b.classification) return a.classification === 'Exceeding Expectation' ? -1 : 1;
                const mA = a.targetType === 'min' ? a.employeeValue - a.target : a.target - a.employeeValue;
                const mB = b.targetType === 'min' ? b.employeeValue - b.target : b.target - b.employeeValue;
                return mB - mA;
            })
            .slice(0, 2);

        const opportunities = allMetrics
            .filter(m => m.classification === 'Needs Focus' || m.classification === 'Watch Area')
            .sort((a, b) => (b.gapFromTarget || 0) - (a.gapFromTarget || 0))
            .slice(0, 2);

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(emp.name)
            : emp.name.split(/[\s,]+/)[0];

        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => String(s));

        const trendArrow = (dir) => {
            if (dir === 'improving') return '<span style="color:#2e7d32;" title="Improving">\u25B2</span>';
            if (dir === 'declining') return '<span style="color:#e53935;" title="Declining">\u25BC</span>';
            return '<span style="color:#9e9e9e;" title="Stable">\u2015</span>';
        };

        // Wins section
        let winsHtml = '';
        if (wins.length) {
            winsHtml = wins.map(m => {
                // Find this metric's week delta if available
                const wd = weekDeltas.find(d => d.metricKey === m.metricKey);
                const deltaTag = wd && wd.delta > 0
                    ? ` <span style="color:#1b5e20; font-size:0.85em;">(${fmtDelta(m.metricKey, wd.delta)} this week)</span>`
                    : '';
                return `<div style="font-size:0.85em; color:#2e7d32; padding:2px 0;">` +
                    `${trendArrow(m.trendDirection)} ${escapeHtml(m.label)}: <strong>${fmtVal(m)}</strong>${deltaTag}</div>`;
            }).join('');
        } else {
            winsHtml = '<div style="font-size:0.85em; color:#999;">No metrics at target yet</div>';
        }

        // Opportunities section
        let oppsHtml = '';
        if (opportunities.length) {
            oppsHtml = opportunities.map(m => {
                const wd = weekDeltas.find(d => d.metricKey === m.metricKey);
                const deltaTag = wd && wd.delta !== 0
                    ? ` <span style="color:${wd.delta > 0 ? '#1b5e20' : '#b71c1c'}; font-size:0.85em;">(${fmtDelta(m.metricKey, wd.delta)})</span>`
                    : '';
                return `<div style="font-size:0.85em; color:#c62828; padding:2px 0;">` +
                    `${trendArrow(m.trendDirection)} ${escapeHtml(m.label)}: <strong>${fmtVal(m)}</strong> ` +
                    `<span style="color:#999;">(target: ${fmtTarget(m)})</span>${deltaTag}</div>`;
            }).join('');
        } else {
            oppsHtml = '<div style="font-size:0.85em; color:#999;">All metrics on track!</div>';
        }

        // Biggest jump callout (only if we have multi-day data)
        let jumpHtml = '';
        if (biggestJump && biggestJump.delta > 0) {
            jumpHtml = `<div style="padding:6px 10px; background:#e8f5e9; border-radius:4px; font-size:0.83em; color:#1b5e20; border-left:3px solid #4caf50;">` +
                `\uD83D\uDE80 <strong>Biggest jump:</strong> ${escapeHtml(biggestJump.label)} ${fmtDelta(biggestJump.metricKey, biggestJump.delta)} this week ` +
                `(${fmtVal(biggestJump.metricKey, biggestJump.baseValue)} \u2192 ${fmtVal(biggestJump.metricKey, biggestJump.latestValue)})</div>`;
        }

        // Focal point
        let focalHtml = '';
        if (focalPoint) {
            const dirLabel = focalPoint.trendDirection === 'declining' ? ' and declining' : '';
            focalHtml = `<div style="padding:8px; background:#fff3e0; border-radius:4px; border-left:3px solid #ff9800; font-size:0.85em;">` +
                `<strong>\uD83C\uDFAF Focus:</strong> ${escapeHtml(focalPoint.label)} \u2014 currently ${fmtVal(focalPoint)} vs target ${fmtTarget(focalPoint)}${dirLabel}</div>`;
        } else {
            focalHtml = `<div style="padding:8px; background:#e8f5e9; border-radius:4px; border-left:3px solid #4caf50; font-size:0.85em;">` +
                `<strong>\u2705 On track!</strong> Keep up the consistency.</div>`;
        }

        return `<div class="pulse-card" data-employee="${escapeHtml(emp.name)}" style="background:#fff; border-radius:8px; border:1px solid #e0e0e0; padding:16px; display:flex; flex-direction:column; gap:10px; transition: box-shadow 0.2s;">` +
            `<div style="display:flex; justify-content:space-between; align-items:center;">` +
                `<div style="font-weight:700; font-size:1.05em; color:#333;">${escapeHtml(firstName)}</div>` +
                `<div style="font-size:0.8em; font-weight:600; padding:3px 10px; border-radius:12px; color:${badge.color}; background:${badge.bg};">${badge.icon} ${badge.label}</div>` +
            `</div>` +
            jumpHtml +
            `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">` +
                `<div><div style="font-weight:600; font-size:0.8em; color:#666; margin-bottom:4px;">Wins</div>${winsHtml}</div>` +
                `<div><div style="font-weight:600; font-size:0.8em; color:#666; margin-bottom:4px;">Opportunities</div>${oppsHtml}</div>` +
            `</div>` +
            focalHtml +
            `<div style="display:flex; gap:8px; margin-top:auto;">` +
                `<button type="button" class="pulse-checkin-btn" data-employee="${escapeHtml(emp.name)}" ` +
                    `style="flex:1; background:linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">\uD83D\uDCAC Check-in</button>` +
                `<button type="button" class="pulse-highfive-btn" data-employee="${escapeHtml(emp.name)}" ` +
                    `style="flex:1; background:linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">\uD83C\uDF89 High-Five</button>` +
            `</div>` +
        `</div>`;
    }

    // --- Check-in message generation ---

    async function generateCheckinMessage(employeeName, latestKey, baselineKey) {
        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const endDate = getEndDateLabel(latestKey, period);

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        if (!analysis) return null;

        const allMetrics = analysis.allMetrics || [];

        // Week trajectory
        const weekDeltas = baselineKey ? calcWeekDeltas(employeeName, baselineKey, latestKey) : [];
        const biggestJump = getBiggestJump(weekDeltas);

        const wins = allMetrics
            .filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track')
            .sort((a, b) => {
                if (a.classification !== b.classification) return a.classification === 'Exceeding Expectation' ? -1 : 1;
                const mA = a.targetType === 'min' ? a.employeeValue - a.target : a.target - a.employeeValue;
                const mB = b.targetType === 'min' ? b.employeeValue - b.target : b.target - b.employeeValue;
                return mB - mA;
            })
            .slice(0, 2);

        const focalPoint = pickFocalPoint(allMetrics);

        // Build praise — lead with biggest jump if we have trajectory data
        let praiseText = '';
        if (biggestJump && biggestJump.delta > 0) {
            praiseText = `You made the biggest jump in ${biggestJump.label} this week \u2014 ${fmtDelta(biggestJump.metricKey, biggestJump.delta)}! (${fmtVal(biggestJump.metricKey, biggestJump.baseValue)} \u2192 ${fmtVal(biggestJump.metricKey, biggestJump.latestValue)}) \uD83D\uDD25`;
            if (wins.length > 0 && wins[0].metricKey !== biggestJump.metricKey) {
                praiseText += ` Plus you're solid on ${wins[0].label} at ${fmtVal(wins[0])}. \uD83D\uDCAA`;
            }
        } else if (wins.length >= 2) {
            praiseText = `You're rocking ${wins[0].label} at ${fmtVal(wins[0])} and ${wins[1].label} at ${fmtVal(wins[1])}! \uD83D\uDD25\uD83D\uDCAA`;
        } else if (wins.length === 1) {
            praiseText = `You're rocking ${wins[0].label} at ${fmtVal(wins[0])}! \uD83D\uDD25`;
        } else {
            praiseText = 'I see you putting in the effort and I appreciate it! \uD83D\uDE4C';
        }

        // Build focus with tip
        let focusText = '';
        if (focalPoint) {
            const metricKey = focalPoint.metricKey;
            let tipText = '';
            try {
                const allTips = typeof loadServerTips === 'function' ? await loadServerTips() : {};
                const metricTips = allTips[metricKey] || [];
                if (metricTips.length > 0) {
                    const tip = typeof selectSmartTip === 'function'
                        ? selectSmartTip({ employeeId: employeeName, metricKey, severity: 'medium', tips: metricTips })
                        : metricTips[Math.floor(Math.random() * metricTips.length)];
                    if (tip) tipText = tip;
                }
            } catch (e) { /* no tips */ }

            focusText = `\uD83C\uDFAF Your focus this week: ${focalPoint.label} (currently at ${fmtVal(focalPoint)}, target is ${fmtTarget(focalPoint)}).`;
            if (tipText) {
                const cleanTip = tipText.replace(/^(Practice this|Try this|Tip|Focus on this)\s*:\s*/i, '').trim();
                focusText += ` \uD83D\uDCA1 ${cleanTip.charAt(0).toUpperCase() + cleanTip.slice(1)}`;
            }
        }

        let message = `Hey ${firstName}! \uD83D\uDC4B Your data for the week of ${endDate} is in. ${praiseText}`;
        if (focusText) message += `\n\n${focusText}`;
        message += `\n\nKeep up the great work! \uD83D\uDE80 Let me know if you need anything.`;

        return message;
    }

    // --- Weekend High-Five message generation ---

    async function generateHighFiveMessage(employeeName, latestKey, baselineKey) {
        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const endDate = getEndDateLabel(latestKey, period);

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        if (!analysis) return null;

        const allMetrics = analysis.allMetrics || [];
        const weekDeltas = baselineKey ? calcWeekDeltas(employeeName, baselineKey, latestKey) : [];
        const biggestJump = getBiggestJump(weekDeltas);

        // Get all wins sorted by how far above target
        const wins = allMetrics
            .filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track')
            .sort((a, b) => {
                if (a.classification !== b.classification) return a.classification === 'Exceeding Expectation' ? -1 : 1;
                const mA = a.targetType === 'min' ? a.employeeValue - a.target : a.target - a.employeeValue;
                const mB = b.targetType === 'min' ? b.employeeValue - b.target : b.target - b.employeeValue;
                return mB - mA;
            });

        // Build the celebration — no coaching, no focus areas, pure praise
        let message = `Hey ${firstName}! \uD83C\uDF89\uD83D\uDE4C`;

        if (biggestJump && biggestJump.delta > 0) {
            message += ` What a week! You made an incredible jump in ${biggestJump.label} \u2014 ${fmtDelta(biggestJump.metricKey, biggestJump.delta)}! (${fmtVal(biggestJump.metricKey, biggestJump.baseValue)} \u2192 ${fmtVal(biggestJump.metricKey, biggestJump.latestValue)}) That's the kind of growth that stands out. \uD83D\uDD25`;
        } else if (wins.length >= 2) {
            message += ` What a week! Your ${wins[0].label} at ${fmtVal(wins[0])} and ${wins[1].label} at ${fmtVal(wins[1])} were outstanding! \uD83D\uDD25\uD83D\uDCAA`;
        } else if (wins.length === 1) {
            message += ` What a week! Your ${wins[0].label} at ${fmtVal(wins[0])} was outstanding! \uD83D\uDD25`;
        } else {
            message += ` I wanted to take a second to recognize your effort this week. You showed up and put in the work, and that matters. \uD83D\uDCAA`;
        }

        // Add more wins if available
        if (wins.length > 2 && biggestJump) {
            const extraWins = wins.filter(w => w.metricKey !== biggestJump.metricKey).slice(0, 2);
            if (extraWins.length > 0) {
                const extras = extraWins.map(w => `${w.label} at ${fmtVal(w)}`).join(' and ');
                message += ` On top of that, ${extras} \u2014 you're on a roll!`;
            }
        }

        // Count how many metrics are on track
        const onTrackCount = allMetrics.filter(m => m.meetsTarget).length;
        if (onTrackCount >= allMetrics.length * 0.7 && allMetrics.length > 3) {
            message += `\n\n${onTrackCount} out of ${allMetrics.length} metrics hitting target \u2014 that's consistency right there. \u2B50`;
        }

        message += `\n\nProud of you. Enjoy your weekend! \uD83D\uDE80\uD83C\uDF1F`;

        return message;
    }

    // --- Summary bar ---

    function buildSummaryBar(cardData, numUploads) {
        const counts = { red: 0, yellow: 0, green: 0, blue: 0, gray: 0 };
        cardData.forEach(d => {
            const badge = getStatusBadge(d.analysis.allMetrics || []);
            if (badge.icon.includes('\uD83D\uDD34')) counts.red++;
            else if (badge.icon.includes('\uD83D\uDFE1')) counts.yellow++;
            else if (badge.icon.includes('\uD83D\uDFE2')) counts.green++;
            else if (badge.icon.includes('\uD83D\uDD35')) counts.blue++;
            else counts.gray++;
        });

        const uploadsNote = numUploads > 1
            ? `<span style="color:#1a237e; font-weight:600;">${numUploads} uploads this week</span>`
            : '<span style="color:#999;">1 upload (no trajectory yet)</span>';

        return `<div style="display:flex; gap:16px; flex-wrap:wrap; padding:14px 18px; background:linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); border-radius:8px; margin-bottom:16px; align-items:center;">` +
            `<div style="font-weight:700; font-size:1em; color:#333;">Team Pulse</div>` +
            `<div style="display:flex; gap:12px; flex-wrap:wrap; font-size:0.9em;">` +
                (counts.red > 0 ? `<span style="color:#e53935; font-weight:600;">\uD83D\uDD34 ${counts.red} Needs Support</span>` : '') +
                (counts.yellow > 0 ? `<span style="color:#fb8c00; font-weight:600;">\uD83D\uDFE1 ${counts.yellow} Watch</span>` : '') +
                (counts.blue > 0 ? `<span style="color:#1e88e5; font-weight:600;">\uD83D\uDD35 ${counts.blue} Solid</span>` : '') +
                (counts.green > 0 ? `<span style="color:#2e7d32; font-weight:600;">\uD83D\uDFE2 ${counts.green} Crushing It</span>` : '') +
                (counts.gray > 0 ? `<span style="color:#78909c; font-weight:600;">\u26AA ${counts.gray} Steady</span>` : '') +
            `</div>` +
            `<div style="margin-left:auto; font-size:0.85em; color:#666;">${cardData.length} associates \u2022 ${uploadsNote}</div>` +
        `</div>`;
    }

    // --- Modal ---

    function showCheckinModal(employeeName, message, latestKey, baselineKey, messageType) {
        const existing = document.getElementById('pulseCheckinModal');
        if (existing) existing.remove();

        const isHighFive = messageType === 'highfive';
        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

        const titleIcon = isHighFive ? '\uD83C\uDF89' : '\uD83D\uDCAC';
        const titleText = isHighFive ? `Weekend High-Five for ${escapeHtml(firstName)}` : `Check-in for ${escapeHtml(firstName)}`;
        const copyGradient = isHighFive
            ? 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)'
            : 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)';

        const overlay = document.createElement('div');
        overlay.id = 'pulseCheckinModal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';

        overlay.innerHTML = `<div style="background:white; border-radius:12px; max-width:560px; width:100%; max-height:80vh; overflow-y:auto; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,0.3);">` +
            `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">` +
                `<h3 style="margin:0; color:#1a237e;">${titleIcon} ${titleText}</h3>` +
                `<button id="pulseCheckinClose" style="background:none; border:none; font-size:1.4em; cursor:pointer; color:#999; padding:4px 8px;">\u2715</button>` +
            `</div>` +
            `<textarea id="pulseCheckinText" style="width:100%; height:180px; padding:14px; border:1px solid #ddd; border-radius:6px; font-size:0.95em; color:#333; background:#f9f9f9; resize:vertical; font-family:inherit;">${escapeHtml(message)}</textarea>` +
            `<div style="display:flex; gap:10px; margin-top:14px;">` +
                `<button id="pulseCheckinCopy" style="flex:1; background:${copyGradient}; color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">\uD83D\uDCCB Copy to Clipboard</button>` +
                `<button id="pulseCheckinRegenerate" style="flex:1; background:#f5f5f5; color:#333; border:1px solid #ddd; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">\uD83D\uDD04 Regenerate</button>` +
            `</div>` +
        `</div>`;

        document.body.appendChild(overlay);

        document.getElementById('pulseCheckinClose').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        document.getElementById('pulseCheckinCopy').addEventListener('click', async () => {
            const textarea = document.getElementById('pulseCheckinText');
            try {
                await navigator.clipboard.writeText(textarea.value);
                if (typeof showToast === 'function') showToast('Copied!', 2000);
            } catch (e) { textarea.select(); }
        });

        const generateFn = isHighFive ? generateHighFiveMessage : generateCheckinMessage;
        document.getElementById('pulseCheckinRegenerate').addEventListener('click', async () => {
            const regenBtn = document.getElementById('pulseCheckinRegenerate');
            regenBtn.textContent = '\u23F3 Regenerating...';
            regenBtn.disabled = true;
            try {
                const newMessage = await generateFn(employeeName, latestKey, baselineKey);
                if (newMessage) {
                    document.getElementById('pulseCheckinText').value = newMessage;
                    try {
                        await navigator.clipboard.writeText(newMessage);
                        if (typeof showToast === 'function') showToast('New check-in copied!', 2000);
                    } catch (e) { /* ok */ }
                }
            } finally {
                regenBtn.textContent = '\uD83D\uDD04 Regenerate';
                regenBtn.disabled = false;
            }
        });
    }

    // --- Main render ---

    function renderMorningPulse(container) {
        if (!container) return;

        const window_ = getWeekWindow();
        if (!window_) {
            container.innerHTML = '<div style="padding:20px; color:#666; text-align:center;">No data available. Upload data first to see your Morning Pulse.</div>';
            return;
        }

        const { latestKey, baselineKey, allRecentKeys } = window_;
        const period = getPeriodData(latestKey);
        if (!period) {
            container.innerHTML = '<div style="padding:20px; color:#666; text-align:center;">Could not load period data.</div>';
            return;
        }

        const endDate = getEndDateLabel(latestKey, period);
        const employees = getFilteredEmployees(period);

        if (!employees.length) {
            container.innerHTML = '<div style="padding:20px; color:#666; text-align:center;">No team members found for the latest period.</div>';
            return;
        }

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        // Build card data for each employee
        const cardData = [];
        employees.forEach(emp => {
            const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
            if (!analysis || !analysis.allMetrics?.length) return;

            const weekDeltas = baselineKey ? calcWeekDeltas(emp.name, baselineKey, latestKey) : [];
            const biggestJump = getBiggestJump(weekDeltas);

            cardData.push({ emp, analysis, weekDeltas, biggestJump });
        });

        // Sort: needs support first, then watch, then others
        const badgePriority = { '\uD83D\uDD34': 0, '\uD83D\uDFE1': 1, '\u26AA': 2, '\uD83D\uDD35': 3, '\uD83D\uDFE2': 4 };
        cardData.sort((a, b) => {
            const ba = getStatusBadge(a.analysis.allMetrics || []);
            const bb = getStatusBadge(b.analysis.allMetrics || []);
            const pa = Object.entries(badgePriority).find(([k]) => ba.icon.includes(k));
            const pb = Object.entries(badgePriority).find(([k]) => bb.icon.includes(k));
            return (pa ? pa[1] : 5) - (pb ? pb[1] : 5);
        });

        let html = '';

        // Header
        const baseDate = baselineKey ? getEndDateLabel(baselineKey, getPeriodData(baselineKey)) : null;
        const rangeText = baseDate && baseDate !== endDate ? `${baseDate} \u2013 ${endDate}` : endDate;
        html += `<div style="margin-bottom:16px;">` +
            `<h3 style="color:#1a237e; margin:0 0 6px 0;">\u2600\uFE0F Morning Pulse \u2014 ${rangeText}</h3>` +
            `<p style="color:#666; margin:0; font-size:0.9em;">Your team's weekly trajectory at a glance. Use "Check-in" for coaching or "High-Five" for a Friday shoutout.</p>` +
        `</div>`;

        // Summary bar
        html += buildSummaryBar(cardData, allRecentKeys.length);

        // Card grid
        html += `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">`;
        cardData.forEach(d => {
            html += buildEmployeeCard(d.emp, d.analysis, d.weekDeltas, d.biggestJump);
        });
        html += `</div>`;

        container.innerHTML = html;

        // Bind check-in buttons
        container.querySelectorAll('.pulse-checkin-btn').forEach(btn => {
            btn.addEventListener('click', async function() {
                const empName = this.dataset.employee;
                const originalText = this.textContent;
                this.textContent = '\u23F3 Generating...';
                this.disabled = true;

                try {
                    const message = await generateCheckinMessage(empName, latestKey, baselineKey);
                    if (!message) {
                        if (typeof showToast === 'function') showToast('Could not generate check-in for ' + empName, 3000);
                        return;
                    }
                    showCheckinModal(empName, message, latestKey, baselineKey, 'checkin');

                    try {
                        await navigator.clipboard.writeText(message);
                        if (typeof showToast === 'function') showToast('Check-in copied to clipboard!', 3000);
                    } catch (e) { /* clipboard not available */ }
                } finally {
                    this.textContent = originalText;
                    this.disabled = false;
                }
            });
        });

        // Bind high-five buttons
        container.querySelectorAll('.pulse-highfive-btn').forEach(btn => {
            btn.addEventListener('click', async function() {
                const empName = this.dataset.employee;
                const originalText = this.textContent;
                this.textContent = '\u23F3 Generating...';
                this.disabled = true;

                try {
                    const message = await generateHighFiveMessage(empName, latestKey, baselineKey);
                    if (!message) {
                        if (typeof showToast === 'function') showToast('Could not generate high-five for ' + empName, 3000);
                        return;
                    }
                    showCheckinModal(empName, message, latestKey, baselineKey, 'highfive');

                    try {
                        await navigator.clipboard.writeText(message);
                        if (typeof showToast === 'function') showToast('High-five copied to clipboard!', 3000);
                    } catch (e) { /* clipboard not available */ }
                } finally {
                    this.textContent = originalText;
                    this.disabled = false;
                }
            });
        });
    }

    // Initialize - called when the Morning Pulse tab is activated
    function initializeMorningPulse() {
        const container = document.getElementById('morningPulseContainer');
        renderMorningPulse(container);
    }

    // Export
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.morningPulse = {
        initializeMorningPulse,
        renderMorningPulse,
        generateCheckinMessage,
        generateHighFiveMessage
    };
})();
