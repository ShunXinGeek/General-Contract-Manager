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
    const tabGeneral = document.getElementById('tabGeneralSettings');
    const contentAI = document.getElementById('aiSettingsContent');
    const contentRetrieval = document.getElementById('retrievalSettingsContent');
    const contentContract = document.getElementById('contractSettingsContent');
    const contentGeneral = document.getElementById('generalSettingsContent');

    // Reset all tabs
    [tabAI, tabRetrieval, tabContract, tabGeneral].forEach(t => {
        if (!t) return;
        t.classList.remove('active');
        t.style.borderBottom = '3px solid transparent';
        t.style.color = '#666';
        t.style.fontWeight = 'normal';
    });
    [contentAI, contentRetrieval, contentContract, contentGeneral].forEach(c => { if (c) c.style.display = 'none'; });

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
    } else if (tabName === 'General') {
        tabGeneral.classList.add('active');
        tabGeneral.style.borderBottom = '3px solid #3498db';
        tabGeneral.style.color = '#3498db';
        tabGeneral.style.fontWeight = 'bold';
        contentGeneral.style.display = 'block';
    }
}

function openSettings() {
    const modal = document.getElementById('settingsModal');
    modal.style.display = 'flex';
    document.body.classList.add('settings-open');
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
    window.GeneralSettings?.loadForm();

    // Default to AI tab
    switchSettingsTab('AI');

    ['sectionEmbedding', 'sectionRerank', 'sectionPrompt'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('collapsed')) el.classList.add('collapsed');
    });
    document.getElementById('settingsStatus').style.display = 'none';
}

function closeSettings(force = false) {
    if (!force && window.RetrievalSettings?.isDraftDirty(contracts) && !confirm('检索设置尚未保存，确定关闭吗？')) return;
    window.RetrievalSettings?.discardDraft();
    document.getElementById('settingsModal').style.display = 'none';
    document.body.classList.remove('settings-open');
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
    window.GeneralSettings?.saveForm();
    if (typeof saveContractsToStorage === 'function') await saveContractsToStorage();
    if (typeof checkRAGIndexStatus === 'function' && typeof isKnowledgeBaseMode !== 'undefined' && isKnowledgeBaseMode) {
        checkRAGIndexStatus();
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
    const entries = new Map(window.RetrievalSettings.sourceEntries(contracts).map(entry => [entry.key, entry]));
    return getOrderedContractKeys({ visibleOnly: true }).map(key => entries.get(key)).filter(Boolean);
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
        empty.textContent = Object.keys(contracts).length
            ? '当前没有可见合同。可在「合同管理」中恢复显示。'
            : '尚未导入任何来源。导入新的标签页后，它会自动出现在这里。';
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

        const updateSource = changes => {
            const activeDraft = window.RetrievalSettings.getDraft(contracts);
            const activeSource = activeDraft.sources[entry.sourceId];
            if (!activeSource) return;
            Object.assign(activeSource, changes);
            window.RetrievalSettings.setDraft(activeDraft, contracts);
            updateRetrievalSummary();
        };
        enabled.addEventListener('change', () => {
            card.classList.toggle('is-disabled', !enabled.checked);
            updateSource({ enabled: enabled.checked });
        });
        role.addEventListener('change', () => {
            updateSource({ role: role.value });
        });
        level.addEventListener('change', () => {
            updateSource({ authorityLevel: level.value ? Number(level.value) : null });
        });

        card.append(main, controls);
        container.appendChild(card);
    });
}

const ALL_OTHER_RETRIEVAL_SOURCES = '__all_other_files__';

function fillRetrievalRelationSelect(select, entries) {
    if (!select) return;
    const previous = select.value;
    select.replaceChildren();
    entries.forEach(entry => select.appendChild(retrievalOption(entry.sourceId, entry.label, entry.sourceId === previous)));
    select.appendChild(retrievalOption(ALL_OTHER_RETRIEVAL_SOURCES, '所有其他文件', previous === ALL_OTHER_RETRIEVAL_SOURCES));
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
    const relations = draft.relations.filter(({ fromSourceId, toSourceId }) => byId.has(fromSourceId) && byId.has(toSourceId));
    if (!relations.length) {
        const empty = document.createElement('div');
        empty.className = 'retrieval-empty-state';
        empty.textContent = '尚未配置来源关系。层级未设置时，系统不会自行推定高低。';
        list.appendChild(empty);
        return;
    }

    const labels = { higher: '高于', same: '同级', none: '无推定关系' };
    relations.forEach(relation => {
        const row = document.createElement('div');
        row.className = 'retrieval-relation-row';
        const text = document.createElement('span');
        text.textContent = `${byId.get(relation.fromSourceId).label} ${labels[relation.type]} ${byId.get(relation.toSourceId).label}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'retrieval-remove-relation';
        remove.textContent = '删除';
        remove.setAttribute('aria-label', `删除关系：${text.textContent}`);
        remove.addEventListener('click', () => {
            const activeDraft = window.RetrievalSettings.getDraft(contracts);
            activeDraft.relations = activeDraft.relations.filter(item =>
                item.fromSourceId !== relation.fromSourceId || item.toSourceId !== relation.toSourceId);
            window.RetrievalSettings.setDraft(activeDraft, contracts);
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
    const allFrom = from === ALL_OTHER_RETRIEVAL_SOURCES;
    const allTo = to === ALL_OTHER_RETRIEVAL_SOURCES;
    if (allFrom && allTo) {
        if (error) error.textContent = '“所有其他文件”只能选在一侧，另一侧请选择一份合同文件。';
        return;
    }
    if (!from || !to || from === to) {
        if (error) error.textContent = '请选择两个不同的来源。';
        return;
    }
    const bulk = allFrom || allTo;
    if (bulk && type !== 'higher' && type !== 'lower') {
        if (error) error.textContent = '“所有其他文件”仅支持批量设置“高于”或“低于”。';
        return;
    }
    const selected = allFrom ? to : from;
    const available = retrievalEntries().map(entry => entry.sourceId);
    if (!available.includes(selected) || !bulk && !available.includes(to)) return;
    const others = new Set(bulk
        ? available.filter(id => id !== selected)
        : [to]);
    if (!others.size) {
        if (error) error.textContent = '没有其他合同文件可设置关系。';
        return;
    }
    const draft = window.RetrievalSettings.getDraft(contracts);
    const relations = draft.relations.filter(({ fromSourceId, toSourceId }) =>
        !(fromSourceId === selected && others.has(toSourceId) || toSourceId === selected && others.has(fromSourceId)));
    for (const other of others) {
        relations.push({ fromSourceId: allFrom ? other : from, toSourceId: allFrom ? to : other, type });
    }
    const validation = window.RetrievalSettings.validate({ ...draft, relations }, contracts);
    if (!validation.valid) {
        if (error) error.textContent = validation.errors.join('；');
        return;
    }
    window.RetrievalSettings.setDraft(validation.settings, contracts);
    renderRetrievalRelations();
    updateRetrievalSummary();
}

let retrievalPreviewController = null;

function clearRetrievalPreview() {
    retrievalPreviewController?.abort();
    const output = document.getElementById('retrievalPreviewResult');
    output?.replaceChildren();
    output?.classList.remove('is-visible');
}

async function runRetrievalPreview() {
    const input = document.getElementById('retrievalPreviewQuery');
    const output = document.getElementById('retrievalPreviewResult');
    const button = document.getElementById('retrievalPreviewButton');
    const query = input?.value.trim();
    if (!output || !button || button.disabled) return;
    output.classList.add('is-visible');
    if (!query) {
        output.textContent = '请输入一个测试问题。';
        input?.focus();
        return;
    }
    button.disabled = true;
    const controller = new AbortController();
    retrievalPreviewController = controller;
    output.textContent = '正在检索当前范围…';
    try {
        const evidence = await AIRetrieval.retrieve(query, contracts, AI_CONFIG, {
            retrievalSettings: window.RetrievalSettings.getDraft(contracts), signal: controller.signal
        });
        if (controller.signal.aborted) return;
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
        if (!controller.signal.aborted) output.textContent = '预览失败：' + error.message;
    } finally {
        retrievalPreviewController = null;
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
    });
    bindSelect('retrievalConflictPolicy', 'conflictPolicy');
    bindSelect('retrievalProfile', 'profile');
    document.getElementById('retrievalAddRelation')?.addEventListener('click', addRetrievalRelation);
    document.getElementById('retrievalPreviewButton')?.addEventListener('click', runRetrievalPreview);
    document.getElementById('retrievalPreviewQuery')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); runRetrievalPreview(); }
    });
    document.getElementById('retrievalResetButton')?.addEventListener('click', () => {
        if (!confirm('恢复推荐检索设置？当前来源的勾选状态将保留，角色、等级和来源关系将重置。')) return;
        window.RetrievalSettings.resetDraft(contracts);
        renderRetrievalSettingsTab();
    });
}

function renderRetrievalSettingsTab() {
    if (!window.RetrievalSettings) return;
    bindRetrievalSettingsEvents();
    const draft = window.RetrievalSettings.getDraft(contracts);
    const conflictPolicy = document.getElementById('retrievalConflictPolicy');
    const profile = document.getElementById('retrievalProfile');
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
    if (typeof refreshAssistantThinking === 'function') refreshAssistantThinking();
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
let contractVectorizing = false;
let contractVectorStatusRequest = 0;

function isContractManagementVisible() {
    return document.getElementById('settingsModal')?.style.display === 'flex'
        && document.getElementById('contractSettingsContent')?.style.display === 'block';
}

function refreshContractSettings() {
    clearRetrievalPreview();
    if (isContractManagementVisible()) renderContractManagementTab();
    if (document.getElementById('settingsModal')?.style.display === 'flex'
        && document.getElementById('retrievalSettingsContent')?.style.display === 'block') renderRetrievalSettingsTab();
}

async function refreshContractVectorStatus() {
    if (!isContractManagementVisible()) return;
    const request = ++contractVectorStatusRequest;
    const indicators = document.querySelectorAll('#contractManagementList .cm-vector-status');
    if (!indicators.length) return;
    let status;
    try {
        status = await RAG.getIndexStatus({ ...AI_CONFIG }, contracts, { allContracts: true });
    } catch (error) {
        console.warn('[合同管理] 读取向量状态失败', error);
    }
    if (request !== contractVectorStatusRequest || !isContractManagementVisible()) return;
    for (const indicator of indicators) {
        const key = indicator.closest('.cm-row').dataset.key;
        const coverage = status?.coverage.get(contracts[key]?.sourceId);
        const ready = coverage?.total > 0 && coverage.covered === coverage.total;
        const label = !status ? '无法读取向量索引状态'
            : ready ? '已完成向量化'
            : coverage?.total ? `尚未完成向量化（${coverage.covered}/${coverage.total} 条）`
            : '没有可向量化的合同正文';
        indicator.dataset.state = ready ? 'ready' : 'pending';
        indicator.title = label;
        indicator.setAttribute('aria-label', label);
    }
}

function updateContractVectorButton() {
    window.ContractBackup?.refreshControls();
    const button = document.getElementById('btnVectorizeContracts');
    if (!button) return;
    button.disabled = contractVectorizing || !!window.ContractBackup?.busy;
    button.setAttribute('aria-busy', String(contractVectorizing));
}

async function vectorizeContracts() {
    if (contractVectorizing || window.ContractBackup?.busy) return;
    contractVectorizing = true;
    updateContractVectorButton();
    const config = { ...AI_CONFIG };
    let task;
    try {
        const visibleContracts = window.RetrievalSettings.getVisibleContracts(contracts);
        const status = await RAG.getIndexStatus(config, visibleContracts, { allContracts: true });
        if (!status.corpus) {
            showStatus('warning', '没有可向量化的合同正文。', '📂', 6500);
            return;
        }
        if (!status.uncovered) {
            showStatus('success', '所有可向量化的合同正文均已有有效向量。', '📚', 6500);
            return;
        }
        if (!RAG.getEmbeddingConfig(config)) {
            await CustomDialog.alert('请先在 AI 设置中配置 Embedding Base URL、API Key 和 Model Name，并保存设置。', '嵌入模型尚未配置');
            return;
        }
        task = window.StatusCenter?.start('正在向量化合同…', '知识库');
        const summary = await RAG.buildIndex(visibleContracts, config, (current, total, detail) => {
            task?.update(`正在向量化合同 ${current}/${total}：${detail}`, total ? current / total * 100 : null);
        }, { allContracts: true, onContractComplete: refreshContractVectorStatus });
        const completed = summary.count + summary.skipped;
        const reasons = summary.errors.map(item => `${item.reason} ${item.count} 条`).join('；');
        task?.finish(`本次成功更新 ${completed}/${summary.total} 条（新建 ${summary.count} 条，沿用已有 ${summary.skipped} 条）。失败 ${summary.failed} 条。${reasons ? `失败原因：${reasons}。` : ''}`, summary.failed ? 'warning' : 'success');
    } catch (error) {
        const message = '合同向量化失败：' + error.message;
        if (task) task.finish(message, 'error');
        else showStatus('error', message, '📚', 6500);
    } finally {
        await refreshContractVectorStatus();
        contractVectorizing = false;
        updateContractVectorButton();
    }
}

function renderContractManagementTab() {
    const container = document.getElementById('contractManagementList');
    if (!container) return;

    const keys = getOrderedContractKeys();
    window.ContractBackup?.refreshControls();

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
            <div></div>
            <div class="cm-cell cm-cell-label" style="font-weight:600; color:#555; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">标签名</div>
            <div class="cm-cell cm-cell-name" style="font-weight:600; color:#555; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">完整名称</div>
            <div class="cm-cell cm-cell-visibility">可见</div>
            <div class="cm-cell cm-cell-action"></div>
            <div class="cm-cell cm-cell-count" style="font-weight:600; color:#555; font-size:12px; text-transform:uppercase; letter-spacing:0.05em; text-align:center;">条款数</div>
            <div class="cm-cell cm-cell-vector">
                <button type="button" id="btnVectorizeContracts" onclick="vectorizeContracts()">向量化</button>
            </div>
        </div>`;

    const rowsHtml = keys.map(key => {
        const { title, data } = contracts[key];
        const visible = isContractVisible(key);
        const keyText = escapeHtml(key);
        const titleText = escapeHtml(title);
        const keyAttribute = keyText.replace(/"/g, '&quot;');
        const titleAttribute = titleText.replace(/"/g, '&quot;');
        return `
            <div class="cm-row" data-key="${keyAttribute}">
                <div class="cm-reorder">
                    <span class="cm-drag-handle" draggable="true" title="拖动调整顺序" aria-hidden="true">⠿</span>
                </div>
                <div class="cm-cell cm-cell-label">
                    <span class="cm-editable"
                        contenteditable="true"
                        spellcheck="false"
                        data-field="key"
                        data-original="${keyAttribute}"
                        onblur="handleContractInlineEdit(this)"
                        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
                        title="点击编辑标签名">${keyText}</span>
                </div>
                <div class="cm-cell cm-cell-name">
                    <span class="cm-editable"
                        contenteditable="true"
                        spellcheck="false"
                        data-field="title"
                        data-original="${titleAttribute}"
                        onblur="handleContractInlineEdit(this)"
                        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
                        title="点击编辑完整名称">${titleText}</span>
                </div>
                <div class="cm-cell cm-cell-visibility">
                    <button type="button" class="cm-visibility" role="switch" aria-label="${keyAttribute} 可见" aria-checked="${visible}">${visible ? '可见' : '不可见'}</button>
                </div>
                <div class="cm-cell cm-cell-action">
                    <button class="cm-delete-btn" onclick="handleContractDeleteFromModal(decodeURIComponent('${encodeInlineArgument(key)}'))" title="删除合同 ${keyAttribute}">
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                </div>
                <div class="cm-cell cm-cell-count">
                    <span class="cm-clause-badge">${Object.keys(data).length}</span>
                </div>
                <div class="cm-cell cm-cell-vector">
                    <span class="cm-vector-status" role="img" aria-label="正在检查向量状态" title="正在检查向量状态"></span>
                </div>
            </div>`;
    }).join('');

    container.innerHTML = `
        <div style="margin-bottom:12px; font-size:13px; color:#888; line-height:1.5;">
            拖动左侧手柄调整顺序。点击标签名或完整名称可直接编辑。
        </div>
        <div class="cm-table">
            ${headerHtml}
            <div class="cm-rows">${rowsHtml}</div>
        </div>`;
    bindContractManagementRows(container.querySelector('.cm-rows'));
    updateContractVectorButton();
    refreshContractVectorStatus();
}

function bindContractManagementRows(rows) {
    let draggedRow = null;
    let dropRow = null;
    let dropAfter = false;

    function clearDropTarget() {
        dropRow?.removeAttribute('data-drop');
        dropRow = null;
    }

    rows.addEventListener('dragstart', event => {
        if (!event.target.closest('.cm-drag-handle')) return;
        draggedRow = event.target.closest('.cm-row');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedRow.dataset.key);
        draggedRow.classList.add('cm-dragging');
    });
    rows.addEventListener('dragover', event => {
        if (!draggedRow) return;
        clearDropTarget();
        const target = event.target.closest('.cm-row');
        if (!target || target === draggedRow) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const bounds = target.getBoundingClientRect();
        dropRow = target;
        dropAfter = event.clientY >= bounds.top + bounds.height / 2;
        dropRow.dataset.drop = dropAfter ? 'after' : 'before';
    });
    rows.addEventListener('dragleave', event => {
        if (!rows.contains(event.relatedTarget)) clearDropTarget();
    });
    rows.addEventListener('drop', event => {
        if (!draggedRow || !dropRow) return;
        event.preventDefault();
        const moved = moveContract(draggedRow.dataset.key, dropRow.dataset.key, dropAfter);
        clearDropTarget();
        if (moved) renderContractManagementTab();
    });
    rows.addEventListener('dragend', () => {
        clearDropTarget();
        draggedRow?.classList.remove('cm-dragging');
        draggedRow = null;
    });

    rows.addEventListener('click', async event => {
        const button = event.target.closest('button');
        const row = button?.closest('.cm-row');
        if (!row) return;
        const key = row.dataset.key;
        if (button.matches('.cm-visibility')) {
            const visible = !isContractVisible(key);
            const saved = setContractVisibility(key, visible);
            button.setAttribute('aria-checked', String(visible));
            button.textContent = visible ? '可见' : '不可见';
            if (await saved && visible === isContractVisible(key)) {
                showSettingsStatus(`「${key}」已设为${visible ? '可见' : '不可见'}`, 'success');
            }
        }
    });
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
        if (activeContractKey === originalKey) activeContractKey = newValue;
        row.querySelector('.cm-visibility').setAttribute('aria-label', `${newValue} 可见`);
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
    if (confirm(`确认删除合同 "${key}"？\n\n此操作不可撤销，删除会在智能合并同步时同步到其他设备。`)) {
        if (typeof removeContract === 'function') removeContract(key);
        renderContractManagementTab();
    }
}

console.log('[ai-settings.js] AI设置与模型管理加载完成');
