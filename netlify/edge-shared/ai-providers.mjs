// Public provider contract shared by the controlled AI Gateway. This module
// contains no credentials and never turns the gateway into an arbitrary proxy.
const BUILTIN = Object.freeze({
    openai: { hosts: ['api.openai.com'], paths: ['/v1/chat/completions', '/v1/responses'] },
    zhipu: { hosts: ['open.bigmodel.cn'], paths: ['/api/paas/v4/chat/completions'] },
    'kimi-cn': { hosts: ['api.moonshot.cn'], paths: ['/v1/chat/completions'] },
    'kimi-global': { hosts: ['api.moonshot.ai'], paths: ['/v1/chat/completions'] },
    deepseek: { hosts: ['api.deepseek.com'], paths: ['/v1/chat/completions', '/chat/completions'] },
    qwen: { hosts: ['dashscope.aliyuncs.com', 'cn-hongkong.dashscope.aliyuncs.com'], paths: ['/compatible-mode/v1/chat/completions'] },
    'qwen-intl': { hosts: ['dashscope-intl.aliyuncs.com'], paths: ['/compatible-mode/v1/chat/completions'] },
    'qwen-us': { hosts: ['dashscope-us.aliyuncs.com'], paths: ['/compatible-mode/v1/chat/completions'] },
    gemini: { hosts: ['generativelanguage.googleapis.com'], paths: ['/v1beta/openai/chat/completions'] }
});
function env(name) { try { return typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined; } catch (_) { return undefined; } }
function customRules() {
    const raw = env('AI_ALLOWED_ENDPOINTS');
    if (!raw) return [];
    try {
        const items = JSON.parse(raw);
        return Array.isArray(items) ? items.filter(item => item && typeof item.hostname === 'string' && typeof item.pathPrefix === 'string').map(item => ({
            hostname: item.hostname.toLowerCase(), port: item.port == null ? '' : String(item.port),
            pathPrefix: item.pathPrefix.replace(/\/+$/, '') || '/', protocol: item.protocol === 'openai-responses' ? 'openai-responses' : 'openai-chat'
        })) : [];
    } catch (_) { return []; }
}
function parse(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('endpoint');
    return url;
}
function workspaceQwen(host) { return /^[a-z0-9-]+\.(?:cn-beijing|cn-hongkong|ap-southeast-1|ap-northeast-1|eu-central-1|us-east-1)\.maas\.aliyuncs\.com$/.test(host); }
export function resolveEndpoint(value, profile = {}) {
    const url = parse(value), host = url.hostname.toLowerCase();
    for (const [providerId, descriptor] of Object.entries(BUILTIN)) {
        if (descriptor.hosts.includes(host) && !url.port && descriptor.paths.includes(url.pathname)) {
            if (profile.providerId && profile.providerId !== providerId) throw new Error('provider mismatch');
            const isResponses = providerId === 'openai' && url.pathname === '/v1/responses';
            if ((profile.protocol === 'openai-responses') !== isResponses && (profile.protocol === 'openai-responses' || isResponses)) throw new Error('protocol');
            return { url: url.href, providerId, protocol: isResponses ? 'openai-responses' : (profile.protocol || (providerId === 'gemini' ? 'gemini-openai' : 'openai-chat')) };
        }
    }
    if (!url.port && workspaceQwen(host) && url.pathname === '/compatible-mode/v1/chat/completions') {
        if (profile.providerId && profile.providerId !== 'qwen') throw new Error('provider mismatch');
        return { url: url.href, providerId: 'qwen', protocol: 'openai-chat' };
    }
    for (const rule of customRules()) {
        if (host === rule.hostname && url.port === rule.port && url.pathname === rule.pathPrefix + '/chat/completions') {
            if (profile.providerId && profile.providerId !== 'custom') throw new Error('provider mismatch');
            if (profile.protocol && profile.protocol !== rule.protocol) throw new Error('protocol');
            return { url: url.href, providerId: 'custom', protocol: rule.protocol };
        }
    }
    throw new Error('endpoint');
}
export function validateEndpoint(value) { return resolveEndpoint(value).url; }
export function profileTimeout(value, key, fallback, maximum) {
    const number = Number(value?.[key]);
    return Number.isFinite(number) ? Math.max(5000, Math.min(maximum, Math.round(number))) : fallback;
}
