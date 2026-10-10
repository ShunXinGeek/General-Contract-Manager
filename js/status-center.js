// Unified, session-only status center. No contract content is persisted here.
(function () {
    'use strict';
    const labels = { success: '已完成', error: '需要关注', warning: '请留意', info: '消息', loading: '进行中' };
    const priority = { error: 5, warning: 4, loading: 3, success: 2, info: 1 };
    const records = [];
    let sequence = 0, timer, renderTimer, filter = 'all', opened = false;
    let context = { id: 'context', type: 'success', message: '就绪', source: '工作区', noticeUntil: 0 };
    let currentNotice = null, heldItem = null, heldSince = 0, lastReaction = '';
    const holds = new Set();
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const $ = id => document.getElementById(id);
    const display = $('statusDisplay');
    const panel = $('statusPanel');
    const bubble = $('statusBubble');
    if (!display || !panel) return;

    function trim() {
        const completed = records.filter(item => !item.active).sort((a, b) => a.time - b.time || a.order - b.order);
        const remove = new Set(completed.slice(0, Math.max(0, completed.length - 100)));
        for (let i = records.length - 1; i >= 0; i--) if (remove.has(records[i])) records.splice(i, 1);
    }
    function post(type, message, options = {}) {
        if (!message) return null;
        type = labels[type] ? type : 'info';
        const now = Date.now();
        const source = options.source || '程序';
        let item = options.id ? records.find(row => row.id === options.id) : null;
        if (item && item.type === type && item.message === String(message) && item.progress === (options.progress ?? null)) return item.id;
        if (!item && !options.id) item = records.findLast(row => !row.active && row.type === type && row.message === String(message) && row.source === source && now - row.time < 5000);
        if (item) item.count += options.id ? 0 : 1;
        else { item = { id: options.id || `message-${++sequence}`, count: 1 }; records.push(item); }
        const duration = options.duration ?? (type === 'error' || type === 'warning' ? 8000 : 4000);
        Object.assign(item, { type, message: String(message), source, time: now, order: ++sequence, read: opened,
            active: type === 'loading', progress: options.progress ?? null,
            dismissed: opened, noticeUntil: type === 'error' || duration === 0 ? Infinity : now + duration,
            expires: duration === 0 || type === 'loading' ? Infinity : now + duration,
            action: options.action || null });
        trim();
        render();
        return item.id;
    }
    function start(message, source = '任务') {
        const id = `task-${++sequence}`;
        post('loading', message, { id, source });
        let finished = false;
        return {
            update(message, progress) {
                if (finished) return;
                const item = records.find(row => row.id === id);
                if (!item) return;
                item.message = String(message); item.progress = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null;
                // Coalesce hot progress callbacks; never throttle completion.
                if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; render(); }, 100);
            },
            finish(message, type = 'success') {
                if (finished) return;
                finished = true; post(type, message, { id, source });
            }
        };
    }
    function choose() {
        return records.filter(item => item.active || item.expires > Date.now() || (item.type === 'error' && !item.read))
            .sort((a, b) => priority[b.type] - priority[a.type] || b.time - a.time || b.order - a.order)[0] || context;
    }
    function chooseNotice() {
        if (opened) return null;
        return [...records, context].filter(item => !item.dismissed && (item.noticeUntil > Date.now() || (holds.size && item === heldItem)))
            .sort((a, b) => priority[b.type] - priority[a.type] || b.time - a.time || b.order - a.order)[0] || null;
    }
    function positionSurfaces() {
        const bounds = display.getBoundingClientRect();
        const top = document.querySelector('header').getBoundingClientRect().bottom + 8;
        for (const [surface, width] of [[panel, 520], [bubble, 330]]) {
            const size = Math.min(width, window.innerWidth - 32);
            const left = Math.max(16, Math.min(bounds.left, window.innerWidth - size - 16));
            surface.style.left = `${left}px`; surface.style.top = `${top}px`;
            surface.style.maxHeight = `${Math.max(80, window.innerHeight - top - 16)}px`;
            if (surface === bubble) surface.style.setProperty('--bubble-tip', `${Math.max(16, Math.min(size - 24, bounds.left + bounds.width / 2 - left - 5))}px`);
        }
    }
    function render() {
        clearTimeout(timer);
        if (document.hidden) return;
        currentNotice = chooseNotice();
        if (holds.size && heldItem !== currentNotice) { heldItem = currentNotice; heldSince = Date.now(); }
        const item = currentNotice || choose();
        const unread = records.filter(row => !row.read).length;
        const important = records.some(row => !row.read && ['warning', 'error'].includes(row.type));
        const active = records.filter(row => row.active).length;
        display.className = `status-mascot status-${item.type}`;
        display.setAttribute('aria-label', `小猫助手：查看消息中心${unread ? `，${unread} 条未读消息` : ''}${active ? `，${active} 项任务进行中` : ''}。${item.message}`);
        display.title = `小猫助手 · 点击查看消息中心${item.message !== '就绪' ? '\n' + item.message : ''}`;
        $('statusUnread').hidden = !important;
        $('statusTaskCount').hidden = active < 2;
        $('statusTaskCount').textContent = active > 1 ? String(active) : '';
        $('statusText').textContent = item.message;
        $('statusBubbleLabel').textContent = `${labels[item.type]}${item.active && item.progress != null ? ` · ${Math.round(item.progress)}%` : ''}`;
        bubble.dataset.type = item.type;
        bubble.hidden = !currentNotice;
        if (currentNotice) {
            positionSurfaces();
            const reaction = `${item.id}:${item.order}`;
            if (reaction !== lastReaction) {
                lastReaction = reaction;
                $('statusAnnouncement').textContent = `${labels[item.type]}：${item.message}`;
                if (!reducedMotion.matches) {
                    const pose = display.querySelector('.cat-pose');
                    pose.getAnimations().forEach(animation => animation.cancel());
                    pose.animate(item.type === 'success'
                        ? [{ transform: 'translateY(0)' }, { transform: 'translateY(-5px)', offset: .4 }, { transform: 'translateY(0)' }]
                        : [{ transform: 'rotate(0)', transformOrigin: '32px 50px' }, { transform: 'rotate(-5deg)', transformOrigin: '32px 50px', offset: .4 }, { transform: 'rotate(0)', transformOrigin: '32px 50px' }],
                    { duration: 500, easing: 'ease-out' });
                }
            }
        }
        const progress = $('statusProgress');
        progress.hidden = !item.active;
        progress.classList.toggle('is-indeterminate', item.progress == null);
        progress.firstElementChild.style.transform = `scaleX(${item.progress == null ? 0.35 : item.progress / 100})`;
        $('statusPanelSummary').textContent = `${active} 项进行中 · ${records.length} 条记录`;
        if (opened) renderList();
        const next = [...records, context].flatMap(row => [row.expires, !(holds.size && row === heldItem) && !row.dismissed ? row.noticeUntil : null])
            .filter(time => Number.isFinite(time) && time > Date.now());
        if (next.length) timer = setTimeout(render, Math.max(1, Math.min(...next) - Date.now() + 1));
    }
    function hold(reason, enabled) {
        if (enabled) {
            if (!holds.size) { heldItem = currentNotice; heldSince = Date.now(); }
            holds.add(reason);
        } else {
            holds.delete(reason);
            if (!holds.size) {
                if (heldItem && Number.isFinite(heldItem.noticeUntil)) heldItem.noticeUntil += Date.now() - heldSince;
                heldItem = null;
            }
        }
        render();
    }
    function dismissNotice() {
        const focused = bubble.contains(document.activeElement);
        if (currentNotice) currentNotice.dismissed = true;
        holds.clear(); heldItem = null;
        render();
        if (focused) display.focus();
    }
    function renderList() {
        const list = $('statusList');
        const expanded = new Set([...list.querySelectorAll('details[open]')].map(el => el.dataset.id));
        const focused = document.activeElement;
        const focusId = focused?.closest('[data-id]')?.dataset.id;
        const focusAction = focused?.classList.contains('status-action');
        const scroll = list.scrollTop;
        const rows = records.filter(item => filter === 'all' || (filter === 'active' ? item.active : ['error', 'warning'].includes(item.type)))
            .slice().sort((a, b) => Number(b.active) - Number(a.active) || b.time - a.time || b.order - a.order);
        const fragment = document.createDocumentFragment();
        for (const item of rows) {
            const row = document.createElement('details');
            row.className = `status-record record-${item.type}`; row.dataset.id = item.id; row.open = expanded.has(item.id);
            const summary = document.createElement('summary');
            const meta = document.createElement('span'); meta.className = 'status-record-meta';
            meta.textContent = `${labels[item.type]} · ${item.source} · ${new Date(item.time).toLocaleTimeString('zh-CN', { hour12: false })}${item.count > 1 ? ` · ×${item.count}` : ''}`;
            const title = document.createElement('span'); title.className = 'status-record-title'; title.textContent = item.message;
            summary.append(meta, title); row.append(summary);
            const full = document.createElement('p'); full.className = 'status-record-full'; full.textContent = item.message; row.append(full);
            if (item.active) {
                const progress = document.createElement('progress'); progress.max = 100;
                progress.setAttribute('aria-label', item.message);
                if (item.progress != null) progress.value = item.progress;
                row.append(progress);
            }
            if (item.action?.run && item.action?.label) {
                const button = document.createElement('button'); button.className = 'status-action'; button.textContent = item.action.label;
                button.onclick = async () => { button.disabled = true; try { await item.action.run(); } catch (error) { post('error', error.message || '操作失败'); } finally { button.disabled = false; } };
                row.append(button);
            }
            fragment.append(row);
        }
        if (!rows.length) {
            const empty = document.createElement('p'); empty.className = 'status-empty';
            empty.textContent = filter === 'active' ? '暂无进行中的任务' : filter === 'attention' ? '暂无需要关注的消息' : '暂无消息，操作进度和结果将显示在这里';
            fragment.append(empty);
        }
        list.replaceChildren(fragment); list.scrollTop = scroll;
        if (focusId) {
            const row = [...list.children].find(el => el.dataset.id === focusId);
            row?.querySelector(focusAction ? 'button' : 'summary')?.focus({ preventScroll: true });
        }
    }
    function toggle(open = !opened, restoreFocus = true) {
        opened = open; panel.hidden = !open; display.setAttribute('aria-expanded', String(open));
        if (open) {
            positionSurfaces();
            records.forEach(item => { item.read = true; item.dismissed = true; });
            context.dismissed = true; holds.clear(); heldItem = null;
            records.filter(item => !item.active && item.id !== 'network').forEach(item => { item.expires = Math.min(item.expires, Date.now() + 4000); });
            render(); $('statusClose').focus();
        } else { render(); if (restoreFocus) display.focus(); }
    }
    display.addEventListener('click', () => toggle());
    $('statusClose').addEventListener('click', () => toggle(false));
    $('statusClear').addEventListener('click', () => {
        for (let i = records.length - 1; i >= 0; i--) if (!records[i].active) records.splice(i, 1);
        render();
    });
    panel.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
        filter = button.dataset.filter;
        panel.querySelectorAll('[data-filter]').forEach(el => el.setAttribute('aria-pressed', String(el === button)));
        renderList();
    }));
    $('statusBubbleOpen').addEventListener('click', () => {
        const notice = currentNotice;
        // Search context is transient; save it only when the user requests its details.
        const id = notice === context ? post(notice.type, notice.message, { source: '搜索' }) : notice?.id;
        toggle(true);
        // A previous filter must not hide the message the user just chose.
        filter = 'all';
        panel.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === 'all')));
        renderList();
        const row = [...$('statusList').children].find(el => el.dataset.id === id);
        if (row) { row.open = true; row.querySelector('summary').focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }); }
    });
    $('statusBubbleClose').addEventListener('click', dismissNotice);
    bubble.addEventListener('pointerenter', () => hold('pointer', true));
    bubble.addEventListener('pointerleave', () => hold('pointer', false));
    bubble.addEventListener('focusin', () => hold('focus', true));
    bubble.addEventListener('focusout', event => { if (!bubble.contains(event.relatedTarget)) hold('focus', false); });
    window.addEventListener('resize', positionSurfaces);
    document.addEventListener('pointerdown', event => { if (opened && !panel.contains(event.target) && !display.contains(event.target)) toggle(false, false); });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (opened) { event.preventDefault(); event.stopImmediatePropagation(); toggle(false); }
        else if (!bubble.hidden && (bubble.contains(document.activeElement) || document.activeElement === display)) { event.preventDefault(); dismissNotice(); }
    }, true);
    function syncMotion() {
        display.dataset.paused = String(document.hidden); bubble.dataset.paused = String(document.hidden);
        display.querySelector('.cat-pose').getAnimations().forEach(animation => {
            if (reducedMotion.matches) animation.cancel();
            else if (document.hidden) animation.pause();
            else if (animation.playState === 'paused') animation.play();
        });
        render();
    }
    document.addEventListener('visibilitychange', syncMotion);
    reducedMotion.addEventListener('change', syncMotion);
    window.StatusCenter = Object.freeze({ post, start, open: () => toggle(true),
        setContext(type, message) {
            if (context.type === type && context.message === message) return;
            context = { id: 'context', type, message, source: '搜索', time: Date.now(), order: ++sequence, noticeUntil: message === '就绪' || opened ? 0 : Date.now() + 4000 };
            render();
        },
        snapshot: () => records.map(({ action, ...item }) => ({ ...item })) });
    render();
})();
