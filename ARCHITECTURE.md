# 程序架构速览

## 定位

这是一个**浏览器端、离线优先的单页合同管理工具**：管理多份合同、阅读/编辑条款、检索与交叉引用，并按需接入 AI 和 Firebase 云同步。

## 结构与职责

| 区域 | 关键文件 | 职责 |
| --- | --- | --- |
| 页面与样式 | `index.html`、`css/style.css` | DOM 骨架、三栏工作区、弹窗、主题与响应式布局；`index.html` 按依赖顺序加载脚本。 |
| 消息与进度 | `js/status-center.js`、`js/utils.js` | 顶部动画小猫与消息气泡、统一消息中心、会话历史与筛选、并行任务进度；保留确认和输入弹窗。 |
| 应用核心 | `js/app.js` | 合同集合、当前合同与每合同 UI 状态；渲染、切换、自动保存、引用导航。 |
| 合同工作区 | `import.js`、`editor.js`、`bookmark.js`、`search.js`、`sync.js`、`comparison.js` | 导入解析、编辑/批注/导出、书签、全文搜索、双栏同步滚动、版本差异。 |
| AI 与检索 | `ai-assistant.js`、`ai-client.js`、`ai-providers.js`、`rag.js`、`ai-retrieval.js`、`cross-ref.js` | 流式问答、供应商协议适配、向量/证据检索、GCC↔SCC 映射与引用校验。 |
| 助手内容 | `assistant-topics.js`、`assistant-notebook.js`、`assistant-attachments.js` | 话题与分支、收藏笔记、TXT/Markdown/PDF/DOCX 附件解析；均本地优先，登录后可同步。 |
| 数据与配置 | `MD base/`、`cross-ref-data.js`、`retrieval-*.js`、`firebase-*.js` | 合同知识库、交叉引用索引、检索来源/权威性配置、Firebase 运行时配置。 |
| 云端与部署 | `cloud-storage.js`、`netlify/edge-functions/`、`netlify.toml` | Firebase 认证/Firestore 字段级合并；`/api/ai`、`/api/retrieval` 校验并转发 AI 请求；Netlify 构建与发布。 |
| 离线与质量 | `sw.js`、`tests/`、`scripts/` | 缓存应用外壳并在断网时回退；回归测试、语法/Edge Function 检查。 |

## 运行逻辑

```text
打开页面
  → 加载基础库与 JS 模块
  → app.js：恢复主题/AI 设置，初始化 RAG 与交叉引用
  → 从 LocalForage 恢复合同和当前状态；无数据则展示欢迎页
  → cloud-storage.js：Firebase 就绪且已登录时，等待本地恢复后执行云同步
```

```text
导入或切换合同
  → contracts 保存合同数据与书签
  → app.js 捕获旧合同状态，切换 activeContractKey
  → 重渲染正文、书签与反向引用，恢复新合同的滚动、搜索和面板状态
  → LocalForage 持久化；云同步开启时再与 Firestore 合并
```

```text
AI 提问（可选知识库模式）
  → ai-retrieval.js / RAG / cross-ref 选择合同证据和关联条款
  → ai-client.js 向同源 /api/ai 发送流式请求
  → Netlify Edge Function 校验请求、白名单目标地址后转发供应商
  → ai-assistant.js 实时渲染回答、校验引用并保存话题记录
```

## 数据边界

- **本地默认**：合同及工作区数据存于 LocalForage/IndexedDB；主题和 AI 设置存于 `localStorage`；RAG 索引存于 IndexedDB。
- **云端可选**：登录 Firebase 后，合同、话题和笔记按 `modifiedAt` 等字段合并到 Firestore；本地恢复先完成，避免启动覆盖。
- **AI 密钥与请求**：浏览器配置密钥，实际请求经同源 Edge Function 转发；服务端负责来源、体积、限流和目标地址限制。

## 维护入口

- 修改界面：`index.html` + `css/style.css`
- 修改合同主流程/状态：`js/app.js`
- 修改 AI/检索：先看 `js/ai-assistant.js`，再按需进入 `ai-*.js`、`rag.js`、`cross-ref.js`
- 修改云同步或转发：`js/cloud-storage.js`、`netlify/edge-functions/`
- 验证：`npm test`；静态与 Edge Function 检查：`npm run check`
