/* ========================================
   CONTEST UI
   The panel for entering a day and reading the standings.

   Renders itself into an empty <section> rather than shipping its markup in
   index.html, which keeps the shell small and means the whole feature is three
   files: this, contest.module.js, and one store. It lifts out cleanly when the
   month is over.
   ======================================== */

(function () {
    'use strict';

    const STORE = 'contestData';
    let rendered = false;

    function esc(text) {
        const fn = window.DevCoachModules?.sharedUtils?.escapeHtml;
        return typeof fn === 'function' ? fn(String(text ?? '')) : String(text ?? '');
    }

    function contest() {
        return window.DevCoachModules?.contest;
    }

    // ============================================
    // STORAGE
    // ============================================

    function loadAll() {
        const read = window.DevCoachModules?.storage?.readStore;
        const value = typeof read === 'function' ? read(STORE) : undefined;
        return (value && typeof value === 'object') ? value : {};
    }

    function saveAll(all) {
        const save = window.DevCoachModules?.storage?.saveWithSizeCheck;
        return typeof save === 'function' ? save(STORE, all) : false;
    }

    function monthKeyFor(dateIso) {
        return String(dateIso || '').slice(0, 7);
    }

    function monthData(all, monthKey) {
        return all[monthKey] || { days: {} };
    }

    // ============================================
    // ROSTER
    // ============================================

    function teams() {
        const roster = window.SUPERVISOR_ROSTER;
        return Array.isArray(roster) ? roster : [];
    }

    function namesForTeam(supervisor) {
        if (supervisor === '__all__') {
            return teams().reduce((all, team) => all.concat(team.agents || []), []).sort();
        }
        const team = teams().find((t) => t.supervisor === supervisor);
        return (team?.agents || []).slice().sort();
    }

    function selectedTeam() {
        return document.getElementById('contestTeam')?.value || 'Scott';
    }

    // ============================================
    // RENDER
    // ============================================

    function panelHtml() {
        const teamOptions = teams().map((t) =>
            `<option value="${esc(t.supervisor)}"${t.supervisor === 'Scott' ? ' selected' : ''}>${esc(t.supervisor)}</option>`
        ).join('');

        return `
            <h2>🎟️ Contest</h2>
            <p style="color: var(--text-secondary);">Type each day's adherence and perfect surveys. Entries are worked out from what you enter, so correcting a day fixes it rather than awarding twice.</p>

            <div style="margin-bottom: 20px; padding: 20px; background: var(--bg-surface); border-radius: 8px; border: 2px solid #7b1fa2;">
                <h3 style="color: #7b1fa2; margin-top: 0;">Enter a day</h3>
                <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 12px;">
                    <label for="contestDate" style="font-weight: bold; color: var(--text-primary);">Date</label>
                    <input type="date" id="contestDate" style="padding: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-surface); color: var(--text-primary);">
                    <label for="contestTeam" style="font-weight: bold; color: var(--text-primary);">Team</label>
                    <select id="contestTeam" style="padding: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-surface); color: var(--text-primary);">
                        ${teamOptions}<option value="__all__">Everyone</option>
                    </select>
                    <button type="button" id="contestSaveDayBtn" class="btn-secondary" style="background: #2e7d32; color: white;">Save this day</button>
                </div>
                <div id="contestDayGrid" style="max-height: 420px; overflow-y: auto;"></div>
                <div id="contestDayStatus" style="margin-top: 10px; font-size: 0.85em; color: var(--text-secondary);"></div>
            </div>

            <div style="padding: 20px; background: var(--bg-surface); border-radius: 8px; border: 2px solid #00897b;">
                <h3 style="color: #00897b; margin-top: 0;">Standings</h3>
                <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px;">
                    <button type="button" id="contestCopyBtn" class="btn-secondary">Copy standings</button>
                    <button type="button" id="contestDrawBtn" class="btn-secondary" style="background: #ef6c00; color: white;">🎲 Draw a winner</button>
                </div>
                <div id="contestDrawResult" style="display: none; margin-bottom: 12px; padding: 12px; background: var(--bg-surface-sunken); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary);"></div>
                <div id="contestStandings"></div>
            </div>
        `;
    }

    function renderDayGrid() {
        const host = document.getElementById('contestDayGrid');
        const date = document.getElementById('contestDate')?.value;
        if (!host) return;
        if (!date) { host.innerHTML = '<p style="color: var(--text-secondary);">Pick a date to start.</p>'; return; }

        const day = monthData(loadAll(), monthKeyFor(date)).days[date] || {};
        const names = namesForTeam(selectedTeam());

        const rows = names.map((name) => {
            const row = day[name] || {};
            const adherence = row.adherence === undefined || row.adherence === null ? '' : row.adherence;
            const perfect = row.perfectSurveys || '';
            return `<tr>
                <td style="padding: 6px 8px; color: var(--text-primary);">${esc(name)}</td>
                <td style="padding: 6px 8px;"><input type="number" step="0.1" min="0" max="100" data-contest-adherence="${esc(name)}" value="${esc(adherence)}" placeholder="%" style="width: 90px; padding: 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-surface); color: var(--text-primary);"></td>
                <td style="padding: 6px 8px;"><input type="number" step="1" min="0" data-contest-perfect="${esc(name)}" value="${esc(perfect)}" placeholder="0" style="width: 90px; padding: 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-surface); color: var(--text-primary);"></td>
            </tr>`;
        }).join('');

        host.innerHTML = `<table style="width: 100%; border-collapse: collapse;">
            <thead><tr>
                <th style="text-align: left; padding: 6px 8px; color: var(--text-secondary); font-size: 0.85em;">Associate</th>
                <th style="text-align: left; padding: 6px 8px; color: var(--text-secondary); font-size: 0.85em;">Adherence %</th>
                <th style="text-align: left; padding: 6px 8px; color: var(--text-secondary); font-size: 0.85em;">Perfect surveys</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    function renderStandings() {
        const host = document.getElementById('contestStandings');
        const date = document.getElementById('contestDate')?.value;
        if (!host) return;

        const monthKey = monthKeyFor(date) || new Date().toISOString().slice(0, 7);
        const data = monthData(loadAll(), monthKey);
        const board = contest()?.buildLeaderboard(data) || [];

        if (!board.length) {
            host.innerHTML = '<p style="color: var(--text-secondary);">No entries yet. Save a day above and they will appear here.</p>';
            return;
        }

        const pool = board.reduce((sum, row) => sum + row.total, 0);
        const rows = board.map((row, index) => `<tr>
            <td style="padding: 6px 8px; color: var(--text-secondary);">${index + 1}</td>
            <td style="padding: 6px 8px; color: var(--text-primary); font-weight: 600;">${esc(row.associate)}</td>
            <td style="padding: 6px 8px; color: var(--text-primary); font-weight: 700;">${row.total}</td>
            <td style="padding: 6px 8px; color: var(--text-secondary); font-size: 0.85em;">${row.perfectSurvey} surveys, ${row.dailyAdherence} days, ${row.weeklyAdherence} weeks${row.monthlyAdherence ? ', the month' : ''}</td>
        </tr>`).join('');

        host.innerHTML = `<p style="color: var(--text-secondary);">${pool} entries in the draw for ${esc(monthKey)}.</p>
            <table style="width: 100%; border-collapse: collapse;">
                <thead><tr>
                    <th style="text-align: left; padding: 6px 8px; color: var(--text-secondary); font-size: 0.85em;">#</th>
                    <th style="text-align: left; padding: 6px 8px; color: var(--text-secondary); font-size: 0.85em;">Associate</th>
                    <th style="text-align: left; padding: 6px 8px; color: var(--text-secondary); font-size: 0.85em;">Entries</th>
                    <th style="text-align: left; padding: 6px 8px; color: var(--text-secondary); font-size: 0.85em;">Earned by</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    // ============================================
    // ACTIONS
    // ============================================

    function saveDay() {
        const status = document.getElementById('contestDayStatus');
        const date = document.getElementById('contestDate')?.value;
        if (!date) { if (status) status.textContent = 'Pick a date first.'; return; }

        const all = loadAll();
        const monthKey = monthKeyFor(date);
        const month = all[monthKey] = all[monthKey] || { days: {} };

        // The day is rebuilt from what is on screen rather than merged into what
        // was there. Clearing a box has to mean "this did not happen", which a
        // merge would quietly ignore.
        const day = {};
        document.querySelectorAll('[data-contest-adherence]').forEach((input) => {
            const name = input.getAttribute('data-contest-adherence');
            const adherence = input.value === '' ? null : Number(input.value);
            const perfectInput = document.querySelector(`[data-contest-perfect="${CSS.escape(name)}"]`);
            const perfect = perfectInput && perfectInput.value !== '' ? Number(perfectInput.value) : 0;
            if (adherence === null && !perfect) return;
            day[name] = {};
            if (Number.isFinite(adherence)) day[name].adherence = adherence;
            if (perfect) day[name].perfectSurveys = perfect;
        });

        if (Object.keys(day).length) month.days[date] = day;
        else delete month.days[date];

        if (!saveAll(all)) {
            if (status) status.textContent = 'Could not save. Check the console.';
            return;
        }

        const people = Object.keys(day).length;
        if (status) status.textContent = `Saved ${people} ${people === 1 ? 'person' : 'people'} for ${date}.`;
        renderStandings();
    }

    function copyStandings() {
        const date = document.getElementById('contestDate')?.value;
        const monthKey = monthKeyFor(date) || new Date().toISOString().slice(0, 7);
        const text = contest()?.buildStandingsPost(monthData(loadAll(), monthKey), monthKey) || '';
        if (!text) return;
        const copy = window.DevCoachModules?.uiUtils?.copyToClipboard;
        if (typeof copy === 'function') copy(text, { message: 'Standings copied' });
    }

    function draw() {
        const host = document.getElementById('contestDrawResult');
        const date = document.getElementById('contestDate')?.value;
        const monthKey = monthKeyFor(date) || new Date().toISOString().slice(0, 7);
        const result = contest()?.drawWinner(monthData(loadAll(), monthKey));
        if (!host) return;

        if (!result) {
            host.style.display = 'block';
            host.textContent = 'There are no entries to draw from yet.';
            return;
        }

        host.style.display = 'block';
        // The ticket number and pool size are shown so the draw can be checked
        // rather than taken on trust.
        host.innerHTML = `<strong style="font-size: 1.1em;">🎉 ${esc(result.associate)}</strong>
            <div style="margin-top: 6px; color: var(--text-secondary); font-size: 0.9em;">
                Ticket ${result.ticket + 1} of ${result.poolSize}. They held ${esc(result.odds)}.<br>
                That ticket was earned by ${esc(result.wonBy)}.
            </div>`;
    }

    // ============================================
    // MOUNT
    // ============================================

    function show() {
        const section = document.getElementById('contestSection');
        if (!section) return;

        if (!rendered) {
            section.innerHTML = panelHtml();
            const dateInput = document.getElementById('contestDate');
            if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);

            document.getElementById('contestDate')?.addEventListener('change', () => { renderDayGrid(); renderStandings(); });
            document.getElementById('contestTeam')?.addEventListener('change', renderDayGrid);
            document.getElementById('contestSaveDayBtn')?.addEventListener('click', saveDay);
            document.getElementById('contestCopyBtn')?.addEventListener('click', copyStandings);
            document.getElementById('contestDrawBtn')?.addEventListener('click', draw);
            rendered = true;
        }

        renderDayGrid();
        renderStandings();
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.contestUi = { show, renderDayGrid, renderStandings, saveDay, draw };
})();
