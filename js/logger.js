// =======================================================
// logger.js - 运行日志模块 (Rotating Log System)
// HK Contract Manager V5.8
// =======================================================
//
// 使用 localStorage 实现双文件轮转日志系统：
// - 两个日志槽位 (slot0 / slot1)，每个上限 512KB
// - 当前槽位写满后切换到另一个槽位并清空重新写入
// - 自动记录时间戳、日志级别、模块来源
// - 支持在控制台查看和导出日志
//
// 使用方式：
//   Logger.info('app', '页面加载完成');
//   Logger.warn('cloud', '同步失败', { error: err.message });
//   Logger.error('rag', 'IndexedDB 打开失败', error);
// =======================================================

const Logger = (() => {
    // ==================== 配置 ====================
    const CONFIG = {
        SLOT_KEYS: ['HK_LOG_SLOT_0', 'HK_LOG_SLOT_1'],  // localStorage 键名
        META_KEY: 'HK_LOG_META',                          // 元数据键名
        MAX_SLOT_SIZE: 512 * 1024,                        // 每个槽位上限 512KB
        MAX_SINGLE_ENTRY: 2048,                           // 单条日志最大字符数
        LEVELS: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
        MIN_LEVEL: 1,  // 最低记录级别：0=DEBUG, 1=INFO, 2=WARN, 3=ERROR
    };

    // ==================== 元数据管理 ====================

    /**
     * 获取日志元数据
     * @returns {{ activeSlot: number, slotSizes: number[] }}
     */
    function getMeta() {
        try {
            const raw = localStorage.getItem(CONFIG.META_KEY);
            if (raw) {
                const meta = JSON.parse(raw);
                return {
                    activeSlot: meta.activeSlot || 0,
                    slotSizes: meta.slotSizes || [0, 0]
                };
            }
        } catch (e) { /* 忽略解析错误 */ }
        return { activeSlot: 0, slotSizes: [0, 0] };
    }

    /**
     * 保存日志元数据
     */
    function saveMeta(meta) {
        try {
            localStorage.setItem(CONFIG.META_KEY, JSON.stringify(meta));
        } catch (e) { /* 忽略存储错误 */ }
    }

    // ==================== 核心日志写入 ====================

    /**
     * 格式化时间戳
     * @returns {string} 如 "2026-02-20 23:05:26.123"
     */
    function formatTimestamp() {
        const now = new Date();
        const pad = (n, len = 2) => String(n).padStart(len, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
            `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
    }

    /**
     * 将额外数据序列化为字符串
     */
    function serializeExtra(extra) {
        if (extra === undefined || extra === null) return '';
        if (extra instanceof Error) {
            return ` | ${extra.message}${extra.stack ? '\n' + extra.stack : ''}`;
        }
        if (typeof extra === 'object') {
            try {
                const str = JSON.stringify(extra);
                return ` | ${str.length > 500 ? str.substring(0, 500) + '...(truncated)' : str}`;
            } catch (e) {
                return ` | [Object: serialize failed]`;
            }
        }
        return ` | ${String(extra)}`;
    }

    /**
     * 写入一条日志
     * @param {number} levelIdx - 级别索引
     * @param {string} module - 模块名
     * @param {string} message - 日志消息
     * @param {*} [extra] - 附加数据
     */
    function writeLog(levelIdx, module, message, extra) {
        // 级别过滤
        if (levelIdx < CONFIG.MIN_LEVEL) return;

        const level = CONFIG.LEVELS[levelIdx];
        const timestamp = formatTimestamp();
        const extraStr = serializeExtra(extra);

        // 构造日志行
        let entry = `[${timestamp}] [${level}] [${module}] ${message}${extraStr}\n`;

        // 截断过长的单条日志
        if (entry.length > CONFIG.MAX_SINGLE_ENTRY) {
            entry = entry.substring(0, CONFIG.MAX_SINGLE_ENTRY - 20) + '...(truncated)\n';
        }

        const entrySize = new Blob([entry]).size;

        try {
            const meta = getMeta();
            let slotIdx = meta.activeSlot;
            let currentSize = meta.slotSizes[slotIdx] || 0;

            // 检查当前槽位是否会超出上限
            if (currentSize + entrySize > CONFIG.MAX_SLOT_SIZE) {
                // 切换到另一个槽位
                const nextSlot = slotIdx === 0 ? 1 : 0;

                // 清空目标槽位
                localStorage.setItem(CONFIG.SLOT_KEYS[nextSlot], '');

                // 更新元数据
                meta.activeSlot = nextSlot;
                meta.slotSizes[nextSlot] = 0;
                slotIdx = nextSlot;
                currentSize = 0;

                // 在新槽位写入切换标记
                const marker = `[${formatTimestamp()}] [INFO] [logger] === 日志轮转：切换到 Slot ${nextSlot} (Slot ${slotIdx === 0 ? 1 : 0} 已归档) ===\n`;
                localStorage.setItem(CONFIG.SLOT_KEYS[slotIdx], marker);
                currentSize = new Blob([marker]).size;
            }

            // 写入日志
            const currentLog = localStorage.getItem(CONFIG.SLOT_KEYS[slotIdx]) || '';
            localStorage.setItem(CONFIG.SLOT_KEYS[slotIdx], currentLog + entry);

            // 更新大小记录
            meta.slotSizes[slotIdx] = currentSize + entrySize;
            saveMeta(meta);

        } catch (e) {
            // localStorage 已满或其他存储错误 - 静默失败
            // 尝试在控制台输出
            console.warn('[Logger] 日志写入失败:', e.message);
        }
    }

    // ==================== 拦截原生 console ====================

    /**
     * 拦截 console.error 和 console.warn
     * 自动将浏览器控制台的错误/警告也记录到日志中
     */
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    console.error = function (...args) {
        originalConsoleError.apply(console, args);
        try {
            const message = args.map(a => {
                if (a instanceof Error) return a.message;
                if (typeof a === 'object') return JSON.stringify(a).substring(0, 300);
                return String(a);
            }).join(' ');
            writeLog(3, 'console', message);
        } catch (e) { /* 静默失败 */ }
    };

    console.warn = function (...args) {
        originalConsoleWarn.apply(console, args);
        try {
            const message = args.map(a => {
                if (typeof a === 'object') return JSON.stringify(a).substring(0, 300);
                return String(a);
            }).join(' ');
            writeLog(2, 'console', message);
        } catch (e) { /* 静默失败 */ }
    };

    // ==================== 全局错误捕获 ====================

    window.addEventListener('error', (event) => {
        writeLog(3, 'global', `未捕获错误: ${event.message}`, {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        writeLog(3, 'global', `未处理的 Promise 拒绝: ${message}`);
    });

    // ==================== 公开 API ====================

    return {
        /**
         * 记录调试级别日志
         */
        debug(module, message, extra) {
            writeLog(0, module, message, extra);
        },

        /**
         * 记录信息级别日志
         */
        info(module, message, extra) {
            writeLog(1, module, message, extra);
        },

        /**
         * 记录警告级别日志
         */
        warn(module, message, extra) {
            writeLog(2, module, message, extra);
        },

        /**
         * 记录错误级别日志
         */
        error(module, message, extra) {
            writeLog(3, module, message, extra);
        },

        /**
         * 获取所有日志内容（按时间顺序拼接两个槽位）
         * @returns {string} 完整日志文本
         */
        getAll() {
            const meta = getMeta();
            const inactiveSlot = meta.activeSlot === 0 ? 1 : 0;
            const older = localStorage.getItem(CONFIG.SLOT_KEYS[inactiveSlot]) || '';
            const newer = localStorage.getItem(CONFIG.SLOT_KEYS[meta.activeSlot]) || '';
            return older + newer;
        },

        /**
         * 获取当前活动槽位的日志
         * @returns {string}
         */
        getCurrent() {
            const meta = getMeta();
            return localStorage.getItem(CONFIG.SLOT_KEYS[meta.activeSlot]) || '';
        },

        /**
         * 导出日志为文件下载
         */
        export() {
            const content = this.getAll();
            if (!content.trim()) {
                console.log('[Logger] 日志为空，无需导出');
                return;
            }
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const now = new Date();
            const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
            a.href = url;
            a.download = `HK_Contract_Log_${dateStr}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log(`[Logger] 日志已导出: ${a.download}`);
        },

        /**
         * 在控制台中打印所有日志
         */
        print() {
            const content = this.getAll();
            if (!content.trim()) {
                console.log('[Logger] 日志为空');
                return;
            }
            console.log('====== HK Contract Manager 运行日志 ======\n' + content);
        },

        /**
         * 获取日志状态信息
         * @returns {{ activeSlot: number, slot0Size: string, slot1Size: string, totalEntries: number }}
         */
        status() {
            const meta = getMeta();
            const slot0 = localStorage.getItem(CONFIG.SLOT_KEYS[0]) || '';
            const slot1 = localStorage.getItem(CONFIG.SLOT_KEYS[1]) || '';
            const slot0Lines = slot0 ? slot0.split('\n').filter(l => l.trim()).length : 0;
            const slot1Lines = slot1 ? slot1.split('\n').filter(l => l.trim()).length : 0;
            const info = {
                activeSlot: meta.activeSlot,
                slot0Size: `${(new Blob([slot0]).size / 1024).toFixed(1)} KB (${slot0Lines} 条)`,
                slot1Size: `${(new Blob([slot1]).size / 1024).toFixed(1)} KB (${slot1Lines} 条)`,
                maxSlotSize: `${CONFIG.MAX_SLOT_SIZE / 1024} KB`,
                totalEntries: slot0Lines + slot1Lines
            };
            console.table(info);
            return info;
        },

        /**
         * 清空所有日志
         */
        clear() {
            localStorage.removeItem(CONFIG.SLOT_KEYS[0]);
            localStorage.removeItem(CONFIG.SLOT_KEYS[1]);
            saveMeta({ activeSlot: 0, slotSizes: [0, 0] });
            console.log('[Logger] 所有日志已清空');
        }
    };
})();

// 暴露给全局
window.Logger = Logger;
