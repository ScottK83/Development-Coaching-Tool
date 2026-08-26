(function () {
    'use strict';

    /**
     * UPLOAD DRIFT
     *
     * The gate between a pasted report and the stored data. Its whole job is to
     * catch the paste where the columns have shifted — the one that would
     * otherwise overwrite a good week with numbers read out of the wrong
     * column — and to stay out of the way of every other upload.
     *
     * It got that second half wrong in two ways.
     *
     * One baseline was kept for everything, written by whichever upload came
     * last. So a Tuesday "week so far" was judged against a finished week or a
     * full month, and blocked for being smaller — which is the one thing a
     * week-so-far upload is guaranteed to be. Baselines are now kept per kind
     * of upload, and a kind is only ever compared with itself.
     *
     * And the survey scores — RepSat, FCR, Overall Experience — arrive days
     * after the calls they describe. A stretch of time that just happened has
     * them blank by nature, with every operational column full. That is the
     * report telling the truth about what has come back, so it asks rather
     * than refuses. Anything wider than the survey block still stops the
     * upload dead.
     *
     * Pure: coverage and baselines go in, errors and warnings come out. The
     * storage plumbing stays in script.js.
     */

    const DRIFT_METRIC_KEYS = ['scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience', 'transfers', 'aht', 'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions', 'reliability'];

    const DRIFT_METRIC_LABELS = {
        scheduleAdherence: 'Adherence',
        cxRepOverall: 'RepSat',
        fcr: 'FCR',
        overallExperience: 'OE',
        transfers: 'Transfers',
        aht: 'AHT',
        overallSentiment: 'Sentiment',
        positiveWord: '+Word',
        negativeWord: '-Word',
        managingEmotions: 'Emotions',
        reliability: 'Reliability'
    };

    // The three that come from customer surveys rather than from the phone
    // system. They are the only metrics that legitimately empty out on their
    // own, and they empty out together.
    const SURVEY_DRIFT_KEYS = ['cxRepOverall', 'fcr', 'overallExperience'];

    // A metric counts as "was there" above this and "is gone" below the other.
    // The gap between them is deliberate: a column half full is a roster
    // question, not a mapping one, and this check should not have an opinion.
    const PRESENT = 0.8;
    const ABSENT = 0.1;

    // Fewer than this many metrics dropping at once is ordinary variation. A
    // shifted paste takes out a block of columns, not one.
    const MIN_DROPPED_TO_ACT = 3;

    // Below this many populated columns the paste is not a report at all.
    const MIN_POPULATED_COLUMNS = 3;

    const KIND_LABELS = {
        'week': 'weekly',
        'week-in-progress': 'week-so-far',
        'month-to-date': 'month-to-date',
        'month': 'monthly',
        'quarter': 'quarterly',
        'ytd': 'year-to-date',
        'daily': 'daily',
        'custom': 'custom-range'
    };

    function describeUploadKind(periodType) {
        return KIND_LABELS[periodType] || 'previous';
    }

    function labelFor(key) {
        return DRIFT_METRIC_LABELS[key] || key;
    }

    /**
     * What fraction of the roster has a real number for each metric.
     */
    function computeMetricCoverage(employees) {
        if (!Array.isArray(employees) || !employees.length) return {};
        const coverage = {};
        DRIFT_METRIC_KEYS.forEach(key => {
            const populated = employees.filter(e => {
                const v = e?.[key];
                return v !== '' && v !== null && v !== undefined && Number.isFinite(parseFloat(v));
            }).length;
            coverage[key] = populated / employees.length;
        });
        return coverage;
    }

    /**
     * Baselines, one per kind of upload.
     *
     * Older installs stored a single flat map of metric to fraction. It was
     * written by whatever was uploaded last, and that was overwhelmingly the
     * weekly paste, so it carries over as the weekly baseline instead of being
     * thrown away — throwing it away would leave the main upload unguarded
     * until the week after next.
     */
    function readBaselines(raw) {
        if (!raw) return {};
        let parsed = raw;
        if (typeof raw === 'string') {
            try { parsed = JSON.parse(raw); } catch (e) { return {}; }
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const isLegacyFlat = Object.values(parsed).some(v => typeof v === 'number');
        return isLegacyFlat ? { week: parsed } : parsed;
    }

    function writeBaseline(baselines, periodType, coverage) {
        const next = Object.assign({}, baselines || {});
        next[periodType || 'week'] = coverage || {};
        return next;
    }

    /**
     * Judge one upload against the last of its own kind.
     *
     * Returns errors, which block, and warnings, which ask.
     */
    function judgeUpload(input) {
        const employees = (input && input.employees) || [];
        const periodType = (input && input.periodType) || 'week';
        const baselines = readBaselines(input && input.baselines);

        const errors = [];
        const warnings = [];
        if (!Array.isArray(employees) || !employees.length) return { errors, warnings, coverage: {} };

        const coverage = computeMetricCoverage(employees);

        const populatedCount = Object.values(coverage).filter(c => c >= 0.5).length;
        if (populatedCount < MIN_POPULATED_COLUMNS) {
            errors.push(`Only ${populatedCount} metric column(s) detected with meaningful data. Check that you pasted the full table with headers. Column mapping may have drifted.`);
        }

        const prev = baselines[periodType];
        if (prev) {
            const dropped = DRIFT_METRIC_KEYS.filter(k =>
                (prev[k] || 0) >= PRESENT && (coverage[k] || 0) <= ABSENT
            );
            if (dropped.length >= MIN_DROPPED_TO_ACT) {
                const named = dropped.map(labelFor).join(', ');
                if (dropped.every(k => SURVEY_DRIFT_KEYS.indexOf(k) > -1)) {
                    warnings.push(`${named} are empty in this file. Survey scores land days after the calls, so that is normal for a stretch that just happened. Every other column came through.`);
                } else {
                    errors.push(`These metrics had data in your last ${describeUploadKind(periodType)} upload but are empty now: ${named}. That usually means a header changed or the wrong columns are selected.`);
                }
            }
        }

        return { errors, warnings, coverage };
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.uploadDrift = {
        DRIFT_METRIC_KEYS,
        DRIFT_METRIC_LABELS,
        SURVEY_DRIFT_KEYS,
        describeUploadKind,
        computeMetricCoverage,
        readBaselines,
        writeBaseline,
        judgeUpload
    };
})();
