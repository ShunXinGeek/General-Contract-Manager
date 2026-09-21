// Shared browser transport for the normalized AI Gateway protocol.
(function (root) {
    'use strict';
    const providers = root.AIProviders;
    function endpoint(value) {
        if (providers) return providers.endpoint(value);
        let url;
        try { url = new URL(value.trim()); } catch (_) { throw new Error('AI 接口地址无效，请填写完整的 HTTPS 地址。'); }
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
            throw new Error('AI 接口必须使用 HTTPS，且不能包含账号、查询参数或片段。');
        }
        let path = url.pathname.replace(/\/+$/, '');
        if (!path.endsWith('/chat/completions')) {
            if (!path) {
                if (url.hostname === 'open.bigmodel.cn') path = '/api/paas/v4';
                else if (/^dashscope(?:-intl|-us)?\.aliyuncs\.com$/.test(url.hostname) || url.hostname.endsWith('.maas.aliyuncs.com') || url.hostname === 'cn-hongkong.dashscope.aliyuncs.com') path = '/compatible-mode/v1';
                else path = '/v1';
            }
            path += '/chat/completions';
        }
        url.pathname = path;
        return url.href;
    }
    function provider(value) {
        if (providers) return providers.provider(value);
        const host = new URL(endpoint(value)).hostname;
        if (host === 'api.deepseek.com') return 'deepseek';
        if (host === 'open.bigmodel.cn') return 'zhipu';
        if (host === 'api.moonshot.cn') return 'kimi-cn';
        if (host === 'api.moonshot.ai') return 'kimi-global';
        if (host === 'dashscope-intl.aliyuncs.com') return 'qwen-intl';
        if (host === 'dashscope-us.aliyuncs.com') return 'qwen-us';
        if (/^dashscope\.aliyuncs\.com$/.test(host) || host.endsWith('.maas.aliyuncs.com') || host === 'cn-hongkong.dashscope.aliyuncs.com') return 'qwen';
        return 'openai';
    }
    function thinkingCapability(value, model) {
        if (providers) return providers.thinkingCapability(value, model);
        const source = value && typeof value === 'object' ? (value.apiEndpoint || value.endpoint || value.baseUrl) : value;
        const p = provider(source), m = (model || '').toLowerCase();
        if (p === 'deepseek') {
            if (m === 'deepseek-reasoner') return 'always';
            if (/^deepseek-(?:v4|flash)/.test(m)) return 'switch';
        }
        if (p === 'qwen' || p === 'qwen-intl' || p === 'qwen-us') {
            if (m.includes('-instruct')) return 'default';
            if (/^(?:qwq|qwen3-[\w-]*thinking)/.test(m)) return 'always';
            // qwen3-max predates switchable thinking; dated variants may differ.
            if (/^qwen3(?:\.[5-9])?(?:-|$)/.test(m) && !/^qwen3-max/.test(m)) return 'switch';
            if (/^qwen-(?:plus|flash)(?:-|$)/.test(m)) return 'switch';
        }
        if (p === 'zhipu' && /^glm-(?:4\.[567]|5)(?:[.-]|$)/.test(m)) return 'switch';
        if (p === 'kimi-cn' || p === 'kimi-global') {
            if (/^kimi-(?:k3|k2\.7-code|k2-thinking)/.test(m)) return 'always';
            if (/^kimi-k2\.[56](?:-|$)/.test(m)) return 'switch';
        }
        return 'default';
    }
    function needsReasoningHistory(value, model) {
        if (providers) return providers.needsReasoningHistory(value, model);
        const source = value && typeof value === 'object' ? (value.apiEndpoint || value.endpoint || value.baseUrl) : value;
        return ['kimi-cn', 'kimi-global'].includes(provider(source)) && /^kimi-(?:k3|k2\.7-code)/i.test(model || '');
    }
    function requestBody(config, messages, options = {}) {
        const profile = providers ? providers.normalizeProfile(config) : { ...config, providerId: provider(config.apiEndpoint), protocol: 'openai-chat' };
        const p = profile.providerId, m = (profile.model || '').toLowerCase();
        const body = { model: config.model, messages, stream: options.stream !== false };
        if (profile.protocol === 'openai-responses') body.apiStyle = 'responses';
        if (typeof options.thinking === 'boolean' && thinkingCapability(profile, m) === 'switch') {
            if (p === 'qwen' || p === 'qwen-intl' || p === 'qwen-us') body.enable_thinking = options.thinking;
            else if (profile.protocol === 'gemini-openai') body.reasoning_effort = options.thinking ? 'medium' : 'none';
            else body.thinking = { type: options.thinking ? 'enabled' : 'disabled' };
        }
        // Only set sampling/output limits on models known to accept them.
        // Kimi hybrid/fixed-thinking models have model-specific fixed temperatures.
        const parameterSensitive = profile.protocol === 'openai-responses' ||
            (p === 'openai' && /^(?:o[1-9]|gpt-5)/.test(m));
        if (options.classify && !parameterSensitive && !((p === 'kimi-cn' || p === 'kimi-global') && /^kimi-k[23]/.test(m))) {
            body.temperature = 0;
            if (thinkingCapability(profile, m) !== 'always') body.max_tokens = 200;
        }
        return body;
    }
    async function request(config, messages, options = {}) {
        const profile = providers ? providers.normalizeProfile(config) : { ...config, baseUrl: config.apiEndpoint };
        const target = providers ? endpoint(profile) : endpoint(config.apiEndpoint);
        const controller = new AbortController();
        const abort = () => controller.abort(options.signal.reason);
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => controller.abort(new Error('连接 AI 接口超时，请稍后重试。')), profile.connectTimeoutMs || 35000);
        try {
            const response = await fetch('/api/ai', {
                method: 'POST', cache: 'no-store', signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: target, apiKey: config.apiKey, profile: providers ? providers.publicProfile(profile) : undefined,
                    body: requestBody(profile, messages, options) })
            });
            clearTimeout(timer);
            if (!response.ok) {
                let data;
                if ((response.headers.get('content-type') || '').includes('application/json')) {
                    try { data = await response.json(); } catch (_) { /* use status fallback */ }
                }
                throw new Error(data?.error?.message || (response.status === 404
                    ? 'AI 转发接口尚未部署，请确认 Netlify 已发布最新版本。'
                    : 'AI 请求失败（HTTP ' + response.status + '），请检查配置或稍后重试。'));
            }
            const type = response.headers.get('content-type') || '';
            if (!response.body || (options.stream !== false && !type.includes('text/event-stream'))) {
                throw new Error('AI 接口没有返回预期的流式响应，请检查接口地址和模型兼容性。');
            }
            return response;
        } catch (error) {
            if (options.signal?.aborted) throw new DOMException('已停止生成', 'AbortError');
            if (controller.signal.aborted) throw controller.signal.reason;
            if (error instanceof TypeError) throw new Error('无法连接本站 AI 转发接口，请检查网络或浏览器请求拦截。');
            throw error;
        } finally {
            clearTimeout(timer);
            // Retain the listener while the caller consumes the response stream.
            if (controller.signal.aborted) options.signal?.removeEventListener('abort', abort);
        }
    }
    async function* events(response) {
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '', completed = false, finishSeen = false;
        function parse(block) {
            const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data) return null;
            if (data.trim() === '[DONE]') return { done: true };
            let event;
            try { event = JSON.parse(data); } catch (_) { throw new Error('AI 接口返回了无法解析的流式数据。'); }
            if (event.error) throw new Error('AI 服务返回流式错误，请稍后重试或检查模型配置。');
            return event;
        }
        try {
            while (true) {
                let chunk;
                try { chunk = await reader.read(); } catch (error) {
                    if (error.name === 'AbortError') throw error;
                    throw new Error('AI 响应连接中断或超时，回答可能不完整；请手动重试。');
                }
                buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
                buffer = buffer.replace(/\r\n/g, '\n');
                let boundary;
                while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                    const event = parse(buffer.slice(0, boundary));
                    buffer = buffer.slice(boundary + 2);
                    if (event?.done) { completed = true; return; }
                    if (event) {
                        if (event.choices?.some(choice => choice && choice.finish_reason)) finishSeen = true;
                        yield event;
                    }
                }
                if (chunk.done) {
                    const event = parse(buffer);
                    if (event?.done) completed = true;
                    else if (event) {
                        if (event.choices?.some(choice => choice && choice.finish_reason)) finishSeen = true;
                        yield event;
                    }
                    if (!completed && !finishSeen) throw new Error('AI 响应提前结束，回答可能不完整；请手动重试。');
                    return;
                }
            }
        } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    }
    function instructionRole(config) {
        return providers ? providers.instructionRole(config) : 'system';
    }
    root.AIClient = { endpoint, provider, thinkingCapability, needsReasoningHistory, instructionRole, requestBody, request, events };
})(globalThis);
