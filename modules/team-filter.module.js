/* ========================================
   TEAM FILTER MODULE
   Team member management and filtering logic
   ======================================== */

(function() {
    'use strict';

    // ============================================
    // MODULE STATE
    // ============================================

    let teamFilterChangeHandlersBound = false;

    // ============================================
    // HELPERS - access globals and storage module
    // ============================================

    function getStorage() {
        return window.DevCoachModules?.storage;
    }

    function getMyTeamMembers() {
        const storage = getStorage();
        return storage?.loadTeamMembers?.() || {};
    }

    function getWeeklyData() {
        return getStorage()?.loadWeeklyData?.() || {};
    }

    // ============================================
    // TEAM MEMBER PERSISTENCE
    // ============================================

    function loadTeamMembers() {
        // No-op: getMyTeamMembers() now reads directly from storage each time
    }

    function saveTeamMembers(data) {
        try {
            const toSave = data || getMyTeamMembers();
            const storage = getStorage();
            if (storage?.saveWithSizeCheck) {
                if (!storage.saveWithSizeCheck('myTeamMembers', toSave)) {
                    console.error('Failed to save team members due to size');
                }
            } else if (storage?.saveTeamMembers) {
                storage.saveTeamMembers(toSave);
            }
            if (typeof window.queueRepoSync === 'function') {
                window.queueRepoSync('team members updated');
            }
        } catch (error) {
            console.error('Error saving team members:', error);
        }
    }

    // ============================================
    // TEAM MEMBER ACCESSORS
    // ============================================

    function setTeamMembersForWeek(weekKey, memberNames) {
        var members = getMyTeamMembers();
        members[weekKey] = memberNames;
        saveTeamMembers();
        notifyTeamFilterChanged();
    }

    function getTeamMembersForWeek(weekKey) {
        return getMyTeamMembers()[weekKey] || [];
    }

    function isTeamMember(weekKey, employeeName) {
        var members = getTeamMembersForWeek(weekKey);
        return members.length === 0 || members.includes(employeeName);
    }

    // ============================================
    // WEEK KEY RESOLUTION
    // ============================================

    function getLatestTeamSelectionWeekKey() {
        var weeklyData = getWeeklyData();
        var weekKeys = Object.keys(weeklyData);
        if (!weekKeys.length) return '';

        var getEndTimestamp = function(weekKey) {
            var metadataEnd = String(weeklyData?.[weekKey]?.metadata?.endDate || '').trim();
            var fallbackEnd = String(weekKey || '').split('|')[1] || String(weekKey || '').split('|')[0] || '';
            var candidate = metadataEnd || fallbackEnd;
            var parsed = candidate ? new Date(candidate) : new Date(NaN);
            return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
        };

        return weekKeys.reduce(function(latest, key) {
            if (!latest) return key;
            return getEndTimestamp(key) > getEndTimestamp(latest) ? key : latest;
        }, '');
    }

    function getTeamSelectionWeekKey() {
        var dropdownWeek = String(document.getElementById('deleteWeekSelect')?.value || '').trim();
        var weeklyData = getWeeklyData();
        if (dropdownWeek && weeklyData?.[dropdownWeek]) return dropdownWeek;
        return getLatestTeamSelectionWeekKey();
    }

    // ============================================
    // FILTER CONTEXT & FILTERING
    // ============================================

    function getTeamSelectionContext() {
        var weekKey = getTeamSelectionWeekKey();
        var weeklyData = getWeeklyData();
        var employeesForWeek = Array.isArray(weeklyData?.[weekKey]?.employees)
            ? weeklyData[weekKey].employees.map(function(emp) { return String(emp?.name || '').trim(); }).filter(Boolean)
            : [];
        var selectedMembers = weekKey
            ? getTeamMembersForWeek(weekKey).map(function(name) { return String(name || '').trim(); }).filter(Boolean)
            : [];

        return {
            weekKey: weekKey,
            selectedMembers: selectedMembers,
            selectedSet: selectedMembers.length ? new Set(selectedMembers) : null,
            totalEmployeesInWeek: employeesForWeek.length,
            isFiltering: selectedMembers.length > 0
        };
    }

    function isAssociateIncludedByTeamFilter(employeeName, context) {
        var normalizedName = String(employeeName || '').trim();
        if (!normalizedName) return false;
        var filterContext = context || getTeamSelectionContext();
        if (!filterContext?.isFiltering || !filterContext?.selectedSet) return true;
        return filterContext.selectedSet.has(normalizedName);
    }

    function filterAssociateNamesByTeamSelection(names) {
        var context = getTeamSelectionContext();
        return (Array.isArray(names) ? names : [])
            .map(function(name) { return String(name || '').trim(); })
            .filter(Boolean)
            .filter(function(name) { return isAssociateIncludedByTeamFilter(name, context); });
    }

    // ============================================
    // UI UPDATE
    // ============================================

    function updateTeamFilterStatusChip() {
        var chip = document.getElementById('teamFilterStatusChip');
        if (!chip) return;

        var context = getTeamSelectionContext();
        if (!context.weekKey) {
            chip.textContent = 'Active Team Filter: No weekly data loaded';
            chip.style.background = '#eceff1';
            chip.style.color = '#455a64';
            return;
        }

        var weekLabel = (typeof window.formatWeekLabel === 'function'
            ? window.formatWeekLabel(context.weekKey)
            : context.weekKey) || context.weekKey;

        if (!context.isFiltering) {
            chip.textContent = 'Active Team Filter: All associates \u2022 Week ending ' + weekLabel;
            chip.style.background = '#e8f5e9';
            chip.style.color = '#2e7d32';
            return;
        }

        chip.textContent = 'Active Team Filter: ' + context.selectedMembers.length + ' selected \u2022 Week ending ' + weekLabel;
        chip.style.background = '#fff3e0';
        chip.style.color = '#ef6c00';
    }

    // ============================================
    // EVENT NOTIFICATION & BINDING
    // ============================================

    function notifyTeamFilterChanged() {
        var context = getTeamSelectionContext();
        updateTeamFilterStatusChip();
        window.dispatchEvent(new CustomEvent('devcoach:teamFilterChanged', { detail: context }));
    }

    function bindTeamFilterChangeHandlers() {
        if (teamFilterChangeHandlersBound) return;

        window.addEventListener('devcoach:teamFilterChanged', function() {
            if (typeof window.updateEmployeeDropdown === 'function') window.updateEmployeeDropdown();
            if (typeof window.initializeTrendIntelligence === 'function') window.initializeTrendIntelligence();
            if (typeof window.renderTrendIntelligence === 'function') window.renderTrendIntelligence();
            if (typeof window.renderTrendVisualizations === 'function') window.renderTrendVisualizations();
            if (typeof window.populateTrendPeriodDropdown === 'function') window.populateTrendPeriodDropdown();

            var selectedTrendPeriod = String(document.getElementById('trendPeriodSelect')?.value || '').trim();
            if (selectedTrendPeriod && typeof window.populateEmployeeDropdownForPeriod === 'function') {
                window.populateEmployeeDropdownForPeriod(selectedTrendPeriod);
            }

            if (typeof window.populateExecutiveSummaryAssociate === 'function') window.populateExecutiveSummaryAssociate();
            if (typeof window.populateOneOnOneAssociateSelect === 'function') window.populateOneOnOneAssociateSelect();
            if (typeof window.initializeCoachingEmail === 'function') window.initializeCoachingEmail();
            if (typeof window.initializeYearEndComments === 'function') window.initializeYearEndComments();
            if (typeof window.initializeCallListeningSection === 'function') window.initializeCallListeningSection();
            if (typeof window.initializePtoTracker === 'function') window.initializePtoTracker();
        });

        teamFilterChangeHandlersBound = true;
    }

    // ============================================
    // MODULE EXPORT
    // ============================================

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.teamFilter = {
        loadTeamMembers: loadTeamMembers,
        saveTeamMembers: saveTeamMembers,
        setTeamMembersForWeek: setTeamMembersForWeek,
        getTeamMembersForWeek: getTeamMembersForWeek,
        isTeamMember: isTeamMember,
        getLatestTeamSelectionWeekKey: getLatestTeamSelectionWeekKey,
        getTeamSelectionWeekKey: getTeamSelectionWeekKey,
        getTeamSelectionContext: getTeamSelectionContext,
        isAssociateIncludedByTeamFilter: isAssociateIncludedByTeamFilter,
        filterAssociateNamesByTeamSelection: filterAssociateNamesByTeamSelection,
        updateTeamFilterStatusChip: updateTeamFilterStatusChip,
        notifyTeamFilterChanged: notifyTeamFilterChanged,
        bindTeamFilterChangeHandlers: bindTeamFilterChangeHandlers
    };

    // Maintain backward compatibility with existing global references
    window.getTeamSelectionContext = getTeamSelectionContext;
    window.isAssociateIncludedByTeamFilter = isAssociateIncludedByTeamFilter;

})();
