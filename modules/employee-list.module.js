(function() {
    'use strict';

    /**
     * @param {Record<string, {employees?: Array<{name?: string}>}>} weeklyData
     * @returns {string[]}
     */
    function getEmployeesFromWeeklyData(weeklyData) {
        const employeeSet = new Set();
        Object.values(weeklyData || {}).forEach(week => {
            if (week?.employees) {
                week.employees.forEach(emp => {
                    if (emp?.name) employeeSet.add(emp.name);
                });
            }
        });

        return Array.from(employeeSet).sort();
    }

    function buildEmployeeRowHtml(name, preferredNames, options = {}) {
        const getEmployeeNickname = options.getEmployeeNickname || ((value) => value);
        const escapeHtml = options.escapeHtml || ((value) => String(value || ''));

        const currentPreferred = preferredNames[name] || getEmployeeNickname(name);
        const defaultValue = preferredNames[name] || '';

        return `
        <div style="padding: 15px; border-bottom: 1px solid #eee; background: #fafafa;">
            <div style="display: flex; justify-content: space-between; align-items: start; gap: 15px;">
                <div style="flex: 1;">
                    <strong style="color: #6a1b9a;">${name}</strong>
                    <div style="font-size: 0.8em; color: #666; margin: 5px 0 0 0;">Source: Weekly Data Uploads</div>
                </div>
                <div style="flex: 1; min-width: 200px;">
                    <label style="font-size: 0.85em; color: #666; display: block; margin-bottom: 5px; font-weight: 500;">How to Address:</label>
                    <input type="text" id="prefName_${escapeHtml(name)}" value="${defaultValue}" placeholder="${getEmployeeNickname(name)}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9em; box-sizing: border-box;">
                    <div style="font-size: 0.75em; color: #999; margin-top: 3px;">Current: <strong>${currentPreferred}</strong></div>
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

        container.innerHTML = `<div style="padding: 15px; background: #f0f8ff; border-bottom: 2px solid #6a1b9a; font-weight: bold; color: #6a1b9a;">Total Employees: ${employees.length}</div>` +
            employees.map(name => buildEmployeeRowHtml(name, preferredNames, options)).join('');

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
            container.dataset.employeeHandlersBound = 'true';
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
