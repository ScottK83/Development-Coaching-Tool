/* ========================================
   STORAGE MODULE
   Centralized data persistence layer
   ======================================== */

(function() {
    'use strict';

    // ============================================
    // CONSTANTS
    // ============================================
    const STORAGE_PREFIX = 'devCoachingTool_';
    const SENTIMENT_PHRASE_DB_STORAGE_KEY = 'sentimentPhraseDatabase';
    const ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY = 'associateSentimentSnapshots';
    const LOCALSTORAGE_MAX_SIZE_MB = 4;

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

    // ============================================
    // WEEKLY DATA
    // ============================================

    function loadWeeklyData() {
        try {
            const namespacedKey = STORAGE_PREFIX + 'weeklyData';
            const saved = localStorage.getItem(namespacedKey);
            if (saved) {
                const data = JSON.parse(saved);
                return data && typeof data === 'object' ? data : {};
            }

            const legacySaved = localStorage.getItem('weeklyData');
            if (legacySaved) {
                const legacyData = JSON.parse(legacySaved);
                const normalizedData = legacyData && typeof legacyData === 'object' ? legacyData : {};
                localStorage.setItem(namespacedKey, JSON.stringify(normalizedData));
                return normalizedData;
            }

            return {};
        } catch (error) {
            console.error('Error loading weekly data:', error);
            return {};
        }
    }

    function saveWeeklyData(weeklyDataRef) {
        try {
            if (!saveWithSizeCheck('weeklyData', weeklyDataRef)) {
                console.error('Failed to save weekly data due to size');
            }
        } catch (error) {
            console.error('Error saving weekly data:', error);
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
                return data && typeof data === 'object' ? data : {};
            }
            return {};
        } catch (error) {
            console.error('Error loading YTD data:', error);
            return {};
        }
    }

    function saveYtdData(ytdDataRef) {
        try {
            if (!saveWithSizeCheck('ytdData', ytdDataRef)) {
                console.error('Failed to save YTD data due to size');
            }
        } catch (error) {
            console.error('Error saving YTD data:', error);
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
            if (!saveWithSizeCheck('coachingHistory', coachingHistoryRef)) {
                console.error('Failed to save coaching history due to size');
            }
        } catch (error) {
            console.error('Error saving coaching history:', error);
        }
    }

    function appendCoachingLogEntry(coachingHistoryRef, entry) {
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
            if (!saveWithSizeCheck(SENTIMENT_PHRASE_DB_STORAGE_KEY, sentimentPhraseDatabaseRef || {})) {
                console.error('Failed to save sentiment phrase database due to size');
            }
        } catch (error) {
            console.error('Error saving sentiment phrase database:', error);
        }
    }

    function loadAssociateSentimentSnapshots() {
        try {
            const namespacedKey = STORAGE_PREFIX + ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY;
            const saved = localStorage.getItem(namespacedKey);
            return saved ? JSON.parse(saved) : {};
        } catch (error) {
            console.error('Error loading associate sentiment snapshots:', error);
            return {};
        }
    }

    function saveAssociateSentimentSnapshots(associateSentimentSnapshotsRef) {
        try {
            if (!saveWithSizeCheck(ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY, associateSentimentSnapshotsRef || {})) {
                console.error('Failed to save associate sentiment snapshots due to size');
            }
        } catch (error) {
            console.error('Error saving associate sentiment snapshots:', error);
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
        } catch (error) {
            console.error('Error saving team members:', error);
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
        } catch (error) {
            console.error('Error saving call center averages:', error);
        }
    }

    function saveNickname(employeeFullName, nickname) {
        try {
            const nicknames = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'employeeNicknames') || '{}');
            nicknames[employeeFullName] = nickname;
            localStorage.setItem(STORAGE_PREFIX + 'employeeNicknames', JSON.stringify(nicknames));
        } catch (error) {
            console.error('Error saving nickname:', error);
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
        } catch (error) {
            console.error('Error saving user tips:', error);
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
        } catch (error) {
            console.error('Error saving tip usage history:', error);
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
            if (!saveWithSizeCheck('followUpHistory', data || { entries: [] })) {
                console.error('Failed to save follow-up history due to size');
            }
        } catch (error) {
            console.error('Error saving follow-up history:', error);
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
            if (!saveWithSizeCheck('hotTipHistory', data || { entries: [] })) {
                console.error('Failed to save hot tip history due to size');
            }
        } catch (error) {
            console.error('Error saving hot tip history:', error);
        }
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
        try {
            localStorage.setItem(STORAGE_PREFIX + 'ptoTracker', JSON.stringify(data));
        } catch (error) {
            console.error('Error saving PTO tracker:', error);
        }
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
        // Constants
        STORAGE_PREFIX,
        SENTIMENT_PHRASE_DB_STORAGE_KEY,
        ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY,
        LOCALSTORAGE_MAX_SIZE_MB
    };
})();
