'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * COPY FOR THE POWER APP (Scott, 2026-11-17)
 *
 * One year of the team's records and figures as JSON for the Development
 * Coaching Power App's Import screen. The keys must be the app's own, so a
 * second paste overwrites instead of doubling; the figures must follow the
 * site's rules (no 0% for a metric with no surveys, no 0 second handle time,
 * a YTD file's call count only when it is real, hours only as the year's
 * total); and nothing may leave except through the clipboard.
 *
 * Every name, address and number here is made up.
 */

const YEAR = 2026;
const TEAM = ['Ann Cole', 'Zed Ames', 'No Mail'];
const EMAILS = { 'Ann Cole': 'Ann.Cole@example.com', 'Zed Ames': 'zed.ames@example.com' };

function stores() {
    return {
        coachingHistory: {
            'Ann Cole': [
                { weekEnding: '2026-03-07', generatedAt: '2026-03-06T15:00:00Z', source: 'coach', dedupeKey: 'coach:2026-03-07',
                    metricsCoached: ['aht', 'holdTime'], suggestions: [{ text: 'Use hold only when needed.' }] },
                { weekEnding: '2025-12-20', generatedAt: '2025-12-19T15:00:00Z', source: 'coach', dedupeKey: 'coach:2025-12-20',
                    metricsCoached: ['aht'], suggestions: [{ text: 'Last year, not exported.' }] }
            ]
        },
        callListeningLogs: {
            'Zed Ames': [{ id: 'c1', listenedOn: '2026-05-02', callTime: '10:15', callReference: 'R1',
                whatWentWell: 'Warm opening.', improvementAreas: 'Verify before account talk.' }]
        },
        followUpHistory: { entries: [
            { id: 'f1', associateName: 'ann cole', todoType: 'Payment arrangement', customerName: 'SECRET CUSTOMER',
                customerAccount: '99999', declineReason: 'Sent away', correctProcess: 'Offer the PA', sentAt: '2026-06-10T16:00:00Z' },
            { kind: 'qa', associateName: 'Zed Ames', dedupeKey: 'qa:S1|Zed Ames', sessionId: 'S1', evalDate: '2026-11-03',
                emailedAt: '2026-11-04T18:00:00Z', readAt: '2026-11-05T18:00:00Z', reasonKey: 'pa-payment-as-down' }
        ] },
        oneOnOneMeetings: { 'Zed Ames': [{ date: '2026-09-15', notes: 'Talked goals.' }] },
        // The real shape: Intelligence keeps one note per associate on its
        // Year-to-Date Summary row (executive-summary data-week="ytd-summary").
        executiveSummaryNotes: { 'Ann Cole': { 'ytd-summary': { redFlags: 'Opened the account before verifying.', phishing: '1 click in March' } } },
        dailyOutreachSent: { 'highfive|2026-11-09|Ann Cole': { at: '2026-11-10T14:00:00Z', plan: 'highfive', employee: 'Ann Cole' } },
        quarterRecapEmails: { 'Zed Ames|2026|Q3': [{ event: 'drafted', at: '2026-10-05T12:00:00Z' },
            { event: 'sent', at: '2026-10-05T12:05:00Z', subject: 'Your Q3 recap' }] },
        yearEndDraftEntries: { '2026::Ann Cole': { trackStatus: 'on-track-successful', positivesText: 'Steady tone.',
            improvementsText: '', managerContext: '', copilotResponse: '', performanceRating: 'Successful',
            meritDetails: '', bonusAmount: '', verbalSummary: '' } },
        yearEndAnnualGoals: { '2026::Ann Cole': { redFlagViolations: { status: 'met', note: '' } } },
        midYearMeta: { 'Zed Ames|2026': { notes: 'Mid note.', statusOverride: 'auto', posted: true } },
        quarterReviewNotes: { 'Ann Cole|2026|Q2': 'Q2 note.' },
        // The store's real shape (year-end-comments saveYearEndOpening).
        yearEndOpening: { 2026: { text: '{name}, as we close out {year}, thank you.', updatedAt: '2026-11-01T12:00:00Z' } }
    };
}

const YTD_ANN = { name: 'Ann Cole', scheduleAdherence: '94.2', cxRepOverall: '88', repSurveyTotal: '0',
    overallExperience: '80', surveyTotal: '12', fcr: '75', fcrSurveyTotal: '12', aht: '0', totalCalls: '12',
    reliability: '6.5', holdTime: '22' };
const YTD_ZED = { name: 'Zed Ames', scheduleAdherence: '91', aht: '455', totalCalls: '2100', surveyTotal: '30',
    overallExperience: '70', cxRepOverall: '79', fcr: '70', reliability: '20.25' };

function sources(over) {
    const s = stores();
    return Object.assign({
        team: () => TEAM.slice(),
        email: (n) => EMAILS[n] || '',
        nickname: (n) => (n === 'Zed Ames' ? 'Z' : ''),
        store: (k) => s[k],
        latestPeriod: (n) => {
            const rec = n === 'Ann Cole' ? YTD_ANN : n === 'Zed Ames' ? YTD_ZED : null;
            return rec ? { employeeRecord: rec, sourceName: 'ytdData', label: 'YTD to Nov 14',
                period: { metadata: { startDate: '2026-01-01', endDate: '2026-11-14', periodType: 'ytd' } } } : null;
        },
        quarters: () => [
            { quarter: 1, label: 'Q1 2026', startDate: '2026-01-01', endDate: '2026-03-31',
                employees: { ann: { name: 'Ann Cole', aht: '430', totalCalls: '600', reliability: '3', surveyTotal: '5', overallExperience: '77' } } },
            { quarter: 2, empty: true }
        ],
        findInQuarter: (qa, n) => (qa.employees ? Object.values(qa.employees).find(e => e.name === n) || null : null),
        snapshot: () => ({ wins: [{ label: 'Schedule Adherence', value: '94.2%', target: '93%', targetType: 'min' }],
            opportunities: [{ label: 'Hold Time', value: '22s', target: '30s', targetType: 'max' }] }),
        metricLine: (e) => e.label + ': ' + e.value,
        onOff: () => ({ trackLabel: 'On Track/Successful', trackStatusValue: 'on-track-successful', ratingAverage: 2.456 }),
        progression: () => 'Q1 to Q3: adherence held.',
        targets: () => ({ aht: { type: 'max', value: 426 }, scheduleAdherence: { type: 'min', value: 93 } }),
        metricLabel: (k) => ({ aht: 'Average Handle Time', holdTime: 'Hold Time' }[k] || k),
        cc: () => 'coaching.box@example.com',
        now: () => new Date('2026-11-17T12:00:00Z')
    }, over || {});
}

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/power-app-export.module.js').powerAppExport;
}

suite('power app export: people, keys and the year', async (t) => {
    const pa = load(t);
    const exp = pa.buildExport(YEAR, sources());

    t.equal('two people with an email go over', exp.associates.length, 2);
    t.equal('the one with no email is counted as left out', exp.skipped, 1);
    t.equal('an associate key is the lower-case email', exp.associates[0].key, 'ann.cole@example.com');
    t.equal('the preferred name rides along', exp.associates.find(a => a.name === 'Zed Ames').preferred, 'Z');
    t.check('the year-end review key is the app\'s own',
        exp.reviews.some(r => r.key === 'yearend:2026:ann.cole@example.com' && r.type === 'Year-End'));
    t.check('every log key is unique', new Set(exp.log.map(r => r.key)).size === exp.log.length);
    t.check('every key fits a SharePoint text column', [].concat(exp.log, exp.reviews, exp.figures).every(r => r.key.length <= 255));
    t.check('last year\'s coaching stays behind', !exp.log.some(r => /Last year/.test(r.message)));
    const again = pa.buildExport(YEAR, sources());
    t.equal('the same data gives the same keys (a second paste overwrites)',
        JSON.stringify(again.log.map(r => r.key)), JSON.stringify(exp.log.map(r => r.key)));
});

suite('power app export: the coaching log', async (t) => {
    const pa = load(t);
    const exp = pa.buildExport(YEAR, sources());
    const kinds = exp.log.map(r => r.kind).sort();

    t.equal('one row per record, of each kind',
        kinds.join(','), '1:1,Call listening,Coaching email,Follow up,High five,Note,QA coaching,Quarterly recap,Red flag');
    const coach = exp.log.find(r => r.kind === 'Coaching email');
    t.equal('metrics coached go over by name', coach.metrics, 'Average Handle Time, Hold Time');
    t.equal('the coaching tip is the message', coach.message, 'Use hold only when needed.');
    const follow = exp.log.find(r => r.kind === 'Follow up');
    t.check('a follow-up is matched to its person whatever the case', follow.email === 'ann.cole@example.com');
    t.check('customer names and account numbers stay behind', !/SECRET CUSTOMER|99999/.test(JSON.stringify(exp)));
    const qa = exp.log.find(r => r.kind === 'QA coaching');
    t.equal('a QA coaching read by the associate says Read', qa.status, 'Read');
    t.equal('the red flag note is filed as a red flag', exp.log.find(r => r.kind === 'Red flag').message, 'Opened the account before verifying.');
    t.equal('a year-summary red flag is dated the day of the copy', exp.log.find(r => r.kind === 'Red flag').date, '2026-11-17');
    t.equal('a phishing note goes over as a note', exp.log.find(r => r.subject === 'Phishing').message, '1 click in March');
    const lastYear = pa.buildExport(2025, sources());
    t.equal('copying a past year dates it the last day of that year', lastYear.log.find(r => r.kind === 'Red flag').date, '2025-12-31');
    t.equal('a sent quarterly recap says Sent', exp.log.find(r => r.kind === 'Quarterly recap').status, 'Sent');
    t.equal('a high five went by Teams chat', exp.log.find(r => r.kind === 'High five').channel, 'Teams chat');
});

suite('power app export: reviews', async (t) => {
    const pa = load(t);
    const exp = pa.buildExport(YEAR, sources());
    const ann = exp.reviews.find(r => r.key === 'yearend:2026:ann.cole@example.com');
    const zed = exp.reviews.find(r => r.key === 'yearend:2026:zed.ames@example.com');

    t.equal('a year-end with typing in it is Drafting', ann.status, 'Drafting');
    t.equal('a year-end with nothing typed is Not started', zed.status, 'Not started');
    t.equal('the typed boxes go over', ann.positives, 'Steady tone.');
    t.equal('the annual goals go over as JSON', JSON.parse(ann.goals).redFlagViolations.status, 'met');
    const facts = JSON.parse(ann.facts);
    t.equal('the facts carry the wins', facts.wins[0], 'Schedule Adherence: 94.2%');
    t.equal('and the focus areas', facts.focus[0], 'Hold Time: 22s');
    t.equal('and the on/off result', facts.onOff, 'On Track/Successful');
    t.equal('the rating average is rounded to two places', facts.ratingAverage, 2.46);
    t.equal('the facts are as of the YTD file\'s end', facts.asOf, '2026-11-14');
    t.equal('with wins, no praise lines are needed', facts.praise.length, 0);
    const noWins = pa.buildExport(YEAR, sources({
        snapshot: () => ({ wins: [], opportunities: [{ label: 'Hold Time', value: '40s' }], targetProfileYear: 2026 }),
        praise: () => ['Took 2,100 calls this year.']
    }));
    const f2 = JSON.parse(noWins.reviews.find(r => r.key === 'yearend:2026:ann.cole@example.com').facts);
    t.equal('with nothing at goal, the praise lines go over instead', f2.praise[0], 'Took 2,100 calls this year.');
    t.equal('and the target year', f2.targetYear, 2026);
    t.check('a posted mid-year says Posted',
        exp.reviews.some(r => r.key === 'midyear:2026:zed.ames@example.com' && r.status === 'Posted' && r.posted === true));
    t.check('a quarterly note goes over under its quarter',
        exp.reviews.some(r => r.key === 'q2:2026:ann.cole@example.com' && r.notes === 'Q2 note.'));
    t.equal('the opening goes over as a setting',
        exp.settings.find(s => s.key === 'YearEndOpening:2026').value, '{name}, as we close out {year}, thank you.');
});

suite('power app export: figures follow the site\'s rules', async (t) => {
    const pa = load(t);
    const exp = pa.buildExport(YEAR, sources());
    const ann = exp.figures.find(r => r.key === 'ytd:2026-11-14:ann.cole@example.com');
    const zed = exp.figures.find(r => r.key === 'ytd:2026-11-14:zed.ames@example.com');

    t.equal('a survey metric with no surveys is blank, not 0', ann.RepSat, null);
    t.equal('a survey metric with surveys keeps its value', ann.OverallExperience, 80);
    t.equal('a 0 second handle time is blank (no calls, not a win)', ann.AHT, null);
    t.equal('a YTD "calls" that is really the survey count is left blank', ann.TotalCalls, null);
    t.equal('a real YTD call count goes over', zed.TotalCalls, 2100);
    t.equal('the year\'s hours ride on the YTD row', zed.Reliability, 20.25);
    const q1 = exp.figures.find(r => r.key === 'quarter:2026-Q1:ann.cole@example.com');
    t.check('a quarter row carries no hours (hours are a year total)', q1 && !('Reliability' in q1));
    t.equal('a quarter row has its own dates', q1.start + ' to ' + q1.end, '2026-01-01 to 2026-03-31');
    t.check('an empty quarter makes no row', !exp.figures.some(r => /Q2/.test(r.key)));
    const target = exp.figures.find(r => r.key === 'target:2026:all');
    t.equal('the year\'s targets go over as one row', target.AHT + '/' + target.ScheduleAdherence, '426/93');
});

suite('power app export: parts small enough to paste', async (t) => {
    const pa = load(t);
    const exp = pa.buildExport(YEAR, sources());
    const parts = pa.splitParts(exp, 1500);

    t.check('a small limit makes several parts', parts.length > 1);
    t.check('no part is over the limit', parts.every(p => p.length <= 1500));
    const parsed = parts.map(p => JSON.parse(p));
    t.check('every part says which part it is', parsed.every((p, i) => p.part === i + 1 && p.parts === parts.length));
    t.check('every part carries the header', parsed.every(p => p.kind === 'dct-export' && p.year === YEAR && p.v === 1));
    ['associates', 'log', 'reviews', 'figures', 'settings'].forEach((list) => {
        const joined = [].concat(...parsed.map(p => p[list])).map(r => JSON.stringify(r)).join('\n');
        t.equal(`every ${list} row is in exactly one part`, joined, exp[list].map(r => JSON.stringify(r)).join('\n'));
    });
    t.equal('a normal export is one part', pa.splitParts(exp).length, 1);
});

suite('power app export: review season year and no way out but the clipboard', async (t) => {
    const pa = load(t);
    t.equal('in January the year just ended is the default', pa.defaultYear(new Date(2027, 0, 10)), 2026);
    t.equal('in November it is this year', pa.defaultYear(new Date(2026, 10, 17)), 2026);
    const src = fs.readFileSync(path.join(ROOT, 'modules/power-app-export.module.js'), 'utf8');
    t.check('no network call', !/\bfetch\(|XMLHttpRequest|sendBeacon/.test(src));
    t.check('no store is written', !/setItem|saveWithSizeCheck|removeItem/.test(src));
    t.check('no file download', !/download\s*=|createObjectURL/.test(src));
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    t.check('the button is on the Sync & Backup page', /id="powerAppExportBtn"/.test(html));
    t.check('the module is loaded', /'modules\/power-app-export\.module\.js'/.test(html));
});
