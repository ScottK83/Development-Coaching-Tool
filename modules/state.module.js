(function() {
    'use strict';

    // ============================================
    // CENTRALIZED STATE MANAGEMENT
    // ============================================

    /**
     * Centralized application state
     * All state mutations go through setState() for consistency
     * Subscribers are notified on changes
     */
    class AppState {
        constructor() {
            this.state = {
                // Data layer
                data: {
                    weekly: {},
                    ytd: {},
                    coaching: [],
                    teamMembers: [],
                    sentimentSnapshots: {},
                    ptoTracker: {},
                    tips: {},
                    callCenterAverages: {}
                },
                
                // UI layer
                ui: {
                    activeSection: 'home',
                    selectedPeriod: null,
                    selectedEmployee: null,
                    selectedMetric: null,
                    filters: {},
                    isLoading: false,
                    sortBy: 'name',
                    sortOrder: 'asc'
                },
                
                // User preferences
                preferences: {
                    theme: 'light',
                    notificationsEnabled: true,
                    autoSave: true
                },
                
                // History for undo/redo
                history: {
                    past: [],
                    future: [],
                    maxHistoryLength: 50
                },
                
                // Session metadata
                session: {
                    userId: null,
                    sessionStart: Date.now(),
                    lastActivity: Date.now(),
                    isDirty: false
                }
            };
            
            // Subscribers for state changes
            this.subscribers = [];
            this.middlewares = [];
        }

        /**
         * Get state or specific property
         */
        getState(path = null) {
            if (!path) return this.state;
            return this.getNestedValue(this.state, path);
        }

        /**
         * Get nested value from state using path like "data.weekly"
         */
        getNestedValue(obj, path) {
            return path.split('.').reduce((current, key) => current?.[key], obj);
        }

        /**
         * Set state (immutable update)
         */
        setState(updates, metadata = {}) {
            const prevState = JSON.parse(JSON.stringify(this.state));
            
            // Apply updates
            this.deepMerge(this.state, updates);
            
            // Update last activity  
            this.state.session.lastActivity = Date.now();
            this.state.session.isDirty = true;
            
            // Save to history if tracking enabled
            if (metadata.trackHistory !== false) {
                this.pushHistory(prevState);
            }
            
            // Notify subscribers
            this.notifySubscribers({
                prevState,
                newState: this.state,
                updates,
                metadata
            });
            
            // Save to storage if autosave enabled
            if (this.state.preferences.autoSave) {
                this.saveToStorage();
            }
            
            return this.state;
        }

        /**
         * Subscribe to state changes
         */
        subscribe(callback) {
            this.subscribers.push(callback);
            return () => {
                this.subscribers = this.subscribers.filter(sub => sub !== callback);
            };
        }

        /**
         * Notify all subscribers
         */
        notifySubscribers(change) {
            this.subscribers.forEach(callback => {
                try {
                    callback(change);
                } catch (e) {
                    console.error('Subscriber error:', e);
                }
            });
        }

        /**
         * Add middleware (for logging, validation, etc)
         */
        use(middleware) {
            this.middlewares.push(middleware);
            return this;
        }

        /**
         * Undo last change
         */
        undo() {
            if (this.state.history.past.length === 0) return false;
            
            const prevState = this.state.history.past.pop();
            this.state.history.future.unshift(JSON.parse(JSON.stringify(this.state)));
            
            Object.assign(this.state, prevState);
            this.notifySubscribers({ action: 'undo', newState: this.state });
            return true;
        }

        /**
         * Redo last undone change
         */
        redo() {
            if (this.state.history.future.length === 0) return false;
            
            const nextState = this.state.history.future.shift();
            this.state.history.past.push(JSON.parse(JSON.stringify(this.state)));
            
            Object.assign(this.state, nextState);
            this.notifySubscribers({ action: 'redo', newState: this.state });
            return true;
        }

        /**
         * Clear history
         */
        clearHistory() {
            this.state.history.past = [];
            this.state.history.future = [];
        }

        /**
         * Save state to localStorage
         */
        saveToStorage() {
            try {
                const key = 'devCoachAppState_' + (this.state.session.userId || 'default');
                localStorage.setItem(key, JSON.stringify(this.state));
            } catch (e) {
                console.error('Failed to save state:', e);
            }
        }

        /**
         * Load state from localStorage
         */
        loadFromStorage(userId = null) {
            try {
                const key = 'devCoachAppState_' + (userId || this.state.session.userId || 'default');
                const saved = localStorage.getItem(key);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    Object.assign(this.state, parsed);
                    return true;
                }
            } catch (e) {
                console.error('Failed to load state:', e);
            }
            return false;
        }

        /**
         * Reset state
         */
        reset() {
            if (confirm('Reset all state? This cannot be undone.')) {
                this.state = new AppState().state;
                this.notifySubscribers({ action: 'reset', newState: this.state });
                this.saveToStorage();
                return true;
            }
            return false;
        }

        /**
         * Deep merge objects
         */
        deepMerge(target, source) {
            Object.keys(source).forEach(key => {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    if (!target[key]) target[key] = {};
                    this.deepMerge(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            });
            return target;
        }

        /**
         * Push to history
         */
        pushHistory(state) {
            this.state.history.past.push(state);
            this.state.history.future = [];
            
            // Limit history length
            if (this.state.history.past.length > this.state.history.maxHistoryLength) {
                this.state.history.past.shift();
            }
        }

        /**
         * Get state snapshot for debugging
         */
        snapshot() {
            return {
                state: JSON.parse(JSON.stringify(this.state)),
                subscribers: this.subscribers.length,
                middlewares: this.middlewares.length,
                historyLength: this.state.history.past.length
            };
        }
    }

    // Create global singleton
    const appState = new AppState();

    // Export to window
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.state = appState;
    window.appState = appState; // Also expose directly for convenience

})();
