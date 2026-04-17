(function() {
    'use strict';

    // ============================================
    // UPLOAD WIZARD MODULE
    // Dropdown-driven upload period picker — the only path for
    // choosing what period an upload covers. Computes a rolling list
    // of sensible options from today's date (last completed week,
    // this week in progress, last completed month, last completed
    // quarter, YTD, daily) and annotates each with its upload state
    // so the dropdown doubles as a to-do list: unselected = not yet
    // uploaded.
    //
    // Writes the user's selection to three hidden inputs in index.html:
    //   #uploadPeriodType    — the period kind (week, ytd, daily, ...)
    //   #pasteStartDate      — inclusive range start (YYYY-MM-DD)
    //   #pasteWeekEndingDate — inclusive range end   (YYYY-MM-DD)
    // The save path in script.js reads those three values.
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

    // Parse YYYY-MM-DD as a local Date (avoids UTC day-shift).
    function parseLocalDate(isoStr) {
        if (!isoStr) return new Date(NaN);
        const [y, m, d] = String(isoStr).split('-').map(Number);
        if (!y || !m || !d) return new Date(NaN);
        return new Date(y, m - 1, d);
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
        const yesterday = addDays(now, -1);

        // 0. Daily — user picks a specific day (defaults to yesterday).
        //    Dailies are ephemeral: they power "yesterday's check-in" and
        //    partial-week views, and get purged when a weekly upload for
        //    the same week lands.
        options.push({
            id: 'daily',
            label: 'Daily data (pick a day — defaults to yesterday)',
            periodType: 'daily',
            startDate: null,
            endDate: null,
            requiresDailyDatePick: true,
            defaultDate: isoDate(yesterday),
            priority: 0
        });

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
    function annotateUploadState(options, weeklyStore, ytdStore, dailyStore) {
        const weekly = weeklyStore || {};
        const ytd = ytdStore || {};
        const daily = dailyStore || {};

        // Find most recent YTD by end date
        let latestYtdEnd = null;
        Object.keys(ytd).forEach(k => {
            const endText = ytd[k]?.metadata?.endDate || (k.includes('|') ? k.split('|')[1] : '');
            const endDate = new Date(endText);
            if (!isNaN(endDate) && (!latestYtdEnd || endDate > latestYtdEnd.date)) {
                latestYtdEnd = { date: endDate, endText };
            }
        });

        // Build a set of daily dates already uploaded (YYYY-MM-DD).
        const dailyUploadedDates = new Set();
        Object.keys(daily).forEach(k => {
            const endText = daily[k]?.metadata?.endDate || (k.includes('|') ? k.split('|')[1] : '');
            if (endText) dailyUploadedDates.add(endText);
        });

        return options.map(opt => {
            if (opt.periodType === 'ytd') {
                return {
                    ...opt,
                    latestYtdEnd: latestYtdEnd ? latestYtdEnd.endText : null
                };
            }
            if (opt.periodType === 'daily') {
                return {
                    ...opt,
                    dailyUploadedDates: Array.from(dailyUploadedDates).sort()
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
                if (opt.requiresDailyDatePick) el.dataset.requiresDailyDatePick = '1';
                if (opt.defaultDate) el.dataset.defaultDate = opt.defaultDate;
                if (opt.latestYtdEnd) el.dataset.latestYtdEnd = opt.latestYtdEnd;
                if (Array.isArray(opt.dailyUploadedDates) && opt.dailyUploadedDates.length) {
                    el.dataset.dailyUploadedDates = opt.dailyUploadedDates.join(',');
                }
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

    // Sync the selected option into the three hidden inputs that drive
    // the save path: #uploadPeriodType, #pasteStartDate, #pasteWeekEndingDate.
    function applySelectionToHiddenInputs(option, dateOverride) {
        const typeInput = document.getElementById('uploadPeriodType');
        const startInput = document.getElementById('pasteStartDate');
        const endInput = document.getElementById('pasteWeekEndingDate');
        if (!option) {
            if (typeInput) typeInput.value = '';
            if (startInput) startInput.value = '';
            if (endInput) endInput.value = '';
            return;
        }
        // For YTD, dateOverride is the end date. For daily, it's the single day
        // (start === end). For everything else, we use the fixed dates in the option.
        let startDate;
        let endDate;
        if (option.periodType === 'daily') {
            endDate = dateOverride || option.defaultDate || '';
            startDate = endDate;
        } else if (option.periodType === 'ytd') {
            endDate = dateOverride || option.endDate || '';
            startDate = endDate ? `${endDate.slice(0, 4)}-01-01` : '';
        } else {
            endDate = option.endDate || '';
            startDate = option.startDate || '';
        }

        if (typeInput) typeInput.value = option.periodType || '';
        if (startInput) startInput.value = startDate;
        if (endInput) endInput.value = endDate;
    }

    function updateSummary(summaryEl, option, dateOverride) {
        if (!summaryEl) return;
        if (!option) {
            summaryEl.style.display = 'none';
            summaryEl.textContent = '';
            return;
        }
        // Daily — single-day save.
        if (option.periodType === 'daily') {
            const day = dateOverride || option.defaultDate;
            if (!day) {
                summaryEl.style.display = 'block';
                summaryEl.textContent = 'Pick which day this data is for.';
                return;
            }
            const d = parseLocalDate(day);
            summaryEl.style.display = 'block';
            summaryEl.textContent = `Will save as daily — ${fmtLong(d)}. (Ephemeral; cleared when a weekly upload covers this date.)`;
            return;
        }
        const endDate = dateOverride || option.endDate;
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
        const startD = parseLocalDate(start);
        const endD = parseLocalDate(endDate);
        summaryEl.style.display = 'block';
        summaryEl.textContent = `Will save as ${option.periodType} — ${fmtLong(startD)} through ${fmtLong(endD)}.`;
    }

    // Renders a per-weekday checklist for the current week into a summary
    // element: which days have been uploaded to dailyData, which are still
    // missing. Helps the user see daily-upload progress at a glance.
    function renderDailyWeekSummary(summaryEl, uploadedDates, today = new Date()) {
        if (!summaryEl) return;
        const now = startOfDay(today);
        const dow = now.getDay();
        const daysBackToMon = dow === 0 ? 6 : dow - 1;
        const weekMon = addDays(now, -daysBackToMon);
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const uploadedSet = new Set((uploadedDates || '').split(',').filter(Boolean));

        const parts = [];
        for (let i = 0; i < 7; i++) {
            const d = addDays(weekMon, i);
            if (d > now) break; // Don't show future days
            const iso = isoDate(d);
            const mark = uploadedSet.has(iso) ? '✓' : '—';
            parts.push(`${dayNames[i]} ${mark}`);
        }
        if (!parts.length) {
            summaryEl.style.display = 'none';
            return;
        }
        summaryEl.style.display = 'block';
        summaryEl.textContent = `This week so far: ${parts.join(' · ')}`;
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
        const daily = (typeof dailyData !== 'undefined' ? dailyData : null)
            || window.DevCoachModules?.storage?.loadDailyData?.()
            || {};
        const options = annotateUploadState(computeUploadOptions(new Date()), weekly, ytd, daily);
        renderDropdown(selectEl, options);

        // If the just-uploaded option cleared the selection, also
        // reset the YTD/daily date pickers, summary line, and legacy date
        // inputs so the UI doesn't dangle with stale values.
        if (!selectEl.value) {
            const ytdPicker = document.getElementById('uploadWizardYtdDatePicker');
            const ytdInput = document.getElementById('uploadWizardYtdEnd');
            const dailyPicker = document.getElementById('uploadWizardDailyDatePicker');
            const dailyInput = document.getElementById('uploadWizardDailyDate');
            const dailyWeekSummary = document.getElementById('uploadWizardDailyWeekSummary');
            const summaryEl = document.getElementById('uploadWizardSummary');
            if (ytdPicker) ytdPicker.style.display = 'none';
            if (ytdInput) ytdInput.value = '';
            if (dailyPicker) dailyPicker.style.display = 'none';
            if (dailyInput) dailyInput.value = '';
            if (dailyWeekSummary) {
                dailyWeekSummary.style.display = 'none';
                dailyWeekSummary.textContent = '';
            }
            if (summaryEl) {
                summaryEl.style.display = 'none';
                summaryEl.textContent = '';
            }
            applySelectionToHiddenInputs(null);
        }
    }

    function bind() {
        const selectEl = document.getElementById('uploadWizardSelect');
        if (!selectEl || selectEl.dataset.wizardBound) return;
        selectEl.dataset.wizardBound = '1';

        const ytdPicker = document.getElementById('uploadWizardYtdDatePicker');
        const ytdInput = document.getElementById('uploadWizardYtdEnd');
        const dailyPicker = document.getElementById('uploadWizardDailyDatePicker');
        const dailyInput = document.getElementById('uploadWizardDailyDate');
        const dailyWeekSummary = document.getElementById('uploadWizardDailyWeekSummary');
        const summaryEl = document.getElementById('uploadWizardSummary');
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
                requiresDailyDatePick: opt.dataset.requiresDailyDatePick === '1',
                defaultDate: opt.dataset.defaultDate || null,
                dailyUploadedDates: opt.dataset.dailyUploadedDates || '',
                latestYtdEnd: opt.dataset.latestYtdEnd || null
            };
        }

        selectEl.addEventListener('change', () => {
            const option = currentOptionFromDropdown();
            if (!option) {
                if (ytdPicker) ytdPicker.style.display = 'none';
                if (dailyPicker) dailyPicker.style.display = 'none';
                applySelectionToHiddenInputs(null);
                updateSummary(summaryEl, null);
                return;
            }
            if (option.requiresEndDatePick) {
                if (ytdPicker) ytdPicker.style.display = 'block';
                if (dailyPicker) dailyPicker.style.display = 'none';
                applySelectionToHiddenInputs(option, ytdInput?.value || null);
                updateSummary(summaryEl, option, ytdInput?.value || null);
                if (ytdInput && !ytdInput.value) ytdInput.focus();
            } else if (option.requiresDailyDatePick) {
                if (ytdPicker) ytdPicker.style.display = 'none';
                if (dailyPicker) dailyPicker.style.display = 'block';
                // Seed with defaultDate (yesterday) if user hasn't picked yet.
                if (dailyInput && !dailyInput.value && option.defaultDate) {
                    dailyInput.value = option.defaultDate;
                }
                const chosen = dailyInput?.value || option.defaultDate || null;
                applySelectionToHiddenInputs(option, chosen);
                updateSummary(summaryEl, option, chosen);
                renderDailyWeekSummary(dailyWeekSummary, option.dailyUploadedDates);
                if (dailyInput) dailyInput.focus();
            } else {
                if (ytdPicker) ytdPicker.style.display = 'none';
                if (dailyPicker) dailyPicker.style.display = 'none';
                applySelectionToHiddenInputs(option);
                updateSummary(summaryEl, option);
            }
        });

        if (ytdInput) {
            ytdInput.addEventListener('change', () => {
                const option = currentOptionFromDropdown();
                if (!option) return;
                applySelectionToHiddenInputs(option, ytdInput.value);
                updateSummary(summaryEl, option, ytdInput.value);
            });
        }

        if (dailyInput) {
            dailyInput.addEventListener('change', () => {
                const option = currentOptionFromDropdown();
                if (!option) return;
                applySelectionToHiddenInputs(option, dailyInput.value);
                updateSummary(summaryEl, option, dailyInput.value);
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
