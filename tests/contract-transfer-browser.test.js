const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.GCM_PLAYWRIGHT_MODULE || path.join(
    process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root = path.resolve(__dirname, '..');
const origin = 'http://gcm-contract-transfer.localhost';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

async function connectFirestore(page) {
    await page.evaluate(() => {
        initialized = true;
        currentUser = { uid: 'contract-transfer-test', email: 'test@example.test' };
        function ref(path) {
            return {
                path,
                id: path.split('/').pop(),
                collection: name => collection(path + '/' + name),
                doc: id => ref(path + '/' + id),
                get: () => cloudCall('get', path).then(data => snapshot(path, data)),
                orderBy: field => ({ get: () => query(path, field) })
            };
        }
        function snapshot(path, data) {
            return { id: path.split('/').pop(), ref: ref(path), exists: data != null, data: () => data || undefined };
        }
        async function query(path, field) {
            const docs = (await cloudCall('query', path)).map(([key, value]) => snapshot(key, value));
            if (field) docs.sort((a, b) => a.data()[field] - b.data()[field]);
            return { docs, size: docs.length, forEach: fn => docs.forEach(fn) };
        }
        function collection(path) {
            return { ...ref(path), get: () => query(path) };
        }
        db = {
            collection,
            async runTransaction(action) {
                for (let attempt = 0; attempt < 5; attempt++) {
                    const operations = [];
                    const reads = [];
                    const result = await action({
                        async get(document) {
                            const value = await cloudCall('get', document.path);
                            reads.push([document.path, value]);
                            return snapshot(document.path, value);
                        },
                        set(document, data, options) { operations.push(['set', document.path, data, options]); },
                        delete(document) { operations.push(['delete', document.path]); }
                    });
                    if (await cloudCall('commit', { reads, operations })) return result;
                }
                throw new Error('Simulated Firestore transaction retries exhausted');
            }
        };
    });
}

(async () => {
    const executablePath = [process.env.GCM_BROWSER_EXECUTABLE, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', chromium.executablePath()]
        .find(file => file && fs.existsSync(file));
    const browser = await chromium.launch({ headless: true, executablePath });
    const cloud = new Map();
    const errors = [];
    const cloudCall = (_, action, arg) => {
        if (action === 'get') return cloud.get(arg) ?? null;
        if (action === 'query') return [...cloud].filter(([key]) => key.startsWith(arg + '/') && !key.slice(arg.length + 1).includes('/'));
        for (const [key, expected] of arg.reads) {
            if (JSON.stringify(cloud.get(key) ?? null) !== JSON.stringify(expected)) return false;
        }
        for (const [operation, key, value, options] of arg.operations) {
            if (operation === 'delete') cloud.delete(key);
            else cloud.set(key, options?.mergeFields ? { ...cloud.get(key), ...value } : value);
        }
        return true;
    };
    async function openDevice() {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.exposeBinding('cloudCall', cloudCall);
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404 });
            return route.fulfill({ path: file, contentType: mime[path.extname(file)] || 'application/octet-stream' });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin);
        await page.evaluate(() => window.contractAppReady);
        await connectFirestore(page);
        return page;
    }
    const menu = (page, title, option) => page.getByTitle(title, { exact: true }).click()
        .then(() => page.getByRole('button', { name: option, exact: true }).click());
    const status = (page, text) => page.waitForFunction(value => StatusCenter.snapshot().some(entry => entry.message.includes(value)), text);
    const tab = (page, key) => page.locator('.contract-tab').filter({ hasText: new RegExp('^' + key.replace(/[()]/g, '\\$&') + '$') });
    const named = (name, clauses) => JSON.stringify({ $contract: { name, shortName: name }, ...clauses });
    const clause = (title, content) => ({ title, content });
    async function importTxt(page, option, input, expected, file = 'contract.txt') {
        const pending = page.waitForEvent('filechooser');
        await menu(page, '导入合同数据', option);
        await (await pending).setFiles({ name: file, mimeType: 'text/plain', buffer: Buffer.from(input) });
        const dialog = page.locator('.custom-dialog-content');
        if (!expected) return;
        assert.match(await dialog.innerText(), expected);
        await dialog.getByRole('button', { name: '确定', exact: true }).click();
        await page.waitForFunction(() => StatusCenter.snapshot().filter(item => item.source === '合同导入').at(-1)?.message.includes('导入成功'));
    }
    async function exportTxt(page, option) {
        const pending = page.waitForEvent('download');
        await menu(page, '导出合同文档', option);
        const download = await pending;
        assert.match(download.suggestedFilename(), /\.txt$/);
        return fs.readFileSync(await download.path(), 'utf8');
    }
    async function sync(page) {
        const before = await page.evaluate(() => StatusCenter.snapshot().map(item => item.id));
        await page.getByTitle('云备份', { exact: true }).click();
        await page.getByRole('button', { name: /^智能合并同步/ }).click();
        await page.waitForFunction(previous => StatusCenter.snapshot().some(item =>
            !previous.includes(item.id) && /同步完成|智能合并完成|同步失败|本机数据已同步到云端/.test(item.message)), before);
        const notices = await page.evaluate(previous => StatusCenter.snapshot().filter(item => !previous.includes(item.id)), before);
        assert(!notices.some(item => item.source === '云同步' && item.type === 'error'), JSON.stringify(notices));
    }
    const read = (page, key) => page.evaluate(key => contracts[key] || null, key);
    async function deleteContract(page, key) {
        await page.getByTitle('AI 设置', { exact: true }).click();
        await page.locator('#tabContractSettings').click();
        page.once('dialog', dialog => dialog.accept());
        await page.locator('.cm-row[data-key="' + key + '"] .cm-delete-btn').click();
        await page.getByRole('button', { name: '关闭设置', exact: true }).click();
        assert.equal(await read(page, key), null);
    }
    try {
        const left = await openDevice();
        const right = await openDevice();
        const initial = named('Alpha', {
            '1.2': { ...clause('通知', '<p>旧正文</p>'), translation: '<p>简体</p>', translation_tc: '<p>繁體</p>' },
            '3': clause('旧附表', 'obsolete'),
        });
        await importTxt(left, '新合同导入', initial, /新增/);
        await importTxt(left, '新合同导入', named('Beta', { '1': clause('Other', 'other contract') }), /新增/);
        await tab(left, 'Alpha').click();
        const tags = [{ anchor: { kind: 'text', offset: 0, quote: '已编辑', prefix: '', suffix: '的正文' }, labels: ['风险点'] }];
        await left.evaluate(async tags => {
            const body = document.querySelector('[id="clause-1.2"] .clause-text');
            body.innerHTML = '<p><span class="note-span" data-note="审阅备注"><mark>已编辑</mark></span><b>的正文</b><br>下一行</p>';
            handleEditorMutation(body);
            updateClauseReviewTags('1.2', tags);
            await autoSave();
        }, tags);
        const plainText = await exportTxt(left, '导出为原文本');
        const annotatedText = await exportTxt(left, '导出为带批注文本');
        const plain = JSON.parse(plainText);
        const annotated = JSON.parse(annotatedText);
        assert.deepEqual(Object.keys(plain).sort(), ['$contract', '1.2', '3']);
        assert.equal(plain['1.2'].content, '<p>已编辑的正文<br>下一行</p>');
        assert.equal(plain['1.2'].reviewTags, undefined);
        assert.equal(plain['1.2'].translation_tc, '<p>繁體</p>');
        assert.match(annotated['1.2'].content, /审阅备注/);
        assert.match(annotated['1.2'].content, /<mark>已编辑<\/mark>/);
        assert.deepEqual(annotated['1.2'].reviewTags, tags);

        await importTxt(left, '新合同导入', annotatedText, /新增/);
        const duplicate = await read(left, 'Alpha (2)');
        assert.notEqual(duplicate.sourceId, annotated.$contract.sourceId);
        assert.equal(duplicate.title, 'Alpha');
        assert.deepEqual(duplicate.data['1.2'].reviewTags, tags);
        assert.match(duplicate.data['1.2'].content, /审阅备注/);
        await importTxt(left, '新合同导入', plainText, /新增/);
        assert.equal((await read(left, 'Alpha (3)')).data['1.2'].content, plain['1.2'].content);

        await importTxt(left, '覆盖合同导入', named('Alpha', { '9': clause('Ambiguous', 'different text') }), null);
        await status(left, '匹配到多份合同');
        await importTxt(left, '覆盖合同导入', named('Missing', { '9': clause('missing', 'unknown') }), null);
        await status(left, '找不到对应的已有合同');
        await sync(left);
        await sync(right);
        assert.equal((await read(right, 'Alpha (2)')).sourceId, duplicate.sourceId);

        const replacement = (meta, text, id = '1.2') => JSON.stringify({ $contract: meta, [id]: clause('New clause', text) });
        await importTxt(left, '覆盖合同导入', replacement(annotated.$contract, 'LEFT REPLACEMENT'), /整份覆盖「Alpha ·/);
        assert.deepEqual(Object.keys((await read(left, 'Alpha')).data), ['1.2']);
        await deleteContract(right, 'Beta');
        await right.reload();
        await right.evaluate(() => window.contractAppReady);
        await connectFirestore(right);
        await sync(right);
        await sync(left);
        assert.equal(await read(left, 'Beta'), null);
        assert.equal((await read(left, 'Alpha')).data['1.2'].content, 'LEFT REPLACEMENT');
        await sync(right);
        assert.equal((await read(right, 'Alpha')).data['1.2'].content, 'LEFT REPLACEMENT');
        assert.equal((await read(right, 'Alpha')).data['3'], undefined);
        assert.equal(await read(right, 'Beta'), null);

        const rightReplacement = replacement(annotated.$contract, 'RIGHT REPLACEMENT', '4');
        await importTxt(right, '覆盖合同导入', rightReplacement, /整份覆盖「Alpha ·/);
        await deleteContract(left, 'Alpha (3)');
        await sync(left);
        await sync(right);
        await sync(left);
        assert.equal((await read(left, 'Alpha')).data['4'].content, 'RIGHT REPLACEMENT');
        assert.equal((await read(left, 'Alpha')).data['1.2'], undefined);
        assert.equal(await read(right, 'Alpha (3)'), null);
        assert.equal(await read(left, 'Alpha (3)'), null);
        assert.equal((await read(left, 'Alpha (2)')).sourceId, duplicate.sourceId);

        await tab(left, 'Alpha').click();
        await left.evaluate(async () => {
            const body = document.querySelector('#clause-4 .clause-text');
            body.textContent = 'EDITED AFTER OVERWRITE';
            handleEditorMutation(body);
            await autoSave();
        });
        await sync(left);
        await sync(right);
        assert.equal((await read(right, 'Alpha')).data['4'].content, 'EDITED AFTER OVERWRITE');

        // A later edit wins against an earlier deletion of the same source.
        await deleteContract(left, 'Alpha');
        await tab(right, 'Alpha').click();
        await right.evaluate(async () => {
            const body = document.querySelector('#clause-4 .clause-text');
            body.textContent = 'NEWER THAN DELETION';
            handleEditorMutation(body);
            await autoSave();
        });
        await sync(left);
        await sync(right);
        await sync(left);
        assert.equal((await read(left, 'Alpha')).data['4'].content, 'NEWER THAN DELETION');

        // Two devices can submit independent changes at the same time.
        await importTxt(left, '新合同导入', named('Parallel', { '1': clause('One', 'left device') }), /新增/);
        await importTxt(right, '新合同导入', named('Parallel', { '1': clause('One', 'right device') }), /新增/);
        await Promise.all([sync(left), sync(right)]);
        await sync(left);
        await sync(right);
        for (const page of [left, right]) {
            const records = await page.evaluate(() => Object.values(contracts).filter(contract => contract.title === 'Parallel'));
            assert.deepEqual(records.map(contract => contract.data['1'].content).sort(), ['left device', 'right device']);
            assert.equal(new Set(records.map(contract => contract.sourceId)).size, 2);
        }
        assert.deepEqual(errors, []);
        console.log('Contract transfer browser tests passed (TXT round trips, duplicate imports, bidirectional replacements/deletions, later edits, and concurrent sync).');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
