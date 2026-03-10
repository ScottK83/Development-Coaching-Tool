(function () {
    'use strict';

    /* ──────────────────────────────────────────────
     *  Convenience aliases for globals / other modules
     * ────────────────────────────────────────────── */
    function _showToast(msg, ms) { return window.showToast(msg, ms); }
    function _getYearEndEmployees() { return window.getYearEndEmployees(); }
    function _getLatestYearPeriodForEmployee(name, year) { return window.getLatestYearPeriodForEmployee(name, year); }
    function _getYearEndDraftState(name, year) { return window.getYearEndDraftState(name, year); }
    function _persistYearEndDraftState(name, year) { return window.persistYearEndDraftState(name, year); }
    function _collectYearEndAnnualGoals(name, year) { return window.collectYearEndAnnualGoals(name, year); }
    function _buildYearEndMetricSnapshot(rec, year, meta) { return window.buildYearEndMetricSnapshot(rec, year, meta); }
    function _formatDateMMDDYYYY(val) { return window.formatDateMMDDYYYY(val); }
    function _renderYearEndOnOffMirror(rec, year, meta) { return window.renderYearEndOnOffMirror(rec, year, meta); }
    function _renderYearEndAnnualGoalsInputs(name, year) { return window.renderYearEndAnnualGoalsInputs(name, year); }
    function _appendMissingYearEndImprovementFollowUps(name, year) { return window.appendMissingYearEndImprovementFollowUps(name, year); }
    function _getEmployeeNickname(name) { return window.getEmployeeNickname(name); }
    function _openCopilotWithPrompt(prompt, label) { return window.openCopilotWithPrompt(prompt, label); }

    /* ──────────────────────────────────────────────
     *  Module-level state
     * ────────────────────────────────────────────── */
    let yearEndDraftContext = null;

    /* ──────────────────────────────────────────────
     *  Utility: one-time event binding
     * ────────────────────────────────────────────── */
    function bindElementOnce(element, eventName, handler) {
        if (!element || element.dataset.bound) return;
        element.addEventListener(eventName, handler);
        element.dataset.bound = 'true';
    }

    /* ──────────────────────────────────────────────
     *  DOM element accessors
     * ────────────────────────────────────────────── */
    function getYearEndCommentsElements() {
        return {
            employeeSelect: document.getElementById('yearEndEmployeeSelect'),
            reviewYearInput: document.getElementById('yearEndReviewYear'),
            status: document.getElementById('yearEndStatus'),
            snapshotPanel: document.getElementById('yearEndSnapshotPanel'),
            promptArea: document.getElementById('yearEndPromptArea'),
            trackSelect: document.getElementById('yearEndTrackSelect'),
            positivesInput: document.getElementById('yearEndPositivesInput'),
            improvementsInput: document.getElementById('yearEndImprovementsInput'),
            managerContextInput: document.getElementById('yearEndManagerContext'),
            responseInput: document.getElementById('yearEndCopilotResponse'),
            performanceRatingInput: document.getElementById('yearEndPerformanceRatingInput'),
            meritDetailsInput: document.getElementById('yearEndMeritDetailsInput'),
            bonusAmountInput: document.getElementById('yearEndBonusAmountInput'),
            verbalSummaryOutput: document.getElementById('yearEndVerbalSummaryOutput'),
            calculateOnOffBtn: document.getElementById('calculateYearEndOnOffBtn'),
            generateBtn: document.getElementById('generateYearEndPromptBtn'),
            pasteResponseBtn: document.getElementById('pasteYearEndResponseBtn'),
            copyBtn: document.getElementById('copyYearEndResponseBtn'),
            copyBox1Btn: document.getElementById('copyYearEndBox1Btn'),
            copyBox2Btn: document.getElementById('copyYearEndBox2Btn'),
            generateVerbalSummaryBtn: document.getElementById('generateYearEndVerbalSummaryBtn'),
            copyVerbalSummaryBtn: document.getElementById('copyYearEndVerbalSummaryBtn')
        };
    }

    function hasRequiredYearEndCommentsElements(elements) {
        return Boolean(
            elements.employeeSelect
            && elements.reviewYearInput
            && elements.status
            && elements.snapshotPanel
            && elements.promptArea
            && elements.trackSelect
            && elements.positivesInput
            && elements.improvementsInput
            && elements.managerContextInput
            && elements.responseInput
            && elements.performanceRatingInput
            && elements.meritDetailsInput
            && elements.bonusAmountInput
            && elements.verbalSummaryOutput
            && elements.generateBtn
            && elements.copyBtn
            && elements.generateVerbalSummaryBtn
            && elements.copyVerbalSummaryBtn
        );
    }

    function getYearEndSnapshotElements() {
        return {
            status: document.getElementById('yearEndStatus'),
            snapshotPanel: document.getElementById('yearEndSnapshotPanel'),
            summary: document.getElementById('yearEndFactsSummary'),
            winsList: document.getElementById('yearEndWinsList'),
            improvementList: document.getElementById('yearEndImprovementList'),
            onOffSummary: document.getElementById('yearEndOnOffSummary'),
            onOffDetails: document.getElementById('yearEndOnOffDetails'),
            trackSelect: document.getElementById('yearEndTrackSelect'),
            positivesInput: document.getElementById('yearEndPositivesInput'),
            improvementsInput: document.getElementById('yearEndImprovementsInput'),
            managerContextInput: document.getElementById('yearEndManagerContext'),
            responseInput: document.getElementById('yearEndCopilotResponse'),
            performanceRatingInput: document.getElementById('yearEndPerformanceRatingInput'),
            meritDetailsInput: document.getElementById('yearEndMeritDetailsInput'),
            bonusAmountInput: document.getElementById('yearEndBonusAmountInput'),
            verbalSummaryOutput: document.getElementById('yearEndVerbalSummaryOutput'),
            promptArea: document.getElementById('yearEndPromptArea')
        };
    }

    function getYearEndPromptInputs() {
        return {
            employeeName: document.getElementById('yearEndEmployeeSelect')?.value,
            reviewYear: document.getElementById('yearEndReviewYear')?.value,
            trackStatus: document.getElementById('yearEndTrackSelect')?.value,
            positivesText: document.getElementById('yearEndPositivesInput')?.value.trim() || '',
            improvementsText: document.getElementById('yearEndImprovementsInput')?.value.trim() || '',
            managerContext: document.getElementById('yearEndManagerContext')?.value.trim() || '',
            promptArea: document.getElementById('yearEndPromptArea'),
            button: document.getElementById('generateYearEndPromptBtn')
        };
    }

    /* ──────────────────────────────────────────────
     *  Initial-state helpers
     * ────────────────────────────────────────────── */
    function resetYearEndCommentsInitialState(snapshotPanel, promptArea) {
        yearEndDraftContext = null;
        promptArea.value = '';
        snapshotPanel.style.display = 'none';
    }

    function initializeYearEndReviewYearInput(reviewYearInput) {
        if (!reviewYearInput.value) {
            reviewYearInput.value = String(new Date().getFullYear());
        }
    }

    function populateYearEndEmployeeSelect(employeeSelect) {
        employeeSelect.innerHTML = '<option value="">-- Choose an associate --</option>';
        const employees = _getYearEndEmployees();
        employees.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            employeeSelect.appendChild(option);
        });
        return employees;
    }

    /* ──────────────────────────────────────────────
     *  Event-binding helpers
     * ────────────────────────────────────────────── */
    function bindYearEndPrimaryActionHandlers(elements) {
        bindElementOnce(elements.employeeSelect, 'change', updateYearEndSnapshotDisplay);
        bindElementOnce(elements.reviewYearInput, 'input', updateYearEndSnapshotDisplay);
        bindElementOnce(elements.generateBtn, 'click', generateYearEndPromptAndCopy);
        bindElementOnce(elements.pasteResponseBtn, 'click', pasteYearEndResponseFromClipboard);
        bindElementOnce(elements.copyBtn, 'click', copyYearEndResponseToClipboard);
        bindElementOnce(elements.copyBox1Btn, 'click', () => copyYearEndBoxResponseToClipboard(1));
        bindElementOnce(elements.copyBox2Btn, 'click', () => copyYearEndBoxResponseToClipboard(2));
        bindElementOnce(elements.generateVerbalSummaryBtn, 'click', generateYearEndVerbalSummary);
        bindElementOnce(elements.copyVerbalSummaryBtn, 'click', copyYearEndVerbalSummary);
        bindElementOnce(elements.calculateOnOffBtn, 'click', () => {
            const selectedEmployee = elements.employeeSelect.value;
            const selectedYear = elements.reviewYearInput.value;
            if (!selectedEmployee || !selectedYear) {
                alert('Select associate and review year first.');
                return;
            }
            updateYearEndSnapshotDisplay();
            document.getElementById('yearEndSnapshotPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            _showToast('On/Off tracker calculated using Excel mirror logic.', 3000);
        });
    }

    function bindYearEndDraftPersistenceHandlers(elements) {
        const persistDraft = () => {
            _persistYearEndDraftState(elements.employeeSelect.value, elements.reviewYearInput.value);
        };

        bindElementOnce(elements.trackSelect, 'change', persistDraft);
        bindElementOnce(elements.positivesInput, 'input', persistDraft);
        bindElementOnce(elements.improvementsInput, 'input', persistDraft);
        bindElementOnce(elements.managerContextInput, 'input', persistDraft);
        bindElementOnce(elements.responseInput, 'input', persistDraft);
        bindElementOnce(elements.performanceRatingInput, 'input', persistDraft);
        bindElementOnce(elements.meritDetailsInput, 'input', persistDraft);
        bindElementOnce(elements.bonusAmountInput, 'input', persistDraft);
        bindElementOnce(elements.verbalSummaryOutput, 'input', persistDraft);
    }

    /* ──────────────────────────────────────────────
     *  Initialization
     * ────────────────────────────────────────────── */
    function initializeYearEndComments() {
        const elements = getYearEndCommentsElements();
        if (!hasRequiredYearEndCommentsElements(elements)) return;

        resetYearEndCommentsInitialState(elements.snapshotPanel, elements.promptArea);
        initializeYearEndReviewYearInput(elements.reviewYearInput);

        const employees = populateYearEndEmployeeSelect(elements.employeeSelect);
        if (!employees.length) {
            elements.status.textContent = 'No employee data found yet. Upload yearly metrics first.';
            elements.status.style.display = 'block';
            _renderYearEndAnnualGoalsInputs('', elements.reviewYearInput.value || String(new Date().getFullYear()));
            return;
        }

        elements.status.textContent = `Loaded ${employees.length} associates. Select associate and review year.`;
        elements.status.style.display = 'block';

        bindYearEndPrimaryActionHandlers(elements);
        bindYearEndDraftPersistenceHandlers(elements);
        _renderYearEndAnnualGoalsInputs(elements.employeeSelect.value, elements.reviewYearInput.value);
    }

    /* ──────────────────────────────────────────────
     *  Clear / reset helpers
     * ────────────────────────────────────────────── */
    function clearYearEndOnOffMirror(onOffSummary, onOffDetails) {
        if (onOffSummary) onOffSummary.textContent = '';
        if (onOffDetails) onOffDetails.innerHTML = '';
    }

    function clearYearEndDraftInputs(trackSelect, positivesInput, improvementsInput, managerContextInput, responseInput, performanceRatingInput, meritDetailsInput, bonusAmountInput, verbalSummaryOutput) {
        if (trackSelect) trackSelect.value = '';
        if (positivesInput) positivesInput.value = '';
        if (improvementsInput) improvementsInput.value = '';
        if (managerContextInput) managerContextInput.value = '';
        if (responseInput) responseInput.value = '';
        if (performanceRatingInput) performanceRatingInput.value = '';
        if (meritDetailsInput) meritDetailsInput.value = '';
        if (bonusAmountInput) bonusAmountInput.value = '';
        if (verbalSummaryOutput) verbalSummaryOutput.value = '';
    }

    function clearYearEndSnapshotListsAndPrompt(summary, winsList, improvementList, promptArea) {
        if (promptArea) promptArea.value = '';
        if (summary) summary.textContent = '';
        if (winsList) winsList.innerHTML = '';
        if (improvementList) improvementList.innerHTML = '';
        yearEndDraftContext = null;
    }

    /* ──────────────────────────────────────────────
     *  Draft / snapshot data builders
     * ────────────────────────────────────────────── */
    function applyYearEndSavedDraft(savedDraft, trackSelect, positivesInput, improvementsInput, managerContextInput, responseInput, performanceRatingInput, meritDetailsInput, bonusAmountInput, verbalSummaryOutput) {
        if (trackSelect) trackSelect.value = savedDraft.trackStatus;
        if (positivesInput) positivesInput.value = savedDraft.positivesText;
        if (improvementsInput) improvementsInput.value = savedDraft.improvementsText;
        if (managerContextInput) managerContextInput.value = savedDraft.managerContext;
        if (responseInput) responseInput.value = savedDraft.copilotResponse;
        if (performanceRatingInput) performanceRatingInput.value = savedDraft.performanceRating;
        if (meritDetailsInput) meritDetailsInput.value = savedDraft.meritDetails;
        if (bonusAmountInput) bonusAmountInput.value = savedDraft.bonusAmount;
        if (verbalSummaryOutput) verbalSummaryOutput.value = savedDraft.verbalSummary;
    }

    function buildYearEndSummaryLine(latestPeriod, targetProfileYear, wins, opportunities) {
        const profileLabel = targetProfileYear ? `${targetProfileYear} goals` : 'current goals';
        const sourceLabel = latestPeriod.sourceName === 'ytdData' ? 'YTD upload' : 'Latest period upload';
        return `${latestPeriod.label} \u2022 Source: ${sourceLabel} \u2022 Targets: ${profileLabel} \u2022 ${wins.length} positives \u2022 ${opportunities.length} improvement areas`;
    }

    function autoPopulateYearEndNarrativeInputs(positivesInput, improvementsInput, wins, opportunities, annualGoals) {
        if (positivesInput && !positivesInput.value.trim()) {
            const metGoalLines = annualGoals.metGoals.slice(0, 4).map(goal => `Annual Goal Met: ${goal}`);
            positivesInput.value = wins.length
                ? wins.slice(0, 6).map(w => `${w.label}: ${w.value} vs target ${w.target}`).concat(metGoalLines).join('\n')
                : ['Consistent effort and willingness to grow throughout the year.', ...metGoalLines].join('\n');
        }

        if (improvementsInput && !improvementsInput.value.trim()) {
            const annualFollowUps = annualGoals.notMetGoals.map(goal => `Annual Goal Follow-up: ${goal}`);
            improvementsInput.value = opportunities.length
                ? opportunities.slice(0, 6).map(o => `${o.label}: ${o.value} vs target ${o.target}`).concat(annualFollowUps).join('\n')
                : annualFollowUps.length
                    ? annualFollowUps.join('\n')
                    : 'Continue building consistency and sustaining current performance levels.';
        }
    }

    function buildYearEndDraftContext(employeeName, reviewYear, latestPeriod, endDateText, wins, opportunities, targetProfileYear, annualGoals) {
        return {
            employeeName,
            reviewYear,
            periodLabel: latestPeriod.label,
            sourceLabel: latestPeriod.sourceName === 'ytdData' ? 'YTD upload' : 'latest uploaded period',
            endDateText,
            wins,
            opportunities,
            targetProfileYear,
            annualGoals
        };
    }

    /* ──────────────────────────────────────────────
     *  Snapshot rendering
     * ────────────────────────────────────────────── */
    function setYearEndSnapshotStatus(status, snapshotPanel, text, showPanel) {
        if (!status || !snapshotPanel) return;
        status.textContent = text;
        status.style.display = 'block';
        snapshotPanel.style.display = showPanel ? 'block' : 'none';
    }

    function renderYearEndSnapshotMetricLists(winsList, improvementList, wins, opportunities) {
        if (winsList) {
            winsList.innerHTML = wins.length
                ? wins.map(w => `<li>${w.label}: ${w.value} vs target ${w.target}</li>`).join('')
                : '<li>No metrics currently at goal in this period.</li>';
        }

        if (improvementList) {
            improvementList.innerHTML = opportunities.length
                ? opportunities.map(o => `<li>${o.label}: ${o.value} vs target ${o.target}</li>`).join('')
                : '<li>No below-target metrics detected in this period.</li>';
        }
    }

    function resolveYearEndEndDateText(latestPeriod) {
        const metadataEndDate = latestPeriod?.period?.metadata?.endDate;
        const fallbackDate = latestPeriod?.periodKey?.split('|')[1] || latestPeriod?.periodKey;
        return _formatDateMMDDYYYY(metadataEndDate || fallbackDate);
    }

    function updateYearEndSnapshotDisplay() {
        const employeeName = document.getElementById('yearEndEmployeeSelect')?.value;
        const reviewYear = document.getElementById('yearEndReviewYear')?.value;
        const {
            status,
            snapshotPanel,
            summary,
            winsList,
            improvementList,
            onOffSummary,
            onOffDetails,
            trackSelect,
            positivesInput,
            improvementsInput,
            managerContextInput,
            responseInput,
            performanceRatingInput,
            meritDetailsInput,
            bonusAmountInput,
            verbalSummaryOutput,
            promptArea
        } = getYearEndSnapshotElements();

        if (!status || !snapshotPanel || !summary || !winsList || !improvementList || !promptArea) return;

        clearYearEndSnapshotListsAndPrompt(summary, winsList, improvementList, promptArea);

        if (!employeeName || !reviewYear) {
            setYearEndSnapshotStatus(status, snapshotPanel, 'Select associate and review year to load year-end facts.', false);
            clearYearEndOnOffMirror(onOffSummary, onOffDetails);
            clearYearEndDraftInputs(trackSelect, positivesInput, improvementsInput, managerContextInput, responseInput, performanceRatingInput, meritDetailsInput, bonusAmountInput, verbalSummaryOutput);
            return;
        }

        const latestPeriod = _getLatestYearPeriodForEmployee(employeeName, reviewYear);
        if (!latestPeriod) {
            setYearEndSnapshotStatus(status, snapshotPanel, `No ${reviewYear} data found for ${employeeName}. Upload ${reviewYear} metrics first.`, false);
            clearYearEndOnOffMirror(onOffSummary, onOffDetails);
            return;
        }

        _renderYearEndAnnualGoalsInputs(employeeName, reviewYear);
        const savedDraft = _getYearEndDraftState(employeeName, reviewYear);
        applyYearEndSavedDraft(savedDraft, trackSelect, positivesInput, improvementsInput, managerContextInput, responseInput, performanceRatingInput, meritDetailsInput, bonusAmountInput, verbalSummaryOutput);

        const annualGoals = _collectYearEndAnnualGoals(employeeName, reviewYear);
        const { wins, opportunities, targetProfileYear } = _buildYearEndMetricSnapshot(
            latestPeriod.employeeRecord,
            reviewYear,
            latestPeriod.period?.metadata
        );
        const endDateText = resolveYearEndEndDateText(latestPeriod);

        summary.textContent = buildYearEndSummaryLine(latestPeriod, targetProfileYear, wins, opportunities);

        renderYearEndSnapshotMetricLists(winsList, improvementList, wins, opportunities);

        const onOffMirror = _renderYearEndOnOffMirror(
            latestPeriod.employeeRecord,
            reviewYear,
            latestPeriod.period?.metadata || null
        );
        if (trackSelect && !trackSelect.value && onOffMirror?.trackStatusValue) {
            trackSelect.value = onOffMirror.trackStatusValue;
        }

        autoPopulateYearEndNarrativeInputs(positivesInput, improvementsInput, wins, opportunities, annualGoals);

        _appendMissingYearEndImprovementFollowUps(employeeName, reviewYear);

        yearEndDraftContext = buildYearEndDraftContext(
            employeeName,
            reviewYear,
            latestPeriod,
            endDateText,
            wins,
            opportunities,
            targetProfileYear,
            annualGoals
        );

        setYearEndSnapshotStatus(status, snapshotPanel, `Year-end facts loaded for ${employeeName} (${reviewYear}).`, true);

        // Persist defaults if we auto-populated empty fields
        _persistYearEndDraftState(employeeName, reviewYear);
    }

    /* ──────────────────────────────────────────────
     *  Prompt generation
     * ────────────────────────────────────────────── */
    function validateYearEndPromptInputs(employeeName, reviewYear, trackStatus, promptArea) {
        if (!employeeName) {
            alert('Please select an associate first.');
            return false;
        }
        if (!reviewYear) {
            alert('Please enter a review year.');
            return false;
        }
        if (!trackStatus) {
            alert('Please mark whether the associate is on track or off track.');
            return false;
        }
        if (!promptArea) return false;
        return true;
    }

    function ensureYearEndDraftContext(employeeName, reviewYear) {
        _appendMissingYearEndImprovementFollowUps(employeeName, reviewYear);

        if (!yearEndDraftContext || yearEndDraftContext.employeeName !== employeeName || yearEndDraftContext.reviewYear !== reviewYear) {
            updateYearEndSnapshotDisplay();
        }
    }

    function buildYearEndPromptSupportData(employeeName, reviewYear) {
        const fallbackPositives = (yearEndDraftContext?.wins || [])
            .map(w => `${w.label}: ${w.value} vs target ${w.target}`)
            .join('\n');
        const fallbackImprovements = (yearEndDraftContext?.opportunities || [])
            .map(o => `${o.label}: ${o.value} vs target ${o.target}`)
            .join('\n');
        const annualGoals = _collectYearEndAnnualGoals(employeeName, reviewYear);
        const annualMetText = annualGoals.metGoals.length
            ? annualGoals.metGoals.map(line => `- ${line}`).join('\n')
            : '- None recorded';
        const annualNotMetText = annualGoals.notMetGoals.length
            ? annualGoals.notMetGoals.map(line => `- ${line}`).join('\n')
            : '- None';

        return {
            fallbackPositives,
            fallbackImprovements,
            annualMetText,
            annualNotMetText
        };
    }

    function resolveYearEndPromptHeaderData(employeeName, reviewYear, trackStatus) {
        const preferredName = _getEmployeeNickname(employeeName) || employeeName.split(' ')[0] || employeeName;
        const trackLabel = trackStatus === 'on-track-exceptional'
            ? 'On Track/Exceptional'
            : trackStatus === 'on-track-successful' || trackStatus === 'on-track'
                ? 'On Track/Successful'
                : 'Off Track';
        const periodLabel = yearEndDraftContext?.periodLabel || `${reviewYear} year-end period`;
        const sourceLabel = yearEndDraftContext?.sourceLabel || 'uploaded metrics';
        const targetProfileLabel = yearEndDraftContext?.targetProfileYear
            ? `${yearEndDraftContext.targetProfileYear} year-end goals`
            : 'current metric goals';

        return {
            preferredName,
            trackLabel,
            periodLabel,
            sourceLabel,
            targetProfileLabel
        };
    }

    function buildYearEndCopilotPrompt(inputData, supportData, headerData) {
        const delegated = window.DevCoachModules?.yearEnd?.buildCopilotPrompt?.(inputData, supportData, headerData);
        return delegated || '';
    }

    function setYearEndPromptButtonFeedback(button) {
        if (!button) return;
        const originalText = button.textContent;
        button.textContent = 'Copied + Opening Copilot';
        setTimeout(() => {
            button.textContent = originalText;
        }, 1500);
    }

    function copyYearEndPromptWithFallbacks(prompt, copilotWindow) {
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(prompt)
                .then(() => {
                    _showToast('Year-end prompt copied. Paste into Copilot with Ctrl+V.', 4000);
                    if (!copilotWindow) {
                        alert('Year-end prompt copied to clipboard.\n\nOpen https://copilot.microsoft.com and paste with Ctrl+V.');
                    }
                })
                .catch(() => {
                    _showToast('Could not copy automatically. Prompt is in the box below for manual copy.', 4500);
                    if (!copilotWindow) {
                        _openCopilotWithPrompt(prompt, 'Year-End Comments');
                    }
                });
            return;
        }

        _showToast('Clipboard not available. Copy the prompt from the box below.', 4500);
        if (!copilotWindow) {
            _openCopilotWithPrompt(prompt, 'Year-End Comments');
        }
    }

    function generateYearEndPromptAndCopy() {
        const inputData = getYearEndPromptInputs();

        if (!validateYearEndPromptInputs(inputData.employeeName, inputData.reviewYear, inputData.trackStatus, inputData.promptArea)) {
            return;
        }

        ensureYearEndDraftContext(inputData.employeeName, inputData.reviewYear);
        const supportData = buildYearEndPromptSupportData(inputData.employeeName, inputData.reviewYear);
        const headerData = resolveYearEndPromptHeaderData(inputData.employeeName, inputData.reviewYear, inputData.trackStatus);
        const prompt = buildYearEndCopilotPrompt(inputData, supportData, headerData);
        if (!prompt) {
            _showToast('Year-End module is unavailable. Refresh and try again.', 3500);
            return;
        }

        inputData.promptArea.value = prompt;
        setYearEndPromptButtonFeedback(inputData.button);

        const copilotWindow = window.open('https://copilot.microsoft.com', '_blank');
        copyYearEndPromptWithFallbacks(prompt, copilotWindow);
    }

    /* ──────────────────────────────────────────────
     *  Clipboard helpers
     * ────────────────────────────────────────────── */
    function copyYearEndResponseToClipboard() {
        const responseText = document.getElementById('yearEndCopilotResponse')?.value.trim();
        if (!responseText) {
            alert('Paste the Copilot year-end comments first.');
            return;
        }

        navigator.clipboard.writeText(responseText)
            .then(() => _showToast('Year-end notes copied to clipboard!', 3000))
            .catch(() => _showToast('Unable to copy year-end notes.', 3000));
    }

    function focusYearEndResponseInput(responseInput) {
        if (responseInput && typeof responseInput.focus === 'function') {
            responseInput.focus();
        }
    }

    async function getClipboardTextViaReadText() {
        if (!navigator.clipboard?.readText) return '';
        return String(await navigator.clipboard.readText() || '');
    }

    async function extractClipboardTextFromItem(item) {
        if (item.types.includes('text/plain')) {
            const plainBlob = await item.getType('text/plain');
            const plainText = await plainBlob.text();
            if (plainText && plainText.trim()) return plainText;
        }

        if (item.types.includes('text/html')) {
            const htmlBlob = await item.getType('text/html');
            const htmlText = await htmlBlob.text();
            const parser = new DOMParser();
            const htmlDoc = parser.parseFromString(htmlText, 'text/html');
            const parsedText = String(htmlDoc.body?.innerText || '').trim();
            if (parsedText && parsedText.trim()) return parsedText;
        }

        return '';
    }

    async function getClipboardTextViaReadItems() {
        if (!navigator.clipboard?.read) return '';

        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
            const text = await extractClipboardTextFromItem(item);
            if (text && text.trim()) return text;
        }

        return '';
    }

    async function readYearEndClipboardText() {
        let clipboardText = await getClipboardTextViaReadText();
        if (clipboardText && clipboardText.trim()) return clipboardText;
        clipboardText = await getClipboardTextViaReadItems();
        return clipboardText;
    }

    async function pasteYearEndResponseFromClipboard() {
        const responseInput = document.getElementById('yearEndCopilotResponse');
        const employeeName = document.getElementById('yearEndEmployeeSelect')?.value;
        const reviewYear = document.getElementById('yearEndReviewYear')?.value;
        if (!responseInput) return;

        try {
            if (!navigator.clipboard) {
                _showToast('Clipboard paste is not available in this browser. Use Ctrl+V in the box.', 4500);
                focusYearEndResponseInput(responseInput);
                return;
            }

            const clipboardText = await readYearEndClipboardText();

            if (!clipboardText || !clipboardText.trim()) {
                _showToast('Clipboard read was blocked or returned no text. Click the box and press Ctrl+V.', 4500);
                focusYearEndResponseInput(responseInput);
                return;
            }

            responseInput.value = clipboardText;
            _persistYearEndDraftState(employeeName, reviewYear);
            _showToast('Final notes pasted from clipboard.', 3000);
        } catch (error) {
            _showToast('Could not access clipboard API. Click in the box and use Ctrl+V.', 4500);
            focusYearEndResponseInput(responseInput);
        }
    }

    function extractYearEndBoxText(responseText, boxNumber) {
        const delegated = window.DevCoachModules?.yearEnd?.extractBoxText?.(responseText, boxNumber);
        return typeof delegated === 'string' ? delegated : '';
    }

    function copyYearEndBoxResponseToClipboard(boxNumber) {
        const responseText = document.getElementById('yearEndCopilotResponse')?.value.trim();
        if (!responseText) {
            alert('Paste the Copilot year-end comments first.');
            return;
        }

        const boxText = extractYearEndBoxText(responseText, boxNumber);
        if (!boxText) {
            _showToast(`Could not find Box ${boxNumber} in the pasted response.`, 3500);
            return;
        }

        navigator.clipboard.writeText(boxText)
            .then(() => _showToast(`Box ${boxNumber} copied to clipboard!`, 3000))
            .catch(() => _showToast(`Unable to copy Box ${boxNumber}.`, 3000));
    }

    /* ──────────────────────────────────────────────
     *  Verbal summary
     * ────────────────────────────────────────────── */
    function generateYearEndVerbalSummary() {
        const employeeName = document.getElementById('yearEndEmployeeSelect')?.value;
        const reviewYear = document.getElementById('yearEndReviewYear')?.value;
        const performanceRating = document.getElementById('yearEndPerformanceRatingInput')?.value.trim() || 'Not provided';
        const meritDetails = document.getElementById('yearEndMeritDetailsInput')?.value.trim() || 'Not provided';
        const bonusAmount = document.getElementById('yearEndBonusAmountInput')?.value.trim() || 'Not provided';
        const output = document.getElementById('yearEndVerbalSummaryOutput');

        if (!employeeName) {
            alert('Please select an associate first.');
            return;
        }
        if (!reviewYear) {
            alert('Please enter a review year.');
            return;
        }
        if (!output) return;

        const preferredName = _getEmployeeNickname(employeeName) || employeeName.split(' ')[0] || employeeName;
        const summary = window.DevCoachModules?.yearEnd?.buildVerbalSummary?.(
            preferredName,
            reviewYear,
            performanceRating,
            meritDetails,
            bonusAmount
        ) || '';

        if (!summary) {
            _showToast('Year-End module is unavailable. Refresh and try again.', 3500);
            return;
        }

        output.value = summary;
        _persistYearEndDraftState(employeeName, reviewYear);
        _showToast('Verbal summary generated.', 3000);
    }

    function copyYearEndVerbalSummary() {
        const outputText = document.getElementById('yearEndVerbalSummaryOutput')?.value.trim();
        if (!outputText) {
            alert('Generate the verbal summary first.');
            return;
        }

        navigator.clipboard.writeText(outputText)
            .then(() => _showToast('Verbal summary copied to clipboard!', 3000))
            .catch(() => _showToast('Unable to copy verbal summary.', 3000));
    }

    /* ──────────────────────────────────────────────
     *  Module export
     * ────────────────────────────────────────────── */
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.yearEndComments = {
        bindElementOnce,
        getYearEndCommentsElements,
        hasRequiredYearEndCommentsElements,
        resetYearEndCommentsInitialState,
        initializeYearEndReviewYearInput,
        populateYearEndEmployeeSelect,
        bindYearEndPrimaryActionHandlers,
        bindYearEndDraftPersistenceHandlers,
        initializeYearEndComments,
        clearYearEndOnOffMirror,
        clearYearEndDraftInputs,
        applyYearEndSavedDraft,
        buildYearEndSummaryLine,
        autoPopulateYearEndNarrativeInputs,
        buildYearEndDraftContext,
        getYearEndSnapshotElements,
        clearYearEndSnapshotListsAndPrompt,
        setYearEndSnapshotStatus,
        renderYearEndSnapshotMetricLists,
        resolveYearEndEndDateText,
        updateYearEndSnapshotDisplay,
        getYearEndPromptInputs,
        validateYearEndPromptInputs,
        ensureYearEndDraftContext,
        buildYearEndPromptSupportData,
        resolveYearEndPromptHeaderData,
        buildYearEndCopilotPrompt,
        setYearEndPromptButtonFeedback,
        copyYearEndPromptWithFallbacks,
        generateYearEndPromptAndCopy,
        copyYearEndResponseToClipboard,
        focusYearEndResponseInput,
        getClipboardTextViaReadText,
        extractClipboardTextFromItem,
        getClipboardTextViaReadItems,
        readYearEndClipboardText,
        pasteYearEndResponseFromClipboard,
        extractYearEndBoxText,
        copyYearEndBoxResponseToClipboard,
        generateYearEndVerbalSummary,
        copyYearEndVerbalSummary
    };
})();
