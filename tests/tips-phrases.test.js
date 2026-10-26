'use strict';

/**
 * WHAT THE TIP POOL HAS TO COVER (audit 2026-10-25, sections 9 and 11)
 *
 * The pool had no verification tip at all, a Transfers pool that only ever
 * argued against transferring (nothing for a downed line), no tip for most
 * of the either-side emotion phrases an associate might say in sympathy, and
 * none of the APS call types beyond the bill itself: solar, reconnects,
 * payment posting, rate plan changes, scam calls. These pin that it does now,
 * using the app's own Verint matcher for anything quoted.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function pool() {
    const rows = fs.readFileSync(path.join(ROOT, 'tips.csv'), 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean);
    const byMetric = {};
    rows.forEach((row) => {
        const metric = row.slice(0, row.indexOf(','));
        (byMetric[metric] = byMetric[metric] || []).push(row.slice(row.indexOf(',') + 1));
    });
    return byMetric;
}

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-verification.module.js');
    t.loadModule('modules/call-word-choice.module.js');
    return global.window.DevCoachModules;
}

function tokens(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

suite('tip coverage: verification states the APS standard', (t) => {
    const tips = pool();
    // Name plus the last four of the social, a driver's license or the
    // password on the account; a call that came in authorized needs only the
    // name (Scott, 2026-09-30).
    const standard = tips.cxRepOverall.filter((tip) => /verif/i.test(tip) && /last four/i.test(tip)
        && /driver's license/i.test(tip) && /password/i.test(tip));
    t.check(`Rep Sat has at least two tips that state it (${standard.length})`, standard.length >= 2);
    t.check('one of them says an authorized call needs only the name',
        standard.some((tip) => /came in authorized/i.test(tip) && /name is enough/i.test(tip)));

    // Date of birth, a PIN or a security question do not count. A tip may
    // name them only to say so.
    const all = Object.values(tips).flat();
    const wrongProof = all.filter((tip) => /date of birth|security question|\bPIN\b/i.test(tip) && !/doesn't count|don't count/i.test(tip));
    t.equal(`no tip offers a date of birth, PIN or security question as proof (${wrongProof.join(' | ') || 'none'})`, wrongProof.length, 0);
    t.check('handle time does not push a second verification on an authorized call',
        tips.aht.some((tip) => /came in authorized/i.test(tip)));
});

suite('tip coverage: a safety call is handled straight away', (t) => {
    const tips = pool();
    const safety = tips.transfers.filter((tip) => /downed line|sparks|smoke/i.test(tip));
    t.check('Transfers says what a safety call sounds like', safety.length > 0);
    // APS's emergency routing is not confirmed, so the steps are named and
    // never a number or a team.
    t.check('and to follow the emergency steps right away', safety.every((tip) => /emergency steps right away/i.test(tip)));
    // The call reader's safety finding is scored against the Rep Sat pool.
    t.check('the safety finding has a Rep Sat tip to reach', tips.cxRepOverall.some((tip) => /safety/i.test(tip) && /emergency/i.test(tip)));
});

suite('tip coverage: the APS calls the pool used to miss', (t) => {
    const tips = pool();
    const has = (metric, pattern) => tips[metric].some((tip) => pattern.test(tip));
    t.check('FCR: a solar bill', has('fcr', /solar/i));
    t.check('FCR: a reconnect', has('fcr', /reconnect/i));
    t.check('FCR: how long a payment takes to post', has('fcr', /payment takes to post/i));
    t.check('FCR: when a rate plan change starts', has('fcr', /rate plan change/i));
    t.check('FCR: an estimated read', has('fcr', /estimated/i));
    t.check('Overall Experience: a scam call', has('overallExperience', /scam|gift card/i));
    t.check('Overall Experience: a deposit', has('overallExperience', /deposit/i));
    t.check('Overall Experience: a rate question', has('overallExperience', /\brates?\b/i));
    t.check('Overall Experience: solar', has('overallExperience', /solar/i));
    t.check('Overall Experience: the power back on after a disconnect', has('overallExperience', /back on/i));
});

suite('tip coverage: every Verint phrase an associate might say has a tip', (t) => {
    const { sentiment, callWordChoice } = load(t);
    const db = sentiment.getPhraseDatabase();
    const tips = pool();
    const named = (metric, phrase) => {
        const query = callWordChoice.compilePhrase(phrase);
        return tips[metric].some((tip) => query.test(tokens(tip)));
    };

    const unscored = db.positive.A.filter((phrase) => !named('positiveWord', phrase));
    t.equal(`every scored positive phrase has a Positive Word tip (${unscored.join(' | ') || 'all do'})`, unscored.length, 0);
    const unlisted = db.negative.A.filter((phrase) => !named('negativeWord', phrase));
    t.equal(`every penalized phrase has a Negative Word tip (${unlisted.join(' | ') || 'all do'})`, unlisted.length, 0);

    // Either-side emotion phrases count from the associate too. Profanity is
    // left unnamed on purpose: these tips go out in emails, and cuss words get
    // a message blocked. "Wasting my time" is only ever the caller's.
    const UNNAMED = new Set(['fucking', 'bullshit', 'what NEAR hell', 'pissed off', 'fuck you', 'wasting NEAR "my time"']);
    const either = [...(db.emotions.A || []), ...(db.emotions.E || [])].filter((phrase) => !UNNAMED.has(phrase));
    const uncovered = either.filter((phrase) => !named('managingEmotions', phrase));
    t.equal(`every either-side emotion phrase has a Managing Emotions tip (${uncovered.join(' | ') || 'all do'})`, uncovered.length, 0);
    ['ridiculous', 'cannot NEAR believe', 'totally unacceptable', 'very unhappy', 'not NEAR "good enough"'].forEach((phrase) => {
        t.check(`including "${phrase}"`, named('managingEmotions', phrase));
    });

    // A tip that says a phrase flags the call has to name one that does.
    const emotionQueries = [...(db.emotions.A || []), ...(db.emotions.E || [])].map((phrase) => callWordChoice.compilePhrase(phrase));
    const unfounded = tips.managingEmotions.filter((tip) => /\bflags?\b/i.test(tip) && !emotionQueries.some((query) => query.test(tokens(tip))));
    t.equal(`every "flags the call" tip names a listed phrase (${unfounded.join(' | ') || 'all do'})`, unfounded.length, 0);
});

suite('tip coverage: no penalized phrase is offered as the better thing to say', (t) => {
    const { sentiment, callWordChoice } = load(t);
    const db = sentiment.getPhraseDatabase();
    const flagged = [...db.negative.A, ...(db.emotions.A || []), ...(db.emotions.E || [])].map((phrase) => callWordChoice.compilePhrase(phrase));
    // What follows "Say", "Try", "with" or "Use" in quotes is what the
    // associate is told to use. It must not be on the list it is meant to
    // fix. "Don't say 'X'" and "Never say 'X'" name the phrase to drop, so a
    // negated one is skipped.
    const offered = [];
    Object.entries(pool()).forEach(([metric, tips]) => {
        tips.forEach((tip) => {
            const re = /\b(?:Say|say|Try|try|with|Use)\s+'((?:[^']|'(?=[a-z]))+)'/g;
            let m;
            while ((m = re.exec(tip))) {
                const before = tip.slice(Math.max(0, m.index - 20), m.index);
                if (/(don't|never|not|off)\s+(\w+\s+)?$/i.test(before)) continue;
                offered.push({ metric, tip, said: m[1] });
            }
        });
    });
    t.check(`the replacement lines were found (${offered.length})`, offered.length >= 60);
    const bad = offered.filter((item) => flagged.some((query) => query.test(tokens(item.said))));
    t.equal(`none of them is on the negative or emotion lists (${bad.map((b) => b.metric + ': ' + b.said).join(' | ') || 'none'})`, bad.length, 0);
});
