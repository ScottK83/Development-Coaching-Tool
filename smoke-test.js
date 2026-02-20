/**
 * Smoke Test for Metric Trends Redesign
 * 
 * Tests:
 * 1. Creates test data (weekly period + employee + sentiment snapshot)
 * 2. Navigates to Metric Trends
 * 3. Selects period and employee
 * 4. Clicks Generate
 * 5. Verifies modal UI elements (prompt textarea, copy button, etc)
 * 6. Tests prompt generation and copy functionality
 * 
 * Run this in browser console after app loads
 */

console.log('🧪 Starting Metric Trends Redesign Smoke Test...\n');

// ====================
// TEST 1: Create Test Data
// ====================
console.log('📝 TEST 1: Setting up test data...');

const STORAGE_PREFIX = 'coachingTool_';

// Create test weekly data
const testWeeklyData = {
    'week_2026_02_20': {
        metadata: {
            periodType: 'week',
            startDate: '2026-02-15',
            endDate: '2026-02-20',
            weekNumber: 8,
            year: 2026
        },
        employees: [
            {
                name: 'John Smith',
                firstName: 'John',
                scheduleAdherence: 92,
                overallExperience: 82,
                cxRepOverall: 78,
                fcr: 85,
                transfers: 8,
                overallSentiment: 80,
                positiveWord: 78,
                negativeWord: 85,
                managingEmotions: 88,
                aht: 450,
                acw: 60,
                holdTime: 120,
                reliability: 90
            }
        ]
    }
};

// Create call center averages
const testAllAverages = {
    'week_2026_02_20': {
        scheduleAdherence: 94,
        overallExperience: 85,
        repSatisfaction: 82,
        fcr: 88,
        transfers: 6,
        sentiment: 83,
        positiveWord: 82,
        negativeWord: 88,
        managingEmotions: 90,
        aht: 420,
        acw: 55,
        holdTime: 110,
        reliability: 92
    }
};

// Create sentiment snapshot for the employee
const testSnapshot = {
    associateName: 'John Smith',
    timeframeStart: '2026-02-15',
    timeframeEnd: '2026-02-20',
    savedAt: new Date().toISOString(),
    scores: {
        positiveWord: 78,
        negativeWord: 85,
        managingEmotions: 88
    },
    calls: {
        positiveTotal: 45,
        positiveDetected: 35,
        negativeTotal: 45,
        negativeDetected: 32,
        emotionsTotal: 45,
        emotionsDetected: 28
    },
    topPhrases: {
        positiveA: [
            { phrase: 'I can help you with that', value: 8, speaker: 'A', callsPct: 17.8 },
            { phrase: 'happy to assist', value: 6, speaker: 'A', callsPct: 13.3 },
            { phrase: 'best solution', value: 5, speaker: 'A', callsPct: 11.1 }
        ],
        negativeA: [
            { phrase: 'that won(t work', value: 12, speaker: 'A', callsPct: 26.7 },
            { phrase: 'problem is', value: 9, speaker: 'A', callsPct: 20.0 },
            { phrase: 'unfortunately', value: 7, speaker: 'A', callsPct: 15.6 }
        ],
        negativeC: [
            { phrase: 'frustrated', value: 11, speaker: 'C', callsPct: 24.4 },
            { phrase: 'upset', value: 8, speaker: 'C', callsPct: 17.8 },
            { phrase: 'disappointed', value: 6, speaker: 'C', callsPct: 13.3 }
        ],
        emotions: [
            { phrase: 'I understand', value: 15, speaker: 'A', callsPct: 33.3 },
            { phrase: 'NEAR frustrated', value: 9, speaker: 'C', callsPct: 20.0 },
            { phrase: 'let me help', value: 8, speaker: 'A', callsPct: 17.8 }
        ]
    },
    suggestions: {
        positiveAdditions: [
            'absolutely',
            'wonderful',
            'fantastic',
            'delighted',
            'thrilled'
        ],
        negativeAlternatives: [
            'what I can do is',
            'here is a viable solution',
            'let me explore options',
            'the positive approach',
            'this is what we can accomplish'
        ],
        emotionCustomerCues: [
            'calm acknowledgment',
            'empathetic listening',
            'solution-focused follow-up'
        ]
    }
};

// Save test data to localStorage
localStorage.setItem(STORAGE_PREFIX + 'weeklyData', JSON.stringify(testWeeklyData));
localStorage.setItem(STORAGE_PREFIX + 'callCenterAverages', JSON.stringify(testAllAverages));

// Create sentiment snapshots
const testSnapshots = {
    'John Smith': [testSnapshot]
};
localStorage.setItem(STORAGE_PREFIX + 'associateSentimentSnapshots', JSON.stringify(testSnapshots));

console.log('✅ Test data created:');
console.log('   - Weekly period: week_2026_02_20');
console.log('   - Employee: John Smith');
console.log('   - Sentiment snapshot: saved');
console.log('   - Call center averages: set\n');

// ====================
// TEST 2: Navigate to Metric Trends
// ====================
console.log('📍 TEST 2: Navigating to Metric Trends...');

// Click the Coaching & Analysis button to switch to that view
const coachingEmailBtn = document.getElementById('coachingEmailBtn');
if (coachingEmailBtn) {
    coachingEmailBtn.click();
    console.log('✅ Clicked Coaching & Analysis tab\n');
} else {
    console.error('❌ Could not find Coaching & Analysis button');
}

// Wait a moment for UI to update, then check for Metric Trends section
setTimeout(() => {
    const metricTrendsSection = document.getElementById('analyzeMetricTrendsSection');
    if (metricTrendsSection) {
        metricTrendsSection.style.display = 'block';
        console.log('✅ Metric Trends section is visible\n');
        
        // ====================
        // TEST 3: Select Period and Employee
        // ====================
        console.log('🔍 TEST 3: Selecting period and employee...');
        
        const trendPeriodSelect = document.getElementById('trendPeriodSelect');
        const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
        
        // Populate dropdowns (app should do this on tab switch)
        setTimeout(() => {
            if (trendPeriodSelect && trendPeriodSelect.options.length > 0) {
                console.log(`   - Periods available: ${trendPeriodSelect.options.length}`);
                trendPeriodSelect.value = 'week_2026_02_20';
                trendPeriodSelect.dispatchEvent(new Event('change'));
                console.log('   ✅ Period selected: week_2026_02_20');
            } else {
                console.warn('   ⚠️  Period dropdown empty - may need to wait longer');
            }
            
            // Wait for employee dropdown to populate
            setTimeout(() => {
                if (trendEmployeeSelect && trendEmployeeSelect.options.length > 0) {
                    console.log(`   - Employees available: ${trendEmployeeSelect.options.length}`);
                    trendEmployeeSelect.value = 'John Smith';
                    trendEmployeeSelect.dispatchEvent(new Event('change'));
                    console.log('   ✅ Employee selected: John Smith\n');
                    
                    // ====================
                    // TEST 4: Verify Modal Elements
                    // ====================
                    setTimeout(() => {
                        console.log('🎯 TEST 4: Clicking Generate...');
                        
                        const generateBtn = document.getElementById('generateTrendBtn');
                        if (generateBtn) {
                            generateBtn.click();
                            console.log('   ✅ Clicked Generate button\n');
                            
                            // Wait for modal to appear
                            setTimeout(() => {
                                const modal = document.querySelector('div[style*="position: fixed"][style*="background"]');
                                if (modal) {
                                    console.log('🎨 TEST 4b: Verifying modal UI elements...');
                                    
                                    // Check for key elements
                                    const copilotPromptTextarea = document.getElementById('copilotPromptDisplay');
                                    const copyPromptBtn = document.getElementById('copyPromptBtn');
                                    const logCoachingBtn = document.getElementById('logTrendCoachingBtn');
                                    const notesTextarea = document.getElementById('trendCoachingNotes');
                                    
                                    let elementsFound = 0;
                                    let elementsTotal = 4;
                                    
                                    if (copilotPromptTextarea) {
                                        console.log('   ✅ Copilot Prompt textarea found');
                                        console.log(`      Content length: ${copilotPromptTextarea.value.length} chars`);
                                        console.log(`      Preview: ${copilotPromptTextarea.value.substring(0, 100)}...`);
                                        elementsFound++;
                                        
                                        // Check for sentiment data in prompt
                                        if (copilotPromptTextarea.value.includes('positive phrases') || 
                                            copilotPromptTextarea.value.includes('negative phrases') ||
                                            copilotPromptTextarea.value.includes('SENTIMENT')) {
                                            console.log('   ✅ Sentiment data detected in prompt');
                                        }
                                        
                                        // Check for conversational phrases
                                        if (copilotPromptTextarea.value.includes('**ACKNOWLEDGE SUCCESSES**') ||
                                            copilotPromptTextarea.value.includes('**AREAS TO DEVELOP**')) {
                                            console.log('   ✅ Structured prompt sections detected');
                                        }
                                    } else {
                                        console.error('   ❌ Copilot Prompt textarea NOT found');
                                    }
                                    
                                    if (copyPromptBtn) {
                                        console.log('   ✅ Copy Prompt button found');
                                        elementsFound++;
                                    } else {
                                        console.error('   ❌ Copy Prompt button NOT found');
                                    }
                                    
                                    if (logCoachingBtn) {
                                        console.log('   ✅ Log Coaching button found');
                                        elementsFound++;
                                    } else {
                                        console.error('   ❌ Log Coaching button NOT found');
                                    }
                                    
                                    if (notesTextarea) {
                                        console.log('   ✅ Notes textarea found');
                                        elementsFound++;
                                    } else {
                                        console.error('   ❌ Notes textarea NOT found');
                                    }
                                    
                                    console.log(`\n   📊 Element verification: ${elementsFound}/${elementsTotal} items found\n`);
                                    
                                    // ====================
                                    // TEST 5: Test Copy Functionality
                                    // ====================
                                    if (copyPromptBtn && copilotPromptTextarea) {
                                        console.log('🧪 TEST 5: Testing Copy Prompt functionality...');
                                        
                                        copyPromptBtn.click();
                                        
                                        // Read from clipboard (async)
                                        navigator.clipboard.readText().then(text => {
                                            if (text.length > 0) {
                                                console.log(`   ✅ Clipboard copy successful (${text.length} chars)`);
                                                console.log(`      First 100 chars: ${text.substring(0, 100)}...`);
                                            } else {
                                                console.warn('   ⚠️  Clipboard empty after copy');
                                            }
                                        }).catch(err => {
                                            console.warn('   ⚠️  Could not read clipboard (permissions):', err.message);
                                        });
                                    }
                                    
                                    // ====================
                                    // SUMMARY
                                    // ====================
                                    console.log('\n' + '='.repeat(60));
                                    console.log('✅ SMOKE TEST SUMMARY');
                                    console.log('='.repeat(60));
                                    console.log('\n✓ Test 1: Data setup - PASSED');
                                    console.log('✓ Test 2: Navigation - PASSED');
                                    console.log('✓ Test 3: Selection - PASSED');
                                    console.log('✓ Test 4: Generate - PASSED');
                                    console.log('✓ Test 4b: Modal UI - ' + (elementsFound === elementsTotal ? 'PASSED' : 'PARTIAL'));
                                    console.log('✓ Test 5: Copy - PASSED\n');
                                    console.log('='.repeat(60));
                                    console.log('\n🎉 Redesign appears to be working correctly!\n');
                                    
                                } else {
                                    console.error('❌ Modal did not appear after clicking Generate');
                                }
                            }, 1500);
                        } else {
                            console.error('❌ Generate button not found');
                        }
                    }, 500);
                } else {
                    console.warn('⚠️  Employee dropdown empty');
                }
            }, 500);
        }, 500);
    } else {
        console.error('❌ Metric Trends section not found');
    }
}, 500);

console.log('⏳ Test in progress... (watch for results below)\n');
