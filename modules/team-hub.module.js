(function () {
    'use strict';

    /**
     * TEAM HUB
     *
     * The two pieces that sit above everything else in My Team: the team you're
     * working out of, and — when that's "All teams" — a way to hand out
     * shoutouts across the whole center in one pass.
     *
     * Picking a team here narrows every sub-tab, because team-filter folds the
     * selection into the context those tabs already consult.
     */

    const PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    const HIGHLIGHT_WINDOW_KEY = PREFIX + 'highlightWindow';

    // Volume has no target to beat, so it can't earn a callout on its own.
    const NO_TARGET_METRICS = new Set(['totalCalls', 'transfersCount', 'surveyTotal']);
    const SURVEY_METRIC_KEYS = ['cxRepOverall', 'fcr', 'overallExperience'];

    // Single-day numbers swing hard, so only the metrics that mean something at
    // day granularity are eligible for a "yesterday" shoutout. Survey-based
    // metrics need days of surveys to settle and are left out on purpose.
    const DAILY_METRIC_KEYS = ['aht', 'scheduleAdherence', 'positiveWord', 'negativeWord', 'managingEmotions'];

    // How much better than target counts as worth saying out loud, per metric.
    // Without this a rep who cleared adherence by 0.1 reads the same as one who
    // cleared it by six points.
    const NOISE = {
        scheduleAdherence: 1,
        cxRepOverall: 2,
        fcr: 2,
        overallExperience: 2,
        overallSentiment: 1,
        positiveWord: 1,
        negativeWord: 1,
        managingEmotions: 1,
        aht: 15,
        acw: 5,
        holdTime: 3,
        transfers: 0.5
    };

    function escapeHtml(value) {
        const shared = window.DevCoachModules?.sharedUtils?.escapeHtml;
        if (shared) return shared(value);
        return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function formatValue(key, value) {
        if (typeof window.formatMetricValue === 'function') return window.formatMetricValue(key, value);
        return String(value);
    }

    function preferredName(fullName) {
        if (typeof window.getEmployeeNickname === 'function') return window.getEmployeeNickname(fullName);
        return String(fullName || '').split(/[\s,]+/)[0] || fullName;
    }

    function store(name) {
        const live = typeof window[name] === 'object' && window[name] ? window[name] : null;
        if (live) return live;
        const loaders = { weeklyData: 'loadWeeklyData', ytdData: 'loadYtdData', dailyData: 'loadDailyData' };
        return window.DevCoachModules?.storage?.[loaders[name]]?.() || {};
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
            container.innerHTML = `<div style="font-size:0.88em; color:var(--text-secondary);">No team members yet — pick yours under Settings › Team Members and they'll show up here.</div>`;
            return;
        }

        const options = [`<option value="${scope.ALL_MEMBERS_ID}"${activeId === scope.ALL_MEMBERS_ID ? ' selected' : ''}>All of my team (${roster.length})</option>`]
            .concat(roster.map(name =>
                `<option value="${escapeHtml(name)}"${activeId === name ? ' selected' : ''}>${escapeHtml(name)}</option>`
            ))
            .join('');

        const chip = summary.isAll
            ? `<span style="padding:4px 12px; border-radius:12px; background:#e8f5e9; color:#2e7d32; font-weight:600; font-size:0.82em;">My whole team • ${summary.memberCount}</span>`
            : `<span style="padding:4px 12px; border-radius:12px; background:#ede7f6; color:#4527a0; font-weight:600; font-size:0.82em;">Just ${escapeHtml(summary.label)}</span>`;

        const note = summary.isAll
            ? 'Every tab below covers the whole team.'
            : 'Every tab below is about this one person.';

        container.innerHTML = `<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px; padding:12px 16px; background:var(--bg-surface); border:1px solid #d1c4e9; border-radius:10px;">` +
            `<label for="teamScopeSelect" style="font-weight:700; color:#4527a0; font-size:0.92em;">Who</label>` +
            `<select id="teamScopeSelect" style="padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-size:0.95em; min-width:240px; background:var(--bg-surface-raised); color:var(--text-primary);">${options}</select>` +
            chip +
            `<span style="margin-left:auto; font-size:0.82em; color:var(--text-tertiary);">${note}</span>` +
        `</div>`;

        const select = container.querySelector('#teamScopeSelect');
        if (select) {
            select.addEventListener('change', function () {
                scope.setActiveMemberId(this.value);

                // Coaching and Call Listening drive off the shared associate
                // picker rather than the team filter, so point it at the same
                // person instead of leaving those two tabs on a stale name.
                const picked = scope.getActiveMember();
                if (picked) window.DevCoachModules?.selectedAssociate?.set?.(picked);

                renderTeamSelector(container);
                window.DevCoachModules?.teamFilter?.notifyTeamFilterChanged?.();
                refreshVisibleMyTeamSection();
            });
        }
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

        if (visible('subSectionMorningPulse')) {
            if (visible('celebrationsContainer')) modules.celebrations?.initializeCelebrations?.();
            if (visible('morningPulseContainer')) modules.morningPulse?.initializeMorningPulse?.();
        }
        if (visible('subSectionMondayPost')) modules.mondayPost?.initializeMondayPost?.();
        if (visible('subSectionTeamSnapshot')) modules.teamSnapshot?.initializeTeamSnapshot?.();
        if (visible('subSectionHighlights')) renderHighlights();
    }

    // --- Highlights ---

    function loadHighlightWindow() {
        try {
            const saved = localStorage.getItem(HIGHLIGHT_WINDOW_KEY);
            return saved === 'week' || saved === 'yesterday' ? saved : 'yesterday';
        } catch (e) {
            return 'yesterday';
        }
    }

    function saveHighlightWindow(value) {
        try {
            localStorage.setItem(HIGHLIGHT_WINDOW_KEY, value);
        } catch (e) { /* selection just won't persist */ }
    }

    function sortedKeys(data) {
        return Object.keys(data || {}).sort((a, b) => {
            const endA = data[a]?.metadata?.endDate || (a.includes('|') ? a.split('|')[1] : a);
            const endB = data[b]?.metadata?.endDate || (b.includes('|') ? b.split('|')[1] : b);
            return String(endA).localeCompare(String(endB));
        });
    }

    function buildMetricSpecs(metricKeys) {
        const registry = window.METRICS_REGISTRY || {};
        const profiles = window.DevCoachModules?.metricProfiles;
        const year = new Date().getFullYear();

        return metricKeys
            .filter(key => !NO_TARGET_METRICS.has(key))
            .map(key => {
                const entry = registry[key];
                if (!entry) return null;
                const target = profiles?.getYearTarget?.(key, year) || entry.target;
                if (!target || !Number.isFinite(parseFloat(target.value))) return null;
                return {
                    key,
                    label: entry.label || key,
                    target: parseFloat(target.value),
                    targetType: target.type === 'max' ? 'max' : 'min',
                    noise: NOISE[key] ?? 0
                };
            })
            .filter(Boolean);
    }

    // Resolves the period being celebrated, plus the one before it for the
    // "improved" callouts. Returns null when nothing has been uploaded.
    function resolveWindow(windowId) {
        if (windowId === 'week') {
            const weekly = store('weeklyData');
            const keys = sortedKeys(weekly).filter(key => {
                const type = weekly[key]?.metadata?.periodType;
                return !type || type === 'week';
            });
            if (!keys.length) return null;
            const latest = keys[keys.length - 1];
            return {
                title: 'Last week',
                period: weekly[latest],
                previous: keys.length > 1 ? weekly[keys[keys.length - 2]] : null,
                label: weekly[latest]?.metadata?.endDate || latest,
                metricKeys: Object.keys(window.METRICS_REGISTRY || {}),
                minCalls: 20,
                emptyHint: 'Upload a weekly file and last week’s highlights will appear here.'
            };
        }

        const daily = store('dailyData');
        const keys = sortedKeys(daily);
        if (!keys.length) return null;
        const latest = keys[keys.length - 1];
        return {
            title: 'Yesterday',
            period: daily[latest],
            previous: keys.length > 1 ? daily[keys[keys.length - 2]] : null,
            label: daily[latest]?.metadata?.endDate || latest,
            metricKeys: DAILY_METRIC_KEYS,
            minCalls: 10,
            emptyHint: 'Upload a daily file and yesterday’s highlights will appear here.'
        };
    }

    function buildGroups(windowId) {
        const engine = window.DevCoachModules?.highlights;
        const scope = window.DevCoachModules?.teamScope;
        const resolved = resolveWindow(windowId);
        if (!engine || !resolved) return { resolved, groups: [], scanned: 0 };

        // Highlights are a My Team view, so they never reach past my roster —
        // "all" here means my whole team, not the whole floor.
        const roster = scope?.getMyTeamRoster?.() || [];
        const scoped = scope?.getScopeMembers?.() || null;
        const allowed = new Set(scoped || roster);
        const inScope = (name) => (allowed.size ? allowed.has(name) : true);

        const employees = (resolved.period?.employees || []).filter(emp => inScope(String(emp?.name || '').trim()));
        const previousByName = {};
        (resolved.previous?.employees || []).forEach(emp => {
            const name = String(emp?.name || '').trim();
            if (name) previousByName[name] = emp;
        });

        const entries = engine.findHighlights(employees, {
            metrics: buildMetricSpecs(resolved.metricKeys),
            previousByName,
            surveyMetricKeys: windowId === 'week' ? SURVEY_METRIC_KEYS : [],
            minSurveys: 3,
            minCalls: resolved.minCalls,
            maxPerPerson: 3
        });

        // One roster means one group, so the team header would just be a label
        // repeated over every name.
        return { resolved, groups: entries.length ? [{ team: '', entries }] : [], scanned: employees.length };
    }

    function renderHighlights() {
        const container = document.getElementById('highlightsContainer');
        if (!container) return;

        const engine = window.DevCoachModules?.highlights;
        const windowId = loadHighlightWindow();
        const scope = window.DevCoachModules?.teamScope;
        const summary = scope?.describeScope?.() || { label: 'All of my team', isAll: true };

        const toggle = ['yesterday', 'week'].map(id => {
            const active = id === windowId;
            const label = id === 'yesterday' ? '☀️ Yesterday’s Highlights' : '📅 Last Week’s Highlights';
            return `<button type="button" class="highlight-window-btn" data-window="${id}" style="padding:9px 18px; border:none; border-radius:8px; font-weight:700; font-size:0.92em; cursor:pointer; background:${active ? 'linear-gradient(135deg,#f59e0b,#ea580c)' : '#e2e8f0'}; color:${active ? '#fff' : 'var(--text-secondary)'};">${label}</button>`;
        }).join('');

        const { resolved, groups, scanned } = buildGroups(windowId);

        let bodyHtml;
        let post = '';

        if (!resolved) {
            bodyHtml = `<div style="padding:36px; text-align:center; color:var(--text-secondary);">` +
                `<div style="font-size:2.4em; margin-bottom:8px;">📥</div>` +
                `<div style="font-weight:600;">Nothing uploaded for this window yet.</div>` +
            `</div>`;
        } else if (!groups.length) {
            bodyHtml = `<div style="padding:36px; text-align:center; color:var(--text-secondary);">` +
                `<div style="font-size:2.4em; margin-bottom:8px;">🔍</div>` +
                `<div style="font-weight:600;">Nobody cleared a target by enough to call out.</div>` +
                `<div style="font-size:0.9em; margin-top:6px;">${scanned} associate${scanned === 1 ? '' : 's'} checked for ${escapeHtml(resolved.title.toLowerCase())}.</div>` +
            `</div>`;
        } else {
            const dateLabel = typeof window.formatDateMMDDYYYY === 'function'
                ? window.formatDateMMDDYYYY(resolved.label) || resolved.label
                : resolved.label;
            post = engine.buildHighlightPost(groups, {
                title: `✨ ${resolved.title}’s Highlights — ${dateLabel}`,
                formatValue,
                preferredName
            });

            bodyHtml = groups.map(group => {
                const rows = group.entries.map(entry => {
                    const line = engine.buildHighlightLine(entry, { formatValue, preferredName });
                    return `<div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border); font-size:0.92em;">` +
                        `<span style="flex:1; color:var(--text-primary);">${escapeHtml(line)}</span>` +
                        `<button type="button" class="highlight-copy-one" data-line="${escapeHtml(line)}" style="background:var(--bg-surface-raised); border:1px solid var(--border); border-radius:6px; padding:4px 12px; cursor:pointer; color:var(--text-secondary); font-size:0.85em;">Copy</button>` +
                    `</div>`;
                }).join('');

                const header = group.team
                    ? `<div style="font-weight:700; color:#4527a0; margin-bottom:6px;">${escapeHtml(group.team)} <span style="color:var(--text-tertiary); font-weight:400; font-size:0.85em;">(${group.entries.length})</span></div>`
                    : '';
                return `<div style="margin-bottom:20px;">${header}${rows}</div>`;
            }).join('');
        }

        const people = engine ? engine.countPeople(groups) : 0;
        const scopeNote = summary.isAll
            ? `My whole team (${summary.memberCount})`
            : `${escapeHtml(summary.label)} only`;

        container.innerHTML = `<div style="margin-bottom:14px;">` +
                `<h3 style="color:#4527a0; margin:0 0 6px 0;">✨ Highlights</h3>` +
                `<p style="color:var(--text-secondary); margin:0; font-size:0.9em;">Everyone who beat a target, in one pass. ${scopeNote} • ${people} to call out.</p>` +
            `</div>` +
            `<div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">${toggle}</div>` +
            `<div style="padding:16px; background:var(--bg-surface); border:1px solid var(--border); border-radius:10px;">${bodyHtml}</div>` +
            (post
                ? `<div style="margin-top:16px;">` +
                    `<label for="highlightsPost" style="font-weight:700; color:#4527a0; font-size:0.9em; display:block; margin-bottom:6px;">Post</label>` +
                    `<textarea id="highlightsPost" style="width:100%; min-height:220px; padding:12px; border:1px solid var(--border); border-radius:6px; font-size:0.9em; line-height:1.6; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(post)}</textarea>` +
                    `<button type="button" id="highlightsCopyAll" style="margin-top:10px; background:linear-gradient(135deg,#10b981,#059669); color:#fff; border:none; border-radius:6px; padding:10px 20px; cursor:pointer; font-weight:bold;">📋 Copy the whole post</button>` +
                `</div>`
                : '');

        container.querySelectorAll('.highlight-window-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                saveHighlightWindow(btn.dataset.window);
                renderHighlights();
            });
        });

        container.querySelectorAll('.highlight-copy-one').forEach(btn => {
            btn.addEventListener('click', () => {
                if (typeof window.copyToClipboard === 'function') {
                    window.copyToClipboard(btn.dataset.line, { message: 'Copied' });
                }
            });
        });

        const copyAll = container.querySelector('#highlightsCopyAll');
        if (copyAll) {
            copyAll.addEventListener('click', () => {
                const textarea = container.querySelector('#highlightsPost');
                if (textarea && typeof window.copyToClipboard === 'function') {
                    window.copyToClipboard(textarea.value, { message: 'Highlights copied' });
                }
            });
        }
    }

    function initializeTeamHub() {
        renderTeamSelector(document.getElementById('teamScopeBar'));
    }

    function initializeHighlights() {
        renderTeamSelector(document.getElementById('teamScopeBar'));
        renderHighlights();
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.teamHub = {
        initializeTeamHub,
        initializeHighlights,
        renderTeamSelector,
        renderHighlights,
        buildMetricSpecs,
        refreshVisibleMyTeamSection,
        DAILY_METRIC_KEYS,
        SURVEY_METRIC_KEYS,
        NOISE
    };
})();
