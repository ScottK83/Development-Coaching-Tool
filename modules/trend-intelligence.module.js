(function() {
    'use strict';

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

            const values = filteredEmployees
                .map(emp => parseFloat(emp[metricKey]))
                .filter(v => !Number.isNaN(v) && v !== null && v !== undefined);
            if (values.length === 0) return;

            const teamAvg = values.reduce((sum, v) => sum + v, 0) / values.length;
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
- Do NOT use em dashes (—) anywhere in the email
- Use proper bullet points (•) not hyphens

SUBJECT LINE:
Team Update - Week of ${input.endDate}

Please generate the email now.`;
    }

    function buildTodaysFocusCopilotPrompt(input = {}) {
        return `You are a contact center supervisor drafting a short team email for the week ending ${input.endDate}.

Include:
1) Wins: highlight the strongest team win (${input.winLabel}) and why it matters.
2) Focus Areas: call out the main focus area (${input.focusLabel}) with a supportive coaching tone.
3) Callouts: recognize these teammates by name: ${input.calloutText}.
4) A clear next-step ask for the team.

Requirements:
- Keep it concise and Teams/Outlook-ready
- Use friendly, motivating language
- Include a subject line
- Do NOT use em dashes (—)
- Add a few emojis for warmth (not excessive)

Write the complete email.`;
    }

    function collectIndividualTrendWarningsAndRationale(currentEmp, prevEmp, thirdEmp, periodLabel, context = {}) {
        const warnings = [];
        const rationale = [];
        const metricDelta = context.metricDelta || (() => 0);
        const getTrendDeltaThreshold = context.getTrendDeltaThreshold || (() => ({ value: 0, unit: '' }));
        const metricsRegistry = context.metricsRegistry || {};

        if (thirdEmp) {
            ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht'].forEach(metricKey => {
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

        const meetsAllTargets = ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment'].every(metricKey =>
            metricMeetsTarget(metricKey, currentEmp[metricKey])
        );

        if (meetsAllTargets) {
            wins.push(`✅ ${employeeName} is meeting all key targets. Consider recognition!`);
            rationale.push('Target consistency rule: all core target metrics are currently at or above goal.');
        }

        ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr'].forEach(metricKey => {
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
<h5 style="margin-top: 0; color: #f5576c;">Individual Coaching Insights for ${employeeName} (${descriptor.shortLabel})</h5>
<div style="margin-bottom: 12px; padding: 10px; background: #f7f9fc; border-radius: 6px; border-left: 4px solid #607d8b; color: #455a64; font-size: 0.9em;">
<strong>Confidence:</strong> ${thirdEmp ? 'High' : 'Medium'} • Current window: ${currentEmp.periodsIncluded} ${currentEmp.periodsIncluded === 1 ? 'period' : 'periods'} • Comparison window: ${prevEmp.periodsIncluded}
</div>`;
    }

    function buildIndividualTrendItemsSectionHtml(title, titleColor, itemBorderColor, itemBgColor, items) {
        if (!items.length) return '';
        let html = `<div style="margin-bottom: 15px;">`;
        html += `<div style="font-weight: 600; color: ${titleColor}; margin-bottom: 8px;">${title}</div>`;
        items.forEach(item => {
            html += `<div style="padding: 10px; border-left: 3px solid ${itemBorderColor}; background: ${itemBgColor}; margin-bottom: 6px; border-radius: 4px;">${item}</div>`;
        });
        html += `</div>`;
        return html;
    }

    function buildIndividualTrendCoachingImpactHtml(coachingImpact) {
        if (!coachingImpact) return '';

        const impactColor = coachingImpact.status === 'positive' ? '#2e7d32' : coachingImpact.status === 'negative' ? '#c62828' : '#ef6c00';
        const impactBg = coachingImpact.status === 'positive' ? '#e8f5e9' : coachingImpact.status === 'negative' ? '#ffebee' : '#fff3e0';
        const impactLabel = coachingImpact.status === 'positive' ? 'Coaching approach is working' : coachingImpact.status === 'negative' ? 'Coaching approach may need adjustment' : 'Mixed coaching impact';

        let html = `<div style="margin-bottom: 15px;">`;
        html += `<div style="font-weight: 600; color: ${impactColor}; margin-bottom: 8px;">📌 Coaching Impact Score</div>`;
        html += `<div style="padding: 10px; border-left: 3px solid ${impactColor}; background: ${impactBg}; margin-bottom: 6px; border-radius: 4px;">`;
        html += `<strong>${coachingImpact.score}/100</strong> • ${impactLabel} (based on ${coachingImpact.metricCount} coached metrics since ${new Date(coachingImpact.generatedAt).toLocaleDateString()})`;
        if (coachingImpact.details.length) {
            html += `<div style="margin-top: 6px;">${coachingImpact.details.join(' • ')}</div>`;
        }
        html += `</div></div>`;
        return html;
    }

    function buildIndividualTrendNoSignalsHtml(employeeName, warnings, wins) {
        if (warnings.length > 0 || wins.length > 0) return '';
        return `<div style="color: #666; padding: 15px; background: #f5f5f5; border-radius: 6px; text-align: center;"><p style="margin: 0;">📊 No significant trends detected this period. ${employeeName} is performing steadily.</p></div>`;
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
            container.innerHTML = '<div style="color: #666; font-size: 0.95em;">Selected employee has no data in the selected comparison window.</div>';
            return;
        }

        if (!prevEmp) {
            container.innerHTML = `<div style="color: #666; font-size: 0.95em;">Not enough data for ${buckets.descriptor.label} analysis. Add more historical data.</div>`;
            return;
        }

        const warningInsights = collectIndividualTrendWarningsAndRationale(currentEmp, prevEmp, thirdEmp, periodLabel, context);
        const winInsights = collectIndividualTrendWinsAndRationale(employeeName, currentEmp, prevEmp, periodLabel, context);
        const warnings = warningInsights.warnings;
        const wins = winInsights.wins;
        const rationale = [...warningInsights.rationale, ...winInsights.rationale];

        const coachingImpact = calculateCoachingImpact(employeeName, currentEmp);

        let html = `<div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0;">`;
        html += buildIndividualTrendHeaderHtml(employeeName, buckets.descriptor, currentEmp, prevEmp, thirdEmp);
        html += buildIndividualTrendItemsSectionHtml('🚨 Attention Needed:', '#e53935', '#e53935', '#ffebee', warnings);
        html += buildIndividualTrendItemsSectionHtml('✨ Wins & Strengths:', '#43a047', '#43a047', '#e8f5e9', wins);
        html += buildIndividualTrendCoachingImpactHtml(coachingImpact);

        if (rationale.length > 0) {
            html += `<div style="margin-bottom: 15px;">`;
            html += `<div style="font-weight: 600; color: #455a64; margin-bottom: 8px;">🧩 Why these insights fired</div>`;
            rationale.slice(0, 3).forEach(item => {
                html += `<div style="padding: 10px; border-left: 3px solid #607d8b; background: #eceff1; margin-bottom: 6px; border-radius: 4px;">${item}</div>`;
            });
            html += `</div>`;
        }

        html += buildIndividualTrendNoSignalsHtml(employeeName, warnings, wins);

        html += `<div style="margin-top: 15px; padding: 12px; background: #fff3e0; border-radius: 6px; border-left: 4px solid #ff9800;">`;
        html += `<strong>💡 Next Step:</strong> Click "Generate Individual Coaching Email" to create a personalized development email with specific tips and action items.`;
        html += `</div>`;
        html += `</div>`;

        container.innerHTML = html;
    }

    function hasGroupThreePeriodDecline(currentEmp, prevEmp, thirdEmp, context = {}) {
        const metricDelta = context.metricDelta || (() => 0);
        return ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr'].some(metricKey => {
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
        return ['overallSentiment', 'overallExperience', 'fcr', 'scheduleAdherence'].some(metricKey => {
            const current = currentEmp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return false;
            const delta = metricDelta(metricKey, current, prev);
            return delta < -4;
        });
    }

    function hasGroupImprovement(currentEmp, prevEmp, context = {}) {
        const metricDelta = context.metricDelta || (() => 0);
        return ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr'].some(metricKey => {
            const current = currentEmp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return false;
            const delta = metricDelta(metricKey, current, prev);
            return delta > 5;
        });
    }

    function isGroupConsistentPerformer(currentEmp, context = {}) {
        const metricMeetsTarget = context.metricMeetsTarget || (() => false);
        return ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment'].every(metricKey =>
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
        let html = `<h5 style="margin-top: 0; color: #764ba2;">Team-Wide Trend Analysis (${buckets.descriptor.shortLabel})</h5>`;
        html += `<div style="margin-bottom: 12px; padding: 10px; background: #f7f9fc; border-radius: 6px; border-left: 4px solid #607d8b; color: #455a64; font-size: 0.9em;">`;
        html += `<strong>Confidence:</strong> ${buckets.thirdKeys.length ? 'High' : 'Medium'} • Current window periods: ${buckets.currentKeys.length} • Comparison window periods: ${buckets.previousKeys.length}`;
        html += `</div>`;
        return html;
    }

    function buildGroupTrendSummaryCardsHtml(teamInsights) {
        let html = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px;">`;

        html += `<div style="padding: 15px; background: linear-gradient(135deg, #e53935 0%, #ef5350 100%); color: white; border-radius: 8px; text-align: center;">`;
        html += `<div style="font-size: 2em; font-weight: bold;">${teamInsights.atRisk.length}</div>`;
        html += `<div style="font-size: 0.9em; opacity: 0.95;">At Risk (3-period decline)</div>`;
        html += `</div>`;

        html += `<div style="padding: 15px; background: linear-gradient(135deg, #fb8c00 0%, #ffa726 100%); color: white; border-radius: 8px; text-align: center;">`;
        html += `<div style="font-size: 2em; font-weight: bold;">${teamInsights.declining.length}</div>`;
        html += `<div style="font-size: 0.9em; opacity: 0.95;">Declining (needs attention)</div>`;
        html += `</div>`;
        html += `</div>`;

        return html;
    }

    function buildGroupTrendNamedSectionHtml(title, titleColor, bgColor, borderColor, names) {
        if (!names.length) return '';
        let html = `<div style="margin-bottom: 15px;">`;
        html += `<div style="font-weight: 600; color: ${titleColor}; margin-bottom: 8px;">${title}</div>`;
        html += `<div style="padding: 12px; background: ${bgColor}; border-radius: 6px; border-left: 4px solid ${borderColor};">`;
        html += names.join(', ');
        html += `</div></div>`;
        return html;
    }

    function renderGroupTrendAnalysis(container, keys, periodType = 'wow', context = {}) {
        const getTrendComparisonBuckets = context.getTrendComparisonBuckets || (() => ({ currentKeys: [], previousKeys: [], thirdKeys: [], descriptor: { label: 'period', shortLabel: 'WoW' } }));
        const getEmployeeNamesForPeriod = context.getEmployeeNamesForPeriod || (() => new Set());
        const buildEmployeeAggregateForPeriod = context.buildEmployeeAggregateForPeriod || (() => null);

        const buckets = getTrendComparisonBuckets(keys, periodType);

        if (!buckets.currentKeys.length || !buckets.previousKeys.length) {
            container.innerHTML = `<div style="color: #666; font-size: 0.95em;">Not enough data for ${buckets.descriptor.label} group analysis.</div>`;
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

        let html = `<div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0;">`;
        html += buildGroupTrendHeaderHtml(buckets);
        html += buildGroupTrendSummaryCardsHtml(teamInsights);
        html += buildGroupTrendNamedSectionHtml('🚨 At Risk - Need Immediate Coaching:', '#e53935', '#ffebee', '#e53935', teamInsights.atRisk);
        html += buildGroupTrendNamedSectionHtml('⚠️ Declining - Watch Closely:', '#fb8c00', '#fff3e0', '#fb8c00', teamInsights.declining);
        html += buildGroupTrendNamedSectionHtml('🎉 Improving - Recognize Progress:', '#43a047', '#e8f5e9', '#43a047', teamInsights.improving);
        html += buildGroupTrendNamedSectionHtml('✅ Consistent Performers:', '#1e88e5', '#e3f2fd', '#1e88e5', teamInsights.consistent);

        html += `<div style="margin-top: 15px; padding: 12px; background: #e1f5fe; border-radius: 6px; border-left: 4px solid #0288d1;">`;
        html += `<strong>💡 Next Step:</strong> Click "Generate Group Email" to create a team-wide communication highlighting trends, celebrating wins, and sharing helpful tips for common opportunities.`;
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
        buildTodaysFocusCopilotPrompt,
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