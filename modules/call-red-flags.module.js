(function() {
    'use strict';

    /**
     * The other things on a call a supervisor needs to see without looking.
     *
     * Verification has its own read (call-verification), because it is the
     * one with a real sequence to it. These are the rest: things that are
     * either serious enough to act on or easy to miss on a long call, each one
     * quoted with the time to listen at.
     *
     *   supervisor   the customer asked for one and nothing after it got one
     *                on the line or booked a callback
     *   promise      the associate guaranteed an outcome that is not theirs
     *                to guarantee
     *   blame        "calm down", "you should have called sooner"
     *   safety       sparks, a line down, a burning smell, and whether the
     *                call turned to it
     *   medical      medical equipment mentioned on a call about a shut off
     *   complaint    the customer mentioned a regulator, a lawyer or the news
     *
     * Only three of these are ever coached, because only three are the
     * associate's to change: a promise, a blame line, and a safety hazard the
     * call never turned to. The rest are context for the supervisor, in the
     * same way an audio problem on the QA form is never put to her.
     *
     * Every pattern is narrow on purpose. A flag that fires on ordinary
     * phrasing teaches everybody to scroll past the box, and then the one
     * that matters gets scrolled past too.
     */

    const MAX_QUOTE_CHARS = 150;

    const LEVEL_ORDER = { red: 0, warn: 1, info: 2 };

    /* ── Patterns ── */

    const SUPERVISOR_ASK = /\b(?:speak|talk) (?:to|with) (?:a|your|the|my) (?:supervisor|manager|team lead|lead)\b|\bget (?:me )?(?:a|your) (?:supervisor|manager)\b|\bescalate (?:this|it|my)\b|\bi want (?:a|your) (?:supervisor|manager)\b/i;
    // Anything the associate said after that moves it towards a supervisor.
    // A promise of a callback counts: it is a real answer to the request.
    const SUPERVISOR_HANDOFF = /\b(?:get|grab|bring|find|transfer you to|connect you (?:to|with)|put you through to|reach out to|check with|have) (?:a |my |the |our )?(?:supervisor|manager|team lead|lead)\b|\b(?:supervisor|manager|lead) (?:will|can|is going to|would) (?:call|reach|get back|speak|be (?:right )?with)\b|\b(?:call ?back|callback) from (?:a|my|the) (?:supervisor|manager|lead)\b|\b(?:supervisor|manager)(?: is| are)? (?:not )?available\b/i;

    // A guarantee about how it will turn out. Negated forms ("i can't
    // promise") are the right thing to say, and conditional ones ("as long as
    // the payment posts you won't be disconnected") are accurate, so both are
    // excluded.
    const PROMISE = /\bi (?:can |will )?(?:guarantee|promise)\b|\bguaranteed?\b|\byou (?:will not|won'?t) (?:be|get) (?:disconnected|shut off|cut off|charged)\b|\byour (?:power|service|lights) (?:will not|won'?t) (?:be|get) (?:disconnected|shut off|cut off|turned off)\b|\byour (?:next )?bill (?:will|is going to|'?ll) (?:definitely |for sure )?(?:be|go) (?:lower|down|less|cheaper)\b|\bthat (?:will|'?ll) (?:definitely|for sure) (?:save|lower|fix)\b/i;
    const NOT_A_PROMISE = /\b(?:can'?t|cannot|can not|not able to|won'?t|don'?t|do not|no way to|unable to) (?:\w+ )?(?:guarantee|promise)\b|\bnot guaranteed\b|\bno guarantee\b|\bas long as\b|\bprovided (?:that|you)\b|\bif (?:you|the|your|it|that)\b|\bonce (?:you|the|your|it)\b/i;

    // Lines that put the problem on the customer.
    const BLAME = /\bcalm down\b|\b(?:that'?s|it'?s|this is) not my (?:problem|fault|job|issue)\b|\byou should(?:'?ve| have) (?:called|paid|read|known|looked|checked|asked)\b|\byou need to (?:listen|calm down|understand)\b|\byou(?:'re| are) not listening\b|\bi don'?t know what (?:else )?to tell you\b|\bthat'?s on you\b|\byou(?:'re| are) the one who\b/i;

    // Hazards. "Shock" is not here: "I was shocked at my bill" is on every
    // other high bill call.
    const HAZARD = /\bsmell(?:s|ing|ed)? (?:gas|smoke|something burning|burning)\b|\bburning smell\b|\bspark(?:s|ing|ed)?\b|\b(?:power )?lines? (?:is |are |went |came )?down\b|\bdowned (?:power )?lines?\b|\bwires? (?:is |are )?(?:down|hanging|on the ground|sparking|smoking)\b|\bon fire\b|\bcaught fire\b|\b(?:meter|panel|outlet|box|transformer) (?:is |was )?(?:smoking|melting|melted|buzzing|burning|on fire)\b|\belectrocut/i;
    // The call turning to the hazard.
    const EMERGENCY_STEPS = /\b911\b|\bnine one one\b|\bleave the (?:house|home|area|property)\b|\bstay (?:away|clear|back) from\b|\bdon'?t (?:touch|go near)\b|\bemergency\b|\bsend (?:a |someone|somebody|a crew|out a|the crew)\b|\bcrew\b|\bdispatch/i;

    const MEDICAL = /\boxygen\b|\bmedical (?:equipment|device|machine|condition|certificate|need|care)\b|\blife support\b|\bdialysis\b|\bventilator\b|\bc ?pap\b|\bnebuli[sz]er\b|\bfeeding pump\b|\binsulin\b|\bhospice\b/i;
    const SHUT_OFF_CALL = /\bdisconnect(?:ed|ion)?\b|\bshut ?off\b|\bcut off\b|\bpast due\b|\bturn(?:ed)? off\b/i;

    const COMPLAINT = /\bcorporation commission\b|\b(?:the )?a ?c ?c\b|\b(?:file|filing|make|put in) (?:a |an )?(?:formal )?complaint\b|\bbetter business bureau\b|\bb ?b ?b\b|\blawyer\b|\b(?<!power of )attorney\b|\b(?:going to|gonna|will|i'?ll) sue\b|\bsue (?:you|aps|a p s|the company)\b|\blawsuit\b|\b(?:call|contact|go to|tell) the news\b|\bnews (?:station|channel)\b/i;

    /* ── Helpers ── */

    function collapse(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function clip(value) {
        const text = collapse(value);
        if (text.length <= MAX_QUOTE_CHARS) return text;
        const cut = text.slice(0, MAX_QUOTE_CHARS);
        const lastSpace = cut.lastIndexOf(' ');
        return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trim()}...`;
    }

    function clock(seconds) {
        if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
        const whole = Math.max(0, Math.round(seconds));
        return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
    }

    function matchedWords(pattern, text) {
        const match = collapse(text).match(pattern);
        return match ? match[0] : '';
    }

    function isCustomer(turn) {
        return turn && turn.role === 'customer';
    }

    // An associate's line, as far as the parse can tell. On an unlabelled
    // call an inferred customer turn is still the customer; only the two
    // sides the parse settled on are trusted.
    function isAgent(turn) {
        return turn && turn.role !== 'customer';
    }

    function flag(key, level, turn, fields) {
        return Object.assign({
            key,
            level,
            time: clock(turn?.at),
            quote: turn ? clip(turn.text) : ''
        }, fields);
    }

    /* ── Reading the call ── */

    function readSupervisor(turns) {
        const askIndex = turns.findIndex(turn => isCustomer(turn) && SUPERVISOR_ASK.test(turn.text));
        if (askIndex < 0) return null;
        const answered = turns.slice(askIndex + 1).some(turn => isAgent(turn) && SUPERVISOR_HANDOFF.test(turn.text));
        if (answered) return null;
        const ask = turns[askIndex];
        return flag('supervisor', 'warn', ask, {
            title: 'Asked for a supervisor, and nothing after it got one',
            detail: `The customer asked${ask.at != null ? ` at ${clock(ask.at)}` : ''}. Nothing said after it puts a supervisor on the line or books a callback from one.`
        });
    }

    function readPromise(turns) {
        const turn = turns.find(item => isAgent(item) && PROMISE.test(item.text) && !NOT_A_PROMISE.test(item.text));
        if (!turn) return null;
        return flag('promise', 'warn', turn, {
            title: 'Promised how it would turn out',
            detail: `"${matchedWords(PROMISE, turn.text)}" is a guarantee the customer will hold us to, and the outcome is not in the associate's hands.`,
            coach: {
                key: 'promise',
                weight: 9,
                text: 'A promise about how the bill or the service will turn out is one the customer holds you to, even when it is out of your hands. Say what you have done and what normally happens next, without guaranteeing how it ends.'
            }
        });
    }

    function readBlame(turns) {
        const turn = turns.find(item => isAgent(item) && BLAME.test(item.text));
        if (!turn) return null;
        return flag('blame', 'warn', turn, {
            title: 'A line that puts it on the customer',
            detail: `"${matchedWords(BLAME, turn.text)}" lands as blame, however it was meant.`,
            coach: {
                key: 'blame',
                weight: 10,
                text: 'That line lands as blame on the customer, however it was meant. Say what they are dealing with, then move straight to what you can do.'
            }
        });
    }

    function readSafety(turns, labeled) {
        // The customer's side, or on an unlabelled call any line that is not
        // the associate giving the safety advice itself, which mentions the
        // same hazards.
        const index = turns.findIndex(turn => (labeled ? isCustomer(turn) : !(turn.cued && !isCustomer(turn)))
            && HAZARD.test(turn.text)
            && !EMERGENCY_STEPS.test(turn.text));
        if (index < 0) return null;

        const hazard = turns[index];
        const response = turns.slice(index + 1).find(turn => isAgent(turn) && EMERGENCY_STEPS.test(turn.text));
        const what = matchedWords(HAZARD, hazard.text);

        if (response) {
            return flag('safety', 'info', hazard, {
                title: 'A safety hazard came up, and the call turned to it',
                detail: `The customer mentioned "${what}". Emergency steps were heard${response.at != null ? ` at ${clock(response.at)}` : ''}: "${clip(response.text)}"`
            });
        }

        return flag('safety', 'red', hazard, {
            title: 'A safety hazard came up, and no emergency steps were heard',
            detail: `The customer mentioned "${what}". Nothing after it gets them clear of it or reports it as an emergency.`,
            coach: {
                key: 'safety',
                weight: 18,
                severity: 'red',
                text: 'When a customer mentions sparks, a line down or a burning smell, it goes to the front of the call. Make sure they are clear of it and get it reported as an emergency before anything else.'
            }
        });
    }

    function readMedical(turns) {
        const allText = turns.map(turn => turn.text).join(' ');
        if (!SHUT_OFF_CALL.test(allText)) return null;
        const index = turns.findIndex(turn => isCustomer(turn) && MEDICAL.test(turn.text));
        if (index < 0) return null;
        const turn = turns[index];
        const pickedUp = turns.slice(index + 1).some(item => isAgent(item) && /\bmedical\b/i.test(item.text));
        return flag('medical', 'info', turn, {
            title: 'Medical need mentioned on a shut off call',
            detail: `The customer mentioned "${matchedWords(MEDICAL, turn.text)}".${pickedUp ? ' The associate came back to it.' : ' Nothing after it comes back to it.'} Worth a listen to hear how it was handled.`
        });
    }

    function readComplaint(turns) {
        const turn = turns.find(item => isCustomer(item) && COMPLAINT.test(item.text));
        if (!turn) return null;
        return flag('complaint', 'info', turn, {
            title: 'The customer talked about taking it further',
            detail: `They mentioned "${matchedWords(COMPLAINT, turn.text)}". Worth knowing before they call back.`
        });
    }

    /**
     * Every flag on one parsed call, worst first.
     */
    function readRedFlags(parsed) {
        const turns = Array.isArray(parsed?.turns) ? parsed.turns : [];
        if (!turns.length) return { ok: false, reason: 'empty', flags: [] };
        const labeled = Boolean(parsed.labeled);

        const flags = [
            readSafety(turns, labeled),
            readBlame(turns),
            readPromise(turns),
            readSupervisor(turns),
            readMedical(turns),
            readComplaint(turns)
        ].filter(Boolean).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

        return {
            ok: true,
            labeled,
            flags,
            red: flags.some(item => item.level === 'red')
        };
    }

    function readRedFlagsFromText(rawText, options = {}) {
        const analyzer = window.DevCoachModules?.callTranscript;
        if (!analyzer?.parseTranscript || !String(rawText || '').trim()) {
            return { ok: false, reason: 'empty', flags: [] };
        }
        return readRedFlags(analyzer.parseTranscript(rawText, options));
    }

    /**
     * The findings that are the associate's to change, as coaching items the
     * drafts can take straight in.
     */
    function coachingFor(read) {
        if (!read?.ok) return [];
        return read.flags
            .filter(item => item.coach)
            .map(item => Object.assign({ quote: item.quote }, item.coach));
    }

    /* ── Showing it ── */

    const ICONS = { red: '🚩', warn: '⚠️', info: 'ℹ️' };
    const CHECKED_FOR = 'a supervisor request left hanging, promises about the outcome, blame, safety hazards, medical needs on a shut off call and complaint threats';

    function buildAlertHtml(read, escapeHtml) {
        const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        if (!read?.ok) return '';

        if (!read.flags.length) {
            return `<div class="call-alert call-alert-ok">
                <strong>✅ Nothing else flagged.</strong> <span>${safe(`Checked for ${CHECKED_FOR}.`)}</span>
            </div>`;
        }

        const worst = read.flags[0].level;
        const box = worst === 'red' ? 'call-alert-red' : worst === 'warn' ? 'call-alert-warn' : '';
        const rows = read.flags.map(item => `<li>
                <strong>${ICONS[item.level]} ${safe(item.title)}</strong>
                ${item.time ? `<span class="call-alert-time"> at ${safe(item.time)}</span>` : ''}
                <div>${safe(item.detail)}</div>
                ${item.quote ? `<div class="call-alert-quote">"${safe(item.quote)}"</div>` : ''}
            </li>`).join('');
        const caveat = read.labeled
            ? ''
            : '<div class="call-alert-note">Speakers were worked out from the flow of the call, not from labels. Listen at the times shown before you act on it.</div>';

        return `<div class="call-alert ${box}"${worst === 'red' ? ' role="alert"' : ''}>
            <ul class="call-flag-list">${rows}</ul>
            ${caveat}
        </div>`;
    }

    function buildAlertText(read) {
        if (!read?.ok || !read.flags.length) return '';
        const lines = ['Also flagged:'];
        read.flags.forEach(item => {
            lines.push(`- ${item.time ? `${item.time} ` : ''}${item.title}. ${item.detail}${item.quote ? ` ("${item.quote}")` : ''}`);
        });
        return lines.join('\n');
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callRedFlags = {
        readRedFlags,
        readRedFlagsFromText,
        coachingFor,
        buildAlertHtml,
        buildAlertText,
        // Exported for the tests, which pin what each one does and does not
        // fire on.
        PROMISE,
        NOT_A_PROMISE,
        BLAME,
        HAZARD,
        COMPLAINT,
        SUPERVISOR_ASK,
        SUPERVISOR_HANDOFF
    };
})();
