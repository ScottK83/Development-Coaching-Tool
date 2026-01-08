// Target metrics configuration
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

// Metric-specific resources and best practices
const METRIC_RESOURCES = {
    scheduleAdherence: {
        label: 'Schedule Adherence',
        bestPractices: [
            'Set multiple alarms/reminders 10 minutes before shift start',
            'Plan your commute the night before to account for traffic',
            'Log in exactly at your scheduled time - no early clock-in excuses',
            'If running late, notify supervisor immediately and provide ETA',
            'Review scheduling patterns to identify recurring issues'
        ],
        resources: [
            { title: 'Time Management 101 - LinkedIn Learning', url: '#' },
            { title: 'APS Attendance Policy - OSCAR', url: '#' },
            { title: 'Managing Commute Challenges - Internal Training', url: '#' }
        ]
    },
    cxRepOverall: {
        label: 'CX Rep Overall',
        bestPractices: [
            'Maintain consistent professionalism across all interactions',
            'Document all customer interactions accurately',
            'Follow up on customer commitments within 24 hours',
            'Seek feedback from supervisors on your performance',
            'Listen actively and ask clarifying questions'
        ],
        resources: [
            { title: 'Customer Experience Excellence - OSCAR Training', url: '#' },
            { title: 'Communication Best Practices Video', url: '#' },
            { title: 'Customer Satisfaction Techniques Guide', url: '#' }
        ]
    },
    fcr: {
        label: 'First Call Resolution',
        bestPractices: [
            'Fully understand the customer issue before attempting resolution',
            'Have all necessary tools/systems available before engaging customer',
            'Use knowledge base and documentation to find solutions',
            'When uncertain, consult with team before transferring',
            'Document solutions thoroughly for future reference'
        ],
        resources: [
            { title: 'FCR Best Practices - APS Training Module', url: '#' },
            { title: 'Knowledge Base Navigation Guide', url: '#' },
            { title: 'Problem-Solving Framework Webinar', url: '#' }
        ]
    },
    transfers: {
        label: 'Transfers',
        bestPractices: [
            'Attempt to handle issues at your level before transferring',
            'Ensure you have exhausted all troubleshooting options',
            'Provide complete context and background to receiving department',
            'Update customer with transfer reasoning',
            'Set expectations for next steps'
        ],
        resources: [
            { title: 'When to Transfer Calls - APS Guidelines', url: '#' },
            { title: 'Reducing Transfer Rates - Workshop', url: '#' },
            { title: 'Cross-Functional Team Directory and Expertise Map', url: '#' }
        ]
    },
    overallSentiment: {
        label: 'Overall Sentiment',
        bestPractices: [
            'Use positive language and empathetic tone in all interactions',
            'Acknowledge customer frustration and validate their concerns',
            'Provide solutions with confidence and assurance',
            'End calls on a positive note with clear next steps',
            'Review customer feedback regularly to identify patterns'
        ],
        resources: [
            { title: 'Emotional Intelligence in Customer Service', url: '#' },
            { title: 'Tone and Language Guide - APS Training', url: '#' },
            { title: 'De-escalation Techniques Workshop', url: '#' }
        ]
    },
    positiveWord: {
        label: 'Positive Word Choice',
        bestPractices: [
            'Avoid negative phrases like "I can\'t" - replace with "Here\'s what I can do"',
            'Use "You" statements focused on customer benefit',
            'Replace complaints with solutions-oriented language',
            'Practice saying "yes, and..." instead of "no, but..."',
            'Record yourself and listen for negative language patterns'
        ],
        resources: [
            { title: 'Power Words for Customer Service', url: '#' },
            { title: 'Language Reframing Guide', url: '#' },
            { title: 'Positive Communication Coaching Sessions', url: '#' }
        ]
    },
    negativeWord: {
        label: 'Negative Word',
        bestPractices: [
            'Identify and eliminate common negative words from your vocabulary',
            'Create a personal "banned words" list and replacement phrases',
            'Practice using neutral/positive alternatives consistently',
            'Ask colleagues to provide feedback on your language',
            'Review call recordings to identify patterns'
        ],
        resources: [
            { title: 'Eliminating Negative Language - Training', url: '#' },
            { title: 'Word Replacement Quick Reference', url: '#' },
            { title: 'Language Patterns Coaching', url: '#' }
        ]
    },
    managingEmotions: {
        label: 'Managing Emotions',
        bestPractices: [
            'Take deep breaths before responding to difficult situations',
            'Practice mindfulness to maintain emotional awareness',
            'Use stress management techniques during breaks',
            'Reflect on challenging calls to identify emotional triggers',
            'Seek support from supervisors or team leads when overwhelmed'
        ],
        resources: [
            { title: 'Emotional Regulation Techniques Workshop', url: '#' },
            { title: 'Mindfulness for Customer Service Professionals', url: '#' },
            { title: 'Stress Management and Resilience Training', url: '#' }
        ]
    },
    aht: {
        label: 'Average Handle Time',
        bestPractices: [
            'Have scripts and quick references readily available',
            'Use keyboard shortcuts and system commands efficiently',
            'Avoid unnecessary conversation - stay solution-focused',
            'Use hold time strategically for system navigation',
            'Practice your resolution steps for common issues'
        ],
        resources: [
            { title: 'Time Management for Call Center Reps', url: '#' },
            { title: 'System Navigation Shortcuts Guide', url: '#' },
            { title: 'Efficiency Training - OSCAR', url: '#' }
        ]
    },
    acw: {
        label: 'ACW (After-Call Work)',
        bestPractices: [
            'Complete all documentation while call details are fresh',
            'Use templates and quick notes to reduce ACW time',
            'Avoid multitasking during ACW - focus only on notes',
            'Minimize personal breaks between calls when possible',
            'Review ACW requirements to ensure compliance'
        ],
        resources: [
            { title: 'Efficient Documentation Practices', url: '#' },
            { title: 'ACW Best Practices Guide', url: '#' },
            { title: 'Note-Taking Efficiency Workshop', url: '#' }
        ]
    },
    holdTime: {
        label: 'Hold Time',
        bestPractices: [
            'Minimize hold time by gathering information first',
            'Use warm transfers when possible',
            'Check with departments before placing on hold',
            'Set clear expectations about how long they\'ll be on hold',
            'Use hold time for system navigation, not research'
        ],
        resources: [
            { title: 'Managing Hold Time Effectively', url: '#' },
            { title: 'Customer Communication During Holds', url: '#' },
            { title: 'System Navigation Tips and Tricks', url: '#' }
        ]
    },
    reliability: {
        label: 'Reliability (Hours)',
        bestPractices: [
            'Track your time away from desk/unavailable time',
            'Ensure you\'re ready to take calls at all scheduled times',
            'Minimize personal time during shift',
            'Plan meetings/breaks during designated break times',
            'Communicate any foreseeable absences in advance'
        ],
        resources: [
            { title: 'Attendance and Reliability Standards', url: '#' },
            { title: 'Time Tracking System Guide', url: '#' },
            { title: 'Managing Availability Throughout Your Shift', url: '#' }
        ]
    },
    safetyHazards: {
        label: 'Safety Hazards',
        bestPractices: [
            'Report all safety concerns immediately to supervisor',
            'Follow all safety protocols and procedures',
            'Attend safety training sessions',
            'Be aware of workplace hazards and ergonomics',
            'Participate in safety drills and preparedness exercises'
        ],
        resources: [
            { title: 'Workplace Safety Guidelines - APS', url: '#' },
            { title: 'Emergency Procedures Manual', url: '#' },
            { title: 'Ergonomic Workstation Setup Guide', url: '#' }
        ]
    },
    accComplaints: {
        label: 'ACC Complaints',
        bestPractices: [
            'Follow all customer service protocols',
            'Document interactions thoroughly and accurately',
            'Address customer concerns professionally and respectfully',
            'Seek supervisor input when customer is upset',
            'Review complaint feedback to prevent future issues'
        ],
        resources: [
            { title: 'APS Customer Service Standards', url: '#' },
            { title: 'Complaint Resolution Best Practices', url: '#' },
            { title: 'Professional Communication Guide', url: '#' }
        ]
    },
    phishingClicks: {
        label: 'Phishing Emails',
        bestPractices: [
            'Be suspicious of unexpected emails requesting information',
            'Never click links from unknown senders',
            'Verify sender identity before responding to requests',
            'Report suspicious emails to IT immediately',
            'Complete security awareness training annually'
        ],
        resources: [
            { title: 'Phishing Email Recognition Guide', url: '#' },
            { title: 'Cybersecurity Best Practices Training', url: '#' },
            { title: 'How to Report Security Incidents', url: '#' }
        ]
    },
    redFlags: {
        label: 'Red Flag Events',
        bestPractices: [
            'Know what constitutes a red flag in your role',
            'Report red flags to appropriate departments immediately',
            'Document what you observed with dates and details',
            'Follow escalation procedures',
            'Attend red flag awareness training'
        ],
        resources: [
            { title: 'Red Flag Indicators - APS Training', url: '#' },
            { title: 'Compliance and Reporting Procedures', url: '#' },
            { title: 'Escalation Protocol Guide', url: '#' }
        ]
    },
    depositWaiver: {
        label: 'Deposit Waiver Accuracy',
        bestPractices: [
            'Verify all deposit information before processing',
            'Double-check calculations and account numbers',
            'Review deposit guidelines thoroughly',
            'Ask for clarification when uncertain',
            'Keep detailed records of all deposit transactions'
        ],
        resources: [
            { title: 'Deposit Processing Standards', url: '#' },
            { title: 'Waiver Eligibility Criteria Guide', url: '#' },
            { title: 'Accuracy Verification Checklist', url: '#' }
        ]
    }
};

let currentMetrics = {};

// Form submission
document.getElementById('coachingForm').addEventListener('submit', function(e) {
    e.preventDefault();
    generateCoachingPlan();
});

// Reset handler
document.getElementById('coachingForm').addEventListener('reset', function() {
    document.getElementById('resultsSection').style.display = 'none';
});

// New coaching handler
document.getElementById('newCoaching').addEventListener('click', function() {
    document.getElementById('coachingForm').reset();
    document.getElementById('resultsSection').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

function generateCoachingPlan() {
    const employeeName = document.getElementById('employeeName').value;
    const pronouns = document.getElementById('pronouns').value;
    
    // Collect metrics
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
    
    // Identify struggling areas
    const strugglingAreas = identifyStrugglingAreas(currentMetrics);
    
    // Display results
    displayResults(strugglingAreas);
    document.getElementById('resultsSection').style.display = 'block';
    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
}

function identifyStrugglingAreas(metrics) {
    const struggling = [];
    
    // Check reliability metrics
    for (const [key, value] of Object.entries(metrics.reliability)) {
        const target = TARGETS.reliability[key];
        if (value !== target.value) {
            struggling.push({
                metricKey: key,
                metricLabel: target.label,
                actual: value,
                target: target.value,
                type: target.type,
                category: 'reliability'
            });
        }
    }
    
    // Check driver metrics
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
                type: target.type,
                category: 'drivers'
            });
        }
    }
    
    return struggling;
}

function displayResults(strugglingAreas) {
    const firstName = currentMetrics.name.trim().split(' ')[0];
    document.getElementById('resultName').textContent = firstName;
    
    // Display struggling areas
    if (strugglingAreas.length === 0) {
        document.getElementById('strugglingAreasSection').innerHTML = `
            <h3>Areas Requiring Focus</h3>
            <div class="empty-state">
                <p>🎉 Excellent news! All metrics are meeting targets. No areas requiring additional development.</p>
            </div>
        `;
    } else {
        let html = '<h3>Areas Requiring Focus</h3>';
        strugglingAreas.forEach(area => {
            html += `
                <div class="struggling-area">
                    <h4>${area.metricLabel}</h4>
                    <p><strong>Current:</strong> ${area.actual} | <strong>Target:</strong> ${area.target}</p>
                </div>
            `;
        });
        document.getElementById('strugglingAreasSection').innerHTML = html;
    }
    
    // Generate coaching script
    const coachingScript = generateCoachingScript(currentMetrics, strugglingAreas);
    document.getElementById('coachingScript').textContent = coachingScript;
    
    // Generate resources
    displayResources(strugglingAreas);
}

function generateCoachingScript(metrics, strugglingAreas) {
    const [subjective, objective, possessive] = getPronounForms(metrics.pronouns);
    const firstName = metrics.name.trim().split(' ')[0];
    
    if (strugglingAreas.length === 0) {
        return `${firstName}, your performance metrics demonstrate that you are consistently meeting or exceeding all targets. Continue building on these strengths and maintain your current level of excellence.`;
    }
    
    let script = `${firstName}, I'd like to discuss some opportunities for your continued professional development. `;
    script += `I've identified ${strugglingAreas.length} area${strugglingAreas.length > 1 ? 's' : ''} where we can focus your improvement efforts:\n\n`;
    
    strugglingAreas.forEach((area, index) => {
        script += `${index + 1}. ${area.metricLabel}: You're currently at ${area.actual}, and our target is ${area.target}. `;
        script += `This is an opportunity for you to strengthen your performance in this critical area. `;
        script += `Let's work together to develop an action plan with specific, measurable goals.\n`;
    });
    
    script += `\nThese areas represent genuine opportunities for professional growth. I'm committed to supporting you with coaching, resources, and feedback. `;
    script += `Let's schedule regular check-ins to monitor progress and adjust our approach as needed. What are your thoughts on these development priorities?`;
    
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
    let html = '<h3>Development Resources by Metric</h3>';
    
    if (strugglingAreas.length === 0) {
        html += '<div class="empty-state"><p>No additional resources needed at this time.</p></div>';
    } else {
        strugglingAreas.forEach(area => {
            const resources = METRIC_RESOURCES[area.metricKey];
            if (resources) {
                html += `<div class="metric-resources">`;
                html += `<h4>${resources.label}</h4>`;
                
                html += `<div class="best-practice"><strong>Best Practices:</strong><ul>`;
                resources.bestPractices.forEach(practice => {
                    html += `<li>${practice}</li>`;
                });
                html += `</ul></div>`;
                
                html += `<div class="resource-links"><strong>Learning Resources:</strong>`;
                resources.resources.forEach(resource => {
                    html += `<a href="${resource.url}" class="resource-link" target="_blank">${resource.title}</a>`;
                });
                html += `</div></div>`;
            }
        });
    }
    
    document.getElementById('resourcesSection').innerHTML = html;
}
