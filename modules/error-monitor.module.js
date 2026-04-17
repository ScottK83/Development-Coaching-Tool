(function() {
    'use strict';

    // ============================================
    // ERROR LOGGING & MONITORING SERVICE
    // Canonical owner of window.error, window.unhandledrejection,
    // and console.error capture. Also writes the `lastError`
    // single-record convenience key consumed by the debug panel.
    // ============================================

    const STORAGE_PREFIX = window.DevCoachConstants?.STORAGE_PREFIX || 'devCoachingTool_';
    const ERROR_LOG_KEY = STORAGE_PREFIX + 'errorLog';
    const LEGACY_ERROR_LOG_KEY = 'devCoachErrorLog';
    const LAST_ERROR_KEY = STORAGE_PREFIX + 'lastError';
    const MAX_LOG_ENTRIES = 100;
    const ERROR_REPORTING_ENDPOINT = null; // Set to your Sentry or custom endpoint

    // Source-map / library noise to drop from both console and captured errors.
    const SUPPRESSED_PATTERNS = [
        /JSON\.parse.*\.map/i,
        /source map error/i,
        /failed to load source map/i,
        /uncaught syntaxerror.*json/i,
        /chart\.umd\.js\.map/i,
        /lib-chart\.js\.map/i,
        /\.map$/i
    ];

    function isSuppressed(msg) {
        if (!msg) return false;
        return SUPPRESSED_PATTERNS.some(p => p.test(msg));
    }

    class ErrorMonitor {
        constructor() {
            this.logs = this.loadLogs();
            this.sessionId = this.generateSessionId();
            this.errorCount = {
                fatal: 0,
                error: 0,
                warning: 0,
                info: 0
            };
        }

        /**
         * Log error with context
         */
        logError(error, context = {}) {
            const entry = {
                timestamp: new Date().toISOString(),
                sessionId: this.sessionId,
                type: 'error',
                message: error.message || String(error),
                stack: error.stack || '',
                context: {
                    userAgent: navigator.userAgent,
                    url: window.location.href,
                    ...context
                }
            };

            this.addLog(entry);
            this.errorCount.error++;
            this.writeLastError(entry.message, entry.context);

            // Send to remote if configured
            if (ERROR_REPORTING_ENDPOINT) {
                this.sendToServer(entry);
            }

            // Log to console in development
            if (window.DEBUG) {
                console.error('[ErrorMonitor]', entry);
            }

            return entry;
        }

        /**
         * Log warning
         */
        logWarning(message, context = {}) {
            const entry = {
                timestamp: new Date().toISOString(),
                sessionId: this.sessionId,
                type: 'warning',
                message,
                context: {
                    userAgent: navigator.userAgent,
                    url: window.location.href,
                    ...context
                }
            };

            this.addLog(entry);
            this.errorCount.warning++;

            if (window.DEBUG) {
                console.warn('[ErrorMonitor]', entry);
            }

            return entry;
        }

        /**
         * Log info message
         */
        logInfo(message, context = {}) {
            const entry = {
                timestamp: new Date().toISOString(),
                sessionId: this.sessionId,
                type: 'info',
                message,
                context
            };

            this.addLog(entry);
            this.errorCount.info++;

            return entry;
        }

        /**
         * Add log entry
         */
        addLog(entry) {
            this.logs.unshift(entry);
            
            if (this.logs.length > MAX_LOG_ENTRIES) {
                this.logs.pop();
            }

            this.saveLogs();
        }

        /**
         * Get all logs
         */
        getLogs(filter = {}) {
            return this.logs.filter(log => {
                if (filter.type && log.type !== filter.type) return false;
                if (filter.since) {
                    const sinceTime = new Date(filter.since).getTime();
                    const logTime = new Date(log.timestamp).getTime();
                    if (logTime < sinceTime) return false;
                }
                return true;
            });
        }

        /**
         * Clear logs
         */
        clearLogs() {
            this.logs = [];
            this.saveLogs();
        }

        saveLogs() {
            try {
                localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(this.logs.slice(0, MAX_LOG_ENTRIES)));
            } catch (e) {
                // intentionally silent — must not recurse into error logging
            }
        }

        loadLogs() {
            try {
                const stored = localStorage.getItem(ERROR_LOG_KEY);
                if (stored) return JSON.parse(stored);
                // One-shot migration from pre-namespace key
                const legacy = localStorage.getItem(LEGACY_ERROR_LOG_KEY);
                if (legacy) {
                    localStorage.setItem(ERROR_LOG_KEY, legacy);
                    try { localStorage.removeItem(LEGACY_ERROR_LOG_KEY); } catch (_e) {}
                    return JSON.parse(legacy);
                }
                return [];
            } catch (e) {
                return [];
            }
        }

        writeLastError(message, context = {}) {
            try {
                localStorage.setItem(LAST_ERROR_KEY, JSON.stringify({
                    message,
                    source: context.source || 'error-monitor',
                    line: context.lineno,
                    column: context.colno,
                    timestamp: new Date().toISOString()
                }));
            } catch (_e) { /* storage may be full */ }
        }

        /**
         * Send error to remote server
         */
        async sendToServer(entry) {
            if (!ERROR_REPORTING_ENDPOINT) return;

            try {
                const response = await fetch(ERROR_REPORTING_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...entry,
                        appVersion: window.APP_VERSION || 'unknown'
                    })
                });

                if (!response.ok) {
                    console.warn(`Error reporting failed: ${response.status}`);
                }
            } catch (e) {
                console.warn('Could not send error report:', e);
            }
        }

        /**
         * Generate session ID
         */
        generateSessionId() {
            return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        }

        /**
         * Get error summary
         */
        getSummary() {
            return {
                sessionId: this.sessionId,
                totalLogs: this.logs.length,
                errorCounts: this.errorCount,
                recentErrors: this.getLogs({ type: 'error' }).slice(0, 5)
            };
        }

        /**
         * Export logs as JSON
         */
        exportLogs() {
            const dataStr = JSON.stringify(this.logs, null, 2);
            const dataElement = document.createElement('a');
            dataElement.setAttribute('href', `data:text/json;charset=utf-8,${encodeURIComponent(dataStr)}`);
            dataElement.setAttribute('download', `error-logs-${Date.now()}.json`);
            dataElement.click();
        }

        /**
         * Setup global error handlers
         */
        maybeShowToast(message) {
            try {
                if (typeof window.showToast === 'function') {
                    window.showToast('⚠️ ' + message, 5000);
                }
            } catch (_e) { /* toast is best-effort */ }
        }

        setupGlobalHandlers() {
            // Unhandled errors (canonical handler — script.js does not duplicate)
            window.addEventListener('error', (event) => {
                const msg = event?.message || '';
                if (isSuppressed(msg) || (event?.filename && event.filename.includes('.map'))) {
                    return; // bootstrap.js capture-phase listener already prevented default
                }
                this.logError(event.error || new Error(msg), {
                    source: 'global_error_handler',
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno
                });
                this.maybeShowToast('An error occurred. Check Debug panel for details.');
            });

            // Unhandled promise rejections
            window.addEventListener('unhandledrejection', (event) => {
                const reason = event?.reason;
                const msg = (reason?.message || String(reason || '')).toLowerCase();
                if (isSuppressed(msg) || msg.includes('source map') || msg.includes('.map')) {
                    event.preventDefault();
                    return;
                }
                this.logError(reason || new Error('Unhandled Promise Rejection'), {
                    source: 'unhandled_rejection'
                });
            });

            // Console errors — capture + suppress map noise + silence DevTools output in prod
            const originalConsoleError = console.error;
            let inConsoleErrorOverride = false; // reentrance guard
            console.error = (...args) => {
                const msg = args.join(' ');
                if (isSuppressed(msg)) return; // drop source-map noise entirely

                if (!inConsoleErrorOverride && args[0] && typeof args[0] === 'string' && !args[0].includes('[DevCoach]')) {
                    inConsoleErrorOverride = true;
                    try {
                        this.logError(new Error(String(args[0])), {
                            source: 'console.error',
                            args: args.slice(1)
                        });
                    } finally {
                        inConsoleErrorOverride = false;
                    }
                }

                if (window.DEBUG) {
                    originalConsoleError.apply(console, args);
                }
            };
        }
    }

    // Create global singleton
    const errorMonitor = new ErrorMonitor();

    // Setup handlers on initialization
    errorMonitor.setupGlobalHandlers();

    // Export to window
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.errorMonitor = errorMonitor;
    window.errorMonitor = errorMonitor;

})();
