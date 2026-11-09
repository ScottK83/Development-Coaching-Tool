/**
 * PA DOWN PAYMENT (People > Follow Up > PA Down Payment)
 *
 * Scott, 2026-11-09: each week a "PA Down Payment Coaching" sheet lists his
 * advisors who took payment arrangements outside the guidelines. He copies
 * his rows from its Required Coaching tab and pastes them here. Each advisor
 * gets a card with the email in his own words (Generate email, Copy email)
 * and a note for the sheet's Leader Notes column (Copy leader note).
 *
 * Nothing here is saved or synced. The rows live in this module's variables
 * until the page closes or Clear is pressed, and tests/pa-down-payment.test.js
 * checks that this file never writes to a store.
 *
 * The email is a development opportunity, so it has no praise opener (Scott:
 * "I guess praise can't be added for development opportunities"). The words
 * are his sample's, kept as he wrote them.
 */
(function () {
    'use strict';

    window.DevCoachModules = window.DevCoachModules || {};

    const SUBJECT = 'Payment Arrangement Development Opportunity';

    const REMINDERS = [
        'Start with the required down payment and work with the customer to determine what they can reasonably pay. We want to avoid defaulting to $0 when the customer may be able to contribute something.',
        'When going outside the normal PA guidelines, use the 1X PA Exception Customer Contact and clearly document the customer\'s specific circumstances supporting the exception. Do not simply document "empowerment."',
        'Verify that a 1X PA Exception has not already been provided within the last 12 months.',
        '$0 down requires Team Lead approval. If you previously received approval to offer $0 or otherwise go outside the guidelines, make sure your account notes clearly identify that approval and who provided it. This is important so the decision can be understood when the account is reviewed later.',
        'Set expectations with the customer that the exception is one-time and that future PAs may require a larger down payment if the arrangement is broken.'
    ];

    const GOAL = 'The goal isn\'t to avoid helping our customers. We absolutely want to work with customers experiencing hardship. We just need to make sure we are negotiating first, following the PA process, and clearly documenting any exception we provide.';
    const REPLY_ASK = 'Please reply acknowledging you\'ve reviewed this. If you have questions or want to go over any of the accounts together, let me know.';

    const NOTE_TAIL = 'Reviewed starting from the required down payment, documenting exceptions, $0 down needs TL approval. Asked for a reply.';

    const DATE_CELL = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;

    // ------------------------------------------------------------------
    // Reading the paste
    // ------------------------------------------------------------------

    function clean(cell) {
        return String(cell == null ? '' : cell).replace(/\s+/g, ' ').trim();
    }

    // "Doe, Jamie" becomes "Jamie Doe", the way the app's pickers hold names.
    function toDisplayName(name) {
        const value = clean(name);
        if (!value.includes(',')) return value;
        const [last, first] = value.split(',').map(part => part.trim());
        return [first, last].filter(Boolean).join(' ');
    }

    function nameKey(name) {
        return String(name || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
    }

    // Excel copies what the cell shows ("36.8%"). A sheet with the format
    // taken off gives the fraction (0.368), which is turned back.
    function toPercent(cell) {
        const value = clean(cell);
        if (!value || value.includes('%')) return value.replace(/\s+%/, '%');
        const number = Number(value);
        if (!Number.isFinite(number)) return value;
        if (number <= 1) return `${Math.round(number * 1000) / 10}%`;
        return `${value}%`;
    }

    // "11/09/2026" and "11/9/2026" are the same report.
    function fullReportDate(cell) {
        const match = DATE_CELL.exec(clean(cell));
        return match ? `${Number(match[1])}/${Number(match[2])}/${match[3]}` : clean(cell);
    }

    function isCount(cell) {
        return /^\d+$/.test(clean(cell));
    }

    /**
     * The Required Coaching rows from a paste, with or without the header
     * row. Columns A to H: Report Date, Leader, Advisor, Avg % Accepted,
     * Accounts on report, Count of 1X PA Contact, % of usage, # with 0% Down
     * Accepted. Anything else in the paste (the header, blank lines, the
     * "Previous Weeks Outstanding" table under it) is not a row and is left.
     */
    function parseRows(raw) {
        const rows = [];
        String(raw || '').split(/\r?\n/).forEach(line => {
            const cells = line.split('\t').map(clean);
            if (cells.length < 8) return;
            if (!DATE_CELL.test(cells[0])) return;
            if (!cells[2] || !isCount(cells[4]) || !isCount(cells[5]) || !isCount(cells[7])) return;
            rows.push({
                reportDate: fullReportDate(cells[0]),
                leader: cells[1],
                advisor: toDisplayName(cells[2]),
                avgAccepted: toPercent(cells[3]),
                accounts: cells[4],
                exceptionCount: cells[5],
                usage: toPercent(cells[6]),
                zeroDown: cells[7]
            });
        });
        return rows;
    }

    function leadersOf(rows) {
        return Array.from(new Set((rows || []).map(row => row.leader).filter(Boolean)));
    }

    // ------------------------------------------------------------------
    // The email and the note
    // ------------------------------------------------------------------

    // "11/09/2026" reads as "11/9" in the email.
    function shortReportDate(reportDate) {
        const match = DATE_CELL.exec(clean(reportDate));
        return match ? `${Number(match[1])}/${Number(match[2])}` : clean(reportDate);
    }

    function todayText() {
        const d = new Date();
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    }

    function firstNameOf(row) {
        const given = clean(row.greetingName);
        if (given) return given;
        return toDisplayName(row.advisor).split(' ')[0] || '';
    }

    function buildEmail(row) {
        const data = row || {};
        const name = firstNameOf(data);
        const lines = [
            name ? `Hi ${name},` : 'Hi,',
            '',
            `I wanted to follow up on a development opportunity identified in the ${shortReportDate(data.reportDate)} PA Down Payment Coaching report.`,
            '',
            'Your results:',
            '',
            `Accounts reviewed: ${data.accounts}`,
            `Average down payment accepted: ${data.avgAccepted}`,
            `1X PA Exception contacts used: ${data.exceptionCount} (${data.usage})`,
            `$0 down arrangements: ${data.zeroDown}`,
            '',
            'A few reminders going forward:',
            ''
        ];
        REMINDERS.forEach(reminder => lines.push(`- ${reminder}`));
        lines.push('', GOAL, '', REPLY_ASK, '', 'Thanks,');
        return { subject: SUBJECT, body: lines.join('\n') };
    }

    function plural(count, one, many) {
        return `${count} ${Number(count) === 1 ? one : many}`;
    }

    /**
     * For the sheet's Leader Notes column. It starts with the day the email
     * went out (today), which is also what goes in Date Coached.
     */
    function buildLeaderNote(row) {
        const data = row || {};
        return `${todayText()} Emailed PA down payment coaching: ${plural(data.accounts, 'account', 'accounts')}, `
            + `avg ${data.avgAccepted} accepted, ${plural(data.exceptionCount, '1X PA contact', '1X PA contacts')} (${data.usage}), `
            + `${data.zeroDown} at $0 down. ${NOTE_TAIL}`;
    }

    // ------------------------------------------------------------------
    // The page. Everything below lives in memory only.
    // ------------------------------------------------------------------

    let rows = [];
    let chosenLeader = '';
    const done = new Set();

    function el(id) {
        return document.getElementById(id);
    }

    function escapeHtml(text) {
        const shared = window.DevCoachModules?.sharedUtils?.escapeHtml;
        if (typeof shared === 'function') return shared(text);
        return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function toast(message) {
        if (typeof window.showToast === 'function') window.showToast(message, 3500);
    }

    // The app's own roster, read only, so a preferred name and an email
    // override are found for "Jamie Doe" however the sheet spells the name.
    function rosterNameFor(advisor) {
        const weeklyData = window.DevCoachModules?.storage?.loadWeeklyData?.() || {};
        const target = nameKey(advisor);
        let found = '';
        Object.values(weeklyData).some(period => (period?.employees || []).some(employee => {
            const name = String(employee?.name || '').trim();
            if (name && nameKey(name) === target) found = name;
            return Boolean(found);
        }));
        return found || advisor;
    }

    function withGreeting(row) {
        const rosterName = rosterNameFor(row.advisor);
        const nickname = typeof getEmployeeNickname === 'function' ? getEmployeeNickname(rosterName) : '';
        return Object.assign({}, row, { rosterName, greetingName: nickname || '' });
    }

    function addressFor(row) {
        return window.DevCoachModules?.sharedUtils?.resolveAssociateEmail?.(row.rosterName || row.advisor) || '';
    }

    function rowKey(row) {
        return `${row.reportDate}|${nameKey(row.advisor)}`;
    }

    function visibleRows() {
        const leaders = leadersOf(rows);
        if (leaders.length <= 1) return rows;
        return chosenLeader ? rows.filter(row => row.leader === chosenLeader) : [];
    }

    function renderLeaderPicker() {
        const wrap = el('paDownPaymentLeaderWrap');
        const select = el('paDownPaymentLeader');
        if (!wrap || !select) return;
        const leaders = leadersOf(rows);
        wrap.style.display = leaders.length > 1 ? 'block' : 'none';
        if (leaders.length <= 1) return;
        select.innerHTML = '<option value="">-- Choose the leader --</option>'
            + leaders.map(leader => `<option value="${escapeHtml(leader)}"${leader === chosenLeader ? ' selected' : ''}>${escapeHtml(leader)}</option>`).join('');
    }

    function renderStatus() {
        const status = el('paDownPaymentStatus');
        if (!status) return;
        const pasted = Boolean(el('paDownPaymentPaste')?.value?.trim());
        if (!rows.length) {
            status.textContent = pasted
                ? 'No rows found. Copy columns A to H of your rows on the Required Coaching tab (Report Date across to # with 0% Down Accepted) and paste again.'
                : '';
            return;
        }
        const shown = visibleRows();
        const dates = Array.from(new Set(shown.map(row => row.reportDate)));
        if (leadersOf(rows).length > 1 && !chosenLeader) {
            status.textContent = `${rows.length} rows read, for more than one leader. Choose the leader to see the cards.`;
            return;
        }
        status.textContent = `${plural(shown.length, 'advisor', 'advisors')} read from the ${dates.join(' and ')} report. Nothing is saved: closing the page clears it.`;
    }

    function cardHtml(row, index) {
        const full = withGreeting(row);
        const email = buildEmail(full);
        const to = addressFor(full);
        const isDone = done.has(rowKey(row));
        const figure = (label, value) => `<div><div class="text-faint" style="font-size: 0.8em;">${label}</div><div class="text-primary" style="font-weight: bold; font-size: 1.15em;">${escapeHtml(value)}</div></div>`;
        return `<div class="card" data-pa-card="${index}" style="${isDone ? 'opacity: 0.6;' : ''}">`
            + `<div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">`
            + `<h3 class="card-title" style="margin: 0;">${escapeHtml(row.advisor)}</h3>`
            + `<label class="text-secondary" style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" data-pa-action="done" data-pa-index="${index}"${isDone ? ' checked' : ''}> Done</label>`
            + `</div>`
            + `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 12px 0;">`
            + figure('Accounts reviewed', row.accounts)
            + figure('Average down payment accepted', row.avgAccepted)
            + figure('1X PA Exception contacts used', `${row.exceptionCount} (${row.usage})`)
            + figure('$0 down arrangements', row.zeroDown)
            + `</div>`
            + `<div style="display: flex; gap: 10px; flex-wrap: wrap;">`
            + `<button type="button" class="btn-primary" data-pa-action="email" data-pa-index="${index}" style="flex: 1; min-width: 150px;">Generate email</button>`
            + `<button type="button" class="btn-secondary" data-pa-action="copy-email" data-pa-index="${index}" style="flex: 1; min-width: 150px;">Copy email</button>`
            + `<button type="button" class="btn-secondary" data-pa-action="copy-note" data-pa-index="${index}" style="flex: 1; min-width: 150px;">Copy leader note</button>`
            + `</div>`
            + `<details style="margin-top: 10px;"><summary class="text-secondary" style="cursor: pointer;">Show the email and the note</summary>`
            + `<div class="card-sunken text-primary" style="white-space: pre-wrap; word-wrap: break-word; line-height: 1.6; font-family: Arial, sans-serif; margin-top: 8px;">${escapeHtml(`To: ${to}\nSubject: ${email.subject}\n\n${email.body}`)}</div>`
            + `<div class="text-faint" style="font-size: 0.85em; margin-top: 8px;">Leader note:</div>`
            + `<div class="card-sunken text-primary" style="white-space: pre-wrap; word-wrap: break-word; margin-top: 4px;">${escapeHtml(buildLeaderNote(row))}</div>`
            + `</details>`
            + `</div>`;
    }

    function renderCards() {
        const list = el('paDownPaymentCards');
        if (!list) return;
        list.innerHTML = visibleRows().map(cardHtml).join('');
    }

    function render() {
        renderLeaderPicker();
        renderStatus();
        renderCards();
    }

    function handlePaste() {
        rows = parseRows(el('paDownPaymentPaste')?.value || '');
        const leaders = leadersOf(rows);
        if (!leaders.includes(chosenLeader)) chosenLeader = '';
        render();
    }

    function rowAt(index) {
        return visibleRows()[Number(index)] || null;
    }

    function openEmailDraft(row) {
        const full = withGreeting(row);
        const email = buildEmail(full);
        window.DevCoachModules?.sharedUtils?.openMailtoDraft?.(email.subject, email.body, { to: addressFor(full) });
        toast('Draft opened in Outlook. Check it, then press Send.');
    }

    function copyText(text, button, message) {
        const copy = typeof window.copyToClipboard === 'function' ? window.copyToClipboard : null;
        if (!copy) return;
        copy(text, { button, message });
    }

    function onCardsClick(event) {
        const target = event.target?.closest?.('[data-pa-action]');
        if (!target) return;
        const row = rowAt(target.getAttribute('data-pa-index'));
        if (!row) return;
        const action = target.getAttribute('data-pa-action');
        if (action === 'done') {
            if (target.checked) done.add(rowKey(row));
            else done.delete(rowKey(row));
            renderCards();
        } else if (action === 'email') {
            openEmailDraft(row);
        } else if (action === 'copy-email') {
            const email = buildEmail(withGreeting(row));
            copyText(`Subject: ${email.subject}\n\n${email.body}`, target, '📋 Email copied. Paste it into a new Outlook email.');
        } else if (action === 'copy-note') {
            copyText(buildLeaderNote(row), target, '📋 Note copied. Paste it into Leader Notes on the sheet.');
        }
    }

    function clearAll() {
        rows = [];
        chosenLeader = '';
        done.clear();
        const box = el('paDownPaymentPaste');
        if (box) box.value = '';
        render();
    }

    let bound = false;

    function init() {
        if (bound || !el('paDownPaymentPanel')) return;
        bound = true;
        el('paDownPaymentPaste')?.addEventListener('input', handlePaste);
        el('paDownPaymentLeader')?.addEventListener('change', (event) => {
            chosenLeader = event.target?.value || '';
            render();
        });
        el('paDownPaymentCards')?.addEventListener('click', onCardsClick);
        el('paDownPaymentClearBtn')?.addEventListener('click', clearAll);
        render();
    }

    // Called each time the tab opens, so preferred names and addresses are
    // current.
    function show() {
        init();
        render();
    }

    window.DevCoachModules.paDownPayment = {
        SUBJECT,
        REMINDERS,
        parseRows,
        leadersOf,
        shortReportDate,
        buildEmail,
        buildLeaderNote,
        init,
        show
    };
})();
