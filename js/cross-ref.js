// =======================================================
// cross-ref.js - GCC↔SCC 交叉引用查询引擎
// 依赖: cross-ref-data.js (CROSS_REFERENCE_DATA, GCC_CLAUSE_KEYWORD_INDEX,
//       NEW_SCC_CLAUSES, DELETE_REPLACE_SCC, NOT_USED_SCC, CROSS_REF_META)
//       app.js (contracts 全局对象, isKnowledgeBaseMode)
//       config.js (AI_CONFIG)
// =======================================================

// 内存索引: { GCC编号 → { gccClause, gccTitle, cnTitle, sccClauses, modificationType } }
let CROSS_REF_INDEX = {};
let CROSS_REF_INITIALIZED = false;

// =======================================================
// 索引初始化
// =======================================================
function initCrossRefIndex() {
    if (typeof CROSS_REFERENCE_DATA === 'undefined') {
        console.warn('[cross-ref] CROSS_REFERENCE_DATA 未加载，交叉引用索引不可用');
        return false;
    }

    CROSS_REF_INDEX = {};
    for (const row of CROSS_REFERENCE_DATA) {
        const [gccNum, gccTitle, cnTitle, sccRefs, modType] = row;
        const key = String(gccNum);
        CROSS_REF_INDEX[key] = {
            gccClause: key,
            gccTitle: gccTitle,
            cnTitle: cnTitle,
            sccClauses: sccRefs || [],
            modificationType: modType || '无 SCC 修改'
        };
    }

    // 构建 Not Used SCC 快速查找集合
    window._NOT_USED_SCC_SET = new Set(NOT_USED_SCC);
    // 构建 New SCC 快速查找 Map
    window._NEW_SCC_MAP = new Map(NEW_SCC_CLAUSES.map(c => [c.id, c]));
    // 构建 Delete/Replace SCC 快速查找 Map
    window._DELETE_REPLACE_MAP = new Map(DELETE_REPLACE_SCC.map(c => [c.scc, c]));

    CROSS_REF_INITIALIZED = true;
    console.log('[cross-ref] 交叉引用索引初始化完成 | GCC条款: ' + Object.keys(CROSS_REF_INDEX).length +
        ' | Not Used SCC: ' + NOT_USED_SCC.length +
        ' | New SCC: ' + NEW_SCC_CLAUSES.length);
    return true;
}

// =======================================================
// 核心查找函数
// =======================================================

/**
 * 根据 GCC 条款编号查找交叉引用信息
 * @param {string|number} gccNum - GCC 条款编号(1-90)
 * @returns {object|null} 交叉引用条目，含关联的 GCC 和 SCC 条款内容
 */
function lookupCrossRef(gccNum) {
    if (!CROSS_REF_INITIALIZED) { initCrossRefIndex(); }
    const key = String(gccNum);
    const entry = CROSS_REF_INDEX[key];
    if (!entry) return null;

    // 收集结果条款
    const clauses = [];

    // 1. 添加 GCC 基准条款
    const gccData = contracts['GCC']?.data;
    if (gccData && gccData[key]) {
        clauses.push({
            type: 'GCC',
            id: key,
            title: gccData[key].title,
            content: stripHtml(gccData[key].content),
            score: 300,
            relation: 'base',
            modificationType: entry.modificationType
        });
    }

    // 2. 添加所有 SCC 修改条款
    const sccData = contracts['SCC']?.data;
    if (sccData && entry.sccClauses && entry.sccClauses.length > 0) {
        for (const sccRef of entry.sccClauses) {
            // 解析 SCC 引用格式: "SCC34", "SCC7(1)(b)", "SCC9系列"
            const sccIds = parseSCCRef(sccRef);
            for (const sccId of sccIds) {
                // 跳过 Not Used 条款
                if (window._NOT_USED_SCC_SET && window._NOT_USED_SCC_SET.has('SCC' + sccId)) continue;

                const clauseData = findSCCClause(sccId);
                if (clauseData) {
                    clauses.push({
                        type: 'SCC',
                        id: clauseData.id,
                        title: clauseData.title,
                        content: stripHtml(clauseData.content),
                        score: 200,
                        relation: 'modifies',
                        modificationType: entry.modificationType,
                        sccRef: sccRef,
                        gccClause: key
                    });
                }
            }
        }
    }

    return {
        entry: entry,
        clauses: clauses,
        hasModification: entry.sccClauses && entry.sccClauses.length > 0,
        modificationType: entry.modificationType
    };
}

/**
 * 解析 SCC 引用字符串，提取 SCC 编号列表
 * 支持: "SCC34" → ["34"], "SCC7(1)(b)" → ["7"], "SCC9系列" → ["9"]
 * @param {string} sccRef - SCC 引用字符串
 * @returns {string[]} SCC 编号数组
 */
function parseSCCRef(sccRef) {
    const match = sccRef.match(/SCC(\d+)([A-Za-z]?)/);
    if (!match) return [];
    const num = match[1];
    const suffix = match[2] || '';
    const id = num + suffix;
    return [id];
}

/**
 * 在 contracts['SCC'].data 中查找条款（支持多种键名格式）
 */
function findSCCClause(sccId) {
    const sccData = contracts['SCC']?.data;
    if (!sccData) return null;

    // 尝试多种键名格式
    const candidates = [
        sccId,                          // "34"
        'SCC ' + sccId,                 // "SCC 34"
        'SCC' + sccId,                  // "SCC34"
    ];

    for (const key of candidates) {
        if (sccData[key]) return { id: key, title: sccData[key].title, content: sccData[key].content };
        // 大小写不敏感
        const foundKey = Object.keys(sccData).find(k => k.toLowerCase() === key.toLowerCase());
        if (foundKey) return { id: foundKey, title: sccData[foundKey].title, content: sccData[foundKey].content };
    }
    return null;
}

/**
 * 辅助函数：去除 HTML 标签
 */
function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').trim();
}

// =======================================================
// 多策略查找 - 核心入口函数
// =======================================================
async function findByCrossRef(query, clauseNumbers, keywords) {
    if (!CROSS_REF_INITIALIZED) { initCrossRefIndex(); }

    const allResults = [];
    const processedGccNums = new Set();

    // Phase A: 直接条款编号查找
    for (const num of clauseNumbers) {
        const n = String(num).replace(/[^0-9]/g, '');
        if (!n || processedGccNums.has(n)) continue;
        processedGccNums.add(n);

        const xref = lookupCrossRef(n);
        if (xref && xref.clauses.length > 0) {
            allResults.push(...xref.clauses);
        }
    }

    // Phase B: 关键词索引查找
    if (allResults.length < 3 && keywords.length > 0) {
        const matchedGccNums = new Set();
        for (const kw of keywords) {
            const kwLower = kw.toLowerCase();
            // 先查精确匹配
            if (GCC_CLAUSE_KEYWORD_INDEX[kwLower]) {
                for (const num of GCC_CLAUSE_KEYWORD_INDEX[kwLower]) {
                    if (!processedGccNums.has(String(num))) {
                        matchedGccNums.add(String(num));
                    }
                }
            }
            // 再查包含匹配（中文多字词拆分）
            if (matchedGccNums.size === 0) {
                for (const [indexKw, nums] of Object.entries(GCC_CLAUSE_KEYWORD_INDEX)) {
                    if (indexKw.includes(kwLower) || kwLower.includes(indexKw)) {
                        for (const num of nums) {
                            if (!processedGccNums.has(String(num))) {
                                matchedGccNums.add(String(num));
                            }
                        }
                    }
                }
            }
        }
        for (const num of matchedGccNums) {
            processedGccNums.add(num);
            const xref = lookupCrossRef(num);
            if (xref && xref.clauses.length > 0) {
                allResults.push(...xref.clauses);
            }
        }
    }

    // Phase C: LLM 辅助子句识别（针对完全无结果的模糊查询）
    if (allResults.length === 0 && isKnowledgeBaseMode) {
        const llmNums = await extractClauseNumbersViaLLM(query);
        for (const num of llmNums) {
            const n = String(num);
            if (processedGccNums.has(n)) continue;
            processedGccNums.add(n);
            const xref = lookupCrossRef(n);
            if (xref && xref.clauses.length > 0) {
                allResults.push(...xref.clauses);
            }
        }
    }

    // 去重并排序
    const seen = new Set();
    const unique = [];
    for (const r of allResults) {
        const key = r.type + '_' + r.id;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(r);
    }
    unique.sort((a, b) => b.score - a.score);

    return unique;
}

// =======================================================
// LLM 辅助子句编号提取（Phase C 回退）
// =======================================================
async function extractClauseNumbersViaLLM(query) {
    try {
        // 构建 GCC 条款摘要
        const clauseList = CROSS_REFERENCE_DATA
            .map(row => `${row[0]}: ${row[2] || row[1]}`)
            .join('\n');

        const prompt = `You are a contract clause classifier for Hong Kong construction contracts (GCC = General Conditions of Contract).

Given a user query, identify which GCC clause numbers (1-90) are relevant.

Available GCC clauses (number: title):
${clauseList}

User query: "${query}"

Return ONLY a JSON array of relevant clause numbers, e.g. [50, 51, 52]. If no specific clauses match, return []. Do not explain.`;

        const response = await fetch(AI_CONFIG.apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + AI_CONFIG.apiKey
            },
            body: JSON.stringify({
                model: AI_CONFIG.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 200
            })
        });

        if (!response.ok) {
            console.warn('[cross-ref] LLM 子句识别请求失败:', response.status);
            return [];
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '[]';
        // 尝试解析 JSON（可能包含 markdown 代码块）
        const jsonMatch = content.match(/\[[\d,\s]+\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return [];
    } catch (e) {
        console.warn('[cross-ref] LLM 子句识别出错:', e.message);
        return [];
    }
}

// =======================================================
// 交叉引用专用提示模板
// =======================================================
function buildCrossRefPrompt(relevantClauses) {
    if (!relevantClauses || relevantClauses.length === 0) {
        // 回退到通用目录提示
        let allTitles = [];
        Object.keys(contracts).forEach(type => {
            Object.entries(contracts[type].data).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).forEach(([id, c]) => {
                allTitles.push(type + ' Clause ' + id + ': ' + c.title);
            });
        });
        return '【系统角色】你是一个合同条款数据库查询助手。\n\n【当前状态】\n未找到精确匹配。以下是完整目录：\n\n' +
            allTitles.join('\n') +
            '\n\n【回复要求】\n1. 告知用户未找到精确匹配\n2. 推荐2-5个相关条款（格式：[合同简称] Clause X）\n3. 建议用户点击「引用条款」按钮查看具体内容';
    }

    // 按修改关系分组
    const groups = {};
    for (const clause of relevantClauses) {
        let groupKey;
        if (clause.relation === 'base') {
            groupKey = 'GCC_' + clause.id;
        } else if (clause.gccClause) {
            groupKey = 'MODIFIES_GCC_' + clause.gccClause;
        } else {
            groupKey = 'OTHER_' + clause.type + '_' + clause.id;
        }
        if (!groups[groupKey]) groups[groupKey] = { gccBase: null, sccModifiers: [], other: [] };
        if (clause.relation === 'base') {
            groups[groupKey].gccBase = clause;
        } else if (clause.relation === 'modifies') {
            groups[groupKey].sccModifiers.push(clause);
        } else {
            groups[groupKey].other.push(clause);
        }
    }

    // 构建条款上下文
    let clauseContext = '';
    for (const [group, data] of Object.entries(groups)) {
        if (data.gccBase) {
            clauseContext += `<<<GCC Clause ${data.gccBase.id}: ${data.gccBase.title}>>>\n${data.gccBase.content}\n`;
            if (data.gccBase.modificationType && data.gccBase.modificationType !== '无 SCC 修改') {
                clauseContext += `[修改类型: ${data.gccBase.modificationType}]\n`;
            }
            clauseContext += '\n';
        }
        for (const mod of data.sccModifiers) {
            clauseContext += `<<<SCC Clause ${mod.id}: ${mod.title} [修改GCC ${mod.gccClause}] [类型: ${mod.modificationType}]>>>\n${mod.content}\n\n`;
        }
        for (const other of data.other) {
            clauseContext += `<<<${other.type} Clause ${other.id}: ${other.title}>>>\n${other.content}\n\n`;
        }
    }

    return `【系统角色】你是香港建造合同条款数据库查询终端。你的职责是基于下方条款原文，对GCC（通用合同条件）与SCC（特别合同条件）进行精确的交叉引用分析。

【核心原则】
1. **SCC 优先于 GCC**：当 SCC 对 GCC 某条款存在修改时，以 SCC 为准
2. **100% 基于原文**：回答必须完全基于下方「可用条款数据库」中提供的内容
3. **明确标注层级**：清楚区分 GCC 基准条款和 SCC 修改条款
4. **修改类型说明**：每条 SCC 修改需标注其修改类型
5. **未使用条款过滤**：标记为"(Not used)"的 SCC 条款已被排除，不应提及

【修改类型说明】
- 删除替换：SCC 整条删除并替换 GCC 对应条款
- 大幅修改：SCC 对 GCC 进行了大量修改和补充
- 修改：SCC 对 GCC 进行了部分修改
- 扩展：SCC 在 GCC 基础上新增子条款
- 间接引用：SCC 在其他条款中间接引用或修改本条款
- 无 SCC 修改：GCC 条款未被 SCC 修改，以 GCC 为准

【可用条款数据库】
${clauseContext}【条款数据库结束】

【回复步骤】
1. 确认用户问题涉及的所有 GCC 条款编号及标题
2. 逐一列出每条 GCC 条款对应的 SCC 修改条款（如有）
3. 摘要每个修改的核心内容
4. 综合给出基于原文的解答，明确标注以哪份文件为准
5. 引用条款统一使用格式：[合同简称] Clause X（如 GCC Clause 50, SCC 111）`;
}

// =======================================================
// 交叉引用搜索（findRelevantClauses 的交叉引用分支）
// =======================================================
async function findRelevantClausesCrossRef(query) {
    if (!CROSS_REF_INITIALIZED) { initCrossRefIndex(); }

    const { clauseNumbers, keywords } = extractKeywords(query);
    const results = await findByCrossRef(query, clauseNumbers, keywords);
    return results;
}

// =======================================================
// 一致性校验（合同导入时调用）
// =======================================================
function verifyCrossRefConsistency() {
    const warnings = [];

    if (!CROSS_REF_INITIALIZED) {
        warnings.push('交叉引用索引未初始化');
        return warnings;
    }

    // 检查 GCC 数据完整性
    const gccData = contracts['GCC']?.data;
    if (gccData) {
        const missingGcc = [];
        for (let i = 1; i <= 90; i++) {
            if (!gccData[String(i)]) {
                missingGcc.push(i);
            }
        }
        if (missingGcc.length > 0) {
            warnings.push('[CrossRef] 导入的 GCC 数据缺少以下条款: ' + missingGcc.join(', '));
        }
    }

    // 检查交叉引用中的 SCC 条款是否存在（跳过 Not Used 条款）
    if (contracts['SCC']?.data) {
        const sccDataKeys = Object.keys(contracts['SCC'].data);
        const sccDataKeysNormalized = sccDataKeys.map(k => k.replace(/^SCC\s*/i, '').trim());
        const notUsedSet = window._NOT_USED_SCC_SET || new Set();

        for (const [gccNum, entry] of Object.entries(CROSS_REF_INDEX)) {
            for (const sccRef of entry.sccClauses) {
                const sccIds = parseSCCRef(sccRef);
                for (const sccId of sccIds) {
                    const fullSccId = 'SCC' + sccId;
                    // 跳过 Not Used 条款
                    if (notUsedSet.has(fullSccId)) continue;

                    // 检查是否存在（不要求完全匹配，因为键名格式可能不同）
                    const found = sccDataKeysNormalized.some(k =>
                        k === sccId || k === 'SCC' + sccId || k === 'SCC ' + sccId
                    );
                    if (!found) {
                        warnings.push('[CrossRef] 交叉引用 SCC ' + sccRef + ' (来自 GCC ' + gccNum + ') 在导入的 SCC 数据中未找到');
                    }
                }
            }
        }
    }

    return warnings;
}

// =======================================================
// 辅助：获取 GCC 条款摘要（用于 LLM 提示）
// =======================================================
function getGCCClauseSummary() {
    const summaries = [];
    for (const [gccNum, entry] of Object.entries(CROSS_REF_INDEX)) {
        const hasMod = entry.sccClauses && entry.sccClauses.length > 0;
        summaries.push({
            number: gccNum,
            title: entry.gccTitle,
            cnTitle: entry.cnTitle,
            modificationType: entry.modificationType,
            hasSCCModification: hasMod,
            sccCount: entry.sccClauses ? entry.sccClauses.length : 0
        });
    }
    return summaries;
}

/**
 * 检查 SCC 条款是否为 Not Used
 */
function isSCCNotUsed(sccId) {
    if (!window._NOT_USED_SCC_SET) return false;
    const normalized = String(sccId).replace(/^SCC\s*/i, '').trim();
    return window._NOT_USED_SCC_SET.has('SCC' + normalized);
}

/**
 * 获取 SCC 条款的详细分类信息
 */
function getSCCCategory(sccId) {
    const normalized = 'SCC' + String(sccId).replace(/^SCC\s*/i, '').trim();

    if (isSCCNotUsed(normalized)) return 'not_used';
    if (window._NEW_SCC_MAP?.has(normalized)) return 'new';
    if (window._DELETE_REPLACE_MAP?.has(normalized)) return 'delete_replace';
    return 'modifier';
}

console.log('[cross-ref.js] GCC↔SCC 交叉引用查询引擎加载完成');
