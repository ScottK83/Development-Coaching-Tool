// ============================================
// RED FLAG COACHING FUNCTIONALITY
// ============================================

function initializeRedFlag() {
    document.getElementById('generateRedFlagEmailBtn')?.addEventListener('click', generateRedFlagEmail);
    document.getElementById('copyRedFlagEmailBtn')?.addEventListener('click', copyRedFlagEmail);
    document.getElementById('clearRedFlagEmailBtn')?.addEventListener('click', clearRedFlagEmail);
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
