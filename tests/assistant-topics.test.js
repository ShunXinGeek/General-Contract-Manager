const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'assistant-topics.js'), 'utf8');

function storage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        values,
        localforage: {
            getItem: async key => values.get(key) || null,
            setItem: async (key, value) => { values.set(key, value); },
            removeItem: async key => { values.delete(key); }
        }
    };
}

function loadTopicModule(values) {
    let nextId = 0;
    const store = storage(values);
    const { localforage } = store;
    const cloudWrites = [];
    const makeRef = path => ({
        path,
        collection: name => ({ doc: id => makeRef(`${path}/${name}/${id}`) })
    });
    const context = {
        console, JSON, Map, Set, Promise, Date, Math,
        crypto: { randomUUID: () => `topic-${++nextId}` },
        navigator: { onLine: false },
        currentUser: null,
        db: null,
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-timestamp' } } },
        localforage,
        localStorage: { getItem: () => null, setItem: () => {} },
        document: {
            getElementById: () => null,
            addEventListener: () => {},
            querySelectorAll: () => [],
            createElement: () => ({ classList: { toggle: () => {} }, setAttribute: () => {}, appendChild: () => {}, append: () => {} })
        },
        CustomDialog: { prompt: async () => null, confirm: async () => false },
        setTimeout: () => 1,
        clearTimeout: () => {},
        window: { addEventListener: () => {}, innerWidth: 1280, FIREBASE_COLLECTIONS: { CONTRACT_MODS: 'general_contract_mods' } }
    };
    context.db = {
        collection: name => ({ doc: id => makeRef(`${name}/${id}`) }),
        batch: () => {
            const operations = [];
            return { set: (ref, data, options) => operations.push({ path: ref.path, data, options }), commit: async () => { cloudWrites.push(...operations); } };
        }
    };
    context.window.window = context.window;
    vm.createContext(context);
    vm.runInContext(source, context, { filename: 'assistant-topics.js' });
    return { context, values: store.values, cloudWrites };
}

async function run() {
    const legacy = JSON.stringify({ messages: [{ role: 'user', content: '旧对话问题' }, { role: 'assistant', content: '旧对话回答' }], hasContextBreak: false, contextBreakIndex: -1 });
    const first = loadTopicModule({ general_contract_chat: legacy });
    await first.context.window.assistantTopicsReady;
    const migrated = first.context.window.AssistantTopics.getTopics();
    assert.strictEqual(migrated.length, 1, 'legacy chat should migrate into one topic');
    assert.strictEqual(migrated[0].title, '历史对话', 'migrated topic title should be explicit');
    assert.strictEqual(migrated[0].messageCount, 2, 'migrated topic should retain all messages');
    const storedMessages = JSON.parse(first.values.get(`assistant_topic_messages_v2:${migrated[0].id}`));
    assert.strictEqual(storedMessages.length, 2, 'migrated message collection should be persisted separately');

    await first.context.window.AssistantTopics.saveCurrentChat({
        messages: [{ role: 'user', content: '请解释第 50 条' }, { role: 'assistant', content: '这里是解释' }],
        hasContextBreak: true,
        contextBreakIndex: 1
    });
    const changed = first.context.window.AssistantTopics.getTopics()[0];
    assert.strictEqual(changed.title, '请解释第 50 条', 'first user message should name an untitled topic');
    assert.strictEqual(changed.hasContextBreak, true, 'topic should persist context break state');
    assert.strictEqual(changed.contextBreakIndex, 1, 'topic should persist context break index');
    assert.strictEqual(JSON.parse(first.values.get(`assistant_topic_messages_v2:${changed.id}`)).length, 2, 'new topic messages should persist by topic id');
    let titleRequest;
    first.context.window.AIClient = {
        instructionRole: () => 'system',
        request: async (config, messages, options) => { titleRequest = { config, messages, options }; return { json: async () => ({ choices: [{ message: { content: '标题：付款风险提示与处置方案' } }] }) }; }
    };
    const generated = await first.context.window.AssistantTopics.generateTitle({ topicId: changed.id, modelConfig: { apiEndpoint: 'https://api.example.test/v1', apiKey: 'test-key', model: 'test-model' }, modelId: 'test-model-id', question: '请解释第 50 条', answer: '这里是解释' });
    assert.strictEqual(generated, '付款风险提示与处置方案', 'generated topic title should retain only concise Chinese characters');
    assert.ok(Array.from(generated).length <= 13, 'generated topic title must stay within 13 Chinese characters');
    assert.strictEqual(titleRequest.options.stream, false, 'title generation must use a short non-streaming call');
    assert.strictEqual(titleRequest.config.model, 'test-model', 'title generation must retain the reply model configuration');
    assert.strictEqual(first.context.window.AssistantTopics.getTopics()[0].titleSource, 'ai', 'successful generated title should be marked as AI-owned');
    assert.ok(JSON.parse(first.values.get('assistant_topic_outbox_v1')).length >= 3, 'offline changes should queue topic and message synchronization');
    first.context.currentUser = { uid: 'topic-test-user' };
    first.context.navigator.onLine = true;
    assert.strictEqual(await first.context.window.AssistantTopics.flushOutbox(), true, 'queued topic changes should sync when connectivity returns');
    assert.ok(first.cloudWrites.some(write => write.path === `general_contract_mods/topic-test-user/assistant_topics/${changed.id}`), 'topic metadata must sync to the user-scoped Firebase path');
    const messageWrites = first.cloudWrites.filter(write => write.path.includes(`/assistant_topics/${changed.id}/messages/`));
    assert.strictEqual(messageWrites.length, 4, 'message replacement must write current messages and tombstone removed ones');
    assert.strictEqual(messageWrites.filter(write => write.data.status === 'deleted').length, 2, 'removed topic messages must receive Firebase tombstones');
    assert.strictEqual(messageWrites.filter(write => write.data.role).length, 2, 'each current message must sync in the topic message subcollection');

    const branching = loadTopicModule({});
    await branching.context.window.assistantTopicsReady;
    const branchApi = branching.context.window.AssistantTopics;
    const sourceTopicId = branchApi.getCurrentTopicId();
    const branchHistory = [
        { role: 'user', content: '分析付款条款' },
        { role: 'assistant', content: '第一段回复', reasoning: '第一段思考', validation: { passed: true } },
        { role: 'user', content: '继续说明' },
        { role: 'assistant', content: '第二段回复', retrievalDiagnostic: { missing: [] } },
        { type: 'break' },
        { role: 'user', content: '新的上下文' },
        { role: 'assistant', content: '第三段回复' }
    ];
    await branchApi.saveCurrentChat({ messages: branchHistory, hasContextBreak: true, contextBreakIndex: 5 });
    const firstBranch = await branchApi.branchFromMessage(1, branchHistory);
    assert.strictEqual(firstBranch.title, '分析付款条款（1）', 'first branch should use the source title and number one');
    assert.strictEqual(firstBranch.messageCount, 2, 'branch should stop at the selected assistant reply');
    assert.strictEqual(firstBranch.hasContextBreak, false, 'a context break after the selected reply must not leak into the branch');
    const firstBranchMessages = JSON.parse(branching.values.get(`assistant_topic_messages_v2:${firstBranch.id}`));
    assert.strictEqual(firstBranchMessages[1].reasoning, '第一段思考', 'branch should preserve assistant reasoning metadata');
    assert.deepStrictEqual(firstBranchMessages[1].validation, { passed: true }, 'branch should preserve validation metadata');
    assert.strictEqual(JSON.parse(branching.values.get(`assistant_topic_messages_v2:${sourceTopicId}`)).length, 7, 'branching must not truncate the source topic');

    await branchApi.switchTopic(sourceTopicId);
    const secondBranch = await branchApi.branchFromMessage(6, branchHistory);
    assert.strictEqual(secondBranch.title, '分析付款条款（2）', 'repeated branches from the source should increment the suffix');
    assert.strictEqual(secondBranch.messageCount, 7, 'later branch should retain all messages through the selected reply');
    assert.strictEqual(secondBranch.hasContextBreak, true, 'included context breaks must be retained');
    assert.strictEqual(secondBranch.contextBreakIndex, 5, 'branch context should restart after the retained break');
    const ordered = branchApi.getTopics().filter(topic => topic.status === 'active').sort((a, b) => a.rank - b.rank);
    assert.deepStrictEqual(ordered.map(topic => topic.id), [firstBranch.id, secondBranch.id, sourceTopicId], 'each new branch should be inserted immediately above the source topic');
    branching.context.currentUser = { uid: 'branch-test-user' };
    branching.context.navigator.onLine = true;
    assert.strictEqual(await branchApi.flushOutbox(), true, 'branch topic and messages should flush to Firebase');
    assert.ok(branching.cloudWrites.some(write => write.path === `general_contract_mods/branch-test-user/assistant_topics/${secondBranch.id}`), 'branch metadata must use the normal user-scoped topic path');
    assert.strictEqual(branching.cloudWrites.filter(write => write.path.includes(`/assistant_topics/${secondBranch.id}/messages/`) && write.data.role).length, 6, 'all non-break branch messages must sync with their metadata');
    assert.strictEqual(branching.cloudWrites.filter(write => write.path.includes(`/assistant_topics/${secondBranch.id}/messages/`) && write.data.type === 'break').length, 1, 'branch context breaks must sync as messages');

    const attachmentCloud = loadTopicModule({});
    await attachmentCloud.context.window.assistantTopicsReady;
    attachmentCloud.context.window.AssistantAttachments = {
        messageAttachments: async () => [{ id: 'attachment-1', name: 'evidence.md', type: 'md', size: 12, extractedBytes: 12, text: '仅存于附件子文档', warning: null }],
        clearDraft: async () => {}, loadDraft: async () => {}
    };
    const attachmentApi = attachmentCloud.context.window.AssistantTopics;
    const attachmentTopicId = attachmentApi.getCurrentTopicId();
    const attachmentMessage = { id: 'attachment-message', role: 'user', content: '请分析附件', attachments: [{ id: 'attachment-1', name: 'evidence.md', type: 'md', extractedBytes: 12 }] };
    await attachmentApi.saveCurrentChat({ messages: [attachmentMessage], hasContextBreak: false, contextBreakIndex: -1 });
    attachmentCloud.context.currentUser = { uid: 'attachment-user' };
    attachmentCloud.context.navigator.onLine = true;
    assert.strictEqual(await attachmentApi.flushOutbox(), true, 'attachment message should synchronize');
    const parentWrite = attachmentCloud.cloudWrites.find(write => write.path.endsWith(`/assistant_topics/${attachmentTopicId}/messages/attachment-message`));
    const childWrite = attachmentCloud.cloudWrites.find(write => write.path.endsWith(`/assistant_topics/${attachmentTopicId}/messages/attachment-message/attachments/attachment-1`));
    assert.ok(parentWrite && !Object.prototype.hasOwnProperty.call(parentWrite.data, 'text'), 'message document must retain only attachment summaries');
    assert.strictEqual(childWrite?.data.text, '仅存于附件子文档', 'attachment body must use the separate attachment subcollection');
    await attachmentApi.saveCurrentChat({ messages: [], hasContextBreak: false, contextBreakIndex: -1 });
    assert.strictEqual(await attachmentApi.flushOutbox(), true, 'attachment deletion should synchronize');
    const tombstone = attachmentCloud.cloudWrites.find(write => write.path.endsWith(`/assistant_topics/${attachmentTopicId}/messages/attachment-message`) && write.data.status === 'deleted');
    assert.ok(tombstone && tombstone.options === undefined && !Object.prototype.hasOwnProperty.call(tombstone.data, 'content'), 'message tombstone must overwrite instead of merge so prior content is not retained');
    console.log('assistant topic tests passed (migration, persistence, branching, offline outbox, Firebase writes)');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
