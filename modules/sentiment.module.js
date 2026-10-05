/**
 * Sentiment & Language Summary Engine Module
 * Handles sentiment analysis, phrase databases, file parsing, and summary generation.
 */
(function() {
    'use strict';

    const SENTIMENT_DEBUG = false;
    const debugLog = SENTIMENT_DEBUG ? console.log.bind(console) : () => {};

    // The positive list is Verint's query text as Scott exported it (10/05),
    // in Verint's order, with the operators kept. It used to be stored with
    // NEAR flattened out, so "how NEAR help" became the literal phrase "how
    // help", which nobody says: "How can I help you?" never scored, and an
    // associate who said "Have a wonderful day" could be told she never said
    // "have wonderful". NEAR means both terms within a few words of each
    // other; [END:100] means the phrase only counts in the last 100 seconds
    // of the call.
    const DEFAULT_SENTIMENT_PHRASE_DATABASE = {
        positive: {
            A: [
                'have NEAR wonderful', 'my pleasure', '"thank you" NEAR being', 'questions or concerns',
                'what NEAR can', '"thank you" NEAR part', 'do NEAR "for you"', '"I can" NEAR help',
                "don't NEAR worry", 'what i can do', 'can NEAR definitely', 'what we can do',
                'how NEAR help', 'absolutely', 'anything else', 'taken NEAR care', 'work NEAR you',
                '"anything else" NEAR you', '"anything else" NEAR help', 'you got it', 'happy to',
                'of course', 'no problem', 'happy NEAR help', 'take NEAR time', 'enjoy', 'certainly',
                'here NEAR help', '"take care" NEAR "for you"', 'took NEAR care', 'happy NEAR assist',
                'glad to', 'perfectly', '"anything else" NEAR do', "let's make sure",
                'answered NEAR questions', "let's get", 'a pleasure', 'congratulations',
                'wish NEAR best', '[END:100] lovely', 'being NEAR customer', 'you bet',
                'appreciate NEAR business'
            ],
            C: [
                '[END:100] really appreciate', '[END:100] very NEAR helpful', "[END:100] you've NEAR been"
            ]
        },
        // Verint's export (10/05), operators kept. NOTIN matters most here:
        // "we NEAR can't NOTIN \"what we can't\"" flags "we can't do that"
        // and leaves "here's what we can't change, and here's what we can".
        negative: {
            A: [
                '"like i" NEAR said', `we don't have NOTIN "we don't have to"`, 'no NEAR way',
                `we NEAR can't NOTIN "what we can't"`, 'yes NEAR but', `"i can't" NEAR do NOTIN "what i can't do"`,
                'nothing NEAR do NOTIN "nothing do"', '"I understand" NEAR but', "don't do that", 'sorry but',
                'you need to go NOTIN "need to go over"', 'no notes', `"i can't" NEAR give`, 'unfortunately',
                `"i can't" NEAR see`, 'not sure', 'an error', 'unable NEAR help', 'trying NEAR help', 'any notes',
                `"i can't" NEAR find`, 'our policy', `"i can't" NEAR tell`, "can't NEAR provide",
                'not my problem', 'sorry NEAR feel'
            ],
            C: [
                'you NEAR understand', "i don't care", "you don't care", 'not NEAR listening', 'let NEAR finish',
                'not NEAR helping', 'not helping'
            ]
        },
        // Verint tags a phrase C for the customer only and A for the associate
        // only; a phrase with no tag counts from EITHER side (Scott, 10/05).
        // Most of this list is untagged, so "complaint", "that's horrible" or
        // "I can't believe that happened" from the associate flags the call
        // too. E holds those. The list used to be stored as customer-only.
        emotions: {
            A: [],
            C: [
                'your company', 'frustrated', 'not happy', 'frustrating', 'seriously',
                'your fault NOTIN "not your fault"', 'unacceptable', "you don't care", 'really upset',
                'this NEAR "B S"', 'kill myself'
            ],
            E: [
                'ridiculous', 'screwed', "can't NEAR believe", 'fucking', 'you people', 'complaint', 'bullshit',
                "i can't believe", 'stupid', 'not my fault', 'what NEAR hell', 'horrible', 'our fault',
                'pissed off', 'fuck you', 'cannot NEAR believe', 'totally unacceptable', 'very unhappy',
                'not NEAR "good enough"', 'wasting NEAR "my time"', 'Monopoly', "i'm NEAR angry",
                'threatening', 'stupidity'
            ]
        }
    };

    // The emotions list as it shipped before 10/05, all of it filed as
    // customer-only and with "bull shit" as two words, which never matched.
    // A stored list that is exactly this one was never edited, so it is
    // replaced outright rather than patched phrase by phrase.
    const LEGACY_SHIPPED_EMOTIONS = [
        'frustrated', 'your company', 'frustrating', 'ridiculous', 'really upset', 'you people',
        'what NEAR hell', 'fuck you', 'not my fault', 'horrible', 'wasting NEAR "my time"', `this NEAR "B'S"`,
        'screwed', "you don't care", 'our fault', 'stupid', 'complaint', 'totally unacceptable',
        "can't NEAR believe", 'very unhappy', 'your fault NOTIN "not your fault"', 'not NEAR "good enough"',
        'cannot NEAR believe', 'not happy', 'seriously', 'pissed off', 'unacceptable', 'fucking',
        'kill myself', 'Monopoly', 'bull shit', "i'm NEAR angry"
    ];

    /**
     * The words of a Verint query with the operators taken off, lower case and
     * punctuation flattened: "\"thank you\" NEAR being" and the old flattened
     * "thank you being" both read "thank you being". That shared form is what
     * ties a stored phrase to its example and to its upgraded spelling.
     */
    function phrasePlainWords(raw) {
        return normalizePhraseForMatch(String(raw || '')
            .replace(/\[(?:END|START):\d+\]/gi, ' ')
            .replace(/\bNOTIN\b\s*(?:"[^"]*"|'[^']*'|\S+)/gi, ' ')
            .replace(/\bNEAR\b/g, ' '));
    }

    /**
     * Something natural to say for each scored positive phrase.
     *
     * A query is not a sentence: "have NEAR wonderful" is what Verint listens
     * for, "Have a wonderful day" is what the associate says. Coaching quotes
     * the sentence. These are not a second lexicon, nothing is scored off
     * them; each one is an example of its own query, and the tests run every
     * example through the matcher to prove it would score.
     */
    const POSITIVE_PHRASE_EXAMPLES = {
        'have wonderful': 'Have a wonderful day',
        'my pleasure': 'My pleasure',
        'thank you being': 'Thank you for being so patient',
        'questions or concerns': 'Do you have any other questions or concerns?',
        'what can': 'What can I help you with today?',
        'thank you part': 'Thank you for being a part of APS',
        'do for you': 'What else can I do for you?',
        'i can help': 'I can help you with that',
        'don t worry': "Don't worry, I'll walk you through it",
        'what i can do': 'Let me see what I can do',
        'can definitely': 'I can definitely do that for you',
        'what we can do': "Here's what we can do",
        'how help': 'How can I help you today?',
        'absolutely': 'Absolutely',
        'anything else': 'Is there anything else?',
        'taken care': "That's all taken care of",
        'work you': 'I can work with you on that',
        'anything else you': 'Is there anything else you need today?',
        'anything else help': 'Is there anything else I can help you with?',
        'you got it': 'You got it',
        'happy to': "I'm happy to look into that",
        'of course': 'Of course',
        'no problem': 'No problem at all',
        'happy help': "I'd be happy to help with that",
        'take time': 'Take your time',
        'enjoy': 'Enjoy the rest of your day',
        'certainly': 'Certainly',
        'here help': "I'm here to help",
        'take care for you': "I'll take care of that for you",
        'took care': 'I took care of that for you',
        'happy assist': 'Happy to assist',
        'glad to': 'Glad to help',
        'perfectly': 'That works perfectly',
        'anything else do': 'Is there anything else I can do?',
        'let s make sure': "Let's make sure everything is set",
        'answered questions': 'Have I answered your questions?',
        'let s get': "Let's get that set up for you",
        'a pleasure': 'It was a pleasure helping you',
        'congratulations': 'Congratulations on the new home',
        'wish best': 'I wish you all the best',
        'lovely': 'Have a lovely day',
        'being customer': 'Thank you for being an APS customer',
        'you bet': 'You bet',
        'appreciate business': 'We appreciate your business'
    };

    function examplePhraseFor(raw) {
        return POSITIVE_PHRASE_EXAMPLES[phrasePlainWords(raw)] || '';
    }

    /**
     * Brings a stored phrase list up to the shipped one, without touching
     * anything the supervisor chose.
     *
     * Two repairs, both only ever to a list that never had a real edit in it:
     * a list with no phrases at all is given the shipped lists (the stored copy
     * had been saved as empty buckets, so Settings showed nothing and the
     * defaults never came back), and a phrase stored in the old flattened
     * spelling ("how help") is swapped for the Verint query it came from
     * ("how NEAR help"). A phrase the supervisor added is left exactly as is.
     *
     * A bucket that is the shipped list in an older spelling, nothing added
     * and nothing taken away, is replaced whole: that is how the duplicate
     * "not helping" becomes Verint's pair of "not NEAR helping" and "not
     * helping", and how the old customer-only emotions list is split into
     * customer-only and either-side.
     */
    const PHRASE_BUCKETS = [
        ['positive', 'A'], ['positive', 'C'], ['negative', 'A'], ['negative', 'C'],
        ['emotions', 'A'], ['emotions', 'C'], ['emotions', 'E']
    ];

    function upgradePhraseDatabase(stored) {
        const clone = (value) => JSON.parse(JSON.stringify(value));
        const shippedDb = DEFAULT_SENTIMENT_PHRASE_DATABASE;
        if (!stored || typeof stored !== 'object') return { db: clone(shippedDb), changed: true };

        const total = PHRASE_BUCKETS.reduce((sum, [kind, side]) => {
            const list = stored[kind]?.[side];
            return sum + (Array.isArray(list) ? list.length : 0);
        }, 0);
        if (total === 0) return { db: clone(shippedDb), changed: true };

        const hasSyntax = (phrase) => /\bNEAR\b|\bNOTIN\b|\[(?:END|START):\d+\]/.test(String(phrase || ''));
        const wordSet = (list) => new Set(list.map(phrasePlainWords));
        const sameWords = (a, b) => {
            const left = wordSet(a);
            const right = wordSet(b);
            return left.size === right.size && [...left].every(words => right.has(words));
        };

        let changed = false;
        const db = clone(stored);

        // Emotions were one customer-only list until Verint's tags were read.
        db.emotions = db.emotions && typeof db.emotions === 'object' ? db.emotions : {};
        if (!Array.isArray(db.emotions.E)) {
            const before = Array.isArray(db.emotions.C) ? db.emotions.C : [];
            if (sameWords(before, LEGACY_SHIPPED_EMOTIONS)) {
                db.emotions = clone(shippedDb.emotions);
            } else {
                // Edited before the split: each phrase goes where Verint files it.
                const eitherSide = wordSet(shippedDb.emotions.E);
                db.emotions.E = before.filter(phrase => eitherSide.has(phrasePlainWords(phrase)));
                db.emotions.C = before.filter(phrase => !eitherSide.has(phrasePlainWords(phrase)));
            }
            changed = true;
        }
        if (!Array.isArray(db.emotions.A)) {
            db.emotions.A = [];
            changed = true;
        }

        PHRASE_BUCKETS.forEach(([kind, side]) => {
            const list = db[kind]?.[side];
            const shipped = shippedDb[kind]?.[side] || [];
            if (!Array.isArray(list) || !list.length || !shipped.length) return;

            const identical = list.length === shipped.length && list.every((phrase, i) => phrase === shipped[i]);
            if (identical) return;
            if (sameWords(list, shipped)) {
                db[kind][side] = shipped.slice();
                changed = true;
                return;
            }

            const byWords = new Map();
            shipped.forEach(phrase => {
                const words = phrasePlainWords(phrase);
                if (!byWords.has(words)) byWords.set(words, []);
                byWords.get(words).push(phrase);
            });
            const taken = new Set();
            db[kind][side] = list.map(phrase => {
                // Already carries Verint syntax, so it is a query, not a flattening.
                if (hasSyntax(phrase)) {
                    taken.add(phrase);
                    return phrase;
                }
                const options = byWords.get(phrasePlainWords(phrase)) || [];
                if (options.includes(phrase) && !taken.has(phrase)) {
                    taken.add(phrase);
                    return phrase;
                }
                const next = options.find(option => !taken.has(option));
                if (!next || next === phrase) return phrase;
                taken.add(next);
                changed = true;
                return next;
            });
        });
        return { db, changed };
    }

    /**
     * One line of a phrase box, in any of the shapes it arrives in:
     *
     *   have NEAR wonderful                  typed by hand
     *   A: happy to                          tagged by speaker
     *   +(A:"have" NEAR "wonderful")         pasted straight from Verint
     *   +([END:100]C:"very" NEAR "helpful")  Verint, with a position rule
     *
     * NEAR and the position rule are kept, because they are the query: drop
     * them and "have NEAR wonderful" becomes "have wonderful", which nobody
     * says. Returns the speaker the line was tagged with, if any, so a C line
     * pasted into an A box can be moved to the C list.
     */
    function parsePhraseLine(line) {
        // Rows copied out of the Verint spreadsheet bring the count column.
        let text = String(line || '').trim().replace(/(?:\t|,)\s*\d+\s*$/, '').trim();
        if (!/[a-z0-9]/i.test(text)) return null;

        text = text.replace(/^[+\-#]+\s*/, '').trim();
        const wrapped = text.match(/^\((.*)\)$/);
        if (wrapped) text = wrapped[1].trim();

        let position = '';
        let speaker = null;
        const takePosition = () => {
            const match = text.match(/^\[(END|START):(\d+)\]\s*/i);
            if (!match) return;
            position = `[${match[1].toUpperCase()}:${match[2]}] `;
            text = text.slice(match[0].length);
        };
        takePosition();
        const tag = text.match(/^([AC]):\s*/i);
        if (tag) {
            speaker = tag[1].toUpperCase();
            text = text.slice(tag[0].length);
        }
        takePosition();

        // An exclusion keeps its quotes; it is matched as written.
        let exclusion = '';
        const notin = text.match(/\s+NOTIN\s+(.+)$/i);
        if (notin) {
            exclusion = ` NOTIN ${notin[1].trim()}`;
            text = text.slice(0, notin.index);
        }

        const terms = text
            .split(/\s+NEAR\s+/i)
            .map(term => term.trim().replace(/^["']+|["']+$/g, '').trim())
            .filter(Boolean);
        if (!terms.length || !terms.some(term => /[a-z0-9]/i.test(term))) return null;

        // A lone phrase needs no quotes. Between NEARs, a term of more than
        // one word is quoted so it reads as one term.
        const query = terms.length === 1
            ? terms[0]
            : terms.map(term => (/\s/.test(term) ? `"${term}"` : term)).join(' NEAR ');

        return { speaker, phrase: `${position}${query}${exclusion}` };
    }

    function parsePhraseLines(textValue) {
        const lines = String(textValue || '').split('\n');
        // A pasted Verint export arrives inside an email, with the subject,
        // the signature and the legal footer around it. When any line has the
        // Verint shape, only those lines are phrases. The shape is a "+(...)"
        // line, tagged or not, or a bare "A:" / "C:" line: Verint writes a few
        // without the wrapper (A:"not sure", C:seriously).
        // Only the wrapped shape says "this is an export"; a hand-typed list
        // can carry "A: of course" next to untagged lines.
        const wrappedShape = /^[+\-#]\s*\(.*\)$|^\(\s*(?:\[(?:END|START):\d+\]\s*)?[AC]:.*\)$/i;
        const bareTagged = /^(?:\[(?:END|START):\d+\]\s*)?[AC]:\s*\S/i;
        const shapeOf = (line) => String(line || '').trim().replace(/(?:\t|,)\s*\d+\s*$/, '').trim();
        const exported = lines.some(line => wrappedShape.test(shapeOf(line)));
        return lines
            .filter(line => !exported || wrappedShape.test(shapeOf(line)) || bareTagged.test(shapeOf(line)))
            .map(parsePhraseLine)
            .filter(Boolean);
    }

    function normalizePhraseList(textValue) {
        if (!textValue) return [];
        return Array.from(new Set(parsePhraseLines(textValue).map(item => item.phrase)));
    }

    function normalizePhraseForMatch(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatKeywordPhraseForDisplay(value) {
        let phrase = String(value || '').trim();
        if (!phrase) return '';

        phrase = phrase
            .replace(/\bNOTIN\b\s*"[^"]*"/gi, '')
            .replace(/\bNOTIN\b\s*'[^']*'/gi, '')
            .replace(/\bNOTIN\b\s*[^\s]+/gi, '')
            .replace(/\bNEAR\b/gi, ' ... ')
            .replace(/\s+/g, ' ')
            .trim();

        return phrase;
    }

    function normalizeDateStringForStorage(dateString) {
        if (!dateString) return '';

        if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            return dateString;
        }

        const slashMatch = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (slashMatch) {
            const month = slashMatch[1].padStart(2, '0');
            const day = slashMatch[2].padStart(2, '0');
            let year = slashMatch[3];
            if (year.length === 2) {
                year = year >= '70' ? `19${year}` : `20${year}`;
            }
            return `${year}-${month}-${day}`;
        }

        const parsed = new Date(dateString);
        if (!Number.isNaN(parsed.getTime())) {
            const fn = window.DevCoachModules?.sharedUtils?.formatLocalDate;
            return typeof fn === 'function' ? fn(parsed) : parsed.toISOString().split('T')[0];
        }

        return '';
    }

    function parseDateForComparison(dateString) {
        const normalized = normalizeDateStringForStorage(dateString);
        if (!normalized) return null;
        const parsed = new Date(`${normalized}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function ensureSentimentPhraseDatabaseDefaults() {
        // Writes only when the upgrade changed something, so a list that is
        // already current never dirties the store at boot.
        const upgraded = upgradePhraseDatabase(sentimentPhraseDatabase);
        if (upgraded.changed) {
            sentimentPhraseDatabase = upgraded.db;
            saveSentimentPhraseDatabase();
            return;
        }

        sentimentPhraseDatabase.positive = sentimentPhraseDatabase.positive || { A: [], C: [] };
        sentimentPhraseDatabase.negative = sentimentPhraseDatabase.negative || { A: [], C: [] };
        sentimentPhraseDatabase.emotions = sentimentPhraseDatabase.emotions || { A: [], C: [], E: [] };
        sentimentPhraseDatabase.positive.A = Array.isArray(sentimentPhraseDatabase.positive.A) ? sentimentPhraseDatabase.positive.A : [];
        sentimentPhraseDatabase.positive.C = Array.isArray(sentimentPhraseDatabase.positive.C) ? sentimentPhraseDatabase.positive.C : [];
        sentimentPhraseDatabase.negative.A = Array.isArray(sentimentPhraseDatabase.negative.A) ? sentimentPhraseDatabase.negative.A : [];
        sentimentPhraseDatabase.negative.C = Array.isArray(sentimentPhraseDatabase.negative.C) ? sentimentPhraseDatabase.negative.C : [];
        sentimentPhraseDatabase.emotions.A = Array.isArray(sentimentPhraseDatabase.emotions.A) ? sentimentPhraseDatabase.emotions.A : [];
        sentimentPhraseDatabase.emotions.C = Array.isArray(sentimentPhraseDatabase.emotions.C) ? sentimentPhraseDatabase.emotions.C : [];
        sentimentPhraseDatabase.emotions.E = Array.isArray(sentimentPhraseDatabase.emotions.E) ? sentimentPhraseDatabase.emotions.E : [];
    }

    function countPhrases(db) {
        return PHRASE_BUCKETS.reduce((sum, [kind, side]) => sum + (db?.[kind]?.[side]?.length || 0), 0);
    }

    // The emotions box holds all three sides, so each line says whose it is,
    // the way Verint writes it: "C:" customer only, "A:" associate only, no
    // tag for either.
    function emotionsBoxText(emotions) {
        return [
            ...(emotions?.C || []).map(phrase => `C: ${phrase}`),
            ...(emotions?.A || []).map(phrase => `A: ${phrase}`),
            ...(emotions?.E || [])
        ].join('\n');
    }

    /**
     * The phrase lists, for anything that needs to match them against speech.
     *
     * Returns the supervisor's edited lists when there are any and the shipped
     * defaults otherwise, so a caller never has to know which it got. The
     * `typeof` guard is there because the live database is a script.js global:
     * a module loaded on its own, as the tests do, would throw on the bare name.
     */
    function getPhraseDatabase() {
        const live = typeof sentimentPhraseDatabase !== 'undefined' ? sentimentPhraseDatabase : null;
        const hasLists = live && typeof live === 'object' && countPhrases(live) > 0;
        return hasLists ? live : JSON.parse(JSON.stringify(DEFAULT_SENTIMENT_PHRASE_DATABASE));
    }

    function renderSentimentDatabasePanel() {
        ensureSentimentPhraseDatabaseDefaults();

        const positiveA = document.getElementById('phraseDbPositiveA');
        const positiveC = document.getElementById('phraseDbPositiveC');
        const negativeA = document.getElementById('phraseDbNegativeA');
        const negativeC = document.getElementById('phraseDbNegativeC');
        const emotionsC = document.getElementById('phraseDbEmotionsC');
        const status = document.getElementById('phraseDbStatus');
        const snapshotStatus = document.getElementById('associateSnapshotStatus');

        if (!positiveA || !positiveC || !negativeA || !negativeC || !emotionsC) {
            return;
        }

        positiveA.value = (sentimentPhraseDatabase.positive?.A || []).join('\n');
        positiveC.value = (sentimentPhraseDatabase.positive?.C || []).join('\n');
        negativeA.value = (sentimentPhraseDatabase.negative?.A || []).join('\n');
        negativeC.value = (sentimentPhraseDatabase.negative?.C || []).join('\n');
        emotionsC.value = emotionsBoxText(sentimentPhraseDatabase.emotions);

        const totalCount = countPhrases(sentimentPhraseDatabase);

        if (status) {
            status.textContent = `Saved phrase database: ${totalCount} phrases total.`;
        }

        if (snapshotStatus) {
            const totalSnapshots = Object.values(associateSentimentSnapshots || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
            snapshotStatus.textContent = totalSnapshots > 0
                ? `Saved associate snapshots: ${totalSnapshots}`
                : 'No associate snapshot saved yet.';
        }
    }

    function saveSentimentPhraseDatabaseFromForm() {
        const positiveA = document.getElementById('phraseDbPositiveA');
        const positiveC = document.getElementById('phraseDbPositiveC');
        const negativeA = document.getElementById('phraseDbNegativeA');
        const negativeC = document.getElementById('phraseDbNegativeC');
        const emotionsC = document.getElementById('phraseDbEmotionsC');

        if (!positiveA || !positiveC || !negativeA || !negativeC || !emotionsC) {
            return;
        }

        // A pasted Verint export carries its own A and C tags, and a whole
        // export usually lands in one box. Each line goes to the side it is
        // tagged with; an untagged line stays in the box it was typed in.
        const sides = (boxA, boxC) => {
            const out = { A: new Set(), C: new Set() };
            parsePhraseLines(boxA.value).forEach(item => out[item.speaker || 'A'].add(item.phrase));
            parsePhraseLines(boxC.value).forEach(item => out[item.speaker || 'C'].add(item.phrase));
            return { A: Array.from(out.A), C: Array.from(out.C) };
        };

        const emotions = { A: new Set(), C: new Set(), E: new Set() };
        parsePhraseLines(emotionsC.value).forEach(item => emotions[item.speaker || 'E'].add(item.phrase));

        sentimentPhraseDatabase = {
            positive: sides(positiveA, positiveC),
            negative: sides(negativeA, negativeC),
            emotions: { A: Array.from(emotions.A), C: Array.from(emotions.C), E: Array.from(emotions.E) },
            updatedAt: new Date().toISOString()
        };

        saveSentimentPhraseDatabase();
        renderSentimentDatabasePanel();
        showToast('✅ Sentiment phrase database saved', 2500);
    }

    function syncSentimentSnapshotDateInputsFromReports() {
        const startInput = document.getElementById('sentimentSnapshotStart');
        const endInput = document.getElementById('sentimentSnapshotEnd');
        if (!startInput || !endInput) return;

        const positive = sentimentReports.positive;
        if (!positive) return;

        const start = normalizeDateStringForStorage(positive.startDate);
        const end = normalizeDateStringForStorage(positive.endDate);

        if (start && !startInput.value) startInput.value = start;
        if (end && !endInput.value) endInput.value = end;
    }

    function formatSentimentSnapshotForPrompt(snapshotData, startDate, endDate) {
        /**
         * Convert sentiment snapshot data to prompt-compatible format.
         * Supports phrases-only uploads (no percentages/calls) and legacy data.
         */
        if (!snapshotData) return null;

        const existingScores = snapshotData.scores || null;
        const fallbackScores = {
            positiveWord: snapshotData.positive?.percentage || 0,
            negativeWord: snapshotData.negative?.percentage || 0,
            managingEmotions: snapshotData.emotions?.percentage || 0
        };

        const formatted = {
            timeframeStart: startDate,
            timeframeEnd: endDate,
            scores: existingScores || fallbackScores,
            calls: snapshotData.calls || {
                positiveTotal: snapshotData.positive?.totalCalls || 0,
                positiveDetected: snapshotData.positive?.callsDetected || 0,
                negativeTotal: snapshotData.negative?.totalCalls || 0,
                negativeDetected: snapshotData.negative?.callsDetected || 0,
                emotionsTotal: snapshotData.emotions?.totalCalls || 0,
                emotionsDetected: snapshotData.emotions?.callsDetected || 0
            },
            topPhrases: snapshotData.topPhrases || {
                positiveA: (snapshotData.positive?.phrases || []).map(p => ({ phrase: p.phrase, value: p.value, speaker: p.speaker || 'A' })),
                negativeA: (snapshotData.negative?.phrases || []).map(p => ({ phrase: p.phrase, value: p.value, speaker: p.speaker || 'A' })),
                negativeC: (snapshotData.negative?.phrases || []).filter(p => p.speaker === 'C').map(p => ({ phrase: p.phrase, value: p.value, speaker: 'C' })),
                emotions: (snapshotData.emotions?.phrases || []).map(p => ({ phrase: p.phrase, value: p.value, speaker: p.speaker || 'C' }))
            },
            // Left empty rather than padded: the focus builder fills it from
            // the scored list. The padding it used to carry ("collaborative
            // phrasing", "I appreciate") was not on the list and scored nothing.
            suggestions: snapshotData.suggestions || {}
        };

        return formatted;
    }

    // In place of a negative phrase, the scored phrases that say what CAN be
    // done, which is exactly what "we can't", "unable help" and "our policy"
    // leave out.
    const NEGATIVE_SWAP_WORDS = ['what i can do', 'what we can do', 'can definitely'];

    function quotedExamples(phrases, count) {
        const seen = new Set();
        return (phrases || [])
            .map(phrase => examplePhraseFor(phrase) || formatKeywordPhraseForDisplay(phrase))
            .filter(text => text && !seen.has(text) && seen.add(text))
            .slice(0, count)
            .map(text => `"${text}"`)
            .join(', ');
    }

    function positiveAdditionsFor(snapshot) {
        const stored = snapshot?.suggestions?.positiveAdditions;
        if (Array.isArray(stored) && stored.length) return stored;
        const used = new Set((snapshot?.topPhrases?.positiveA || []).map(item => phrasePlainWords(item.phrase)));
        return (getPhraseDatabase().positive?.A || []).filter(phrase => !used.has(phrasePlainWords(phrase)));
    }

    function negativeSwapsFor(snapshot) {
        const stored = snapshot?.suggestions?.negativeAlternatives;
        if (Array.isArray(stored) && stored.length) return stored;
        const list = getPhraseDatabase().positive?.A || [];
        return NEGATIVE_SWAP_WORDS
            .map(words => list.find(phrase => phrasePlainWords(phrase) === words))
            .filter(Boolean);
    }

    function buildSentimentFocusAreasForPrompt(snapshot, weeklyMetrics = null) {
        if (!snapshot) return '';

        const negativeTarget = METRICS_REGISTRY.negativeWord?.target?.value || 83;
        const positiveTarget = METRICS_REGISTRY.positiveWord?.target?.value || 86;
        const emotionsTarget = METRICS_REGISTRY.managingEmotions?.target?.value || 95;

        const hasScoreData = snapshot.scores && Object.values(snapshot.scores).some(value => Number(value) > 0);
        const scoreSource = weeklyMetrics || (hasScoreData ? snapshot.scores : null);

        const focusLines = [];

        if (!scoreSource) {
            const topPos = (snapshot.topPhrases?.positiveA || []).slice(0, 3)
                .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
                .join(', ');
            const topNeg = (snapshot.topPhrases?.negativeA || []).slice(0, 3)
                .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
                .join(', ');
            const cues = (snapshot.topPhrases?.emotions || []).slice(0, 3)
                .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
                .join(', ');

            if (topPos) focusLines.push(`Positive keywords used: ${topPos}.`);
            if (topNeg) focusLines.push(`Negative keywords used: ${topNeg}.`);
            if (cues) focusLines.push(`Customer emotion cues heard: ${cues}.`);

            return focusLines.length > 0
                ? focusLines.join('\n')
                : 'Sentiment keyword report available, but no frequent phrases were captured.';
        }

        const negScore = Number(scoreSource.negativeWord || 0);
        const posScore = Number(scoreSource.positiveWord || 0);
        const emoScore = Number(scoreSource.managingEmotions || 0);

        if (negScore < negativeTarget) {
            const usingNegative = 100 - negScore;
            const usingNegativeTarget = 100 - negativeTarget;
            const topNeg = (snapshot.topPhrases?.negativeA || []).slice(0, 3)
                .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
                .join(', ') || 'none listed';
            const replacements = quotedExamples(negativeSwapsFor(snapshot), 3) || 'what you CAN do';
            focusLines.push(
                `Focus Area - Avoiding Negative Words: ${negScore}% (Using Negative Words: ${usingNegative}%). Target: ${negativeTarget}% (Using Negative Words: ${usingNegativeTarget}%). ` +
                `Most used phrases: ${topNeg}. Try saying this instead: ${replacements}.`
            );
        }

        if (posScore < positiveTarget) {
            const topPos = (snapshot.topPhrases?.positiveA || []).slice(0, 3)
                .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
                .join(', ') || 'none listed';
            const additions = quotedExamples(positiveAdditionsFor(snapshot), 3) || '"My pleasure", "Absolutely"';
            focusLines.push(
                `Focus Area - Using Positive Words: ${posScore}% (Target: ${positiveTarget}%). ` +
                `Most used phrases: ${topPos}. Add these phrases to every call: ${additions}.`
            );
        }

        if (emoScore < emotionsTarget) {
            const cues = (snapshot.topPhrases?.emotions || []).slice(0, 3)
                .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
                .join(', ') || 'no frequent cues captured';
            focusLines.push(
                `Focus Area - Managing emotions is at ${emoScore}%, target is ${emotionsTarget}%. ` +
                `Heightened customer phrases detected: ${cues}. Use de-escalation acknowledgment before solving.`
            );
        }

        if (focusLines.length === 0) {
            return 'In the latest report, sentiment metrics are meeting targets. Reinforce consistency and continue current phrasing habits.';
        }

        return focusLines.join('\n');
    }

    /**
     * Profanity that must not reach a coaching document.
     *
     * containsCurseWords and censorCurseWords both read this and it was defined
     * nowhere, so every call to either threw a ReferenceError. All three section
     * builders call them on every phrase, which means the sentiment summary was
     * broken twice over: the composer that assembles it did not exist, and the
     * sections it would have assembled could not run either.
     *
     * These phrase lists come out of the Verint transcript lexicon, so they
     * carry whatever the customer said. Matching is substring and
     * case-insensitive, which is deliberately blunt: this list decides what is
     * dropped from a shout-out and what is masked in a document that goes to a
     * person, so a false positive costs one phrase and a false negative costs
     * rather more.
     *
     * Ordered longest first, so censoring replaces the fuller match rather than
     * leaving a fragment behind.
     */
    const CURSE_WORDS = [
        'motherfucker', 'bullshit', 'asshole', 'dumbass', 'jackass', 'goddamn',
        'bastard', 'fucking', 'fucked', 'shitty', 'pissed', 'wanker', 'bollocks',
        'fuck', 'shit', 'cunt', 'twat', 'prick', 'bitch', 'damn', 'crap', 'piss',
        'dick', 'cock', 'arse', 'wtf', 'stfu'
    ];

    function containsCurseWords(phrase) {
        if (!phrase) return false;
        const lowerPhrase = phrase.toLowerCase();
        return CURSE_WORDS.some(word => lowerPhrase.includes(word));
    }

    function censorCurseWords(phrase) {
        if (!phrase) return phrase;
        let censored = phrase;
        const lowerPhrase = phrase.toLowerCase();
        CURSE_WORDS.forEach(word => {
            const regex = new RegExp(word, 'gi');
            if (lowerPhrase.includes(word)) {
                censored = censored.replace(regex, '[censored]');
            }
        });
        return censored;
    }

    function buildPositiveLanguageSentimentSection(positive, associateName) {
        let section = '';
        section += `═══════════════════════════════════\n`;
        section += `POSITIVE LANGUAGE\n`;
        section += `═══════════════════════════════════\n`;
        section += `Keywords Summary (phrases used)\n\n`;

        const posUsedPhrases = positive.phrases
            .filter(p => p.value > 0 && !containsCurseWords(p.phrase))
            .sort((a, b) => b.value - a.value);
        if (posUsedPhrases.length > 0) {
            section += `✓ DOING WELL - You used these positive words/phrases:\n`;
            posUsedPhrases.slice(0, SENTIMENT_TOP_WINS_COUNT).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}" - ${p.value} calls\n`;
            });
            if (posUsedPhrases.length > SENTIMENT_TOP_WINS_COUNT) {
                section += `  [... and ${posUsedPhrases.length - SENTIMENT_TOP_WINS_COUNT} more positive phrases]\n`;
            }
        } else {
            section += `✓ DOING WELL:\n`;
            section += `  • No strong positive phrases detected in this period\n`;
        }
        section += `\n`;

        const posUnusedPhrases = positive.phrases
            .filter(p => p.value === 0 && !containsCurseWords(p.phrase))
            .sort((a, b) => a.value - b.value);
        if (posUnusedPhrases.length > 0) {
            section += `⬆ INCREASE YOUR SCORE - Try using these phrases more often:\n`;
            posUnusedPhrases.slice(0, SENTIMENT_BOTTOM_COUNT).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}"\n`;
            });
        }
        section += `\n`;

        section += `📝 SCRIPTED OPENING (with positive language):\n`;
        section += `  "Hello! Thank you for calling. My name is ${escapeHtml(associateName)}. I'm here to\n`;
        section += `   help you and I appreciate the opportunity to assist you today."\n\n`;

        section += `📝 OWNERSHIP STATEMENT (take responsibility):\n`;
        section += `  "I understand this is important to you. I'm going to take ownership of\n`;
        section += `   this and personally ensure we get this resolved for you."\n\n`;

        section += `📝 SCRIPTED CLOSING (with positive language):\n`;
        section += `  "I truly appreciate you taking the time to work with me on this. We've\n`;
        section += `   accomplished great things together today, and I'm delighted we could help."\n\n`;

        return section;
    }

    function buildNegativeLanguageSentimentSection(negative) {
        let section = '';
        section += `═══════════════════════════════════\n`;
        section += `AVOIDING NEGATIVE LANGUAGE\n`;
        section += `═══════════════════════════════════\n`;
        section += `Keywords Summary (phrases used)\n\n`;

        const assocNegative = negative.phrases.filter(p => p.speaker === 'A' && p.value > 0 && !containsCurseWords(p.phrase));
        const assocNegativeUnused = negative.phrases.filter(p => p.speaker === 'A' && p.value === 0 && !containsCurseWords(p.phrase));
        const custNegative = negative.phrases.filter(p => p.speaker === 'C' && p.value > 0 && !containsCurseWords(p.phrase));

        if (assocNegative.length === 0) {
            section += `✓ EXCELLENT - Minimal negative language in your calls\n`;
            section += `  • You're avoiding negative words effectively\n`;
        } else {
            section += `⚠ PHRASES YOU USED - These came out in your calls, avoid them:\n`;
            assocNegative.sort((a, b) => b.value - a.value).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}" - used ${p.value} times\n`;
            });
        }
        section += `\n`;

        if (assocNegativeUnused.length > 0) {
            section += `🛡 WATCH OUT - Database phrases you haven't used yet (prevent bad habits):\n`;
            assocNegativeUnused.slice(0, SENTIMENT_BOTTOM_COUNT).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}" - Don't let this slip in\n`;
            });
        }
        section += `\n`;

        const negativeReplacements = {
            'not sure': 'I\'ll find out for you',
            'an error': 'Let me correct that for you',
            'we can\'t': 'Here\'s what we can do',
            'can\'t': 'We can',
            'no way': 'I understand, let\'s work on this',
            'i can\'t': 'I can help you with',
            'no': 'Yes, I can',
            'unable': 'I\'m able to help you',
            'don\'t': 'Do',
            'sorry but': 'I apologize and here\'s how I\'ll fix this',
            'unfortunately': 'Great news - here\'s what we can do'
        };

        section += `✅ POSITIVE ALTERNATIVES - Say these instead:\n`;
        if (assocNegative.length > 0) {
            assocNegative.sort((a, b) => b.value - a.value).slice(0, 3).forEach(p => {
                const phrase = p.phrase.toLowerCase().replace(/[^a-z0-9\s]/g, '');
                const replacement = Object.entries(negativeReplacements).find(([key]) => phrase.includes(key))?.[1];
                if (replacement) {
                    section += `  • Instead of "${censorCurseWords(p.phrase)}" → "${replacement}"\n`;
                }
            });
        } else {
            section += `  • "I understand your concern, here's how I can help"\n`;
            section += `  • "Let me find a solution for you"\n`;
            section += `  • "I appreciate you working with me on this"\n`;
        }
        section += `\n`;

        if (custNegative.length > 0) {
            section += `📌 CUSTOMER CONTEXT - They said (understand their frustration):\n`;
            custNegative.sort((a, b) => b.value - a.value).slice(0, SENTIMENT_CUSTOMER_CONTEXT_COUNT).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}" - detected ${p.value} times\n`;
            });
            section += `  → Acknowledge their concern, don't make excuses\n`;
        }
        section += `\n`;

        section += `📝 SCRIPTED RESPONSE (when customer is frustrated):\n`;
        section += `  "I hear your frustration, and I completely understand. I'm committed to\n`;
        section += `   finding a solution for you right now. Let me see what I can do for you."\n\n`;

        return section;
    }

    function buildManagingEmotionsSentimentSection(emotions) {
        let section = '';
        section += `═══════════════════════════════════\n`;
        section += `MANAGING EMOTIONS\n`;
        section += `═══════════════════════════════════\n`;
        section += `Coverage: ${emotions.callsDetected} / ${emotions.totalCalls} calls (${emotions.percentage}%)\n\n`;

        const emotionUsedPhrases = emotions.phrases.filter(p => p.value > 0 && !containsCurseWords(p.phrase));
        const emotionUnusedPhrases = emotions.phrases.filter(p => p.value === 0 && !containsCurseWords(p.phrase));

        if (emotionUsedPhrases.length === 0 || emotions.percentage <= SENTIMENT_EMOTION_LOW_THRESHOLD) {
            section += `✓ STRONG PERFORMANCE - You're managing customer emotions effectively\n`;
            section += `  • Low emotion escalation (${emotions.percentage}%) - Calming presence detected\n`;
        } else {
            section += `📌 EMOTION INDICATORS DETECTED - Customer emotional phrases in calls:\n`;
            emotionUsedPhrases.sort((a, b) => b.value - a.value).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}" - detected in ${p.value} calls\n`;
            });
        }
        section += `\n`;

        if (emotionUnusedPhrases.length > 0) {
            section += `🛡 WATCH OUT - Emotion phrases to prevent (haven't shown up yet):\n`;
            emotionUnusedPhrases.slice(0, SENTIMENT_BOTTOM_COUNT).forEach(p => {
                section += `  • "${censorCurseWords(p.phrase)}" - Avoid letting this develop\n`;
            });
        }
        section += `\n`;

        section += `✅ TECHNIQUES TO MASTER - How to manage emotions:\n`;
        section += `  • Acknowledge their feelings first: "I can hear the frustration in your voice"\n`;
        section += `  • Show you understand: "If I were in your position, I'd feel the same way"\n`;
        section += `  • Don't interrupt or talk over them - let them finish\n`;
        section += `  • Take action, not excuses: "Here's exactly what I'm going to do..."\n`;
        section += `  • Follow up: "I'll personally make sure this gets resolved for you"\n`;
        section += `\n`;

        section += `📝 SCRIPTED RESPONSE (when emotion is high):\n`;
        section += `  "I completely understand your frustration. I'm listening to you, and I want\n`;
        section += `   you to know I'm going to take personal ownership of this. Let me get this\n`;
        section += `   resolved for you right now. Here's what I can do..."\n\n`;

        return section;
    }

    // The registry owns metric targets. A local copy of a number that lives
    // somewhere else is a drift waiting to happen.
    function sentimentGoal(metricKey, fallback) {
        const profiles = window.DevCoachModules?.metricProfiles;
        const target = profiles?.getYearTarget?.(metricKey, new Date().getFullYear())
            || window.METRICS_REGISTRY?.[metricKey]?.target;
        const value = target ? parseFloat(target.value) : NaN;
        return Number.isFinite(value) ? value : fallback;
    }

    /* ══════════════════════════════════════════════════════════════════════
       THE SUMMARY COMPOSER

       generateSentimentSummary and generateSentimentCoPilotPrompt have always
       called buildSentimentSummaryText and buildSentimentCopilotPrompt through
       their own namespace. Neither function existed anywhere in the codebase,
       so both buttons have only ever produced their failure alert. The three
       section builders below were written and exported all along; only the
       thing that assembles them was missing.

       What it says, and why:

       - It opens with the standing on all three, because that is the question
         somebody clicked the button to answer. Each line carries the figure,
         the goal, and whether it is met, so no line can be read two ways.
       - Then ONE focus. Three focuses is a list, not a plan, and the widest gap
         is the one worth the week.
       - Then the phrases actually behind it, taken from the report itself, so
         the focus is something to do rather than something to be.
       - The detailed sections follow unchanged.

       House rules it holds to: no em dashes, plain words, nothing promised on
       anyone's behalf, no "you are new" framing, and no "only X away from" --
       the gap is stated as a number and left to stand.
       ══════════════════════════════════════════════════════════════════════ */

    function sentimentStandingLine(label, report, goal) {
        const pct = Number(report && report.percentage);
        if (!Number.isFinite(pct)) {
            return '  ' + label + ': no reading in this file';
        }
        const met = pct >= goal;
        const gap = Math.round((goal - pct) * 10) / 10;
        const verdict = met ? 'met' : gap + ' points under';
        return '  ' + label + ': ' + pct.toFixed(1) + '% against a ' + goal + '% goal, ' + verdict;
    }

    function sentimentFocusPick(reports, goals) {
        const candidates = [
            { label: 'Positive Language', report: reports.positive, goal: goals.POSITIVE_GOAL, isNegative: false },
            { label: 'Avoiding Negative Words', report: reports.negative, goal: goals.NEGATIVE_GOAL, isNegative: true },
            // Negative in the sense that matters here: an emotions phrase is a
            // flag on the call, never something "already landing" or "worth
            // trying". It was listed as positive, which offered "Monopoly"
            // and "threatening" as phrases to try.
            { label: 'Managing Emotions', report: reports.emotions, goal: goals.EMOTIONS_GOAL, isNegative: true }
        ].filter(function (c) { return Number.isFinite(Number(c.report && c.report.percentage)); });

        if (!candidates.length) return null;

        // Widest gap wins. Everything at goal means there is no focus to name,
        // and saying so is better than manufacturing one.
        let worst = null;
        candidates.forEach(function (c) {
            const gap = c.goal - Number(c.report.percentage);
            if (!worst || gap > worst.gap) {
                worst = { label: c.label, report: c.report, goal: c.goal, gap: gap, isNegative: c.isNegative };
            }
        });
        return worst && worst.gap > 0 ? worst : null;
    }

    /**
     * The phrases behind a focus, and what each list MEANS.
     *
     * The polarity flips between reports and getting it backwards is not a
     * cosmetic slip. On Positive Language a phrase used on 28 calls is a habit
     * worth keeping. On Avoiding Negative Words and Managing Emotions the same
     * shape is "unfortunately, 28 times" -- a habit to break. Calling that
     * "already landing" would congratulate somebody for the exact thing the
     * metric is docking them for.
     *
     * The speaker filter matters just as much. These reports carry the
     * CUSTOMER's phrases alongside the associate's, tagged 'C' and 'A'. Quoting
     * a customer's words back at the associate as though they said them is the
     * worst thing this summary could do, so anything not tagged as the
     * associate is dropped. Where the field is absent the phrase is kept, since
     * the older files carry the associate only.
     */
    function sentimentFocusPhrases(report, options) {
        const o = options || {};
        const negative = o.negative === true;
        const phrases = (Array.isArray(report && report.phrases) ? report.phrases : [])
            .filter(function (p) {
                if (!p || containsCurseWords(p.phrase)) return false;
                return p.speaker === undefined || p.speaker === null || p.speaker === 'A';
            });

        const spoken = phrases
            .filter(function (p) { return p.value > 0; })
            .sort(function (a, b) { return b.value - a.value; })
            .slice(0, 3)
            .map(function (p) {
                return '"' + censorCurseWords(p.phrase) + '" on ' + p.value + ' call' + (p.value === 1 ? '' : 's');
            });
        const absent = phrases
            .filter(function (p) { return p.value === 0; })
            .slice(0, 3)
            .map(function (p) { return '"' + censorCurseWords(p.phrase) + '"'; });

        // On a negative-words focus the useful half is what came out and wants
        // replacing. What never came out is the absence of a problem, and
        // listing it reads as a warning about phrases nobody said.
        if (negative) {
            return {
                heading: 'Coming out in your calls, and worth replacing:',
                lines: spoken,
                secondHeading: '',
                secondLines: []
            };
        }
        return {
            heading: 'Already landing:',
            lines: spoken,
            secondHeading: 'Not showing up yet, and worth trying:',
            secondLines: absent
        };
    }

    function sentimentPeriodLine(report) {
        const start = String((report && report.startDate) || '').trim();
        const end = String((report && report.endDate) || '').trim();
        if (start && end) return start + ' to ' + end;
        return end || start || '';
    }

    function sentimentGoalSet(options) {
        const o = options || {};
        return {
            POSITIVE_GOAL: Number.isFinite(o.POSITIVE_GOAL) ? o.POSITIVE_GOAL : sentimentGoal('positiveWord', 86),
            NEGATIVE_GOAL: Number.isFinite(o.NEGATIVE_GOAL) ? o.NEGATIVE_GOAL : sentimentGoal('negativeWord', 83),
            EMOTIONS_GOAL: Number.isFinite(o.EMOTIONS_GOAL) ? o.EMOTIONS_GOAL : sentimentGoal('managingEmotions', 95)
        };
    }

    /**
     * The whole summary: a standing, one focus, the phrases behind it, then the
     * three detailed sections.
     */
    function buildSentimentSummaryText(reports, helpers) {
        const h = helpers || {};
        const esc = typeof h.escapeHtml === 'function'
            ? h.escapeHtml
            : function (v) { return String(v == null ? '' : v); };
        const positive = reports && reports.positive;
        const negative = reports && reports.negative;
        const emotions = reports && reports.emotions;
        if (!positive || !negative || !emotions) return { summary: '' };

        const goals = sentimentGoalSet(h);
        const name = esc(positive.associateName || 'this associate');
        const period = sentimentPeriodLine(positive);
        const calls = Number(positive.totalCalls) > 0 ? Number(positive.totalCalls) : null;

        let out = '';
        out += '═══════════════════════════════════\n';
        out += 'SENTIMENT SUMMARY\n';
        out += '═══════════════════════════════════\n';
        out += name + '\n';
        if (period) out += period + '\n';
        if (calls) out += calls + ' call' + (calls === 1 ? '' : 's') + ' reviewed\n';
        out += '\n';

        out += 'WHERE IT STANDS\n';
        out += sentimentStandingLine('Positive Language', positive, goals.POSITIVE_GOAL) + '\n';
        out += sentimentStandingLine('Avoiding Negative Words', negative, goals.NEGATIVE_GOAL) + '\n';
        out += sentimentStandingLine('Managing Emotions', emotions, goals.EMOTIONS_GOAL) + '\n';
        out += '\n';

        const focus = sentimentFocusPick({ positive: positive, negative: negative, emotions: emotions }, goals);
        out += 'WHAT TO WORK ON\n';
        if (!focus) {
            out += '  All three are at goal for this period. Keep doing what is working.\n\n';
        } else {
            const gap = Math.round(focus.gap * 10) / 10;
            out += '  ' + focus.label + '. It is the widest gap of the three, '
                + gap + ' points under a ' + focus.goal + '% goal.\n';

            const phrases = sentimentFocusPhrases(focus.report, { negative: focus.isNegative });
            if (phrases.lines.length) {
                out += '\n  ' + phrases.heading + '\n';
                phrases.lines.forEach(function (line) { out += '    • ' + line + '\n'; });
            }
            if (phrases.secondLines.length) {
                out += '\n  ' + phrases.secondHeading + '\n';
                phrases.secondLines.forEach(function (line) { out += '    • ' + line + '\n'; });
            }
            out += '\n';
        }

        // The detail, unchanged. Passed in so this composer never has to know
        // how a section is built.
        const sections = [
            typeof h.buildPositiveLanguageSentimentSection === 'function'
                ? h.buildPositiveLanguageSentimentSection(positive, name) : '',
            typeof h.buildNegativeLanguageSentimentSection === 'function'
                ? h.buildNegativeLanguageSentimentSection(negative, name) : '',
            typeof h.buildManagingEmotionsSentimentSection === 'function'
                ? h.buildManagingEmotionsSentimentSection(emotions, name) : ''
        ].filter(Boolean);

        if (sections.length) out += sections.join('\n');

        return { summary: out };
    }

    /**
     * The CoPilot prompt. Same facts, asked as a question rather than stated.
     */
    function buildSentimentCopilotPrompt(reports, options) {
        const o = options || {};
        const positive = reports && reports.positive;
        const negative = reports && reports.negative;
        const emotions = reports && reports.emotions;
        if (!positive || !negative || !emotions) return '';

        const goals = sentimentGoalSet(o);
        const name = o.associateName || positive.associateName || 'the associate';
        const period = sentimentPeriodLine(positive);
        const pct = function (r) { return Number(r.percentage).toFixed(1); };

        let out = '';
        out += 'Write a short, warm coaching note for ' + name + ' about how they speak on calls.\n\n';
        if (period) out += 'Period: ' + period + '\n';
        out += 'Positive Language: ' + pct(positive) + '% against a ' + goals.POSITIVE_GOAL + '% goal\n';
        out += 'Avoiding Negative Words: ' + pct(negative) + '% against a ' + goals.NEGATIVE_GOAL + '% goal\n';
        out += 'Managing Emotions: ' + pct(emotions) + '% against a ' + goals.EMOTIONS_GOAL + '% goal\n\n';

        const focus = sentimentFocusPick({ positive: positive, negative: negative, emotions: emotions }, goals);
        if (focus) {
            out += 'Focus on ' + focus.label + ', which is the widest gap.\n';
            const phrases = sentimentFocusPhrases(focus.report, { negative: focus.isNegative });
            if (phrases.lines.length) out += phrases.heading + ' ' + phrases.lines.join('; ') + '\n';
            if (phrases.secondLines.length) out += phrases.secondHeading + ' ' + phrases.secondLines.join('; ') + '\n';
        } else {
            out += 'All three are at goal, so make this a recognition note rather than a correction.\n';
        }

        out += '\nRules for the note:\n';
        out += '- Plain words. No jargon, and do not read the scores back like a report.\n';
        out += '- Name one thing to try, not a list.\n';
        out += '- Do not promise any exception, allowance or adjustment.\n';
        out += '- Do not assume they are new to the job.\n';
        out += '- Keep it under 150 words and address them directly.\n';

        return out;
    }

    function generateSentimentSummary() {
        const { positive, negative, emotions } = sentimentReports;

        // Validation: ensure all 3 files uploaded
        if (!positive || !negative || !emotions) {
            alert('⚠️ Please upload all 3 files (Positive Language, Avoiding Negative Language, Managing Emotions)');
            return;
        }

        const delegated = window.DevCoachModules?.sentiment?.buildSentimentSummaryText;
        let summary = '';
        if (typeof delegated === 'function') {
            const composed = delegated(
                { positive, negative, emotions },
                {
                    escapeHtml,
                    buildPositiveLanguageSentimentSection,
                    buildNegativeLanguageSentimentSection,
                    buildManagingEmotionsSentimentSection
                }
            );
            summary = composed?.summary || '';
        }

        if (!summary) {
            alert('⚠️ Sentiment module is unavailable or could not build summary. Refresh and try again.');
            return;
        }

        // Display the summary
        document.getElementById('sentimentSummaryText').textContent = summary;
        document.getElementById('sentimentSummaryOutput').style.display = 'block';

        showToast('✅ Summary generated successfully', 2000);
    }

    function parseSentimentReportDate(line, label) {
        if (!line || !line.toLowerCase().includes(`${label} date`)) {
            return '';
        }

        const dateMatch = line.match(new RegExp(`${label}\\s+date[:\\s,]*"?([0-9]{1,2}[/\\-][0-9]{1,2}[/\\-][0-9]{2,4})`, 'i'));
        if (dateMatch) {
            return dateMatch[1].trim();
        }

        if (SENTIMENT_DEBUG) console.warn(`⚠️ Found "${label} date" line but couldn't parse: "${line}"`);
        return '';
    }

    function handleSentimentInteractionsMatch(report, inKeywordsSection, allInteractionsMatches, interactionsMatch, line, lineIndex) {
        const callsDetected = parseInt(interactionsMatch[1]);
        const percentage = parseInt(interactionsMatch[2]);
        const totalCalls = parseInt(interactionsMatch[3]);

        debugLog(`📊 PARSE DEBUG - FOUND Interactions at line ${lineIndex}: ${percentage}% (inKeywordsSection=${inKeywordsSection})`);
        allInteractionsMatches.push({
            lineIndex,
            lineContent: line,
            callsDetected: callsDetected,
            percentage: percentage,
            totalCalls: totalCalls,
            inKeywordsSection: inKeywordsSection
        });

        if (inKeywordsSection && !report.inKeywordsSection) {
            report.callsDetected = callsDetected;
            report.percentage = percentage;
            report.totalCalls = totalCalls;
            report.inKeywordsSection = true;
            debugLog(`✅ SET METRICS (in keywords section): ${callsDetected} detected, ${totalCalls} total, ${percentage}%`);
        } else if (!inKeywordsSection && !report.inKeywordsSection) {
            report.callsDetected = callsDetected;
            report.percentage = percentage;
            report.totalCalls = totalCalls;
            debugLog(`⚠️ TENTATIVE METRICS (no keywords section yet): ${callsDetected} detected, ${totalCalls} total, ${percentage}%`);
        }
    }

    function appendParsedSentimentPhrase(phrases, rawPhrase, value, fallbackMode = 'none') {
        const extracted = extractSentimentSpeakerAndPhrase(rawPhrase);
        if (extracted) {
            phrases.push({ phrase: extracted.phrase, value, speaker: extracted.speaker });
            return true;
        }

        if (fallbackMode === 'defaultA') {
            const cleanPhrase = String(rawPhrase || '').replace(/^"(.*)"$/, '$1');
            phrases.push({ phrase: cleanPhrase, value, speaker: 'A' });
            return true;
        }

        if (fallbackMode === 'simpleTagged') {
            const simpleMatch = String(rawPhrase || '').match(/[+\-#]\s*\(([AC]):\s*"?([^")]+)"?\)/i);
            if (simpleMatch) {
                const speaker = simpleMatch[1].toUpperCase();
                const cleanPhrase = simpleMatch[2].trim();
                phrases.push({ phrase: cleanPhrase, value, speaker });
                return true;
            }
        }

        return false;
    }

    function parseSentimentKeywordLine(report, line, pendingPhrase) {
        const csvQuotedMatch = line.match(/^"([^"]+(?:""[^"]+)*)",(\d+)/);
        if (csvQuotedMatch) {
            const rawPhrase = csvQuotedMatch[1].replace(/""/g, '"').trim();
            const value = parseInt(csvQuotedMatch[2]);
            appendParsedSentimentPhrase(report.phrases, rawPhrase, value, 'none');
            return { handled: true, pendingPhrase };
        }

        const csvMatch = line.match(/^([^,]+),(\d+)$/);
        if (csvMatch) {
            const rawPhrase = csvMatch[1].trim();
            const value = parseInt(csvMatch[2]);
            appendParsedSentimentPhrase(report.phrases, rawPhrase, value, 'defaultA');
            return { handled: true, pendingPhrase };
        }

        if (line.match(/^[+\-#]/)) {
            return { handled: true, pendingPhrase: line.trim() };
        }

        if (pendingPhrase && line.match(/^\d+$/)) {
            const value = parseInt(line.trim());
            appendParsedSentimentPhrase(report.phrases, pendingPhrase, value, 'simpleTagged');
            return { handled: true, pendingPhrase: null };
        }

        return { handled: false, pendingPhrase };
    }

    function logSentimentParseCompletion(fileType, report, allInteractionsMatches) {
        debugLog(`📊 PARSE COMPLETE [fileType=${fileType}] - All Interactions matches found:`, allInteractionsMatches);
        debugLog(`📊 PARSE COMPLETE [fileType=${fileType}] - Final report:`, report);
        debugLog(`📊 PARSE COMPLETE [fileType=${fileType}] - Percentages: callsDetected=${report.callsDetected}, totalCalls=${report.totalCalls}, percentage=${report.percentage}%, inKeywordsSection=${report.inKeywordsSection}`);

        if (report.percentage === 0) {
            debugLog(`⚠️ WARNING: ${fileType} percentage is 0. Likely causes:`, {
                noInteractionsLine: true,
                regexMismatch: true,
                keywordsSectionNotDetected: !report.inKeywordsSection,
                interactionsBeforeKeywords: allInteractionsMatches.length
            });
        }
    }

    function isSentimentKeywordsSectionLine(line) {
        const normalized = String(line || '').toLowerCase();
        return normalized.includes('keywords') || normalized.includes('query result metrics');
    }

    function isSentimentHeaderLine(line) {
        const trimmed = String(line || '').trim();
        return trimmed === 'Name' || trimmed === 'Value' || /^Name,Value/i.test(trimmed);
    }

    function parseSentimentAssociateName(line) {
        if (!line || line.length <= 10) {
            return '';
        }

        const nameMatch = line.match(/^(?:Employee|Agent|Name)[:\s]+(.+)$/i);
        return nameMatch ? nameMatch[1].trim() : '';
    }

    function createEmptySentimentReport() {
        return {
            associateName: '',
            startDate: '',
            endDate: '',
            totalCalls: 0,
            callsDetected: 0,
            percentage: 0,
            phrases: [],
            inKeywordsSection: false
        };
    }

    function parseSentimentFile(fileType, lines) {
        // Parse the "English Speech. Charts Report" format
        debugLog(`📊 PARSE START - fileType=${fileType}, total lines=${lines.length}`);
        debugLog(`📊 PARSE START - First 10 lines:`, lines.slice(0, 10));

        const report = createEmptySentimentReport();

        let inKeywordsSection = false;
        let pendingPhrase = null; // For handling phrase/value on separate lines
        let allInteractionsMatches = []; // Track ALL Interactions lines found

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (!report.associateName) {
                const associateName = parseSentimentAssociateName(line);
                if (associateName) {
                    report.associateName = associateName;
                }
            }

            if (!report.startDate) {
                const startDate = parseSentimentReportDate(line, 'start');
                if (startDate) {
                    report.startDate = startDate;
                    debugLog(`✅ Found start date: ${report.startDate}`);
                }
            }

            if (!report.endDate) {
                const endDate = parseSentimentReportDate(line, 'end');
                if (endDate) {
                    report.endDate = endDate;
                    debugLog(`✅ Found end date: ${report.endDate}`);
                }
            }

            // Extract total calls and calls with category detected
            // Format in Excel CSV: "Interactions:,165 (76% out of 218 matching data filter),,"
            debugLog(`📊 PARSE DEBUG [fileType=${fileType}] - Line ${i}: "${line}"`);
            const interactionsMatch = line.match(/Interactions:?,?\s*(\d+)\s*\(.*?(\d+)%.*?out\s+of\s+(\d+)/i);
            if (interactionsMatch) {
                handleSentimentInteractionsMatch(report, inKeywordsSection, allInteractionsMatches, interactionsMatch, line, i);
                continue;
            }

            // Detect keywords section
            if (isSentimentKeywordsSectionLine(line)) {
                inKeywordsSection = true;
                debugLog(`✅ Found keywords section at line ${i}`);
                continue;
            }

            // Skip "Name" and "Value" header lines
            if (isSentimentHeaderLine(line)) {
                debugLog(`Skipping header line: "${line}"`);
                continue;
            }

            // Parse keyword phrases - handling BOTH formats
            if (inKeywordsSection && report.totalCalls > 0) {
                const keywordLineResult = parseSentimentKeywordLine(report, line, pendingPhrase);
                pendingPhrase = keywordLineResult.pendingPhrase;
                if (keywordLineResult.handled) {
                    continue;
                }
            }
        }

        logSentimentParseCompletion(fileType, report, allInteractionsMatches);

        return report;
    }

    function extractSentimentSpeakerAndPhrase(rawPhrase) {
        if (!rawPhrase) return null;
        const compact = String(rawPhrase).trim();
        // Verint puts a position rule ahead of the speaker on some lines:
        // +([END:100]C:"very" NEAR "helpful"). The shapes below never matched
        // those, so the customer's thanks at the close fell out of every
        // report, and in a CSV export it was credited to the associate.
        const positioned = compact.match(/[+\-#]?\s*\(\s*\[(?:END|START):\d+\]\s*([AC]):\s*(.+)\)$/i);
        if (positioned) {
            return {
                speaker: positioned[1].toUpperCase(),
                phrase: positioned[2].trim().replace(/^"|"$/g, '')
            };
        }

        const tagged = compact.match(/[+\-#]?\s*\(([AC]):\s*(.+)\)$/i);
        if (tagged) {
            return {
                speaker: tagged[1].toUpperCase(),
                phrase: tagged[2].trim().replace(/^"|"$/g, '')
            };
        }

        const direct = compact.match(/^([AC]):\s*(.+)$/i);
        if (direct) {
            return {
                speaker: direct[1].toUpperCase(),
                phrase: direct[2].trim().replace(/^"|"$/g, '')
            };
        }

        // No tag means either side said it: +(ridiculous), +("you people").
        // Most of the Managing Emotions report is written this way. Read as
        // 'E', so nothing quotes it back to the associate as her own words,
        // where it used to land as hers by default or drop out entirely.
        // Tagged lines were taken by the shapes above, so this one never is.
        const untagged = compact.match(/^[+\-#]\s*\((.+)\)$/);
        if (untagged) {
            return { speaker: 'E', phrase: untagged[1].trim().replace(/^"|"$/g, '') };
        }

        return null;
    }

    function openUploadSentimentModal() {
        const modal = document.getElementById('uploadSentimentModal');
        if (!modal) return;

        // Populate associate dropdown
        populateSentimentAssociateDropdown();

        // Reset form
        document.getElementById('sentimentUploadAssociate').value = '';
        document.getElementById('sentimentUploadPullDate').value = '';
        document.getElementById('sentimentUploadPositiveFile').value = '';
        document.getElementById('sentimentUploadNegativeFile').value = '';
        document.getElementById('sentimentUploadEmotionsFile').value = '';
        const statusDiv = document.getElementById('sentimentUploadStatus');
        if (statusDiv) {
            statusDiv.style.display = 'none';
            statusDiv.textContent = '';
        }

        modal.style.display = 'flex';

        // Disable submit until associate + pull date are populated.
        const submitBtn = document.getElementById('sentimentUploadSubmitBtn');
        const associateSelect = document.getElementById('sentimentUploadAssociate');
        const pullDateInput = document.getElementById('sentimentUploadPullDate');
        const updateSubmitState = () => {
            if (!submitBtn) return;
            const ready = !!associateSelect?.value && !!pullDateInput?.value;
            submitBtn.disabled = !ready;
            submitBtn.style.opacity = ready ? '1' : '0.55';
            submitBtn.style.cursor = ready ? 'pointer' : 'not-allowed';
        };
        if (submitBtn && !submitBtn.dataset.gateBound) {
            submitBtn.dataset.gateBound = 'true';
            associateSelect?.addEventListener('change', updateSubmitState);
            pullDateInput?.addEventListener('change', updateSubmitState);
            pullDateInput?.addEventListener('input', updateSubmitState);
        }
        updateSubmitState();

        // Close on overlay click (outside modal content)
        if (!modal.dataset.overlayBound) {
            modal.addEventListener('click', function(e) {
                if (e.target === modal) closeUploadSentimentModal();
            });
            modal.dataset.overlayBound = 'true';
        }
    }

    function closeUploadSentimentModal() {
        const modal = document.getElementById('uploadSentimentModal');
        if (modal) modal.style.display = 'none';
    }


    // Opens the Copilot tab inside the click, then copies, then reports what
    // actually happened. See sharedUtils.copyPromptAndOpenCopilot.
    function handOffToCopilot(text, options) {
        return window.DevCoachModules.sharedUtils.copyPromptAndOpenCopilot(text, options);
    }

    function populateSentimentAssociateDropdown() {
        const select = document.getElementById('sentimentUploadAssociate');
        if (!select) return;

        const allEmployees = new Set();
        const teamFilterContext = getTeamSelectionContext();

        // Collect all unique employee names from weeklyData
        for (const weekKey in weeklyData) {
            const week = weeklyData[weekKey];
            if (week.employees && Array.isArray(week.employees)) {
                week.employees.forEach(emp => {
                    if (emp.name && isAssociateIncludedByTeamFilter(emp.name, teamFilterContext)) {
                        allEmployees.add(emp.name);
                    }
                });
            }
        }

        window.DevCoachModules.associatePicker.populateSelect(select, Array.from(allEmployees));
    }

    function handleSentimentUploadSubmit() {
        const associate = document.getElementById('sentimentUploadAssociate').value;
        const pullDate = document.getElementById('sentimentUploadPullDate').value;
        const positiveFileInput = document.getElementById('sentimentUploadPositiveFile');
        const negativeFileInput = document.getElementById('sentimentUploadNegativeFile');
        const emotionsFileInput = document.getElementById('sentimentUploadEmotionsFile');
        const statusDiv = document.getElementById('sentimentUploadStatus');

        // Validation
        if (!associate) {
            alert('Please select an associate');
            return;
        }
        if (!pullDate) {
            alert('Please enter the pull date');
            return;
        }

        // Check if at least one file is selected
        const hasPositive = positiveFileInput.files && positiveFileInput.files.length > 0;
        const hasNegative = negativeFileInput.files && negativeFileInput.files.length > 0;
        const hasEmotions = emotionsFileInput.files && emotionsFileInput.files.length > 0;

        if (!hasPositive && !hasNegative && !hasEmotions) {
            alert('Please select at least one sentiment file to upload');
            return;
        }

        // Calculate date range (14 days prior to pull date).
        // Parse YYYY-MM-DD manually so we stay in local time. Using
        // new Date(string) + toISOString() converts to UTC and can
        // land a day early in non-UTC timezones.
        const endDate = pullDate;
        const [py, pm, pd] = pullDate.split('-').map(Number);
        const start = new Date(py, pm - 1, pd - 14);
        const startDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;

        // Provisional: replaced by the report's own dates once the files are read.
        const timeframeKey = `${startDate}_${endDate}`;

        statusDiv.textContent= '⏳ Processing files...';
        statusDiv.style.color = '#ff9800';
        statusDiv.style.display = 'block';

        // Process files
        const filePromises = [];

        if (hasPositive) {
            filePromises.push(
                processUploadedSentimentFile(positiveFileInput.files[0], 'Positive', associate, timeframeKey)
            );
        }

        if (hasNegative) {
            filePromises.push(
                processUploadedSentimentFile(negativeFileInput.files[0], 'Negative', associate, timeframeKey)
            );
        }

        if (hasEmotions) {
            filePromises.push(
                processUploadedSentimentFile(emotionsFileInput.files[0], 'Emotions', associate, timeframeKey)
            );
        }

        Promise.all(filePromises)
            .then(results => {
                // Checked before anything is written. Each of these used to be
                // saved as if it were fine: a file for someone else under the
                // selected name, one file dropped into two slots, and a file the
                // parser could not read, stored empty behind a success message.
                const problems = checkSentimentUploads(results, associate);
                if (problems.length) {
                    statusDiv.textContent = `❌ Not saved. ${problems.join(' ')}`;
                    statusDiv.style.color = '#f44336';
                    return;
                }

                // The report's own dates when it states them, rather than an
                // assumed fourteen days before the pull date.
                const range = sentimentRangeFromReports(results) || { startDate, endDate };
                const savedKey = `${range.startDate}_${range.endDate}`;
                if (!associateSentimentSnapshots[associate]) {
                    associateSentimentSnapshots[associate] = {};
                }
                if (!associateSentimentSnapshots[associate][savedKey]) {
                    associateSentimentSnapshots[associate][savedKey] = {
                        startDate: range.startDate,
                        endDate: range.endDate,
                        pullDate,
                        positive: null,
                        negative: null,
                        emotions: null
                    };
                }

                // Save all processed data
                results.forEach(({ type, report }) => {
                    const typeKey = type.toLowerCase();
                    // Only save phrases - percentages come from weekly metrics, not sentiment files
                    associateSentimentSnapshots[associate][savedKey][typeKey] = {
                        phrases: report.phrases
                    };
                });

                // Save to localStorage
                saveAssociateSentimentSnapshots();

                // IMPORTANT: Convert from old format to new array format immediately
                loadAssociateSentimentSnapshots();  // This migrates old format to new array format

                // Repopulate dropdown with migrated data
                if (window.setupMetricTrendsListeners && typeof setupMetricTrendsListeners === 'function') {
                    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
                    if (trendEmployeeSelect && trendEmployeeSelect.value === associate) {
                        populateTrendSentimentDropdown(associate);
                    }
                }

                const uploadedTypes = results.map(r => r.type).join(', ');
                statusDiv.textContent = `✅ Saved ${uploadedTypes} for ${associate} (pulled ${pullDate})`;
                statusDiv.style.color = '#4CAF50';

                showToast(`✅ Sentiment data saved for ${associate}`, 3000);

                // Close modal after short delay
                setTimeout(() => {
                    closeUploadSentimentModal();
                }, 1500);
            })
            .catch(error => {
                statusDiv.textContent = `❌ Error: ${error.message}`;
                statusDiv.style.color = '#f44336';
                console.error('Upload sentiment error:', error);
            });
    }

    // Same person when the surnames share a word and the first names share
    // their first three letters, so "Christi Martinez-Sharp" matches
    // "Martinez Sharp, Christi" and "Chris" matches "Christopher".
    function sameSentimentAssociate(a, b) {
        const tokens = (name) => {
            let text = String(name || '').trim();
            if (text.indexOf(',') > -1) {
                const parts = text.split(',');
                text = parts.slice(1).join(' ') + ' ' + parts[0];
            }
            return text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
        };
        const x = tokens(a);
        const y = tokens(b);
        if (x.length < 2 || y.length < 2) return true;
        const surnameShared = x.slice(1).some((t) => y.slice(1).indexOf(t) > -1);
        return surnameShared && x[0].slice(0, 3) === y[0].slice(0, 3);
    }

    function sentimentDateToIso(text) {
        const m = String(text || '').trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
        if (!m) return '';
        let year = parseInt(m[3], 10);
        if (year < 100) year += 2000;
        return `${year}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
    }

    function sentimentRangeFromReports(results) {
        const ranges = results
            .map(({ report }) => ({ startDate: sentimentDateToIso(report.startDate), endDate: sentimentDateToIso(report.endDate) }))
            .filter((r) => r.startDate && r.endDate);
        return ranges.length ? ranges[0] : null;
    }

    function checkSentimentUploads(results, associate) {
        const problems = [];
        results.forEach(({ type, report }) => {
            if (!(report.totalCalls > 0) || !(report.phrases || []).length) {
                problems.push(`The ${type} file has no interactions or phrases in it, so it could not be read.`);
            }
            if (report.associateName && !sameSentimentAssociate(report.associateName, associate)) {
                problems.push(`The ${type} file is for ${report.associateName}, not ${associate}.`);
            }
        });
        const fingerprints = {};
        results.forEach(({ type, report }) => {
            const print = JSON.stringify([report.totalCalls, report.callsDetected, report.phrases]);
            if (fingerprints[print]) {
                problems.push(`The ${fingerprints[print]} and ${type} files are the same file.`);
            } else {
                fingerprints[print] = type;
            }
        });
        const range = sentimentRangeFromReports(results);
        const disagree = range && results.some(({ report }) => {
            const start = sentimentDateToIso(report.startDate);
            const end = sentimentDateToIso(report.endDate);
            return start && end && (start !== range.startDate || end !== range.endDate);
        });
        if (disagree) {
            problems.push('The files cover different dates. Pull all three for the same range.');
        }
        return problems;
    }

    function processUploadedSentimentFile(file, type, associate, timeframeKey) {
        return new Promise((resolve, reject) => {
            const fileName = file.name.toLowerCase();
            const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
            debugLog(`📊 PROCESS START - File: ${file.name}, Type: ${type}, Associate: ${associate}, TimeframeKey: ${timeframeKey}`);

            const reader = new FileReader();

            reader.onload = async (e) => {
                try {
                    let lines = [];

                    if (isExcel) {
                        await window.DevCoachModules?.assetLoader?.ensureXlsx?.();
                        const data = new Uint8Array(e.target.result);
                        const workbook = window.XLSX.read(data, { type: 'array' });
                        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                        const csvContent = window.XLSX.utils.sheet_to_csv(firstSheet);
                        lines = csvContent.split('\n').filter(line => line.trim());
                    } else {
                        const content = e.target.result;
                        lines = content.split('\n').filter(line => line.trim());
                    }

                    // Parse file
                    const report = parseSentimentFile(type, lines);
                    debugLog(`📊 PROCESS PARSED - Type: ${type}, Report percentage: ${report.percentage}%, callsDetected: ${report.callsDetected}, totalCalls: ${report.totalCalls}`);
                    resolve({ type, report });

                } catch (error) {
                    reject(new Error(`Failed to parse ${type} file: ${error.message}`));
                }
            };

            reader.onerror = () => {
                reject(new Error(`Failed to read ${type} file`));
            };

            if (isExcel) {
                reader.readAsArrayBuffer(file);
            } else {
                reader.readAsText(file);
            }
        });
    }

    function copySentimentSummary() {
        const summaryText = document.getElementById('sentimentSummaryText').textContent;

        if (!summaryText.trim()) {
            alert('⚠️ No summary to copy. Generate a summary first.');
            return;
        }

        copyToClipboard(summaryText, {
            button: document.getElementById('copySentimentSummaryBtn'),
            message: '📋 Summary copied to clipboard'
        });
    }

    function generateSentimentCoPilotPrompt() {
        const { positive, negative, emotions } = sentimentReports;

        if (!positive || !negative || !emotions) {
            alert('⚠️ Please generate the summary first');
            return;
        }

        const associateName = positive.associateName || 'the associate';
        const delegatedPrompt = window.DevCoachModules?.sentiment?.buildSentimentCopilotPrompt?.(
            { positive, negative, emotions },
            {
                associateName,
                // Read from the registry rather than retyped. These matched by
                // luck, and nothing would have caught them drifting.
                POSITIVE_GOAL: sentimentGoal('positiveWord', 86),
                NEGATIVE_GOAL: sentimentGoal('negativeWord', 83),
                EMOTIONS_GOAL: sentimentGoal('managingEmotions', 95),
                MIN_PHRASE_VALUE,
                TOP_PHRASES_COUNT,
                escapeHtml
            }
        );
        const prompt = delegatedPrompt || '';

        if (!prompt) {
            alert('⚠️ Could not generate CoPilot prompt from sentiment data.');
            return;
        }

        handOffToCopilot(prompt, { message: '📋 CoPilot prompt copied. Opening CoPilot' });
    }

    // Export all functions

    /* ══════════════════════════════════════════════════════════════════════
       KEPT ON PURPOSE. NOT WIRED UP.

       The pre-modal sentiment upload flow: three file inputs, a paste modal,
       and a snapshot save. The elements it reads (#sentimentPositiveFile,
       #sentimentNegativePasteBtn, #saveAssociateSentimentSnapshotBtn and the
       rest) were removed from index.html when the upload became a modal, so
       nothing calls any of this and nothing can.

       It is here because the sentiment work is coming back and this is the
       shape it had. Kept, not deleted, at Scott's request.

       If you are reviving it: the elements have to come back to index.html
       first, and the listeners that used to bind these were in
       bindSentimentHandlers in script.js. The current modal flow is separate
       and lives in handleSentimentUploadSubmit, reading #sentimentUpload*.

       Two things to know before trusting it:
         - It has never run against the current data shapes. It predates the
           modal rewrite and has not been exercised since.
         - It is deliberately excluded from the app's dead-code sweeps, so no
           orphan check will tell you when it rots.
       ══════════════════════════════════════════════════════════════════════ */

    function handleSentimentFileChange(fileType) {
        const fileInput = document.getElementById(`sentiment${fileType}File`);
        const statusDiv = document.getElementById(`sentiment${fileType}Status`);

        if (!fileInput.files || fileInput.files.length === 0) {
            statusDiv.textContent = 'No file selected';
            statusDiv.style.color = '#666';
            sentimentReports[fileType.toLowerCase()] = null;
            return;
        }

        const file = fileInput.files[0];
        const fileName = file.name.toLowerCase();
        const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
        const isEmotions = fileType === 'Emotions';

        statusDiv.textContent = `⏳ Processing ${file.name}...`;
        statusDiv.style.color = '#ff9800';
        showLoadingSpinner(`Processing ${escapeHtml(file.name)}...`);

        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                let lines = [];

                if (isExcel) {
                    // The library is fetched on demand rather than shipped on
                    // every page load. Without this the bare XLSX below is
                    // undefined, because nothing loads it up front any more.
                    await window.DevCoachModules?.assetLoader?.ensureXlsx?.();
                    const data = new Uint8Array(e.target.result);
                    const workbook = window.XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const csvContent = window.XLSX.utils.sheet_to_csv(firstSheet);
                    lines = csvContent.split('\n').filter(line => line.trim());
                    if (isEmotions) {
                        debugLog(`🎭 MANAGING EMOTIONS - Excel file converted to ${lines.length} lines`);
                        debugLog('🎭 First 30 lines:', lines.slice(0, 30));
                    }
                } else {
                    const content = e.target.result;
                    lines = content.split('\n').filter(line => line.trim());
                    if (isEmotions) {
                        debugLog(`🎭 MANAGING EMOTIONS - Text file has ${lines.length} lines`);
                    }
                }

                // Parse file
                const report = parseSentimentFile(fileType, lines);
                sentimentReports[fileType.toLowerCase()] = report;

                if (isEmotions) {
                    debugLog(`🎭 MANAGING EMOTIONS - Parsed result:`, {
                        name: report.associateName,
                        totalCalls: report.totalCalls,
                        detected: report.callsDetected,
                        percentage: report.percentage,
                        phrasesCount: report.phrases.length,
                        allPhrases: report.phrases
                    });
                } else {
                    debugLog(`✅ Parsed ${fileType}:`, {
                        name: report.associateName,
                        totalCalls: report.totalCalls,
                        detected: report.callsDetected,
                        percentage: report.percentage,
                        phrasesCount: report.phrases.length
                    });
                }

                statusDiv.textContent = `✅ ${escapeHtml(report.associateName || 'Loaded')} - ${report.totalCalls} calls, ${report.phrases.length} phrases`;
                statusDiv.style.color = '#4caf50';
                syncSentimentSnapshotDateInputsFromReports();
                hideLoadingSpinner();
            } catch (error) {
                statusDiv.textContent = `❌ Error parsing file`;
                statusDiv.style.color = '#f44336';
                console.error('File parsing error:', error);
                hideLoadingSpinner();
                showToast(`❌ Failed to parse ${fileType} file: ${error.message}`, 5000);
            }
        };

        reader.onerror = () => {
            statusDiv.textContent = '❌ Failed to read file';
            statusDiv.style.color = '#f44336';
            hideLoadingSpinner();
            showToast('❌ Failed to read file', 5000);
        };

        if (isExcel) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file);
        }
    }

    function openSentimentPasteModal(fileType) {
        // Create modal backdrop
        const backdrop = document.createElement('div');
        backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 10000;';

        // Create modal dialog
        const modal = document.createElement('div');
        modal.style.cssText = 'background: var(--bg-surface); border-radius: 8px; padding: 30px; max-width: 600px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);';

        modal.innerHTML = `
            <h2 style="margin-top: 0; color: var(--text-primary);">Paste ${fileType} Sentiment Data</h2>
            <p style="color: var(--text-secondary); margin-bottom: 15px;">Paste your CSV or Excel data below. Format: one entry per line, with columns for Speaker (A/C) and Phrase.</p>
            <textarea id="pasteArea" style="width: 100%; height: 200px; padding: 10px; border: 1px solid var(--border); border-radius: 4px; font-family: monospace; font-size: 12px; resize: vertical;" placeholder="Paste data here..."></textarea>
            <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
                <button id="pasteCancelBtn" style="padding: 10px 20px; background: var(--bg-surface-sunken); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 14px;">Cancel</button>
                <button id="pasteSubmitBtn" style="padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">Parse & Import</button>
            </div>
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // Get button references from the modal
        const textarea = modal.querySelector('#pasteArea');
        const cancelBtn = modal.querySelector('#pasteCancelBtn');
        const submitBtn = modal.querySelector('#pasteSubmitBtn');

        // Focus textarea
        textarea.focus();

        // Cancel button
        cancelBtn.addEventListener('click', () => {
            backdrop.remove();
        });

        // Submit button
        submitBtn.addEventListener('click', () => {
            const pastedText = textarea.value.trim();
            if (!pastedText) {
                alert('Please paste some data');
                return;
            }

            const lines = pastedText.split('\n').filter(line => line.trim());
            const statusDiv = document.getElementById(`sentiment${fileType}Status`);

            statusDiv.textContent = `⏳ Processing pasted ${fileType.toLowerCase()} data...`;
            statusDiv.style.color = '#ff9800';

            try {
                // Parse pasted data using existing parser
                const report = parseSentimentFile(fileType, lines);
                sentimentReports[fileType.toLowerCase()] = report;

                // Update UI
                syncSentimentSnapshotDateInputsFromReports();

                // Show success status
                const speakerCount = report.speakers ? (report.speakers.size ?? report.speakers.length ?? 0) : 0;
                statusDiv.textContent = `✅ Parsed ${report.phrases.length} sentiment phrase(s) from ${speakerCount} speaker(s)`;
                statusDiv.style.color = '#4CAF50';

                // Close modal
                backdrop.remove();
            } catch (error) {
                console.error('Error parsing pasted data:', error);
                statusDiv.textContent = `❌ Error: ${error.message}`;
                statusDiv.style.color = '#f44336';
            }
        });

        // Close on backdrop click
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                backdrop.remove();
            }
        });
    }

    function saveAssociateSentimentSnapshotFromCurrentReports() {
        const { positive, negative, emotions } = sentimentReports;
        if (!positive || !negative || !emotions) {
            showToast('⚠️ Upload all 3 sentiment reports before saving a snapshot', 4000);
            return;
        }

        ensureSentimentPhraseDatabaseDefaults();

        const associateName = (positive.associateName || negative.associateName || emotions.associateName || '').trim();
        if (!associateName) {
            showToast('⚠️ Associate name not found in uploaded reports', 4000);
            return;
        }

        const startInput = document.getElementById('sentimentSnapshotStart');
        const endInput = document.getElementById('sentimentSnapshotEnd');
        const startDate = normalizeDateStringForStorage(startInput?.value || positive.startDate || negative.startDate || emotions.startDate);
        const endDate = normalizeDateStringForStorage(endInput?.value || positive.endDate || negative.endDate || emotions.endDate);

        if (!startDate || !endDate) {
            showToast('⚠️ Timeframe start and end are required', 4000);
            return;
        }

        const sortByValue = (a, b) => b.value - a.value;
        const toTopRows = (items) => items.slice(0, 5).map(item => ({
            phrase: item.phrase,
            value: item.value,
            speaker: item.speaker || 'A'
        }));

        const positiveUsed = positive.phrases.filter(p => p.value > 0 && (p.speaker || 'A') === 'A').sort(sortByValue);
        const negativeUsedA = negative.phrases.filter(p => p.value > 0 && p.speaker === 'A').sort(sortByValue);
        const negativeUsedC = negative.phrases.filter(p => p.value > 0 && p.speaker === 'C').sort(sortByValue);
        const emotionsUsed = emotions.phrases.filter(p => p.value > 0).sort(sortByValue);

        const usedPositiveSet = new Set(positiveUsed.map(p => normalizePhraseForMatch(p.phrase)));
        const positiveUnusedFromDb = (sentimentPhraseDatabase.positive?.A || [])
            .filter(phrase => !usedPositiveSet.has(normalizePhraseForMatch(phrase)))
            .slice(0, 8);

        const snapshot = {
            associateName,
            timeframeStart: startDate,
            timeframeEnd: endDate,
            savedAt: new Date().toISOString(),
            topPhrases: {
                positiveA: toTopRows(positiveUsed),
                negativeA: toTopRows(negativeUsedA),
                negativeC: toTopRows(negativeUsedC),
                emotions: toTopRows(emotionsUsed)
            },
            suggestions: {
                positiveAdditions: positiveUnusedFromDb,
                negativeAlternatives: (sentimentPhraseDatabase.positive?.A || []).slice(0, 8),
                emotionCustomerCues: (sentimentPhraseDatabase.emotions?.C || []).slice(0, 8)
            }
        };

        if (!associateSentimentSnapshots[associateName]) {
            associateSentimentSnapshots[associateName] = [];
        }

        const existingIndex = associateSentimentSnapshots[associateName].findIndex(entry =>
            entry.timeframeStart === startDate && entry.timeframeEnd === endDate
        );

        if (existingIndex >= 0) {
            associateSentimentSnapshots[associateName][existingIndex] = snapshot;
        } else {
            associateSentimentSnapshots[associateName].push(snapshot);
        }

        // Sorted newest first, but not truncated. A year of sentiment history
        // is what answers "how has this person been trending", which was the
        // reason for keeping snapshots in the first place.
        associateSentimentSnapshots[associateName] = associateSentimentSnapshots[associateName]
            .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

        debugLog('💾 Saving sentiment snapshot:', { associateName, startDate, endDate, snapshot });
        debugLog('📦 All snapshots after save:', associateSentimentSnapshots);

        saveAssociateSentimentSnapshots();
        populateDeleteSentimentDropdown();
        renderSentimentDatabasePanel();
        showToast(`✅ Saved sentiment snapshot for ${associateName} (${startDate} to ${endDate})`, 3000);
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.sentiment = {
        normalizePhraseList,
        normalizePhraseForMatch,
        formatKeywordPhraseForDisplay,
        normalizeDateStringForStorage,
        parseDateForComparison,
        ensureSentimentPhraseDatabaseDefaults,
        getPhraseDatabase,
        phrasePlainWords,
        examplePhraseFor,
        upgradePhraseDatabase,
        parsePhraseLine,
        parsePhraseLines,
        renderSentimentDatabasePanel,
        saveSentimentPhraseDatabaseFromForm,
        syncSentimentSnapshotDateInputsFromReports,
        formatSentimentSnapshotForPrompt,
        buildSentimentFocusAreasForPrompt,
        containsCurseWords,
        censorCurseWords,
        buildPositiveLanguageSentimentSection,
        buildNegativeLanguageSentimentSection,
        buildManagingEmotionsSentimentSection,
        // The composers the two buttons have always called and that never
        // existed. Exported under exactly the names the call sites look up.
        buildSentimentSummaryText,
        buildSentimentCopilotPrompt,
        generateSentimentSummary,
        parseSentimentReportDate,
        handleSentimentInteractionsMatch,
        appendParsedSentimentPhrase,
        parseSentimentKeywordLine,
        logSentimentParseCompletion,
        isSentimentKeywordsSectionLine,
        isSentimentHeaderLine,
        parseSentimentAssociateName,
        createEmptySentimentReport,
        parseSentimentFile,
        checkSentimentUploads,
        sameSentimentAssociate,
        extractSentimentSpeakerAndPhrase,
        openUploadSentimentModal,
        closeUploadSentimentModal,
        populateSentimentAssociateDropdown,
        handleSentimentUploadSubmit,
        processUploadedSentimentFile,
        copySentimentSummary,
        generateSentimentCoPilotPrompt
    };

    window.normalizePhraseList = normalizePhraseList;
    window.normalizePhraseForMatch = normalizePhraseForMatch;
    window.formatKeywordPhraseForDisplay = formatKeywordPhraseForDisplay;
    window.normalizeDateStringForStorage = normalizeDateStringForStorage;
    window.parseDateForComparison = parseDateForComparison;
    window.ensureSentimentPhraseDatabaseDefaults = ensureSentimentPhraseDatabaseDefaults;
    window.renderSentimentDatabasePanel = renderSentimentDatabasePanel;
    window.saveSentimentPhraseDatabaseFromForm = saveSentimentPhraseDatabaseFromForm;
    window.syncSentimentSnapshotDateInputsFromReports = syncSentimentSnapshotDateInputsFromReports;
    window.formatSentimentSnapshotForPrompt = formatSentimentSnapshotForPrompt;
    window.buildSentimentFocusAreasForPrompt = buildSentimentFocusAreasForPrompt;
    window.containsCurseWords = containsCurseWords;
    window.censorCurseWords = censorCurseWords;
    window.buildPositiveLanguageSentimentSection = buildPositiveLanguageSentimentSection;
    window.buildNegativeLanguageSentimentSection = buildNegativeLanguageSentimentSection;
    window.buildManagingEmotionsSentimentSection = buildManagingEmotionsSentimentSection;
    window.generateSentimentSummary = generateSentimentSummary;
    window.parseSentimentReportDate = parseSentimentReportDate;
    window.handleSentimentInteractionsMatch = handleSentimentInteractionsMatch;
    window.appendParsedSentimentPhrase = appendParsedSentimentPhrase;
    window.parseSentimentKeywordLine = parseSentimentKeywordLine;
    window.logSentimentParseCompletion = logSentimentParseCompletion;
    window.isSentimentKeywordsSectionLine = isSentimentKeywordsSectionLine;
    window.isSentimentHeaderLine = isSentimentHeaderLine;
    window.parseSentimentAssociateName = parseSentimentAssociateName;
    window.createEmptySentimentReport = createEmptySentimentReport;
    window.parseSentimentFile = parseSentimentFile;
    window.extractSentimentSpeakerAndPhrase = extractSentimentSpeakerAndPhrase;
    window.openUploadSentimentModal = openUploadSentimentModal;
    window.closeUploadSentimentModal = closeUploadSentimentModal;
    window.populateSentimentAssociateDropdown = populateSentimentAssociateDropdown;
    window.handleSentimentUploadSubmit = handleSentimentUploadSubmit;
    window.processUploadedSentimentFile = processUploadedSentimentFile;
    window.copySentimentSummary = copySentimentSummary;
    window.generateSentimentCoPilotPrompt = generateSentimentCoPilotPrompt;
})();
