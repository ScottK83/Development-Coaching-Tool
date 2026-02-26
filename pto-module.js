// ============================================
// PTO / TIME-OFF TRACKER (HOURS-BASED)
// ============================================

const PTO_POLICY_UNPLANNED_LIMIT_HOURS = 16;
const PTOST_MAX_HOURS_DEFAULT = 40;

function getDefaultPtoTracker() {
    return {
        carriedOverHours: 0,
        earnedThisYearHours: 0,
        reliabilityHoursAgainst: 0,
        ptostMaxHours: PTOST_MAX_HOURS_DEFAULT,
        entries: []
    };
}

function normalizeHours(value) {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.round(parsed * 100) / 100;
}

function normalizePtoType(type) {
    const value = String(type || '').trim().toLowerCase();
    if (value === 'ptost' || value === 'pto-planned' || value === 'pto-unplanned') return value;
    return 'pto-unplanned';
}

function migrateLegacyPtoTracker(rawData) {
    const defaults = getDefaultPtoTracker();
    const source = rawData && typeof rawData === 'object' ? rawData : {};

    const migrated = {
        carriedOverHours: normalizeHours(source.carriedOverHours),
        earnedThisYearHours: normalizeHours(source.earnedThisYearHours),
        reliabilityHoursAgainst: normalizeHours(source.reliabilityHoursAgainst),
        ptostMaxHours: normalizeHours(source.ptostMaxHours || PTOST_MAX_HOURS_DEFAULT),
        entries: []
    };

    // Legacy field mapping
    if (!migrated.carriedOverHours && source.availableHours !== undefined) {
        migrated.earnedThisYearHours = normalizeHours(source.availableHours);
    }

    const rawEntries = Array.isArray(source.entries) ? source.entries : [];
    migrated.entries = rawEntries.map((entry, index) => {
        const legacyReason = String(entry?.reason || '').toLowerCase();
        const inferredType = entry?.type
            ? normalizePtoType(entry.type)
            : (legacyReason.includes('planned') ? 'pto-planned'
                : legacyReason.includes('ptost') ? 'ptost'
                    : 'pto-unplanned');

        return {
            id: String(entry?.id || `${Date.now()}-${index}`),
            date: String(entry?.date || ''),
            hours: normalizeHours(entry?.hours),
            type: inferredType,
            notes: String(entry?.notes || entry?.reason || '').trim()
        };
    }).filter(entry => entry.date && entry.hours > 0);

    return {
        ...defaults,
        ...migrated
    };
}

function loadPtoTracker() {
    const loaded = window.DevCoachModules?.storage?.loadPtoTracker?.() || getDefaultPtoTracker();
    return migrateLegacyPtoTracker(loaded);
}

function savePtoTracker(data) {
    const normalized = migrateLegacyPtoTracker(data);
    return window.DevCoachModules?.storage?.savePtoTracker?.(normalized);
}

function calculatePtoStats(data) {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const totalPtostUsed = entries
        .filter(entry => entry.type === 'ptost')
        .reduce((sum, entry) => sum + normalizeHours(entry.hours), 0);
    const totalPtoPlannedUsed = entries
        .filter(entry => entry.type === 'pto-planned')
        .reduce((sum, entry) => sum + normalizeHours(entry.hours), 0);
    const totalPtoUnplannedUsed = entries
        .filter(entry => entry.type === 'pto-unplanned')
        .reduce((sum, entry) => sum + normalizeHours(entry.hours), 0);

    const totalPtoAvailable = normalizeHours(data.carriedOverHours) + normalizeHours(data.earnedThisYearHours);
    const totalPtoUsed = totalPtoPlannedUsed + totalPtoUnplannedUsed;
    const remainingPtoHours = Math.max(0, totalPtoAvailable - totalPtoUsed);
    const ptostRemainingHours = Math.max(0, normalizeHours(data.ptostMaxHours || PTOST_MAX_HOURS_DEFAULT) - totalPtostUsed);

    const reliabilityFromMetrics = normalizeHours(data.reliabilityHoursAgainst);
    const effectiveUnplannedReliabilityHours = Math.max(totalPtoUnplannedUsed, reliabilityFromMetrics);
    const attendancePolicyTriggered = effectiveUnplannedReliabilityHours > PTO_POLICY_UNPLANNED_LIMIT_HOURS;

    return {
        totalPtostUsed,
        totalPtoPlannedUsed,
        totalPtoUnplannedUsed,
        totalPtoAvailable,
        totalPtoUsed,
        remainingPtoHours,
        ptostRemainingHours,
        reliabilityFromMetrics,
        effectiveUnplannedReliabilityHours,
        attendancePolicyTriggered
    };
}

function initializePtoTracker() {
    const data = loadPtoTracker();
    const carriedOverInput = document.getElementById('ptoCarriedOverHours');
    const earnedThisYearInput = document.getElementById('ptoEarnedThisYearHours');
    const reliabilityHoursInput = document.getElementById('ptoReliabilityHoursAgainst');
    const addBtn = document.getElementById('ptoAddEntryBtn');
    const generateBtn = document.getElementById('ptoGenerateEmailBtn');
    const copyBtn = document.getElementById('ptoCopyEmailBtn');

    if (carriedOverInput) carriedOverInput.value = normalizeHours(data.carriedOverHours);
    if (earnedThisYearInput) earnedThisYearInput.value = normalizeHours(data.earnedThisYearHours);
    if (reliabilityHoursInput) reliabilityHoursInput.value = normalizeHours(data.reliabilityHoursAgainst);

    renderPtoSummary(data);
    renderPtoEntries(data);

    if (carriedOverInput && !carriedOverInput.dataset.bound) {
        carriedOverInput.addEventListener('input', () => {
            const updated = loadPtoTracker();
            updated.carriedOverHours = normalizeHours(carriedOverInput.value);
            carriedOverInput.value = updated.carriedOverHours;
            savePtoTracker(updated);
            renderPtoSummary(updated);
        });
        carriedOverInput.dataset.bound = 'true';
    }

    if (earnedThisYearInput && !earnedThisYearInput.dataset.bound) {
        earnedThisYearInput.addEventListener('input', () => {
            const updated = loadPtoTracker();
            updated.earnedThisYearHours = normalizeHours(earnedThisYearInput.value);
            earnedThisYearInput.value = updated.earnedThisYearHours;
            savePtoTracker(updated);
            renderPtoSummary(updated);
        });
        earnedThisYearInput.dataset.bound = 'true';
    }

    if (reliabilityHoursInput && !reliabilityHoursInput.dataset.bound) {
        reliabilityHoursInput.addEventListener('input', () => {
            const updated = loadPtoTracker();
            updated.reliabilityHoursAgainst = normalizeHours(reliabilityHoursInput.value);
            reliabilityHoursInput.value = updated.reliabilityHoursAgainst;
            savePtoTracker(updated);
            renderPtoSummary(updated);
        });
        reliabilityHoursInput.dataset.bound = 'true';
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
    const date = document.getElementById('ptoEntryDate')?.value;
    const hoursValue = document.getElementById('ptoEntryHours')?.value;
    const type = normalizePtoType(document.getElementById('ptoEntryType')?.value || 'ptost');
    const notes = document.getElementById('ptoEntryNotes')?.value?.trim() || '';

    if (!date || !hoursValue) {
        showToast('Enter date and hours missed', 3000);
        return;
    }

    const hours = normalizeHours(hoursValue);
    if (!Number.isFinite(hours) || hours <= 0) {
        showToast('Enter valid hours greater than 0', 3000);
        return;
    }

    const data = loadPtoTracker();
    const stats = calculatePtoStats(data);

    const pushEntry = (entryType, entryHours, entryNotes = '') => {
        data.entries.push({
            id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            date,
            hours: normalizeHours(entryHours),
            type: normalizePtoType(entryType),
            notes: entryNotes
        });
    };

    if (type === 'ptost') {
        const ptostRemaining = Math.max(0, normalizeHours(data.ptostMaxHours || PTOST_MAX_HOURS_DEFAULT) - stats.totalPtostUsed);
        if (ptostRemaining <= 0) {
            pushEntry('pto-unplanned', hours, notes ? `${notes} (auto-converted from PTOST: exhausted)` : 'auto-converted from PTOST: exhausted');
            showToast('PTOST exhausted. Entry saved as PTO unplanned.', 4000);
        } else if (hours > ptostRemaining) {
            pushEntry('ptost', ptostRemaining, notes);
            pushEntry('pto-unplanned', hours - ptostRemaining, notes ? `${notes} (overflow after PTOST exhausted)` : 'overflow after PTOST exhausted');
            showToast('Entry split: remaining PTOST used, overflow saved as PTO unplanned.', 4500);
        } else {
            pushEntry('ptost', hours, notes);
        }
    } else {
        pushEntry(type, hours, notes);
    }

    savePtoTracker(data);
    renderPtoSummary(data);
    renderPtoEntries(data);

    const dateInput = document.getElementById('ptoEntryDate');
    const hoursInput = document.getElementById('ptoEntryHours');
    const notesInput = document.getElementById('ptoEntryNotes');
    if (dateInput) dateInput.value = '';
    if (hoursInput) hoursInput.value = '';
    if (notesInput) notesInput.value = '';
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

    const stats = calculatePtoStats(data);
    const policyStatus = stats.attendancePolicyTriggered
        ? `🔴 Attendance policy active (PTO unplanned ${stats.effectiveUnplannedReliabilityHours.toFixed(2)}h > ${PTO_POLICY_UNPLANNED_LIMIT_HOURS}h)`
        : `🟢 Attendance policy not triggered (PTO unplanned ${stats.effectiveUnplannedReliabilityHours.toFixed(2)}h of ${PTO_POLICY_UNPLANNED_LIMIT_HOURS}h)`;

    summary.innerHTML = `
        <strong>PTO Available:</strong> ${stats.totalPtoAvailable.toFixed(2)}h (Carryover ${normalizeHours(data.carriedOverHours).toFixed(2)}h + Earned ${normalizeHours(data.earnedThisYearHours).toFixed(2)}h)<br>
        <strong>PTO Used:</strong> ${stats.totalPtoUsed.toFixed(2)}h (Planned ${stats.totalPtoPlannedUsed.toFixed(2)}h, Unplanned ${stats.totalPtoUnplannedUsed.toFixed(2)}h)<br>
        <strong>PTO Remaining:</strong> ${stats.remainingPtoHours.toFixed(2)}h<br>
        <strong>PTOST:</strong> ${stats.totalPtostUsed.toFixed(2)}h used / ${normalizeHours(data.ptostMaxHours || PTOST_MAX_HOURS_DEFAULT).toFixed(2)}h (${stats.ptostRemainingHours.toFixed(2)}h remaining)<br>
        <strong>Reliability Hours Against:</strong> ${stats.reliabilityFromMetrics.toFixed(2)}h<br>
        <strong>Status:</strong> ${policyStatus}
    `;
}

function renderPtoEntries(data) {
    const container = document.getElementById('ptoEntries');
    if (!container) return;

    if (!data.entries.length) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">No time-off entries yet.</div>';
        return;
    }

    const typeLabel = (type) => {
        if (type === 'ptost') return 'PTOST';
        if (type === 'pto-planned') return 'PTO Planned';
        return 'PTO Unplanned';
    };

    const rows = data.entries
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map(entry => {
            const noteText = entry.notes ? ` • ${entry.notes}` : '';
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid #e5f3f0; border-radius: 6px; background: #f9fffd;">
                    <div>
                        <strong>${entry.date}</strong> — ${normalizeHours(entry.hours).toFixed(2)}h • <strong>${typeLabel(entry.type)}</strong>${noteText}
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

    const stats = calculatePtoStats(data);
    const policyLine = stats.attendancePolicyTriggered
        ? `Attendance policy status: ACTIVE (PTO unplanned ${stats.effectiveUnplannedReliabilityHours.toFixed(2)}h > ${PTO_POLICY_UNPLANNED_LIMIT_HOURS}h)`
        : `Attendance policy status: Not active (PTO unplanned ${stats.effectiveUnplannedReliabilityHours.toFixed(2)}h of ${PTO_POLICY_UNPLANNED_LIMIT_HOURS}h)`;

    const typeLabel = (type) => {
        if (type === 'ptost') return 'PTOST';
        if (type === 'pto-planned') return 'PTO Planned';
        return 'PTO Unplanned';
    };

    const entryLines = data.entries
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map(entry => `- ${entry.date}: ${normalizeHours(entry.hours).toFixed(2)}h (${typeLabel(entry.type)})${entry.notes ? ` - ${entry.notes}` : ''}`)
        .join('\n');

    output.value = `Hello,\n\n` +
        `Here is the current PTO/time-off attendance snapshot.\n\n` +
        `Carryover hours: ${normalizeHours(data.carriedOverHours).toFixed(2)}h\n` +
        `Earned this year: ${normalizeHours(data.earnedThisYearHours).toFixed(2)}h\n` +
        `Total PTO available: ${stats.totalPtoAvailable.toFixed(2)}h\n` +
        `PTO planned used: ${stats.totalPtoPlannedUsed.toFixed(2)}h\n` +
        `PTO unplanned used: ${stats.totalPtoUnplannedUsed.toFixed(2)}h\n` +
        `PTO remaining: ${stats.remainingPtoHours.toFixed(2)}h\n` +
        `PTOST used: ${stats.totalPtostUsed.toFixed(2)}h of ${normalizeHours(data.ptostMaxHours || PTOST_MAX_HOURS_DEFAULT).toFixed(2)}h\n` +
        `Reliability hours against: ${stats.reliabilityFromMetrics.toFixed(2)}h\n` +
        `${policyLine}\n\n` +
        `Time-off entries:\n${entryLines || '- No entries recorded'}\n\n` +
        `Please review and let me know if any entries should be adjusted.\n\n` +
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
