// =======================================================
// editor.js - 编辑模式、备注、自动保存、导入导出
// 依赖：app.js (editableContracts, fullClauseDatabase, activeContractKey,
//        contracts, savedBookmarks, currentThemeIndex, AUTO_SAVE_KEY,
//        AUTO_SAVE_INTERVAL, hasUnsavedChanges, lastSavedTime)
//       utils.js (showSuccess)
// 须在 app.js 之后加载
// =======================================================

// =======================================================
// 12b. 备注系统
// =======================================================
function getClauseTextForNode(node) {
    const element = node?.nodeType === 3 ? node.parentElement : node;
    return element?.closest?.('.clause-text') || element?.closest?.('.translation-text') || null;
}

function getContractTextSource(body) {
    const { translationClause, translationField, translationContract } = body.dataset;
    return translationField ? {
        key: translationContract ? decodeURIComponent(translationContract) : activeContractKey,
        id: decodeURIComponent(translationClause), field: translationField
    } : { key: activeContractKey, id: body.parentElement.id.slice('clause-'.length), field: 'content' };
}

function captureNoteSelection() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) return null;

    const range = selection.getRangeAt(0);
    const clauseText = getClauseTextForNode(range.startContainer);
    if (!clauseText || clauseText !== getClauseTextForNode(range.endContainer)) return null;

    return { range: range.cloneRange(), clauseText };
}

function isCapturedNoteSelectionValid(snapshot) {
    if (!snapshot?.clauseText?.isConnected) return false;
    const { range, clauseText } = snapshot;
    return getClauseTextForNode(range.startContainer) === clauseText &&
        getClauseTextForNode(range.endContainer) === clauseText;
}

function getNoteInSelection(snapshot) {
    if (!isCapturedNoteSelectionValid(snapshot)) return null;
    const { range, clauseText } = snapshot;
    const notes = [...(clauseText.querySelectorAll?.('.note-span') || [])].filter(note => range.intersectsNode(note));
    return notes.length === 1 ? notes[0] : null;
}

function deleteNote(noteSpan) {
    if (!noteSpan?.isConnected) return;
    const clauseText = getClauseTextForNode(noteSpan);
    if (!clauseText) return;
    noteSpan.replaceWith(...noteSpan.childNodes);
    clauseText.normalize();
    handleEditorMutation(clauseText);
}

async function addOrEditNote(snapshot = captureNoteSelection()) {
    if (!snapshot) {
        showError('请选择同一条款中的连续文本后再添加备注。');
        return;
    }
    const noteSpan = getNoteInSelection(snapshot);

    if (noteSpan) {
        const oldText = noteSpan.getAttribute('data-note');
        const newText = await CustomDialog.prompt('编辑备注:', oldText);
        if (newText === null || !noteSpan.isConnected) return;
        if (newText.trim() === '') {
            deleteNote(noteSpan);
        } else {
            noteSpan.setAttribute('data-note', newText);
            handleEditorMutation(noteSpan);
        }
    } else {
        const newText = await CustomDialog.prompt('添加备注:', '');
        if (!newText || newText.trim() === '') return;
        if (!isCapturedNoteSelectionValid(snapshot)) {
            showError('所选文本已变化或已切换条款，请重新选择文本后添加备注。');
            return;
        }

        const span = document.createElement('span');
        span.className = 'note-span';
        span.setAttribute('data-note', newText);
        try {
            snapshot.range.surroundContents(span);
            window.getSelection().removeAllRanges();
            handleEditorMutation(span);
        } catch (e) {
            console.warn('备注添加失败:', e);
            showError('所选内容跨越了复杂格式，暂无法添加备注。请重新选择连续文本。');
        }
    }
}

// 备注气泡 Tooltip
document.addEventListener('mouseover', e => {
    if (e.target.classList && e.target.classList.contains('note-span')) {
        let tip = document.getElementById('noteTooltip');
        if (!tip) { tip = document.createElement('div'); tip.id = 'noteTooltip'; tip.className = 'note-tooltip'; document.body.appendChild(tip); }
        tip.innerText = e.target.getAttribute('data-note') || '';
        tip.style.display = 'block';
        const rect = e.target.getBoundingClientRect();
        tip.style.left = rect.left + 'px';
        tip.style.top = (rect.bottom + 5) + 'px';
    }
});
document.addEventListener('mouseout', e => {
    if (e.target.classList && e.target.classList.contains('note-span')) {
        const tip = document.getElementById('noteTooltip');
        if (tip) tip.style.display = 'none';
    }
});

// =======================================================
// 13. 编辑模式
// =======================================================
function toggleEditMode() {
    if (!activeContractKey || isAssistantMode) return;
    const contract = contracts[activeContractKey];
    if (!contract) return;
    if (editableContracts.has(contract)) {
        editableContracts.delete(contract);
        if (hasUnsavedChanges) scheduleEditorSave(true);
    } else {
        editableContracts.add(contract);
        CustomDialog.alert('✏️ 编辑模式已开启');
    }
    updateEditModeUI();
}

document.addEventListener('paste', function (e) {
    if (!e.target.closest('.clause-text[contenteditable="true"], .translation-text[contenteditable="true"]')) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
});

// =======================================================
// 22. 导出/导入用户修改（通用版）
// =======================================================
function getPersistableClauseContent(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('.search-highlight').forEach(mark => mark.replaceWith(...mark.childNodes));
    clone.querySelectorAll('.clause-ref').forEach(link => {
        link.replaceWith(document.createTextNode(link.textContent));
    });
    return clone.innerHTML;
}

function captureCurrentContent({ target = null, recordHistory = false, group = '' } = {}) {
    if (!activeContractKey || contracts[activeContractKey]?.data !== fullClauseDatabase) return false;
    const now = Date.now();
    let changed = false;
    const bodies = target ? [target] : document.querySelectorAll('.clause-text');
    bodies.forEach(d => {
        const id = d.parentElement.id.replace('clause-', '');
        if (fullClauseDatabase[id]) {
            const newContent = getPersistableClauseContent(d);
            if (!sameClauseContent(fullClauseDatabase[id].content, newContent)) {
                const clause = fullClauseDatabase[id];
                if (recordHistory) recordClauseEdit(id, clause, newContent, clause.reviewTags, group);
                clause.content = newContent;
                clause.modifiedAt = Math.max(now, (clause.modifiedAt || 0) + 1);
                updateModifiedBadge(id);
                changed = true;
            }
        }
    });
    if (changed && typeof updateLocalModificationTime === 'function') updateLocalModificationTime();
    return changed;
}

function hasUserModifications(content, clause = null, contractKey = null, clauseId = null) {
    if (clause?.modifiedAt) return true;
    if (!content) return false;

    const originalClause = contractKey ? getOriginalClause(contractKey, clauseId) : null;
    if (originalClause) {
        const normalize = value => String(value || '')
            .replace(/<span[^>]*\bclass=["']clause-ref["'][^>]*>(.*?)<\/span>/gi, '$1')
            .replace(/\s+/g, ' ')
            .trim();
        return normalize(content) !== normalize(originalClause.content);
    }

    // 旧版快照没有 modifiedAt 或原始基线时，保留对历史格式修改的兼容识别。
    if (content.includes('class="note-span"') || content.includes("class='note-span'")) return true;
    if (content.includes('background-color:') || content.includes('background:')) return true;
    if (content.includes('color:') && !content.includes('color: var(')) return true;
    if (/<\/?(b|strong|i|em|u|s|strike)(\s|>)/i.test(content)) return true;
    if (content.includes('<font')) return true;
    return false;
}

function extractUserModifications(contractKey, includeTranslations) {
    if (contractKey === activeContractKey) captureCurrentContent();
    const modifications = {};
    const contractData = contracts[contractKey].data;
    Object.keys(contractData).forEach(id => {
        const clause = contractData[id];
        if (!clause) return;
        const modification = includeTranslations ? getTranslationModifications(clause) : {};
        if (hasUserModifications(clause.content, clause, contractKey, id)) {
            if (!clause.modifiedAt) clause.modifiedAt = Date.now();
            modification.content = clause.content || '';
            modification.modifiedAt = clause.modifiedAt;
            if (Array.isArray(clause.reviewTags)) modification.reviewTags = clause.reviewTags;
        }
        if (Object.keys(modification).length) modifications[id] = modification;
    });
    return modifications;
}

function extractAllUserModifications({ includeTranslations = true } = {}) {
    const all = {};
    Object.keys(contracts).forEach(key => {
        const mods = extractUserModifications(key, includeTranslations);
        if (Object.keys(mods).length > 0) all[key] = mods;
    });
    return all;
}

function exportData() {
    captureCurrentContent();
    contracts[activeContractKey].bookmarks = savedBookmarks;
    const allMods = extractAllUserModifications();
    const allBookmarks = {};
    Object.keys(contracts).forEach(key => {
        let bm = contracts[key].bookmarks;
        if (!bm || bm.length === 0) {
            const data = contracts[key].data;
            if (data && Object.keys(data).length > 0) {
                bm = Object.keys(data).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                    .map(id => ({ id, label: data[id].title, uid: Date.now() + Math.random().toString(36).substr(2, 9), level: 0, collapsed: false }));
            }
        }
        if (bm && bm.length > 0) allBookmarks[key] = bm;
    });
    let totalModCount = 0; const modSummary = [];
    Object.keys(allMods).forEach(k => { const c = Object.keys(allMods[k]).length; totalModCount += c; modSummary.push(k + ': ' + c + '个条款'); });
    let totalBookmarkCount = 0;
    Object.keys(allBookmarks).forEach(k => { totalBookmarkCount += allBookmarks[k].length; });
    const snapshot = { version: '4.4', type: 'all_user_modifications', timestamp: Date.now(), modifications: allMods, bookmarks: allBookmarks, theme: currentThemeIndex };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = 'Contract_AllMods_' + totalModCount + 'clauses_' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    CustomDialog.alert('导出成功！\n\n' + modSummary.join('\n') + '\n合计：' + totalModCount + '个条款修改，' + totalBookmarkCount + '个书签');
}

function handleFileSelect(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const snapshot = JSON.parse(e.target.result);
            if (snapshot.version === '4.4' && snapshot.type === 'all_user_modifications') {
                const isApply = await CustomDialog.confirm('检测到用户修改备份，是否应用？');
                if (isApply) {
                    if (snapshot.modifications) {
                        Object.keys(snapshot.modifications).forEach(key => {
                            if (contracts[key]) {
                                Object.keys(snapshot.modifications[key]).forEach(id => {
                                    const clause = contracts[key].data[id];
                                    if (!clause) return;
                                    const modification = snapshot.modifications[key][id];
                                    if (typeof modification.content === 'string') {
                                        clause.content = modification.content;
                                        if (Array.isArray(modification.reviewTags)) {
                                            clause.reviewTags = modification.reviewTags;
                                            clause.modifiedAt = Date.now();
                                        }
                                    }
                                    applyTranslationModifications(clause, modification, true);
                                });
                            }
                        });
                    }
                    if (snapshot.bookmarks) {
                        Object.keys(snapshot.bookmarks).forEach(key => {
                            if (contracts[key]) contracts[key].bookmarks = snapshot.bookmarks[key];
                        });
                    }
                    fullClauseDatabase = contracts[activeContractKey].data;
                    savedBookmarks = contracts[activeContractKey].bookmarks;
                    renderMainDocument();
                    refreshRenderedTranslations();
                    if (typeof initBookmarks === 'function') initBookmarks();
                    buildReverseIndex();
                    if (typeof snapshot.theme !== 'undefined') { currentThemeIndex = snapshot.theme; applyTheme(currentThemeIndex); }
                    markAsUnsaved();
                    if (await autoSave()) await CustomDialog.alert('导入成功！');
                }
            } else { await CustomDialog.alert('无法识别的文件格式。', '错误'); }
        } catch (err) { await CustomDialog.alert('导入失败：' + err, '错误'); }
        event.target.value = '';
    };
    reader.readAsText(file);
}

// =======================================================
// 23. 自动保存
// =======================================================
function initAutoSave() {
    autoSaveTimer = setInterval(() => {
        if (hasUnsavedChanges) { autoSave(); }
    }, AUTO_SAVE_INTERVAL);
}

let editPersistTimer = null;
let editRevision = 0;
const clauseEditHistory = new WeakMap();

function endTypingGroup() {
    const last = clauseEditHistory.get(contracts[activeContractKey])?.at(-1);
    if (last) last.group = '';
}

function recordClauseEdit(id, clause, nextContent, nextTags, group = '', field = 'content', sourceKey = null) {
    const contract = contracts[activeContractKey];
    const history = clauseEditHistory.get(contract) || [];
    const last = history.at(-1);
    const now = Date.now();
    const content = field === 'content' ? clause.content : (getClauseTranslation(clause, field === 'translation_tc') || '');
    const tags = field === 'content' ? clause.reviewTags : undefined;
    if (group && last?.group === group && last.clause === clause && last.field === field &&
        last.nextContent === content && last.nextTags === tags && now - last.time < 750) {
        last.nextContent = nextContent;
        last.time = now;
    } else {
        history.push({ id, clause, field, content, tags, nextContent, nextTags, group, sourceKey, time: now });
        if (history.length > MAX_HISTORY_SIZE) history.shift();
    }
    clauseEditHistory.set(contract, history);
}

function updateClauseReviewTags(id, tags, key = activeContractKey) {
    const clause = contracts[key]?.data[id];
    if (!clause || !activeContractKey) return;
    recordClauseEdit(id, clause, clause.content, tags, '', 'content', key === activeContractKey ? null : key);
    clause.reviewTags = tags;
    clause.modifiedAt = Math.max(Date.now(), (clause.modifiedAt || 0) + 1);
    updateLocalModificationTime();
    scheduleEditorSave(true);
}

function sameClauseContent(left, right) {
    if (left === right) return true;
    // Rendering a restored clause can reorder attributes without changing the document.
    const current = document.createElement('template');
    const recorded = document.createElement('template');
    current.innerHTML = sanitizeHtml(left);
    recorded.innerHTML = sanitizeHtml(right);
    return current.content.isEqualNode(recorded.content);
}

function undoClauseEdit() {
    const history = clauseEditHistory.get(contracts[activeContractKey]);
    const entry = history?.pop();
    if (!entry) return;
    endTypingGroup();
    const { id, clause, field, content, tags, nextContent, nextTags, sourceKey } = entry;
    const data = sourceKey ? contracts[sourceKey]?.data : fullClauseDatabase;
    if (data?.[id] !== clause || !sameClauseContent(clause[field], nextContent) ||
        (field === 'content' && JSON.stringify(clause.reviewTags || []) !== JSON.stringify(nextTags || []))) {
        history.length = 0;
        showError('条款已被其他操作更新，无法安全撤销。');
        return;
    }
    if (field !== 'content') {
        setClauseTranslation(clause, field, content);
        refreshRenderedTranslations();
    } else {
        if (tags || nextTags) clause.reviewTags = tags || [];
        clause.content = content;
        clause.modifiedAt = Math.max(Date.now(), (clause.modifiedAt || 0) + 1);
    }
    if (field === 'content' && content !== nextContent) {
        const body = document.getElementById('clause-' + id)?.querySelector('.clause-text');
        if (body) {
            body.innerHTML = sanitizeHtml(content);
            delete body.dataset.highlighted;
            autoLinkClauses(body);
            updateModifiedBadge(id);
            buildReverseIndex();
            if (currentSearchTerm) highlightInElement(body, currentSearchTerm);
        }
    }
    window.SelectionTools?.afterUndo();
    updateLocalModificationTime();
    scheduleEditorSave(true);
    showSuccess('已撤销上一次修改');
}

function markAsUnsaved() {
    editRevision++;
    hasUnsavedChanges = true;
}

function handleEditorMutation(target = null, group = '') {
    if (!activeContractKey || !contracts[activeContractKey]) return;

    const clauseText = getClauseTextForNode(target) || getClauseTextForNode(window.getSelection()?.anchorNode);
    if (!clauseText) return;
    if (clauseText.classList.contains('translation-text')) {
        handleTranslationInput(clauseText, group);
        return;
    }
    if (!captureCurrentContent({ target: clauseText, recordHistory: true, group })) return;
    scheduleEditorSave();
}

function scheduleEditorSave(immediate = false) {
    markAsUnsaved();
    clearTimeout(editPersistTimer);
    if (immediate) autoSave();
    else editPersistTimer = setTimeout(() => autoSave(), 500);
}

function setClauseTranslation(clause, field, content) {
    clause[field] = content;
    const times = clause.translationModifiedAt ??= {};
    times[field] = Math.max(Date.now(), (times[field] || 0) + 1);
}

function handleTranslationInput(body, group) {
    const { key, id, field } = getContractTextSource(body);
    const clause = contracts[key]?.data[id];
    if (!clause || !TRANSLATION_FIELDS.includes(field)) return;
    const content = body.textContent ? sanitizeHtml(body.innerHTML) : '';
    const current = getClauseTranslation(clause, field === 'translation_tc') || '';
    if (sameClauseContent(current, content)) return;
    recordClauseEdit(id, clause, content, undefined, group, field, key === activeContractKey ? null : key);
    setClauseTranslation(clause, field, content);
    updateLocalModificationTime();
    scheduleEditorSave();
}

function handleContractTextInput(event) {
    if (!isContractEditing()) return;
    const body = event.target.closest('.clause-text, .translation-text');
    if (!body?.isContentEditable) return;
    const group = ['insertText', 'insertCompositionText', 'deleteContentBackward', 'deleteContentForward'].includes(event.inputType)
        ? event.inputType : '';
    handleEditorMutation(body, group);
}

document.getElementById('panelMain')?.addEventListener('input', handleContractTextInput);
document.getElementById('refContent')?.addEventListener('input', handleContractTextInput);

document.addEventListener('pointerdown', endTypingGroup);
document.addEventListener('keydown', event => {
    if (event.target.closest?.('.clause-text, .translation-text') && /^(?:Arrow|Home|End|Page)/.test(event.key)) endTypingGroup();
    if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.shiftKey ||
        event.altKey || event.key.toLowerCase() !== 'z' || !activeContractKey || isAssistantMode) return;
    const field = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (field && !field.matches('.clause-text, .translation-text')) return;
    event.preventDefault();
    undoClauseEdit();
});

async function autoSave() {
    if (!activeContractKey && !hasUnsavedChanges) return false;
    captureCurrentContent();
    const revision = editRevision;
    try {
        if (contracts[activeContractKey]) contracts[activeContractKey].bookmarks = savedBookmarks;
        const persisted = await saveContractsToStorage();
        if (!persisted) throw new Error('主合同数据写入失败');
        const saveData = { contracts: {}, activeContractKey, theme: currentThemeIndex, timestamp: Date.now() };
        Object.keys(contracts).forEach(key => { saveData.contracts[key] = { title: contracts[key].title, bookmarks: contracts[key].bookmarks }; });
        saveData.modifications = extractAllUserModifications();
        await localforage.setItem(AUTO_SAVE_KEY, JSON.stringify(saveData));
        if (editRevision === revision) hasUnsavedChanges = false;
        lastSavedTime = Date.now();
        return true;
    } catch (e) {
        console.error('自动保存失败:', e);
        return false;
    }
}

// 键盘快捷键 Ctrl+S
document.addEventListener('keydown', async e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const saved = await autoSave();
        if (saved) showSuccess('已保存', 1500);
    }
});

// =======================================================
// 24. 导出当前合同 TXT
// =======================================================

function cleanContractText(value) {
    const template = document.createElement('template');
    template.innerHTML = sanitizeHtml(value || '');
    template.content.querySelectorAll('b, i, em, strong, span, u, strike, s, mark').forEach(element => {
        element.replaceWith(...element.childNodes);
    });
    template.content.querySelectorAll('*').forEach(element => {
        for (const attr of [...element.attributes]) {
            if (attr.name === 'style' || attr.name === 'class' || attr.name.startsWith('data-')) {
                element.removeAttribute(attr.name);
            }
        }
    });
    return template.innerHTML;
}

function exportContractText(includeAnnotations) {
    document.getElementById('exportMenu').style.display = 'none';
    if (!activeContractKey || isAssistantMode) {
        showError('请先打开要导出的合同标签页。');
        return;
    }

    captureCurrentContent();
    const contract = contracts[activeContractKey];
    const payload = {
        $contract: { name: contract.title, shortName: activeContractKey, sourceId: contract.sourceId || '' }
    };
    for (const [id, clause] of Object.entries(contract.data)) {
        const entry = {};
        for (const field of ['title', 'content', ...TRANSLATION_FIELDS]) {
            entry[field] = includeAnnotations ? sanitizeHtml(clause[field] || '') : cleanContractText(clause[field]);
        }
        if (includeAnnotations && Array.isArray(clause.reviewTags)) entry.reviewTags = clause.reviewTags;
        payload[id] = entry;
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const title = contract.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
    link.href = url;
    link.download = title + (includeAnnotations ? '_带批注文本.txt' : '_原文本.txt');
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

console.log('[editor.js] 编辑器与数据持久化加载完成');
