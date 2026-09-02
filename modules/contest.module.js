/* ========================================
   CONTEST MODULE
   Raffle entries for a month-long contest.

   Three ways to earn an entry:
     - every perfect survey                      (one entry each)
     - a day at or above the adherence target    (one entry per day)
     - a week, and the month, averaging the target (one entry each, stacking)

   The daily numbers live in this module's own store rather than in dailyData,
   which purgeDailiesCoveredBy deletes as soon as a weekly upload covers those
   dates. Entries earned on a Monday would otherwise disappear on Friday.

   Everything here is a pure function of the stored input, so re-entering a date
   corrects it instead of awarding twice, and the standings can always be
   rebuilt from what was typed.
   ======================================== */

(function () {
    'use strict';

    // Borrowed, not redeclared. The app already scores adherence against this
    // number everywhere else, and a contest that used its own copy would drift
    // from the tool the moment the target changed.
    function adherenceTarget() {
        const profiles = window.DevCoachModules?.metricProfiles;
        const fromProfile = profiles?.getTarget?.('scheduleAdherence');
        if (Number.isFinite(fromProfile)) return fromProfile;
        return 93;
    }

    // ============================================
    // DATES
    // ============================================

    /** Monday of the week containing an ISO date. Pure string in, string out. */
    function weekStartOf(isoDate) {
        const [y, m, d] = String(isoDate).split('-').map(Number);
        const at = new Date(Date.UTC(y, m - 1, d));
        // getUTCDay: 0 = Sunday. Shift so Monday is the start.
        const offset = (at.getUTCDay() + 6) % 7;
        at.setUTCDate(at.getUTCDate() - offset);
        return at.toISOString().slice(0, 10);
    }

    function monthOf(isoDate) {
        return String(isoDate).slice(0, 7);
    }

    // ============================================
    // ENTRIES
    // ============================================

    /**
     * Every entry earned, from the days that were typed in.
     *
     * Returns one object per entry rather than a count, so the leaderboard can
     * show why each was earned and a wrong day can be traced back to what was
     * entered on it.
     */
    function computeEntries(monthData) {
        const days = (monthData && monthData.days) || {};
        const target = adherenceTarget();
        const entries = [];

        // Per day: perfect surveys, and the day's own adherence.
        Object.keys(days).sort().forEach((date) => {
            const people = days[date] || {};
            Object.keys(people).forEach((name) => {
                const row = people[name] || {};

                const perfect = Number(row.perfectSurveys) || 0;
                for (let i = 0; i < perfect; i += 1) {
                    entries.push({ associate: name, reason: 'perfect-survey', on: date, detail: 'a perfect survey' });
                }

                const adherence = Number(row.adherence);
                if (Number.isFinite(adherence) && adherence >= target) {
                    entries.push({
                        associate: name, reason: 'daily-adherence', on: date,
                        detail: `${adherence.toFixed(1)}% on ${date}`
                    });
                }
            });
        });

        // Per week and per month: the average of the days that were logged.
        //
        // A simple mean, because a typed-in daily percentage carries no volume
        // to weight by. Everywhere the app aggregates uploaded metrics it
        // weights properly; this is the one place there is nothing to weight
        // with, so the day count travels with every award and is shown, which
        // is what makes a thin week visible rather than hidden.
        const buckets = {};
        Object.keys(days).forEach((date) => {
            const people = days[date] || {};
            Object.keys(people).forEach((name) => {
                const adherence = Number(people[name]?.adherence);
                if (!Number.isFinite(adherence)) return;
                const week = weekStartOf(date);
                const month = monthOf(date);
                (buckets[name] = buckets[name] || { weeks: {}, month: [] });
                (buckets[name].weeks[week] = buckets[name].weeks[week] || []).push(adherence);
                buckets[name].month.push(adherence);
            });
        });

        const mean = (list) => list.reduce((sum, n) => sum + n, 0) / list.length;

        Object.keys(buckets).sort().forEach((name) => {
            const bucket = buckets[name];

            Object.keys(bucket.weeks).sort().forEach((week) => {
                const values = bucket.weeks[week];
                const average = mean(values);
                if (average >= target) {
                    entries.push({
                        associate: name, reason: 'weekly-adherence', on: week,
                        detail: `${average.toFixed(1)}% across ${values.length} day${values.length === 1 ? '' : 's'}, week of ${week}`,
                        days: values.length
                    });
                }
            });

            if (bucket.month.length) {
                const average = mean(bucket.month);
                if (average >= target) {
                    entries.push({
                        associate: name, reason: 'monthly-adherence', on: monthOf(Object.keys(days)[0] || ''),
                        detail: `${average.toFixed(1)}% across ${bucket.month.length} day${bucket.month.length === 1 ? '' : 's'} this month`,
                        days: bucket.month.length
                    });
                }
            }
        });

        return entries;
    }

    /** Entries per person, most first, with the reasons kept. */
    function buildLeaderboard(monthData) {
        const entries = computeEntries(monthData);
        const byName = {};

        entries.forEach((entry) => {
            const row = byName[entry.associate] = byName[entry.associate] || {
                associate: entry.associate,
                total: 0,
                perfectSurvey: 0,
                dailyAdherence: 0,
                weeklyAdherence: 0,
                monthlyAdherence: 0,
                reasons: []
            };
            row.total += 1;
            if (entry.reason === 'perfect-survey') row.perfectSurvey += 1;
            if (entry.reason === 'daily-adherence') row.dailyAdherence += 1;
            if (entry.reason === 'weekly-adherence') row.weeklyAdherence += 1;
            if (entry.reason === 'monthly-adherence') row.monthlyAdherence += 1;
            row.reasons.push(entry);
        });

        return Object.values(byName).sort((a, b) =>
            b.total - a.total || a.associate.localeCompare(b.associate));
    }

    // ============================================
    // THE DRAW
    // ============================================

    /**
     * Picks a winner, weighted by entries.
     *
     * Returns the winning ticket number and the size of the pool alongside the
     * name, so the result can be checked rather than taken on trust. A raffle
     * nobody can audit is worth less than one they can.
     *
     * Accepts a ticket number so a draw can be replayed; without one it uses
     * crypto rather than Math.random, because this decides who gets a gift card.
     */
    function drawWinner(monthData, forcedTicket) {
        const entries = computeEntries(monthData);
        if (!entries.length) return null;

        let ticket;
        if (Number.isInteger(forcedTicket)) {
            ticket = forcedTicket;
        } else if (window.crypto?.getRandomValues) {
            const buffer = new Uint32Array(1);
            window.crypto.getRandomValues(buffer);
            ticket = buffer[0] % entries.length;
        } else {
            ticket = Math.floor(Math.random() * entries.length);
        }

        const winning = entries[ticket];
        const held = entries.filter((e) => e.associate === winning.associate).length;

        return {
            associate: winning.associate,
            ticket,
            poolSize: entries.length,
            entriesHeld: held,
            odds: `${held} of ${entries.length}`,
            wonBy: winning.detail
        };
    }

    // ============================================
    // POSTABLE STANDINGS
    // ============================================

    function buildStandingsPost(monthData, monthLabel) {
        const board = buildLeaderboard(monthData);
        if (!board.length) return '';

        const pool = board.reduce((sum, row) => sum + row.total, 0);
        const lines = [`Raffle entries so far, ${monthLabel}`, ''];

        board.forEach((row) => {
            const bits = [];
            if (row.perfectSurvey) bits.push(`${row.perfectSurvey} perfect survey${row.perfectSurvey === 1 ? '' : 's'}`);
            if (row.dailyAdherence) bits.push(`${row.dailyAdherence} day${row.dailyAdherence === 1 ? '' : 's'} on adherence`);
            if (row.weeklyAdherence) bits.push(`${row.weeklyAdherence} week${row.weeklyAdherence === 1 ? '' : 's'}`);
            if (row.monthlyAdherence) bits.push('the month');
            lines.push(`${row.associate}: ${row.total} (${bits.join(', ')})`);
        });

        lines.push('', `${pool} entries in the draw so far. Every perfect survey and every day at ${adherenceTarget()}% adds another.`);
        return lines.join('\n');
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.contest = {
        adherenceTarget,
        weekStartOf,
        monthOf,
        computeEntries,
        buildLeaderboard,
        drawWinner,
        buildStandingsPost
    };
})();
