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
    const MAX_METRICS = 4;

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
        emotionUnanswered: ['managingEmotions', 'cxRepOverall', 'overallSentiment']
    };

    /* ── Which words in a tip mean it addresses this finding ──
     *
     * The pools are 40-odd tips per metric and most of them are irrelevant to
     * any one problem. These are the words that separate "narrate what you are
     * checking" from "learn keyboard shortcuts" when the finding is dead air.
     */
    const FINDING_KEYWORDS = {
        deadAirGap: ['silence', 'dead air', 'narrat', 'quiet', 'loading', 'while you', 'type', 'talking'],
        longHold: ['hold', 'wait', 'check back', 'checking'],
        holdProcess: ['hold', 'permission', 'thank', 'ask'],
        stalling: ['one moment', 'loading', 'narrat', 'silence', 'tell the customer', 'checking'],
        repeatCustomer: ['listen', 'repeat', 'recap', 'heard', 'notes', 'first time'],
        uncertainty: ['confiden', 'verify', 'plainly', 'sure', 'commit', 'hedg'],
        apologyLoop: ['apolog', 'sorry'],
        filler: ['um', 'filler', 'pause'],
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
        emotionUnanswered: ['acknowledge', 'empath', 'frustrat', 'hear', 'calm', 'upset']
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
        if (!entry?.transcript || !analyzer?.analyzeTranscript) return null;

        const analysis = analyzer.analyzeTranscript(entry.transcript, { associateName: entry.employeeName });
        const scan = wordChoice?.scanTranscript?.(entry.transcript, {
            associateName: entry.employeeName,
            analysis
        });

        return { entry, analysis, scan: scan?.ok ? scan : null };
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
            scored.push({
                entry: {
                    listenedOn: options.callDate || '',
                    callTime: options.callTime || '',
                    employeeName: options.associateName || ''
                },
                analysis: options.analysis,
                scan: options.wordChoice?.ok ? options.wordChoice : null
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

        scored.forEach(({ entry, analysis, scan }) => {
            const date = entry.listenedOn || '';

            (analysis.allImprovements || []).forEach(item => {
                bump(item.key, 'behaviour', item.text, {
                    date, quote: item.quote, weight: item.weight
                });
            });

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
        const callMoments = scored
            .map(({ entry }) => typeof format === 'function'
                ? format(entry.listenedOn, entry.callTime)
                : String(entry.listenedOn || ''))
            .filter(Boolean);

        return {
            callsReviewed: total,
            callMoments,
            findings: Object.values(rows).map(row => ({
                ...row,
                weight: row.weight || 5,
                callsTotal: total,
                appearsOn: callLabel(row.count, total)
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
    function selectTips(metricKey, evidence, options = {}) {
        const pool = tipsForMetric(metricKey);
        if (!pool.length) return [];

        const effectiveness = options.effectiveness || {};
        const alreadyGiven = new Set(options.alreadyGiven || []);

        const keywords = [];
        (evidence || []).forEach(finding => {
            (FINDING_KEYWORDS[finding.key] || []).forEach(word => keywords.push(word));
            // For a phrase finding the phrase itself is the strongest possible
            // keyword: the tips are written as swaps and literally contain it.
            if (finding.phrase) keywords.push(finding.phrase.toLowerCase());
        });

        const scored = pool.map(tip => {
            const lower = String(tip).toLowerCase();
            const hits = keywords.filter(word => lower.includes(word)).length;
            const id = suggestionId(tip);
            const record = effectiveness[id];

            let score = hits * 10;
            if (record && record.rate !== null) score += record.rate * 5;
            // Advice this person has already been given did not need repeating:
            // either it worked, or it did not, and saying it again is the one
            // thing known not to be new information.
            if (alreadyGiven.has(id)) score -= 12;

            return { id, text: tip, hits, score, effectiveness: record || null };
        });

        return scored
            .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
            .slice(0, MAX_TIPS_PER_METRIC)
            .map(item => ({
                id: item.id,
                metricKey,
                text: item.text,
                matchedEvidence: item.hits > 0,
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

        const listened = !moments.length
            ? `I had a proper listen to a few of your ${label}s`
            : moments.length === 1
                ? `I listened back to the ${label} you took on ${moments[0]}`
                : `I went back over ${moments.length} of your recent calls, most recently the one on ${moments[0]}`;

        const leadIn = brief.evidence.length === 1
            ? 'Here is the one thing that stood out.'
            : 'Here is what stood out.';

        const opening = options.askedQuestion
            ? `You asked me about ${topic}, so ${listened}. ${leadIn}`
            : `I had a look at ${topic}. ${listened}. ${leadIn}`;

        const observations = brief.evidence.map(finding => {
            // The quote is dropped when there is only one call in play: she was
            // there, and on an unlabelled transcript it is the line the parser
            // guessed at. It stays for a pattern across calls, where quoting
            // the moment is what makes the pattern findable.
            const quoted = moments.length > 1 ? String(finding.quote || '').replace(/\s*\.+$/, '') : '';
            const heard = quoted ? `\n  You said: "${quoted}"` : '';
            const where = moments.length > 1 ? ` Came up ${finding.appearsOn}.` : '';
            return `- ${humanizeFinding(finding.text)}${where}${heard}`;
        });

        const actions = brief.tips.map(tip => `- ${tip.text}`);
        const actionsHeader = actions.length === 1
            ? 'One thing worth trying:'
            : `${actions.length === 2 ? 'Two' : 'A few'} things worth trying:`;

        const closing = 'Give those a go and I will listen again soon to see how it is landing. Come find me if you want to talk any of it through.';

        return [
            name ? `Hi ${name},` : 'Hi,',
            '',
            opening,
            '',
            ...(observations.length ? [observations.join('\n'), ''] : []),
            ...(actions.length ? [actionsHeader, actions.join('\n'), ''] : []),
            closing
        ].join('\n');
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

        return `<div class="call-trend-group call-trend-warn">
                <div class="call-trend-title">${safe(brief.headline)}</div>
                <ul>${evidence}</ul>
            </div>
            <div class="call-trend-group call-trend-good">
                <div class="call-trend-title">What to ask her to try</div>
                <ul>${tips}</ul>
            </div>`;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callCoachingBridge = {
        EVIDENCE_MAP,
        FINDING_KEYWORDS,
        suggestionId,
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
        TOPIC_PHRASES,
        buttonsHtml,
        briefHtml,
        HISTORY_WINDOW,
        MAX_TIPS_PER_METRIC
    };
})();
