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
    async function hydrate() {
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

            if (!marked && !backendHasData) {
                const copied = await copyBulkStoresIntoBackend(backend);
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

            bulkCache = await backend.getAll();
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
            localStorage.setItem(STORAGE_PREFIX + 'myTeamMembers', JSON.stringify(teamMembersRef));
            return true;
        } catch (error) {
            console.error('Error saving team members:', error);
            return false;
        }
    }

    function loadCallCenterAverages() {
        try {
            const namespacedKey = STORAGE_PREFIX + 'callCenterAverages';
            const saved = localStorage.getItem(namespacedKey);
            return saved ? JSON.parse(saved) : {};
        } catch (error) {
            console.error('Error loading call center averages:', error);
            return {};
        }
    }

    function saveCallCenterAverages(averages) {
        try {
            localStorage.setItem(STORAGE_PREFIX + 'callCenterAverages', JSON.stringify(averages));
            return true;
        } catch (error) {
            console.error('Error saving call center averages:', error);
            return false;
        }
    }

    function saveNickname(employeeFullName, nickname) {
        try {
            const nicknames = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'employeeNicknames') || '{}');
            nicknames[employeeFullName] = nickname;
            localStorage.setItem(STORAGE_PREFIX + 'employeeNicknames', JSON.stringify(nicknames));
            return true;
        } catch (error) {
            console.error('Error saving nickname:', error);
            return false;
        }
    }

    function getSavedNickname(employeeFullName) {
        try {
            const nicknames = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'employeeNicknames') || '{}');
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
            localStorage.setItem(STORAGE_PREFIX + 'coachingTips', JSON.stringify(tips));
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

    function loadCallListeningLogs() {
        try {
            const parsed = readStore('callListeningLogs') ?? {};
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            console.error('Error loading call listening logs:', error);
            return {};
        }
    }

    function saveCallListeningLogs(callListeningLogsRef) {
        try {
            const ok = saveWithSizeCheck('callListeningLogs', callListeningLogsRef || {});
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
        // Storage helpers
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
