// =======================================================
// utils.js - 通用工具函数（零依赖，最先加载）
// =======================================================

/**
 * HTML 转义：将特殊字符转为 HTML 实体，防止 XSS (仅用于纯文本显示)
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * HTML 净化：移除危险标签和属性
 * 使用 DOMPurify (需要确保在 index.html 中引入了 DOMPurify)
 */
function sanitizeHtml(html) {
    if (!html) return '';

    // 如果 DOMPurify 已加载，优先使用 DOMPurify (最安全)
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(html, {
            ALLOWED_TAGS: [
                'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'span',
                'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
                'u', 'strike', 's', 'sub', 'sup', 'mark'
            ],
            ALLOWED_ATTR: ['href', 'target', 'class', 'style', 'id', 'data-*'],
            FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout']
        });
    }

    // 后备方案 (Fallback)：极度简化的基础过滤，应对 DOMPurify 加载失败的情况
    console.warn('[utils.js] DOMPurify 未加载，正在使用基础后备净化方案，存在一定 XSS 风险！');
    let safeHtml = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    safeHtml = safeHtml.replace(/<(iframe|object|embed|form)[^>]*>/gi, '');
    safeHtml = safeHtml.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
    safeHtml = safeHtml.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
    return safeHtml;
}

// =======================================================
// 状态提示条
// =======================================================

/** Keep the existing notification API while routing all results to the header. */
function showStatus(type, message, icon, duration) {
    // Older rename callers use (message, duration, isError).
    if (!['success', 'error', 'warning', 'loading', 'info'].includes(type)) {
        duration = message; message = type; type = icon === true ? 'error' : 'info';
    }
    return window.StatusCenter?.post(type, message, { duration: typeof duration === 'number' ? duration : undefined });
}
function showSuccess(msg, duration) { return showStatus('success', msg, '', duration ?? 3000); }
function showError(msg, duration) { return showStatus('error', msg, '', typeof duration === 'number' ? duration : 8000); }
function notifyStatus(message, title = '提示') {
    const text = String(message);
    const type = /失败|错误|无法|未能/.test(title + text) ? 'error' : /成功|完成|已开启|已退出/.test(title + text) ? 'success' : /请|尚未|没有|不能|至少|最多|未配置/.test(title + text) ? 'warning' : 'info';
    return window.StatusCenter?.post(type, text, { source: title,
        action: /AI|嵌入模型/.test(text) && /配置/.test(text) && typeof openSettings === 'function'
            ? { label: '打开设置', run: () => openSettings() } : null });
}

// =======================================================
// 简单加解密混淆 (防君子不防小人，防止明文直接被扫描)
// =======================================================
function obfuscateKey(key) {
    if (!key) return '';
    try {
        // 简单的 Base64 + 翻转
        return btoa(key).split('').reverse().join('');
    } catch (e) { return key; }
}

function deobfuscateKey(obfKey) {
    if (!obfKey) return '';
    try {
        return atob(obfKey.split('').reverse().join(''));
    } catch (e) { return obfKey; }
}

// =======================================================
// 自定义异步对话框 (替代原生的 alert, confirm, prompt)
// =======================================================
const CustomDialog = {
    _createOverlay: function () {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';
        overlay.style.zIndex = '10001';
        return overlay;
    },

    _createContent: function (title, messageHtml) {
        const content = document.createElement('div');
        content.className = 'modal-content custom-dialog-content';
        content.style.width = '400px';
        content.style.maxWidth = '90%';

        const header = document.createElement('div');
        header.className = 'modal-header';
        header.innerHTML = `<span style="font-size:16px; font-weight:bold;">${title}</span>`;

        const body = document.createElement('div');
        body.className = 'modal-body';
        body.style.padding = '20px';
        body.style.lineHeight = '1.6';
        body.innerHTML = messageHtml;

        content.appendChild(header);
        content.appendChild(body);
        return { content, body };
    },

    // Informational alerts no longer block the workflow. Decisions stay in confirm/prompt.
    alert: function (message, title = '提示') {
        notifyStatus(message, title);
        return Promise.resolve();
    },

    confirm: function (message, title = '确认') {
        return new Promise(resolve => {
            const overlay = this._createOverlay();
            const { content, body } = this._createContent(title, escapeHtml(message).replace(/\n/g, '<br>'));

            const btnDiv = document.createElement('div');
            btnDiv.style.marginTop = '20px';
            btnDiv.style.display = 'flex';
            btnDiv.style.justifyContent = 'flex-end';
            btnDiv.style.gap = '10px';

            const btnCancel = document.createElement('button');
            btnCancel.innerText = '取消';
            btnCancel.style.cssText = 'padding:8px 20px; background:#eee; color:#333; border:none; border-radius:4px; cursor:pointer;';
            btnCancel.onclick = () => { overlay.remove(); resolve(false); };

            const btnConfirm = document.createElement('button');
            btnConfirm.innerText = '确定';
            btnConfirm.style.cssText = 'padding:8px 20px; background:#e74c3c; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;';
            btnConfirm.onclick = () => { overlay.remove(); resolve(true); };

            btnDiv.appendChild(btnCancel);
            btnDiv.appendChild(btnConfirm);
            body.appendChild(btnDiv);
            overlay.appendChild(content);
            document.body.appendChild(overlay);
        });
    },

    prompt: function (message, defaultValue = '', title = '输入') {
        return new Promise(resolve => {
            const overlay = this._createOverlay();
            const { content, body } = this._createContent(title, escapeHtml(message).replace(/\n/g, '<br>'));

            const input = document.createElement('input');
            input.type = 'text';
            input.value = defaultValue;
            input.style.cssText = 'width:calc(100% - 20px); padding:10px; margin-top:15px; border:1px solid #ddd; border-radius:4px; font-size:14px;';

            const btnDiv = document.createElement('div');
            btnDiv.style.marginTop = '20px';
            btnDiv.style.display = 'flex';
            btnDiv.style.justifyContent = 'flex-end';
            btnDiv.style.gap = '10px';

            const btnCancel = document.createElement('button');
            btnCancel.innerText = '取消';
            btnCancel.style.cssText = 'padding:8px 20px; background:#eee; color:#333; border:none; border-radius:4px; cursor:pointer;';
            btnCancel.onclick = () => { overlay.remove(); resolve(null); };

            const btnConfirm = document.createElement('button');
            btnConfirm.innerText = '确定';
            btnConfirm.style.cssText = 'padding:8px 20px; background:#3498db; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;';
            btnConfirm.onclick = () => { overlay.remove(); resolve(input.value); };

            input.onkeydown = (e) => {
                if (e.key === 'Enter') btnConfirm.click();
                if (e.key === 'Escape') btnCancel.click();
            };

            btnDiv.appendChild(btnCancel);
            btnDiv.appendChild(btnConfirm);
            body.appendChild(input);
            body.appendChild(btnDiv);
            overlay.appendChild(content);
            document.body.appendChild(overlay);

            setTimeout(() => { input.focus(); input.select(); }, 50);
        });
    }
};

console.log('[utils.js] 工具函数加载完成');
