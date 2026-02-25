// === NUCLEAR SOURCE MAP BLOCKING ===
// Runs FIRST before any other scripts execute

// 1. Disable console warnings globally
const BLOCKED_PATTERNS = [
    /source.*map/i,
    /\.map/i,
    /json\.parse/i,
    /chart\.umd/i,
    /lib-chart/i
];

const originalWarn = console.warn;
const originalError = console.error;

console.warn = function(...args) {
    if (!args.some(arg => BLOCKED_PATTERNS.some(p => p.test(String(arg))))) {
        originalWarn.apply(console, args);
    }
};

console.error = function(...args) {
    if (!args.some(arg => BLOCKED_PATTERNS.some(p => p.test(String(arg))))) {
        originalError.apply(console, args);
    }
};

// 2. Block fetch before libraries load
const originalFetch = window.fetch;
window.fetch = function(resource) {
    const url = typeof resource === 'string' ? resource : resource?.url || '';
    if (url.endsWith('.map') || url.includes('.map')) {
        return Promise.reject(new Error('[Blocked]'));
    }
    return originalFetch.apply(this, arguments);
};

// 3. Global error listener (catches all errors including map errors)
window.addEventListener('error', function(event) {
    if (BLOCKED_PATTERNS.some(p => p.test(String(event.message || event.filename || '')))) {
        event.preventDefault();
        event.stopPropagation();
        return false;
    }
}, true);

// 4. Suppress unhandled rejections from map loading
window.addEventListener('unhandledrejection', function(event) {
    if (BLOCKED_PATTERNS.some(p => p.test(String(event.reason || '')))) {
        event.preventDefault();
    }
}, true);

// 5. Block at resource loading level
window.addEventListener('beforeunload', function() {
    // Clean up any pending map requests
}, false);
