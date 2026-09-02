/**
 * Constants Module
 * Single source of truth for string/numeric constants shared across modules.
 * Loaded before all other modules.
 */
(function () {
    'use strict';

    const STORAGE_PREFIX = 'devCoachingTool_';
    const SENTIMENT_PHRASE_DB_STORAGE_KEY = 'sentimentPhraseDatabase';
    const ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY = 'associateSentimentSnapshots';
    const LOCALSTORAGE_MAX_SIZE_MB = 4;
    const COPILOT_URL = 'https://copilot.microsoft.com';

    const IDB_DB_NAME = 'devCoachingTool';
    const IDB_VERSION = 1;
    const IDB_BULK_STORE = 'bulk';
    const IDB_ARCHIVE_STORE = 'archive';
    // How long to wait for indexedDB.open before giving up and staying on
    // localStorage. A second tab of this app holding a versionchange, or a
    // locked profile, can leave the request pending forever, and boot must not
    // depend on it resolving.
    const IDB_OPEN_TIMEOUT_MS = 4000;

    // The stores that grow with weeks, associates or calls. These are what move
    // to IndexedDB; the ~35 small config and view-state keys stay in
    // localStorage, where synchronous reads at parse time are still fine.
    //
    // A year of weeklyData alone is roughly 7.2 MB as localStorage charges it
    // (UTF-16), against a 5 MB origin ceiling, so this list is the difference
    // between holding a year and not.
    // Derived from the store registry, which declares every key exactly once.
    // Kept here because constants loads first and many modules already read it
    // from this object; the registry is the authority for what is in it.
    //
    // INVARIANT: this is exactly the set the storage module routes through
    // readStore/saveWithSizeCheck. A key listed here that the module does not
    // route gets copied to IndexedDB and then still read from localStorage,
    // which is fine until the localStorage copy is reclaimed and then is not.
    const BULK_STORAGE_KEYS = window.DevCoachModules?.storeRegistry?.bulkNames?.() || [
        // Fallback only if the registry did not load. A drift test
        // fails the build if these disagree.
        'weeklyData', 'ytdData', 'dailyData', 'coachingHistory',
        'callListeningLogs', 'associateSentimentSnapshots', 'sentimentPhraseDatabase', 'reliabilityTracker',
        'ptoTracker', 'tipUsageHistory', 'followUpHistory', 'hotTipHistory',
        'attendanceTracker', 'myTeamMembers', 'callCenterAverages', 'yearEndAnnualGoals',
        'yearEndDraftEntries', 'employeePreferredNames', 'employeeNicknames', 'employeeSupervisors',
        'executiveSummaryNotes', 'userCustomTips', 'coachingTips', 'customMetrics',
        'modifiedServerTips', 'deletedServerTips', 'metricCoachingTips', 'yoyBaseline2025',
        'complianceLog', 'contestData', 'weeklyFocalPoints', 'celebrationsHistory',
        'oneOnOneMeetings', 'midYearMeta'
    ];

    window.DevCoachConstants = {
        STORAGE_PREFIX,
        SENTIMENT_PHRASE_DB_STORAGE_KEY,
        ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY,
        LOCALSTORAGE_MAX_SIZE_MB,
        COPILOT_URL,
        IDB_DB_NAME,
        IDB_VERSION,
        IDB_BULK_STORE,
        IDB_ARCHIVE_STORE,
        IDB_OPEN_TIMEOUT_MS,
        BULK_STORAGE_KEYS
    };
})();
