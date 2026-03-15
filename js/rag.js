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
        let dotProduct = 0, normA = 0, normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    },

    /**
     * 调用 API 生成嵌入向量
     */
    async getEmbedding(text, apiKey, apiEndpoint, model) {
        let url = apiEndpoint;
        if (url.includes('/chat/completions')) {
            url = url.replace('/chat/completions', '/embeddings');
        } else if (!url.includes('/embeddings')) {
            url = url.replace(/\/+$/, '') + '/embeddings';
        }
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({ input: text, model: model })
            });
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Embedding API Error ${response.status}: ${errText}`);
            }
            const data = await response.json();
            return data.data[0].embedding;
        } catch (error) {
            console.error('[RAG] Embedding generation failed:', error);
            throw error;
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
            return;
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
    },

    /**
     * 语义搜索
     */
    async findMostRelevant(query, config, topK = 5) {
        if (!this.db) await this.init();

        const embeddingConfig = this.getEmbeddingConfig(config);
        if (!embeddingConfig) {
            throw new Error('嵌入模型配置不完整');
        }

        const queryVector = await this.getEmbedding(
            query, embeddingConfig.apiKey, embeddingConfig.apiEndpoint, embeddingConfig.model
        );

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([RAG_STORE_NAME], 'readonly');
            const store = transaction.objectStore(RAG_STORE_NAME);
            const request = store.openCursor();
            const results = [];

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const item = cursor.value;
                    if (item.vector) {
                        const similarity = this.cosineSimilarity(queryVector, item.vector);
                        results.push({ ...item, score: similarity });
                    }
                    cursor.continue();
                } else {
                    results.sort((a, b) => b.score - a.score);
                    resolve(results.slice(0, topK));
                }
            };
            request.onerror = (err) => reject(err);
        });
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
                        vector: item.vector
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
    embeddingModel: "${embeddingModel || ''}",
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
     * 使用重排序模型对检索结果进行二次排序
     */
    async rerank(query, candidates, config, topN = 5) {
        if (!config.rerankEnabled) {
            console.log('[RAG] 重排序未启用');
            return candidates.slice(0, topN);
        }

        const rerankEndpoint = config.rerankEndpoint || 'https://dashscope.aliyuncs.com/compatible-api/v1/reranks';
        const rerankApiKey = config.rerankApiKey || config.embeddingApiKey;
        const rerankModel = config.rerankModel || 'qwen3-rerank';

        if (!rerankApiKey) {
            console.warn('[RAG] 重排序 API Key 未配置');
            return candidates.slice(0, topN);
        }

        try {
            const documents = candidates.map(c => {
                let content = c.title || '';
                if (c.clauseId) content = `[${c.clauseId}] ${content}`;
                return content;
            });

            const response = await fetch(rerankEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${rerankApiKey}`
                },
                body: JSON.stringify({
                    model: rerankModel,
                    query: query,
                    documents: documents,
                    top_n: Math.min(topN, candidates.length)
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`重排序 API 错误: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            if (data.results && Array.isArray(data.results)) {
                return data.results.map(r => ({
                    ...candidates[r.index],
                    rerankScore: r.relevance_score,
                    originalScore: candidates[r.index].score
                }));
            }
            return candidates.slice(0, topN);
        } catch (error) {
            console.error('[RAG] 重排序失败:', error);
            return candidates.slice(0, topN);
        }
    }
};

window.RAG = RAG;
