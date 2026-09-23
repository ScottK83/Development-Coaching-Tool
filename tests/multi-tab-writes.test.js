'use strict';

/**
 * Two tabs of the app no longer overwrite each other.
 *
 * Each tab holds the stores in memory from its own load. Tab A uploaded week X;
 * tab B, still holding the older weeklyData, uploaded week Y and saved its whole
 * object, so week X was gone. A write in one tab now marks that store stale in
 * the other, and the other tab's save of its old copy is refused.
 */

const { suite } = require('./harness');

// A BroadcastChannel stand-in: every instance with the same name hears the
// others, never itself, as in a browser.
const members = {};
const FakeChannel = class {
    constructor(name) {
        this.name = name;
        this.onmessage = null;
        (members[name] = members[name] || []).push(this);
    }
    postMessage(data) {
        (members[this.name] || []).forEach((other) => {
            if (other !== this && typeof other.onmessage === 'function') other.onmessage({ data });
        });
    }
    close() {}
};

function loadTab(t) {
    t.installFakeBrowser();
    global.window.BroadcastChannel = FakeChannel;
    ['modules/store-registry.module.js', 'modules/constants.module.js',
     'modules/metrics-registry.module.js', 'modules/data-parsing.module.js',
     'modules/storage.module.js'].forEach((m) => t.loadModule(m));
    return global.window.DevCoachModules.storage;
}

suite('tabs: a save in one tab makes the other tab reload before saving', (t) => {
    const tabA = loadTab(t);
    const tabB = loadTab(t);

    const warned = [];
    tabB.onOtherTabWrite((key) => warned.push(key));

    t.check('tab A saves its upload', tabA.saveWithSizeCheck('weeklyData', { weekX: {} }));
    t.check('tab B is told', warned.indexOf('weeklyData') > -1);
    t.equal('tab B now treats its copy as out of date', tabB.isStoreStale('weeklyData'), true);
    t.equal('so its save of the older copy is refused', tabB.saveWithSizeCheck('weeklyData', { weekY: {} }), false);

    t.equal('an unrelated store in tab B still saves', tabB.saveWithSizeCheck('dailyData', {}), true);
    t.equal('and tab A is not stale about its own write', tabA.isStoreStale('weeklyData'), false);
});
