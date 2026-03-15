
// =======================================================
// General Contract Manager - app.js (通用合同管理助手核心)
// =======================================================
// 注：escapeHtml / sanitizeHtml / showStatus / showSuccess / showError
//     已迁移至 utils.js（先于本文件加载）


// =======================================================
// 1. 全局状态（全部动态初始化，无硬编码合同）
// =======================================================
let contracts = {};                    // 动态合同数据库（空初始化）
const CONTRACTS_DB_KEY = 'general_contract_db'; // IndexedDB 存储键名
let fullClauseDatabase = {};           // 当前激活合同的数据引用
let savedBookmarks = null;
let activeContractKey = null;          // 当前激活合同键（null = 无合同）
let searchStatePerContract = {};       // 每合同独立搜索状态
let refViewStatePerContract = {};      // 每合同独立右侧面板折叠状态
let navViewStatePerContract = {};      // 每合同独立左侧面板折叠状态

let isDeleteMode = false;
let dragSrcEl = null;
let reverseRefIndex = {};
let refHistory = [];
let refHistoryIndex = -1;
let currentRefId = null;
let currentRefMode = 'ref';
let isTraditionalChinese = false;
let isViewingCrossContractRef = false;
let crossRefContractKey = null;        // 跨合同引用的源合同键
const THEMES = ['day', 'eye', 'dark'];
let currentThemeIndex = 0;
let logicFlowcharts = {};              // 流程图数据（壳程序为空）

// AI 助手状态
let chatMessages = [];
let contextBreakIndex = -1;
let hasContextBreak = false;
let isStreaming = false;
let abortController = null;
let isAssistantMode = false;
let isKnowledgeBaseMode = false;
let isAssistantRefVisible = false;
let assistantRefClauseType = null;
let assistantRefClauseId = null;
let isAssistantTraditional = false;
let isThinkingMode = false;

// 编辑模式
let isEditMode = false;
// 同步滚动
let isSyncMode = false;

// 自动保存
const AUTO_SAVE_KEY = 'General_Contract_AutoSave';
const AUTO_SAVE_INTERVAL = 30000;
let autoSaveTimer = null;
let hasUnsavedChanges = false;
let lastSavedTime = 0;

// 撤销/重做
const MAX_HISTORY_SIZE = 50;
let editHistory = {};
let currentEditingClause = null;

// AI 设置 localStorage 键
const AI_SETTINGS_KEYS = {
    endpoint: 'ai_api_endpoint',
    apiKey: 'ai_api_key',
    model: 'ai_model',
    embeddingEndpoint: 'ai_embedding_endpoint',
    embeddingApiKey: 'ai_embedding_api_key',
    embeddingModel: 'ai_embedding_model',
    rerankEnabled: 'ai_rerank_enabled',
    rerankEndpoint: 'ai_rerank_endpoint',
    rerankApiKey: 'ai_rerank_api_key',
    rerankModel: 'ai_rerank_model',
    systemPrompt: 'ai_system_prompt'
};

// 模型管理
let AI_CHAT_MODELS = [];
let currentSelectedModelId = null;

// =======================================================
// 2. 合同注册与动态 Tab 管理
// =======================================================

/**
 * 注册新合同到系统
 */
function registerContract(key, title, data) {
    // 保存原始数据副本（用于版本对比）
    const originalData = JSON.parse(JSON.stringify(data));

    contracts[key] = {
        title: title,
        data: data,
        bookmarks: null
    };

    // 初始化原始数据（用于对比）
    if (typeof ORIGINAL_CONTRACTS === 'undefined') {
        window.ORIGINAL_CONTRACTS = {};
    }
    ORIGINAL_CONTRACTS[key] = { data: originalData };

    // 初始化每合同独立状态
    searchStatePerContract[key] = '';
    refViewStatePerContract[key] = false;
    navViewStatePerContract[key] = false;
    if (typeof syncStatePerContract !== 'undefined') {
        syncStatePerContract[key] = false;
    }

    // 渲染 Tabs
    renderTabs();

    // 切换到新合同
    switchContract(key);

    // 保存到 IndexedDB
    saveContractsToStorage();

    Logger.info('app', `已注册合同: ${key} (${title}), ${Object.keys(data).length} 条条款`);
}

/**
 * 动态渲染顶部标签栏
 */
function renderTabs() {
    const tabContainer = document.getElementById('contract-tabs');
    if (!tabContainer) return;

    // 清空现有合同标签（保留助手标签）
    tabContainer.querySelectorAll('.header-tab.contract-tab').forEach(el => el.remove());
    // 如果没有欢迎页标签，先创建一个并插入到最前面
    let welcomeTab = document.getElementById('tab-Welcome');
    if (!welcomeTab) {
        welcomeTab = document.createElement('button');
        welcomeTab.className = 'header-tab contract-tab';
        welcomeTab.id = 'tab-Welcome';
        welcomeTab.setAttribute('data-key', 'Welcome');
        welcomeTab.innerHTML = '<span class="tab-full">欢迎页</span><span class="tab-short">🏠</span>';
        welcomeTab.onclick = () => showWelcomePage();
        tabContainer.insertBefore(welcomeTab, tabContainer.firstChild);
    }

    // 在助手标签前插入合同标签
    const assistantTab = document.getElementById('tab-Assistant');
    const keys = Object.keys(contracts);

    keys.forEach(key => {
        const btn = document.createElement('button');
        btn.className = 'header-tab contract-tab';
        btn.id = `tab-${key}`;
        btn.setAttribute('data-key', key);
        btn.innerText = key;
        btn.onclick = () => switchContract(key);

        if (key === activeContractKey) {
            btn.classList.add('active');
        }

        if (assistantTab) {
            tabContainer.insertBefore(btn, assistantTab);
        } else {
            tabContainer.appendChild(btn);
        }
    });
}

/**
 * 移除合同
 */
function removeContract(key) {
    if (!contracts[key]) return;
    delete contracts[key];
    delete searchStatePerContract[key];
    delete refViewStatePerContract[key];
    delete navViewStatePerContract[key];
    if (typeof syncStatePerContract !== 'undefined') delete syncStatePerContract[key];

    if (activeContractKey === key) {
        const remainingKeys = Object.keys(contracts);
        if (remainingKeys.length > 0) {
            switchContract(remainingKeys[0]);
        } else {
            activeContractKey = null;
            fullClauseDatabase = {};
            showWelcomePage();
        }
    }

    // 从原始数据记录中也删除
    if (typeof ORIGINAL_CONTRACTS !== 'undefined' && ORIGINAL_CONTRACTS[key]) {
        delete ORIGINAL_CONTRACTS[key];
    }

    renderTabs();
    saveContractsToStorage(); // 同步删除到数据库

    // 强制刷新当前欢迎页面状态
    if (activeContractKey === null || document.getElementById('tab-Welcome')?.classList.contains('active')) {
        showWelcomePage();
    }
}

/**
 * 将所有的合同数据序列化并保存到浏览器 IndexedDB 中
 */
async function saveContractsToStorage() {
    try {
        await localforage.setItem(CONTRACTS_DB_KEY, JSON.stringify(contracts));
        Logger.info('storage', '成功保存所有合同数据到 IndexedDB');
    } catch (e) {
        Logger.error('storage', '无法保存合同数据到 IndexedDB', e);
        if (typeof showError === 'function') showError('数据持久化失败', e.message);
    }
}

/**
 * 启动时从 IndexedDB 加载并恢复合同数据
 */
async function loadContractsFromStorage() {
    try {
        const saved = await localforage.getItem(CONTRACTS_DB_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Object.keys(parsed).length > 0) {
                contracts = parsed;
                // 重建 ORIGINAL_CONTRACTS 副本
                if (typeof ORIGINAL_CONTRACTS === 'undefined') window.ORIGINAL_CONTRACTS = {};
                Object.keys(contracts).forEach(key => {
                    ORIGINAL_CONTRACTS[key] = { data: JSON.parse(JSON.stringify(contracts[key].data)) };
                    searchStatePerContract[key] = '';
                    refViewStatePerContract[key] = false;
                    navViewStatePerContract[key] = false;
                    if (typeof syncStatePerContract !== 'undefined') syncStatePerContract[key] = false;
                });
                renderTabs();
                // 如果有数据，默认打开第一个
                switchContract(Object.keys(contracts)[0]);
                Logger.info('storage', `从 IndexedDB 成功恢复 ${Object.keys(contracts).length} 个合同`);
                return true;
            }
        }
    } catch (e) {
        Logger.error('storage', '从 IndexedDB 读取保存的合同数据失败', e);
    }

    // 如果没有数据或加载失败，显示欢迎页
    renderTabs();
    showWelcomePage();
    return false;
}

// =======================================================
// 3. 欢迎页管理 (含合同控制台)
// =======================================================
function showWelcomePage() {
    // 强制清理活动全局变量
    if (activeContractKey) {
        captureCurrentContent();
    }
    activeContractKey = null;
    fullClauseDatabase = {};
    document.querySelectorAll('.header-tab').forEach(btn => btn.classList.remove('active'));
    const tabWelcome = document.getElementById('tab-Welcome');
    if (tabWelcome) tabWelcome.classList.add('active');

    const main = document.getElementById('panelMain');
    if (!main) return;

    let listHtml = "";
    const contractKeys = Object.keys(contracts);

    if (contractKeys.length === 0) {
        listHtml = `<div class="empty-state">目前还没有导入任何合同哦。请点击右上角 📥 导入合同数据。</div>`;
    } else {
        listHtml = `<div class="contract-grid">`;
        contractKeys.forEach(key => {
            const cInfo = contracts[key];
            const clauseCount = Object.keys(cInfo.data).length;
            listHtml += `
                <div class="contract-card">
                    <button class="btn-delete-hover" onclick="handleDeleteContract('${key}')" title="删除当前合同">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                    <div class="card-content">
                        <div class="input-group">
                            <label>短名 (标签):</label>
                            <input type="text" class="edit-input key-input" value="${escapeHtml(key)}" 
                                onblur="handleAutoRenameContract('${key}', 'key', this)"
                                onkeydown="if(event.key==='Enter') this.blur();" />
                        </div>
                        <div class="input-group">
                            <label>完整名称:</label>
                            <input type="text" class="edit-input title-input" value="${escapeHtml(cInfo.title)}" 
                                onblur="handleAutoRenameContract('${key}', 'title', this)"
                                onkeydown="if(event.key==='Enter') this.blur();" />
                        </div>
                        <div class="clause-count">
                            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            包含条款: <strong>${clauseCount}</strong> 条
                        </div>
                    </div>
                </div>
            `;
        });
        listHtml += `</div>`;
    }

    main.innerHTML = `
        <div class="welcome-page-v2">
            <div class="welcome-bg-decor">
                <div class="welcome-decor-circle welcome-decor-circle-1"></div>
                <div class="welcome-decor-circle welcome-decor-circle-2"></div>
                <div class="welcome-decor-circle welcome-decor-circle-3"></div>
            </div>
            <div class="welcome-content-v2">
                <div class="welcome-logo-area">
                    <svg class="welcome-logo-svg" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="8" y="8" width="64" height="64" rx="16" fill="url(#logoGrad)" opacity="0.12"/>
                        <rect x="16" y="16" width="48" height="48" rx="12" fill="url(#logoGrad)" opacity="0.2"/>
                        <path d="M28 30h24M28 40h24M28 50h16" stroke="url(#logoGrad)" stroke-width="3" stroke-linecap="round"/>
                        <circle cx="58" cy="24" r="10" fill="url(#dotGrad)"/>
                        <path d="M54 24l3 3 6-6" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                        <defs>
                            <linearGradient id="logoGrad" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
                                <stop stop-color="#3b82f6"/>
                                <stop offset="1" stop-color="#8b5cf6"/>
                            </linearGradient>
                            <linearGradient id="dotGrad" x1="48" y1="14" x2="68" y2="34" gradientUnits="userSpaceOnUse">
                                <stop stop-color="#10b981"/>
                                <stop offset="1" stop-color="#3b82f6"/>
                            </linearGradient>
                        </defs>
                    </svg>
                </div>
                <h1 class="welcome-title-v2">General Contract Manager</h1>
                <p class="welcome-subtitle-v2">专业 · 智能 · 高效的合同管理平台</p>
                <p class="welcome-desc-v2">基于先进 AI 技术，为合同审查、条款分析与知识管理提供全方位支持<br>支持多合同集并行管理，数据安全持久化存储于本地浏览器</p>
                <div class="welcome-feature-grid-v2">
                    <div class="welcome-feature-card-v2">
                        <div class="wf-icon">📄</div>
                        <div class="wf-title">多合同管理</div>
                        <div class="wf-desc">支持同时导入并管理多份合同，灵活切换查阅</div>
                    </div>
                    <div class="welcome-feature-card-v2">
                        <div class="wf-icon">🔍</div>
                        <div class="wf-title">全文检索</div>
                        <div class="wf-desc">快速全文搜索与书签管理，定位关键条款</div>
                    </div>
                    <div class="welcome-feature-card-v2">
                        <div class="wf-icon">🤖</div>
                        <div class="wf-title">AI 智能分析</div>
                        <div class="wf-desc">接入主流大语言模型，深度分析合同条款风险</div>
                    </div>
                    <div class="welcome-feature-card-v2">
                        <div class="wf-icon">📜</div>
                        <div class="wf-title">双语对照</div>
                        <div class="wf-desc">中英文同步浏览，支持简繁体切换</div>
                    </div>
                    <div class="welcome-feature-card-v2">
                        <div class="wf-icon">☁️</div>
                        <div class="wf-title">云端同步</div>
                        <div class="wf-desc">Firebase 云备份，随时随地安全访问数据</div>
                    </div>
                    <div class="welcome-feature-card-v2">
                        <div class="wf-icon">📤</div>
                        <div class="wf-title">一键导出</div>
                        <div class="wf-desc">支持导出带批注 Word 文档及 PDF 格式</div>
                    </div>
                </div>
                <div class="welcome-cta-v2">
                    <span>点击右上角</span>
                    <span class="welcome-cta-badge">📥</span>
                    <span>导入合同数据开始使用，或点击</span>
                    <span class="welcome-cta-badge">⚙️</span>
                    <span>配置 AI 助手</span>
                </div>
            </div>
        </div>`;

    document.querySelector('.nav-title').innerText = '请在正文中选择合同';
    document.getElementById('navList').innerHTML = '';

    // 默认折叠左右侧面板
    const panelNav = document.getElementById('panelNav');
    const resizer1 = document.getElementById('resizer1');
    if (panelNav && resizer1) {
        panelNav.classList.add('collapsed');
        resizer1.classList.add('hidden');
    }

    const panelRef = document.getElementById('panelRef');
    const resizer2 = document.getElementById('resizer2');
    if (panelRef && resizer2) {
        panelRef.classList.add('collapsed');
        resizer2.classList.add('hidden');
    }
}

function handleAutoRenameContract(oldKey, type, inputElement) {
    const newValue = inputElement.value.trim();
    if (!newValue) {
        // 恢复原始值
        inputElement.value = type === 'key' ? oldKey : contracts[oldKey].title;
        if (typeof showStatus === 'function') showStatus('名称不能为空', 3000, true);
        return;
    }

    if (type === 'key') {
        if (newValue === oldKey) return; // 无变化
        if (contracts[newValue]) {
            inputElement.value = oldKey; // 恢复
            if (typeof showStatus === 'function') showStatus(`短名称 [${newValue}] 已存在`, 3000, true);
            return;
        }

        // 深拷贝并替换
        const dataRef = contracts[oldKey];
        contracts[newValue] = dataRef;
        delete contracts[oldKey];
        delete searchStatePerContract[oldKey];
        delete refViewStatePerContract[oldKey];
        delete navViewStatePerContract[oldKey];
        searchStatePerContract[newValue] = '';
        refViewStatePerContract[newValue] = false;
        navViewStatePerContract[newValue] = false;
        if (typeof ORIGINAL_CONTRACTS !== 'undefined' && ORIGINAL_CONTRACTS[oldKey]) {
            ORIGINAL_CONTRACTS[newValue] = ORIGINAL_CONTRACTS[oldKey];
            delete ORIGINAL_CONTRACTS[oldKey];
        }

        saveContractsToStorage();
        renderTabs();
        showWelcomePage(); // 刷新控制台以重新绑定新的 Key
        if (typeof showSuccess === 'function') showSuccess('短名称已静默更新');
    } else if (type === 'title') {
        const oldTitle = contracts[oldKey].title;
        if (newValue === oldTitle) return; // 无变化

        contracts[oldKey].title = newValue;
        saveContractsToStorage();
        // 仅提示保存成功，无需整页刷新
        if (typeof showSuccess === 'function') showSuccess('完整名称已静默更新');
    }
}

function handleDeleteContract(key) {
    if (confirm(`警告：您确认要彻底删除 "${key}" 吗？此操作无法撤销，数据将从本地存储中彻底移除。`)) {
        removeContract(key);
    }
}

function hideWelcomePage() {
    // We don't remove the welcome page outright anymore.
    // When a contract is switched, the main view replaces panelMain content.
}

// =======================================================
// 4. 程序初始化
// =======================================================
window.onload = async function () {
    Logger.info('app', '通用合同壳程序启动');

    // 主题
    const savedTheme = localStorage.getItem('gcc_theme_idx');
    if (savedTheme !== null) {
        currentThemeIndex = parseInt(savedTheme);
    }
    applyTheme(currentThemeIndex);

    // AI 设置
    loadAISettings();
    initModelSelector();

    // RAG
    try {
        await RAG.init();
        Logger.info('rag', 'RAG 初始化完成');
    } catch (e) {
        Logger.error('rag', 'RAG 初始化失败', e);
    }

    initResizers();
    initAutoSave();

    // 加载合同本地数据并恢复状态（替换直接 showWelcomePage 的逻辑）
    await loadContractsFromStorage();

    Logger.info('app', '程序启动完成，后台状态初始化完毕');
};

// =======================================================
// 5. 主题切换
// =======================================================
function cycleTheme() {
    currentThemeIndex = (currentThemeIndex + 1) % THEMES.length;
    applyTheme(currentThemeIndex);
}

function applyTheme(idx) {
    const body = document.body;
    const icon = document.getElementById('themeIcon');
    body.classList.remove('dark-mode', 'eye-mode');
    if (idx === 1) { body.classList.add('eye-mode'); icon.innerText = '🌿'; }
    else if (idx === 2) { body.classList.add('dark-mode'); icon.innerText = '🌙'; }
    else { icon.innerText = '☀️'; }
    localStorage.setItem('gcc_theme_idx', idx);
}

// =======================================================
// 6. 合同切换（通用版）
// =======================================================
function switchContract(key) {
    if (!contracts[key]) return;

    // 更新标签高亮
    document.querySelectorAll('.header-tab').forEach(btn => btn.classList.remove('active'));
    const tabEl = document.getElementById(`tab-${key}`);
    if (tabEl) tabEl.classList.add('active');

    if (activeContractKey === key) return;
    Logger.info('app', `切换合同: ${activeContractKey} → ${key}`);

    // 保存当前合同状态
    if (activeContractKey && contracts[activeContractKey]) {
        if (typeof syncStatePerContract !== 'undefined') {
            syncStatePerContract[activeContractKey] = isSyncMode;
        }
        const searchInput = document.querySelector('.search-input');
        searchStatePerContract[activeContractKey] = searchInput ? searchInput.value : '';
        if (typeof clearSearchHighlights === 'function') clearSearchHighlights();
        if (isSyncMode && typeof disableSyncModeInternal === 'function') disableSyncModeInternal();
        captureCurrentContent();
        contracts[activeContractKey].bookmarks = savedBookmarks;

        const panelRef = document.getElementById('panelRef');
        if (panelRef) {
            refViewStatePerContract[activeContractKey] = panelRef.classList.contains('collapsed');
        }
        const panelNav = document.getElementById('panelNav');
        if (panelNav) {
            navViewStatePerContract[activeContractKey] = panelNav.classList.contains('collapsed');
        }
    }

    resetCrossRefState();
    activeContractKey = key;
    fullClauseDatabase = contracts[key].data;

    savedBookmarks = null;
    if (contracts[key].bookmarks && contracts[key].bookmarks.length > 0) {
        savedBookmarks = contracts[key].bookmarks;
    }

    if (isEditMode) toggleEditMode();

    renderMainDocument();
    if (typeof initBookmarks === 'function') initBookmarks();
    buildReverseIndex();

    // 恢复同步滚动状态
    if (typeof syncStatePerContract !== 'undefined' && syncStatePerContract[key]) {
        setTimeout(() => { if (typeof enableSyncModeInternal === 'function') enableSyncModeInternal(); }, 50);
    } else {
        const refContent = document.getElementById('refContent');
        const refHeader = document.getElementById('refFixedHeader');
        if (refContent) refContent.innerHTML = `<div style="padding:20px; text-align:center; color:#999; margin-top:50px;">Switched to ${key}</div>`;
        if (refHeader) refHeader.style.display = 'none';
    }

    // 恢复右侧面板的折叠状态
    const isRefCollapsed = refViewStatePerContract[key] || false;
    const pRef = document.getElementById('panelRef');
    const resizer2 = document.getElementById('resizer2');
    if (pRef && resizer2) {
        if (isRefCollapsed) {
            pRef.classList.add('collapsed');
            resizer2.classList.add('hidden');
        } else {
            pRef.classList.remove('collapsed');
            resizer2.classList.remove('hidden');
        }
    }

    // 恢复左侧面板的折叠状态
    const isNavCollapsed = navViewStatePerContract[key] || false;
    const pNav = document.getElementById('panelNav');
    const resizer1 = document.getElementById('resizer1');
    if (pNav && resizer1) {
        if (isNavCollapsed) {
            pNav.classList.add('collapsed');
            resizer1.classList.add('hidden');
        } else {
            pNav.classList.remove('collapsed');
            resizer1.classList.remove('hidden');
        }
    }

    // 恢复搜索状态
    const targetSearchInput = document.querySelector('.search-input');
    const targetSearchTerm = searchStatePerContract[key] || '';
    if (targetSearchInput) {
        targetSearchInput.value = targetSearchTerm;
        if (typeof toggleSearchClear === 'function') toggleSearchClear(targetSearchInput);
    }
    if (targetSearchTerm && typeof filterNav === 'function') {
        filterNav(targetSearchTerm);
    } else {
        currentSearchTerm = '';
    }

    document.querySelector('.nav-title').innerText = `${key} NAVIGATOR`;
}

// =======================================================
// 7. 主文档渲染
// =======================================================
function renderMainDocument() {
    const contentDiv = document.getElementById('panelMain');
    if (!fullClauseDatabase || Object.keys(fullClauseDatabase).length === 0) {
        contentDiv.innerHTML = "<h3 style='color:red; text-align:center; margin-top:50px;'>无数据。请导入合同数据。</h3>";
        return;
    }
    const sortedKeys = Object.keys(fullClauseDatabase).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    let html = "";
    sortedKeys.forEach(id => {
        const clause = fullClauseDatabase[id];
        html += "<div id=\"clause-" + id + "\"><div style=\"display:flex; align-items:center; margin-top:40px; border-bottom:2px solid var(--border-color); padding-bottom:10px; flex-wrap:wrap; gap:8px;\"><h2 style=\"margin:0; border:none; padding:0; flex:1;\" onclick=\"showTranslation('" + id + "')\">" + sanitizeHtml(clause.title) + "</h2></div><div class=\"clause-text\" contenteditable=\"true\" spellcheck=\"false\">" + sanitizeHtml(clause.content) + "</div></div>";
    });
    contentDiv.innerHTML = html;
    contentDiv.querySelectorAll('.clause-ref').forEach(el => { el.outerHTML = el.textContent; });
    autoLinkClauses();
}

// =======================================================
// 8. 反向引用索引
// =======================================================
function buildReverseIndex() {
    reverseRefIndex = {};
    Object.keys(fullClauseDatabase).forEach(src => {
        const regex = /Clause\s+(\d+)/gi;
        let match;
        while ((match = regex.exec(fullClauseDatabase[src].content)) !== null) {
            const target = match[1];
            if (target !== src && fullClauseDatabase[target]) {
                if (!reverseRefIndex[target]) reverseRefIndex[target] = new Set();
                reverseRefIndex[target].add(src);
            }
        }
    });
}

function getReverseRefHTML(id) {
    if (!reverseRefIndex[id] || reverseRefIndex[id].size === 0) return '';
    const links = Array.from(reverseRefIndex[id]).sort((a, b) => parseInt(a) - parseInt(b)).map(rid =>
        "<span class=\"reverse-link\" onclick=\"scrollToClause('" + rid + "')\">Clause " + rid + "</span>"
    ).join(" ");
    return "<div class=\"reverse-ref-box\"><div class=\"reverse-ref-title\"> 反向引用:</div><div>" + links + "</div></div>";
}

// =======================================================
// 9. 自动条款链接（通用版 - 动态生成）
// =======================================================
function autoLinkClauses() {
    const div = document.getElementById('panelMain');
    if (!div) return;
    const textDivs = div.querySelectorAll('.clause-text');
    textDivs.forEach(textDiv => {
        let html = textDiv.innerHTML;
        // 动态为每种已导入合同类型生成跨合同链接
        Object.keys(contracts).forEach(contractKey => {
            if (contractKey !== activeContractKey) {
                // 匹配 "ContractKey Clause X" 格式
                const regex = new RegExp(contractKey + '\\s+[Cc]lause\\s+(\\d+[A-Za-z]?)', 'gi');
                html = html.replace(regex, (match, num) => {
                    if (contracts[contractKey].data[num]) {
                        return "<span class=\"clause-ref\" contenteditable=\"false\" onclick=\"showCrossContractRef('" + contractKey + "', '" + num + "')\">" + match + "</span>";
                    }
                    return match;
                });
            }
        });
        // 通用 Clause X 链接（当前合同）
        html = html.replace(/Clause\s+(\d+[A-Za-z]?)/gi, (match, num) => {
            if (html.includes('onclick=\"showCrossContractRef')) return match;
            if (fullClauseDatabase[num]) return "<span class=\"clause-ref\" contenteditable=\"false\" onclick=\"showRef('" + num + "')\">" + match + "</span>";
            return match;
        });
        textDiv.innerHTML = html;
    });
}

// =======================================================
// 10. 引用导航
// =======================================================
function showRef(id) { resetCrossRefState(); openSidePanel(); navigateToRef(id, 'ref', true); highlightActiveLink(); }
function showTranslation(id) { resetCrossRefState(); openSidePanel(); navigateToRef(id, 'trans', true); }
function navigateToRefInternal(id) { navigateToRef(id, 'ref', true); }

function navigateToRef(id, mode, isNew) {
    if (!fullClauseDatabase[id]) return;
    if (isNew) {
        if (refHistoryIndex < refHistory.length - 1) refHistory = refHistory.slice(0, refHistoryIndex + 1);
        refHistory.push({ id: id, mode: mode });
        refHistoryIndex++;
    }
    updateNavButtons();
    renderRefContent(id, mode);
}
function goRefBack() { resetCrossRefState(); if (refHistoryIndex > 0) { refHistoryIndex--; const item = refHistory[refHistoryIndex]; navigateToRef(item.id, item.mode, false); } }
function goRefForward() { resetCrossRefState(); if (refHistoryIndex < refHistory.length - 1) { refHistoryIndex++; const item = refHistory[refHistoryIndex]; navigateToRef(item.id, item.mode, false); } }
function goRefStep(offset) {
    resetCrossRefState();
    const keys = Object.keys(fullClauseDatabase).sort((a, b) => parseInt(a) - parseInt(b));
    const currentIdx = keys.indexOf(currentRefId ? currentRefId.toString() : "");
    if (currentIdx === -1) return;
    const newIdx = currentIdx + offset;
    if (newIdx >= 0 && newIdx < keys.length) navigateToRef(keys[newIdx], currentRefMode, true);
}
function updateNavButtons() {
    const btnBack = document.getElementById('btnRefBack');
    const btnFwd = document.getElementById('btnRefFwd');
    const btnPrev = document.getElementById('btnRefPrev');
    const btnNext = document.getElementById('btnRefNext');
    if (btnBack) btnBack.disabled = (refHistoryIndex <= 0);
    if (btnFwd) btnFwd.disabled = (refHistoryIndex >= refHistory.length - 1);
    const keys = Object.keys(fullClauseDatabase).sort((a, b) => parseInt(a) - parseInt(b));
    const idx = keys.indexOf(currentRefId ? currentRefId.toString() : "");
    if (btnPrev) btnPrev.disabled = (idx <= 0);
    if (btnNext) btnNext.disabled = (idx === -1 || idx >= keys.length - 1);
}
function processRefLinks(text) {
    return text.replace(/Clause\s+(\d+)/gi, (match, num) => { if (fullClauseDatabase[num]) return "<span class=\"ref-internal-link\" onclick=\"navigateToRefInternal('" + num + "')\">" + match + "</span>"; return match; });
}
function renderRefContent(id, mode) {
    currentRefId = id; currentRefMode = mode; updateNavButtons();
    const header = document.getElementById('refFixedHeader');
    const title = document.getElementById('refFixedTitle');
    const content = document.getElementById('refContent');
    const dbEntry = fullClauseDatabase[id];
    if (!dbEntry) return;
    header.style.display = 'block'; header.classList.remove('mode-ref', 'mode-trans');
    if (mode === 'ref') {
        header.classList.add('mode-ref');
        title.innerText = "Referenced: " + dbEntry.title;
        content.innerHTML = "<div class=\"ref-card-body\"><div style=\"line-height:1.6;\">" + processRefLinks(sanitizeHtml(dbEntry.content)) + "</div>" + getReverseRefHTML(id) + "</div>";
    } else {
        header.classList.add('mode-trans');
        const transText = isTraditionalChinese ? (dbEntry.translation_tc || dbEntry.translation) : dbEntry.translation;
        const langLabel = isTraditionalChinese ? '繁體譯文' : '中文译文';
        title.innerText = langLabel + "：" + dbEntry.title;
        content.innerHTML = "<div class=\"ref-card-body\"><div style=\"line-height:1.8; text-align:justify;\">" + sanitizeHtml(transText || '(暂无译文)') + "</div>" + getReverseRefHTML(id) + "</div>";
    }
    content.scrollTop = 0;
}

// =======================================================
// 11. 跨合同引用（通用版）
// =======================================================
function showCrossContractRef(contractKey, clauseId) {
    isViewingCrossContractRef = true;
    crossRefContractKey = contractKey;
    openSidePanel();
    renderCrossContractRefContent(contractKey, clauseId, 'ref');
    updateCrossRefButton();
    highlightActiveLink();
}

function renderCrossContractRefContent(contractKey, id, mode) {
    currentRefId = id; currentRefMode = mode; updateNavButtons();
    const data = contracts[contractKey] ? contracts[contractKey].data : null;
    const dbEntry = data ? data[id] : null;
    if (!dbEntry) return;
    const header = document.getElementById('refFixedHeader');
    const title = document.getElementById('refFixedTitle');
    const content = document.getElementById('refContent');
    header.style.display = 'block'; header.classList.remove('mode-ref', 'mode-trans');
    if (mode === 'ref') {
        header.classList.add('mode-ref');
        title.innerText = contractKey + " Referenced: " + dbEntry.title;
        content.innerHTML = "<div class=\"ref-card-body\"><div style=\"line-height:1.6;\">" + processRefLinks(sanitizeHtml(dbEntry.content)) + "</div></div>";
    } else {
        header.classList.add('mode-trans');
        const transText = isTraditionalChinese ? (dbEntry.translation_tc || dbEntry.translation) : dbEntry.translation;
        const langLabel = isTraditionalChinese ? (contractKey + ' 繁體譯文') : (contractKey + ' 中文译文');
        title.innerText = langLabel + "：" + dbEntry.title;
        content.innerHTML = "<div class=\"ref-card-body\"><div style=\"line-height:1.8; text-align:justify;\">" + (sanitizeHtml(transText) || '<span style="color:#999;">(暂无译文)</span>') + "</div></div>";
    }
    content.scrollTop = 0;
    updateLangModeButton();
}

function updateCrossRefButton() {
    const btn = document.getElementById('btnLangMode');
    if (btn) btn.style.display = isViewingCrossContractRef ? 'flex' : 'none';
}
function updateLangModeButton() {
    const btn = document.getElementById('btnLangMode');
    if (btn) btn.innerText = (currentRefMode === 'ref') ? '译' : '原';
}
function resetCrossRefState() {
    isViewingCrossContractRef = false;
    crossRefContractKey = null;
    updateCrossRefButton();
}
function toggleRefLangMode() {
    if (!isViewingCrossContractRef || !crossRefContractKey) return;
    renderCrossContractRefContent(crossRefContractKey, currentRefId, currentRefMode === 'ref' ? 'trans' : 'ref');
}

// 面板控制
function openSidePanel() {
    const p = document.getElementById('panelRef');
    if (p && p.classList.contains('collapsed')) { p.classList.remove('collapsed'); document.getElementById('resizer2').classList.remove('hidden'); }
}
function highlightActiveLink() {
    document.querySelectorAll('.clause-ref').forEach(el => el.classList.remove('active'));
    if (event && event.target && event.target.classList.contains('clause-ref')) event.target.classList.add('active');
}
function toggleNav() {
    const panel = document.getElementById('panelNav');
    const resizer = document.getElementById('resizer1');
    if (window.innerWidth <= 768) {
        panel.classList.toggle('visible');
        document.body.classList.toggle('panel-open', panel.classList.contains('visible'));
        document.getElementById('panelRef').classList.remove('visible');
    }
    else {
        panel.classList.toggle('collapsed');
        resizer.classList.toggle('hidden');
    }

    // 立即保存当前合同的左侧面板折叠状态
    if (activeContractKey && !isAssistantMode) {
        navViewStatePerContract[activeContractKey] = panel.classList.contains('collapsed');
    }
}
function toggleRef() {
    if (isAssistantMode) { toggleAssistantRef(); return; }
    const panel = document.getElementById('panelRef');
    const resizer = document.getElementById('resizer2');
    if (window.innerWidth <= 1024) {
        panel.classList.toggle('visible');
        if (window.innerWidth <= 768) {
            document.body.classList.toggle('panel-open', panel.classList.contains('visible'));
            document.getElementById('panelNav').classList.remove('visible');
        }
    }
    else {
        panel.classList.toggle('collapsed');
        resizer.classList.toggle('hidden');
    }

    // 立即保存当前合同的右侧面板折叠状态
    if (activeContractKey && !isAssistantMode) {
        refViewStatePerContract[activeContractKey] = panel.classList.contains('collapsed');
    }
}

// 简繁切换
function toggleChineseVariant() {
    isTraditionalChinese = !isTraditionalChinese;
    const btn = document.getElementById('btnLangToggle');
    btn.innerText = isTraditionalChinese ? '繁' : '简';
    if (isSyncMode) { renderAllTranslations(); }
    else if (isViewingCrossContractRef && currentRefId && crossRefContractKey) {
        renderCrossContractRefContent(crossRefContractKey, currentRefId, currentRefMode);
    } else if (currentRefId && currentRefMode === 'trans') { renderRefContent(currentRefId, 'trans'); }
}

function scrollToClause(id) {
    const el = document.getElementById('clause-' + id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =======================================================
// 12. 浮动工具栏
// =======================================================
function checkSelection() {
    if (!activeContractKey || isAssistantMode || document.getElementById('tab-Welcome')?.classList.contains('active')) {
        return;
    }

    const tb = document.getElementById('floatingToolbar');
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.toString().trim() === '') return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    tb.style.display = 'flex';
    tb.style.top = (rect.top - 50 + window.scrollY) + 'px';
    const mainRect = document.getElementById('panelMain').getBoundingClientRect();
    let l = rect.left + (rect.width / 2) - (tb.offsetWidth / 2);
    if (l < mainRect.left) l = mainRect.left;
    tb.style.left = l + 'px';
}
function toggleDropdown(id, btn) {
    const menu = document.getElementById(id);
    if (!menu) return;
    document.querySelectorAll('.color-dropdown').forEach(d => { if (d.id !== id) d.classList.remove('show'); });
    document.querySelectorAll('.dropdown-menu').forEach(d => { if (d.id !== id) d.style.display = 'none'; });
    document.querySelectorAll('.toolbar-btn').forEach(b => { if (b !== btn) b.classList.remove('active'); });
    if (menu.classList.contains('dropdown-menu')) {
        const isOpen = menu.style.display === 'block';
        menu.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) {
            const closeMenu = function (e) { if (!menu.contains(e.target) && !btn.contains(e.target)) { menu.style.display = 'none'; document.removeEventListener('mousedown', closeMenu); } };
            setTimeout(() => { document.addEventListener('mousedown', closeMenu); }, 0);
        }
    } else { menu.classList.toggle('show'); btn.classList.toggle('active'); }
}
function applyFormat(cmd, val = null) {
    document.execCommand(cmd, false, val);
    document.querySelectorAll('.color-dropdown').forEach(d => d.classList.remove('show'));
    document.querySelectorAll('.toolbar-btn').forEach(b => b.classList.remove('active'));
}
document.addEventListener('mousedown', e => {
    const tb = document.getElementById('floatingToolbar');
    if (tb && !tb.contains(e.target)) setTimeout(() => {
        if (window.getSelection().toString().trim() === '') { tb.style.display = 'none'; document.querySelectorAll('.color-dropdown').forEach(d => d.classList.remove('show')); }
    }, 100);
});

// 备注系统、编辑模式、剪切板事件（已迁移至 editor.js）

// =======================================================
// 14. 拖拽面板分隔条
// =======================================================
function initResizers() {
    const r1 = document.getElementById('resizer1');
    const r2 = document.getElementById('resizer2');
    const nav = document.getElementById('panelNav');
    const main = document.getElementById('panelMain');
    const ref = document.getElementById('panelRef');
    if (r1 && nav && main) setupResizer(r1, nav, main, 'right');
    if (r2 && main && ref) setupResizer(r2, ref, main, 'left');
}
function setupResizer(resizer, panel, neighbor, dir) {
    let startX, startW;
    resizer.addEventListener('mousedown', e => {
        e.preventDefault(); startX = e.clientX; startW = panel.getBoundingClientRect().width;
        const move = e2 => { const diff = dir === 'right' ? (e2.clientX - startX) : (startX - e2.clientX); panel.style.width = Math.max(150, startW + diff) + 'px'; };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    });
}

// =======================================================
// 15-20. AI管理助手、聊天UI、Markdown渲染、条款选择器、
//        助手侧栏、知识库模式（已迁移至 ai-assistant.js）
// =======================================================


// =======================================================
// 21. 设置弹窗与模型管理（已迁移至 ai-settings.js）
// =======================================================



// =======================================================
// 22 & 23. 导出/导入、自动保存（已迁移至 editor.js）
// =======================================================

// =======================================================
// 24. 状态提示（已迁移至 utils.js）& 流程图占位
// =======================================================
// showStatus / showSuccess / showError → utils.js

// 流程图（壳程序占位）
function openFlowchart(clauseId) { }
function closeFlowchart() { const m = document.getElementById('flowchartModal'); if (m) m.style.display = 'none'; }

// 键盘快捷键 Ctrl+S（已迁移至 editor.js）

// 搜索相关全局变量（供 search.js 使用）
let currentSearchTerm = '';
let searchHighlights = [];

// 全局可访问函数引用（供 cloud-storage.js 和其他模块使用）
function getAISettingsForCloud() {
    return { apiEndpoint: AI_CONFIG.apiEndpoint || '', apiKey: AI_CONFIG.apiKey || '', model: AI_CONFIG.model || '', embeddingEndpoint: AI_CONFIG.embeddingEndpoint || '', embeddingApiKey: AI_CONFIG.embeddingApiKey || '', embeddingModel: AI_CONFIG.embeddingModel || '', rerankEnabled: AI_CONFIG.rerankEnabled || false, rerankEndpoint: AI_CONFIG.rerankEndpoint || '', rerankApiKey: AI_CONFIG.rerankApiKey || '', rerankModel: AI_CONFIG.rerankModel || '', systemPrompt: AI_CONFIG.systemPrompt || '' };
}
function applyCloudAISettings(cs) {
    if (!cs) return;
    ['apiEndpoint', 'apiKey', 'model', 'embeddingEndpoint', 'embeddingApiKey', 'embeddingModel', 'rerankEndpoint', 'rerankApiKey', 'rerankModel'].forEach(k => { if (cs[k] !== undefined) { AI_CONFIG[k] = cs[k]; } });
    if (cs.rerankEnabled !== undefined) AI_CONFIG.rerankEnabled = cs.rerankEnabled;
    if (cs.systemPrompt) AI_CONFIG.systemPrompt = cs.systemPrompt;
}

console.log('[General Contract Shell] app.js 加载完成');
