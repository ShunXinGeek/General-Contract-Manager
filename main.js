const { app, BrowserWindow, Menu, ipcMain, globalShortcut, Tray, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let tray = null;
let appSettings = {
    minimizeToTray: false,
    globalShortcutEnabled: false,
    globalShortcutKeys: '',
    alwaysOnTop: false,
    autoCheckUpdates: false,
    hardwareAcceleration: true
};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        icon: path.join(__dirname, 'build/icon.ico'), // Will use default if this path doesn't exist.
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
            // enable web security for real environments, but since it's local static, let's keep default
        }
    });

    // Remove the default Windows top menu bar for a cleaner app look
    Menu.setApplicationMenu(null);

    // Apply initial always on top
    if (appSettings.alwaysOnTop) {
        mainWindow.setAlwaysOnTop(true);
    }

    // Load the index.html of the app.
    mainWindow.loadFile('index.html');

    // Handle minimize to tray
    mainWindow.on('close', (event) => {
        if (appSettings.minimizeToTray) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function setupTray() {
    if (!tray) {
        tray = new Tray(path.join(__dirname, 'build/icon.ico')); // Assuming you have an icon
        const contextMenu = Menu.buildFromTemplate([
            { label: '显示窗口', click: () => { mainWindow.show(); } },
            {
                label: '退出', click: () => {
                    appSettings.minimizeToTray = false; // Bypass the close preventDefault
                    app.quit();
                }
            }
        ]);
        tray.setToolTip('通用合同管理助手');
        tray.setContextMenu(contextMenu);
        tray.on('double-click', () => {
            mainWindow.show();
        });
    }
}

function registerGlobalShortcut() {
    globalShortcut.unregisterAll();
    if (appSettings.globalShortcutEnabled && appSettings.globalShortcutKeys) {
        try {
            globalShortcut.register(appSettings.globalShortcutKeys, () => {
                if (mainWindow.isVisible()) {
                    mainWindow.hide();
                } else {
                    mainWindow.show();
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.focus();
                }
            });
        } catch (error) {
            console.error('Failed to register global shortcut:', error);
        }
    }
}

// Request single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    // Check Hardware acceleration before app is ready
    const configPath = path.join(app.getPath('userData'), 'general_config.json');
    try {
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            appSettings = { ...appSettings, ...config };
            if (!appSettings.hardwareAcceleration) {
                app.disableHardwareAcceleration();
            }
        }
    } catch (e) {
        console.error('Failed to read config before ready', e);
    }

    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        createWindow();

        if (appSettings.minimizeToTray) {
            setupTray();
        }

        registerGlobalShortcut();

        if (appSettings.autoCheckUpdates) {
            autoUpdater.checkForUpdatesAndNotify();
        }

        app.on('activate', function () {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    // Unregister all shortcuts.
    globalShortcut.unregisterAll();
});

// IPC handlers
ipcMain.handle('update-general-settings', (event, newSettings) => {
    const oldSettings = { ...appSettings };
    appSettings = { ...appSettings, ...newSettings };

    // Save to disk so we can read it before app starts (for hardware acceleration)
    const configPath = path.join(app.getPath('userData'), 'general_config.json');
    fs.writeFileSync(configPath, JSON.stringify(appSettings, null, 2));

    // Apply Tray
    if (appSettings.minimizeToTray && !oldSettings.minimizeToTray) {
        setupTray();
    } else if (!appSettings.minimizeToTray && oldSettings.minimizeToTray && tray) {
        tray.destroy();
        tray = null;
    }

    // Apply Always On Top
    if (mainWindow) {
        mainWindow.setAlwaysOnTop(appSettings.alwaysOnTop);
    }

    // Apply Global Shortcut
    if (appSettings.globalShortcutEnabled !== oldSettings.globalShortcutEnabled ||
        appSettings.globalShortcutKeys !== oldSettings.globalShortcutKeys) {
        registerGlobalShortcut();
    }

    // Hardware acceleration UI is handled by restarting, but we saved it.

    return true;
});

ipcMain.handle('check-for-updates', async (event) => {
    if (mainWindow) {
        mainWindow.webContents.send('update-message', { status: 'checking', text: '正在检查更新...' });
    }
    try {
        await autoUpdater.checkForUpdates();
        return true;
    } catch (error) {
        if (mainWindow) {
            mainWindow.webContents.send('update-message', { status: 'error', text: '检查更新失败: ' + error.message });
        }
        return false;
    }
});

// Auto Updater events
autoUpdater.on('update-available', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-message', { status: 'available', text: '发现新版本，正在下载...' });
});

autoUpdater.on('update-not-available', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-message', { status: 'not-available', text: '当前已经是最新版本。' });
});

autoUpdater.on('error', (err) => {
    if (mainWindow) mainWindow.webContents.send('update-message', { status: 'error', text: '检查更新时发生错误。' });
});

autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) mainWindow.webContents.send('update-message', { status: 'downloaded', text: '新版本下载完成，将在下次重启时安装。' });
    // Optionally automatically install: autoUpdater.quitAndInstall();
});
