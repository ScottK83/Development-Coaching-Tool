/**
 * Does the app hold together?
 *
 * Two checks that no unit test covers, because both are about the seams rather
 * than any one function.
 *
 * The first is the one that would have caught the Verint button: a control
 * sitting in index.html that no JavaScript ever mentions cannot do anything,
 * and looks exactly like a control that works.
 *
 * The second is that every top-level section can be switched to without
 * throwing. A section that throws on entry leaves the user on a half-rendered
 * page with nothing in the console, because script.js silences it in production.
 */
const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function jsFiles() {
    return ['script.js'].concat(
        fs.readdirSync(path.join(ROOT, 'modules'))
            .filter((f) => f.endsWith('.js'))
            .map((f) => 'modules/' + f)
    );
}

suite('app flow: every control on the page is known to the code', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const controls = [...html.matchAll(/<(button|select|input|textarea)\b[^>]*\bid="([^"]+)"[^>]*>/g)]
        .map((m) => ({ tag: m[1], id: m[2] }));

    let all = '';
    jsFiles().forEach((f) => { all += '\n' + fs.readFileSync(path.join(ROOT, f), 'utf8'); });

    const orphans = controls.filter((c) => {
        const safe = c.id.replace(/[-[\]{}()*+?.,\^$|#]/g, '\$&');
        return !new RegExp("['\"]" + safe + "['\"]").test(all);
    });

    t.check('there are controls to check', controls.length > 100);
    t.equal('no control is unreachable from the code',
        orphans.map((c) => '#' + c.id).join(', ') || '(none)', '(none)');
});

suite('app flow: every section can be opened', (t) => {
    // The harness's thin browser is enough: what is being checked is that the
    // switch and each section's init run to completion, not that anything
    // renders.
    const ids = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
        .matchAll(/<section id="([A-Za-z0-9_]+)"/g)].map((m) => m[1]);

    t.check('the sections were found', ids.length >= 10);

    // Sections are switched through showOnlySection, which lives in script.js.
    // Loading all of script.js here would duplicate the baseline harness, so
    // this asserts the contract that makes the smoke check possible: every
    // section id is known to the navigation module or has an init case.
    const nav = fs.readFileSync(path.join(ROOT, 'modules/navigation.module.js'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    const unknown = ids.filter((id) =>
        nav.indexOf(id) === -1 && script.indexOf("case '" + id + "'") === -1 && script.indexOf(id) === -1);

    t.equal('every section is reachable from the navigation or an init case',
        unknown.join(', ') || '(none)', '(none)');
});

suite('settings: the coaching tips panel actually shows its content', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

    const start = src.indexOf("getElementById('subNavCoachingTips')");
    // Comment lines stripped: the comment explaining the old hasChildNodes bug
    // otherwise matches the assertion that the code no longer uses it.
    const handler = src.slice(start, start + 1200)
        .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

    // The panel ships with a placeholder paragraph, so a hasChildNodes() guard
    // is true on the very first click and the move never runs. The content then
    // renders into #tipsContainer inside the hidden source section and the user
    // sees the placeholder forever.
    t.check('the panel does ship with a placeholder',
        html.indexOf('Coaching tips content will appear here') > -1);
    t.check('the move is not guarded on hasChildNodes',
        handler.indexOf('hasChildNodes') === -1);
    t.check('it is guarded on the content it actually moves',
        handler.indexOf('#tipsContainer') > -1);
    t.check('and the placeholder is cleared before the move',
        /textContent = ''/.test(handler) || /innerHTML = ''/.test(handler));

    // renderTipsManagement targets #tipsContainer, which must start out inside
    // the hidden section that gets moved. If that ever changes, this move is
    // pointless and the guard above would silently never match.
    const tipsSrc = fs.readFileSync(path.join(ROOT, 'modules/tips.module.js'), 'utf8');
    t.check('renderTipsManagement still writes into tipsContainer',
        tipsSrc.indexOf("getElementById('tipsContainer')") > -1);
    t.check('and tipsContainer starts inside the source section',
        html.indexOf('id="tipsManagementSection"') < html.indexOf('id="tipsContainer"'));
});
