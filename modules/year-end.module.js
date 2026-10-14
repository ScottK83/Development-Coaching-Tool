(function() {
    'use strict';

    /**
     * Turn the internal standing into a tone instruction.
     *
     * The three track labels are a manager-facing, year-end-internal scale, and
     * associates are not meant to know it exists. This prompt writes the text
     * that goes into their review boxes, so handing the model
     * "Performance classification: Off Track." invites it to paraphrase the
     * label straight into the first sentence. The prompt also used to ask, in
     * so many words, that it "mention whether performance is on track or off
     * track naturally", which is the same leak as an explicit instruction.
     *
     * The standing still decides how the review reads. It just arrives as tone
     * rather than as a grade.
     */
    function toneFromStanding(trackLabel) {
        var label = String(trackLabel == null ? '' : trackLabel);
        if (label.indexOf('Exceptional') !== -1) {
            return 'Tone for this review: this was a strong year. Write it as clear, specific recognition of'
                + ' sustained high performance, and frame the improvement areas as fine-tuning rather than gaps.';
        }
        if (label.indexOf('Off Track') !== -1) {
            return 'Tone for this review: this year fell short of what was expected. Be direct and specific about'
                + ' what needs to change, name the shortfalls plainly, and stay professional, respectful and'
                + ' supportive throughout. Do not soften it into a positive review.';
        }
        return 'Tone for this review: this was a solid year. Write it as genuine recognition of steady'
            + ' performance, and frame the improvement areas as the next step up rather than as failures.';
    }

    /* ── Which metrics a year-end review talks about ──
     *
     * The snapshot is built in script.js off the year's newest upload. These
     * are the rules for what it may hand to the review, kept here so they can
     * be tested without standing up the whole app.
     */

    // The four a review is about, raised first. In registry order the six
    // positives were filled with adherence, transfers, handle time, hold
    // time and after call work, and rep satisfaction and sentiment, the two
    // that matter most to how a year reads, fell off the end (Scott,
    // 2026-10-14). quarter-review's CORE_METRICS, in its order.
    var CORE_REVIEW_ORDER = ['aht', 'scheduleAdherence', 'overallSentiment', 'cxRepOverall'];

    // Fewer responses than this and a survey score is not a score. The floor
    // the check-in document, the recap email and the Mid-Year scoring use.
    var MIN_SURVEYS = 3;

    /* Why a metric is left out of the year-end lists, or '' when it is not.
     *
     *   'hours'   Reliability. Hours stay out of Year-End tone and focus
     *             entirely (Scott, 2026-10-13: "Leave hours out of it"). With
     *             it in, an associate whose only miss was attendance had a
     *             review built around "Reliability: 34.5 hrs vs target 18 hrs".
     *   'surveys' A survey metric with fewer than three responses behind it.
     *             Someone nobody surveyed read "Overall Experience: 0% vs
     *             target 75%" three times over as failures. A survey nobody
     *             answered is not a bad survey result.
     */
    function reviewExclusion(metricKey, employeeRecord) {
        if (metricKey === 'reliability') return 'hours';
        var surveyed = typeof window.isSurveyWeightedMetric === 'function'
            ? window.isSurveyWeightedMetric(metricKey)
            : !!(window.SURVEY_WEIGHT_FIELD || {})[metricKey];
        if (surveyed) {
            var responses = typeof window.getSurveyWeight === 'function'
                ? window.getSurveyWeight(metricKey, employeeRecord)
                : parseInt(employeeRecord && employeeRecord.surveyTotal, 10);
            if (!(Number.isFinite(responses) && responses >= MIN_SURVEYS)) return 'surveys';
        }
        return '';
    }

    /* The four KPIs first, in the review's order, then the rest as given. */
    function orderForReview(entries) {
        var list = (entries || []).slice();
        var rank = function (e) {
            var i = CORE_REVIEW_ORDER.indexOf(e && e.key);
            return i < 0 ? CORE_REVIEW_ORDER.length : i;
        };
        return list.map(function (e, i) { return { e: e, i: i }; })
            .sort(function (a, b) { return (rank(a.e) - rank(b.e)) || (a.i - b.i); })
            .map(function (x) { return x.e; });
    }

    /* "Average Handle Time: 398s (goal 426s or lower)". The direction is
     * said, because a model told "398s vs target 426s" has to guess which
     * side of the target is the good one, and on handle time it guessed
     * wrong. */
    function metricLine(entry) {
        if (!entry) return '';
        var dir = entry.targetType === 'max' ? ' or lower' : entry.targetType === 'min' ? ' or better' : '';
        return entry.label + ': ' + entry.value + ' (goal ' + entry.target + dir + ')';
    }

    /* The quarter by quarter block, when one could be built.
     *
     * Kept as its own paragraph with its own instruction, because a model
     * handed four numbers per metric and no direction will quote the last one
     * and drop the rest, which is the snapshot this is meant to replace. */
    function progressionSection(supportData) {
        var block = (supportData && supportData.progression) || '';
        if (!block) return '';
        return '\n' + block
            + '\n\nWhen a measure moved across the year, say so with the quarters rather than quoting'
            + ' only where it finished. A year that climbed and a year that faded read the same'
            + ' from a closing figure alone.\n';
    }

    function buildCopilotPrompt(inputData, supportData, headerData) {
        return `I'm a supervisor preparing year-end review responses for ${headerData.preferredName} (${inputData.employeeName}) for ${inputData.reviewYear}.

Use this data source: ${headerData.sourceLabel} (${headerData.periodLabel}).
${toneFromStanding(headerData.trackLabel)}
Metric targets to apply: ${headerData.targetProfileLabel}.
${progressionSection(supportData)}
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
- Be clear about how the year went overall, in plain language, without grading it
- Use the associate self-review/context above when relevant, but do not copy it verbatim
- When referencing a metric, include the metric value and its goal
- This is a completed ${inputData.reviewYear} year-end review, so write in past tense when describing performance (use "was/were" not "is/are")
- Do not use present-tense timing words for performance statements (do not use "currently", "currently at", "now", or "today")
- Use the % symbol instead of writing out "percent" (example: 95%, not 95 percent)
- Box 1 should emphasize meaningful accomplishments and impact
- Box 2 must include exactly 1 or 2 future improvement areas, each specific and actionable
- Keep each box concise (about 3-6 sentences each)
- Keep reliability, attendance and hours missed out of the review
- Do NOT use em dashes; use commas or full stops
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

    /* The speech read aloud at the year-end meeting.
     *
     * A blank field leaves its line out. This used to print "Your overall
     * performance rating is: Not provided." into a script Scott reads to the
     * associate (Scott, 2026-10-14). The caller refuses to build at all
     * without a rating, so the only lines that can go are merit and bonus,
     * which some years and some people simply do not have. The opening is
     * Scott's own words and is not changed here.
     */
    function buildVerbalSummary(preferredName, reviewYear, performanceRating, meritDetails, bonusAmount) {
        var filled = function (v) { return String(v == null ? '' : v).trim(); };
        var details = [];
        if (filled(performanceRating)) details.push(`Your overall performance rating is: ${filled(performanceRating)}.`);
        if (filled(meritDetails)) details.push(`Your merit increase details are: ${filled(meritDetails)}.`);
        if (filled(bonusAmount)) details.push(`Your incentive/bonus amount is: ${filled(bonusAmount)}.`);
        return `${preferredName}, as we close out ${reviewYear}, we had a successful year, not as successful as years past. JD Power changed the way they do their awards, and it bumped us down, but we clawed up a bit.

For this review, we looked at how you stacked up with your peers, and your overall metrics were a big part of the final decision.` + (details.length ? '\n\n' + details.join('\n') : '');
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.yearEnd = {
        CORE_REVIEW_ORDER: CORE_REVIEW_ORDER.slice(),
        MIN_SURVEYS: MIN_SURVEYS,
        reviewExclusion,
        orderForReview,
        metricLine,
        buildCopilotPrompt,
        extractBoxText,
        buildVerbalSummary
    };
})();
