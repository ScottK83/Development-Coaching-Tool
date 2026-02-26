(function() {
    'use strict';

    // ============================================
    // SENTIMENT ANALYSIS
    // ============================================

    /**
     * Build sentiment focus areas for coaching prompt
     */
    function buildSentimentFocusAreasForPrompt(sentimentSnapshot, sentimentMetrics = null) {
        if (!sentimentSnapshot) return '';
        
        let text = '';
        const feelings = sentimentSnapshot.feelings || [];
        const concerns = sentimentSnapshot.concerns || [];
        
        if (feelings.length > 0) {
            text += `Positive feedback: ${feelings.slice(0, 2).join(', ')}\n`;
        }
        
        if (concerns.length > 0) {
            text += `Areas of concern: ${concerns.slice(0, 2).join(', ')}\n`;
        }
        
        if (sentimentMetrics) {
            if (sentimentMetrics.positiveWord) {
                text += `Positive words used: ${sentimentMetrics.positiveWord}%\n`;
            }
            if (sentimentMetrics.negativeWord) {
                text += `Negative words used: ${sentimentMetrics.negativeWord}%\n`;
            }
        }
        
        return text.trim();
    }

    /**
     * Process and store sentiment snapshot
     */
    function processSentimentData(employeeName, sentiment, timeframeStart, timeframeEnd) {
        const snapshots = window.DevCoachModules?.storage?.loadAssociateSentimentSnapshots?.() || {};
        
        if (!snapshots[employeeName]) {
            snapshots[employeeName] = [];
        }
        
        // Check if snapshot already exists
        const existingIndex = snapshots[employeeName].findIndex(s => 
            s.timeframeStart === timeframeStart && s.timeframeEnd === timeframeEnd
        );
        
        const snapshot = {
            timeframeStart,
            timeframeEnd,
            ...sentiment
        };
        
        if (existingIndex >= 0) {
            snapshots[employeeName][existingIndex] = snapshot;
        } else {
            snapshots[employeeName].push(snapshot);
        }
        
        window.DevCoachModules?.storage?.saveAssociateSentimentSnapshots?.(snapshots);
        return snapshot;
    }

    /**
     * Get sentiment trends for employee
     */
    function getSentimentTrends(employeeName) {
        const snapshots = window.DevCoachModules?.storage?.loadAssociateSentimentSnapshots?.()[employeeName] || [];
        
        if (snapshots.length === 0) return null;
        
        // Sort by date
        const sorted = [...snapshots].sort((a, b) => 
            new Date(a.timeframeEnd) - new Date(b.timeframeEnd)
        );
        
        return {
            latest: sorted[sorted.length - 1],
            previous: sorted[sorted.length - 2] || null,
            allSnapshots: sorted
        };
    }

    /**
     * Calculate sentiment score
     */
    function calculateSentimentScore(snapshot) {
        if (!snapshot) return 0;
        
        let score = 50; // Base score
        
        if (snapshot.feelings?.length > 0) {
            score += Math.min(snapshot.feelings.length * 5, 25);
        }
        
        if (snapshot.concerns?.length > 0) {
            score -= Math.min(snapshot.concerns.length * 5, 25);
        }
        
        return Math.max(0, Math.min(100, score));
    }

    function buildSentimentSummaryText(reports, helpers = {}) {
        const positive = reports?.positive;
        const negative = reports?.negative;
        const emotions = reports?.emotions;
        if (!positive || !negative || !emotions) {
            return null;
        }

        const escapeHtml = typeof helpers.escapeHtml === 'function' ? helpers.escapeHtml : (value) => String(value || '');
        const buildPositiveSection = typeof helpers.buildPositiveLanguageSentimentSection === 'function'
            ? helpers.buildPositiveLanguageSentimentSection
            : () => '';
        const buildNegativeSection = typeof helpers.buildNegativeLanguageSentimentSection === 'function'
            ? helpers.buildNegativeLanguageSentimentSection
            : () => '';
        const buildEmotionsSection = typeof helpers.buildManagingEmotionsSentimentSection === 'function'
            ? helpers.buildManagingEmotionsSentimentSection
            : () => '';

        const associateName = positive.associateName || negative.associateName || emotions.associateName || 'Unknown Associate';
        const startDate = positive.startDate || negative.startDate || emotions.startDate || 'N/A';
        const endDate = positive.endDate || negative.endDate || emotions.endDate || 'N/A';
        const dateRange = `${startDate} – ${endDate}`;

        let summary = '';
        summary += `Associate: ${escapeHtml(associateName)}\n`;
        summary += `Date Range: ${escapeHtml(dateRange)}\n\n`;
        summary += buildPositiveSection(positive, associateName);
        summary += buildNegativeSection(negative);
        summary += buildEmotionsSection(emotions);

        return {
            summary,
            associateName,
            startDate,
            endDate,
            dateRange
        };
    }

    function buildSentimentCopilotPrompt(reports, options = {}) {
        const positive = reports?.positive;
        const negative = reports?.negative;
        const emotions = reports?.emotions;
        if (!positive || !negative || !emotions) {
            return '';
        }

        const associateName = options.associateName || positive.associateName || 'the associate';
        const POSITIVE_GOAL = Number(options.POSITIVE_GOAL || 86);
        const NEGATIVE_GOAL = Number(options.NEGATIVE_GOAL || 83);
        const EMOTIONS_GOAL = Number(options.EMOTIONS_GOAL || 95);
        const MIN_PHRASE_VALUE = Number(options.MIN_PHRASE_VALUE || 0);
        const TOP_PHRASES_COUNT = Number(options.TOP_PHRASES_COUNT || 5);
        const escapeHtml = typeof options.escapeHtml === 'function' ? options.escapeHtml : (value) => String(value || '');

        let dataSummary = `DATA SUMMARY:\n\n`;
        dataSummary += `POSITIVE LANGUAGE: ${positive.callsDetected}/${positive.totalCalls} calls (${positive.percentage}%)\n`;
        dataSummary += `Goal: ${POSITIVE_GOAL}% | Status: ${positive.percentage >= POSITIVE_GOAL ? '✓ Met goal' : '✗ Below goal'}\n`;
        dataSummary += `Top 5 positive phrases they're using:\n`;

        const topPos = (positive.phrases || [])
            .filter(p => p.value > MIN_PHRASE_VALUE)
            .sort((a, b) => b.value - a.value)
            .slice(0, TOP_PHRASES_COUNT);
        topPos.forEach(p => {
            const totalCalls = Number(positive.totalCalls || 0);
            const percentageOfCalls = totalCalls > 0 ? ((p.value / totalCalls) * 100).toFixed(0) : '0';
            dataSummary += `  • "${escapeHtml(p.phrase)}" (${p.value}x / ${percentageOfCalls}% of calls)\n`;
        });
        dataSummary += `\n→ COACHING TIP: Encourage them to use these positive phrases on MORE calls (aim for 100% usage).\n`;

        dataSummary += `\nAVOIDING NEGATIVE: ${negative.callsDetected}/${negative.totalCalls} calls (${negative.percentage}%)\n`;
        dataSummary += `Goal: ${NEGATIVE_GOAL}% | Status: ${negative.percentage >= NEGATIVE_GOAL ? '✓ Met goal' : '✗ Below goal'}\n`;
        const assocNeg = (negative.phrases || [])
            .filter(p => p.speaker === 'A' && p.value > MIN_PHRASE_VALUE)
            .sort((a, b) => b.value - a.value)
            .slice(0, TOP_PHRASES_COUNT);
        if (assocNeg.length > 0) {
            dataSummary += `Top 5 negative words associate said (MUST ELIMINATE):\n`;
            assocNeg.forEach(p => {
                dataSummary += `  • "${escapeHtml(p.phrase)}" (${p.value}x)\n`;
            });
            dataSummary += `\n→ COACHING TIP: These words must be removed from their vocabulary completely. Replace with positive alternatives.\n`;
        } else {
            dataSummary += `  ✓ Minimal negative language detected\n`;
        }

        dataSummary += `\nMANAGING EMOTIONS: ${emotions.callsDetected}/${emotions.totalCalls} calls (${emotions.percentage}%)\n`;
        dataSummary += `Goal: ${EMOTIONS_GOAL}% | Status: ${emotions.percentage >= EMOTIONS_GOAL ? '✓ Met goal' : '✗ Below goal'}\n`;
        const emoDetected = (emotions.phrases || [])
            .filter(p => p.value > MIN_PHRASE_VALUE)
            .sort((a, b) => b.value - a.value)
            .slice(0, TOP_PHRASES_COUNT);
        if (emoDetected.length > 0) {
            dataSummary += `Customer emotional phrases detected:\n`;
            emoDetected.forEach(p => {
                dataSummary += `  • "${escapeHtml(p.phrase)}" (${p.value}x)\n`;
            });
        } else {
            dataSummary += `  ✓ Low emotional indicators detected\n`;
        }

        const startDate = positive.startDate || 'Unknown';
        const endDate = positive.endDate || 'Unknown';

        return `Write a brief coaching email to ${associateName} using bullet points.

SUBJECT LINE: Sentiment Summary - ${startDate} - ${endDate}

${dataSummary}

KEY COACHING POINTS TO INCLUDE:

1. POSITIVE LANGUAGE: Recognize the good phrases they're using. Encourage them to use these phrases on EVERY call (100% usage rate), not just some calls.

2. NEGATIVE LANGUAGE: These words MUST be completely eliminated from their vocabulary. Help them identify positive alternatives to replace these negative words.

3. Use the actual numbers and percentages from the data above.

FORMAT:

WHAT'S GOING WELL:
* Highlight 2-3 positive phrases they're using effectively
* Mention their current usage rate

AREA TO FOCUS ON:
* Address the negative language that needs elimination
* Be specific about which words to remove

CONCRETE ACTION FOR THIS WEEK:
* Challenge them to use positive phrases on MORE calls (aim for 100%)
* Give them 1-2 positive alternatives for the negative words they're saying

CLOSING:
* End with confidence and encouragement

Keep it under 200 words. Real tone, no corporate speak. Be direct but supportive.`;
    }

    // Export functions
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.sentiment = {
        buildSentimentFocusAreasForPrompt,
        processSentimentData,
        getSentimentTrends,
        calculateSentimentScore,
        buildSentimentSummaryText,
        buildSentimentCopilotPrompt
    };

    // Expose buildSentimentFocusAreasForPrompt to window for backward compatibility
    window.buildSentimentFocusAreasForPrompt = window.buildSentimentFocusAreasForPrompt || buildSentimentFocusAreasForPrompt;
})();
