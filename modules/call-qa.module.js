(function() {
    'use strict';

    /**
     * Answers the Interaction Review QA form from the transcript.
     *
     * The form asks five yes/no questions and three checklists. Some of them a
     * transcript can genuinely answer (was the caller verified before account
     * details were shared, was there a long hold). Some of them it cannot: no
     * transcript shows whether the account was notated, and no rules engine can
     * confirm a quoted rate was the correct one.
     *
     * So every check returns one of three verdicts. `met` and `opportunity` are
     * claims backed by a quote. `unknown` says plainly that the transcript does
     * not carry the answer, which is the honest result and leaves the call with
     * the supervisor rather than quietly guessing.
     */

    const VERDICT = { met: 'met', opportunity: 'opportunity', unknown: 'unknown' };

    /* ── What the rules listen for ──
     *
     * Verification is not in here. It was two patterns, "verify" anywhere and
     * "your balance" anywhere, compared by position, and on the calls it most
     * needed to catch it answered Yes: asking for the address counted as the
     * identity check. call-verification reads it as a sequence instead, and
     * this form asks that module for its answer.
     */

    const APPRECIATION = /(?:very|really|so) helpful|you'?ve been (?:so |really |very )?(?:helpful|great|wonderful|amazing)|i (?:really )?appreciate (?:you|your|it|that)|you'?re the best|thank you so much(?! for (?:holding|waiting|calling|your patience))/i;
    const APS_FEEDBACK = /(?:aps|a p s|a t s) (?:has been|is|was) (?:really |very |so )?(?:great|good|terrible|awful|helpful|useless)|love (?:aps|a p s)|hate (?:aps|a p s)/i;

    const AUDIO_ISSUE = /can you hear me|you'?re breaking up|you are breaking up|bad connection|i can'?t hear you|hello\?\s*hello|you keep cutting out|static on the line/i;
    const SYSTEM_ISSUE = /it'?s just loading|still loading|system is (?:slow|down|being slow)|my (?:system|computer) is|screen (?:froze|is frozen)|having (?:some )?(?:system|computer|technical) (?:issues|trouble|problems)|it'?s not letting me|kicked me out/i;
    const CALL_DROPPED = /call (?:dropped|disconnected)|got (?:cut off|disconnected)|we were disconnected/i;

    const PAYMENT_TROUBLE = /can'?t afford|cannot afford|struggling to pay|past due|shut ?off notice|disconnect(?:ion)? notice|payment (?:arrangement|plan|extension)|need (?:more )?time to pay|behind on (?:my|the) bill/i;
    const PAYMENT_OFFER = /payment (?:arrangement|plan|extension)|budget billing|(?:set|break) (?:it |that )?up (?:in|into) payments|assistance program|energy support|extend (?:your|the) due date/i;

    const PROGRAM_CONTEXT = /\bplan\b|\bprogram\b|assistance|budget billing|autopay|auto pay|paperless|rate/i;
    const OFFERING = /(?:we have|there are) (?:two|three|four|\d+) [a-z ]*plans|plans available|the (?:first|second|third) plan|i(?:'?d| would) recommend|you might want to go with|you can also|for future reference|once you are registered|take advantage of/i;

    const ASSISTANCE_OFFERED = /anything else (?:i can (?:help|do|assist)|you need)|is there anything else|any questions anything i can answer|do you have any questions|before (?:i let you go|we (?:hang up|wrap up))/i;

    const NEXT_STEPS = /what happens is|will be on hold until|you will get an email back|you'?ll (?:receive|get) (?:an|the) email|case number|review those documents|next step|within \d+ (?:hours|business days|days)|you(?:'?ll| will) (?:see|receive|get)/i;
    const PROCESS_EXPLAINED = /the reason (?:is|for that)|what that means|this is (?:how|what)|so that (?:means|way)|the way (?:it|that) works|this plan (?:works|has)|it'?ll be (?:included|applied)|will be applied to your/i;

    const RESOLUTION = /you'?re all set|all set on our end|that'?s (?:all )?(?:taken care of|done|set up)|i(?:'?ve| have) (?:credited|refunded|updated|submitted|processed)|your (?:order|account|service) is (?:set|created|started)/i;
    const CUSTOMER_ASSENT = /sounds good|that'?s good|perfect|great thank you|thank you|that works|okay perfect/i;
    const LEFT_OPEN = /i'?ll (?:have to )?call you back|someone will (?:call|reach out)|i can'?t (?:help|do) (?:you|that)|you'?ll have to call|nothing (?:more )?i can do/i;

    /* ── Disclosures ──
       Each one is only judged when the call actually went near it, so a short
       bill enquiry is not marked down for skipping the rate plan script. */
    const DISCLOSURES = [
        {
            key: 'greeting',
            label: 'Branded greeting and advisor name',
            applies: () => true,
            pattern: /thank(?:s| you) for (?:calling|being a valued customer)|my name is|this is \w+ speaking/i
        },
        {
            key: 'verification',
            label: 'Identity verification',
            // Credited here when it was done. When it was not, the form's own
            // verification question says so, with the time and the line; this
            // row listing it as well put the same miss in her email twice.
            applies: (text, context) => Boolean(context.verification?.identityAsks?.length),
            heard: () => true,
            quote: (context) => context.verification?.identityAsks?.[0]?.quote || ''
        },
        {
            key: 'depositAmount',
            label: 'Deposit amount and when it is due',
            applies: (text) => /deposit/i.test(text),
            pattern: /deposit of .{0,60}(?:dollars|\$|cents)/i
        },
        {
            key: 'depositTiming',
            label: 'When the deposit is billed and returned',
            applies: (text) => /deposit/i.test(text),
            pattern: /not due today|included on your first bill|applied to your account as a credit|after a year of service/i
        },
        {
            key: 'rateQuoted',
            label: 'Rates quoted for the plans discussed',
            applies: (text) => /\bplan\b/i.test(text),
            pattern: /cents per kilowatt hour|per kilowatt hour|kilowatt/i
        },
        {
            key: 'planFlexibility',
            label: 'Plan can be changed, and when a change takes effect',
            applies: (text) => /\bplan\b/i.test(text),
            pattern: /change your plan .{0,30}anytime|no fee to do so|applied for the next bill cycle|we can change it later/i
        },
        {
            key: 'effectiveDate',
            label: 'When the chosen plan takes effect',
            applies: (text) => /\bplan\b/i.test(text),
            pattern: /effective the start of service|will appear on your next bill|effective (?:on|from)/i
        },
        {
            key: 'whereToFind',
            label: 'Where the customer can review it themselves',
            applies: (text) => /\bplan\b/i.test(text),
            pattern: /(?:a ?t ?s|a ?p ?s|aps)\.?\s?(?:dot )?com|on the (?:app|website|portal)|once you are registered/i
        },
        {
            key: 'idRequirement',
            label: 'Photo ID requirement explained',
            applies: (text) => /photo id|picture of your (?:photo )?id|driver'?s license|passport/i.test(text),
            pattern: /picture of your (?:photo )?id|send .{0,30}photo id|we'?ll need .{0,30}id/i
        }
    ];

    /* ── Helpers ── */

    function clip(text, max) {
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        const limit = max || 110;
        if (clean.length <= limit) return clean;
        const cut = clean.slice(0, limit);
        const lastSpace = cut.lastIndexOf(' ');
        return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}...`;
    }

    function firstIndexMatching(turns, pattern, side) {
        return turns.findIndex(turn => (side === 'customer' ? turn.role === 'customer' : turn.role !== 'customer')
            && pattern.test(turn.text));
    }

    function quoteFor(turns, pattern, side) {
        const index = firstIndexMatching(turns, pattern, side);
        return index >= 0 ? clip(turns[index].text) : '';
    }

    function check(id, question, verdict, detail, evidence) {
        return { id, question, verdict, detail, evidence: evidence || '' };
    }

    /* ── The five form questions ── */

    const VERIFICATION_QUESTION = 'Did advisor verify caller before sharing account information?';

    /**
     * The form's verification question, answered by call-verification.
     *
     * A failure here is not an "opportunity" like a missed rate script: it is
     * account information given to somebody who was not shown to be entitled
     * to it. So it keeps the form's verdict, which is what the Verint form and
     * the exports expect, and carries a severity the screen and the text use
     * to say so plainly.
     */
    function checkVerification(read) {
        const reader = window.DevCoachModules?.callVerification;
        if (!read?.ok || typeof reader?.describe !== 'function') {
            return check('verification', VERIFICATION_QUESTION, VERDICT.unknown,
                'The verification read is not available, so listen for this one yourself.');
        }

        const said = reader.describe(read);
        return Object.assign(
            check('verification', VERIFICATION_QUESTION, read.verdict, said.detail, said.evidence),
            { severity: read.redFlag ? 'red' : '' }
        );
    }

    function checkDisclosures(turns, agentText, context) {
        const isHeard = (item) => (typeof item.heard === 'function'
            ? item.heard(agentText, context)
            : item.pattern.test(agentText));
        const quoteOf = (item) => (typeof item.quote === 'function'
            ? item.quote(context)
            : quoteFor(turns, item.pattern));

        const applicable = DISCLOSURES.filter(item => item.applies(agentText, context));
        const heard = applicable.filter(isHeard);
        const missed = applicable.filter(item => !isHeard(item));

        const detail = missed.length
            ? `Heard ${heard.length} of ${applicable.length}. Not heard: ${missed.map(item => item.label.toLowerCase()).join('; ')}.`
            : `All ${applicable.length} disclosures that applied to this call were covered.`;

        return Object.assign(
            check('disclosures', 'Did advisor cover all required disclosures and scripts?',
                missed.length ? VERDICT.opportunity : VERDICT.met,
                detail,
                heard.length ? quoteOf(heard[heard.length - 1]) : ''),
            { heard: heard.map(item => item.label), missed: missed.map(item => item.label) }
        );
    }

    function checkProcessExplained(turns, agentText) {
        const explained = PROCESS_EXPLAINED.test(agentText);
        const nextSteps = NEXT_STEPS.test(agentText);

        if (explained && nextSteps) {
            return check('process', 'Was the process accurately explained?',
                VERDICT.met,
                'The customer was told how it works and what happens next. This checks that the explanation was complete, not that every figure in it was right, so give the numbers your own ear.',
                quoteFor(turns, NEXT_STEPS));
        }

        if (!nextSteps) {
            return check('process', 'Was the process accurately explained?',
                VERDICT.opportunity,
                'No clear "here is what happens next" was heard. That is usually what drives the repeat call.');
        }

        return check('process', 'Was the process accurately explained?',
            VERDICT.opportunity,
            'Next steps were given but the reasoning behind them was thin. Say why, not just what.',
            quoteFor(turns, NEXT_STEPS));
    }

    function checkResolved(turns, agentText, customerText) {
        const resolved = RESOLUTION.test(agentText);
        const leftOpen = LEFT_OPEN.test(agentText);
        const assent = CUSTOMER_ASSENT.test(customerText);

        if (resolved && !leftOpen) {
            return check('resolved', 'Was the customers inquiry resolved and completed?',
                VERDICT.met,
                assent
                    ? 'Closed out on the call and the customer agreed it was handled.'
                    : 'Closed out on the call.',
                quoteFor(turns, RESOLUTION));
        }

        if (leftOpen) {
            return check('resolved', 'Was the customers inquiry resolved and completed?',
                VERDICT.opportunity,
                'The call ended with the issue handed off or left open.',
                quoteFor(turns, LEFT_OPEN));
        }

        return check('resolved', 'Was the customers inquiry resolved and completed?',
            VERDICT.unknown,
            'No clear resolution statement either way. Worth a listen to the last minute.');
    }

    function checkNotation() {
        return check('notation', 'Did advisor notate properly?',
            VERDICT.unknown,
            'A transcript cannot show this. Check the account notes in the system.');
    }

    /* ── The three checklists ── */

    function buildKudos(turns, customerText) {
        const items = [];
        if (APPRECIATION.test(customerText)) {
            items.push({ label: 'Compliment from Caller', evidence: quoteFor(turns, APPRECIATION, 'customer') });
        }
        if (APS_FEEDBACK.test(customerText)) {
            items.push({ label: 'Feedback about APS', evidence: quoteFor(turns, APS_FEEDBACK, 'customer') });
        }
        return items;
    }

    function buildCallOpportunities(turns, agentText, customerText, context) {
        const items = [];
        const holds = (context.silenceGaps || []).filter(gap => gap.silence >= 90);

        if (holds.length) {
            const worst = holds[0];
            items.push({
                label: 'Long Hold',
                evidence: `about ${Math.round(worst.silence / 60)}m${String(Math.round(worst.silence % 60)).padStart(2, '0')}s of silence at ${Math.floor(worst.at / 60)}:${String(worst.at % 60).padStart(2, '0')}`
            });
        }

        if (PROGRAM_CONTEXT.test(agentText) && !OFFERING.test(agentText)) {
            items.push({ label: 'Solution/Program Offering Missed', evidence: 'No plan, program or self service option was offered.' });
        }

        if (!ASSISTANCE_OFFERED.test(agentText)) {
            items.push({ label: 'Offering Assistance', evidence: 'The call closed without asking if there was anything else.' });
        }

        if (PAYMENT_TROUBLE.test(customerText) && !PAYMENT_OFFER.test(agentText)) {
            items.push({
                label: 'Did not Negotiate Payment',
                evidence: quoteFor(turns, PAYMENT_TROUBLE, 'customer') || 'Payment difficulty was raised with no arrangement offered.'
            });
        }

        return items;
    }

    function buildTechOpportunities(turns, agentText) {
        const items = [];
        if (AUDIO_ISSUE.test(agentText)) {
            items.push({ label: 'Audio Issues', evidence: quoteFor(turns, AUDIO_ISSUE) });
        }
        if (SYSTEM_ISSUE.test(agentText)) {
            items.push({ label: 'System Errors', evidence: quoteFor(turns, SYSTEM_ISSUE) });
        }
        if (CALL_DROPPED.test(agentText)) {
            items.push({ label: 'Call Dropped', evidence: quoteFor(turns, CALL_DROPPED) });
        }
        return items;
    }

    /**
     * Scores a transcript against the QA form. `context` carries anything the
     * transcript analyzer already worked out, notably the measured silences.
     */
    function scoreCall(rawText, options = {}) {
        const transcript = String(rawText || '').trim();
        if (!transcript) {
            return { ok: false, reason: 'empty', checks: [], kudos: [], callOpportunities: [], techOpportunities: [] };
        }

        const analyzer = window.DevCoachModules?.callTranscript;
        const parsed = analyzer?.parseTranscript
            ? analyzer.parseTranscript(transcript, options)
            : { turns: [], agentText: transcript, customerText: '' };

        const turns = parsed.turns || [];
        const agentText = parsed.agentText || '';
        const customerText = parsed.customerText || '';

        // Read once, from the same parse every other check uses.
        const reader = window.DevCoachModules?.callVerification;
        const verification = reader?.readVerification ? reader.readVerification(parsed) : null;
        const context = { ...(options.context || {}), verification };

        const checks = [
            checkVerification(verification),
            checkDisclosures(turns, agentText, context),
            checkProcessExplained(turns, agentText),
            checkResolved(turns, agentText, customerText),
            checkNotation()
        ];

        return {
            ok: true,
            checks,
            verification,
            redFlag: checks.some(item => item.severity === 'red'),
            kudos: buildKudos(turns, customerText),
            callOpportunities: buildCallOpportunities(turns, agentText, customerText, context),
            techOpportunities: buildTechOpportunities(turns, agentText),
            counts: {
                met: checks.filter(item => item.verdict === VERDICT.met).length,
                opportunity: checks.filter(item => item.verdict === VERDICT.opportunity).length,
                unknown: checks.filter(item => item.verdict === VERDICT.unknown).length,
                redFlags: checks.filter(item => item.severity === 'red').length
            }
        };
    }

    /* ── Output ── */

    const VERDICT_WORD = {
        met: 'Yes',
        opportunity: 'Opportunity',
        unknown: 'Cannot tell from transcript'
    };

    // A red flag is a plain No on the form, not an opportunity.
    const RED_FLAG_WORD = 'No, red flag';

    function verdictWord(item) {
        return item.severity === 'red' ? RED_FLAG_WORD : VERDICT_WORD[item.verdict];
    }

    function listOrNone(items) {
        if (!items.length) return 'None';
        return items.map(item => (item.evidence ? `${item.label} (${item.evidence})` : item.label)).join('; ');
    }

    /**
     * Plain text for the Verint note and the Copilot prompt.
     */
    function buildQaText(qa) {
        if (!qa?.ok) return '';

        const lines = ['QA read from the transcript (verify before you submit):'];
        qa.checks.forEach(item => {
            const evidence = item.evidence ? ` ("${item.evidence}")` : '';
            lines.push(`- ${item.question} ${verdictWord(item)}. ${item.detail}${evidence}`);
        });
        lines.push(`- Kudos/Compliments: ${listOrNone(qa.kudos)}`);
        lines.push(`- Call Opportunities: ${listOrNone(qa.callOpportunities)}`);
        lines.push(`- Tech Opportunities: ${listOrNone(qa.techOpportunities)}`);

        return lines.join('\n');
    }

    const VERDICT_STYLE = {
        met: { background: 'var(--green-soft)', color: 'var(--green-text)', border: 'var(--green)' },
        opportunity: { background: 'var(--yellow-soft)', color: 'var(--yellow-text)', border: 'var(--yellow)' },
        unknown: { background: 'var(--bg-surface-sunken)', color: 'var(--text-secondary)', border: 'var(--border-strong)' },
        red: { background: 'var(--red-soft)', color: 'var(--red-text)', border: 'var(--red)' }
    };

    function buildQaHtml(qa, escapeHtml) {
        const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        if (!qa?.ok) return '';

        const row = (item) => {
            const style = (item.severity === 'red' ? VERDICT_STYLE.red : VERDICT_STYLE[item.verdict]) || VERDICT_STYLE.unknown;
            const evidence = item.evidence
                ? `<div class="call-qa-evidence">"${safe(item.evidence)}"</div>`
                : '';
            return `<li class="call-qa-row">
                <span class="call-qa-chip" style="background: ${style.background}; color: ${style.color}; border-color: ${style.border};">${safe(verdictWord(item))}</span>
                <div>
                    <div class="call-qa-question">${safe(item.question)}</div>
                    <div class="call-qa-detail">${safe(item.detail)}</div>
                    ${evidence}
                </div>
            </li>`;
        };

        const checklist = (title, items) => `<div class="call-qa-checklist">
            <strong>${safe(title)}:</strong> ${items.length
                ? items.map(item => `${safe(item.label)}${item.evidence ? ` <span class="call-qa-detail">(${safe(item.evidence)})</span>` : ''}`).join(', ')
                : 'None'}
        </div>`;

        return `<ul class="call-qa-list">${qa.checks.map(row).join('')}</ul>
            ${checklist('Kudos/Compliments', qa.kudos)}
            ${checklist('Call Opportunities', qa.callOpportunities)}
            ${checklist('Tech Opportunities', qa.techOpportunities)}`;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callQa = {
        scoreCall,
        buildQaText,
        buildQaHtml,
        verdictWord,
        VERDICT
    };
})();
