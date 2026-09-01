'use strict';

/**
 * Every synced store must be written through the storage module.
 *
 * This is not a style rule. Dirty tracking, the cloud push and the backend
 * routing all hang off saveWithSizeCheck, so a store written with a raw
 * localStorage.setItem is never marked dirty, never pushed, and never reaches
 * the other machine. Nothing errors. The value is simply on one PC forever.
 *
 * That is not hypothetical: a custom coaching tip added on the work PC never
 * appeared on the home PC, because tips.module.js wrote userCustomTips and
 * metricCoachingTips with a raw setItem. Twenty-three call sites had the same
 * shape.
 *
 * This test is the only thing that stops it coming back, because the failure
 * is silent everywhere else.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

// Keys that legitimately use a raw write: this machine's own view state,
// bookkeeping, and things recomputed rather than synced. None of these should
// ever travel to another machine.
const RAW_WRITE_ALLOWED = [
    'teamMemberSelectorExpanded', 'trendQueueLegendExpanded', 'celebrationsInnerTab',
    'celebrationsSelection', 'celebrationsThreshold', 'uiNavState', 'selectedAssociate',
    'theme', 'debugLog', 'errorLog', 'lastError', 'repoSyncLastSuccess',
    'repoBackupAppliedAt', 'deleteAllJustRan', 'idbMigrated_v1', 'selectedYearEndYear',
    'lastTrendPeriod', 'lastUploadUndo', 'lastUploadHeaderFingerprint',
    'lastUploadMetricCoverage', 'reliabilityBlankIsZero_v1', 'dataHealthReviewed',
    'v2SyncState', 'v2DeviceId', 'ccEmail'
];

const RAW_PREFIX_ALLOWED = ['smartDefault_', 'supervisorSeeded_', 'supervisorRenamed_'];

function sourceFiles() {
    const files = [path.join(ROOT, 'script.js')];
    fs.readdirSync(path.join(ROOT, 'modules'))
        .filter((f) => f.endsWith('.module.js'))
        .forEach((f) => files.push(path.join(ROOT, 'modules', f)));
    return files;
}

function rawWrites() {
    const hits = [];
    const pattern = /localStorage\.setItem\(\s*(?:STORAGE_PREFIX|prefix)\s*\+\s*'([a-zA-Z0-9_]+)'/g;
    sourceFiles().forEach((file) => {
        const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
        const lines = src.split('\n');
        let match;
        while ((match = pattern.exec(src)) !== null) {
            const name = match[1];
            const line = src.slice(0, match.index).split('\n').length;
            hits.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), line, name, text: lines[line - 1].trim() });
        }
    });
    return hits;
}

suite('chokepoint: no synced store is written around the storage module', (t) => {
    const offenders = rawWrites().filter((hit) => {
        if (RAW_WRITE_ALLOWED.indexOf(hit.name) > -1) return false;
        if (RAW_PREFIX_ALLOWED.some((p) => hit.name.startsWith(p))) return false;
        // The storage module itself is where the raw write legitimately lives.
        if (hit.file === 'modules/storage.module.js' && /serialized|IDB_MIGRATED_MARKER/.test(hit.text)) return false;
        return true;
    });

    const report = offenders.map((o) => `${o.file}:${o.line} writes ${o.name} raw`).join('\n      ') || '(none)';
    t.equal('every synced store goes through saveWithSizeCheck', report, '(none)');
});

suite('chokepoint: the stores that failed to sync are covered now', (t) => {
    const raw = rawWrites().map((h) => h.name);

    // The two that produced the reported symptom, plus the rest of the sweep.
    ['userCustomTips', 'metricCoachingTips', 'customMetrics', 'modifiedServerTips',
        'deletedServerTips', 'coachingTips', 'employeeNicknames', 'employeeSupervisors',
        'employeePreferredNames', 'executiveSummaryNotes', 'myTeamMembers',
        'callCenterAverages', 'tipUsageHistory', 'complianceLog', 'midYearMeta',
        'ptoTracker'].forEach((name) => {
        t.check(`${name} is no longer written raw`, raw.indexOf(name) === -1);
    });
});

suite('chokepoint: the allowlist only contains stores that must not travel', (t) => {
    t.installFakeBrowser();
    const registry = t.loadModule('modules/store-registry.module.js').storeRegistry;

    // An entry added here to silence the test above would quietly stop a real
    // store from ever syncing, which is the exact bug this file exists for.
    // ccEmail is the one deliberate exception: it is written through the module
    // AND readable raw, because it predates the routing.
    RAW_WRITE_ALLOWED.filter((name) => name !== 'ccEmail').forEach((name) => {
        const tier = registry.tierOf(name);
        t.check(`${name} is device or derived, not data`, tier === 'device' || tier === 'derived');
    });
});
