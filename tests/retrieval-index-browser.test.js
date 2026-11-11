const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.GCM_PLAYWRIGHT_MODULE ||
    path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const root = path.join(__dirname, '..');
const origin = 'http://gcm-retrieval-test.localhost';
const config = { embeddingEndpoint: 'https://example.test/v1', embeddingModel: 'test-model', embeddingApiKey: 'test-key' };
const labels = ['ALPHA', 'BETA', 'GAMMA'];

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.GCM_BROWSER_EXECUTABLE ||
        'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) return route.abort();
            if (url.pathname === '/setup') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
            if (url.pathname === '/api/retrieval') return route.fulfill({ json: { data: [{ embedding: [1, 0] }] } });
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                return route.fulfill({ status: 404 });
            }
            return route.fulfill({ path: file });
        });
        const page = await context.newPage();
        await page.goto(origin + '/setup');
        for (const file of ['vendor/localforage.min.js', 'js/ai-retrieval.js', 'js/rag.js']) {
            await page.addScriptTag({ path: path.join(root, file) });
        }
        await page.evaluate(async ({ labels, config }) => {
            const contracts = Object.fromEntries(labels.map(label => [label, {
                sourceId: `source-${label}`,
                title: label,
                data: Object.fromEntries(Array.from({ length: label === 'ALPHA' ? 2 : 1 }, (_, i) => [String(i + 1), {
                    title: `${label} Payment ${i + 1}`, content: 'Payment must be made within thirty days.'
                }]))
            }]));
            await localforage.setItem('general_contract_db', JSON.stringify({ version: 2, contracts }));
            await new Promise((resolve, reject) => {
                const open = indexedDB.open('ContractVectorStore', 1);
                open.onerror = () => reject(open.error);
                open.onupgradeneeded = () => {
                    const store = open.result.createObjectStore('vectors', { keyPath: 'id' });
                    for (const row of AIRetrieval.rows(contracts)) {
                        store.put({
                            id: `${row.type}_${row.id}`, sourceId: row.sourceId, type: row.type, clauseId: row.id,
                            title: row.title, vector: [1, 0], dimension: 2, embeddingModel: config.embeddingModel,
                            embeddingSpace: RAG.embeddingSpace(config.embeddingEndpoint, config.embeddingModel),
                            sourceHash: row.sourceHash, titleHash: AIRetrieval.fingerprint(row.title),
                            schemaVersion: RAG.INDEX_SCHEMA_VERSION
                        });
                    }
                    store.put({ id: 'unverified', vector: [1, 0] });
                };
                open.onsuccess = () => { open.result.close(); resolve(); };
            });
        }, { labels, config });

        await page.addInitScript(() => {
            window.vectorReads = [];
            for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) {
                const getAll = prototype.getAll;
                prototype.getAll = function (...args) {
                    const request = getAll.apply(this, args);
                    if ((this.objectStore || this).name === 'vectors') {
                        const read = { index: this.objectStore ? this.name : null, key: args[0] ?? null };
                        window.vectorReads.push(read);
                        request.addEventListener('success', () => {
                            read.sourceIds = request.result.map(record => record.sourceId ?? null);
                        });
                    }
                    return request;
                };
            }
        });
        await page.goto(origin);
        await page.evaluate(() => window.contractAppReady);
        await page.evaluate(config => Object.assign(AI_CONFIG, config, { rerankEnabled: false }), config);
        assert.equal(await page.evaluate(() => RAG.db.version), 2);

        const settings = page.locator('#settingsModal');
        const openSettings = () => page.getByTitle('AI 设置', { exact: true }).click();
        const setSources = async enabled => {
            await openSettings();
            await page.locator('#tabRetrievalSettings').click();
            for (const label of labels) {
                await page.getByRole('checkbox', { name: `将 ${label} 加入检索范围` }).setChecked(enabled.includes(label));
            }
            await page.getByRole('button', { name: /保存设置/ }).click();
            await settings.waitFor({ state: 'hidden' });
        };
        const assertSearchReads = async enabled => {
            const result = await page.evaluate(async () => {
                window.vectorReads.length = 0;
                const evidence = await AIRetrieval.retrieve('When is payment due?', contracts, AI_CONFIG);
                return { reads: window.vectorReads, candidates: evidence.diagnostic.corpus.semanticCandidates };
            });
            const expected = enabled.map(label => ({
                index: 'sourceId', key: `source-${label}`, sourceIds: Array(label === 'ALPHA' ? 2 : 1).fill(`source-${label}`)
            }));
            assert.deepEqual(result.reads, expected);
            assert.equal(result.candidates, expected.reduce((count, read) => count + read.sourceIds.length, 0));
        };

        await setSources([]);
        await assertSearchReads([]);
        await setSources(['ALPHA']);
        await assertSearchReads(['ALPHA']);
        await setSources(['BETA']);
        await assertSearchReads(['BETA']);
        await setSources(['ALPHA', 'BETA']);
        await assertSearchReads(['ALPHA', 'BETA']);

        await openSettings();
        await page.evaluate(() => { window.vectorReads.length = 0; });
        await page.locator('#tabContractSettings').click();
        await page.getByRole('switch', { name: 'BETA 可见' }).click();
        for (const label of labels) {
            await page.locator(`.cm-row[data-key="${label}"] .cm-vector-status[data-state="ready"]`).waitFor();
        }
        const managementReads = await page.evaluate(() => window.vectorReads);
        assert(managementReads.length > 0);
        for (const read of managementReads) {
            assert.equal(read.index, null);
            assert.deepEqual(read.sourceIds, ['source-ALPHA', 'source-ALPHA', 'source-BETA', 'source-GAMMA', null]);
        }
        await page.getByRole('button', { name: '关闭设置' }).click();
        await assertSearchReads(['ALPHA']);
        console.log('Browser vector regressions passed (v1 migration, scoped IndexedDB reads, visibility, full coverage)');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
