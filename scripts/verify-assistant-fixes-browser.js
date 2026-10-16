// Isolated browser check for assistant draft clearing and daytime reply readability.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.join(__dirname, '..');
const bundled = path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.GCM_PLAYWRIGHT_MODULE || bundled);

async function run() {
    const server = http.createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
        fs.readFile(file, (error, body) => {
            if (error) { response.writeHead(404).end(); return; }
            const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
            response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store' }).end(body);
        });
    });
    const port = Number(process.env.GCM_TEST_PORT || 18765);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath: process.env.GCM_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
        const context = await browser.newContext();
        await context.route('https://**/*', route => route.abort());
        const page = await context.newPage();
        const errors = [];
        let replyNumber = 0;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/ai', async route => {
            const body = route.request().postDataJSON().body;
            if (!body.stream) {
                await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '合同要点' } }] }) });
                return;
            }
            const reply = ++replyNumber === 1 ? '请核对付款期限，并保留书面记录。' : '还应检查违约金计算依据。';
            await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n` });
        });
        const url = `http://127.0.0.1:${port}/`;
        await page.goto(url);
        await page.evaluate(() => Promise.all([window.contractAppReady, window.assistantTopicsReady]));
        await page.evaluate(() => {
            AI_CHAT_MODELS = [{ id: 'browser-test', name: 'Browser Test', endpoint: 'https://api.deepseek.com/v1', apiKey: 'dummy-key', model: 'deepseek-chat' }];
            currentSelectedModelId = 'browser-test'; applySelectedModel(); saveChatModels(); saveSelectedModelId(); updateModelSelector();
        });
        await page.getByRole('button', { name: '管理助手', exact: true }).click();
        await page.locator('#btnNewAssistantTopic').click();
        await page.locator('#chatInput').fill('请分析付款期限');
        await page.locator('#sendBtn').click();
        await page.locator('.chat-message.assistant .message-content').getByText('请核对付款期限，并保留书面记录。').waitFor();
        await page.waitForFunction(() => !isStreaming);
        assert.strictEqual(await page.locator('#chatInput').inputValue(), '', 'sent question should clear from the input');
        const draft = await page.evaluate(async () => {
            const drafts = JSON.parse(await localforage.getItem('assistant_topic_drafts_v1') || '{}');
            return drafts[AssistantTopics.getCurrentTopicId()]?.text || '';
        });
        assert.strictEqual(draft, '', 'sent question should clear from the persisted draft');
        const style = await page.locator('.chat-message.assistant').first().evaluate(element => {
            const message = getComputedStyle(element);
            const content = getComputedStyle(element.querySelector('.message-content'));
            return { background: message.backgroundColor, color: content.color, size: content.fontSize, lineHeight: content.lineHeight };
        });
        assert.deepStrictEqual({ background: style.background, color: style.color, size: style.size },
            { background: 'rgb(250, 248, 243)', color: 'rgb(38, 50, 56)', size: '15px' });
        assert.ok(parseFloat(style.lineHeight) >= 25, 'assistant reply should have comfortable line spacing');
        const output = path.join(root, 'output', 'playwright'); fs.mkdirSync(output, { recursive: true });
        await page.waitForTimeout(250);
        await page.locator('#chatMessages').screenshot({ path: path.join(output, 'assistant-reading.png') });
        await page.waitForFunction(() => AssistantTopics.getTopics().some(topic => topic.titleSource === 'ai'));
        await page.reload();
        await page.evaluate(() => Promise.all([window.contractAppReady, window.assistantTopicsReady]));
        await page.getByRole('button', { name: '管理助手', exact: true }).click();
        await page.locator('.chat-message.assistant .message-content').getByText('请核对付款期限，并保留书面记录。').waitFor();
        assert.strictEqual(await page.locator('#chatInput').inputValue(), '', 'sent question should stay cleared after reload');
        await page.locator('#chatInput').fill('请补充违约金风险');
        await page.locator('#sendBtn').click();
        await page.locator('.chat-message.assistant .message-content').getByText('还应检查违约金计算依据。').waitFor();
        await page.waitForFunction(() => !isStreaming);
        await page.locator('.chat-message.assistant').first().locator('button[title="收藏"]').click();
        await page.locator('.chat-message.assistant').last().locator('button[title="收藏"]').click();
        await page.waitForFunction(() => document.getElementById('assistantNotebookCount').textContent === '2');
        await page.locator('#btnAssistantNotebook').click();
        assert.deepStrictEqual(await page.locator('#assistantTopicList .assistant-notebook-group').allTextContents(), ['合同要点'], 'two favorites from one topic should share one topic heading');
        assert.strictEqual(await page.locator('#assistantTopicList .assistant-notebook-item').count(), 2, 'both favorite replies should remain separate notes');
        assert.deepStrictEqual(await page.locator('#assistantTopicList .assistant-notebook-item .assistant-topic-title').allTextContents(),
            ['还应检查违约金计算依据。', '请核对付款期限，并保留书面记录。']);
        assert.strictEqual(await page.locator('#assistantTopicList .assistant-notebook-item-date').count(), 2, 'each note should show its own favorite time');
        assert.ok((await page.locator('#assistantNotebookContent .assistant-notebook-meta').innerText()).includes('来源：合同要点'), 'note body should show its source topic');
        await page.locator('#assistantTopicSearch').fill('合同要点');
        assert.strictEqual(await page.locator('#assistantTopicList .assistant-notebook-item').count(), 2, 'searching a topic title should retain its notes');
        await page.locator('#assistantTopicSearch').fill('付款期限');
        assert.strictEqual(await page.locator('#assistantTopicList .assistant-notebook-item').count(), 1, 'searching a note title should show only the matching note');
        await page.locator('#assistantTopicSearch').fill('');
        await page.locator('#btnAssistantNotebook').click();
        await page.locator('#assistantTopicList .assistant-topic-item.is-active .assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
        await page.locator('.modal-overlay:visible input[type="text"]').fill('付款条款讨论');
        await page.locator('.modal-overlay:visible').getByRole('button', { name: '确定', exact: true }).click();
        await page.locator('#btnAssistantNotebook').click();
        assert.deepStrictEqual(await page.locator('#assistantTopicList .assistant-notebook-group').allTextContents(), ['付款条款讨论'], 'notebook should display a renamed topic');
        assert.ok((await page.locator('#assistantNotebookContent .assistant-notebook-meta').innerText()).includes('来源：付款条款讨论'));
        if (await page.locator('#statusBubble').isVisible()) await page.locator('#statusBubbleClose').click();
        await page.locator('#panelAssistant').screenshot({ path: path.join(output, 'assistant-notebook-grouped.png') });
        await page.locator('#btnAssistantNotebook').click();
        await page.locator('#assistantTopicList .assistant-topic-item.is-active .assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '归档', exact: true }).click();
        await page.locator('#btnAssistantArchive').click();
        const archived = page.locator('#assistantTopicList .assistant-topic-item').filter({ hasText: '付款条款讨论' });
        await archived.locator('.assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '永久删除', exact: true }).click();
        await page.locator('.modal-overlay:visible').getByRole('button', { name: '确定', exact: true }).click();
        await page.locator('#btnAssistantNotebook').click();
        assert.deepStrictEqual(await page.locator('#assistantTopicList .assistant-notebook-group').allTextContents(), ['合同要点'], 'deleted topic should fall back to its saved title');
        assert.strictEqual(await page.locator('#assistantTopicList .assistant-notebook-item').count(), 2, 'deleting a topic must not remove saved notes');
        assert.deepStrictEqual(errors, [], 'browser should have no uncaught JavaScript errors');
        console.log('Assistant browser fixes passed: cleared draft, reload, daytime style, topic-grouped favorites, search, rename and deleted-topic fallback.');
        await context.close();
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
