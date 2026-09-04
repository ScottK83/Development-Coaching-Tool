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

    const MAX_STORED_TRANSCRIPT_CHARS = 8000;
    const MAX_PROMPT_TRANSCRIPT_CHARS = 12000;
    const MAX_QUOTE_CHARS = 110;
    const MAX_STRENGTH_BULLETS = 6;
    const MAX_ISSUE_BULLETS = 5;

    // Speech runs at roughly 2.5 words a second, which is enough to tell a
    // pause apart from someone still talking.
    const WORDS_PER_SECOND = 2.5;
    const DEAD_AIR_SECONDS = 45;
    const LONG_HOLD_SECONDS = 90;

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
        let text = String(rawText || '');

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
            current.text = collapse(`${current.text} ${content}`);
        });

        return turns.filter(turn => turn.text);
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
            return buildParseResult(inferRolesByFlow(attributeByCue(parseTimestampedTurns(text))), false);
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
            made: 'Clean open. You branded the call and gave your name straight away, which sets the tone for everything after it.',
            missing: 'Opening: lead with the branded greeting and your name so the customer knows exactly who they are working with.',
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
            made: 'Verification done properly before anything on the account was discussed. That is the one that protects everybody.',
            missing: 'Verification: confirm identity up front before you discuss anything on the account.',
            missingWeight: 8
        },
        {
            key: 'holdEtiquette',
            praise: 6,
            pattern: /(?:may|can|could|would it be ok(?:ay)? if) i (?:please )?(?:place|put) you on(?: a (?:brief|short|quick))? hold|i'?m just gonna place you on a (?:brief|short|quick) hold|do you mind (?:if i|holding)|thank(?:s| you) for holding|appreciate (?:you|your) (?:holding|patience)/i,
            made: 'Textbook hold. You flagged it before it happened and thanked them on the way back.'
        },
        {
            key: 'optionsOffered',
            praise: 7,
            pattern: /(?:we have|there are) (?:two|three|four|\d+) [a-z ]*plans|plans available|the (?:first|second|third) plan (?:is|that we offer)|compar(?:e|ison) (?:of |the )?(?:plans|options)|options available to you/i,
            made: 'You laid out the full set of options rather than defaulting to one, which is exactly the offering the QA form looks for.'
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
            missing: 'Recap: close by restating what you did and what it means for the customer.',
            missingWeight: 5
        },
        {
            key: 'nextSteps',
            praise: 6,
            pattern: /next step|you (?:will|'ll) (?:receive|see|get|be)|within (?:\d+|twenty.four|forty.eight) (?:hours|business days|days)|i'?ll follow up|follow up with you|in \d+ (?:to \d+ )?(?:business )?days|by (?:monday|tuesday|wednesday|thursday|friday|the end of)|what happens is/i,
            made: 'Clear next steps with a time frame attached. That is what stops the second call.',
            missing: 'Next steps: tell the customer exactly what happens next and by when, even when the answer is not what they wanted.',
            missingWeight: 7
        },
        {
            key: 'courtesyClose',
            praise: 4,
            pattern: /anything else (?:i can (?:help|do|assist)|you need)|is there anything else|any questions anything i can answer|before (?:i let you go|we (?:hang up|wrap up|finish))/i,
            made: 'Solid close. You offered more help before wrapping up rather than rushing off the line.',
            missing: 'Close: ask if there is anything else before you wrap up.',
            missingWeight: 3
        }
    ];

    // Present in the associate's speech = something to coach.
    const ISSUE_RULES = [
        {
            key: 'deflection',
            weight: 10,
            pattern: /there(?:'?s| is) nothing i can do|i (?:can'?t|cannot) do anything|that(?:'?s| is) (?:just )?(?:our|the) policy|that(?:'?s| is) policy|you(?:'?ll| will) have to (?:call|contact|go)|you need to call|not my department|i don'?t handle (?:that|those)/i,
            text: 'Dead end language: this landed as "no" with nowhere to go. Say what you can do and why, then offer the next best option.'
        },
        {
            key: 'repeatCustomer',
            weight: 8,
            side: 'customer',
            pattern: /like i (?:said|told you|mentioned)|as i (?:said|mentioned|explained)|i already (?:said|told|explained)|i just (?:said|told)/i,
            text: 'Active listening: the customer had to repeat themselves. Recap what you heard before you ask the next question.'
        },
        {
            key: 'supervisorRequest',
            weight: 8,
            side: 'customer',
            pattern: /(?:speak|talk) (?:to|with) (?:a|your) (?:supervisor|manager)|get me a (?:supervisor|manager)|escalate this/i,
            text: 'Escalation request: acknowledge it directly, make one clear ownership attempt, then follow the escalation path without making the customer ask twice.'
        },
        {
            key: 'deadAir',
            weight: 6,
            pattern: /\[(?:silence|pause|dead air|no response)[^\]]*\]/i,
            text: 'Dead air: narrate what you are doing while systems load so the silence does not stack up.'
        },
        {
            key: 'stalling',
            weight: 5,
            threshold: 3,
            pattern: /one moment|just a (?:moment|second|sec)|bear with me|give me (?:one|a) (?:second|moment)|still (?:there|checking|loading)|it'?s just loading/i,
            text: 'Silence fillers came up repeatedly. Tell the customer what you are checking rather than asking them to keep waiting.'
        },
        {
            key: 'uncertainty',
            weight: 6,
            threshold: 3,
            pattern: /\bi think\b|\bi(?:'?m| am) not (?:really )?sure\b|\bi guess\b|\bhopefully\b|\bit should\b/i,
            text: 'Confidence: hedging language showed up several times. Verify it, then state the answer plainly so the customer trusts it.'
        },
        {
            key: 'apologyLoop',
            weight: 4,
            threshold: 5,
            pattern: /i(?:'?m| am) (?:so |very |really )?sorry|i apologi[sz]e/i,
            text: 'Over apologising: after the first genuine apology, move to what you are doing about it.'
        },
        {
            key: 'filler',
            weight: 3,
            threshold: 6,
            pattern: /\b(?:um+|uh+|erm|er)\b/i,
            text: 'Filler words: a short pause reads as more confident than "um" while you think.'
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

            gaps.push({
                at: current.at,
                silence,
                announced: strengthPattern('holdEtiquette').test(current.text) || HOLD_MENTION.test(current.text)
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

        STRENGTH_RULES.forEach(rule => {
            if (rule.pattern.test(agentText)) {
                strengths.push({ key: rule.key, praise: rule.praise || 5, text: rule.made, quote: findQuote(turns, rule.pattern) });
            } else if (rule.missing) {
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
            empathyGap.text = 'Empathy: the customer signalled real frustration and it went unacknowledged. Name what they are dealing with before you move to the fix.';
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
                text: 'Hold process: ask permission before the hold, give a time frame, and thank the customer when you come back.',
                quote: findQuote(turns, HOLD_MENTION)
            });
        }

        if (TRANSFER.test(agentText) && !WARM_TRANSFER.test(agentText)) {
            improvements.push({
                key: 'coldTransfer',
                weight: 7,
                text: 'Transfers: brief the receiving team while the customer is still with you so they do not start over.',
                quote: findQuote(turns, TRANSFER)
            });
        }

        const gaps = findSilenceGaps(turns);
        const longestHold = gaps.find(gap => gap.announced && gap.silence >= LONG_HOLD_SECONDS);
        if (longestHold) {
            improvements.push({
                key: 'longHold',
                weight: 7,
                text: `Long hold: about ${formatDuration(longestHold.silence)} of silence starting at ${formatClock(longestHold.at)}. The hold was announced, which is right, but check back in every 45 seconds or so rather than leaving them there.`,
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

        const totalWords = parsed.agentWords + parsed.customerWords;
        const agentShare = (parsed.labeled && totalWords >= 120) ? parsed.agentWords / totalWords : null;
        if (agentShare !== null && agentShare >= 0.8) {
            improvements.push({
                key: 'airtime',
                weight: 4,
                text: `Airtime: you carried about ${Math.round(agentShare * 100)}% of the talk time. Ask an open question and let the customer fill in the gaps.`,
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
            return `Really strong call${lengthNote}. The fundamentals were all there and nothing needed rescuing. Well done.`;
        }
        if (strengthCount >= 3 && heavyIssues <= 1) {
            return 'Solid call with real strengths to build on.';
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
            '- No coaching flags surfaced. Reinforce what worked and set one stretch goal for the next call.'
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

        return `${parts.join(' • ')}. Drafts are editable, review before you send.`;
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

    function clampForStorage(rawText) {
        const text = String(rawText || '').trim();
        if (text.length <= MAX_STORED_TRANSCRIPT_CHARS) return text;
        return `${text.slice(0, MAX_STORED_TRANSCRIPT_CHARS)}\n[transcript truncated for storage]`;
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
        const header = [
            meta.callDate ? `Call ${meta.callDate}` : '',
            meta.callTime,
            meta.advisorDisplayName,
            meta.durationLabel ? `length ${meta.durationLabel}` : ''
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
        matchAssociateOption,
        clampForStorage,
        clampForPrompt,
        prepareForStorage,
        prepareForPrompt,
        MAX_STORED_TRANSCRIPT_CHARS,
        MAX_PROMPT_TRANSCRIPT_CHARS
    };
})();
