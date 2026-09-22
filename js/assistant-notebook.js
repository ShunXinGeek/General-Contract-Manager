// 管理助手笔记本：收藏回复的本地优先存储、编辑与增量云同步。
(function () {
    'use strict';

    const INDEX_KEY = 'assistant_notebook_v1';
    const OUTBOX_KEY = 'assistant_notebook_outbox_v1';
    const state = { notes: [], selectedId: null, open: false, editing: false, editMode: 'source', draft: null, outbox: [], ready: false, initializedDom: false, flushTimer: null };
    const now = () => Date.now();
    const uid = () => globalThis.crypto?.randomUUID?.() || `note-${now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const clone = value => JSON.parse(JSON.stringify(value));
    const hash = value => {
        let result = 2166136261;
        for (const char of String(value || '')) { result ^= char.codePointAt(0); result = Math.imul(result, 16777619); }
        return (result >>> 0).toString(36);
    };
    const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const activeNotes = () => state.notes.filter(note => note.status !== 'deleted').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const getNote = id => state.notes.find(note => note.id === (id || state.selectedId)) || null;
    const canSync = () => typeof db !== 'undefined' && !!db && typeof currentUser !== 'undefined' && !!currentUser && navigator.onLine;
    const noteRef = id => db.collection(window.FIREBASE_COLLECTIONS.CONTRACT_MODS).doc(currentUser.uid).collection('assistant_notes').doc(id);

    function status(text, kind = '') {
        const el = document.getElementById('assistantNotebookStatus');
        if (el) { el.textContent = text || ''; el.dataset.kind = kind; }
    }
    function deriveTitle(content) {
        const raw = String(content || '').replace(/```[\s\S]*?```/g, ' ').replace(/^\s{0,3}#{1,6}\s*/m, '').replace(/[>*_`\[\]]/g, ' ');
        const line = raw.split(/\r?\n/).map(item => item.trim()).find(Boolean) || '未命名笔记';
        return Array.from(line.replace(/\s+/g, ' ').trim()).slice(0, 30).join('') || '未命名笔记';
    }
    function persist() { return Promise.all([localforage.setItem(INDEX_KEY, JSON.stringify({ version: 1, selectedId: state.selectedId, notes: state.notes })), localforage.setItem(OUTBOX_KEY, JSON.stringify(state.outbox))]); }
    function enqueue(op) {
        state.outbox = state.outbox.filter(item => !(item.kind === op.kind && item.noteId === op.noteId));
        state.outbox.push({ ...op, queuedAt: now() });
        persist().catch(() => {});
        clearTimeout(state.flushTimer); state.flushTimer = setTimeout(() => flushOutbox().catch(() => {}), 700);
    }
    async function flushOutbox() {
        if (!state.outbox.length || !canSync()) return false;
        const pending = [...state.outbox];
        try {
            for (const op of pending) {
                const note = state.notes.find(item => item.id === op.noteId);
                if (!note) continue;
                const ref = noteRef(note.id);
                if (note.status === 'deleted') await ref.set({ status: 'deleted', deletedAt: note.deletedAt || now(), updatedAt: now(), schemaVersion: 1, cloudUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
                else await ref.set({ ...clone(note), schemaVersion: 1, cloudUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            }
            const sent = new Set(pending.map(item => `${item.kind}:${item.noteId}`));
            state.outbox = state.outbox.filter(item => !sent.has(`${item.kind}:${item.noteId}`));
            await persist();
            return true;
        } catch (error) {
            console.warn('笔记本同步失败:', error);
            return false;
        }
    }
    async function syncWithCloud() {
        if (!canSync()) return false;
        try {
            const snapshot = await db.collection(window.FIREBASE_COLLECTIONS.CONTRACT_MODS).doc(currentUser.uid).collection('assistant_notes').get();
            const local = new Map(state.notes.map(note => [note.id, note]));
            snapshot.forEach(doc => {
                const remote = { ...doc.data(), id: doc.id };
                const current = local.get(doc.id);
                if (!current || (remote.updatedAt || 0) > (current.updatedAt || 0)) {
                    if (current) Object.assign(current, remote); else state.notes.push(remote);
                }
            });
            if (!getNote() || getNote()?.status === 'deleted') state.selectedId = activeNotes()[0]?.id || null;
            await persist(); render(); await flushOutbox();
            return true;
        } catch (error) { console.warn('笔记本云端对账失败:', error); return false; }
    }
    function setWorkspace(open) {
        ['assistantChatToolbar', 'chatMessages', 'assistantChatInputArea'].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = !!open; });
        const workspace = document.getElementById('assistantNotebookWorkspace');
        if (workspace) workspace.hidden = !open;
    }
    function renderMarkdown(content) {
        return typeof window.renderMarkdown === 'function' ? window.renderMarkdown(content || '') : `<pre>${escape(content || '')}</pre>`;
    }
    function syncPreviewScroll() {
        const source = document.getElementById('assistantNotebookContentInput');
        const preview = document.getElementById('assistantNotebookPreview');
        if (!state.editing || state.editMode !== 'compare' || !source || !preview) return;
        const sourceRange = Math.max(0, source.scrollHeight - source.clientHeight);
        const previewRange = Math.max(0, preview.scrollHeight - preview.clientHeight);
        preview.scrollTop = sourceRange ? (source.scrollTop / sourceRange) * previewRange : 0;
    }
    function renderDraftPreview() {
        const preview = document.getElementById('assistantNotebookPreview');
        if (!preview || !state.editing) return;
        preview.innerHTML = renderMarkdown(state.draft?.content || '');
        syncPreviewScroll();
    }
    function closeNoteMenus(returnFocus = false) {
        document.querySelectorAll('.assistant-notebook-menu').forEach(menu => {
            const opener = menu.parentElement?.querySelector('.assistant-topic-more');
            menu.remove(); opener?.setAttribute('aria-expanded', 'false');
            if (returnFocus) opener?.focus();
        });
    }
    async function unfavoriteNote(noteId) {
        const note = getNote(noteId); if (!note) return;
        if (!await CustomDialog.confirm(`确定取消收藏“${note.title || '未命名笔记'}”？此操作会删除该笔记。`, '取消收藏')) return;
        note.status = 'deleted'; note.deletedAt = now(); note.updatedAt = now(); note.schemaVersion = 1;
        if (state.selectedId === note.id) state.selectedId = activeNotes()[0]?.id || null;
        state.editing = false; state.draft = null;
        enqueue({ kind: 'note-delete', noteId: note.id }); await persist(); render();
    }
    function renderNoteMenu(host, note, opener) {
        const wasOpen = !!host.querySelector('.assistant-notebook-menu');
        closeNoteMenus();
        if (wasOpen) return;
        const menu = document.createElement('div'); menu.className = 'assistant-topic-menu assistant-notebook-menu'; menu.setAttribute('role', 'menu');
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = '取消收藏'; remove.setAttribute('role', 'menuitem');
        remove.onclick = event => { event.stopPropagation(); closeNoteMenus(); unfavoriteNote(note.id).catch(error => status(error.message, 'error')); };
        opener.setAttribute('aria-expanded', 'true'); menu.appendChild(remove); host.appendChild(menu);
    }
    function renderSidebar() {
        const list = document.getElementById('assistantTopicList');
        if (!list || !state.open) return;
        const filter = document.getElementById('assistantTopicSearch')?.value.trim().toLowerCase() || '';
        list.replaceChildren();
        const back = document.createElement('button'); back.type = 'button'; back.className = 'assistant-topic-back'; back.textContent = '‹ 返回话题'; back.onclick = () => window.AssistantTopics?.closeNotebook?.(); list.appendChild(back);
        const notes = activeNotes().filter(note => !filter || String(note.title || '').toLowerCase().includes(filter));
        if (!notes.length) { const empty = document.createElement('div'); empty.className = 'assistant-topic-empty'; empty.textContent = filter ? '没有匹配的笔记' : '笔记本为空'; list.appendChild(empty); }
        notes.forEach(note => {
            const row = document.createElement('div'); row.className = `assistant-topic-item${note.id === state.selectedId ? ' is-note-active' : ''}`;
            const button = document.createElement('button'); button.type = 'button'; button.className = 'assistant-topic-select'; button.setAttribute('aria-current', note.id === state.selectedId ? 'page' : 'false'); button.innerHTML = `<span class="assistant-topic-title">${escape(note.title || '未命名笔记')}</span>`;
            button.onclick = () => selectNote(note.id);
            const menuButton = document.createElement('button'); menuButton.type = 'button'; menuButton.className = 'assistant-topic-more'; menuButton.textContent = '⋯'; menuButton.title = '笔记操作'; menuButton.setAttribute('aria-label', `操作：${note.title || '未命名笔记'}`); menuButton.setAttribute('aria-haspopup', 'menu'); menuButton.setAttribute('aria-expanded', 'false'); menuButton.onclick = event => { event.stopPropagation(); renderNoteMenu(row, note, menuButton); };
            row.append(button, menuButton); list.appendChild(row);
        });
    }
    function render() {
        const count = document.getElementById('assistantNotebookCount'); if (count) count.textContent = String(activeNotes().length);
        if (!state.open) return;
        renderSidebar();
        const note = getNote();
        const content = document.getElementById('assistantNotebookContent'); const title = document.getElementById('assistantNotebookTitleInput'); const input = document.getElementById('assistantNotebookContentInput'); const preview = document.getElementById('assistantNotebookPreview'); const panes = document.getElementById('assistantNotebookEditPanes'); const body = document.querySelector('.assistant-notebook-body'); const modes = document.getElementById('assistantNotebookEditModes');
        const edit = document.getElementById('btnNotebookEdit'); const save = document.getElementById('btnNotebookSave'); const cancel = document.getElementById('btnNotebookCancel');
        body?.classList.toggle('is-editing', state.editing); if (body) body.dataset.editMode = state.editMode;
        if (!note) {
            if (content) content.innerHTML = '<div class="assistant-notebook-empty">还没有收藏内容。<br>在任意模型回复右下角点击“收藏”，即可把回复保存到这里。</div>';
            if (title) title.hidden = true; if (panes) panes.hidden = true; if (edit) edit.hidden = true; if (modes) modes.hidden = true; if (save) save.hidden = true; if (cancel) cancel.hidden = true;
            status(''); return;
        }
        const draft = state.editing ? state.draft : note;
        if (title) { title.value = draft.title || ''; title.hidden = !state.editing; }
        if (input) { input.value = draft.content || ''; input.hidden = !state.editing || state.editMode === 'preview'; }
        if (preview) preview.hidden = !state.editing || state.editMode === 'source';
        if (panes) panes.hidden = !state.editing;
        if (content) {
            content.hidden = state.editing;
            if (!state.editing) {
                const date = new Date(note.updatedAt || note.createdAt || now()).toLocaleString('zh-CN', { hour12: false });
                const rendered = renderMarkdown(note.content);
                content.innerHTML = `<p class="assistant-notebook-meta">收藏于 ${escape(date)}${note.sourceTopicTitle ? ` · 来源：${escape(note.sourceTopicTitle)}` : ''}</p>${rendered}`;
            }
        }
        if (state.editing) renderDraftPreview();
        if (modes) {
            modes.hidden = !state.editing;
            [['source', 'btnNotebookModeSource'], ['preview', 'btnNotebookModePreview'], ['compare', 'btnNotebookModeCompare']].forEach(([mode, id]) => {
                const button = document.getElementById(id); if (!button) return;
                const active = state.editMode === mode; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active));
            });
        }
        if (edit) edit.hidden = state.editing; if (save) save.hidden = !state.editing; if (cancel) cancel.hidden = !state.editing;
        status(state.editing ? '正在编辑，尚未保存的内容不会自动提交。' : '');
    }
    async function discardDraftIfNeeded() {
        if (!state.editing || !state.draft?.dirty) return true;
        return CustomDialog.confirm('笔记内容尚未保存，确定放弃本次修改吗？', '放弃未保存修改');
    }
    async function selectNote(noteId) {
        if (noteId === state.selectedId) return;
        if (!await discardDraftIfNeeded()) return;
        state.selectedId = noteId; state.editing = false; state.draft = null; await persist(); render();
    }
    function beginEdit() {
        const note = getNote(); if (!note) return;
        state.editing = true; state.editMode = 'source'; state.draft = { id: note.id, title: note.title || '', content: note.content || '', dirty: false }; render(); document.getElementById('assistantNotebookTitleInput')?.focus();
    }
    async function saveEdit() {
        const note = getNote(); if (!note || !state.editing) return;
        const title = document.getElementById('assistantNotebookTitleInput')?.value.trim() || deriveTitle(document.getElementById('assistantNotebookContentInput')?.value || '');
        const content = document.getElementById('assistantNotebookContentInput')?.value || '';
        note.title = Array.from(title).slice(0, 80).join(''); note.content = content; note.updatedAt = now(); note.schemaVersion = 1;
        state.editing = false; state.draft = null; enqueue({ kind: 'note', noteId: note.id }); await persist(); render();
    }
    async function cancelEdit() { if (!await discardDraftIfNeeded()) return; state.editing = false; state.draft = null; render(); }
    function setEditMode(mode) {
        if (!state.editing || !['source', 'preview', 'compare'].includes(mode)) return;
        state.editMode = mode; render();
        if (mode !== 'preview') document.getElementById('assistantNotebookContentInput')?.focus();
    }
    function onDraftInput() {
        if (!state.editing || !state.draft) return;
        state.draft.title = document.getElementById('assistantNotebookTitleInput')?.value || '';
        state.draft.content = document.getElementById('assistantNotebookContentInput')?.value || '';
        state.draft.dirty = true; renderDraftPreview(); status('正在编辑，尚未保存的内容不会自动提交。');
    }
    async function addFromAssistant(data) {
        await ready;
        const content = String(data?.content || '').trim(); if (!content) throw new Error('没有可收藏的回复内容。');
        const sourceContentHash = hash(content);
        const existing = activeNotes().find(note => note.sourceTopicId === data.sourceTopicId && note.sourceMessageId === data.sourceMessageId && note.sourceContentHash === sourceContentHash);
        if (existing) { state.selectedId = existing.id; if (state.open) render(); return { note: clone(existing), created: false }; }
        const timestamp = now();
        const note = { id: uid(), schemaVersion: 1, status: 'active', title: deriveTitle(content), content, sourceTopicId: data.sourceTopicId || null, sourceTopicTitle: data.sourceTopicTitle || '', sourceMessageId: data.sourceMessageId || null, sourceContentHash, createdAt: timestamp, updatedAt: timestamp };
        state.notes.push(note); state.selectedId = note.id; enqueue({ kind: 'note', noteId: note.id }); await persist(); render(); return { note: clone(note), created: true };
    }
    async function open() { await ready; state.open = true; setWorkspace(true); if (!state.selectedId) state.selectedId = activeNotes()[0]?.id || null; render(); }
    async function requestClose() { if (!await discardDraftIfNeeded()) return false; state.editing = false; state.draft = null; state.open = false; setWorkspace(false); render(); return true; }
    function attachDom() {
        if (state.initializedDom) return; state.initializedDom = true;
        document.getElementById('btnNotebookEdit')?.addEventListener('click', beginEdit);
        document.getElementById('btnNotebookSave')?.addEventListener('click', () => saveEdit().catch(error => status(error.message, 'error')));
        document.getElementById('btnNotebookCancel')?.addEventListener('click', () => cancelEdit().catch(() => {}));
        document.getElementById('btnNotebookModeSource')?.addEventListener('click', () => setEditMode('source'));
        document.getElementById('btnNotebookModePreview')?.addEventListener('click', () => setEditMode('preview'));
        document.getElementById('btnNotebookModeCompare')?.addEventListener('click', () => setEditMode('compare'));
        document.getElementById('assistantNotebookTitleInput')?.addEventListener('input', onDraftInput);
        document.getElementById('assistantNotebookContentInput')?.addEventListener('input', onDraftInput);
        document.getElementById('assistantNotebookContentInput')?.addEventListener('scroll', syncPreviewScroll, { passive: true });
        window.addEventListener('online', () => syncWithCloud().catch(() => {}));
    }
    async function initialize() {
        try {
            const raw = await localforage.getItem(INDEX_KEY); if (raw) { const saved = JSON.parse(raw); state.notes = Array.isArray(saved.notes) ? saved.notes : []; state.selectedId = saved.selectedId || null; }
            const queued = await localforage.getItem(OUTBOX_KEY); if (queued) state.outbox = JSON.parse(queued) || [];
            state.ready = true; attachDom(); render(); if (canSync()) syncWithCloud().catch(() => {});
        } catch (error) { console.warn('笔记本初始化失败:', error); state.ready = true; }
    }
    const ready = initialize();
    window.AssistantNotebook = { ready, open, requestClose, render, renderSidebar, addFromAssistant, getCount: () => activeNotes().length, syncWithCloud, flushOutbox, isOpen: () => state.open };
})();
