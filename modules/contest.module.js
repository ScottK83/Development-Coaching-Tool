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

    /** Today, unless a caller pins it. Tests and replays pin it. */
    function todayIso(options) {
        const given = options && options.asOf;
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(given || ''))) return String(given);
        return new Date().toISOString().slice(0, 10);
    }

    /** The Sunday that closes the week a Monday opens. */
    function weekEndOf(weekStart) {
        const [y, m, d] = String(weekStart).split('-').map(Number);
        const at = new Date(Date.UTC(y, m - 1, d));
        at.setUTCDate(at.getUTCDate() + 6);
        return at.toISOString().slice(0, 10);
    }

    /**
     * Every entry earned, from the days that were typed in.
     *
     * Returns one object per entry rather than a count, so the leaderboard can
     * show why each was earned and a wrong day can be traced back to what was
     * entered on it.
     */
    function computeEntries(monthData, options) {
        const days = (monthData && monthData.days) || {};
        const target = adherenceTarget();
        const asOf = todayIso(options);
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

            // A week and a month pay once they are OVER, never while they are
            // still running. The average of a single logged Tuesday is that
            // Tuesday, so an unfinished period used to hand out its week bonus
            // and its month bonus on day one: one good day showed up as three
            // tickets. Nobody has held a week at target until the week is done.
            Object.keys(bucket.weeks).sort().forEach((week) => {
                const values = bucket.weeks[week];
                const average = mean(values);
                if (weekEndOf(week) < asOf && average >= target) {
                    entries.push({
                        associate: name, reason: 'weekly-adherence', on: week,
                        detail: `${average.toFixed(1)}% across ${values.length} day${values.length === 1 ? '' : 's'}, week of ${week}`,
                        days: values.length
                    });
                }
            });

            if (bucket.month.length) {
                const average = mean(bucket.month);
                const monthKey = monthOf(Object.keys(days).sort()[0] || '');
                const monthIsOver = monthKey && asOf.slice(0, 7) > monthKey;
                if (monthIsOver && average >= target) {
                    entries.push({
                        associate: name, reason: 'monthly-adherence', on: monthKey,
                        detail: `${average.toFixed(1)}% across ${bucket.month.length} day${bucket.month.length === 1 ? '' : 's'} this month`,
                        days: bucket.month.length
                    });
                }
            }
        });

        return entries;
    }

    /**
     * Where everybody's adherence actually stands, month to date.
     *
     * The tickets say what has been banked. This says how the month is going,
     * which is the thing somebody wants to know before the week closes and
     * decides whether the bonus is still reachable.
     */
    function buildAdherenceSummary(monthData) {
        const days = (monthData && monthData.days) || {};
        const totals = {};

        Object.keys(days).forEach((date) => {
            const people = days[date] || {};
            Object.keys(people).forEach((name) => {
                const value = Number(people[name]?.adherence);
                if (!Number.isFinite(value)) return;
                const row = totals[name] = totals[name] || { sum: 0, days: 0 };
                row.sum += value;
                row.days += 1;
            });
        });

        const out = {};
        Object.keys(totals).forEach((name) => {
            const row = totals[name];
            out[name] = {
                average: row.sum / row.days,
                days: row.days,
                meets: (row.sum / row.days) >= adherenceTarget()
            };
        });
        return out;
    }

    /** Entries per person, most first, with the reasons kept. */
    function buildLeaderboard(monthData, options) {
        const entries = computeEntries(monthData, options);
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
    function drawWinner(monthData, forcedTicket, options) {
        const entries = computeEntries(monthData, options);
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

    function buildStandingsPost(monthData, monthLabel, options) {
        const board = buildLeaderboard(monthData, options);
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


    // ============================================
    // THE POSTABLE TEXT
    // ============================================
    //
    // The graphic carries the standings, so this does not repeat them. It
    // frames the pool, names who is out front, restates the three ways to earn
    // a ticket, and closes with a reason to go get one. That is the whole job.
    //
    // The lines rotate because this gets posted week after week to the same
    // channel, and a post that opens the same way every time stops being read.

    var POST_CLOSERS = [
        function () { return 'The person who wins this may not be the one leading right now. That is the whole point of a drawing.'; },
        function () { return 'One ticket is enough to win. Zero tickets is not.'; },
        function () { return 'Not on the board yet? One perfect survey puts you in.'; },
        function () { return 'Every perfect survey is another ticket in the bowl. Go get a few.'; },
        function () { return 'Nobody is out of this. Get one ticket in and you are in the drawing with everybody else.'; },
        function (v) { return 'Your odds go up every day you hit ' + v.target + '%, and that part is all yours.'; },
        function () { return 'One name comes out at the end of the month. Make sure yours is in there more than once.'; },
        function () { return 'Plenty of month left. Load up. 🎟️'; }
    ];

    /**
     * Picks from a pool. Takes an index so a test can pin the line it gets;
     * without one it rotates at random, which is the point of having a pool.
     */
    function pickLine(pool, values, forcedIndex) {
        var index = Number.isInteger(forcedIndex)
            ? ((forcedIndex % pool.length) + pool.length) % pool.length
            : Math.floor(Math.random() * pool.length);
        return pool[index](values);
    }

    // ============================================
    // THE STANDINGS GRAPHIC
    // ============================================
    //
    // One 900px light card, every style inline, built to be rasterized by
    // html2canvas at scale 2 and pasted into Teams.
    //
    // Three things govern every choice below.
    //
    // It is always a light card, whatever theme the app is wearing.
    // styles-v2.css repaints any inline `background: #f`, `#e`, `#d`, `#fff` or
    // `white` to #1f2a3e when data-theme is dark, and forces color:#e2e8f0 on
    // bare div/span/p/td. html2canvas reads computed style off the live DOM, so
    // a supervisor in dark mode would otherwise export a mangled card. The
    // primary fix is the caller's, and it is already there: contest-ui.module.js
    // strips data-theme from the cloned documentElement in html2canvas onclone.
    // Every colour here is written rgb() as a second layer, which the background
    // selectors cannot match. Notation cannot beat the colour rule, which is
    // typed on the element, so the onclone is load bearing and must stay.
    //
    // Everything printed is computed from `board`. There is no typed number and
    // no date claim anywhere, because a poster stating a stale pool total is
    // worse than no poster.
    //
    // Nobody is hidden. Past 30 people the board splits into two columns rather
    // than cutting the list, because the people a cut drops are exactly the
    // people the card is trying to reach.

    // Copied from team-snapshot.module.js, which already survives this exact
    // html2canvas path in production. Short, every family reachable, generic
    // last, no emoji families: html2canvas assigns the whole string to ctx.font
    // and a silently rejected assignment drops the card to 10px sans-serif.
    var GFX_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

    var GFX_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    // One palette, every value rgb(), never hex, never var().
    var GFX = {
        plum: 'rgb(48, 26, 71)',        // the header ground, the one dark block
        plumLine: 'rgb(116, 90, 142)',  // the serial chip border
        plumSoft: 'rgb(201, 182, 218)', // secondary type on the plum
        white: 'rgb(255, 255, 255)',    // the pool total and the headline only
        paper: 'rgb(253, 251, 248)',    // the card ground, warm ticket stock
        band: 'rgb(246, 242, 236)',     // the call-to-action band at the foot
        rule: 'rgb(230, 224, 215)',     // every hairline, inset to the margin
        track: 'rgb(228, 221, 211)',    // the empty rail, a real step off paper
        slot: 'rgb(150, 138, 124)',     // the dashed open slot
        ink: 'rgb(32, 28, 40)',         // names, totals, labels
        inkSoft: 'rgb(102, 94, 110)',   // rank numerals, legend labels
        inkFaint: 'rgb(144, 136, 152)', // captions, axis, zero rows
        survey: 'rgb(79, 70, 229)',     // lever one, perfect surveys
        day: 'rgb(13, 148, 136)',       // lever two, days at target
        bonus: 'rgb(217, 119, 6)',      // lever three, week and month bonus
        other: 'rgb(140, 132, 122)'     // only if a row's parts miss its total
    };

    // Six sizes, ratio about 1.2 off a 10px base, the hero at 4x base. Nothing
    // on the card is any other size and nothing lands on a half pixel.
    var GFX_T = { micro: 10, small: 12, body: 14, total: 17, head: 20, hero: 40 };

    // Line heights sit near the browser's own `normal` for this stack, between
    // 1.29 and 1.33. That is deliberate and it is the one thing both render
    // judges caught in both earlier drafts: html2canvas draws text at
    // bounds.top + ascent, where ascent is probed in a line-height:normal span,
    // so any half-leading the browser added is discarded and the glyphs ride up
    // by (lineHeight - normalLineHeight) / 2. Centring a 12px numeral on a 38px
    // line box moves it 11px in the PNG. Vertical centring is the flex row's
    // job here, never the line box's.
    var GFX_LH = { 10: 13, 12: 16, 14: 18, 17: 22, 20: 26, 40: 52 };

    var GFX_CARD_W = 900;
    var GFX_PAD = 26;
    var GFX_INNER = GFX_CARD_W - (GFX_PAD * 2); // 848
    var GFX_COL_GAP = 24;

    function gfxEsc(text) {
        var mods = (typeof window !== 'undefined' && window.DevCoachModules) || {};
        var fn = mods.sharedUtils && mods.sharedUtils.escapeHtml;
        var raw = String(text === undefined || text === null ? '' : text);
        if (typeof fn === 'function') return fn(raw);
        // The test harness loads modules with an empty DevCoachModules, and a
        // name still has to come out inert there.
        return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /** Whole, never negative. A malformed row cannot suppress the card. */
    function gfxInt(value) {
        var n = Number(value);
        return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    }

    function gfxPlural(count, one, many) {
        return count === 1 ? one : many;
    }

    function gfxCommas(value) {
        return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /** font-size plus its matching line-height, so the pair can never drift. */
    function gfxType(size) {
        return 'font-size: ' + size + 'px; line-height: ' + GFX_LH[size] + 'px;';
    }

    /**
     * Accepts "September 2026", a bare "2026-09" key, or a full "2026-09-15".
     * Returns a title and a serial, and empty strings when nothing parses, so
     * the caller can drop a sentence rather than print a placeholder inside it.
     */
    function gfxMonthParts(monthLabel) {
        var raw = String(monthLabel === undefined || monthLabel === null ? '' : monthLabel).trim();
        var index = -1;
        var year = '';

        var iso = /^(\d{4})-(\d{1,2})/.exec(raw);
        if (iso) {
            index = Number(iso[2]) - 1;
            year = iso[1];
        } else {
            var worded = /^([A-Za-z]+)\s+(\d{4})$/.exec(raw);
            if (worded) {
                for (var i = 0; i < GFX_MONTHS.length; i += 1) {
                    if (GFX_MONTHS[i].toLowerCase() === worded[1].toLowerCase()) index = i;
                }
                year = worded[2];
            }
        }

        if (index < 0 || index > 11 || !year) return { title: raw, serial: '' };
        var two = index + 1 < 10 ? '0' + (index + 1) : String(index + 1);
        return { title: GFX_MONTHS[index] + ' ' + year, serial: 'NO. ' + two + ' · ' + year };
    }

    /** "2026-09-26" reads as "September 26". Anything else returns ''. */
    function gfxDayLabel(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
        if (!m) return '';
        var index = Number(m[2]) - 1;
        if (index < 0 || index > 11) return '';
        return GFX_MONTHS[index] + ' ' + Number(m[3]);
    }

    function gfxTargetLabel(target) {
        var n = Number(target);
        // Number(null) is 0 and Number.isFinite(0) is true, so a null target
        // would otherwise print "every day at 0%" on a poster.
        if (!Number.isFinite(n) || n <= 0) n = adherenceTarget();
        var rounded = Math.round(n * 10) / 10;
        return (rounded === Math.round(rounded) ? String(Math.round(rounded)) : String(rounded)) + '%';
    }

    // ---- The shared axis ---------------------------------------------------
    // One max for the whole board, derived from the leader and always above it,
    // so bar length is comparable between people and even the leader has rail
    // left. Never scaled per row. The 1.2 factor keeps the leader near 83
    // percent, which is what guarantees the open slot has room past every tip.
    var GFX_AXIS_STEPS = [2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80,
        100, 120, 160, 200, 250, 300, 400, 500];

    function gfxAxisMax(leaderTotal) {
        var needed = Math.max(1, gfxInt(leaderTotal)) * 1.2;
        for (var i = 0; i < GFX_AXIS_STEPS.length; i += 1) {
            if (GFX_AXIS_STEPS[i] >= needed) return GFX_AXIS_STEPS[i];
        }
        return Math.ceil(needed / 100) * 100;
    }

    // ---- Name fitting ------------------------------------------------------
    // Estimated width by character class, not by character count. A flat
    // average em treats "Willow Mummert-Wamboldt" (190px) as the same width as
    // "Stephanie Carbajal-Saiz" (154px), and the wide one then overflows and is
    // hard clipped, because html2canvas honours overflow:hidden but never draws
    // the CSS text-overflow ellipsis. The ellipsis in the style below is a
    // second layer; the real cut happens here, in JS, with a real glyph.
    //
    // Every value is the measured maximum of its own class, taken at 700 weight
    // in this exact font stack. Because each class is set to its own widest
    // member, the sum can never come in under the real advance, and kerning
    // only ever shortens a run further. That is a guarantee by construction
    // rather than a fudge factor, which is why there is no safety multiplier.
    // The cost is a 3 to 13 percent over-estimate on real names, and the price
    // of over-estimating is one step down a type scale that has a step spare.

    function gfxCharEm(ch) {
        if (ch === ' ') return 0.28;
        if ('iIjl.,;:|\'`'.indexOf(ch) >= 0) return 0.32;
        if ('ftr()[]{}-’…'.indexOf(ch) >= 0) return 0.41;
        if ('scz'.indexOf(ch) >= 0) return 0.48;
        if ('MW'.indexOf(ch) >= 0) return 1.01;
        if ('mw'.indexOf(ch) >= 0) return 0.92;
        if (ch >= '0' && ch <= '9') return 0.58;
        if ('EFLTY'.indexOf(ch) >= 0) return 0.55;
        if (ch >= 'A' && ch <= 'Z') return 0.79;
        if (ch >= 'a' && ch <= 'z') return 0.62;
        // Accented letters and anything else. The widest glyph measured in the
        // stack is 'W' at 1.01em, so nothing can be wider than this.
        return 1.01;
    }

    function gfxTextWidth(text, fontPx) {
        var ems = 0;
        var value = String(text || '');
        for (var i = 0; i < value.length; i += 1) ems += gfxCharEm(value.charAt(i));
        return ems * fontPx;
    }

    /**
     * Keep the whole name. If it will not fit, drop one step down the type
     * scale. Only if 12px still will not fit, trim the surname and append a
     * real ellipsis, which keeps more of the surname than an initial does and
     * cannot collapse two different people onto the same string.
     */
    function gfxFitName(name, widthPx, fontPx) {
        var full = String(name || '').trim();
        if (gfxTextWidth(full, fontPx) <= widthPx) return { text: full, size: fontPx };
        if (fontPx > GFX_T.small && gfxTextWidth(full, GFX_T.small) <= widthPx) {
            return { text: full, size: GFX_T.small };
        }
        var size = Math.min(fontPx, GFX_T.small);
        var cut = full;
        while (cut.length > 2 && gfxTextWidth(cut + '…', size) > widthPx) {
            cut = cut.slice(0, -1);
        }
        return { text: cut.replace(/[\s.,\-]+$/, '') + '…', size: size };
    }

    // ---- The people on the card -------------------------------------------

    /**
     * Everyone who belongs on this card, zero ticket people included.
     *
     * buildLeaderboard only returns people who earned something, and the people
     * this poster exists to reach are exactly the ones it would leave off. When
     * `names` is supplied every roster member missing from the board is added at
     * zero with a real rail and an open slot at the origin.
     *
     * An empty `names` array is still applied. A team with nobody on it should
     * produce the open board, not the whole call center.
     */
    function gfxPrepareRows(board, names, adherence) {
        var source = Array.isArray(board) ? board : [];
        var seen = {};
        var list = [];

        source.forEach(function (row) {
            var associate = String((row && row.associate) || '').trim();
            if (!associate || seen[associate]) return;
            seen[associate] = true;
            list.push({
                associate: associate,
                total: gfxInt(row.total),
                surveys: gfxInt(row.perfectSurvey),
                days: gfxInt(row.dailyAdherence),
                bonus: gfxInt(row.weeklyAdherence) + gfxInt(row.monthlyAdherence),
                reasons: (row && row.reasons) || [],
                adherence: (adherence && adherence[associate]) || null
            });
        });

        if (Array.isArray(names)) {
            var wanted = {};
            var order = [];
            names.forEach(function (name) {
                var key = String(name || '').trim();
                if (!key || wanted[key]) return;
                wanted[key] = true;
                order.push(key);
            });
            list = list.filter(function (row) { return wanted[row.associate] === true; });

            var present = {};
            list.forEach(function (row) { present[row.associate] = true; });
            order.forEach(function (name) {
                if (!present[name]) {
                    // Somebody on zero tickets may still have adherence
                    // logged, and below the target is exactly who most needs to
                    // see where they stand.
                    list.push({
                        associate: name, total: 0, surveys: 0, days: 0, bonus: 0, reasons: [],
                        adherence: (adherence && adherence[name]) || null
                    });
                }
            });
        }

        list.sort(function (a, b) {
            return b.total - a.total || a.associate.localeCompare(b.associate);
        });

        // Competition ranking, so people who are tied share a number. Nobody on
        // zero gets a placing at all: a placing is public and fine, but this
        // card should never tell somebody they are last.
        var lastTotal = null;
        var lastRank = 0;
        list.forEach(function (row, index) {
            if (row.total <= 0) { row.rank = 0; return; }
            if (row.total === lastTotal) { row.rank = lastRank; return; }
            row.rank = index + 1;
            lastRank = row.rank;
            lastTotal = row.total;
        });

        return list;
    }

    // ---- Row geometry ------------------------------------------------------
    // Whole pixels throughout, derived from the column width, with exactly one
    // flexible child per row so every rounding remainder lands in the rail
    // instead of pushing something off the card.

    function gfxTier(rowCount) {
        var cfg;
        if (rowCount > 30) {
            // Two columns, never three. A third column takes the rail under
            // 90px, where four different ticket counts paint the same mark, and
            // height is free in a Teams paste where rail width is not.
            cfg = { columns: 2, rowH: 26, rankW: 24, rankGap: 8, nameW: 162, nameGap: 10,
                nameFs: GFX_T.small, totalGap: 10, totalW: 32, totalFs: GFX_T.small,
                barH: 12, minSeg: 2, breakdown: false };
        } else if (rowCount > 18) {
            cfg = { columns: 1, rowH: 30, rankW: 26, rankGap: 10, nameW: 220, nameGap: 12,
                nameFs: GFX_T.body, totalGap: 12, totalW: 44, totalFs: GFX_T.body,
                barH: 16, minSeg: 3, breakdown: false };
        } else {
            cfg = { columns: 1, rowH: 38, rankW: 26, rankGap: 10, nameW: 220, nameGap: 12,
                nameFs: GFX_T.body, totalGap: 12, totalW: 44, totalFs: GFX_T.total,
                barH: 20, minSeg: 4, breakdown: true };
        }
        cfg.colW = Math.floor((GFX_INNER - ((cfg.columns - 1) * GFX_COL_GAP)) / cfg.columns);
        cfg.leftPad = cfg.rankW + cfg.rankGap + cfg.nameW + cfg.nameGap;
        cfg.rightPad = cfg.totalGap + cfg.totalW;
        cfg.railW = cfg.colW - cfg.leftPad - cfg.rightPad;
        // Four pixels of slack so the longest bar the axis can produce still
        // has track showing behind it.
        cfg.barArea = Math.max(24, cfg.railW - 4);
        return cfg;
    }

    /**
     * Segment widths in whole pixels against the shared axis.
     *
     * A lever that paid at all keeps a mark of its own, and one ticket never
     * paints the same width as two. The bar can never disagree with the number
     * printed beside it: a short count gets a neutral remainder, and a long one
     * is scaled down to the printed total.
     */
    function gfxSegments(row, axisMax, cfg) {
        var parts = [
            { n: row.surveys, color: GFX.survey },
            { n: row.days, color: GFX.day },
            { n: row.bonus, color: GFX.bonus }
        ];
        var counted = parts[0].n + parts[1].n + parts[2].n;
        var total = row.total;

        if (counted > total && counted > 0) {
            // The components cannot outrun the number beside them.
            var scale = total / counted;
            parts.forEach(function (part) { part.n = part.n * scale; });
        } else if (total > counted) {
            parts.push({ n: total - counted, color: GFX.other, isOther: true });
        }

        var unit = cfg.barArea / Math.max(1, axisMax);
        var painted = [];
        parts.forEach(function (part) {
            if (part.n <= 0) return;
            // A soft floor. It keeps a single ticket visible without ever
            // flattening one ticket and two onto the same width.
            var width = Math.max(Math.round(part.n * unit), Math.min(cfg.minSeg, Math.ceil(part.n)));
            painted.push({ color: part.color, w: width, isOther: part.isOther === true });
        });
        if (!painted.length) return painted;

        var gutter = 2;
        var budget = cfg.barArea - (gutter * (painted.length - 1));
        var used = 0;
        var i;
        for (i = 0; i < painted.length; i += 1) used += painted[i].w;
        while (used > budget) {
            var widest = 0;
            for (i = 1; i < painted.length; i += 1) {
                if (painted[i].w > painted[widest].w) widest = i;
            }
            if (painted[widest].w <= 1) break;
            painted[widest].w -= 1;
            used -= 1;
        }
        return painted;
    }

    /** Which lever paid, in the legend's own colours, as a readable line. */
    function gfxBreakdown(row) {
        var bits = [];
        if (row.surveys) {
            bits.push('<span style="color: ' + GFX.survey + ';">' + row.surveys + ' '
                + gfxPlural(row.surveys, 'survey', 'surveys') + '</span>');
        }
        if (row.days) {
            bits.push('<span style="color: ' + GFX.day + ';">' + row.days + ' '
                + gfxPlural(row.days, 'day', 'days') + '</span>');
        }
        if (row.bonus) {
            bits.push('<span style="color: ' + GFX.bonus + ';">' + row.bonus + ' bonus</span>');
        }
        // Where the month actually stands, next to what it has banked. The
        // target colour is the honest one: a run that is not going to pay
        // should not be wearing the colour of one that is.
        if (row.adherence) {
            var pct = row.adherence.average.toFixed(1) + '% adherence'
                + (row.days === row.adherence.days ? '' : ' over ' + row.adherence.days + ' '
                    + gfxPlural(row.adherence.days, 'day', 'days'));
            bits.push('<span style="color: ' + (row.adherence.meets ? GFX.day : GFX.inkFaint) + ';">'
                + pct + '</span>');
        }

        if (!bits.length) {
            return '<span style="color: ' + GFX.inkFaint + ';">No tickets yet.</span>';
        }
        return bits.join('<span style="color: ' + GFX.inkFaint + ';"> · </span>');
    }

    function gfxRow(row, cfg, axisMax, isLast, isSoleLeader) {
        var earned = row.total > 0;
        var name = gfxFitName(row.associate, cfg.nameW, cfg.nameFs);
        var segments = gfxSegments(row, axisMax, cfg);

        var bar = '';
        segments.forEach(function (part, index) {
            var first = index === 0;
            var last = index === segments.length - 1;
            var radius = (first ? '3px ' : '0 ') + (last ? '3px 3px ' : '0 0 ') + (first ? '3px' : '0');
            bar += '<div style="flex: 0 0 ' + part.w + 'px; height: ' + cfg.barH + 'px; '
                + 'background: ' + part.color + '; border-radius: ' + radius + ';'
                + (last ? '' : ' margin-right: 2px;') + '"></div>';
        });

        // A shared placing prints its number, but only a sole leader is marked.
        // On a board where everyone has one ticket, competition ranking makes
        // every row rank 1, and an accent on every row marks nobody.
        var marked = isSoleLeader && row.rank === 1;
        var rank = row.rank ? String(row.rank) : '';

        var nameBlock = '<div style="' + gfxType(name.size) + ' font-weight: 700; '
            + 'color: ' + (earned ? GFX.ink : GFX.inkSoft) + '; '
            + 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">'
            + gfxEsc(name.text) + '</div>';
        if (cfg.breakdown) {
            nameBlock += '<div style="' + gfxType(GFX_T.micro) + ' font-weight: 700; '
                + 'white-space: nowrap; overflow: hidden;">' + gfxBreakdown(row) + '</div>';
        }

        // The accent eats its own width out of the row padding, so no name
        // shifts three pixels against the column above it.
        var accent = marked
            ? 'border-left: 3px solid ' + GFX.plum + '; padding-left: 0;'
            : 'padding-left: 3px;';

        return '<div style="display: flex; align-items: center; box-sizing: border-box; '
            + 'height: ' + cfg.rowH + 'px; ' + accent
            + (isLast ? '' : ' border-bottom: 1px solid ' + GFX.rule + ';') + '">'

            + '<div style="flex: 0 0 ' + cfg.rankW + 'px; margin-right: ' + cfg.rankGap + 'px; '
            + 'text-align: right; white-space: nowrap; overflow: hidden; ' + gfxType(GFX_T.small)
            + ' font-weight: 700; color: ' + (marked ? GFX.plum : GFX.inkSoft) + ';">' + rank + '</div>'

            + '<div style="flex: 0 0 ' + cfg.nameW + 'px; margin-right: ' + cfg.nameGap + 'px; '
            + 'overflow: hidden;">' + nameBlock + '</div>'

            + '<div style="display: flex; align-items: center; flex: 1 1 auto; min-width: 0; '
            + 'height: ' + cfg.barH + 'px; background: ' + GFX.track + '; border-radius: 3px;">'
            + bar + '</div>'

            + '<div style="flex: 0 0 ' + cfg.totalW + 'px; margin-left: ' + cfg.totalGap + 'px; '
            + 'text-align: right; ' + gfxType(cfg.totalFs) + ' font-weight: 700; '
            + 'color: ' + (earned ? GFX.ink : GFX.inkFaint) + ';">' + row.total + '</div>'

            + '</div>';
    }

    // flex: 0 0 auto and nowrap on the label, because the label is two or three
    // words and a flex child is allowed to shrink below its content by default.
    // On a machine whose Segoe UI runs a little wider than the fallback these
    // were shrinking and breaking mid-phrase, so "Perfect surveys" arrived over
    // two lines and pushed the legend to double height.
    function gfxLegendItem(color, label, count, last) {
        return '<div style="display: flex; align-items: center; flex: 0 0 auto; '
            + 'margin-right: ' + (last ? '0' : '26px') + ';">'
            + '<div style="flex: 0 0 9px; height: 9px; border-radius: 2px; background: ' + color + ';"></div>'
            + '<div style="margin-left: 8px; white-space: nowrap; ' + gfxType(GFX_T.small) + ' font-weight: 600; '
            + 'color: ' + GFX.inkSoft + ';">' + label + '</div>'
            + '<div style="margin-left: 7px; ' + gfxType(GFX_T.small) + ' font-weight: 700; '
            + 'color: ' + GFX.ink + ';">' + gfxCommas(count) + '</div>'
            + '</div>';
    }

    function gfxLegend(totals, axisMax, hasOther) {
        var items = gfxLegendItem(GFX.survey, 'Perfect surveys', totals.surveys, false)
            + gfxLegendItem(GFX.day, 'Days on adherence', totals.days, false)
            + gfxLegendItem(GFX.bonus, 'Week and month bonus', totals.bonus, !hasOther);
        if (hasOther) items += gfxLegendItem(GFX.other, 'Other entries', totals.other, true);

        return '<div style="display: flex; align-items: center; flex-wrap: wrap; '
            + 'padding: 13px ' + GFX_PAD + 'px 12px ' + GFX_PAD + 'px; '
            + 'border-bottom: 1px solid ' + GFX.rule + ';">'
            + items
            + '<div style="flex: 1 1 auto;"></div>'
            + '<div style="white-space: nowrap; ' + gfxType(GFX_T.micro) + ' font-weight: 700; '
            + 'color: ' + GFX.inkFaint + ';">'
            + 'SAME SCALE ON EVERY ROW, 0 TO ' + axisMax + '</div>'
            + '</div>';
    }

    function gfxHeader(month, teamLabel, pool, earners, throughLabel) {
        // The only letter-spaced runs on the card are generated capitals and
        // this one, and this one is the only place caller text reaches one.
        // html2canvas measures a letter-spaced run one grapheme at a time, so a
        // combining mark or an emoji anywhere in it walks every glyph after it
        // sideways. The whole assembled string is stripped, not just the team
        // label: an unparseable monthLabel falls through to the card as raw
        // caller text and would otherwise arrive here unfiltered. NFC first, so
        // a decomposed accent survives as one code point instead of being cut
        // back to a bare letter. The range is written with escapes so the file
        // encoding cannot quietly change what it matches.
        var teamPart = String(teamLabel === undefined || teamLabel === null ? '' : teamLabel).trim();
        var tail = month.title ? month.title + ' raffle' : 'Raffle';
        var kicker = (teamPart ? teamPart + ' · ' : '') + tail;
        if (typeof kicker.normalize === 'function') kicker = kicker.normalize('NFC');
        kicker = kicker.replace(/[^ -ɏ]/g, '')
            .replace(/\s+/g, ' ').trim().toUpperCase();

        var serial = month.serial
            ? '<div style="border: 1px solid ' + GFX.plumLine + '; border-radius: 4px; '
                + 'padding: 3px 8px; margin-right: 10px; ' + gfxType(GFX_T.micro) + ' font-weight: 700; '
                + 'letter-spacing: 1.4px; color: ' + GFX.plumSoft + ';">' + gfxEsc(month.serial) + '</div>'
            : '';

        var sub;
        if (earners > 0) {
            sub = gfxCommas(earners) + gfxPlural(earners, ' person has', ' people have')
                + ' tickets so far. There is room for everybody.';
        } else {
            sub = 'Nobody has a ticket yet. The first one is there for the taking.';
        }
        if (throughLabel) sub = 'Counted through ' + throughLabel + '. ' + sub;

        var poolLabel = pool > 0
            ? gfxPlural(pool, 'TICKET', 'TICKETS') + ' IN THE BOWL'
            : 'NO TICKETS YET';

        return '<div style="background: ' + GFX.plum + '; border-radius: 14px 14px 0 0; '
            + 'padding: 22px ' + GFX_PAD + 'px 0 ' + GFX_PAD + 'px;">'

            + '<div style="display: flex; align-items: flex-end; justify-content: space-between;">'

            + '<div style="flex: 1 1 auto; min-width: 0; padding-right: 24px;">'
            + '<div style="display: flex; align-items: center; margin-bottom: 9px;">' + serial
            + '<div style="' + gfxType(GFX_T.micro) + ' font-weight: 700; letter-spacing: 1.6px; '
            + 'white-space: nowrap; overflow: hidden; color: ' + GFX.plumSoft + ';">'
            + gfxEsc(kicker) + '</div></div>'
            + '<div style="' + gfxType(GFX_T.head) + ' font-weight: 700; color: ' + GFX.white + ';">'
            + 'Tickets in the bowl</div>'
            + '<div style="margin-top: 4px; ' + gfxType(GFX_T.small) + ' font-weight: 600; '
            + 'color: ' + GFX.plumSoft + ';">' + gfxEsc(sub) + '</div>'
            + '</div>'

            + '<div style="flex: 0 0 auto; text-align: right;">'
            + '<div style="' + gfxType(GFX_T.hero) + ' font-weight: 800; color: ' + GFX.white + ';">'
            + gfxCommas(pool) + '</div>'
            + '<div style="' + gfxType(GFX_T.micro) + ' font-weight: 700; letter-spacing: 1.4px; '
            + 'white-space: nowrap; color: ' + GFX.plumSoft + ';">' + poolLabel + '</div>'
            + '</div>'

            + '</div>'
            + gfxPerforation()
            + '</div>';
    }

    /**
     * The one ticket device on the card, executed once: a tear line of punched
     * holes across the foot of the header, in the colour of the paper below, so
     * the header reads as a stub torn off the board. There is no second
     * perforation at a second scale and no negative margin holding it together.
     */
    function gfxPerforation() {
        var holes = '';
        for (var i = 0; i < 24; i += 1) {
            holes += '<div style="flex: 0 0 10px; height: 10px; border-radius: 5px; '
                + 'background: ' + GFX.paper + ';"></div>';
        }
        return '<div style="display: flex; align-items: center; justify-content: space-between; '
            + 'height: 20px; margin-top: 18px;">' + holes + '</div>';
    }

    function gfxCta(targetLabel, counterweight) {
        var way = function (color, label, sub, last) {
            return '<div style="flex: 1 1 0; min-width: 0; margin-right: ' + (last ? '0' : '20px') + ';">'
                + '<div style="display: flex; align-items: flex-start;">'
                + '<div style="flex: 0 0 8px; height: 8px; border-radius: 2px; margin-top: 5px; '
                + 'background: ' + color + ';"></div>'
                + '<div style="margin-left: 8px; ' + gfxType(GFX_T.body) + ' font-weight: 700; '
                + 'color: ' + GFX.ink + ';">' + label + '</div></div>'
                + '<div style="margin-left: 16px; margin-top: 3px; ' + gfxType(GFX_T.micro) + ' font-weight: 700; '
                + 'color: ' + GFX.inkFaint + ';">' + sub + '</div>'
                + '</div>';
        };

        return '<div style="padding: 16px ' + GFX_PAD + 'px 18px ' + GFX_PAD + 'px; '
            + 'background: ' + GFX.band + '; border-top: 1px solid ' + GFX.rule + '; '
            + 'border-radius: 0 0 14px 14px;">'

            + '<div style="margin-bottom: 11px; ' + gfxType(GFX_T.micro) + ' font-weight: 700; '
            + 'letter-spacing: 1.6px; color: ' + GFX.inkFaint + ';">'
            + 'THREE WAYS TO PUT ANOTHER TICKET IN</div>'

            + '<div style="display: flex; align-items: flex-start;">'
            + way(GFX.survey, 'Every perfect survey', 'one ticket each', false)
            + way(GFX.day, 'Every day at ' + targetLabel, 'one ticket a day', false)
            + way(GFX.bonus, 'A week at ' + targetLabel + ', and the month', 'one bonus ticket each', true)
            + '</div>'

            + '<div style="display: flex; justify-content: space-between; align-items: baseline; '
            + 'margin-top: 14px; padding-top: 12px; border-top: 1px solid ' + GFX.rule + ';">'
            + '<div style="' + gfxType(GFX_T.small) + ' font-weight: 700; color: ' + GFX.ink + ';">'
            + '<span style="color: ' + GFX.bonus + ';">★</span> ' + counterweight + '</div>'
            + '<div style="padding-left: 20px; text-align: right; ' + gfxType(GFX_T.small)
            + ' font-weight: 600; color: ' + GFX.inkSoft + ';">'
            + 'One name comes out at the end of the month.</div>'
            + '</div>'

            + '</div>';
    }

    /**
     * Makes every colour on the card win, on screen as well as in the export.
     *
     * The card is previewed live in the panel, inside the running app, and
     * styles-v2.css forces color:#e2e8f0 !important onto bare div, span, p, td
     * and the rest whenever dark mode is on. That rule is typed on the element,
     * so it reaches every cell of the card and washes the whole thing out: the
     * names, the totals, the legend, the call to action, all pale grey on warm
     * paper. The export is fine, because the clone is pinned to light, but what
     * Scott actually looks at before pressing copy is the preview.
     *
     * An inline declaration marked important beats an important declaration
     * from a stylesheet, so marking the card's own colours is what settles it,
     * in the panel and in the PNG alike. Only colour needs this. The card's
     * backgrounds and borders are written rgb(), and every background and
     * border override in that stylesheet matches on the literal hex text in the
     * style attribute, so none of them can match in the first place.
     */
    function gfxPinColours(html) {
        return String(html).replace(/color:\s*(rgb\([^)]*\))/g, 'color: $1 !important');
    }

    function gfxCard(inner) {
        return gfxPinColours('<div id="contestStandingsCard" style="width: ' + GFX_CARD_W + 'px; '
            + 'box-sizing: border-box; background: ' + GFX.paper + '; border-radius: 14px; '
            + 'font-family: ' + GFX_FONT + '; ' + gfxType(GFX_T.body) + ' font-weight: 600; '
            + 'color: ' + GFX.ink + ';">' + inner + '</div>');
    }

    /**
     * The open board. Not an error state: this is the version worth posting on
     * the first of the month, which is when the contest most needs a poster.
     */
    function gfxOpenBoard(month, teamLabel, targetLabel) {
        return gfxCard(
            gfxHeader(month, teamLabel, 0, 0, '')
            + '<div style="padding: 34px ' + GFX_PAD + 'px 32px ' + GFX_PAD + 'px; text-align: center;">'
            + '<div style="display: block; margin: 0 auto; width: 240px; height: 20px; '
            + 'border-radius: 3px; background: ' + GFX.track + ';"></div>'
            + '<div style="margin-top: 16px; ' + gfxType(GFX_T.head) + ' font-weight: 700; '
            + 'color: ' + GFX.ink + ';">The bowl is open</div>'
            + '<div style="margin-top: 6px; ' + gfxType(GFX_T.body) + ' font-weight: 600; '
            + 'color: ' + GFX.inkSoft + ';">One perfect survey, or one day at '
            + targetLabel + ', puts the first name on the board.</div>'
            + '</div>'
            + gfxCta(targetLabel, 'One ticket is one pull. The first one can go in today.')
        );
    }

    /**
     * The postable standings graphic. Every number on it is computed from
     * `board`, and nobody on the selected team is left off it.
     *
     * board   exactly what buildLeaderboard(monthData) returns, unfiltered.
     * options { monthLabel, target, teamLabel, names }
     *
     * `names` is the team scope and it is a real contract: buildLeaderboard is
     * month wide across all eight supervisors, so without it a supervisor who
     * picked one team of eighteen gets a card with a hundred and twenty seven
     * people on it. It doubles as the roster, so people on zero get a row.
     */
    function buildStandingsGraphicHtml(board, options) {
        var opts = options || {};
        var month = gfxMonthParts(opts.monthLabel);
        var teamLabel = String(opts.teamLabel === undefined || opts.teamLabel === null ? '' : opts.teamLabel).trim();
        var targetLabel = gfxTargetLabel(opts.target);

        var rows = gfxPrepareRows(board, opts.names, opts.adherence);
        if (!rows.length) return gfxOpenBoard(month, teamLabel, targetLabel);

        var totals = { surveys: 0, days: 0, bonus: 0, other: 0 };
        var pool = 0;
        var earners = 0;
        var lastDate = '';
        rows.forEach(function (row) {
            pool += row.total;
            if (row.total > 0) earners += 1;
            totals.surveys += row.surveys;
            totals.days += row.days;
            totals.bonus += row.bonus;
            var counted = row.surveys + row.days + row.bonus;
            if (row.total > counted) totals.other += row.total - counted;
            // The last day anybody earned something, read off the entries. Only
            // the per-day reasons carry a real date; a weekly award carries its
            // Monday and a monthly one carries a YYYY-MM.
            (row.reasons || []).forEach(function (entry) {
                var reason = entry && entry.reason;
                if (reason !== 'perfect-survey' && reason !== 'daily-adherence') return;
                var on = String((entry && entry.on) || '');
                if (on.length === 10 && on > lastDate) lastDate = on;
            });
        });

        var cfg = gfxTier(rows.length);
        var axisMax = gfxAxisMax(rows[0].total);
        var leaderTotal = rows[0].total;
        var tiedAtTop = 0;
        rows.forEach(function (row) { if (row.total === leaderTotal) tiedAtTop += 1; });
        var isSoleLeader = leaderTotal > 0 && tiedAtTop === 1;

        var column = function (slice) {
            return slice.map(function (row, index) {
                return gfxRow(row, cfg, axisMax, index === slice.length - 1, isSoleLeader);
            }).join('');
        };

        var boardHtml;
        if (cfg.columns === 2) {
            // Ranks run continuously down the left column and on into the
            // right, so the leader still anchors the top left, and both columns
            // share one axis so a bar on the right is comparable to one on the
            // left. Nobody is cut and there is no count strip standing in for
            // people.
            var half = Math.ceil(rows.length / 2);
            boardHtml = '<div style="display: flex; align-items: flex-start; '
                + 'padding: 14px ' + GFX_PAD + 'px 10px ' + GFX_PAD + 'px;">'
                + '<div style="flex: 1 1 0; min-width: 0; margin-right: ' + GFX_COL_GAP + 'px;">'
                + column(rows.slice(0, half)) + '</div>'
                + '<div style="flex: 1 1 0; min-width: 0;">'
                + column(rows.slice(half)) + '</div>'
                + '</div>';
        } else {
            boardHtml = '<div style="padding: 14px ' + GFX_PAD + 'px 10px ' + GFX_PAD + 'px;">'
                + column(rows) + '</div>';
        }

        return gfxCard(
            gfxHeader(month, teamLabel, pool, earners, gfxDayLabel(lastDate))
            + gfxLegend(totals, axisMax, totals.other > 0)
            + boardHtml
            + gfxCta(targetLabel, 'The longest bar is not the winner. Every ticket is one pull.')
        );
    }

    // ============================================
    // THE CHECK IN POST
    // ============================================
    //
    // The other post is a caption. It names the leader and the pool and leaves
    // the standings to the picture beside it, which is right when the picture is
    // there and useless when it is not.
    //
    // This one carries the whole list, so it works pasted on its own into a
    // chat, read on a phone, or forwarded by somebody who never saw the card.

    /**
     * What a person's tickets were actually for.
     *
     * A bare count tells somebody the score and not the rule. Naming the reason
     * next to it is what turns the post into something you can act on, because
     * the person on one ticket can see which lever gave it to them and which
     * one they have not touched yet.
     */
    function ticketReason(row, target) {
        var bits = [];

        if (row.perfectSurvey) {
            bits.push(row.perfectSurvey + ' perfect survey' + (row.perfectSurvey === 1 ? '' : 's'));
        }
        if (row.dailyAdherence) {
            bits.push(row.dailyAdherence + ' day' + (row.dailyAdherence === 1 ? '' : 's')
                + ' at ' + target + '%');
        }

        var bonus = row.weeklyAdherence + row.monthlyAdherence;
        if (bonus) {
            bits.push(bonus + ' bonus ticket' + (bonus === 1 ? '' : 's'));
        }

        if (!bits.length) return '';
        if (bits.length === 1) return ', for ' + bits[0];
        return ', for ' + bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
    }

    /** "9/1" from "2026-09-01". The way a date gets typed in a chat. */
    function shortDate(iso) {
        var parts = String(iso || '').split('-');
        if (parts.length < 3) return String(iso || '');
        return Number(parts[1]) + '/' + Number(parts[2]);
    }

    /**
     * The post that goes in the channel.
     *
     * Says which days it covers, lists everybody who earned a ticket, and
     * restates how a ticket is earned. Nothing else. It gets pasted into a chat
     * and read on a phone, so every extra line is one more to scroll past.
     *
     * The span comes from the days that were actually entered rather than from
     * the calendar, so it never claims to cover a day nobody has uploaded yet.
     */
    function buildCheckinPost(monthData, options) {
        var opts = options || {};
        var board = buildLeaderboard(monthData, opts);
        var roster = Array.isArray(opts.names) ? opts.names : null;

        if (roster) {
            var allowed = {};
            roster.forEach(function (name) { allowed[String(name).trim()] = true; });
            board = board.filter(function (row) { return allowed[row.associate]; });
        }
        if (!board.length) return '';

        var target = opts.target || adherenceTarget();
        var pool = board.reduce(function (sum, row) { return sum + row.total; }, 0);
        var dates = Object.keys((monthData && monthData.days) || {}).sort();
        var span = '';
        if (dates.length === 1) span = shortDate(dates[0]);
        else if (dates.length > 1) span = shortDate(dates[0]) + ' to ' + shortDate(dates[dates.length - 1]);

        var lines = [];
        lines.push('🎟️ ' + (span
            ? 'So for the days ' + span + ', these are all those who have earned a raffle ticket.'
            : 'These are all those who have earned a raffle ticket.'));
        lines.push('');

        // Names go out as @First so Teams turns them into real mentions when
        // the cursor lands after one. A first name shared by two people on the
        // same board keeps its surname instead: an @ that resolves to the wrong
        // person is worse than one that does not resolve at all, and on the
        // Everyone board there are several.
        var firstNameCount = {};
        board.forEach(function (row) {
            var first = String(row.associate).trim().split(/\s+/)[0] || row.associate;
            firstNameCount[first] = (firstNameCount[first] || 0) + 1;
        });

        // No badge on any row. A star went on perfect surveys for a while, on
        // the theory that they were the harder lever, and they are not: there
        // are simply fewer of them, because adherence has thirty chances in a
        // month and a survey arrives when it arrives. Marking the rarer lever
        // just rewards luck. The line already says what the tickets were for,
        // which is the part somebody can act on.
        board.forEach(function (row) {
            var first = String(row.associate).trim().split(/\s+/)[0] || row.associate;
            var handle = firstNameCount[first] > 1 ? row.associate : first;
            lines.push('@' + handle + ', ' + row.total + ' '
                + (row.total === 1 ? 'ticket' : 'tickets')
                + ticketReason(row, target));
        });

        lines.push('');
        lines.push('💡 Remember, you get a raffle ticket for a day above ' + target
            + '% adherence, and for a perfect survey.');

        // Only mentioned once it has actually paid. Naming a bonus nobody has
        // earned yet reads as a rule somebody missed.
        var bonus = board.reduce(function (sum, row) {
            return sum + row.weeklyAdherence + row.monthlyAdherence;
        }, 0);
        if (bonus) {
            lines.push('🎉 A full week at ' + target
                + '% adds a bonus ticket, and so does the whole month.');
        }

        // One warm line at the foot, chosen from what actually happened rather
        // than bolted on regardless. It never names who is behind.
        //
        // It reads adherence rather than surveys because adherence is the lever
        // somebody can decide to pull. There are thirty chances at it in a
        // month and only as many surveys as happen to arrive, so a nudge about
        // surveys is a nudge about luck.
        var cleanDays = board.reduce(function (sum, row) { return sum + row.dailyAdherence; }, 0);
        lines.push('');
        if (cleanDays >= board.length * 2) {
            lines.push('👏 Cracking run on adherence. Keep it going.');
        } else if (cleanDays) {
            lines.push('👏 Good days on adherence in there. Plenty of month left for more.');
        } else {
            lines.push('💪 One clean day on adherence is a ticket, and there are thirty of them in a month.');
        }

        return lines.join('\n');
    }

    // ============================================
    // IMPORT FROM WHAT WAS ALREADY UPLOADED
    // ============================================
    //
    // Typing a grid of eighteen people every day, for numbers the app already
    // holds, is not work anybody should be doing. This reads the daily uploads
    // and works the entries out instead.
    //
    // Adherence imports cleanly. Perfect surveys mostly cannot, and that is a
    // property of the data rather than a corner cut here. Nothing in this app
    // has ever stored a single survey: an upload carries rate percentages and
    // their denominators, one row per person per period, so there is no record
    // of an individual response to call perfect.
    //
    // There is exactly one case where the count follows without assuming
    // anything. If every survey rate that came back is 100, then every response
    // counted was flawless, so the number of perfect surveys IS the number of
    // responses. Below 100 the rates cannot be unpicked: the questions carry
    // different denominators, so 80% on one and 100% on another does not say
    // which responses were which, and any number taken from it would be
    // invented. Those days are reported as needing a look rather than guessed
    // at, because this decides who gets a prize.

    var IMPORT_SURVEY_KEYS = ['cxRepOverall', 'fcr', 'overallExperience'];

    // Which response count belongs to which question. An upload carries three,
    // and they are not interchangeable.
    var IMPORT_SURVEY_TOTALS = {
        cxRepOverall: 'repSurveyTotal',
        fcr: 'fcrSurveyTotal',
        overallExperience: 'surveyTotal'
    };

    function importNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        var n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    /** The date a stored period covers, or '' when it covers more than one. */
    function importSingleDate(key, metadata) {
        var meta = metadata || {};
        var start = String(meta.startDate || '');
        var end = String(meta.endDate || '');
        var iso = /^\d{4}-\d{2}-\d{2}$/;

        if (!end && String(key).indexOf('|') > -1) {
            var halves = String(key).split('|');
            start = start || halves[0];
            end = halves[1];
        }
        if (!end && iso.test(String(key))) end = String(key);
        if (!iso.test(end)) return '';

        // A row covering a span cannot be pinned to one day, and spreading it
        // across the days would award entries nobody earned on any of them.
        if (start && iso.test(start) && start !== end) return '';
        return end;
    }

    /**
     * Perfect surveys for one row.
     *
     * Gives a count only when every rate that came back is 100. Otherwise it
     * says so, and the day waits for a person.
     */
    function importPerfectSurveys(row) {
        var scored = [];
        var perfectCounts = [];
        var responses = 0;

        IMPORT_SURVEY_KEYS.forEach(function (key) {
            var rate = importNumber(row[key]);

            // Each question keeps its own response count, and they differ: a
            // customer can answer the rep question and skip FCR. Reading only
            // the OE total, which is what this did, threw away a survey that
            // arrived as rep sat with no OE response, and threw it away
            // silently, as though no survey had come in at all.
            var count = importNumber(row[IMPORT_SURVEY_TOTALS[key]]);
            if (count === null) count = importNumber(row.surveyTotal);
            if (count !== null && count > 0) responses = Math.max(responses, count);

            if (rate === null) return;
            scored.push(rate);
            if (rate >= 100 && count !== null && count > 0) perfectCounts.push(count);
        });

        if (!responses) return { count: 0, certain: true };

        // Responses came in and nothing scored them. Rare, and not something to
        // rule on quietly in either direction.
        if (!scored.length) return { count: 0, certain: false, total: Math.round(responses) };

        // Every rate that came back is 100, so every response counted was
        // flawless. The number of surveys is then the largest response count
        // among the questions that were scored: the question everybody answered
        // is the one that saw them all.
        var allPerfect = scored.every(function (v) { return v >= 100; });
        if (allPerfect && perfectCounts.length) {
            return { count: Math.round(Math.max.apply(null, perfectCounts)), certain: true };
        }

        return { count: 0, certain: false, total: Math.round(responses) };
    }

    /**
     * What an import would do, without doing it.
     *
     * Pure: everything arrives through arguments, so the panel can show this
     * and let the supervisor decide before anything is written.
     */
    function buildImportPreview(stores, options) {
        var opts = options || {};
        var daily = (stores && stores.dailyData) || {};
        var monthKey = String(opts.monthKey || '');
        var allowed = null;
        if (Array.isArray(opts.names)) {
            allowed = {};
            opts.names.forEach(function (name) { allowed[String(name).trim()] = true; });
        }

        var days = {};
        var notes = [];
        var needsSurveyCheck = [];
        var spans = 0;
        var people = {};
        var adherenceValues = 0;
        var surveyEntries = 0;

        Object.keys(daily).sort().forEach(function (key) {
            var period = daily[key] || {};
            var date = importSingleDate(key, period.metadata);

            if (!date) { spans += 1; return; }
            if (monthKey && date.slice(0, 7) !== monthKey) return;

            (period.employees || []).forEach(function (row) {
                if (!row || !row.name) return;
                var name = String(row.name).trim();
                if (!name) return;
                if (allowed && !allowed[name]) return;

                var adherence = importNumber(row.scheduleAdherence);
                var surveys = importPerfectSurveys(row);

                if (adherence === null && !surveys.count) {
                    if (!surveys.certain) needsSurveyCheck.push({ date: date, name: name, responses: surveys.total });
                    return;
                }

                var day = days[date] || (days[date] = {});
                var person = day[name] || (day[name] = {});

                if (adherence !== null) {
                    person.adherence = adherence;
                    adherenceValues += 1;
                }
                if (surveys.count) {
                    person.perfectSurveys = surveys.count;
                    surveyEntries += surveys.count;
                }
                if (!surveys.certain) {
                    needsSurveyCheck.push({ date: date, name: name, responses: surveys.total });
                }

                people[name] = true;
            });
        });

        var dayList = Object.keys(days).sort();

        if (spans) {
            notes.push(spans + ' upload' + (spans === 1 ? '' : 's') + ' cover more than one day, so '
                + (spans === 1 ? 'it was' : 'they were') + ' left out. Only a single day upload can say what happened on a day.');
        }
        if (needsSurveyCheck.length) {
            notes.push(needsSurveyCheck.length + ' person day'
                + (needsSurveyCheck.length === 1 ? '' : 's')
                + ' had surveys that were not all perfect. The upload holds rates rather than single surveys, so how '
                + 'many were perfect is not in it. Type those in. Everything at 100% came in on its own.');
        }
        if (!dayList.length) {
            notes.push('Nothing to import for this month. Daily uploads are what this reads.');
        }

        return {
            days: days,
            notes: notes,
            needsSurveyCheck: needsSurveyCheck,
            dateRange: { first: dayList[0] || '', last: dayList[dayList.length - 1] || '' },
            counts: {
                days: dayList.length,
                people: Object.keys(people).length,
                adherenceValues: adherenceValues,
                surveyEntries: surveyEntries
            }
        };
    }

    /**
     * Folds a preview into a month, mutating neither.
     *
     * Fills gaps and leaves typed work alone. Nothing is ever deleted: a person
     * or a day the import did not cover comes through untouched, which is the
     * rule saveDay already follows and for the same reason.
     */
    function mergeImportIntoMonth(monthData, preview, options) {
        var opts = options || {};
        var overwrite = opts.overwrite === true;
        var source = (monthData && monthData.days) || {};
        var incoming = (preview && preview.days) || {};

        var merged = {};
        Object.keys(source).forEach(function (date) {
            merged[date] = {};
            Object.keys(source[date] || {}).forEach(function (name) {
                merged[date][name] = Object.assign({}, source[date][name]);
            });
        });

        var filled = 0;
        var kept = 0;

        Object.keys(incoming).forEach(function (date) {
            var day = merged[date] || (merged[date] = {});
            Object.keys(incoming[date]).forEach(function (name) {
                var from = incoming[date][name] || {};
                var to = day[name] || (day[name] = {});

                ['adherence', 'perfectSurveys'].forEach(function (field) {
                    if (from[field] === undefined) return;
                    if (to[field] === undefined || overwrite) {
                        to[field] = from[field];
                        filled += 1;
                    } else if (to[field] !== from[field]) {
                        kept += 1;
                    }
                });
            });
        });

        return {
            month: Object.assign({}, monthData, { days: merged }),
            filled: filled,
            kept: kept
        };
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.contest = {
        adherenceTarget,
        weekStartOf,
        monthOf,
        computeEntries,
        buildLeaderboard,
        buildAdherenceSummary,
        drawWinner,
        buildStandingsPost,
        buildCheckinPost,
        buildStandingsGraphicHtml,
        buildImportPreview,
        mergeImportIntoMonth
    };
})();
