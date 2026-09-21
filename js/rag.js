/**
 * rag.js - 客户端 RAG (检索增强生成) 模块 (通用版)
 * 用于管理向量数据库 (IndexedDB) 和执行语义搜索
 */

const RAG_DB_NAME = 'ContractVectorStore';
const RAG_DB_VERSION = 1;
const RAG_STORE_NAME = 'vectors';

const RAG = {
    db: null,
    statusCallback: null,

    /**
     * 获取嵌入模型配置
     */
    getEmbeddingConfig(config) {
        if (!config.embeddingModel) return null;
        const embeddingEndpoint = config.embeddingEndpoint;
        const embeddingApiKey = config.embeddingApiKey;
        if (!embeddingEndpoint || !embeddingApiKey) return null;
        return {
            apiEndpoint: embeddingEndpoint,
            apiKey: embeddingApiKey,
            model: config.embeddingModel
        };
    },

    /**
     * 初始化/打开 IndexedDB
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(RAG_DB_NAME, RAG_DB_VERSION);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(RAG_STORE_NAME)) {
                    db.createObjectStore(RAG_STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('[RAG] Vector database initialized');
                resolve(this.db);
            };
            request.onerror = (event) => {
                console.error('[RAG] Database error:', event.target.error);
                reject(event.target.error);
            };
        });
    },

    /**
     * 计算余弦相似度
     */
    cosineSimilarity(vecA, vecB) {
        if (vecA.length !== vecB.length || !vecA.length || ![...vecA, ...vecB].every(Number.isFinite)) return null;
        let dotProduct = 0, normA = 0, normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return normA && normB ? dotProduct / (Math.sqrt(normA) * Math.sqrt(normB)) : null;
    },

    async readRecords() {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([RAG_STORE_NAME], 'readonly');
            const request = transaction.objectStore(RAG_STORE_NAME).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new Error('本机向量索引读取失败'));
        });
    },

    validateRecord(item, config, contractsData) {
        if (!item.embeddingModel || !item.sourceHash || !item.titleHash || !item.embeddingSpace) return 'legacy-unverified';
        if (item.embeddingModel !== config.embeddingModel) return 'model-mismatch';
        if (item.embeddingSpace !== this.embeddingSpace(config.embeddingEndpoint, config.embeddingModel)) return 'space-mismatch';
        if (!Array.isArray(item.vector) || item.dimension !== item.vector.length || !item.vector.length || !item.vector.every(Number.isFinite) || !item.vector.some(value => value !== 0)) return 'dimension-invalid';
        const data = contractsData?.[item.type]?.data || {};
        const key = Object.keys(data).find(id => AIRetrieval.number(id, item.type) === AIRetrieval.number(item.clauseId, item.type));
        if (key === undefined) return 'source-removed';
        if (item.sourceHash !== AIRetrieval.fingerprint(data[key].content)) return 'source-stale';
        if (item.titleHash !== AIRetrieval.fingerprint(data[key].title)) return 'source-stale';
        return 'ready';
    },

    embeddingSpace(endpoint, model) {
        let target = endpoint || '';
        if (target.includes('/chat/completions')) target = target.replace('/chat/completions', '/embeddings');
        else if (!target.includes('/embeddings')) target = target.replace(/\/+$/, '') + '/embeddings';
        try { const url = new URL(target); target = url.origin + url.pathname; } catch (_) { /* invalid config will fail at the provider boundary */ }
        return AIRetrieval.fingerprint(target + '\n' + model);
    },

    /**
     * 调用 API 生成嵌入向量
     */
    async getEmbedding(text, apiKey, apiEndpoint, model, signal) {
        let url = apiEndpoint;
        if (url.includes('/chat/completions')) {
            url = url.replace('/chat/completions', '/embeddings');
        } else if (!url.includes('/embeddings')) {
            url = url.replace(/\/+$/, '') + '/embeddings';
        }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        const timer = setTimeout(cancel, 25000);
        try {
            const response = await fetch('/api/retrieval', {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: 'embedding', endpoint: url, apiKey, body: { input: text, model: model } })
            });
            if (!response.ok) {
                throw new Error(`Embedding API Error ${response.status}`);
            }
            const data = await response.json();
            const vector = data.data?.[0]?.embedding;
            if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite)) throw new Error('Embedding 返回无效向量');
            return vector;
        } catch (error) {
            console.error('[RAG] Embedding generation failed:', error);
            throw error;
        } finally {
            clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        }
    },

    /**
     * 构建索引：遍历所有已导入合同条款，生成向量并存入 IndexedDB
     * @param {Object} contractsData - 全局 contracts 对象（动态）
     * @param {Object} config - 包含 apiKey, apiEndpoint, embeddingModel
     * @param {Function} onProgress - 进度回调 (current, total, status)
     */
    async buildIndex(contractsData, config, onProgress) {
        if (!this.db) await this.init();

        // 动态遍历所有合同类型（不再硬编码 GCC/SCC）
        let tasks = [];
        Object.keys(contractsData).forEach(type => {
            if (contractsData[type] && contractsData[type].data) {
                Object.entries(contractsData[type].data).forEach(([id, clause]) => {
                    if (/not\s+used|未使用/i.test(clause.title || '') || !AIRetrieval.plain(clause.content)) return;
                    const plainContent = clause.content.replace(/<[^>]*>/g, ' ');
                    const text = `${type} Clause ${id}: ${clause.title}\n${plainContent}`;
                    tasks.push({
                        id: `${type}_${id}`,
                        type: type,
                        clauseId: id,
                        text: text,
                         title: clause.title
                    });
                });
            }
        });

        const total = tasks.length;
        console.log(`[RAG] Starting index build for ${total} clauses...`);

        if (total === 0) {
            console.warn('[RAG] No clauses found to index.');
            if (onProgress) onProgress(0, 0, 'No data to index!');
            return { count: 0, total: 0, failed: 0 };
        }

        let successCount = 0;
        for (let i = 0; i < total; i++) {
            const task = tasks[i];
            try {
                if (onProgress) onProgress(i + 1, total, `Processing ${task.type} ${task.clauseId}...`);

                const embeddingConfig = this.getEmbeddingConfig(config);
                if (!embeddingConfig) {
                    throw new Error('嵌入模型配置不完整，请在设置中配置 Embedding Base URL、Embedding API Key 和 Embedding Model Name');
                }

                const vector = await this.getEmbedding(
                    task.text,
                    embeddingConfig.apiKey,
                    embeddingConfig.apiEndpoint,
                    embeddingConfig.model
                );

                await new Promise((resolve, reject) => {
                    const transaction = this.db.transaction([RAG_STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(RAG_STORE_NAME);
                    const req = store.put({
                        id: task.id,
                        type: task.type,
                        clauseId: task.clauseId,
                        title: task.title,
                        vector: vector,
                        embeddingModel: embeddingConfig.model,
                        sourceHash: AIRetrieval.fingerprint(task.text.slice(task.text.indexOf('\n') + 1)),
                        titleHash: AIRetrieval.fingerprint(task.title),
                        embeddingSpace: this.embeddingSpace(embeddingConfig.apiEndpoint, embeddingConfig.model),
                        dimension: vector.length,
                        timestamp: Date.now()
                    });
                    req.onsuccess = () => { successCount++; resolve(); };
                    req.onerror = (e) => {
                        console.error(`[RAG] IndexedDB write error for ${task.id}:`, e.target.error);
                        reject(e.target.error);
                    };
                });
            } catch (err) {
                console.error(`[RAG] Failed to index ${task.id}:`, err);
                if (onProgress) onProgress(i + 1, total, `Error on ${task.id}: ${err.message}`);
            }
        }

        if (onProgress) onProgress(total, total, 'Indexing Complete!');
        console.log(`[RAG] Index building complete. Successfully indexed ${successCount}/${total} clauses.`);
        return { count: successCount, total, failed: total - successCount };
    },

    /**
     * 语义搜索
     */
    async findMostRelevant(query, config, topK = 5, contractsData, options = {}) {
        const data = contractsData || (typeof contracts !== 'undefined' ? contracts : {});
        const records = await this.readRecords();
        const rejected = {};
        const valid = records.filter(item => {
            const code = this.validateRecord(item, config, data);
            if (code !== 'ready') rejected[code] = (rejected[code] || 0) + 1;
            return code === 'ready';
        });
        const labels = { 'legacy-unverified': '旧索引缺少原文指纹/向量空间元数据，需主动更新索引', 'model-mismatch': '索引与当前嵌入模型不一致', 'space-mismatch': '索引与当前嵌入服务的向量空间不一致',
            'source-stale': '部分条款原文已更新，相关向量失效', 'source-removed': '已删除条款向量已排除', 'dimension-invalid': '向量维度或内容无效' };
        const indexedSources = new Set(valid.map(item => `${item.type}:${AIRetrieval.number(item.clauseId, item.type)}`));
        const uncovered = AIRetrieval.rows(data).filter(row => !indexedSources.has(AIRetrieval.identity(row))).length;
        const rejectedMessage = [...Object.keys(rejected).map(code => labels[code]), ...(valid.length && uncovered ? [`当前有效向量尚未覆盖 ${uncovered} 条正文，本地检索参与补齐`] : [])].join('；');
        if (!valid.length) {
            this.lastSearchStatus = { code: records.length ? 'index-invalid' : 'index-empty', embeddingCalls: 0,
                rejected, message: rejectedMessage || '向量索引为空，已使用本地原文检索' };
            return [];
        }
        const embeddingConfig = this.getEmbeddingConfig(config);
        if (!embeddingConfig) {
            this.lastSearchStatus = { code: 'configuration-missing', rejected, embeddingCalls: 0, message: '未配置嵌入模型，已使用本地原文检索' };
            return [];
        }
        this.lastSearchStatus = { code: 'querying', rejected, embeddingCalls: 1, message: rejectedMessage };
        let queryVector;
        try { queryVector = await this.getEmbedding(query, embeddingConfig.apiKey, embeddingConfig.apiEndpoint, embeddingConfig.model, options.signal); }
        catch (error) {
            this.lastSearchStatus = { code: 'service-unavailable', rejected, embeddingCalls: 1, message: '嵌入服务不可用，已使用本地原文检索' };
            if (options.signal?.aborted) throw new DOMException('已停止生成', 'AbortError');
            return [];
        }
        const results = valid.map(item => ({ ...item, score: this.cosineSimilarity(queryVector, item.vector) })).filter(item => item.score !== null);
        this.lastSearchStatus = { code: results.length ? 'ready' : 'query-dimension-mismatch', rejected, embeddingCalls: 1,
            message: results.length ? rejectedMessage : '查询向量与索引维度不一致，已使用本地原文检索' };
        return results.sort((a, b) => b.score - a.score).slice(0, topK);
    },

    /**
     * 检查索引是否为空
     */
    async isIndexEmpty() {
        if (!this.db) await this.init();
        return new Promise((resolve) => {
            const transaction = this.db.transaction([RAG_STORE_NAME], 'readonly');
            const store = transaction.objectStore(RAG_STORE_NAME);
            const countReq = store.count();
            countReq.onsuccess = () => resolve(countReq.result === 0);
            countReq.onerror = () => resolve(true);
        });
    },

    /**
     * 导出当前索引为 JS 文件并下载
     */
    async exportVectorsAsJS(embeddingModel) {
        if (!this.db) await this.init();

        const vectors = {};
        await new Promise((resolve, reject) => {
            const transaction = this.db.transaction([RAG_STORE_NAME], 'readonly');
            const store = transaction.objectStore(RAG_STORE_NAME);
            const request = store.openCursor();
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const item = cursor.value;
                    vectors[item.id] = {
                        type: item.type,
                        clauseId: item.clauseId,
                        title: item.title,
                        vector: item.vector,
                        sourceHash: item.sourceHash || null,
                        titleHash: item.titleHash || null,
                        embeddingSpace: item.embeddingSpace || null,
                        embeddingModel: item.embeddingModel || null,
                        dimension: item.dimension || null
                    };
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = reject;
        });

        const jsContent = `/**
 * vectors-data.js - 预构建的向量索引数据
 * 生成时间: ${new Date().toLocaleString('zh-CN')}
 */
const PREBUILT_VECTORS = {
    version: "1.0.0",
    timestamp: ${Date.now()},
    embeddingModel: ${JSON.stringify(embeddingModel || '')},
    vectors: ${JSON.stringify(vectors, null, 2)}
};
window.PREBUILT_VECTORS = PREBUILT_VECTORS;
`;

        const blob = new Blob([jsContent], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vectors-data.js';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log(`[RAG] 已导出 ${Object.keys(vectors).length} 条向量到 vectors-data.js`);
        return Object.keys(vectors).length;
    },

    /**
     * 动态加载 vectors-data.js（仅在需要时加载，避免首屏解析 22MB JS）
     * @returns {Promise<boolean>} 加载成功返回 true，失败返回 false
     */
    async ensurePrebuiltVectorsLoaded() {
        if (window.PREBUILT_VECTORS && window.PREBUILT_VECTORS.vectors) {
            return true;
        }
        console.log('[RAG] 预构建向量未加载，动态注入 script 标签...');
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'js/vectors-data.js';
            script.onload = () => {
                if (window.PREBUILT_VECTORS && window.PREBUILT_VECTORS.vectors) {
                    const count = Object.keys(window.PREBUILT_VECTORS.vectors).length;
                    console.log(`[RAG] 预构建向量加载完成: ${count} 条`);
                    resolve(true);
                } else {
                    console.warn('[RAG] vectors-data.js 已加载但 PREBUILT_VECTORS 缺失');
                    resolve(false);
                }
            };
            script.onerror = () => {
                console.warn('[RAG] 加载 vectors-data.js 失败（文件可能不存在）');
                resolve(false);
            };
            document.head.appendChild(script);
        });
    },

    /**
     * 将 window.PREBUILT_VECTORS 批量导入 IndexedDB
     * 使用分批事务 + setTimeout 让出 UI 线程，避免页面卡死
     * @param {Function} onProgress - 进度回调 (current, total)
     * @returns {Promise<number>} 成功导入的向量数量
     */
    async importPrebuiltVectors(onProgress) {
        if (!this.db) await this.init();

        if (!window.PREBUILT_VECTORS || !window.PREBUILT_VECTORS.vectors) {
            console.warn('[RAG] 没有可用的预构建向量');
            return 0;
        }

        const vectors = window.PREBUILT_VECTORS.vectors;
        const entries = Object.entries(vectors);
        const total = entries.length;
        console.log(`[RAG] 开始导入 ${total} 条预构建向量...`);

        const BATCH_SIZE = 25;
        let imported = 0;
        let failed = 0;

        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batch = entries.slice(i, i + BATCH_SIZE);

            await new Promise((resolve) => {
                const transaction = this.db.transaction([RAG_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(RAG_STORE_NAME);

                batch.forEach(([id, item]) => {
                    const req = store.put({
                        id: id,
                        type: item.type,
                        clauseId: item.clauseId,
                        title: item.title,
                         vector: item.vector,
                         embeddingModel: item.embeddingModel || window.PREBUILT_VECTORS.embeddingModel || null,
                         sourceHash: item.sourceHash || null,
                         titleHash: item.titleHash || null,
                         embeddingSpace: item.embeddingSpace || null,
                         dimension: item.dimension || item.vector?.length || null,
                         timestamp: Date.now()
                    });
                    req.onsuccess = () => { imported++; };
                    req.onerror = (e) => {
                        failed++;
                        console.error(`[RAG] 导入 ${id} 失败:`, e.target.error);
                    };
                });

                transaction.oncomplete = () => resolve();
                transaction.onerror = (e) => {
                    console.error('[RAG] 事务错误:', e.target.error);
                    resolve(); // 不中断，继续下一批
                };
            });

            if (onProgress) {
                onProgress(Math.min(i + BATCH_SIZE, total), total);
            }

            // 让出 UI 线程，保持页面响应
            await new Promise(r => setTimeout(r, 0));
        }

        console.log(`[RAG] 预构建向量导入完成: ${imported} 成功, ${failed} 失败 (共 ${total})`);
        return imported;
    },

    /**
     * 使用重排序模型对检索结果进行二次排序
     */
    async rerank(query, candidates, config, topN = 5, options = {}) {
        this.lastRerankStatus = { code: 'disabled' };
        if (!config.rerankEnabled) {
            console.log('[RAG] 重排序未启用');
            return candidates.slice(0, topN);
        }

        const rerankEndpoint = config.rerankEndpoint || 'https://dashscope.aliyuncs.com/compatible-api/v1/reranks';
        const rerankApiKey = config.rerankApiKey || config.embeddingApiKey;
        const rerankModel = config.rerankModel || 'qwen3-rerank';

        if (!rerankApiKey) {
            this.lastRerankStatus = { code: 'configuration-missing' };
            console.warn('[RAG] 重排序 API Key 未配置');
            return candidates.slice(0, topN);
        }

        const controller = new AbortController(), cancel = () => controller.abort();
        options.signal?.addEventListener('abort', cancel, { once: true });
        if (options.signal?.aborted) cancel();
        const timer = setTimeout(cancel, 25000);
        this.lastRerankStatus = { code: 'querying', attempted: 1 };
        try {
            const documents = candidates.map(c => `${c.type} Clause ${AIRetrieval.number(c.id ?? c.clauseId, c.type)}: ${c.title}\n${AIRetrieval.snippet(c, query)}`);

            const response = await fetch('/api/retrieval', {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: 'rerank', endpoint: rerankEndpoint, apiKey: rerankApiKey, body: {
                    model: rerankModel, query: query, documents: documents, top_n: Math.min(topN, candidates.length)
                } })
            });

            if (!response.ok) {
                throw new Error(`重排序 API 错误: ${response.status}`);
            }

            const data = await response.json();
            if (data.results && Array.isArray(data.results)) {
                const seen = new Set();
                const results = data.results.filter(r => Number.isInteger(r.index) && r.index >= 0 && r.index < candidates.length && Number.isFinite(r.relevance_score) && !seen.has(r.index) && seen.add(r.index)).map(r => ({
                    ...candidates[r.index],
                    rerankScore: r.relevance_score,
                    originalScore: candidates[r.index].score
                })).slice(0, topN);
                if (results.length) { this.lastRerankStatus = { code: 'ready', attempted: 1 }; return results; }
            }
            this.lastRerankStatus = { code: 'response-invalid', attempted: 1 };
            return candidates.slice(0, topN);
        } catch (error) {
            this.lastRerankStatus = { code: 'service-unavailable', attempted: 1 };
            console.error('[RAG] 重排序失败:', error);
            return candidates.slice(0, topN);
        } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
    }
};

window.RAG = RAG;
