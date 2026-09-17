// =======================================================
// comparison.js - 版本对比模块
// HK Contract Manager V5.2
// =======================================================

// 原始正文随条款 originalContent 持久化；ORIGINAL_CONTRACTS 只是运行时视图。
function restoreContractOriginals(contractKey) {
    if (!contracts[contractKey]?.data) return;
    if (typeof ORIGINAL_CONTRACTS === 'undefined') window.ORIGINAL_CONTRACTS = {};
    const originalData = {};
    let migrated = 0;
    Object.entries(contracts[contractKey].data).forEach(([id, clause]) => {
        // 旧快照未保存导入基线，无法还原升级前的原文，以现存正文为迁移基线。
        if (typeof clause.originalContent !== 'string') {
            clause.originalContent = clause.content || '';
            clause.originalBaselineMigrated = true;
            migrated++;
        }
        originalData[id] = { ...clause, content: clause.originalContent };
    });
    ORIGINAL_CONTRACTS[contractKey] = { data: originalData };
    if (migrated) console.info(`[comparison] ${contractKey}: ${migrated} 条旧数据以当前正文建立基线`);
}

function getOriginalClause(contractKey, clauseId) {
    if (typeof ORIGINAL_CONTRACTS === 'undefined') return null;
    const original = ORIGINAL_CONTRACTS[contractKey];
    return original?.data?.[clauseId] || original?.[clauseId] || null;
}

/**
 * 检查条款是否被修改过
 * 通过比较当前内容与 ORIGINAL_CONTRACTS 中的原始内容
 */
function checkClauseModified(clauseId) {
    // 检查 ORIGINAL_CONTRACTS 是否存在
    if (typeof ORIGINAL_CONTRACTS === 'undefined' || !ORIGINAL_CONTRACTS[activeContractKey]) {
        return false;
    }

    const originalClause = getOriginalClause(activeContractKey, clauseId);
    const currentClause = fullClauseDatabase[clauseId];

    if (!originalClause || !currentClause) return false;

    // [V5.7] 规范化文本：去除空白差异，并移除 autoLinkClauses() 自动添加的 .clause-ref 包装
    const normalizeText = (text) => {
        if (!text) return '';
        // 1. 移除 autoLinkClauses() 添加的带有 clause-ref 类的 span 标签
        //    匹配任意属性顺序的 span 标签，保留内部文本内容
        let normalized = text.replace(/<span[^>]*\bclass=["']clause-ref["'][^>]*>(.*?)<\/span>/gi, '$1');
        // 2. 去除多余空白
        normalized = normalized.replace(/\s+/g, ' ').trim();
        return normalized;
    };

    return normalizeText(originalClause.content) !== normalizeText(currentClause.content);
}

/**
 * 显示原文对比弹窗
 */
function showOriginalCompare(clauseId) {
    if (typeof ORIGINAL_CONTRACTS === 'undefined' || !ORIGINAL_CONTRACTS[activeContractKey]) {
        showError('无法加载原始数据');
        return;
    }

    const originalClause = getOriginalClause(activeContractKey, clauseId);
    const currentClause = fullClauseDatabase[clauseId];

    if (!originalClause || !currentClause) {
        showError('无法加载条款数据');
        return;
    }

    // 创建对比弹窗
    const modal = document.createElement('div');
    modal.className = 'compare-modal';
    modal.innerHTML = `
        <div class="compare-modal-content">
            <div class="compare-modal-header">
                <h3>📋 ${escapeHtml(currentClause.title)} - 原文对比</h3>
                <button class="compare-close-btn" onclick="this.closest('.compare-modal').remove()">×</button>
            </div>
            <div class="compare-body">
                <div class="compare-column">
                    <div class="compare-column-header">📄 原始版本</div>
                    <div class="compare-column-content">${sanitizeHtml(originalClause.content)}</div>
                </div>
                <div class="compare-column">
                    <div class="compare-column-header">✏️ 当前版本</div>
                    <div class="compare-column-content">${sanitizeHtml(currentClause.content)}</div>
                </div>
            </div>
            <div class="compare-footer">
                <button class="btn-revert">↩ 恢复原文</button>
                <button class="btn-close" onclick="this.closest('.compare-modal').remove()">关闭</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    modal.querySelector('.btn-revert').onclick = () => revertToOriginal(clauseId);

    // 点击遮罩关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

/**
 * 恢复条款到原始版本
 */
async function revertToOriginal(clauseId) {
    if (typeof ORIGINAL_CONTRACTS === 'undefined' || !ORIGINAL_CONTRACTS[activeContractKey]) {
        showError('无法找到原始数据');
        return;
    }

    const originalClause = getOriginalClause(activeContractKey, clauseId);

    if (!originalClause) {
        showError('无法找到原始数据');
        return;
    }

    if (!confirm('确定要恢复到原始版本吗？当前的修改将会丢失。')) {
        return;
    }

    // 恢复内容
    fullClauseDatabase[clauseId].content = originalClause.content;
    fullClauseDatabase[clauseId].modifiedAt = Date.now();

    // 更新 DOM
    const clauseEl = document.querySelector(`#clause-${clauseId} .clause-text`);
    if (clauseEl) {
        clauseEl.innerHTML = sanitizeHtml(originalClause.content);
    }

    // 移除修改标记
    const badge = document.querySelector(`#clause-${clauseId} .btn-modified`);
    if (badge) badge.remove();

    // 关闭弹窗
    document.querySelector('.compare-modal')?.remove();

    markAsUnsaved();
    updateLocalModificationTime();
    if (await autoSave()) showSuccess('已恢复原文', 2000);
    else showError('原文已恢复，但保存失败，请重试保存');
}

/**
 * 动态更新条款的修改标记
 */
function updateModifiedBadge(clauseId) {
    const clauseDiv = document.getElementById(`clause-${clauseId}`);
    if (!clauseDiv) return;

    const headerDiv = clauseDiv.querySelector('div[style*="border-bottom"]');
    if (!headerDiv) return;

    const isModified = checkClauseModified(clauseId);
    const existingBadge = headerDiv.querySelector('.btn-modified');

    if (isModified && !existingBadge) {
        // 需要添加徽章
        const badge = document.createElement('button');
        badge.className = 'btn-modified';
        badge.onclick = () => showOriginalCompare(clauseId);
        badge.setAttribute('title', '点击查看原文对比');
        badge.innerHTML = '⚡ 已修改';

        // 插入到 h2 后面
        const h2 = headerDiv.querySelector('h2');
        if (h2 && h2.nextSibling) {
            headerDiv.insertBefore(badge, h2.nextSibling);
        } else {
            headerDiv.appendChild(badge);
        }
    } else if (!isModified && existingBadge) {
        // 需要移除徽章
        existingBadge.remove();
    }
}
