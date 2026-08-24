(function () {
    'use strict';

    /**
     * RANK PROJECTION — project the number, never the placing.
     *
     * "Four more weeks like this and you will be 18th" is a promise the data
     * cannot keep. It is arithmetic on a frozen field, and the field is never
     * frozen: the 127 people behind that placing are all working the same four
     * weeks, and half of them are pushing in the same direction. Somebody who
     * does exactly what they were told to do and lands 24th has been made a
     * liar of by their own coach, and the next thing that coach says is worth
     * less than it was.
     *
     * A projected VALUE against a named door survives that, because the door
     * barely moves even while the names behind it shuffle. Top 25 in Schedule
     * Adherence sat within a point of the same figure all year; who was
     * standing on it changed every week. So the associate-facing builders in
     * here talk about the number that clears the door, and let the placing be
     * a consequence rather than a commitment. buildPaceClause goes further and
     * drops the door too, for the messages where a placing is off the table
     * entirely.
     *
     * projectRank() is still exported, because a manager working out who to
     * spend an hour on genuinely wants to know where a plausible month would
     * land somebody. It is for that view only, and it should be read with the
     * scepticism a frozen field deserves. Nothing it returns belongs in copy
     * that reaches an associate.
     *
     * Reliability is excluded from all of it, deliberately and completely.
     * It is hours missed against an annual budget rather than an average, so
     * "average this for the next month" is a category error before it is
     * anything else, and the blend below would produce a confident, wrong
     * number rather than refusing. Beyond the arithmetic: mailing somebody a
     * projection of their attendance placing is the single line in this app
     * most likely to turn into a real problem for a real person, so the map it
     * would need to travel through simply has no entry for it.
     */

    // Center-ranking rank keys -> the METRICS_REGISTRY key each one reads from.
    // Two vocabularies had to meet somewhere: ranking calls it 'adherence' and
    // 'associateOverall', the registry calls the same things 'scheduleAdherence'
    // and 'cxRepOverall', and every module that needed both ended up writing its
    // own half-copy of this table. Reliability is the one rank key with no row
    // here, which is what stops it reaching the noise thresholds and the
    // formatters below.
    const RANK_TO_REGISTRY = {
        aht: 'aht',
        adherence: 'scheduleAdherence',
        sentiment: 'overallSentiment',
        associateOverall: 'cxRepOverall',
        fcr: 'fcr',
        overallExperience: 'overallExperience',
        transfers: 'transfers',
        positiveWord: 'positiveWord',
        negativeWord: 'negativeWord',
        managingEmotions: 'managingEmotions'
    };

    // The keys a pace story can honestly be told about: rate metrics that the
    // YTD aggregate builds as a volume-weighted average, so holding a value for
    // a stretch of periods really does move the year figure by the amount the
    // blend says it does. The extras that rank but are not scorecard KPIs are
    // left out on purpose; they are real numbers, but nobody is being coached
    // week to week against a Positive Word Usage pace.
    const PROJECTABLE_RANK_KEYS = ['adherence', 'sentiment', 'associateOverall', 'aht', 'fcr', 'overallExperience'];

    // Weighted by surveys returned rather than calls taken, matching
    // buildYtdAggregateForYear. A hundred calls with two surveys on them is two
    // survey responses worth of evidence, not a hundred.
    const SURVEY_WEIGHTED_RANK_KEYS = new Set(['associateOverall', 'fcr', 'overallExperience']);

    // Center ranking withholds a survey metric below three responses so a single
    // flawless survey cannot win a placing. The same floor applies here for the
    // same reason: projecting from a sample of one is projecting from a mood.
    const MIN_SURVEYS_TO_PROJECT = 3;

    // The tie epsilon center-ranking's _scoreAndRank uses. Two values that
    // display identically must not be split into two places, and projectRank
    // has to agree with the ranking it is standing in for or the manager view
    // shows a move that the rankings table will not show.
    const TIE_EPSILON = 1e-9;

    // Ceiling on a walk forward in periods. A year of weeks; past that the
    // honest answer is "not this year", not a bigger number.
    const DEFAULT_MAX_PERIODS = 52;

    const COUNT_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

    /* ── Small shared plumbing ── */

    // Number(null) is 0 and Number('') is 0, and a zero volume or a zero score
    // that came from a missing field is the kind of value that makes the rest of
    // this file produce confident nonsense. Everything enters through here.
    const num = (value) => {
        if (value === null || value === undefined || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    };

    const wholeAtLeastOne = (value) => {
        const n = num(value);
        if (n === null) return null;
        const whole = Math.trunc(n);
        return whole >= 1 && whole === n ? whole : null;
    };

    const registryKeyFor = (rankKey) => RANK_TO_REGISTRY[rankKey] || null;

    // Prefer the app's own resolver so a year-aware override wins, and fall back
    // to the registry flag for tests and early boot. Getting this backwards
    // sorts the slowest handle time to the top of the field, so it is worth the
    // two lookups.
    const isReverseRank = (rankKey) => {
        const registryKey = registryKeyFor(rankKey);
        if (!registryKey) return false;
        if (typeof window.isReverseMetric === 'function') {
            try { return !!window.isReverseMetric(registryKey); } catch (e) { /* fall through */ }
        }
        const registry = window.METRICS_REGISTRY && window.METRICS_REGISTRY[registryKey];
        return !!(registry && registry.isReverse);
    };

    const fmt = (registryKey, value) => (
        typeof window.formatMetricDisplay === 'function'
            ? window.formatMetricDisplay(registryKey, value)
            : String(value)
    );

    const noiseThreshold = (registryKey) => {
        if (typeof window.getMetricNoiseThreshold === 'function') {
            const threshold = num(window.getMetricNoiseThreshold(registryKey));
            if (threshold !== null) return threshold;
        }
        const helpers = window.DevCoachModules && window.DevCoachModules.metricsRegistryHelpers;
        if (helpers && typeof helpers.getMetricNoiseThreshold === 'function') {
            const threshold = num(helpers.getMetricNoiseThreshold(registryKey));
            if (threshold !== null) return threshold;
        }
        return 1;
    };

    // "Has it got there" and "is it plainly better than" are different questions
    // and the difference matters: a value sitting exactly on the goal has
    // arrived, but a value sitting exactly on the goal cannot be held to move
    // anything toward it. The blend converges on the assumed value, so an
    // assumption equal to the goal approaches it forever and never crosses.
    const hasReached = (value, goal, reverse) => (
        reverse ? value <= goal + TIE_EPSILON : value >= goal - TIE_EPSILON
    );

    const isBetterThan = (value, other, reverse) => (
        reverse ? value < other - TIE_EPSILON : value > other + TIE_EPSILON
    );

    /**
     * Where a rank key's value lives on a ranking row.
     *
     * The scorecard KPIs sit under values, the extras under extraValues, and
     * reliability on the row itself. Borrowed wholesale from
     * celebrations.getRankedValue rather than reinvented, because the two must
     * read the same number off the same row or a projection will be computed
     * from a figure the shout-out never saw.
     */
    const rankedValueFor = (row, rankKey) => {
        if (!row) return null;
        if (rankKey === 'reliability') return row.reliability === undefined ? null : row.reliability;
        const scorecard = row.values ? row.values[rankKey] : undefined;
        if (scorecard !== undefined && scorecard !== null) return scorecard;
        const extra = row.extraValues ? row.extraValues[rankKey] : undefined;
        return extra === undefined ? null : extra;
    };

    /* ── The arithmetic ── */

    /**
     * What the year figure becomes if this value is held for that much volume.
     *
     * Volume-weighted, matching buildYtdAggregateForYear, and that weighting is
     * the entire point. A straight average of "91.2% so far" and "96% next
     * month" gives 93.6% and reads like a month of good work nearly closing the
     * gap. Weighted by the four thousand calls already behind the 91.2% against
     * the four hundred in the month, it gives 91.6%, which is the truth and a
     * much harder conversation. The first version of this sum sent people after
     * a number they could not reach, and they reached the end of the month
     * having done everything asked of them and moved half a point.
     *
     * Null rather than a guess whenever an input is missing: a projection built
     * on an assumed volume is worse than no projection, because it looks the
     * same as a real one.
     */
    const projectValue = (currentValue, volumeSoFar, assumedValue, assumedVolume) => {
        const current = num(currentValue);
        const soFar = num(volumeSoFar);
        const assumed = num(assumedValue);
        const ahead = num(assumedVolume);
        if (current === null || soFar === null || assumed === null || ahead === null) return null;
        if (soFar < 0 || ahead < 0) return null;
        const total = soFar + ahead;
        if (!(total > 0)) return null;
        return (current * soFar + assumed * ahead) / total;
    };

    /**
     * The value standing at a given place in the field right now.
     *
     * Positional, not by rank number, and the difference is deliberate. With the
     * 1-2-2-4 tie rule a field can have no rank 25 at all, and a door nobody
     * occupies is not a door. The value at position 25 is the one that answers
     * the question actually being asked: beat this and you are inside the top
     * 25, whatever the ties above you are doing.
     *
     * Rows with no value for the metric are dropped rather than sunk, because a
     * blank is not a bad score and must not be counted as one of the places.
     */
    const thresholdValueForRank = (rankings, rankKey, targetRank) => {
        const wanted = wholeAtLeastOne(targetRank);
        if (wanted === null) return null;
        const rows = Array.isArray(rankings) ? rankings : [];
        const values = [];
        rows.forEach((row) => {
            const value = num(rankedValueFor(row, rankKey));
            if (value !== null) values.push(value);
        });
        if (values.length < wanted) return null;
        const reverse = isReverseRank(rankKey);
        values.sort((a, b) => (reverse ? a - b : b - a));
        return values[wanted - 1];
    };

    /**
     * Where this value would place, if nobody else moved.
     *
     * The "if nobody else moved" is the whole caveat and it is a large one, which
     * is why this is a manager-side function and nothing built on top of it
     * reaches an associate. Everything about the sort matches _scoreAndRank so
     * the answer is comparable with the rankings table: missing values sink to
     * the end and take no place, and ties share the better place under the same
     * 1-2-2-4 rule with the same epsilon.
     */
    const projectRank = (rankings, rankKey, name, newValue) => {
        const rows = Array.isArray(rankings) ? rankings : [];
        if (!name) return null;
        if (!rows.some((row) => row && row.name === name)) return null;

        const substituted = num(newValue);
        // A value that is not a number is a missing value, and center ranking
        // gives a missing value no rank at all rather than the worst one.
        if (substituted === null) return null;

        const reverse = isReverseRank(rankKey);
        const field = rows
            .filter((row) => row && row.name)
            .map((row) => ({
                name: row.name,
                value: row.name === name ? substituted : num(rankedValueFor(row, rankKey))
            }));

        field.sort((a, b) => {
            if (a.value === null && b.value === null) return 0;
            if (a.value === null) return 1;
            if (b.value === null) return -1;
            return reverse ? a.value - b.value : b.value - a.value;
        });

        let lastRank = 0;
        let lastValue = null;
        for (let i = 0; i < field.length; i++) {
            const entry = field[i];
            if (entry.value === null) break;
            const place = (i === 0 || lastValue === null || Math.abs(entry.value - lastValue) >= TIE_EPSILON)
                ? i + 1
                : lastRank;
            lastRank = place;
            lastValue = entry.value;
            if (entry.name === name) return place;
        }
        return null;
    };

    /**
     * How many periods of holding a value it takes to cross a goal.
     *
     * Walked forward one period at a time rather than solved, because the walk
     * is the thing being promised: each step is a whole period of work at the
     * assumed value, and a fractional answer would round into a number the
     * associate cannot act on. The blend is monotone, so the first crossing is
     * the smallest one.
     *
     * The degenerate cases all return something specific rather than falling
     * through to a number. Already past the goal is 0, not 1. An assumed value
     * that is not itself better than the goal is null, because the blend
     * converges on the assumed value and will approach the goal forever without
     * reaching it, and "keep this up and you will get there" would be false.
     * Nothing reachable inside maxPeriods is also null: "not this year" is a
     * real answer and dressing it up as 71 weeks is not.
     */
    const periodsToReach = (options) => {
        const opts = options || {};
        const current = num(opts.currentValue);
        const soFar = num(opts.volumeSoFar);
        const perPeriod = num(opts.volumePerPeriod);
        const assumed = num(opts.assumedValue);
        const goal = num(opts.goalValue);
        if (current === null || soFar === null || perPeriod === null || assumed === null || goal === null) return null;
        if (soFar < 0 || perPeriod <= 0) return null;

        const reverse = !!opts.isReverse;
        if (hasReached(current, goal, reverse)) return 0;
        if (!isBetterThan(assumed, goal, reverse)) return null;

        const cap = wholeAtLeastOne(opts.maxPeriods) || DEFAULT_MAX_PERIODS;
        for (let n = 1; n <= cap; n++) {
            const blended = projectValue(current, soFar, assumed, n * perPeriod);
            if (blended === null) return null;
            if (hasReached(blended, goal, reverse)) return n;
        }
        return null;
    };

    /* ── Gates ── */

    const callFloor = () => (Number.isFinite(window.MIN_CALLS_TO_JUDGE) ? window.MIN_CALLS_TO_JUDGE : 20);

    // An UNKNOWN volume passes, matching celebrations.volumeVerdict. An upload
    // without the column would otherwise silence every projection on the board
    // at once, silently, which is a far worse failure than the thin-week problem
    // the floor exists to catch.
    const clearsFloor = (raw, floor) => {
        if (raw === undefined || raw === null || raw === '') return true;
        const value = num(raw);
        if (value === null) return true;
        return value >= floor;
    };

    /**
     * Is a pace story about this metric and this row worth telling at all?
     *
     * Reliability fails on every input, by way of PROJECTABLE_RANK_KEYS: see the
     * header. The volume floors are the ones already in use elsewhere, but note
     * that Schedule Adherence is gated on calls here where celebrations treats
     * it as volume-independent. That is not an inconsistency. Celebrations is
     * asking whether the number is trustworthy evidence, and adherence measured
     * against a schedule is fine on a light week. This is asking how heavily the
     * number weighs in a call-weighted blend, and twelve calls of adherence
     * weighs almost nothing, so any pace built on it would be arithmetic
     * pretending to be a plan.
     */
    const isProjectable = (rankKey, row) => {
        if (!row) return false;
        if (PROJECTABLE_RANK_KEYS.indexOf(rankKey) === -1) return false;
        if (!clearsFloor(row.totalCalls, callFloor())) return false;
        if (SURVEY_WEIGHTED_RANK_KEYS.has(rankKey) && !clearsFloor(row.surveyTotal, MIN_SURVEYS_TO_PROJECT)) return false;
        return true;
    };

    /**
     * Is this move too small to be called a move?
     *
     * Reported progress that turns out to be a rounding wobble is worse than
     * silence, because it teaches people that the numbers in these messages do
     * not mean anything. An unmappable key or an unreadable delta answers true,
     * so the failure mode is always "say nothing" rather than "claim something".
     */
    const moveIsNoise = (rankKey, valueDelta) => {
        const delta = num(valueDelta);
        if (delta === null) return true;
        const registryKey = registryKeyFor(rankKey);
        if (!registryKey) return true;
        return Math.abs(delta) < noiseThreshold(registryKey);
    };

    /* ── Copy ── */

    const countWord = (n) => (n >= 1 && n <= 10 ? COUNT_WORDS[n] : String(n));
    const pluralNoun = (noun, n) => (n === 1 ? noun : noun + 's');
    const periodNounFrom = (opts) => (typeof opts.periodNoun === 'string' && opts.periodNoun ? opts.periodNoun : 'week');

    /**
     * The tail that gets appended to a placing.
     *
     *   "Top 25 sits at 94.6%. Four weeks at 96.0% gets you there, and holding
     *    it keeps you there."
     *
     * The door is named and the number that clears it is named, and the placing
     * itself is left as something that follows rather than something promised.
     * That second clause is doing real work: without it the sentence reads as a
     * one-off sprint, and a month of good adherence that stops the moment it is
     * reached slides straight back out of the top 25 as the rest of the year
     * dilutes it.
     *
     * Empty whenever any of it would be a guess, including when the assumed
     * value is not actually better than the door. Holding a number equal to the
     * door approaches the door and never passes it, so "gets you there" would be
     * a sentence the arithmetic disagrees with.
     */
    const buildDoorClause = (options) => {
        const opts = options || {};
        const registryKey = registryKeyFor(opts.rankKey);
        if (!registryKey || PROJECTABLE_RANK_KEYS.indexOf(opts.rankKey) === -1) return '';

        const door = num(opts.doorValue);
        const assumed = num(opts.assumedValue);
        const place = wholeAtLeastOne(opts.doorRank);
        const periods = wholeAtLeastOne(opts.periods);
        if (door === null || assumed === null || place === null || periods === null) return '';
        if (!isBetterThan(assumed, door, isReverseRank(opts.rankKey))) return '';

        const noun = periodNounFrom(opts);
        return 'Top ' + place + ' sits at ' + fmt(registryKey, door) + '. '
            + countWord(periods) + ' ' + pluralNoun(noun, periods) + ' at ' + fmt(registryKey, assumed)
            + ' gets you there, and holding it keeps you there.';
    };

    /**
     * Solve the blend backwards for the periods that would cross a target.
     *
     * buildPaceClause is handed a projection somebody else computed and no
     * volumes, so the honest way to name a second, larger number of periods is
     * to recover the volume ratio the projection implies. With
     *   projected = (current + assumed * r) / (1 + r),  r = assumedVolume / volumeSoFar
     * that ratio is r = (current - projected) / (projected - assumed), and r is
     * linear in the period count because each period adds the same volume. So
     * the ratio needed to sit exactly on the target scales straight back into a
     * period count. Direction never enters the algebra; the signs handle a
     * reverse metric on their own.
     *
     * A caller holding the real volumes should pass periodsToTarget instead and
     * skip all of this, since periodsToReach walking actual volume is the better
     * answer wherever it is available.
     */
    const periodsToCrossFromProjection = (current, assumed, projected, periods, target, cap) => {
        const ratioDenom = projected - assumed;
        if (Math.abs(ratioDenom) < TIE_EPSILON) return null;
        const ratioSoFar = (current - projected) / ratioDenom;
        if (!Number.isFinite(ratioSoFar) || ratioSoFar <= 0) return null;

        const neededDenom = assumed - target;
        if (Math.abs(neededDenom) < TIE_EPSILON) return null;
        const ratioNeeded = (target - current) / neededDenom;
        if (!Number.isFinite(ratioNeeded) || ratioNeeded <= 0) return null;

        // The epsilon absorbs a period count that lands on a whole number and
        // arrives as 6.000000001, which would otherwise be rounded up to seven
        // and quietly add a week of work to the ask.
        const n = Math.ceil((periods * ratioNeeded / ratioSoFar) - TIE_EPSILON);
        if (!Number.isFinite(n) || n < 1 || n > cap) return null;
        return n;
    };

    /**
     * The same story with the door taken out.
     *
     *   "Four weeks at 96.0% brings the year to 92.4%. Six gets you over the
     *    line and it stays over."
     *
     * For every message where a placing is off the table: nothing in here names
     * a position, an ordinal, a peer count or a rank, and the tests hold it to
     * that with the same regexes that guard the year standing copy. The line
     * being crossed is the target, which is a bar the associate is expected to
     * clear on their own account and says nothing about anybody else.
     *
     * The second sentence is dropped rather than softened whenever the target
     * cannot be honestly reached from here, so the clause degrades to a plain
     * statement of where the pace lands instead of implying a finish line that
     * is not coming.
     */
    const buildPaceClause = (options) => {
        const opts = options || {};
        const registryKey = registryKeyFor(opts.rankKey);
        if (!registryKey || PROJECTABLE_RANK_KEYS.indexOf(opts.rankKey) === -1) return '';

        const current = num(opts.currentValue);
        const assumed = num(opts.assumedValue);
        const projected = num(opts.projectedValue);
        const periods = wholeAtLeastOne(opts.periods);
        if (current === null || assumed === null || projected === null || periods === null) return '';

        const reverse = isReverseRank(opts.rankKey);
        // A pace that lands on the number they already have is not a pace, and
        // dressing up a sideways month as progress is the exact thing
        // moveIsNoise exists to stop callers doing.
        if (!isBetterThan(projected, current, reverse)) return '';

        const noun = periodNounFrom(opts);
        const opening = countWord(periods) + ' ' + pluralNoun(noun, periods) + ' at ' + fmt(registryKey, assumed)
            + ' brings the year to ' + fmt(registryKey, projected) + '.';

        const target = num(opts.target);
        if (target === null) return opening;

        // Already over by the end of the stretch being described. Holding is
        // safe to promise here: a projection that crossed the target while
        // improving can only have come from an assumed value better than the
        // target, so more of the same keeps it there.
        if (hasReached(projected, target, reverse)) {
            return opening + ' That is over the line, and holding it keeps it there.';
        }
        if (!isBetterThan(assumed, target, reverse)) return opening;

        const cap = wholeAtLeastOne(opts.maxPeriods) || DEFAULT_MAX_PERIODS;
        const needed = wholeAtLeastOne(opts.periodsToTarget)
            || periodsToCrossFromProjection(current, assumed, projected, periods, target, cap);
        if (needed === null || needed <= periods) return opening;

        return opening + ' ' + countWord(needed) + ' gets you over the line and it stays over.';
    };

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.rankProjection = {
        RANK_TO_REGISTRY,
        PROJECTABLE_RANK_KEYS,
        SURVEY_WEIGHTED_RANK_KEYS,
        MIN_SURVEYS_TO_PROJECT,
        registryKeyFor,
        rankedValueFor,
        projectValue,
        thresholdValueForRank,
        projectRank,
        periodsToReach,
        isProjectable,
        moveIsNoise,
        buildDoorClause,
        buildPaceClause
    };
})();
