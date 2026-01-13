/* ========================================
   DEVELOPMENT COACHING TOOL - SHAREPOINT SERVICE
   Replaces localStorage with SharePoint Lists
   ======================================== */

// ============================================
// CONFIGURATION
// ============================================

const CoachingSharePointConfig = {
    lists: {
        weeklyData: 'CoachingWeeklyData',
        employees: 'CoachingEmployees',
        coachingLog: 'CoachingLogYTD',
        tips: 'CoachingTips',
        nicknames: 'CoachingEmployeeNicknames'
    }
};

// ============================================
// SHAREPOINT REST API HELPER (Reusable)
// ============================================

class SPRestAPI {
    static getSiteUrl() {
        if (typeof _spPageContextInfo !== 'undefined') {
            return _spPageContextInfo.webAbsoluteUrl;
        }
        return window.location.origin;
    }
    
    static getRequestDigest() {
        if (typeof _spPageContextInfo !== 'undefined') {
            return _spPageContextInfo.formDigestValue;
        }
        return '';
    }
    
    static async getItems(listName, filter = '', select = '', expand = '', top = 5000) {
        const siteUrl = this.getSiteUrl();
        let url = `${siteUrl}/_api/web/lists/getbytitle('${listName}')/items?$top=${top}`;
        
        if (filter) url += `&$filter=${encodeURIComponent(filter)}`;
        if (select) url += `&$select=${select}`;
        if (expand) url += `&$expand=${expand}`;
        
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json;odata=verbose',
                    'Content-Type': 'application/json;odata=verbose'
                },
                credentials: 'same-origin'
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
                throw new Error(`HTTP ${response.status}`);
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
                throw new Error(`HTTP ${response.status}`);
            }
            return true;
        } catch (error) {
            console.error(`Error deleting item from ${listName}:`, error);
            throw error;
        }
    }
}

// ============================================
// COACHING SHAREPOINT SERVICE
// ============================================

const CoachingSharePointService = {
    
    // ============================================
    // WEEKLY DATA
    // ============================================
    
    async loadWeeklyData() {
        const items = await SPRestAPI.getItems(CoachingSharePointConfig.lists.weeklyData);
        const weeklyData = {};
        
        items.forEach(item => {
            const weekKey = item.WeekKey; // Format: "2025-12-29|2026-01-04"
            
            weeklyData[weekKey] = {
                employees: JSON.parse(item.EmployeesData || '[]'),
                metadata: {
                    startDate: item.StartDate?.split('T')[0] || '',
                    endDate: item.EndDate?.split('T')[0] || '',
                    label: item.Label || '',
                    periodType: item.PeriodType || 'week',
                    uploadedAt: item.UploadedAt || item.Created
                }
            };
        });
        
        return weeklyData;
    },
    
    async saveWeeklyData(weeklyData) {
        // Get existing items
        const existingItems = await SPRestAPI.getItems(CoachingSharePointConfig.lists.weeklyData);
        const existingMap = {};
        existingItems.forEach(item => {
            existingMap[item.WeekKey] = item.ID;
        });
        
        // Save or update each week
        for (const [weekKey, data] of Object.entries(weeklyData)) {
            const itemData = {
                __metadata: { type: 'SP.Data.CoachingWeeklyDataListItem' },
                WeekKey: weekKey,
                EmployeesData: JSON.stringify(data.employees),
                StartDate: data.metadata.startDate ? new Date(data.metadata.startDate).toISOString() : null,
                EndDate: data.metadata.endDate ? new Date(data.metadata.endDate).toISOString() : null,
                Label: data.metadata.label || '',
                PeriodType: data.metadata.periodType || 'week',
                UploadedAt: data.metadata.uploadedAt || new Date().toISOString()
            };
            
            if (existingMap[weekKey]) {
                // Update existing
                await SPRestAPI.updateItem(CoachingSharePointConfig.lists.weeklyData, existingMap[weekKey], itemData);
            } else {
                // Create new
                await SPRestAPI.createItem(CoachingSharePointConfig.lists.weeklyData, itemData);
            }
        }
    },
    
    async deleteWeekData(weekKey) {
        const items = await SPRestAPI.getItems(
            CoachingSharePointConfig.lists.weeklyData,
            `WeekKey eq '${weekKey}'`
        );
        
        for (const item of items) {
            await SPRestAPI.deleteItem(CoachingSharePointConfig.lists.weeklyData, item.ID);
        }
    },
    
    // ============================================
    // COACHING LOG
    // ============================================
    
    async loadCoachingLog() {
        const items = await SPRestAPI.getItems(CoachingSharePointConfig.lists.coachingLog);
        
        return items.map(item => ({
            employeeName: item.EmployeeName,
            date: item.CoachingDate?.split('T')[0] || '',
            period: item.Period || '',
            metrics: JSON.parse(item.MetricsData || '{}'),
            emailSent: item.EmailSent === true,
            notes: item.Notes || ''
        }));
    },
    
    async saveCoachingLog(coachingLog) {
        // Clear existing log
        const existingItems = await SPRestAPI.getItems(CoachingSharePointConfig.lists.coachingLog);
        for (const item of existingItems) {
            await SPRestAPI.deleteItem(CoachingSharePointConfig.lists.coachingLog, item.ID);
        }
        
        // Save new log entries
        for (const entry of coachingLog) {
            const itemData = {
                __metadata: { type: 'SP.Data.CoachingLogYTDListItem' },
                EmployeeName: entry.employeeName,
                CoachingDate: new Date(entry.date).toISOString(),
                Period: entry.period || '',
                MetricsData: JSON.stringify(entry.metrics || {}),
                EmailSent: entry.emailSent === true,
                Notes: entry.notes || ''
            };
            
            await SPRestAPI.createItem(CoachingSharePointConfig.lists.coachingLog, itemData);
        }
    },
    
    // ============================================
    // EMPLOYEE NICKNAMES
    // ============================================
    
    async getEmployeeNicknames() {
        const items = await SPRestAPI.getItems(CoachingSharePointConfig.lists.nicknames);
        const nicknames = {};
        
        items.forEach(item => {
            nicknames[item.EmployeeName] = item.Nickname;
        });
        
        return nicknames;
    },
    
    async saveEmployeeNickname(employeeName, nickname) {
        const items = await SPRestAPI.getItems(
            CoachingSharePointConfig.lists.nicknames,
            `EmployeeName eq '${employeeName}'`
        );
        
        const itemData = {
            __metadata: { type: 'SP.Data.CoachingEmployeeNicknamesListItem' },
            EmployeeName: employeeName,
            Nickname: nickname
        };
        
        if (items.length > 0) {
            // Update existing
            await SPRestAPI.updateItem(CoachingSharePointConfig.lists.nicknames, items[0].ID, itemData);
        } else {
            // Create new
            await SPRestAPI.createItem(CoachingSharePointConfig.lists.nicknames, itemData);
        }
    },
    
    // ============================================
    // TIPS MANAGEMENT
    // ============================================
    
    async loadTips() {
        const items = await SPRestAPI.getItems(CoachingSharePointConfig.lists.tips);
        const tips = {};
        
        items.forEach(item => {
            const metricKey = item.MetricKey;
            const condition = item.Condition; // 'below', 'above', 'default'
            
            if (!tips[metricKey]) {
                tips[metricKey] = {};
            }
            
            tips[metricKey][condition] = item.TipText;
        });
        
        return tips;
    },
    
    async saveTip(metricKey, condition, tipText) {
        const items = await SPRestAPI.getItems(
            CoachingSharePointConfig.lists.tips,
            `MetricKey eq '${metricKey}' and Condition eq '${condition}'`
        );
        
        const itemData = {
            __metadata: { type: 'SP.Data.CoachingTipsListItem' },
            MetricKey: metricKey,
            Condition: condition,
            TipText: tipText
        };
        
        if (items.length > 0) {
            // Update existing
            await SPRestAPI.updateItem(CoachingSharePointConfig.lists.tips, items[0].ID, itemData);
        } else {
            // Create new
            await SPRestAPI.createItem(CoachingSharePointConfig.lists.tips, itemData);
        }
    },
    
    // ============================================
    // UTILITY METHODS
    // ============================================
    
    async exportAllData() {
        const data = {
            weeklyData: await this.loadWeeklyData(),
            coachingLog: await this.loadCoachingLog(),
            nicknames: await this.getEmployeeNicknames(),
            exportDate: new Date().toISOString()
        };
        
        return JSON.stringify(data, null, 2);
    },
    
    async importData(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            
            if (data.weeklyData) {
                await this.saveWeeklyData(data.weeklyData);
            }
            
            if (data.coachingLog) {
                await this.saveCoachingLog(data.coachingLog);
            }
            
            if (data.nicknames) {
                for (const [name, nickname] of Object.entries(data.nicknames)) {
                    await this.saveEmployeeNickname(name, nickname);
                }
            }
            
            return true;
        } catch (error) {
            console.error('Error importing data:', error);
            throw error;
        }
    },
    
    async clearAllData() {
        console.warn('clearAllData not implemented for SharePoint - use SharePoint list management');
    }
};

// Make available globally
window.CoachingSharePointService = CoachingSharePointService;
