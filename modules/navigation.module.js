(function() {
    'use strict';

    var STORAGE_PREFIX = 'devCoachingTool_';
    var UI_NAV_STATE_STORAGE_KEY = STORAGE_PREFIX + 'uiNavState';

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
    }

    /**
     * Show a specific sub-section within the Coaching & Analysis section
     */
    function showSubSection(subSectionId, activeButtonId) {
        if (activeButtonId === undefined) activeButtonId = null;

        // Hide all sub-sections
        var subSections = ['subSectionCoachingEmail', 'subSectionYearEnd', 'subSectionOnOffTracker', 'subSectionSentiment', 'subSectionMetricTrends', 'subSectionTrendIntelligence', 'subSectionCallListening'];
        subSections.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Show the specified sub-section
        var targetSubSection = document.getElementById(subSectionId);
        if (targetSubSection) {
            targetSubSection.style.display = 'block';
        }

        // Update sub-nav button active states
        var subNavButtons = ['subNavCoachingEmail', 'subNavYearEnd', 'subNavOnOffTracker', 'subNavSentiment', 'subNavMetricTrends', 'subNavTrendIntelligence', 'subNavCallListening'];
        var selectedSubNavButton = activeButtonId || (
            subSectionId === 'subSectionCoachingEmail' ? 'subNavCoachingEmail'
                : subSectionId === 'subSectionYearEnd' ? 'subNavYearEnd'
                    : subSectionId === 'subSectionOnOffTracker' ? 'subNavOnOffTracker'
                    : subSectionId === 'subSectionSentiment' ? 'subNavSentiment'
                        : subSectionId === 'subSectionMetricTrends' ? 'subNavMetricTrends'
                            : subSectionId === 'subSectionTrendIntelligence' ? 'subNavTrendIntelligence'
                                : subSectionId === 'subSectionCallListening' ? 'subNavCallListening'
                                : ''
        );

        subNavButtons.forEach(function(btnId) {
            var btn = document.getElementById(btnId);
            if (btn) {
                if (btnId === selectedSubNavButton) {
                    btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                    btn.style.opacity = '1';
                } else {
                    btn.style.background = '#ccc';
                    btn.style.opacity = '0.7';
                }
            }
        });

        saveUiNavState({
            sectionId: 'coachingEmailSection',
            coachingSubSectionId: subSectionId
        });
    }

    /**
     * Show a specific sub-section within the Manage Data section
     */
    function showManageDataSubSection(subSectionId) {
        // Hide all sub-sections
        var subSections = ['subSectionTeamData', 'subSectionCoachingTips', 'subSectionSentimentKeywords'];
        subSections.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Show the specified sub-section
        var targetSubSection = document.getElementById(subSectionId);
        if (targetSubSection) {
            targetSubSection.style.display = 'block';
        }

        // Update sub-nav button active states
        var subNavButtons = ['subNavTeamData', 'subNavCoachingTips', 'subNavSentimentKeywords'];
        subNavButtons.forEach(function(btnId) {
            var btn = document.getElementById(btnId);
            if (btn) {
                if (btnId.replace('subNav', 'subSection') === subSectionId) {
                    btn.style.background = 'linear-gradient(135deg, #ff9800 0%, #ff5722 100%)';
                    btn.style.opacity = '1';
                } else {
                    btn.style.background = '#ccc';
                    btn.style.opacity = '0.7';
                }
            }
        });

        saveUiNavState({
            sectionId: 'manageDataSection',
            manageDataSubSectionId: subSectionId
        });
    }

    function getDefaultUiNavState() {
        return {
            sectionId: 'coachingForm',
            coachingSubSectionId: 'subSectionCoachingEmail',
            manageDataSubSectionId: 'subSectionTeamData'
        };
    }

    function loadUiNavState() {
        try {
            var raw = localStorage.getItem(UI_NAV_STATE_STORAGE_KEY);
            var parsed = raw ? JSON.parse(raw) : {};
            var defaults = getDefaultUiNavState();
            return {
                sectionId: typeof parsed?.sectionId === 'string' ? parsed.sectionId : defaults.sectionId,
                coachingSubSectionId: typeof parsed?.coachingSubSectionId === 'string' ? parsed.coachingSubSectionId : defaults.coachingSubSectionId,
                manageDataSubSectionId: typeof parsed?.manageDataSubSectionId === 'string' ? parsed.manageDataSubSectionId : defaults.manageDataSubSectionId
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

    function restoreLastViewedSection() {
        var state = loadUiNavState();
        var sectionId = state.sectionId || 'coachingForm';

        var coachingSubSectionToButton = {
            subSectionCoachingEmail: 'subNavCoachingEmail',
            subSectionYearEnd: 'subNavYearEnd',
            subSectionOnOffTracker: 'subNavOnOffTracker',
            subSectionSentiment: 'subNavSentiment',
            subSectionMetricTrends: 'subNavMetricTrends',
            subSectionTrendIntelligence: 'subNavTrendIntelligence',
            subSectionCallListening: 'subNavCallListening'
        };

        var manageDataSubSectionToButton = {
            subSectionTeamData: 'subNavTeamData',
            subSectionCoachingTips: 'subNavCoachingTips',
            subSectionSentimentKeywords: 'subNavSentimentKeywords'
        };

        if (sectionId === 'coachingEmailSection') {
            showOnlySection('coachingEmailSection');
            var coachingSubId = state.coachingSubSectionId || 'subSectionCoachingEmail';
            var coachingBtnId = coachingSubSectionToButton[coachingSubId] || 'subNavCoachingEmail';
            var coachingBtn = document.getElementById(coachingBtnId);
            if (coachingBtn) coachingBtn.click();
            return;
        }

        if (sectionId === 'manageDataSection') {
            showOnlySection('manageDataSection');
            var manageSubId = state.manageDataSubSectionId || 'subSectionTeamData';
            var manageBtnId = manageDataSubSectionToButton[manageSubId] || 'subNavTeamData';
            var manageBtn = document.getElementById(manageBtnId);
            if (manageBtn) manageBtn.click();
            return;
        }

        if (sectionId === 'debugSection') {
            showOnlySection('debugSection');
            if (typeof window.renderDebugPanel === 'function') {
                window.renderDebugPanel();
            } else if (typeof renderDebugPanel === 'function') {
                renderDebugPanel();
            }
            return;
        }

        if (sectionId === 'redFlagSection') {
            showOnlySection('redFlagSection');
            return;
        }

        if (sectionId === 'ptoSection') {
            showOnlySection('ptoSection');
            if (typeof window.initializePtoTracker === 'function') {
                window.initializePtoTracker();
            } else if (typeof initializePtoTracker === 'function') {
                initializePtoTracker();
            }
            return;
        }

        if (sectionId === 'hotTipSection') {
            showOnlySection('hotTipSection');
            if (typeof window.initializeHotTip === 'function') {
                window.initializeHotTip();
            } else if (typeof initializeHotTip === 'function') {
                initializeHotTip();
            }
            return;
        }

        showOnlySection('coachingForm');
        initializeSection('coachingForm');
    }

    /**
     * Initialize the content of a section when it's shown
     */
    function initializeSection(sectionId) {
        switch(sectionId) {
            case 'tipsManagementSection':
                if (typeof window.renderTipsManagement === 'function') {
                    window.renderTipsManagement();
                } else if (typeof renderTipsManagement === 'function') {
                    renderTipsManagement();
                }
                break;
            case 'metricTrendsSection':
                if (typeof window.initializeMetricTrends === 'function') {
                    window.initializeMetricTrends();
                } else if (typeof initializeMetricTrends === 'function') {
                    initializeMetricTrends();
                }
                break;
            case 'manageDataSection':
                console.log('🔧 Initializing Manage Data section');
                if (typeof window.populateDeleteWeekDropdown === 'function') {
                    window.populateDeleteWeekDropdown();
                } else if (typeof populateDeleteWeekDropdown === 'function') {
                    populateDeleteWeekDropdown();
                }
                if (typeof window.populateDeleteSentimentDropdown === 'function') {
                    window.populateDeleteSentimentDropdown();
                } else if (typeof populateDeleteSentimentDropdown === 'function') {
                    populateDeleteSentimentDropdown();
                }
                if (typeof window.renderEmployeesList === 'function') {
                    window.renderEmployeesList();
                } else if (typeof renderEmployeesList === 'function') {
                    renderEmployeesList();
                }
                break;
            case 'executiveSummarySection':
                if (typeof window.renderExecutiveSummary === 'function') {
                    window.renderExecutiveSummary();
                } else if (typeof renderExecutiveSummary === 'function') {
                    renderExecutiveSummary();
                }
                break;
            case 'debugSection':
                if (typeof window.renderDebugPanel === 'function') {
                    window.renderDebugPanel();
                } else if (typeof renderDebugPanel === 'function') {
                    renderDebugPanel();
                }
                break;
        }
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.navigation = {
        showOnlySection: showOnlySection,
        showSubSection: showSubSection,
        showManageDataSubSection: showManageDataSubSection,
        getDefaultUiNavState: getDefaultUiNavState,
        loadUiNavState: loadUiNavState,
        saveUiNavState: saveUiNavState,
        restoreLastViewedSection: restoreLastViewedSection,
        initializeSection: initializeSection
    };
})();
