// ============================================
// RED FLAG COACHING FUNCTIONALITY
// ============================================

// ============================================
// DATA-DRIVEN TODO TYPE REGISTRY
// ============================================

const FOLLOW_UP_TODO_TYPES = {
    'refund-check-review': {
        label: 'Refund Check Review',
        defaultProcess: 'rep-did-not-verify',
        processOptions: [
            {
                value: 'rep-did-not-verify',
                label: "Rep didn't verify address/details in To-Do",
                declineReason: "The To-Do was declined because the mailing address was not verified or documented in the submission.",
                process: `Before submitting the To-Do, verify and document where the refund check will be mailed.

In CCB, open the person record and review Correspondence Info. If the account is inactive or no address is listed, confirm the mailing address directly with the customer.

Resubmit the To-Do with clear notes that state the address was validated and where the check should be sent.`
            },
            {
                value: 'missing-validation',
                label: 'Missing required validation before resubmission',
                declineReason: "The To-Do was declined because required validation steps were not completed before submission.",
                process: `Complete all required validation steps before resubmitting the To-Do.

Confirm the customer details in CCB, verify mailing instructions, and ensure all policy checks are completed.

Update the new To-Do with clear confirmation notes so the reviewer can approve without additional follow-up.`
            },
            {
                value: 'insufficient-notes',
                label: 'To-Do notes were incomplete/unclear',
                declineReason: "The To-Do was declined because the notes did not provide enough detail to process the request.",
                process: `Resubmit the To-Do with complete, specific notes.

Your notes should clearly state what was reviewed, what was verified, and the final mailing destination for the refund check.

Detailed documentation helps avoid delays and supports faster approval.`
            },
            { value: 'other', label: 'Other (custom)', declineReason: '', process: '' }
        ]
    },
    'general-billing-request': {
        label: 'General Billing Request',
        defaultProcess: 'missing-installment-count',
        processOptions: [
            {
                value: 'missing-installment-count',
                label: 'Missing number of installments',
                declineReason: "The General Billing Request To-Do was declined because it did not include the number of installments for the payment arrangement.",
                process: `The General Billing Request To-Do was declined because it did not include the number of installments for the payment arrangement.

When submitting a PA on an old balance, always include:
- The total balance being arranged
- The number of installments requested
- The installment amount

Resubmit the To-Do with the installment count and amount clearly stated in the notes.`
            },
            {
                value: 'missing-pa-details',
                label: 'Missing or incomplete PA details',
                declineReason: "The General Billing Request To-Do was declined because it was missing required payment arrangement details.",
                process: `The General Billing Request To-Do was declined because it was missing required payment arrangement details.

Ensure the To-Do includes:
- The reason a General Billing To-Do is needed (e.g., pending start, old balance)
- The total amount to be arranged
- The number of installments and payment schedule
- Any relevant account notes or context

Resubmit with all required details so the request can be processed without follow-up.`
            },
            {
                value: 'insufficient-billing-notes',
                label: 'Billing notes were incomplete/unclear',
                declineReason: "The General Billing Request To-Do was declined because the notes did not provide enough information to process the request.",
                process: `The General Billing Request To-Do was declined because the notes did not provide enough information to process the request.

Include clear, specific notes that explain:
- What action is being requested and why
- All relevant dollar amounts, dates, and installment details
- Any special circumstances (e.g., pending start, account status)

Detailed notes help avoid delays and support faster processing.`
            },
            { value: 'other', label: 'Other (custom)', declineReason: '', process: '' }
        ]
    }
};

let pendingFollowUpMailtoUrl = '';
let lastAutoDeclineReason = '';

// ============================================
// INITIALIZATION
// ============================================

function initializeRedFlag() {
    document.getElementById('generateRedFlagEmailBtn')?.addEventListener('click', generateRedFlagEmail);
    document.getElementById('copyRedFlagEmailBtn')?.addEventListener('click', copyRedFlagEmail);
    document.getElementById('clearRedFlagEmailBtn')?.addEventListener('click', clearRedFlagEmail);

    document.getElementById('followUpTodoType')?.addEventListener('change', handleFollowUpTodoTypeChange);
    document.getElementById('showFollowUpPanelBtn')?.addEventListener('click', () => switchRedFlagMode('follow-up'));
    document.getElementById('showRedFlagPanelBtn')?.addEventListener('click', () => switchRedFlagMode('red-flag'));
    document.getElementById('openFollowUpEmailBtn')?.addEventListener('click', openFollowUpEmailDraft);
    document.getElementById('copyFollowUpEmailBtn')?.addEventListener('click', copyFollowUpEmail);
    document.getElementById('clearFollowUpEmailBtn')?.addEventListener('click', clearFollowUpEmail);

    document.getElementById('followUpHistoryFilter')?.addEventListener('change', renderFollowUpHistory);

    document.getElementById('showSurveyFeedbackPanelBtn')?.addEventListener('click', () => switchRedFlagMode('survey-feedback'));
    document.getElementById('parseSurveyBtn')?.addEventListener('click', parseSurveyData);
    document.getElementById('copySurveyPromptBtn')?.addEventListener('click', copySurveyPromptAndOpenCopilot);
    document.getElementById('clearSurveyBtn')?.addEventListener('click', clearSurveyFeedback);

    populateFollowUpTodoTypeDropdown();
    populateFollowUpAssociateDropdown();
    switchRedFlagMode('follow-up');
    renderFollowUpHistory();
}

// ============================================
// TODO TYPE DROPDOWN (DATA-DRIVEN)
// ============================================

function populateFollowUpTodoTypeDropdown() {
    const select = document.getElementById('followUpTodoType');
    if (!select) return;

    select.innerHTML = '<option value="">-- Select a To-Do Type --</option>';
    Object.entries(FOLLOW_UP_TODO_TYPES).forEach(([key, config]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = config.label;
        select.appendChild(option);
    });
}

// ============================================
// DYNAMIC FIELDS RENDERING
// ============================================

function renderFollowUpFields(todoTypeKey) {
    const container = document.getElementById('followUpDynamicFields');
    if (!container) return;

    const config = FOLLOW_UP_TODO_TYPES[todoTypeKey];
    if (!config) {
        container.innerHTML = '';
        return;
    }

    const processOptionsHtml = config.processOptions.map(opt =>
        `<option value="${opt.value}">${opt.label}</option>`
    ).join('');

    container.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label for="followUpCustomerAccount" style="font-weight: bold; display: block; margin-bottom: 5px; color: #333;">Customer Account:</label>
                <input type="text" id="followUpCustomerAccount" placeholder="e.g., 1234567890" style="width: 100%; padding: 10px; border: 2px solid #ff8a65; border-radius: 4px; font-size: 1em; box-sizing: border-box;">
            </div>
            <div>
                <label for="followUpCustomerName" style="font-weight: bold; display: block; margin-bottom: 5px; color: #333;">Customer Name:</label>
                <input type="text" id="followUpCustomerName" placeholder="e.g., Jane Doe" style="width: 100%; padding: 10px; border: 2px solid #ff8a65; border-radius: 4px; font-size: 1em; box-sizing: border-box;">
            </div>
        </div>

        <div style="margin-bottom: 15px;">
            <label for="followUpDeclineReason" style="font-weight: bold; display: block; margin-bottom: 5px; color: #333;">Reason To-Do Was Declined:</label>
            <textarea id="followUpDeclineReason" placeholder="Enter the reason the to-do was declined..." style="width: 100%; padding: 10px; border: 2px solid #ff8a65; border-radius: 4px; font-size: 0.95em; box-sizing: border-box; min-height: 100px; resize: vertical;"></textarea>
        </div>

        <div style="margin-bottom: 15px;">
            <label for="followUpProcessType" style="font-weight: bold; display: block; margin-bottom: 5px; color: #333;">Correct Process:</label>
            <select id="followUpProcessType" style="width: 100%; padding: 10px; border: 2px solid #ff8a65; border-radius: 4px; font-size: 1em; box-sizing: border-box; margin-bottom: 10px;">
                <option value="">-- Select Correct Process --</option>
                ${processOptionsHtml}
            </select>
            <textarea id="followUpProcess" style="width: 100%; padding: 10px; border: 2px solid #ff8a65; border-radius: 4px; font-size: 0.95em; box-sizing: border-box; min-height: 170px; resize: vertical; background: #fff8f2;" placeholder="Process guidance will appear here. You can edit this before building the email draft."></textarea>
        </div>

        <button type="button" id="sendFollowUpEmailBtn" style="background: #ef6c00; color: white; border: none; border-radius: 4px; padding: 12px 24px; cursor: pointer; font-weight: bold; font-size: 1em;">📝 Build Follow Up Draft</button>
    `;

    // Bind dynamic event listeners
    document.getElementById('followUpProcessType')?.addEventListener('change', handleFollowUpProcessTypeChange);
    document.getElementById('sendFollowUpEmailBtn')?.addEventListener('click', sendFollowUpEmail);

    // Set default process and trigger auto-populate
    const processSelect = document.getElementById('followUpProcessType');
    if (processSelect && config.defaultProcess) {
        processSelect.value = config.defaultProcess;
        handleFollowUpProcessTypeChange();
    }
}

// ============================================
// EVENT HANDLERS
// ============================================

function handleFollowUpTodoTypeChange() {
    const todoType = document.getElementById('followUpTodoType')?.value || '';
    lastAutoDeclineReason = '';
    renderFollowUpFields(todoType);
}

function handleFollowUpProcessTypeChange() {
    const todoType = document.getElementById('followUpTodoType')?.value || '';
    const processTypeValue = document.getElementById('followUpProcessType')?.value || '';
    const processArea = document.getElementById('followUpProcess');
    const declineArea = document.getElementById('followUpDeclineReason');
    if (!processArea) return;

    const config = FOLLOW_UP_TODO_TYPES[todoType];
    if (!config) return;

    const option = config.processOptions.find(o => o.value === processTypeValue);

    if (!processTypeValue) {
        processArea.value = '';
        return;
    }

    if (processTypeValue === 'other') {
        if (!processArea.value.trim()) {
            processArea.value = 'Enter the correct process details for this follow-up.';
        }
    } else if (option) {
        processArea.value = option.process;
    }

    // Auto-populate decline reason if not user-edited
    if (declineArea && option) {
        const currentReason = declineArea.value.trim();
        if (!currentReason || currentReason === lastAutoDeclineReason) {
            declineArea.value = option.declineReason;
            lastAutoDeclineReason = option.declineReason;
        }
    }
}

// ============================================
// FOLLOW-UP PANEL MODE SWITCHING
// ============================================

function switchRedFlagMode(mode) {
    const showFollowUpBtn = document.getElementById('showFollowUpPanelBtn');
    const showSurveyBtn = document.getElementById('showSurveyFeedbackPanelBtn');
    const showRedFlagBtn = document.getElementById('showRedFlagPanelBtn');
    const followUpPanel = document.getElementById('followUpPanel');
    const followUpPreview = document.getElementById('followUpEmailPreviewSection');
    const followUpHistory = document.getElementById('followUpHistoryPanel');
    const surveyPanel = document.getElementById('surveyFeedbackPanel');
    const redFlagPanel = document.getElementById('redFlagPanel');

    const isFollowUp = mode === 'follow-up';
    const isSurvey = mode === 'survey-feedback';
    const isRedFlag = mode === 'red-flag';

    if (followUpPanel) followUpPanel.style.display = isFollowUp ? 'block' : 'none';
    if (isFollowUp) populateFollowUpAssociateDropdown();
    if (followUpPreview) {
        const hasPreview = Boolean(document.getElementById('followUpEmailPreviewText')?.textContent?.trim());
        followUpPreview.style.display = isFollowUp && hasPreview ? 'block' : 'none';
    }
    if (followUpHistory) {
        followUpHistory.style.display = isFollowUp ? 'block' : 'none';
        if (isFollowUp) renderFollowUpHistory();
    }
    if (surveyPanel) surveyPanel.style.display = isSurvey ? 'block' : 'none';
    if (redFlagPanel) redFlagPanel.style.display = isRedFlag ? 'block' : 'none';

    if (showFollowUpBtn) {
        showFollowUpBtn.style.background = isFollowUp ? '#ef6c00' : '#b0bec5';
        showFollowUpBtn.style.color = isFollowUp ? 'white' : '#263238';
    }
    if (showSurveyBtn) {
        showSurveyBtn.style.background = isSurvey ? '#546e7a' : '#b0bec5';
        showSurveyBtn.style.color = isSurvey ? 'white' : '#263238';
    }
    if (showRedFlagBtn) {
        showRedFlagBtn.style.background = isRedFlag ? '#dc3545' : '#b0bec5';
        showRedFlagBtn.style.color = isRedFlag ? '#263238' : 'white';
    }
}

function populateFollowUpAssociateDropdown() {
    const associateSelect = document.getElementById('followUpPersonName');
    if (!associateSelect) return;

    const previousValue = associateSelect.value;
    associateSelect.innerHTML = '<option value="">-- Select Associate --</option>';

    const weeklyData = window.DevCoachModules?.storage?.loadWeeklyData?.() || {};
    const employeeSet = new Set();

    Object.values(weeklyData).forEach(period => {
        if (!period || !Array.isArray(period.employees)) return;
        period.employees.forEach(employee => {
            const name = String(employee?.name || '').trim();
            if (name) {
                employeeSet.add(name);
            }
        });
    });

    Array.from(employeeSet).sort((a, b) => a.localeCompare(b)).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        associateSelect.appendChild(option);
    });

    if (previousValue && employeeSet.has(previousValue)) {
        associateSelect.value = previousValue;
    }
}

// ============================================
// EMAIL BUILDING
// ============================================

function buildApsEmailFromName(personName) {
    const normalizedParts = String(personName || '')
        .trim()
        .split(/\s+/)
        .map(part => part.replace(/[^a-zA-Z0-9'-]/g, ''))
        .filter(Boolean);

    if (normalizedParts.length === 0) return '';
    return `${normalizedParts.join('.').toLowerCase()}@aps.com`;
}

function sendFollowUpEmail() {
    const todoType = document.getElementById('followUpTodoType')?.value || '';
    const associateName = String(document.getElementById('followUpPersonName')?.value || '').trim();

    if (!todoType) {
        alert('⚠️ Please select a To-Do type.');
        return;
    }
    if (!associateName) {
        alert('⚠️ Please enter the associate name.');
        return;
    }

    const config = FOLLOW_UP_TODO_TYPES[todoType];
    if (!config) {
        alert('⚠️ Unsupported To-Do type.');
        return;
    }

    const todoLabel = config.label;
    const customerAccount = document.getElementById('followUpCustomerAccount')?.value.trim() || '';
    const customerName = document.getElementById('followUpCustomerName')?.value.trim() || '';
    const declineReason = document.getElementById('followUpDeclineReason')?.value.trim() || '';
    const processType = document.getElementById('followUpProcessType')?.value || '';
    const correctProcess = document.getElementById('followUpProcess')?.value.trim() || '';

    if (!customerName) {
        alert('⚠️ Please enter the customer name.');
        return;
    }
    if (!customerAccount) {
        alert('⚠️ Please enter the customer account number.');
        return;
    }
    if (!declineReason) {
        alert('⚠️ Please enter why the To-Do was declined.');
        return;
    }
    if (!processType) {
        alert('⚠️ Please select a correct process option.');
        return;
    }

    const toEmail = buildApsEmailFromName(associateName);
    if (!toEmail) {
        alert('⚠️ Could not build an APS email from the associate name. Please enter a valid first and last name.');
        return;
    }

    const subject = `Follow Up Needed: ${todoLabel} - ${customerName} (${customerAccount})`;
    const body = `Hi ${associateName},

Your ${todoLabel} To-Do for ${customerName} (Account ${customerAccount}) was declined.

What needs to be corrected:
${declineReason}

Correct process to follow:
${correctProcess}

Please complete these steps and submit a new To-Do with clear notes confirming what was verified.

Thank you.`;

    const previewText = `To: ${toEmail}\nSubject: ${subject}\n\n${body}`;
    const previewSection = document.getElementById('followUpEmailPreviewSection');
    const previewArea = document.getElementById('followUpEmailPreviewText');
    if (previewSection && previewArea) {
        previewArea.textContent = previewText;
        previewSection.style.display = 'block';
    }

    pendingFollowUpMailtoUrl = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    // Log to follow-up history
    logFollowUpEntry({
        associateName,
        todoType,
        todoLabel,
        processType,
        customerName,
        customerAccount,
        declineReason,
        correctProcess
    });
}

// ============================================
// FOLLOW-UP HISTORY
// ============================================

function loadFollowUpHistory() {
    return window.DevCoachModules?.storage?.loadFollowUpHistory?.() || { entries: [] };
}

function saveFollowUpHistory(data) {
    window.DevCoachModules?.storage?.saveFollowUpHistory?.(data);
}

function logFollowUpEntry(details) {
    const history = loadFollowUpHistory();
    if (!Array.isArray(history.entries)) {
        history.entries = [];
    }

    const entry = {
        id: `fu_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        associateName: details.associateName,
        todoType: details.todoType,
        todoLabel: details.todoLabel,
        processType: details.processType,
        customerName: details.customerName,
        customerAccount: details.customerAccount,
        declineReason: details.declineReason,
        correctProcess: details.correctProcess,
        sentAt: new Date().toISOString(),
        status: 'pending'
    };

    history.entries.unshift(entry);

    // Cap at 200 entries
    if (history.entries.length > 200) {
        history.entries = history.entries.slice(0, 200);
    }

    saveFollowUpHistory(history);
    renderFollowUpHistory();

    if (typeof queueCallListeningRepoSync === 'function') {
        queueCallListeningRepoSync('follow-up sent');
    }
}

function toggleFollowUpStatus(entryId) {
    const history = loadFollowUpHistory();
    if (!Array.isArray(history.entries)) return;

    const entry = history.entries.find(e => e.id === entryId);
    if (!entry) return;

    entry.status = entry.status === 'pending' ? 'resolved' : 'pending';
    saveFollowUpHistory(history);
    renderFollowUpHistory();

    if (typeof queueCallListeningRepoSync === 'function') {
        queueCallListeningRepoSync('follow-up status updated');
    }
}

function renderFollowUpHistory() {
    const panel = document.getElementById('followUpHistoryPanel');
    const listEl = document.getElementById('followUpHistoryList');
    const countEl = document.getElementById('followUpHistoryCount');
    if (!panel || !listEl) return;

    const history = loadFollowUpHistory();
    const entries = Array.isArray(history.entries) ? history.entries : [];

    if (entries.length === 0) {
        panel.style.display = 'none';
        return;
    }

    const filterValue = document.getElementById('followUpHistoryFilter')?.value || 'all';
    const filtered = filterValue === 'all' ? entries : entries.filter(e => e.status === filterValue);

    const pendingCount = entries.filter(e => e.status === 'pending').length;
    const resolvedCount = entries.filter(e => e.status === 'resolved').length;

    if (countEl) {
        countEl.textContent = `(${pendingCount} pending, ${resolvedCount} resolved)`;
    }

    panel.style.display = 'block';

    if (filtered.length === 0) {
        listEl.innerHTML = '<p style="color: #999; text-align: center; padding: 12px;">No follow-ups match this filter.</p>';
        return;
    }

    listEl.innerHTML = filtered.map(entry => {
        const date = entry.sentAt ? new Date(entry.sentAt).toLocaleDateString() : 'Unknown';
        const isPending = entry.status === 'pending';
        const statusColor = isPending ? '#ef6c00' : '#2e7d32';
        const statusBg = isPending ? '#fff3e0' : '#e8f5e9';
        const statusLabel = isPending ? 'Pending' : 'Resolved';
        const rowOpacity = isPending ? '1' : '0.75';
        const reasonPreview = String(entry.declineReason || '').slice(0, 80) + (String(entry.declineReason || '').length > 80 ? '...' : '');

        return `<div style="padding: 10px 12px; border-bottom: 1px solid #eee; opacity: ${rowOpacity}; display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center;">
            <div>
                <div style="font-weight: 600; color: #333; font-size: 0.95em;">${escapeHtml(entry.associateName)} — ${escapeHtml(entry.todoLabel || entry.todoType)}</div>
                <div style="font-size: 0.82em; color: #666; margin-top: 2px;">${escapeHtml(entry.customerName || '')} (${escapeHtml(entry.customerAccount || '')}) — ${date}</div>
                <div style="font-size: 0.8em; color: #888; margin-top: 2px; font-style: italic;">${escapeHtml(reasonPreview)}</div>
            </div>
            <button onclick="toggleFollowUpStatus('${entry.id}')" style="background: ${statusBg}; color: ${statusColor}; border: 1px solid ${statusColor}; border-radius: 999px; padding: 4px 12px; font-size: 0.8em; font-weight: 600; cursor: pointer; white-space: nowrap;">${statusLabel}</button>
        </div>`;
    }).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================
// EMAIL ACTIONS
// ============================================

function openFollowUpEmailDraft() {
    if (!pendingFollowUpMailtoUrl) {
        alert('⚠️ Build the follow up draft first.');
        return;
    }

    window.location.href = pendingFollowUpMailtoUrl;
}

function copyFollowUpEmail() {
    const emailText = document.getElementById('followUpEmailPreviewText')?.textContent || '';

    if (!emailText.trim()) {
        alert('⚠️ No follow up email to copy yet.');
        return;
    }

    const button = document.getElementById('copyFollowUpEmailBtn');
    navigator.clipboard.writeText(emailText).then(() => {
        if (!button) return;
        const originalText = button.textContent;
        button.textContent = '✓ Copied!';
        setTimeout(() => {
            button.textContent = originalText;
        }, 1200);
    }).catch(() => {
        alert('⚠️ Unable to copy email.');
    });
}

function clearFollowUpEmail() {
    const todoType = document.getElementById('followUpTodoType');
    const personName = document.getElementById('followUpPersonName');
    const previewSection = document.getElementById('followUpEmailPreviewSection');
    const previewText = document.getElementById('followUpEmailPreviewText');

    if (todoType) todoType.value = '';
    if (personName) personName.value = '';
    if (previewText) previewText.textContent = '';
    if (previewSection) previewSection.style.display = 'none';
    pendingFollowUpMailtoUrl = '';
    lastAutoDeclineReason = '';

    const container = document.getElementById('followUpDynamicFields');
    if (container) container.innerHTML = '';
}

// ============================================
// RED FLAG COACHING
// ============================================

function generateRedFlagEmail() {
    const associateName = document.getElementById('redFlagAssociateName').value.trim();
    const customerName = document.getElementById('redFlagCustomerName').value.trim();
    const accountNumber = document.getElementById('redFlagAccountNumber').value.trim();
    const reason = document.getElementById('redFlagReason').value.trim();

    if (!associateName) {
        alert('⚠️ Please enter the associate name.');
        return;
    }
    if (!customerName) {
        alert('⚠️ Please enter the customer name.');
        return;
    }
    if (!accountNumber) {
        alert('⚠️ Please enter the account number.');
        return;
    }
    if (!reason) {
        alert('⚠️ Please enter the red flag reason/details.');
        return;
    }

    const emailTemplate = generateRedFlagEmailTemplate(associateName, customerName, accountNumber, reason);
    document.getElementById('redFlagEmailPreviewText').textContent = emailTemplate;
    document.getElementById('redFlagEmailPreviewSection').style.display = 'block';
}

function generateRedFlagEmailTemplate(associateName, customerName, accountNumber, reason) {
    let specificIssue = '';

    if (reason.includes('JAH ADDED WITHOUT ID')) {
        specificIssue = 'An authorized user (JAH - Joint Account Holder) was added to the account without first receiving and verifying their picture ID as required by Experian.';
    } else if (reason.includes('COMPLETED ORDER') && reason.includes('WITHOUT')) {
        specificIssue = 'The order was completed without following required Experian verification procedures.';
    } else if (reason.includes('PICTURE ID') || reason.includes('ID REQUIRED')) {
        specificIssue = 'Required picture ID was not obtained before completing the account modification.';
    } else {
        specificIssue = reason;
    }

    const emailTemplate = `Subject: Important Coaching - Compliance with Experian Verification Procedures

Hi ${associateName},

I need to discuss an important compliance matter with you regarding customer ${customerName}, account #${accountNumber}.

Issue Identified:
${reason}

What Happened:
${specificIssue}

Why This Matters:
Following Experian verification procedures is critical for regulatory compliance, fraud prevention, and protecting both our customers and the company. When Experian flags an account for additional verification (such as requiring Picture ID), we must follow those requirements BEFORE completing any account changes.

Correct Procedure:

1. ALWAYS review Experian results carefully before proceeding
2. If Experian indicates "Picture ID Required" or requests additional information:
   - DO NOT add the authorized user (JAH) or complete the order yet
   - Place the order on HOLD
   - Inform the customer that we need the requested documentation
   - Explain what they need to send and how to send it
3. Once the required documents are received:
   - The team member who opens/receives the ID will verify it
   - Only after verification should the order be completed

Common Experian Flags to Watch For:
• Picture ID Required
• Additional Information Needed
• Manual Review Required
• Verification Pending

Expectation Going Forward:
I need you to carefully review ALL Experian results before completing any account modifications, especially when adding authorized users (JAH). If you're ever unsure about what action to take based on Experian's response, please ask a supervisor before proceeding.

This is a serious compliance matter that could result in fraud or regulatory penalties. I trust that you understand the importance of following these procedures consistently. Let's schedule a time to discuss this further and ensure you're comfortable with the verification process.

Please confirm you've received and understood this email.

Thank you,
Management Team`;

    return emailTemplate;
}

function copyRedFlagEmail() {
    const emailText = document.getElementById('redFlagEmailPreviewText').textContent;

    if (!emailText.trim()) {
        alert('⚠️ No email to copy. Please generate an email first.');
        return;
    }

    const button = document.getElementById('copyRedFlagEmailBtn');
    navigator.clipboard.writeText(emailText).then(() => {
        if (!button) return;
        const originalText = button.textContent;
        button.textContent = '✓ Copied! Opening Outlook...';

        setTimeout(() => {
            window.open('mailto:', '_blank');
            setTimeout(() => {
                button.textContent = originalText;
            }, 500);
        }, 500);
    }).catch(() => {
        alert('⚠️ Unable to copy email.');
    });
}

function clearRedFlagEmail() {
    document.getElementById('redFlagAssociateName').value = '';
    document.getElementById('redFlagCustomerName').value = '';
    document.getElementById('redFlagAccountNumber').value = '';
    document.getElementById('redFlagReason').value = '';

    document.getElementById('redFlagEmailPreviewSection').style.display = 'none';
    document.getElementById('redFlagEmailPreviewText').textContent = '';
}

// ============================================
// SURVEY FEEDBACK COACHING
// ============================================

function parseSurveyData() {
    const rawData = document.getElementById('surveyRawData')?.value.trim() || '';
    if (!rawData) {
        alert('⚠️ Please paste the raw survey ticket data first.');
        return;
    }

    const extracted = extractSurveyFields(rawData);
    displayExtractedSurveyData(extracted);
    generateSurveyPrompt(extracted);
}

function extractSurveyFields(raw) {
    const lines = raw.split('\n').map(l => l.trim());

    function findField(patterns) {
        for (const pattern of patterns) {
            for (const line of lines) {
                const regex = new RegExp(pattern + '\\s*[:\\-]?\\s*(.*)', 'i');
                const match = line.match(regex);
                if (match && match[1]?.trim()) return match[1].trim();
            }
        }
        return '';
    }

    function findMultilineField(patterns) {
        for (const pattern of patterns) {
            for (let i = 0; i < lines.length; i++) {
                const regex = new RegExp(pattern, 'i');
                if (regex.test(lines[i])) {
                    const sameLine = lines[i].replace(regex, '').replace(/^[\s:\-]+/, '').trim();
                    if (sameLine) return sameLine;
                    // Grab next non-empty lines
                    const collected = [];
                    for (let j = i + 1; j < lines.length && j < i + 5; j++) {
                        if (!lines[j]) break;
                        // Stop if it looks like another field label
                        if (/^[A-Z][a-z].*:/.test(lines[j]) && !lines[j].startsWith(' ')) break;
                        collected.push(lines[j]);
                    }
                    if (collected.length) return collected.join(' ');
                }
            }
        }
        return '';
    }

    return {
        associateName: findField(['Associate Name', 'Advisor Name', 'Agent Name', 'Rep Name']),
        associateId: findField(['Associate ID', 'Advisor ID', 'Agent ID', 'Rep ID', 'Employee ID']),
        supervisorName: findField(['Supervisor', 'Leader Name', 'Supervisor\\/Leader', 'Manager Name', 'Team Lead']),
        accountId: findField(['Account ID', 'Account Number', 'Account #', 'Acct ID', 'Account No']),
        customerContactId: findField(['Customer Contact ID', 'Contact ID', 'Interaction ID', 'Case ID']),
        contactDate: findField(['Contact Date', 'Date of Contact', 'Call Date', 'Interaction Date', 'Survey Date']),
        overallRating: findField(['Overall Experience Rating', 'Overall Rating', 'Experience Rating', 'Overall Experience', 'OSAT', 'Overall Satisfaction']),
        mainReason: findField(['Main Reason', 'Primary Reason', 'Reason for Contact', 'Contact Reason', 'Main Reason for Contact']),
        specificReason: findField(['Specific Reason', 'Sub Reason', 'Detail Reason', 'Specific Reason for Contact']),
        issueResolved: findField(['Was the Issue Resolved', 'Issue Resolved', 'Resolved', 'Was Issue Resolved', 'Resolution']),
        fcrScore: findField(['FCR Score', 'First Contact Resolution', 'FCR', 'First Call Resolution']),
        customerWords: findMultilineField(['Customer.s Own Words', 'Customer Comment', 'Verbatim', 'Open.?Ended Comment', 'Customer Feedback', 'Comments?']),
        keyFailures: findMultilineField(['Key Failures? Observed', 'Failures? Observed', 'Key Failure', 'Areas? of Improvement', 'Coaching Opportunity', 'Failure Points?'])
    };
}

function displayExtractedSurveyData(data) {
    const section = document.getElementById('surveyExtractedSection');
    const fieldsEl = document.getElementById('surveyExtractedFields');
    if (!section || !fieldsEl) return;

    const fields = [
        { label: 'Associate Name', value: data.associateName },
        { label: 'Associate ID', value: data.associateId },
        { label: 'Supervisor/Leader Name', value: data.supervisorName },
        { label: 'Account ID', value: data.accountId },
        { label: 'Customer Contact ID', value: data.customerContactId },
        { label: 'Contact Date', value: data.contactDate },
        { label: 'Overall Experience Rating', value: data.overallRating },
        { label: 'Main Reason for Contact', value: data.mainReason },
        { label: 'Specific Reason for Contact', value: data.specificReason },
        { label: 'Was the Issue Resolved?', value: data.issueResolved },
        { label: 'FCR Score', value: data.fcrScore },
        { label: "Customer's Own Words", value: data.customerWords },
        { label: 'Key Failures Observed', value: data.keyFailures }
    ];

    fieldsEl.innerHTML = fields.map(f => {
        const val = f.value || '<span style="color: #e65100; font-style: italic;">Not found — edit below if needed</span>';
        const isPresent = Boolean(f.value);
        return `<div style="margin-bottom: 6px;"><strong style="color: #37474f;">${escapeHtml(f.label)}:</strong> ${isPresent ? escapeHtml(val) : val}</div>`;
    }).join('');

    section.style.display = 'block';
}

function generateSurveyPrompt(data) {
    const supervisor = data.supervisorName || '[Supervisor Name]';
    const associate = data.associateName || '[Associate Name]';
    const contactDate = data.contactDate || '[Contact Date]';
    const rating = data.overallRating || '[Overall Rating]';
    const mainReason = data.mainReason || '[Main Reason]';
    const specificReason = data.specificReason || '[Specific Reason]';
    const resolved = data.issueResolved || 'not resolved';
    const customerWords = data.customerWords || '[Customer Comments]';
    const failures = data.keyFailures || '[Key Failures Observed]';

    const resolvedText = resolved.toLowerCase().includes('yes') ? 'The issue was resolved.' : 'The issue was not resolved.';

    const prompt = `Write a professional coaching email from supervisor ${supervisor} to advisor ${associate} regarding a customer survey received on ${contactDate}. The customer rated their experience ${rating}. The customer contacted APS regarding ${mainReason} - ${specificReason}. ${resolvedText} The customer stated: "${customerWords}". The coaching focus should be on ${failures}. For each failure observed, include specific, actionable steps the advisor should take in future calls to prevent this from happening again. For example, if the advisor did not recap the call, instruct them to always summarize the interaction and next steps before ending the call. If the customer felt unheard, instruct the advisor to use active listening techniques such as repeating the customer's concern back to them before offering a solution. The tone should be supportive, direct, and professional — focused on growth and improvement, not punishment.`;

    const promptDisplay = document.getElementById('surveyPromptDisplay');
    const promptSection = document.getElementById('surveyPromptSection');

    if (promptDisplay) promptDisplay.value = prompt;
    if (promptSection) promptSection.style.display = 'block';
}

function copySurveyPromptAndOpenCopilot() {
    const promptDisplay = document.getElementById('surveyPromptDisplay');
    if (!promptDisplay?.value) return;

    navigator.clipboard.writeText(promptDisplay.value).then(() => {
        if (typeof showToast === 'function') {
            showToast('✅ Prompt copied! Opening Copilot...', 2000);
        }
        window.open('https://copilot.microsoft.com', '_blank');
    }).catch(() => {
        promptDisplay.select();
        alert('⚠️ Unable to copy. Please select and copy manually.');
    });
}

function clearSurveyFeedback() {
    const rawData = document.getElementById('surveyRawData');
    const extractedSection = document.getElementById('surveyExtractedSection');
    const promptSection = document.getElementById('surveyPromptSection');
    const promptDisplay = document.getElementById('surveyPromptDisplay');

    if (rawData) rawData.value = '';
    if (promptDisplay) promptDisplay.value = '';
    if (extractedSection) extractedSection.style.display = 'none';
    if (promptSection) promptSection.style.display = 'none';
}
