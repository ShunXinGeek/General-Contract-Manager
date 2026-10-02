const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { context, evaluate, readContracts, root } = require('./helpers/retrieval-context');

async function run() {
    const ctx = context(), api = ctx.AIRetrieval;
    const source = readContracts();
    // Labels grounded in source: every positive target exists; modifier targets have actual source relations.
    const cases = require('./fixtures/retrieval-cases.json');
    assert.strictEqual(cases.length, 64);
    for (const item of cases) for (const id of item.required) {
        const [type, number] = id.split(':'); assert.ok(source[type].data[number]?.content, `Missing gold source ${id}`);
    }
    const parsed = api.parseRefs('SCC Clause 3A(1)(b), GCC Clause 50(1), SCC9R', source);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed.map(ref => [ref.type, ref.id, ref.subclause]))), [['SCC', '3A', '(1)(B)'], ['GCC', '50', '(1)'], ['SCC', '9R', '']]);
    assert.strictEqual(api.parseRefs('Clause 50', source)[0].type, null);
    assert.strictEqual(api.parseRefs('第50条', source)[0].id, '50');
    assert.strictEqual(api.fingerprint('<p>Hello &amp; world.</p>'), api.fingerprint('Hello & world.'));
    assert.notStrictEqual(api.fingerprint('Pay 1.0'), api.fingerprint('Pay 10'));
    assert.notStrictEqual(api.fingerprint('Limit < 10'), api.fingerprint('Limit > 10'));
    assert.notStrictEqual(api.fingerprint('different'), api.fingerprint('Hello world'));

    const minimal = { GCC: { data: { '34': { title: 'Unrelated facilities', content: 'Facilities for persons.' }, '50': { title: 'Extension', content: 'Original extension notice. (1) Contract conditions apply.' } } },
        SCC: { data: { 'SCC 34': { title: 'Night concreting', content: 'Night concreting permission must be obtained.' }, '50': { title: 'Safety', content: 'Safety audits.' }, '2': { title: '(Not used)', content: '' } } } };
    let calls = 0;
    ctx.RAG.findMostRelevant = async () => { calls++; return []; };
    let evidence = await api.retrieve('SCC Clause 34', minimal, {});
    assert.deepStrictEqual(JSON.parse(JSON.stringify(evidence.clauses.map(api.identity))), ['SCC:34']); assert.strictEqual(calls, 0);
    evidence = await api.retrieve('Clause 50', minimal, {});
    assert.strictEqual(evidence.clauses.length, 0); assert.match(evidence.diagnostic.missing.join(' '), /歧义/);
    evidence = await api.retrieve('SCC Clause 999', minimal, {}); assert.strictEqual(evidence.clauses.length, 0);
    evidence = await api.retrieve('SCC Clause 2', minimal, {}); assert.strictEqual(evidence.clauses.length, 0);
    evidence = await api.retrieve('该条款的条件？', minimal, {}, { history: [{ role: 'user', content: 'SCC Clause 34' }, { role: 'assistant', content: 'GCC Clause 34' }] });
    assert.ok(evidence.clauses.some(row => api.identity(row) === 'SCC:34')); assert.ok(!evidence.clauses.some(row => api.identity(row) === 'GCC:34'));
    const wrongVersion = { GCC: { data: { '1': { title: 'Other definition', content: 'This is another contract entirely.' } } },
        SCC: { data: { '3A': { title: 'Other clause', content: 'No amendment relationship stated.' } } } };
    assert.strictEqual(api.relationships(api.rows(wrongVersion), wrongVersion).length, 0, 'unknown versions cannot inherit static mapping');
    wrongVersion.SCC.data['3A'].content = 'General Conditions of Contract Clause 1 is amended by adding this definition.';
    wrongVersion.GCC.title = 'General Conditions of Contract';
    wrongVersion.SCC.title = 'Special Conditions of Contract';
    assert.strictEqual(api.relationships(api.rows(wrongVersion), wrongVersion)[0].origin, 'current-original');
    const corpusEdges = api.relationships(api.rows(source), source);
    for (const pair of [['1', '3A'], ['4', '6'], ['50', '84'], ['50', '111'], ['52', '45'], ['86', '59']]) assert.ok(corpusEdges.some(edge => edge.base === 'GCC:' + pair[0] && edge.modifier === 'SCC:' + pair[1]), `Source relation missing ${pair}`);

    // A natural Chinese paraphrase must still find the English source when semantic
    // vectors are unavailable. This is the production regression that prompted the
    // local bilingual retrieval path.
    ctx.RAG.findMostRelevant = async () => [];
    const responseDeadlineQueries = [
        '在合同条款中，是否对于“一方理应在多久之内对另外一方的信函做出回复”给出明确的时间要求？',
        '对方收到书面请求后多久要回复？',
        '来函答复期限是多少？',
        '建筑师应在几日内回应承包商的书面请求？',
        'Is there a time limit for responding to a written request?'
    ];
    for (const query of responseDeadlineQueries) {
        evidence = await api.retrieve(query, source, {});
        assert.ok(evidence.clauses.some(row => api.identity(row) === 'GCC:5'), `Response-deadline query must retrieve GCC:5: ${query}`);
        assert.ok(evidence.diagnostic.corpus.clauses > 0, 'Diagnostics must distinguish a loaded corpus from an empty one');
    }
    const unrelatedDeadline = { GCC: { data: { '5': { title: 'Reply deadline', content: 'The Architect shall respond within 14 days of receipt of the written request.' }, '25': { title: 'Insurance', content: 'The Contractor shall maintain insurance within 7 days.' } } } };
    assert.strictEqual(api.lexical('保险期限', api.rows(unrelatedDeadline))[0].id, '25', 'A generic deadline must not make the reply clause the top result');

    ctx.RAG.findMostRelevant = async () => [{ type: 'SCC', clauseId: '34', score: 0.9 }];
    evidence = await api.retrieve('extension and night concreting', minimal, {});
    assert.ok(evidence.clauses.some(row => api.identity(row) === 'SCC:34')); assert.ok(evidence.clauses.some(row => api.identity(row) === 'GCC:50')); assert.ok(calls === 0);
    evidence = await api.retrieve('GCC Clause 50', minimal, {});
    assert.ok(api.validate('GCC Clause 50\n> Original extension notice.', evidence, minimal).passed);
    assert.ok(!api.validate('SCC Clause 999', evidence, minimal).passed);
    assert.ok(!api.validate('GCC Clause 50(999)', evidence, minimal).passed);
    assert.ok(!api.validate('Clause 50', evidence, minimal).passed);
    assert.ok(!api.validate('GCC Clause 50\n> Fabricated payment of one million.', evidence, minimal).passed);
    const numericEvidence = { clauses: [{ type: 'GCC', id: '50', content: 'The payment shall be 1.0 million.' }], diagnostic: { relationships: [] } };
    assert.ok(!api.validate('GCC Clause 50\n> The payment shall be 10 million.', numericEvidence, minimal).passed);
    const prompt = api.prompt(evidence, '请使用繁体中文'); assert.match(prompt, /繁体中文/); assert.match(prompt, /用户事实/); assert.match(prompt, /历史助手回答不是证据/);
    const abort = new AbortController(); abort.abort(); await assert.rejects(api.retrieve('question', minimal, {}, { signal: abort.signal }), { name: 'AbortError' });

    // Real RAG methods with controlled DB/API boundaries.
    vm.runInContext(fs.readFileSync(path.join(root, 'js/rag.js'), 'utf8'), ctx);
    const rag = ctx.RAG, config = { embeddingModel: 'test-model', embeddingEndpoint: 'https://example.test/v1', embeddingApiKey: 'test-key' };
    const record = { sourceId: minimal.GCC.sourceId, type: 'GCC', clauseId: '50', title: 'Extension', embeddingModel: 'test-model', schemaVersion: rag.INDEX_SCHEMA_VERSION, sourceHash: api.fingerprint(minimal.GCC.data['50'].content), dimension: 2, vector: [1, 0] };
    record.titleHash = api.fingerprint('Extension'); record.embeddingSpace = rag.embeddingSpace(config.embeddingEndpoint, config.embeddingModel);
    assert.strictEqual(rag.validateRecord(record, config, minimal), 'ready');
    assert.strictEqual(rag.validateRecord({ ...record, sourceHash: null }, config, minimal), 'legacy-unverified');
    assert.strictEqual(rag.validateRecord({ ...record, schemaVersion: 1 }, config, minimal), 'schema-mismatch');
    assert.strictEqual(rag.validateRecord({ ...record, embeddingModel: 'other' }, config, minimal), 'model-mismatch');
    assert.strictEqual(rag.validateRecord(record, { ...config, embeddingEndpoint: 'https://another.test/v1' }, minimal), 'space-mismatch');
    const retitled = JSON.parse(JSON.stringify(minimal)); retitled.GCC.data['50'].title = 'New title'; assert.strictEqual(rag.validateRecord(record, config, retitled), 'source-stale');
    assert.strictEqual(rag.validateRecord({ ...record, dimension: 3 }, config, minimal), 'dimension-invalid');
    assert.strictEqual(rag.validateRecord({ ...record, clauseId: '999' }, config, minimal), 'source-removed');
    assert.strictEqual(rag.validateRecord({ ...record, sourceHash: api.fingerprint('old') }, config, minimal), 'source-stale');
    assert.strictEqual(rag.cosineSimilarity([1, 0], [1]), null); assert.strictEqual(rag.cosineSimilarity([0, 0], [1, 0]), null);
    rag.readRecords = async () => [{ ...record, sourceHash: null }];
    let embedded = 0; rag.getEmbedding = async () => { embedded++; return [1, 0]; };
    assert.strictEqual((await rag.findMostRelevant('extension', config, 10, minimal)).length, 0); assert.strictEqual(embedded, 0);
    rag.readRecords = async () => [record, { ...record, clauseId: '999' }];
    assert.strictEqual((await rag.findMostRelevant('extension', config, 10, minimal)).length, 1); assert.strictEqual(rag.lastSearchStatus.rejected['source-removed'], 1);
    rag.readRecords = async () => [record, { ...record, sourceHash: null }];
    const indexStatus = await rag.getIndexStatus(config, minimal);
    assert.strictEqual(indexStatus.corpus, 4); assert.strictEqual(indexStatus.valid, 1); assert.strictEqual(indexStatus.rejected['legacy-unverified'], 1);
    assert.match(rag.describeIndexStatus(indexStatus), /旧索引/);
    rag.getEmbedding = async () => [1, 0, 0]; assert.strictEqual((await rag.findMostRelevant('query', config, 10, minimal)).length, 0); assert.strictEqual(rag.lastSearchStatus.code, 'query-dimension-mismatch');
    rag.getEmbedding = async () => { throw new Error('service failure'); }; await rag.findMostRelevant('query', config, 10, minimal); assert.strictEqual(rag.lastSearchStatus.code, 'service-unavailable');
    const candidates = api.rows(minimal).slice(0, 2);
    ctx.fetch = async (url, options) => {
        assert.strictEqual(url, '/api/retrieval');
        const envelope = JSON.parse(options.body), body = envelope.body;
        assert.strictEqual(envelope.kind, 'rerank'); assert.strictEqual(envelope.endpoint, config.rerankEndpoint || 'https://dashscope.aliyuncs.com/compatible-api/v1/reranks');
        assert.ok(!options.headers.Authorization, 'provider key must only be sent to the same-origin gateway');
        assert.match(body.documents[0], /Facilities for persons/); assert.match(body.documents[0], /GCC Clause/);
        return { ok: true, json: async () => ({ results: [{ index: -1, relevance_score: 1 }, { index: 0, relevance_score: 0 }, { index: 0, relevance_score: 0.5 }, { index: 99, relevance_score: 1 }] }) };
    };
    let reranked = await rag.rerank('query', candidates, { ...config, rerankEnabled: true }, 5);
    assert.strictEqual(reranked.length, 1); assert.strictEqual(reranked[0].rerankScore, 0); assert.strictEqual(rag.lastRerankStatus.attempted, 1);
    ctx.fetch = async () => { throw new Error('failure'); }; reranked = await rag.rerank('query', candidates, { ...config, rerankEnabled: true }, 5); assert.strictEqual(reranked.length, 2);

    // Snapshot consistency while building: generated vectors describe the submitted text, not later edits.
    const stored = [];
    rag.db = { transaction() { return { objectStore() { return { put(row) { stored.push(row); const req = {}; setTimeout(() => req.onsuccess(), 0); return req; } }; } }; } };
    rag.getEmbedding = async text => { assert.match(text, /Original extension/); return [1, 0]; };
    const summary = await rag.buildIndex({ GCC: { sourceId: minimal.GCC.sourceId, data: { '50': minimal.GCC.data['50'] } }, SCC: { sourceId: minimal.SCC.sourceId, data: { '2': minimal.SCC.data['2'] } } }, config);
    assert.strictEqual(summary.count, 1); assert.strictEqual(stored[0].sourceHash, record.sourceHash); assert.strictEqual(stored[0].schemaVersion, rag.INDEX_SCHEMA_VERSION);
    const edited = JSON.parse(JSON.stringify(minimal)); edited.GCC.data['50'].content += ' Changed.';
    assert.strictEqual(rag.validateRecord(stored[0], config, edited), 'source-stale');
    const budgetEvidence = await api.retrieve('SCC Clause 34', minimal, { retrievalCharacterBudget: 2000 }); assert.ok(budgetEvidence.diagnostic.characters <= 2000);

    // Name-agnostic settings: special labels, strict scope and three relation types.
    const generic = {
        '资料 A+B': { title: '基础文件', data: { '7': { title: 'Notice', content: 'Notice must be issued within seven days.' } } },
        '条件(2027)': { title: '项目条件', data: { '9': { title: 'Amendment', content: '基础文件 Clause 7 is amended by requiring three days.' } } },
        '附录/甲': { title: '技术附录', data: { '2': { title: 'Material', content: 'A unique zircon requirement applies.' } } }
    };
    assert.strictEqual(
        ctx.RetrievalSettings.createSourceId({ data: { '1': { content: 'device A edit' } } }, 'COMMON'),
        ctx.RetrievalSettings.createSourceId({ data: { '1': { content: 'device B edit' } } }, 'COMMON'),
        'legacy source ids must converge across devices even when local clause text differs'
    );
    ctx.RetrievalSettings.ensureSourceIds(generic);
    assert.strictEqual(api.parseRefs('请比较 资料 A+B Clause 7 与 条件(2027) Clause 9', generic).length, 2);
    assert.strictEqual(api.relationships(api.rows(generic), generic)[0].base, '资料 A+B:7');
    const genericSettings = ctx.RetrievalSettings.normalize(null, generic);
    genericSettings.sources[generic['附录/甲'].sourceId].enabled = false;
    ctx.RetrievalSettings.persist(genericSettings, generic, false);
    let scoped = await api.retrieve('zircon requirement', generic, {});
    assert.strictEqual(scoped.clauses.length, 0, 'disabled sources must not leak into local retrieval');
    assert.strictEqual(scoped.diagnostic.scope.enabled, 2);
    scoped = await api.retrieve('zircon requirement', generic, {});
    assert.strictEqual(scoped.clauses.length, 0, 'repeated retrieval must not reset a disabled source through a filtered subset');
    const crowded = { A: { title: 'Large source', data: {} }, B: { title: 'Small source', data: {
        '1': { title: 'Shared requirement', content: 'sharedterm applies to the small source.' }
    } } };
    for (let index = 1; index <= 30; index++) crowded.A.data[String(index)] = {
        title: `Shared requirement ${index}`, content: `sharedterm applies to large-source item ${index}.`
    };
    ctx.RetrievalSettings.ensureSourceIds(crowded);
    const crowdedEvidence = await api.retrieve('sharedterm', crowded, {}, {
        retrievalSettings: ctx.RetrievalSettings.normalize({ profile: 'precise' }, crowded)
    });
    assert.ok(crowdedEvidence.clauses.some(row => row.type === 'B'), 'global candidate truncation must retain a relevant representative from every enabled source');
    const ids = Object.values(generic).map(contract => contract.sourceId);
    genericSettings.relations = [
        { fromSourceId: ids[0], toSourceId: ids[1], type: 'higher' },
        { fromSourceId: ids[1], toSourceId: ids[2], type: 'same' }
    ];
    assert.strictEqual(ctx.RetrievalSettings.validate(genericSettings, generic).valid, true);
    const authorityEvidence = await api.retrieve('Notice days', generic, {}, { retrievalSettings: genericSettings });
    const authorityPrompt = api.prompt(authorityEvidence, '');
    assert.ok(authorityPrompt.includes('资料 A+B 高于 条件(2027)'), 'enabled source authority must reach the model prompt');
    assert.ok(!authorityPrompt.includes('条件(2027) 与 附录/甲 同级'), 'disabled source relationships must not enter the model prompt');
    genericSettings.relations = [
        { fromSourceId: ids[0], toSourceId: ids[1], type: 'higher' },
        { fromSourceId: ids[1], toSourceId: ids[2], type: 'higher' },
        { fromSourceId: ids[2], toSourceId: ids[0], type: 'higher' }
    ];
    assert.strictEqual(ctx.RetrievalSettings.validate(genericSettings, generic).valid, false, 'cyclic higher relations must be rejected');
    const stableId = generic['资料 A+B'].sourceId;
    generic['基础条件（重命名）'] = generic['资料 A+B']; delete generic['资料 A+B'];
    assert.strictEqual(ctx.RetrievalSettings.sourceEntries(generic).find(entry => entry.label === '基础条件（重命名）').sourceId, stableId);

    // Context break and regeneration must not retrieve older/future turns.
    ctx.RAG.findMostRelevant = async () => [];
    ctx.chatMessages = [{ role: 'user', content: 'GCC Clause 50' }, { type: 'break' }, { role: 'user', content: 'SCC Clause 34' }];
    ctx.hasContextBreak = true; ctx.contextBreakIndex = 2; ctx.contracts = minimal;
    let messages = await evaluate(ctx, 'buildMessagesForAPI()'); assert.strictEqual(messages.length, 2); assert.match(messages[1].content, /SCC/);
    messages = await ctx.buildMessagesForAPI([{ role: 'user', content: 'GCC Clause 50' }]); assert.match(messages[1].content, /GCC/); assert.ok(messages.retrievalEvidence.clauses.some(row => api.identity(row) === 'GCC:50'));
    console.log('Retrieval regression tests passed (typed IDs, source relations, context, hybrid retrieval, stale/legacy vectors, rerank body/zero/invalid results, quotes, build metadata)');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
