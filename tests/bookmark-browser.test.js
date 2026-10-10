// Real-browser regression for bookmarks across different text wrapping and saved sessions.
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

async function addAt(page, paragraph, name) {
    await page.evaluate(id => {
        const panel = document.getElementById('panelMain');
        const target = document.getElementById(id);
        panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 12;
    }, paragraph);
    await page.locator('button[title="添加书签"]').click();
    await page.locator('input:visible').last().fill(name);
    await page.getByRole('button', { name: '确定', exact: true }).click();
    return page.evaluate(label => savedBookmarks.find(item => item.label === label), name);
}

async function clickAndMeasure(page, name, paragraph) {
    await page.locator('#navList .nav-item').filter({ hasText: name }).click();
    return page.evaluate(id => {
        const panel = document.getElementById('panelMain').getBoundingClientRect();
        const target = document.getElementById(id).getBoundingClientRect();
        return { distance: target.top - panel.top, visible: target.bottom > panel.top && target.top < panel.bottom };
    }, paragraph);
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath: process.env.GCM_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
        const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
        await context.route('https://**/*', route => route.abort());
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const url = `http://127.0.0.1:${server.address().port}/`;
        await page.goto(url);
        await page.evaluate(() => window.contractAppReady);
        await page.evaluate(() => {
            const clauses = {};
            for (let clause = 1; clause <= 10; clause++) {
                clauses[clause] = {
                    title: `Clause ${clause}`,
                    content: Array.from({ length: 12 }, (_, paragraph) =>
                        `<p id="probe-${clause}-${paragraph}">Clause ${clause} paragraph ${paragraph}. ` +
                        'The Contractor shall provide written notice and supporting records to the Architect before commencing the works. '.repeat(4) + '</p>').join('')
                };
            }
            registerContract('BOOKMARK_TEST', 'Bookmark layout test', clauses);
        });
        await page.evaluate(() => new Promise(requestAnimationFrame));

        const first = await addAt(page, 'probe-5-6', 'TARGET_ONE');
        assert.strictEqual(first.id, '5');
        assert.strictEqual(first.anchor.kind, 'text');
        assert.strictEqual(first.scrollTop, undefined, 'new bookmarks must not persist layout pixels');
        await addAt(page, 'probe-5-9', 'TARGET_TWO');

        for (const [width, height] of [[1920, 1080], [1366, 768], [960, 1080], [1920, 1080]]) {
            await page.setViewportSize({ width, height });
            for (const [name, paragraph] of [['TARGET_ONE', 'probe-5-6'], ['TARGET_TWO', 'probe-5-9']]) {
                const result = await clickAndMeasure(page, name, paragraph);
                assert(result.visible && result.distance >= -5 && result.distance < 100,
                    `${name} missed ${paragraph} at ${width}x${height}: ${JSON.stringify(result)}`);
            }
        }

        await page.reload();
        await page.evaluate(() => window.contractAppReady);
        assert.strictEqual(await page.evaluate(() => savedBookmarks.find(b => b.label === 'TARGET_ONE')?.anchor.kind), 'text');
        const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportData())]);
        const snapshot = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
        assert.strictEqual(snapshot.bookmarks.BOOKMARK_TEST.find(b => b.label === 'TARGET_ONE')?.anchor.kind, 'text',
            'backup omitted the text anchor');
        assert((await page.locator('#statusText').innerText()).includes('导出成功'), 'export result must appear in the message center');
        assert.strictEqual(await page.locator('.custom-dialog-content').count(), 0);
        const cloudAnchor = await page.evaluate(() => {
            const payload = JSON.parse(JSON.stringify(collectAllBookmarks()));
            return mergeBookmarks({}, payload).BOOKMARK_TEST.find(b => b.label === 'TARGET_ONE')?.anchor;
        });
        assert.strictEqual(cloudAnchor?.quote, first.anchor.quote, 'cloud bookmark merge dropped the anchor');
        await page.setViewportSize({ width: 960, height: 1080 });
        await page.evaluate(() => highlightSearchResults('Contractor'));
        assert((await clickAndMeasure(page, 'TARGET_ONE', 'probe-5-6')).visible, 'search markup moved the bookmark');

        await page.evaluate(() => {
            document.getElementById('probe-5-5').prepend('An inserted paragraph prefix shifts all later text offsets. ');
        });
        assert((await clickAndMeasure(page, 'TARGET_ONE', 'probe-5-6')).visible,
            'an edit before the target was not resolved from its text');

        // Legacy pixel-only bookmarks must use their clause id, not the stale pixel value.
        await page.evaluate(() => {
            savedBookmarks.push({ id: '5', label: 'LEGACY', uid: 'legacy-test', level: 0, collapsed: false, scrollTop: 1 });
            initBookmarks();
        });
        const legacy = await clickAndMeasure(page, 'LEGACY', 'probe-5-0');
        assert(legacy.visible, 'legacy bookmark did not fall back to its clause');

        await page.evaluate(() => {
            const paragraph = document.getElementById('probe-5-6');
            paragraph.textContent = 'Original target text was deleted and replaced with a different provision.';
        });
        await page.locator('#navList .nav-item').filter({ hasText: 'TARGET_ONE' }).click();
        assert((await page.locator('#statusText').innerText()).includes('书签原文已变化'), 'missing target needs an explicit warning');
        assert(await page.locator('#clause-5 h2').isVisible(), 'missing target did not fall back to its clause');
        assert.deepStrictEqual(errors, [], `browser errors: ${errors.join('; ')}`);
        await context.close();
        console.log('Bookmark browser regression passed (resize, multiple bookmarks, reload, backup, cloud merge, search, edits, legacy).');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
