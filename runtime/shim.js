// Stands in for the Electron preload bridge (window.nsa) inside a VS Code webview.
(function () {
    const vscode = acquireVsCodeApi();
    let loadCb = null;
    let darkCb = null;
    let dark = document.body.dataset.dark === '1';
    let splashResolve = null;

    window.addEventListener('message', (e) => {
        const m = e.data || {};
        if (m.type === 'load' && loadCb) { loadCb(m.payload); }
        else if (m.type === 'dark') { dark = !!m.dark; if (darkCb) { darkCb(dark); } }
        else if (m.type === 'splashDone' && splashResolve) { splashResolve(); splashResolve = null; }
    });

    window.nsa = {
        onLoad: (cb) => { loadCb = cb; vscode.postMessage({ type: 'ready' }); },
        close: () => { vscode.postMessage({ type: 'close' }); return Promise.resolve(); },
        splash: (message) => new Promise((resolve) => {
            splashResolve = resolve;
            vscode.postMessage({ type: 'splash', message: String(message) });
        }),
        isDarkMode: () => dark,
        onDarkModeChange: (cb) => { darkCb = cb; }
    };
})();

// Letterbox the app: size #screen to the largest box with the canvas's own
// aspect ratio (its backing-store width:height) that fits inside #stage.
(function () {
    function fit() {
        const stage = document.getElementById('stage');
        const canvas = document.getElementById('screen');
        if (!stage || !canvas || !canvas.width || !canvas.height) { return; }
        const aw = stage.clientWidth, ah = stage.clientHeight;
        if (!aw || !ah) { return; }
        const ratio = canvas.width / canvas.height;
        let w = aw, h = aw / ratio;
        if (h > ah) { h = ah; w = ah * ratio; }
        canvas.style.width = Math.floor(w) + 'px';
        canvas.style.height = Math.floor(h) + 'px';
    }
    window.addEventListener('resize', fit);
    window.addEventListener('load', () => { fit(); requestAnimationFrame(fit); });
    if (window.ResizeObserver) {
        window.addEventListener('DOMContentLoaded', () => {
            new ResizeObserver(fit).observe(document.getElementById('stage'));
        });
    }
})();
