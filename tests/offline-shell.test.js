const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

async function run() {
    const events = {}, deleted = [], cached = new Map();
    let resources;
    const context = {
        URL, Response,
        self: { location: { origin: 'http://localhost' }, skipWaiting: async () => {},
            clients: { claim: async () => {} }, addEventListener: (name, handler) => { events[name] = handler; } },
        caches: {
            open: async () => ({ addAll: async urls => { resources = [...urls]; },
                put: async (request, response) => { cached.set(request.url || request, response); } }),
            keys: async () => ['general-contract-shell-v2', 'general-contract-shell-v3', 'general-contract-shell-v4', 'unrelated-app-cache'],
            delete: async name => { deleted.push(name); },
            match: async request => cached.get(request.url || request)
        },
        fetch: async () => { throw new Error('offline'); }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
    let pending;
    events.install({ waitUntil: promise => { pending = promise; } });
    await pending;
    for (const resource of resources) {
        assert.ok(fs.existsSync(path.join(root, resource)), `Missing precache resource: ${resource}`);
    }
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
    for (const script of scripts) {
        assert.ok(!script.startsWith('https:'), `Core script still depends on CDN: ${script}`);
        assert.ok(resources.includes(`./${script}`), `Core script not precached: ${script}`);
    }
    assert.ok(!resources.includes('./js/vectors-data.js'), 'large optional vectors must stay lazy');
    events.activate({ waitUntil: promise => { pending = promise; } });
    await pending;
    assert.deepStrictEqual(deleted, ['general-contract-shell-v2', 'general-contract-shell-v3', 'general-contract-shell-v4'], 'do not delete other apps caches');
    cached.set('./index.html', new Response('offline shell'));
    let response;
    events.fetch({ request: { method: 'GET', url: 'http://localhost/deep-link', mode: 'navigate' },
        respondWith: promise => { response = promise; }, waitUntil() {} });
    assert.strictEqual(await (await response).text(), 'offline shell');
    cached.set('http://localhost/vendor/localforage.min.js', new Response('local library'));
    events.fetch({ request: { method: 'GET', url: 'http://localhost/vendor/localforage.min.js' },
        respondWith: promise => { response = promise; }, waitUntil() {} });
    assert.strictEqual(await (await response).text(), 'local library');
    context.fetch = async () => new Response('fresh library');
    const cacheWrites = [];
    events.fetch({ request: { method: 'GET', url: 'http://localhost/vendor/localforage.min.js' },
        respondWith: promise => { response = promise; }, waitUntil: promise => cacheWrites.push(promise) });
    assert.strictEqual(await (await response).text(), 'fresh library');
    await Promise.all(cacheWrites);
    assert.strictEqual(await cached.get('http://localhost/vendor/localforage.min.js').text(), 'fresh library');
    console.log(`offline shell tests passed (${scripts.length} scripts precached; offline fallback and scoped cleanup)`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
