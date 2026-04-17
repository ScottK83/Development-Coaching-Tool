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

    window.DevCoachConstants = {
        STORAGE_PREFIX,
        SENTIMENT_PHRASE_DB_STORAGE_KEY,
        ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY,
        LOCALSTORAGE_MAX_SIZE_MB
    };
})();
