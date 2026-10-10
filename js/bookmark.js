// =======================================================
// bookmark.js - 书签功能模块
// HK Contract Manager V5.2
// =======================================================

let activeBookmarkUid = null;

/**
 * 初始化书签列表
 */
function initBookmarks() {
    const list = document.getElementById('navList');
    list.innerHTML = "";

    if (!savedBookmarks || savedBookmarks.length === 0) {
        savedBookmarks = Object.keys(fullClauseDatabase)
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map(id => ({
                id: id,
                label: fullClauseDatabase[id].title,
                uid: Date.now() + Math.random().toString(36).substr(2, 9),
                level: 0,
                collapsed: false
            }));
        activeBookmarkUid = null;
    } else if (activeBookmarkUid && !savedBookmarks.some(b => b.uid === activeBookmarkUid)) {
        activeBookmarkUid = null;
    }

    let currentParentCollapsed = false;
    savedBookmarks.forEach((item, idx) => {
        if (typeof item.level === 'undefined') item.level = 0;
        if (typeof item.collapsed === 'undefined') item.collapsed = false;

        if (item.level === 0) {
            currentParentCollapsed = item.collapsed;
        }

        const isHidden = (item.level === 1 && currentParentCollapsed);

        const div = document.createElement('div');
        div.className = `nav-item level-${item.level}`;
        if (isHidden) div.classList.add('hidden');
        if (item.uid === activeBookmarkUid) div.classList.add('active');

        div.draggable = !isDeleteMode;
        div.dataset.index = idx;

        let toggleHtml = '';
        const nextItem = savedBookmarks[idx + 1];
        if (item.level === 0 && nextItem && nextItem.level === 1) {
            const rotateClass = item.collapsed ? 'rotated' : '';
            toggleHtml = `<span class="toggle-icon ${rotateClass}" onclick="toggleFold(${idx}, event)">▼</span>`;
        } else if (item.level === 0) {
            toggleHtml = `<span class="toggle-icon" style="opacity:0">▼</span>`;
        }

        div.innerHTML = `
                ${toggleHtml}
                <span class="label-text">${item.label}</span>
                <span class="item-tools">
                    <span class="tool-icon edit-btn" onclick="enableRename(this, ${idx})">✎</span>
                    <span class="tool-icon delete-btn" onclick="removeBookmark(event, '${item.uid}')">🗑️</span>
                </span>
            `;

        // 绑定整个 div 的点击事件，提升用户体验并避免单引号导致的语法错误
        div.addEventListener('click', function (e) {
            // 如果点击的是编辑、删除或折叠按钮，则不触发滚动/选中
            if (e.target.closest('.tool-icon') || e.target.closest('.toggle-icon')) {
                return;
            }
            scrollToClause(item.id, div);
        });

        if (!isDeleteMode) {
            div.addEventListener('dragstart', handleDragStart);
            div.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; });
            div.addEventListener('drop', handleDrop);
        }
        list.appendChild(div);
    });
}

/**
 * 切换书签折叠状态
 */
function toggleFold(idx, event) {
    event.stopPropagation();
    if (savedBookmarks[idx].level === 0) {
        savedBookmarks[idx].collapsed = !savedBookmarks[idx].collapsed;
        initBookmarks();
    }
}

/**
 * 改变书签层级
 */
function changeLevelActive(dir) {
    const activeEl = document.querySelector('.nav-item.active');
    if (!activeEl) {
        CustomDialog.alert("请先点击选择一个书签，然后再调整层级。");
        return;
    }
    const idx = parseInt(activeEl.dataset.index);
    if (dir === -1) {
        indentBookmark(idx);
    } else {
        outdentBookmark(idx);
    }
    initBookmarks();
}

/**
 * 提升书签层级 (变为0级)
 */
function indentBookmark(idx) {
    savedBookmarks[idx].level = 0;
}

/**
 * 降低书签层级 (变为1级)
 */
function outdentBookmark(idx) {
    savedBookmarks[idx].level = 1;
}

/**
 * 拖拽开始处理
 */
function handleDragStart(e) {
    e.dataTransfer.setData('text/plain', this.dataset.index);
}

/**
 * 拖拽放下处理
 */
function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    const src = parseInt(e.dataTransfer.getData('text/plain'));
    const tgt = parseInt(this.dataset.index);

    if (src !== tgt) {
        const m = savedBookmarks[src];
        savedBookmarks.splice(src, 1);
        savedBookmarks.splice(tgt, 0, m);
        if (savedBookmarks.length > 0 && savedBookmarks[0].level === 1) {
            savedBookmarks[0].level = 0;
        }
        initBookmarks();
    }
    return false;
}

/**
 * 添加新书签
 */
async function addNewBookmark() {
    const id = getCurrentVisibleClauseId();
    if (!id) return;
    const clauseTitle = fullClauseDatabase[id].title;
    // 在弹出命名对话框前记录正文位置，避免焦点变化影响定位。
    const anchor = captureBookmarkAnchor(id);
    await saveBookmarkAction(id, clauseTitle, anchor);
}

/**
 * 保存书签动作
 */
async function saveBookmarkAction(clauseId, clauseTitle, anchor) {
    let name = await CustomDialog.prompt("添加书签:", clauseTitle);
    if (name === null) return;
    if (name.trim() === "") name = clauseTitle;

    const bm = { id: clauseId, label: name.trim(), uid: Date.now() + Math.random().toString(36).substr(2, 9), level: 0, collapsed: false, anchor };
    let idx = -1;
    savedBookmarks.forEach((b, i) => { if (b.id === clauseId) idx = i });
    if (idx !== -1) savedBookmarks.splice(idx + 1, 0, bm);
    else savedBookmarks.unshift(bm);
    if (savedBookmarks.length > 0 && savedBookmarks[0].level === 1) savedBookmarks[0].level = 0;
    initBookmarks();
    if (activeContractKey && contracts[activeContractKey]) {
        contracts[activeContractKey].bookmarks = savedBookmarks;
        await saveContractsToStorage();
    }
}

/**
 * 获取当前可见的条款 ID
 */
function getCurrentVisibleClauseId() {
    const main = document.getElementById('panelMain');
    if (!main) return null;
    const panel = main.getBoundingClientRect();
    const readingLine = Math.min(panel.top + 12, panel.bottom - 1);
    for (const c of main.querySelectorAll('[id^="clause-"]')) {
        const r = c.getBoundingClientRect();
        if (r.top <= readingLine && r.bottom > readingLine) return c.id.replace('clause-', '');
        if (r.top > readingLine && r.top < panel.bottom) return c.id.replace('clause-', '');
    }
    return null;
}

/**
 * 记录条款正文首个可见字的位置。正文的文字偏移不受换行和标记样式影响。
 */
function captureBookmarkAnchor(id) {
    const main = document.getElementById('panelMain');
    const clause = document.getElementById('clause-' + id);
    const body = clause?.querySelector('.clause-text');
    if (!main || !body) return { version: 1, kind: 'heading' };

    const panel = main.getBoundingClientRect();
    const readingLine = Math.min(panel.top + 12, panel.bottom - 1);
    if (body.getBoundingClientRect().top > readingLine) return { version: 1, kind: 'heading' };

    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node;
    let precedingLength = 0;
    while ((node = walker.nextNode())) {
        const value = node.nodeValue || '';
        if (!value.trim()) { precedingLength += value.length; continue; }
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
            if (rect.bottom <= readingLine || rect.top >= panel.bottom || !rect.width) continue;
            const y = Math.max(rect.top + 1, readingLine + 1);
            const position = document.caretPositionFromPoint?.(rect.left + 2, y);
            const caret = document.caretRangeFromPoint?.(rect.left + 2, y) ||
                (position && { startContainer: position.offsetNode, startOffset: position.offset });
            if (!caret || caret.startContainer.nodeType !== Node.TEXT_NODE || !body.contains(caret.startContainer)) continue;

            let offset = precedingLength;
            if (caret.startContainer === node) {
                offset += Math.min(caret.startOffset, Math.max(0, value.length - 1));
            } else {
                const count = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
                let part;
                offset = 0;
                while ((part = count.nextNode()) && part !== caret.startContainer) offset += part.nodeValue.length;
                if (!part) continue;
                offset += Math.min(caret.startOffset, Math.max(0, part.nodeValue.length - 1));
            }
            const text = body.textContent || '';
            return {
                version: 1, kind: 'text', offset,
                quote: text.slice(offset, offset + 64),
                prefix: text.slice(Math.max(0, offset - 32), offset),
                suffix: text.slice(offset + 64, offset + 96)
            };
        }
        precedingLength += value.length;
    }
    return { version: 1, kind: 'heading' };
}

/** 找回文字锚点；重复文字须有足够上下文才能判定。 */
function resolveBookmarkOffset(text, anchor) {
    if (!anchor || anchor.kind !== 'text' || !anchor.quote) return null;
    const { quote, prefix = '', suffix = '' } = anchor;
    const original = anchor.offset;
    if (Number.isInteger(original) && original >= 0 && text.slice(original, original + quote.length) === quote &&
        text.slice(Math.max(0, original - prefix.length), original) === prefix &&
        text.slice(original + quote.length, original + quote.length + suffix.length) === suffix) return original;

    const matches = [];
    let at = -1;
    while ((at = text.indexOf(quote, at + 1)) !== -1) matches.push(at);
    if (matches.length === 1) return matches[0];
    if (!matches.length) return null;

    const ranked = matches.map(offset => {
        const before = text.slice(Math.max(0, offset - prefix.length), offset);
        const after = text.slice(offset + quote.length, offset + quote.length + suffix.length);
        let score = 0;
        while (score < prefix.length && before[before.length - 1 - score] === prefix[prefix.length - 1 - score]) score++;
        let following = 0;
        while (following < suffix.length && after[following] === suffix[following]) following++;
        return { offset, score: score + following };
    }).sort((a, b) => b.score - a.score);
    return ranked[0].score >= Math.min(8, prefix.length + suffix.length) && ranked[0].score > ranked[1].score
        ? ranked[0].offset : null;
}

/** 以当前 DOM 的文字 Range 计算滚动位置。 */
function getBookmarkTargetRect(body, offset) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    let remaining = offset;
    while ((node = walker.nextNode())) {
        if (remaining >= node.nodeValue.length) { remaining -= node.nodeValue.length; continue; }
        const range = document.createRange();
        range.setStart(node, remaining);
        range.setEnd(node, remaining + 1);
        return range.getClientRects()[0] || null;
    }
    return null;
}

/**
 * 切换删除模式
 */
function toggleDeleteMode() {
    isDeleteMode = !isDeleteMode;
    document.getElementById('navList').classList.toggle('delete-mode');
    document.getElementById('btnDeleteMode').classList.toggle('active');
    initBookmarks();
}

/**
 * 删除书签
 */
async function removeBookmark(event, uid) {
    event.stopPropagation();
    const isDelete = await CustomDialog.confirm("确定删除此书签?", "删除警告");
    if (isDelete) {
        const idx = savedBookmarks.findIndex(b => b.uid === uid);
        if (idx !== -1) {
            savedBookmarks.splice(idx, 1);
            initBookmarks();
        }
    }
}

/**
 * 启用书签重命名
 */
function enableRename(btn, idx) {
    const itemDiv = btn.closest('.nav-item');
    const textSpan = itemDiv.querySelector('.label-text');
    const txt = textSpan.innerText;
    textSpan.innerHTML = `<input value="${txt}" onblur="finishRename(${idx}, this.value)" onkeydown="if(event.key==='Enter')this.blur()" onclick="event.stopPropagation()">`;
    textSpan.querySelector('input').focus();
}

/**
 * 完成书签重命名
 */
function finishRename(idx, val) {
    savedBookmarks[idx].label = val;
    initBookmarks();
}

/**
 * 重置书签
 */
async function confirmResetBookmarks() {
    const isReset = await CustomDialog.confirm("确定重置所有书签吗? ⚠️这会清空现有的书签树", "重置确认");
    if (isReset) {
        savedBookmarks = null;
        initBookmarks();
    }
}
