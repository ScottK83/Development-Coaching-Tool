(function () {
    'use strict';

    const TARGETS_BY_YEAR = {
        2025: {
            scheduleAdherence: { type: 'min', value: 93 },
            cxRepOverall: { type: 'min', value: 80 },
            fcr: { type: 'min', value: 70 },
            transfers: { type: 'max', value: 6 },
            overallSentiment: { type: 'min', value: 88 },
            positiveWord: { type: 'min', value: 86 },
            negativeWord: { type: 'min', value: 83 },
            managingEmotions: { type: 'min', value: 95 },
            aht: { type: 'max', value: 440 },
            acw: { type: 'max', value: 60 },
            holdTime: { type: 'max', value: 30 },
            reliability: { type: 'max', value: 16 }
        },
        2026: {
            scheduleAdherence: { type: 'min', value: 93 },
            cxRepOverall: { type: 'min', value: 82 },
            transfers: { type: 'max', value: 6 },
            overallSentiment: { type: 'min', value: 88 },
            aht: { type: 'max', value: 414 },
            reliability: { type: 'max', value: 18 }
        }
    };

    const RATING_BANDS_BY_YEAR = {
        2026: {
            scheduleAdherence: {
                type: 'min',
                score3: { min: 94.5 },
                score2: { min: 92.5 }
            },
            cxRepOverall: {
                type: 'min',
                score3: { min: 84 },
                score2: { min: 81.5 }
            },
            overallSentiment: {
                type: 'min',
                score3: { min: 90 },
                score2: { min: 87.5 }
            },
            reliability: {
                type: 'max',
                score3: { max: 18 },
                score2: { max: 24 }
            },
            aht: {
                type: 'max',
                score3: { max: 414 },
                score2: { max: 434 }
            },
            transfers: {
                type: 'max',
                score3: { max: 4 },
                score2: { max: 6 }
            }
        }
    };

    function getYearTarget(metricKey, year) {
        const yearNum = parseInt(year, 10);
        if (!Number.isInteger(yearNum)) return null;
        return TARGETS_BY_YEAR[yearNum]?.[metricKey] || null;
    }

    function getRatingScore(metricKey, value, year) {
        const yearNum = parseInt(year, 10);
        const numeric = parseFloat(value);
        if (!Number.isInteger(yearNum) || Number.isNaN(numeric)) return null;

        const config = RATING_BANDS_BY_YEAR[yearNum]?.[metricKey];
        if (!config) return null;

        if (config.type === 'min') {
            if (numeric >= config.score3.min) return 3;
            if (numeric >= config.score2.min) return 2;
            return 1;
        }

        if (config.type === 'max') {
            if (numeric <= config.score3.max) return 3;
            if (numeric <= config.score2.max) return 2;
            return 1;
        }

        return null;
    }

    function getRatingBandColor(metricKey, value, year) {
        const score = getRatingScore(metricKey, value, year);
        if (score === 3) return '#d4edda';
        if (score === 2) return '#fff3cd';
        if (score === 1) return '#f8d7da';
        return null;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.metricProfiles = {
        TARGETS_BY_YEAR,
        RATING_BANDS_BY_YEAR,
        getYearTarget,
        getRatingScore,
        getRatingBandColor
    };
})();
