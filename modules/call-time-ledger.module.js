(function() {
    'use strict';

    /**
     * Where a long call's time actually went.
     *
     * The handle time coaching could say "about four minutes of silence
     * starting at 5:54" and never say that the call ran 39 minutes against a
     * seven minute target. Naming the moment without naming the size of the
     * problem leaves the associate to work out whether four minutes matters,
     * and on a 39 minute call it is a tenth of it.
     *
     * Every number here is measured, not modelled. Verint stamps each turn, so
     * the gaps between them are real, and the header carries the call length.
     * Where the transcript is not timed this declines rather than estimating:
     * a made up budget for a real call is worse than no budget.
     *
     * On the buckets themselves. Hold and quiet are measured directly. Talk is
     * the residual, everything the gaps do not account for, and it is reported
     * as such rather than dressed up as a measurement of speech. And none of
     * them is called waste: a four minute hold on a complicated billing call
     * may be exactly right. This says where the time went and leaves the
     * judgement to the supervisor, who listened to it.
     */

    // Below this a gap is the ordinary rhythm of a conversation, not a pause
    // anybody would notice. It matches the transcript engine's own threshold.
    const NOTICEABLE_GAP_SECONDS = 45;

    // A call has to be meaningfully over target before a budget is worth
    // showing. Twenty percent of a seven minute target is about ninety
    // seconds, which is a hold, not rounding.
    const OVER_TARGET_SHARE = 0.2;

    const RESOLUTION = /you'?re all set|all set on our end|that'?s (?:all )?(?:taken care of|done|set up)|i(?:'?ve| have) (?:credited|refunded|updated|submitted|processed)|your (?:order|account|service) is (?:set|created|started)/i;

    /*
     * There is no verification bucket, and there was.
     *
     * It measured the identity check as the span from the first such question
     * to the last, which on a real call came out at eight minutes and led the
     * sentence: the three matching lines were at 0:13, 2:37 and 7:56, so the
     * "block" was most of the call. Worse, the middle one was the customer
     * explaining they had no social security number yet, attributed to the
     * advisor by the unlabelled parser.
     *
     * Both faults are fixable in principle and neither is worth it. Silence,
     * hold and the tail are measured off timestamps and the hold announcement,
     * which hold up. A fourth number that is confidently wrong would discredit
     * the three that are right.
     */

    function seconds(value) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : 0;
    }

    /**
     * "4 minutes", "90 seconds", "1 minute". Spoken, not a stopwatch reading.
     */
    function spoken(total) {
        const value = Math.round(seconds(total));
        if (!value) return '';
        if (value < 90) return `${value} seconds`;
        const minutes = Math.round(value / 60);
        // The singular cannot fire while the cutoff is 90, since anything that
        // reaches here rounds to two minutes or more. The guard stays because
        // the cutoff is a tuning knob and "1 minutes" is the sort of thing
        // nobody notices until it is in a message with their name on it.
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }

    function clock(total) {
        const value = Math.max(0, Math.round(seconds(total)));
        return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
    }

    /**
     * How long the call ran.
     *
     * The Verint header is the authority. Failing that, the last timestamp is
     * a floor rather than a length, since the call carried on past whatever
     * was said last, so it is only used when the header is absent and it is
     * marked as approximate.
     */
    function totalSeconds(meta, turns) {
        const fromHeader = seconds(meta?.durationSeconds);
        if (fromHeader) return { total: fromHeader, exact: true };

        const stamps = turns.filter(turn => typeof turn.at === 'number').map(turn => turn.at);
        if (!stamps.length) return { total: 0, exact: false };
        return { total: Math.max(...stamps), exact: false };
    }

    /**
     * The stretch after the associate first said it was sorted.
     *
     * Nothing else in the app measures this and it is often the largest thing
     * an associate can actually change: the call is done, the customer knows
     * it is done, and it carries on. Descriptive on purpose. Some of that time
     * is legitimate, and the supervisor listened to the call.
     */
    function tailAfterResolution(turns, total) {
        const timed = turns.filter(turn => typeof turn.at === 'number');
        const resolved = timed.find(turn => turn.role !== 'customer' && RESOLUTION.test(turn.text));
        if (!resolved || !total) return null;

        const after = total - resolved.at;
        if (after < NOTICEABLE_GAP_SECONDS) return null;
        return { at: resolved.at, seconds: after };
    }

    /**
     * Splits a call's length into what can be measured from its timestamps.
     */
    function buildLedger(rawText, options = {}) {
        const analyzer = window.DevCoachModules?.callTranscript;
        if (!analyzer?.parseTranscript) return { ok: false, reason: 'parser-unavailable' };

        const transcript = String(rawText || '').trim();
        if (!transcript) return { ok: false, reason: 'empty' };

        const analysis = options.analysis
            || analyzer.analyzeTranscript(transcript, { associateName: options.associateName });
        if (!analysis?.ok) return { ok: false, reason: 'unreadable' };

        const parsed = analyzer.parseTranscript(transcript, { associateName: options.associateName });
        const meta = analysis.meta || analyzer.extractMetadata(transcript);
        const { total, exact } = totalSeconds(meta, parsed.turns);

        // Without timestamps there is nothing to split. Estimating a budget
        // for a real call is worse than declining to.
        if (!total || !parsed.timed) return { ok: false, reason: 'not-timed' };

        const gaps = analysis.silenceGaps || [];
        const held = gaps.filter(gap => gap.announced);
        const quiet = gaps.filter(gap => !gap.announced);

        const holdSeconds = held.reduce((sum, gap) => sum + seconds(gap.silence), 0);
        const quietSeconds = quiet.reduce((sum, gap) => sum + seconds(gap.silence), 0);

        const target = seconds(options.target);
        const over = target ? total - target : 0;

        return {
            ok: true,
            exact,
            total,
            target,
            over: over > 0 ? over : 0,
            // Meaningfully over, rather than over by a rounding error.
            overTarget: Boolean(target) && over > target * OVER_TARGET_SHARE,
            hold: { seconds: holdSeconds, count: held.length, longest: held[0] || null },
            quiet: { seconds: quietSeconds, count: quiet.length, longest: quiet[0] || null },
            // Everything the gaps do not account for. Talking, short pauses,
            // typing. Named as a residual because that is what it is.
            accountedFor: holdSeconds + quietSeconds,
            everythingElse: Math.max(0, total - holdSeconds - quietSeconds),
            tail: tailAfterResolution(parsed.turns, total)
        };
    }

    /**
     * The biggest movable chunks, largest first.
     *
     * "Everything else" is left out: it is the residual, and telling somebody
     * that most of a call was spent talking to the customer is not coaching.
     *
     * Each part is written twice. `text` goes into a sentence that strings
     * three of them together with commas, so it carries no timestamp of its
     * own: "two minutes on hold, two minutes of quiet and 72 seconds after you
     * told them it was sorted, from 17:12" trails off into a stopwatch reading
     * exactly where the sentence should be landing. `detail` is the panel
     * version, where the supervisor does want the timestamp, because they are
     * about to go and listen to that part of the call.
     */
    function movableParts(ledger) {
        if (!ledger?.ok) return [];

        const parts = [];
        if (ledger.hold.seconds >= NOTICEABLE_GAP_SECONDS) {
            const text = ledger.hold.count > 1
                ? `${spoken(ledger.hold.seconds)} across ${ledger.hold.count} holds`
                : `${spoken(ledger.hold.seconds)} on hold`;
            parts.push({
                key: 'hold',
                seconds: ledger.hold.seconds,
                text,
                detail: ledger.hold.longest
                    ? `${text}, the longest starting at ${clock(ledger.hold.longest.at)}`
                    : text
            });
        }
        if (ledger.quiet.seconds >= NOTICEABLE_GAP_SECONDS) {
            const text = `${spoken(ledger.quiet.seconds)} of quiet with no hold announced`;
            parts.push({
                key: 'quiet',
                seconds: ledger.quiet.seconds,
                text,
                detail: ledger.quiet.longest
                    ? `${text}, the longest starting at ${clock(ledger.quiet.longest.at)}`
                    : text
            });
        }
        if (ledger.tail) {
            const text = `${spoken(ledger.tail.seconds)} after you told them it was sorted`;
            parts.push({
                key: 'tail',
                seconds: ledger.tail.seconds,
                text,
                detail: `${text}, which was at ${clock(ledger.tail.at)}`
            });
        }
        return parts.sort((a, b) => b.seconds - a.seconds);
    }

    /**
     * One sentence for the associate, or nothing.
     *
     * Only when the call is meaningfully over target and something movable can
     * be named. A budget on a call that came in on time is a statistic, and a
     * budget with nothing in it is a number she cannot act on.
     *
     * The call has to be named. These numbers are one call's, and a message
     * can cover four, so "this one ran 39 minutes" sitting under a paragraph
     * about all four calls reads as a claim about all four. Where the caller
     * cannot say which call it was, the sentence is dropped rather than
     * hedged.
     */
    function buildLedgerSentence(ledger, options = {}) {
        if (!ledger?.ok || !ledger.overTarget) return '';

        const parts = movableParts(ledger).slice(0, 3);
        if (!parts.length) return '';

        const named = parts.length === 1
            ? parts[0].text
            : `${parts.slice(0, -1).map(part => part.text).join(', ')} and ${parts[parts.length - 1].text}`;

        const callName = String(options.callName || '').trim() || 'that call';
        const length = spoken(ledger.total);
        const targetText = spoken(ledger.target);
        const about = ledger.exact ? '' : 'about ';

        return `To put a size on it, ${callName} ran ${about}${length} where we aim for around ${targetText}, and the parts you can move are ${named}.`;
    }

    function buildLedgerHtml(ledger, escapeHtml) {
        const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        if (!ledger?.ok) return '';

        const rows = movableParts(ledger)
            .map(part => `<li><strong>${safe(spoken(part.seconds))}</strong> <span class="call-qa-detail">${safe(part.detail)}</span></li>`)
            .join('');

        const header = ledger.target
            ? `${spoken(ledger.total)} against a target of ${spoken(ledger.target)}${ledger.over ? `, over by ${spoken(ledger.over)}` : ''}`
            : `${spoken(ledger.total)} on the phone`;

        // Two caveats, both of which change how the number should be read.
        // Handle time also counts the wrap after the customer has gone, which
        // no transcript contains, so the real figure is a little higher than
        // this. And the remainder is a subtraction, not a measurement.
        const residual = `<div class="call-qa-detail">The other ${spoken(ledger.everythingElse)} is everything the gaps do not account for: talking, short pauses, typing. That is a subtraction rather than a measurement, and wrap time is not in any of it, so the handle time on this call was a little higher again.</div>`;

        return `<div class="call-trend-group call-trend-warn">
            <div class="call-trend-title">Where the time went: ${safe(header)}</div>
            ${rows ? `<ul>${rows}</ul>` : '<div class="call-qa-detail">Nothing measurable stands out, so the length is in the conversation itself.</div>'}
            ${residual}
        </div>`;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callTimeLedger = {
        buildLedger,
        movableParts,
        buildLedgerSentence,
        buildLedgerHtml,
        spoken,
        NOTICEABLE_GAP_SECONDS,
        OVER_TARGET_SHARE
    };
})();
