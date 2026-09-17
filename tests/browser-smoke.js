async (page) => {
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const baseURL = 'http://127.0.0.1:8765/';
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL);
    await page.evaluate(() => window.contractAppReady);
    assert(page.url().startsWith(baseURL), 'Refuse to clear non-test site storage');
    // Only this isolated localhost test profile is cleared. No production data/credentials are used.
    await page.evaluate(async () => { await localforage.clear(); localStorage.clear(); });
    await page.reload();
    await page.evaluate(() => window.contractAppReady);
    await page.getByRole('button', { name: '📥', exact: true }).click();
    // Use the real file input directly so CLI does not return early on a native chooser event.
    await page.locator('#importContractFile').setInputFiles('tests/fixtures/recovery-contract.txt');
    await page.getByRole('button', { name: '确定', exact: true }).click();
    await page.getByRole('button', { name: '确定', exact: true }).click();
    await page.locator('#clause-1 h2').waitFor();
    assert(await page.locator('.btn-modified').count() === 0, 'Imported contract must start unmodified');
    await page.locator('#btnEditMode').click();
    await page.getByRole('button', { name: '确定', exact: true }).click();
    await page.locator('#clause-1 .clause-text').fill('Edited browser test text.');
    await page.waitForFunction(() => !hasUnsavedChanges && fullClauseDatabase['1'].content.includes('Edited browser'));
    assert(await page.locator('#clause-1 .btn-modified').count() === 1, 'Edit badge missing');
    await page.locator('#clause-1 .btn-modified').click();
    assert((await page.locator('.compare-column-content').first().innerText()).includes('Original browser'), 'Original comparison lost');
    assert((await page.locator('.compare-column-content').last().innerText()).includes('Edited browser'), 'Current comparison lost');
    await page.locator('.compare-modal .btn-close').click();
    await page.reload();
    await page.evaluate(() => window.contractAppReady);
    assert((await page.locator('#clause-1 .clause-text').innerText()).includes('Edited browser'), 'Edit not restored after refresh');
    assert(await page.locator('#clause-1 .btn-modified').count() === 1, 'Baseline not restored after refresh');
    await page.locator('#clause-1 .btn-modified').click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.compare-modal .btn-revert').click();
    await page.waitForFunction(() => !hasUnsavedChanges && !checkClauseModified('1'));
    assert((await page.locator('#clause-1 .clause-text').innerText()).includes('Original browser'), 'Revert failed');
    await page.locator('.search-input').fill('Payment');
    assert((await page.locator('#navList').innerText()).includes('Payment'), 'Bookmark search regressed');
    await page.locator('.search-input').fill('');
    await page.locator('#clause-1 h2').click();
    assert((await page.locator('#refContent').innerText()).includes('浏览器测试原始正文'), 'Translation/reference view regressed');

    const snapshot = await page.evaluate(() => ({ contract_data: collectAllContractData(),
        active_contract_key: activeContractKey, bookmarks: collectAllBookmarks(), modifications: {} }));
    snapshot.ai_settings = {
        version: 2, modifiedAt: 200, selectedModelId: 'browser-m2', models: [
            { id: 'browser-m1', name: 'Browser Model One', endpoint: 'https://example.invalid/chat', apiKey: 'dummy-browser-key-one', model: 'one' },
            { id: 'browser-m2', name: 'Browser Model Two', endpoint: 'https://example.invalid/chat', apiKey: 'dummy-browser-key-two', model: 'two' }
        ], apiEndpoint: 'https://example.invalid/chat', apiKey: 'dummy-browser-key-two', model: 'two',
        embeddingEndpoint: 'https://example.invalid/embed', embeddingApiKey: 'dummy-embedding-key', embeddingModel: 'embed',
        rerankEnabled: true, rerankEndpoint: 'https://example.invalid/rerank', rerankApiKey: 'dummy-rerank-key', rerankModel: 'rank',
        systemPrompt: 'Browser smoke test only'
    };
    const secondContext = await page.context().browser().newContext();
    try {
        const fresh = await secondContext.newPage();
        fresh.on('pageerror', error => errors.push(error.message));
        await fresh.goto(baseURL);
        await fresh.evaluate(() => window.contractAppReady);
        // Exercise actual sync/merge/local persistence, replacing only the remote transport with a fixture.
        const result = await fresh.evaluate(async data => {
            initialized = true; currentUser = { uid: 'browser-test-user' };
            loadFromCloud = async () => data;
            saveToCloud = async () => { window.testUploadedSettings = getAISettingsForCloud(); return { success: true }; };
            return (await syncWithCloud()).success && testUploadedSettings.models.length === 2 &&
                testUploadedSettings.apiKey === 'dummy-browser-key-two';
        }, snapshot);
        assert(result, 'New device overwrote cloud settings with empty configuration');
        await fresh.reload();
        await fresh.evaluate(() => window.contractAppReady);
        assert(await fresh.locator('#currentModelName').textContent() === 'Browser Model Two', 'Selected model did not survive refresh');
        await fresh.getByRole('button', { name: '⚙️', exact: true }).click();
        assert(await fresh.locator('.model-card').count() === 2, 'Model list not restored');
        assert(await fresh.locator('#settingEmbeddingApiKey').inputValue() === 'dummy-embedding-key', 'Embedding key not restored');
        assert(await fresh.locator('#settingRerankApiKey').inputValue() === 'dummy-rerank-key', 'Rerank key not restored');
        await fresh.locator('#settingsModal .close-modal').click();
        await fresh.route('https://example.invalid/chat', route => {
            const request = route.request();
            assert(request.headers().authorization === 'Bearer dummy-browser-key-two', 'Wrong restored chat key');
            assert(request.postDataJSON().model === 'two', 'Wrong restored chat model');
            return route.fulfill({ contentType: 'text/event-stream', body:
                'data: {"choices":[{"delta":{"content":"Browser AI mock ready."}}]}\n\ndata: [DONE]\n\n' });
        });
        await fresh.getByRole('button', { name: '管理助手', exact: true }).click();
        await fresh.locator('#chatInput').fill('Browser test question');
        await fresh.locator('#sendBtn').click();
        await fresh.getByText('Browser AI mock ready.', { exact: true }).waitFor();
        assert((await fresh.locator('#clause-1 .clause-text').innerText()).includes('Original browser'), 'New-device contract restore failed');
    } finally {
        await secondContext.close();
    }
    // A third clean profile proves precaching works after just ONE completed online visit.
    const coldContext = await page.context().browser().newContext();
    try {
        const cold = await coldContext.newPage();
        cold.on('pageerror', error => errors.push(error.message));
        await cold.goto(baseURL);
        await cold.evaluate(() => window.contractAppReady);
        await cold.evaluate(data => applyCloudDataToLocal(data), snapshot);
        await cold.evaluate(() => navigator.serviceWorker.ready);
        await cold.waitForFunction(() => !!navigator.serviceWorker.controller);
        await coldContext.setOffline(true);
        await cold.reload();
        await cold.evaluate(() => window.contractAppReady);
        assert((await cold.locator('#clause-1 .clause-text').innerText()).includes('Original browser'), 'Offline restore failed');
        const ready = await cold.evaluate(() => !!(window.localforage && window.DOMPurify && window.marked && window.docx && window.html2pdf && window.firebase));
        assert(ready, 'Offline core dependencies missing');
        const networkBlocked = await cold.evaluate(async () => {
            try { await fetch('./__offline_probe__?nonce=' + Date.now(), { cache: 'no-store' }); return false; }
            catch { return true; }
        });
        assert(networkBlocked, 'Uncached network request still succeeded during offline test');
        await cold.screenshot({ path: 'output/playwright/regression-offline.png', fullPage: true });
    } finally {
        await coldContext.close();
    }
    assert(errors.length === 0, `Uncaught browser errors: ${errors.join('; ')}`);
    const summary = 'Browser smoke passed: UI import/edit/compare/revert/search/translation, new-device cloud AI restore + mock chat, offline cold reload; no uncaught JS errors.';
    await page.evaluate(value => { window.browserSmokeResult = value; }, summary);
    return summary;
}
