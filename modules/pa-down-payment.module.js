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
 * Scott, 2026-11-23: these are accounts where $0 down was accepted without
 * approval, so the email also lists each one: the date of the $0 down and the
 * account number. The sheet's rows only carry a count, so he types or pastes
 * the accounts into a box on the advisor's card. They are customer account
 * numbers: held in memory like the rest, never stored.
 *
 * Scott, 2026-11-23, later the same day: the sheet's account rows can be
 * pasted into the main box too (one row per account: category, Report Date,
 * Leader, advisor ID, Advisor, % accepted, account number, status, PA date,
 * and on). The rows at 0% fill each advisor's accounts box by themselves,
 * with the PA date as the date of the $0 down. Pasted without the Required
 * Coaching rows, the cards' figures are counted from the account rows.
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

    const ACCOUNTS_HEAD = '$0 down accounts on this report (date of the $0 down, account number):';
    const ACCOUNTS_ASK = 'Team Lead approval needs to be documented in the notes on every one of these accounts.';

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

    const SLASH_DATE = /(?:^|[^\d\/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d\/])/;
    const ISO_DATE = /(?:^|\D)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/;
    const ACCOUNT_NUMBER = /\d(?:-?\d){5,}/;

    /**
     * The $0 down accounts typed or pasted for one advisor, one per line:
     * the date of the $0 down and the account number, in either order, with
     * a tab, comma or spaces between. Read by content, so extra cells copied
     * along from a sheet are ignored. A line with no account number is not
     * an account. A line with no date keeps its account and an empty date.
     */
    function parseAccounts(raw) {
        const accounts = [];
        String(raw || '').split(/\r?\n/).forEach(line => {
            let text = clean(line);
            let date = '';
            const iso = ISO_DATE.exec(text);
            const slash = SLASH_DATE.exec(text);
            if (iso) {
                date = `${Number(iso[2])}/${Number(iso[3])}/${iso[1]}`;
                text = text.replace(iso[0], ' ');
            } else if (slash) {
                date = `${Number(slash[1])}/${Number(slash[2])}${slash[3] ? `/${slash[3]}` : ''}`;
                text = text.replace(slash[0], ' ');
            }
            const number = ACCOUNT_NUMBER.exec(text);
            if (!number) return;
            accounts.push({ date, account: number[0] });
        });
        return accounts;
    }

    const ACCOUNT_CELL = /^\d{8,12}$/;

    // "45%" is 45. A cell with the percent format taken off (0.45) is 45 too.
    function percentNumber(cell) {
        const value = clean(cell);
        const number = parseFloat(value.replace('%', ''));
        if (!value || !Number.isFinite(number)) return null;
        return value.includes('%') ? number : number * 100;
    }

    /**
     * The sheet's account rows, one per account. Columns A to Q: category,
     * Report Date, Leader, advisor ID, Advisor, % accepted, account number,
     * status, PA date, balance, required down payment, last payment date,
     * last payment, rate, the rule, the ID on the 1X PA contact (or #N/A),
     * and whether that ID is the advisor's. A Required Coaching row starts
     * with a date, so it is never taken for one of these.
     */
    function parseDetailRows(raw) {
        const details = [];
        String(raw || '').split(/\r?\n/).forEach(line => {
            const cells = line.split('\t').map(clean);
            if (cells.length < 9) return;
            if (!DATE_CELL.test(cells[1]) || !cells[4] || !ACCOUNT_CELL.test(cells[6])) return;
            const accepted = percentNumber(cells[5]);
            if (accepted === null) return;
            const contact = cells[15] || '';
            details.push({
                reportDate: fullReportDate(cells[1]),
                leader: cells[2],
                advisor: toDisplayName(cells[4]),
                accepted,
                account: cells[6],
                paDate: DATE_CELL.test(cells[8]) ? fullReportDate(cells[8]) : '',
                usedException: Boolean(contact) && !contact.startsWith('#')
            });
        });
        return details;
    }

    /**
     * One row per advisor and report from the account rows, shaped like a
     * Required Coaching row, with the 0% accounts listed. The figures are
     * counted here: accounts, the plain average of % accepted, how many
     * carry a 1X PA contact ID, and how many are at 0%.
     */
    function summariseDetails(details) {
        const groups = new Map();
        (details || []).forEach(detail => {
            const key = `${detail.reportDate}|${nameKey(detail.advisor)}`;
            if (!groups.has(key)) groups.set(key, { first: detail, items: [] });
            groups.get(key).items.push(detail);
        });
        return Array.from(groups.values()).map(({ first, items }) => {
            const count = items.length;
            const average = items.reduce((sum, item) => sum + item.accepted, 0) / count;
            const exceptions = items.filter(item => item.usedException).length;
            const zero = items.filter(item => item.accepted === 0);
            return {
                reportDate: first.reportDate,
                leader: first.leader,
                advisor: first.advisor,
                avgAccepted: `${(Math.round(average * 10) / 10).toFixed(1)}%`,
                accounts: String(count),
                exceptionCount: String(exceptions),
                usage: `${Math.round((exceptions / count) * 100)}%`,
                zeroDown: String(zero.length),
                fromAccounts: true,
                zeroDownAccounts: zero.map(item => ({ date: item.paDate, account: item.account }))
            };
        });
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
            ''
        ];
        const accounts = Array.isArray(data.zeroDownAccounts) ? data.zeroDownAccounts : [];
        if (accounts.length) {
            lines.push(ACCOUNTS_HEAD, '');
            accounts.forEach(item => lines.push(item.date ? `- ${item.date}, account ${item.account}` : `- Account ${item.account}`));
            lines.push('', ACCOUNTS_ASK, '');
        }
        lines.push('A few reminders going forward:', '');
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
    // What he typed in each card's accounts box, by rowKey. Memory only.
    const accountText = new Map();

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
        const zeroDownAccounts = parseAccounts(accountText.get(rowKey(row)));
        return Object.assign({}, row, { rosterName, greetingName: nickname || '', zeroDownAccounts });
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
                ? 'No rows found. Copy your rows on the Required Coaching tab (columns A to H), your account rows, or both, and paste again.'
                : '';
            return;
        }
        const shown = visibleRows();
        const dates = Array.from(new Set(shown.map(row => row.reportDate)));
        if (leadersOf(rows).length > 1 && !chosenLeader) {
            status.textContent = `${rows.length} rows read, for more than one leader. Choose the leader to see the cards.`;
            return;
        }
        const counted = shown.some(row => row.fromAccounts) ? ' Figures counted from the account rows: check them against the sheet.' : '';
        status.textContent = `${plural(shown.length, 'advisor', 'advisors')} read from the ${dates.join(' and ')} report.${counted} Nothing is saved: closing the page clears it.`;
    }

    function previewText(full) {
        const email = buildEmail(full);
        return `To: ${addressFor(full)}\nSubject: ${email.subject}\n\n${email.body}`;
    }

    // Under the accounts box: how many were read, and whether that matches
    // the report's own count.
    function accountsStatus(row, accounts) {
        const expected = Number(row.zeroDown) || 0;
        if (!accounts.length) {
            return `One per line: the date of the $0 down and the account number. The report counts ${expected}. They are added to the email and are not saved.`;
        }
        const undated = accounts.filter(item => !item.date).length;
        let text = `${plural(accounts.length, 'account', 'accounts')} read`;
        if (accounts.length !== expected) text += `, but the report counts ${expected}`;
        if (undated) text += `. ${undated} with no date`;
        return `${text}.`;
    }

    function accountsBoxHtml(row, full, index) {
        if (!(Number(row.zeroDown) > 0) && !accountText.get(rowKey(row))) return '';
        return `<div style="margin: 0 0 12px 0;">`
            + `<label class="text-primary" style="font-weight: bold; display: block; margin-bottom: 5px;">$0 down accounts for the email:</label>`
            + `<textarea data-pa-accounts="${index}" placeholder="11/3/2026  1234567890" style="width: 100%; min-height: 70px; box-sizing: border-box; resize: vertical;">${escapeHtml(accountText.get(rowKey(row)) || '')}</textarea>`
            + `<div class="text-faint" data-pa-accounts-status style="font-size: 0.85em; margin-top: 4px;">${escapeHtml(accountsStatus(row, full.zeroDownAccounts))}</div>`
            + `</div>`;
    }

    function cardHtml(row, index) {
        const full = withGreeting(row);
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
            + accountsBoxHtml(row, full, index)
            + `<div style="display: flex; gap: 10px; flex-wrap: wrap;">`
            + `<button type="button" class="btn-primary" data-pa-action="email" data-pa-index="${index}" style="flex: 1; min-width: 150px;">Generate email</button>`
            + `<button type="button" class="btn-secondary" data-pa-action="copy-email" data-pa-index="${index}" style="flex: 1; min-width: 150px;">Copy email</button>`
            + `<button type="button" class="btn-secondary" data-pa-action="copy-note" data-pa-index="${index}" style="flex: 1; min-width: 150px;">Copy leader note</button>`
            + `</div>`
            + `<details style="margin-top: 10px;"><summary class="text-secondary" style="cursor: pointer;">Show the email and the note</summary>`
            + `<div class="card-sunken text-primary" data-pa-preview style="white-space: pre-wrap; word-wrap: break-word; line-height: 1.6; font-family: Arial, sans-serif; margin-top: 8px;">${escapeHtml(previewText(full))}</div>`
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
        const pasted = el('paDownPaymentPaste')?.value || '';
        rows = parseRows(pasted);
        // Account rows: an advisor with no Required Coaching row gets a card
        // from them, and the 0% accounts fill the card's accounts box.
        summariseDetails(parseDetailRows(pasted)).forEach(group => {
            const key = rowKey(group);
            if (!rows.some(row => rowKey(row) === key)) rows.push(group);
            if (group.zeroDownAccounts.length) {
                accountText.set(key, group.zeroDownAccounts.map(item => `${item.date}\t${item.account}`.trim()).join('\n'));
            }
        });
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

    // Typing in an accounts box updates that card's count and preview in
    // place, so the box keeps its cursor.
    function onAccountsInput(event) {
        const box = event.target;
        if (!box?.hasAttribute?.('data-pa-accounts')) return;
        const row = rowAt(box.getAttribute('data-pa-accounts'));
        if (!row) return;
        accountText.set(rowKey(row), box.value);
        const full = withGreeting(row);
        const card = box.closest('[data-pa-card]');
        const status = card?.querySelector('[data-pa-accounts-status]');
        if (status) status.textContent = accountsStatus(row, full.zeroDownAccounts);
        const preview = card?.querySelector('[data-pa-preview]');
        if (preview) preview.textContent = previewText(full);
    }

    function clearAll() {
        rows = [];
        chosenLeader = '';
        done.clear();
        accountText.clear();
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
        el('paDownPaymentCards')?.addEventListener('input', onAccountsInput);
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
        parseAccounts,
        parseDetailRows,
        summariseDetails,
        leadersOf,
        shortReportDate,
        buildEmail,
        buildLeaderNote,
        init,
        show
    };
})();
