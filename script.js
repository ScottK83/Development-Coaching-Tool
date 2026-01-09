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

// Improvement tips for each metric
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
function getPronounForms(pronounString) {
    const pronounMap = {
        'he/him': { subject: 'he', object: 'him', possessive: 'his', reflexive: 'himself' },
        'she/her': { subject: 'she', object: 'her', possessive: 'her', reflexive: 'herself' },
        'they/them': { subject: 'they', object: 'them', possessive: 'their', reflexive: 'themselves' }
    };
    return pronounMap[pronounString] || pronounMap['they/them'];
}

// Search the web for relevant resources
async function searchForResources(strugglingAreas) {
    const searchQueries = strugglingAreas.map(metric => {
        const metricLabels = {
            scheduleAdherence: "schedule adherence work training",
            fcr: "first call resolution customer service",
            transfers: "reducing transfers call center",
            overallSentiment: "customer sentiment positive tone",
            positiveWord: "positive communication customer service",
            negativeWord: "avoiding negative language customer service",
            managingEmotions: "emotional intelligence workplace",
            aht: "call handling time efficiency",
            acw: "after call work documentation",
            holdTime: "reducing hold time customer service",
            reliability: "attendance reliability workplace",
            cxRepOverall: "customer experience excellence"
        };
        return metricLabels[metric] || metric;
    });

    const resources = [];
    
    // Build search URLs for each struggling area
    for (const query of searchQueries) {
        resources.push({
            query: query,
            searchUrl: `https://www.bing.com/search?q=${encodeURIComponent(query)}`
        });
    }
    
    return resources;
}

// Generate email subject and body
function generateEmailContent(employeeName, coachingEmail) {
    const firstName = employeeName.trim().split(' ')[0];
    const subject = `Development Coaching - ${firstName}'s Performance Review`;
    
    return {
        subject: subject,
        body: coachingEmail
    };
}

// Initialize knowledge base URL fields
function initializeKBFields() {
    const container = document.getElementById('kbUrlsContainer');
    container.innerHTML = `
        <div class="form-group">
            <label for="generalKB">General Knowledge Base (applies to all areas):</label>
            <input type="url" id="generalKB" placeholder="https://example.com/kb">
            <small>Leave blank if not needed</small>
        </div>
    `;
}

// Fetch and extract relevant content from a URL
async function fetchKBContent(url, metric = '') {
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'text/html,application/xhtml+xml' }
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Remove script and style tags
        doc.querySelectorAll('script, style').forEach(el => el.remove());

        // Extract text content
        let text = doc.body.innerText || doc.innerText;
        
        // Clean up excessive whitespace
        text = text
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 20)
            .join('\n')
            .substring(0, 1500);

        return text || '';
    } catch (error) {
        console.warn(`Could not fetch KB from ${url}:`, error.message);
        return '';
    }
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

// Generate coaching script with KB content
async function generateCoachingScript(employeeName, pronouns, metrics, kbContent = '', resourceLinks = []) {
    const pronounForms = getPronounForms(pronouns);
    const strugglingAreas = identifyStrugglingAreas(metrics);

    // Get history for this employee to avoid repeating
    const history = getEmployeeHistory(employeeName);
    const usedCombos = history.map(h => `${h.openingIndex}-${h.closingIndex}`);

    const openings = [
        `Hi ${employeeName}, I wanted to sit down with you today to discuss some opportunities for growth in your role.`,
        `${employeeName}, thanks for taking time to meet. I'd like to have a coaching conversation about your performance and how I can support your development.`,
        `${employeeName}, I appreciate your commitment to the team. I wanted to discuss some areas where I see real potential for you to grow.`,
        `Hi ${employeeName}, I've been reviewing your metrics and wanted to have a conversation about moving forward together.`,
        `${employeeName}, let's talk about where you are and where we can help you get to. I've pulled your recent performance data and want to work with you on next steps.`,
        `Hey ${employeeName}, I wanted to connect with you about some areas where I think focused effort will really pay off for you.`,
        `${employeeName}, I've been looking at your numbers and want to have an honest conversation about your development. This is about helping you succeed.`,
        `${employeeName}, thanks for making time. I want to talk through some specific areas where I see opportunities for you to level up.`,
        `Hi ${employeeName}, I pulled your recent metrics and think we should have a conversation about what's working and where we can improve.`,
        `${employeeName}, I'm reaching out because I want to invest in your growth. Let's discuss some specific areas where you can make progress.`,
        `Hey ${employeeName}, I've been reviewing your performance and I see some clear paths to improvement. Let's walk through them together.`,
        `${employeeName}, I care about your success, so I want to be direct about some areas where you're not hitting the mark yet.`,
        `Hi ${employeeName}, let's have a real conversation about your metrics. I'm here to help you figure out what needs to change.`,
        `${employeeName}, I wanted to connect about your development. There are a few things I think we should focus on moving forward.`,
        `Hey ${employeeName}, I know you're working hard, and I want to help you work smarter. Let's talk about a few key areas.`,
        `${employeeName}, I've been tracking your performance and want to discuss how we can get you where you need to be.`,
        `Hi ${employeeName}, I value our one-on-ones and wanted to use this time to dig into some specific improvement areas with you.`,
        `${employeeName}, let's be real—there are some gaps we need to close. But I'm confident we can tackle them together.`
    ];

    const closings = [
        `I'm confident that with focus on these areas, you'll see real improvement. Let's touch base in two weeks to check progress.`,
        `I believe in your potential and want to support you in getting to the next level. Let's work together on this.`,
        `Your growth is important to me, and I'm here to help. When can we check in again?`,
        `I see a lot of potential in you, and I'm committed to helping you succeed. Let's reconnect soon.`,
        `Bottom line: I'm invested in your success. Let's set up time to check in regularly and make sure you're on track.`,
        `These changes won't happen overnight, but I know you can do this. Let's plan to meet weekly and track your progress together.`,
        `I'm here as a resource for you. Reach out anytime you need help or have questions. Let's schedule our next check-in.`,
        `This is about setting you up for long-term success. Let's check in next week and see how things are going.`,
        `I want to see you succeed, and I'm going to support you through this. Let's keep the conversation going.`,
        `You've got what it takes—let's just sharpen these areas. Touch base with me in a few days on your progress.`,
        `I'm not worried about you getting there. Just need to see consistent effort on these points. Let's talk again soon.`,
        `We'll get through this together. Reach out if you hit any roadblocks or need guidance.`,
        `I believe in you, and I know you can turn this around. Let's meet regularly to track your wins.`,
        `Small improvements add up. Let's focus on progress, not perfection, and check in weekly.`,
        `I'm committed to helping you grow. Let's make this a priority and revisit in our next one-on-one.`,
        `This is fixable, and you're capable. Let's partner on this and celebrate the progress you make.`,
        `You're not in this alone—I'm here to help you every step of the way. Let's connect again next week.`,
        `Keep me posted on how it's going. I'm available anytime you need to talk through challenges.`
    ];

    // Find unused combination
    let openingIndex, closingIndex;
    let attempts = 0;
    do {
        openingIndex = Math.floor(Math.random() * openings.length);
        closingIndex = Math.floor(Math.random() * closings.length);
        attempts++;
        // If we've tried 50 times and all combos are used, reset history for this person
        if (attempts > 50) {
            console.warn(`All combinations used for ${employeeName}, resetting history`);
            clearEmployeeHistory(employeeName);
            break;
        }
    } while (usedCombos.includes(`${openingIndex}-${closingIndex}`));

    const opening = openings[openingIndex];
    const closing = closings[closingIndex];

    let coachingBody = opening + '\n\n';

    if (strugglingAreas.length === 0) {
        coachingBody += `Based on your metrics, you're performing at or above targets across the board. That's excellent work! Keep up the momentum and continue to model these behaviors for the team.`;
    } else {
        coachingBody += `I've identified a few areas where I think we can focus your energy:\n\n`;

        strugglingAreas.forEach((area, index) => {
            const tip = IMPROVEMENT_TIPS[area] || `Focus on improving ${area}`;
            coachingBody += `${index + 1}. ${tip}\n`;
        });

        if (kbContent.trim()) {
            coachingBody += `\n---\n\nHere are some relevant resources that might help:\n\n${kbContent}\n\n---\n`;
        }

        coachingBody += `\nI see real potential in you, and these improvements will make a meaningful difference in your development.`;
        
        // Add resource links if available
        if (resourceLinks && resourceLinks.length > 0) {
            coachingBody += `\n\nI've found some resources that might help:\n`;
            resourceLinks.forEach(resource => {
                coachingBody += `• ${resource.query}: ${resource.searchUrl}\n`;
            });
        }
    }

    coachingBody += `\n\n${closing}`;

    // Save to history
    saveToHistory(employeeName, coachingBody, openingIndex, closingIndex, strugglingAreas);

    return coachingBody;
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
    initializeKBFields();

    // View history button
    document.getElementById('viewHistory')?.addEventListener('click', () => {
        showHistory();
    });

    // Export history button
    document.getElementById('exportHistory')?.addEventListener('click', exportHistory);

    // Import history button
    document.getElementById('importHistory')?.addEventListener('click', importHistory);

    // Close history button
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
        initializeKBFields();
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
            prompt += `VARY EVERYTHING - opening sentence structure, how you list wins, header phrasing, word choice. Each email should feel like a different conversation:\n`;
            prompt += `- Opening: Change sentence structure each time (don't always start "Was looking at your metrics...")\n`;
            prompt += `- Wins presentation: Sometimes list them upfront, sometimes weave into narrative, sometimes group by theme\n`;
            prompt += `- Header: Fresh phrasing every time - not just word swaps\n`;
            prompt += `- Tone: Vary energy level - sometimes excited, sometimes matter-of-fact but supportive, sometimes impressed\n\n`;
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
                prompt += `TRANSITION: Vary how you shift to improvement areas. Don't always say "That said" or "Now, shifting over." Try different structures:\n`;
                prompt += `- Blend it naturally into the conversation\n`;
                prompt += `- Use a question or reflection\n`;
                prompt += `- Jump right in without formal transition\n`;
                prompt += `- Use different connecting phrases each time\n\n`;
            } else {
                const repeatAreas = strugglingAreas.filter(area => areaCounts[area] > 0);
                if (repeatAreas.length > 0) {
                    const repeatReadable = repeatAreas.map(area => `${areaNames[area]} (${areaCounts[area]}x)`).join(', ');
                    prompt += `⚠️ REPEAT COACHING (${repeatReadable}): Be more direct. Find NEW approaches - don't repeat previous advice.\n\n`;
                } else {
                    prompt += `TRANSITION: Vary how you shift to improvement areas. Don't always say "That said" or "Now, shifting over." Try different structures each time.\n\n`;
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
            prompt += `SPECIAL NOTE - For Negative Word Choice or Positive Word coaching:\n`;
            prompt += `Think deeply about the actual phrases they might be using that are hurting their score. Provide specific, creative phrase swaps - show exactly what to STOP saying and what to SAY INSTEAD. Don't use generic examples. Think about real customer service scenarios and what language shifts would genuinely improve the interaction. Explain WHY the new phrasing works better (customer response, tone impact, score improvement).\n\n`;
            prompt += `Focus on quality over quantity. Each tip should be substantive and genuinely helpful. Vary how you introduce tips (don't always say "Try..." or "Focus on..."). Make each tip feel different from previous coaching sessions.\n\n`;
        }
        
        // Add KB content if available
        const generalKBUrl = document.getElementById('generalKB')?.value;
        if (generalKBUrl) {
            prompt += `KNOWLEDGE BASE: ${generalKBUrl} - Mention if relevant.\n\n`;
        }
        
        prompt += `CLOSING:\nVary closing structure completely each time. Don't just swap words in the same sentence pattern:\n`;
        prompt += `- Sometimes mention metrics check first, sometimes end with it\n`;
        prompt += `- Vary how you invite follow-up (question, statement, casual suggestion)\n`;
        prompt += `- Change the energy/tone (encouraging, matter-of-fact, collaborative)\n`;
        prompt += `- Keep it brief but make it sound fresh\n`;
        prompt += `Generate email body only. No subject. Start with "Hey ${employeeName}!"`;
        
        // Save to history
        saveToHistory(employeeName, '', 0, 0, strugglingAreas);
        
        console.log('Displaying results section...');
        
        // Display the prompt
        document.getElementById('resultName').textContent = employeeName;
        document.getElementById('aiPrompt').value = prompt;
        document.getElementById('resultsSection').style.display = 'block';
        // Display the prompt
        document.getElementById('resultName').textContent = employeeName;
        document.getElementById('aiPrompt').value = prompt;
        document.getElementById('resultsSection').style.display = 'block';
        document.getElementById('coachingForm').style.display = 'none'