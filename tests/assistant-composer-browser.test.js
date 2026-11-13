const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.join(__dirname, '..');
const bundled = path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.GCM_PLAYWRIGHT_MODULE || bundled);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

function pdfFile(pages) {
    const fontId = 3 + pages.length * 2;
    const kids = pages.map((_, index) => (3 + index * 2) + ' 0 R').join(' ');
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>'];
    pages.forEach((text, index) => {
        const stream = text ? 'BT /F1 12 Tf 72 720 Td (' + text + ') Tj ET' : '';
        objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ' + fontId + ' 0 R >> >> /Contents ' + (4 + index * 2) + ' 0 R >>');
        objects.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
    });
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((object, index) => {
        offsets.push(pdf.length);
        pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
    });
    const xref = pdf.length;
    pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
        'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    return Buffer.from(pdf);
}

async function docxFile(page, empty) {
    return Buffer.from(await page.evaluate(async empty => {
        const row = new docx.TableRow({ children: ['价款', '10000'].map(t => new docx.TableCell({ children: [new docx.Paragraph(t)] })) });
        const file = new docx.Document({ sections: [{ children: empty ? [new docx.Paragraph('')] : [
            new docx.Paragraph('甲方签署'), new docx.Paragraph('乙方确认'),
            new docx.Paragraph({ text: '准备通知', bullet: { level: 0 } }),
            new docx.Paragraph({ text: '保存回执', bullet: { level: 0 } }), new docx.Table({ rows: [row] })
        ] }] });
        return Array.from(new Uint8Array(await (await docx.Packer.toBlob(file)).arrayBuffer()));
    }, empty));
}
const file = (name, buffer) => ({ name, mimeType: 'application/octet-stream', buffer });

async function run() {
    const requests = [];
    const longReply = Array.from({ length: 24 }, (_, i) => '用于产生滚动区域的回复段落 ' + (i + 1)).join('\n\n');
    const server = http.createServer(async (req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/api/ai') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const { body } = JSON.parse(Buffer.concat(chunks));
            if (!body.stream) return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"choices":[{"message":{"content":"附件测试话题"}}]}');
            requests.push(body);
            const question = body.messages.at(-1).content;
            if (question.startsWith('拒绝档位')) return res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":{"message":"参数不兼容"}}');
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            const delta = text => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n';
            if (question === '停止部分回复') { res.write(delta('已经收到的文字')); return; }
            const content = question.startsWith('读取付款凭证') ? '> Payment evidence from page one [附件：mixed.pdf｜第 1 页]' : longReply;
            res.write(delta(content));
            return res.end('data: [DONE]\n\n');
        }
        const local = path.resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
        if (!local.startsWith(root + path.sep)) return res.writeHead(403).end();
        fs.readFile(local, (error, data) => error ? res.writeHead(404).end() : res.writeHead(200, { 'Content-Type': mime[path.extname(local)] || 'application/octet-stream' }).end(data));
    });
    let browser;
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        browser = await chromium.launch({ headless: true, executablePath: process.env.GCM_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
        const context = await browser.newContext({ viewport: { width: 1300, height: 850 }, serviceWorkers: 'block' });
        await context.route('https://**/*', route => route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(8000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://127.0.0.1:' + server.address().port + '/');
        const openAssistant = async () => {
            await page.evaluate(() => Promise.all([window.contractAppReady, window.assistantTopicsReady]));
            await page.getByRole('button', { name: '管理助手', exact: true }).click();
        };
        await openAssistant();
        await page.evaluate(async () => {
            await registerContract('AUDIT', '审计测试合同', {
                '1': { title: '付款条件', content: '验收后付款。' },
                '2': { title: '通知地址', content: '以书面方式送达。' }
            });
            AI_CHAT_MODELS = [
                { id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', apiKey: 'dummy', model: 'deepseek-v4-pro' },
                { id: 'gemini', name: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: 'dummy', model: 'gemini-3.8-flash' },
                { id: 'openai', name: 'OpenAI', endpoint: 'https://api.openai.com/v1', protocol: 'openai-responses', apiKey: 'dummy', model: 'gpt-5.6-terra' },
                { id: 'unknown', name: '未知模型', endpoint: 'https://api.openai.com/v1', apiKey: 'dummy', model: 'unknown' }
            ];
            saveChatModels();
            selectModel('deepseek');
        });
        await openAssistant();
        const newTopic = () => page.locator('#btnNewAssistantTopic').click();
        await newTopic();
        const input = page.locator('#chatInput'), upload = page.locator('#fileUpload'), send = page.locator('#sendBtn');
        const idle = () => page.waitForFunction(() => !isStreaming);
        const dialog = page.locator('.modal-overlay:visible');
        const confirm = () => dialog.getByRole('button', { name: '确定', exact: true }).click();
        const cancel = () => dialog.getByRole('button', { name: '取消', exact: true }).click();
        const ready = count => page.waitForFunction(count => document.querySelectorAll('.attachment-chip.is-ready').length === count, count);
        const submit = async text => {
            await input.fill(text);
            await send.click();
            await idle();
        };

        const reference = page.getByRole('button', { name: '引用', exact: true });
        await input.fill('前文后文');
        await input.evaluate(el => el.setSelectionRange(2, 2));
        await reference.click();
        const picker = page.locator('#clauseSelectorModal');
        await picker.getByRole('button', { name: '付款条件' }).focus();
        await page.keyboard.press('Enter');
        await picker.getByRole('button', { name: '通知地址' }).click();
        await page.keyboard.press('Escape');
        assert.match(await input.inputValue(), /^前文[\s\S]*验收后付款[\s\S]*以书面方式送达[\s\S]*后文$/);
        assert.equal(await reference.evaluate(el => document.activeElement === el), true);
        await page.reload();
        await openAssistant();
        assert.match(await input.inputValue(), /验收后付款[\s\S]*以书面方式送达/);

        await upload.setInputFiles(file('empty.docx', await docxFile(page, true)));
        await page.locator('.attachment-chip.is-error').waitFor();
        await page.getByRole('button', { name: '重试 empty.docx' }).click();
        await page.locator('.attachment-chip.is-error').waitFor();
        await page.getByRole('button', { name: '移除 empty.docx' }).click();
        await upload.setInputFiles(file('scan.pdf', pdfFile([''])));
        await page.locator('#attachmentTray').getByText(/扫描件请先做 OCR/).waitFor();
        await page.getByRole('button', { name: '移除 scan.pdf' }).click();
        await upload.setInputFiles(file('broken.docx', Buffer.from('invalid docx')));
        await page.locator('.attachment-chip.is-error').waitFor();
        await page.getByRole('button', { name: '移除 broken.docx' }).click();
        await ready(0);
        await page.locator('.attachment-chip').waitFor({ state: 'detached' });

        // A parser left behind by a closed tab is recoverable on the next load.
        await page.evaluate(() => localforage.setItem('assistant_attachment_draft_v1:' + AssistantTopics.getCurrentTopicId(),
            [{ id: 'interrupted', status: 'parsing', name: 'interrupted.pdf', size: 1 }]));
        await page.reload();
        await openAssistant();
        await page.locator('#attachmentTray').getByText(/解析已中断/).waitFor();
        await page.getByRole('button', { name: '移除 interrupted.pdf' }).click();

        const parsingTopic = await page.evaluate(() => AssistantTopics.getCurrentTopicId());
        await page.route('**/js/attachment-parser-worker.js', async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace('self.onmessage = async event => {',
                'self.onmessage = async event => { await new Promise(resolve => setTimeout(resolve, 800));') });
        });
        await upload.setInputFiles(file('other-topic.docx', await docxFile(page, false)));
        await page.locator('.attachment-chip.is-parsing').waitFor();
        await newTopic();
        await ready(0);
        assert.equal(await page.locator('.attachment-chip').count(), 0);
        await page.evaluate(id => AssistantTopics.switchTopic(id), parsingTopic);
        await ready(1);
        await page.getByRole('button', { name: '移除 other-topic.docx' }).click();
        await page.unroute('**/js/attachment-parser-worker.js');

        const names = ['mixed.pdf', 'table.docx', 'note.markdown'];
        await upload.setInputFiles([
            file(names[0], pdfFile(['Payment evidence from page one', ''])),
            file(names[1], await docxFile(page, false)),
            file(names[2], Buffer.from('用于验证附件追问的文字'))
        ]);
        await ready(3);
        await page.getByText('无可提取文字的页：2', { exact: true }).waitFor();
        await page.locator('.attachment-chip').filter({ hasText: names[1] }).locator('summary').click();
        const extracted = await page.locator('.attachment-chip').filter({ hasText: names[1] }).locator('pre').innerText();
        assert.match(extracted, /甲方签署\n+乙方确认[\s\S]*- 准备通知\n- 保存回执[\s\S]*价款 \| 10000/);

        await page.locator('#btnKnowledgeBase').click();
        await input.fill('读取付款凭证');
        await send.click();
        await dialog.getByText(/第 2 页/).waitFor();
        const before = requests.length;
        await cancel();
        await idle();
        assert.equal(requests.length, before);
        assert.equal(await input.inputValue(), '读取付款凭证');
        await ready(3);
        await send.click();
        await confirm();
        await idle();
        const first = requests.at(-1);
        assert.match(first.messages[0].content, /合同检索无命中/);
        assert.match(first.messages.at(-1).content, /Payment evidence from page one/);
        assert.match(first.messages.at(-1).content, /无可提取文字的页：2/);
        assert.equal(await page.evaluate(() => chatMessages.at(-1).validation.passed), true);
        await page.locator('#btnKnowledgeBase').click();

        const original = await page.evaluate(() => ({ topicId: AssistantTopics.getCurrentTopicId(), messageId: chatMessages[0].id }));
        await page.reload();
        await openAssistant();
        await submit('刷新后追问');
        assert.match(JSON.stringify(requests.at(-1).messages), /用于验证附件追问的文字/);
        await page.getByRole('button', { name: '从此回复创建分支' }).first().click();
        await page.waitForFunction(topicId => AssistantTopics.getCurrentTopicId() !== topicId, original.topicId);
        const branchId = await page.evaluate(() => AssistantTopics.getCurrentTopicId());
        await submit('分支里追问');
        assert.match(JSON.stringify(requests.at(-1).messages), /用于验证附件追问的文字/);
        await page.evaluate(({ messageId, branchId }) => AssistantAttachments.removeMessage(branchId, messageId), { ...original, branchId });
        await input.fill('缺失时追问');
        await send.click();
        await dialog.getByText(/历史附件的正文缺失/).waitFor();
        await confirm();
        await idle();
        assert.doesNotMatch(JSON.stringify(requests.at(-1).messages), /用于验证附件追问的文字/);
        await page.getByRole('button', { name: '断开上下文', exact: true }).click();
        await page.getByRole('button', { name: '断开上下文', exact: true }).click();
        assert.equal(await page.locator('.context-break').count(), 0);
        await page.getByRole('button', { name: '断开上下文', exact: true }).click();
        await submit('分隔线后问题');
        assert.equal(requests.at(-1).messages.length, 2);

        await page.evaluate(id => AssistantTopics.switchTopic(id), original.topicId);
        await ready(0);
        assert.equal(await page.evaluate(({ topicId, messageId }) => AssistantAttachments.messageAttachments(topicId, messageId).then(items => items.length), original), 3);
        await upload.setInputFiles(file('draft.txt', Buffer.from('附件草稿')));
        await ready(1);
        await input.fill('输入草稿');
        await page.getByRole('button', { name: '清空', exact: true }).click();
        await confirm();
        await page.waitForFunction(() => !assistantClearing);
        await ready(0);
        assert.equal(await input.inputValue(), '');
        assert.equal(await page.locator('.chat-message.user').count(), 0);
        assert.equal(await page.evaluate(({ topicId, messageId }) => AssistantAttachments.messageAttachments(topicId, messageId).then(items => items.length), original), 0);

        await upload.setInputFiles(file('delete-one.txt', Buffer.from('单条删除清理')));
        await ready(1);
        await submit('删除这一条');
        const singleId = await page.evaluate(() => chatMessages.find(message => message.role === 'user').id);
        await page.locator('.chat-message.user').getByRole('button', { name: '删除消息' }).click();
        await page.waitForFunction(({ topicId, singleId }) => AssistantAttachments.messageAttachments(topicId, singleId).then(items => items.length === 0),
            { topicId: original.topicId, singleId });

        await upload.setInputFiles(Array.from({ length: 5 }, (_, i) => file('big' + i + '.txt', Buffer.alloc(450 * 1024, 'x'))));
        await ready(5);
        const countBeforeSize = requests.length;
        await submit('太大的请求');
        assert.equal(await input.inputValue(), '太大的请求');
        assert.equal(requests.length, countBeforeSize);
        await ready(5);
        for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '移除 big' + i + '.txt' }).click();

        const thinking = page.locator('#btnThinkingMode');
        const choose = async label => {
            await thinking.click();
            await page.getByRole('menuitemradio', { name: label, exact: true }).click();
        };
        await choose('极高');
        await submit('DeepSeek 思考档位');
        assert.equal(requests.at(-1).reasoning_effort, 'max');
        await page.evaluate(() => selectModel('gemini'));
        assert.match(await thinking.getAttribute('aria-label'), /自动/);
        await thinking.click();
        assert.equal(await page.getByRole('menuitemradio', { name: '关闭', exact: true }).count(), 0);
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await submit('Gemini 思考档位');
        assert.equal(requests.at(-1).reasoning_effort, 'high');
        await page.evaluate(() => selectModel('openai'));
        await choose('极高');
        await submit('OpenAI 思考档位');
        assert.equal(requests.at(-1).apiStyle, 'responses');
        assert.equal(requests.at(-1).reasoning_effort, 'max');
        await upload.setInputFiles(file('retry.txt', Buffer.from('拒绝后保留')));
        await ready(1);
        await submit('  拒绝档位  ');
        assert.equal(await input.inputValue(), '  拒绝档位  ');
        await ready(1);
        await page.getByRole('button', { name: '移除 retry.txt' }).click();
        await page.evaluate(() => selectModel('unknown'));
        await thinking.click();
        assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['使用模型默认']);
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 390, height: 844 });
        if (await page.locator('#btnToggleNavigator').getAttribute('aria-expanded') === 'true') await page.locator('#btnToggleNavigator').click();
        await thinking.click();
        const menuBox = await page.locator('#assistantThinkingMenu').boundingBox();
        assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 390, 'thinking menu must fit inside the mobile viewport');
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 1300, height: 850 });
        if (await page.locator('#btnToggleNavigator').getAttribute('aria-expanded') === 'false') await page.locator('#btnToggleNavigator').click();

        await input.fill('组字确认测试');
        const beforeIme = requests.length;
        assert.ok(await input.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }))));
        await input.press('Shift+Enter');
        assert.equal(requests.length, beforeIme);
        await input.press('Enter');
        await idle();
        assert.equal(requests.length, beforeIme + 1);

        await page.locator('#btnKnowledgeBase').click();
        await page.evaluate(() => {
            window.originalRetrieve = AIRetrieval.retrieve;
            AIRetrieval.retrieve = (_query, _contracts, _config, { signal }) => new Promise((_, reject) => {
                window.retrievalStarted = true;
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
        });
        const beforeCancel = requests.length;
        await input.fill('检索准备取消');
        await send.click();
        await page.waitForFunction(() => window.retrievalStarted);
        assert.equal(await send.getAttribute('aria-label'), '停止生成');
        await send.click();
        await idle();
        assert.equal(requests.length, beforeCancel);
        assert.equal(await input.inputValue(), '检索准备取消');
        await page.evaluate(() => { AIRetrieval.retrieve = window.originalRetrieve; });
        await page.locator('#btnKnowledgeBase').click();

        await input.fill('停止部分回复');
        await send.click();
        await page.getByText('已经收到的文字').waitFor();
        await send.click();
        await idle();
        assert.match(await page.locator('.chat-message.assistant').last().innerText(), /已经收到的文字[\s\S]*已停止生成/);
        assert.equal(await send.getAttribute('title'), '发送');
        const messages = page.locator('#chatMessages');
        await messages.evaluate(el => { el.scrollTop = 0; });
        const gap = () => messages.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight);
        assert.ok(await gap() > 60);
        await input.fill('验证滚动定位');
        await send.click();
        await page.getByText('验证滚动定位', { exact: true }).waitFor();
        const visible = await page.getByText('验证滚动定位', { exact: true }).evaluate(el => {
            const view = el.closest('#chatMessages').getBoundingClientRect();
            const rect = el.getBoundingClientRect();
            return rect.top < view.bottom && rect.bottom > view.top;
        });
        assert.ok(visible || await gap() <= 1, 'new question or followed response must be in view');
        await idle();
        await upload.setInputFiles(file('delete-topic.txt', Buffer.from('永久删除清理')));
        await ready(1);
        await submit('归档后永久删除');
        const permanentId = await page.evaluate(() => chatMessages.find(message => message.content === '归档后永久删除').id);
        await page.locator('.assistant-topic-item.is-active .assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '归档', exact: true }).click();
        await page.locator('#btnAssistantArchive').click();
        const archived = page.locator('.assistant-topic-item');
        await archived.locator('.assistant-topic-more').click();
        await page.getByRole('menuitem', { name: '永久删除', exact: true }).click();
        await confirm();
        await page.waitForFunction(({ topicId, permanentId }) => AssistantAttachments.messageAttachments(topicId, permanentId).then(items => items.length === 0),
            { topicId: original.topicId, permanentId });
        assert.deepEqual(errors, []);
        console.log('Assistant composer Chrome tests passed: references, attachment parsing, missing and skipped pages, reload, branch, clear, size, reasoning, IME, cancellation, and scrolling.');
    } finally {
        await browser?.close();
        if (server.listening) await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
