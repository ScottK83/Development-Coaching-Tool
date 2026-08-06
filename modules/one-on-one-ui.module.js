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

    function formatValue(key, value) {
        if (typeof window.formatMetricValue === 'function') return window.formatMetricValue(key, value);
        return String(value);
    }

    function todayIso() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function store(name) {
        const live = typeof window[name] === 'object' && window[name] ? window[name] : null;
        if (live) return live;
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

        // Year so far — the YTD upload is the honest source; it is already the
        // aggregate, so nothing here re-averages weekly numbers.
        const ytdKeys = sortedKeysByEnd(ytd);
        const ytdRow = ytdKeys.length ? rowFor(ytd[ytdKeys[ytdKeys.length - 1]], employeeName) : null;
        const yearToDate = [];
        if (ytdRow) {
            const profiles = mods().metricProfiles;
            const year = new Date().getFullYear();
            oneOnOne.talkableMetricKeys().forEach(key => {
                const value = parseFloat(ytdRow[key]);
                if (!Number.isFinite(value)) return;
                const target = profiles?.getYearTarget?.(key, year) || window.METRICS_REGISTRY?.[key]?.target;
                yearToDate.push({
                    key,
                    label: window.METRICS_REGISTRY?.[key]?.label || key,
                    value,
                    target: target ? parseFloat(target.value) : null
                });
            });
        }

        const monthKeys = sortedKeysByEnd(weekly, p => p?.metadata?.periodType === 'month');
        const lastMonth = monthKeys.length >= 2
            ? oneOnOne.compareSnapshots(
                oneOnOne.snapshotFromRow(rowFor(weekly[monthKeys[monthKeys.length - 2]], employeeName)),
                oneOnOne.snapshotFromRow(rowFor(weekly[monthKeys[monthKeys.length - 1]], employeeName)))
            : null;

        // "The last few weeks" is the newest completed week against the oldest
        // of the last four, so a steady climb reads as a climb rather than as
        // four small unremarkable steps.
        const weekKeys = sortedKeysByEnd(weekly, p => {
            const type = p?.metadata?.periodType;
            return !type || type === 'week';
        });
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
        const color = tone === 'up' ? 'var(--green-text)' : '#e65100';
        return entries.slice(0, 5).map(e =>
            `<div style="padding:4px 0; font-size:0.9em; color:var(--text-primary);">` +
                `<span style="color:${color}; font-weight:700;">${tone === 'up' ? '▲' : '▼'}</span> ` +
                `${escapeHtml(e.label)}: ${escapeHtml(formatValue(e.key, e.before))} → <strong>${escapeHtml(formatValue(e.key, e.after))}</strong>` +
            `</div>`).join('');
    }

    function section(title, bodyHtml, note) {
        if (!bodyHtml) return '';
        return `<div style="margin-bottom:18px;">` +
            `<div style="font-weight:700; color:#bf360c; margin-bottom:6px;">${escapeHtml(title)}` +
                (note ? ` <span style="font-weight:400; font-size:0.85em; color:var(--text-tertiary);">${escapeHtml(note)}</span>` : '') +
            `</div>` + bodyHtml +
        `</div>`;
    }

    function renderMeetingPrep() {
        const container = document.getElementById('oneOnOneContainer');
        if (!container) return;

        const oneOnOne = core();
        if (!oneOnOne) {
            container.innerHTML = '<div style="padding:20px; color:var(--text-secondary);">Meeting module failed to load.</div>';
            return;
        }

        const selected = mods().selectedAssociate?.get?.() || '';
        const names = rosterNames();
        const dateInput = document.getElementById('oneOnOneDate');
        const meetingDate = dateInput?.value || todayIso();

        const options = ['<option value="">Pick an associate…</option>']
            .concat(names.map(n => `<option value="${escapeHtml(n)}"${n === selected ? ' selected' : ''}>${escapeHtml(n)}</option>`))
            .join('');

        container.innerHTML = `<div style="display:flex; gap:12px; align-items:end; flex-wrap:wrap; margin-bottom:18px;">` +
                `<div><label for="oneOnOneWho" style="display:block; font-size:0.85em; font-weight:600; color:var(--text-secondary); margin-bottom:4px;">Associate</label>` +
                `<select id="oneOnOneWho" style="padding:9px 12px; border:1px solid var(--border-strong); border-radius:8px; min-width:240px; background:var(--bg-surface-raised); color:var(--text-primary);">${options}</select></div>` +
                `<div><label for="oneOnOneDate" style="display:block; font-size:0.85em; font-weight:600; color:var(--text-secondary); margin-bottom:4px;">Meeting date</label>` +
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
            body.innerHTML = `<div style="padding:30px; text-align:center; color:var(--text-secondary); background:var(--bg-surface); border:1px solid var(--border); border-radius:10px;">Pick an associate to build talking points.</div>`;
            return;
        }

        const h = gatherHorizons(who, date);
        const existing = h.history.find(m => m.date === date);

        const ytdHtml = h.yearToDate.length
            ? h.yearToDate.slice(0, 8).map(e => {
                const meets = e.target === null ? null
                    : (window.METRICS_REGISTRY?.[e.key]?.isReverse ? e.value <= e.target : e.value >= e.target);
                const colour = meets === null ? 'var(--text-secondary)' : (meets ? 'var(--green-text)' : '#e65100');
                return `<div style="padding:4px 0; font-size:0.9em;"><span style="color:${colour}; font-weight:700;">${meets === null ? '·' : (meets ? '✓' : '•')}</span> ` +
                    `${escapeHtml(e.label)}: <strong>${escapeHtml(formatValue(e.key, e.value))}</strong>` +
                    (e.target !== null ? ` <span style="color:var(--text-tertiary);">vs ${escapeHtml(formatValue(e.key, e.target))} target</span>` : '') + `</div>`;
            }).join('')
            : '';

        const sinceHtml = h.sinceLast
            ? (changeList(h.sinceLast.improved, 'up') + changeList(h.sinceLast.slipped, 'down'))
                || `<div style="font-size:0.9em; color:var(--text-secondary);">Holding roughly where they were.</div>`
            : '';

        const monthHtml = h.lastMonth ? (changeList(h.lastMonth.improved, 'up') + changeList(h.lastMonth.slipped, 'down')) : '';
        const weeksHtml = h.recentWeeks ? (changeList(h.recentWeeks.improved, 'up') + changeList(h.recentWeeks.slipped, 'down')) : '';

        const priorNotes = h.prior?.notes
            ? `<div style="white-space:pre-wrap; font-size:0.9em; color:var(--text-primary); background:var(--bg-surface-raised); border-left:3px solid #bf360c; padding:10px 12px; border-radius:4px;">${escapeHtml(h.prior.notes)}</div>`
            : '';

        const historyHtml = h.history.length
            ? `<details style="margin-top:16px; border:1px solid var(--border); border-radius:10px; padding:10px 14px; background:var(--bg-surface-raised);">` +
                `<summary style="cursor:pointer; font-weight:700; color:var(--text-secondary);">Past meetings (${h.history.length})</summary>` +
                h.history.slice().reverse().map(m => `<div style="padding:8px 0; border-bottom:1px solid var(--border);">` +
                    `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">` +
                        `<strong style="color:var(--text-primary);">${escapeHtml(m.date)}</strong>` +
                        `<button type="button" class="ooo-del" data-date="${escapeHtml(m.date)}" style="background:none; border:1px solid var(--border); border-radius:6px; padding:3px 10px; cursor:pointer; color:var(--text-secondary); font-size:0.82em;">Delete</button>` +
                    `</div>` +
                    (m.notes ? `<div style="white-space:pre-wrap; font-size:0.88em; color:var(--text-secondary); margin-top:4px;">${escapeHtml(m.notes)}</div>` : '') +
                `</div>`).join('') +
            `</details>`
            : '';

        body.innerHTML =
            section('The year so far', ytdHtml, 'from the YTD upload') +
            section(`Since we last met`, sinceHtml, h.sinceLast ? h.sinceLast.date : '') +
            section('Last month', monthHtml) +
            section('The last few weeks', weeksHtml) +
            section('What we said last time', priorNotes, h.prior ? h.prior.date : '') +
            `<div style="margin-top:8px;">` +
                `<label for="oneOnOneNotes" style="display:block; font-weight:700; color:#bf360c; margin-bottom:6px;">My notes for this one</label>` +
                `<textarea id="oneOnOneNotes" placeholder="What I want to raise. Observations, things to watch, what I promised them…" style="width:100%; min-height:150px; padding:12px; border:1px solid var(--border); border-radius:8px; font-size:0.92em; line-height:1.6; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(existing?.notes || '')}</textarea>` +
            `</div>` +
            `<div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">` +
                `<button type="button" id="oneOnOneSave" style="background:linear-gradient(135deg,#d84315,#bf360c); color:#fff; border:none; border-radius:6px; padding:10px 20px; cursor:pointer; font-weight:bold;">💾 ${existing ? 'Update' : 'Save'} this meeting</button>` +
                `<button type="button" id="oneOnOneCopy" style="background:var(--bg-surface-raised); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; padding:10px 20px; cursor:pointer;">📋 Copy talking points</button>` +
                `<span id="oneOnOneStatus" style="align-self:center; font-size:0.85em; color:var(--text-secondary);"></span>` +
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
            if (status) status.textContent = ok ? 'Saved.' : 'Could not save — storage may be full.';
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
