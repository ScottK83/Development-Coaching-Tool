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
    
    // Check reliability metrics
    if (metrics.safetyHazards > TARGETS.reliability.safetyHazards) struggling.push('safetyHazards');
    if (metrics.accComplaints > TARGETS.reliability.accComplaints) struggling.push('accComplaints');
    if (metrics.phishingClicks > TARGETS.reliability.phishingClicks) struggling.push('phishingClicks');
    if (metrics.redFlags > TARGETS.reliability.redFlags) struggling.push('redFlags');
    if (metrics.depositWaiver > TARGETS.reliability.depositWaiver) struggling.push('depositWaiver');

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

    const openings = [
        `Hi ${employeeName}, I wanted to sit down with you today to discuss some opportunities for growth in your role.`,
        `${employeeName}, thanks for taking time to meet. I'd like to have a coaching conversation about your performance and how I can support your development.`,
        `${employeeName}, I appreciate your commitment to the team. I wanted to discuss some areas where I see real potential for you to grow.`,
        `Hi ${employeeName}, I've been reviewing your metrics and wanted to have a conversation about moving forward together.`,
        `${employeeName}, let's talk about where you are and where we can help you get to. I've pulled your recent performance data and want to work with you on next steps.`,
        `Hey ${employeeName}, I wanted to connect with you about some areas where I think focused effort will really pay off for you.`,
        `${employeeName}, I've been looking at your numbers and want to have an honest conversation about your development. This is about helping you succeed.`
    ];

    const closings = [
        `I'm confident that with focus on these areas, you'll see real improvement. Let's touch base in two weeks to check progress.`,
        `I believe in your potential and want to support you in getting to the next level. Let's work together on this.`,
        `Your growth is important to me, and I'm here to help. When can we check in again?`,
        `I see a lot of potential in you, and I'm committed to helping you succeed. Let's reconnect soon.`,
        `Bottom line: I'm invested in your success. Let's set up time to check in regularly and make sure you're on track.`,
        `These changes won't happen overnight, but I know you can do this. Let's plan to meet weekly and track your progress together.`,
        `I'm here as a resource for you. Reach out anytime you need help or have questions. Let's schedule our next check-in.`
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

    return coachingBody;
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
    
    // Store email content for Outlook integration
    window.currentEmailData = {
        name: employeeName,
        content: emailContent
    };
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
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

        if (!employeeName || !pronouns) {
            alert('Please fill in employee name and pronouns');
            return;
        }

        const metrics = {
            safetyHazards: parseFloat(document.getElementById('safetyHazards').value) || 0,
            accComplaints: parseFloat(document.getElementById('accComplaints').value) || 0,
            phishingClicks: parseFloat(document.getElementById('phishingClicks').value) || 0,
            redFlags: parseFloat(document.getElementById('redFlags').value) || 0,
            depositWaiver: parseFloat(document.getElementById('depositWaiver').value) || 0,
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

        let kbContent = '';
        const generalKBUrl = document.getElementById('generalKB')?.value;
        
        if (generalKBUrl) {
            kbContent = await fetchKBContent(generalKBUrl);
            if (kbContent) {
                kbContent = `**Related Knowledge Base Content:**\n\n${kbContent}`;
            }
        }

        // Generate resources for email
        const resources = await searchForResources(strugglingAreas);
        
        const coachingEmail = await generateCoachingScript(employeeName, pronouns, metrics, kbContent, resources);
        displayResults(coachingEmail, employeeName, strugglingAreas, resources);
    });
});
