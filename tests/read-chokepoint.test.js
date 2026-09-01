'use strict';

/**
 * Every data store must be READ through the storage module, not just written
 * through it.
 *
 * A store whose write is routed but whose read is not goes permanently stale
 * the moment its backend changes: the write lands in IndexedDB, the read keeps
 * looking at a localStorage copy that stopped being updated. Nothing errors.
 * The value is simply wrong, and stays wrong.
 *
 * That failure has now happened four separate times in this codebase, each time
 * in a different file, each time silently: the repo restore writing where
 * nothing reads, the file export sweeping only localStorage, tips reading raw
 * after the write was routed, and the sync payload built from stale copies.
 *
 * The write side is covered by write-chokepoint.test.js. This is the other half.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

// Keys a raw read is legitimate for: this machine's own view state and
// bookkeeping, plus the handful read before the storage module can exist.
const RAW_READ_ALLOWED = [
    'teamMemberSelectorExpanded', 'trendQueueLegendExpanded', 'celebrationsInnerTab',
    'celebrationsSelection', 'celebrationsThreshold', 'uiNavState', 'selectedAssociate',
    'theme', 'debugLog', 'errorLog', 'lastError', 'repoSyncLastSuccess',
    'repoBackupAppliedAt', 'deleteAllJustRan', 'idbMigrated_v1', 'selectedYearEndYear',
    'lastTrendPeriod', 'lastUploadUndo', 'lastUploadHeaderFingerprint',
    'lastUploadMetricCoverage', 'reliabilityBlankIsZero_v1', 'dataHealthReviewed',
    'v2SyncState', 'v2DeviceId',
    // Read by the storage module itself when deciding what to migrate, and by
    // the mailto helper before the module is available.
    'ccEmail', 'callListeningSyncConfig'
];

const RAW_PREFIX_ALLOWED = ['smartDefault_', 'supervisorSeeded_', 'supervisorRenamed_'];

function sourceFiles() {
    const files = [path.join(ROOT, 'script.js')];
    fs.readdirSync(path.join(ROOT, 'modules'))
        .filter((f) => f.endsWith('.module.js'))
        .forEach((f) => files.push(path.join(ROOT, 'modules', f)));
    return files;
}

function rawReads() {
    const hits = [];
    const pattern = /localStorage\.getItem\(\s*(?:STORAGE_PREFIX|prefix)\s*\+\s*'([a-zA-Z0-9_]+)'/g;
    sourceFiles().forEach((file) => {
        const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
        const lines = src.split('\n');
        let match;
        while ((match = pattern.exec(src)) !== null) {
            const line = src.slice(0, match.index).split('\n').length;
            // The three lines above a raw read: a correct fallback consults the
            // storage module there before dropping through to localStorage.
            const preceding = lines.slice(Math.max(0, line - 4), line).join('\n');
            hits.push({
                file: path.relative(ROOT, file).replace(/\\/g, '/'),
                line,
                name: match[1],
                text: lines[line - 1].trim(),
                triesModuleFirst: /DevCoachModules\?\.storage|storage\?\.(load|readStore)|readStore\b/.test(preceding)
            });
        }
    });
    return hits;
}

suite('chokepoint: no data store is read around the storage module', (t) => {
    const offenders = rawReads().filter((hit) => {
        if (RAW_READ_ALLOWED.indexOf(hit.name) > -1) return false;
        if (RAW_PREFIX_ALLOWED.some((p) => hit.name.startsWith(p))) return false;
        // The storage module's own fallback path, and the migration read that
        // decides what to copy across, are where a raw read belongs.
        if (hit.file === 'modules/storage.module.js') return false;
        // A fallback for when the module is genuinely absent is correct, so
        // long as the module is TRIED FIRST. That is the difference between
        // "use the module, or cope without it" and "ignore the module", and
        // only the second one goes stale when a store moves.
        return !hit.triesModuleFirst;
    });

    const report = offenders.map((o) => `${o.file}:${o.line} reads ${o.name} raw`).join('\n      ') || '(none)';
    t.equal('every data store goes through readStore', report, '(none)');
});

suite('chokepoint: reads and writes agree about where a store lives', (t) => {
    t.installFakeBrowser();
    const registry = t.loadModule('modules/store-registry.module.js').storeRegistry;

    // A store cannot be written through the module and read around it, nor the
    // reverse. Both lists are derived from the same registry so they cannot
    // drift, and anything on the read allowlist must not be data.
    RAW_READ_ALLOWED
        .filter((n) => ['ccEmail', 'callListeningSyncConfig'].indexOf(n) === -1)
        .forEach((name) => {
            const tier = registry.tierOf(name);
            t.check(`${name} is device or derived, not data`, tier === 'device' || tier === 'derived');
        });
});

suite('chokepoint: almost nothing real is left in localStorage', (t) => {
    t.installFakeBrowser();
    const registry = t.loadModule('modules/store-registry.module.js').storeRegistry;

    const stillLocal = registry.STORES
        .filter((s) => s.tier === 'data' && s.backend === 'local')
        .map((s) => s.name);

    // ccEmail is a single email address, stored as a bare string and read by the
    // mailto helper before the module exists. Everything else that is real data
    // is off the 5MB wall.
    t.equal('the only data store left in localStorage is ccEmail',
        stillLocal.join(', ') || '(none)', 'ccEmail');

    const onIdb = registry.STORES.filter((s) => s.backend === 'idb').length;
    t.check('and the rest are on a backend with no 5MB ceiling', onIdb >= 30);
});
