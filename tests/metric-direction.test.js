'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * Every place in the app that decides which way a metric should move.
 *
 * Getting one of these backwards does not throw and does not look broken — it
 * quietly ranks the worst performer first, or congratulates someone for being
 * below the centre average. Two of them were wrong when this was written:
 * center-ranking had "Avoid Negative Words" as lower-is-better, and
 * trend-coaching-email read a `higherIsBetter` flag that has never existed on
 * the registry, so every metric took the lower-is-better branch.
 *
 * The metrics registry is the single source of truth. Everything else has to
 * agree with it.
 */
function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/center-ranking.module.js');
    t.loadModule('modules/matchup.module.js');
    return global.window;
}

suite('metric direction: the registry agrees with itself', (t) => {
    const win = load(t);
    const registry = win.METRICS_REGISTRY;

    Object.keys(registry).forEach(key => {
        const entry = registry[key];
        if (!entry.target) return;
        // isReverse and a 'max' target are two ways of saying the same thing.
        // If they ever disagree, which one wins depends on the caller.
        const targetSaysLower = entry.target.type === 'max';
        t.check(`${key}: isReverse matches its own target type`, entry.isReverse === true === targetSaysLower);
    });
});

suite('metric direction: year targets agree with the registry', (t) => {
    const win = load(t);
    const registry = win.METRICS_REGISTRY;
    const profiles = win.DevCoachModules.metricProfiles;

    [2025, 2026].forEach(year => {
        Object.keys(registry).forEach(key => {
            const target = profiles.getYearTarget(key, year);
            if (!target) return;
            t.check(`${year} ${key}: profile direction matches the registry`,
                (target.type === 'max') === (registry[key].isReverse === true));
        });
    });
});

suite('metric direction: centre ranking ranks the right end first', (t) => {
    const win = load(t);
    const registry = win.METRICS_REGISTRY;
    const ranking = win.DevCoachModules.centerRanking;

    // This is the list that had negativeWord backwards. "Avoid Negative Words"
    // scores how well you avoided them, so higher is better — marked reverse,
    // the worst performer on the floor ranked first.
    ranking.EXTRA_RANK_METRICS.forEach(m => {
        const entry = registry[m.key];
        t.check(`${m.key} exists in the registry`, Boolean(entry));
        if (!entry) return;
        t.check(`${m.key}: rank direction matches the registry`, m.reverse === (entry.isReverse === true));
    });

    // The five scorecard KPIs read from differently-named rank keys, so each
    // one carries the registry key it maps to.
    ranking.KPI_RANK_METRICS.forEach(m => {
        const entry = registry[m.registry];
        t.check(`${m.key} maps to a real registry metric`, Boolean(entry));
        if (!entry) return;
        t.check(`${m.key}: KPI rank direction matches ${m.registry}`, m.reverse === (entry.isReverse === true));
    });
});

suite('metric direction: head-to-head scores the right winner', (t) => {
    const win = load(t);
    const registry = win.METRICS_REGISTRY;
    const matchup = win.DevCoachModules.matchup;

    matchup.MATCHUP_METRICS.forEach(m => {
        const entry = registry[m.formatKey];
        t.check(`${m.key} maps to a real registry metric`, Boolean(entry));
        if (!entry) return;
        t.check(`${m.key}: lowerIsBetter matches ${m.formatKey}`, Boolean(m.lowerIsBetter) === (entry.isReverse === true));
    });
});

suite('metric direction: the daily check-in table agrees too', (t) => {
    const win = load(t);
    const registry = win.METRICS_REGISTRY;

    // morning-pulse pulls in a lot of app globals at load, so read its list
    // from source rather than booting the whole module here.
    const src = fs.readFileSync(path.join(ROOT, 'modules', 'morning-pulse.module.js'), 'utf8');
    const block = src.match(/DAILY_CHECKIN_METRICS = \[([\s\S]*?)\];/);
    t.check('the daily metric list is still findable', Boolean(block));
    if (!block) return;

    const rows = [...block[1].matchAll(/key: '(\w+)'[^}]*reverse: (true|false)/g)];
    t.check('and it has entries', rows.length > 0);

    rows.forEach(([, key, reverse]) => {
        const entry = registry[key];
        if (!entry || !entry.target) return; // volume has no target to face
        t.check(`${key}: daily table direction matches the registry`, (reverse === 'true') === (entry.isReverse === true));
    });
});

suite('metric direction: nothing reads a direction flag that does not exist', (t) => {
    load(t);
    const registry = global.window.METRICS_REGISTRY;
    const sample = registry.scheduleAdherence;

    // trend-coaching-email read `metric.higherIsBetter` off a registry entry.
    // It is always undefined, which is falsy, which silently means "lower is
    // better" for every metric in the app.
    t.check('the registry has no higherIsBetter', !('higherIsBetter' in sample));
    t.check('nor lowerIsBetter', !('lowerIsBetter' in sample));
    t.check('direction lives on isReverse', 'isReverse' in sample);

    const modulesDir = path.join(ROOT, 'modules');
    const offenders = [];
    fs.readdirSync(modulesDir).filter(f => f.endsWith('.js')).forEach(file => {
        const src = fs.readFileSync(path.join(modulesDir, file), 'utf8');
        // A registry entry is conventionally held in `metric`; reading a
        // direction flag off it that the registry never sets is the bug.
        if (/\bmetric\.(higherIsBetter|lowerIsBetter)\b/.test(src)) offenders.push(file);
    });
    t.equal('no module reads a direction flag off a registry entry', offenders.join(',') || 'none', 'none');
});
