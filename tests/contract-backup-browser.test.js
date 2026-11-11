const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { chromium } = require(process.env.GCM_PLAYWRIGHT_MODULE ||
    path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const root = path.join(__dirname, '..');
const origin = 'http://gcm-backup-test.localhost';
const config = { embeddingEndpoint: 'https://api.openai.com/v1', embeddingModel: 'mock-model', embeddingApiKey: 'mock-secret' };
const labels = ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON'];
const filename = '合同备份.gcm-backup.json.gz';
let embeddingCalls = 0;

async function openDevice(browser) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/api/retrieval') {
            embeddingCalls++;
            return route.fulfill({ json: { data: [{ embedding: [0.25, 0.75] }] } });
        }
        const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            return route.fulfill({ status: 404 });
        }
        return route.fulfill({ path: file });
    });
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(() => window.contractAppReady);
    return page;
}

async function openManagement(page) {
    await page.getByTitle('AI 设置', { exact: true }).click();
    await page.locator('#tabContractSettings').click();
}

async function chooseBackup(page, buffer) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '从备份恢复' }).click();
    await (await chooser).setFiles({ name: filename, mimeType: 'application/gzip', buffer });
}

async function waitForStatus(page, fragment) {
    await page.waitForFunction(text => StatusCenter.snapshot().some(entry => entry.message.includes(text)), fragment);
}

async function readState(page) {
    return page.evaluate(async () => ({
        snapshot: JSON.parse(await localforage.getItem(CONTRACTS_DB_KEY)),
        vectors: await RAG.readRecords()
    }));
}

(async () => {
    const executablePath = [
        process.env.GCM_BROWSER_EXECUTABLE,
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        chromium.executablePath()
    ].find(file => file && fs.existsSync(file));
    const browser = await chromium.launch({ headless: true, executablePath });
    try {
        const source = await openDevice(browser);
        for (const label of labels) {
            const json = JSON.stringify({ '1': {
                title: label + ' clause', content: label + ' original text', translation: label + ' 译文'
            } });
            await source.locator('#importContractFile').setInputFiles({
                name: label + '.txt', mimeType: 'text/plain',
                buffer: Buffer.from('CONTRACT_META:\nname: ' + label + ' contract\nshortName: ' + label + '\n---\n' + json)
            });
            await source.getByRole('button', { name: '确定', exact: true }).click();
            await source.locator('#contract-tabs [data-key="' + label + '"]').waitFor();
        }
        for (const label of ['ALPHA', 'BETA']) {
            await source.locator('#contract-tabs [data-key="' + label + '"]').click();
            await source.evaluate(async label => {
                const clause = document.querySelector('#clause-1 .clause-text');
                clause.innerHTML = '<strong style="font-size: 18px; color: rgb(0, 100, 160);"><span class="note-span" data-note="'
                    + label + ' 备注">' + label + ' edited text</span></strong>';
                handleEditorMutation(clause);
                savedBookmarks[0].label = label + ' 自定义书签';
                await autoSave();
            }, label);
        }
        const built = await source.evaluate(async config => {
            Object.assign(AI_CONFIG, config);
            const data = { ALPHA: contracts.ALPHA, BETA: contracts.BETA, GAMMA: contracts.GAMMA, DELTA: contracts.DELTA };
            const result = await RAG.buildIndex(data, config, null, { allContracts: true });
            await setContractVisibility('BETA', false);
            moveContract('BETA', 'ALPHA', false);
            contracts.DELTA.data['1'].content = 'DELTA changed after embedding';
            await saveContractsToStorage();
            return result;
        }, config);
        assert.equal(built.count, 4);

        await source.evaluate(() => {
            Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async options => {
                window.pickerRequest = { filename: options.suggestedName, activation: navigator.userActivation.isActive };
                const directory = await navigator.storage.getDirectory();
                return directory.getFileHandle('chosen-backup.gz', { create: true });
            } });
        });
        await openManagement(source);
        await source.getByRole('button', { name: '备份全部合同' }).click();
        await waitForStatus(source, '已保存备份');
        const saved = await source.evaluate(async () => {
            const directory = await navigator.storage.getDirectory();
            const file = await (await directory.getFileHandle('chosen-backup.gz')).getFile();
            return { picker: window.pickerRequest, bytes: [...new Uint8Array(await file.arrayBuffer())] };
        });
        assert.equal(saved.picker.activation, true);
        assert.match(saved.picker.filename, /\.gcm-backup\.json\.gz$/);
        const buffer = Buffer.from(saved.bytes);
        const backup = JSON.parse(gunzipSync(buffer));
        assert.equal(Object.keys(backup.contracts).length, 5);
        assert.equal(backup.vectors.length, 3);
        assert.equal(backup.contracts.ALPHA.data['1'].originalContent, 'ALPHA original text');
        assert.match(backup.contracts.ALPHA.data['1'].content, /data-note="ALPHA 备注"/);
        assert.equal(backup.sourceOrder[0], backup.contracts.BETA.sourceId);
        assert.equal(backup.contracts.BETA.visibility.hidden, true);
        assert.ok(!JSON.stringify(backup).includes(config.embeddingApiKey));

        await source.evaluate(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined }));
        const download = source.waitForEvent('download');
        await source.getByRole('button', { name: '备份全部合同' }).click();
        const downloaded = await download;
        assert.match(downloaded.suggestedFilename(), /\.gcm-backup\.json\.gz$/);
        const fallback = JSON.parse(gunzipSync(fs.readFileSync(await downloaded.path())));
        assert.deepEqual(fallback.contracts, backup.contracts);
        assert.deepEqual(fallback.vectors, backup.vectors);

        const target = await openDevice(browser);
        await openManagement(target);
        assert.ok(await target.getByRole('button', { name: '备份全部合同' }).isDisabled());
        await chooseBackup(target, buffer);
        const preview = target.getByRole('dialog', { name: '恢复合同备份' });
        await preview.waitFor();
        const summary = await preview.locator('#contractRestoreSummary').innerText();
        assert.match(summary, /5 份合同、5 条条款和 3 条匹配向量/);
        assert.match(summary, /2 条可检索条款需要向量化/);
        await preview.getByRole('button', { name: '取消', exact: true }).click();
        assert.deepEqual(await readState(target), { snapshot: null, vectors: [] });
        await chooseBackup(target, Buffer.from('invalid gzip'));
        await waitForStatus(target, '无法读取压缩文件');
        assert.deepEqual(await readState(target), { snapshot: null, vectors: [] });

        await chooseBackup(target, buffer);
        await preview.getByRole('button', { name: '恢复', exact: true }).click();
        await waitForStatus(target, '已恢复 5 份合同、3 条向量');
        await target.reload();
        await target.evaluate(() => window.contractAppReady);
        const restored = await readState(target);
        assert.equal(Object.keys(restored.snapshot.contracts).length, 5);
        assert.deepEqual(restored.snapshot.contractOrder.sourceIds, backup.sourceOrder);
        assert.deepEqual(restored.vectors.sort((a, b) => a.id.localeCompare(b.id)),
            backup.vectors.sort((a, b) => a.id.localeCompare(b.id)));
        assert.equal(await target.locator('#contract-tabs [data-key="BETA"]').count(), 0);
        await target.locator('#contract-tabs [data-key="ALPHA"]').click();
        assert.equal(await target.locator('#clause-1 .note-span').getAttribute('data-note'), 'ALPHA 备注');
        assert.match(await target.locator('#clause-1 strong').getAttribute('style'), /font-size: 18px/);
        assert.equal(await target.locator('#navList .label-text').first().innerText(), 'ALPHA 自定义书签');
        assert.equal(await target.evaluate(() => getOriginalClause('ALPHA', '1').content), 'ALPHA original text');
        const valid = await target.evaluate(async config => {
            Object.assign(AI_CONFIG, config);
            return (await RAG.getIndexStatus(config, contracts, { allContracts: true })).valid;
        }, config);
        assert.equal(valid, 3);
        assert.equal(embeddingCalls, 4, 'restoring must not regenerate embeddings');

        await target.evaluate(async () => {
            const body = document.querySelector('#clause-1 .clause-text');
            body.textContent = 'New local edit';
            handleEditorMutation(body);
            await autoSave();
        });
        await openManagement(target);
        await chooseBackup(target, buffer);
        await preview.waitFor();
        assert.equal(await preview.getByRole('checkbox', { checked: false }).count(), 5);
        await preview.getByRole('button', { name: '恢复', exact: true }).click();
        await waitForStatus(target, '已保留所有现有合同');
        assert.equal((await readState(target)).snapshot.contracts.ALPHA.data['1'].content, 'New local edit');

        await target.evaluate(() => {
            window.originalVectorWriter = RAG.replaceSourceRecords;
            RAG.replaceSourceRecords = async () => { throw new Error('模拟向量写入失败'); };
        });
        await chooseBackup(target, buffer);
        await preview.getByRole('checkbox', { name: /ALPHA/ }).check();
        await preview.getByRole('button', { name: '恢复', exact: true }).click();
        await waitForStatus(target, '模拟向量写入失败');
        assert.equal((await readState(target)).snapshot.contracts.ALPHA.data['1'].content, 'New local edit');
        await target.evaluate(() => { RAG.replaceSourceRecords = window.originalVectorWriter; });
        await chooseBackup(target, buffer);
        await preview.getByRole('checkbox', { name: /ALPHA/ }).check();
        await preview.getByRole('button', { name: '恢复', exact: true }).click();
        await waitForStatus(target, '已恢复 1 份合同、1 条向量');
        assert.equal((await readState(target)).snapshot.contracts.ALPHA.data['1'].content, restored.snapshot.contracts.ALPHA.data['1'].content);
        assert.equal(embeddingCalls, 4);
        console.log('Contract backup browser tests passed (five contracts, save picker, gzip download, fresh-device restore, conflict handling, and rollback).');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
