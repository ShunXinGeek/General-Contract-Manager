// =======================================================
// Firebase 配置文件
// =======================================================
// Netlify 构建配置优先；本机 localStorage 仅作为本地开发和旧版本兼容回退。
const fallbackFirebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

let storedFirebaseConfig = null;
try {
    const storedConfig = localStorage.getItem('HK_Firebase_Config');
    if (storedConfig) storedFirebaseConfig = JSON.parse(storedConfig);
} catch (e) {
    console.error('无法加载本地 Firebase 配置:', e);
}

const deployedFirebaseConfig = window.FIREBASE_DEPLOY_CONFIG;
window.FIREBASE_CONFIG = deployedFirebaseConfig?.apiKey && deployedFirebaseConfig?.projectId
    ? deployedFirebaseConfig
    : (storedFirebaseConfig?.apiKey && storedFirebaseConfig?.projectId
        ? storedFirebaseConfig
        : fallbackFirebaseConfig);
window.firebaseConfigReady = Promise.resolve(window.FIREBASE_CONFIG);

// Firestore 集合名称（与原程序使用不同的集合，避免数据冲突）
window.FIREBASE_COLLECTIONS = {
    CONTRACT_MODS: 'general_contract_mods'
};
