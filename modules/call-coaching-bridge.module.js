(function() {
    'use strict';

    /**
     * Joins what the calls show to the metric the associate is actually missing.
     *
     * The app had both halves and no join. The call read produces behaviour
     * keys (deadAirGap, stalling, recap) and phrase hits; the tip pool is keyed
     * by metric (aht, holdTime, negativeWord). So the transcript could not
     * answer "how do I lower my AHT" and the AHT tip could not say "here is
     * where I heard it on your call".
     *
     * This is that mapping, plus three things that follow from having it:
     *
     *   - metrics are ranked by what she is genuinely missing, and only shown
     *     when the calls carry evidence for them. A metric with no evidence is
     *     not a coaching conversation, it is a number.
     *   - tips are chosen by overlap with the evidence rather than shuffled,
     *     so a dead air problem stops returning "learn keyboard shortcuts".
     *   - every suggestion carries a stable id, so coaching-outcomes can tell
     *     later whether that specific advice moved anything, and this selector
     *     reads the answer back the next time it picks.
     *
     * Evidence spans her recent calls, not just the open one. "The hold ran
     * long on four of your last six" is a different conversation from "the
     * hold ran long today", and the saved logs already hold the transcripts.
     */

    const HISTORY_WINDOW = 8;
    const MAX_FINDINGS_PER_METRIC = 4;
    const MAX_TIPS_PER_METRIC = 3;
    // How many to fall back on when nothing in the pool fits the evidence.
    // Fewer than the cap, because unmatched advice earns less room.
    const MAX_GENERIC_TIPS = 2;
    const MAX_METRICS = 4;
    // Two of anything is a coincidence worth noticing; one is just a call.
    const MIN_REPEAT_OCCURRENCES = 2;

    /* ── Short words that are specific anyway ──
     *
     * Specificity is judged by length, which works for "narrat" and "dead air"
     * and fails for domain nouns. "hold" is four characters and is the single
     * most on-topic word a hold tip can contain, so a long hold finding was
     * rating every hold tip as a weak match and falling through to generic
     * advice about slow tasks and rambling customers.
     *
     * Deliberately tiny, and only ever short words: the length rule is the
     * default and this is the exception to it, not a way to promote a vague
     * long one. A test enforces that.
     */
    const SPECIFIC_SHORT_WORDS = new Set(['hold', 'umm', 'type']);

    /* ── Evidence to metric ──
     *
     * One finding can drive several metrics, and that is the point: a long
     * unannounced hold is handle time AND hold time, and it should show up
     * under whichever of those she is actually missing.
     */
    const EVIDENCE_MAP = {
        deadAirGap: ['aht', 'acw', 'holdTime'],
        longHold: ['holdTime', 'aht'],
        holdProcess: ['holdTime', 'cxRepOverall'],
        stalling: ['aht', 'acw'],
        repeatCustomer: ['aht', 'fcr', 'managingEmotions', 'cxRepOverall'],
        uncertainty: ['aht', 'fcr', 'negativeWord'],
        apologyLoop: ['aht', 'negativeWord'],
        filler: ['aht', 'negativeWord'],
        airtime: ['aht'],
        callControl: ['aht'],
        coldTransfer: ['transfers', 'fcr'],
        deflection: ['negativeWord', 'fcr', 'cxRepOverall', 'transfers'],
        recap: ['fcr', 'cxRepOverall'],
        nextSteps: ['fcr', 'cxRepOverall'],
        checkUnderstanding: ['fcr'],
        courtesyClose: ['positiveWord', 'cxRepOverall'],
        greeting: ['positiveWord', 'cxRepOverall'],
        education: ['fcr'],
        verification: ['cxRepOverall'],
        empathy: ['managingEmotions', 'cxRepOverall', 'overallSentiment'],
        supervisorRequest: ['managingEmotions', 'cxRepOverall', 'fcr'],
        // Synthetic keys, produced from the word choice scan rather than the
        // behaviour rules.
        negativePhrase: ['negativeWord', 'overallSentiment', 'cxRepOverall'],
        positiveUnused: ['positiveWord', 'overallSentiment'],
        emotionUnanswered: ['managingEmotions', 'cxRepOverall', 'overallSentiment'],
        // From the QA form. Same treatment as everything else: they rank by
        // which KPI the associate is actually missing.
        qaDisclosures: ['cxRepOverall', 'fcr'],
        qaVerification: ['cxRepOverall'],
        qaProcess: ['fcr', 'cxRepOverall'],
        qaResolved: ['fcr', 'cxRepOverall'],
        qaOffering: ['fcr', 'cxRepOverall'],
        qaAssistance: ['positiveWord', 'cxRepOverall'],
        qaPayment: ['fcr', 'cxRepOverall']
    };

    /* ── The QA form's own findings, said out loud ──
     *
     * The QA read was supervisor-only: the panel showed it, the prompt was
     * told to keep it out of the email, and the written message never touched
     * it. So a new service call where six of the nine required disclosures
     * never came up produced a message about hold length and nothing else.
     * That is the most concrete, most checkable coaching on the whole call and
     * it was being withheld.
     *
     * Mapped to the KPIs each one actually moves, so they rank with everything
     * else rather than being bolted on.
     *
     * `coachable: false` is the important column. An audio problem, a system
     * error or a dropped call is on the QA form because it explains the call,
     * not because she did anything. Telling her to fix a system error is worse
     * than saying nothing: it is feedback she cannot act on, attached to
     * something that was not her fault.
     */
    const QA_POINTS = {
        disclosures: { coachable: true, metrics: ['cxRepOverall', 'fcr'] },
        verification: { coachable: true, metrics: ['cxRepOverall'] },
        process: { coachable: true, metrics: ['fcr', 'cxRepOverall'] },
        resolved: { coachable: true, metrics: ['fcr', 'cxRepOverall'] },
        'Long Hold': { coachable: true, metrics: ['holdTime', 'aht'] },
        'Solution/Program Offering Missed': {
            coachable: true,
            metrics: ['fcr', 'cxRepOverall'],
            text: 'There was a plan or a program that would have fitted here and it did not get offered. Worth mentioning even when they have not asked.'
        },
        'Offering Assistance': {
            coachable: true,
            metrics: ['positiveWord', 'cxRepOverall'],
            text: 'The call wrapped up without asking whether there was anything else. It only takes a second and it is the line customers remember.'
        },
        'Did not Negotiate Payment': {
            coachable: true,
            metrics: ['fcr', 'cxRepOverall'],
            text: 'The customer said money was tight and no arrangement was offered. Where they raise it, put the options in front of them.'
        },
        // Not hers. Context for the supervisor, never coaching for her.
        'Audio Issues': { coachable: false },
        'System Errors': { coachable: false },
        'Call Dropped': { coachable: false }
    };

    // Lower case, because most uses are mid-sentence. The one that leads a
    // sentence capitalises it: "Four of the Six things" was the alternative.
    const COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

    function countWord(value) {
        const n = Number(value) || 0;
        return COUNT_WORDS[n] || String(n);
    }

    function sentenceCase(value) {
        const text = String(value || '');
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
    }

    /**
     * The disclosures that did not come up, named.
     *
     * Built from the check's own `missed` labels rather than its `detail`
     * string, which reads "Heard 3 of 9. Not heard: ..." and is a form field.
     * The labels themselves are already plain English, so naming them is both
     * the casual wording and the specific one.
     */
    function describeMissedDisclosures(check) {
        const missed = Array.isArray(check.missed) ? check.missed : [];
        if (!missed.length) return '';

        const total = missed.length + (Array.isArray(check.heard) ? check.heard.length : 0);
        const labels = missed.map(label => String(label).charAt(0).toLowerCase() + String(label).slice(1));

        // Semicolons when a label carries its own comma, which one of them
        // does: "plan can be changed, and when a change takes effect" reads as
        // two separate items in a comma list.
        const named = labels.some(label => label.includes(','))
            ? labels.join('; ')
            : joinList(labels);

        const scale = total > missed.length
            ? sentenceCase(`${countWord(missed.length)} of the ${countWord(total)} things we have to cover on a call like this did not come up`)
            : 'The things we have to cover on a call like this did not come up';

        return `${scale}: ${named}.`;
    }

    /**
     * One QA finding, worded for her, or null when it is not hers to fix.
     */
    function describeQaPoint(kind, key, detail, check) {
        const rule = QA_POINTS[key];
        if (!rule || !rule.coachable) return null;
        if (rule.text) return rule.text;

        if (key === 'disclosures') return describeMissedDisclosures(check || {});

        // The check's own detail, with the form label stripped off the front.
        const said = humanizeFinding(String(detail || ''));
        return said || null;
    }

    function qaMetricsFor(key) {
        return QA_POINTS[key]?.metrics || [];
    }

    // QA's own ids and labels, to the finding keys EVIDENCE_MAP knows.
    const QA_CHECK_KEYS = {
        disclosures: 'qaDisclosures',
        verification: 'qaVerification',
        process: 'qaProcess',
        resolved: 'qaResolved'
    };

    const QA_LABEL_KEYS = {
        'Long Hold': 'longHold',
        'Solution/Program Offering Missed': 'qaOffering',
        'Offering Assistance': 'qaAssistance',
        'Did not Negotiate Payment': 'qaPayment'
    };

    /* ── Which words in a tip mean it addresses this finding ──
     *
     * The pools are 40-odd tips per metric and most of them are irrelevant to
     * any one problem. These are the words that separate "narrate what you are
     * checking" from "learn keyboard shortcuts" when the finding is dead air.
     */
    const FINDING_KEYWORDS = {
        // "while talking", not "talking": the bare word matched "handle time
        // isn't talking fast", which has nothing to do with dead air, and it
        // counted as a specific match because of its length.
        deadAirGap: ['silence', 'dead air', 'narrat', 'quiet', 'loading', 'while you', 'while talking', 'type'],
        longHold: ['hold', 'wait', 'check back', 'checking'],
        holdProcess: ['hold', 'permission', 'thank', 'ask'],
        stalling: ['one moment', 'loading', 'narrat', 'silence', 'tell the customer', 'checking'],
        repeatCustomer: ['listen', 'repeat', 'recap', 'heard', 'notes', 'first time'],
        uncertainty: ['confiden', 'verify', 'plainly', 'sure', 'commit', 'hedg'],
        apologyLoop: ['apolog', 'sorry'],
        // Matching is on substrings, so "um" is inside "customer" and "number".
        // "umm" is how the tips actually write the sound.
        filler: ['umm', 'filler', 'pause'],
        airtime: ['open question', 'let the customer', 'listen', 'ask'],
        callControl: ['control', 'agenda', 'steer', 'redirect', 'rambl'],
        coldTransfer: ['transfer', 'warm', 'brief', 'right team', 'connect'],
        deflection: ['can do', 'instead', 'offer', 'policy', 'next step', 'what i can'],
        recap: ['recap', 'summar', 'confirm', 'restate'],
        nextSteps: ['next step', 'time frame', 'by when', 'expect', 'happens'],
        checkUnderstanding: ['make sense', 'understood', 'questions'],
        courtesyClose: ['anything else', 'close', 'before you', 'end'],
        greeting: ['greeting', 'open', 'brand', 'name'],
        education: ['app', 'website', 'online', 'self serv', 'future'],
        empathy: ['empath', 'acknowledge', 'hear', 'frustrat', 'understand'],
        supervisorRequest: ['escalat', 'supervisor', 'manager', 'own'],
        // Was mapped to a metric with no keywords, so a verification finding
        // could only ever return generic advice.
        verification: ['verif', 'identity', 'date of birth', 'last four', 'security question'],
        emotionUnanswered: ['acknowledge', 'empath', 'frustrat', 'hear', 'calm', 'upset'],
        qaDisclosures: ['disclos', 'rate plan', 'deposit', 'quote', 'explain', 'cover'],
        qaVerification: ['verif', 'identity', 'date of birth', 'last four'],
        qaProcess: ['explain', 'next step', 'what happens', 'time frame'],
        qaResolved: ['resolv', 'first call', 'call back', 'follow through'],
        qaOffering: ['offer', 'plan', 'program', 'self serv', 'options'],
        qaAssistance: ['anything else', 'close', 'before you'],
        qaPayment: ['payment', 'arrangement', 'afford', 'past due', 'budget billing']
    };

    /* ── Helpers ── */

    function metricLabel(metricKey) {
        return (window.METRICS_REGISTRY || {})[metricKey]?.label || metricKey;
    }

    function formatValue(metricKey, value) {
        return typeof window.formatMetricDisplay === 'function'
            ? window.formatMetricDisplay(metricKey, value)
            : String(value);
    }

    /**
     * A stable id for a piece of advice, so the same tip given in March and in
     * September aggregates into one row.
     *
     * Derived from the text rather than a position in the pool, because tips
     * get added, edited and deleted and an index would silently re-point at
     * different advice. The trade is that editing a tip's wording starts its
     * history over, which is defensible: reworded advice is different advice.
     */
    function suggestionId(text) {
        const normalized = String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        let hash = 5381;
        for (let index = 0; index < normalized.length; index++) {
            hash = (((hash << 5) + hash) ^ normalized.charCodeAt(index)) >>> 0;
        }
        return `t${hash.toString(36)}`;
    }

    /**
     * Does this tip contain the keyword, as a word rather than as letters?
     *
     * The keywords are stems on purpose: "narrat" is meant to catch narrate and
     * narrating, "verif" to catch verify and verification. Plain substring
     * matching gave that for free and gave a great deal else with it, because
     * a short stem hides inside ordinary words. "um" was inside customer and
     * number. "umm" is inside summary. "app" is inside happy. "end" is inside
     * recommend. Every one of those was a keyword silently matching tips it had
     * nothing to do with.
     *
     * Anchoring to the start of a word keeps the stemming and loses the
     * accidents: a stem still matches any ending, and no longer matches a word
     * that merely contains it.
     */
    function matchesStem(text, keyword) {
        const stem = String(keyword || '').trim();
        if (!stem) return false;
        const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}`, 'i').test(text);
    }

    function callLabel(count, total) {
        if (total <= 1) return 'on this call';
        // "on 2 of the last 2 calls" is a clumsy way to say "on both", and the
        // clumsiness reads as generated text in a message somebody receives.
        if (count >= total) return total === 2 ? 'on both calls' : `on all ${total} calls`;
        if (count <= 1) return `on 1 of the last ${total} calls`;
        return `on ${count} of the last ${total} calls`;
    }

    /* ── Gathering the evidence ── */

    function scoreOneCall(entry) {
        const analyzer = window.DevCoachModules?.callTranscript;
        const wordChoice = window.DevCoachModules?.callWordChoice;
        const scorer = window.DevCoachModules?.callQa;
        if (!entry?.transcript || !analyzer?.analyzeTranscript) return null;

        const analysis = analyzer.analyzeTranscript(entry.transcript, { associateName: entry.employeeName });
        const scan = wordChoice?.scanTranscript?.(entry.transcript, {
            associateName: entry.employeeName,
            analysis
        });
        // Scored here too, so the repeat QA opportunities come out of the same
        // pass rather than a second one somewhere else.
        const qa = scorer?.scoreCall?.(entry.transcript, {
            associateName: entry.employeeName,
            context: { silenceGaps: analysis.silenceGaps || [] }
        });

        return { entry, analysis, scan: scan?.ok ? scan : null, qa: qa || null };
    }

    function entryTime(entry) {
        const stamp = Date.parse(entry?.listenedOn || '') || Date.parse(entry?.createdAt || '');
        return Number.isNaN(stamp) ? 0 : (stamp || 0);
    }

    /**
     * Identifies a call by what was said on it.
     *
     * The same call gets saved more than once: generating a prompt and copying
     * the Verint note both write a log, so one transcript can end up stored
     * under two dates. Counting those as two calls makes the message claim a
     * habit across "both calls" when there was one call, which is the message
     * telling the associate something untrue.
     *
     * Matching on the text rather than the date, because a duplicate saved on a
     * different day is still the same conversation. The leading bracket header
     * that prepareForStorage adds is dropped first, since the pasted copy and
     * the stored copy of one call differ by exactly that.
     */
    function callFingerprint(transcript) {
        const raw = String(transcript || '');
        // Reduced to what was actually said, because that is what identifies a
        // call. prepareForStorage drops the export header, the blank QA form
        // and the legal footer and prepends a bracketed summary, so the pasted
        // copy and the stored copy of one call are very different strings with
        // the same conversation inside them.
        const strip = window.DevCoachModules?.callTranscript?.stripBoilerplate;
        const spoken = typeof strip === 'function' ? (strip(raw) || raw) : raw;

        const body = spoken
            .replace(/^\s*\[[^\]]*\]\s*/, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        if (!body) return '';

        // The opening of the call, and deliberately not its length. Storage
        // truncates at MAX_STORED_TRANSCRIPT_CHARS, so a long call's saved copy
        // is a shortened version of what was pasted and the two can never agree
        // on a length. Truncation only ever removes from the end, so a prefix is
        // the part both copies are guaranteed to share.
        //
        // 600 characters is well past any greeting, so two different calls
        // colliding here would have to open identically at length.
        return body.slice(0, 600);
    }

    /**
     * Reads the open call plus the recent saved logs and returns one row per
     * distinct problem, carrying how many calls it appeared on.
     *
     * The open call is counted like any other, so a supervisor looking at a
     * transcript they have not saved yet still sees it reflected.
     */
    function collectFindings(options = {}) {
        const scored = [];
        const seen = new Set();

        if (options.analysis) {
            const fingerprint = callFingerprint(options.transcript);
            if (fingerprint) seen.add(fingerprint);

            // The open call needs its QA read scored here. It used to be
            // pushed without one, so every QA finding on the call actually in
            // front of the supervisor was dropped and only the saved history
            // could contribute any. Which is the call they care about most.
            const scorer = window.DevCoachModules?.callQa;
            const openQa = (scorer?.scoreCall && options.transcript)
                ? scorer.scoreCall(options.transcript, {
                    associateName: options.associateName,
                    context: { silenceGaps: options.analysis.silenceGaps || [] }
                })
                : null;

            scored.push({
                entry: {
                    listenedOn: options.callDate || '',
                    callTime: options.callTime || '',
                    employeeName: options.associateName || ''
                },
                analysis: options.analysis,
                scan: options.wordChoice?.ok ? options.wordChoice : null,
                qa: openQa
            });
        }

        const history = (Array.isArray(options.history) ? options.history : [])
            .slice()
            .sort((a, b) => entryTime(b) - entryTime(a))
            .filter(entry => entry?.transcript)
            // One call counted once, however many times it was saved and under
            // whatever dates. Without this, a transcript stored twice reads as
            // a pattern across two calls.
            .filter(entry => {
                const fingerprint = callFingerprint(entry.transcript);
                if (!fingerprint || seen.has(fingerprint)) return false;
                seen.add(fingerprint);
                return true;
            })
            .slice(0, HISTORY_WINDOW - (options.analysis ? 1 : 0));

        history.forEach(entry => {
            const result = scoreOneCall(entry);
            if (result) scored.push(result);
        });

        const total = scored.length;
        const rows = {};

        const bump = (key, kind, text, extra = {}) => {
            // A finding no metric maps cannot be ranked or shown, so dropping
            // it here beats carrying it to a panel that will ignore it.
            if (!key) return;
            const id = extra.phrase ? `${key}:${extra.phrase}` : key;
            const row = rows[id] || (rows[id] = {
                id,
                key,
                kind,
                text,
                phrase: extra.phrase || '',
                quote: '',
                at: null,
                count: 0,
                dates: []
            });
            row.count += 1;
            if (extra.date) row.dates.push(extra.date);
            if (!row.quote && extra.quote) {
                row.quote = extra.quote;
                row.at = typeof extra.at === 'number' ? extra.at : null;
            }
            // Weight follows the transcript engine's own ranking where it has
            // one, so the coaching order here agrees with the email drafts.
            if (typeof extra.weight === 'number') {
                row.weight = Math.max(row.weight || 0, extra.weight);
            }
        };

        // Counted alongside the findings so nothing has to rescore this history
        // a second time. call-trends used to run both engines over the same
        // eight transcripts for its own repeat counts, which was the same work
        // twice and two tallies that only agree while both are maintained.
        const strengthRows = {};
        const opportunityRows = {};

        scored.forEach(({ entry, analysis, scan, qa }) => {
            const date = entry.listenedOn || '';

            (analysis.allImprovements || []).forEach(item => {
                bump(item.key, 'behaviour', item.text, {
                    date, quote: item.quote, weight: item.weight
                });
            });

            (analysis.allStrengths || []).forEach(item => {
                const row = strengthRows[item.key] || (strengthRows[item.key] = { label: item.key, count: 0, dates: [] });
                row.count += 1;
                if (date) row.dates.push(date);
            });

            const noteOpportunity = (label) => {
                if (!label) return;
                const row = opportunityRows[label] || (opportunityRows[label] = { label, count: 0, dates: [] });
                row.count += 1;
                if (date) row.dates.push(date);
            };
            (qa?.callOpportunities || []).forEach(item => noteOpportunity(item.label));
            (qa?.techOpportunities || []).forEach(item => noteOpportunity(item.label));
            (qa?.checks || [])
                .filter(check => check.verdict === 'opportunity')
                .forEach(check => noteOpportunity(String(check.question || '').replace(/\?$/, '')));

            // The QA findings become coaching, not just a tally for the trends
            // panel. They were the most concrete thing on the call and the only
            // part the message never mentioned.
            const addQaFinding = (findingKey, qaKey, detail, check, quote) => {
                const said = describeQaPoint('qa', qaKey, detail, check);
                if (!said) return;
                bump(findingKey, 'qa', said, { date, quote: quote || '', weight: 8 });
            };

            (qa?.checks || [])
                .filter(check => check.verdict === 'opportunity')
                .forEach(check => addQaFinding(QA_CHECK_KEYS[check.id], check.id, check.detail, check, check.evidence));

            (qa?.callOpportunities || []).forEach(item => {
                // The engine already reports a long hold, with the measured
                // duration and the moment it started. Saying it twice from two
                // sources reads as two problems.
                if (item.label === 'Long Hold' && rows.longHold) return;
                addQaFinding(QA_LABEL_KEYS[item.label], item.label, item.evidence, null, item.evidence);
            });

            // techOpportunities are deliberately not here. An audio problem or
            // a system error is context for the supervisor, not something she
            // can act on.

            if (!scan) return;

            scan.negativeA.forEach(hit => {
                bump('negativePhrase', 'phrase', `Says "${hit.phrase}", which is on the scored negative list.`, {
                    date, quote: hit.quote, at: hit.at, phrase: hit.phrase, weight: 6
                });
            });

            scan.unusedPositives.forEach(item => {
                bump('positiveUnused', 'unused', `Never says "${item.phrase}"${item.zone ? `, and the call had ${item.zone} to say it on` : ''}.`, {
                    date, phrase: item.phrase, weight: 4
                });
            });

            scan.emotions.unanswered.forEach(cue => {
                bump('emotionUnanswered', 'emotion', 'A customer got upset and it went unacknowledged.', {
                    date, quote: cue.quote, at: cue.at, weight: 9
                });
            });
        });

        // Two detectors reach the same event from different directions: the
        // transcript engine's empathy rule fires when an emotional call went
        // unacknowledged, and the word choice scan fires per unanswered cue off
        // Verint's own emotion list. Listing both reads as two problems when
        // there is one. The empathy row survives because it says what to do
        // about it; the scan row only names the fact.
        if (rows.empathy && rows.emotionUnanswered) {
            delete rows.emotionUnanswered;
        }

        // Which calls this read covers, newest first and in words the associate
        // can place. Carried out of here because only this function knows which
        // entries were actually scored.
        const format = window.DevCoachModules?.callTranscript?.formatCallMoment;
        const momentFor = {};
        const callMoments = scored
            .map(({ entry }) => {
                const moment = typeof format === 'function'
                    ? format(entry.listenedOn, entry.callTime)
                    : String(entry.listenedOn || '');
                if (entry.listenedOn && moment) momentFor[entry.listenedOn] = moment;
                return moment;
            })
            .filter(Boolean);

        // Two of anything is a coincidence worth noticing; one is just a call.
        const repeating = (map) => Object.values(map)
            .filter(row => row.count >= MIN_REPEAT_OCCURRENCES)
            .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));

        // The trends panel counts behaviours by rule key and puts its own
        // wording on them, so it needs the key as the label.
        const coachingRows = {};
        Object.values(rows)
            .filter(row => row.kind === 'behaviour')
            .forEach(row => { coachingRows[row.key] = { label: row.key, count: row.count, dates: row.dates }; });

        return {
            ok: total > 0,
            callsReviewed: total,
            callsWithoutTranscript: Math.max(0, (Array.isArray(options.history) ? options.history : [])
                .filter(entry => !entry?.transcript).length),
            callMoments,
            // What repeats across the set, for the trends panel. Same pass,
            // same numbers as the findings above.
            consistentStrengths: repeating(strengthRows),
            repeatOpportunities: repeating(opportunityRows),
            repeatCoaching: repeating(coachingRows),
            findings: Object.values(rows).map(row => ({
                ...row,
                weight: row.weight || 5,
                callsTotal: total,
                appearsOn: callLabel(row.count, total),
                // Which calls, in words. "On the September 3 call you did X"
                // is checkable in a way "this came up twice" is not.
                moments: row.dates.map(date => momentFor[date]).filter(Boolean)
            }))
        };
    }

    /* ── Ranking the metrics ── */

    /**
     * The metrics worth a button: ones she is missing, that the calls can
     * actually speak to, hardest miss first.
     *
     * Metrics with no evidence are dropped rather than shown empty. A button
     * that opens on "nothing found in the calls" is worse than no button,
     * because it teaches you not to press them.
     */
    function metricsInFocus(allMetrics, findings) {
        const evidenceFor = {};
        (findings || []).forEach(finding => {
            (EVIDENCE_MAP[finding.key] || []).forEach(metricKey => {
                (evidenceFor[metricKey] = evidenceFor[metricKey] || []).push(finding);
            });
        });

        return (Array.isArray(allMetrics) ? allMetrics : [])
            .filter(metric => !metric.meetsTarget)
            .map(metric => ({
                ...metric,
                evidence: (evidenceFor[metric.metricKey] || [])
                    .slice()
                    .sort((a, b) => (b.count - a.count) || (b.weight - a.weight))
            }))
            .filter(metric => metric.evidence.length > 0)
            .sort((a, b) => {
                // Classification first so a Needs Focus metric outranks a
                // Watch Area one, then the size of the miss.
                const rank = (metric) => metric.classification === 'Needs Focus' ? 0 : 1;
                return rank(a) - rank(b) || (b.gapFromTarget || 0) - (a.gapFromTarget || 0);
            })
            .slice(0, MAX_METRICS);
    }

    /**
     * The KPIs a finding speaks to. Empty for a behaviour that is worth
     * coaching but does not move anything the associate is measured on.
     */
    function metricsForFinding(key) {
        return EVIDENCE_MAP[key] || [];
    }

    /**
     * Reorders drafted feedback so what matters to this associate's KPIs comes
     * first.
     *
     * The transcript engine ranks by how serious a behaviour is in general,
     * which is the right default and the wrong answer for a specific person. A
     * missing recap outranks filler words everywhere, but for somebody whose
     * only problem is handle time the filler words are the ones that move a
     * number they are judged on.
     *
     * Stable within each group, so the engine's own severity ordering still
     * decides between two findings that are equally relevant. Nothing is
     * dropped: a finding that touches no KPI is still worth saying, it just
     * stops going first.
     */
    function prioritizeByMetrics(items, missedMetricKeys) {
        const missed = new Set(missedMetricKeys || []);
        if (!missed.size) return (items || []).slice();

        const relevance = (item) => {
            const metrics = metricsForFinding(item.key);
            if (!metrics.length) return 2;
            return metrics.some(metricKey => missed.has(metricKey)) ? 0 : 1;
        };

        return (items || [])
            .map((item, index) => ({ item, index, rank: relevance(item) }))
            .sort((a, b) => a.rank - b.rank || a.index - b.index)
            .map(entry => entry.item);
    }

    /**
     * Which of this associate's missed KPIs the feedback actually speaks to,
     * for telling the supervisor what the ordering was based on.
     */
    function missedMetricsCovered(items, missedMetricKeys) {
        const missed = new Set(missedMetricKeys || []);
        const covered = new Set();
        (items || []).forEach(item => {
            metricsForFinding(item.key).forEach(metricKey => {
                if (missed.has(metricKey)) covered.add(metricKey);
            });
        });
        return [...covered];
    }

    /* ── Choosing the tips ── */

    function tipsForMetric(metricKey) {
        if (typeof getMetricTips === 'function') {
            const pool = getMetricTips(metricKey);
            return Array.isArray(pool) ? pool : [];
        }
        return [];
    }

    /**
     * Ranks a metric's tip pool against the evidence, then against what has
     * actually worked before.
     *
     * Relevance dominates on purpose. Effectiveness is a real signal but a thin
     * one for a long time, so it adjusts the order of already-relevant tips
     * instead of promoting an irrelevant tip that happened to do well. A tip
     * with no relevance hit can still be picked, but only to fill the last
     * slots when the evidence matched nothing in the pool.
     */
    /**
     * The tips worth searching for this evidence.
     *
     * The metric's own pool first, then the pools of whatever else the evidence
     * drives. A long hold is handle time AND hold time, and the tips about
     * checking back on a hold live in the hold time pool, so a hold finding
     * shown under the handle time chip could not reach them and fell through
     * to generic advice about slow tasks and rambling customers.
     *
     * Widening the search is safe because the relevance filter still decides:
     * a tip from another pool only survives if it matches this evidence.
     * Deduplicated by text, since the pools overlap.
     */
    function poolForEvidence(metricKey, evidence) {
        const metrics = [metricKey];
        (evidence || []).forEach(finding => {
            metricsForFinding(finding.key).forEach(key => {
                if (!metrics.includes(key)) metrics.push(key);
            });
        });

        const seen = new Set();
        const pool = [];
        metrics.forEach(key => {
            tipsForMetric(key).forEach(tip => {
                const text = String(tip);
                if (seen.has(text)) return;
                seen.add(text);
                pool.push(text);
            });
        });
        return pool;
    }

    function selectTips(metricKey, evidence, options = {}) {
        const pool = poolForEvidence(metricKey, evidence);
        if (!pool.length) return [];

        const effectiveness = options.effectiveness || {};
        const alreadyGiven = new Set(options.alreadyGiven || []);

        // A keyword's specificity decides how much a match is worth. "dead
        // air", "narrat" and "one moment" only appear in advice about silence;
        // "wait", "ask" and "hold" turn up all over a tip pool about calls.
        //
        // This is why "Avoid over-apologizing, one genuine 'I'm sorry for the
        // wait' is enough" came back as a dead air tip. It matched "wait", and
        // one common word was enough to look relevant.
        //
        // Judged by length and word count rather than a hand tagged list, so
        // adding a keyword cannot quietly forget to say how specific it is.
        // SPECIFIC_SHORT_WORDS is the exception, for the handful of domain
        // nouns the length rule gets wrong.
        const strong = new Set();
        const weak = new Set();
        (evidence || []).forEach(finding => {
            (FINDING_KEYWORDS[finding.key] || []).forEach(word => {
                const specific = word.length >= 5 || word.includes(' ') || SPECIFIC_SHORT_WORDS.has(word);
                if (specific) strong.add(word);
                else weak.add(word);
            });
            // For a phrase finding the phrase itself is the strongest possible
            // keyword: the tips are written as swaps and literally contain it.
            if (finding.phrase) strong.add(finding.phrase.toLowerCase());
        });

        const scored = pool.map(tip => {
            const lower = String(tip).toLowerCase();
            const strongHits = [...strong].filter(word => matchesStem(lower, word)).length;
            const weakHits = [...weak].filter(word => matchesStem(lower, word)).length;
            const id = suggestionId(tip);
            const record = effectiveness[id];

            let score = (strongHits * 10) + (weakHits * 2);
            if (record && record.rate !== null) score += record.rate * 5;
            // Advice this person has already been given did not need repeating:
            // either it worked, or it did not, and saying it again is the one
            // thing known not to be new information.
            if (alreadyGiven.has(id)) score -= 12;

            return {
                id,
                text: tip,
                score,
                // One distinctive word, or several common ones agreeing.
                relevant: strongHits > 0 || weakHits >= 3,
                effectiveness: record || null
            };
        });

        const byScore = (a, b) => b.score - a.score || a.text.localeCompare(b.text);
        const relevant = scored.filter(item => item.relevant).sort(byScore);

        // Two solid tips beat three with a filler in it. Padding the list to
        // the cap is what put an apology tip under a dead air finding, and a
        // tip that obviously does not fit teaches the reader to skim the ones
        // that do.
        const chosen = relevant.length
            ? relevant.slice(0, MAX_TIPS_PER_METRIC)
            // Nothing in the pool addresses this evidence, which is worth
            // knowing. General advice is still better than an empty list, and
            // the flag tells the panel to say what it is.
            : scored.sort(byScore).slice(0, MAX_GENERIC_TIPS);

        return chosen.map(item => ({
            id: item.id,
            metricKey,
            text: item.text,
            matchedEvidence: item.relevant,
            effectiveness: item.effectiveness
        }));
    }

    /**
     * Everything needed to coach one metric off the calls.
     */
    function buildMetricBrief(metric, options = {}) {
        const evidence = (metric.evidence || []).slice(0, MAX_FINDINGS_PER_METRIC);
        const tips = selectTips(metric.metricKey, evidence, options);
        const name = metric.label || metricLabel(metric.metricKey);

        return {
            metricKey: metric.metricKey,
            label: name,
            headline: `${name}: ${formatValue(metric.metricKey, metric.employeeValue)} against a target of ${formatValue(metric.metricKey, metric.target)}`,
            classification: metric.classification,
            evidence,
            tips
        };
    }

    /* ── Output ── */

    function evidenceLine(finding) {
        // The quotes come off a transcript and often end in their own full
        // stop, so borrow it rather than printing "second.".
        const quoted = String(finding.quote || '').replace(/\s*\.+$/, '');
        const quote = quoted ? ` Heard it here: "${quoted}".` : '';
        return `- ${finding.text} Came up ${finding.appearsOn}.${quote}`;
    }

    /**
     * The Copilot prompt for one metric.
     *
     * It hands over the evidence and the chosen tips and asks for a message
     * about those, because the whole point is that the associate asked a
     * specific question and the calls contain a specific answer.
     */
    /* ── What the topic is called out loud ──
     *
     * The internal metric name is what a scorecard calls it, not what a person
     * would. "How long your calls are running" is the same subject in language
     * an associate uses, and it keeps the message from reading like a report.
     */
    // Two forms, because the message talks to the associate and the prompt
    // talks about them. `self` is second person for the message; `other` is
    // third person for the prompt, and uses they/their, since the roster is 127
    // people whose pronouns this app has never been told.
    const TOPIC_PHRASES = {
        aht: { self: 'how long your calls are running', other: 'how long their calls are running' },
        acw: { self: 'the time you spend wrapping up after a call', other: 'the time they spend wrapping up after a call' },
        holdTime: { self: 'how long customers wait on hold', other: 'how long customers wait on hold' },
        transfers: { self: 'how often calls get passed to another team', other: 'how often calls get passed to another team' },
        fcr: { self: 'getting things sorted on the first call', other: 'getting things sorted on the first call' },
        negativeWord: { self: 'some of the wording that comes up on your calls', other: 'some of the wording that comes up on their calls' },
        positiveWord: { self: 'the wording that lands well with customers', other: 'the wording that lands well with customers' },
        managingEmotions: { self: 'handling calls where the customer is upset', other: 'handling calls where the customer is upset' },
        cxRepOverall: { self: 'how customers are rating your calls', other: 'how customers are rating their calls' },
        overallSentiment: { self: 'the overall tone of your calls', other: 'the overall tone of their calls' },
        scheduleAdherence: { self: 'sticking to the schedule', other: 'sticking to the schedule' }
    };

    function topicFor(brief, voice) {
        const phrases = TOPIC_PHRASES[brief.metricKey];
        if (phrases) return voice === 'self' ? phrases.self : phrases.other;
        return String(brief.label || '').toLowerCase();
    }

    /**
     * The Copilot prompt for one metric.
     *
     * Written to say what is actually happening, because the earlier version
     * did not and got refused. It opened "I'm a supervisor writing to Esther
     * about one metric", handed over her figure against target, and asked for
     * coaching, which reads exactly like asking a model to evaluate a named
     * employee's performance. That is not what this is: the supervisor did the
     * listening, the app matched the evidence, and the actions are already
     * chosen. The only job left is the wording.
     *
     * So the prompt says so, gives the observations as the supervisor's own,
     * asks for no assessment, and leaves out the figure against target, which
     * was the most evaluation-shaped thing in it and was never meant to appear
     * in the message anyway.
     */
    function buildMetricPrompt(brief, options = {}) {
        const name = options.preferredName || options.associateName || 'my teammate';
        const asked = options.askedQuestion
            ? `\nThey asked me: "${options.askedQuestion}"\n`
            : '';

        const evidence = brief.evidence.length
            ? brief.evidence.map(evidenceLine).join('\n')
            : '- Nothing specific stood out.';

        const tips = brief.tips.length
            ? brief.tips.map(tip => `- ${tip.text}`).join('\n')
            : '- Nothing to suggest yet.';

        const proven = brief.tips.filter(tip => tip.effectiveness && tip.effectiveness.rate !== null);
        const provenNote = proven.length
            ? `\nMy own note, leave it out of the message: ${proven.map(tip => `"${tip.text}" has worked for ${Math.round(tip.effectiveness.rate * 100)}% of the ${tip.effectiveness.rateSample} people I have suggested it to`).join('; ')}.\n`
            : '';

        const momentsPlural = (count) => count > 1 ? `, and mention I went back over ${count} of them` : '';

        // Which calls this came from, so she can go and remember them. A note
        // about her call handling in the abstract is an opinion; one about the
        // call she took at lunchtime on Tuesday is something she can check.
        const moments = Array.isArray(options.callMoments) ? options.callMoments.filter(Boolean) : [];
        const callsSection = moments.length
            ? `\nThe calls I sat in on, most recent first:\n${moments.map(moment => `- ${moment}`).join('\n')}\n`
            : '';
        const momentRule = moments.length
            ? `\n- Name the calls by day and time so they know which ones I mean. Lead with ${moments[0]}${momentsPlural(moments.length)}`
            : '';

        return `I have already listened to some of my teammate ${name}'s calls and written down what I want to say to them. I am not asking you to assess them, rate them, or work out what they should improve. I have done that part. Everything below is my own observation and my own choice of what to suggest.

What I need is the wording: turn my notes into a short, friendly message in my voice, written to ${name} directly as "you".

The subject is ${topicFor(brief, 'other')}.
${asked}${callsSection}
What I noticed, in my words:
${evidence}

What I want to suggest they try:
${tips}
${provenNote}
Write the message.

Requirements:
- Use only the notes above. Do not add observations of your own, do not judge or rate anything, and do not introduce anything I have not said
- Open by answering their question directly, leading with what to change
- Quote the short phrase from a call where it helps, so they can hear the moment I mean
- Keep the suggestions concrete and practical, in the words I used
- Where something came up on several calls, say so plainly. That is more useful than one example and it is the honest framing
- Warm and matter of fact. They asked me for help, so this is help
- 1 short opening, 2 to 3 suggestions, 1 friendly closing line
- Do NOT use em dashes${momentRule}
- No jargon. Talk about calls and customers, not scores, targets or word counts
- Return ONLY the message body text.`;
    }

    /**
    /* ── Naming the pattern ──
     *
     * A list of separate findings is a list. Saying what they have in common
     * is the thing a supervisor does that a rules engine does not, and it is
     * what makes several calls worth more than one: "the pattern I keep seeing
     * is silence" lands where "dead air on two calls, long hold on one" does
     * not.
     *
     * Grouped by what the associate would actually change, not by which rule
     * fired, which is why holdProcess and deadAirGap sit together.
     */
    const PATTERN_FAMILIES = [
        {
            key: 'silence',
            keys: ['deadAirGap', 'longHold', 'stalling', 'holdProcess'],
            phrase: 'silence: stretches where the customer is waiting and does not know what you are doing'
        },
        {
            key: 'closing',
            keys: ['recap', 'nextSteps', 'courtesyClose', 'checkUnderstanding'],
            phrase: 'the close: the call ending without a recap or a clear next step'
        },
        {
            key: 'wording',
            keys: ['negativePhrase', 'deflection', 'positiveUnused'],
            phrase: 'wording that closes a door rather than opening one'
        },
        {
            key: 'emotion',
            keys: ['empathy', 'emotionUnanswered', 'supervisorRequest'],
            phrase: 'moments where the customer was upset and it went past unacknowledged'
        },
        {
            key: 'confidence',
            keys: ['uncertainty', 'apologyLoop', 'filler'],
            phrase: 'answers that sound unsure even when they are right'
        },
        {
            key: 'listening',
            keys: ['repeatCustomer', 'airtime', 'callControl'],
            phrase: 'the customer having to say things twice'
        },
        {
            key: 'process',
            keys: ['verification', 'coldTransfer', 'greeting', 'education'],
            phrase: 'the steps around the call rather than the conversation itself'
        }
    ];

    /**
     * The pattern across the evidence, or nothing when there is not one.
     *
     * Requires the family to account for more than one finding or to have hit
     * more than one call. A single finding on a single call is an incident, and
     * calling it a pattern is the kind of overstatement that costs a message
     * its credibility.
     */
    function describePattern(evidence, callsTotal) {
        const items = Array.isArray(evidence) ? evidence : [];
        if (!items.length) return null;

        const tallies = PATTERN_FAMILIES.map(family => {
            const matched = items.filter(finding => family.keys.includes(finding.key));
            const calls = new Set();
            matched.forEach(finding => (finding.moments || []).forEach(moment => calls.add(moment)));
            return { family, findings: matched.length, calls: calls.size };
        }).filter(row => row.findings > 0);

        if (!tallies.length) return null;

        tallies.sort((a, b) => b.calls - a.calls || b.findings - a.findings);
        const best = tallies[0];
        if (best.findings < 2 && best.calls < 2) return null;

        return {
            key: best.family.key,
            phrase: best.family.phrase,
            findings: best.findings,
            calls: best.calls,
            callsTotal: callsTotal || 0
        };
    }

    /**
     * "September 3", for referring to one call inside a sentence.
     *
     * The full "Thursday, September 3 at 6:35 PM" is right for a list and far
     * too heavy to repeat in every line of a paragraph.
     */
    // "a, b and c". Repeating "and" between every item is the tell that a
    // machine built the sentence.
    function joinList(items) {
        const values = (items || []).filter(Boolean);
        if (values.length <= 1) return values[0] || '';
        if (values.length === 2) return `${values[0]} and ${values[1]}`;
        return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
    }

    function shortMoment(moment) {
        const text = String(moment || '').trim();
        if (!text) return '';
        return text.replace(/^[A-Za-z]+day,\s*/, '').replace(/\s+at\s+.*$/, '').trim() || text;
    }

    /**
     * Turns a supervisor's bullet into something you would say out loud.
     *
     * The findings are written for the supervisor's own notes and read like
     * report fields when sent on: "Long hold: about 4m 05s of silence starting
     * at 5:54". The label prefix and the stopwatch formatting are what make a
     * message look machine written, so both go.
     *
     * Only formatting is touched. The advice itself is left exactly as written,
     * because rewording it here would put a second voice next to the one the
     * drafts and the QA notes already use.
     */
    function humanizeFinding(text) {
        const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

        let sentence = String(text || '')
            // "Long hold:", "Confidence:", "Hold process:" and friends.
            .replace(/^[A-Z][A-Za-z]*(?: [a-z]+){0,2}:\s*/, '');

        sentence = sentence
            // "4m 05s" is a stopwatch reading. Nobody says that.
            .replace(/\b(\d+)m\s*(\d{1,2})s\b/g, (whole, minutes, seconds) => {
                const m = Number(minutes);
                const rounded = Number(seconds) >= 30 ? m + 1 : m;
                const word = WORDS[rounded] || String(rounded);
                return rounded ? `${word} minute${rounded === 1 ? '' : 's'}` : `${seconds} seconds`;
            })
            .replace(/\b(\d+)s\b/g, '$1 seconds');

        return sentence.charAt(0).toUpperCase() + sentence.slice(1);
    }

    /**
     * Writes the message here, with no model involved.
     *
     * Everything a coaching note needs is already on the brief, and the only
     * thing Copilot was adding was prose, so a refusal from it should not be
     * able to stop a supervisor answering a question their associate asked.
     *
     * On what this deliberately does NOT include, having tried it: a recap of
     * the call. Scott read the version that opened with one and it was plainly
     * wrong. The associate was on the call. Telling her a 39 minute call
     * happened, reciting the four things she did on it, and quoting the
     * customer's opening line back at her from raw speech-to-text, "i ask you i
     * got an apartment i sign - lease today", is a case file with second person
     * pronouns dropped into it. She does not need to be told what happened on
     * her own call; she needs to know which call it was and what to change.
     *
     * So the call is identified in the opening sentence and that is all. The
     * full recap still exists, for the panel and the Verint note, where the
     * person reading it was not on the call.
     */
    function buildMetricMessage(brief, options = {}) {
        const name = options.preferredName || options.associateName || '';
        const moments = Array.isArray(options.callMoments) ? options.callMoments.filter(Boolean) : [];
        const topic = topicFor(brief, 'self');
        // "the 39 minute call" places it better than "the call" and costs four
        // words. The subject is left out: it is already in the topic above.
        const label = String(options.callLabel || '').trim() || 'call';

        // How many calls, and which ones, said up front. "I listened to four
        // of your calls" is the sentence that makes everything after it
        // evidence rather than opinion, and listing the days lets them check.
        const listened = !moments.length
            // No dates known, so the count is not known either. "A few" would
            // be a guess about how many calls this is.
            ? `I had a proper listen to your recent calls`
            : moments.length === 1
                ? `I listened back to the ${label} you took on ${moments[0]}`
                : `I have listened to ${moments.length} of your calls over the past few days`;

        const opening = options.askedQuestion
            ? `You asked me about ${topic}, so ${listened}.`
            // Not "I had a look at X, so I listened back to Y": the causality
            // runs the wrong way. With a question the "so" earns its place;
            // without one the listening comes first and the subject follows.
            : `${listened.charAt(0).toUpperCase()}${listened.slice(1)}, and had a look at ${topic}.`;

        const callList = moments.length > 1
            ? moments.map(moment => `  ${moment}`).join('\n')
            : '';

        // The pattern, where there is one. This is the part a list of findings
        // cannot say for itself.
        //
        // Worded by how many calls it spans. "The pattern I keep seeing" says
        // repetition across calls, so on a single call it read as "the pattern
        // I keep seeing is silence. It came up on 1 of them", which claims a
        // history that does not exist. Two findings from one family on one
        // call is still worth naming; it is a theme, not a pattern.
        const pattern = describePattern(brief.evidence, moments.length);
        let patternLine = '';

        if (pattern && moments.length > 1) {
            const span = pattern.calls === moments.length ? `all ${moments.length}` : String(pattern.calls);
            patternLine = `The pattern I keep seeing is ${pattern.phrase}. It came up on ${span} of them.`;
        } else if (pattern) {
            // Not "one thing: silence: stretches where...". The phrases carry
            // their own colon, so the sentence around them cannot add another.
            patternLine = `It all comes back to ${pattern.phrase}.`;
        } else if (!brief.evidence.length) {
            // Nothing stood out, so there is nothing to introduce. Reachable
            // only by calling this directly: a metric with no evidence never
            // gets a chip.
            patternLine = '';
        } else {
            patternLine = brief.evidence.length === 1
                ? 'Here is the one thing that stood out.'
                : 'Here is what stood out.';
        }

        // Ordered so the findings that make up the stated pattern come first.
        // Announcing a pattern of silence and then leading with hedging reads
        // as though the two paragraphs were written by different people.
        const family = pattern
            ? (PATTERN_FAMILIES.find(item => item.key === pattern.key)?.keys || [])
            : [];
        const ordered = brief.evidence
            .map((finding, index) => ({ finding, index, inPattern: family.includes(finding.key) ? 0 : 1 }))
            .sort((a, b) => a.inPattern - b.inPattern || a.index - b.index)
            .map(row => row.finding);

        // Attributed to the call it happened on, so each point is checkable
        // against a conversation they can actually remember.
        const observations = ordered.map(finding => {
            // Only worth naming when there is more than one call to tell
            // apart. With a single call the opening already said which one,
            // and "On the September 3 call" under it says it twice.
            const where = moments.length > 1
                ? (finding.moments || []).map(shortMoment).filter(Boolean)
                : [];
            let prefix = '';

            if (where.length && where.length === moments.length) {
                // Naming four days when the answer is "all of them" is longer
                // and says less.
                prefix = `On all ${moments.length} calls, `;
            } else if (where.length === 1) {
                prefix = `On the ${where[0]} call, `;
            } else if (where.length > 1) {
                const shown = where.slice(0, 3);
                const rest = where.length - shown.length;
                prefix = `On the ${joinList(shown)} call${where.length > 1 ? 's' : ''}${rest ? ` and ${rest} other${rest === 1 ? '' : 's'}` : ''}, `;
            }

            const text = humanizeFinding(finding.text);
            const sentence = prefix
                ? `${prefix}${text.charAt(0).toLowerCase()}${text.slice(1)}`
                : text;

            // The quote earns its place when there are several calls: it is
            // what lets them find the moment being described.
            const quoted = moments.length > 1 ? String(finding.quote || '').replace(/\s*\.+$/, '') : '';
            const heard = quoted ? `\n  I heard you say "${quoted}"` : '';
            return `- ${sentence}${heard}`;
        });

        // Whether the last round worked. The whole point of tracking it is to
        // say so out loud: it tells them the effort registered, and it tells
        // them whether this is a continuation or a change of approach.
        const priorLine = describePriorCoaching(options.priorOutcome, topic);

        const actions = brief.tips.map(tip => `- ${tip.text}`);
        const actionsHeader = actions.length === 1
            ? 'One thing worth trying:'
            : `${actions.length === 2 ? 'Two' : 'A few'} things worth trying:`;

        const closing = 'Give those a go and I will listen again soon to see how it is landing. Come find me if you want to talk any of it through.';

        return [
            name ? `Hi ${name},` : 'Hi,',
            '',
            opening,
            ...(callList ? ['', callList] : []),
            ...(patternLine ? ['', patternLine] : []),
            '',
            ...(observations.length ? [observations.join('\n'), ''] : []),
            ...(priorLine ? [priorLine, ''] : []),
            ...(actions.length ? [actionsHeader, actions.join('\n'), ''] : []),
            closing
        ].join('\n');
    }

    /**
     * What happened after the last time this was coached.
     *
     * Reads an outcome coaching-outcomes already computed rather than
     * recomputing anything, and says nothing at all when the verdict is
     * pending, because "we are still waiting on data" is a sentence for the
     * supervisor and not for the associate.
     *
     * Credit where it moved, honesty where it did not. A message that only
     * ever says "here is another thing to fix" teaches people that improving
     * goes unnoticed.
     */
    function describePriorCoaching(outcome, topic) {
        if (!outcome || outcome.verdict === 'pending') return '';

        const before = outcome.beforeLabel;
        const after = outcome.afterLabel;
        const move = (before && after) ? ` It went from ${before} to ${after}.` : '';

        if (outcome.verdict === 'moved') {
            const beat = outcome.beatTeam === true
                ? ' That was better than the centre managed over the same week, so it was you rather than the week.'
                : '';
            return `Last time we talked about ${topic}, it moved the right way the following week.${move}${beat} Worth knowing the change you made registered.`;
        }

        if (outcome.verdict === 'went backwards') {
            return `Last time we talked about ${topic} it went the other way the following week.${move} That usually means the advice did not fit the problem, so I have picked something different below.`;
        }

        return `Last time we talked about ${topic} it held about where it was.${move} So instead of saying the same thing again, here is a different angle.`;
    }

    function buttonsHtml(briefs, escapeHtml) {
        const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        if (!Array.isArray(briefs) || !briefs.length) return '';

        return briefs.map((brief, index) => {
            const tone = brief.classification === 'Needs Focus' ? 'warn' : 'watch';
            return `<button type="button" class="call-metric-chip call-metric-${tone}" data-metric-key="${safe(brief.metricKey)}"${index === 0 ? ' data-default="1"' : ''}>
                <span class="call-metric-chip-label">${safe(brief.label)}</span>
                <span class="call-metric-chip-detail">${brief.evidence.length} thing${brief.evidence.length === 1 ? '' : 's'} from her calls</span>
            </button>`;
        }).join('');
    }

    function briefHtml(brief, escapeHtml) {
        const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        if (!brief) return '';

        const evidence = brief.evidence.map(finding => {
            const quote = finding.quote
                ? `<div class="call-qa-detail">"${safe(finding.quote)}"</div>`
                : '';
            return `<li><strong>${safe(finding.text)}</strong> <span class="call-qa-detail">${safe(finding.appearsOn)}</span>${quote}</li>`;
        }).join('');

        const tips = brief.tips.map(tip => {
            const record = tip.effectiveness;
            let track = '';
            if (record && record.rate !== null) {
                track = `<span class="call-qa-detail">${Math.round(record.rate * 100)}% ${safe(record.rateBasis)} over ${record.rateSample} uses</span>`;
            } else if (record && record.given) {
                track = `<span class="call-qa-detail">given ${record.given} time${record.given === 1 ? '' : 's'}, too early to say</span>`;
            }
            return `<li>${safe(tip.text)} ${track}</li>`;
        }).join('');

        // Said out loud rather than hidden. If nothing in the pool addresses
        // what the calls showed, that is a gap in the tip library and the
        // person who can close it is the one reading this.
        const unmatched = brief.tips.length && brief.tips.every(tip => !tip.matchedEvidence)
            ? '<div class="call-qa-detail">Nothing in this metric\'s tips speaks to what the calls showed, so these are general. Worth adding one that does.</div>'
            : '';

        return `<div class="call-trend-group call-trend-warn">
                <div class="call-trend-title">${safe(brief.headline)}</div>
                <ul>${evidence}</ul>
            </div>
            <div class="call-trend-group call-trend-good">
                <div class="call-trend-title">What to ask her to try</div>
                <ul>${tips}</ul>
                ${unmatched}
            </div>`;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callCoachingBridge = {
        EVIDENCE_MAP,
        FINDING_KEYWORDS,
        suggestionId,
        matchesStem,
        SPECIFIC_SHORT_WORDS,
        callFingerprint,
        collectFindings,
        metricsInFocus,
        metricsForFinding,
        prioritizeByMetrics,
        missedMetricsCovered,
        selectTips,
        buildMetricBrief,
        buildMetricPrompt,
        buildMetricMessage,
        humanizeFinding,
        describePattern,
        describePriorCoaching,
        shortMoment,
        PATTERN_FAMILIES,
        TOPIC_PHRASES,
        buttonsHtml,
        briefHtml,
        HISTORY_WINDOW,
        MAX_TIPS_PER_METRIC
    };
})();
