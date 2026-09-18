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
    assert(await page.locator('#btnToggleNavigator').isDisabled(), 'Navigator toggle must be disabled on the welcome page');
    assert(await page.locator('#btnToggleReferenceView').isDisabled(), 'Reference-view toggle must be disabled on the welcome page');
    await page.getByRole('button', { name: '📥', exact: true }).click();
    // Use the real file input directly so CLI does not return early on a native chooser event.
    await page.locator('#importContractFile').setInputFiles('tests/fixtures/recovery-contract.txt');
    await page.getByRole('button', { name: '确定', exact: true }).click();
    await page.getByRole('button', { name: '确定', exact: true }).click();
    await page.locator('#clause-1 h2').waitFor();
    assert(!(await page.locator('#btnToggleNavigator').isDisabled()), 'Navigator toggle must be enabled on a contract page');
    assert(!(await page.locator('#btnToggleReferenceView').isDisabled()), 'Reference-view toggle must be enabled on a contract page');
    assert(await page.locator('#btnLangMode').isVisible(), 'Original/translation toggle must appear on every contract tab');
    assert(await page.locator('#btnLangToggle').isVisible(), 'Simplified/traditional toggle must appear on every contract tab');
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
    await page.evaluate(() => renderRefContent('1', 'ref'));
    // The language preference belongs to the reference panel, rather than a single referenced clause.
    // Use a second contract so this follows the same cross-contract link path as SCC/GCC references.
    await page.evaluate(() => {
        contracts.GCC = {
            title: 'GCC',
            data: {
                '1': { title: 'GCC Clause 1', content: 'GCC Clause 1 English', translation: 'GCC 条款一简体译文', translation_tc: 'GCC 條款一繁體譯文' },
                '2': { title: 'GCC Clause 2', content: 'GCC Clause 2 English', translation: 'GCC 条款二简体译文', translation_tc: 'GCC 條款二繁體譯文' }
            },
            bookmarks: []
        };
        showCrossContractRef('GCC', '1');
    });
    assert((await page.locator('#refContent').innerText()).includes('GCC Clause 1 English'), 'Cross-contract reference must initially show the original');
    await page.locator('#btnLangToggle').click();
    assert(await page.evaluate(() => isTraditionalChinese === false), 'Chinese variant must not change while the original is displayed');
    await page.locator('#btnLangMode').click();
    assert((await page.locator('#refContent').innerText()).includes('GCC 条款一简体译文'), 'Translation toggle did not show the translated clause');
    await page.locator('#btnLangToggle').click();
    assert((await page.locator('#refContent').innerText()).includes('GCC 條款一繁體譯文'), 'Traditional Chinese toggle did not update the translated clause');
    await page.evaluate(() => showCrossContractRef('GCC', '2'));
    assert((await page.locator('#refContent').innerText()).includes('GCC 條款二繁體譯文'), 'Translated/traditional preference did not persist to the next linked clause');
    await page.locator('#btnLangMode').click();
    await page.evaluate(() => showCrossContractRef('GCC', '1'));
    assert((await page.locator('#refContent').innerText()).includes('GCC Clause 1 English'), 'Original preference did not persist to the next linked clause');
    await page.evaluate(() => switchContract('GCC'));
    assert(await page.locator('#btnLangMode').isVisible(), 'Original/translation toggle missing after switching to an added contract tab');
    assert(await page.locator('#btnLangToggle').isVisible(), 'Simplified/traditional toggle missing after switching to an added contract tab');
    assert(await page.locator('#btnLangMode').textContent() === '译', 'New contract tab must default to original text');
    assert(await page.locator('#btnLangToggle').textContent() === '简', 'New contract tab must default to simplified Chinese');
    await page.evaluate(() => showRef('1'));
    assert((await page.locator('#refContent').innerText()).includes('GCC Clause 1 English'), 'Added contract tab must initially show the original');
    await page.locator('#btnLangMode').click();
    await page.locator('#btnLangToggle').click();
    await page.evaluate(() => showRef('2'));
    assert((await page.locator('#refContent').innerText()).includes('GCC 條款二繁體譯文'), 'Added contract tab did not retain translated/traditional preferences');
    await page.locator('#btnLangMode').click();
    await page.evaluate(() => showRef('1'));
    assert((await page.locator('#refContent').innerText()).includes('GCC Clause 1 English'), 'Added contract tab did not retain original preference');
    await page.evaluate(() => switchContract('RECOVERY'));

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
        await fresh.route('**/api/ai', route => {
            const request = route.request();
            assert(request.postDataJSON().apiKey === 'dummy-browser-key-two', 'Wrong restored chat key');
            assert(request.postDataJSON().body.model === 'two', 'Wrong restored chat model');
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
