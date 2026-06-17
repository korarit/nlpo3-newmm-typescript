import { readFileSync, writeFileSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');

// 1. Copy words_th.txt alongside the build output
cpSync(resolve(__dirname, '..', 'src', 'words_th.txt'), resolve(distDir, 'words_th.txt'));

// 2. Fix CJS: patch import_meta.url to use __filename
const cjsPath = resolve(distDir, 'index.cjs');
let content = readFileSync(cjsPath, 'utf-8');
content = content.replace(
    'var import_meta = {};',
    'var import_meta = {url: require("url").pathToFileURL(__filename).href};',
);
writeFileSync(cjsPath, content);
console.log('CJS patched');

// 3. Copy .d.ts -> .d.cts for CJS consumers
const dtsPath = resolve(distDir, 'index.d.ts');
if (existsSync(dtsPath)) {
    cpSync(dtsPath, resolve(distDir, 'index.d.cts'));
    console.log('Types copied to .d.cts');
}

function existsSync(p) {
    try { return readFileSync(p).length >= 0; } catch { return false; }
}
