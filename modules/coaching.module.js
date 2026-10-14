(function() {
    'use strict';

    function _esc(val) {
        const fn = window.DevCoachModules?.sharedUtils?.escapeHtml;
        return typeof fn === 'function' ? fn(val) : String(val ?? '');
    }

    function formatHistoryMetricLabels(keys = [], metricsRegistry = {}) {
        if (!Array.isArray(keys) || keys.length === 0) return 'General review';
        return keys
            .map(key => metricsRegistry?.[key]?.label || key)
            .slice(0, 4)
            .join(', ');
    }

    function buildHistoryRowsHtml(history = [], options = {}) {
        const safeHistory = Array.isArray(history) ? history : [];
        const formatDate = typeof options.formatDate === 'function' ? options.formatDate : (value) => value;
        const metricsRegistry = options.metricsRegistry || {};

        return safeHistory
            .slice(0, 5)
            .map(entry => {
                const dateLabel = entry?.weekEnding ? (formatDate(entry.weekEnding) || entry.weekEnding) : 'Unknown date';
                const metricsLabel = formatHistoryMetricLabels(entry?.metricsCoached, metricsRegistry);
                const aiLabel = entry?.aiAssisted ? ' · AI-assisted' : '';
                return `<li>${_esc(dateLabel)}. ${_esc(metricsLabel)}${aiLabel}</li>`;
            })
            .join('');
    }

    function resolveHistoryLatestDateLabel(latestEntry, formatDate) {
        if (!latestEntry?.weekEnding) return '';
        return (typeof formatDate === 'function' ? formatDate(latestEntry.weekEnding) : latestEntry.weekEnding) || latestEntry.weekEnding;
    }

    function renderHistoryView(options = {}) {
        const panel = options.panel;
        const summary = options.summary;
        const list = options.list;
        const employeeName = options.employeeName;
        const history = Array.isArray(options.history) ? options.history : [];
        const formatDate = options.formatDate;
        const metricsRegistry = options.metricsRegistry || {};

        if (!panel || !summary || !list) return;

        if (!employeeName) {
            summary.textContent = 'Select an associate to view coaching history.';
            list.innerHTML = '';
            panel.style.display = 'block';
            return;
        }

        if (history.length === 0) {
            summary.textContent = 'No coaching history saved yet.';
            list.innerHTML = '';
            panel.style.display = 'block';
            return;
        }

        const latestDate = resolveHistoryLatestDateLabel(history[0], formatDate);
        summary.textContent = `Last coaching: ${latestDate || 'N/A'} · Total coachings: ${history.length}`;
        list.innerHTML = buildHistoryRowsHtml(history, { formatDate, metricsRegistry });
        panel.style.display = 'block';
    }

    function resolveOutlookEndDate(periodMeta = {}, periodKey = '', formatDate) {
        if (periodMeta?.endDate) {
            return typeof formatDate === 'function' ? formatDate(periodMeta.endDate) : periodMeta.endDate;
        }

        const endDateFromKey = String(periodKey || '').split('|')[1];
        if (endDateFromKey) {
            return typeof formatDate === 'function' ? formatDate(endDateFromKey) : endDateFromKey;
        }

        return 'current period';
    }

    function resolveOutlookPreferredName(selectedEmployee, getEmployeeNickname) {
        if (!selectedEmployee) return 'Associate';
        const nickname = typeof getEmployeeNickname === 'function' ? getEmployeeNickname(selectedEmployee) : '';
        return nickname || selectedEmployee;
    }

    const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function shortDate(iso) {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        const month = match ? SHORT_MONTHS[parseInt(match[2], 10) - 1] : '';
        return month ? `${month} ${parseInt(match[3], 10)}` : '';
    }

    /**
     * The day the coaching week started, as ISO: the upload's own start date,
     * then the key's, then the Monday of the end date's week.
     */
    function resolveOutlookWeekStartIso(periodMeta = {}, periodKey = '') {
        const meta = periodMeta || {};
        if (/^\d{4}-\d{2}-\d{2}/.test(meta.startDate || '')) return meta.startDate.slice(0, 10);
        const parts = String(periodKey || '').split('|');
        if (parts.length > 1 && /^\d{4}-\d{2}-\d{2}/.test(parts[0])) return parts[0].slice(0, 10);
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(meta.endDate || parts[1] || '');
        if (!match) return '';
        const end = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
        const back = (end.getUTCDay() + 6) % 7;
        return new Date(end.getTime() - back * 86400000).toISOString().slice(0, 10);
    }

    /**
     * "Weekly coaching check-in for Derek, week of Oct 5".
     *
     * Scott, 2026-10-14: it read "Weekly Coaching Check-In - Derek - Week of
     * 10/09/2026". "Week of" was followed by the Friday the week ended on, and
     * the hyphens between the parts read as dashes in a subject line.
     */
    function buildOutlookSubject(options = {}) {
        const preferredName = resolveOutlookPreferredName(options.selectedEmployee, options.getEmployeeNickname);
        const start = shortDate(resolveOutlookWeekStartIso(options.periodMeta, options.periodKey));
        return start
            ? `Weekly coaching check-in for ${preferredName}, week of ${start}`
            : `Weekly coaching check-in for ${preferredName}`;
    }

    function generateOutlookDraftFromCopilot(options = {}) {
        const bodyText = String(options.bodyText || '').trim();
        const showToast = typeof options.showToast === 'function' ? options.showToast : () => {};

        if (!bodyText) {
            showToast('⚠️ Paste the Copilot-generated email content first.', 3000);
            return { ok: false, reason: 'missing-body' };
        }

        const subject = buildOutlookSubject({
            selectedEmployee: options.selectedEmployee,
            getEmployeeNickname: options.getEmployeeNickname,
            periodMeta: options.periodMeta,
            periodKey: options.periodKey,
            formatDate: options.formatDate
        });

        try {
            const openDraft = window.DevCoachModules?.sharedUtils?.openMailtoDraft;
            if (typeof openDraft !== 'function') {
                throw new Error('Shared mailto utility unavailable');
            }
            // Resolved from the address pattern rather than left blank. This
            // panel has no To: field to correct, so an address that is wrong
            // for someone is fixed on the call listening draft, where there is
            // one, and the override applies here afterwards.
            const to = window.DevCoachModules?.sharedUtils?.resolveAssociateEmail?.(options.selectedEmployee) || '';
            openDraft(subject, bodyText, { to });
            showToast(to ? `📧 Outlook draft opened for ${to}` : '📧 Outlook draft opened', 2500);
            return { ok: true, subject, to };
        } catch (error) {
            if (typeof options.onError === 'function') {
                options.onError(error);
            }
            showToast('⚠️ Could not open Outlook draft.', 3000);
            return { ok: false, reason: 'open-failed', error };
        }
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.coaching = {
        formatHistoryMetricLabels,
        buildHistoryRowsHtml,
        resolveHistoryLatestDateLabel,
        renderHistoryView,
        resolveOutlookEndDate,
        resolveOutlookPreferredName,
        resolveOutlookWeekStartIso,
        buildOutlookSubject,
        generateOutlookDraftFromCopilot
    };
})();
