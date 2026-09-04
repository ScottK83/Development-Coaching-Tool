'use strict';

const { suite } = require('./harness');

const REGISTRY = {
    aht:              { unit: 'sec', isReverse: true,  label: 'Average Handle Time', target: { type: 'max', value: 414 } },
    transfers:        { unit: '%',   isReverse: true,  label: 'Transfers',           target: { type: 'max', value: 6 } },
    overallSentiment: { unit: '%',   isReverse: false, label: 'Overall Sentiment',   target: { type: 'min', value: 93 } },
    totalCalls:       { unit: '#',   isReverse: false, label: 'Total Calls' }
};

function week(end, employees, type) {
    return { metadata: { startDate: end, endDate: end, periodType: type || 'week' }, employees };
}

function setup(t, { weekly, history }) {
    t.installFakeBrowser();
    global.weeklyData = weekly;
    global.coachingHistory = history;
    global.window.METRICS_REGISTRY = REGISTRY;
    global.window.formatMetricDisplay = (k, v) =>
        (REGISTRY[k] || {}).unit === 'sec' ? `${Math.round(v)}s` : `${v}%`;
    t.loadModule('modules/metric-movement.module.js');
    return t.loadModule('modules/coaching-outcomes.module.js').coachingOutcomes;
}

// Two weeks, one rep coached on AHT, plus filler reps so the team median
// has something to stand on.
function scenario(aliceAht) {
    return {
        weekly: {
            '2026-07-06|2026-07-12': week('2026-07-12', [
                { name: 'Alice', aht: 600, overallSentiment: 90, totalCalls: 400 },
                { name: 'Bob', aht: 500, overallSentiment: 90, totalCalls: 400 },
                { name: 'Cara', aht: 500, overallSentiment: 90, totalCalls: 400 },
                { name: 'Dan', aht: 500, overallSentiment: 90, totalCalls: 400 }
            ]),
            '2026-07-13|2026-07-19': week('2026-07-19', [
                { name: 'Alice', aht: aliceAht, overallSentiment: 94, totalCalls: 400 },
                { name: 'Bob', aht: 495, overallSentiment: 90, totalCalls: 400 },
                { name: 'Cara', aht: 495, overallSentiment: 90, totalCalls: 400 },
                { name: 'Dan', aht: 495, overallSentiment: 90, totalCalls: 400 }
            ])
        },
        history: {
            Alice: [{
                employeeId: 'Alice', weekEnding: '2026-07-12',
                metricsCoached: ['aht'], generatedAt: '2026-07-13T09:00:00.000Z'
            }]
        }
    };
}

suite('coachingOutcomes — the join', (t) => {
    const api = setup(t, scenario(520)); // AHT 600 -> 520, a real improvement
    const outcomes = api.buildOutcomes('Alice');

    t.equal('one coached metric produces one outcome', outcomes.length, 1);
    const o = outcomes[0];
    t.equal('anchors on the week the coaching was based on', o.baselineEnd, '2026-07-12');
    t.equal('measures against the NEXT week', o.outcomeEnd, '2026-07-19');
    t.equal('captures the before value', o.beforeValue, 600);
    t.equal('captures the after value', o.afterValue, 520);
    t.equal('a falling AHT is a win', o.verdict, 'moved');
    t.equal('  and the wording says the number fell', o.movement.movementWord, 'fell');
});

suite('coachingOutcomes — reverse metrics are not inverted', (t) => {
    const api = setup(t, scenario(700)); // AHT 600 -> 700, worse
    const o = api.buildOutcomes('Alice')[0];

    t.equal('a rising AHT is a setback', o.verdict, 'went backwards');
    t.equal('  the number is described as rising', o.movement.movementWord, 'rose');
    t.equal('  and the verdict agrees', o.movement.verdict, 'worse');
});

suite('coachingOutcomes — controls for the team moving too', (t) => {
    // Everyone else improved by 5s. Alice improved by 80s.
    const strong = setup(t, scenario(520)).buildOutcomes('Alice')[0];
    t.equal('team median movement is measured', strong.teamDelta, 5);
    t.equal('a big personal move beats the team', strong.beatTeam, true);

    // Alice improves by only 2s while the team improves by 5s. Still an
    // improvement, but not evidence the coaching did anything.
    const weak = setup(t, scenario(598)).buildOutcomes('Alice')[0];
    t.equal('a small move does not beat the team', weak.beatTeam, false);
});

suite('coachingOutcomes — honest about what it cannot say', (t) => {
    const s = scenario(520);
    // Coaching logged, but no week has been uploaded since.
    delete s.weekly['2026-07-13|2026-07-19'];
    const pending = setup(t, s).buildOutcomes('Alice')[0];
    t.equal('no following week means pending, not a verdict', pending.verdict, 'pending');
    t.check('  and says why', /no week uploaded/.test(pending.reason));
    t.equal('  with no invented delta', pending.delta, null);

    // Too few comparable reps for a median.
    const thin = scenario(520);
    thin.weekly['2026-07-06|2026-07-12'].employees = thin.weekly['2026-07-06|2026-07-12'].employees.slice(0, 2);
    thin.weekly['2026-07-13|2026-07-19'].employees = thin.weekly['2026-07-13|2026-07-19'].employees.slice(0, 2);
    const noTeam = setup(t, thin).buildOutcomes('Alice')[0];
    t.equal('too few reps means no team comparison', noTeam.teamDelta, null);
    t.equal('  and beatTeam is null, not false', noTeam.beatTeam, null);
});

suite('coachingOutcomes — period and metric filtering', (t) => {
    const s = scenario(520);
    // A month upload sits between the two weeks; comparing a week to a month
    // measures nothing, so it must be ignored.
    s.weekly['2026-07-01|2026-07-31'] = week('2026-07-31', [{ name: 'Alice', aht: 999, totalCalls: 2000 }], 'month');
    const o = setup(t, s).buildOutcomes('Alice')[0];
    t.equal('month uploads are not used as the outcome week', o.outcomeEnd, '2026-07-19');
    t.equal('  so the comparison stays week to week', o.afterValue, 520);

    // Volume is not something you coach.
    const s2 = scenario(520);
    s2.history.Alice[0].metricsCoached = ['aht', 'totalCalls'];
    t.equal('volume metrics are skipped', setup(t, s2).buildOutcomes('Alice').length, 1);
});

suite('coachingOutcomes — crossing the target', (t) => {
    const s = scenario(520);
    s.history.Alice[0].metricsCoached = ['aht', 'overallSentiment'];
    const outcomes = setup(t, s).buildOutcomes('Alice');
    const sentiment = outcomes.find((o) => o.metricKey === 'overallSentiment');

    t.equal('sentiment 90 -> 94 moved', sentiment.verdict, 'moved');
    t.equal('  and is flagged as crossing to target', sentiment.reachedTarget, true);

    const aht = outcomes.find((o) => o.metricKey === 'aht');
    t.equal('AHT improved but is still short of 414s', aht.reachedTarget, false);
});

suite('coachingOutcomes — the rollup that answers "what lands"', (t) => {
    const weekly = {
        '2026-07-06|2026-07-12': week('2026-07-12', [
            { name: 'Alice', aht: 600, transfers: 9, totalCalls: 400 },
            { name: 'Bob', aht: 600, transfers: 9, totalCalls: 400 },
            { name: 'Cara', aht: 600, transfers: 9, totalCalls: 400 },
            { name: 'Dan', aht: 600, transfers: 9, totalCalls: 400 }
        ]),
        '2026-07-13|2026-07-19': week('2026-07-19', [
            { name: 'Alice', aht: 700, transfers: 5, totalCalls: 400 },  // AHT worse, transfers better
            { name: 'Bob', aht: 700, transfers: 5, totalCalls: 400 },
            { name: 'Cara', aht: 600, transfers: 9, totalCalls: 400 },
            { name: 'Dan', aht: 600, transfers: 9, totalCalls: 400 }
        ])
    };
    const entry = (name) => ({
        employeeId: name, weekEnding: '2026-07-12',
        metricsCoached: ['aht', 'transfers'], generatedAt: '2026-07-13T09:00:00.000Z'
    });
    const api = setup(t, { weekly, history: { Alice: [entry('Alice')], Bob: [entry('Bob')] } });

    const rows = api.summarizeByMetric(api.buildOutcomes());
    const aht = rows.find((r) => r.metricKey === 'aht');
    const transfers = rows.find((r) => r.metricKey === 'transfers');

    t.equal('AHT coaching moved nobody', aht.moved, 0);
    t.equal('  both went backwards', aht.backwards, 2);
    t.equal('transfer coaching moved both', transfers.moved, 2);
    t.equal('  giving a 100% move rate', transfers.moveRate, 1);
    t.equal('beat-team rate needs enough events to mean anything', transfers.beatTeamRate, null);
    t.check('pending events are excluded from the rollup', rows.every((r) => r.total > 0));
});

suite('coachingOutcomes — wiring', (t) => {
    const fs = require('fs');
    const path = require('path');
    const { ROOT } = require('./harness');
    const email = fs.readFileSync(path.join(ROOT, 'modules/coaching-email.module.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    t.check('both panels exist in the page',
        html.includes('id="coachingOutcomesPanel"') && html.includes('id="coachingOutcomesTeamPanel"'));
    t.check('the module is in the loader', html.includes('modules/coaching-outcomes.module.js'));
    t.check('it loads after metric-movement, whose polarity it depends on',
        html.indexOf('modules/coaching-outcomes.module.js') > html.indexOf('modules/metric-movement.module.js'));

    // Pulls one function's source out by brace-matching from its opening {.
    function bodyOf(src, signature) {
        const start = src.indexOf(signature);
        if (start === -1) return '';
        let i = src.indexOf('{', start);
        let depth = 0;
        for (let j = i; j < src.length; j++) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
        }
        return '';
    }

    const historyFn = bodyOf(email, 'function renderCoachingHistory');
    const initFn = bodyOf(email, 'function initializeCoachingEmail');
    t.check('both functions were located', historyFn.length > 0 && initFn.length > 0);

    // The team rollup is not about any one person. Rendering it from
    // renderCoachingHistory meant it stayed blank until someone was picked —
    // hiding the view most worth acting on.
    t.check('per-associate view renders on employee selection',
        historyFn.includes('renderForEmployee'));
    t.check('team rollup does NOT wait for an employee to be selected',
        !historyFn.includes('renderTeamSummary'));
    t.check('team rollup renders when the tab opens', initFn.includes('renderTeamSummary'));
});

suite('coachingOutcomes — degrades safely', (t) => {
    const api = setup(t, { weekly: {}, history: {} });
    t.equal('no data yields no outcomes, not a throw', api.buildOutcomes().length, 0);
    t.equal('  and an empty rollup', api.summarizeByMetric([]).length, 0);

    // Older entries logged a label instead of a date; fall back to the
    // timestamp rather than dropping the event.
    const s = scenario(520);
    s.history.Alice[0].weekEnding = 'this period';
    const o = setup(t, s).buildOutcomes('Alice')[0];
    t.equal('a label weekEnding falls back to generatedAt', o.baselineEnd, '2026-07-12');
});

suite('coachingOutcomes: the same coaching is not counted seven times', (t) => {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = {
        aht: { label: 'Average Handle Time', isReverse: true, unit: 'sec', target: { type: 'max', value: 426 } }
    };

    global.weeklyData = {
        w1: {
            metadata: { periodType: 'week', endDate: '2026-08-14' },
            employees: [{ name: 'Esther', aht: 520 }, { name: 'A', aht: 400 }, { name: 'B', aht: 410 }, { name: 'C', aht: 420 }]
        },
        w2: {
            metadata: { periodType: 'week', endDate: '2026-08-21' },
            employees: [{ name: 'Esther', aht: 470 }, { name: 'A', aht: 401 }, { name: 'B', aht: 409 }, { name: 'C', aht: 421 }]
        }
    };

    // Seven passes at the wording of one message, which is what regenerating
    // used to produce: seven identical rows on screen, and seven uses of the
    // same tip in the numbers the effectiveness rates are built from.
    const attempt = (minute, suggestions) => ({
        employeeId: 'Esther',
        weekEnding: '2026-08-14',
        generatedAt: '2026-08-15T12:0' + minute + ':00.000Z',
        metricsCoached: ['aht'],
        suggestions
    });

    global.coachingHistory = {
        Esther: [
            attempt(0, [{ id: 'tip-narrate', metricKey: 'aht', text: 'Narrate what you are checking' }]),
            attempt(1, [{ id: 'tip-narrate', metricKey: 'aht', text: 'Narrate what you are checking' }]),
            attempt(2, [{ id: 'tip-narrate', metricKey: 'aht', text: 'Narrate what you are checking' }]),
            attempt(3, [{ id: 'tip-narrate', metricKey: 'aht', text: 'Narrate what you are checking' }]),
            attempt(4, [{ id: 'tip-narrate', metricKey: 'aht', text: 'Narrate what you are checking' }]),
            attempt(5, [{ id: 'tip-narrate', metricKey: 'aht', text: 'Narrate what you are checking' }]),
            // The last pass dropped a tip an earlier one had offered. It was
            // still offered, so it still counts as offered.
            attempt(6, [{ id: 'tip-notes', metricKey: 'aht', text: 'Type notes while talking' }])
        ]
    };

    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/coaching-outcomes.module.js');
    const { coachingOutcomes } = global.window.DevCoachModules;

    const outcomes = coachingOutcomes.buildOutcomes('Esther');
    t.equal('seven attempts are one outcome', outcomes.length, 1);
    t.equal('and it still reads the metric correctly', outcomes[0].verdict, 'moved');

    // The newest wording is the one that went out.
    t.check('the newest attempt wins', /12:06/.test(outcomes[0].coachedAt));

    // But every tip offered along the way is still on the record.
    const ids = outcomes[0].suggestions.map((s) => s.id).sort();
    t.equal('the suggestions are unioned', ids.join(','), 'tip-narrate,tip-notes');

    // The number that matters: a tip offered seven times in one sitting is one
    // use, not seven, or every effectiveness rate is built on a miscount.
    const rows = coachingOutcomes.summarizeBySuggestion(outcomes);
    const narrate = rows.find((row) => row.id === 'tip-narrate');
    t.equal('the tip counts as given once', narrate.given, 1);
    t.equal('to one person', narrate.people, 1);

    // Coaching the same metric in a different week is a genuinely separate
    // result and must survive.
    global.coachingHistory.Esther.push({
        employeeId: 'Esther', weekEnding: '2026-08-21',
        generatedAt: '2026-08-22T12:00:00.000Z', metricsCoached: ['aht'],
        suggestions: [{ id: 'tip-notes', metricKey: 'aht', text: 'Type notes while talking' }]
    });
    t.equal('a different week is a different outcome',
        coachingOutcomes.buildOutcomes('Esther').length, 2);
});

suite('coachingOutcomes: regenerating replaces rather than appends', (t) => {
    const fs = require('fs');
    const path = require('path');
    const { ROOT } = require('./harness');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    // Stopping it at source, so history does not fill up with attempts.
    t.check('the log replaces the same day and metrics',
        /function appendCoachingLogEntry[\s\S]{0,1400}entries\[existing\] = entry/.test(script));
    t.check('matched on the day', /function appendCoachingLogEntry[\s\S]{0,1200}generatedAt \|\| ''\)\.slice\(0, 10\)/.test(script));
    t.check('and on the metrics', /function appendCoachingLogEntry[\s\S]{0,1200}metricsCoached[\s\S]{0,40}sort\(\)\.join/.test(script));

    // The panel draws its own header, so a title above it said it twice.
    t.check('the outcome panel has no duplicate heading',
        !/Did The Last Coaching Land\?/.test(html));
    t.check('but the panel is still there', html.includes('id="callOutcomesPanel"'));
});
