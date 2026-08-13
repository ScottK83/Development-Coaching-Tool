(function() {
    'use strict';

    var STORAGE_PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    var UI_NAV_STATE_STORAGE_KEY = STORAGE_PREFIX + 'uiNavState';

    // CSS uses .top-nav-btn[style*="gradient"] to style the active top-nav
    // button, so toggling the active state means moving an inline gradient
    // from one button to another.
    var SECTION_TO_TOP_NAV_BTN = {
        dashboardSection: 'dashboardBtn',
        uploadSection: 'homeBtn',
        coachingEmailSection: 'coachingEmailBtn',
        trendsAnalysisSection: 'trendsAnalysisBtn',
        reviewPrepSection: 'reviewPrepBtn',
        redFlagSection: 'redFlagBtn',
        manageDataSection: 'manageDataBtn'
    };
    var ACTIVE_TOP_NAV_GRADIENT = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';

    function setActiveTopNav(sectionId) {
        var activeBtnId = SECTION_TO_TOP_NAV_BTN[sectionId];
        Object.values(SECTION_TO_TOP_NAV_BTN).forEach(function(btnId) {
            var btn = document.getElementById(btnId);
            if (!btn) return;
            if (btnId === activeBtnId) {
                btn.style.background = ACTIVE_TOP_NAV_GRADIENT;
                btn.style.color = 'white';
            } else {
                btn.style.background = '';
                btn.style.color = '';
            }
        });
    }

    function showOnlySection(sectionId) {
        // Hide all sections
        var sections = document.querySelectorAll('section[id$="Section"], form[id$="Form"]');
        sections.forEach(function(section) {
            section.style.display = 'none';
        });

        // Show the specified section
        var targetSection = document.getElementById(sectionId);
        if (targetSection) {
            targetSection.style.display = 'block';
            saveUiNavState({ sectionId: sectionId });
        }

        setActiveTopNav(sectionId);
    }

    // --- Generic sub-section show/hide helper ---

    function showSubSectionGeneric(subSectionId, activeButtonId, subSectionIds, subNavButtonIds, activeGradient, stateKey) {
        // Hide all sub-sections in this group
        subSectionIds.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Show the target
        var target = document.getElementById(subSectionId);
        if (target) target.style.display = 'block';

        // Update button active states
        subNavButtonIds.forEach(function(btnId) {
            var btn = document.getElementById(btnId);
            if (btn) {
                if (btnId === activeButtonId) {
                    btn.style.background = activeGradient;
                    btn.style.opacity = '1';
                } else {
                    btn.style.background = '#ccc';
                    btn.style.opacity = '0.7';
                }
            }
        });

        // Save state
        var partial = {};
        partial[stateKey] = subSectionId;
        saveUiNavState(partial);
    }

    // --- My Team sub-sections ---

    // Include legacy sub-section IDs that are still children of coachingEmailSection
    // so they get hidden when switching My Team tabs
    var MY_TEAM_SUB_SECTIONS = ['subSectionMyTeamDay', 'subSectionHighlights', 'subSectionMorningPulse', 'subSectionMondayPost', 'subSectionCoachingEmail', 'subSectionTeamSnapshot', 'subSectionCallListening', 'subSectionReliability', 'subSectionOnOffTracker', 'subSectionYearEnd', 'subSectionQ1Review', 'subSectionMidYear', 'subSectionCenterRanking', 'subSectionFutures'];
    var MY_TEAM_NAV_BUTTONS = ['subNavHighlights', 'subNavMorningPulse', 'subNavMondayPost', 'subNavCoachingEmail', 'subNavTeamSnapshot', 'subNavCallListening', 'subNavReliability'];
    var MY_TEAM_SUB_TO_BTN = {
        subSectionHighlights: 'subNavHighlights',
        subSectionMorningPulse: 'subNavMorningPulse',
        subSectionMondayPost: 'subNavMondayPost',
        subSectionCoachingEmail: 'subNavCoachingEmail',
        subSectionTeamSnapshot: 'subNavTeamSnapshot',
        subSectionCallListening: 'subNavCallListening',
        subSectionReliability: 'subNavReliability'
    };

    function showMyTeamSubSection(subSectionId, activeButtonId) {
        var btnId = activeButtonId || MY_TEAM_SUB_TO_BTN[subSectionId] || 'subNavMorningPulse';
        showSubSectionGeneric(subSectionId, btnId, MY_TEAM_SUB_SECTIONS, MY_TEAM_NAV_BUTTONS,
            'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 'myTeamSubSectionId');
        saveUiNavState({ sectionId: 'coachingEmailSection' });
        // The team bar sits above the sub-nav and belongs to My Team as a
        // whole, so it's drawn here rather than by each tab's own handler —
        // including on the refresh path that restores a tab directly.
        window.DevCoachModules?.teamHub?.initializeTeamHub?.();
        // Returning to the day hub re-renders it; leaving it is a no-op.
        if (subSectionId === 'subSectionMyTeamDay') window.DevCoachModules?.myTeam?.renderDayPage?.();
    }

    // --- Trends & Analysis sub-sections ---

    var TRENDS_SUB_SECTIONS = ['subSectionTaTrendIntelligence', 'subSectionTaMetricTrends', 'subSectionTaCenterRanking', 'subSectionTaFutures', 'subSectionTaSentiment', 'subSectionTaMatchup', 'subSectionTaYoY', 'subSectionTaPatterns'];
    var TRENDS_NAV_BUTTONS = ['subNavTaIntelligence', 'subNavTaMetricCharts', 'subNavTaRankings', 'subNavTaFutures', 'subNavTaSentiment', 'subNavTaMatchup', 'subNavTaYoY', 'subNavTaPatterns'];
    var TRENDS_SUB_TO_BTN = {
        subSectionTaTrendIntelligence: 'subNavTaIntelligence',
        subSectionTaMetricTrends: 'subNavTaMetricCharts',
        subSectionTaCenterRanking: 'subNavTaRankings',
        subSectionTaFutures: 'subNavTaFutures',
        subSectionTaSentiment: 'subNavTaSentiment',
        subSectionTaMatchup: 'subNavTaMatchup',
        subSectionTaYoY: 'subNavTaYoY',
        subSectionTaPatterns: 'subNavTaPatterns'
    };

    function showTrendsSubSection(subSectionId, activeButtonId) {
        var btnId = activeButtonId || TRENDS_SUB_TO_BTN[subSectionId] || 'subNavTaIntelligence';
        showSubSectionGeneric(subSectionId, btnId, TRENDS_SUB_SECTIONS, TRENDS_NAV_BUTTONS,
            'linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%)', 'trendsSubSectionId');
        saveUiNavState({ sectionId: 'trendsAnalysisSection' });
    }

    // --- Review Prep sub-sections ---

    var REVIEW_SUB_SECTIONS = ['subSectionMeetings', 'subSectionOnOffTracker', 'subSectionQ1Review', 'subSectionMidYear', 'subSectionYearEnd'];
    var REVIEW_NAV_BUTTONS = ['subNavRpMeetings', 'subNavRpScoreCard', 'subNavRpQuarterly', 'subNavRpMidYear', 'subNavRpYearEnd'];
    var REVIEW_SUB_TO_BTN = {
        subSectionMeetings: 'subNavRpMeetings',
        subSectionOnOffTracker: 'subNavRpScoreCard',
        subSectionQ1Review: 'subNavRpQuarterly',
        subSectionMidYear: 'subNavRpMidYear',
        subSectionYearEnd: 'subNavRpYearEnd'
    };

    function showReviewPrepSubSection(subSectionId, activeButtonId) {
        var btnId = activeButtonId || REVIEW_SUB_TO_BTN[subSectionId] || 'subNavRpScoreCard';
        showSubSectionGeneric(subSectionId, btnId, REVIEW_SUB_SECTIONS, REVIEW_NAV_BUTTONS,
            'linear-gradient(135deg, #d84315 0%, #bf360c 100%)', 'reviewPrepSubSectionId');
        saveUiNavState({ sectionId: 'reviewPrepSection' });
    }

    // --- Settings (Manage Data) sub-sections ---

    var SETTINGS_SUB_SECTIONS = ['subSectionTeamMembers', 'subSectionCoachingTips', 'subSectionSyncBackup', 'subSectionDeleteData'];
    var SETTINGS_NAV_BUTTONS = ['subNavTeamMembers', 'subNavCoachingTips', 'subNavSyncBackup', 'subNavDeleteData'];

    function showManageDataSubSection(subSectionId) {
        SETTINGS_SUB_SECTIONS.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        var target = document.getElementById(subSectionId);
        if (target) target.style.display = 'block';

        SETTINGS_NAV_BUTTONS.forEach(function(btnId) {
            var btn = document.getElementById(btnId);
            if (btn) {
                // Match button to sub-section by convention
                var expectedSubId = btnId.replace('subNav', 'subSection');
                if (expectedSubId === subSectionId) {
                    btn.style.background = 'linear-gradient(135deg, #ff9800 0%, #ff5722 100%)';
                    btn.style.opacity = '1';
                } else {
                    btn.style.background = '#ccc';
                    btn.style.opacity = '0.7';
                }
            }
        });

        saveUiNavState({ sectionId: 'manageDataSection', settingsSubSectionId: subSectionId });
    }

    // --- Legacy backward compat: old showSubSection still works ---
    // Some code may still call showSubSection. Route to the correct handler.
    function showSubSection(subSectionId, activeButtonId) {
        if (MY_TEAM_SUB_TO_BTN[subSectionId]) {
            showMyTeamSubSection(subSectionId, activeButtonId);
        } else if (TRENDS_SUB_TO_BTN[subSectionId]) {
            showTrendsSubSection(subSectionId, activeButtonId);
        } else if (REVIEW_SUB_TO_BTN[subSectionId]) {
            showReviewPrepSubSection(subSectionId, activeButtonId);
        } else {
            // Fallback: try to show it directly
            var target = document.getElementById(subSectionId);
            if (target) target.style.display = 'block';
        }
    }

    // --- State management ---

    function getDefaultUiNavState() {
        return {
            sectionId: 'dashboardSection',
            myTeamSubSectionId: 'subSectionMyTeamDay',
            trendsSubSectionId: 'subSectionTaTrendIntelligence',
            reviewPrepSubSectionId: 'subSectionOnOffTracker',
            settingsSubSectionId: 'subSectionTeamMembers'
        };
    }

    // Migration map: old coachingSubSectionId → { sectionId, subKey, subValue }
    var OLD_SUB_MIGRATION = {
        subSectionCoachingEmail:    { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionCoachingEmail' },
        subSectionTeamSnapshot:     { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionTeamSnapshot' },
        subSectionCallListening:    { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionCallListening' },
        subSectionMorningPulse:     { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionMorningPulse' },
        subSectionTrendIntelligence:{ section: 'trendsAnalysisSection', key: 'trendsSubSectionId', value: 'subSectionTaTrendIntelligence' },
        subSectionMetricTrends:     { section: 'trendsAnalysisSection', key: 'trendsSubSectionId', value: 'subSectionTaMetricTrends' },
        subSectionCenterRanking:    { section: 'trendsAnalysisSection', key: 'trendsSubSectionId', value: 'subSectionTaCenterRanking' },
        subSectionFutures:          { section: 'trendsAnalysisSection', key: 'trendsSubSectionId', value: 'subSectionTaFutures' },
        subSectionSentiment:        { section: 'trendsAnalysisSection', key: 'trendsSubSectionId', value: 'subSectionTaSentiment' },
        subSectionOnOffTracker:     { section: 'reviewPrepSection', key: 'reviewPrepSubSectionId', value: 'subSectionOnOffTracker' },
        subSectionQ1Review:         { section: 'reviewPrepSection', key: 'reviewPrepSubSectionId', value: 'subSectionQ1Review' },
        subSectionMidYear:          { section: 'reviewPrepSection', key: 'reviewPrepSubSectionId', value: 'subSectionMidYear' },
        subSectionYearEnd:          { section: 'reviewPrepSection', key: 'reviewPrepSubSectionId', value: 'subSectionYearEnd' },
        subSectionPto:              { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionReliability' },
        // Dissolved wrapper IDs → defaults
        subSectionPerformance:      { section: 'reviewPrepSection', key: 'reviewPrepSubSectionId', value: 'subSectionOnOffTracker' },
        subSectionTrends:           { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionMorningPulse' },
        subSectionReviewPrep:       { section: 'reviewPrepSection', key: 'reviewPrepSubSectionId', value: 'subSectionQ1Review' },
        subSectionMoreTools:        { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionMorningPulse' }
    };

    function loadUiNavState() {
        try {
            var raw = localStorage.getItem(UI_NAV_STATE_STORAGE_KEY);
            var parsed = raw ? JSON.parse(raw) : {};
            var defaults = getDefaultUiNavState();

            // Migrate old state format
            if (parsed.coachingSubSectionId && !parsed.myTeamSubSectionId) {
                var migration = OLD_SUB_MIGRATION[parsed.coachingSubSectionId];
                if (migration) {
                    parsed.sectionId = migration.section;
                    parsed[migration.key] = migration.value;
                }
                delete parsed.coachingSubSectionId;
            }

            // Migrate old manage data sub-section
            if (parsed.manageDataSubSectionId && !parsed.settingsSubSectionId) {
                if (parsed.manageDataSubSectionId === 'subSectionTeamData') {
                    parsed.settingsSubSectionId = 'subSectionTeamMembers';
                } else {
                    parsed.settingsSubSectionId = parsed.manageDataSubSectionId;
                }
                delete parsed.manageDataSubSectionId;
            }

            // Migrate old section IDs
            if (parsed.sectionId === 'coachingForm') parsed.sectionId = 'uploadSection';
            if (parsed.sectionId === 'ptoSection') { parsed.sectionId = 'coachingEmailSection'; parsed.myTeamSubSectionId = 'subSectionReliability'; }
            if (parsed.sectionId === 'hotTipSection') parsed.sectionId = 'dashboardSection';
            if (parsed.sectionId === 'teamSnapshotSection') { parsed.sectionId = 'coachingEmailSection'; parsed.myTeamSubSectionId = 'subSectionTeamSnapshot'; }

            return {
                sectionId: typeof parsed.sectionId === 'string' ? parsed.sectionId : defaults.sectionId,
                myTeamSubSectionId: typeof parsed.myTeamSubSectionId === 'string' ? parsed.myTeamSubSectionId : defaults.myTeamSubSectionId,
                trendsSubSectionId: typeof parsed.trendsSubSectionId === 'string' ? parsed.trendsSubSectionId : defaults.trendsSubSectionId,
                reviewPrepSubSectionId: typeof parsed.reviewPrepSubSectionId === 'string' ? parsed.reviewPrepSubSectionId : defaults.reviewPrepSubSectionId,
                settingsSubSectionId: typeof parsed.settingsSubSectionId === 'string' ? parsed.settingsSubSectionId : defaults.settingsSubSectionId
            };
        } catch (error) {
            console.error('Error loading UI nav state:', error);
            return getDefaultUiNavState();
        }
    }

    function saveUiNavState(partialState) {
        if (partialState === undefined) partialState = {};
        try {
            var current = loadUiNavState();
            var next = Object.assign({}, current, partialState);
            localStorage.setItem(UI_NAV_STATE_STORAGE_KEY, JSON.stringify(next));
        } catch (error) {
            console.error('Error saving UI nav state:', error);
        }
    }

    /**
     * Put a sub-section back after a reload.
     *
     * Clicking the tab's own button is the right thing where there is one: the
     * click handler runs the tab's initializer as well as revealing it, and
     * duplicating that here would be a second copy to keep in step.
     *
     * Where there isn't one, the button is shown directly. My Team broke on
     * exactly this — the day hub replaced its nav row, so its saved id mapped
     * to no button and fell through to a default that clicked a *hidden*
     * button, landing on a different screen than the one clicking into the
     * section shows. Falling through to a section's own default is the same bug
     * wearing a different tab's name, so it doesn't happen any more.
     */
    function restoreSub(savedSubId, buttonMap, showFn, defaultSubId, defaultBtnId) {
        var subId = savedSubId || defaultSubId;
        var btnId = buttonMap[subId];
        if (!btnId) {
            // An id from a build that no longer exists, or a tab that has no
            // button of its own. Either way, show the section's default rather
            // than clicking something that belongs to a different tab.
            showFn(defaultSubId, defaultBtnId);
            return;
        }
        var btn = document.getElementById(btnId);
        if (btn) btn.click();
        else showFn(subId, btnId);
    }

    function restoreLastViewedSection() {
        var state = loadUiNavState();
        var sectionId = state.sectionId || 'dashboardSection';

        if (sectionId === 'coachingEmailSection') {
            showOnlySection('coachingEmailSection');
            // The day hub has no sub-nav button — it replaced that row, and the
            // row it replaced is hidden. Its own initializer stands in for the
            // click handler the other tabs get.
            restoreSub(state.myTeamSubSectionId, MY_TEAM_SUB_TO_BTN, function(subId, btnId) {
                showMyTeamSubSection(subId, btnId);
                window.DevCoachModules?.myTeam?.initializeMyTeam?.();
            }, 'subSectionMyTeamDay', 'subNavHighlights');
            return;
        }

        if (sectionId === 'trendsAnalysisSection') {
            showOnlySection('trendsAnalysisSection');
            restoreSub(state.trendsSubSectionId, TRENDS_SUB_TO_BTN, showTrendsSubSection,
                'subSectionTaTrendIntelligence', 'subNavTaIntelligence');
            return;
        }

        if (sectionId === 'reviewPrepSection') {
            showOnlySection('reviewPrepSection');
            restoreSub(state.reviewPrepSubSectionId, REVIEW_SUB_TO_BTN, showReviewPrepSubSection,
                'subSectionOnOffTracker', 'subNavRpScoreCard');
            return;
        }

        if (sectionId === 'manageDataSection') {
            showOnlySection('manageDataSection');
            // Settings pairs button to sub-section by name rather than a map,
            // so its map is derived rather than maintained twice.
            var settingsMap = {};
            SETTINGS_NAV_BUTTONS.forEach(function(id) {
                settingsMap[id.replace('subNav', 'subSection')] = id;
            });
            restoreSub(state.settingsSubSectionId, settingsMap, showManageDataSubSection,
                'subSectionTeamMembers', 'subNavTeamMembers');
            return;
        }

        if (sectionId === 'debugSection') {
            showOnlySection('debugSection');
            if (typeof window.renderDebugPanel === 'function') window.renderDebugPanel();
            return;
        }

        if (sectionId === 'redFlagSection') {
            showOnlySection('redFlagSection');
            return;
        }

        if (sectionId === 'uploadSection') {
            showOnlySection('uploadSection');
            return;
        }

        if (sectionId === 'dashboardSection') {
            showOnlySection('dashboardSection');
            if (typeof window.initializeDashboard === 'function') window.initializeDashboard();
            return;
        }

        // Fallback
        showOnlySection('dashboardSection');
        if (typeof window.initializeDashboard === 'function') window.initializeDashboard();
    }

    function initializeSection(sectionId) {
        switch(sectionId) {
            case 'tipsManagementSection':
                if (typeof window.renderTipsManagement === 'function') window.renderTipsManagement();
                else if (typeof renderTipsManagement === 'function') renderTipsManagement();
                break;
            case 'metricTrendsSection':
                if (typeof window.initializeMetricTrends === 'function') window.initializeMetricTrends();
                else if (typeof initializeMetricTrends === 'function') initializeMetricTrends();
                break;
            case 'manageDataSection':
                if (typeof window.populateDeleteWeekDropdown === 'function') window.populateDeleteWeekDropdown();
                if (typeof window.populateDeleteSentimentDropdown === 'function') window.populateDeleteSentimentDropdown();
                if (typeof window.renderEmployeesList === 'function') window.renderEmployeesList();
                break;
            case 'executiveSummarySection':
                if (typeof window.renderExecutiveSummary === 'function') window.renderExecutiveSummary();
                break;
            case 'debugSection':
                if (typeof window.renderDebugPanel === 'function') window.renderDebugPanel();
                break;
        }
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.navigation = {
        showOnlySection: showOnlySection,
        showSubSection: showSubSection,
        showMyTeamSubSection: showMyTeamSubSection,
        showTrendsSubSection: showTrendsSubSection,
        showReviewPrepSubSection: showReviewPrepSubSection,
        showManageDataSubSection: showManageDataSubSection,
        getDefaultUiNavState: getDefaultUiNavState,
        loadUiNavState: loadUiNavState,
        saveUiNavState: saveUiNavState,
        restoreLastViewedSection: restoreLastViewedSection,
        initializeSection: initializeSection
    };
})();
