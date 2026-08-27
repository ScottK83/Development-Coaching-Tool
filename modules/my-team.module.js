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
    // Which stretch of time the shout-out and the evidence under it cover.
    // Remembered, because a manager who posts month to date posts month to date
    // every week and should not have to say so every week.
    const WINDOW_KEY = PREFIX + 'myTeamShoutOutWindow';

    // The high five is not a weekday post, so it gets its own id in the shared
    // outreach send log rather than borrowing a day's.
    const HIGH_FIVE_PLAN_ID = 'highfive';

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

    // --- The stretch of time the celebrations are measured over ---

    // Where the page starts before anybody picks. The header announces what
    // the day covers, so opening on a different stretch of time makes the two
    // halves of one screen disagree. Friday saying "the week you just worked"
    // over a month-to-date field is the version of that which got noticed. An
    // unavailable default falls back to the latest upload the same as a stale
    // saved pick does, so this only ever moves the starting point.
    // In order of preference, so a day whose own week has nothing usable
    // behind it lands on a real finished week rather than on whichever upload
    // happens to be newest. "Latest" is an honest choice when you make it and a
    // poor one to be dropped into: it carries no label, so a month-to-date file
    // sits unannounced under a header promising a week.
    const DEFAULT_WINDOW_BY_COVERAGE = {
        thisWeek: ['thisWeek', 'lastWeek'],
        lastWeek: ['lastWeek'],
        lastWeekPlusMonday: ['lastWeek']
    };

    function defaultWindowId() {
        try {
            const plan = mods().dailyOutreach?.planById?.(activeDayId());
            const wanted = DEFAULT_WINDOW_BY_COVERAGE[plan?.covers];
            if (!wanted) return 'latest';

            const windows = mods().celebrations?.listShoutOutWindows?.() || [];
            if (!windows.length) return wanted[0];

            const usable = wanted.filter(id => windows.some(w => w.id === id && w.available));
            return usable[0] || 'latest';
        } catch (e) {
            return 'latest';
        }
    }

    function activeWindowId() {
        try {
            return localStorage.getItem(WINDOW_KEY) || defaultWindowId();
        } catch (e) {
            return 'latest';
        }
    }

    function setActiveWindow(windowId) {
        try { localStorage.setItem(WINDOW_KEY, windowId); } catch (e) { /* not persisted */ }
    }

    const LATEST_WINDOW = { id: 'latest', label: 'Latest upload', key: null, dateRange: '', count: 0, available: true, reason: '' };

    /**
     * The window actually in force, which is not always the one saved. An
     * upload can be deleted and a week always stops being this week, so a saved
     * choice goes stale on its own. Falling back to the latest upload is what
     * this page did before any of it was selectable.
     */
    function currentWindow() {
        const resolve = mods().celebrations?.resolveShoutOutWindow;
        if (!resolve) return LATEST_WINDOW;
        try {
            return resolve(activeWindowId()) || LATEST_WINDOW;
        } catch (e) {
            return LATEST_WINDOW;
        }
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
            // Only meaningful for one person, a team sweep tracks sends per rep.
            const sent = person && Boolean(outreach.getSentEntry(sentLog, plan.id, stamp, person));

            const bg = active ? 'linear-gradient(135deg,#7c4dff,#4527a0)' : (blocked ? '#f5f5f5' : (sent ? '#e8f5e9' : '#eef1f6'));
            const color = active ? '#fff' : (blocked ? 'var(--text-tertiary)' : (sent ? '#2e7d32' : 'var(--text-secondary)'));
            const mark = blocked ? '⚠️ ' : (sent ? '✓ ' : '');
            const tip = blocked
                ? `${plan.label}, ${status[plan.id].reason} ${status[plan.id].detail}`
                : `${plan.label}, covers ${plan.coverageLabel}`;
            const dayName = plan.id.charAt(0).toUpperCase() + plan.id.slice(1);

            return `<button type="button" class="mt-day-tab" data-day="${plan.id}" title="${escapeHtml(tip)}" ` +
                `style="padding:10px 18px; border:${blocked ? '1px dashed var(--border-strong)' : 'none'}; border-radius:8px; font-weight:700; font-size:0.95em; cursor:pointer; background:${bg}; color:${color};">` +
                `${mark}${dayName}</button>`;
        }).join('');

        // The rest of My Team is a quieter second group. Still one click away,
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
    // How many celebrated people the panel lists before it starts summarising.
    // Whatever is cut gets counted out loud. A list that silently stops at
    // four reads as "these four are all there were".
    const CONTEXT_ROW_LIMIT = 6;

    function buildContextHtml(person) {
        const rows = [];
        let header = '';
        let footer = '';

        const celebrations = mods().celebrations;
        if (celebrations?.detectCelebrations) {
            try {
                // The same window the post is built from. These two sit one
                // under the other, so a panel measuring a different stretch of
                // time than the message above it is worse than no panel at all.
                const chosen = currentWindow();
                const result = celebrations.detectCelebrations(chosen.key);

                // A rank means nothing without the period it was earned in and
                // the size of the field. Both were being left to memory.
                const headerBits = [];
                if (chosen.id !== 'latest') headerBits.push(escapeHtml(chosen.label));
                if (result.dateRange) headerBits.push(escapeHtml(result.dateRange));
                if (result.totalEmployees) headerBits.push(`${result.totalEmployees} associates scored in the center`);
                if (headerBits.length) {
                    header = `<div style="padding:0 0 8px; font-size:0.85em; color:var(--text-secondary); font-weight:600;">${headerBits.join(' · ')}</div>`;
                }

                const all = result.celebrations || [];
                all.slice(0, CONTEXT_ROW_LIMIT).forEach(entry => {
                    const best = entry.achievements?.[0];
                    // Somebody carried by a flawless survey week holds no
                    // placing at all, and that is still worth a line.
                    if (!best) {
                        if (entry.perfectSurveys && celebrations.perfectSurveyLine) {
                            rows.push(`🎉 <strong>${escapeHtml(entry.firstName)}</strong>, ` +
                                `<span style="color:var(--text-tertiary);">${escapeHtml(celebrations.perfectSurveyLine(entry.perfectSurveys))}</span>`);
                        }
                        return;
                    }
                    // The placing says the rank, the tie and the pool in one
                    // breath. Pairing a bare "#1 in Center" with a beaten-count
                    // that excluded ties read as a contradiction.
                    const placing = celebrations.describePlacement ? celebrations.describePlacement(best) : '';
                    const tail = placing
                        ? ` <span style="color:var(--text-tertiary);">· ${escapeHtml(placing)}</span>`
                        : '';
                    rows.push(`🎉 <strong>${escapeHtml(entry.firstName)}</strong>, ${escapeHtml(best.label)}${tail}`);
                });

                const hidden = all.length - Math.min(all.length, CONTEXT_ROW_LIMIT);
                if (hidden > 0) {
                    footer += `<div style="padding:6px 0 0; font-size:0.85em; color:var(--text-tertiary);">` +
                        `+ ${hidden} more not shown. The shout-out post has all ${all.length}.</div>`;
                }

                // Near misses are deliberately NOT listed inline. This panel sits
                // directly under the shout-outs, so whoever came closest would end
                // up the lone name under a list of winners. It reads as calling
                // them out for not making it, which is the opposite of the intent.
                //
                // Folded away is a different thing. "Why isn't she in here?" was
                // otherwise unanswerable without reading the source, and the
                // sentences already exist; they just had nowhere to be shown.
                footer += buildMissedHtml(celebrations, result);
            } catch (e) { /* context is optional. Never block the message on it */ }
        }

        // The header survives an empty result on purpose. "Nothing standing
        // out" is a different fact about year to date than it is about two days
        // of this week, and the window you are looking at is the only thing
        // that tells them apart.
        if (!rows.length) {
            return header +
                `<div style="font-size:0.9em; color:var(--text-tertiary);">Nothing standing out in the rankings for this period yet.</div>` +
                footer;
        }

        return header + rows.map(r => `<div style="padding:5px 0; font-size:0.9em; color:var(--text-primary);">${r}</div>`).join('') + footer;
    }

    /**
     * Everyone in scope who didn't make the post, and why — folded shut.
     *
     * detectCelebrations has always worked this out and nothing ever rendered
     * it, so the only way to answer "why isn't Sabrina in here" was to read four
     * modules. Each reason calls for a different response: a thin week is a
     * roster question, a withheld value is an upload question, and "ranks #4 but
     * is short of target" is a coaching conversation.
     */
    function buildMissedHtml(celebrations, result) {
        const missed = result?.missed || [];
        if (!missed.length || !celebrations?.describeNoCelebration) return '';

        const lines = missed.map(info => {
            let sentence = '';
            try { sentence = celebrations.describeNoCelebration(info) || ''; } catch (e) { sentence = ''; }
            return sentence ? `<div style="padding:4px 0; font-size:0.88em; color:var(--text-secondary);">${escapeHtml(sentence)}</div>` : '';
        }).filter(Boolean);

        if (!lines.length) return '';

        return `<details style="margin-top:12px; border-top:1px solid var(--border); padding-top:10px;">` +
            `<summary style="cursor:pointer; font-size:0.85em; color:var(--text-tertiary);">` +
                `Who didn't make it, and why (${lines.length})</summary>` +
            `<div style="margin-top:8px;">${lines.join('')}</div>` +
        `</details>`;
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
            renderWindowPicker(currentWindow().id) +
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

        bindWindowPicker(container.querySelector('#myTeamWindowPicker'));

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
     * The whole-team view. Three things, because three things are what a team
     * day is for: something public for the Teams channel that names people, the
     * private per-person round, and praise on its own for everybody.
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
            `<button type="button" id="myTeamHighFiveAll" style="text-align:left; padding:16px; border:1px solid #a5d6a7; border-radius:10px; background:var(--bg-surface); cursor:pointer;">` +
                `<div style="font-weight:700; color:#2e7d32; margin-bottom:4px;">🎉 High five round</div>` +
                `<div style="font-size:0.86em; color:var(--text-secondary);">One high five per associate, written in a single pass. Copy them one at a time.</div>` +
            `</button>` +
        `</div>` +
        `<div id="myTeamShoutOutSlot" style="margin-top:14px;"></div>`;

        container.querySelector('#myTeamRunSweep')?.addEventListener('click', async () => {
            const pulse = mods().morningPulse;
            if (pulse?.showRunMyDayModal) await pulse.showRunMyDayModal(document.getElementById('morningPulseContainer'));
        });

        container.querySelector('#myTeamShoutOut')?.addEventListener('click', () => renderShoutOut());
        container.querySelector('#myTeamHighFiveAll')?.addEventListener('click', () => renderHighFiveRound());
    }

    /**
     * A high five for everyone on the roster, written in one pass.
     *
     * The single-person high five has always been here, but running the whole
     * team meant picking eighteen names out of a dropdown one after another.
     * This writes the round in one go and then hands them over one at a time,
     * because one at a time is how they get sent — there is no bulk send, and a
     * high five pasted into the wrong chat is worse than one never sent.
     *
     * Whoever the week cannot back is listed rather than dropped. A round of
     * fourteen against a roster of eighteen looks like a bug unless the other
     * four are named.
     */
    async function buildHighFiveRound(onProgress) {
        const pulse = mods().morningPulse;
        if (!pulse?.generateHighFiveMessage) return { ready: [], skipped: [], blocked: 'noModule' };

        const roster = mods().teamScope?.getMyTeamRoster?.() || [];
        if (!roster.length) return { ready: [], skipped: [], blocked: 'noRoster' };

        // Which of these already went out, from the same log the day posts use.
        // The ticks were session-only, so getting pulled away nine names into
        // eighteen meant coming back and guessing.
        const sent = highFiveSentState();

        const periods = pulse.resolveCheckinPeriods?.();
        const ready = [];
        const skipped = [];

        for (let i = 0; i < roster.length; i++) {
            const name = roster[i];
            if (onProgress) onProgress(i + 1, roster.length, name);
            let message = '';
            try {
                message = await pulse.generateHighFiveMessage(name, periods?.latestKey, periods?.baselineKey) || '';
            } catch (e) {
                // One associate the generator chokes on must not take the other
                // seventeen with it. They land in skipped like any thin week.
                message = '';
            }
            const entry = { name: name, message: message, sent: sent.isSent(name) };
            (message ? ready : skipped).push(entry);
        }

        return { ready: ready, skipped: skipped, blocked: null };
    }

    /**
     * The high five's corner of the outreach send log.
     *
     * It isn't a weekday post, so it carries its own plan id and shares the
     * week stamp — "have I high-fived Alyssa this week" is the same shape of
     * question as "have I sent Alyssa her Tuesday post". Returns null-safe
     * no-ops when the outreach module isn't loaded, so the round still works
     * without them; it just forgets.
     */
    function highFiveSentState() {
        const outreach = mods().dailyOutreach;
        if (!outreach) {
            return { isSent: () => false, mark: () => {}, clear: () => {}, clearAll: () => {}, available: false };
        }
        const todayIso = outreach.isoDate(new Date());
        const stamp = outreach.stampFor(outreach.PLANS.monday, { todayIso });
        const log = outreach.loadSentLog();
        return {
            available: true,
            isSent: (name) => Boolean(outreach.getSentEntry(log, HIGH_FIVE_PLAN_ID, stamp, name)),
            mark: (name) => outreach.markSent(HIGH_FIVE_PLAN_ID, stamp, name, new Date().toISOString()),
            clear: (name) => outreach.clearSent(HIGH_FIVE_PLAN_ID, stamp, name),
            clearAll: () => outreach.clearAllSentForStamp(HIGH_FIVE_PLAN_ID, stamp)
        };
    }

    function highFiveNotice(text) {
        return `<div style="padding:20px; border:1px solid var(--border); border-radius:10px; background:var(--bg-surface); color:var(--text-secondary);">${escapeHtml(text)}</div>`;
    }

    async function renderHighFiveRound() {
        const slot = document.getElementById('myTeamShoutOutSlot');
        if (!slot) return;

        // Eighteen of these takes long enough that a panel sitting still reads
        // as a broken one, so the count moves while they're being written.
        const round = await buildHighFiveRound((done, total) => {
            slot.innerHTML = `<div style="padding:20px; border:1px solid #a5d6a7; border-radius:10px; background:var(--bg-surface); color:#2e7d32; font-weight:600;">` +
                `🎉 Writing high fives… ${done} of ${total}</div>`;
        });

        if (round.blocked === 'noModule') {
            slot.innerHTML = highFiveNotice('The weekly pulse module is not loaded, so nothing can be written.');
            return;
        }
        if (round.blocked === 'noRoster') {
            slot.innerHTML = highFiveNotice('There is nobody on your roster yet. Add your team under Settings first.');
            return;
        }
        if (!round.ready.length) {
            slot.innerHTML = highFiveNotice(`Nothing in the latest week backs a high five for anyone on the roster yet. All ${round.skipped.length} came back empty.`);
            return;
        }

        const rows = round.ready.map((entry, idx) =>
            `<div class="mt-hf-row" data-idx="${idx}" style="border:1px solid ${entry.sent ? '#a5d6a7' : 'var(--border)'}; border-radius:10px; padding:12px 14px; background:var(--bg-surface); margin-bottom:10px; opacity:${entry.sent ? '0.72' : '1'};">` +
                `<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">` +
                    `<strong style="color:var(--text-primary);">${escapeHtml(entry.name)}</strong>` +
                    `<button type="button" class="mt-hf-copy" data-idx="${idx}" ` +
                        `style="margin-left:auto; background:${entry.sent ? '#c8e6c9' : 'linear-gradient(135deg,#10b981,#059669)'}; color:${entry.sent ? '#2e7d32' : '#fff'}; border:none; border-radius:6px; padding:8px 18px; cursor:pointer; font-weight:bold;">` +
                        `${entry.sent ? '✓ Sent' : '📋 Copy'}</button>` +
                    `<button type="button" class="mt-hf-undo" data-idx="${idx}" title="Mark as not sent" ` +
                        `style="display:${entry.sent ? 'inline-block' : 'none'}; background:none; border:1px solid #81c784; color:#2e7d32; border-radius:6px; padding:8px 12px; cursor:pointer;">↩</button>` +
                `</div>` +
                `<textarea class="mt-hf-text" data-idx="${idx}" style="width:100%; min-height:130px; padding:10px; border:1px solid var(--border); border-radius:8px; font-size:0.9em; line-height:1.6; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(entry.message)}</textarea>` +
            `</div>`
        ).join('');

        const skippedHtml = round.skipped.length
            ? `<div style="margin-top:4px; padding:10px 14px; border:1px dashed var(--border-strong); border-radius:8px; color:var(--text-secondary); font-size:0.88em;">` +
                `<strong>${round.skipped.length} skipped</strong>. Not enough in the latest week to praise honestly: ` +
                escapeHtml(round.skipped.map(s => s.name).join(', ')) +
            `</div>`
            : '';

        const sentState = highFiveSentState();
        const doneCount = () => round.ready.filter(e => e.sent).length;

        slot.innerHTML = `<div style="padding:14px; border:1px solid #a5d6a7; border-radius:10px; background:var(--bg-surface);">` +
            `<div style="display:flex; align-items:baseline; gap:10px; margin-bottom:12px; flex-wrap:wrap;">` +
                `<div style="font-weight:700; color:#2e7d32;">🎉 High five round. ${round.ready.length} ready</div>` +
                `<div id="myTeamHighFiveProgress" style="font-size:0.85em; color:var(--text-tertiary);">${doneCount()} of ${round.ready.length} sent this week</div>` +
                `<span style="margin-left:auto; display:flex; gap:8px;">` +
                    `<button type="button" id="myTeamHighFiveClear" style="background:var(--bg-surface-raised); color:var(--text-secondary); border:1px solid var(--border); border-radius:6px; padding:6px 14px; cursor:pointer; font-size:0.85em;">↩ Clear ticks</button>` +
                    `<button type="button" id="myTeamHighFiveRerun" style="background:var(--bg-surface-raised); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; padding:6px 14px; cursor:pointer; font-size:0.85em;">🔄 Rewrite all</button>` +
                `</span>` +
            `</div>` +
            rows +
            skippedHtml +
        `</div>`;

        // The tick is the send log, not a session flag, so a long list survives
        // a reload halfway through and still reads as a queue you are working
        // down rather than eighteen identical buttons you have lost your place in.
        const progressEl = slot.querySelector('#myTeamHighFiveProgress');
        const refreshProgress = () => {
            if (progressEl) progressEl.textContent = `${doneCount()} of ${round.ready.length} sent this week`;
        };

        const paintRow = (idx) => {
            const entry = round.ready[idx];
            const row = slot.querySelector('.mt-hf-row[data-idx="' + idx + '"]');
            const copyBtn = slot.querySelector('.mt-hf-copy[data-idx="' + idx + '"]');
            const undoBtn = slot.querySelector('.mt-hf-undo[data-idx="' + idx + '"]');
            if (row) {
                row.style.border = '1px solid ' + (entry.sent ? '#a5d6a7' : 'var(--border)');
                row.style.opacity = entry.sent ? '0.72' : '1';
            }
            if (copyBtn) {
                copyBtn.textContent = entry.sent ? '✓ Sent' : '📋 Copy';
                copyBtn.style.background = entry.sent ? '#c8e6c9' : 'linear-gradient(135deg,#10b981,#059669)';
                copyBtn.style.color = entry.sent ? '#2e7d32' : '#fff';
            }
            if (undoBtn) undoBtn.style.display = entry.sent ? 'inline-block' : 'none';
            refreshProgress();
        };

        slot.querySelectorAll('.mt-hf-copy').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = btn.dataset.idx;
                const box = slot.querySelector('.mt-hf-text[data-idx="' + idx + '"]');
                const value = box ? box.value : '';
                if (typeof window.copyToClipboard === 'function') {
                    window.copyToClipboard(value, { message: `Copied ${round.ready[idx].name}` });
                }
                // Copying is the send here — there is no other button to press
                // between the clipboard and the chat window.
                round.ready[idx].sent = true;
                sentState.mark(round.ready[idx].name);
                paintRow(idx);
            });
        });

        slot.querySelectorAll('.mt-hf-undo').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = btn.dataset.idx;
                round.ready[idx].sent = false;
                sentState.clear(round.ready[idx].name);
                paintRow(idx);
            });
        });

        slot.querySelector('#myTeamHighFiveClear')?.addEventListener('click', () => {
            sentState.clearAll();
            round.ready.forEach((entry, idx) => { entry.sent = false; paintRow(idx); });
        });

        slot.querySelector('#myTeamHighFiveRerun')?.addEventListener('click', () => renderHighFiveRound());
    }

    /**
     * The public post. Built from the same target-gated celebrations the day
     * page already shows underneath, so what goes in the channel and what you
     * see here can't drift apart.
     */
    /**
     * Pick the stretch of time the post covers.
     *
     * A window with no upload behind it, or one whose upload is too thin to
     * rank a center against, stays on screen greyed out with the reason on
     * hover. Hiding it leaves "why can't I post year to date" unanswerable
     * without opening the Upload tab and counting rows.
     */
    function renderWindowPickerChips(chosenId) {
        const picker = mods().periodPicker;
        if (!picker) return '';
        return picker.renderChips(mods().celebrations?.listShoutOutWindows?.() || [], chosenId, {
            chipClass: 'mt-so-window'
        });
    }

    // The picker as it sits on the day page: one row, one id, above everything
    // it governs. It used to render only inside the shout-out card, which meant
    // the one control that answers "can this be the week instead of the month"
    // was behind a click on a button that already assumed the answer.
    function renderWindowPicker(chosenId) {
        const chips = renderWindowPickerChips(chosenId);
        if (!chips) return '';
        return `<div id="myTeamWindowPicker" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:12px;">${chips}</div>`;
    }

    /**
     * Changing the window rewrites the post and the evidence panel together.
     * Repainting only the post would leave the panel underneath quoting ranks
     * from a different stretch of time, and the panel is there to back the post
     * up rather than to argue with it.
     */
    function bindWindowPicker(root) {
        if (!root) return;
        mods().periodPicker?.bindRow(root, (id) => {
            setActiveWindow(id);
            refreshForWindow();
        }, { chipClass: 'mt-so-window' });
    }

    /**
     * Repaint the chips, the evidence panel and — only if it is already open —
     * the post. Rebuilding a shout-out that nobody asked for would make picking
     * a window the thing that opens the card, which is backwards: you change
     * the window to see what the numbers say, and then decide whether to post.
     */
    function refreshForWindow() {
        const chosen = currentWindow();

        const pickerEl = document.getElementById('myTeamWindowPicker');
        if (pickerEl) {
            pickerEl.innerHTML = renderWindowPickerChips(chosen.id);
            bindWindowPicker(pickerEl);
        }

        const contextEl = document.getElementById('myTeamDayContext');
        if (contextEl) {
            contextEl.innerHTML = buildContextHtml(mods().teamScope?.getActiveMember?.() || null);
        }

        const slot = document.getElementById('myTeamShoutOutSlot');
        if (slot && slot.innerHTML.trim()) renderShoutOut();
    }

    function renderShoutOut() {
        const slot = document.getElementById('myTeamShoutOutSlot');
        if (!slot) return;

        const celebrations = mods().celebrations;
        if (!celebrations?.detectCelebrations) {
            slot.innerHTML = `<div style="color:var(--text-secondary);">Celebrations module is not loaded.</div>`;
            return;
        }

        const chosen = currentWindow();

        let text = '';
        let count = 0;
        let dateRange = '';
        try {
            const result = celebrations.detectCelebrations(chosen.key);
            count = (result.celebrations || []).length;
            dateRange = result.dateRange || chosen.dateRange || '';
            text = count
                ? celebrations.generateAllShoutOuts(result.celebrations, dateRange, result.periodKey || chosen.key)
                : '';
        } catch (e) { text = ''; }

        // An empty window is the reason to go and try a different one, so the
        // sentence names the window it came up empty on. The chips that switch
        // it sit above this card on the day page.
        if (!text) {
            slot.innerHTML = `<div style="padding:14px; border:1px solid var(--border); border-radius:10px; background:var(--bg-surface);">` +
                `<div style="color:var(--text-secondary); font-size:0.92em;">Nobody cleared both the ranking bar and their own target ` +
                    `${chosen.id === 'latest' ? 'this period' : 'over ' + escapeHtml(chosen.label.toLowerCase())}, so there is nothing to put in the channel yet. ` +
                    `Try another window in <strong>Covering</strong> above.</div>` +
            `</div>`;
            return;
        }

        slot.innerHTML = `<div style="padding:14px; border:1px solid #ffcc80; border-radius:10px; background:var(--bg-surface);">` +
            `<div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; margin-bottom:8px;">` +
                `<div style="font-weight:700; color:#e65100;">📣 Team shout-out. ${count} ${count === 1 ? 'person' : 'people'}</div>` +
                (dateRange ? `<div style="font-size:0.82em; color:var(--text-tertiary);">${escapeHtml(dateRange)}</div>` : '') +
            `</div>` +
            // The preview carries the colour; the textarea carries the text.
            // A textarea cannot hold markup, and the post is pasted into a
            // channel that would show any markup literally, so the two are kept
            // apart rather than one being made to do both jobs. Copy reads the
            // textarea, so what lands in the channel is exactly what is typed
            // here, colour or no colour.
            `<div class="shoutout-legend">` +
                `<span>Placing:</span>` +
                `<span class="placement-tier placement-tier-first">#1</span>` +
                `<span class="placement-tier placement-tier-top5">Top 5</span>` +
                `<span class="placement-tier placement-tier-top10">Top 10</span>` +
                `<span class="placement-tier placement-tier-top25">Top 25</span>` +
                `<span style="margin-left:auto;">Colour is on screen only. The copied post is plain text.</span>` +
            `</div>` +
            `<div id="myTeamShoutOutPreview" class="shoutout-preview">${highlightShoutOut(text)}</div>` +
            `<label for="myTeamShoutOutText" style="display:block; font-size:0.78em; color:var(--text-tertiary); margin:10px 0 4px;">Edit before copying</label>` +
            `<textarea id="myTeamShoutOutText" style="width:100%; min-height:160px; padding:12px; border:1px solid var(--border); border-radius:6px; font-size:0.9em; line-height:1.6; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(text)}</textarea>` +
            `<div style="display:flex; gap:8px; margin-top:10px;">` +
                `<button type="button" id="myTeamShoutOutCopy" style="background:linear-gradient(135deg,#f59e0b,#ea580c); color:#fff; border:none; border-radius:6px; padding:10px 20px; cursor:pointer; font-weight:bold;">📋 Copy for the channel</button>` +
                `<button type="button" id="myTeamShoutOutRegen" style="background:var(--bg-surface-raised); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; padding:10px 16px; cursor:pointer;">🔄 Reword</button>` +
            `</div>` +
        `</div>`;

        // Edits have to show up in the preview, or the colour is describing a
        // post that no longer exists.
        const preview = slot.querySelector('#myTeamShoutOutPreview');
        slot.querySelector('#myTeamShoutOutText')?.addEventListener('input', function () {
            if (preview) preview.innerHTML = highlightShoutOut(this.value);
        });

        slot.querySelector('#myTeamShoutOutCopy')?.addEventListener('click', () => {
            const value = slot.querySelector('#myTeamShoutOutText')?.value || '';
            if (typeof window.copyToClipboard === 'function') {
                window.copyToClipboard(value, { message: 'Shout-out copied' });
            }
        });

        // Same people, same numbers, written a different way. The post is built
        // from pools, so this is just asking for another draw — worth having a
        // button for, since the alternative was leaving the page and coming back.
        slot.querySelector('#myTeamShoutOutRegen')?.addEventListener('click', () => renderShoutOut());
    }

    // Placement colouring lives in celebrations, which owns the placement
    // wording. If it is missing, the preview simply shows plain escaped text.
    function highlightShoutOut(text) {
        const fn = mods().celebrations?.highlightPlacements;
        return typeof fn === 'function' ? fn(text) : escapeHtml(String(text || ''));
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
        renderWindowPicker,
        renderWindowPickerChips,
        defaultWindowId,
        currentWindow,
        activeWindowId,
        setActiveWindow,
        buildHighFiveRound,
        renderHighFiveRound,
        buildContextHtml,
        activeDayId,
        setActiveDay
    };
})();
