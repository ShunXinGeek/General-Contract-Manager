// =======================================================
// editor.js - 编辑模式、备注、自动保存、导入导出
// 依赖：app.js (isEditMode, fullClauseDatabase, activeContractKey,
//        contracts, savedBookmarks, currentThemeIndex, AUTO_SAVE_KEY,
//        AUTO_SAVE_INTERVAL, hasUnsavedChanges, lastSavedTime)
//       utils.js (showSuccess)
// 须在 app.js 之后加载
// =======================================================

// =======================================================
// 12b. 备注系统
// =======================================================
async function addOrEditNote() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let node = sel.anchorNode;
    if (node.nodeType === 3) node = node.parentNode;
    if (node.classList.contains('note-span')) {
        const oldText = node.getAttribute('data-note');
        const newText = await CustomDialog.prompt('编辑备注:', oldText);
        if (newText === null) return;
        if (newText.trim() === '') {
            const text = document.createTextNode(node.innerText);
            node.parentNode.replaceChild(text, node);
        } else {
            node.setAttribute('data-note', newText);
        }
    } else {
        const newText = await CustomDialog.prompt('添加备注:', '');
        if (newText && newText.trim() !== '') {
            const range = sel.getRangeAt(0);
            const span = document.createElement('span');
            span.className = 'note-span';
            span.setAttribute('data-note', newText);
            try { range.surroundContents(span); sel.removeAllRanges(); } catch (e) { console.warn('备注添加失败:', e); }
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
async function toggleEditMode() {
    isEditMode = !isEditMode;
    const btn = document.getElementById('btnEditMode');
    const icon = document.getElementById('editIcon');
    if (isEditMode) {
        icon.innerText = '✏️';
        btn.style.backgroundColor = '#e74c3c';
        await CustomDialog.alert('✏️ 编辑模式已开启');
    } else {
        icon.innerText = '🔒';
        btn.style.backgroundColor = '';
    }
}

document.getElementById('panelMain')?.addEventListener('keydown', function (e) {
    if (isEditMode || !e.target.closest('.clause-text')) return;
    if (['Backspace', 'Delete'].includes(e.key)) { e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey) { const key = e.key.toLowerCase(); if (key === 'x' || key === 'v') { e.preventDefault(); return; } }
    if (e.ctrlKey || e.altKey || e.metaKey || e.key.startsWith('F') ||
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
            'Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape'].includes(e.key)) return;
    e.preventDefault();
});
document.addEventListener('cut', function (e) { if (!isEditMode && e.target.closest('.clause-text')) e.preventDefault(); });
document.addEventListener('drop', function (e) { if (!isEditMode && e.target.closest('.clause-text')) e.preventDefault(); });
document.addEventListener('paste', function (e) {
    if (e.target.closest('.clause-text')) {
        if (isEditMode) { e.preventDefault(); const text = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, text); }
        else { e.preventDefault(); }
    }
});

// =======================================================
// 22. 导出/导入用户修改（通用版）
// =======================================================
function captureCurrentContent() {
    const now = Date.now();
    document.querySelectorAll('.clause-text').forEach(d => {
        const id = d.parentElement.id.replace('clause-', '');
        if (fullClauseDatabase[id]) {
            const newContent = d.innerHTML;
            if (fullClauseDatabase[id].content !== newContent) {
                fullClauseDatabase[id].content = newContent;
                fullClauseDatabase[id].modifiedAt = now;
            }
        }
    });
    if (typeof updateLocalModificationTime === 'function') updateLocalModificationTime();
}

function hasUserModifications(content) {
    if (!content) return false;
    if (content.includes('class="note-span"') || content.includes("class='note-span'")) return true;
    if (content.includes('background-color:') || content.includes('background:')) return true;
    if (content.includes('color:') && !content.includes('color: var(')) return true;
    if (content.includes('<b>') || content.includes('<b ')) return true;
    if (content.includes('<font')) return true;
    return false;
}

function extractUserModifications(contractKey) {
    if (contractKey === activeContractKey) captureCurrentContent();
    const modifications = {};
    const contractData = contracts[contractKey].data;
    Object.keys(contractData).forEach(id => {
        const clause = contractData[id];
        if (clause && clause.content && hasUserModifications(clause.content)) {
            modifications[id] = { content: clause.content, modifiedAt: clause.modifiedAt || Date.now() };
        }
    });
    return modifications;
}

function extractAllUserModifications() {
    const all = {};
    Object.keys(contracts).forEach(key => {
        const mods = extractUserModifications(key);
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
                                    if (contracts[key].data[id]) contracts[key].data[id].content = snapshot.modifications[key][id].content;
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
                    if (typeof initBookmarks === 'function') initBookmarks();
                    buildReverseIndex();
                    if (typeof snapshot.theme !== 'undefined') { currentThemeIndex = snapshot.theme; applyTheme(currentThemeIndex); }
                    await CustomDialog.alert('导入成功！');
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
        if (hasUnsavedChanges && activeContractKey) { autoSave(); }
    }, AUTO_SAVE_INTERVAL);
}

function markAsUnsaved() { hasUnsavedChanges = true; }

async function autoSave() {
    if (!activeContractKey) return;
    captureCurrentContent();
    try {
        const saveData = { contracts: {}, activeContractKey, theme: currentThemeIndex, timestamp: Date.now() };
        Object.keys(contracts).forEach(key => { saveData.contracts[key] = { title: contracts[key].title, bookmarks: contracts[key].bookmarks }; });
        saveData.modifications = extractAllUserModifications();
        await localforage.setItem(AUTO_SAVE_KEY, JSON.stringify(saveData));
        hasUnsavedChanges = false;
        lastSavedTime = Date.now();
    } catch (e) { console.error('自动保存失败:', e); }
}

// 键盘快捷键 Ctrl+S
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        autoSave();
        showSuccess('已保存', 1500);
    }
});

// =======================================================
// 24. 高级导出 (Word / PDF)
// =======================================================

async function exportToPdf() {
    if (!activeContractKey) return;
    if (typeof html2pdf === 'undefined') {
        CustomDialog.alert('未能加载 PDF 导出引擎，请检查网络连接。', '导出失败');
        return;
    }
    const isConfirm = await CustomDialog.confirm('确定要将当前合同及批注导出为 PDF 吗？', '导出为 PDF');
    if (!isConfirm) return;

    captureCurrentContent();
    await CustomDialog.alert('正在生成 PDF，请稍候...点击确定开始。', '处理中');

    const element = document.getElementById('panelMain').cloneNode(true);
    // 移除不必要的按钮
    element.querySelectorAll('.clause-actions').forEach(el => el.remove());

    // 简单优化 PDF 样式
    element.style.padding = '20px';
    element.style.background = 'white';
    element.style.color = 'black';

    const opt = {
        margin: 10,
        filename: `${contracts[activeContractKey].title}_审阅版.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
        await html2pdf().set(opt).from(element).save();
        CustomDialog.alert('PDF 导出成功。', '导出完成');
    } catch (err) {
        CustomDialog.alert(`导出 PDF 失败: ${err.message}`, '错误');
    }
}

async function exportToWord(includeAnnotations) {
    if (!activeContractKey || typeof docx === 'undefined') {
        CustomDialog.alert('未能加载 Word 导出引擎，请检查网络连接。', '导出失败');
        return;
    }

    captureCurrentContent();

    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
    const docData = contracts[activeContractKey].data;
    const children = [];

    // 标题
    children.push(new Paragraph({
        text: contracts[activeContractKey].title,
        heading: HeadingLevel.TITLE,
        spacing: { after: 400 }
    }));

    Object.keys(docData).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(id => {
        const clause = docData[id];

        // 条款编号与标题
        children.push(new Paragraph({
            text: `${id} ${clause.title || ''}`,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
        }));

        // 解析纯文本内容 (去除HTML标签)
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = clause.content || '';
        const plainText = tempDiv.innerText || tempDiv.textContent || '';

        children.push(new Paragraph({
            children: [new TextRun({ text: plainText })],
            spacing: { after: 200 }
        }));

        // 处理批注 (如果是审阅版)
        if (includeAnnotations) {
            const notes = tempDiv.querySelectorAll('.note-span');
            if (notes.length > 0) {
                children.push(new Paragraph({
                    children: [new TextRun({ text: "批注/备注:", bold: true, color: "FF0000" })]
                }));
                notes.forEach(note => {
                    const noteText = note.getAttribute('data-note') || '';
                    const hlText = note.innerText || '';
                    children.push(new Paragraph({
                        children: [
                            new TextRun({ text: `[原文: ${hlText}] `, italics: true, color: "666666" }),
                            new TextRun({ text: `-> ${noteText}`, color: "FF0000" })
                        ],
                        spacing: { after: 100 },
                        bullet: { level: 0 }
                    }));
                });
            }
        }
    });

    const doc = new Document({ sections: [{ properties: {}, children: children }] });
    const suffix = includeAnnotations ? '_带批注审阅版' : '_基础版';

    Packer.toBlob(doc).then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${contracts[activeContractKey].title}${suffix}.docx`;
        a.click();
        window.URL.revokeObjectURL(url);
        CustomDialog.alert(`Word ${suffix} 导出成功。`, '导出完成');
    }).catch(err => {
        CustomDialog.alert(`导出Word失败: ${err.message}`, '错误');
    });
}

console.log('[editor.js] 编辑器与数据持久化加载完成');
