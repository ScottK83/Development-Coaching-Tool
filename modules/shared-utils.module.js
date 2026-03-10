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
     * @param {string} subject
     * @param {string} bodyText
     * @returns {void}
     */
    function openMailtoDraft(subject, bodyText) {
        const safeSubject = String(subject || '');
        const safeBodyText = String(bodyText || '');

        const mailtoLink = document.createElement('a');
        mailtoLink.href = `mailto:?subject=${encodeURIComponent(safeSubject)}&body=${encodeURIComponent(safeBodyText)}`;
        document.body.appendChild(mailtoLink);
        mailtoLink.click();
        document.body.removeChild(mailtoLink);
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.sharedUtils = {
        toNonEmptyString,
        joinWithConjunction,
        escapeHtml,
        openMailtoDraft
    };
})();
