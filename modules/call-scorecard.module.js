(function() {
    'use strict';

    /**
     * The call scorecard: the same lines on every call, and the numbers.
     *
     * Scott, 2026-10-25: "provide real actual measurable feedback". The read
     * of a call already knew a lot (the hold at 4:30, a minute of quiet, the
     * greeting, the recap that never came), but it came out as prose bullets
     * that change shape from call to call, and the numbers sat folded under
     * More. Nothing could be added up, so no trend could be drawn.
     *
     * So every call gets the same ten lines, taken from the APS Interaction
     * Review form and the goals they move, each one Yes, Missed, Didn't apply,
     * or Check (the transcript cannot say), with the time to listen at. Under
     * them the measured numbers. The score is "8 of the 9 that applied".
     *
     * The reader is good and not perfect, so every line can be corrected with
     * a click, and the corrected card is the one saved on the call. That is
     * what makes a saved card the truth: anything added up later reads what
     * Scott confirmed, not what a pattern guessed.
     *
     * The card adds no findings of its own. Each line is read off the reads the
     * page already does (call-transcript, call-verification, call-explanation,
     * call-qa, call-word-choice), so the card, the notes and the QA form never
     * disagree about the same call.
     */

    const VERSION = 1;

    const VERDICT = { yes: 'yes', missed: 'missed', na: 'na', check: 'check' };

    // A click moves a line along this ring. Check is only ever the reader's
    // answer: once Scott has listened, it is one of the other three.
    const NEXT_VERDICT = { yes: 'missed', missed: 'na', na: 'yes', check: 'yes' };

    const VERDICT_WORDS = { yes: 'Yes', missed: 'Missed', na: "Didn't apply", check: 'Check' };
    const VERDICT_TONE = { yes: 'pill-good', missed: 'pill-bad', na: '', check: 'pill-warn' };

    /* ── The lines ──
     *
     * `metrics` is what a miss on the line moves, the same mapping the metric
     * chips use (call-coaching-bridge EVIDENCE_MAP), so a pattern across calls
     * can be read against the weekly numbers. `made` and `missing` are what a
     * correction writes into the notes when the reader had no text of its own.
     */
    const LINES = [
        {
            key: 'greeting',
            label: 'Branded greeting and name',
            metrics: ['positiveWord', 'cxRepOverall']
        },
        {
            key: 'verified',
            label: 'Verified before any account information',
            metrics: ['cxRepOverall'],
            made: 'You confirmed who you were talking to before anything on the account came up. That is the one that protects everybody.',
            missing: "Verify the caller before anything on the account comes up: their name plus the last four of the social, a driver's license or the account password."
        },
        {
            key: 'empathy',
            label: 'Empathy when the customer had a problem',
            metrics: ['managingEmotions', 'cxRepOverall', 'overallSentiment']
        },
        {
            key: 'hold',
            label: 'Hold done right',
            metrics: ['holdTime', 'aht', 'cxRepOverall'],
            made: 'Textbook hold. You flagged it before it happened and thanked them on the way back.',
            missing: 'The hold got a bit loose. Ask first, give them a rough idea how long, and thank them when you pick back up.'
        },
        {
            key: 'silence',
            label: 'No long quiet stretch',
            metrics: ['aht', 'holdTime'],
            made: 'You kept the customer in the loop, with no long quiet stretches for them to sit through.',
            missing: 'Tell the customer what you are doing while the system loads so the quiet does not stack up.'
        },
        {
            key: 'explained',
            label: 'Explained so the customer followed',
            metrics: ['fcr', 'cxRepOverall'],
            made: 'You explained it in a way the customer could follow, and checked it landed.',
            missing: 'When the customer gets lost, come at it from a different side instead of saying it again the same way, then ask them to say it back.'
        },
        {
            key: 'offered',
            label: 'The right option offered when it fit',
            metrics: ['fcr', 'cxRepOverall'],
            made: 'You put the right option in front of the customer instead of waiting for them to ask.',
            missing: 'There was a plan or a program that would have fitted here and it did not get offered. Worth mentioning even when they have not asked.'
        },
        {
            key: 'nextSteps',
            label: 'Next steps, with the when and the amount',
            metrics: ['fcr', 'cxRepOverall']
        },
        {
            key: 'recap',
            label: 'Recap before the close',
            metrics: ['fcr', 'cxRepOverall']
        },
        {
            key: 'anythingElse',
            label: '"Anything else?" before the close',
            metrics: ['positiveWord', 'cxRepOverall']
        }
    ];

    // The reader's own rule texts, for the lines that come straight from a
    // call-transcript rule. Kept there so a correction writes the same words
    // Analyze would have.
    const TRANSCRIPT_RULE = {
        greeting: 'greeting',
        empathy: 'empathy',
        nextSteps: 'nextSteps',
        recap: 'recap',
        anythingElse: 'courtesyClose'
    };

    /* ── Helpers ── */

    function clock(seconds) {
        if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
        const whole = Math.max(0, Math.round(seconds));
        const hours = Math.floor(whole / 3600);
        const minutes = Math.floor((whole % 3600) / 60);
        const secs = String(whole % 60).padStart(2, '0');
        return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
    }

    function byKey(items) {
        const map = {};
        (items || []).forEach(item => {
            if (item && item.key && !map[item.key]) map[item.key] = item;
        });
        return map;
    }

    // Where in the call a quote was said, so a line says when to listen.
    function timeOf(turns, quote) {
        const needle = String(quote || '').replace(/^\.\.\.|\.\.\.$/g, '').trim().toLowerCase().slice(0, 40);
        if (!needle) return '';
        const turn = (turns || []).find(item => typeof item.at === 'number'
            && String(item.text || '').toLowerCase().includes(needle));
        return turn ? clock(turn.at) : '';
    }

    function line(def, verdict, fields = {}) {
        return {
            key: def.key,
            label: def.label,
            verdict,
            auto: verdict,
            at: fields.at || '',
            quote: fields.quote || '',
            // The words the notes carry for this line, so a correction can
            // find them and take them out or put them in.
            coachText: fields.coachText || '',
            praiseText: fields.praiseText || ''
        };
    }

    /* ── Reading each line ── */

    function readRuleLine(def, ctx) {
        const strength = ctx.strengths[TRANSCRIPT_RULE[def.key]];
        const miss = ctx.improvements[TRANSCRIPT_RULE[def.key]];
        if (strength) {
            return line(def, VERDICT.yes, { quote: strength.quote, at: timeOf(ctx.turns, strength.quote), praiseText: strength.text });
        }
        if (miss) return line(def, VERDICT.missed, { coachText: miss.text });
        // A truncated call cannot show something never happened.
        if (ctx.truncated) return line(def, VERDICT.check);
        // Empathy is only owed on a call with something to empathise with,
        // and the reader drops the point on a routine call.
        if (def.key === 'empathy') return line(def, VERDICT.na);
        return line(def, VERDICT.check);
    }

    function readVerified(def, ctx) {
        const read = ctx.analysis.verification;
        if (!read || !read.ok) return line(def, VERDICT.check);
        if (read.status === 'breach') {
            const coaching = ctx.improvements.verification;
            return line(def, VERDICT.missed, {
                at: read.breach?.time || '',
                coachText: coaching?.text || def.missing
            });
        }
        if (read.status === 'verified' || read.status === 'held-back') {
            const ask = read.identity || (read.identityAsks || [])[0] || null;
            const strength = ctx.strengths.verification;
            return line(def, VERDICT.yes, {
                quote: ask?.quote || strength?.quote || '',
                at: ask?.time || timeOf(ctx.turns, ask?.quote || strength?.quote),
                praiseText: strength?.text || def.made
            });
        }
        // Nothing on the account came up, so there was nothing to protect.
        return line(def, VERDICT.na);
    }

    function readHold(def, ctx) {
        const gaps = ctx.analysis.silenceGaps || [];
        const loose = ctx.improvements.holdProcess;
        const long = ctx.improvements.longHold;
        const etiquette = ctx.strengths.holdEtiquette;
        const announced = gaps.filter(gap => gap.announced);

        if (loose || long) {
            const worst = announced[0];
            return line(def, VERDICT.missed, {
                at: worst ? clock(worst.at) : '',
                quote: loose?.quote || '',
                coachText: (long || loose).text
            });
        }
        if (etiquette) {
            return line(def, VERDICT.yes, { quote: etiquette.quote, at: timeOf(ctx.turns, etiquette.quote), praiseText: etiquette.text });
        }
        if (!announced.length) return line(def, VERDICT.na);
        return line(def, VERDICT.check);
    }

    function readSilence(def, ctx) {
        const quiet = (ctx.analysis.silenceGaps || []).filter(gap => !gap.announced);
        if (quiet.length) {
            const miss = ctx.improvements.deadAirGap;
            return line(def, VERDICT.missed, { at: clock(quiet[0].at), coachText: miss?.text || def.missing });
        }
        // Only timestamps can show the quiet that was not there.
        if (!ctx.analysis.stats?.timed || ctx.truncated) return line(def, VERDICT.check);
        return line(def, VERDICT.yes, { praiseText: ctx.strengths.keptMoving?.text || '' });
    }

    function readExplained(def, ctx) {
        const read = ctx.analysis.explanation;
        if (!read || !read.ok) return line(def, VERDICT.check);
        const coachable = read.coachable || [];
        if (coachable.length) {
            const first = coachable[0];
            return line(def, VERDICT.missed, {
                at: first.time || '',
                quote: first.customerQuote || '',
                coachText: ctx.improvements.explanation?.text || def.missing
            });
        }
        // Lost and never shown to land, on evidence too thin to coach (one
        // "what do you mean"): not a Yes either. Scott gives it a listen.
        if ((read.lost || []).length) {
            const first = read.lost[0];
            return line(def, VERDICT.check, { at: first.time || '', quote: first.customerQuote || '', coachText: def.missing });
        }
        if ((read.landed || []).length) {
            const first = read.landed[0];
            return line(def, VERDICT.yes, { at: first.time || '', praiseText: ctx.strengths.explanation?.text || '' });
        }
        // Nobody got lost. A call that explained something counts; one that
        // never needed to explain anything had nothing to land.
        return line(def, (read.explained || []).length ? VERDICT.yes : VERDICT.na);
    }

    function readOffered(def, ctx) {
        const opportunities = (ctx.qa?.callOpportunities || []).map(item => item.label);
        if (opportunities.includes('Solution/Program Offering Missed') || opportunities.includes('Did not Negotiate Payment')) {
            return line(def, VERDICT.missed, { coachText: def.missing });
        }
        const offered = ctx.strengths.optionsOffered || ctx.strengths.recommendation || ctx.strengths.education;
        if (offered) {
            return line(def, VERDICT.yes, { quote: offered.quote, at: timeOf(ctx.turns, offered.quote), praiseText: offered.text });
        }
        return line(def, VERDICT.na);
    }

    const READERS = {
        greeting: readRuleLine,
        verified: readVerified,
        empathy: readRuleLine,
        hold: readHold,
        silence: readSilence,
        explained: readExplained,
        offered: readOffered,
        nextSteps: readRuleLine,
        recap: readRuleLine,
        anythingElse: readRuleLine
    };

    /* ── The numbers ── */

    function readNumbers(ctx) {
        const gaps = ctx.analysis.silenceGaps || [];
        const holds = gaps.filter(gap => gap.announced);
        const quiet = gaps.filter(gap => !gap.announced);
        const sum = (items) => Math.round(items.reduce((total, gap) => total + Math.max(0, gap.silence || 0), 0));
        const longest = (items) => (items.length ? Math.round(Math.max(...items.map(gap => gap.silence || 0))) : 0);
        const length = ctx.length;
        const scan = ctx.wordChoice && ctx.wordChoice.ok ? ctx.wordChoice : null;
        const explanation = ctx.analysis.explanation;

        return {
            lengthSeconds: length ? Math.round(length.seconds) : null,
            goalSeconds: length ? Math.round(length.goal) : null,
            holdCount: holds.length,
            holdSeconds: sum(holds),
            longestHoldSeconds: longest(holds),
            quietCount: quiet.length,
            quietSeconds: sum(quiet),
            longestQuietSeconds: longest(quiet),
            // A share is only as good as the labels it is counted from.
            talkShare: typeof ctx.analysis.stats?.agentTalkShare === 'number'
                ? Math.round(ctx.analysis.stats.agentTalkShare * 100)
                : null,
            positivePhrases: scan ? scan.totals.positiveCount : null,
            phrasesToAvoid: scan ? scan.totals.negativeCount : null,
            customerLost: explanation && explanation.ok ? (explanation.lost || []).length : null,
            labeled: Boolean(ctx.analysis.stats?.labeled),
            timed: Boolean(ctx.analysis.stats?.timed)
        };
    }

    /* ── Building, scoring and correcting ── */

    /**
     * The card for one call. Takes the reads the page already has (analysis,
     * qa, wordChoice) and only does one itself when it was not handed it.
     */
    function buildScorecard(rawText, options = {}) {
        const transcript = String(rawText || '').trim();
        if (!transcript) return { ok: false, reason: 'empty' };

        const modules = window.DevCoachModules || {};
        const reader = modules.callTranscript;
        if (!reader?.analyzeTranscript) return { ok: false, reason: 'reader-unavailable' };

        const analysis = options.analysis || reader.analyzeTranscript(transcript, { associateName: options.associateName });
        if (!analysis || !analysis.ok) return { ok: false, reason: 'unreadable' };

        const parsed = reader.parseTranscript(transcript, { associateName: options.associateName });
        const qa = options.qa || modules.callQa?.scoreCall?.(transcript, {
            associateName: options.associateName,
            context: { silenceGaps: analysis.silenceGaps || [] }
        }) || null;
        const wordChoice = options.wordChoice || modules.callWordChoice?.scanTranscript?.(transcript, {
            associateName: options.associateName,
            analysis
        }) || null;

        const ctx = {
            analysis,
            qa,
            wordChoice,
            turns: parsed.turns || [],
            truncated: Boolean(analysis.stats?.truncated),
            strengths: byKey(analysis.allStrengths),
            improvements: byKey(analysis.allImprovements),
            length: reader.callLength ? reader.callLength(analysis.meta, parsed.turns, analysis.silenceGaps) : null
        };

        const lines = LINES.map(def => READERS[def.key](def, ctx));
        return {
            ok: true,
            version: VERSION,
            lines,
            numbers: readNumbers(ctx)
        };
    }

    function scoreOf(card) {
        const lines = card?.lines || [];
        const applied = lines.filter(item => item.verdict === VERDICT.yes || item.verdict === VERDICT.missed);
        const met = applied.filter(item => item.verdict === VERDICT.yes).length;
        return { met, applied: applied.length, missed: applied.length - met, toCheck: lines.filter(item => item.verdict === VERDICT.check).length };
    }

    function scoreText(card) {
        const score = scoreOf(card);
        if (!score.applied) return '';
        return `${score.met} of the ${score.applied} that applied`;
    }

    /**
     * The card with Scott's corrections on it. A correction that puts a line
     * back to what the reader said is no correction, and is dropped.
     */
    function applyCorrections(card, corrections) {
        if (!card || !card.lines) return card;
        const fixes = corrections || {};
        return Object.assign({}, card, {
            lines: card.lines.map(item => {
                const verdict = fixes[item.key];
                if (!verdict || !VERDICT[verdict] || verdict === item.auto) {
                    return Object.assign({}, item, { verdict: item.auto, corrected: false });
                }
                return Object.assign({}, item, { verdict, corrected: true });
            })
        });
    }

    function correctionsOf(card) {
        const out = {};
        (card?.lines || []).forEach(item => {
            if (item.corrected && item.verdict !== item.auto) out[item.key] = item.verdict;
        });
        return out;
    }

    function nextVerdict(verdict) {
        return NEXT_VERDICT[verdict] || VERDICT.yes;
    }

    /**
     * The words a line puts in the notes, or takes out, when it is corrected.
     * Missed puts the coaching in; Yes puts the praise in; either one takes
     * the other out.
     */
    function noteTextFor(item) {
        const def = LINES.find(entry => entry.key === item.key) || {};
        const rule = TRANSCRIPT_RULE[item.key];
        const ruleText = rule ? window.DevCoachModules?.callTranscript?.ruleText?.(rule) : null;
        return {
            coach: item.coachText || ruleText?.missing || def.missing || '',
            praise: item.praiseText || ruleText?.made || def.made || ''
        };
    }

    // Which goals the missed lines move, most often named first. For logging
    // the coaching against the weekly numbers that follow it.
    function missedMetrics(card) {
        const counts = {};
        (card?.lines || []).filter(item => item.verdict === VERDICT.missed).forEach(item => {
            const def = LINES.find(entry => entry.key === item.key);
            (def?.metrics || []).forEach(key => { counts[key] = (counts[key] || 0) + 1; });
        });
        const over = card?.numbers?.lengthSeconds && card?.numbers?.goalSeconds
            && card.numbers.lengthSeconds > card.numbers.goalSeconds * 1.5;
        if (over) counts.aht = (counts.aht || 0) + 1;
        return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    }

    /* ── Saying it ── */

    function minutes(seconds) {
        return clock(seconds);
    }

    // The numbers as short phrases, for the card and the Verint note.
    function numberPhrases(numbers) {
        const n = numbers || {};
        const out = [];
        if (n.lengthSeconds) {
            out.push(n.goalSeconds
                ? `Call ${minutes(n.lengthSeconds)}, goal ${minutes(n.goalSeconds)}`
                : `Call ${minutes(n.lengthSeconds)}`);
        }
        if (n.timed) {
            out.push(n.holdCount
                ? `${n.holdCount} hold${n.holdCount === 1 ? '' : 's'}, longest ${minutes(n.longestHoldSeconds)}`
                : 'No long holds');
            out.push(n.quietCount
                ? `Longest quiet ${minutes(n.longestQuietSeconds)}`
                : 'No long quiet');
        }
        if (typeof n.positivePhrases === 'number') {
            out.push(`${n.positivePhrases} scored phrase${n.positivePhrases === 1 ? '' : 's'}`);
        }
        if (typeof n.phrasesToAvoid === 'number' && n.phrasesToAvoid) {
            out.push(`${n.phrasesToAvoid} to avoid`);
        }
        if (typeof n.customerLost === 'number' && n.customerLost) {
            out.push(`Customer lost ${n.customerLost === 1 ? 'once' : `${n.customerLost} times`}`);
        }
        if (typeof n.talkShare === 'number') out.push(`Talked ${n.talkShare}% of the call`);
        return out;
    }

    /**
     * For the Verint note, which is supervisor-only (associates cannot see the
     * coaching log, Scott 2026-10-14), so the score can sit in it.
     */
    function buildScorecardText(card) {
        if (!card?.lines?.length) return '';
        const score = scoreText(card);
        // A saved card keeps keys, not labels, so the label comes from here.
        const labelOf = (item) => item.label || (LINES.find(def => def.key === item.key) || {}).label || item.key;
        const missed = card.lines.filter(item => item.verdict === VERDICT.missed)
            .map(item => `${labelOf(item)}${item.at ? ` (${item.at})` : ''}`);
        const lines = [`Scorecard: ${score || 'nothing that applied'}.`];
        if (missed.length) lines.push(`Missed: ${missed.join('; ')}.`);
        const numbers = numberPhrases(card.numbers);
        if (numbers.length) lines.push(`${numbers.join(', ')}.`);
        return lines.join('\n');
    }

    function buildScorecardHtml(card, escapeHtml) {
        const esc = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value == null ? '' : value);
        if (!card?.lines?.length) return '';
        const score = scoreText(card);
        const counts = scoreOf(card);

        const rows = card.lines.map(item => {
            const tone = VERDICT_TONE[item.verdict] || '';
            const title = item.corrected
                ? `You marked this. The read said ${VERDICT_WORDS[item.auto]}. Click to change.`
                : 'Click to correct';
            const quote = item.quote ? `<span class="text-muted-sm">"${esc(item.quote)}"</span>` : '';
            return `<tr>
                <td>${esc(item.label)}</td>
                <td><button type="button" class="call-score-chip pill ${tone}" data-score-key="${esc(item.key)}" title="${esc(title)}">${esc(VERDICT_WORDS[item.verdict])}${item.corrected ? ' ✎' : ''}</button></td>
                <td class="text-muted-sm">${item.at ? `at ${esc(item.at)}` : ''}</td>
                <td>${quote}</td>
            </tr>`;
        }).join('');

        const numbers = numberPhrases(card.numbers)
            .map(text => `<span class="pill">${esc(text)}</span>`)
            .join(' ');
        const check = counts.toCheck
            ? ` ${counts.toCheck} to check by ear.`
            : '';
        const sides = card.numbers && !card.numbers.labeled
            ? ' Speakers were worked out from the flow of the call, so give a Missed a listen before it goes out.'
            : '';

        return `<div class="card-sunken call-scorecard">
            <div class="flex-row" style="justify-content: space-between; align-items: baseline;">
                <span class="eyebrow">Scorecard</span>
                ${score ? `<span class="stat">${esc(score)}</span>` : ''}
            </div>
            <table class="data-table call-score-table"><tbody>${rows}</tbody></table>
            ${numbers ? `<div class="call-score-numbers">${numbers}</div>` : ''}
            <p class="text-muted-sm">Click a mark to correct it; the notes follow, and the corrected card is what is saved.${check}${sides}</p>
        </div>`;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callScorecard = {
        VERSION,
        VERDICT,
        LINES,
        buildScorecard,
        scoreOf,
        scoreText,
        applyCorrections,
        correctionsOf,
        nextVerdict,
        noteTextFor,
        missedMetrics,
        numberPhrases,
        buildScorecardText,
        buildScorecardHtml
    };
})();
