const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const files = ['sw.js'];
for (const dir of ['js', 'vendor', 'scripts', 'tests', 'netlify/edge-functions']) {
    files.push(...fs.readdirSync(path.join(root, dir)).filter(file => file.endsWith('.js')).map(file => `${dir}/${file}`));
}
for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    if (result.status !== 0) {
        console.error(file, result.stderr);
        process.exit(1);
    }
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
if (lock.name !== pkg.name || lock.packages[''].name !== pkg.name || lock.packages[''].devDependencies) {
    throw new Error('Package manifest and lockfile are inconsistent');
}
console.log(`Syntax checks passed (${files.length} files); package manifest/lockfile are consistent.`);
