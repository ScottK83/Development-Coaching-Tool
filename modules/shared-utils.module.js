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
     * drifts into tomorrow for any local time past UTC-midnight. 
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
            const read = window.DevCoachModules?.storage?.readStore;
            if (typeof read === 'function') {
                const value = read('ccEmail');
                if (typeof value === 'string') return value;
            }
            // Written as a bare string before it was routed through the storage
            // module, so an existing setting is still readable.
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

    /**
     * Where Copilot lives. One literal, one fallback, and every module that
     * opens or links to Copilot goes through here.
     *
     * This expression was written out twelve times across eight modules. A
     * cleanup in April replaced some of them and was recorded as finished;
     * five sites had been missed and nobody noticed for four months, which is
     * the whole argument for it living in one function rather than in an idiom
     * everyone is trusted to repeat.
     */
    function copilotUrl() {
        return (window.DevCoachConstants && window.DevCoachConstants.COPILOT_URL) || 'https://copilot.microsoft.com';
    }
    /**
     * Hand a prompt over to Copilot: open the tab, put the text on the
     * clipboard, and report what actually happened.
     *
     * The window opens FIRST, synchronously, inside the click that called
     * this. That ordering is the whole point of the function. A popup opened
     * after an awaited clipboard write has usually lost its user activation
     * and gets blocked, which is what five of the previous call sites did:
     * copyToClipboard(...).then(ok => window.open(...)). The same constraint
     * is documented for the clipboard write itself in center-ranking.
     *
     * Nothing here reports success it has not seen. The button flashes after
     * the copy resolves and says what the copy did, and if the popup was
     * blocked the caller is told rather than left with text on the clipboard
     * and no tab to paste it into.
     *
     * Resolves { ok, copilotWindow, popupBlocked }. Never rejects.
     */
    function copyPromptAndOpenCopilot(text, options) {
        var opts = options || {};
        var value = String(text == null ? '' : text);

        if (!value.trim()) {
            if (typeof window.showToast === 'function') window.showToast('Nothing to copy yet.', 2500);
            return Promise.resolve({ ok: false, copilotWindow: null, popupBlocked: false });
        }

        var openWindow = typeof opts.openWindow === 'function'
            ? opts.openWindow
            : function (url, target) { return window.open(url, target); };

        var copilotWindow = null;
        try {
            copilotWindow = openWindow(copilotUrl(), '_blank');
        } catch (err) {
            copilotWindow = null;
        }
        var popupBlocked = !copilotWindow;

        var copy = typeof window.copyToClipboard === 'function'
            ? window.copyToClipboard(value, {
                message: opts.message,
                button: opts.button,
                successLabel: opts.successLabel,
                silent: opts.silent
            })
            : Promise.resolve(false);

        return Promise.resolve(copy).then(function (ok) {
            if (!ok && typeof opts.onCopyFailed === 'function') {
                try { opts.onCopyFailed(); } catch (err) { /* a recovery path may not apply */ }
            }
            // Only worth saying when the copy worked: if the copy failed the
            // user already has a louder problem and a longer toast about it.
            if (ok && popupBlocked && typeof window.showToast === 'function') {
                window.showToast('Copied, but the Copilot tab was blocked. Open Copilot and press Ctrl+V.', 5000);
            }
            return { ok: ok, copilotWindow: copilotWindow, popupBlocked: popupBlocked };
        });
    }
    /**
     * Read, write and wire the CC address used on every coaching draft.
     *
     * getCoachingCcEmail has been reading devCoachingTool_ccEmail since it was
     * written, and nothing in the app has ever written it, so openMailtoDraft
     * has always built its drafts with no CC at all. The read was fine; the
     * setting was simply missing.
     */
    function setCoachingCcEmail(value) {
        var prefix = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
        var clean = String(value == null ? '' : value).trim();
        try {
            // Through the storage module so the write is tracked and synced.
            // A store written around it never marks itself dirty and therefore
            // never reaches the other machine, silently.
            const save = window.DevCoachModules?.storage?.saveWithSizeCheck;
            if (clean && typeof save === 'function') save('ccEmail', clean);
            else if (clean) localStorage.setItem(prefix + 'ccEmail', clean);
            else localStorage.removeItem(prefix + 'ccEmail');
            return true;
        } catch (err) {
            return false;
        }
    }

    // A light check only. The address goes into a mailto, where an unusable
    // one costs a bounced draft rather than anything worse, and being strict
    // about addresses is a good way to reject a valid one.
    function looksLikeEmail(value) {
        var v = String(value == null ? '' : value).trim();
        return v.indexOf('@') > 0 && v.indexOf('@') < v.length - 1 && v.indexOf(' ') === -1;
    }

    function bindCoachingCcEmailSetting(doc) {
        var d = doc || document;
        var input = d.getElementById('coachingCcEmail');
        var button = d.getElementById('saveCoachingCcEmail');
        var status = d.getElementById('coachingCcEmailStatus');
        if (!input || !button || input.dataset.ccBound) return;
        input.dataset.ccBound = 'true';

        input.value = getCoachingCcEmail();
        if (status) {
            status.textContent = input.value
                ? 'Drafts are copied to ' + input.value
                : 'No CC. Drafts open with the To field empty and nobody copied.';
        }

        button.addEventListener('click', function () {
            var value = String(input.value || '').trim();
            if (value && !looksLikeEmail(value)) {
                if (status) status.textContent = 'That does not look like an email address.';
                return;
            }
            var saved = setCoachingCcEmail(value);
            if (status) {
                status.textContent = !saved ? 'Could not save. Storage is unavailable.'
                    : value ? 'Saved. Drafts are copied to ' + value
                    : 'Saved. Drafts will have no CC.';
            }
            if (saved && typeof window.showToast === 'function') {
                window.showToast(value ? 'CC saved' : 'CC cleared', 2500);
            }
        });
    }
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.sharedUtils = {
        copilotUrl: copilotUrl,
        setCoachingCcEmail: setCoachingCcEmail,
        bindCoachingCcEmailSetting: bindCoachingCcEmailSetting,
        looksLikeEmail: looksLikeEmail,
        copyPromptAndOpenCopilot: copyPromptAndOpenCopilot,
        toNonEmptyString,
        joinWithConjunction,
        escapeHtml,
        formatLocalDate,
        openMailtoDraft,
        getCoachingCcEmail
    };
})();
