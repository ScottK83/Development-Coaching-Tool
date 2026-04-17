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

    // ============================================
    // STORAGE HELPERS
    // ============================================

    function saveWithSizeCheck(key, data) {
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
                return false;
            }
            console.error(`Error saving ${key}:`, error);
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

    function normalizePeriodEmployees(period) {
        if (!period || !Array.isArray(period.employees)) return period;

        let changed = false;
        const employees = period.employees.map(employee => {
            const normalized = normalizeEmployeeMetricRow(employee);
            if (normalized !== employee) changed = true;
            return normalized;
        });

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
            const namespacedKey = STORAGE_PREFIX + 'weeklyData';
            const saved = localStorage.getItem(namespacedKey);
            if (saved) {
                const data = JSON.parse(saved);
                const normalizedData = normalizeStoredDataSet(data && typeof data === 'object' ? data : {});
                if (normalizedData !== data) {
                    localStorage.setItem(namespacedKey, JSON.stringify(normalizedData));
                }
                return normalizedData;
            }

            const legacySaved = localStorage.getItem('weeklyData');
            if (legacySaved) {
                const legacyData = JSON.parse(legacySaved);
                const normalizedData = normalizeStoredDataSet(legacyData && typeof legacyData === 'object' ? legacyData : {});
                localStorage.setItem(namespacedKey, JSON.stringify(normalizedData));
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
            const namespacedKey = STORAGE_PREFIX + 'dailyData';
            const saved = localStorage.getItem(namespacedKey);
            if (saved) {
                const data = JSON.parse(saved);
                const normalizedData = normalizeStoredDataSet(data && typeof data === 'object' ? data : {});
                if (normalizedData !== data) {
                    localStorage.setItem(namespacedKey, JSON.stringify(normalizedData));
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
            const namespacedKey = STORAGE_PREFIX + 'ytdData';
            const saved = localStorage.getItem(namespacedKey);
            if (saved) {
                const data = JSON.parse(saved);
                const normalizedData = normalizeStoredDataSet(data && typeof data === 'object' ? data : {});
                if (normalizedData !== data) {
                    localStorage.setItem(namespacedKey, JSON.stringify(normalizedData));
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
            const namespacedKey = STORAGE_PREFIX + 'coachingHistory';
            const saved = localStorage.getItem(namespacedKey);
            const data = saved ? JSON.parse(saved) : {};
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
            const namespacedKey = STORAGE_PREFIX + SENTIMENT_PHRASE_DB_STORAGE_KEY;
            const saved = localStorage.getItem(namespacedKey);
            return saved ? JSON.parse(saved) : null;
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
            const namespacedKey = STORAGE_PREFIX + ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY;
            const saved = localStorage.getItem(namespacedKey);
            let loaded = saved ? JSON.parse(saved) : {};

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
                localStorage.setItem(namespacedKey, JSON.stringify(loaded));
                console.log('💾 Saved migrated sentiment data to localStorage');
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
            const namespacedKey = STORAGE_PREFIX + 'tipUsageHistory';
            const saved = localStorage.getItem(namespacedKey);
            return saved ? JSON.parse(saved) : {};
        } catch (error) {
            return {};
        }
    }

    function saveTipUsageHistory(history) {
        try {
            localStorage.setItem(STORAGE_PREFIX + 'tipUsageHistory', JSON.stringify(history));
            return true;
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
            const namespacedKey = STORAGE_PREFIX + 'followUpHistory';
            const saved = localStorage.getItem(namespacedKey);
            return saved ? JSON.parse(saved) : { entries: [] };
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
            const namespacedKey = STORAGE_PREFIX + 'hotTipHistory';
            const saved = localStorage.getItem(namespacedKey);
            return saved ? JSON.parse(saved) : { entries: [] };
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
            const saved = localStorage.getItem(STORAGE_PREFIX + 'reliabilityTracker');
            return saved ? JSON.parse(saved) : { employees: {} };
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
            const namespacedKey = STORAGE_PREFIX + 'ptoTracker';
            const saved = localStorage.getItem(namespacedKey);
            return saved ? JSON.parse(saved) : {};
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
    // MODULE EXPORT
    // ============================================

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.storage = {
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
