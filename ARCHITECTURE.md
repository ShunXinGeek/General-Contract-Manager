# 程序架构速览

## 定位

这是一个**浏览器端、离线优先的单页合同管理工具**：管理多份合同、阅读/编辑条款、检索与交叉引用，并按需接入 AI 和 Firebase 云同步。

## 结构与职责

| 区域 | 关键文件 | 职责 |
| --- | --- | --- |
| 页面与样式 | `index.html`、`css/style.css` | DOM 骨架、三栏工作区、弹窗、主题与响应式布局；`index.html` 按依赖顺序加载脚本。 |
| 消息与进度 | `js/status-center.js`、`js/utils.js` | 顶部动画小猫与消息气泡、统一消息中心、会话历史与筛选、并行任务进度；按通知形式决定气泡是否弹出，保留确认和输入弹窗。 |
| 应用核心 | `js/app.js` | 合同集合、稳定来源 ID 对应的显示顺序、逐合同可见状态、当前合同与每合同 UI 状态；标签渲染、切换、自动保存、引用导航。 |
| 合同工作区 | `import.js`、`editor.js`、`bookmark.js`、`search.js`、`sync.js`、`comparison.js`、`ai-settings.js`、`contract-backup.js` | 导入解析、编辑/批注/导出、书签、全文搜索、双栏同步滚动、版本差异；合同管理页提供拖动及上下按钮排序、可见性切换、逐合同向量覆盖状态、向量化入口及整库备份与恢复。 |
| 正文选区 | `js/selection-tools.js`、`js/editor.js`、`js/search.js` | 浮动工具栏、带出处复制、选区搜索、AI 草稿、审阅标签与格式操作。编辑模块统一记录正文、备注、格式和审阅标签的撤销历史。 |
| AI 与检索 | `ai-assistant.js`、`ai-client.js`、`ai-providers.js`、`rag.js`、`ai-retrieval.js`、`cross-ref.js`、`retrieval-settings.js` | 流式问答、供应商协议适配、向量/证据检索、可见合同范围、检索来源与等级/关系规则、GCC↔SCC 映射与引用校验。 |
| 助手内容 | `assistant-topics.js`、`assistant-notebook.js`、`assistant-attachments.js` | 话题与分支、收藏笔记、TXT/Markdown/PDF/DOCX 附件解析；均本地优先，登录后可同步。 |
| 数据与配置 | `js/general-settings.js`、`MD base/`、`cross-ref-data.js`、`firebase-*.js` | 浮动工具栏和通知形式的本机偏好、合同知识库、交叉引用索引、Firebase 运行时配置。 |
| 云端与部署 | `cloud-storage.js`、`netlify/edge-functions/`、`netlify.toml` | Firebase 认证/Firestore 字段级合并；`/api/ai`、`/api/retrieval` 校验并转发 AI 请求；Netlify 构建与发布。 |
| 离线与质量 | `sw.js`、`tests/`、`scripts/` | 缓存应用外壳并在断网时回退；回归测试、语法/Edge Function 检查。 |

## 运行逻辑

```text
打开页面
  → 加载基础库与 JS 模块
  → general-settings.js 从 localStorage 恢复通用设置，先于 status-center.js 初始化
  → app.js：恢复主题/AI 设置，初始化 RAG 与交叉引用
  → 从 LocalForage 恢复合同和当前状态；无数据则展示欢迎页
  → cloud-storage.js：Firebase 就绪且已登录时，等待本地恢复后执行云同步
```

```text
导入或切换合同
  → contracts 保存合同数据与书签
  → 新导入的合同获得稳定 sourceId，列入检索设置但默认不勾选；重新导入保留已有勾选状态
  → 新合同默认可见；重新导入保留原可见状态和排序位置
  → app.js 捕获旧合同状态，切换 activeContractKey
  → 重渲染正文、书签与反向引用，恢复新合同的滚动、搜索和面板状态
  → LocalForage 持久化；云同步开启时再与 Firestore 合并
```

```text
调整合同顺序或可见性（设置 → 合同管理）
  → 拖动手柄或使用上下按钮调整管理列表顺序；contractOrder 按稳定 sourceId 记录顺序
  → 欢迎页保持在最左侧，可见合同标签按管理列表顺序即时重排
  → 每份合同的 visibility.hidden 控制可见状态；隐藏的合同仍留在管理列表中
  → 隐藏当前合同则返回欢迎页；检索设置、来源下拉菜单、知识库检索及条款引用只使用可见合同
  → 可见状态变化时，已打开的选区搜索结果和审阅标签列表即时更新
  → 恢复可见后，原有检索勾选和来源关系继续生效，标签回到管理列表中的位置
  → 排序和可见状态随合同数据写入 LocalForage；云同步分别合并顺序与逐合同可见状态
```

```text
选中合同正文
  → selection-tools.js 记录选区与所属条款，显示浮动工具栏
  → 按通用设置将各操作放在工具栏或「更多」，复制、颜色、AI 等子菜单随入口一同切换位置
  → 复制默认附上合同名、条款编号和标题，跨条款选区逐段标注出处
  → 选区搜索复用导航栏搜索框，默认查找当前合同，可切换为全部可见合同
  → 结果在浮层中按合同分组，跳转到命中条款后保留搜索词、范围和结果
  → AI 操作将所选文字与出处加入当前话题草稿，用户在助手中编辑并发送
  → 审阅标签列表从搜索框旁的入口打开，支持按标签筛选和跳回原文
```

```text
调整通用设置（设置 → 通用设置）
  → 勾选浮动工具栏中直接显示的操作，其余操作进入「更多」；保存后对各合同页生效
  → 通知形式选择静默、普通或全部；默认全部通知
  → 静默仅显示未读红点；普通只让错误和异常警告弹出气泡；全部让各类消息弹出气泡
  → 消息仍写入本次页面会话的消息中心，打开中心后标记为已读
  → 偏好保存在本机 localStorage，刷新后恢复
```

```text
AI 提问（可选知识库模式）
  → 仅从可见且在检索设置中已勾选的合同取回证据；无有效向量时仍使用当前范围内的原文检索
  → ai-retrieval.js / RAG / cross-ref 选择合同证据和关联条款
  → ai-client.js 向同源 /api/ai 发送流式请求
  → Netlify Edge Function 校验请求、白名单目标地址后转发供应商
  → ai-assistant.js 实时渲染回答、校验引用并保存话题记录
```

```text
合同向量化（设置 → 合同管理）
  → RAG.getIndexStatus 检查全部已导入合同的有效向量覆盖情况，与检索勾选状态无关
  → 配置 Embedding 后，RAG.buildIndex 对可见合同补齐缺失或失效的条款向量
  → 每份合同显示覆盖状态；向量保存在本机 IndexedDB
  → 知识库问答仍只在已勾选来源内使用有效向量和原文
```

```text
合同备份与恢复（设置 → 合同管理）
  → “备份全部合同”先捕获当前正文和书签，再读取所有合同及与正文匹配的本机向量
  → 生成一个带格式版本号的 gzip 压缩 JSON 文件，浏览器支持时由“另存为”选择目录，否则下载文件
  → “从备份恢复”直接读取 gzip 文件，校验合同与向量，预览合同、条款、匹配向量及冲突
  → 冲突默认保留现有合同；勾选的合同才由备份替换
  → 先写入合同快照，再以 IndexedDB 事务更新相应来源的向量；向量写入失败时回滚合同快照
  → 重建原文运行时视图、标签与检索状态；恢复到新浏览器的来源沿用导入时的检索范围默认值
```

## 数据边界

- **本地默认**：合同、工作区数据、`contractOrder` 和逐合同 `visibility` 存于 LocalForage/IndexedDB；主题、AI 设置和通用设置存于 `localStorage`；RAG 索引存于 IndexedDB。旧合同没有可见状态时默认为可见，旧快照没有排序记录时沿用合同原有顺序。旧设备没有通用设置时沿用原工具栏布局和全部通知。
- **便携备份**：`js/contract-backup.js` 将所有合同的 `originalContent`、当前 `content`、译文、备注与格式、审阅标签、书签、来源 ID、顺序和可见性，以及与当前条款内容匹配的向量，写入单个 `.gcm-backup.json.gz` 文件。原始导入文件的字节和 AI 密钥不在文件中。恢复时按来源 ID 关联向量；模型或服务地址不匹配的向量需在目标设备配置相应 Embedding 设置后使用。
- **通用设置**：`js/general-settings.js` 使用 `gcm_general_settings` 保存各工具栏操作的直显状态和 `silent`、`normal`、`all` 通知形式。偏好仅存于当前浏览器，不进入 Firebase 合同或 AI 设置快照。消息中心记录只保留本次页面会话，静默与普通模式仍累计未读消息；普通模式中的搜索「无匹配」属于搜索状态，不触发异常弹窗。
- **审阅标签**保存在条款的 `reviewTags` 字段，使用摘录、文字偏移和前后文定位。标签随合同进入本地快照、修改备份和云端条款合并。
- **编辑撤销**涵盖正文编辑、备注、格式和标签。当前页面会话为每份合同保留最多 50 步，连续输入可合并为一步。Ctrl+Z 恢复当前合同的最近一次修改并保存，普通输入框继续使用浏览器原生文字撤销。
- **检索设置**：来源以稳定 `sourceId` 标识；新版设置默认不勾选新来源，旧版设置迁移时保留原检索范围。隐藏合同不出现在检索设置中，也不参与检索，原勾选、等级及来源关系保留以便恢复可见。双方都有数字等级时以等级为准；任一方未设等级时使用显式来源关系。冲突或循环关系不可保存；旧快照中的冲突关系不会参与检索。
- **云端可选**：登录 Firebase 后，合同、检索设置、话题和笔记按 `modifiedAt` 等字段合并到 Firestore；合同顺序写入主文档 `contract_order`，可见状态写入每份合同的元数据，分别按修改时间合并。检索设置合并保留另一端新增合同的来源记录，本地恢复先完成，避免启动覆盖。
- **AI 密钥与请求**：浏览器配置密钥，实际请求经同源 Edge Function 转发；服务端负责来源、体积、限流和目标地址限制。

## 维护入口

- 修改界面：`index.html` + `css/style.css`
- 修改通用设置：`js/general-settings.js`、`js/ai-settings.js`；工具栏入口见 `js/selection-tools.js`，消息气泡见 `js/status-center.js`
- 修改合同主流程/状态：`js/app.js`
- 修改整库备份与恢复：`js/contract-backup.js`；入口见 `index.html` 的合同管理页，向量读写见 `js/rag.js`
- 选区工具栏与结果浮层见 `js/selection-tools.js`，撤销与标签持久化见 `js/editor.js`
- 修改 AI/检索：先看 `js/ai-assistant.js`，再按需进入 `ai-*.js`、`rag.js`、`cross-ref.js`
- 修改检索设置或向量覆盖：`js/retrieval-settings.js`、`js/ai-settings.js`、`js/rag.js`
- 修改云同步或转发：`js/cloud-storage.js`、`netlify/edge-functions/`
- 验证：`npm test`；静态与 Edge Function 检查：`npm run check`
- 合同排序与可见性浏览器回归：`node tests/tab-cloud-browser.test.js`
- 整库备份、恢复与回滚浏览器回归：`node tests/contract-backup-browser.test.js`
- 运行 `node tests/selection-tools-browser.test.js` 验证选区工具栏
- 运行 `node tests/mascot-browser.test.js` 验证三种通知形式和未读消息
