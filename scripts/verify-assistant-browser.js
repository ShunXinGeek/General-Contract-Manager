// Isolated browser verification with already-installed Playwright; no real provider requests.
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bundled = path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.GCM_PLAYWRIGHT_MODULE || bundled);
const output = path.join(root, 'output/playwright');
async function run() {
    fs.mkdirSync(output, { recursive: true });
    const server = http.createServer((request, response) => {
        const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname));
        if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
        fs.readFile(file, (error, body) => {
            if (error) { response.writeHead(404).end(); return; }
            const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
            response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store' }).end(body);
        });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8765, '127.0.0.1', resolve); });
    let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath: process.env.GCM_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
        const previousContext = await browser.newContext({ acceptDownloads: true });
        const previous = await previousContext.newPage();
        const smoke = vm.runInThisContext(fs.readFileSync(path.join(root, 'tests/browser-smoke.js'), 'utf8'));
        console.log(await smoke(previous)); await previousContext.close();
        const context = await browser.newContext({ acceptDownloads: true });
        await context.route('https://**/*', route => route.abort());
        const page = await context.newPage(), errors = [], requests = [];
        page.on('pageerror', error => errors.push(error.message));
        let behavior = 'valid', release, pending;
        await page.route('**/api/ai', async route => {
            const payload = route.request().postDataJSON(), body = payload.body;
            requests.push(body); // Only dummy configuration is used in this profile.
            if (behavior === 'stop') { await new Promise(resolve => { release = resolve; pending = true; }); }
            const isSCC = body.messages[0].content.includes('<<<SCC Clause 34');
            const noSources = !body.messages[0].content.includes('<<<');
            const answer = noSources ? '本次未取得有效正文，请明确条款范围。' : isSCC ? 'SCC Clause 34\n> Night concreting permission must be obtained.' : 'GCC Clause 50\n> Original extension notice.';
            const text = behavior === 'invalid-both' || (behavior === 'repair' && body.stream) ? 'SCC Clause 999 规定该事项。' : answer;
            try {
                if (!body.stream) await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: text } }] }) });
                else await route.fulfill({ contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: '核对本次合同原文。' } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n' });
            } catch (error) { if (behavior !== 'stop') throw error; }
        });
        await page.goto('http://127.0.0.1:8765/'); await page.evaluate(() => window.contractAppReady);
        await page.evaluate(async () => {
            registerContract('GCC', 'General Conditions', { '34': { title: 'Facilities', content: 'Facilities for other persons.' }, '50': { title: 'Extension', content: '(1) Original extension notice.' } });
            registerContract('SCC', 'Special Conditions', { 'SCC 34': { title: 'Night concreting', content: 'Night concreting permission must be obtained.' } });
            AI_CHAT_MODELS = [{ id: 'browser-test', name: 'Browser Test', endpoint: 'https://api.deepseek.com/v1', apiKey: 'dummy-key', model: 'deepseek-flash' }];
            currentSelectedModelId = 'browser-test'; applySelectedModel(); saveChatModels(); saveSelectedModelId(); updateModelSelector();
            await new Promise((resolve, reject) => {
                const tx = RAG.db.transaction(['vectors'], 'readwrite'); tx.objectStore('vectors').put({ id: 'GCC_50', type: 'GCC', clauseId: '50', vector: [1, 0] }); tx.oncomplete = resolve; tx.onerror = reject;
            });
        });
        await page.getByRole('button', { name: '管理助手', exact: true }).click();
        await page.locator('#btnThinkingMode').click(); await page.locator('#btnKnowledgeBase').click();
        const send = async query => { await page.locator('#chatInput').fill(query); await page.locator('#sendBtn').click(); await page.waitForFunction(() => !isStreaming); };
        await send('SCC Clause 34');
        assert.strictEqual(requests.length, 1); assert.deepStrictEqual(requests[0].thinking, { type: 'enabled' });
        assert.ok(requests[0].messages[0].content.includes('<<<SCC Clause 34')); assert.ok(!requests[0].messages[0].content.includes('<<<GCC Clause 34'));
        assert.ok(await page.locator('.thinking-block').count() > 0); assert.ok(await page.locator('.chat-clause-link').count() > 0);
        await page.locator('.chat-message.assistant .chat-clause-link').first().click();
        assert.ok((await page.locator('#assistantRefContent').innerText()).includes('Night concreting'));
        await send('该条款的条件？'); assert.ok(requests.at(-1).messages[0].content.includes('<<<SCC Clause 34'));
        await send('GCC Clause 50');
        await page.locator('.chat-message.assistant button[title="重新生成"]').first().click(); await page.waitForFunction(() => !isStreaming);
        assert.ok(requests.at(-1).messages[0].content.includes('<<<SCC Clause 34')); assert.ok(!requests.at(-1).messages.some(message => message.role === 'user' && message.content === 'GCC Clause 50'));
        await page.locator('#btnContextBreak').click(); await send('该条款的条件？');
        assert.ok(!requests.at(-1).messages[0].content.includes('<<<')); assert.strictEqual(requests.at(-1).messages.length, 2);
        behavior = 'repair'; const beforeRepair = requests.length; await send('GCC Clause 50'); assert.strictEqual(requests.length - beforeRepair, 2);
        assert.ok(await page.evaluate(() => chatMessages.at(-1).validation.passed && chatMessages.at(-1).validation.repaired));
        behavior = 'invalid-both'; const beforeInvalid = requests.length; await send('GCC Clause 50'); assert.strictEqual(requests.length - beforeInvalid, 2);
        assert.ok((await page.locator('.chat-message.assistant').last().innerText()).includes('引用校验提示'));
        behavior = 'valid'; await send('extension of time');
        assert.ok((await page.locator('.chat-message.assistant').last().innerText()).includes('旧索引'));
        behavior = 'stop'; await page.locator('#chatInput').fill('GCC Clause 50'); await page.locator('#sendBtn').click();
        await page.waitForFunction(() => isStreaming); await new Promise(resolve => setTimeout(resolve, 200)); await page.locator('#sendBtn').click();
        await page.waitForFunction(() => !isStreaming); if (pending) release();
        behavior = 'valid'; await page.reload(); await page.evaluate(() => window.contractAppReady); await page.getByRole('button', { name: '管理助手', exact: true }).click();
        await page.locator('.chat-message.assistant').first().waitFor(); assert.ok(await page.locator('.thinking-block').count() > 0);
        assert.ok(await page.evaluate(() => typeof AIRetrieval.retrieve === 'function'));
        const indexCheck = await page.evaluate(async () => {
            Object.assign(AI_CONFIG, { embeddingEndpoint: 'https://example.test/v1', embeddingApiKey: 'dummy-key', embeddingModel: 'browser-vector' });
            RAG.getEmbedding = async () => [1, 0];
            const summary = await RAG.buildIndex(contracts, AI_CONFIG);
            const records = await RAG.readRecords();
            const ready = records.filter(row => RAG.validateRecord(row, AI_CONFIG, contracts) === 'ready');
            contracts.GCC.data['50'].content += ' Changed original.';
            const stale = records.find(row => row.type === 'GCC' && row.clauseId === '50');
            const code = RAG.validateRecord(stale, AI_CONFIG, contracts);
            window.PREBUILT_VECTORS = { embeddingModel: 'legacy', vectors: { legacy: { type: 'GCC', clauseId: '50', title: 'Legacy', vector: [1, 0] } } };
            await RAG.importPrebuiltVectors();
            const imported = (await RAG.readRecords()).find(row => row.id === 'legacy');
            return { summary, ready: ready.length, stale: code, legacy: RAG.validateRecord(imported, AI_CONFIG, contracts) };
        });
        assert.strictEqual(indexCheck.summary.count, 3); assert.strictEqual(indexCheck.ready, 3); assert.strictEqual(indexCheck.stale, 'source-stale'); assert.strictEqual(indexCheck.legacy, 'legacy-unverified');
        const downloadPromise = page.waitForEvent('download');
        await page.evaluate(() => RAG.exportVectorsAsJS(AI_CONFIG.embeddingModel));
        const download = await downloadPromise;
        const exportedContext = { window: {} }; vm.createContext(exportedContext); vm.runInContext(fs.readFileSync(await download.path(), 'utf8'), exportedContext);
        assert.ok(exportedContext.window.PREBUILT_VECTORS.vectors.GCC_50.sourceHash); assert.ok(exportedContext.window.PREBUILT_VECTORS.vectors.GCC_50.embeddingSpace);
        await page.screenshot({ path: path.join(output, 'assistant-retrieval.png'), fullPage: true });
        assert.deepStrictEqual(errors, []);
        const report = { passed: true, scope: 'isolated localhost with mocked providers', checks: ['existing browser regression', 'thinking+knowledge flags', 'typed SCC evidence', 'followup', 'clause link', 'regeneration history', 'context break', 'one repair', 'failed repair warning', 'legacy vector feedback', 'stop', 'reload', 'native IndexedDB build/import/freshness/export'], providerRequests: 0 };
        fs.writeFileSync(path.join(output, 'assistant-browser-report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report)); await context.close();
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
