// Copies the NanoSDK desktop runtime renderer into ./runtime so the extension's
// built-in runtime matches it. Usage: node scripts/sync-runtime.js [path-to-NanoSDK-Desktop]
const fs = require('fs');
const path = require('path');
const src = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'NanoSDK-Desktop'), 'renderer');
const dst = path.join(__dirname, '..', 'runtime');
for (const f of ['engine.js', 'simpleMenu.js', 'globals.js', 'nanosdk_runtime.js', 'app.js', 'style.css']) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
    console.log('synced', f);
}
