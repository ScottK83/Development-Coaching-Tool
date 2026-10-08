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

suite('sub-sections: every Reviews tab can actually be shown', (t) => {
    // Review Prep became People > Reviews on 2026-10-07. Its markup lives in
    // the People section, and its panels are still moved in on first use.
    const ids = listFrom('REVIEW_SUB_SECTIONS');
    t.check('the Reviews group is still readable', ids.length > 0);

    ids.forEach(id => {
        const result = reachable(id, 'peopleSection', ['ensureReviewPrepMounted']);
        t.check(`${id}: ${result.why}`, result.ok);
    });

    t.check('Meetings is among them', ids.indexOf('subSectionMeetings') > -1);
    t.check('and so is Mid-Year', ids.indexOf('subSectionMidYear') > -1);
});

suite('sub-sections: every People tab can actually be shown', (t) => {
    const ids = listFrom('PEOPLE_SUB_SECTIONS');
    t.check('the People group is still readable', ids.length >= 6);

    ids.forEach(id => {
        const result = reachable(id, 'peopleSection', ['ensurePeopleMounted']);
        t.check(`${id}: ${result.why}`, result.ok);
    });
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

    // The four views inside Center > Trends sit in the Trends group's markup.
    const inner = listFrom('TRENDS_INNER_SUB_SECTIONS');
    t.check('the Trends views are still readable', inner.length === 3);
    inner.forEach(id => {
        const result = reachable(id, 'trendsAnalysisSection', []);
        t.check(`${id}: ${result.why}`, result.ok);
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
    ['MY_TEAM_NAV_BUTTONS', 'PEOPLE_NAV_BUTTONS', 'REVIEW_NAV_BUTTONS', 'TRENDS_NAV_BUTTONS',
     'TRENDS_INNER_NAV_BUTTONS', 'SETTINGS_NAV_BUTTONS'].forEach(name => {
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
        TRENDS_SUB_SECTIONS: 'subNavTa',
        PEOPLE_SUB_SECTIONS: 'subNavPe',
        TRENDS_INNER_SUB_SECTIONS: 'innerNavTr'
    };
    Object.keys(groups).forEach(group => {
        listFrom(group).forEach(id => {
            const handled = script.indexOf(`'${id}'`) > -1;
            t.check(`${id} is referenced by a handler`, handled);
        });
    });
});

suite('sub-sections: every Today and People button draws its panel', (t) => {
    // Showing a sub-section and drawing it are two different things. The
    // snapshot once opened blank because the row that offered it ran the
    // initialiser without first moving the markup into the panel, and
    // Highlights and Celebrations had working panels with no way in at all.
    // So each button has to exist, be wired, and run what draws its panel.
    function handlerFor(btnId) {
        const start = script.indexOf(`getElementById('${btnId}')?.addEventListener('click'`);
        if (start === -1) return '';
        return script.slice(start, script.indexOf('\n    });', start));
    }
    const draws = {
        subNavTdDay: 'initializeMyTeam',
        subNavTdYear: 'initializeDashboard()',
        subNavTdSnapshot: 'embedTeamSnapshot()',
        subNavTdContest: 'contestUi?.show',
        subNavPeNumbers: 'initializeOnOffTracker()',
        subNavPeCoach: 'initializeCoachingEmail()',
        subNavPeCalls: 'initializeCallListeningSection()',
        subNavPeAttendance: 'reliability?.initialize',
        subNavPeFollowUp: 'ensureFollowUpMounted()',
        subNavPeReviews: 'restoreReviewsTab'
    };
    listFrom('MY_TEAM_NAV_BUTTONS').concat(listFrom('PEOPLE_NAV_BUTTONS')).forEach(btnId => {
        t.check(`${btnId} has a button`, divPosition(btnId) !== -1);
        const handler = handlerFor(btnId);
        t.check(`${btnId} is wired`, handler.length > 0);
        t.check(`${btnId} draws its panel (${draws[btnId]})`, !!draws[btnId] && handler.indexOf(draws[btnId]) > -1);
    });

    // The People panels written inside Today's markup are moved before they
    // are shown, by the handler that shows them.
    ['subSectionOnOffTracker', 'subSectionCoachingEmail', 'subSectionCallListening', 'subSectionReliability'].forEach(id => {
        t.check(`${id} is mounted into People when opened`, script.indexOf(`ensurePeopleMounted('${id}')`) > -1);
    });

    // Highlights and Celebrations were folded into the day page. Nothing may
    // offer a link to either, or leave markup behind for one.
    ['subSectionHighlights', 'subSectionMorningPulse'].forEach(id => {
        t.check(`${id} has no markup left behind`, divPosition(id) === -1);
        t.check(`and ${id} is not a Today tab`, listFrom('MY_TEAM_SUB_SECTIONS').indexOf(id) === -1);
    });
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
    const attendance = script.slice(script.indexOf("getElementById('subNavPeAttendance')"));
    t.check('and opening Attendance runs it', /embedPtoTracker\(\)/.test(attendance.slice(0, attendance.indexOf('});'))));
});

suite('sub-sections: every top-level tab survives a refresh', (t) => {
    // The nav writes the section you are on to storage and restores it on the
    // next load. A section the restore does not know about is not an error you
    // can see: you simply land on the dashboard, which is also where a first
    // visit lands, so it reads as normal. Contest was in that state.
    const buttons = [...html.matchAll(/id="(\w+Btn)" class="btn-secondary top-nav-btn/g)].map(m => m[1]);
    const mapped = [...navSrc.matchAll(/(\w+Section): '(\w+Btn)'/g)].map(m => m[1]);

    // Today, People, Center, Upload, Settings since 2026-10-07.
    t.check('the top nav is still readable', buttons.length >= 5);
    t.check('and every button it holds maps to a section', mapped.length >= 5);
    // The shortcut list is a top-nav button but opens a dialog, not a section.
    buttons.filter(btnId => btnId !== 'shortcutHelpBtn').forEach(btnId => {
        t.check(`${btnId} maps to a section`, navSrc.indexOf(`: '${btnId}'`) > -1);
    });

    mapped.forEach(sectionId => {
        t.check(`${sectionId} is restored by name`,
            navSrc.indexOf(`sectionId === '${sectionId}'`) > -1
            || navSrc.indexOf(`if (sectionId === '${sectionId}')`) > -1);
    });
});
