// Copies the NanoSDK Desktop runtime renderer into ./runtime so the extension's
// built-in runtime IS the desktop runtime (single source of truth). The only
// extension-owned runtime file is runtime/shim.js (stands in for Electron's
// preload bridge) plus the layout in src/runtime/runtimePanel.ts.
//
// Usage:
//   node scripts/sync-runtime.js [path-to-NanoSDK-Desktop]          copy files
//   node scripts/sync-runtime.js [path-to-NanoSDK-Desktop] --check  exit 1 if out of sync
// Runs automatically before packaging (vscode:prepublish). If the Desktop repo
// isn't found, the committed copy is used as-is.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const check = args.includes('--check');
const given = args.find(a => !a.startsWith('--'));
const desktop = path.resolve(given || path.join(__dirname, '..', '..', 'NanoSDK-Desktop'));
const src = path.join(desktop, 'renderer');
const dst = path.join(__dirname, '..', 'runtime');
const FILES = ['engine.js', 'simpleMenu.js', 'globals.js', 'nanosdk_runtime.js', 'app.js', 'style.css'];

if (!fs.existsSync(src)) {
    console.warn(`sync-runtime: ${src} not found, keeping the committed runtime/ copy.`);
    process.exit(0);
}

// Same bytes, ignoring line-ending differences between checkouts.
const norm = (buf) => buf.toString('utf8').replace(/\r\n/g, '\n');
let stale = 0;
for (const f of FILES) {
    const from = path.join(src, f);
    const to = path.join(dst, f);
    const same = fs.existsSync(to) && norm(fs.readFileSync(from)) === norm(fs.readFileSync(to));
    if (same) { continue; }
    stale++;
    if (check) {
        console.error(`out of sync: runtime/${f}`);
    } else {
        fs.copyFileSync(from, to);
        console.log('synced', f);
    }
}

// The webview loads the scripts in the order runtimePanel.ts lists them. Warn
// if the desktop's index.html loads a different set, so a new/renamed script
// can't silently go missing from the extension.
try {
    const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
    const desktopScripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'runtime', 'runtimePanel.ts'), 'utf8');
    const m = /const scripts = \[([^\]]+)\]/.exec(panel);
    const panelScripts = m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).filter(s => s !== 'shim.js') : [];
    if (desktopScripts.join(',') !== panelScripts.join(',')) {
        console.warn(`sync-runtime: script lists differ.\n  desktop:  ${desktopScripts.join(', ')}\n  extension: ${panelScripts.join(', ')}\n  Update the list in src/runtime/runtimePanel.ts.`);
        if (check) { stale++; }
    }
} catch (e) {
    console.warn('sync-runtime: could not compare script lists:', e.message);
}

if (check && stale) { process.exit(1); }
if (!check && stale === 0) { console.log('runtime already in sync'); }
