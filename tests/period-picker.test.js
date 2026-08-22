'use strict';

const { suite } = require('./harness');

/**
 * ONE PERIOD PICKER, EVERYWHERE
 *
 * Four pages asked the same question four ways. My Team had a row of chips;
 * Rankings and Matchup had a 260px dropdown listing every upload on file
 * grouped by type, where "Weekly ending 2026-05-31" appeared nine times and
 * month to date was buried between them. Knowing one told you nothing about
 * the next.
 *
 * These pin the shared row: what it renders, what it refuses to render, and
 * the mapping between a chip and the upload behind it.
 */

function loadPicker(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/period-picker.module.js').periodPicker;
}

function windowSet() {
    return [
        { id: 'latest', label: 'Latest upload', key: null, dateRange: '', count: 0, available: true, reason: '' },
        { id: 'thisWeek', label: 'This week', key: null, dateRange: '', count: 0, available: false, reason: 'Nothing uploaded for this week yet.' },
        { id: 'lastWeek', label: 'Last week', key: '2026-08-10|2026-08-16', dateRange: 'Aug 10 - Aug 16', count: 124, available: true, reason: '' },
        { id: 'mtd', label: 'Month to date', key: '2026-08-01|2026-08-17', dateRange: 'Aug 1 - Aug 17', count: 126, available: true, reason: '' },
        { id: 'ytd', label: 'Year to date', key: '2026-01-01|2026-08-16', dateRange: 'Jan 1 - Aug 16', count: 127, available: true, reason: '' }
    ];
}

suite('period picker: one row, one look', (t) => {
    const picker = loadPicker(t);
    const html = picker.renderRow(windowSet(), 'mtd', { id: 'testRow', chipClass: 'x-chip' });

    t.check('the row carries the id it was given', html.indexOf('id="testRow"') > -1);
    t.check('and says what it is for', html.indexOf('Covering:') > -1);
    t.check('every window is a chip', ['Latest upload', 'This week', 'Last week', 'Month to date', 'Year to date']
        .every(label => html.indexOf(label) > -1));
    t.equal('one button each', (html.match(/<button/g) || []).length, 5);
    t.check('carrying the class the page asked for', html.indexOf('class="x-chip"') > -1);
    t.check('and its own id to be picked out by', html.indexOf('data-period-id="mtd"') > -1);
});

suite('period picker: the chosen one is visibly chosen', (t) => {
    const picker = loadPicker(t);
    const html = picker.renderRow(windowSet(), 'mtd', { chipClass: 'x-chip' });

    // The accent is the only thing separating the live window from the rest,
    // so exactly one chip may wear it.
    t.equal('one chip is accented', (html.match(/#e65100/g) || []).length, 2); // border + text
    const mtdChip = html.slice(html.indexOf('data-period-id="mtd"'));
    t.check('and it is the chosen one', mtdChip.indexOf('#e65100') > -1);
});

suite('period picker: a window with nothing behind it is greyed, not hidden', (t) => {
    const picker = loadPicker(t);
    const html = picker.renderRow(windowSet(), 'mtd', { chipClass: 'x-chip' });

    // Dropping it leaves "why can't I look at this week" unanswerable without
    // opening the Upload tab and counting rows.
    t.check('it is still on screen', html.indexOf('This week') > -1);
    t.check('but disabled', html.indexOf('data-period-id="thisWeek" disabled') > -1);
    t.check('with the reason on hover', html.indexOf('Nothing uploaded for this week yet.') > -1);
    t.check('and it is dimmed', html.indexOf('opacity:0.45') > -1);
});

suite('period picker: a usable window shows what is behind it', (t) => {
    const picker = loadPicker(t);
    const html = picker.renderRow(windowSet(), 'latest', { chipClass: 'x-chip' });

    t.check('the range and the field size ride along', html.indexOf('Aug 1 - Aug 17 · 126 associates') > -1);
    t.check('and the newest upload says so in words', html.indexOf('Whichever upload is newest') > -1);
});

suite('period picker: a row of one is not a choice', (t) => {
    const picker = loadPicker(t);
    t.equal('one window renders nothing', picker.renderRow(windowSet().slice(0, 1), 'latest', {}), '');
    t.equal('none renders nothing', picker.renderRow([], 'latest', {}), '');
    t.equal('and the chips alone are empty too', picker.renderChips([], 'latest', {}), '');
});

suite('period picker: chips and uploads map both ways', (t) => {
    const picker = loadPicker(t);
    const windows = windowSet();

    t.equal('a key finds its chip', picker.idForKey(windows, '2026-08-01|2026-08-17'), 'mtd');
    t.equal('no key at all is the newest upload', picker.idForKey(windows, null), 'latest');

    // A key that is none of the windows was picked deliberately out of the full
    // list, so nothing is lit and the page shows the list instead.
    t.equal('a key from the full list lights nothing',
        picker.idForKey(windows, '2026-05-25|2026-05-31'), null);

    t.equal('a chip finds its upload', picker.keyForId(windows, 'ytd'), '2026-01-01|2026-08-16');
    t.equal('the newest upload has no key, which is what auto means',
        picker.keyForId(windows, 'latest'), null);
    t.equal('and an unknown chip has none either', picker.keyForId(windows, 'whenever'), null);
});

suite('period picker: clicking a chip hands back its id', (t) => {
    const picker = loadPicker(t);

    const picked = [];
    const buttons = [
        { dataset: { periodId: 'mtd' }, disabled: false, handlers: [], addEventListener(_, fn) { this.handlers.push(fn); } },
        { dataset: { periodId: 'thisWeek' }, disabled: true, handlers: [], addEventListener(_, fn) { this.handlers.push(fn); } }
    ];
    const root = { querySelectorAll: () => buttons };

    picker.bindRow(root, (id) => picked.push(id), { chipClass: 'x-chip' });
    buttons.forEach(b => b.handlers.forEach(fn => fn()));

    t.equal('a live chip reports itself once', picked.length, 1);
    t.equal('and reports the right one', picked[0], 'mtd');

    // A greyed chip is on screen to explain itself, not to be clicked.
    t.check('a disabled chip does nothing', picked.indexOf('thisWeek') === -1);
});

suite('period picker: no celebrations module, no windows, no crash', (t) => {
    const picker = loadPicker(t);
    t.equal('the window list is empty rather than broken', picker.windows().length, 0);

    global.window.DevCoachModules.celebrations = {
        listShoutOutWindows() { throw new Error('boom'); }
    };
    t.equal('and a thrower is caught', picker.windows().length, 0);
});
