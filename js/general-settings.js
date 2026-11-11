// 本机浏览器中的通用偏好。
window.GeneralSettings = (() => {
    const storageKey = 'gcm_general_settings';
    const notificationModes = ['silent', 'normal', 'all'];
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem(storageKey)) || {};
    } catch {
        // 无法读取时使用默认布局和通知形式。
    }

    const notificationMode = () => notificationModes.includes(saved.notificationMode) ? saved.notificationMode : 'all';
    const isToolbarPinned = ({ id, defaultPinned }) => {
        const pinned = saved.toolbar?.[id];
        return typeof pinned === 'boolean' ? pinned : defaultPinned;
    };

    function loadForm() {
        const options = window.SelectionTools.toolbarOptions.map(option => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = option.id;
            checkbox.checked = isToolbarPinned(option);
            label.append(checkbox, option.label);
            return label;
        });
        document.getElementById('toolbarSettingsOptions').replaceChildren(...options);
        document.getElementById('settingNotificationMode').value = notificationMode();
    }

    function saveForm() {
        const checkboxes = [...document.querySelectorAll('#toolbarSettingsOptions input')];
        if (!checkboxes.length) return;
        const toolbar = Object.fromEntries(checkboxes.map(checkbox => [checkbox.value, checkbox.checked]));
        const toolbarChanged = window.SelectionTools.toolbarOptions.some(option =>
            toolbar[option.id] !== isToolbarPinned(option));
        const mode = document.getElementById('settingNotificationMode').value;
        const modeChanged = mode !== notificationMode();
        if (!toolbarChanged && !modeChanged) return;

        const next = { toolbar, notificationMode: mode };
        localStorage.setItem(storageKey, JSON.stringify(next));
        saved = next;
        if (toolbarChanged) window.SelectionTools.refreshToolbar();
        if (modeChanged) window.StatusCenter.refreshNotifications();
    }

    return { notificationMode, isToolbarPinned, loadForm, saveForm };
})();
