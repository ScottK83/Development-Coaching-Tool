(function() {
    'use strict';

    // ============================================
    // EMAIL IMAGE & FORMATTING
    // ============================================

    /**
     * Create trend email image with Chart.js
     */
    function createTrendEmailImage(empName, weekKey, period, employee, prevEmployee, onClipboardReady) {
        // Use canvas to draw email with metrics
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
            console.error('Could not get canvas context');
            return;
        }
        
        // Draw background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw title
        drawEmailCard(ctx, 20, 20, 760, 80, '#2196F3', '#1976D2', 
            'Trending Metrics Report', `For ${empName}`, period.metadata?.endDate || 'Latest Week');
        
        // Draw metrics summary
        const metricsToShow = getMetricOrder?.() || [];
        let yPos = 120;
        
        metricsToShow.slice(0, 5).forEach((metricConfig, i) => {
            const metricValue = employee?.[metricConfig.key];
            if (!metricValue) return;
            
            const prevValue = prevEmployee?.[metricConfig.key];
            const delta = prevValue ? (metricValue - prevValue).toFixed(2) : '—';
            const arrow = delta > 0 ? '📈' : delta < 0 ? '📉' : '➡️';
            
            const bgColor = i % 2 === 0 ? '#f5f5f5' : '#ffffff';
            drawEmailCard(ctx, 20, yPos, 760, 50, bgColor, '#ddd',
                metricConfig.label,
                `${metricValue} (${arrow} ${delta})`,
                ``);
            
            yPos += 60;
        });
        
        // Copy to clipboard and trigger callback
        try {
            canvas.toBlob(blob => {
                const item = new ClipboardItem({ 'image/png': blob });
                navigator.clipboard.write([item]).then(() => {
                    window.DevCoachModules?.uiUtils?.showToast?.('📋 Email image copied to clipboard!', 3000);
                    onClipboardReady?.();
                }).catch(err => {
                    console.error('Clipboard error:', err);
                    // Fallback: open image in new tab
                    const url = URL.createObjectURL(blob);
                    window.open(url);
                    onClipboardReady?.();
                });
            });
        } catch (e) {
            console.error('Error creating email image:', e);
            onClipboardReady?.();
        }
    }

    /**
     * Download email image as file
     */
    function downloadImageFallback(blob, empName, period) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${empName}_${period}_metrics.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    /**
     * Draw formatted email card section
     */
    function drawEmailCard(ctx, x, y, w, h, bgColor, borderColor, title, mainText, subText) {
        // Background
        ctx.fillStyle = bgColor;
        ctx.fillRect(x, y, w, h);
        
        // Border
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
        
        // Title
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(title, x + 15, y + 20);
        
        // Main text
        ctx.fillStyle = '#666666';
        ctx.font = '12px Arial';
        ctx.fillText(mainText, x + 15, y + 40);
        
        // Sub text
        if (subText) {
            ctx.fillStyle = '#999999';
            ctx.font = '10px Arial';
            ctx.fillText(subText, x + 15, y + 55);
        }
    }

    /**
     * Get metric order for email rendering
     */
    function getMetricOrder() {
        return window.DevCoachModules?.metrics?.getMetricOrder?.() || [
            { key: 'scheduleAdherence', label: 'Schedule Adherence' },
            { key: 'cxRepOverall', label: 'CX Rep Overall' },
            { key: 'fcr', label: 'FCR' },
            { key: 'aht', label: 'AHT' },
            { key: 'overallSentiment', label: 'Overall Sentiment' }
        ];
    }

    /**
     * Format email body with metrics
     */
    function formatEmailBody(employeeName, weekKey, period, metrics) {
        let body = `<h2>Trending Metrics Report</h2>\n`;
        body += `<p>Employee: <strong>${employeeName}</strong></p>\n`;
        body += `<p>Period: <strong>${period.metadata?.endDate || 'Latest'}</strong></p>\n\n`;
        
        body += `<h3>Performance Summary</h3>\n`;
        body += `<ul>\n`;
        
        metrics?.forEach(metric => {
            body += `  <li><strong>${metric.label}:</strong> ${metric.value}</li>\n`;
        });
        
        body += `</ul>\n`;
        
        return body;
    }

    // Export functions
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.emailFormatter = {
        createTrendEmailImage,
        downloadImageFallback,
        drawEmailCard,
        getMetricOrder,
        formatEmailBody
    };

    // Expose to window for backward compatibility
    window.createTrendEmailImage = window.createTrendEmailImage || createTrendEmailImage;
    window.drawEmailCard = window.drawEmailCard || drawEmailCard;
})();
