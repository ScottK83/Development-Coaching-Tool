(function () {
    'use strict';

    /**
     * ONE-ON-ONE MEETING PREP — the screen.
     *
     * Pick a person and a date, get the numbers already argued, type what you
     * actually want to say, save it. The next meeting opens against the one
     * you saved.
     */

    function mods() { return window.DevCoachModules || {}; }
    function core() { return mods().oneOnOne; }

    function escapeHtml(value) {
        const shared = mods().sharedUtils?.escapeHtml;
        if (shared) return shared(value);
        return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // With units, the same as the copied sheet: the screen showed "96.2 vs
    // 93.0 target" (Scott, 2026-10-14).
    function formatValue(key, value) {
        const shared = core()?.formatValue;
        if (typeof shared === 'function') return shared(key, value);
        if (typeof window.formatMetricDisplay === 'function') return window.formatMetricDisplay(key, value);
        return String(value);
    }

    function formatDate(dateText) {
        const shared = core()?.formatDate;
        return typeof shared === 'function' ? shared(dateText) : (dateText || '');
    }

    function todayIso() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // Reads go through the storage module.
    //
    // These used to check `window.weeklyData` first and fall back to storage.
    // script.js declares those globals with `let`, which creates a script-scope
    // binding and never a property on window, and nothing anywhere assigns
    // them -- so in a browser the check was always false and the fallback was
    // always what ran. It was not merely dead, it was actively misleading: the
    // test harness DOES put fixtures on window, so tests took the cheap branch
    // the browser can never reach. A picker benchmark read 1 ms under test and
    // 3150 ms in the shape a browser actually runs.
    function store(name) {
        const loaders = { weeklyData: 'loadWeeklyData', ytdData: 'loadYtdData' };
        return mods().storage?.[loaders[name]]?.() || {};
    }

    function sortedKeysByEnd(data, predicate) {
        return Object.keys(data || {})
            .filter(key => (predicate ? predicate(data[key], key) : true))
            .sort((a, b) => {
                const ea = data[a]?.metadata?.endDate || (a.includes('|') ? a.split('|')[1] : a);
                const eb = data[b]?.metadata?.endDate || (b.includes('|') ? b.split('|')[1] : b);
                return String(ea).localeCompare(String(eb));
            });
    }

    function rowFor(period, employeeName) {
        return (period?.employees || []).find(e => String(e?.name || '').trim() === employeeName) || null;
    }

    // --- The four horizons ---

    /**
     * Gathers what each horizon can actually say. Every one is allowed to come
     * back empty; the sheet leaves out what it has nothing for rather than
     * printing an empty heading.
     */
    function gatherHorizons(employeeName, meetingDate) {
        const oneOnOne = core();
        const weekly = store('weeklyData');
        const ytd = store('ytdData');

        // Year so far. The YTD upload is the honest source; it is already the
        // aggregate, so nothing here re-averages weekly numbers.
        const ytdKeys = sortedKeysByEnd(ytd);
        const ytdRow = ytdKeys.length ? rowFor(ytd[ytdKeys[ytdKeys.length - 1]], employeeName) : null;
        // The four KPIs first, with a survey score left out when fewer than
        // three people answered (one-on-one's yearToDateEntries).
        const profiles = mods().metricProfiles;
        const year = new Date().getFullYear();
        const yearToDate = oneOnOne.yearToDateEntries(ytdRow,
            key => profiles?.getYearTarget?.(key, year) || window.METRICS_REGISTRY?.[key]?.target || null);

        const monthKeys = sortedKeysByEnd(weekly, p => p?.metadata?.periodType === 'month');
        const lastMonth = monthKeys.length >= 2
            ? oneOnOne.compareSnapshots(
                oneOnOne.snapshotFromRow(rowFor(weekly[monthKeys[monthKeys.length - 2]], employeeName)),
                oneOnOne.snapshotFromRow(rowFor(weekly[monthKeys[monthKeys.length - 1]], employeeName)))
            : null;

        // "The last few weeks" is the newest completed week against the oldest
        // of the last four, so a steady climb reads as a climb rather than as
        // four small unremarkable steps.
        const periodIndex = mods().periodIndex;
        const weekKeys = periodIndex
            ? periodIndex.completeWeekKeys(periodIndex.buildIndex({ weeklyData: weekly }))
            : [];
        const recentWeeks = weekKeys.length >= 2
            ? oneOnOne.compareSnapshots(
                oneOnOne.snapshotFromRow(rowFor(weekly[weekKeys[Math.max(0, weekKeys.length - 4)]], employeeName)),
                oneOnOne.snapshotFromRow(rowFor(weekly[weekKeys[weekKeys.length - 1]], employeeName)))
            : null;

        const currentSnapshot = weekKeys.length
            ? oneOnOne.snapshotFromRow(rowFor(weekly[weekKeys[weekKeys.length - 1]], employeeName))
            : {};

        const history = oneOnOne.meetingsFor(employeeName);
        const prior = oneOnOne.previousMeeting(history, meetingDate);
        const sinceLast = prior
            ? Object.assign({ date: prior.date }, oneOnOne.compareSnapshots(prior.snapshot, currentSnapshot))
            : null;

        return { yearToDate, lastMonth, recentWeeks, sinceLast, currentSnapshot, history, prior };
    }

    // --- Rendering ---

    function changeList(entries, tone) {
        if (!entries?.length) return '';
        const toneClass = tone === 'up' ? 'tone-good' : 'tone-warn';
        return entries.slice(0, 5).map(e =>
            `<div class="text-primary" style="padding:4px 0; font-size:0.9em;">` +
                `<span class="${toneClass}" style="font-weight:700;">${tone === 'up' ? '▲' : '▼'}</span> ` +
                `${escapeHtml(e.label)}: ${escapeHtml(formatValue(e.key, e.before))} → <strong>${escapeHtml(formatValue(e.key, e.after))}</strong>` +
            `</div>`).join('');
    }

    function section(title, bodyHtml, note) {
        if (!bodyHtml) return '';
        return `<div style="margin-bottom:18px;">` +
            `<div class="section-title" style="margin-bottom:6px;">${escapeHtml(title)}` +
                (note ? ` <span class="text-faint" style="font-weight:400; font-size:0.85em;">${escapeHtml(note)}</span>` : '') +
            `</div>` + bodyHtml +
        `</div>`;
    }

    function renderMeetingPrep() {
        const container = document.getElementById('oneOnOneContainer');
        if (!container) return;

        const oneOnOne = core();
        if (!oneOnOne) {
            container.innerHTML = '<div class="text-secondary" style="padding:20px;">Meeting module failed to load.</div>';
            return;
        }

        const selected = mods().selectedAssociate?.get?.() || '';
        const names = rosterNames();
        const dateInput = document.getElementById('oneOnOneDate');
        const meetingDate = dateInput?.value || todayIso();

        const options = mods().associatePicker.optionsHtml(names, { selected: selected });

        container.innerHTML = `<div style="display:flex; gap:12px; align-items:end; flex-wrap:wrap; margin-bottom:18px;">` +
                `<div><label for="oneOnOneWho" class="text-secondary" style="display:block; font-size:0.85em; font-weight:600; margin-bottom:4px;">Associate</label>` +
                `<select id="oneOnOneWho" style="padding:9px 12px; border:1px solid var(--border-strong); border-radius:8px; min-width:240px; background:var(--bg-surface-raised); color:var(--text-primary);">${options}</select></div>` +
                `<div><label for="oneOnOneDate" class="text-secondary" style="display:block; font-size:0.85em; font-weight:600; margin-bottom:4px;">Meeting date</label>` +
                `<input type="date" id="oneOnOneDate" value="${escapeHtml(meetingDate)}" style="padding:9px 12px; border:1px solid var(--border-strong); border-radius:8px; background:var(--bg-surface-raised); color:var(--text-primary);"></div>` +
            `</div>` +
            `<div id="oneOnOneBody"></div>`;

        container.querySelector('#oneOnOneWho')?.addEventListener('change', function () {
            if (this.value) mods().selectedAssociate?.set?.(this.value);
            renderBody();
        });
        container.querySelector('#oneOnOneDate')?.addEventListener('change', renderBody);

        renderBody();
    }

    function rosterNames() {
        const scope = mods().teamScope;
        const roster = scope?.getMyTeamRoster?.() || [];
        return roster;
    }

    function renderBody() {
        const body = document.getElementById('oneOnOneBody');
        if (!body) return;

        const oneOnOne = core();
        const who = document.getElementById('oneOnOneWho')?.value || '';
        const date = document.getElementById('oneOnOneDate')?.value || todayIso();

        if (!who) {
            body.innerHTML = `<div class="card text-secondary" style="padding:30px; text-align:center;">Pick an associate to build talking points.</div>`;
            return;
        }

        const h = gatherHorizons(who, date);
        const existing = h.history.find(m => m.date === date);

        const ytdHtml = h.yearToDate.length
            ? h.yearToDate.slice(0, 8).map(e => {
                const meets = e.target === null ? null
                    : (window.METRICS_REGISTRY?.[e.key]?.isReverse ? e.value <= e.target : e.value >= e.target);
                const toneClass = meets === null ? 'text-secondary' : (meets ? 'tone-good' : 'tone-warn');
                const goalWord = e.key === 'reliability' ? 'allowance' : 'goal';
                return `<div style="padding:4px 0; font-size:0.9em;"><span class="${toneClass}" style="font-weight:700;">${meets === null ? '·' : (meets ? '✓' : '•')}</span> ` +
                    `${escapeHtml(e.label)}: <strong>${escapeHtml(formatValue(e.key, e.value))}</strong>` +
                    (e.target !== null ? ` <span class="text-faint">${goalWord} ${escapeHtml(formatValue(e.key, e.target))}</span>` : '') + `</div>`;
            }).join('')
            : '';

        const sinceHtml = h.sinceLast
            ? (changeList(h.sinceLast.improved, 'up') + changeList(h.sinceLast.slipped, 'down'))
                || `<div class="text-secondary" style="font-size:0.9em;">Holding roughly where they were.</div>`
            : '';

        const monthHtml = h.lastMonth ? (changeList(h.lastMonth.improved, 'up') + changeList(h.lastMonth.slipped, 'down')) : '';
        const weeksHtml = h.recentWeeks ? (changeList(h.recentWeeks.improved, 'up') + changeList(h.recentWeeks.slipped, 'down')) : '';

        const priorNotes = h.prior?.notes
            ? `<div class="card-sunken text-primary" style="white-space:pre-wrap; font-size:0.9em;">${escapeHtml(h.prior.notes)}</div>`
            : '';

        const historyHtml = h.history.length
            ? `<details style="margin-top:16px; border:1px solid var(--border); border-radius:10px; padding:10px 14px; background:var(--bg-surface-raised);">` +
                `<summary class="text-secondary" style="cursor:pointer; font-weight:700;">Past meetings (${h.history.length})</summary>` +
                h.history.slice().reverse().map(m => `<div style="padding:8px 0; border-bottom:1px solid var(--border);">` +
                    `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">` +
                        `<strong style="color:var(--text-primary);">${escapeHtml(formatDate(m.date))}</strong>` +
                        `<button type="button" class="ooo-del btn-danger" data-date="${escapeHtml(m.date)}" style="min-height:0; padding:3px 10px; font-size:0.82em;">Delete</button>` +
                    `</div>` +
                    (m.notes ? `<div class="text-secondary" style="white-space:pre-wrap; font-size:0.88em; margin-top:4px;">${escapeHtml(m.notes)}</div>` : '') +
                `</div>`).join('') +
            `</details>`
            : '';

        // What to open on, the same lines the copied sheet leads with, so the
        // screen and the sheet start in the same place (Scott, 2026-10-14:
        // positive feedback in every piece of feedback).
        const working = oneOnOne.openingLines?.({
            yearToDate: h.yearToDate,
            sinceLast: h.sinceLast,
            lastMonth: h.lastMonth,
            recentWeeks: h.recentWeeks
        }) || [];
        const workingHtml = working.length
            ? working.map(line => `<div style="padding:4px 0; font-size:0.9em;"><span class="tone-good" style="font-weight:700;">✓</span> ${escapeHtml(line)}</div>`).join('')
            : '';

        body.innerHTML =
            section('Start with what is working', workingHtml) +
            section('The year so far', ytdHtml, 'from the YTD upload') +
            section(`Since we last met`, sinceHtml, h.sinceLast ? formatDate(h.sinceLast.date) : '') +
            section('Last month', monthHtml) +
            section('The last few weeks', weeksHtml) +
            section('What we said last time', priorNotes, h.prior ? formatDate(h.prior.date) : '') +
            `<div style="margin-top:8px;">` +
                `<label for="oneOnOneNotes" class="section-title" style="display:block; margin-bottom:6px;">My notes for this one</label>` +
                `<textarea id="oneOnOneNotes" placeholder="What I want to raise. Observations, things to watch, what I promised them…" style="width:100%; min-height:150px; padding:12px; border:1px solid var(--border); border-radius:8px; font-size:0.92em; line-height:1.6; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(existing?.notes || '')}</textarea>` +
            `</div>` +
            `<div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">` +
                `<button type="button" id="oneOnOneSave" class="btn-primary">${existing ? 'Update' : 'Save'} this meeting</button>` +
                `<button type="button" id="oneOnOneCopy" class="btn-secondary">Copy talking points</button>` +
                `<span id="oneOnOneStatus" class="text-secondary" style="align-self:center; font-size:0.85em;"></span>` +
            `</div>` +
            historyHtml;

        const sheet = () => oneOnOne.buildTalkingPoints({
            employeeName: who,
            date,
            yearToDate: h.yearToDate,
            sinceLast: h.sinceLast,
            lastMonth: h.lastMonth,
            recentWeeks: h.recentWeeks,
            previousNotes: h.prior?.notes || '',
            notes: document.getElementById('oneOnOneNotes')?.value || ''
        });

        body.querySelector('#oneOnOneSave')?.addEventListener('click', () => {
            // The snapshot is the point: the next meeting measures against
            // exactly these numbers, not a period reconstructed later.
            const ok = oneOnOne.saveMeeting(who, {
                date,
                notes: document.getElementById('oneOnOneNotes')?.value || '',
                snapshot: h.currentSnapshot,
                savedAt: new Date().toISOString()
            });
            const status = document.getElementById('oneOnOneStatus');
            if (status) status.textContent = ok ? 'Saved.' : 'Could not save, storage may be full.';
            if (ok) renderBody();
        });

        body.querySelector('#oneOnOneCopy')?.addEventListener('click', () => {
            if (typeof window.copyToClipboard === 'function') {
                window.copyToClipboard(sheet(), { message: 'Talking points copied' });
            }
        });

        body.querySelectorAll('.ooo-del').forEach(btn => {
            btn.addEventListener('click', () => {
                oneOnOne.deleteMeeting(who, btn.dataset.date);
                renderBody();
            });
        });
    }

    function initializeOneOnOne() {
        renderMeetingPrep();
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.oneOnOneUi = {
        initializeOneOnOne,
        renderMeetingPrep,
        renderBody,
        gatherHorizons
    };
})();
