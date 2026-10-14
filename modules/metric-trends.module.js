// NOTE: At ~4100 lines, this is the largest module. Consider splitting into:
// - metric-trends-charts.module.js (chart rendering)
// - metric-trends-data.module.js (aggregation/calculation)
// - metric-trends-ui.module.js (DOM/interaction)
(function() {
    'use strict';

    // ============================================
    // METRIC TRENDS MODULE
    // ============================================

    const AVERAGE_FORM_FIELD_MAP = {
        adherence: 'avgAdherence',
        overallExperience: 'avgOverallExperience',
        repSatisfaction: 'avgRepSatisfaction',
        fcr: 'avgFCR',
        transfers: 'avgTransfers',
        sentiment: 'avgSentiment',
        positiveWord: 'avgPositiveWord',
        negativeWord: 'avgNegativeWord',
        managingEmotions: 'avgManagingEmotions',
        aht: 'avgAHT',
        acw: 'avgACW',
        holdTime: 'avgHoldTime',
        reliability: 'avgReliability'
    };

    // Guard so initializeMetricTrends() can be called multiple times (it is
    // — from script.js:381 the section init, :1635 the subnav handler, and
    // :1872 a legacy stub) without re-binding listeners on persistent buttons.
    let metricTrendsListenersBound = false;

    const STORAGE_PREFIX = window.DevCoachConstants?.STORAGE_PREFIX || 'devCoachingTool_';
    const LAST_TREND_PERIOD_KEY = STORAGE_PREFIX + 'lastTrendPeriod';

    // Maps registry metric keys → center average storage keys
    const TREND_METRIC_MAPPINGS = {
        scheduleAdherence: 'adherence',
        overallExperience: 'overallExperience',
        cxRepOverall: 'repSatisfaction',
        fcr: 'fcr',
        transfers: 'transfers',
        overallSentiment: 'sentiment',
        positiveWord: 'positiveWord',
        negativeWord: 'negativeWord',
        managingEmotions: 'managingEmotions',
        aht: 'aht',
        acw: 'acw',
        holdTime: 'holdTime',
        reliability: 'reliability'
    };

function initializeMetricTrends() {
    // Check if data exists for trend generation
    const allWeeks = Object.keys(weeklyData).concat(Object.keys(typeof ytdData !== 'undefined' ? ytdData : {}));
    const statusDiv = document.getElementById('metricTrendsStatus');

    if (allWeeks.length === 0) {
        // Show warning message
        if (statusDiv) statusDiv.style.display = 'block';
    } else {
        // Hide warning message
        if (statusDiv) statusDiv.style.display = 'none';
    }

    // Don't auto-set dates - let user select a period first
    const avgWeekMonday = document.getElementById('avgWeekMonday');
    const avgWeekSunday = document.getElementById('avgWeekSunday');

    // Auto-calculate Sunday when Monday changes (safe date parsing)
    if (avgWeekMonday && !avgWeekMonday.dataset.bound) {
    avgWeekMonday.dataset.bound = 'true';
    avgWeekMonday.addEventListener('change', (e) => {
        const dateStr = e.target.value;
        if (!dateStr || !avgWeekSunday) return;

        // Parse date safely to avoid timezone issues
        const [year, month, day] = dateStr.split('-').map(Number);
        const monday = new Date(year, month - 1, day);

        if (!isNaN(monday.getTime())) {
            const sunday = new Date(year, month - 1, day + 6);
            const fmt = window.DevCoachModules?.sharedUtils?.formatLocalDate;
            avgWeekSunday.value = typeof fmt === 'function' ? fmt(sunday) : sunday.toISOString().split('T')[0];
        }
    });
    }

    // Toggle metrics form visibility
    const avgMetricsForm = document.getElementById('avgMetricsForm');
    const toggleAvgMetricsBtn = document.getElementById('toggleAvgMetricsBtn');

    // Ensure form starts collapsed
    if (avgMetricsForm) {
        avgMetricsForm.style.display = 'none';
    }
    if (toggleAvgMetricsBtn) {
        toggleAvgMetricsBtn.textContent = '✏️ Edit Averages';
        // Remove any existing click handlers to prevent duplicates
        const oldBtn = toggleAvgMetricsBtn.cloneNode(true);
        toggleAvgMetricsBtn.parentNode.replaceChild(oldBtn, toggleAvgMetricsBtn);
        oldBtn.addEventListener('click', () => {
            if (avgMetricsForm) {
                const isVisible = avgMetricsForm.style.display !== 'none';
                avgMetricsForm.style.display = isVisible ? 'none' : 'block';
                oldBtn.textContent = isVisible ? '✏️ Edit Averages' : '✏️ Hide Averages';
            }
        });
    }

    // Show target hints on Call Center Averages metric inputs
    renderCallCenterAverageTargets();



    // Populate uploaded data dropdown (refresh on every visit so new uploads
    // appear in the dropdown). Listener attachment happens once below.
    populateUploadedDataDropdown();

    // Populate trend generation dropdowns (starts with blank selections)
    populateTrendPeriodDropdown();
    initializeEmployeeDropdown();

    // Listener attachment is one-shot — these functions call addEventListener
    // on persistent index.html elements with no per-call cleanup, so calling
    // them twice was stacking handlers (duplicate emails after re-visiting
    // the section). Guard with a module-level flag.
    if (!metricTrendsListenersBound) {
        metricTrendsListenersBound = true;
        setupUploadedDataListener();
        setupAveragesLoader();
        setupMetricTrendsListeners();
    }

    // Inline listener: Save Call Center Averages button
    const saveAvgBtn = document.getElementById('saveAvgBtn');
    if (saveAvgBtn && !saveAvgBtn.dataset.bound) {
    saveAvgBtn.dataset.bound = 'true';
    saveAvgBtn.addEventListener('click', () => {
        const weekKey = document.getElementById('avgUploadedDataSelect')?.value;

        if (!weekKey) {
            alert('⚠️ Please select a period first');
            return;
        }

        const averageData = readAveragesFromForm();

        setCallCenterAverageForPeriod(weekKey, averageData);
        clearUnsavedChanges();
        showToast('✅ Call center averages saved!', 3000);
    });
    }

    // Inline listener: Copy from Previous Week button
    const copyPreviousAvgBtn = document.getElementById('copyPreviousAvgBtn');
    if (copyPreviousAvgBtn && !copyPreviousAvgBtn.dataset.bound) {
    copyPreviousAvgBtn.dataset.bound = 'true';
    copyPreviousAvgBtn.addEventListener('click', () => {
        const currentWeekKey = document.getElementById('avgUploadedDataSelect')?.value;

        if (!currentWeekKey) {
            alert('⚠️ Please select a period first');
            return;
        }

        const previousWeekKey = getPreviousWeekKey(currentWeekKey);
        if (!previousWeekKey) {
            alert('ℹ️ No previous week found');
            return;
        }

        const previousAverages = getCallCenterAverageForPeriod(previousWeekKey);

        if (!previousAverages || Object.keys(previousAverages).length === 0) {
            alert('ℹ️ No averages found for previous week');
            return;
        }

        // Copy all values
        applyAveragesToForm(previousAverages);

        markUnsavedChanges();
        showToast('✅ Copied from previous week! Click Save to apply.', 4000);
    });
    }
}

function renderCallCenterAverageTargets() {
    const avgToMetricMap = {
        avgAdherence: 'scheduleAdherence',
        avgOverallExperience: 'overallExperience',
        avgRepSatisfaction: 'cxRepOverall',
        avgFCR: 'fcr',
        avgTransfers: 'transfers',
        avgSentiment: 'overallSentiment',
        avgPositiveWord: 'positiveWord',
        avgNegativeWord: 'negativeWord',
        avgManagingEmotions: 'managingEmotions',
        avgAHT: 'aht',
        avgACW: 'acw',
        avgHoldTime: 'holdTime',
        avgReliability: 'reliability'
    };

    const formatTargetLabel = (metricKey) => {
        const metric = METRICS_REGISTRY[metricKey];
        if (!metric || !metric.target) return null;

        const operator = metric.target.type === 'min' ? '≥' : '≤';
        const unit = metric.unit === 'sec'
            ? 's'
            : metric.unit === 'hrs'
                ? ' hrs'
                : (metric.unit || '');

        return `Target: ${operator}${metric.target.value}${unit}`;
    };

    const formatTargetSuffix = (metricKey) => {
        const metric = METRICS_REGISTRY[metricKey];
        if (!metric || !metric.target) return null;

        const operator = metric.target.type === 'min' ? '≥' : '≤';
        const unit = metric.unit === 'sec'
            ? 's'
            : metric.unit === 'hrs'
                ? ' hrs'
                : (metric.unit || '');

        return `(${operator}${metric.target.value}${unit})`;
    };

    Object.entries(avgToMetricMap).forEach(([inputId, metricKey]) => {
        const input = document.getElementById(inputId);
        if (!input || !input.parentElement) return;

        const hintId = `${inputId}TargetHint`;
        let hint = document.getElementById(hintId);
        const targetText = formatTargetLabel(metricKey);
        const targetSuffix = formatTargetSuffix(metricKey);
        const label = input.parentElement.querySelector('label');

        if (label && targetSuffix) {
            if (!label.dataset.baseLabel) {
                label.dataset.baseLabel = label.textContent.replace(/\s*\(.*\)\s*:\s*$/, '').trim();
            }
            label.textContent = `${label.dataset.baseLabel} ${targetSuffix}:`;
        }

        if (!targetText) return;

        if (!hint) {
            hint = document.createElement('div');
            hint.id = hintId;
            hint.style.fontSize = '0.8em';
            hint.style.color = '#666';
            hint.style.marginTop = '4px';
            input.insertAdjacentElement('afterend', hint);
        }

        hint.textContent = targetText;
    });
}

function populateTrendPeriodDropdown() {
    const trendPeriodSelect = document.getElementById('trendPeriodSelect');
    const selectedPeriodType = document.querySelector('input[name="trendPeriodType"]:checked')?.value || 'week';

    if (!trendPeriodSelect) {

        return;
    }


    const sourceData = trendSourceForPeriodType(selectedPeriodType);
    const allWeeks = Object.keys(sourceData).sort().reverse(); // Most recent first

    if (allWeeks.length === 0) {
        trendPeriodSelect.innerHTML = '<option value="">No data available</option>';
        return;
    }

    // Filter by period type
    const filteredPeriods = allWeeks.filter(weekKey => {
        const week = sourceData[weekKey];
        const periodType = week.metadata?.periodType || 'week';
        return periodType === selectedPeriodType;
    });

    if (filteredPeriods.length === 0) {
        trendPeriodSelect.innerHTML = `<option value="">No ${selectedPeriodType} data available</option>`;
        return;
    }

    // Build options
    let options = '<option value="">Select Period...</option>';
    filteredPeriods.forEach(weekKey => {
        const week = sourceData[weekKey];
        const displayText = week.metadata?.label || weekKey;
        options += `<option value="${weekKey}">${displayText}</option>`;
    });

    trendPeriodSelect.innerHTML = options;

    // Re-mounted with the options, since a chip is only offered when this list
    // actually holds the upload behind it.
    window.DevCoachModules?.periodPicker?.mountAboveSelect(trendPeriodSelect, {
        id: 'trendPeriodChips',
        chipClass: 'mt-period-chip'
    });

    // Restore the last selected period, or open on the newest upload. The
    // associate list is built from the chosen period, so leaving the period
    // blank left the list empty and nobody could be picked.
    const savedPeriod = localStorage.getItem(LAST_TREND_PERIOD_KEY);
    const openOn = savedPeriod && filteredPeriods.includes(savedPeriod) ? savedPeriod : filteredPeriods[0];
    trendPeriodSelect.value = openOn;
    populateEmployeeDropdownForPeriod(openOn);

    // Add change listener to filter employees by selected period
    if (!trendPeriodSelect.dataset.bound) {
        trendPeriodSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val) localStorage.setItem(LAST_TREND_PERIOD_KEY, val);
            populateEmployeeDropdownForPeriod(val);
        });
        trendPeriodSelect.dataset.bound = 'true';
    }
}


/**
 * The store a period type actually lives in.
 *
 * Daily uploads go to their own store (script.js getPeriodDataStore, and the
 * save path at script.js:2901). This module only ever chose between ytdData
 * and weeklyData, so picking "Daily" filtered weeklyData for a period type
 * the write path never puts there and always came back empty. The radio has
 * been on the page the whole time.
 */
function trendSourceForPeriodType(periodType) {
    if (periodType === 'ytd') return ytdData;
    if (periodType === 'daily') {
        if (typeof dailyData !== 'undefined' && dailyData) return dailyData;
        return window.DevCoachModules?.storage?.loadDailyData?.() || {};
    }
    return weeklyData;
}

function initializeEmployeeDropdown() {
    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
    if (trendEmployeeSelect) {
        window.DevCoachModules.associatePicker.populateSelect(trendEmployeeSelect, []);
    }
}

function populateEmployeeDropdownForPeriod(weekKey) {
    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');

    if (!trendEmployeeSelect) {
        return;
    }

    if (!weekKey) {
        // No period selected, show blank option only
        window.DevCoachModules.associatePicker.populateSelect(trendEmployeeSelect, []);
        updateTrendButtonsVisibility();
        return;
    }

    // Get employees only for selected period.
    //
    // dailyData included, because the Daily period type offers periods from it.
    // Without it the period dropdown filled correctly and the associate
    // dropdown beside it always read "No employees in this period", so the
    // Daily option on Metric Charts could be selected and never used. Same
    // three-store fallthrough as script.js getTrendPeriodRecord.
    const dailies = trendSourceForPeriodType('daily');
    const periodData = ytdData[weekKey] || weeklyData[weekKey] || dailies[weekKey];
    if (!periodData || !periodData.employees) {
        // Keeps its own wording: "no employees in this period" tells the reader why
        // the list is empty, which the generic placeholder would not.
        window.DevCoachModules.associatePicker.populateSelect(trendEmployeeSelect, [], { placeholder: 'No employees in this period' });
        updateTrendButtonsVisibility();
        return;
    }

    const teamFilterContext = getTeamSelectionContext();
    const employees = periodData.employees
        .filter(emp => isAssociateIncludedByTeamFilter(emp?.name, teamFilterContext))
        .map(emp => emp.name)
        .sort();

    // The team summary has its own panel in Center > Trends, so this picker
    // names people only.
    window.DevCoachModules.associatePicker.populateSelect(trendEmployeeSelect, employees);

    updateTrendButtonsVisibility();
}

function populateTrendSentimentDropdown(employeeName) {
    const sentimentDropdown = document.getElementById('trendSentimentSelect');

    if (!sentimentDropdown) return;

    // Reset to default
    sentimentDropdown.innerHTML = '<option value="">-- No sentiment data --</option>';

    // If no employee or "ALL" selected, just show default
    if (!employeeName || employeeName === 'ALL') {
        return;
    }

    // Get sentiment snapshots for this employee
    const snapshots = associateSentimentSnapshots[employeeName];

    if (!snapshots || !Array.isArray(snapshots) || snapshots.length === 0) {
        return;
    }

    // Get the currently selected period/week so we can pull percentages from that week
    const selectedWeekKey = document.getElementById('trendPeriodSelect')?.value;
    const selectedPeriodType = document.querySelector('input[name="trendPeriodType"]:checked')?.value || 'week';
    const sourceData = trendSourceForPeriodType(selectedPeriodType);
    const selectedWeek = selectedWeekKey ? (sourceData[selectedWeekKey] || {}) : {};

    // Get the employee's data from the selected week
    let empDataInSelectedWeek = null;
    if (selectedWeek.employees) {
        empDataInSelectedWeek = selectedWeek.employees.find(e => e.name === employeeName);
    }

    // Sort by date (most recent first)
    const sortedSnapshots = [...snapshots].sort((a, b) => {
        const dateA = new Date(a.savedAt || a.timeframeEnd);
        const dateB = new Date(b.savedAt || b.timeframeEnd);
        return dateB - dateA;
    });

    // Build options
    sortedSnapshots.forEach((snapshot, index) => {
        const timeframe = `${snapshot.timeframeStart} to ${snapshot.timeframeEnd}`;

        // Use percentages from the selected week if available, otherwise 0
        const negScore = empDataInSelectedWeek?.negativeWord || 0;
        const posScore = empDataInSelectedWeek?.positiveWord || 0;
        const emoScore = empDataInSelectedWeek?.managingEmotions || 0;

        const label = `${timeframe} (${negScore}% avoiding negative, ${posScore}% using positive, ${emoScore}% managing emotions)`;
        const value = `${snapshot.timeframeStart}|${snapshot.timeframeEnd}`; // Use timeframe as value

        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        sentimentDropdown.appendChild(option);
    });
}

function getAverageValueFromSource(source, key) {
    if (!source || typeof source !== 'object') return '';
    const direct = source[key];
    if (direct !== undefined && direct !== null) return direct;
    const nested = source.data ? source.data[key] : undefined;
    return nested !== undefined && nested !== null ? nested : '';
}

function applyAveragesToForm(source) {
    Object.entries(AVERAGE_FORM_FIELD_MAP).forEach(([avgKey, inputId]) => {
        const input = document.getElementById(inputId);
        if (!input) return;
        input.value = getAverageValueFromSource(source, avgKey);
    });
}

function getPreviousWeekKey(currentWeekKey) {
    const allKeys = Object.keys(weeklyData).concat(Object.keys(typeof ytdData !== 'undefined' ? ytdData : {})).sort();
    const currentIndex = allKeys.indexOf(currentWeekKey);
    if (currentIndex <= 0) return null;
    return allKeys[currentIndex - 1] || null;
}

function readAveragesFromForm() {
    const averageData = {};
    const headcount = parseInt(document.getElementById('avgCenterHeadcount')?.value, 10) || 0;

    Object.entries(AVERAGE_FORM_FIELD_MAP).forEach(([avgKey, inputId]) => {
        const parsed = parseFloat(document.getElementById(inputId)?.value);
        if (avgKey === 'reliability' && headcount > 0 && Number.isFinite(parsed)) {
            // Auto-divide total center hours by headcount
            averageData[avgKey] = Math.round((parsed / headcount) * 100) / 100;
        } else {
            averageData[avgKey] = Number.isFinite(parsed) ? parsed : 0;
        }
    });
    return averageData;
}

function setupAveragesLoader() {
    const avgPeriodType = document.getElementById('avgPeriodType');
    const avgWeekMonday = document.getElementById('avgWeekMonday');

    if (!avgPeriodType || !avgWeekMonday) return;

    const loadAveragesForPeriod = () => {
        const periodType = avgPeriodType.value;
        const mondayDate = avgWeekMonday.value;

        if (!mondayDate) return;

        // Create storage key from period type and Monday date
        const storageKey = `${mondayDate}_${periodType}`;
        const averages = getCallCenterAverageForPeriod(storageKey);

        applyAveragesToForm(averages);
    };

    avgPeriodType.addEventListener('change', loadAveragesForPeriod);
    avgWeekMonday.addEventListener('change', loadAveragesForPeriod);
}

function populateUploadedDataDropdown() {

    const avgUploadedDataSelect = document.getElementById('avgUploadedDataSelect');
    const selectedPeriodType = document.querySelector('input[name="trendPeriodType"]:checked')?.value || 'week';

    if (!avgUploadedDataSelect) return;


    const sourceData = trendSourceForPeriodType(selectedPeriodType);
    const allWeeks = Object.keys(sourceData).sort().reverse(); // Most recent first

    if (allWeeks.length === 0) {
        avgUploadedDataSelect.innerHTML = '<option value="">-- No uploaded data available --</option>';
        return;
    }

    // Filter by period type
    const filteredPeriods = allWeeks.filter(weekKey => {
        const week = sourceData[weekKey];
        const periodType = week.metadata?.periodType || 'week';
        return periodType === selectedPeriodType;
    });

    if (filteredPeriods.length === 0) {
        avgUploadedDataSelect.innerHTML = `<option value="">No ${selectedPeriodType} data available</option>`;
        return;
    }

    // Build options
    let options = '<option value="">-- Choose a period from your data --</option>';
    filteredPeriods.forEach(weekKey => {
        const week = sourceData[weekKey];
        const displayText = week.metadata?.label || week.week_start || weekKey;
        options += `<option value="${weekKey}">${displayText}</option>`;
    });

    avgUploadedDataSelect.innerHTML = options;

}

function setupUploadedDataListener() {
    const avgUploadedDataSelect = document.getElementById('avgUploadedDataSelect');
    avgUploadedDataSelect?.addEventListener('change', (e) => {
        const weekKey = e.target.value;
        displayCallCenterAverages(weekKey);

        // Auto-sync to Metric Trends section
        if (weekKey) {
            const trendPeriodSelect = document.getElementById('trendPeriodSelect');
            if (trendPeriodSelect) {
                trendPeriodSelect.value = weekKey;
                trendPeriodSelect.dispatchEvent(new Event('change'));

            }
        }
    });
}

function displayCallCenterAverages(weekKey) {
    const avgMetricsForm = document.getElementById('avgMetricsForm');
    const periodTypeField = document.getElementById('avgPeriodType');
    const mondayField = document.getElementById('avgWeekMonday');
    const sundayField = document.getElementById('avgWeekSunday');

    const periodData = weeklyData[weekKey] || ytdData[weekKey];
    if (!weekKey || !periodData) {
        // Keep form hidden when no period selected
        if (avgMetricsForm && avgMetricsForm.style.display !== 'none') {
            // Don't hide if it was already visible - user might have it open
        } else {
            if (avgMetricsForm) avgMetricsForm.style.display = 'none';
        }
        periodTypeField.value = '';
        mondayField.value = '';
        sundayField.value = '';
        return;
    }

    const week = periodData;
    const metadata = week.metadata || {};

    // Load period info into hidden fields (don't show toast)
    periodTypeField.value = metadata.periodType || 'week';
    mondayField.value = metadata.startDate || '';
    sundayField.value = metadata.endDate || '';

    // Get saved averages for this period
    const centerAvg = getCallCenterAverageForPeriod(weekKey);

    // Load the averages into the form (or clear if none)
    applyAveragesToForm(centerAvg);

    // Don't auto-expand the form - let user click "Edit Averages" button
    // Form expansion is controlled by toggleAvgMetricsBtn only
}

function updateTrendButtonsVisibility() {
    const employeeDropdown = document.getElementById('trendEmployeeSelect');
    const generateTrendBtn = document.getElementById('generateTrendBtn');
    const selectedValue = employeeDropdown?.value || '';

    applyTrendButtonVisibility(selectedValue, generateTrendBtn);
}

// Send Metrics and Coaching Follow-up are for one person, so they show once
// someone is picked.
function applyTrendButtonVisibility(selectedValue, generateTrendBtn) {
    const coachingFollowupBtn = document.getElementById('generateCoachingFollowupBtn');
    const show = selectedValue && selectedValue !== 'ALL' ? 'block' : 'none';
    if (generateTrendBtn) generateTrendBtn.style.display = show;
    if (coachingFollowupBtn) coachingFollowupBtn.style.display = show;
}

function updateReliabilityCalcPreview() {
    const calcDiv = document.getElementById('avgReliabilityCalc');
    if (!calcDiv) return;
    const totalHours = parseFloat(document.getElementById('avgReliability')?.value);
    const headcount = parseInt(document.getElementById('avgCenterHeadcount')?.value, 10);
    if (Number.isFinite(totalHours) && headcount > 0) {
        const perPerson = (totalHours / headcount).toFixed(2);
        calcDiv.textContent = `= ${perPerson} hrs/person (${totalHours} ÷ ${headcount})`;
    } else {
        calcDiv.textContent = '';
    }
}

function setupMetricTrendsListeners() {
    // Live preview for reliability ÷ headcount
    document.getElementById('avgReliability')?.addEventListener('input', updateReliabilityCalcPreview);
    document.getElementById('avgCenterHeadcount')?.addEventListener('input', updateReliabilityCalcPreview);

    // Add event listeners to period type radio buttons
    const periodTypeRadios = document.querySelectorAll('input[name="trendPeriodType"]');
    periodTypeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            const selectedType = radio.value;

            // Update both dropdowns
            populateUploadedDataDropdown(); // Call Center Average dropdown
            populateTrendPeriodDropdown(); // Metric Trends dropdown

            // Clear employee selection
            window.DevCoachModules.associatePicker.populateSelect(document.getElementById('trendEmployeeSelect'), []);
            updateTrendButtonsVisibility();
        });
    });

    // Add listener to employee dropdown to show metrics preview
    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
    if (trendEmployeeSelect) {
        trendEmployeeSelect.addEventListener('change', (e) => {
            const employeeName = e.target.value;
            const weekKey = document.getElementById('trendPeriodSelect')?.value;
            const nicknameInput = document.getElementById('trendNickname');

            // Populate sentiment dropdown for selected employee
            populateTrendSentimentDropdown(employeeName);

            if (nicknameInput) {
                if (!employeeName || employeeName === 'ALL') {
                    nicknameInput.value = '';
                    nicknameInput.placeholder = 'How to address them in the email (e.g., "John")';
                } else {
                    const savedNickname = getSavedNickname(employeeName);
                    const defaultNickname = getEmployeeNickname(employeeName) || '';
                    nicknameInput.value = savedNickname || defaultNickname || '';
                    nicknameInput.placeholder = 'How to address them in the email';
                }
            }

            if (employeeName === 'ALL') {
                document.getElementById('metricsPreviewSection').style.display = 'none';
                updateTrendButtonsVisibility();
                return;
            }

            if (employeeName && weekKey) {
                displayMetricsPreview(employeeName, weekKey);
            } else {
                document.getElementById('metricsPreviewSection').style.display = 'none';
            }

            updateTrendButtonsVisibility();
        });
    }

    // Generate trend email buttons
    const generateTrendBtn = document.getElementById('generateTrendBtn');
    const generateTeamTrendBtn = document.getElementById('generateTeamTrendBtn');
    const saveMetricsPreviewBtn = document.getElementById('saveMetricsPreviewBtn');

    if (!generateTrendBtn) {
        console.error('generateTrendBtn element not found!');
    } else {
        generateTrendBtn.addEventListener('click', generateTrendEmail);
    }

    const coachingFollowupBtn = document.getElementById('generateCoachingFollowupBtn');
    if (coachingFollowupBtn) {
        coachingFollowupBtn.addEventListener('click', generateCoachingFollowup);
    }


    if (!generateTeamTrendBtn) {
        console.error('generateTeamTrendBtn element not found!');
    } else {
        generateTeamTrendBtn.addEventListener('click', generateTeamTrendSummary);
    }

    if (saveMetricsPreviewBtn) {
        saveMetricsPreviewBtn.addEventListener('click', saveMetricsPreviewEdits);
    }

    // Ensure buttons are correctly shown on initial load
    updateTrendButtonsVisibility();

}

function displayMetricsPreview(employeeName, weekKey) {
    const metricsPreviewSection = document.getElementById('metricsPreviewSection');
    const metricsPreviewGrid = document.getElementById('metricsPreviewGrid');
    const metricsPreviewSurveyCount = document.getElementById('metricsPreviewSurveyCount');

    if (!metricsPreviewSection || !metricsPreviewGrid) return;

    const periodData = ytdData[weekKey] || weeklyData[weekKey];
    if (!periodData || !periodData.employees) return;

    const employee = periodData.employees.find(emp => emp.name === employeeName);
    if (!employee) return;

    metricsPreviewSection.dataset.employee = employeeName;
    metricsPreviewSection.dataset.period = weekKey;

    const surveyTotal = Number.isFinite(parseInt(employee.surveyTotal, 10)) ? parseInt(employee.surveyTotal, 10) : 0;
    const periodType = String(periodData?.metadata?.periodType || 'period').toLowerCase();
    const periodTypeLabel = periodType === 'daily' ? 'day' : periodType === 'week' ? 'week' : periodType === 'week-in-progress' ? 'partial week' : periodType === 'month' ? 'month' : periodType === 'quarter' ? 'quarter' : periodType === 'ytd' ? 'YTD period' : 'period';
    const periodLabel = String(periodData?.metadata?.label || weekKey || '').trim();
    if (metricsPreviewSurveyCount) {
        metricsPreviewSurveyCount.textContent = `Surveys in loaded ${periodTypeLabel}: ${surveyTotal}${periodLabel ? ` • ${periodLabel}` : ''}`;
    }



    // Define metrics to show
    const metricsToPreview = [
        { key: 'scheduleAdherence', label: 'Schedule Adherence', unit: '%' },
        { key: 'overallExperience', label: 'Overall Experience', unit: '%' },
        { key: 'cxRepOverall', label: 'Rep Satisfaction', unit: '%' },
        { key: 'fcr', label: 'FCR', unit: '%' },
        { key: 'transfers', label: 'Transfers', unit: '%' },
        { key: 'overallSentiment', label: 'Sentiment Score', unit: '%' },
        { key: 'positiveWord', label: 'Positive Word Usage', unit: '%' },
        { key: 'negativeWord', label: 'Avoiding Negative Words', unit: '%' },
        { key: 'managingEmotions', label: 'Managing Emotions', unit: '%' },
        { key: 'aht', label: 'Average Handle Time', unit: 's' },
        { key: 'acw', label: 'After Call Work', unit: 's' },
        { key: 'holdTime', label: 'Hold Time', unit: 's' },
        { key: 'reliability', label: 'Reliability', unit: 'hrs' }
    ];

    // Generate HTML for each metric with target values like call center averages
    let html = '';
    metricsToPreview.forEach(metric => {
        const rawValue = employee[metric.key] !== undefined ? employee[metric.key] : '';
        const registryMetric = METRICS_REGISTRY[metric.key];
        const target = registryMetric?.target?.value;
        const targetType = registryMetric?.target?.type;
        const isWholeNumberMetric = metric.key === 'aht' || metric.key === 'acw' || metric.key === 'holdTime';
        const isTenthsMetric = !isWholeNumberMetric;

        let value = rawValue;
        if (isWholeNumberMetric && rawValue !== '' && rawValue !== null && rawValue !== undefined) {
            const numericValue = parseFloat(rawValue);
            value = Number.isFinite(numericValue) ? Math.round(numericValue) : rawValue;
        } else if (isTenthsMetric && rawValue !== '' && rawValue !== null && rawValue !== undefined) {
            const numericValue = parseFloat(rawValue);
            value = Number.isFinite(numericValue) ? numericValue.toFixed(1) : rawValue;
        }

        // Build target hint like call center averages do
        let targetHint = '';
        if (target !== undefined && targetType) {
            const targetSymbol = targetType === 'min' ? '≥' : '≤';
            targetHint = ` (Target: ${targetSymbol} ${target}${metric.unit})`;
        }

        html += `
            <div>
                <label style="font-weight: bold; display: block; margin-bottom: 3px; font-size: 0.85em;">${metric.label} (${metric.unit})${targetHint}:</label>
                <input type="number" class="metric-preview-input" data-metric="${metric.key}" step="${isWholeNumberMetric ? '1' : '0.1'}" value="${value}" style="width: 100%; padding: 6px; border: 1px solid var(--border); border-radius: 4px;">
            </div>
        `;
    });

    metricsPreviewGrid.innerHTML = html;
    metricsPreviewSection.style.display = 'block';
}

function saveMetricsPreviewEdits() {
    const metricsPreviewSection = document.getElementById('metricsPreviewSection');
    if (!metricsPreviewSection) return;

    const employeeName = metricsPreviewSection.dataset.employee || document.getElementById('trendEmployeeSelect')?.value;
    const weekKey = metricsPreviewSection.dataset.period || document.getElementById('trendPeriodSelect')?.value;

    if (!employeeName || !weekKey) {
        showToast('Please select both period and employee', 4000);
        return;
    }

    const periodData = ytdData[weekKey] || weeklyData[weekKey];
    if (!periodData || !periodData.employees) {
        showToast('No data found for selected period', 4000);
        return;
    }

    const employee = periodData.employees.find(emp => emp.name === employeeName);
    if (!employee) {
        showToast('Employee not found for selected period', 4000);
        return;
    }

    const inputs = metricsPreviewSection.querySelectorAll('.metric-preview-input');
    let updatedCount = 0;
    inputs.forEach(input => {
        const metricKey = input.dataset.metric;
        if (!metricKey) return;
        const rawValue = input.value.trim();
        if (rawValue === '') return;
        const parsed = parseFloat(rawValue);
        if (Number.isNaN(parsed)) return;
        employee[metricKey] = parsed;
        updatedCount += 1;
    });

    if (ytdData[weekKey]) {
        saveYtdData();
    } else {
        saveWeeklyData();
    }

    showToast(updatedCount > 0 ? '✅ Metrics saved' : 'No changes to save', 3000);
}

/**
 * Analyzes employee metrics to identify performance gaps and trends.
 * Compares individual achievements against targets and team center averages.
 *
 * @param {Object} employeeData - Employee's current metric values
 *   Keys: scheduleAdherence, overallExperience, fcr, transfers, aht, acw, etc.
 * @param {Object} centerAverages - Team's center average values for comparison
 * @returns {Object} Analysis result with structure:
 *   {weakest: Metric, trendingDown: Metric | null, allMetrics: Array}
 *   weakest = furthest from target
 *   trendingDown = random metric not meeting target (for variety week-to-week)
 *
 * @example
 * const analysis = analyzeTrendMetrics(empData, centerAvgs);
 * if (analysis.weakest) console.log(`Weakest: ${analysis.weakest.label}`);
 * if (analysis.trendingDown) console.log(`Random focus: ${analysis.trendingDown.label}`);
 */

    // Opens the Copilot tab inside the click, then copies, then reports what
    // actually happened. See sharedUtils.copyPromptAndOpenCopilot.
    function handOffToCopilot(text, options) {
        return window.DevCoachModules.sharedUtils.copyPromptAndOpenCopilot(text, options);
    }

    // Still needed here for the prompt panel, which links to Copilot in text
    // rather than opening it.
    function copilotUrl() {
        return window.DevCoachModules.sharedUtils.copilotUrl();
    }

function getMetricBandByUnit(metricKey, bands = { percent: 2, sec: 15, hrs: 1, fallback: 2 }) {
    const unit = METRICS_REGISTRY[metricKey]?.unit;
    if (unit === 'sec') return bands.sec;
    if (unit === 'hrs') return bands.hrs;
    if (unit === '%') return bands.percent;
    return bands.fallback;
}

function resolveMetricTrendDirection(metricKey, currentValue, previousValue) {
    // Owned by metric-movement so the polarity rule lives in one place. Same
    // bands as before; only the home moved.
    const movement = window.DevCoachModules?.metricMovement;
    if (movement) {
        const r = movement.resolveDirection(metricKey, currentValue, previousValue);
        return { delta: r.hasPrior ? r.delta : null, direction: r.direction };
    }

    const prev = parseFloat(previousValue);
    if (!Number.isFinite(prev)) return { delta: null, direction: 'stable' };
    const delta = metricDelta(metricKey, currentValue, prev);
    const stableBand = getMetricBandByUnit(metricKey, { percent: 1, sec: 8, hrs: 0.5, fallback: 1 });
    if (Math.abs(delta) < stableBand) return { delta, direction: 'stable' };
    return { delta, direction: delta > 0 ? 'improving' : 'declining' };
}

function getMetricVolatilityDetails(employeeName, metricKey, weekKey, periodType = 'week') {
    if (!employeeName || !weekKey) return null;

    const keys = getWeeklyKeysSorted().filter(key => {
        const metaType = weeklyData[key]?.metadata?.periodType || 'week';
        return metaType === periodType;
    });
    const idx = keys.indexOf(weekKey);
    if (idx < 0) return null;

    const sampleKeys = keys.slice(Math.max(0, idx - 3), idx + 1);
    const values = sampleKeys
        .map(key => {
            const period = weeklyData[key];
            const emp = period?.employees?.find(e => e.name === employeeName);
            const value = parseFloat(emp?.[metricKey]);
            return Number.isFinite(value) ? value : null;
        })
        .filter(v => v !== null);

    if (values.length < 3) return null;

    const deltas = [];
    for (let i = 1; i < values.length; i++) {
        deltas.push(metricDelta(metricKey, values[i], values[i - 1]));
    }

    if (!deltas.length) return null;

    const avgSwing = deltas.reduce((sum, d) => sum + Math.abs(d), 0) / deltas.length;
    const directionBand = getMetricBandByUnit(metricKey, { percent: 1, sec: 8, hrs: 0.5, fallback: 1 });
    let signChanges = 0;
    let lastSign = 0;

    deltas.forEach(delta => {
        if (Math.abs(delta) < directionBand) return;
        const sign = delta > 0 ? 1 : -1;
        if (lastSign !== 0 && sign !== lastSign) signChanges += 1;
        lastSign = sign;
    });

    const volatilityBand = getMetricBandByUnit(metricKey, { percent: 2.5, sec: 18, hrs: 1.1, fallback: 2.5 });
    const isVolatile = avgSwing >= volatilityBand || signChanges >= 2;

    return {
        isVolatile,
        avgSwing,
        signChanges,
        sampleSize: values.length
    };
}

function classifyTrendMetric(metric) {
    const margin = metric.targetType === 'min'
        ? metric.employeeValue - metric.target
        : metric.target - metric.employeeValue;
    const nearBand = getMetricBandByUnit(metric.metricKey, { percent: 2, sec: 20, hrs: 1, fallback: 2 });
    const exceedBand = getMetricBandByUnit(metric.metricKey, { percent: 4, sec: 35, hrs: 2, fallback: 4 });
    const watchDropBand = getMetricBandByUnit(metric.metricKey, { percent: 2, sec: 15, hrs: 1, fallback: 2 });

    if (metric.meetsTarget) {
        if (metric.trendDirection === 'declining' && (margin <= nearBand || Math.abs(metric.trendDelta || 0) >= watchDropBand)) {
            return 'Watch Area';
        }
        if (margin >= exceedBand || metric.trendDirection === 'improving') {
            return 'Exceeding Expectation';
        }
        return 'On Track';
    }

    if (metric.trendDirection === 'improving' && metric.gapFromTarget <= nearBand) {
        return 'Watch Area';
    }

    return 'Needs Focus';
}

function analyzeTrendMetrics(employeeData, centerAverages, reviewYear = null, previousEmployeeData = null, context = {}) {
    const allMetrics = [];
    const employeeName = context.employeeName || employeeData?.name;
    const weekKey = context.weekKey || null;
    const periodType = context.periodType || 'week';

    Object.entries(TREND_METRIC_MAPPINGS).forEach(([registryKey, csvKey]) => {
        const employeeValueRaw = parseFloat(employeeData[registryKey]);
        if (!Number.isFinite(employeeValueRaw)) return;
        const employeeValue = employeeValueRaw;
        const centerValue = parseFloat(centerAverages[csvKey]) || 0;
        const metric = METRICS_REGISTRY[registryKey];
        if (!metric) return;

        const target = getMetricTrendTarget(registryKey, reviewYear);
        const targetType = getMetricTrendTargetType(registryKey);
        const isReverse = isReverseMetric(registryKey);
        const meetsTarget = targetType === 'min'
            ? employeeValue >= target
            : employeeValue <= target;
        const isBelowCenter = centerValue > 0
            ? (isReverse ? employeeValue > centerValue : employeeValue < centerValue)
            : false;

        const previousValueRaw = previousEmployeeData ? parseFloat(previousEmployeeData[registryKey]) : NaN;
        const previousValue = Number.isFinite(previousValueRaw) ? previousValueRaw : null;
        const trendState = resolveMetricTrendDirection(registryKey, employeeValue, previousValue);
        const volatility = getMetricVolatilityDetails(employeeName, registryKey, weekKey, periodType);

        const metricRecord = {
            metricKey: registryKey,
            label: metric.label,
            employeeValue,
            centerValue,
            target,
            targetType,
            meetsTarget,
            isReverse,
            isBelowCenter,
            gap: Math.abs(employeeValue - centerValue),
            gapFromTarget: targetType === 'min'
                ? Math.max(0, target - employeeValue)
                : Math.max(0, employeeValue - target),
            previousValue,
            trendDelta: trendState.delta,
            trendDirection: trendState.direction,
            isVolatile: Boolean(volatility?.isVolatile),
            volatilityDetails: volatility,
            classification: 'On Track'
        };

        metricRecord.classification = classifyTrendMetric(metricRecord);
        allMetrics.push(metricRecord);
    });

    const { weakest, trendingDown } = pickWeakestAndTrending(allMetrics);

    return {
        weakest,
        trendingDown,
        allMetrics
    };
}

// The riskiest metric, and the riskiest other one that is slipping. Split out
// of analyzeTrendMetrics so a filtered list can be ranked the same way.
function pickWeakestAndTrending(allMetrics) {
    const list = Array.isArray(allMetrics) ? allMetrics : [];
    const weakest = list.length > 0
        ? [...list].sort((a, b) => {
            const riskA = (a.gapFromTarget || 0) + (a.trendDirection === 'declining' ? getMetricBandByUnit(a.metricKey, { percent: 2, sec: 15, hrs: 1, fallback: 2 }) : 0);
            const riskB = (b.gapFromTarget || 0) + (b.trendDirection === 'declining' ? getMetricBandByUnit(b.metricKey, { percent: 2, sec: 15, hrs: 1, fallback: 2 }) : 0);
            return riskB - riskA;
        })[0]
        : null;

    const decliningCandidates = list
        .filter(m => m.metricKey !== weakest?.metricKey)
        .filter(m => m.trendDirection === 'declining' || m.classification === 'Watch Area' || m.classification === 'Needs Focus')
        .sort((a, b) => {
            const riskA = (a.gapFromTarget || 0) + Math.abs(a.trendDelta || 0);
            const riskB = (b.gapFromTarget || 0) + Math.abs(b.trendDelta || 0);
            return riskB - riskA;
        });

    return {
        weakest,
        trendingDown: decliningCandidates.length > 0 ? decliningCandidates[0] : null
    };
}

/*
 * WHAT A TREND MESSAGE MAY TALK ABOUT
 *
 * Scott, 2026-10-14. Two kinds of number reached associates that should not
 * have:
 *
 *   A survey metric nobody answered. It arrives as 0, and a zero-survey
 *   associate was told "Rep Satisfaction: Currently 0, target is >= 82".
 *   The count is the metric's own (rep sat and FCR are answered separately
 *   from Overall Experience), the same map the team figures weigh by.
 *
 *   Reliability. A weekly row holds that week's hours, and "Reliability: 8
 *   (target met)" went out as a win. Reliability is the year's running total
 *   and is kept out of strengths and focus areas on every associate surface.
 *
 * analyzeTrendMetrics itself is left whole, because the morning pulse reads
 * it and gates its own way. The coaching paths filter here.
 */
const TREND_SURVEY_COUNT_FALLBACK = { cxRepOverall: 'repSurveyTotal', fcr: 'fcrSurveyTotal', overallExperience: 'surveyTotal' };

function trendHasSurveysBehind(employee, metricKey) {
    const weigh = window.DevCoachModules?.metricsRegistryHelpers?.getSurveyWeight || window.getSurveyWeight;
    if (typeof weigh === 'function') {
        const count = weigh(metricKey, employee);
        return count === null || count > 0;
    }
    const field = TREND_SURVEY_COUNT_FALLBACK[metricKey];
    if (!field) return true;
    const own = parseInt(employee?.[field], 10);
    const count = Number.isInteger(own) ? own : parseInt(employee?.surveyTotal, 10);
    return Number.isInteger(count) && count > 0;
}

function coachableTrendMetrics(allMetrics, employee, previousEmployee = null) {
    return (Array.isArray(allMetrics) ? allMetrics : [])
        .filter(m => m && m.metricKey !== 'reliability')
        .filter(m => !employee || trendHasSurveysBehind(employee, m.metricKey))
        .map(m => {
            // A previous period nobody answered is no baseline: "up 80 pts"
            // from an empty column is not a move.
            if (!previousEmployee || trendHasSurveysBehind(previousEmployee, m.metricKey)) return m;
            const quiet = { ...m, previousValue: null, trendDelta: null, trendDirection: 'stable' };
            quiet.classification = classifyTrendMetric(quiet);
            return quiet;
        });
}

// A change in the metric's own unit, spelled out: "1.1 points", "18
// seconds", "0.5 hours". A rate that moved from 95.1% to 96.2% moved 1.1
// points, not 1.1%, and "+1.1%" on the picture read as a percentage of
// something (Scott, 2026-10-14).
function formatTrendChange(metricKey, amount) {
    const size = Math.abs(Number(amount) || 0);
    const unit = METRICS_REGISTRY[metricKey]?.unit;
    const oneDecimal = size.toFixed(1).replace(/\.0$/, '');
    const plural = (count, word) => `${count} ${word}${count === '1' ? '' : 's'}`;
    if (unit === 'sec') return plural(String(Math.round(size)), 'second');
    if (unit === 'hrs') return plural(oneDecimal, 'hour');
    if (unit === '%') return plural(oneDecimal, 'point');
    return oneDecimal;
}

// "goal 93% or better", "goal 426s or lower".
function trendGoalPhrase(metricKey, target) {
    const lower = getMetricTrendTargetType(metricKey) === 'max';
    return `goal ${formatMetricDisplay(metricKey, target)} or ${lower ? 'lower' : 'better'}`;
}

function getShuffledCopy(items) {
    const shuffled = Array.isArray(items) ? [...items] : [];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function pickRandomItem(items) {
    const shuffled = getShuffledCopy(items);
    return shuffled.length > 0 ? shuffled[0] : null;
}

function pickRandomItems(items, count = 1) {
    return getShuffledCopy(items).slice(0, count);
}

function getRandomTipsForMetric(metricKey, count = 2) {
    /**
     * Get random tips for a specific metric
     * Handles both server-side hints and user tips
     */
    // Use the getMetricTips function from tips-module.js if available
    if (typeof getMetricTips === 'function') {
        const allTips = getMetricTips(metricKey);
        if (!allTips || allTips.length === 0) {
            return [];
        }

        return pickRandomItems(allTips, count);
    }

    return [];
}

function getTrendTipsForMetrics(weakestMetric, trendingMetric) {
    return {
        tipsForWeakest: weakestMetric ? getRandomTipsForMetric(weakestMetric.metricKey, 2) : [],
        tipsForTrending: trendingMetric ? getRandomTipsForMetric(trendingMetric.metricKey, 2) : []
    };
}

function getSelectedTrendSentimentSnapshot(employeeName) {
    const sentimentSelect = document.getElementById('trendSentimentSelect');
    const selectedSentiment = sentimentSelect?.value;
    if (!selectedSentiment) return null;

    const [startDate, endDate] = selectedSentiment.split('|');
    const snapshots = associateSentimentSnapshots[employeeName];
    if (!Array.isArray(snapshots)) return null;

    const matchingSnapshot = snapshots.find(s => s.timeframeStart === startDate && s.timeframeEnd === endDate) || null;
    if (matchingSnapshot && window.DEBUG) {
        console.log('📊 Using selected sentiment snapshot:', matchingSnapshot);
    }
    return matchingSnapshot;
}

function resolveTrendEmailContext(employeeName, weekKey) {
    const period = weeklyData[weekKey];
    if (!period) {
        if (ytdData[weekKey]) {
            showToast('YTD period selected. Please select a weekly period for Metric Trends.', 5000);
        } else {
            showToast('No data found for this period', 5000);
        }
        return null;
    }

    const employee = period.employees.find(e => e.name === employeeName);
    if (!employee) {
        showToast('Employee not found in selected period', 5000);
        return null;
    }

    const currentPeriodType = period.metadata?.periodType || 'week';
    const prevPeriodKey = getPreviousPeriodData(weekKey, currentPeriodType);
    const prevPeriod = prevPeriodKey ? weeklyData[prevPeriodKey] : null;
    const prevEmployee = prevPeriod?.employees.find(e => e.name === employeeName);

    return {
        period,
        periodMeta: period.metadata || {},
        employee,
        prevEmployee
    };
}

function handleTrendEmailImageReady(
    employeeName,
    displayName,
    weakestMetric,
    trendingMetric,
    tipsForWeakest,
    tipsForTrending,
    weekKey,
    periodMeta,
    sentimentSnapshot,
    allMetrics
) {
    const emailSubject = buildTrendEmailSubject(periodMeta, displayName);

    if (DEBUG) {
        console.log('Opening Outlook with subject:', emailSubject);
    }

    openTrendEmailOutlook(emailSubject, employeeName);
    showToast('📧 Outlook opening... Image is copied to clipboard. Paste into email body, then use the prompt below for coaching text.', 4000);

    if (weakestMetric || trendingMetric) {
        showTrendsWithTipsPanel(
            employeeName,
            displayName,
            weakestMetric,
            trendingMetric,
            tipsForWeakest,
            tipsForTrending,
            weekKey,
            periodMeta,
            emailSubject,
            sentimentSnapshot,
            allMetrics
        );
    }
}

function getReviewYearFromEndDate(endDate) {
    return parseInt(String(endDate || '').split('-')[0], 10) || null;
}

function buildTrendEmailAnalysisBundle(employee, weekKey, period) {
    const centerAverages = getCallCenterAverageForPeriod(weekKey) || {};
    const reviewYear = getReviewYearFromEndDate(period?.metadata?.endDate);
    const prevPeriodKey = getPreviousPeriodData(weekKey, period?.metadata?.periodType || 'week');
    const prevPeriod = prevPeriodKey ? weeklyData[prevPeriodKey] : null;
    const previousEmployee = prevPeriod?.employees?.find(e => e.name === employee?.name) || null;
    const trendAnalysis = analyzeTrendMetrics(employee, centerAverages, reviewYear, previousEmployee, {
        employeeName: employee?.name,
        weekKey,
        periodType: period?.metadata?.periodType || 'week'
    });
    // Only what an associate message may talk about, ranked again among
    // themselves so a dropped metric cannot still be the "weakest".
    const allMetrics = coachableTrendMetrics(trendAnalysis.allMetrics, employee, previousEmployee);
    const { weakest: weakestMetric, trendingDown: trendingMetric } = pickWeakestAndTrending(allMetrics);
    const { tipsForWeakest, tipsForTrending } = getTrendTipsForMetrics(weakestMetric, trendingMetric);

    return {
        weakestMetric,
        trendingMetric,
        allMetrics,
        tipsForWeakest,
        tipsForTrending
    };
}

function getTrendEmailSelection() {
    const employeeName = document.getElementById('trendEmployeeSelect')?.value;
    const weekKey = document.getElementById('trendPeriodSelect')?.value;
    const nickname = document.getElementById('trendNickname')?.value.trim();

    if (!employeeName || !weekKey) {
        console.error('Missing selection - Employee:', employeeName, 'Week:', weekKey);
        showToast('Please select both employee and period', 5000);
        return null;
    }

    return { employeeName, weekKey, nickname };
}

function getTrendEmailDisplayName(employeeName, nickname) {
    if (employeeName && nickname) {
        saveNickname(employeeName, nickname);
    }
    return nickname || employeeName;
}

function generateTrendEmail() {
    const selection = getTrendEmailSelection();
    if (!selection) return;
    const { employeeName, weekKey, nickname } = selection;

    const trendContext = resolveTrendEmailContext(employeeName, weekKey);
    if (!trendContext) return;
    const { period, periodMeta, employee, prevEmployee } = trendContext;

    const displayName = getTrendEmailDisplayName(employeeName, nickname);
    showToast('ℹ️ Creating metrics image...', 3000);

    createTrendEmailImage(displayName, weekKey, period, employee, prevEmployee, () => {
        const emailSubject = buildTrendEmailSubject(periodMeta, displayName);
        openTrendEmailOutlook(emailSubject, employeeName);
        showToast('📧 Metrics image copied! Paste into the email body.', 4000);
    });
}

/*
 * THE COACHING FOLLOW-UP EMAIL
 *
 * Goes straight into an Outlook draft, so this is the text the associate
 * reads. Scott, 2026-10-14, on the version this replaces: it read as a cold
 * report. ALL-CAPS headers, raw values ("96.24", "604.2", no units), ">= 93",
 * a week's reliability hours listed as a win, "Thanks," with no name, and the
 * weakest metric put in focus even when it was at goal, so Maria was told to
 * work on 96.2% adherence against a 93% goal.
 *
 * Now: specific praise first, only what is below goal in focus (two at most,
 * one tip each), every number with its unit and its goal in words, nothing
 * about reliability, and a warm close.
 */
const TREND_SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TREND_LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function trendShortDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    const month = match ? TREND_SHORT_MONTHS[parseInt(match[2], 10) - 1] : '';
    return month ? `${month} ${parseInt(match[3], 10)}` : '';
}

function trendWeekStartIso(periodMeta, weekKey) {
    const meta = periodMeta || {};
    if (/^\d{4}-\d{2}-\d{2}/.test(meta.startDate || '')) return meta.startDate.slice(0, 10);
    const parts = String(weekKey || '').split('|');
    if (parts.length > 1 && /^\d{4}-\d{2}-\d{2}/.test(parts[0])) return parts[0].slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(meta.endDate || parts[1] || '');
    if (!match) return '';
    const end = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    const back = (end.getUTCDay() + 6) % 7;
    return new Date(end.getTime() - back * 86400000).toISOString().slice(0, 10);
}

// "the week of Oct 5", "September", "the year so far".
function trendPeriodPhrase(periodMeta, weekKey) {
    const meta = periodMeta || {};
    const type = meta.periodType || 'week';
    const endIso = meta.endDate || String(weekKey || '').split('|')[1] || '';
    if (type === 'month') {
        const month = /^\d{4}-(\d{2})/.exec(trendWeekStartIso(meta, weekKey) || endIso);
        return month ? TREND_LONG_MONTHS[parseInt(month[1], 10) - 1] : 'this month';
    }
    if (type === 'ytd') return 'the year so far';
    if (type === 'quarter') return trendShortDate(endIso) ? `the quarter ending ${trendShortDate(endIso)}` : 'this quarter';
    const start = trendShortDate(trendWeekStartIso(meta, weekKey));
    if (start) return `the week of ${start}`;
    return trendShortDate(endIso) ? `the week ending ${trendShortDate(endIso)}` : 'this week';
}

function trendPeriodIsOngoing(periodMeta, weekKey) {
    const meta = periodMeta || {};
    const endIso = meta.endDate || String(weekKey || '').split('|')[1] || '';
    const voice = window.DevCoachModules?.messageVoice;
    if (typeof voice?.isOngoingPeriod === 'function') return voice.isOngoingPeriod(meta.periodType || 'week', endIso);
    return !['week', 'month', 'quarter', 'daily'].includes(meta.periodType || 'week');
}

// Why a win matters, in a line, so the praise is about the customer and not
// only the number.
const WIN_REASONS = {
    scheduleAdherence: 'Being there when the calls come in keeps the wait down for every customer.',
    overallExperience: 'That is customers telling us, in their own words, that the call went well.',
    cxRepOverall: 'That one is about you personally, and customers like what they hear.',
    fcr: 'Getting it done the first time saves customers a second call.',
    transfers: 'Customers get their answer from you instead of being passed along.',
    aht: 'You are getting customers what they need without keeping them on the line.',
    acw: 'Your wrap up is quick, so you are ready for the next customer.',
    holdTime: 'Customers are not left sitting on hold.',
    overallSentiment: 'Your calls come across warm and positive.',
    positiveWord: 'Your word choice is landing well with customers.',
    negativeWord: 'You are steering clear of the wording that puts customers off.',
    managingEmotions: 'You keep calls calm, even the tough ones.'
};

function endWithPeriod(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return '';
    return /[.!?]['"]?$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// How far the number sits from the goal, as a share of it, so a gap in
// seconds and one in percentage points can be ranked together.
function relativeGap(metric) {
    const target = Math.abs(Number(metric?.target) || 0);
    return target ? (Number(metric?.gapFromTarget) || 0) / target : (Number(metric?.gapFromTarget) || 0);
}

function relativeLead(metric) {
    const target = Number(metric?.target);
    const value = Number(metric?.employeeValue);
    if (!Number.isFinite(target) || !Number.isFinite(value) || target === 0) return 0;
    const ahead = metric.targetType === 'max' ? target - value : value - target;
    return ahead / Math.abs(target);
}

// "up from 95.1% the week before", only when it moved the right way.
function improvementClause(metric, periodWord) {
    if (metric?.previousValue === null || metric?.previousValue === undefined) return '';
    if (metric.trendDirection !== 'improving') return '';
    const before = formatMetricDisplay(metric.metricKey, metric.previousValue);
    const now = formatMetricDisplay(metric.metricKey, metric.employeeValue);
    if (before === now) return '';
    const rose = Number(metric.employeeValue) > Number(metric.previousValue);
    return `, ${rose ? 'up' : 'down'} from ${before} the ${periodWord} before`;
}

function buildCoachingEmailBody(displayName, allMetrics, weakestMetric, trendingMetric, tipsForWeakest, tipsForTrending, periodMeta, options = {}) {
    const firstName = String(displayName || '').split(/[,\s]/)[0] || 'there';
    const metrics = coachableTrendMetrics(allMetrics);
    const meta = periodMeta || {};
    const when = trendPeriodPhrase(meta, options.weekKey);
    const ongoing = trendPeriodIsOngoing(meta, options.weekKey);
    const periodWord = (meta.periodType === 'month') ? 'month' : (meta.periodType === 'quarter' ? 'quarter' : 'week');
    const was = ongoing ? 'is at' : 'came in at';

    const wins = metrics.filter(m => m.meetsTarget)
        .sort((a, b) => relativeLead(b) - relativeLead(a))
        .slice(0, 3);

    // Only what is actually below goal. The weakest and the slipping metric
    // lead when they are below it, because their tips were chosen for them.
    const below = metrics.filter(m => !m.meetsTarget);
    const tipsFor = (metric) => {
        if (metric.metricKey === weakestMetric?.metricKey && tipsForWeakest?.length) return tipsForWeakest;
        if (metric.metricKey === trendingMetric?.metricKey && tipsForTrending?.length) return tipsForTrending;
        return getRandomTipsForMetric(metric.metricKey, 1);
    };
    const preferred = [weakestMetric, trendingMetric]
        .map(m => m && below.find(b => b.metricKey === m.metricKey))
        .filter(Boolean);
    const focus = [];
    preferred.concat(below.slice().sort((a, b) => relativeGap(b) - relativeGap(a))).forEach(metric => {
        if (focus.length >= 2 || focus.some(f => f.metricKey === metric.metricKey)) return;
        focus.push(metric);
    });

    const lines = [`Hi ${firstName},`, ''];

    if (wins.length) {
        const metCount = metrics.filter(m => m.meetsTarget).length;
        const tally = metrics.length > 1
            ? ` You ${ongoing ? 'are hitting' : 'hit'} ${metCount} of your ${metrics.length} goals.`
            : '';
        lines.push(`I wanted to follow up on ${when}, and first, nice work.${tally} Here is what stood out:`);
        lines.push('');
        wins.forEach(m => {
            const value = formatMetricDisplay(m.metricKey, m.employeeValue);
            const reason = WIN_REASONS[m.metricKey] ? ` ${WIN_REASONS[m.metricKey]}` : '';
            lines.push(`- ${m.label} ${was} ${value}${improvementClause(m, periodWord)} (${trendGoalPhrase(m.metricKey, m.target)}).${reason}`);
        });
    } else {
        lines.push(`I wanted to follow up on ${when}. Thank you for the work you are putting in. I can see the effort, and I want to help you turn it into the numbers you deserve.`);
    }

    if (focus.length) {
        lines.push('');
        lines.push(focus.length === 1 ? 'Here is the one thing I want us to work on next:' : 'Here are the two things I want us to work on next:');
        lines.push('');
        focus.forEach(m => {
            const value = formatMetricDisplay(m.metricKey, m.employeeValue);
            const moving = improvementClause(m, periodWord);
            const goal = trendGoalPhrase(m.metricKey, m.target).replace(/^goal /, 'goal is ');
            const tip = endWithPeriod((tipsFor(m) || [])[0]);
            lines.push(`- ${m.label} ${was} ${value}${moving}, and the ${goal}.${moving ? ' It is already moving the right way.' : ''}${tip ? ` One thing to try: ${tip}` : ''}`);
        });
        lines.push('');
        lines.push('I know you can get there, and I am here to help however I can. Let me know if you want to sit down and talk any of it through.');
    } else if (wins.length) {
        lines.push('');
        lines.push(`Everything I looked at ${ongoing ? 'is' : 'was'} at or better than goal. Keep doing exactly what you are doing, and thank you.`);
    } else {
        lines.push('');
        lines.push('Let me know if you want to sit down and talk any of it through.');
    }

    return lines.join('\n');
}

// "Following up on the week of Oct 5". The old "Coaching Follow-up: Maria"
// put the associate's own name in her subject line and no period at all.
function buildCoachingFollowupSubject(displayName, periodMeta, weekKey) {
    const when = trendPeriodPhrase(periodMeta, weekKey);
    return `Following up on ${when}`;
}

function openCoachingFollowupEmail(emailSubject, employeeName, emailBody) {
    try {
        const toAddress = buildEmployeeEmail(employeeName);
        const mailtoLink = document.createElement('a');
        mailtoLink.href = `mailto:${encodeURIComponent(toAddress)}?cc=${encodeURIComponent(window.DevCoachModules?.sharedUtils?.getCoachingCcEmail?.() || 'Brandywine.Lockhart@aps.com')}&subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
        document.body.appendChild(mailtoLink);
        mailtoLink.click();
        document.body.removeChild(mailtoLink);
    } catch(e) {
        console.error('Error opening mailto:', e);
    }
}

function generateCoachingFollowup() {
    const selection = getTrendEmailSelection();
    if (!selection) return;
    const { employeeName, weekKey, nickname } = selection;

    const trendContext = resolveTrendEmailContext(employeeName, weekKey);
    if (!trendContext) return;
    const { period, periodMeta, employee } = trendContext;

    const displayName = getTrendEmailDisplayName(employeeName, nickname);

    const {
        weakestMetric,
        trendingMetric,
        allMetrics,
        tipsForWeakest,
        tipsForTrending
    } = buildTrendEmailAnalysisBundle(employee, weekKey, period);
    const sentimentSnapshot = getSelectedTrendSentimentSnapshot(employeeName);

    const emailSubject = buildCoachingFollowupSubject(displayName, periodMeta, weekKey);
    const emailBody = buildCoachingEmailBody(displayName, allMetrics, weakestMetric, trendingMetric, tipsForWeakest, tipsForTrending, periodMeta, { weekKey });
    openCoachingFollowupEmail(emailSubject, employeeName, emailBody);

    if (weakestMetric || trendingMetric || (allMetrics && allMetrics.length > 0)) {
        showTrendsWithTipsPanel(
            employeeName,
            displayName,
            weakestMetric,
            trendingMetric,
            tipsForWeakest,
            tipsForTrending,
            weekKey,
            periodMeta,
            emailSubject,
            sentimentSnapshot,
            allMetrics
        );
    }
    showToast('📧 Coaching email drafted. Edit as needed before sending.', 4000);
}

function buildEmployeeEmail(employeeName) {
    if (!employeeName || employeeName === 'Team') return '';
    var name = String(employeeName).trim();
    var first, last;
    if (name.indexOf(',') !== -1) {
        // "Last, First" format
        var parts = name.split(',');
        last = parts[0].trim();
        first = (parts[1] || '').trim();
    } else {
        // "First Last" format
        var parts = name.split(/\s+/);
        first = parts[0] || '';
        last = parts.slice(1).join(' ');
    }
    if (!first || !last) return '';
    // Take only the first word of each (handle middle names, suffixes)
    first = first.split(/\s+/)[0].toLowerCase();
    last = last.split(/\s+/)[0].toLowerCase();
    return first + '.' + last + '@aps.com';
}

function openTrendEmailOutlook(emailSubject, employeeName) {
    /**
     * Open Outlook/mail client with trend email
     */
    try {
        const toAddress = buildEmployeeEmail(employeeName);
        const mailtoLink = document.createElement('a');
        mailtoLink.href = `mailto:${encodeURIComponent(toAddress)}?cc=${encodeURIComponent(window.DevCoachModules?.sharedUtils?.getCoachingCcEmail?.() || 'Brandywine.Lockhart@aps.com')}&subject=${encodeURIComponent(emailSubject)}`;
        document.body.appendChild(mailtoLink);
        mailtoLink.click();
        document.body.removeChild(mailtoLink);
        if (window.DEBUG) console.log('Mailto link clicked');
    } catch(e) {
        console.error('Error opening mailto:', e);
    }
}

function getTrendPeriodDisplay(periodType = 'week') {
    const normalized = String(periodType || 'week').toLowerCase();
    const periodTypeText = normalized === 'daily' ? 'daily' : normalized === 'month' ? 'month' : normalized === 'quarter' ? 'quarter' : normalized === 'ytd' ? 'ytd' : 'week';
    const periodTypeTitle = normalized === 'daily' ? 'Daily' : normalized === 'month' ? 'Monthly' : normalized === 'quarter' ? 'Quarterly' : normalized === 'ytd' ? 'YTD' : 'Weekly';
    const periodLabel = normalized === 'daily' ? 'Day' : normalized === 'month' ? 'Month' : normalized === 'quarter' ? 'Quarter' : normalized === 'ytd' ? 'YTD' : 'Week';
    return { periodTypeText, periodTypeTitle, periodLabel };
}

// "Weekly metrics for Maria, week of Oct 5". It was "Weekly Trend Email:
// Maria (Week Ending 2026-10-09)", a raw date and a label for the tool rather
// than for her (Scott, 2026-10-14).
function buildTrendEmailSubject(periodMeta, displayName) {
    const meta = periodMeta || {};
    const type = String(meta.periodType || 'week').toLowerCase();
    const end = trendShortDate(meta.endDate);
    if (type === 'ytd') return `Year to date metrics for ${displayName}${end ? `, through ${end}` : ''}`;
    if (type === 'daily') return `Daily metrics for ${displayName}${end ? `, ${end}` : ''}`;
    const { periodTypeTitle } = getTrendPeriodDisplay(type);
    return `${periodTypeTitle} metrics for ${displayName}, ${trendPeriodPhrase(meta).replace(/^the /, '')}`;
}

function buildTrendFocusAreas(weakestMetric, tipsForWeakest, trendingMetric, tipsForTrending, allMetrics) {
    const belowTargetMetrics = Array.isArray(allMetrics)
        ? allMetrics
            .filter(metric => metric && !metric.meetsTarget)
            .sort((a, b) => (b.gapFromTarget || 0) - (a.gapFromTarget || 0))
        : [];

    const focusCandidates = [];
    const seenFocusMetricKeys = new Set();
    const addFocusCandidate = (metric, tips) => {
        if (!metric || !metric.metricKey || seenFocusMetricKeys.has(metric.metricKey)) return;
        const normalizedTips = Array.isArray(tips)
            ? tips.map(tip => String(tip || '').trim()).filter(Boolean)
            : [];
        focusCandidates.push({ metric, tips: normalizedTips });
        seenFocusMetricKeys.add(metric.metricKey);
    };

    addFocusCandidate(weakestMetric, tipsForWeakest);
    addFocusCandidate(trendingMetric, tipsForTrending);

    belowTargetMetrics.forEach(metric => {
        if (focusCandidates.length >= 2) return;
        addFocusCandidate(metric, getRandomTipsForMetric(metric.metricKey, 2));
    });

    return focusCandidates.slice(0, 2).map((candidate, index) => ({
        metric: candidate.metric,
        tips: candidate.tips.length > 0 ? candidate.tips : ['No coaching tips available yet for this metric.'],
        bgColor: index === 0 ? '#fff3cd' : '#ffe0b2',
        borderColor: index === 0 ? '#ff9800' : '#f57c00',
        titleColor: index === 0 ? '#ff9800' : '#f57c00'
    }));
}

function buildTrendSentimentSectionHtml(employeeName, weekKey, sentimentSnapshot) {
    const periodData = ytdData[weekKey] || weeklyData[weekKey];
    const periodEmployee = periodData?.employees?.find(emp => emp.name === employeeName) || null;
    const sentimentMetrics = periodEmployee
        ? {
            negativeWord: periodEmployee.negativeWord,
            positiveWord: periodEmployee.positiveWord,
            managingEmotions: periodEmployee.managingEmotions
        }
        : null;
    const sentimentFocusText = buildSentimentFocusAreasForPrompt(sentimentSnapshot, sentimentMetrics);
    const sentimentHtml = sentimentSnapshot
        ? `
        <div style="margin: 20px 0; padding: 15px; background: #fff8e1; border-radius: 4px; border-left: 4px solid #ffb300;">
            <h4 style="color: #8d6e00; margin-top: 0;">💬 Sentiment Focus (${sentimentSnapshot.timeframeStart} to ${sentimentSnapshot.timeframeEnd})</h4>
            <p style="margin: 0; color: var(--text-primary); white-space: pre-wrap;">${escapeHtml(sentimentFocusText)}</p>
        </div>
        `
        : '';

    return { sentimentHtml, sentimentFocusText };
}

function renderTrendFocusAreasHtml(focusAreas) {
    return focusAreas.map((focusArea, areaIndex) => {
        const tipsHtml = focusArea.tips.map((tip, tipIndex) => `
            <div style="background: var(--bg-surface-sunken); padding: 12px; border-radius: 4px; margin-bottom: 10px; border-left: 4px solid #9c27b0;">
                <strong>💡 Tip ${tipIndex + 1}:</strong> ${escapeHtml(tip)}
            </div>
        `).join('');

        const heading = focusAreas.length === 1
            ? `📉 Focus Area: ${escapeHtml(focusArea.metric.label)}`
            : `📉 Focus Area ${areaIndex + 1}: ${escapeHtml(focusArea.metric.label)}`;

        return `
            <div style="margin-bottom: 20px; padding: 15px; background: ${focusArea.bgColor}; border-radius: 4px; border-left: 4px solid ${focusArea.borderColor};">
                <h4 style="color: ${focusArea.titleColor}; margin-top: 0;">${heading}</h4>
                <p style="margin: 5px 0 15px 0; color: var(--text-primary);">
                    Currently at <strong>${escapeHtml(formatMetricDisplay(focusArea.metric.metricKey, focusArea.metric.employeeValue))}</strong>,
                    <strong>${escapeHtml(trendGoalPhrase(focusArea.metric.metricKey, focusArea.metric.target))}</strong>
                </p>
                ${tipsHtml}
            </div>
        `;
    }).join('');
}

function renderTrendIntelligenceSnapshotHtml(allMetrics) {
    const metrics = Array.isArray(allMetrics) ? allMetrics : [];
    if (metrics.length === 0) return '';

    const classificationPriority = {
        'Needs Focus': 0,
        'Watch Area': 1,
        'On Track': 2,
        'Exceeding Expectation': 3
    };

    const sorted = [...metrics].sort((a, b) => {
        const classA = classificationPriority[a.classification] ?? 9;
        const classB = classificationPriority[b.classification] ?? 9;
        if (classA !== classB) return classA - classB;
        const riskA = (a.gapFromTarget || 0) + Math.max(0, -(a.trendDelta || 0));
        const riskB = (b.gapFromTarget || 0) + Math.max(0, -(b.trendDelta || 0));
        return riskB - riskA;
    });

    const topItems = sorted.slice(0, 6);
    const rows = topItems.map(metric => {
        const directionText = metric.trendDirection === 'improving'
            ? 'Improving'
            : metric.trendDirection === 'declining'
            ? 'Declining'
            : 'Stable';
        const directionColor = metric.trendDirection === 'improving'
            ? '#2e7d32'
            : metric.trendDirection === 'declining'
            ? '#b71c1c'
            : '#455a64';

        const classColor = metric.classification === 'Exceeding Expectation'
            ? '#2e7d32'
            : metric.classification === 'On Track'
            ? '#0277bd'
            : metric.classification === 'Watch Area'
            ? '#ef6c00'
            : '#b71c1c';

        const volatilityText = metric.isVolatile ? 'Volatile' : 'Stable';
        const volatilityColor = metric.isVolatile ? '#ef6c00' : '#455a64';

        return `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid var(--border); color: var(--text-primary);">${metric.label}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border); color: ${classColor}; font-weight: 600;">${metric.classification || 'On Track'}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border); color: ${directionColor};">${directionText}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border); color: ${volatilityColor};">${volatilityText}</td>
            </tr>
        `;
    }).join('');

    const counts = {
        exceeding: metrics.filter(m => m.classification === 'Exceeding Expectation').length,
        onTrack: metrics.filter(m => m.classification === 'On Track').length,
        watch: metrics.filter(m => m.classification === 'Watch Area').length,
        needsFocus: metrics.filter(m => m.classification === 'Needs Focus').length
    };

    return `
        <div style="margin: 20px 0; padding: 15px; background: #f4f9ff; border-radius: 4px; border-left: 4px solid #1976d2;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
                <h4 style="color: #1976d2; margin: 0;">🧠 Intelligence Snapshot</h4>
                <button id="copyTrendIntelligenceSnapshotBtn" type="button" style="padding: 8px 12px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.85em;">
                    📋 Copy Snapshot
                </button>
            </div>
            <p style="margin: 0 0 10px 0; color: #455a64; font-size: 0.9em;">
                Exceeding: <strong>${counts.exceeding}</strong> · On Track: <strong>${counts.onTrack}</strong> · Watch: <strong>${counts.watch}</strong> · Needs Focus: <strong>${counts.needsFocus}</strong>
            </p>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9em; background: var(--bg-surface); border: 1px solid #e3eef9;">
                <thead>
                    <tr style="background: #e3f2fd; color: #0d47a1; text-align: left;">
                        <th style="padding: 8px; border-bottom: 1px solid #d3e7f9;">Metric</th>
                        <th style="padding: 8px; border-bottom: 1px solid #d3e7f9;">Class</th>
                        <th style="padding: 8px; border-bottom: 1px solid #d3e7f9;">Momentum</th>
                        <th style="padding: 8px; border-bottom: 1px solid #d3e7f9;">Volatility</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

function buildTrendIntelligenceSnapshotText(allMetrics) {
    const metrics = Array.isArray(allMetrics) ? allMetrics : [];
    if (metrics.length === 0) return 'No intelligence snapshot data available.';

    const classificationPriority = {
        'Needs Focus': 0,
        'Watch Area': 1,
        'On Track': 2,
        'Exceeding Expectation': 3
    };

    const counts = {
        exceeding: metrics.filter(m => m.classification === 'Exceeding Expectation').length,
        onTrack: metrics.filter(m => m.classification === 'On Track').length,
        watch: metrics.filter(m => m.classification === 'Watch Area').length,
        needsFocus: metrics.filter(m => m.classification === 'Needs Focus').length
    };

    const topItems = [...metrics]
        .sort((a, b) => {
            const classA = classificationPriority[a.classification] ?? 9;
            const classB = classificationPriority[b.classification] ?? 9;
            if (classA !== classB) return classA - classB;
            const riskA = (a.gapFromTarget || 0) + Math.max(0, -(a.trendDelta || 0));
            const riskB = (b.gapFromTarget || 0) + Math.max(0, -(b.trendDelta || 0));
            return riskB - riskA;
        })
        .slice(0, 8);

    const lines = topItems.map(metric => {
        const directionText = metric.trendDirection === 'improving'
            ? 'Improving'
            : metric.trendDirection === 'declining'
            ? 'Declining'
            : 'Stable';
        const volatilityText = metric.isVolatile ? 'Volatile' : 'Stable';
        const currentText = formatMetricDisplay(metric.metricKey, metric.employeeValue);
        const goalText = formatMetricDisplay(metric.metricKey, metric.target);
        const previousText = metric.previousValue !== null && metric.previousValue !== undefined
            ? formatMetricDisplay(metric.metricKey, metric.previousValue)
            : 'N/A';
        const teamText = Number.isFinite(metric.centerValue) && metric.centerValue > 0
            ? formatMetricDisplay(metric.metricKey, metric.centerValue)
            : 'N/A';
        return `- ${metric.label}: ${metric.classification || 'On Track'} | Current ${currentText} | Goal ${goalText} | Previous ${previousText} | Team ${teamText} | ${directionText} | ${volatilityText}`;
    });

    return [
        'INTELLIGENCE SNAPSHOT',
        `Exceeding: ${counts.exceeding} | On Track: ${counts.onTrack} | Watch: ${counts.watch} | Needs Focus: ${counts.needsFocus}`,
        '',
        ...lines
    ].join('\n');
}

function attachTrendTipsModalHandlers(options) {
    const {
        modal,
        displayName,
        primaryFocusMetric,
        secondaryFocusMetric,
        primaryFocusTips,
        secondaryFocusTips,
        sentimentSnapshot,
        allMetrics,
        copilotPrompt,
        focusAreas,
        employeeName,
        periodLabel
    } = options;

    document.getElementById('copyPromptBtn')?.addEventListener('click', () => {
        const textarea = document.getElementById('copilotPromptDisplay');
        if (!textarea) return;
        handOffToCopilot(textarea.value, {
            message: '📋 Prompt copied. Opening Copilot',
            onCopyFailed: () => textarea.select()
        });
    });

    const copySnapshotBtn = document.getElementById('copyTrendIntelligenceSnapshotBtn');
    if (copySnapshotBtn) {
        copySnapshotBtn.addEventListener('click', () => {
            const summaryText = buildTrendIntelligenceSnapshotText(allMetrics || []);
            copyToClipboard(summaryText, { message: '📋 Intelligence snapshot copied' });
        });
    }

    document.getElementById('logTrendCoachingBtn')?.addEventListener('click', () => {
        const userNotesText = document.getElementById('trendCoachingNotes').value.trim();
        const finalPrompt = userNotesText
            ? buildTrendCoachingPrompt(
                displayName,
                primaryFocusMetric,
                secondaryFocusMetric,
                primaryFocusTips,
                secondaryFocusTips,
                userNotesText,
                sentimentSnapshot,
                allMetrics
            )
            : copilotPrompt;

        const metricsCoached = focusAreas
            .map(area => area.metric?.metricKey)
            .filter(Boolean);

        recordCoachingEvent({
            employeeId: employeeName,
            weekEnding: periodLabel,
            metricsCoached: metricsCoached,
            aiAssisted: true
        });

        showToast('✅ Coaching logged', 2000);
        document.getElementById('copilotPromptDisplay').value = finalPrompt;
        showToast('💡 Updated prompt above with your notes. Copy and paste into CoPilot!', 3000);
        document.getElementById('copilotPromptDisplay').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    document.getElementById('skipTrendCoachingBtn')?.addEventListener('click', () => {
        if (modal.parentNode) modal.parentNode.removeChild(modal);
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal && modal.parentNode) {
            modal.parentNode.removeChild(modal);
        }
    });
}

function buildTrendTipsModalHtml(displayName, periodLabel, summaryBoxesHtml, focusAreasHtml, sentimentHtml, intelligenceSnapshotHtml, copilotPrompt) {
    return `
        <h3 style="color: #9c27b0; margin-top: 0;">📊 Coaching Summary for ${escapeHtml(displayName)}</h3>
        <p style="color: var(--text-secondary); margin-bottom: 20px; font-size: 0.95em;">${escapeHtml(periodLabel)}</p>

        ${summaryBoxesHtml}

        ${focusAreasHtml ? `<h4 style="color: #9c27b0; margin: 0 0 12px 0;">🎯 Coaching Focus</h4>${focusAreasHtml}` : ''}

        ${intelligenceSnapshotHtml}

        ${sentimentHtml}

        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 8px; font-weight: bold;">💬 Additional Notes (optional):</label>
            <textarea id="trendCoachingNotes" style="width: 100%; height: 70px; padding: 10px; border: 1px solid var(--border); border-radius: 4px; font-family: Arial;" placeholder="Any additional coaching notes..."></textarea>
        </div>

        <div style="margin: 20px 0; padding: 15px; background: var(--bg-surface-raised); border-radius: 4px; border: 1px solid var(--border);">
            <h4 style="color: var(--text-primary); margin-top: 0;">🤖 CoPilot Prompt</h4>
            <p style="color: var(--text-secondary); font-size: 0.9em; margin: 0 0 10px 0;">
                Copy this prompt and paste it into <strong><a href="${copilotUrl()}" target="_blank" style="color: #1976d2;">Microsoft CoPilot</a></strong> to draft the coaching email:
            </p>
            <textarea id="copilotPromptDisplay" readonly style="width: 100%; height: 200px; padding: 10px; border: 1px solid var(--border); border-radius: 4px; font-family: 'Courier New', monospace; font-size: 0.85em; background: var(--bg-surface); color: var(--text-primary);">${escapeHtml(copilotPrompt)}</textarea>
            <button id="copyPromptBtn" style="margin-top: 10px; padding: 10px 16px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                📋 Copy Prompt
            </button>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="logTrendCoachingBtn" style="flex: 1; padding: 12px; background: #9c27b0; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.95em;">
                ✅ Log Coaching
            </button>
            <button id="skipTrendCoachingBtn" style="flex: 1; padding: 12px; background: #999; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.95em;">
                Skip
            </button>
        </div>
    `;
}

function createTrendTipsModalElements() {
    const modal = document.createElement('div');
    modal.id = 'trendTipsModal';
    modal.style.cssText = `
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

    const panel = document.createElement('div');
    panel.style.cssText = `
        background: var(--bg-surface);
        border-radius: 8px;
        padding: 24px;
        max-width: 650px;
        max-height: 85vh;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;

    return { modal, panel };
}

/**
 * Displays a modal panel for trend-based coaching with praise, focus areas, and tips.
 * User can review coaching suggestions, add notes, and optionally launch Copilot for email drafting.
 */
function showTrendsWithTipsPanel(employeeName, displayName, weakestMetric, trendingMetric, tipsForWeakest, tipsForTrending, weekKey, periodMeta, emailSubject, sentimentSnapshot = null, allMetrics = null) {
    const { modal, panel } = createTrendTipsModalElements();

    const periodLabel = periodMeta.label || (periodMeta.endDate ? `Week ending ${formatDateMMDDYYYY(periodMeta.endDate)}` : 'this period');
    const { positiveHighlights, improvementAreas } = buildTrendHighlightsAndImprovements(allMetrics || []);
    const summaryBoxesHtml = renderTrendSummaryBoxesHtml(
        positiveHighlights,
        improvementAreas,
        'No above-target metrics in this period.',
        'No below-target metrics in this period.'
    );

    const focusAreas = buildTrendFocusAreas(
        weakestMetric,
        tipsForWeakest,
        trendingMetric,
        tipsForTrending,
        allMetrics
    );

    const primaryFocusMetric = focusAreas[0]?.metric || null;
    const secondaryFocusMetric = focusAreas[1]?.metric || null;
    const primaryFocusTips = focusAreas[0]?.tips || [];
    const secondaryFocusTips = focusAreas[1]?.tips || [];

    const focusAreasHtml = renderTrendFocusAreasHtml(focusAreas);
    const intelligenceSnapshotHtml = renderTrendIntelligenceSnapshotHtml(allMetrics || []);

    const { sentimentHtml } = buildTrendSentimentSectionHtml(employeeName, weekKey, sentimentSnapshot);

    // Build the comprehensive Copilot prompt (NEW)
    const userNotes = ''; // Will be filled by user in textarea
    const copilotPrompt = buildTrendCoachingPrompt(
        displayName,
        primaryFocusMetric,
        secondaryFocusMetric,
        primaryFocusTips,
        secondaryFocusTips,
        userNotes,
        sentimentSnapshot,
        allMetrics
    );

    panel.innerHTML = buildTrendTipsModalHtml(
        displayName,
        periodLabel,
        summaryBoxesHtml,
        focusAreasHtml,
        sentimentHtml,
        intelligenceSnapshotHtml,
        copilotPrompt
    );

    modal.appendChild(panel);
    document.body.appendChild(modal);

    attachTrendTipsModalHandlers({
        modal,
        displayName,
        primaryFocusMetric,
        secondaryFocusMetric,
        primaryFocusTips,
        secondaryFocusTips,
        sentimentSnapshot,
        allMetrics,
        copilotPrompt,
        focusAreas,
        employeeName,
        periodLabel
    });
}

/**
 * Builds a natural language prompt for Microsoft Copilot to draft a coaching email.
 * Incorporates performance data, tips, and optional notes into guidance for AI.
 */
function buildTrendCoachingPrompt(displayName, weakestMetric, trendingMetric, tipsForWeakest, tipsForTrending, userNotes, sentimentSnapshot = null, allTrendMetrics = null) {
    // Reliability never reaches this prompt: a week's hours were listed as a
    // strength (Scott, 2026-10-14). The bundle already drops it and the
    // surveys nobody answered; this is the guard for any other caller.
    const metrics = coachableTrendMetrics(allTrendMetrics);
    if (weakestMetric?.metricKey === 'reliability') weakestMetric = null;
    if (trendingMetric?.metricKey === 'reliability') trendingMetric = null;
    // Wording comes from metric-movement: "rose by 45s vs previous, which is
    // worse" rather than a bare "declining" the model has to reconcile
    // against figures that went the other way.
    const movement = window.DevCoachModules?.metricMovement;
    const getTrendLabel = (metric) => {
        if (!metric) return 'no prior period to compare';
        const hasPrior = metric.trendDelta !== null && metric.trendDelta !== undefined;
        if (!movement) return hasPrior ? String(metric.trendDirection) : 'no prior period to compare';
        // Polarity from metric-movement, the amount in the metric's own unit:
        // a rate that moved 1.1 points is "1.1 pts", not "1.1%".
        const d = movement.describe(metric.metricKey, hasPrior ? metric.trendDirection : 'stable', hasPrior ? metric.trendDelta : null);
        if (d.direction === 'stable') return d.hasPrior ? 'held steady vs previous' : 'no prior period to compare';
        const amount = d.amount === null ? '' : ` by ${formatTrendChange(metric.metricKey, d.amount)}`;
        return `${d.movementWord}${amount} vs previous, which is ${d.verdict}`;
    };

    // Spelling out the polarity per row means the model never has to work out
    // from context whether a bigger number is good news.
    const getPolarityNote = (metricKey) => movement
        ? movement.describe(metricKey, 'stable', null).polarity
        : (isReverseMetric(metricKey) ? 'lower is better' : 'higher is better');

    const classificationOrder = {
        'Needs Focus': 0,
        'Watch Area': 1,
        'On Track': 2,
        'Exceeding Expectation': 3
    };

    const strengths = [...metrics]
        .filter(m => m.classification === 'Exceeding Expectation' || (m.classification === 'On Track' && m.trendDirection === 'improving'))
        .sort((a, b) => (classificationOrder[b.classification] - classificationOrder[a.classification]) || ((b.trendDelta || 0) - (a.trendDelta || 0)))
        .slice(0, 4);

    const priorities = [...metrics]
        .filter(m => m.classification === 'Needs Focus' || m.classification === 'Watch Area')
        .sort((a, b) => {
            const scoreA = (a.gapFromTarget || 0) + Math.max(0, -(a.trendDelta || 0));
            const scoreB = (b.gapFromTarget || 0) + Math.max(0, -(b.trendDelta || 0));
            return scoreB - scoreA;
        })
        .slice(0, 4);

    const efficientSet = new Set(['aht', 'acw', 'holdTime', 'transfers']);
    const behaviorSet = new Set(['overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions', 'overallExperience', 'cxRepOverall', 'fcr']);
    const efficiencyNeeds = priorities.filter(m => efficientSet.has(m.metricKey)).length;
    const behaviorNeeds = priorities.filter(m => behaviorSet.has(m.metricKey)).length;

    const patternInsights = [];
    if (efficiencyNeeds > 0 && behaviorNeeds > 0) {
        patternInsights.push('Balanced pressure pattern: both call-control efficiency and communication-quality metrics need attention, suggesting pace and conversation quality are competing.');
    } else if (efficiencyNeeds > 0) {
        patternInsights.push('Execution pattern: primary risk is call flow efficiency, indicating opportunities in structure, pacing, and decision speed during interactions.');
    } else if (behaviorNeeds > 0) {
        patternInsights.push('Customer-experience pattern: tone and communication consistency are the main opportunities, pointing to word choice and emotional control habits.');
    } else {
        patternInsights.push('Consistency pattern: performance is generally steady with no concentrated risk cluster, so coaching should focus on sustaining repeatable habits.');
    }

    const volatilityRisks = metrics.filter(m => m.isVolatile).slice(0, 2);
    if (volatilityRisks.length > 0) {
        patternInsights.push(`Volatility signal: ${volatilityRisks.map(m => m.label).join(' and ')} show noticeable swings, so consistency routines should be reinforced to stabilize outcomes.`);
    }

    const topPriority = priorities[0] || weakestMetric || null;
    const topPriorityTips = topPriority?.metricKey === weakestMetric?.metricKey
        ? (tipsForWeakest || [])
        : topPriority?.metricKey === trendingMetric?.metricKey
        ? (tipsForTrending || [])
        : [];

    const actionTipLines = (topPriorityTips || []).slice(0, 2).map(t => `- ${t}`);
    if (actionTipLines.length === 0) {
        actionTipLines.push('- Use one call-plan checklist per shift to standardize call control and reduce avoidable variance.');
        actionTipLines.push('- Complete a 5-minute end-of-day reflection to identify one repeatable behavior for the next shift.');
    }

    const resolveThirtyDayGoal = () => {
        if (!topPriority) return 'Maintain all key metrics in On Track or Exceeding status for four consecutive weekly reviews.';
        if (topPriority.meetsTarget) {
            return `${topPriority.label}: hold at or better than ${formatMetricDisplay(topPriority.metricKey, topPriority.target)} while avoiding any backslide across the next 30 days.`;
        }
        const gap = topPriority.gapFromTarget || 0;
        const closeBy = Math.max(getMetricBandByUnit(topPriority.metricKey, { percent: 1.5, sec: 12, hrs: 0.8, fallback: 1.5 }), gap * 0.4);
        const goalValue = topPriority.targetType === 'min'
            ? topPriority.employeeValue + closeBy
            : topPriority.employeeValue - closeBy;
        const boundedGoal = topPriority.targetType === 'min'
            ? Math.min(goalValue, topPriority.target)
            : Math.max(goalValue, topPriority.target);
        return `${topPriority.label}: move from ${formatMetricDisplay(topPriority.metricKey, topPriority.employeeValue)} to at least ${formatMetricDisplay(topPriority.metricKey, boundedGoal)} within 30 days.`;
    };

    const metricTableLines = metrics
        .sort((a, b) => (classificationOrder[a.classification] - classificationOrder[b.classification]) || (b.gapFromTarget - a.gapFromTarget))
        .map(metric => {
            const current = formatMetricDisplay(metric.metricKey, metric.employeeValue);
            const target = trendGoalPhrase(metric.metricKey, metric.target).replace(/^goal /, '');
            const previous = metric.previousValue !== null && metric.previousValue !== undefined
                ? formatMetricDisplay(metric.metricKey, metric.previousValue)
                : 'N/A';
            const teamAvg = metric.centerValue > 0 ? formatMetricDisplay(metric.metricKey, metric.centerValue) : 'N/A';
            const volatility = metric.isVolatile ? 'swinging' : 'stable';
            return `- ${metric.label} (${getPolarityNote(metric.metricKey)}): current ${current} | goal ${target} | previous ${previous} | team avg ${teamAvg} | movement ${getTrendLabel(metric)} | volatility ${volatility} | class ${metric.classification}`;
        })
        .join('\n');

    const strengthLines = strengths.length > 0
        ? strengths.map(m => `- ${m.label}: demonstrates ${m.trendDirection === 'improving' ? 'building momentum and coachability' : 'reliable execution under normal call demand'}.`).join('\n')
        : '- No clear strengths are separated enough from baseline this period; reinforce foundational consistency first.';

    const priorityLines = priorities.length > 0
        ? priorities.map(m => `- ${m.label}: ${m.trendDirection === 'declining' ? 'moving away from goal' : 'below-target performance'} requires focused coaching to prevent broader impact.`).join('\n')
        : '- No immediate risk areas detected; maintain consistent coaching cadence and monitor for drift.';

    const leadershipLinks = [];
    priorities.forEach(m => {
        if (['aht', 'acw', 'holdTime', 'transfers', 'fcr'].includes(m.metricKey)) {
            leadershipLinks.push(`- ${m.label} → Decision quality, Accountability, Continuous improvement`);
        }
        if (['overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions', 'overallExperience', 'cxRepOverall'].includes(m.metricKey)) {
            leadershipLinks.push(`- ${m.label} → Communication clarity, Customer focus, Emotional regulation`);
        }
        if (m.metricKey === 'scheduleAdherence') {
            leadershipLinks.push(`- ${m.label} → Accountability, Collaboration, Continuous improvement`);
        }
    });

    const leadershipSection = leadershipLinks.length > 0
        ? Array.from(new Set(leadershipLinks)).slice(0, 4).join('\n')
        : '- Current trends align to maintaining Accountability and Continuous improvement through consistent execution habits.';

    const sentimentMetrics = metrics.length > 0
        ? {
            negativeWord: metrics.find(m => m.metricKey === 'negativeWord')?.employeeValue,
            positiveWord: metrics.find(m => m.metricKey === 'positiveWord')?.employeeValue,
            managingEmotions: metrics.find(m => m.metricKey === 'managingEmotions')?.employeeValue
        }
        : null;
    const sentimentFocusText = sentimentSnapshot
        ? buildSentimentFocusAreasForPrompt(sentimentSnapshot, sentimentMetrics)
        : '';

    const actionPlanSection = [
        'Immediate tactical adjustments:',
        ...actionTipLines,
        'Skill development suggestions:',
        '- Run one focused call-listening review each week with behavior-specific feedback and one repeatable behavior target.',
        'Process adjustments:',
        '- Add a mid-week checkpoint on trend direction so downward momentum is coached before end-of-period results lock in.',
        `30-day measurable improvement goal: ${resolveThirtyDayGoal()}`
    ].join('\n');

    const notesSection = userNotes ? `\nMANAGER CONTEXT:\n${userNotes}\n` : '';
    const sentimentSection = sentimentFocusText ? `\nSENTIMENT CONTEXT:\n${sentimentFocusText}\n` : '';

    return `You are the AI Intelligence Layer for a Supervisor Development Coaching Tool.

Use the performance data below to produce deep coaching intelligence and a ready-to-send coaching email.

ASSOCIATE: ${displayName}

METRIC INTELLIGENCE INPUT:
${metricTableLines || '- No metric data available.'}
${sentimentSection}${notesSection}
READING THE DATA:
- Each metric states its own direction. On a "lower is better" metric such as
  Average Handle Time, Hold Time, After Call Work or Transfers, a number that
  fell is an improvement and a number that rose is a setback.
- The "movement" field already tells you whether the change was better or
  worse. Trust that verdict over your own reading of the raw figures, and
  never describe a rise on a "lower is better" metric as progress.

OUTPUT REQUIREMENTS:
- Compare each metric to goal and previous period.
- Identify patterns across efficiency, sentiment, call control, and emotional regulation.
- Flag volatility and early risks, even when still above goal.
- Use behavioral interpretation, not numeric restatement.

Generate exactly this structure:

=== EXECUTIVE PERFORMANCE SUMMARY ===
3-5 sentences for supervisor use.

=== STRENGTHS TO LEVERAGE ===
${strengthLines}

=== PRIORITY DEVELOPMENT AREAS ===
${priorityLines}

=== PERFORMANCE PATTERN INSIGHTS ===
${patternInsights.join(' ')}

=== RECOMMENDED ACTION PLAN ===
${actionPlanSection}

=== LEADERSHIP COMPETENCY CONNECTION ===
${leadershipSection}

=== COACHING MESSAGE DRAFT ===
Write a copy-ready coaching email directly to ${displayName}.

Tone requirements:
- Warm and genuinely proud of them: open with specific praise for the strengths above, each with its number and why it matters to customers
- Goal focused: at most two development areas, each with its number, its goal and one practical step, framed as the next goal to reach
- Encouraging and confident they will get there
- No filler phrases
- No mention of AI
- Do not mention attendance, reliability or hours missed

Formatting requirements:
- Outlook-ready plain text
- Short paragraphs and clean bullets
- Under 250 words
- At most 2 emojis
- No technical commentary
- No em dash characters, and no hyphens with spaces around them.`;
}



function getMetricOrder() {
    // PHASE 3 - LOCKED ORDER: Core Performance > Survey > Sentiment > Reliability
    return [
        // CORE PERFORMANCE GROUP (6 metrics)
        { key: 'scheduleAdherence', group: 'Core Performance' },
        { key: 'transfers', group: 'Core Performance' },
        { key: 'aht', group: 'Core Performance' },
        { key: 'holdTime', group: 'Core Performance' },
        { key: 'acw', group: 'Core Performance' },
        // SURVEY GROUP (3 metrics)
        { key: 'overallExperience', group: 'Survey' },
        { key: 'cxRepOverall', group: 'Survey' },
        { key: 'fcr', group: 'Survey' },
        // SENTIMENT GROUP (3 metrics)
        { key: 'overallSentiment', group: 'Sentiment' },
        { key: 'positiveWord', group: 'Sentiment' },
        { key: 'negativeWord', group: 'Sentiment' },
        { key: 'managingEmotions', group: 'Sentiment' },
        // RELIABILITY GROUP (1 metric)
        { key: 'reliability', group: 'Reliability' }
    ];
}

// ============================================
// PHASE 3 - METRIC ROW RENDERER
// ============================================

// Canonical definition lives on window.isReverseMetric (set by metrics-registry).
// Kept as a local alias so nearby code reads naturally; delegates at call time
// so registry changes take effect without edits here.
function isReverseMetric(metricKey) {
    if (typeof window.isReverseMetric === 'function' && window.isReverseMetric !== isReverseMetric) {
        return window.isReverseMetric(metricKey);
    }
    return window.METRICS_REGISTRY?.[metricKey]?.isReverse === true;
}

function resolveTrendMetricYtdDisplay(metric, isSurveyMetric, ytdValue, ytdSurveyTotal) {
    let formattedYtd = '';
    const ytdValueNum = parseFloat(ytdValue);
    const ytdHasValue = ytdValue !== undefined && ytdValue !== null && ytdValue !== '' && !isNaN(ytdValueNum);

    // With its unit, like every other cell: "604s", not "604".
    if (isSurveyMetric) {
        if (ytdSurveyTotal > 0 && ytdHasValue) {
            formattedYtd = formatMetricDisplay(metric.key, ytdValueNum);
        } else if (ytdSurveyTotal === 0) {
            formattedYtd = 'N/A';
        } else {
            formattedYtd = 'N/A';
        }
    } else if (ytdHasValue) {
        formattedYtd = formatMetricDisplay(metric.key, ytdValueNum);
    }

    return formattedYtd;
}

function resolveTrendRowBackgroundColor(noSurveys, meetsGoal) {
    if (noSurveys) return '#ffffff';
    if (meetsGoal) return '#d4edda';
    return '#fff3cd';
}

function resolveTrendCenterComparisonDisplay(associateValue, centerAvg, isAboveCenter, metricKey, centerExists) {
    if (!centerExists) {
        return {
            color: '#999999',
            text: 'N/A'
        };
    }

    // In the metric's own unit, and points for a rate: "+1.1 pts", "-12s".
    const difference = associateValue - centerAvg;
    let text = formatTrendChange(metricKey, difference);
    if (difference > 0) text = `+${text}`;
    else if (difference < 0) text = `-${text}`;

    return {
        color: isAboveCenter ? '#0056B3' : '#DAA520',
        text
    };
}

function resolveTrendDirectionDisplay(associateValue, previousValue, isReverse, metricKey, periodType) {
    const prevNum = previousValue !== undefined && previousValue !== null ? parseFloat(previousValue) : null;
    const prevIsValid = prevNum !== null && !isNaN(prevNum);

    if (!prevIsValid) {
        return {
            color: '#666666',
            text: 'N/A'
        };
    }

    const trendDiff = associateValue - prevNum;
    const absDiff = Math.abs(trendDiff);
    const isImprovement = isReverse ? trendDiff < 0 : trendDiff > 0;

    if (absDiff < 0.1) {
        return {
            color: '#666666',
            text: 'No change'
        };
    }

    // Words and colour, judged by which way is good for this metric. It was
    // a 📈 or 📉 by the raw number on every row, so handle time coming down,
    // an improvement, carried a falling chart (Scott, 2026-10-14). The column
    // header already says "vs last week".
    const changeValue = formatTrendChange(metricKey, absDiff);

    return {
        color: isImprovement ? '#28a745' : '#dc3545',
        text: `${isImprovement ? 'Improved' : 'Slipped'} ${changeValue}`
    };
}

function drawTrendMetricRowShell(ctx, x, y, width, height, rowBgColor) {
    ctx.fillStyle = rowBgColor;
    ctx.fillRect(x, y, width, height);

    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);
}

function drawTrendMetricBaseCells(ctx, x, y, metric, target, noSurveys, associateValue, centerExists, centerAvg) {
    ctx.fillStyle = '#333333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    const targetDisplay = formatMetricDisplay(metric.key, target);
    ctx.fillText(`${metric.label} (${targetDisplay})`, x + 10, y + 24);

    ctx.fillStyle = noSurveys ? '#999999' : '#333333';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    const formattedValue = noSurveys ? 'N/A' : formatMetricDisplay(metric.key, associateValue);
    ctx.fillText(formattedValue, x + 240, y + 24);

    ctx.fillStyle = '#333333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    const formattedCenter = centerExists ? formatMetricDisplay(metric.key, centerAvg) : 'N/A';
    ctx.fillText(formattedCenter, x + 340, y + 24);
}

function drawTrendMetricCenterAndTrendCells(ctx, x, y, noSurveys, associateValue, centerAvg, isAboveCenter, metric, previousValue, isReverse, metricKey, periodType) {
    if (!noSurveys) {
        const centerExists = centerAvg > 0;
        const vsCenterDisplay = resolveTrendCenterComparisonDisplay(
            associateValue,
            centerAvg,
            isAboveCenter,
            metric.key,
            centerExists
        );

        ctx.fillStyle = vsCenterDisplay.color;
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(vsCenterDisplay.text, x + 460, y + 24);

        const trendingDisplay = resolveTrendDirectionDisplay(
            associateValue,
            previousValue,
            isReverse,
            metricKey,
            periodType
        );

        ctx.fillStyle = trendingDisplay.color;
        ctx.font = '13px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(trendingDisplay.text, x + 570, y + 24);
        return;
    }

    ctx.fillStyle = '#999999';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('N/A', x + 460, y + 24);
    ctx.textAlign = 'left';
    ctx.fillText('N/A', x + 570, y + 24);
}

function renderMetricRow(ctx, x, y, width, height, metric, associateValue, centerAvg, ytdValue, target, previousValue, rowIndex, alternatingColor, surveyTotal = 0, metricKey = '', periodType = 'week', ytdSurveyTotal = 0, reviewYear = null) {
    /**
     * PHASE 3.1 - METRIC ROW RENDERER
     * Renders a single metric row with full conditional logic
     */

    // Check if this is a survey metric with no surveys
    const SURVEY_METRICS = ['cxRepOverall', 'fcr', 'overallExperience'];
    const isSurveyMetric = SURVEY_METRICS.includes(metricKey);
    const noSurveys = isSurveyMetric && surveyTotal === 0;

    // Reliability is shown as the year's running total, so it has no week to
    // compare with and no center figure that means the same thing.
    if (metricKey === 'reliability') {
        drawTrendReliabilityRow(ctx, x, y, width, height, metric, associateValue, target);
        return;
    }

    const meetsGoal = isMetricMeetingTarget(metric.key, associateValue, target);
    const isReverse = isReverseMetric(metric.key);

    // Determine if associate is above/below center
    const centerExists = centerAvg > 0;
    const isAboveCenter = centerExists ?
        (isReverse ? associateValue < centerAvg : associateValue > centerAvg) :
        false;

    const rowBgColor = resolveTrendRowBackgroundColor(noSurveys, meetsGoal);

    drawTrendMetricRowShell(ctx, x, y, width, height, rowBgColor);
    drawTrendMetricBaseCells(ctx, x, y, metric, target, noSurveys, associateValue, centerExists, centerAvg);
    drawTrendMetricCenterAndTrendCells(
        ctx,
        x,
        y,
        noSurveys,
        associateValue,
        centerAvg,
        isAboveCenter,
        metric,
        previousValue,
        isReverse,
        metricKey,
        periodType
    );

    // YTD value - always render for all view types
    // CRITICAL: YTD display is INDEPENDENT of weekly survey count
    const formattedYtd = resolveTrendMetricYtdDisplay(metric, isSurveyMetric, ytdValue, ytdSurveyTotal);

    ctx.fillStyle = '#333333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(formattedYtd, x + 730, y + 24);
    ctx.textAlign = 'left'; // Reset to default
}

function drawTrendReliabilityRow(ctx, x, y, width, height, metric, yearTotal, target) {
    drawTrendMetricRowShell(ctx, x, y, width, height, resolveTrendRowBackgroundColor(false, isMetricMeetingTarget(metric.key, yearTotal, target)));
    ctx.fillStyle = '#333333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`${metric.label} (${formatMetricDisplay(metric.key, target)} a year)`, x + 10, y + 24);
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(formatMetricDisplay(metric.key, yearTotal), x + 240, y + 24);
    ctx.fillStyle = '#666666';
    ctx.font = '13px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('So far this year', x + 570, y + 24);
}

/**
 * The year's hours missed for the trend picture, from the newest
 * year-to-date upload as of the period's month. NaN when there is none, and
 * the row is then left off rather than showing a week's own hours.
 */
function resolveTrendReliabilityYearTotal(employeeName, metadata) {
    const pc = window.DevCoachModules?.periodCompare;
    const endDate = String(metadata?.endDate || '');
    if (!employeeName || typeof pc?.latestYtdReliability !== 'function' || !/^\d{4}-\d{2}/.test(endDate)) return NaN;
    const map = pc.latestYtdReliability(parseInt(endDate.slice(0, 4), 10), { asOfMonth: endDate.slice(0, 7) }) || {};
    const value = parseFloat(map[employeeName]);
    return Number.isFinite(value) ? value : NaN;
}

function createTrendEmailImage(empName, weekKey, period, current, previous, onClipboardReady) {
    // ============================================
    // PHASE 5 - SINGLE-SOURCE EMAIL GENERATION
    // ============================================

    if (!current) {
        console.error('Invalid employee data:', current);
        showToast('ℹ️ Employee data is missing', 5000);
        return;
    }

    const trendContext = buildTrendEmailContext(weekKey, period, current, previous);
    // CREATE CANVAS IMAGE (will be resized based on content)
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 2400; // Increased to accommodate legend + all sections
    const ctx = canvas.getContext('2d');

    drawTrendEmailCanvasSections(ctx, empName, current, previous, trendContext);

    finalizeTrendEmailImageOutput(canvas, empName, period, onClipboardReady);
}

function drawTrendEmailCanvasSections(ctx, empName, current, previous, trendContext) {
    const {
        metadata,
        reviewYear,
        metricOrder,
        metrics,
        prevMetrics,
        centerAvg,
        hasSurveys,
        meetingGoals,
        beatingCenter,
        totalMetrics,
        successRate,
        improvedText,
        periodDisplay,
        periodTypeText,
        improvedSub
    } = trendContext;

    const periodLabel = periodDisplay.periodLabel;
    const subjectLine = buildTrendEmailSubject(metadata, empName);
    let y = drawTrendEmailCanvasLayoutStart(ctx, empName, subjectLine);

    y = drawTrendSummaryCardsRow(ctx, y, {
        meetingGoals,
        totalMetrics,
        successRate,
        beatingCenter,
        improvedText,
        improvedSub
    });

    y = drawTrendSummaryBoxesSection(ctx, y, current, centerAvg, reviewYear, previous);
    y = drawTrendMetricsSectionHeader(ctx, y, periodLabel);

    const tableOptions = buildTrendMetricsTableOptions(trendContext, periodLabel);
    y = drawTrendMetricsTableBody(ctx, y, tableOptions);

    drawTrendInsightsLegendAndReliabilitySection(
        ctx,
        y,
        metricOrder,
        trendContext.speakMetrics || metrics,
        prevMetrics,
        centerAvg,
        previous,
        periodTypeText,
        hasSurveys
    );
}

function finalizeTrendEmailImageOutput(canvas, empName, period, onClipboardReady) {
    canvas.toBlob(pngBlob => {
        if (!pngBlob) {
            console.error('Failed to create blob from canvas');
            showToast('ℹ️ Error creating image', 5000);
            return;
        }

        copyTrendImageToClipboard(pngBlob, empName, period, onClipboardReady);
    }, 'image/png');
}

function buildTrendEmailContext(weekKey, period, current, previous) {
    const metadata = period?.metadata || {};
    const reviewYear = getReviewYearFromEndDate(metadata.endDate);

    const metricOrder = getMetricOrder();
    const { metrics, prevMetrics } = buildTrendMetricMaps(metricOrder, current, previous);

    // Reliability is the year's running total on anything the associate
    // sees. The weekly row holds the week's own hours, so it is swapped for
    // the year-to-date figure, or left off when there is none. Never compared
    // with last week: totals only go up.
    delete prevMetrics.reliability;
    const reliabilityYearTotal = current?.isTeamAggregate ? NaN : resolveTrendReliabilityYearTotal(current?.name, metadata);
    if (Number.isFinite(reliabilityYearTotal)) metrics.reliability = reliabilityYearTotal;
    else delete metrics.reliability;

    const callCenterAverages = loadCallCenterAverages();
    const centerAvg = callCenterAverages[weekKey] || {};

    const ytdPeriod = getYtdPeriodForWeekKey(weekKey);
    const ytdEmployee = ytdPeriod?.employees?.find(e => e.name === current.name) || null;
    const ytdAvailable = !!ytdEmployee;

    const { surveyTotal, ytdSurveyTotal } = calculateTrendSurveyTotals(current, metadata);
    const hasSurveys = surveyTotal > 0;

    // Each survey metric by its own count: rep sat and FCR are answered
    // separately, and an associate with Overall Experience surveys and no
    // rep sat ones showed "0%" rep sat. Unanswered rows read N/A, and they
    // never count as a miss, a win or a move.
    const surveyCounts = {};
    ['overallExperience', 'cxRepOverall', 'fcr'].forEach(key => {
        surveyCounts[key] = (hasSurveys && trendHasSurveysBehind(current, key)) ? surveyTotal : 0;
    });
    const speakMetrics = { ...metrics };
    Object.keys(surveyCounts).forEach(key => { if (!surveyCounts[key]) delete speakMetrics[key]; });
    delete speakMetrics.reliability;

    const {
        meetingGoals,
        improved,
        beatingCenter,
        totalMetrics,
        successRate,
        improvedText
    } = calculateTrendSummaryStats(metricOrder, speakMetrics, prevMetrics, centerAvg, previous, hasSurveys);

    const periodDisplay = getTrendPeriodDisplay(metadata.periodType);
    const periodTypeText = periodDisplay.periodTypeText;
    const improvedSub = previous ? `From Last ${periodTypeText.charAt(0).toUpperCase() + periodTypeText.slice(1)}` : 'No Prior Data';

    return {
        metadata,
        reviewYear,
        metricOrder,
        metrics,
        prevMetrics,
        centerAvg,
        ytdEmployee,
        ytdAvailable,
        surveyTotal,
        ytdSurveyTotal,
        surveyCounts,
        speakMetrics,
        hasSurveys,
        meetingGoals,
        improved,
        beatingCenter,
        totalMetrics,
        successRate,
        improvedText,
        periodDisplay,
        periodTypeText,
        improvedSub
    };
}

function buildTrendMetricsTableOptions(trendContext, periodLabel) {
    return {
        metricOrder: trendContext.metricOrder,
        metrics: trendContext.metrics,
        prevMetrics: trendContext.prevMetrics,
        centerAvg: trendContext.centerAvg,
        ytdEmployee: trendContext.ytdEmployee,
        hasSurveys: trendContext.hasSurveys,
        surveyTotal: trendContext.surveyTotal,
        surveyCounts: trendContext.surveyCounts,
        ytdSurveyTotal: trendContext.ytdSurveyTotal,
        reviewYear: trendContext.reviewYear,
        metadata: trendContext.metadata,
        periodLabel,
        ytdAvailable: trendContext.ytdAvailable
    };
}

function drawTrendEmailCanvasLayoutStart(ctx, empName, subjectLine) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 900, 2400);

    const gradient = ctx.createLinearGradient(0, 0, 900, 100);
    gradient.addColorStop(0, '#003DA5');
    gradient.addColorStop(1, '#0056B3');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 900, 100);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial';
    // Two emojis per message (Scott, 2026-10-13). The picture had nine or
    // more; the two it keeps are on the wins.
    ctx.fillText('Performance Summary', 50, 45);
    ctx.font = '14px Arial';
    ctx.fillText(subjectLine, 50, 75);

    let y = 130;
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 20px Arial';
    ctx.fillText(`Hi ${empName},`, 50, y);
    y += 40;

    ctx.font = '15px Arial';
    ctx.fillStyle = '#666666';
    ctx.fillText(`Here's a look at your numbers and how they compare to the call center. Thank you for the work behind them.`, 50, y);

    return y + 50;
}

function drawTrendSummaryCardsRow(ctx, y, stats) {
    drawEmailCard(
        ctx,
        50,
        y,
        250,
        110,
        '#ffffff',
        '#28a745',
        'Meeting Goals',
        `${stats.meetingGoals}/${stats.totalMetrics}`,
        `${stats.successRate}% Success Rate`
    );
    drawEmailCard(
        ctx,
        325,
        y,
        250,
        110,
        '#ffffff',
        '#2196F3',
        'Above Average',
        `${stats.beatingCenter}/${stats.totalMetrics}`,
        'Better than the Call Center'
    );
    drawEmailCard(
        ctx,
        600,
        y,
        250,
        110,
        '#ffffff',
        '#ff9800',
        'Improved',
        stats.improvedText,
        stats.improvedSub
    );

    return y + 140;
}

function drawTrendSummaryBoxesSection(ctx, y, current, centerAvg, reviewYear, previous = null) {
    const trendAnalysisForSummary = analyzeTrendMetrics(current, centerAvg, reviewYear);
    // Without the week's reliability hours and the surveys nobody answered.
    const trendSummary = buildTrendHighlightsAndImprovements(coachableTrendMetrics(trendAnalysisForSummary.allMetrics, current, previous));
    const summaryBoxesHeight = drawTrendSummaryBoxesOnCanvas(
        ctx,
        40,
        y,
        820,
        trendSummary.positiveHighlights,
        trendSummary.improvementAreas,
        'No above-target metrics in this period.',
        'No below-target metrics in this period.'
    );
    return y + summaryBoxesHeight + 24;
}

function drawTrendInsightsLegendAndReliabilitySection(ctx, y, metricOrder, metrics, prevMetrics, centerAvg, previous, periodTypeText, hasSurveys = true) {
    const { improvedMetrics, keyWins, focusMetrics } = buildTrendHighlightsData(
        metricOrder,
        metrics,
        prevMetrics,
        centerAvg,
        previous
    );

    const hasUnavailableCenterOrTrend = !previous || metricOrder.some(({ key }) => {
        if (metrics[key] === undefined) return false;
        const centerValue = parseFloat(getCenterAverageForMetric(centerAvg, key));
        return !Number.isFinite(centerValue) || centerValue <= 0;
    });

    let nextY = drawTrendHighlightsSection(ctx, y, keyWins, improvedMetrics, focusMetrics, periodTypeText, previous);
    nextY += 30 + drawTrendLegendOnCanvas(ctx, nextY + 30, periodTypeText, {
        includeNoSurveyData: !hasSurveys,
        includeUnavailableState: hasUnavailableCenterOrTrend
    });

    // The reliability note that used to follow is gone. It told the
    // associate to check Verint "if you believe this is an error" and said
    // policy starts at 16 hours against an 18 hour allowance (Scott,
    // 2026-10-14): a disclaimer, and a wrong one.
    return nextY;
}

function drawTrendMetricsSectionHeader(ctx, y, periodLabel) {
    ctx.fillStyle = '#e3f2fd';
    ctx.fillRect(40, y, 820, 50);
    ctx.fillStyle = '#003DA5';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('Your Metrics', 50, y + 32);
    y += 70;

    ctx.fillStyle = '#003DA5';
    ctx.fillRect(40, y, 820, 45);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Metric', 50, y + 28);
    ctx.textAlign = 'center';
    ctx.fillText('Your Metric', 280, y + 28);
    ctx.fillText('Center Avg', 380, y + 28);
    ctx.fillText('vs. Center Avg', 500, y + 28);
    ctx.textAlign = 'left';
    ctx.fillText(`Change vs last ${periodLabel}`, 570, y + 28);
    ctx.textAlign = 'center';
    ctx.fillText('YTD', 770, y + 28);
    ctx.textAlign = 'left';

    return y + 45;
}

function drawTrendMetricsTableBody(ctx, y, options) {
    const {
        metricOrder,
        metrics,
        prevMetrics,
        centerAvg,
        ytdEmployee,
        hasSurveys,
        surveyTotal,
        surveyCounts,
        ytdSurveyTotal,
        reviewYear,
        metadata,
        periodLabel
    } = options;

    // No note when there is no year-to-date file: the column is simply
    // blank. A "source data not provided" line is a caveat about our data,
    // and those stay off what the associate reads.

    let currentGroup = null;
    let rowIdx = 0;

    metricOrder.forEach(({ key, group }) => {
        if (metrics[key] === undefined) return;

        const metric = METRICS_REGISTRY[key];
        if (!metric) return;

        if (group !== currentGroup) {
            currentGroup = group;

            const isSurveyGroupNoSurveys = group === 'Survey' && !hasSurveys;
            const headerBgColor = isSurveyGroupNoSurveys ? '#ffffff' : '#e3f2fd';
            const headerTextColor = isSurveyGroupNoSurveys ? '#999999' : '#0056B3';

            ctx.fillStyle = headerBgColor;
            ctx.fillRect(40, y, 820, 40);
            ctx.fillStyle = headerTextColor;
            ctx.font = 'bold 16px Arial, "Segoe UI Emoji", "Apple Color Emoji"';

            let groupLabel;
            if (group === 'Survey') {
                const scope = (metadata.periodType === 'week' || metadata.periodType === 'week-in-progress') ? 'week' : periodLabel.toLowerCase();
                groupLabel = `Surveys: ${surveyTotal} this ${scope}, ${ytdSurveyTotal} so far this year`;
            } else {
                groupLabel = group;
            }

            ctx.fillText(groupLabel, 50, y + 26);
            y += 45;
            rowIdx = 0;
        }

        const curr = parseFloat(metrics[key]) || 0;
        const prev = prevMetrics[key] !== undefined ? parseFloat(prevMetrics[key]) : undefined;
        const center = getCenterAverageForMetric(centerAvg, key);
        const target = getMetricTrendTarget(key);
        const ytdValue = ytdEmployee ? ytdEmployee[key] : undefined;
        const rowSurveys = surveyCounts && Object.prototype.hasOwnProperty.call(surveyCounts, key) ? surveyCounts[key] : surveyTotal;

        renderMetricRow(ctx, 40, y, 820, 38, metric, curr, center, ytdValue, target, prev, rowIdx, '', rowSurveys, key, metadata.periodType, ytdSurveyTotal, reviewYear);
        y += 38;
        rowIdx++;
    });

    return y;
}

function drawTrendHighlightsSection(ctx, y, keyWins, improvedMetrics, focusMetrics, periodTypeText, previous) {
    y += 30;

    if (keyWins.length > 0) {
        ctx.fillStyle = '#e8f5e9';
        ctx.fillRect(40, y, 820, 40);
        ctx.fillStyle = '#1b5e20';
        ctx.font = 'bold 18px Arial';
        ctx.fillText('🏆 Key Wins (at goal and ahead of the center)', 50, y + 26);
        y += 50;

        keyWins.slice(0, 5).forEach(item => {
            ctx.fillStyle = '#333333';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(`- ${item.label}:`, 60, y + 20);
            ctx.font = '14px Arial';
            ctx.fillText(`${item.curr} (goal ${item.target}, center ${item.center})`, 220, y + 20);
            y += 35;
        });
    }

    if (improvedMetrics.length > 0 || previous) {
        y += 10;
        ctx.fillStyle = '#e3f2fd';
        ctx.fillRect(40, y, 820, 40);
        ctx.fillStyle = '#0d47a1';
        ctx.font = 'bold 18px Arial';
        ctx.fillText(`⭐ Highlights (better than last ${periodTypeText})`, 50, y + 26);
        y += 50;

        if (improvedMetrics.length === 0 && previous) {
            ctx.fillStyle = '#666666';
            ctx.font = '14px Arial';
            ctx.fillText(`- No gains on last ${periodTypeText} this time. Next ${periodTypeText} is a fresh start.`, 60, y + 20);
            y += 40;
        } else {
            improvedMetrics.slice(0, 5).forEach(item => {
                ctx.fillStyle = '#333333';
                ctx.font = 'bold 14px Arial';
                ctx.fillText(`- ${item.label}:`, 60, y + 20);
                ctx.font = '14px Arial';
                ctx.fillText(`${item.curr}, improved ${item.change} on last ${periodTypeText}`, 220, y + 20);
                y += 35;
            });
        }
    }

    if (focusMetrics.length > 0) {
        y += 10;
        ctx.fillStyle = '#fff3e0';
        ctx.fillRect(40, y, 820, 40);
        ctx.fillStyle = '#e65100';
        ctx.font = 'bold 18px Arial';
        ctx.fillText('Focus Areas (behind the center average)', 50, y + 26);
        y += 50;

        focusMetrics.slice(0, 5).forEach(item => {
            ctx.fillStyle = '#333333';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(`- ${item.label}:`, 60, y + 20);
            ctx.font = '14px Arial';
            ctx.fillText(`${item.curr} (center ${item.center}, goal ${item.target})`, 220, y + 20);
            y += 35;
        });
    }

    return y;
}

function drawTrendLegendOnCanvas(ctx, y, periodTypeText, options = {}) {
    const {
        includeNoSurveyData = true,
        includeUnavailableState = true
    } = options;

    const legendItems = [
        { color: '#d4edda', label: 'Meets goal' },
        { color: '#fff3cd', label: 'Below goal' },
        { color: '#0056B3', label: 'Above center average' },
        { color: '#DAA520', label: 'Below center average' },
        { color: '#28a745', label: `Improved on last ${periodTypeText}` },
        { color: '#dc3545', label: `Slipped from last ${periodTypeText}` },
        { color: '#6c757d', label: `No change from last ${periodTypeText}` }
    ];

    if (includeNoSurveyData) {
        legendItems.splice(2, 0, { color: '#ffffff', stroke: '#888888', label: 'No survey data (survey metrics)' });
    }

    if (includeUnavailableState) {
        legendItems.splice(includeNoSurveyData ? 5 : 4, 0, { color: '#999999', label: 'Center/trend unavailable' });
    }

    const legendColumns = 3;
    const legendRows = Math.ceil(legendItems.length / legendColumns);
    const legendRowHeight = 32;
    const legendTopPadding = 20;
    const legendBottomPadding = 16;
    const legendHeaderHeight = 30;
    const legendBoxHeight = legendTopPadding + legendHeaderHeight + (legendRows * legendRowHeight) + legendBottomPadding;
    const legendBoxX = 40;
    const legendBoxWidth = 820;
    const legendCellWidth = legendBoxWidth / legendColumns;
    const legendStartX = 50;
    const legendStartY = y + legendTopPadding + legendHeaderHeight;

    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(legendBoxX, y, legendBoxWidth, legendBoxHeight);

    ctx.fillStyle = '#003DA5';
    ctx.font = 'bold 18px Arial';
    ctx.fillText('Legend', 50, y + legendTopPadding + 10);

    legendItems.forEach((item, idx) => {
        const col = idx % legendColumns;
        const row = Math.floor(idx / legendColumns);
        const legendX = legendStartX + (col * legendCellWidth);
        const legendY = legendStartY + (row * legendRowHeight);

        if (item.symbol) {
            ctx.font = '16px Arial';
            ctx.fillStyle = item.color;
            ctx.fillText(item.symbol, legendX, legendY);
            ctx.fillStyle = '#333333';
            ctx.font = '13px Arial';
            ctx.fillText(item.label, legendX + 25, legendY);
        } else {
            ctx.fillStyle = item.color;
            ctx.fillRect(legendX, legendY - 12, 15, 15);
            if (item.stroke) {
                ctx.strokeStyle = item.stroke;
                ctx.lineWidth = 1;
                ctx.strokeRect(legendX, legendY - 12, 15, 15);
            }
            ctx.fillStyle = '#333333';
            ctx.font = '13px Arial';
            ctx.fillText(item.label, legendX + 22, legendY);
        }
    });

    return legendBoxHeight + 10;
}

function buildTrendMetricMaps(metricOrder, current, previous) {
    const metrics = {};
    const prevMetrics = {};

    metricOrder.forEach(({ key }) => {
        if (current?.[key] !== undefined) {
            metrics[key] = current[key];
        }
        if (previous?.[key] !== undefined) {
            prevMetrics[key] = previous[key];
        }
    });

    return { metrics, prevMetrics };
}

function copyTrendImageToClipboard(pngBlob, empName, period, onClipboardReady) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const dataUrl = e.target.result;
        const htmlEmail = `<html><body><img src="${dataUrl}" style="max-width: 100%; height: auto;"></body></html>`;

        if (navigator.clipboard && navigator.clipboard.write) {
            const htmlBlob = new Blob([htmlEmail], { type: 'text/html' });
            const htmlClipboardItem = new ClipboardItem({ 'text/html': htmlBlob });
            navigator.clipboard.write([htmlClipboardItem]).then(() => {
                if (window.DEBUG) console.log('HTML email with embedded image copied to clipboard');
                showToast('✅ Email with image ready to paste!', 3000);
                if (onClipboardReady) onClipboardReady();
            }).catch(err => {
                console.error('HTML clipboard error:', err);
                navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': pngBlob })
                ]).then(() => {
                    if (window.DEBUG) console.log('Image copied to clipboard (HTML failed)');
                    showToast('✅ Image copied to clipboard!', 3000);
                    if (onClipboardReady) onClipboardReady();
                }).catch(err2 => {
                    console.error('Image clipboard error:', err2);
                    // Nothing is saved to the computer (the work PC does not
                    // allow it), and the draft does not open: pasting into it
                    // would put in whatever picture was copied before.
                    showToast('The picture could not be copied: ' + (err2?.message || 'the clipboard refused it') + '. Try Send Metrics again.', 5000);
                });
            });
        } else {
            showToast('This browser cannot copy a picture, so the draft was not opened. Open the app in Chrome or Edge.', 5000);
        }
    };
    reader.readAsDataURL(pngBlob);
}

function calculateTrendSurveyTotals(current, metadata) {
    let surveyTotal = current.surveyTotal ? parseInt(current.surveyTotal, 10) : 0;
    let ytdSurveyTotal = 0;

    if (current?.isTeamAggregate) {
        ytdSurveyTotal = surveyTotal;
        return { surveyTotal, ytdSurveyTotal };
    }

    const currentEndDate = metadata.endDate || '';
    const currentYear = currentEndDate.substring(0, 4);

    if (DEBUG) {
        console.log(`=== YTD SURVEY LOOKUP (${current.name}) for ${metadata.periodType} ===`);
        console.log(`Current period: ${currentEndDate}, year: ${currentYear}`);
    }

    let aggregatedYtdSurveys = 0;
    for (const wk in weeklyData) {
        const weekMeta = weeklyData[wk]?.metadata || {};
        const weekEndDate = weekMeta.endDate || wk.split('|')[1] || '';
        const weekYear = weekEndDate.substring(0, 4);
        const weekPeriodType = weekMeta.periodType || 'week';

        if (weekPeriodType === 'week' && weekYear === currentYear && weekEndDate <= currentEndDate) {
            const weekEmp = weeklyData[wk]?.employees?.find(e => e.name === current.name);
            if (weekEmp && weekEmp.surveyTotal) {
                const weekSurvey = parseInt(weekEmp.surveyTotal, 10);
                aggregatedYtdSurveys += weekSurvey;
                if (DEBUG) console.log(`  Adding ${wk}: +${weekSurvey} surveys (running total: ${aggregatedYtdSurveys})`);
            }
        }
    }

    ytdSurveyTotal = aggregatedYtdSurveys;

    if (metadata.periodType === 'month' || metadata.periodType === 'ytd') {
        surveyTotal = ytdSurveyTotal;
        if (DEBUG) console.log(`${metadata.periodType} aggregated surveys: ${surveyTotal}`);
    }

    if (DEBUG) console.log(`Final: surveyTotal=${surveyTotal}, ytdSurveyTotal=${ytdSurveyTotal}, periodType=${metadata.periodType}`);

    return { surveyTotal, ytdSurveyTotal };
}

function calculateTrendSummaryStats(metricOrder, metrics, prevMetrics, centerAvg, previous, hasSurveys) {
    const surveyMetricKeys = ['cxRepOverall', 'fcr', 'overallExperience'];
    let meetingGoals = 0;
    let improved = 0;
    let beatingCenter = 0;
    let measuredMetricCount = 0;

    metricOrder.forEach(({ key }) => {
        if (metrics[key] === undefined) return;

        if (!hasSurveys && surveyMetricKeys.includes(key)) return;

        measuredMetricCount++;

        const curr = parseFloat(metrics[key]) || 0;
        const target = getMetricTrendTarget(key);
        const center = getCenterAverageForMetric(centerAvg, key);

        if (isMetricMeetingTarget(key, curr, target)) meetingGoals++;

        if (center > 0) {
            const isReverse = isReverseMetric(key);
            if (isReverse ? curr < center : curr > center) {
                beatingCenter++;
            }
        }

        // Better by the metric's own direction: handle time coming down is
        // an improvement, and it used to be counted the other way.
        if (previous && prevMetrics[key] !== undefined) {
            const prev = parseFloat(prevMetrics[key]) || 0;
            if (isReverseMetric(key) ? curr < prev : curr > prev) improved++;
        }
    });

    const totalMetrics = measuredMetricCount;
    const successRate = Math.round(meetingGoals / totalMetrics * 100);
    const improvedText = previous ? improved.toString() : 'N/A';

    return {
        meetingGoals,
        improved,
        beatingCenter,
        totalMetrics,
        successRate,
        improvedText
    };
}

function buildTrendHighlightsData(metricOrder, metrics, prevMetrics, centerAvg, previous) {
    const improvedMetrics = [];
    const keyWins = [];
    const focusMetrics = [];

    metricOrder.forEach(({ key }) => {
        if (metrics[key] === undefined) return;
        const metric = METRICS_REGISTRY[key];
        if (!metric) return;

        const curr = parseFloat(metrics[key]) || 0;
        const prev = prevMetrics[key] !== undefined ? parseFloat(prevMetrics[key]) : undefined;
        const center = getCenterAverageForMetric(centerAvg, key);
        const target = getMetricTrendTarget(key);
        const isReverse = isReverseMetric(key);

        if (previous && prev !== undefined && prev !== null) {
            const change = curr - prev;
            const hasImproved = isReverse ? change < 0 : change > 0;

            if (hasImproved && Math.abs(change) > 0.1) {
                improvedMetrics.push({
                    label: metric.label,
                    curr: formatMetricDisplay(key, curr),
                    // Points for a rate, seconds for a time.
                    change: formatTrendChange(key, change)
                });
            }
        }

        const meetingTarget = isReverse ? curr <= target : curr >= target;
        const beatingCenter = center > 0 && (isReverse ? curr < center : curr > center);
        if (meetingTarget && beatingCenter) {
            keyWins.push({
                label: metric.label,
                curr: formatMetricDisplay(key, curr),
                target: formatMetricDisplay(key, target),
                center: formatMetricDisplay(key, center)
            });
        }

        if (center > 0) {
            const isBelowCenter = isReverse ? curr > center : curr < center;
            if (isBelowCenter) {
                focusMetrics.push({
                    label: metric.label,
                    curr: formatMetricDisplay(key, curr),
                    center: formatMetricDisplay(key, center),
                    target: formatMetricDisplay(key, target)
                });
            }
        }
    });

    return { improvedMetrics, keyWins, focusMetrics };
}


function drawEmailCard(ctx, x, y, w, h, bgColor, borderColor, title, mainText, subText) {
    // Card background
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, y, w, h);

    // Border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);

    // Text
    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(title, x + w/2, y + 30);

    ctx.font = 'bold 40px Arial';
    ctx.fillText(mainText, x + w/2, y + 75);

    ctx.font = '13px Arial';
    ctx.fillStyle = '#666';
    ctx.fillText(subText, x + w/2, y + 100);

    ctx.textAlign = 'left';
}

function wrapCanvasTextLines(ctx, text, maxWidth) {
    const safeText = String(text || '').trim();
    if (!safeText) return [''];

    const words = safeText.split(/\s+/);
    const lines = [];
    let currentLine = '';

    words.forEach(word => {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth) {
            currentLine = candidate;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    });

    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : [''];
}

function drawTrendSummaryBoxesOnCanvas(ctx, x, y, totalWidth, positiveHighlights, improvementAreas, positiveEmptyText, improvementEmptyText) {
    const gap = 16;
    const boxWidth = (totalWidth - gap) / 2;
    const leftX = x;
    const rightX = x + boxWidth + gap;
    const padding = 14;
    const titleHeight = 24;
    const lineHeight = 21;
    const maxTextWidth = boxWidth - (padding * 2) - 8;

    const buildLines = (items, emptyText) => {
        const source = Array.isArray(items) && items.length > 0 ? items : [emptyText || 'No items.'];
        const lines = [];
        source.forEach(item => {
            const wrapped = wrapCanvasTextLines(ctx, `• ${item}`, maxTextWidth);
            wrapped.forEach(line => lines.push(line));
        });
        return lines;
    };

    ctx.font = '12px Arial';
    const positiveLines = buildLines(positiveHighlights, positiveEmptyText);
    const improvementLines = buildLines(improvementAreas, improvementEmptyText);
    const maxLines = Math.max(positiveLines.length, improvementLines.length, 1);
    const boxHeight = padding + titleHeight + 8 + (maxLines * lineHeight) + padding;

    // Positive box
    ctx.fillStyle = '#e8f5e9';
    ctx.strokeStyle = '#81c784';
    ctx.lineWidth = 1;
    ctx.fillRect(leftX, y, boxWidth, boxHeight);
    ctx.strokeRect(leftX, y, boxWidth, boxHeight);

    ctx.fillStyle = '#2e7d32';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('Positive Highlights', leftX + padding, y + padding + 18);

    ctx.fillStyle = '#1b5e20';
    ctx.font = '12px Arial';
    positiveLines.forEach((line, index) => {
        ctx.fillText(line, leftX + padding, y + padding + titleHeight + 16 + (index * lineHeight));
    });

    // Improvement box
    ctx.fillStyle = '#ffebee';
    ctx.strokeStyle = '#ef9a9a';
    ctx.lineWidth = 1;
    ctx.fillRect(rightX, y, boxWidth, boxHeight);
    ctx.strokeRect(rightX, y, boxWidth, boxHeight);

    ctx.fillStyle = '#c62828';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('Next Goals', rightX + padding, y + padding + 18);

    ctx.fillStyle = '#b71c1c';
    ctx.font = '12px Arial';
    improvementLines.forEach((line, index) => {
        ctx.fillText(line, rightX + padding, y + padding + titleHeight + 16 + (index * lineHeight));
    });

    return boxHeight;
}

function getMetricTarget(metric, reviewYear = null) {
    const profileModule = window.DevCoachModules?.metricProfiles || null;

    const parsedYear = parseInt(reviewYear, 10);
    if (Number.isInteger(parsedYear)) {
        const yearTarget = profileModule?.getYearTarget
            ? profileModule.getYearTarget(metric, parsedYear)
            : YEAR_END_TARGETS_BY_YEAR[parsedYear]?.[metric];
        if (yearTarget && yearTarget.value !== undefined && yearTarget.value !== null) {
            return yearTarget.value;
        }
    }

    // PHASE 3 - Use METRICS_REGISTRY as default source of truth
    const metricDef = METRICS_REGISTRY[metric];
    if (metricDef && metricDef.target) {
        return metricDef.target.value;
    }

    return 90; // Safe fallback
}

// The year's own target (carried forward into a year with none yet), then the
// registry's year-less one. Viewing 2025 data used to grade Rep Sat against 82
// instead of 80, and AHT against 426 instead of 440.
function getMetricTrendTarget(metricKey, year = null) {
    const yearNum = parseInt(year, 10);
    return getMetricTarget(metricKey, Number.isInteger(yearNum) ? yearNum : new Date().getFullYear());
}

function getMetricTrendTargetType(metricKey) {
    return METRICS_REGISTRY[metricKey]?.target?.type || 'min';
}

function formatMetricValue(key, value) {
    const metric = METRICS_REGISTRY[key];
    if (!metric) return value.toFixed(1);

    if (metric.unit === 'sec') {
        // Seconds - no decimal points
        return Math.round(value).toString();
    } else if (metric.unit === '%') {
        // Percentages - one decimal point
        return value.toFixed(1);
    } else if (metric.unit === 'hrs') {
        // Hours - one decimal point (not rounded to whole number)
        return value.toFixed(1);
    } else {
        // Raw numbers - no decimal points
        return Math.round(value).toString();
    }
}

function formatMetricDisplay(key, value) {
    const metric = METRICS_REGISTRY[key];
    if (!metric) return value.toString();

    // A whole number reads without its ".0": "93%", "100%", "18 hrs". Scott,
    // 2026-10-14: the numbers associates read should be simple. One decimal
    // stays wherever it says something, so 95.1% is still 95.1%.
    const formatted = formatMetricValue(key, value).replace(/\.0$/, '');

    if (metric.unit === 'sec') {
        return `${formatted}s`;
    } else if (metric.unit === '%') {
        return `${formatted}%`;
    } else if (metric.unit === 'hrs') {
        return `${formatted} hrs`;
    } else {
        return formatted;
    }
}

function getCenterAverageForMetric(centerAvg, metricKey) {
    // Map metric keys to center average keys
    const keyMapping = {
        scheduleAdherence: 'adherence',
        overallSentiment: 'sentiment',
        cxRepOverall: 'repSatisfaction'
    };

    const lookupKey = keyMapping[metricKey] || metricKey;
    return parseFloat(centerAvg[lookupKey]) || 0;
}

function parseIsoDateSafe(dateText) {
    if (!dateText || typeof dateText !== 'string') return null;
    const parts = dateText.split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [year, month, day] = parts;
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

/**
 * Find the latest real (non-auto) YTD upload for a given year.
 * This is the "anchor" — the source of truth uploaded by the user.
 */
function findRealYtdAnchor(yearNum) {
    let best = null;
    Object.entries(ytdData || {}).forEach(([key, entry]) => {
        const metadata = entry?.metadata || {};
        if (metadata.autoGeneratedYtd) return; // skip auto-generated
        const endDateText = metadata.endDate || (key.includes('|') ? key.split('|')[1] : '');
        const endDate = parseIsoDateSafe(endDateText);
        if (!endDate || endDate.getFullYear() !== yearNum) return;
        const periodType = metadata.periodType || '';
        if (periodType !== 'ytd') return;
        if (!best || endDate > best.endDate) {
            best = { key, entry, endDate, endDateText };
        }
    });
    return best;
}

/**
 * The calls behind each anchor row that has none of its own.
 *
 * The YTD export carries no calls column and the parser fills it with the
 * survey count, so the anchor claimed 28 calls for nine months beside a real
 * two-day upload of 50, and the blend was two days with the year as seasoning:
 * handle time 393s in the file came out 510s. Where the row has no real count
 * it is given the associate's run rate from the year's uploads over the weeks
 * the file covers: futures.estimateYtdCalls, the one estimate every reader of
 * a YTD file's calls shares, so the blend and the projection cannot drift.
 *
 * Returns { name: calls } for the rows it could estimate. A row left out keeps
 * the weight it had.
 */
function estimateAnchorCalls(anchor) {
    const estimate = window.DevCoachModules?.futures?.estimateYtdCalls;
    if (typeof estimate !== 'function' || !anchor?.entry) return {};
    return estimate(anchor.entry, { isYtd: true }) || {};
}

/**
 * Build auto-YTD aggregate for a year.
 *
 * Strategy:
 * 1. If a real YTD anchor exists, use it as the base and only append
 *    periods that fall AFTER the anchor's end date.
 * 2. If no anchor exists, aggregate all periods from scratch (original behavior).
 *
 * When a real YTD is the anchor, its employees are seeded directly
 * (their call and survey counts act as the weight, the calls estimated by
 * estimateAnchorCalls when the file has none), then newer periods are
 * layered on via weighted averaging. This preserves accurate survey data
 * from the real YTD while extending with newer daily/weekly data.
 */
function buildYtdAggregateForYear(year, uptoEndDateText) {
    const yearNum = parseInt(year, 10);
    const uptoEndDate = parseIsoDateSafe(uptoEndDateText);
    if (!Number.isInteger(yearNum) || !uptoEndDate) return null;

    const metricKeysToAverage = [
        'scheduleAdherence', 'transfers', 'cxRepOverall', 'fcr', 'overallExperience',
        'aht', 'talkTime', 'acw', 'holdTime', 'overallSentiment', 'managingEmotions',
        'negativeWord', 'positiveWord'
    ];
    const surveyWeightedMetrics = new Set(['cxRepOverall', 'fcr', 'overallExperience']);

    // Step 1: Find the real YTD anchor
    const anchor = findRealYtdAnchor(yearNum);
    const anchorEndDate = anchor ? anchor.endDate : null;

    // Step 2: Collect extension periods (after anchor, or all if no anchor)
    const allPeriods = Object.entries(weeklyData || {})
        .map(([periodKey, period]) => {
            const metadata = period?.metadata || {};
            const periodType = metadata.periodType || 'week';
            const endDateText = metadata.endDate || (periodKey.includes('|') ? periodKey.split('|')[1] : '');
            const startDateText = metadata.startDate || (periodKey.includes('|') ? periodKey.split('|')[0] : '');
            const endDate = parseIsoDateSafe(endDateText);
            const startDate = parseIsoDateSafe(startDateText);
            return { periodKey, period, metadata, periodType, endDateText, endDate, startDate };
        })
        .filter(item => {
            if (!item.endDate) return false;
            if (!['week', 'week-in-progress', 'month', 'quarter', 'custom'].includes(item.periodType)) return false;
            if (item.endDate.getFullYear() !== yearNum) return false;
            if (item.endDate > uptoEndDate) return false;
            // If we have an anchor, only include periods that START after the anchor's end date
            if (anchorEndDate) {
                const periodStart = item.startDate || item.endDate;
                return periodStart > anchorEndDate;
            }
            return true;
        })
        .sort((a, b) => a.endDate - b.endDate);

    // If no anchor and no extension periods, nothing to build
    if (!anchor && !allPeriods.length) return null;

    // If anchor exists but no extension periods, no auto-YTD needed — the real YTD is the truth
    if (anchor && !allPeriods.length) return null;

    // Step 3: If no anchor, pick best source type (original behavior)
    // One source type only, whether or not there is an anchor.
    //
    // Calls, surveys, transfers and now reliability all ACCUMULATE here, so a month
    // upload sitting alongside the weeks it already covers gets counted twice. That
    // was true before for volume, and reliability becoming additive makes it worse —
    // double-counted hours push people over an 18-hour budget they never breached.
    // Restricting to a single granularity was previously done only when there was no
    // anchor; there is no reason the anchored path should be looser.
    let extensionPeriods = allPeriods;
    let sourceType = 'mixed';
    if (allPeriods.length) {
        const sourceTypePriority = ['week', 'week-in-progress', 'month', 'quarter', 'custom'];
        sourceType = sourceTypePriority.find(type => allPeriods.some(item => item.periodType === type)) || allPeriods[0]?.periodType;
        extensionPeriods = allPeriods.filter(item => item.periodType === sourceType);
    }

    // Step 4: Build aggregation
    const aggregatedEmployees = {};

    // Only needed when something is being layered on: with no extension the
    // anchor's own weight never meets another period's.
    const anchorCalls = (anchor && extensionPeriods.length) ? estimateAnchorCalls(anchor) : {};

    // Helper to add an employee record into the aggregate.
    //
    // isAnchor marks the seed pass over a real YTD upload. That upload already
    // holds a running total, so reliability is SET from it; every later period
    // carries hours missed in that period alone and is ADDED on top.
    function addEmployeeToAggregate(emp, isAnchor) {
        if (!emp?.name) return;

        if (!aggregatedEmployees[emp.name]) {
            aggregatedEmployees[emp.name] = {
                name: emp.name,
                firstName: emp.firstName,
                transfersCount: 0,
                surveyTotal: 0,
                reliability: 0,
                totalCalls: 0,
                weightedSums: {},
                weightedCounts: {}
            };
        }

        const agg = aggregatedEmployees[emp.name];
        const surveyTotal = parseInt(emp.surveyTotal, 10);
        const totalCalls = (isAnchor && Number.isInteger(anchorCalls[emp.name]))
            ? anchorCalls[emp.name]
            : parseInt(emp.totalCalls, 10);

        agg.transfersCount += Number.isFinite(parseFloat(emp.transfersCount)) ? parseFloat(emp.transfersCount) : 0;
        agg.surveyTotal += Number.isInteger(surveyTotal) ? surveyTotal : 0;
        agg.totalCalls += Number.isInteger(totalCalls) ? totalCalls : 0;

        // Reliability is hours missed, and a weekly or monthly upload carries the
        // hours missed IN THAT PERIOD — a typical sequence is 0, 0, 0, 8.5, 0, one
        // full day (8h + half-hour lunch) among zeroes. This used to take the
        // highest value seen, on the belief that the column was a running total.
        // It is not, for anything but a YTD upload: maxing kept a person's single
        // worst week and silently discarded every other absence, which understated
        // the year against an 18-hour budget and handed people a pass.
        //
        // A YTD upload IS a running total, so it seeds the value rather than adding
        // to it. Everything after it accumulates.
        var rel = Number.isFinite(parseFloat(emp.reliability)) ? parseFloat(emp.reliability) : 0;
        if (isAnchor) {
            if (rel > agg.reliability) agg.reliability = rel;
        } else {
            agg.reliability += rel;
        }

        metricKeysToAverage.forEach(metricKey => {
            const metricValue = parseFloat(emp[metricKey]);
            if (!Number.isFinite(metricValue)) return;

            // Each survey question by its own response count. Weighting all
            // three by surveyTotal put a rep-sat figure behind the Overall
            // Experience denominator, and made a period nobody answered
            // rep-sat in indistinguishable from one that scored 0%.
            let weight = 1;
            if (surveyWeightedMetrics.has(metricKey)) {
                const responses = typeof window.getSurveyWeight === 'function'
                    ? window.getSurveyWeight(metricKey, emp)
                    : surveyTotal;
                weight = Number.isFinite(responses) && responses > 0 ? responses : 0;
            } else {
                weight = Number.isInteger(totalCalls) && totalCalls > 0 ? totalCalls : 1;
            }
            if (weight <= 0) return;

            agg.weightedSums[metricKey] = (agg.weightedSums[metricKey] || 0) + (metricValue * weight);
            agg.weightedCounts[metricKey] = (agg.weightedCounts[metricKey] || 0) + weight;
        });
    }

    // Seed with anchor data (the real YTD — this is the truth).
    // Called with an explicit arg: forEach passes the index as the second
    // argument, which would mark every employee after the first as an anchor.
    if (anchor) {
        (anchor.entry?.employees || []).forEach(emp => addEmployeeToAggregate(emp, true));
    }

    // Layer on extension periods
    extensionPeriods.forEach(({ period }) => {
        (period?.employees || []).forEach(emp => addEmployeeToAggregate(emp, false));
    });

    // Step 5: Calculate weighted averages
    Object.keys(aggregatedEmployees).forEach(name => {
        const agg = aggregatedEmployees[name];
        metricKeysToAverage.forEach(metricKey => {
            const totalWeight = agg.weightedCounts[metricKey] || 0;
            if (totalWeight > 0) {
                agg[metricKey] = agg.weightedSums[metricKey] / totalWeight;
            }
        });
        delete agg.weightedSums;
        delete agg.weightedCounts;
    });

    const ytdStartText = `${yearNum}-01-01`;
    const ytdKey = `${ytdStartText}|${uptoEndDateText}`;
    const endDateObj = parseIsoDateSafe(uptoEndDateText);

    const anchorLabel = anchor ? ` (anchored to YTD through ${anchor.endDateText})` : '';
    const extCount = extensionPeriods.length;
    const ytdLabel = endDateObj
        ? `Auto YTD through ${endDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` +
          (anchor && extCount > 0 ? ` (+${extCount} newer)` : '')
        : `Auto YTD through ${uptoEndDateText}`;

    return {
        key: ytdKey,
        entry: {
            employees: Object.values(aggregatedEmployees),
            metadata: {
                startDate: ytdStartText,
                endDate: uptoEndDateText,
                label: ytdLabel,
                periodType: 'ytd',
                autoGeneratedYtd: true,
                anchorYtdKey: anchor ? anchor.key : null,
                sourcePeriodType: anchor ? 'anchor+extension' : sourceType,
                extensionPeriodCount: extCount,
                yearEndTargetProfile: 'auto',
                yearEndReviewYear: String(yearNum),
                uploadedAt: new Date().toISOString()
            }
        }
    };
}

function upsertAutoYtdForYear(year, uptoEndDateText) {
    const yearNum = parseInt(year, 10);

    // Always clean up old auto-generated YTDs for this year (never touch real uploads)
    Object.keys(ytdData || {}).forEach(existingKey => {
        const existing = ytdData[existingKey];
        const metadata = existing?.metadata || {};
        if (!metadata.autoGeneratedYtd) return;
        const existingEndDateText = metadata.endDate || (existingKey.includes('|') ? existingKey.split('|')[1] : '');
        const existingEndDate = parseIsoDateSafe(existingEndDateText);
        if (!existingEndDate) return;
        if (existingEndDate.getFullYear() === yearNum) {
            delete ytdData[existingKey];
        }
    });

    const aggregate = buildYtdAggregateForYear(year, uptoEndDateText);
    if (!aggregate) return; // No auto-YTD needed (anchor exists with no extensions, or no data)

    // If a real YTD exists at this exact key, store auto with disambiguated key
    const existingEntry = ytdData[aggregate.key];
    if (existingEntry && existingEntry.metadata && !existingEntry.metadata.autoGeneratedYtd) {
        ytdData[aggregate.key + '|auto'] = aggregate.entry;
        return;
    }

    ytdData[aggregate.key] = aggregate.entry;
}

function getYtdPeriodForWeekKey(weekKey) {
    if (!weekKey) return null;
    const parts = weekKey.split('|');
    const endDate = parts[1] || '';
    if (!endDate) return null;

    // First, try to find explicit YTD data
    const matchingKey = Object.keys(ytdData).find(key => {
        const metadataEndDate = ytdData[key]?.metadata?.endDate;
        return (metadataEndDate && metadataEndDate === endDate) || key.split('|')[1] === endDate;
    });
    if (matchingKey) {
        return ytdData[matchingKey];
    }

    // If no explicit YTD data, calculate from uploaded periods up to this end date
    const yearNum = parseInt(endDate.split('-')[0], 10);
    if (!Number.isInteger(yearNum)) return null;
    const aggregate = buildYtdAggregateForYear(yearNum, endDate);
    return aggregate ? aggregate.entry : null;
}



function isMetricMeetingTarget(metric, value, target) {
    // Judged as printed, like metricProfiles.meetsYearTarget, so 92.96 shown as
    // "93.0%" is not "below" a 93 target here while meeting it elsewhere.
    const rounder = window.DevCoachModules?.metricProfiles?.roundToDisplayPrecision;
    if (typeof rounder === 'function') {
        const rounded = rounder(metric, value);
        if (Number.isFinite(rounded)) value = rounded;
    }
    // PHASE 3 - Use METRICS_REGISTRY target type
    const metricDef = METRICS_REGISTRY[metric];
    if (metricDef && metricDef.target) {
        return metricDef.target.type === 'min' ? value >= target : value <= target;
    }
    // Fallback: assume 'min' type
    return value >= target;
}

function buildTrendHighlightsAndImprovements(allTrendMetrics) {
    const safeMetrics = Array.isArray(allTrendMetrics) ? allTrendMetrics : [];
    const positiveHighlights = [];
    const improvementAreas = [];

    safeMetrics.forEach(metric => {
        if (!metric || !metric.metricKey || metric.employeeValue === undefined || metric.target === undefined) {
            return;
        }

        // "Transfers: 7.5% (goal 6% or lower)" rather than "vs target 6%",
        // which never said which way the goal runs.
        const currentDisplay = formatMetricDisplay(metric.metricKey, metric.employeeValue);
        const line = `${metric.label}: ${currentDisplay} (${trendGoalPhrase(metric.metricKey, metric.target)})`;

        if (metric.meetsTarget) {
            positiveHighlights.push(line);
        } else {
            improvementAreas.push(line);
        }
    });

    return { positiveHighlights, improvementAreas };
}

function renderTrendSummaryBoxesHtml(positiveHighlights, improvementAreas, positiveEmptyText, improvementEmptyText) {
    const renderListItems = (items) => items.map(item => `<li style="margin: 0 0 6px 0;">${escapeHtml(item)}</li>`).join('');

    const positiveHtml = positiveHighlights.length > 0
        ? `<ul style="margin: 0; padding-left: 20px;">${renderListItems(positiveHighlights)}</ul>`
        : `<p style="margin: 0; color: var(--green-text);">${escapeHtml(positiveEmptyText || 'No above-target metrics in this period.')}</p>`;

    const improvementHtml = improvementAreas.length > 0
        ? `<ul style="margin: 0; padding-left: 20px;">${renderListItems(improvementAreas)}</ul>`
        : `<p style="margin: 0; color: var(--red-text);">${escapeHtml(improvementEmptyText || 'No below-target metrics in this period.')}</p>`;

    return `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0 20px 0;">
            <div style="padding: 14px; border: 1px solid #81c784; border-radius: 8px; background: var(--green-soft); color: var(--green-text);">
                <h4 style="margin: 0 0 10px 0; color: var(--green-text);">✅ Positive Highlights</h4>
                ${positiveHtml}
            </div>
            <div style="padding: 14px; border: 1px solid #ef9a9a; border-radius: 8px; background: var(--red-soft); color: var(--red-text);">
                <h4 style="margin: 0 0 10px 0; color: var(--red-text);">⚠️ Improvement Areas</h4>
                ${improvementHtml}
            </div>
        </div>
    `;
}

function buildTeamTrendCoachingPrompt(periodLabel, teamMetrics, teamSize) {
    // A team's weekly hours set against the year's 18 hour allowance can only
    // ever read as a win, so reliability is left out of the team message.
    const { positiveHighlights, improvementAreas } = buildTrendHighlightsAndImprovements(coachableTrendMetrics(teamMetrics));
    let prompt = `Draft a concise team coaching update for ${periodLabel}.\n`;
    prompt += `Audience: the full team (${teamSize} associates in this data set).\n\n`;

    prompt += `POSITIVE HIGHLIGHTS:\n`;
    if (positiveHighlights.length > 0) {
        positiveHighlights.forEach(line => {
            prompt += `- ${line}\n`;
        });
    } else {
        prompt += `- No above-target metrics in this period.\n`;
    }
    prompt += `\n`;

    prompt += `IMPROVEMENT AREAS:\n`;
    if (improvementAreas.length > 0) {
        improvementAreas.forEach(line => {
            prompt += `- ${line}\n`;
        });
    } else {
        prompt += `- No below-target metrics in this period.\n`;
    }
    prompt += `\n`;

    prompt += `Write in a warm, motivational tone. Lead with the wins and celebrate them, keep it factual, avoid fluff, and end with 2-3 team actions for next period. At most 2 emojis, no em dashes, and do not mention attendance or reliability.`;
    return prompt;
}

function getFilteredEmployeesForPeriod(period, context = null) {
    if (!period || !Array.isArray(period.employees)) return [];

    const teamFilterContext = context || getTeamSelectionContext();
    return period.employees.filter(emp => isAssociateIncludedByTeamFilter(emp?.name, teamFilterContext));
}

function collectTeamTrendMetrics(period) {
    const teamFilterContext = getTeamSelectionContext();
    const filteredEmployees = getFilteredEmployeesForPeriod(period, teamFilterContext);
    if (!filteredEmployees.length) return [];

    const SURVEY_WEIGHTED = { cxRepOverall: true, fcr: true, overallExperience: true };
    const teamMetrics = [];

    getMetricOrder().forEach(({ key }) => {
        const metricDef = METRICS_REGISTRY[key];
        if (!metricDef) return;

        let teamValue;
        if (key === 'reliability') {
            // Hours per person, not the team's total.
            //
            // Reliability accrues across PERIODS for one associate, so summing
            // there is right. Summing across PEOPLE gives a total, and the very
            // next lines compare this figure against the PER-PERSON 18-hour
            // budget. Ten associates on 4 hours each came out as 40.0 hrs
            // against a target of 18, so the prompt listed Reliability as an
            // improvement area for every team that has ever missed an hour --
            // it could not do anything else.
            let sum = 0, people = 0;
            filteredEmployees.forEach(emp => {
                const v = parseFloat(emp[key]);
                if (Number.isFinite(v)) { sum += v; people += 1; }
            });
            if (!people) return;
            teamValue = sum / people;
        } else {
            // Rate metrics: weighted average
            let wSum = 0, wCount = 0;
            filteredEmployees.forEach(emp => {
                const v = parseFloat(emp[key]);
                if (!Number.isFinite(v)) return;
                const tc = parseInt(emp.totalCalls, 10);
                const st = parseInt(emp.surveyTotal, 10);
                let w = 1;
                if (SURVEY_WEIGHTED[key]) {
                    // Each survey question by its own response count.
                    const responses = typeof window.getSurveyWeight === 'function'
                        ? window.getSurveyWeight(key, emp)
                        : st;
                    w = Number.isFinite(responses) && responses > 0 ? responses : 0;
                } else {
                    w = Number.isInteger(tc) && tc > 0 ? tc : 1;
                }
                if (w > 0) { wSum += v * w; wCount += w; }
            });
            if (wCount === 0) return;
            teamValue = wSum / wCount;
        }

        const target = getMetricTrendTarget(key, String(period?.metadata?.endDate || '').slice(0, 4));
        const targetType = getMetricTrendTargetType(key);
        const meetsTarget = targetType === 'min' ? teamValue >= target : teamValue <= target;

        teamMetrics.push({
            metricKey: key,
            label: metricDef.label,
            employeeValue: teamValue,
            target,
            targetType,
            meetsTarget,
            gapFromTarget: targetType === 'min'
                ? Math.max(0, target - teamValue)
                : Math.max(0, teamValue - target)
        });
    });

    return teamMetrics;
}

function buildTeamTrendAggregateEmployee(period) {
    if (!period || !Array.isArray(period.employees) || period.employees.length === 0) {
        return null;
    }

    const teamFilterContext = getTeamSelectionContext();
    const filteredEmployees = getFilteredEmployeesForPeriod(period, teamFilterContext);
    if (!filteredEmployees.length) return null;

    const SURVEY_WEIGHTED = { cxRepOverall: true, fcr: true, overallExperience: true };
    const aggregate = { name: 'Team Combined', isTeamAggregate: true };

    // First compute totalCalls and surveyTotal (needed for weighting)
    const totalSurveyCount = filteredEmployees
        .map(emp => {
            const surveyTotal = parseFloat(emp?.surveyTotal);
            if (!Number.isNaN(surveyTotal)) {
                return surveyTotal;
            }
            return parseFloat(emp?.surveysOffered);
        })
        .filter(value => !Number.isNaN(value))
        .reduce((sum, value) => sum + value, 0);

    if (totalSurveyCount > 0) {
        aggregate.surveyTotal = totalSurveyCount;
    }

    const totalCalls = filteredEmployees
        .map(emp => parseFloat(emp?.totalCalls))
        .filter(value => !Number.isNaN(value))
        .reduce((sum, value) => sum + value, 0);

    if (totalCalls > 0) {
        aggregate.totalCalls = totalCalls;
    }

    // Compute metrics with proper weighting
    getMetricOrder().forEach(({ key }) => {
        if (key === 'reliability') {
            // Hours per person, as in the team prompt above: this figure is
            // graded against the per-person 18-hour budget.
            let sum = 0, people = 0;
            filteredEmployees.forEach(emp => {
                const v = parseFloat(emp?.[key]);
                if (Number.isFinite(v)) { sum += v; people += 1; }
            });
            if (people > 0) aggregate[key] = sum / people;
        } else {
            // Rate metrics: weighted average. Survey metrics weigh by that
            // question's own responses; surveyTotal let a 0% from someone with
            // no rep-sat responses count at their full survey volume.
            let wSum = 0, wCount = 0;
            filteredEmployees.forEach(emp => {
                const v = parseFloat(emp?.[key]);
                if (!Number.isFinite(v)) return;
                const tc = parseInt(emp?.totalCalls, 10);
                const st = typeof window.getSurveyWeight === 'function'
                    ? window.getSurveyWeight(key, emp)
                    : parseInt(emp?.surveyTotal, 10);
                let w = 1;
                if (SURVEY_WEIGHTED[key]) {
                    w = Number.isInteger(st) && st > 0 ? st : 0;
                } else {
                    w = Number.isInteger(tc) && tc > 0 ? tc : 1;
                }
                if (w > 0) { wSum += v * w; wCount += w; }
            });
            if (wCount > 0) aggregate[key] = wSum / wCount;
        }
    });

    return aggregate;
}

function createTeamTrendSummaryModal() {
    const modal = document.createElement('div');
    modal.id = 'teamTrendSummaryModal';
    modal.style.cssText = `
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
    return modal;
}

function createTeamTrendSummaryPanel(periodLabel, teamSize, summaryBoxesHtml, teamPrompt) {
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: var(--bg-surface);
        border-radius: 8px;
        padding: 24px;
        max-width: 900px;
        width: 92%;
        max-height: 88vh;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;

    panel.innerHTML = `
        <h3 style="color: var(--green-text); margin-top: 0;">👥 Team Metric Trend Summary</h3>
        <p style="color: var(--text-secondary); margin-bottom: 6px; font-size: 0.95em;">${escapeHtml(periodLabel)}</p>
        <p style="color: var(--text-secondary); margin: 0 0 14px 0; font-size: 0.9em;">Based on ${teamSize} associates</p>

        ${summaryBoxesHtml}

        <div style="margin: 20px 0; padding: 15px; background: var(--bg-surface-raised); border-radius: 4px; border: 1px solid var(--border);">
            <h4 style="color: var(--text-primary); margin-top: 0;">🤖 Team CoPilot Prompt</h4>
            <textarea id="teamTrendPromptDisplay" readonly style="width: 100%; height: 180px; padding: 10px; border: 1px solid var(--border); border-radius: 4px; font-family: 'Courier New', monospace; font-size: 0.85em; background: var(--bg-surface); color: var(--text-primary);">${escapeHtml(teamPrompt)}</textarea>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap;">
            <button id="copyTeamTrendPromptBtn" style="flex: 1; min-width: 180px; padding: 12px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">📋 Copy Prompt</button>
            <button id="openTeamTrendEmailBtn" style="flex: 1; min-width: 180px; padding: 12px; background: #2e7d32; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">📧 Open Team Email Draft</button>
            <button id="closeTeamTrendSummaryBtn" style="flex: 1; min-width: 180px; padding: 12px; background: #777; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Close</button>
        </div>
    `;

    return panel;
}

function attachTeamTrendSummaryModalHandlers(modal, teamSubject, weekKey, period) {
    const closeModal = () => {
        if (document.body.contains(modal)) {
            document.body.removeChild(modal);
        }
    };

    document.getElementById('copyTeamTrendPromptBtn')?.addEventListener('click', () => {
        const textarea = document.getElementById('teamTrendPromptDisplay');
        handOffToCopilot(textarea.value, {
            message: '📋 Team prompt copied. Opening Copilot',
            onCopyFailed: () => textarea.select()
        });
    });

    document.getElementById('openTeamTrendEmailBtn')?.addEventListener('click', () => {
        const currentTeam = buildTeamTrendAggregateEmployee(period);
        if (!currentTeam) {
            showToast('No team data available to build email image', 4000);
            return;
        }

        const periodType = period?.metadata?.periodType || 'week';
        const prevPeriodKey = getPreviousPeriodData(weekKey, periodType);
        const prevPeriod = prevPeriodKey ? weeklyData[prevPeriodKey] : null;
        const previousTeam = buildTeamTrendAggregateEmployee(prevPeriod);

        showToast('ℹ️ Creating team email image...', 3000);
        createTrendEmailImage('Team', weekKey, period, currentTeam, previousTeam, () => {
            openTrendEmailOutlook(teamSubject);
            showToast('📧 Outlook opening... Team image is copied to clipboard. Paste into email body.', 4500);
        });
    });

    document.getElementById('closeTeamTrendSummaryBtn')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
}

function generateTeamTrendSummary(weekKeyArg) {
    // Called from the Center > Trends panel with that panel's period. A click
    // handler passes an event, which is not a period.
    const weekKey = (typeof weekKeyArg === 'string' && weekKeyArg)
        || document.getElementById('teamSummaryPeriodSelect')?.value
        || document.getElementById('trendPeriodSelect')?.value;
    if (!weekKey) {
        showToast('Please select a period first', 5000);
        return;
    }

    const period = weeklyData[weekKey];
    if (!period || !Array.isArray(period.employees) || period.employees.length === 0) {
        showToast('Team summary currently supports weekly data with employees', 5000);
        return;
    }

    const teamFilterContext = getTeamSelectionContext();
    const filteredEmployees = getFilteredEmployeesForPeriod(period, teamFilterContext);
    if (!filteredEmployees.length) {
        showToast('No checked team members found for this period', 5000);
        return;
    }

    const periodMeta = period.metadata || {};
    const reviewYear = parseInt((periodMeta.endDate || '').split('-')[0], 10) || null;
    const teamMetrics = collectTeamTrendMetrics(period);

    if (teamMetrics.length === 0) {
        showToast('No team metrics found for this period', 5000);
        return;
    }

    const { positiveHighlights, improvementAreas } = buildTrendHighlightsAndImprovements(teamMetrics);
    const summaryBoxesHtml = renderTrendSummaryBoxesHtml(
        positiveHighlights,
        improvementAreas,
        'No above-target team metrics in this period.',
        'No below-target team metrics in this period.'
    );

    const periodLabel = periodMeta.label || (periodMeta.endDate ? `Week ending ${formatDateMMDDYYYY(periodMeta.endDate)}` : 'this period');
    const teamPrompt = buildTeamTrendCoachingPrompt(periodLabel, teamMetrics, filteredEmployees.length);
    const periodTypeTitle = (periodMeta?.periodType === 'month') ? 'Monthly' : (periodMeta?.periodType === 'daily') ? 'Daily' : 'Weekly';
    const teamSubject = `${periodTypeTitle} Team Summary`;

    const modal = createTeamTrendSummaryModal();
    const panel = createTeamTrendSummaryPanel(periodLabel, filteredEmployees.length, summaryBoxesHtml, teamPrompt);

    modal.appendChild(panel);
    document.body.appendChild(modal);
    attachTeamTrendSummaryModalHandlers(modal, teamSubject, weekKey, period);
}



    // Export functions
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.metricTrends = {
        initializeMetricTrends,
        renderCallCenterAverageTargets,
        populateTrendPeriodDropdown,
        initializeEmployeeDropdown,
        populateEmployeeDropdownForPeriod,
        populateTrendSentimentDropdown,
        getAverageValueFromSource,
        applyAveragesToForm,
        getPreviousWeekKey,
        readAveragesFromForm,
        setupAveragesLoader,
        populateUploadedDataDropdown,
        setupUploadedDataListener,
        displayCallCenterAverages,
        updateTrendButtonsVisibility,
        applyTrendButtonVisibility,
        setupMetricTrendsListeners,
        displayMetricsPreview,
        saveMetricsPreviewEdits,
        getMetricBandByUnit,
        resolveMetricTrendDirection,
        getMetricVolatilityDetails,
        classifyTrendMetric,
        analyzeTrendMetrics,
        pickWeakestAndTrending,
        trendHasSurveysBehind,
        coachableTrendMetrics,
        formatTrendChange,
        trendGoalPhrase,
        trendPeriodPhrase,
        buildCoachingEmailBody,
        buildCoachingFollowupSubject,
        resolveTrendReliabilityYearTotal,
        getShuffledCopy,
        pickRandomItem,
        pickRandomItems,
        getRandomTipsForMetric,
        getTrendTipsForMetrics,
        getSelectedTrendSentimentSnapshot,
        resolveTrendEmailContext,
        handleTrendEmailImageReady,
        getReviewYearFromEndDate,
        buildTrendEmailAnalysisBundle,
        getTrendEmailSelection,
        getTrendEmailDisplayName,
        generateTrendEmail,
        generateCoachingFollowup,
        openTrendEmailOutlook,
        getTrendPeriodDisplay,
        buildTrendEmailSubject,
        buildTrendFocusAreas,
        buildTrendSentimentSectionHtml,
        renderTrendFocusAreasHtml,
        renderTrendIntelligenceSnapshotHtml,
        buildTrendIntelligenceSnapshotText,
        attachTrendTipsModalHandlers,
        buildTrendTipsModalHtml,
        createTrendTipsModalElements,
        showTrendsWithTipsPanel,
        buildTrendCoachingPrompt,
        getMetricOrder,
        isReverseMetric,
        resolveTrendMetricYtdDisplay,
        resolveTrendRowBackgroundColor,
        resolveTrendCenterComparisonDisplay,
        resolveTrendDirectionDisplay,
        drawTrendMetricRowShell,
        drawTrendMetricBaseCells,
        drawTrendMetricCenterAndTrendCells,
        renderMetricRow,
        createTrendEmailImage,
        drawTrendEmailCanvasSections,
        finalizeTrendEmailImageOutput,
        buildTrendEmailContext,
        buildTrendMetricsTableOptions,
        drawTrendEmailCanvasLayoutStart,
        drawTrendSummaryCardsRow,
        drawTrendSummaryBoxesSection,
        drawTrendInsightsLegendAndReliabilitySection,
        drawTrendMetricsSectionHeader,
        drawTrendMetricsTableBody,
        drawTrendHighlightsSection,
        drawTrendLegendOnCanvas,
        buildTrendMetricMaps,
        copyTrendImageToClipboard,
        calculateTrendSurveyTotals,
        calculateTrendSummaryStats,
        buildTrendHighlightsData,
        drawEmailCard,
        wrapCanvasTextLines,
        drawTrendSummaryBoxesOnCanvas,
        getMetricTarget,
        getMetricTrendTarget,
        getMetricTrendTargetType,
        formatMetricValue,
        formatMetricDisplay,
        getCenterAverageForMetric,
        parseIsoDateSafe,
        findRealYtdAnchor,
        buildYtdAggregateForYear,
        upsertAutoYtdForYear,
        getYtdPeriodForWeekKey,
        isMetricMeetingTarget,
        buildTrendHighlightsAndImprovements,
        renderTrendSummaryBoxesHtml,
        buildTeamTrendCoachingPrompt,
        getFilteredEmployeesForPeriod,
        collectTeamTrendMetrics,
        buildTeamTrendAggregateEmployee,
        createTeamTrendSummaryModal,
        createTeamTrendSummaryPanel,
        attachTeamTrendSummaryModalHandlers,
        generateTeamTrendSummary,
    };

    // Backward compatibility - expose key functions on window
    window.initializeMetricTrends = initializeMetricTrends;
    window.renderCallCenterAverageTargets = renderCallCenterAverageTargets;
    window.populateTrendPeriodDropdown = populateTrendPeriodDropdown;
    window.initializeEmployeeDropdown = initializeEmployeeDropdown;
    window.populateEmployeeDropdownForPeriod = populateEmployeeDropdownForPeriod;
    window.populateTrendSentimentDropdown = populateTrendSentimentDropdown;
    window.getAverageValueFromSource = getAverageValueFromSource;
    window.applyAveragesToForm = applyAveragesToForm;
    window.getPreviousWeekKey = getPreviousWeekKey;
    window.readAveragesFromForm = readAveragesFromForm;
    window.setupAveragesLoader = setupAveragesLoader;
    window.populateUploadedDataDropdown = populateUploadedDataDropdown;
    window.setupUploadedDataListener = setupUploadedDataListener;
    window.displayCallCenterAverages = displayCallCenterAverages;
    window.updateTrendButtonsVisibility = updateTrendButtonsVisibility;
    window.applyTrendButtonVisibility = applyTrendButtonVisibility;
    window.setupMetricTrendsListeners = setupMetricTrendsListeners;
    window.displayMetricsPreview = displayMetricsPreview;
    window.saveMetricsPreviewEdits = saveMetricsPreviewEdits;
    window.getMetricBandByUnit = getMetricBandByUnit;
    window.resolveMetricTrendDirection = resolveMetricTrendDirection;
    window.getMetricVolatilityDetails = getMetricVolatilityDetails;
    window.classifyTrendMetric = classifyTrendMetric;
    window.analyzeTrendMetrics = analyzeTrendMetrics;
    window.getShuffledCopy = getShuffledCopy;
    window.pickRandomItem = pickRandomItem;
    window.pickRandomItems = pickRandomItems;
    window.getRandomTipsForMetric = getRandomTipsForMetric;
    window.getTrendTipsForMetrics = getTrendTipsForMetrics;
    window.getSelectedTrendSentimentSnapshot = getSelectedTrendSentimentSnapshot;
    window.resolveTrendEmailContext = resolveTrendEmailContext;
    window.handleTrendEmailImageReady = handleTrendEmailImageReady;
    window.getReviewYearFromEndDate = getReviewYearFromEndDate;
    window.buildTrendEmailAnalysisBundle = buildTrendEmailAnalysisBundle;
    window.getTrendEmailSelection = getTrendEmailSelection;
    window.getTrendEmailDisplayName = getTrendEmailDisplayName;
    window.generateTrendEmail = generateTrendEmail;
    window.openTrendEmailOutlook = openTrendEmailOutlook;
    window.getTrendPeriodDisplay = getTrendPeriodDisplay;
    window.buildTrendEmailSubject = buildTrendEmailSubject;
    window.buildTrendFocusAreas = buildTrendFocusAreas;
    window.buildTrendSentimentSectionHtml = buildTrendSentimentSectionHtml;
    window.renderTrendFocusAreasHtml = renderTrendFocusAreasHtml;
    window.renderTrendIntelligenceSnapshotHtml = renderTrendIntelligenceSnapshotHtml;
    window.buildTrendIntelligenceSnapshotText = buildTrendIntelligenceSnapshotText;
    window.attachTrendTipsModalHandlers = attachTrendTipsModalHandlers;
    window.buildTrendTipsModalHtml = buildTrendTipsModalHtml;
    window.createTrendTipsModalElements = createTrendTipsModalElements;
    window.showTrendsWithTipsPanel = showTrendsWithTipsPanel;
    window.buildTrendCoachingPrompt = buildTrendCoachingPrompt;
    window.getMetricOrder = getMetricOrder;
    // window.isReverseMetric is owned by modules/metrics-registry.module.js
    window.resolveTrendMetricYtdDisplay = resolveTrendMetricYtdDisplay;
    window.resolveTrendRowBackgroundColor = resolveTrendRowBackgroundColor;
    window.resolveTrendCenterComparisonDisplay = resolveTrendCenterComparisonDisplay;
    window.resolveTrendDirectionDisplay = resolveTrendDirectionDisplay;
    window.drawTrendMetricRowShell = drawTrendMetricRowShell;
    window.drawTrendMetricBaseCells = drawTrendMetricBaseCells;
    window.drawTrendMetricCenterAndTrendCells = drawTrendMetricCenterAndTrendCells;
    window.renderMetricRow = renderMetricRow;
    window.createTrendEmailImage = createTrendEmailImage;
    window.drawTrendEmailCanvasSections = drawTrendEmailCanvasSections;
    window.finalizeTrendEmailImageOutput = finalizeTrendEmailImageOutput;
    window.buildTrendEmailContext = buildTrendEmailContext;
    window.buildTrendMetricsTableOptions = buildTrendMetricsTableOptions;
    window.drawTrendEmailCanvasLayoutStart = drawTrendEmailCanvasLayoutStart;
    window.drawTrendSummaryCardsRow = drawTrendSummaryCardsRow;
    window.drawTrendSummaryBoxesSection = drawTrendSummaryBoxesSection;
    window.drawTrendInsightsLegendAndReliabilitySection = drawTrendInsightsLegendAndReliabilitySection;
    window.drawTrendMetricsSectionHeader = drawTrendMetricsSectionHeader;
    window.drawTrendMetricsTableBody = drawTrendMetricsTableBody;
    window.drawTrendHighlightsSection = drawTrendHighlightsSection;
    window.drawTrendLegendOnCanvas = drawTrendLegendOnCanvas;
    window.buildTrendMetricMaps = buildTrendMetricMaps;
    window.copyTrendImageToClipboard = copyTrendImageToClipboard;
    window.calculateTrendSurveyTotals = calculateTrendSurveyTotals;
    window.calculateTrendSummaryStats = calculateTrendSummaryStats;
    window.buildTrendHighlightsData = buildTrendHighlightsData;
    window.drawEmailCard = drawEmailCard;
    window.wrapCanvasTextLines = wrapCanvasTextLines;
    window.drawTrendSummaryBoxesOnCanvas = drawTrendSummaryBoxesOnCanvas;
    window.getMetricTarget = getMetricTarget;
    window.getMetricTrendTarget = getMetricTrendTarget;
    window.getMetricTrendTargetType = getMetricTrendTargetType;
    window.formatMetricValue = formatMetricValue;
    window.formatMetricDisplay = formatMetricDisplay;
    window.getCenterAverageForMetric = getCenterAverageForMetric;
    window.parseIsoDateSafe = parseIsoDateSafe;
    window.buildYtdAggregateForYear = buildYtdAggregateForYear;
    window.upsertAutoYtdForYear = upsertAutoYtdForYear;
    window.getYtdPeriodForWeekKey = getYtdPeriodForWeekKey;
    window.isMetricMeetingTarget = isMetricMeetingTarget;
    window.buildTrendHighlightsAndImprovements = buildTrendHighlightsAndImprovements;
    window.renderTrendSummaryBoxesHtml = renderTrendSummaryBoxesHtml;
    window.buildTeamTrendCoachingPrompt = buildTeamTrendCoachingPrompt;
    window.getFilteredEmployeesForPeriod = getFilteredEmployeesForPeriod;
    window.collectTeamTrendMetrics = collectTeamTrendMetrics;
    window.buildTeamTrendAggregateEmployee = buildTeamTrendAggregateEmployee;
    window.createTeamTrendSummaryModal = createTeamTrendSummaryModal;
    window.createTeamTrendSummaryPanel = createTeamTrendSummaryPanel;
    window.attachTeamTrendSummaryModalHandlers = attachTeamTrendSummaryModalHandlers;
    window.generateTeamTrendSummary = generateTeamTrendSummary;

})();

