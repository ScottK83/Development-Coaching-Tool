/**
 * Associate Activity Module
 *
 * Who on the roster is currently away: no numbers in the 30 days before the
 * newest upload. Inactive is a view, not a deletion. Nothing an inactive
 * associate has on file is touched, so bringing them back restores everything.
 *
 * They come back two ways:
 *   - on their own, the moment an upload has numbers for them again;
 *   - with Reinstate, for someone on FMLA or leave who should stay listed
 *     while they are out. A reinstated associate stays active for another 30
 *     days of uploads without numbers before being set aside again.
 *
 * The 30 days are counted back from the newest upload, not from today, so a
 * week without uploading does not set the whole floor aside.
 *
 * Where it shows: pickers list inactive associates last, under their own
 * heading, so their history is still one click away; the contest day grid
 * leaves them out, since they cannot earn entries while away; Settings > Team
 * Members lists them with a Reinstate button.
 */
(function () {
    'use strict';

    var INACTIVE_AFTER_DAYS = 30;
    var REINSTATED_STORE = 'associateReinstated';
    var cache = { at: 0, value: null };

    function storage() {
        return window.DevCoachModules && window.DevCoachModules.storage;
    }

    function readReinstated() {
        try {
            var value = storage()?.readStore?.(REINSTATED_STORE);
            return value && typeof value === 'object' ? value : {};
        } catch (_e) {
            return {};
        }
    }

    function localIsoDate(date) {
        var d = date || new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function isoDaysBefore(iso, days) {
        var p = String(iso).split('-').map(Number);
        return localIsoDate(new Date(p[0], p[1] - 1, p[2] - days));
    }

    function periodsFrom(source) {
        return source && typeof source === 'object' ? source : {};
    }

    function weeklySource() {
        if (typeof weeklyData !== 'undefined' && weeklyData) return weeklyData;
        return storage()?.loadWeeklyData?.() || {};
    }

    function dailySource() {
        if (typeof dailyData !== 'undefined' && dailyData) return dailyData;
        return storage()?.loadDailyData?.() || {};
    }

    function rosterNameFor(name) {
        var match = typeof window.rosterEntryFor === 'function' ? window.rosterEntryFor(name) : null;
        return match || String(name || '').trim();
    }

    function compute() {
        var roster = Array.isArray(window.SUPERVISOR_ROSTER) ? window.SUPERVISOR_ROSTER : [];
        var lastSeen = {};
        var newest = '';

        [weeklySource(), dailySource()].forEach(function (source) {
            var periods = periodsFrom(source);
            Object.keys(periods).forEach(function (key) {
                var period = periods[key] || {};
                var meta = period.metadata || {};
                // A YTD row names everyone who worked at any point this year,
                // so it says nothing about who is working now.
                if (meta.periodType === 'ytd') return;
                var end = String(meta.endDate || (key.indexOf('|') > -1 ? key.split('|')[1] : ''));
                if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return;
                if (end > newest) newest = end;
                (period.employees || []).forEach(function (emp) {
                    if (!emp || !emp.name) return;
                    var who = rosterNameFor(emp.name);
                    if (!lastSeen[who] || end > lastSeen[who]) lastSeen[who] = end;
                });
            });
        });

        var result = { newest: newest, cutoff: '', inactive: [], reinstatedWaiting: [] };
        // Nothing uploaded yet means nothing to judge anyone by.
        if (!newest) return result;
        result.cutoff = isoDaysBefore(newest, INACTIVE_AFTER_DAYS);
        var reinstated = readReinstated();

        roster.forEach(function (team) {
            (team.agents || []).forEach(function (agent) {
                var seen = lastSeen[agent] || '';
                if (seen && seen >= result.cutoff) return;
                var since = reinstated[agent] || '';
                var row = { name: agent, supervisor: team.supervisor, lastSeen: seen, reinstatedOn: since };
                if (since && since >= result.cutoff) {
                    result.reinstatedWaiting.push(row);
                    return;
                }
                result.inactive.push(row);
            });
        });

        var byName = function (a, b) { return a.name.localeCompare(b.name); };
        result.inactive.sort(byName);
        result.reinstatedWaiting.sort(byName);
        return result;
    }

    function getActivity() {
        if (cache.value && Date.now() - cache.at < 5000) return cache.value;
        cache = { at: Date.now(), value: compute() };
        return cache.value;
    }

    function getInactiveAssociates() {
        return getActivity().inactive.slice();
    }

    function isInactive(name) {
        var who = rosterNameFor(name);
        return getActivity().inactive.some(function (row) { return row.name === who; });
    }

    function saveReinstated(map) {
        storage()?.saveWithSizeCheck?.(REINSTATED_STORE, map);
        cache = { at: 0, value: null };
    }

    function reinstate(name) {
        var map = Object.assign({}, readReinstated());
        map[rosterNameFor(name)] = localIsoDate();
        saveReinstated(map);
    }

    function undoReinstate(name) {
        var map = Object.assign({}, readReinstated());
        delete map[rosterNameFor(name)];
        saveReinstated(map);
    }

    // ============================================
    // SETTINGS PANEL
    // ============================================

    function escapeHtml(value) {
        var su = window.DevCoachModules && window.DevCoachModules.sharedUtils;
        if (su && typeof su.escapeHtml === 'function') return su.escapeHtml(value);
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatDate(iso) {
        if (!iso) return 'none on file';
        var p = iso.split('-');
        return p[1] + '/' + p[2] + '/' + p[0];
    }

    function rowHtml(row, action, label, colour) {
        return '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 10px; border-bottom:1px solid var(--border);">'
            + '<span style="font-weight:600; min-width:180px;">' + escapeHtml(row.name) + '</span>'
            + '<span style="color:var(--text-secondary); font-size:0.88em; min-width:140px;">' + escapeHtml(row.supervisor) + '</span>'
            + '<span style="color:var(--text-tertiary); font-size:0.85em; flex:1;">Last numbers: ' + escapeHtml(formatDate(row.lastSeen))
            + (row.reinstatedOn ? ' · reinstated ' + escapeHtml(formatDate(row.reinstatedOn)) : '') + '</span>'
            + '<button type="button" class="btn-secondary" data-activity-action="' + action + '" data-activity-name="' + escapeHtml(row.name) + '"'
            + ' style="background:' + colour + '; color:#fff; font-size:0.85em; padding:5px 12px;">' + label + '</button>'
            + '</div>';
    }

    function renderPanel() {
        var panel = document.getElementById('inactiveAssociatesPanel');
        if (!panel) return;
        var activity = getActivity();
        var html = '';
        if (!activity.newest) {
            html = '<p style="color:var(--text-tertiary); margin:0;">Nothing uploaded yet, so nobody is set aside.</p>';
        } else {
            html += '<p style="color:var(--text-secondary); margin:0 0 10px 0; font-size:0.9em;">No numbers since '
                + escapeHtml(formatDate(activity.cutoff)) + ' (30 days before your newest upload, ' + escapeHtml(formatDate(activity.newest)) + ').</p>';
            if (!activity.inactive.length) {
                html += '<p style="color:var(--green-text); margin:0;">Everyone on the roster has numbers in the last 30 days.</p>';
            } else {
                html += '<div style="border:1px solid var(--border); border-radius:6px; background:var(--bg-surface-raised);">'
                    + activity.inactive.map(function (row) { return rowHtml(row, 'reinstate', 'Reinstate', '#2e7d32'); }).join('')
                    + '</div>';
            }
            if (activity.reinstatedWaiting.length) {
                html += '<h4 style="margin:16px 0 8px 0;">Reinstated, waiting for numbers</h4>'
                    + '<div style="border:1px solid var(--border); border-radius:6px; background:var(--bg-surface-raised);">'
                    + activity.reinstatedWaiting.map(function (row) { return rowHtml(row, 'undo', 'Set aside again', '#757575'); }).join('')
                    + '</div>';
            }
        }
        panel.innerHTML = html;
    }

    function onPanelClick(event) {
        var btn = event.target.closest && event.target.closest('[data-activity-action]');
        if (!btn) return;
        var name = btn.getAttribute('data-activity-name');
        if (btn.getAttribute('data-activity-action') === 'reinstate') reinstate(name);
        else undoReinstate(name);
        renderPanel();
        if (typeof window.showToast === 'function') {
            window.showToast(btn.getAttribute('data-activity-action') === 'reinstate'
                ? name + ' is back on the active roster.'
                : name + ' is set aside again.', 3000);
        }
    }

    function bindPanel() {
        var panel = document.getElementById('inactiveAssociatesPanel');
        if (panel && !panel.dataset.activityBound) {
            panel.addEventListener('click', onPanelClick);
            panel.dataset.activityBound = '1';
        }
        var nav = document.getElementById('subNavTeamMembers');
        if (nav && !nav.dataset.activityBound) {
            nav.addEventListener('click', function () { renderPanel(); });
            nav.dataset.activityBound = '1';
        }
    }

    if (typeof document !== 'undefined' && document.addEventListener) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPanel);
        else bindPanel();
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.associateActivity = {
        INACTIVE_AFTER_DAYS: INACTIVE_AFTER_DAYS,
        getInactiveAssociates: getInactiveAssociates,
        isInactive: isInactive,
        reinstate: reinstate,
        undoReinstate: undoReinstate,
        renderPanel: renderPanel,
        bindPanel: bindPanel
    };
})();
