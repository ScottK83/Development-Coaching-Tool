(function() {
    'use strict';

    function buildPrompt(entry, preferredName) {
        return `I'm a supervisor preparing call listening feedback for ${preferredName} (${entry.employeeName}).

Call details:
- Call date: ${entry.listenedOn}
- Call reference: ${entry.callReference || 'Not provided'}

Feedback notes:
What went well:
${entry.whatWentWell || '- None provided'}

Improvement opportunities:
${entry.improvementAreas || '- None provided'}

Oscar / Knowledge Base URL:
${entry.oscarUrl || '- Not provided'}

Relevant guidance to include:
${entry.relevantInfo || '- Not provided'}

Manager context:
${entry.managerNotes || '- Not provided'}

Write an email-ready coaching message to the associate.

Requirements:
- Professional, supportive, and specific
- Start with recognition of strengths
- Include clear improvement actions with practical next steps
- If Oscar URL or relevant guidance is provided, naturally reference it as a resource
- Keep concise: 1 short intro paragraph + 3-5 bullet points + 1 closing line
- Do NOT use em dashes (—)
- Return ONLY the final email body text.`;
    }

    function setPromptButtonFeedback(button) {
        if (!button) return;
        const originalText = button.textContent;
        button.textContent = '✅ Copied + Opening Copilot';
        setTimeout(() => {
            button.textContent = originalText;
        }, 1500);
    }

    function copyPromptAndOpenCopilot(options = {}) {
        const prompt = String(options.prompt || '');
        if (!prompt.trim()) {
            return { ok: false, reason: 'missing-prompt' };
        }

        setPromptButtonFeedback(options.button);

        const openWindow = typeof options.openWindow === 'function'
            ? options.openWindow
            : (url, target) => window.open(url, target);
        const showToast = typeof options.showToast === 'function' ? options.showToast : () => {};
        const alertFn = typeof options.alertFn === 'function' ? options.alertFn : () => {};
        const clipboardWriteText = options.clipboardWriteText;
        const copilotWindow = openWindow('https://copilot.microsoft.com', '_blank');

        if (typeof clipboardWriteText === 'function') {
            clipboardWriteText(prompt)
                .then(() => {
                    showToast('✅ Call listening prompt copied. Paste into Copilot with Ctrl+V.', 4000);
                    if (!copilotWindow) {
                        alertFn('✅ Prompt copied to clipboard. Open https://copilot.microsoft.com and paste with Ctrl+V.');
                    }
                })
                .catch(() => {
                    showToast('⚠️ Could not copy automatically. Prompt is in the box below.', 4500);
                });
        }

        return { ok: true, copilotWindow };
    }

    function buildOutlookSubject(employeeName, callDate, getEmployeeNickname) {
        const preferredName = employeeName ? (typeof getEmployeeNickname === 'function' ? (getEmployeeNickname(employeeName) || employeeName) : employeeName) : 'Associate';
        return `Call Listening Feedback - ${preferredName}${callDate ? ` - ${callDate}` : ''}`;
    }

    function generateOutlookDraft(options = {}) {
        const employeeName = String(options.employeeName || '').trim();
        const callDate = String(options.callDate || '').trim();
        const bodyText = String(options.bodyText || '').trim();
        const showToast = typeof options.showToast === 'function' ? options.showToast : () => {};

        if (!bodyText) {
            showToast('⚠️ Paste the Copilot-generated email content first.', 3000);
            return { ok: false, reason: 'missing-body' };
        }

        const subject = buildOutlookSubject(employeeName, callDate, options.getEmployeeNickname);

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

    function buildHistorySummaryText(employeeName, entryCount) {
        return `${entryCount} saved call listening log${entryCount === 1 ? '' : 's'} for ${employeeName}.`;
    }

    function buildHistoryItemHtml(entry, escapeHtml) {
        const safeEscapeHtml = typeof escapeHtml === 'function' ? escapeHtml : (value) => String(value || '');
        const createdAt = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
        return `<li style="margin-bottom: 14px; line-height: 1.35;">
            <div style="font-weight: bold; color: #37474f;">${safeEscapeHtml(entry.listenedOn || '')}${entry.callReference ? ` • Ref: ${safeEscapeHtml(entry.callReference)}` : ''}</div>
            <div style="margin-top: 4px;"><strong>✅ Went well:</strong> ${safeEscapeHtml(entry.whatWentWell || 'N/A')}</div>
            <div style="margin-top: 2px;"><strong>⚠️ Improve:</strong> ${safeEscapeHtml(entry.improvementAreas || 'N/A')}</div>
            <div style="font-size: 0.82em; color: #666; margin-top: 4px;">Saved: ${safeEscapeHtml(createdAt)}</div>
            <div style="display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap;">
                <button type="button" data-call-action="load" data-entry-id="${safeEscapeHtml(entry.id)}" style="background: #607d8b; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 0.82em;">Load</button>
                <button type="button" data-call-action="copy-verint" data-entry-id="${safeEscapeHtml(entry.id)}" style="background: #6a1b9a; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 0.82em;">Copy Verint</button>
                <button type="button" data-call-action="delete" data-entry-id="${safeEscapeHtml(entry.id)}" style="background: #c62828; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 0.82em;">Delete</button>
            </div>
        </li>`;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.callListening = {
        buildPrompt,
        copyPromptAndOpenCopilot,
        buildOutlookSubject,
        generateOutlookDraft,
        buildHistorySummaryText,
        buildHistoryItemHtml
    };
})();