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
     * Reads the open call plus the recent saved logs and returns one row per
     * distinct problem, carrying how many calls it appeared on.
     *
     * The open call is counted like any other, so a supervisor looking at a
     * transcript they have not saved yet still sees it reflected.
     */
    function collectFindings(options = {}) {
        const scored = [];

        if (options.analysis) {
            scored.push({
                entry: { listenedOn: options.callDate || '', employeeName: options.associateName || '' },
                analysis: options.analysis,
                scan: options.wordChoice?.ok ? options.wordChoice : null
            });
        }

        const history = (Array.isArray(options.history) ? options.history : [])
            .slice()
            .sort((a, b) => entryTime(b) - entryTime(a))
            .filter(entry => entry?.transcript)
            // The open call is usually already saved from an earlier pass, so
            // counting the saved copy as well would double every finding on it.
            .filter(entry => !options.callDate || entry.listenedOn !== options.callDate)
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

        return {
            callsReviewed: total,
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
    function buildMetricPrompt(brief, options = {}) {
        const name = options.preferredName || options.associateName || 'the associate';
        const asked = options.askedQuestion
            ? `\nShe asked me directly: "${options.askedQuestion}"\n`
            : '';

        const evidence = brief.evidence.length
            ? brief.evidence.map(evidenceLine).join('\n')
            : '- No specific evidence found in the calls.';

        const tips = brief.tips.length
            ? brief.tips.map(tip => `- ${tip.text}`).join('\n')
            : '- No tip available for this metric.';

        const proven = brief.tips.filter(tip => tip.effectiveness && tip.effectiveness.rate !== null);
        const provenNote = proven.length
            ? `\nFor my reference only, do not mention this in the message: ${proven.map(tip => `"${tip.text}" has ${tip.effectiveness.rateBasis} for ${Math.round(tip.effectiveness.rate * 100)}% of the ${tip.effectiveness.rateSample} times it has been given`).join('; ')}.\n`
            : '';

        return `I'm a supervisor writing to ${name} about one metric, based on calls of hers I listened to.
${asked}
The metric:
${brief.headline}

What her calls actually show:
${evidence}

The specific things I want her to try:
${tips}
${provenNote}
Write a short, personal message to ${name}.

Requirements:
- Open by answering the question directly. She wants to know what to change, so lead with that rather than restating her numbers back at her
- Ground every point in the calls. Quote the short phrase where it helps, so she can hear the moment you mean
- Be specific about the fix. "Tell the customer what you are checking instead of asking them to keep waiting" is coaching; "work on your handle time" is not
- Where a habit showed up across several calls, say so plainly. A pattern is more persuasive than one example, and it is also the honest framing
- Warm and matter of fact. She asked for help, so this is help, not a correction
- 1 short opening, 2 to 3 specific actions, 1 closing line
- Do NOT use em dashes
- Do not mention phrase lists, scoring, keyword counts, or metric targets as jargon. Talk about calls and customers
- Return ONLY the message body text.`;
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
        collectFindings,
        metricsInFocus,
        selectTips,
        buildMetricBrief,
        buildMetricPrompt,
        buttonsHtml,
        briefHtml,
        HISTORY_WINDOW,
        MAX_TIPS_PER_METRIC
    };
})();
