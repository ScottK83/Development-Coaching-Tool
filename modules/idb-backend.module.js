/* ========================================
   INDEXEDDB BACKEND MODULE
   The backing store for the bulk data, behind the storage module.

   localStorage is capped at roughly 5MB per origin by every major browser, and
   it bills in UTF-16, so a character costs two bytes. A year of this app's
   weekly data is about 7.2MB by that measure before any other store is counted,
   which is why a full year cannot fit no matter how it is tuned. IndexedDB is
   quota-managed against available disk instead, in the hundreds of MB.

   Nothing here is called from a render path. The storage module hydrates from
   this once at boot into a synchronous in-memory cache, then writes through
   asynchronously, so the roughly sixty synchronous callers across the app keep
   working unchanged.
   ======================================== */

(function () {
    'use strict';

    const C = window.DevCoachConstants || {};
    const DB_NAME = C.IDB_DB_NAME || 'devCoachingTool';
    const DB_VERSION = C.IDB_VERSION || 1;
    const BULK_STORE = C.IDB_BULK_STORE || 'bulk';
    const ARCHIVE_STORE = C.IDB_ARCHIVE_STORE || 'archive';
    const OPEN_TIMEOUT_MS = C.IDB_OPEN_TIMEOUT_MS || 4000;

    let db = null;
    let openPromise = null;
    let available = false;

    // Every write in flight, so flush() can wait for them. A page being closed
    // will not hold itself open for a pending transaction, so this is a best
    // effort on unload and a real guarantee everywhere else.
    const inFlight = new Set();

    function track(promise) {
        inFlight.add(promise);
        const done = () => inFlight.delete(promise);
        promise.then(done, done);
        return promise;
    }

    function requestToPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
        });
    }

    /**
     * Resolves true when the database is usable, false when it is not. Never
     * rejects: a caller that cannot tell the difference between "no IndexedDB"
     * and "IndexedDB threw" would have to guess whether to fall back, and the
     * fallback (stay on localStorage) is correct for both.
     */
    function open() {
        if (openPromise) return openPromise;

        openPromise = new Promise((resolve) => {
            let settled = false;
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                available = ok;
                resolve(ok);
            };

            if (!window.indexedDB) {
                console.warn('[idb] IndexedDB is unavailable; staying on localStorage.');
                finish(false);
                return;
            }

            // A second tab holding a versionchange, or a locked profile, can
            // leave this request pending indefinitely. Boot cannot wait on that.
            const timer = setTimeout(() => {
                console.warn(`[idb] open() did not resolve within ${OPEN_TIMEOUT_MS}ms; staying on localStorage.`);
                finish(false);
            }, OPEN_TIMEOUT_MS);

            let request;
            try {
                request = window.indexedDB.open(DB_NAME, DB_VERSION);
            } catch (error) {
                clearTimeout(timer);
                console.warn('[idb] open() threw; staying on localStorage:', error);
                finish(false);
                return;
            }

            request.onupgradeneeded = (event) => {
                const upgraded = event.target.result;
                if (!upgraded.objectStoreNames.contains(BULK_STORE)) {
                    upgraded.createObjectStore(BULK_STORE);
                }
                if (!upgraded.objectStoreNames.contains(ARCHIVE_STORE)) {
                    upgraded.createObjectStore(ARCHIVE_STORE);
                }
            };

            request.onblocked = () => {
                console.warn('[idb] open() is blocked by another tab of this app.');
            };

            request.onsuccess = () => {
                clearTimeout(timer);
                db = request.result;
                // Another tab upgrading needs this connection closed or its
                // open() blocks forever. Dropping to localStorage is the right
                // outcome for this tab: the other one has the newer schema.
                db.onversionchange = () => {
                    console.warn('[idb] another tab requested a version change; closing this connection.');
                    try { db.close(); } catch (_e) { /* already closing */ }
                    db = null;
                    available = false;
                };
                finish(true);
            };

            request.onerror = () => {
                clearTimeout(timer);
                console.warn('[idb] open() failed; staying on localStorage:', request.error);
                finish(false);
            };
        });

        return openPromise;
    }

    function isAvailable() {
        return available && !!db;
    }

    function withStore(storeName, mode, fn) {
        if (!isAvailable()) return Promise.reject(new Error('IndexedDB is not available'));
        return new Promise((resolve, reject) => {
            let tx;
            try {
                tx = db.transaction(storeName, mode);
            } catch (error) {
                reject(error);
                return;
            }
            let result;
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
            tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
            try {
                result = fn(tx.objectStore(storeName));
            } catch (error) {
                try { tx.abort(); } catch (_e) { /* already aborting */ }
                reject(error);
            }
        });
    }

    /**
     * Values are stored as live structured clones rather than JSON strings.
     * That skips a serialize/parse on every read and write, and it is why the
     * 5MB text ceiling stops applying. The tradeoff is real: a store is no
     * longer readable by eye in devtools the way a localStorage row is.
     */
    function put(key, value) {
        return track(withStore(BULK_STORE, 'readwrite', (store) => {
            store.put(value, key);
        }));
    }

    function get(key) {
        let out;
        return withStore(BULK_STORE, 'readonly', (store) => {
            requestToPromise(store.get(key)).then((v) => { out = v; });
            return undefined;
        }).then(() => out);
    }

    /** One transaction for the whole hydrate, rather than one per key. */
    function getAll() {
        const out = {};
        return withStore(BULK_STORE, 'readonly', (store) => {
            const request = store.openCursor();
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) return;
                out[cursor.key] = cursor.value;
                cursor.continue();
            };
            return out;
        }).then(() => out);
    }

    function remove(key) {
        return track(withStore(BULK_STORE, 'readwrite', (store) => {
            store.delete(key);
        }));
    }

    /** Used by delete-all, which must clear this backend before localStorage. */
    function clear() {
        return track(Promise.all([
            withStore(BULK_STORE, 'readwrite', (store) => { store.clear(); }),
            withStore(ARCHIVE_STORE, 'readwrite', (store) => { store.clear(); })
        ]));
    }

    function archivePut(storeKey, year, value) {
        return track(withStore(ARCHIVE_STORE, 'readwrite', (store) => {
            store.put(value, `${storeKey}::${year}`);
        }));
    }

    function archiveGet(storeKey, year) {
        let out;
        return withStore(ARCHIVE_STORE, 'readonly', (store) => {
            requestToPromise(store.get(`${storeKey}::${year}`)).then((v) => { out = v; });
            return undefined;
        }).then(() => out);
    }

    function archiveKeys() {
        let out = [];
        return withStore(ARCHIVE_STORE, 'readonly', (store) => {
            requestToPromise(store.getAllKeys()).then((keys) => { out = keys || []; });
            return undefined;
        }).then(() => out);
    }

    /** Settles when every write started so far has finished or failed. */
    function flush() {
        return Promise.allSettled(Array.from(inFlight));
    }

    function pendingWriteCount() {
        return inFlight.size;
    }

    // Test seam. Nothing in the app calls this.
    function _reset() {
        try { if (db) db.close(); } catch (_e) { /* already closed */ }
        db = null;
        openPromise = null;
        available = false;
        inFlight.clear();
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.idbBackend = {
        open,
        isAvailable,
        get,
        getAll,
        put,
        remove,
        clear,
        archivePut,
        archiveGet,
        archiveKeys,
        flush,
        pendingWriteCount,
        _reset,
        DB_NAME,
        BULK_STORE,
        ARCHIVE_STORE
    };
})();
