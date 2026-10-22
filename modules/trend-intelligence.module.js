(function() {
    'use strict';

    function _esc(val) {
        const fn = window.DevCoachModules?.sharedUtils?.escapeHtml;
        return typeof fn === 'function' ? fn(val) : String(val ?? '');
    }

    function _escAttr(val) {
        return _esc(val)
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getFilteredEmployees(week, options = {}) {
        const allEmployees = Array.isArray(week?.employees) ? week.employees : [];
        const includeFn = typeof options.isAssociateIncludedByTeamFilter === 'function'
            ? options.isAssociateIncludedByTeamFilter
            : () => true;

        return allEmployees.filter(emp => includeFn(emp?.name));
    }

    function buildExecutiveSummaryCallouts(options = {}) {
        const latestWeek = options.latestWeek;
        const centerAvg = options.centerAvg;
        const metricsRegistry = options.metricsRegistry || {};
        const isReverseMetric = typeof options.isReverseMetric === 'function' ? options.isReverseMetric : () => false;
        const formatMetricValue = typeof options.formatMetricValue === 'function' ? options.formatMetricValue : (key, value) => `${value}`;

        if (!latestWeek?.employees?.length || !centerAvg) return [];
        const filteredEmployees = getFilteredEmployees(latestWeek, options);
        if (!filteredEmployees.length) return [];

        const callouts = [];
        Object.keys(metricsRegistry).forEach(metricKey => {
            const metric = metricsRegistry[metricKey] || {};
            const centerValue = centerAvg[metricKey];
            if (centerValue === undefined || centerValue === null || centerValue === '') return;

            let best = null;
            filteredEmployees.forEach(emp => {
                const value = emp[metricKey];
                if (value === undefined || value === null || value === '') return;
                const numericValue = parseFloat(value);
                const numericCenter = parseFloat(centerValue);
                if (Number.isNaN(numericValue) || Number.isNaN(numericCenter)) return;

                const diff = isReverseMetric(metricKey) ? numericCenter - numericValue : numericValue - numericCenter;
                if (diff <= 0) return;

                if (!best || diff > best.diff) {
                    best = {
                        name: emp.name,
                        metric: metric.label || metricKey,
                        value: formatMetricValue(metricKey, numericValue),
                        center: formatMetricValue(metricKey, numericCenter),
                        diff: `+${formatMetricValue(metricKey, diff)}`,
                        rawDiff: diff,
                        metricKey
                    };
                }
            });

            if (best) callouts.push(best);
        });

        return callouts
            .sort((a, b) => b.rawDiff - a.rawDiff)
            .slice(0, 5);
    }

    function buildTeamVsCenterAnalysis(options = {}) {
        const latestWeek = options.latestWeek;
        const centerAvg = options.centerAvg;
        const metricsRegistry = options.metricsRegistry || {};
        const isReverseMetric = typeof options.isReverseMetric === 'function' ? options.isReverseMetric : () => false;
        const formatMetricValue = typeof options.formatMetricValue === 'function' ? options.formatMetricValue : (key, value) => `${value}`;

        if (!latestWeek?.employees?.length || !centerAvg) return [];
        const filteredEmployees = getFilteredEmployees(latestWeek, options);
        if (!filteredEmployees.length) return [];

        const analysis = [];
        Object.keys(metricsRegistry).forEach(metricKey => {
            const metric = metricsRegistry[metricKey] || {};
            const centerValue = centerAvg[metricKey];
            if (centerValue === undefined || centerValue === null || centerValue === '') return;

            const isCumulative = metricKey === 'reliability';
            const isSurveyWeighted = metricKey === 'cxRepOverall' || metricKey === 'fcr' || metricKey === 'overallExperience';

            let teamAvg;
            if (isCumulative) {
                // Cumulative metrics: sum across team
                teamAvg = filteredEmployees.reduce((sum, emp) => {
                    const v = parseFloat(emp[metricKey]);
                    return sum + (Number.isFinite(v) ? v : 0);
                }, 0);
                if (teamAvg === 0 && !filteredEmployees.some(emp => Number.isFinite(parseFloat(emp[metricKey])))) return;
            } else {
                // Rate metrics: weighted average by totalCalls or surveyTotal
                let wSum = 0, wCount = 0;
                filteredEmployees.forEach(emp => {
                    const v = parseFloat(emp[metricKey]);
                    if (!Number.isFinite(v)) return;
                    const tc = parseInt(emp.totalCalls, 10);
                    const st = parseInt(emp.surveyTotal, 10);
                    let w = 1;
                    if (isSurveyWeighted) {
                        w = Number.isInteger(st) && st > 0 ? st : 0;
                    } else {
                        w = Number.isInteger(tc) && tc > 0 ? tc : 1;
                    }
                    if (w > 0) { wSum += v * w; wCount += w; }
                });
                if (wCount === 0) return;
                teamAvg = wSum / wCount;
            }
            const numericCenter = parseFloat(centerValue);
            if (Number.isNaN(teamAvg) || Number.isNaN(numericCenter)) return;

            const diff = isReverseMetric(metricKey) ? numericCenter - teamAvg : teamAvg - numericCenter;
            const diffFormatted = diff > 0
                ? `+${formatMetricValue(metricKey, Math.abs(diff))} better`
                : diff < 0
                ? `-${formatMetricValue(metricKey, Math.abs(diff))} below`
                : 'at center';

            analysis.push({
                metricKey,
                metric: metric.label || metricKey,
                teamValue: formatMetricValue(metricKey, teamAvg),
                centerValue: formatMetricValue(metricKey, numericCenter),
                diff,
                diffFormatted,
                rawDiff: Math.abs(diff)
            });
        });

        return analysis.sort((a, b) => b.rawDiff - a.rawDiff);
    }

    function buildExecutiveSummarySavedNotesText(notes = {}) {
        const redFlags = String(notes.redFlags || '').trim();
        const phishing = String(notes.phishing || '').trim();

        if (!redFlags && !phishing) {
            return 'SAVED RISK NOTES:\n- No saved red flags or phishing notes.\n';
        }

        let notesText = 'SAVED RISK NOTES:\n';
        notesText += `- Red flags: ${redFlags || 'None'}\n`;
        notesText += `- Phishing attempts: ${phishing || 'None'}\n`;
        return notesText;
    }

    function buildExecutiveSummaryCopilotPrompt(input = {}) {
        return `Write a professional team email recognizing wins and providing guidance for the week ending ${input.endDate}.

${input.individualWinsText}
${input.teamPerformanceText}
${input.focusAreaText}
${input.savedNotesText}
TONE & STYLE:
- Professional and motivating
- Celebrate specific wins with names
- Frame opportunities positively
- Keep it concise (under 200 words)
- Use bullet points for wins
- Do NOT use em dashes anywhere in the email; use commas or full stops
- Use proper bullet points (•) not hyphens

SUBJECT LINE:
Team Update - Week of ${input.endDate}

Please generate the email now.`;
    }

    function collectIndividualTrendWarningsAndRationale(currentEmp, prevEmp, thirdEmp, periodLabel, context = {}) {
        const warnings = [];
        const rationale = [];
        const metricDelta = context.metricDelta || (() => 0);
        const getTrendDeltaThreshold = context.getTrendDeltaThreshold || (() => ({ value: 0, unit: '' }));
        const metricsRegistry = context.metricsRegistry || {};

        if (thirdEmp) {
            (window.CORE_PERFORMANCE_METRICS || ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht']).forEach(metricKey => {
                const a = currentEmp[metricKey];
                const b = prevEmp[metricKey];
                const c = thirdEmp[metricKey];
                if (a === undefined || b === undefined || c === undefined) return;
                const worse1 = metricDelta(metricKey, a, b) < 0;
                const worse2 = metricDelta(metricKey, b, c) < 0;
                if (!worse1 || !worse2) return;

                const metricLabel = metricsRegistry[metricKey]?.label || metricKey;
                warnings.push(`📉 3-${periodLabel} decline in ${metricLabel}. This needs immediate attention.`);
                rationale.push(`${metricLabel}: negative deltas in two consecutive ${periodLabel}-to-${periodLabel} comparisons.`);
            });
        }

        ['overallSentiment', 'overallExperience', 'fcr', 'scheduleAdherence', 'aht', 'holdTime', 'transfers'].forEach(metricKey => {
            const current = currentEmp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return;

            const delta = metricDelta(metricKey, current, prev);
            const thresholdData = getTrendDeltaThreshold(metricKey);
            if (delta >= -thresholdData.value) return;

            const metricLabel = metricsRegistry[metricKey]?.label || metricKey;
            warnings.push(`⚠️ Sudden ${periodLabel}-over-${periodLabel} drop in ${metricLabel} (${delta.toFixed(1)}${thresholdData.unit}). Needs supportive conversation.`);
            rationale.push(`${metricLabel}: delta ${delta.toFixed(1)}${thresholdData.unit} crossed alert threshold (-${thresholdData.value}${thresholdData.unit}).`);
        });

        return { warnings, rationale };
    }

    function collectIndividualTrendWinsAndRationale(employeeName, currentEmp, prevEmp, periodLabel, context = {}) {
        const wins = [];
        const rationale = [];
        const metricDelta = context.metricDelta || (() => 0);
        const metricMeetsTarget = context.metricMeetsTarget || (() => false);
        const metricsRegistry = context.metricsRegistry || {};

        const meetsAllTargets = (window.CORE_SURVEY_METRICS || ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment']).every(metricKey =>
            metricMeetsTarget(metricKey, currentEmp[metricKey])
        );

        if (meetsAllTargets) {
            wins.push(`✅ ${employeeName} is meeting all key targets. Consider recognition!`);
            rationale.push('Target consistency rule: all core target metrics are currently at or above goal.');
        }

        (window.CORE_SURVEY_METRICS || ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr']).forEach(metricKey => {
            const current = currentEmp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return;

            const delta = metricDelta(metricKey, current, prev);
            if (delta <= 5) return;

            const metricLabel = metricsRegistry[metricKey]?.label || metricKey;
            wins.push(`🎉 Strong ${periodLabel}-over-${periodLabel} improvement in ${metricLabel} (+${delta.toFixed(1)})`);
            rationale.push(`${metricLabel}: improvement delta ${delta.toFixed(1)} exceeded +5 threshold.`);
        });

        return { wins, rationale };
    }

    function buildIndividualTrendHeaderHtml(employeeName, descriptor, currentEmp, prevEmp, thirdEmp) {
        return `
<div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
<h5 style="margin-top: 0; margin-bottom: 0; color: var(--text-primary);">Individual Coaching Insights for ${_esc(employeeName)} (${descriptor.shortLabel})</h5>
<button type="button" class="trend-back-to-team-btn btn-ghost" style="font-size: 0.85em;">← Back to Team</button>
</div>
<div class="card-sunken text-secondary" style="margin-bottom: 12px; padding: 10px; font-size: 0.9em;">
<strong>Confidence:</strong> ${thirdEmp ? 'High' : 'Medium'} • Current window: ${currentEmp.periodsIncluded} ${currentEmp.periodsIncluded === 1 ? 'period' : 'periods'} • Comparison window: ${prevEmp.periodsIncluded}
</div>`;
    }

    function buildIndividualTrendBriefSummaryHtml(currentEmp, prevEmp, descriptor, context = {}) {
        const metricDelta = context.metricDelta || (() => 0);
        const metricsRegistry = context.metricsRegistry || {};
        const trackedMetrics = window.CORE_PERFORMANCE_METRICS || ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht'];

        const deltas = trackedMetrics.map(metricKey => {
            const currentValue = parseFloat(currentEmp?.[metricKey]);
            const previousValue = parseFloat(prevEmp?.[metricKey]);
            if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return null;
            return {
                metricKey,
                label: metricsRegistry[metricKey]?.label || metricKey,
                delta: metricDelta(metricKey, currentValue, previousValue)
            };
        }).filter(Boolean);

        if (!deltas.length) return '';

        const strongest = deltas.slice().sort((a, b) => b.delta - a.delta)[0] || null;
        const weakest = deltas.slice().sort((a, b) => a.delta - b.delta)[0] || null;
        // metricDelta is normalized to performance, so a positive delta on
        // Handle Time means the number came DOWN. Saying "trending up" here
        // would report that win as its opposite. Same trap as Q1 Review's
        // arrows. Word it by verdict and let metric-movement say which way
        // the figure actually moved.
        const movement = window.DevCoachModules?.metricMovement;
        const moved = (m, direction) => movement
            ? ` (${movement.describe(m.metricKey, direction, null).movementWord})`
            : '';
        const improvementText = strongest && strongest.delta > 0
            ? `${strongest.label} is improving by ${strongest.delta.toFixed(1)}${moved(strongest, 'improving')}.`
            : 'No clear positive movement this cycle.';
        const downfallText = weakest && weakest.delta < 0
            ? `${weakest.label} is getting worse by ${Math.abs(weakest.delta).toFixed(1)}${moved(weakest, 'declining')}.`
            : 'No meaningful declines detected this cycle.';

        return `<div class="card-sunken" style="margin-bottom: 15px; padding: 12px;">
            <div class="text-primary" style="font-weight: 700; margin-bottom: 8px;">Quick Summary (${descriptor.shortLabel})</div>
            <div style="display: grid; gap: 6px; font-size: 0.92em;">
                <div><strong>Improvement:</strong> ${_esc(improvementText)}</div>
                <div><strong>Downfall:</strong> ${_esc(downfallText)}</div>
            </div>
        </div>`;
    }

    // tone: 'good' | 'warn' | 'bad' | 'info', the kit's state colours.
    function buildIndividualTrendItemsSectionHtml(title, tone, items) {
        if (!items.length) return '';
        let html = `<div style="margin-bottom: 15px;">`;
        html += `<div class="tone-${tone}" style="font-weight: 600; margin-bottom: 8px;">${title}</div>`;
        items.forEach(item => {
            html += `<div class="callout callout-${tone}" style="padding: 10px; margin-bottom: 6px;">${item}</div>`;
        });
        html += `</div>`;
        return html;
    }

    function buildIndividualTrendCoachingImpactHtml(coachingImpact) {
        if (!coachingImpact) return '';

        const impactTone = coachingImpact.status === 'positive' ? 'good' : coachingImpact.status === 'negative' ? 'bad' : 'warn';
        const impactLabel = coachingImpact.status === 'positive' ? 'Coaching approach is working' : coachingImpact.status === 'negative' ? 'Coaching approach may need adjustment' : 'Mixed coaching impact';

        let html = `<div style="margin-bottom: 15px;">`;
        html += `<div class="tone-${impactTone}" style="font-weight: 600; margin-bottom: 8px;">Coaching Impact Score</div>`;
        html += `<div class="callout callout-${impactTone}" style="padding: 10px; margin-bottom: 6px;">`;
        html += `<strong>${coachingImpact.score}/100</strong> • ${impactLabel} (based on ${coachingImpact.metricCount} coached metrics since ${new Date(coachingImpact.generatedAt).toLocaleDateString()})`;
        if (coachingImpact.details.length) {
            html += `<div style="margin-top: 6px;">${coachingImpact.details.join(' • ')}</div>`;
        }
        html += `</div></div>`;
        return html;
    }

    function buildIndividualTrendNoSignalsHtml(employeeName, warnings, wins) {
        if (warnings.length > 0 || wins.length > 0) return '';
        return `<div style="color: var(--text-secondary); padding: 15px; background: var(--bg-surface-raised); border-radius: 6px; text-align: center;"><p style="margin: 0;">📊 No significant trends detected this period. ${_esc(employeeName)} is performing steadily.</p></div>`;
    }

    function renderIndividualTrendAnalysis(container, employeeName, keys, periodType = 'wow', context = {}) {
        const getTrendComparisonBuckets = context.getTrendComparisonBuckets || (() => ({ currentKeys: [], previousKeys: [], thirdKeys: [], descriptor: { compareLabel: 'period', label: 'period', shortLabel: 'WoW' } }));
        const buildEmployeeAggregateForPeriod = context.buildEmployeeAggregateForPeriod || (() => null);
        const calculateCoachingImpact = context.calculateCoachingImpact || (() => null);

        const buckets = getTrendComparisonBuckets(keys, periodType);
        const periodLabel = buckets.descriptor.compareLabel;
        const currentEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.currentKeys);
        const prevEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.previousKeys);
        const thirdEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.thirdKeys);

        if (!currentEmp) {
            container.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.95em;">Selected employee has no data in the selected comparison window.</div>';
            return;
        }

        if (!prevEmp) {
            container.innerHTML = `<div style="color: var(--text-secondary); font-size: 0.95em;">Not enough data for ${buckets.descriptor.label} analysis. Add more historical data.</div>`;
            return;
        }

        const warningInsights = collectIndividualTrendWarningsAndRationale(currentEmp, prevEmp, thirdEmp, periodLabel, context);
        const winInsights = collectIndividualTrendWinsAndRationale(employeeName, currentEmp, prevEmp, periodLabel, context);
        const warnings = warningInsights.warnings;
        const wins = winInsights.wins;
        const rationale = [...warningInsights.rationale, ...winInsights.rationale];

        const coachingImpact = calculateCoachingImpact(employeeName, currentEmp);

        let html = `<div style="background: var(--bg-surface); padding: 20px; border-radius: 8px; border: 1px solid var(--border);">`;
        html += buildIndividualTrendHeaderHtml(employeeName, buckets.descriptor, currentEmp, prevEmp, thirdEmp);
        html += buildIndividualTrendBriefSummaryHtml(currentEmp, prevEmp, buckets.descriptor, context);
        html += buildIndividualTrendItemsSectionHtml('Attention Needed:', 'bad', warnings);
        html += buildIndividualTrendItemsSectionHtml('Wins & Strengths:', 'good', wins);
        html += buildIndividualTrendCoachingImpactHtml(coachingImpact);

        if (rationale.length > 0) {
            html += `<div style="margin-bottom: 15px;">`;
            html += `<div class="text-secondary" style="font-weight: 600; margin-bottom: 8px;">Why these insights fired</div>`;
            rationale.slice(0, 3).forEach(item => {
                html += `<div class="callout" style="padding: 10px; margin-bottom: 6px;">${item}</div>`;
            });
            html += `</div>`;
        }

        html += buildIndividualTrendNoSignalsHtml(employeeName, warnings, wins);

        html += `<div class="callout callout-info" style="margin-top: 15px; padding: 12px;">`;
        html += `<strong>Next Step:</strong> Click "Generate Individual Coaching Email" to create a personalized development email with specific tips and action items.`;
        html += `</div>`;
        html += `</div>`;

        container.innerHTML = html;
    }

    function hasGroupThreePeriodDecline(currentEmp, prevEmp, thirdEmp, context = {}) {
        const metricDelta = context.metricDelta || (() => 0);
        return (window.CORE_SURVEY_METRICS || ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr']).some(metricKey => {
            const a = currentEmp[metricKey];
            const b = prevEmp[metricKey];
            const c = thirdEmp[metricKey];
            if (a === undefined || b === undefined || c === undefined) return false;
            const worse1 = metricDelta(metricKey, a, b) < 0;
            const worse2 = metricDelta(metricKey, b, c) < 0;
            return worse1 && worse2;
        });
    }

    function hasGroupSuddenDrop(currentEmp, prevEmp, context = {}) {
        const metricDelta = context.metricDelta || (() => 0);
        return (window.CORE_SURVEY_METRICS || ['overallSentiment', 'overallExperience', 'fcr', 'scheduleAdherence']).some(metricKey => {
            const current = currentEmp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return false;
            const delta = metricDelta(metricKey, current, prev);
            return delta < -4;
        });
    }

    function hasGroupImprovement(currentEmp, prevEmp, context = {}) {
        const metricDelta = context.metricDelta || (() => 0);
        return (window.CORE_SURVEY_METRICS || ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr']).some(metricKey => {
            const current = currentEmp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return false;
            const delta = metricDelta(metricKey, current, prev);
            return delta > 5;
        });
    }

    function isGroupConsistentPerformer(currentEmp, context = {}) {
        const metricMeetsTarget = context.metricMeetsTarget || (() => false);
        return (window.CORE_SURVEY_METRICS || ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment']).every(metricKey =>
            metricMeetsTarget(metricKey, currentEmp[metricKey])
        );
    }

    function classifyGroupTrendEmployee(teamInsights, employeeName, currentEmp, prevEmp, thirdEmp, context = {}) {
        if (thirdEmp && hasGroupThreePeriodDecline(currentEmp, prevEmp, thirdEmp, context)) {
            teamInsights.atRisk.push(employeeName);
            return;
        }

        if (hasGroupSuddenDrop(currentEmp, prevEmp, context)) {
            teamInsights.declining.push(employeeName);
            return;
        }

        if (hasGroupImprovement(currentEmp, prevEmp, context)) {
            teamInsights.improving.push(employeeName);
            return;
        }

        if (isGroupConsistentPerformer(currentEmp, context)) {
            teamInsights.consistent.push(employeeName);
        }
    }

    function buildGroupTrendHeaderHtml(buckets) {
        let html = `<h5 style="margin-top: 0; color: var(--text-primary);">Team-Wide Trend Analysis (${buckets.descriptor.shortLabel})</h5>`;
        html += `<div class="card-sunken text-secondary" style="margin-bottom: 12px; padding: 10px; font-size: 0.9em;">`;
        html += `<strong>Confidence:</strong> ${buckets.thirdKeys.length ? 'High' : 'Medium'} • Current window periods: ${buckets.currentKeys.length} • Comparison window periods: ${buckets.previousKeys.length}`;
        html += `</div>`;
        return html;
    }

    function buildGroupTrendSummaryCardsHtml(teamInsights) {
        let html = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px;">`;

        html += `<div class="callout callout-bad" style="padding: 15px; text-align: center;">`;
        html += `<div class="tone-bad" style="font-size: 2em; font-weight: bold;">${teamInsights.atRisk.length}</div>`;
        html += `<div class="text-secondary" style="font-size: 0.9em;">At Risk (3-period decline)</div>`;
        html += `</div>`;

        html += `<div class="callout callout-warn" style="padding: 15px; text-align: center;">`;
        html += `<div class="tone-warn" style="font-size: 2em; font-weight: bold;">${teamInsights.declining.length}</div>`;
        html += `<div class="text-secondary" style="font-size: 0.9em;">Declining (needs attention)</div>`;
        html += `</div>`;
        html += `</div>`;

        return html;
    }

    function buildGroupTrendBriefSummaryHtml(teamInsights, descriptor) {
        const downfalls = teamInsights.atRisk.concat(teamInsights.declining);
        const improvements = teamInsights.improving;
        const improvementExamples = improvements.slice(0, 3);
        const downfallExamples = downfalls.slice(0, 3);
        const chipsHtml = (names) => {
            if (!names.length) return '';
            return `<span style="display: inline-flex; gap: 6px; flex-wrap: wrap; vertical-align: middle;">${names.map(name => `<button type="button" class="trend-drilldown-btn btn-secondary" data-trend-associate="${_escAttr(name)}" style="border-radius: 999px; padding: 2px 8px; min-height: 0; font-size: 0.8em;">${_esc(name)}</button>`).join('')}</span>`;
        };

        return `<div class="card-sunken" style="margin-bottom: 15px; padding: 12px;">
            <div class="text-primary" style="font-weight: 700; margin-bottom: 8px;">Team Summary (${descriptor.shortLabel})</div>
            <div style="display: grid; gap: 6px; font-size: 0.92em;">
                <div><strong>Improvements:</strong> ${improvements.length} associate${improvements.length === 1 ? '' : 's'} improving${improvementExamples.length ? ` (${chipsHtml(improvementExamples)})` : ''}.</div>
                <div><strong>Downfalls:</strong> ${downfalls.length} associate${downfalls.length === 1 ? '' : 's'} need attention${downfallExamples.length ? ` (${chipsHtml(downfallExamples)})` : ''}.</div>
            </div>
        </div>`;
    }

    // tone: 'good' | 'warn' | 'bad' | 'info', the kit's state colours.
    function buildGroupTrendNamedSectionHtml(title, tone, names) {
        if (!names.length) return '';
        let html = `<div style="margin-bottom: 15px;">`;
        html += `<div class="tone-${tone}" style="font-weight: 600; margin-bottom: 8px;">${title}</div>`;
        html += `<div class="callout callout-${tone}" style="padding: 12px; display: flex; gap: 8px; flex-wrap: wrap;">`;
        names.forEach(name => {
            html += `<button type="button" class="trend-drilldown-btn btn-secondary" data-trend-associate="${_escAttr(name)}" title="Open ${_esc(name)} trend detail" style="border-radius: 999px; padding: 6px 10px; font-size: 0.86em;">${_esc(name)}</button>`;
        });
        html += `</div></div>`;
        return html;
    }

    function renderGroupTrendAnalysis(container, keys, periodType = 'wow', context = {}) {
        const getTrendComparisonBuckets = context.getTrendComparisonBuckets || (() => ({ currentKeys: [], previousKeys: [], thirdKeys: [], descriptor: { label: 'period', shortLabel: 'WoW' } }));
        const getEmployeeNamesForPeriod = context.getEmployeeNamesForPeriod || (() => new Set());
        const buildEmployeeAggregateForPeriod = context.buildEmployeeAggregateForPeriod || (() => null);

        const buckets = getTrendComparisonBuckets(keys, periodType);

        if (!buckets.currentKeys.length || !buckets.previousKeys.length) {
            container.innerHTML = `<div style="color: var(--text-secondary); font-size: 0.95em;">Not enough data for ${buckets.descriptor.label} group analysis.</div>`;
            return;
        }

        const teamInsights = {
            atRisk: [],
            declining: [],
            improving: [],
            consistent: []
        };

        const employeeNames = Array.from(getEmployeeNamesForPeriod(buckets.currentKeys));

        employeeNames.forEach(employeeName => {
            const currentEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.currentKeys);
            const prevEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.previousKeys);
            if (!prevEmp) return;

            const thirdEmp = buckets.thirdKeys.length
                ? buildEmployeeAggregateForPeriod(employeeName, buckets.thirdKeys)
                : null;

            classifyGroupTrendEmployee(teamInsights, employeeName, currentEmp, prevEmp, thirdEmp, context);
        });

        let html = `<div style="background: var(--bg-surface); padding: 20px; border-radius: 8px; border: 1px solid var(--border);">`;
        html += buildGroupTrendHeaderHtml(buckets);
        html += buildGroupTrendSummaryCardsHtml(teamInsights);
        html += buildGroupTrendBriefSummaryHtml(teamInsights, buckets.descriptor);
        html += buildGroupTrendNamedSectionHtml('At Risk - Need Immediate Coaching:', 'bad', teamInsights.atRisk);
        html += buildGroupTrendNamedSectionHtml('Declining - Watch Closely:', 'warn', teamInsights.declining);
        html += buildGroupTrendNamedSectionHtml('Improving - Recognize Progress:', 'good', teamInsights.improving);
        html += buildGroupTrendNamedSectionHtml('Consistent Performers:', 'info', teamInsights.consistent);

        html += `<div class="card-sunken text-secondary" style="margin-top: 8px; margin-bottom: 15px; padding: 10px; font-size: 0.9em;">`;
        html += `<strong>Drill Down:</strong> click any associate above to jump into individual ${buckets.descriptor.shortLabel} insights.`;
        html += `</div>`;

        html += `<div class="callout callout-info" style="margin-top: 15px; padding: 12px;">`;
        html += `<strong>Next Step:</strong> Click "Generate Group Email" to create a team-wide communication highlighting trends, celebrating wins, and sharing helpful tips for common opportunities.`;
        html += `</div>`;
        html += `</div>`;

        container.innerHTML = html;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.trendIntelligence = {
        buildExecutiveSummaryCallouts,
        buildTeamVsCenterAnalysis,
        buildExecutiveSummarySavedNotesText,
        buildExecutiveSummaryCopilotPrompt,
        collectIndividualTrendWarningsAndRationale,
        collectIndividualTrendWinsAndRationale,
        buildIndividualTrendHeaderHtml,
        buildIndividualTrendItemsSectionHtml,
        buildIndividualTrendCoachingImpactHtml,
        buildIndividualTrendNoSignalsHtml,
        renderIndividualTrendAnalysis,
        hasGroupThreePeriodDecline,
        hasGroupSuddenDrop,
        hasGroupImprovement,
        isGroupConsistentPerformer,
        classifyGroupTrendEmployee,
        buildGroupTrendHeaderHtml,
        buildGroupTrendSummaryCardsHtml,
        buildGroupTrendNamedSectionHtml,
        renderGroupTrendAnalysis
    };
})();