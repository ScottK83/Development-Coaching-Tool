(function() {
    'use strict';

    async function generateCopilotPrompt(context = {}) {
        const doc = context.document || document;
        const win = context.window || window;
        const nav = context.navigator || navigator;
        const showToast = context.showToast || function() {};

        const employeeName = doc.getElementById('employeeName')?.value;
        const employeeSelect = doc.getElementById('employeeSelect');
        const selectedEmployeeId = employeeSelect?.value;
        const firstName = (employeeName || '').split(' ')[0] || employeeName || (selectedEmployeeId ? selectedEmployeeId.split(' ')[0] : '');

        if (!firstName) {
            context.alert?.('⚠️ Please select an employee first');
            return;
        }

        if (!selectedEmployeeId) {
            context.alert?.('⚠️ Please select an employee first');
            return;
        }

        if (selectedEmployeeId && employeeName) {
            context.saveNickname?.(selectedEmployeeId, employeeName.trim());
        }

        const employeeData = context.getEmployeeDataForPeriod?.(selectedEmployeeId);
        if (!employeeData) {
            context.alert?.('⚠️ Unable to load metrics for this employee. Please reload data.');
            return;
        }

        const periodContext = context.getActivePeriodContext?.() || {};
        const periodLabel = periodContext.periodLabel;
        const timeReference = periodContext.timeReference;
        const coachingEval = context.evaluateMetricsForCoaching?.(employeeData) || {};
        const celebrate = coachingEval.celebrate || [];
        const needsCoaching = coachingEval.needsCoaching || [];
        const coachedMetricKeys = coachingEval.coachedMetricKeys || [];

        const metadataSource = context.currentPeriodType === 'ytd' ? context.ytdData : context.weeklyData;
        const metadata = context.currentPeriod && metadataSource?.[context.currentPeriod]?.metadata
            ? metadataSource[context.currentPeriod].metadata
            : null;
        const timeframeKey = metadata ? `${metadata.startDate}_${metadata.endDate}` : null;

        const allTips = await (context.loadServerTips?.() || Promise.resolve({}));

        const metricKeyMap = {
            'Schedule Adherence': 'scheduleAdherence',
            'CX Rep Overall': 'cxRepOverall',
            'First Call Resolution': 'fcr',
            'Overall Experience': 'overallExperience',
            'Transfers': 'transfers',
            'Overall Sentiment': 'overallSentiment',
            'Positive Word': 'positiveWord',
            'Avoid Negative Word': 'negativeWord',
            'Managing Emotions': 'managingEmotions',
            'Avg Handle Time': 'aht',
            'After Call Work': 'acw',
            'Hold Time': 'holdTime',
            'Reliability': 'reliability'
        };

        const customNotes = doc.getElementById('customNotes')?.value.trim();

        let winsSection = `WINS (What ${firstName} Achieved):\n`;
        if (celebrate.length > 0) {
            celebrate.forEach(item => winsSection += `${item}\n`);
        } else {
            winsSection += '(none)\n';
        }

        let opportunitiesSection = 'OPPORTUNITIES (Areas to Improve):\n';
        const coachingContextLines = [];

        if (needsCoaching.length > 0) {
            needsCoaching.forEach(item => {
                opportunitiesSection += `${item}\n`;
                const metricMatch = item.match(/^- (.+?):/);
                if (!metricMatch) return;

                const metricLabel = metricMatch[1];
                const metricKey = metricKeyMap[metricLabel];
                if (!metricKey) return;

                const metricValue = employeeData[metricKey];
                const severity = context.getMetricSeverity?.(metricKey, metricValue);
                const metricTips = allTips[metricKey] || [];
                const smartTip = context.selectSmartTip?.({
                    employeeId: selectedEmployeeId,
                    metricKey,
                    severity,
                    tips: metricTips
                });

                if (smartTip) {
                    opportunitiesSection += `  TIP: ${smartTip}\n`;
                }

                const associateSnapshots = context.associateSentimentSnapshots || {};
                if (timeframeKey && associateSnapshots[selectedEmployeeId]?.[timeframeKey]) {
                    const sentimentData = associateSnapshots[selectedEmployeeId][timeframeKey];

                    if (metricKey === 'positiveWord' && sentimentData.positive?.phrases?.length > 0) {
                        const topPhrases = sentimentData.positive.phrases
                            .slice(0, 5)
                            .map(p => `"${p.phrase}" (${p.value}x)`)
                            .join(', ');
                        opportunitiesSection += `  YOUR POSITIVE PHRASES: ${topPhrases}. Use these on EVERY call to reach 100%!\n`;
                    }

                    if (metricKey === 'negativeWord' && sentimentData.negative?.phrases?.length > 0) {
                        const topPhrases = sentimentData.negative.phrases
                            .slice(0, 5)
                            .map(p => `"${p.phrase}" (${p.value}x)`)
                            .join(', ');
                        opportunitiesSection += `  NEGATIVE PHRASES TO ELIMINATE: ${topPhrases}. Avoid using these.\n`;
                    }

                    if (metricKey === 'managingEmotions' && sentimentData.emotions?.phrases?.length > 0) {
                        const topPhrases = sentimentData.emotions.phrases
                            .slice(0, 5)
                            .map(p => `"${p.phrase}" (${p.value}x)`)
                            .join(', ');
                        opportunitiesSection += `  EMOTION INDICATORS: ${topPhrases}. Focus on staying composed when these arise.\n`;
                    }
                }

                const contextLine = context.getCoachingContext?.(selectedEmployeeId, metricKey, metricValue);
                if (contextLine) coachingContextLines.push(contextLine);
            });
        } else {
            opportunitiesSection += '(none)\n';
        }

        const reliabilityMetric = needsCoaching.find(item => item.includes('Reliability'));
        let reliabilityHours = null;

        if (reliabilityMetric) {
            const hoursMatch = reliabilityMetric.match(/(\d+\.?\d*)\s*hrs?/);
            const parsedHours = hoursMatch?.[1] ? parseFloat(hoursMatch[1]) : NaN;
            reliabilityHours = Number.isFinite(parsedHours) ? parsedHours : employeeData.reliability;
            opportunitiesSection += `\nRELIABILITY NOTE:\nYou have ${reliabilityHours} hours listed as unscheduled/unplanned time. Please check Verint to make sure this aligns with any time missed ${timeReference} that was unscheduled. If this is an error, please let me know.\n`;
        }

        const confidenceInsight = context.buildConfidenceInsight?.(employeeData, coachedMetricKeys);
        let supervisorContext = '';
        if (coachingContextLines.length || confidenceInsight) {
            supervisorContext = '\nSUPERVISOR CONTEXT (use naturally, do not copy verbatim):\n';
            coachingContextLines.forEach(line => supervisorContext += `- ${line}\n`);
            if (confidenceInsight) supervisorContext += `- ${confidenceInsight}\n`;
        }

        const complianceFlags = context.detectComplianceFlags?.(customNotes) || [];
        if (complianceFlags.length > 0) {
            supervisorContext += `\nCOMPLIANCE FLAG: ${complianceFlags.join(', ')}. Please document and follow policy.\n`;
            context.logComplianceFlag?.({
                employeeId: selectedEmployeeId,
                flag: complianceFlags.join(', '),
                timestamp: new Date().toISOString()
            });
        }

        win.latestCoachingSummaryData = {
            firstName,
            periodLabel,
            celebrate,
            needsCoaching,
            reliabilityHours,
            customNotes,
            timeReference
        };

        let additionalContext = '';
        if (customNotes) {
            additionalContext = `\nADDITIONAL CONTEXT:\n${customNotes}\n`;
        }

        const prompt = `I'm a supervisor preparing a coaching email for an employee named ${firstName} for their ${periodLabel} performance review. I need your help drafting this in a natural, warm tone - not corporate or template-like.

Here's the performance data:

${winsSection}

${opportunitiesSection}${additionalContext}${supervisorContext}

Can you help me write an email to ${firstName} with this structure:

1. Warm, conversational greeting

2. WINS section:
   - Brief intro line
    - Bullets in this concise format: "• Metric Name - Goal X%. You were at Y%."
   - After bullets: A paragraph celebrating their achievements and encouraging them to keep it up

3. OPPORTUNITIES section:
   - Brief supportive intro line
    - Bullets in this format: "• Metric Name - Goal X%. You were at Y%."
    - Note: If Reliability is included, format as: "• Reliability - X hours unscheduled" (no goal needed)
   - After bullets: A paragraph with coaching tips (reword the tips naturally so they don't sound templated). Be constructive and supportive. If there's a reliability note, weave it in naturally here.

4. Warm close inviting them to discuss

Keep it conversational, upbeat, and motivating. Use "you" language. Avoid corporate buzzwords and any mention of AI or analysis. Make this sound like a genuine supervisor who cares about their success.

Vary your wording and sentence structure so it doesn't sound templated or AI-generated. Use natural phrasing and avoid repeating the same patterns.

Add emojis throughout the email to make it fun and engaging! Use them in the greeting, with wins, with opportunities, and in the closing. Make it feel warm and approachable.

Do NOT use em dashes (—) anywhere in the email.

Use the % symbol instead of writing out "percent" (e.g., "95%" not "95 percent").

The email should be ready to send as-is. Just give me the complete email to ${firstName}, nothing else.`;

        nav.clipboard.writeText(prompt).then(() => {
            context.alert?.('Ctrl+V and Enter to paste.\nThen copy the next screen and come back to this window.');
            win.open('https://copilot.microsoft.com', '_blank');
            doc.getElementById('copilotOutputSection').style.display = 'block';
            doc.getElementById('copilotOutputSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            showToast('✅ Prompt copied! Paste into CoPilot, then paste the result back here.');
        }).catch(err => {
            context.console?.error?.('Failed to copy:', err);
            context.alert?.('⚠️ Failed to copy prompt to clipboard. Please try again.');
        });
    }

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
                verintText += `I recognized ${firstName} for their strong performance in ${joinWithConjunction(winsLabels)} `;
                verintText += '. Encouraged them to keep up the great work in these areas.\n\n';
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
            outputElement.value = verintText;

            doc.getElementById('verintSummarySection').style.display = 'block';

            nav.clipboard.writeText(verintText).then(() => {
                showToast('✅ Verint coaching notes copied to clipboard!', 3000);
            }).catch(err => {
                context.console?.error?.('Failed to copy:', err);
                showToast('⚠️ Failed to copy. Text is displayed above.', 3000);
            });
        } else {
            const outputElement = doc.getElementById('verintSummaryOutput');
            outputElement.value = `No coaching history found for ${selectedEmployeeId}. Generate a coaching email first.`;
            doc.getElementById('verintSummarySection').style.display = 'block';
        }
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.copilotPrompt = {
        generateCopilotPrompt,
        generateVerintSummary
    };
})();
