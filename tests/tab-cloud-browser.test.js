const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require(process.env.GCM_PLAYWRIGHT_MODULE ||
    path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const root = path.join(__dirname, '..');
const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    fs.readFile(file, (error, bytes) => {
        if (error) { response.writeHead(404).end(); return; }
        const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(file)];
        response.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(bytes);
    });
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath: process.env.GCM_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('https://**/*', route => route.abort());
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(() => window.contractAppReady);
        await page.evaluate(async () => { await localforage.clear(); localStorage.clear(); });
        await page.reload();
        await page.evaluate(() => window.contractAppReady);
        const active = () => page.locator('.header-tab.active').evaluateAll(tabs => tabs.map(tab => tab.id));
        assert.deepStrictEqual(await active(), ['tab-Welcome']);

        await page.evaluate(async () => {
            registerContract('FIRST', 'First contract', { '1': { title: 'First clause', content: 'First body' } });
            registerContract('SECOND', 'Second contract', { '1': { title: 'Second clause', content: 'Second body' } });
            await saveContractsToStorage();
        });
        assert.strictEqual((await active()).length, 1);
        await page.locator('[data-key="FIRST"]').click();
        assert.deepStrictEqual(await active(), [await page.locator('[data-key="FIRST"]').getAttribute('id')]);
        await page.locator('#tab-Assistant').click();
        assert.deepStrictEqual(await active(), ['tab-Assistant']);
        const colors = await page.locator('[data-key="FIRST"]').evaluate(tab => ({
            previous: getComputedStyle(tab).backgroundColor,
            previousText: getComputedStyle(tab).color,
            selected: getComputedStyle(document.getElementById('tab-Assistant')).backgroundColor,
            selectedText: getComputedStyle(document.getElementById('tab-Assistant')).color
        }));
        assert.notStrictEqual(colors.previous, colors.selected);
        assert.notStrictEqual(colors.previousText, colors.selectedText);
        await page.evaluate(() => refreshContractsAfterCloud('SECOND'));
        assert.deepStrictEqual(await active(), ['tab-Assistant']);

        await page.locator('#tab-Welcome').click();
        await page.evaluate(() => refreshContractsAfterCloud('SECOND'));
        assert.deepStrictEqual(await active(), ['tab-Welcome']);
        await page.reload();
        await page.evaluate(() => window.contractAppReady);
        assert.deepStrictEqual(await active(), ['tab-Welcome']);
        assert.strictEqual(await page.locator('[data-key="FIRST"]').count(), 1);
        assert.strictEqual(await page.locator('[data-key="SECOND"]').count(), 1);

        const sync = await page.evaluate(async () => {
            initialized = true;
            currentUser = { uid: 'browser-test-user' };
            loadFromCloud = async () => null;
            saveToCloud = async () => ({ success: true });
            const before = StatusCenter.snapshot().length;
            const success = await syncWithCloud({ showProgress: false });
            const afterSuccess = StatusCenter.snapshot().length;
            saveToCloud = async () => { throw new Error('browser test failure'); };
            const failure = await syncWithCloud({ showProgress: false });
            const errors = StatusCenter.snapshot().filter(item => item.type === 'error' && item.source === '云同步').length;
            return { before, afterSuccess, success: success.success, failure: failure.success, errors };
        });
        assert.strictEqual(sync.success, true);
        assert.strictEqual(sync.afterSuccess, sync.before, 'routine sync success must not enter the message center');
        assert.strictEqual(sync.failure, false);
        assert.strictEqual(sync.errors, 1, 'sync failure must remain visible');
        assert.deepStrictEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
        console.log('Tab and cloud browser regression passed');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
