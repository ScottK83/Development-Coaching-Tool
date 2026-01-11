// REPLACEMENT CODE FOR renderEmployeeHistory and related functions
// Copy this to replace lines 1533 onwards in script.js

function renderEmployeeHistory() {
    const container = document.getElementById('historyContainer');
    const selector = document.getElementById('historyEmployeeSelect');
    if (!container || !selector) return;
    
    // Populate employee selector
    const allEmployees = new Set();
    Object.keys(weeklyData).forEach(weekKey => {
        if (weeklyData[weekKey].employees) {
            weeklyData[weekKey].employees.forEach(emp => allEmployees.add(emp.name));
        }
    });
    
    selector.innerHTML = '<option value="">-- Choose an employee --</option>';
    Array.from(allEmployees).sort().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        selector.appendChild(option);
    });
    
    // Add change listener
    selector.removeEventListener('change', handleEmployeeHistorySelection); // Remove old listener
    selector.addEventListener('change', handleEmployeeHistorySelection);
    
    // Initial state
    container.innerHTML = '<p style="color: #666; font-style: italic; padding: 20px; text-align: center;">Select an employee above to view their performance trends and coaching history.</p>';
}

function handleEmployeeHistorySelection(e) {
    const employeeName = e.target.value;
    const container = document.getElementById('historyContainer');
    
    if (!employeeName || !container) {
        container.innerHTML = '<p style="color: #666; font-style: italic; padding: 20px; text-align: center;">Select an employee above to view their performance trends and coaching history.</p>';
        return;
    }
    
    // Collect all data for this employee
    const employeeData = [];
    Object.keys(weeklyData).sort().forEach(weekKey => {
        const week = weeklyData[weekKey];
        if (week.employees) {
            const empData = week.employees.find(e => e.name === employeeName);
            if (empData) {
                employeeData.push({
                    weekKey: weekKey,
                    startDate: week.metadata.startDate,
                    endDate: week.metadata.endDate,
                    label: week.metadata.label,
                    ...empData
                });
            }
        }
    });
    
    if (employeeData.length === 0) {
        container.innerHTML = '<p style="color: #666; font-style: italic;">No data found for this employee.</p>';
        return;
    }
    
    // Sort by date
    employeeData.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    
    // Get coaching sessions
    const coachingSessions = coachingHistory[employeeName] || [];
    
    // Build HTML
    let html = `<div style="margin-bottom: 30px;">`;
    html += `<h3 style="color: #2196F3; border-bottom: 3px solid #2196F3; padding-bottom: 10px;">${escapeHtml(employeeName)}</h3>`;
    
    // Summary cards
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin: 20px 0;">';
    html += `
        <div style="padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px; text-align: center;">
            <div style="font-size: 2em;">📊</div>
            <div style="font-size: 1.6em; font-weight: bold; margin: 8px 0;">${employeeData.length}</div>
            <div style="font-size: 0.9em; opacity: 0.9;">Weeks of Data</div>
        </div>
        <div style="padding: 20px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; border-radius: 8px; text-align: center;">
            <div style="font-size: 2em;">✉️</div>
            <div style="font-size: 1.6em; font-weight: bold; margin: 8px 0;">${coachingSessions.length}</div>
            <div style="font-size: 0.9em; opacity: 0.9;">Coaching Sessions</div>
        </div>
    `;
    html += '</div>';
    
    // Trend charts
    html += '<div style="margin: 30px 0;">';
    html += '<h4 style="color: #2196F3; margin-bottom: 20px;">📈 Performance Trends</h4>';
    
    // Key metrics charts
    const chartIds = ['scheduleChart', 'cxChart', 'transfersChart', 'ahtChart'];
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px;">';
    
    chartIds.forEach(chartId => {
        html += `
            <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <canvas id="${chartId}"></canvas>
            </div>
        `;
    });
    html += '</div></div>';
    
    // Week over week comparison
    html += '<div style="margin: 30px 0; background: #f8f9fa; padding: 20px; border-radius: 8px;">';
    html += '<h4 style="color: #2196F3; margin-top: 0;">📅 Week-by-Week Performance</h4>';
    html += '<div style="overflow-x: auto;">';
    html += '<table style="width: 100%; border-collapse: collapse; background: white;">';
    html += '<thead><tr style="background: #2196F3; color: white;">';
    html += '<th style="padding: 12px; text-align: left;">Week Ending</th>';
    html += '<th style="padding: 12px; text-align: center;">Adherence</th>';
    html += '<th style="padding: 12px; text-align: center;">CX Rep</th>';
    html += '<th style="padding: 12px; text-align: center;">Transfers</th>';
    html += '<th style="padding: 12px; text-align: center;">AHT</th>';
    html += '<th style="padding: 12px; text-align: center;">Surveys</th>';
    html += '</tr></thead><tbody>';
    
    employeeData.slice().reverse().forEach((week, idx) => {
        const bgColor = idx % 2 === 0 ? '#ffffff' : '#f8f9fa';
        html += `<tr style="background: ${bgColor};">`;
        html += `<td style="padding: 12px; border-bottom: 1px solid #ddd;">${week.label}</td>`;
        html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${week.scheduleAdherence || 'N/A'}</td>`;
        html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${week.cxRepOverall || 'N/A'}</td>`;
        html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${week.transfers || 'N/A'}</td>`;
        html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${week.aht || 'N/A'}</td>`;
        html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${week.surveyTotal || 0}</td>`;
        html += '</tr>';
    });
    html += '</tbody></table></div></div>';
    
    // Coaching metrics analysis
    const metricCoaching = {};
    if (coachingSessions.length > 0) {
        html += '<div style="margin: 30px 0;">';
        html += '<h4 style="color: #2196F3;">💡 Coaching Focus Areas</h4>';
        
        // Count which metrics were coached on
        const metricNames = {
            scheduleAdherence: 'Schedule Adherence',
            cxRepOverall: 'CX Rep Overall',
            fcr: 'First Call Resolution',
            overallExperience: 'Overall Experience',
            transfers: 'Transfers',
            overallSentiment: 'Overall Sentiment',
            positiveWord: 'Positive Word',
            negativeWord: 'Negative Word',
            managingEmotions: 'Managing Emotions',
            aht: 'Average Handle Time',
            acw: 'After Call Work',
            holdTime: 'Hold Time',
            reliability: 'Reliability'
        };
        
        coachingSessions.forEach(session => {
            const emailBody = session.email.body.toLowerCase();
            Object.keys(metricNames).forEach(metric => {
                const metricLower = metricNames[metric].toLowerCase();
                if (emailBody.includes(metricLower) || emailBody.includes(metric.toLowerCase())) {
                    metricCoaching[metric] = (metricCoaching[metric] || 0) + 1;
                }
            });
        });
        
        const sortedMetrics = Object.entries(metricCoaching).sort((a, b) => b[1] - a[1]);
        
        if (sortedMetrics.length > 0) {
            html += '<div style="background: white; padding: 20px; border-radius: 8px;">';
            html += '<canvas id="coachingFocusChart" style="max-height: 300px;"></canvas>';
            html += '</div>';
        }
        html += '</div>';
        
        // Coaching history
        html += '<div style="margin: 30px 0;">';
        html += '<h4 style="color: #2196F3;">📧 Coaching History</h4>';
        
        coachingSessions.slice().reverse().forEach(session => {
            const date = new Date(session.date);
            html += `
                <div style="margin-bottom: 15px; padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #28a745;">
                    <p style="margin: 0 0 8px 0;"><strong>📅 ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}</strong></p>
                    <p style="margin: 0 0 8px 0; color: #666;">Period: ${session.periodType} - ${session.period}</p>
                    <details style="margin-top: 10px;">
                        <summary style="cursor: pointer; color: #2196F3; font-weight: bold;">📄 View Email Content</summary>
                        <div style="margin-top: 10px; padding: 15px; background: #f8f9fa; border-radius: 4px; white-space: pre-wrap; font-family: 'Courier New', monospace; font-size: 0.9em;">
${escapeHtml(session.email.body)}
                        </div>
                    </details>
                </div>
            `;
        });
        html += '</div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
    
    // Render charts after DOM update
    setTimeout(() => {
        renderEmployeeCharts(employeeData, employeeName, metricCoaching);
    }, 100);
}

function renderEmployeeCharts(employeeData, employeeName, metricCoaching) {
    const labels = employeeData.map(d => {
        const endDate = new Date(d.endDate);
        return endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });
    
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
            legend: { display: false },
            title: { display: true, font: { size: 14, weight: 'bold' } }
        },
        scales: {
            y: { beginAtZero: true }
        }
    };
    
    // Schedule Adherence Chart
    const scheduleCtx = document.getElementById('scheduleChart');
    if (scheduleCtx) {
        new Chart(scheduleCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Schedule Adherence %',
                    data: employeeData.map(d => parseFloat(d.scheduleAdherence) || null),
                    borderColor: '#2196F3',
                    backgroundColor: 'rgba(33, 150, 243, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                ...chartOptions,
                plugins: {
                    ...chartOptions.plugins,
                    title: { ...chartOptions.plugins.title, text: '⏰ Schedule Adherence Trend' }
                }
            }
        });
    }
    
    // CX Rep Chart
    const cxCtx = document.getElementById('cxChart');
    if (cxCtx) {
        new Chart(cxCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'CX Rep Overall %',
                    data: employeeData.map(d => parseFloat(d.cxRepOverall) || null),
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                ...chartOptions,
                plugins: {
                    ...chartOptions.plugins,
                    title: { ...chartOptions.plugins.title, text: '⭐ CX Rep Overall Trend' }
                }
            }
        });
    }
    
    // Transfers Chart
    const transfersCtx = document.getElementById('transfersChart');
    if (transfersCtx) {
        new Chart(transfersCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Transfers %',
                    data: employeeData.map(d => parseFloat(d.transfers) || null),
                    backgroundColor: '#FF9800',
                    borderColor: '#F57C00',
                    borderWidth: 2
                }]
            },
            options: {
                ...chartOptions,
                plugins: {
                    ...chartOptions.plugins,
                    title: { ...chartOptions.plugins.title, text: '📞 Transfers Trend' }
                }
            }
        });
    }
    
    // AHT Chart
    const ahtCtx = document.getElementById('ahtChart');
    if (ahtCtx) {
        new Chart(ahtCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'AHT (seconds)',
                    data: employeeData.map(d => parseFloat(d.aht) || null),
                    borderColor: '#9C27B0',
                    backgroundColor: 'rgba(156, 39, 176, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                ...chartOptions,
                plugins: {
                    ...chartOptions.plugins,
                    title: { ...chartOptions.plugins.title, text: '⏱️ Average Handle Time Trend' }
                }
            }
        });
    }
    
    // Coaching Focus Chart
    if (metricCoaching && Object.keys(metricCoaching).length > 0) {
        const coachingCtx = document.getElementById('coachingFocusChart');
        if (coachingCtx) {
            const metricNames = {
                scheduleAdherence: 'Schedule Adherence',
                cxRepOverall: 'CX Rep Overall',
                fcr: 'First Call Resolution',
                overallExperience: 'Overall Experience',
                transfers: 'Transfers',
                overallSentiment: 'Overall Sentiment',
                positiveWord: 'Positive Word',
                negativeWord: 'Negative Word',
                managingEmotions: 'Managing Emotions',
                aht: 'Average Handle Time',
                acw: 'After Call Work',
                holdTime: 'Hold Time',
                reliability: 'Reliability'
            };
            
            const sortedMetrics = Object.entries(metricCoaching).sort((a, b) => b[1] - a[1]);
            
            new Chart(coachingCtx, {
                type: 'bar',
                data: {
                    labels: sortedMetrics.map(m => metricNames[m[0]] || m[0]),
                    datasets: [{
                        label: 'Times Coached',
                        data: sortedMetrics.map(m => m[1]),
                        backgroundColor: [
                            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
                            '#FF9F40', '#FF6384', '#C9CBCF', '#4BC0C0', '#FF6384',
                            '#36A2EB', '#FFCE56', '#9966FF'
                        ]
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { display: false },
                        title: { 
                            display: true, 
                            text: 'Metrics Coached Most Frequently',
                            font: { size: 14, weight: 'bold' }
                        }
                    },
                    scales: {
                        x: { 
                            beginAtZero: true,
                            ticks: { stepSize: 1 }
                        }
                    }
                }
            });
        }
    }
}
