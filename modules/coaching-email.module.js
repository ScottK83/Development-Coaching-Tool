(function () {
    'use strict';

    // ---------------------------------------------------------------------------
    // Coaching Email UI Module
    // Extracts all coaching-email UI logic from script.js into a standalone IIFE.
    // Globals are accessed through window; sibling modules via DevCoachModules.
    // ---------------------------------------------------------------------------

    // -- History management (delete / clear) ------------------------------------

    function deleteLatestCoachingEntry() {
        const employeeName = document.getElementById('coachingEmployeeSelect')?.value;
        if (!employeeName) {
            showToast('Select an associate first', 3000);
            return;
        }

        const history = coachingHistory[employeeName] || [];
        if (!history.length) {
            showToast('No coaching history to delete', 3000);
            return;
        }

        const confirmed = confirm(`Delete the latest coaching entry for ${employeeName}?`);
        if (!confirmed) return;

        coachingHistory[employeeName] = history.slice(1);
        saveCoachingHistory();
        renderCoachingHistory(employeeName);
        showToast('✅ Latest coaching entry deleted', 3000);
    }

    function clearCoachingHistoryForEmployee() {
        const employeeName = document.getElementById('coachingEmployeeSelect')?.value;
        if (!employeeName) {
            showToast('Select an associate first', 3000);
            return;
        }

        const confirmed = confirm(`Clear ALL coaching history for ${employeeName}? This cannot be undone.`);
        if (!confirmed) return;

        coachingHistory[employeeName] = [];
        saveCoachingHistory();
        renderCoachingHistory(employeeName);
        showToast('✅ Coaching history cleared', 3000);
    }

    // -- Display element helpers -----------------------------------------------

    function getCoachingEmailDisplayElements() {
        return {
            panel: document.getElementById('coachingMetricsPanel'),
            summary: document.getElementById('coachingMetricsSummary'),
            winsList: document.getElementById('coachingWinsList'),
            oppList: document.getElementById('coachingOpportunitiesList'),
            promptArea: document.getElementById('coachingPromptArea'),
            outlookSection: document.getElementById('coachingOutlookSection'),
            outlookBody: document.getElementById('coachingOutlookBody'),
            outlookBtn: document.getElementById('generateOutlookEmailBtn')
        };
    }

    function resetCoachingEmailDisplayState(elements) {
        elements.winsList.innerHTML = '';
        elements.oppList.innerHTML = '';
        elements.promptArea.value = '';

        if (elements.outlookSection && elements.outlookBody && elements.outlookBtn) {
            elements.outlookSection.style.display = 'none';
            elements.outlookBody.value = '';
            elements.outlookBtn.disabled = true;
            elements.outlookBtn.style.opacity = '0.6';
            elements.outlookBtn.style.cursor = 'not-allowed';
        }
    }

    // -- Employee / metric data resolution -------------------------------------

    function resolveCoachingEmployeeRecord(employeeName) {
        if (!employeeName || !coachingLatestWeekKey) return null;
        return weeklyData[coachingLatestWeekKey]?.employees?.find(emp => emp.name === employeeName) || null;
    }

    function buildCoachingDisplayMetricData(employeeRecord) {
        const wins = [];
        const opportunities = [];
        const metricKeys = getMetricOrder().map(m => m.key);

        metricKeys.forEach(key => {
            const metricConfig = METRICS_REGISTRY[key];
            const value = employeeRecord[key];
            if (!metricConfig || value === null || value === undefined || value === '' || value === 'N/A') return;

            const numValue = parseFloat(value);
            if (isNaN(numValue)) return;

            const target = metricConfig.target?.value;
            if (target === undefined || target === null) return;

            const meetsTarget = isMetricMeetingTarget(key, numValue, target);
            const entry = {
                key,
                label: metricConfig.label,
                value: formatMetricDisplay(key, numValue),
                target: formatMetricDisplay(key, target)
            };

            if (meetsTarget) {
                wins.push(entry);
            } else {
                opportunities.push(entry);
            }
        });

        return { wins, opportunities };
    }

    function resolveCoachingDisplayEndDate() {
        const period = weeklyData[coachingLatestWeekKey];
        const metadataEndDate = period?.metadata?.endDate;
        if (metadataEndDate) {
            return formatDateMMDDYYYY(metadataEndDate);
        }

        const keyEndDate = coachingLatestWeekKey.split('|')[1];
        return keyEndDate ? formatDateMMDDYYYY(keyEndDate) : coachingLatestWeekKey;
    }

    // -- Metric list rendering -------------------------------------------------

    function renderCoachingMetricLists(winsList, oppList, wins, opportunities) {
        winsList.innerHTML = wins.length
            ? wins.map(w => `<li>${w.label}: ${w.value} vs target ${w.target}</li>`).join('')
            : '<li>No metrics meeting goal in the latest period.</li>';

        oppList.innerHTML = opportunities.length
            ? opportunities.map(o => `<li>${o.label}: ${o.value} vs target ${o.target}</li>`).join('')
            : '<li>No focus areas below target in the latest period.</li>';
    }

    // -- Main display update ---------------------------------------------------

    function updateCoachingEmailDisplay() {
        const employeeName = document.getElementById('coachingEmployeeSelect')?.value;
        const elements = getCoachingEmailDisplayElements();

        if (!elements.panel || !elements.summary || !elements.winsList || !elements.oppList || !elements.promptArea) return;

        resetCoachingEmailDisplayState(elements);

        const employeeRecord = resolveCoachingEmployeeRecord(employeeName);
        if (!employeeRecord) {
            elements.panel.style.display = 'none';
            renderCoachingHistory(employeeName);
            return;
        }

        const { wins, opportunities } = buildCoachingDisplayMetricData(employeeRecord);
        const endDate = resolveCoachingDisplayEndDate();

        elements.summary.textContent = `Week of ${endDate} \u2022 ${wins.length} wins \u2022 ${opportunities.length} focus areas`;
        renderCoachingMetricLists(elements.winsList, elements.oppList, wins, opportunities);

        elements.panel.style.display = 'block';
        renderCoachingHistory(employeeName);
    }

    // -- Coaching history panel ------------------------------------------------

    function getCoachingHistoryElements() {
        return {
            panel: document.getElementById('coachingHistoryPanel'),
            summary: document.getElementById('coachingHistorySummary'),
            list: document.getElementById('coachingHistoryList')
        };
    }

    function setCoachingHistoryEmptyState(summary, list, panel, summaryText) {
        summary.textContent = summaryText;
        list.innerHTML = '';
        panel.style.display = 'block';
    }

    function renderCoachingHistory(employeeName) {
        const { panel, summary, list } = getCoachingHistoryElements();

        if (!panel || !summary || !list) return;

        const delegated = window.DevCoachModules?.coaching?.renderHistoryView;
        if (typeof delegated === 'function') {
            delegated({
                panel,
                summary,
                list,
                employeeName,
                history: resolveCoachingHistoryForEmployee(employeeName),
                formatDate: formatDateMMDDYYYY,
                metricsRegistry: METRICS_REGISTRY
            });
            return;
        }

        setCoachingHistoryEmptyState(summary, list, panel, 'Coaching module unavailable. Refresh and try again.');
    }

    // -- Coaching tip selection ------------------------------------------------

    function chooseCoachingTip(metricConfig, usedTips) {
        const tips = getMetricTips(metricConfig.label);
        let selectedTip = metricConfig.defaultTip;
        if (tips && tips.length > 0) {
            const available = tips.filter(t => !usedTips.has(t));
            selectedTip = (available.length > 0
                ? available[Math.floor(Math.random() * available.length)]
                : tips[Math.floor(Math.random() * tips.length)]);
        }
        usedTips.add(selectedTip);
        return selectedTip;
    }

    // -- Prompt metric data collection -----------------------------------------

    function collectCoachingPromptMetricData(employeeRecord) {
        const wins = [];
        const opportunities = [];
        const usedTips = new Set();

        getMetricOrder().map(m => m.key).forEach(key => {
            const metricConfig = METRICS_REGISTRY[key];
            const value = employeeRecord[key];
            if (!metricConfig || value === null || value === undefined || value === '' || value === 'N/A') return;

            const numValue = parseFloat(value);
            if (isNaN(numValue)) return;

            const target = metricConfig.target?.value;
            if (target === undefined || target === null) return;

            const meetsTarget = isMetricMeetingTarget(key, numValue, target);
            const displayValue = formatMetricDisplay(key, numValue);
            const displayTarget = formatMetricDisplay(key, target);

            if (meetsTarget) {
                wins.push({ label: metricConfig.label, value: displayValue, target: displayTarget });
                return;
            }

            opportunities.push({
                label: metricConfig.label,
                value: displayValue,
                target: displayTarget,
                tip: chooseCoachingTip(metricConfig, usedTips)
            });
        });

        return { wins, opportunities };
    }

    // -- Prompt period resolution ----------------------------------------------

    function resolveCoachingPromptPeriodEndDate() {
        const weeklyMeta = weeklyData[coachingLatestWeekKey]?.metadata;
        if (weeklyMeta?.endDate) {
            return formatDateMMDDYYYY(weeklyMeta.endDate);
        }
        return coachingLatestWeekKey.split('|')[1]
            ? formatDateMMDDYYYY(coachingLatestWeekKey.split('|')[1])
            : coachingLatestWeekKey;
    }

    // -- Prompt section builders -----------------------------------------------

    function buildCoachingPromptMetricsText(wins, opportunities) {
        const winsText = wins.length
            ? wins.map(w => `- ${w.label}: ${w.value} vs target ${w.target}`).join('\n')
            : '- No metrics meeting goal in this period.';

        const oppText = opportunities.length
            ? opportunities.map(o => `- ${o.label}: ${o.value} vs target ${o.target}\n  Coaching tip: ${o.tip}`).join('\n')
            : '- No metrics below target in this period.';

        return { winsText, oppText };
    }

    function buildCoachingPromptRoleSection(employeeName) {
        return `ROLE

You are a real contact center supervisor writing a weekly coaching check-in email for ${employeeName}.
This should sound like it is coming directly from their supervisor \u2014 warm, human, supportive, and invested in their success.
This is a recurring weekly email.
Assume you have written to this associate before.
Vary wording and structure naturally like a human would.`;
    }

    function buildCoachingPromptVoiceToneSection() {
        return `VOICE & TONE (CRITICAL)

- Warm and empathetic
- Friendly and conversational
- Confident and assured
- Encouraging and forward-looking
- Clear and direct expectations
- Supportive and invested in success
- Authentic supervisor-to-associate connection
- Cheerleading first, coaching second`;
    }

    function buildCoachingPromptRulesSection() {
        return `HARD WRITING RULES

- Do NOT number sections
- Do NOT label sections (no "Key Wins," "Opportunities," etc.)
- Do NOT sound like a report or checklist
- Do NOT use robotic or instructional language
- Do NOT repeat phrasing across bullets
- Do NOT use HR clich\u00e9s or jargon
- Do NOT use the phrase "This is an opportunity to"
- Do NOT use em dashes (\u2014)
- Write in natural paragraphs with clean, simple bullet points where appropriate`;
    }

    function buildCoachingPromptFlowSection(preferredName) {
        return `EMAIL FLOW (INTERNAL \u2013 DO NOT SHOW)

Opening:
- Start by greeting ${preferredName} by name
- Lead with confidence and appreciation
- Set a positive, supportive tone

Celebrate Wins:
- Call out strong metrics first with current performance and target
- Explain briefly why those wins matter
- Use bullets where helpful, but keep them clean and natural

Coaching:
- Discuss only metrics below target
- Include current performance and target for each metric
- Pull exactly ONE relevant coaching tip per metric
- Rewrite the tip naturally in your own words
- Make guidance actionable but conversational
- Frame as refinement and focus, not correction

Expectations:
- Clearly state that improvement is expected where metrics are off
- Balance accountability with belief in the associate
- Emphasize progress, consistency, and confidence

Close:
- End on encouragement and confidence
- Reinforce momentum and support
- Tie focus areas to growth and future readiness`;
    }

    function buildCoachingPromptOutputRequirementsSection(preferredName) {
        return `OUTPUT REQUIREMENTS

- Address ${preferredName} by name in the opening
- Use clean bullets for metrics (wins and opportunities)
- Show current performance vs target in each bullet
- Pull exactly ONE tip per opportunity metric
- Rewrite tips in natural language\u2014never copy verbatim
- Sound like a real supervisor: natural, human, and supportive
- No numbered sections or labels`;
    }

    function buildCoachingPromptDataSection(endDate, winsText, oppText) {
        return `DATA FOR THIS EMAIL

Week of ${endDate}

Strengths:
${winsText}

Focus Areas:
${oppText}`;
    }

    function buildCoachingPromptDataRulesSection() {
        return `DATA RULES

- Only reference metrics and data provided above
- Do not invent feedback or metrics
- Do not assume external factors
- Every tip must relate directly to the data provided`;
    }

    function buildCoachingPromptFinalInstructionSection(preferredName) {
        return `FINAL INSTRUCTION

Generate the coaching email for ${preferredName} now.`;
    }

    // -- Full prompt assembly --------------------------------------------------

    function buildCoachingPrompt(employeeRecord) {
        const { wins, opportunities } = collectCoachingPromptMetricData(employeeRecord);
        const endDate = resolveCoachingPromptPeriodEndDate();

        const preferredName = getEmployeeNickname(employeeRecord.name);
        const { winsText, oppText } = buildCoachingPromptMetricsText(wins, opportunities);

        return [
            buildCoachingPromptRoleSection(employeeRecord.name),
            buildCoachingPromptVoiceToneSection(),
            buildCoachingPromptRulesSection(),
            buildCoachingPromptFlowSection(preferredName),
            buildCoachingPromptOutputRequirementsSection(preferredName),
            buildCoachingPromptDataSection(endDate, winsText, oppText),
            buildCoachingPromptDataRulesSection(),
            buildCoachingPromptFinalInstructionSection(preferredName)
        ].join('\n\n');
    }

    // -- Prompt generation inputs & employee resolution ------------------------

    function getCoachingPromptGenerationInputs() {
        return {
            employeeName: document.getElementById('coachingEmployeeSelect')?.value,
            promptArea: document.getElementById('coachingPromptArea'),
            button: document.getElementById('generateCoachingPromptBtn')
        };
    }

    function resolveCoachingPromptEmployeeRecord(employeeName) {
        if (!employeeName || !coachingLatestWeekKey) return null;
        return weeklyData[coachingLatestWeekKey]?.employees?.find(emp => emp.name === employeeName) || null;
    }

    // -- Latest coaching summary data ------------------------------------------

    function buildLatestCoachingSummaryData(employeeRecord) {
        const periodMeta = weeklyData[coachingLatestWeekKey]?.metadata || {};
        const weekEnding = periodMeta.endDate || (coachingLatestWeekKey.split('|')[1] || '');
        const periodLabel = periodMeta.label || (weekEnding ? `Week ending ${formatDateMMDDYYYY(weekEnding)}` : 'this period');
        const preferredName = getEmployeeNickname(employeeRecord.name) || employeeRecord.firstName || employeeRecord.name;
        const reliabilityHours = (() => {
            const parsed = parseFloat(employeeRecord.reliability);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        })();
        const { celebrate, needsCoaching, coachedMetricKeys } = evaluateMetricsForCoaching(employeeRecord);

        return {
            weekEnding,
            summaryData: {
                firstName: preferredName,
                periodLabel,
                celebrate,
                needsCoaching,
                reliabilityHours,
                customNotes: '',
                timeReference: 'this week'
            },
            coachedMetricKeys
        };
    }

    // -- Recording & rendering coaching events ---------------------------------

    function recordAndRenderCoachingEvent(employeeName, weekEnding, coachedMetricKeys) {
        recordCoachingEvent({
            employeeId: employeeName,
            weekEnding: weekEnding || 'this period',
            metricsCoached: coachedMetricKeys,
            aiAssisted: true
        });
        renderCoachingHistory(employeeName);
    }

    // -- UI feedback helpers ---------------------------------------------------

    function showCoachingPromptCopiedState(button) {
        if (!button) return;
        const originalText = button.textContent;
        button.textContent = '\u2705 Copied to CoPilot';
        setTimeout(() => {
            button.textContent = originalText;
        }, 1200);
    }

    function revealCoachingOutlookSection() {
        const outlookSection = document.getElementById('coachingOutlookSection');
        if (!outlookSection) return;
        outlookSection.style.display = 'block';
        outlookSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function openCopilotForCoachingPrompt() {
        setTimeout(() => {
            window.open('https://copilot.microsoft.com', '_blank');
        }, 500);
    }

    // -- Main generate-and-copy flow -------------------------------------------

    function generateCoachingPromptAndCopy() {
        const { employeeName, promptArea, button } = getCoachingPromptGenerationInputs();

        if (!employeeName) {
            alert('\u26a0\ufe0f Please select an associate first.');
            return;
        }

        const employeeRecord = resolveCoachingPromptEmployeeRecord(employeeName);
        if (!employeeRecord) {
            alert('\u26a0\ufe0f No data found for that associate in the latest period.');
            return;
        }

        const prompt = buildCoachingPrompt(employeeRecord);
        promptArea.value = prompt;

        const { weekEnding, summaryData, coachedMetricKeys } = buildLatestCoachingSummaryData(employeeRecord);
        window.latestCoachingSummaryData = summaryData;

        recordAndRenderCoachingEvent(employeeName, weekEnding || summaryData.periodLabel, coachedMetricKeys);
        navigator.clipboard.writeText(promptArea.value).catch(() => {
            promptArea.select();
        });

        showCoachingPromptCopiedState(button);
        revealCoachingOutlookSection();
        openCopilotForCoachingPrompt();
    }

    // -- Outlook generation ----------------------------------------------------

    function getCoachingOutlookGenerationInputs() {
        const outlookBody = document.getElementById('coachingOutlookBody');
        return {
            outlookBody,
            selectedEmployee: document.getElementById('coachingEmployeeSelect')?.value,
            bodyText: (outlookBody?.value || '').trim()
        };
    }

    function generateOutlookEmailFromCoPilot() {
        const { bodyText, selectedEmployee } = getCoachingOutlookGenerationInputs();

        const delegated = window.DevCoachModules?.coaching?.generateOutlookDraftFromCopilot;
        if (typeof delegated === 'function') {
            delegated({
                bodyText,
                selectedEmployee,
                periodMeta: weeklyData[coachingLatestWeekKey]?.metadata || {},
                periodKey: coachingLatestWeekKey,
                getEmployeeNickname,
                formatDate: formatDateMMDDYYYY,
                showToast,
                onError: (error) => {
                    console.error('Error opening Outlook draft from coaching email:', error);
                }
            });
            return;
        }

        showToast('\u26a0\ufe0f Coaching module is unavailable. Refresh and try again.', 3500);
    }

    // -- Initialization helpers ------------------------------------------------

    function getLatestWeekKeyForCoaching() {
        const weekKeys = Object.keys(weeklyData || {});
        if (weekKeys.length === 0) return null;

        const getEndDate = (weekKey) => {
            const metaEnd = weeklyData[weekKey]?.metadata?.endDate;
            if (metaEnd) return new Date(metaEnd);
            const parts = weekKey.split('|');
            const endDate = parts[1] || parts[0];
            return new Date(endDate);
        };

        return weekKeys.reduce((latest, key) => {
            if (!latest) return key;
            return getEndDate(key) > getEndDate(latest) ? key : latest;
        }, null);
    }

    function resetCoachingEmailUiState(select, status, panel, promptArea, outlookSection, outlookBody, outlookBtn) {
        status.style.display = 'none';
        panel.style.display = 'none';
        promptArea.value = '';

        if (outlookSection && outlookBody && outlookBtn) {
            outlookSection.style.display = 'none';
            outlookBody.value = '';
            outlookBtn.disabled = true;
            outlookBtn.style.opacity = '0.6';
            outlookBtn.style.cursor = 'not-allowed';
        }

        select.innerHTML = '<option value="">-- Choose an associate --</option>';
    }

    function populateCoachingEmployeeSelectOptions(select, employees) {
        employees.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });
    }

    function getCoachingLatestPeriodEmployees(coachingWeekKey) {
        const latestWeek = weeklyData[coachingWeekKey];
        const teamFilterContext = getTeamSelectionContext();
        const employees = (latestWeek.employees || [])
            .filter(emp => emp && emp.name)
            .filter(emp => isAssociateIncludedByTeamFilter(emp.name, teamFilterContext))
            .map(emp => emp.name)
            .sort();

        return { latestWeek, employees };
    }

    function setCoachingLatestPeriodStatus(status, coachingWeekKey, latestWeek) {
        const endDate = latestWeek?.metadata?.endDate
            ? formatDateMMDDYYYY(latestWeek.metadata.endDate)
            : (coachingWeekKey.split('|')[1] ? formatDateMMDDYYYY(coachingWeekKey.split('|')[1]) : coachingWeekKey);
        status.textContent = `Using latest period: Week of ${endDate}`;
        status.style.display = 'block';
    }

    function bindCoachingOutlookInputState(outlookBody, outlookBtn) {
        if (!outlookBody || !outlookBtn) return;
        bindElementOnce(outlookBody, 'input', (e) => {
            const hasContent = e.target.value.trim().length > 0;
            outlookBtn.disabled = !hasContent;
            outlookBtn.style.opacity = hasContent ? '1' : '0.6';
            outlookBtn.style.cursor = hasContent ? 'pointer' : 'not-allowed';
        });
    }

    function bindCoachingEmailActionHandlers(select, generateBtn, outlookBtn) {
        const deleteLatestBtn = document.getElementById('deleteLatestCoachingBtn');
        const clearHistoryBtn = document.getElementById('clearCoachingHistoryBtn');

        bindElementOnce(select, 'change', updateCoachingEmailDisplay);
        bindElementOnce(generateBtn, 'click', generateCoachingPromptAndCopy);
        bindElementOnce(deleteLatestBtn, 'click', deleteLatestCoachingEntry);
        bindElementOnce(clearHistoryBtn, 'click', clearCoachingHistoryForEmployee);
        bindElementOnce(outlookBtn, 'click', generateOutlookEmailFromCoPilot);
    }

    function initializeCoachingEmail() {
        const select = document.getElementById('coachingEmployeeSelect');
        const status = document.getElementById('coachingEmailStatus');
        const panel = document.getElementById('coachingMetricsPanel');
        const promptArea = document.getElementById('coachingPromptArea');
        const generateBtn = document.getElementById('generateCoachingPromptBtn');
        const outlookSection = document.getElementById('coachingOutlookSection');
        const outlookBody = document.getElementById('coachingOutlookBody');
        const outlookBtn = document.getElementById('generateOutlookEmailBtn');

        if (!select || !status || !panel || !promptArea || !generateBtn) return;

        resetCoachingEmailUiState(select, status, panel, promptArea, outlookSection, outlookBody, outlookBtn);

        if (!weeklyData || Object.keys(weeklyData).length === 0) {
            status.textContent = 'No data available. Upload data first to generate coaching emails.';
            status.style.display = 'block';
            return;
        }

        coachingLatestWeekKey = getLatestWeekKeyForCoaching();
        if (!coachingLatestWeekKey || !weeklyData[coachingLatestWeekKey]) {
            status.textContent = 'Unable to find the latest data period.';
            status.style.display = 'block';
            return;
        }

        const { latestWeek, employees } = getCoachingLatestPeriodEmployees(coachingLatestWeekKey);
        populateCoachingEmployeeSelectOptions(select, employees);
        setCoachingLatestPeriodStatus(status, coachingLatestWeekKey, latestWeek);
        bindCoachingOutlookInputState(outlookBody, outlookBtn);
        bindCoachingEmailActionHandlers(select, generateBtn, outlookBtn);
    }

    // -- Export via DevCoachModules --------------------------------------------

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.coachingEmail = {
        deleteLatestCoachingEntry,
        clearCoachingHistoryForEmployee,
        getCoachingEmailDisplayElements,
        resetCoachingEmailDisplayState,
        resolveCoachingEmployeeRecord,
        buildCoachingDisplayMetricData,
        resolveCoachingDisplayEndDate,
        renderCoachingMetricLists,
        updateCoachingEmailDisplay,
        getCoachingHistoryElements,
        setCoachingHistoryEmptyState,
        renderCoachingHistory,
        chooseCoachingTip,
        collectCoachingPromptMetricData,
        resolveCoachingPromptPeriodEndDate,
        buildCoachingPromptMetricsText,
        buildCoachingPromptRoleSection,
        buildCoachingPromptVoiceToneSection,
        buildCoachingPromptRulesSection,
        buildCoachingPromptFlowSection,
        buildCoachingPromptOutputRequirementsSection,
        buildCoachingPromptDataSection,
        buildCoachingPromptDataRulesSection,
        buildCoachingPromptFinalInstructionSection,
        buildCoachingPrompt,
        getCoachingPromptGenerationInputs,
        resolveCoachingPromptEmployeeRecord,
        buildLatestCoachingSummaryData,
        recordAndRenderCoachingEvent,
        showCoachingPromptCopiedState,
        revealCoachingOutlookSection,
        openCopilotForCoachingPrompt,
        generateCoachingPromptAndCopy,
        getCoachingOutlookGenerationInputs,
        generateOutlookEmailFromCoPilot,
        getLatestWeekKeyForCoaching,
        resetCoachingEmailUiState,
        populateCoachingEmployeeSelectOptions,
        getCoachingLatestPeriodEmployees,
        setCoachingLatestPeriodStatus,
        bindCoachingOutlookInputState,
        bindCoachingEmailActionHandlers,
        initializeCoachingEmail
    };
})();
