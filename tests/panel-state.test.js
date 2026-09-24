const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

class ClassList {
    constructor() { this.values = new Set(); }
    add(...values) { values.forEach(value => this.values.add(value)); }
    remove(...values) { values.forEach(value => this.values.delete(value)); }
    contains(value) { return this.values.has(value); }
    toggle(value, force) {
        if (force === true) { this.values.add(value); return true; }
        if (force === false) { this.values.delete(value); return false; }
        if (this.values.has(value)) { this.values.delete(value); return false; }
        this.values.add(value);
        return true;
    }
}

function createContext() {
    const elements = {};
    const element = id => elements[id] || (elements[id] = {
        id,
        classList: new ClassList(),
        style: {},
        scrollTop: 0,
        innerHTML: '',
        innerText: '',
        value: '',
        toggleAttribute() {},
        querySelectorAll() { return []; }
    });
    ['panelNav', 'panelRef', 'resizer1', 'resizer2', 'panelMain', 'navList', 'refContent',
        'refFixedHeader', 'btnToggleNavigator', 'btnToggleReferenceView', 'btnLangMode', 'btnLangToggle']
        .forEach(element);
    const navTitle = { innerText: '' };
    const searchInput = { value: '' };
    const context = {
        Blob, URL, AbortController, TextDecoder, setTimeout, clearTimeout, setInterval, clearInterval,
        requestAnimationFrame: callback => callback(),
        console: { log() {}, info() {}, warn() {}, error() {} },
        navigator: { onLine: true },
        localStorage: { getItem() { return null; }, setItem() {} },
        localforage: { getItem: async () => null, setItem: async () => true },
        Logger: { info() {}, error() {} },
        escapeHtml: value => value,
        sanitizeHtml: value => value,
        showError() {},
        showSuccess() {},
        document: {
            addEventListener() {},
            getElementById: element,
            querySelectorAll() { return []; },
            querySelector(selector) {
                if (selector === '.nav-title') return navTitle;
                if (selector === '.search-input') return searchInput;
                return null;
            }
        }
    };
    context.window = context;
    vm.createContext(context);
    for (const file of ['app', 'cloud-storage']) {
        vm.runInContext(fs.readFileSync(path.join(root, 'js', `${file}.js`), 'utf8'), context, { filename: `${file}.js` });
    }
    vm.runInContext(`
        resetCrossRefState = function () {};
        updateLangModeButton = function () {};
        updateChineseVariantButton = function () {};
        renderMainDocument = function () {};
        initBookmarks = function () {};
        buildReverseIndex = function () {};
        renderTabs = function () {};
        restoreContractOriginals = function () {};
        saveReferenceLanguagePreference = function () {};
        captureCurrentContent = function () {};
        clearSearchHighlights = function () {};
        disableSyncModeInternal = function () {};
    `, context);
    return context;
}

const evaluate = (context, code) => vm.runInContext(code, context);
const panelState = context => JSON.parse(evaluate(context, `JSON.stringify({
    activeContractKey,
    navCollapsed: document.getElementById('panelNav').classList.contains('collapsed'),
    refCollapsed: document.getElementById('panelRef').classList.contains('collapsed')
})`));

function run() {
    const context = createContext();
    evaluate(context, `
        contracts = {};
        activeContractKey = null;
        showWelcomePage();
    `);

    for (const key of ['GCC', 'SCC', 'CUSTOM']) {
        context.cloudSnapshot = {
            active_contract_key: key,
            contract_data: {
                [key]: { title: key, data: { '1': { title: `${key} 1`, content: 'body' } } }
            }
        };
        evaluate(context, `hydrateMissingCloudContracts(cloudSnapshot); activeContractKey = null; refreshContractsAfterCloud(cloudSnapshot.active_contract_key);`);
        assert.deepStrictEqual(panelState(context), {
            activeContractKey: key,
            navCollapsed: false,
            refCollapsed: false
        }, `${key} must default to expanded panels after cloud refresh`);

        evaluate(context, `
            document.getElementById('panelNav').classList.add('collapsed');
            document.getElementById('panelRef').classList.add('collapsed');
            switchContract(${JSON.stringify(key)});
        `);
        assert.strictEqual(panelState(context).navCollapsed, false, `${key} same-tab refresh must restore the navigator`);
        assert.strictEqual(panelState(context).refCollapsed, false, `${key} same-tab refresh must restore the reference panel`);
    }

    evaluate(context, `
        navViewStatePerContract.CUSTOM = true;
        refViewStatePerContract.CUSTOM = true;
        restoreContractPanelState('CUSTOM');
        refreshContractsAfterCloud('CUSTOM');
    `);
    assert.strictEqual(panelState(context).navCollapsed, true, 'a user-collapsed navigator must remain collapsed');
    assert.strictEqual(panelState(context).refCollapsed, true, 'a user-collapsed reference panel must remain collapsed');

    console.log('panel state regression tests passed (all contract tabs, cloud refresh, same-tab restore, manual collapse)');
}

run();
