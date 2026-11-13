(function () {
    'use strict';

    const STORAGE_KEY = 'gcm_assistant_skills';
    const MAX_FILE_BYTES = 32 * 1024;
    const byId = id => document.getElementById(id);
    const input = byId('chatInput');
    const picker = byId('assistantSkillPicker');
    const filter = byId('assistantSkillFilter');
    const options = byId('assistantSkillOptions');
    const pickerButton = byId('btnAssistantSkill');
    const manager = byId('assistantSkillManager');
    const managerButton = byId('btnAssistantSkillManager');
    const status = byId('assistantSkillManagerStatus');
    const upload = byId('assistantSkillFile');
    const library = byId('assistantSkillLibrary');
    const review = byId('assistantSkillReview');
    const installButton = byId('btnConfirmAssistantSkill');
    const topicId = () => window.AssistantTopics?.getCurrentTopicId() || 'legacy';

    const selections = new Map();
    let installed = [];
    let pending = null;
    let uninstallId = null;
    let working = false;
    let storageError = null;
    let mode = null;
    let slashStart = 0;
    let choices = [];
    let active = 0;

    function button(label, action) {
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'assistant-btn';
        control.textContent = label;
        control.addEventListener('click', action);
        return control;
    }

    function resolve(reference) {
        if (!reference) return null;
        return installed.find(skill => skill.enabled && skill.id === reference.id && skill.version === reference.version) || null;
    }

    function selected(id = topicId()) {
        return resolve(selections.get(id));
    }

    function setSelection(id, skill) {
        if (resolve(skill)) selections.set(id, { id: skill.id, version: skill.version });
        else selections.delete(id);
        updateButton();
    }

    function updateButton() {
        const skill = selected();
        pickerButton.textContent = skill ? 'Skill：' + skill.name : 'Skill';
        pickerButton.title = skill ? '本轮 Skill：' + skill.name : '选择本轮 Skill（也可在空格后输入 /）';
        pickerButton.classList.toggle('active', !!skill);
        pickerButton.disabled = input.readOnly;
        if (input.readOnly) closePicker();
    }

    function renderLibrary(focusId) {
        library.replaceChildren();
        if (!installed.length && !storageError) {
            const empty = document.createElement('li');
            empty.textContent = '尚未安装 Skill。';
            library.append(empty);
        }
        for (const skill of installed) {
            const row = document.createElement('li');
            const name = document.createElement('strong');
            name.textContent = skill.name;
            const description = document.createElement('p');
            description.textContent = skill.description;
            const details = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = '查看指令';
            const instructions = document.createElement('pre');
            instructions.textContent = skill.instructions;
            details.append(summary, instructions);

            const actions = document.createElement('div');
            actions.className = 'assistant-skill-actions';
            if (uninstallId === skill.id) {
                actions.append(
                    button('取消卸载', () => { uninstallId = null; renderLibrary(skill.id); }),
                    button('确认卸载', () => save(installed.filter(item => item.id !== skill.id), '已卸载 ' + skill.name))
                );
            } else {
                actions.append(
                    button(skill.enabled ? '停用' : '启用', () => save(installed.map(item =>
                        item.id === skill.id ? { ...item, enabled: !skill.enabled } : item),
                    skill.enabled ? '已停用 ' + skill.name : '已启用 ' + skill.name, skill.id)),
                    button('卸载', () => { if (!working) { uninstallId = skill.id; renderLibrary(skill.id); } })
                );
            }
            row.append(name, description, details, actions);
            library.append(row);
            if (focusId === skill.id) actions.firstElementChild.focus();
        }
    }

    async function save(next, message, focusId) {
        if (working || storageError) return;
        working = true;
        try {
            await localforage.setItem(STORAGE_KEY, next);
            installed = next;
            for (const [id, ref] of selections) if (!resolve(ref)) selections.delete(id);
            clearReview();
            uninstallId = null;
            status.textContent = message;
            byId('btnImportAssistantSkill').focus();
            renderLibrary(focusId);
            updateButton();
        } catch (error) {
            status.textContent = '无法保存 Skill。请检查浏览器存储后重试。';
            console.warn('Skill 保存失败', error);
        } finally {
            working = false;
        }
    }

    function clearReview() {
        pending = null;
        review.hidden = true;
    }

    async function readSkill(file) {
        if (!/\.skill\.json$/i.test(file.name)) throw new Error('请选择 .skill.json 文件。');
        if (file.size > MAX_FILE_BYTES) throw new Error('Skill 文件不能超过 32 KiB。');
        let data;
        try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())); }
        catch { throw new Error('无法读取 Skill。请使用 UTF-8 编码的 JSON 文件。'); }
        if (data?.formatVersion !== 1) throw new Error('Skill 的 formatVersion 必须为 1。');
        if (typeof data.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.id) || data.id.length > 64) {
            throw new Error('Skill 的 id 必须由小写字母、数字和连字符组成，最多 64 字符。');
        }
        const fields = { name: 80, description: 500, instructions: 12000 };
        const skill = { id: data.id };
        for (const [field, max] of Object.entries(fields)) {
            const value = typeof data[field] === 'string' ? data[field].trim() : '';
            if (!value || value.length > max) throw new Error(field + ' 必填，最多 ' + max + ' 字符。');
            skill[field] = value;
        }
        return skill;
    }

    async function previewFile(file) {
        if (!file || working || storageError) return;
        working = true;
        clearReview();
        status.textContent = '正在读取 Skill…';
        try {
            const skill = await readSkill(file);
            const existing = installed.find(item => item.id === skill.id);
            if (existing && Object.keys(skill).every(key => skill[key] === existing[key])) {
                status.textContent = '已安装相同的 Skill。';
                return;
            }
            pending = { ...skill, enabled: existing?.enabled ?? true, version: messageUid() };
            byId('assistantSkillReviewName').textContent = skill.name;
            byId('assistantSkillReviewDescription').textContent = skill.description;
            byId('assistantSkillReviewInstructions').textContent = skill.instructions;
            status.textContent = existing ? '已安装「' + existing.name + '」。请确认是否替换。' : '请检查指令，再安装 Skill。';
            installButton.textContent = existing ? '替换' : '安装';
            review.hidden = false;
        } catch (error) {
            status.textContent = error.message;
        } finally {
            working = false;
        }
    }

    function closePicker() {
        mode = null;
        picker.hidden = true;
        pickerButton.setAttribute('aria-expanded', 'false');
        filter.setAttribute('aria-expanded', 'false');
        for (const control of [input, filter]) control.removeAttribute('aria-activedescendant');
    }

    function highlight(scroll = false) {
        for (const [index, option] of Array.from(options.children).entries()) {
            option.setAttribute('aria-selected', String(index === active));
        }
        const option = options.children[active];
        const control = mode === 'slash' ? input : filter;
        if (option) control.setAttribute('aria-activedescendant', option.id);
        else control.removeAttribute('aria-activedescendant');
        if (scroll) option?.scrollIntoView({ block: 'nearest' });
    }

    function renderOptions(query) {
        const match = query.trim().toLowerCase();
        choices = installed.filter(skill => skill.enabled &&
            (skill.name.toLowerCase().includes(match) || skill.id.includes(match)));
        if (mode === 'button' && !match && selected()) choices.push(null);
        options.replaceChildren();
        active = 0;
        choices.forEach((skill, index) => {
            const option = document.createElement('div');
            option.id = 'assistantSkillOption-' + index;
            option.setAttribute('role', 'option');
            option.textContent = skill?.name || '不使用 Skill';
            option.addEventListener('mousedown', event => event.preventDefault());
            option.addEventListener('click', () => choose(index));
            options.append(option);
        });
        const feedback = byId('assistantSkillPickerStatus');
        feedback.textContent = storageError || (match ? '没有匹配的 Skill。' : '没有可用的 Skill。可在「Skill 管理」中安装或启用。');
        feedback.hidden = choices.length > 0;
        highlight();
    }

    function openPicker(nextMode) {
        closePicker();
        mode = nextMode;
        picker.hidden = false;
        const buttonMode = mode === 'button';
        filter.hidden = !buttonMode;
        byId('assistantSkillFilterLabel').hidden = !buttonMode;
        filter.value = '';
        pickerButton.setAttribute('aria-expanded', String(buttonMode));
        filter.setAttribute('aria-expanded', String(buttonMode));
        renderOptions('');
        if (buttonMode) filter.focus();
    }

    function choose(index) {
        if (index >= choices.length || !mode) return;
        const skill = choices[index];
        if (mode === 'slash') {
            const query = slashQuery();
            closePicker();
            if (query === null) return;
            input.setRangeText('', slashStart, input.selectionStart, 'end');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        } else closePicker();
        setSelection(topicId(), skill);
        input.focus();
    }

    function handleKeydown(event) {
        if (!mode || event.isComposing || event.keyCode === 229) return false;
        if (event.key === 'Tab' || (mode === 'slash' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))) {
            closePicker();
            return false;
        }
        if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key) || (event.key === 'Enter' && event.shiftKey)) return false;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') {
            const fromButton = mode === 'button';
            closePicker();
            if (fromButton) pickerButton.focus();
        } else if (event.key === 'Enter') {
            if (!event.repeat && choices.length) choose(active);
        } else if (choices.length) {
            active = (active + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
            highlight(true);
        }
        return true;
    }

    function slashQuery() {
        if (input.selectionStart !== input.selectionEnd) return null;
        const token = input.value.slice(slashStart, input.selectionStart);
        return /^\/[^/\r\n]*$/.test(token) ? token.slice(1) : null;
    }

    function updateSlashFilter() {
        const query = slashQuery();
        if (query === null) closePicker();
        else renderOptions(query);
    }

    input.addEventListener('input', event => {
        if (input.readOnly || event.isComposing) return;
        if (mode === 'slash') {
            updateSlashFilter();
            return;
        }
        const beforeCaret = input.value.slice(0, input.selectionStart);
        if (event.inputType === 'insertText' && event.data === '/' && /(?:^|[ \u3000])\/$/.test(beforeCaret)) {
            slashStart = input.selectionStart - 1;
            openPicker('slash');
        }
    });
    input.addEventListener('compositionend', () => { if (mode === 'slash') updateSlashFilter(); });
    input.addEventListener('click', closePicker);
    filter.addEventListener('input', () => renderOptions(filter.value));
    filter.addEventListener('keydown', handleKeydown);
    document.addEventListener('pointerdown', event => {
        if (mode && !picker.contains(event.target) && !pickerButton.contains(event.target) && event.target !== input) closePicker();
    });

    pickerButton.addEventListener('click', async () => {
        await ready;
        if (input.readOnly) return;
        if (mode === 'button') closePicker();
        else openPicker('button');
    });

    managerButton.addEventListener('click', async () => {
        await ready;
        closePicker();
        status.textContent = storageError || '';
        renderLibrary();
        manager.showModal();
    });
    byId('btnCloseAssistantSkillManager').addEventListener('click', () => { if (!working) manager.close(); });
    manager.addEventListener('cancel', event => { if (working) event.preventDefault(); });
    manager.addEventListener('close', () => { clearReview(); uninstallId = null; });
    byId('btnImportAssistantSkill').addEventListener('click', () => { if (!working && !storageError) upload.click(); });
    upload.addEventListener('change', () => {
        const file = upload.files[0];
        upload.value = '';
        previewFile(file);
    });
    byId('btnCancelAssistantSkill').addEventListener('click', () => {
        if (working) return;
        clearReview();
        status.textContent = '';
        byId('btnImportAssistantSkill').focus();
    });
    installButton.addEventListener('click', () => {
        if (!pending) return;
        const next = installed.filter(item => item.id !== pending.id).concat(pending);
        save(next, installButton.textContent === '替换' ? '已替换 ' + pending.name : '已安装 ' + pending.name, pending.id);
    });

    const ready = localforage.getItem(STORAGE_KEY).then(value => {
        installed = Array.isArray(value) ? value : [];
        if (mode === 'slash') updateSlashFilter();
    }).catch(error => {
        storageError = '无法读取本机 Skill。请检查浏览器存储后重新加载。';
        byId('btnImportAssistantSkill').disabled = true;
        console.warn('Skill 读取失败', error);
    });

    window.AssistantSkills = Object.freeze({
        selected, setSelection, updateButton, closePicker, handleKeydown,
        resolveInstalled: async reference => { await ready; return resolve(reference); }
    });
})();
