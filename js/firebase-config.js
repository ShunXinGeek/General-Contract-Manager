// =======================================================
// Firebase 配置文件
// =======================================================
// 请将以下占位符替换为你的 Firebase 项目凭证

window.FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// 尝试从本地存储加载配置
try {
    const storedConfig = localStorage.getItem('HK_Firebase_Config');
    if (storedConfig) {
        const parsedConfig = JSON.parse(storedConfig);
        // 合并配置，覆盖默认值
        Object.assign(window.FIREBASE_CONFIG, parsedConfig);
    }
} catch (e) {
    console.error('无法加载本地 Firebase 配置:', e);
}

// Firestore 集合名称（与原程序使用不同的集合，避免数据冲突）
window.FIREBASE_COLLECTIONS = {
    CONTRACT_MODS: 'general_contract_mods'
};
