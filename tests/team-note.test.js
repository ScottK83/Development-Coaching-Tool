'use strict';

const { suite } = require('./harness');

/**
 * THE TEAM NOTE
 *
 * One paragraph the manager writes once (service level at risk for the year,
 * say) and the private messages carry until it is cleared. It goes on the
 * messages of anyone missing Schedule Adherence or AHT in the window being
 * read, or on everyone's when the manager says so, and it goes last, after
 * the standings and near-miss tails.
 *
 * Ana misses adherence, Cal runs long on AHT, Ben meets both. The judging is
 * the same analysis the card badge reads, so these three cover all of it.
 */

const LAST_WEEK = '2026-09-28|2026-10-04';
const THIS_WEEK = '2026-10-05|2026-10-11';
const NOTE = 'As a center we are at risk of missing our 93% service level for the year.';

function row(name, adherence, aht) {
    return {
        name,
        totalCalls: 200,
        scheduleAdherence: adherence,
        aht: aht,
        acw: 40,
        holdTime: 20,
        overallSentiment: 90,
        positiveWord: 85,
        negativeWord: 88,
        managingEmotions: 95
    };
}

function rows() {
    return [row('Ana Missing', 89.5, 400), row('Ben Fine', 95, 400), row('Cal Long', 95, 470)];
}

function load(t) {
    t.installFakeBrowser();

    global.weeklyData = {
        [LAST_WEEK]: { metadata: { periodType: 'week', startDate: '2026-09-28', endDate: '2026-10-04' }, employees: rows() },
        [THIS_WEEK]: { metadata: { periodType: 'week', startDate: '2026-10-05', endDate: '2026-10-11' }, employees: rows() }
    };
    global.ytdData = {};
    global.dailyData = {};
    // script.js globals in the app.
    global.getWeeklyKeysSorted = () => Object.keys(global.weeklyData).sort();
    global.metricDelta = (key, current, previous) => current - previous;
    global.formatDateMMDDYYYY = (s) => {
        const [year, month, day] = String(s || '').split('-');
        return `${month}/${day}/${year}`;
    };

    global.window.DevCoachModules.storage = {
        loadWeeklyData: () => global.weeklyData,
        loadYtdData: () => global.ytdData,
        loadDailyData: () => global.dailyData
    };

    const registry = t.loadModule('modules/metrics-registry.module.js');
    global.isReverseMetric = registry.metricsRegistryHelpers.isReverseMetric;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metric-trends.module.js');
    t.loadModule('modules/period-index.module.js');
    const outreach = t.loadModule('modules/daily-outreach.module.js').dailyOutreach;
    const pulse = t.loadModule('modules/morning-pulse.module.js').morningPulse;
    return { pulse, outreach };
}

suite('team note: nothing is added until one is written', (t) => {
    const { pulse } = load(t);
    t.equal('no note saved', pulse.loadTeamNote().text, '');
    t.equal('so nobody gets one', pulse.teamNoteFor('Ana Missing', THIS_WEEK), '');
});

suite('team note: by default it goes to whoever misses adherence or AHT', (t) => {
    const { pulse } = load(t);
    pulse.saveTeamNote({ text: NOTE, who: 'missing' });

    t.equal('missing adherence gets it', pulse.teamNoteFor('Ana Missing', THIS_WEEK), NOTE);
    t.equal('running long on AHT gets it', pulse.teamNoteFor('Cal Long', THIS_WEEK), NOTE);
    t.equal('meeting both does not', pulse.teamNoteFor('Ben Fine', THIS_WEEK), '');
    t.equal('nor does someone the window has no row for', pulse.teamNoteFor('Nobody Here', THIS_WEEK), '');
});

suite('team note: "everyone" puts it on every message', (t) => {
    const { pulse } = load(t);
    pulse.saveTeamNote({ text: NOTE, who: 'everyone' });
    t.equal('meeting both still gets it', pulse.teamNoteFor('Ben Fine', THIS_WEEK), NOTE);
});

suite('team note: clearing it is saved, not removed, so a restore cannot bring it back', (t) => {
    const { pulse } = load(t);
    pulse.saveTeamNote({ text: NOTE, who: 'missing' });
    pulse.saveTeamNote({ text: '   ', who: 'missing' });
    const raw = global.localStorage.getItem('devCoachingTool_teamNote');
    t.check('the key is still there', typeof raw === 'string');
    t.equal('holding an empty note', JSON.parse(raw).text, '');
    t.equal('and nobody gets one', pulse.teamNoteFor('Ana Missing', THIS_WEEK), '');
});

suite('team note: the private message ends with it', async (t) => {
    const { pulse, outreach } = load(t);
    pulse.saveTeamNote({ text: NOTE, who: 'missing' });
    const plan = outreach.planById('monday');
    const comparison = { unit: 'week', latestKey: THIS_WEEK, baselineKey: LAST_WEEK };

    const ana = await pulse.buildOutreachMessage(outreach, plan, 'Ana Missing', THIS_WEEK, LAST_WEEK, null, comparison);
    const ben = await pulse.buildOutreachMessage(outreach, plan, 'Ben Fine', THIS_WEEK, LAST_WEEK, null, comparison);

    t.check('a message was written for Ana', Boolean(ana) && ana.length > NOTE.length);
    t.check('and it ends with the note, set off as its own paragraph', Boolean(ana) && ana.endsWith('\n\n' + NOTE));
    t.check('a message was written for Ben', Boolean(ben));
    t.check('and his has no note', Boolean(ben) && ben.indexOf(NOTE) === -1);
});

suite('team note: a changed note moves onto a message without rewriting it', (t) => {
    const { pulse } = load(t);
    const body = 'Hi Ana, here is your week.';

    t.equal('added where there was none', pulse.swapTeamNote(body, '', NOTE), body + '\n\n' + NOTE);
    t.equal('replaced when it changes', pulse.swapTeamNote(body + '\n\n' + NOTE, NOTE, 'New ask.'), body + '\n\nNew ask.');
    t.equal('taken off when cleared', pulse.swapTeamNote(body + '\n\n' + NOTE, NOTE, ''), body);
    t.equal('trailing space typed in the box does not stop it',
        pulse.swapTeamNote(body + '\n\n' + NOTE + '  \n', NOTE, 'New ask.'), body + '\n\nNew ask.');

    const handEdited = body + '\n\nAs a center we are at risk. My own words now.';
    t.equal('a note edited by hand is left exactly as it is',
        pulse.swapTeamNote(handEdited, NOTE, 'New ask.'), handEdited);
    t.equal('an empty message stays empty', pulse.swapTeamNote('', '', NOTE), '');
});

suite('team note: no em dashes in what it adds to the page', (t) => {
    const { pulse } = load(t);
    pulse.saveTeamNote({ text: NOTE, who: 'missing' });
    t.check('the editor', pulse.teamNoteEditorHtml('x').indexOf('—') === -1);
});
