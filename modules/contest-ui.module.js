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

    let rendered = false;
    // The month currently on screen, held in memory only for the life of the
    // page. Nothing is written to this browser: the numbers live in R2 and are
    // read when the panel opens.
    let loadedMonth = null;
    let loadedData = { days: {} };
    let busy = false;

    function esc(text) {
        const fn = window.DevCoachModules?.sharedUtils?.escapeHtml;
        return typeof fn === 'function' ? fn(String(text ?? '')) : String(text ?? '');
    }

    function contest() {
        return window.DevCoachModules?.contest;
    }

    // ============================================
    // STORAGE: Cloudflare, and only Cloudflare
    // ============================================
    // There is no browser copy. The panel fetches the month when it opens and
    // writes it back when a day is saved, so the numbers exist in exactly one
    // place and it does not matter which computer typed them.

    function monthKeyFor(dateIso) {
        return String(dateIso || '').slice(0, 7);
    }

    async function callWorker(body) {
        const repoSync = window.DevCoachModules?.repoSync;
        const config = repoSync?.loadCallListeningSyncConfig?.();
        const endpoint = config?.endpoint;
        if (!endpoint) throw new Error('No sync endpoint is configured.');
        const headers = { 'Content-Type': 'application/json' };
        if (config?.sharedSecret) headers['x-sync-secret'] = config.sharedSecret;
        const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) throw new Error(data?.error || `The service returned HTTP ${response.status}.`);
        return data;
    }

    async function fetchMonth(monthKey) {
        const data = await callWorker({ mode: 'contestGet', month: monthKey });
        loadedMonth = monthKey;
        loadedData = (data.data && typeof data.data === 'object') ? data.data : { days: {} };
        if (!loadedData.days) loadedData.days = {};
        return loadedData;
    }

    async function pushMonth(monthKey, data) {
        return callWorker({ mode: 'contestSave', month: monthKey, data });
    }

    /** What is on screen. Never a source of truth, only what was last fetched. */
    function currentMonthData() {
        return loadedData;
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
                    <button type="button" id="contestImportBtn" class="btn-secondary" style="background: #1565c0; color: white;">⬇️ Pull from uploads</button>
                </div>
                <div id="contestDayGrid" style="max-height: 420px; overflow-y: auto;"></div>
                <div id="contestDayStatus" style="margin-top: 10px; font-size: 0.85em; color: var(--text-secondary);"></div>
            </div>

            <div style="padding: 20px; background: var(--bg-surface); border-radius: 8px; border: 2px solid #00897b;">
                <h3 style="color: #00897b; margin-top: 0;">Standings</h3>
                <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px;">
                    <button type="button" id="contestCopyBtn" class="btn-secondary">📋 Copy the post</button>
                    <button type="button" id="contestCheckinBtn" class="btn-secondary" style="background: #00695c; color: white;">💬 Copy a check in</button>
                    <button type="button" id="contestCopyGraphicBtn" class="btn-secondary" style="background: #7b1fa2; color: white;">🖼️ Copy the graphic</button>
                    <button type="button" id="contestDownloadGraphicBtn" class="btn-secondary">Download it</button>
                    <button type="button" id="contestDrawBtn" class="btn-secondary" style="background: #ef6c00; color: white;">🎲 Draw a winner</button>
                </div>
                <div id="contestGraphicStatus" style="margin-bottom: 10px; font-size: 0.85em; color: var(--text-secondary);"></div>
                <div id="contestDrawResult" style="display: none; margin-bottom: 12px; padding: 12px; background: var(--bg-surface-sunken); border: 1px solid var(--border); border-radius: 6px; color: var(--text-primary);"></div>
                <div id="contestStandings"></div>
                <div style="margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border);">
                    <p style="margin: 0 0 10px 0; color: var(--text-secondary); font-size: 0.9em;">This is exactly what gets copied. Paste the graphic and the post together.</p>
                    <div style="overflow-x: auto;"><div id="contestGraphicExport" style="width: 900px;"></div></div>
                </div>
            </div>
        `;
    }

    function renderDayGrid() {
        const host = document.getElementById('contestDayGrid');
        const date = document.getElementById('contestDate')?.value;
        if (!host) return;
        if (!date) { host.innerHTML = '<p style="color: var(--text-secondary);">Pick a date to start.</p>'; return; }

        const day = currentMonthData().days[date] || {};
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
        const board = contest()?.buildLeaderboard(currentMonthData()) || [];

        if (!board.length) {
            host.innerHTML = '<p style="color: var(--text-secondary);">No entries yet. Save a day above and they will appear here.</p>';
            renderGraphic();
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
        renderGraphic();
    }

    // ============================================
    // ACTIONS
    // ============================================

    async function saveDay() {
        const status = document.getElementById('contestDayStatus');
        const date = document.getElementById('contestDate')?.value;
        if (!date) { if (status) status.textContent = 'Pick a date first.'; return; }
        if (busy) return;

        const monthKey = monthKeyFor(date);
        const month = currentMonthData();

        // Only the people on screen are rewritten. Anyone stored for this date
        // but not currently listed is left exactly as they were.
        //
        // This matters because of how surveys arrive: a call taken on Monday can
        // have its survey land on Thursday, so a day gets revisited days later
        // to add them. If that revisit happened with a different team selected,
        // rebuilding the whole day from the visible rows would delete everyone
        // who was not on screen. Entering a day as Everyone and coming back as
        // one team would silently drop the other hundred people.
        //
        // Clearing a box still means "this did not happen" for that person,
        // because a visible name with both boxes empty is removed below.
        const day = Object.assign({}, month.days[date] || {});
        document.querySelectorAll('[data-contest-adherence]').forEach((input) => {
            const name = input.getAttribute('data-contest-adherence');
            const adherence = input.value === '' ? null : Number(input.value);
            const perfectInput = document.querySelector(`[data-contest-perfect="${CSS.escape(name)}"]`);
            const perfect = perfectInput && perfectInput.value !== '' ? Number(perfectInput.value) : 0;

            if (adherence === null && !perfect) {
                delete day[name];
                return;
            }
            day[name] = {};
            if (Number.isFinite(adherence)) day[name].adherence = adherence;
            if (perfect) day[name].perfectSurveys = perfect;
        });

        if (Object.keys(day).length) month.days[date] = day;
        else delete month.days[date];

        busy = true;
        if (status) status.textContent = 'Saving to cloud storage...';
        try {
            await pushMonth(monthKey, month);
        } catch (error) {
            // Nothing was written anywhere, so say so plainly rather than
            // letting the screen imply it landed.
            if (status) status.textContent = 'Not saved: ' + (error?.message || error);
            busy = false;
            return;
        }
        busy = false;

        const people = Object.keys(day).length;
        if (status) status.textContent = `Saved ${people} ${people === 1 ? 'person' : 'people'} for ${date}.`;
        renderStandings();
    }

    /**
     * Fills the month from the daily uploads the app already holds.
     *
     * Shows what it found and what it could not work out before writing, then
     * saves in one go. It fills gaps only: anything already typed stays, since
     * a typed correction is the more reliable number of the two.
     */
    async function importFromUploads() {
        var status = document.getElementById('contestDayStatus');
        var say = function (message) { if (status) status.textContent = message; };
        if (busy) return;

        var api = contest();
        if (!api?.buildImportPreview) { say('The import is not available.'); return; }

        var date = document.getElementById('contestDate')?.value;
        var monthKey = monthKeyFor(date) || new Date().toISOString().slice(0, 7);
        var stores = { dailyData: typeof dailyData !== 'undefined' ? dailyData : {} };

        var preview = api.buildImportPreview(stores, {
            monthKey: monthKey,
            names: namesForTeam(selectedTeam())
        });

        if (!preview.counts.days) {
            say(preview.notes.join(' '));
            return;
        }

        var merged = api.mergeImportIntoMonth(currentMonthData(), preview);
        var summary = 'Found ' + preview.counts.adherenceValues + ' adherence '
            + (preview.counts.adherenceValues === 1 ? 'number' : 'numbers')
            + ' and ' + preview.counts.surveyEntries + ' perfect '
            + (preview.counts.surveyEntries === 1 ? 'survey' : 'surveys')
            + ' across ' + preview.counts.days + ' day' + (preview.counts.days === 1 ? '' : 's')
            + ' for ' + preview.counts.people + ' ' + (preview.counts.people === 1 ? 'person' : 'people') + '.';

        var lines = [summary];
        if (merged.kept) {
            lines.push(merged.kept + ' ' + (merged.kept === 1 ? 'number you typed was' : 'numbers you typed were')
                + ' left as they are.');
        }
        preview.notes.forEach(function (note) { lines.push(note); });
        lines.push('', 'Fill in ' + merged.filled + ' ' + (merged.filled === 1 ? 'value' : 'values') + '?');

        if (!window.confirm(lines.join('\n'))) { say('Nothing was imported.'); return; }

        busy = true;
        say('Saving to cloud storage...');
        try {
            await pushMonth(monthKey, merged.month);
        } catch (error) {
            say('Not saved: ' + (error?.message || error));
            busy = false;
            return;
        }
        loadedData = merged.month;
        busy = false;

        say('Imported ' + merged.filled + ' ' + (merged.filled === 1 ? 'value' : 'values') + '. '
            + (preview.needsSurveyCheck.length
                ? preview.needsSurveyCheck.length + ' person day'
                    + (preview.needsSurveyCheck.length === 1 ? '' : 's')
                    + ' still need perfect surveys typed in.'
                : ''));
        renderDayGrid();
        renderStandings();
    }

    /**
     * The standings as text, for a chat post with no picture beside it.
     *
     * The other copy button writes a caption and leaves the list to the
     * graphic. This one carries the whole board, so it survives being pasted on
     * its own, read on a phone, or forwarded by somebody who never saw the card.
     */
    function copyCheckin() {
        const text = contest()?.buildCheckinPost(currentMonthData(), postOptions()) || '';
        if (!text) {
            graphicStatus('There are no entries to post yet.');
            return;
        }
        const copy = window.DevCoachModules?.uiUtils?.copyToClipboard;
        if (typeof copy === 'function') copy(text, { message: 'Check in copied. Paste it straight into Teams.' });
    }

    function copyStandings() {
        const text = contest()?.buildTeamPost(currentMonthData(), postOptions()) || '';
        if (!text) {
            graphicStatus('There are no entries to post yet.');
            return;
        }
        const copy = window.DevCoachModules?.uiUtils?.copyToClipboard;
        if (typeof copy === 'function') copy(text, { message: 'Post copied. Paste it under the graphic.' });
    }

    function draw() {
        const host = document.getElementById('contestDrawResult');
        const date = document.getElementById('contestDate')?.value;
        const monthKey = monthKeyFor(date) || new Date().toISOString().slice(0, 7);
        const result = contest()?.drawWinner(currentMonthData());
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
    // THE GRAPHIC
    // ============================================

    var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    /** "2026-09" reads as "September 2026" on the card and in the post. */
    function monthLabelFor(monthKey) {
        var parts = String(monthKey || '').split('-');
        var month = MONTH_NAMES[Number(parts[1]) - 1];
        return month ? month + ' ' + parts[0] : String(monthKey || '');
    }

    /** What the post and the graphic both cover: the team on screen. */
    function postOptions() {
        var team = selectedTeam();
        var monthKey = monthKeyFor(document.getElementById('contestDate')?.value)
            || new Date().toISOString().slice(0, 10).slice(0, 7);
        return {
            monthLabel: monthLabelFor(monthKey),
            target: contest()?.adherenceTarget(),
            teamLabel: team === '__all__' ? 'Everyone' : 'Team ' + team,
            names: namesForTeam(team),
            adherence: contest()?.buildAdherenceSummary?.(currentMonthData())
        };
    }

    function renderGraphic() {
        var host = document.getElementById('contestGraphicExport');
        if (!host) return;
        var build = contest()?.buildStandingsGraphicHtml;
        if (typeof build !== 'function') { host.innerHTML = ''; return; }
        host.innerHTML = build(contest().buildLeaderboard(currentMonthData()), postOptions());
    }

    /**
     * Rasterises the card.
     *
     * The clone is pinned to the light theme, and that is not a nicety.
     * styles-v2.css repaints every inline light background to #1f2a3e and
     * forces text to #e2e8f0 whenever dark mode is on, with !important,
     * app-wide. html2canvas reads computed style off the live DOM, so without
     * this a supervisor working in dark mode exports a half-navy, unreadable
     * card.
     *
     * It pins rather than removes because the stylesheet has two independent
     * dark triggers: the app's own [data-theme="dark"] toggle, and
     * @media (prefers-color-scheme: dark) scoped to :root:not([data-theme="light"]),
     * which fires off the operating system whatever the toggle says. Removing
     * the attribute beats the first and leaves the second, so a machine set to
     * dark still exported dark surfaces. Setting it to "light" beats both,
     * because that is exactly what the media query's own guard excludes.
     * The graphic is always a light card, whatever theme anything is wearing.
     */
    async function renderGraphicToCanvas() {
        var el = document.getElementById('contestGraphicExport');
        if (!el || !el.firstChild) return null;

        await window.DevCoachModules?.assetLoader?.ensureHtml2Canvas?.();

        return window.html2canvas(el, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
            onclone: function (doc) {
                if (doc && doc.documentElement) doc.documentElement.setAttribute('data-theme', 'light');
            }
        });
    }

    function graphicStatus(message) {
        var host = document.getElementById('contestGraphicStatus');
        if (host) host.textContent = message || '';
    }

    async function copyGraphic() {
        var toast = window.DevCoachModules?.uiUtils?.showToast;
        try {
            var canvas = await renderGraphicToCanvas();
            if (!canvas) { graphicStatus('There is nothing to copy yet.'); return; }

            var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
            if (!blob) { graphicStatus('The image could not be built.'); return; }

            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            graphicStatus('');
            if (toast) toast('Graphic copied. Paste it into Teams.');
        } catch (error) {
            // Clipboard image writing needs a secure context and a permission,
            // and neither is guaranteed. Say what happened and point at the
            // button that does not need it.
            graphicStatus('Could not copy the image: ' + (error?.message || error) + ' Use Download instead.');
        }
    }

    async function downloadGraphic() {
        try {
            var canvas = await renderGraphicToCanvas();
            if (!canvas) { graphicStatus('There is nothing to download yet.'); return; }
            var link = document.createElement('a');
            link.download = 'raffle-standings-' + (monthKeyFor(document.getElementById('contestDate')?.value)
                || new Date().toISOString().slice(0, 7)) + '.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
            graphicStatus('');
        } catch (error) {
            graphicStatus('Could not build the image: ' + (error?.message || error));
        }
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

            document.getElementById('contestDate')?.addEventListener('change', loadMonthAndRender);
            document.getElementById('contestTeam')?.addEventListener('change', () => { renderDayGrid(); renderStandings(); });
            document.getElementById('contestSaveDayBtn')?.addEventListener('click', saveDay);
            document.getElementById('contestImportBtn')?.addEventListener('click', importFromUploads);
            document.getElementById('contestCopyBtn')?.addEventListener('click', copyStandings);
            document.getElementById('contestCheckinBtn')?.addEventListener('click', copyCheckin);
            document.getElementById('contestCopyGraphicBtn')?.addEventListener('click', copyGraphic);
            document.getElementById('contestDownloadGraphicBtn')?.addEventListener('click', downloadGraphic);
            document.getElementById('contestDrawBtn')?.addEventListener('click', draw);
            rendered = true;
        }

        loadMonthAndRender();
    }

    /** Fetches the month from R2, then paints. Nothing renders from a guess. */
    async function loadMonthAndRender() {
        const status = document.getElementById('contestDayStatus');
        const date = document.getElementById('contestDate')?.value;
        const monthKey = monthKeyFor(date) || new Date().toISOString().slice(0, 7);

        if (loadedMonth === monthKey) { renderDayGrid(); renderStandings(); return; }

        if (status) status.textContent = 'Loading from cloud storage...';
        try {
            await fetchMonth(monthKey);
            if (status) status.textContent = '';
        } catch (error) {
            // No local fallback on purpose: showing an empty grid as though it
            // were the real state is how someone types a day twice.
            if (status) status.textContent = 'Could not reach cloud storage: ' + (error?.message || error);
            const grid = document.getElementById('contestDayGrid');
            if (grid) grid.innerHTML = '<p style="color: var(--text-secondary);">Cannot load the contest without a connection. Nothing is stored on this computer.</p>';
            return;
        }
        renderDayGrid();
        renderStandings();
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.contestUi = { show, renderDayGrid, renderStandings, renderGraphic, saveDay, importFromUploads, draw, copyStandings, copyCheckin, copyGraphic, downloadGraphic, loadMonthAndRender };
})();
