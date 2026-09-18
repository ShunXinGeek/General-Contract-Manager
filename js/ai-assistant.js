// =======================================================
// ai-assistant.js - AI 管理助手核心
// 依赖：app.js (全局状态变量, switchContract, contracts, etc.)
//       config.js (AI_CONFIG, generateDynamicSystemPrompt)
//       ai-settings.js (isAIConfigured, openSettings)
//       utils.js (escapeHtml, sanitizeHtml)
//       rag.js (RAG)
// 须在 app.js 和 ai-settings.js 之后加载
// =======================================================

// =======================================================
// 15. AI 管理助手 - 面板切换
// =======================================================
let knowledgeBaseReady = Promise.resolve();
let lastRetrievalEvidence = null;
function switchToAssistant() {
    isAssistantMode = true;
    document.querySelectorAll('.header-tab').forEach(btn => btn.classList.remove('active'));
    document.getElementById('tab-Assistant').classList.add('active');
    document.getElementById('panelNav').style.display = 'none';
    document.getElementById('resizer1').style.display = 'none';
    document.getElementById('panelMain').style.display = 'none';
    document.getElementById('resizer2').style.display = 'none';
    document.getElementById('panelRef').style.display = 'none';
    document.getElementById('panelAssistant').style.display = 'flex';
    if (!isStreaming) loadChatFromStorage();
}

function switchBackToContract() {
    isAssistantMode = false;
    document.getElementById('panelNav').style.display = '';
    document.getElementById('resizer1').style.display = '';
    document.getElementById('panelMain').style.display = '';
    document.getElementById('resizer2').style.display = '';
    document.getElementById('panelRef').style.display = '';
    document.getElementById('panelAssistant').style.display = 'none';
}

// 覆写 switchContract：切换合同时自动退出助手模式
(function () {
    const originalSwitchContract = switchContract;
    switchContract = function (key) { if (isAssistantMode) switchBackToContract(); originalSwitchContract(key); };
})();

// 覆写 showWelcomePage：切换欢迎页时自动退出助手模式
(function () {
    const originalShowWelcomePage = showWelcomePage;
    showWelcomePage = function () { if (isAssistantMode) switchBackToContract(); originalShowWelcomePage(); };
})();

// =======================================================
// 消息发送与 API 调用
// =======================================================
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || isStreaming) return;
    if (!isAIConfigured()) { alert('🤖 AI 助手尚未配置\n\n请点击 ⚙️ 设置按钮配置。'); openSettings(); return; }
    abortController = new AbortController();
    const requestSignal = abortController.signal;
    addMessage('user', text);
    input.value = ''; autoResizeInput();
    showTypingIndicator();
    try { isStreaming = true; updateSendButton(); const messages = await buildMessagesForAPI(); if (requestSignal.aborted) throw new DOMException('已停止生成', 'AbortError'); await streamAPIResponse(messages); }
    catch (error) { if (error.name !== 'AbortError') addMessage('assistant', '❌ 请求失败: ' + error.message); }
    finally { isStreaming = false; hideTypingIndicator(); updateSendButton(); saveChatToStorage(); }
}

async function buildMessagesForAPI(historyOverride) {
    lastRetrievalEvidence = null;
    const sourceHistory = historyOverride || chatMessages;
    const startIndex = historyOverride ? sourceHistory.reduce((index, msg, i) => msg.type === 'break' ? i + 1 : index, 0) : (hasContextBreak ? contextBreakIndex : 0);
    const effectiveHistory = sourceHistory.slice(startIndex);
    let systemPrompt = typeof generateDynamicSystemPrompt === 'function' ? generateDynamicSystemPrompt() : AI_CONFIG.systemPrompt;
    if (isKnowledgeBaseMode) {
        await knowledgeBaseReady;
        const lastUserMessage = effectiveHistory.filter(m => m.role === 'user').pop();
        if (lastUserMessage) {
            const relevantClauses = await findRelevantClauses(lastUserMessage.content, effectiveHistory);
            systemPrompt = buildDatabaseModePrompt(relevantClauses);
        }
    }
    const messages = [{ role: 'system', content: systemPrompt }];
    if (lastRetrievalEvidence) messages.retrievalEvidence = lastRetrievalEvidence;
    const keepReasoning = AIClient.needsReasoningHistory(AI_CONFIG.apiEndpoint, AI_CONFIG.model);
    effectiveHistory.forEach(msg => {
        if (msg.type !== 'break') messages.push({ role: msg.role, content: msg.content,
            ...(keepReasoning && msg.role === 'assistant' ? { reasoning_content: msg.reasoning || '' } : {}) });
    });
    return messages;
}

// 数据库模式提示词（通用版 / 交叉引用增强版）
function buildDatabaseModePrompt(relevantClauses) {
    const evidence = lastRetrievalEvidence || { clauses: relevantClauses, diagnostic: { query: '', warnings: [], missing: [], omitted: [], relationships: [] } };
    const base = generateDynamicSystemPrompt() + '\n' + (AI_CONFIG.systemPrompt || '');
    return AIRetrieval.prompt(evidence, base);
}

async function streamAPIResponse(messages, existingMessageDiv, existingIndex) {
    if (!abortController || abortController.signal.aborted) abortController = new AbortController();
    const evidence = messages.retrievalEvidence;
    const requestConfig = { ...AI_CONFIG }, thinking = isThinkingMode, requestSignal = abortController.signal;
    const response = await AIClient.request(requestConfig, messages, { thinking, signal: requestSignal });
    hideTypingIndicator();
    let assistantContent = '', reasoningContent = '', thinkingStartTime = null, thinkingEndTime = null;
    let messageDiv = existingMessageDiv || null;
    // If regenerating into an existing message, clear its previous content
    if (existingMessageDiv) {
        const prevThinking = existingMessageDiv.querySelector('.thinking-block');
        if (prevThinking) prevThinking.remove();
        const contentEl = existingMessageDiv.querySelector('.message-content');
        if (contentEl) contentEl.innerHTML = '<span class="regenerating-indicator">🔄 重新生成中...</span>';
    }
    let streamError = null;
    try {
        for await (const data of AIClient.events(response)) {
            const delta = data.choices?.[0]?.delta;
            if (!delta) continue;
            if (delta.reasoning_content) {
                if (!thinkingStartTime) thinkingStartTime = Date.now();
                reasoningContent += delta.reasoning_content;
                if (!messageDiv) { messageDiv = createMessageElement('assistant', '', chatMessages.length, true); document.getElementById('chatMessages').appendChild(messageDiv); }
                if (!messageDiv.querySelector('.thinking-block')) addThinkingBlockToMessage(messageDiv, '', thinkingStartTime, null);
                const bodyInner = messageDiv.querySelector('.thinking-body-inner');
                if (bodyInner) bodyInner.textContent = reasoningContent;
                scrollToBottom();
            }
            if (delta.content) {
                if (reasoningContent && !thinkingEndTime) thinkingEndTime = Date.now();
                assistantContent += delta.content;
                if (!messageDiv) { messageDiv = createMessageElement('assistant', '', chatMessages.length, false); document.getElementById('chatMessages').appendChild(messageDiv); }
                const contentEl = messageDiv.querySelector('.message-content');
                contentEl.innerHTML = renderMarkdown(assistantContent);
                messageDiv.dataset.rawContent = assistantContent;
                if (reasoningContent && thinkingStartTime && thinkingEndTime) updateThinkingBlock(messageDiv, reasoningContent, thinkingStartTime, thinkingEndTime);
                scrollToBottom();
            }
        }
    } catch (error) { streamError = error; }
    if (streamError && assistantContent) {
        assistantContent += streamError.name === 'AbortError' ? '\n\n[已停止生成]' : '\n\n[回答未完成：连接中断或超时]';
        messageDiv.querySelector('.message-content').innerHTML = renderMarkdown(assistantContent);
        messageDiv.dataset.rawContent = assistantContent;
    }
    if (!reasoningContent && assistantContent && isThinkingMode) {
        const thinkMatch = assistantContent.match(/^<think>([\s\S]*?)<\/think>\s*/i);
        if (thinkMatch) {
            reasoningContent = thinkMatch[1].trim();
            assistantContent = assistantContent.replace(/^<think>[\s\S]*?<\/think>\s*/i, '').trim();
            thinkingEndTime = thinkingEndTime || Date.now();
            if (messageDiv) {
                const contentEl = messageDiv.querySelector('.message-content');
                contentEl.innerHTML = renderMarkdown(assistantContent);
                messageDiv.dataset.rawContent = assistantContent;
                addThinkingBlockToMessage(messageDiv, reasoningContent, thinkingStartTime, thinkingEndTime);
            }
        }
    }
    let validation = null;
    if (assistantContent && evidence && !streamError) {
        validation = AIRetrieval.validate(assistantContent, evidence, contracts);
        if (!validation.passed && evidence.clauses.length && !requestSignal.aborted) {
            try {
                if (messageDiv) messageDiv.querySelector('.message-content').insertAdjacentHTML('beforeend', '<p>正在依据原文校验并修正引用…</p>');
                const repairMessages = [...messages, { role: 'assistant', content: assistantContent }, { role: 'user', content:
                    '请只修正以下引用校验问题，仍以已提供原文为准；无法修正时明确说明缺口，不补造内容。返回完整修正答案。问题：' + validation.issues.join('；') }];
                const repair = await AIClient.request(requestConfig, repairMessages, { stream: false, thinking, signal: requestSignal });
                const repaired = (await repair.json()).choices?.[0]?.message?.content;
                if (repaired) { assistantContent = repaired; validation = { ...AIRetrieval.validate(repaired, evidence, contracts), repaired: true }; }
            } catch (_) { validation.repairFailed = true; if (requestSignal.aborted) streamError = new DOMException('已停止生成', 'AbortError'); }
        }
        if (!validation.passed) assistantContent += '\n\n[引用校验提示：' + validation.issues.join('；') + '。以上涉及内容需核对原文。]';
        const gaps = [...evidence.diagnostic.missing, ...evidence.diagnostic.omitted, ...evidence.diagnostic.warnings.filter(text => /不可用|不一致|失效|旧索引|向量索引为空|未检出|缺少/.test(text))];
        if (gaps.length) assistantContent += '\n\n[依据范围提示：' + gaps.slice(0, 4).join('；') + (gaps.length > 4 ? '；另有 ' + (gaps.length - 4) + ' 项缺口' : '') + '。]';
        if (messageDiv) {
            messageDiv.querySelector('.message-content').innerHTML = renderMarkdown(assistantContent);
            messageDiv.dataset.rawContent = assistantContent;
        }
    }
    if (assistantContent) {
        const msgData = { role: 'assistant', content: assistantContent };
        if (validation) msgData.validation = validation;
        if (evidence) msgData.retrievalDiagnostic = evidence.diagnostic;
        if (reasoningContent) { msgData.reasoning = reasoningContent; msgData.thinkingDuration = thinkingStartTime && thinkingEndTime ? ((thinkingEndTime - thinkingStartTime) / 1000).toFixed(1) : null; }
        if (existingIndex !== undefined && existingIndex >= 0 && existingIndex < chatMessages.length) {
            chatMessages[existingIndex] = msgData;
        } else {
            chatMessages.push(msgData);
        }
    }
    if (streamError) throw streamError;
}

function stopGeneration() { if (abortController) { abortController.abort(); abortController = null; } }

// =======================================================
// 16. 思考模式 & 聊天 UI
// =======================================================
function toggleThinkingMode() {
    if (AI_CONFIG.apiEndpoint && AIClient.thinkingCapability(AI_CONFIG.apiEndpoint, AI_CONFIG.model) === 'always') {
        alert('该模型固定开启思考，无法通过此开关关闭。'); return;
    }
    if (AI_CONFIG.apiEndpoint && AIClient.thinkingCapability(AI_CONFIG.apiEndpoint, AI_CONFIG.model) === 'default') {
        alert('此模型暂未配置原生思考开关，将使用服务商默认行为。'); return;
    }
    isThinkingMode = !isThinkingMode;
    const btn = document.getElementById('btnThinkingMode');
    const icon = document.getElementById('thinkingModeIcon');
    const text = document.getElementById('thinkingModeText');
    if (isThinkingMode) { btn.classList.add('thinking-active'); icon.innerText = '🧠🧠'; text.innerText = ' 思考'; }
    else { btn.classList.remove('thinking-active'); icon.innerText = '🧠'; text.innerText = ' 思考'; }
}

function toggleThinkingBlock(headerEl) { const block = headerEl.closest('.thinking-block'); if (block) block.classList.toggle('expanded'); }

function updateThinkingBlock(messageDiv, reasoning, startTime, endTime) {
    let block = messageDiv.querySelector('.thinking-block'); if (!block) return;
    const duration = startTime && endTime ? ((endTime - startTime) / 1000).toFixed(1) : '...';
    const headerLeft = block.querySelector('.thinking-header-left'); if (headerLeft) headerLeft.innerHTML = '🧠 思考过程 <span class="thinking-duration">(' + duration + 's)</span>';
    const bodyInner = block.querySelector('.thinking-body-inner'); if (bodyInner) bodyInner.textContent = reasoning;
}

function addThinkingBlockToMessage(messageDiv, reasoning, startTime, endTime) {
    const duration = startTime && endTime ? ((endTime - startTime) / 1000).toFixed(1) : '?';
    const blockHtml = '<div class="thinking-block"><div class="thinking-header" onclick="toggleThinkingBlock(this)"><div class="thinking-header-left">🧠 思考过程 <span class="thinking-duration">(' + duration + 's)</span></div><span class="thinking-arrow">▼</span></div><div class="thinking-body"><div class="thinking-body-inner">' + escapeHtml(reasoning) + '</div></div></div>';
    const contentEl = messageDiv.querySelector('.message-content'); if (contentEl) contentEl.insertAdjacentHTML('beforebegin', blockHtml);
}

function restoreThinkingBlock(messageDiv, msg) {
    if (msg.reasoning) { addThinkingBlockToMessage(messageDiv, msg.reasoning, null, null); const headerLeft = messageDiv.querySelector('.thinking-header-left'); if (headerLeft) headerLeft.innerHTML = '🧠 思考过程 <span class="thinking-duration">(' + (msg.thinkingDuration || '?') + 's)</span>'; }
}

function addMessage(role, content) {
    const welcome = document.querySelector('.chat-welcome'); if (welcome) welcome.remove();
    chatMessages.push({ role, content });
    const messageDiv = createMessageElement(role, content);
    document.getElementById('chatMessages').appendChild(messageDiv);
    scrollToBottom();
}

function createMessageElement(role, content, index, hasThinking) {
    const div = document.createElement('div'); div.className = 'chat-message ' + role;
    div.dataset.msgIndex = index !== undefined ? index : chatMessages.length - 1;
    div.dataset.rawContent = content;
    const renderedContent = role === 'assistant' ? renderMarkdown(content) : escapeHtml(content);
    const thinkingHtml = hasThinking ? '<div class="thinking-block" id="streamingThinkingBlock"><div class="thinking-header" onclick="toggleThinkingBlock(this)"><div class="thinking-header-left">🧠 思考中...</div><span class="thinking-arrow">▼</span></div><div class="thinking-body"><div class="thinking-body-inner"></div></div></div>' : '';
    const actionsHtml = role === 'assistant'
        ? '<div class="msg-actions"><button onclick="copyMessage(this)" title="复制">📋</button><button onclick="regenerateMessage(this)" title="重新生成">🔄</button><button onclick="deleteMessage(this)" title="删除">🗑️</button></div>'
        : '<div class="msg-actions"><button onclick="copyMessage(this)" title="复制">📋</button><button onclick="deleteMessage(this)" title="删除">🗑️</button></div>';
    div.innerHTML = thinkingHtml + '<div class="message-content">' + renderedContent + '</div>' + actionsHtml;
    return div;
}

function copyMessage(btn) { const msgDiv = btn.closest('.chat-message'); const content = msgDiv.dataset.rawContent || msgDiv.querySelector('.message-content').innerText; navigator.clipboard.writeText(content).then(() => { const orig = btn.innerText; btn.innerText = '✅'; setTimeout(() => btn.innerText = orig, 1500); }); }
function deleteMessage(btn) { const msgDiv = btn.closest('.chat-message'); const index = parseInt(msgDiv.dataset.msgIndex); if (!isNaN(index) && index >= 0 && index < chatMessages.length) { chatMessages.splice(index, 1); saveChatToStorage(); renderChatMessages(); } else { msgDiv.remove(); } }
async function regenerateMessage(btn) {
    if (isStreaming) return;
    if (!isAIConfigured()) { alert('🤖 AI 助手尚未配置\n\n请点击 ⚙️ 设置按钮配置。'); openSettings(); return; }
    const msgDiv = btn.closest('.chat-message');
    const index = parseInt(msgDiv.dataset.msgIndex);
    if (!isNaN(index) && index >= 0 && index < chatMessages.length) {
        abortController = new AbortController();
        const requestSignal = abortController.signal;
        showTypingIndicator();
        try { isStreaming = true; updateSendButton(); const messages = await buildMessagesForAPI(chatMessages.slice(0, index)); if (requestSignal.aborted) throw new DOMException('已停止生成', 'AbortError'); await streamAPIResponse(messages, msgDiv, index); }
        catch (error) { if (error.name !== 'AbortError') { chatMessages[index] = { role: 'assistant', content: '❌ 请求失败: ' + error.message }; renderChatMessages(); } }
        finally { isStreaming = false; hideTypingIndicator(); updateSendButton(); saveChatToStorage(); }
    }
    else { msgDiv.remove(); }
}
function showTypingIndicator() { const ind = document.createElement('div'); ind.className = 'chat-message assistant'; ind.id = 'typingIndicator'; ind.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>'; document.getElementById('chatMessages').appendChild(ind); scrollToBottom(); }
function hideTypingIndicator() { const ind = document.getElementById('typingIndicator'); if (ind) ind.remove(); }
function updateSendButton() { const btn = document.getElementById('sendBtn'); const icon = document.getElementById('sendBtnIcon'); if (isStreaming) { btn.classList.add('stop'); icon.innerText = '⏹'; btn.onclick = stopGeneration; } else { btn.classList.remove('stop'); icon.innerText = '➤'; btn.onclick = sendMessage; } }
function scrollToBottom() { const c = document.getElementById('chatMessages'); if ((c.scrollHeight - c.scrollTop - c.clientHeight) < 60) c.scrollTop = c.scrollHeight; }

function toggleContextBreak() {
    const container = document.getElementById('chatMessages');
    const lastBreakIndex = findLastContextBreakIndex();
    const hasContentAfterBreak = lastBreakIndex !== -1 && chatMessages.slice(lastBreakIndex + 1).some(m => m.type !== 'break');
    if (hasContextBreak && !hasContentAfterBreak) {
        const allBreaks = document.querySelectorAll('.context-break'); if (allBreaks.length > 0) allBreaks[allBreaks.length - 1].remove();
        for (let i = chatMessages.length - 1; i >= 0; i--) { if (chatMessages[i].type === 'break') { chatMessages.splice(i, 1); break; } }
        hasContextBreak = chatMessages.some(m => m.type === 'break');
        contextBreakIndex = hasContextBreak ? findLastContextBreakIndex() + 1 : -1;
    } else {
        const breakDiv = document.createElement('div'); breakDiv.className = 'context-break'; breakDiv.innerHTML = '<span>✂️ 终止上下文</span>'; container.appendChild(breakDiv);
        chatMessages.push({ type: 'break' }); contextBreakIndex = chatMessages.length; hasContextBreak = true; scrollToBottom();
    }
    saveChatToStorage();
}

function findLastContextBreakIndex() { for (let i = chatMessages.length - 1; i >= 0; i--) { if (chatMessages[i].type === 'break') return i; } return -1; }

async function clearChat() {
    const isClear = await CustomDialog.confirm('确定要清空所有对话记录吗？', '清空确认');
    if (!isClear) return;
    chatMessages = []; hasContextBreak = false; contextBreakIndex = -1;
    const contractList = Object.keys(contracts).length > 0 ? '我可以帮您分析已导入的合同条款。' : '请先导入合同数据。';
    document.getElementById('chatMessages').innerHTML = '<div class="chat-welcome"><div class="welcome-icon">🤖</div><div class="welcome-title">合同管理助手</div><div class="welcome-text">' + contractList + '<br>您可以使用"引用条款"按钮快速引入条款内容。</div></div>';
    saveChatToStorage();
}

function handleFileUpload(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => { let text = e.target.result; if (text.length > 10000) text = text.substring(0, 10000) + '\n\n[文档内容已截断]'; const input = document.getElementById('chatInput'); input.value = '[上传文档: ' + file.name + ']\n\n' + text + '\n\n请帮我分析这份文档：'; autoResizeInput(); };
    reader.readAsText(file); event.target.value = '';
}

function handleInputKeydown(event) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }
function autoResizeInput() { const input = document.getElementById('chatInput'); input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
async function saveChatToStorage() { try { await localforage.setItem('general_contract_chat', JSON.stringify({ messages: chatMessages, hasContextBreak, contextBreakIndex })); } catch (e) { } }
async function loadChatFromStorage() { try { const saved = await localforage.getItem('general_contract_chat'); if (saved) { const data = JSON.parse(saved); chatMessages = data.messages || []; hasContextBreak = data.hasContextBreak || false; contextBreakIndex = data.contextBreakIndex || -1; renderChatMessages(); } } catch (e) { } }

function renderChatMessages() {
    const container = document.getElementById('chatMessages');
    if (chatMessages.length === 0) return;
    container.innerHTML = '';
    chatMessages.forEach((msg, idx) => {
        if (msg.type === 'break') { const breakDiv = document.createElement('div'); breakDiv.className = 'context-break'; breakDiv.innerHTML = '<span>✂️ 终止上下文</span>'; container.appendChild(breakDiv); }
        else { const messageDiv = createMessageElement(msg.role, msg.content, idx); container.appendChild(messageDiv); if (msg.reasoning) restoreThinkingBlock(messageDiv, msg); }
    });
    scrollToBottom();
}

document.getElementById('chatInput')?.addEventListener('input', autoResizeInput);

// =======================================================
// 17. Markdown 渲染（通用版）
// =======================================================
function renderMarkdown(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true, headerIds: false, mangle: false });
        let html = marked.parse(text);
        Object.keys(contracts).forEach(contractKey => {
            // 第一轮：匹配 "ContractKey Clause X" 格式（如 GCC Clause 20）
            const regex = new RegExp(contractKey + '\\s+[Cc]lause\\s+([0-9a-zA-Z]+)(?:,\\s*([0-9a-zA-Z]+))*', 'gi');
            html = html.replace(regex, (match) => {
                const prefix = match.match(new RegExp(contractKey + '\\s+[Cc]lause', 'i'))[0];
                const parts = match.substring(prefix.length).replace(/<[^>]*>/g, '').split(',').map(s => s.trim()).filter(Boolean);
                const links = parts.map(num => '<span class="chat-clause-link" onclick="jumpToContractClause(\'' + contractKey + '\', \'' + num + '\')">' + prefix + ' ' + num + '</span>');
                return links.join(', ');
            });
            // 第二轮：直接匹配含合同前缀的条款键名（如 "SCC 9C"、"SCC 124"）
            // 适用于 AI 直接生成 "SCC 9C" 格式（不含 Clause 关键词）的情况
            // 同时修复含字母后缀的条款号（如 9C）可能被截断的问题
            const dataKeys = Object.keys(contracts[contractKey].data);
            const prefixedKeys = dataKeys.filter(k =>
                k.length > contractKey.length &&
                k.toUpperCase().startsWith(contractKey.toUpperCase())
            );
            if (prefixedKeys.length > 0) {
                // 按长度降序排列：确保 "SCC 9C" 优先于 "SCC 9" 被匹配，避免短键吞噬长键
                const sortedKeys = [...prefixedKeys].sort((a, b) => b.length - a.length);
                const escapedKeys = sortedKeys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                const directRegex = new RegExp('\\b(' + escapedKeys.join('|') + ')\\b', 'gi');
                html = html.replace(directRegex, (match) => {
                    const actualKey = dataKeys.find(k => k.toLowerCase() === match.toLowerCase()) || match;
                    return '<span class="chat-clause-link" onclick="jumpToContractClause(\'' + contractKey + '\', \'' + actualKey + '\')">' + match + '</span>';
                });
            }
        });
        const existingPrefixes = Object.keys(contracts).join('|');
        const lookbehindRegex = existingPrefixes ? new RegExp('(?<!(?:' + existingPrefixes + ')\\s+)Clause\\s+(\\d+[A-Z]?)\\b', 'gi') : /Clause\s+(\d+[A-Z]?)\b/gi;
        html = html.replace(lookbehindRegex, (match, num) => {
            return '<span class="chat-clause-link" onclick="jumpToClause(\'' + num + '\')">' + match + '</span>';
        });
        return html;
    }
    let html = escapeHtml(text);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

function jumpToContractClause(contractKey, clauseId) {
    if (!contracts[contractKey]) return;
    // 规范化条款号：依次尝试多种键名格式
    // 支持纯数字键（如 GCC 的 "20"）和带合同前缀的键（如 SCC 的 "SCC 124" 或 "SCC124"）
    const cleanId = (clauseId || '').trim();
    const dataKeys = Object.keys(contracts[contractKey].data);
    const candidates = [
        cleanId,                          // 直接匹配，如 "20" 或 "124"
        contractKey + ' ' + cleanId,      // 带合同前缀+空格，如 "SCC 124"
        contractKey + cleanId,            // 带合同前缀无空格，如 "SCC124"
    ];
    const resolvedId = dataKeys.find(k =>
        candidates.some(c => k === c || k.toLowerCase() === c.toLowerCase())
    );
    if (!resolvedId) { console.warn('[jumpToContractClause] 未找到条款:', contractKey, clauseId); return; }
    if (isAssistantMode) { showAssistantClause(contractKey, resolvedId); return; }
    switchBackToContract();
    switchContract(contractKey);
    setTimeout(() => { document.getElementById('clause-' + resolvedId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
}

function jumpToClause(clauseId) {
    if (isAssistantMode) {
        for (const key of Object.keys(contracts)) { if (contracts[key].data[clauseId]) { showAssistantClause(key, clauseId); return; } }
        return;
    }
    switchBackToContract();
    for (const key of Object.keys(contracts)) {
        if (contracts[key].data[clauseId]) {
            switchContract(key); setTimeout(() => { document.getElementById('clause-' + clauseId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100); return;
        }
    }
}

// =======================================================
// 18. 条款引用选择器
// =======================================================
function openClauseSelector() {
    const modal = document.createElement('div'); modal.className = 'modal-overlay'; modal.id = 'clauseSelectorModal'; modal.style.display = 'flex';
    let columnsHtml = '';
    const keys = Object.keys(contracts);
    keys.forEach(contractKey => {
        let list = '';
        Object.keys(contracts[contractKey].data).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(id => {
            const clause = contracts[contractKey].data[id];
            list += '<div class="clause-option" data-title="' + escapeHtml(clause.title).toLowerCase() + '" onclick="insertClause(\'' + contractKey + '\', \'' + id + '\')" style="padding:8px; cursor:pointer; border-bottom:1px solid var(--border-color); transition:background 0.2s;" onmouseover="this.style.background=\'var(--bg-nav-item-hover)\'" onmouseout="this.style.background=\'\'">' + clause.title + '</div>';
        });
        columnsHtml += '<div style="flex:1; display:flex; flex-direction:column; min-width:0;"><div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;"><h4 style="margin:0; color:var(--highlight-color); white-space:nowrap;">' + contractKey + ' 条款</h4><div class="clause-search-wrapper"><input type="text" class="clause-search-input" placeholder="搜索..." autocomplete="new-password" oninput="filterClauses(this, \'' + contractKey + '\')"><span class="clause-search-clear" onclick="clearClauseSearch(this, \'' + contractKey + '\')">✕</span></div></div><div id="clauseList-' + contractKey + '" style="flex:1; overflow-y:auto; max-height:400px; border:1px solid var(--border-color); border-radius:4px;">' + list + '</div></div>';
    });
    modal.innerHTML = '<div class="modal-content" style="max-width:' + Math.min(750, keys.length * 350) + 'px; height:auto; max-height:80%;"><div class="modal-header"><span style="font-size:16px; font-weight:bold;">📋 选择条款引用</span><span class="close-modal" onclick="closeClauseSelector()">✕</span></div><div class="modal-body" style="padding:15px; display:flex; gap:15px;">' + columnsHtml + '</div></div>';
    document.body.appendChild(modal);
}

function closeClauseSelector() { const modal = document.getElementById('clauseSelectorModal'); if (modal) modal.remove(); }

function insertClause(contractType, clauseId) {
    const clause = contracts[contractType].data[clauseId]; if (!clause) return;
    const input = document.getElementById('chatInput');
    input.value = '请帮我分析这个条款：\n\n【' + contractType + ' ' + clause.title + '】\n\n' + clause.content.replace(/<[^>]*>/g, '') + '\n\n';
    autoResizeInput(); closeClauseSelector(); input.focus();
}

function filterClauses(inputEl, type) {
    const keyword = inputEl.value.trim().toLowerCase();
    const listContainer = document.getElementById('clauseList-' + type); if (!listContainer) return;
    const clearBtn = inputEl.parentElement.querySelector('.clause-search-clear');
    if (clearBtn) clearBtn.style.display = keyword ? 'flex' : 'none';
    listContainer.querySelectorAll('.clause-option').forEach(item => { const title = item.dataset.title || item.textContent.toLowerCase(); item.style.display = title.includes(keyword) ? '' : 'none'; });
}

function clearClauseSearch(clearBtn, type) { const inputEl = clearBtn.parentElement.querySelector('.clause-search-input'); if (inputEl) { inputEl.value = ''; filterClauses(inputEl, type); inputEl.focus(); } }

// =======================================================
// 19. 助手右侧栏
// =======================================================
async function toggleAssistantRef() {
    const panel = document.getElementById('assistantRefPanel'); const resizer = document.getElementById('assistantResizer');
    if (!panel || !resizer) return;
    // 移除 AI 配置检查，允许用户单纯打开侧边栏看条款原文和译文
    // if (!isAIConfigured()) { await CustomDialog.alert('🤖 AI 助手尚未配置\n\n请点击 ⚙️ 设置按钮配置。', '未配置'); openSettings(); return; }
    isAssistantRefVisible = !isAssistantRefVisible;
    const titleText = document.querySelector('.toolbar-title .title-text'); if (titleText) titleText.style.display = isAssistantRefVisible ? 'none' : '';
    if (isAssistantRefVisible) { panel.style.display = 'flex'; resizer.style.display = ''; initAssistantResizer(); }
    else { panel.style.display = 'none'; resizer.style.display = 'none'; }
}

function initAssistantResizer() {
    const resizer = document.getElementById('assistantResizer'); const panel = document.getElementById('assistantRefPanel'); const container = document.getElementById('panelAssistant');
    if (!resizer || !panel || !container || resizer._bound) return; resizer._bound = true;
    let startX, startWidth;
    resizer.addEventListener('mousedown', (e) => {
        e.preventDefault(); startX = e.clientX; startWidth = panel.getBoundingClientRect().width;
        const onMouseMove = (e) => { const diff = startX - e.clientX; panel.style.width = Math.max(200, Math.min(startWidth + diff, container.clientWidth - 300)) + 'px'; };
        const onMouseUp = () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
        document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    });
}

function showAssistantClause(type, clauseId, preserveScroll) {
    const clause = contracts[type]?.data[clauseId]; if (!clause) return;
    assistantRefClauseType = type; assistantRefClauseId = clauseId;
    if (!isAssistantRefVisible) toggleAssistantRef();
    const header = document.getElementById('assistantRefFixedHeader');
    const title = document.getElementById('assistantRefFixedTitle');
    const content = document.getElementById('assistantRefContent');
    header.style.display = 'block'; header.classList.remove('mode-ref', 'mode-trans'); header.classList.add(assistantRefMode === 'ref' ? 'mode-ref' : 'mode-trans');
    let displayTitle = clause.title;
    if (!/^(Clause|clause)/i.test(displayTitle) && !new RegExp('^' + type, 'i').test(displayTitle)) { displayTitle = type + ' Clause ' + displayTitle; }
    else if (/^Clause/i.test(displayTitle)) { displayTitle = type + ' ' + displayTitle; }
    title.innerText = displayTitle;
    document.getElementById('btnAssistantLangMode').innerText = assistantRefMode === 'ref' ? '译' : '原';
    let html;
    if (assistantRefMode === 'ref') {
        html = '<div style="padding:15px;"><div style="font-size:12px; font-weight:bold; color:var(--text-muted); margin-bottom:8px;">English Original</div><div style="line-height:1.6;">' + sanitizeHtml(clause.content) + '</div></div>';
    } else {
        const transText = isAssistantTraditional ? (clause.translation_tc || clause.translation) : clause.translation;
        const langLabel = isAssistantTraditional ? '繁體譯文' : '中文译文';
        html = '<div style="padding:15px;"><div style="font-size:12px; font-weight:bold; color:var(--trans-border); margin-bottom:8px;">' + langLabel + '</div>';
        if (transText) html += '<div style="line-height:1.8; text-align:justify;">' + sanitizeHtml(transText) + '</div>';
        else html += '<div style="color:var(--text-muted); font-style:italic;">暂无译文</div>';
        html += '</div>';
    }
    content.innerHTML = html; if (!preserveScroll) content.scrollTop = 0;
}

function toggleAssistantRefLangMode() {
    assistantRefMode = assistantRefMode === 'ref' ? 'trans' : 'ref';
    document.getElementById('btnAssistantLangMode').innerText = assistantRefMode === 'ref' ? '译' : '原';
    if (assistantRefClauseType && assistantRefClauseId) showAssistantClause(assistantRefClauseType, assistantRefClauseId);
}

function toggleAssistantLang() {
    if (assistantRefMode !== 'trans') return;
    isAssistantTraditional = !isAssistantTraditional;
    const btn = document.getElementById('btnAssistantLangToggle'); btn.innerText = isAssistantTraditional ? '繁' : '简';
    if (assistantRefClauseType && assistantRefClauseId) showAssistantClause(assistantRefClauseType, assistantRefClauseId, true);
}

// =======================================================
// 20. 知识库模式
// =======================================================
function toggleKnowledgeBaseMode() {
    isKnowledgeBaseMode = !isKnowledgeBaseMode;
    const btn = document.getElementById('btnKnowledgeBase');
    const icon = document.getElementById('kbModeIcon');
    const text = document.getElementById('kbModeText');
    const btnUpdate = document.getElementById('btnUpdateIndex');
    if (isKnowledgeBaseMode) { btn.classList.add('db-active'); icon.innerText = '📂'; text.innerText = '知识库已开启'; btnUpdate.style.display = 'inline-flex'; knowledgeBaseReady = checkRAGIndexStatus(); }
    else { btn.classList.remove('db-active'); icon.innerText = '📂'; text.innerText = '打开知识库'; btnUpdate.style.display = 'none'; }
}

async function checkRAGIndexStatus() {
    try {
        const isEmpty = await RAG.isIndexEmpty();
        if (!isEmpty || !isKnowledgeBaseMode) return;

        // Step 1: 尝试加载预构建向量数据并导入 IndexedDB
        showStatus('loading', '正在加载预构建向量数据...', '📦', 0);
        const loaded = await RAG.ensurePrebuiltVectorsLoaded();

        if (loaded) {
            const count = await RAG.importPrebuiltVectors(
                (current, total) => {
                    showStatus('loading',
                        `正在导入向量索引 ${current}/${total}...`, '📥', 0);
                }
            );
            if (count > 0) {
                showStatus('success',
                    `已导入 ${count} 条向量；旧数据缺少正文指纹时使用本地检索，请主动更新索引`, '📥', 5000);
                return; // 导入成功，无需弹窗
            }
        }

        // Step 2: 预构建数据不可用，回退到在线构建流程
        showStatus('warning',
            '预构建向量数据不可用，需要在线构建索引', '⚠️', 4000);
        const isBuild = await CustomDialog.confirm(
            '知识库索引尚未构建，是否立即构建？（需要配置嵌入模型 API）',
            '构建提示'
        );
        if (isBuild) buildKnowledgeBaseIndex();
    } catch (e) {
        console.error('[知识库] 索引状态检查出错:', e);
    }
}

async function buildKnowledgeBaseIndex() {
    if (!isEmbeddingConfigured()) { await CustomDialog.alert('🔗 嵌入模型尚未配置\n请点击设置按钮配置。', '未配置'); openSettings(); return; }
    const btn = document.getElementById('btnUpdateIndex'); const orig = btn.innerHTML; btn.innerHTML = '⏳'; btn.disabled = true;
    try {
        const summary = await RAG.buildIndex(contracts, AI_CONFIG, (c, t, s) => { });
        const count = await RAG.exportVectorsAsJS(AI_CONFIG.embeddingModel);
        await CustomDialog.alert('本次成功更新 ' + (summary?.count || 0) + '/' + (summary?.total || 0) + ' 条；失败 ' + (summary?.failed || 0) + ' 条。导出含保留记录共 ' + count + ' 条，仅一致性检查通过的记录参与语义检索。', summary?.failed ? '部分构建失败' : '构建完成');
    } catch (e) { await CustomDialog.alert('构建索引失败: ' + e.message, '构建失败'); }
    finally { btn.innerHTML = orig; btn.disabled = false; }
}

function isEmbeddingConfigured() { return AI_CONFIG.embeddingEndpoint && AI_CONFIG.embeddingApiKey && AI_CONFIG.embeddingModel; }

// 关键词搜索（通用版）
const keywordTranslation = {
    '工期': 'time', '延期': 'extension', '索赔': 'claim', '变更': 'variation', '付款': 'payment',
    '终止': 'termination', '暂停': 'suspension', '缺陷': 'defect', '分包': 'subcontract',
    '争议': 'dispute', '仲裁': 'arbitration', '保险': 'insurance', '验收': 'acceptance',
    '承包商': 'contractor', '工程师': 'engineer', '竣工': 'completion', '材料': 'materials'
};

function extractKeywords(query) {
    const clausePatterns = [/clause\s*(\d+)/gi, /第\s*(\d+)\s*条/gi, /条款\s*(\d+)/gi];
    const clauseNumbers = []; clausePatterns.forEach(p => { let m; while ((m = p.exec(query)) !== null) clauseNumbers.push(m[1]); });
    Object.keys(contracts).forEach(key => { const regex = new RegExp(key + '\\s*(\\d+)', 'gi'); let m; while ((m = regex.exec(query)) !== null) clauseNumbers.push(m[1]); });
    let translatedKeywords = [];
    for (const [cn, en] of Object.entries(keywordTranslation)) { if (query.includes(cn)) translatedKeywords.push(...en.toLowerCase().split(' ')); }
    const stopWords = ['the', 'a', 'an', 'is', 'are', 'to', 'of', 'in', 'for', 'on', 'and', 'but', 'or', 'not', 'what', 'which', 'how', 'why', '的', '是', '在', '有', '和', '与', '或', '了', '什么', '怎么', '请', '我', '你'];
    const words = query.toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !stopWords.includes(w));
    Object.keys(contracts).forEach(key => { const idx = words.indexOf(key.toLowerCase()); if (idx !== -1) words.splice(idx, 1); });

    // \u4ece\u4ea4\u53c9\u5f15\u7528\u5173\u952e\u8bcd\u7d22\u5f15\u8865\u5145\u6761\u6b3e\u76f8\u5173\u5173\u952e\u8bcd\uff08\u7528\u4e8e cross-ref.js \u7684 findByCrossRef\uff09
    if (typeof GCC_CLAUSE_KEYWORD_INDEX !== 'undefined') {
        for (const word of words) {
            if (GCC_CLAUSE_KEYWORD_INDEX[word.toLowerCase()]) {
                translatedKeywords.push(word.toLowerCase());
            }
        }
    }

    return { clauseNumbers: [...new Set(clauseNumbers)], keywords: [...new Set([...translatedKeywords, ...words])] };
}

async function findRelevantClauses(query, historyOverride) {
    const start = hasContextBreak ? contextBreakIndex : 0;
    lastRetrievalEvidence = await AIRetrieval.retrieve(query, contracts, AI_CONFIG, {
        history: historyOverride || chatMessages.slice(start), signal: typeof abortController !== 'undefined' ? abortController?.signal : undefined
    });
    window.assistantRetrievalDiagnostic = lastRetrievalEvidence.diagnostic;
    return lastRetrievalEvidence.clauses;
}

console.log('[ai-assistant.js] AI管理助手核心加载完成');
