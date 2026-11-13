const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.join(__dirname, '..');
const bundled = path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { chromium } = require(process.env.GCM_PLAYWRIGHT_MODULE || bundled);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

async function run() {
    const requests = [];
    const claim = { formatVersion: 1, id: 'claim-report', name: '索赔报告', description: '生成索赔报告。', instructions: '列出通知期限、费用和待补资料。' };
    const flow = { formatVersion: 1, id: 'notice-flow', name: '通知流程图', description: '生成流程图源码。', instructions: '按通知条款输出 Mermaid 源码。' };
    const diagramSource = 'flowchart TD\nA["准备通知（SKILLTEST Clause 1）"] --> B[书面送达]\n';
    const diagram = '```mermaid\n' + diagramSource + '```';
    const badSource = 'flowchart TD\nA[未闭合\n';
    const mermaidPath = '/vendor/mermaid-tiny-12.3.0.js';
    let mermaidDownloads = 0;
    let finishDiagram;
    const server = http.createServer(async (req, res) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === mermaidPath) mermaidDownloads++;
        if (pathname === '/api/ai') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const { body } = JSON.parse(Buffer.concat(chunks));
            const wantsDiagram = body.messages[0].content.includes(flow.instructions);
            if (!body.stream) {
                const content = wantsDiagram ? diagram : 'Skill 测试话题';
                return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content } }] }));
            }
            requests.push(body);
            if (body.messages.at(-1).content === '模拟拒绝') {
                return res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":{"message":"测试请求被拒绝"}}');
            }
            const question = body.messages.at(-1).content;
            const content = question === '检查错误流程图' ? '```mermaid\n' + badSource + '```'
                : wantsDiagram ? diagram : '测试回复已生成，包含通知方式、时限和待补资料。';
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n');
            if (wantsDiagram) await new Promise(resolve => { finishDiagram = resolve; });
            return res.end('data: [DONE]\n\n');
        }
        const local = path.resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
        if (!local.startsWith(root + path.sep)) return res.writeHead(403).end();
        fs.readFile(local, (error, data) => error ? res.writeHead(404).end() : res.writeHead(200, { 'Content-Type': mime[path.extname(local)] || 'application/octet-stream' }).end(data));
    });

    let browser;
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        browser = await chromium.launch({ executablePath: process.env.GCM_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
        const context = await browser.newContext({ viewport: { width: 1300, height: 850 }, permissions: ['clipboard-read', 'clipboard-write'] });
        await context.route('https://**/*', route => route.abort());
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.setDefaultTimeout(8000);
        const openAssistant = async () => {
            await page.evaluate(() => Promise.all([window.contractAppReady, window.assistantTopicsReady]));
            await page.getByRole('button', { name: '管理助手', exact: true }).click();
        };
        await page.goto('http://127.0.0.1:' + server.address().port + '/');
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        assert.equal(mermaidDownloads, 0, 'startup must not fetch Mermaid Tiny');
        await openAssistant();
        await page.evaluate(async () => {
            await registerContract('SKILLTEST', '通知测试合同', { '1': { title: '通知条款', content: '承包人须在七日内书面送达通知。' } });
            const settings = RetrievalSettings.get(contracts);
            settings.sources[contracts.SKILLTEST.sourceId].enabled = true;
            RetrievalSettings.persist(settings, contracts);
            AI_CHAT_MODELS = [{ id: 'test', name: '测试模型', endpoint: 'https://api.openai.com/v1', apiKey: 'dummy', model: 'gpt-4o-mini' }];
            saveChatModels();
            selectModel('test');
        });
        await openAssistant();

        const manager = page.getByRole('dialog', { name: 'Skill 管理' });
        const openManager = () => page.getByRole('button', { name: 'Skill 管理', exact: true }).click();
        const closeManager = () => manager.getByRole('button', { name: '关闭 Skill 管理' }).click();
        const importFile = (name, value) => page.locator('#assistantSkillFile').setInputFiles({
            name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value))
        });
        const install = async skill => {
            await importFile(skill.id + '.skill.json', skill);
            await manager.locator('#assistantSkillReview').getByText(skill.instructions, { exact: true }).waitFor();
            assert.equal(await manager.locator('#assistantSkillLibrary').getByText(skill.name, { exact: true }).count(), 0);
            await manager.getByRole('button', { name: '安装', exact: true }).click();
            await manager.getByText('已安装 ' + skill.name, { exact: true }).waitFor();
        };
        const input = page.locator('#chatInput');
        const skillButton = page.locator('#btnAssistantSkill');
        const send = page.locator('#sendBtn');
        const picker = page.locator('#assistantSkillPicker');
        const option = name => picker.getByRole('option', { name, exact: true });
        const idle = () => page.waitForFunction(() => !isStreaming);
        const submit = async () => { await send.click(); await idle(); };
        const select = async name => { await skillButton.click(); await option(name).click(); };
        const clipboard = () => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'));

        await openManager();
        await importFile('invalid.skill.json', { ...claim, formatVersion: 99 });
        await manager.getByText(/formatVersion 必须为 1/).waitFor();
        await install(claim);
        await install(flow);
        await importFile('duplicate.skill.json', claim);
        await manager.getByText('已安装相同的 Skill。', { exact: true }).waitFor();
        await closeManager();

        await select(claim.name);
        await input.fill('模拟拒绝');
        await submit();
        assert.equal(await input.inputValue(), '模拟拒绝');
        assert.equal(await skillButton.innerText(), 'Skill：索赔报告');
        await input.fill('请起草索赔报告');
        await page.getByRole('button', { name: '引用', exact: true }).click();
        await page.locator('#clauseSelectorModal').getByRole('button', { name: '通知条款' }).click();
        await page.keyboard.press('Escape');
        await submit();
        assert.match(requests.at(-1).messages[0].content, /列出通知期限、费用和待补资料/);
        assert.match(requests.at(-1).messages.at(-1).content, /七日内书面送达/);
        assert.equal(await skillButton.innerText(), 'Skill');
        const claimHistory = page.locator('.chat-message.user').getByText('Skill：索赔报告', { exact: true });
        await claimHistory.waitFor();
        assert.equal(mermaidDownloads, 0, 'text replies must not fetch Mermaid Tiny');

        await input.fill('查询 https:');
        await input.press('/');
        assert.equal(await picker.isVisible(), false);
        await input.fill('绘制流程图 后半段');
        await input.evaluate(el => el.setSelectionRange('绘制流程图 '.length, '绘制流程图 '.length));
        await input.press('/');
        assert.deepEqual(await picker.getByRole('option').allTextContents(), [claim.name, flow.name]);
        await input.press('ArrowDown');
        assert.equal(await option(flow.name).getAttribute('aria-selected'), 'true');
        await input.press('ArrowUp');
        assert.equal(await option(claim.name).getAttribute('aria-selected'), 'true');
        await page.keyboard.insertText('流程');
        assert.deepEqual(await picker.getByRole('option').allTextContents(), [flow.name]);
        const beforeSelect = requests.length;
        await input.press('Enter');
        assert.equal(requests.length, beforeSelect);
        assert.equal(await input.inputValue(), '绘制流程图 后半段');
        assert.equal(await skillButton.innerText(), 'Skill：通知流程图');

        await page.locator('#btnKnowledgeBase').click();
        await input.fill('SKILLTEST Clause 1 通知流程');
        await send.click();
        const chartReply = page.locator('.chat-message.assistant').filter({ hasText: '准备通知' });
        await chartReply.locator('code.language-mermaid').waitFor();
        assert.equal(mermaidDownloads, 0, 'an in-progress reply must not fetch Mermaid Tiny');
        finishDiagram();
        finishDiagram = undefined;
        await idle();
        assert.match(requests.at(-1).messages[0].content, /按通知条款输出 Mermaid 源码/);
        assert.match(requests.at(-1).messages[0].content, /七日内书面送达/);
        const chart = chartReply.getByRole('img', { name: 'Mermaid 流程图' });
        await chart.waitFor();
        assert.ok(await chart.evaluate(img => img.naturalWidth > 0));
        assert.equal(mermaidDownloads, 1);
        await page.waitForFunction(async url => !!await caches.match(url), mermaidPath);
        await chartReply.getByRole('button', { name: '复制源码', exact: true }).click();
        assert.equal(await clipboard(), diagramSource);

        await input.fill('后续普通问答');
        await submit();
        assert.doesNotMatch(requests.at(-1).messages[0].content, /本轮选择了以下合同文本工作指令/);

        await page.locator('#btnKnowledgeBase').click();
        await input.fill('检查错误流程图');
        await submit();
        const failedChart = page.locator('.chat-message.assistant').last();
        await failedChart.getByText('无法显示流程图，可复制源码。').waitFor();
        assert.equal(await failedChart.locator('code.language-mermaid').innerText(), badSource);
        await failedChart.getByRole('button', { name: '复制源码', exact: true }).click();
        assert.equal(await clipboard(), badSource);

        await context.setOffline(true);
        await page.reload();
        assert.equal(await page.getByRole('img', { name: 'Mermaid 流程图' }).count(), 0, 'history should render when the assistant opens');
        await openAssistant();
        await chart.waitFor();
        await failedChart.getByText('无法显示流程图，可复制源码。').waitFor();
        assert.equal(mermaidDownloads, 1, 'cached Mermaid Tiny must work offline');
        await context.setOffline(false);

        await page.reload();
        await openAssistant();
        await claimHistory.waitFor();
        const regenerate = page.getByRole('button', { name: '重新生成回复', exact: true }).first();
        await regenerate.click();
        await idle();
        assert.match(requests.at(-1).messages[0].content, /列出通知期限、费用和待补资料/);
        await openManager();
        await importFile('updated.skill.json', { ...claim, instructions: '替换后的指令。' });
        await manager.getByRole('button', { name: '替换', exact: true }).click();
        await manager.getByText('已替换 索赔报告', { exact: true }).waitFor();
        await closeManager();

        await select(claim.name);
        await openManager();
        const claimRow = manager.locator('#assistantSkillLibrary li').filter({ hasText: claim.name });
        await claimRow.getByRole('button', { name: '停用', exact: true }).click();
        await manager.getByText('已停用 索赔报告', { exact: true }).waitFor();
        await closeManager();
        assert.equal(await skillButton.innerText(), 'Skill');
        await input.fill('停用检查 ');
        await input.press('/');
        assert.deepEqual(await picker.getByRole('option').allTextContents(), [flow.name]);
        await input.press('Escape');
        assert.equal(await picker.isVisible(), false);

        await openManager();
        await claimRow.getByRole('button', { name: '启用', exact: true }).click();
        await manager.getByText('已启用 索赔报告', { exact: true }).waitFor();
        await claimRow.getByRole('button', { name: '卸载', exact: true }).click();
        await claimRow.getByRole('button', { name: '确认卸载', exact: true }).click();
        await manager.getByText('已卸载 索赔报告', { exact: true }).waitFor();
        await closeManager();
        await claimHistory.waitFor();
        await regenerate.click();
        await page.locator('.custom-dialog-content').getByText(/版本在本机不可用/).waitFor();
        await page.locator('.custom-dialog-content').getByRole('button', { name: '确定', exact: true }).click();
        await idle();
        assert.doesNotMatch(requests.at(-1).messages[0].content, /本轮选择了以下合同文本工作指令/);

        await page.reload();
        await openAssistant();
        await page.setViewportSize({ width: 390, height: 844 });
        if (await page.locator('#btnToggleNavigator').getAttribute('aria-expanded') === 'true') await page.locator('#btnToggleNavigator').click();
        await chart.waitFor();
        const chartBox = await chart.boundingBox();
        assert.ok(chartBox.x >= 0 && chartBox.x + chartBox.width <= 390, 'flowchart fits in mobile viewport');
        assert.equal(mermaidDownloads, 1, 'cached Mermaid Tiny must be reused online');
        await skillButton.click();
        assert.deepEqual(await picker.getByRole('option').allTextContents(), [flow.name]);
        const box = await picker.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0, 'Skill picker fits in mobile viewport');
        assert.deepEqual(errors, []);
        console.log('Assistant Skill Chrome tests passed: Skill lifecycle, retrieval, deferred Mermaid load, clipboard, invalid syntax, offline history, and mobile.');
    } finally {
        finishDiagram?.();
        await browser?.close();
        server.close();
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
