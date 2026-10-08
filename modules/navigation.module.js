(function() {
    'use strict';

    var STORAGE_PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    var UI_NAV_STATE_STORAGE_KEY = STORAGE_PREFIX + 'uiNavState';

    // The app is three questions plus two utilities (2026-10-07):
    //   Today  - the team right now (the old My Team section, still
    //            coachingEmailSection, with the Dashboard and Contest under it)
    //   People - one associate, everything about them
    //   Center - the call center as a whole (the old Trends section, still
    //            trendsAnalysisSection)
    //   Upload, Settings
    // The old Dashboard, Review Prep, Follow Up and Contest sections are gone
    // from the nav. A saved state naming one of them is rewritten on load, see
    // migrateToCondensedLayout. The layout before this is recorded in
    // audit/2026-10-07-layout-before-condense.md.

    // CSS uses .top-nav-btn[style*="gradient"] to style the active top-nav
    // button, so toggling the active state means moving an inline gradient
    // from one button to another.
    var SECTION_TO_TOP_NAV_BTN = {
        coachingEmailSection: 'coachingEmailBtn',
        peopleSection: 'peopleBtn',
        trendsAnalysisSection: 'trendsAnalysisBtn',
        uploadSection: 'homeBtn',
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
                    btn.style.color = 'white';
                    btn.style.opacity = '1';
                } else {
                    btn.style.background = '#ccc';
                    btn.style.color = '';
                    btn.style.opacity = '0.7';
                }
            }
        });

        // Save state
        var partial = {};
        partial[stateKey] = subSectionId;
        saveUiNavState(partial);
    }

    // --- Today (the old My Team section) ---

    var MY_TEAM_SUB_SECTIONS = ['subSectionMyTeamDay', 'subSectionTodayYear', 'subSectionTeamSnapshot', 'subSectionTodayContest'];
    var MY_TEAM_NAV_BUTTONS = ['subNavTdDay', 'subNavTdYear', 'subNavTdSnapshot', 'subNavTdContest'];
    var MY_TEAM_SUB_TO_BTN = {
        subSectionMyTeamDay: 'subNavTdDay',
        subSectionTodayYear: 'subNavTdYear',
        subSectionTeamSnapshot: 'subNavTdSnapshot',
        subSectionTodayContest: 'subNavTdContest'
    };

    function showMyTeamSubSection(subSectionId, activeButtonId) {
        var btnId = activeButtonId || MY_TEAM_SUB_TO_BTN[subSectionId] || '';
        showSubSectionGeneric(subSectionId, btnId, MY_TEAM_SUB_SECTIONS, MY_TEAM_NAV_BUTTONS,
            'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 'myTeamSubSectionId');
        saveUiNavState({ sectionId: 'coachingEmailSection' });
        // The team bar sits above the sub-nav and belongs to Today as a
        // whole, so it's drawn here rather than by each tab's own handler,
        // including on the refresh path that restores a tab directly.
        window.DevCoachModules?.teamHub?.initializeTeamHub?.();
        // Returning to the day hub re-renders it; leaving it is a no-op.
        if (subSectionId === 'subSectionMyTeamDay') window.DevCoachModules?.myTeam?.renderDayPage?.();
    }

    // --- People: one associate ---

    // Numbers is the Score Card. Coach, Calls and Attendance are the panels
    // that used to hang off My Team. All four are moved into #peopleContent on
    // first open by script.js ensurePeopleMounted. Follow Up and Reviews live
    // in the People section's own markup.
    var PEOPLE_SUB_SECTIONS = ['subSectionOnOffTracker', 'subSectionCoachingEmail', 'subSectionCallListening', 'subSectionReliability', 'subSectionFollowUp', 'subSectionReviews'];
    var PEOPLE_NAV_BUTTONS = ['subNavPeNumbers', 'subNavPeCoach', 'subNavPeCalls', 'subNavPeAttendance', 'subNavPeFollowUp', 'subNavPeReviews'];
    var PEOPLE_SUB_TO_BTN = {
        subSectionOnOffTracker: 'subNavPeNumbers',
        subSectionCoachingEmail: 'subNavPeCoach',
        subSectionCallListening: 'subNavPeCalls',
        subSectionReliability: 'subNavPeAttendance',
        subSectionFollowUp: 'subNavPeFollowUp',
        subSectionReviews: 'subNavPeReviews'
    };

    function showPeopleSubSection(subSectionId, activeButtonId) {
        var btnId = activeButtonId || PEOPLE_SUB_TO_BTN[subSectionId] || 'subNavPeNumbers';
        showSubSectionGeneric(subSectionId, btnId, PEOPLE_SUB_SECTIONS, PEOPLE_NAV_BUTTONS,
            'linear-gradient(135deg, #5c6bc0 0%, #3949ab 100%)', 'peopleSubSectionId');
        saveUiNavState({ sectionId: 'peopleSection' });
    }

    // --- Reviews, inside People (the old Review Prep section) ---

    var REVIEW_SUB_SECTIONS = ['subSectionMeetings', 'subSectionQ1Review', 'subSectionMidYear', 'subSectionYearEnd'];
    var REVIEW_NAV_BUTTONS = ['subNavRpMeetings', 'subNavRpQuarterly', 'subNavRpMidYear', 'subNavRpYearEnd'];
    var REVIEW_SUB_TO_BTN = {
        subSectionMeetings: 'subNavRpMeetings',
        subSectionQ1Review: 'subNavRpQuarterly',
        subSectionMidYear: 'subNavRpMidYear',
        subSectionYearEnd: 'subNavRpYearEnd'
    };

    function showReviewPrepSubSection(subSectionId, activeButtonId) {
        var btnId = activeButtonId || REVIEW_SUB_TO_BTN[subSectionId] || 'subNavRpQuarterly';
        showSubSectionGeneric(subSectionId, btnId, REVIEW_SUB_SECTIONS, REVIEW_NAV_BUTTONS,
            'linear-gradient(135deg, #d84315 0%, #bf360c 100%)', 'reviewPrepSubSectionId');
        saveUiNavState({ sectionId: 'peopleSection', peopleSubSectionId: 'subSectionReviews' });
    }

    // --- Center (the old Trends section) ---

    var TRENDS_SUB_SECTIONS = ['subSectionTaCenterRanking', 'subSectionTaMatchup', 'subSectionTaFutures', 'subSectionTaTrendsGroup', 'subSectionTaTrendIntelligence'];
    var TRENDS_NAV_BUTTONS = ['subNavTaRankings', 'subNavTaMatchup', 'subNavTaFutures', 'subNavTaMetricCharts', 'subNavTaIntelligence'];
    var TRENDS_SUB_TO_BTN = {
        subSectionTaCenterRanking: 'subNavTaRankings',
        subSectionTaMatchup: 'subNavTaMatchup',
        subSectionTaFutures: 'subNavTaFutures',
        subSectionTaTrendsGroup: 'subNavTaMetricCharts',
        subSectionTaTrendIntelligence: 'subNavTaIntelligence'
    };

    function showTrendsSubSection(subSectionId, activeButtonId) {
        var btnId = activeButtonId || TRENDS_SUB_TO_BTN[subSectionId] || 'subNavTaRankings';
        showSubSectionGeneric(subSectionId, btnId, TRENDS_SUB_SECTIONS, TRENDS_NAV_BUTTONS,
            'linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%)', 'trendsSubSectionId');
        saveUiNavState({ sectionId: 'trendsAnalysisSection' });
    }

    // The Trends tab inside Center holds the four views that used to be tabs
    // of their own.
    // Sentiment was a fourth view here until 2026-10-08. It could not run, and
    // its summary is written in the sentiment upload window now.
    var TRENDS_INNER_SUB_SECTIONS = ['subSectionTaMetricTrends', 'subSectionTaYoY', 'subSectionTaPatterns'];
    var TRENDS_INNER_NAV_BUTTONS = ['innerNavTrReports', 'innerNavTrYoY', 'innerNavTrPatterns'];
    var TRENDS_INNER_SUB_TO_BTN = {
        subSectionTaMetricTrends: 'innerNavTrReports',
        subSectionTaYoY: 'innerNavTrYoY',
        subSectionTaPatterns: 'innerNavTrPatterns'
    };

    function showTrendsInnerSubSection(subSectionId, activeButtonId) {
        var btnId = activeButtonId || TRENDS_INNER_SUB_TO_BTN[subSectionId] || 'innerNavTrReports';
        showSubSectionGeneric(subSectionId, btnId, TRENDS_INNER_SUB_SECTIONS, TRENDS_INNER_NAV_BUTTONS,
            'linear-gradient(135deg, #8e24aa 0%, #6a1b9a 100%)', 'trendsInnerSubSectionId');
        saveUiNavState({ sectionId: 'trendsAnalysisSection', trendsSubSectionId: 'subSectionTaTrendsGroup' });
    }

    // --- Settings (Manage Data) sub-sections ---

    // subSectionSentimentKeywords was built, populated on load and wired to a
    // working save button, but was never added here and had no nav button, so
    // it sat in a div nothing ever showed. The phrase lists were editable in
    // every respect except reachable.
    var SETTINGS_SUB_SECTIONS = ['subSectionTeamMembers', 'subSectionCoachingTips', 'subSectionSentimentKeywords', 'subSectionSyncBackup', 'subSectionDeleteData'];
    var SETTINGS_NAV_BUTTONS = ['subNavTeamMembers', 'subNavCoachingTips', 'subNavSentimentKeywords', 'subNavSyncBackup', 'subNavDeleteData'];

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

    // --- State management ---

    function getDefaultUiNavState() {
        return {
            sectionId: 'coachingEmailSection',
            myTeamSubSectionId: 'subSectionMyTeamDay',
            peopleSubSectionId: 'subSectionOnOffTracker',
            reviewPrepSubSectionId: 'subSectionQ1Review',
            trendsSubSectionId: 'subSectionTaCenterRanking',
            trendsInnerSubSectionId: 'subSectionTaMetricTrends',
            settingsSubSectionId: 'subSectionTeamMembers'
        };
    }

    // Migration map: old coachingSubSectionId → { sectionId, subKey, subValue }.
    // These name the layout before the 2026-04 reorg; migrateToCondensedLayout
    // then carries the result into the 2026-10 layout.
    var OLD_SUB_MIGRATION = {
        subSectionCoachingEmail:    { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionCoachingEmail' },
        subSectionTeamSnapshot:     { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionTeamSnapshot' },
        subSectionCallListening:    { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionCallListening' },
        subSectionMorningPulse:     { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionMyTeamDay' },
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
        subSectionTrends:           { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionMyTeamDay' },
        subSectionReviewPrep:       { section: 'reviewPrepSection', key: 'reviewPrepSubSectionId', value: 'subSectionQ1Review' },
        subSectionMoreTools:        { section: 'coachingEmailSection', key: 'myTeamSubSectionId', value: 'subSectionMyTeamDay' }
    };

    // My Team panels that now belong to People.
    var MY_TEAM_TO_PEOPLE = {
        subSectionCoachingEmail: true,
        subSectionCallListening: true,
        subSectionReliability: true
    };

    /**
     * Carry a state saved under the old eight-item nav into Today / People /
     * Center, so a refresh after the change lands on the same panel rather
     * than on a section that no longer has a button.
     *
     * Runs on every load. Each rule only fires on a value the new layout
     * never writes, so a state that is already new passes through untouched.
     */
    function migrateToCondensedLayout(parsed) {
        // Review Prep is People > Reviews, except Score Card, which is People > Numbers.
        if (parsed.reviewPrepSubSectionId === 'subSectionOnOffTracker') {
            if (parsed.sectionId === 'reviewPrepSection') {
                parsed.sectionId = 'peopleSection';
                parsed.peopleSubSectionId = 'subSectionOnOffTracker';
            }
            delete parsed.reviewPrepSubSectionId;
        }
        if (parsed.sectionId === 'reviewPrepSection') {
            parsed.sectionId = 'peopleSection';
            parsed.peopleSubSectionId = 'subSectionReviews';
        }

        // Follow Up is People > Follow Up.
        if (parsed.sectionId === 'redFlagSection' || parsed.sectionId === 'followUpSection') {
            parsed.sectionId = 'peopleSection';
            parsed.peopleSubSectionId = 'subSectionFollowUp';
        }

        // The Dashboard is Today. Its contents are Today > Year to date, but
        // Today opens on the day page, as the Dashboard button used to open
        // the first thing you look at.
        if (parsed.sectionId === 'dashboardSection') {
            parsed.sectionId = 'coachingEmailSection';
            parsed.myTeamSubSectionId = 'subSectionMyTeamDay';
        }

        // Contest is Today > Contest.
        if (parsed.sectionId === 'contestSection') {
            parsed.sectionId = 'coachingEmailSection';
            parsed.myTeamSubSectionId = 'subSectionTodayContest';
        }

        // Coaching, Calls and Attendance left My Team for People.
        if (MY_TEAM_TO_PEOPLE[parsed.myTeamSubSectionId]) {
            if (parsed.sectionId === 'coachingEmailSection') {
                parsed.sectionId = 'peopleSection';
                parsed.peopleSubSectionId = parsed.myTeamSubSectionId;
            }
            parsed.myTeamSubSectionId = 'subSectionMyTeamDay';
        }

        // Metric Charts, Year-over-Year, Patterns and Sentiment are views
        // inside Center > Trends.
        if (TRENDS_INNER_SUB_TO_BTN[parsed.trendsSubSectionId]) {
            parsed.trendsInnerSubSectionId = parsed.trendsSubSectionId;
            parsed.trendsSubSectionId = 'subSectionTaTrendsGroup';
        }
        return parsed;
    }

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

            migrateToCondensedLayout(parsed);

            var pick = function(key) {
                return typeof parsed[key] === 'string' ? parsed[key] : defaults[key];
            };
            return {
                sectionId: pick('sectionId'),
                myTeamSubSectionId: pick('myTeamSubSectionId'),
                peopleSubSectionId: pick('peopleSubSectionId'),
                reviewPrepSubSectionId: pick('reviewPrepSubSectionId'),
                trendsSubSectionId: pick('trendsSubSectionId'),
                trendsInnerSubSectionId: pick('trendsInnerSubSectionId'),
                settingsSubSectionId: pick('settingsSubSectionId')
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
     * exactly this: the day hub replaced its nav row, so its saved id mapped
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
            var defaultBtn = defaultBtnId && document.getElementById(defaultBtnId);
            if (defaultBtn) defaultBtn.click();
            else showFn(defaultSubId, defaultBtnId);
            return;
        }
        var btn = document.getElementById(btnId);
        if (btn) btn.click();
        else showFn(subId, btnId);
    }

    // The tabs that hold tabs of their own reopen on the inner view you left.
    // script.js calls these from the outer tab's click handler.

    function restorePeopleTab() {
        restoreSub(loadUiNavState().peopleSubSectionId, PEOPLE_SUB_TO_BTN, showPeopleSubSection,
            'subSectionOnOffTracker', 'subNavPeNumbers');
    }

    function restoreReviewsTab() {
        restoreSub(loadUiNavState().reviewPrepSubSectionId, REVIEW_SUB_TO_BTN, showReviewPrepSubSection,
            'subSectionQ1Review', 'subNavRpQuarterly');
    }

    function restoreCenterTab() {
        restoreSub(loadUiNavState().trendsSubSectionId, TRENDS_SUB_TO_BTN, showTrendsSubSection,
            'subSectionTaCenterRanking', 'subNavTaRankings');
    }

    function restoreTrendsInnerTab() {
        restoreSub(loadUiNavState().trendsInnerSubSectionId, TRENDS_INNER_SUB_TO_BTN, showTrendsInnerSubSection,
            'subSectionTaMetricTrends', 'innerNavTrReports');
    }

    function restoreLastViewedSection() {
        var state = loadUiNavState();
        var sectionId = state.sectionId || 'coachingEmailSection';

        if (sectionId === 'coachingEmailSection') {
            showOnlySection('coachingEmailSection');
            restoreSub(state.myTeamSubSectionId, MY_TEAM_SUB_TO_BTN, function(subId, btnId) {
                showMyTeamSubSection(subId, btnId);
                window.DevCoachModules?.myTeam?.initializeMyTeam?.();
            }, 'subSectionMyTeamDay', 'subNavTdDay');
            return;
        }

        if (sectionId === 'peopleSection') {
            // The People button reopens the tab you left, the same way a click does.
            var peopleBtn = document.getElementById('peopleBtn');
            if (peopleBtn) {
                peopleBtn.click();
                return;
            }
            showOnlySection('peopleSection');
            restorePeopleTab();
            return;
        }

        if (sectionId === 'trendsAnalysisSection') {
            showOnlySection('trendsAnalysisSection');
            restoreCenterTab();
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

        if (sectionId === 'uploadSection') {
            // Through the button, which also fills the center averages panel.
            var uploadBtn = document.getElementById('homeBtn');
            if (uploadBtn) uploadBtn.click();
            else showOnlySection('uploadSection');
            return;
        }

        // Fallback: Today, the landing page.
        var todayBtn = document.getElementById('coachingEmailBtn');
        if (todayBtn) todayBtn.click();
        else showOnlySection('coachingEmailSection');
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.navigation = {
        showOnlySection: showOnlySection,
        showMyTeamSubSection: showMyTeamSubSection,
        showPeopleSubSection: showPeopleSubSection,
        showTrendsSubSection: showTrendsSubSection,
        showTrendsInnerSubSection: showTrendsInnerSubSection,
        showReviewPrepSubSection: showReviewPrepSubSection,
        showManageDataSubSection: showManageDataSubSection,
        restorePeopleTab: restorePeopleTab,
        restoreReviewsTab: restoreReviewsTab,
        restoreCenterTab: restoreCenterTab,
        restoreTrendsInnerTab: restoreTrendsInnerTab,
        getDefaultUiNavState: getDefaultUiNavState,
        loadUiNavState: loadUiNavState,
        saveUiNavState: saveUiNavState,
        restoreLastViewedSection: restoreLastViewedSection,
    };
})();
