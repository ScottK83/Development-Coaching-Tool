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
     * The third way it got in the way is a roster, not a column. A Saturday is
     * worked by a handful of people, and with a handful of people most columns
     * hold nothing: no surveys came back, no call was scored for sentiment,
     * there is no reliability to speak of. Judged against a Tuesday with the
     * whole floor on it, that reads as a block of columns disappearing, which
     * is exactly the shape of the fault this gate exists to catch. It is not
     * that fault. A drifted paste loses columns while the roster stays the
     * size it was; a weekend loses people, and the columns that need volume to
     * exist go with them. So a roster far smaller than the last one of its
     * kind asks instead of refusing, and the count travels with the question
     * so it can be checked rather than waved through. The roster size is kept
     * with the baseline for that reason, and a thin upload does not overwrite
     * a full one: a weekend must not become the standard a Monday is held to.
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

    // A roster this fraction of the last one, or smaller, is a different kind
    // of day rather than a smaller version of the same one. Half is deliberate
    // and loose: a weekend is a tenth of the floor, not four fifths of it, so
    // ordinary absence never reaches this and a Saturday never misses it.
    const THIN_ROSTER_RATIO = 0.5;

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
        const byKind = isLegacyFlat ? { week: parsed } : parsed;

        // Every entry comes back as { coverage, rows }. Two older shapes feed
        // in: one flat map for everything, and one per kind. Neither recorded
        // how many people the baseline was taken from, so rows is null and the
        // roster test simply does not fire until the next upload writes one.
        const out = {};
        Object.keys(byKind).forEach(kind => {
            const entry = byKind[kind];
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
            if (entry.coverage && typeof entry.coverage === 'object') {
                out[kind] = {
                    coverage: entry.coverage,
                    rows: Number.isFinite(entry.rows) && entry.rows > 0 ? entry.rows : null
                };
            } else {
                out[kind] = { coverage: entry, rows: null };
            }
        });
        return out;
    }

    /**
     * Records what this upload looked like, unless it was a thin one.
     *
     * A weekend must not become the standard a Monday is held to. If it did,
     * the Monday after a Saturday would be compared against a roster a tenth
     * its size, every column would read as newly full rather than unchanged,
     * and the gate would have nothing left to catch a real drift with.
     */
    function writeBaseline(baselines, periodType, coverage, rows) {
        const next = Object.assign({}, baselines || {});
        const kind = periodType || 'week';
        const count = Number.isFinite(rows) && rows > 0 ? rows : null;
        const prev = readBaselines(baselines)[kind];

        if (prev && prev.rows && count && count <= prev.rows * THIN_ROSTER_RATIO) return next;

        next[kind] = { coverage: coverage || {}, rows: count };
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

        const prev = baselines[periodType];
        const prevRows = prev && prev.rows;
        const isThin = !!(prevRows && employees.length <= prevRows * THIN_ROSTER_RATIO);

        // A thin roster empties columns on its own, so the same count that
        // means "you pasted the wrong thing" on a Tuesday means "hardly anyone
        // worked" on a Sunday. It still asks, because a paste with almost
        // nothing in it is worth a second look either way. Nothing populated
        // at all is not a report on any day, so that stays a refusal.
        const populatedCount = Object.values(coverage).filter(c => c >= 0.5).length;
        if (populatedCount < MIN_POPULATED_COLUMNS) {
            const message = `Only ${populatedCount} metric column(s) detected with meaningful data. Check that you pasted the full table with headers. Column mapping may have drifted.`;
            if (isThin && populatedCount > 0) {
                warnings.push(`Only ${populatedCount} metric column(s) have data, across ${employees.length} ${employees.length === 1 ? 'person' : 'people'}. On a day only a few people work that is expected. Check the columns landed where you meant them to before you continue.`);
            } else {
                errors.push(message);
            }
        }

        if (prev) {
            const prevCoverage = prev.coverage || {};
            const dropped = DRIFT_METRIC_KEYS.filter(k =>
                (prevCoverage[k] || 0) >= PRESENT && (coverage[k] || 0) <= ABSENT
            );
            if (dropped.length >= MIN_DROPPED_TO_ACT) {
                const named = dropped.map(labelFor).join(', ');
                if (dropped.every(k => SURVEY_DRIFT_KEYS.indexOf(k) > -1)) {
                    warnings.push(`${named} are empty in this file. Survey scores land days after the calls, so that is normal for a stretch that just happened. Every other column came through.`);
                } else if (isThin) {
                    warnings.push(`${named} are empty in this file, and it covers ${employees.length} ${employees.length === 1 ? 'person' : 'people'} against ${prevRows} in your last ${describeUploadKind(periodType)} upload. On a day only a few people work there is nothing for most columns to hold. Check the names look right before you continue.`);
                } else {
                    errors.push(`These metrics had data in your last ${describeUploadKind(periodType)} upload but are empty now: ${named}. That usually means a header changed or the wrong columns are selected.`);
                }
            }
        }

        return { errors, warnings, coverage, rows: employees.length, thin: isThin };
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
