(function() {
    'use strict';

    /**
     * Turns a raw call transcript into draft coaching feedback.
     *
     * This is deliberately a rules engine, not a model: the app has no backend
     * and no API key, so the analysis has to run in the browser. It reads the
     * transcript for behaviours a supervisor would listen for, quotes the line
     * that triggered each call, and hands back editable drafts. The supervisor
     * is still the author; this just removes the blank-page problem.
     *
     * The input it is built for is a pasted Verint Interaction Review email:
     * a metadata header (date, advisor, length, speech categories), a body of
     * timestamped lines with no speaker labels, then a blank QA form and a
     * legal footer. All of that gets stripped before analysis.
     */

    /* ── How much of a call is kept ──
     *
     * 8000 characters was set when these logs lived in localStorage under a
     * 5MB ceiling shared with everything else. They are on IndexedDB now,
     * which saveWithSizeCheck exempts from that cap entirely, and they sync to
     * R2, where object size is not a constraint either. So the old number was
     * costing real information for a limit that no longer exists.
     *
     * It cost more than information. 8000 characters is about the first
     * fifteen minutes of speech, so on any longer call the close was cut off,
     * and the close is where the recap, the next steps, the courtesy close and
     * the customer's thank you all live. On the sample export the saved copy
     * lost four strengths and, worse, invented two coaching points: the
     * "missing" branch of those rules fired because the evidence had been
     * deleted, so the associate was coached for not setting next steps and not
     * closing properly on a call where she did both.
     *
     * This is now a safety ceiling rather than a routine trim: big enough that
     * no real call reaches it, and there to stop one pathological paste
     * bloating the store.
     */
    const MAX_STORED_TRANSCRIPT_CHARS = 120000;

    // Where the head/tail split falls when the ceiling is genuinely hit. The
    // open and the close are the coachable parts; the long middle of a call is
    // usually process.
    const TRUNCATION_HEAD_SHARE = 0.7;
    const TRUNCATION_MARKER = '[transcript truncated for storage]';
    // Matches both markers, including the one clampForPrompt writes.
    const TRUNCATION_PRESENT = /\[transcript truncated(?: for storage)?\]/i;
    const MAX_PROMPT_TRANSCRIPT_CHARS = 12000;
    const MAX_QUOTE_CHARS = 110;
    const MAX_STRENGTH_BULLETS = 6;
    const MAX_ISSUE_BULLETS = 5;

    // Speech runs at roughly 2.5 words a second, which is enough to tell a
    // pause apart from someone still talking.
    const WORDS_PER_SECOND = 2.5;
    const DEAD_AIR_SECONDS = 45;
    const LONG_HOLD_SECONDS = 90;
    // How far back to look for the hold a silence belongs to. Three turns
    // covers "I need to put you on hold", the customer's "okay", and the
    // advisor's "thanks for your patience" on the way back.
    const HOLD_LOOKBACK_TURNS = 3;

    const AGENT_LABEL = /\b(agent|advisor|associate|rep|representative|csr|tsr|employee|specialist|operator)\b/i;
    const CUSTOMER_LABEL = /\b(customer|caller|client|member|cust|subscriber|guest|patient)\b/i;

    // "Agent: text", "[00:14] Jane Doe: text", "CUSTOMER - text" all land here.
    const SPEAKER_LINE = /^\s*(?:[\[(]?\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APap]\.?[Mm]\.?)?[\])]?\s*)?([A-Za-z][A-Za-z0-9 .'\-]{0,34}?)\s*[:\-]\s+(.+)$/;

    // A Verint body line is just "04:30" on its own, with the speech beneath.
    const TIMESTAMP_ONLY_LINE = /^\s*(\d{1,3}):([0-5]\d)\s*$/;

    const GREETING_HINT = /thank(?:s| you) for calling|my name is|this is \w+ speaking|how (?:can|may) i help/i;

    /* ── Text helpers ── */

    function collapse(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function clipQuote(value) {
        const text = collapse(value).replace(/^["']+|["']+$/g, '');
        if (text.length <= MAX_QUOTE_CHARS) return text;
        const cut = text.slice(0, MAX_QUOTE_CHARS);
        const lastSpace = cut.lastIndexOf(' ');
        return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}...`;
    }

    function countMatches(text, pattern) {
        const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
        const matches = String(text || '').match(global);
        return matches ? matches.length : 0;
    }

    function wordCount(text) {
        const trimmed = collapse(text);
        return trimmed ? trimmed.split(' ').length : 0;
    }

    function formatDuration(totalSeconds) {
        const seconds = Math.max(0, Math.round(totalSeconds));
        const minutes = Math.floor(seconds / 60);
        const remainder = seconds % 60;
        if (!minutes) return `${remainder}s`;
        return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
    }

    function formatClock(totalSeconds) {
        const seconds = Math.max(0, Math.round(totalSeconds));
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }

    /* ── Verint export metadata ── */

    const DATE_TIME = /Date\s*\/\s*Time:\s*[\r\n\s]*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[AaPp]\.?[Mm]\.?)/;
    const DURATION = /(\d{1,3}:[0-5]\d)\s*[\r\n\s]*\/\s*[\r\n\s]*(\d{1,3}:[0-5]\d)/;
    const CATEGORY_BLOCK = /Categories:\s*([\s\S]*?)(?:No visual indicators|^\s*\d{1,3}:[0-5]\d\s*$)/m;
    const BODY_START_MARKERS = [/No visual indicators[^\r\n]*/];
    const BODY_END_MARKERS = [
        /^Did advisor /m,
        /^Additional Comments\s*$/m,
        /^Notes on Soft Skills\s*$/m,
        /^Kudos\/Compliments\s*$/m,
        /^Call Opportunities\s*$/m,
        /This message is for the designated recipient/,
        // The evaluator's own name is signed under the transcript.
        /^[A-Z][a-z'-]+,\s*[A-Z][a-z'-]+\s*$/m
    ];

    function toIsoDate(month, day, year) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    // "Dimes, Alyssa" is how the export writes it; the associate dropdown uses
    // "Alyssa Dimes", so keep both.
    function normalizeAdvisorName(rawName) {
        const clean = collapse(rawName);
        const match = clean.match(/^([A-Za-z][A-Za-z'\-]+),\s*([A-Za-z][A-Za-z'\-.]+(?: [A-Za-z][A-Za-z'\-.]+)?)$/);
        if (!match) return { raw: clean, display: clean };
        return { raw: clean, display: `${match[2]} ${match[1]}` };
    }

    function parseCategories(block) {
        const lines = String(block || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const categories = [];
        lines.forEach(line => {
            if (/^\d+$/.test(line)) {
                if (categories.length) categories[categories.length - 1].count = Number(line);
                return;
            }
            if (/^(Searched Term|Category|Legend:?|X [\d.]+|\d+\/\d+)$/i.test(line)) return;
            categories.push({ name: line.replace(/\.\.\.$/, '').trim(), count: 0 });
        });
        return categories.filter(item => item.name);
    }

    function clockToSeconds(clock) {
        const parts = String(clock || '').split(':').map(Number);
        if (parts.length !== 2 || parts.some(Number.isNaN)) return null;
        return (parts[0] * 60) + parts[1];
    }

    /**
     * Pulls the header facts out of a Verint export. Returns empty fields for
     * a plain transcript, which is the normal case for a hand-typed paste.
     */
    /**
     * Reads back the header prepareForStorage writes.
     *
     * A saved transcript begins "[Call 2026-09-03 • 6:35 PM • Esther Ramos •
     * length 39:07]" and then the body. That header exists precisely so the
     * facts survive the boilerplate being stripped, and nothing read it, so
     * every saved call lost its time, its length and the advisor's name the
     * moment it was stored. The recap said "A call, taken Thursday" for a 39
     * minute call whose length was sitting in the first line of its own
     * transcript.
     */
    const STORED_HEADER = /^\s*\[Call\s+(\d{4}-\d{2}-\d{2})((?:\s*•[^\]]*)*)\]/;

    function readStoredHeader(text, meta) {
        const match = String(text || '').match(STORED_HEADER);
        if (!match) return false;

        meta.callDate = match[1];

        const parts = String(match[2] || '')
            .split('•')
            .map(part => collapse(part))
            .filter(Boolean);

        parts.forEach(part => {
            const length = part.match(/^length\s+(\d{1,3}:[0-5]\d)$/i);
            if (length) {
                meta.durationLabel = length[1];
                meta.durationSeconds = clockToSeconds(length[1]);
                return;
            }
            // Verint's speech categories, kept because one strength rule reads
            // them and stripBoilerplate removes the block they came in.
            const cats = part.match(/^cats:\s*(.+)$/i);
            if (cats) {
                meta.categories = cats[1].split(';').map(item => {
                    const [name, count] = item.split('=');
                    return { name: collapse(name), count: Number(count) || 0 };
                }).filter(item => item.name);
                meta.isVerintExport = true;
                return;
            }
            if (/^\d{1,2}:\d{2}(?::\d{2})?\s*[AaPp]\.?[Mm]\.?$/.test(part)) {
                meta.callTime = part.toUpperCase();
                return;
            }
            // Whatever is left is the advisor, already in display order.
            if (!meta.advisorDisplayName && /[A-Za-z]/.test(part)) {
                meta.advisorDisplayName = part;
                meta.advisorName = part;
            }
        });

        return true;
    }

    function extractMetadata(rawText) {
        const text = String(rawText || '');
        const meta = {
            callDate: '',
            callTime: '',
            advisorName: '',
            advisorDisplayName: '',
            durationLabel: '',
            durationSeconds: null,
            categories: [],
            isVerintExport: false
        };

        // A stored transcript carries its facts in a header of our own making,
        // and none of the Verint patterns below can see it.
        if (readStoredHeader(text, meta)) return meta;

        const dateMatch = text.match(DATE_TIME);
        if (dateMatch) {
            meta.callDate = toIsoDate(dateMatch[1], dateMatch[2], dateMatch[3]);
            meta.callTime = collapse(dateMatch[4]).toUpperCase();
            meta.isVerintExport = true;

            // The advisor is the line directly under the date/time value.
            const after = text.slice(dateMatch.index + dateMatch[0].length);
            const nextLine = after.split(/\r?\n/).map(line => line.trim()).find(Boolean);
            if (nextLine && /^[A-Za-z][A-Za-z'\-]+,\s*[A-Za-z]/.test(nextLine)) {
                const named = normalizeAdvisorName(nextLine);
                meta.advisorName = named.raw;
                meta.advisorDisplayName = named.display;
            }
        }

        const durationMatch = text.match(DURATION);
        if (durationMatch) {
            meta.durationLabel = durationMatch[2];
            meta.durationSeconds = clockToSeconds(durationMatch[2]);
        }

        const categoryMatch = text.match(CATEGORY_BLOCK);
        if (categoryMatch) {
            meta.categories = parseCategories(categoryMatch[1]);
            meta.isVerintExport = true;
        }

        return meta;
    }

    /**
     * Drops the export header, the blank QA form, and the legal footer so the
     * rules only ever read what was actually said on the call.
     */
    function stripBoilerplate(rawText) {
        // The header prepareForStorage writes goes first, before anything
        // else looks at this. Left in, it is parsed as the opening turn of the
        // call and attributed to the advisor, so every scan of a saved
        // transcript read "Call 2026-09-03 Esther Ramos length 39:07" as
        // something she said, and the recap's idea of the first two turns was
        // off by one.
        let text = String(rawText || '').replace(STORED_HEADER, '');

        let startIndex = 0;
        BODY_START_MARKERS.forEach(marker => {
            const match = text.match(marker);
            if (match) startIndex = Math.max(startIndex, match.index + match[0].length);
        });

        if (!startIndex) {
            // No header marker: fall back to the first timestamped line, but
            // skip the "00:00 / 18:24" position counter if it is there.
            const duration = text.match(DURATION);
            if (duration) startIndex = duration.index + duration[0].length;
        }

        text = text.slice(startIndex);

        let endIndex = text.length;
        BODY_END_MARKERS.forEach(marker => {
            const match = text.match(marker);
            if (match) endIndex = Math.min(endIndex, match.index);
        });

        return text.slice(0, endIndex).trim();
    }

    /* ── Parsing ── */

    function isPlausibleSpeaker(label) {
        const clean = collapse(label);
        if (!clean || clean.length > 34) return false;
        return clean.split(' ').length <= 4;
    }

    function classifyLabel(label, associateName) {
        if (AGENT_LABEL.test(label)) return 'agent';
        if (CUSTOMER_LABEL.test(label)) return 'customer';

        const nameTokens = String(associateName || '')
            .toLowerCase()
            .split(/[\s,]+/)
            .filter(token => token.length > 2);
        const lowerLabel = label.toLowerCase();
        if (nameTokens.some(token => lowerLabel.includes(token))) return 'agent';

        return 'unknown';
    }

    // Timestamped exports carry no speaker labels, so turns are attributed by
    // what could only have been said by one side. Anything ambiguous stays
    // unattributed rather than being guessed at: a wrong attribution produces
    // wrong coaching, which is worse than a missed signal.
    const AGENT_TURN_CUE = /thank you for (?:being|calling|choosing)|can i have your|may i (?:place|put) you|i'?m just gonna place you|one moment please|allow me a moment|thank you (?:so much )?for holding|let me pull up|i'?d like to recap|the (?:first|second|third) plan|plans available|our email address|for the identity check|verify your name|is that right|what'?s the address|deposit of|we (?:do )?need (?:to )?(?:either|your)|do you have any questions|is there anything else/i;
    // Phrases only a customer says. These are the ones the coaching rules care
    // about most, so they are matched outright rather than left to flow order.
    const CUSTOMER_TURN_CUE = /^(?:hello )?hi my name'?s|i'?m just trying to|i don'?t know what my|do you have any recommendations|i just have the address|we'?ll get that back|i have both|this is (?:ridiculous|unacceptable|the (?:second|third|fourth|\d+)(?:st|nd|rd|th)? time)|i (?:want|need) to (?:speak|talk) (?:to|with) (?:a|your) (?:supervisor|manager)|get me a (?:supervisor|manager)|like i (?:said|told you|mentioned)|as i (?:said|mentioned|explained)|i already (?:said|told|explained)|i(?:'?m| am) (?:so |really )?(?:frustrated|fed up|angry|upset)|my bill (?:is|went|doubled)|(?:i was|you) charged (?:me )?twice|(?:very|really|so) helpful|you'?ve been (?:so |really |very )?(?:helpful|great|wonderful)|i (?:really )?appreciate (?:you|your|it)|(?:can'?t|cannot) afford|i(?:'?m| am) past due|behind on (?:my|the) bill/i;

    // "Agent:" or "Customer:" at the front of a timestamped line. Verint's
    // plain text export has no labels, but its transcript is colour coded, and
    // the paste handler turns those colours into exactly these labels. When
    // they are present there is nothing left to infer.
    const TIMESTAMPED_LABEL = /^\s*(agent|advisor|associate|rep|customer|caller|client)\s*:\s*(.+)$/i;

    function parseTimestampedTurns(text) {
        const lines = String(text || '').split(/\r?\n/);
        const turns = [];
        let current = null;

        lines.forEach(line => {
            const stamp = line.match(TIMESTAMP_ONLY_LINE);
            if (stamp) {
                current = { label: '', text: '', at: (Number(stamp[1]) * 60) + Number(stamp[2]) };
                turns.push(current);
                return;
            }
            const content = line.trim();
            if (!content) return;
            if (!current) {
                current = { label: '', text: '', at: null };
                turns.push(current);
            }

            const labelled = content.match(TIMESTAMPED_LABEL);
            if (labelled && !current.label) {
                current.label = collapse(labelled[1]);
                current.text = collapse(`${current.text} ${labelled[2]}`);
                return;
            }

            current.text = collapse(`${current.text} ${content}`);
        });

        return turns.filter(turn => turn.text);
    }

    /**
     * Roles straight off the labels, when the paste carried them.
     *
     * Everything the unlabelled path does is a guess: which side said a
     * scored phrase, whose emotion cue it was, who was talking for 80% of the
     * call, and which line the customer opened with. Getting one of those
     * wrong quoted the advisor's own words back to her as the customer's.
     * With labels present, none of it is inferred.
     */
    function rolesFromTimestampedLabels(turns) {
        return turns.map(turn => ({
            ...turn,
            role: CUSTOMER_LABEL.test(turn.label) ? 'customer' : 'agent',
            cued: true
        }));
    }

    function attributeByCue(turns) {
        return turns.map(turn => {
            if (CUSTOMER_TURN_CUE.test(turn.text)) return { ...turn, role: 'customer', cued: true };
            if (AGENT_TURN_CUE.test(turn.text)) return { ...turn, role: 'agent', cued: true };
            return { ...turn, role: 'unknown', cued: false };
        });
    }

    // A short reply landing straight after the advisor is the customer answering
    // them. Recovering those matters: "this is ridiculous" is four words, and
    // left unattributed it would be read as something the advisor said.
    const BACKCHANNEL_WORDS = 8;

    function inferRolesByFlow(turns) {
        // Calls open with the advisor, so that is where the alternation starts.
        let previousRole = 'agent';

        return turns.map(turn => {
            if (turn.cued) {
                previousRole = turn.role;
                return turn;
            }

            const short = wordCount(turn.text) <= BACKCHANNEL_WORDS;
            const role = (short && previousRole === 'agent') ? 'customer' : 'agent';
            previousRole = role;
            return { ...turn, role, inferred: true };
        });
    }

    function buildParseResult(turns, labeled) {
        // With real labels the two sides are known.
        //
        // Without them, confidence differs by how the turn was attributed. A
        // cued turn used an unmistakable phrase. An inferred one is a guess
        // from conversational flow, so it counts towards the customer without
        // being taken away from the advisor: that way a wrong guess costs a
        // little precision rather than losing the line from both sides.
        const agentTurns = labeled
            ? turns.filter(turn => turn.role === 'agent')
            : turns.filter(turn => !(turn.role === 'customer' && turn.cued));
        const customerTurns = turns.filter(turn => turn.role === 'customer');

        return {
            labeled,
            turns,
            agentText: agentTurns.map(turn => turn.text).join('\n'),
            customerText: customerTurns.map(turn => turn.text).join('\n'),
            agentWords: wordCount(agentTurns.map(turn => turn.text).join(' ')),
            customerWords: wordCount(customerTurns.map(turn => turn.text).join(' ')),
            timed: turns.some(turn => typeof turn.at === 'number')
        };
    }

    /**
     * Splits a transcript into speaker turns and works out which side is the
     * associate. Handles labelled transcripts, Verint timestamped exports, and
     * plain pasted notes.
     */
    function parseTranscript(rawText, options = {}) {
        const text = stripBoilerplate(rawText) || String(rawText || '');
        const rawLines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

        const timestampCount = rawLines.filter(line => TIMESTAMP_ONLY_LINE.test(line)).length;
        if (timestampCount >= 3) {
            const timestamped = parseTimestampedTurns(text);

            // Labels beat inference outright. A colour coded paste carries
            // them, and once it does every hedge downstream can come off.
            const labelledTurns = timestamped.filter(turn => turn.label).length;
            if (labelledTurns >= Math.max(3, timestamped.length * 0.5)) {
                return buildParseResult(rolesFromTimestampedLabels(timestamped), true);
            }

            return buildParseResult(inferRolesByFlow(attributeByCue(timestamped)), false);
        }

        const turns = [];
        const labelOrder = [];
        const labelText = {};

        rawLines.forEach(line => {
            const match = line.match(SPEAKER_LINE);
            if (match && isPlausibleSpeaker(match[1])) {
                const label = collapse(match[1]);
                if (!labelText[label]) {
                    labelText[label] = '';
                    labelOrder.push(label);
                }
                labelText[label] += ` ${match[2]}`;
                turns.push({ label, text: collapse(match[2]), at: null });
            } else if (turns.length) {
                // Wrapped continuation of the previous speaker's turn.
                const previous = turns[turns.length - 1];
                previous.text = collapse(`${previous.text} ${line}`);
                labelText[previous.label] += ` ${line}`;
            } else {
                turns.push({ label: '', text: collapse(line), at: null });
            }
        });

        if (!labelOrder.length) {
            return buildParseResult(attributeByCue(turns), false);
        }

        const roles = {};
        labelOrder.forEach(label => {
            roles[label] = classifyLabel(label, options.associateName);
        });

        const unresolved = labelOrder.filter(label => roles[label] === 'unknown');
        if (unresolved.length) {
            const greeter = unresolved.find(label => GREETING_HINT.test(labelText[label]));
            if (greeter) {
                roles[greeter] = 'agent';
            }
            const hasAgent = labelOrder.some(label => roles[label] === 'agent');
            if (labelOrder.length === 2) {
                // Two speakers: whoever is not the associate is the customer.
                labelOrder.forEach((label, index) => {
                    if (roles[label] !== 'unknown') return;
                    const other = labelOrder[1 - index];
                    roles[label] = roles[other] === 'agent' ? 'customer' : 'agent';
                });
            } else if (!hasAgent) {
                roles[labelOrder[0]] = 'agent';
                labelOrder.slice(1).forEach(label => {
                    if (roles[label] === 'unknown') roles[label] = 'customer';
                });
            } else {
                labelOrder.forEach(label => {
                    if (roles[label] === 'unknown') roles[label] = 'customer';
                });
            }
        }

        return buildParseResult(turns.map(turn => ({ ...turn, role: roles[turn.label] || 'agent' })), true);
    }

    /* ── Behaviour rules ── */

    // Present in the associate's speech = a strength worth naming out loud.
    // `missing` (when set) is the coaching line to use when it never shows up.
    const STRENGTH_RULES = [
        {
            key: 'greeting',
            praise: 3,
            pattern: /thank(?:s| you) for (?:calling|being a valued customer)|my name is|this is \w+ (?:speaking|how)|how (?:can|may) i help you/i,
            made: 'Clean open. You named APS and gave your own name straight away, which sets the tone for everything after it.',
            missing: 'The greeting and your name did not make it in up front. Worth leading with both so the customer knows right away who they are working with.',
            missingWeight: 4
        },
        {
            key: 'empathy',
            praise: 8,
            // "I'm sorry" only counts with an object attached. Bare "I'm sorry"
            // is usually a self-correction mid-sentence, not empathy.
            pattern: /i (?:completely |totally |really |absolutely )?understand|i (?:can )?(?:hear|see) (?:why|how|that)|i(?:'?m| am) (?:so|really|very|terribly) sorry|i(?:'?m| am) sorry (?:about|for|to hear|that|you)|i apologi[sz]e|that (?:sounds|must be) (?:frustrating|stressful|difficult|annoying)|i can imagine/i,
            made: 'Real empathy. You acknowledged where the customer was before moving into the fix.',
            missing: 'Empathy: acknowledge the customer\'s situation in your own words before jumping into troubleshooting.',
            missingWeight: 9
        },
        {
            key: 'ownership',
            praise: 8,
            pattern: /i(?:'?ll| will) take care of|let me take care of|i(?:'?ll| will) make sure|let me handle|i(?:'?ll| will) get (?:this|that) (?:sorted|fixed|taken care of)|leave (?:it|that) with me|i(?:'?ll| will) (?:own|personally)/i,
            made: 'Strong ownership. You took the outcome on yourself instead of handing the problem back.'
        },
        {
            key: 'verification',
            praise: 7,
            pattern: /verif(?:y|ication|ying)|identity check|confirm(?:ing)? your (?:name|address|account|identity)|date of birth|last four|security question|account number or the address/i,
            made: 'You confirmed who you were talking to before anything on the account came up. That is the one that protects everybody.',
            missing: 'Confirm who you are talking to before anything on the account comes up.',
            missingWeight: 8
        },
        {
            key: 'holdEtiquette',
            praise: 6,
            pattern: /(?:may|can|could|would it be ok(?:ay)? if) i (?:please )?(?:place|put) you on(?: a (?:brief|short|quick))? hold|i'?m just gonna place you on a (?:brief|short|quick) hold|i (?:do )?need to (?:place|put) you on hold|do you mind (?:if i|holding)|thank(?:s| you) for holding|thank(?:s| you) for (?:your )?patience|appreciate (?:you|your) (?:holding|patience)/i,
            made: 'Textbook hold. You flagged it before it happened and thanked them on the way back.'
        },
        {
            key: 'optionsOffered',
            praise: 7,
            pattern: /(?:we have|there are) (?:two|three|four|\d+) [a-z ]*plans|plans available|the (?:first|second|third) plan (?:is|that we offer)|compar(?:e|ison) (?:of |the )?(?:plans|options)|options available to you/i,
            made: 'You laid out the full set of options instead of defaulting to one, and that is exactly what we want customers to hear.'
        },
        {
            key: 'recommendation',
            praise: 9,
            pattern: /i(?:'?d| would) recommend|my recommendation|you might want to go with|i agree with you there|based on (?:what you|your usage)|(?:sounds|seems) like the .{0,30}plan (?:is|it'?s) right for you/i,
            made: 'You went past reciting the options and gave a recommendation tied to how they actually live. That is the difference between informing and advising.'
        },
        {
            key: 'education',
            praise: 5,
            pattern: /you can also|for future reference|next time you can|on the (?:app|website|portal)|online you can|once you are registered|self.?serv|take advantage of/i,
            made: 'Nice add. You showed them a faster way to handle this themselves next time.'
        },
        {
            key: 'checkUnderstanding',
            praise: 5,
            pattern: /does that make sense|did (?:that|i) answer|any questions (?:about|on) that|how does that sound|are you (?:following|with me)|is this the plan that you want/i,
            made: 'You checked that it actually landed instead of assuming it had.'
        },
        {
            key: 'recap',
            praise: 8,
            pattern: /to recap|just to recap|i'?d like to recap|to summari[sz]e|to sum (?:up|it up)|so to confirm|let me confirm what|(?:here'?s|what) we (?:did|covered) today/i,
            made: 'Excellent recap. They came off the call knowing exactly what was decided and why.',
            missing: 'Worth closing by saying back what you did and what it means for them.',
            missingWeight: 5
        },
        {
            key: 'nextSteps',
            praise: 6,
            pattern: /next step|you (?:will|'ll) (?:receive|see|get|be)|within (?:\d+|twenty.four|forty.eight) (?:hours|business days|days)|i'?ll follow up|follow up with you|in \d+ (?:to \d+ )?(?:business )?days|by (?:monday|tuesday|wednesday|thursday|friday|the end of)|what happens is/i,
            made: 'Clear next steps with a time frame attached. That is what stops the second call.',
            missing: 'Tell the customer exactly what happens next and by when, even when the answer is not the one they wanted.',
            missingWeight: 7
        },
        {
            key: 'courtesyClose',
            praise: 4,
            pattern: /anything else (?:i can (?:help|do|assist)|you need)|is there anything else|any questions anything i can answer|before (?:i let you go|we (?:hang up|wrap up|finish))/i,
            made: 'Solid close. You offered more help before wrapping up rather than rushing off the line.',
            missing: 'Ask if there is anything else before you wrap up.',
            missingWeight: 3
        }
    ];

    // Present in the associate's speech = something to coach.
    const ISSUE_RULES = [
        {
            key: 'deflection',
            weight: 10,
            pattern: /there(?:'?s| is) nothing i can do|i (?:can'?t|cannot) do anything|that(?:'?s| is) (?:just )?(?:our|the) policy|that(?:'?s| is) policy|you(?:'?ll| will) have to (?:call|contact|go)|you need to call|not my department|i don'?t handle (?:that|those)/i,
            text: 'That landed on the customer as a flat no with nowhere to go. Tell them what you can do and why, then offer the next best option.'
        },
        {
            key: 'repeatCustomer',
            weight: 8,
            side: 'customer',
            pattern: /like i (?:said|told you|mentioned)|as i (?:said|mentioned|explained)|i already (?:said|told|explained)|i just (?:said|told)/i,
            text: 'The customer ended up repeating themselves. Say back what you heard before you ask the next question.'
        },
        {
            key: 'supervisorRequest',
            weight: 8,
            side: 'customer',
            pattern: /(?:speak|talk) (?:to|with) (?:a|your) (?:supervisor|manager)|get me a (?:supervisor|manager)|escalate this/i,
            text: 'The customer asked for a supervisor. Say you heard it, have one honest go at sorting it yourself, then get them over before they have to ask again.'
        },
        {
            key: 'deadAir',
            weight: 6,
            pattern: /\[(?:silence|pause|dead air|no response)[^\]]*\]/i,
            text: 'While the system is loading, tell the customer what you are doing so the quiet does not pile up on them.'
        },
        {
            key: 'stalling',
            weight: 5,
            threshold: 3,
            pattern: /one moment|just a (?:moment|second|sec)|bear with me|give me (?:one|a) (?:second|moment)|still (?:there|checking|loading)|it'?s just loading/i,
            text: 'There were a few "one moment, bear with me" stretches. Tell the customer what you are actually checking instead of asking them to keep waiting.'
        },
        {
            key: 'uncertainty',
            weight: 6,
            threshold: 3,
            pattern: /\bi think\b|\bi(?:'?m| am) not (?:really )?sure\b|\bi guess\b|\bhopefully\b|\bit should\b/i,
            text: 'You sounded unsure a few times. Go check, then give the answer straight so the customer trusts it.'
        },
        {
            key: 'apologyLoop',
            weight: 4,
            threshold: 5,
            pattern: /i(?:'?m| am) (?:so |very |really )?sorry|i apologi[sz]e/i,
            text: 'You apologised a lot. One you mean is plenty, then move to what you are doing about it.'
        },
        {
            key: 'filler',
            weight: 3,
            threshold: 6,
            pattern: /\b(?:um+|uh+|erm|er)\b/i,
            text: 'A quiet second while you think sounds more sure of yourself than an "um".'
        }
    ];

    const FRUSTRATION = /frustrat|ridiculous|unacceptable|this is the (?:second|third|fourth|\d+)(?:st|nd|rd|th)? time|fed up|angry|upset|furious|waste of my time|sick of/i;
    // Something went wrong for the customer, even if they stayed polite about it.
    const TROUBLE = /charged twice|double.?(?:bill|charg)|overcharg|shut off|shut.?off|disconnect|no power|outage|not working|broken|too high|can'?t afford|late fee|complain|my bill (?:is|went|doubled)|still (?:haven'?t|not) (?:received|got|fixed)/i;
    // Tightened so the associate thanking the customer for holding cannot read
    // as the customer praising the associate.
    const APPRECIATION = /(?:very|really|so) helpful|you'?ve been (?:so |really |very )?(?:helpful|great|wonderful|amazing)|i (?:really )?appreciate (?:you|your|it|that)|you'?re the best|thank you so much(?! for (?:holding|waiting|calling|your patience))/i;
    const HOLD_MENTION = /\bhold\b|hold on|one moment|bear with me/i;
    const TRANSFER = /transfer(?:ring)? you|i(?:'?m| am) going to transfer|let me transfer|get you (?:over )?to (?:the|another)/i;
    const WARM_TRANSFER = /stay on the line|i(?:'?ll| will) (?:stay|introduce|walk them through)|let me (?:explain|brief|fill) (?:them|the)|warm transfer|i(?:'?ll| will) give them the (?:details|background)/i;

    function strengthPattern(key) {
        const rule = STRENGTH_RULES.find(item => item.key === key);
        return rule ? rule.pattern : /$^/;
    }

    function findQuote(turns, pattern, side) {
        const pool = side === 'customer'
            ? turns.filter(turn => turn.role === 'customer')
            : turns.filter(turn => turn.role !== 'customer');
        const match = pool.find(turn => pattern.test(turn.text));
        return match ? clipQuote(match.text) : '';
    }

    /**
     * Verint timestamps make silence measurable: compare when a turn starts to
     * how long it could plausibly have taken to say, and what is left is the
     * gap. An announced hold is expected; an unannounced one is dead air.
     */
    function findSilenceGaps(turns) {
        const timed = turns.filter(turn => typeof turn.at === 'number');
        const gaps = [];

        for (let index = 0; index < timed.length - 1; index++) {
            const current = timed[index];
            const gap = timed[index + 1].at - current.at;
            if (gap <= DEAD_AIR_SECONDS) continue;

            const spokenFor = wordCount(current.text) / WORDS_PER_SECOND;
            const silence = gap - spokenFor;
            if (silence < DEAD_AIR_SECONDS) continue;

            // Announced is judged across a short lookback, not just the turn
            // the gap follows.
            //
            // On a real call the advisor said "i do need to place you on hold
            // so i can create an account" at 5:08, said it again at 5:37, came
            // back with "thanks for your patience" at 5:54, and then the next
            // stamp was 10:21. Reading only the 5:54 turn, that four minutes
            // was reported as unannounced dead air and the associate was
            // coached for it, having announced the hold twice in the preceding
            // forty five seconds. The transcript stamps speech, not holds, so
            // the announcement and the silence it refers to routinely sit in
            // different turns.
            const window = timed.slice(Math.max(0, index - HOLD_LOOKBACK_TURNS), index + 1)
                .map(turn => turn.text)
                .join(' ');

            gaps.push({
                at: current.at,
                silence,
                announced: strengthPattern('holdEtiquette').test(window) || HOLD_MENTION.test(window)
            });
        }

        return gaps.sort((a, b) => b.silence - a.silence);
    }

    function bullet(text, quote) {
        return quote ? `- ${text} ("${quote}")` : `- ${text}`;
    }

    /**
     * Reads a transcript and returns draft strengths and coaching points, each
     * one anchored to the line or the timestamp that triggered it.
     */
    function analyzeTranscript(rawText, options = {}) {
        const transcript = String(rawText || '').trim();
        if (!transcript) {
            return { ok: false, reason: 'empty', strengths: [], improvements: [], stats: null, meta: null };
        }

        const meta = extractMetadata(transcript);
        const parsed = parseTranscript(transcript, options);
        const { agentText, customerText, turns } = parsed;
        const strengths = [];
        const improvements = [];

        // A transcript with a piece removed cannot support any conclusion of
        // the form "this never happened", because absence is exactly what the
        // removal produced. On the sample export the saved copy coached the
        // associate for not setting next steps and not closing the call, on a
        // call where she did both, purely because the end had been trimmed.
        //
        // Present-tense findings are unaffected: a phrase that IS in the
        // remaining text was genuinely said.
        const truncated = TRUNCATION_PRESENT.test(transcript);

        STRENGTH_RULES.forEach(rule => {
            if (rule.pattern.test(agentText)) {
                strengths.push({ key: rule.key, praise: rule.praise || 5, text: rule.made, quote: findQuote(turns, rule.pattern) });
            } else if (rule.missing && !truncated) {
                improvements.push({ key: rule.key, weight: rule.missingWeight || 5, text: rule.missing, quote: '' });
            }
        });

        ISSUE_RULES.forEach(rule => {
            const haystack = rule.side === 'customer' ? customerText : agentText;
            const hits = countMatches(haystack, rule.pattern);
            if (hits >= (rule.threshold || 1)) {
                improvements.push({
                    key: rule.key,
                    weight: rule.weight,
                    text: rule.text,
                    quote: findQuote(turns, rule.pattern, rule.side)
                });
            }
        });

        const frustrated = FRUSTRATION.test(customerText);
        const emotionalCall = frustrated || TROUBLE.test(customerText);
        const empathyGapIndex = improvements.findIndex(item => item.key === 'empathy');

        // Empathy is only worth coaching when there was something to empathise
        // with. Flagging it on a routine setup call is noise the associate will
        // rightly ignore, and it drags the whole review down with it.
        if (empathyGapIndex >= 0 && !emotionalCall) {
            improvements.splice(empathyGapIndex, 1);
        } else if (empathyGapIndex >= 0 && frustrated) {
            const empathyGap = improvements[empathyGapIndex];
            empathyGap.weight = 12;
            empathyGap.text = 'The customer was clearly frustrated and you went straight past it. Say out loud what they are dealing with before you move to the fix.';
            empathyGap.quote = findQuote(turns, FRUSTRATION, 'customer');
        }

        if (APPRECIATION.test(customerText)) {
            strengths.push({
                key: 'customerReaction',
                praise: 10,
                text: 'The customer said it themselves before hanging up, which is the only review that really counts.',
                quote: findQuote(turns, APPRECIATION, 'customer')
            });
        }

        const positiveCategory = meta.categories.find(item => /advisor positive/i.test(item.name) && item.count > 0);
        if (positiveCategory) {
            strengths.push({
                key: 'positiveExperience',
                praise: 4,
                text: `Verint's advisor positive experience category fired ${positiveCategory.count} time${positiveCategory.count === 1 ? '' : 's'} on this call. The system heard it too.`,
                quote: ''
            });
        }

        if (HOLD_MENTION.test(agentText) && !strengthPattern('holdEtiquette').test(agentText)) {
            improvements.push({
                key: 'holdProcess',
                weight: 7,
                text: 'The hold got a bit loose. Ask first, give them a rough idea how long, and thank them when you pick back up.',
                quote: findQuote(turns, HOLD_MENTION)
            });
        }

        if (TRANSFER.test(agentText) && !WARM_TRANSFER.test(agentText)) {
            improvements.push({
                key: 'coldTransfer',
                weight: 7,
                text: 'When you transfer, fill the other team in while the customer is still on with you so they are not starting over.',
                quote: findQuote(turns, TRANSFER)
            });
        }

        const gaps = findSilenceGaps(turns);
        const longestHold = gaps.find(gap => gap.announced && gap.silence >= LONG_HOLD_SECONDS);
        if (longestHold) {
            improvements.push({
                key: 'longHold',
                weight: 7,
                // "The hold" rather than "it". The label prefix used to supply
                // the antecedent, and the message strips labels, so "you did
                // announce it" arrived referring to nothing.
                text: `Long hold: about ${formatDuration(longestHold.silence)} of silence starting at ${formatClock(longestHold.at)}. You did announce the hold, which is right, but check back in every 45 seconds or so rather than leaving them there.`,
                quote: ''
            });
        }

        const longestDeadAir = gaps.find(gap => !gap.announced);
        if (longestDeadAir) {
            improvements.push({
                key: 'deadAirGap',
                weight: 6,
                text: `Dead air: about ${formatDuration(longestDeadAir.silence)} with nothing said at ${formatClock(longestDeadAir.at)}. Narrate what you are doing while the system loads so the quiet does not stack up.`,
                quote: ''
            });
        }

        // Talk share is a proportion of the whole call, so a call with a piece
        // missing cannot be measured for it either.
        const totalWords = parsed.agentWords + parsed.customerWords;
        const agentShare = (parsed.labeled && !truncated && totalWords >= 120)
            ? parsed.agentWords / totalWords
            : null;
        if (agentShare !== null && agentShare >= 0.8) {
            improvements.push({
                key: 'airtime',
                weight: 4,
                text: `You did about ${Math.round(agentShare * 100)}% of the talking. Ask an open question and give the customer room to fill in the rest.`,
                quote: ''
            });
        } else if (agentShare !== null && agentShare <= 0.3) {
            improvements.push({
                key: 'callControl',
                weight: 4,
                text: `Call control: the customer drove about ${Math.round((1 - agentShare) * 100)}% of the conversation. Set the agenda early and steer with focused questions.`,
                quote: ''
            });
        }

        strengths.sort((a, b) => b.praise - a.praise);
        // The measured silence and the "one moment" filler count are the same
        // event described twice. When the timestamps have already put a number
        // and a time on it, the vaguer bullet adds nothing.
        const measuredSilence = improvements.some(item => item.key === 'longHold' || item.key === 'deadAirGap');
        if (measuredSilence) {
            const stallingIndex = improvements.findIndex(item => item.key === 'stalling');
            if (stallingIndex >= 0) improvements.splice(stallingIndex, 1);
        }

        improvements.sort((a, b) => b.weight - a.weight);

        const heavyIssues = improvements.filter(item => item.weight >= 8).length;

        return {
            ok: true,
            meta,
            // Handed to the QA scorer so silence is measured once, not twice.
            silenceGaps: gaps,
            headline: buildHeadline(strengths.length, heavyIssues, meta),
            // The drafts are capped so the email stays focused; the full lists
            // stay on the result so nothing is dropped without a trace.
            strengths: strengths.slice(0, MAX_STRENGTH_BULLETS),
            improvements: improvements.slice(0, MAX_ISSUE_BULLETS),
            allStrengths: strengths,
            allImprovements: improvements,
            stats: {
                labeled: parsed.labeled,
                timed: parsed.timed,
                truncated,
                turns: parsed.turns.length,
                agentWords: parsed.agentWords,
                customerWords: parsed.customerWords,
                agentTalkShare: agentShare,
                customerFrustrated: frustrated,
                strengthsFound: strengths.length,
                improvementsFound: improvements.length,
                heavyIssues
            }
        };
    }

    /**
     * A strong call should read as a strong call. The headline is the line the
     * associate will actually remember, so it only fires when it is earned.
     */
    function buildHeadline(strengthCount, heavyIssues, meta) {
        const lengthNote = meta && meta.durationLabel ? ` across ${meta.durationLabel} on the phone` : '';

        if (strengthCount >= 7 && !heavyIssues) {
            return `Outstanding call. You hit nearly every behaviour we coach to${lengthNote}, and the notes below are polish rather than problems. This is the call I would use to show someone else what good looks like.`;
        }
        if (strengthCount >= 5 && !heavyIssues) {
            return `Really strong call${lengthNote}. You had all the basics covered and nothing went sideways, nice work.`;
        }
        if (strengthCount >= 3 && heavyIssues <= 1) {
            return 'Solid call, and there are a few things in here you should keep doing.';
        }
        return '';
    }

    function toBulletText(items, emptyFallback) {
        if (!Array.isArray(items) || !items.length) {
            return emptyFallback || '';
        }
        return items.map(item => bullet(item.text, item.quote)).join('\n');
    }

    function buildStrengthsDraft(analysis) {
        const bullets = toBulletText(
            analysis?.strengths,
            '- Nothing stood out clearly in the transcript. Add the one thing you would want repeated on the next call.'
        );
        return analysis?.headline ? `${analysis.headline}\n\n${bullets}` : bullets;
    }

    function buildImprovementsDraft(analysis) {
        return toBulletText(
            analysis?.improvements,
            '- Nothing here needs fixing, so keep doing what you did and we will pick one thing to push on next call.'
        );
    }

    function buildAnalysisSummary(analysis) {
        if (!analysis?.ok) return 'Paste a transcript first.';
        const stats = analysis.stats || {};
        const meta = analysis.meta || {};
        const trimmed = Math.max(0, (stats.strengthsFound || 0) - analysis.strengths.length)
            + Math.max(0, (stats.improvementsFound || 0) - analysis.improvements.length);

        const parts = [];
        if (meta.callDate) {
            parts.push(`Call ${meta.callDate}${meta.callTime ? ` ${meta.callTime}` : ''}`);
        }
        if (meta.advisorDisplayName) parts.push(meta.advisorDisplayName);
        if (meta.durationLabel) parts.push(`length ${meta.durationLabel}`);
        parts.push(`${stats.turns || 0} turn${stats.turns === 1 ? '' : 's'} read`);
        parts.push(`${analysis.strengths.length} strength${analysis.strengths.length === 1 ? '' : 's'}`);
        parts.push(`${analysis.improvements.length} coaching point${analysis.improvements.length === 1 ? '' : 's'}`);
        if (trimmed > 0) {
            parts.push(`${trimmed} lower priority item${trimmed === 1 ? '' : 's'} held back to keep the email focused`);
        }
        if (!stats.labeled && !stats.timed) {
            parts.push('no speaker labels found, so everything was read as the associate');
        }
        if (stats.truncated) {
            parts.push('this transcript is trimmed, so nothing is reported as missing from the call');
        }

        return `${parts.join(' • ')}. Drafts are editable, review before you send.`;
    }

    /* ── Saying when the call was ──
     *
     * "2026-08-04" is a date an associate has to decode. The call they took at
     * lunchtime on a Tuesday three weeks ago is a thing they can actually
     * remember, so feedback about it should be introduced that way.
     */

    // Verint writes seconds and sometimes "P.M."; neither belongs in a sentence.
    function tidyCallTime(value) {
        const clean = collapse(value).toUpperCase().replace(/\./g, '');
        const match = clean.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*([AP]M)?$/);
        if (!match) return clean;
        return `${Number(match[1])}:${match[2]}${match[3] ? ` ${match[3]}` : ''}`;
    }

    /**
     * "Tuesday, August 4 at 12:38 PM", dropping whichever half is missing.
     *
     * The date is parsed at local midnight rather than handed straight to
     * Date(), because "2026-08-04" alone is read as UTC and renders as the 3rd
     * for anybody west of Greenwich, which is everybody here.
     */
    function formatCallMoment(callDate, callTime) {
        const time = tidyCallTime(callTime);
        const iso = collapse(callDate);

        let day = '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
            const parsed = new Date(`${iso}T00:00:00`);
            if (!Number.isNaN(parsed.getTime())) {
                day = parsed.toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric'
                });
            }
        } else if (iso) {
            day = iso;
        }

        if (day && time) return `${day} at ${time}`;
        return day || time || '';
    }

    function buildCallContextLines(rawText) {
        const meta = extractMetadata(rawText);
        const lines = [];
        if (meta.callTime) lines.push(`- Call time: ${meta.callTime}`);
        if (meta.durationLabel) lines.push(`- Call length: ${meta.durationLabel}`);
        if (meta.categories.length) {
            const named = meta.categories
                .filter(item => item.count > 0)
                .map(item => `${item.name} (${item.count})`)
                .join(', ');
            if (named) lines.push(`- Verint speech categories detected: ${named}`);
        }
        return lines;
    }

    /**
     * Matches "Dimes, Alyssa" from an export against an "Alyssa Dimes" style
     * dropdown option.
     */
    function matchAssociateOption(options, name) {
        const key = (value) => String(value || '')
            .toLowerCase()
            .replace(/[^a-z\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .sort()
            .join(' ');

        const target = key(name);
        if (!target) return '';
        return (options || []).find(option => key(option) === target) || '';
    }

    /**
     * Trims a transcript to the storage ceiling, keeping both ends.
     *
     * Cutting only the tail is what invented coaching: the rules that fire on
     * a missing recap or a missing close cannot tell "she never did it" apart
     * from "the part where she did it was deleted". Keeping the close means the
     * evidence for those is still there, and analyzeTranscript refuses to draw
     * "missing" conclusions from a truncated transcript regardless.
     *
     * The cut lands on a line boundary so a Verint timestamp is never split
     * from the speech underneath it.
     */
    function clampForStorage(rawText) {
        const text = String(rawText || '').trim();
        if (text.length <= MAX_STORED_TRANSCRIPT_CHARS) return text;

        const budget = MAX_STORED_TRANSCRIPT_CHARS - TRUNCATION_MARKER.length - 2;
        const headBudget = Math.floor(budget * TRUNCATION_HEAD_SHARE);
        const tailBudget = budget - headBudget;

        // Snap to line boundaries, then drop a trailing bare timestamp. An
        // orphaned "04:30" with the speech under it cut away parses as a turn
        // that never happened, and the silence maths would treat the gap to it
        // as real dead air.
        const head = text.slice(0, headBudget);
        const headCut = head.lastIndexOf('\n');
        const headLines = (headCut > headBudget * 0.5 ? head.slice(0, headCut) : head).split('\n');
        while (headLines.length && TIMESTAMP_ONLY_LINE.test(headLines[headLines.length - 1])) {
            headLines.pop();
        }

        const tail = text.slice(-tailBudget);
        const tailCut = tail.indexOf('\n');
        const tailText = (tailCut >= 0 && tailCut < tailBudget * 0.5) ? tail.slice(tailCut + 1) : tail;

        return [headLines.join('\n'), TRUNCATION_MARKER, tailText].join('\n');
    }

    function clampForPrompt(rawText) {
        const text = String(rawText || '').trim();
        if (text.length <= MAX_PROMPT_TRANSCRIPT_CHARS) return text;
        return `${text.slice(0, MAX_PROMPT_TRANSCRIPT_CHARS)}\n[transcript truncated]`;
    }

    // Stored and prompted transcripts drop the export chrome. A one line header
    // keeps the facts that the chrome was carrying.
    function prepareForStorage(rawText) {
        const meta = extractMetadata(rawText);
        const body = stripBoilerplate(rawText) || String(rawText || '').trim();
        const firedCategories = (meta.categories || [])
            .filter(item => item.count > 0)
            .map(item => `${item.name}=${item.count}`)
            .join(';');

        const header = [
            meta.callDate ? `Call ${meta.callDate}` : '',
            meta.callTime,
            meta.advisorDisplayName,
            meta.durationLabel ? `length ${meta.durationLabel}` : '',
            firedCategories ? `cats:${firedCategories}` : ''
        ].filter(Boolean).join(' • ');

        return clampForStorage(header ? `[${header}]\n\n${body}` : body);
    }

    function prepareForPrompt(rawText) {
        return clampForPrompt(stripBoilerplate(rawText) || String(rawText || '').trim());
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callTranscript = {
        extractMetadata,
        stripBoilerplate,
        parseTranscript,
        analyzeTranscript,
        // Exported so the word-choice scan can ask "was this emotion cue
        // acknowledged" using the same empathy definition scored here, rather
        // than keeping a second copy of the pattern that can drift from it.
        strengthPattern,
        buildStrengthsDraft,
        buildImprovementsDraft,
        buildAnalysisSummary,
        buildCallContextLines,
        tidyCallTime,
        formatCallMoment,
        matchAssociateOption,
        clampForStorage,
        clampForPrompt,
        prepareForStorage,
        prepareForPrompt,
        MAX_STORED_TRANSCRIPT_CHARS,
        MAX_PROMPT_TRANSCRIPT_CHARS
    };
})();
