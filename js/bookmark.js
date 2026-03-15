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
    await saveBookmarkAction(id, clauseTitle);
}

/**
 * 保存书签动作
 */
async function saveBookmarkAction(clauseId, clauseTitle) {
    let name = await CustomDialog.prompt("添加书签:", clauseTitle);
    if (name === null) return;
    if (name.trim() === "") name = clauseTitle;

    const bm = { id: clauseId, label: name.trim(), uid: Date.now() + Math.random().toString(36).substr(2, 9), level: 0, collapsed: false };
    let idx = -1;
    savedBookmarks.forEach((b, i) => { if (b.id === clauseId) idx = i });
    if (idx !== -1) savedBookmarks.splice(idx + 1, 0, bm);
    else savedBookmarks.unshift(bm);
    if (savedBookmarks.length > 0 && savedBookmarks[0].level === 1) savedBookmarks[0].level = 0;
    initBookmarks();
}

/**
 * 获取当前可见的条款 ID
 */
function getCurrentVisibleClauseId() {
    const main = document.getElementById('panelMain');
    for (let c of main.querySelectorAll('[id^="clause-"]')) {
        const r = c.getBoundingClientRect();
        if ((r.top >= 50 && r.top < main.clientHeight) || (r.top < 50 && r.bottom > 100)) return c.id.replace('clause-', '');
    }
    return null;
}

/**
 * 滚动到指定条款
 */
function scrollToClause(id, el) {
    if (isDeleteMode) return;
    const clauseEl = document.getElementById('clause-' + id);
    if (clauseEl) {
        clauseEl.scrollIntoView({ behavior: 'auto', block: 'start' });
    } else {
        console.warn('未找到对应的条款元素: clause-' + id);
    }
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (el) {
        // 兼容传入的 el 是 div.nav-item 或是内部元素的情况
        let navItem = el.classList && el.classList.contains('nav-item') ? el : el.closest('.nav-item');
        if (navItem) {
            navItem.classList.add('active');
            let idx = parseInt(navItem.dataset.index);
            if (!isNaN(idx) && savedBookmarks && savedBookmarks[idx]) {
                activeBookmarkUid = savedBookmarks[idx].uid;
            }
        }
    }
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
