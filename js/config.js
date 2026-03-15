// =======================================================
// 0. AI 管理助手配置区 (用户手动编辑)
// =======================================================
/* AI_CONFIG_START */
const AI_CONFIG = {
    // API 地址 - 用户在设置中配置
    apiEndpoint: "",

    // API 密钥 - 用户在设置中配置
    apiKey: "",

    // 模型名称 - 用户在设置中配置
    model: "",

    // 嵌入模型配置 - 用于 RAG 知识库索引
    embeddingEndpoint: "",
    embeddingApiKey: "",
    embeddingModel: "text-embedding-3-small",

    // 重排序模型配置 - 用于知识库二次精排
    rerankEnabled: false,
    rerankEndpoint: "https://dashscope.aliyuncs.com/compatible-api/v1/reranks",
    rerankApiKey: "",
    rerankModel: "qwen3-rerank",

    // 系统提示词 (System Prompt) - 通用基础版本
    // 实际使用时会通过 generateDynamicSystemPrompt() 动态生成
    systemPrompt: `你是一位专业的合同管理顾问，精通各类工程合同及其条款内容。

你的职责包括：
1. 解读和解释合同条款的含义、适用场景和法律效力
2. 分析合同风险和潜在争议点
3. 解答关于合同管理流程的问题
4. 提供合同管理的最佳实践建议

回答要求：
- 默认使用简体中文进行回复，除非用户明确要求使用其他语言
- 引用条款时请使用"[合同简称] Clause [编号]"的格式
- 使用清晰易懂的语言，避免过于晦涩的法律术语
- 如有需要，提供中英文对照解释
- 回答要有逻辑结构，可使用列表、标题等格式`
};
/* AI_CONFIG_END */

/**
 * 根据当前已导入的合同类型动态生成系统提示词
 * @returns {string} 动态生成的系统提示词
 */
function generateDynamicSystemPrompt() {
    const contractKeys = typeof contracts !== 'undefined' ? Object.keys(contracts) : [];

    if (contractKeys.length === 0) {
        return AI_CONFIG.systemPrompt;
    }

    // 构建合同类型描述
    const contractDescriptions = contractKeys.map(key => {
        const title = contracts[key].title || key;
        return `${key}（${title}）`;
    }).join('、');

    // 构建条款引用格式规则
    const formatRules = contractKeys.map(key => {
        return `  · 引用 ${key} 条款时，必须使用完整的 "${key} Clause X" 格式`;
    }).join('\n');

    const formatExamples = contractKeys.map(key => {
        return `${key} Clause 1`;
    }).join('、');

    return `你是一位专业的合同管理顾问，精通以下合同类型：${contractDescriptions}。

你的职责包括：
1. 解读和解释各合同条款的含义、适用场景和法律效力
2. 分析合同风险和潜在争议点
3. 解答关于合同管理流程的问题
4. 提供合同管理的最佳实践建议

回答要求：
- 默认使用简体中文进行回复，除非用户明确要求使用其他语言（如繁体中文、英文等）
- 【条款引用格式 - 极其重要，必须严格遵守】
${formatRules}
  · ❌ 绝对禁止使用不带前缀的裸 "Clause X" 格式！因为无法判断是哪个合同的条款
  · ✅ 正确示范：${formatExamples}
  · 如有多个条款连在一起，必须分别写出全称
- 【超链接规则】你的回复中只有 "[合同简称] Clause + 数字编号" 格式的文字才会被系统识别为可点击的条款超链接
- 使用清晰易懂的语言，避免过于晦涩的法律术语
- 如有需要，提供中英文对照解释
- 回答要有逻辑结构，可使用列表、标题等格式`;
}
