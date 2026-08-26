(function () {
    'use strict';

    /**
     * TEAM SCOPE
     *
     * Who on my team am I working with right now — everyone, or one person.
     *
     * The roster comes from the supervisor assignments — my team is whoever
     * reports to me — with the old Settings tick-list kept only as a fallback
     * for installs that have no roster yet. It used to be the other way round,
     * and the two lists disagreed.
     *
     * Picking a person here narrows every My Team tab, because team-filter
     * folds the scope into the context those tabs already consult.
     */

    const PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    const ACTIVE_MEMBER_KEY = PREFIX + 'activeTeamMember';
    const MY_LABEL_KEY = PREFIX + 'mySupervisorLabel';
    const SUPERVISORS_KEY = PREFIX + 'employeeSupervisors';

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

    // --- Who am I, and therefore who is my team ---

    /**
     * "My team" had two definitions that disagreed: the tick-list in Settings,
     * and the supervisor roster. They returned different people — which is how
     * the head-to-head ended up showing "My Team (8)" against "Scott (10)" in
     * the same table, both of them me.
     *
     * The supervisor roster wins. It is re-read from the source system, it
     * re-applies on every load, and it is the thing that moves when somebody
     * changes team. The tick-list survives only as a fallback for installs that
     * have no roster yet.
     */
    function getSupervisorMap() {
        try {
            return JSON.parse(localStorage.getItem(SUPERVISORS_KEY) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    /**
     * Which supervisor label is me: whichever one's people overlap my existing
     * team list most. Returns null when nothing overlaps, rather than claiming
     * a colleague's team.
     */
    function resolveMyLabel(supervisorMap, roster) {
        const map = supervisorMap || {};
        const mine = new Set((roster || []).map(n => String(n || '').trim()).filter(Boolean));
        if (!mine.size) return null;

        const counts = {};
        Object.keys(map).forEach(name => {
            if (!mine.has(name)) return;
            const label = String(map[name] || '').trim();
            if (!label) return;
            counts[label] = (counts[label] || 0) + 1;
        });

        let best = null;
        let bestCount = 0;
        Object.keys(counts).forEach(label => {
            // Ties break alphabetically so the answer is stable across reloads.
            if (counts[label] > bestCount || (counts[label] === bestCount && best && label < best)) {
                bestCount = counts[label];
                best = label;
            }
        });
        return bestCount > 0 ? best : null;
    }

    function getMyLabel() {
        try {
            const saved = localStorage.getItem(MY_LABEL_KEY);
            if (saved) return saved;
        } catch (e) { /* fall through to inference */ }

        const inferred = resolveMyLabel(getSupervisorMap(), legacyTeamNames());
        if (inferred) setMyLabel(inferred);
        return inferred;
    }

    function setMyLabel(label) {
        try {
            if (label) localStorage.setItem(MY_LABEL_KEY, label);
            else localStorage.removeItem(MY_LABEL_KEY);
        } catch (e) { /* selection just will not persist */ }
    }

    function membersUnderMe() {
        const label = getMyLabel();
        if (!label) return [];
        const map = getSupervisorMap();
        return Object.keys(map).filter(name => String(map[name] || '').trim() === label);
    }

    // The old tick-list. Still read, but only when the roster cannot answer.
    function legacyTeamNames() {
        const filter = window.DevCoachModules?.teamFilter;
        if (!filter?.getTeamMembersForWeek) return [];
        const weekKey = filter.getTeamSelectionWeekKey ? filter.getTeamSelectionWeekKey() : '';
        return filter.getTeamMembersForWeek(weekKey) || [];
    }

    // --- Data access ---

    function getMyTeamNames() {
        const fromRoster = membersUnderMe();
        return fromRoster.length ? fromRoster : legacyTeamNames();
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

    /**
     * Where the roster came from, so a surprising headcount explains itself.
     *
     * The supervisor roster is the real answer; the saved tick-list is only a
     * fallback for when it cannot be resolved. Those two can produce different
     * numbers, and a silently smaller team with no reason given is exactly the
     * confusion this whole consolidation was meant to end.
     */
    function rosterSource() {
        const label = getMyLabel();
        if (label && membersUnderMe().length) {
            return { source: 'roster', label, note: `from ${label}'s roster` };
        }
        return {
            source: 'saved-list',
            label: label || null,
            note: label
                ? `from your saved list. No one is assigned to ${label} yet`
                : 'from your saved list. No supervisor roster matched'
        };
    }

    function describeScope() {
        const member = getActiveMember();
        if (member) return { label: member, memberCount: 1, isAll: false, source: rosterSource() };
        const roster = getMyTeamRoster();
        return { label: 'All of my team', memberCount: roster.length, isAll: true, source: rosterSource() };
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.teamScope = {
        ALL_MEMBERS_ID,
        MY_LABEL_KEY,
        getSupervisorMap,
        resolveMyLabel,
        getMyLabel,
        setMyLabel,
        membersUnderMe,
        rosterSource,
        legacyTeamNames,
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
