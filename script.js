const TARGETS = {
    reliability: {
        safetyHazards: { value: 0, type: 'exact', label: 'Emergency Safety Hazard Infractions' },
        accComplaints: { value: 0, type: 'exact', label: 'Substantiated ACC Complaints' },
        phishingClicks: { value: 0, type: 'exact', label: 'Clicks on Phishing Emails' },
        redFlags: { value: 0, type: 'exact', label: 'Red Flag Events' },
        depositWaiver: { value: 0, type: 'exact', label: 'Deposit Waiver Accuracy Infractions' }
    },
    drivers: {
        scheduleAdherence: { value: 93, type: 'min', label: 'Schedule Adherence' },
        cxRepOverall: { value: 80, type: 'min', label: 'CX Rep Overall' },
        fcr: { value: 70, type: 'min', label: 'First Call Resolution' },
        transfers: { value: 6, type: 'max', label: 'Transfers' },
        overallSentiment: { value: 88, type: 'min', label: 'Overall Sentiment' },
        positiveWord: { value: 86, type: 'min', label: 'Positive Word Choice' },
        negativeWord: { value: 83, type: 'min', label: 'Negative Word' },
        managingEmotions: { value: 95, type: 'min', label: 'Managing Emotions' },
        aht: { value: 440, type: 'max', label: 'Average Handle Time' },
        acw: { value: 60, type: 'max', label: 'ACW' },
        holdTime: { value: 30, type: 'max', label: 'Hold Time' },
        reliability: { value: 16, type: 'max', label: 'Reliability Hours' }
    }
};

const IMPROVEMENT_TIPS = {
    scheduleAdherence: 'Set alarms 10 minutes before start time, plan commute night before, communicate delays immediately, log in exactly on time.',
    cxRepOverall: 'Document interactions accurately, follow protocols consistently, respond within SLAs, seek supervisor feedback regularly.',
    fcr: 'Understand issue fully before resolving, use knowledge base, have tools ready, consult before transferring.',
    transfers: 'Exhaust all troubleshooting options, provide complete context to receiving dept, set customer expectations.',
    overallSentiment: 'Use empathetic tone, acknowledge frustrations, provide solutions with confidence, end calls positively.',
    positiveWord: 'Replace "I can\'t" with "Here\'s what I can do", use customer-focused language, practice positive alternatives.',
    negativeWord: 'Create personal banned words list, identify triggers, practice neutral language, review recordings.',
    managingEmotions: 'Use deep breathing, practice mindfulness, manage stress during breaks, reflect on difficult calls.',
    aht: 'Have scripts ready, use keyboard shortcuts, stay solution-focused, avoid unnecessary conversation.',
    acw: 'Complete documentation immediately, use templates, minimize personal breaks, focus only on notes.',
    holdTime: 'Gather info first, use warm transfers, check departments before holding, set clear expectations.',
    reliability: 'Track time away from desk, minimize personal time, plan breaks strategically.',
    safetyHazards: 'Report all safety concerns immediately, follow protocols, attend training, be aware of hazards.',
    accComplaints: 'Follow service protocols, document thoroughly, address concerns professionally.',
    phishingClicks: 'Be suspicious of unexpected emails, never click unknown links, verify sender identity, report suspicious emails.',
    redFlags: 'Know what constitutes a red flag, report immediately, document observations, follow escalation procedures.',
    depositWaiver: 'Verify all information, double-check calculations, review guidelines, ask for clarification when unsure.'
};

let currentMetrics = {};

document.addEventListener('DOMContentLoaded', function() {
    initializeTabs();
    initializeResourcesManager();
    setupFormHandlers();
});

function initializeTabs() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.dataset.tab;
            switchTab(tabName);
        });
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
    
    document.getElementById(tabName + 'Tab').classList.add('active');
    document.getElementById('tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1)).classList.add('active');
}

function initializeResourcesManager() {
    const metricsManager = document.getElementById('metricsResourcesManager');
    let html = '';
    
    const allMetrics = { ...TARGETS.reliability, ...TARGETS.drivers };
    
    for (const [key, target] of Object.entries(allMetrics)) {
        html += `
            <div class="metric-editor">
                <h3>${target.label}</h3>
                <div class="metric-editor-content">
                    <div class="form-group">
                        <label>Resource 1 - Title:</label>
                        <input type="text" class="resource-title" data-metric="${key}" data-index="0" placeholder="e.g., Training Video Title">
                    </div>
                    <div class="form-group">
                        <label>Resource 1 - URL:</label>
                        <input type="text" class="resource-url" data-metric="${key}" data-index="0" placeholder="e.g., https://example.com">
                    </div>
                    <div class="form-group">
                        <label>Resource 2 - Title:</label>
                        <input type="text" class="resource-title" data-metric="${key}" data-index="1" placeholder="e.g., Guide or Article">
                    </div>
                    <div class="form-group">
                        <label>Resource 2 - URL:</label>
                        <input type="text" class="resource-url" data-metric="${key}" data-index="1" placeholder="e.g., https://example.com">
                    </div>
                    <div class="form-group">
                        <label>Resource 3 - Title:</label>
                        <input type="text" class="resource-title" data-metric="${key}" data-index="2" placeholder="e.g., Internal Training">
                    </div>
                    <div class="form-group">
                        <label>Resource 3 - URL:</label>
                        <input type="text" class="resource-url" data-metric="${key}" data-index="2" placeholder="e.g., https://example.com">
                    </div>
                </div>
            </div>
        `;
    }
    
    metricsManager.innerHTML = html;
    
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = 'Save All Resources';
    saveBtn.addEventListener('click', saveCustomResources);
    metricsManager.appendChild(saveBtn);
    
    loadCustomResources();
}

function loadCustomResources() {
    const customResources = JSON.parse(localStorage.getItem('customResources') || '{}');
    
    for (const [metric, resources] of Object.entries(customResources)) {
        if (Array.isArray(resources)) {
            resources.forEach((resource, index) => {
                const titleInput = document.querySelector(`input.resource-title[data-metric="${metric}"][data-index="${index}"]`);
                const urlInput = document.querySelector(`input.resource-url[data-metric="${metric}"][data-index="${index}"]`);
                
                if (titleInput && resource.title) titleInput.value = resource.title;
                if (urlInput && resource.url) urlInput.value = resource.url;
            });
        }
    }
}

function saveCustomResources() {
    const customResources = {};
    
    document.querySelectorAll('input.resource-title').forEach(input => {
        const metric = input.dataset.metric;
        const index = parseInt(input.dataset.index);
        const title = input.value.trim();
        const urlInput = document.querySelector(`input.resource-url[data-metric="${metric}"][data-index="${index}"]`);
        const url = urlInput ? urlInput.value.trim() : '';
        
        if (title || url) {
            if (!customResources[metric]) {
                customResources[metric] = [{}, {}, {}];
            }
            customResources[metric][index] = { title, url };
        }
    });
    
    localStorage.setItem('customResources', JSON.stringify(customResources));
    alert('Resources saved successfully!');
}

function setupFormHandlers() {
    const coachingTab = document.getElementById('coachingTab');
    
    coachingTab.innerHTML = `
        <form id="coachingForm">
            <section class="form-section">
                <h2>Employee Information</h2>
                <div class="form-group">
                    <label for="employeeName">Employee Name:</label>
                    <input type="text" id="employeeName" required>
                </div>
                <div class="form-group">
                    <label for="pronouns">Pronouns:</label>
                    <select id="pronouns" required>
                        <option value="">Select pronouns</option>
                        <option value="he/him">He/Him</option>
                        <option value="she/her">She/Her</option>
                        <option value="they/them">They/Them</option>
                    </select>
                </div>
            </section>

            <section class="form-section">
                <h2>Performance Metrics</h2>
                <h3>Reliability Metrics</h3>
                <div class="metrics-grid">
                    <div class="form-group">
                        <label for="safetyHazards">Emergency Safety Hazard Infractions:</label>
                        <input type="number" id="safetyHazards" min="0" value="0" required>
                        <span class="target">Target: 0</span>
                    </div>
                    <div class="form-group">
                        <label for="accComplaints">Substantiated ACC Complaints:</label>
                        <input type="number" id="accComplaints" min="0" value="0" required>
                        <span class="target">Target: 0</span>
                    </div>
                    <div class="form-group">
                        <label for="phishingClicks">Clicks on Phishing Emails:</label>
                        <input type="number" id="phishingClicks" min="0" value="0" required>
                        <span class="target">Target: 0</span>
                    </div>
                    <div class="form-group">
                        <label for="redFlags">Red Flag Events:</label>
                        <input type="number" id="redFlags" min="0" value="0" required>
                        <span class="target">Target: 0</span>
                    </div>
                    <div class="form-group">
                        <label for="depositWaiver">Deposit Waiver Accuracy (Infractions):</label>
                        <input type="number" id="depositWaiver" min="0" value="0" required>
                        <span class="target">Target: 0</span>
                    </div>
                </div>

                <h3>Driver & Sub-driver Metrics</h3>
                <div class="metrics-grid">
                    <div class="form-group">
                        <label for="scheduleAdherence">Schedule Adherence (%):</label>
                        <input type="number" id="scheduleAdherence" min="0" max="100" step="0.1" required>
                        <span class="target">Target: 93%</span>
                    </div>
                    <div class="form-group">
                        <label for="cxRepOverall">CX Rep Overall (%):</label>
                        <input type="number" id="cxRepOverall" min="0" max="100" step="0.1" required>
                        <span class="target">Target: 80%</span>
                    </div>
                    <div class="form-group">
                        <label for="fcr">First Call Resolution (%):</label>
                        <input type="number" id="fcr" min="0" max="100" step="0.1" required>
                        <span class="target">Target: 70%</span>
                    </div>
                    <div class="form-group">
                        <label for="transfers">Transfers (%):</label>
                        <input type="number" id="transfers" min="0" max="100" step="0.1" required>
                        <span class="target">Target: <6%</span>
                    </div>
                    <div class="form-group">
                        <label for="overallSentiment">Overall Sentiment (%):</label>
                        <input type="number" id="overallSentiment" min="0" max="100" step="0.1" required>
                        <span class="target">Target: 88%</span>
                    </div>
                    <div class="form-group">
                        <label for="positiveWord">Positive Word Choice (%):</label>
                        <input type="number" id="positiveWord" min="0" max="100" step="0.1" required>
                        <span class="target">Target: 86%</span>
                    </div>
                    <div class="form-group">
                        <label for="negativeWord">Negative Word (%):</label>
                        <input type="number" id="negativeWord" min="0" max="100" step="0.1" required>
                        <span class="target">Target: 83%</span>
                    </div>
                    <div class="form-group">
                        <label for="managingEmotions">Managing Emotions (%):</label>
                        <input type="number" id="managingEmotions" min="0" max="100" step="0.1" required>
                        <span class="target">Target: 95%</span>
                    </div>
                    <div class="form-group">
                        <label for="aht">AHT (seconds):</label>
                        <input type="number" id="aht" min="0" step="1" required>
                        <span class="target">Target: ≤440s</span>
                    </div>
                    <div class="form-group">
                        <label for="acw">ACW (seconds):</label>
                        <input type="number" id="acw" min="0" step="1" required>
                        <span class="target">Target: ≤60s</span>
                    </div>
                    <div class="form-group">
                        <label for="holdTime">Hold Time (seconds):</label>
                        <input type="number" id="holdTime" min="0" step="1" required>
                        <span class="target">Target: ≤30s</span>
                    </div>
                    <div class="form-group">
                        <label for="reliability">Reliability (hours):</label>
                        <input type="number" id="reliability" min="0" step="0.1" required>
                        <span class="target">Target: ≤16hrs</span>
                    </div>
                </div>
            </section>

            <section class="form-section">
                <button type="submit" class="btn-primary">Generate Coaching Plan</button>
                <button type="reset" class="btn-secondary">Clear Form</button>
            </section>
        </form>

        <section id="resultsSection" style="display: none;">
            <div class="results-header">
                <h2>Coaching Plan for <span id="resultName"></span></h2>
                <button id="newCoaching" class="btn-secondary">Generate New Plan</button>
            </div>
            <div class="coaching-content">
                <section id="strugglingAreasSection" class="coaching-section">
                    <h3>Areas Requiring Focus</h3>
                    <div id="strugglingAreas"></div>
                </section>
                <section class="coaching-section">
                    <h3>Personalized Coaching Script</h3>
                    <div id="coachingScript" class="coaching-script"></div>
                </section>
                <section id="resourcesSection" class="coaching-section">
                    <h3>Development Resources by Metric</h3>
                    <div id="resourcesList"></div>
                </section>
            </div>
        </section>
    `;
    
    document.getElementById('coachingForm').addEventListener('submit', function(e) {
        e.preventDefault();
        generateCoachingPlan();
    });
    
    document.getElementById('coachingForm').addEventListener('reset', function() {
        document.getElementById('resultsSection').style.display = 'none';
    });
    
    document.getElementById('newCoaching').addEventListener('click', function() {
        document.getElementById('coachingForm').reset();
        document.getElementById('resultsSection').style.display = 'none';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

function generateCoachingPlan() {
    const employeeName = document.getElementById('employeeName').value;
    const pronouns = document.getElementById('pronouns').value;
    
    currentMetrics = {
        name: employeeName,
        pronouns: pronouns,
        reliability: {
            safetyHazards: parseFloat(document.getElementById('safetyHazards').value),
            accComplaints: parseFloat(document.getElementById('accComplaints').value),
            phishingClicks: parseFloat(document.getElementById('phishingClicks').value),
            redFlags: parseFloat(document.getElementById('redFlags').value),
            depositWaiver: parseFloat(document.getElementById('depositWaiver').value)
        },
        drivers: {
            scheduleAdherence: parseFloat(document.getElementById('scheduleAdherence').value),
            cxRepOverall: parseFloat(document.getElementById('cxRepOverall').value),
            fcr: parseFloat(document.getElementById('fcr').value),
            transfers: parseFloat(document.getElementById('transfers').value),
            overallSentiment: parseFloat(document.getElementById('overallSentiment').value),
            positiveWord: parseFloat(document.getElementById('positiveWord').value),
            negativeWord: parseFloat(document.getElementById('negativeWord').value),
            managingEmotions: parseFloat(document.getElementById('managingEmotions').value),
            aht: parseFloat(document.getElementById('aht').value),
            acw: parseFloat(document.getElementById('acw').value),
            holdTime: parseFloat(document.getElementById('holdTime').value),
            reliability: parseFloat(document.getElementById('reliability').value)
        }
    };
    
    const strugglingAreas = identifyStrugglingAreas(currentMetrics);
    displayResults(strugglingAreas);
    document.getElementById('resultsSection').style.display = 'block';
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
}

function identifyStrugglingAreas(metrics) {
    const struggling = [];
    
    for (const [key, value] of Object.entries(metrics.reliability)) {
        const target = TARGETS.reliability[key];
        if (value !== target.value) {
            struggling.push({
                metricKey: key,
                metricLabel: target.label,
                actual: value,
                target: target.value,
                type: target.type
            });
        }
    }
    
    for (const [key, value] of Object.entries(metrics.drivers)) {
        const target = TARGETS.drivers[key];
        let isStrugging = false;
        
        if (target.type === 'min' && value < target.value) {
            isStrugging = true;
        } else if (target.type === 'max' && value > target.value) {
            isStrugging = true;
        }
        
        if (isStrugging) {
            struggling.push({
                metricKey: key,
                metricLabel: target.label,
                actual: value,
                target: target.value,
                type: target.type
            });
        }
    }
    
    return struggling;
}

function displayResults(strugglingAreas) {
    const firstName = currentMetrics.name.trim().split(' ')[0];
    document.getElementById('resultName').textContent = firstName;
    
    if (strugglingAreas.length === 0) {
        document.getElementById('strugglingAreasSection').innerHTML = `<h3>Areas Requiring Focus</h3><div class="empty-state"><p>🎉 All metrics are meeting targets!</p></div>`;
    } else {
        let html = '<h3>Areas Requiring Focus</h3>';
        strugglingAreas.forEach(area => {
            html += `<div class="struggling-area"><h4>${area.metricLabel}</h4><p><strong>Current:</strong> ${area.actual} | <strong>Target:</strong> ${area.target}</p></div>`;
        });
        document.getElementById('strugglingAreasSection').innerHTML = html;
    }
    
    const coachingScript = generateCoachingScript(currentMetrics, strugglingAreas);
    document.getElementById('coachingScript').textContent = coachingScript;
    
    displayResources(strugglingAreas);
}

function generateCoachingScript(metrics, strugglingAreas) {
    const firstName = metrics.name.trim().split(' ')[0];
    
    if (strugglingAreas.length === 0) {
        return `${firstName}, your performance metrics demonstrate that you are consistently meeting or exceeding all targets. Continue building on these strengths!`;
    }
    
    let script = `${firstName}, I'd like to discuss opportunities for your continued professional development. I've identified ${strugglingAreas.length} area${strugglingAreas.length > 1 ? 's' : ''} where we can focus:\n\n`;
    
    strugglingAreas.forEach((area, index) => {
        const tips = IMPROVEMENT_TIPS[area.metricKey] || 'Work with your supervisor on strategies.';
        script += `${index + 1}. ${area.metricLabel}: Currently at ${area.actual}, target is ${area.target}.\n   HOW TO IMPROVE: ${tips}\n`;
    });
    
    script += `\nLet's schedule regular check-ins to monitor progress. I'm committed to supporting your development.`;
    
    return script;
}

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
