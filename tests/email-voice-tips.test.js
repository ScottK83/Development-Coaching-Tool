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
    t.check(`at least 13 Overall Experience tips (${pool.length})`, pool.length >= 13);

    // The APS utility floor: no named systems, no texting customers, no
    // follow-up emails, no promised exceptions.
    const offFloor = pool.filter((row) => /\btext (them|you|the customer)\b|follow-up email|\bCRM\b|knowledge base|exception/i.test(row));
    t.equal(`all of them fit the floor (${offFloor.join(' | ') || 'clean'})`, offFloor.length, 0);
    t.check('and no dashes as punctuation', !pool.some((row) => /[—–]| - /.test(row)));

    // Edits are stored by a tip's position inside its metric, so the old
    // five keep their places and the new ones come after them.
    t.check('the original first tip is still first',
        /^overallExperience,Open the call with 'I'd be happy to help you with that'/.test(pool[0]));
    t.check('and the original fifth is still fifth', /^overallExperience,Match the customer's energy/.test(pool[4]));
});
