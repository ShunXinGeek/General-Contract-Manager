const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const root = path.join(__dirname, '..');
const context = { URL, Response, DOMException, AbortController, TextDecoder, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/ai-providers.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/ai-client.js'), 'utf8'), context);
const client = context.AIClient;
const messages = [{ role: 'user', content: 'test' }];
function body(endpoint, model, thinking = false, extra = {}) {
    return client.requestBody({ apiEndpoint: endpoint, model }, messages, { thinking, ...extra });
}
async function run() {
    const { default: handler, validateEndpoint } = await import(pathToFileURL(path.join(root, 'netlify/edge-functions/ai.js')));
    const cases = [
        ['https://api.deepseek.com/v1', 'deepseek-v4-pro', 'deepseek', 'thinking'],
        ['https://dashscope.aliyuncs.com', 'qwen3-32b', 'qwen', 'enable_thinking'],
        ['https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'qwen-plus', 'qwen-intl', 'enable_thinking'],
        ['https://dashscope-us.aliyuncs.com/compatible-mode/v1', 'qwen3.5-plus', 'qwen-us', 'enable_thinking'],
        ['https://workspace123.cn-beijing.maas.aliyuncs.com', 'qwen-plus', 'qwen', 'enable_thinking'],
        ['https://open.bigmodel.cn', 'glm-4.7', 'zhipu', 'thinking'],
        ['https://api.moonshot.cn/v1', 'kimi-k2.5', 'kimi-cn', 'thinking'],
        ['https://api.moonshot.ai/v1', 'kimi-k2.6', 'kimi-global', 'thinking']
    ];
    for (const [url, model, provider, field] of cases) {
        assert.strictEqual(client.provider(url), provider);
        assert.ok(validateEndpoint(client.endpoint(url)).endsWith('/chat/completions'));
        const on = body(url, model, true), off = body(url, model, false);
        assert.deepStrictEqual(JSON.parse(JSON.stringify(on[field])), field === 'thinking' ? { type: 'enabled' } : true);
        assert.deepStrictEqual(JSON.parse(JSON.stringify(off[field])), field === 'thinking' ? { type: 'disabled' } : false);
        assert.ok(!(field === 'thinking' ? 'enable_thinking' in on : 'thinking' in on));
    }
    const gemini = body('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-flash', true);
    assert.strictEqual(client.provider('https://generativelanguage.googleapis.com/v1beta/openai'), 'gemini');
    assert.strictEqual(gemini.reasoning_effort, 'medium');
    assert.ok(validateEndpoint(client.endpoint('https://generativelanguage.googleapis.com/v1beta/openai')).endsWith('/chat/completions'));
    assert.strictEqual(client.instructionRole({ apiEndpoint: 'https://api.openai.com/v1', model: 'gpt-5-mini' }), 'developer');
    assert.ok(client.endpoint({ apiEndpoint: 'https://api.openai.com/v1', protocol: 'openai-responses' }).endsWith('/responses'));
    for (const [url, model] of [['https://api.deepseek.com', 'deepseek-chat'], ['https://open.bigmodel.cn', 'glm-4'],
        ['https://api.moonshot.cn', 'moonshot-v1-8k'], ['https://dashscope.aliyuncs.com', 'qwen-max']]) {
        const b = body(url, model, true);
        assert.ok(!('thinking' in b) && !('enable_thinking' in b), 'legacy models must not receive unsupported fields');
    }
    for (const model of ['kimi-k2-thinking', 'kimi-k2.7-code', 'kimi-k3']) {
        assert.strictEqual(client.thinkingCapability('https://api.moonshot.ai', model), 'always');
        const b = body('https://api.moonshot.ai', model, false, { classify: true });
        assert.ok(!('thinking' in b) && !('temperature' in b) && !('max_tokens' in b));
    }
    assert.ok(client.needsReasoningHistory('https://api.moonshot.ai', 'kimi-k3'));
    assert.ok(!client.needsReasoningHistory('https://api.deepseek.com', 'deepseek-v4-pro'));
    for (const url of ['http://api.deepseek.com/v1/chat/completions', 'https://api.deepseek.com.evil.test/v1/chat/completions',
        'https://127.0.0.1/v1/chat/completions', 'https://api.deepseek.com:444/v1/chat/completions',
        'https://user:pass@api.deepseek.com/v1/chat/completions', 'https://api.deepseek.com/v1/embeddings',
        'https://api.deepseek.com/v1/chat/completions?key=secret', 'https://evil.aliyuncs.com/compatible-mode/v1/chat/completions']) {
        assert.throws(() => validateEndpoint(url));
    }
    const origin = 'https://example.netlify.app';
    const payload = { endpoint: client.endpoint('https://api.deepseek.com'), apiKey: 'test-only-key',
        body: body('https://api.deepseek.com', 'deepseek-v4-pro', false) };
    function request(p = payload, headers = {}) {
        return new Request(origin + '/api/ai', { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(p) });
    }
    const originalFetch = global.fetch;
    let called = 0, signal, canceled = false;
    global.fetch = async (url, options) => {
        called++; signal = options.signal;
        assert.strictEqual(url, payload.endpoint);
        assert.strictEqual(options.redirect, 'error');
        assert.strictEqual(options.headers.Authorization, 'Bearer test-only-key');
        const upstream = JSON.parse(options.body);
        assert.ok(!('apiKey' in upstream) && !('endpoint' in upstream));
        const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\n\n');
        return new Response(new ReadableStream({ start(c) { c.enqueue(bytes); }, cancel() { canceled = true; } }),
            { headers: { 'content-type': 'text/event-stream' } });
    };
    try {
        assert.strictEqual((await handler(new Request(origin + '/api/ai'))).status, 405);
        assert.strictEqual((await handler(request(payload, { origin: 'https://evil.test' }))).status, 403);
        assert.strictEqual((await handler(request({ ...payload, endpoint: 'https://127.0.0.1/v1/chat/completions' }))).status, 400);
        assert.strictEqual((await handler(request({ ...payload, apiKey: '' }))).status, 400);
        assert.strictEqual((await handler(request({ ...payload, body: { ...payload.body, messages: [{ role: 'invalid', content: '' }] } }))).status, 400);
        assert.strictEqual((await handler(request({ ...payload, body: { ...payload.body, messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }] } }))).status, 413);
        assert.strictEqual(called, 0, 'invalid requests must not reach a provider');
        const r = await handler(request());
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.headers.get('cache-control'), 'no-store');
        const output = [];
        for await (const event of client.events(r)) output.push(event.choices[0].delta.content);
        assert.deepStrictEqual(output, ['你好']);
        assert.ok(canceled && signal.aborted, 'completion/cancel must cancel the upstream');
        for (const status of [400, 401, 402, 403, 404, 429, 500]) {
            global.fetch = async () => new Response('sensitive upstream diagnostics', { status });
            const r = await handler(request());
            assert.strictEqual(r.status, status);
            assert.ok(!(await r.text()).includes('sensitive'), 'do not leak upstream response contents');
        }
        for (const [diagnostic, expected] of [
            [{ error: { message: 'Model Not Exist', code: 'model_not_found' } }, /Model 字段/],
            [{ error: { message: 'Invalid model ID' } }, /Model 字段/],
            [{ code: 'InvalidParameter', message: 'enable_thinking is unsupported: secret request contents' }, /enable_thinking/],
            [{ error: { code: 'context_length_exceeded', message: 'secret prompt' } }, /上下文长度/]
        ]) {
            global.fetch = async () => Response.json(diagnostic, { status: 400 });
            const r = await handler(request());
            assert.strictEqual(r.status, 400);
            const text = await r.text();
            assert.match(text, expected);
            assert.ok(!text.includes('secret'), 'diagnostics must not echo secrets or prompts');
        }
        global.fetch = async () => Response.json({ error: { message: 'secret request ' + 'x'.repeat(17000) } }, { status: 400 });
        assert.ok(!(await (await handler(request())).text()).includes('secret'), 'oversized diagnostics must be discarded');
        global.fetch = async () => { throw new Error('secret connection diagnostic'); };
        assert.strictEqual((await handler(request())).status, 502);
        global.fetch = async () => new Response('HTML', { headers: { 'content-type': 'text/html' } });
        assert.strictEqual((await handler(request())).status, 502);
        global.fetch = async () => new Response('{"choices":[]}', { headers: { 'content-type': 'application/json' } });
        const nonStream = await handler(request({ ...payload, body: { ...payload.body, stream: false } }));
        assert.strictEqual(nonStream.status, 200);
        assert.deepStrictEqual(await nonStream.json(), { choices: [] });
        let canceledByUser = false;
        global.fetch = async (_, options) => {
            options.signal.addEventListener('abort', () => { canceledByUser = true; });
            return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(': ping\n\n')); } }),
                { headers: { 'content-type': 'text/event-stream' } });
        };
        const cancelResponse = await handler(request());
        const cancelReader = cancelResponse.body.getReader();
        await cancelReader.read(); await cancelReader.cancel();
        assert.ok(canceledByUser);
    } finally { global.fetch = originalFetch; }
    // Responses protocol is converted at the gateway so the browser continues to consume one SSE shape.
    global.fetch = async (url, options) => {
        assert.strictEqual(url, 'https://api.openai.com/v1/responses');
        const outgoing = JSON.parse(options.body);
        assert.ok(Array.isArray(outgoing.input) && !outgoing.messages);
        return new Response('data: {"type":"response.output_text.delta","delta":"OK"}\n\ndata: {"type":"response.completed"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    };
    try {
        const responsePayload = { endpoint: 'https://api.openai.com/v1/responses', apiKey: 'test-only-key',
            profile: { providerId: 'openai', protocol: 'openai-responses' }, body: { model: 'gpt-5-mini', messages, stream: true, apiStyle: 'responses' } };
        const output = [];
        for await (const event of client.events(await handler(request(responsePayload)))) {
            if (event.choices?.[0]?.delta?.content) output.push(event.choices[0].delta.content);
        }
        assert.deepStrictEqual(output, ['OK']);
    } finally { global.fetch = originalFetch; }
    // Test SSE across arbitrary UTF-8/network boundaries, missing final newline, heartbeat and usage events.
    const raw = ': keep-alive\r\n\r\ndata: {"choices":[{"delta":{"reasoning_content":"想","content":"答"}}]}\r\n\r\ndata: {"choices":[]}\n\ndata: [DONE]';
    const bytes = new TextEncoder().encode(raw);
    const split = new Response(new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(Uint8Array.of(b)); c.close(); } }));
    const events = [];
    for await (const event of client.events(split)) events.push(event);
    assert.strictEqual(events[0].choices[0].delta.reasoning_content, '想');
    assert.strictEqual(events[0].choices[0].delta.content, '答');
    assert.strictEqual(events.length, 2);
    for (const text of ['data: {"error":{"message":"secret"}}\n\n', 'data: broken\n\n', 'data: {"choices":[]}\n\n']) {
        await assert.rejects(async () => { for await (const _ of client.events(new Response(text))) {} });
    }
    let browserRequest;
    context.fetch = async (url, options) => {
        browserRequest = { url, options };
        return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    };
    const config = { apiEndpoint: 'https://api.deepseek.com/v1', apiKey: 'test-only-key', model: 'deepseek-v4-pro' };
    const response = await client.request(config, messages, { thinking: false });
    for await (const _ of client.events(response)) {}
    assert.strictEqual(browserRequest.url, '/api/ai');
    assert.ok(!browserRequest.options.headers.Authorization, 'provider key must not become the site Authorization header');
    assert.strictEqual(JSON.parse(browserRequest.options.body).endpoint, payload.endpoint);
    context.fetch = async () => new Response('HTML 404', { status: 404 });
    await assert.rejects(client.request(config, messages), /尚未部署/);
    context.fetch = async () => new Response(JSON.stringify({ error: { message: 'API Key 无效' } }), { status: 401, headers: { 'content-type': 'application/json' } });
    await assert.rejects(client.request(config, messages), /API Key 无效/);
    const abort = new AbortController(); abort.abort();
    context.fetch = async (_, options) => { throw new DOMException('aborted', 'AbortError'); };
    await assert.rejects(client.request(config, messages, { signal: abort.signal }), { name: 'AbortError' });
    console.log('AI transport tests passed (providers, legacy/fixed thinking, endpoint restrictions, streaming, cancellation, error handling)');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
