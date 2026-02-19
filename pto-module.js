// ============================================
// PTO / TIME-OFF TRACKER
// ============================================

const PTO_STORAGE_KEY = 'ptoTracker';

function loadPtoTracker() {
    try {
        const saved = localStorage.getItem(PTO_STORAGE_KEY);
        return saved ? JSON.parse(saved) : {
            availableHours: 100,
            thresholds: { warning: 20, policy: 40 },
            entries: []
        };
    } catch (error) {
        console.error('Error loading PTO tracker:', error);
        return { availableHours: 100, thresholds: { warning: 20, policy: 40 }, entries: [] };
    }
}

function savePtoTracker(data) {
    try {
        localStorage.setItem(PTO_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
        console.error('Error saving PTO tracker:', error);
    }
}

function initializePtoTracker() {
    const data = loadPtoTracker();
    const availableInput = document.getElementById('ptoAvailableHours');
    const warningInput = document.getElementById('ptoThresholdWarning');
    const policyInput = document.getElementById('ptoThresholdPolicy');
    const addBtn = document.getElementById('ptoAddEntryBtn');
    const generateBtn = document.getElementById('ptoGenerateEmailBtn');
    const copyBtn = document.getElementById('ptoCopyEmailBtn');

    if (availableInput) availableInput.value = data.availableHours ?? 0;
    if (warningInput) warningInput.value = data.thresholds?.warning ?? 20;
    if (policyInput) policyInput.value = data.thresholds?.policy ?? 40;

    renderPtoSummary(data);
    renderPtoEntries(data);

    if (availableInput && !availableInput.dataset.bound) {
        availableInput.addEventListener('input', () => {
            const updated = loadPtoTracker();
            updated.availableHours = Math.min(100, Math.max(0, parseFloat(availableInput.value) || 0));
            availableInput.value = updated.availableHours;
            savePtoTracker(updated);
            renderPtoSummary(updated);
        });
        availableInput.dataset.bound = 'true';
    }

    if (warningInput && !warningInput.dataset.bound) {
        warningInput.addEventListener('input', () => {
            const updated = loadPtoTracker();
            updated.thresholds = updated.thresholds || { warning: 20, policy: 40 };
            updated.thresholds.warning = Math.min(100, Math.max(0, parseFloat(warningInput.value) || 0));
            warningInput.value = updated.thresholds.warning;
            savePtoTracker(updated);
            renderPtoSummary(updated);
        });
        warningInput.dataset.bound = 'true';
    }

    if (policyInput && !policyInput.dataset.bound) {
        policyInput.addEventListener('input', () => {
            const updated = loadPtoTracker();
            updated.thresholds = updated.thresholds || { warning: 20, policy: 40 };
            updated.thresholds.policy = Math.min(100, Math.max(0, parseFloat(policyInput.value) || 0));
            policyInput.value = updated.thresholds.policy;
            savePtoTracker(updated);
            renderPtoSummary(updated);
        });
        policyInput.dataset.bound = 'true';
    }

    if (addBtn && !addBtn.dataset.bound) {
        addBtn.addEventListener('click', addPtoEntry);
        addBtn.dataset.bound = 'true';
    }

    if (generateBtn && !generateBtn.dataset.bound) {
        generateBtn.addEventListener('click', generatePtoEmail);
        generateBtn.dataset.bound = 'true';
    }

    if (copyBtn && !copyBtn.dataset.bound) {
        copyBtn.addEventListener('click', copyPtoEmail);
        copyBtn.dataset.bound = 'true';
    }
}

function addPtoEntry() {
    const date = document.getElementById('ptoMissedDate')?.value;
    const percentValue = document.getElementById('ptoMissedHours')?.value;
    const reason = document.getElementById('ptoMissedReason')?.value?.trim() || '';

    if (!date || !percentValue) {
        showToast('Enter date and unavailable percentage', 3000);
        return;
    }

    const percent = parseFloat(percentValue);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        showToast('Enter a valid percentage from 0 to 100', 3000);
        return;
    }

    const data = loadPtoTracker();
    data.entries.push({
        id: `${Date.now()}`,
        date,
        hours: percent,
        reason
    });
    savePtoTracker(data);
    renderPtoSummary(data);
    renderPtoEntries(data);

    const dateInput = document.getElementById('ptoMissedDate');
    const hoursInput = document.getElementById('ptoMissedHours');
    const reasonInput = document.getElementById('ptoMissedReason');
    if (dateInput) dateInput.value = '';
    if (hoursInput) hoursInput.value = '';
    if (reasonInput) reasonInput.value = '';
}

function deletePtoEntry(entryId) {
    const data = loadPtoTracker();
    data.entries = data.entries.filter(entry => entry.id !== entryId);
    savePtoTracker(data);
    renderPtoSummary(data);
    renderPtoEntries(data);
}

function renderPtoSummary(data) {
    const summary = document.getElementById('ptoSummary');
    if (!summary) return;

    const totalMissed = data.entries.reduce((sum, entry) => sum + (parseFloat(entry.hours) || 0), 0);
    const remaining = Math.max(0, (parseFloat(data.availableHours) || 0) - totalMissed);
    const warning = data.thresholds?.warning ?? 0;
    const policy = data.thresholds?.policy ?? 0;

    const status = totalMissed >= policy
        ? '🔴 Policy threshold reached'
        : totalMissed >= warning
            ? '🟠 Warning threshold reached'
            : '🟢 Below thresholds';

    summary.innerHTML = `
        <strong>Total Unavailable:</strong> ${totalMissed.toFixed(2)}%<br>
        <strong>Remaining Availability:</strong> ${remaining.toFixed(2)}%<br>
        <strong>Status:</strong> ${status}
    `;
}

function renderPtoEntries(data) {
    const container = document.getElementById('ptoEntries');
    if (!container) return;

    if (!data.entries.length) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">No missed time entries yet.</div>';
        return;
    }

    const rows = data.entries
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map(entry => {
            const reasonText = entry.reason ? ` • ${entry.reason}` : '';
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid #e5f3f0; border-radius: 6px; background: #f9fffd;">
                    <div>
                        <strong>${entry.date}</strong> — ${parseFloat(entry.hours).toFixed(2)}%${reasonText}
                    </div>
                    <button type="button" data-entry-id="${entry.id}" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 6px 10px; cursor: pointer;">Remove</button>
                </div>
            `;
        })
        .join('');

    container.innerHTML = rows;
    container.querySelectorAll('button[data-entry-id]').forEach(btn => {
        btn.addEventListener('click', () => deletePtoEntry(btn.dataset.entryId));
    });
}

function generatePtoEmail() {
    const data = loadPtoTracker();
    const output = document.getElementById('ptoEmailOutput');
    if (!output) return;

    const totalMissed = data.entries.reduce((sum, entry) => sum + (parseFloat(entry.hours) || 0), 0);
    const warning = data.thresholds?.warning ?? 0;
    const policy = data.thresholds?.policy ?? 0;

    let thresholdText = 'Below thresholds';
    if (totalMissed >= policy) thresholdText = `Reached policy threshold (${policy}%)`;
    else if (totalMissed >= warning) thresholdText = `Reached warning threshold (${warning}%)`;

    const entryLines = data.entries
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map(entry => `- ${entry.date}: ${parseFloat(entry.hours).toFixed(2)}%${entry.reason ? ` (${entry.reason})` : ''}`)
        .join('\n');

    output.value = `Hello,\n\n` +
        `This is a time-off/attendance check-in based on recent missed time.\n\n` +
        `Total unavailable: ${totalMissed.toFixed(2)}%\n` +
        `Max availability: ${(parseFloat(data.availableHours) || 0).toFixed(2)}%\n` +
        `Status: ${thresholdText}\n\n` +
        `Missed time details:\n${entryLines || '- No entries recorded'}\n\n` +
        `If any of the missed time should be covered by PTO or needs correction, please let me know.\n\n` +
        `Thank you.`;
}

function copyPtoEmail() {
    const output = document.getElementById('ptoEmailOutput');
    if (!output) return;

    navigator.clipboard.writeText(output.value || '').then(() => {
        showToast('✅ PTO email copied to clipboard', 3000);
    }).catch(() => {
        showToast('Unable to copy PTO email', 3000);
    });
}
