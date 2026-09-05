/* ========================================
   STORAGE MODULE
   Centralized data persistence layer
   ======================================== */

(function() {
    'use strict';

    // ============================================
    // CONSTANTS
    // ============================================
    const STORAGE_PREFIX = window.DevCoachConstants?.STORAGE_PREFIX || 'devCoachingTool_';
    const HYDRATE_TIMEOUT_MS = window.DevCoachConstants?.HYDRATE_TIMEOUT_MS || 8000;
    const SENTIMENT_PHRASE_DB_STORAGE_KEY = window.DevCoachConstants?.SENTIMENT_PHRASE_DB_STORAGE_KEY || 'sentimentPhraseDatabase';
    const ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY = window.DevCoachConstants?.ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY || 'associateSentimentSnapshots';
    const LOCALSTORAGE_MAX_SIZE_MB = window.DevCoachConstants?.LOCALSTORAGE_MAX_SIZE_MB || 4;

    const BULK_KEYS = new Set(window.DevCoachConstants?.BULK_STORAGE_KEYS || []);
    const IDB_MIGRATED_MARKER = 'idbMigrated_v1';

    // ============================================
    // BACKEND
    // ============================================
    // Two backends behind one synchronous API.
    //
    // 'localStorage' is what shipped for years and is still the fallback for
    // every browser or profile where IndexedDB will not open. 'idb' keeps the
    // bulk stores in IndexedDB, which is quota-managed against disk instead of
    // capped near 5MB, and holds them in bulkCache so reads stay synchronous.
    //
    // The synchronous read is the whole point. Roughly sixty call sites across
    // twenty-one modules read these stores from inside render paths and event
    // handlers that cannot await, and script.js reads three of them at parse
    // time. Hydrating once at boot means none of them change.
    let backendMode = 'localStorage';
    let bulkCache = {};

    function getBackendMode() {
        return backendMode;
    }

    /**
     * The parsed value of a store, or undefined when it has never been written.
     *
     * In idb mode this hands back the cached object BY REFERENCE rather than a
     * fresh parse. That is deliberate: callers already treat the result as the
     * live store (they mutate what load* returned and pass it back to save*),
     * and copying a 127-row period on every read would undo the reason for
     * caching at all. A caller that needs an independent copy must clone.
     */
    function readStore(key) {
        if (backendMode === 'idb' && BULK_KEYS.has(key)) {
            return bulkCache[key];
        }
        const raw = localStorage.getItem(STORAGE_PREFIX + key);
        if (raw === null || raw === undefined) return undefined;
        // A parse failure propagates to the caller's catch, which is where the
        // decision about what an unreadable store means already lives.
        return JSON.parse(raw);
    }

    /**
     * True when this store's writes go to the backend rather than localStorage.
     * Every bulk saver already funnels through saveWithSizeCheck, so routing
     * there covers all of them without touching each one.
     */
    function isBackedByIdb(key) {
        return backendMode === 'idb' && BULK_KEYS.has(key);
    }

    /**
     * Updates the cache synchronously so the very next read sees the new value,
     * then starts the durable write without awaiting it. A rejected write logs;
     * it cannot be reported to a synchronous caller, which is the honest cost
     * of keeping every existing call site unchanged.
     */
    // Stores written since this page loaded. A flush-everything handler that
    // cannot tell "changed" from "unchanged" re-pushes the whole local state on
    // every alt-tab, so a machine that merely had the tab open overwrites what
    // the other machine wrote. That is the widest lost-update path in the app.
    const dirtyStores = new Set();
    const storeChangeListeners = [];

    /**
     * Called for every store write, from inside the module.
     *
     * Deliberately here rather than in a wrapper around the exported
     * saveWithSizeCheck: the module's own save* functions call the local
     * closure directly, so a wrapper on the export only ever sees writes from
     * other files. Half the writes would be invisible, silently, which is the
     * same class of failure as writing around the module in the first place.
     */
    function onStoreChanged(listener) {
        if (typeof listener === 'function') storeChangeListeners.push(listener);
    }

    function markStoreDirty(key) {
        dirtyStores.add(key);
        storeChangeListeners.forEach((listener) => {
            try {
                listener(key);
            } catch (error) {
                console.error('[storage] A store-change listener threw:', error);
            }
        });
    }

    function isStoreDirty(key) {
        return dirtyStores.has(key);
    }

    function clearDirtyStores() {
        dirtyStores.clear();
    }

    function writeThroughToBackend(key, value) {
        const backend = window.DevCoachModules?.idbBackend;
        if (!backend) return false;
        bulkCache[key] = value;
        backend.put(key, value).catch((error) => {
            console.error(`[storage] Durable write failed for ${key}; the value is in memory only:`, error);
        });
        // Repo sync's only auto trigger is a patch on Storage.prototype.setItem,
        // which this write deliberately never touches. Without this call the
        // GitHub backup silently stops updating for the bulk stores.
        window.DevCoachModules?.repoSync?.notifyBulkStoreWrite?.(key);
        return true;
    }

    /**
     * Called once, before script.js runs. Resolves when the bulk stores are
     * readable synchronously, whichever backend is serving them.
     *
     * Nothing is deleted here. Both copies exist after this runs, so rolling
     * the deploy back costs nothing. Reclaiming the localStorage space is a
     * separate, explicit step.
     */
    // Set once the deadline below has given up. A hydrate that finishes after
    // that point must not retarget the app at the backend: boot has already read
    // through localStorage and the two copies can have diverged since.
    let hydrateAbandoned = false;

    /**
     * Bounds hydrate so it always settles.
     *
     * open() holds the only timeout in the backend. getAll() and put() hold
     * none, and this awaits getAll four times, so one stalled IndexedDB
     * transaction hung it forever. index.html does not create the script.js tag
     * until hydrate resolves and its catch only fires on a rejection, so the
     * result was an app that never booted and never said why -- a blank page,
     * indefinitely.
     *
     * A timeout is not a new failure mode. Every error this function already
     * knows about ends the same way, on localStorage, and that is what a stall
     * now does too.
     */
    async function hydrate() {
        let timer = null;
        const deadline = new Promise((resolve) => {
            timer = setTimeout(() => {
                hydrateAbandoned = true;
                backendMode = 'localStorage';
                console.error(`[storage] The storage backend did not respond within ${HYDRATE_TIMEOUT_MS}ms; continuing on localStorage.`);
                resolve('localStorage');
            }, HYDRATE_TIMEOUT_MS);
        });

        try {
            return await Promise.race([hydrateUsingBackend(), deadline]);
        } finally {
            clearTimeout(timer);
        }
    }

    async function hydrateUsingBackend() {
        const backend = window.DevCoachModules?.idbBackend;
        if (!backend) {
            console.warn('[storage] idb backend module is absent; staying on localStorage.');
            return 'localStorage';
        }

        const opened = await backend.open();
        if (!opened) {
            // open() already said why. Every load*/save* behaves exactly as it
            // did before, and the user notices nothing.
            return 'localStorage';
        }

        try {
            const marked = localStorage.getItem(STORAGE_PREFIX + IDB_MIGRATED_MARKER) === '1';

            // The backend holding data is the authority, not the marker. The
            // marker lives in localStorage and can be cleared on its own, by a
            // browser wiping site data selectively or by a failed write, while
            // IndexedDB survives. Trusting it alone would recopy stale
            // localStorage over newer backend data and silently lose whatever
            // was written since the move.
            const existing = await backend.getAll();
            const backendHasData = Object.keys(existing).length > 0;

            let copied = false;
            if (!marked && !backendHasData) {
                copied = await copyBulkStoresIntoBackend(backend);
                if (!copied) {
                    console.warn('[storage] Copy into IndexedDB could not be verified; staying on localStorage.');
                    return 'localStorage';
                }
                console.log('[storage] Bulk stores copied to IndexedDB and verified. localStorage copies left in place.');
            } else if (!marked) {
                console.warn('[storage] The migration marker is missing but the backend already holds data. Keeping the backend copy; localStorage is the stale one.');
            }

            try {
                localStorage.setItem(STORAGE_PREFIX + IDB_MIGRATED_MARKER, '1');
            } catch (error) {
                // A full origin can refuse even this one byte. Harmless: the
                // backendHasData check above is what actually prevents a recopy.
                console.warn('[storage] Could not write the migration marker:', error?.name || error);
            }

            // A store promoted to the backend in a later release is absent from
            // IndexedDB but present in localStorage, and the checks above have
            // already decided the migration ran. Without this it would keep
            // reading from a cache that has never held it, and look empty.
            const backfilled = await backfillNewBulkStores(backend, existing);

            // Reuses the read above when nothing was written since. Two full
            // getAll() calls meant loading every bulk store twice before a
            // single line of the app ran, which is dead time on every boot.
            const cache = (copied || backfilled.length) ? await backend.getAll() : existing;
            // The deadline may have fired while those reads were outstanding.
            // Boot has already gone ahead on localStorage by then, so switching
            // now would point live reads at a cache the running app never agreed
            // to use.
            if (hydrateAbandoned) return 'localStorage';
            bulkCache = cache;
            backendMode = 'idb';
            return 'idb';
        } catch (error) {
            console.error('[storage] Hydrate failed; staying on localStorage:', error);
            backendMode = 'localStorage';
            return 'localStorage';
        }
    }

    /**
     * Copies each bulk store from localStorage into the backend and reads every
     * one back to confirm it landed. All or nothing: a partially populated
     * backend is worse than none, because hasMeaningfulLocalData would then see
     * a half-empty store and could trigger a repo restore over live data.
     */
    /**
     * Copies across any bulk store the backend does not have yet.
     *
     * Per store rather than all-or-nothing, unlike the first migration: the
     * backend already holds the rest, so refusing everything because one new
     * store will not parse would be worse than moving the ones that will.
     * Nothing is deleted, so a store that fails simply stays where it is.
     */
    async function backfillNewBulkStores(backend, existing) {
        const missing = [];
        for (const key of BULK_KEYS) {
            if (key in existing) continue;
            const raw = localStorage.getItem(STORAGE_PREFIX + key);
            if (raw === null) continue;
            try {
                await backend.put(key, JSON.parse(raw));
                missing.push(key);
            } catch (error) {
                console.error(`[storage] Could not move ${key} to the backend; it stays in localStorage.`, error);
            }
        }
        if (missing.length) {
            console.log(`[storage] Moved ${missing.length} newly promoted store(s) to IndexedDB: ${missing.join(', ')}`);
        }
        return missing;
    }

    async function copyBulkStoresIntoBackend(backend) {
        const expected = {};

        for (const key of BULK_KEYS) {
            const raw = localStorage.getItem(STORAGE_PREFIX + key);
            if (raw === null) continue;
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (error) {
                console.error(`[storage] ${key} is not readable JSON; refusing to migrate.`, error);
                return false;
            }
            expected[key] = countEntries(parsed);
            await backend.put(key, parsed);
        }

        const readBack = await backend.getAll();
        const mismatches = Object.keys(expected).filter(
            (key) => countEntries(readBack[key]) !== expected[key]
        );

        if (mismatches.length) {
            console.error('[storage] Verification failed for:', mismatches.join(', '));
            return false;
        }
        return true;
    }

    /**
     * Deletes the localStorage copy of every bulk store that the backend is
     * verifiably already holding, and reports what it freed.
     *
     * This is the step that actually gives the space back. It is separate from
     * hydrate() on purpose: until it runs, both copies exist and rolling the
     * deploy back costs nothing.
     *
     * A store is only deleted when the backend holds it with the SAME number of
     * entries. Anything that does not match is left alone and named in the
     * report. Deleting on a read that quietly returned empty is the one way
     * this loses data, so an unverifiable store keeps its localStorage copy.
     */
    async function reclaimLocalStorageCopies() {
        const report = { freedBytes: 0, reclaimed: [], skipped: [] };

        if (backendMode !== 'idb') {
            report.skipped.push('the backend is localStorage, so there is nothing to reclaim');
            return report;
        }

        const backend = window.DevCoachModules?.idbBackend;
        if (!backend?.isAvailable?.()) {
            report.skipped.push('the backend is unavailable');
            return report;
        }

        // Read straight from the backend rather than trusting the cache, so a
        // stale or half-built cache cannot authorize a delete.
        const stored = await backend.getAll();

        for (const key of BULK_KEYS) {
            const namespacedKey = STORAGE_PREFIX + key;
            const raw = localStorage.getItem(namespacedKey);
            if (raw === null) continue;

            let localCount;
            try {
                localCount = countEntries(JSON.parse(raw));
            } catch (error) {
                report.skipped.push(`${key}: the localStorage copy is unreadable, keeping it`);
                continue;
            }

            const backendCount = countEntries(stored[key]);

            // The backend must hold AT LEAST what the stale copy holds, not
            // exactly what it holds.
            //
            // Requiring equality looked safer and was actually a permanent
            // block: the localStorage copies froze at the moment of migration,
            // every write since has gone to the backend alone, so the counts
            // diverge immediately and never converge again. Nothing would ever
            // be reclaimed, which is how the space stayed occupied.
            //
            // Fewer entries in the backend is the case worth refusing: it means
            // the read came back partial or empty, and deleting against that is
            // exactly the loss this guard exists for.
            if (backendCount < localCount) {
                report.skipped.push(`${key}: the backend has ${backendCount} entries but localStorage has ${localCount}, so the copy is kept`);
                continue;
            }

            report.freedBytes += (namespacedKey.length + raw.length) * 2;
            localStorage.removeItem(namespacedKey);
            report.reclaimed.push(key);
        }

        return report;
    }

    function countEntries(value) {
        if (value === null || value === undefined) return -1;
        if (Array.isArray(value)) return value.length;
        if (typeof value === 'object') return Object.keys(value).length;
        return 0;
    }

    // ============================================
    // STORAGE HELPERS
    // ============================================

    function saveWithSizeCheck(key, data) {
        markStoreDirty(key);

        // A bulk store on the backend is not subject to the localStorage size
        // cap at all. Escaping that cap is the entire point of moving it.
        if (isBackedByIdb(key)) {
            return writeThroughToBackend(key, data ?? {});
        }

        try {
            const serialized = JSON.stringify(data ?? {});
            const sizeMB = new Blob([serialized]).size / (1024 * 1024);

            if (sizeMB > LOCALSTORAGE_MAX_SIZE_MB) {
                return false;
            }

            localStorage.setItem(STORAGE_PREFIX + key, serialized);
            return true;
        } catch (error) {
            if (error?.name === 'QuotaExceededError') {
                // Silence here is what turned a full disk into invisible data loss:
                // callers that ignore the return value re-rendered as if the write
                // landed. Always leave a trace, even for callers that discard it.
                console.error(`[storage] QUOTA EXCEEDED saving ${key}. The write did NOT happen; the stored value is unchanged and the in-memory copy is now ahead of it.`);
                return false;
            }
            console.error(`Error saving ${key}:`, error);
            return false;
        }
    }

    // A normalization pass must never be able to destroy the data it just read.
    // These write-backs are opportunistic: the caller already holds the correct
    // value in memory, so a failed write is a cache miss to retry next boot, not
    // a reason to fall into a loader's catch and hand back {}, which beforeunload
    // would then persist over the real store.
    function persistNormalizedInPlace(storeKey, value, label) {
        try {
            if (saveWithSizeCheck(storeKey, value)) return true;
            console.warn(`[storage] Could not write back normalized ${label}. Keeping the in-memory copy; the stored value is still intact.`);
            return false;
        } catch (error) {
            console.warn(`[storage] Could not write back normalized ${label}: ${error?.name || error}. Keeping the in-memory copy; the stored value is still intact.`);
            return false;
        }
    }

    // Delegates to data-parsing module (loaded after storage but before any
    // storage function is called at runtime). Keeps a single source for the
    // transfer-percentage normalization rule.
    function normalizeTransferPercentageValue(transfers, transfersCount, totalCalls) {
        const fn = window.DevCoachModules?.dataParsing?.normalizeTransfersPercentage;
        if (typeof fn === 'function') {
            return fn(transfers, transfersCount, totalCalls);
        }
        // Conservative fallback if data-parsing hasn't loaded (never in practice)
        const parsedTransfers = parseFloat(transfers);
        return Number.isFinite(parsedTransfers) ? parseFloat(parsedTransfers.toFixed(2)) : transfers;
    }

    function normalizeEmployeeMetricRow(employee) {
        if (!employee || typeof employee !== 'object') return employee;

        // A blank stays blank.
        //
        // findPhantomZeroMetrics deliberately blanks a column it has decided was
        // absent from the upload, and normalizeTransfersPercentage returns 0 for
        // any value it cannot parse -- so normalizing a just-blanked row put the
        // 0 straight back, the next pass recognised an all-zero column and
        // blanked it again, and the two never agreed on an answer.
        //
        // Every read therefore looked like a change: loadWeeklyData persisted the
        // whole store and marked it dirty, and a dirty store schedules a cloud
        // push. Reading data wrote it back, and filling one dropdown did that
        // hundreds of times. On a second machine that is the lost-update path the
        // rest of this module works hard to avoid -- a tab that only ever read
        // could still push over what another machine wrote.
        //
        // Nothing is lost by skipping it: normalizeTransfersPercentage bails to 0
        // on a non-numeric value before it ever looks at transfersCount, so a
        // blank was never going to be derived into a real percentage anyway.
        const storedTransfers = employee.transfers;
        if (storedTransfers === '' || storedTransfers === null || storedTransfers === undefined) {
            return employee;
        }

        const normalizedTransfers = normalizeTransferPercentageValue(
            employee.transfers,
            employee.transfersCount,
            employee.totalCalls
        );

        if (normalizedTransfers === employee.transfers) {
            return employee;
        }

        return {
            ...employee,
            transfers: normalizedTransfers
        };
    }

    // Metrics that older uploads stored as 0 when the column was simply
    // absent from the paste. A whole period reading exactly 0 for one of
    // these means "column missing", not "everyone was flawless" — nobody
    // posts a 0% transfer rate team-wide. Blank them so averages, deltas,
    // and cheers stop reporting an achievement that never happened.
    // Requires 3+ employees so a genuinely tiny period isn't wiped.
    const PHANTOM_ZERO_METRICS = ['transfers', 'scheduleAdherence', 'reliability'];
    const PHANTOM_ZERO_MIN_ROWS = 3;

    function findPhantomZeroMetrics(employees) {
        if (!Array.isArray(employees) || employees.length < PHANTOM_ZERO_MIN_ROWS) return [];
        return PHANTOM_ZERO_METRICS.filter(metricKey => employees.every(emp => {
            const raw = emp ? emp[metricKey] : undefined;
            if (raw === '' || raw === null || raw === undefined) return true;
            const num = parseFloat(raw);
            return Number.isFinite(num) && num === 0;
        }) && employees.some(emp => {
            const raw = emp ? emp[metricKey] : undefined;
            return raw !== '' && raw !== null && raw !== undefined;
        }));
    }

    function normalizePeriodEmployees(period) {
        if (!period || !Array.isArray(period.employees)) return period;

        let changed = false;
        let employees = period.employees.map(employee => {
            const normalized = normalizeEmployeeMetricRow(employee);
            if (normalized !== employee) changed = true;
            return normalized;
        });

        const phantom = findPhantomZeroMetrics(employees);
        if (phantom.length) {
            changed = true;
            employees = employees.map(emp => {
                const patched = { ...emp };
                phantom.forEach(metricKey => { patched[metricKey] = ''; });
                return patched;
            });
        }

        return changed ? { ...period, employees } : period;
    }

    function normalizeStoredDataSet(data) {
        if (!data || typeof data !== 'object') return {};

        let changed = false;
        const normalized = Object.fromEntries(Object.entries(data).map(([key, period]) => {
            const normalizedPeriod = normalizePeriodEmployees(period);
            if (normalizedPeriod !== period) changed = true;
            return [key, normalizedPeriod];
        }));

        return changed ? normalized : data;
    }

    // ============================================
    // WEEKLY DATA
    // ============================================

    function loadWeeklyData() {
        try {
            const saved = readStore('weeklyData');
            if (saved) {
                const normalizedData = normalizeStoredDataSet(saved && typeof saved === 'object' ? saved : {});
                if (normalizedData !== saved) {
                    persistNormalizedInPlace('weeklyData', normalizedData, 'weeklyData');
                }
                return normalizedData;
            }

            // Pre-namespace key from an old build. Always a localStorage read:
            // it predates the prefix, so it can never live in the backend.
            const legacySaved = localStorage.getItem('weeklyData');
            if (legacySaved) {
                const legacyData = JSON.parse(legacySaved);
                const normalizedData = normalizeStoredDataSet(legacyData && typeof legacyData === 'object' ? legacyData : {});
                persistNormalizedInPlace('weeklyData', normalizedData, 'weeklyData (legacy migration)');
                return normalizedData;
            }

            return {};
        } catch (error) {
            console.error('Error loading weekly data:', error);
            return {};
        }
    }

    // All save* functions return boolean: true on success, false on failure
    // (size cap exceeded, quota, JSON error, etc.). Callers can ignore the
    // return value if they don't care about the outcome.
    function saveWeeklyData(weeklyDataRef) {
        try {
            const ok = saveWithSizeCheck('weeklyData', weeklyDataRef);
            if (!ok) console.error('Failed to save weekly data due to size');
            return ok;
        } catch (error) {
            console.error('Error saving weekly data:', error);
            return false;
        }
    }

    // ============================================
    // DAILY DATA
    // ============================================
    // Separate store from weeklyData. Daily rows are ephemeral: they power
    // "yesterday" check-ins and partial-week displays, and are purged when a
    // weekly (or larger) upload covering the same date arrives. Kept in its
    // own localStorage key so it has its own 4MB budget and can't crowd out
    // the canonical weekly/YTD data.

    function loadDailyData() {
        try {
            const saved = readStore('dailyData');
            if (saved) {
                const normalizedData = normalizeStoredDataSet(saved && typeof saved === 'object' ? saved : {});
                if (normalizedData !== saved) {
                    persistNormalizedInPlace('dailyData', normalizedData, 'dailyData');
                }
                return normalizedData;
            }
            return {};
        } catch (error) {
            console.error('Error loading daily data:', error);
            return {};
        }
    }

    function saveDailyData(dailyDataRef) {
        try {
            const ok = saveWithSizeCheck('dailyData', dailyDataRef);
            if (!ok) console.error('Failed to save daily data due to size');
            return ok;
        } catch (error) {
            console.error('Error saving daily data:', error);
            return false;
        }
    }

    // ============================================
    // YTD DATA
    // ============================================

    function loadYtdData() {
        try {
            const saved = readStore('ytdData');
            if (saved) {
                const normalizedData = normalizeStoredDataSet(saved && typeof saved === 'object' ? saved : {});
                if (normalizedData !== saved) {
                    persistNormalizedInPlace('ytdData', normalizedData, 'ytdData');
                }
                return normalizedData;
            }
            return {};
        } catch (error) {
            console.error('Error loading YTD data:', error);
            return {};
        }
    }

    function saveYtdData(ytdDataRef) {
        try {
            const ok = saveWithSizeCheck('ytdData', ytdDataRef);
            if (!ok) console.error('Failed to save YTD data due to size');
            return ok;
        } catch (error) {
            console.error('Error saving YTD data:', error);
            return false;
        }
    }

    // ============================================
    // COACHING HISTORY
    // ============================================

    function loadCoachingHistory() {
        try {
            const data = readStore('coachingHistory') ?? {};
            return data;
        } catch (error) {
            console.error('Error loading coaching history:', error);
            return {};
        }
    }

    function saveCoachingHistory(coachingHistoryRef) {
        try {
            const ok = saveWithSizeCheck('coachingHistory', coachingHistoryRef);
            if (!ok) console.error('Failed to save coaching history due to size');
            return ok;
        } catch (error) {
            console.error('Error saving coaching history:', error);
            return false;
        }
    }

    function appendCoachingLogEntry(coachingHistoryRef, entry) {
        if (!entry?.employeeId) {
            console.warn('[storage] appendCoachingLogEntry: missing employeeId in entry');
            return;
        }
        const key = entry.employeeId;
        if (!coachingHistoryRef[key]) {
            coachingHistoryRef[key] = [];
        }
        coachingHistoryRef[key].push(entry);
        saveCoachingHistory(coachingHistoryRef);
    }

    function getCoachingHistoryForEmployee(coachingHistoryRef, employeeId) {
        return coachingHistoryRef[employeeId] || [];
    }

    // ============================================
    // SENTIMENT DATA
    // ============================================

    function loadSentimentPhraseDatabase() {
        try {
            return readStore(SENTIMENT_PHRASE_DB_STORAGE_KEY) ?? null;
        } catch (error) {
            console.error('Error loading sentiment phrase database:', error);
            return null;
        }
    }

    function saveSentimentPhraseDatabase(sentimentPhraseDatabaseRef) {
        try {
            const ok = saveWithSizeCheck(SENTIMENT_PHRASE_DB_STORAGE_KEY, sentimentPhraseDatabaseRef || {});
            if (!ok) console.error('Failed to save sentiment phrase database due to size');
            return ok;
        } catch (error) {
            console.error('Error saving sentiment phrase database:', error);
            return false;
        }
    }

    function loadAssociateSentimentSnapshots() {
        try {
            let loaded = readStore(ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY) ?? {};

            // Migrate old format (object with timeframe keys) to new format (array)
            let didMigrate = false;
            Object.keys(loaded).forEach(employeeName => {
                const employeeData = loaded[employeeName];

                if (employeeData && typeof employeeData === 'object' && !Array.isArray(employeeData)) {
                    didMigrate = true;
                    const migratedArray = [];
                    Object.entries(employeeData).forEach(([timeframeKey, snapshot]) => {
                        const [start, end] = timeframeKey.split('_');

                        if (snapshot.positive || snapshot.negative || snapshot.emotions) {
                            snapshot = {
                                associateName: employeeName,
                                timeframeStart: start,
                                timeframeEnd: end,
                                savedAt: snapshot.savedAt || new Date().toISOString(),
                                scores: {
                                    positiveWord: snapshot.positive?.percentage || 0,
                                    negativeWord: snapshot.negative?.percentage || 0,
                                    managingEmotions: snapshot.emotions?.percentage || 0
                                },
                                calls: {
                                    positiveTotal: snapshot.positive?.totalCalls || 0,
                                    positiveDetected: snapshot.positive?.callsDetected || 0,
                                    negativeTotal: snapshot.negative?.totalCalls || 0,
                                    negativeDetected: snapshot.negative?.callsDetected || 0,
                                    emotionsTotal: snapshot.emotions?.totalCalls || 0,
                                    emotionsDetected: snapshot.emotions?.callsDetected || 0
                                },
                                topPhrases: {
                                    positiveA: snapshot.positive?.phrases || [],
                                    negativeA: snapshot.negative?.phrases?.filter(p => p.speaker === 'A') || [],
                                    negativeC: snapshot.negative?.phrases?.filter(p => p.speaker === 'C') || [],
                                    emotions: snapshot.emotions?.phrases || []
                                },
                                suggestions: snapshot.suggestions || {}
                            };
                        } else {
                            if (!snapshot.timeframeStart) snapshot.timeframeStart = start;
                            if (!snapshot.timeframeEnd) snapshot.timeframeEnd = end;
                            if (!snapshot.associateName) snapshot.associateName = employeeName;
                            if (!snapshot.savedAt) snapshot.savedAt = new Date().toISOString();
                        }

                        migratedArray.push(snapshot);
                    });

                    loaded[employeeName] = migratedArray;
                }
            });

            // Save migrated data back if migration occurred
            if (didMigrate) {
                if (persistNormalizedInPlace(ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY, loaded, 'associateSentimentSnapshots (migration)')) {
                    console.log('💾 Saved migrated sentiment data');
                }
            }

            return loaded;
        } catch (error) {
            console.error('Error loading associate sentiment snapshots:', error);
            return {};
        }
    }

    function saveAssociateSentimentSnapshots(associateSentimentSnapshotsRef) {
        try {
            const ok = saveWithSizeCheck(ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY, associateSentimentSnapshotsRef || {});
            if (!ok) console.error('Failed to save associate sentiment snapshots due to size');
            return ok;
        } catch (error) {
            console.error('Error saving associate sentiment snapshots:', error);
            return false;
        }
    }

    // ============================================
    // TEAM MEMBERS & PREFERENCES
    // ============================================

    function loadTeamMembers() {
        try {
            const namespacedKey = STORAGE_PREFIX + 'myTeamMembers';
            const saved = localStorage.getItem(namespacedKey);
            return saved ? JSON.parse(saved) : {};
        } catch (error) {
            console.error('Error loading team members:', error);
            return {};
        }
    }

    function saveTeamMembers(teamMembersRef) {
        try {
            window.DevCoachModules?.storage?.saveWithSizeCheck?.('myTeamMembers', teamMembersRef);
            return true;
        } catch (error) {
            console.error('Error saving team members:', error);
            return false;
        }
    }

    function loadCallCenterAverages() {
        try {
            return readStore('callCenterAverages') ?? {};
        } catch (error) {
            console.error('Error loading call center averages:', error);
            return {};
        }
    }

    function saveCallCenterAverages(averages) {
        try {
            return saveWithSizeCheck('callCenterAverages', averages);
        } catch (error) {
            console.error('Error saving call center averages:', error);
            return false;
        }
    }

    function saveNickname(employeeFullName, nickname) {
        try {
            const nicknames = (window.DevCoachModules?.storage?.readStore?.('employeeNicknames') ?? {});
            nicknames[employeeFullName] = nickname;
            window.DevCoachModules?.storage?.saveWithSizeCheck?.('employeeNicknames', nicknames);
            return true;
        } catch (error) {
            console.error('Error saving nickname:', error);
            return false;
        }
    }

    function getSavedNickname(employeeFullName) {
        try {
            const nicknames = (window.DevCoachModules?.storage?.readStore?.('employeeNicknames') ?? {});
            return nicknames[employeeFullName] || '';
        } catch (error) {
            console.error('Error getting nickname:', error);
            return '';
        }
    }

    function loadUserTips() {
        try {
            const namespacedKey = STORAGE_PREFIX + 'coachingTips';
            const saved = localStorage.getItem(namespacedKey);
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('Error loading user tips:', error);
            return [];
        }
    }

    function saveUserTips(tips) {
        try {
            window.DevCoachModules?.storage?.saveWithSizeCheck?.('coachingTips', tips);
            return true;
        } catch (error) {
            console.error('Error saving user tips:', error);
            return false;
        }
    }

    function loadTipUsageHistory() {
        try {
            return readStore('tipUsageHistory') ?? {};
        } catch (error) {
            return {};
        }
    }

    function saveTipUsageHistory(history) {
        try {
            return saveWithSizeCheck('tipUsageHistory', history);
        } catch (error) {
            console.error('Error saving tip usage history:', error);
            return false;
        }
    }

    // ============================================
    // FOLLOW-UP HISTORY
    // ============================================

    function loadFollowUpHistory() {
        try {
            return readStore('followUpHistory') ?? { entries: [] };
        } catch (error) {
            console.error('Error loading follow-up history:', error);
            return { entries: [] };
        }
    }

    function saveFollowUpHistory(data) {
        try {
            const ok = saveWithSizeCheck('followUpHistory', data || { entries: [] });
            if (!ok) console.error('Failed to save follow-up history due to size');
            return ok;
        } catch (error) {
            console.error('Error saving follow-up history:', error);
            return false;
        }
    }

    // ============================================
    // HOT TIP HISTORY
    // ============================================

    function loadHotTipHistory() {
        try {
            return readStore('hotTipHistory') ?? { entries: [] };
        } catch (error) {
            console.error('Error loading hot tip history:', error);
            return { entries: [] };
        }
    }

    function saveHotTipHistory(data) {
        try {
            const ok = saveWithSizeCheck('hotTipHistory', data || { entries: [] });
            if (!ok) console.error('Failed to save hot tip history due to size');
            return ok;
        } catch (error) {
            console.error('Error saving hot tip history:', error);
            return false;
        }
    }

    // ============================================
    // RELIABILITY TRACKER
    // ============================================

    function loadReliabilityTracker() {
        try {
            return readStore('reliabilityTracker') ?? { employees: {} };
        } catch (error) {
            console.error('Error loading reliability tracker:', error);
            return { employees: {} };
        }
    }

    function saveReliabilityTracker(data) {
        const ok = saveWithSizeCheck('reliabilityTracker', data);
        if (!ok) console.error('Error saving reliability tracker: save failed');
        return ok;
    }

    // ============================================
    // PTO TRACKER
    // ============================================

    function loadPtoTracker() {
        try {
            return readStore('ptoTracker') ?? {};
        } catch (error) {
            console.error('Error loading PTO tracker:', error);
            return {};
        }
    }

    function savePtoTracker(data) {
        const ok = saveWithSizeCheck('ptoTracker', data);
        if (!ok) {
            console.error('Error saving PTO tracker: save failed (quota or size limit)');
        }
        return ok;
    }

    // ============================================
    // CALL LISTENING LOGS
    // ============================================
    // Lived in script.js and read localStorage directly, which left it outside
    // the one place that knows where a store actually lives. It is one of the
    // largest stores by growth (transcripts are clamped to 8000 chars each), so
    // it has to sit on the same chokepoint as the rest before the backing store
    // can move. Pure relocation: same key, same shape, same behavior.

    /* ── Call logs and their transcripts ──
     *
     * Transcripts live inline on the entry. They were split into their own
     * store to save sync bandwidth, and that was the wrong trade.
     *
     * The reasoning was sound as far as it went: a sync shard is a whole
     * store, so with transcripts inline a one-word edit to a note re-uploaded
     * every transcript in the log. Splitting them meant a note edit shipped
     * the metadata alone.
     *
     * What it missed is that two stores are two independent shards. Scott
     * saved a call on the work PC and opened it at home to find the notes
     * there and the transcript gone: the entry crossed, the transcript store
     * did not, and the reference dangled. The in-machine write ordering I put
     * in guarded the wrong failure. Both writes had succeeded; only one of
     * them travelled.
     *
     * Bandwidth on a note edit is worth nothing next to a transcript. He can
     * retype a note. He cannot re-listen to a call from three weeks ago. So
     * the transcript travels with the entry that references it, always, and
     * there is nothing to arrive out of step.
     *
     * The rejoin below stays as a repair: `callTranscripts` is still
     * registered and still syncs, so a transcript already stranded in it is
     * pulled back onto its entry on load and written inline from then on.
     */

    function readTranscriptStore() {
        try {
            const stored = readStore('callTranscripts') ?? {};
            return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
        } catch (error) {
            console.error('Error loading call transcripts:', error);
            return {};
        }
    }

    function loadCallListeningLogs() {
        try {
            const parsed = readStore('callListeningLogs') ?? {};
            if (!parsed || typeof parsed !== 'object') return {};

            const transcripts = readTranscriptStore();
            const joined = {};

            Object.keys(parsed).forEach((employeeName) => {
                const entries = Array.isArray(parsed[employeeName]) ? parsed[employeeName] : [];
                joined[employeeName] = entries.map((entry) => {
                    if (!entry || typeof entry !== 'object') return entry;
                    // An inline transcript is an entry from before the split
                    // and is left exactly as it is.
                    if (typeof entry.transcript === 'string' && entry.transcript) return entry;
                    if (!entry.transcriptId) return entry;

                    const text = transcripts[entry.transcriptId];
                    // A missing transcript is reported rather than papered
                    // over: an entry that silently loses its transcript looks
                    // like a call nobody recorded.
                    if (typeof text !== 'string') {
                        console.warn(`[storage] call log ${entry.id} references transcript ${entry.transcriptId}, which is not in the store.`);
                        return entry;
                    }
                    return { ...entry, transcript: text };
                });
            });

            return joined;
        } catch (error) {
            console.error('Error loading call listening logs:', error);
            return {};
        }
    }

    /**
     * Pulls any stranded transcript back onto its entry and writes it inline.
     *
     * The join in loadCallListeningLogs already repairs this in memory on
     * every read, but a repair that is never persisted has to be redone
     * forever, and until it is persisted the transcript is still in a second
     * store that may not reach the other machine. Which is how Scott ended up
     * with the notes at home and the transcript at work.
     *
     * So this runs at boot and again after a sync pull, and saves once when it
     * finds something. Saving is what marks the store dirty, which is what
     * gets the transcript across inline on the next push. Nothing for him to
     * do but sync.
     *
     * Writes only when it actually repaired something. An unconditional save
     * at boot would mark the store dirty on every load, and a store that is
     * always dirty is a store that pushes over the other machine's work every
     * time a tab is opened.
     */
    function repairInlineTranscripts() {
        try {
            const logs = loadCallListeningLogs();
            let repaired = 0;
            let pending = 0;

            Object.keys(logs).forEach((employeeName) => {
                (logs[employeeName] || []).forEach((entry) => {
                    if (!entry || !entry.transcriptId) return;
                    if (typeof entry.transcript === 'string' && entry.transcript) repaired += 1;
                    else pending += 1;
                });
            });

            if (repaired) {
                const ok = saveCallListeningLogs(logs);
                if (!ok) {
                    console.error('[storage] Could not write the repaired transcripts back.');
                    return { repaired: 0, pending: pending + repaired };
                }
                console.log(`[storage] Moved ${repaired} transcript(s) back onto their call logs.`);
            }
            if (pending) {
                console.warn(`[storage] ${pending} call log(s) reference a transcript this machine does not have yet. They will be repaired once it syncs.`);
            }

            return { repaired, pending };
        } catch (error) {
            console.error('[storage] Transcript repair failed:', error);
            return { repaired: 0, pending: 0 };
        }
    }

    /**
     * Writes the logs, transcripts included.
     *
     * `transcriptId` is dropped on the way out: an entry that carries its own
     * transcript has no use for a pointer to a second copy, and leaving one
     * behind would let a future reader think the inline text was the stale
     * half. The load path still honours the pointer, so a transcript stranded
     * in the old store by an earlier version is recovered rather than lost.
     */
    function saveCallListeningLogs(callListeningLogsRef) {
        try {
            const logs = callListeningLogsRef || {};
            const inlined = {};

            Object.keys(logs).forEach((employeeName) => {
                const entries = Array.isArray(logs[employeeName]) ? logs[employeeName] : [];
                inlined[employeeName] = entries.map((entry) => {
                    if (!entry || typeof entry !== 'object') return entry;
                    if (!entry.transcriptId) return entry;
                    if (typeof entry.transcript !== 'string' || !entry.transcript) {
                        // The pointer is all there is. Keep it, so the
                        // transcript can still be recovered if its store
                        // arrives later.
                        return entry;
                    }
                    const { transcriptId, ...rest } = entry;
                    return rest;
                });
            });

            const ok = saveWithSizeCheck('callListeningLogs', inlined);
            if (!ok) console.error('Failed to save call listening logs due to size');
            return ok;
        } catch (error) {
            console.error('Error saving call listening logs:', error);
            return false;
        }
    }

    // ============================================
    // MODULE EXPORT
    // ============================================

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.storage = {
        // Backend
        hydrate,
        getBackendMode,
        readStore,
        reclaimLocalStorageCopies,
        isStoreDirty,
        markStoreDirty,
        clearDirtyStores,
        onStoreChanged,
        // Storage helpers
        // Lets a caller ask whether a store is subject to the localStorage size
        // ceiling, so it can make room rather than simply failing.
        isBackedByIdb,
        saveWithSizeCheck,
        // Weekly data
        loadWeeklyData,
        saveWeeklyData,
        // Daily data (ephemeral, separate 4MB budget)
        loadDailyData,
        saveDailyData,
        // YTD data
        loadYtdData,
        saveYtdData,
        // Coaching history
        loadCoachingHistory,
        saveCoachingHistory,
        // Call listening logs
        loadCallListeningLogs,
        saveCallListeningLogs,
        repairInlineTranscripts,
        appendCoachingLogEntry,
        getCoachingHistoryForEmployee,
        // Sentiment data
        loadSentimentPhraseDatabase,
        saveSentimentPhraseDatabase,
        loadAssociateSentimentSnapshots,
        saveAssociateSentimentSnapshots,
        // Team & preferences
        loadTeamMembers,
        saveTeamMembers,
        loadCallCenterAverages,
        saveCallCenterAverages,
        saveNickname,
        getSavedNickname,
        // Tips
        loadUserTips,
        saveUserTips,
        loadTipUsageHistory,
        saveTipUsageHistory,
        // Follow-up history
        loadFollowUpHistory,
        saveFollowUpHistory,
        // Hot tip history
        loadHotTipHistory,
        saveHotTipHistory,
        // PTO
        loadPtoTracker,
        savePtoTracker,
        // Reliability tracker
        loadReliabilityTracker,
        saveReliabilityTracker,
        // Constants
        STORAGE_PREFIX,
        SENTIMENT_PHRASE_DB_STORAGE_KEY,
        ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY,
        LOCALSTORAGE_MAX_SIZE_MB
    };
})();
