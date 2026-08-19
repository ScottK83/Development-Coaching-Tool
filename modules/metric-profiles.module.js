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
            fcr: { type: 'min', value: 73 },
            overallExperience: { type: 'min', value: 75 },
            transfers: { type: 'max', value: 6 },
            overallSentiment: { type: 'min', value: 88 },
            positiveWord: { type: 'min', value: 86 },
            negativeWord: { type: 'min', value: 83 },
            managingEmotions: { type: 'min', value: 95 },
            // 426 is the goal. 414 is the stretch, and lives in the rating
            // band below as the mark that earns a 3 — it is not the bar
            // everyone is judged against day to day.
            aht: { type: 'max', value: 426 },
            acw: { type: 'max', value: 60 },
            holdTime: { type: 'max', value: 30 },
            reliability: { type: 'max', value: 18 }
        }
    };

    // Year-end rating bands. Only the five metrics scored at year-end
    // (adherence, rep satisfaction, sentiment, reliability, AHT) get bands.
    // Other metrics (FCR, positive/negative word, managing emotions, ACW,
    // hold time, overall experience) are tracked but not banded for year-end.
    // Callers should use `hasRatingBand(metricKey, year)` before assuming
    // `getRatingScore` will return a value.
    const RATING_BANDS_BY_YEAR = {
        2025: {
            scheduleAdherence: {
                type: 'min',
                score3: { min: 94.5 },
                score2: { min: 92.5 }
            },
            cxRepOverall: {
                type: 'min',
                score3: { min: 82 },
                score2: { min: 79.5 }
            },
            overallSentiment: {
                type: 'min',
                score3: { min: 90 },
                score2: { min: 87.5 }
            },
            reliability: {
                type: 'max',
                score3: { max: 16 },
                score2: { max: 22 }
            },
            aht: {
                type: 'max',
                score3: { max: 428 },
                score2: { max: 448 }
            }
        },
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
            }
        }
    };

    function getYearTarget(metricKey, year) {
        const yearNum = parseInt(year, 10);
        if (!Number.isInteger(yearNum)) return null;
        return TARGETS_BY_YEAR[yearNum]?.[metricKey] || null;
    }

    /* Round a value the way it will be printed, before judging it.

       Percentages are displayed to one decimal, so 92.96 prints as "92.96 ->
       93.0%" while comparing as 92.96. Against a 93 threshold the printed value
       clears the bar and the raw one does not, and the surface then shows "93.0%"
       and "below" in the same cell. The reader cannot resolve that, because the
       second decimal is precisely what they were not given.

       Judged at display precision, a cell can always be read as written. It hands
       back at most half of the last displayed digit, which is a smaller error
       than the one it removes. Units come from the registry, which loads before
       this module, and mirror formatMetricDisplay. */
    function roundToDisplayPrecision(metricKey, value) {
        const numeric = parseFloat(value);
        if (!Number.isFinite(numeric)) return numeric;
        const registry = typeof window !== 'undefined' ? window.METRICS_REGISTRY : null;
        const unit = registry?.[metricKey]?.unit || '%';
        if (unit === 'sec' || unit === '#') return Math.round(numeric);
        if (unit === 'hrs') return Math.round(numeric * 100) / 100;
        return Math.round(numeric * 10) / 10;
    }

    // Whether a value clears the year's target, judged at display precision.
    // One place, so no two surfaces can disagree about the same number.
    function meetsYearTarget(metricKey, value, year) {
        const target = getYearTarget(metricKey, year);
        const numeric = roundToDisplayPrecision(metricKey, value);
        if (!target || !Number.isFinite(numeric) || !Number.isFinite(target.value)) return null;
        return target.type === 'max' ? numeric <= target.value : numeric >= target.value;
    }

    function getRatingScore(metricKey, value, year) {
        const yearNum = parseInt(year, 10);
        const numeric = roundToDisplayPrecision(metricKey, value);
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

    function hasRatingBand(metricKey, year) {
        const yearNum = parseInt(year, 10);
        if (!Number.isInteger(yearNum)) return false;
        return Boolean(RATING_BANDS_BY_YEAR[yearNum]?.[metricKey]);
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.metricProfiles = {
        TARGETS_BY_YEAR,
        RATING_BANDS_BY_YEAR,
        getYearTarget,
        roundToDisplayPrecision,
        meetsYearTarget,
        getRatingScore,
        getRatingBandColor,
        hasRatingBand
    };
})();
