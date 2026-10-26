(function () {
    'use strict';

    /**
     * YEAR STANDING — are they gaining or losing ground?
     *
     * Associates should know whether they are pulling ahead of the floor or
     * being passed by it, with five months of the year left to do something
     * about it. What they should not get is a position: no "14 of 127", no
     * "you're 22nd". A number invites them to compare themselves to a
     * colleague; a direction invites them to move.
     *
     * So ranks are computed, used to work out which way they are travelling,
     * and then thrown away. Only the direction survives into the message.
     *
     * A direction on its own turned out to be half a conversation. Somebody
     * told the floor has been passing them all year has been handed a worry
     * and no way to act on it, and the fix is not to give the position back:
     * it is to say what holding a particular number would do to their own year
     * figure. That sentence comes in on an entry as paceText, and it goes
     * through the same rule as everything else here, which is that no position
     * of any kind reaches the person reading.
     */

    // A place or two either way is churn, not movement — one good week from
    // somebody else can shuffle a mid-table rank. Movement has to be big enough
    // that it means something before it is worth saying.
    const MIN_PLACES = 3;
    const MIN_SHARE_OF_FIELD = 0.03;

    const PHRASES = {
        gaining: [
            'you have been gaining ground on the floor here',
            'you have been climbing past people on this one',
            'you are pulling ahead of the floor on this'
        ],
        // Never that anybody is passing them: "the floor has been passing you
        // here" and "others have been moving ahead of you" sat next to the
        // banned "N people ahead of you" (Scott, 2026-10-21; tone audit
        // 10/25). Their own ground, and that it can be won back.
        slipping: [
            'you have lost a little ground on this one, and it is very winnable back',
            'this one has lost a bit of ground this year, and there is time to win it back',
            'you have been losing ground on this one, and a few strong weeks turn it around'
        ],
        holding: [
            'you have held your place here',
            'you are holding steady against the floor on this'
        ]
    };

    /**
     * Which way they are travelling against everyone else.
     *
     * Ranks count upward from the best, so a falling rank number is an
     * improvement. Returns null when there is nothing to compare, rather than
     * guessing at a direction.
     */
    function classifyMovement(earlierRank, currentRank, fieldSize) {
        // Number(null) is 0, and rank 0 would read as the top of the floor —
        // a missing rank must not become the best possible one.
        const toRank = (value) => {
            if (value === null || value === undefined || value === '') return null;
            const n = Number(value);
            return Number.isFinite(n) && n > 0 ? n : null;
        };

        const before = toRank(earlierRank);
        const after = toRank(currentRank);
        if (before === null || after === null) return null;

        const threshold = Math.max(MIN_PLACES, Math.round((Number(fieldSize) || 0) * MIN_SHARE_OF_FIELD));
        const placesGained = before - after;

        if (Math.abs(placesGained) < threshold) return 'holding';
        return placesGained > 0 ? 'gaining' : 'slipping';
    }

    function phraseFor(movement, pick) {
        const pool = PHRASES[movement];
        if (!pool) return '';
        if (typeof pick === 'function') return pick(pool);
        return pool[0];
    }

    // The shapes a position takes on its way into a sentence. This module
    // cannot see who is calling it, and the one thing it exists to prevent is
    // exactly what a well-meaning caller might hand it: a pace sentence
    // assembled somewhere else with "you would be 18th" sitting in the middle
    // of it. Anything matching these is dropped whole rather than scrubbed,
    // because a sentence with a hole cut in it is worse than no sentence.
    const PLACING_PATTERNS = [
        /\b\d+(st|nd|rd|th)\b/,
        /\b\d+\s+(of|out of)\s+\d+/,
        /top \d/i,
        /\brank(ed|ing)?\b/i
    ];

    /**
     * A pace sentence earns its place under a bullet only if it says nothing
     * about where they sit. rankProjection.buildPaceClause is written to that
     * rule and is the intended source, but the check lives here so the rule
     * survives whoever fills the field in next.
     */
    function safePaceText(paceText) {
        const text = typeof paceText === 'string' ? paceText.trim() : '';
        if (!text) return '';
        return PLACING_PATTERNS.some(pattern => pattern.test(text)) ? '' : text;
    }

    /**
     * The block that goes into a check-in.
     *
     * entries: [{ label, valueText, targetText, movement, paceText }]
     * Only entries carrying a movement are worth a line — without one there is
     * nothing to say beyond the number they already know.
     *
     * paceText is optional and renders as a continuation line indented under
     * its bullet: what holding a given number for a stretch would do to the
     * year. A direction is the one thing this module can say safely and also
     * the one thing that cannot answer "what would move it", so "the floor has
     * been passing you here" on its own is a worry handed over with no way to
     * act on it. The sentence is composed elsewhere because the arithmetic
     * behind it needs call and survey volumes this module has never carried.
     * An entry without one renders exactly as it always has.
     */
    function buildYearStandingText(entries, options) {
        const opts = options || {};
        const list = (entries || []).filter(e => e && e.movement);
        if (!list.length) return '';

        const lines = list.slice(0, opts.limit || 3).map(e => {
            const value = e.valueText ? `${e.label} ${e.valueText}` : e.label;
            const against = e.targetText ? ` against ${withArticle(e.targetText)} target` : '';
            const bullet = `  • ${value}${against}: ${phraseFor(e.movement, opts.pick)}.`;
            const pace = safePaceText(e.paceText);
            return pace ? `${bullet}\n    ${pace}` : bullet;
        });

        // A heading in words. The calendar emoji in front of it was one of
        // four or five section markers that took a private message past its
        // two emojis (Scott, 2026-10-14).
        const header = opts.header || 'Where the year stands';
        const closer = opts.closer || '';
        return `${header}\n${lines.join('\n')}${closer ? `\n\n${closer}` : ''}`;
    }

    // "an 82% target", "a 93% target": "a 82.0% target" read unproofed.
    // Eight, eleven and eighteen are the numbers said with a vowel up front.
    function withArticle(text) {
        const s = String(text || '').trim();
        return (/^(8|11(?!\d)|18(?!\d))/.test(s) ? 'an ' : 'a ') + s;
    }

    /**
     * How much of the year is left, in the plainest terms. Used to give the
     * block its urgency without inventing a deadline.
     */
    function monthsLeftInYear(date) {
        const when = date instanceof Date ? date : new Date();
        return 11 - when.getMonth();
    }

    /**
     * Whole weeks from this date to December 31, to the nearest week.
     *
     * Months counted the way monthsLeftInYear counts them are calendar months
     * after this one, so on October 14 they said "2 months left" with eleven
     * weeks still to work.
     */
    function weeksLeftInYear(date) {
        const when = date instanceof Date ? new Date(date.getTime()) : new Date();
        when.setHours(12, 0, 0, 0);
        const end = new Date(when.getFullYear(), 11, 31, 12);
        const days = Math.round((end.getTime() - when.getTime()) / 86400000);
        return Math.max(0, Math.round(days / 7));
    }

    /* The line under the block.
     *
     * "2 months left in the year. This is the stretch that decides it." went
     * out on October 14 (Scott, 2026-10-14): wrong by two weeks and ominous
     * with it. The run-in now counts the weeks that are really there and says
     * they are enough, which they are. Earlier in the year it is months, and
     * December names the month rather than promising time that is gone.
     */
    function urgencyLine(date) {
        const when = date instanceof Date ? date : new Date();
        const left = monthsLeftInYear(when);
        if (left <= 0) return 'December is the last stretch of the year, and every call in it still counts.';
        const weeks = weeksLeftInYear(when);
        if (weeks <= 16) return `About ${weeks} weeks left in the year. That is real time to move any of these, and I'm here to help.`;
        return `${left} months left in the year, so there is time to move this.`;
    }

    // --- Rank gathering ---

    function sortedKeysByEnd(data) {
        return Object.keys(data || {}).sort((a, b) => {
            const ea = data[a]?.metadata?.endDate || (a.includes('|') ? a.split('|')[1] : a);
            const eb = data[b]?.metadata?.endDate || (b.includes('|') ? b.split('|')[1] : b);
            return String(ea).localeCompare(String(eb));
        });
    }

    /**
     * Ranks for one associate at two points in the year, from whichever two
     * YTD uploads are furthest apart. Returns null when there is only one
     * upload, because a single point is a position, not a direction.
     */
    function gatherYearMovement(employeeName) {
        const ranking = window.DevCoachModules?.centerRanking;
        if (!ranking?.buildRankingsForPeriod) return null;

        const ytd = window.DevCoachModules?.storage?.loadYtdData?.() || {};
        const keys = sortedKeysByEnd(ytd);
        if (keys.length < 2) return null;

        const rowFor = (key) => {
            const data = ranking.buildRankingsForPeriod(key);
            if (!data?.rankings) return null;
            const row = data.rankings.find(r => r.name === employeeName);
            return row ? { row, fieldSize: data.totalEmployees || data.rankings.length } : null;
        };

        const earlier = rowFor(keys[0]);
        const current = rowFor(keys[keys.length - 1]);
        if (!earlier || !current) return null;

        return {
            earlier: earlier.row.metricRanks || {},
            current: current.row.metricRanks || {},
            fieldSize: current.fieldSize,
            earlierKey: keys[0],
            currentKey: keys[keys.length - 1]
        };
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.yearStanding = {
        MIN_PLACES,
        MIN_SHARE_OF_FIELD,
        PHRASES,
        classifyMovement,
        phraseFor,
        safePaceText,
        buildYearStandingText,
        monthsLeftInYear,
        weeksLeftInYear,
        urgencyLine,
        gatherYearMovement
    };
})();
