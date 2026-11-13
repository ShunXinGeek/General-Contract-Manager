// =======================================================
// import.js - 通用合同导入模块
// General Contract Shell
// =======================================================

function chooseContractImport(mode) {
    const input = document.getElementById('importContractFile');
    input.dataset.importMode = mode;
    document.getElementById('importMenu').style.display = 'none';
    input.click();
}

async function handleContractImport(event) {
    const input = event.target;
    const file = input.files[0];
    const overwrite = input.dataset.importMode === 'overwrite';
    input.value = '';
    if (!file) return;

    const task = window.StatusCenter?.start('正在读取合同 ' + file.name + '…', '合同导入');
    try {
        const rawText = (await file.text()).replace(/^\uFEFF/, '');
        const data = parseContractText(rawText);
        const count = Object.keys(data).length;
        if (!count) throw new Error('文件中没有可识别的合同条款。');
        const fileMeta = readContractMeta(rawText);
        const meta = overwrite ? fileMeta : await parseContractMeta(rawText, file.name, fileMeta);
        if (!meta && !overwrite) {
            task?.finish('已取消合同导入', 'info');
            return;
        }

        const targetKey = overwrite ? findContractForOverwrite(meta, file.name, data) : null;
        const previous = overwrite ? contracts[targetKey] : null;
        const shortName = meta?.shortName || previous?.shortName || targetKey;
        const title = meta?.fullName || previous?.title || shortName;
        const message = overwrite
            ? '将用文件中的 ' + count + ' 条条款整份覆盖「' + targetKey + ' · ' + previous.title + '」，是否继续？'
            : '将新增「' + title + '」及其 ' + count + ' 条条款，是否继续？';
        if (!await CustomDialog.confirm(message, '导入确认')) {
            task?.finish('已取消合同导入', 'info');
            return;
        }

        if (window.ContractBackup?.restoring) await window.ContractBackup.restoring;
        if (overwrite && contracts[targetKey] !== previous) throw new Error('目标合同已变化，请重新导入。');
        const key = targetKey || getAvailableContractKey(shortName);
        const sourceId = overwrite ? previous.sourceId : 'src_' + createContractToken();
        const persisted = await registerContract(key, title, data, { sourceId, shortName });
        if (!persisted) throw new Error('条款已载入，但保存到本地失败。');
        if (typeof updateLocalModificationTime === 'function') updateLocalModificationTime();
        if (typeof verifyCrossRefConsistency === 'function') {
            try {
                for (const warning of verifyCrossRefConsistency() || []) console.warn('[import]', warning);
            } catch (error) {
                console.warn('[import] 交叉引用校验失败:', error);
            }
        }
        task?.finish('「' + title + '」导入成功，共 ' + count + ' 条条款。');
    } catch (error) {
        task?.finish('导入失败：' + error.message, 'error');
    }
}

function findContractForOverwrite(meta, fileName, data) {
    const entries = Object.entries(contracts);
    const bySource = meta?.sourceId && entries.find(([, contract]) => contract.sourceId === meta.sourceId);
    if (bySource) return bySource[0];

    const normalize = value => (value || '').trim().toLowerCase();
    const shortName = normalize(meta?.shortName || contractNameFromFile(fileName));
    const fullName = normalize(meta?.fullName);
    const named = entries.filter(([key, contract]) => shortName &&
        (shortName === normalize(key) || shortName === normalize(contract.shortName)));
    const titled = fullName ? entries.filter(([, contract]) => fullName === normalize(contract.title)) : [];
    if (named.length === 1 && titled.length === 1 && named[0][0] !== titled[0][0]) {
        throw new Error('文件中的简称和全称指向不同合同，无法确定覆盖目标。');
    }
    if (!named.length) named.push(...titled);
    if (named.length === 1) return named[0][0];

    const fingerprint = (clauses, original = false) => JSON.stringify(Object.keys(clauses).sort().map(id => {
        const clause = clauses[id];
        return [id, cleanContractText(clause.title), cleanContractText(original ? clause.originalContent ?? clause.content : clause.content)];
    }));
    const target = fingerprint(data);
    const exact = (named.length ? named : entries).filter(([, contract]) =>
        fingerprint(contract.data) === target || fingerprint(contract.data, true) === target);
    if (exact.length === 1) return exact[0][0];
    if (named.length || exact.length) throw new Error('匹配到多份合同，无法确定覆盖目标。请使用带有目标合同标识的导出文件。');
    throw new Error('找不到对应的已有合同。若要新增，请选择「新合同导入」。');
}

/**
 * 解析 CONTRACT_META 元数据块
 * @param {string} text - 文件全文
 * @param {string} fileName - 文件名（用于回退）
 * @returns {{fullName: string, shortName: string}}
 */
function contractNameFromFile(fileName) {
    return fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
}

function readContractMeta(text) {
    try {
        const meta = JSON.parse(text)?.$contract;
        if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
            const read = key => typeof meta[key] === 'string' ? meta[key].trim() : '';
            return { fullName: read('name'), shortName: read('shortName'), sourceId: read('sourceId') };
        }
    } catch {
        // 旧 TXT 可以在条款对象前声明 CONTRACT_META。
    }
    const metaMatch = text.match(/^\s*CONTRACT_META:\s*\r?\n([\s\S]*?)\r?\n---/);
    if (metaMatch) {
        const metaBlock = metaMatch[1];
        return {
            fullName: metaBlock.match(/^name:[ \t]*(.+)$/m)?.[1].trim(),
            shortName: metaBlock.match(/^shortName:[ \t]*(.+)$/m)?.[1].trim()
        };
    }
    return null;
}

async function parseContractMeta(text, fileName, meta = readContractMeta(text)) {
    const defaultName = contractNameFromFile(fileName) || 'CONTRACT';
    if (meta) return { fullName: meta.fullName || defaultName, shortName: meta.shortName || defaultName };

    // 没有 META 块，弹窗让用户输入
    const userKey = await CustomDialog.prompt(
        `文件 "${fileName}" 中未包含合同元数据。\n\n请输入合同简称（英文缩写，如 GCC、FIDIC）：`,
        defaultName
    );

    if (!userKey || !userKey.trim()) {
        return null;
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
    return text.replace(/^\s*CONTRACT_META:\s*\r?\n[\s\S]*?\r?\n---\s*/, '');
}

/**
 * 解析合同条款文本
 * 优先尝试严谨的 JSON 解析，失败后回退到 JS 对象字面量提取
 */
function parseContractText(rawText) {
    const trimmed = stripMetaBlock(rawText).trim();

    // 尝试直接作为合法 JSON 解析
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            // 先尝试标准化 JSON (给 key 加双引号等) 并解析
            // 简单处理：如果本身就是合法 JSON 则直接成功
            const jsonData = JSON.parse(trimmed);
            const validData = {};
            for (const [key, val] of Object.entries(jsonData)) {
                if (key !== '$contract' && isContractClauseId(key) && val && typeof val === 'object' &&
                    (typeof val.title === 'string' || typeof val.content === 'string')) {
                    validData[key] = {
                        title: typeof val.title === 'string' ? val.title : '',
                        content: typeof val.content === 'string' ? val.content : '',
                        translation: typeof val.translation === 'string' ? val.translation : '',
                        translation_tc: typeof val.translation_tc === 'string' ? val.translation_tc : ''
                    };
                    if (Array.isArray(val.reviewTags)) validData[key].reviewTags = val.reviewTags;
                }
            }
            return validData;
        } catch (e) {
            console.warn("JSON解析失败，回退到正则提取法", e.message);
        }
    }

    return extractClausesFromJsObjectString(trimmed);
}

function isContractClauseId(id) {
    return !Object.hasOwn(Object.prototype, id) && !/[<>"'&\\\u0000-\u001f]/.test(id);
}

/**
 * 从 JS 对象字面量字符串提取条款
 */
function extractClausesFromJsObjectString(text) {
    const result = {};
    let blockRegex = /"([^"]+)"\s*:\s*\{([\s\S]*?)(?=(?:\s*"[a-zA-Z0-9_.-]+"\s*:\s*\{)|$)/g;
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

        if (isContractClauseId(id) && (clauseObj.title || clauseObj.content)) {
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

    let regexDoubleQuote = new RegExp('"' + propName + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"');
    let matchDoubleQuote = regexDoubleQuote.exec(block);
    if (matchDoubleQuote) return decodeQuotedProperty(matchDoubleQuote[1]);

    let regexBacktickNoQuote = new RegExp(propName + '\\s*:\\s*`([\\s\\S]*?)`');
    let matchBacktickNoQuote = regexBacktickNoQuote.exec(block);
    if (matchBacktickNoQuote) return matchBacktickNoQuote[1];

    let regexNoQuote = new RegExp(propName + '\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"');
    let matchNoQuote = regexNoQuote.exec(block);
    if (matchNoQuote) return decodeQuotedProperty(matchNoQuote[1]);

    return "";
}

function decodeQuotedProperty(value) {
    try { return JSON.parse('"' + value + '"'); }
    catch {
        // Preserve the existing permissive TXT format (e.g. literal newlines in quoted values).
        return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
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
