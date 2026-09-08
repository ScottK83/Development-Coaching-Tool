'use strict';

/**
 * The other half of the chokepoint guards: the accesses they cannot see.
 *
 * read-chokepoint.test.js and write-chokepoint.test.js both look for exactly
 * one spelling:
 *
 *     localStorage.getItem(STORAGE_PREFIX + 'name')
 *     localStorage.setItem(prefix + 'name', ...)
 *
 * That regex has two blind spots, and both of them were occupied.
 *
 *   1. A differently-named prefix variable. employee-list.module.js took its
 *      prefix as an option and called it `storagePrefix`, so
 *      `storagePrefix + 'employeePreferredNames'` matched neither alternative
 *      and three raw accesses to a bulk store sat in plain sight.
 *
 *   2. A precomputed constant. script.js declared
 *      `const YEAR_END_DRAFT_STORAGE_KEY = STORAGE_PREFIX + 'yearEndDraftEntries'`
 *      and then passed that constant to getItem/setItem. The prefix and the
 *      store name are never adjacent to the call, so nothing matched.
 *      yearEndAnnualGoals and yoyBaseline2025 were the same shape.
 *
 * All four are `tier: 'data', backend: 'idb'` in the store registry, so the
 * cost was the one write-chokepoint.test.js already describes and then some:
 * the write never marks the store dirty, so it never reaches the other
 * machine; and once the store has been copied to IndexedDB,
 * reclaimLocalStorageCopies deletes the localStorage copy it believes is
 * redundant, at which point the raw read returns nothing and the year-end
 * review drafts, the annual goals and the 2025 baseline are gone.
 *
 * So this file resolves the key rather than matching on how it is spelled.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

// Bulk stores, from the registry, which store-registry.test.js already pins
// against the fallback list in constants.
function bulkNames() {
    const src = fs.readFileSync(path.join(ROOT, 'modules/store-registry.module.js'), 'utf8');
    const names = [];
    const re = /\{\s*name:\s*'([a-zA-Z0-9_]+)'\s*,\s*tier:\s*'([a-z]+)'\s*,\s*backend:\s*'([a-z]+)'/g;
    let m;
    while ((m = re.exec(src)) !== null) if (m[3] === 'idb') names.push(m[1]);
    return names;
}

function sourceFiles() {
    const files = [path.join(ROOT, 'script.js')];
    fs.readdirSync(path.join(ROOT, 'modules'))
        .filter((f) => f.endsWith('.module.js'))
        .forEach((f) => files.push(path.join(ROOT, 'modules', f)));
    return files;
}

// Anything whose name ends in "prefix", any case: STORAGE_PREFIX, prefix,
// storagePrefix, and whatever the next one gets called.
const PREFIXISH = "(?:[A-Za-z0-9_$]*(?:PREFIX|Prefix|prefix))";

function indirectRawAccesses(bulk) {
    const bulkSet = new Set(bulk);
    const hits = [];

    sourceFiles().forEach((file) => {
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
        const lines = src.split('\n');

        // Identifiers that hold a namespaced store key.
        const alias = {};
        const aliasRe = new RegExp(
            "(?:const|let|var)\\s+([A-Za-z0-9_$]+)\\s*=\\s*" + PREFIXISH + "\\s*\\+\\s*'([a-zA-Z0-9_]+)'", 'g');
        let am;
        while ((am = aliasRe.exec(src)) !== null) alias[am[1]] = am[2];

        // An identifier also assigned from localStorage.key(i) is a loop
        // variable that happens to share a name, not a key alias. Dropping it
        // is what keeps the whole-store sweeps (collectAllStoresVerbatim,
        // measureLocalStorageUsage, delete-all) from reading as offenders.
        Object.keys(alias).forEach((name) => {
            if (new RegExp('\\b' + name + '\\s*=\\s*localStorage\\.key\\(').test(src)) delete alias[name];
        });

        const accessRe = /localStorage\.(getItem|setItem|removeItem)\(\s*([^),]+?)\s*[,)]/g;
        let m;
        while ((m = accessRe.exec(src)) !== null) {
            const op = m[1];
            const arg = m[2].trim();

            let key = null;
            let spelling = null;
            const inline = arg.match(new RegExp("^" + PREFIXISH + "\\s*\\+\\s*'([a-zA-Z0-9_]+)'$"));
            if (inline) { key = inline[1]; spelling = 'inline'; }
            else if (alias[arg]) { key = alias[arg]; spelling = 'via ' + arg; }
            else {
                const hard = arg.match(/^'devCoachingTool_([a-zA-Z0-9_]+)'$/);
                if (hard) { key = hard[1]; spelling = 'hardcoded prefix'; }
            }
            if (!key || !bulkSet.has(key)) continue;

            const line = src.slice(0, m.index).split('\n').length;
            // A raw access preceded by an attempt on the storage module is the
            // legitimate "module is not loaded yet" fallback, which is the same
            // allowance read-chokepoint.test.js makes. `lines` is zero-based
            // and `line` is one-based, so this is the eight lines above plus
            // the line itself: enough to span a `var save = …; if (save) { …
            // return; }` guard, which is the shape the real fallbacks take.
            const preceding = lines.slice(Math.max(0, line - 9), line).join('\n');
            const triesModuleFirst =
                /DevCoachModules\??\.?\s*\.?storage|storage\?\.(?:readStore|saveWithSizeCheck)|\breadStore\b|\bsaveWithSizeCheck\b|_storage\(\)/.test(preceding);

            hits.push({ file: rel, line, op, key, spelling, triesModuleFirst, text: lines[line - 1].trim() });
        }
    });

    return hits;
}

suite('chokepoint: a bulk store is not reached through an alias or a renamed prefix', (t) => {
    const bulk = bulkNames();
    t.check('the registry still declares bulk stores to check', bulk.length > 30);

    const offenders = indirectRawAccesses(bulk).filter((hit) => !hit.triesModuleFirst);

    offenders.forEach((hit) => {
        t.check(
            `${hit.file}:${hit.line} reaches ${hit.key} with a raw ${hit.op} [${hit.spelling}]\n      ${hit.text}`,
            false
        );
    });

    t.equal('no bulk store is reached around the storage module', offenders.length, 0);
});

suite('chokepoint: the indirect detector actually detects', (t) => {
    // A guard that silently matches nothing is worse than no guard, and this
    // one is all regex. So it is pointed at strings of each shape it exists to
    // catch, and has to find every one of them.
    const bulk = bulkNames();
    t.check('weeklyData is a bulk store', bulk.indexOf('weeklyData') > -1);
    t.check('yearEndDraftEntries is a bulk store', bulk.indexOf('yearEndDraftEntries') > -1);
    t.check('employeePreferredNames is a bulk store', bulk.indexOf('employeePreferredNames') > -1);
    t.check('yoyBaseline2025 is a bulk store', bulk.indexOf('yoyBaseline2025') > -1);

    const PREFIXISH_RE = (body) => new RegExp("^" + PREFIXISH + "\\s*\\+\\s*'" + body + "'$");
    t.check('it sees STORAGE_PREFIX', PREFIXISH_RE('weeklyData').test("STORAGE_PREFIX + 'weeklyData'"));
    t.check('it sees a bare prefix', PREFIXISH_RE('weeklyData').test("prefix + 'weeklyData'"));
    t.check('it sees storagePrefix, which is what slipped through',
        PREFIXISH_RE('weeklyData').test("storagePrefix + 'weeklyData'"));

    const aliasRe = new RegExp(
        "(?:const|let|var)\\s+([A-Za-z0-9_$]+)\\s*=\\s*" + PREFIXISH + "\\s*\\+\\s*'([a-zA-Z0-9_]+)'");
    const found = aliasRe.exec("const YEAR_END_DRAFT_STORAGE_KEY = STORAGE_PREFIX + 'yearEndDraftEntries';");
    t.check('it resolves a precomputed constant', !!found);
    t.equal('to the right identifier', found && found[1], 'YEAR_END_DRAFT_STORAGE_KEY');
    t.equal('and the right store', found && found[2], 'yearEndDraftEntries');
});
