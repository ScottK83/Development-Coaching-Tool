(function() {
    'use strict';

    /**
     * Was the caller verified, and where it was not their account, authorized,
     * before anything on the account was shared with them?
     *
     * This is the one QA question that is not about quality. An associate who
     * reads a balance to whoever rings has handed a stranger somebody else's
     * account, and it is the question that most needs a straight answer.
     *
     * The first version answered it by looking for the word "verify", or the
     * words "account number or the address", anywhere before the first "your
     * balance". On the calls it most needed to catch it said the opposite:
     *
     *   - "can i have your account number or the address on the account", then
     *     the balance, read as VERIFIED and was praised in the draft. An
     *     address finds the account. Anybody standing in the kitchen knows it.
     *   - "let me verify that for you" counted as an identity check.
     *   - a caller who could not give the last four, followed by the balance,
     *     read as verified, because the question had been asked.
     *   - "it looks like you have a balance of", "i see a past due amount" and
     *     "the phone number we have on file is" were not recognised as account
     *     detail at all, so the answer was "nothing to protect".
     *   - "i'm calling about my mom's account" was never looked for.
     *
     * So this reads the call as a sequence of events: what was asked to find
     * the account, what was asked to prove who was calling and whether that
     * went through, whether the caller said it was somebody else's account and
     * what was done about it, and the first moment something on the account
     * was said to them. The verdict comes from the order those happened in.
     *
     * WHAT COUNTS AS VERIFIED
     *
     * Something only the account holder would know that is not printed on the
     * bill: the last four of the social, the date of birth, a PIN or passcode,
     * a security question, an ID number. The name, the address, the account
     * number and the phone number find the account; they do not prove who is
     * calling. A real APS call verifies with "for security purposes can you
     * please verify the last four digits of your social". If the floor's
     * standard is different, IDENTIFIERS and LOOKUPS below are the two lists
     * to move things between, and the tests name each case.
     *
     * WHO SAID IT
     *
     * Verint's export carries no speaker labels, so on an unlabelled paste the
     * sides are inferred and the inference is sometimes wrong. That is why the
     * patterns are written the way only one side talks: nobody but the advisor
     * says "can you verify the last four of your social" or "your balance is",
     * and nobody but the caller says "it's my mom's account". A line in the
     * caller's own first person about their account ("my bill", "i owe") is
     * never read as the advisor sharing it. On an unlabelled call the flag says
     * so, with the time to listen at, because a wrong flag here tells somebody
     * they gave an account away.
     */

    /* ── Vocabulary ── */

    const SPOKEN_NUMBER = 'zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred';
    const MONTH = 'january|february|march|april|may|june|july|august|september|october|november|december';
    // A value being read out, as a transcript writes it.
    const VALUE = `(?:\\$|\\d|(?:about |around |roughly |only |just |over |under |a |an )?(?:${SPOKEN_NUMBER}|a hundred|a thousand)\\b)`;

    // Proof of identity. Each carries the words the supervisor reads.
    const IDENTIFIERS = [
        {
            what: 'the last four of the social',
            // "last four of the account number" is on the bill, so it is not
            // proof of anything, and "the last four months" is usage talk.
            // Read as an identity question, that one would have let a balance
            // shared a minute later pass as verified.
            source: "last (?:four|4)(?: digits)?(?! (?:digits )?(?:of|on) (?:the |your |that |this )?(?:(?:credit|debit) )?(?:account|phone|card|bank|routing|check|meter|visa|mastercard))(?! (?:months|weeks|days|years|bills|statements|payments|times|calls)\\b)"
        },
        {
            what: 'the social',
            // Not the benefits: "are you getting your social security" on an
            // assistance call is a question about income, not identity.
            source: "social(?! media| security (?:benefits|income|checks?|office|administration|disability|comes?|deposits?|payments?|money|pays?)| (?:worker|services))(?: security| insurance)?(?: number)?\\b|security number\\b|s ?s ?n\\b"
        },
        { what: 'the date of birth', source: 'date of birth\\b|birth ?date\\b|birthday\\b|d o b\\b' },
        { what: 'a PIN or passcode', source: 'pin(?: number)?\\b|pass ?code\\b|pass ?word\\b' },
        { what: 'a security question', source: 'security (?:word|answer|question)s?\\b' },
        { what: 'an ID number', source: "driver'?s? licen[cs]e\\b|passport\\b|i ?d number\\b|state i ?d\\b" }
    ].map(item => ({ ...item, pattern: new RegExp(`\\b(?:${item.source})`, 'i') }));

    const IDENTIFIER_SOURCE = IDENTIFIERS.map(item => `(?:${item.source})`).join('|');

    // How an advisor asks for something.
    const ASK_LEAD = [
        "(?:can|could|may|would) (?:i|you|we)(?: please)?(?: just)?(?: go ahead and)? (?:have|get|grab|give|provide|verify|confirm|tell|read|share|answer)",
        "(?:i|we)(?:'ll| will| do| just)?(?: just)? need",
        "(?:i'?m|we'?re) (?:gonna|going to) need",
        'let me (?:get|have|grab)',
        'do you have',
        "what(?:'s| is| was)",
        'please (?:verify|confirm|provide|give)',
        'go ahead and (?:verify|confirm|give|provide)',
        'verify',
        'confirm',
        'provide',
        'for (?:security|verification)(?: purposes)?'
    ].join('|');

    // Asked with a verb, or asked the way people actually talk: "okay and
    // your date of birth", "and the last four of your social". The second
    // person on an identifier is advisor voice; the caller says "my".
    const ASKED_OUTRIGHT = new RegExp(`\\b(?:${ASK_LEAD})\\b[a-z0-9' -]{0,45}?\\b(?:${IDENTIFIER_SOURCE})`, 'i');

    const IDENTITY_ASK = new RegExp([
        ASKED_OUTRIGHT.source,
        `\\b(?:your|the account holder'?s|his|her|their) (?:${IDENTIFIER_SOURCE})`,
        `\\b(?:and|okay|alright|now|next)(?: then)? the (?:${IDENTIFIER_SOURCE})`,
        `\\b(?:${IDENTIFIER_SOURCE})[a-z ]{0,40}\\bplease\\b`
    ].join('|'), 'i');

    const CALLER_OFFERS = new RegExp(`\\bdo you (?:need|want) (?:the|my|his|her|their|a|an)\\b|\\bi have (?:the|his|her|their|all|my)\\b[a-z' ]{0,40}?\\b(?:${IDENTIFIER_SOURCE})`, 'i');
    const ASKING_OUTRIGHT = /\b(?:can|could|may|would) (?:you|i)\b|\bwhat(?:'s| is)\b|\bplease\b/i;
    const CONFIRMATION_NUMBER = /\bconfirmation (?:number|code)\b/i;

    // The caller reading their own out: "the last four of my social is".
    const GIVES_IDENTIFIER = /\b(?:the )?last (?:four|4)(?: digits)?(?: of)?(?: my| the)?(?: social| ssn| s s n)?(?: number)? (?:is|are)\b|\bmy (?:social(?: security)?|ssn|date of birth|birth ?date|birthday|pin|pass ?code)(?: number)? (?:is|would be)\b/i;

    // First person about an identifier is the caller, whichever side the
    // parser put the line on.
    const FIRST_PERSON_IDENTIFIER = new RegExp(`\\bmy (?:${IDENTIFIER_SOURCE})`, 'i');

    // Verified before the advisor picked up. Only the phone system counts:
    // "you're verified" said by the advisor after taking an address is the
    // same trap as the address itself.
    const IVR_VERIFIED = /\b(?:verified|authenticated) (?:in|through|by|with|on|over) the (?:system|phone(?: system)?|automated(?: system| line)?|ivr|i v r|prompts?)\b|\b(?:i|we) (?:see|show) (?:that )?you(?:'ve| have)? (?:already )?(?:been )?(?:verified|authenticated)\b|\balready (?:been )?(?:verified|authenticated)\b|\b(?:previous|last|other) (?:agent|advisor|rep|representative|person) (?:already )?verified\b/i;

    // The caller saying so ("i already verified with the other lady") is a
    // claim, not the system, and "you did not get verified through the phone
    // system" is the opposite of verified. Either one used to count, and a
    // false "verified" also silenced a real failed check later in the call.
    const NOT_THE_PHONE_SYSTEM = /\b(?:not|n'?t|never|unable)\b(?: \w+){0,3} (?:verified|authenticated)\b|\bi(?:'ve| have| was| got)?(?: already)?(?: been)? (?:verified|authenticated)\b|\bverified me\b/i;

    // Said after an identity question that went through. It settles a check
    // that was asked for; it never stands in for one.
    const CONFIRMED = /\bthank(?:s| you)(?: (?:so|very) much)? for (?:verifying|confirming)\b|\byou(?:'re| are)(?: all)? verified\b|\b(?:that|it|everything) (?:matches|checks out)\b/i;

    // The check did not go through.
    //
    // "I don't know" is everywhere in a call, so it only counts when it is
    // about the thing asked for ("i don't know it", "i haven't got my social
    // security number") or is the whole of a short answer ("no idea"). "I
    // don't know why my bill is so high", three turns after a clean check,
    // is the caller explaining why they rang.
    const CANNOT_CORE = /\b(?:i (?:still |even |actually |just |really )?(?:do not|don'?t|dont|did not|didn'?t) (?:know|have|remember|recall)|i (?:still |even |actually |just )?(?:have not|haven'?t|never) (?:got|gotten|had|received|been given|been issued)|i (?:can'?t|cannot|can not) (?:remember|recall|find)|no idea|not sure)\b/i;
    const CANNOT_OBJECT = new RegExp(`\\b(?:know|have|remember|recall|got|gotten|had|received|given|issued|find|idea|sure)(?: (?:what|of|about))? (?:it|that|them|this|those|one|the (?:number|numbers|digits|answer|info(?:rmation)?)|(?:his|her|their|my|the|a|an) (?:[a-z']+ ){0,3}?(?:${IDENTIFIER_SOURCE}))`, 'i');
    const SHORT_ANSWER_WORDS = 8;

    function callerCannot(text) {
        if (!CANNOT_CORE.test(text)) return false;
        return CANNOT_OBJECT.test(text) || collapse(text).split(' ').length <= SHORT_ANSWER_WORDS;
    }
    const NO_MATCH = /\b(?:that|it)(?:'s| is) (?:not correct|incorrect)\b|\b(?:does not|doesn'?t|did not|didn'?t) (?:match|line up)\b|\b(?:not|isn'?t|wasn'?t) (?:matching|a match|what (?:i|we) (?:have|show|see))\b|\b(?:not|n'?t) (?:be )?able to verify\b(?! my\b)|\b(?:unable|can'?t|cannot|couldn'?t|could not|can not) (?:to )?verify\b(?! my\b)/i;

    // How many turns after the question a failed answer still belongs to it.
    const FAILURE_WINDOW = 3;
    const NO_MATCH_WINDOW = FAILURE_WINDOW + 2;

    /* ── What counts as answering ──
     *
     * Any reply used to count, so "why do you need that", or "okay no problem"
     * after "i do not have it on me", answered the question and the balance
     * that followed read as verified, with the associate praised for it. The
     * social, the date of birth and an ID number are read out as numbers or a
     * date, so the answer has to carry one. A security question or a password
     * is answered in words, so when one was asked outright a short reply that
     * is not a refusal is taken as the answer.
     */
    const ANSWER_VALUE = new RegExp('\\b(?:' + MONTH + ')\\b|\\d{3,}|\\b(?:' + SPOKEN_NUMBER + '|\\d+)\\b.*\\b(?:' + SPOKEN_NUMBER + '|\\d+)\\b', 'i');
    const WORD_ANSWER_WORDS = 6;
    const NOT_AN_ANSWER = /\b(?:why|not|no|don'?t|what|hold on|one (?:sec|second|moment))\b/i;

    // Finding the account. Asked for, these explain a verdict; they never
    // make one.
    const LOOKUPS = [
        { what: 'the account number', pattern: /\baccount number\b/i },
        { what: 'the address', pattern: /\b(?:service |street |home )?address\b/i },
        { what: 'the phone number', pattern: /\bphone number\b|\bnumber you'?re calling from\b/i },
        { what: 'the name on the account', pattern: /\bname on the account\b|\b(?:first and last|full) name\b|\byour name\b/i }
    ];
    const ASKING = /\b(?:can|could|may) i (?:please )?(?:have|get|grab)\b|\bwhat(?:'s| is| was)\b|\bdo you have\b|\b(?:verify|confirm|provide)\b|\bgive me\b|\?/i;

    /* ── Account detail going out ──
     *
     * What the advisor said about the account, to the caller. Asking for it
     * does not count, and neither does a caller describing their own bill.
     */
    const DISCLOSURES = [
        {
            key: 'balance',
            what: 'the balance',
            pattern: new RegExp([
                "(?<!\\b(?:know|tell you|tell me|find out|see|check|share|give you|go over) what (?:the |your |my )?(?:current )?)\\b(?:balance|amount due|total due|amount owed|past due amount|past due balance|payoff amount)(?: on (?:the|your) account)?(?: right now| today| currently)? (?:of|is|was|comes to|came to|comes out to|would be|will be|as of|showing)\\b",
                "(?<!\\b(?:if|when|once|do|does) )\\b(?:you have|you(?:'ve| have) got|there(?:'s| is)|i (?:do )?see|i (?:do )?show|it(?:'s| is) showing|it shows|showing) (?:a |an |the |your )?(?:current |remaining |outstanding |total |zero |previous )?(?:balance|amount due|past due|credit(?! card| check| score| report))\\b",
                "(?<!\\bif )\\byou(?:'re| are) (?:currently |still )?(?:past due|behind(?: on)?|in arrears|paid up|all paid up|current on)\\b",
                "\\b(?:your|the) account is (?:currently |still )?(?:past due|behind|in arrears|paid up|current)\\b",
                '(?<!\\bif )(?<!\\b(?:pay|cover|split) (?:what|whatever|everything) )\\byou (?:still )?(?:owe|do not owe|don\'?t owe)\\b'
            ].join('|'), 'i')
        },
        {
            key: 'dueDate',
            what: 'the due date',
            pattern: /\b(?:it(?:'s| is)|that(?:'s| is)|bill is|payment is|balance is|amount is|which is) due (?:on|by|the|today|tomorrow|this|next|in)\b|\bdue date (?:is|was|would be|will be|of|on (?:the|your) account)\b|\byou have until (?:the |this |next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|january|february|march|april|may|june|july|august|september|october|november|december|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|twentieth|thirtieth|\d)/i
        },
        {
            key: 'payment',
            what: 'a payment on the account',
            // Payments already on the account. "Your payment went through",
            // said about the one the caller just made on the phone, is not
            // telling them anything, and anybody may pay a bill.
            pattern: /\b(?:your|the) (?:last|most recent|previous|latest|recent) payment (?:was|of|is|came|posted|went|for|on)\b|\b(?:your|a|the) payment (?:of [a-z0-9 ]{1,40} )?(?:posted|was received|was applied|has been applied|has posted|is showing|shows|came in)\b|\b(?:that|the|your) payment (?:came|went) through (?:on|last) (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|the|week)\b|\b(?:i|we) (?:do )?(?:see|show) (?:a |your |the |that )?(?:recent |last )?payment\b(?! (?:arrangement|plan|option|extension))/i
        },
        {
            key: 'disconnect',
            what: 'the disconnect date',
            // A disconnect for the bill, not an outage. "The power was shut
            // off in your area" is storm news anybody may be told, so only the
            // scheduled forms and a past one tied to payment count.
            pattern: /\b(?:scheduled|set|pending|slated|due) (?:for|to be) (?:a )?(?:disconnect(?:ion)?|disconnected|shut ?off|cut off|turned off)\b|\bdisconnect(?:ion)? (?:is|was|has been) (?:scheduled|set|pending|going|on)\b|\b(?:disconnect(?:ion)?|shut ?off) date (?:is|was|of)\b|\bpending (?:disconnect(?:ion)?|shut ?off)\b|\b(?:your|the) (?:power|service|electric(?:ity)?|lights) (?:is scheduled to be|is set to be|is due to be|is going to be|will be|is getting) (?:disconnected|shut off|cut off|turned off)\b|\b(?:was|were|has been|got) (?:disconnected|shut off|cut off|turned off) (?:for|because of|due to) (?:non ?payment|the balance|a past due|the past due|not paying)\b/i
        },
        {
            key: 'usage',
            what: 'the usage',
            pattern: new RegExp(`\\byour usage (?:is|was|went|has been|this|last)\\b|(?<!\\bif )\\byou(?:'ve| have)? used (?!to\\b)(?:about |around |roughly |over |under )?(?:\\d|${SPOKEN_NUMBER}|a hundred|more|less|a lot|double|twice)\\b`, 'i')
        },
        {
            key: 'bill',
            what: 'the bill amount',
            pattern: new RegExp(`\\byour (?:current |last |latest |most recent |next |new |${MONTH} )?(?:bill|statement)(?: this month| last month| for (?:this|last) month| for ${MONTH})? (?:(?:is|was|came to|comes to|came out to|will be|would be|totals|totaled) (?:about |around |roughly |only |just )?${VALUE}|(?:is|was) (?:higher|lower|more|less|up|down|double))|\\b(?:this|last|the)(?: last| latest| previous| current| next)? (?:month'?s )?(?:bill|statement) (?:is|was|came to|comes to|came out to) ${VALUE}`, 'i')
        },
        {
            key: 'plan',
            what: 'the plan on the account',
            pattern: /\byour (?:current )?(?:rate )?plan is\b|(?<!\b(?:if|once|when|after|until) )\byou(?:'re| are) (?:currently |already |still )?(?:on|enrolled (?:in|on)|signed up for|set up (?:on|for)) (?:the |a |our )?(?:[a-z]+ ){0,4}(?:plan|program|autopay|auto pay|budget billing|paperless)\b|(?<!\b(?:do|if) )\byou (?:currently |already )?have (?:autopay|auto pay|budget billing|paperless)\b/i
        },
        {
            key: 'accountNumber',
            what: 'the account number',
            pattern: new RegExp(`(?<!\\b(?:know|tell me|remember|find) what )\\b(?:your|the) account number is\\b|\\baccount number is (?:\\d|${SPOKEN_NUMBER})\\b`, 'i')
        },
        {
            key: 'onFile',
            what: 'contact information on file',
            pattern: new RegExp([
                "\\b(?:phone number|number|email(?: address)?|e mail(?: address)?|mailing address|billing address|address) (?:that )?(?:we have |i have |i see |i show )?(?:on file|on the account|listed)(?: for you)? (?:is|as|ends|ending|would be)\\b",
                "\\b(?:we|i) (?:have|show|see) (?:your|the|a) (?:phone number|number|email(?: address)?|e mail(?: address)?|mailing address|billing address) (?:as|listed as|ending|that ends|on file as|is)\\b",
                // Not "card ending in": reading back the card the caller has
                // just given to pay with tells them nothing.
                "\\b(?:phone|phone number|email|account|account number) (?:ending|that ends) in\\b",
                `\\bis (?:the|your) (?:service |mailing |billing )?(?:address|phone number|number|email(?: address)?|e mail) (?:still |on file |on the account )?(?:\\d|${SPOKEN_NUMBER})\\b`
            ].join('|'), 'i')
        },
        {
            key: 'holderName',
            what: 'the name on the account',
            pattern: /(?<!\bwhat (?:the |is the )?)\bname on the account is\b|\baccount is (?:in|under) the name\b|\b(?:it'?s|it is) (?:in|under) the name (?:of )?\b/i
        },
        {
            key: 'identifiers',
            what: 'a date of birth or social on the account',
            pattern: new RegExp(`\\b(?:is|was) (?:your|the|his|her) (?:date of birth|birthday|birth date|social|last four)(?: of (?:your|the|his|her) social)?(?: on the account)? (?:${MONTH}|\\d|${SPOKEN_NUMBER})\\b|\\b(?:i have|i show|i see|we have) (?:${MONTH}|\\d|${SPOKEN_NUMBER})\\b[a-z0-9 ]{0,40} (?:for|as) (?:your|the|his|her) (?:date of birth|birthday|birth date|social|last four)\\b|\\byour (?:date of birth|birthday|birth date|social|last four)(?: on file)? (?:is|was) (?:${MONTH}|\\d|${SPOKEN_NUMBER})\\b`, 'i')
        }
    ];

    /* ── The bare answer ──
     *
     * "What do I owe?" answered with "it's one hundred eighty seven dollars"
     * names no balance at all, and it is the most natural way to give one
     * away. So an amount of money said by the advisor within a few turns of
     * the caller asking what they owe counts as sharing the balance. Fees,
     * rates, deposits and monthly estimates are not the account's balance.
     */
    const AMOUNT_QUESTION = /\b(?:what do i owe|how much (?:do i owe|i owe|is (?:my|the) (?:bill|balance|total)|do i have to pay|is due|was my (?:last )?(?:bill|payment))|what(?:'s| is| was) (?:my|the) (?:balance|bill|amount(?: due)?|total|payoff)|(?:tell me|know) (?:my|the) balance|what(?:'s| is) owed|how much (?:do|would|will) i (?:need|have) to pay|how much is it)\b/i;
    const MONEY = new RegExp(`\\b(?:\\d+|${SPOKEN_NUMBER}|a hundred|a thousand)\\b[a-z0-9 ]{0,40}?\\b(?:dollars?|bucks|cents)\\b|\\$\\s?\\d`, 'i');
    const NOT_THE_BALANCE = /\bfees?\b|\bconvenience\b|\bup to\b|\bdeposit\b|\bper (?:month|kilowatt|kwh|k w h)\b|\bcents per\b|\ba month\b|\beach month\b/i;
    const AMOUNT_WINDOW = 6;
    const AMOUNT_ANSWER = { key: 'balance', what: 'the balance' };

    // The caller talking about their own account, or passing on what somebody
    // else told them, or the advisor saying it back. None of it is the advisor
    // sharing anything, whichever side an unlabelled parse put it on.
    //
    // Deliberately narrow. "It says here" and "i got your account up" are how
    // an advisor reads the screen, so neither may appear in this list: each
    // would hide exactly the disclosure this module exists to catch.
    const CALLER_VOICE = /\bmy (?:balance|bill|account|payment|usage|power|service|due date|statement|plan|meter|deposit|social|date of birth|birthday)\b|\bi (?:owe|paid|pay|used|was charged|got charged|was billed|got billed|was told)\b|\bi(?:'m| am) (?:past due|behind)\b|\b(?:they|someone|somebody|the (?:letter|notice|app|website|email|text|last person|other (?:rep|lady|guy|person))) (?:told me|said|sent me)\b|\byou(?:'re| are) saying\b|\b(?:the|a|an) (?:letter|notice|text|email|app|website) (?:says|saying|said|shows|showing|is showing|that says)\b|\bi got a (?:letter|notice|text|email|call)\b|\bcan i (?:just )?pay\b|\bi(?:'ll| will| can| want to| wanna) (?:just )?pay\b/i;

    /* ── Somebody else's account ──
     *
     * All first person, so it is the caller whichever side the parser chose.
     * "My landlord's name" is left out on purpose: somebody starting service
     * says it about the last tenant's account, and that is not a third party
     * asking about an account, it is a new customer.
     */
    const RELATION = "(?:mom|mother|mum|momma|mama|dad|father|papa|husband|wife|spouse|son|daughter|kid|child|grandma|grandmother|grandpa|grandfather|granddad|grandson|granddaughter|boyfriend|girlfriend|fianc(?:e|ee)|partner|brother|sister|aunt|auntie|uncle|cousin|niece|nephew|friend|neighbou?r|tenant|roommate|room mate|parents?|grandparents?|mother in law|father in law|sister in law|brother in law|son in law|daughter in law|stepmom|stepmother|stepdad|stepfather|ex(?: husband| wife)?|client|boss|employer)";
    //
    // "My wife's name is on the bill too" is left out as well: that is a
    // joint holder saying so, and only "in/under my wife's name" says the
    // account is somebody else's.
    const THIRD_PARTY = [
        new RegExp(`\\bmy ${RELATION}(?:'?s| s)? (?:account|bill|service|power|electric(?:ity)?)\\b`, 'i'),
        new RegExp(`\\b(?:account|it|bill|service|power|everything)(?:'?s| is| was)?(?: still| all)? (?:in|under) (?:my ${RELATION}(?:'?s| s)?|his|her|their) name\\b`, 'i'),
        new RegExp(`\\b(?:calling|call|ringing) (?:for|on behalf of|about) my ${RELATION}\\b`, 'i'),
        // First person only. The advisor asking "are you calling on behalf
        // of the account holder" is checking, not being told.
        /\bi(?:'m| am)(?: just| actually)? (?:calling )?on behalf of\b/i,
        new RegExp(`\\b(?:it'?s|its|that'?s|it is|that is) my ${RELATION}(?:'s| s)\\b|\\bthis is (?:his|her|their) ${RELATION}\\b|\\bmy ${RELATION} (?:asked|wants|told|needs) me to\\b`, 'i'),
        /\bi(?:'m| am) not (?:the account holder|on the account|listed on the account|the one on the account|the primary)\b/i,
        /\b(?:it'?s|it is|the account is|account'?s|account is) not (?:in|under) my name\b/i,
        new RegExp(`\\bi(?:'m| am) (?:his|her|their) ${RELATION}\\b|\\bi(?:'m| am) (?:his|her|their|the) (?:caregiver|care giver|power of attorney|p o a|property manager|landlord|executor)\\b`, 'i'),
        /^(?=.*\b(?:passed away|deceased)\b)(?=.*\b(?:account|bill|name|service|owed?|balance)\b)(?=.*\b(?:his|her|their|he|she|they)\b)/i
    ];

    // Questions that settle whether this caller may be told anything.
    // A "no" to one of these means the caller is not entitled.
    const AUTHORIZATION_QUESTION = /\bare you (?:the |an? )?(?:account holder|primary|authorized|listed|on the account|named on the account|the person on the account|a joint|an additional|a co)\b|\b(?:is|are) (?:he|she|they|this person) (?:the account holder|on the account|listed|authorized|available|there|with you|home|around)\b/i;
    // The same check asked the other way round, where "yes" is the answer
    // that makes it somebody else's account. Read with the polarity of the
    // question above, "no, it's my account" became a caller who had just
    // said they were not on it.
    const ON_BEHALF_QUESTION = /\bare you (?:calling )?(?:on behalf of|for) (?:someone|somebody|the account holder|another person|a family member)\b|\bis (?:this|the account) (?:for|under|in) (?:someone|somebody) else(?:'s name)?\b/i;
    const AFFIRM = /^\s*(?:yes|yeah|yep|yup|i am|correct|that'?s right)\b/i;
    const HANDOFF = /\bis (?:he|she|they|the account holder|your (?:mom|mother|dad|father|husband|wife)) (?:there|available|with you|home|around|able to (?:come|get) to the phone)\b|\b(?:put|get|have) (?:him|her|them|the account holder) on\b|\b(?:speak|talk) (?:with|to) (?:him|her|them|the account holder)\b|\b(?:put|get|have) your (?:mom|mother|dad|father|husband|wife|son|daughter) on\b|\b(?:can|could) (?:he|she|they) (?:come|get) (?:to|on) the (?:phone|line)\b/i;
    // Permission actually asked of the account holder, or given. Present tense
    // "gives" is left out on purpose: "not unless the account holder gives
    // verbal authorization" is the advisor refusing, and reading it as a grant
    // would clear the very refusal it states.
    // The object is required: "can you give me the last four" is a question
    // about identity, and read as permission it hid an authorization miss.
    const PERMISSION = /\b(?:do you|does (?:he|she|the account holder)|will you|would you|can you) (?:give|grant)(?: [a-z']+){0,3} (?:permission|authorization|consent)\b|\b(?:do you|does (?:he|she|the account holder)) authorize\b|(?<!\bunless (?:he|she|they|the account holder) (?:has |have |had )?)\b(?:gave|granted|given|giving) (?:you |them |him |her |us )?(?:verbal )?(?:permission|authorization|consent)\b|\bi (?:give|grant) (?:you |them |him |her )?(?:verbal )?(?:permission|authorization|consent)\b|\badd(?:ed)? (?:you|them|him|her) (?:to|on|as) (?:the account|an authorized)\b|\b(?:this is|i(?:'m| am)) the account holder\b/i;
    // Authorization being dealt with, without settling it either way.
    const AUTHORIZATION_OTHER = /\b(?:i|we) (?:do )?(?:see|have|show) you (?:listed|on the account|as (?:an? )?(?:authorized|joint|secondary|additional))\b|\byou(?:'re| are) (?:listed|authorized|an authorized)\b|\bauthorized (?:user|party|contact|person|caller|representative)\b|\b(?:verbal|written) (?:authorization|permission|consent)\b|\bthird party\b|\bpower of attorney\b|\bdeath certificate\b|\bjoint account holder\b/i;
    const REFUSAL = /\b(?:can'?t|cannot|can not|not able to|unable to|not allowed to|won'?t be able to) (?:discuss|release|share|give (?:out|you)|go over|provide|disclose|talk about|speak about|tell you)\b(?: [a-z']+){0,4} (?:account|information|info|details|balance|any of (?:that|it))\b|\b(?:can|am able to) only (?:discuss|speak|talk|release|share)\b|\bonly (?:discuss|speak|talk) (?:about )?(?:the account )?(?:with|to) the (?:account holder|person on the account|authorized)\b/i;
    const DENIAL = /^\s*(?:no|nope|nah|not really|unfortunately not)\b(?! (?:problem|worries|worry)\b)|\bno (?:i(?:'m| am)|she(?:'s| is)|he(?:'s| is)|they(?:'re| are)|it(?:'s| is))\b|\bi(?:'m| am) not(?! sure\b| certain\b| able\b| gonna\b| going\b| trying\b)\b|\b(?:she|he|they)(?:'s| is|'re| are) not\b|\bnot (?:on|listed on) (?:the|it)\b/i;
    const DENIAL_WINDOW = 2;
    // The advisor finding the caller on the account settles a "no, but i'm
    // an authorized user" as surely as permission does.
    const SEES_CALLER_LISTED = /\b(?:i|we) (?:do )?(?:see|have|show) you (?:listed|on the account|as (?:an? )?(?:authorized|joint|secondary|additional))\b/i;

    // Disclosures a caller's answer to a lookup question can look like.
    const ANSWERS_A_LOOKUP = ['holderName', 'accountNumber', 'onFile'];
    // Enough of a number that repeating it back is a read-back, not a match
    // on a stray "one".
    const READ_BACK_MIN_CHARS = 7;
    const SPOKEN_DIGIT = new RegExp(`\\b(?:${SPOKEN_NUMBER}|\\d+)\\b`, 'gi');

    function spokenDigits(text) {
        return (String(text || '').match(SPOKEN_DIGIT) || []).join(' ');
    }

    const TRUNCATED = /\[transcript truncated(?: for storage)?\]/i;

    /* ── Helpers ── */

    function collapse(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function clip(value, max) {
        const text = collapse(value);
        const limit = max || 110;
        if (text.length <= limit) return text;
        const cut = text.slice(0, limit);
        const lastSpace = cut.lastIndexOf(' ');
        return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}...`;
    }

    function clock(seconds) {
        if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '';
        const whole = Math.max(0, Math.round(seconds));
        return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
    }

    function capitalize(text) {
        const value = String(text || '');
        return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
    }

    function joinList(items) {
        const values = (items || []).filter(Boolean);
        if (values.length <= 1) return values[0] || '';
        if (values.length === 2) return `${values[0]} and ${values[1]}`;
        return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
    }

    function identifierWhat(text) {
        const found = IDENTIFIERS.find(item => item.pattern.test(text));
        return found ? found.what : 'an identity question';
    }

    function firstDisclosure(text) {
        return DISCLOSURES.find(item => item.pattern.test(text)) || null;
    }

    /* ── Reading the call ── */

    /**
     * Annotates each turn with what it does, from the side it was said on.
     *
     * With labels the sides are known and used strictly. Without them, a turn
     * is only kept off the advisor's side when a phrase placed it with the
     * caller for certain; everything else is judged by the words, which were
     * chosen because only one side says them.
     */
    function annotate(turns, labeled) {
        const advisorSide = (turn) => (labeled ? turn.role === 'agent' : !(turn.role === 'customer' && turn.cued));
        const callerSide = (turn) => (labeled ? turn.role === 'customer' : !(turn.role === 'agent' && turn.cued));

        return turns.map((turn, index) => {
            const text = collapse(turn.text);
            const advisor = advisorSide(turn);
            const caller = callerSide(turn);
            const cannot = callerCannot(text);
            const firstPerson = CALLER_VOICE.test(text);

            // A payment confirmed with its confirmation number is the one the
            // caller has just made on the phone, not history being read out.
            const found = advisor && !firstPerson ? firstDisclosure(text) : null;
            const disclosure = found && found.key === 'payment' && CONFIRMATION_NUMBER.test(text) ? null : found;

            // The caller offering an identifier is not the advisor asking for
            // one ("do you need his social", "i have the account number and
            // the last four ready"), unless somebody is actually being asked:
            // "i have the account up, can you verify your date of birth" is
            // the advisor. An "i don't have a pin on file, so can you verify"
            // is the advisor too, so a question outweighs the "don't have".
            const asked = ASKING_OUTRIGHT.test(text);
            const callerOffers = CALLER_OFFERS.test(text) && !asked;
            const asksIdentity = advisor && !callerOffers && (!cannot || asked)
                && !FIRST_PERSON_IDENTIFIER.test(text) && IDENTITY_ASK.test(text);
            const lookup = advisor && !disclosure && !asksIdentity && ASKING.test(text)
                ? LOOKUPS.filter(item => item.pattern.test(text)).map(item => item.what)
                : [];

            return {
                index,
                at: typeof turn.at === 'number' ? turn.at : null,
                text,
                advisor,
                caller,
                disclosure,
                asksIdentity,
                identityWhat: asksIdentity ? identifierWhat(text) : '',
                givesIdentity: caller && !cannot && !NO_MATCH.test(text) && GIVES_IDENTIFIER.test(text),
                ivr: IVR_VERIFIED.test(text) && !NOT_THE_PHONE_SYSTEM.test(text),
                confirmed: advisor && CONFIRMED.test(text),
                cannot: caller && cannot,
                noMatch: advisor && NO_MATCH.test(text),
                thirdParty: THIRD_PARTY.some(pattern => pattern.test(text)),
                authQuestion: advisor && AUTHORIZATION_QUESTION.test(text),
                onBehalfQuestion: advisor && ON_BEHALF_QUESTION.test(text),
                affirm: caller && AFFIRM.test(text),
                handoff: advisor && HANDOFF.test(text),
                permission: PERMISSION.test(text),
                authOther: AUTHORIZATION_OTHER.test(text),
                refusal: advisor && REFUSAL.test(text),
                denial: caller && DENIAL.test(text),
                asksAmount: caller && AMOUNT_QUESTION.test(text),
                statesAmount: advisor && !firstPerson && MONEY.test(text) && !NOT_THE_BALANCE.test(text),
                lookup,
                truncated: TRUNCATED.test(text)
            };
        });
    }

    /**
     * Does this reply answer the identity question that is waiting?
     *
     * Verint sometimes runs the caller's answer into the advisor's next
     * segment ("two three four five okay perfect so your balance is..."), so
     * on a turn that also shares something, only the words before the sharing
     * are looked at.
     */
    function answersCheck(mark, ask) {
        const said = mark.disclosure
            ? mark.text.slice(0, mark.disclosure.pattern.exec(mark.text).index)
            : mark.text;
        if (ANSWER_VALUE.test(said)) return true;

        const inWords = /security question|PIN or passcode/.test(ask.identityWhat) && ASKED_OUTRIGHT.test(ask.text);
        const words = collapse(said).split(' ').filter(Boolean).length;
        return inWords && !mark.disclosure && words > 0 && words <= WORD_ANSWER_WORDS && !NOT_AN_ANSWER.test(said);
    }

    function event(turn, extra) {
        return {
            index: turn.index,
            at: turn.at,
            time: clock(turn.at),
            quote: clip(turn.text),
            ...(extra || {})
        };
    }

    /**
     * The read itself. Takes a parse from callTranscript.parseTranscript, so
     * every caller shares one idea of who said what.
     */
    function readVerification(parsed) {
        const turns = Array.isArray(parsed?.turns) ? parsed.turns.filter(Boolean) : [];
        if (!turns.length) return { ok: false, reason: 'empty' };

        // A paste with no timestamps and no labels comes through as one turn,
        // and one turn has no order to read. Judging it anyway flagged a
        // clean call, because the check and the balance sat in the same turn.
        const labeled = Boolean(parsed.labeled);
        if (!labeled && turns.length === 1) return { ok: false, reason: 'unsegmented' };
        const marks = annotate(turns, labeled);

        // A trimmed transcript lost its middle. A disclosure after the cut
        // cannot be judged unverified, because the check may be what was cut.
        const cutAt = marks.findIndex(mark => mark.truncated);

        let pendingAsk = null;       // the identity question awaiting an answer
        let identity = null;         // the check currently standing
        let failure = null;          // a check that did not go through, unresolved
        let thirdParty = null;
        let lastAuthQuestion = null;
        let lastOnBehalfQuestion = null;
        let lastAmountQuestion = null;
        let denial = null;           // told "no, I'm not on it", unresolved
        let handoffAfterDenial = false;
        let refusal = null;
        const authorizations = [];
        const identityAsks = [];
        const lookups = [];
        const disclosures = [];
        let breach = null;

        // Two kinds of line read like sharing and are not. The caller
        // answering "what is the name on the account" with "the name on the
        // account is maria lopez" is the caller talking, whichever side the
        // parse gave it. And the advisor reading back a number the caller has
        // just given ("okay i have your phone number as six zero two...") is
        // repeating it, not telling them anything.
        marks.forEach((mark, index) => {
            const previous = marks[index - 1];
            if (!mark.disclosure || !previous) return;
            const answeringLookup = ANSWERS_A_LOOKUP.includes(mark.disclosure.key) && previous.lookup.length;
            const readBack = mark.disclosure.key === 'onFile'
                && spokenDigits(previous.text).length >= READ_BACK_MIN_CHARS
                && spokenDigits(mark.text).includes(spokenDigits(previous.text));
            if (answeringLookup || readBack) mark.disclosure = null;
        });

        marks.forEach(mark => {
            // Identity: asked, answered, failed, settled.
            //
            // Once a check has gone through, a later question neither
            // replaces nor revokes it. On the real start service call the
            // advisor verified at 2:59 and at 14:21 asked the caller to send
            // "the driver's license" for the ID requirement; read as a fresh
            // check it became the evidence, and a caller saying they had no
            // licence would have undone a verification that had already
            // happened. Only a failure on the check that is standing counts.
            if (mark.asksIdentity) {
                identityAsks.push(event(mark, { what: mark.identityWhat }));
                if (!identity) {
                    pendingAsk = { mark, answered: false };
                    failure = null;
                }
            } else if (pendingAsk && mark.caller && mark.index > pendingAsk.mark.index) {
                const onTheStandingCheck = !identity || identity.index === pendingAsk.mark.index;
                // Once it has been answered, only a "cannot" about the thing
                // asked for undoes it. "I do not remember, maybe tuesday",
                // about when a payment was made two turns after a clean check,
                // was undoing the check.
                const undoes = !pendingAsk.answered || CANNOT_OBJECT.test(mark.text);
                if (mark.cannot && onTheStandingCheck && undoes && mark.index - pendingAsk.mark.index <= FAILURE_WINDOW) {
                    failure = event(mark);
                    identity = null;
                } else if (!pendingAsk.answered && answersCheck(mark, pendingAsk.mark)) {
                    pendingAsk.answered = true;
                    identity = event(pendingAsk.mark, { what: pendingAsk.mark.identityWhat });
                }
            }

            // "That doesn't match" comes after the answer and usually a beat
            // on the screen, so it is given longer than the answer itself.
            if (mark.noMatch && pendingAsk && mark.index - pendingAsk.mark.index <= NO_MATCH_WINDOW
                && (!identity || identity.index === pendingAsk.mark.index)) {
                failure = event(mark);
                identity = null;
            }

            if (mark.givesIdentity) {
                identity = event(mark, { what: identifierWhat(mark.text) });
                failure = null;
            }

            if (mark.ivr) {
                identity = event(mark, { what: 'the phone system' });
                failure = null;
            }

            if (mark.confirmed && pendingAsk) {
                identity = identity || event(pendingAsk.mark, { what: pendingAsk.mark.identityWhat });
                failure = null;
            }

            // Whose account it is.
            if (mark.thirdParty && !thirdParty) thirdParty = event(mark);

            if (mark.authQuestion) lastAuthQuestion = mark.index;
            if (mark.onBehalfQuestion) lastOnBehalfQuestion = mark.index;
            // A refusal is not on this list. "I can only discuss the account
            // with the account holder", followed by giving in when the caller
            // pushed, counted as having dealt with authorization.
            if (mark.authQuestion || mark.onBehalfQuestion || mark.handoff || mark.permission || mark.authOther) {
                authorizations.push(event(mark));
            }

            if (mark.affirm && lastOnBehalfQuestion !== null && mark.index > lastOnBehalfQuestion
                && mark.index - lastOnBehalfQuestion <= DENIAL_WINDOW && !thirdParty) {
                thirdParty = event(mark);
            }

            if (mark.caller && lastAuthQuestion !== null && mark.index > lastAuthQuestion
                && mark.index - lastAuthQuestion <= DENIAL_WINDOW && (mark.denial || mark.thirdParty)) {
                denial = event(mark);
                handoffAfterDenial = false;
                if (!thirdParty) thirdParty = event(mark);
            }

            if (denial && mark.index > denial.index) {
                if (mark.handoff) handoffAfterDenial = true;
                // The account holder came to the phone and was verified, gave
                // permission for this caller, or the advisor found the caller
                // listed ("no, my husband is, but i'm an authorized user").
                const foundListed = mark.advisor && SEES_CALLER_LISTED.test(mark.text);
                if (mark.permission || (handoffAfterDenial && mark.asksIdentity) || foundListed) denial = null;
            }

            if (mark.refusal && !refusal) refusal = event(mark);

            // Falling back to the address after a failed check abandons the
            // check. Without this, "okay that matches" about the address
            // brought the failed social back to life.
            if (mark.lookup.length && failure) pendingAsk = null;
            if (mark.lookup.length && !disclosures.length) {
                lookups.push(event(mark, { what: mark.lookup }));
            }

            if (mark.asksAmount) lastAmountQuestion = mark.index;
            const answersAmount = !mark.disclosure && mark.statesAmount && lastAmountQuestion !== null
                && mark.index > lastAmountQuestion && mark.index - lastAmountQuestion <= AMOUNT_WINDOW;
            const disclosure = mark.disclosure || (answersAmount ? AMOUNT_ANSWER : null);

            if (!disclosure) return;
            // The turn holding the marker counts as past the cut: the first
            // line of the kept tail is merged into it when it begins with
            // speech rather than a timestamp.
            if (cutAt >= 0 && mark.index >= cutAt) return;

            const shared = event(mark, { key: disclosure.key, what: disclosure.what });
            disclosures.push(shared);
            if (breach) return;

            const types = [];
            const verified = identity && identity.index < mark.index;
            if (!verified) types.push(failure ? 'failed' : 'unverified');

            if (thirdParty && thirdParty.index < mark.index) {
                if (denial) {
                    types.push('denied');
                } else {
                    // The caller's own line cannot settle it: "she gave me
                    // permission to call" and "i'm her power of attorney" are
                    // what the advisor then has to check, not the check.
                    const addressed = authorizations.some(step => step.index >= thirdParty.index - DENIAL_WINDOW
                        && step.index < mark.index && step.index !== thirdParty.index);
                    if (!addressed) types.push('unauthorized');
                }
            }

            if (types.length) {
                breach = {
                    ...shared,
                    types,
                    failure,
                    thirdParty,
                    denial,
                    identityBefore: verified ? identity : null
                };
            }
        });

        // Verified, but only once the detail was already out.
        if (breach && breach.types.includes('unverified')) {
            const later = identityAsks.find(ask => ask.index > breach.index);
            if (later) {
                breach.types = breach.types.map(type => (type === 'unverified' ? 'late' : type));
                breach.lateCheck = later;
            }
        }

        // A check that failed, or a caller who was not on the account, with
        // nothing shared afterwards is the right outcome, not a verified one.
        const status = breach
            ? 'breach'
            : disclosures.length
                ? 'verified'
                : (thirdParty || failure)
                    ? 'held-back'
                    : (identity || identityAsks.length)
                        ? 'verified'
                        : 'nothing-shared';

        return {
            ok: true,
            labeled,
            truncated: cutAt >= 0,
            status,
            redFlag: status === 'breach',
            verdict: status === 'breach' ? 'opportunity' : (status === 'nothing-shared' ? 'unknown' : 'met'),
            breach,
            identity: identity || (identityAsks[0] || null),
            identityAsks,
            failure,
            thirdParty,
            denial,
            refusal,
            authorizations,
            lookups,
            disclosures,
            firstDisclosure: disclosures[0] || null
        };
    }

    function readVerificationFromText(rawText, options = {}) {
        const analyzer = window.DevCoachModules?.callTranscript;
        if (!analyzer?.parseTranscript) return { ok: false, reason: 'parser-unavailable' };
        const text = String(rawText || '').trim();
        if (!text) return { ok: false, reason: 'empty' };
        return readVerification(analyzer.parseTranscript(text, options));
    }

    /* ── Saying it to the supervisor ── */

    const HEADLINES = {
        denied: 'The caller said they were not on the account, and account details were shared anyway',
        failed: 'Verification did not go through, and account details were shared anyway',
        unauthorized: 'Account details were shared with a caller who said it was not their account',
        unverified: 'Account details were shared before the caller was verified',
        late: 'Account details were shared before verification, which only came later'
    };
    const HEADLINE_ORDER = ['denied', 'failed', 'unauthorized', 'unverified', 'late'];

    // The wording used to decide, stated where the supervisor can check it.
    const POLICY_NOTE = 'Counted as verification: the last four of the social, the date of birth, a PIN or passcode, a security question, or an ID number. The name, address, account number and phone number find the account; they do not prove who is calling.';

    function atTime(item) {
        return item && item.time ? ` at ${item.time}` : '';
    }

    function lookupPhrase(lookups) {
        const named = [];
        (lookups || []).forEach(item => (item.what || []).forEach(what => {
            if (!named.includes(what)) named.push(what);
        }));
        return joinList(named);
    }

    /**
     * One or two sentences for the QA row, plus the quote that proves it.
     */
    function describe(read) {
        if (read?.reason === 'unsegmented') {
            return {
                tone: 'neutral',
                headline: 'Verification could not be read from this transcript',
                detail: 'It came through as one block, with no timestamps or speaker labels to split it into turns, so the order things were said in cannot be read. Listen for this one.',
                evidence: ''
            };
        }
        if (!read?.ok) {
            return { tone: 'neutral', headline: '', detail: 'The transcript could not be read for verification.', evidence: '' };
        }

        if (read.status === 'breach') {
            const b = read.breach;
            const primary = HEADLINE_ORDER.find(type => b.types.includes(type)) || 'unverified';
            const sentences = [];

            if (b.types.includes('failed')) {
                sentences.push(`The caller could not get through verification${atTime(b.failure)}, and ${b.what} was shared${atTime(b)} anyway.`);
            } else if (b.types.includes('late')) {
                sentences.push(`${capitalize(b.what)} was shared${atTime(b)}, and verification did not come until${b.lateCheck?.time ? ` ${b.lateCheck.time}` : ' later'}.`);
            } else if (b.types.includes('unverified')) {
                sentences.push(`${capitalize(b.what)} was shared${atTime(b)} and nothing only the account holder would know was asked for before it.`);
            }

            if (b.types.includes('denied')) {
                sentences.push(`The caller said they were not on the account${atTime(b.denial)}${b.types.length === 1 ? `, and ${b.what} was shared${atTime(b)} anyway` : ''}.`);
            } else if (b.types.includes('unauthorized')) {
                sentences.push(`The caller said it was not their account${atTime(b.thirdParty)}, and nothing was asked about being authorized on it${b.types.length === 1 ? ` before ${b.what} was shared${atTime(b)}` : ''}.`);
            }

            const looked = lookupPhrase(read.lookups.filter(item => item.index < b.index));
            if (looked && (b.types.includes('unverified') || b.types.includes('late'))) {
                sentences.push(`Asking for ${looked} finds the account but does not verify the caller.`);
            }

            return {
                tone: 'red',
                primary,
                headline: HEADLINES[primary],
                detail: sentences.join(' '),
                evidence: b.quote
            };
        }

        if (read.status === 'held-back') {
            return {
                tone: 'green',
                headline: read.thirdParty
                    ? 'The caller was not on the account, and its details were held back'
                    : 'Verification did not go through, and its details were held back',
                detail: read.thirdParty
                    ? `The caller said it was not their account${atTime(read.thirdParty)}, and nothing on it was shared.`
                    : `The caller could not verify${atTime(read.failure)}, and nothing on the account was shared.`,
                evidence: read.refusal?.quote || ''
            };
        }

        if (read.status === 'verified') {
            const check = read.identity;
            const shared = read.firstDisclosure;
            const how = check?.what ? ` with ${check.what}` : '';
            return {
                tone: 'green',
                headline: 'Caller verified before any account details were shared',
                detail: shared
                    ? `Verified${atTime(check)}${how}, before ${shared.what} was shared${atTime(shared)}.`
                    : `Verified${atTime(check)}${how}, and nothing on the account was shared before that.`,
                evidence: check?.quote || ''
            };
        }

        return {
            tone: 'neutral',
            headline: 'No account details were heard going out',
            detail: 'No account details were heard going out, so there was nothing to verify for. Worth an ear if this was an account call.',
            evidence: ''
        };
    }

    /**
     * The moments behind the verdict, in call order, for the red box.
     */
    function buildTimeline(read) {
        if (!read?.ok || read.status !== 'breach') return [];
        const b = read.breach;
        const rows = [];

        const looked = (read.lookups || []).filter(item => item.index < b.index).slice(0, 2);
        looked.forEach(item => rows.push({
            index: item.index,
            time: item.time,
            text: `Asked for ${joinList(item.what)}. That finds the account, it does not verify the caller.`,
            quote: item.quote
        }));

        if (b.thirdParty) {
            rows.push({ index: b.thirdParty.index, time: b.thirdParty.time, text: 'The caller said it was somebody else\'s account.', quote: b.thirdParty.quote });
        }
        if (b.denial && b.denial.index !== b.thirdParty?.index) {
            rows.push({ index: b.denial.index, time: b.denial.time, text: 'The caller said they were not on the account.', quote: b.denial.quote });
        }

        const asked = (read.identityAsks || []).filter(ask => ask.index < b.index);
        if (asked.length) {
            const last = asked[asked.length - 1];
            rows.push({ index: last.index, time: last.time, text: `Asked for ${last.what}.`, quote: last.quote });
        }
        if (b.failure) {
            rows.push({ index: b.failure.index, time: b.failure.time, text: 'The check did not go through.', quote: b.failure.quote });
        }

        rows.push({ index: b.index, time: b.time, text: `Shared ${b.what}.`, quote: b.quote });

        if (b.lateCheck) {
            rows.push({ index: b.lateCheck.index, time: b.lateCheck.time, text: `Asked for ${b.lateCheck.what}, after the fact.`, quote: b.lateCheck.quote });
        } else if (!asked.length && (b.types.includes('unverified'))) {
            rows.push({ index: Infinity, time: '', text: 'No identity check anywhere on the call.', quote: '' });
        }

        return rows.sort((a, b2) => a.index - b2.index);
    }

    function caveatFor(read) {
        if (!read?.ok || read.labeled) return '';
        const moment = read.breach?.time ? ` Listen at ${read.breach.time} before you act on it.` : ' Listen to the call before you act on it.';
        return `Speakers were worked out from the flow of the call, not from labels.${moment}`;
    }

    /**
     * The red box, or a single quiet line when nothing is wrong.
     */
    function buildAlertHtml(read, escapeHtml) {
        const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        const said = describe(read);
        if (!read?.ok && !said.headline) return '';

        if (said.tone !== 'red') {
            const icon = said.tone === 'green' ? '✅' : 'ℹ️';
            const detail = said.tone === 'green' || !read?.ok
                ? said.detail
                : 'Nothing to verify for, as far as the transcript shows.';
            return `<div class="call-alert call-alert-${said.tone === 'green' ? 'ok' : 'quiet'}">
                <strong>${icon} ${safe(said.headline)}.</strong> <span>${safe(detail)}</span>
            </div>`;
        }

        const rows = buildTimeline(read).map(row => `<li>
                ${row.time ? `<span class="call-alert-time">${safe(row.time)}</span>` : ''}
                <span>${safe(row.text)}</span>
                ${row.quote ? `<div class="call-alert-quote">"${safe(row.quote)}"</div>` : ''}
            </li>`).join('');
        const caveat = caveatFor(read);

        return `<div class="call-alert call-alert-red" role="alert">
            <div class="call-alert-title">🚩 ${safe(said.headline)}</div>
            <div class="call-alert-detail">${safe(said.detail)}</div>
            ${rows ? `<ol class="call-alert-timeline">${rows}</ol>` : ''}
            ${caveat ? `<div class="call-alert-note">${safe(caveat)}</div>` : ''}
            <div class="call-alert-note">${safe(POLICY_NOTE)}</div>
        </div>`;
    }

    /**
     * Plain text of the same, for the Verint note and anything copied out.
     */
    function buildAlertText(read) {
        if (!read?.ok || read.status !== 'breach') return '';
        const said = describe(read);
        const lines = [`RED FLAG: ${said.headline}.`, said.detail];
        buildTimeline(read).forEach(row => {
            lines.push(`- ${row.time ? `${row.time} ` : ''}${row.text}${row.quote ? ` ("${row.quote}")` : ''}`);
        });
        const caveat = caveatFor(read);
        if (caveat) lines.push(caveat);
        return lines.join('\n');
    }

    /* ── Saying it to the associate ──
     *
     * Second person, plain, and about what to do. These go into an email with
     * the supervisor's name on it, so they follow the coaching voice rules:
     * no form vocabulary, no label in front, nothing that assumes one call.
     */
    const COACHING = {
        unverified: (what) => `You shared ${what} before verifying who you were talking to. An address or an account number finds the account, but it does not prove the caller is the account holder. Verify first, every time, before anything on the account comes up.`,
        late: (what) => `You did verify, but only after ${what} had already been shared. Verification has to come first, before anything on the account comes up.`,
        failed: (what) => `The caller could not get through verification and you shared ${what} anyway. When verification does not go through, nothing on the account gets shared: ask for another way to verify, or help with what does not touch the account.`,
        unauthorized: (what) => `The caller said the account belonged to someone else, and you shared ${what} without checking they were authorized on it. When somebody calls about another person's account, confirm they are authorized before anything on it is shared.`,
        denied: (what) => `The caller told you they were not on the account, and you shared ${what} anyway. Nothing on an account goes to somebody who is not authorized on it, however reasonable the request sounds.`
    };
    const COACHING_ORDER = ['denied', 'failed', 'unauthorized', 'unverified', 'late'];

    // Heavier than anything else the engine can say, so it leads the draft
    // and is never the one trimmed to keep the email short.
    const RED_FLAG_WEIGHT = 20;

    function coachingFor(read) {
        if (!read?.ok || read.status !== 'breach') return null;
        const b = read.breach;
        const type = COACHING_ORDER.find(item => b.types.includes(item)) || 'unverified';

        // Somebody else's account AND no verification is two separate
        // failures. The first in COACHING_ORDER leads; the other still has to
        // be said, or it reads as though it would not have mattered.
        const AUTHORITY = ['denied', 'unauthorized'];
        const IDENTITY = ['failed', 'unverified', 'late'];
        let text = COACHING[type](b.what);
        if (AUTHORITY.includes(type) && b.types.some(item => IDENTITY.includes(item))) {
            text += ' Verification comes first as well, every time, before anything on the account comes up.';
        } else if (IDENTITY.includes(type) && b.types.some(item => AUTHORITY.includes(item))) {
            text += ' And when it is somebody else\'s account, they need to be authorized on it before anything is shared.';
        }

        return {
            key: 'verification',
            weight: RED_FLAG_WEIGHT,
            severity: 'red',
            text,
            quote: b.quote
        };
    }

    function praiseFor(read) {
        if (!read?.ok) return null;
        // Praised only when the advisor was heard saying no. Nothing shared
        // on its own may just be a call that never needed the account.
        if (read.status === 'held-back' && read.refusal) {
            return {
                key: 'verification',
                praise: 9,
                text: read.thirdParty
                    ? 'The caller was not on the account and you kept its details back. That is exactly right, even when it is not what they wanted to hear.'
                    : 'Verification did not go through and you kept the account details back. That is exactly right, even when it is not what they wanted to hear.',
                quote: read.refusal.quote || ''
            };
        }
        if (read.status === 'verified' && read.identity) {
            return {
                key: 'verification',
                praise: 7,
                text: 'You confirmed who you were talking to before anything on the account came up. That is the one that protects everybody.',
                quote: read.identity.quote || ''
            };
        }
        return null;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callVerification = {
        readVerification,
        readVerificationFromText,
        describe,
        buildTimeline,
        buildAlertHtml,
        buildAlertText,
        coachingFor,
        praiseFor,
        POLICY_NOTE,
        RED_FLAG_WEIGHT,
        // Exported for the tests, which pin what each list does and does not
        // accept.
        IDENTITY_ASK,
        DISCLOSURES,
        THIRD_PARTY
    };
})();
