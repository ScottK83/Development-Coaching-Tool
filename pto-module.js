// ============================================
// PTO / TIME-OFF TRACKER (HOURS-BASED, PER ASSOCIATE)
// ============================================

const PTO_POLICY_UNPLANNED_LIMIT_HOURS = 16;
const PTOST_MAX_HOURS_DEFAULT = 40;
const PTO_WEEK_DEFAULT_HOURS = 8;
const PTO_TRACKING_YEAR = 2026;
const PTO_LEGACY_ASSOCIATE_KEY = '__LEGACY_PTO__';
let ptoReliabilityWeekCache = [];

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

function getYearFromIsoDateText(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-\d{2}-\d{2}$/);
    return match ? parseInt(match[1], 10) : null;
}

function isEntryInTrackingYear(entry) {
    const year = getYearFromIsoDateText(entry?.date);
    return year === PTO_TRACKING_YEAR;
}

function getTrackedEntries(data) {
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    return entries.filter(isEntryInTrackingYear);
}

function isPeriodInTrackingYear(startDateText, endDateText, periodKey = '') {
    const startYear = getYearFromIsoDateText(startDateText);
    const endYear = getYearFromIsoDateText(endDateText);
    if (startYear === PTO_TRACKING_YEAR || endYear === PTO_TRACKING_YEAR) return true;

    const firstDateInKey = String(periodKey || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
    const keyYear = getYearFromIsoDateText(firstDateInKey);
    return keyYear === PTO_TRACKING_YEAR;
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

    Object.entries(weeklyData).forEach(([weekKey, week]) => {
        if (!week || typeof week !== 'object') return;
        const startDate = String(week?.metadata?.startDate || '').trim();
        const endDate = String(week?.metadata?.endDate || '').trim();
        if (!isPeriodInTrackingYear(startDate, endDate, weekKey)) return;

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
    const entries = getTrackedEntries(data);
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

function getAccountedEntryHours(data) {
    const entries = getTrackedEntries(data);
    return entries.reduce((sum, entry) => sum + normalizeHours(entry?.hours), 0);
}

function getUnaccountedReliabilityHours(data) {
    const reliabilityHoursAgainst = normalizeHours(data?.reliabilityHoursAgainst);
    const accountedHours = getAccountedEntryHours(data);
    return Math.max(0, normalizeHours(reliabilityHoursAgainst - accountedHours));
}

function refreshPtoAssociateOptionFlags() {
    const select = document.getElementById('ptoAssociateSelect');
    if (!select) return;

    const store = loadPtoStore();
    Array.from(select.options).forEach(option => {
        const associateName = normalizeAssociateName(option?.value);
        if (!associateName) return;

        const tracker = migrateLegacyPtoTracker(store.associates?.[associateName] || getDefaultPtoTracker());
        syncTrackerReliabilityFromYtd(associateName, tracker);
        const unaccountedHours = getUnaccountedReliabilityHours(tracker);
        const baseLabel = associateName === PTO_LEGACY_ASSOCIATE_KEY ? 'Legacy PTO Data (migrated)' : associateName;

        if (unaccountedHours > 0) {
            option.textContent = `${baseLabel} (${unaccountedHours.toFixed(2)}h unaccounted)`;
            option.style.color = '#0d6efd';
            option.style.fontWeight = '700';
        } else {
            option.textContent = baseLabel;
            option.style.color = '';
            option.style.fontWeight = '';
        }
    });
}

function parseIsoDateSafe(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function formatIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getWeekStartEndFromPeriod(weekKey, period) {
    const metadata = period?.metadata && typeof period.metadata === 'object' ? period.metadata : {};
    const startFromMetadata = String(metadata.startDate || '').trim();
    const endFromMetadata = String(metadata.endDate || '').trim();

    const keyMatches = String(weekKey || '').match(/\d{4}-\d{2}-\d{2}/g) || [];
    const keyDates = keyMatches
        .map(text => ({ text, date: parseIsoDateSafe(text) }))
        .filter(item => item.date)
        .sort((a, b) => a.date - b.date)
        .map(item => item.text);

    const startDate = startFromMetadata || keyDates[0] || '';
    let endDate = endFromMetadata || keyDates[keyDates.length - 1] || '';

    const parsedStart = parseIsoDateSafe(startDate);
    const parsedEnd = parseIsoDateSafe(endDate);
    if (parsedStart && !parsedEnd) {
        const fallbackEnd = new Date(parsedStart);
        fallbackEnd.setDate(fallbackEnd.getDate() + 6);
        endDate = formatIsoDate(fallbackEnd);
    }

    return {
        startDate,
        endDate
    };
}

function getWeekDates(startDateText, endDateText) {
    const startDate = parseIsoDateSafe(startDateText);
    const endDate = parseIsoDateSafe(endDateText);
    if (!startDate || !endDate) return [];
    if (endDate < startDate) return [];

    const dates = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate && dates.length < 14) {
        dates.push(formatIsoDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
}

function getLatestYtdReliabilityHoursForAssociate(associateName) {
    const snapshot = getLatestYtdReliabilitySnapshotForAssociate(associateName);
    if (!snapshot?.hasYtdPeriod) return null;
    return normalizeHours(snapshot.reliabilityHours);
}

function getLatestYtdReliabilitySnapshotForAssociate(associateName) {
    const normalizedAssociate = normalizeAssociateName(associateName);
    if (!normalizedAssociate) {
        return {
            hasYtdPeriod: false,
            associatePresent: false,
            reliabilityHours: null,
            periodKey: '',
            startDate: '',
            endDate: ''
        };
    }

    const ytdData = window.DevCoachModules?.storage?.loadYtdData?.() || {};
    const periods = [];

    Object.entries(ytdData).forEach(([periodKey, period]) => {
        if (!period || typeof period !== 'object') return;

        const startDate = String(period?.metadata?.startDate || '').trim();
        const periodEndDate = String(period?.metadata?.endDate || '').trim();
        if (!isPeriodInTrackingYear(startDate, periodEndDate, periodKey)) return;

        const startEnd = getWeekStartEndFromPeriod(periodKey, period);
        const endDateObj = parseIsoDateSafe(startEnd.endDate) || parseIsoDateSafe(startEnd.startDate);

        periods.push({
            period,
            periodKey: String(periodKey || ''),
            startDate: startEnd.startDate,
            endDate: startEnd.endDate,
            endDateObj
        });
    });

    if (!periods.length) {
        return {
            hasYtdPeriod: false,
            associatePresent: false,
            reliabilityHours: null,
            periodKey: '',
            startDate: '',
            endDate: ''
        };
    }

    periods.sort((a, b) => {
        const left = a.endDateObj ? a.endDateObj.getTime() : 0;
        const right = b.endDateObj ? b.endDateObj.getTime() : 0;
        if (left !== right) return right - left;
        return String(b.periodKey).localeCompare(String(a.periodKey));
    });

    const latest = periods[0];
    const employees = Array.isArray(latest?.period?.employees) ? latest.period.employees : [];
    const employee = employees.find(item => normalizeAssociateName(item?.name) === normalizedAssociate);
    const reliabilityHours = employee ? normalizeHours(employee?.reliability) : 0;

    return {
        hasYtdPeriod: true,
        associatePresent: !!employee,
        reliabilityHours,
        periodKey: latest.periodKey,
        startDate: latest.startDate,
        endDate: latest.endDate
    };
}

function getLatestReliabilitySourceMetaForAssociate(associateName) {
    const snapshot = getLatestYtdReliabilitySnapshotForAssociate(associateName);
    if (!snapshot?.hasYtdPeriod) return null;

    return {
        sourceType: 'ytd',
        periodKey: snapshot.periodKey,
        reliability: normalizeHours(snapshot.reliabilityHours),
        startDate: snapshot.startDate,
        endDate: snapshot.endDate,
        associatePresent: !!snapshot.associatePresent
    };
}

function buildReliabilityWeeksForAssociate(associateName) {
    const normalizedAssociate = normalizeAssociateName(associateName);
    if (!normalizedAssociate) return [];

    const weeklyData = window.DevCoachModules?.storage?.loadWeeklyData?.() || {};
    const weeks = [];

    Object.entries(weeklyData).forEach(([weekKey, period]) => {
        if (!period || typeof period !== 'object') return;

        const startDate = String(period?.metadata?.startDate || '').trim();
        const endDate = String(period?.metadata?.endDate || '').trim();
        if (!isPeriodInTrackingYear(startDate, endDate, weekKey)) return;

        const periodType = String(period?.metadata?.periodType || '').trim().toLowerCase();
        if (periodType && periodType !== 'week') return;

        const employees = Array.isArray(period.employees) ? period.employees : [];
        const employee = employees.find(item => normalizeAssociateName(item?.name) === normalizedAssociate);
        if (!employee) return;

        const reliabilityHours = normalizeHours(employee.reliability);
        if (reliabilityHours <= 0) return;

        const startEnd = getWeekStartEndFromPeriod(weekKey, period);
        const weekDates = getWeekDates(startEnd.startDate, startEnd.endDate);
        if (!weekDates.length) return;

        weeks.push({
            weekKey,
            startDate: startEnd.startDate,
            endDate: startEnd.endDate,
            reliabilityHours,
            weekDates
        });
    });

    weeks.sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));
    return weeks;
}

function renderPtoSyncHealthBadge() {
    const badge = document.getElementById('ptoSyncHealthBadge');
    if (!badge) return;

    const config = typeof window.loadCallListeningSyncConfig === 'function'
        ? window.loadCallListeningSyncConfig()
        : null;

    let lastSuccess = null;
    try {
        const raw = localStorage.getItem('devCoachingTool_repoSyncLastSuccess');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.timestamp) lastSuccess = new Date(parsed.timestamp);
        }
    } catch (error) {
        lastSuccess = null;
    }

    const hasEndpoint = !!String(config?.endpoint || '').trim();
    const autoSync = config?.autoSyncEnabled !== false;
    if (!hasEndpoint) {
        badge.textContent = 'Sync: Not configured';
        badge.style.background = '#fff3cd';
        badge.style.color = '#7a4f00';
        return;
    }

    if (!autoSync) {
        badge.textContent = 'Sync: Configured (manual mode)';
        badge.style.background = '#fff3cd';
        badge.style.color = '#7a4f00';
        return;
    }

    if (lastSuccess) {
        badge.textContent = `Sync: Connected • ${lastSuccess.toLocaleString()}`;
        badge.style.background = '#e8f5e9';
        badge.style.color = '#1b5e20';
        return;
    }

    badge.textContent = 'Sync: Connected (no success recorded yet)';
    badge.style.background = '#e3f2fd';
    badge.style.color = '#0d47a1';
}

function renderPtoReliabilitySourceNote(associateName) {
    const note = document.getElementById('ptoReliabilityDataSource');
    if (!note) return;

    if (!associateName) {
        note.textContent = '';
        return;
    }

    const source = getLatestReliabilitySourceMetaForAssociate(associateName);
    if (!source) {
        note.textContent = `No ${PTO_TRACKING_YEAR} YTD reliability source found yet.`;
        return;
    }

    const sourceTypeLabel = String(source.sourceType || '').toUpperCase();
    const rangeText = source.startDate && source.endDate ? `${source.startDate} to ${source.endDate}` : source.periodKey;
    if (!source.associatePresent) {
        note.textContent = `Reliability source (${PTO_TRACKING_YEAR}): ${sourceTypeLabel} • ${rangeText} • associate not present in latest YTD upload, using 0.00h`;
        return;
    }

    note.textContent = `Reliability source (${PTO_TRACKING_YEAR}): ${sourceTypeLabel} • ${rangeText} • ${source.reliability.toFixed(2)}h`;
}

function getSelectedReliabilityWeek() {
    const select = document.getElementById('ptoReliabilityWeekSelect');
    const index = parseInt(select?.value || '', 10);
    if (!Number.isInteger(index) || index < 0) return null;
    return ptoReliabilityWeekCache[index] || null;
}

function autoSplitSelectedReliabilityWeek() {
    const week = getSelectedReliabilityWeek();
    if (!week) {
        showToast('Select a week first', 3000);
        return;
    }

    const checkboxes = Array.from(document.querySelectorAll('.pto-week-day-checkbox'));
    if (!checkboxes.length) {
        showToast('Select a week to load days first', 3000);
        return;
    }

    let selected = checkboxes.filter(box => box.checked);
    if (!selected.length) {
        checkboxes.forEach(box => { box.checked = true; });
        selected = checkboxes;
    }

    const perDay = normalizeHours(week.reliabilityHours / selected.length);
    const input = document.getElementById('ptoWeekHoursPerDay');
    if (input) input.value = perDay.toFixed(2);
    const statusEl = document.getElementById('ptoReliabilitySelectionStatus');
    if (statusEl) {
        statusEl.textContent = `${selected.length} day${selected.length === 1 ? '' : 's'} selected • Auto-split ${week.reliabilityHours.toFixed(2)}h = ${perDay.toFixed(2)}h/day`;
    }
}

function confirmReliabilityOverAllocationIfNeeded(tracker, addedHours) {
    const reliabilityHours = normalizeHours(tracker?.reliabilityHoursAgainst);
    if (reliabilityHours <= 0) return true;

    const accounted = getAccountedEntryHours(tracker);
    const projected = normalizeHours(accounted + normalizeHours(addedHours));
    if (projected <= reliabilityHours) return true;

    const overBy = normalizeHours(projected - reliabilityHours);
    return window.confirm(`Selected hours exceed reliability by ${overBy.toFixed(2)}h for ${PTO_TRACKING_YEAR}. Continue anyway?`);
}

function appendEntryWithTypePolicy(data, date, hours, type, notes = '', showPolicyToasts = true) {
    const normalizedType = normalizePtoType(type);
    const normalizedHours = normalizeHours(hours);
    if (!date || normalizedHours <= 0) return;

    const pushEntry = (entryType, entryHours, entryNotes = '') => {
        data.entries.push({
            id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            date,
            hours: normalizeHours(entryHours),
            type: normalizePtoType(entryType),
            notes: String(entryNotes || '').trim()
        });
    };

    if (normalizedType !== 'ptost') {
        pushEntry(normalizedType, normalizedHours, notes);
        return;
    }

    const stats = calculatePtoStats(data);
    const ptostRemaining = Math.max(0, normalizeHours(data.ptostMaxHours || PTOST_MAX_HOURS_DEFAULT) - stats.totalPtostUsed);
    if (ptostRemaining <= 0) {
        pushEntry('pto-unplanned', normalizedHours, notes ? `${notes} (auto-converted from PTOST: exhausted)` : 'auto-converted from PTOST: exhausted');
        if (showPolicyToasts) showToast('PTOST exhausted. Entry saved as PTO unplanned.', 4000);
        return;
    }

    if (normalizedHours > ptostRemaining) {
        pushEntry('ptost', ptostRemaining, notes);
        pushEntry('pto-unplanned', normalizedHours - ptostRemaining, notes ? `${notes} (overflow after PTOST exhausted)` : 'overflow after PTOST exhausted');
        if (showPolicyToasts) showToast('Entry split: remaining PTOST used, overflow saved as PTO unplanned.', 4500);
        return;
    }

    pushEntry('ptost', normalizedHours, notes);
}

function renderReliabilityWeekDays(dates) {
    const container = document.getElementById('ptoReliabilityWeekDays');
    if (!container) return;

    const status = document.getElementById('ptoReliabilitySelectionStatus');
    const updateStatus = () => {
        if (!status) return;
        const selected = container.querySelectorAll('.pto-week-day-checkbox:checked').length;
        status.textContent = selected > 0
            ? `${selected} day${selected === 1 ? '' : 's'} selected`
            : 'No days selected yet';
    };

    if (!Array.isArray(dates) || !dates.length) {
        container.innerHTML = '<div style="color: #666; font-size: 0.9em; padding: 8px 2px;">Select a week to choose missed day(s).</div>';
        if (status) status.textContent = '';
        return;
    }

    const dayLabel = (dateText) => {
        const parsed = parseIsoDateSafe(dateText);
        if (!parsed) return '';
        return parsed.toLocaleDateString('en-US', { weekday: 'short' });
    };

    const chips = dates.map(date => {
        return `
            <label style="display: inline-flex; align-items: center; gap: 8px; padding: 7px 12px; border: 1px solid #cfe9e4; border-radius: 16px; background: #f9fffd; cursor: pointer;">
                <input type="checkbox" class="pto-week-day-checkbox" value="${date}" style="margin: 0;">
                <span style="font-weight: 600; color: #345;">${date}</span>
                <span style="font-size: 0.82em; color: #577;">${dayLabel(date)}</span>
            </label>
        `;
    }).join('');

    container.innerHTML = `<div style="display: flex; gap: 8px; flex-wrap: wrap;">${chips}</div>`;
    container.querySelectorAll('.pto-week-day-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', updateStatus);
    });
    updateStatus();
}

function populateReliabilityWeekSelector(associateName) {
    const select = document.getElementById('ptoReliabilityWeekSelect');
    const hint = document.getElementById('ptoReliabilityWeekHint');
    if (!select || !hint) return;

    ptoReliabilityWeekCache = buildReliabilityWeeksForAssociate(associateName);
    select.innerHTML = '<option value="">-- Choose a week with reliability hours --</option>';

    ptoReliabilityWeekCache.forEach((week, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${week.startDate} to ${week.endDate} • Reliability ${week.reliabilityHours.toFixed(2)}h`;
        select.appendChild(option);
    });

    if (!ptoReliabilityWeekCache.length) {
        hint.textContent = 'No weekly reliability hours found for this associate yet.';
    } else {
        hint.textContent = `Found ${ptoReliabilityWeekCache.length} week(s) with reliability hours. Choose a week and assign day(s).`;
    }

    renderReliabilityWeekDays([]);
}

function applySelectedWeekDaysAsEntries() {
    const context = getSelectedAssociateAndTracker(true);
    if (!context.associateName || !context.tracker) {
        showToast('Select an associate first', 3000);
        return;
    }

    const selectedDates = Array.from(document.querySelectorAll('.pto-week-day-checkbox:checked')).map(item => item.value);
    if (!selectedDates.length) {
        showToast('Select at least one day for the chosen week', 3000);
        return;
    }

    const hoursPerDayInput = document.getElementById('ptoWeekHoursPerDay');
    const entryType = normalizePtoType(document.getElementById('ptoWeekEntryType')?.value || 'ptost');
    const notes = String(document.getElementById('ptoWeekEntryNotes')?.value || '').trim();
    const hoursPerDay = normalizeHours(hoursPerDayInput?.value || PTO_WEEK_DEFAULT_HOURS);
    if (hoursPerDay <= 0) {
        showToast('Enter valid hours per selected day', 3000);
        return;
    }

    selectedDates.forEach(date => {
        appendEntryWithTypePolicy(context.tracker, date, hoursPerDay, entryType, notes, false);
    });

    savePtoStore(context.store);
    refreshPtoAssociateOptionFlags();
    renderPtoSummary(context.tracker, context.associateName);
    renderPtoEntries(context.tracker, context.associateName);
    showToast(`Added ${selectedDates.length} day entr${selectedDates.length === 1 ? 'y' : 'ies'}.`, 3500);
}

function reclassifyPtoEntryType(entryId, newType) {
    const context = getSelectedAssociateAndTracker(true);
    if (!context.tracker) return;

    const idx = context.tracker.entries.findIndex(entry => entry.id === entryId);
    if (idx < 0) return;

    const entry = context.tracker.entries[idx];
    const normalizedType = normalizePtoType(newType);
    if (entry.type === normalizedType) return;

    if (normalizedType !== 'ptost') {
        entry.type = normalizedType;
    } else {
        const existing = context.tracker.entries.splice(idx, 1)[0];
        appendEntryWithTypePolicy(context.tracker, existing.date, existing.hours, 'ptost', existing.notes, true);
    }

    savePtoStore(context.store);
    refreshPtoAssociateOptionFlags();
    renderPtoSummary(context.tracker, context.associateName);
    renderPtoEntries(context.tracker, context.associateName);
}

function syncTrackerReliabilityFromYtd(associateName, tracker) {
    if (!tracker || typeof tracker !== 'object') return false;

    const snapshot = getLatestYtdReliabilitySnapshotForAssociate(associateName);
    if (!snapshot?.hasYtdPeriod) return false;

    tracker.reliabilityHoursAgainst = normalizeHours(snapshot.reliabilityHours);
    return true;
}

function updatePtoInputsFromTracker(associateName, tracker) {
    const detailsContainer = document.getElementById('ptoDetailsContainer');
    const carriedOverInput = document.getElementById('ptoCarriedOverHours');
    const earnedThisYearInput = document.getElementById('ptoEarnedThisYearHours');
    const reliabilityHoursInput = document.getElementById('ptoReliabilityHoursAgainst');
    const summary = document.getElementById('ptoSummary');
    const output = document.getElementById('ptoEmailOutput');
    const addBtn = document.getElementById('ptoAddEntryBtn');
    const generateBtn = document.getElementById('ptoGenerateEmailBtn');
    const copyBtn = document.getElementById('ptoCopyEmailBtn');

    const hasAssociate = !!associateName;
    const ytdSnapshot = hasAssociate ? getLatestYtdReliabilitySnapshotForAssociate(associateName) : null;
    if (hasAssociate && tracker && ytdSnapshot?.hasYtdPeriod) {
        tracker.reliabilityHoursAgainst = normalizeHours(ytdSnapshot.reliabilityHours);
    }

    if (detailsContainer) {
        detailsContainer.style.display = hasAssociate ? 'block' : 'none';
    }

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
        reliabilityHoursInput.disabled = !hasAssociate || !!ytdSnapshot?.hasYtdPeriod;
        reliabilityHoursInput.title = ytdSnapshot?.hasYtdPeriod
            ? 'Reliability is auto-synced from the latest YTD upload and cannot be edited here.'
            : '';
    }

    [addBtn, generateBtn, copyBtn].forEach(btn => {
        if (btn) btn.disabled = !hasAssociate;
    });

    if (!hasAssociate) {
        if (summary) {
            summary.innerHTML = '<span style="color: #666;">Select an associate to track PTO.</span>';
        }
        renderPtoEntries(getDefaultPtoTracker(), '');
        populateReliabilityWeekSelector('');
        renderPtoReliabilitySourceNote('');
        if (output) output.value = '';
        return;
    }

    renderPtoReliabilitySourceNote(associateName);
    populateReliabilityWeekSelector(associateName);
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

    refreshPtoAssociateOptionFlags();
    updatePtoInputsFromTracker('', null);
}

function initializePtoTracker() {
    const select = document.getElementById('ptoAssociateSelect');
    const reliabilityWeekSelect = document.getElementById('ptoReliabilityWeekSelect');
    const addWeekDaysBtn = document.getElementById('ptoAddWeekDaysBtn');
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
            if (context.associateName && context.tracker) {
                syncTrackerReliabilityFromYtd(context.associateName, context.tracker);
            }
            savePtoStore(context.store);
            refreshPtoAssociateOptionFlags();
            updatePtoInputsFromTracker(context.associateName, context.tracker || getDefaultPtoTracker());
        });
        select.dataset.bound = 'true';
    }

    if (reliabilityWeekSelect && !reliabilityWeekSelect.dataset.bound) {
        reliabilityWeekSelect.addEventListener('change', () => {
            const index = parseInt(reliabilityWeekSelect.value, 10);
            const selectedWeek = Number.isInteger(index) && index >= 0 ? ptoReliabilityWeekCache[index] : null;
            renderReliabilityWeekDays(selectedWeek?.weekDates || []);
        });
        reliabilityWeekSelect.dataset.bound = 'true';
    }

    if (addWeekDaysBtn && !addWeekDaysBtn.dataset.bound) {
        addWeekDaysBtn.addEventListener('click', applySelectedWeekDaysAsEntries);
        addWeekDaysBtn.dataset.bound = 'true';
    }

    if (carriedOverInput && !carriedOverInput.dataset.bound) {
        carriedOverInput.addEventListener('input', () => {
            const context = getSelectedAssociateAndTracker(true);
            if (!context.tracker) return;
            context.tracker.carriedOverHours = normalizeHours(carriedOverInput.value);
            carriedOverInput.value = context.tracker.carriedOverHours.toFixed(2);
            savePtoStore(context.store);
            refreshPtoAssociateOptionFlags();
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
            refreshPtoAssociateOptionFlags();
            renderPtoSummary(context.tracker, context.associateName);
        });
        earnedThisYearInput.dataset.bound = 'true';
    }

    if (reliabilityHoursInput && !reliabilityHoursInput.dataset.bound) {
        reliabilityHoursInput.addEventListener('input', () => {
            const context = getSelectedAssociateAndTracker(true);
            if (!context.tracker) return;

            const ytdSnapshot = getLatestYtdReliabilitySnapshotForAssociate(context.associateName);
            if (ytdSnapshot?.hasYtdPeriod) {
                syncTrackerReliabilityFromYtd(context.associateName, context.tracker);
                reliabilityHoursInput.value = normalizeHours(context.tracker.reliabilityHoursAgainst).toFixed(2);
                savePtoStore(context.store);
                refreshPtoAssociateOptionFlags();
                renderPtoSummary(context.tracker, context.associateName);
                renderPtoReliabilitySourceNote(context.associateName);
                showToast('Reliability comes from latest YTD upload and cannot be overridden here.', 3500);
                return;
            }

            context.tracker.reliabilityHoursAgainst = normalizeHours(reliabilityHoursInput.value);
            reliabilityHoursInput.value = context.tracker.reliabilityHoursAgainst.toFixed(2);
            savePtoStore(context.store);
            refreshPtoAssociateOptionFlags();
            renderPtoSummary(context.tracker, context.associateName);
            renderPtoReliabilitySourceNote(context.associateName);
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

    appendEntryWithTypePolicy(context.tracker, date, hours, type, notes, true);

    savePtoStore(context.store);
    refreshPtoAssociateOptionFlags();
    renderPtoSummary(context.tracker, context.associateName);
    renderPtoEntries(context.tracker, context.associateName);

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
    refreshPtoAssociateOptionFlags();
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
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <select data-entry-type-id="${entry.id}" style="padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px;">
                            <option value="ptost" ${entry.type === 'ptost' ? 'selected' : ''}>PTOST</option>
                            <option value="pto-planned" ${entry.type === 'pto-planned' ? 'selected' : ''}>PTO Planned</option>
                            <option value="pto-unplanned" ${entry.type === 'pto-unplanned' ? 'selected' : ''}>PTO Unplanned</option>
                        </select>
                        <button type="button" data-entry-id="${entry.id}" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 6px 10px; cursor: pointer;">Remove</button>
                    </div>
                </div>
            `;
        })
        .join('');

    container.innerHTML = rows;
    container.querySelectorAll('select[data-entry-type-id]').forEach(select => {
        select.addEventListener('change', () => {
            reclassifyPtoEntryType(select.dataset.entryTypeId, select.value);
        });
    });
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
