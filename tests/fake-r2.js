'use strict';

/**
 * An in-memory R2 bucket binding, faithful on the points the v2 design rests on:
 *
 *   - put() with onlyIf.etagMatches RESOLVES TO NULL when the precondition
 *     fails. It does not throw. The whole compare-and-swap depends on that,
 *     and a fake that threw would hide the bug rather than catch it.
 *   - etag changes on every write, so a stale etag really is stale.
 *   - head() returns metadata without a body, and null for a missing key.
 *   - get() returns null for a missing key.
 */

let etagCounter = 0;

function makeObject(key, value) {
    etagCounter += 1;
    return { key, value: String(value), etag: `etag-${etagCounter}`, uploaded: new Date('2026-08-31T12:00:00Z') };
}

function createFakeR2() {
    const objects = new Map();

    return {
        _objects: objects,

        async head(key) {
            const o = objects.get(key);
            return o ? { key, etag: o.etag, size: o.value.length, uploaded: o.uploaded } : null;
        },

        async get(key) {
            const o = objects.get(key);
            if (!o) return null;
            return {
                key,
                etag: o.etag,
                size: o.value.length,
                body: o.value,
                uploaded: o.uploaded,
                json: async () => JSON.parse(o.value),
                text: async () => o.value
            };
        },

        async put(key, value, options) {
            const condition = options && options.onlyIf;
            if (condition && typeof condition.etagMatches === 'string') {
                const existing = objects.get(key);
                // Missing key, or a different etag: precondition fails.
                if (!existing || existing.etag !== condition.etagMatches) return null;
            }
            const created = makeObject(key, value);
            objects.set(key, created);
            return { key, etag: created.etag, size: created.value.length };
        },

        async delete(key) {
            objects.delete(key);
        },

        async list(options) {
            const prefix = (options && options.prefix) || '';
            const limit = (options && options.limit) || 1000;
            const all = Array.from(objects.entries())
                .filter(([k]) => k.startsWith(prefix))
                .map(([k, o]) => ({ key: k, size: o.value.length, uploaded: o.uploaded }));
            return { objects: all.slice(0, limit), truncated: all.length > limit };
        }
    };
}

/** Loads the worker's default export without a bundler. */
function loadWorker(ROOT, path, fs) {
    const src = fs.readFileSync(path.join(ROOT, 'cloudflare-sync-worker/index.js'), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace('export default', 'const __worker =') + '\nreturn __worker;';
    return new Function(src)();
}

/** A POST the worker will accept: right origin, right method, JSON body. */
function post(body, origin = 'https://development-coaching-tool.pages.dev') {
    return {
        method: 'POST',
        url: 'https://sync.example.workers.dev/',
        headers: {
            get: (name) => (String(name).toLowerCase() === 'origin' ? origin : null)
        },
        json: async () => body
    };
}

module.exports = { createFakeR2, loadWorker, post };
