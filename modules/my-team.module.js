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

    // Which private message you're looking at for one person: their day post,
    // or one of the two that aren't tied to a day. Session-only on purpose —
    // the day is the thing worth remembering between visits.
    let activeTone = null;

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
        let header = '';

        const celebrations = mods().celebrations;
        if (celebrations?.detectCelebrations) {
            try {
                const result = celebrations.detectCelebrations(null);

                // A rank means nothing without the period it was earned in and
                // the size of the field. Both were being left to memory.
                const headerBits = [];
                if (result.dateRange) headerBits.push(escapeHtml(result.dateRange));
                if (result.totalEmployees) headerBits.push(`${result.totalEmployees} associates scored in the center`);
                if (headerBits.length) {
                    header = `<div style="padding:0 0 8px; font-size:0.85em; color:var(--text-secondary); font-weight:600;">${headerBits.join(' · ')}</div>`;
                }

                (result.celebrations || []).slice(0, 4).forEach(entry => {
                    const best = entry.achievements?.[0];
                    if (!best) return;
                    // The placing says the rank, the tie and the pool in one
                    // breath. Pairing a bare "#1 in Center" with a beaten-count
                    // that excluded ties read as a contradiction.
                    const placing = celebrations.describePlacement ? celebrations.describePlacement(best) : '';
                    const tail = placing
                        ? ` <span style="color:var(--text-tertiary);">· ${escapeHtml(placing)}</span>`
                        : '';
                    rows.push(`🎉 <strong>${escapeHtml(entry.firstName)}</strong> — ${escapeHtml(best.label)}${tail}`);
                });
                // Near misses are deliberately NOT listed here. This panel sits
                // directly under the shout-outs, and only one or two misses are
                // shown, so whoever came closest ends up the lone name under a list
                // of winners — it reads as calling them out for not making it, which
                // is the opposite of the intent. The rankings and coaching views are
                // where "five off the top ten" belongs.
                //
                // describeNoCelebration still exists and is still used elsewhere;
                // it is this placement that was wrong, not the sentence.
            } catch (e) { /* context is optional — never block the message on it */ }
        }

        if (!rows.length) {
            return `<div style="font-size:0.9em; color:var(--text-tertiary);">Nothing standing out in the rankings for this period yet.</div>`;
        }

        return header + rows.map(r => `<div style="padding:5px 0; font-size:0.9em; color:var(--text-primary);">${r}</div>`).join('');
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
            (person ? renderToneRow() : '') +
            `<div id="myTeamDayMessage"></div>` +
            `<details style="margin-top:18px; border:1px solid var(--border); border-radius:10px; padding:12px 16px; background:var(--bg-surface-raised);" open>` +
                `<summary style="cursor:pointer; font-weight:700; color:var(--text-secondary);">What's behind it</summary>` +
                `<div id="myTeamDayContext" style="margin-top:10px;"></div>` +
            `</details>`;

        container.querySelectorAll('.mt-tone-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tone = btn.dataset.tone;
                if (tone === 'growth') {
                    // Growth already has a picker for which comparison to run,
                    // so open that rather than guessing one.
                    await mods().morningPulse?.showGrowthModal?.(person);
                    return;
                }
                activeTone = activeTone === tone ? null : tone;
                await renderDayPage();
            });
        });

        container.querySelectorAll('.mt-day-tab').forEach(btn => {
            btn.addEventListener('click', async () => {
                activeTone = null;
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
            if (activeTone === 'highfive') {
                await renderHighFive(messageEl, person);
            } else {
                if (mods().dayPosts?.saveDayChoice) mods().dayPosts.saveDayChoice(dayId);
                await mods().dayPosts?.renderDayPosts?.(messageEl, person);
            }
        } else {
            renderTeamDay(messageEl, plan);
        }

        const contextEl = document.getElementById('myTeamDayContext');
        if (contextEl) contextEl.innerHTML = buildContextHtml(person);
    }

    // The two private messages that aren't tied to a weekday. They used to live
    // on the Weekly Pulse cards, which is why it was never obvious they were
    // the same kind of thing as a day post.
    function renderToneRow() {
        const tone = (id, label, hint) => {
            const on = activeTone === id;
            return `<button type="button" class="mt-tone-btn" data-tone="${id}" title="${escapeHtml(hint)}" ` +
                `style="padding:6px 14px; border:1px solid ${on ? '#4527a0' : 'var(--border)'}; border-radius:999px; font-size:0.85em; cursor:pointer; ` +
                `background:${on ? '#ede7f6' : 'var(--bg-surface)'}; color:${on ? '#4527a0' : 'var(--text-secondary)'}; font-weight:600;">${label}</button>`;
        };
        return `<div style="display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap;">` +
            `<span style="font-size:0.82em; color:var(--text-tertiary);">Also send:</span>` +
            tone('highfive', '🎉 High five', 'Pure praise, no coaching attached') +
            tone('growth', '📈 Growth', 'How far they have come over a longer stretch') +
        `</div>`;
    }

    /**
     * Praise on its own, with nothing to work on attached. Kept separate from
     * the day posts because the moment you add a focus area it stops being a
     * high five.
     */
    async function renderHighFive(container, person) {
        if (!container) return;
        const pulse = mods().morningPulse;
        const periods = pulse?.resolveCheckinPeriods?.();

        let message = '';
        try {
            message = await pulse?.generateHighFiveMessage?.(person, periods?.latestKey, periods?.baselineKey) || '';
        } catch (e) { message = ''; }

        if (!message) {
            container.innerHTML = `<div style="padding:24px; text-align:center; color:var(--text-secondary); background:var(--bg-surface); border:1px solid var(--border); border-radius:10px;">` +
                `Not enough in the latest week to build a high five for ${escapeHtml(person)} yet.` +
            `</div>`;
            return;
        }

        container.innerHTML = `<textarea id="myTeamHighFiveText" style="width:100%; min-height:200px; padding:12px; border:1px solid var(--border); border-radius:8px; font-size:0.92em; line-height:1.6; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(message)}</textarea>` +
            `<div style="display:flex; gap:8px; margin-top:10px;">` +
                `<button type="button" id="myTeamHighFiveCopy" style="flex:1; background:linear-gradient(135deg,#10b981,#059669); color:#fff; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">📋 Copy</button>` +
                `<button type="button" id="myTeamHighFiveRegen" style="background:var(--bg-surface-raised); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; padding:10px 16px; cursor:pointer;">🔄 Regenerate</button>` +
            `</div>`;

        container.querySelector('#myTeamHighFiveCopy')?.addEventListener('click', () => {
            const value = container.querySelector('#myTeamHighFiveText')?.value || '';
            if (typeof window.copyToClipboard === 'function') window.copyToClipboard(value, { message: `Copied ${person}` });
        });
        container.querySelector('#myTeamHighFiveRegen')?.addEventListener('click', () => renderHighFive(container, person));
    }

    /**
     * The whole-team view. Two things, because two things are what a team day
     * is for: something public for the Teams channel that names people, and
     * the private per-person round.
     */
    function renderTeamDay(container, plan) {
        if (!container) return;

        container.innerHTML = `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px;">` +
            `<button type="button" id="myTeamShoutOut" style="text-align:left; padding:16px; border:1px solid #ffcc80; border-radius:10px; background:var(--bg-surface); cursor:pointer;">` +
                `<div style="font-weight:700; color:#e65100; margin-bottom:4px;">📣 Team shout-out</div>` +
                `<div style="font-size:0.86em; color:var(--text-secondary);">One post for the Teams channel, naming who earned it. Public.</div>` +
            `</button>` +
            `<button type="button" id="myTeamRunSweep" style="text-align:left; padding:16px; border:1px solid #c7b3ff; border-radius:10px; background:var(--bg-surface); cursor:pointer;">` +
                `<div style="font-weight:700; color:#4527a0; margin-bottom:4px;">✉️ Private round</div>` +
                `<div style="font-size:0.86em; color:var(--text-secondary);">One ${escapeHtml(plan.label)} per associate, sent to them directly. Anyone already sent is pulled out.</div>` +
            `</button>` +
        `</div>` +
        `<div id="myTeamShoutOutSlot" style="margin-top:14px;"></div>`;

        container.querySelector('#myTeamRunSweep')?.addEventListener('click', async () => {
            const pulse = mods().morningPulse;
            if (pulse?.showRunMyDayModal) await pulse.showRunMyDayModal(document.getElementById('morningPulseContainer'));
        });

        container.querySelector('#myTeamShoutOut')?.addEventListener('click', () => renderShoutOut());
    }

    /**
     * The public post. Built from the same target-gated celebrations the day
     * page already shows underneath, so what goes in the channel and what you
     * see here can't drift apart.
     */
    function renderShoutOut() {
        const slot = document.getElementById('myTeamShoutOutSlot');
        if (!slot) return;

        const celebrations = mods().celebrations;
        if (!celebrations?.detectCelebrations) {
            slot.innerHTML = `<div style="color:var(--text-secondary);">Celebrations module is not loaded.</div>`;
            return;
        }

        let text = '';
        let count = 0;
        try {
            const result = celebrations.detectCelebrations(null);
            count = (result.celebrations || []).length;
            text = count
                ? celebrations.generateAllShoutOuts(result.celebrations, result.dateRange)
                : '';
        } catch (e) { text = ''; }

        if (!text) {
            slot.innerHTML = `<div style="padding:20px; border:1px solid var(--border); border-radius:10px; background:var(--bg-surface); color:var(--text-secondary);">` +
                `Nobody cleared both the ranking bar and their own target this period, so there is nothing to put in the channel yet.` +
            `</div>`;
            return;
        }

        slot.innerHTML = `<div style="padding:14px; border:1px solid #ffcc80; border-radius:10px; background:var(--bg-surface);">` +
            `<div style="font-weight:700; color:#e65100; margin-bottom:8px;">📣 Team shout-out — ${count} ${count === 1 ? 'person' : 'people'}</div>` +
            `<textarea id="myTeamShoutOutText" style="width:100%; min-height:240px; padding:12px; border:1px solid var(--border); border-radius:6px; font-size:0.9em; line-height:1.6; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(text)}</textarea>` +
            `<button type="button" id="myTeamShoutOutCopy" style="margin-top:10px; background:linear-gradient(135deg,#f59e0b,#ea580c); color:#fff; border:none; border-radius:6px; padding:10px 20px; cursor:pointer; font-weight:bold;">📋 Copy for the channel</button>` +
        `</div>`;

        slot.querySelector('#myTeamShoutOutCopy')?.addEventListener('click', () => {
            const value = slot.querySelector('#myTeamShoutOutText')?.value || '';
            if (typeof window.copyToClipboard === 'function') {
                window.copyToClipboard(value, { message: 'Shout-out copied' });
            }
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
        renderToneRow,
        renderShoutOut,
        buildContextHtml,
        activeDayId,
        setActiveDay
    };
})();
