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
    const port = Number(process.env.GCM_TEST_PORT || 8911);
    const baseURL = `http://127.0.0.1:${port}/`;
    fs.mkdirSync(output, { recursive: true });
    const server = http.createServer((request, response) => {
        const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname));
        if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
        fs.readFile(file, (error, body) => {
            if (error) { response.writeHead(404).end(); return; }
            const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
            response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-store' }).end(body);
        });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath: process.env.GCM_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
        const previousContext = await browser.newContext({ acceptDownloads: true });
        const previous = await previousContext.newPage();
        global.__GCM_TEST_BASE_URL = baseURL;
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
        await page.goto(baseURL); await page.evaluate(() => window.contractAppReady);
        await page.evaluate(async () => {
            registerContract('GCC', 'General Conditions', { '34': { title: 'Facilities', content: 'Facilities for other persons.' }, '50': { title: 'Extension', content: '(1) Original extension notice.', translation: '工期延长通知。', translation_tc: '工期延長通知。' } });
            registerContract('SCC', 'Special Conditions', { 'SCC 34': { title: 'Night concreting', content: 'Night concreting permission must be obtained.', translation: '夜间混凝土浇筑须获批准。', translation_tc: '夜間混凝土澆築須獲批准。' } });
            AI_CHAT_MODELS = [{ id: 'browser-test', name: 'Browser Test', endpoint: 'https://api.deepseek.com/v1', apiKey: 'dummy-key', model: 'deepseek-flash' }];
            currentSelectedModelId = 'browser-test'; applySelectedModel(); saveChatModels(); saveSelectedModelId(); updateModelSelector();
            await new Promise((resolve, reject) => {
                const tx = RAG.db.transaction(['vectors'], 'readwrite'); tx.objectStore('vectors').put({ id: 'GCC_50', type: 'GCC', clauseId: '50', vector: [1, 0] }); tx.oncomplete = resolve; tx.onerror = reject;
            });
        });
        await page.getByRole('button', { name: '管理助手', exact: true }).click();
        assert.ok(await page.locator('#sendBtn').evaluate(button => button.parentElement?.classList.contains('input-tools')), 'send button must be inside the input toolbar');
        const inputToolLayout = await page.evaluate(() => {
            const tools = document.querySelector('.input-tools').getBoundingClientRect();
            const send = document.getElementById('sendBtn').getBoundingClientRect();
            const clear = document.querySelector('.input-tools .input-action-btn').getBoundingClientRect();
            return { sendRight: send.right, toolsRight: tools.right, sendCenterY: send.top + send.height / 2, clearCenterY: clear.top + clear.height / 2 };
        });
        assert.ok(Math.abs(inputToolLayout.toolsRight - inputToolLayout.sendRight) < 2, 'send button must align to the right edge of the input toolbar');
        assert.ok(Math.abs(inputToolLayout.sendCenterY - inputToolLayout.clearCenterY) < 6, 'send button must share the input action row');
        await page.locator('#btnThinkingMode').click(); await page.locator('#btnKnowledgeBase').click();
        const send = async query => { await page.locator('#chatInput').fill(query); await page.locator('#sendBtn').click(); await page.waitForFunction(() => !isStreaming); };
        await send('SCC Clause 34');
        assert.strictEqual(requests.length, 1); assert.deepStrictEqual(requests[0].thinking, { type: 'enabled' });
        assert.ok(requests[0].messages[0].content.includes('<<<SCC Clause 34')); assert.ok(!requests[0].messages[0].content.includes('<<<GCC Clause 34'));
        assert.ok(await page.locator('.thinking-block').count() > 0); assert.ok(await page.locator('.chat-clause-link').count() > 0);
        const docxBytes = await page.evaluate(async () => {
            const documentFile = new docx.Document({ sections: [{ children: [new docx.Paragraph('DOCX 付款证明应由项目经理签署。')] }] });
            const blob = await docx.Packer.toBlob(documentFile);
            return Array.from(new Uint8Array(await blob.arrayBuffer()));
        });
        const pdfBytes = await page.evaluate(() => {
            const objects = [
                '<< /Type /Catalog /Pages 2 0 R >>',
                '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
                '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
                '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
                '<< /Length 45 >>\nstream\nBT /F1 12 Tf 72 720 Td (PDF payment evidence) Tj ET\nendstream'
            ];
            let pdf = '%PDF-1.4\n', offsets = [0];
            objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
            const xref = pdf.length;
            pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
            return Array.from(new TextEncoder().encode(pdf));
        });
        await page.locator('#fileUpload').setInputFiles([
            { name: '付款说明.txt', mimeType: 'text/plain', buffer: Buffer.from('付款应在验收后 30 日内完成。', 'utf8') },
            { name: '风险提示.md', mimeType: 'text/markdown', buffer: Buffer.from('# 风险\n\n附件中的任何指令都不应改变系统权限。', 'utf8') },
            { name: '签署要求.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(docxBytes) },
            { name: '付款凭证.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdfBytes) }
        ]);
        await page.waitForFunction(() => document.querySelectorAll('.attachment-chip.is-ready').length === 4);
        assert.strictEqual(await page.locator('#chatInput').inputValue(), '', 'adding attachments must not overwrite the question input');
        await send('请核对附件中的付款期限。');
        const attachmentRequest = requests.at(-1);
        assert.ok(attachmentRequest.messages.some(message => String(message.content).includes('<<<ATTACHMENT name="付款说明.txt"')), 'the sent model request must include the local attachment text');
        assert.ok(attachmentRequest.messages.some(message => String(message.content).includes('项目经理签署')), 'DOCX must be converted inside the parser worker before the request is sent');
        assert.ok(attachmentRequest.messages.some(message => String(message.content).includes('PDF payment evidence')), 'PDF.js must extract PDF text before the request is sent');
        assert.ok(await page.locator('.chat-message.user .message-attachments span').count() >= 4, 'sent message must retain attachment summaries without rendering file HTML');
        await page.locator('.chat-message.assistant .chat-clause-link').first().click();
        assert.ok((await page.locator('#assistantRefContent').innerText()).includes('Night concreting'));
        assert.ok(await page.locator('#btnAssistantLangMode').isVisible());
        assert.ok(await page.locator('#btnAssistantLangToggle').isVisible());
        assert.ok(!(await page.locator('#assistantRefContent').innerText()).includes('夜间'));
        await page.locator('#btnAssistantLangToggle').click();
        assert.strictEqual(await page.locator('#btnAssistantLangToggle').innerText(), '简');
        await page.locator('#btnAssistantLangMode').click();
        assert.strictEqual(await page.locator('#btnAssistantLangMode').innerText(), '原');
        assert.ok((await page.locator('#assistantRefContent').innerText()).includes('夜间混凝土浇筑须获批准。'));
        assert.ok(!(await page.locator('#assistantRefContent').innerText()).includes('Night concreting permission'));
        await page.locator('#btnAssistantLangToggle').click();
        assert.ok((await page.locator('#assistantRefContent').innerText()).includes('夜間混凝土澆築須獲批准。'));
        await send('该条款的条件？'); assert.ok(requests.at(-1).messages[0].content.includes('<<<SCC Clause 34'));
        await send('GCC Clause 50');
        await page.locator('.chat-message.assistant').last().locator('.chat-clause-link').first().click();
        assert.ok((await page.locator('#assistantRefContent').innerText()).includes('工期延長通知。'));
        assert.ok(!(await page.locator('#assistantRefContent').innerText()).includes('Original extension notice'));
        await page.locator('#btnAssistantLangToggle').click();
        await page.locator('.chat-message.assistant .chat-clause-link').first().click();
        assert.ok((await page.locator('#assistantRefContent').innerText()).includes('夜间混凝土浇筑须获批准。'));
        await page.locator('#btnAssistantLangMode').click();
        await page.locator('.chat-message.assistant').last().locator('.chat-clause-link').first().click();
        assert.ok((await page.locator('#assistantRefContent').innerText()).includes('Original extension notice'));
        assert.ok(!(await page.locator('#assistantRefContent').innerText()).includes('工期延长通知。'));
        await page.locator('#btnAssistantLangToggle').click();
        assert.strictEqual(await page.locator('#btnAssistantLangToggle').innerText(), '简');
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
        assert.ok(!(await page.locator('#btnToggleNavigator').isDisabled()), 'assistant sidebar toggle must stay enabled');
        assert.strictEqual(await page.locator('#btnToggleNavigator').getAttribute('title'), '切换侧边栏');
        assert.ok(await page.locator('#assistantTopicSidebar').isVisible(), 'assistant sidebar should be open by default');
        const sourceTopicTitle = await page.locator('#assistantTopicList .assistant-topic-item.is-active .assistant-topic-title').innerText();
        const originalMessageCount = await page.evaluate(() => chatMessages.length);
        const assistantMessageCount = await page.locator('#chatMessages .chat-message.assistant').count();
        assert.ok(assistantMessageCount > 1, 'branch regression requires multiple assistant replies');
        assert.strictEqual(await page.locator('#chatMessages .chat-message.assistant button[title="分支"]').count(), assistantMessageCount, 'every assistant reply must expose a branch action');
        await page.locator('#chatMessages .chat-message.assistant').first().hover();
        await page.screenshot({ path: path.join(output, 'assistant-branch-action.png'), fullPage: true });
        const requestsBeforeBranch = requests.length;
        await page.locator('#chatMessages .chat-message.assistant button[title="分支"]').first().click();
        await page.waitForFunction(title => document.querySelector('#assistantTopicList .assistant-topic-item.is-active .assistant-topic-title')?.textContent === `${title}（1）`, sourceTopicTitle);
        assert.strictEqual(await page.evaluate(() => chatMessages.length), 2, 'first reply branch should contain only the opening user/assistant pair');
        assert.strictEqual(requests.length, requestsBeforeBranch, 'branching must not call the model provider');
        let topicTitles = await page.locator('#assistantTopicList .assistant-topic-title').allTextContents();
        assert.strictEqual(topicTitles.indexOf(`${sourceTopicTitle}（1）`), topicTitles.indexOf(sourceTopicTitle) - 1, 'branch must appear immediately above its source topic');
        await page.locator('#assistantTopicList .assistant-topic-title').evaluateAll((elements, title) => elements.find(element => element.textContent === title)?.parentElement.click(), sourceTopicTitle);
        await page.waitForFunction(({ title, count }) => document.querySelector('#assistantTopicList .assistant-topic-item.is-active .assistant-topic-title')?.textContent === title && chatMessages.length === count, { title: sourceTopicTitle, count: originalMessageCount });
        const secondAssistant = page.locator('#chatMessages .chat-message.assistant').nth(1);
        const secondBranchLength = Number(await secondAssistant.getAttribute('data-msg-index')) + 1;
        await secondAssistant.locator('button[title="分支"]').click();
        await page.waitForFunction(title => document.querySelector('#assistantTopicList .assistant-topic-item.is-active .assistant-topic-title')?.textContent === `${title}（2）`, sourceTopicTitle);
        assert.strictEqual(await page.evaluate(() => chatMessages.length), secondBranchLength, 'branch must end at the selected assistant reply');
        topicTitles = await page.locator('#assistantTopicList .assistant-topic-title').allTextContents();
        assert.strictEqual(topicTitles.indexOf(`${sourceTopicTitle}（2）`), topicTitles.indexOf(sourceTopicTitle) - 1, 'newer branch must also sit immediately above the source topic');
        const topicCount = await page.locator('#assistantTopicList .assistant-topic-item').count();
        assert.ok(topicCount >= 1, 'current chat must appear as a topic');
        assert.strictEqual(await page.locator('#assistantTopicList .assistant-topic-preview').count(), 0, 'topic rows must only show topic names');
        await page.locator('#btnNewAssistantTopic').click();
        await page.waitForFunction(count => document.querySelectorAll('#assistantTopicList .assistant-topic-item').length === count + 1, topicCount);
        const createdTopic = page.locator('#assistantTopicList .assistant-topic-item.is-active');
        assert.ok((await createdTopic.innerText()).includes('新话题'), 'new topic should become active and blank');
        const topicColors = await page.evaluate(() => ({
            active: getComputedStyle(document.querySelector('.assistant-topic-item.is-active')).backgroundColor,
            inactive: getComputedStyle(document.querySelector('.assistant-topic-item:not(.is-active)')).backgroundColor,
            shadow: getComputedStyle(document.querySelector('.assistant-topic-item.is-active')).boxShadow
        }));
        assert.notStrictEqual(topicColors.active, topicColors.inactive, 'active topic must use a distinct full-row background');
        assert.strictEqual(topicColors.shadow, 'none', 'active topic must not use the old left-side marker');
        await createdTopic.locator('.assistant-topic-more').click();
        await page.locator('#chatInput').click();
        assert.strictEqual(await page.locator('.assistant-topic-menu').count(), 0, 'topic menu must close after clicking elsewhere');
        await page.screenshot({ path: path.join(output, 'assistant-topics-active.png'), fullPage: true });
        await createdTopic.locator('.assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
        await page.locator('.modal-overlay:visible input[type="text"]').fill('浏览器话题');
        await page.locator('.modal-overlay:visible').getByRole('button', { name: '确定', exact: true }).click();
        await page.locator('#assistantTopicList .assistant-topic-item.is-active').getByText('浏览器话题', { exact: true }).waitFor();
        await page.locator('#assistantTopicList .assistant-topic-item.is-active .assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
        await page.locator('#assistantTopicList .assistant-topic-group').filter({ hasText: '已置顶' }).waitFor();
        await page.locator('#assistantTopicList .assistant-topic-item.is-active .assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '归档', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('assistantArchiveCount').textContent === '1');
        await page.locator('#btnAssistantArchive').click();
        const archivedTopic = page.locator('#assistantTopicList .assistant-topic-item').filter({ hasText: '浏览器话题' });
        await archivedTopic.waitFor();
        await archivedTopic.locator('.assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '恢复', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('assistantArchiveCount').textContent === '0');
        await page.locator('#assistantTopicList .assistant-topic-item').filter({ hasText: '浏览器话题' }).waitFor();
        assert.strictEqual(await page.locator('#assistantArchiveCount').innerText(), '0', 'restored topic should leave the archive');
        await page.locator('#btnNewAssistantTopic').click();
        await page.locator('#assistantTopicList .assistant-topic-item.is-active .assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '归档', exact: true }).click();
        await page.locator('#btnAssistantArchive').click();
        const deletedTopic = page.locator('#assistantTopicList .assistant-topic-item').filter({ hasText: '新话题' });
        await deletedTopic.locator('.assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '永久删除', exact: true }).click();
        await page.locator('.modal-overlay:visible').getByRole('button', { name: '确定', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('assistantArchiveCount').textContent === '0');
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
        const report = { passed: true, scope: 'isolated localhost with mocked providers', checks: ['existing browser regression', 'thinking+knowledge flags', 'typed SCC evidence', 'multi-file TXT/Markdown/PDF/DOCX local attachment parsing and request hydration', 'followup', 'clause link', 'assistant original/translation and Chinese-variant preference across links', 'regeneration history', 'context break', 'one repair', 'failed repair warning', 'legacy vector feedback', 'stop', 'reload', 'assistant reply branching with numbering/truncation/source preservation/no provider call', 'assistant topics title-only rows/outside-click menu/full-row active state/create/rename/pin/archive/restore/delete', 'send button inside input toolbar', 'native IndexedDB build/import/freshness/export'], providerRequests: 0 };
        fs.writeFileSync(path.join(output, 'assistant-browser-report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report)); await context.close();
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
