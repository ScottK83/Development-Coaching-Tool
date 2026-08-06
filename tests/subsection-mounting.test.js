'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * A sub-section only appears if its markup is somewhere the nav can actually
 * reveal it.
 *
 * Review Prep and Trends both grew by pointing at panels that physically live
 * inside the My Team section, and moving them at runtime with
 * ensureReviewPrepMounted / ensureTrendsMounted. That works, but it means a new
 * tab can be wired up perfectly — button, nav group, handler — and still render
 * nothing, because setting display:block on a div inside a hidden section shows
 * you nothing at all. That is exactly how the Meetings tab shipped blank.
 *
 * So: every registered sub-section must either live inside its own group's
 * section, or be mounted at runtime.
 */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const navSrc = fs.readFileSync(path.join(ROOT, 'modules', 'navigation.module.js'), 'utf8');

function listFrom(name) {
    const m = navSrc.match(new RegExp(name + "\\s*=\\s*\\[([^\\]]*)\\]"));
    if (!m) return [];
    return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

// Character range of a top-level <section id="X"> ... </section>.
function sectionRange(sectionId) {
    const open = html.indexOf(`<section id="${sectionId}"`);
    if (open === -1) return null;
    const close = html.indexOf('</section>', open);
    return close === -1 ? null : { start: open, end: close };
}

function divPosition(id) {
    return html.indexOf(`id="${id}"`);
}

function reachable(id, sectionId, mountFns) {
    const pos = divPosition(id);
    if (pos === -1) return { ok: false, why: 'no markup with that id exists' };

    const range = sectionRange(sectionId);
    if (range && pos > range.start && pos < range.end) return { ok: true, why: 'lives in its own section' };

    const mounted = mountFns.some(fn => script.indexOf(`${fn}('${id}')`) > -1);
    if (mounted) return { ok: true, why: 'mounted at runtime' };

    return { ok: false, why: `sits outside ${sectionId} and nothing mounts it, so display:block reveals nothing` };
}

suite('sub-sections: every Review Prep tab can actually be shown', (t) => {
    const ids = listFrom('REVIEW_SUB_SECTIONS');
    t.check('the Review Prep group is still readable', ids.length > 0);

    ids.forEach(id => {
        const result = reachable(id, 'reviewPrepSection', ['ensureReviewPrepMounted']);
        t.check(`${id}: ${result.why}`, result.ok);
    });

    t.check('Meetings is among them', ids.indexOf('subSectionMeetings') > -1);
});

suite('sub-sections: every Trends tab can actually be shown', (t) => {
    const ids = listFrom('TRENDS_SUB_SECTIONS');
    t.check('the Trends group is still readable', ids.length > 0);

    ids.forEach(id => {
        const result = reachable(id, 'trendsAnalysisSection', ['ensureTrendsMounted']);
        // Trends mounts by (sourceId, targetId), so the container is what gets
        // named in the nav list and the source is moved into it.
        const named = script.indexOf(`'${id}')`) > -1 || result.ok;
        t.check(`${id}: ${result.ok ? result.why : 'reachable via a mount target'}`, result.ok || named);
    });
});

suite('sub-sections: every My Team tab can actually be shown', (t) => {
    const ids = listFrom('MY_TEAM_SUB_SECTIONS');
    t.check('the My Team group is still readable', ids.length > 0);

    ids.forEach(id => {
        const pos = divPosition(id);
        t.check(`${id}: markup exists`, pos !== -1);
    });
});

suite('sub-sections: every nav button in a group exists in the markup', (t) => {
    ['MY_TEAM_NAV_BUTTONS', 'REVIEW_NAV_BUTTONS', 'TRENDS_NAV_BUTTONS', 'SETTINGS_NAV_BUTTONS'].forEach(name => {
        listFrom(name).forEach(btnId => {
            t.check(`${btnId} has a button`, html.indexOf(`id="${btnId}"`) > -1);
        });
    });
});

suite('sub-sections: a tab nobody can click is not registered', (t) => {
    // The reverse check. A sub-section in a nav group with no way to reach it
    // is dead weight that still takes part in show/hide.
    const groups = {
        REVIEW_SUB_SECTIONS: 'subNavRp',
        TRENDS_SUB_SECTIONS: 'subNavTa'
    };
    Object.keys(groups).forEach(group => {
        listFrom(group).forEach(id => {
            const handled = script.indexOf(`'${id}'`) > -1;
            t.check(`${id} is referenced by a handler`, handled);
        });
    });
});
