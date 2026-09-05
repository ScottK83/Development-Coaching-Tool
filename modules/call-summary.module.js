(function() {
    'use strict';

    /**
     * Says what happened on the call, in a few sentences.
     *
     * Written for the associate to read, so it goes at the top of a coaching
     * message and they know which conversation is being discussed before they
     * get to the feedback. A recap they recognise is what makes the rest of the
     * message land; feedback about an unidentified call is just an assertion.
     *
     * There is no model here, so nothing is invented. Every sentence is built
     * from something the transcript or the Verint header actually carries:
     *
     *   what it was about   Verint's own speech categories where the export has
     *                       them, since those are the call centre's own
     *                       classification, and keyword detection on the
     *                       customer's side otherwise.
     *   what was asked      the customer's first substantive turn, quoted.
     *   what was done       agent actions detected in the order they appear.
     *   how it went         resolved, left open, or escalated, plus whatever
     *                       the customer said at the end.
     *
     * Where a piece cannot be established it is left out rather than guessed
     * at. A summary that says "about a billing issue" when it does not know is
     * worse than one that does not mention the subject, because the associate
     * will spot it and stop trusting the rest.
     */

    const MAX_QUOTE_CHARS = 120;

    /* ── What the call was about ──
     *
     * Verint's categories come first. They are what the call centre already
     * decided the call was, and agreeing with the system of record beats a
     * second opinion from a regex.
     */
    const CATEGORY_TOPICS = [
        { match: /high bill/i, topic: 'a higher than expected bill' },
        { match: /payment options|payment arrangement/i, topic: 'payment options' },
        { match: /rate migration|service plans/i, topic: 'rate plans' },
        { match: /bill inquir/i, topic: 'a question about the bill' },
        { match: /start service|new service/i, topic: 'starting new service' },
        { match: /stop service|disconnect/i, topic: 'stopping service' },
        { match: /outage/i, topic: 'an outage' },
        { match: /deposit/i, topic: 'a deposit' }
    ];

    const KEYWORD_TOPICS = [
        // "i got an apartment i signed a lease today, i have to look it up
        // before i grab the keys tomorrow" is how somebody says this. None of
        // it contains the words "new service".
        { key: 'newService', topic: 'starting new service', pattern: /start(?:ing)? service|set up service|new (?:apartment|address|place|house)|mov(?:ing|ed) in|move in|got an apartment|sign(?:ed|ing)? (?:a |the )?lease|grab the keys|get the keys|turn on (?:my |the )?(?:power|service|electric)/i },
        // "power has been out since this morning" is how somebody actually
        // reports it, so the tense has to be allowed for.
        { key: 'outage', topic: 'an outage', pattern: /no power|power (?:is |has been |been |went )?out\b|outage|lights (?:are |have been )?out\b|nothing is working/i },
        { key: 'doubleCharge', topic: 'being charged twice', pattern: /charged twice|double.?(?:charg|bill)|charged me two/i },
        { key: 'highBill', topic: 'a higher than expected bill', pattern: /bill (?:is|went|doubled|jumped)|high bill|bill went up|why is my bill|bill is (?:so )?high|too high/i },
        { key: 'payment', topic: 'paying the bill', pattern: /can'?t afford|cannot afford|past due|shut ?off|disconnect(?:ion)? notice|payment (?:arrangement|plan|extension)|behind on (?:my|the) bill|need (?:more )?time to pay/i },
        { key: 'dueDate', topic: 'the due date', pattern: /due date/i },
        { key: 'planChange', topic: 'rate plans', pattern: /change (?:my )?plan|switch (?:my )?plan|rate plan|plan options|which plan/i },
        { key: 'moveOut', topic: 'stopping service', pattern: /stop (?:my )?service|move out|moving out|clos(?:e|ing) (?:my )?account/i },
        { key: 'autopay', topic: 'autopay and paperless billing', pattern: /auto ?pay|paperless/i },
        { key: 'deposit', topic: 'a deposit', pattern: /deposit/i },
        { key: 'meter', topic: 'a meter reading', pattern: /meter read|read (?:my|the) meter|meter is/i }
    ];

    /* ── What the associate did ──
     *
     * Ordered by where the phrase first appears, so the recap follows the call
     * rather than the order of this list.
     */
    const AGENT_ACTIONS = [
        // Widened to how the floor actually asks. A real 39 minute call took
        // a name, a social, a phone number and a previous address and none of
        // it was recognised, so the recap reported one action on a call with
        // six in it. Verint's own words are not the ones anybody says.
        { key: 'verified', label: 'took the customer through verification', pattern: /verif(?:y|ication|ying)|identity check|date of birth|last four|confirm(?:ing)? your (?:name|address|identity)|(?:may|can|could) i (?:please )?(?:get|have) your(?: full)?(?: first and last)? (?:name|social|address|phone|cell)|full social|social security/i },
        { key: 'createdAccount', label: 'set the account up', pattern: /create an account|creat(?:ed|ing) (?:your|the|an) account|start(?:ed)? (?:your|the) service|set (?:you|your account) up/i },
        { key: 'disclosed', label: 'went over the rate plan details', pattern: /fixed energy charge plan|time of use|off peak|super off peak|demand charge|kilowatt hour|comparison tool|change your rate plan/i },
        { key: 'explained', label: 'walked through what was on the bill', pattern: /the reason (?:is|for that)|what that means|the way (?:it|that) works|this (?:charge|amount) is|that is why your/i },
        { key: 'options', label: 'laid out the plan options', pattern: /(?:we have|there are) (?:two|three|four|\d+) [a-z ]*plans|plans available|the (?:first|second|third) plan/i },
        { key: 'recommended', label: 'made a recommendation', pattern: /i(?:'?d| would) recommend|my recommendation|you might want to go with/i },
        { key: 'credited', label: 'put a credit on the account', pattern: /i(?:'?ve| have) (?:credited|refunded)|credit(?:ed)? (?:that|it|the charge)|refund(?:ed)? (?:that|it)/i },
        { key: 'arrangement', label: 'set up a payment arrangement', pattern: /payment (?:arrangement|plan|extension)|extend(?:ed)? (?:your|the) due date|budget billing/i },
        { key: 'setUpService', label: 'got the service set up', pattern: /service is (?:set|created|started)|got you set up|set up your service|start date/i },
        { key: 'changedPlan', label: 'changed the plan', pattern: /changed your plan|switched you to|applied .{0,25}plan/i },
        { key: 'submitted', label: 'submitted a request', pattern: /i(?:'?ve| have) submitted|put in a request|open(?:ed)? a case|case number|sent (?:it|that) (?:over|through)/i },
        { key: 'scheduled', label: 'booked an appointment', pattern: /scheduled for|appointment (?:on|for)|technician will/i },
        { key: 'educated', label: 'showed them how to do it themselves next time', pattern: /on the (?:app|website|portal)|online you can|once you are registered|for future reference/i },
        { key: 'transferred', label: 'passed the call to another team', pattern: /transfer(?:ring)? you|let me transfer|get you (?:over )?to (?:the|another)/i }
    ];

    const RESOLVED = /you'?re all set|all set on our end|that'?s (?:all )?(?:taken care of|done|set up)|i(?:'?ve| have) (?:credited|refunded|updated|submitted|processed)|your (?:order|account|service) is (?:set|created|started)/i;
    const LEFT_OPEN = /i'?ll (?:have to )?call you back|someone will (?:call|reach out)|i can'?t (?:help|do) (?:you|that)|you'?ll have to call|nothing (?:more )?i can do/i;
    const ESCALATED = /(?:speak|talk) (?:to|with) (?:a|your) (?:supervisor|manager)|get me a (?:supervisor|manager)|escalate this/i;
    const APPRECIATION = /(?:very|really|so) helpful|you'?ve been (?:so |really |very )?(?:helpful|great|wonderful|amazing)|i (?:really )?appreciate (?:you|your|it|that)|you'?re the best/i;

    /* ── Helpers ── */

    function clip(value) {
        const text = String(value || '').replace(/\s+/g, ' ').trim().replace(/^["']+|["']+$/g, '');
        if (text.length <= MAX_QUOTE_CHARS) return text;
        const cut = text.slice(0, MAX_QUOTE_CHARS);
        const lastSpace = cut.lastIndexOf(' ');
        return `${(lastSpace > 50 ? cut.slice(0, lastSpace) : cut).trim()}...`;
    }

    function joinList(items) {
        const values = (items || []).filter(Boolean);
        if (!values.length) return '';
        if (values.length === 1) return values[0];
        if (values.length === 2) return `${values[0]} and ${values[1]}`;
        return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
    }

    function minutesLabel(durationLabel) {
        const parts = String(durationLabel || '').split(':').map(Number);
        if (parts.length !== 2 || parts.some(Number.isNaN)) return '';
        const minutes = parts[0] + (parts[1] >= 30 ? 1 : 0);
        if (!minutes) return 'under a minute';
        return `${minutes} minute`;
    }

    // "an 18 minute call", "a 5 minute call". Eight, eleven, eighteen and the
    // eighties are the numbers that start with a vowel sound when read aloud,
    // and a recap that says "a 18 minute call" reads as machine output.
    function articleFor(phrase) {
        const text = String(phrase || '').trim();
        if (!text) return 'A';
        const number = text.match(/^(\d+)/);
        if (number) {
            const value = Number(number[1]);
            const vowelSounding = value === 8 || value === 11 || value === 18
                || (value >= 80 && value <= 89);
            return vowelSounding ? 'An' : 'A';
        }
        return /^[aeiou]/i.test(text) ? 'An' : 'A';
    }

    /**
     * What the call was about, which is not the same as what it touched on.
     *
     * Verint's categories were tried first and got this wrong. On the sample
     * export they fire on Bill Inquiries, High Bill, Payment Options, Rate
     * Migration and Service Plans all at once, so the recap opened "about a
     * higher than expected bill" for a call whose first line was "I just have
     * the address of the new apartment". Those categories are every subject
     * raised on the call, not the reason for it.
     *
     * The reason is why the customer rang, so it comes from what they said
     * first. The categories stay as the fallback for a call whose opening
     * matches nothing known.
     */
    function findTopic(meta, customerText, openingTurns) {
        const opening = (openingTurns || []).join('\n');
        const fromOpening = KEYWORD_TOPICS.find(rule => rule.pattern.test(opening));
        if (fromOpening) return fromOpening.topic;

        const named = (meta?.categories || []).filter(item => item.count > 0);
        for (const rule of CATEGORY_TOPICS) {
            if (named.some(item => rule.match.test(item.name))) return rule.topic;
        }

        const anywhere = KEYWORD_TOPICS.find(rule => rule.pattern.test(customerText));
        return anywhere ? anywhere.topic : '';
    }

    // The customer's first real turns. "hello" and "yes" are not why they
    // called, so anything under six words is skipped.
    function openingCustomerTurns(turns, count) {
        return turns
            .filter(turn => turn.role === 'customer'
                && String(turn.text || '').split(' ').filter(Boolean).length >= 6)
            .slice(0, count || 3)
            .map(turn => turn.text);
    }

    // How an advisor opens or asks, used to keep the structural guess below
    // from mistaking their line for the customer's.
    const AGENT_OPENING = /thank you (?:so much )?for (?:being|calling|choosing)|my name is|how m(?:ay|ight) i help|how can i help|(?:can|may|could) i (?:please )?(?:get|have|go ahead)|i'?ll need|allow me one moment/i;

    /**
     * The reason for the call, taken from the opening of it.
     *
     * Attribution is the problem here. On an unlabelled Verint export the
     * parser assumes a long turn after the advisor is also the advisor, so the
     * customer's opening statement, which is nearly always long, lands on the
     * wrong side. The real call began "i got an apartment i sign lease today"
     * and that went down as the advisor's, leaving the recap with no subject
     * at all.
     *
     * Reading the first few turns regardless of who the parser thinks said
     * them fixes it safely, because these patterns are things only a customer
     * says. An advisor's greeting does not contain "I got an apartment" or "my
     * bill went up", so widening the search cannot invent a subject; it can
     * only find one that was already there.
     */
    function findTopicSource(turns, labeled) {
        if (labeled) {
            return turns.filter(turn => turn.role === 'customer').map(turn => turn.text);
        }
        return turns.slice(0, 8).map(turn => turn.text);
    }

    /**
     * The line the customer opened with, quoted only when it is certainly
     * theirs.
     *
     * A Verint export has no speaker labels, so sides are inferred from the
     * flow of the call, and the inference is wrong often enough to matter. It
     * put "yeah i'll need the full address" in the customer's mouth on a real
     * call, which is the advisor asking for it, and the recap then quoted the
     * associate's own line back to her as the customer's.
     *
     * On an unlabelled transcript only a cued turn is used, meaning one that
     * matched a phrase nobody but a customer says. Nothing is quoted otherwise:
     * a recap missing one sentence is a small loss, and a recap that puts words
     * in the wrong person's mouth costs the whole message its credibility.
     */
    function findOpeningAsk(turns, labeled) {
        const longEnough = (turn) => String(turn.text || '').split(' ').filter(Boolean).length >= 6;

        const certain = turns.filter(turn => turn.role === 'customer' && (labeled || turn.cued) && longEnough(turn));
        if (certain.length) return clip(certain[0].text);
        if (labeled) return '';

        // Nothing was cued, so fall back on the one thing about an unlabelled
        // call that is structurally reliable: it opens with the advisor, and
        // the substantive turn after that greeting is the customer saying why
        // they rang. Guarded against the advisor still holding the floor,
        // which is the only way this goes wrong.
        const substantive = turns.filter(longEnough);
        const second = substantive[1];
        if (second && !AGENT_OPENING.test(second.text)) return clip(second.text);
        return '';
    }

    function findActions(turns) {
        const agentTurns = turns.filter(turn => turn.role !== 'customer');
        return AGENT_ACTIONS
            .map(action => {
                const index = agentTurns.findIndex(turn => action.pattern.test(turn.text));
                return index < 0 ? null : { ...action, at: index };
            })
            .filter(Boolean)
            .sort((a, b) => a.at - b.at);
    }

    function describeSilence(gaps) {
        const list = Array.isArray(gaps) ? gaps : [];
        const holds = list.filter(gap => gap.announced);
        const deadAir = list.filter(gap => !gap.announced);
        const longest = (items) => items.reduce((best, item) => (!best || item.silence > best.silence) ? item : best, null);

        return {
            holdCount: holds.length,
            longestHold: longest(holds),
            deadAirCount: deadAir.length,
            longestDeadAir: longest(deadAir)
        };
    }

    function formatDuration(totalSeconds) {
        const seconds = Math.max(0, Math.round(totalSeconds || 0));
        const minutes = Math.floor(seconds / 60);
        if (!minutes) return `${seconds} seconds`;
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }

    /**
     * Reads a transcript and returns the facts a recap is built from.
     *
     * Takes the analysis it was already given where there is one, so a caller
     * that has analyzed the call does not pay for it twice.
     */
    function summarizeCall(rawText, options = {}) {
        const analyzer = window.DevCoachModules?.callTranscript;
        const transcript = String(rawText || '').trim();
        if (!transcript || !analyzer?.parseTranscript) {
            return { ok: false, reason: transcript ? 'parser-unavailable' : 'empty' };
        }

        const analysis = options.analysis
            || analyzer.analyzeTranscript(transcript, { associateName: options.associateName });
        const parsed = analyzer.parseTranscript(transcript, { associateName: options.associateName });
        const meta = analysis?.meta || analyzer.extractMetadata(transcript);
        const { turns } = parsed;

        const customerText = turns.filter(turn => turn.role === 'customer').map(turn => turn.text).join('\n');
        const agentText = turns.filter(turn => turn.role !== 'customer').map(turn => turn.text).join('\n');

        const appreciation = turns
            .filter(turn => turn.role === 'customer' && APPRECIATION.test(turn.text))
            .map(turn => clip(turn.text))[0] || '';

        return {
            ok: true,
            attribution: parsed.labeled ? 'labeled' : 'inferred',
            moment: analyzer.formatCallMoment
                ? analyzer.formatCallMoment(options.callDate || meta.callDate, options.callTime || meta.callTime)
                : '',
            durationLabel: meta.durationLabel || '',
            lengthPhrase: minutesLabel(meta.durationLabel),
            topic: findTopic(meta, customerText, findTopicSource(turns, parsed.labeled)),
            openingAsk: findOpeningAsk(turns, parsed.labeled),
            actions: findActions(turns),
            silence: describeSilence(analysis?.silenceGaps),
            resolved: RESOLVED.test(agentText),
            leftOpen: LEFT_OPEN.test(agentText),
            escalated: ESCALATED.test(customerText),
            appreciation,
            turns: turns.length
        };
    }

    /* ── Saying it ── */

    // Two voices, because the same recap is read by two people: the associate
    // it is about, and the supervisor reviewing the log. they/them for the
    // supervisor view, since the roster is people whose pronouns this app has
    // never been told.
    function voiceOf(options) {
        const supervisor = options && options.voice === 'supervisor';
        return supervisor
            ? { subject: 'They', possessive: 'their', object: 'them', were: 'were', said: 'they said' }
            : { subject: 'You', possessive: 'your', object: 'you', were: 'were', said: 'you said' };
    }

    /**
     * The recap, as two or three short sentences.
     *
     * Each sentence is dropped entirely when its facts are missing, which is
     * why this is assembled rather than templated: a call with no Verint header
     * and no detectable topic still produces a sensible paragraph instead of
     * one with holes in it.
     */
    function buildSummaryText(summary, options = {}) {
        if (!summary?.ok) return '';
        const voice = voiceOf(options);
        const lower = voice.subject.toLowerCase();
        const sentences = [];

        const lengthBit = summary.lengthPhrase ? `${summary.lengthPhrase} call` : 'call';
        const topicBit = summary.topic ? ` about ${summary.topic}` : '';
        const momentBit = summary.moment ? `, taken ${summary.moment}` : '';
        sentences.push(`${articleFor(lengthBit)} ${lengthBit}${topicBit}${momentBit}.`);

        if (summary.openingAsk) {
            sentences.push(`The customer opened with: "${summary.openingAsk}".`);
        }

        if (summary.actions.length) {
            const labels = summary.actions.slice(0, 4).map(action => action.label);
            sentences.push(`${voice.subject} ${joinList(labels)}.`);
        }

        // Skipped when the caller is about to coach the same silence in detail.
        // "There was one hold, the longest about 2 minutes" followed by "Long
        // hold: about 2m 21s starting at 4:30" is one fact stated twice, which
        // is exactly what makes a short message read as generated.
        const silence = options.omitSilence
            ? { holdCount: 0, deadAirCount: 0, longestHold: null, longestDeadAir: null }
            : summary.silence;
        if (silence.longestHold) {
            sentences.push(`There ${silence.holdCount === 1 ? 'was one hold' : `were ${silence.holdCount} holds`}, the longest about ${formatDuration(silence.longestHold.silence)}.`);
        }
        if (silence.longestDeadAir) {
            // Phrased around the stretch rather than the count, because the
            // duration quoted is the longest gap and "there were about 1
            // minute of quiet" was the result of agreeing with the wrong noun.
            const more = silence.deadAirCount > 1 ? `, the longest` : '';
            sentences.push(`There was also a stretch of quiet with no hold announced${more} about ${formatDuration(silence.longestDeadAir.silence)}.`);
        }

        if (summary.escalated) {
            sentences.push(`The customer asked for a supervisor during the call.`);
        }

        if (summary.resolved && !summary.leftOpen) {
            sentences.push(`It ended sorted.`);
        } else if (summary.leftOpen) {
            sentences.push(`It ended with something still outstanding.`);
        }

        if (summary.appreciation) {
            sentences.push(`The customer said so before hanging up: "${summary.appreciation}".`);
        }

        // Supervisor only. How the transcript was parsed is a reason to check a
        // quote before sending it, which is the supervisor's job. Telling the
        // associate their recap might have misattributed a line undermines the
        // whole message and gives them nothing to act on.
        const caveat = (summary.attribution === 'inferred' && options.voice === 'supervisor')
            ? ` (Speaker labels were not in the transcript, so sides were worked out from the flow of the call.)`
            : '';

        return `${sentences.join(' ')}${caveat}`.replace(/\s+/g, ' ').trim();
    }

    /**
     * A few words that place the call: "39 minute call".
     *
     * For a message to the associate, which needs to identify the call and
     * nothing more. The full recap is for whoever was not on it.
     */
    function buildCallLabel(summary) {
        if (!summary?.ok || !summary.lengthPhrase) return 'call';
        return `${summary.lengthPhrase} call`;
    }

    function buildSummaryHtml(summary, escapeHtml, options = {}) {
        const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        const text = buildSummaryText(summary, options);
        if (!text) return '';
        return `<div class="call-trend-group call-summary-block">
            <div class="call-trend-title">What happened on the call</div>
            <div>${safe(text)}</div>
        </div>`;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callSummary = {
        summarizeCall,
        buildCallLabel,
        buildSummaryText,
        buildSummaryHtml,
        CATEGORY_TOPICS,
        KEYWORD_TOPICS,
        AGENT_ACTIONS
    };
})();
