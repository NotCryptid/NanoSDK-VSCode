import * as vscode from 'vscode';

const panels = new Map<string, vscode.WebviewPanel>();

/** Runs a compiled .nsa app in a webview using the NanoSDK desktop runtime. */
export function runInRuntime(context: vscode.ExtensionContext, nsaContent: string, name: string, key: string) {
    const existing = panels.get(key);
    if (existing) { existing.dispose(); }

    const root = vscode.Uri.joinPath(context.extensionUri, 'runtime');
    const panel = vscode.window.createWebviewPanel(
        'nanosdk.runtime',
        `▶ ${name}`,
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, localResourceRoots: [root], retainContextWhenHidden: true }
    );
    panels.set(key, panel);

    const uri = (f: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(root, f));
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const isDark = () => vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Light &&
        vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.HighContrastLight;
    const scripts = ['shim.js', 'engine.js', 'simpleMenu.js', 'globals.js', 'nanosdk_runtime.js', 'app.js']
        .map(f => `<script src="${uri(f)}"></script>`).join('\n');

    panel.webview.html = `<!doctype html>
<html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource}; style-src ${panel.webview.cspSource} 'unsafe-inline'; img-src ${panel.webview.cspSource} data:;" />
<link rel="stylesheet" href="${uri('style.css')}" />
</head>
<body data-dark="${isDark() ? '1' : '0'}">
<div id="stage"><canvas id="screen"></canvas></div>
${scripts}
</body></html>`;

    const subs: vscode.Disposable[] = [];
    subs.push(panel.webview.onDidReceiveMessage(async (m) => {
        if (m.type === 'ready') {
            panel.webview.postMessage({ type: 'load', payload: { path: key, name, content: nsaContent } });
        } else if (m.type === 'close') {
            panel.dispose();
        } else if (m.type === 'splash') {
            await vscode.window.showInformationMessage(String(m.message), { modal: true }, 'OK');
            panel.webview.postMessage({ type: 'splashDone' });
        }
    }));
    subs.push(vscode.window.onDidChangeActiveColorTheme(() => {
        panel.webview.postMessage({ type: 'dark', dark: isDark() });
    }));
    panel.onDidDispose(() => {
        subs.forEach(s => s.dispose());
        if (panels.get(key) === panel) { panels.delete(key); }
    });
}
