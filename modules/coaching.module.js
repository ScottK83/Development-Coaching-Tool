(function() {
    'use strict';

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
                return `<li>${dateLabel} — ${metricsLabel}${aiLabel}</li>`;
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

    function buildOutlookSubject(options = {}) {
        const preferredName = resolveOutlookPreferredName(options.selectedEmployee, options.getEmployeeNickname);
        const endDate = resolveOutlookEndDate(options.periodMeta, options.periodKey, options.formatDate);
        return `Weekly Coaching Check-In - ${preferredName} - Week of ${endDate}`;
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
            openDraft(subject, bodyText);
            showToast('📧 Outlook draft opened', 2500);
            return { ok: true, subject };
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
        buildOutlookSubject,
        generateOutlookDraftFromCopilot
    };
})();
