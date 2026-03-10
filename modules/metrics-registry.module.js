/**
 * Metrics Registry Module
 * Central definition of all tracked performance metrics.
 * Loaded before all other modules and script.js.
 */
(function() {
    'use strict';

    const METRICS_REGISTRY = {
        scheduleAdherence: {
            key: 'scheduleAdherence',
            label: 'Schedule Adherence',
            icon: '📅',
            target: { type: 'min', value: 93 },
            unit: '%',
            columnIndex: 8,
            chartType: 'line',
            chartColor: '#2196F3',
            defaultTip: "Schedule Adherence: Being present and available is essential. Work on meeting your scheduled hours consistently."
        },
        cxRepOverall: {
            key: 'cxRepOverall',
            label: 'Rep Satisfaction',
            icon: '😊',
            target: { type: 'min', value: 82 },
            unit: '%',
            columnIndex: 15,
            chartType: 'line',
            chartColor: '#4CAF50',
            defaultTip: "Focus on building stronger connections with customers through empathy and professionalism. Listen actively and show genuine care for their concerns."
        },
        fcr: {
            key: 'fcr',
            label: 'First Call Resolution',
            icon: '✅',
            target: { type: 'min', value: 73 },
            unit: '%',
            columnIndex: 13,
            chartType: 'line',
            chartColor: '#FF5722',
            defaultTip: "Work on resolving more issues on the first contact. Take time to fully understand the problem before offering solutions."
        },
        overallExperience: {
            key: 'overallExperience',
            label: 'Overall Experience',
            icon: '⭐',
            target: { type: 'min', value: 75 },
            unit: '%',
            columnIndex: 17,
            chartType: null,
            chartColor: null,
            defaultTip: "Focus on creating more positive customer experiences. Personalize your interactions and ensure each customer feels valued."
        },
        transfers: {
            key: 'transfers',
            label: 'Transfers',
            icon: '🔄',
            target: { type: 'max', value: 6 },
            unit: '%',
            columnIndex: 2,
            chartType: 'bar',
            chartColor: '#FF9800',
            defaultTip: "Transfers: You're managing transfers well. When possible, try to resolve issues yourself to enhance the customer experience."
        },
        transfersCount: {
            key: 'transfersCount',
            label: 'Number of Transfers',
            icon: '🔢',
            target: { type: 'max', value: 20 },
            unit: '',
            columnIndex: 3,
            chartType: 'bar',
            chartColor: '#FF6F00',
            defaultTip: "Number of Transfers: Monitor your total transfer count. Focus on resolving issues independently when possible."
        },
        overallSentiment: {
            key: 'overallSentiment',
            label: 'Overall Sentiment',
            icon: '💭',
            target: { type: 'min', value: 88 },
            unit: '%',
            columnIndex: 12,
            chartType: 'line',
            chartColor: '#E91E63',
            defaultTip: "Work on maintaining a more positive tone throughout your interactions. Your words and attitude significantly impact customer experience."
        },
        positiveWord: {
            key: 'positiveWord',
            label: 'Positive Word',
            icon: '👍',
            target: { type: 'min', value: 86 },
            unit: '%',
            columnIndex: 11,
            chartType: 'line',
            chartColor: '#4CAF50',
            defaultTip: "Increase your use of positive language. Use encouraging and supportive words on EVERY call to reach 100% usage."
        },
        negativeWord: {
            key: 'negativeWord',
            label: 'Avoid Negative Words',
            icon: '⚠️',
            target: { type: 'min', value: 83 },
            unit: '%',
            columnIndex: 10,
            chartType: 'line',
            chartColor: '#F44336',
            defaultTip: "Work on eliminating negative words from your conversations. Replace negative phrases with positive alternatives."
        },
        managingEmotions: {
            key: 'managingEmotions',
            label: 'Managing Emotions',
            icon: '😌',
            target: { type: 'min', value: 95 },
            unit: '%',
            columnIndex: 9,
            chartType: 'line',
            chartColor: '#00BCD4',
            defaultTip: "Focus on maintaining composure during challenging interactions. Stay calm and professional even when customers are upset."
        },
        aht: {
            key: 'aht',
            label: 'Average Handle Time',
            icon: '⏱️',
            target: { type: 'max', value: 426 },
            unit: 'sec',
            columnIndex: 4,
            chartType: 'line',
            chartColor: '#9C27B0',
            defaultTip: "Average Handle Time: Focus on efficiency without rushing. Prepare your responses, but don't skip necessary steps."
        },
        acw: {
            key: 'acw',
            label: 'After Call Work',
            icon: '📝',
            target: { type: 'max', value: 60 },
            unit: 'sec',
            columnIndex: 7,
            chartType: 'bar',
            chartColor: '#3F51B5',
            defaultTip: "After Call Work: Complete your documentation promptly. This keeps you available for the next customer and maintains accuracy."
        },
        holdTime: {
            key: 'holdTime',
            label: 'Hold Time',
            icon: '⏳',
            target: { type: 'max', value: 30 },
            unit: 'sec',
            columnIndex: 6,
            chartType: 'bar',
            chartColor: '#009688',
            defaultTip: "Hold Time: Minimize hold time by gathering information upfront. It improves customer experience and efficiency."
        },
        reliability: {
            key: 'reliability',
            label: 'Reliability',
            icon: '🎯',
            target: { type: 'max', value: 16 },
            unit: 'hrs',
            columnIndex: 22,
            chartType: 'bar',
            chartColor: '#795548',
            defaultTip: "Reliability: Your availability is crucial. Work toward reducing unexpected absences and maintaining consistent attendance."
        }
    };

    // Expose globally so script.js and all modules can use it directly
    window.METRICS_REGISTRY = METRICS_REGISTRY;

    // Also register in module system
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.metricsRegistry = METRICS_REGISTRY;
})();
