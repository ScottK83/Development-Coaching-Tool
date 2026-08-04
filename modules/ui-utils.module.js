(function() {
    'use strict';

    // ============================================
    // UI UTILITIES & COMPONENTS
    // ============================================

    /**
     * Show toast notification
     */
    function showToast(message, duration) {
        if (typeof window.showToast === 'function') return window.showToast(message, duration);
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
            flashButton(opts.button, '✓ Copied');
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
     * Show loading spinner
     */
    function showSpinner(message = 'Loading...') {
        let spinner = document.getElementById('globalSpinner');
        if (!spinner) {
            spinner = document.createElement('div');
            spinner.id = 'globalSpinner';
            spinner.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.3);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 9999;
            `;
            document.body.appendChild(spinner);
        }
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: var(--bg-surface);
            padding: 30px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        const spinnerIcon = document.createElement('div');
        spinnerIcon.style.cssText = 'width: 40px; height: 40px; border: 4px solid #f0f0f0; border-top: 4px solid #2196F3; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 15px;';
        const messageEl = document.createElement('p');
        messageEl.textContent = message;
        content.appendChild(spinnerIcon);
        content.appendChild(messageEl);
        
        spinner.innerHTML = '';
        spinner.appendChild(content);
        spinner.style.display = 'flex';
        
        return spinner;
    }

    /**
     * Hide loading spinner
     */
    function hideSpinner() {
        const spinner = document.getElementById('globalSpinner');
        if (spinner) {
            spinner.style.display = 'none';
        }
    }

    /**
     * Switch between sections  
     */
    function switchSection(sectionId) {
        // Hide all sections
        const sections = document.querySelectorAll('section.form-section');
        sections.forEach(section => {
            section.style.display = 'none';
        });
        
        // Show target section
        const targetSection = document.getElementById(sectionId);
        if (targetSection) {
            targetSection.style.display = 'block';
            
            // Scroll to top
            window.scrollTo(0, 0);
        }
    }

    /**
     * Show dialog/modal
     */
    function showDialog(title, content, buttons = []) {
        const backdrop = document.createElement('div');
        backdrop.className = 'devcoach-dialog-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;
        
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: var(--bg-surface);
            border-radius: 8px;
            padding: 30px;
            max-width: 500px;
            width: 90%;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        `;
        
        const titleEl = document.createElement('h2');
        titleEl.textContent = title;
        titleEl.style.cssText = 'margin-top: 0; margin-bottom: 15px; color: var(--text-primary);';
        dialog.appendChild(titleEl);
        
        const contentEl = document.createElement('div');
        if (typeof content === 'string') {
            contentEl.textContent = content;
        } else {
            contentEl.appendChild(content);
        }
        contentEl.style.cssText = 'margin-bottom: 20px; color: var(--text-secondary); line-height: 1.6;';
        dialog.appendChild(contentEl);
        
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.cssText = 'display: flex; gap: 10px; justify-content: flex-end;';
        
        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.textContent = btn.text;
            button.style.cssText = `
                padding: 10px 20px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                background: ${btn.style === 'danger' ? '#dc3545' : btn.style === 'success' ? '#28a745' : '#6c757d'};
                color: white;
            `;
            button.onclick = () => {
                btn.callback?.();
                backdrop.remove();
            };
            buttonsContainer.appendChild(button);
        });
        
        dialog.appendChild(buttonsContainer);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        
        return backdrop;
    }

    /**
     * Hide dialog
     */
    function hideDialog() {
        const dialogs = document.querySelectorAll('.devcoach-dialog-backdrop');
        dialogs.forEach(d => d.remove());
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
        showSpinner,
        hideSpinner,
        switchSection,
        showDialog,
        hideDialog,
        injectUIAnimations
    };

    // Also expose to window for backward compatibility
    window.copyToClipboard = copyToClipboard;
    window.flashButton = flashButton;
    window.showToast = window.showToast || showToast;
    window.showSpinner = window.showSpinner || showSpinner;
    window.hideSpinner = window.hideSpinner || hideSpinner;
    window.switchSection = window.switchSection || switchSection;
})();
