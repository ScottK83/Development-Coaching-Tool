(function() {
    'use strict';

    function buildCopilotPrompt(inputData, supportData, headerData) {
        return `I'm a supervisor preparing year-end review responses for ${headerData.preferredName} (${inputData.employeeName}) for ${inputData.reviewYear}.

Use this data source: ${headerData.sourceLabel} (${headerData.periodLabel}).
Performance classification: ${headerData.trackLabel}.
Metric targets to apply: ${headerData.targetProfileLabel}.

Positives to highlight:
${inputData.positivesText || supportData.fallbackPositives || '- Positive impact and steady contribution to the team.'}

Improvement areas needed:
${inputData.improvementsText || supportData.fallbackImprovements || '- Continue improving consistency in key performance metrics.'}

Additional manager context and/or associate self-review responses:
${inputData.managerContext || '- None provided.'}

Annual APS goals status (not part of weekly report):
Met goals:
${supportData.annualMetText}

Goals needing follow-up:
${supportData.annualNotMetText}

Write polished text that I can paste into these two manager review boxes:

1) Highlight significant accomplishments against your employee's goals for the year (business, development, APS principle)
2) Identify 1-2 areas for future improvement, based on this year's performance

Requirements:
- Professional, warm, and human - not robotic and not overly corporate
- Align with goals in business, development, and APS principles
- Mention whether performance is on track or off track naturally
- Use the associate self-review/context above when relevant, but do not copy it verbatim
- When referencing a metric, include the metric value and its goal
- This is a completed ${inputData.reviewYear} year-end review, so write in past tense when describing performance (use "was/were" not "is/are")
- Do not use present-tense timing words for performance statements (do not use "currently", "currently at", "now", or "today")
- Use the % symbol instead of writing out "percent" (example: 95%, not 95 percent)
- Box 1 should emphasize meaningful accomplishments and impact
- Box 2 must include exactly 1 or 2 future improvement areas, each specific and actionable
- Keep each box concise (about 3-6 sentences each)
- Do NOT use em dashes (—)
- Return in this exact format only:
Box 1 - Significant Accomplishments:
[text]

Box 2 - Future Improvement Areas:
[text]`;
    }

    function extractBoxText(responseText, boxNumber) {
        if (!responseText || (boxNumber !== 1 && boxNumber !== 2)) return '';

        const normalized = String(responseText).replace(/\r\n/g, '\n').trim();
        if (!normalized) return '';

        const lines = normalized.split('\n');
        const box1HeaderRegexes = [
            /^\s*(?:box|section|question)\s*1\b/i,
            /^\s*1\s*[\).:-]\s*(?:highlight|significant|accomplishments?)\b/i
        ];
        const box2HeaderRegexes = [
            /^\s*(?:box|section|question)\s*2\b/i,
            /^\s*2\s*[\).:-]\s*(?:identify|future|improvement)\b/i
        ];

        const findHeaderIndex = (regexes) => lines.findIndex(line => regexes.some(rx => rx.test(line)));
        const box1Index = findHeaderIndex(box1HeaderRegexes);
        const box2Index = findHeaderIndex(box2HeaderRegexes);

        if (box1Index === -1 && box2Index === -1) {
            return boxNumber === 1 ? normalized : '';
        }

        const extractSection = (startIndex, endIndex) => {
            if (startIndex < 0 || startIndex >= lines.length) return '';
            const headerLine = lines[startIndex] || '';
            const colonIndex = headerLine.indexOf(':');
            const inlineText = colonIndex >= 0 ? headerLine.slice(colonIndex + 1).trim() : '';
            const bodyLines = lines.slice(startIndex + 1, endIndex > startIndex ? endIndex : lines.length);
            return [inlineText, ...bodyLines].filter(Boolean).join('\n').trim();
        };

        if (boxNumber === 1) {
            return extractSection(box1Index, box2Index);
        }

        return extractSection(box2Index, lines.length);
    }

    function buildVerbalSummary(preferredName, reviewYear, performanceRating, meritDetails, bonusAmount) {
        return `${preferredName}, as we close out ${reviewYear}, we had a successful year, not as successful as years past. JD Power changed the way they do their awards, and it bumped us down, but we clawed up a bit.

For this review, we looked at how you stacked up with your peers, and your overall metrics were a big part of the final decision.

Your overall performance rating is: ${performanceRating}.
Your merit increase details are: ${meritDetails}.
Your incentive/bonus amount is: ${bonusAmount}.`;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.yearEnd = {
        buildCopilotPrompt,
        extractBoxText,
        buildVerbalSummary
    };
})();
