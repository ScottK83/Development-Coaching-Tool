// === NUCLEAR SOURCE MAP BLOCKING ===
// Runs FIRST before any other scripts execute

// 1. Disable console warnings globally
const BLOCKED_PATTERNS = [
    /source.*map/i,
    /\.map$/i,
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

// 5. The theme, set before the page paints.
// Dark only (Scott, 2026-10-21, matching the Downloader Bot). There is no
// toggle and no system preference any more: every rule is written against
// [data-theme="dark"], and the only thing that ever sets "light" is an image
// export, on its own cloned document, so a card pasted into Teams comes out
// light. A theme saved by the old toggle is ignored.
document.documentElement.setAttribute('data-theme', 'dark');

