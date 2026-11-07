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
