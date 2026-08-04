'use strict';

const { suite } = require('./harness');

function makeSelect(id, names) {
    return {
        id,
        value: '',
        options: names.map((n) => ({ value: n })),
        _listeners: {},
        _observer: null,
        addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
        dispatchEvent(ev) { (this._listeners[ev.type] || []).forEach((f) => f.call(this, ev)); return true; },
        querySelector: () => null,
        setOptions(next) {
            this.options = next.map((n) => ({ value: n }));
            if (this._observer) this._observer.cb();
        }
    };
}

const ROSTER = ['Christi Test', 'Alex Rivera', 'Dana Cole'];

function setup(t) {
    const { els, store } = t.installFakeBrowser();
    global.setTimeout = (fn) => fn();
    els.coachingEmployeeSelect = makeSelect('coachingEmployeeSelect', ROSTER);
    els.callListeningEmployeeSelect = makeSelect('callListeningEmployeeSelect', ROSTER);
    els.relEmployeeSelect = makeSelect('relEmployeeSelect', ['Alex Rivera']); // partial roster
    const SA = t.loadModule('modules/selected-associate.module.js').selectedAssociate;
    SA.initialize();
    return { SA, els, store };
}

suite('selectedAssociate — picking once propagates', (t) => {
    const { SA, els } = setup(t);

    els.coachingEmployeeSelect.value = 'Christi Test';
    els.coachingEmployeeSelect.dispatchEvent(new global.Event('change'));

    t.equal('the global updates', SA.get(), 'Christi Test');
    t.equal('another tab’s picker follows', els.callListeningEmployeeSelect.value, 'Christi Test');
    t.equal('a picker that lacks the person keeps its own value', els.relEmployeeSelect.value, '');
});

suite('selectedAssociate — sync must not feed back', (t) => {
    const { SA, els } = setup(t);

    let mirrored = 0;
    els.callListeningEmployeeSelect.addEventListener('change', () => { mirrored++; });

    els.coachingEmployeeSelect.value = 'Dana Cole';
    els.coachingEmployeeSelect.dispatchEvent(new global.Event('change'));

    t.equal('the mirrored picker fires exactly once', mirrored, 1);
    t.equal('and holds the right value', els.callListeningEmployeeSelect.value, 'Dana Cole');
    t.equal('no runaway: the global settled', SA.get(), 'Dana Cole');
});

suite('selectedAssociate — pickers that mount later', (t) => {
    const { SA, els } = setup(t);

    els.coachingEmployeeSelect.value = 'Dana Cole';
    els.coachingEmployeeSelect.dispatchEvent(new global.Event('change'));

    // Tabs build their dropdowns on first visit, so this is the normal case.
    els.midYearEmployeeSelect = makeSelect('midYearEmployeeSelect', []);
    SA.attachAll();
    t.equal('an empty picker starts blank', els.midYearEmployeeSelect.value, '');

    els.midYearEmployeeSelect.setOptions(ROSTER);
    t.equal('once populated it adopts the selection', els.midYearEmployeeSelect.value, 'Dana Cole');
});

suite('selectedAssociate — deliberate refusals', (t) => {
    const { SA, els, store } = setup(t);

    SA.set('Dana Cole');
    els.coachingEmployeeSelect.value = '';
    els.coachingEmployeeSelect.dispatchEvent(new global.Event('change'));
    t.equal('blanking one picker does not clear the shared person', SA.get(), 'Dana Cole');

    t.equal('the selection is persisted for next session', store['devCoachingTool_selectedAssociate'], 'Dana Cole');

    SA.clear();
    t.equal('clear empties it', SA.get(), '');
    t.equal('clear also drops the stored value', store['devCoachingTool_selectedAssociate'], undefined);
});

suite('selectedAssociate — subscribers', (t) => {
    const { SA, els } = setup(t);

    let seen = null;
    SA.subscribe((n) => { seen = n; });
    SA.set('Alex Rivera');
    t.equal('a subscriber is told the new name', seen, 'Alex Rivera');
    t.equal('a picker that now matches syncs too', els.relEmployeeSelect.value, 'Alex Rivera');

    let secondRan = false;
    SA.subscribe(() => { throw new Error('boom'); });
    SA.subscribe(() => { secondRan = true; });
    const realError = console.error;
    console.error = () => {};
    SA.set('Christi Test');
    console.error = realError;
    t.equal('one throwing subscriber does not stop the rest', secondRan, true);
});
