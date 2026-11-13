const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.GCM_PLAYWRIGHT_MODULE ||
    path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return response.writeHead(403).end();
    fs.readFile(file, (error, data) => {
        if (error) return response.writeHead(404).end();
        response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
    });
});

async function selectText(page, quote, id = '1', endId = id, translation = false) {
    await page.evaluate(async ({ quote, id, endId, translation }) => {
        const body = id => document.querySelector(translation
            ? '#refContent .translation-text[data-translation-clause="' + id + '"]'
            : '#clause-' + id + ' .clause-text');
        const start = body(id);
        const end = body(endId);
        const offset = start.textContent.indexOf(quote);
        if (offset < 0) throw new Error('Missing quote: ' + quote);
        const point = (element, index) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                if (index <= node.length) return [node, index];
                index -= node.length;
            }
            throw new Error('Selection offset outside clause');
        };
        start.scrollIntoView({ block: 'center' });
        // Let panel scroll events finish before creating the selection.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        start.focus({ preventScroll: true });
        const range = document.createRange();
        range.setStart(...point(start, offset));
        range.setEnd(...point(end, id === endId ? offset + quote.length : end.textContent.length));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        start.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, { quote, id, endId, translation });
    await page.locator('#floatingToolbar').waitFor();
}

const paragraph = 'Payment notice';
const clause = page => page.locator('#clause-1 .clause-text');
const toolbar = page => page.locator('#floatingToolbar');
const panel = page => page.locator('#selectionResultPanel');
const more = page => toolbar(page).getByRole('button', { name: '更多', exact: true }).click();
const tab = (page, key) => page.locator('#contract-tabs [data-key="' + key + '"]').click();
const tags = page => page.evaluate(() => (fullClauseDatabase['1'].reviewTags || []).flatMap(entry => entry.labels));
const undo = page => page.keyboard.press('Control+z');
const clipboard = page => page.evaluate(() => navigator.clipboard.readText());

async function eventually(check, description) {
    const deadline = Date.now() + 4500;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail(description);
}

async function annotation(page, value, quote = paragraph, translation = false) {
    await selectText(page, quote, '1', '1', translation);
    await toolbar(page).getByRole('button', { name: '添加/编辑备注' }).click();
    const dialog = page.locator('.custom-dialog-content');
    await dialog.locator('input').fill(value);
    await dialog.getByRole('button', { name: '确定', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
}

async function toggleTag(page, label) {
    await selectText(page, paragraph);
    await more(page);
    await toolbar(page).getByRole('button', { name: '审阅标签 ▸' }).click();
    await toolbar(page).getByRole('button', { name: label, exact: true }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
}

async function applyColor(page, name, palette = '高亮颜色') {
    await selectText(page, paragraph);
    await toolbar(page).getByRole('button', { name: palette, exact: true }).click();
    await toolbar(page).getByRole('button', { name, exact: true }).click();
}

async function formatOnWord(page, word, property) {
    return clause(page).evaluate((element, { word, property }) => {
        const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walk.nextNode())) {
            if (!node.textContent.includes(word)) continue;
            for (let parent = node.parentElement; parent !== element; parent = parent.parentElement) {
                const style = parent.style.getPropertyValue(property);
                if (style) return style;
            }
            return '';
        }
        return null;
    }, { word, property });
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true,
            executablePath: process.env.GCM_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
        const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, serviceWorkers: 'block' });
        const origin = 'http://127.0.0.1:' + server.address().port;
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(4500);
        const errors = [];
        let aiCalls = 0;
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (new URL(request.url()).pathname === '/api/ai') aiCalls++; });
        await page.goto(origin);
        await page.evaluate(() => window.contractAppReady);
        await page.evaluate(() => {
            registerContract('A', 'Alpha Contract', {
                '1': { title: 'Payment terms', content: '<p>Payment notice and written records. <em>Preserve emphasis.</em></p>',
                    translation: '付款通知与书面记录。', translation_tc: '付款通知與書面紀錄。' },
                '2': { title: 'Records', content: 'Retention requirements.', translation: '保留记录的要求。' }
            });
            registerContract('B', 'Beta Contract', {
                '1': { title: 'Notice requirements', content: 'A Payment notice must be submitted in writing.',
                    translation: '应当以书面形式提交通知。' }
            });
        });
        await tab(page, 'A');
        const original = await clause(page).innerHTML();

        // A real double-click summons the toolbar. Both copy actions reach the clipboard.
        const point = await clause(page).evaluate(body => {
            const range = document.createRange();
            range.setStart(body.firstChild.firstChild, 0);
            range.setEnd(body.firstChild.firstChild, 7);
            const rect = range.getBoundingClientRect();
            return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
        });
        await page.mouse.dblclick(point.x, point.y);
        await toolbar(page).getByRole('button', { name: '复制', exact: true }).click();
        await eventually(async () => (await clipboard(page)).includes('《Alpha Contract》 · 第 1 条 · Payment terms'), 'copy omitted the source');
        assert.match(await clipboard(page), /^Payment\s*\n/);
        await selectText(page, paragraph);
        await toolbar(page).getByRole('button', { name: '复制选项' }).click();
        await toolbar(page).getByRole('button', { name: '仅复制文字' }).click();
        await eventually(async () => (await clipboard(page)) === paragraph, 'text-only copy did not reach the clipboard');
        await selectText(page, 'written records', '1', '2');
        await toolbar(page).getByRole('button', { name: '复制', exact: true }).click();
        await eventually(async () => (await clipboard(page)).includes('第 2 条 · Records'), 'cross-clause copy omitted the second source');
        assert.match(await clipboard(page), /第 1 条 · Payment terms[\s\S]+Retention requirements\./);

        // Scope and query can change independently. Opening a result keeps the search session.
        await selectText(page, paragraph);
        await more(page);
        await toolbar(page).getByRole('button', { name: '搜索选中文字' }).click();
        const searchInput = page.locator('.search-input');
        assert.equal(await searchInput.inputValue(), paragraph);
        assert.deepEqual(await panel(page).locator('h3').allTextContents(), ['Alpha Contract']);
        await panel(page).getByRole('button', { name: '全部可见合同', exact: true }).click();
        assert.deepEqual(await panel(page).locator('h3').allTextContents(), ['Alpha Contract', 'Beta Contract']);

        async function setBetaVisibility(visible) {
            await page.locator('button[title="AI 设置"]').click();
            await page.locator('#tabContractSettings').click();
            const toggle = page.getByRole('switch', { name: 'B 可见', exact: true });
            await toggle.click();
            assert.equal(await toggle.getAttribute('aria-checked'), String(visible));
            await page.getByRole('button', { name: '关闭设置' }).click();
        }
        await setBetaVisibility(false);
        assert.deepEqual(await panel(page).locator('h3').allTextContents(), ['Alpha Contract']);
        assert.equal(await searchInput.inputValue(), paragraph);
        await searchInput.fill('submitted');
        assert.equal(await panel(page).locator('.selection-result-item').count(), 0);
        await searchInput.fill(paragraph);
        await setBetaVisibility(true);
        assert.deepEqual(await panel(page).locator('h3').allTextContents(), ['Alpha Contract', 'Beta Contract']);

        await searchInput.fill('submitted');
        assert.deepEqual(await panel(page).locator('h3').allTextContents(), ['Beta Contract']);
        await searchInput.fill(paragraph);
        await panel(page).getByRole('button', { name: /Notice requirements/ }).click();
        await page.waitForFunction(() => activeContractKey === 'B' && CSS.highlights.has('selection-result'));
        assert.equal(await searchInput.inputValue(), paragraph);
        assert.equal(await panel(page).getByRole('button', { name: '全部可见合同', exact: true }).getAttribute('aria-pressed'), 'true');
        await panel(page).getByRole('button', { name: '当前合同', exact: true }).click();
        assert.deepEqual(await panel(page).locator('h3').allTextContents(), ['Beta Contract']);
        await panel(page).getByRole('button', { name: '关闭结果面板' }).click();
        assert.equal(await searchInput.inputValue(), '');
        await tab(page, 'A');

        // Every named color applies to the actual selection, and each change can be undone.
        const palette = [
            ['浅橙', '255, 204, 128'], ['浅绿', '204, 255, 144'], ['浅蓝', '129, 212, 250'], ['浅紫', '206, 147, 216'],
            ['浅黄', '255, 245, 157'], ['浅粉', '248, 187, 208'], ['浅青', '128, 203, 196'], ['浅灰', '224, 224, 224']
        ];
        await selectText(page, paragraph);
        await toolbar(page).getByRole('button', { name: '高亮颜色' }).click();
        assert.equal(await page.locator('#highlightMenu').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length), 4);
        assert.equal(await page.locator('#highlightMenu button:visible').count(), 8);
        await page.keyboard.press('Escape');
        for (const [name, rgb] of palette) {
            await applyColor(page, name);
            assert.equal(await formatOnWord(page, paragraph, 'background-color'), 'rgb(' + rgb + ')');
            await undo(page);
            assert.equal(await clause(page).innerHTML(), original);
        }
        await applyColor(page, '红色', '文字颜色');
        assert.equal(await formatOnWord(page, paragraph, 'color'), 'rgb(231, 76, 60)');
        await selectText(page, paragraph);
        await toolbar(page).getByRole('button', { name: '加粗' }).click();
        assert.equal(await formatOnWord(page, paragraph, 'font-weight'), 'bold');
        await undo(page);
        assert.equal(await formatOnWord(page, paragraph, 'color'), 'rgb(231, 76, 60)');
        await undo(page);
        assert.equal(await clause(page).innerHTML(), original);

        // Mixed operations roll back in order, including across a contract switch.
        await applyColor(page, '浅黄');
        await annotation(page, 'Initial review');
        await toggleTag(page, '风险点');
        await toggleTag(page, '待确认');
        await annotation(page, 'Revised review');
        await selectText(page, 'notice');
        await more(page);
        await toolbar(page).getByRole('button', { name: '清除格式' }).click();
        assert.equal(await formatOnWord(page, 'Payment', 'background-color'), 'rgb(255, 245, 157)');
        assert.equal(await formatOnWord(page, 'notice', 'background-color'), '');
        assert.equal(await clause(page).locator('.note-span').getAttribute('data-note'), 'Revised review');
        assert.deepEqual(await tags(page), ['风险点', '待确认']);
        assert.equal(await clause(page).locator('em').textContent(), 'Preserve emphasis.');
        await selectText(page, paragraph);
        await more(page);
        await toolbar(page).getByRole('button', { name: '删除备注' }).click();
        assert.equal(await clause(page).locator('.note-span').count(), 0);
        assert.equal(await formatOnWord(page, 'Payment', 'background-color'), 'rgb(255, 245, 157)');
        await tab(page, 'B');
        await undo(page);
        assert.deepEqual(await tags(page), []);
        await tab(page, 'A');
        await undo(page);
        assert.equal(await clause(page).locator('.note-span').getAttribute('data-note'), 'Revised review');
        assert.equal(await formatOnWord(page, 'notice', 'background-color'), '');
        await undo(page);
        assert.equal(await formatOnWord(page, 'notice', 'background-color'), 'rgb(255, 245, 157)');
        await undo(page);
        assert.equal(await clause(page).locator('.note-span').getAttribute('data-note'), 'Initial review');
        await undo(page);
        assert.deepEqual(await tags(page), ['风险点']);
        await undo(page);
        assert.deepEqual(await tags(page), []);
        await undo(page);
        assert.equal(await clause(page).locator('.note-span').count(), 0);
        await undo(page);
        assert.equal(await clause(page).innerHTML(), original);

        // Tag viewing overlays the existing layout, filters, links, and survives reload.
        await toggleTag(page, '待谈判');
        await tab(page, 'B');
        await toggleTag(page, '重要义务');
        const mainBefore = await page.locator('#panelMain').boundingBox();
        await page.getByRole('button', { name: '查看审阅标签' }).click();
        assert.deepEqual(await page.locator('#panelMain').boundingBox(), mainBefore);
        await panel(page).getByRole('combobox', { name: '按审阅标签筛选' }).selectOption('待谈判');
        assert.deepEqual(await panel(page).locator('h3').allTextContents(), ['Alpha Contract']);
        await panel(page).getByRole('button', { name: /Payment terms/ }).click();
        await page.waitForFunction(() => activeContractKey === 'A' && CSS.highlights.has('selection-result'));
        await eventually(() => page.evaluate(async () => {
            const saved = JSON.parse(await localforage.getItem(CONTRACTS_DB_KEY));
            return saved?.contracts.A.data['1'].reviewTags?.[0]?.labels[0] === '待谈判' &&
                saved?.contracts.B.data['1'].reviewTags?.[0]?.labels[0] === '重要义务' &&
                !saved.contracts.A.data['1'].content.includes('note-span');
        }), 'autosave did not persist the labels and restored content');
        await page.reload();
        await page.evaluate(() => window.contractAppReady);
        await tab(page, 'A');
        assert.deepEqual(await tags(page), ['待谈判']);
        assert.equal(await clause(page).innerHTML(), original);
        const snapshots = await page.evaluate(() => ({
            backup: extractAllUserModifications(),
            cloud: collectCloudModifications({ contract_data: collectAllContractData() })
        }));
        assert.deepEqual(snapshots.backup.A['1'].reviewTags[0].labels, ['待谈判']);
        assert.deepEqual(snapshots.cloud.B['1'].reviewTags[0].labels, ['重要义务']);
        await toggleTag(page, '待谈判');
        assert.deepEqual(await tags(page), []);
        await undo(page);
        assert.deepEqual(await tags(page), ['待谈判']);

        // A run of typing is one undo step, separate from the earlier tag edit.
        await page.locator('#btnEditMode').click();
        await selectText(page, 'records');
        await page.keyboard.type('receipts', { delay: 12 });
        assert.match(await clause(page).textContent(), /written receipts/);
        await undo(page);
        assert.equal(await clause(page).innerHTML(), original);
        assert.deepEqual(await tags(page), ['待谈判']);
        await page.locator('#btnEditMode').click();

        // The ordinary search box keeps its own text undo history.
        await searchInput.click();
        await page.keyboard.type('notice', { delay: 12 });
        await undo(page);
        const searchAfterUndo = await searchInput.inputValue();
        assert(searchAfterUndo.length < 'notice'.length && 'notice'.startsWith(searchAfterUndo));
        assert.deepEqual(await tags(page), ['待谈判']);
        await searchInput.fill('');
        assert.equal(await clause(page).innerHTML(), original);

        // Drag-select a translation in reading mode and check that copy and edits use the right pane.
        const translation = page.locator('#refContent .translation-text');
        const translationQuote = '付款通知';
        const selectTranslation = (quote = translationQuote, endId = '1') => selectText(page, quote, '1', endId, true);
        const showTranslation = () => page.locator('#clause-1 h2').click();
        await showTranslation();
        const drag = await translation.evaluate(element => {
            const range = document.createRange();
            range.setStart(element.firstChild, 0);
            range.setEnd(element.firstChild, 4);
            const rect = range.getBoundingClientRect();
            return { left: rect.left + 1, right: rect.right - 1, y: (rect.top + rect.bottom) / 2 };
        });
        await page.mouse.move(drag.left, drag.y);
        await page.mouse.down();
        await page.mouse.move(drag.right, drag.y, { steps: 8 });
        await page.mouse.up();
        const draggedText = await page.evaluate(() => window.getSelection().toString());
        assert(draggedText.startsWith(translationQuote));
        await toolbar(page).getByRole('button', { name: '复制', exact: true }).click();
        await eventually(async () => (await clipboard(page)).includes('简体译文'), 'translation copy did not reach the clipboard');
        assert.equal((await clipboard(page)).replace(/\r\n/g, '\n'),
            draggedText + '\n——《Alpha Contract》 · 第 1 条 · Payment terms · 简体译文');
        await annotation(page, '译文备注', translationQuote, true);
        await annotation(page, '更新译文备注', translationQuote, true);
        const translationNote = translation.locator('.note-span');
        assert.equal(await translationNote.getAttribute('data-note'), '更新译文备注');
        assert.equal(await clause(page).locator('.note-span').count(), 0);
        await selectTranslation();
        await more(page);
        await toolbar(page).getByRole('button', { name: '删除备注', exact: true }).click();
        assert.equal(await translationNote.count(), 0);
        await undo(page);
        assert.equal(await translationNote.getAttribute('data-note'), '更新译文备注');

        await selectTranslation();
        await toolbar(page).getByRole('button', { name: '文字颜色', exact: true }).click();
        const fontPalette = page.locator('#fontColorMenu');
        assert.deepEqual(await fontPalette.locator('button').evaluateAll(buttons => buttons.map(button => button.title)),
            ['红色', '黄色', '蓝色', '紫色', '橙色', '绿色', '青色', '粉色']);
        await fontPalette.getByRole('button', { name: '绿色', exact: true }).click();
        assert.match(await translation.innerHTML(), /color: rgb\(39, 174, 96\)/);
        assert.doesNotMatch(await clause(page).innerHTML(), /39, 174, 96/);
        await selectTranslation();
        await more(page);
        await toolbar(page).getByRole('button', { name: '清除格式', exact: true }).click();
        assert.doesNotMatch(await translation.innerHTML(), /color:/);
        assert.equal(await translationNote.getAttribute('data-note'), '更新译文备注');
        await undo(page);
        assert.match(await translation.innerHTML(), /color: rgb\(39, 174, 96\)/);

        await page.locator('#btnLangToggle').click();
        assert.match(await translation.textContent(), /書面紀錄/);
        assert.equal(await translationNote.count(), 0);
        await selectTranslation();
        await more(page);
        await toolbar(page).getByRole('button', { name: '审阅标签 ▸' }).click();
        await toolbar(page).getByRole('button', { name: '风险点', exact: true }).click();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await page.locator('#btnLangToggle').click();
        await page.getByRole('button', { name: '查看审阅标签' }).click();
        await panel(page).getByRole('button', { name: /繁體譯文.*付款通知.*风险点/ }).click();
        await page.waitForFunction(() => isTraditionalChinese && CSS.highlights.has('selection-result'));
        await panel(page).getByRole('button', { name: '关闭结果面板' }).click();
        await page.locator('#btnLangToggle').click();

        await page.locator('#btnSync').click();
        await page.waitForFunction(() => !syncScrollLock);
        await selectTranslation(translationQuote, '2');
        await toolbar(page).getByRole('button', { name: '复制', exact: true }).click();
        await eventually(async () => (await clipboard(page)).includes('第 2 条 · Records · 简体译文'), 'sync copy omitted the second translation');
        await page.locator('#btnSync').click();
        await tab(page, 'B');
        await showTranslation();
        await selectTranslation('书面形式');
        await more(page);
        await toolbar(page).getByRole('button', { name: '搜索选中文字' }).click();
        await panel(page).getByRole('button', { name: /Notice requirements.*简体译文/ }).click();
        await page.waitForFunction(() => CSS.highlights.has('selection-result'));
        await panel(page).getByRole('button', { name: '关闭结果面板' }).click();
        await tab(page, 'A');
        await showTranslation();
        await page.evaluate(() => showCrossContractRef('B', '1'));
        await selectTranslation('书面形式');
        await toolbar(page).getByRole('button', { name: '复制', exact: true }).click();
        await eventually(async () => (await clipboard(page)).includes('《Beta Contract》 · 第 1 条 · Notice requirements · 简体译文'),
            'cross-contract translation copy used the wrong source');
        await annotation(page, '跨合同备注', '书面形式', true);
        assert.equal(await page.evaluate(() => contracts.A.data['1'].translation.includes('跨合同备注')), false);
        assert.equal(await page.evaluate(() => contracts.B.data['1'].translation.includes('跨合同备注')), true);
        await undo(page);
        assert.equal(await translation.locator('.note-span').count(), 0);

        // Each AI action creates its own empty topic and persists the editable prompt.
        await page.locator('#tab-Assistant').click();
        await page.evaluate(() => window.assistantTopicsReady);
        const input = page.locator('#chatInput');
        const currentTopic = () => page.evaluate(() => AssistantTopics.getCurrentTopicId());
        const existingId = await currentTopic();
        await page.evaluate(async () => {
            const messages = [{ role: 'user', content: 'Existing message' }];
            applyAssistantTopicChatState({ messages });
            await saveChatToStorage();
        });
        await input.fill('Existing draft');
        const drafts = new Map();
        for (const [action, translated] of [['解释这段', false], ['分析风险', true], ['拟修改建议', true]]) {
            await tab(page, 'A');
            if (translated) { await showTranslation(); await selectTranslation(); }
            else await selectText(page, paragraph);
            await toolbar(page).getByRole('button', { name: '发送给 AI' }).click();
            assert.deepEqual(await page.locator('#selectionAiMenu button').allTextContents(), ['解释这段', '分析风险', '拟修改建议']);
            await toolbar(page).getByRole('button', { name: action, exact: true }).click();
            await page.waitForFunction(action => document.getElementById('chatInput').value.startsWith(action + '：'), action);
            const id = await currentTopic();
            assert(id !== existingId && !drafts.has(id));
            const draft = await input.inputValue();
            assert(draft.includes('Alpha Contract'));
            assert(draft.includes(translated ? '简体译文】\n付款通知' : 'Payment notice'));
            assert.equal(await page.locator('#chatMessages .chat-message').count(), 0);
            assert.equal(await page.locator('.assistant-topic-item.is-active').getAttribute('data-topic-id'), id);
            assert(await input.evaluate(element => document.activeElement === element));
            drafts.set(id, draft);
        }
        await page.locator(`.assistant-topic-item[data-topic-id="${existingId}"] .assistant-topic-select`).click();
        await page.waitForFunction(() => document.getElementById('chatInput').value === 'Existing draft');
        assert.equal(await page.locator('#chatMessages .message-content').textContent(), 'Existing message');
        await page.reload();
        await page.evaluate(() => window.contractAppReady);
        await page.locator('#tab-Assistant').click();
        for (const [id, draft] of drafts) {
            await page.locator(`.assistant-topic-item[data-topic-id="${id}"] .assistant-topic-select`).click();
            await page.waitForFunction(draft => document.getElementById('chatInput').value === draft, draft);
        }
        await tab(page, 'A');
        await showTranslation();
        assert.equal(await translationNote.getAttribute('data-note'), '更新译文备注');
        assert.match(await translation.innerHTML(), /color: rgb\(39, 174, 96\)/);
        assert.equal(aiCalls, 0);

        // An in-progress reply finishes in its original topic before the shortcut opens the new draft.
        let releaseReply;
        const replyGate = new Promise(resolve => { releaseReply = resolve; });
        await page.route('**/api/ai', async route => {
            if (!route.request().postDataJSON().body.stream) {
                await route.fulfill({ json: { choices: [{ message: { content: '旧话题' } }] } });
                return;
            }
            await replyGate;
            await route.fulfill({ contentType: 'text/event-stream',
                body: 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Old topic reply' } }] }) + '\n\ndata: [DONE]\n\n' });
        });
        await page.locator('#tab-Assistant').click();
        await page.locator(`.assistant-topic-item[data-topic-id="${existingId}"] .assistant-topic-select`).click();
        await page.waitForFunction(() => document.getElementById('chatInput').value === 'Existing draft');
        await page.evaluate(() => Object.assign(AI_CONFIG, {
            apiEndpoint: 'https://api.deepseek.com/v1', apiKey: 'test-only', model: 'deepseek-chat'
        }));
        await input.fill('Wait for this reply');
        const oldRequest = page.waitForRequest('**/api/ai');
        await page.locator('#sendBtn').click();
        await oldRequest;
        await tab(page, 'A');
        await selectText(page, paragraph);
        await toolbar(page).getByRole('button', { name: '发送给 AI' }).click();
        await toolbar(page).getByRole('button', { name: '分析风险', exact: true }).click();
        assert.equal(await currentTopic(), existingId);
        releaseReply();
        await page.waitForFunction(() => document.getElementById('chatInput').value.startsWith('分析风险：'));
        assert.notEqual(await currentTopic(), existingId);
        assert.equal(await page.locator('#chatMessages .chat-message').count(), 0);
        await page.locator(`.assistant-topic-item[data-topic-id="${existingId}"] .assistant-topic-select`).click();
        await page.locator('#chatMessages .message-content').getByText('Old topic reply').waitFor();
        assert.equal(await page.locator('#chatMessages .chat-message.user').last().textContent().then(text => text.includes('Wait for this reply')), true);
        assert.equal(await input.inputValue(), '');
        await tab(page, 'A');
        await page.setViewportSize({ width: 540, height: 820 });
        await selectText(page, paragraph);
        await more(page);
        await toolbar(page).getByRole('button', { name: '搜索选中文字' }).click();
        const bounds = await panel(page).boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= 540 && bounds.y + bounds.height <= 820,
            'scoped search panel must stay inside the narrow viewport');
        await panel(page).getByRole('button', { name: '全部可见合同', exact: true }).click();
        assert.equal(await panel(page).locator('.selection-result-item').count(), 2);
        await panel(page).getByRole('button', { name: '关闭结果面板' }).click();
        const narrowLayout = await page.locator('#panelMain').boundingBox();
        await page.getByRole('button', { name: '查看审阅标签' }).click();
        assert.deepEqual(await page.locator('#panelMain').boundingBox(), narrowLayout);
        await panel(page).getByRole('button', { name: '关闭结果面板' }).click();

        // Move actions in both directions, including submenu triggers, through the settings UI.
        await page.setViewportSize({ width: 1100, height: 820 });
        const general = page.locator('#generalSettingsContent');
        const checkbox = name => general.getByRole('checkbox', { name, exact: true });
        const openGeneral = async () => {
            await page.getByTitle('AI 设置', { exact: true }).click();
            await page.getByRole('button', { name: '通用设置', exact: true }).click();
        };
        const save = async () => {
            await page.getByRole('button', { name: '保存设置' }).click();
            await general.waitFor({ state: 'hidden' });
        };
        await openGeneral();
        assert.equal(await page.locator('#tabContractSettings + #tabGeneralSettings').count(), 1);
        assert(await checkbox('复制').isChecked());
        assert(!(await checkbox('搜索选中文字').isChecked()));
        await checkbox('复制').uncheck();
        await checkbox('高亮颜色').uncheck();
        await checkbox('搜索选中文字').check();
        await checkbox('审阅标签').check();
        await save();

        await selectText(page, paragraph);
        assert(await toolbar(page).getByRole('button', { name: '搜索选中文字' }).isVisible());
        assert(!(await toolbar(page).getByRole('button', { name: '复制', exact: true }).isVisible()));
        await more(page);
        await toolbar(page).getByRole('button', { name: '复制 ▸', exact: true }).click();
        await toolbar(page).getByRole('button', { name: '仅复制文字' }).click();
        await eventually(async () => (await clipboard(page)) === paragraph, 'copy submenu stopped working under More');
        await selectText(page, paragraph);
        await more(page);
        await toolbar(page).getByRole('button', { name: '高亮颜色 ▸', exact: true }).click();
        assert(await toolbar(page).getByRole('button', { name: '浅黄', exact: true }).isVisible());
        await page.keyboard.press('Escape');
        await toolbar(page).getByRole('button', { name: '审阅标签', exact: true }).click();
        assert(await toolbar(page).getByRole('button', { name: '待确认', exact: true }).isVisible());
        await page.keyboard.press('Escape');
        await toolbar(page).getByRole('button', { name: '搜索选中文字' }).click();
        assert(await panel(page).isVisible());
        await panel(page).getByRole('button', { name: '关闭结果面板' }).click();

        await openGeneral();
        await checkbox('复制').check();
        await page.getByRole('button', { name: '取消', exact: true }).click();
        await page.reload();
        await page.evaluate(() => window.contractAppReady);
        await tab(page, 'B');
        await selectText(page, paragraph);
        assert(await toolbar(page).getByRole('button', { name: '搜索选中文字' }).isVisible());
        assert(!(await toolbar(page).getByRole('button', { name: '复制', exact: true }).isVisible()));

        await openGeneral();
        for (const option of await general.getByRole('checkbox').all()) await option.check();
        await save();
        await page.setViewportSize({ width: 375, height: 800 });
        await selectText(page, paragraph);
        assert(!(await toolbar(page).getByRole('button', { name: '更多', exact: true }).isVisible()));
        const toolbarBounds = await toolbar(page).boundingBox();
        assert(toolbarBounds.x >= 0 && toolbarBounds.x + toolbarBounds.width <= 375 &&
            toolbarBounds.y >= 0 && toolbarBounds.y + toolbarBounds.height <= 800);
        await page.locator('#tab-Welcome').click();
        assert(!(await toolbar(page).isVisible()));
        assert.deepEqual(errors, []);
        console.log('Selection toolbar browser tests passed (actions, search, undo, tags, AI draft, toolbar settings, persistence and narrow viewport).');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
