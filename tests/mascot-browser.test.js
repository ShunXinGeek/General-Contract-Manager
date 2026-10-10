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
        const mascot = page.locator('#statusDisplay');
        const bubble = page.locator('#statusBubble');
        const panel = page.locator('#statusPanel');
        const clear = async () => {
            if (!await panel.isVisible()) await mascot.click();
            await page.locator('#statusClear').click();
            await page.keyboard.press('Escape');
            await page.mouse.move(1100, 700);
        };
        assert(await mascot.isVisible());
        assert(!(await bubble.isVisible()), 'idle has no status text screen or notification');
        assert.strictEqual((await mascot.innerText()).trim(), '');
        assert((await mascot.getAttribute('aria-label')).includes('查看消息中心'));
        assert.strictEqual(await mascot.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');

        const tabMetrics = () => page.locator('#contract-tabs').evaluate(el => {
            const css = getComputedStyle(el);
            return { width: el.getBoundingClientRect().width, scroll: el.scrollWidth, client: el.clientWidth,
                content: [...el.children].reduce((sum, tab) => sum + tab.getBoundingClientRect().width, 0)
                    + Math.max(0, el.children.length - 1) * parseFloat(css.columnGap)
                    + parseFloat(css.paddingLeft) + parseFloat(css.paddingRight) };
        });
        const initial = await tabMetrics();
        assert(Math.abs(initial.width - initial.content) < 2, 'initial tab background must hug titles');
        await page.evaluate(() => registerContract('A', '合同 A', { '1': { title: '条款', content: '<p>测试</p>' } }));
        const added = await tabMetrics();
        assert(added.width > initial.width && Math.abs(added.width - added.content) < 2, 'new tab grows the background by its actual width');
        await page.evaluate(() => removeContract('A'));
        assert(Math.abs((await tabMetrics()).width - initial.width) < 2, 'removing a tab shrinks the background');
        const mascotWidth = (await mascot.boundingBox()).width;
        await page.evaluate(() => {
            for (let i = 0; i < 15; i++) registerContract('TEST_' + i, '测试合同', { '1': { title: '条款', content: '<p>测试</p>' } });
        });
        for (const width of [1280, 960, 768, 375]) {
            await page.setViewportSize({ width, height: 800 });
            const tabs = await tabMetrics();
            assert(tabs.scroll > tabs.client, 'many tabs must scroll within available space');
            const cat = await mascot.boundingBox();
            const tabBounds = await page.locator('#contract-tabs').boundingBox();
            const toolbar = await page.locator('header > .header-group').last().boundingBox();
            assert.strictEqual(cat.width, mascotWidth, 'tabs must never squeeze the mascot');
            assert(tabBounds.x >= cat.x + cat.width && tabBounds.x + tabBounds.width <= width);
            assert(toolbar.x + toolbar.width <= width + 1);
            if (width > 600) assert(tabBounds.x + tabBounds.width <= toolbar.x);
        }
        await page.locator('#tab-Assistant').focus();
        await page.keyboard.press('Enter');
        assert(await page.locator('#tab-Assistant').evaluate(el => el.classList.contains('active')), 'overflowed tab remains reachable by keyboard');
        await page.evaluate(() => {
            for (let i = 0; i < 15; i++) removeContract('TEST_' + i);
            showWelcomePage();
        });
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForTimeout(250);
        assert(Math.abs((await tabMetrics()).width - initial.width) < 2, JSON.stringify({ initial, actual: await tabMetrics(), html: await page.locator('#contract-tabs').innerHTML() }));
        await clear();

        // Pointer and keyboard focus hold a transient notification until reading ends.
        await page.evaluate(() => showSuccess('悬停阅读时不会消失', 400));
        await bubble.hover();
        await page.waitForTimeout(500);
        assert(await bubble.isVisible(), 'hover pauses dismissal');
        await page.mouse.move(1100, 700);
        await page.waitForFunction(() => document.getElementById('statusBubble').hidden);
        await clear();
        await page.evaluate(() => showSuccess('键盘阅读时不会消失', 300));
        await page.locator('#statusBubbleOpen').focus();
        await page.waitForTimeout(400);
        assert(await bubble.isVisible(), 'focus pauses dismissal');
        await mascot.focus();
        await page.waitForFunction(() => document.getElementById('statusBubble').hidden);
        await clear();

        await page.evaluate(() => StatusCenter.post('error', '同步失败：请检查连接', { duration: 50 }));
        await page.waitForTimeout(200);
        assert(await bubble.isVisible(), 'errors require explicit dismissal');
        assert(await page.locator('#statusUnread').isVisible());
        await page.locator('#statusBubbleClose').click();
        assert(!(await bubble.isVisible()));
        assert(await page.locator('#statusUnread').isVisible(), 'dismissal must preserve important unread indicator');
        await mascot.click();
        assert(await panel.isVisible());
        assert(!(await page.locator('#statusUnread').isVisible()));
        assert((await page.locator('#statusList').innerText()).includes('同步失败'));
        await clear();

        const long = '完整内容开始：' + '这是一条需要展开阅读的消息。'.repeat(40) + '完整内容结束';
        await page.evaluate(message => StatusCenter.post('warning', message), long);
        assert(await bubble.isVisible());
        const preview = await page.locator('#statusText').evaluate(el => ({ height: el.clientHeight, total: el.scrollHeight }));
        assert(preview.total > preview.height, 'long message is clamped in the bubble');
        await page.locator('#statusBubbleOpen').click();
        assert(await panel.isVisible());
        assert(await page.locator('.status-record-full').isVisible(), 'clicking a bubble must directly reveal its full message');
        assert.strictEqual(await page.locator('.status-record-full').textContent(), long);
        await clear();

        await page.evaluate(() => {
            window.taskA = StatusCenter.start('正在构建知识库', '知识库');
            window.taskB = StatusCenter.start('正在同步云端', '云同步');
        });
        assert.strictEqual(await page.locator('#statusTaskCount').innerText(), '2');
        const motionBefore = await page.locator('.cat-stride').evaluate(el => getComputedStyle(el).transform);
        await page.waitForTimeout(1800);
        const motionAfter = await page.locator('.cat-stride').evaluate(el => getComputedStyle(el).transform);
        assert.notStrictEqual(motionBefore, motionAfter, 'working cat must actually move');
        await page.evaluate(() => {
            const walk = document.querySelector('.cat-stride').getAnimations()[0];
            walk.pause(); walk.currentTime = 3000;
        });
        const catPose = await page.locator('.cat-pose').boundingBox();
        const stage = await mascot.boundingBox();
        assert(catPose.x >= stage.x && catPose.x + catPose.width <= stage.x + stage.width, 'cat stays on its stage');
        await page.evaluate(() => document.querySelector('.cat-stride').getAnimations()[0].play());
        await page.evaluate(() => taskB.finish('云同步完成'));
        assert(!(await page.locator('#statusTaskCount').isVisible()));
        await clear();
        await page.evaluate(() => taskA.update('进度更新不重复弹出', 80));
        await page.waitForTimeout(150);
        assert(!(await bubble.isVisible()), 'reading the task suppresses repeated progress popups');
        await page.evaluate(() => taskA.finish('知识库更新完成'));
        assert(await bubble.isVisible(), 'completion still produces its own notification');
        await clear();

        // Simulate document visibility to verify the browser event handler and CSS pause.
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        assert.strictEqual(await page.locator('.cat-tail').evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
        await page.evaluate(() => {
            StatusCenter.post('error', '后台发生的错误');
            delete document.hidden;
            document.dispatchEvent(new Event('visibilitychange'));
        });
        assert(await bubble.isVisible());
        await clear();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        for (const selector of ['.cat-tail', '.cat-eyes', '.cat-stride']) {
            assert.strictEqual(await page.locator(selector).evaluate(el => getComputedStyle(el).animationName), 'none');
        }
        await page.evaluate(() => showSuccess('减少动态效果时仍能收到消息'));
        assert(await bubble.isVisible());
        assert.strictEqual(await page.locator('.cat-pose').evaluate(el => el.getAnimations().length), 0);
        await clear();
        await page.emulateMedia({ reducedMotion: 'no-preference' });

        const output = path.join(root, 'output/mascot');
        fs.mkdirSync(output, { recursive: true });
        await page.mouse.move(1100, 700);
        await mascot.evaluate(el => el.blur());
        await page.screenshot({ path: path.join(output, 'idle.png') });
        await page.evaluate(() => StatusCenter.post('success', '合同修改已保存，点击我可以查看消息记录。', { duration: 0 }));
        await page.waitForTimeout(550);
        await page.screenshot({ path: path.join(output, 'message.png') });
        await page.locator('#statusBubbleOpen').click();
        await page.screenshot({ path: path.join(output, 'center.png') });
        await clear();
        await page.evaluate(() => { document.body.classList.add('dark-mode'); StatusCenter.post('warning', '云同步暂不可用，可以继续使用本地合同。', { duration: 0 }); });
        await page.waitForTimeout(550);
        await page.screenshot({ path: path.join(output, 'dark.png') });
        for (const width of [375, 768, 1280]) {
            await page.setViewportSize({ width, height: 800 });
            const box = await bubble.boundingBox();
            assert(box.x >= 0 && box.x + box.width <= width);
            const bottom = await page.locator('header').evaluate(el => el.getBoundingClientRect().bottom);
            assert(box.y >= bottom, 'bubble must not cover header buttons or tabs');
        }
        await page.setViewportSize({ width: 375, height: 800 });
        await page.screenshot({ path: path.join(output, 'mobile.png') });
        await page.setViewportSize({ width: 800, height: 375 });
        const landscape = await bubble.boundingBox();
        assert(landscape.y + landscape.height <= 375);
        assert.deepStrictEqual(errors, [], `browser errors: ${errors.join('; ')}`);
        console.log('Mascot browser checks passed (tab sizing, overflow, movement bounds, bubbles, hover/focus timers, unread, task lifecycle, background pause, reduced motion and themes).');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
