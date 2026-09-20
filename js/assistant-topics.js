// 管理助手话题：本地优先的会话管理与 Firebase 增量同步。
(function () {
    'use strict';

    const INDEX_KEY = 'assistant_topics_v2';
    const MESSAGE_PREFIX = 'assistant_topic_messages_v2:';
    const DRAFT_KEY = 'assistant_topic_drafts_v1';
    const OUTBOX_KEY = 'assistant_topic_outbox_v1';
    const SIDEBAR_KEY = 'assistant_topic_sidebar_open_v1';
    const LEGACY_KEY = 'general_contract_chat';
    const RANK_GAP = 1000;
    const state = {
        topics: [], currentTopicId: null, drafts: {}, outbox: [], messages: new Map(), hashes: new Map(),
        view: 'active', search: '', ready: false, busy: false, initializedDom: false, flushTimer: null
    };

    const now = () => Date.now();
    const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${now().toString(36)}-${Math.random().toString(36).slice(2)}`);
    const clone = value => JSON.parse(JSON.stringify(value));
    const topicKey = id => `${MESSAGE_PREFIX}${id}`;
    const hash = value => JSON.stringify(value);
    const escaped = value => String(value || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function activeTopics() { return state.topics.filter(topic => topic.status === 'active'); }
    function archivedTopics() { return state.topics.filter(topic => topic.status === 'archived'); }
    function getTopic(id = state.currentTopicId) { return state.topics.find(topic => topic.id === id) || null; }
    function sortedTopics(topics) {
        return [...topics].sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (a.rank - b.rank) || (a.updatedAt - b.updatedAt) || a.id.localeCompare(b.id));
    }
    function nextRank(pinned = false) {
        const ranks = activeTopics().filter(topic => !!topic.pinned === pinned).map(topic => topic.rank || 0);
        return (ranks.length ? Math.max(...ranks) : 0) + RANK_GAP;
    }
    function messagePreview(messages) {
        const message = [...messages].reverse().find(item => item.type !== 'break' && item.content);
        return message ? String(message.content).replace(/\s+/g, ' ').slice(0, 72) : '尚未开始对话';
    }
    function normalizeMessages(messages) {
        return (messages || []).map((message, index) => ({
            ...clone(message), id: message.id || uid(), sequence: Number.isFinite(message.sequence) ? message.sequence : index + 1,
            createdAt: message.createdAt || now(), updatedAt: message.updatedAt || now()
        }));
    }
    function notify(message, kind = '') {
        const el = document.getElementById('assistantTopicSyncState');
        if (el) { el.textContent = message; el.className = `assistant-sync-state ${kind}`; }
    }
    function setSidebarOpen(open, persist = true) {
        const sidebar = document.getElementById('assistantTopicSidebar');
        const scrim = document.getElementById('assistantTopicScrim');
        const button = document.getElementById('btnToggleNavigator');
        if (!sidebar) return;
        sidebar.classList.toggle('is-collapsed', !open);
        scrim?.classList.toggle('is-visible', open && window.innerWidth <= 768);
        scrim?.setAttribute('aria-hidden', String(!(open && window.innerWidth <= 768)));
        button?.setAttribute('aria-expanded', String(open));
        if (persist) localStorage.setItem(SIDEBAR_KEY, open ? '1' : '0');
    }
    function isSidebarOpen() { return !document.getElementById('assistantTopicSidebar')?.classList.contains('is-collapsed'); }
    function requireIdle() {
        if (!state.busy) return true;
        notify('请先停止当前回复', 'warning');
        return false;
    }
    async function persistIndex() {
        await localforage.setItem(INDEX_KEY, JSON.stringify({ version: 2, currentTopicId: state.currentTopicId, topics: state.topics }));
        await localforage.setItem(DRAFT_KEY, JSON.stringify(state.drafts));
        await localforage.setItem(OUTBOX_KEY, JSON.stringify(state.outbox));
    }
    async function persistMessages(topicId) {
        await localforage.setItem(topicKey(topicId), JSON.stringify(state.messages.get(topicId) || []));
    }
    function enqueue(op) {
        const key = `${op.kind}:${op.topicId}:${op.messageId || ''}`;
        state.outbox = state.outbox.filter(item => `${item.kind}:${item.topicId}:${item.messageId || ''}` !== key);
        state.outbox.push({ ...op, queuedAt: now() });
        persistIndex().catch(() => {});
        scheduleFlush();
    }
    function queueTopic(topic) { enqueue({ kind: topic.status === 'deleted' ? 'topic-delete' : 'topic', topicId: topic.id }); }
    function scheduleFlush() {
        clearTimeout(state.flushTimer);
        state.flushTimer = setTimeout(() => flushOutbox().catch(() => {}), 700);
    }
    function canSync() { return typeof db !== 'undefined' && !!db && typeof currentUser !== 'undefined' && !!currentUser && navigator.onLine; }
    function cloudTopicRef(topicId) {
        return db.collection(window.FIREBASE_COLLECTIONS.CONTRACT_MODS).doc(currentUser.uid).collection('assistant_topics').doc(topicId);
    }
    function compactTopic(topic) {
        const { id, ...data } = topic;
        return { ...clone(data), schemaVersion: 2, cloudUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() };
    }
    async function flushOutbox() {
        if (!state.outbox.length) { notify('已同步', 'ok'); return true; }
        if (!canSync()) { notify(navigator.onLine ? '待同步' : '离线，待同步', 'pending'); return false; }
        const pending = [...state.outbox];
        notify('同步中…', 'pending');
        try {
            for (let start = 0; start < pending.length; start += 350) {
                const batch = db.batch();
                pending.slice(start, start + 350).forEach(op => {
                    const ref = cloudTopicRef(op.topicId);
                    const topic = getTopic(op.topicId);
                    if (op.kind === 'topic' && topic) batch.set(ref, compactTopic(topic), { merge: true });
                    if (op.kind === 'topic-delete' && topic) batch.set(ref, { status: 'deleted', deletedAt: topic.deletedAt || now(), updatedAt: now(), schemaVersion: 2 }, { merge: true });
                    if (op.kind === 'message' && topic) {
                        const message = (state.messages.get(op.topicId) || []).find(item => item.id === op.messageId);
                        if (message) batch.set(ref.collection('messages').doc(message.id), { ...clone(message), schemaVersion: 2, cloudUpdatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
                    }
                    if (op.kind === 'message-delete') batch.set(ref.collection('messages').doc(op.messageId), { status: 'deleted', deletedAt: now(), updatedAt: now(), schemaVersion: 2 }, { merge: true });
                });
                await batch.commit();
            }
            const sent = new Set(pending.map(item => `${item.kind}:${item.topicId}:${item.messageId || ''}`));
            state.outbox = state.outbox.filter(item => !sent.has(`${item.kind}:${item.topicId}:${item.messageId || ''}`));
            await persistIndex();
            notify('已同步', 'ok');
            return true;
        } catch (error) {
            console.warn('话题同步失败:', error);
            notify('同步失败，可稍后重试', 'error');
            return false;
        }
    }
    async function syncTopicMessages(topicId) {
        if (!canSync() || !topicId) return;
        const snapshot = await cloudTopicRef(topicId).collection('messages').orderBy('sequence').get();
        const local = state.messages.get(topicId) || [];
        const merged = new Map(local.map(item => [item.id, item]));
        snapshot.forEach(doc => {
            const remote = doc.data();
            const existing = merged.get(doc.id);
            if (remote.status === 'deleted') { merged.delete(doc.id); return; }
            if (!existing || (remote.updatedAt || 0) > (existing.updatedAt || 0)) merged.set(doc.id, { ...remote, id: doc.id });
        });
        const messages = [...merged.values()].sort((a, b) => (a.sequence - b.sequence) || a.id.localeCompare(b.id));
        state.messages.set(topicId, messages);
        state.hashes.set(topicId, new Map(messages.map(item => [item.id, hash(item)])));
        await persistMessages(topicId);
    }
    async function syncWithCloud() {
        if (!canSync()) return false;
        try {
            const snapshot = await db.collection(window.FIREBASE_COLLECTIONS.CONTRACT_MODS).doc(currentUser.uid).collection('assistant_topics').get();
            const localById = new Map(state.topics.map(topic => [topic.id, topic]));
            snapshot.forEach(doc => {
                const remote = { ...doc.data(), id: doc.id };
                const local = localById.get(doc.id);
                if (remote.status === 'deleted') {
                    if (local) Object.assign(local, remote);
                    else state.topics.push(remote);
                } else if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) {
                    if (local) Object.assign(local, remote); else state.topics.push(remote);
                }
            });
            const current = getTopic();
            if (!current || current.status !== 'active') state.currentTopicId = sortedTopics(activeTopics())[0]?.id || null;
            if (state.currentTopicId) await syncTopicMessages(state.currentTopicId);
            await persistIndex();
            render();
            await flushOutbox();
            return true;
        } catch (error) {
            console.warn('话题云端对账失败:', error);
            notify('同步失败，可稍后重试', 'error');
            return false;
        }
    }
    async function initialize() {
        try {
            const raw = await localforage.getItem(INDEX_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                state.topics = saved.topics || [];
                state.currentTopicId = saved.currentTopicId || null;
            }
            const drafts = await localforage.getItem(DRAFT_KEY);
            if (drafts) state.drafts = JSON.parse(drafts) || {};
            const outbox = await localforage.getItem(OUTBOX_KEY);
            if (outbox) state.outbox = JSON.parse(outbox) || [];
            if (!state.topics.length) {
                const legacy = await localforage.getItem(LEGACY_KEY);
                let migrated = null;
                try { migrated = legacy ? JSON.parse(legacy) : null; } catch (_) { migrated = null; }
                const topic = createTopicData(migrated?.messages?.length ? '历史对话' : '新话题');
                if (migrated?.messages?.length) {
                    const messages = normalizeMessages(migrated.messages);
                    state.messages.set(topic.id, messages);
                    state.hashes.set(topic.id, new Map(messages.map(item => [item.id, hash(item)])));
                    topic.messageCount = messages.length;
                    topic.preview = messagePreview(messages);
                    topic.contextBreakIndex = migrated.contextBreakIndex ?? -1;
                    topic.hasContextBreak = !!migrated.hasContextBreak;
                    await persistMessages(topic.id);
                }
                state.topics.push(topic); state.currentTopicId = topic.id; queueTopic(topic);
            }
            if (!getTopic()?.status || getTopic().status !== 'active') state.currentTopicId = sortedTopics(activeTopics())[0]?.id || null;
            state.ready = true;
            await persistIndex();
            attachDom(); render();
            const pref = localStorage.getItem(SIDEBAR_KEY);
            setSidebarOpen(pref !== '0', false);
            if (canSync()) syncWithCloud().catch(() => {}); else notify(navigator.onLine ? '本地保存' : '离线，待同步', 'pending');
        } catch (error) {
            console.error('初始化话题失败:', error);
            notify('本地话题加载失败', 'error');
        }
    }
    function createTopicData(title = '新话题') {
        const timestamp = now();
        return { id: uid(), schemaVersion: 2, title, titleSource: 'default', status: 'active', pinned: false, rank: nextRank(false), createdAt: timestamp, updatedAt: timestamp, archivedAt: null, deletedAt: null, lastMessageAt: timestamp, messageCount: 0, preview: '尚未开始对话', contextBreakIndex: -1, hasContextBreak: false };
    }
    async function loadMessages(topicId) {
        if (state.messages.has(topicId)) return state.messages.get(topicId);
        const raw = await localforage.getItem(topicKey(topicId));
        const messages = raw ? normalizeMessages(JSON.parse(raw)) : [];
        state.messages.set(topicId, messages);
        state.hashes.set(topicId, new Map(messages.map(item => [item.id, hash(item)])));
        if (!messages.length && canSync()) await syncTopicMessages(topicId);
        return state.messages.get(topicId) || [];
    }
    function saveDraftForCurrent() {
        if (!state.currentTopicId) return;
        const input = document.getElementById('chatInput');
        const chat = document.getElementById('chatMessages');
        state.drafts[state.currentTopicId] = { text: input?.value || '', scrollTop: chat?.scrollTop || 0, updatedAt: now() };
    }
    async function switchTopic(topicId) {
        if (!requireIdle() || !topicId || topicId === state.currentTopicId) return;
        saveDraftForCurrent();
        await persistIndex();
        state.currentTopicId = topicId;
        const topic = getTopic(topicId);
        const messages = await loadMessages(topicId);
        window.applyAssistantTopicChatState?.({ messages, hasContextBreak: !!topic?.hasContextBreak, contextBreakIndex: topic?.contextBreakIndex ?? -1 });
        const draft = state.drafts[topicId] || {};
        const input = document.getElementById('chatInput'); if (input) { input.value = draft.text || ''; window.autoResizeInput?.(); }
        const chat = document.getElementById('chatMessages'); if (chat && Number.isFinite(draft.scrollTop)) chat.scrollTop = draft.scrollTop;
        if (typeof toggleAssistantRef === 'function' && document.getElementById('assistantRefPanel')?.style.display !== 'none') toggleAssistantRef();
        await persistIndex(); render();
        if (canSync()) syncTopicMessages(topicId).then(() => {
            const fresh = getTopic(topicId); window.applyAssistantTopicChatState?.({ messages: state.messages.get(topicId) || [], hasContextBreak: !!fresh?.hasContextBreak, contextBreakIndex: fresh?.contextBreakIndex ?? -1 });
        }).catch(() => {});
    }
    async function createTopic() {
        if (!requireIdle()) return;
        saveDraftForCurrent();
        const topic = createTopicData(); state.topics.push(topic); state.currentTopicId = topic.id;
        state.messages.set(topic.id, []); state.hashes.set(topic.id, new Map()); state.drafts[topic.id] = { text: '', scrollTop: 0, updatedAt: now() };
        await persistMessages(topic.id); queueTopic(topic); await persistIndex();
        window.applyAssistantTopicChatState?.({ messages: [], hasContextBreak: false, contextBreakIndex: -1 });
        const input = document.getElementById('chatInput'); if (input) { input.value = ''; input.focus(); window.autoResizeInput?.(); }
        render();
    }
    async function branchFromMessage(messageIndex, sourceMessages) {
        if (!requireIdle()) return null;
        const sourceTopic = getTopic();
        if (!sourceTopic || sourceTopic.status !== 'active') return null;
        const messages = Array.isArray(sourceMessages) ? sourceMessages : await loadMessages(sourceTopic.id);
        if (!Number.isInteger(messageIndex) || messageIndex < 0 || messageIndex >= messages.length || messages[messageIndex]?.role !== 'assistant') return null;

        saveDraftForCurrent();
        const timestamp = now();
        const branchRootId = sourceTopic.branchRootId || sourceTopic.id;
        const branchBaseTitle = sourceTopic.branchBaseTitle || sourceTopic.title || '新话题';
        const branchNumber = state.topics.reduce((highest, topic) => topic.branchRootId === branchRootId ? Math.max(highest, Number(topic.branchNumber) || 0) : highest, 0) + 1;
        const branch = createTopicData(`${branchBaseTitle}（${branchNumber}）`);
        const copiedMessages = normalizeMessages(messages.slice(0, messageIndex + 1)).map((message, index) => ({ ...message, sequence: index + 1, updatedAt: timestamp }));
        const lastBreakIndex = copiedMessages.reduce((last, message, index) => message.type === 'break' ? index : last, -1);
        Object.assign(branch, {
            titleSource: 'branch', pinned: !!sourceTopic.pinned, createdAt: timestamp, updatedAt: timestamp,
            lastMessageAt: copiedMessages.at(-1)?.createdAt || timestamp, messageCount: copiedMessages.length,
            preview: messagePreview(copiedMessages), hasContextBreak: lastBreakIndex >= 0,
            contextBreakIndex: lastBreakIndex >= 0 ? lastBreakIndex + 1 : -1,
            branchRootId, branchBaseTitle, branchNumber, branchedFromTopicId: sourceTopic.id,
            branchedFromMessageId: copiedMessages.at(-1)?.id || null
        });

        const group = sortedTopics(activeTopics().filter(topic => !!topic.pinned === !!sourceTopic.pinned));
        const sourceIndex = group.findIndex(topic => topic.id === sourceTopic.id);
        group.splice(sourceIndex < 0 ? group.length : sourceIndex, 0, branch);
        state.topics.push(branch);
        group.forEach((topic, index) => { topic.rank = (index + 1) * RANK_GAP; topic.updatedAt = timestamp; queueTopic(topic); });
        state.messages.set(branch.id, copiedMessages);
        state.hashes.set(branch.id, new Map(copiedMessages.map(message => [message.id, hash(message)])));
        state.drafts[branch.id] = { text: '', scrollTop: 0, updatedAt: timestamp };
        copiedMessages.forEach(message => enqueue({ kind: 'message', topicId: branch.id, messageId: message.id }));
        state.currentTopicId = branch.id;
        state.view = 'active';
        await persistMessages(branch.id);
        await persistIndex();
        window.applyAssistantTopicChatState?.({ messages: copiedMessages, hasContextBreak: branch.hasContextBreak, contextBreakIndex: branch.contextBreakIndex });
        const input = document.getElementById('chatInput');
        if (input) { input.value = ''; input.focus(); window.autoResizeInput?.(); }
        if (typeof toggleAssistantRef === 'function' && document.getElementById('assistantRefPanel')?.style.display !== 'none') toggleAssistantRef();
        render();
        notify(`已创建分支 ${branch.title}`, 'ok');
        state.channel?.postMessage({ type: 'changed', topicId: branch.id });
        return clone(branch);
    }
    async function renameTopic(topicId) {
        if (!requireIdle()) return;
        const topic = getTopic(topicId); if (!topic) return;
        const title = await CustomDialog.prompt('输入话题名称', topic.title, '重命名话题');
        if (title == null) return;
        const next = title.trim().slice(0, 80); if (!next) return;
        topic.title = next; topic.titleSource = 'user'; topic.updatedAt = now(); queueTopic(topic); await persistIndex(); render();
    }
    async function archiveTopic(topicId) {
        if (!requireIdle()) return;
        const topic = getTopic(topicId); if (!topic) return;
        topic.status = 'archived'; topic.pinned = false; topic.archivedAt = now(); topic.updatedAt = now(); queueTopic(topic);
        if (topic.id === state.currentTopicId) {
            const next = sortedTopics(activeTopics())[0];
            if (!next) { state.currentTopicId = null; await createTopic(); return; }
            state.currentTopicId = null;
            await switchTopic(next.id);
        }
        await persistIndex(); render(); notify('已归档，可在档案库恢复', 'ok');
    }
    async function restoreTopic(topicId) {
        if (!requireIdle()) return;
        const topic = getTopic(topicId); if (!topic) return;
        topic.status = 'active'; topic.archivedAt = null; topic.pinned = false; topic.rank = nextRank(false); topic.updatedAt = now(); queueTopic(topic); await persistIndex(); state.view = 'active'; render();
    }
    async function deleteTopic(topicId) {
        if (!requireIdle()) return;
        const topic = getTopic(topicId); if (!topic) return;
        if (!await CustomDialog.confirm(`永久删除“${topic.title}”及其全部聊天记录？此操作不可恢复。`, '永久删除话题')) return;
        const messages = await loadMessages(topicId);
        messages.forEach(message => enqueue({ kind: 'message-delete', topicId, messageId: message.id }));
        topic.status = 'deleted'; topic.deletedAt = now(); topic.updatedAt = now(); topic.title = ''; topic.preview = ''; queueTopic(topic);
        state.messages.delete(topicId); state.hashes.delete(topicId); delete state.drafts[topicId]; await localforage.removeItem(topicKey(topicId));
        if (state.currentTopicId === topicId) { const next = sortedTopics(activeTopics())[0]; if (next) await switchTopic(next.id); else await createTopic(); }
        await persistIndex(); render();
    }
    async function setPinned(topicId, pinned) {
        if (!requireIdle()) return;
        const topic = getTopic(topicId); if (!topic) return;
        topic.pinned = pinned; topic.rank = nextRank(pinned); topic.updatedAt = now(); queueTopic(topic); await persistIndex(); render();
    }
    async function moveTopic(topicId, direction) {
        if (!requireIdle()) return;
        const topic = getTopic(topicId); if (!topic) return;
        const group = sortedTopics(activeTopics().filter(item => !!item.pinned === !!topic.pinned));
        const index = group.findIndex(item => item.id === topicId), next = index + direction;
        if (index < 0 || next < 0 || next >= group.length) return;
        [group[index], group[next]] = [group[next], group[index]];
        group.forEach((item, i) => { item.rank = (i + 1) * RANK_GAP; item.updatedAt = now(); queueTopic(item); });
        await persistIndex(); render();
    }
    function toggleArchive() { state.view = state.view === 'archive' ? 'active' : 'archive'; render(); }
    function closeTopicMenus(returnFocus = false) {
        document.querySelectorAll('.assistant-topic-menu').forEach(menu => {
            const opener = menu.parentElement?.querySelector('.assistant-topic-more');
            opener?.setAttribute('aria-expanded', 'false');
            menu.remove();
            if (returnFocus) opener?.focus();
        });
    }
    function renderMenu(host, topic, opener) {
        const wasOpen = !!host.querySelector('.assistant-topic-menu');
        closeTopicMenus();
        if (wasOpen) return;
        const menu = document.createElement('div'); menu.className = 'assistant-topic-menu'; menu.setAttribute('role', 'menu');
        const entries = state.view === 'archive'
            ? [['恢复', () => restoreTopic(topic.id)], ['永久删除', () => deleteTopic(topic.id), 'danger']]
            : [['重命名', () => renameTopic(topic.id)], [topic.pinned ? '取消置顶' : '置顶', () => setPinned(topic.id, !topic.pinned)], ['上移', () => moveTopic(topic.id, -1)], ['下移', () => moveTopic(topic.id, 1)], ['归档', () => archiveTopic(topic.id), 'danger']];
        entries.forEach(([label, action, cls]) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.className = cls || ''; button.setAttribute('role', 'menuitem'); button.onclick = event => { event.stopPropagation(); closeTopicMenus(); action(); }; menu.appendChild(button); });
        opener.setAttribute('aria-expanded', 'true'); host.appendChild(menu);
    }
    function renderTopicItem(topic) {
        const item = document.createElement('div'); item.className = `assistant-topic-item${topic.id === state.currentTopicId ? ' is-active' : ''}`; item.draggable = state.view === 'active'; item.dataset.topicId = topic.id;
        const select = document.createElement('button'); select.type = 'button'; select.className = 'assistant-topic-select'; select.setAttribute('aria-current', topic.id === state.currentTopicId ? 'page' : 'false'); select.innerHTML = `${topic.pinned ? '<span class="assistant-topic-pin" aria-hidden="true">●</span>' : ''}<span class="assistant-topic-title">${escaped(topic.title || '已删除话题')}</span>`; select.onclick = () => state.view === 'active' && switchTopic(topic.id);
        const menuButton = document.createElement('button'); menuButton.type = 'button'; menuButton.className = 'assistant-topic-more'; menuButton.textContent = '⋯'; menuButton.title = '话题操作'; menuButton.setAttribute('aria-label', `操作：${topic.title || '话题'}`); menuButton.setAttribute('aria-haspopup', 'menu'); menuButton.setAttribute('aria-expanded', 'false'); menuButton.onclick = event => { event.stopPropagation(); renderMenu(item, topic, menuButton); };
        item.append(select, menuButton);
        if (state.view === 'active') {
            item.addEventListener('dragstart', event => event.dataTransfer.setData('text/plain', topic.id));
            item.addEventListener('dragover', event => event.preventDefault());
            item.addEventListener('drop', event => { event.preventDefault(); const source = getTopic(event.dataTransfer.getData('text/plain')); if (!source || source.id === topic.id || source.pinned !== topic.pinned) return; const group = sortedTopics(activeTopics().filter(row => row.pinned === topic.pinned)); const from = group.findIndex(row => row.id === source.id), to = group.findIndex(row => row.id === topic.id); group.splice(to, 0, group.splice(from, 1)[0]); group.forEach((row, i) => { row.rank = (i + 1) * RANK_GAP; row.updatedAt = now(); queueTopic(row); }); persistIndex().then(render); });
        }
        return item;
    }
    function render() {
        if (!state.initializedDom) return;
        const list = document.getElementById('assistantTopicList'); if (!list) return;
        const archive = state.view === 'archive'; const source = archive ? archivedTopics() : activeTopics();
        const filter = state.search.trim().toLowerCase(); const topics = sortedTopics(source).filter(topic => !filter || String(topic.title || '').toLowerCase().includes(filter));
        list.replaceChildren();
        if (archive) { const back = document.createElement('button'); back.type = 'button'; back.className = 'assistant-topic-back'; back.textContent = '‹ 返回话题'; back.onclick = toggleArchive; list.appendChild(back); }
        if (!topics.length) { const empty = document.createElement('div'); empty.className = 'assistant-topic-empty'; empty.textContent = archive ? '档案库为空' : '没有匹配的话题'; list.appendChild(empty); }
        let pinnedShown = false, recentShown = false;
        topics.forEach(topic => {
            if (!archive && topic.pinned && !pinnedShown) { const heading = document.createElement('div'); heading.className = 'assistant-topic-group'; heading.textContent = '已置顶'; list.appendChild(heading); pinnedShown = true; }
            if (!archive && !topic.pinned && !recentShown) { const heading = document.createElement('div'); heading.className = 'assistant-topic-group'; heading.textContent = pinnedShown ? '最近话题' : '话题'; list.appendChild(heading); recentShown = true; }
            list.appendChild(renderTopicItem(topic));
        });
        document.getElementById('assistantArchiveCount').textContent = String(archivedTopics().length);
        document.getElementById('btnAssistantArchive').classList.toggle('is-active', archive);
    }
    function attachDom() {
        if (state.initializedDom) return; state.initializedDom = true;
        document.getElementById('btnNewAssistantTopic')?.addEventListener('click', createTopic);
        document.getElementById('btnAssistantArchive')?.addEventListener('click', toggleArchive);
        document.getElementById('assistantTopicSearch')?.addEventListener('input', event => { state.search = event.target.value; render(); });
        document.getElementById('assistantTopicScrim')?.addEventListener('click', () => setSidebarOpen(false));
        document.addEventListener('click', event => { if (!event.target.closest('.assistant-topic-menu') && !event.target.closest('.assistant-topic-more')) closeTopicMenus(); });
        document.addEventListener('keydown', event => { if (event.key !== 'Escape') return; if (document.querySelector('.assistant-topic-menu')) { closeTopicMenus(true); return; } if (window.innerWidth <= 768 && isSidebarOpen()) { setSidebarOpen(false); document.getElementById('btnToggleNavigator')?.focus(); } });
        document.getElementById('chatInput')?.addEventListener('input', () => { saveDraftForCurrent(); persistIndex().catch(() => {}); });
        window.addEventListener('online', () => syncWithCloud().catch(() => {}));
        if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('assistant-topics'); channel.onmessage = () => initialize(); window.addEventListener('beforeunload', () => channel.close()); state.channel = channel; }
    }
    async function saveCurrentChat(chatState) {
        if (!state.ready || !state.currentTopicId) return;
        const topic = getTopic(); if (!topic) return;
        const messages = normalizeMessages(chatState.messages || []); const priorHashes = state.hashes.get(topic.id) || new Map(); const nextHashes = new Map();
        messages.forEach(message => { const signature = hash(message); nextHashes.set(message.id, signature); if (priorHashes.get(message.id) !== signature) enqueue({ kind: 'message', topicId: topic.id, messageId: message.id }); });
        priorHashes.forEach((_, messageId) => { if (!nextHashes.has(messageId)) enqueue({ kind: 'message-delete', topicId: topic.id, messageId }); });
        state.messages.set(topic.id, messages); state.hashes.set(topic.id, nextHashes);
        topic.messageCount = messages.length; topic.preview = messagePreview(messages); topic.lastMessageAt = now(); topic.updatedAt = now(); topic.hasContextBreak = !!chatState.hasContextBreak; topic.contextBreakIndex = chatState.contextBreakIndex ?? -1;
        if (topic.titleSource === 'default') { const first = messages.find(message => message.role === 'user' && message.content); if (first) { topic.title = String(first.content).replace(/\s+/g, ' ').slice(0, 24) || '新话题'; topic.titleSource = 'auto'; } }
        queueTopic(topic); await persistMessages(topic.id); await persistIndex(); render();
        state.channel?.postMessage({ type: 'changed', topicId: topic.id });
    }
    async function loadCurrentChat() {
        await window.assistantTopicsReady;
        if (!state.currentTopicId) await createTopic();
        const topic = getTopic(); const messages = await loadMessages(topic.id);
        window.applyAssistantTopicChatState?.({ messages, hasContextBreak: !!topic.hasContextBreak, contextBreakIndex: topic.contextBreakIndex ?? -1 });
        const draft = state.drafts[topic.id] || {}; const input = document.getElementById('chatInput'); if (input) { input.value = draft.text || ''; window.autoResizeInput?.(); }
        render();
    }
    const api = window.AssistantTopics = {
        init: initialize, saveCurrentChat, loadCurrentChat, switchTopic, createTopic, branchFromMessage, toggleSidebar: () => setSidebarOpen(!isSidebarOpen()),
        setBusy: value => { state.busy = !!value; }, syncWithCloud, flushOutbox, getCurrentTopicId: () => state.currentTopicId,
        getTopics: () => clone(state.topics.filter(topic => topic.status !== 'deleted'))
    };
    window.assistantTopicsReady = initialize();
    // 让既有云同步入口在合同同步成功后顺带对账话题，不改变其返回数据结构。
    if (typeof window.syncWithCloud === 'function') {
        const originalCloudSync = window.syncWithCloud;
        window.syncWithCloud = async function (...args) {
            const result = await originalCloudSync(...args);
            if (result?.success) api.syncWithCloud().catch(() => {});
            return result;
        };
    }
    if (typeof window.saveToCloud === 'function') {
        const originalSaveToCloud = window.saveToCloud;
        window.saveToCloud = async function (...args) {
            const result = await originalSaveToCloud(...args);
            if (result?.success) api.flushOutbox().catch(() => {});
            return result;
        };
    }
})();
