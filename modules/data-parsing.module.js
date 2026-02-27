/* ========================================
   DATA PARSING MODULE
   Handles all data validation and parsing
   ======================================== */

(function() {
    'use strict';

    // ============================================
    // CONSTANTS
    // ============================================

    const POWERBI_COLUMNS = [
        'Name (Last, First)',
        'TotalCallsAnswered',
        'Transfers%',
        'Number of Transfers',
        'AHT',
        'Talk',
        'Hold',
        'ACW',
        'Adherence%',
        'ManageEmotionsScore%',
        'AvoidNegativeWordScore%',
        'PositiveWordScore%',
        'OverallSentimentScore%',
        'FCR%',
        'OverallFCRTotal',
        'RepSat%',
        'OverallRepTotal',
        'OverallExperience%',
        'OE Survey Total',
        'TotalIn-OfficeShrink%',
        'TotalOOOShrink%',
        'TotalShrinkage%',
        'ReliabilityHours'
    ];

    const CANONICAL_SCHEMA = {
        EMPLOYEE_NAME: 'employee_name',
        ADHERENCE_PERCENT: 'adherence_percent',
        CX_REP_OVERALL: 'cx_rep_overall_percent',
        FCR_PERCENT: 'first_call_resolution_percent',
        OVERALL_EXPERIENCE: 'overall_experience_percent',
        TRANSFERS_PERCENT: 'transfer_percent',
        TRANSFERS_COUNT: 'transfer_count',
        AHT_SECONDS: 'average_handle_time_seconds',
        TALK_SECONDS: 'talk_time_seconds',
        ACW_SECONDS: 'after_call_work_seconds',
        HOLD_SECONDS: 'hold_time_seconds',
        RELIABILITY_HOURS: 'reliability_hours',
        SENTIMENT_PERCENT: 'overall_sentiment_percent',
        POSITIVE_WORD_PERCENT: 'positive_word_percent',
        NEGATIVE_WORD_PERCENT: 'avoid_negative_word_percent',
        EMOTIONS_PERCENT: 'manage_emotions_percent',
        SURVEY_TOTAL: 'survey_total',
        TOTAL_CALLS: 'total_calls_answered'
    };

    const COLUMN_MAPPING = {
        0: CANONICAL_SCHEMA.EMPLOYEE_NAME,
        1: CANONICAL_SCHEMA.TOTAL_CALLS,
        2: CANONICAL_SCHEMA.TRANSFERS_PERCENT,
        3: CANONICAL_SCHEMA.TRANSFERS_COUNT,
        4: CANONICAL_SCHEMA.AHT_SECONDS,
        5: CANONICAL_SCHEMA.TALK_SECONDS,
        6: CANONICAL_SCHEMA.HOLD_SECONDS,
        7: CANONICAL_SCHEMA.ACW_SECONDS,
        8: CANONICAL_SCHEMA.ADHERENCE_PERCENT,
        9: CANONICAL_SCHEMA.EMOTIONS_PERCENT,
        10: CANONICAL_SCHEMA.NEGATIVE_WORD_PERCENT,
        11: CANONICAL_SCHEMA.POSITIVE_WORD_PERCENT,
        12: CANONICAL_SCHEMA.SENTIMENT_PERCENT,
        13: CANONICAL_SCHEMA.FCR_PERCENT,
        14: CANONICAL_SCHEMA.CX_REP_OVERALL,
        15: CANONICAL_SCHEMA.CX_REP_OVERALL,
        16: CANONICAL_SCHEMA.CX_REP_OVERALL,
        17: CANONICAL_SCHEMA.OVERALL_EXPERIENCE,
        18: CANONICAL_SCHEMA.SURVEY_TOTAL,
        19: 'TotalIn-OfficeShrink%',
        20: 'TotalOOOShrink%',
        21: 'TotalShrinkage%',
        22: CANONICAL_SCHEMA.RELIABILITY_HOURS
    };

    // ============================================
    // PARSING FUNCTIONS
    // ============================================

    function parsePowerBIRow(row) {
        row = row.replace(/\u00A0/g, ' ').trim();
        row = row.replace(/(\d+(?:\.\d+)?)\s+%/g, '$1%');
        
        const match = row.match(/^(.+?)\s+(?=(\(?\d|N\/A|\(Blank\)))/);
        
        if (!match) {
            throw new Error(`Row does not match expected format: "${row.substring(0, 50)}..."`);
        }
        
        const name = match[1].trim();
        const rest = row.slice(match[0].length).trim();
        
        let metrics = rest.split(/\s+/);
        
        metrics = metrics.map(val => {
            if (val === '(Blank)' || val === 'N/A') return null;
            val = val.replace(/,/g, '');
            if (val.endsWith('%')) return parseFloat(val);
            if (!isNaN(val) && val !== '') return Number(val);
            return val;
        });
        
        return [name, ...metrics];
    }

    function parsePercentage(value) {
        if (!value && value !== 0) return 0;
        if (value === 'N/A' || value === 'n/a' || value === '') return 0;
        
        if (typeof value === 'string') {
            value = value.replace('%', '').trim();
        }
        
        const parsed = parseFloat(value);
        if (isNaN(parsed)) return 0;
        
        if (parsed > 0 && parsed < 1) {
            return parseFloat((parsed * 100).toFixed(2));
        }
        
        if (parsed >= 1 && parsed <= 100) {
            return parseFloat(parsed.toFixed(2));
        }
        
        if (parsed > 100) {
            return 0;
        }
        
        return parseFloat(parsed.toFixed(2));
    }

    function parseSurveyPercentage(value) {
        if (!value && value !== 0) return '';
        if (value === 'N/A' || value === 'n/a' || value === '') return '';
        
        if (typeof value === 'string') {
            value = value.replace('%', '').trim();
        }
        
        const parsed = parseFloat(value);
        if (isNaN(parsed)) return '';
        
        if (parsed > 0 && parsed < 1) {
            return parseFloat((parsed * 100).toFixed(2));
        }
        
        if (parsed >= 1 && parsed <= 100) {
            return parseFloat(parsed.toFixed(2));
        }
        
        if (parsed > 100) {
            return '';
        }
        
        return parseFloat(parsed.toFixed(2));
    }

    function parseSeconds(value) {
        if (value === '' || value === null || value === undefined) return '';
        const parsed = parseFloat(value);
        if (isNaN(parsed)) return '';
        return Math.round(parsed);
    }

    function parseHours(value) {
        if (!value && value !== 0) return 0;
        const parsed = parseFloat(value);
        if (isNaN(parsed)) return 0;
        return parseFloat(parsed.toFixed(2));
    }

    // ============================================
    // DATA VALIDATION
    // ============================================

    function validatePastedData(dataText) {
        const lines = dataText.trim().split('\n');
        const issues = [];
        
        if (lines.length < 2) {
            issues.push('Data must have at least a header row and one data row');
            return { valid: false, issues, preview: null };
        }
        
        const headers = lines[0].split('\t');
        
        const normalize = (str) => str.toLowerCase().replace(/[\s\-_]+/g, '|');
        const hasNameColumn = headers.some(h => {
            const normalizedHeader = normalize(h);
            return normalizedHeader.includes('name');
        });
        const hasAdherenceColumn = headers.some(h => normalize(h).includes('adherence') || normalize(h).includes('schedule'));
        
        if (!hasNameColumn) {
            issues.push('Missing required column: Name');
        }
        if (!hasAdherenceColumn) {
            issues.push('Missing required column: Adherence or Schedule');
        }
        
        const dataRows = lines.slice(1).filter(line => line.trim());
        const employeeCount = dataRows.length;
        
        if (employeeCount === 0) {
            issues.push('No employee data found');
        }
        
        const preview = dataRows.slice(0, 3).map(row => {
            const cols = row.split('\t');
            return cols[0] || 'Unknown';
        });
        
        return {
            valid: issues.length === 0,
            issues,
            employeeCount,
            preview,
            headers
        };
    }

    // ============================================
    // MAIN DATA PARSING
    // ============================================

    function parsePastedData(pastedText, startDate, endDate) {
        const lines = pastedText.split('\n').map(line => line.trim()).filter(line => line);
        
        if (lines.length < 2) {
            throw new Error('Data appears incomplete. Please paste header row and data rows.');
        }
        
        const headerLine = lines[0];
        const hasNameHeader = headerLine.toLowerCase().includes('name');
        
        if (!hasNameHeader) {
            throw new Error('ℹ️ Header row not found! Make sure to include the header row at the top of your pasted data.');
        }
        
        const headers = headerLine.split('\t').map(h => h.toLowerCase());
        
        const findColumnIndex = (keywords) => {
            const matchesKeyword = (header, keyword) => {
                const hLower = header.toLowerCase();
                const kLower = keyword.toLowerCase();
                
                if (hLower === kLower) return true;
                
                const normalize = (str) => str.replace(/[\s\-_]+/g, '|').replace(/[^a-z0-9|]/g, '');
                const normalizedHeader = normalize(hLower);
                const normalizedKeyword = normalize(kLower);
                
                if (normalizedHeader.includes(normalizedKeyword)) return true;
                
                const keywordWords = kLower.split(/[\s\-_]+/).filter(w => w.length > 0);
                let searchPos = 0;
                for (const word of keywordWords) {
                    const foundPos = hLower.indexOf(word, searchPos);
                    if (foundPos === -1) return false;
                    searchPos = foundPos + word.length;
                }
                return true;
            };
            
            if (Array.isArray(keywords)) {
                return headers.findIndex(h => keywords.some(k => matchesKeyword(h, k)));
            }
            return headers.findIndex(h => matchesKeyword(h, keywords));
        };
        
        const colMap = {
            name: findColumnIndex('name'),
            totalCalls: findColumnIndex(['totalcalls', 'answered', 'total calls answered', 'calls answered']),
            transfers: findColumnIndex(['transfers', 'transfer %']),
            transfersCount: findColumnIndex(['number of transfers']),
            aht: findColumnIndex(['aht', 'average handle']),
            talkTime: findColumnIndex(['talk']),
            holdTime: findColumnIndex(['hold']),
            acw: findColumnIndex(['acw', 'after call']),
            adherence: findColumnIndex(['adherence', 'schedule']),
            emotions: findColumnIndex(['managing emotions', 'emotion']),
            negativeWord: findColumnIndex(['avoid negative', 'negative word']),
            positiveWord: findColumnIndex(['positive word']),
            sentiment: findColumnIndex(['overall sentiment']),
            fcr: findColumnIndex(['fcr', 'first call resolution']),
            cxRepOverall: findColumnIndex(['rep satisfaction', 'rep sat', 'repsat']),
            overallExperience: findColumnIndex(['overall experience', 'overallexperience', 'oe top2', 'oe top 2', 'top2']),
            overallExperienceTop3: findColumnIndex(['oe top3', 'oe top 3', 'overall experience top3', 'overall experience top 3']),
            surveyTotal: findColumnIndex(['oe survey', 'survey total']),
            reliability: findColumnIndex(['reliability', 'reliability hours'])
        };
        
        const getCell = (cells, colIndex) => {
            if (colIndex < 0) return '';
            const value = cells[colIndex];
            return (value === null || value === undefined) ? '' : value;
        };
        
        const employees = [];
        
        for (let i = 1; i < lines.length; i++) {
            const rawRow = lines[i];
            
            if (!rawRow.trim()) continue;
            
            let cells;
            try {
                const parsed = parsePowerBIRow(rawRow);
                cells = parsed;
            } catch (error) {
                continue;
            }
            
            const nameField = getCell(cells, colMap.name);
            let firstName = '', lastName = '';
            
            const lastFirstMatch = nameField.match(/^([^,]+),\s*(.+)$/);
            if (lastFirstMatch) {
                lastName = lastFirstMatch[1].trim();
                firstName = lastFirstMatch[2].trim();
            } else {
                const parts = nameField.trim().split(/\s+/);
                if (parts.length >= 2) {
                    firstName = parts[0];
                    lastName = parts.slice(1).join(' ');
                } else if (parts.length === 1) {
                    firstName = parts[0];
                }
            }
            
            const displayName = `${firstName} ${lastName}`.trim();
            
            const totalCallsRaw = getCell(cells, colMap.totalCalls);
            const parsedTotalCalls = parseInt(totalCallsRaw, 10);
            const surveyTotalRaw = getCell(cells, colMap.surveyTotal);
            const surveyTotal = Number.isInteger(parseInt(surveyTotalRaw, 10)) ? parseInt(surveyTotalRaw, 10) : 0;
            const totalCalls = Number.isInteger(parsedTotalCalls)
                ? parsedTotalCalls
                : (surveyTotal > 0 ? surveyTotal : 0);
            
            const employeeData = {
                name: displayName,
                firstName: firstName,
                scheduleAdherence: parsePercentage(getCell(cells, colMap.adherence)) || 0,
                cxRepOverall: parseSurveyPercentage(getCell(cells, colMap.cxRepOverall)),
                fcr: parseSurveyPercentage(getCell(cells, colMap.fcr)),
                overallExperience: parseSurveyPercentage(getCell(cells, colMap.overallExperience)),
                overallExperienceTop3: parseSurveyPercentage(getCell(cells, colMap.overallExperienceTop3)),
                transfers: parsePercentage(getCell(cells, colMap.transfers)) || 0,
                transfersCount: parseInt(getCell(cells, colMap.transfersCount)) || 0,
                aht: parseSeconds(getCell(cells, colMap.aht)) || '',
                talkTime: parseSeconds(getCell(cells, colMap.talkTime)) || '',
                acw: parseSeconds(getCell(cells, colMap.acw)),
                holdTime: parseSeconds(getCell(cells, colMap.holdTime)),
                reliability: parseHours(getCell(cells, colMap.reliability)) || 0,
                overallSentiment: parsePercentage(getCell(cells, colMap.sentiment)) || '',
                positiveWord: parsePercentage(getCell(cells, colMap.positiveWord)) || '',
                negativeWord: parsePercentage(getCell(cells, colMap.negativeWord)) || '',
                managingEmotions: parsePercentage(getCell(cells, colMap.emotions)) || '',
                surveyTotal: surveyTotal,
                totalCalls: totalCalls
            };
            
            if (employeeData.surveyTotal > employeeData.totalCalls && employeeData.totalCalls > 0) {
                console.warn(`⚠️ DATA INTEGRITY WARNING: ${displayName}: surveyTotal (${employeeData.surveyTotal}) > totalCalls (${employeeData.totalCalls}).`);
            }
            
            employees.push(employeeData);
        }
        
        return employees;
    }

    // ============================================
    // MODULE EXPORT
    // ============================================

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.dataParsing = {
        parsePowerBIRow,
        parsePercentage,
        parseSurveyPercentage,
        parseSeconds,
        parseHours,
        validatePastedData,
        parsePastedData,
        // Constants
        POWERBI_COLUMNS,
        CANONICAL_SCHEMA,
        COLUMN_MAPPING
    };
})();
