// Portable contract backups. Only contract data and matching local vectors go into the file.
window.ContractBackup = (() => {
    const FORMAT = 'general-contract-management-backup';
    const VERSION = 1;
    const backupButton = document.getElementById('backupContractsButton');
    const restoreButton = document.getElementById('restoreContractsButton');
    const fileInput = document.getElementById('contractBackupFile');
    const dialog = document.getElementById('contractRestoreDialog');
    let busy = false;
    let restoring = null;

    function refreshControls() {
        backupButton.disabled = busy || contractVectorizing || !Object.keys(contracts).length;
        restoreButton.disabled = busy || contractVectorizing;
    }

    async function run(message, action) {
        if (busy || contractVectorizing) return;
        busy = true;
        updateContractVectorButton();
        try {
            await action();
        } catch (error) {
            if (error.name !== 'AbortError') {
                window.StatusCenter.post('error', message + '：' + error.message, { source: '备份与恢复' });
            }
        } finally {
            busy = false;
            updateContractVectorButton();
        }
    }

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function validKey(value) {
        return typeof value === 'string' && value.length > 0 && !Object.hasOwn(Object.prototype, value)
            && !/[\u0000-\u001f\u007f]/.test(value);
    }

    function validInlineId(value) {
        return validKey(value) && !/[&"'<>\\]/.test(value);
    }

    function validateContracts(data) {
        if (!isObject(data) || !Object.keys(data).length) throw new Error('备份中没有合同');
        const sources = new Set();
        for (const [key, contract] of Object.entries(data)) {
            if (!validKey(key) || !isObject(contract) || !validKey(contract.sourceId) ||
                sources.has(contract.sourceId) || typeof contract.title !== 'string' || !isObject(contract.data)) {
                throw new Error('备份中的合同记录无效');
            }
            sources.add(contract.sourceId);
            for (const [id, clause] of Object.entries(contract.data)) {
                if (!validInlineId(id) || !isObject(clause) || typeof clause.title !== 'string' ||
                    typeof clause.content !== 'string' || typeof clause.originalContent !== 'string' ||
                    ['translation', 'translation_tc'].some(field => clause[field] != null && typeof clause[field] !== 'string') ||
                    (clause.reviewTags != null && !Array.isArray(clause.reviewTags))) {
                    throw new Error('备份中的条款记录无效（' + key + '）');
                }
            }
            if (contract.bookmarks != null && (!Array.isArray(contract.bookmarks) || contract.bookmarks.some(bookmark =>
                !isObject(bookmark) || !validInlineId(bookmark.id) ||
                !validInlineId(String(bookmark.uid ?? '')) || typeof bookmark.label !== 'string' ||
                (bookmark.level !== undefined && ![0, 1].includes(bookmark.level))))) {
                throw new Error('备份中的书签记录无效（' + key + '）');
            }
        }
        return sources;
    }

    function matchingVectors(data, records) {
        const sources = new Map(Object.entries(data).map(([key, contract]) => [contract.sourceId, { key, contract }]));
        const matches = new Map();
        for (const record of records) {
            const source = sources.get(record.sourceId);
            if (!source || RAG.validateRecordMetadata(record) ||
                RAG.validateSourceRecord(record, source.contract.data) !== 'ready') continue;
            const clauseId = RAG.recordClauseKey(record, source.contract.data);
            const id = record.sourceId + '::' + clauseId;
            const previous = matches.get(id);
            if (!previous || (record.timestamp || 0) >= (previous.timestamp || 0)) {
                matches.set(id, { ...record, id, type: source.key, clauseId });
            }
        }
        return [...matches.values()];
    }

    async function saveBackup() {
        const timestamp = new Date();
        const localDate = new Date(timestamp.getTime() - timestamp.getTimezoneOffset() * 60000);
        const filename = '合同备份-' + localDate.toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.gcm-backup.json.gz';
        // The file picker must be invoked directly from the button's user gesture.
        const handle = typeof window.showSaveFilePicker === 'function' ? await window.showSaveFilePicker({
            id: 'contract-backup',
            suggestedName: filename,
            types: [{ description: '合同备份', accept: { 'application/gzip': ['.gz'] } }]
        }) : null;

        if (activeContractKey && Object.hasOwn(contracts, activeContractKey)) {
            captureCurrentContent();
            contracts[activeContractKey].bookmarks = savedBookmarks;
        }
        const data = structuredClone(contracts);
        const sources = validateContracts(data);
        const sourceOrder = getOrderedContractKeys().map(key => data[key].sourceId);
        const vectors = matchingVectors(data, await RAG.readRecords());
        const snapshot = { format: FORMAT, version: VERSION, createdAt: timestamp.toISOString(), contracts: data, sourceOrder, vectors };
        const stream = new Blob([JSON.stringify(snapshot)], { type: 'application/json' }).stream()
            .pipeThrough(new CompressionStream('gzip'));

        if (handle) {
            await stream.pipeTo(await handle.createWritable());
        } else {
            const blob = await new Response(stream, { headers: { 'Content-Type': 'application/gzip' } }).blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        const summary = sources.size + ' 份合同、' + vectors.length + ' 条匹配向量';
        window.StatusCenter.post('success', (handle ? '已保存备份（' : '已生成备份下载（') + summary + '）。', { source: '备份与恢复' });
    }

    async function readBackup(file) {
        let snapshot;
        try {
            const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
            snapshot = JSON.parse(await new Response(stream).text());
        } catch {
            throw new Error('无法读取压缩文件，请选择完整的合同备份（.gcm-backup.json.gz）');
        }
        if (!isObject(snapshot) || snapshot.format !== FORMAT) throw new Error('这不是合同备份文件');
        if (snapshot.version !== VERSION) throw new Error('当前程序无法读取此版本的合同备份');
        const sources = validateContracts(snapshot.contracts);
        if (!Array.isArray(snapshot.sourceOrder) || snapshot.sourceOrder.length !== sources.size ||
            new Set(snapshot.sourceOrder).size !== sources.size || snapshot.sourceOrder.some(id => !sources.has(id)) ||
            !Array.isArray(snapshot.vectors) || snapshot.vectors.some(record =>
                !isObject(record) || !validKey(record.id) || !validInlineId(record.clauseId) || !Array.isArray(record.vector))) {
            throw new Error('备份中的合同排序或向量记录无效');
        }
        // The bookmark renderer accepts formatted labels. Apply the same HTML policy as contract text.
        for (const contract of Object.values(snapshot.contracts)) {
            for (const clause of Object.values(contract.data)) {
                for (const field of ['title', 'content', 'originalContent', 'translation', 'translation_tc']) {
                    if (typeof clause[field] === 'string') clause[field] = sanitizeHtml(clause[field]);
                }
            }
            for (const bookmark of contract.bookmarks || []) bookmark.label = sanitizeHtml(bookmark.label);
        }
        snapshot.vectors = matchingVectors(snapshot.contracts, snapshot.vectors);
        return snapshot;
    }

    function findConflicts(data) {
        const localKeys = new Map(Object.keys(contracts).map(key => [getContractDomId(key), key]));
        return new Map(Object.entries(data).map(([key, contract]) => [
            key, [...new Set([Object.hasOwn(contracts, key) ? key : undefined, localKeys.get(contract.sourceId)]
                .filter(match => match !== undefined))]
        ]));
    }

    function preview(snapshot, conflicts) {
        const summary = document.getElementById('contractRestoreSummary');
        const list = document.getElementById('contractRestoreConflicts');
        const entries = Object.entries(snapshot.contracts);
        const clauseCount = entries.reduce((sum, [, contract]) => sum + Object.keys(contract.data).length, 0);
        const missing = Math.max(0, AIRetrieval.rows(snapshot.contracts).length - snapshot.vectors.length);
        summary.textContent = '备份包含 ' + entries.length + ' 份合同、' + clauseCount + ' 条条款和 '
            + snapshot.vectors.length + ' 条匹配向量。'
            + (missing ? '另有 ' + missing + ' 条可检索条款需要向量化。' : '');
        list.replaceChildren();
        const choices = new Map();
        const collisions = entries.filter(([key]) => conflicts.get(key).length);
        if (collisions.length) {
            const hint = document.createElement('p');
            hint.textContent = '默认保留现有合同。勾选下方合同以使用备份版本替换。';
            list.appendChild(hint);
        }
        for (const [key, contract] of collisions) {
            const matches = conflicts.get(key);
            if (matches.length > 1) {
                const item = document.createElement('p');
                item.textContent = key + ' 同时与多个现有合同冲突，本次保留现有版本。';
                list.appendChild(item);
                continue;
            }
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            label.append(checkbox, '用备份中的「' + key + ' · ' + contract.title + '」替换「' + matches[0] + '」');
            list.appendChild(label);
            choices.set(key, checkbox);
        }
        return new Promise(resolve => {
            dialog.returnValue = 'cancel';
            dialog.addEventListener('close', () => {
                resolve(dialog.returnValue === 'restore' ?
                    new Set([...choices].filter(([, checkbox]) => checkbox.checked).map(([key]) => key)) : null);
            }, { once: true });
            dialog.showModal();
        });
    }

    function makeRestorePlan(snapshot, previewConflicts, choices) {
        const conflicts = findConflicts(snapshot.contracts);
        const nextContracts = { ...contracts };
        const replacedKeys = new Map();
        const replacedIds = new Map();
        const selectedIds = new Set();
        const affectedIds = new Set();
        const restoredKeys = [];
        for (const [key, contract] of Object.entries(snapshot.contracts)) {
            const matches = conflicts.get(key);
            if (matches.length && !choices.has(key)) continue;
            if (choices.has(key) && (matches.length !== 1 || matches[0] !== previewConflicts.get(key)[0])) {
                throw new Error('现有合同已变化，请重新打开备份预览');
            }
            if (matches.length) {
                const localKey = matches[0];
                if (replacedKeys.has(localKey)) throw new Error('多个备份合同选中了同一份现有合同，请只选择一项替换');
                const localId = getContractDomId(localKey);
                replacedKeys.set(localKey, key);
                replacedIds.set(localId, contract.sourceId);
                affectedIds.add(localId);
                delete nextContracts[localKey];
            }
            nextContracts[key] = contract;
            selectedIds.add(contract.sourceId);
            affectedIds.add(contract.sourceId);
            restoredKeys.push(key);
        }
        const localOrder = getOrderedContractKeys().map(key => getContractDomId(key));
        const sourceIds = [...new Set([
            ...localOrder.map(id => replacedIds.get(id) || id),
            ...snapshot.sourceOrder.filter(id => selectedIds.has(id))
        ])];
        const nextOrder = { sourceIds, modifiedAt: Math.max(Date.now(), (contractOrder?.modifiedAt || 0) + 1) };
        const preferredKey = replacedKeys.get(activeContractKey) || activeContractKey;
        const vectors = snapshot.vectors.filter(record => selectedIds.has(record.sourceId));
        return { nextContracts, nextOrder, preferredKey, vectors, affectedIds, restoredKeys, replacedKeys };
    }

    async function applyRestore(plan) {
        const previous = await localforage.getItem(CONTRACTS_DB_KEY);
        const retrievalSettings = window.RetrievalSettings.get(contracts);
        await writeContractSnapshot(plan.nextContracts, plan.nextOrder, plan.preferredKey);
        try {
            await RAG.replaceSourceRecords(plan.affectedIds, plan.vectors);
        } catch (error) {
            try {
                if (previous == null) await localforage.removeItem(CONTRACTS_DB_KEY);
                else await localforage.setItem(CONTRACTS_DB_KEY, previous);
            } catch {
                throw new Error('向量写入失败，合同快照回滚也失败。请保留备份文件并检查浏览器存储空间');
            }
            throw error;
        }
        contracts = plan.nextContracts;
        contractOrder = plan.nextOrder;
        for (const [previousKey, nextKey] of plan.replacedKeys) {
            if (previousKey !== nextKey) delete window.ORIGINAL_CONTRACTS?.[previousKey];
        }
        plan.restoredKeys.forEach(restoreContractOriginals);
        try {
            // Preserve existing source preferences. Newly added contracts follow the import default.
            window.RetrievalSettings.persist(retrievalSettings, contracts, false);
        } catch (error) {
            window.StatusCenter.post('warning', '合同和向量已恢复，检索设置保存失败：' + error.message, { source: '备份与恢复' });
        }
        refreshContractsAfterCloud(plan.preferredKey);
        refreshContractVisibility();
        refreshContractSettings();
    }

    async function restoreBackup(file) {
        const snapshot = await readBackup(file);
        const conflicts = findConflicts(snapshot.contracts);
        const choices = await preview(snapshot, conflicts);
        if (!choices) return;

        if (activeContractKey) {
            clearTimeout(editPersistTimer);
            if (!await autoSave()) throw new Error('当前合同的编辑尚未保存');
        }
        const plan = makeRestorePlan(snapshot, conflicts, choices);
        const restored = plan.restoredKeys.length;
        if (!restored) {
            window.StatusCenter.post('info', '已保留所有现有合同。', { source: '备份与恢复' });
            return;
        }

        const operation = applyRestore(plan);
        restoring = operation.then(() => {}, () => {});
        try {
            await operation;
        } finally {
            restoring = null;
        }
        const skipped = Object.keys(snapshot.contracts).length - restored;
        const settings = RAG.getEmbeddingConfig(AI_CONFIG);
        const usable = settings ? plan.vectors.filter(record => record.embeddingModel === settings.model &&
            record.embeddingSpace === RAG.embeddingSpace(settings.apiEndpoint, settings.model)).length : 0;
        const modelNotice = usable < plan.vectors.length ? '请配置与备份匹配的 Embedding 服务和模型以使用这些向量。' : '';
        const message = '已恢复 ' + restored + ' 份合同、' + plan.vectors.length + ' 条向量。'
            + (skipped ? '保留了 ' + skipped + ' 份冲突合同的现有版本。' : '') + modelNotice;
        window.StatusCenter.post('success', message, { source: '备份与恢复' });
    }

    backupButton.addEventListener('click', () => run('备份失败', saveBackup));
    restoreButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        fileInput.value = '';
        if (file) run('恢复失败', () => restoreBackup(file));
    });
    refreshControls();

    return { refreshControls, get busy() { return busy; }, get restoring() { return restoring; } };
})();
