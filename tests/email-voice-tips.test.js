'use strict';

/**
 * THE TIP POOL READS LIKE A SUPERVISOR TALKING
 *
 * Every tip goes into a message to an associate as written. Scott,
 * 2026-10-14, asked for wording that is plain, kind and easy to read. The
 * pool had words in capitals that read as shouting ("Type account notes
 * WHILE talking"), "ACW" where a person says after-call work, scoring talk
 * ("Reps scoring 100 on positive words..."), two tips that promised a
 * callback, tips with no full stop, and five Overall Experience tips, so the
 * same ones came round every week.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function rowsOf(csv) {
    return String(csv).replace(/^﻿/, '').trim().split(/\r?\n/).slice(1);
}

function poolCopies() {
    const csv = rowsOf(fs.readFileSync(path.join(ROOT, 'tips.csv'), 'utf8'));
    const src = fs.readFileSync(path.join(ROOT, 'modules/tips.module.js'), 'utf8');
    const embedded = rowsOf((src.match(/const EMBEDDED_TIPS_CSV = `([\s\S]*?)`;/) || [])[1] || '');
    return { csv, embedded };
}

function tipOf(row) {
    return row.slice(row.indexOf(',') + 1);
}

const ACRONYMS = new Set(['APS', 'PTO', 'PTOST', 'FMLA', 'HR', 'PC', 'ST']);

suite('email voice, tips: plain words, whole sentences', (t) => {
    const { csv, embedded } = poolCopies();
    t.check('both copies were read', csv.length > 500 && embedded.length === csv.length);

    [['tips.csv', csv], ['the embedded copy', embedded]].forEach(([where, rows]) => {
        const shouting = rows.filter((row) => (tipOf(row).match(/\b[A-Z]{2,}\b/g) || []).some((word) => !ACRONYMS.has(word)));
        t.equal(`${where}: no words in capitals for emphasis (${shouting.slice(0, 3).join(' | ') || 'clean'})`, shouting.length, 0);

        const unfinished = rows.filter((row) => !/[.!?]['"]?$/.test(tipOf(row).trim()));
        t.equal(`${where}: every tip ends like a sentence (${unfinished.slice(0, 3).join(' | ') || 'clean'})`, unfinished.length, 0);

        t.check(`${where}: "after-call work", not ACW`, !rows.some((row) => /\bACW\b/.test(tipOf(row))));
        t.check(`${where}: no scoring talk`, !rows.some((row) => /scoring 100|reliability score|counts in your favor|counts as a positive phrase/i.test(row)));
        t.check(`${where}: no promised callbacks`, !rows.some((row) => /promise a callback|said you'd call back|as a callback/i.test(row)));
        t.check(`${where}: "the customer", not "customer" with no article`,
            !rows.some((row) => /\b(If|so) customer\b|If call\b|for supervisor\b/.test(tipOf(row))));
        t.check(`${where}: no British "sorted"`, !rows.some((row) => /\bsorted\b/.test(tipOf(row))));
    });
});

suite('email voice, tips: Overall Experience has a real pool', (t) => {
    const { csv } = poolCopies();
    const pool = csv.filter((row) => row.startsWith('overallExperience,'));
    // 16 tips on 10/25, and 10 of them repeated another pool. Scott wants
    // about 40 a metric so the same ones do not come round week to week.
    t.check(`at least 40 Overall Experience tips (${pool.length})`, pool.length >= 40);

    // Its own advice, not a copy of another pool's.
    const elsewhere = new Set(csv.filter((row) => !row.startsWith('overallExperience,')).map((row) => keyOf(tipOf(row))));
    const copied = pool.filter((row) => elsewhere.has(keyOf(tipOf(row))));
    t.equal(`none of them is word for word in another pool (${copied.join(' | ') || 'none'})`, copied.length, 0);

    // Position no longer matters: edits and deletions are keyed by the tip's
    // own text (tests/tips-edits.test.js), so the old tips did not have to
    // keep their places.
});

function keyOf(tip) {
    return String(tip).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/*
 * The APS utility floor, over every tip in both copies. It used to be checked
 * on the Overall Experience pool only, and every other pool relied on being
 * read by eye.
 */
const FLOOR = [
    // Tools and channels associates do not have.
    ['a channel or system they do not have', /\btext(ing)? (them|you|the customer|customers)\b|follow-up email|send (them|the customer) an email|\bCRM\b|knowledge base/i],
    ['a wrap form', /\bfields?\b|drop-?down/i],
    // Not confirmed that associates can dial a customer, so no tip relies on it.
    ['dialing a customer back', /call (them|the customer|him|her) back|dial (out|them)/i],
    // The team is not granting exceptions; report it so we can give next steps.
    ['a promised exception', /exception|keep you in adherence/i],
    // The team is tenured.
    ['rookie or senior framing', /if you're new|as a new rep|still learning|shadow (a|an)\b|senior rep|tenured|rookie/i],
    ['a dash as punctuation', /[—–―]| - /],
    // An authorized call needs only the name.
    ['verification on every call', /verify identity every single time/i],
    // Unconfirmed figures and routing.
    ['an emergency number', /\b911\b|\d{3}[-. ]\d{4}/],
    ['a posting time', /\bpost(s|ed|ing)?\b[^.]*\b(in|within) \d+\s*(hours?|days?|business)/i],
    ['a dollar amount', /\$\s?\d/]
];

suite('email voice, tips: every tip fits the APS floor', (t) => {
    const { csv, embedded } = poolCopies();
    [['tips.csv', csv], ['the embedded copy', embedded]].forEach(([where, rows]) => {
        FLOOR.forEach(([what, pattern]) => {
            const offenders = rows.filter((row) => pattern.test(tipOf(row)));
            t.equal(`${where}: no tip names ${what} (${offenders.slice(0, 3).join(' | ') || 'clean'})`, offenders.length, 0);
        });
        // Reliability is never a focus outside its own pool.
        const reliabilityTalk = rows.filter((row) => !row.startsWith('reliability,') && /reliability|\bPTO(ST)?\b|occurrence/i.test(tipOf(row)));
        t.equal(`${where}: hours and reliability stay in the reliability pool (${reliabilityTalk.join(' | ') || 'clean'})`, reliabilityTalk.length, 0);
    });

    const hold = csv.filter((row) => row.startsWith('holdTime,'));
    t.check('hold time never points to a callback', !hold.some((row) => /callback|call (you|them) back|call back/i.test(row)));
});

suite('email voice, tips: every pool is big and has no repeats', (t) => {
    const { csv } = poolCopies();
    const byMetric = {};
    csv.forEach((row) => {
        const metric = row.slice(0, row.indexOf(','));
        (byMetric[metric] = byMetric[metric] || []).push(tipOf(row));
    });
    Object.keys(byMetric).forEach((metric) => {
        const tips = byMetric[metric];
        // About 40 a metric is the target; reliability only reaches the
        // dashboard tip of the day, so it carries the fewest.
        t.check(`${metric} has at least 33 tips (${tips.length})`, tips.length >= 33);
        // Edits and deletions are keyed by a tip's text, so two tips that
        // normalize to the same words would share every edit.
        const keys = tips.map(keyOf);
        const repeats = keys.filter((key, i) => keys.indexOf(key) !== i);
        t.equal(`${metric}: no two tips are the same words (${repeats.join(' | ') || 'none'})`, repeats.length, 0);
    });
});
