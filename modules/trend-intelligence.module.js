(function() {
    'use strict';

    function buildExecutiveSummaryCallouts(options = {}) {
        const latestWeek = options.latestWeek;
        const centerAvg = options.centerAvg;
        const metricsRegistry = options.metricsRegistry || {};
        const isReverseMetric = typeof options.isReverseMetric === 'function' ? options.isReverseMetric : () => false;
        const formatMetricValue = typeof options.formatMetricValue === 'function' ? options.formatMetricValue : (key, value) => `${value}`;

        if (!latestWeek?.employees?.length || !centerAvg) return [];

        const callouts = [];
        Object.keys(metricsRegistry).forEach(metricKey => {
            const metric = metricsRegistry[metricKey] || {};
            const centerValue = centerAvg[metricKey];
            if (centerValue === undefined || centerValue === null || centerValue === '') return;

            let best = null;
            latestWeek.employees.forEach(emp => {
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

        const analysis = [];
        Object.keys(metricsRegistry).forEach(metricKey => {
            const metric = metricsRegistry[metricKey] || {};
            const centerValue = centerAvg[metricKey];
            if (centerValue === undefined || centerValue === null || centerValue === '') return;

            const values = latestWeek.employees
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

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.trendIntelligence = {
        buildExecutiveSummaryCallouts,
        buildTeamVsCenterAnalysis,
        buildExecutiveSummarySavedNotesText,
        buildExecutiveSummaryCopilotPrompt,
        buildTodaysFocusCopilotPrompt
    };
})();