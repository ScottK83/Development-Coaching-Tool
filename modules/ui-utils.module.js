(function() {
    'use strict';

    // ============================================
    // UI UTILITIES & COMPONENTS
    // ============================================

    /**
     * Show toast notification
     */
    function showToast(message, duration = 5000) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.setAttribute('aria-atomic', 'true');
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #28a745;
            color: white;
            padding: 12px 20px;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            font-size: 14px;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, duration);
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
            background: white;
            padding: 30px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        content.innerHTML = `
            <div style="width: 40px; height: 40px; border: 4px solid #f0f0f0; border-top: 4px solid #2196F3; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 15px;"></div>
            <p>${message}</p>
        `;
        
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
            background: white;
            border-radius: 8px;
            padding: 30px;
            max-width: 500px;
            width: 90%;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        `;
        
        const titleEl = document.createElement('h2');
        titleEl.textContent = title;
        titleEl.style.cssText = 'margin-top: 0; margin-bottom: 15px; color: #333;';
        dialog.appendChild(titleEl);
        
        const contentEl = document.createElement('div');
        if (typeof content === 'string') {
            contentEl.innerHTML = content;
        } else {
            contentEl.appendChild(content);
        }
        contentEl.style.cssText = 'margin-bottom: 20px; color: #666; line-height: 1.6;';
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
        const dialogs = document.querySelectorAll('[style*="position: fixed"][style*="rgba(0,0,0,0.5)"]');
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
        showSpinner,
        hideSpinner,
        switchSection,
        showDialog,
        hideDialog,
        injectUIAnimations
    };

    // Also expose to window for backward compatibility
    window.showToast = window.showToast || showToast;
    window.showSpinner = window.showSpinner || showSpinner;
    window.hideSpinner = window.hideSpinner || hideSpinner;
    window.switchSection = window.switchSection || switchSection;
})();
