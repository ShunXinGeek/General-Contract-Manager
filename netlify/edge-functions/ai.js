// Credentials and chat content are transient: never log, store, or cache them.
import { resolveEndpoint, validateEndpoint, profileTimeout } from './ai-providers.js';
export { validateEndpoint };

const MAX_BYTES = 2 * 1024 * 1024;
const HEADERS = { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const failure = (status, message) => Response.json({ error: { message } }, { status, headers: HEADERS });
async function readJSON(request) {
    const reader = request.body?.getReader(); if (!reader) throw new Error('json');
    const decoder = new TextDecoder(); let size = 0, text = '';
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw new Error('size'); } text += decoder.decode(value, { stream: true }); }
        return JSON.parse(text + decoder.decode());
    } finally { reader.releaseLock(); }
}
function statusMessage(status) {
    return ({ 400: 'AI 请求参数不受支持，请检查模型名称和思考模式。', 401: 'AI API Key 无效或已失效，请检查该模型的密钥。',
        402: 'AI 账户余额不足，请检查服务商账户。', 403: 'AI 服务拒绝访问，请检查模型权限、地域及账户状态。',
        404: 'AI 服务未找到接口或模型，请检查接口地址和模型名称。', 429: 'AI 服务限流或额度不足，请稍后手动重试。' })[status] ||
        'AI 服务暂时不可用（HTTP ' + status + '），请稍后手动重试。';
}
async function providerError(upstream) {
    if (![400, 404, 422].includes(upstream.status) || !upstream.body || !(upstream.headers.get('content-type') || '').includes('application/json')) { await upstream.body?.cancel(); return statusMessage(upstream.status); }
    const reader = upstream.body.getReader(), decoder = new TextDecoder(); let text = '', bytes = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength;
        if (bytes > 16384) return statusMessage(upstream.status); text += decoder.decode(value, { stream: true }); }
        const data = JSON.parse(text + decoder.decode()), error = data.error && typeof data.error === 'object' ? data.error : data;
        const diagnostic = [error.code, error.type, error.message].filter(v => typeof v === 'string').join(' ').toLowerCase();
        if (/model[_ .-]?(?:not[_ .-]?(?:found|exist)|does[_ .-]?not[_ .-]?exist)|invalid[_ .-]?model|unsupported[_ .-]?model|模型不存在/.test(diagnostic)) return 'AI 服务商未找到此模型，请检查设置中的 Model 字段是否为当前有效的官方模型 ID。';
        if (/context[_ .-]?length|maximum context|token limit|上下文.*(?:超|限)/.test(diagnostic)) return 'AI 请求超过模型上下文长度，请减少历史消息或引用条款。';
        const fields = ['thinking', 'enable_thinking', 'reasoning_effort', 'temperature', 'max_tokens', 'messages', 'stream'].filter(field => new RegExp('\\b' + field + '\\b').test(diagnostic));
        return fields.length ? 'AI 服务商拒绝请求参数（' + fields.join('、') + '），请核对该模型的参数要求。' : statusMessage(upstream.status);
    } catch (_) { return statusMessage(upstream.status); }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function validMessage(m) { return m && ['system', 'developer', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string' && (m.reasoning_content === undefined || typeof m.reasoning_content === 'string'); }
function validBody(body) { return body && typeof body.model === 'string' && body.model.trim() && body.model.length <= 200 && Array.isArray(body.messages) && body.messages.length && body.messages.every(validMessage) && typeof body.stream === 'boolean' && (!body.apiStyle || body.apiStyle === 'responses'); }
function chatRequest(body) {
    const outgoing = { model: body.model, messages: body.messages.map(m => ({ role: m.role, content: m.content, ...(typeof m.reasoning_content === 'string' ? { reasoning_content: m.reasoning_content } : {}) })), stream: body.stream };
    if (typeof body.enable_thinking === 'boolean') outgoing.enable_thinking = body.enable_thinking;
    if (['enabled', 'disabled'].includes(body.thinking?.type)) outgoing.thinking = { type: body.thinking.type };
    if (['none', 'low', 'medium', 'high'].includes(body.reasoning_effort)) outgoing.reasoning_effort = body.reasoning_effort;
    if (Number.isFinite(body.temperature) && body.temperature >= 0 && body.temperature <= 2) outgoing.temperature = body.temperature;
    if (Number.isInteger(body.max_tokens) && body.max_tokens > 0 && body.max_tokens <= 393216) outgoing.max_tokens = body.max_tokens;
    return outgoing;
}
function responsesRequest(body) {
    const outgoing = { model: body.model, stream: body.stream, input: body.messages.map(m => ({ role: m.role, content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }] })) };
    if (['none', 'low', 'medium', 'high'].includes(body.reasoning_effort)) outgoing.reasoning = { effort: body.reasoning_effort };
    return outgoing;
}
function responseText(data) { return typeof data.output_text === 'string' ? data.output_text : (data.output || []).flatMap(item => item.content || []).map(item => item.text || '').join(''); }
function responsesStream(stream) {
    const decoder = new TextDecoder(), encoder = new TextEncoder(); let buffer = '';
    const emit = (controller, data) => controller.enqueue(encoder.encode('data: ' + JSON.stringify(data) + '\n\n'));
    const consume = (controller, block) => {
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if (!data || data === '[DONE]') return;
        let event; try { event = JSON.parse(data); } catch (_) { return; }
        if (event.type === 'response.output_text.delta') emit(controller, { choices: [{ delta: { content: event.delta || '' } }] });
        else if (event.type === 'response.reasoning_text.delta') emit(controller, { choices: [{ delta: { reasoning_content: event.delta || '' } }] });
        else if (event.type === 'response.completed') { emit(controller, { choices: [{ delta: {}, finish_reason: 'stop' }] }); controller.enqueue(encoder.encode('data: [DONE]\n\n')); }
        else if (event.type === 'error' || event.error) emit(controller, { error: { message: 'upstream error' } });
    };
    return new TransformStream({ transform(chunk, controller) { buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n'); let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) { consume(controller, buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); } }, flush(controller) { buffer += decoder.decode(); if (buffer) consume(controller, buffer); } });
}
export default async function handler(request) {
    if (request.method !== 'POST') return failure(405, 'AI 转发接口只接受 POST 请求。');
    const origin = request.headers.get('origin'); if (!origin || origin !== new URL(request.url).origin) return failure(403, '只允许本站页面调用 AI 接口。');
    if (!(request.headers.get('content-type') || '').includes('application/json')) return failure(415, '请使用 JSON 请求。');
    let payload, target; try { payload = await readJSON(request); } catch (error) { return failure(error.message === 'size' ? 413 : 400, error.message === 'size' ? 'AI 请求过大，请减少历史消息或引用条款。' : 'AI 请求内容无效。'); }
    try { target = resolveEndpoint(payload.endpoint, payload.profile || {}); } catch (_) { return failure(400, '此接口地址未获允许，请使用支持的服务商官方聊天接口，或由部署者精确授权自定义地址。'); }
    const body = payload.body, key = payload.apiKey;
    if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\r\n]/.test(key) || !validBody(body)) return failure(400, 'AI 模型、密钥或消息配置不完整。');
    if (body.apiStyle === 'responses' && target.protocol !== 'openai-responses') return failure(400, '该供应商未配置 Responses 协议。');
    const outgoing = body.apiStyle === 'responses' ? responsesRequest(body) : chatRequest(body);
    const controller = new AbortController(), cancel = () => controller.abort(); request.signal.addEventListener('abort', cancel, { once: true }); if (request.signal.aborted) cancel();
    const connectTimeout = profileTimeout(payload.profile, 'connectTimeoutMs', 30000, 120000), idleTimeout = profileTimeout(payload.profile, 'idleTimeoutMs', 120000, 300000);
    let timer = setTimeout(cancel, connectTimeout), totalTimer; const cleanup = () => { clearTimeout(timer); clearTimeout(totalTimer); request.signal.removeEventListener('abort', cancel); };
    try {
        const upstream = await fetch(target.url, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key.trim() }, body: JSON.stringify(outgoing) });
        if (!upstream.ok) { const message = await providerError(upstream); cleanup(); return failure(upstream.status, message); }
        const type = upstream.headers.get('content-type') || '';
        if (!upstream.body || (body.stream ? !type.includes('text/event-stream') : !type.includes('application/json'))) { await upstream.body?.cancel(); cleanup(); return failure(502, 'AI 服务返回格式不兼容，请检查所选协议。'); }
        clearTimeout(timer); totalTimer = setTimeout(cancel, 15 * 60 * 1000); timer = setTimeout(cancel, idleTimeout);
        if (!body.stream) { if (body.apiStyle !== 'responses') { cleanup(); return new Response(upstream.body, { headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' } }); }
            const data = await upstream.json(); cleanup(); return Response.json({ choices: [{ message: { content: responseText(data) } }] }, { headers: HEADERS }); }
        const source = body.apiStyle === 'responses' ? upstream.body.pipeThrough(responsesStream()) : upstream.body, reader = source.getReader(); let bytes = 0;
        const stream = new ReadableStream({ async pull(destination) { try { const { value, done } = await reader.read(); if (done) { cleanup(); reader.releaseLock(); destination.close(); return; }
            bytes += value.byteLength; if (bytes > 20 * 1024 * 1024) throw new Error('response size'); clearTimeout(timer); timer = setTimeout(cancel, idleTimeout); destination.enqueue(value);
        } catch (_) { cleanup(); cancel(); await reader.cancel().catch(() => {}); destination.error(new Error('AI 响应连接中断或超时。')); } }, async cancel() { cleanup(); controller.abort(); await reader.cancel().catch(() => {}); } });
        return new Response(stream, { headers: { ...HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8' } });
    } catch (_) { cleanup(); return failure(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? '连接 AI 服务超时，请稍后手动重试。' : 'Netlify 无法连接 AI 服务，请检查接口或稍后手动重试。'); }
}
export const config = { path: '/api/ai', rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
