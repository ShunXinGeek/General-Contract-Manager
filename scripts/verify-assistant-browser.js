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
    const port = Number(process.env.GCM_TEST_PORT || 0);
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
    const baseURL = 'http://127.0.0.1:' + server.address().port + '/';
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
            registerContract('GCC', 'General Conditions', { '5': { title: 'Documents mutually explanatory', content: 'The Architect shall respond within 14 days of receipt of the Contractor’s request in writing for instructions.' }, '34': { title: 'Facilities', content: 'Facilities for other persons.' }, '50': { title: 'Extension', content: '(1) Original extension notice.', translation: '工期延长通知。', translation_tc: '工期延長通知。' } });
            registerContract('SCC', 'Special Conditions', { 'SCC 34': { title: 'Night concreting', content: 'Night concreting permission must be obtained.', translation: '夜间混凝土浇筑须获批准。', translation_tc: '夜間混凝土澆築須獲批准。' } });
            AI_CHAT_MODELS = [{ id: 'browser-test', name: 'Browser Test', endpoint: 'https://api.deepseek.com/v1', apiKey: 'dummy-key', model: 'deepseek-flash' }];
            currentSelectedModelId = 'browser-test'; applySelectedModel(); saveChatModels(); saveSelectedModelId(); updateModelSelector();
            await new Promise((resolve, reject) => {
                const tx = RAG.db.transaction(['vectors'], 'readwrite'); tx.objectStore('vectors').put({ id: 'GCC_50', type: 'GCC', clauseId: '50', vector: [1, 0] }); tx.oncomplete = resolve; tx.onerror = reject;
            });
        });
        const importedName = "资料 A+B's";
        const importedSource = "资料 A+B_s";
        await page.locator('#importContractFile').setInputFiles({
            name: 'retrieval-scope.txt', mimeType: 'text/plain',
            buffer: Buffer.from(`CONTRACT_META:\nname: Future neutral source\nshortName: ${importedName}\n---\n` +
                JSON.stringify({ '1': { title: 'Disabled source check', content: '不应进入检索的专属校验词。' } }))
        });
        await page.getByRole('button', { name: '确定', exact: true }).click();
        await page.waitForFunction(label => contracts[label]?.data['1'], importedSource);
        await page.evaluate(() => openClauseSelector());
        await page.locator('#clauseSelectorModal .clause-option').filter({ hasText: 'Disabled source check' }).click();
        assert.ok((await page.locator('#chatInput').inputValue()).includes(importedSource), 'labels containing punctuation and apostrophes must remain usable in generated controls');
        await page.locator('#clauseSelectorModal').getByRole('button', { name: '关闭引用弹窗' }).click();
        await page.evaluate(() => { document.getElementById('chatInput').value = ''; });
        const openRetrievalSettings = async () => {
            await page.locator('button[title="AI 设置"]').click();
            await page.locator('#tabRetrievalSettings').click();
        };
        const assertSourceListsMatch = async () => {
            await page.locator('#tabContractSettings').click();
            const managed = await page.locator('.cm-row').evaluateAll(rows => rows.map(row => [
                row.querySelector('[data-field="key"]').textContent,
                `${row.querySelector('[data-field="title"]').textContent} · ${row.querySelector('.cm-clause-badge').textContent} 条`
            ]));
            await page.locator('#tabRetrievalSettings').click();
            const sources = await page.locator('.retrieval-source-card').evaluateAll(cards => cards.map(card => [
                card.querySelector('.retrieval-source-name').textContent, card.querySelector('.retrieval-source-meta').textContent
            ]));
            assert.deepStrictEqual(sources, managed, 'both settings tabs must show the same contract labels, names and clause counts');
        };
        const saveSettings = async () => {
            await page.getByRole('button', { name: /保存设置/ }).click();
            await page.locator('#settingsModal').waitFor({ state: 'hidden' });
        };
        const query = '不应进入检索的专属校验词';
        const preview = async () => {
            await page.locator('#retrievalPreviewQuery').fill(query);
            await page.locator('#retrievalPreviewButton').click();
            await page.waitForFunction(() => document.getElementById('retrievalPreviewButton')?.disabled === false);
            return page.locator('#retrievalPreviewResult').innerText();
        };
        await openRetrievalSettings();
        await assertSourceListsMatch();
        assert.strictEqual(await page.locator('#firebaseSettingsContent').count(), 0, 'legacy Firebase settings must be removed');
        assert.strictEqual(await page.locator('#retrievalNewSourcePolicy').count(), 0, 'import policy selector must be removed');
        assert.strictEqual(await page.locator('.retrieval-source-card').count(), 3, 'every current source must appear in retrieval settings');
        assert.strictEqual(await page.locator('.retrieval-source-toggle:checked').count(), 0, 'new contracts must start unchecked');
        assert.match(await preview(), /命中 0 条[\s\S]*请在“设置 → 检索设置”中勾选来源并保存/);
        await saveSettings();
        await openRetrievalSettings();
        await page.getByLabel(`将 ${importedSource} 加入检索范围`).check();
        assert.match(await preview(), /命中 1 条/);
        assert.deepStrictEqual(await page.evaluate(query => findRelevantClauses(query), query), [], 'an unsaved checkbox may only affect preview');
        page.once('dialog', dialog => dialog.accept());
        await page.locator('#retrievalResetButton').click();
        assert.strictEqual(await page.getByLabel(`将 ${importedSource} 加入检索范围`).isChecked(), true);
        assert.strictEqual(await page.locator('.retrieval-source-toggle:checked').count(), 1, 'reset must preserve the checked scope');
        await saveSettings();
        await page.reload();
        await page.evaluate(() => window.contractAppReady);
        assert.deepStrictEqual(await page.evaluate(async query => (await findRelevantClauses(query)).map(clause => clause.type), query), [importedSource], 'saved check must reach assistant retrieval after reload');
        await openRetrievalSettings();
        await page.locator('#tabContractSettings').click();
        const contractRow = page.locator(`.cm-row[data-key="${importedSource}"]`);
        const renamedSource = '已改名的测试合同';
        await contractRow.locator('[data-field="title"]').fill('Renamed full title');
        await contractRow.locator('[data-field="title"]').press('Enter');
        await contractRow.locator('[data-field="key"]').fill(renamedSource);
        await contractRow.locator('[data-field="key"]').press('Enter');
        await assertSourceListsMatch();
        const importedToggle = page.getByLabel(`将 ${renamedSource} 加入检索范围`);
        assert.strictEqual(await importedToggle.isChecked(), true, 'renaming must preserve the checked state');
        const relationOptions = await page.locator('#retrievalRelationType option').allTextContents();
        assert.deepStrictEqual(relationOptions, ['高于', '低于', '同级', '无推定关系']);
        await importedToggle.uncheck();
        await page.getByLabel('将 GCC 加入检索范围').check();
        await page.getByLabel('将 SCC 加入检索范围').check();
        await page.getByLabel('SCC 的适用等级').selectOption('1');
        await page.getByLabel('GCC 的适用等级').selectOption('2');
        const sourceIds = await page.evaluate(() => ({ gcc: contracts.GCC.sourceId, scc: contracts.SCC.sourceId }));
        const allOthers = { label: '所有其他文件' };
        const addRelation = async (from, type, to) => {
            await page.locator('#retrievalRelationFrom').selectOption(from);
            await page.locator('#retrievalRelationType').selectOption(type);
            await page.locator('#retrievalRelationTo').selectOption(to);
            await page.locator('#retrievalAddRelation').click();
        };
        const relationRows = page.locator('.retrieval-relation-row > span');
        const relationError = page.locator('#retrievalRelationError');
        await addRelation(sourceIds.scc, 'higher', sourceIds.gcc);
        assert.deepStrictEqual(await relationRows.allTextContents(), ['SCC 高于 GCC']);
        await addRelation(allOthers, 'higher', sourceIds.scc);
        assert.match(await relationError.innerText(), /GCC.*第 2 级.*SCC.*第 1 级.*应为/);
        assert.deepStrictEqual(await relationRows.allTextContents(), ['SCC 高于 GCC'], 'a failed batch must preserve every previous rule');
        await addRelation(allOthers, 'lower', sourceIds.scc);
        assert.deepStrictEqual((await relationRows.allTextContents()).sort(), ['SCC 高于 GCC', `SCC 高于 ${renamedSource}`].sort());
        await addRelation(sourceIds.gcc, 'lower', allOthers);
        assert.deepStrictEqual((await relationRows.allTextContents()).sort(), [
            'SCC 高于 GCC', `SCC 高于 ${renamedSource}`, `${renamedSource} 高于 GCC`
        ].sort());
        await page.getByLabel(`${renamedSource} 的适用等级`).selectOption('3');
        await page.getByRole('button', { name: /保存设置/ }).click();
        assert.match(await page.locator('#settingsStatus').innerText(), /第 3 级.*高于.*GCC.*第 2 级/);
        await page.getByLabel(`${renamedSource} 的适用等级`).selectOption('');
        const previewText = await preview();
        assert.ok(previewText.includes('检索范围：GCC、SCC'), 'preview must display the enabled scope');
        assert.ok(previewText.includes('命中 0 条'), 'disabled arbitrary sources must not leak into retrieval results');
        const retrievalModal = page.locator('#settingsModal .settings-modal-content');
        await retrievalModal.screenshot({ path: path.join(output, 'retrieval-settings-preview.png') });
        await page.locator('#settingsModalBody').evaluate(element => { element.scrollTop = 0; });
        await retrievalModal.screenshot({ path: path.join(output, 'retrieval-settings.png') });
        await saveSettings();
        // The status center keeps errors visible until dismissed.
        await page.locator('#statusText').filter({ hasText: '请修正检索设置' }).waitFor();
        await page.locator('#statusBubbleClose').click();
        assert.deepStrictEqual(await page.evaluate(query => findRelevantClauses(query), query), [], 'saved uncheck must exclude the source from assistant retrieval');
        await openRetrievalSettings();
        assert.strictEqual(await importedToggle.isChecked(), false, 'source scope must persist after reopening settings');
        assert.strictEqual(await page.getByLabel('SCC 的适用等级').inputValue(), '1', 'source level must persist after reopening settings');
        assert.deepStrictEqual((await relationRows.allTextContents()).sort(), [
            'SCC 高于 GCC', `SCC 高于 ${renamedSource}`, `${renamedSource} 高于 GCC`
        ].sort(), 'batch relations must persist after reopening settings');
        await page.setViewportSize({ width: 390, height: 844 });
        const mobileLayout = await page.evaluate(() => {
            const modal = document.querySelector('#settingsModal .settings-modal-content');
            const body = document.getElementById('settingsModalBody');
            return { modalFits: modal.scrollWidth <= modal.clientWidth + 1, bodyFits: body.scrollWidth <= body.clientWidth + 1 };
        });
        assert.ok(mobileLayout.modalFits && mobileLayout.bodyFits, 'retrieval settings must not overflow horizontally on a phone viewport');
        await page.locator('#settingsModalBody').evaluate(element => { element.scrollTop = 0; });
        await page.locator('#settingsModal .settings-modal-content').screenshot({ path: path.join(output, 'retrieval-settings-mobile.png') });
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.locator('#tabContractSettings').click();
        page.once('dialog', dialog => dialog.accept());
        await page.locator('.cm-row').filter({ hasText: renamedSource }).locator('.cm-delete-btn').click();
        await assertSourceListsMatch();
        assert.strictEqual(await importedToggle.count(), 0, 'deleted contract must disappear from retrieval settings');
        console.log('Retrieval settings browser checks passed (scope, preview, persistence, batch relations and conflict validation)');
        await page.getByRole('button', { name: '取消', exact: true }).click();
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
        await page.locator('#btnThinkingMode').click();
        await page.getByRole('menuitemradio', { name: '高', exact: true }).click();
        await page.locator('#btnKnowledgeBase').click();
        await page.locator('#statusText').filter({ hasText: '加载 4 条正文' }).waitFor();
        assert.strictEqual(await page.locator('#statusAnnouncement').getAttribute('aria-live'), 'polite', 'knowledge-base status must be announced without moving focus');
        assert.match(await page.locator('#statusText').innerText(), /有效语义向量 0\/4[\s\S]*旧索引/);
        assert.strictEqual(await page.locator('#btnKnowledgeBase').getAttribute('aria-pressed'), 'true');
        assert.strictEqual(await page.locator('#btnUpdateIndex').count(), 0);
        const send = async query => { await page.locator('#chatInput').fill(query); await page.locator('#sendBtn').click(); await page.waitForFunction(() => !isStreaming); };
        await send('SCC Clause 34');
        const streamed = requests.filter(body => body.stream);
        assert.strictEqual(streamed.length, 1); assert.deepStrictEqual(streamed[0].thinking, { type: 'enabled' });
        assert.strictEqual(streamed[0].reasoning_effort, 'high');
        assert.ok(streamed[0].messages[0].content.includes('<<<SCC Clause 34')); assert.ok(!streamed[0].messages[0].content.includes('<<<GCC Clause 34'));
        await send('在合同条款中，是否对于“一方理应在多久之内对另外一方的信函做出回复”给出明确的时间要求？');
        const deadlineRequest = requests.find(body => String(body.messages?.at?.(-1)?.content || '').includes('一方理应在多久之内'));
        assert.ok(deadlineRequest?.messages?.[0]?.content.includes('<<<GCC Clause 5'), 'Chinese response-deadline query must send GCC Clause 5 original text to the model');
        await page.waitForFunction(() => AssistantTopics.getTopics().some(topic => topic.titleSource === 'ai'), null, { timeout: 5000 });
        const generatedTopic = await page.evaluate(() => AssistantTopics.getTopics().find(topic => topic.titleSource === 'ai'));
        assert.ok(Array.from(generatedTopic.title).length <= 13 && /^[\u3400-\u9fff]+$/u.test(generatedTopic.title), 'AI topic title must be concise Chinese text');
        const titleRequest = requests.find(body => body.stream === false && String(body.messages?.[0]?.content || '').includes('生成一个标题'));
        assert.strictEqual(titleRequest?.model, 'deepseek-flash', 'topic title request must use the same model as the completed reply');
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
        const attachmentRequest = requests.findLast(body => body.stream);
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
        assert.match(await page.locator('.chat-message.assistant .message-content').last().innerText(), /依据范围提示：[^\]]*旧索引/);
        const legacySearch = await page.evaluate(() => ({
            code: RAG.lastSearchStatus.code,
            rejected: RAG.lastSearchStatus.rejected['legacy-unverified'],
            embeddings: chatMessages.at(-1).retrievalDiagnostic.calls.embedding
        }));
        assert.deepStrictEqual(legacySearch, { code: 'index-invalid', rejected: 1, embeddings: 0 });
        assert.match(requests.at(-1).messages[0].content, /<<<GCC Clause 50/);
        behavior = 'stop'; await page.locator('#chatInput').fill('GCC Clause 50'); await page.locator('#sendBtn').click();
        await page.waitForFunction(() => isStreaming); await new Promise(resolve => setTimeout(resolve, 200)); await page.locator('#sendBtn').click();
        await page.waitForFunction(() => !isStreaming); if (pending) release();
        behavior = 'valid'; await page.reload(); await page.evaluate(() => window.contractAppReady); await page.getByRole('button', { name: '管理助手', exact: true }).click();
        await page.locator('.chat-message.assistant').first().waitFor(); assert.ok(await page.locator('.thinking-block').count() > 0);
        assert.ok(!(await page.locator('#btnToggleNavigator').isDisabled()), 'assistant sidebar toggle must stay enabled');
        assert.strictEqual(await page.locator('#btnToggleNavigator').getAttribute('title'), '切换侧边栏');
        assert.ok(await page.locator('#assistantTopicSidebar').isVisible(), 'assistant sidebar should be open by default');
        assert.strictEqual(await page.locator('#chatMessages .chat-message.assistant button[title="收藏"]').count(), await page.locator('#chatMessages .chat-message.assistant').count(), 'every assistant reply must expose a favorite action');
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
        await send('为档案预览创建内容');
        await page.locator('#assistantTopicList .assistant-topic-item.is-active .assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
        await page.locator('#assistantTopicList .assistant-topic-group').filter({ hasText: '已置顶' }).waitFor();
        await page.locator('#assistantTopicList .assistant-topic-item.is-active .assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '归档', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('assistantArchiveCount').textContent === '1');
        await page.locator('#btnAssistantArchive').click();
        const archivedTopic = page.locator('#assistantTopicList .assistant-topic-item').filter({ hasText: '浏览器话题' });
        await archivedTopic.waitFor();
        await archivedTopic.locator('.assistant-topic-select').click();
        await page.waitForFunction(() => document.getElementById('assistantChatInputArea').hidden === true && chatMessages.some(message => message.role === 'assistant'));
        assert.strictEqual(await page.locator('#chatMessages .chat-message.assistant button[title="重新生成"]').count(), 0, 'archive preview must not expose mutating reply actions');
        assert.ok(await page.locator('#chatMessages .chat-message.assistant button[title="收藏"]').count() > 0, 'archive preview should still allow collecting a useful reply');
        await archivedTopic.locator('.assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '恢复', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('assistantArchiveCount').textContent === '0');
        await page.locator('#assistantTopicList .assistant-topic-item').filter({ hasText: '浏览器话题' }).waitFor();
        assert.strictEqual(await page.locator('#assistantArchiveCount').innerText(), '0', 'restored topic should leave the archive');
        const favorite = page.locator('#chatMessages .chat-message.assistant button[title="收藏"]').first();
        await favorite.click(); await page.waitForFunction(() => document.getElementById('assistantNotebookCount').textContent === '1');
        await page.locator('#btnAssistantNotebook').click();
        await page.locator('#assistantNotebookWorkspace').waitFor();
        assert.ok(await page.locator('#assistantNotebookWorkspace').isVisible(), 'notebook workspace should open from the sidebar');
        assert.ok((await page.locator('#assistantNotebookContent').innerText()).includes('本次未取得有效正文') || (await page.locator('#assistantNotebookContent').innerText()).includes('GCC Clause'), 'saved notebook should display the collected reply');
        await page.locator('#btnNotebookEdit').click();
        assert.ok(await page.locator('#assistantNotebookEditModes').isVisible(), 'editing must expose source, preview, and compare modes');
        await page.locator('#btnNotebookModePreview').click();
        assert.ok(await page.locator('#assistantNotebookPreview').isVisible(), 'preview mode must show the rendered note');
        assert.ok(await page.locator('#assistantNotebookContentInput').isHidden(), 'preview mode must hide the Markdown source');
        assert.ok(await page.locator('#assistantNotebookPreview').evaluate((preview, panes) => Math.abs(preview.getBoundingClientRect().width - panes.getBoundingClientRect().width) < 2, await page.locator('#assistantNotebookEditPanes').elementHandle()), 'preview mode must use the full editor width');
        await page.locator('#btnNotebookModeCompare').click();
        assert.ok(await page.locator('#assistantNotebookPreview').isVisible() && await page.locator('#assistantNotebookContentInput').isVisible(), 'compare mode must show source and preview together');
        assert.ok(await page.locator('#assistantNotebookContentInput').evaluate((source, preview) => Math.abs(source.getBoundingClientRect().width - preview.getBoundingClientRect().width) < 2, await page.locator('#assistantNotebookPreview').elementHandle()), 'compare mode must split source and preview evenly');
        await page.locator('#assistantNotebookTitleInput').fill('已编辑笔记');
        await page.locator('#assistantNotebookContentInput').fill(`# 已编辑笔记\n\n${Array.from({ length: 80 }, (_, index) => `这是一条已保存的笔记正文，第 ${index + 1} 行。`).join('\n\n')}`);
        assert.ok((await page.locator('#assistantNotebookPreview').innerText()).includes('这是一条已保存的笔记正文，第 80 行。'), 'preview must update while source is edited');
        await page.locator('#assistantNotebookContentInput').evaluate(source => { source.scrollTop = source.scrollHeight; source.dispatchEvent(new Event('scroll')); });
        await page.waitForFunction(() => { const source = document.getElementById('assistantNotebookContentInput'); const preview = document.getElementById('assistantNotebookPreview'); return source.scrollTop > 0 && preview.scrollTop > 0; });
        await page.locator('#btnNotebookSave').click();
        await page.locator('#assistantTopicList .assistant-topic-title').getByText('已编辑笔记', { exact: true }).waitFor();
        assert.ok((await page.locator('#assistantNotebookContent').innerText()).includes('已保存的笔记正文'), 'edited notebook content should render after saving');
        await page.locator('.assistant-topic-back').click();
        await page.waitForFunction(() => !document.getElementById('assistantNotebookWorkspace').offsetParent);
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
        await openRetrievalSettings();
        await page.getByLabel('将 SCC 加入检索范围').uncheck();
        await page.evaluate(() => {
            document.getElementById('settingEmbeddingEndpoint').value = 'https://example.test/v1';
            document.getElementById('settingEmbeddingApiKey').value = 'dummy-key';
            document.getElementById('settingEmbeddingModel').value = 'browser-vector';
        });
        await saveSettings();
        const buildRequests = [], queryRequests = [];
        let releaseScc, shouldFailScc = true;
        const blockedScc = new Promise(resolve => { releaseScc = resolve; });
        await page.route('**/api/retrieval', async route => {
            const { kind, body } = route.request().postDataJSON();
            assert.strictEqual(kind, 'embedding');
            if (/^(GCC|SCC) Clause /u.test(body.input)) buildRequests.push(body.input);
            else queryRequests.push(body.input);
            if (shouldFailScc && body.input.startsWith('SCC Clause ')) {
                await blockedScc;
                await route.fulfill({ status: 502 });
            } else await route.fulfill({ json: { data: [{ embedding: [1, 0] }] } });
        });
        const knowledge = page.getByRole('button', { name: '知识库', exact: true });
        await knowledge.click();
        await page.locator('#statusText').filter({ hasText: '有效语义向量 0/3' }).waitFor();
        assert.deepStrictEqual(buildRequests, [], 'the knowledge switch must not start index generation');
        await openRetrievalSettings();
        await page.locator('#tabContractSettings').click();
        const vectorize = page.getByRole('button', { name: '向量化', exact: true });
        const vectorState = (label, state) => page.locator(`.cm-row[data-key="${label}"] .cm-vector-status[data-state="${state}"]`);
        await vectorState('GCC', 'pending').waitFor();
        await vectorState('SCC', 'pending').waitFor();
        await vectorize.click();
        await vectorState('GCC', 'ready').waitFor();
        await vectorState('SCC', 'pending').waitFor();
        assert.ok(await vectorize.isDisabled());
        releaseScc();
        await page.waitForFunction(() => !document.getElementById('btnVectorizeContracts').disabled);
        assert.match(await page.locator('#statusText').innerText(), /失败 1 条.*HTTP 502/u);
        assert.strictEqual(buildRequests.length, 4);
        shouldFailScc = false;
        await vectorize.click();
        await vectorState('SCC', 'ready').waitFor();
        await page.waitForFunction(() => !document.getElementById('btnVectorizeContracts').disabled);
        assert.strictEqual(buildRequests.length, 5, 'retry must only embed the failed clause');
        assert.match(buildRequests.at(-1), /^SCC Clause /u);
        await vectorize.click();
        await page.waitForFunction(() => !document.getElementById('btnVectorizeContracts').disabled);
        assert.strictEqual(buildRequests.length, 5, 'already-covered contracts require no further embeddings');
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(await vectorize.evaluate(button => {
            const row = button.closest('.cm-header-row');
            const cell = button.closest('.cm-cell-vector');
            return cell === row.lastElementChild && cell.previousElementSibling.textContent.trim() === '条款数'
                && button.getBoundingClientRect().right <= row.getBoundingClientRect().right;
        }), 'the vectorization button must fit in the last column on mobile');
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.getByRole('button', { name: '取消', exact: true }).click();
        await send('工程设施和施工许可有哪些规定？');
        const indexedChat = requests.find(body => body.messages.at(-1)?.content === '工程设施和施工许可有哪些规定？');
        assert.ok(indexedChat?.messages[0].content.includes('<<<GCC Clause'));
        assert.ok(!indexedChat.messages[0].content.includes('<<<SCC Clause'), 'indexed but unchecked contracts must stay outside the evidence scope');
        assert.strictEqual(queryRequests.length, 1);
        await knowledge.click();
        assert.strictEqual(await knowledge.getAttribute('aria-pressed'), 'false');
        await send('关闭知识库后的普通问答');
        const ordinaryChat = requests.find(body => body.messages.at(-1)?.content === '关闭知识库后的普通问答');
        assert.ok(ordinaryChat && !ordinaryChat.messages[0].content.includes('<<<'));
        assert.strictEqual(queryRequests.length, 1, 'ordinary chat must not request a query embedding');

        const indexCheck = await page.evaluate(async () => {
            const records = await RAG.readRecords();
            const ready = records.filter(row => RAG.validateRecord(row, AI_CONFIG, contracts) === 'ready');
            const compatible = ready.find(row => row.sourceId === contracts.GCC.sourceId && row.clauseId === '50');
            const legacy = { type: 'GCC', clauseId: '50', title: 'Legacy', vector: [1, 0] };
            window.PREBUILT_VECTORS = { vectors: { compatible, legacy } };
            await RAG.importPrebuiltVectors();
            const imported = await RAG.readRecords();
            return { ready: ready.length, compatible: RAG.validateRecord(imported.find(row => row.id === 'compatible'), AI_CONFIG, contracts),
                legacy: RAG.validateRecord(imported.find(row => row.id === 'legacy'), AI_CONFIG, contracts) };
        });
        assert.deepStrictEqual(indexCheck, { ready: 4, compatible: 'ready', legacy: 'legacy-unverified' });
        const downloadPromise = page.waitForEvent('download');
        await page.evaluate(() => RAG.exportVectorsAsJS(AI_CONFIG.embeddingModel));
        const download = await downloadPromise;
        const exportedContext = { window: {} }; vm.createContext(exportedContext); vm.runInContext(fs.readFileSync(await download.path(), 'utf8'), exportedContext);
        const exportedGcc = Object.values(exportedContext.window.PREBUILT_VECTORS.vectors).find(vector => vector.sourceId && vector.type === 'GCC' && vector.clauseId === '50');
        assert.ok(exportedGcc.sourceHash); assert.ok(exportedGcc.embeddingSpace);
        await page.screenshot({ path: path.join(output, 'assistant-retrieval.png'), fullPage: true });
        await page.reload(); await page.evaluate(() => window.contractAppReady);
        await openRetrievalSettings();
        await page.locator('#tabContractSettings').click();
        await vectorState('GCC', 'ready').waitFor();
        await vectorState('SCC', 'ready').waitFor();
        const gccRow = page.locator('.cm-row[data-key="GCC"]');
        await gccRow.locator('[data-field="title"]').fill('Updated General Conditions');
        await gccRow.locator('[data-field="title"]').press('Enter');
        await gccRow.locator('[data-field="key"]').fill('GCC-Renamed');
        await gccRow.locator('[data-field="key"]').press('Enter');
        await vectorState('GCC-Renamed', 'ready').waitFor();
        await page.evaluate(async () => {
            contracts['GCC-Renamed'].data['50'].content += ' Changed original.';
            await saveContractsToStorage();
        });
        await vectorState('GCC-Renamed', 'pending').waitFor();
        await vectorState('SCC', 'ready').waitFor();
        await page.evaluate(async () => {
            AI_CONFIG.embeddingModel = 'another-model';
            await saveContractsToStorage();
        });
        await vectorState('SCC', 'pending').waitFor();
        page.once('dialog', dialog => dialog.accept());
        await page.locator('.cm-row[data-key="GCC-Renamed"] .cm-delete-btn').click();
        assert.strictEqual(await page.locator('.cm-row[data-key="GCC-Renamed"]').count(), 0);
        assert.strictEqual(await page.evaluate(async () => (await RAG.getIndexStatus(AI_CONFIG, contracts)).corpus), 0);
        await page.getByRole('button', { name: '取消', exact: true }).click();
        await page.getByRole('button', { name: '管理助手', exact: true }).click();
        await page.locator('#btnAssistantNotebook').click();
        await page.locator('#assistantTopicList .assistant-topic-title').getByText('已编辑笔记', { exact: true }).waitFor();
        assert.ok((await page.locator('#assistantNotebookContent').innerText()).includes('已保存的笔记正文'), 'saved notebook edits must survive a reload');
        await page.locator('#assistantTopicList .assistant-topic-item.is-note-active .assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '取消收藏', exact: true }).click();
        await page.locator('.modal-overlay:visible').getByRole('button', { name: '确定', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('assistantNotebookCount').textContent === '0');
        assert.strictEqual(await page.locator('#assistantTopicList .assistant-topic-item').count(), 0, 'unfavoriting must remove the notebook entry');
        assert.deepStrictEqual(errors, []);
        const report = { passed: true, scope: 'isolated localhost with mocked providers', checks: ['existing browser regression', 'retrieval settings replace legacy Firebase UI', 'arbitrary-name source controls and strict disabled-source scope', 'source level precedence, batch relations, conflict messages and persistence', 'desktop/mobile retrieval settings layout', 'thinking+knowledge flags', 'knowledge-base status distinguishes loaded corpus from invalid vectors', 'typed SCC evidence', 'Chinese response-deadline query retrieves GCC Clause 5 without semantic vectors', 'multi-file TXT/Markdown/PDF/DOCX local attachment parsing and request hydration', 'followup', 'clause link', 'assistant original/translation and Chinese-variant preference across links', 'regeneration history', 'context break', 'one repair', 'failed repair warning', 'legacy vector feedback', 'stop', 'reload', 'AI topic title with same-model request and length guard', 'assistant reply branching with numbering/truncation/source preservation/no provider call', 'assistant topics title-only rows/outside-click menu/full-row active state/create/rename/archive preview/restore/delete', 'favorite action, notebook source/preview/compare modes, live rendering, scroll sync, editable persistence, and unfavorite deletion', 'send button inside input toolbar', 'native IndexedDB build/import/freshness/export'], providerRequests: 0 };
        report.checks.push('contract management vectorizes unchecked sources with per-contract indicators, failure retry and no duplicate requests', 'knowledge switch only retrieves enabled sources', 'vector status after reload, rename, body edit, model change and deletion');
        fs.writeFileSync(path.join(output, 'assistant-browser-report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report)); await context.close();
    } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
