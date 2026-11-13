// 管理助手附件：仅在浏览器本地提取正文。原始文件字节不会上传或持久化。
(function () {
    'use strict';
    const LIMITS = Object.freeze({ count: 10, textBytes: 2 * 1024 * 1024, officeBytes: 15 * 1024 * 1024, batchBytes: 30 * 1024 * 1024, extractedBytes: 512 * 1024, parserMs: 20000 });
    const DRAFT_PREFIX = 'assistant_attachment_draft_v1:';
    const MESSAGE_PREFIX = 'assistant_attachment_message_v1:';
    let pdfjsPromise;
    const draftWrites = new Map();
    const parsing = new Set();
    const retryFiles = new Map();
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
        return { id: item.id, name: item.name, type: item.type, size: item.size, extractedBytes: item.extractedBytes, status: item.status, warning: item.warning || null, skippedPages: item.skippedPages || [] };
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
        let lastError, text, encoding;
        for (encoding of encodings) {
            try { text = new TextDecoder(encoding, { fatal: true }).decode(buffer); break; } catch (error) { lastError = error; }
        }
        if (text !== undefined) return { text: trimText(text), encoding };
        throw new Error(`文本编码无法识别（仅支持 UTF-8、UTF-16 与 GB18030）：${lastError?.message || ''}`);
    }
    async function parsePdf(buffer) {
        pdfjsPromise ||= import('../vendor/pdf.mjs').then(module => {
            module.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.mjs';
            return module;
        });
        const pdfjs = await pdfjsPromise;
        const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableAutoFetch: true, disableStream: true });
        let timer;
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PDF 解析超时（20 秒）。')), LIMITS.parserMs); });
        const extract = async () => {
            const documentPdf = await task.promise;
            const pages = [], skippedPages = [];
            for (let pageNumber = 1; pageNumber <= documentPdf.numPages; pageNumber++) {
                const page = await documentPdf.getPage(pageNumber);
                const content = await page.getTextContent();
                const text = content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
                if (text) pages.push(`[第 ${pageNumber} 页]\n${text}`);
                else skippedPages.push(pageNumber);
            }
            if (!pages.length) throw new Error('PDF 没有可提取的文字。扫描件请先做 OCR 再添加。');
            return { text: trimText(pages.join('\n\n')), skippedPages };
        };
        try { return await Promise.race([extract(), timeout]); }
        finally { clearTimeout(timer); await task.destroy().catch(() => {}); }
    }
    function docxText(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
        const children = () => [...node.childNodes].map(docxText).join('');
        switch (node.nodeName) {
            case 'BR': return '\n';
            case 'IMG': return '';
            case 'TR': return [...node.cells].map(cell => docxText(cell).trim().replace(/\n+/g, ' / ')).join(' | ') + '\n';
            case 'TABLE': return '\n' + children() + '\n';
            case 'LI': {
                const list = node.parentElement;
                const bullet = list.tagName === 'OL' ? list.start + [...list.children].indexOf(node) + '. ' : '- ';
                const nested = [...node.children].filter(child => child.matches('ol,ul'));
                const text = [...node.childNodes].filter(child => !nested.includes(child)).map(docxText).join('').trim();
                const sublists = nested.map(list => docxText(list).trimEnd().replace(/^/gm, '  ') + '\n').join('');
                return (text ? bullet + text + '\n' : '') + sublists;
            }
            case 'P': case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
                return children() + '\n\n';
            default: return children();
        }
    }
    function parseDocx(buffer) {
        return new Promise((resolve, reject) => {
            const worker = new Worker('./js/attachment-parser-worker.js');
            const finish = (error, value) => {
                clearTimeout(timer);
                worker.terminate();
                if (error) reject(error); else resolve(value);
            };
            const timer = setTimeout(() => finish(new Error('DOCX 解析超时（20 秒）。')), LIMITS.parserMs);
            worker.onmessage = ({ data }) => {
                try {
                    if (!data.ok) throw new Error(data.error || 'DOCX 解析失败');
                    const doc = new DOMParser().parseFromString(data.html || '', 'text/html');
                    finish(null, { text: trimText(docxText(doc.body)), warning: (data.warnings || []).slice(0, 2).join('；') || null });
                } catch (error) { finish(error); }
            };
            worker.onerror = () => finish(new Error('无法启动 DOCX 解析。'));
            worker.onmessageerror = () => finish(new Error('无法读取 DOCX 解析结果。'));
            try { worker.postMessage({ buffer }, [buffer]); } catch (error) { finish(error); }
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
        if (ext === 'pdf') return parsePdf(buffer);
        return parseDocx(buffer);
    }
    async function getDraft(currentTopicId) {
        const items = (await localforage.getItem(draftKey(currentTopicId))) || [];
        return items.map(item => item.status === 'parsing' && !parsing.has(item.id)
            ? { ...item, status: 'error', error: '解析已中断，请重新选择文件。' }
            : item);
    }
    function updateDraft(currentTopicId, change) {
        const pending = draftWrites.get(currentTopicId) || Promise.resolve();
        const write = pending.catch(() => {}).then(async () => {
            const items = await getDraft(currentTopicId);
            const next = await change(items);
            if (next.length) await localforage.setItem(draftKey(currentTopicId), next);
            else await localforage.removeItem(draftKey(currentTopicId));
            if (topicId() === currentTopicId) render(next, currentTopicId);
        });
        draftWrites.set(currentTopicId, write);
        return write.finally(() => { if (draftWrites.get(currentTopicId) === write) draftWrites.delete(currentTopicId); });
    }
    async function loadDraft(currentTopicId = topicId()) {
        await draftWrites.get(currentTopicId);
        const items = await getDraft(currentTopicId);
        if (topicId() === currentTopicId) render(items, currentTopicId);
    }
    function clearDraft(currentTopicId = topicId()) {
        return updateDraft(currentTopicId, items => {
            items.forEach(item => retryFiles.delete(item.id));
            return [];
        });
    }
    function warningText(item) {
        return [item.warning, item.skippedPages?.length && '无可提取文字的页：' + item.skippedPages.join('、')].filter(Boolean).join('；');
    }
    function preview(container, label, item) {
        const details = document.createElement('details');
        details.className = 'attachment-preview';
        const summary = document.createElement('summary');
        summary.textContent = label;
        const content = document.createElement('pre');
        content.textContent = [warningText(item), item.text].filter(Boolean).join('\n\n');
        details.append(summary, content);
        container.appendChild(details);
    }
    function render(items, currentTopicId) {
        const tray = document.getElementById('attachmentTray'); if (!tray) return;
        tray.replaceChildren(); tray.hidden = !items.length;
        items.forEach(item => {
            const row = document.createElement('div'); row.className = `attachment-chip is-${item.status}`;
            const label = document.createElement('span');
            label.className = 'attachment-chip-label';
            label.textContent = item.name + ' · ' + statusText(item.status);
            const detail = document.createElement('span');
            detail.className = 'attachment-chip-detail';
            detail.textContent = item.status === 'error' ? item.error : warningText(item) || Math.ceil(item.extractedBytes / 1024) + ' KB';
            const remove = document.createElement('button');
            remove.type = 'button'; remove.title = '移除 ' + item.name; remove.setAttribute('aria-label', remove.title); remove.textContent = '×';
            remove.onclick = () => updateDraft(currentTopicId, items => {
                retryFiles.delete(item.id);
                return items.filter(candidate => candidate.id !== item.id);
            }).catch(error => notifyStatus(error.message));
            row.append(label, detail);
            if (item.status === 'ready') preview(row, '预览提取文本', item);
            if (item.status === 'error' && retryFiles.has(item.id)) {
                const retry = document.createElement('button');
                retry.type = 'button'; retry.className = 'attachment-retry'; retry.textContent = '重试';
                retry.setAttribute('aria-label', '重试 ' + item.name);
                retry.onclick = () => parseDraft(currentTopicId, item.id, retryFiles.get(item.id)).catch(error => notifyStatus(error.message));
                row.appendChild(retry);
            }
            row.appendChild(remove); tray.appendChild(row);
        });
    }
    async function parseDraft(currentTopicId, attachmentId, file) {
        parsing.add(attachmentId);
        const task = window.StatusCenter?.start('正在解析附件 ' + file.name, '附件');
        try {
            let exists = false;
            await updateDraft(currentTopicId, items => items.map(item => {
                if (item.id !== attachmentId) return item;
                exists = true;
                return { ...item, status: 'parsing' };
            }));
            if (!exists) { task?.finish('附件已移除', 'info'); return; }
            const result = await parseFile(file);
            const ready = { ...result, status: 'ready', extractedBytes: byteLength(result.text) };
            await updateDraft(currentTopicId, items => items.map(item => item.id === attachmentId ? { ...item, ...ready } : item));
            retryFiles.delete(attachmentId);
            task?.finish('附件解析完成：' + file.name, warningText(ready) ? 'warning' : 'success');
        } catch (error) {
            await updateDraft(currentTopicId, items => items.map(item => {
                if (item.id !== attachmentId) return item;
                retryFiles.set(attachmentId, file);
                return { ...item, status: 'error', error: error.message || '解析失败' };
            }));
            task?.finish('附件解析失败：' + file.name + '。' + error.message, 'error');
        } finally { parsing.delete(attachmentId); }
    }
    async function addFiles(fileList) {
        const selected = Array.from(fileList || []);
        if (!selected.length) return;
        const currentTopicId = topicId();
        let additions = [];
        await updateDraft(currentTopicId, items => {
            if (items.length + selected.length > LIMITS.count) { notifyStatus('最多可添加 10 个附件。'); return items; }
            if ([...items, ...selected].reduce((sum, item) => sum + item.size, 0) > LIMITS.batchBytes) {
                notifyStatus('附件总大小不能超过 30 MB。'); return items;
            }
            additions = selected.map(file => ({ id: id(), name: file.name, type: fileExt(file), size: file.size, status: 'parsing', extractedBytes: 0 }));
            additions.forEach(item => parsing.add(item.id));
            return [...items, ...additions];
        });
        for (const [index, item] of additions.entries()) await parseDraft(currentTopicId, item.id, selected[index]);
    }
    async function prepareMessage(currentTopicId) {
        await draftWrites.get(currentTopicId);
        const items = await getDraft(currentTopicId);
        if (items.some(item => item.status === 'error')) throw new Error('请重试或移除无法解析的附件后再发送。');
        if (items.some(item => item.status === 'parsing')) throw new Error('附件仍在解析，请稍候。');
        return items;
    }
    async function commitMessage(currentTopicId, messageId, items, signal) {
        if (!items.length) return;
        try {
            await updateDraft(currentTopicId, async current => {
                if (current.length !== items.length || current.some((item, index) => item.id !== items[index].id || item.status !== 'ready')) {
                    throw new Error('附件草稿已更改，请重新发送。');
                }
                signal?.throwIfAborted();
                await localforage.setItem(messageKey(currentTopicId, messageId), items);
                signal?.throwIfAborted();
                return [];
            });
            if (signal?.aborted) {
                await restoreMessage(currentTopicId, messageId, items);
                signal.throwIfAborted();
            }
        } catch (error) {
            await removeMessage(currentTopicId, messageId);
            throw error;
        }
    }
    async function restoreMessage(currentTopicId, messageId, items) {
        if (items.length) await updateDraft(currentTopicId, current => [...items, ...current.filter(item => !items.some(saved => saved.id === item.id))]);
        await removeMessage(currentTopicId, messageId);
    }
    async function messageAttachments(currentTopicId, messageId) { return (await localforage.getItem(messageKey(currentTopicId, messageId))) || []; }
    async function removeMessage(currentTopicId, messageId) { await localforage.removeItem(messageKey(currentTopicId, messageId)); }
    async function removeTopicMessages(currentTopicId) {
        const prefix = messageKey(currentTopicId, '');
        const keys = await localforage.keys();
        await Promise.all(keys.filter(key => key.startsWith(prefix)).map(key => localforage.removeItem(key)));
    }
    async function copyMessage(fromTopicId, fromMessageId, toTopicId, toMessageId) {
        const source = await messageAttachments(fromTopicId, fromMessageId);
        if (source.length) await localforage.setItem(messageKey(toTopicId, toMessageId), source.map(clone));
    }
    async function importCloud(currentTopicId, messageId, rows) {
        const existing = await messageAttachments(currentTopicId, messageId);
        const items = new Map(existing.map(item => [item.id, item]));
        for (const item of rows || []) {
            if (item.status === 'deleted') items.delete(item.id);
            else if (item.text) items.set(item.id, { ...makeSummary(item), text: item.text, status: 'ready' });
        }
        if (items.size) await localforage.setItem(messageKey(currentTopicId, messageId), [...items.values()]);
        else if (existing.length) await removeMessage(currentTopicId, messageId);
    }
    function attachmentEnvelope(item) {
        const name = item.name.replace(/["<>\r\n]/g, '');
        const warning = warningText(item);
        return '<<<ATTACHMENT name="' + name + '" type="' + item.type + '">>>\n' +
            (warning ? '[提取提示：' + warning + ']\n' : '') + item.text + '\n<<<END ATTACHMENT>>>';
    }
    async function hydrateForApi(currentTopicId, messages, draft = {}) {
        const hydrated = [], missing = [], sources = [];
        for (const message of messages) {
            const copy = { ...message };
            if (copy.role === 'user' && copy.attachments?.length) {
                const items = copy.id === draft.id ? draft.items : await messageAttachments(currentTopicId, copy.id);
                const byId = new Map(items.map(item => [item.id, item]));
                const found = [];
                for (const summary of copy.attachments) {
                    const item = byId.get(summary.id);
                    if (item?.text) found.push(item);
                    else missing.push(summary.name);
                }
                sources.push(...found);
                if (found.length) copy.content = (copy.content || '请分析以下附件。') + '\n\n' + found.map(attachmentEnvelope).join('\n\n');
            }
            hydrated.push(copy);
        }
        return { history: hydrated, missing: [...new Set(missing)], sources };
    }
    function showMessageAttachments(messageDiv, message) {
        if (!message.attachments?.length) return;
        const list = document.createElement('div');
        list.className = 'message-attachments';
        const currentTopicId = window.AssistantTopics?.getDisplayedTopicId?.() || topicId();
        for (const item of message.attachments) {
            const chip = document.createElement('span');
            chip.textContent = '📎 ' + item.name;
            chip.title = warningText(item) || '查看提取文本';
            const card = document.createElement('details');
            card.className = 'attachment-preview';
            const summary = document.createElement('summary');
            summary.appendChild(chip);
            const content = document.createElement('pre');
            card.append(summary, content);
            card.addEventListener('toggle', async () => {
                if (!card.open) return;
                try {
                    const stored = (await messageAttachments(currentTopicId, message.id)).find(row => row.id === item.id);
                    content.textContent = stored?.text
                        ? [warningText(stored), stored.text].filter(Boolean).join('\n\n')
                        : '附件正文缺失，请重新添加原文件。';
                } catch (_) { content.textContent = '暂时无法读取附件正文。'; }
            });
            list.appendChild(card);
        }
        messageDiv.querySelector('.message-content')?.insertAdjacentElement('afterend', list);
    }
    window.AssistantAttachments = Object.freeze({ LIMITS, addFiles, loadDraft, clearDraft, prepareMessage, commitMessage, restoreMessage, messageAttachments, removeMessage, removeTopicMessages, copyMessage, importCloud, hydrateForApi, showMessageAttachments, summaries: items => items.map(makeSummary) });
})();
