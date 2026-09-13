const fs = require('fs');
const path = require('path');

const envFields = {
    apiKey: 'FIREBASE_API_KEY',
    authDomain: 'FIREBASE_AUTH_DOMAIN',
    projectId: 'FIREBASE_PROJECT_ID',
    storageBucket: 'FIREBASE_STORAGE_BUCKET',
    messagingSenderId: 'FIREBASE_MESSAGING_SENDER_ID',
    appId: 'FIREBASE_APP_ID'
};

const config = {};
const missing = [];
Object.entries(envFields).forEach(([field, envName]) => {
    const value = process.env[envName];
    if (value) config[field] = value;
    else missing.push(envName);
});

const runtimeConfig = missing.length === 0 ? config : null;
if (missing.length > 0) {
    console.warn(`Firebase runtime config not generated; missing: ${missing.join(', ')}`);
}

const outputPath = path.join(__dirname, '..', 'js', 'firebase-runtime-config.js');
const output = `// Generated during Netlify deployment.\nwindow.FIREBASE_DEPLOY_CONFIG = ${JSON.stringify(runtimeConfig, null, 2)};\n`;
fs.writeFileSync(outputPath, output, 'utf8');
