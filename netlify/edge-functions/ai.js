// Credentials and chat content are transient: never log, store, or cache them.
const PROVIDERS = {
    'api.deepseek.com': ['/chat/completions', '/v1/chat/completions'],
    'dashscope.aliyuncs.com': ['/compatible-mode/v1/chat/completions'],
    'dashscope-intl.aliyuncs.com': ['/compatible-mode/v1/chat/completions'],
    'dashscope-us.aliyuncs.com': ['/compatible-mode/v1/chat/completions'],
    'cn-hongkong.dashscope.aliyuncs.com': ['/compatible-mode/v1/chat/completions'],
    'open.bigmodel.cn': ['/api/paas/v4/chat/completions'],
    'api.moonshot.cn': ['/v1/chat/completions'],
    'api.moonshot.ai': ['/v1/chat/completions'],
    'api.openai.com': ['/v1/chat/completions']
};
const MAX_BYTES = 2 * 1024 * 1024;
const HEADERS = { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function failure(status, message) {
    return Response.json({ error: { message } }, { status, headers: HEADERS });
}
export function validateEndpoint(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) throw new Error('endpoint');
    const workspace = /^[a-z0-9-]+\.(?:cn-beijing|cn-hongkong|ap-southeast-1|ap-northeast-1|eu-central-1|us-east-1)\.maas\.aliyuncs\.com$/.test(url.hostname);
    if (!(PROVIDERS[url.hostname]?.includes(url.pathname) || (workspace && url.pathname === '/compatible-mode/v1/chat/completions'))) throw new Error('endpoint');
    return url.href;
}
async function readJSON(request) {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('json');
    const decoder = new TextDecoder();
    let size = 0, text = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) { await reader.cancel(); throw new Error('size'); }
            text += decoder.decode(value, { stream: true });
        }
        return JSON.parse(text + decoder.decode());
    } finally { reader.releaseLock(); }
}
function statusMessage(status) {
    return ({ 400: 'AI 请求参数不受支持，请检查模型名称和思考模式。',
        401: 'AI API Key 无效或已失效，请检查该模型的密钥。',
        402: 'AI 账户余额不足，请检查服务商账户。',
        403: 'AI 服务拒绝访问，请检查模型权限、地域及账户状态。',
        404: 'AI 服务未找到接口或模型，请检查接口地址和模型名称。',
        429: 'AI 服务限流或额度不足，请稍后手动重试。' })[status] || 'AI 服务暂时不可用（HTTP ' + status + '），请稍后手动重试。';
}
export default async function handler(request) {
    if (request.method !== 'POST') return failure(405, 'AI 转发接口只接受 POST 请求。');
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) return failure(403, '只允许本站页面调用 AI 接口。');
    if (!(request.headers.get('content-type') || '').includes('application/json')) return failure(415, '请使用 JSON 请求。');
    let payload, target;
    try { payload = await readJSON(request); } catch (error) {
        return failure(error.message === 'size' ? 413 : 400, error.message === 'size' ? 'AI 请求过大，请减少历史消息或引用条款。' : 'AI 请求内容无效。');
    }
    try { target = validateEndpoint(payload.endpoint); } catch (_) { return failure(400, '此接口地址未获允许，请使用支持的服务商官方聊天接口。'); }
    const body = payload.body, key = payload.apiKey;
    if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\r\n]/.test(key) || !body ||
        typeof body.model !== 'string' || !body.model.trim() || body.model.length > 200 ||
        !Array.isArray(body.messages) || !body.messages.length ||
        body.messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string' ||
            (m.reasoning_content !== undefined && typeof m.reasoning_content !== 'string')) || typeof body.stream !== 'boolean') {
        return failure(400, 'AI 模型、密钥或消息配置不完整。');
    }
    const outgoing = { model: body.model, messages: body.messages.map(m => ({ role: m.role, content: m.content,
        ...(typeof m.reasoning_content === 'string' ? { reasoning_content: m.reasoning_content } : {}) })), stream: body.stream };
    if (typeof body.enable_thinking === 'boolean') outgoing.enable_thinking = body.enable_thinking;
    if (['enabled', 'disabled'].includes(body.thinking?.type)) outgoing.thinking = { type: body.thinking.type };
    if (Number.isFinite(body.temperature) && body.temperature >= 0 && body.temperature <= 2) outgoing.temperature = body.temperature;
    if (Number.isInteger(body.max_tokens) && body.max_tokens > 0 && body.max_tokens <= 393216) outgoing.max_tokens = body.max_tokens;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    request.signal.addEventListener('abort', cancel, { once: true });
    if (request.signal.aborted) cancel();
    let timer = setTimeout(cancel, 30000), totalTimer;
    function cleanup() {
        clearTimeout(timer); clearTimeout(totalTimer);
        request.signal.removeEventListener('abort', cancel);
    }
    try {
        const upstream = await fetch(target, { method: 'POST', redirect: 'error', signal: controller.signal,
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key.trim() }, body: JSON.stringify(outgoing) });
        if (!upstream.ok) {
            await upstream.body?.cancel(); cleanup();
            return failure(upstream.status, statusMessage(upstream.status));
        }
        const type = upstream.headers.get('content-type') || '';
        if (!upstream.body || (body.stream ? !type.includes('text/event-stream') : !type.includes('application/json'))) {
            await upstream.body?.cancel(); cleanup();
            return failure(502, 'AI 服务返回格式不兼容，请使用 OpenAI 兼容聊天接口。');
        }
        clearTimeout(timer);
        totalTimer = setTimeout(cancel, 15 * 60 * 1000);
        timer = setTimeout(cancel, 120000);
        const reader = upstream.body.getReader();
        let bytes = 0;
        const stream = new ReadableStream({
            async pull(destination) {
                try {
                    const { value, done } = await reader.read();
                    if (done) { cleanup(); reader.releaseLock(); destination.close(); return; }
                    bytes += value.byteLength;
                    if (bytes > 20 * 1024 * 1024) throw new Error('response size');
                    clearTimeout(timer); timer = setTimeout(cancel, 120000);
                    destination.enqueue(value);
                } catch (_) { cleanup(); cancel(); await reader.cancel().catch(() => {}); destination.error(new Error('AI 响应连接中断或超时。')); }
            },
            async cancel() { cleanup(); controller.abort(); await reader.cancel().catch(() => {}); }
        });
        return new Response(stream, { headers: { ...HEADERS, 'Content-Type': body.stream ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8' } });
    } catch (_) {
        cleanup();
        return failure(controller.signal.aborted ? 504 : 502, controller.signal.aborted
            ? '连接 AI 服务超时，请稍后手动重试。' : 'Netlify 无法连接 AI 服务，请检查接口或稍后手动重试。');
    }
}
export const config = {
    path: '/api/ai',
    rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
