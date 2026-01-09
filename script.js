// Target metrics for comparison
const TARGETS = {
    reliability: {
        safetyHazards: 0,
        accComplaints: 0,
        phishingClicks: 0,
        redFlags: 0,
        depositWaiver: 0
    },
    driver: {
        scheduleAdherence: { min: 93 },
        cxRepOverall: { min: 80 },
        fcr: { min: 70 },
        transfers: { max: 6 },
        overallSentiment: { min: 88 },
        positiveWord: { min: 86 },
        negativeWord: { max: 17 },
        managingEmotions: { min: 95 },
        aht: { max: 440 },
        acw: { max: 60 },
        holdTime: { max: 30 },
        reliability: { max: 16 }
    }
};

// Custom tips loaded from CSV
let customTips = {};

// Improvement tips for each metric (fallback if no CSV loaded)
const IMPROVEMENT_TIPS = {
    scheduleAdherence: "Schedule Adherence: Focus on being present for all scheduled shifts. This is foundational to your team relying on you.",
    cxRepOverall: "Customer Experience: Every interaction is an opportunity to exceed expectations. Work on consistency and attention to detail.",
    fcr: "First Call Resolution: Before transferring, confirm you've exhausted available resources. Take time to understand the full issue first.",
    transfers: "Transfers: Reduce transfers by building your product knowledge and taking time to fully understand customer needs before responding.",
    overallSentiment: "Overall Sentiment: Let your enthusiasm for helping customers shine through. Your tone sets the temperature for the conversation.",
    positiveWord: "Positive Word Choice: Use constructive language. Say 'Let me find out' instead of 'I don't know' to maintain customer confidence.",
    negativeWord: "Negative Word Choice: Avoid language that sounds dismissive. Replace 'You'll have to...' with 'Let me help you...'",
    managingEmotions: "Managing Emotions: You're doing great here! Keep maintaining composure even during challenging interactions.",
    aht: "Average Handle Time: Focus on efficiency without rushing. Prepare your responses, but don't skip necessary steps.",
    acw: "After Call Work: Complete your documentation promptly. This keeps you available for the next customer and maintains accuracy.",
    holdTime: "Hold Time: Minimize hold time by gathering information upfront. It improves customer experience and efficiency.",
    reliability: "Reliability: Your availability is crucial. Work toward reducing unexpected absences and maintaining consistent attendance."
};

// Pronouns handling
// Generate email subject and body
function generateEmailContent(employeeName, coachingEmail) {
    const firstName = employeeName.trim().split(' ')[0];
    const subject = `Development Coaching - ${firstName}'s Performance Review`;
    
    return {
        subject: subject,
        body: coachingEmail
    };
}

// Load and parse CSV tips file
function loadCustomTips(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const csv = e.target.result;
                const lines = csv.split('\n').map(line => line.trim()).filter(line => line);
                
                // Skip header row
                const dataLines = lines.slice(1);
                
                // Parse CSV and group by metric
                const tips = {};
                dataLines.forEach(line => {
                    // Simple CSV parser (handles quotes)
                    const match = line.match(/^([^,]+),"?([^"]*)"?$/);
                    if (match) {
                        const metric = match[1].trim();
                        const tip = match[2].trim();
                        
                        if (!tips[metric]) {
                            tips[metric] = [];
                        }
                        tips[metric].push(tip);
                    }
                });
                
                resolve(tips);
            } catch (error) {
                reject(error);
            }
        };
        
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

// Get random tip for a metric
function getRandomTip(metric) {
    // First check custom tips
    if (customTips[metric] && customTips[metric].length > 0) {
        const tips = customTips[metric];
        const randomTip = tips[Math.floor(Math.random() * tips.length)];
        return randomTip;
    }
    
    // Fallback to default tips
    return IMPROVEMENT_TIPS[metric] || `Focus on improving ${metric}`;
}

// Identify struggling areas
function identifyStrugglingAreas(metrics) {
    const struggling = [];
    
    // Check driver metrics
    const driverMetrics = [
        { key: 'scheduleAdherence', value: metrics.scheduleAdherence, target: TARGETS.driver.scheduleAdherence },
        { key: 'cxRepOverall', value: metrics.cxRepOverall, target: TARGETS.driver.cxRepOverall },
        { key: 'fcr', value: metrics.fcr, target: TARGETS.driver.fcr },
        { key: 'transfers', value: metrics.transfers, target: TARGETS.driver.transfers },
        { key: 'overallSentiment', value: metrics.overallSentiment, target: TARGETS.driver.overallSentiment },
        { key: 'positiveWord', value: metrics.positiveWord, target: TARGETS.driver.positiveWord },
        { key: 'negativeWord', value: metrics.negativeWord, target: TARGETS.driver.negativeWord },
        { key: 'managingEmotions', value: metrics.managingEmotions, target: TARGETS.driver.managingEmotions },
        { key: 'aht', value: metrics.aht, target: TARGETS.driver.aht },
        { key: 'acw', value: metrics.acw, target: TARGETS.driver.acw },
        { key: 'holdTime', value: metrics.holdTime, target: TARGETS.driver.holdTime },
        { key: 'reliability', value: metrics.reliability, target: TARGETS.driver.reliability }
    ];

    driverMetrics.forEach(metric => {
        const target = metric.target;
        const isMin = 'min' in target;
        
        if (isMin && metric.value < target.min) {
            struggling.push(metric.key);
        } else if (!isMin && metric.value > target.max) {
            struggling.push(metric.key);
        }
    });

    return struggling;
}

// History tracking functions
function getEmployeeHistory(employeeName) {
    const history = JSON.parse(localStorage.getItem('coachingHistory') || '{}');
    return history[employeeName] || [];
}

function saveToHistory(employeeName, emailContent, openingIndex, closingIndex, strugglingAreas) {
    const history = JSON.parse(localStorage.getItem('coachingHistory') || '{}');
    
    if (!history[employeeName]) {
        history[employeeName] = [];
    }
    
    history[employeeName].push({
        date: new Date().toISOString(),
        strugglingAreas: strugglingAreas
    });
    
    localStorage.setItem('coachingHistory', JSON.stringify(history));
}

function clearEmployeeHistory(employeeName) {
    const history = JSON.parse(localStorage.getItem('coachingHistory') || '{}');
    delete history[employeeName];
    localStorage.setItem('coachingHistory', JSON.stringify(history));
}

function getAllHistory() {
    return JSON.parse(localStorage.getItem('coachingHistory') || '{}');
}

function clearAllHistory() {
    localStorage.removeItem('coachingHistory');
    alert('All history cleared!');
    location.reload();
}

function showHistory() {
    const history = getAllHistory();
    const historyContent = document.getElementById('historyContent');
    
    if (Object.keys(history).length === 0) {
        historyContent.innerHTML = '<p class="empty-state">No coaching emails sent yet.</p>';
    } else {
        let html = '';
        
        for (const [name, emails] of Object.entries(history)) {
            // Count how many times each area has been coached for this employee
            const areaCounts = {};
            emails.forEach(entry => {
                if (entry.strugglingAreas) {
                    entry.strugglingAreas.forEach(area => {
                        areaCounts[area] = (areaCounts[area] || 0) + 1;
                    });
                }
            });
            
            // Convert to readable names
            const areaNames = {
                scheduleAdherence: 'Schedule Adherence',
                cxRepOverall: 'Customer Experience',
                fcr: 'First Call Resolution',
                transfers: 'Transfers',
                overallSentiment: 'Overall Sentiment',
                positiveWord: 'Positive Word Choice',
                negativeWord: 'Negative Word Choice',
                managingEmotions: 'Managing Emotions',
                aht: 'Average Handle Time',
                acw: 'After Call Work',
                holdTime: 'Hold Time',
                reliability: 'Reliability',
                safetyHazards: 'Safety Hazards',
                accComplaints: 'ACC Complaints',
                phishingClicks: 'Phishing Clicks',
                redFlags: 'Red Flag Events',
                depositWaiver: 'Deposit Waiver'
            };
            
            html += `<div class="history-employee">
                <h3>${name} (${emails.length} email${emails.length > 1 ? 's' : ''})</h3>`;
            
            // Show coaching counts by area
            if (Object.keys(areaCounts).length > 0) {
                html += `<div style="margin: 10px 0; padding: 10px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                    <strong>Coached on:</strong><br>`;
                
                const sortedAreas = Object.entries(areaCounts)
                    .sort((a, b) => b[1] - a[1]) // Sort by count, highest first
                    .map(([area, count]) => {
                        const readable = areaNames[area] || area;
                        const color = count >= 3 ? '#dc3545' : count >= 2 ? '#ff9800' : '#28a745';
                        return `<span style="display: inline-block; margin: 3px 8px 3px 0; padding: 3px 8px; background: ${color}; color: white; border-radius: 3px; font-size: 0.9em;">
                            ${readable}: ${count}x
                        </span>`;
                    });
                
                html += sortedAreas.join('');
                html += `</div>`;
            }
            
            // Show individual coaching sessions
            emails.forEach((email, index) => {
                const date = new Date(email.date).toLocaleString();
                const strugglingList = email.strugglingAreas && email.strugglingAreas.length > 0 
                    ? email.strugglingAreas.map(a => areaNames[a] || a).join(', ')
                    : 'No issues identified';
                
                html += `
                    <div class="history-item">
                        <div class="history-header">
                            <strong>Coaching Session #${index + 1}</strong>
                            <span>${date}</span>
                        </div>
                        <div style="font-size: 0.9em; color: #666; margin: 5px 0;">
                            <strong>Areas:</strong> ${strugglingList}
                        </div>
                    </div>
                `;
            });
            
            html += `</div>`;
        }
        
        historyContent.innerHTML = html;
    }
    
    document.getElementById('historySection').style.display = 'block';
    document.getElementById('coachingForm').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'none';
}

function exportHistory() {
    const history = getAllHistory();
    
    // Convert to CSV format
    let csvContent = 'Employee Name,Date,Coaching Areas\n';
    
    for (const [employeeName, sessions] of Object.entries(history)) {
        sessions.forEach(session => {
            const date = new Date(session.date).toLocaleDateString();
            const areas = session.strugglingAreas.join('; ');
            csvContent += `"${employeeName}","${date}","${areas}"\n`;
        });
    }
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `coaching-history-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    alert('✅ History exported to CSV! You can open it in Excel.');
}

function importHistory() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedHistory = JSON.parse(event.target.result);
                const existingHistory = getAllHistory();
                
                // Merge histories
                for (const [name, emails] of Object.entries(importedHistory)) {
                    if (!existingHistory[name]) {
                        existingHistory[name] = emails;
                    } else {
                        // Add only new entries (by date)
                        const existingDates = new Set(existingHistory[name].map(e => e.date));
                        const newEntries = emails.filter(e => !existingDates.has(e.date));
                        existingHistory[name].push(...newEntries);
                    }
                }
                
                localStorage.setItem('coachingHistory', JSON.stringify(existingHistory));
                alert('✅ History imported successfully!');
                location.reload();
            } catch (error) {
                alert('❌ Error importing file. Make sure it\'s a valid coaching history JSON file.');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// Display resource links
function displayResourceLinks(resources) {
    const container = document.getElementById('resourcesLinks');
    
    if (resources.length === 0) {
        container.innerHTML = '<p>No resources found.</p>';
        return;
    }
    
    let html = '<p>Click below to search for resources related to struggling areas:</p><ul class="resource-list">';
    
    resources.forEach(resource => {
        html += `
            <li>
                <a href="${resource.searchUrl}" target="_blank" rel="noopener noreferrer" class="resource-link">
                    ${resource.query}
                </a>
            </li>
        `;
    });
    
    html += '</ul>';
    container.innerHTML = html;
}

// Display results
async function displayResults(emailContent, employeeName, strugglingAreas, resources) {
    document.getElementById('resultName').textContent = employeeName;
    document.getElementById('coachingEmail').innerHTML = emailContent.replace(/\n/g, '<br>');
    document.getElementById('resultsSection').style.display = 'block';
    document.getElementById('coachingForm').style.display = 'none';
    
    // Display resource links in separate section
    displayResourceLinks(resources);
    
    // Store email content and struggling areas for later use
    window.currentEmailData = {
        name: employeeName,
        content: emailContent
    };
    
    window.currentStrugglingAreas = strugglingAreas;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // CSV file loader
    document.getElementById('tipsFile')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            customTips = await loadCustomTips(file);
            const totalTips = Object.values(customTips).reduce((sum, tips) => sum + tips.length, 0);
            const metricsCount = Object.keys(customTips).length;
            document.getElementById('tipsStatus').textContent = `✅ Loaded ${totalTips} tips for ${metricsCount} metrics`;
            document.getElementById('tipsStatus').style.color = '#28a745';
        } catch (error) {
            document.getElementById('tipsStatus').textContent = `❌ Error loading file: ${error.message}`;
            document.getElementById('tipsStatus').style.color = '#dc3545';
        }
    });

    // View history button
    document.getElementById('viewHistory')?.addEventListener('click', () => {
        showHistory();
    });

    // Export history button
    document.getElementById('exportHistory')?.addEventListener('click', exportHistory);

    // Import history button
    document.getElementById('importHistory')?.addEventListener('click', importHistory);
document.getElementById('closeHistory')?.addEventListener('click', () => {
        document.getElementById('historySection').style.display = 'none';
        document.getElementById('coachingForm').style.display = 'block';
    });

    // Clear all history button
    document.getElementById('clearAllHistory')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all email history? This cannot be undone.')) {
            clearAllHistory();
        }
    });

    // Copy button
    document.getElementById('copyEmail')?.addEventListener('click', () => {
        const email = document.getElementById('coachingEmail').innerText;
        navigator.clipboard.writeText(email).then(() => {
            alert('Email copied to clipboard!');
        }).catch(() => {
            alert('Failed to copy. Please try again.');
        });
    });

    // Outlook button
    document.getElementById('outlookEmail')?.addEventListener('click', () => {
        if (!window.currentEmailData) return;
        
        const { name, content } = window.currentEmailData;
        const emailData = generateEmailContent(name, content);
        
        const subject = encodeURIComponent(emailData.subject);
        const body = encodeURIComponent(emailData.body);
        const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
        
        window.location.href = mailtoLink;
    });

    // AI Coaching Tips button
    document.getElementById('getAITips')?.addEventListener('click', () => {
        if (!window.currentStrugglingAreas || window.currentStrugglingAreas.length === 0) {
            alert('No struggling areas identified. Employee is meeting all targets!');
            return;
        }
        
        // Convert struggling areas to readable names
        const areaNames = {
            scheduleAdherence: 'Schedule Adherence',
            cxRepOverall: 'Customer Experience',
            fcr: 'First Call Resolution',
            transfers: 'Transfers',
            overallSentiment: 'Overall Sentiment',
            positiveWord: 'Positive Word Choice',
            negativeWord: 'Negative Word Choice',
            managingEmotions: 'Managing Emotions',
            aht: 'Average Handle Time',
            acw: 'After Call Work',
            holdTime: 'Hold Time',
            reliability: 'Reliability',
            safetyHazards: 'Safety Hazards',
            accComplaints: 'ACC Complaints',
            phishingClicks: 'Phishing Clicks',
            redFlags: 'Red Flag Events',
            depositWaiver: 'Deposit Waiver'
        };
        
        const readableAreas = window.currentStrugglingAreas
            .map(area => areaNames[area] || area)
            .join(', ');
        
        // Create AI prompt
        const prompt = `Provide 3-4 specific, actionable coaching tips for a customer service representative struggling with: ${readableAreas}

Be supportive, concrete, and practical. Format your response as a bulleted list.`;
        
        // Open Microsoft Copilot with pre-filled prompt
        const copilotUrl = `https://copilot.microsoft.com/?prompt=${encodeURIComponent(prompt)}`;
        window.open(copilotUrl, '_blank');
    });

    // Copy prompt button - also auto-opens Copilot
    document.getElementById('copyPrompt')?.addEventListener('click', () => {
        const prompt = document.getElementById('aiPrompt').value;
        navigator.clipboard.writeText(prompt).then(() => {
            alert('✅ Prompt copied!\n\nOpening Copilot - paste it there.');
            // Auto-open Copilot after copying
            window.open('https://copilot.microsoft.com/', '_blank');
        }).catch(() => {
            alert('Failed to copy. Please select the text and copy manually.');
        });
    });

    // Open Copilot button
    document.getElementById('openCopilot')?.addEventListener('click', () => {
        // Use Microsoft 365 Copilot chat URL for enterprise users
        window.open('https://copilot.microsoft.com/', '_blank');
    });

    // New email button
    document.getElementById('newCoaching')?.addEventListener('click', () => {
        document.getElementById('coachingForm').style.display = 'block';
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('coachingForm').reset();
    });

    // Form submission - Open Copilot with full email generation prompt
    document.getElementById('coachingForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const employeeName = document.getElementById('employeeName').value;

        if (!employeeName) {
            alert('Please fill in employee name');
            return;
        }

        const metrics = {
            scheduleAdherence: parseFloat(document.getElementById('scheduleAdherence').value) || 0,
            cxRepOverall: parseFloat(document.getElementById('cxRepOverall').value) || 0,
            fcr: parseFloat(document.getElementById('fcr').value) || 0,
            transfers: parseFloat(document.getElementById('transfers').value) || 0,
            overallSentiment: parseFloat(document.getElementById('overallSentiment').value) || 0,
            positiveWord: parseFloat(document.getElementById('positiveWord').value) || 0,
            negativeWord: parseFloat(document.getElementById('negativeWord').value) || 0,
            managingEmotions: parseFloat(document.getElementById('managingEmotions').value) || 0,
            aht: parseFloat(document.getElementById('aht').value) || 0,
            acw: parseFloat(document.getElementById('acw').value) || 0,
            holdTime: parseFloat(document.getElementById('holdTime').value) || 0,
            reliability: parseFloat(document.getElementById('reliability').value) || 0
        };

        const strugglingAreas = identifyStrugglingAreas(metrics);
        
        // Check coaching history for this employee
        const history = getEmployeeHistory(employeeName);
        const isRepeatCoaching = history.length > 0;
        
        // Count how many times each area has been coached
        const areaCounts = {};
        history.forEach(entry => {
            if (entry.strugglingAreas) {
                entry.strugglingAreas.forEach(area => {
                    areaCounts[area] = (areaCounts[area] || 0) + 1;
                });
            }
        });
        
        // Convert struggling areas to readable names
        const areaNames = {
            scheduleAdherence: 'Schedule Adherence',
            cxRepOverall: 'Customer Experience',
            fcr: 'First Call Resolution',
            transfers: 'Transfers',
            overallSentiment: 'Overall Sentiment',
            positiveWord: 'Positive Word Choice',
            negativeWord: 'Negative Word Choice',
            managingEmotions: 'Managing Emotions',
            aht: 'Average Handle Time',
            acw: 'After Call Work',
            holdTime: 'Hold Time',
            reliability: 'Reliability',
            safetyHazards: 'Safety Hazards',
            accComplaints: 'ACC Complaints',
            phishingClicks: 'Phishing Clicks',
            redFlags: 'Red Flag Events',
            depositWaiver: 'Deposit Waiver'
        };
        
        // Identify wins (metrics exceeding targets)
        const wins = [];
        if (metrics.scheduleAdherence >= TARGETS.driver.scheduleAdherence.min) {
            wins.push(`Schedule Adherence: ${metrics.scheduleAdherence}% (Target: ${TARGETS.driver.scheduleAdherence.min}%)`);
        }
        if (metrics.cxRepOverall >= TARGETS.driver.cxRepOverall.min) {
            wins.push(`Customer Experience: ${metrics.cxRepOverall}% (Target: ${TARGETS.driver.cxRepOverall.min}%)`);
        }
        if (metrics.fcr >= TARGETS.driver.fcr.min) {
            wins.push(`FCR: ${metrics.fcr}% (Target: ${TARGETS.driver.fcr.min}%)`);
        }
        if (metrics.overallSentiment >= TARGETS.driver.overallSentiment.min) {
            wins.push(`Overall Sentiment: ${metrics.overallSentiment}% (Target: ${TARGETS.driver.overallSentiment.min}%)`);
        }
        if (metrics.managingEmotions >= TARGETS.driver.managingEmotions.min) {
            wins.push(`Managing Emotions: ${metrics.managingEmotions}% (Target: ${TARGETS.driver.managingEmotions.min}%)`);
        }
        if (metrics.transfers <= TARGETS.driver.transfers.max) {
            wins.push(`Transfers: ${metrics.transfers}% (Target: <${TARGETS.driver.transfers.max}%)`);
        }
        if (metrics.aht <= TARGETS.driver.aht.max) {
            wins.push(`AHT: ${metrics.aht} seconds (Target: <${TARGETS.driver.aht.max} seconds)`);
        }
        
        // Build comprehensive Copilot prompt
        let prompt = `You are writing a casual coaching email to ${employeeName}, a CSR at APS utility taking inbound phone calls.

CRITICAL: EVERY email must sound COMPLETELY DIFFERENT. Do NOT reuse the same opening, structure, transitions, or phrasing. Treat each email like a fresh conversation - vary EVERYTHING.

TONE & STYLE:
- Casual, friendly, like a peer/supervisor (150-200 words)
- Sound natural - use contractions, vary sentence structure, mix short/long sentences
- NO corporate jargon, AI phrases like "I hope this helps", or over-explaining
- Use % symbol, regular hyphens (not em dashes), bullet points for clarity

CONTEXT - KEY METRICS:
- CX Rep Overall = post-call customer survey scores
- Overall Sentiment = average of Positive Word + Negative Word + Managing Emotions
- Positive Word = encouraging language | Negative Word = avoiding "can't", "won't", etc. | Managing Emotions = staying calm with upset customers
- FCR = First Call Resolution | Transfers = sending to other departments
- Hold Time = customers on hold (not talking) | AHT = total call time | ACW = after-call documentation
- Schedule Adherence = logged in when scheduled | Reliability = unplanned time off (PTOST hours)

`;

        // Add wins section if applicable
        if (wins.length > 0) {
            prompt += `WINS (mention scores AND targets):\n`;
            wins.forEach(win => {
                prompt += `✅ ${win}\n`;
            });
            prompt += `Be genuinely celebratory. Vary opening structure, wins presentation (list/narrative/grouped), header phrasing, and energy level each time.\n\n`;
        }

        if (strugglingAreas.length === 0) {
            prompt += `${employeeName} is meeting or exceeding ALL targets! Write an enthusiastic congratulatory email recognizing their excellent performance.`;
        } else {
            // Build detailed metrics for struggling areas
            const detailedStruggles = [];
            strugglingAreas.forEach(area => {
                const readable = areaNames[area] || area;
                let current, target, unit = '%';
                
                if (area === 'scheduleAdherence') { current = metrics.scheduleAdherence; target = TARGETS.driver.scheduleAdherence.min; }
                else if (area === 'cxRepOverall') { current = metrics.cxRepOverall; target = TARGETS.driver.cxRepOverall.min; }
                else if (area === 'fcr') { current = metrics.fcr; target = TARGETS.driver.fcr.min; }
                else if (area === 'transfers') { current = metrics.transfers; target = TARGETS.driver.transfers.max; }
                else if (area === 'overallSentiment') { current = metrics.overallSentiment; target = TARGETS.driver.overallSentiment.min; }
                else if (area === 'positiveWord') { current = metrics.positiveWord; target = TARGETS.driver.positiveWord.min; }
                else if (area === 'negativeWord') { current = metrics.negativeWord; target = TARGETS.driver.negativeWord.max; }
                else if (area === 'managingEmotions') { current = metrics.managingEmotions; target = TARGETS.driver.managingEmotions.min; }
                else if (area === 'aht') { current = metrics.aht; target = TARGETS.driver.aht.max; unit = ' seconds'; }
                else if (area === 'acw') { current = metrics.acw; target = TARGETS.driver.acw.max; unit = ' seconds'; }
                else if (area === 'holdTime') { current = metrics.holdTime; target = TARGETS.driver.holdTime.max; unit = ' seconds'; }
                else if (area === 'reliability') { current = metrics.reliability; target = TARGETS.driver.reliability.max; unit = ' hours'; }
                
                if (current !== undefined && target !== undefined) {
                    detailedStruggles.push(`${readable}: ${current}${unit} (target: ${target}${unit})`);
                } else {
                    detailedStruggles.push(readable);
                }
            });
            
            // Add reliability context
            const hasReliabilityIssue = strugglingAreas.includes('reliability');
            if (hasReliabilityIssue) {
                if (metrics.reliability >= 16) {
                    prompt += `\n🚨 RELIABILITY (${metrics.reliability} hours): This is about being present and scheduled. Emphasize:\n`;
                    prompt += `- They need to use PTOST for the first 40 hours of any unplanned time and schedule it in Verint ahead of time\n`;
                    prompt += `- Double-check Verint entries match what payroll shows\n`;
                    prompt += `- If they think this is an error, they should review their Verint time entries - make sure days off are coded as PTOST (if unplanned) or Planned (if scheduled ahead)\n`;
                    prompt += `- Plan their time off well ahead - don't wait until the last minute\n`;
                    prompt += `- Make every effort to be there when scheduled. Reliability = showing up consistently.\n`;
                    prompt += `Failure to follow PTOST procedures = disciplinary action.\n\n`;
                } else {
                    prompt += `\n⚠️ RELIABILITY: Focus on being present and scheduled. Tips should emphasize:\n`;
                    prompt += `- If they think the reliability hours are wrong, have them double-check Verint - make sure time off is coded correctly (PTOST vs Planned)\n`;
                    prompt += `- Schedule time off well in advance in Verint - don't wait until the last minute\n`;
                    prompt += `- Make every effort to show up for scheduled shifts\n`;
                    prompt += `- Reliability = consistency and being there when you're supposed to be\n\n`;
                }
            }
            
            if (!isRepeatCoaching) {
                prompt += `TRANSITION: Vary how you shift to improvement areas (blend naturally, different phrases, or skip formal transitions).\n\n`;
            } else {
                const repeatAreas = strugglingAreas.filter(area => areaCounts[area] > 0);
                if (repeatAreas.length > 0) {
                    const repeatReadable = repeatAreas.map(area => `${areaNames[area]} (${areaCounts[area]}x)`).join(', ');
                    prompt += `⚠️ REPEAT COACHING (${repeatReadable}): Be more direct. Find NEW approaches - don't repeat previous advice.\n\n`;
                } else {
                    prompt += `TRANSITION: Vary how you shift to improvement areas.\n\n`;
                }
            }
            
            prompt += `AREAS FOR IMPROVEMENT:\n`;
            detailedStruggles.forEach(struggle => {
                prompt += `⚠️ ${struggle}\n`;
            });
            prompt += `Vary how you describe gaps - don't always use the same phrasing patterns or structure. Sometimes brief, sometimes more context.\n\n`;
            
            prompt += `TIPS:\n`;
            prompt += `CRITICAL: You MUST provide a labeled tip for EVERY struggling area listed above. Do not skip any. If there are 3 struggling areas, provide 3 tips. If there are 5, provide 5 tips.\n\n`;
            prompt += `Use BULLET POINTS with LABELED SECTIONS (e.g., "**Hold Time:**").\n`;
            prompt += `Every tip must include:\n`;
            prompt += `1. The specific action to take (concrete, tactical)\n`;
            prompt += `2. WHY it matters - explain the impact on customers, efficiency, or their scores. Make the WHY compelling and clear.\n`;
            prompt += `3. Examples or scripts when helpful\n\n`;
            
            // Add example tips from CSV if available
            prompt += `EXAMPLE COACHING IDEAS (use as inspiration, reword naturally):\n`;
            strugglingAreas.forEach(area => {
                const exampleTip = getRandomTip(area);
                prompt += `- ${areaNames[area]}: "${exampleTip}"\n`;
            });
            prompt += `\n`;
            
            prompt += `For Word Choice coaching: Provide specific phrase swaps (what to STOP → what to SAY INSTEAD) from real utility CS scenarios. Explain WHY the new phrasing works better.\n\n`;
            prompt += `Focus on quality over quantity. Each tip should be substantive and genuinely helpful. Vary how you introduce tips (don't always say "Try..." or "Focus on..."). Make each tip feel different from previous coaching sessions.\n\n`;
        }
        
        // Add custom notes if provided
        const customNotes = document.getElementById('customNotes')?.value.trim();
        if (customNotes) {
            prompt += `\nCUSTOM FEEDBACK TO INCLUDE:\n"${customNotes}"\nReword this naturally and incorporate it into the appropriate section of the email. Don't quote it directly - make it sound like your own words in the casual coaching tone.\n\n`;
        }
        
        prompt += `CLOSING: Vary structure and tone each time. Keep brief but fresh.\n`;
        prompt += `Generate email body only. No subject. Start with "Hey ${employeeName}!"`;
        
        // Save to history
        saveToHistory(employeeName, '', 0, 0, strugglingAreas);
        
        // Display the prompt
        document.getElementById('resultName').textContent = employeeName;
        document.getElementById('aiPrompt').value = prompt;
        document.getElementById('resultsSection').style.display = 'block';
        document.getElementById('coachingForm').style.display = 'none';
    });
});