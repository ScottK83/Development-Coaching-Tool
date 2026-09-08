'use strict';

/**
 * A stored centre average is not rewritten at boot.
 *
 * migrateReliabilityCenterAverages existed to repair a legacy bug that had
 * saved centre reliability un-divided -- a raw total across the whole floor
 * rather than an average. It ran on every boot with no marker, and its rule was
 * "anything above 20 must be the un-divided total, so divide it by 144".
 *
 * That was safe only while a legitimate value could not exceed 20. It can. The
 * annual budget is 18 hours for a score of 3 and 24 for a 2, so a centre
 * genuinely averaging 21.4 hours missed sits squarely in the score-2 band -- and
 * this turned it into 0.15 and wrote it back. Permanently: the next boot leaves
 * 0.15 alone because it is now under the threshold, so there is nothing to
 * notice and nothing to undo.
 *
 * It could no longer repair anything either. It shipped on 2026-03-17 and ran on
 * every boot for months, so no un-migrated install is left, and the function that
 * writes these values -- calculateCenterAveragesFromEmployees -- already divides
 * by the head count it counted. So the migration was pure downside, and it is
 * gone.
 *
 * These tests keep it gone, and keep the writer honest.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function sourceFiles() {
    const files = [path.join(ROOT, 'script.js')];
    fs.readdirSync(path.join(ROOT, 'modules'))
        .filter((f) => f.endsWith('.module.js'))
        .forEach((f) => files.push(path.join(ROOT, 'modules', f)));
    return files;
}

suite('centre averages: nothing rescales a stored average at boot', (t) => {
    const offenders = [];
    sourceFiles().forEach((file) => {
        const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        const lines = src.split('\n');

        lines.forEach((line, i) => {
            // A stored value divided by a bare head-count-shaped constant. The
            // legitimate divisions are by a count the code just computed, which
            // is an identifier rather than a literal -- and by the rounding
            // factors, which are what `Math.round(x * 100) / 100` is made of.
            // Every divisor on the line, not just the last one: the shape being
            // guarded against is `Math.round((avg.reliability / 144) * 100) / 100`,
            // where the hazard is buried and the trailing `/ 100` is innocent.
            const ROUNDING_FACTORS = new Set(['10', '100', '1000', '10000']);
            if (!/reliability/i.test(line)) return;
            const divisors = [...line.matchAll(/\/\s*(\d+)/g)].map((m) => m[1]);
            const suspect = divisors.filter((d) => !ROUNDING_FACTORS.has(d));
            if (suspect.length) {
                offenders.push(`${rel}:${i + 1}  divides by ${suspect.join(', ')}  ${line.trim()}`);
            }
        });
    });

    t.equal('no reliability value is divided by a hardcoded head count',
        offenders.join('\n      ') || '(none)', '(none)');

    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    t.check('the boot-time rescaling migration is gone',
        script.indexOf('migrateReliabilityCenterAverages') === -1);
});

suite('centre averages: the writer divides by the head count it counted', (t) => {
    // The half that has to stay true for the deletion above to be safe. If this
    // ever goes back to summing, the stored value climbs past 20 again and the
    // temptation to "repair" it returns.
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const at = src.indexOf('function calculateCenterAveragesFromEmployees');
    t.check('the writer is still there', at > -1);

    const body = src.slice(at, src.indexOf('\n}\n', at));
    t.check('it counts the people it summed', /reliabilityCount\s*\+\+/.test(body));
    t.check('and divides the sum by that count',
        /reliabilitySum\s*\/\s*reliabilityCount/.test(body));
    t.check('rather than storing the raw sum',
        !/result\.reliability\s*=\s*[^;]*reliabilitySum\s*[;)]/.test(body)
        || /reliabilitySum\s*\/\s*reliabilityCount/.test(body));
});

suite('centre averages: a value in the score-2 band survives', (t) => {
    // The concrete case. 21.4 is a real number a centre can post: over the
    // 18-hour bar for a 3, under the 24-hour bar for a 2. The old migration
    // turned it into 0.15.
    const browser = t.installFakeBrowser();
    const PREFIX = 'devCoachingTool_';
    browser.store[PREFIX + 'callCenterAverages'] = JSON.stringify({
        '2026-08-17|2026-08-23': { reliability: 21.4, scheduleAdherence: 93 }
    });

    const storage = t.loadModule('modules/storage.module.js').storage;
    const before = storage.loadCallCenterAverages();
    t.equal('the stored average reads back as saved',
        before['2026-08-17|2026-08-23'].reliability, 21.4);

    // Nothing in the storage module rewrites it either, which is the only other
    // place it passes through on the way to a screen.
    const again = storage.loadCallCenterAverages();
    t.equal('and reading it twice does not move it',
        again['2026-08-17|2026-08-23'].reliability, 21.4);

    t.equal('21.4 is inside the score-2 band it was being destroyed for being in',
        21.4 > 18 && 21.4 <= 24, true);
});
