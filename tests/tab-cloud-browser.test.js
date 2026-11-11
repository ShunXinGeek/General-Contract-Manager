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
            registerContract('FIRST', 'First contract', { '1': { title: 'First clause', content: 'See FOURTH Clause 1.' } });
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

        for (const key of ['THIRD', 'FOURTH']) {
            await page.locator('#importContractFile').setInputFiles({
                name: `${key}.txt`, mimeType: 'text/plain',
                buffer: Buffer.from(`CONTRACT_META:\nname: ${key} contract\nshortName: ${key}\n---\n` + JSON.stringify({
                    '1': { title: `${key} clause`, content: `${key} payment terms.` }
                }))
            });
            await page.getByRole('button', { name: '确定', exact: true }).click();
            await page.locator(`#contract-tabs [data-key="${key}"]`).waitFor();
        }
        const row = key => page.locator(`.cm-row[data-key="${key}"]`);
        const rowKeys = () => page.locator('.cm-row').evaluateAll(rows => rows.map(item => item.dataset.key));
        const tabKeys = () => page.locator('#contract-tabs [data-key]').evaluateAll(tabs => tabs.map(tab => tab.dataset.key));
        const openManagement = async () => {
            await page.getByTitle('AI 设置', { exact: true }).click();
            await page.locator('#tabContractSettings').click();
        };
        await openManagement();
        assert.deepStrictEqual(await rowKeys(), ['FIRST', 'SECOND', 'THIRD', 'FOURTH']);
        await row('THIRD').locator('.cm-drag-handle').dragTo(row('FIRST'), { targetPosition: { x: 75, y: 8 } });
        assert.deepStrictEqual(await rowKeys(), ['THIRD', 'FIRST', 'SECOND', 'FOURTH']);
        assert.deepStrictEqual(await tabKeys(), ['Welcome', 'THIRD', 'FIRST', 'SECOND', 'FOURTH']);
        await row('FIRST').locator('.cm-drag-handle').dragTo(row('FOURTH'), { targetPosition: { x: 75, y: 42 } });
        assert.deepStrictEqual(await rowKeys(), ['THIRD', 'SECOND', 'FOURTH', 'FIRST']);
        await row('FIRST').getByRole('button', { name: '上移 FIRST' }).press('Enter');
        assert.deepStrictEqual(await rowKeys(), ['THIRD', 'SECOND', 'FIRST', 'FOURTH']);

        await page.locator('#tabRetrievalSettings').click();
        await page.getByRole('checkbox', { name: '将 FOURTH 加入检索范围' }).check();
        await page.getByRole('checkbox', { name: '将 FIRST 加入检索范围' }).check();
        await page.locator('#retrievalRelationFrom').selectOption({ label: 'FOURTH' });
        await page.locator('#retrievalRelationTo').selectOption({ label: 'FIRST' });
        await page.locator('#retrievalAddRelation').click();
        await page.getByRole('button', { name: /保存设置/ }).click();
        await openManagement();
        const visibility = row('FOURTH').getByRole('switch');
        const buttonColor = () => visibility.evaluate(button => getComputedStyle(button).backgroundColor);
        assert.strictEqual(await buttonColor(), 'rgb(36, 116, 73)');
        await visibility.click();
        await page.locator('#settingsStatus').getByText('「FOURTH」已设为不可见').waitFor();
        assert.strictEqual(await buttonColor(), 'rgb(185, 46, 54)');
        assert.deepStrictEqual(await active(), ['tab-Welcome']);
        assert.deepStrictEqual(await tabKeys(), ['Welcome', 'THIRD', 'SECOND', 'FIRST']);
        assert.deepStrictEqual(await rowKeys(), ['THIRD', 'SECOND', 'FIRST', 'FOURTH']);
        await row('FOURTH').locator('.cm-drag-handle').dragTo(row('SECOND'), { targetPosition: { x: 75, y: 8 } });
        assert.deepStrictEqual(await rowKeys(), ['THIRD', 'FOURTH', 'SECOND', 'FIRST']);
        assert.deepStrictEqual(await tabKeys(), ['Welcome', 'THIRD', 'SECOND', 'FIRST']);

        const retrievalLabels = selector => page.locator(selector).allTextContents();
        await page.locator('#tabRetrievalSettings').click();
        assert.deepStrictEqual(await retrievalLabels('.retrieval-source-name'), ['THIRD', 'SECOND', 'FIRST']);
        for (const id of ['retrievalRelationFrom', 'retrievalRelationTo']) {
            assert(!(await retrievalLabels(`#${id} option`)).includes('FOURTH'));
        }
        assert.strictEqual(await page.locator('.retrieval-relation-row').count(), 0);
        await page.locator('#retrievalPreviewQuery').fill('FOURTH Clause 1 payment');
        await page.locator('#retrievalPreviewButton').click();
        await page.locator('#retrievalPreviewResult').getByText(/检索范围：FIRST；命中 0 条/).waitFor();
        await page.getByRole('button', { name: '关闭设置' }).click();
        await page.evaluate(() => { switchContract('FOURTH'); showAssistantClause('FOURTH', '1'); });
        assert.deepStrictEqual(await active(), ['tab-Welcome']);
        await page.locator('#contract-tabs [data-key="FIRST"]').click();
        assert.strictEqual(await page.locator('#panelMain .clause-ref').count(), 0, 'hidden cross-reference must stay plain text');
        await page.locator('#tab-Assistant').click();
        await page.getByTitle('引用条款', { exact: true }).click();
        assert(!(await page.locator('#clauseSelectorModal').innerText()).includes('FOURTH'));
        await page.locator('#clauseSelectorModal .close-modal').click();

        await page.reload();
        await page.evaluate(() => window.contractAppReady);
        assert.deepStrictEqual(await tabKeys(), ['Welcome', 'THIRD', 'SECOND', 'FIRST']);
        await openManagement();
        assert.deepStrictEqual(await rowKeys(), ['THIRD', 'FOURTH', 'SECOND', 'FIRST']);
        assert.strictEqual(await visibility.textContent(), '不可见');
        await visibility.click();
        await page.locator('#settingsStatus').getByText('「FOURTH」已设为可见').waitFor();
        assert.deepStrictEqual(await tabKeys(), ['Welcome', 'THIRD', 'FOURTH', 'SECOND', 'FIRST']);
        await page.locator('#tabRetrievalSettings').click();
        assert(await page.getByRole('checkbox', { name: '将 FOURTH 加入检索范围' }).isChecked());
        assert.match(await page.locator('.retrieval-relation-row').innerText(), /FOURTH.*FIRST/);
        await page.reload();
        await page.evaluate(() => window.contractAppReady);
        assert.deepStrictEqual(await tabKeys(), ['Welcome', 'THIRD', 'FOURTH', 'SECOND', 'FIRST']);
        await page.locator('#contract-tabs [data-key="FIRST"]').click();
        await page.locator('#panelMain .clause-ref').filter({ hasText: 'FOURTH Clause 1' }).click();
        assert.match(await page.locator('#refContent').innerText(), /FOURTH payment terms/);
        await page.setViewportSize({ width: 375, height: 760 });
        await openManagement();
        assert(await page.locator('.cm-table').evaluate(table => table.scrollWidth <= table.clientWidth), 'management table must fit the narrow viewport');
        assert.deepStrictEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
        console.log('Tab, contract order, visibility, and cloud browser regressions passed');
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
