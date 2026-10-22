(function () {
    'use strict';

    /**
     * TEAM HUB
     *
     * The team you're working out of, which sits above everything else in My
     * Team, and the target-beating highlights post, which the day page's
     * shout-out card builds over the Covering window.
     *
     * Picking a team here narrows every sub-tab, because team-filter folds the
     * selection into the context those tabs already consult.
     */

    // Volume has no target to beat, so it can't earn a callout on its own.
    const NO_TARGET_METRICS = new Set(['totalCalls', 'transfersCount', 'surveyTotal']);

    // Same reasoning as the celebration exclusion: everyone who worked their
    // week clears reliability, so it would fill the highlights with the same
    // names every time and crowd out the callouts worth reading.
    const NOT_HIGHLIGHT_WORTHY = new Set(['reliability']);
    const SURVEY_METRIC_KEYS = ['cxRepOverall', 'fcr', 'overallExperience'];

    // Single-day numbers swing hard, so only the metrics that mean something at
    // day granularity are eligible for a "yesterday" shoutout. Survey-based
    // metrics need days of surveys to settle and are left out on purpose.
    const DAILY_METRIC_KEYS = ['aht', 'scheduleAdherence', 'positiveWord', 'negativeWord', 'managingEmotions'];

    // How much better than target counts as worth saying out loud. The registry
    // owns the floor, so clearing a bar by a hair reads the same way here as
    // everywhere else that judges movement.
    function noiseThreshold(metricKey) {
        return typeof window.getMetricNoiseThreshold === 'function'
            ? window.getMetricNoiseThreshold(metricKey)
            : 1;
    }

    function escapeHtml(value) {
        const shared = window.DevCoachModules?.sharedUtils?.escapeHtml;
        if (shared) return shared(value);
        return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // With its unit and without a trailing ".0": "409s", "99.3%", "93%". The
    // bare formatMetricValue this used printed "409" and "99.3", and a number
    // with no unit on it is a number nobody can read. Scott, 2026-10-14.
    function formatValue(key, value) {
        if (typeof window.formatMetricDisplay === 'function') return window.formatMetricDisplay(key, value);
        if (typeof window.formatMetricValue === 'function') return window.formatMetricValue(key, value);
        return String(value);
    }

    // How far something moved, in the unit a person says it in: "3 points",
    // "40 seconds". A percentage move is in points, not percent: 73.4% to
    // 88.2% is up 14.8 points, and "+14.8%" says something else.
    function formatDelta(key, amount) {
        const n = Math.abs(Number(amount));
        if (!Number.isFinite(n)) return '';
        const unit = window.METRICS_REGISTRY?.[key]?.unit;
        if (unit === 'sec') {
            const secs = Math.round(n);
            return `${secs} second${secs === 1 ? '' : 's'}`;
        }
        if (unit === '%') {
            const pts = n.toFixed(1).replace(/\.0$/, '');
            return `${pts} point${pts === '1' ? '' : 's'}`;
        }
        return formatValue(key, n);
    }

    // The names these metrics go by in a sentence. The registry's are column
    // headers ("Average Handle Time", "Avoid Negative Words"); these match the
    // shout-out and the cheer, so one metric has one name across the posts.
    const SENTENCE_LABELS = {
        aht: 'Handle Time',
        negativeWord: 'Avoiding Negative Words',
        positiveWord: 'Positive Word Usage'
    };

    // The kudos at the foot of the post, each with the post's second emoji.
    // True of everyone on the list, whether they beat a goal or are moving
    // toward one.
    const HIGHLIGHT_CLOSERS = [
        'Great work, everyone. Keep it going! 🙌',
        'Proud of every name on this list. Keep it up! 🙌',
        'This is what showing up looks like. Nice work, team! 💪',
        'Love seeing these numbers. Keep stacking the wins! 🙌',
        'Every one of you earned a spot here. Keep it rolling! 💪'
    ];

    function limitEmojis(text) {
        const voice = window.DevCoachModules?.messageVoice;
        return typeof voice?.limitEmojis === 'function' ? voice.limitEmojis(text, 2) : text;
    }

    // "Oct 5 to 11" from the period's own dates, or '' when it has none.
    function shortSpan(period, key) {
        const fromKey = String(key || '').split('|');
        const start = period?.metadata?.startDate || (fromKey.length === 2 ? fromKey[0] : '');
        const end = period?.metadata?.endDate || (fromKey.length === 2 ? fromKey[1] : '');
        const span = window.DevCoachModules?.celebrations?.friendlyRange;
        if (typeof span === 'function' && start && end) return span('', `${start}|${end}`) || '';
        return '';
    }

    function preferredName(fullName) {
        if (typeof window.getEmployeeNickname === 'function') return window.getEmployeeNickname(fullName);
        return String(fullName || '').split(/[\s,]+/)[0] || fullName;
    }

    // --- Team selector ---

    function renderTeamSelector(container) {
        if (!container) return;

        const scope = window.DevCoachModules?.teamScope;
        if (!scope) {
            container.innerHTML = '';
            return;
        }

        const roster = scope.getMyTeamRoster();
        const activeId = scope.getActiveMemberId();
        const summary = scope.describeScope();

        if (!roster.length) {
            container.innerHTML = `<div style="font-size:0.88em; color:var(--text-secondary);">No team members yet. Pick yours under Settings › Team Members and they'll show up here.</div>`;
            return;
        }

        const options = [`<option value="${scope.ALL_MEMBERS_ID}"${activeId === scope.ALL_MEMBERS_ID ? ' selected' : ''}>All of my team (${roster.length})</option>`]
            .concat(roster.map(name =>
                `<option value="${escapeHtml(name)}"${activeId === name ? ' selected' : ''}>${escapeHtml(name)}</option>`
            ))
            .join('');

        const chip = summary.isAll
            ? `<span class="pill" style="padding:4px 12px; font-size:0.82em;">My whole team • ${summary.memberCount}</span>`
            : `<span class="pill pill-info" style="padding:4px 12px; font-size:0.82em;">Just ${escapeHtml(summary.label)}</span>`;

        const note = summary.isAll
            ? 'Every tab below covers the whole team.'
            : 'Every tab below is about this one person.';

        container.innerHTML = `<div class="card" style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; padding:12px 16px;">` +
            `<label for="teamScopeSelect" style="font-weight:700; font-size:0.92em;">Who</label>` +
            `<select id="teamScopeSelect" style="padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-size:0.95em; min-width:240px; background:var(--bg-surface-raised); color:var(--text-primary);">${options}</select>` +
            chip +
            `<span style="margin-left:auto; font-size:0.82em; color:var(--text-tertiary);">${note}` +
                (summary.source ? ` &middot; ${escapeHtml(summary.source.note)}` : '') +
            `</span>` +
        `</div>`;

        const select = container.querySelector('#teamScopeSelect');
        if (select) {
            select.addEventListener('change', function () {
                selectMember(this.value);
            });
        }
    }

    /**
     * Point My Team at one person, or back at everyone, the way the Who
     * dropdown does. The status cards on the day page call this too, so a card
     * and the dropdown cannot come to disagree about who is picked.
     */
    function selectMember(memberId) {
        const scope = window.DevCoachModules?.teamScope;
        if (!scope) return;
        scope.setActiveMemberId(memberId || scope.ALL_MEMBERS_ID);

        // Coaching and Call Listening drive off the shared associate
        // picker rather than the team filter, so point it at the same
        // person instead of leaving those two tabs on a stale name.
        const picked = scope.getActiveMember();
        if (picked) window.DevCoachModules?.selectedAssociate?.set?.(picked);

        renderTeamSelector(document.getElementById('teamScopeBar'));
        window.DevCoachModules?.teamFilter?.notifyTeamFilterChanged?.();
        refreshVisibleMyTeamSection();
    }

    // The team change has to reach whichever sub-tab is on screen. team-filter's
    // own broadcast covers the older sections; these are the My Team tabs that
    // render themselves and aren't in that list.
    function refreshVisibleMyTeamSection() {
        const modules = window.DevCoachModules || {};
        const visible = (id) => {
            const el = document.getElementById(id);
            return el && el.style.display !== 'none';
        };

        if (visible('subSectionMyTeamDay')) modules.myTeam?.renderDayPage?.();
        if (visible('subSectionTeamSnapshot')) modules.teamSnapshot?.initializeTeamSnapshot?.();
    }

    // --- Highlights ---

    function buildMetricSpecs(metricKeys) {
        const registry = window.METRICS_REGISTRY || {};
        const profiles = window.DevCoachModules?.metricProfiles;
        const year = new Date().getFullYear();

        return metricKeys
            .filter(key => !NO_TARGET_METRICS.has(key) && !NOT_HIGHLIGHT_WORTHY.has(key))
            .map(key => {
                const entry = registry[key];
                if (!entry) return null;
                const target = profiles?.getYearTarget?.(key, year) || entry.target;
                if (!target || !Number.isFinite(parseFloat(target.value))) return null;
                return {
                    key,
                    label: SENTENCE_LABELS[key] || entry.label || key,
                    target: parseFloat(target.value),
                    targetType: target.type === 'max' ? 'max' : 'min',
                    noise: noiseThreshold(key)
                };
            })
            .filter(Boolean);
    }

    /**
     * The same resolved shape, for the window My Team is showing.
     *
     * Highlights had its own Yesterday / Last week toggle, a fourth control on
     * My Team claiming to own time. It reads the page's comparison now: the
     * window's upload is the period, the other side of the comparison is what
     * "improved" is measured against. A day file keeps the day-sized metric
     * list, because a single day cannot settle a survey metric whichever
     * control picked it.
     */
    function resolveComparison(comparison) {
        const periodFor = window.DevCoachModules?.periodComparison?.periodFor;
        if (!comparison?.latestKey || typeof periodFor !== 'function') return null;
        const period = periodFor(comparison.latestKey);
        if (!period) return null;
        const isDay = comparison.windowId === 'day' || period?.metadata?.periodType === 'daily';
        return {
            title: comparison.latestLabel || 'This period',
            key: comparison.latestKey,
            period,
            previous: comparison.baselineKey ? periodFor(comparison.baselineKey) : null,
            label: period?.metadata?.endDate || String(comparison.latestKey).split('|').pop(),
            metricKeys: isDay ? DAILY_METRIC_KEYS : Object.keys(window.METRICS_REGISTRY || {}),
            minCalls: isDay ? 10 : 20,
            includeSurveys: !isDay
        };
    }

    // Everyone in the window who beat a target, as the post and the count.
    function buildHighlightsForComparison(comparison) {
        const engine = window.DevCoachModules?.highlights;
        const resolved = resolveComparison(comparison);
        if (!engine || !resolved) return { post: '', people: 0, scanned: 0, resolved: null };
        const { groups, scanned } = buildGroupsFrom(resolved);
        if (!groups.length) return { post: '', people: 0, scanned, resolved };
        // "Oct 5 to 11" rather than "(10/11/2026)": the span, said the way a
        // person says it. A window that is a whole month already names it.
        const span = shortSpan(resolved.period, resolved.key);
        const fallback = typeof window.formatDateMMDDYYYY === 'function'
            ? window.formatDateMMDDYYYY(resolved.label) || resolved.label
            : resolved.label;
        const when = span || fallback;
        const named = when && resolved.title.toLowerCase().indexOf(String(when).toLowerCase()) > -1;
        const title = resolved.title.charAt(0).toUpperCase() + resolved.title.slice(1);
        const post = engine.buildHighlightPost(groups, {
            title: `✨ Highlights, ${title}${when && !named ? ` (${when})` : ''}`,
            formatValue,
            formatDelta,
            preferredName,
            closer: HIGHLIGHT_CLOSERS[Math.floor(Math.random() * HIGHLIGHT_CLOSERS.length)]
        });
        return { post: limitEmojis(post), people: engine.countPeople(groups), scanned, resolved };
    }

    function buildGroupsFrom(resolved) {
        const engine = window.DevCoachModules?.highlights;
        const scope = window.DevCoachModules?.teamScope;
        if (!engine || !resolved) return { resolved, groups: [], scanned: 0 };
        const includeSurveys = Boolean(resolved.includeSurveys);

        // Highlights are a My Team view, so they never reach past my roster. 
        // "all" here means my whole team, not the whole floor.
        const roster = scope?.getMyTeamRoster?.() || [];
        const scoped = scope?.getScopeMembers?.() || null;
        const allowed = new Set(scoped || roster);
        const inScope = (name) => (allowed.size ? allowed.has(name) : true);

        // A year-to-date file's rows carry the survey count where calls go, and
        // the call floor below read 15 surveys as 15 calls and dropped the
        // person. withYtdCalls hands back calls that mean calls.
        const withCalls = window.DevCoachModules?.futures?.withYtdCalls;
        const periodRows = typeof withCalls === 'function' && resolved.period
            ? withCalls(resolved.period)
            : (resolved.period?.employees || []);
        const employees = periodRows.filter(emp => inScope(String(emp?.name || '').trim()));
        const previousByName = {};
        (resolved.previous?.employees || []).forEach(emp => {
            const name = String(emp?.name || '').trim();
            if (name) previousByName[name] = emp;
        });

        const entries = engine.findHighlights(employees, {
            metrics: buildMetricSpecs(resolved.metricKeys),
            previousByName,
            surveyMetricKeys: includeSurveys ? SURVEY_METRIC_KEYS : [],
            minSurveys: 3,
            minCalls: resolved.minCalls,
            maxPerPerson: 3
        });

        // One roster means one group, so the team header would just be a label
        // repeated over every name.
        return { resolved, groups: entries.length ? [{ team: '', entries }] : [], scanned: employees.length };
    }

    function initializeTeamHub() {
        renderTeamSelector(document.getElementById('teamScopeBar'));
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.teamHub = {
        initializeTeamHub,
        renderTeamSelector,
        selectMember,
        buildHighlightsForComparison,
        buildMetricSpecs,
        formatDelta,
        refreshVisibleMyTeamSection,
        DAILY_METRIC_KEYS,
        SURVEY_METRIC_KEYS,
        noiseThreshold,
        NOT_HIGHLIGHT_WORTHY
    };
})();
