(function() {
    'use strict';

    function buildTranscriptSection(entry) {
        const prepare = window.DevCoachModules?.callTranscript?.prepareForPrompt
            || ((value) => String(value || '').trim());
        const transcript = prepare(entry.transcript);
        if (!transcript) return '';

        return `Call transcript (verbatim, use this as the source of truth):
"""
${transcript}
"""

`;
    }

    function buildCallDetailLines(entry) {
        const context = window.DevCoachModules?.callTranscript?.buildCallContextLines;
        const extra = typeof context === 'function' ? context(entry.transcript) : [];
        return [
            `- Call date: ${entry.listenedOn}`,
            `- Call reference: ${entry.callReference || 'Not provided'}`,
            ...extra
        ].join('\n');
    }

    // The QA read is context for tone and content, not something to paste into
    // the associate's email, so the prompt is explicit about that.
    function buildQaSection(entry) {
        const scorer = window.DevCoachModules?.callQa;
        if (!scorer?.scoreCall || !entry.transcript) return '';

        const analysis = window.DevCoachModules?.callTranscript?.analyzeTranscript?.(entry.transcript, {
            associateName: entry.employeeName
        });
        const text = scorer.buildQaText(scorer.scoreCall(entry.transcript, {
            associateName: entry.employeeName,
            context: { silenceGaps: analysis?.silenceGaps || [] }
        }));

        return text ? `${text}\n\n` : '';
    }

    function buildPrompt(entry, preferredName) {
        const transcriptSection = buildTranscriptSection(entry);
        const transcriptRules = transcriptSection
            ? `\n- Ground every point in the transcript. Where it helps, quote a short phrase the associate actually said\n- Do not invent details that are not in the transcript or my notes`
            : '';

        return `I'm a supervisor preparing call listening feedback for ${preferredName} (${entry.employeeName}).

Call details:
${buildCallDetailLines(entry)}

${transcriptSection}${buildQaSection(entry)}Feedback notes:
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
- Open with genuine, specific recognition. Where the notes show the call went well, say so plainly and warmly rather than rushing past it to the coaching. Praise the behaviour and why it mattered to the customer, not just "good job"
- Match the tone to the call: if the strengths clearly outweigh the coaching points, this should read as a well earned pat on the back with a couple of refinements, not a correction
- Include clear improvement actions with practical next steps
- If Oscar URL or relevant guidance is provided, naturally reference it as a resource
- Keep concise: 1 short intro paragraph + 3-5 bullet points + 1 closing line
- Do NOT use em dashes (, )${transcriptRules}
- The QA read is background for you, not content for the associate. Do not paste the checklist or the words "opportunity" and "cannot tell" into the email; turn what matters into normal coaching language
- Return ONLY the final email body text.`;
    }

    /**
     * Start the Copilot handoff for this call.
     *
     * The returned ok means "there was a prompt and the handoff began", which
     * is what the caller uses it for: deciding whether to reveal the Outlook
     * panel. It is deliberately synchronous, because that decision cannot wait
     * on the clipboard.
     *
     * What is no longer synchronous is the claim of success. This used to flash
     * "Copied + Opening Copilot" on the button before the copy ran and then
     * discard the copy's result entirely, so a blocked clipboard looked exactly
     * like a successful one. The label is the same; it now appears only once the
     * copy has actually landed, and says "Copy failed" when it has not.
     */
    function copyPromptAndOpenCopilot(options = {}) {
        const prompt = String(options.prompt || '');
        if (!prompt.trim()) {
            return { ok: false, reason: 'missing-prompt' };
        }

        const handoff = window.DevCoachModules.sharedUtils.copyPromptAndOpenCopilot(prompt, {
            button: options.button,
            successLabel: '✅ Copied + Opening Copilot',
            message: '📋 Call listening prompt copied. Paste into Copilot with Ctrl+V',
            openWindow: options.openWindow
        });

        return { ok: true, handoff };
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
        const transcriptTag = entry.transcript ? ' • transcript saved' : '';
        return `<li class="call-history-item">
            <div class="call-history-title">${safeEscapeHtml(entry.listenedOn || '')}${entry.callReference ? ` • Ref: ${safeEscapeHtml(entry.callReference)}` : ''}</div>
            <div style="margin-top: 4px;"><strong>✅ Went well:</strong> ${safeEscapeHtml(entry.whatWentWell || 'N/A')}</div>
            <div style="margin-top: 2px;"><strong>⚠️ Improve:</strong> ${safeEscapeHtml(entry.improvementAreas || 'N/A')}</div>
            <div class="call-history-meta">Saved: ${safeEscapeHtml(createdAt)}${transcriptTag}</div>
            <div class="flex-row" style="margin-top: 8px;">
                <button type="button" data-call-action="load" data-entry-id="${safeEscapeHtml(entry.id)}">Load</button>
                <button type="button" data-call-action="copy-verint" data-entry-id="${safeEscapeHtml(entry.id)}">Copy Verint</button>
                <button type="button" data-call-action="delete" data-entry-id="${safeEscapeHtml(entry.id)}">Delete</button>
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