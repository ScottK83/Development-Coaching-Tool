// ============================================
// RED FLAG COACHING FUNCTIONALITY
// ============================================

function initializeRedFlag() {
    document.getElementById('generateRedFlagEmailBtn')?.addEventListener('click', generateRedFlagEmail);
    document.getElementById('copyRedFlagEmailBtn')?.addEventListener('click', copyRedFlagEmail);
    document.getElementById('clearRedFlagEmailBtn')?.addEventListener('click', clearRedFlagEmail);

    document.getElementById('followUpTodoType')?.addEventListener('change', handleFollowUpTodoTypeChange);
    document.getElementById('showFollowUpPanelBtn')?.addEventListener('click', () => switchRedFlagMode('follow-up'));
    document.getElementById('showRedFlagPanelBtn')?.addEventListener('click', () => switchRedFlagMode('red-flag'));
    document.getElementById('sendFollowUpEmailBtn')?.addEventListener('click', sendFollowUpEmail);
    document.getElementById('openFollowUpEmailBtn')?.addEventListener('click', openFollowUpEmailDraft);
    document.getElementById('copyFollowUpEmailBtn')?.addEventListener('click', copyFollowUpEmail);
    document.getElementById('clearFollowUpEmailBtn')?.addEventListener('click', clearFollowUpEmail);

    switchRedFlagMode('follow-up');
    handleFollowUpTodoTypeChange();
}

const REFUND_CHECK_REVIEW_PROCESS = `Rep didn’t verify in the To-Do that the mailing address was updated/verified in CCB. They are unable to proceed until this is validated.

Next, submit a new To-Do clearly stating that you verified where the refund check will be mailed.

To validate the address, open the person record (the account may be inactive), then go to Correspondence Info. If no mailing address is listed, confirm the correct mailing address directly with the customer before resubmitting.`;

let pendingFollowUpMailtoUrl = '';

function switchRedFlagMode(mode) {
    const showFollowUpBtn = document.getElementById('showFollowUpPanelBtn');
    const showRedFlagBtn = document.getElementById('showRedFlagPanelBtn');
    const followUpPanel = document.getElementById('followUpPanel');
    const followUpPreview = document.getElementById('followUpEmailPreviewSection');
    const redFlagPanel = document.getElementById('redFlagPanel');

    const isFollowUp = mode !== 'red-flag';

    if (followUpPanel) {
        followUpPanel.style.display = isFollowUp ? 'block' : 'none';
    }
    if (followUpPreview) {
        const hasPreview = Boolean(document.getElementById('followUpEmailPreviewText')?.textContent?.trim());
        followUpPreview.style.display = isFollowUp && hasPreview ? 'block' : 'none';
    }
    if (redFlagPanel) {
        redFlagPanel.style.display = isFollowUp ? 'none' : 'block';
    }

    if (showFollowUpBtn) {
        showFollowUpBtn.style.background = isFollowUp ? '#ef6c00' : '#b0bec5';
        showFollowUpBtn.style.color = isFollowUp ? 'white' : '#263238';
    }
    if (showRedFlagBtn) {
        showRedFlagBtn.style.background = isFollowUp ? '#b0bec5' : '#dc3545';
        showRedFlagBtn.style.color = isFollowUp ? '#263238' : 'white';
    }
}

function handleFollowUpTodoTypeChange() {
    const todoType = document.getElementById('followUpTodoType')?.value || '';
    const refundFields = document.getElementById('refundCheckReviewFields');
    const processArea = document.getElementById('followUpProcess');

    if (!refundFields || !processArea) return;

    const isRefundCheckReview = todoType === 'refund-check-review';
    refundFields.style.display = isRefundCheckReview ? 'block' : 'none';

    if (isRefundCheckReview) {
        processArea.value = REFUND_CHECK_REVIEW_PROCESS;
    } else {
        processArea.value = '';
    }
}

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
    const personName = document.getElementById('followUpPersonName')?.value.trim() || '';
    const customerAccount = document.getElementById('followUpCustomerAccount')?.value.trim() || '';
    const customerName = document.getElementById('followUpCustomerName')?.value.trim() || '';
    const customerEmail = document.getElementById('followUpCustomerEmail')?.value.trim() || '';
    const declineReason = document.getElementById('followUpDeclineReason')?.value.trim() || '';
    const correctProcess = document.getElementById('followUpProcess')?.value.trim() || '';

    if (todoType !== 'refund-check-review') {
        alert('⚠️ Please select "Refund Check Review" as the To-Do type.');
        return;
    }
    if (!personName) {
        alert('⚠️ Please enter the person name.');
        return;
    }
    if (!customerName) {
        alert('⚠️ Please enter the customer name.');
        return;
    }
    if (!customerEmail) {
        alert('⚠️ Please enter the customer email.');
        return;
    }
    if (!declineReason) {
        alert('⚠️ Please enter why the To-Do was declined.');
        return;
    }

    const toEmail = buildApsEmailFromName(personName);
    if (!toEmail) {
        alert('⚠️ Could not build an APS email from the person name. Please enter a valid first and last name.');
        return;
    }

    const subject = `Follow Up Required: Refund Check Review - ${customerName}`;
    const body = `Hi ${personName},

Your Refund Check Review To-Do was denied.

Customer Information:
- Customer Name: ${customerName}
- Customer Account: ${customerAccount || 'Not provided'}
- Customer Email: ${customerEmail}

Reason for Denial:
${declineReason}

Correct Process:
${correctProcess}

Please complete the required validation steps and submit a new To-Do once confirmed.

Thank you.`;

    const previewText = `To: ${toEmail}\nSubject: ${subject}\n\n${body}`;
    const previewSection = document.getElementById('followUpEmailPreviewSection');
    const previewArea = document.getElementById('followUpEmailPreviewText');
    if (previewSection && previewArea) {
        previewArea.textContent = previewText;
        previewSection.style.display = 'block';
    }

    pendingFollowUpMailtoUrl = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

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

    const textarea = document.createElement('textarea');
    textarea.value = emailText;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    const button = document.getElementById('copyFollowUpEmailBtn');
    if (!button) return;

    const originalText = button.textContent;
    button.textContent = '✓ Copied!';
    setTimeout(() => {
        button.textContent = originalText;
    }, 1200);
}

function clearFollowUpEmail() {
    const todoType = document.getElementById('followUpTodoType');
    const personName = document.getElementById('followUpPersonName');
    const customerAccount = document.getElementById('followUpCustomerAccount');
    const customerName = document.getElementById('followUpCustomerName');
    const customerEmail = document.getElementById('followUpCustomerEmail');
    const declineReason = document.getElementById('followUpDeclineReason');
    const processArea = document.getElementById('followUpProcess');
    const previewSection = document.getElementById('followUpEmailPreviewSection');
    const previewText = document.getElementById('followUpEmailPreviewText');

    if (todoType) todoType.value = '';
    if (personName) personName.value = '';
    if (customerAccount) customerAccount.value = '';
    if (customerName) customerName.value = '';
    if (customerEmail) customerEmail.value = '';
    if (declineReason) declineReason.value = '';
    if (processArea) processArea.value = '';
    if (previewText) previewText.textContent = '';
    if (previewSection) previewSection.style.display = 'none';
    pendingFollowUpMailtoUrl = '';

    handleFollowUpTodoTypeChange();
}

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

    const textarea = document.createElement('textarea');
    textarea.value = emailText;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);

    const button = document.getElementById('copyRedFlagEmailBtn');
    const originalText = button.textContent;
    button.textContent = '✓ Copied! Opening Outlook...';

    setTimeout(() => {
        window.open('mailto:', '_blank');
        setTimeout(() => {
            button.textContent = originalText;
        }, 500);
    }, 500);
}

function clearRedFlagEmail() {
    document.getElementById('redFlagAssociateName').value = '';
    document.getElementById('redFlagCustomerName').value = '';
    document.getElementById('redFlagAccountNumber').value = '';
    document.getElementById('redFlagReason').value = '';

    document.getElementById('redFlagEmailPreviewSection').style.display = 'none';
    document.getElementById('redFlagEmailPreviewText').textContent = '';
}
