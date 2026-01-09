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
        overallExperience: { min: 80 },
        transfers: { max: 6 },
        overallSentiment: { min: 88 },
        positiveWord: { min: 86 },
        negativeWord: { min: 83 },
        managingEmotions: { min: 95 },
        aht: { max: 440 },
        acw: { max: 60 },
        holdTime: { max: 30 },
        reliability: { max: 16 }
    }
};

// Custom tips loaded from CSV
let customTips = {};
let serverTips = {}; // Tips from server
let userTips = {};   // Custom tips added by user

// Shared area names mapping
const AREA_NAMES = {
    scheduleAdherence: 'Schedule Adherence',
    cxRepOverall: 'Customer Experience',
    fcr: 'First Call Resolution',
    overallExperience: 'Overall Experience',
    transfers: 'Transfers',
    overallSentiment: 'Overall Sentiment',
    positiveWord: 'Positive Word Choice',
    negativeWord: 'Avoid Negative Word Choice',
    managingEmotions: 'Managing Emotions',
    aht: 'Average Handle Time',
    acw: 'After Call Work',
    holdTime: 'Hold Time',
    reliability: 'Reliability'
};

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
    const nameParts = employeeName.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    const emailAddress = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@aps.com`;
    const subject = `Quick Check-In: Let's Chat About Your Metrics!`;
    
    return {
        to: emailAddress,
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

// Load tips from server
async function loadServerTips() {
    try {
        const response = await fetch('tips.csv');
        const csv = await response.text();
        const lines = csv.split('\n').map(line => line.trim()).filter(line => line);
        const dataLines = lines.slice(1);
        
        const tips = {};
        dataLines.forEach(line => {
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
        
        return tips;
    } catch (error) {
        console.error('Error loading server tips:', error);
        return {};
    }
}

// Load user's custom tips from localStorage
function loadUserTips() {
    const saved = localStorage.getItem('userCustomTips');
    return saved ? JSON.parse(saved) : {};
}

// Save user's custom tips to localStorage
function saveUserTips(tips) {
    localStorage.setItem('userCustomTips', JSON.stringify(tips));
}

// Merge server and user tips
function mergeTips() {
    const merged = {};
    
    // Start with server tips
    Object.entries(serverTips).forEach(([metric, tips]) => {
        merged[metric] = [...tips];
    });
    
    // Add user tips
    Object.entries(userTips).forEach(([metric, tips]) => {
        if (!merged[metric]) {
            merged[metric] = [];
        }
        merged[metric].push(...tips);
    });
    
    customTips = merged;
}

// Show tips management interface
function showTipsManagement() {
    // Populate dropdown
    const metricSelect = document.getElementById('metricSelect');
    metricSelect.innerHTML = '<option value="">-- Choose a metric --</option>';
    
    Object.keys(AREA_NAMES).forEach(metricKey => {
        const option = document.createElement('option');
        option.value = metricKey;
        option.textContent = AREA_NAMES[metricKey];
        metricSelect.appendChild(option);
    });
    
    // Clear content initially
    document.getElementById('tipsManagementContent').innerHTML = '<p style="color: #999; font-style: italic; text-align: center; padding: 40px;">Select a metric from the dropdown above to view and manage its tips.</p>';
    
    // Show the section
    document.getElementById('tipsManagementSection').style.display = 'block';
    document.getElementById('coachingForm').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('dashboardSection').style.display = 'none';
    document.getElementById('historySection').style.display = 'none';
}

// Show tips for selected metric
function showMetricTips(metricKey) {
    if (!metricKey) {
        document.getElementById('tipsManagementContent').innerHTML = '<p style="color: #999; font-style: italic; text-align: center; padding: 40px;">Select a metric from the dropdown above to view and manage its tips.</p>';
        return;
    }
    
    const content = document.getElementById('tipsManagementContent');
    const metricName = AREA_NAMES[metricKey];
    const tips = customTips[metricKey] || [];
    
    let html = `
        <div style="border: 1px solid #ddd; border-radius: 8px; padding: 20px; background: white;">
            <h3 style="color: #003DA5; margin-bottom: 15px;">${metricName}</h3>
            
            <div id="tips-${metricKey}" style="margin-bottom: 15px;">
    `;
    
    if (tips.length === 0) {
        html += `<p style="color: #999; font-style: italic;">No tips available for this metric.</p>`;
    } else {
        tips.forEach((tip, index) => {
            html += `
                <div style="display: flex; gap: 10px; margin-bottom: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; align-items: start;">
                    <div style="flex: 1;">
                        <textarea id="tip-${metricKey}-${index}" style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;">${tip}</textarea>
                    </div>
                    <button onclick="saveTipEdit('${metricKey}', ${index})" style="background: #28a745; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer;">💾 Save</button>
                    <button onclick="deleteTip('${metricKey}', ${index})" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer;">🗑️ Delete</button>
                </div>
            `;
        });
    }
    
    html += `
            </div>
            
            <div style="margin-top: 15px;">
                <textarea id="newTip-${metricKey}" placeholder="Add a new tip for ${metricName}..." style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;"></textarea>
                <button onclick="addNewTip('${metricKey}')" style="background: #007bff; color: white; border: none; border-radius: 4px; padding: 8px 15px; cursor: pointer; margin-top: 5px;">➕ Add Tip</button>
            </div>
        </div>
    `;
    
    content.innerHTML = html;
}

// Add a new tip
function addNewTip(metricKey) {
    const textarea = document.getElementById(`newTip-${metricKey}`);
    if (!textarea) return;
    
    const newTip = textarea.value.trim();
    
    if (!newTip) {
        alert('Please enter a tip before adding.');
        return;
    }
    
    // Add to user tips
    if (!userTips[metricKey]) {
        userTips[metricKey] = [];
    }
    userTips[metricKey].push(newTip);
    
    // Save and refresh
    saveUserTips(userTips);
    mergeTips();
    showMetricTips(metricKey);
    
    alert('Tip added successfully!');
}

// Save edited tip
function saveTipEdit(metricKey, tipIndex) {
    const textarea = document.getElementById(`tip-${metricKey}-${tipIndex}`);
    if (!textarea) return;
    
    const editedTip = textarea.value.trim();
    
    if (!editedTip) {
        alert('Tip cannot be empty. Use delete if you want to remove it.');
        return;
    }
    
    // Update the tip in customTips
    customTips[metricKey][tipIndex] = editedTip;
    
    // Rebuild userTips from scratch - only include what's in customTips that isn't from serverTips
    const serverTipsForMetric = serverTips[metricKey] || [];
    const allTips = customTips[metricKey] || [];
    
    // Only keep tips that are NOT in the original server tips OR have been modified
    userTips[metricKey] = allTips.filter(tip => !serverTipsForMetric.includes(tip));
    
    // Save and refresh
    saveUserTips(userTips);
    mergeTips();
    showMetricTips(metricKey);
    
    alert('Tip updated successfully!');
}

// Delete a tip
function deleteTip(metricKey, tipIndex) {
    if (!confirm('Are you sure you want to delete this tip?')) {
        return;
    }
    
    // Remove from customTips
    customTips[metricKey].splice(tipIndex, 1);
    
    // Rebuild userTips from scratch - only include what's left in customTips that isn't from serverTips
    const serverTipsForMetric = serverTips[metricKey] || [];
    const remainingTips = customTips[metricKey] || [];
    
    // Only keep tips that are NOT in the original server tips
    userTips[metricKey] = remainingTips.filter(tip => !serverTipsForMetric.includes(tip));
    
    // Save and refresh
    saveUserTips(userTips);
    mergeTips();
    showMetricTips(metricKey);
    
    alert('Tip deleted successfully!');
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
        { key: 'overallExperience', value: metrics.overallExperience, target: TARGETS.driver.overallExperience },
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
        // Skip survey-based metrics (FCR, CX Rep Overall, Overall Experience) if they're empty (no surveys)
        if ((metric.key === 'fcr' || metric.key === 'cxRepOverall' || metric.key === 'overallExperience') && (metric.value === '' || metric.value === null || metric.value === undefined)) {
            return; // Skip this metric
        }
        
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

function saveToHistory(employeeName, strugglingAreas, metrics = null, dateRange = null) {
    const history = JSON.parse(localStorage.getItem('coachingHistory') || '{}');

    if (!history[employeeName]) {
        history[employeeName] = [];
    }

    history[employeeName].push({
        date: new Date().toISOString(),
        dateRange: dateRange || '',
        strugglingAreas,
        metrics
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

// Delete a specific session for an employee
function deleteSession(employeeName, sessionIndex) {
    const history = getAllHistory();
    if (history[employeeName]) {
        history[employeeName].splice(sessionIndex, 1);
        
        // If no sessions left for this employee, remove the employee entirely
        if (history[employeeName].length === 0) {
            delete history[employeeName];
        }
        
        localStorage.setItem('coachingHistory', JSON.stringify(history));
        showEmployeeDashboard(); // Refresh the display
    }
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
            
            html += `<div class="history-employee">
                <h3>${name} (${emails.length} email${emails.length > 1 ? 's' : ''})</h3>`;
            
            // Show coaching counts by area
            if (Object.keys(areaCounts).length > 0) {
                html += `<div style="margin: 10px 0; padding: 10px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                    <strong>Coached on:</strong><br>`;
                
                const sortedAreas = Object.entries(areaCounts)
                    .sort((a, b) => b[1] - a[1]) // Sort by count, highest first
                    .map(([area, count]) => {
                        const readable = AREA_NAMES[area] || area;
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
                    ? email.strugglingAreas.map(a => AREA_NAMES[a] || a).join(', ')
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
    document.getElementById('dashboardSection').style.display = 'none';
}

// Diagnose trends for an employee
function diagnoseTrends(employeeName) {
    const history = getEmployeeHistory(employeeName);
    
    if (history.length === 0) {
        alert('No coaching history for this employee.');
        return;
    }
    
    // Sort by date
    const sortedHistory = history.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    let html = `
        <div style="max-width: 1000px; margin: 20px auto;">
            <h2 style="color: #003DA5; margin-bottom: 20px;">📊 Trend Analysis: ${employeeName}</h2>
            <p style="color: #666; margin-bottom: 30px;">Tracking ${sortedHistory.length} coaching session${sortedHistory.length > 1 ? 's' : ''}</p>
    `;
    
    // Analyze each metric across sessions
    const metricKeys = [
        { key: 'scheduleAdherence', name: 'Schedule Adherence', unit: '%', target: TARGETS.driver.scheduleAdherence, isMin: true },
        { key: 'cxRepOverall', name: 'CX Rep Overall', unit: '%', target: TARGETS.driver.cxRepOverall, isMin: true },
        { key: 'fcr', name: 'First Call Resolution', unit: '%', target: TARGETS.driver.fcr, isMin: true },
        { key: 'overallExperience', name: 'Overall Experience', unit: '%', target: TARGETS.driver.overallExperience, isMin: true },
        { key: 'transfers', name: 'Transfers', unit: '%', target: TARGETS.driver.transfers, isMin: false },
        { key: 'overallSentiment', name: 'Overall Sentiment', unit: '%', target: TARGETS.driver.overallSentiment, isMin: true },
        { key: 'positiveWord', name: 'Positive Word', unit: '%', target: TARGETS.driver.positiveWord, isMin: true },
        { key: 'negativeWord', name: 'Negative Word', unit: '%', target: TARGETS.driver.negativeWord, isMin: true },
        { key: 'managingEmotions', name: 'Managing Emotions', unit: '%', target: TARGETS.driver.managingEmotions, isMin: true },
        { key: 'aht', name: 'AHT', unit: 's', target: TARGETS.driver.aht, isMin: false },
        { key: 'acw', name: 'ACW', unit: 's', target: TARGETS.driver.acw, isMin: false },
        { key: 'holdTime', name: 'Hold Time', unit: 's', target: TARGETS.driver.holdTime, isMin: false },
        { key: 'reliability', name: 'Reliability', unit: ' hrs', target: TARGETS.driver.reliability, isMin: false }
    ];
    
    metricKeys.forEach(metric => {
        const values = sortedHistory
            .filter(s => s.metrics && s.metrics[metric.key] !== undefined && s.metrics[metric.key] !== 0)
            .map(s => ({
                date: new Date(s.date).toLocaleDateString(),
                dateRange: s.dateRange || '',
                value: s.metrics[metric.key],
                wasCoached: s.strugglingAreas.includes(metric.key)
            }));
        
        if (values.length === 0) return;
        
        const targetValue = metric.isMin ? metric.target.min : metric.target.max;
        const firstValue = values[0].value;
        const lastValue = values[values.length - 1].value;
        
        let trend = '→';
        let trendColor = '#666';
        let trendText = 'No change';
        
        if (values.length > 1) {
            const change = lastValue - firstValue;
            if (metric.isMin) {
                // Higher is better
                if (change > 0) {
                    trend = '📈';
                    trendColor = '#28a745';
                    trendText = `Improving (+${change.toFixed(2)}${metric.unit})`;
                } else if (change < 0) {
                    trend = '📉';
                    trendColor = '#dc3545';
                    trendText = `Declining (${change.toFixed(2)}${metric.unit})`;
                }
            } else {
                // Lower is better
                if (change < 0) {
                    trend = '📈';
                    trendColor = '#28a745';
                    trendText = `Improving (${change.toFixed(2)}${metric.unit})`;
                } else if (change > 0) {
                    trend = '📉';
                    trendColor = '#dc3545';
                    trendText = `Declining (+${change.toFixed(2)}${metric.unit})`;
                }
            }
        }
        
        const meetingTarget = metric.isMin ? lastValue >= targetValue : lastValue <= targetValue;
        const targetStatus = meetingTarget ? '✅ Meeting target' : '⚠️ Below target';
        
        // Create visual bar chart
        const minValue = Math.min(...values.map(v => v.value));
        const maxValue = Math.max(...values.map(v => v.value));
        const range = maxValue - minValue || 1;
        
        html += `
            <div style="border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 15px; background: white;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h3 style="margin: 0; color: #003DA5;">${metric.name}</h3>
                    <div style="text-align: right;">
                        <span style="font-size: 1.5em;">${trend}</span>
                        <div style="color: ${trendColor}; font-weight: bold;">${trendText}</div>
                        <div style="color: ${meetingTarget ? '#28a745' : '#dc3545'}; font-size: 0.9em;">${targetStatus}</div>
                    </div>
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>Target:</strong> ${metric.isMin ? '≥' : '≤'}${targetValue}${metric.unit} | 
                    <strong>Current:</strong> ${lastValue}${metric.unit}
                </div>
                
                <!-- Visual Chart -->
                <div style="background: #f8f9fa; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                    <div style="display: flex; align-items: flex-end; gap: 5px; height: 150px; border-bottom: 2px solid #ddd; padding-bottom: 5px;">
        `;
        
        values.forEach((v, i) => {
            const heightPercent = range > 0 ? ((v.value - minValue) / range) * 100 : 50;
            const isImproving = i > 0 && (metric.isMin ? v.value > values[i-1].value : v.value < values[i-1].value);
            const isDeclining = i > 0 && (metric.isMin ? v.value < values[i-1].value : v.value > values[i-1].value);
            const barColor = v.wasCoached ? '#ffc107' : isImproving ? '#28a745' : isDeclining ? '#dc3545' : '#007bff';
            const dateShort = v.dateRange || v.date.substring(0, 5);
            
            html += `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end;">
                    <div style="font-weight: bold; font-size: 0.85em; margin-bottom: 3px; color: ${barColor};">${v.value}${metric.unit}</div>
                    <div style="width: 100%; height: ${heightPercent}%; min-height: 10px; background: ${barColor}; border-radius: 4px 4px 0 0; transition: all 0.3s;"></div>
                    <div style="font-size: 0.75em; color: #666; margin-top: 5px; writing-mode: vertical-rl; transform: rotate(180deg);">${dateShort}</div>
                </div>
            `;
        });
        
        html += `
                    </div>
                    <div style="margin-top: 10px; font-size: 0.85em; color: #666;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: #ffc107; border-radius: 2px; margin-right: 5px;"></span>Coached
                        <span style="display: inline-block; width: 12px; height: 12px; background: #28a745; border-radius: 2px; margin-left: 15px; margin-right: 5px;"></span>Improving
                        <span style="display: inline-block; width: 12px; height: 12px; background: #dc3545; border-radius: 2px; margin-left: 15px; margin-right: 5px;"></span>Declining
                    </div>
                </div>
                
                <!-- Session Details -->
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        `;
        
        values.forEach((v, i) => {
            const isImproving = i > 0 && (metric.isMin ? v.value > values[i-1].value : v.value < values[i-1].value);
            const isDeclining = i > 0 && (metric.isMin ? v.value < values[i-1].value : v.value > values[i-1].value);
            const arrow = isImproving ? '⬆️' : isDeclining ? '⬇️' : '';
            const bgColor = v.wasCoached ? '#fff3cd' : '#f8f9fa';
            
            html += `
                <div style="background: ${bgColor}; padding: 8px 12px; border-radius: 4px; border: 1px solid #ddd;">
                    <div style="font-size: 0.85em; color: #666;">${v.date}${v.dateRange ? '<br>Week: ' + v.dateRange : ''}</div>
                    <div style="font-size: 1.1em; font-weight: bold;">${arrow} ${v.value}${metric.unit}</div>
                    ${v.wasCoached ? '<div style="font-size: 0.75em; color: #856404;">⚠️ Coached</div>' : ''}
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    html += `
            <button onclick="showEmployeeDashboard()" style="background: #003DA5; color: white; border: none; border-radius: 4px; padding: 10px 20px; cursor: pointer; font-size: 1em; margin-top: 20px;">← Back to Dashboard</button>
        </div>
    `;
    
    document.getElementById('dashboardContent').innerHTML = html;
}

// Show employee dashboard with expandable history per employee
function showEmployeeDashboard() {
    const history = getAllHistory();
    const dashboardContent = document.getElementById('dashboardContent');

    if (Object.keys(history).length === 0) {
        dashboardContent.innerHTML = '<p class="empty-state">No employees coached yet.</p>';
    } else {
        // Get all unique date ranges
        const allDateRanges = new Set();
        Object.values(history).forEach(sessions => {
            sessions.forEach(s => {
                if (s.dateRange) allDateRanges.add(s.dateRange);
            });
        });
        
        const sortedDateRanges = Array.from(allDateRanges).sort().reverse();
        
        let html = '<div style="margin-bottom: 20px;">';
        html += '<label style="font-weight: bold; display: block; margin-bottom: 8px;">Filter by Week:</label>';
        html += '<select id="weekFilter" onchange="filterDashboardByWeek(this.value)" style="width: 100%; max-width: 400px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 1em;">';
        html += '<option value="">All Weeks</option>';
        sortedDateRanges.forEach(range => {
            html += `<option value="${range}">${range}</option>`;
        });
        html += '</select></div>';
        
        // Sort employees alphabetically
        const sortedEmployees = Object.entries(history).sort((a, b) => a[0].localeCompare(b[0]));

        html += '<div id="employeeList" style="display: flex; flex-direction: column; gap: 15px;">';

        sortedEmployees.forEach(([name, sessions]) => {
            const sessionCount = sessions.length;
            const uniqueId = name.replace(/\s+/g, '-');

            html += `
                <div id="employee-card-${uniqueId}" style="border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                    <div style="background: #f8f9fa; padding: 15px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;" 
                         onclick="document.getElementById('employee-${uniqueId}').style.display = document.getElementById('employee-${uniqueId}').style.display === 'none' ? 'block' : 'none'">
                        <div>
                            <strong style="font-size: 1.1em;">${name}</strong>
                            <span style="margin-left: 10px; color: #666; font-size: 0.9em;">(${sessionCount} coaching session${sessionCount > 1 ? 's' : ''})</span>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <button onclick="event.stopPropagation(); diagnoseTrends('${name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" 
                                    style="background: #28a745; color: white; border: none; border-radius: 4px; padding: 8px 15px; cursor: pointer; font-size: 0.9em;">📊 Diagnose Trends</button>
                            <span style="font-size: 1.2em;">▼</span>
                        </div>
                    </div>
                    <div id="employee-${uniqueId}" style="display: none; padding: 15px; background: white;">
            `;

            // Show each coaching session
            sessions.forEach((session, index) => {
                const sessionDate = new Date(session.date);
                const date = sessionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const weekLabel = session.dateRange || 'No week set';
                const areas = session.strugglingAreas.map(a => AREA_NAMES[a] || a).join(', ');
                
                html += `
                    <div data-week="${session.dateRange || ''}" style="margin-bottom: 20px; padding: 10px; border-left: 3px solid #007bff; background: #f8f9fa; position: relative;">
                        <button onclick="if(confirm('Delete this session?')) deleteSession('${name.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', ${index})" 
                                style="position: absolute; top: 5px; right: 5px; background: #dc3545; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 0.85em;">🗑️ Delete</button>
                        <div style="font-weight: bold; margin-bottom: 5px;">Session ${index + 1} - ${date}</div>
                        <div style="font-size: 0.9em; color: #666; margin-bottom: 5px;">📅 Week: ${weekLabel}</div>
                        <div style="color: #666; margin-bottom: 8px;"><strong>Areas:</strong> ${areas}</div>
                `;

                // Show metrics if available
                if (session.metrics) {
                    html += '<div style="font-size: 0.9em; color: #555; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 5px;">';
                    
                    if (session.metrics.scheduleAdherence) html += `<div>Schedule: ${session.metrics.scheduleAdherence}%</div>`;
                    if (session.metrics.fcr) html += `<div>FCR: ${session.metrics.fcr}%</div>`;
                    if (session.metrics.transfers) html += `<div>Transfers: ${session.metrics.transfers}%</div>`;
                    if (session.metrics.aht) html += `<div>AHT: ${session.metrics.aht}s</div>`;
                    if (session.metrics.acw) html += `<div>ACW: ${session.metrics.acw}s</div>`;
                    if (session.metrics.holdTime) html += `<div>Hold: ${session.metrics.holdTime}s</div>`;
                    if (session.metrics.reliability) html += `<div>Reliability: ${session.metrics.reliability} hrs</div>`;
                    if (session.metrics.overallSentiment) html += `<div>Sentiment: ${session.metrics.overallSentiment}%</div>`;
                    if (session.metrics.positiveWord) html += `<div>Positive: ${session.metrics.positiveWord}%</div>`;
                    if (session.metrics.negativeWord) html += `<div>Negative: ${session.metrics.negativeWord}%</div>`;
                    if (session.metrics.managingEmotions) html += `<div>Emotions: ${session.metrics.managingEmotions}%</div>`;
                    if (session.metrics.cxRepOverall) html += `<div>CX Rep: ${session.metrics.cxRepOverall}%</div>`;
                    
                    html += '</div>';
                }

                html += `</div>`;
            });

            html += `
                    </div>
                </div>
            `;
        });

        html += '</div>';
        dashboardContent.innerHTML = html;
    }

    document.getElementById('dashboardSection').style.display = 'block';
    document.getElementById('coachingForm').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('historySection').style.display = 'none';
}

// Filter dashboard by week
function filterDashboardByWeek(weekRange) {
    const history = getAllHistory();
    const sortedEmployees = Object.entries(history).sort((a, b) => a[0].localeCompare(b[0]));
    
    sortedEmployees.forEach(([name, sessions]) => {
        const uniqueId = name.replace(/\s+/g, '-');
        const employeeDiv = document.getElementById(`employee-${uniqueId}`);
        
        if (!employeeDiv) return;
        
        // Filter sessions
        const sessionDivs = employeeDiv.querySelectorAll('[data-week]');
        let visibleCount = 0;
        
        sessionDivs.forEach(div => {
            const sessionWeek = div.getAttribute('data-week');
            if (!weekRange || sessionWeek === weekRange) {
                div.style.display = 'block';
                visibleCount++;
            } else {
                div.style.display = 'none';
            }
        });
        
        // Hide employee if no sessions match filter
        const parentCard = document.getElementById(`employee-card-${uniqueId}`);
        if (parentCard) {
            parentCard.style.display = visibleCount > 0 ? 'block' : 'none';
        }
    });
}

function exportHistory() {
    const history = getAllHistory();
    
    // Convert to CSV format with metrics and follow-up columns
    let csvContent = 'Employee Name,Date,Coaching Areas,Schedule Adherence,CX Rep Overall,FCR,Transfers,Overall Sentiment,Positive Word,Negative Word,Managing Emotions,AHT,ACW,Hold Time,Reliability,Follow-Up Date,Follow-Up Metrics,Improved?\n';

    for (const [employeeName, sessions] of Object.entries(history)) {
        sessions.forEach(session => {
            const date = new Date(session.date).toLocaleDateString();
            const areas = session.strugglingAreas.join('; ');
            
            // Get metric values if available
            const metrics = session.metrics || {};
            const scheduleAdherence = metrics.scheduleAdherence || '';
            const cxRepOverall = metrics.cxRepOverall || '';
            const fcr = metrics.fcr || '';
            const transfers = metrics.transfers || '';
            const overallSentiment = metrics.overallSentiment || '';
            const positiveWord = metrics.positiveWord || '';
            const negativeWord = metrics.negativeWord || '';
            const managingEmotions = metrics.managingEmotions || '';
            const aht = metrics.aht || '';
            const acw = metrics.acw || '';
            const holdTime = metrics.holdTime || '';
            const reliability = metrics.reliability || '';
            
            csvContent += `"${employeeName}","${date}","${areas}",${scheduleAdherence},${cxRepOverall},${fcr},${transfers},${overallSentiment},${positiveWord},${negativeWord},${managingEmotions},${aht},${acw},${holdTime},${reliability},"","",""\n`;
        });
    }

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `coaching-history-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    alert('✅ History exported to CSV! Open in Excel to track follow-ups.');
}

function importHistory() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
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

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Auto-load tips from server and user storage
    try {
        serverTips = await loadServerTips();
        userTips = loadUserTips();
        mergeTips();
    } catch (error) {
        console.warn('⚠️ Using fallback tips:', error);
    }

    // Employee dashboard button
    document.getElementById('employeeDashboard')?.addEventListener('click', () => {
        showEmployeeDashboard();
    });

    // Manage Tips button
    document.getElementById('manageTips')?.addEventListener('click', () => {
        showTipsManagement();
    });

    // Close Tips Management button
    document.getElementById('closeTipsManagement')?.addEventListener('click', () => {
        document.getElementById('tipsManagementSection').style.display = 'none';
        document.getElementById('coachingForm').style.display = 'block';
    });

    // Metric dropdown change
    document.getElementById('metricSelect')?.addEventListener('change', (e) => {
        showMetricTips(e.target.value);
    });

    // Export Tips button
    document.getElementById('exportTips')?.addEventListener('click', () => {
        const tipsData = {
            exportDate: new Date().toISOString(),
            version: '1.0',
            customTips: userTips
        };
        
        const dataStr = JSON.stringify(tipsData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `coaching-tips-${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
        alert('✅ Tips exported successfully!');
    });

    // Import Tips button
    document.getElementById('importTips')?.addEventListener('click', () => {
        document.getElementById('tipsFileInput').click();
    });

    // Handle file import
    document.getElementById('tipsFileInput')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                
                if (!importedData.customTips) {
                    alert('❌ Invalid tips file format.');
                    return;
                }
                
                // Merge imported tips with existing
                const confirmMerge = confirm('Do you want to MERGE these tips with your existing tips?\n\nClick OK to merge (keeps your current tips + adds new ones)\nClick Cancel to REPLACE all your tips with imported ones');
                
                if (confirmMerge) {
                    // Merge: combine both
                    Object.keys(importedData.customTips).forEach(metricKey => {
                        if (!userTips[metricKey]) {
                            userTips[metricKey] = [];
                        }
                        importedData.customTips[metricKey].forEach(tip => {
                            if (!userTips[metricKey].includes(tip)) {
                                userTips[metricKey].push(tip);
                            }
                        });
                    });
                } else {
                    // Replace: overwrite completely
                    Object.assign(userTips, importedData.customTips);
                }
                
                saveUserTips(userTips);
                mergeTips();
                
                // Refresh current view if a metric is selected
                const currentMetric = document.getElementById('metricSelect').value;
                if (currentMetric) {
                    showMetricTips(currentMetric);
                }
                
                alert('✅ Tips imported successfully!');
            } catch (error) {
                alert('❌ Error reading tips file. Please make sure it\'s a valid JSON file.');
                console.error(error);
            }
        };
        reader.readAsText(file);
        
        // Reset input so same file can be selected again
        e.target.value = '';
    });

    // Close history button
    document.getElementById('closeHistory')?.addEventListener('click', () => {
        document.getElementById('historySection').style.display = 'none';
        document.getElementById('coachingForm').style.display = 'block';
    });

    // Close dashboard button
    document.getElementById('closeDashboard')?.addEventListener('click', () => {
        document.getElementById('dashboardSection').style.display = 'none';
        document.getElementById('coachingForm').style.display = 'block';
    });

    // Back to form button
    document.getElementById('backToForm')?.addEventListener('click', () => {
        document.getElementById('dashboardSection').style.display = 'none';
        document.getElementById('coachingForm').style.display = 'block';
        document.getElementById('resultsSection').style.display = 'none';
    });

    // Clear all history buttons (both in history and dashboard sections)
    document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all email history? This cannot be undone.')) {
            clearAllHistory();
        }
    });
    
    document.getElementById('clearDashboardHistoryBtn')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all email history? This cannot be undone.')) {
            clearAllHistory();
        }
    });

    // ========== EXCEL UPLOAD FUNCTIONALITY ==========
    
    let uploadedEmployeeData = [];

    // Show date range input when file is selected
    document.getElementById('excelFile')?.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            document.getElementById('dateRangeInputContainer').style.display = 'block';
        }
    });

    // Make entire date input field clickable to open calendar
    document.getElementById('startDate')?.addEventListener('click', function() {
        this.showPicker();
    });
    
    document.getElementById('endDate')?.addEventListener('click', function() {
        this.showPicker();
    });

    // Load and parse Excel file
    document.getElementById('loadDataBtn')?.addEventListener('click', () => {
        const fileInput = document.getElementById('excelFile');
        const file = fileInput.files[0];
        
        if (!file) {
            alert('Please select an Excel file first');
            return;
        }

        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // Get first sheet
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                
                // Convert to JSON - For raw data sheet, row 1 has headers, row 2+ is data
                const jsonData = XLSX.utils.sheet_to_json(firstSheet, { 
                    range: 0,
                    defval: ''
                });
                
                // Parse and store employee data
                uploadedEmployeeData = jsonData.map(row => {
                    // Name column format is "LastName, FirstName"
                    const fullName = row['Name (Last, First)'] || '';
                    const firstName = fullName.includes(',') ? fullName.split(',')[1].trim() : fullName;
                    
                    const employeeData = {
                        name: firstName,
                        scheduleAdherence: parsePercentage(row['Adherence%']),
                        cxRepOverall: parseSurveyPercentage(row['RepSat%']),
                        fcr: parseSurveyPercentage(row['FCR%']),
                        overallExperience: parseSurveyPercentage(row['OverallExperience%'] || row['Overall Experience%'] || row['OE%']),
                        transfers: parsePercentage(row['TransfersS%'] || row['TransferS%'] || row['Transfers%']),
                        aht: parseSeconds(row['AHT']),
                        acw: parseSeconds(row['ACW']),
                        holdTime: parseSeconds(row['Hold']),
                        reliability: parseHours(row['Reliability Hrs']),
                        overallSentiment: parsePercentage(row['OverallSentimentScore%']),
                        positiveWord: parsePercentage(row['PositiveWordScore%']),
                        negativeWord: parsePercentage(row['AvoidNegativeWordScore%']),
                        managingEmotions: parsePercentage(row['ManageEmotionsScore%']),
                        surveyTotal: parseInt(row['OE Survey Total']) || 0
                    };
                    
                    return employeeData;
                }).filter(emp => emp.name);
                
                // Populate dropdown
                const dropdown = document.getElementById('employeeSelect');
                dropdown.innerHTML = '<option value="">-- Choose an employee --</option>';
                
                uploadedEmployeeData.forEach((emp, index) => {
                    const option = document.createElement('option');
                    option.value = index;
                    option.textContent = emp.name;
                    dropdown.appendChild(option);
                });
                
                document.getElementById('employeeSelectContainer').style.display = 'block';
                document.getElementById('dateRangeInputContainer').style.display = 'block';
                alert(`✅ Loaded ${uploadedEmployeeData.length} employees from spreadsheet!`);
                
            } catch (error) {
                console.error('Error parsing Excel:', error);
                alert('Error reading Excel file. Please make sure it is formatted correctly.');
            }
        };
        
        reader.readAsArrayBuffer(file);
    });

    // Auto-populate form when employee selected
    document.getElementById('employeeSelect')?.addEventListener('change', (e) => {
        const selectedIndex = e.target.value;
        
        if (selectedIndex === '') {
            return; // No selection
        }
        
        const employee = uploadedEmployeeData[selectedIndex];
        
        // Populate all form fields
        document.getElementById('employeeName').value = employee.name || '';
        document.getElementById('surveyTotal').value = employee.surveyTotal || 0;
        document.getElementById('scheduleAdherence').value = employee.scheduleAdherence ?? '';
        document.getElementById('cxRepOverall').value = employee.cxRepOverall ?? '';
        document.getElementById('fcr').value = employee.fcr ?? '';
        document.getElementById('overallExperience').value = employee.overallExperience ?? '';
        document.getElementById('transfers').value = employee.transfers ?? '';
        document.getElementById('aht').value = employee.aht ?? '';
        document.getElementById('acw').value = employee.acw ?? '';
        document.getElementById('holdTime').value = employee.holdTime ?? '';
        document.getElementById('reliability').value = employee.reliability ?? '';
        document.getElementById('overallSentiment').value = employee.overallSentiment ?? '';
        document.getElementById('positiveWord').value = employee.positiveWord ?? '';
        document.getElementById('negativeWord').value = employee.negativeWord ?? '';
        document.getElementById('managingEmotions').value = employee.managingEmotions ?? '';
        
        // Clear generated email textarea
        document.getElementById('generatedEmail').value = '';
        
        // Scroll to form
        document.getElementById('employeeName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // Helper functions to parse Excel data
    function parsePercentage(value) {
        if (!value && value !== 0) return 0;
        if (value === 'N/A' || value === 'n/a') return 0;
        // If already a decimal (0.83), convert to percentage (83)
        if (typeof value === 'number' && value <= 1) {
            return parseFloat((value * 100).toFixed(2));
        }
        // If string with %, remove it
        if (typeof value === 'string' && value.includes('%')) {
            const parsed = parseFloat(value.replace('%', ''));
            return isNaN(parsed) ? 0 : parsed;
        }
        const parsed = parseFloat(value);
        return isNaN(parsed) ? 0 : parsed;
    }

    // For survey-based metrics - return empty string for N/A instead of 0
    function parseSurveyPercentage(value) {
        if (!value && value !== 0) return '';
        if (value === 'N/A' || value === 'n/a') return '';
        // If already a decimal (0.83), convert to percentage (83)
        if (typeof value === 'number' && value <= 1) {
            return parseFloat((value * 100).toFixed(2));
        }
        // If string with %, remove it
        if (typeof value === 'string' && value.includes('%')) {
            const parsed = parseFloat(value.replace('%', ''));
            return isNaN(parsed) ? '' : parsed;
        }
        const parsed = parseFloat(value);
        return isNaN(parsed) ? '' : parsed;
    }

    function parseSeconds(value) {
        if (!value && value !== 0) return '';
        const parsed = parseFloat(value);
        if (isNaN(parsed)) return '';
        return Math.round(parsed);
    }

    function parseHours(value) {
        if (!value && value !== 0) return 0;  // Default to 0 for blank reliability
        const parsed = parseFloat(value);
        if (isNaN(parsed)) return 0;
        return parseFloat(parsed.toFixed(2));
    }


    // Copy button
    document.getElementById('copyEmail')?.addEventListener('click', () => {
        const email = document.getElementById('coachingEmail').innerText;
        navigator.clipboard.writeText(email).then(() => {
            alert('Email copied to clipboard!');
        }).catch(() => {
            alert('Failed to copy. Please try again.');
        });
    });

    // Update currentEmailData when user pastes generated email
    document.getElementById('generatedEmail')?.addEventListener('input', (e) => {
        const content = e.target.value.trim();
        const employeeName = document.getElementById('resultName').textContent;
        
        if (content && employeeName) {
            window.currentEmailData = {
                name: employeeName,
                content: content
            };
        }
    });

    // Outlook button
    document.getElementById('outlookEmail')?.addEventListener('click', () => {
        const content = document.getElementById('generatedEmail')?.value.trim();
        const employeeName = document.getElementById('resultName').textContent;
        
        if (!content) {
            alert('Please paste the generated email from Copilot first!');
            return;
        }
        
        if (!employeeName) {
            alert('Employee name not found!');
            return;
        }
        
        const emailData = generateEmailContent(employeeName, content);
        
        // Don't encode the email address in 'to' field
        const subject = encodeURIComponent(emailData.subject);
        const body = encodeURIComponent(emailData.body);
        const mailtoLink = `mailto:${emailData.to}?subject=${subject}&body=${body}`;
        
        window.location.href = mailtoLink;
    });

    // AI Coaching Tips button
    document.getElementById('getAITips')?.addEventListener('click', () => {
        if (!window.currentStrugglingAreas || window.currentStrugglingAreas.length === 0) {
            alert('No struggling areas identified. Employee is meeting all targets!');
            return;
        }
        
        const readableAreas = window.currentStrugglingAreas
            .map(area => AREA_NAMES[area] || area)
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
        document.getElementById('generatedEmail').value = '';
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
            cxRepOverall: document.getElementById('cxRepOverall').value ? parseFloat(document.getElementById('cxRepOverall').value) : '',
            fcr: document.getElementById('fcr').value ? parseFloat(document.getElementById('fcr').value) : '',
            overallExperience: document.getElementById('overallExperience').value ? parseFloat(document.getElementById('overallExperience').value) : '',
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
        
        // Identify wins (metrics exceeding targets)
        const wins = [];
        if (metrics.scheduleAdherence >= TARGETS.driver.scheduleAdherence.min) {
            wins.push(`Schedule Adherence: ${metrics.scheduleAdherence}% (Target: ${TARGETS.driver.scheduleAdherence.min}%)`);
        }
        // Only include survey-based metrics if they have values
        if (metrics.cxRepOverall && metrics.cxRepOverall >= TARGETS.driver.cxRepOverall.min) {
            wins.push(`Customer Experience: ${metrics.cxRepOverall}% (Target: ${TARGETS.driver.cxRepOverall.min}%)`);
        }
        if (metrics.fcr && metrics.fcr >= TARGETS.driver.fcr.min) {
            wins.push(`FCR: ${metrics.fcr}% (Target: ${TARGETS.driver.fcr.min}%)`);
        }
        if (metrics.overallExperience && metrics.overallExperience >= TARGETS.driver.overallExperience.min) {
            wins.push(`Overall Experience: ${metrics.overallExperience}% (Target: ${TARGETS.driver.overallExperience.min}%)`);
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
        let prompt = `Write friendly coaching email to ${employeeName}, CSR. Up to 250 words. Sound like a real person - not AI. Vary your word choices, use different sentence structures, throw in casual phrases ("I noticed", "By the way", "Quick thing", "Real talk"). Use contractions naturally. Sometimes start sentences with "And" or "But". Mix long and short sentences. Be specific but not robotic. NO EM DASHES (—) - use commas, periods, or regular hyphens (-) instead. Start "Hey ${employeeName}!"\n\n`;

        // Add wins if any
        if (wins.length > 0) {
            prompt += `WINS: ${wins.join(', ')}\n\n`;
        }

        if (strugglingAreas.length === 0) {
            prompt += `All targets met! Congratulate them.`;
        } else {
            // Build metrics list
            const detailedStruggles = [];
            strugglingAreas.forEach(area => {
                const readable = AREA_NAMES[area] || area;
                let current, target, unit = '%';
                
                if (area === 'scheduleAdherence') { current = metrics.scheduleAdherence; target = TARGETS.driver.scheduleAdherence.min; }
                else if (area === 'cxRepOverall') { current = metrics.cxRepOverall; target = TARGETS.driver.cxRepOverall.min; }
                else if (area === 'fcr') { current = metrics.fcr; target = TARGETS.driver.fcr.min; }
                else if (area === 'transfers') { current = metrics.transfers; target = TARGETS.driver.transfers.max; }
                else if (area === 'overallSentiment') { current = metrics.overallSentiment; target = TARGETS.driver.overallSentiment.min; }
                else if (area === 'positiveWord') { current = metrics.positiveWord; target = TARGETS.driver.positiveWord.min; }
                else if (area === 'negativeWord') { current = metrics.negativeWord; target = TARGETS.driver.negativeWord.min; }
                else if (area === 'managingEmotions') { current = metrics.managingEmotions; target = TARGETS.driver.managingEmotions.min; }
                else if (area === 'aht') { current = metrics.aht; target = TARGETS.driver.aht.max; unit = ' sec'; }
                else if (area === 'acw') { current = metrics.acw; target = TARGETS.driver.acw.max; unit = ' sec'; }
                else if (area === 'holdTime') { current = metrics.holdTime; target = TARGETS.driver.holdTime.max; unit = ' sec'; }
                else if (area === 'reliability') { current = metrics.reliability; target = TARGETS.driver.reliability.max; unit = ' hrs'; }
                
                if (current !== undefined && target !== undefined) {
                    detailedStruggles.push(`${readable}: ${current}${unit} (need: ${target}${unit})`);
                }
            });
            
            const hasReliabilityIssue = strugglingAreas.includes('reliability');
            const isRepeat = isRepeatCoaching && strugglingAreas.some(area => areaCounts[area] > 0);
            
            if (isRepeat) {
                prompt += `REPEAT COACHING - Use NEW wording, different examples, fresh approach. Don't repeat previous phrases:\n`;
            } else {
                prompt += `IMPROVE:\n`;
            }
            
            detailedStruggles.forEach(s => prompt += `• ${s}\n`);
            
            prompt += `\nTIPS (bullet format):\n`;
            strugglingAreas.forEach(area => {
                prompt += `• ${AREA_NAMES[area]}: ${getRandomTip(area)}\n`;
            });
            
            if (hasReliabilityIssue && metrics.reliability >= 16) {
                prompt += `\n(PTOST procedures required - code time in Verint)`;
            }
            
            prompt += `\n\nFORMATTING: Only bold the metric name at the start of each tip (e.g., **Schedule Adherence:** then regular text). Do NOT bold anything else in the email body.\n\nFor each tip: Mix up how you phrase things. Sometimes say "You're at X, need Y", other times "Currently at X, let's get to Y", or "Target is Y, you're at X". Give casual, real-world advice with specific examples. For word choice tips, vary between "Instead of [X], try [Y]", "Swap [X] for [Y]", or "When you say [X], consider [Y]". Sound like a coworker giving friendly advice, not a textbook. Use different transitions: "Here's the thing", "So", "Also", "One more thing", "Real quick". Never repeat the same phrasing structure twice in a row.`;
        }
        
        // Add custom notes if provided
        const customNotes = document.getElementById('customNotes')?.value.trim();
        if (customNotes) {
            prompt += `\n\n${customNotes}`;
        }
        
        // Save to history with date range
        const startDate = document.getElementById('startDate')?.value || '';
        const endDate = document.getElementById('endDate')?.value || '';
        const dateRangeLabel = startDate && endDate ? `${startDate} to ${endDate}` : '';
        saveToHistory(employeeName, strugglingAreas, metrics, dateRangeLabel);
        
        // Display the prompt
        document.getElementById('resultName').textContent = employeeName;
        document.getElementById('aiPrompt').value = prompt;
        document.getElementById('resultsSection').style.display = 'block';
        document.getElementById('coachingForm').style.display = 'none';
    });
});