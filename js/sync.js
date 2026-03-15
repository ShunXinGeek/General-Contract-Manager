// =======================================================
// sync.js - 同步滚动模块 (通用版)
// General Contract Shell
// =======================================================

// 每个合同独立的同步滚动状态（动态添加）
let syncStatePerContract = {};

/**
 * 内部函数：禁用同步滚动模式（不切换状态，直接禁用）
 * 用于 switchContract() 切换合同时保存状态
 */
function disableSyncModeInternal() {
    isSyncMode = false;

    // 移除滚动监听
    const main = document.getElementById('panelMain');
    const ref = document.getElementById('refContent');
    if (main) main.removeEventListener('scroll', handleMainScroll);
    if (ref) ref.removeEventListener('scroll', handleRefScroll);

    // 更新按钮状态
    const btn = document.getElementById('btnSync');
    if (btn) {
        btn.classList.remove('active');
        btn.innerText = '📜 同步';
    }

    // 隐藏固定标题
    const header = document.getElementById('refFixedHeader');
    if (header) {
        header.style.display = 'none';
    }
}

/**
 * 内部函数：启用同步滚动模式（不切换状态，直接启用）
 * 用于 switchContract() 切换合同时恢复状态
 */
function enableSyncModeInternal() {
    isSyncMode = true;

    // 渲染全部译文
    renderAllTranslations();

    // 添加滚动监听
    const main = document.getElementById('panelMain');
    const ref = document.getElementById('refContent');

    if (main && ref) {
        main.addEventListener('scroll', handleMainScroll);
        ref.addEventListener('scroll', handleRefScroll);
    }

    // 更新按钮状态
    const btn = document.getElementById('btnSync');
    if (btn) {
        btn.classList.add('active');
        btn.innerText = '📜 退出同步';
    }

    // 打开右侧栏
    if (typeof openSidePanel === 'function') {
        openSidePanel();
    }

    // 初始同步
    setTimeout(() => {
        if (typeof syncRefToMain === 'function') {
            syncRefToMain();
        }
    }, 100);
}

/**
 * 切换同步滚动模式
 */
function toggleSyncMode() {
    if (!activeContractKey || !fullClauseDatabase || Object.keys(fullClauseDatabase).length === 0) {
        if (typeof showError === 'function') showError('请先导入合同数据');
        return;
    }

    // 如果正在查看跨合同引用，先退出
    if (typeof resetCrossRefState === 'function') {
        resetCrossRefState();
    }

    isSyncMode = !isSyncMode;

    // 保存当前合同的同步状态
    if (activeContractKey) {
        syncStatePerContract[activeContractKey] = isSyncMode;
    }

    if (isSyncMode) {
        enableSyncModeInternal();
    } else {
        disableSyncModeInternal();
        // 显示默认提示
        const refContent = document.getElementById('refContent');
        if (refContent) {
            refContent.innerHTML = `<div style="padding:20px; text-align:center; color:#999; margin-top:50px;">同步模式已关闭</div>`;
        }
    }
}

/**
 * 渲染右侧全量译文列表
 */
function renderAllTranslations() {
    const content = document.getElementById('refContent');
    if (!content || !fullClauseDatabase) return;

    const header = document.getElementById('refFixedHeader');
    const titleEl = document.getElementById('refFixedTitle');
    if (header) {
        header.style.display = 'block';
        header.classList.remove('mode-ref', 'mode-trans');
        header.classList.add('mode-trans');
    }
    if (titleEl) {
        const langLabel = (typeof isTraditionalChinese !== 'undefined' && isTraditionalChinese) ? '繁體全文譯文' : '中文全文译文';
        titleEl.innerText = `📜 ${langLabel}（同步模式）`;
    }

    const sortedKeys = Object.keys(fullClauseDatabase).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    let html = '';
    sortedKeys.forEach(id => {
        const clause = fullClauseDatabase[id];
        const useTC = typeof isTraditionalChinese !== 'undefined' && isTraditionalChinese;
        const transText = useTC
            ? (clause.translation_tc || clause.translation)
            : clause.translation;

        html += `<div id="sync-trans-${id}" class="sync-trans-block" data-clause-id="${id}">
            <div class="sync-trans-title" onclick="scrollToClause('${id}')">${typeof sanitizeHtml === 'function' ? sanitizeHtml(clause.title) : clause.title}</div>
            <div class="sync-trans-content">${typeof sanitizeHtml === 'function' ? sanitizeHtml(transText || '<span style="color:#999;">(暂无译文)</span>') : (transText || '(暂无译文)')}</div>
        </div>`;
    });

    content.innerHTML = html;
}

// 滚动锁定变量
let syncScrollLock = false;

/**
 * 主屏滚动事件处理 (Main -> Ref)
 */
function handleMainScroll() {
    if (!isSyncMode || syncScrollLock) return;
    syncScrollLock = true;
    requestAnimationFrame(() => {
        syncRefToMain();
        setTimeout(() => { syncScrollLock = false; }, 50);
    });
}

/**
 * 副屏滚动事件处理 (Ref -> Main)
 */
function handleRefScroll() {
    if (!isSyncMode || syncScrollLock) return;
    syncScrollLock = true;
    requestAnimationFrame(() => {
        syncMainToRef();
        setTimeout(() => { syncScrollLock = false; }, 50);
    });
}

/**
 * 左 带动 右
 */
function syncRefToMain() {
    const main = document.getElementById('panelMain');
    const ref = document.getElementById('refContent');
    if (!main || !ref) return;

    // 找到当前可见的条款
    const clauses = main.querySelectorAll('[id^="clause-"]');
    let visibleClauseId = null;
    let visibleRatio = 0;

    for (const clause of clauses) {
        const rect = clause.getBoundingClientRect();
        const mainRect = main.getBoundingClientRect();

        if (rect.top < mainRect.bottom && rect.bottom > mainRect.top) {
            const visibleTop = Math.max(rect.top, mainRect.top);
            const visibleBottom = Math.min(rect.bottom, mainRect.bottom);
            const ratio = (visibleBottom - visibleTop) / (mainRect.bottom - mainRect.top);

            if (ratio > visibleRatio) {
                visibleRatio = ratio;
                visibleClauseId = clause.id.replace('clause-', '');
            }
        }
    }

    if (visibleClauseId) {
        const transBlock = document.getElementById(`sync-trans-${visibleClauseId}`);
        if (transBlock) {
            // 计算主屏条款的滚动比例
            const clauseEl = document.getElementById(`clause-${visibleClauseId}`);
            const mainRect = main.getBoundingClientRect();
            const clauseRect = clauseEl.getBoundingClientRect();
            const progress = (mainRect.top - clauseRect.top) / clauseRect.height;

            // 应用同比例到右侧
            const transRect = transBlock.getBoundingClientRect();
            const targetScroll = transBlock.offsetTop - ref.offsetTop + (progress * transRect.height);

            syncScrollLock = true;
            ref.scrollTop = targetScroll;
            setTimeout(() => { syncScrollLock = false; }, 100);
        }
    }
}

/**
 * 右 带动 左 (逻辑同上，只是反过来)
 */
function syncMainToRef() {
    const main = document.getElementById('panelMain');
    const ref = document.getElementById('refContent');
    if (!main || !ref) return;

    const transBlocks = ref.querySelectorAll('.sync-trans-block');
    let visibleId = null;
    let visibleRatio = 0;
    const refRect = ref.getBoundingClientRect();

    for (const block of transBlocks) {
        const rect = block.getBoundingClientRect();
        if (rect.top < refRect.bottom && rect.bottom > refRect.top) {
            const visibleTop = Math.max(rect.top, refRect.top);
            const visibleBottom = Math.min(rect.bottom, refRect.bottom);
            const ratio = (visibleBottom - visibleTop) / (refRect.bottom - refRect.top);

            if (ratio > visibleRatio) {
                visibleRatio = ratio;
                visibleId = block.dataset.clauseId;
            }
        }
    }

    if (visibleId) {
        const clauseEl = document.getElementById(`clause-${visibleId}`);
        if (clauseEl) {
            const transBlock = document.getElementById(`sync-trans-${visibleId}`);
            const transRect = transBlock.getBoundingClientRect();
            const progress = (refRect.top - transRect.top) / transRect.height;

            const clauseRect = clauseEl.getBoundingClientRect();
            const targetScroll = clauseEl.offsetTop - main.offsetTop + (progress * clauseRect.height);

            syncScrollLock = true;
            main.scrollTop = targetScroll;
            setTimeout(() => { syncScrollLock = false; }, 100);
        }
    }
}
