/* ========================================
   STORE REGISTRY
   Every devCoachingTool_ key, declared exactly once.

   Before this there were four hand-maintained lists that disagreed:
   BULK_STORAGE_KEYS, SYNCABLE_STORAGE_KEYS, EXPLICITLY_SYNCED_STORES and the
   worker's payload literal. The gaps between them are not theoretical: the
   worker silently discarded ~18 stores from every push for months because it
   rebuilt the payload field by field and nobody noticed a name was missing.

   Adding a store here is the only thing anyone should have to remember.
   ======================================== */

(function () {
    'use strict';

    // tier
    //   'data'    real content, belongs on the server, survives a new machine
    //   'device'  this browser and this moment. Never synced: syncing it would
    //             let one machine's view state or secrets land on another
    //   'derived' recomputable from data, not worth carrying
    //
    // backend
    //   'idb'     served from IndexedDB via the storage module's cache
    //   'local'   stays in localStorage, small and read at parse time
    //
    // merge  how two machines' versions of this store are reconciled
    //   'lastWriterWins'    the later write replaces, loser kept under conflicts/
    //   'unionByEntryHash'  append-only logs; entries are merged, never dropped
    //   'recompute'         derived, rebuilt rather than merged
    const STORES = [
        // --- Bulk data, on IndexedDB ---
        { name: 'weeklyData', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'ytdData', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'dailyData', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        // Dailies that a weekly upload has superseded. Kept rather than
        // deleted: day-level detail is the only thing that answers a trend
        // question at finer resolution than a week.
        { name: 'dailyArchive', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'coachingHistory', tier: 'data', backend: 'idb', merge: 'unionByEntryHash' },
        { name: 'callListeningLogs', tier: 'data', backend: 'idb', merge: 'unionByEntryHash' },
        { name: 'associateSentimentSnapshots', tier: 'data', backend: 'idb', merge: 'unionByEntryHash' },
        { name: 'sentimentPhraseDatabase', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'reliabilityTracker', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'ptoTracker', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'tipUsageHistory', tier: 'data', backend: 'idb', merge: 'unionByEntryHash' },
        { name: 'followUpHistory', tier: 'data', backend: 'idb', merge: 'unionByEntryHash' },
        { name: 'hotTipHistory', tier: 'data', backend: 'idb', merge: 'unionByEntryHash' },

        // --- Data still in localStorage. Small, or read before hydrate. ---
        { name: 'attendanceTracker', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'myTeamMembers', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'callCenterAverages', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'yearEndAnnualGoals', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'yearEndDraftEntries', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'employeePreferredNames', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'employeeNicknames', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'employeeSupervisors', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'executiveSummaryNotes', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'userCustomTips', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'coachingTips', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'customMetrics', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'modifiedServerTips', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'deletedServerTips', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'metricCoachingTips', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'yoyBaseline2025', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'ccEmail', tier: 'data', backend: 'local', merge: 'lastWriterWins' },
        // ccEmail above is the one data store still in localStorage, because the
        // mailto helper reads it before the storage module exists. These two are
        // only read when a draft is built or the settings panel opens, so they
        // belong off the 5MB wall with everything else.
        { name: 'associateEmailPattern', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'employeeEmails', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'complianceLog', tier: 'data', backend: 'idb', merge: 'unionByEntryHash' },
        { name: 'weeklyFocalPoints', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },
        { name: 'celebrationsHistory', tier: 'data', backend: 'idb', merge: 'unionByEntryHash' },
        { name: 'oneOnOneMeetings', tier: 'data', backend: 'idb', merge: 'unionByEntryHash' },
        { name: 'midYearMeta', tier: 'data', backend: 'idb', merge: 'lastWriterWins' },

        // --- This machine only. Never leaves it. ---
        // callListeningSyncConfig holds the shared secret. Syncing it would put
        // the credential in the backup it authenticates against.
        { name: 'callListeningSyncConfig', tier: 'device', backend: 'local' },
        { name: 'uiNavState', tier: 'device', backend: 'local' },
        { name: 'selectedAssociate', tier: 'device', backend: 'local' },
        { name: 'teamMemberSelectorExpanded', tier: 'device', backend: 'local' },
        { name: 'trendQueueLegendExpanded', tier: 'device', backend: 'local' },
        { name: 'celebrationsInnerTab', tier: 'device', backend: 'local' },
        { name: 'celebrationsSelection', tier: 'device', backend: 'local' },
        { name: 'celebrationsThreshold', tier: 'device', backend: 'local' },
        { name: 'theme', tier: 'device', backend: 'local' },
        { name: 'debugLog', tier: 'device', backend: 'local' },
        { name: 'errorLog', tier: 'device', backend: 'local' },
        { name: 'lastError', tier: 'device', backend: 'local' },
        { name: 'repoSyncLastSuccess', tier: 'device', backend: 'local' },
        { name: 'repoBackupAppliedAt', tier: 'device', backend: 'local' },
        { name: 'deleteAllJustRan', tier: 'device', backend: 'local' },
        { name: 'idbMigrated_v1', tier: 'device', backend: 'local' },
        // This machine's identity and its view of the cloud manifest. Syncing
        // either would give every machine the same device id and overwrite each
        // one's record of what it has already applied.
        { name: 'v2DeviceId', tier: 'device', backend: 'local' },
        { name: 'v2SyncState', tier: 'device', backend: 'local' },
        { name: 'selectedYearEndYear', tier: 'device', backend: 'local' },
        { name: 'lastTrendPeriod', tier: 'device', backend: 'local' },

        // --- Rebuildable from the data above. ---
        { name: 'lastUploadUndo', tier: 'derived', backend: 'local', merge: 'recompute' },
        { name: 'lastUploadHeaderFingerprint', tier: 'derived', backend: 'local', merge: 'recompute' },
        { name: 'lastUploadMetricCoverage', tier: 'derived', backend: 'local', merge: 'recompute' },
        { name: 'reliabilityBlankIsZero_v1', tier: 'derived', backend: 'local', merge: 'recompute' },
        { name: 'dataHealthReviewed', tier: 'derived', backend: 'local', merge: 'recompute' }
    ];

    const byName = new Map(STORES.map((s) => [s.name, s]));

    function get(name) {
        return byName.get(String(name || '')) || null;
    }

    /**
     * Keys with a runtime suffix (smartDefault_lastPeriodType,
     * supervisorSeeded_v5_migration). They cannot be enumerated, so they are
     * matched by prefix and always treated as device-local.
     */
    const DEVICE_KEY_PREFIXES = ['smartDefault_', 'supervisorSeeded_', 'supervisorRenamed_'];

    function tierOf(name) {
        const entry = get(name);
        if (entry) return entry.tier;
        if (DEVICE_KEY_PREFIXES.some((p) => String(name || '').startsWith(p))) return 'device';
        // An unknown key is treated as data. Backing up something that did not
        // need it costs storage; skipping something that did costs the data.
        return 'data';
    }

    function namesWhere(predicate) {
        return STORES.filter(predicate).map((s) => s.name);
    }

    const api = {
        STORES,
        get,
        tierOf,
        DEVICE_KEY_PREFIXES,
        /** Served from IndexedDB. This is the authority for BULK_STORAGE_KEYS. */
        bulkNames: () => namesWhere((s) => s.backend === 'idb'),
        /** Everything that belongs on the server. */
        syncedNames: () => namesWhere((s) => s.tier === 'data'),
        /** Never leaves this machine. */
        deviceNames: () => namesWhere((s) => s.tier !== 'data'),
        mergeStrategyOf: (name) => get(name)?.merge || 'lastWriterWins',
        isSynced: (name) => tierOf(name) === 'data'
    };

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.storeRegistry = api;
})();
