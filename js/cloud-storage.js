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

        if (window.firebaseConfigReady) await window.firebaseConfigReady;

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

        // 登录后执行按条款时间戳合并，避免云端或本地任一侧被静默覆盖。
        console.log('登录成功，开始同步本地与云端数据...');
        const syncResult = await syncWithCloud();
        if (!syncResult.success) {
            throw new Error(syncResult.error || syncResult.reason || '登录后同步失败');
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

async function persistLocalStateForCloud() {
    if (typeof captureCurrentContent === 'function') captureCurrentContent();
    if (typeof contracts !== 'undefined' && activeContractKey && contracts[activeContractKey]) {
        contracts[activeContractKey].bookmarks = savedBookmarks;
    }
    if (typeof saveContractsToStorage === 'function') {
        const persisted = await saveContractsToStorage();
        if (!persisted) throw new Error('本地合同数据保存失败，已取消云端写入');
    }
}

function collectAllContractData() {
    const allContractData = {};
    if (typeof contracts === 'undefined') return allContractData;

    Object.keys(contracts).forEach(contractKey => {
        const contract = contracts[contractKey];
        allContractData[contractKey] = {
            title: contract.title || '',
            data: JSON.parse(JSON.stringify(contract.data || {}))
        };
    });
    return allContractData;
}

/**
 * 保存数据到云端
 */
async function saveToCloud(options = {}) {
    if (!db || !currentUser) {
        throw new Error('未登录，无法保存到云端');
    }

    try {
        // 同步前先将 DOM、内存状态和 IndexedDB 统一为同一份快照。
        await persistLocalStateForCloud();

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

        // 收集 Firebase 配置（从 AI 设置中的 "Firebase配置设置" 标签页）
        let firebaseConfig = null;
        try {
            const storedFbConfig = localStorage.getItem('HK_Firebase_Config');
            if (storedFbConfig) {
                firebaseConfig = JSON.parse(storedFbConfig);
            } else if (window.FIREBASE_CONFIG) {
                firebaseConfig = window.FIREBASE_CONFIG;
            }
        } catch (e) {
            console.warn('读取 Firebase 配置失败:', e);
        }

        // 收集完整合同数据（标题 + 所有条款内容，包括原始内容和翻译）
        const allContractData = collectAllContractData();

        // 准备数据
        const data = {
            user_id: currentUser.uid,
            updated_at: new Date().toISOString(),
            active_contract_key: typeof activeContractKey !== 'undefined' ? activeContractKey : null,
            modifications: allModifications,
            bookmarks: allBookmarks,
            theme: typeof currentThemeIndex !== 'undefined' ? currentThemeIndex : 0,
            ai_settings: typeof getAISettingsForCloud === 'function' ? getAISettingsForCloud() : null,
            firebase_config: firebaseConfig,
            contract_data: allContractData
        };

        // 使用子集合写入（避免单文档超过 Firestore 1 MiB 限制）
        const mainRef = db.collection(window.FIREBASE_COLLECTIONS.CONTRACT_MODS).doc(currentUser.uid);
        await writeDataToSubcollections(mainRef, data, { replace: options.replace === true });

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
        const mainRef = db.collection(window.FIREBASE_COLLECTIONS.CONTRACT_MODS).doc(currentUser.uid);
        const result = await loadFromSubcollections(mainRef);

        if (!result) {
            console.log('  云端没有备份数据');
            return null;
        }

        const data = result.data;
        console.log('✓ 从云端加载数据成功 (格式: ' + result.format + ')');
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
async function applyCloudDataToLocal(cloudData) {
    if (!cloudData || typeof contracts === 'undefined') return false;

    try {
        const hasContractSnapshot = Object.prototype.hasOwnProperty.call(cloudData, 'contract_data');
        if (hasContractSnapshot) {
            const restoredContracts = {};
            Object.keys(cloudData.contract_data || {}).forEach(contractKey => {
                const cloudContract = cloudData.contract_data[contractKey] || {};
                restoredContracts[contractKey] = {
                    title: cloudContract.title || contractKey,
                    data: JSON.parse(JSON.stringify(cloudContract.data || {})),
                    bookmarks: JSON.parse(JSON.stringify(cloudData.bookmarks?.[contractKey] || []))
                };
            });

            // 兼容旧云端数据：修改补丁优先覆盖完整快照中的对应条款。
            Object.keys(cloudData.modifications || {}).forEach(contractKey => {
                if (!restoredContracts[contractKey]) return;
                Object.keys(cloudData.modifications[contractKey]).forEach(clauseId => {
                    if (!restoredContracts[contractKey].data[clauseId]) return;
                    const modification = cloudData.modifications[contractKey][clauseId];
                    const cloudClause = restoredContracts[contractKey].data[clauseId];
                    if ((modification.modifiedAt || 0) >= (cloudClause.modifiedAt || 0)) {
                        cloudClause.content = modification.content;
                        cloudClause.modifiedAt = modification.modifiedAt || 0;
                    }
                });
            });

            contracts = restoredContracts;
            if (typeof ORIGINAL_CONTRACTS === 'undefined') window.ORIGINAL_CONTRACTS = {};
            Object.keys(contracts).forEach(key => {
                restoreContractOriginals(key);
            });

            const requestedKey = cloudData.active_contract_key;
            const nextActiveKey = contracts[requestedKey] ? requestedKey : (Object.keys(contracts)[0] || null);
            activeContractKey = null;
            fullClauseDatabase = {};
            savedBookmarks = null;
            if (typeof renderTabs === 'function') renderTabs();
            if (nextActiveKey && typeof switchContract === 'function') {
                switchContract(nextActiveKey);
            } else if (typeof showWelcomePage === 'function') {
                showWelcomePage();
            }
        } else {
            // 旧格式没有完整合同快照，只能把补丁应用到本地已经导入的合同。
            Object.keys(cloudData.modifications || {}).forEach(contractKey => {
                if (!contracts[contractKey]?.data) return;
                Object.keys(cloudData.modifications[contractKey]).forEach(clauseId => {
                    if (!contracts[contractKey].data[clauseId]) return;
                    const modification = cloudData.modifications[contractKey][clauseId];
                    contracts[contractKey].data[clauseId].content = modification.content;
                    contracts[contractKey].data[clauseId].modifiedAt = modification.modifiedAt || 0;
                });
            });
            Object.keys(cloudData.bookmarks || {}).forEach(contractKey => {
                if (contracts[contractKey]) contracts[contractKey].bookmarks = cloudData.bookmarks[contractKey];
            });
            refreshContractsAfterCloud(cloudData.active_contract_key);
        }

        if (typeof cloudData.theme !== 'undefined' && typeof applyTheme === 'function') {
            currentThemeIndex = cloudData.theme;
            applyTheme(currentThemeIndex);
        }
        if (cloudData.ai_settings && typeof applyCloudAISettings === 'function') {
            applyCloudAISettings(cloudData.ai_settings);
        }
        if (cloudData.firebase_config) {
            localStorage.setItem('HK_Firebase_Config', JSON.stringify(cloudData.firebase_config));
        }

        if (typeof saveContractsToStorage === 'function') {
            const persisted = await saveContractsToStorage();
            if (!persisted) throw new Error('云端数据已读取，但保存到本地失败');
        }
        console.log('✓ 云端完整快照已覆盖本地数据');
        return true;
    } catch (error) {
        console.error('应用云端数据失败:', error);
        throw error;
    }
}

// AI 配置的快照和合并契约集中在 ai-settings.js。

function collectCloudModifications(cloudData) {
    const collected = JSON.parse(JSON.stringify(cloudData?.modifications || {}));
    Object.keys(cloudData?.contract_data || {}).forEach(contractKey => {
        const cloudContract = cloudData.contract_data[contractKey];
        Object.keys(cloudContract?.data || {}).forEach(clauseId => {
            const clause = cloudContract.data[clauseId];
            if (!clause?.modifiedAt) return;
            if (!collected[contractKey]) collected[contractKey] = {};
            const existingTime = collected[contractKey][clauseId]?.modifiedAt || 0;
            if (clause.modifiedAt >= existingTime) {
                collected[contractKey][clauseId] = {
                    content: clause.content || '',
                    modifiedAt: clause.modifiedAt
                };
            }
        });
    });
    return collected;
}

function hydrateMissingCloudContracts(cloudData) {
    if (typeof contracts === 'undefined') return;

    Object.keys(cloudData?.contract_data || {}).forEach(contractKey => {
        const cloudContract = cloudData.contract_data[contractKey] || {};
        if (!contracts[contractKey]) {
            contracts[contractKey] = {
                title: cloudContract.title || contractKey,
                data: JSON.parse(JSON.stringify(cloudContract.data || {})),
                bookmarks: JSON.parse(JSON.stringify(cloudData.bookmarks?.[contractKey] || []))
            };
            restoreContractOriginals(contractKey);
            return;
        }

        const localContract = contracts[contractKey];
        if (!localContract.title && cloudContract.title) localContract.title = cloudContract.title;
        if (!localContract.data) localContract.data = {};
        Object.keys(cloudContract.data || {}).forEach(clauseId => {
            const cloudClause = cloudContract.data[clauseId];
            if (!localContract.data[clauseId]) {
                localContract.data[clauseId] = JSON.parse(JSON.stringify(cloudClause));
                return;
            }
            const localClause = localContract.data[clauseId];
            ['title', 'translation', 'translation_tc'].forEach(field => {
                if (!localClause[field] && cloudClause[field]) localClause[field] = cloudClause[field];
            });
            if (typeof cloudClause.originalContent === 'string' &&
                (typeof localClause.originalContent !== 'string' ||
                 (localClause.originalBaselineMigrated && cloudClause.originalBaselineMigrated !== true))) {
                localClause.originalContent = cloudClause.originalContent;
                localClause.originalBaselineMigrated = cloudClause.originalBaselineMigrated === true;
            }
            if (!localClause.content && cloudClause.content) localClause.content = cloudClause.content;
        });
        restoreContractOriginals(contractKey);
    });
}

function refreshContractsAfterCloud(preferredContractKey = null) {
    if (typeof contracts === 'undefined') return;
    const currentKey = contracts[activeContractKey]
        ? activeContractKey
        : (contracts[preferredContractKey] ? preferredContractKey : Object.keys(contracts)[0]);

    if (!currentKey) {
        if (typeof renderTabs === 'function') renderTabs();
        if (typeof showWelcomePage === 'function') showWelcomePage();
        return;
    }

    activeContractKey = currentKey;
    fullClauseDatabase = contracts[currentKey].data || {};
    savedBookmarks = contracts[currentKey].bookmarks || null;
    if (typeof renderTabs === 'function') renderTabs();
    if (typeof renderMainDocument === 'function') renderMainDocument();
    if (typeof initBookmarks === 'function') initBookmarks();
    if (typeof buildReverseIndex === 'function') buildReverseIndex();
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

        // 1. 先固定当前本地快照，确保刚完成的编辑也参与合并。
        await persistLocalStateForCloud();

        // 2. 从云端加载数据
        const cloudData = await loadFromCloud();

        if (!cloudData) {
            await saveToCloud();
            localStorage.setItem(LOCAL_TIMESTAMP_KEY, Date.now().toString());
            return { success: true, direction: 'local_to_cloud' };
        }

        // 3. 先创建云端独有的合同和条款，随后才应用修改补丁。
        hydrateMissingCloudContracts(cloudData);

        // 4. 提取两端修改；云端完整快照中的 modifiedAt 同样参与比较。
        const localModifications = typeof extractAllUserModifications === 'function'
            ? extractAllUserModifications()
            : {};
        const cloudModifications = collectCloudModifications(cloudData);

        // 5. 执行字段级合并
        const mergeResult = mergeFieldLevel(localModifications, cloudModifications);

        console.log('  合并结果:',
            `本地较新: ${mergeResult.stats.localNewer}条, `,
            `云端较新: ${mergeResult.stats.cloudNewer}条, `,
            `相同: ${mergeResult.stats.same}条`);

        // 6. 应用云端较新的数据到本地
        if (mergeResult.stats.cloudNewer > 0) {
            applyMergedModifications(mergeResult.cloudNewer);
        }

        // 7. 合并书签（保留更完整的版本）
        const mergedBookmarks = mergeBookmarks(
            collectAllBookmarks(),
            cloudData?.bookmarks || {}
        );

        Object.keys(mergedBookmarks).forEach(contractKey => {
            if (contracts[contractKey]) contracts[contractKey].bookmarks = mergedBookmarks[contractKey];
        });
        refreshContractsAfterCloud(cloudData.active_contract_key);

        const mergedAISettings = mergeAISettings(
            typeof getAISettingsForCloud === 'function' ? getAISettingsForCloud() : null,
            cloudData.ai_settings || null
        );
        if (mergedAISettings && typeof applyCloudAISettings === 'function') {
            applyCloudAISettings(mergedAISettings);
        }

        // 8. 持久化合并结果并上传当前完整快照，绝不复用旧 contract_data。
        await persistLocalStateForCloud();
        await saveToCloud();

        // 9. 更新本地时间戳
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
    if (typeof activeContractKey !== 'undefined' && activeContractKey && contracts[activeContractKey]) {
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
        throw new Error('未登录，无法上传到云端');
    }

    console.log('=== 强制上传到云端 ===');
    updateLocalModificationTime();
    await saveToCloud({ replace: true });
    console.log('✓ 强制上传完成');
    return true;
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
        const uploaded = await forceUploadToCloud();
        if (!uploaded) throw new Error('云端未确认写入成功');
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
            const applied = await applyCloudDataToLocal(cloudData);
            if (!applied) throw new Error('云端数据未能应用到本地');
            localStorage.setItem(LOCAL_TIMESTAMP_KEY, new Date(cloudData.updated_at).getTime().toString());
            await CustomDialog.alert('✓ 云端数据已下载到本地', '强制下载');
        } else {
            await CustomDialog.alert('云端没有备份数据', '提示');
        }
    } catch (error) {
        await CustomDialog.alert('下载失败：' + error.message, '错误');
    }
}

// ==================== 文档大小限制解决方案 ====================

/**
 * 检测是否为旧格式（所有数据在单个文档中）
 * @param {Object} data - 主文档数据
 * @returns {boolean}
 */
function isOldFormat(data) {
    if (!data) return false;
    return (data.modifications !== undefined ||
            data.bookmarks !== undefined ||
            data.contract_data !== undefined);
}

/**
 * 写入合约数据到子集合，必要时自动分批
 * @param {firebase.firestore.DocumentReference} mainRef - 用户主文档引用
 * @param {string} contractKey - 合约键名
 * @param {Object} contractData - { title, data: { clauseId: {...} } }
 * @param {string} timestamp - ISO 时间戳
 * @param {firebase.firestore.WriteBatch} batch - 批量写入对象
 */
function writeContractDataWithBatching(mainRef, contractKey, contractData, timestamp, batch) {
    const fullDoc = {
        contract_key: contractKey,
        title: contractData.title || '',
        data: contractData.data || {},
        updated_at: timestamp
    };
    const fullSize = new Blob([JSON.stringify(fullDoc)]).size;
    const cdRef = mainRef.collection('contract_data').doc(contractKey);

    if (fullSize < 900 * 1024) {
        // 单个文档大小合适，直接写入
        batch.set(cdRef, fullDoc);
    } else {
        // 需要分批（极罕见：单个合约数据超过 ~900 KB）
        console.log(`  [分批] contract_data/${contractKey} 过大 (${(fullSize/1024).toFixed(1)} KB)，将拆分为多个批次`);
        const clauseIds = Object.keys(contractData.data || {});
        const batches = [];
        let currentBatch = {};
        let currentSize = 0;
        const metadataSize = new Blob([JSON.stringify({
            contract_key: contractKey,
            title: contractData.title || '',
            batch_count: 1,
            updated_at: timestamp
        })]).size;

        for (const clauseId of clauseIds) {
            const clauseEntry = contractData.data[clauseId];
            const entrySize = new Blob([JSON.stringify({ [clauseId]: clauseEntry })]).size;

            if (currentSize + entrySize > 900 * 1024 - metadataSize && Object.keys(currentBatch).length > 0) {
                batches.push(currentBatch);
                currentBatch = {};
                currentSize = 0;
            }
            currentBatch[clauseId] = clauseEntry;
            currentSize += entrySize;
        }
        if (Object.keys(currentBatch).length > 0) {
            batches.push(currentBatch);
        }

        console.log(`  → 已拆分为 ${batches.length} 个批次`);

        // 写入元数据文档（不含 data 字段，只记录 batch_count）
        batch.set(cdRef, {
            contract_key: contractKey,
            title: contractData.title || '',
            batch_count: batches.length,
            updated_at: timestamp
        });

        // 写入每个批次
        batches.forEach((batchData, index) => {
            const batchRef = cdRef.collection('batches').doc(String(index));
            batch.set(batchRef, {
                batch_index: index,
                data: batchData,
                updated_at: timestamp
            });
        });
    }
}

/**
 * 读取分批存储的合约数据（合并所有批次）
 * @param {firebase.firestore.DocumentReference} mainRef - 用户主文档引用
 * @param {string} contractKey - 合约键名
 * @param {Object} metadata - 合约元数据（包含 batch_count）
 * @returns {Promise<Object>} { title, data }
 */
async function loadBatchedContractData(mainRef, contractKey, metadata) {
    const cdRef = mainRef.collection('contract_data').doc(contractKey);
    const batchSnap = await cdRef.collection('batches').orderBy('batch_index').get();

    const mergedData = {};
    batchSnap.forEach(doc => {
        const d = doc.data();
        if (d.data && d.batch_index < metadata.batch_count) {
            Object.assign(mergedData, d.data);
        }
    });

    console.log(`  [分批加载] contract_data/${contractKey}: 合并了 ${batchSnap.size} 个批次, ${Object.keys(mergedData).length} 条条款`);
    return {
        title: metadata.title || '',
        data: mergedData
    };
}

/**
 * 将数据写入新格式（主文档元数据 + 子集合）
 * 将单文档拆分为：主文档（元数据） + modifications/bookmarks/contract_data 子集合
 * @param {firebase.firestore.DocumentReference} mainRef - 用户主文档引用
 * @param {Object} data - 扁平格式数据
 */
async function deleteDocumentRefsInChunks(refs) {
    for (let offset = 0; offset < refs.length; offset += 400) {
        const deleteBatch = db.batch();
        refs.slice(offset, offset + 400).forEach(ref => deleteBatch.delete(ref));
        await deleteBatch.commit();
    }
}

async function cleanupStaleCloudPayloadCollections(mainRef, data) {
    const [modSnap, bookmarkSnap, contractSnap] = await Promise.all([
        mainRef.collection('modifications').get(),
        mainRef.collection('bookmarks').get(),
        mainRef.collection('contract_data').get()
    ]);

    const refsToDelete = [];
    const modificationKeys = new Set(Object.keys(data.modifications || {}));
    const bookmarkKeys = new Set(Object.keys(data.bookmarks || {}));
    const contractKeys = new Set(Object.keys(data.contract_data || {}));
    modSnap.forEach(doc => { if (!modificationKeys.has(doc.id)) refsToDelete.push(doc.ref); });
    bookmarkSnap.forEach(doc => { if (!bookmarkKeys.has(doc.id)) refsToDelete.push(doc.ref); });

    const batchSnapshots = await Promise.all(contractSnap.docs.map(async doc => ({
        contractDoc: doc,
        batches: await doc.ref.collection('batches').get()
    })));
    batchSnapshots.forEach(({ contractDoc, batches }) => {
        const keepContract = contractKeys.has(contractDoc.id);
        const activeBatchCount = keepContract ? (contractDoc.data().batch_count || 0) : 0;
        if (!keepContract) refsToDelete.push(contractDoc.ref);
        batches.forEach(doc => {
            if (!keepContract || doc.data().batch_index >= activeBatchCount) refsToDelete.push(doc.ref);
        });
    });
    await deleteDocumentRefsInChunks(refsToDelete);
}

async function writeDataToSubcollections(mainRef, data, options = {}) {
    const batch = db.batch();
    const now = data.updated_at || new Date().toISOString();

    // 1. 主文档只存元数据（体积很小）
    batch.set(mainRef, {
        user_id: data.user_id,
        updated_at: now,
        active_contract_key: data.active_contract_key || null,
        theme: data.theme != null ? data.theme : 0,
        ai_settings: data.ai_settings || null,
        firebase_config: data.firebase_config || null,
        format_version: 2
    }, { merge: true });

    // 2. modifications → 子集合，每个合约一个文档
    const mods = data.modifications || {};
    Object.keys(mods).forEach(contractKey => {
        const ref = mainRef.collection('modifications').doc(contractKey);
        batch.set(ref, {
            contract_key: contractKey,
            modifications: mods[contractKey],
            updated_at: now
        });
    });

    // 3. bookmarks → 子集合，每个合约一个文档
    const bms = data.bookmarks || {};
    Object.keys(bms).forEach(contractKey => {
        const ref = mainRef.collection('bookmarks').doc(contractKey);
        batch.set(ref, {
            contract_key: contractKey,
            bookmarks: bms[contractKey],
            updated_at: now
        });
    });

    // 4. contract_data → 子集合，每个合约一个文档（自动检测并分批）
    const cd = data.contract_data || {};
    for (const contractKey of Object.keys(cd)) {
        writeContractDataWithBatching(mainRef, contractKey, cd[contractKey], now, batch);
    }

    // 提交批量写入（原子性：全部成功或全部回滚）
    await batch.commit();
    console.log('✓ 数据已写入子集合格式 (format_version: 2)');

    // 强制上传在新快照写入成功后再清理旧文档，避免失败时先丢失云端备份。
    if (options.replace === true) {
        await cleanupStaleCloudPayloadCollections(mainRef, data);
    }

    // 5. 清理旧格式键（从单文档迁移到子集合后）
    await cleanupOldFormatKeys(mainRef);
}

/**
 * 从子集合加载数据（自动兼容旧格式）
 * @param {firebase.firestore.DocumentReference} mainRef - 用户主文档引用
 * @returns {Promise<Object|null>} { data: {...}, format: 'old'|'new' } 或 null
 */
async function loadFromSubcollections(mainRef) {
    const mainDoc = await mainRef.get();

    if (!mainDoc.exists) {
        return null;
    }

    const mainData = mainDoc.data();

    // 兼容旧格式：数据直接嵌入在主文档中
    if (isOldFormat(mainData)) {
        console.log('  检测到旧格式数据（单文档存储），下次保存时将自动迁移');
        return { data: mainData, format: 'old' };
    }

    // 新格式：从子集合读取
    console.log('  检测到新格式数据（子集合存储）');

    const [modSnap, bmSnap, cdSnap] = await Promise.all([
        mainRef.collection('modifications').get(),
        mainRef.collection('bookmarks').get(),
        mainRef.collection('contract_data').get()
    ]);

    // 重建 modifications
    const modifications = {};
    modSnap.forEach(doc => {
        const d = doc.data();
        modifications[doc.id] = d.modifications || {};
    });

    // 重建 bookmarks
    const bookmarks = {};
    bmSnap.forEach(doc => {
        const d = doc.data();
        bookmarks[doc.id] = d.bookmarks || [];
    });

    // 重建 contract_data（处理可能的分批存储）
    const contract_data = {};
    const batchedPromises = [];

    cdSnap.forEach(doc => {
        const d = doc.data();
        if (d.batch_count && d.batch_count >= 1) {
            // 分批存储：从子批次读取并合并
            batchedPromises.push(
                loadBatchedContractData(mainRef, doc.id, d).then(result => {
                    contract_data[doc.id] = result;
                })
            );
        } else if (d.data) {
            // 直接存储
            contract_data[doc.id] = { title: d.title || '', data: d.data };
        }
    });

    // 等待所有分批数据加载完成
    if (batchedPromises.length > 0) {
        await Promise.all(batchedPromises);
    }

    // 重建扁平格式（与旧格式完全兼容，applyCloudDataToLocal 无需改动）
    return {
        data: {
            ...mainData,       // user_id, updated_at, theme, ai_settings, firebase_config, format_version
            modifications,
            bookmarks,
            contract_data
        },
        format: 'new'
    };
}

/**
 * 清理主文档中的旧格式键（迁移完成后）
 * 非致命操作 - 失败时仅记录警告，下次保存时会重试
 * @param {firebase.firestore.DocumentReference} mainRef - 用户主文档引用
 */
async function cleanupOldFormatKeys(mainRef) {
    try {
        const mainDoc = await mainRef.get();
        if (!mainDoc.exists) return;

        const data = mainDoc.data();
        const hasOldKeys = (data.modifications !== undefined ||
                           data.bookmarks !== undefined ||
                           data.contract_data !== undefined);

        if (hasOldKeys) {
            const cleanupBatch = db.batch();
            cleanupBatch.update(mainRef, {
                modifications: firebase.firestore.FieldValue.delete(),
                bookmarks: firebase.firestore.FieldValue.delete(),
                contract_data: firebase.firestore.FieldValue.delete()
            });
            await cleanupBatch.commit();
            console.log('✓ 旧格式键已从主文档中清理（迁移完成）');
        }
    } catch (e) {
        // 清理失败不影响主流程，下次保存时会重试
        console.warn('清理旧格式键失败（非致命，下次保存时会重试）:', e.message);
    }
}

/**
 * 诊断 Firestore 文档大小（调试用）
 * 在浏览器控制台调用: diagnoseDocumentSizes()
 */
async function diagnoseDocumentSizes() {
    if (!db || !currentUser) {
        console.log('未登录，无法诊断');
        return;
    }
    const mainRef = db.collection(window.FIREBASE_COLLECTIONS.CONTRACT_MODS).doc(currentUser.uid);

    console.log('=== Firestore 文档大小诊断 ===');
    console.log('用户ID:', currentUser.uid);

    // 主文档
    const mainDoc = await mainRef.get();
    if (mainDoc.exists) {
        const mainSize = new Blob([JSON.stringify(mainDoc.data())]).size;
        console.log(`主文档: ${(mainSize / 1024).toFixed(1)} KB`);
    } else {
        console.log('主文档: 不存在');
    }

    // 子集合
    for (const coll of ['modifications', 'bookmarks', 'contract_data']) {
        console.log(`--- ${coll} 子集合 ---`);
        const snap = await mainRef.collection(coll).get();
        if (snap.empty) {
            console.log(`  (空)`);
            continue;
        }
        snap.forEach(doc => {
            const size = new Blob([JSON.stringify(doc.data())]).size;
            const icon = size > 1000 * 1024 ? '⚠️' : '✓';
            console.log(`  ${icon} ${coll}/${doc.id}: ${(size / 1024).toFixed(1)} KB`);
        });
    }
    console.log('=== 诊断完成 ===');
}

// ==================== 页面加载时初始化 ====================
document.addEventListener('DOMContentLoaded', async function () {
    console.log('=== 云存储模块加载 ===');

    // 尝试初始化 Firebase
    const cloudReady = await initCloudBase();

    // 加载本地时间戳
    lastLocalModified = getLocalModifiedTime();
    console.log('本地最后修改时间:', lastLocalModified ? new Date(lastLocalModified).toLocaleString() : '无');

    // 已登录用户在新设备打开页面后自动恢复，不必等待定时同步或手动点击。
    if (cloudReady && currentUser) {
        try {
            if (window.contractAppReady) await window.contractAppReady;
            const result = await syncWithCloud();
            if (!result.success) console.warn('页面启动自动同步未完成:', result.reason || result.error);
        } catch (error) {
            console.warn('页面启动自动同步失败:', error);
        }
    }
});

console.log('cloud-storage.js 加载完成');
