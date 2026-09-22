const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const files = ['sw.js'];
for (const dir of ['js', 'vendor', 'scripts', 'tests', 'netlify/edge-functions', 'netlify/edge-shared']) {
    files.push(...fs.readdirSync(path.join(root, dir)).filter(file => /\.m?js$/.test(file)).map(file => `${dir}/${file}`));
}
(async () => {
    for (const file of files) {
        const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
        if (result.status !== 0) {
            console.error(file, result.stderr);
            process.exit(1);
        }
    }
    for (const file of fs.readdirSync(path.join(root, 'netlify/edge-functions')).filter(file => file.endsWith('.js'))) {
        const edgeFunction = await import(pathToFileURL(path.join(root, 'netlify/edge-functions', file)).href);
        if (typeof edgeFunction.default !== 'function') throw new Error(`Edge function ${file} must have a default function export`);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
    if (lock.name !== pkg.name || lock.packages[''].name !== pkg.name || lock.packages[''].devDependencies) {
        throw new Error('Package manifest and lockfile are inconsistent');
    }
    console.log(`Syntax and Edge Function export checks passed (${files.length} files); package manifest/lockfile are consistent.`);
})().catch(error => { console.error(error); process.exit(1); });
