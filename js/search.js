// =======================================================
// search.js - 全文搜索模块
// HK Contract Manager V5.2
// =======================================================

// 注意：以下变量在 app.js 中已定义
// currentSearchTerm, searchHighlights

/**
 * 过滤导航栏
 */
function filterNav(term) {
    term = term.trim().toLowerCase();
    currentSearchTerm = term;

    // 清除之前的高亮
    clearSearchHighlights();

    // 空搜索词：重置显示
    if (term === '') {
        initBookmarks();
        updateSearchStatus(0, 0);
        return;
    }

    // 执行全文搜索
    const searchResults = performFullTextSearch(term);

    // 更新书签列表显示
    const items = document.querySelectorAll('.nav-item');
    items.forEach(item => {
        const clauseId = item.querySelector('.label-text')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        if (clauseId && searchResults.has(clauseId)) {
            item.classList.remove('hidden');
            // 标记匹配位置（标题或正文）
            const matchInfo = searchResults.get(clauseId);
            if (matchInfo.inContent && !matchInfo.inTitle) {
                item.classList.add('search-content-match');
            } else {
                item.classList.remove('search-content-match');
            }
        } else {
            item.classList.add('hidden');
        }
    });

    // 更新搜索状态
    updateSearchStatus(searchResults.size, Object.keys(fullClauseDatabase).length);

    // 高亮显示匹配内容
    highlightSearchResults(term);
}

/**
 * 执行全文搜索
 * @param {string} term - 搜索词
 * @returns {Map} 匹配结果 clauseId -> {inTitle, inContent}
 */
function performFullTextSearch(term) {
    const results = new Map();

    Object.keys(fullClauseDatabase).forEach(id => {
        const clause = fullClauseDatabase[id];
        const title = (clause.title || '').toLowerCase();
        const content = (clause.content || '').toLowerCase();
        // 去除 HTML 标签后搜索
        const plainContent = content.replace(/<[^>]*>/g, ' ');

        const inTitle = title.includes(term);
        const inContent = plainContent.includes(term);

        if (inTitle || inContent) {
            results.set(id, { inTitle, inContent });
        }
    });

    return results;
}

/**
 * 高亮显示搜索结果
 */
function highlightSearchResults(term) {
    if (!term) return;

    const panelMain = document.getElementById('panelMain');
    if (!panelMain) return;

    // 遍历所有条款文本
    const clauseTexts = panelMain.querySelectorAll('.clause-text');
    clauseTexts.forEach(textEl => {
        highlightInElement(textEl, term);
    });

    // 也高亮标题
    const titles = panelMain.querySelectorAll('h2');
    titles.forEach(titleEl => {
        highlightInElement(titleEl, term);
    });
}

/**
 * 在元素中高亮搜索词（使用正则替换所有匹配项）
 */
function highlightInElement(element, term) {
    // 跳过已经处理过的元素
    if (element.dataset.highlighted === 'true') return;

    const html = element.innerHTML;
    // 转义正则特殊字符
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 创建不区分大小写的正则表达式，匹配所有出现
    const regex = new RegExp(`(${escapedTerm})`, 'gi');

    // 检测是否有匹配
    if (!regex.test(html)) return;

    // 替换所有匹配项（需要避免替换 HTML 标签内的内容）
    const newHtml = highlightTextOnly(html, term);

    if (newHtml !== html) {
        element.innerHTML = newHtml;
        element.dataset.highlighted = 'true';
        // 收集新创建的高亮元素
        element.querySelectorAll('.search-highlight').forEach(span => {
            searchHighlights.push(span);
        });
    }
}

/**
 * 只高亮纯文本部分，避免破坏 HTML 标签
 */
function highlightTextOnly(html, term) {
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedTerm})`, 'gi');

    // 将 HTML 按标签和文本分割
    const parts = [];
    let lastIndex = 0;
    const tagRegex = /<[^>]+>/g;
    let tagMatch;

    while ((tagMatch = tagRegex.exec(html)) !== null) {
        // 添加标签前的文本
        if (tagMatch.index > lastIndex) {
            const text = html.substring(lastIndex, tagMatch.index);
            // 高亮文本部分
            parts.push(text.replace(regex, '<span class="search-highlight">$1</span>'));
        }
        // 添加标签本身（不处理）
        parts.push(tagMatch[0]);
        lastIndex = tagMatch.index + tagMatch[0].length;
    }

    // 添加最后一段文本
    if (lastIndex < html.length) {
        const text = html.substring(lastIndex);
        parts.push(text.replace(regex, '<span class="search-highlight">$1</span>'));
    }

    return parts.join('');
}

/**
 * 清除搜索高亮
 */
function clearSearchHighlights() {
    // 清除高亮标记
    document.querySelectorAll('[data-highlighted="true"]').forEach(el => {
        delete el.dataset.highlighted;
    });

    // 清除所有高亮 span
    document.querySelectorAll('.search-highlight').forEach(span => {
        if (span.parentNode) {
            const text = document.createTextNode(span.textContent);
            span.parentNode.replaceChild(text, span);
        }
    });

    searchHighlights = [];

    // 清除正文匹配标记
    document.querySelectorAll('.search-content-match').forEach(el => {
        el.classList.remove('search-content-match');
    });
}

/**
 * 更新搜索状态显示
 */
function updateSearchStatus(found, total) {
    if (found > 0) {
        showStatus('info', `找到 ${found} 条`, '🔍', 0);
    } else if (currentSearchTerm) {
        showStatus('warning', '无匹配', '🔍', 0);
    } else {
        showStatus('success', '就绪', '✓', 0);
    }
}

/**
 * 跳转到第一个搜索结果
 */
function jumpToFirstResult() {
    const firstHighlight = document.querySelector('.search-highlight');
    if (firstHighlight) {
        firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/**
 * 切换搜索清除按钮的显示/隐藏
 */
function toggleSearchClear(input) {
    const clearBtn = input.parentElement.querySelector('.search-clear');
    if (clearBtn) {
        clearBtn.classList.toggle('visible', input.value.length > 0);
    }
}

/**
 * 清除搜索输入框内容
 */
function clearSearchInput(clearBtn) {
    const input = clearBtn.parentElement.querySelector('.search-input');
    if (input) {
        input.value = '';
        input.focus();
        clearBtn.classList.remove('visible');
        filterNav('');
    }
}
