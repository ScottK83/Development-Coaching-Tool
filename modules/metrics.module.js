(function() {
    'use strict';

    // ============================================
    // PHASE 1 - METRICS SCORING & ANALYSIS
    // ============================================

    // Metric targets and rating bands moved to metric-profiles.module.js
    // This module uses those as dependencies

    function getMetricRatingScore(metricKey, value, year) {
        const profileModule = window.DevCoachModules?.metricProfiles;
        if (profileModule?.getRatingScore) {
            const moduleScore = profileModule.getRatingScore(metricKey, value, year);
            if (moduleScore !== null && moduleScore !== undefined) return moduleScore;
        }
        return null; // Fallback: not found
    }

    function getRatingBandRowColor(metricKey, value, year) {
        const score = getMetricRatingScore(metricKey, value, year);
        if (score === 3) return '#d4edda';
        if (score === 2) return '#fff3cd';
        if (score === 1) return '#f8d7da';
        return null;
    }

    // NOTE: This function is duplicated in metric-trends, monday-morning-post,
    // and executive-summary modules. This is the canonical version (exported).
    // Future: other modules should import from here instead of re-defining.
    function isReverseMetric(metricKey) {
        // Lower is better for these metrics
        const reverseMetrics = ['transfers', 'transfersCount', 'aht', 'holdTime', 'acw', 'reliability'];
        return reverseMetrics.includes(metricKey);
    }

    function isMetricMeetingTarget(metricKey, value, target) {
        if (value === undefined || value === null || value === '') return false;
        const isReverse = isReverseMetric(metricKey);
        if (isReverse) {
            return value <= target;
        }
        return value >= target;
    }

    function formatMetricValue(key, value) {
        if (value === undefined || value === null || value === '') return 'N/A';
        const num = parseFloat(value);
        if (isNaN(num)) return 'N/A';
        
        const metric = METRICS_REGISTRY?.[key];
        const unit = metric?.unit || '%';

        if (unit === '%') return num.toFixed(1) + '%';
        if (unit === 'sec') return Math.round(num) + 's';
        if (unit === 'hrs') return num.toFixed(2) + 'h';
        if (unit === '#') return Math.round(num);
        
        return num.toFixed(1);
    }

    function formatMetricDisplay(key, value) {
        if (value === undefined || value === null || value === '') return 'N/A';
        const num = parseFloat(value);
        if (isNaN(num)) return 'N/A';
        
        const metric = METRICS_REGISTRY?.[key];
        const unit = metric?.unit || '%';

        if (unit === '%') return num.toFixed(1) + '%';
        if (unit === 'sec') return Math.round(num) + ' sec';
        if (unit === 'hrs') return num.toFixed(2) + ' hrs';
        if (unit === '#') return Math.round(num).toString();
        
        return num.toFixed(1);
    }

    function getMetricTarget(metricKey, year = null) {
        // Try to get from metric-profiles module first
        const profileModule = window.DevCoachModules?.metricProfiles;
        if (profileModule?.getYearTarget) {
            const yearTarget = profileModule.getYearTarget(metricKey, year);
            if (yearTarget) return yearTarget;
        }

        // Fallback to METRICS_REGISTRY
        const metric = METRICS_REGISTRY?.[metricKey];
        return metric?.target?.value || 0;
    }

    function metricMeetsTarget(key, value) { return typeof window.metricMeetsTarget === 'function' ? window.metricMeetsTarget(key, value) : false; }
    function metricGapToTarget(key, value) { return typeof window.metricGapToTarget === 'function' ? window.metricGapToTarget(key, value) : 0; }
    function metricDelta(key, current, previous) { return typeof window.metricDelta === 'function' ? window.metricDelta(key, current, previous) : 0; }

    function getMetricSeverity(metricKey, value) {
        const gap = Math.abs(metricGapToTarget(metricKey, value));
        const unit = METRICS_REGISTRY?.[metricKey]?.unit || '%';
        if (unit === 'sec') {
            if (gap > 25) return 'high';
            if (gap > 10) return 'medium';
            return 'low';
        }
        if (unit === 'hrs') {
            if (gap > 3) return 'high';
            if (gap > 1) return 'medium';
            return 'low';
        }
        if (gap > 5) return 'high';
        if (gap > 2) return 'medium';
        return 'low';
    }

    function getCenterAverageForMetric(centerAvg, metricKey) {
        if (!centerAvg || centerAvg === '') return 0;
        const value = parseFloat(centerAvg[metricKey]);
        return isNaN(value) ? 0 : value;
    }

    // getCenterAverageForWeek: canonical version is in executive-summary.module.js
    // This stub delegates to avoid breaking callers before exec-summary loads
    function getCenterAverageForWeek(weekKey) {
        if (window.getCenterAverageForWeek && window.getCenterAverageForWeek !== getCenterAverageForWeek) {
            return window.getCenterAverageForWeek(weekKey);
        }
        return null;
    }

    // getMetricOrder: canonical version is in metric-trends.module.js
    // This delegates to the registry for accurate unit types
    function getMetricOrder() {
        var registry = window.METRICS_REGISTRY || {};
        return [
            'scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience',
            'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions',
            'transfers', 'aht', 'acw', 'holdTime', 'reliability'
        ].map(function(key) {
            var def = registry[key];
            return { key: key, label: def?.label || key, unit: def?.unit || '%' };
        });
    }

    // Export all functions
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.metrics = {
        getMetricRatingScore,
        getRatingBandRowColor,
        isReverseMetric,
        isMetricMeetingTarget,
        formatMetricValue,
        formatMetricDisplay,
        getMetricTarget,
        metricMeetsTarget,
        metricGapToTarget,
        metricDelta,
        getMetricSeverity,
        getCenterAverageForMetric,
        getCenterAverageForWeek,
        getMetricOrder
    };
})();
