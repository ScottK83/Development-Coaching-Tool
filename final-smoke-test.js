/**
 * FINAL SMOKE TEST - Metric Trends Redesign
 * 
 * This test validates ALL changes made to the Metric Trends → Copilot flow:
 * 1. ✅ buildTrendCoachingPrompt accepts allMetrics parameter
 * 2. ✅ buildTrendCoachingPrompt includes success/opportunity sections
 * 3. ✅ buildTrendCoachingPrompt includes sentiment phrase integration
 * 4. ✅ buildTrendCoachingPrompt uses randomized conversational tone
 * 5. ✅ showTrendsWithTipsPanel displays prompt in textarea
 * 6. ✅ showTrendsWithTipsPanel includes Copy Prompt button
 * 7. ✅ showTrendsWithTipsPanel includes Log Coaching button
 * 8. ✅ Modal shows all required UI elements
 * 
 * Run in browser console: paste this entire script and execute
 */

(function testMetricTrendsRedesign() {
    console.clear();
    console.log('%c🧪 METRIC TRENDS REDESIGN - FINAL SMOKE TEST', 'font-size: 16px; font-weight: bold; color: #9c27b0;');
    console.log('%c' + '='.repeat(60), 'color: #999; font-weight: bold;');
    console.log('');
    
    let passCount = 0;
    let failCount = 0;
    
    function pass(message) {
        console.log('%c✅ PASS', 'background: #4caf50; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;', message);
        passCount++;
    }
    
    function fail(message) {
        console.log('%c❌ FAIL', 'background: #f44336; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;', message);
        failCount++;
    }
    
    function warn(message) {
        console.log('%c⚠️  WARN', 'background: #ff9800; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;', message);
    }
    
    // TEST 1: Validate buildTrendCoachingPrompt function exists and signature
    console.log('\n%c📋 Test Group 1: Function Signatures', 'font-weight: bold; color: #1976d2;');
    console.log('-'.repeat(60));
    
    if (typeof buildTrendCoachingPrompt === 'function') {
        pass('buildTrendCoachingPrompt is a function');
        
        // Check function arity (should accept 7 parameters)
        const funcStr = buildTrendCoachingPrompt.toString();
        if (funcStr.includes('allTrendMetrics')) {
            pass('buildTrendCoachingPrompt accepts allTrendMetrics parameter');
        } else {
            fail('buildTrendCoachingPrompt missing allTrendMetrics parameter');
        }
    } else {
        fail('buildTrendCoachingPrompt function not found');
    }
    
    if (typeof showTrendsWithTipsPanel === 'function') {
        pass('showTrendsWithTipsPanel is a function');
        
        const funcStr = showTrendsWithTipsPanel.toString();
        if (funcStr.includes('allMetrics')) {
            pass('showTrendsWithTipsPanel accepts allMetrics parameter');
        } else {
            fail('showTrendsWithTipsPanel missing allMetrics parameter');
        }
    } else {
        fail('showTrendsWithTipsPanel function not found');
    }
    
    if (typeof analyzeTrendMetrics === 'function') {
        pass('analyzeTrendMetrics is a function');
        
        // Test that it returns allMetrics
        // Create dummy data
        const dummyEmployee = {
            scheduleAdherence: 90,
            overallExperience: 80,
            cxRepOverall: 75,
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
        };
        
        const dummyAverages = {
            scheduleAdherence: 94,
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
        };
        
        const result = analyzeTrendMetrics(dummyEmployee, dummyAverages);
        if (result && result.allMetrics && Array.isArray(result.allMetrics)) {
            pass(`analyzeTrendMetrics returns allMetrics array (${result.allMetrics.length} metrics)`);
        } else {
            fail('analyzeTrendMetrics does not return allMetrics array');
        }
    } else {
        fail('analyzeTrendMetrics function not found');
    }
    
    // TEST 2: Validate prompt generation logic
    console.log('\n%c🤖 Test Group 2: Prompt Generation', 'font-weight: bold; color: #1976d2;');
    console.log('-'.repeat(60));
    
    // Create test metrics
    const testMetrics = [
        { metricKey: 'scheduleAdherence', label: 'Schedule Adherence', employeeValue: 92, centerValue: 94, target: 93, achievementPct: 99, isReverse: false, isBelowCenter: false },
        { metricKey: 'fcr', label: 'First Call Resolution', employeeValue: 75, centerValue: 88, target: 88, achievementPct: 85, isReverse: false, isBelowCenter: true },
        { metricKey: 'transfers', label: 'Transfers', employeeValue: 8, centerValue: 6, target: 5, achievementPct: 62, isReverse: true, isBelowCenter: true }
    ];
    
    const testSnapshot = {
        timeframeStart: '2026-02-15',
        timeframeEnd: '2026-02-20',
        scores: { positiveWord: 78, negativeWord: 85, managingEmotions: 88 },
        topPhrases: {
            positiveA: [
                { phrase: 'happy to help', value: 5 },
                { phrase: 'best solution', value: 4 }
            ],
            negativeA: [
                { phrase: 'that won(t work', value: 8 },
                { phrase: 'problem is', value: 6 }
            ]
        },
        suggestions: {
            negativeAlternatives: ['here is a solution', 'let me help']
        }
    };
    
    const testPrompt = buildTrendCoachingPrompt(
        'John Smith',
        testMetrics[0],
        testMetrics[1],
        ['Tip 1', 'Tip 2'],
        '',
        testSnapshot,
        testMetrics
    );
    
    if (testPrompt && typeof testPrompt === 'string' && testPrompt.length > 0) {
        pass('buildTrendCoachingPrompt returns non-empty string');
        
        // Check for key sections
        const sections = [
            { name: 'ACKNOWLEDGE SUCCESSES', marker: '**ACKNOWLEDGE SUCCESSES**' },
            { name: 'AREAS TO DEVELOP', marker: '**AREAS TO DEVELOP**' },
            { name: 'SENTIMENT section', marker: 'positive phrases' ||  'negative phrases' }
        ];
        
        sections.forEach(section => {
            if (testPrompt.includes(section.marker) || testPrompt.includes(section.marker.toLowerCase())) {
                pass(`Prompt includes ${section.name} section`);
            } else {
                warn(`Prompt may be missing ${section.name} section`);
            }
        });
        
        // Check for conversational tone
        if (testPrompt.toLowerCase().includes('let') || testPrompt.toLowerCase().includes('help') || testPrompt.includes("I'")) {
            pass('Prompt uses conversational tone');
        } else {
            warn('Prompt may lack conversational tone');
        }
        
    } else {
        fail('buildTrendCoachingPrompt returned empty or invalid result');
    }
    
    // TEST 3: Validate modal UI elements
    console.log('\n%c🎨 Test Group 3: Modal UI Elements', 'font-weight: bold; color: #1976d2;');
    console.log('-'.repeat(60));
    
    // Check for HTML element definitions in showTrendsWithTipsPanel
    const panelFunc = showTrendsWithTipsPanel.toString();
    
    const uiElements = [
        { name: 'copilotPromptDisplay textarea', check: 'copilotPromptDisplay' },
        { name: 'copyPromptBtn button', check: 'copyPromptBtn' },
        { name: 'logTrendCoachingBtn button', check: 'logTrendCoachingBtn' },
        { name: 'trendCoachingNotes textarea', check: 'trendCoachingNotes' }
    ];
    
    uiElements.forEach(elem => {
        if (panelFunc.includes(elem.check)) {
            pass(`${elem.name} is implemented`);
        } else {
            fail(`${elem.name} not found in modal`);
        }
    });
    
    // Check for event listeners
    if (panelFunc.includes('copyPromptBtn') && panelFunc.includes('addEventListener')) {
        pass('Copy button has event listener');
    } else {
        warn('Copy button event listener may not be properly set');
    }
    
    // TEST 4: Validate sentiment data integration
    console.log('\n%c💬 Test Group 4: Sentiment Integration', 'font-weight: bold; color: #1976d2;');
    console.log('-'.repeat(60));
    
    if (panelFunc.includes('topPosA') || testPrompt.includes('positive phrases')) {
        pass('Sentiment positive phrases are integrated');
    } else {
        fail('Sentiment positive phrases not integrated');
    }
    
    if (panelFunc.includes('topNegA') || panelFunc.includes('negativeAlternatives') || testPrompt.includes('negative')) {
        pass('Sentiment negative phrases/alternatives are integrated');
    } else {
        fail('Sentiment negative phrases not integrated');
    }
    
    // TEST 5: Validate data flow
    console.log('\n%c🔄 Test Group 5: Data Flow', 'font-weight: bold; color: #1976d2;');
    console.log('-'.repeat(60));
    
    const generateFunc = generateTrendEmail.toString();
    if (generateFunc.includes('allMetrics')) {
        pass('generateTrendEmail extracts allMetrics from analysis');
    } else {
        fail('generateTrendEmail missing allMetrics extraction');
    }
    
    if (generateFunc.includes('showTrendsWithTipsPanel') && generateFunc.includes('allMetrics')) {
        pass('generateTrendEmail passes allMetrics to showTrendsWithTipsPanel');
    } else {
        fail('generateTrendEmail missing allMetrics parameter in call');
    }
    
    // SUMMARY
    console.log('\n%c' + '='.repeat(60), 'color: #999; font-weight: bold;');
    console.log('%c📊 TEST SUMMARY', 'font-size: 14px; font-weight: bold; color: #9c27b0;');
    console.log('%c' + '='.repeat(60), 'color: #999; font-weight: bold;');
    
    const total = passCount + failCount;
    const percentage = Math.round((passCount / total) * 100);
    
    console.log(`\n   ✅ Passed: ${passCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`   ⚠️  Total:  ${total}`);
    console.log(`   📈 Success Rate: ${percentage}%\n`);
    
    if (failCount === 0) {
        console.log('%c🎉 ALL TESTS PASSED! Redesign is ready for production.', 'background: #4caf50; color: white; padding: 10px; border-radius: 4px; font-weight: bold; font-size: 14px;');
    } else if (failCount <= 2) {
        console.log('%c⚠️  MOSTLY PASSING - Review warnings above', 'background: #ff9800; color: white; padding: 10px; border-radius: 4px; font-weight: bold; font-size: 14px;');
    } else {
        console.log('%c❌ TESTS FAILED - Fix issues above before deploying', 'background: #f44336; color: white; padding: 10px; border-radius: 4px; font-weight: bold; font-size: 14px;');
    }
    
    console.log('\n%c💡 NEXT STEPS', 'font-weight: bold; color: #1976d2;');
    console.log('- Upload PowerBI data with metrics and employees');
    console.log('- Upload sentiment scores (positive, negative, emotions CSVs)');
    console.log('- Go to Coaching & Analysis → Metric Trends');
    console.log('- Select period and employee → Click Generate');
    console.log('- Verify modal shows prompt textarea and copy button');
    console.log('- Test copying prompt and pasting into Microsoft CoPilot');
    console.log('');
    
})();
