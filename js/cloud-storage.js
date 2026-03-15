// ==================== CLOUD STORAGE MODULE (FIREBASE VERSION) ====================
/**
 * Firebase 云存储模块
 * HK Contract Management 云备份功能
 * 支持邮箱密码登录和自动双向同步
 */

// ==================== 全局变量 ====================
let db = null;
let auth = null;
let currentUser = null;
let initialized = false;
let autoSyncTimer = null;
let lastLocalModified = 0;          // 本地最后修改时间戳

// 状态常量
const CloudStatus = {
    NOT_INITIALIZED: 'NOT_INITIALIZED',
    LOADING: 'LOADING',
    READY: 'READY',
    OFFLINE: 'OFFLINE',
    ERROR: 'ERROR'
};

let currentStatus = CloudStatus.NOT_INITIALIZED;

// ==================== 本地时间戳管理 ====================
const LOCAL_TIMESTAMP_KEY = 'HK_Contract_LastModified';

/**
 * 获取本地最后修改时间
 */
function getLocalModifiedTime() {
    const stored = localStorage.getItem(LOCAL_TIMESTAMP_KEY);
    return stored ? parseInt(stored, 10) : 0;
}

/**
 * 更新本地修改时间戳
 */
function updateLocalModificationTime() {
    lastLocalModified = Date.now();
    localStorage.setItem(LOCAL_TIMESTAMP_KEY, lastLocalModified.toString());
    console.log('本地修改时间已更新:', new Date(lastLocalModified).toLocaleString());
}

// ==================== Firebase 初始化 ====================

/**
 * 检查 Firebase SDK 是否已加载
 */
function checkFirebaseSDK() {
    return typeof firebase !== 'undefined' && firebase.app;
}

/**
 * 等待 Firebase SDK 加载完成
 */
async function waitForFirebaseSDK(maxWaitTime = 15000) {
    const startTime = Date.now();
    console.log(`等待 Firebase SDK 加载... (最多等待 ${maxWaitTime / 1000} 秒)`);

    return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
            if (checkFirebaseSDK()) {
                console.log('✓ Firebase SDK 加载成功');
                clearInterval(checkInterval);
                resolve(true);
            }
            if (Date.now() - startTime > maxWaitTime) {
                console.warn('⚠ Firebase SDK 加载超时');
                clearInterval(checkInterval);
                resolve(false);
            }
        }, 200);
    });
}

/**
 * 初始化 Firebase
 */
async function initCloudBase() {
    if (initialized) {
        console.log('Firebase 已初始化');
        return true;
    }

    try {
        currentStatus = CloudStatus.LOADING;
        console.log('=== 开始初始化 Firebase ===');

        // 1. 检查配置
        if (!window.FIREBASE_CONFIG) {
            throw new Error('Firebase 配置未找到,请检查 firebase-config.js 文件');
        }

        // 检查是否仍是占位符
        if (window.FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
            console.warn('⚠ Firebase 凭证未配置，云备份功能暂不可用');
            currentStatus = CloudStatus.ERROR;
            return false;
        }

        console.log('✓ 配置文件已加载');
        console.log('  项目ID:', window.FIREBASE_CONFIG.projectId);

        // 2. 等待 SDK 加载
        const sdkLoaded = await waitForFirebaseSDK(15000);
        if (!sdkLoaded) {
            throw new Error('Firebase SDK 加载超时,请检查网络连接或刷新页面');
        }

        // 3. 初始化 Firebase
        if (!firebase.apps.length) {
            firebase.initializeApp(window.FIREBASE_CONFIG);
        }
        console.log('✓ Firebase 应用已创建');

        // 获取 Firestore 和 Auth 实例
        db = firebase.firestore();
        auth = firebase.auth();

        // 设置持久化
        await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        console.log('✓ Firestore 和 Auth 已初始化');

        // 4. 检查登录状态
        const user = await waitForAuthState();
        if (user) {
            currentUser = user;
            console.log('✓ 检测到已登录用户:', currentUser.email);
        } else {
            console.log('  未检测到已登录用户');
        }

        initialized = true;
        currentStatus = CloudStatus.READY;
        console.log('=== Firebase 初始化成功 ===');
        Logger.info('cloud', `Firebase 初始化成功, 用户: ${currentUser ? currentUser.email : '未登录'}`);

        // 5. 启动自动同步
        startAutoSync();

        return true;

    } catch (error) {
        console.error('Firebase 初始化失败:', error);
        Logger.error('cloud', 'Firebase 初始化失败', error);
        currentStatus = CloudStatus.ERROR;
        return false;
    }
}

/**
 * 等待认证状态恢复
 */
function waitForAuthState() {
    return new Promise((resolve) => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            unsubscribe();
            resolve(user);
        });
        setTimeout(() => {
            unsubscribe();
            resolve(null);
        }, 5000);
    });
}

// ==================== 邮箱密码认证 ====================

/**
 * 邮箱密码登录
 */
async function emailLogin(email, password) {
    try {
        if (!auth) {
            throw new Error('Firebase 未初始化');
        }

        console.log('尝试邮箱登录:', email);
        const result = await auth.signInWithEmailAndPassword(email, password);
        currentUser = result.user;

        console.log('✓ 登录成功');
        Logger.info('cloud', `用户登录成功: ${currentUser.email}`);
        console.log('  用户ID:', currentUser.uid);
        console.log('  邮箱:', currentUser.email);

        // 首次登录：先从云端下载数据并应用到本地（云端优先）
        console.log('登录成功，优先从云端下载数据...');
        try {
            const cloudData = await loadFromCloud();
            if (cloudData) {
                applyCloudDataToLocal(cloudData);
                console.log('✓ 云端数据已应用到本地');
            } else {
                console.log('  云端无备份数据，将上传本地数据');
                await saveToCloud();
            }
        } catch (downloadError) {
            console.warn('下载云端数据失败，回退到双向同步:', downloadError);
            await syncWithCloud();
        }

        // 确保自动同步已启动
        startAutoSync();

        return {
            success: true,
            user: {
                uid: currentUser.uid,
                email: currentUser.email
            }
        };

    } catch (error) {
        console.error('登录失败:', error);
        Logger.error('cloud', `用户登录失败: ${email}`, error);
        let message = '登录失败';

        switch (error.code) {
            case 'auth/user-not-found':
                message = '用户不存在，请先注册';
                break;
            case 'auth/wrong-password':
                message = '密码错误';
                break;
            case 'auth/invalid-email':
                message = '邮箱格式不正确';
                break;
            case 'auth/invalid-credential':
                message = '邮箱或密码错误';
                break;
            case 'auth/user-disabled':
                message = '账号已被禁用';
                break;
            case 'auth/too-many-requests':
                message = '登录尝试次数过多，请稍后再试';
                break;
            default:
                message = error.message;
        }

        throw new Error(message);
    }
}

/**
 * 邮箱注册
 */
async function emailRegister(email, password) {
    try {
        if (!auth) {
            throw new Error('Firebase 未初始化');
        }

        console.log('尝试邮箱注册:', email);
        const result = await auth.createUserWithEmailAndPassword(email, password);
        currentUser = result.user;

        console.log('✓ 注册成功');
        console.log('  用户ID:', currentUser.uid);
        console.log('  邮箱:', currentUser.email);

        return {
            success: true,
            user: {
                uid: currentUser.uid,
                email: currentUser.email
            }
        };

    } catch (error) {
        console.error('注册失败:', error);
        let message = '注册失败';

        switch (error.code) {
            case 'auth/email-already-in-use':
                message = '该邮箱已被注册';
                break;
            case 'auth/invalid-email':
                message = '邮箱格式不正确';
                break;
            case 'auth/weak-password':
                message = '密码太弱，至少需要6个字符';
                break;
            case 'auth/operation-not-allowed':
                message = '邮箱注册未启用，请联系管理员';
                break;
            default:
                message = error.message;
        }

        throw new Error(message);
    }
}

/**
 * 退出登录
 */
async function logout() {
    try {
        if (!auth) return;

        console.log('执行退出登录...');
        await auth.signOut();
        currentUser = null;
        stopAutoSync();
        console.log('✓ 已退出登录');
        Logger.info('cloud', '用户已退出登录');

    } catch (error) {
        console.error('退出登录失败:', error);
        throw error;
    }
}

/**
 * 获取当前用户信息
 */
function getCurrentUser() {
    if (!currentUser) return null;
    return {
        uid: currentUser.uid,
        email: currentUser.email
    };
}

/**
 * 检查是否已登录
 */
function isLoggedIn() {
    return currentUser !== null && initialized;
}

// ==================== 数据同步功能 ====================

/**
 * 保存数据到云端
 */
async function saveToCloud() {
    if (!db || !currentUser) {
        throw new Error('未登录，无法保存到云端');
    }

    try {
        // 先同步当前内容到内存
        if (typeof captureCurrentContent === 'function') {
            captureCurrentContent();
        }
        if (typeof contracts !== 'undefined' && typeof activeContractKey !== 'undefined' && typeof savedBookmarks !== 'undefined') {
            contracts[activeContractKey].bookmarks = savedBookmarks;
        }

        // 提取所有修改
        const allModifications = typeof extractAllUserModifications === 'function'
            ? extractAllUserModifications()
            : {};

        // 收集所有书签（如果未初始化则生成默认书签）
        const allBookmarks = {};
        if (typeof contracts !== 'undefined') {
            console.log('  收集书签，合同列表:', Object.keys(contracts));
            Object.keys(contracts).forEach(contractKey => {
                let bookmarks = contracts[contractKey].bookmarks;
                console.log(`  [${contractKey}] 现有书签数:`, bookmarks ? bookmarks.length : 0);

                // 如果该合同的书签未初始化（用户从未访问过），则生成默认书签
                if (!bookmarks || bookmarks.length === 0) {
                    const contractData = contracts[contractKey].data;
                    console.log(`  [${contractKey}] 条款数据条数:`, contractData ? Object.keys(contractData).length : 0);
                    if (contractData && Object.keys(contractData).length > 0) {
                        bookmarks = Object.keys(contractData)
                            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                            .map(id => ({
                                id: id,
                                label: contractData[id].title,
                                uid: Date.now() + Math.random().toString(36).substr(2, 9),
                                level: 0,
                                collapsed: false
                            }));
                        console.log(`  [${contractKey}] 生成默认书签数:`, bookmarks.length);
                    }
                }

                if (bookmarks && bookmarks.length > 0) {
                    allBookmarks[contractKey] = bookmarks;
                    console.log(`  [${contractKey}] 最终书签数:`, bookmarks.length);
                }
            });
        } else {
            console.log('  contracts 未定义!');
        }
        console.log('  所有书签收集完成:', Object.keys(allBookmarks));

        // 准备数据
        const data = {
            user_id: currentUser.uid,
            updated_at: new Date().toISOString(),
            modifications: allModifications,
            bookmarks: allBookmarks,
            theme: typeof currentThemeIndex !== 'undefined' ? currentThemeIndex : 0,
            // [V5.1] 包含 AI 设置
            ai_settings: typeof getAISettingsForCloud === 'function' ? getAISettingsForCloud() : null
        };

        // 保存到 Firestore
        const docRef = db.collection(window.FIREBASE_COLLECTIONS.CONTRACT_MODS).doc(currentUser.uid);
        await docRef.set(data, { merge: true });

        console.log('✓ 数据已保存到云端');
        Logger.info('cloud', `数据已保存到云端, 修改条款数: ${Object.keys(allModifications).reduce((sum, k) => sum + Object.keys(allModifications[k] || {}).length, 0)}`);
        console.log('  修改条款数:', Object.keys(allModifications).reduce((sum, k) => sum + Object.keys(allModifications[k] || {}).length, 0));

        return { success: true, timestamp: data.updated_at };

    } catch (error) {
        console.error('保存到云端失败:', error);
        Logger.error('cloud', '保存到云端失败', error);
        throw error;
    }
}

/**
 * 从云端加载数据
 */
async function loadFromCloud() {
    if (!db || !currentUser) {
        throw new Error('未登录，无法从云端加载');
    }

    try {
        const docRef = db.collection(window.FIREBASE_COLLECTIONS.CONTRACT_MODS).doc(currentUser.uid);
        const doc = await docRef.get();

        if (!doc.exists) {
            console.log('  云端没有备份数据');
            return null;
        }

        const data = doc.data();
        console.log('✓ 从云端加载数据成功');
        console.log('  更新时间:', data.updated_at);

        return data;

    } catch (error) {
        console.error('从云端加载失败:', error);
        throw error;
    }
}

/**
 * 应用云端数据到本地
 */
function applyCloudDataToLocal(cloudData) {
    if (!cloudData) return;

    try {
        // 应用修改
        if (cloudData.modifications && typeof contracts !== 'undefined') {
            Object.keys(cloudData.modifications).forEach(contractKey => {
                if (contracts[contractKey]) {
                    Object.keys(cloudData.modifications[contractKey]).forEach(id => {
                        if (contracts[contractKey].data[id]) {
                            contracts[contractKey].data[id].content = cloudData.modifications[contractKey][id].content;
                        }
                    });
                }
            });
        }

        // 应用书签
        if (cloudData.bookmarks && typeof contracts !== 'undefined') {
            Object.keys(cloudData.bookmarks).forEach(contractKey => {
                if (contracts[contractKey]) {
                    contracts[contractKey].bookmarks = cloudData.bookmarks[contractKey];
                }
            });
        }

        // 刷新当前视图
        if (typeof activeContractKey !== 'undefined' && typeof contracts !== 'undefined') {
            if (typeof fullClauseDatabase !== 'undefined') {
                fullClauseDatabase = contracts[activeContractKey].data;
            }
            if (typeof savedBookmarks !== 'undefined') {
                savedBookmarks = contracts[activeContractKey].bookmarks;
            }
            if (typeof renderMainDocument === 'function') {
                renderMainDocument();
            }
            if (typeof initBookmarks === 'function') {
                initBookmarks();
            }
            if (typeof buildReverseIndex === 'function') {
                buildReverseIndex();
            }
        }

        // 应用主题
        if (typeof cloudData.theme !== 'undefined' && typeof applyTheme === 'function') {
            currentThemeIndex = cloudData.theme;
            applyTheme(currentThemeIndex);
        }

        // [V5.1] 应用 AI 设置
        if (cloudData.ai_settings && typeof applyCloudAISettings === 'function') {
            applyCloudAISettings(cloudData.ai_settings);
        }

        console.log('✓ 云端数据已应用到本地');

    } catch (error) {
        console.error('应用云端数据失败:', error);
        throw error;
    }
}

/**
 * 合并 AI 设置：本地有实质性配置则用本地，否则保留云端
 */
function mergeAISettings(localSettings, cloudSettings) {
    // 如果本地没有任何设置，完全使用云端
    if (!localSettings) return cloudSettings;

    // 检查本地是否有实质性配置（至少有一个模型配置）
    const hasLocalModels = localSettings.models && localSettings.models.length > 0;
    if (!hasLocalModels && cloudSettings?.models?.length > 0) {
        return cloudSettings;
    }

    // 本地有配置，使用本地
    return localSettings;
}

/**
 * 智能双向同步 - 字段级合并策略
 * 逐条款比较本地和云端的修改时间，保留较新的版本
 */
async function syncWithCloud() {
    if (!initialized || !isLoggedIn()) {
        console.log('未登录，跳过同步');
        return { success: false, reason: 'not_logged_in' };
    }

    if (!navigator.onLine) {
        console.log('离线状态，跳过同步');
        return { success: false, reason: 'offline' };
    }

    try {
        console.log('=== 开始智能同步 (字段级合并) ===');

        // 1. 先同步当前内容到内存
        if (typeof captureCurrentContent === 'function') {
            captureCurrentContent();
        }
        if (typeof contracts !== 'undefined' && typeof activeContractKey !== 'undefined' && typeof savedBookmarks !== 'undefined') {
            contracts[activeContractKey].bookmarks = savedBookmarks;
        }

        // 2. 从云端加载数据
        const cloudData = await loadFromCloud();

        // 3. 提取本地修改
        const localModifications = typeof extractAllUserModifications === 'function'
            ? extractAllUserModifications()
            : {};

        // 4. 执行字段级合并
        const mergeResult = mergeFieldLevel(localModifications, cloudData?.modifications || {});

        console.log('  合并结果:',
            `本地较新: ${mergeResult.stats.localNewer}条, `,
            `云端较新: ${mergeResult.stats.cloudNewer}条, `,
            `相同: ${mergeResult.stats.same}条`);

        // 5. 应用云端较新的数据到本地
        if (mergeResult.stats.cloudNewer > 0) {
            applyMergedModifications(mergeResult.cloudNewer);
        }

        // 6. 合并书签（保留更完整的版本）
        const mergedBookmarks = mergeBookmarks(
            collectAllBookmarks(),
            cloudData?.bookmarks || {}
        );

        // 7. 上传合并后的完整数据到云端
        const dataToUpload = {
            user_id: currentUser.uid,
            updated_at: new Date().toISOString(),
            modifications: mergeResult.merged,
            bookmarks: mergedBookmarks,
            theme: typeof currentThemeIndex !== 'undefined' ? currentThemeIndex : 0,
            ai_settings: mergeAISettings(
                typeof getAISettingsForCloud === 'function' ? getAISettingsForCloud() : null,
                cloudData?.ai_settings || null
            )
        };

        const docRef = db.collection(window.FIREBASE_COLLECTIONS.CONTRACT_MODS).doc(currentUser.uid);
        await docRef.set(dataToUpload, { merge: true });

        // 8. 更新本地时间戳
        localStorage.setItem(LOCAL_TIMESTAMP_KEY, Date.now().toString());

        console.log('=== 字段级合并同步完成 ===');
        Logger.info('cloud', `同步完成 - 本地较新:${mergeResult.stats.localNewer}, 云端较新:${mergeResult.stats.cloudNewer}, 相同:${mergeResult.stats.same}`);

        return {
            success: true,
            direction: 'field_merge',
            stats: mergeResult.stats
        };

    } catch (error) {
        console.error('同步失败:', error);
        Logger.error('cloud', '云端同步失败', error);
        return { success: false, error: error.message };
    }
}

/**
 * 字段级合并：比较本地和云端每个条款的修改时间
 * @param {Object} localMods - 本地修改 {contractKey: {clauseId: {content, modifiedAt}}}
 * @param {Object} cloudMods - 云端修改 {contractKey: {clauseId: {content, modifiedAt}}}
 * @returns {Object} 合并结果
 */
function mergeFieldLevel(localMods, cloudMods) {
    const merged = {};
    const cloudNewer = {};  // 云端较新的，需要应用到本地
    const stats = { localNewer: 0, cloudNewer: 0, same: 0 };

    // 获取所有涉及的合同键
    const allContractKeys = new Set([
        ...Object.keys(localMods),
        ...Object.keys(cloudMods)
    ]);

    allContractKeys.forEach(contractKey => {
        merged[contractKey] = {};
        cloudNewer[contractKey] = {};

        const localContract = localMods[contractKey] || {};
        const cloudContract = cloudMods[contractKey] || {};

        // 获取所有涉及的条款ID
        const allClauseIds = new Set([
            ...Object.keys(localContract),
            ...Object.keys(cloudContract)
        ]);

        allClauseIds.forEach(clauseId => {
            const localClause = localContract[clauseId];
            const cloudClause = cloudContract[clauseId];

            const localTime = localClause?.modifiedAt || 0;
            const cloudTime = cloudClause?.modifiedAt || 0;

            if (localTime > cloudTime) {
                // 本地较新
                merged[contractKey][clauseId] = localClause;
                stats.localNewer++;
            } else if (cloudTime > localTime) {
                // 云端较新
                merged[contractKey][clauseId] = cloudClause;
                cloudNewer[contractKey][clauseId] = cloudClause;
                stats.cloudNewer++;
            } else if (localClause) {
                // 时间相同，优先保留本地
                merged[contractKey][clauseId] = localClause;
                stats.same++;
            } else if (cloudClause) {
                // 只有云端有
                merged[contractKey][clauseId] = cloudClause;
                cloudNewer[contractKey][clauseId] = cloudClause;
                stats.cloudNewer++;
            }
        });

        // 清理空对象
        if (Object.keys(merged[contractKey]).length === 0) {
            delete merged[contractKey];
        }
        if (Object.keys(cloudNewer[contractKey]).length === 0) {
            delete cloudNewer[contractKey];
        }
    });

    return { merged, cloudNewer, stats };
}

/**
 * 应用合并后的云端较新数据到本地
 */
function applyMergedModifications(cloudNewerMods) {
    if (!cloudNewerMods || typeof contracts === 'undefined') return;

    Object.keys(cloudNewerMods).forEach(contractKey => {
        if (!contracts[contractKey]) return;

        Object.keys(cloudNewerMods[contractKey]).forEach(clauseId => {
            if (contracts[contractKey].data[clauseId]) {
                const cloudClause = cloudNewerMods[contractKey][clauseId];
                contracts[contractKey].data[clauseId].content = cloudClause.content;
                contracts[contractKey].data[clauseId].modifiedAt = cloudClause.modifiedAt;
            }
        });
    });

    // 刷新当前视图
    if (typeof activeContractKey !== 'undefined') {
        if (typeof fullClauseDatabase !== 'undefined') {
            fullClauseDatabase = contracts[activeContractKey].data;
        }
        if (typeof renderMainDocument === 'function') {
            renderMainDocument();
        }
        if (typeof buildReverseIndex === 'function') {
            buildReverseIndex();
        }
    }

    console.log('✓ 云端较新数据已应用到本地');
}

/**
 * 收集所有书签
 */
function collectAllBookmarks() {
    const allBookmarks = {};
    if (typeof contracts === 'undefined') return allBookmarks;

    Object.keys(contracts).forEach(contractKey => {
        let bookmarks = contracts[contractKey].bookmarks;

        // 如果书签未初始化，生成默认书签
        if (!bookmarks || bookmarks.length === 0) {
            const contractData = contracts[contractKey].data;
            if (contractData && Object.keys(contractData).length > 0) {
                bookmarks = Object.keys(contractData)
                    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                    .map(id => ({
                        id: id,
                        label: contractData[id].title,
                        uid: Date.now() + Math.random().toString(36).substr(2, 9),
                        level: 0,
                        collapsed: false
                    }));
            }
        }

        if (bookmarks && bookmarks.length > 0) {
            allBookmarks[contractKey] = bookmarks;
        }
    });

    return allBookmarks;
}

/**
 * 合并书签：保留更完整的版本
 */
function mergeBookmarks(localBookmarks, cloudBookmarks) {
    const merged = {};

    const allContractKeys = new Set([
        ...Object.keys(localBookmarks),
        ...Object.keys(cloudBookmarks)
    ]);

    allContractKeys.forEach(contractKey => {
        const local = localBookmarks[contractKey] || [];
        const cloud = cloudBookmarks[contractKey] || [];

        // 简单策略：保留更完整（有更多自定义）的版本
        // 检测方法：看是否有 level=1 的子书签或自定义 label
        const localCustomized = local.some(b => b.level === 1 || b.label !== (contracts[contractKey]?.data[b.id]?.title || ''));
        const cloudCustomized = cloud.some(b => b.level === 1);

        if (localCustomized && !cloudCustomized) {
            merged[contractKey] = local;
        } else if (cloudCustomized && !localCustomized) {
            merged[contractKey] = cloud;
            // 同步到本地
            if (contracts[contractKey]) {
                contracts[contractKey].bookmarks = cloud;
            }
        } else if (local.length >= cloud.length) {
            merged[contractKey] = local;
        } else {
            merged[contractKey] = cloud;
            if (contracts[contractKey]) {
                contracts[contractKey].bookmarks = cloud;
            }
        }
    });

    // 刷新书签视图
    if (typeof activeContractKey !== 'undefined' && merged[activeContractKey]) {
        if (typeof savedBookmarks !== 'undefined') {
            savedBookmarks = merged[activeContractKey];
        }
        if (typeof initBookmarks === 'function') {
            initBookmarks();
        }
    }

    return merged;
}

/**
 * 强制上传到云端（用于本地导入后）
 */
async function forceUploadToCloud() {
    if (!initialized || !isLoggedIn()) {
        console.log('未登录，跳过上传');
        return false;
    }

    try {
        console.log('=== 强制上传到云端 ===');
        updateLocalModificationTime();
        await saveToCloud();
        console.log('✓ 强制上传完成');
        return true;
    } catch (error) {
        console.error('强制上传失败:', error);
        return false;
    }
}

// ==================== 自动同步 ====================

/**
 * 启动自动同步
 */
function startAutoSync() {
    if (autoSyncTimer) {
        clearInterval(autoSyncTimer);
    }

    const interval = (window.FIREBASE_SECURITY?.syncInterval || 5) * 60 * 1000;

    autoSyncTimer = setInterval(() => {
        if (isLoggedIn() && navigator.onLine) {
            console.log('[自动同步] 执行中...');
            syncWithCloud();
        }
    }, interval);

    console.log(`✓ 自动同步已启动，间隔: ${interval / 60000} 分钟`);
}

/**
 * 停止自动同步
 */
function stopAutoSync() {
    if (autoSyncTimer) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
        console.log('自动同步已停止');
    }
}

// ==================== 云备份 UI ====================

/**
 * 打开云备份对话框
 */
function openCloudBackup() {
    // 检查 Firebase 是否初始化
    if (!initialized) {
        // 检查配置是否有效
        if (!window.FIREBASE_CONFIG || window.FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
            alert('⚠️ Firebase 未配置\n\n请先在 "AI 设置 -> Firebase 配置设置" 中配置您的 Firebase 项目凭证。');
            return;
        }
    }

    // 如果已登录，显示同步选项
    if (isLoggedIn()) {
        showSyncDialog();
    } else {
        // 未登录，显示登录对话框
        showLoginDialog();
    }
}

/**
 * 显示登录对话框
 */
function showLoginDialog() {
    const modal = document.createElement('div');
    modal.id = 'cloudLoginModal';
    modal.innerHTML = `
        <div style="position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000;">
            <div style="background:white; padding:30px; border-radius:12px; width:350px; box-shadow:0 10px 40px rgba(0,0,0,0.3);">
                <h3 style="margin:0 0 20px 0; text-align:center;">☁️ 云备份登录</h3>
                
                <div id="loginForm">
                    <input type="email" id="cloudEmail" placeholder="邮箱地址" style="width:100%; padding:12px; margin-bottom:12px; border:1px solid #ddd; border-radius:8px; box-sizing:border-box; font-size:14px;">
                    <input type="password" id="cloudPassword" placeholder="密码" style="width:100%; padding:12px; margin-bottom:20px; border:1px solid #ddd; border-radius:8px; box-sizing:border-box; font-size:14px;">
                    
                    <button onclick="handleCloudLogin()" style="width:100%; padding:12px; background:#3498db; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px; margin-bottom:10px;">登录</button>
                    <button onclick="handleCloudRegister()" style="width:100%; padding:12px; background:#27ae60; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px;">注册新账号</button>
                </div>
                
                <button onclick="closeCloudModal()" style="width:100%; padding:10px; background:#eee; border:none; border-radius:8px; cursor:pointer; margin-top:15px; font-size:14px;">取消</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

/**
 * 显示同步对话框
 */
function showSyncDialog() {
    const user = getCurrentUser();
    const modal = document.createElement('div');
    modal.id = 'cloudLoginModal';
    modal.innerHTML = `
        <div style="position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000;">
            <div style="background:white; padding:30px; border-radius:12px; width:350px; box-shadow:0 10px 40px rgba(0,0,0,0.3);">
                <h3 style="margin:0 0 10px 0; text-align:center;">☁️ 云备份</h3>
                <p style="text-align:center; color:#666; margin-bottom:20px;">已登录: ${user.email}</p>
                
                <button onclick="handleManualSync()" style="width:100%; padding:12px; background:#3498db; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px; margin-bottom:10px;">🔄 立即同步</button>
                <button onclick="handleForceUpload()" style="width:100%; padding:12px; background:#27ae60; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px; margin-bottom:10px;">📤 上传本地数据</button>
                <button onclick="handleForceDownload()" style="width:100%; padding:12px; background:#9b59b6; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px; margin-bottom:10px;">📥 下载云端数据</button>
                <button onclick="handleCloudLogout()" style="width:100%; padding:12px; background:#e74c3c; color:white; border:none; border-radius:8px; cursor:pointer; font-size:14px;">退出登录</button>
                
                <button onclick="closeCloudModal()" style="width:100%; padding:10px; background:#eee; border:none; border-radius:8px; cursor:pointer; margin-top:15px; font-size:14px;">关闭</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

/**
 * 关闭云备份模态框
 */
function closeCloudModal() {
    const modal = document.getElementById('cloudLoginModal');
    if (modal) modal.remove();
}

/**
 * 处理登录
 */
async function handleCloudLogin() {
    const email = document.getElementById('cloudEmail').value.trim();
    const password = document.getElementById('cloudPassword').value;

    if (!email || !password) {
        alert('请输入邮箱和密码');
        return;
    }

    try {
        await emailLogin(email, password);
        closeCloudModal();
        alert('✓ 登录成功！\n\n云备份功能已启用，每5分钟自动同步一次。');
    } catch (error) {
        alert('登录失败：' + error.message);
    }
}

/**
 * 处理注册
 */
async function handleCloudRegister() {
    const email = document.getElementById('cloudEmail').value.trim();
    const password = document.getElementById('cloudPassword').value;

    if (!email || !password) {
        alert('请输入邮箱和密码');
        return;
    }

    if (password.length < 6) {
        alert('密码至少需要6个字符');
        return;
    }

    try {
        await emailRegister(email, password);
        closeCloudModal();
        alert('✓ 注册成功！\n\n云备份功能已启用，每5分钟自动同步一次。');
    } catch (error) {
        alert('注册失败：' + error.message);
    }
}

/**
 * 处理退出登录
 */
async function handleCloudLogout() {
    try {
        await logout();
        closeCloudModal();
        alert('已退出登录');
    } catch (error) {
        alert('退出失败：' + error.message);
    }
}

/**
 * 处理手动同步
 */
async function handleManualSync() {
    try {
        closeCloudModal();
        const result = await syncWithCloud();
        if (result.success) {
            if (result.direction === 'field_merge' && result.stats) {
                // 字段级合并结果
                const { localNewer, cloudNewer, same } = result.stats;
                alert(`✓ 智能合并完成\n\n` +
                    `📤 本地较新: ${localNewer} 条\n` +
                    `📥 云端较新: ${cloudNewer} 条\n` +
                    `🔄 无变化: ${same} 条\n\n` +
                    `两端数据已自动合并，保留了每个条款的最新版本。`);
            } else {
                const directionText = {
                    'local_to_cloud': '本地 → 云端',
                    'cloud_to_local': '云端 → 本地',
                    'no_change': '数据已同步'
                };
                alert(`✓ 同步完成\n\n${directionText[result.direction] || '同步完成'}`);
            }
        } else {
            alert('同步失败：' + (result.reason || result.error || '未知错误'));
        }
    } catch (error) {
        alert('同步失败：' + error.message);
    }
}

/**
 * 处理强制上传
 */
async function handleForceUpload() {
    const isUpload = await CustomDialog.confirm('确定要将本地数据上传到云端吗？\n这将覆盖云端的数据。');
    if (!isUpload) return;

    try {
        closeCloudModal();
        await forceUploadToCloud();
        await CustomDialog.alert('✓ 本地数据已上传到云端', '强制上传');
    } catch (error) {
        await CustomDialog.alert('上传失败：' + error.message, '错误');
    }
}

/**
 * 处理强制下载
 */
async function handleForceDownload() {
    const isDownload = await CustomDialog.confirm('确定要下载云端数据吗？\n这将覆盖本地的修改。');
    if (!isDownload) return;

    try {
        closeCloudModal();
        const cloudData = await loadFromCloud();
        if (cloudData) {
            applyCloudDataToLocal(cloudData);
            localStorage.setItem(LOCAL_TIMESTAMP_KEY, new Date(cloudData.updated_at).getTime().toString());
            await CustomDialog.alert('✓ 云端数据已下载到本地', '强制下载');
        } else {
            await CustomDialog.alert('云端没有备份数据', '提示');
        }
    } catch (error) {
        await CustomDialog.alert('下载失败：' + error.message, '错误');
    }
}

// ==================== 页面加载时初始化 ====================
document.addEventListener('DOMContentLoaded', async function () {
    console.log('=== 云存储模块加载 ===');

    // 尝试初始化 Firebase
    await initCloudBase();

    // 加载本地时间戳
    lastLocalModified = getLocalModifiedTime();
    console.log('本地最后修改时间:', lastLocalModified ? new Date(lastLocalModified).toLocaleString() : '无');
});

console.log('cloud-storage.js 加载完成');
