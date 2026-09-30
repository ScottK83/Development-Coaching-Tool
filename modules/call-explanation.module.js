(function() {
    'use strict';

    /**
     * Did the explanation land?
     *
     * A customer rings about budget billing, the associate explains it, and
     * the customer says "so wait, I still have to pay the whole thing?". Every
     * other read on the page is about what the associate said. This one is
     * about whether the customer understood it, which is the part that decides
     * whether they ring back next month.
     *
     * It works from the customer's side of the call, because that is where
     * the evidence is: a customer who is lost says so, in a small number of
     * ways ("I don't understand", "what does that mean", "wait, so"). Each of
     * those is a moment. For each moment it looks back at how the thing was
     * explained just before, forward at what was tried next, and further
     * forward for the customer saying it had landed ("oh okay, that makes
     * sense").
     *
     * It then names the topic the customer was lost on and offers ways to say
     * it that tend to land, from a small playbook per APS topic. The playbook
     * is about how to explain rather than what the policy is: where a fact
     * belongs in a line, it is left as a [placeholder] for the associate's own
     * numbers, because a script with a wrong number in it does more harm than
     * no script.
     *
     * Coaching reaches the associate only when the evidence is strong: the
     * customer was lost twice, or was lost after an explanation that leaned on
     * our own vocabulary or ran long, and never said it had landed. A single
     * "what do you mean" that the next line cleared up is not a coaching
     * point, it is a conversation.
     */

    const MAX_QUOTE_CHARS = 160;
    // Confusion this close to the last one is the same moment, not a new one.
    const EPISODE_GAP_TURNS = 6;
    // How far past the last confusion to look for the customer saying it
    // landed.
    const LANDED_WINDOW_TURNS = 6;
    // Agent turns read back from the confusion as "what they were lost on".
    const BEFORE_AGENT_TURNS = 3;
    // A customer "okay" or "mm hmm" in the middle of an explanation does not
    // end it.
    const BACKCHANNEL_WORDS = 4;
    // One unbroken stretch this long is a lot to hold on the phone.
    const LONG_EXPLANATION_WORDS = 90;

    /* ── The customer saying they are lost ──
     *
     * Deliberately not "can you say that again" or "repeat that": on a phone
     * line those are about hearing, not understanding. Nor "how does that
     * work", which is a customer asking to be told, not one who was told and
     * did not follow.
     */
    const CONFUSION = [
        /\bi (?:still |just |really )?(?:don'?t|do not|didn'?t|did not) (?:really |quite |fully |totally )?(?:understand|get (?:it|that|this|why|how|what)|follow)\b/i,
        /\bi(?:'?m| am) (?:so |still |a little |a bit |kind of |kinda |really |very |just |totally )?(?:confused|lost)\b/i,
        /\b(?:this|that|it)(?:'?s| is) (?:so |really |very |kind of |kinda )?confusing\b/i,
        /\bwhat (?:does|did) (?:that|this|it) mean\b/i,
        /\bwhat do you mean\b/i,
        /\b(?:that|this|it) (?:doesn'?t|does not|don'?t) make (?:any |much )?sense\b/i,
        /\bi(?:'?m| am) not (?:following|understanding|sure (?:i|what you) (?:understand|follow|get|mean))\b/i,
        /\bwait,? (?:so|what|how|why)\b|\bhold on,? (?:so|what|why)\b/i,
        /\b(?:explain|go over|break down|walk me through) (?:that|it|this)(?: part)? again\b|\b(?:can|could) you explain (?:that|it|this|what)\b/i,
        /\bso i (?:still|also) (?:have to|need to|owe)\b/i,
        /\bbut (?:why|how come) (?:is|does|did|would|am|do|was)\b/i,
        /\bi thought (?:it|that|this) (?:was|would|meant)\b|\bi thought i (?:was|had|paid|would|didn'?t)\b/i
    ];

    // The customer saying it went in. Checked after CONFUSION, so "I don't
    // understand" never reads as "I understand".
    const LANDED = /\b(?:that|it) makes (?:more |perfect |total |a lot more )?sense\b|\bmakes sense now\b|\boh,? (?:okay|ok|i see|got it)\b|\b(?:okay|ok),? i (?:see|get it|understand)\b|\bi (?:see|get it|understand) now\b|\bnow i (?:get|understand|see)\b|\bgot it\b|\bgotcha\b|\bthat explains\b|\bthat helps\b/i;

    // The associate checking it landed.
    const CHECKED = /\bdoes that make sense\b|\bmake sense\?|\bdoes that help\b|\bis that clear\b|\bany questions (?:on|about) that\b|\bdo you have any questions\b|\bdid that (?:answer|help)\b|\bhow does that sound\b/i;

    // Reaching for an example or a comparison rather than the definition.
    const EXAMPLE = /\bfor example\b|\bfor instance\b|\blet'?s say\b|\bsay (?:your|you)\b|\bso if (?:you|your)\b|\bthink of (?:it|this)\b|\b(?:it'?s |kind of |sort of |just )like (?:a|an|when|if|your)\b|\bimagine\b|\bin other words\b|\bsame (?:as|way) (?:a|an|your|when)\b/i;

    /* ── Our words, not theirs ──
     *
     * Terms that are everyday on our side of the desk and mean nothing to most
     * customers. A term the associate explained in the same breath ("on peak,
     * which is four to seven") is not counted: naming the thing and then
     * saying what it is, is exactly right.
     */
    const JARGON = [
        { term: 'kilowatt hours', pattern: /\bkilowatt ?hours?\b|\bk ?w ?h\b/i },
        { term: 'kilowatts', pattern: /\bkilowatts?\b(?! ?hours?)/i },
        { term: 'prorated', pattern: /\bpro ?rat(?:ed|e|ing)\b/i },
        { term: 'billing cycle', pattern: /\bbilling (?:cycle|period)\b/i },
        { term: 'true up', pattern: /\btrue ?up\b/i },
        { term: 'levelized', pattern: /\bleveli[sz]ed?\b/i },
        { term: 'deferred', pattern: /\bdeferr(?:ed|al)\b/i },
        { term: 'arrears', pattern: /\barrear(?:s|age)\b/i },
        { term: 'delinquent', pattern: /\bdelinquen(?:t|cy)\b/i },
        { term: 'tariff', pattern: /\btariffs?\b/i },
        { term: 'rate schedule', pattern: /\brate schedule\b/i },
        { term: 'demand charge', pattern: /\bdemand (?:charge|rate|component)\b/i },
        { term: 'on peak', pattern: /\b(?:super )?(?:on|off)(?: |-)?peak\b/i },
        { term: 'consumption', pattern: /\bconsumption\b/i },
        { term: 'reconciliation', pattern: /\breconcil(?:e|ed|iation|ing)\b/i },
        { term: 'variance', pattern: /\bvariance\b/i },
        { term: 'installments', pattern: /\binstall?ments?\b/i },
        { term: 'basic service charge', pattern: /\bbasic service charge\b|\bservice establishment\b/i }
    ];

    const EXPLAINED_NEARBY = /\b(?:which|that) (?:means|is when|is the|are the|is just)\b|\bmeaning\b|\bin other words\b|\bbasically\b|\bso that'?s\b|\bthat'?s (?:just |basically )?(?:the|when|what|how)\b|\bfrom \w+ (?:to|until|through) \w+\b|\bbetween \w+ and \w+\b/i;
    const EXPLAINED_WITHIN_CHARS = 80;

    /* ── What the customer was lost on ──
     *
     * `say` lines are written in the associate's voice, ready to say. `how`
     * is the technique behind them. `check` is the question that proves it
     * landed, in the customer's terms rather than "does that make sense",
     * which a lost customer answers yes to out of politeness.
     *
     * Facts that vary by account are [placeholders]. The playbook teaches the
     * shape of a good explanation; the numbers are the associate's.
     */
    const PLAYBOOKS = [
        {
            key: 'budgetBilling',
            label: 'budget billing',
            pattern: /\bbudget (?:bill|amount|plan|payment)|\bleveli[sz]ed? (?:bill|pay)|\baverag(?:e|ed|ing) (?:out )?(?:your |the )?(?:bill|payment|usage)/i,
            say: [
                'Budget billing doesn\'t change what you use or what it costs. It takes your whole year and spreads it out, so the summer bills and the winter bills come out about the same each month.',
                'Your bills over the last year went from about [lowest amount] up to about [highest amount]. Budget billing evens that out to about [budget amount] a month.',
                'The number to pay each month is [budget amount]. That stays about the same even in the hot months.'
            ],
            how: [
                'Lead with what it does for them, the same amount every month, before how it is worked out.',
                'Use their own highest and lowest bills. A customer believes their own numbers faster than an explanation.',
                'Say what it is not: it is not a discount, so the year still costs the same in total.'
            ],
            check: 'ask what they would pay in August, when it is hottest. If they say the budget amount, it landed.'
        },
        {
            key: 'ratePlan',
            label: 'how the rate plan works',
            pattern: /\btime of use\b|\b(?:super )?(?:on|off)(?: |-)?peak\b|\bdemand (?:charge|plan|rate)\b|\bfixed energy charge\b|\brate plan\b|\bsaver choice\b|\bpeak hours\b|\bplan comparison\b/i,
            say: [
                'On peak just means the expensive hours. On your plan that is [the hours] on weekdays, and every other hour costs less.',
                'On a demand plan, part of the bill is set by your busiest single hour in the expensive window, like running the dryer, the oven and the air at the same time.',
                'You said you\'re home in the afternoons, so those hours matter more for you than for someone who is out all day.'
            ],
            how: [
                'Say every term as the hours or the appliance it refers to, in the same breath as the term.',
                'Talk about one plan first, the one that fits how they live, rather than reading them all out.',
                'Tie it to something they already told you about their day.'
            ],
            check: 'ask which hours they would move the laundry or the dishwasher to.'
        },
        {
            key: 'paymentArrangement',
            label: 'the payment arrangement',
            pattern: /\bpayment (?:arrangement|extension|plan)\b|\bextension\b|\barrangement\b|\bpast due\b|\b(?:disconnect(?:ion)?|shut ?off) (?:notice|date)\b|\binstall?ments?\b|\bcatch (?:up|you up)\b/i,
            say: [
                'There are two parts: [past due amount] that is past due, and this month\'s bill of [amount]. The arrangement is only about the past due part.',
                'What you need to pay is [amount] by [date]. The next one after that is [amount] by [date].'
            ],
            how: [
                'Split the money into what is past due and what is this month\'s bill, and say them separately.',
                'Give dates as dates, "Friday the 12th", not "in ten days" or "by your next due date".',
                'Finish on just the dates and amounts they need, nothing else.'
            ],
            check: 'ask them to tell you the next date and the amount due on it.'
        },
        {
            key: 'deposit',
            label: 'the deposit',
            pattern: /\bdeposit\b/i,
            say: [
                'The deposit is money we hold on the account. It isn\'t a fee, and you get it back.',
                'It\'s [amount], and it\'s due [today, or on your first bill].',
                'You get it back as money off your bill after [time frame].'
            ],
            how: [
                'Say what it is, and that they get it back, before you say the amount.',
                'Say when it is due in one short sentence.',
                'Skip "applied to your account as a credit". "Money off your bill" says the same thing.'
            ],
            check: 'ask them when they expect to see the deposit on a bill.'
        },
        {
            key: 'highBill',
            label: 'why the bill went up',
            pattern: /\bhigh(?:er)? bill\b|\bbill (?:is|went|was) (?:so |really )?(?:high|up)\b|\bbill (?:doubled|jumped)\b|\bwhy is my bill\b|\bhigher than (?:usual|normal|last)\b|\busage (?:went|is|was) up\b|\bused more\b/i,
            say: [
                'Most of the jump is [the main reason]. That stretch landed on this bill.',
                'You used about [amount] more than the same month last year, and that is most of the difference.',
                'This bill covered [number] days and last month\'s covered [number], so part of it is simply a longer bill.'
            ],
            how: [
                'Give the one reason that drove most of it first. A list of five small reasons sounds like an excuse.',
                'Compare them to themselves, last month or the same month last year, not to the rate.',
                'Say days as days. "Billing cycle" means nothing to most customers.',
                'End with one or two things they can actually do, not a list.'
            ],
            check: 'ask them what they think drove it up, in their own words.'
        },
        {
            key: 'meterRead',
            label: 'the meter reading',
            pattern: /\bestimat(?:ed|e) (?:read|bill|reading)\b|\bmeter read(?:ing)?\b|\bread the meter\b|\bactual read(?:ing)?\b|\bread date\b/i,
            say: [
                'We couldn\'t get a reading this month, so this bill used a best guess from your past usage. The next real reading corrects it either way.',
                'Your meter was read on [date], so this bill runs from [date] to [date], not the first to the end of the month.'
            ],
            how: [
                'Say read dates as dates.',
                'Say what happens on the next bill, since that is what they are worried about.'
            ],
            check: 'ask them what they expect to happen on the next bill.'
        },
        {
            key: 'firstBill',
            label: 'the first bill',
            pattern: /\bfirst bill\b|\bpro ?rat(?:ed|e|ing)\b|\bpartial (?:month|bill)\b/i,
            say: [
                'Your first bill only covers the days since your service started, so it won\'t look like a normal month.',
                'On top of the usage, the first bill will also have [anything extra, like the deposit], so it will be higher than the ones after it.'
            ],
            how: [
                'Say it as days, not "prorated".',
                'Name anything extra that lands on the first bill one item at a time.'
            ],
            check: 'ask them what they expect the first bill to include.'
        },
        {
            key: 'autopay',
            label: 'autopay',
            pattern: /\bauto ?pay\b|\bautomatic (?:payment|draft)\b|\bbank draft\b/i,
            say: [
                'Once it\'s on, the bill amount comes out of your account on [day] each month.',
                'For this month, [what they need to do this month, if anything], because it takes [time] to switch on.'
            ],
            how: [
                'Say when money leaves their account as a day.',
                'Say plainly whether they still need to pay this month\'s bill themselves.'
            ],
            check: 'ask them whether they need to pay this month\'s bill themselves.'
        },
        {
            key: 'assistance',
            label: 'the assistance program',
            pattern: /\b(?:energy |bill |crisis )?assistance\b|\bcrisis\b|\benergy support\b|\bdiscount program\b|\blimited income\b|\blow income\b|\bliheap\b/i,
            say: [
                'This program takes [amount or percentage] off your bill each month.',
                'The one thing to do next is [the next step], and it goes to [who].'
            ],
            how: [
                'Lead with what it does for them, before who qualifies.',
                'Give one next step, not the whole process.'
            ],
            check: 'ask them what they will do first after the call.'
        }
    ];

    const GENERAL = {
        key: 'general',
        label: 'what was being explained',
        say: [],
        how: [
            'Say it in one or two short sentences, then stop and let them react.',
            'Use their own numbers and dates instead of the words on the screen.',
            'If it does not land, do not repeat it word for word. Try an example or a comparison.'
        ],
        check: 'ask them to tell it back to you in their own words.'
    };

    /* ── Helpers ── */

    function collapse(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function clip(value, max) {
        const limit = max || MAX_QUOTE_CHARS;
        const text = collapse(value).replace(/^["']+|["']+$/g, '');
        if (text.length <= limit) return text;
        const cut = text.slice(0, limit);
        const lastSpace = cut.lastIndexOf(' ');
        return `${(lastSpace > limit * 0.5 ? cut.slice(0, lastSpace) : cut).trim()}...`;
    }

    function words(text) {
        const clean = collapse(text);
        return clean ? clean.split(' ').length : 0;
    }

    function clock(seconds) {
        if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
        const whole = Math.max(0, Math.round(seconds));
        return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
    }

    function joinList(items) {
        const values = (items || []).filter(Boolean);
        if (values.length <= 1) return values[0] || '';
        if (values.length === 2) return `${values[0]} and ${values[1]}`;
        return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
    }

    function isConfused(text) {
        return CONFUSION.some(pattern => pattern.test(text));
    }

    function isLanded(text) {
        return !isConfused(text) && LANDED.test(text);
    }

    const STOP_WORDS = new Set(['that', 'this', 'with', 'your', 'have', 'they', 'will', 'what', 'just',
        'from', 'then', 'there', 'their', 'would', 'about', 'which', 'when', 'were', 'been', 'yeah',
        'okay', 'like', 'into', 'more', 'some', 'them', 'than', 'also', 'going', 'gonna', 'because',
        'right', 'well', 'know', 'said', 'does', 'it\'s', 'that\'s', 'you\'re', 'here', 'only']);

    function contentWords(text) {
        return new Set(collapse(text).toLowerCase().split(/[^a-z']+/)
            .filter(word => word.length >= 4 && !STOP_WORDS.has(word)));
    }

    // How much of the second try reused the first one's words. High means the
    // same explanation again, which rarely lands the second time either.
    function overlap(first, second) {
        const a = contentWords(first);
        const b = contentWords(second);
        if (a.size < 4 || b.size < 4) return 0;
        let shared = 0;
        b.forEach(word => { if (a.has(word)) shared += 1; });
        return shared / Math.min(a.size, b.size);
    }

    const SAME_WORDS_OVERLAP = 0.6;
    const SAME_WORDS_MIN_WORDS = 12;

    /**
     * Our words that went unexplained, in the order they were said.
     */
    function unexplainedJargon(text) {
        const found = [];
        const source = collapse(text);
        JARGON.forEach(item => {
            const global = new RegExp(item.pattern.source, 'gi');
            let match;
            let explained = false;
            let seen = false;
            while ((match = global.exec(source))) {
                seen = true;
                const after = source.slice(match.index + match[0].length, match.index + match[0].length + EXPLAINED_WITHIN_CHARS);
                if (EXPLAINED_NEARBY.test(after)) { explained = true; break; }
            }
            if (seen && !explained && !found.includes(item.term)) found.push(item.term);
        });
        return found;
    }

    function playbookFor(key) {
        return PLAYBOOKS.find(item => item.key === key) || GENERAL;
    }

    // The topic with the most mentions in a stretch of text. Ties go to the
    // earlier playbook, which is ordered from most to least specific.
    function topicOf(text) {
        let best = null;
        let bestCount = 0;
        PLAYBOOKS.forEach(item => {
            const count = (collapse(text).match(new RegExp(item.pattern.source, 'gi')) || []).length;
            if (count > bestCount) { best = item; bestCount = count; }
        });
        return best;
    }

    /* ── Reading the call ── */

    function isCustomer(turn) {
        return turn && turn.role === 'customer';
    }

    // An associate turn that invites or asks rather than explains: the
    // greeting, "so what is your question", "can I have the last four". A
    // customer who says "wait, what" after one of those is not lost on an
    // explanation, because there was not one.
    const NOT_EXPLAINING = /thank(?:s| you)(?: so much)? for (?:calling|being|choosing)|my name is|how (?:can|may|might) i (?:help|assist)|\bwhat(?:'s| is) your question\b|\bwho do i have\b|\bwhat can i (?:do|help)\b|\b(?:can|could|may) i (?:please )?(?:have|get|grab|verify|confirm)\b|\bwhat(?:'s| is) (?:the|your) (?:address|name|phone|number|account|email|date of birth)\b/i;
    // A long turn that happens to end in a question is still an explanation.
    const SHORT_TURN_WORDS = 20;

    function explains(turn) {
        return !(NOT_EXPLAINING.test(turn.text) && words(turn.text) < SHORT_TURN_WORDS);
    }

    /**
     * The associate's explanation the customer was reacting to: the agent
     * turns straight before the confusion, reaching past a customer "okay"
     * but stopping at anything the customer actually said, and at a turn
     * that only asked or greeted.
     */
    function explanationBefore(turns, index) {
        const collected = [];
        for (let i = index - 1; i >= 0 && collected.length < BEFORE_AGENT_TURNS; i -= 1) {
            const turn = turns[i];
            if (isCustomer(turn)) {
                if (words(turn.text) > BACKCHANNEL_WORDS) break;
                continue;
            }
            if (!explains(turn)) break;
            collected.unshift(i);
        }
        return collected;
    }

    // Enough of an explanation for a customer to be lost on.
    const EXPLAINING_WORDS = 8;

    /**
     * Groups the confusion turns into moments. A customer lost at 4:12 and
     * again at 4:40 is one moment with two tries, not two moments.
     *
     * A confusion only starts a moment when what came straight before it was
     * an explanation. "My budget billing changed and I don't get why" as the
     * opening line is the reason for the call, and so is "I thought it was
     * supposed to stay the same" after "so what is your question". Read as
     * reactions, both coached the associate for confusing a customer she had
     * not yet explained anything to. Once a moment is open, a second
     * confusion joins it whatever came before, since that is the customer
     * still lost.
     */
    function findEpisodes(turns) {
        const hits = [];
        turns.forEach((turn, index) => {
            if (!isCustomer(turn) || !isConfused(turn.text)) return;
            const previous = hits[hits.length - 1];
            const continuing = previous !== undefined && index - previous <= EPISODE_GAP_TURNS;
            const before = explanationBefore(turns, index).map(i => turns[i].text).join(' ');
            if (continuing || words(before) >= EXPLAINING_WORDS) hits.push(index);
        });

        const episodes = [];
        hits.forEach(index => {
            const last = episodes[episodes.length - 1];
            if (last && index - last.hits[last.hits.length - 1] <= EPISODE_GAP_TURNS) {
                last.hits.push(index);
            } else {
                episodes.push({ hits: [index] });
            }
        });
        return episodes;
    }

    function readEpisode(turns, episode, callTopic) {
        const first = episode.hits[0];
        const last = episode.hits[episode.hits.length - 1];

        const beforeIdx = explanationBefore(turns, first);
        const beforeText = beforeIdx.map(i => turns[i].text).join(' ');

        // Where it landed, if it did: the first customer turn after the last
        // confusion that says so.
        let landedAt = -1;
        for (let i = last + 1; i < turns.length && i <= last + LANDED_WINDOW_TURNS; i += 1) {
            if (isCustomer(turns[i]) && isLanded(turns[i].text)) { landedAt = i; break; }
            if (isCustomer(turns[i]) && isConfused(turns[i].text)) break;
        }

        // Everything the associate tried after the customer first said they
        // were lost, up to where it landed or the window ran out.
        const afterEnd = landedAt >= 0 ? landedAt : Math.min(turns.length, last + LANDED_WINDOW_TURNS + 1);
        const afterIdx = [];
        for (let i = first + 1; i < afterEnd; i += 1) {
            if (!isCustomer(turns[i])) afterIdx.push(i);
        }
        const afterText = afterIdx.map(i => turns[i].text).join(' ');

        // The first retry on its own: what the associate said between the
        // customer saying they were lost and the customer's next turn. Judged
        // apart from the rest, because "is there anything else" at the end of
        // the stretch is not a second explanation and dilutes the comparison.
        const retryIdx = [];
        for (let i = first + 1; i < afterEnd && !isCustomer(turns[i]); i += 1) retryIdx.push(i);
        const retryText = retryIdx.map(i => turns[i].text).join(' ');

        const topic = topicOf(`${beforeText} ${turns[first].text} ${afterText}`) || callTopic || null;
        const playbook = topic || GENERAL;

        const secondTryWords = words(afterText);
        const sameWords = words(retryText) >= SAME_WORDS_MIN_WORDS
            && overlap(beforeText, retryText) >= SAME_WORDS_OVERLAP;

        const excerptStart = beforeIdx.length ? beforeIdx[0] : Math.max(0, first - 1);
        const excerptEnd = landedAt >= 0 ? landedAt : Math.min(turns.length - 1, last + 2);

        return {
            index: first,
            time: clock(turns[first].at),
            topicKey: playbook.key,
            topicLabel: playbook.label,
            customerQuote: clip(turns[first].text),
            beforeQuote: clip(beforeText, 240),
            beforeTime: beforeIdx.length ? clock(turns[beforeIdx[0]].at) : '',
            beforeWords: words(beforeText),
            // The second attempt on its own. The whole stretch after runs into
            // whatever came next, a sign off or another subject, and quoting
            // that as "what was tried" misdescribes it.
            afterQuote: clip(retryText || afterText, 240),
            afterWords: secondTryWords,
            jargon: unexplainedJargon(`${beforeText} ${afterText}`),
            sameWords,
            usedExample: EXAMPLE.test(retryText || afterText),
            checked: CHECKED.test(afterText) || CHECKED.test(beforeText),
            tries: episode.hits.length,
            landed: landedAt >= 0,
            landedQuote: landedAt >= 0 ? clip(turns[landedAt].text) : '',
            landedTime: landedAt >= 0 ? clock(turns[landedAt].at) : '',
            excerpt: turns.slice(excerptStart, excerptEnd + 1).map(turn => ({
                who: isCustomer(turn) ? 'Customer' : 'Agent',
                text: collapse(turn.text)
            }))
        };
    }

    /**
     * Whether the moment is worth putting in front of the associate.
     *
     * Lost twice is always worth it. Lost once is worth it only when there is
     * something concrete to change about how it was said, and only when the
     * customer never said it had landed.
     */
    function isCoachable(moment) {
        if (!moment || moment.landed) return false;
        if (moment.tries >= 2) return true;
        return moment.jargon.length > 0 || moment.beforeWords >= LONG_EXPLANATION_WORDS || moment.sameWords;
    }

    /**
     * The explanation read of one parsed call.
     */
    function readExplanations(parsed) {
        const turns = Array.isArray(parsed?.turns) ? parsed.turns : [];
        if (!turns.length) return { ok: false, reason: 'empty', moments: [], explained: [] };

        const agentText = turns.filter(turn => !isCustomer(turn)).map(turn => turn.text).join(' ');
        const callTopic = topicOf(turns.map(turn => turn.text).join(' '));

        // What the associate explained at all, for the quiet line when the
        // customer never got lost. Listed so "never sounded lost" says what
        // it was about.
        const explained = PLAYBOOKS
            .filter(item => item.pattern.test(agentText))
            .map(item => item.label);

        const moments = findEpisodes(turns).map(episode => readEpisode(turns, episode, callTopic));

        return {
            ok: true,
            labeled: Boolean(parsed.labeled),
            explained,
            moments,
            lost: moments.filter(item => !item.landed),
            landed: moments.filter(item => item.landed),
            coachable: moments.filter(isCoachable)
        };
    }

    function readExplanationsFromText(rawText, options = {}) {
        const analyzer = window.DevCoachModules?.callTranscript;
        if (!analyzer?.parseTranscript || !String(rawText || '').trim()) {
            return { ok: false, reason: 'empty', moments: [], explained: [] };
        }
        return readExplanations(analyzer.parseTranscript(rawText, options));
    }

    /* ── Saying it to the associate ──
     *
     * Second person, plain, one thing to try. Follows the coaching voice
     * rules: no form vocabulary, no label in front, nothing that assumes one
     * call.
     */

    function tryLine(playbook) {
        const script = (playbook.say || []).find(line => !line.includes('['));
        if (script) return ` Try it in their terms: "${script}"`;
        return playbook.how && playbook.how.length ? ` ${playbook.how[0]}` : '';
    }

    function coachingFor(read) {
        if (!read?.ok || !read.coachable?.length) return null;

        // The one lost for longest is the one to talk about.
        const moment = read.coachable.slice().sort((a, b) => b.tries - a.tries || b.beforeWords - a.beforeWords)[0];
        const playbook = playbookFor(moment.topicKey);
        const at = moment.time ? ` at ${moment.time}` : '';
        const subject = playbook.key === 'general' ? 'what you were explaining' : playbook.label;

        let text = moment.tries >= 2
            ? `The customer got lost on ${subject}${at}, and was still lost after the next try.`
            : `The customer got lost on ${subject}${at}, and there was no sign it landed before the call moved on.`;

        if (moment.jargon.length) {
            const named = joinList(moment.jargon.slice(0, 2).map(term => `"${term}"`));
            text += ` Words like ${named} are ours, not theirs.`;
        } else if (moment.beforeWords >= LONG_EXPLANATION_WORDS) {
            text += ' It came in one long stretch, which is a lot to hold on the phone.';
        }
        if (moment.sameWords) {
            text += ' Saying it again the same way rarely helps the second time. Come at it from a different side.';
        }

        text += tryLine(playbook);
        text += ` Then ${playbook.check}`;

        return {
            key: 'explanation',
            weight: moment.tries >= 2 ? 9 : 7,
            text: text.replace(/\s+/g, ' ').trim(),
            quote: moment.customerQuote
        };
    }

    function praiseFor(read) {
        if (!read?.ok) return null;
        // A second try that was genuinely different and then landed. A
        // "what do you mean" answered with the same words and an "okay" is
        // not what this is for.
        const moment = (read.landed || []).find(item => item.afterWords >= SAME_WORDS_MIN_WORDS
            && (item.usedExample || !item.sameWords));
        if (!moment) return null;
        const playbook = playbookFor(moment.topicKey);
        const subject = playbook.key === 'general' ? 'what you were explaining' : playbook.label;
        return {
            key: 'explanationLanded',
            praise: 7,
            text: moment.usedExample
                ? `When the customer got lost on ${subject}, you reached for an example instead of repeating yourself, and it landed.`
                : `When the customer got lost on ${subject}, you came at it a different way instead of repeating yourself, and it landed.`,
            quote: moment.landedQuote
        };
    }

    /* ── Showing it to the supervisor ── */

    function momentRows(moment) {
        const rows = [];
        if (moment.beforeQuote) {
            rows.push({
                time: moment.beforeTime,
                text: `How it was explained${moment.beforeWords ? `, ${moment.beforeWords} words` : ''}`,
                quote: moment.beforeQuote
            });
        }
        rows.push({
            time: moment.time,
            text: moment.tries >= 2 ? `The customer got lost, ${moment.tries} times in a row` : 'The customer got lost',
            quote: moment.customerQuote
        });
        if (moment.afterQuote) {
            rows.push({ time: '', text: 'What was tried next', quote: moment.afterQuote });
        }
        if (moment.landed) {
            rows.push({ time: moment.landedTime, text: 'It landed', quote: moment.landedQuote });
        }
        return rows;
    }

    function momentNotes(moment) {
        const notes = [];
        if (moment.jargon.length) notes.push(`Our words, left unexplained: ${moment.jargon.map(term => `"${term}"`).join(', ')}.`);
        if (moment.beforeWords >= LONG_EXPLANATION_WORDS) notes.push(`The explanation ran ${moment.beforeWords} words in one stretch.`);
        if (moment.sameWords) notes.push('The second try reused most of the first one\'s words.');
        if (moment.usedExample) notes.push('The second try used an example.');
        if (!moment.checked && !moment.landed) notes.push('Nobody checked whether it landed.');
        return notes;
    }

    function buildPanelHtml(read, escapeHtml) {
        const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        if (!read?.ok) return '';

        if (!read.moments.length) {
            const what = read.explained.length ? ` Explained: ${joinList(read.explained)}.` : '';
            return `<div class="call-alert call-alert-ok">
                <strong>✅ The customer never sounded lost.</strong> <span>${safe(what.trim())}</span>
            </div>`;
        }

        const lost = read.lost.length;
        const tone = lost ? 'warn' : 'ok';
        const title = lost
            ? `💬 The customer got lost ${lost === 1 ? `on ${read.lost[0].topicLabel}` : `${lost} times`}`
            : '✅ The customer got lost, and it landed';

        const blocks = read.moments.map((moment, index) => {
            const playbook = playbookFor(moment.topicKey);
            const rows = momentRows(moment).map(row => `<li>
                    ${row.time ? `<span class="call-alert-time">${safe(row.time)}</span>` : ''}
                    <span>${safe(row.text)}</span>
                    ${row.quote ? `<div class="call-alert-quote">"${safe(row.quote)}"</div>` : ''}
                </li>`).join('');
            const notes = momentNotes(moment);
            const say = (playbook.say || []).map(line => `<li>"${safe(line)}"</li>`).join('');
            const how = (playbook.how || []).map(line => `<li>${safe(line)}</li>`).join('');

            return `<div class="call-explain-moment">
                <div class="call-explain-topic">${safe(moment.topicLabel.charAt(0).toUpperCase() + moment.topicLabel.slice(1))}${moment.landed ? ', landed' : ', no sign it landed'}</div>
                <ol class="call-alert-timeline">${rows}</ol>
                ${notes.length ? `<div class="call-alert-note">${safe(notes.join(' '))}</div>` : ''}
                ${moment.landed ? '' : `
                ${say ? `<div class="call-trend-title call-explain-heading">Ways to say it that land</div><ul class="call-explain-list">${say}</ul>` : ''}
                ${how ? `<div class="call-trend-title call-explain-heading">How</div><ul class="call-explain-list">${how}</ul>` : ''}
                <div class="call-alert-note"><strong>Check it landed:</strong> ${safe(playbook.check.charAt(0).toUpperCase() + playbook.check.slice(1))}</div>
                <div class="flex-row" style="margin-top: var(--space-3);">
                    <button type="button" data-call-explain-copilot="${index}">🤖 Ask Copilot for clearer wording</button>
                </div>`}
            </div>`;
        }).join('');

        const caveat = read.labeled
            ? ''
            : '<div class="call-alert-note">Speakers were worked out from the flow of the call, not from labels. Listen at the times shown before you act on it.</div>';

        return `<div class="call-alert call-alert-${tone}">
            <div class="call-alert-title${tone === 'warn' ? ' call-alert-title-warn' : ''}">${safe(title)}</div>
            ${blocks}
            ${caveat}
        </div>`;
    }

    function buildPanelText(read) {
        if (!read?.ok || !read.lost?.length) return '';
        const lines = ['Where the customer got lost:'];
        read.lost.forEach(moment => {
            lines.push(`- ${moment.time ? `${moment.time} ` : ''}${moment.topicLabel}: "${moment.customerQuote}"`);
            const notes = momentNotes(moment);
            if (notes.length) lines.push(`  ${notes.join(' ')}`);
        });
        return lines.join('\n');
    }

    /* ── Handing the wording to Copilot ──
     *
     * The playbook knows the shape of a good explanation; it cannot rewrite
     * the one the associate actually gave. Copilot can. So the moment goes
     * over with the review already done and a request for wording only,
     * which is the framing that does not get refused, and with every number
     * the customer read out taken out first.
     */
    function buildCopilotPrompt(moment) {
        if (!moment || !Array.isArray(moment.excerpt) || !moment.excerpt.length) return '';
        const mask = window.DevCoachModules?.callTranscript?.maskIdentifiers || ((text) => text);
        const playbook = playbookFor(moment.topicKey);
        const subject = playbook.key === 'general' ? 'the topic in this excerpt' : playbook.label;

        const lines = [];
        lines.push('I supervise a call center for APS, an electric utility in Arizona. I have already reviewed this call. '
            + 'I am not asking you to assess or rate anybody. I only want help with wording.');
        lines.push('');
        lines.push(`In the excerpt below, a customer got lost while ${subject} was being explained. `
            + 'Numbers the customer read out have been replaced with [number].');
        lines.push('');
        moment.excerpt.forEach(turn => {
            const said = mask(turn.text);
            if (said) lines.push(`${turn.who}: ${said}`);
        });
        lines.push('');
        lines.push(`Give me three plainer ways to explain ${subject} to this customer, each under 45 words, `
            + 'in the everyday words a customer would use. Build on what the customer said they were confused about. '
            + 'Use no industry terms unless the same sentence says what they mean. Where a real amount or date is '
            + 'needed, leave a placeholder in square brackets rather than inventing one, and do not state APS '
            + 'policy you cannot see in the excerpt.');
        lines.push('After each one, give one short question the agent could ask to check it landed, in the customer\'s terms, '
            + 'not "does that make sense".');
        lines.push('Do not name, rate or assess the agent. No em dashes.');
        return lines.join('\n');
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callExplanation = {
        readExplanations,
        readExplanationsFromText,
        coachingFor,
        praiseFor,
        buildPanelHtml,
        buildPanelText,
        buildCopilotPrompt,
        unexplainedJargon,
        isConfused,
        isLanded,
        PLAYBOOKS,
        GENERAL
    };
})();
