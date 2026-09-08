'use strict';

const { suite } = require('./harness');

/**
 * WORKING OUT WHO IS TALKING WHEN NOBODY SAID
 *
 * Labels are the best case and often they are simply not there. Verint has no
 * label export, and where the two sides are separated by an icon in a gutter
 * rather than by the text, a paste carries no difference at all. That is the
 * normal transcript, not a broken one, and it has to be read well.
 *
 * The old rule was that anything over eight words was the advisor. A customer
 * explaining her bill for ninety seconds became the advisor talking, which
 * then fed every downstream read of who said a scored phrase, whose emotion
 * cue it was, and who held the call.
 */

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/sentiment.module.js');
    return t.loadModule('modules/call-transcript.module.js').callTranscript;
}

function timestamped(lines) {
    const out = [];
    lines.forEach((line, index) => {
        const minute = String(Math.floor(index / 2)).padStart(2, '0');
        const second = String((index * 17) % 60).padStart(2, '0');
        out.push(`${minute}:${second}`);
        out.push(line);
    });
    return out.join('\n');
}

function rolesOf(parsed) {
    return parsed.turns.map((turn) => turn.role);
}

suite('role inference: a long customer turn is not the advisor', (t) => {
    const callTranscript = load(t);

    // Straight from a real call. The customer holds the floor for a paragraph
    // explaining her bill, which under the old word count rule was read as the
    // advisor talking, because it was long.
    const parsed = callTranscript.parseTranscript(timestamped([
        'well make s is robert speaking how can i help you',
        'hi robert this is sheryl and i am calling about',
        'alright and for security purposes can you please verify the last four digits',
        'i thought it was weird last month when my bill went up because there is no one there and they went up by five dollars last month or somewhere around there and this month it has gone from seventeen dollars to thirty nine thirty one and there is no one there and i had someone go over and make sure they are not connecting an extension',
        'yes ma am',
        'so now what do i do because there is no one there and they checked everything'
    ]));

    const roles = rolesOf(parsed);
    t.equal('the greeting is the advisor', roles[0], 'agent');
    t.equal('the caller introducing herself is the customer', roles[1], 'customer');
    t.equal('the security check is the advisor', roles[2], 'agent');
    t.equal('and the long bill explanation is the customer', roles[3], 'customer');
    t.equal('a two word acknowledgement is still the advisor', roles[4], 'agent');
    t.equal('and the follow up question is the customer', roles[5], 'customer');

    t.check('so the bill complaint lands in the customer text',
        parsed.customerText.indexOf('thirty nine thirty one') > -1);
    t.check('and not in the advisor text',
        parsed.agentText.indexOf('thirty nine thirty one') === -1);
});

suite('role inference: turns alternate unless the words say otherwise', (t) => {
    const callTranscript = load(t);

    // Nothing here names a side after the opening. Alternation is the whole
    // signal, and it is a good one.
    const parsed = callTranscript.parseTranscript(timestamped([
        'thank you for calling how can i help you today',
        'yeah i think so',
        'okay',
        'that one',
        'right',
        'sure'
    ]));

    t.equal('it alternates', rolesOf(parsed).join(','), 'agent,customer,agent,customer,agent,customer');
});

suite('role inference: a clear line late in the call fixes an early one', (t) => {
    const callTranscript = load(t);

    // The point of deciding the whole call at once. The opening two turns say
    // nothing about who is who. The advisor gives themselves away four turns
    // later, and that has to reach back.
    const parsed = callTranscript.parseTranscript(timestamped([
        'okay',
        'right',
        'yeah',
        'sure',
        'is there anything else i can help you with today',
        'no that is everything thank you so much'
    ]));

    const roles = rolesOf(parsed);
    t.equal('the giveaway line is the advisor', roles[4], 'agent');
    t.equal('the thanks after it is the customer', roles[5], 'customer');
    // Alternating back from that anchor puts the opening on the advisor, which
    // is also where a call actually starts.
    t.equal('and it reaches all the way back', roles[0], 'agent');
});

suite('role inference: one side may take two turns in a row', (t) => {
    const callTranscript = load(t);

    // Alternation is a lean, not a law. Two advisor lines running is ordinary
    // and the words have to be allowed to win.
    const parsed = callTranscript.parseTranscript(timestamped([
        'thank you for calling my name is robert how can i help',
        'i need to sort out my bill',
        'for security purposes can you please verify the last four',
        'let me pull up your account while we wait',
        'okay'
    ]));

    const roles = rolesOf(parsed);
    t.equal('two advisor lines in a row are allowed', roles[2] + ',' + roles[3], 'agent,agent');
    t.equal('and the customer turn between them is not lost', roles[1], 'customer');
});

suite('role inference: it says how it knew', (t) => {
    const callTranscript = load(t);

    const parsed = callTranscript.parseTranscript(timestamped([
        'thank you for calling how may i help you',
        'my bill went up and i do not understand it',
        'okay',
        'right'
    ]));

    t.check('an unlabelled transcript reports as unlabelled', parsed.labeled === false);

    // A turn whose own words placed it is a different thing from one placed by
    // the shape of the conversation, and downstream leans on knowing which.
    const voiced = parsed.turns.filter((turn) => turn.cued || turn.voiced);
    t.check('the turns that named their own side are marked', voiced.length >= 2);
    const quiet = parsed.turns.filter((turn) => !turn.cued && !turn.voiced);
    t.check('and the ones that did not are not pretending otherwise',
        quiet.every((turn) => turn.inferred === true));
});

suite('role inference: labels still beat it outright', (t) => {
    const callTranscript = load(t);

    // None of this competes with a real label. A colour coded paste carries
    // them and they win, which is the whole reason the paste reader exists.
    const parsed = callTranscript.parseTranscript([
        'Agent: thank you for calling how can i help',
        'Customer: my bill went up',
        'Agent: let me take a look at that'
    ].join('\n'));

    t.check('a labelled transcript reports as labelled', parsed.labeled === true);
    t.equal('and the labels are obeyed', rolesOf(parsed).join(','), 'agent,customer,agent');
});

suite('role inference: no paperwork of the customer own is a service failure', (t) => {
    const callTranscript = load(t);

    // Once the customer's long turns were attributed correctly, this surfaced.
    // A Canadian student saying they have no social security number yet is
    // describing their own paperwork. Read as trouble it turned a routine
    // setup call into one that needed empathy and did not get it.
    const routine = callTranscript.analyzeTranscript(timestamped([
        'thank you for calling my name is melissa how can i help',
        'i am moving to the us for school and i still have not got my social security number yet',
        'okay so we will need either your social insurance number or a deposit',
        'yeah that is fine'
    ]));
    t.check('no empathy coaching on a routine setup call',
        !(routine.allImprovements || []).some((item) => item.key === 'empathy'));

    // A real service failure still counts.
    const failure = callTranscript.analyzeTranscript(timestamped([
        'thank you for calling my name is melissa how can i help',
        "i still haven't received my refund and it has been three weeks",
        'okay let me take a look at the account'
    ]));
    t.check('a refund that never arrived is still trouble',
        (failure.allImprovements || []).some((item) => item.key === 'empathy'));
});
