(function () {
    'use strict';

    /**
     * TEAM SCOPE
     *
     * Who on my team am I working with right now — everyone, or one person.
     *
     * The roster is the team list the tool has always kept (Settings › Team
     * Members, falling back to the default 18). This does not reach for the
     * supervisor map: My Team means my team, not a picker for the whole floor.
     *
     * Picking a person here narrows every My Team tab, because team-filter
     * folds the scope into the context those tabs already consult.
     */

    const PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    const ACTIVE_MEMBER_KEY = PREFIX + 'activeTeamMember';

    const ALL_MEMBERS_ID = '__all__';

    /**
     * The people the dropdown offers: my team, narrowed to whoever actually
     * shows up in the uploads.
     *
     * Before anything is uploaded there is nothing to narrow against, so the
     * team list stands on its own — an empty dropdown on a fresh install would
     * look broken rather than empty.
     */
    function buildRoster(teamMemberNames, knownEmployeeNames) {
        const team = Array.from(new Set((teamMemberNames || [])
            .map(name => String(name || '').trim())
            .filter(Boolean)));
        const known = new Set((knownEmployeeNames || [])
            .map(name => String(name || '').trim())
            .filter(Boolean));

        const roster = known.size ? team.filter(name => known.has(name)) : team;
        return roster.sort((a, b) => a.localeCompare(b));
    }

    /**
     * A stored name that has left the team falls back to "everyone" rather than
     * scoping the app to a person who isn't there — that reads as "no data"
     * everywhere at once, which hides the real cause.
     */
    function resolveActiveMember(roster, storedId) {
        if (!storedId || storedId === ALL_MEMBERS_ID) return null;
        return (roster || []).indexOf(storedId) > -1 ? storedId : null;
    }

    // --- Data access ---

    function getMyTeamNames() {
        const filter = window.DevCoachModules?.teamFilter;
        if (!filter?.getTeamMembersForWeek) return [];
        const weekKey = filter.getTeamSelectionWeekKey ? filter.getTeamSelectionWeekKey() : '';
        return filter.getTeamMembersForWeek(weekKey) || [];
    }

    // Everyone the tool has seen, across every store — a rep who only appears
    // in daily uploads should still be selectable.
    function getKnownEmployeeNames() {
        const storage = window.DevCoachModules?.storage;
        const stores = [
            (typeof window.weeklyData === 'object' && window.weeklyData) || storage?.loadWeeklyData?.() || {},
            (typeof window.ytdData === 'object' && window.ytdData) || storage?.loadYtdData?.() || {},
            (typeof window.dailyData === 'object' && window.dailyData) || storage?.loadDailyData?.() || {}
        ];

        const names = new Set();
        stores.forEach(store => {
            Object.keys(store || {}).forEach(key => {
                (store[key]?.employees || []).forEach(emp => {
                    const name = String(emp?.name || '').trim();
                    if (name) names.add(name);
                });
            });
        });
        return Array.from(names);
    }

    function getMyTeamRoster() {
        return buildRoster(getMyTeamNames(), getKnownEmployeeNames());
    }

    function getActiveMemberId() {
        try {
            return localStorage.getItem(ACTIVE_MEMBER_KEY) || ALL_MEMBERS_ID;
        } catch (e) {
            return ALL_MEMBERS_ID;
        }
    }

    function setActiveMemberId(memberId) {
        try {
            localStorage.setItem(ACTIVE_MEMBER_KEY, memberId || ALL_MEMBERS_ID);
        } catch (e) { /* storage blocked — the pick just won't persist */ }
    }

    function getActiveMember() {
        return resolveActiveMember(getMyTeamRoster(), getActiveMemberId());
    }

    /**
     * The names the rest of the app should narrow to, or null for "don't
     * narrow". Null and "every name" are deliberately different — team-filter
     * needs to tell "no scope" from "a scope that happens to be everyone".
     */
    function getScopeMembers() {
        const member = getActiveMember();
        return member ? [member] : null;
    }

    // What the scope is, for the context to report. Null means everyone.
    function getActiveScope() {
        const member = getActiveMember();
        return member ? { id: member, label: member } : null;
    }

    function isInScope(employeeName) {
        const member = getActiveMember();
        if (!member) return true;
        return String(employeeName || '').trim() === member;
    }

    function describeScope() {
        const member = getActiveMember();
        if (member) return { label: member, memberCount: 1, isAll: false };
        const roster = getMyTeamRoster();
        return { label: 'All of my team', memberCount: roster.length, isAll: true };
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.teamScope = {
        ALL_MEMBERS_ID,
        buildRoster,
        resolveActiveMember,
        getMyTeamNames,
        getKnownEmployeeNames,
        getMyTeamRoster,
        getActiveMemberId,
        setActiveMemberId,
        getActiveMember,
        getScopeMembers,
        getActiveScope,
        isInScope,
        describeScope
    };
})();
