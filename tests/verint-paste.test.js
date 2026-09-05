'use strict';

/**
 * The colour coding is the speaker labels.
 *
 * Verint cannot export who was talking. Its transcript is colour coded, which
 * is how Scott reads it on screen, and a textarea keeps only the plain text,
 * so the app was discarding the answer at the door and then guessing at it for
 * the rest of the pipeline. That guess quoted a customer's opening line back
 * to the associate as her own.
 *
 * A paste carries an HTML flavour alongside the plain one, colours intact.
 * These tests cover reading it, and they cover the declines harder than the
 * successes: a wrong label is worse than no label, because no label leaves
 * hedged output while a wrong one produces confident nonsense.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/verint-paste.module.js');
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    return global.window.DevCoachModules;
}

// Two speakers, and the same colour deliberately written three ways, which is
// what a real clipboard looks like.
const COLOURED = [
    '<div>',
    '<p><span style="color:#0000ff">00:05</span></p>',
    '<p><span style="color:#0000ff">thank you so much for being a part of a p s my name is esther how may i help you tonight</span></p>',
    '<p><span style="color:#008000">00:10</span></p>',
    '<p><span style="color:#008000">i got an apartment i signed a lease today i need to look up the account</span></p>',
    '<p><span style="color:#0000FF">00:23</span></p>',
    '<p><span style="color:#0000FF">okay can i go ahead and get that street address please</span></p>',
    '<p><span style="color: rgb(0, 128, 0)">01:15</span></p>',
    '<p><span style="color: rgb(0, 128, 0)">yeah i will need to find it, hold on</span></p>',
    '<p><span style="color:blue">02:44</span></p>',
    '<p><span style="color:blue">allow me one moment so i can look at that address</span></p>',
    '</div>'
].join('\n');

suite('verint paste: one colour, however it is written', (t) => {
    const { verintPaste } = load(t);
    const same = verintPaste.normalizeColour;

    // All three spellings turned up in one paste and read as three speakers,
    // so the whole conversion declined.
    t.equal('hex and rgb agree', same('#0000ff'), same('rgb(0, 0, 255)'));
    t.equal('and the name agrees with both', same('blue'), same('#0000FF'));
    t.equal('short hex expands', same('#00f'), same('#0000ff'));
    t.check('and different colours stay different', same('blue') !== same('green'));
    t.equal('an unknown value is kept as itself', same('  Papaya  '), 'papaya');

    // Where a colour is not declared at all, a class name separates speakers
    // just as well.
    t.check('a colour is read from an inline style', verintPaste.styleKeyOf(' style="color:#0000ff"').startsWith('c:'));
    t.check('and from a font tag', verintPaste.styleKeyOf(' color="blue"').startsWith('c:'));
    t.check('a class stands in when there is no colour',
        verintPaste.styleKeyOf(' class="speaker-agent"').startsWith('k:'));
    t.equal('and nothing means nothing', verintPaste.styleKeyOf(' width="4"'), '');
});

suite('verint paste: the colours become labels', (t) => {
    const { verintPaste, callTranscript } = load(t);

    const out = verintPaste.toLabelledTranscript(COLOURED, { advisorName: 'Esther Ramos' });
    t.check('the paste is converted', Boolean(out?.text));
    t.equal('two speakers were found', out.speakers, 2);

    // The advisor is the one who opens the call, so the colour wearing the
    // branded greeting is hers.
    t.check('the greeting is the advisor', /Agent: thank you so much for being a part/.test(out.text));
    t.check('and the other colour is the customer', /Customer: i got an apartment/.test(out.text));
    t.check('the advisor keeps her later turns', /Agent: okay can i go ahead/.test(out.text));
    t.check('and so does the customer', /Customer: yeah i will need to find it/.test(out.text));

    // The timestamps have to survive: the silence maths is built on them.
    ['00:05', '00:10', '00:23', '01:15', '02:44'].forEach((stamp) => {
        t.check(`the ${stamp} timestamp survives`, new RegExp(`^${stamp}$`, 'm').test(out.text));
    });
    t.check('and a timestamp is never labelled', !/(Agent|Customer): \d{1,3}:\d\d/.test(out.text));

    // The point of the whole exercise: the parser stops guessing.
    const parsed = callTranscript.parseTranscript(out.text, { associateName: 'Esther Ramos' });
    t.check('the transcript now reads as labelled', parsed.labeled === true);
    t.equal('and the sides alternate as they should',
        parsed.turns.map((turn) => turn.role).join(','),
        'agent,customer,agent,customer,agent');

    // Which is what turns off every hedge downstream.
    const analysis = callTranscript.analyzeTranscript(out.text, { associateName: 'Esther Ramos' });
    t.check('so the summary stops warning about inferred sides',
        !/no speaker labels found/.test(callTranscript.buildAnalysisSummary(analysis)));
});

suite('verint paste: it declines rather than guess', (t) => {
    const { verintPaste } = load(t);
    const convert = (html) => verintPaste.toLabelledTranscript(html, { advisorName: 'Esther Ramos' });

    // No colour came through, so there is nothing to attribute with.
    t.equal('plain markup is declined',
        convert('<p>00:05</p><p>thank you for calling, my name is esther</p><p>hello there i need help</p>'), null);

    // One colour is a transcript that is not speaker coloured.
    t.equal('a single colour is declined', convert([
        '<p><span style="color:#000">00:05</span></p>',
        '<p><span style="color:#000">thank you for calling my name is esther</span></p>',
        '<p><span style="color:#000">i need help with my bill please</span></p>'
    ].join('')), null);

    // Three or more is not speaker colouring either, and reading it as such
    // would be inventing attribution.
    t.equal('three colours are declined', convert([
        '<p><span style="color:red">thank you for calling my name is esther</span></p>',
        '<p><span style="color:green">i need help with my bill</span></p>',
        '<p><span style="color:blue">and something else entirely here</span></p>'
    ].join('')), null);

    // Neither group can be shown to be the advisor. Labelling on a coin flip
    // is the one outcome worse than not labelling.
    t.equal('no greeting in either colour is declined', convert([
        '<p><span style="color:red">okay let me take a look at that for you</span></p>',
        '<p><span style="color:green">i think there is a problem with the bill</span></p>',
        '<p><span style="color:red">right i can see the charge here</span></p>'
    ].join('')), null);

    // Not worth rewriting the box for a couple of lines.
    t.equal('too few labelled lines is declined', convert([
        '<p><span style="color:red">thank you for calling my name is esther</span></p>',
        '<p><span style="color:green">hello</span></p>'
    ].join('')), null);

    t.equal('empty input is declined', convert(''), null);
    t.equal('and so is nothing at all', convert(null), null);
});

suite('verint paste: the markup does not leak through', (t) => {
    const { verintPaste } = load(t);

    const out = verintPaste.toLabelledTranscript([
        '<style>.a{color:red}</style>',
        '<p><span style="color:red">00:05</span></p>',
        '<p><span style="color:red">thank you for calling, my name is esther &amp; i can help</span></p>',
        '<p><span style="color:green">00:10</span></p>',
        '<p><span style="color:green">my bill is &lt;double&gt; what it was &#39;last month&#39;</span></p>',
        '<p><span style="color:red">00:20</span></p>',
        '<p><span style="color:red">let me&nbsp;take a look at that&mdash;one moment</span></p>'
    ].join(''), { advisorName: 'Esther Ramos' });

    t.check('it converted', Boolean(out?.text));
    // Not "no angle brackets": &lt;double&gt; decodes to <double>, which is
    // the customer's own words and has to survive. What must not survive is
    // markup.
    // Not "no angle brackets": &lt;double&gt; decodes to <double>, which is
    // the customer's own words and has to survive. Markup is what must not.
    t.check('no markup survives', !/<span|<p[ >]|<\/|style\s*=|color\s*:/i.test(out.text));
    t.check('a stylesheet is not read as speech', !/color:red/.test(out.text));
    t.check('entities are decoded', /esther & i can help/.test(out.text));
    t.check('and angle bracket entities too', /my bill is <double>/.test(out.text));
    t.check('an apostrophe entity is decoded', /'last month'/.test(out.text));
    t.check('a non breaking space is a space', /let me take a look/.test(out.text));

    // Transcript text gets quoted into messages that go out with a
    // supervisor's name on them, so it follows the same rule as the copy.
    t.check('no em dash survives the decode', !/[‒-―−]/.test(out.text));
});

suite('verint paste: wiring', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    t.check('the module is in the loader', html.includes('modules/verint-paste.module.js'));
    t.check('it loads before the parser that benefits',
        html.indexOf('modules/verint-paste.module.js') < html.indexOf('modules/call-transcript.module.js'));

    t.check('the transcript box listens for a paste',
        /bindElementOnce\(document\.getElementById\('callListeningTranscript'\), 'paste', handleTranscriptPaste\)/.test(script));

    // Only take the paste over once the conversion has actually worked, so a
    // decline costs the supervisor nothing.
    t.check('the default paste is only prevented after a successful read',
        /if \(!converted\?\.text\) return;[\s\S]{0,200}event\.preventDefault\(\)/.test(script));
    t.check('and the associate name is passed in to help identify the advisor',
        /handleTranscriptPaste[\s\S]{0,900}advisorName/.test(script));
    t.check('it says what it did', /Read the colour coding/.test(script));

    // The parser has to honour the labels once they are there, or none of this
    // changes anything.
    const transcript = fs.readFileSync(path.join(ROOT, 'modules/call-transcript.module.js'), 'utf8');
    t.check('a labelled timestamped transcript reports as labelled',
        /rolesFromTimestampedLabels\(timestamped\), true/.test(transcript));
    t.check('and a mostly unlabelled one still infers',
        /inferRolesByFlow\(attributeByCue\(timestamped\)\), false/.test(transcript));
});
