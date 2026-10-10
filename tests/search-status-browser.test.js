// Browser regression for the header search status across edits and tabs.
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
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
        await context.route('https://**/*', route => route.abort());
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(() => window.contractAppReady);
        await page.evaluate(() => {
            registerContract('SEARCH_A', 'Search A', {
                '1': { title: 'Payment terms', content: '<p>Payment is due.</p>' },
                '2': { title: 'Notice', content: '<p>Written notice is required.</p>' }
            });
            registerContract('SEARCH_B', 'Search B', {
                '1': { title: 'Delivery', content: '<p>Goods are delivered.</p>' }
            });
            switchContract('SEARCH_A');
        });

        const status = page.locator('#statusText');
        const search = page.locator('.search-input');
        assert.strictEqual(await status.innerText(), '就绪');
        await search.fill('Payment');
        assert.strictEqual(await status.innerText(), '找到 1 条');
        assert.strictEqual(await page.locator('#statusDisplay').getAttribute('class'), 'status-mascot status-info');
        assert.strictEqual(await page.locator('#statusBar').count(), 0, 'search must not open a bottom notification');

        await search.fill('zz-no-match');
        assert.strictEqual(await status.innerText(), '无匹配');
        await search.fill('');
        assert.strictEqual(await status.innerText(), '就绪');
        await search.fill('Payment');
        await page.locator('.search-clear').click();
        assert.strictEqual(await status.innerText(), '就绪');
        assert.strictEqual(await search.inputValue(), '');

        await search.fill('Payment');
        await page.evaluate(() => switchContract('SEARCH_B'));
        assert.strictEqual(await status.innerText(), '就绪', 'a tab without a search must clear the old result');
        await page.evaluate(() => switchContract('SEARCH_A'));
        assert.strictEqual(await status.innerText(), '找到 1 条', 'returning to a tab must restore its result');

        await page.evaluate(() => switchToAssistant());
        assert.strictEqual(await status.innerText(), '就绪');
        await page.evaluate(() => switchContract('SEARCH_A'));
        assert.strictEqual(await status.innerText(), '找到 1 条', 'returning from the assistant must restore the result');
        await page.evaluate(() => showWelcomePage());
        assert.strictEqual(await status.innerText(), '就绪');

        await page.setViewportSize({ width: 400, height: 800 });
        assert(await page.locator('#statusDisplay').isVisible(), 'header status must remain visible on a narrow screen');
        assert(!(await page.locator('#statusBubble').isVisible()), 'idle mascot must not keep a text screen visible');
        await page.evaluate(() => switchContract('SEARCH_A'));
        assert.strictEqual(await status.innerText(), '找到 1 条');
        const statusBounds = await status.boundingBox();
        assert(statusBounds && statusBounds.x >= 0 && statusBounds.x + statusBounds.width <= 400,
            `header result text is outside the narrow viewport: ${JSON.stringify(statusBounds)}`);
        await page.evaluate(() => showSuccess('Saved', 1000));
        assert((await status.innerText()).includes('Saved'), 'save notifications must join the header message center');
        assert.strictEqual(await page.locator('#statusBar').count(), 0);
        assert.deepStrictEqual(errors, [], `browser errors: ${errors.join('; ')}`);
        console.log('Header search status browser checks passed.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
