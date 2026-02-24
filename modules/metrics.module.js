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

    function isReverseMetric(metricKey) {
        // Lower is better for these metrics
        const reverseMetrics = ['transfers', 'aht', 'holdTime', 'acw', 'reliability'];
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

    function metricMeetsTarget(metricKey, value) {
        const def = METRICS_REGISTRY?.[metricKey];
        if (!def || value === undefined || value === null || value === '') return false;
        const target = def.target?.value ?? getMetricTarget(metricKey);
        if (isReverseMetric(metricKey)) {
            return value <= target;
        }
        return value >= target;
    }

    function metricGapToTarget(metricKey, value) {
        const def = METRICS_REGISTRY?.[metricKey];
        const target = def?.target?.value ?? getMetricTarget(metricKey);
        if (value === undefined || value === null || value === '') return 0;
        return isReverseMetric(metricKey) ? (value - target) : (target - value);
    }

    function metricDelta(metricKey, current, previous) {
        if (current === undefined || previous === undefined) return 0;
        return isReverseMetric(metricKey) ? (previous - current) : (current - previous);
    }

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

    function getCenterAverageForWeek(weekKey) {
        if (!weekKey) return null;
        const weekData = window.devCoachingData?.weeks?.[weekKey];
        if (!weekData) return null;
        return weekData.centerAvg || null;
    }

    function getMetricOrder() {
        return [
            { key: 'scheduleAdherence', label: 'Schedule Adherence', unit: '%' },
            { key: 'cxRepOverall', label: 'CX Rep Overall', unit: '%' },
            { key: 'fcr', label: 'FCR', unit: '%' },
            { key: 'overallExperience', label: 'Overall Experience', unit: '%' },
            { key: 'overallSentiment', label: 'Overall Sentiment', unit: '%' },
            { key: 'positiveWord', label: 'Positive Word', unit: '#' },
            { key: 'negativeWord', label: 'Negative Word', unit: '#' },
            { key: 'managingEmotions', label: 'Managing Emotions', unit: '#' },
            { key: 'transfers', label: 'Transfers', unit: '#' },
            { key: 'aht', label: 'AHT', unit: 'sec' },
            { key: 'acw', label: 'ACW', unit: 'sec' },
            { key: 'holdTime', label: 'Hold Time', unit: 'sec' },
            { key: 'reliability', label: 'Reliability', unit: '#' }
        ];
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
