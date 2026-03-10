// ============================================
// HOT TIP OF THE DAY MODULE
// ============================================

let hotTipInitialized = false;

function initializeHotTip() {
    if (hotTipInitialized) {
        renderHotTipHistory();
        return;
    }

    document.getElementById('generateHotTipPromptBtn')?.addEventListener('click', generateHotTipPrompt);
    document.getElementById('copyHotTipPromptBtn')?.addEventListener('click', copyHotTipPromptAndOpenCopilot);
    document.getElementById('generateHotTipEmailBtn')?.addEventListener('click', generateHotTipEmail);
    document.getElementById('copyHotTipEmailBtn')?.addEventListener('click', copyHotTipEmail);
    document.getElementById('saveHotTipBtn')?.addEventListener('click', saveHotTip);
    document.getElementById('clearHotTipBtn')?.addEventListener('click', clearHotTip);

    hotTipInitialized = true;
    renderHotTipHistory();
}

// ============================================
// STEP 1: GENERATE COPILOT PROMPT
// ============================================

function generateHotTipPrompt() {
    const title = document.getElementById('hotTipTitle')?.value.trim() || '';
    const context = document.getElementById('hotTipContext')?.value.trim() || '';
    const tone = document.getElementById('hotTipTone')?.value || 'friendly-reminder';

    if (!title) {
        alert('⚠️ Please enter a tip title or topic.');
        return;
    }
    if (!context) {
        alert('⚠️ Please describe the situation or context.');
        return;
    }

    const toneDescriptions = {
        'friendly-reminder': 'friendly and encouraging, like a helpful reminder from a supportive supervisor',
        'coaching': 'instructional and clear, like a coaching guide that teaches the correct process',
        'urgent': 'urgent and direct, emphasizing this is critical and must be followed immediately',
        'celebratory': 'positive and celebratory, recognizing good work while reinforcing best practices'
    };

    const toneGuide = toneDescriptions[tone] || toneDescriptions['friendly-reminder'];

    const prompt = `Write a "Hot Tip of the Day" email for my call center team. Keep it concise and actionable.

Topic: ${title}

Context / What happened:
${context}

Tone: ${toneGuide}

Format the tip as:
1. A short greeting to the team
2. The tip title as a bold header
3. A brief explanation of why this matters (2-3 sentences max)
4. The correct process or action steps (bulleted list)
5. A brief positive closing

Keep it under 200 words. Do not use overly formal language. Make it feel like it's coming from a real team lead who cares.`;

    const promptDisplay = document.getElementById('hotTipPromptDisplay');
    const promptSection = document.getElementById('hotTipPromptSection');
    const responseSection = document.getElementById('hotTipResponseSection');

    if (promptDisplay) promptDisplay.value = prompt;
    if (promptSection) promptSection.style.display = 'block';
    if (responseSection) responseSection.style.display = 'block';
}

// ============================================
// STEP 2: COPY PROMPT & OPEN COPILOT
// ============================================

function copyHotTipPromptAndOpenCopilot() {
    const promptDisplay = document.getElementById('hotTipPromptDisplay');
    if (!promptDisplay?.value) return;

    navigator.clipboard.writeText(promptDisplay.value).then(() => {
        if (typeof showToast === 'function') {
            showToast('✅ Prompt copied! Opening Copilot...', 2000);
        }
        window.open('https://copilot.microsoft.com', '_blank');
    }).catch(() => {
        promptDisplay.select();
        alert('⚠️ Unable to copy. Please select and copy manually.');
    });
}

// ============================================
// STEP 3: GENERATE EMAIL FROM COPILOT RESPONSE
// ============================================

function generateHotTipEmail() {
    const title = document.getElementById('hotTipTitle')?.value.trim() || '';
    const copilotResponse = document.getElementById('hotTipCopilotResponse')?.value.trim() || '';

    if (!copilotResponse) {
        alert('⚠️ Please paste the Copilot response first.');
        return;
    }

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const emailBody = `Subject: 🔥 Hot Tip of the Day — ${title || 'Team Update'} (${today})

${copilotResponse}`;

    const previewSection = document.getElementById('hotTipEmailPreviewSection');
    const previewText = document.getElementById('hotTipEmailPreviewText');

    if (previewText) previewText.textContent = emailBody;
    if (previewSection) previewSection.style.display = 'block';
}

// ============================================
// EMAIL ACTIONS
// ============================================

function copyHotTipEmail() {
    const emailText = document.getElementById('hotTipEmailPreviewText')?.textContent || '';
    if (!emailText.trim()) {
        alert('⚠️ No email to copy.');
        return;
    }

    const button = document.getElementById('copyHotTipEmailBtn');
    navigator.clipboard.writeText(emailText).then(() => {
        if (!button) return;
        const originalText = button.textContent;
        button.textContent = '✓ Copied!';
        setTimeout(() => { button.textContent = originalText; }, 1200);
    }).catch(() => {
        alert('⚠️ Unable to copy email.');
    });
}

// ============================================
// SAVE & HISTORY
// ============================================

function saveHotTip() {
    const title = document.getElementById('hotTipTitle')?.value.trim() || '';
    const context = document.getElementById('hotTipContext')?.value.trim() || '';
    const tone = document.getElementById('hotTipTone')?.value || '';
    const copilotResponse = document.getElementById('hotTipCopilotResponse')?.value.trim() || '';
    const emailBody = document.getElementById('hotTipEmailPreviewText')?.textContent || '';

    if (!title || !emailBody) {
        alert('⚠️ Generate the email first before saving.');
        return;
    }

    const history = window.DevCoachModules?.storage?.loadHotTipHistory?.() || { entries: [] };
    if (!Array.isArray(history.entries)) history.entries = [];

    const entry = {
        id: `ht_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title,
        context,
        tone,
        copilotResponse,
        emailBody,
        createdAt: new Date().toISOString()
    };

    history.entries.unshift(entry);

    // Cap at 100 tips
    if (history.entries.length > 100) {
        history.entries = history.entries.slice(0, 100);
    }

    window.DevCoachModules?.storage?.saveHotTipHistory?.(history);
    renderHotTipHistory();

    if (typeof queueCallListeningRepoSync === 'function') {
        queueCallListeningRepoSync('hot tip saved');
    }

    if (typeof showToast === 'function') {
        showToast('✅ Hot tip saved to archive!', 2500);
    }

    // Auto-save button feedback
    const btn = document.getElementById('saveHotTipBtn');
    if (btn) {
        const original = btn.textContent;
        btn.textContent = '✓ Saved!';
        setTimeout(() => { btn.textContent = original; }, 1500);
    }
}

function renderHotTipHistory() {
    const listEl = document.getElementById('hotTipHistoryList');
    const countEl = document.getElementById('hotTipHistoryCount');
    if (!listEl) return;

    const history = window.DevCoachModules?.storage?.loadHotTipHistory?.() || { entries: [] };
    const entries = Array.isArray(history.entries) ? history.entries : [];

    if (countEl) {
        countEl.textContent = entries.length > 0 ? `(${entries.length} saved)` : '';
    }

    if (entries.length === 0) {
        listEl.innerHTML = '<p style="color: #999; text-align: center; padding: 12px;">No tips saved yet.</p>';
        return;
    }

    listEl.innerHTML = entries.map(entry => {
        const date = entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : 'Unknown';
        const contextPreview = String(entry.context || '').slice(0, 100) + (String(entry.context || '').length > 100 ? '...' : '');

        return `<div style="padding: 12px; border-bottom: 1px solid #eee; cursor: pointer;" onclick="expandHotTipEntry('${entry.id}')">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-weight: 600; color: #e65100; font-size: 0.95em;">🔥 ${escapeHtmlHotTip(entry.title)}</div>
                <div style="display: flex; gap: 6px; align-items: center;">
                    <span style="font-size: 0.8em; color: #999;">${date}</span>
                    <button onclick="event.stopPropagation(); reuseHotTipEmail('${entry.id}')" style="background: #f57c00; color: white; border: none; border-radius: 4px; padding: 3px 8px; font-size: 0.75em; cursor: pointer;">📋 Copy</button>
                    <button onclick="event.stopPropagation(); deleteHotTipEntry('${entry.id}')" style="background: #999; color: white; border: none; border-radius: 4px; padding: 3px 8px; font-size: 0.75em; cursor: pointer;">✕</button>
                </div>
            </div>
            <div style="font-size: 0.82em; color: #888; margin-top: 4px;">${escapeHtmlHotTip(contextPreview)}</div>
            <div id="hotTipExpand_${entry.id}" style="display: none; margin-top: 10px; padding: 10px; background: #fafafa; border-radius: 4px; border: 1px solid #eee; white-space: pre-wrap; font-size: 0.85em; color: #333; max-height: 300px; overflow-y: auto;"></div>
        </div>`;
    }).join('');
}

function expandHotTipEntry(entryId) {
    const expandEl = document.getElementById(`hotTipExpand_${entryId}`);
    if (!expandEl) return;

    if (expandEl.style.display === 'block') {
        expandEl.style.display = 'none';
        return;
    }

    const history = window.DevCoachModules?.storage?.loadHotTipHistory?.() || { entries: [] };
    const entry = (history.entries || []).find(e => e.id === entryId);
    if (!entry) return;

    expandEl.textContent = entry.emailBody || entry.copilotResponse || 'No content saved.';
    expandEl.style.display = 'block';
}

function reuseHotTipEmail(entryId) {
    const history = window.DevCoachModules?.storage?.loadHotTipHistory?.() || { entries: [] };
    const entry = (history.entries || []).find(e => e.id === entryId);
    if (!entry) return;

    const text = entry.emailBody || '';
    navigator.clipboard.writeText(text).then(() => {
        if (typeof showToast === 'function') {
            showToast('✅ Tip email copied to clipboard!', 2000);
        }
    }).catch(() => {
        alert('⚠️ Unable to copy.');
    });
}

function deleteHotTipEntry(entryId) {
    if (!confirm('Delete this tip from the archive?')) return;

    const history = window.DevCoachModules?.storage?.loadHotTipHistory?.() || { entries: [] };
    history.entries = (history.entries || []).filter(e => e.id !== entryId);
    window.DevCoachModules?.storage?.saveHotTipHistory?.(history);
    renderHotTipHistory();

    if (typeof queueCallListeningRepoSync === 'function') {
        queueCallListeningRepoSync('hot tip deleted');
    }
}

function clearHotTip() {
    const title = document.getElementById('hotTipTitle');
    const context = document.getElementById('hotTipContext');
    const tone = document.getElementById('hotTipTone');
    const promptDisplay = document.getElementById('hotTipPromptDisplay');
    const copilotResponse = document.getElementById('hotTipCopilotResponse');
    const promptSection = document.getElementById('hotTipPromptSection');
    const responseSection = document.getElementById('hotTipResponseSection');
    const previewSection = document.getElementById('hotTipEmailPreviewSection');
    const previewText = document.getElementById('hotTipEmailPreviewText');

    if (title) title.value = '';
    if (context) context.value = '';
    if (tone) tone.value = 'friendly-reminder';
    if (promptDisplay) promptDisplay.value = '';
    if (copilotResponse) copilotResponse.value = '';
    if (previewText) previewText.textContent = '';
    if (promptSection) promptSection.style.display = 'none';
    if (responseSection) responseSection.style.display = 'none';
    if (previewSection) previewSection.style.display = 'none';
}

function escapeHtmlHotTip(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
