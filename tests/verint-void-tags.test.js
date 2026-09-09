'use strict';

/**
 * A line break must not put the customer's words in the agent's mouth.
 *
 * extractRuns tracks colour with a stack: an opening tag pushes, a closing tag
 * pops, and the text between them takes whatever is on top. Self-closing tags
 * were skipped by testing `tag.endsWith('/')`, which is the only thing that
 * marked them.
 *
 * <br> is written without the slash far more often than with it. So a plain
 * <br> pushed a copy of the current style onto the stack and nothing ever
 * popped it -- there is no </br>. The next real closing tag popped the <br>'s
 * frame instead of its own, and the style stayed active for whatever followed
 * inside the same block.
 *
 * In a Verint paste that means an uncoloured line is emitted as the advisor.
 * "Agent: [Customer placed on hold]" is the mild version; the same leak puts
 * the customer's own words under the agent's label, in a transcript that goes
 * on to be scored for QA and quoted back in coaching.
 */

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/verint-paste.module.js').verintPaste;
}

const AGENT = 'color:#0000ff';
const CUSTOMER = 'color:#ff0000';

suite('verint paste: a plain <br> does not leak the advisor colour', (t) => {
    const vp = load(t);

    // The shape that leaks: the <br> is inside the advisor's span, and the text
    // that follows sits after the </span> but still inside the same block.
    const html =
        '<div><span style="' + AGENT + '">Thank you for calling, my name is Dana speaking.<br></span>'
        + '[Customer placed on hold]</div>'
        + '<div><span style="' + CUSTOMER + '">I need help with my bill.</span></div>';

    const runs = vp.extractRuns(html).filter((r) => (r.text || '').trim());
    const hold = runs.find((r) => (r.text || '').indexOf('placed on hold') > -1);

    t.check('the hold note is in the runs', !!hold);
    t.equal('and it carries no style of its own', hold && (hold.key || ''), '');

    const greeting = runs.find((r) => (r.text || '').indexOf('Thank you for calling') > -1);
    t.check('while the advisor line keeps its colour', !!greeting && !!greeting.key);
    t.check('and the customer line keeps a different one',
        runs.find((r) => (r.text || '').indexOf('my bill') > -1).key !== greeting.key);
});

suite('verint paste: an uncoloured line is left unlabelled', (t) => {
    const vp = load(t);

    const html =
        '<div><span style="' + AGENT + '">Thank you for calling, my name is Dana speaking.<br></span></div>'
        + '<div>[Customer placed on hold]</div>'
        + '<div><span style="' + CUSTOMER + '">I need help with my bill.</span></div>'
        + '<div><span style="' + CUSTOMER + '">Are you still there?</span></div>';

    const result = vp.toLabelledTranscript(html);
    t.check('the transcript is labelled at all', !!result);
    if (!result) return;

    t.check('the advisor is named', result.text.indexOf('Agent: Thank you for calling') > -1);
    t.check('the customer is named', result.text.indexOf('Customer: I need help') > -1);
    t.check('and the hold note is not attributed to anybody',
        result.text.indexOf('Agent: [Customer placed on hold]') === -1
        && result.text.indexOf('Customer: [Customer placed on hold]') === -1);
    t.check('but it is still in the transcript',
        result.text.indexOf('[Customer placed on hold]') > -1);
});

suite('verint paste: the slashed forms still behave', (t) => {
    const vp = load(t);

    // <br/> was already handled, and must stay handled. Other void elements
    // travel with it now, written either way.
    ['<br>', '<br/>', '<br />', '<hr>', '<img src="x">'].forEach((voidTag) => {
        const html =
            '<div><span style="' + AGENT + '">Thanks for calling, my name is Dana.' + voidTag + '</span>'
            + 'trailing</div>';
        const runs = vp.extractRuns(html).filter((r) => (r.text || '').trim());
        const trailing = runs.find((r) => (r.text || '').trim() === 'trailing');
        t.check(voidTag + ' does not leak a style frame', !!trailing && !trailing.key);
    });
});
