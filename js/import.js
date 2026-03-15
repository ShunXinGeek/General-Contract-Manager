// =======================================================
// import.js - 通用合同导入模块
// General Contract Shell
// =======================================================

/**
 * 处理通用合同文件导入
 * 自动从文件名或 CONTRACT_META 块推断合同类型
 * @param {Event} event - 文件输入事件
 */
function handleContractImport(event) {
    const file = event.target.files[0];
    if (!file) {
        event.target.value = '';
        return;
    }

    Logger.info('import', `开始导入合同文件: ${file.name}`);

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const rawText = e.target.result;

            // 1. 解析条款数据
            const parsedData = parseContractText(rawText);

            if (Object.keys(parsedData).length === 0) {
                await CustomDialog.alert(`未能在 ${file.name} 中识别出有效的条款格式。\n\n请确保文件内容符合规范。`, '导入失败');
                return;
            }

            // 2. 解析元数据（合同名称和简称）
            const meta = await parseContractMeta(rawText, file.name); // Changed from parseContractMetaInfo to parseContractMeta
            const contractKey = meta.shortName;

            // 3. 检查是否已存在同名合同并确认导入
            let proceedImport = false;
            if (typeof contracts !== 'undefined' && contracts[contractKey]) {
                const isOverwrite = await CustomDialog.confirm(
                    `合同类型 "${contractKey}" 已存在（${Object.keys(contracts[contractKey].data).length} 条条款）。\n\n是否覆盖？`,
                    '导入确认'
                );
                if (isOverwrite) {
                    proceedImport = true;
                }
            } else {
                const isImport = await CustomDialog.confirm(
                    `即将导入 ${Object.keys(parsedData).length} 条 "${meta.fullName}" (${contractKey}) 条款，是否继续？`,
                    '导入确认'
                );
                if (isImport) {
                    proceedImport = true;
                }
            }

            if (proceedImport) {
                // 注册合同
                registerContract(contractKey, meta.fullName, parsedData);

                await CustomDialog.alert(`"${meta.fullName}" (${contractKey}) 数据导入成功！共 ${Object.keys(parsedData).length} 条条款。`, '导入成功');

                if (typeof updateLocalModificationTime === 'function') {
                    updateLocalModificationTime();
                }
                if (typeof forceUploadToCloud === 'function') {
                    forceUploadToCloud().catch(err => console.log('云端同步跳过:', err.message));
                }
                if (typeof initBookmarks === 'function') initBookmarks();
                buildReverseIndex();
                autoSave();
                if (typeof saveContractsToStorage === 'function') saveContractsToStorage();
            }
        } catch (error) {
            console.error(error);
            await CustomDialog.alert(`导入失败：\n${error.message}`, '错误');
        }
        // The input element's value should be cleared by the caller if it's an input type="file"
    };

    reader.readAsText(file);
}

/**
 * 解析 CONTRACT_META 元数据块
 * @param {string} text - 文件全文
 * @param {string} fileName - 文件名（用于回退）
 * @returns {{fullName: string, shortName: string}}
 */
async function parseContractMeta(text, fileName) {
    const defaultName = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');

    // 尝试匹配 CONTRACT_META 块
    const metaMatch = text.match(/CONTRACT_META:\s*\n([\s\S]*?)\n---/);
    if (metaMatch) {
        const metaBlock = metaMatch[1];
        const nameMatch = metaBlock.match(/name:\s*(.+)/);
        const shortMatch = metaBlock.match(/shortName:\s*(.+)/);

        return {
            fullName: nameMatch ? nameMatch[1].trim() : defaultName,
            shortName: shortMatch ? shortMatch[1].trim() : defaultName
        };
    }

    // 没有 META 块，弹窗让用户输入
    const userKey = await CustomDialog.prompt(
        `文件 "${fileName}" 中未包含合同元数据。\n\n请输入合同简称（英文缩写，如 GCC、FIDIC）：`,
        defaultName
    );

    if (!userKey || !userKey.trim()) {
        throw new Error('用户取消了导入');
    }

    const userTitle = await CustomDialog.prompt(
        `请输入合同全称（如 "General Conditions of Contract"）：`,
        userKey.trim()
    );

    return {
        fullName: userTitle ? userTitle.trim() : userKey.trim(),
        shortName: userKey.trim().toUpperCase()
    };
}

/**
 * 去除 CONTRACT_META 块，返回纯数据文本
 */
function stripMetaBlock(text) {
    return text.replace(/CONTRACT_META:\s*\n[\s\S]*?\n---\s*\n?/, '');
}

/**
 * 解析合同条款文本
 * 优先尝试严谨的 JSON 解析，失败后回退到 JS 对象字面量提取
 */
function parseContractText(rawText) {
    const trimmed = rawText.trim();

    // 尝试直接作为合法 JSON 解析
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            // 先尝试标准化 JSON (给 key 加双引号等) 并解析
            // 简单处理：如果本身就是合法 JSON 则直接成功
            const jsonData = JSON.parse(trimmed);
            const validData = {};
            for (const [key, val] of Object.entries(jsonData)) {
                if (val && (val.title || val.content)) {
                    validData[key] = {
                        title: val.title || '',
                        content: val.content || '',
                        translation: val.translation || '',
                        translation_tc: val.translation_tc || ''
                    };
                }
            }
            if (Object.keys(validData).length > 0) return validData;
        } catch (e) {
            console.warn("JSON解析失败，回退到正则提取法", e.message);
        }
    }

    return extractClausesFromJsObjectString(rawText);
}

/**
 * 从 JS 对象字面量字符串提取条款
 */
function extractClausesFromJsObjectString(text) {
    const result = {};
    let blockRegex = /"([^"]+)"\s*:\s*\{([\s\S]*?)(?=(?:\s*"[a-zA-Z0-9_]+"\s*:\s*\{)|$)/g;
    let match;

    while ((match = blockRegex.exec(text)) !== null) {
        let id = match[1];
        let blockContent = match[2];

        blockContent = blockContent.trim().replace(/,?[\s\}]*$/, '');
        if (blockContent.endsWith('}')) {
            blockContent = blockContent.slice(0, -1);
        }

        let clauseObj = {
            title: extractProperty(blockContent, "title"),
            content: extractProperty(blockContent, "content"),
            translation: extractProperty(blockContent, "translation"),
            translation_tc: extractProperty(blockContent, "translation_tc")
        };

        if (clauseObj.title || clauseObj.content) {
            result[id] = clauseObj;
        }
    }
    return result;
}

/**
 * 从块文本中提取指定属性值
 */
function extractProperty(block, propName) {
    let regexBacktick = new RegExp('"' + propName + '"\\s*:\\s*`([\\s\\S]*?)`');
    let matchBacktick = regexBacktick.exec(block);
    if (matchBacktick) return matchBacktick[1];

    let regexDoubleQuote = new RegExp('"' + propName + '"\\s*:\\s*"([\\s\\S]*?)"');
    let matchDoubleQuote = regexDoubleQuote.exec(block);
    if (matchDoubleQuote) return matchDoubleQuote[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');

    let regexBacktickNoQuote = new RegExp(propName + '\\s*:\\s*`([\\s\\S]*?)`');
    let matchBacktickNoQuote = regexBacktickNoQuote.exec(block);
    if (matchBacktickNoQuote) return matchBacktickNoQuote[1];

    let regexNoQuote = new RegExp(propName + '\\s*:\\s*"([\\s\\S]*?)"');
    let matchNoQuote = regexNoQuote.exec(block);
    if (matchNoQuote) return matchNoQuote[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');

    return "";
}

// Ensure toggleDropdown exists globally
if (typeof window.toggleDropdown === 'undefined') {
    window.toggleDropdown = function (menuId, btnElement) {
        const menu = document.getElementById(menuId);
        if (!menu) return;
        if (menu.style.display === 'none' || menu.style.display === '') {
            menu.style.display = 'block';
            const closeMenu = function (e) {
                if (!menu.contains(e.target) && !btnElement.contains(e.target)) {
                    menu.style.display = 'none';
                    document.removeEventListener('mousedown', closeMenu);
                }
            };
            setTimeout(() => { document.addEventListener('mousedown', closeMenu); }, 0);
        } else {
            menu.style.display = 'none';
        }
    };
}
