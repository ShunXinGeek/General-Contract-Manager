const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function createBaseContext() {
    const storage = new Map();
    const context = {
        Blob,
        clearInterval,
        clearTimeout,
        console: { log() {}, info() {}, warn() {}, error() {} },
        document: {
            addEventListener() {},
            createTextNode(text) { return { textContent: text }; },
            getElementById() { return null; },
            querySelectorAll() { return []; }
        },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); }
        },
        navigator: { onLine: true },
        setInterval,
        setTimeout
    };
    context.window = context;
    context.Logger = { info() {}, error() {} };
    vm.createContext(context);
    return context;
}

function loadEditorContext() {
    const context = createBaseContext();
    vm.runInContext(`
        let contracts = { GCC: { title: 'GCC', data: { '1': { title: 'One', content: 'original' } }, bookmarks: [] } };
        let activeContractKey = 'GCC';
        let fullClauseDatabase = contracts.GCC.data;
        let savedBookmarks = [];
        let currentThemeIndex = 0;
        let ORIGINAL_CONTRACTS = { GCC: { data: { '1': { title: 'One', content: 'original' } } } };
        let hasUnsavedChanges = false;
        let lastSavedTime = 0;
        let autoSaveTimer = null;
        const AUTO_SAVE_INTERVAL = 30000;
        const AUTO_SAVE_KEY = 'auto';
        function saveContractsToStorage() { return Promise.resolve(true); }
        function updateLocalModificationTime() {}
        function showSuccess() {}
        const CustomDialog = { prompt: async () => null, alert: async () => {} };
        const localforage = { setItem: async () => {} };
    `, context);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'editor.js'), 'utf8'), context);
    return context;
}

function loadCloudContext() {
    const context = createBaseContext();
    vm.runInContext(`
        let contracts = {};
        let activeContractKey = null;
        let fullClauseDatabase = {};
        let savedBookmarks = null;
        let currentThemeIndex = 0;
        let ORIGINAL_CONTRACTS = {};
        function renderTabs() {}
        function renderMainDocument() {}
        function initBookmarks() {}
        function buildReverseIndex() {}
        function switchContract(key) {
            activeContractKey = key;
            fullClauseDatabase = contracts[key].data;
            savedBookmarks = contracts[key].bookmarks;
        }
        function showWelcomePage() { activeContractKey = null; }
        function applyTheme() {}
        function saveContractsToStorage() { return Promise.resolve(true); }
        function captureCurrentContent() {}
        function extractAllUserModifications() { return {}; }
        function getAISettingsForCloud() { return null; }
        const CustomDialog = { confirm: async () => true, alert: async () => {} };
    `, context);
    vm.runInContext(fs.readFileSync(path.join(root, 'js', 'cloud-storage.js'), 'utf8'), context);
    return context;
}

async function run() {
    const editorContext = loadEditorContext();
    assert.strictEqual(
        vm.runInContext(`hasUserModifications('plain text', { modifiedAt: 10 })`, editorContext),
        true,
        'plain-text edits marked with modifiedAt must be synchronized'
    );
    assert.strictEqual(vm.runInContext(`hasUserModifications('<i>italic</i>')`, editorContext), true);
    assert.strictEqual(vm.runInContext(`hasUserModifications('<u>underline</u>')`, editorContext), true);
    assert.strictEqual(
        vm.runInContext(`hasUserModifications('<strong>base</strong>', {}, 'GCC', '1')`, editorContext),
        true
    );
    vm.runInContext(`ORIGINAL_CONTRACTS.GCC.data['1'].content = '<strong>base</strong>'`, editorContext);
    assert.strictEqual(
        vm.runInContext(`hasUserModifications('<strong>base</strong>', {}, 'GCC', '1')`, editorContext),
        false,
        'formatting already present in imported source must not be treated as a new edit'
    );

    const cloudContext = loadCloudContext();
    const cloudSnapshot = {
        active_contract_key: 'GCC',
        contract_data: {
            GCC: {
                title: 'General Conditions',
                data: {
                    '1': { title: 'One', content: '<b>cloud edited</b>', modifiedAt: 200 }
                }
            }
        },
        modifications: {},
        bookmarks: { GCC: [{ id: '1', label: 'One', level: 0 }] },
        theme: 1
    };
    cloudContext.testSnapshot = cloudSnapshot;
    await vm.runInContext('applyCloudDataToLocal(testSnapshot)', cloudContext);
    const restored = JSON.parse(vm.runInContext('JSON.stringify({ contracts, activeContractKey })', cloudContext));
    assert.strictEqual(restored.activeContractKey, 'GCC');
    assert.strictEqual(restored.contracts.GCC.data['1'].content, '<b>cloud edited</b>');

    cloudContext.stalePatchSnapshot = JSON.parse(JSON.stringify(cloudSnapshot));
    cloudContext.stalePatchSnapshot.modifications = {
        GCC: { '1': { content: 'stale patch', modifiedAt: 100 } }
    };
    await vm.runInContext('applyCloudDataToLocal(stalePatchSnapshot)', cloudContext);
    assert.strictEqual(
        vm.runInContext(`contracts.GCC.data['1'].content`, cloudContext),
        '<b>cloud edited</b>',
        'an older patch must not overwrite a newer full snapshot'
    );

    vm.runInContext(`
        contracts = { GCC: { title: 'General Conditions', data: { '1': { title: 'One', content: 'original' } }, bookmarks: [] } };
        activeContractKey = 'GCC';
        fullClauseDatabase = contracts.GCC.data;
    `, cloudContext);
    cloudContext.testSnapshot = cloudSnapshot;
    vm.runInContext(`
        hydrateMissingCloudContracts(testSnapshot);
        const cloudMods = collectCloudModifications(testSnapshot);
        const result = mergeFieldLevel({}, cloudMods);
        applyMergedModifications(result.cloudNewer);
    `, cloudContext);
    assert.strictEqual(vm.runInContext(`contracts.GCC.data['1'].content`, cloudContext), '<b>cloud edited</b>');

    vm.runInContext(`
        initialized = true;
        currentUser = { uid: 'test-user' };
        saveToCloud = async function () { throw new Error('permission denied'); };
    `, cloudContext);
    await assert.rejects(
        () => vm.runInContext('forceUploadToCloud()', cloudContext),
        /permission denied/,
        'force upload must propagate write failures'
    );

    console.log('cloud sync regression tests passed');
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
