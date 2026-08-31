'use strict';

/**
 * A small in-memory IndexedDB good enough for the parts this app uses:
 * open/upgrade, readonly and readwrite transactions, put/get/delete/clear,
 * openCursor and getAllKeys.
 *
 * It reproduces the two timing properties the real thing has that a naive
 * synchronous fake does not, and that the backend module depends on:
 *
 *   1. Request callbacks fire asynchronously, after the transaction callback
 *      has returned, so handlers assigned right after the call still run.
 *   2. A transaction completes only once every request in it has settled,
 *      including ones started later by cursor.continue().
 *
 * Values are stored by reference the way structured clones behave for our
 * purposes; tests that care about aliasing should clone before asserting.
 */

// Captured at require time, before any suite runs. Suites are free to stub
// global.setTimeout for their own purposes; this fake must keep working
// regardless of what ran before it.
const realSetTimeout = global.setTimeout;

function later(fn) { realSetTimeout(fn, 0); }

function makeTransaction(dbData, storeNames, mode, onFail) {
    const tx = {
        mode,
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        _pending: 0,
        _done: false,
        _aborted: false
    };

    function settle() {
        tx._pending -= 1;
        if (tx._pending > 0) return;
        // Give a cursor's continue() a turn to queue more work before calling
        // the transaction finished.
        later(() => {
            if (tx._pending !== 0 || tx._done || tx._aborted) return;
            tx._done = true;
            if (tx.oncomplete) tx.oncomplete();
        });
    }

    function request(work) {
        const req = { onsuccess: null, onerror: null, result: undefined, error: null };
        tx._pending += 1;
        later(() => {
            if (tx._aborted) { settle(); return; }
            try {
                req.result = work(req);
                if (req.onsuccess) req.onsuccess({ target: req });
            } catch (error) {
                req.error = error;
                tx.error = error;
                if (req.onerror) req.onerror({ target: req });
                else onFail(tx, error);
            }
            settle();
        });
        return req;
    }

    tx.abort = () => {
        if (tx._done || tx._aborted) return;
        tx._aborted = true;
        later(() => { if (tx.onabort) tx.onabort(); });
    };

    tx.objectStore = (name) => {
        if (!storeNames.includes(name)) throw new Error(`NotFoundError: ${name} not in transaction`);
        const data = dbData[name];

        return {
            put(value, key) {
                if (mode !== 'readwrite') throw new Error('ReadOnlyError');
                return request(() => { data.set(key, value); return key; });
            },
            get(key) { return request(() => data.get(key)); },
            delete(key) {
                if (mode !== 'readwrite') throw new Error('ReadOnlyError');
                return request(() => { data.delete(key); });
            },
            clear() {
                if (mode !== 'readwrite') throw new Error('ReadOnlyError');
                return request(() => { data.clear(); });
            },
            getAllKeys() { return request(() => Array.from(data.keys())); },
            openCursor() {
                const entries = Array.from(data.entries());
                let index = 0;
                const req = { onsuccess: null, onerror: null, result: null };

                const step = () => {
                    tx._pending += 1;
                    later(() => {
                        if (tx._aborted) { settle(); return; }
                        if (index >= entries.length) {
                            req.result = null;
                        } else {
                            const [key, value] = entries[index];
                            index += 1;
                            req.result = { key, value, continue: step };
                        }
                        if (req.onsuccess) req.onsuccess({ target: req });
                        settle();
                    });
                };

                step();
                return req;
            }
        };
    };

    return tx;
}

function createFakeIndexedDB() {
    const databases = new Map();

    return {
        _databases: databases,
        open(name, version) {
            const req = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: null, error: null };

            later(() => {
                let entry = databases.get(name);
                const isNew = !entry;
                if (isNew) {
                    entry = { version: 0, stores: {}, data: {} };
                    databases.set(name, entry);
                }

                const db = {
                    name,
                    version: entry.version,
                    onversionchange: null,
                    objectStoreNames: {
                        contains: (s) => Object.prototype.hasOwnProperty.call(entry.stores, s)
                    },
                    createObjectStore(storeName) {
                        entry.stores[storeName] = true;
                        entry.data[storeName] = entry.data[storeName] || new Map();
                        return {};
                    },
                    transaction(storeName, mode) {
                        const names = Array.isArray(storeName) ? storeName : [storeName];
                        names.forEach((n) => {
                            if (!entry.stores[n]) throw new Error(`NotFoundError: no store ${n}`);
                        });
                        return makeTransaction(entry.data, names, mode || 'readonly', () => {});
                    },
                    close() { db._closed = true; },
                    _closed: false
                };

                req.result = db;

                if (version > entry.version) {
                    entry.version = version;
                    db.version = version;
                    if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: db } });
                }

                if (req.onsuccess) req.onsuccess({ target: req });
            });

            return req;
        }
    };
}

/** An indexedDB whose open() never settles, like a profile held by another tab. */
function createHangingIndexedDB() {
    return { open() { return { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }; } };
}

/** An indexedDB whose open() fails, like a browser with storage disabled. */
function createFailingIndexedDB() {
    return {
        open() {
            const req = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, error: new Error('denied') };
            later(() => { if (req.onerror) req.onerror({ target: req }); });
            return req;
        }
    };
}

module.exports = { createFakeIndexedDB, createHangingIndexedDB, createFailingIndexedDB };
