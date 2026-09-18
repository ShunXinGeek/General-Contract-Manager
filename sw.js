// Service Worker for General Contract Shell
const CACHE_PREFIX = 'general-contract-shell-';
const CACHE_NAME = CACHE_PREFIX + 'v4';
const urlsToCache = [
    './',
    './index.html',
    './css/style.css',
    './vendor/marked.min.js',
    './vendor/purify.min.js',
    './vendor/localforage.min.js',
    './vendor/html2pdf.bundle.min.js',
    './vendor/docx.js',
    './vendor/firebase-app-compat.js',
    './vendor/firebase-auth-compat.js',
    './vendor/firebase-firestore-compat.js',
    './js/utils.js',
    './js/app.js',
    './js/config.js',
    './js/ai-client.js',
    './js/import.js',
    './js/rag.js',
    './js/sync.js',
    './js/bookmark.js',
    './js/search.js',
    './js/comparison.js',
    './js/logger.js',
    './js/cloud-storage.js',
    './js/firebase-config.js',
    './js/firebase-runtime-config.js',
    './js/cross-ref-data.js',
    './js/cross-ref.js',
    './js/ai-settings.js',
    './js/editor.js',
    './js/ai-assistant.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(names.filter(n => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map(n => caches.delete(n)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const requestUrl = new URL(event.request.url);
    if (requestUrl.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const responseToCache = response.clone();
                    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache)));
                }
                return response;
            })
            .catch(async () => {
                const cachedResponse = await caches.match(event.request);
                if (cachedResponse) return cachedResponse;
                return event.request.mode === 'navigate'
                    ? caches.match('./index.html')
                    : Response.error();
            })
    );
});
