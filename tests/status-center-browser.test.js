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
        const status = page.locator('#statusText');
        const panel = page.locator('#statusPanel');
        const open = () => page.locator('#statusDisplay').click();
        await page.evaluate(() => showSuccess('合同已保存'));
        assert.strictEqual(await status.innerText(), '合同已保存');
        assert.strictEqual(await page.locator('#statusBar').count(), 0);
        await open();
        assert(await panel.isVisible());
        assert.strictEqual(await page.locator('#statusDisplay').getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Escape');
        assert(!(await panel.isVisible()));
        assert(await page.locator('#statusDisplay').evaluate(el => el === document.activeElement));

        const longMessage = '第一行：导入进度已完成。\n' + '合同条款的完整提示内容。'.repeat(50) + '<img src=x onerror=alert(1)>';
        await page.evaluate(message => { showError(message); showSuccess('普通成功消息'); }, longMessage);
        assert.strictEqual(await status.innerText(), longMessage.replace(/\n/g, ' '));
        await open();
        const longRow = page.locator('.record-error');
        await longRow.locator('summary').click();
        assert.strictEqual(await longRow.locator('.status-record-full').textContent(), longMessage);
        assert.strictEqual(await longRow.locator('img').count(), 0, 'messages must render as plain text');
        await page.locator('#statusClear').click();
        await page.keyboard.press('Escape');

        // Independent lifecycles: completing one task cannot dismiss another.
        await page.evaluate(() => {
            window.firstTask = StatusCenter.start('知识库索引构建中', '知识库');
            window.secondTask = StatusCenter.start('正在同步云端', '云同步');
            firstTask.update('知识库索引 40 / 100', 40);
            secondTask.finish('同步完成');
        });
        await page.waitForFunction(() => document.getElementById('statusText').textContent === '知识库索引 40 / 100');
        await open();
        await page.locator('[data-filter="active"]').click();
        assert.strictEqual(await page.locator('.status-record').count(), 1);
        await page.locator('.status-record summary').click();
        assert.strictEqual(await page.locator('.status-record progress').getAttribute('value'), '40');
        await page.locator('#statusClear').click();
        assert.strictEqual(await page.locator('.status-record').count(), 1, 'clearing history must preserve active work');
        await page.locator('[data-filter="all"]').click();
        await page.evaluate(() => firstTask.finish('索引构建失败：连接中断', 'error'));
        await page.locator('[data-filter="attention"]').click();
        assert.strictEqual(await page.locator('.status-record').count(), 1);
        await page.locator('#statusClear').click();
        await page.locator('[data-filter="all"]').click();
        await page.keyboard.press('Escape');

        await page.evaluate(() => { showSuccess('重复保存'); showSuccess('重复保存'); });
        await open();
        assert.strictEqual(await page.locator('.status-record').count(), 1, JSON.stringify(await page.evaluate(() => StatusCenter.snapshot())));
        assert((await page.locator('.status-record-meta').innerText()).includes('×2'));
        await page.locator('#statusClear').click();
        await page.keyboard.press('Escape');
        await page.evaluate(() => { showSuccess('旧消息', 80); showSuccess('新消息', 450); });
        await page.waitForTimeout(160);
        assert.strictEqual(await status.innerText(), '新消息', 'old timers must not hide newer messages');
        await page.waitForTimeout(400);
        assert.strictEqual(await status.innerText(), '就绪');

        // Ordinary notices resolve without a dialog; real decisions still require a click.
        await page.evaluate(() => CustomDialog.alert('导出成功！', '导出完成'));
        assert.strictEqual(await page.locator('.custom-dialog-content').count(), 0);
        await page.evaluate(() => { window.confirmResult = null; CustomDialog.confirm('确认删除测试数据？').then(value => window.confirmResult = value); });
        assert(await page.locator('.custom-dialog-content').isVisible());
        assert.strictEqual(await page.evaluate(() => window.confirmResult), null);
        await page.locator('.custom-dialog-content button', { hasText: '取消' }).click();
        assert.strictEqual(await page.evaluate(() => window.confirmResult), false);

        // Center receives real module notifications and lifecycle callbacks.
        await page.evaluate(() => showSettingsStatus('测试设置错误', 'error'));
        assert.strictEqual(await status.innerText(), '测试设置错误');
        await open(); await page.locator('#statusClear').click(); await page.keyboard.press('Escape');
        await page.evaluate(() => {
            AI_CONFIG.embeddingEndpoint = 'test'; AI_CONFIG.embeddingApiKey = 'test'; AI_CONFIG.embeddingModel = 'test';
            RAG.getIndexStatus = async () => ({ corpus: 10, valid: 10 });
            RAG.buildIndex = async (contracts, config, progress) => { progress(5, 10, '已完成'); return { count: 10, total: 10, failed: 0 }; };
            return buildKnowledgeBaseIndex();
        });
        assert((await status.innerText()).includes('本次成功更新 10/10'));
        assert.strictEqual(await page.evaluate(() => StatusCenter.snapshot().filter(item => item.active).length), 0);
        await page.evaluate(() => {
            RAG.buildIndex = async () => ({ count: 0, skipped: 9, total: 10, failed: 1,
                errors: [{ reason: 'HTTP 429', count: 1 }] });
            return buildKnowledgeBaseIndex();
        });
        assert((await status.innerText()).includes('失败原因：HTTP 429 1 条'));

        await open(); await page.locator('#statusClear').click(); await page.keyboard.press('Escape');
        await page.evaluate(() => {
            for (let i = 0; i < 130; i++) StatusCenter.post('info', '历史消息 ' + i, { duration: 1 });
        });
        assert.strictEqual(await page.evaluate(() => StatusCenter.snapshot().length), 100);
        await open(); assert.strictEqual(await page.locator('.status-record').count(), 100);
        await page.locator('#statusClear').click();
        await page.keyboard.press('Escape');

        await context.setOffline(true);
        await page.waitForFunction(() => document.getElementById('statusText').textContent.includes('离线状态'));
        await open(); await page.keyboard.press('Escape');
        assert.strictEqual(await page.evaluate(() => StatusCenter.snapshot().find(row => row.id === 'network').expires === Infinity), true);
        await context.setOffline(false);
        await page.waitForFunction(() => document.getElementById('statusText').textContent.includes('网络已恢复'));
        await open(); await page.locator('#statusClear').click(); await page.keyboard.press('Escape');
        await page.evaluate(() => StatusCenter.post('info', '可执行操作', { action: { label: '查看关联内容', run: () => { window.actionCalled = true; } } }));
        await open(); await page.locator('.status-record summary').click();
        await page.getByRole('button', { name: '查看关联内容' }).click();
        assert.strictEqual(await page.evaluate(() => window.actionCalled), true);
        await page.locator('#statusClear').click(); await page.keyboard.press('Escape');

        // Keyboard activation, long details, light/dark themes and compact viewport.
        await page.locator('#statusDisplay').focus(); await page.keyboard.press('Enter');
        assert(await panel.isVisible()); await page.keyboard.press('Escape');
        await page.evaluate(() => {
            window.previewTask = StatusCenter.start('正在建立知识库索引 · 68 / 100 条', '知识库');
            previewTask.update('正在建立知识库索引 · 68 / 100 条', 68);
            StatusCenter.post('success', '合同修改已保存到本机，可继续离线工作。', { source: '合同保存' });
            StatusCenter.post('info', '当前检索会结合合同正文、条款关联和本地关键词结果。点击消息可以展开完整内容。', { source: '管理助手' });
        });
        await open();
        await page.locator('.status-record').last().locator('summary').click();
        fs.mkdirSync(path.join(root, 'output/status-center'), { recursive: true });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(root, 'output/status-center/desktop.png') });
        const screenBounds = await page.locator('#statusDisplay').boundingBox();
        const tabBounds = await page.locator('#contract-tabs').boundingBox();
        assert(tabBounds.x >= screenBounds.x + screenBounds.width, 'tabs must not overlap the larger screen');
        await page.evaluate(() => document.body.classList.add('dark-mode'));
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(root, 'output/status-center/dark.png') });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.strictEqual(await page.locator('.status-progress > span').evaluate(el => getComputedStyle(el).animationName), 'none');
        for (const width of [375, 768]) {
            await page.setViewportSize({ width, height: 800 });
            await page.waitForFunction(viewportWidth => {
                const bounds = document.getElementById('statusPanel').getBoundingClientRect();
                return bounds.x >= 0 && bounds.right <= viewportWidth;
            }, width);
            const bounds = await panel.boundingBox();
            assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width,
                `panel must fit the viewport: ${JSON.stringify(bounds)}`);
            const displayBounds = await page.locator('#statusDisplay').boundingBox();
            const toolsBounds = await page.locator('header > .header-group').last().boundingBox();
            assert(toolsBounds.x + toolsBounds.width <= width, 'toolbar must remain inside the viewport');
            assert(displayBounds.x >= 0 && displayBounds.x + displayBounds.width <= width, 'display must fit the viewport');
        }
        await page.setViewportSize({ width: 375, height: 800 });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(root, 'output/status-center/mobile.png') });
        await page.setViewportSize({ width: 800, height: 375 });
        const landscape = await panel.boundingBox();
        assert(landscape.y + landscape.height <= 375, 'panel must fit a short viewport');
        assert.deepStrictEqual(errors, [], `browser errors: ${errors.join('; ')}`);
        console.log('Message center browser checks passed (history, tasks, priority, timers, safety, dialogs, integrations, keyboard, responsive and reduced motion).');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
