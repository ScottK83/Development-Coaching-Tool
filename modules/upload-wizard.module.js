(function() {
    'use strict';

    // ============================================
    // UPLOAD WIZARD MODULE
    // Dropdown-driven upload period picker.
    //
    // Instead of asking the user to manually pick a period type and
    // type in start/end dates, this module computes a rolling list of
    // sensible options from today's date (last completed week, this
    // week in progress, last completed month, last completed quarter,
    // YTD) and annotates each with its upload state so the dropdown
    // doubles as a to-do list: unselected = not yet uploaded.
    //
    // Selection is synced into the legacy period-type buttons and
    // date inputs so the existing save path keeps working unchanged.
    // ============================================

    const MS_PER_DAY = 86_400_000;

    function startOfDay(d) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function isoDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function fmtShort(d) {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function fmtLong(d) {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function addDays(d, n) {
        const x = new Date(d);
        x.setDate(x.getDate() + n);
        return x;
    }

    // Given today, compute the full list of upload options.
    //
    // The list is deterministic and doesn't yet know about upload
    // state — that's applied separately so the function stays pure
    // and testable.
    function computeUploadOptions(today = new Date()) {
        const options = [];
        const now = startOfDay(today);
        const dow = now.getDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat

        // Week boundaries (Monday start)
        const daysBackToMon = dow === 0 ? 6 : dow - 1;
        const thisWeekMon = addDays(now, -daysBackToMon);
        const lastWeekMon = addDays(thisWeekMon, -7);
        const lastWeekSun = addDays(thisWeekMon, -1);

        // 1. This week in progress (Mon -> today). Always available,
        //    even on Monday (1 day of data = partial week).
        options.push({
            id: 'week-in-progress',
            label: `This week in progress (${fmtShort(thisWeekMon)} – ${fmtShort(now)})`,
            periodType: 'week-in-progress',
            startDate: isoDate(thisWeekMon),
            endDate: isoDate(now),
            priority: 1
        });

        // 2. Last completed week
        options.push({
            id: `week-${isoDate(lastWeekMon)}`,
            label: `Last week (${fmtShort(lastWeekMon)} – ${fmtShort(lastWeekSun)})`,
            periodType: 'week',
            startDate: isoDate(lastWeekMon),
            endDate: isoDate(lastWeekSun),
            priority: 2
        });

        // 3. Last completed month
        const thisMonthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastMonthEnd = addDays(thisMonthFirst, -1);
        const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
        const monthName = lastMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        options.push({
            id: `month-${isoDate(lastMonthStart)}`,
            label: `${monthName} (last completed month)`,
            periodType: 'month',
            startDate: isoDate(lastMonthStart),
            endDate: isoDate(lastMonthEnd),
            priority: 3
        });

        // 4. Last completed quarter
        const currentQIdx = Math.floor(now.getMonth() / 3); // 0..3
        let lastQStartMonthIdx, lastQYear;
        if (currentQIdx === 0) {
            lastQStartMonthIdx = 9; // Oct (month index)
            lastQYear = now.getFullYear() - 1;
        } else {
            lastQStartMonthIdx = (currentQIdx - 1) * 3;
            lastQYear = now.getFullYear();
        }
        const lastQStart = new Date(lastQYear, lastQStartMonthIdx, 1);
        const lastQEnd = new Date(lastQYear, lastQStartMonthIdx + 3, 0); // last day of quarter
        const qNumber = Math.floor(lastQStartMonthIdx / 3) + 1;
        options.push({
            id: `quarter-${lastQYear}-q${qNumber}`,
            label: `Q${qNumber} ${lastQYear} (last completed quarter)`,
            periodType: 'quarter',
            startDate: isoDate(lastQStart),
            endDate: isoDate(lastQEnd),
            priority: 4
        });

        // 5. YTD — user picks the end date. Always pending because YTD
        //    is re-uploaded ad-hoc. We'll still show the latest uploaded
        //    YTD end date as a hint in the summary area.
        options.push({
            id: 'ytd',
            label: `YTD (pick end date)`,
            periodType: 'ytd',
            startDate: `${now.getFullYear()}-01-01`,
            endDate: null,
            requiresEndDatePick: true,
            priority: 5
        });

        return options;
    }

    // Annotate each option with upload state by looking it up in
    // weeklyData / ytdData. For the YTD option, we don't mark it
    // uploaded (since end date is user-picked), but we record the
    // most recent existing YTD so the summary can display it.
    function annotateUploadState(options, weeklyStore, ytdStore) {
        const weekly = weeklyStore || {};
        const ytd = ytdStore || {};

        // Find most recent YTD by end date
        let latestYtdEnd = null;
        Object.keys(ytd).forEach(k => {
            const endText = ytd[k]?.metadata?.endDate || (k.includes('|') ? k.split('|')[1] : '');
            const endDate = new Date(endText);
            if (!isNaN(endDate) && (!latestYtdEnd || endDate > latestYtdEnd.date)) {
                latestYtdEnd = { date: endDate, endText };
            }
        });

        return options.map(opt => {
            if (opt.periodType === 'ytd') {
                return {
                    ...opt,
                    latestYtdEnd: latestYtdEnd ? latestYtdEnd.endText : null
                };
            }
            if (!opt.endDate) return opt;
            const key = `${opt.startDate}|${opt.endDate}`;
            const existing = weekly[key];
            if (existing) {
                return {
                    ...opt,
                    isUploaded: true,
                    uploadedAt: existing.metadata?.uploadedAt || null
                };
            }
            return opt;
        });
    }

    // Render the dropdown options into the select element. Pending
    // options come first and are selectable; already-uploaded options
    // are grouped below and rendered as disabled (visible as a
    // progress indicator but not clickable, so the user can't
    // accidentally re-upload the same period).
    function renderDropdown(selectEl, options) {
        if (!selectEl) return;
        const prev = selectEl.value;
        selectEl.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '-- Select a period --';
        selectEl.appendChild(placeholder);

        const pending = options.filter(o => !o.isUploaded);
        const uploaded = options.filter(o => o.isUploaded);

        if (pending.length) {
            const grp = document.createElement('optgroup');
            grp.label = 'Pending';
            pending.forEach(opt => {
                const el = document.createElement('option');
                el.value = opt.id;
                el.textContent = opt.label;
                el.dataset.periodType = opt.periodType;
                el.dataset.startDate = opt.startDate || '';
                el.dataset.endDate = opt.endDate || '';
                if (opt.requiresEndDatePick) el.dataset.requiresEndDatePick = '1';
                if (opt.latestYtdEnd) el.dataset.latestYtdEnd = opt.latestYtdEnd;
                grp.appendChild(el);
            });
            selectEl.appendChild(grp);
        }
        if (uploaded.length) {
            const grp = document.createElement('optgroup');
            grp.label = 'Already uploaded';
            uploaded.forEach(opt => {
                const el = document.createElement('option');
                el.value = opt.id;
                el.disabled = true;
                const when = opt.uploadedAt ? new Date(opt.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                el.textContent = `✓ ${opt.label}${when ? ` — uploaded ${when}` : ''}`;
                el.dataset.periodType = opt.periodType;
                el.dataset.startDate = opt.startDate || '';
                el.dataset.endDate = opt.endDate || '';
                grp.appendChild(el);
            });
            selectEl.appendChild(grp);
        }

        // Restore previous selection only if it's still in the pending
        // list. A just-uploaded option becomes disabled and we don't
        // want it to stay "selected" — reset to the placeholder.
        const stillPending = prev && pending.some(o => o.id === prev);
        selectEl.value = stillPending ? prev : '';
    }

    // When the user picks an option, sync its dates + period type
    // into the legacy hidden inputs and "click" the matching
    // period-type button so the existing save path reads them.
    function applySelectionToLegacyInputs(option, ytdEndOverride) {
        const startInput = document.getElementById('pasteStartDate');
        const endInput = document.getElementById('pasteWeekEndingDate');
        if (!option) {
            if (startInput) startInput.value = '';
            if (endInput) endInput.value = '';
            return;
        }
        const endDate = ytdEndOverride || option.endDate || '';
        const startDate = option.periodType === 'ytd' && endDate
            ? `${endDate.slice(0, 4)}-01-01`
            : option.startDate || '';

        if (startInput) startInput.value = startDate;
        if (endInput) endInput.value = endDate;

        // Click the matching period-type button so resolveSelectedUploadPeriodType
        // reads the right type. Buttons are hidden but still in the DOM.
        const btn = document.querySelector(`.upload-period-btn[data-period="${option.periodType}"]`);
        if (btn) btn.click();
    }

    function updateSummary(summaryEl, option, ytdEndOverride) {
        if (!summaryEl) return;
        if (!option) {
            summaryEl.style.display = 'none';
            summaryEl.textContent = '';
            return;
        }
        const endDate = ytdEndOverride || option.endDate;
        if (!endDate) {
            // YTD with no end date picked yet
            summaryEl.style.display = 'block';
            const hint = option.latestYtdEnd
                ? ` Most recent YTD on file ends ${option.latestYtdEnd}.`
                : ' No YTD on file yet.';
            summaryEl.textContent = `Pick the last day this YTD covers.${hint}`;
            return;
        }
        const start = option.periodType === 'ytd'
            ? `${endDate.slice(0, 4)}-01-01`
            : option.startDate;
        const startD = new Date(start);
        const endD = new Date(endDate);
        summaryEl.style.display = 'block';
        summaryEl.textContent = `Will save as ${option.periodType} — ${fmtLong(startD)} through ${fmtLong(endD)}.`;
    }

    function toggleCustomMode(on) {
        const legacyBtns = document.getElementById('legacyPeriodControls');
        const legacyDates = document.getElementById('legacyDateRow');
        const wizard = document.getElementById('uploadWizardContainer');
        if (legacyBtns) legacyBtns.style.display = on ? 'block' : 'none';
        if (legacyDates) legacyDates.style.display = on ? 'flex' : 'none';
        if (wizard) wizard.style.opacity = on ? '0.5' : '1';
    }

    // Refresh the dropdown using current weeklyData / ytdData. Called
    // on initial render and whenever an upload completes (so the
    // dropdown instantly reflects the new upload state).
    function refresh() {
        const selectEl = document.getElementById('uploadWizardSelect');
        if (!selectEl) return;
        const weekly = (typeof weeklyData !== 'undefined' ? weeklyData : null)
            || window.DevCoachModules?.storage?.loadWeeklyData?.()
            || {};
        const ytd = (typeof ytdData !== 'undefined' ? ytdData : null)
            || window.DevCoachModules?.storage?.loadYtdData?.()
            || {};
        const options = annotateUploadState(computeUploadOptions(new Date()), weekly, ytd);
        renderDropdown(selectEl, options);

        // If the just-uploaded option cleared the selection, also
        // reset the YTD date picker, summary line, and legacy date
        // inputs so the UI doesn't dangle with stale values.
        if (!selectEl.value) {
            const ytdPicker = document.getElementById('uploadWizardYtdDatePicker');
            const ytdInput = document.getElementById('uploadWizardYtdEnd');
            const summaryEl = document.getElementById('uploadWizardSummary');
            if (ytdPicker) ytdPicker.style.display = 'none';
            if (ytdInput) ytdInput.value = '';
            if (summaryEl) {
                summaryEl.style.display = 'none';
                summaryEl.textContent = '';
            }
            applySelectionToLegacyInputs(null);
        }
    }

    function bind() {
        const selectEl = document.getElementById('uploadWizardSelect');
        if (!selectEl || selectEl.dataset.wizardBound) return;
        selectEl.dataset.wizardBound = '1';

        const ytdPicker = document.getElementById('uploadWizardYtdDatePicker');
        const ytdInput = document.getElementById('uploadWizardYtdEnd');
        const summaryEl = document.getElementById('uploadWizardSummary');
        const customToggle = document.getElementById('uploadWizardCustomToggle');

        refresh();

        function currentOptionFromDropdown() {
            const opt = selectEl.options[selectEl.selectedIndex];
            if (!opt || !opt.value) return null;
            return {
                id: opt.value,
                periodType: opt.dataset.periodType,
                startDate: opt.dataset.startDate || null,
                endDate: opt.dataset.endDate || null,
                requiresEndDatePick: opt.dataset.requiresEndDatePick === '1',
                latestYtdEnd: opt.dataset.latestYtdEnd || null
            };
        }

        selectEl.addEventListener('change', () => {
            const option = currentOptionFromDropdown();
            if (!option) {
                if (ytdPicker) ytdPicker.style.display = 'none';
                applySelectionToLegacyInputs(null);
                updateSummary(summaryEl, null);
                return;
            }
            if (option.requiresEndDatePick) {
                if (ytdPicker) ytdPicker.style.display = 'block';
                applySelectionToLegacyInputs(option, ytdInput?.value || null);
                updateSummary(summaryEl, option, ytdInput?.value || null);
            } else {
                if (ytdPicker) ytdPicker.style.display = 'none';
                applySelectionToLegacyInputs(option);
                updateSummary(summaryEl, option);
            }
        });

        if (ytdInput) {
            ytdInput.addEventListener('change', () => {
                const option = currentOptionFromDropdown();
                if (!option) return;
                applySelectionToLegacyInputs(option, ytdInput.value);
                updateSummary(summaryEl, option, ytdInput.value);
            });
        }

        if (customToggle) {
            let customOn = false;
            customToggle.addEventListener('click', () => {
                customOn = !customOn;
                toggleCustomMode(customOn);
                customToggle.textContent = customOn ? 'Back to quick picker' : 'Need custom dates?';
            });
        }
    }

    // Public API
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.uploadWizard = {
        computeUploadOptions,
        annotateUploadState,
        refresh,
        bind
    };
})();
