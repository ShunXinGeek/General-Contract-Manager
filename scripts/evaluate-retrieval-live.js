// Opt-in bounded live comparison; private caller configuration is never reported.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { pathToFileURL } = require('url');
const { context, evaluate, root, baselineRevision } = require('../tests/helpers/retrieval-context');
const cases = require('../tests/fixtures/retrieval-cases.json');
async function run() {
    const argument = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
    const configPath = argument('--config') || process.env.GCM_EVAL_CONFIG;
    if (!configPath) { console.log(JSON.stringify({ status: 'not-run', reason: 'No caller-provided live configuration; source defaults contain no credentials', liveQualityVerified: false })); return; }
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.apiEndpoint || !config.apiKey || !config.model) throw new Error('Incomplete private configuration');
    if (!process.argv.includes('--execute')) { console.log(JSON.stringify({ status: 'ready-not-executed', liveQualityVerified: false })); return; }
    const records = argument('--index') ? JSON.parse(fs.readFileSync(argument('--index'), 'utf8')) : [];
    const { default: handler } = await import(pathToFileURL(path.join(root, 'netlify/edge-functions/ai.js')));
    const realFetch = global.fetch; let calls = 0; const cap = 160;
    const invoke = async (url, options) => {
        if (++calls > cap) throw new Error('Evaluation call limit');
        if (url === '/api/ai') return handler(new Request('https://gcm-eval.local/api/ai', { method: 'POST', headers: { origin: 'https://gcm-eval.local', 'content-type': 'application/json' }, body: options.body, signal: options.signal }));
        return realFetch(url, options);
    };
    const contexts = {};
    for (const mode of ['baseline', 'candidate']) {
        const ctx = context({ baseline: mode === 'baseline' }); contexts[mode] = ctx;
        if (mode === 'baseline') for (const file of ['retrieval-source', 'ai-retrieval']) vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), ctx);
        for (const file of ['ai-client', 'rag']) vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), ctx);
        ctx.fetch = invoke; ctx.privateConfig = config; evaluate(ctx, 'Object.assign(AI_CONFIG, privateConfig)'); delete ctx.privateConfig;
        ctx.RAG.readRecords = async () => records;
        if (mode === 'baseline') {
            // Preserve old title-only reranking for the comparator.
            const rerank = ctx.RAG.rerank.bind(ctx.RAG);
            ctx.RAG.rerank = (query, rows, settings, n) => rerank(query, rows.map(row => ({ ...row, content: '' })), settings, n);
            ctx.RAG.findMostRelevant = async (query, settings, n) => {
                if (!records.length) throw new Error('No semantic index supplied');
                const embedding = ctx.RAG.getEmbeddingConfig(settings); if (!embedding) throw new Error('No embedding configuration');
                const vector = await ctx.RAG.getEmbedding(query, embedding.apiKey, embedding.apiEndpoint, embedding.model);
                return records.map(item => ({ ...item, score: ctx.RAG.cosineSimilarity(vector, item.vector) })).filter(item => item.score !== null).sort((a, b) => b.score - a.score).slice(0, n);
            };
        }
    }
    const heldout = cases.filter((_, i) => i % 2 === 1), answerIds = new Set(), counts = {};
    heldout.forEach(item => { counts[item.category] = (counts[item.category] || 0) + 1; if (counts[item.category] <= 2) answerIds.add(item.id); });
    const report = { baselineRevision, scope: records.length ? 'live with identical supplied vectors; legacy validity differences disclosed' : 'live chat/classification only; semantic quality unassessed',
        liveQualityVerified: false, semanticIndexSupplied: !!records.length, reviewRequired: true, cases: [] };
    outer: for (const item of heldout) for (const mode of ['baseline', 'candidate']) {
        if (calls >= cap) break outer;
        const ctx = contexts[mode]; ctx.chatMessages = [...(item.history || []).map(content => ({ role: 'user', content })), { role: 'user', content: item.query }];
        ctx.query = item.query; const start = Date.now(), before = calls;
        try {
            const rows = await evaluate(ctx, 'findRelevantClauses(query)'), returned = rows.map(row => ctx.AIRetrieval.identity(row));
            const result = { id: item.id, mode, required: item.required, returned, hits: item.required.filter(id => returned.includes(id)).length };
            if (answerIds.has(item.id)) {
                const messages = [{ role: 'system', content: ctx.buildDatabaseModePrompt(rows) }, ...ctx.chatMessages];
                const evidence = mode === 'candidate' ? evaluate(ctx, 'lastRetrievalEvidence') : null;
                const data = await (await ctx.AIClient.request(config, messages, { stream: false, thinking: true })).json();
                result.answer = data.choices?.[0]?.message?.content || ''; result.usage = data.usage || null;
                if (mode === 'candidate') {
                    result.validation = ctx.AIRetrieval.validate(result.answer, evidence, ctx.contracts);
                    if (!result.validation.passed && evidence.clauses.length && calls < cap) {
                        const repair = [...messages, { role: 'assistant', content: result.answer }, { role: 'user', content: '依据已提供原文修正这些引用问题并返回完整答案；无法修正说明缺口：' + result.validation.issues.join('；') }];
                        const fixed = await (await ctx.AIClient.request(config, repair, { stream: false, thinking: true })).json();
                        if (fixed.choices?.[0]?.message?.content) { result.originalAnswer = result.answer; result.answer = fixed.choices[0].message.content; result.validation = ctx.AIRetrieval.validate(result.answer, evidence, ctx.contracts); result.repaired = true; }
                    }
                }
                result.manualReview = { sourceSupport: null, factsSeparated: null, applicableModification: null, seriousError: null };
            }
            result.calls = calls - before; result.elapsedMs = Date.now() - start; report.cases.push(result);
        } catch (_) { report.cases.push({ id: item.id, mode, status: 'failed', calls: calls - before, elapsedMs: Date.now() - start }); }
    }
    report.calls = calls; report.finished = report.cases.length === heldout.length * 2;
    if (argument('--output')) fs.writeFileSync(argument('--output'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ finished: report.finished, cases: report.cases.length, calls, reviewRequired: true, liveQualityVerified: false }));
}
run().catch(() => { console.error('Live evaluation incomplete: check private configuration and supported endpoints. Credentials and provider diagnostics were not printed.'); process.exitCode = 1; });
