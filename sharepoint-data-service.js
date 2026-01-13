/* ========================================
   SHAREPOINT DATA SERVICE
   Replaces localStorage with SharePoint Lists
   ======================================== */

// ============================================
// CONFIGURATION
// ============================================

const SharePointConfig = {
    siteUrl: '', // Will be set dynamically: _spPageContextInfo.webAbsoluteUrl
    lists: {
        employees: 'ReliabilityEmployees',
        leaveEntries: 'ReliabilityLeaveEntries',
        schedules: 'ReliabilitySchedules',
        emailLog: 'ReliabilityEmailLog',
        auditLog: 'ReliabilityAuditLog',
        supervisorTeams: 'ReliabilitySupervisorTeams'
    }
};

// ============================================
// SHAREPOINT REST API HELPER
// ============================================

class SharePointAPI {
    static getSiteUrl() {
        // Get SharePoint site URL from page context
        if (typeof _spPageContextInfo !== 'undefined') {
            return _spPageContextInfo.webAbsoluteUrl;
        }
        // Fallback for testing
        return window.location.origin;
    }
    
    static getRequestDigest() {
        // Get form digest value for POST/DELETE operations
        if (typeof _spPageContextInfo !== 'undefined') {
            return _spPageContextInfo.formDigestValue;
        }
        return '';
    }
    
    static async getItems(listName, filter = '', select = '', expand = '') {
        const siteUrl = this.getSiteUrl();
        let url = `${siteUrl}/_api/web/lists/getbytitle('${listName}')/items`;
        
        const params = [];
        if (filter) params.push(`$filter=${encodeURIComponent(filter)}`);
        if (select) params.push(`$select=${select}`);
        if (expand) params.push(`$expand=${expand}`);
        
        if (params.length > 0) {
            url += '?' + params.join('&');
        }
        
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json;odata=verbose',
                    'Content-Type': 'application/json;odata=verbose'
                },
                credentials: 'same-origin'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            return data.d.results || [];
        } catch (error) {
            console.error(`Error getting items from ${listName}:`, error);
            return [];
        }
    }
    
    static async createItem(listName, itemData) {
        const siteUrl = this.getSiteUrl();
        const url = `${siteUrl}/_api/web/lists/getbytitle('${listName}')/items`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json;odata=verbose',
                    'Content-Type': 'application/json;odata=verbose',
                    'X-RequestDigest': this.getRequestDigest()
                },
                credentials: 'same-origin',
                body: JSON.stringify(itemData)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            return data.d;
        } catch (error) {
            console.error(`Error creating item in ${listName}:`, error);
            throw error;
        }
    }
    
    static async updateItem(listName, itemId, itemData) {
        const siteUrl = this.getSiteUrl();
        const url = `${siteUrl}/_api/web/lists/getbytitle('${listName}')/items(${itemId})`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json;odata=verbose',
                    'Content-Type': 'application/json;odata=verbose',
                    'X-RequestDigest': this.getRequestDigest(),
                    'IF-MATCH': '*',
                    'X-HTTP-Method': 'MERGE'
                },
                credentials: 'same-origin',
                body: JSON.stringify(itemData)
            });
            
            if (!response.ok && response.status !== 204) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return true;
        } catch (error) {
            console.error(`Error updating item in ${listName}:`, error);
            throw error;
        }
    }
    
    static async deleteItem(listName, itemId) {
        const siteUrl = this.getSiteUrl();
        const url = `${siteUrl}/_api/web/lists/getbytitle('${listName}')/items(${itemId})`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json;odata=verbose',
                    'X-RequestDigest': this.getRequestDigest(),
                    'IF-MATCH': '*',
                    'X-HTTP-Method': 'DELETE'
                },
                credentials: 'same-origin'
            });
            
            if (!response.ok && response.status !== 204) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return true;
        } catch (error) {
            console.error(`Error deleting item from ${listName}:`, error);
            throw error;
        }
    }
}

// ============================================
// SHAREPOINT DATA SERVICE
// ============================================

const SharePointDataService = {
    // ============================================
    // EMPLOYEES
    // ============================================
    
    async getEmployees() {
        const items = await SharePointAPI.getItems(SharePointConfig.lists.employees);
        return items.map(item => ({
            id: item.ID.toString(),
            name: item.Title,
            email: item.Email || '',
            hireDate: item.HireDate || '',
            supervisor: item.Supervisor || '',
            isActive: item.IsActive !== false
        }));
    },
    
    async saveEmployee(employee) {
        const itemData = {
            __metadata: { type: 'SP.Data.ReliabilityEmployeesListItem' },
            Title: employee.name,
            Email: employee.email || '',
            HireDate: employee.hireDate || '',
            Supervisor: employee.supervisor || '',
            IsActive: employee.isActive !== false
        };
        
        if (employee.spItemId) {
            // Update existing
            await SharePointAPI.updateItem(SharePointConfig.lists.employees, employee.spItemId, itemData);
            return employee;
        } else {
            // Create new
            const result = await SharePointAPI.createItem(SharePointConfig.lists.employees, itemData);
            return {
                ...employee,
                id: result.ID.toString(),
                spItemId: result.ID
            };
        }
    },
    
    async deleteEmployee(employeeId) {
        const items = await SharePointAPI.getItems(
            SharePointConfig.lists.employees,
            `ID eq ${employeeId}`
        );
        
        if (items.length > 0) {
            await SharePointAPI.deleteItem(SharePointConfig.lists.employees, items[0].ID);
        }
    },
    
    // ============================================
    // LEAVE ENTRIES
    // ============================================
    
    async getLeaveEntriesForEmployee(employeeName, startDate = null, endDate = null) {
        let filter = `EmployeeName eq '${employeeName}' and IsDeleted eq false`;
        
        if (startDate) {
            filter += ` and LeaveDate ge datetime'${startDate}T00:00:00'`;
        }
        if (endDate) {
            filter += ` and LeaveDate le datetime'${endDate}T23:59:59'`;
        }
        
        const items = await SharePointAPI.getItems(SharePointConfig.lists.leaveEntries, filter);
        
        return items.map(item => ({
            id: item.ID.toString(),
            spItemId: item.ID,
            employeeName: item.EmployeeName,
            date: item.LeaveDate.split('T')[0],
            leaveType: item.LeaveType,
            minutesMissed: parseFloat(item.MinutesMissed),
            ptostApplied: item.PTOSTApplied === true,
            reason: item.Reason || '',
            supervisorNotes: item.SupervisorNotes || '',
            createdAt: item.Created,
            isDeleted: item.IsDeleted === true,
            deletedReason: item.DeletedReason || ''
        }));
    },
    
    async saveLeaveEntry(entry) {
        const itemData = {
            __metadata: { type: 'SP.Data.ReliabilityLeaveEntriesListItem' },
            EmployeeName: entry.employeeName,
            LeaveDate: new Date(entry.date).toISOString(),
            LeaveType: entry.leaveType,
            MinutesMissed: entry.minutesMissed,
            PTOSTApplied: entry.ptostApplied === true,
            Reason: entry.reason || '',
            SupervisorNotes: entry.supervisorNotes || '',
            IsDeleted: entry.isDeleted === true,
            DeletedReason: entry.deletedReason || ''
        };
        
        if (entry.spItemId) {
            // Update existing
            await SharePointAPI.updateItem(SharePointConfig.lists.leaveEntries, entry.spItemId, itemData);
            return entry;
        } else {
            // Create new
            const result = await SharePointAPI.createItem(SharePointConfig.lists.leaveEntries, itemData);
            return {
                ...entry,
                id: result.ID.toString(),
                spItemId: result.ID,
                createdAt: result.Created
            };
        }
    },
    
    async deleteLeaveEntry(entryId, reason = '') {
        // Soft delete - mark as deleted
        await SharePointAPI.updateItem(SharePointConfig.lists.leaveEntries, entryId, {
            __metadata: { type: 'SP.Data.ReliabilityLeaveEntriesListItem' },
            IsDeleted: true,
            DeletedReason: reason
        });
    },
    
    // ============================================
    // SCHEDULES
    // ============================================
    
    async getEmployeeSchedule(employeeName) {
        const items = await SharePointAPI.getItems(
            SharePointConfig.lists.schedules,
            `EmployeeName eq '${employeeName}'`
        );
        
        if (items.length === 0) return null;
        
        const item = items[0];
        return {
            spItemId: item.ID,
            employeeName: item.EmployeeName,
            shiftStart: item.ShiftStart,
            shiftEnd: item.ShiftEnd,
            lunchDuration: parseInt(item.LunchDuration) || 30,
            workDays: item.WorkDays ? item.WorkDays.split(',') : [],
            initialPTOST: parseFloat(item.InitialPTOST) || 40
        };
    },
    
    async saveEmployeeSchedule(schedule) {
        const itemData = {
            __metadata: { type: 'SP.Data.ReliabilitySchedulesListItem' },
            EmployeeName: schedule.employeeName,
            ShiftStart: schedule.shiftStart,
            ShiftEnd: schedule.shiftEnd,
            LunchDuration: schedule.lunchDuration,
            WorkDays: Array.isArray(schedule.workDays) ? schedule.workDays.join(',') : '',
            InitialPTOST: schedule.initialPTOST || 40
        };
        
        const existing = await this.getEmployeeSchedule(schedule.employeeName);
        
        if (existing && existing.spItemId) {
            // Update existing
            await SharePointAPI.updateItem(SharePointConfig.lists.schedules, existing.spItemId, itemData);
        } else {
            // Create new
            await SharePointAPI.createItem(SharePointConfig.lists.schedules, itemData);
        }
    },
    
    // ============================================
    // SUPERVISOR TEAMS
    // ============================================
    
    async getSupervisorTeams() {
        const items = await SharePointAPI.getItems(SharePointConfig.lists.supervisorTeams);
        const teams = {};
        
        items.forEach(item => {
            const supervisor = item.SupervisorName;
            const employeeName = item.EmployeeName;
            
            if (!teams[supervisor]) {
                teams[supervisor] = [];
            }
            teams[supervisor].push(employeeName);
        });
        
        return teams;
    },
    
    async getTeamMembers(supervisorName) {
        const items = await SharePointAPI.getItems(
            SharePointConfig.lists.supervisorTeams,
            `SupervisorName eq '${supervisorName}'`
        );
        
        return items.map(item => item.EmployeeName);
    },
    
    async addTeamMember(supervisorName, employeeName) {
        const itemData = {
            __metadata: { type: 'SP.Data.ReliabilitySupervisorTeamsListItem' },
            SupervisorName: supervisorName,
            EmployeeName: employeeName
        };
        
        await SharePointAPI.createItem(SharePointConfig.lists.supervisorTeams, itemData);
    },
    
    async removeTeamMember(supervisorName, employeeName) {
        const items = await SharePointAPI.getItems(
            SharePointConfig.lists.supervisorTeams,
            `SupervisorName eq '${supervisorName}' and EmployeeName eq '${employeeName}'`
        );
        
        for (const item of items) {
            await SharePointAPI.deleteItem(SharePointConfig.lists.supervisorTeams, item.ID);
        }
    },
    
    // ============================================
    // EMAIL LOG
    // ============================================
    
    async getEmailsForEmployee(employeeName) {
        const items = await SharePointAPI.getItems(
            SharePointConfig.lists.emailLog,
            `EmployeeName eq '${employeeName}'`
        );
        
        return items.map(item => ({
            id: item.ID.toString(),
            employeeName: item.EmployeeName,
            subject: item.Subject,
            body: item.Body,
            emailType: item.EmailType,
            relatedEntryIds: item.RelatedEntryIds ? item.RelatedEntryIds.split(',') : [],
            sentAt: item.Created
        }));
    },
    
    async logEmail(emailData) {
        const itemData = {
            __metadata: { type: 'SP.Data.ReliabilityEmailLogListItem' },
            EmployeeName: emailData.employeeName,
            Subject: emailData.subject,
            Body: emailData.body,
            EmailType: emailData.emailType,
            RelatedEntryIds: Array.isArray(emailData.relatedEntryIds) ? emailData.relatedEntryIds.join(',') : ''
        };
        
        await SharePointAPI.createItem(SharePointConfig.lists.emailLog, itemData);
    },
    
    // ============================================
    // AUDIT LOG
    // ============================================
    
    async logAction(action, details) {
        const itemData = {
            __metadata: { type: 'SP.Data.ReliabilityAuditLogListItem' },
            Action: action,
            Details: JSON.stringify(details),
            Timestamp: new Date().toISOString()
        };
        
        await SharePointAPI.createItem(SharePointConfig.lists.auditLog, itemData);
    },
    
    // ============================================
    // UTILITY METHODS
    // ============================================
    
    async getAllEmployees() {
        return await this.getEmployees();
    },
    
    async exportAllData() {
        const data = {
            employees: await this.getEmployees(),
            schedules: await SharePointAPI.getItems(SharePointConfig.lists.schedules),
            supervisorTeams: await this.getSupervisorTeams(),
            exportDate: new Date().toISOString()
        };
        
        return JSON.stringify(data, null, 2);
    },
    
    async clearAllData() {
        // This is dangerous - implement with caution
        console.warn('clearAllData not implemented for SharePoint - use SharePoint list management');
    }
};

// Make available globally
window.SharePointDataService = SharePointDataService;
