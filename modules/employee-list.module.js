(function() {
    'use strict';

    /**
     * @param {Record<string, {employees?: Array<{name?: string}>}>} weeklyData
     * @returns {string[]}
     */
    function getEmployeesFromWeeklyData(weeklyData) {
        const employeeSet = new Set();
        // Check weekly data
        Object.values(weeklyData || {}).forEach(period => {
            if (period?.employees) {
                period.employees.forEach(emp => {
                    if (emp?.name) employeeSet.add(emp.name);
                });
            }
        });
        // Also check YTD data
        var ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        Object.values(ytd).forEach(period => {
            if (period?.employees) {
                period.employees.forEach(emp => {
                    if (emp?.name) employeeSet.add(emp.name);
                });
            }
        });

        return Array.from(employeeSet).sort();
    }

    function buildEmployeeRowHtml(name, preferredNames, options = {}) {
        const getEmployeeNickname = options.getEmployeeNickname || ((value) => value);
        const escapeHtml = options.escapeHtml || ((value) => String(value || ''));
        const teamSelectionWeek = String(options.teamSelectionWeek || '').trim();
        const selectedMembers = Array.isArray(options.teamSelectionMembers) ? options.teamSelectionMembers : [];
        const isTeamSelected = !teamSelectionWeek || selectedMembers.length === 0 || selectedMembers.includes(name);
        const supervisorAssignments = options.supervisorAssignments || {};

        const currentPreferred = preferredNames[name] || getEmployeeNickname(name);
        const defaultValue = preferredNames[name] || '';
        const supervisorValue = supervisorAssignments[name] || '';

        return `
        <div style="padding: 15px; border-bottom: 1px solid #eee; background: #fafafa;">
            <div style="display: flex; justify-content: space-between; align-items: start; gap: 15px;">
                <div style="flex: 1;">
                    <label style="display: inline-flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" class="team-member-checkbox employee-row-team-checkbox" data-week="${escapeHtml(teamSelectionWeek)}" data-name="${escapeHtml(name)}" ${isTeamSelected ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer;">
                        <strong style="color: #6a1b9a;">${escapeHtml(name)}</strong>
                    </label>
                    <div style="font-size: 0.8em; color: #666; margin: 5px 0 0 0;">Source: Uploaded Data</div>
                </div>
                <div style="flex: 1; min-width: 150px;">
                    <label style="font-size: 0.85em; color: #666; display: block; margin-bottom: 5px; font-weight: 500;">How to Address:</label>
                    <input type="text" id="prefName_${escapeHtml(name)}" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(getEmployeeNickname(name))}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9em; box-sizing: border-box;">
                    <div style="font-size: 0.75em; color: #999; margin-top: 3px;">Current: <strong>${escapeHtml(currentPreferred)}</strong></div>
                </div>
                <div style="flex: 0 0 140px;">
                    <label style="font-size: 0.85em; color: #666; display: block; margin-bottom: 5px; font-weight: 500;">Supervisor:</label>
                    <input type="text" class="employee-supervisor-input" data-name="${escapeHtml(name)}" value="${escapeHtml(supervisorValue)}" placeholder="My team" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9em; box-sizing: border-box;">
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="saveEmployeeNameBtn" data-name="${escapeHtml(name)}" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; font-size: 0.9em; white-space: nowrap;">💾 Save</button>
                    <button class="deleteEmployeeBtn" data-name="${escapeHtml(name)}" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; font-size: 0.9em; white-space: nowrap;">🗑️ Delete</button>
                </div>
            </div>
        </div>
    `;
    }

    /**
     * @param {HTMLElement | null} container
     * @param {Record<string, unknown>} options
     * @returns {void}
     */
    function renderEmployeesList(options = {}) {
        const container = options.container;
        const weeklyData = options.weeklyData || {};
        const storagePrefix = String(options.storagePrefix || '');

        if (!container) return;

        const employees = getEmployeesFromWeeklyData(weeklyData);
        if (employees.length === 0) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No employees yet. Upload weekly data to see your team members here!</div>';
            return;
        }

        let preferredNames = {};
        try {
            preferredNames = JSON.parse(localStorage.getItem(storagePrefix + 'employeePreferredNames') || '{}');
        } catch (_error) {
            preferredNames = {};
        }

        // Build datalist of known supervisors for autocomplete
        var supervisorAssignments = options.supervisorAssignments || {};
        var knownSupervisors = {};
        Object.values(supervisorAssignments).forEach(function(sup) {
            if (sup) knownSupervisors[sup] = true;
        });
        var datalistHtml = '<datalist id="supervisorSuggestions">' +
            Object.keys(knownSupervisors).sort().map(function(s) {
                return '<option value="' + (options.escapeHtml ? options.escapeHtml(s) : s) + '">';
            }).join('') + '</datalist>';

        container.innerHTML =
            datalistHtml +
            `<div style="padding: 15px; background: #f0f8ff; border-bottom: 2px solid #6a1b9a; font-weight: bold; color: #6a1b9a; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">` +
            `<span>Total Employees: ${employees.length}</span>` +
            `<div style="display: flex; gap: 6px;">` +
            `<button type="button" id="checkAllEmployeesBtn" style="padding: 5px 12px; border: 1px solid #4caf50; background: #e8f5e9; color: #2e7d32; border-radius: 4px; cursor: pointer; font-size: 0.8em; font-weight: 600;">Check All</button>` +
            `<button type="button" id="uncheckAllEmployeesBtn" style="padding: 5px 12px; border: 1px solid #c62828; background: #fbe9e7; color: #c62828; border-radius: 4px; cursor: pointer; font-size: 0.8em; font-weight: 600;">Uncheck All</button>` +
            `</div></div>` +
            `<div style="padding: 12px 15px; background: #fff; border-bottom: 1px solid #ddd;">` +
            `<input type="text" id="employeeSearchInput" placeholder="Search by name..." style="width: 100%; padding: 10px 14px; border: 2px solid #ddd; border-radius: 8px; font-size: 1em; box-sizing: border-box;">` +
            `</div>` +
            `<div id="employeeListRows">` +
            employees.map(name => buildEmployeeRowHtml(name, preferredNames, options)).join('') +
            `</div>`;

        // Attach datalist to all supervisor inputs
        container.querySelectorAll('.employee-supervisor-input').forEach(function(input) {
            input.setAttribute('list', 'supervisorSuggestions');
        });

        if (!container.dataset.employeeHandlersBound) {
            container.addEventListener('click', (event) => {
                const target = event.target;
                if (!target || !target.classList) return;
                if (target.classList.contains('saveEmployeeNameBtn')) {
                    options.onSaveName?.(target.dataset.name);
                } else if (target.classList.contains('deleteEmployeeBtn')) {
                    options.onDeleteEmployee?.(target.dataset.name);
                }
            });

            container.addEventListener('change', (event) => {
                const target = event.target;
                if (!target || !target.classList) return;

                if (target.classList.contains('team-member-checkbox')) {
                    const weekKey = String(target.dataset.week || '').trim();
                    if (!weekKey) return;

                    const selectedMembers = Array.from(container.querySelectorAll(`.team-member-checkbox[data-week="${weekKey}"]:checked`))
                        .map((checkbox) => String(checkbox.dataset.name || '').trim())
                        .filter(Boolean);

                    options.onTeamSelectionChange?.({ weekKey, selectedMembers });
                }

                if (target.classList.contains('employee-supervisor-input')) {
                    const empName = String(target.dataset.name || '').trim();
                    const supervisor = target.value.trim();
                    if (empName) {
                        options.onSupervisorChange?.({ name: empName, supervisor: supervisor });
                    }
                }
            });

            container.dataset.employeeHandlersBound = 'true';
        }

        // Check All / Uncheck All
        const checkAllBtn = document.getElementById('checkAllEmployeesBtn');
        const uncheckAllBtn = document.getElementById('uncheckAllEmployeesBtn');
        const toggleAll = function(checked) {
            const checkboxes = container.querySelectorAll('.team-member-checkbox');
            checkboxes.forEach(function(cb) { cb.checked = checked; });
            // Fire the team selection change with updated list
            const firstCb = checkboxes[0];
            if (firstCb) {
                const weekKey = String(firstCb.dataset.week || '').trim();
                if (weekKey) {
                    const selectedMembers = checked
                        ? Array.from(checkboxes).map(cb => String(cb.dataset.name || '').trim()).filter(Boolean)
                        : [];
                    options.onTeamSelectionChange?.({ weekKey, selectedMembers });
                }
            }
        };
        if (checkAllBtn) checkAllBtn.addEventListener('click', function() { toggleAll(true); });
        if (uncheckAllBtn) uncheckAllBtn.addEventListener('click', function() { toggleAll(false); });

        // Search filter
        const searchInput = document.getElementById('employeeSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', function() {
                const query = searchInput.value.toLowerCase().trim();
                const rows = container.querySelectorAll('#employeeListRows > div');
                rows.forEach(function(row) {
                    const name = (row.querySelector('strong')?.textContent || '').toLowerCase();
                    row.style.display = !query || name.includes(query) ? '' : 'none';
                });
            });
        }
    }

    function removeEmployeeFromDataSet(dataSet, employeeName) {
        let removedCount = 0;
        Object.keys(dataSet || {}).forEach(periodKey => {
            if (!dataSet[periodKey]?.employees) return;
            const beforeLength = dataSet[periodKey].employees.length;
            dataSet[periodKey].employees = dataSet[periodKey].employees.filter(emp => emp.name !== employeeName);
            if (dataSet[periodKey].employees.length < beforeLength) {
                removedCount += 1;
            }
        });
        return removedCount;
    }

    /**
     * @param {string} employeeName
     * @param {Record<string, unknown>} options
     * @returns {{ok: boolean, reason?: string, removedCount?: number}}
     */
    function deleteEmployee(employeeName, options = {}) {
        const confirmDelete = options.confirmDelete || ((message) => window.confirm(message));
        const weeklyData = options.weeklyData || {};
        const ytdData = options.ytdData || {};
        const storagePrefix = String(options.storagePrefix || '');

        if (!employeeName) return { ok: false, reason: 'missing-employee' };

        const shouldDelete = confirmDelete(`Are you sure you want to delete "${employeeName}" from ALL weekly and YTD data?\n\nThis will remove them from all uploaded periods and cannot be undone.`);
        if (!shouldDelete) return { ok: false, reason: 'cancelled' };

        const removedCount = removeEmployeeFromDataSet(weeklyData, employeeName)
            + removeEmployeeFromDataSet(ytdData, employeeName);

        options.saveWeeklyData?.();
        options.saveYtdData?.();
        options.normalizeTeamMembersForExistingWeeks?.();
        options.saveTeamMembers?.();

        try {
            const preferredNames = JSON.parse(localStorage.getItem(storagePrefix + 'employeePreferredNames') || '{}');
            delete preferredNames[employeeName];
            localStorage.setItem(storagePrefix + 'employeePreferredNames', JSON.stringify(preferredNames));
        } catch (_error) {
        }

        options.onAfterDelete?.(employeeName, removedCount);
        options.showToast?.(`✅ Deleted "${employeeName}" from ${removedCount} period(s)`, 3000);

        return { ok: true, removedCount };
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.employeeList = {
        getEmployeesFromWeeklyData,
        renderEmployeesList,
        deleteEmployee
    };
})();
