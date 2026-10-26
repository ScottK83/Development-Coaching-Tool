'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * COACHING, LOGGED WHEN IT GOES OUT
 *
 * The 2026-10-25 deep dive: the coaching log could not say what works. The
 * main Calls flow logged nothing, the Today page logged a tip every time a
 * message was drafted (103 of 255 "tips given" were redrafts), and only the
 * metric chips under More logged which tips were given. Now a call is logged
 * when it goes to Verint, to the email or to Outlook, and a Today message
 * when it is marked sent, each as one record however often it goes out.
 *
 * The functions are taken from script.js and run against stubs, so this
 * tests the code the page runs.
 */

const SCRIPT = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

function slice(from, to) {
    const start = SCRIPT.indexOf(from);
    const end = SCRIPT.indexOf(to, start + from.length);
    if (start < 0 || end < 0) throw new Error(`could not find ${from}`);
    return SCRIPT.slice(start, end);
}

function load(options = {}) {
    const source = [
        slice('function appendCoachingLogEntry(entry) {', 'function getCoachingHistoryForEmployee('),
        slice('function recordCoachingEvent({', '// ============================================\n// EMAIL GENERATION')
    ].join('\n');
    const history = {};
    const saves = { count: 0 };
    const modules = {
        callCoachingBridge: {
            suggestionId: (text) => `t${String(text).length}`,
            metricsForFinding: (key) => ({ recap: ['fcr'], nextSteps: ['fcr'] }[key] || []),
            callFingerprint: (text) => `print:${String(text).length}`
        },
        callTranscript: { analyzeTranscript: () => ({ ok: true }) },
        callListening: { tipsForEntry: () => options.callTips || [] }
    };
    const api = new Function('coachingHistory', 'saveCoachingHistory', 'findLatestPeriodForAssociate', 'logAppError', 'window', 'console',
        `${source}; return { appendCoachingLogEntry, removeCoachingLogEntry, recordCoachingEvent, recordCallCoaching, rememberTodayTip, recordTodayCoaching, removeTodayCoaching };`)(
        history,
        () => { saves.count += 1; },
        () => ({ period: { metadata: { endDate: '2026-10-18' } } }),
        () => {},
        { DevCoachModules: modules },
        { warn() {} }
    );
    return { api, history, saves };
}

const TIP = 'Say the numbers once clearly instead of three times quickly.';
const OTHER = 'Read the last note before you ask them to walk you through the history.';

suite('coaching log: a Today message is logged when it is marked sent, with the tips that were in it', (t) => {
    const { api, history } = load();
    api.rememberTodayTip('Dana Lopez', 'aht', TIP);
    api.rememberTodayTip('Dana Lopez', 'acw', OTHER);

    api.recordTodayCoaching('Dana Lopez', `Hey Dana,\n\nNice work this week.\n\nTip: ${TIP}\n\nYou've got this!`, 'tuesday', '2026-10-20');
    const log = history['Dana Lopez'] || [];
    t.equal('one record', log.length, 1);
    t.equal('for the tip that was in the message, not the one only drafted', JSON.stringify(log[0].metricsCoached), JSON.stringify(['aht']));
    t.equal('with the tip itself', log[0].suggestions[0].text, TIP);
    t.check('and an id the outcomes can count by', Boolean(log[0].suggestions[0].id));
    t.equal('from Today', log[0].source, 'today');
    t.equal('measured from the latest week', log[0].weekEnding, '2026-10-18');

    api.recordTodayCoaching('Dana Lopez', `Tip: ${TIP}`, 'tuesday', '2026-10-20');
    t.equal('marked sent twice is still one record', history['Dana Lopez'].length, 1);

    api.removeTodayCoaching('Dana Lopez', 'tuesday', '2026-10-20');
    t.equal('Undo takes it back out', history['Dana Lopez'].length, 0);

    api.recordTodayCoaching('Sam Lee', 'Hey Sam, great week.', 'tuesday', '2026-10-20');
    t.check('a message with no tip in it logs nothing', !(history['Sam Lee'] || []).length);
});

suite('coaching log: a call is logged once, from its scorecard, when it goes out', (t) => {
    const { api, history } = load({ callTips: [{ findingKey: 'recap', id: 'tRecap', text: 'Close with a recap.' }] });
    const entry = {
        id: 'c1',
        employeeName: 'Dana Lopez',
        listenedOn: '2026-09-29',
        transcript: '00:04\nthank you for calling',
        scorecard: {
            missedMetrics: ['fcr', 'cxRepOverall', 'reliability', 'positiveWord', 'aht'],
            lines: [{ key: 'recap', verdict: 'missed' }, { key: 'greeting', verdict: 'yes' }, { key: 'anythingElse', verdict: 'missed' }]
        }
    };

    api.recordCallCoaching(entry, { aiAssisted: true });
    const log = history['Dana Lopez'];
    t.equal('one record', log.length, 1);
    t.equal('the metrics the missed lines move, three at most, never reliability',
        JSON.stringify(log[0].metricsCoached), JSON.stringify(['fcr', 'cxRepOverall', 'positiveWord']));
    t.equal('the lines themselves', JSON.stringify(log[0].behaviors), JSON.stringify(['recap', 'anythingElse']));
    t.equal('the library tip the email carried, with its metric', JSON.stringify(log[0].suggestions), JSON.stringify([{ id: 'tRecap', metricKey: 'fcr', text: 'Close with a recap.' }]));
    t.equal('measured from the week of the call', log[0].weekEnding, '2026-09-29');
    t.equal('from Calls', log[0].source, 'call');
    t.check('marked with the call, so its own tips are not "already given"', Boolean(log[0].callPrint));

    api.recordCallCoaching(entry, {});
    t.equal('Verint, then the email, then Outlook is still one record', history['Dana Lopez'].length, 1);

    const clean = Object.assign({}, entry, { id: 'c2', scorecard: { missedMetrics: [], lines: [{ key: 'recap', verdict: 'yes' }] } });
    api.recordCallCoaching(clean, {});
    t.equal('a call with nothing missed logs nothing', history['Dana Lopez'].length, 1);

    api.recordCallCoaching(Object.assign({}, entry, { id: '' }), {});
    t.equal('an unsaved call logs nothing', history['Dana Lopez'].length, 1);
});

suite('coaching log: without a key, the same-day rule still stands', (t) => {
    const { api, history } = load();
    api.recordCoachingEvent({ employeeId: 'Dana Lopez', weekEnding: '2026-10-18', metricsCoached: ['aht'] });
    api.recordCoachingEvent({ employeeId: 'Dana Lopez', weekEnding: '2026-10-18', metricsCoached: ['aht'] });
    t.equal('the same metrics on the same day replace each other', history['Dana Lopez'].length, 1);
    api.recordCoachingEvent({ employeeId: 'Dana Lopez', weekEnding: '2026-10-18', metricsCoached: ['aht'], dedupeKey: 'call:x' });
    t.equal('a keyed record never replaces an unkeyed one', history['Dana Lopez'].length, 2);
});
