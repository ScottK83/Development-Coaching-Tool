/* ========================================
   RELIABILITY TRACKER - SHARED SERVICES
   Business logic layer (calculation, validation)
   ======================================== */

/* ========================================
   DESIGN PRINCIPLES:
   - Single source of truth for all calculations
   - Deterministic behavior (no guessing)
   - Testable, isolated functions
   - No UI logic in services
   ======================================== */

// ============================================
// LEAVE CALCULATION SERVICE
// ============================================
const LeaveCalculationService = {
    
    /**
     * Calculate minutes missed between departure time and scheduled end time
     * Accounts for lunch break if it falls within the missed window
     * 
     * @param {string} departureTime - Time employee left (e.g., "12:06", "14:30")
     * @param {string} scheduledEndTime - When shift should end (e.g., "17:00")
     * @param {number} lunchDurationMinutes - Length of lunch break (30 or 60)
     * @param {string} lunchStartTime - When lunch break starts (e.g., "12:00")
     * @returns {number} Total minutes missed (excluding lunch if applicable)
     */
    calculateMinutesMissed(departureTime, scheduledEndTime, lunchDurationMinutes = 30, lunchStartTime = "12:00") {
        // Parse times to minutes since midnight
        const parseTime = (timeStr) => {
            const [hours, minutes] = timeStr.split(':').map(Number);
            return hours * 60 + minutes;
        };
        
        const departureMinutes = parseTime(departureTime);
        const endMinutes = parseTime(scheduledEndTime);
        const lunchStartMinutes = parseTime(lunchStartTime);
        const lunchEndMinutes = lunchStartMinutes + lunchDurationMinutes;
        
        // Calculate raw time missed
        let minutesMissed = endMinutes - departureMinutes;
        
        // If lunch falls within the missed time window, subtract it
        // Lunch is included if: departureMinutes <= lunchStartMinutes AND endMinutes >= lunchEndMinutes
        if (departureMinutes <= lunchStartMinutes && endMinutes >= lunchEndMinutes) {
            minutesMissed -= lunchDurationMinutes;
        }
        
        // Handle edge case: partial lunch overlap
        // If left during lunch or lunch extends past end time
        if (departureMinutes > lunchStartMinutes && departureMinutes < lunchEndMinutes) {
            // Left during lunch - only subtract remaining lunch time
            const remainingLunch = lunchEndMinutes - departureMinutes;
            if (remainingLunch > 0 && endMinutes >= lunchEndMinutes) {
                minutesMissed -= remainingLunch;
            }
        }
        
        return Math.max(0, minutesMissed);
    },
    
    /**
     * Convert minutes to hours with decimal precision
     */
    minutesToHours(minutes) {
        return Math.round(minutes / 60 * 100) / 100;
    },
    
    /**
     * Convert hours to minutes
     */
    hoursToMinutes(hours) {
        return Math.round(hours * 60);
    },
    
    /**
     * Format minutes as "X.Xh" display string
     */
    formatMinutesAsHours(minutes) {
        const hours = this.minutesToHours(minutes);
        return `${hours.toFixed(1)}h`;
    },
    
    /**
     * Get total minutes for specific criteria
     */
    getTotalMinutes(leaveEntries, filters = {}) {
        return leaveEntries
            .filter(entry => !entry.isDeleted)
            .filter(entry => {
                if (filters.employeeName && entry.employeeName !== filters.employeeName) return false;
                if (filters.startDate && entry.leaveDate < filters.startDate) return false;
                if (filters.endDate && entry.leaveDate > filters.endDate) return false;
                if (filters.ptostOnly && !entry.ptostApplied) return false;
                if (filters.plannedOnly && entry.leaveType !== 'Planned') return false;
                if (filters.unplannedOnly && entry.leaveType !== 'Unplanned') return false;
                return true;
            })
            .reduce((sum, entry) => sum + entry.minutesMissed, 0);
    },
    
    /**
     * Get comprehensive breakdown of leave minutes
     */
    getMinutesBreakdown(leaveEntries, employeeName, startDate, endDate) {
        const filtered = leaveEntries.filter(entry => 
            !entry.isDeleted &&
            entry.employeeName === employeeName &&
            entry.leaveDate >= startDate &&
            entry.leaveDate <= endDate
        );
        
        const totalMissed = filtered.reduce((sum, e) => sum + e.minutesMissed, 0);
        const planned = filtered.filter(e => e.leaveType === 'Planned').reduce((sum, e) => sum + e.minutesMissed, 0);
        const unplanned = filtered.filter(e => e.leaveType === 'Unplanned').reduce((sum, e) => sum + e.minutesMissed, 0);
        const ptostUsed = filtered.filter(e => e.ptostApplied).reduce((sum, e) => sum + e.minutesMissed, 0);
        const reliabilityMinutes = filtered.filter(e => e.leaveType === 'Unplanned' && !e.ptostApplied).reduce((sum, e) => sum + e.minutesMissed, 0);
        
        return {
            totalMissed,
            planned,
            unplanned,
            ptostUsed,
            reliabilityMinutes
        };
    }
};

// ============================================
// PTOST SERVICE
// ============================================
const PTOSTService = {
    
    /**
     * Get current PTOST balance for an employee
     */
    getCurrentBalance(employeeName, leaveEntries, year = new Date().getFullYear()) {
        const thresholdMinutes = 2400; // 40 hours
        
        // Get PTOST reset date for this year
        const resetDate = this.getResetDateForYear(year);
        
        // Calculate used PTOST (only entries where ptostApplied=true in this calendar year)
        const yearStart = `${year}-01-01`;
        const yearEnd = `${year}-12-31`;
        
        const usedMinutes = leaveEntries
            .filter(entry => 
                !entry.isDeleted &&
                entry.employeeName === employeeName &&
                entry.ptostApplied === true &&
                entry.leaveDate >= yearStart &&
                entry.leaveDate <= yearEnd
            )
            .reduce((sum, entry) => sum + entry.minutesMissed, 0);
        
        const remainingMinutes = thresholdMinutes - usedMinutes;
        const isExhausted = remainingMinutes <= 0;
        
        return {
            year,
            thresholdMinutes,
            usedMinutes,
            remainingMinutes: Math.max(0, remainingMinutes),
            isExhausted,
            resetDate,
            percentUsed: Math.round((usedMinutes / thresholdMinutes) * 100)
        };
    },
    
    /**
     * Get PTOST reset date for a given year
     * Reset happens first pay period of following year
     */
    getResetDateForYear(year) {
        // Hardcoded for now - can be made configurable
        const resetDates = {
            2026: '2025-12-22',
            2027: '2026-12-21',
            2028: '2027-12-20'
        };
        
        return resetDates[year] || `${year - 1}-12-22`;
    },
    
    /**
     * Check if PTOST can be applied to proposed minutes
     */
    canApplyPTOST(employeeName, proposedMinutes, leaveEntries, year = new Date().getFullYear()) {
        const balance = this.getCurrentBalance(employeeName, leaveEntries, year);
        
        if (balance.remainingMinutes >= proposedMinutes) {
            return {
                allowed: true,
                remaining: balance.remainingMinutes,
                message: `Sufficient PTOST available. ${LeaveCalculationService.formatMinutesAsHours(balance.remainingMinutes - proposedMinutes)} will remain.`
            };
        } else {
            return {
                allowed: false,
                remaining: balance.remainingMinutes,
                message: `Insufficient PTOST. Only ${LeaveCalculationService.formatMinutesAsHours(balance.remainingMinutes)} available.`
            };
        }
    },
    
    /**
     * Get usage history grouped by month
     */
    getUsageHistory(employeeName, leaveEntries, year = new Date().getFullYear()) {
        const entries = leaveEntries.filter(entry =>
            !entry.isDeleted &&
            entry.employeeName === employeeName &&
            entry.ptostApplied === true &&
            entry.leaveDate.startsWith(year.toString())
        );
        
        const byMonth = {};
        entries.forEach(entry => {
            const month = entry.leaveDate.substring(0, 7); // "2026-01"
            if (!byMonth[month]) {
                byMonth[month] = { entries: [], totalMinutes: 0 };
            }
            byMonth[month].entries.push(entry);
            byMonth[month].totalMinutes += entry.minutesMissed;
        });
        
        return {
            entries,
            totalMinutes: entries.reduce((sum, e) => sum + e.minutesMissed, 0),
            byMonth
        };
    },
    
    /**
     * Generate warning flags based on PTOST balance
     */
    generateWarningFlags(balance) {
        const flags = [];
        
        if (balance.isExhausted) {
            flags.push({
                type: 'PTOST_EXHAUSTED',
                severity: 'error',
                message: 'PTOST balance exhausted. Additional unplanned time requires pre-scheduling.',
                action: 'Consider reliability conversation with employee.'
            });
        } else if (balance.percentUsed >= 90) {
            flags.push({
                type: 'PTOST_LOW',
                severity: 'warning',
                message: `Only ${LeaveCalculationService.formatMinutesAsHours(balance.remainingMinutes)} PTOST remaining.`,
                action: 'Inform employee of low balance.'
            });
        } else if (balance.percentUsed >= 75) {
            flags.push({
                type: 'PTOST_MODERATE',
                severity: 'info',
                message: `${balance.percentUsed}% of PTOST used.`,
                action: 'Monitor usage patterns.'
            });
        }
        
        return flags;
    }
};

// ============================================
// RELIABILITY ANALYSIS SERVICE
// ============================================
const ReliabilityAnalysisService = {
    
    /**
     * Calculate reliability hours for a period
     * Reliability = Unplanned absences NOT covered by PTOST
     */
    calculateReliabilityHours(employeeName, leaveEntries, startDate, endDate) {
        const breakdown = LeaveCalculationService.getMinutesBreakdown(
            leaveEntries,
            employeeName,
            startDate,
            endDate
        );
        
        return {
            totalMissedMinutes: breakdown.totalMissed,
            plannedMinutes: breakdown.planned,
            unplannedMinutes: breakdown.unplanned,
            ptostMinutes: breakdown.ptostUsed,
            reliabilityMinutes: breakdown.reliabilityMinutes, // This is the key metric
            reliabilityHours: LeaveCalculationService.minutesToHours(breakdown.reliabilityMinutes)
        };
    },
    
    /**
     * Generate reliability flags
     */
    generateReliabilityFlags(reliabilityHours, threshold = 8) {
        const flags = [];
        
        if (reliabilityHours >= threshold * 2) {
            flags.push({
                type: 'RELIABILITY_HIGH',
                severity: 'error',
                message: `${reliabilityHours.toFixed(1)} hours of reliability detected.`,
                action: 'Immediate conversation required. Review PTOST application and attendance patterns.'
            });
        } else if (reliabilityHours >= threshold) {
            flags.push({
                type: 'RELIABILITY_MODERATE',
                severity: 'warning',
                message: `${reliabilityHours.toFixed(1)} hours of reliability detected.`,
                action: 'Consider PTOST application or attendance coaching.'
            });
        }
        
        return flags;
    },
    
    /**
     * Get entries that contribute to reliability hours (unplanned, no PTOST)
     */
    getReliabilityEntries(employeeName, leaveEntries, startDate, endDate) {
        return leaveEntries.filter(entry =>
            !entry.isDeleted &&
            entry.employeeName === employeeName &&
            entry.leaveType === 'Unplanned' &&
            entry.ptostApplied === false &&
            entry.leaveDate >= startDate &&
            entry.leaveDate <= endDate
        );
    }
};

// ============================================
// VALIDATION SERVICE
// ============================================
const ValidationService = {
    
    /**
     * Validate leave entry data
     */
    validateLeaveEntry(entry) {
        const errors = [];
        
        if (!entry.employeeName || entry.employeeName.trim() === '') {
            errors.push('Employee name is required');
        }
        
        if (!entry.leaveDate) {
            errors.push('Leave date is required');
        } else if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.leaveDate)) {
            errors.push('Leave date must be in YYYY-MM-DD format');
        }
        
        if (entry.departureTime && !/^\d{2}:\d{2}$/.test(entry.departureTime)) {
            errors.push('Departure time must be in HH:MM format');
        }
        
        if (entry.scheduledEndTime && !/^\d{2}:\d{2}$/.test(entry.scheduledEndTime)) {
            errors.push('Scheduled end time must be in HH:MM format');
        }
        
        if (!entry.leaveType || !['Planned', 'Unplanned'].includes(entry.leaveType)) {
            errors.push('Leave type must be either Planned or Unplanned');
        }
        
        if (typeof entry.minutesMissed !== 'number' || entry.minutesMissed < 0) {
            errors.push('Minutes missed must be a positive number');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    },
    
    /**
     * Validate time format
     */
    validateTimeFormat(timeStr) {
        return /^\d{2}:\d{2}$/.test(timeStr);
    },
    
    /**
     * Validate date format
     */
    validateDateFormat(dateStr) {
        return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
    }
};

// ============================================
// UTILITY FUNCTIONS
// ============================================
const ReliabilityUtils = {
    
    /**
     * Format date for display
     */
    formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr + 'T00:00:00');
        return date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
    },
    
    /**
     * Format time for display (convert 24h to 12h)
     */
    formatTime(timeStr) {
        if (!timeStr) return '';
        const [hours, minutes] = timeStr.split(':').map(Number);
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
        return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
    },
    
    /**
     * Get current date in YYYY-MM-DD format
     */
    getTodayDate() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },
    
    /**
     * Get date range for common periods
     */
    getDateRange(period) {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth();
        
        switch(period) {
            case 'week':
                const weekStart = new Date(today);
                weekStart.setDate(today.getDate() - today.getDay()); // Sunday
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6); // Saturday
                return { 
                    startDate: this.formatDateForInput(weekStart), 
                    endDate: this.formatDateForInput(weekEnd) 
                };
                
            case 'month':
                return {
                    startDate: `${year}-${String(month + 1).padStart(2, '0')}-01`,
                    endDate: `${year}-${String(month + 1).padStart(2, '0')}-${new Date(year, month + 1, 0).getDate()}`
                };
                
            case 'ytd':
                return {
                    startDate: `${year}-01-01`,
                    endDate: this.getTodayDate()
                };
                
            default:
                return { startDate: '', endDate: '' };
        }
    },
    
    /**
     * Format Date object as YYYY-MM-DD
     */
    formatDateForInput(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },
    
    /**
     * Generate unique ID
     */
    generateId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
};
