// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showOnlySection(sectionId) {
    const sections = [
        { id: 'coachingForm', conditional: false },
        { id: 'resultsSection', conditional: false },
        { id: 'dashboardSection', conditional: false },
        { id: 'historySection', conditional: false },
        { id: 'tipsManagementSection', conditional: false }
    ];
    
    sections.forEach(section => {
        const el = document.getElementById(section.id);
        if (el) el.style.display = (section.id === sectionId) ? 'block' : 'none';
    });
    
    // Handle conditional sections
    const customNotesSection = document.getElementById('customNotesSection');
    if (customNotesSection) {
        customNotesSection.style.display = (sectionId === 'coachingForm') ? 'block' : 'none';
    }
}

// Target metrics for comparison
const TARGETS = {
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
    try {
        const saved = localStorage.getItem('userCustomTips');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading user tips:', error);
        return {};
    }
}

// Save user's custom tips to localStorage
function saveUserTips(tips) {
    try {
        localStorage.setItem('userCustomTips', JSON.stringify(tips));
    } catch (error) {
        console.error('Error saving user tips:', error);
        alert('Warning: Could not save custom tips. Storage may be full.');
    }
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
    showOnlySection('tipsManagementSection');
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
    try {
        const history = JSON.parse(localStorage.getItem('coachingHistory') || '{}');
        return history[employeeName] || [];
    } catch (error) {
        console.error('Error reading history:', error);
        return [];
    }
}

function saveToHistory(employeeName, strugglingAreas, metrics = null, dateRange = null) {
    try {
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
    } catch (error) {
        if (error.name === 'QuotaExceededError') {
            console.warn('Storage quota exceeded, attempting cleanup...');
            if (confirm('⚠️ Storage is full! Would you like to keep only the last 15 sessions per employee and try again?')) {
                try {
                    const history = JSON.parse(localStorage.getItem('coachingHistory') || '{}');
                    // Keep only last 15 sessions per employee
                    Object.keys(history).forEach(name => {
                        if (history[name].length > 15) {
                            history[name] = history[name].slice(-15);
                        }
                    });
                    localStorage.setItem('coachingHistory', JSON.stringify(history));
                    
                    // Try saving again
                    if (!history[employeeName]) history[employeeName] = [];
                    history[employeeName].push({
                        date: new Date().toISOString(),
                        dateRange: dateRange || '',
                        strugglingAreas,
                        metrics
                    });
                    localStorage.setItem('coachingHistory', JSON.stringify(history));
                    console.log('✅ Storage cleaned up and data saved successfully');
                } catch (retryError) {
                    console.error('Cleanup failed:', retryError);
                    alert('❌ Could not save coaching history even after cleanup. Please export your data and clear history.');
                }
            } else {
                alert('❌ Data not saved. Please clear some history to continue.');
            }
        } else {
            console.error('Error saving history:', error);
            alert('Warning: Could not save coaching history. Error: ' + error.message);
        }
    }
}

function getAllHistory() {
    try {
        return JSON.parse(localStorage.getItem('coachingHistory') || '{}');
    } catch (error) {
        console.error('Error reading all history:', error);
        return {};
    }
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

// Diagnose trends for an employee
function diagnoseTrends(employeeName) {
    const history = getEmployeeHistory(employeeName);
    
    if (history.length === 0) {
        alert('No coaching history for this employee.');
        return;
    }
    
    // Sort by date
    const sortedHistory = history.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    const safeEmployeeName = escapeHtml(employeeName);
    
    let html = `
        <div style="max-width: 1000px; margin: 20px auto;">
            <h2 style="color: #003DA5; margin-bottom: 20px;">📊 Trend Analysis: ${safeEmployeeName}</h2>
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
        dashboardContent.innerHTML = '<p class="empty-state">No employee data loaded yet.</p>';
    } else {
        // Get all unique employees and date ranges
        const allEmployees = Object.keys(history).sort();
        const allDateRanges = new Set();
        
        Object.values(history).forEach(sessions => {
            sessions.forEach(s => {
                if (s.dateRange) allDateRanges.add(s.dateRange);
            });
        });
        
        const sortedDateRanges = Array.from(allDateRanges).sort().reverse();
        
        let html = `
        <!-- Employee and Date Range Selector -->
        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #2196F3;">
            <h3 style="color: #003DA5; margin-bottom: 15px;">📊 Track Coaching Effectiveness</h3>
            <p style="color: #666; margin-bottom: 15px; font-size: 0.95em;">Select an employee to view their performance across different reporting periods and see if coaching helped improve their metrics.</p>
            
            <div style="margin-bottom: 15px;">
                <label style="font-weight: bold; display: block; margin-bottom: 8px;">1️⃣ Select Employee:</label>
                <select id="trendEmployeeSelect" onchange="updateDateRangeOptions()" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 1em;">
                    <option value="">-- Choose an employee --</option>
                    ${allEmployees.map(emp => `<option value="${emp}">${emp}</option>`).join('')}
                </select>
            </div>
            
            <div id="dateRangeContainer" style="display: none; margin-bottom: 15px;">
                <label style="font-weight: bold; display: block; margin-bottom: 8px;">2️⃣ Select Reporting Period:</label>
                <select id="trendDateRangeSelect" onchange="showEmployeeTrendData()" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 1em;">
                    <option value="">-- Choose a date range --</option>
                </select>
            </div>
            
            <div id="trendDataDisplay" style="display: none; margin-top: 20px; padding: 15px; background: white; border-radius: 5px; border: 1px solid #ddd;">
                <!-- Trend data will be displayed here -->
            </div>
        </div>

        <!-- Filter Section -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">`;
        
        // Employee filter
        html += '<div>';
        html += '<label style="font-weight: bold; display: block; margin-bottom: 8px;">Filter by Employee:</label>';
        html += '<select id="employeeFilter" onchange="filterDashboard()" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 1em;">';
        html += '<option value="">All Employees</option>';
        allEmployees.forEach(emp => {
            html += `<option value="${emp}">${emp}</option>`;
        });
        html += '</select></div>';
        
        // Date filter (initially hidden)
        html += '<div id="dateFilterContainer" style="display: none;">';
        html += '<label style="font-weight: bold; display: block; margin-bottom: 8px;">Filter by Date:</label>';
        html += '<select id="dateFilter" onchange="filterDashboard()" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 1em;">';
        html += '<option value="">All Dates</option>';
        sortedDateRanges.forEach(dateRange => {
            html += `<option value="${dateRange}">${dateRange}</option>`;
        });
        html += '</select></div>';
        
        html += '</div>';
        
        // Sort employees alphabetically
        const sortedEmployees = Object.entries(history).sort((a, b) => a[0].localeCompare(b[0]));

        html += '<div id="employeeList" style="display: flex; flex-direction: column; gap: 15px;">';

        sortedEmployees.forEach(([name, sessions]) => {
            const sessionCount = sessions.length;
            const uniqueId = name.replace(/\s+/g, '-');

            const safeName = escapeHtml(name);
            const safeNameForJs = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'";
            
            html += `
                <div id="employee-card-${uniqueId}" style="border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                    <div style="background: #f8f9fa; padding: 15px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;" 
                         onclick="document.getElementById('employee-${uniqueId}').style.display = document.getElementById('employee-${uniqueId}').style.display === 'none' ? 'block' : 'none'">
                        <div>
                            <strong style="font-size: 1.1em;">${safeName}</strong>
                            <span style="margin-left: 10px; color: #666; font-size: 0.9em;">(${sessionCount} coaching session${sessionCount > 1 ? 's' : ''})</span>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <button onclick="event.stopPropagation(); diagnoseTrends('${safeNameForJs}')" 
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
                
                const safeNameForDelete = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'";
                const safeDateLabel = escapeHtml(date);
                const safeWeekLabel = escapeHtml(weekLabel);
                const safeAreas = escapeHtml(areas);
                
                html += `
                    <div data-employee="${escapeHtml(name)}" data-date="${safeDateLabel}" data-week="${escapeHtml(session.dateRange || '')}" style="margin-bottom: 20px; padding: 10px; border-left: 3px solid #007bff; background: #f8f9fa; position: relative;">
                        <button onclick="if(confirm('Delete this session?')) deleteSession('${safeNameForDelete}', ${index})" 
                                style="position: absolute; top: 5px; right: 5px; background: #dc3545; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 0.85em;">🗑️ Delete</button>
                        <div style="font-weight: bold; margin-bottom: 5px;">Session ${index + 1} - ${safeDateLabel}</div>
                        <div style="font-size: 0.9em; color: #666; margin-bottom: 5px;">📅 Week: ${safeWeekLabel}</div>
                        <div style="color: #666; margin-bottom: 8px;"><strong>Areas:</strong> ${safeAreas}</div>
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

    showOnlySection('dashboardSection');
}

// Update date range dropdown based on selected employee
function updateDateRangeOptions() {
    const selectedEmployee = document.getElementById('trendEmployeeSelect')?.value || '';
    const dateRangeSelect = document.getElementById('trendDateRangeSelect');
    const dateRangeContainer = document.getElementById('dateRangeContainer');
    const trendDataDisplay = document.getElementById('trendDataDisplay');
    
    if (!dateRangeSelect || !dateRangeContainer) return;
    
    // Hide previous trend data
    if (trendDataDisplay) trendDataDisplay.style.display = 'none';
    
    if (!selectedEmployee) {
        dateRangeContainer.style.display = 'none';
        dateRangeSelect.innerHTML = '<option value="">-- Choose a date range --</option>';
        return;
    }
    
    const history = getAllHistory();
    const employeeSessions = history[selectedEmployee] || [];
    
    // Get unique date ranges for this employee
    const dateRanges = [...new Set(employeeSessions.map(s => s.dateRange).filter(dr => dr))];
    
    if (dateRanges.length === 0) {
        dateRangeContainer.style.display = 'none';
        dateRangeSelect.innerHTML = '<option value="">No date ranges available</option>';
        return;
    }
    
    // Sort date ranges (most recent first)
    dateRanges.sort().reverse();
    
    dateRangeContainer.style.display = 'block';
    dateRangeSelect.innerHTML = '<option value="">-- Choose a date range --</option>' + 
        dateRanges.map(dr => `<option value="${dr}">${dr}</option>`).join('');
}

// Show employee trend data for selected employee and date range
function showEmployeeTrendData() {
    const selectedEmployee = document.getElementById('trendEmployeeSelect')?.value || '';
    const selectedDateRange = document.getElementById('trendDateRangeSelect')?.value || '';
    const trendDataDisplay = document.getElementById('trendDataDisplay');
    
    if (!trendDataDisplay || !selectedEmployee || !selectedDateRange) {
        if (trendDataDisplay) trendDataDisplay.style.display = 'none';
        return;
    }
    
    const history = getAllHistory();
    const employeeSessions = history[selectedEmployee] || [];
    
    // Find the session for this date range
    const session = employeeSessions.find(s => s.dateRange === selectedDateRange);
    
    if (!session || !session.metrics) {
        trendDataDisplay.innerHTML = '<p style="color: #999; font-style: italic;">No data available for this date range.</p>';
        trendDataDisplay.style.display = 'block';
        return;
    }
    
    const metrics = session.metrics;
    const sessionDate = new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const strugglingAreas = session.strugglingAreas || [];
    const wasCoached = strugglingAreas.length > 0;
    
    // Find previous session for comparison
    const allSessions = employeeSessions.sort((a, b) => new Date(a.date) - new Date(b.date));
    const currentIndex = allSessions.findIndex(s => s.dateRange === selectedDateRange);
    const previousSession = currentIndex > 0 ? allSessions[currentIndex - 1] : null;
    
    // Build metrics display with comparison
    const safeEmployee = escapeHtml(selectedEmployee);
    const safeDateRange = escapeHtml(selectedDateRange);
    
    let html = `
        <div style="border-bottom: 2px solid #003DA5; padding-bottom: 10px; margin-bottom: 15px;">
            <h4 style="color: #003DA5; margin: 0;">${safeEmployee} - ${safeDateRange}</h4>
            <div style="font-size: 0.9em; color: #666; margin-top: 5px;">Uploaded: ${sessionDate}</div>
            ${wasCoached ? `<div style="margin-top: 8px; padding: 8px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 3px;"><strong>⚠️ Coached on:</strong> ${strugglingAreas.map(a => AREA_NAMES[a] || a).join(', ')}</div>` : '<div style="margin-top: 8px; color: #28a745; font-weight: bold;">✅ Meeting all targets - No coaching needed</div>'}
            ${previousSession ? `<div style="margin-top: 8px; padding: 8px; background: #e3f2fd; border-left: 3px solid #2196F3; border-radius: 3px; font-size: 0.9em;">📈 Comparing to previous period: ${previousSession.dateRange}</div>` : ''}
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
    `;
    
    // Display all metrics with target comparison
    const metricsList = [
        { key: 'scheduleAdherence', label: 'Schedule Adherence', unit: '%', target: TARGETS.driver.scheduleAdherence.min, isMin: true },
        { key: 'cxRepOverall', label: 'CX Rep Overall', unit: '%', target: TARGETS.driver.cxRepOverall.min, isMin: true },
        { key: 'fcr', label: 'First Call Resolution', unit: '%', target: TARGETS.driver.fcr.min, isMin: true },
        { key: 'overallExperience', label: 'Overall Experience', unit: '%', target: TARGETS.driver.overallExperience.min, isMin: true },
        { key: 'transfers', label: 'Transfers', unit: '%', target: TARGETS.driver.transfers.max, isMin: false },
        { key: 'overallSentiment', label: 'Overall Sentiment', unit: '%', target: TARGETS.driver.overallSentiment.min, isMin: true },
        { key: 'positiveWord', label: 'Positive Word', unit: '%', target: TARGETS.driver.positiveWord.min, isMin: true },
        { key: 'negativeWord', label: 'Negative Word', unit: '%', target: TARGETS.driver.negativeWord.min, isMin: true },
        { key: 'managingEmotions', label: 'Managing Emotions', unit: '%', target: TARGETS.driver.managingEmotions.min, isMin: true },
        { key: 'aht', label: 'AHT', unit: 's', target: TARGETS.driver.aht.max, isMin: false },
        { key: 'acw', label: 'ACW', unit: 's', target: TARGETS.driver.acw.max, isMin: false },
        { key: 'holdTime', label: 'Hold Time', unit: 's', target: TARGETS.driver.holdTime.max, isMin: false },
        { key: 'reliability', label: 'Reliability', unit: ' hrs', target: TARGETS.driver.reliability.max, isMin: false }
    ];
    
    metricsList.forEach(metric => {
        const value = metrics[metric.key];
        
        // Skip empty survey-based metrics
        if ((metric.key === 'fcr' || metric.key === 'cxRepOverall' || metric.key === 'overallExperience') && 
            (value === '' || value === null || value === undefined)) {
            return;
        }
        
        if (value !== undefined && value !== '' && value !== null) {
            const meetingTarget = metric.isMin ? value >= metric.target : value <= metric.target;
            const statusIcon = meetingTarget ? '✅' : '⚠️';
            const statusColor = meetingTarget ? '#28a745' : '#dc3545';
            const wasCoached = strugglingAreas.includes(metric.key);
            
            // Compare with previous period if available
            let comparisonHTML = '';
            if (previousSession && previousSession.metrics && previousSession.metrics[metric.key]) {
                const prevValue = previousSession.metrics[metric.key];
                const change = value - prevValue;
                const wasCoachedinPrevious = (previousSession.strugglingAreas || []).includes(metric.key);
                
                if (change !== 0) {
                    const isImprovement = metric.isMin ? change > 0 : change < 0;
                    const changeIcon = isImprovement ? '📈' : '📉';
                    const changeColor = isImprovement ? '#28a745' : '#dc3545';
                    const changeText = Math.abs(change).toFixed(2);
                    
                    comparisonHTML = `<div style="font-size: 0.75em; margin-top: 5px; color: ${changeColor}; font-weight: bold;">${changeIcon} ${isImprovement ? '+' : ''}${change > 0 ? '+' : ''}${changeText}${metric.unit} from last period</div>`;
                    
                    // Special highlight if this was coached and improved
                    if (wasCoachedinPrevious && isImprovement) {
                        comparisonHTML = `<div style="font-size: 0.75em; margin-top: 5px; padding: 4px; background: #d4edda; border-radius: 3px; color: #155724; font-weight: bold;">🎯 Coaching worked! +${changeText}${metric.unit}</div>`;
                    }
                }
            }
            
            const bgColor = wasCoached ? '#fff3cd' : '#f8f9fa';
            
            html += `
                <div style="padding: 12px; background: ${bgColor}; border-radius: 5px; border: 1px solid #ddd;">
                    <div style="font-size: 0.85em; color: #666; margin-bottom: 5px;">${metric.label}</div>
                    <div style="font-size: 1.4em; font-weight: bold; color: ${statusColor};">${statusIcon} ${value}${metric.unit}</div>
                    <div style="font-size: 0.8em; color: #666; margin-top: 3px;">Target: ${metric.isMin ? '≥' : '≤'}${metric.target}${metric.unit}</div>
                    ${wasCoached ? '<div style="font-size: 0.75em; color: #856404; margin-top: 3px; font-weight: bold;">📋 Coached this period</div>' : ''}
                    ${comparisonHTML}
                </div>
            `;
        }
    });
    
    html += '</div>';
    
    // Add coaching effectiveness summary if previous session exists
    if (previousSession) {
        const prevCoached = previousSession.strugglingAreas || [];
        const improved = [];
        const declined = [];
        
        prevCoached.forEach(area => {
            const currentVal = metrics[area];
            const prevVal = previousSession.metrics ? previousSession.metrics[area] : null;
            
            if (currentVal !== undefined && prevVal !== undefined && currentVal !== '' && prevVal !== '') {
                const metricDef = metricsList.find(m => m.key === area);
                if (metricDef) {
                    const change = currentVal - prevVal;
                    const isImprovement = metricDef.isMin ? change > 0 : change < 0;
                    
                    if (isImprovement) {
                        improved.push(AREA_NAMES[area] || area);
                    } else if (change < 0 && metricDef.isMin || change > 0 && !metricDef.isMin) {
                        declined.push(AREA_NAMES[area] || area);
                    }
                }
            }
        });
        
        if (improved.length > 0 || declined.length > 0) {
            html += `
                <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px; border: 1px solid #ddd;">
                    <h4 style="color: #003DA5; margin: 0 0 10px 0;">📊 Coaching Impact Summary</h4>
            `;
            
            if (improved.length > 0) {
                html += `<div style="margin-bottom: 8px; padding: 8px; background: #d4edda; border-left: 3px solid #28a745; border-radius: 3px;">
                    <strong style="color: #155724;">✅ Improved After Coaching (${improved.length}):</strong> ${improved.join(', ')}
                </div>`;
            }
            
            if (declined.length > 0) {
                html += `<div style="padding: 8px; background: #f8d7da; border-left: 3px solid #dc3545; border-radius: 3px;">
                    <strong style="color: #721c24;">⚠️ Still Needs Work (${declined.length}):</strong> ${declined.join(', ')}
                </div>`;
            }
            
            html += '</div>';
        }
    }
    
    trendDataDisplay.innerHTML = html;
    trendDataDisplay.style.display = 'block';
}

// Filter dashboard by employee and date
function filterDashboard() {
    const selectedEmployee = document.getElementById('employeeFilter')?.value || '';
    const selectedDateRange = document.getElementById('dateFilter')?.value || '';
    const dateFilterContainer = document.getElementById('dateFilterContainer');
    
    // Show/hide date filter based on employee selection
    if (dateFilterContainer) {
        if (selectedEmployee) {
            dateFilterContainer.style.display = 'block';
        } else {
            dateFilterContainer.style.display = 'none';
            // Reset date filter when hiding
            const dateFilter = document.getElementById('dateFilter');
            if (dateFilter) dateFilter.value = '';
        }
    }
    
    const history = getAllHistory();
    
    Object.keys(history).forEach(name => {
        const uniqueId = name.replace(/\s+/g, '-');
        const employeeCard = document.getElementById(`employee-card-${uniqueId}`);
        const employeeDiv = document.getElementById(`employee-${uniqueId}`);
        
        if (!employeeCard || !employeeDiv) return;
        
        // Check employee filter
        const employeeMatches = !selectedEmployee || name === selectedEmployee;
        
        // Filter sessions by date range
        const sessionDivs = employeeDiv.querySelectorAll('[data-employee]');
        let visibleCount = 0;
        
        sessionDivs.forEach(div => {
            const sessionEmployee = div.getAttribute('data-employee');
            const sessionDateRange = div.getAttribute('data-week');
            
            const employeeFilterMatch = !selectedEmployee || sessionEmployee === selectedEmployee;
            const dateFilterMatch = !selectedDateRange || sessionDateRange === selectedDateRange;
            
            if (employeeFilterMatch && dateFilterMatch) {
                div.style.display = 'block';
                visibleCount++;
            } else {
                div.style.display = 'none';
            }
        });
        
        // Hide employee card if no sessions match or employee doesn't match filter
        if (!employeeMatches || visibleCount === 0) {
            employeeCard.style.display = 'none';
        } else {
            employeeCard.style.display = 'block';
        }
    });
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
        showOnlySection('coachingForm');
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
                
                if (!importedData || typeof importedData !== 'object' || !importedData.customTips) {
                    alert('❌ Invalid tips file format. Expected JSON with customTips property.');
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
                        const tipsToAdd = importedData.customTips[metricKey];
                        if (Array.isArray(tipsToAdd)) {
                            tipsToAdd.forEach(tip => {
                                if (tip && !userTips[metricKey].includes(tip)) {
                                    userTips[metricKey].push(tip);
                                }
                            });
                        }
                    });
                } else {
                    // Replace: overwrite completely
                    userTips = {};
                    Object.keys(importedData.customTips).forEach(metricKey => {
                        const tips = importedData.customTips[metricKey];
                        if (Array.isArray(tips)) {
                            userTips[metricKey] = tips.filter(tip => tip && typeof tip === 'string');
                        }
                    });
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
        showOnlySection('coachingForm');
    });

    // Close dashboard button
    document.getElementById('closeDashboard')?.addEventListener('click', () => {
        showOnlySection('coachingForm');
    });

    // Back to form button
    document.getElementById('backToForm')?.addEventListener('click', () => {
        showOnlySection('coachingForm');
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

    // Make entire date input field clickable to open calendar
    document.getElementById('startDate')?.addEventListener('click', function() {
        this.showPicker();
    });
    
    document.getElementById('endDate')?.addEventListener('click', function() {
        this.showPicker();
    });

    // Validate date range and enable/disable Load Data button
    function validateDateRange() {
        const startDate = document.getElementById('startDate')?.value || '';
        const endDate = document.getElementById('endDate')?.value || '';
        const loadBtn = document.getElementById('loadDataBtn');
        const validationMsg = document.getElementById('dateValidationMsg');
        const fileInput = document.getElementById('excelFile');
        
        if (!loadBtn) return;
        
        const hasFile = fileInput?.files && fileInput.files.length > 0;
        
        // Default to disabled state
        loadBtn.disabled = true;
        loadBtn.style.background = '#ccc';
        loadBtn.style.opacity = '0.5';
        loadBtn.style.cursor = 'not-allowed';
        
        if (!hasFile) {
            if (validationMsg) {
                validationMsg.textContent = '⚠️ Please select a file first';
                validationMsg.style.display = 'block';
            }
            return;
        }
        
        if (!startDate || !endDate) {
            if (validationMsg) {
                validationMsg.textContent = '⚠️ Please enter both Start and End dates to load data';
                validationMsg.style.display = 'block';
            }
            return;
        }
        
        // Check if end date is after start date
        if (new Date(endDate) < new Date(startDate)) {
            if (validationMsg) {
                validationMsg.textContent = '⚠️ End date must be after or equal to start date';
                validationMsg.style.display = 'block';
            }
            return;
        }
        
        // All validation passed - enable button
        loadBtn.disabled = false;
        loadBtn.style.background = 'linear-gradient(135deg, #2196F3 0%, #1976D2 100%)';
        loadBtn.style.opacity = '1';
        loadBtn.style.cursor = 'pointer';
        if (validationMsg) {
            validationMsg.textContent = '✅ Ready to load data';
            validationMsg.style.color = '#28a745';
            validationMsg.style.display = 'block';
        }
    }

    // Add listeners to date inputs
    document.getElementById('startDate')?.addEventListener('change', validateDateRange);
    document.getElementById('startDate')?.addEventListener('input', validateDateRange);
    document.getElementById('endDate')?.addEventListener('change', validateDateRange);
    document.getElementById('endDate')?.addEventListener('input', validateDateRange);
    
    document.getElementById('excelFile')?.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const container = document.getElementById('dateRangeInputContainer');
            if (container) {
                container.style.display = 'block';
            }
            validateDateRange();
        } else {
            // If file is cleared, reset everything
            const container = document.getElementById('dateRangeInputContainer');
            if (container) container.style.display = 'none';
            validateDateRange();
        }
    });
    
    // Initialize button state on page load
    setTimeout(() => validateDateRange(), 100);

    // Load and parse Excel file
    document.getElementById('loadDataBtn')?.addEventListener('click', () => {
        const fileInput = document.getElementById('excelFile');
        const file = fileInput.files[0];
        const startDate = document.getElementById('startDate')?.value || '';
        const endDate = document.getElementById('endDate')?.value || '';
        
        // CRITICAL: Validate everything before proceeding
        if (!file) {
            alert('❌ Please select an Excel file first');
            return;
        }

        if (!startDate || !endDate) {
            alert('❌ Both Start and End dates are REQUIRED.\n\nPlease select the date range for this data before loading.');
            document.getElementById('startDate')?.focus();
            return;
        }
        
        // Validate date order
        if (new Date(endDate) < new Date(startDate)) {
            alert('❌ End date must be after or equal to start date.');
            document.getElementById('endDate')?.focus();
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
                
                // Immediately save all employees to history
                bulkSaveUploadedEmployees();
                
                alert(`✅ Successfully loaded ${uploadedEmployeeData.length} employees!\n\n📊 Data saved to Employee History.\n\nYou can now select an employee from the dropdown to coach them, or view trends in Employee History.`);
                
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
        
        if (selectedIndex === '' || !uploadedEmployeeData || uploadedEmployeeData.length === 0) {
            // Hide sections if no employee selected
            const metricsSection = document.getElementById('metricsSection');
            const employeeInfoSection = document.getElementById('employeeInfoSection');
            if (metricsSection) metricsSection.style.display = 'none';
            if (employeeInfoSection) employeeInfoSection.style.display = 'none';
            return;
        }
        
        const employee = uploadedEmployeeData[selectedIndex];
        if (!employee) {
            alert('Error: Employee data not found.');
            return;
        }
        
        // Show employee info and metrics sections
        const employeeInfoSection = document.getElementById('employeeInfoSection');
        const metricsSection = document.getElementById('metricsSection');
        if (employeeInfoSection) employeeInfoSection.style.display = 'block';
        if (metricsSection) metricsSection.style.display = 'block';
        
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
        
        // Calculate and display YTD comparison
        displayYTDComparison(employee.name, employee);
        
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

    // Calculate and display YTD comparison
    function displayYTDComparison(employeeName, currentMetrics) {
        const ytdContainer = document.getElementById('ytdComparison');
        if (!ytdContainer) return;
        
        const history = getAllHistory();
        const employeeSessions = history[employeeName] || [];
        
        if (employeeSessions.length === 0) {
            ytdContainer.style.display = 'none';
            return;
        }
        
        // Calculate YTD averages
        const metricSums = {};
        const metricCounts = {};
        
        employeeSessions.forEach(session => {
            if (!session.metrics) return;
            
            Object.keys(session.metrics).forEach(key => {
                const value = session.metrics[key];
                if (value !== '' && value !== null && value !== undefined) {
                    if (!metricSums[key]) {
                        metricSums[key] = 0;
                        metricCounts[key] = 0;
                    }
                    metricSums[key] += parseFloat(value);
                    metricCounts[key]++;
                }
            });
        });
        
        const ytdAverages = {};
        Object.keys(metricSums).forEach(key => {
            ytdAverages[key] = metricSums[key] / metricCounts[key];
        });
        
        // Compare current to YTD
        const comparisons = [];
        const metricDefs = [
            { key: 'scheduleAdherence', name: 'Schedule Adherence', unit: '%', isMin: true },
            { key: 'transfers', name: 'Transfers', unit: '%', isMin: false },
            { key: 'overallSentiment', name: 'Overall Sentiment', unit: '%', isMin: true },
            { key: 'aht', name: 'AHT', unit: 's', isMin: false },
            { key: 'acw', name: 'ACW', unit: 's', isMin: false }
        ];
        
        metricDefs.forEach(metric => {
            const currentValue = currentMetrics[metric.key];
            const ytdValue = ytdAverages[metric.key];
            
            if (currentValue !== undefined && currentValue !== '' && ytdValue !== undefined) {
                const diff = currentValue - ytdValue;
                const isBetter = metric.isMin ? diff > 0 : diff < 0;
                
                if (Math.abs(diff) > 0.01) {
                    comparisons.push({
                        name: metric.name,
                        current: currentValue,
                        ytd: ytdValue.toFixed(2),
                        diff: diff.toFixed(2),
                        unit: metric.unit,
                        isBetter: isBetter
                    });
                }
            }
        });
        
        if (comparisons.length === 0) {
            ytdContainer.style.display = 'none';
            return;
        }
        
        // Display comparison
        let html = `
            <strong style="color: #003DA5;">📊 YTD Performance vs This Report (${employeeSessions.length} period${employeeSessions.length > 1 ? 's' : ''} tracked):</strong>
            <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px;">
        `;
        
        comparisons.forEach(comp => {
            const icon = comp.isBetter ? '⬆️' : '⬇️';
            const color = comp.isBetter ? '#28a745' : '#dc3545';
            const sign = comp.diff > 0 ? '+' : '';
            
            html += `
                <span style="display: inline-block; padding: 5px 10px; background: white; border-radius: 4px; border: 1px solid ${color}; font-size: 0.85em;">
                    <strong style="color: ${color};">${icon} ${comp.name}:</strong> 
                    ${comp.current}${comp.unit} 
                    <span style="color: #666;">(YTD avg: ${comp.ytd}${comp.unit}, ${sign}${comp.diff}${comp.unit})</span>
                </span>
            `;
        });
        
        html += '</div>';
        ytdContainer.innerHTML = html;
        ytdContainer.style.display = 'block';
    }

    // Bulk-save all uploaded employees into history immediately after load
    function bulkSaveUploadedEmployees() {
        try {
            if (!uploadedEmployeeData || uploadedEmployeeData.length === 0) {
                console.log('No employee data to save');
                return;
            }
            
            const startDate = document.getElementById('startDate')?.value || '';
            const endDate = document.getElementById('endDate')?.value || '';
            const dateRangeLabel = startDate && endDate ? `${startDate} to ${endDate}` : '';
            
            if (!dateRangeLabel) {
                console.warn('No date range available for saving');
                return;
            }
            
            let savedCount = 0;
            let skippedCount = 0;

            uploadedEmployeeData.forEach(emp => {
                const name = emp.name || '';
                if (!name) {
                    console.log('Skipping employee with no name');
                    return;
                }

                // Check for duplicate sessions with same date range
                const existingSessions = getEmployeeHistory(name);
                const exists = (existingSessions || []).some(s => (s.dateRange || '') === dateRangeLabel);
                
                if (exists) {
                    console.log(`Skipping ${name} - already has data for ${dateRangeLabel}`);
                    skippedCount++;
                    return;
                }

                const metrics = {
                    scheduleAdherence: emp.scheduleAdherence,
                    cxRepOverall: emp.cxRepOverall || '',
                    fcr: emp.fcr || '',
                    overallExperience: emp.overallExperience || '',
                    transfers: emp.transfers,
                    overallSentiment: emp.overallSentiment,
                    positiveWord: emp.positiveWord,
                    negativeWord: emp.negativeWord,
                    managingEmotions: emp.managingEmotions,
                    aht: emp.aht,
                    acw: emp.acw,
                    holdTime: emp.holdTime,
                    reliability: emp.reliability
                };

                // Identify struggling areas for this employee
                const strugglingAreas = identifyStrugglingAreas(metrics);
                
                // Save to history
                saveToHistory(name, strugglingAreas, metrics, dateRangeLabel);
                savedCount++;
                console.log(`Saved ${name} for ${dateRangeLabel}`);
            });
            
            console.log(`Bulk save complete: ${savedCount} saved, ${skippedCount} skipped (duplicates)`);
        } catch (e) {
            console.error('Bulk save failed:', e);
        }
    }


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

    // New email button
    document.getElementById('newCoaching')?.addEventListener('click', () => {
        showOnlySection('coachingForm');
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
        showOnlySection('resultsSection');
        
        // Scroll to top of results
        document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
});