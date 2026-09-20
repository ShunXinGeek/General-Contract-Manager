// 管理助手附件：仅在浏览器本地提取正文。原始文件字节不会上传或持久化。
(function () {
    'use strict';
    const LIMITS = Object.freeze({ count: 10, textBytes: 2 * 1024 * 1024, officeBytes: 15 * 1024 * 1024, batchBytes: 30 * 1024 * 1024, extractedBytes: 512 * 1024, requestBytes: 1536 * 1024, parserMs: 20000 });
    const DRAFT_PREFIX = 'assistant_attachment_draft_v1:';
    const MESSAGE_PREFIX = 'assistant_attachment_message_v1:';
    let pdfjsPromise;
    let docxWorker;
    let workerSerial = 0;
    const byteLength = value => new TextEncoder().encode(String(value || '')).byteLength;
    const id = () => globalThis.crypto?.randomUUID?.() || `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const topicId = () => window.AssistantTopics?.getCurrentTopicId?.() || 'legacy';
    const draftKey = currentTopicId => DRAFT_PREFIX + currentTopicId;
    const messageKey = (currentTopicId, messageId) => `${MESSAGE_PREFIX}${currentTopicId}:${messageId}`;
    const clone = value => JSON.parse(JSON.stringify(value));
    const fileExt = file => (file.name.split('.').pop() || '').toLowerCase();
    const accepted = new Set(['txt', 'md', 'markdown', 'pdf', 'docx']);
    const textFile = ext => ext === 'txt' || ext === 'md' || ext === 'markdown';
    const statusText = status => ({ parsing: '正在解析', ready: '已就绪', error: '无法使用' }[status] || status);

    function makeSummary(item) {
        return { id: item.id, name: item.name, type: item.type, size: item.size, extractedBytes: item.extractedBytes, status: item.status, warning: item.warning || null };
    }
    function trimText(text) {
        const normalized = String(text || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
        if (!normalized) throw new Error('未提取到可用的文本内容；扫描件或受保护文档暂不支持。');
        if (byteLength(normalized) > LIMITS.extractedBytes) throw new Error(`提取文本超过 ${Math.round(LIMITS.extractedBytes / 1024)} KB 限制，请拆分文件后重试。`);
        return normalized;
    }
    function decodeText(buffer) {
        const bytes = new Uint8Array(buffer);
        const encodings = bytes[0] === 0xff && bytes[1] === 0xfe ? ['utf-16le'] : bytes[0] === 0xfe && bytes[1] === 0xff ? ['utf-16be'] : ['utf-8', 'gb18030'];
        let lastError;
        for (const encoding of encodings) {
            try { return { text: trimText(new TextDecoder(encoding, { fatal: true }).decode(buffer)), encoding }; } catch (error) { lastError = error; }
        }
        throw new Error(`文本编码无法识别（仅支持 UTF-8、UTF-16 与 GB18030）：${lastError?.message || ''}`);
    }
    async function parsePdf(buffer) {
        pdfjsPromise ||= import('../vendor/pdf.mjs').then(module => {
            module.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.mjs';
            return module;
        });
        const pdfjs = await pdfjsPromise;
        const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableAutoFetch: true, disableStream: true });
        const timeout = new Promise((_, reject) => setTimeout(() => { task.destroy(); reject(new Error('PDF 解析超时（20 秒）。')); }, LIMITS.parserMs));
        const documentPdf = await Promise.race([task.promise, timeout]);
        try {
            const pages = [];
            for (let pageNumber = 1; pageNumber <= documentPdf.numPages; pageNumber++) {
                const page = await documentPdf.getPage(pageNumber);
                const content = await page.getTextContent();
                const text = content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
                if (text) pages.push(`[第 ${pageNumber} 页]\n${text}`);
            }
            return trimText(pages.join('\n\n'));
        } finally { await task.destroy(); }
    }
    function parseDocx(buffer) {
        docxWorker ||= new Worker('./js/attachment-parser-worker.js');
        const requestId = ++workerSerial;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { docxWorker.terminate(); docxWorker = null; reject(new Error('DOCX 解析超时（20 秒）。')); }, LIMITS.parserMs);
            const listener = event => {
                if (event.data?.id !== requestId) return;
                docxWorker.removeEventListener('message', listener); clearTimeout(timer);
                if (!event.data.ok) { reject(new Error(event.data.error || 'DOCX 解析失败')); return; }
                const doc = new DOMParser().parseFromString(event.data.html || '', 'text/html');
                resolve({ text: trimText(doc.body.textContent || ''), warning: (event.data.warnings || []).slice(0, 2).join('；') || null });
            };
            docxWorker.addEventListener('message', listener);
            docxWorker.postMessage({ id: requestId, buffer }, [buffer]);
        });
    }
    async function parseFile(file) {
        const ext = fileExt(file);
        if (!accepted.has(ext)) throw new Error('仅支持 TXT、Markdown、PDF 和 DOCX 文件；旧版 DOC 请先另存为 DOCX。');
        const max = textFile(ext) ? LIMITS.textBytes : LIMITS.officeBytes;
        if (file.size > max) throw new Error(`${file.name} 超过单文件 ${Math.round(max / 1024 / 1024)} MB 限制。`);
        const buffer = await file.arrayBuffer();
        if (textFile(ext)) {
            const result = decodeText(buffer);
            return { text: result.text, warning: result.encoding === 'gb18030' ? '已按 GB18030 编码读取。' : null };
        }
        if (ext === 'pdf') return { text: await parsePdf(buffer), warning: null };
        return parseDocx(buffer);
    }
    async function getDraft(currentTopicId = topicId()) { return (await localforage.getItem(draftKey(currentTopicId))) || []; }
    async function saveDraft(items, currentTopicId = topicId()) { await localforage.setItem(draftKey(currentTopicId), items); render(items); }
    async function loadDraft(currentTopicId = topicId()) { render(await getDraft(currentTopicId)); }
    async function clearDraft(currentTopicId = topicId()) { await localforage.removeItem(draftKey(currentTopicId)); render([]); }
    function render(items) {
        const tray = document.getElementById('attachmentTray'); if (!tray) return;
        tray.replaceChildren(); tray.hidden = !items.length;
        items.forEach(item => {
            const row = document.createElement('div'); row.className = `attachment-chip is-${item.status}`;
            const label = document.createElement('span'); label.className = 'attachment-chip-label'; label.textContent = `${item.name} · ${statusText(item.status)}`;
            const detail = document.createElement('span'); detail.className = 'attachment-chip-detail'; detail.textContent = item.status === 'error' ? item.error : `${Math.ceil(item.extractedBytes / 1024)} KB`;
            const remove = document.createElement('button'); remove.type = 'button'; remove.title = `移除 ${item.name}`; remove.setAttribute('aria-label', `移除 ${item.name}`); remove.textContent = '×';
            remove.disabled = item.status === 'parsing'; remove.onclick = () => removeDraft(item.id);
            row.append(label, detail, remove); tray.appendChild(row);
        });
    }
    async function addFiles(fileList) {
        const selected = Array.from(fileList || []); if (!selected.length) return;
        const current = await getDraft();
        const currentBytes = current.reduce((sum, item) => sum + (item.size || 0), 0);
        if (current.length + selected.length > LIMITS.count) { alert(`最多可添加 ${LIMITS.count} 个附件。`); return; }
        if (currentBytes + selected.reduce((sum, file) => sum + file.size, 0) > LIMITS.batchBytes) { alert('附件总大小不能超过 30 MB。'); return; }
        const additions = selected.map(file => ({ id: id(), name: file.name, type: fileExt(file), size: file.size, status: 'parsing', extractedBytes: 0 }));
        await saveDraft([...current, ...additions]);
        for (let index = 0; index < selected.length; index++) {
            const targetId = additions[index].id;
            try {
                const result = await parseFile(selected[index]);
                const latest = await getDraft(); const item = latest.find(row => row.id === targetId);
                if (!item) continue;
                Object.assign(item, { status: 'ready', text: result.text, extractedBytes: byteLength(result.text), warning: result.warning || null }); await saveDraft(latest);
            } catch (error) {
                const latest = await getDraft(); const item = latest.find(row => row.id === targetId);
                if (!item) continue;
                Object.assign(item, { status: 'error', error: error.message || '解析失败' }); await saveDraft(latest);
            }
        }
    }
    async function removeDraft(attachmentId) { await saveDraft((await getDraft()).filter(item => item.id !== attachmentId)); }
    async function prepareMessage(currentTopicId, messageId) {
        const items = await getDraft(currentTopicId);
        const failed = items.filter(item => item.status === 'error');
        if (failed.length) throw new Error('请移除无法解析的附件后再发送。');
        if (items.some(item => item.status === 'parsing')) throw new Error('附件仍在解析，请稍候。');
        const ready = items.filter(item => item.status === 'ready');
        await localforage.setItem(messageKey(currentTopicId, messageId), ready);
        await clearDraft(currentTopicId);
        return ready.map(makeSummary);
    }
    async function messageAttachments(currentTopicId, messageId) { return (await localforage.getItem(messageKey(currentTopicId, messageId))) || []; }
    async function removeMessage(currentTopicId, messageId) { await localforage.removeItem(messageKey(currentTopicId, messageId)); }
    async function copyMessage(fromTopicId, fromMessageId, toTopicId, toMessageId) {
        const source = await messageAttachments(fromTopicId, fromMessageId);
        if (source.length) await localforage.setItem(messageKey(toTopicId, toMessageId), source.map(clone));
    }
    async function importCloud(currentTopicId, messageId, rows) {
        const items = (rows || []).filter(item => item.status !== 'deleted' && item.text).map(item => ({
            id: item.id, name: item.name, type: item.type, size: item.size || 0, extractedBytes: item.extractedBytes || byteLength(item.text),
            text: item.text, warning: item.warning || null, status: 'ready'
        }));
        if (items.length) await localforage.setItem(messageKey(currentTopicId, messageId), items);
    }
    function attachmentEnvelope(item) { return `<<<ATTACHMENT name="${item.name.replace(/["<>]/g, '')}" type="${item.type}">>>\n${item.text}\n<<<END ATTACHMENT>>>`; }
    async function hydrateForApi(currentTopicId, messages) {
        const hydrated = [];
        for (const message of messages) {
            if (message.type === 'break') { hydrated.push(message); continue; }
            const copy = { ...message };
            if (copy.role === 'user' && Array.isArray(copy.attachments) && copy.attachments.length) {
                const items = await messageAttachments(currentTopicId, copy.id);
                copy.content = `${copy.content || '请分析以下附件。'}\n\n${items.map(attachmentEnvelope).join('\n\n')}`;
            }
            hydrated.push(copy);
        }
        const requestSize = byteLength(JSON.stringify(hydrated));
        if (requestSize > LIMITS.requestBytes) throw new Error('本次对话及附件正文超过 1.5 MB 发送限制，请删除部分消息或拆分附件。');
        return hydrated;
    }
    function showMessageAttachments(messageDiv, message) {
        if (!Array.isArray(message.attachments) || !message.attachments.length) return;
        const list = document.createElement('div'); list.className = 'message-attachments';
        message.attachments.forEach(item => { const chip = document.createElement('span'); chip.textContent = `📎 ${item.name}`; chip.title = item.warning || `${item.type?.toUpperCase() || '文件'}，已本地提取 ${Math.ceil((item.extractedBytes || 0) / 1024)} KB`; list.appendChild(chip); });
        messageDiv.querySelector('.message-content')?.insertAdjacentElement('afterend', list);
    }
    window.AssistantAttachments = Object.freeze({ LIMITS, addFiles, loadDraft, clearDraft, prepareMessage, messageAttachments, removeMessage, copyMessage, importCloud, hydrateForApi, showMessageAttachments, summaries: items => items.map(makeSummary) });
})();
