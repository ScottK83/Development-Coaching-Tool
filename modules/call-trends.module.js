(function() {
    'use strict';

    /**
     * Wording and rendering for what repeats across an associate's calls.
     *
     * The counting used to live here too, and it was a second independent pass
     * over the same eight transcripts: this module ran callTranscript and
     * callQa over them for its own tallies while callCoachingBridge ran both
     * over the same set for the metric chips. The same work twice, and two
     * tallies that agree only while somebody maintains both. The bridge counts
     * now, in one pass, and this module says what the counts mean.
     *
     * The labels stay here because they are this panel's voice. The bridge
     * deals in rule keys; a person reading a panel wants "no recap at the
     * close".
     */

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
        buildTrendText,
        buildTrendHtml,
        COACHING_LABELS,
        STRENGTH_LABELS
    };
})();
