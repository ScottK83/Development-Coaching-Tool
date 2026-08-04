(function () {
    'use strict';

    // ============================================
    // METRIC MOVEMENT MODULE
    //
    // The one place that turns "this metric moved" into words, arrows and
    // verdicts.
    //
    // Trend direction across this app is normalized to PERFORMANCE: on a
    // reverse metric like Average Handle Time, "improving" means the number
    // went DOWN. That single fact was re-interpreted independently in four
    // modules across seven branch sites, and two of them got it backwards —
    // Q1 Review printed "(trending up)" for a handle time that fell, which is
    // a genuine win reported as its opposite, in text that goes into review
    // copy.
    //
    // The rule this module exists to enforce:
    //   the ARROW follows the number, the COLOUR and WORDS follow the verdict.
    // A green ▼ on Handle Time is correct. A green ▲ contradicts the figure
    // printed next to it.
    //
    // Two layers, deliberately separate:
    //   resolveDirection() — decides improving/declining/stable from values.
    //   describe()         — renders an already-decided direction.
    // Callers that compute direction their own way (Q1 Review compares half
    // averages against a relative threshold, which is not the same question)
    // keep their own maths and use describe() for the wording. Presentation is
    // what drifted; the arithmetic legitimately differs.
    // ============================================

    var DEFAULT_STABLE_BAND = { percent: 1, sec: 8, hrs: 0.5, fallback: 1 };

    function _registry(metricKey) {
        return (window.METRICS_REGISTRY && window.METRICS_REGISTRY[metricKey]) || null;
    }

    function isReverse(metricKey) {
        // Prefer the app's own resolver so year-aware overrides win; fall back
        // to the registry flag when it isn't loaded (tests, early boot).
        if (typeof window.isReverseMetric === 'function') {
            try { return !!window.isReverseMetric(metricKey); } catch (e) { /* fall through */ }
        }
        var reg = _registry(metricKey);
        return !!(reg && reg.isReverse);
    }

    function stableBandFor(metricKey, bands) {
        var b = bands || DEFAULT_STABLE_BAND;
        var unit = (_registry(metricKey) || {}).unit || '%';
        if (unit === 'sec') return b.sec;
        if (unit === 'hrs') return b.hrs;
        if (unit === '%') return b.percent;
        return b.fallback;
    }

    // Performance-normalized delta: positive always means "better", whichever
    // way the underlying metric runs.
    function performanceDelta(metricKey, current, previous) {
        var cur = parseFloat(current);
        var prev = parseFloat(previous);
        if (!isFinite(cur) || !isFinite(prev)) return null;
        return isReverse(metricKey) ? (prev - cur) : (cur - prev);
    }

    function resolveDirection(metricKey, current, previous, bands) {
        var delta = performanceDelta(metricKey, current, previous);
        if (delta === null) return { direction: 'stable', delta: null, hasPrior: false };
        if (Math.abs(delta) < stableBandFor(metricKey, bands)) {
            return { direction: 'stable', delta: delta, hasPrior: true };
        }
        return { direction: delta > 0 ? 'improving' : 'declining', delta: delta, hasPrior: true };
    }

    /**
     * describe(metricKey, direction, delta)
     *
     * `delta` is the performance-normalized delta (positive = better). Pass
     * null when there is no prior period. Returns everything a caller needs to
     * render the move without doing any polarity reasoning of its own.
     */
    function describe(metricKey, direction, delta) {
        var reverse = isReverse(metricKey);
        var polarity = reverse ? 'lower is better' : 'higher is better';
        var amount = (delta === null || delta === undefined || !isFinite(delta))
            ? null : Math.abs(delta);

        if (direction !== 'improving' && direction !== 'declining') {
            return {
                metricKey: metricKey,
                isReverse: reverse,
                polarity: polarity,
                direction: 'stable',
                hasPrior: amount !== null,
                amount: amount,
                numberRose: null,
                movementWord: 'held steady',
                word: 'holding steady',
                verdict: 'unchanged',
                arrow: '―',
                arrowIsGood: null
            };
        }

        var improving = direction === 'improving';
        // The number rises when an improvement means "more" (normal metric) or
        // when a decline means "more" (reverse metric).
        var numberRose = reverse ? !improving : improving;

        return {
            metricKey: metricKey,
            isReverse: reverse,
            polarity: polarity,
            direction: direction,
            hasPrior: true,
            amount: amount,
            numberRose: numberRose,
            movementWord: numberRose ? 'rose' : 'fell',
            word: improving ? 'improving' : 'getting worse',
            verdict: improving ? 'better' : 'worse',
            arrow: numberRose ? '▲' : '▼',
            arrowIsGood: improving
        };
    }

    function _fmt(metricKey, value) {
        if (value === null || value === undefined) return '';
        return typeof window.formatMetricDisplay === 'function'
            ? window.formatMetricDisplay(metricKey, value)
            : String(value);
    }

    /**
     * A full sentence fragment for prompts and copy:
     *   "rose by 45s vs previous, which is worse"
     * Never leaves the reader to infer polarity, which is what tripped both
     * the Pulse focus line and the Copilot prompt.
     */
    function sentence(metricKey, direction, delta, priorLabel) {
        var d = describe(metricKey, direction, delta);
        var against = priorLabel || 'previous';
        if (d.direction === 'stable') {
            return d.hasPrior ? 'held steady vs ' + against : 'no prior period to compare';
        }
        var amount = d.amount === null ? '' : ' by ' + _fmt(metricKey, d.amount);
        return d.movementWord + amount + ' vs ' + against + ', which is ' + d.verdict;
    }

    /** Short parenthetical for tables and lists: " (improving)" / " (getting worse)". */
    function phrase(metricKey, direction) {
        var d = describe(metricKey, direction, null);
        return d.direction === 'stable' ? '' : ' (' + d.word + ')';
    }

    /**
     * Arrow markup. Arrow follows the number, colour follows the verdict.
     * `okColor` lets a caller soften the bad colour when the metric is still
     * on target (the Pulse cards use amber rather than red there).
     */
    function arrowHtml(metricKey, direction, options) {
        var opts = options || {};
        var d = describe(metricKey, direction, null);
        if (d.direction === 'stable') {
            return '<span style="color:var(--text-tertiary);" title="Holding steady">―</span>';
        }
        var color = d.arrowIsGood
            ? (opts.goodColor || 'var(--green-text)')
            : (opts.badColor || '#e53935');
        var title = d.arrowIsGood
            ? 'Improving — ' + d.movementWord
            : 'Getting worse — ' + d.movementWord;
        if (!d.arrowIsGood && opts.stillOnTarget) title += ' (still on target)';
        return '<span style="color:' + color + ';" title="' + title + '">' + d.arrow + '</span>';
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.metricMovement = {
        isReverse: isReverse,
        performanceDelta: performanceDelta,
        resolveDirection: resolveDirection,
        describe: describe,
        sentence: sentence,
        phrase: phrase,
        arrowHtml: arrowHtml,
        DEFAULT_STABLE_BAND: DEFAULT_STABLE_BAND
    };
})();
