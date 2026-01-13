/* ========================================
   RELIABILITY TRACKER - DATA LAYER
   Database abstraction (localStorage for Phase 1)
   ======================================== */

/* ========================================
   STORAGE KEYS
   ======================================== */
const STORAGE_KEYS = {
    EMPLOYEES: 'reliability_employees',
    LEAVE_ENTRIES: 'reliability_leaveEntries',
    SCHEDULES: 'reliability_schedules',
    EMAIL_LOG: 'reliability_emailLog',
    AUDIT_LOG: 'reliability_auditLog',
    SUPERVISOR_TEAMS: 'reliability_supervisorTeams'
};

/* ========================================
   DATA ACCESS LAYER
   ======================================== */
const ReliabilityDataService = {
    
    // ============================================
    // EMPLOYEES
    // ============================================
    
    getAllEmployees() {
        const data = localStorage.getItem(STORAGE_KEYS.EMPLOYEES);
        return data ? JSON.parse(data) : [];
    },
    
    getEmployeeByName(employeeName) {
        const employees = this.getAllEmployees();
        return employees.find(e => e.fullName === employeeName) || null;
    },
    
    saveEmployee(employee) {
        const employees = this.getAllEmployees();
        const existingIndex = employees.findIndex(e => e.fullName === employee.fullName);
        
        const employeeData = {
            fullName: employee.fullName,
            email: employee.email || '',
            supervisorName: employee.supervisorName || '',
            hireDate: employee.hireDate || '',
            isActive: employee.isActive !== false,
            createdAt: employee.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        if (existingIndex >= 0) {
            employees[existingIndex] = { ...employees[existingIndex], ...employeeData };
        } else {
            employees.push(employeeData);
        }
        
        localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(employees));
        return employeeData;
    },
    
    deleteEmployee(employeeName) {
        let employees = this.getAllEmployees();
        employees = employees.filter(e => e.fullName !== employeeName);
        localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(employees));
    },
    
    // ============================================
    // LEAVE ENTRIES
    // ============================================
    
    getAllLeaveEntries() {
        const data = localStorage.getItem(STORAGE_KEYS.LEAVE_ENTRIES);
        return data ? JSON.parse(data) : [];
    },
    
    getLeaveEntriesForEmployee(employeeName, startDate = null, endDate = null, includeDeleted = false) {
        let entries = this.getAllLeaveEntries();
        
        entries = entries.filter(entry => entry.employeeName === employeeName);
        
        if (!includeDeleted) {
            entries = entries.filter(entry => !entry.isDeleted);
        }
        
        if (startDate) {
            entries = entries.filter(entry => entry.leaveDate >= startDate);
        }
        
        if (endDate) {
            entries = entries.filter(entry => entry.leaveDate <= endDate);
        }
        
        return entries.sort((a, b) => b.leaveDate.localeCompare(a.leaveDate));
    },
    
    getLeaveEntryById(entryId) {
        const entries = this.getAllLeaveEntries();
        return entries.find(e => e.entryId === entryId) || null;
    },
    
    saveLeaveEntry(entry) {
        const entries = this.getAllLeaveEntries();
        const existingIndex = entries.findIndex(e => e.entryId === entry.entryId);
        
        if (existingIndex >= 0) {
            entries[existingIndex] = entry;
        } else {
            entries.push(entry);
        }
        
        localStorage.setItem(STORAGE_KEYS.LEAVE_ENTRIES, JSON.stringify(entries));
        
        // Log audit trail
        this.logAudit({
            entityType: 'LeaveEntry',
            entityId: entry.entryId,
            action: existingIndex >= 0 ? 'UPDATE' : 'CREATE',
            performedBy: entry.lastModifiedBy || entry.createdBy,
            changeDetails: entry
        });
        
        return entry;
    },
    
    deleteLeaveEntry(entryId, deletedBy, reason) {
        const entries = this.getAllLeaveEntries();
        const entryIndex = entries.findIndex(e => e.entryId === entryId);
        
        if (entryIndex >= 0) {
            entries[entryIndex].isDeleted = true;
            entries[entryIndex].deletedBy = deletedBy;
            entries[entryIndex].deletedAt = new Date().toISOString();
            entries[entryIndex].deletionReason = reason;
            
            localStorage.setItem(STORAGE_KEYS.LEAVE_ENTRIES, JSON.stringify(entries));
            
            this.logAudit({
                entityType: 'LeaveEntry',
                entityId: entryId,
                action: 'DELETE',
                performedBy: deletedBy,
                changeDetails: { reason }
            });
        }
    },
    
    // ============================================
    // SCHEDULES
    // ============================================
    
    getAllSchedules() {
        const data = localStorage.getItem(STORAGE_KEYS.SCHEDULES);
        return data ? JSON.parse(data) : [];
    },
    
    getActiveSchedule(employeeName) {
        const schedules = this.getAllSchedules();
        const today = ReliabilityUtils.getTodayDate();
        
        return schedules.find(s => 
            s.employeeName === employeeName &&
            s.effectiveStartDate <= today &&
            (s.effectiveEndDate === null || s.effectiveEndDate >= today)
        ) || this.getDefaultSchedule(employeeName);
    },
    
    getDefaultSchedule(employeeName) {
        return {
            employeeName,
            shiftStartTime: '08:00',
            shiftEndTime: '17:00',
            scheduledHoursPerDay: 8,
            lunchDurationMinutes: 30,
            lunchStartTime: '12:00',
            workDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        };
    },
    
    saveSchedule(schedule) {
        const schedules = this.getAllSchedules();
        const existingIndex = schedules.findIndex(s => 
            s.employeeName === schedule.employeeName &&
            s.effectiveStartDate === schedule.effectiveStartDate
        );
        
        const scheduleData = {
            scheduleId: schedule.scheduleId || ReliabilityUtils.generateId(),
            employeeName: schedule.employeeName,
            effectiveStartDate: schedule.effectiveStartDate || ReliabilityUtils.getTodayDate(),
            effectiveEndDate: schedule.effectiveEndDate || null,
            shiftStartTime: schedule.shiftStartTime || '08:00',
            shiftEndTime: schedule.shiftEndTime || '17:00',
            scheduledHoursPerDay: schedule.scheduledHoursPerDay || 8,
            lunchDurationMinutes: schedule.lunchDurationMinutes || 30,
            lunchStartTime: schedule.lunchStartTime || '12:00',
            workDays: schedule.workDays || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            notes: schedule.notes || '',
            createdAt: schedule.createdAt || new Date().toISOString()
        };
        
        if (existingIndex >= 0) {
            schedules[existingIndex] = scheduleData;
        } else {
            schedules.push(scheduleData);
        }
        
        localStorage.setItem(STORAGE_KEYS.SCHEDULES, JSON.stringify(schedules));
        return scheduleData;
    },
    
    // ============================================
    // EMAIL LOG
    // ============================================
    
    getAllEmails() {
        const data = localStorage.getItem(STORAGE_KEYS.EMAIL_LOG);
        return data ? JSON.parse(data) : [];
    },
    
    getEmailsForEmployee(employeeName) {
        const emails = this.getAllEmails();
        return emails
            .filter(e => e.employeeName === employeeName)
            .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    },
    
    saveEmail(emailData) {
        const emails = this.getAllEmails();
        
        const email = {
            emailId: ReliabilityUtils.generateId(),
            employeeName: emailData.employeeName,
            sentBy: emailData.sentBy,
            emailType: emailData.emailType,
            subject: emailData.subject,
            bodyText: emailData.bodyText,
            relatedLeaveEntryIds: emailData.relatedLeaveEntryIds || [],
            sentAt: new Date().toISOString(),
            employeeResponse: emailData.employeeResponse || null,
            responseReceivedAt: emailData.responseReceivedAt || null
        };
        
        emails.push(email);
        localStorage.setItem(STORAGE_KEYS.EMAIL_LOG, JSON.stringify(emails));
        
        this.logAudit({
            entityType: 'Email',
            entityId: email.emailId,
            action: 'EMAIL_SENT',
            performedBy: emailData.sentBy,
            changeDetails: { employeeName: emailData.employeeName, emailType: emailData.emailType }
        });
        
        return email;
    },
    
    updateEmailResponse(emailId, responseText, respondedBy) {
        const emails = this.getAllEmails();
        const emailIndex = emails.findIndex(e => e.emailId === emailId);
        
        if (emailIndex >= 0) {
            emails[emailIndex].employeeResponse = responseText;
            emails[emailIndex].responseReceivedAt = new Date().toISOString();
            localStorage.setItem(STORAGE_KEYS.EMAIL_LOG, JSON.stringify(emails));
        }
    },
    
    // ============================================
    // SUPERVISOR TEAMS
    // ============================================
    
    getSupervisorTeams() {
        const data = localStorage.getItem(STORAGE_KEYS.SUPERVISOR_TEAMS);
        return data ? JSON.parse(data) : {};
    },
    
    getTeamMembers(supervisorName) {
        const teams = this.getSupervisorTeams();
        return teams[supervisorName] || [];
    },
    
    setTeamMembers(supervisorName, employeeNames) {
        const teams = this.getSupervisorTeams();
        teams[supervisorName] = employeeNames;
        localStorage.setItem(STORAGE_KEYS.SUPERVISOR_TEAMS, JSON.stringify(teams));
    },
    
    addTeamMember(supervisorName, employeeName) {
        const teamMembers = this.getTeamMembers(supervisorName);
        if (!teamMembers.includes(employeeName)) {
            teamMembers.push(employeeName);
            this.setTeamMembers(supervisorName, teamMembers);
        }
    },
    
    removeTeamMember(supervisorName, employeeName) {
        let teamMembers = this.getTeamMembers(supervisorName);
        teamMembers = teamMembers.filter(name => name !== employeeName);
        this.setTeamMembers(supervisorName, teamMembers);
    },
    
    // ============================================
    // AUDIT LOG
    // ============================================
    
    logAudit(auditData) {
        const logs = this.getAllAuditLogs();
        
        const logEntry = {
            auditId: ReliabilityUtils.generateId(),
            entityType: auditData.entityType,
            entityId: auditData.entityId,
            action: auditData.action,
            performedBy: auditData.performedBy,
            performedAt: new Date().toISOString(),
            changeDetails: auditData.changeDetails,
            reason: auditData.reason || null
        };
        
        logs.push(logEntry);
        
        // Keep only last 1000 audit entries to prevent excessive storage
        if (logs.length > 1000) {
            logs.splice(0, logs.length - 1000);
        }
        
        localStorage.setItem(STORAGE_KEYS.AUDIT_LOG, JSON.stringify(logs));
    },
    
    getAllAuditLogs() {
        const data = localStorage.getItem(STORAGE_KEYS.AUDIT_LOG);
        return data ? JSON.parse(data) : [];
    },
    
    getAuditLogsForEntity(entityType, entityId) {
        const logs = this.getAllAuditLogs();
        return logs
            .filter(log => log.entityType === entityType && log.entityId === entityId)
            .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
    },
    
    getAuditLogsForEmployee(employeeName, startDate = null, endDate = null) {
        const logs = this.getAllAuditLogs();
        return logs
            .filter(log => {
                if (log.entityType === 'LeaveEntry' && log.changeDetails?.employeeName === employeeName) return true;
                if (log.entityType === 'Email' && log.changeDetails?.employeeName === employeeName) return true;
                return false;
            })
            .filter(log => {
                if (!startDate && !endDate) return true;
                if (startDate && log.performedAt < startDate) return false;
                if (endDate && log.performedAt > endDate) return false;
                return true;
            })
            .sort((a, b) => b.performedAt.localeCompare(a.performedAt));
    },
    
    // ============================================
    // DATA MANAGEMENT (Backup/Restore/Clear)
    // ============================================
    
    exportAllData() {
        return {
            employees: this.getAllEmployees(),
            leaveEntries: this.getAllLeaveEntries(),
            schedules: this.getAllSchedules(),
            emailLog: this.getAllEmails(),
            auditLog: this.getAllAuditLogs(),
            supervisorTeams: this.getSupervisorTeams(),
            exportedAt: new Date().toISOString(),
            version: '1.0'
        };
    },
    
    importAllData(data) {
        if (data.employees) {
            localStorage.setItem(STORAGE_KEYS.EMPLOYEES, JSON.stringify(data.employees));
        }
        if (data.leaveEntries) {
            localStorage.setItem(STORAGE_KEYS.LEAVE_ENTRIES, JSON.stringify(data.leaveEntries));
        }
        if (data.schedules) {
            localStorage.setItem(STORAGE_KEYS.SCHEDULES, JSON.stringify(data.schedules));
        }
        if (data.emailLog) {
            localStorage.setItem(STORAGE_KEYS.EMAIL_LOG, JSON.stringify(data.emailLog));
        }
        if (data.auditLog) {
            localStorage.setItem(STORAGE_KEYS.AUDIT_LOG, JSON.stringify(data.auditLog));
        }
        if (data.supervisorTeams) {
            localStorage.setItem(STORAGE_KEYS.SUPERVISOR_TEAMS, JSON.stringify(data.supervisorTeams));
        }
    },
    
    clearAllData() {
        Object.values(STORAGE_KEYS).forEach(key => {
            localStorage.removeItem(key);
        });
    },
    
    // ============================================
    // INITIALIZATION & SEED DATA
    // ============================================
    
    initializeWithSampleData() {
        // Only initialize if no data exists
        if (this.getAllEmployees().length > 0) {
            return;
        }
        
        // Sample employees
        const sampleEmployees = [
            { fullName: 'John Doe', email: 'john.doe@example.com', supervisorName: 'Jane Manager', hireDate: '2024-03-15', isActive: true },
            { fullName: 'Jane Smith', email: 'jane.smith@example.com', supervisorName: 'Jane Manager', hireDate: '2023-07-22', isActive: true },
            { fullName: 'Bob Johnson', email: 'bob.johnson@example.com', supervisorName: 'Jane Manager', hireDate: '2025-01-10', isActive: true }
        ];
        
        sampleEmployees.forEach(emp => this.saveEmployee(emp));
        
        // Sample supervisor team
        this.setTeamMembers('Jane Manager', ['John Doe', 'Jane Smith', 'Bob Johnson']);
        
        // Sample schedules (default for all)
        sampleEmployees.forEach(emp => {
            this.saveSchedule({
                employeeName: emp.fullName,
                effectiveStartDate: emp.hireDate,
                shiftStartTime: '08:00',
                shiftEndTime: '17:00',
                scheduledHoursPerDay: 8,
                lunchDurationMinutes: 30,
                lunchStartTime: '12:00',
                initialPTOST: 40,
                initialPTO: 80
            });
        });
    }
};
