// =======================================================
// ai-providers.js - 模型供应商预设与配置契约（浏览器端纯函数）
// 不包含密钥传输、网络请求或部署端白名单；最终授权由 Edge Gateway 执行。
// =======================================================
(function (root) {
    'use strict';

    const CONFIG_VERSION = 3;
    const DEFAULT_CONNECT_TIMEOUT = 35000;
    const DEFAULT_IDLE_TIMEOUT = 120000;
    const MIN_TIMEOUT = 5000;
    const MAX_CONNECT_TIMEOUT = 120000;
    const MAX_IDLE_TIMEOUT = 300000;
    const PROTOCOLS = new Set(['openai-chat', 'openai-responses', 'gemini-openai']);
    const AUTH_TYPES = new Set(['bearer']);

    // 每个预设只描述公开、稳定的连接属性。密钥绝不放入预设或日志。
    const PRESETS = Object.freeze({
        openai: { label: 'OpenAI', protocol: 'openai-chat', authType: 'bearer', baseUrl: 'https://api.openai.com/v1' },
        zhipu: { label: '智谱 AI', protocol: 'openai-chat', authType: 'bearer', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
        'kimi-cn': { label: 'Kimi（中国）', protocol: 'openai-chat', authType: 'bearer', baseUrl: 'https://api.moonshot.cn/v1' },
        'kimi-global': { label: 'Kimi（国际）', protocol: 'openai-chat', authType: 'bearer', baseUrl: 'https://api.moonshot.ai/v1' },
        deepseek: { label: 'DeepSeek', protocol: 'openai-chat', authType: 'bearer', baseUrl: 'https://api.deepseek.com/v1' },
        qwen: { label: '通义千问（北京）', protocol: 'openai-chat', authType: 'bearer', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
        'qwen-intl': { label: '通义千问（新加坡）', protocol: 'openai-chat', authType: 'bearer', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
        'qwen-us': { label: '通义千问（美国）', protocol: 'openai-chat', authType: 'bearer', baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1' },
        gemini: { label: 'Gemini', protocol: 'gemini-openai', authType: 'bearer', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
        custom: { label: '自定义 OpenAI 兼容服务', protocol: 'openai-chat', authType: 'bearer', baseUrl: '' }
    });

    function clamp(value, fallback, maximum) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(MIN_TIMEOUT, Math.min(maximum, Math.round(number))) : fallback;
    }

    function cleanBaseUrl(value) {
        const url = new URL(String(value || '').trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
            throw new Error('AI 接口地址必须是完整 HTTPS 地址，且不能包含账号、查询参数或片段。');
        }
        url.pathname = url.pathname.replace(/\/+$/, '');
        return url.href.replace(/\/$/, '');
    }

    function inferProvider(value) {
        let host;
        try { host = new URL(String(value || '').trim()).hostname.toLowerCase(); } catch (_) { return 'custom'; }
        if (host === 'api.openai.com') return 'openai';
        if (host === 'open.bigmodel.cn') return 'zhipu';
        if (host === 'api.moonshot.cn') return 'kimi-cn';
        if (host === 'api.moonshot.ai') return 'kimi-global';
        if (host === 'api.deepseek.com') return 'deepseek';
        if (host === 'dashscope.aliyuncs.com') return 'qwen';
        if (host === 'dashscope-intl.aliyuncs.com') return 'qwen-intl';
        if (host === 'dashscope-us.aliyuncs.com') return 'qwen-us';
        if (host === 'cn-hongkong.dashscope.aliyuncs.com' || host.endsWith('.maas.aliyuncs.com')) return 'qwen';
        if (host === 'generativelanguage.googleapis.com') return 'gemini';
        return 'custom';
    }

    function preset(providerId) { return PRESETS[providerId] || PRESETS.custom; }

    function normalizeProfile(value = {}) {
        const original = value && typeof value === 'object' ? value : {};
        const suppliedBaseUrl = original.baseUrl || original.endpoint || original.apiEndpoint || '';
        const inferred = inferProvider(suppliedBaseUrl);
        const providerId = PRESETS[original.providerId] ? original.providerId : inferred;
        const profile = preset(providerId);
        const cleanedBaseUrl = suppliedBaseUrl ? cleanBaseUrl(suppliedBaseUrl) : '';
        // 兼容旧设置中只填写官方域名的写法；预设补齐各厂商必要的版本/兼容路径。
        const baseUrl = cleanedBaseUrl && new URL(cleanedBaseUrl).pathname !== '/' ? cleanedBaseUrl : (profile.baseUrl || cleanedBaseUrl);
        const protocol = PROTOCOLS.has(original.protocol) ? original.protocol : profile.protocol;
        const authType = AUTH_TYPES.has(original.authType) ? original.authType : profile.authType;
        return {
            ...original,
            providerId,
            protocol,
            authType,
            baseUrl,
            // endpoint 继续保留，供现有调用点与旧云端快照使用。
            endpoint: baseUrl,
            connectTimeoutMs: clamp(original.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT, MAX_CONNECT_TIMEOUT),
            idleTimeoutMs: clamp(original.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT, MAX_IDLE_TIMEOUT)
        };
    }

    function endpoint(profileOrUrl, protocol) {
        const profile = typeof profileOrUrl === 'string'
            ? normalizeProfile({ endpoint: profileOrUrl, protocol }) : normalizeProfile(profileOrUrl);
        const url = new URL(profile.baseUrl);
        const path = url.pathname.replace(/\/+$/, '');
        const suffix = profile.protocol === 'openai-responses' ? '/responses' : '/chat/completions';
        if (!path.endsWith(suffix)) url.pathname = (path || '') + suffix;
        return url.href;
    }

    function provider(value) {
        if (value && typeof value === 'object') return normalizeProfile(value).providerId;
        return inferProvider(value);
    }

    function thinkingCapability(value, model) {
        const profile = typeof value === 'object' ? normalizeProfile(value) : normalizeProfile({ endpoint: value });
        const p = profile.providerId, m = String(model || profile.model || '').toLowerCase();
        if (profile.protocol === 'gemini-openai') {
            if (/^gemini-2\.5-flash(?:-lite)?(?:$|-(?:preview|[0-9]))/.test(m)) return 'switch';
            if (/^gemini-(?:2\.5-pro|3(?:\.[15-8])?-(?:pro|flash(?:-lite)?)|4-(?:carbon|argon|hydrogen))(?:$|-(?:preview|[0-9]))/.test(m)) return 'always';
            return 'default';
        }
        if (p === 'deepseek') {
            if (m === 'deepseek-reasoner') return 'always';
            if (/^deepseek-(?:v4|flash)/.test(m)) return 'switch';
        }
        if (p === 'qwen' || p === 'qwen-intl' || p === 'qwen-us') {
            if (m.includes('-instruct')) return 'default';
            if (/^(?:qwq|qwen3-[\w-]*thinking)/.test(m)) return 'always';
            if (/^qwen3(?:\.[5-9])?(?:-|$)/.test(m) && !/^qwen3-max/.test(m)) return 'switch';
            if (/^qwen-(?:plus|flash)(?:-|$)/.test(m)) return 'switch';
        }
        if (p === 'zhipu' && /^glm-5\.3(?:-|$)/.test(m)) return 'always';
        if (p === 'zhipu' && /^glm-(?:4\.[567]|5)(?:[.-]|$)/.test(m)) return 'switch';
        if ((p === 'kimi-cn' || p === 'kimi-global')) {
            if (/^kimi-(?:k3|k2\.7-code|k2-thinking)/.test(m)) return 'always';
            if (/^kimi-k2\.[56](?:-|$)/.test(m)) return 'switch';
        }
        return 'default';
    }

    function thinkingOptions(config) {
        const profile = normalizeProfile(config);
        const { providerId, protocol } = profile;
        const model = String(profile.model || '').toLowerCase();
        const capability = thinkingCapability(profile, model);
        const qwen = ['qwen', 'qwen-intl', 'qwen-us'].includes(providerId);
        const kimi = ['kimi-cn', 'kimi-global'].includes(providerId);
        let efforts = [], budgets = [], canDisable = capability === 'switch';
        if (providerId === 'openai' && /^openai-(?:chat|responses)$/.test(protocol)) {
            if (/^gpt-5\.6(?:-(?:sol|terra|luna))?$/.test(model)) {
                efforts = ['medium', 'high', 'max'];
                canDisable = true;
            } else if (/^gpt-5\.(?:2|4|5)(?:-(?:mini|nano|\d{4}-\d\d-\d\d))?$/.test(model)) {
                efforts = ['medium', 'high', 'xhigh'];
                canDisable = true;
            } else if (/^gpt-5(?:-(?:mini|nano))?(?:-\d{4}-\d\d-\d\d)?$/.test(model)) {
                efforts = ['low', 'medium', 'high'];
            } else if (/^gpt-6(?:\.1)?-(?:astra|sol|luna)$/.test(model)) {
                efforts = ['medium', 'high', 'xhigh'];
                canDisable = /^gpt-6-(?:sol|luna)$/.test(model);
            } else if (/^o[134](?:-mini)?(?:-\d{4}-\d\d-\d\d)?$/.test(model)) {
                efforts = ['low', 'medium', 'high'];
            }
        } else if (providerId === 'gemini' && protocol === 'gemini-openai') {
            if (model === 'gemini-3-pro-preview') efforts = ['low', 'high'];
            else if (model === 'gemini-4-hydrogen') efforts = ['medium', 'high', 'xhigh'];
            else if (/^gemini-(?:2\.5-(?:flash(?:-lite)?|pro)|3-flash|3\.1-(?:flash-lite|pro)|3\.[5-8]-flash(?:-lite)?|4-(?:carbon|argon))(?:$|-(?:preview|[0-9]))/.test(model)) efforts = ['low', 'medium', 'high'];
        } else if (protocol === 'openai-chat') {
            if (providerId === 'deepseek' && /^deepseek-(?:flash|v4(?:\.1)?-(?:pro|flash))(?:-\d+)?$/.test(model)) {
                efforts = ['low', 'high', 'max'];
            } else if (providerId === 'zhipu' && /^glm-5\.[23](?:$|-(?:flashx?|[0-9]))/.test(model)) {
                efforts = model.startsWith('glm-5.3') ? ['low', 'high', 'max'] : ['high', 'max'];
            } else if (kimi && /^kimi-k3(?:\.1-pro)?(?:-highspeed)?$/.test(model)) {
                efforts = ['low', 'high', 'max'];
            } else if (qwen && /^qwen(?:4-max-preview|3\.8-(?:max|flash|2\.4t-a95b|27b))(?:-\d+)?$/.test(model)) {
                efforts = ['low', 'medium', 'xhigh'];
                canDisable = true;
            } else if (qwen && /^qwen3\.[567]-(?:plus|flash)(?:-\d{4}-\d\d-\d\d)?$/.test(model)) {
                budgets = [4096, 8192, 16384];
            }
        }
        const toggle = enabled => qwen ? { enable_thinking: enabled } : { thinking: { type: enabled ? 'enabled' : 'disabled' } };
        const options = [];
        if (canDisable) options.push({ id: 'off', label: '关闭', params: providerId === 'openai' || providerId === 'gemini' ? { reasoning_effort: 'none' } : toggle(false) });
        if (!efforts.length && !budgets.length && canDisable) options.push({ id: 'on', label: '开启', params: toggle(true) });
        const labels = ['普通', '高', '极高'].slice(3 - Math.max(efforts.length, budgets.length));
        efforts.forEach((effort, index) => options.push({
            id: effort, label: labels[index],
            params: { ...(canDisable && !['openai', 'gemini'].includes(providerId) ? toggle(true) : {}), reasoning_effort: effort }
        }));
        budgets.forEach((budget, index) => options.push({ id: String(budget), label: labels[index], params: { ...toggle(true), thinking_budget: budget } }));
        return options;
    }

    function modelContext(config) {
        const { providerId, model } = normalizeProfile(config);
        if (providerId === 'openai' && /^gpt-5-(mini|nano)(?:-|$)/.test(model)) return 400000;
        if (providerId === 'openai' && /^gpt-5\.[456](?:-(?:sol|terra|luna|\d{4}-\d\d-\d\d))?$/.test(model)) return 1050000;
        if (providerId === 'gemini' && /^gemini-(?:2\.5-(?:flash(?:-lite)?|pro)|3\.8-flash)$/.test(model)) return 1048576;
        if (providerId === 'deepseek' && /^deepseek-(?:flash|v4-(?:pro|flash))$/.test(model)) return 1048576;
        if (['kimi-cn', 'kimi-global'].includes(providerId) && /^kimi-k3(?:\.1-pro)?(?:-highspeed)?$/.test(model)) return 1000000;
        if (providerId === 'zhipu' && /^glm-5\.[23]$/.test(model)) return 1000000;
        if (/^qwen(?:-|$)/.test(providerId) && /^qwen3\.(?:[567]-(?:plus|flash)|8-(?:max|flash))(?:-(?:\d+|\d{4}-\d\d-\d\d))?$/.test(model)) return 1000000;
        return null;
    }

    function needsReasoningHistory(value, model) {
        const p = provider(value);
        return (p === 'kimi-cn' || p === 'kimi-global') && /^kimi-(?:k3|k2\.7-code)/i.test(model || '');
    }

    function instructionRole(config) {
        const profile = normalizeProfile(config);
        const model = String(profile.model || '').toLowerCase();
        return profile.protocol === 'openai-responses' || (profile.providerId === 'openai' && /^(?:o[1-9]|gpt-5)/.test(model))
            ? 'developer' : 'system';
    }

    function publicProfile(config) {
        const profile = normalizeProfile(config);
        return { providerId: profile.providerId, protocol: profile.protocol, authType: profile.authType,
            baseUrl: profile.baseUrl, connectTimeoutMs: profile.connectTimeoutMs, idleTimeoutMs: profile.idleTimeoutMs };
    }

    root.AIProviders = Object.freeze({ CONFIG_VERSION, PRESETS, cleanBaseUrl, inferProvider, preset, normalizeProfile,
        endpoint, provider, thinkingCapability, thinkingOptions, modelContext, needsReasoningHistory, instructionRole, publicProfile });
})(globalThis);
