(function() {
    'use strict';

    // ============================================
    // UI UTILITIES & COMPONENTS
    // ============================================

    /**
     * Show toast notification
     */
    // Delegates to the real toast in script.js, but only once that exists and
    // only if it is not this function. Line 295 assigns this to window.showToast
    // when nothing else has, so before script.js loads the delegation used to
    // call itself until the stack ran out. That only bit when script.js failed
    // to load, which is exactly when a toast is worth having.
    function showToast(message, duration) {
        var real = window.showToast;
        if (typeof real === 'function' && real !== showToast) return real(message, duration);
        if (typeof console !== 'undefined' && console.info) console.info('[toast] ' + message);
    }

    /**
     * Copy text to the clipboard.
     *
     * Every generator in the app ends the same way — put text on the
     * clipboard, tell the user it worked. That was hand-rolled at ~50 call
     * sites, each with its own idea of feedback: some toasted, some swapped
     * the button label, some did both, and a few had no error path at all so
     * a failed copy looked exactly like a successful one.
     *
     * options.message  — toast copy on success (defaults to a generic one)
     * options.button   — button element to flash "Copied" on
     * options.silent   — suppress the success toast (button flash only)
     *
     * Resolves true when the text landed on the clipboard, false otherwise.
     * Never rejects: callers should not have to guard a copy.
     */
    async function copyToClipboard(text, options) {
        const opts = options || {};
        const value = String(text == null ? '' : text);
        if (!value) {
            showToast('Nothing to copy yet.', 2500);
            return false;
        }

        let ok = false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(value);
                ok = true;
            }
        } catch (e) {
            ok = false;
        }

        // The async API needs a secure context and an unblocked permission.
        // Fall back to the old selection trick rather than failing outright.
        if (!ok) {
            try {
                const scratch = document.createElement('textarea');
                scratch.value = value;
                scratch.setAttribute('readonly', '');
                scratch.style.cssText = 'position:fixed; top:-1000px; left:-1000px; opacity:0;';
                document.body.appendChild(scratch);
                scratch.select();
                ok = document.execCommand('copy');
                document.body.removeChild(scratch);
            } catch (e) {
                ok = false;
            }
        }

        if (ok) {
            // successLabel lets a caller keep its own wording on the button while
            // still flashing it only once the copy has actually resolved. Three
            // call sites used to flash their own label before the copy ran, so a
            // failed copy still read as a success.
            flashButton(opts.button, opts.successLabel || '✓ Copied');
            if (!opts.silent) showToast(opts.message || '📋 Copied to clipboard', 2500);
        } else {
            flashButton(opts.button, 'Copy failed');
            showToast('⚠️ Could not reach the clipboard. Select the text and press Ctrl+C.', 5000);
        }
        return ok;
    }

    // Temporarily swap a button's label, then restore it. Guards against
    // double-clicks stashing the already-swapped label as the original.
    function flashButton(button, label, duration) {
        if (!button || !button.textContent) return;
        if (button.dataset.flashRestore === undefined) {
            button.dataset.flashRestore = button.textContent;
        }
        button.textContent = label;
        clearTimeout(button._flashTimer);
        button._flashTimer = setTimeout(function () {
            button.textContent = button.dataset.flashRestore;
            delete button.dataset.flashRestore;
        }, duration || 1800);
    }

    /**
     * Get CSS animations needed for UI effects
     */
    function injectUIAnimations() {
        if (document.getElementById('uiAnimations')) return;
        
        const style = document.createElement('style');
        style.id = 'uiAnimations';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(400px); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(400px); opacity: 0; }
            }
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    // Initialize animations on module load
    injectUIAnimations();

    // Export functions
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.uiUtils = {
        showToast,
        copyToClipboard,
        flashButton,
        injectUIAnimations
    };

    // Also expose to window for backward compatibility
    window.copyToClipboard = copyToClipboard;
    window.flashButton = flashButton;
    window.showToast = window.showToast || showToast;
})();
