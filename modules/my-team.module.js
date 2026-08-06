(function () {
    'use strict';

    /**
     * MY TEAM — the day hub
     *
     * My Team used to be seven tabs with a second row of three hidden inside
     * one of them, several of which did overlapping jobs. This replaces that
     * with one question and one page: who, then which day.
     *
     * A day page is everything for that day — the message to send, and the
     * things that explain why it says what it says. Celebrations, the weekly
     * pulse and the cheer lines are not destinations any more; they are the
     * evidence underneath the message.
     *
     * Picking one associate hides whatever only makes sense for the whole team,
     * so nothing on screen is about somebody you didn't ask about.
     */

    const PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    const DAY_KEY = PREFIX + 'myTeamDay';

    function mods() { return window.DevCoachModules || {}; }

    function escapeHtml(value) {
        const shared = mods().sharedUtils?.escapeHtml;
        if (shared) return shared(value);
        return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function activeDayId() {
        const outreach = mods().dailyOutreach;
        if (!outreach) return 'monday';
        const today = outreach.planForDate(new Date());
        const fallback = outreach.WEEKDAY_IDS.indexOf(today.id) > -1 ? today.id : 'monday';
        try {
            const saved = localStorage.getItem(DAY_KEY);
            return outreach.WEEKDAY_IDS.indexOf(saved) > -1 ? saved : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function setActiveDay(dayId) {
        try { localStorage.setItem(DAY_KEY, dayId); } catch (e) { /* not persisted */ }
    }

    // --- Day tab strip ---

    function renderDayTabs(dayId, person) {
        const outreach = mods().dailyOutreach;
        const dayPosts = mods().dayPosts;
        if (!outreach) return '';

        const status = dayPosts?.periodStatusByDay?.(outreach.isoDate(new Date())) || {};
        const sentLog = outreach.loadSentLog();
        const stamp = outreach.stampFor(outreach.PLANS.monday, { todayIso: outreach.isoDate(new Date()) });

        const tabs = outreach.weekdayPlans().map(plan => {
            const active = plan.id === dayId;
            const blocked = status[plan.id] && !status[plan.id].ok;
            // Only meaningful for one person — a team sweep tracks sends per rep.
            const sent = person && Boolean(outreach.getSentEntry(sentLog, plan.id, stamp, person));

            const bg = active ? 'linear-gradient(135deg,#7c4dff,#4527a0)' : (blocked ? '#f5f5f5' : (sent ? '#e8f5e9' : '#eef1f6'));
            const color = active ? '#fff' : (blocked ? 'var(--text-tertiary)' : (sent ? '#2e7d32' : 'var(--text-secondary)'));
            const mark = blocked ? '⚠️ ' : (sent ? '✓ ' : '');
            const tip = blocked
                ? `${plan.label} — ${status[plan.id].reason} ${status[plan.id].detail}`
                : `${plan.label} — covers ${plan.coverageLabel}`;
            const dayName = plan.id.charAt(0).toUpperCase() + plan.id.slice(1);

            return `<button type="button" class="mt-day-tab" data-day="${plan.id}" title="${escapeHtml(tip)}" ` +
                `style="padding:10px 18px; border:${blocked ? '1px dashed var(--border-strong)' : 'none'}; border-radius:8px; font-weight:700; font-size:0.95em; cursor:pointer; background:${bg}; color:${color};">` +
                `${mark}${dayName}</button>`;
        }).join('');

        // The rest of My Team is a quieter second group — still one click away,
        // but visibly not the main thing you came here to do.
        const others = [
            { id: 'subSectionCoachingEmail', btn: 'subNavCoachingEmail', label: 'Coaching' },
            { id: 'subSectionTeamSnapshot', btn: 'subNavTeamSnapshot', label: 'Snapshot' },
            { id: 'subSectionCallListening', btn: 'subNavCallListening', label: 'Calls' },
            { id: 'subSectionReliability', btn: 'subNavReliability', label: 'Attendance' }
        ].map(o => `<button type="button" class="mt-other-tab" data-section="${o.id}" data-btn="${o.btn}" ` +
            `style="background:none; border:none; padding:10px 6px; cursor:pointer; color:var(--text-secondary); font-size:0.9em; text-decoration:underline;">${o.label}</button>`
        ).join('<span style="color:var(--border-strong);">·</span>');

        return `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:18px;">` +
            tabs +
            `<span style="margin-left:auto; display:flex; align-items:center; gap:2px;">${others}</span>` +
        `</div>`;
    }

    // --- What's behind the message ---

    /**
     * The evidence under the day's message: what they're being celebrated for,
     * how the week is actually trending. Scoped to whoever is selected, and
     * silent rather than apologetic when there is nothing to show.
     */
    function buildContextHtml(person) {
        const rows = [];

        const celebrations = mods().celebrations;
        if (celebrations?.detectCelebrations) {
            try {
                const result = celebrations.detectCelebrations(null);
                (result.celebrations || []).slice(0, 4).forEach(entry => {
                    const best = entry.achievements?.[0];
                    if (!best) return;
                    rows.push(`🎉 <strong>${escapeHtml(entry.firstName)}</strong> — ${escapeHtml(best.tierLabel)} in ${escapeHtml(best.label)}`);
                });
                // A near miss is worth seeing too; it's the coaching conversation.
                (result.missed || []).slice(0, person ? 2 : 1).forEach(info => {
                    if (celebrations.describeNoCelebration) {
                        rows.push(`◦ ${escapeHtml(celebrations.describeNoCelebration(info))}`);
                    }
                });
            } catch (e) { /* context is optional — never block the message on it */ }
        }

        if (!rows.length) {
            return `<div style="font-size:0.9em; color:var(--text-tertiary);">Nothing standing out in the rankings for this period yet.</div>`;
        }

        return rows.map(r => `<div style="padding:5px 0; font-size:0.9em; color:var(--text-primary);">${r}</div>`).join('');
    }

    // --- The day page ---

    async function renderDayPage() {
        const container = document.getElementById('myTeamDayContainer');
        if (!container) return;

        const outreach = mods().dailyOutreach;
        const scope = mods().teamScope;
        if (!outreach) {
            container.innerHTML = '<div style="padding:20px; color:var(--text-secondary);">Outreach module failed to load.</div>';
            return;
        }

        const person = scope?.getActiveMember?.() || null;
        const dayId = activeDayId();
        const plan = outreach.planById(dayId);

        container.innerHTML = renderDayTabs(dayId, person) +
            `<div style="display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:12px;">` +
                `<h3 style="margin:0; color:#4527a0;">${escapeHtml(plan.label)}</h3>` +
                `<div style="font-size:0.86em; color:var(--text-secondary);">Covers ${escapeHtml(plan.coverageLabel)} · ${person ? escapeHtml(person) : 'whole team'}</div>` +
            `</div>` +
            `<div id="myTeamDayMessage"></div>` +
            `<details style="margin-top:18px; border:1px solid var(--border); border-radius:10px; padding:12px 16px; background:var(--bg-surface-raised);" open>` +
                `<summary style="cursor:pointer; font-weight:700; color:var(--text-secondary);">What's behind it</summary>` +
                `<div id="myTeamDayContext" style="margin-top:10px;"></div>` +
            `</details>`;

        container.querySelectorAll('.mt-day-tab').forEach(btn => {
            btn.addEventListener('click', async () => {
                setActiveDay(btn.dataset.day);
                if (mods().dayPosts?.saveDayChoice) mods().dayPosts.saveDayChoice(btn.dataset.day);
                await renderDayPage();
            });
        });

        container.querySelectorAll('.mt-other-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                if (typeof window.showMyTeamSubSection === 'function') {
                    window.showMyTeamSubSection(btn.dataset.section, btn.dataset.btn);
                }
                const init = {
                    subSectionCoachingEmail: () => window.initializeCoachingEmail?.(),
                    subSectionTeamSnapshot: () => mods().teamSnapshot?.initializeTeamSnapshot?.(),
                    subSectionCallListening: () => window.initializeCallListeningSection?.(),
                    subSectionReliability: () => mods().reliability?.initialize?.()
                }[btn.dataset.section];
                if (init) init();
            });
        });

        const messageEl = document.getElementById('myTeamDayMessage');
        if (person) {
            if (mods().dayPosts?.saveDayChoice) mods().dayPosts.saveDayChoice(dayId);
            await mods().dayPosts?.renderDayPosts?.(messageEl, person);
        } else {
            renderTeamDay(messageEl, plan);
        }

        const contextEl = document.getElementById('myTeamDayContext');
        if (contextEl) contextEl.innerHTML = buildContextHtml(person);
    }

    /**
     * The whole-team view of a day: send everyone their message in one pass,
     * or write the team-wide post. Both already exist — this just puts them
     * where the day put you.
     */
    function renderTeamDay(container, plan) {
        if (!container) return;

        container.innerHTML = `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px;">` +
            `<button type="button" id="myTeamRunSweep" style="text-align:left; padding:16px; border:1px solid #c7b3ff; border-radius:10px; background:var(--bg-surface); cursor:pointer;">` +
                `<div style="font-weight:700; color:#4527a0; margin-bottom:4px;">🚀 Run the whole team</div>` +
                `<div style="font-size:0.86em; color:var(--text-secondary);">One ${escapeHtml(plan.label)} per associate, with anyone already sent pulled out.</div>` +
            `</button>` +
            `<button type="button" id="myTeamTeamPost" style="text-align:left; padding:16px; border:1px solid #a5d6a7; border-radius:10px; background:var(--bg-surface); cursor:pointer;">` +
                `<div style="font-weight:700; color:#2e7d32; margin-bottom:4px;">📢 Write one team post</div>` +
                `<div style="font-size:0.86em; color:var(--text-secondary);">A single message to the whole team for the week, month or quarter.</div>` +
            `</button>` +
        `</div>` +
        `<div id="myTeamTeamPostSlot" style="margin-top:14px;"></div>`;

        container.querySelector('#myTeamRunSweep')?.addEventListener('click', async () => {
            const pulse = mods().morningPulse;
            if (pulse?.showRunMyDayModal) await pulse.showRunMyDayModal(document.getElementById('morningPulseContainer'));
        });

        container.querySelector('#myTeamTeamPost')?.addEventListener('click', () => {
            if (typeof window.showMyTeamSubSection === 'function') {
                window.showMyTeamSubSection('subSectionMondayPost', 'subNavHighlights');
            }
            mods().dayPosts?.renderPostsTab?.();
        });
    }

    function initializeMyTeam() {
        mods().teamHub?.renderTeamSelector?.(document.getElementById('teamScopeBar'));
        renderDayPage();
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.myTeam = {
        initializeMyTeam,
        renderDayPage,
        renderDayTabs,
        buildContextHtml,
        activeDayId,
        setActiveDay
    };
})();
