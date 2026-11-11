// The toolbar and its results float above the contract workspace.
(() => {
    const toolbar = document.getElementById('floatingToolbar');
    const moreMenu = document.getElementById('selectionMoreMenu');
    const moreGroup = moreMenu.parentElement;
    const toolbarOptions = [...toolbar.querySelectorAll('[data-toolbar-option]')].map(node => {
        const { toolbarOption: id, toolbarLabel: label, toolbarDefault } = node.dataset;
        const trigger = node.matches('button') ? node : node.querySelector('[data-menu]');
        const overflow = document.createElement('button');
        overflow.type = 'button';
        for (const key of ['action', 'format', 'menu']) {
            if (trigger.dataset[key]) overflow.dataset[key] = trigger.dataset[key];
        }
        const menu = document.getElementById(trigger.dataset.menu);
        overflow.textContent = menu ? `${label} ▸` : label;
        if (menu) {
            overflow.setAttribute('aria-controls', menu.id);
            overflow.setAttribute('aria-expanded', 'false');
        }
        return { id, label, defaultPinned: toolbarDefault !== 'more', node, menu, overflow };
    });
    const panel = document.getElementById('selectionResultPanel');
    const filters = document.getElementById('selectionResultFilters');
    const results = document.getElementById('selectionResultList');
    const searchInput = document.querySelector('.search-input');
    const reviewButton = document.getElementById('openReviewTags');
    const reviewLabels = ['待确认', '风险点', '待谈判', '重要义务'];
    const parsedText = document.createElement('template');
    let selected = null;
    let openMenu = null;
    let resultMode = null;
    let search = null;
    let reviewFilter = '';
    let highlightTimer;
    let markedClause;

    const normalText = text => text.replace(/\s+/g, ' ').trim();

    function plainText(html) {
        parsedText.innerHTML = String(html || '').replace(/<br\b[^>]*>|<\/(?:p|div|h[1-6]|li|td|th|tr|blockquote)>/gi, '$&\n');
        return parsedText.content.textContent.trim();
    }

    function clauseLabel(id, clause) {
        const title = normalText(plainText(clause?.title));
        return '第 ' + id + ' 条' + (title && title !== id ? ' · ' + title : '');
    }

    function makeButton(text, action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.addEventListener('click', action);
        return button;
    }

    function fillPalette(id, format, colors) {
        const menu = document.getElementById(id);
        for (const [name, hex] of colors) {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'color-swatch';
            swatch.style.backgroundColor = hex;
            swatch.title = name;
            swatch.setAttribute('aria-label', name);
            swatch.dataset.format = format;
            swatch.dataset.color = hex;
            menu.append(swatch);
        }
    }

    fillPalette('highlightMenu', 'hiliteColor', [
        ['浅橙', '#FFCC80'], ['浅绿', '#CCFF90'], ['浅蓝', '#81D4FA'], ['浅紫', '#CE93D8'],
        ['浅黄', '#FFF59D'], ['浅粉', '#F8BBD0'], ['浅青', '#80CBC4'], ['浅灰', '#E0E0E0']
    ]);
    fillPalette('fontColorMenu', 'foreColor', [
        ['红色', '#E74C3C'], ['黄色', '#F1C40F'], ['蓝色', '#3498DB'], ['紫色', '#9B59B6']
    ]);

    function textOffset(root, node, offset) {
        const prefix = document.createRange();
        prefix.selectNodeContents(root);
        prefix.setEnd(node, offset);
        return prefix.toString().length;
    }

    function textRange(root, start, end) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        let node;
        let offset = 0;
        let hasStart = false;
        while ((node = walker.nextNode())) {
            const limit = offset + node.length;
            if (!hasStart && start < limit) {
                range.setStart(node, start - offset);
                hasStart = true;
            }
            if (hasStart && end <= limit) {
                range.setEnd(node, end - offset);
                return range;
            }
            offset = limit;
        }
        return null;
    }

    function captureSelection() {
        if (!activeContractKey || isAssistantMode) return null;
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!text || !selection.rangeCount) return null;
        const range = selection.getRangeAt(0);
        const first = getClauseTextForNode(range.startContainer);
        const last = getClauseTextForNode(range.endContainer);
        const main = document.getElementById('panelMain');
        if (!first || !last || !main.contains(first) || !main.contains(last)) return null;
        return {
            key: activeContractKey, range: range.cloneRange(), text,
            first, last, clauseText: first === last ? first : null
        };
    }

    function selectionIsCurrent(snapshot) {
        return snapshot?.key === activeContractKey && snapshot.first.isConnected && snapshot.last.isConnected &&
            getClauseTextForNode(snapshot.range.startContainer) === snapshot.first &&
            getClauseTextForNode(snapshot.range.endContainer) === snapshot.last &&
            !snapshot.range.collapsed;
    }

    function closeMenu() {
        if (!openMenu) return;
        openMenu.hidden = true;
        toolbar.querySelector('[aria-controls="' + openMenu.id + '"]')?.setAttribute('aria-expanded', 'false');
        openMenu = null;
    }

    function hideToolbar() {
        closeMenu();
        toolbar.style.display = 'none';
        selected = null;
    }

    function refreshToolbar() {
        hideToolbar();
        for (const option of toolbarOptions) {
            const { node, menu, overflow } = option;
            if (window.GeneralSettings.isToolbarPinned(option)) {
                overflow.remove();
                toolbar.insertBefore(node, moreGroup);
                if (menu) node.append(menu);
            } else {
                node.remove();
                moreMenu.append(overflow);
                // 子菜单替换「更多」面板，使用同一个定位锚点。
                if (menu) moreGroup.append(menu);
            }
        }
    }

    function show() {
        const snapshot = captureSelection();
        if (!snapshot) { hideToolbar(); return; }
        closeMenu();
        selected = snapshot;
        toolbar.querySelectorAll('[data-format], [data-action="note"], [data-action="clear-format"], [data-menu="selectionTagMenu"]')
            .forEach(button => { button.disabled = !snapshot.clauseText; });
        toolbar.querySelector('[data-action="delete-note"]').hidden = !getNoteInSelection(snapshot);
        moreGroup.hidden = [...moreMenu.children].every(button => button.hidden);

        const rect = snapshot.range.getClientRects()[0] || snapshot.range.getBoundingClientRect();
        toolbar.style.display = 'flex';
        const above = rect.top - toolbar.offsetHeight - 8;
        const below = above < 8;
        const center = rect.left + rect.width / 2;
        const left = Math.max(8, Math.min(center - toolbar.offsetWidth / 2, window.innerWidth - toolbar.offsetWidth - 8));
        toolbar.classList.toggle('below-selection', below);
        toolbar.style.top = Math.min(window.innerHeight - toolbar.offsetHeight - 8, below ? rect.bottom + 8 : above) + 'px';
        toolbar.style.left = left + 'px';
        toolbar.style.setProperty('--toolbar-pointer', Math.max(14, Math.min(center - left, toolbar.offsetWidth - 14)) + 'px');
    }

    function toggleMenu(button) {
        const menu = document.getElementById(button.dataset.menu);
        const wasOpen = menu === openMenu;
        closeMenu();
        if (wasOpen) return;
        if (menu.id === 'selectionTagMenu') renderTagMenu();
        menu.style.removeProperty('--selection-menu-shift');
        menu.classList.remove('opens-up');
        menu.hidden = false;
        const rect = menu.getBoundingClientRect();
        const shift = Math.max(0, 8 - rect.left) - Math.max(0, rect.right - window.innerWidth + 8);
        menu.style.setProperty('--selection-menu-shift', shift + 'px');
        if (rect.bottom > window.innerHeight - 8 && toolbar.getBoundingClientRect().top > rect.height + 8) {
            menu.classList.add('opens-up');
        }
        button.setAttribute('aria-expanded', 'true');
        openMenu = menu;
        if (menu.id === 'selectionTagMenu') menu.querySelector('button')?.focus({ preventScroll: true });
    }

    function excerptSources(snapshot) {
        const contract = contracts[snapshot.key];
        const bodies = snapshot.clauseText ? [snapshot.clauseText] :
            [...document.querySelectorAll('#panelMain .clause-text')].filter(body => snapshot.range.intersectsNode(body));
        return bodies.flatMap(body => {
            const id = body.parentElement.id.slice('clause-'.length);
            const part = document.createRange();
            part.selectNodeContents(body);
            if (body === snapshot.first) part.setStart(snapshot.range.startContainer, snapshot.range.startOffset);
            if (body === snapshot.last) part.setEnd(snapshot.range.endContainer, snapshot.range.endOffset);
            const fragment = document.createElement('div');
            fragment.append(part.cloneContents());
            const text = snapshot.clauseText ? snapshot.text : plainText(fragment.innerHTML);
            return text ? [{ text, source: '《' + (contract.title || snapshot.key) + '》 · ' + clauseLabel(id, contract.data[id]) }] : [];
        });
    }

    async function copySelection(snapshot, withSource) {
        const text = withSource ? excerptSources(snapshot).map(part => part.text + '\n——' + part.source).join('\n\n') : snapshot.text;
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
            await navigator.clipboard.writeText(text);
        } catch {
            const field = document.createElement('textarea');
            field.className = 'selection-copy-buffer';
            field.value = text;
            document.body.append(field);
            field.select();
            let copied;
            try { copied = document.execCommand('copy'); }
            catch { copied = false; }
            finally { field.remove(); }
            if (!copied) { showError('无法访问剪贴板。'); return; }
        }
        showSuccess(withSource ? '已复制文字和出处' : '已复制所选文字');
    }

    async function prepareAI(snapshot, instruction) {
        const context = excerptSources(snapshot).map(part => '【' + part.source + '】\n' + part.text).join('\n\n');
        await switchToAssistant();
        if (!isAssistantMode) return;
        const input = document.getElementById('chatInput');
        if (input.disabled || input.readOnly) {
            showError('请先切换到可编辑的 AI 对话。');
            return;
        }
        const prompt = instruction + '：\n\n' + context;
        input.value = input.value.trim() ? input.value + '\n\n' + prompt : prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
    }

    function formatSelection(snapshot, format, color) {
        const { range, clauseText } = snapshot;
        if (!clauseText) return;
        clauseText.focus({ preventScroll: true });
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('styleWithCSS', false, true);
        document.execCommand(format, false, color || null);
        handleEditorMutation(clauseText);
    }

    // Preserve other inline markup, including notes, when clearing part of a formatted run.
    function clearFormatting(snapshot) {
        const { range, clauseText } = snapshot;
        if (!clauseText) return;
        const start = textOffset(clauseText, range.startContainer, range.startOffset);
        const end = textOffset(clauseText, range.endContainer, range.endOffset);
        const names = ['background-color', 'font-weight', 'color'];
        const elements = clauseText.querySelectorAll('b, strong, font, span[style], em[style], i[style], u[style], a[style], mark[style]');
        const value = (el, name) => el.style.getPropertyValue(name) ||
            (name === 'font-weight' && el.matches('b, strong') ? 'bold' : '') ||
            (name === 'color' && el.tagName === 'FONT' ? el.getAttribute('color') : '');
        for (const el of elements) {
            const properties = names.filter(name => value(el, name));
            if (!properties.length) continue;
            const at = textOffset(clauseText, el, 0);
            if (at >= end || at + el.textContent.length <= start) continue;
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            const nodes = [];
            while (walker.nextNode()) nodes.push(walker.currentNode);
            let offset = at;
            for (const node of nodes) {
                const length = node.length;
                const before = Math.max(0, Math.min(length, start - offset));
                const after = Math.max(0, Math.min(length, end - offset));
                offset += length;
                if (!before && after === length) continue;
                const wrapper = document.createElement('span');
                for (const name of properties) {
                    let ancestor = node.parentElement;
                    while (ancestor !== el && !value(ancestor, name)) ancestor = ancestor.parentElement;
                    if (ancestor === el) wrapper.style.setProperty(name, value(el, name), el.style.getPropertyPriority(name));
                }
                if (!wrapper.style.length) continue;
                if (after < length) {
                    const suffix = after ? node.splitText(after) : node;
                    const styled = wrapper.cloneNode(false);
                    suffix.before(styled);
                    styled.append(suffix);
                }
                if (before && after) {
                    if (before < node.length) node.splitText(before);
                    node.before(wrapper);
                    wrapper.append(node);
                }
            }
            for (const name of properties) el.style.removeProperty(name);
            if (!el.style.length) el.removeAttribute('style');
            if (el.tagName === 'FONT') el.removeAttribute('color');
            if (el.matches('b, strong')) {
                const span = document.createElement('span');
                for (const attr of el.attributes) span.setAttribute(attr.name, attr.value);
                span.append(...el.childNodes);
                el.replaceWith(span);
                if (!span.attributes.length) span.replaceWith(...span.childNodes);
            } else if (el.tagName === 'SPAN' && !el.attributes.length) {
                el.replaceWith(...el.childNodes);
            }
        }
        clauseText.normalize();
        window.getSelection().removeAllRanges();
        handleEditorMutation(clauseText);
    }

    function tagsFor(clause) {
        return Array.isArray(clause?.reviewTags) ? clause.reviewTags.filter(item =>
            item?.anchor?.kind === 'text' && typeof item.anchor.quote === 'string' &&
            Array.isArray(item.labels) && item.labels.some(label => reviewLabels.includes(label))) : [];
    }

    function tagSelection() {
        const { range, clauseText } = selected;
        const id = clauseText.parentElement.id.slice('clause-'.length);
        const text = clauseText.textContent;
        const start = textOffset(clauseText, range.startContainer, range.startOffset);
        const end = textOffset(clauseText, range.endContainer, range.endOffset);
        const entries = tagsFor(fullClauseDatabase[id]);
        const matches = entries.filter(entry => {
            const offset = resolveBookmarkOffset(text, entry.anchor);
            return offset !== null && start >= offset && end <= offset + entry.anchor.quote.length;
        });
        const entry = matches.find(item => item.anchor.quote.length === end - start) || (matches.length === 1 ? matches[0] : null);
        const anchor = entry?.anchor || {
            kind: 'text', offset: start, quote: text.slice(start, end),
            prefix: text.slice(Math.max(0, start - 32), start),
            suffix: text.slice(end, end + 32)
        };
        return { id, anchor, entries, entry };
    }

    function renderTagMenu() {
        const menu = document.getElementById('selectionTagMenu');
        menu.replaceChildren();
        for (const label of reviewLabels) {
            const button = makeButton(label, () => {
                if (!selectionIsCurrent(selected)) { hideToolbar(); return; }
                const { id, anchor, entries, entry } = tagSelection();
                const labels = entry?.labels || [];
                const next = labels.includes(label) ? labels.filter(value => value !== label) : [...labels, label];
                const updated = entries.filter(item => item !== entry);
                if (next.length) updated.push({ anchor, labels: next });
                updateClauseReviewTags(id, updated);
                if (resultMode === 'tags') renderResults();
                renderTagMenu();
                menu.querySelector('[data-review-label="' + label + '"]')?.focus({ preventScroll: true });
            });
            button.dataset.reviewLabel = label;
            button.setAttribute('aria-label', label);
            button.setAttribute('aria-pressed', String(tagSelection().entry?.labels.includes(label) === true));
            menu.append(button);
        }
    }

    function clearResultHighlight() {
        clearTimeout(highlightTimer);
        window.CSS?.highlights?.delete('selection-result');
        markedClause?.classList.remove('selection-result-target');
        markedClause = null;
    }

    function highlightResult(range, clause) {
        clearResultHighlight();
        if (range && window.Highlight && window.CSS?.highlights) {
            CSS.highlights.set('selection-result', new Highlight(range));
        } else {
            markedClause = clause;
            clause.classList.add('selection-result-target');
        }
        highlightTimer = setTimeout(clearResultHighlight, 3000);
    }

    function patternFor(term, space = '\\s+') {
        return new RegExp(term.split(' ').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(space), 'iu');
    }

    function jumpToResult(key, id, match) {
        if (!isContractVisible(key)) return;
        hideToolbar();
        switchContract(key);
        requestAnimationFrame(() => {
            if (activeContractKey !== key || isAssistantMode) return;
            const clause = document.getElementById('clause-' + id);
            const body = clause?.querySelector('.clause-text');
            if (!body) return;
            let range;
            if (match.anchor) {
                const offset = resolveBookmarkOffset(body.textContent, match.anchor);
                if (offset !== null) range = textRange(body, offset, offset + match.anchor.quote.length);
                else showStatus('warning', '摘录原文已变化，已定位到所属条款。');
            } else {
                const element = match.inTitle ? clause.querySelector('h2') : body;
                const found = element && (patternFor(match.term).exec(element.textContent) ||
                    patternFor(match.term, '\\s*').exec(element.textContent));
                if (found) range = textRange(element, found.index, found.index + found[0].length);
            }
            scrollToClause(id);
            const rect = range?.getClientRects()[0];
            if (rect) {
                const main = document.getElementById('panelMain');
                main.scrollTop += rect.top - main.getBoundingClientRect().top - 36;
            }
            highlightResult(range, clause);
        });
    }

    function positionPanel() {
        if (!resultMode) return;
        const anchor = searchInput.parentElement.getBoundingClientRect();
        const top = Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - 180));
        panel.style.top = top + 'px';
        panel.style.left = Math.max(8, Math.min(anchor.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
        panel.style.maxHeight = Math.max(140, window.innerHeight - top - 12) + 'px';
    }

    function renderResults() {
        if (!resultMode) return;
        const list = document.createDocumentFragment();
        const term = search && normalText(search.term);
        const isSearch = resultMode === 'search';
        const keys = isSearch && search.scope === 'current' ? [activeContractKey] :
            [activeContractKey, ...getOrderedContractKeys({ visibleOnly: true }).filter(key => key !== activeContractKey)];
        let count = 0;
        for (const key of keys) {
            if (!isContractVisible(key)) continue;
            const contract = contracts[key];
            const group = document.createElement('section');
            const heading = document.createElement('h3');
            heading.textContent = contract.title || key;
            group.append(heading);
            for (const [id, clause] of Object.entries(contract.data || {})) {
                if (isSearch && term) {
                    const text = normalText(plainText(clause.content));
                    const title = normalText(plainText(clause.title));
                    const index = text.toLowerCase().indexOf(term.toLowerCase());
                    const inTitle = index < 0 && title.toLowerCase().includes(term.toLowerCase());
                    if (index < 0 && !inTitle) continue;
                    const from = Math.max(0, index - 28);
                    const to = from + Math.max(120, term.length + 46);
                    const excerpt = (from ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
                    group.append(resultButton(key, id, clause, excerpt, { term, inTitle }));
                    count++;
                } else if (!isSearch) {
                    for (const entry of tagsFor(clause)) {
                        if (reviewFilter && !entry.labels.includes(reviewFilter)) continue;
                        const button = resultButton(key, id, clause, entry.anchor.quote, { anchor: entry.anchor });
                        const labels = document.createElement('small');
                        labels.className = 'selection-result-labels';
                        labels.textContent = entry.labels.join(' · ');
                        button.append(labels);
                        group.append(button);
                        count++;
                    }
                }
            }
            if (group.children.length > 1) list.append(group);
        }
        if (!count) {
            const empty = document.createElement('p');
            empty.className = 'selection-results-empty';
            empty.textContent = isSearch ? (term ? '没有找到匹配条款。' : '输入要搜索的文字。') : '没有符合条件的审阅标签。';
            list.append(empty);
        }
        results.replaceChildren(list);
        positionPanel();
    }

    function resultButton(key, id, clause, excerpt, match) {
        const button = makeButton('', () => jumpToResult(key, id, match));
        button.className = 'selection-result-item';
        const title = document.createElement('strong');
        title.textContent = clauseLabel(id, clause);
        const summary = document.createElement('span');
        summary.textContent = normalText(excerpt);
        button.append(title, summary);
        return button;
    }

    function closeResults() {
        if (search) {
            searchInput.value = searchStatePerContract[activeContractKey] || '';
            toggleSearchClear(searchInput);
        }
        resultMode = null;
        search = null;
        panel.hidden = true;
        reviewButton.setAttribute('aria-expanded', 'false');
        clearResultHighlight();
    }

    function openResults(mode, text = '') {
        closeResults();
        if (!activeContractKey || isAssistantMode) return;
        resultMode = mode;
        const isSearch = mode === 'search';
        panel.hidden = false;
        document.getElementById('selectionResultTitle').textContent = isSearch ? '选区搜索' : '审阅标签';
        reviewButton.setAttribute('aria-expanded', String(!isSearch));
        filters.replaceChildren();
        if (isSearch) {
            const nav = document.getElementById('panelNav');
            if (window.innerWidth <= 768 ? !nav.classList.contains('visible') : nav.classList.contains('collapsed')) toggleNav();
            searchStatePerContract[activeContractKey] = searchInput.value;
            search = { term: normalText(text), scope: 'current' };
            searchInput.value = search.term;
            toggleSearchClear(searchInput);
            for (const [scope, label] of [['current', '当前合同'], ['all', '全部可见合同']]) {
                const button = makeButton(label, () => {
                    search.scope = scope;
                    [...filters.children].forEach(item => item.setAttribute('aria-pressed', String(item === button)));
                    renderResults();
                });
                button.setAttribute('aria-pressed', String(scope === search.scope));
                if (scope === 'all') button.title = '搜索合同管理中设为可见的已导入合同';
                filters.append(button);
            }
            searchInput.focus();
            searchInput.select();
        } else {
            const filter = document.createElement('select');
            filter.setAttribute('aria-label', '按审阅标签筛选');
            filter.append(new Option('全部标签', ''));
            reviewLabels.forEach(label => filter.append(new Option(label, label)));
            filter.value = reviewFilter;
            filter.addEventListener('change', () => {
                reviewFilter = filter.value;
                renderResults();
            });
            filters.append(filter);
        }
        renderResults();
    }

    toolbar.addEventListener('mousedown', event => event.preventDefault());
    toolbar.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        const snapshot = selected;
        if (!selectionIsCurrent(snapshot)) { hideToolbar(); return; }
        const { menu, action, ai, format, color } = button.dataset;
        if (menu) { toggleMenu(button); return; }
        // Review toggles have their own handlers and keep the menu open.
        if (!action && !ai && !format) return;
        hideToolbar();
        if (format) formatSelection(snapshot, format, color);
        if (ai) prepareAI(snapshot, ai);
        if (action === 'copy-source' || action === 'copy-text') copySelection(snapshot, action === 'copy-source');
        if (action === 'search') openResults('search', snapshot.text);
        if (action === 'note' && snapshot.clauseText) addOrEditNote(snapshot);
        if (action === 'delete-note') deleteNote(getNoteInSelection(snapshot));
        if (action === 'clear-format') clearFormatting(snapshot);
    });

    reviewButton.addEventListener('click', () => {
        if (resultMode === 'tags') closeResults();
        else openResults('tags');
    });
    panel.querySelector('[data-close-results]').addEventListener('click', () => {
        const focus = resultMode === 'tags' ? reviewButton : searchInput;
        closeResults();
        focus.focus({ preventScroll: true });
    });
    document.addEventListener('pointerdown', event => {
        if (selected && !toolbar.contains(event.target)) hideToolbar();
    });
    document.addEventListener('keyup', event => {
        if (event.shiftKey && event.target.closest?.('.clause-text')) show();
    });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        if (openMenu) closeMenu();
        else if (selected) hideToolbar();
        else if (resultMode) closeResults();
    });
    document.getElementById('panelMain').addEventListener('scroll', hideToolbar);
    window.addEventListener('resize', () => { hideToolbar(); positionPanel(); });

    window.SelectionTools = {
        show,
        refreshToolbar,
        toolbarOptions: toolbarOptions.map(({ id, label, defaultPinned }) => ({ id, label, defaultPinned })),
        visibilityChanged: renderResults,
        searchActive: () => !!search,
        updateSearch(term) {
            if (!search) return false;
            search.term = term;
            renderResults();
            return true;
        },
        contractChanged() {
            hideToolbar();
            clearResultHighlight();
            if (search) {
                searchInput.value = search.term;
                toggleSearchClear(searchInput);
            }
            renderResults();
        },
        leaveContract() { hideToolbar(); closeResults(); },
        afterUndo() { hideToolbar(); clearResultHighlight(); renderResults(); }
    };
    refreshToolbar();
})();
