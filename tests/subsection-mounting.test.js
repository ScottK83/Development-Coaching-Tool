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

suite('sub-sections: My Team offers every tab it registers', (t) => {
    // My Team stopped having a nav row of its own: the day hub draws one in JS
    // and the row of hidden buttons was deleted. So "does a button with this id
    // exist in index.html" stopped being the question. The question is whether
    // the row the hub draws offers the tab, and whether opening it draws it.
    //
    // Both halves matter. Highlights and Celebrations had markup, modules and
    // buttons that all worked, and no way in at all, because the only thing
    // that reached them was a nav row that had been hidden. And the snapshot
    // was offered but opened blank, because the row that offered it called the
    // initialiser without first moving the markup into the panel.
    const myTeam = fs.readFileSync(path.join(ROOT, 'modules', 'my-team.module.js'), 'utf8');

    const offered = [...myTeam.matchAll(/\{ id: '(subSection\w+)', btn: '\w+', label: '[^']+' \}/g)]
        .map(m => m[1]);
    t.check('the quiet row is still readable', offered.length >= 6);

    const initialisers = myTeam.slice(myTeam.indexOf('TAB_INITIALISERS'));
    offered.forEach(id => {
        t.check(`${id} has markup`, divPosition(id) !== -1);
        t.check(`${id} is drawn when opened`, initialisers.indexOf(`${id}:`) > -1);
    });

    // The tabs the hub itself owns are not in that row, so name them here
    // rather than letting the list quietly shrink to nothing.
    ['subSectionHighlights', 'subSectionMorningPulse', 'subSectionCoachingEmail',
     'subSectionTeamSnapshot', 'subSectionCallListening', 'subSectionReliability'].forEach(id => {
        t.check(`${id} is offered`, offered.indexOf(id) > -1);
    });

    // One owner for open-and-draw. Two owners is what let the snapshot open
    // blank from one row and fine from the other.
    t.check('opening a tab goes through one function',
        /function openTab\(subSectionId, buttonId\)/.test(myTeam));
    t.check('and a refresh restores through it too',
        navSrc.indexOf('myTeam.openTab(subId, btnId)') > -1);
});

suite('sub-sections: the time-off tracker is inside Attendance, not stranded', (t) => {
    // PTO stopped being a tab of its own: navigation still rewrites a saved
    // subSectionPto to Attendance. The move was never finished. embedPtoTracker
    // looked for a container that did not exist in the markup, so the tracker
    // sat in a section nothing could show while its PDF import went on writing
    // balances nobody could read.
    const myTeam = fs.readFileSync(path.join(ROOT, 'modules', 'my-team.module.js'), 'utf8');

    t.check('the container it moves into exists', divPosition('embeddedPtoInMyTeam') !== -1);
    t.check('and it sits inside the Attendance panel',
        divPosition('embeddedPtoInMyTeam') > divPosition('subSectionReliability'));
    t.check('the standalone section is still there to move from', divPosition('ptoSection') !== -1);
    t.check('the mover names that container',
        /embeddedPtoInMyTeam/.test(script) && /getElementById\('ptoSection'\)/.test(script));
    t.check('and opening Attendance runs it', /embedPtoTracker\?\.\(\)/.test(myTeam));
});
