const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'editor.js'), 'utf8');

class ClassList {
    constructor(values = []) { this.values = new Set(values); }
    contains(value) { return this.values.has(value); }
}

function createElement({ classes = [], parent = null, connected = true } = {}) {
    return {
        nodeType: 1,
        classList: new ClassList(classes),
        get className() { return [...this.classList.values].join(' '); },
        set className(value) { this.classList = new ClassList(String(value).split(/\s+/).filter(Boolean)); },
        parentElement: parent,
        parentNode: parent,
        isConnected: connected,
        attributes: {},
        innerText: '',
        closest(selector) {
            const className = selector.startsWith('.') ? selector.slice(1) : selector;
            for (let current = this; current; current = current.parentElement) {
                if (current.classList?.contains(className)) return current;
            }
            return null;
        },
        setAttribute(name, value) { this.attributes[name] = value; },
        getAttribute(name) { return this.attributes[name] || ''; }
    };
}

function createContext({ promptResult = '备注内容', crossClause = false } = {}) {
    const clause = createElement({ classes: ['clause-text'] });
    const secondClause = createElement({ classes: ['clause-text'] });
    const originalText = { nodeType: 3, parentElement: clause };
    const endText = { nodeType: 3, parentElement: crossClause ? secondClause : clause };
    const toolbar = createElement({ classes: ['toolbar-btn'] });
    const originalRange = {
        startContainer: originalText,
        endContainer: endText,
        cloneRange() {
            return {
                startContainer: originalText,
                endContainer: endText,
                surroundContents(span) { context.wrappedRange = 'original'; context.wrappedSpan = span; span.parentElement = clause; span.parentNode = clause; }
            };
        }
    };
    const liveSelection = {
        rangeCount: 1,
        isCollapsed: false,
        anchorNode: originalText,
        toString() { return '选中的合同正文'; },
        getRangeAt() { return this.activeRange; },
        activeRange: originalRange,
        removeAllRanges() { this.rangeCount = 0; }
    };
    const toolbarRange = {
        startContainer: { nodeType: 3, parentElement: toolbar },
        endContainer: { nodeType: 3, parentElement: toolbar },
        surroundContents() { context.wrappedRange = 'toolbar'; }
    };
    const context = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, setInterval, clearInterval,
        activeContractKey: 'TEST',
        contracts: { TEST: { data: {} } },
        fullClauseDatabase: {}, savedBookmarks: [], currentThemeIndex: 0,
        AUTO_SAVE_INTERVAL: 30000, AUTO_SAVE_KEY: 'test', hasUnsavedChanges: false,
        localforage: { setItem: async () => {} },
        saveContractsToStorage: async () => true,
        getOriginalClause: () => null,
        updateLocalModificationTime() {},
        showSuccess() {},
        showError(message) { context.errors.push(message); },
        errors: [],
        CustomDialog: {
            prompt: async () => {
                liveSelection.activeRange = toolbarRange;
                liveSelection.anchorNode = toolbarRange.startContainer;
                liveSelection.isCollapsed = true;
                return promptResult;
            }
        },
        document: {
            addEventListener() {},
            getElementById() { return null; },
            querySelectorAll() { return []; },
            createElement() { return createElement(); },
            createTextNode(text) { return { nodeType: 3, textContent: text }; }
        }
    };
    context.window = { getSelection: () => liveSelection };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'editor.js' });
    vm.runInContext('captureCurrentContent = () => { globalThis.captureCount = (globalThis.captureCount || 0) + 1; }; autoSave = async () => true;', context);
    return context;
}

async function run() {
    const context = createContext();
    await vm.runInContext('addOrEditNote()', context);
    assert.strictEqual(context.wrappedRange, 'original', 'the pre-dialog body range must be used after the prompt changes selection');
    assert.strictEqual(context.wrappedSpan.classList.contains('note-span'), true);
    assert.strictEqual(context.wrappedSpan.getAttribute('data-note'), '备注内容');
    assert.strictEqual(context.wrappedSpan.closest('.clause-text') !== null, true, 'the note span must remain inside contract content');
    assert.strictEqual(context.captureCount, 1, 'a successful insertion must enter the persistence path');

    const invalidContext = createContext({ crossClause: true });
    await vm.runInContext('addOrEditNote()', invalidContext);
    assert.strictEqual(invalidContext.wrappedRange, undefined, 'a cross-clause selection must not create a misplaced note');
    assert.strictEqual(invalidContext.errors.length, 1, 'a cross-clause selection must tell the user how to recover');

    const blankContext = createContext({ promptResult: '   ' });
    await vm.runInContext('addOrEditNote()', blankContext);
    assert.strictEqual(blankContext.wrappedRange, undefined, 'a blank note must leave the document unchanged');

    console.log('editor note regression tests passed (selection snapshot, valid insertion, invalid selection, blank note)');
}

run().catch(error => { console.error(error); process.exit(1); });
