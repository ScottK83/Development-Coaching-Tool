(function() {
    'use strict';

    // ============================================
    // COACHING ANALYSIS & EMAIL GENERATION
    // ============================================

    /**
     * Generate trend email with metrics analysis
     * Orchestrates: email image creation + Outlook launch + coaching prompt panel
     */
    function generateTrendEmail() {
        const employeeName = document.getElementById('trendEmployeeSelect')?.value;
        const weekKey = document.getElementById('trendPeriodSelect')?.value;
        const nickname = document.getElementById('trendNickname')?.value.trim();
        
        if (!employeeName || !weekKey) {
            window.showToast?.('Please select both employee and period', 5000);
            return;
        }

        if (employeeName && nickname) {
            window.DevCoachModules?.storage?.saveNickname?.(employeeName, nickname);
        }
        
        // Get current period data (weekly only)
        const storage = window.DevCoachModules?.storage;
        const weeklyData = storage?.loadWeeklyData?.() || {};
        const ytdData = storage?.loadYtdData?.() || {};
        const period = weeklyData[weekKey];
        if (!period) {
            if (ytdData[weekKey]) {
                window.showToast?.('YTD period selected. Please select a weekly period for Metric Trends.', 5000);
            } else {
                window.showToast?.('No data found for this period', 5000);
            }
            return;
        }
        
        const employee = period.employees.find(e => e.name === employeeName);
        if (!employee) {
            window.showToast?.('Employee not found in selected period', 5000);
            return;
        }
        
        const displayName = nickname || employeeName;
        window.showToast?.('ℹ️ Creating email image...', 3000);
        
        const centerAvgs = window.getCallCenterAverageForPeriod?.(weekKey) || {};
        const reviewYear = parseInt((period?.metadata?.endDate || '').split('-')[0], 10) || null;

        // Analyze metrics: find weakest + trending down
        const trendAnalysis = window.analyzeTrendMetrics?.(employee, centerAvgs, reviewYear);
        const weakestMetric = trendAnalysis?.weakest;
        const trendingMetric = trendAnalysis?.trendingDown;
        const allMetrics = trendAnalysis?.allMetrics || [];  
        
        // Get tips for BOTH weakest and trending metrics
        let tipsForWeakest = [];
        let tipsForTrending = [];
        if (weakestMetric) {
            tipsForWeakest = window.getRandomTipsForMetric?.(weakestMetric.metricKey, 2) || [];
        }
        if (trendingMetric) {
            tipsForTrending = window.getRandomTipsForMetric?.(trendingMetric.metricKey, 2) || [];
        }

        const periodMeta = period.metadata || {};
        
        // Get sentiment snapshot from dropdown
        let sentimentSnapshot = null;
        const sentimentSelect = document.getElementById('trendSentimentSelect');
        const selectedSentiment = sentimentSelect?.value;
        
        if (selectedSentiment) {
            const [startDate, endDate] = selectedSentiment.split('|');
            const allSnapshots = storage?.loadAssociateSentimentSnapshots?.() || {};
            const snapshots = allSnapshots[employeeName];
            
            if (snapshots && Array.isArray(snapshots)) {
                const matchingSnapshot = snapshots.find(s => 
                    s.timeframeStart === startDate && s.timeframeEnd === endDate
                );
                if (matchingSnapshot) {
                    sentimentSnapshot = matchingSnapshot;
                }
            }
        }
        
        window.createTrendEmailImage?.(displayName, weekKey, period, employee, null, () => {
            const mailPeriodType = periodMeta.periodType === 'week' ? 'Weekly' : periodMeta.periodType === 'month' ? 'Monthly' : 'Weekly';
            const emailSubject = `${mailPeriodType} Check-in - ${displayName}`;
            
            openTrendEmailOutlook(emailSubject, employeeName);
            window.showToast?.('📧 Outlook opening... Image is copied to clipboard. Paste into email body, then use the prompt below.', 4000);
            
            if (weakestMetric || trendingMetric) {
                window.showTrendsWithTipsPanel?.(employeeName, displayName, weakestMetric, trendingMetric, tipsForWeakest, tipsForTrending, weekKey, periodMeta, emailSubject, sentimentSnapshot, allMetrics);
            }
        });
    }

    function buildEmployeeEmail(name) {
        if (!name || name === 'Team') return '';
        var n = String(name).trim();
        var first, last;
        if (n.indexOf(',') !== -1) {
            var parts = n.split(',');
            last = parts[0].trim();
            first = (parts[1] || '').trim();
        } else {
            var parts = n.split(/\s+/);
            first = parts[0] || '';
            last = parts.slice(1).join(' ');
        }
        if (!first || !last) return '';
        first = first.split(/\s+/)[0].toLowerCase();
        last = last.split(/\s+/)[0].toLowerCase();
        return first + '.' + last + '@aps.com';
    }

    function openTrendEmailOutlook(emailSubject, employeeName) {
        try {
            const toAddress = buildEmployeeEmail(employeeName);
            const mailtoLink = document.createElement('a');
            mailtoLink.href = `mailto:${encodeURIComponent(toAddress)}?subject=${encodeURIComponent(emailSubject)}`;
            document.body.appendChild(mailtoLink);
            mailtoLink.click();
            document.body.removeChild(mailtoLink);
        } catch(e) {
            console.error('Error opening mailto:', e);
        }
    }

    /**
     * Build coaching prompt for CoPilot email generation
     */
    function buildTrendCoachingPrompt(displayName, weakestMetric, trendingMetric, tipsForWeakest, tipsForTrending, userNotes, sentimentSnapshot = null, allTrendMetrics = null) {
        if (typeof window.buildTrendCoachingPrompt === 'function') {
            return window.buildTrendCoachingPrompt(
                displayName,
                weakestMetric,
                trendingMetric,
                tipsForWeakest,
                tipsForTrending,
                userNotes,
                sentimentSnapshot,
                allTrendMetrics
            );
        }

        const successes = allTrendMetrics 
            ? allTrendMetrics.filter(m => m.meetsTarget) 
            : [];
        
        let prompt = `Draft a coaching email for ${displayName}.\n\n`;
        
        if (successes.length > 0) {
            prompt += `WINS:\n`;
            successes.slice(0, 3).forEach(metric => {
                prompt += `- ${metric.label}: ${metric.employeeValue.toFixed(1)} (target: ${metric.target.toFixed(1)})\n`;
            });
            prompt += `\n`;
        }
        
        const opportunities = allTrendMetrics 
            ? allTrendMetrics.filter(m => !m.meetsTarget)
            : [];
        
        if (opportunities.length > 0) {
            prompt += `OPPORTUNITIES:\n`;
            opportunities.slice(0, 3).forEach(metric => {
                let displayValue = `${metric.employeeValue.toFixed(1)} (target: ${metric.target.toFixed(1)})`;
                if (metric.metricKey === 'negativeWord') {
                    const usingNegative = (100 - metric.employeeValue).toFixed(1);
                    const usingNegativeTarget = (100 - metric.target).toFixed(1);
                    displayValue = `${metric.employeeValue.toFixed(1)}% avoiding, ${usingNegative}% using negative words (target: avoid ${metric.target.toFixed(1)}%, use ${usingNegativeTarget}%)`;
                }
                prompt += `- ${metric.label}: ${displayValue}\n`;
            });
            prompt += `\n`;
        }
        
        if ((weakestMetric && tipsForWeakest?.length > 0) || 
            (trendingMetric && tipsForTrending?.length > 0)) {
            prompt += `HOW TO IMPROVE:\n`;
            
            if (weakestMetric && tipsForWeakest?.length > 0) {
                prompt += `\n${weakestMetric.label}:\n`;
                tipsForWeakest.forEach((tip, i) => {
                    prompt += `  ${i + 1}. ${tip}\n`;
                });
            }
            
            if (trendingMetric && tipsForTrending?.length > 0) {
                prompt += `\n${trendingMetric.label}:\n`;
                tipsForTrending.forEach((tip, i) => {
                    prompt += `  ${i + 1}. ${tip}\n`;
                });
            }
            
            prompt += `\n`;
        }
        
        if (sentimentSnapshot) {
            const sentimentMetrics = allTrendMetrics
                ? {
                    negativeWord: allTrendMetrics.find(m => m.metricKey === 'negativeWord')?.employeeValue,
                    positiveWord: allTrendMetrics.find(m => m.metricKey === 'positiveWord')?.employeeValue,
                    managingEmotions: allTrendMetrics.find(m => m.metricKey === 'managingEmotions')?.employeeValue
                }
                : null;
            const sentimentFocusText = window.buildSentimentFocusAreasForPrompt?.(sentimentSnapshot, sentimentMetrics);
            if (sentimentFocusText) {
                prompt += `SENTIMENT DATA:\n${sentimentFocusText}\n\n`;
            }
        }
        
        if (userNotes?.trim()) {
            prompt += `MANAGER NOTES:\n${userNotes}\n\n`;
        }
        
        return prompt + `Email should be encouraging, specific, and actionable.`;
    }

    /**
     * Analyze trend metrics for coaching
     */
    function analyzeTrendMetrics(employeeData, centerAverages, reviewYear = null) {
        if (typeof window.analyzeTrendMetrics === 'function') {
            return window.analyzeTrendMetrics(employeeData, centerAverages, reviewYear);
        }

        const allMetrics = [];
        const metricMappings = {
            scheduleAdherence: 'scheduleAdherence',
            cxRepOverall: 'repSatisfaction',
            fcr: 'fcr',
            overallExperience: 'overallExperience',
            transfers: 'transfers',
            overallSentiment: 'sentiment',
            positiveWord: 'positiveWord',
            negativeWord: 'negativeWord',
            managingEmotions: 'managingEmotions',
            aht: 'aht',
            acw: 'acw',
            holdTime: 'holdTime',
            reliability: 'reliability'
        };
        
        const isReverse = (key) => ['transfers', 'aht', 'holdTime', 'acw', 'reliability'].includes(key);
        
        Object.entries(metricMappings).forEach(([registryKey, csvKey]) => {
            const employeeValue = parseFloat(employeeData?.[registryKey]) || 0;
            const centerValue = parseFloat(centerAverages?.[csvKey]) || 0;
            const metric = window.METRICS_REGISTRY?.[registryKey];
            
            if (!metric || employeeValue === 0) return;
            
            const target = window.DevCoachModules?.metrics?.getMetricTarget?.(registryKey, reviewYear) || metric?.target?.value || 0;
            const targetType = metric?.target?.type || 'min';
            
            const meetsTarget = targetType === 'min' 
                ? employeeValue >= target 
                : employeeValue <= target;
            
            const isBelowCenter = centerValue > 0 
                ? (isReverse(registryKey) ? employeeValue > centerValue : employeeValue < centerValue)
                : false;
            
            allMetrics.push({
                metricKey: registryKey,
                label: metric.label,
                employeeValue,
                centerValue,
                target,
                targetType,
                meetsTarget,
                isReverse: isReverse(registryKey),
                isBelowCenter,
                gap: Math.abs(employeeValue - centerValue),
                gapFromTarget: targetType === 'min' 
                    ? Math.max(0, target - employeeValue)  
                    : Math.max(0, employeeValue - target)  
            });
        });
        
        const notMeetingTarget = allMetrics.filter(m => !m.meetsTarget);
        const weakest = notMeetingTarget.length > 0
            ? notMeetingTarget.reduce((prev, curr) => 
                curr.gapFromTarget > prev.gapFromTarget ? curr : prev
              )
            : null;
        
        const nonSentimentNotMeetingTarget = notMeetingTarget.filter(m => 
            !['positiveWord', 'negativeWord', 'managingEmotions'].includes(m.metricKey) &&
            m.metricKey !== weakest?.metricKey
        );
        
        const trendingDown = nonSentimentNotMeetingTarget.length > 0
            ? nonSentimentNotMeetingTarget[Math.floor(Math.random() * nonSentimentNotMeetingTarget.length)]
            : notMeetingTarget.find(m => m.metricKey !== weakest?.metricKey) || null;
        
        return {
            weakest,
            trendingDown,
            allMetrics
        };
    }

    // Export functions
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.coachingAnalysis = {
        generateTrendEmail,
        openTrendEmailOutlook,
        buildTrendCoachingPrompt,
        analyzeTrendMetrics
    };
})();
