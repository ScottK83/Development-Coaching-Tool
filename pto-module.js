// ============================================
// PTO / TIME-OFF TRACKER (HOURS-BASED, PER ASSOCIATE)
// ============================================

const PTO_POLICY_UNPLANNED_LIMIT_HOURS = 16;
const PTOST_MAX_HOURS_DEFAULT = 40;
const PTO_LEGACY_ASSOCIATE_KEY = '__LEGACY_PTO__';

function getDefaultPtoTracker() {
    return {
        carriedOverHours: 0,
        earnedThisYearHours: 0,
        reliabilityHoursAgainst: 0,
        ptostMaxHours: PTOST_MAX_HOURS_DEFAULT,
        entries: []
    };
}

function getDefaultPtoStore() {
    return {
        selectedAssociate: '',
        associates: {}
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

function normalizeAssociateName(name) {
    return String(name || '').trim();
}

function isTrackerShaped(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    return (
        Array.isArray(data.entries)
        || data.carriedOverHours !== undefined
        || data.earnedThisYearHours !== undefined
        || data.reliabilityHoursAgainst !== undefined
        || data.ptostMaxHours !== undefined
        || data.availableHours !== undefined
    );
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

function migratePtoStore(rawData) {
    const defaults = getDefaultPtoStore();
    const source = rawData && typeof rawData === 'object' ? rawData : {};

    if (isTrackerShaped(source) && !source.associates) {
        const legacyTracker = migrateLegacyPtoTracker(source);
        return {
            selectedAssociate: PTO_LEGACY_ASSOCIATE_KEY,
            associates: {
                [PTO_LEGACY_ASSOCIATE_KEY]: legacyTracker
            }
        };
    }

    const associatesSource = source.associates && typeof source.associates === 'object' && !Array.isArray(source.associates)
        ? source.associates
        : {};

    const associates = {};
    Object.entries(associatesSource).forEach(([associate, tracker]) => {
        const normalizedName = normalizeAssociateName(associate);
        if (!normalizedName) return;
        associates[normalizedName] = migrateLegacyPtoTracker(tracker);
    });

    const selectedAssociate = normalizeAssociateName(source.selectedAssociate);
    const keys = Object.keys(associates);
    const normalizedSelectedAssociate = selectedAssociate && associates[selectedAssociate]
        ? selectedAssociate
        : (keys[0] || '');

    return {
        ...defaults,
        selectedAssociate: normalizedSelectedAssociate,
        associates
    };
}

function loadPtoStore() {
    const loaded = window.DevCoachModules?.storage?.loadPtoTracker?.() || getDefaultPtoStore();
    return migratePtoStore(loaded);
}

function savePtoStore(store) {
    const normalized = migratePtoStore(store);
    const result = window.DevCoachModules?.storage?.savePtoTracker?.(normalized);
    if (typeof window.queueRepoSync === 'function') {
        window.queueRepoSync('pto tracker updated');
    }
    return result;
}

function getWeeklyAssociates() {
    const weeklyData = window.DevCoachModules?.storage?.loadWeeklyData?.() || {};
    const names = new Set();

    Object.values(weeklyData).forEach(week => {
        if (!week || typeof week !== 'object') return;
        const employees = Array.isArray(week.employees) ? week.employees : [];
        employees.forEach(employee => {
            const name = normalizeAssociateName(employee?.name);
            if (name) names.add(name);
        });
    });

    return Array.from(names);
}

function getAssociateOptions(store) {
    const fromWeekly = getWeeklyAssociates();
    const fromPto = Object.keys(store.associates || {});
    const combined = new Set([...fromWeekly, ...fromPto]);
    return Array.from(combined).sort((a, b) => a.localeCompare(b));
}

function ensureAssociateTracker(store, associateName) {
    const normalizedName = normalizeAssociateName(associateName);
    if (!normalizedName) return null;

    if (!store.associates || typeof store.associates !== 'object') {
        store.associates = {};
    }

    if (!store.associates[normalizedName]) {
        store.associates[normalizedName] = getDefaultPtoTracker();
    }

    store.selectedAssociate = normalizedName;
    return store.associates[normalizedName];
}

function getSelectedAssociateAndTracker(createIfMissing = true) {
    const store = loadPtoStore();
    const select = document.getElementById('ptoAssociateSelect');
    const selectedAssociate = normalizeAssociateName(select?.value || store.selectedAssociate);

    if (!selectedAssociate) {
        return {
            store,
            associateName: '',
            tracker: null
        };
    }

    const tracker = createIfMissing
        ? ensureAssociateTracker(store, selectedAssociate)
        : migrateLegacyPtoTracker(store.associates?.[selectedAssociate] || getDefaultPtoTracker());

    return {
        store,
        associateName: selectedAssociate,
        tracker
    };
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

function updatePtoInputsFromTracker(associateName, tracker) {
    const carriedOverInput = document.getElementById('ptoCarriedOverHours');
    const earnedThisYearInput = document.getElementById('ptoEarnedThisYearHours');
    const reliabilityHoursInput = document.getElementById('ptoReliabilityHoursAgainst');
    const summary = document.getElementById('ptoSummary');
    const output = document.getElementById('ptoEmailOutput');
    const addBtn = document.getElementById('ptoAddEntryBtn');
    const generateBtn = document.getElementById('ptoGenerateEmailBtn');
    const copyBtn = document.getElementById('ptoCopyEmailBtn');

    const hasAssociate = !!associateName;
    if (carriedOverInput) {
        carriedOverInput.value = hasAssociate ? normalizeHours(tracker?.carriedOverHours).toFixed(2) : '';
        carriedOverInput.disabled = !hasAssociate;
    }
    if (earnedThisYearInput) {
        earnedThisYearInput.value = hasAssociate ? normalizeHours(tracker?.earnedThisYearHours).toFixed(2) : '';
        earnedThisYearInput.disabled = !hasAssociate;
    }
    if (reliabilityHoursInput) {
        reliabilityHoursInput.value = hasAssociate ? normalizeHours(tracker?.reliabilityHoursAgainst).toFixed(2) : '';
        reliabilityHoursInput.disabled = !hasAssociate;
    }

    [addBtn, generateBtn, copyBtn].forEach(btn => {
        if (btn) btn.disabled = !hasAssociate;
    });

    if (!hasAssociate) {
        if (summary) {
            summary.innerHTML = '<span style="color: #666;">Select an associate to track PTO.</span>';
        }
        renderPtoEntries(getDefaultPtoTracker(), '');
        if (output) output.value = '';
        return;
    }

    renderPtoSummary(tracker, associateName);
    renderPtoEntries(tracker, associateName);
}

function populatePtoAssociateSelect() {
    const select = document.getElementById('ptoAssociateSelect');
    if (!select) return;

    const store = loadPtoStore();
    const associates = getAssociateOptions(store);

    select.innerHTML = '<option value="">-- Choose an associate --</option>';
    associates.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name === PTO_LEGACY_ASSOCIATE_KEY ? 'Legacy PTO Data (migrated)' : name;
        select.appendChild(option);
    });

    select.value = '';

    const latestStore = loadPtoStore();
    latestStore.selectedAssociate = '';
    savePtoStore(latestStore);

    updatePtoInputsFromTracker('', null);
}

function initializePtoTracker() {
    const select = document.getElementById('ptoAssociateSelect');
    const carriedOverInput = document.getElementById('ptoCarriedOverHours');
    const earnedThisYearInput = document.getElementById('ptoEarnedThisYearHours');
    const reliabilityHoursInput = document.getElementById('ptoReliabilityHoursAgainst');
    const addBtn = document.getElementById('ptoAddEntryBtn');
    const generateBtn = document.getElementById('ptoGenerateEmailBtn');
    const copyBtn = document.getElementById('ptoCopyEmailBtn');

    populatePtoAssociateSelect();

    if (select && !select.dataset.bound) {
        select.addEventListener('change', () => {
            const context = getSelectedAssociateAndTracker(true);
            savePtoStore(context.store);
            updatePtoInputsFromTracker(context.associateName, context.tracker || getDefaultPtoTracker());
        });
        select.dataset.bound = 'true';
    }

    if (carriedOverInput && !carriedOverInput.dataset.bound) {
        carriedOverInput.addEventListener('input', () => {
            const context = getSelectedAssociateAndTracker(true);
            if (!context.tracker) return;
            context.tracker.carriedOverHours = normalizeHours(carriedOverInput.value);
            carriedOverInput.value = context.tracker.carriedOverHours.toFixed(2);
            savePtoStore(context.store);
            renderPtoSummary(context.tracker, context.associateName);
        });
        carriedOverInput.dataset.bound = 'true';
    }

    if (earnedThisYearInput && !earnedThisYearInput.dataset.bound) {
        earnedThisYearInput.addEventListener('input', () => {
            const context = getSelectedAssociateAndTracker(true);
            if (!context.tracker) return;
            context.tracker.earnedThisYearHours = normalizeHours(earnedThisYearInput.value);
            earnedThisYearInput.value = context.tracker.earnedThisYearHours.toFixed(2);
            savePtoStore(context.store);
            renderPtoSummary(context.tracker, context.associateName);
        });
        earnedThisYearInput.dataset.bound = 'true';
    }

    if (reliabilityHoursInput && !reliabilityHoursInput.dataset.bound) {
        reliabilityHoursInput.addEventListener('input', () => {
            const context = getSelectedAssociateAndTracker(true);
            if (!context.tracker) return;
            context.tracker.reliabilityHoursAgainst = normalizeHours(reliabilityHoursInput.value);
            reliabilityHoursInput.value = context.tracker.reliabilityHoursAgainst.toFixed(2);
            savePtoStore(context.store);
            renderPtoSummary(context.tracker, context.associateName);
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
    const context = getSelectedAssociateAndTracker(true);
    if (!context.associateName || !context.tracker) {
        showToast('Select an associate first', 3000);
        return;
    }

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

    const data = context.tracker;
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

    savePtoStore(context.store);
    renderPtoSummary(data, context.associateName);
    renderPtoEntries(data, context.associateName);

    const dateInput = document.getElementById('ptoEntryDate');
    const hoursInput = document.getElementById('ptoEntryHours');
    const notesInput = document.getElementById('ptoEntryNotes');
    if (dateInput) dateInput.value = '';
    if (hoursInput) hoursInput.value = '';
    if (notesInput) notesInput.value = '';
}

function deletePtoEntry(entryId) {
    const context = getSelectedAssociateAndTracker(true);
    if (!context.tracker) return;
    context.tracker.entries = context.tracker.entries.filter(entry => entry.id !== entryId);
    savePtoStore(context.store);
    renderPtoSummary(context.tracker, context.associateName);
    renderPtoEntries(context.tracker, context.associateName);
}

function renderPtoSummary(data, associateName = '') {
    const summary = document.getElementById('ptoSummary');
    if (!summary) return;

    const stats = calculatePtoStats(data);
    const policyStatus = stats.attendancePolicyTriggered
        ? `🔴 Attendance policy active (PTO unplanned ${stats.effectiveUnplannedReliabilityHours.toFixed(2)}h > ${PTO_POLICY_UNPLANNED_LIMIT_HOURS}h)`
        : `🟢 Attendance policy not triggered (PTO unplanned ${stats.effectiveUnplannedReliabilityHours.toFixed(2)}h of ${PTO_POLICY_UNPLANNED_LIMIT_HOURS}h)`;

    summary.innerHTML = `
        <strong>Associate:</strong> ${associateName === PTO_LEGACY_ASSOCIATE_KEY ? 'Legacy PTO Data (migrated)' : associateName}<br>
        <strong>PTO Available:</strong> ${stats.totalPtoAvailable.toFixed(2)}h (Carryover ${normalizeHours(data.carriedOverHours).toFixed(2)}h + Earned ${normalizeHours(data.earnedThisYearHours).toFixed(2)}h)<br>
        <strong>PTO Used:</strong> ${stats.totalPtoUsed.toFixed(2)}h (Planned ${stats.totalPtoPlannedUsed.toFixed(2)}h, Unplanned ${stats.totalPtoUnplannedUsed.toFixed(2)}h)<br>
        <strong>PTO Remaining:</strong> ${stats.remainingPtoHours.toFixed(2)}h<br>
        <strong>PTOST:</strong> ${stats.totalPtostUsed.toFixed(2)}h used / ${normalizeHours(data.ptostMaxHours || PTOST_MAX_HOURS_DEFAULT).toFixed(2)}h (${stats.ptostRemainingHours.toFixed(2)}h remaining)<br>
        <strong>Reliability Hours Against:</strong> ${stats.reliabilityFromMetrics.toFixed(2)}h<br>
        <strong>Status:</strong> ${policyStatus}
    `;
}

function renderPtoEntries(data, associateName = '') {
    const container = document.getElementById('ptoEntries');
    if (!container) return;

    if (!data.entries.length) {
        container.innerHTML = `<div style="color: #666; font-size: 0.95em;">${associateName ? 'No time-off entries yet.' : 'Select an associate to view entries.'}</div>`;
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
    const context = getSelectedAssociateAndTracker(true);
    if (!context.associateName || !context.tracker) {
        showToast('Select an associate first', 3000);
        return;
    }

    const data = context.tracker;
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
        `Here is the current PTO/time-off attendance snapshot for ${context.associateName === PTO_LEGACY_ASSOCIATE_KEY ? 'Legacy PTO Data (migrated)' : context.associateName}.\n\n` +
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
