(function() {
    'use strict';

    /**
     * Scores a call against the Verint language lists the associate is
     * actually graded on.
     *
     * The lists themselves are not new and are not invented here: they live in
     * `sentimentPhraseDatabase`, they are editable in Settings, and they are
     * split by speaker exactly the way Verint splits them, A for the advisor
     * and C for the customer. What was missing is that nothing ever ran them
     * over a transcript. They were used to draw the Settings editor and to pad
     * prompts, and the only place they met real speech was the monthly upload,
     * which tells you a phrase count for a whole month and never which call.
     *
     * So this module does one thing: it takes the parsed turns from
     * callTranscript, matches each list against the side of the conversation it
     * belongs to, and reports what fired with the line that fired it.
     *
     * On what it deliberately does NOT do: it does not produce a positive word
     * or negative word percentage. Verint's scoring formula is not in this app,
     * and a number invented here would look exactly like the real one on the
     * scorecard while disagreeing with it. Counts and quotes are facts the
     * transcript can support; a score is not, so the metric comparison is left
     * to the uploaded metric that genuinely carries it.
     */

    /* ── Matching ──
     *
     * Verint phrases are matched against normalized text: lower case, punctuation
     * flattened to spaces, whitespace collapsed. Both the phrase and the
     * transcript go through the same normalizer, which is what lets "can't"
     * match "can t" on both sides rather than neither.
     *
     * Matching is on whole tokens. The text is padded with spaces and the
     * phrase is searched as " phrase ", so "an error" cannot match inside
     * "man errors".
     */

    // Verint's NEAR defaults to a five word span either side.
    const NEAR_WINDOW = 5;

    // How far past a customer's emotional cue an acknowledgement still counts
    // as a response to it rather than an unrelated pleasantry later on.
    const EMPATHY_WINDOW_TURNS = 3;

    const MAX_UNUSED_POSITIVES = 5;
    const MAX_QUOTE_CHARS = 110;

    function normalize(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function clipQuote(value) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (text.length <= MAX_QUOTE_CHARS) return text;
        const cut = text.slice(0, MAX_QUOTE_CHARS);
        const lastSpace = cut.lastIndexOf(' ');
        return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}...`;
    }

    function tokenIndexes(tokens, phraseTokens) {
        const hits = [];
        if (!phraseTokens.length) return hits;
        for (let index = 0; index <= tokens.length - phraseTokens.length; index++) {
            let matched = true;
            for (let offset = 0; offset < phraseTokens.length; offset++) {
                if (tokens[index + offset] !== phraseTokens[offset]) {
                    matched = false;
                    break;
                }
            }
            if (matched) hits.push(index);
        }
        return hits;
    }

    function unquote(value) {
        return String(value || '').trim().replace(/^["']+|["']+$/g, '').trim();
    }

    /**
     * Turns one Verint phrase into something that can be tested against text.
     *
     * Three forms show up in the real lists:
     *   "unfortunately"                      a plain phrase
     *   "wasting NEAR \"my time\""           both terms within NEAR_WINDOW words
     *   "your fault NOTIN \"not your fault\"" matches, except in that context
     *
     * The operators have to come off before normalization, because NEAR and
     * NOTIN survive lower casing as ordinary words and would otherwise be
     * matched as speech.
     *
     * NOTIN is implemented as a whole-text suppression rather than a positional
     * one: if the excluded phrase is anywhere in the turn, the hit is dropped.
     * That is stricter than Verint and so under-reports rather than over-reports,
     * which is the right direction. `your fault NOTIN "not your fault"` firing on
     * "that is not your fault" would coach an associate for reassuring somebody.
     */
    function compilePhrase(raw) {
        const original = String(raw || '').trim();
        if (!original) return null;

        const exclusions = [];
        let working = original.replace(/\bNOTIN\b\s*(?:"([^"]*)"|'([^']*)'|(\S+))/gi, (match, dq, sq, bare) => {
            const value = normalize(dq || sq || bare);
            if (value) exclusions.push(value.split(' '));
            return ' ';
        });

        const terms = working
            .split(/\bNEAR\b/i)
            .map(part => normalize(unquote(part)))
            .filter(Boolean)
            .map(part => part.split(' '));

        if (!terms.length) return null;

        const display = original
            .replace(/\bNOTIN\b\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '')
            .replace(/\bNEAR\b/gi, '...')
            .replace(/\s+/g, ' ')
            .trim();

        return {
            raw: original,
            display,
            near: terms.length > 1,
            excluded: exclusions.length > 0,
            test(tokens) {
                if (exclusions.some(exclusion => tokenIndexes(tokens, exclusion).length)) return false;

                const positions = terms.map(term => tokenIndexes(tokens, term));
                if (positions.some(list => !list.length)) return false;
                if (positions.length === 1) return true;

                // Every term is present; they also have to be close together.
                return positions.slice(1).every((list, offset) => list.some(later =>
                    positions[offset].some(earlier => Math.abs(later - earlier) <= NEAR_WINDOW)
                ));
            }
        };
    }

    // Deduplicated because the shipped lists already carry one repeat
    // ("not helping" appears twice in negative.C) and a hand-edited list can
    // pick up more. Two identical matchers would report the same phrase twice
    // and count the hit twice with it.
    function compileList(phrases) {
        const seen = new Set();
        return (Array.isArray(phrases) ? phrases : [])
            .map(compilePhrase)
            .filter(Boolean)
            .filter(phrase => {
                const key = phrase.raw.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    /* ── The lists ── */

    function getPhraseDatabase() {
        const live = window.DevCoachModules?.sentiment?.getPhraseDatabase?.();
        if (live) return live;
        return { positive: { A: [], C: [] }, negative: { A: [], C: [] }, emotions: { C: [] } };
    }

    /* ── Where a positive phrase belongs on a call ──
     *
     * The unused-positive list is only useful if it is short and it fits the
     * call. All 44 of them is a vocabulary lesson; the three that had an
     * obvious opening on this call is coaching.
     *
     * Each zone names the behaviour rule callTranscript already scores, so an
     * unused phrase can be ranked by whether the call actually missed that
     * moment. A phrase not listed here is general purpose and ranks last.
     */
    const PHRASE_ZONES = [
        {
            key: 'courtesyClose',
            label: 'closing the call',
            match: /anything else|questions or concerns|answered questions/i
        },
        {
            key: 'greeting',
            label: 'the opening',
            match: /thank you part|thank you being|being customer/i
        },
        {
            key: 'ownership',
            label: 'taking ownership',
            match: /taken care|took care|take care for you|what i can do|what we can do|let's get|let's make sure|here help|work you|do for you/i
        },
        {
            key: 'empathy',
            label: 'reassuring the customer',
            match: /don't worry|take time/i
        }
    ];

    function zoneFor(phrase) {
        return PHRASE_ZONES.find(zone => zone.match.test(phrase)) || null;
    }

    /* ── Scanning ── */

    function scanSide(turns, compiled, side) {
        const pool = side === 'C'
            ? turns.filter(turn => turn.role === 'customer')
            : turns.filter(turn => turn.role !== 'customer');

        const hits = [];
        compiled.forEach(phrase => {
            let count = 0;
            let quote = '';
            let at = null;

            pool.forEach(turn => {
                const tokens = normalize(turn.text).split(' ').filter(Boolean);
                if (!phrase.test(tokens)) return;
                count += 1;
                if (!quote) {
                    quote = clipQuote(turn.text);
                    at = typeof turn.at === 'number' ? turn.at : null;
                }
            });

            if (count) hits.push({ phrase: phrase.display, raw: phrase.raw, count, quote, at });
        });

        return hits.sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));
    }

    /**
     * Managing Emotions, read as a behaviour rather than a score.
     *
     * The metric is not "did the customer get emotional", which the associate
     * does not control. It is whether the associate acknowledged it. So each
     * customer cue from `emotions.C` is paired with the next few agent turns
     * and checked for the empathy language callTranscript already recognises.
     *
     * An unanswered cue is the coachable event, and it comes with the line the
     * customer said and the time they said it.
     */
    function scanEmotions(turns, compiled) {
        const empathy = window.DevCoachModules?.callTranscript?.strengthPattern?.('empathy');
        const cues = [];

        turns.forEach((turn, index) => {
            if (turn.role !== 'customer') return;
            const tokens = normalize(turn.text).split(' ').filter(Boolean);
            const fired = compiled.filter(phrase => phrase.test(tokens));
            if (!fired.length) return;

            let answered = false;
            let response = '';
            for (let ahead = index + 1; ahead < turns.length && ahead <= index + EMPATHY_WINDOW_TURNS; ahead++) {
                const next = turns[ahead];
                if (next.role === 'customer') continue;
                if (empathy && empathy.test(next.text)) {
                    answered = true;
                    response = clipQuote(next.text);
                    break;
                }
            }

            cues.push({
                phrases: fired.map(phrase => phrase.display),
                quote: clipQuote(turn.text),
                at: typeof turn.at === 'number' ? turn.at : null,
                answered,
                response
            });
        });

        return {
            cues,
            answered: cues.filter(cue => cue.answered).length,
            unanswered: cues.filter(cue => !cue.answered)
        };
    }

    /**
     * Which scored positive phrases the associate had room for and did not use.
     *
     * Ranked by whether the call missed the moment the phrase belongs to, so a
     * call that never offered further help is told about the "anything else"
     * family first. `missingRuleKeys` comes from the transcript analysis, which
     * is where those gaps are already worked out.
     */
    function findUnusedPositives(positiveList, usedRaw, missingRuleKeys) {
        const used = new Set(usedRaw);
        const missing = new Set(missingRuleKeys || []);

        return (Array.isArray(positiveList) ? positiveList : [])
            .filter(phrase => !used.has(phrase))
            .map(phrase => {
                const zone = zoneFor(phrase);
                return {
                    phrase,
                    zone: zone ? zone.label : '',
                    // A phrase whose moment the call actually missed is the one
                    // worth naming; one with no zone at all is generic advice.
                    rank: zone ? (missing.has(zone.key) ? 0 : 1) : 2
                };
            })
            .sort((a, b) => a.rank - b.rank)
            // Verint's list carries whole families of one phrase: "anything
            // else", "anything else help" and "anything else you" are three
            // entries and one coaching point. Suggesting all three reads as
            // padding, so once a phrase is kept, anything containing it or
            // contained by it is dropped.
            .reduce((kept, item) => {
                const padded = ` ${normalize(item.phrase)} `;
                const overlaps = kept.some(existing => {
                    const other = ` ${normalize(existing.phrase)} `;
                    return padded.includes(other) || other.includes(padded);
                });
                if (!overlaps) kept.push(item);
                return kept;
            }, [])
            .slice(0, MAX_UNUSED_POSITIVES);
    }

    /**
     * Runs every list against a transcript.
     *
     * `turns` and the attribution come from callTranscript, so an unlabelled
     * transcript is scanned on inferred roles. That is reported rather than
     * hidden: `attribution` is 'labeled' only when the transcript named its
     * speakers, and callers should say so before presenting negative hits as
     * fact.
     */
    function scanTranscript(rawText, options = {}) {
        const analyzer = window.DevCoachModules?.callTranscript;
        if (!analyzer?.parseTranscript) {
            return { ok: false, reason: 'parser-unavailable' };
        }

        const transcript = String(rawText || '').trim();
        if (!transcript) {
            return { ok: false, reason: 'empty' };
        }

        const parsed = analyzer.parseTranscript(transcript, { associateName: options.associateName });
        const db = options.phraseDatabase || getPhraseDatabase();

        const positiveA = scanSide(parsed.turns, compileList(db.positive?.A), 'A');
        const positiveC = scanSide(parsed.turns, compileList(db.positive?.C), 'C');
        const negativeA = scanSide(parsed.turns, compileList(db.negative?.A), 'A');
        const negativeC = scanSide(parsed.turns, compileList(db.negative?.C), 'C');
        const emotions = scanEmotions(parsed.turns, compileList(db.emotions?.C));

        const missingRuleKeys = (options.analysis?.allImprovements || []).map(item => item.key);
        const unusedPositives = findUnusedPositives(
            db.positive?.A,
            positiveA.map(hit => hit.raw),
            missingRuleKeys
        );

        const positiveCount = positiveA.reduce((sum, hit) => sum + hit.count, 0);
        const negativeCount = negativeA.reduce((sum, hit) => sum + hit.count, 0);

        return {
            ok: true,
            attribution: parsed.labeled ? 'labeled' : 'inferred',
            positiveA,
            positiveC,
            negativeA,
            negativeC,
            emotions,
            unusedPositives,
            totals: {
                positiveAvailable: (db.positive?.A || []).length,
                positiveDistinct: positiveA.length,
                positiveCount,
                negativeDistinct: negativeA.length,
                negativeCount,
                emotionCues: emotions.cues.length,
                emotionCuesUnanswered: emotions.unanswered.length
            }
        };
    }

    /* ── Output ── */

    function formatClock(totalSeconds) {
        if (typeof totalSeconds !== 'number') return '';
        const seconds = Math.max(0, Math.round(totalSeconds));
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }

    function withTime(quote, at) {
        const clock = formatClock(at);
        if (!quote) return '';
        return clock ? `"${quote}" (${clock})` : `"${quote}"`;
    }

    function hitLine(hit) {
        const times = hit.count > 1 ? ` x${hit.count}` : '';
        const evidence = withTime(hit.quote, hit.at);
        return `- ${hit.phrase}${times}${evidence ? ` ${evidence}` : ''}`;
    }

    /**
     * Plain text for the Copilot prompt and the Verint note. Kept factual: the
     * phrase, how often, and the line it came from.
     */
    function buildWordChoiceText(scan) {
        if (!scan?.ok) return '';
        const sections = [];

        if (scan.negativeA.length) {
            sections.push(`Scored negative phrases the associate used (${scan.totals.negativeCount} total):\n${scan.negativeA.map(hitLine).join('\n')}`);
        }
        if (scan.positiveA.length) {
            sections.push(`Scored positive phrases the associate used (${scan.totals.positiveCount} total):\n${scan.positiveA.map(hitLine).join('\n')}`);
        }
        if (scan.unusedPositives.length) {
            const rows = scan.unusedPositives
                .map(item => `- ${item.phrase}${item.zone ? ` (fits ${item.zone})` : ''}`)
                .join('\n');
            sections.push(`Scored positive phrases that had a place on this call and were not used:\n${rows}`);
        }
        if (scan.emotions.cues.length) {
            const rows = scan.emotions.cues.map(cue => {
                const state = cue.answered ? 'acknowledged' : 'not acknowledged';
                return `- ${withTime(cue.quote, cue.at)} ${state}`;
            }).join('\n');
            sections.push(`Customer emotion cues (${scan.emotions.answered} of ${scan.emotions.cues.length} acknowledged):\n${rows}`);
        }
        if (scan.negativeC.length) {
            sections.push(`Negative language from the customer:\n${scan.negativeC.map(hitLine).join('\n')}`);
        }
        if (scan.positiveC.length) {
            sections.push(`The customer's own positive language:\n${scan.positiveC.map(hitLine).join('\n')}`);
        }

        if (!sections.length) return '';

        const caveat = scan.attribution === 'inferred'
            ? '\n\nSpeaker labels were not in the transcript, so sides were inferred. Check a phrase before quoting it back.'
            : '';

        return `Language read against the Verint scored phrase lists:\n\n${sections.join('\n\n')}${caveat}`;
    }

    function buildWordChoiceHtml(scan, escapeHtml) {
        const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        if (!scan?.ok) return '';

        const group = (title, rows, tone) => {
            if (!rows.length) return '';
            return `<div class="call-trend-group call-trend-${tone}">
                <div class="call-trend-title">${safe(title)}</div>
                <ul>${rows.join('')}</ul>
            </div>`;
        };

        const hitRow = (hit) => {
            const times = hit.count > 1 ? ` <span class="call-qa-detail">x${hit.count}</span>` : '';
            const evidence = hit.quote
                ? ` <span class="call-qa-detail">${safe(withTime(hit.quote, hit.at))}</span>`
                : '';
            return `<li><strong>${safe(hit.phrase)}</strong>${times}${evidence}</li>`;
        };

        const groups = [
            group(`Scored negative phrases used (${scan.totals.negativeCount})`, scan.negativeA.map(hitRow), 'warn'),
            group(
                `Customer emotion cues not acknowledged (${scan.totals.emotionCuesUnanswered} of ${scan.totals.emotionCues})`,
                scan.emotions.unanswered.map(cue => `<li><span class="call-qa-detail">${safe(withTime(cue.quote, cue.at))}</span></li>`),
                'warn'
            ),
            group(
                'Scored positive phrases with a place here, not used',
                scan.unusedPositives.map(item => `<li><strong>${safe(item.phrase)}</strong>${item.zone ? ` <span class="call-qa-detail">fits ${safe(item.zone)}</span>` : ''}</li>`),
                'warn'
            ),
            group(`Scored positive phrases used (${scan.totals.positiveCount})`, scan.positiveA.map(hitRow), 'good'),
            group("The customer's own positive language", scan.positiveC.map(hitRow), 'good')
        ].filter(Boolean).join('');

        if (!groups) {
            return '<div class="call-qa-detail">No phrases from the Verint scored lists came up on this call.</div>';
        }

        const caveat = scan.attribution === 'inferred'
            ? '<div class="call-qa-detail">Speaker labels were not in the transcript, so sides were inferred. Check a phrase before quoting it back.</div>'
            : '';

        return `${groups}${caveat}`;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callWordChoice = {
        compilePhrase,
        getPhraseDatabase,
        scanTranscript,
        buildWordChoiceText,
        buildWordChoiceHtml,
        NEAR_WINDOW,
        EMPATHY_WINDOW_TURNS
    };
})();
