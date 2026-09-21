// Controlled proxy for embedding and rerank APIs. Keys never appear in browser
// request headers and only explicitly supported provider paths are accepted.
const MAX_BYTES = 2 * 1024 * 1024;
const HEADERS = { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const PATHS = Object.freeze({
    embedding: new Map([['api.openai.com', ['/v1/embeddings']], ['dashscope.aliyuncs.com', ['/compatible-mode/v1/embeddings']], ['dashscope-intl.aliyuncs.com', ['/compatible-mode/v1/embeddings']], ['dashscope-us.aliyuncs.com', ['/compatible-mode/v1/embeddings']]]),
    rerank: new Map([['dashscope.aliyuncs.com', ['/compatible-api/v1/reranks']], ['dashscope-intl.aliyuncs.com', ['/compatible-api/v1/reranks']], ['dashscope-us.aliyuncs.com', ['/compatible-api/v1/reranks']]])
});
const failure = (status, message) => Response.json({ error: { message } }, { status, headers: HEADERS });
function customRules() {
    try { const raw = typeof Deno !== 'undefined' ? Deno.env.get('AI_ALLOWED_RETRIEVAL_ENDPOINTS') : ''; const value = JSON.parse(raw || '[]');
        return Array.isArray(value) ? value.filter(item => item && ['embedding', 'rerank'].includes(item.kind) && typeof item.hostname === 'string' && typeof item.path === 'string') : [];
    } catch (_) { return []; }
}
function validateEndpoint(kind, value) {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('endpoint');
    if (!url.port && PATHS[kind]?.get(host)?.includes(url.pathname)) return url.href;
    if (customRules().some(rule => rule.kind === kind && host === rule.hostname.toLowerCase() && url.port === String(rule.port || '') && url.pathname === rule.path)) return url.href;
    throw new Error('endpoint');
}
async function body(request) {
    const reader = request.body?.getReader(); if (!reader) throw new Error('json'); const decoder = new TextDecoder(); let text = '', size = 0;
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) throw new Error('size'); text += decoder.decode(value, { stream: true }); }
        return JSON.parse(text + decoder.decode());
    } finally { reader.releaseLock(); }
}
function valid(kind, payload) {
    const input = payload?.body;
    if (!input || typeof input.model !== 'string' || !input.model.trim()) return false;
    if (kind === 'embedding') return typeof input.input === 'string' && input.input.length <= 200000;
    return typeof input.query === 'string' && Array.isArray(input.documents) && input.documents.length > 0 && input.documents.length <= 100 && input.documents.every(doc => typeof doc === 'string' && doc.length <= 50000) && Number.isInteger(input.top_n) && input.top_n > 0 && input.top_n <= 100;
}
export default async function handler(request) {
    if (request.method !== 'POST') return failure(405, '检索转发接口只接受 POST 请求。');
    const origin = request.headers.get('origin'); if (!origin || origin !== new URL(request.url).origin) return failure(403, '只允许本站页面调用检索接口。');
    if (!(request.headers.get('content-type') || '').includes('application/json')) return failure(415, '请使用 JSON 请求。');
    let payload; try { payload = await body(request); } catch (error) { return failure(error.message === 'size' ? 413 : 400, '检索请求内容无效。'); }
    const kind = payload.kind; if (!['embedding', 'rerank'].includes(kind) || typeof payload.apiKey !== 'string' || !payload.apiKey.trim() || payload.apiKey.length > 4096 || /[\r\n]/.test(payload.apiKey) || !valid(kind, payload)) return failure(400, '检索模型、密钥或参数配置不完整。');
    let endpoint; try { endpoint = validateEndpoint(kind, payload.endpoint); } catch (_) { return failure(400, '此检索接口地址未获允许，请使用支持的官方地址或由部署者精确授权。'); }
    const controller = new AbortController(), cancel = () => controller.abort(); request.signal.addEventListener('abort', cancel, { once: true }); const timer = setTimeout(cancel, 30000);
    try { const upstream = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + payload.apiKey.trim() }, body: JSON.stringify(payload.body) }); clearTimeout(timer);
        if (!upstream.ok) { await upstream.body?.cancel(); return failure(upstream.status, '检索服务请求失败（HTTP ' + upstream.status + '）。'); }
        if (!(upstream.headers.get('content-type') || '').includes('application/json')) { await upstream.body?.cancel(); return failure(502, '检索服务返回格式不兼容。'); }
        return new Response(upstream.body, { headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
    } catch (_) { return failure(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? '连接检索服务超时。' : '无法连接检索服务。'); }
    finally { clearTimeout(timer); request.signal.removeEventListener('abort', cancel); }
}
export const config = { path: '/api/retrieval', rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
