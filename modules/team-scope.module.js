(function () {
    'use strict';

    /**
     * TEAM SCOPE
     *
     * The app already knew who reports to whom — `employeeSupervisors` maps an
     * associate to a supervisor. What it never had was a way to say "show me
     * Kathy's team" and have the rest of the tool follow along.
     *
     * This turns that map into a list of teams, remembers which one you picked,
     * and hands the members to team-filter so every My Team feature narrows to
     * it without each of them growing its own team logic.
     */

    const PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    const SUPERVISORS_KEY = PREFIX + 'employeeSupervisors';
    const ACTIVE_TEAM_KEY = PREFIX + 'activeTeamId';

    const ALL_TEAMS_ID = '__all__';
    const UNASSIGNED_ID = '__unassigned__';

    function slugify(label) {
        return String(label || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'team';
    }

    /**
     * Builds the team list from the supervisor map, restricted to associates
     * who actually show up in the data. A supervisor whose whole team has left
     * the uploads shouldn't still be offered in the dropdown.
     *
     * Returns { teams, byEmployee, unassignedCount }. `teams` is sorted by
     * label, with the unassigned bucket last so it never leads the list.
     */
    function buildTeamIndex(supervisorMap, employeeNames) {
        const map = supervisorMap && typeof supervisorMap === 'object' ? supervisorMap : {};
        const roster = Array.from(new Set((employeeNames || [])
            .map(name => String(name || '').trim())
            .filter(Boolean)));

        const byLabel = new Map();
        const byEmployee = {};
        const unassigned = [];

        roster.forEach(name => {
            const supervisor = String(map[name] || '').trim();
            if (!supervisor) {
                unassigned.push(name);
                return;
            }
            if (!byLabel.has(supervisor)) byLabel.set(supervisor, []);
            byLabel.get(supervisor).push(name);
            byEmployee[name] = supervisor;
        });

        const teams = Array.from(byLabel.entries())
            .map(([label, members]) => ({
                id: slugify(label),
                label,
                members: members.slice().sort((a, b) => a.localeCompare(b))
            }))
            .sort((a, b) => a.label.localeCompare(b.label));

        if (unassigned.length) {
            teams.push({
                id: UNASSIGNED_ID,
                label: 'Unassigned',
                members: unassigned.slice().sort((a, b) => a.localeCompare(b))
            });
        }

        return { teams, byEmployee, unassignedCount: unassigned.length };
    }

    /**
     * Which team the UI should act on. A stored id that no longer matches a
     * real team falls back to "all" rather than silently scoping everything to
     * an empty roster — an empty team reads as "no data" everywhere downstream,
     * which is a confusing way to learn your saved selection went stale.
     */
    function resolveActiveTeam(index, storedId) {
        const teams = (index && index.teams) || [];
        if (!storedId || storedId === ALL_TEAMS_ID) return null;
        return teams.find(team => team.id === storedId) || null;
    }

    // --- Data access ---

    function getSupervisorMap() {
        try {
            return JSON.parse(localStorage.getItem(SUPERVISORS_KEY) || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    // Everyone the tool has ever seen, across every store. Highlights and the
    // dropdown both need the full roster, not just the latest week.
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

    function getTeamIndex() {
        return buildTeamIndex(getSupervisorMap(), getKnownEmployeeNames());
    }

    function getActiveTeamId() {
        try {
            return localStorage.getItem(ACTIVE_TEAM_KEY) || ALL_TEAMS_ID;
        } catch (e) {
            return ALL_TEAMS_ID;
        }
    }

    function setActiveTeamId(teamId) {
        try {
            localStorage.setItem(ACTIVE_TEAM_KEY, teamId || ALL_TEAMS_ID);
        } catch (e) { /* storage blocked — the selection just won't persist */ }
    }

    function getActiveTeam() {
        return resolveActiveTeam(getTeamIndex(), getActiveTeamId());
    }

    /**
     * The members the rest of the app should be scoped to, or null for "no team
     * scope in effect". Null and "every name" are deliberately different: null
     * means don't narrow anything, which is what team-filter needs to know.
     */
    function getActiveTeamMembers() {
        const team = getActiveTeam();
        return team ? team.members.slice() : null;
    }

    function isInActiveTeam(employeeName) {
        const members = getActiveTeamMembers();
        if (!members) return true;
        return members.indexOf(String(employeeName || '').trim()) > -1;
    }

    function describeActiveTeam() {
        const team = getActiveTeam();
        if (!team) {
            const index = getTeamIndex();
            const total = index.teams.reduce((sum, t) => sum + t.members.length, 0);
            return { label: 'All teams', memberCount: total, isAll: true };
        }
        return { label: team.label, memberCount: team.members.length, isAll: false };
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.teamScope = {
        ALL_TEAMS_ID,
        UNASSIGNED_ID,
        slugify,
        buildTeamIndex,
        resolveActiveTeam,
        getSupervisorMap,
        getKnownEmployeeNames,
        getTeamIndex,
        getActiveTeamId,
        setActiveTeamId,
        getActiveTeam,
        getActiveTeamMembers,
        isInActiveTeam,
        describeActiveTeam
    };
})();
