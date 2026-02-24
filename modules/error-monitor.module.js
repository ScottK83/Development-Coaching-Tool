(function() {
    'use strict';

    // ============================================
    // ERROR LOGGING & MONITORING SERVICE
    // ============================================

    const ERROR_LOG_KEY = 'devCoachErrorLog';
    const MAX_LOG_ENTRIES = 100;
    const ERROR_REPORTING_ENDPOINT = null; // Set to your Sentry or custom endpoint

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

        /**
         * Save logs to localStorage
         */
        saveLogs() {
            try {
                localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(this.logs.slice(0, MAX_LOG_ENTRIES)));
            } catch (e) {
                console.error('Failed to save error logs:', e);
            }
        }

        /**
         * Load logs from localStorage
         */
        loadLogs() {
            try {
                const stored = localStorage.getItem(ERROR_LOG_KEY);
                return stored ? JSON.parse(stored) : [];
            } catch (e) {
                return [];
            }
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
            return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
        setupGlobalHandlers() {
            // Unhandled errors
            window.addEventListener('error', (event) => {
                if (event.error) {
                    this.logError(event.error, {
                        source: 'global_error_handler',
                        filename: event.filename,
                        lineno: event.lineno,
                        colno: event.colno
                    });
                }
            });

            // Unhandled promise rejections
            window.addEventListener('unhandledrejection', (event) => {
                this.logError(event.reason || new Error('Unhandled Promise Rejection'), {
                    source: 'unhandled_rejection'
                });
            });

            // Console errors (optional - can be noisy)
            const originalConsoleError = console.error;
            console.error = (...args) => {
                if (args[0] && typeof args[0] === 'string' && !args[0].includes('[DevCoach]')) {
                    this.logError(new Error(String(args[0])), {
                        source: 'console.error',
                        args: args.slice(1)
                    });
                }
                originalConsoleError.apply(console, args);
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
