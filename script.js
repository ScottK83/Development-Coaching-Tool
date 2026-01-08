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
        negativeWord: { max: 17 }, // Below 83% is bad
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
// Identify struggling areas
function identifyStrugglingAreas(metrics) {
    const struggling = [];
    
    // Check reliability metrics (0 is good)
    if (metrics.safetyHazards > TARGETS.reliability.safetyHazards) {
        struggling.push('safetyHazards');
    }
    if (metrics.accComplaints > TARGETS.reliability.accComplaints) {
        struggling.push('accComplaints');
    }
    if (metrics.phishingClicks > TARGETS.reliability.phishingClicks) {
        struggling.push('phishingClicks');
    }
    if (metrics.redFlags > TARGETS.reliability.redFlags) {
        struggling.push('redFlags');
    }
    if (metrics.depositWaiver > TARGETS.reliability.depositWaiver) {
        struggling.push('depositWaiver');
    }

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
async function generateCoachingScript(employeeName, pronouns, metrics, kbContent = '') {
    const pronounForms = getPronounForms(pronouns);
    const strugglingAreas = identifyStrugglingAreas(metrics);

    // Multiple opening phrases for variety
    const openings = [
        `Hi ${employeeName}, I wanted to sit down with you today to discuss some opportunities for growth in your role.`,
        `${employeeName}, thanks for taking time to meet. I'd like to have a coaching conversation about your performance and how I can support your development.`,
        `${employeeName}, I appreciate your commitment to the team. I wanted to discuss some areas where I see real potential for ${pronounForms.object} to grow.`,
        `Hi ${employeeName}, I've been reviewing your metrics and wanted to have a conversation about moving forward together.`
    ];

    // Multiple closing phrases for variety
    const closings = [
        `I'm confident that with focus on these areas, you'll see real improvement. Let's touch base in two weeks to check progress.`,
        `I believe in your potential and want to support you in getting to the next level. Let's work together on this.`,
        `${pronounForms.possessive.charAt(0).toUpperCase() + pronounForms.possessive.slice(1)} growth is important to me, and I'm here to help. When can we check in again?`,
        `I see a lot of potential in ${pronounForms.object}, and I'm committed to helping ${pronounForms.object} succeed. Let's reconnect soon.`
    ];

    const opening = openings[Math.floor(Math.random() * openings.length)];
    const closing = closings[Math.floor(Math.random() * closings.length)];

    let coachingBody = opening + '\n\n';

    if (strugglingAreas.length === 0) {
        coachingBody += `Based on your metrics, you're performing at or above targets across the board. That's excellent work! Keep up the momentum and continue to model these behaviors for the team.`;
    } else {
        coachingBody += `I've identified a few areas where I think we can focus your energy:\n\n`;

        strugglingAreas.forEach((area, index) => {
            const tip = IMPROVEMENT_TIPS[area] || `Focus on improving ${area}`;
            coachingBody += `${index + 1}. ${tip}\n`;
        });

        // Add KB content if available
        if (kbContent.trim()) {
            coachingBody += `\n---\n\nHere are some relevant resources that might help:\n\n${kbContent}\n\n---\n`;
        }

        coachingBody += `\nI see real potential in ${pronounForms.object}, and these improvements will make a meaningful difference in your development.`;
    }

    coachingBody += `\n\n${closing}`;

    return coachingBody;
}

// Display results
function displayResults(emailContent, employeeName) {
    document.getElementById('resultName').textContent = employeeName;
    document.getElementById('coachingEmail').innerHTML = emailContent.replace(/\n/g, '<br>');
    document.getElementById('resultsSection').style.display = 'block';
    document.getElementById('coachingForm').style.display = 'none';
}

// Copy email to clipboard
document.addEventListener('DOMContentLoaded', () => {
    // Initialize KB fields
    initializeKBFields();

    // Copy button
    document.getElementById('copyEmail')?.addEventListener('click', () => {
        const email = document.getElementById('coachingEmail').innerText;
        navigator.clipboard.writeText(email).then(() => {
            alert('Email copied to clipboard!');
        }).catch(() => {
            alert('Failed to copy. Please try again.');
        });
    });

    // New email button
    document.getElementById('newCoaching')?.addEventListener('click', () => {
        document.getElementById('coachingForm').style.display = 'block';
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('coachingForm').reset();
        initializeKBFields();
    });

    // Form submission
    document.getElementById('coachingForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const employeeName = document.getElementById('employeeName').value;
        const pronouns = document.getElementById('pronouns').value;

        const metrics = {
            // Reliability
            safetyHazards: parseFloat(document.getElementById('safetyHazards').value) || 0,
            accComplaints: parseFloat(document.getElementById('accComplaints').value) || 0,
            phishingClicks: parseFloat(document.getElementById('phishingClicks').value) || 0,
            redFlags: parseFloat(document.getElementById('redFlags').value) || 0,
            depositWaiver: parseFloat(document.getElementById('depositWaiver').value) || 0,
            // Driver
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

        // Fetch KB content if provided
        let kbContent = '';
        const generalKBUrl = document.getElementById('generalKB')?.value;
        
        if (generalKBUrl) {
            kbContent = await fetchKBContent(generalKBUrl);
            if (kbContent) {
                kbContent = `**Related Knowledge Base Content:**\n\n${kbContent}`;
            }
        }

        // Generate coaching script
        const coachingEmail = await generateCoachingScript(employeeName, pronouns, metrics, kbContent);
        displayResults(coachingEmail, employeeName);
    });
});

function getPronounForms(pronouns) {
    const pronounMap = {
        'he/him': ['he', 'him', 'his'],
        'she/her': ['she', 'her', 'her'],
        'they/them': ['they', 'them', 'their']
    };
    return pronounMap[pronouns] || ['they', 'them', 'their'];
}

function displayResources(strugglingAreas) {
    const customResources = JSON.parse(localStorage.getItem('customResources') || '{}');
    let html = '<h3>Development Resources by Metric</h3>';
    
    if (strugglingAreas.length === 0) {
        html += '<div class="empty-state"><p>No additional resources needed.</p></div>';
    } else {
        strugglingAreas.forEach(area => {
            html += `<div class="metric-resources"><h4>${area.metricLabel}</h4>`;
            
            const hasCustom = customResources[area.metricKey] && customResources[area.metricKey].some(r => r.title || r.url);
            
            if (hasCustom) {
                html += `<div class="resource-links"><strong>Custom Resources:</strong>`;
                customResources[area.metricKey].forEach(resource => {
                    if (resource.title || resource.url) {
                        html += `<a href="${resource.url || '#'}" class="resource-link" ${resource.url ? 'target="_blank"' : ''}>${resource.title || resource.url}</a>`;
                    }
                });
                html += `</div>`;
            } else {
                html += `<div class="resource-links"><p style="color: #999; font-size: 0.9em;">📝 No custom resources added. Go to "Manage Resources" tab to add training materials, OSCAR links, etc.</p>`;
                html += `<a href="https://www.google.com/search?q=${encodeURIComponent(area.metricLabel + ' improvement tips')}" class="resource-link" target="_blank">🔍 Search Google for "${area.metricLabel}"</a></div>`;
            }
            
            html += `</div>`;
        });
    }
    
    document.getElementById('resourcesSection').innerHTML = html;
}

const style = document.createElement('style');
style.textContent = `.metric-editor { margin-bottom: 30px; padding: 20px; background: white; border: 1px solid #ddd; border-radius: 8px; } .metric-editor h3 { color: #003DA5; margin-bottom: 15px; } .metric-editor-content { display: grid; gap: 15px; }`;
document.head.appendChild(style);
