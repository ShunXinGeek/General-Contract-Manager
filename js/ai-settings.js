// =======================================================
// ai-settings.js - AI 设置与模型管理
// 依赖：config.js (AI_CONFIG)，app.js (AI_SETTINGS_KEYS, AI_CHAT_MODELS,
//        currentSelectedModelId, escapeHtml from utils.js)
// 须在 app.js 之后加载
// =======================================================

// 云同步与本地保存共用同一个配置契约。Key 按用户确认的方案继续同步。
const AI_SETTINGS_MODIFIED_KEY = 'ai_settings_modified_at';
const AI_CONFIG_STORAGE_FIELDS = {
    apiEndpoint: 'endpoint', apiKey: 'apiKey', model: 'model',
    embeddingEndpoint: 'embeddingEndpoint', embeddingApiKey: 'embeddingApiKey', embeddingModel: 'embeddingModel',
    rerankEndpoint: 'rerankEndpoint', rerankApiKey: 'rerankApiKey', rerankModel: 'rerankModel',
    systemPrompt: 'systemPrompt'
};

function getAISettingsForCloud() {
    const snapshot = {
        version: 3,
        modifiedAt: Number(localStorage.getItem(AI_SETTINGS_MODIFIED_KEY)) || 0,
        models: AI_CHAT_MODELS.map(({ _isDecrypted, ...model }) => ({ ...model })),
        selectedModelId: currentSelectedModelId,
        rerankEnabled: AI_CONFIG.rerankEnabled === true
    };
    Object.keys(AI_CONFIG_STORAGE_FIELDS).forEach(key => { snapshot[key] = AI_CONFIG[key] || ''; });
    return snapshot;
}

function persistAISettings() {
    Object.entries(AI_CONFIG_STORAGE_FIELDS).forEach(([field, storageKey]) => {
        const value = AI_CONFIG[field] || '';
        localStorage.setItem(AI_SETTINGS_KEYS[storageKey], field.toLowerCase().includes('apikey') ? obfuscateKey(value) : value);
    });
    localStorage.setItem(AI_SETTINGS_KEYS.rerankEnabled, String(AI_CONFIG.rerankEnabled === true));
    saveChatModels();
    saveSelectedModelId();
}

function touchAISettings() {
    localStorage.setItem(AI_SETTINGS_MODIFIED_KEY, String(Date.now()));
    persistAISettings();
}

function hasUsableAISettings(settings) {
    return !!settings && (
        settings.models?.some(m => m.endpoint && m.apiKey && m.model) ||
        (settings.apiEndpoint && settings.apiKey && settings.model) ||
        (settings.embeddingEndpoint && settings.embeddingApiKey) ||
        (settings.rerankEndpoint && settings.rerankApiKey)
    );
}

function mergeAISettings(localSettings, cloudSettings) {
    if (!cloudSettings) return localSettings;
    if (!localSettings) return cloudSettings;
    const localTime = Number(localSettings.modifiedAt) || 0;
    const cloudTime = Number(cloudSettings.modifiedAt) || 0;
    // 新设备只有默认值，不能作为实质性配置写回云端。
    if (!hasUsableAISettings(localSettings) && !localTime) return cloudSettings;
    if (!hasUsableAISettings(cloudSettings) && !cloudTime) return localSettings;
    // 完整快照按版本时间合并，包括用户明确删除模型的情况；相同时间保留本地。
    return cloudTime > localTime ? cloudSettings : localSettings;
}

function applyCloudAISettings(settings) {
    if (!settings) return;
    Object.keys(AI_CONFIG_STORAGE_FIELDS).forEach(key => {
        if (typeof settings[key] === 'string') AI_CONFIG[key] = settings[key];
    });
    if (typeof settings.rerankEnabled === 'boolean') AI_CONFIG.rerankEnabled = settings.rerankEnabled;
    if (Array.isArray(settings.models)) {
        AI_CHAT_MODELS = settings.models.map(({ _isDecrypted, ...model }) => normalizeChatModel(model));
    } else if (settings.apiEndpoint && settings.apiKey && settings.model) {
        // 旧云快照只有一个活动模型，把它转换为可在下拉框中选择的模型。
        AI_CHAT_MODELS = [normalizeChatModel({ id: 'legacy_cloud_model', name: settings.model,
            endpoint: settings.apiEndpoint, apiKey: settings.apiKey, model: settings.model })];
    }
    currentSelectedModelId = AI_CHAT_MODELS.some(m => m.id === settings.selectedModelId)
        ? settings.selectedModelId : (AI_CHAT_MODELS[0]?.id || null);
    if (currentSelectedModelId) applySelectedModel();
    localStorage.setItem(AI_SETTINGS_MODIFIED_KEY, String(Number(settings.modifiedAt) || 0));
    persistAISettings();
    updateModelSelector();
    renderModelCards();
}

// =======================================================
// 设置弹窗
// =======================================================
// =======================================================
// 设置弹窗
// =======================================================

function switchSettingsTab(tabName) {
    const tabAI = document.getElementById('tabAISettings');
    const tabRetrieval = document.getElementById('tabRetrievalSettings');
    const tabContract = document.getElementById('tabContractSettings');
    const contentAI = document.getElementById('aiSettingsContent');
    const contentRetrieval = document.getElementById('retrievalSettingsContent');
    const contentContract = document.getElementById('contractSettingsContent');

    // Reset all tabs
    [tabAI, tabRetrieval, tabContract].forEach(t => {
        if (!t) return;
        t.classList.remove('active');
        t.style.borderBottom = '3px solid transparent';
        t.style.color = '#666';
        t.style.fontWeight = 'normal';
    });
    [contentAI, contentRetrieval, contentContract].forEach(c => { if (c) c.style.display = 'none'; });

    if (tabName === 'AI') {
        tabAI.classList.add('active');
        tabAI.style.borderBottom = '3px solid #3498db';
        tabAI.style.color = '#3498db';
        tabAI.style.fontWeight = 'bold';
        contentAI.style.display = 'block';
    } else if (tabName === 'Retrieval') {
        tabRetrieval.classList.add('active');
        tabRetrieval.style.borderBottom = '3px solid #3498db';
        tabRetrieval.style.color = '#3498db';
        tabRetrieval.style.fontWeight = 'bold';
        contentRetrieval.style.display = 'block';
        renderRetrievalSettingsTab();
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

    if (window.RetrievalSettings) window.RetrievalSettings.beginDraft(contracts);
    bindRetrievalSettingsEvents();

    // Default to AI tab
    switchSettingsTab('AI');

    ['sectionEmbedding', 'sectionRerank', 'sectionPrompt'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('collapsed')) el.classList.add('collapsed');
    });
    document.getElementById('settingsStatus').style.display = 'none';
}

function closeSettings(force = false) {
    if (!force && window.RetrievalSettings?.isDraftDirty() && !confirm('检索设置尚未保存，确定关闭吗？')) return;
    window.RetrievalSettings?.discardDraft();
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
    const previousAISettings = JSON.stringify(getAISettingsForCloud());
    const retrievalResult = window.RetrievalSettings?.saveDraft(contracts);
    if (retrievalResult && !retrievalResult.valid) {
        switchSettingsTab('Retrieval');
        showSettingsStatus('请修正检索设置：' + retrievalResult.errors.join('；'), 'error');
        return;
    }
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

    // 非 AI 设置的保存不能把新设备默认 AI 配置标记为较新快照。
    if (JSON.stringify(getAISettingsForCloud()) !== previousAISettings) touchAISettings();
    if (typeof saveContractsToStorage === 'function') await saveContractsToStorage();
    if (typeof checkRAGIndexStatus === 'function' && typeof isKnowledgeBaseMode !== 'undefined' && isKnowledgeBaseMode) {
        knowledgeBaseReady = checkRAGIndexStatus();
    }
    showSettingsStatus('✅ 设置已保存', 'success');
    setTimeout(() => closeSettings(true), 900);
}

function loadAISettings() {
    Object.entries(AI_CONFIG_STORAGE_FIELDS).forEach(([k, sk]) => {
        let v = localStorage.getItem(AI_SETTINGS_KEYS[sk]);
        if (v !== null) {
            if (k.toLowerCase().includes('apikey')) v = deobfuscateKey(v);
            AI_CONFIG[k] = v;
        }
    });
    AI_CONFIG.rerankEnabled = localStorage.getItem(AI_SETTINGS_KEYS.rerankEnabled) === 'true';
    const sp = localStorage.getItem(AI_SETTINGS_KEYS.systemPrompt);
    if (sp) AI_CONFIG.systemPrompt = sp;
}

function showSettingsStatus(message, type) {
    window.StatusCenter?.post(type || 'info', message, { source: '设置' });
    const s = document.getElementById('settingsStatus');
    s.style.display = 'block';
    s.innerText = message;
    s.style.background = type === 'success' ? '#d4edda' : type === 'error' ? '#f8d7da' : '#fff3cd';
    s.style.color = type === 'success' ? '#155724' : type === 'error' ? '#721c24' : '#856404';
}

// =======================================================
// 通用检索设置
// =======================================================
const RETRIEVAL_ROLE_LABELS = {
    unspecified: '未指定',
    base: '基准/主文件',
    amendment: '修订/特别条件',
    supplement: '补充资料',
    reference: '参考资料',
    independent: '独立文件'
};

function retrievalOption(value, text, selected) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = selected;
    return option;
}

function retrievalEntries() {
    return window.RetrievalSettings?.sourceEntries(contracts) || [];
}

function updateRetrievalSummary() {
    const container = document.getElementById('retrievalSummary');
    if (!container || !window.RetrievalSettings) return;
    const draft = window.RetrievalSettings.getDraft(contracts);
    const summary = window.RetrievalSettings.summary(contracts, draft);
    container.textContent = `${summary.enabled}/${summary.total} 个来源已启用 · ${summary.unconfigured} 个层级未设置 · ${summary.relations} 条关系`;
}

function renderRetrievalSources() {
    const container = document.getElementById('retrievalSourceList');
    if (!container || !window.RetrievalSettings) return;
    const draft = window.RetrievalSettings.getDraft(contracts);
    const entries = retrievalEntries();
    container.replaceChildren();

    if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'retrieval-empty-state';
        empty.textContent = '尚未导入任何来源。导入新的标签页后，它会自动出现在这里。';
        container.appendChild(empty);
        return;
    }

    entries.forEach(entry => {
        const source = draft.sources[entry.sourceId];
        const card = document.createElement('div');
        card.className = 'retrieval-source-card' + (source.enabled ? '' : ' is-disabled');
        card.dataset.sourceId = entry.sourceId;

        const main = document.createElement('label');
        main.className = 'retrieval-source-main';
        const enabled = document.createElement('input');
        enabled.type = 'checkbox';
        enabled.className = 'retrieval-source-toggle';
        enabled.checked = source.enabled;
        enabled.setAttribute('aria-label', `将 ${entry.label} 加入检索范围`);
        const text = document.createElement('span');
        const name = document.createElement('span');
        name.className = 'retrieval-source-name';
        name.textContent = entry.label;
        name.title = entry.label;
        const meta = document.createElement('span');
        meta.className = 'retrieval-source-meta';
        meta.textContent = `${entry.title} · ${entry.clauseCount} 条`;
        text.append(name, meta);
        main.append(enabled, text);

        const controls = document.createElement('div');
        controls.className = 'retrieval-source-controls';
        const roleLabel = document.createElement('label');
        roleLabel.className = 'retrieval-field';
        roleLabel.append(document.createTextNode('角色'));
        const role = document.createElement('select');
        role.setAttribute('aria-label', `${entry.label} 的来源角色`);
        Object.entries(RETRIEVAL_ROLE_LABELS).forEach(([value, label]) => role.appendChild(retrievalOption(value, label, source.role === value)));
        roleLabel.appendChild(role);

        const levelLabel = document.createElement('label');
        levelLabel.className = 'retrieval-field';
        levelLabel.append(document.createTextNode('等级'));
        const level = document.createElement('select');
        level.setAttribute('aria-label', `${entry.label} 的适用等级`);
        level.appendChild(retrievalOption('', '未设置', source.authorityLevel === null));
        for (let number = 1; number <= 9; number++) level.appendChild(retrievalOption(String(number), number === 1 ? '第 1 级（最高）' : `第 ${number} 级`, source.authorityLevel === number));
        levelLabel.appendChild(level);
        controls.append(roleLabel, levelLabel);

        enabled.addEventListener('change', () => {
            source.enabled = enabled.checked;
            source.needsReview = false;
            card.classList.toggle('is-disabled', !source.enabled);
            window.RetrievalSettings.setDraft(draft, contracts);
            updateRetrievalSummary();
        });
        role.addEventListener('change', () => {
            source.role = role.value;
            source.needsReview = false;
            window.RetrievalSettings.setDraft(draft, contracts);
        });
        level.addEventListener('change', () => {
            source.authorityLevel = level.value ? Number(level.value) : null;
            source.needsReview = false;
            window.RetrievalSettings.setDraft(draft, contracts);
            updateRetrievalSummary();
        });

        card.append(main, controls);
        container.appendChild(card);
    });
}

function fillRetrievalRelationSelect(select, entries) {
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    entries.forEach(entry => select.appendChild(retrievalOption(entry.sourceId, entry.label, entry.sourceId === previous)));
}

function renderRetrievalRelations() {
    if (!window.RetrievalSettings) return;
    const draft = window.RetrievalSettings.getDraft(contracts);
    const entries = retrievalEntries();
    const byId = new Map(entries.map(entry => [entry.sourceId, entry]));
    fillRetrievalRelationSelect(document.getElementById('retrievalRelationFrom'), entries);
    fillRetrievalRelationSelect(document.getElementById('retrievalRelationTo'), entries);

    const list = document.getElementById('retrievalRelationList');
    if (!list) return;
    list.replaceChildren();
    if (!draft.relations.length) {
        const empty = document.createElement('div');
        empty.className = 'retrieval-empty-state';
        empty.textContent = '尚未配置来源关系。层级未设置时，系统不会自行推定高低。';
        list.appendChild(empty);
        return;
    }

    const labels = { higher: '高于', same: '同级', none: '无推定关系' };
    draft.relations.forEach((relation, index) => {
        const row = document.createElement('div');
        row.className = 'retrieval-relation-row';
        const text = document.createElement('span');
        text.textContent = `${byId.get(relation.fromSourceId)?.label || '已删除来源'} ${labels[relation.type]} ${byId.get(relation.toSourceId)?.label || '已删除来源'}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'retrieval-remove-relation';
        remove.textContent = '删除';
        remove.setAttribute('aria-label', `删除关系：${text.textContent}`);
        remove.addEventListener('click', () => {
            draft.relations.splice(index, 1);
            window.RetrievalSettings.setDraft(draft, contracts);
            renderRetrievalRelations();
            updateRetrievalSummary();
        });
        row.append(text, remove);
        list.appendChild(row);
    });
}

function addRetrievalRelation() {
    const from = document.getElementById('retrievalRelationFrom')?.value;
    const to = document.getElementById('retrievalRelationTo')?.value;
    const type = document.getElementById('retrievalRelationType')?.value;
    const error = document.getElementById('retrievalRelationError');
    if (error) error.textContent = '';
    if (!from || !to || from === to) {
        if (error) error.textContent = '请选择两个不同的来源。';
        return;
    }
    const draft = window.RetrievalSettings.getDraft(contracts);
    const previous = window.RetrievalSettings.clone(draft.relations);
    const pair = new Set([from, to]);
    draft.relations = draft.relations.filter(relation => !(pair.has(relation.fromSourceId) && pair.has(relation.toSourceId)));
    draft.relations.push({ fromSourceId: from, toSourceId: to, type });
    window.RetrievalSettings.setDraft(draft, contracts);
    const validation = window.RetrievalSettings.validate(draft, contracts);
    if (!validation.valid) {
        draft.relations = previous;
        window.RetrievalSettings.setDraft(draft, contracts);
        if (error) error.textContent = validation.errors.join('；');
        return;
    }
    renderRetrievalRelations();
    updateRetrievalSummary();
}

async function runRetrievalPreview() {
    const input = document.getElementById('retrievalPreviewQuery');
    const output = document.getElementById('retrievalPreviewResult');
    const button = document.getElementById('retrievalPreviewButton');
    const query = input?.value.trim();
    if (!output || !button) return;
    output.classList.add('is-visible');
    if (!query) {
        output.textContent = '请输入一个测试问题。';
        input?.focus();
        return;
    }
    button.disabled = true;
    output.textContent = '正在检索当前范围…';
    try {
        const evidence = await AIRetrieval.retrieve(query, contracts, AI_CONFIG, {
            retrievalSettings: window.RetrievalSettings.getDraft(contracts)
        });
        output.replaceChildren();
        const summary = document.createElement('div');
        summary.textContent = `检索范围：${evidence.diagnostic.scope.labels.join('、') || '无'}；命中 ${evidence.clauses.length} 条；用时 ${evidence.diagnostic.elapsedMs} ms。`;
        output.appendChild(summary);
        evidence.clauses.forEach(clause => {
            const hit = document.createElement('div');
            hit.className = 'retrieval-preview-hit';
            hit.textContent = `${clause.type} Clause ${AIRetrieval.number(clause.id, clause.type)} · ${clause.title || '无标题'} · ${clause.paths?.join(' / ') || '关系扩展'}`;
            output.appendChild(hit);
        });
        const notices = [...evidence.diagnostic.warnings, ...evidence.diagnostic.missing];
        if (notices.length) {
            const note = document.createElement('div');
            note.className = 'retrieval-preview-hit';
            note.textContent = '提示：' + notices.join('；');
            output.appendChild(note);
        }
    } catch (error) {
        output.textContent = '预览失败：' + error.message;
    } finally {
        button.disabled = false;
    }
}

function bindRetrievalSettingsEvents() {
    const content = document.getElementById('retrievalSettingsContent');
    if (!content || content.dataset.bound === 'true') return;
    content.dataset.bound = 'true';
    const bindSelect = (id, field) => document.getElementById(id)?.addEventListener('change', event => {
        const draft = window.RetrievalSettings.getDraft(contracts);
        draft[field] = event.target.value;
        window.RetrievalSettings.setDraft(draft, contracts);
        if (field === 'newSourcePolicy') renderRetrievalSources();
    });
    bindSelect('retrievalNewSourcePolicy', 'newSourcePolicy');
    bindSelect('retrievalConflictPolicy', 'conflictPolicy');
    bindSelect('retrievalProfile', 'profile');
    document.getElementById('retrievalAddRelation')?.addEventListener('click', addRetrievalRelation);
    document.getElementById('retrievalPreviewButton')?.addEventListener('click', runRetrievalPreview);
    document.getElementById('retrievalPreviewQuery')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); runRetrievalPreview(); }
    });
    document.getElementById('retrievalResetButton')?.addEventListener('click', () => {
        if (!confirm('恢复推荐检索设置？所有来源将启用，层级和来源关系将被清除。')) return;
        window.RetrievalSettings.resetDraft(contracts);
        renderRetrievalSettingsTab();
    });
}

function renderRetrievalSettingsTab() {
    if (!window.RetrievalSettings) return;
    bindRetrievalSettingsEvents();
    const draft = window.RetrievalSettings.getDraft(contracts);
    const newSourcePolicy = document.getElementById('retrievalNewSourcePolicy');
    const conflictPolicy = document.getElementById('retrievalConflictPolicy');
    const profile = document.getElementById('retrievalProfile');
    if (newSourcePolicy) newSourcePolicy.value = draft.newSourcePolicy;
    if (conflictPolicy) conflictPolicy.value = draft.conflictPolicy;
    if (profile) profile.value = draft.profile;
    renderRetrievalSources();
    renderRetrievalRelations();
    updateRetrievalSummary();
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
            AI_CHAT_MODELS = JSON.parse(s).map(normalizeChatModel);
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

function normalizeChatModel(model) {
    const source = model && typeof model === 'object' ? model : {};
    const profile = AIProviders.normalizeProfile(source);
    return { ...source, providerId: profile.providerId, protocol: profile.protocol, authType: profile.authType,
        endpoint: profile.baseUrl, baseUrl: profile.baseUrl, connectTimeoutMs: profile.connectTimeoutMs,
        idleTimeoutMs: profile.idleTimeoutMs };
}

function saveChatModels() {
    // 保存前混淆 API Key（不是加密）
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
        '<div class="model-card-info"><div>' + escapeHtml(AIProviders.preset(m.providerId).label) + ' · ' + escapeHtml(m.model) + '</div></div>' +
        '</div>'
    ).join('');
}

function openModelEditModal(modelId) {
    const modal = document.getElementById('modelEditModal');
    document.getElementById('modelConnectionStatus').textContent = '';
    const title = document.getElementById('modelEditTitle');
    document.getElementById('editingModelId').value = modelId || '';
    if (modelId) {
        const m = AI_CHAT_MODELS.find(x => x.id === modelId);
        if (m) {
            title.textContent = '✏️ 编辑模型';
            ['Name', 'Endpoint', 'ApiKey', 'Model'].forEach(f => {
                document.getElementById('modelEdit' + f).value = m[f.toLowerCase()] || m[f.charAt(0).toLowerCase() + f.slice(1)] || '';
            });
            document.getElementById('modelEditProvider').value = m.providerId || 'custom';
            document.getElementById('modelEditProtocol').value = m.protocol || 'openai-chat';
            document.getElementById('modelEditConnectTimeout').value = m.connectTimeoutMs || 35000;
            document.getElementById('modelEditIdleTimeout').value = m.idleTimeoutMs || 120000;
        }
    } else {
        title.textContent = '➕ 添加新模型';
        ['Name', 'Endpoint', 'ApiKey', 'Model'].forEach(f => document.getElementById('modelEdit' + f).value = '');
        document.getElementById('modelEditProvider').value = 'deepseek';
        applyModelProviderPreset();
    }
    modal.style.display = 'flex';
}

function closeModelEditModal() {
    document.getElementById('modelEditModal').style.display = 'none';
}

function applyModelProviderPreset() {
    const providerId = document.getElementById('modelEditProvider').value;
    const preset = AIProviders.preset(providerId);
    if (providerId !== 'custom') {
        document.getElementById('modelEditEndpoint').value = preset.baseUrl;
        document.getElementById('modelEditProtocol').value = preset.protocol;
    }
}

function readModelEditor() {
    const name = document.getElementById('modelEditName').value.trim();
    const apiKey = document.getElementById('modelEditApiKey').value.trim();
    const model = document.getElementById('modelEditModel').value.trim();
    if (!name || !apiKey || !model) throw new Error('请填写模型名称、密钥和 Model。');
    const profile = AIProviders.normalizeProfile({ providerId: document.getElementById('modelEditProvider').value,
        protocol: document.getElementById('modelEditProtocol').value, endpoint: document.getElementById('modelEditEndpoint').value.trim(),
        connectTimeoutMs: document.getElementById('modelEditConnectTimeout').value, idleTimeoutMs: document.getElementById('modelEditIdleTimeout').value });
    if (!profile.baseUrl) throw new Error('请填写 Base URL。');
    return { name, apiKey, model, ...profile, endpoint: profile.baseUrl };
}

function saveModel() {
    const modelId = document.getElementById('editingModelId').value;
    let config;
    try { config = readModelEditor(); } catch (error) { notifyStatus(error.message); return; }
    if (modelId) {
        const idx = AI_CHAT_MODELS.findIndex(m => m.id === modelId);
        if (idx !== -1) AI_CHAT_MODELS[idx] = { id: modelId, ...config };
        if (currentSelectedModelId === modelId) applySelectedModel();
    } else {
        const newId = 'model_' + Date.now();
        AI_CHAT_MODELS.push({ id: newId, ...config });
        if (AI_CHAT_MODELS.length === 1) { currentSelectedModelId = newId; saveSelectedModelId(); applySelectedModel(); }
    }
    saveChatModels(); renderModelCards(); updateModelSelector(); closeModelEditModal();
    touchAISettings();
}

async function testModelConnection() {
    const button = document.getElementById('modelConnectionTest');
    const status = document.getElementById('modelConnectionStatus');
    let config;
    try { config = { ...readModelEditor(), apiEndpoint: document.getElementById('modelEditEndpoint').value.trim() }; }
    catch (error) { status.textContent = '❌ ' + error.message; showError(error.message); return; }
    button.disabled = true;
    const task = window.StatusCenter?.start('正在测试模型连接…', '模型测试');
    status.textContent = '正在发送简短测试问题（会消耗少量模型用量）…';
    const controller = new AbortController();
    try {
        const response = await AIClient.request(config, [{ role: 'user', content: '请只回复 OK。' }],
            { thinking: false, signal: controller.signal });
        let received = false;
        for await (const event of AIClient.events(response)) {
            const delta = event.choices?.[0]?.delta;
            if (delta?.content || delta?.reasoning_content) { received = true; break; }
        }
        if (!received) throw new Error('连接已建立，但模型没有返回内容。');
        status.textContent = '✅ 连接成功，已收到模型输出。';
        task?.finish('连接成功，已收到模型输出。');
    } catch (error) { status.textContent = '❌ ' + error.message; task?.finish('模型连接失败：' + error.message, 'error'); }
    finally { controller.abort(); button.disabled = false; }
}

function deleteModel(modelId) {
    if (confirm('确定要删除该模型？')) {
        AI_CHAT_MODELS = AI_CHAT_MODELS.filter(m => m.id !== modelId);
        saveChatModels(); renderModelCards();
        if (currentSelectedModelId === modelId) {
            currentSelectedModelId = AI_CHAT_MODELS[0]?.id || null;
            if (currentSelectedModelId) applySelectedModel();
            else { AI_CONFIG.apiEndpoint = ''; AI_CONFIG.apiKey = ''; AI_CONFIG.model = ''; }
        }
        touchAISettings();
        updateModelSelector();
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
    touchAISettings();
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
    AI_CONFIG.providerId = m.providerId;
    AI_CONFIG.protocol = m.protocol;
    AI_CONFIG.connectTimeoutMs = m.connectTimeoutMs;
    AI_CONFIG.idleTimeoutMs = m.idleTimeoutMs;
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
    currentSelectedModelId = AI_CHAT_MODELS.some(m => m.id === s) ? s : (AI_CHAT_MODELS[0]?.id || null);
    saveSelectedModelId();
    if (currentSelectedModelId) applySelectedModel();
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
                    <button class="cm-delete-btn" onclick="handleContractDeleteFromModal(decodeURIComponent('${encodeInlineArgument(key)}'))" title="删除合同 ${escapeHtml(key)}">
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
        if (window.RetrievalSettings) {
            window.RetrievalSettings.persist(window.RetrievalSettings.get(contracts), contracts, false);
        }
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
            deleteBtn.setAttribute('onclick', `handleContractDeleteFromModal(decodeURIComponent('${encodeInlineArgument(newValue)}'))`);
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
