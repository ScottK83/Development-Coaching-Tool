(function () {
    'use strict';

    /**
     * DAY POSTS
     *
     * One associate, five days. Pick Alyssa in the My Team "Who" dropdown and
     * this is what you get: a Monday post that recaps her last week against the
     * week before, a Tuesday follow-up, and Wednesday through Friday working off
     * how this week is going so far.
     *
     * You pick the day. It does not have to be Monday to write a Monday post —
     * the day sets what the message is allowed to talk about, not when you can
     * send it. Sends are tracked per person, per day, per week, so the tab can
     * tell you "you already sent Alyssa a Monday post this week".
     */

    const PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    const DAY_CHOICE_KEY = PREFIX + 'dayPostChoice';

    function escapeHtml(value) {
        const shared = window.DevCoachModules?.sharedUtils?.escapeHtml;
        if (shared) return shared(value);
        return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function preferredName(fullName) {
        if (typeof window.getEmployeeNickname === 'function') return window.getEmployeeNickname(fullName);
        return String(fullName || '').split(/[\s,]+/)[0] || fullName;
    }

    function loadDayChoice(defaultId) {
        try {
            const saved = localStorage.getItem(DAY_CHOICE_KEY);
            const outreach = window.DevCoachModules?.dailyOutreach;
            return outreach?.planById?.(saved) ? saved : defaultId;
        } catch (e) {
            return defaultId;
        }
    }

    function saveDayChoice(dayId) {
        try {
            localStorage.setItem(DAY_CHOICE_KEY, dayId);
        } catch (e) { /* choice just won't persist */ }
    }

    function shortDay(planId) {
        return planId.charAt(0).toUpperCase() + planId.slice(1, 3);
    }

    /**
     * The two periods a post is written from.
     *
     * My Team owns this now, because the window chips are the only control on
     * that page that claims to own time. A caller with no window to offer falls
     * back to the newest two weekly uploads, which is what this always did and
     * is still right for Run My Day, where the real calendar weekday decides.
     */
    function periodsFor(comparison) {
        // A window that was handed over is the answer, INCLUDING when it
        // resolved to nothing. Falling back to two weeks there is the bug this
        // whole change exists to remove: the page would announce "Month to
        // date", find no month-to-date upload, and quietly write a message
        // about the last two weekly files under that heading.
        if (comparison) return comparison;

        const pulse = window.DevCoachModules?.morningPulse;
        const fallback = pulse?.resolveCheckinPeriods?.() || null;
        if (!fallback) return null;
        return Object.assign({ unit: 'week', latestLabel: 'the latest week', baselineLabel: 'the week before' }, fallback);
    }

    /**
     * Everything the view needs for one person on one day: whether the data
     * backs the message, and whether it already went out this week.
     *
     * The period question moved. It used to be "does the tool hold what this
     * WEEKDAY claims to describe", which was the right question while the
     * weekday chose the period. The window chooses it now, so the question is
     * whether the window resolved to something with this person in it. Asking
     * the old one would block a Wednesday post because this week has not been
     * uploaded, while the month the page is actually showing sits right there.
     */
    function resolveContext(employeeName, planId, comparison) {
        const outreach = window.DevCoachModules?.dailyOutreach;
        const pulse = window.DevCoachModules?.morningPulse;
        if (!outreach || !pulse?.buildOutreachMessage) return null;

        const now = new Date();
        const todayIso = outreach.isoDate(now);
        const plan = outreach.planById(planId) || outreach.planForDate(now);
        const stamp = outreach.stampFor(plan, { todayIso });

        const periods = periodsFor(comparison);
        const daily = pulse.collectDailyRowsThisWeek?.() || { byName: new Map(), dayCount: 0 };
        const dailyEntry = daily.byName.get(employeeName) || null;

        const period = periods?.latestKey ? pulse.getPeriodDataForKey?.(periods.latestKey) : null;
        const inWeekly = Boolean((period?.employees || []).find(emp => String(emp?.name || '').trim() === employeeName));

        // Two different questions, asked in order. Does the tool hold the period
        // at all, and does it hold this person inside it? Answering them
        // separately is what lets the missing-upload case name itself instead of
        // reading as "this associate has no data".
        const weekEnd = latestWeekEnd(periods?.latestKey, period);
        const periodCheck = checkWindow(periods, period);

        const coverage = inWeekly
            ? { ok: true, reason: '', warning: baselineWarning(periods) }
            : { ok: false, reason: `Not in the ${periods?.latestLabel || 'selected'} upload.` };

        const sentEntry = outreach.getSentEntry(outreach.loadSentLog(), plan.id, stamp, employeeName);

        return { outreach, pulse, plan, stamp, periods, dailyEntry, periodCheck, coverage, sentEntry, todayIso, weekEnd };
    }

    /**
     * Whether the window the page is showing can back a message at all.
     *
     * Per period rather than per person, the same way checkPeriodData was, so
     * the answer is worked out once before any message is written.
     */
    function checkWindow(periods, period) {
        if (!periods || !periods.latestKey) {
            return {
                ok: false,
                reason: 'Missing data from this period.',
                detail: periods?.reason || 'Nothing uploaded covers the window you picked.'
            };
        }
        if (!period?.employees?.length) {
            return {
                ok: false,
                reason: 'Missing data from this period.',
                detail: `The upload behind ${periods.latestLabel || 'this window'} has no associate rows in it.`
            };
        }
        return { ok: true, reason: '', detail: `Using ${periods.latestLabel || 'the selected period'}.` };
    }

    // A message with no other side still goes out. It just cannot say anything
    // moved, so the warning says which half is missing rather than letting the
    // copy quietly read as though nothing changed.
    function baselineWarning(periods) {
        if (!periods || periods.baselineKey) return '';
        return periods.reason
            ? `No comparison in this message. ${periods.reason}`
            : 'No comparison in this message, because there is nothing earlier to measure against.';
    }

    function latestWeekEnd(latestKey, period) {
        if (period?.metadata?.endDate) return period.metadata.endDate;
        if (latestKey && latestKey.indexOf('|') > -1) return latestKey.split('|')[1];
        return latestKey || '';
    }

    /**
     * comparison is the window My Team is showing. Left out, the posts fall back
     * to the newest two weekly uploads, which is what they always did.
     */
    async function renderDayPosts(container, employeeName, comparison) {
        if (!container) return;

        const outreach = window.DevCoachModules?.dailyOutreach;
        if (!outreach || !employeeName) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }
        container.style.display = 'block';

        const todayPlan = outreach.planForDate(new Date());
        const defaultDay = outreach.WEEKDAY_IDS.indexOf(todayPlan.id) > -1 ? todayPlan.id : 'monday';
        const dayId = loadDayChoice(defaultDay);
        const ctx = resolveContext(employeeName, dayId, comparison);

        if (!ctx) {
            container.innerHTML = `<div style="padding:20px; color:var(--text-secondary);">Message modules failed to load.</div>`;
            return;
        }

        const who = preferredName(employeeName);
        const sentLog = outreach.loadSentLog();

        // Every day carries its own sent flag, so the row of buttons doubles as
        // a "what have I already sent her this week" summary. No day is blocked
        // any more: whether the data backs a message is a question about the
        // window, asked once above, and it has the same answer for all five.
        const buttons = outreach.weekdayPlans().map(plan => {
            const active = plan.id === ctx.plan.id;
            const sent = Boolean(outreach.getSentEntry(sentLog, plan.id, ctx.stamp, employeeName));

            const bg = active ? 'linear-gradient(135deg,#7c4dff,#4527a0)' : (sent ? '#e8f5e9' : '#e2e8f0');
            const color = active ? '#fff' : (sent ? '#2e7d32' : 'var(--text-secondary)');
            const mark = sent ? '✓ ' : '';
            const tip = `${plan.label}. ${plan.styleLabel || ''}`.trim();

            return `<button type="button" class="day-post-btn" data-day="${plan.id}" title="${escapeHtml(tip)}" ` +
                `style="padding:9px 16px; border:none; border-radius:8px; font-weight:700; font-size:0.9em; cursor:pointer; background:${bg}; color:${color};">` +
                `${mark}${shortDay(plan.id)}</button>`;
        }).join('');

        const sentBanner = ctx.sentEntry
            ? `<div style="margin-bottom:12px; padding:10px 14px; background:#e8f5e9; border-left:4px solid #2e7d32; border-radius:6px; color:#2e7d32; font-size:0.9em;">` +
                `You already sent ${escapeHtml(who)} a ${escapeHtml(ctx.plan.label)} this week` +
                (ctx.sentEntry.at ? `, ${escapeHtml(new Date(ctx.sentEntry.at).toLocaleString())}` : '') +
                `. <button type="button" id="dayPostUnsend" style="background:none; border:1px solid #2e7d32; border-radius:6px; padding:2px 10px; margin-left:6px; cursor:pointer; color:#2e7d32;">Undo</button>` +
            `</div>`
            : '';

        const warning = ctx.coverage.warning
            ? `<div style="margin-bottom:12px; font-size:0.85em; color:#ef6c00;">⚠️ ${escapeHtml(ctx.coverage.warning)}</div>`
            : '';

        let bodyHtml;
        if (!ctx.periodCheck.ok) {
            // The period itself is missing, which is not the same as this
            // associate having no numbers. Say which one it is.
            bodyHtml = `<div style="padding:28px; text-align:center; color:var(--text-secondary); background:var(--bg-surface); border:1px solid #ef6c00; border-radius:10px;">` +
                `<div style="font-size:2.2em; margin-bottom:8px;">📭</div>` +
                `<div style="font-weight:700; color:#ef6c00; font-size:1.05em;">${escapeHtml(ctx.periodCheck.reason)}</div>` +
                `<div style="font-size:0.92em; margin-top:8px;">${escapeHtml(ctx.periodCheck.detail)}</div>` +
                `<div style="font-size:0.88em; margin-top:10px; color:var(--text-tertiary);">Pick a different window in <strong>Covering</strong> above, or upload the period this one is missing.</div>` +
            `</div>`;
        } else if (!ctx.coverage.ok) {
            bodyHtml = `<div style="padding:28px; text-align:center; color:var(--text-secondary); background:var(--bg-surface); border:1px solid var(--border); border-radius:10px;">` +
                `<div style="font-size:2.2em; margin-bottom:8px;">📥</div>` +
                `<div style="font-weight:600;">Can't write this one for ${escapeHtml(who)} yet.</div>` +
                `<div style="font-size:0.9em; margin-top:6px;">${escapeHtml(ctx.coverage.reason)}</div>` +
            `</div>`;
        } else {
            let message = '';
            try {
                message = await ctx.pulse.buildOutreachMessage(
                    ctx.outreach, ctx.plan, employeeName,
                    ctx.periods?.latestKey, ctx.periods?.baselineKey, ctx.dailyEntry,
                    ctx.periods
                ) || '';
            } catch (e) { message = ''; }

            bodyHtml = `<textarea id="dayPostText" style="width:100%; min-height:230px; padding:12px; border:1px solid var(--border); border-radius:8px; font-size:0.92em; line-height:1.6; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(message)}</textarea>` +
                `<div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">` +
                    `<button type="button" id="dayPostCopy" style="flex:1; min-width:140px; background:linear-gradient(135deg,#10b981,#059669); color:#fff; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">📋 Copy</button>` +
                    `<button type="button" id="dayPostRegen" style="background:var(--bg-surface-raised); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; padding:10px 16px; cursor:pointer;">🔄 Regenerate</button>` +
                    `<button type="button" id="dayPostSent" style="background:${ctx.sentEntry ? '#c8e6c9' : '#e3f2fd'}; color:${ctx.sentEntry ? '#2e7d32' : '#1565c0'}; border:1px solid ${ctx.sentEntry ? '#81c784' : '#90caf9'}; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">${ctx.sentEntry ? '↩ Mark unsent' : '✓ Mark sent'}</button>` +
                `</div>`;
        }

        container.innerHTML = `<div style="margin-bottom:14px;">` +
                `<h3 style="color:#4527a0; margin:0 0 6px 0;">📮 Posts for ${escapeHtml(employeeName)}</h3>` +
                `<p style="color:var(--text-secondary); margin:0; font-size:0.9em;">` +
                    `<strong>${escapeHtml(ctx.plan.label)}</strong>, over ${escapeHtml(ctx.periods?.latestLabel || 'the selected period')}. ` +
                    `Pick any day; you don't have to wait for it.` +
                `</p>` +
            `</div>` +
            `<div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">${buttons}</div>` +
            sentBanner + warning + bodyHtml;

        container.querySelectorAll('.day-post-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                saveDayChoice(btn.dataset.day);
                await renderDayPosts(container, employeeName, comparison);
            });
        });

        const rerender = async () => renderDayPosts(container, employeeName, comparison);

        container.querySelector('#dayPostUnsend')?.addEventListener('click', async () => {
            outreach.clearSent(ctx.plan.id, ctx.stamp, employeeName);
            await rerender();
        });

        container.querySelector('#dayPostCopy')?.addEventListener('click', () => {
            const text = container.querySelector('#dayPostText')?.value || '';
            if (typeof window.copyToClipboard === 'function') {
                window.copyToClipboard(text, { message: `Copied ${who}'s ${ctx.plan.label}` });
            }
        });

        container.querySelector('#dayPostRegen')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            const original = btn.textContent;
            btn.textContent = '⏳';
            try {
                const msg = await ctx.pulse.buildOutreachMessage(
                    ctx.outreach, ctx.plan, employeeName,
                    ctx.periods?.latestKey, ctx.periods?.baselineKey, ctx.dailyEntry,
                    ctx.periods
                );
                const textarea = container.querySelector('#dayPostText');
                if (msg && textarea) textarea.value = msg;
            } catch (error) {
                // Said on screen: there is no console to read, and a button that
                // silently does nothing reads as broken.
                console.error('[day-posts] A button action failed:', error);
                if (typeof showToast === 'function') showToast('⚠️ Could not finish that: ' + (error?.message || error), 5000);
            } finally {
                btn.disabled = false;
                btn.textContent = original;
            }
        });

        container.querySelector('#dayPostSent')?.addEventListener('click', async () => {
            if (ctx.sentEntry) {
                outreach.clearSent(ctx.plan.id, ctx.stamp, employeeName);
            } else {
                outreach.markSent(ctx.plan.id, ctx.stamp, employeeName, new Date().toISOString());
            }
            await rerender();
        });
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.dayPosts = {
        renderDayPosts,
        resolveContext,
        latestWeekEnd,
        loadDayChoice,
        saveDayChoice,
        shortDay
    };
})();
