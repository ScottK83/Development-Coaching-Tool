(function() {
    'use strict';

    /**
     * Reads an associate's saved call logs as a set rather than one at a time.
     *
     * A single call gives you a conversation. Six calls give you a pattern, and
     * "the hold ran long on four of your last six" is a different coaching
     * conversation from "the hold ran long today". The logs already hold the
     * transcripts, so this rescores them and counts what keeps coming back.
     */

    const DEFAULT_WINDOW = 8;
    // Two of anything is a coincidence worth noticing; one is just a call.
    const MIN_OCCURRENCES = 2;

    function entryTime(entry) {
        const stamp = Date.parse(entry?.listenedOn || '') || Date.parse(entry?.createdAt || '');
        return Number.isNaN(stamp) ? 0 : (stamp || 0);
    }

    function scoreEntry(entry) {
        const analyzer = window.DevCoachModules?.callTranscript;
        const scorer = window.DevCoachModules?.callQa;
        if (!entry?.transcript || !analyzer?.analyzeTranscript || !scorer?.scoreCall) return null;

        const analysis = analyzer.analyzeTranscript(entry.transcript, { associateName: entry.employeeName });
        const qa = scorer.scoreCall(entry.transcript, {
            associateName: entry.employeeName,
            context: { silenceGaps: analysis.silenceGaps || [] }
        });

        return { entry, analysis, qa };
    }

    function bump(counter, key, listenedOn) {
        if (!counter[key]) counter[key] = { label: key, count: 0, dates: [] };
        counter[key].count += 1;
        if (listenedOn) counter[key].dates.push(listenedOn);
    }

    function sortByCount(counter) {
        return Object.values(counter).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    }

    /**
     * Rescores the most recent logs that carry a transcript and reports what
     * repeats. Entries saved before transcripts existed are counted separately
     * rather than silently ignored.
     */
    function summarizeHistory(entries, options = {}) {
        const list = Array.isArray(entries) ? entries : [];
        const windowSize = options.windowSize || DEFAULT_WINDOW;
        const score = typeof options.scoreEntry === 'function' ? options.scoreEntry : scoreEntry;

        // Callers hand this list over in whichever order suits them, so sort on
        // the entries themselves rather than trusting the order they arrive in.
        const recent = list
            .slice()
            .sort((a, b) => entryTime(b) - entryTime(a))
            .slice(0, windowSize);
        const scored = recent.map(score).filter(Boolean);

        const opportunities = {};
        const coaching = {};
        const strengths = {};

        scored.forEach(({ entry, analysis, qa }) => {
            const on = entry.listenedOn || '';

            (qa.callOpportunities || []).forEach(item => bump(opportunities, item.label, on));
            (qa.techOpportunities || []).forEach(item => bump(opportunities, item.label, on));
            (qa.checks || [])
                .filter(check => check.verdict === 'opportunity')
                .forEach(check => bump(opportunities, check.question.replace(/\?$/, ''), on));

            (analysis.allImprovements || []).forEach(item => bump(coaching, item.key, on));
            (analysis.allStrengths || []).forEach(item => bump(strengths, item.key, on));
        });

        const repeating = (counter) => sortByCount(counter).filter(item => item.count >= MIN_OCCURRENCES);

        return {
            ok: scored.length > 0,
            callsReviewed: scored.length,
            callsWithoutTranscript: recent.length - scored.length,
            windowSize,
            repeatOpportunities: repeating(opportunities),
            repeatCoaching: repeating(coaching),
            consistentStrengths: repeating(strengths)
        };
    }

    const COACHING_LABELS = {
        empathy: 'empathy not acknowledged',
        verification: 'verification not heard',
        recap: 'no recap at the close',
        nextSteps: 'next steps not set',
        courtesyClose: 'no offer of further help',
        greeting: 'opening not branded',
        deflection: 'dead end language',
        repeatCustomer: 'customer repeating themselves',
        supervisorRequest: 'supervisor requested',
        longHold: 'long hold',
        deadAirGap: 'dead air',
        stalling: 'silence fillers',
        uncertainty: 'hedging language',
        apologyLoop: 'over apologising',
        filler: 'filler words',
        holdProcess: 'hold without permission',
        coldTransfer: 'cold transfer',
        airtime: 'carrying too much of the talk time',
        callControl: 'losing call control'
    };

    const STRENGTH_LABELS = {
        greeting: 'branded openings',
        empathy: 'empathy',
        ownership: 'ownership',
        verification: 'verification',
        holdEtiquette: 'hold etiquette',
        optionsOffered: 'offering the full set of options',
        recommendation: 'making a recommendation',
        education: 'educating on self service',
        checkUnderstanding: 'checking understanding',
        recap: 'recapping the resolution',
        nextSteps: 'setting next steps',
        courtesyClose: 'closing properly',
        customerReaction: 'customers saying thank you',
        positiveExperience: 'Verint positive experience hits'
    };

    function describe(item, labels) {
        return labels[item.label] || item.label;
    }

    function buildTrendText(summary, preferredName) {
        if (!summary?.ok) return '';

        const name = preferredName || 'They';
        const of = `of the last ${summary.callsReviewed} call${summary.callsReviewed === 1 ? '' : 's'}`;
        const lines = [];

        summary.consistentStrengths.slice(0, 3).forEach(item => {
            lines.push(`- ${describe(item, STRENGTH_LABELS)}: ${item.count} ${of}. This is a habit, not a one off.`);
        });

        summary.repeatOpportunities.slice(0, 3).forEach(item => {
            lines.push(`- ${item.label}: flagged on ${item.count} ${of}.`);
        });

        summary.repeatCoaching.slice(0, 3).forEach(item => {
            lines.push(`- ${describe(item, COACHING_LABELS)}: came up on ${item.count} ${of}.`);
        });

        if (!lines.length) return '';
        return `Across ${name}'s recent calls:\n${lines.join('\n')}`;
    }

    function buildTrendHtml(summary, escapeHtml) {
        const safe = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        if (!summary?.ok) return '';

        const group = (title, items, labels, tone) => {
            if (!items.length) return '';
            const rows = items.slice(0, 4).map(item => `<li><strong>${safe(labels ? describe(item, labels) : item.label)}</strong> on ${item.count} of ${summary.callsReviewed}${item.dates.length ? ` <span class="call-qa-detail">(${safe(item.dates.slice(0, 4).join(', '))})</span>` : ''}</li>`).join('');
            return `<div class="call-trend-group call-trend-${tone}">
                <div class="call-trend-title">${safe(title)}</div>
                <ul>${rows}</ul>
            </div>`;
        };

        const groups = [
            group('Doing consistently well', summary.consistentStrengths, STRENGTH_LABELS, 'good'),
            group('Repeat QA opportunities', summary.repeatOpportunities, null, 'warn'),
            group('Repeat coaching themes', summary.repeatCoaching, COACHING_LABELS, 'warn')
        ].filter(Boolean).join('');

        if (!groups) {
            return `<div class="call-qa-detail">Nothing has repeated across the last ${summary.callsReviewed} call${summary.callsReviewed === 1 ? '' : 's'} yet.</div>`;
        }

        const caveat = summary.callsWithoutTranscript
            ? `<div class="call-qa-detail">${summary.callsWithoutTranscript} older log${summary.callsWithoutTranscript === 1 ? '' : 's'} had no transcript saved and could not be included.</div>`
            : '';

        return `${groups}${caveat}`;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callTrends = {
        summarizeHistory,
        buildTrendText,
        buildTrendHtml,
        DEFAULT_WINDOW,
        MIN_OCCURRENCES
    };
})();
