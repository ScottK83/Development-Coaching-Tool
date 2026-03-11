// ============================================
// PTO / TIME-OFF TRACKER (HOURS-BASED, PER ASSOCIATE)
// ============================================

const PTOST_MAX_HOURS_DEFAULT = 40;
const PTO_WEEK_DEFAULT_HOURS = 8;
const PTO_TRACKING_YEAR = 2026;
const PTO_LEGACY_ASSOCIATE_KEY = '__LEGACY_PTO__';
const TEAM_MEMBERS_STORAGE_KEY = 'devCoachingTool_myTeamMembers';
const PTO_CARRYOVER_CAP_HOURS = 120;

const PTO_DISCIPLINE_LADDER = [
    { threshold: 16, level: 'Verbal Warning' },
    { threshold: 24, level: 'Written Reminder' },
    { threshold: 32, level: 'Written Warning' },
    { threshold: 40, level: 'DMS' }
];

const PTO_VALID_TYPES = [
    'ptost', 'pto-planned', 'pto-unplanned',
    'vto-pto', 'tardy', 'tardy-ptost', 'ncns'
];
let ptoReliabilityWeekCache = [];

function getDefaultPtoTracker() {
    return {
        carriedOverHours: 0,
        earnedThisYearHours: 0,
        reliabilityHoursAgainst: 0,
        ptostMaxHours: PTOST_MAX_HOURS_DEFAULT,
        entries: [],
        payrollEntries: []
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
    if (PTO_VALID_TYPES.includes(value)) return value;
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
        entries: [],
        payrollEntries: Array.isArray(source.payrollEntries) ? source.payrollEntries : []
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
    const teamFilter = getPtoTeamSelectionFilter(weeklyData);
    const names = new Set();

    Object.entries(weeklyData).forEach(([weekKey, week]) => {
        if (!week || typeof week !== 'object') return;
        const startDate = String(week?.metadata?.startDate || '').trim();
        const endDate = String(week?.metadata?.endDate || '').trim();
        if (!isPeriodInTrackingYear(startDate, endDate, weekKey)) return;

        if (teamFilter?.weekKey && weekKey !== teamFilter.weekKey) {
            return;
        }

        const employees = Array.isArray(week.employees) ? week.employees : [];
        employees.forEach(employee => {
            const name = normalizeAssociateName(employee?.name);
            if (!name) return;
            if (teamFilter?.allowedSet && !teamFilter.allowedSet.has(name)) return;
            names.add(name);
        });
    });

    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function getAssociateOptions(store) {
    const weeklyData = window.DevCoachModules?.storage?.loadWeeklyData?.() || {};
    const teamFilter = getPtoTeamSelectionFilter(weeklyData);
    const fromWeekly = getWeeklyAssociates();
    const fromPto = Object.keys(store.associates || {});
    const combined = new Set([...fromWeekly, ...fromPto]);
    const options = Array.from(combined).filter(name => {
        if (name === PTO_LEGACY_ASSOCIATE_KEY) return true;
        if (!teamFilter?.allowedSet) return true;
        return teamFilter.allowedSet.has(name);
    });
    return options.sort((a, b) => a.localeCompare(b));
}

function loadTeamMembersByWeek() {
    try {
        const raw = localStorage.getItem(TEAM_MEMBERS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_error) {
        return {};
    }
}

function getLatestTrackingWeekKey(weeklyData) {
    const candidates = [];

    Object.entries(weeklyData || {}).forEach(([weekKey, week]) => {
        if (!week || typeof week !== 'object') return;
        const startDate = String(week?.metadata?.startDate || '').trim();
        const endDate = String(week?.metadata?.endDate || '').trim();
        if (!isPeriodInTrackingYear(startDate, endDate, weekKey)) return;

        const referenceDateText = endDate || startDate || String(weekKey).split('|')[1] || String(weekKey).split('|')[0] || '';
        const referenceDate = parseIsoDateSafe(referenceDateText);

        candidates.push({
            weekKey,
            referenceDate
        });
    });

    if (!candidates.length) return '';

    candidates.sort((a, b) => {
        const aTime = a.referenceDate ? a.referenceDate.getTime() : 0;
        const bTime = b.referenceDate ? b.referenceDate.getTime() : 0;
        return bTime - aTime;
    });

    return String(candidates[0]?.weekKey || '').trim();
}

function getPtoTeamSelectionFilter(weeklyData) {
    const sharedContextResolver = window.getTeamSelectionContext;
    if (typeof sharedContextResolver === 'function') {
        const context = sharedContextResolver();
        const weekKey = String(context?.weekKey || '').trim();
        if (!weekKey) return null;

        const selectedMembers = Array.isArray(context?.selectedMembers)
            ? context.selectedMembers.map(normalizeAssociateName).filter(Boolean)
            : [];

        if (!selectedMembers.length) {
            return {
                weekKey,
                allowedSet: null
            };
        }

        return {
            weekKey,
            allowedSet: new Set(selectedMembers)
        };
    }

    const latestWeekKey = getLatestTrackingWeekKey(weeklyData);
    if (!latestWeekKey) return null;

    const teamMembersByWeek = loadTeamMembersByWeek();
    const selectedMembers = Array.isArray(teamMembersByWeek[latestWeekKey])
        ? teamMembersByWeek[latestWeekKey].map(normalizeAssociateName).filter(Boolean)
        : [];

    if (!selectedMembers.length) {
        return {
            weekKey: latestWeekKey,
            allowedSet: null
        };
    }

    return {
        weekKey: latestWeekKey,
        allowedSet: new Set(selectedMembers)
    };
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

function getDisciplineLevel(unplannedHours) {
    let current = null;
    let next = PTO_DISCIPLINE_LADDER[0] || null;
    for (let i = PTO_DISCIPLINE_LADDER.length - 1; i >= 0; i--) {
        if (unplannedHours >= PTO_DISCIPLINE_LADDER[i].threshold) {
            current = PTO_DISCIPLINE_LADDER[i];
            next = PTO_DISCIPLINE_LADDER[i + 1] || null;
            break;
        }
    }
    if (!current) {
        next = PTO_DISCIPLINE_LADDER[0] || null;
    }
    return { current, next };
}

function calculatePtoStats(data) {
    const entries = getTrackedEntries(data);

    const sumByType = (types) => entries
        .filter(entry => types.includes(entry.type))
        .reduce((sum, entry) => sum + normalizeHours(entry.hours), 0);

    const totalPtostUsed = sumByType(['ptost', 'tardy-ptost']);
    const totalPtoPlannedUsed = sumByType(['pto-planned']);
    const totalPtoUnplannedUsed = sumByType(['pto-unplanned', 'ncns']);
    const totalVtoPtoUsed = sumByType(['vto-pto']);
    const totalTardyUsed = sumByType(['tardy']);
    const totalTardyPtostUsed = sumByType(['tardy-ptost']);
    const totalNcnsUsed = sumByType(['ncns']);

    const totalPtoAvailable = normalizeHours(data.carriedOverHours) + normalizeHours(data.earnedThisYearHours);
    const totalPtoUsed = totalPtoPlannedUsed + totalPtoUnplannedUsed + totalVtoPtoUsed + totalTardyUsed;
    const remainingPtoHours = Math.max(0, totalPtoAvailable - totalPtoUsed);
    const ptostRemainingHours = Math.max(0, normalizeHours(data.ptostMaxHours || PTOST_MAX_HOURS_DEFAULT) - totalPtostUsed);

    const scheduledEntries = entries.filter(entry => {
        const entryDate = parseIsoDateSafe(entry.date);
        return entryDate && entryDate > new Date();
    });
    const scheduledHours = scheduledEntries.reduce((sum, entry) => sum + normalizeHours(entry.hours), 0);

    const reliabilityFromMetrics = normalizeHours(data.reliabilityHoursAgainst);
    const sameDayHours = totalPtoUnplannedUsed + totalPtostUsed;
    const effectiveUnplannedReliabilityHours = Math.max(sameDayHours, reliabilityFromMetrics);
    const discipline = getDisciplineLevel(effectiveUnplannedReliabilityHours);

    const carryoverExceeds = normalizeHours(data.carriedOverHours) > PTO_CARRYOVER_CAP_HOURS;

    return {
        totalPtostUsed,
        totalPtoPlannedUsed,
        totalPtoUnplannedUsed,
        totalVtoPtoUsed,
        totalTardyUsed,
        totalTardyPtostUsed,
        totalNcnsUsed,
        totalPtoAvailable,
        totalPtoUsed,
        remainingPtoHours,
        scheduledHours,
        ptostRemainingHours,
        reliabilityFromMetrics,
        effectiveUnplannedReliabilityHours,
        discipline,
        carryoverExceeds,
        sameDayHours
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

    const isPtostType = normalizedType === 'ptost' || normalizedType === 'tardy-ptost';
    if (!isPtostType) {
        pushEntry(normalizedType, normalizedHours, notes);
        return;
    }

    const overflowType = normalizedType === 'tardy-ptost' ? 'tardy' : 'pto-unplanned';
    const stats = calculatePtoStats(data);
    const ptostRemaining = Math.max(0, normalizeHours(data.ptostMaxHours || PTOST_MAX_HOURS_DEFAULT) - stats.totalPtostUsed);
    if (ptostRemaining <= 0) {
        pushEntry(overflowType, normalizedHours, notes ? `${notes} (auto-converted from PTOST: exhausted)` : 'auto-converted from PTOST: exhausted');
        if (showPolicyToasts) showToast('PTOST exhausted. Entry saved as ' + overflowType + '.', 4000);
        return;
    }

    if (normalizedHours > ptostRemaining) {
        pushEntry(normalizedType, ptostRemaining, notes);
        pushEntry(overflowType, normalizedHours - ptostRemaining, notes ? `${notes} (overflow after PTOST exhausted)` : 'overflow after PTOST exhausted');
        if (showPolicyToasts) showToast('Entry split: remaining PTOST used, overflow saved as ' + overflowType + '.', 4500);
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

// ============================================
// VERINT PASTE PARSER
// ============================================

const VERINT_TYPE_MAP = {
    'pre planned absence': 'pto-planned',
    'pplo gt 48 hrs': 'pto-planned',
    'pplo lt 48 hrs': 'pto-planned',
    'same day': 'pto-unplanned',
    'same day - full ptost': 'ptost',
    'same day - partial ptost': 'ptost',
    'same day - partial': 'pto-unplanned',
    'same day - no call no show': 'ncns',
    'tardy eq gt 6 min': 'tardy',
    'tardy eq gt 6 min ptost': 'tardy-ptost',
    'tardy lt 6 min': 'tardy',
    'vto-pto': 'vto-pto'
};

function parseVerintActivityDate(dateStr) {
    // Parses "1/7/2026 4:40 PM" -> "2026-01-07"
    const match = String(dateStr || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return null;
    const month = String(match[1]).padStart(2, '0');
    const day = String(match[2]).padStart(2, '0');
    return `${match[3]}-${month}-${day}`;
}

function parseVerintPaste(rawText) {
    const lines = String(rawText || '').split('\n').map(line => line.trim()).filter(Boolean);
    const entries = [];
    const skipped = [];

    // Find the "Time Off Activities" section
    let inActivities = false;
    let headerFound = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (/^time off activities$/i.test(line)) {
            inActivities = true;
            continue;
        }

        if (inActivities && !headerFound && /^from\s/i.test(line)) {
            headerFound = true;
            continue;
        }

        if (inActivities && /^(total time off|time off requests)/i.test(line)) {
            break;
        }

        if (!inActivities || !headerFound) continue;

        // Each activity is: Type \n From \n To \n Hours
        // But in pasted text it may be on one line or split across lines
        // The pattern from the paste: "Category\nDate1\nDate2\nHours"
        // Or sometimes: "Category" then tab-separated "From To Hours"

        // Try to match a known category name
        const lowerLine = line.toLowerCase();
        let matchedCategory = null;
        for (const [verintName] of Object.entries(VERINT_TYPE_MAP)) {
            if (lowerLine === verintName || lowerLine.startsWith(verintName + '\t')) {
                matchedCategory = verintName;
                break;
            }
        }

        if (!matchedCategory) continue;

        // Look ahead for From, To, Hours on subsequent lines
        const remaining = line.substring(matchedCategory.length).trim();
        let fromStr = '', toStr = '', hoursStr = '';

        if (remaining) {
            // Tab-separated on same line: "Pre Planned Absence\t1/7/2026 4:40 PM\t1/7/2026 6:00 PM\t1.33"
            const parts = remaining.split('\t').map(s => s.trim()).filter(Boolean);
            if (parts.length >= 3) {
                fromStr = parts[0];
                toStr = parts[1];
                hoursStr = parts[2];
            } else if (parts.length >= 1) {
                fromStr = parts[0];
                toStr = (lines[i + 1] || '').trim();
                hoursStr = (lines[i + 2] || '').trim();
                i += 2;
            }
        } else {
            fromStr = (lines[i + 1] || '').trim();
            toStr = (lines[i + 2] || '').trim();
            hoursStr = (lines[i + 3] || '').trim();
            i += 3;
        }

        const date = parseVerintActivityDate(fromStr);
        const hours = parseFloat(hoursStr);

        if (!date || !Number.isFinite(hours) || hours <= 0) {
            skipped.push({ category: matchedCategory, from: fromStr, to: toStr, hours: hoursStr, reason: 'Could not parse date/hours' });
            continue;
        }

        entries.push({
            date,
            hours: normalizeHours(hours),
            type: VERINT_TYPE_MAP[matchedCategory],
            verintCategory: matchedCategory,
            notes: `Verint: ${matchedCategory}`
        });
    }

    return { entries, skipped };
}

function importVerintEntries() {
    const context = getSelectedAssociateAndTracker(true);
    if (!context.associateName || !context.tracker) {
        showToast('Select an associate first', 3000);
        return;
    }

    const textarea = document.getElementById('ptoVerintPaste');
    const rawText = textarea?.value || '';
    if (!rawText.trim()) {
        showToast('Paste Verint data first', 3000);
        return;
    }

    const { entries, skipped } = parseVerintPaste(rawText);

    if (!entries.length) {
        showToast(`No entries parsed. ${skipped.length ? skipped.length + ' skipped.' : 'Check paste format.'}`, 4000);
        return;
    }

    // Deduplicate against existing entries (same date + type + hours)
    const existing = new Set(
        context.tracker.entries.map(e => `${e.date}|${e.type}|${normalizeHours(e.hours)}`)
    );

    let added = 0;
    let dupes = 0;
    entries.forEach(entry => {
        const key = `${entry.date}|${entry.type}|${entry.hours}`;
        if (existing.has(key)) {
            dupes++;
            return;
        }
        existing.add(key);
        appendEntryWithTypePolicy(context.tracker, entry.date, entry.hours, entry.type, entry.notes, false);
        added++;
    });

    savePtoStore(context.store);
    refreshPtoAssociateOptionFlags();
    renderPtoSummary(context.tracker, context.associateName);
    renderPtoEntries(context.tracker, context.associateName);

    const resultParts = [`Imported ${added} entries`];
    if (dupes > 0) resultParts.push(`${dupes} duplicates skipped`);
    if (skipped.length > 0) resultParts.push(`${skipped.length} could not be parsed`);
    showToast(resultParts.join(', '), 5000);

    // Show results summary
    const resultsEl = document.getElementById('ptoVerintResults');
    if (resultsEl) {
        let html = `<div style="padding:8px;border-radius:6px;background:#e8f5e9;color:#1b5e20;margin-top:8px;">
            <strong>${added} entries imported</strong>${dupes ? `, ${dupes} duplicates skipped` : ''}${skipped.length ? `, ${skipped.length} unparseable` : ''}
        </div>`;
        if (skipped.length) {
            html += `<div style="padding:8px;border-radius:6px;background:#fff3cd;color:#856404;margin-top:4px;font-size:0.9em;">
                <strong>Skipped:</strong><br>${skipped.map(s => `${s.category}: ${s.from} — ${s.reason}`).join('<br>')}
            </div>`;
        }
        resultsEl.innerHTML = html;
    }

    if (textarea) textarea.value = '';
}

// ============================================
// PAYROLL PASTE PARSER
// ============================================

const PAYROLL_TRC_MAP = {
    'pto': 'pto-planned',
    'ptost': 'ptost',
    'pto unscheduled': 'pto-unplanned'
};

function parsePayrollDate(dateStr) {
    // Parses "01/07/2026" or "1/7/2026" -> "2026-01-07"
    const match = String(dateStr || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    const month = String(match[1]).padStart(2, '0');
    const day = String(match[2]).padStart(2, '0');
    return `${match[3]}-${month}-${day}`;
}

function parsePayrollPaste(rawText) {
    const lines = String(rawText || '').split('\n').map(line => line.trim()).filter(Boolean);
    const entries = [];
    const skipped = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Split by tab or comma (CSV format)
        let cols;
        if (line.includes('\t')) {
            cols = line.split('\t').map(s => s.trim());
        } else {
            cols = line.split(',').map(s => s.trim());
        }

        // Skip header row and row-number prefixed rows
        // Strip leading row number if present (e.g., "2\t12/23/2025\t...")
        if (cols.length > 1 && /^\d+$/.test(cols[0]) && /\d{1,2}\/\d{1,2}\/\d{4}/.test(cols[1])) {
            cols = cols.slice(1);
        }

        // Expect: Date, Day, Time_In, Lunch_In, Lunch_Out, Time_Out, TRC, Quantity, Status
        // Or with row number stripped: same columns
        // Find the date column
        const dateCol = cols[0];
        const date = parsePayrollDate(dateCol);
        if (!date) continue;

        // Find TRC and Quantity - they could be at various positions depending on empty columns
        // TRC is the code column, Quantity is the hours
        // In the CSV, empty time fields show as empty strings
        // Columns: Date(0), Day(1), Time_In(2), Lunch_In(3), Lunch_Out(4), Time_Out(5), TRC(6), Quantity(7), Status(8)
        let trc = '';
        let quantity = '';
        let status = '';

        if (cols.length >= 9) {
            trc = cols[6];
            quantity = cols[7];
            status = cols[8];
        } else if (cols.length >= 7) {
            // Shorter row - find the TRC by looking for known codes
            for (let c = 2; c < cols.length; c++) {
                const lower = cols[c].toLowerCase();
                if (lower === 'reg' || lower === 'pto' || lower === 'ptost' || lower === 'pto unscheduled') {
                    trc = cols[c];
                    quantity = cols[c + 1] || '';
                    status = cols[c + 2] || '';
                    break;
                }
            }
        }

        if (!trc) continue;

        const trcLower = trc.toLowerCase().trim();

        // Skip REG entries - we only care about time off
        if (trcLower === 'reg') continue;

        // Skip header row
        if (trcLower === 'trc') continue;

        const mappedType = PAYROLL_TRC_MAP[trcLower];
        if (!mappedType) {
            skipped.push({ trc, date: dateCol, quantity, reason: `Unknown TRC code: ${trc}` });
            continue;
        }

        const hours = parseFloat(quantity);
        if (!Number.isFinite(hours) || hours <= 0) {
            skipped.push({ trc, date: dateCol, quantity, reason: 'Invalid hours' });
            continue;
        }

        entries.push({
            date,
            hours: normalizeHours(hours),
            type: mappedType,
            payrollTrc: trc.trim(),
            status: String(status || '').trim(),
            notes: `Payroll: ${trc.trim()}${status ? ' (' + status + ')' : ''}`
        });
    }

    return { entries, skipped };
}

function importPayrollEntries() {
    const context = getSelectedAssociateAndTracker(true);
    if (!context.associateName || !context.tracker) {
        showToast('Select an associate first', 3000);
        return;
    }

    const textarea = document.getElementById('ptoPayrollPaste');
    const rawText = textarea?.value || '';
    if (!rawText.trim()) {
        showToast('Paste payroll data first', 3000);
        return;
    }

    const { entries, skipped } = parsePayrollPaste(rawText);

    if (!entries.length) {
        showToast(`No entries parsed. ${skipped.length ? skipped.length + ' skipped.' : 'Check paste format.'}`, 4000);
        return;
    }

    // Store payroll entries separately for discrepancy comparison
    if (!context.tracker.payrollEntries) {
        context.tracker.payrollEntries = [];
    }

    // Deduplicate against existing payroll entries
    const existing = new Set(
        context.tracker.payrollEntries.map(e => `${e.date}|${e.payrollTrc}|${normalizeHours(e.hours)}`)
    );

    let added = 0;
    let dupes = 0;
    entries.forEach(entry => {
        const key = `${entry.date}|${entry.payrollTrc}|${entry.hours}`;
        if (existing.has(key)) {
            dupes++;
            return;
        }
        existing.add(key);
        context.tracker.payrollEntries.push({
            id: `payroll-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            date: entry.date,
            hours: entry.hours,
            type: entry.type,
            payrollTrc: entry.payrollTrc,
            status: entry.status,
            notes: entry.notes
        });
        added++;
    });

    savePtoStore(context.store);

    const resultParts = [`Imported ${added} payroll entries`];
    if (dupes > 0) resultParts.push(`${dupes} duplicates skipped`);
    if (skipped.length > 0) resultParts.push(`${skipped.length} could not be parsed`);
    showToast(resultParts.join(', '), 5000);

    const resultsEl = document.getElementById('ptoPayrollResults');
    if (resultsEl) {
        let html = `<div style="padding:8px;border-radius:6px;background:#f0e8f5;color:#3e1f5e;margin-top:8px;">
            <strong>${added} payroll entries imported</strong>${dupes ? `, ${dupes} duplicates skipped` : ''}${skipped.length ? `, ${skipped.length} unparseable` : ''}
        </div>`;

        // Show what was imported
        if (added > 0) {
            const summary = {};
            entries.forEach(e => {
                if (!existing.has(`COUNTED_${e.date}|${e.payrollTrc}|${e.hours}`)) {
                    summary[e.payrollTrc] = (summary[e.payrollTrc] || 0) + e.hours;
                }
            });
            const summaryLines = Object.entries(summary).map(([trc, hrs]) => `${trc}: ${hrs.toFixed(2)}h`).join(', ');
            html += `<div style="padding:6px 8px;font-size:0.9em;color:#5a6a68;margin-top:4px;">${summaryLines}</div>`;
        }

        if (skipped.length) {
            html += `<div style="padding:8px;border-radius:6px;background:#fff3cd;color:#856404;margin-top:4px;font-size:0.9em;">
                <strong>Skipped:</strong><br>${skipped.map(s => `${s.trc} on ${s.date}: ${s.reason}`).join('<br>')}
            </div>`;
        }
        resultsEl.innerHTML = html;
    }

    if (textarea) textarea.value = '';
}

// ============================================
// VERINT vs PAYROLL DISCREPANCY CHECK
// ============================================

function runDiscrepancyCheck() {
    const context = getSelectedAssociateAndTracker(false);
    if (!context.associateName || !context.tracker) {
        showToast('Select an associate first', 3000);
        return;
    }

    const resultsEl = document.getElementById('ptoDiscrepancyResults');
    if (!resultsEl) return;

    const tracker = context.tracker;
    const verintEntries = getTrackedEntries(tracker).filter(e => (e.notes || '').startsWith('Verint:'));
    const payrollEntries = Array.isArray(tracker.payrollEntries) ? tracker.payrollEntries.filter(e => {
        const year = getYearFromIsoDateText(e.date);
        return year === PTO_TRACKING_YEAR;
    }) : [];

    if (!verintEntries.length && !payrollEntries.length) {
        resultsEl.innerHTML = '<div style="padding:10px;color:#856404;background:#fff3cd;border-radius:6px;">No Verint or Payroll data imported yet. Import both sources first.</div>';
        return;
    }

    if (!verintEntries.length) {
        resultsEl.innerHTML = '<div style="padding:10px;color:#856404;background:#fff3cd;border-radius:6px;">No Verint data imported yet. Import Verint data first.</div>';
        return;
    }

    if (!payrollEntries.length) {
        resultsEl.innerHTML = '<div style="padding:10px;color:#856404;background:#fff3cd;border-radius:6px;">No Payroll data imported yet. Import Payroll data first.</div>';
        return;
    }

    // Build date-based lookup for both sources
    // Verint: group by date, sum hours per date
    const verintByDate = {};
    verintEntries.forEach(e => {
        if (!verintByDate[e.date]) verintByDate[e.date] = { totalHours: 0, entries: [] };
        verintByDate[e.date].totalHours += normalizeHours(e.hours);
        verintByDate[e.date].entries.push(e);
    });

    // Payroll: group by date, sum hours per date
    const payrollByDate = {};
    payrollEntries.forEach(e => {
        if (!payrollByDate[e.date]) payrollByDate[e.date] = { totalHours: 0, entries: [] };
        payrollByDate[e.date].totalHours += normalizeHours(e.hours);
        payrollByDate[e.date].entries.push(e);
    });

    const allDates = new Set([...Object.keys(verintByDate), ...Object.keys(payrollByDate)]);
    const sortedDates = Array.from(allDates).sort();

    const discrepancies = [];
    const matched = [];

    sortedDates.forEach(date => {
        const v = verintByDate[date];
        const p = payrollByDate[date];

        if (v && !p) {
            discrepancies.push({
                date,
                issue: 'In Verint only',
                verintHours: v.totalHours,
                payrollHours: 0,
                verintDetails: v.entries.map(e => `${e.type} ${normalizeHours(e.hours).toFixed(2)}h`).join(', '),
                payrollDetails: '—',
                severity: 'warning'
            });
        } else if (!v && p) {
            discrepancies.push({
                date,
                issue: 'In Payroll only',
                verintHours: 0,
                payrollHours: p.totalHours,
                verintDetails: '—',
                payrollDetails: p.entries.map(e => `${e.payrollTrc} ${normalizeHours(e.hours).toFixed(2)}h`).join(', '),
                severity: 'warning'
            });
        } else if (v && p) {
            const vHours = normalizeHours(v.totalHours);
            const pHours = normalizeHours(p.totalHours);
            const diff = Math.abs(vHours - pHours);

            if (diff > 0.01) {
                discrepancies.push({
                    date,
                    issue: `Hours mismatch (${diff.toFixed(2)}h diff)`,
                    verintHours: vHours,
                    payrollHours: pHours,
                    verintDetails: v.entries.map(e => `${e.type} ${normalizeHours(e.hours).toFixed(2)}h`).join(', '),
                    payrollDetails: p.entries.map(e => `${e.payrollTrc} ${normalizeHours(e.hours).toFixed(2)}h`).join(', '),
                    severity: diff >= 4 ? 'danger' : 'warning'
                });
            } else {
                matched.push({ date, hours: vHours });
            }
        }
    });

    // Build summary
    const verintTotal = verintEntries.reduce((s, e) => s + normalizeHours(e.hours), 0);
    const payrollTotal = payrollEntries.reduce((s, e) => s + normalizeHours(e.hours), 0);
    const totalDiff = Math.abs(verintTotal - payrollTotal);

    let html = `<div style="padding:12px;border-radius:6px;background:${discrepancies.length ? '#fff5f5' : '#e8f5e9'};margin-top:8px;">
        <strong>Summary:</strong> Verint ${verintTotal.toFixed(2)}h total | Payroll ${payrollTotal.toFixed(2)}h total | Diff: ${totalDiff.toFixed(2)}h<br>
        <span style="font-size:0.9em;">${matched.length} dates matched, ${discrepancies.length} discrepancies found</span>
    </div>`;

    if (discrepancies.length) {
        html += `<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:0.9em;">
            <thead>
                <tr style="background:#f8f9fa;text-align:left;">
                    <th style="padding:8px;border:1px solid #dee2e6;">Date</th>
                    <th style="padding:8px;border:1px solid #dee2e6;">Issue</th>
                    <th style="padding:8px;border:1px solid #dee2e6;">Verint</th>
                    <th style="padding:8px;border:1px solid #dee2e6;">Payroll</th>
                </tr>
            </thead>
            <tbody>`;

        discrepancies.forEach(d => {
            const rowBg = d.severity === 'danger' ? '#ffe0e0' : '#fff8e1';
            html += `<tr style="background:${rowBg};">
                <td style="padding:8px;border:1px solid #dee2e6;font-weight:600;">${d.date}</td>
                <td style="padding:8px;border:1px solid #dee2e6;">${d.issue}</td>
                <td style="padding:8px;border:1px solid #dee2e6;">${d.verintHours.toFixed(2)}h<br><span style="font-size:0.85em;color:#666;">${d.verintDetails}</span></td>
                <td style="padding:8px;border:1px solid #dee2e6;">${d.payrollHours.toFixed(2)}h<br><span style="font-size:0.85em;color:#666;">${d.payrollDetails}</span></td>
            </tr>`;
        });

        html += '</tbody></table>';
    } else {
        html += '<div style="padding:10px;color:#1b5e20;margin-top:8px;">All dates match between Verint and Payroll. No discrepancies found.</div>';
    }

    resultsEl.innerHTML = html;
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

    const verintImportBtn = document.getElementById('ptoVerintImportBtn');
    if (verintImportBtn && !verintImportBtn.dataset.bound) {
        verintImportBtn.addEventListener('click', importVerintEntries);
        verintImportBtn.dataset.bound = 'true';
    }

    const payrollImportBtn = document.getElementById('ptoPayrollImportBtn');
    if (payrollImportBtn && !payrollImportBtn.dataset.bound) {
        payrollImportBtn.addEventListener('click', importPayrollEntries);
        payrollImportBtn.dataset.bound = 'true';
    }

    const discrepancyBtn = document.getElementById('ptoDiscrepancyBtn');
    if (discrepancyBtn && !discrepancyBtn.dataset.bound) {
        discrepancyBtn.addEventListener('click', runDiscrepancyCheck);
        discrepancyBtn.dataset.bound = 'true';
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
    const displayName = associateName === PTO_LEGACY_ASSOCIATE_KEY ? 'Legacy PTO Data (migrated)' : associateName;

    // Discipline ladder status
    let disciplineHtml = '';
    if (stats.discipline.current) {
        const level = stats.discipline.current;
        disciplineHtml = `<span style="color:#dc3545;font-weight:700;">&#x1F534; ${level.level} (${stats.sameDayHours.toFixed(2)}h at ${level.threshold}h threshold)</span>`;
        if (stats.discipline.next) {
            const hoursToNext = normalizeHours(stats.discipline.next.threshold - stats.sameDayHours);
            disciplineHtml += `<br><span style="color:#856404;font-size:0.9em;">Next: ${stats.discipline.next.level} in ${hoursToNext.toFixed(2)}h</span>`;
        }
    } else if (stats.discipline.next) {
        const hoursToNext = normalizeHours(stats.discipline.next.threshold - stats.sameDayHours);
        disciplineHtml = `<span style="color:#198754;">&#x1F7E2; No discipline triggered (${stats.sameDayHours.toFixed(2)}h same-day, ${hoursToNext.toFixed(2)}h until ${stats.discipline.next.level})</span>`;
    } else {
        disciplineHtml = `<span style="color:#198754;">&#x1F7E2; No discipline triggered</span>`;
    }

    // Carryover cap warning
    let carryoverNote = '';
    if (stats.carryoverExceeds) {
        carryoverNote = ` <span style="color:#dc3545;font-weight:600;">(exceeds ${PTO_CARRYOVER_CAP_HOURS}h cap!)</span>`;
    }

    // NCNS flag
    let ncnsHtml = '';
    if (stats.totalNcnsUsed > 0) {
        ncnsHtml = `<br><strong style="color:#dc3545;">&#x26A0; No Call No Show:</strong> <span style="color:#dc3545;font-weight:700;">${stats.totalNcnsUsed.toFixed(2)}h — Needs WFM correction</span>`;
    }

    summary.innerHTML = `
        <strong>Associate:</strong> ${displayName}<br>
        <strong>PTO Available:</strong> ${stats.totalPtoAvailable.toFixed(2)}h (Carryover ${normalizeHours(data.carriedOverHours).toFixed(2)}h${carryoverNote} + Earned ${normalizeHours(data.earnedThisYearHours).toFixed(2)}h)<br>
        <strong>PTO Used:</strong> ${stats.totalPtoUsed.toFixed(2)}h (Planned ${stats.totalPtoPlannedUsed.toFixed(2)}h, Unplanned ${stats.totalPtoUnplannedUsed.toFixed(2)}h, VTO ${stats.totalVtoPtoUsed.toFixed(2)}h, Tardy ${stats.totalTardyUsed.toFixed(2)}h)<br>
        <strong>PTO Remaining:</strong> ${stats.remainingPtoHours.toFixed(2)}h${stats.scheduledHours > 0 ? ` (${stats.scheduledHours.toFixed(2)}h scheduled future)` : ''}<br>
        <strong>PTOST:</strong> ${stats.totalPtostUsed.toFixed(2)}h used / ${normalizeHours(data.ptostMaxHours || PTOST_MAX_HOURS_DEFAULT).toFixed(2)}h (${stats.ptostRemainingHours.toFixed(2)}h remaining)<br>
        <strong>Reliability Hours Against:</strong> ${stats.reliabilityFromMetrics.toFixed(2)}h<br>
        <strong>Same-Day Discipline:</strong> ${disciplineHtml}${ncnsHtml}
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
        const labels = {
            'ptost': 'PTOST',
            'pto-planned': 'PTO Planned',
            'pto-unplanned': 'PTO Unplanned',
            'vto-pto': 'VTO-PTO',
            'tardy': 'Tardy',
            'tardy-ptost': 'Tardy (PTOST)',
            'ncns': 'No Call No Show'
        };
        return labels[type] || 'PTO Unplanned';
    };

    const typeOptions = PTO_VALID_TYPES.map(t =>
        `<option value="${t}">${typeLabel(t)}</option>`
    ).join('');

    const rows = data.entries
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map(entry => {
            const noteText = entry.notes ? ` &bull; ${entry.notes}` : '';
            const isNcns = entry.type === 'ncns';
            const borderColor = isNcns ? '#f5c6cb' : '#e5f3f0';
            const bgColor = isNcns ? '#fff5f5' : '#f9fffd';
            const ncnsBadge = isNcns ? ' <span style="background:#dc3545;color:#fff;padding:1px 6px;border-radius:3px;font-size:0.8em;font-weight:700;">NCNS — Flag for WFM</span>' : '';
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid ${borderColor}; border-radius: 6px; background: ${bgColor};">
                    <div>
                        <strong>${entry.date}</strong> — ${normalizeHours(entry.hours).toFixed(2)}h &bull; <strong>${typeLabel(entry.type)}</strong>${ncnsBadge}${noteText}
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <select data-entry-type-id="${entry.id}" style="padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px;">
                            ${PTO_VALID_TYPES.map(t =>
                                `<option value="${t}" ${entry.type === t ? 'selected' : ''}>${typeLabel(t)}</option>`
                            ).join('')}
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
    const disciplineLine = stats.discipline.current
        ? `Same-Day Discipline: ${stats.discipline.current.level} (${stats.sameDayHours.toFixed(2)}h at ${stats.discipline.current.threshold}h threshold)`
        : `Same-Day Discipline: Not triggered (${stats.sameDayHours.toFixed(2)}h same-day hours)`;

    const emailTypeLabel = (type) => {
        const labels = {
            'ptost': 'PTOST', 'pto-planned': 'PTO Planned', 'pto-unplanned': 'PTO Unplanned',
            'vto-pto': 'VTO-PTO', 'tardy': 'Tardy', 'tardy-ptost': 'Tardy (PTOST)', 'ncns': 'No Call No Show'
        };
        return labels[type] || 'PTO Unplanned';
    };

    const entryLines = data.entries
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map(entry => `- ${entry.date}: ${normalizeHours(entry.hours).toFixed(2)}h (${emailTypeLabel(entry.type)})${entry.type === 'ncns' ? ' ** NCNS - Needs WFM correction **' : ''}${entry.notes ? ` - ${entry.notes}` : ''}`)
        .join('\n');

    const displayName = context.associateName === PTO_LEGACY_ASSOCIATE_KEY ? 'Legacy PTO Data (migrated)' : context.associateName;

    output.value = `Hello,\n\n` +
        `Here is the current PTO/time-off attendance snapshot for ${displayName}.\n\n` +
        `Carryover hours: ${normalizeHours(data.carriedOverHours).toFixed(2)}h\n` +
        `Earned this year: ${normalizeHours(data.earnedThisYearHours).toFixed(2)}h\n` +
        `Total PTO available: ${stats.totalPtoAvailable.toFixed(2)}h\n` +
        `PTO planned used: ${stats.totalPtoPlannedUsed.toFixed(2)}h\n` +
        `PTO unplanned used: ${stats.totalPtoUnplannedUsed.toFixed(2)}h\n` +
        `VTO-PTO used: ${stats.totalVtoPtoUsed.toFixed(2)}h\n` +
        `Tardy: ${stats.totalTardyUsed.toFixed(2)}h\n` +
        `PTO remaining: ${stats.remainingPtoHours.toFixed(2)}h\n` +
        `PTOST used: ${stats.totalPtostUsed.toFixed(2)}h of ${normalizeHours(data.ptostMaxHours || PTOST_MAX_HOURS_DEFAULT).toFixed(2)}h\n` +
        `${disciplineLine}\n\n` +
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
