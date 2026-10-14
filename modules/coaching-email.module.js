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

    /**
     * Reliability is the year's running total of hours missed, never one
     * week's. The weekly row holds that week's hours, so graded against the
     * year's budget someone at 30 hours for the year who missed nothing this
     * week was listed as a win. The total comes from the newest year-to-date
     * upload that had closed by the end of the coaching week's month; with none
     * it is left out rather than guessed.
     */
    function resolveReliabilityYearTotal(employeeName) {
        const pc = window.DevCoachModules?.periodCompare;
        const period = weeklyData[coachingLatestWeekKey];
        const endDate = period?.metadata?.endDate || String(coachingLatestWeekKey || '').split('|')[1] || '';
        if (typeof pc?.latestYtdReliability !== 'function' || !/^\d{4}-\d{2}/.test(endDate)) return NaN;
        const map = pc.latestYtdReliability(parseInt(endDate.slice(0, 4), 10), { asOfMonth: endDate.slice(0, 7) }) || {};
        const value = parseFloat(map[employeeName]);
        return Number.isFinite(value) ? value : NaN;
    }

    function coachingMetricValue(employeeRecord, key) {
        if (key === 'reliability') return resolveReliabilityYearTotal(employeeRecord?.name);
        return employeeRecord[key];
    }

    /**
     * Did anybody answer the survey this metric is built from?
     *
     * Scott, 2026-10-14: an associate with no surveys was coached on
     * "Overall Experience: 0.0% vs target 75.0%", Rep Sat and FCR the same,
     * each with a tip. Nobody was asked, so that 0 is an empty column, not a
     * score. The count is the metric's own (rep sat and FCR are answered
     * separately from Overall Experience), the same field map the team
     * figures and the morning pulse weigh by.
     */
    const SURVEY_COUNT_FALLBACK = { cxRepOverall: 'repSurveyTotal', fcr: 'fcrSurveyTotal', overallExperience: 'surveyTotal' };

    function hasSurveysBehind(employeeRecord, key) {
        const weigh = window.DevCoachModules?.metricsRegistryHelpers?.getSurveyWeight || window.getSurveyWeight;
        if (typeof weigh === 'function') {
            const count = weigh(key, employeeRecord);
            return count === null || count > 0;
        }
        const field = SURVEY_COUNT_FALLBACK[key];
        if (!field) return true;
        const own = parseInt(employeeRecord?.[field], 10);
        const count = Number.isInteger(own) ? own : parseInt(employeeRecord?.surveyTotal, 10);
        return Number.isInteger(count) && count > 0;
    }

    function buildCoachingDisplayMetricData(employeeRecord) {
        const wins = [];
        const opportunities = [];
        const metricKeys = getMetricOrder().map(m => m.key);

        metricKeys.forEach(key => {
            const metricConfig = METRICS_REGISTRY[key];
            const value = coachingMetricValue(employeeRecord, key);
            if (!metricConfig || value === null || value === undefined || value === '' || value === 'N/A') return;
            if (!hasSurveysBehind(employeeRecord, key)) return;

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

    // "Oct 5". Written out here rather than through toLocaleDateString, so it
    // reads the same on every machine and in the tests.
    const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function shortDate(iso) {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        if (!match) return '';
        const month = SHORT_MONTHS[parseInt(match[2], 10) - 1];
        return month ? `${month} ${parseInt(match[3], 10)}` : '';
    }

    /**
     * The week as the associate would say it: "Week of Oct 5".
     *
     * Scott, 2026-10-14: the subject read "Week of 10/09/2026", which is the
     * Friday the week ended on. "Week of" means the day it started. The start
     * comes from the upload, then the key, then the Monday of the end date's
     * week.
     */
    function resolveCoachingWeekStartIso(periodKey, periodMeta) {
        const meta = periodMeta || {};
        if (/^\d{4}-\d{2}-\d{2}/.test(meta.startDate || '')) return meta.startDate.slice(0, 10);
        const parts = String(periodKey || '').split('|');
        if (parts.length > 1 && /^\d{4}-\d{2}-\d{2}/.test(parts[0])) return parts[0].slice(0, 10);
        const end = meta.endDate || parts[1] || '';
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(end);
        if (!match) return '';
        const endDay = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
        const back = (endDay.getUTCDay() + 6) % 7;
        return new Date(endDay.getTime() - back * 86400000).toISOString().slice(0, 10);
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

        elements.summary.textContent = `${resolveCoachingPromptWeekLabel()} \u2022 ${wins.length} wins \u2022 ${opportunities.length} focus areas`;
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

        // "What did I say" is only half the story; the other half is whether
        // it landed. Rendered alongside the log rather than in a new tab —
        // it's the same question, and the app has enough destinations.
        // The team rollup is handled at tab init, not here: it isn't about
        // any one person, so it must not wait for someone to be selected.
        window.DevCoachModules?.coachingOutcomes
            ?.renderForEmployee(document.getElementById('coachingOutcomesPanel'), employeeName);

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
        // The tip pool is keyed by metric key, not by display label. Passing the
        // label here meant every lookup missed and every coaching email fell
        // through to the registry's single defaultTip, so the whole pool went
        // unused. See AUDIT.md 2.11.
        const tips = getMetricTips(metricConfig.key);
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

    // Scott, 2026-10-14: the prompt handed Copilot 13 strengths or 13 focus
    // areas, each with a tip, and asked for all of them. What came back was a
    // long report. Three wins to celebrate and two things to work on is what a
    // person can take in from one email.
    const MAX_PROMPT_WINS = 3;
    const MAX_PROMPT_FOCUS = 2;

    function isLowerBetter(key) {
        return METRICS_REGISTRY[key]?.target?.type === 'max';
    }

    // "goal 93% or better", "goal 426s or lower". The ">= 93" it replaces is
    // a formula, and the associate reads whatever the prompt hands over.
    function goalPhrase(key, target) {
        return `goal ${formatMetricDisplay(key, target)} or ${isLowerBetter(key) ? 'lower' : 'better'}`;
    }

    // How far past the goal (positive) or short of it (negative), as a share
    // of the goal, so seconds and percentages can be ranked together.
    function goalMargin(key, value, target) {
        if (!target) return 0;
        const ahead = isLowerBetter(key) ? target - value : value - target;
        return ahead / Math.abs(target);
    }

    function collectCoachingPromptMetricData(employeeRecord) {
        const wins = [];
        const opportunities = [];
        const usedTips = new Set();

        getMetricOrder().map(m => m.key).forEach(key => {
            // Reliability is the year's running total and stays out of a
            // weekly email's wins and focus areas. Scott, 2026-10-05 and
            // again 2026-10-14: "Reliability: 26.5 hrs vs target 18.0 hrs"
            // went out as a focus area with an attendance tip.
            if (key === 'reliability') return;
            const metricConfig = METRICS_REGISTRY[key];
            const value = coachingMetricValue(employeeRecord, key);
            if (!metricConfig || value === null || value === undefined || value === '' || value === 'N/A') return;
            if (!hasSurveysBehind(employeeRecord, key)) return;

            const numValue = parseFloat(value);
            if (isNaN(numValue)) return;

            const target = metricConfig.target?.value;
            if (target === undefined || target === null) return;

            const entry = {
                key,
                label: metricConfig.label,
                value: formatMetricDisplay(key, numValue),
                target: formatMetricDisplay(key, target),
                goal: goalPhrase(key, target),
                margin: goalMargin(key, numValue, target)
            };
            (isMetricMeetingTarget(key, numValue, target) ? wins : opportunities).push(entry);
        });

        const measured = wins.length + opportunities.length;
        const topWins = wins.slice().sort((a, b) => b.margin - a.margin).slice(0, MAX_PROMPT_WINS);
        const topFocus = opportunities.slice().sort((a, b) => a.margin - b.margin).slice(0, MAX_PROMPT_FOCUS)
            .map(entry => ({ ...entry, tip: chooseCoachingTip(METRICS_REGISTRY[entry.key], usedTips) }));

        return { wins: topWins, opportunities: topFocus, metCount: wins.length, measuredCount: measured };
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

    // "Week of Oct 5", from the day the week started. Falls back to the old
    // end date wording only when no date can be read at all.
    function resolveCoachingPromptWeekLabel() {
        const meta = weeklyData[coachingLatestWeekKey]?.metadata || {};
        const start = shortDate(resolveCoachingWeekStartIso(coachingLatestWeekKey, meta));
        return start ? `Week of ${start}` : `Week ending ${resolveCoachingPromptPeriodEndDate()}`;
    }

    // -- Prompt section builders -----------------------------------------------

    function buildCoachingPromptMetricsText(wins, opportunities) {
        const winsText = wins.length
            ? wins.map(w => `- ${w.label}: ${w.value}, ${w.goal || `goal ${w.target}`}`).join('\n')
            : '- None at goal this week. Open with real thanks for the effort they are putting in, without inventing a win.';

        const oppText = opportunities.length
            ? opportunities.map(o => `- ${o.label}: ${o.value}, ${o.goal || `goal ${o.target}`}\n  Tip: ${o.tip}`).join('\n')
            : '- Nothing below goal this week. Make the whole email a thank you.';

        return { winsText, oppText };
    }

    function buildCoachingPromptRoleSection(employeeName) {
        return `ROLE

You are a real contact center supervisor writing a weekly coaching check-in email for ${employeeName}.
This should sound like it is coming directly from their supervisor: warm, human, supportive, and invested in their success.
This is a recurring weekly email.
Assume you have written to this associate before.
Vary wording and structure naturally like a human would.`;
    }

    function buildCoachingPromptVoiceToneSection() {
        return `VOICE & TONE (CRITICAL)

- Warm, upbeat and genuinely proud of them
- Friendly and conversational, the way you would talk to them at their desk
- Specific praise first and plenty of it, not a quick "good job" on the way to the coaching
- Encouraging and forward looking: every goal is within reach
- Supportive and invested in their success
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
- Do NOT use em dashes or dashes of any kind. Use commas or periods
- At most 2 emojis in the whole email
- Under 200 words
- Write in natural paragraphs with clean, simple bullet points where appropriate`;
    }

    function buildCoachingPromptFlowSection(preferredName) {
        return `EMAIL FLOW (INTERNAL, DO NOT SHOW)

Opening:
- Greet ${preferredName} by name
- Thank them and lead with appreciation

Celebrate Wins:
- Lead with the wins listed below, each with its number and its goal
- Be specific and warm about each one, and say why it matters to customers or the team

Coaching:
- Only the focus areas listed below, and no others
- Give each one its number and its goal, plainly, as the next goal to reach
- Use the one tip given for it, rewritten naturally in your own words
- Frame it as a next step you are confident they can take, not a correction

Close:
- End on encouragement and confidence
- Make it clear you are in their corner`;
    }

    function buildCoachingPromptOutputRequirementsSection(preferredName) {
        return `OUTPUT REQUIREMENTS

- Address ${preferredName} by name in the opening
- Use clean bullets for the wins and the focus areas
- Write each number the way it is given, with its goal ("goal 93% or better")
- Exactly ONE tip per focus area, rewritten in natural language, never copied verbatim
- Sound like a real supervisor: natural, human, and supportive
- At most 2 emojis, under 200 words, no em dashes
- No numbered sections or labels`;
    }

    function buildCoachingPromptDataSection(periodLabel, winsText, oppText, options = {}) {
        const label = /^Week (of|ending) /.test(String(periodLabel || '')) ? periodLabel : `Week of ${periodLabel}`;
        const tally = options.measuredCount
            ? `\nAt goal on ${options.metCount} of ${options.measuredCount} measures.\n`
            : '';
        const tense = options.ongoing
            ? '\nThe week is still going, so talk about it in the present tense.\n'
            : '\nThe week is over, so talk about it in the past tense.\n';
        return `DATA FOR THIS EMAIL

${label}
${tally}${tense}
Wins to celebrate:
${winsText}

Focus areas (at most two):
${oppText}`;
    }

    function buildCoachingPromptDataRulesSection() {
        return `DATA RULES

- Only reference metrics and data provided above
- Do not invent feedback or metrics
- Do not mention attendance, reliability or hours missed
- Do not assume external factors
- Every tip must relate directly to the data provided`;
    }

    function buildCoachingPromptFinalInstructionSection(preferredName) {
        return `FINAL INSTRUCTION

Generate the coaching email for ${preferredName} now.`;
    }

    // -- Full prompt assembly --------------------------------------------------

    function buildCoachingPrompt(employeeRecord) {
        const { wins, opportunities, metCount, measuredCount } = collectCoachingPromptMetricData(employeeRecord);
        const weekLabel = resolveCoachingPromptWeekLabel();
        const periodType = weeklyData[coachingLatestWeekKey]?.metadata?.periodType || 'week';

        const preferredName = getEmployeeNickname(employeeRecord.name) || String(employeeRecord.name || '').split(/\s+/)[0];
        const { winsText, oppText } = buildCoachingPromptMetricsText(wins, opportunities);

        return [
            buildCoachingPromptRoleSection(employeeRecord.name),
            buildCoachingPromptVoiceToneSection(),
            buildCoachingPromptRulesSection(),
            buildCoachingPromptFlowSection(preferredName),
            buildCoachingPromptOutputRequirementsSection(preferredName),
            buildCoachingPromptDataSection(weekLabel, winsText, oppText, {
                metCount,
                measuredCount,
                ongoing: periodType === 'week-in-progress'
            }),
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
        // The year's running total, never the week's own hours.
        const reliabilityHours = (() => {
            const parsed = resolveReliabilityYearTotal(employeeRecord.name);
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

    function revealCoachingOutlookSection() {
        const outlookSection = document.getElementById('coachingOutlookSection');
        if (!outlookSection) return;
        outlookSection.style.display = 'block';
        outlookSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
        // The Outlook panel is revealed straight away: it is the next step
        // whatever the clipboard does, and hiding it behind a copy would punish
        // the user for a browser setting.
        revealCoachingOutlookSection();

        // Copilot opens inside this click rather than 500ms later, so the popup
        // keeps its user activation, and the button now flashes only once the
        // copy has resolved. It used to say "Copied to CoPilot" regardless.
        window.DevCoachModules.sharedUtils.copyPromptAndOpenCopilot(promptArea.value, {
            button,
            successLabel: '✅ Copied to CoPilot',
            silent: true,
            onCopyFailed: () => promptArea.select()
        });
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
        const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        const weekKeys = Object.keys(weeklyData || {}).concat(Object.keys(ytd));
        if (weekKeys.length === 0) return null;

        const getEndDate = (weekKey) => {
            const metaEnd = (weeklyData[weekKey] || ytd[weekKey])?.metadata?.endDate;
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

    // Replaces the whole option list, placeholder included. The previous version
    // only appended names and relied on resetCoachingEmailUiState having written
    // the placeholder first; the visible result is the same either way, but this
    // no longer depends on a caller several steps earlier having done its part.
    function populateCoachingEmployeeSelectOptions(select, employees) {
        window.DevCoachModules.associatePicker.populateSelect(select, employees);
    }

    function getCoachingLatestPeriodEmployees(coachingWeekKey) {
        const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        const latestWeek = weeklyData[coachingWeekKey] || ytd[coachingWeekKey];
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

        // "Which coaching lands" is a team-wide question — render it as soon
        // as the tab opens, before anyone is picked, and even when there is
        // no metric data to build an email from.
        window.DevCoachModules?.coachingOutcomes
            ?.renderTeamSummary(document.getElementById('coachingOutcomesTeamPanel'));

        const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        if ((!weeklyData || Object.keys(weeklyData).length === 0) && Object.keys(ytd).length === 0) {
            status.textContent = 'No data available. Upload data first to generate coaching emails.';
            status.style.display = 'block';
            return;
        }

        coachingLatestWeekKey = getLatestWeekKeyForCoaching();
        if (!coachingLatestWeekKey || !(weeklyData[coachingLatestWeekKey] || ytd[coachingLatestWeekKey])) {
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
        hasSurveysBehind,
        shortDate,
        resolveCoachingWeekStartIso,
        resolveCoachingPromptWeekLabel,
        goalPhrase,
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
        revealCoachingOutlookSection,
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
