const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'assistant-notebook.js'), 'utf8');

function storage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return { values, localforage: { getItem: async key => values.get(key) || null, setItem: async (key, value) => { values.set(key, value); } } };
}
function load(values = {}) {
    let index = 0;
    const store = storage(values);
    const context = {
        console, JSON, Map, Set, Promise, Date, Math, String, Array, Object,
        crypto: { randomUUID: () => `note-${++index}` }, localforage: store.localforage,
        navigator: { onLine: false }, currentUser: null, db: null,
        localStorage: { getItem: () => null, setItem: () => {} }, CustomDialog: { confirm: async () => true },
        document: { getElementById: () => null, createElement: () => ({ appendChild: () => {}, classList: { add: () => {} } }) },
        setTimeout: () => 1, clearTimeout: () => {},
        window: { addEventListener: () => {}, FIREBASE_COLLECTIONS: { CONTRACT_MODS: 'general_contract_mods' } }
    };
    context.window.window = context.window;
    vm.createContext(context); vm.runInContext(source, context, { filename: 'assistant-notebook.js' });
    return { api: context.window.AssistantNotebook, values: store.values };
}

async function run() {
    const first = load(); await first.api.ready;
    const created = await first.api.addFromAssistant({ content: '# 付款风险\n\n承包商应在验收后 30 日内付款。', sourceTopicId: 'topic-a', sourceTopicTitle: '付款分析', sourceMessageId: 'message-a' });
    assert.ok(created.created, 'first favorite should create a note');
    assert.strictEqual(created.note.title, '付款风险', 'a Markdown heading should seed the notebook title');
    assert.strictEqual(first.api.getCount(), 1, 'created note should be visible in notebook count');
    const duplicate = await first.api.addFromAssistant({ content: '# 付款风险\n\n承包商应在验收后 30 日内付款。', sourceTopicId: 'topic-a', sourceTopicTitle: '付款分析', sourceMessageId: 'message-a' });
    assert.ok(!duplicate.created, 'the exact same reply must not create duplicate notes');
    assert.strictEqual(first.api.getCount(), 1, 'deduplication must preserve a single note');
    const changed = await first.api.addFromAssistant({ content: '# 付款风险\n\n付款期限已调整为 45 日。', sourceTopicId: 'topic-a', sourceTopicTitle: '付款分析', sourceMessageId: 'message-a' });
    assert.ok(changed.created, 'a regenerated reply with new content should remain collectible');
    assert.strictEqual(first.api.getCount(), 2, 'changed reply should create a second independent snapshot');
    const persisted = first.values.get('assistant_notebook_v1');
    const restored = load({ assistant_notebook_v1: persisted, assistant_notebook_outbox_v1: first.values.get('assistant_notebook_outbox_v1') });
    await restored.api.ready;
    assert.strictEqual(restored.api.getCount(), 2, 'notes must survive a local reload');
    console.log('assistant notebook tests passed (title seed, deduplication, regenerated snapshot, local persistence)');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
