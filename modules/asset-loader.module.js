(function () {
    'use strict';

    const pending = new Map();

    function loadScript(src, ready) {
        if (typeof ready === 'function' && ready()) return Promise.resolve();
        if (pending.has(src)) return pending.get(src);

        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => {
                if (typeof ready !== 'function' || ready()) resolve();
                else reject(new Error(src + ' loaded without exposing its expected API'));
            };
            script.onerror = () => reject(new Error('Failed to load optional asset ' + src));
            document.head.appendChild(script);
        }).catch((error) => {
            pending.delete(src);
            throw error;
        });

        pending.set(src, promise);
        return promise;
    }

    function ensurePdf() {
        return loadScript('lib-pdf.js', () => typeof window.pdfjsLib !== 'undefined').then(() => {
            if (window.pdfjsLib?.GlobalWorkerOptions) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib-pdf.worker.js';
            }
        });
    }

    function ensureHtml2Canvas() {
        return loadScript('lib-html2canvas.js', () => typeof window.html2canvas === 'function');
    }

    function ensureXlsx() {
        return loadScript('lib-xlsx.js', () => typeof window.XLSX !== 'undefined');
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.assetLoader = { loadScript, ensurePdf, ensureHtml2Canvas, ensureXlsx };
})();
