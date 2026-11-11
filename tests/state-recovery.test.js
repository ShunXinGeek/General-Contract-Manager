const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

function createAppContext(storage = new Map(), database = new Map()) {
    const context = {
        Blob, URL, AbortController, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval, confirm: () => true,
        console: { log() {}, info() {}, warn() {}, error() {} },
        navigator: { onLine: true },
        document: { addEventListener() {}, getElementById() { return null; },
            querySelectorAll() { return []; }, querySelector() { return null; } },
        localStorage: { getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
        localforage: { getItem: async key => database.get(key), setItem: async (key, value) => database.set(key, value) },
        Logger: { info() {}, error() {} },
        obfuscateKey: value => value ? Buffer.from(value).toString('base64').split('').reverse().join('') : '',
        deobfuscateKey: value => value ? Buffer.from(value.split('').reverse().join(''), 'base64').toString() : '',
        sanitizeHtml: value => value, escapeHtml: value => value, showError() {}, showSuccess() {},
        CustomDialog: { confirm: async () => true, alert: async () => {}, prompt: async () => null }
    };
    context.window = context;
    vm.createContext(context);
    for (const file of ['config', 'ai-providers', 'comparison', 'app', 'retrieval-settings', 'ai-settings', 'editor', 'import', 'cloud-storage']) {
        vm.runInContext(fs.readFileSync(path.join(root, 'js', `${file}.js`), 'utf8'), context, { filename: `${file}.js` });
    }
    // DOM interactions are tested separately in a real browser. Keep persistence/merge code real here.
    vm.runInContext(`
        renderTabs = function () {};
        renderMainDocument = function () {};
        initBookmarks = function () {};
        buildReverseIndex = function () {};
        switchContract = function (key) {
            activeContractKey = key; fullClauseDatabase = contracts[key].data;
            savedBookmarks = contracts[key].bookmarks;
        };
        showWelcomePage = function () { activeContractKey = null; fullClauseDatabase = {}; };
        applyTheme = function () {};
    `, context);
    return context;
}

const evaluate = (context, code) => vm.runInContext(code, context);
const json = (context, code) => JSON.parse(evaluate(context, `JSON.stringify(${code})`));

async function run() {
    const storage = new Map(), database = new Map();
    const app = createAppContext(storage, database);
    evaluate(app, `registerContract('TEST', 'Test', { '1': { title: 'One', content: 'original' } });`);
    const originalSourceId = evaluate(app, `contracts.TEST.sourceId`);
    assert.match(originalSourceId, /^src_/, 'new contracts receive a stable retrieval source id');
    assert.strictEqual(evaluate(app, 'RetrievalSettings.summary(contracts).enabled'), 0, 'new contracts are listed but excluded until checked');
    evaluate(app, `
        const retrieval = RetrievalSettings.get(contracts);
        retrieval.sources[contracts.TEST.sourceId].authorityLevel = 2;
        retrieval.sources[contracts.TEST.sourceId].role = 'base';
        retrieval.sources[contracts.TEST.sourceId].enabled = true;
        RetrievalSettings.persist(retrieval, contracts, true);
        registerContract('TEST', 'Test', { '1': { title: 'One', content: 'original' } });
    `);
    assert.strictEqual(evaluate(app, 'RetrievalSettings.summary(contracts).enabled'), 1, 'reimport must preserve the checked state');
    assert.strictEqual(evaluate(app, `checkClauseModified('1')`), false);
    evaluate(app, `fullClauseDatabase['1'].content = 'edited'; fullClauseDatabase['1'].modifiedAt = 10;`);
    assert.strictEqual(evaluate(app, `checkClauseModified('1')`), true, 'nested baseline must detect edits');
    await evaluate(app, 'autoSave()');
    const refreshed = createAppContext(storage, database);
    await evaluate(refreshed, 'loadContractsFromStorage()');
    assert.strictEqual(evaluate(refreshed, `contracts.TEST.sourceId`), originalSourceId, 'source id survives local reload');
    assert.strictEqual(evaluate(refreshed, `RetrievalSettings.get(contracts).sources[contracts.TEST.sourceId].authorityLevel`), 2);
    assert.strictEqual(evaluate(refreshed, 'activeContractKey'), null, 'reload must open the welcome page');
    evaluate(refreshed, `switchContract('TEST')`);
    assert.strictEqual(evaluate(refreshed, `fullClauseDatabase['1'].content`), 'edited');
    assert.strictEqual(evaluate(refreshed, `getOriginalClause('TEST', '1').content`), 'original');
    assert.strictEqual(evaluate(refreshed, `checkClauseModified('1')`), true, 'baseline survives refresh');

    const cloudContract = json(refreshed, 'collectAllContractData()');
    assert.strictEqual(cloudContract.TEST.data['1'].originalContent, 'original', 'cloud snapshot includes baseline');
    assert.strictEqual(cloudContract.TEST.sourceId, originalSourceId, 'cloud snapshot preserves the stable source id');
    const retrievalCloud = json(refreshed, 'RetrievalSettings.getForCloud(contracts)');
    const batchWrites = [];
    app.testBatch = { set: (ref, data) => batchWrites.push({ ref, data }) };
    const ref = key => ({ key, collection: name => ({ doc: id => ref(`${key}/${name}/${id}`) }) });
    app.testMainRef = ref('user');
    app.largeData = { data: { '1': { content: 'x'.repeat(300000), originalContent: 'o'.repeat(300000) },
        '2': { content: 'y'.repeat(300000), originalContent: 'p'.repeat(300000) } }, visibility: { hidden: true, modifiedAt: 50 } };
    evaluate(app, `writeContractDataWithBatching(testMainRef, 'LARGE', largeData, 'test-time', testBatch)`);
    assert.strictEqual(batchWrites[0].data.batch_count, 2);
    assert.deepStrictEqual(batchWrites[0].data.visibility, app.largeData.visibility, 'batch metadata retains contract visibility');
    assert.strictEqual(batchWrites[1].data.data['1'].originalContent.length, 300000, 'batch writes retain baseline');
    assert.strictEqual(batchWrites[2].data.data['2'].originalContent.length, 300000);
    const newDevice = createAppContext();
    newDevice.snapshot = { contract_data: cloudContract, active_contract_key: 'TEST', bookmarks: {}, modifications: {}, retrieval_settings: retrievalCloud };
    await evaluate(newDevice, 'applyCloudDataToLocal(snapshot)');
    assert.strictEqual(evaluate(newDevice, `getOriginalClause('TEST', '1').content`), 'original');
    assert.strictEqual(evaluate(newDevice, `contracts.TEST.sourceId`), originalSourceId);
    assert.strictEqual(evaluate(newDevice, `RetrievalSettings.get(contracts).sources[contracts.TEST.sourceId].authorityLevel`), 2, 'retrieval settings survive cloud restore');
    assert.strictEqual(evaluate(newDevice, `checkClauseModified('1')`), true, 'new device preserves baseline');
    await evaluate(newDevice, `revertToOriginal('1')`);
    assert.strictEqual(evaluate(newDevice, `fullClauseDatabase['1'].content`), 'original');
    assert.strictEqual(evaluate(newDevice, `checkClauseModified('1')`), false);
    assert.ok(evaluate(newDevice, `fullClauseDatabase['1'].modifiedAt`) > 10, 'revert must synchronize as a newer edit');

    const displaySettings = createAppContext();
    displaySettings.snapshot = {
        active_contract_key: 'TEST',
        contract_data: {
            TEST: { ...cloudContract.TEST, visibility: { hidden: true, modifiedAt: 50 } },
            OTHER: { title: 'Other', sourceId: 'other', data: { '1': { content: 'other' } } }
        },
        contract_order: { sourceIds: ['other', originalSourceId], modifiedAt: 25 }
    };
    await evaluate(displaySettings, 'applyCloudDataToLocal(snapshot)');
    assert.deepStrictEqual(json(displaySettings, 'getOrderedContractKeys()'), ['OTHER', 'TEST']);
    assert.deepStrictEqual(json(displaySettings, 'getOrderedContractKeys({ visibleOnly: true })'), ['OTHER']);
    assert.strictEqual(evaluate(displaySettings, 'activeContractKey'), null, 'a hidden active contract restores to the welcome page');
    assert.deepStrictEqual(json(displaySettings, 'collectAllContractData().TEST.visibility'), { hidden: true, modifiedAt: 50 });
    evaluate(displaySettings, `registerContract('TEST', 'Reimported', { '1': { title: 'One', content: 'updated' } });`);
    assert.strictEqual(evaluate(displaySettings, `isContractVisible('TEST')`), false, 'reimport must preserve visibility');
    evaluate(displaySettings, `hydrateMissingCloudContracts({ contract_data: { TEST: { visibility: { hidden: false, modifiedAt: 49 } } } });`);
    assert.strictEqual(evaluate(displaySettings, `isContractVisible('TEST')`), false, 'an older visibility change must be ignored');
    evaluate(displaySettings, `hydrateMissingCloudContracts({ contract_data: { TEST: { visibility: { hidden: false, modifiedAt: 51 } } } });`);
    assert.deepStrictEqual(json(displaySettings, 'getOrderedContractKeys({ visibleOnly: true })'), ['OTHER', 'TEST']);

    const legacyDatabase = new Map([['general_contract_db', JSON.stringify({ OLD: {
        title: 'Old', data: { '1': { title: 'One', content: 'only surviving text' } }, bookmarks: []
    } })]]);
    const legacy = createAppContext(new Map(), legacyDatabase);
    await evaluate(legacy, 'loadContractsFromStorage()');
    assert.strictEqual(evaluate(legacy, 'RetrievalSettings.summary(contracts).enabled'), 1, 'upgrade must preserve the legacy default scope');
    assert.strictEqual(evaluate(legacy, `contracts.OLD.data['1'].originalContent`), 'only surviving text');
    await evaluate(legacy, 'saveContractsToStorage()');
    const migrated = createAppContext(new Map(), legacyDatabase);
    await evaluate(migrated, 'loadContractsFromStorage()');
    assert.strictEqual(evaluate(migrated, `getOriginalClause('OLD', '1').content`), 'only surviving text');
    migrated.trueBaselineSnapshot = { contract_data: { OLD: { data: { '1': {
        title: 'One', content: 'only surviving text', originalContent: '', originalBaselineMigrated: false
    } } } } };
    evaluate(migrated, 'hydrateMissingCloudContracts(trueBaselineSnapshot)');
    assert.strictEqual(evaluate(migrated, `getOriginalClause('OLD', '1').content`), '', 'real cloud baseline supersedes migration fallback, even if empty');

    const nonAIOnly = createAppContext();
    evaluate(nonAIOnly, `
        const settingsInputs = {};
        const fields = ['EmbeddingEndpoint', 'EmbeddingApiKey', 'EmbeddingModel', 'RerankEndpoint', 'RerankApiKey', 'RerankModel', 'SystemPrompt'];
        fields.forEach(field => { const key = field[0].toLowerCase() + field.slice(1); settingsInputs['setting' + field] = { value: AI_CONFIG[key] }; });
        settingsInputs.settingRerankEnabled = { checked: false };
        document.getElementById = id => settingsInputs[id];
        showSettingsStatus = function () {};
        setTimeout = function () {};
    `);
    await evaluate(nonAIOnly, 'saveAISettings()');
    assert.strictEqual(evaluate(nonAIOnly, 'getAISettingsForCloud().modifiedAt'), 0, 'retrieval-only save cannot mark blank AI configuration newer');

    app.sample = fs.readFileSync(path.join(root, 'sample', 'SAMPLE_CONTRACT.txt'), 'utf8');
    const parsed = json(app, 'parseContractText(sample)');
    assert.strictEqual(Object.keys(parsed).length, 5);
    assert.ok(parsed['1'].content.includes('"Employer" means'), 'escaped quotes must not truncate imported text');
    assert.ok(parsed['1'].content.includes('temporary works required by the Contract.'));
    app.multiline = '"1": { "title": "Multiline", "content": "line one\nline two" }';
    assert.strictEqual(json(app, 'parseContractText(multiline)')['1'].content, 'line one\nline two', 'keep permissive legacy multiline format');
    app.backtick = '"1": { "title": "Backtick", "content": `line one\nline two` }';
    assert.strictEqual(json(app, 'parseContractText(backtick)')['1'].content, 'line one\nline two');
    app.jsonSource = JSON.stringify({ '1': { title: 'JSON', content: 'body', translation: '译文' } });
    assert.strictEqual(json(app, 'parseContractText(jsonSource)')['1'].translation, '译文');

    const aiSnapshot = {
        version: 2, modifiedAt: 200, models: [
            { id: 'm1', name: 'First', endpoint: 'https://example.invalid/chat', apiKey: 'test-key-one', model: 'one' },
            { id: 'm2', name: 'Second', endpoint: 'https://example.invalid/chat', apiKey: 'test-key-two', model: 'two' }
        ], selectedModelId: 'm2', apiEndpoint: 'https://example.invalid/chat', apiKey: 'test-key-two', model: 'two',
        embeddingEndpoint: 'https://example.invalid/embed', embeddingApiKey: 'test-embedding-key', embeddingModel: 'embed',
        rerankEnabled: true, rerankEndpoint: 'https://example.invalid/rerank', rerankApiKey: 'test-rerank-key', rerankModel: 'rank',
        systemPrompt: 'test prompt'
    };
    const freshStorage = new Map(), freshDatabase = new Map();
    const fresh = createAppContext(freshStorage, freshDatabase);
    fresh.aiSnapshot = aiSnapshot;
    fresh.retrievalCloud = { ...retrievalCloud, version: 1, newSourcePolicy: 'enabled' };
    fresh.cloudContract = cloudContract;
    assert.strictEqual(evaluate(fresh, `mergeAISettings(getAISettingsForCloud(), aiSnapshot).apiKey`), 'test-key-two');
    evaluate(fresh, `
        initialized = true; currentUser = { uid: 'test-user' };
        registerContract('LOCAL', 'New local source', { '1': { content: 'local text' } });
        loadFromCloud = async function () { return { contract_data: cloudContract, bookmarks: {}, modifications: {}, ai_settings: aiSnapshot, retrieval_settings: retrievalCloud }; };
        saveToCloud = async function () { window.uploaded = getAISettingsForCloud(); return { success: true }; };
    `);
    assert.strictEqual((await evaluate(fresh, 'syncWithCloud()')).success, true);
    assert.deepStrictEqual(json(fresh, 'RetrievalSettings.summary(contracts).labels'), ['TEST'], 'merge must restore the checked cloud source and keep the new local source unchecked');
    assert.deepStrictEqual(json(fresh, 'uploaded.models.map(m => ({ id: m.id, name: m.name, endpoint: m.endpoint, apiKey: m.apiKey, model: m.model }))'), aiSnapshot.models, 'fresh device cannot upload an empty model list');
    assert.strictEqual(evaluate(fresh, 'uploaded.selectedModelId'), 'm2');
    assert.strictEqual(evaluate(fresh, 'AI_CONFIG.embeddingApiKey'), 'test-embedding-key');
    assert.strictEqual(evaluate(fresh, 'AI_CONFIG.rerankApiKey'), 'test-rerank-key');
    assert.notStrictEqual(freshStorage.get('ai_api_key'), 'test-key-two', 'local keys remain obfuscated');
    const aiReloaded = createAppContext(freshStorage, freshDatabase);
    evaluate(aiReloaded, 'loadAISettings(); initModelSelector();');
    const reloadedSnapshot = json(aiReloaded, 'getAISettingsForCloud()');
    assert.strictEqual(reloadedSnapshot.version, 3, 'legacy cloud settings migrate to v3 on next save');
    assert.deepStrictEqual(reloadedSnapshot.models.map(m => ({ id: m.id, name: m.name, endpoint: m.endpoint, apiKey: m.apiKey, model: m.model })), aiSnapshot.models, 'all AI settings survive reload');
    assert.strictEqual(reloadedSnapshot.selectedModelId, 'm2');

    fresh.localNewer = { ...aiSnapshot, modifiedAt: 300, apiKey: 'local-key' };
    assert.strictEqual(evaluate(fresh, 'mergeAISettings(localNewer, aiSnapshot).apiKey'), 'local-key');
    assert.strictEqual(evaluate(fresh, 'mergeAISettings(aiSnapshot, localNewer).apiKey'), 'local-key');
    fresh.deliberatelyDeleted = { version: 2, models: [], modifiedAt: 400, apiKey: '', model: '', apiEndpoint: '' };
    assert.strictEqual(evaluate(fresh, 'mergeAISettings(deliberatelyDeleted, aiSnapshot).modifiedAt'), 400);
    fresh.legacyAI = { apiEndpoint: 'https://example.invalid/old', apiKey: 'test-legacy-key', model: 'legacy' };
    evaluate(fresh, 'applyCloudAISettings(legacyAI);');
    assert.strictEqual(evaluate(fresh, 'AI_CHAT_MODELS[0].apiKey'), 'test-legacy-key');
    assert.strictEqual(evaluate(fresh, 'currentSelectedModelId'), 'legacy_cloud_model');
    evaluate(fresh, `deleteModel('legacy_cloud_model');`);
    assert.strictEqual(evaluate(fresh, 'AI_CONFIG.apiKey'), '');
    assert.strictEqual(evaluate(fresh, 'currentSelectedModelId'), null);
    assert.strictEqual(freshStorage.has('ai_selected_model_id'), false);

    console.log('state recovery regression tests passed (baseline, import, cloud AI/retrieval sync, reload, merge, deletion)');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
