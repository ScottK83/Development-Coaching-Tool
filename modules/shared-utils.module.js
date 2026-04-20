(function() {
    'use strict';

    /**
     * @param {unknown} value
     * @returns {string}
     */
    function toNonEmptyString(value) {
        const text = typeof value === 'string' ? value.trim() : '';
        return text;
    }

    /**
     * @param {unknown[]} items
     * @param {string} conjunction
     * @returns {string}
     */
    function joinWithConjunction(items = [], conjunction = 'and') {
        const values = Array.isArray(items)
            ? items.map(item => String(item || '').trim()).filter(Boolean)
            : [];

        if (values.length === 0) return '';
        if (values.length === 1) return values[0];
        if (values.length === 2) return `${values[0]} ${conjunction} ${values[1]}`;
        return `${values.slice(0, -1).join(', ')}, ${conjunction} ${values[values.length - 1]}`;
    }

    /**
     * Escape HTML special characters to prevent XSS
     * @param {unknown} text
     * @returns {string}
     */
    function escapeHtml(text) {
        const str = String(text ?? '');
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Format a Date as YYYY-MM-DD in the local timezone.
     * Using `.toISOString().slice(0, 10)` returns the UTC date, which
     * drifts into tomorrow for any local time past UTC-midnight —
     * so "today" can appear as tomorrow's date. This helper always
     * returns the calendar date the user is actually in.
     * @param {Date} [date]
     * @returns {string}
     */
    function formatLocalDate(date = new Date()) {
        const d = (date instanceof Date) ? date : new Date(date);
        if (Number.isNaN(d.getTime())) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    /**
     * Get the configured CC email address for coaching emails
     */
    function getCoachingCcEmail() {
        try {
            const prefix = window.DevCoachConstants?.STORAGE_PREFIX || 'devCoachingTool_';
            return localStorage.getItem(prefix + 'ccEmail') || '';
        } catch (_e) {
            return '';
        }
    }

    /**
     * @param {string} subject
     * @param {string} bodyText
     * @returns {void}
     */
    function openMailtoDraft(subject, bodyText) {
        const safeSubject = String(subject || '');
        const safeBodyText = String(bodyText || '');
        const ccEmail = getCoachingCcEmail();

        const mailtoLink = document.createElement('a');
        const ccParam = ccEmail ? `cc=${encodeURIComponent(ccEmail)}&` : '';
        mailtoLink.href = `mailto:?${ccParam}subject=${encodeURIComponent(safeSubject)}&body=${encodeURIComponent(safeBodyText)}`;
        document.body.appendChild(mailtoLink);
        mailtoLink.click();
        document.body.removeChild(mailtoLink);
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.sharedUtils = {
        toNonEmptyString,
        joinWithConjunction,
        escapeHtml,
        formatLocalDate,
        openMailtoDraft,
        getCoachingCcEmail
    };
})();
