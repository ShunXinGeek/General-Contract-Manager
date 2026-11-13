const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.GCM_PLAYWRIGHT_MODULE ||
    path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const root = path.join(__dirname, '..');
const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript' };
    try {
        const bytes = await fs.readFile(file);
        response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(bytes);
    } catch {
        response.writeHead(404).end();
    }
});

// In-memory Firestore API. The app still runs the real upload, download, and merge code.
function connectTestFirestore(entries) {
    const docs = new Map(entries);
    const snapshot = ref => ({ ref, id: ref.id, exists: docs.has(ref.key), data: () => structuredClone(docs.get(ref.key)) });
    const doc = key => ({ key, id: key.split('/').at(-1), collection: name => collection(`${key}/${name}`),
        get: async () => snapshot(doc(key)) });
    const collection = key => ({ doc: id => doc(`${key}/${id}`), get: async () => {
        const children = [...docs.keys()].filter(item => item.startsWith(`${key}/`) && !item.slice(key.length + 1).includes('/'));
        const results = children.map(item => snapshot(doc(item)));
        return { docs: results, forEach: callback => results.forEach(callback) };
    } });
    db = {
        collection,
        batch() {
            const operations = [];
            return {
                set(ref, data, options) {
                    const copy = structuredClone(data);
                    operations.push(() => docs.set(ref.key, options?.merge || options?.mergeFields ? { ...docs.get(ref.key), ...copy } : copy));
                },
                delete(ref) { operations.push(() => docs.delete(ref.key)); },
                async commit() { operations.forEach(apply => apply()); }
            };
        },
        async runTransaction(action) {
            const batch = this.batch();
            const result = await action({ ...batch, get: ref => ref.get() });
            await batch.commit();
            return result;
        }
    };
    currentUser = { uid: 'contract-edit-test', email: 'contract-edit@example.test' };
    initialized = true;
    window.testFirestore = docs;
}

async function run() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, executablePath: process.env.GCM_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
        const origin = `http://127.0.0.1:${server.address().port}/`;
        const errors = [];
        async function openBrowserProfile() {
            const context = await browser.newContext({ serviceWorkers: 'block' });
            await context.route('https://**/*', route => route.abort());
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(origin);
            await page.evaluate(() => window.contractAppReady);
            return page;
        }

        const page = await openBrowserProfile();
        const tab = key => page.locator(`#contract-tabs [data-key="${key}"]`);
        const toggle = page.locator('#btnEditMode');
        const english = page.locator('#clause-1 .clause-text');
        const heading = page.locator('#clause-1 h2');
        const translation = page.locator('#refContent .translation-text');
        const confirm = () => page.getByRole('button', { name: '确定', exact: true }).click();
        const variant = () => page.locator('#btnLangToggle').click();
        const assertMode = async editable => {
            assert.equal(await toggle.getAttribute('aria-pressed'), String(editable));
            assert.equal(await english.evaluate(body => body.isContentEditable), editable);
            assert.equal(await translation.evaluate(body => body.isContentEditable), editable);
        };

        assert.equal(await toggle.isDisabled(), true);
        for (const key of ['A', 'B', 'C']) {
            const data = { '1': { title: `${key} clause`, content: `${key} English`, translation: `${key} 简体原译文`,
                translation_tc: key === 'C' ? '' : `${key} 繁體原譯文` } };
            await page.locator('#importContractFile').setInputFiles({ name: `${key}.txt`, mimeType: 'text/plain',
                buffer: Buffer.from(JSON.stringify(data)) });
            for (const name of [key, `${key} contract`]) {
                await page.locator('.custom-dialog-content input').fill(name);
                await confirm();
            }
            await confirm();
            await tab(key).waitFor();
        }
        await tab('A').click();
        await heading.click();
        await toggle.click();
        await assertMode(true);
        await page.evaluate(() => showCrossContractRef('B', '1'));
        assert.match(await page.locator('#refContent').innerText(), /B 简体原译文/);
        assert.equal(await page.locator('#refContent [contenteditable="true"]').count(), 0);
        await heading.click();
        await english.fill('A revised English');
        await translation.fill('A 修改后的简体译文');
        await variant();
        assert.equal(await translation.innerText(), 'A 繁體原譯文');
        await translation.fill('A 修訂後的繁體譯文');

        for (const key of ['B', 'C']) {
            await tab(key).click();
            await heading.click();
            await assertMode(false);
            await english.click();
            await page.keyboard.insertText('should not be inserted');
            await translation.click();
            await page.keyboard.insertText('should not be inserted');
            assert.equal(await english.innerText(), `${key} English`);
            assert.equal(await translation.innerText(), `${key} 简体原译文`);
        }
        await tab('A').click();
        await heading.click();
        await assertMode(true);
        assert.equal(await translation.innerText(), 'A 修訂後的繁體譯文');
        await page.locator('#tab-Assistant').click();
        assert.equal(await toggle.isDisabled(), true);
        await tab('A').click();
        await assertMode(true);
        await page.locator('#btnSync').click();
        await variant();
        await translation.fill('A 同步视图修改的简体译文');
        await translation.press('Control+z');
        assert.equal(await translation.innerText(), 'A 修改后的简体译文');
        await translation.fill('A 同步视图修改的简体译文');
        await translation.press('Control+s');
        await page.waitForFunction(() => !hasUnsavedChanges);
        await tab('Welcome').click();
        assert.equal(await toggle.isDisabled(), true);
        await tab('A').click();
        await assertMode(true);
        assert.equal(await translation.innerText(), 'A 同步视图修改的简体译文');
        await toggle.click();
        await assertMode(false);

        await tab('C').click();
        await heading.click();
        await toggle.click();
        await variant();
        assert.equal(await translation.innerText(), 'C 简体原译文');
        await translation.fill('C 新增的繁體譯文');
        await tab('B').click();
        await heading.click();
        await assertMode(false);
        await tab('C').click();
        await heading.click();
        await assertMode(true);
        await tab('Welcome').click();
        await page.waitForFunction(() => !hasUnsavedChanges);
        await page.reload();
        await page.evaluate(() => window.contractAppReady);

        await tab('A').click();
        await heading.click();
        await assertMode(false);
        assert.equal(await english.innerText(), 'A revised English');
        assert.equal(await translation.innerText(), 'A 同步视图修改的简体译文');
        await variant();
        assert.equal(await translation.innerText(), 'A 修訂後的繁體譯文');
        await tab('C').click();
        await heading.click();
        await variant();
        assert.equal(await translation.innerText(), 'C 新增的繁體譯文');
        await toggle.click();
        await translation.fill('');
        await toggle.click();
        await tab('A').click();
        await heading.click();

        await page.evaluate(connectTestFirestore, []);
        await page.locator('#btnCloudBackup').click();
        await page.getByRole('button', { name: /上传云端数据/ }).click();
        await confirm();
        await page.waitForFunction(() => StatusCenter.snapshot().some(item => item.message === '本地数据已上传到云端'));
        const entries = await page.evaluate(() => [...window.testFirestore]);
        const cloudClause = key => entries.find(([, value]) => value.contract_key === key && value.data)[1].data['1'];
        assert.equal(cloudClause('A').content, 'A revised English');
        assert.equal(cloudClause('A').translation, 'A 同步视图修改的简体译文');
        assert.equal(cloudClause('A').translation_tc, 'A 修訂後的繁體譯文');
        assert.equal(cloudClause('B').translation, 'B 简体原译文');
        assert.equal(cloudClause('C').translation_tc, '');
        assert.ok(cloudClause('C').translationModifiedAt.translation_tc > 0);

        const fresh = await openBrowserProfile();
        await fresh.evaluate(connectTestFirestore, entries);
        await fresh.locator('#btnCloudBackup').click();
        await fresh.getByRole('button', { name: /下载云端数据/ }).click();
        await fresh.getByRole('button', { name: '确定', exact: true }).click();
        await fresh.waitForFunction(() => StatusCenter.snapshot().some(item => item.message === '云端数据已下载到本地'));
        await fresh.locator('#clause-1 h2').click();
        assert.equal(await fresh.locator('#clause-1 .clause-text').innerText(), 'A revised English');
        assert.equal(await fresh.locator('#refContent .translation-text').innerText(), 'A 同步视图修改的简体译文');
        await fresh.locator('#btnLangToggle').click();
        assert.equal(await fresh.locator('#refContent .translation-text').innerText(), 'A 修訂後的繁體譯文');
        await fresh.locator('#contract-tabs [data-key="C"]').click();
        await fresh.locator('#clause-1 h2').click();
        assert.equal(await fresh.locator('#refContent .translation-text').innerText(), 'C 简体原译文');
        await fresh.locator('#btnLangToggle').click();
        assert.equal(await fresh.locator('#refContent .translation-text').innerText(), '');

        await toggle.click();
        await translation.fill('A 本機同步前更新的繁體譯文');
        await page.evaluate(() => {
            const cloudDoc = [...window.testFirestore.values()].find(value => value.contract_key === 'A' && value.data);
            cloudDoc.data['1'].translation = 'A 云端更新的简体译文';
            cloudDoc.data['1'].translationModifiedAt.translation += 1000;
        });
        await page.locator('#btnCloudBackup').click();
        await page.getByRole('button', { name: /智能合并同步/ }).click();
        await page.waitForFunction(() => StatusCenter.snapshot().some(item => item.message.includes('智能合并完成')));
        assert.equal(await english.innerText(), 'A revised English');
        assert.equal(await translation.innerText(), 'A 本機同步前更新的繁體譯文');
        await variant();
        assert.equal(await translation.innerText(), 'A 云端更新的简体译文');
        await assertMode(true);
        assert.deepEqual(errors, []);
        console.log('Contract editor browser tests passed (independent tabs, bilingual editing, reload, cloud upload/download and merge).');
    } finally {
        await browser?.close();
        server.close();
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
