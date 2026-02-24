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

    // Export functions
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.sentiment = {
        buildSentimentFocusAreasForPrompt,
        processSentimentData,
        getSentimentTrends,
        calculateSentimentScore
    };

    // Expose buildSentimentFocusAreasForPrompt to window for backward compatibility
    window.buildSentimentFocusAreasForPrompt = window.buildSentimentFocusAreasForPrompt || buildSentimentFocusAreasForPrompt;
})();
