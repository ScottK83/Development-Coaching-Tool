(function() {
    'use strict';

    function generateVerintSummary(context = {}) {
        const doc = context.document || document;
        const nav = context.navigator || navigator;
        const showToast = context.showToast || function() {};
        const toNonEmptyString = window.DevCoachModules?.sharedUtils?.toNonEmptyString || ((value) => (typeof value === 'string' ? value.trim() : ''));
        const joinWithConjunction = window.DevCoachModules?.sharedUtils?.joinWithConjunction || ((items) => (Array.isArray(items) ? items.filter(Boolean).join(', ') : ''));

        const employeeSelect = doc.getElementById('employeeSelect');
        const selectedEmployeeId = employeeSelect?.value;
        const employeeName = toNonEmptyString(doc.getElementById('employeeName')?.value);

        if (!selectedEmployeeId) {
            context.alert?.('⚠️ Please select an employee first');
            return;
        }

        if (employeeName) {
            context.saveNickname?.(selectedEmployeeId, employeeName);
        }

        const history = context.getCoachingHistoryForEmployee?.(selectedEmployeeId) || [];

        if (history.length > 0) {
            const cleanLabel = (item) => {
                if (!item) return '';
                const match = item.match(/^\-\s*(.+?):/);
                if (match) return match[1].trim();
                return item.replace(/^-/, '').split(':')[0].trim();
            };

            const firstName = context.getEmployeeNickname?.(selectedEmployeeId) || selectedEmployeeId.split(' ')[0];

            const latestSession = history[0];
            const date = new Date(latestSession.generatedAt).toLocaleDateString();
            const winsLabels = (latestSession.celebrate || []).map(cleanLabel).filter(Boolean);
            const oppLabels = (latestSession.needsCoaching || []).map(cleanLabel).filter(Boolean);

            let verintText = `Coaching Session with ${firstName} - ${date}\n\n`;

            if (winsLabels.length > 0) {
                verintText += `I recognized ${firstName} for their strong performance in ${joinWithConjunction(winsLabels)}.`;
                verintText += ' Encouraged them to keep up the great work in these areas.\n\n';
            } else {
                verintText += `We discussed ${firstName}'s current performance and acknowledged their efforts to improve.\n\n`;
            }

            if (oppLabels.length > 0) {
                verintText += `We reviewed development opportunities in ${joinWithConjunction(oppLabels)}`;
                verintText += `. We discussed specific strategies and tips to help improve performance in these metrics. ${firstName} acknowledged the feedback and committed to implementing the discussed improvements.\n\n`;
            }

            verintText += 'Action Items:\n';
            if (oppLabels.length > 0) {
                oppLabels.forEach(metric => {
                    verintText += `• Focus on improving ${metric}\n`;
                });
            } else {
                verintText += '• Continue current performance level\n';
            }

            verintText += '\nNext Steps: Follow up next week to review progress and provide additional support as needed.';

            if (history.length > 1) {
                verintText += `\n\n--- Previous Coaching Sessions: ${history.length - 1} ---`;
            }

            const outputElement = doc.getElementById('verintSummaryOutput');
            if (outputElement) outputElement.value = verintText;

            const summarySection = doc.getElementById('verintSummarySection');
            if (summarySection) summarySection.style.display = 'block';

            nav.clipboard.writeText(verintText).then(() => {
                showToast('✅ Verint coaching notes copied to clipboard!', 3000);
            }).catch(err => {
                context.console?.error?.('Failed to copy:', err);
                showToast('⚠️ Failed to copy. Text is displayed above.', 3000);
            });
        } else {
            const outputElement = doc.getElementById('verintSummaryOutput');
            if (outputElement) outputElement.value = `No coaching history found for ${selectedEmployeeId}. Generate a coaching email first.`;
            const summarySection = doc.getElementById('verintSummarySection');
            if (summarySection) summarySection.style.display = 'block';
        }
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.copilotPrompt = {
        generateVerintSummary
    };
})();
