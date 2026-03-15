// =======================================================
// ai-settings.js - AI 设置与模型管理
// 依赖：config.js (AI_CONFIG)，app.js (AI_SETTINGS_KEYS, AI_CHAT_MODELS,
//        currentSelectedModelId, escapeHtml from utils.js)
// 须在 app.js 之后加载
// =======================================================

// =======================================================
// 设置弹窗
// =======================================================
// =======================================================
// 设置弹窗
// =======================================================

function switchSettingsTab(tabName) {
    const tabAI = document.getElementById('tabAISettings');
    const tabFirebase = document.getElementById('tabFirebaseSettings');
    const tabContract = document.getElementById('tabContractSettings');
    const contentAI = document.getElementById('aiSettingsContent');
    const contentFirebase = document.getElementById('firebaseSettingsContent');
    const contentContract = document.getElementById('contractSettingsContent');

    // Reset all tabs
    [tabAI, tabFirebase, tabContract].forEach(t => {
        if (!t) return;
        t.classList.remove('active');
        t.style.borderBottom = '3px solid transparent';
        t.style.color = '#666';
        t.style.fontWeight = 'normal';
    });
    [contentAI, contentFirebase, contentContract].forEach(c => { if (c) c.style.display = 'none'; });

    if (tabName === 'AI') {
        tabAI.classList.add('active');
        tabAI.style.borderBottom = '3px solid #3498db';
        tabAI.style.color = '#3498db';
        tabAI.style.fontWeight = 'bold';
        contentAI.style.display = 'block';
    } else if (tabName === 'Firebase') {
        tabFirebase.classList.add('active');
        tabFirebase.style.borderBottom = '3px solid #3498db';
        tabFirebase.style.color = '#3498db';
        tabFirebase.style.fontWeight = 'bold';
        contentFirebase.style.display = 'block';
    } else if (tabName === 'Contract') {
        tabContract.classList.add('active');
        tabContract.style.borderBottom = '3px solid #3498db';
        tabContract.style.color = '#3498db';
        tabContract.style.fontWeight = 'bold';
        contentContract.style.display = 'block';
        renderContractManagementTab();
    }
}

function openSettings() {
    const modal = document.getElementById('settingsModal');
    modal.style.display = 'flex';
    loadChatModels();
    renderModelCards();
    document.getElementById('settingEmbeddingEndpoint').value = AI_CONFIG.embeddingEndpoint || '';
    document.getElementById('settingEmbeddingApiKey').value = AI_CONFIG.embeddingApiKey || '';
    document.getElementById('settingEmbeddingModel').value = AI_CONFIG.embeddingModel || '';
    document.getElementById('settingRerankEnabled').checked = AI_CONFIG.rerankEnabled || false;
    document.getElementById('settingRerankEndpoint').value = AI_CONFIG.rerankEndpoint || '';
    document.getElementById('settingRerankApiKey').value = AI_CONFIG.rerankApiKey || '';
    document.getElementById('settingRerankModel').value = AI_CONFIG.rerankModel || '';
    document.getElementById('settingRerankModel').value = AI_CONFIG.rerankModel || '';
    document.getElementById('settingSystemPrompt').value = AI_CONFIG.systemPrompt || '';

    // Load Firebase configs if they exist in window.FIREBASE_CONFIG or localStorage
    let currentFirebaseConfig = {};
    const storedConfig = localStorage.getItem('HK_Firebase_Config');
    if (storedConfig) {
        try {
            currentFirebaseConfig = JSON.parse(storedConfig);
        } catch (e) {
            console.error('Failed to parse Firebase config', e);
        }
    } else if (window.FIREBASE_CONFIG) {
        currentFirebaseConfig = window.FIREBASE_CONFIG;
    }

    document.getElementById('settingFirebaseAuthKey').value = currentFirebaseConfig.apiKey === 'YOUR_API_KEY' ? '' : (currentFirebaseConfig.apiKey || '');
    document.getElementById('settingFirebaseAuthDomain').value = currentFirebaseConfig.authDomain === 'YOUR_PROJECT.firebaseapp.com' ? '' : (currentFirebaseConfig.authDomain || '');
    document.getElementById('settingFirebaseProjectId').value = currentFirebaseConfig.projectId === 'YOUR_PROJECT_ID' ? '' : (currentFirebaseConfig.projectId || '');
    document.getElementById('settingFirebaseStorageBucket').value = currentFirebaseConfig.storageBucket === 'YOUR_PROJECT.appspot.com' ? '' : (currentFirebaseConfig.storageBucket || '');
    document.getElementById('settingFirebaseMessagingSenderId').value = currentFirebaseConfig.messagingSenderId === 'YOUR_SENDER_ID' ? '' : (currentFirebaseConfig.messagingSenderId || '');
    document.getElementById('settingFirebaseAppId').value = currentFirebaseConfig.appId === 'YOUR_APP_ID' ? '' : (currentFirebaseConfig.appId || '');

    // Default to AI tab
    switchSettingsTab('AI');

    ['sectionEmbedding', 'sectionRerank', 'sectionPrompt'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('collapsed')) el.classList.add('collapsed');
    });
    document.getElementById('settingsStatus').style.display = 'none';
}

function closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
}

function toggleSettingsSection(section) {
    const el = document.getElementById('section' + section);
    if (el) el.classList.toggle('collapsed');
}

function getDefaultSystemPrompt() {
    return typeof generateDynamicSystemPrompt === 'function'
        ? generateDynamicSystemPrompt()
        : '你是一位专业的合同管理顾问。请基于用户导入的合同条款数据进行分析和解答。';
}

function resetSystemPrompt() {
    document.getElementById('settingSystemPrompt').value = getDefaultSystemPrompt();
}

async function saveAISettings() {
    const fields = {
        embeddingEndpoint: 'settingEmbeddingEndpoint',
        embeddingApiKey: 'settingEmbeddingApiKey',
        embeddingModel: 'settingEmbeddingModel',
        rerankEndpoint: 'settingRerankEndpoint',
        rerankApiKey: 'settingRerankApiKey',
        rerankModel: 'settingRerankModel'
    };
    Object.entries(fields).forEach(([key, id]) => {
        AI_CONFIG[key] = document.getElementById(id).value.trim();
        let valueToSave = AI_CONFIG[key];
        if (key.toLowerCase().includes('apikey')) {
            valueToSave = obfuscateKey(valueToSave);
        }
        localStorage.setItem(AI_SETTINGS_KEYS[key], valueToSave);
    });
    AI_CONFIG.rerankEnabled = document.getElementById('settingRerankEnabled').checked;
    localStorage.setItem(AI_SETTINGS_KEYS.rerankEnabled, AI_CONFIG.rerankEnabled.toString());
    AI_CONFIG.systemPrompt = document.getElementById('settingSystemPrompt').value.trim() || getDefaultSystemPrompt();
    localStorage.setItem(AI_SETTINGS_KEYS.systemPrompt, AI_CONFIG.systemPrompt);

    // Save Firebase Settings
    const firebaseConfig = {
        apiKey: document.getElementById('settingFirebaseAuthKey').value.trim(),
        authDomain: document.getElementById('settingFirebaseAuthDomain').value.trim(),
        projectId: document.getElementById('settingFirebaseProjectId').value.trim(),
        storageBucket: document.getElementById('settingFirebaseStorageBucket').value.trim(),
        messagingSenderId: document.getElementById('settingFirebaseMessagingSenderId').value.trim(),
        appId: document.getElementById('settingFirebaseAppId').value.trim()
    };

    const previousConfigStr = localStorage.getItem('HK_Firebase_Config');
    const newConfigStr = JSON.stringify(firebaseConfig);
    let firebaseChanged = false;

    if (firebaseConfig.apiKey && firebaseConfig.projectId) {
        if (previousConfigStr !== newConfigStr) {
            localStorage.setItem('HK_Firebase_Config', newConfigStr);
            firebaseChanged = true;
        }
    }

    if (firebaseChanged) {
        showSettingsStatus('✅ 设置已保存，Firebase 配置已更新，页面即将刷新以应用更改', 'success');
        setTimeout(() => window.location.reload(), 1500);
    } else {
        showSettingsStatus('✅ 设置已保存', 'success');
        setTimeout(() => closeSettings(), 1500);
    }
}

function loadAISettings() {
    ['apiEndpoint:endpoint', 'apiKey:apiKey', 'model:model',
        'embeddingEndpoint:embeddingEndpoint', 'embeddingApiKey:embeddingApiKey', 'embeddingModel:embeddingModel',
        'rerankEndpoint:rerankEndpoint', 'rerankApiKey:rerankApiKey', 'rerankModel:rerankModel'
    ].forEach(pair => {
        const [k, sk] = pair.split(':');
        let v = localStorage.getItem(AI_SETTINGS_KEYS[sk]);
        if (v) {
            if (k.toLowerCase().includes('apikey')) v = deobfuscateKey(v);
            AI_CONFIG[k] = v;
        }
    });
    AI_CONFIG.rerankEnabled = localStorage.getItem(AI_SETTINGS_KEYS.rerankEnabled) === 'true';
    const sp = localStorage.getItem(AI_SETTINGS_KEYS.systemPrompt);
    if (sp) AI_CONFIG.systemPrompt = sp;
}

function showSettingsStatus(message, type) {
    const s = document.getElementById('settingsStatus');
    s.style.display = 'block';
    s.innerText = message;
    s.style.background = type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#fff3cd';
    s.style.color = type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#856404';
}

function isAIConfigured() {
    return AI_CONFIG.apiEndpoint && AI_CONFIG.apiKey && AI_CONFIG.model;
}

// =======================================================
// 模型管理
// =======================================================
function loadChatModels() {
    try {
        const s = localStorage.getItem('ai_chat_models');
        if (s) {
            AI_CHAT_MODELS = JSON.parse(s);
            // 解密已有模型的 API Key
            AI_CHAT_MODELS.forEach(m => {
                if (m.apiKey && !m._isDecrypted) {
                    m.apiKey = deobfuscateKey(m.apiKey);
                    m._isDecrypted = true; // 运行时标记
                }
            });
        }
    } catch (e) { AI_CHAT_MODELS = []; }
}

function saveChatModels() {
    // 保存前加密 API Key
    const modelsToSave = AI_CHAT_MODELS.map(m => {
        const copy = { ...m };
        if (copy.apiKey) copy.apiKey = obfuscateKey(copy.apiKey);
        delete copy._isDecrypted;
        return copy;
    });
    localStorage.setItem('ai_chat_models', JSON.stringify(modelsToSave));
}

function renderModelCards() {
    const c = document.getElementById('modelCardContainer');
    if (!c) return;
    if (AI_CHAT_MODELS.length === 0) {
        c.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">暂无模型配置</div>';
        return;
    }
    c.innerHTML = AI_CHAT_MODELS.map(m =>
        '<div class="model-card">' +
        '<div class="model-card-header">' +
        '<span class="model-card-name">' + escapeHtml(m.name) + '</span>' +
        '<div>' +
        '<button class="model-card-btn" onclick="openModelEditModal(\'' + m.id + '\')">✏️</button>' +
        '<button class="model-card-btn" onclick="deleteModel(\'' + m.id + '\')">🗑️</button>' +
        '</div></div>' +
        '<div class="model-card-info"><div>Model: ' + escapeHtml(m.model) + '</div></div>' +
        '</div>'
    ).join('');
}

function openModelEditModal(modelId) {
    const modal = document.getElementById('modelEditModal');
    const title = document.getElementById('modelEditTitle');
    document.getElementById('editingModelId').value = modelId || '';
    if (modelId) {
        const m = AI_CHAT_MODELS.find(x => x.id === modelId);
        if (m) {
            title.textContent = '✏️ 编辑模型';
            ['Name', 'Endpoint', 'ApiKey', 'Model'].forEach(f => {
                document.getElementById('modelEdit' + f).value = m[f.toLowerCase()] || m[f.charAt(0).toLowerCase() + f.slice(1)] || '';
            });
        }
    } else {
        title.textContent = '➕ 添加新模型';
        ['Name', 'Endpoint', 'ApiKey', 'Model'].forEach(f => document.getElementById('modelEdit' + f).value = '');
    }
    modal.style.display = 'flex';
}

function closeModelEditModal() {
    document.getElementById('modelEditModal').style.display = 'none';
}

function saveModel() {
    const modelId = document.getElementById('editingModelId').value;
    const name = document.getElementById('modelEditName').value.trim();
    const endpoint = document.getElementById('modelEditEndpoint').value.trim();
    const apiKey = document.getElementById('modelEditApiKey').value.trim();
    const model = document.getElementById('modelEditModel').value.trim();
    if (!name || !endpoint || !apiKey || !model) { alert('请填写所有必填项'); return; }
    if (modelId) {
        const idx = AI_CHAT_MODELS.findIndex(m => m.id === modelId);
        if (idx !== -1) AI_CHAT_MODELS[idx] = { id: modelId, name, endpoint, apiKey, model };
        if (currentSelectedModelId === modelId) applySelectedModel();
    } else {
        const newId = 'model_' + Date.now();
        AI_CHAT_MODELS.push({ id: newId, name, endpoint, apiKey, model });
        if (AI_CHAT_MODELS.length === 1) { currentSelectedModelId = newId; saveSelectedModelId(); applySelectedModel(); }
    }
    saveChatModels(); renderModelCards(); updateModelSelector(); closeModelEditModal();
}

function deleteModel(modelId) {
    if (confirm('确定要删除该模型？')) {
        AI_CHAT_MODELS = AI_CHAT_MODELS.filter(m => m.id !== modelId);
        saveChatModels(); renderModelCards();
        if (currentSelectedModelId === modelId) { currentSelectedModelId = null; saveSelectedModelId(); updateModelSelector(); }
    }
}

function toggleModelDropdown(event) {
    event.stopPropagation();
    const w = document.getElementById('modelSelectorWrapper');
    if (!w) return;
    if (w.classList.contains('open')) closeModelDropdown();
    else { loadChatModels(); renderModelDropdownItems(); w.classList.add('open'); }
}

function closeModelDropdown() {
    const w = document.getElementById('modelSelectorWrapper');
    if (w) w.classList.remove('open');
}

function renderModelDropdownItems() {
    const d = document.getElementById('modelDropdown');
    if (!d) return;
    if (AI_CHAT_MODELS.length === 0) { d.innerHTML = '<div class="model-dropdown-empty">暂无配置</div>'; return; }
    d.innerHTML = AI_CHAT_MODELS.map(m =>
        '<div class="model-dropdown-item' + (currentSelectedModelId === m.id ? ' active' : '') +
        '" onclick="selectModel(\'' + m.id + '\')">' + escapeHtml(m.name) + '</div>'
    ).join('');
}

function selectModel(modelId) {
    const m = AI_CHAT_MODELS.find(x => x.id === modelId);
    if (!m) return;
    currentSelectedModelId = modelId;
    saveSelectedModelId(); applySelectedModel(); updateModelSelector(); closeModelDropdown();
}

function updateModelSelector() {
    const t = document.getElementById('currentModelName');
    if (!t) return;
    if (currentSelectedModelId) {
        const m = AI_CHAT_MODELS.find(x => x.id === currentSelectedModelId);
        if (m) { t.textContent = m.name; return; }
    }
    t.textContent = AI_CHAT_MODELS.length > 0 ? '选择模型' : '未配置模型';
}

function applySelectedModel() {
    if (!currentSelectedModelId) return;
    const m = AI_CHAT_MODELS.find(x => x.id === currentSelectedModelId);
    if (!m) return;
    AI_CONFIG.apiEndpoint = m.endpoint;
    AI_CONFIG.apiKey = m.apiKey;
    AI_CONFIG.model = m.model;
    localStorage.setItem(AI_SETTINGS_KEYS.endpoint, m.endpoint);
    localStorage.setItem(AI_SETTINGS_KEYS.apiKey, obfuscateKey(m.apiKey));
    localStorage.setItem(AI_SETTINGS_KEYS.model, m.model);
}

function saveSelectedModelId() {
    if (currentSelectedModelId) localStorage.setItem('ai_selected_model_id', currentSelectedModelId);
    else localStorage.removeItem('ai_selected_model_id');
}

function loadSelectedModelId() {
    const s = localStorage.getItem('ai_selected_model_id');
    if (s) {
        const m = AI_CHAT_MODELS.find(x => x.id === s);
        if (m) { currentSelectedModelId = s; applySelectedModel(); }
        else localStorage.removeItem('ai_selected_model_id');
    } else if (AI_CHAT_MODELS.length > 0) {
        currentSelectedModelId = AI_CHAT_MODELS[0].id;
        saveSelectedModelId(); applySelectedModel();
    }
    updateModelSelector();
}

function initModelSelector() {
    loadChatModels();
    loadSelectedModelId();
    document.addEventListener('click', e => {
        const w = document.getElementById('modelSelectorWrapper');
        if (w && !w.contains(e.target)) closeModelDropdown();
    });
}

// =======================================================
// 合同管理 Tab
// =======================================================
function renderContractManagementTab() {
    const container = document.getElementById('contractManagementList');
    if (!container) return;

    const keys = typeof contracts !== 'undefined' ? Object.keys(contracts) : [];

    if (keys.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:40px 20px; color:#999;">
                <div style="font-size:40px; margin-bottom:12px;">📂</div>
                <div style="font-size:14px;">尚未导入任何合同</div>
                <div style="font-size:12px; margin-top:6px; color:#bbb;">请点击右上角 📥 导入合同数据</div>
            </div>`;
        return;
    }

    const headerHtml = `
        <div class="cm-header-row">
            <div class="cm-cell cm-cell-label" style="font-weight:600; color:#555; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">标签名</div>
            <div class="cm-cell cm-cell-name" style="font-weight:600; color:#555; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">完整名称</div>
            <div class="cm-cell cm-cell-count" style="font-weight:600; color:#555; font-size:12px; text-transform:uppercase; letter-spacing:0.05em; text-align:center;">条款数</div>
            <div class="cm-cell cm-cell-action"></div>
        </div>`;

    const rowsHtml = keys.map(key => {
        const cInfo = contracts[key];
        const clauseCount = Object.keys(cInfo.data).length;
        return `
            <div class="cm-row" data-key="${escapeHtml(key)}">
                <div class="cm-cell cm-cell-label">
                    <span class="cm-editable"
                        contenteditable="true"
                        spellcheck="false"
                        data-field="key"
                        data-original="${escapeHtml(key)}"
                        onblur="handleContractInlineEdit(this)"
                        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
                        title="点击编辑标签名">${escapeHtml(key)}</span>
                </div>
                <div class="cm-cell cm-cell-name">
                    <span class="cm-editable"
                        contenteditable="true"
                        spellcheck="false"
                        data-field="title"
                        data-original="${escapeHtml(cInfo.title)}"
                        onblur="handleContractInlineEdit(this)"
                        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
                        title="点击编辑完整名称">${escapeHtml(cInfo.title)}</span>
                </div>
                <div class="cm-cell cm-cell-count">
                    <span class="cm-clause-badge">${clauseCount}</span>
                </div>
                <div class="cm-cell cm-cell-action">
                    <button class="cm-delete-btn" onclick="handleContractDeleteFromModal('${escapeHtml(key)}')" title="删除合同 ${escapeHtml(key)}">
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                </div>
            </div>`;
    }).join('');

    container.innerHTML = `
        <div style="margin-bottom:12px; font-size:13px; color:#888; line-height:1.5;">
            点击标签名或完整名称即可直接编辑，点击其他区域自动保存。
        </div>
        <div class="cm-table">
            ${headerHtml}
            <div class="cm-rows">${rowsHtml}</div>
        </div>`;
}

function handleContractInlineEdit(el) {
    const row = el.closest('.cm-row');
    if (!row) return;
    const originalKey = row.dataset.key;
    const field = el.dataset.field;
    const newValue = el.textContent.trim();
    const originalValue = el.dataset.original;

    if (!newValue) {
        el.textContent = originalValue;
        if (typeof showStatus === 'function') showStatus('名称不能为空', 3000, true);
        return;
    }
    if (newValue === originalValue) return;

    if (field === 'key') {
        if (typeof contracts === 'undefined') return;
        if (contracts[newValue] && newValue !== originalKey) {
            el.textContent = originalValue;
            if (typeof showStatus === 'function') showStatus(`标签名 [${newValue}] 已存在`, 3000, true);
            return;
        }
        const dataRef = contracts[originalKey];
        contracts[newValue] = dataRef;
        delete contracts[originalKey];
        if (typeof searchStatePerContract !== 'undefined') {
            searchStatePerContract[newValue] = searchStatePerContract[originalKey] || '';
            delete searchStatePerContract[originalKey];
        }
        if (typeof ORIGINAL_CONTRACTS !== 'undefined' && ORIGINAL_CONTRACTS[originalKey]) {
            ORIGINAL_CONTRACTS[newValue] = ORIGINAL_CONTRACTS[originalKey];
            delete ORIGINAL_CONTRACTS[originalKey];
        }
        row.dataset.key = newValue;
        el.dataset.original = newValue;
        // Update all editables in this row to use new key reference
        row.querySelectorAll('.cm-editable').forEach(e => {
            if (e.dataset.field === 'key') e.dataset.original = newValue;
        });
        // Update delete button
        const deleteBtn = row.querySelector('.cm-delete-btn');
        if (deleteBtn) {
            deleteBtn.setAttribute('onclick', `handleContractDeleteFromModal('${newValue}')`);
            deleteBtn.title = `删除合同 ${newValue}`;
        }
        if (typeof saveContractsToStorage === 'function') saveContractsToStorage();
        if (typeof renderTabs === 'function') renderTabs();
        if (typeof showSuccess === 'function') showSuccess('标签名已更新');
    } else if (field === 'title') {
        if (typeof contracts === 'undefined' || !contracts[originalKey]) return;
        contracts[originalKey].title = newValue;
        el.dataset.original = newValue;
        if (typeof saveContractsToStorage === 'function') saveContractsToStorage();
        if (typeof showSuccess === 'function') showSuccess('完整名称已更新');
    }
}

function handleContractDeleteFromModal(key) {
    if (confirm(`确认要删除合同 "${key}" 吗？\n\n此操作不可撤销，数据将从本地存储中彻底移除。`)) {
        if (typeof removeContract === 'function') removeContract(key);
        renderContractManagementTab();
    }
}

console.log('[ai-settings.js] AI设置与模型管理加载完成');
