# 通用合同管理助手 (General Contract Manager)

## 1. 程序简介

通用合同管理助手是一款基于 Web 的纯前端应用（支持离线运行 PWA 和云端同步），旨在为法律专业人士、企业法务及合同管理者提供高效、智能化、结构化的合同阅读、审阅、编辑及管理体验。通过引入 AI 大模型能力，实现了合同条款智能问答、知识库检索增强（RAG）、GCC/SCC 双层合同交叉引用分析以及双语辅助阅读等多种高级功能。

**核心技术栈：** 纯 HTML/CSS/JS（零框架依赖） + IndexedDB (LocalForage) + Firebase Firestore + Service Worker (PWA)

**设计理念：** 本地优先 (Local-First)，数据完全存储在用户浏览器中，云端同步为可选增强功能。所有第三方 API Key 仅保存在用户本地存储，不经过任何中间服务器。

---

## 2. 功能特点

### 2.1 多合同并行管理
- **多标签页架构**：支持同时打开多份合同（多标签页），各标签页的工作区视图状态、引用面板收起/展开状态、面板宽度、书签栏滚动位置、搜索状态、同步滚动状态均相互独立、互不干扰
- **动态合同注册**：支持任意合同类型（GCC、SCC、自定义合同），自动从导入文件推断合同元数据
- **欢迎页控制台**：集中查看所有已导入合同的卡片视图，支持原地重命名（短名和完整名称）和删除操作
- **合同管理面板**（设置 → 📁 合同管理）：表格化管理所有合同，支持行内编辑标签名和完整名称

### 2.2 智能化 AI 助手
- **多模型管理**：支持添加、编辑、删除多个兼容 OpenAI 格式的大语言模型（如 GLM-4、DeepSeek、GPT 系列等），一键切换当前使用的模型；API Key 经由简单 Base64 混淆后存储于 localStorage
- **流式对话**：支持 SSE (Server-Sent Events) 流式输出，实时显示 AI 回复内容
- **思考模式 (Thinking Mode)**：支持 `reasoning_content` 的深度思考模型（如 QwQ、DeepSeek-R1），以折叠面板展示 AI 思考过程及耗时
- **上下文管理**：支持"终止上下文"功能，在对话中插入断点标记，后续对话只使用断点之后的消息上下文
- **对话持久化**：聊天记录自动保存到 IndexedDB，刷新页面后自动恢复
- **消息操作**：支持复制消息、重新生成回复、删除单条消息
- **条款引用选择器**：可视化双栏条款浏览器，支持分别搜索两个合同的条款，点击即可将条款全文插入输入框
- **条款超链接跳转**：AI 回复中的 `[合同简称] Clause X` 格式文本自动转换为可点击的超链接，点击后跳转到对应条款（或在内置参考面板查看）
- **动态系统提示词**：根据当前已导入的合同类型（GCC/SCC 等）自动生成精准的 System Prompt，引导 AI 使用正确的条款引用格式

### 2.3 RAG 知识库检索增强
- **向量语义搜索**：通过 Embedding API 将全部合同条款向量化，存入 IndexedDB 向量数据库，支持余弦相似度语义搜索
- **Rerank 二次精排**：可选的 Rerank 模型（如 qwen3-rerank）对初步检索结果进行二次语义重排序，提升检索精度
- **预构建向量**：支持导出向量索引为 `vectors-data.js`，通过"懒加载"机制在首次使用时动态加载，避免首屏解析大文件；支持从预构建向量直接导入 IndexedDB，免去在线构建的 API 调用耗时
- **交叉引用优先**：开启知识库模式后，优先使用 GCC↔SCC 交叉引用索引进行确定性条款查找（准确率更高），仅在交叉引用未命中时回退到 RAG 向量搜索
- **跨合同引用扩展**：自动查找引用当前结果条款的其他合同条款，一并提供给 AI

### 2.4 GCC ↔ SCC 交叉引用系统
- **交叉引用索引**：基于预编译的 `cross-ref-data.js` 数据（源自 `MD base/cross-reference.md`），覆盖全部 90 条 GCC 条款与约 130 条 SCC 特别条款的映射关系
- **双层文件体系**：GCC（通用合同条件，基准文本）+ SCC（特别合同条件，修改令），SCC 效力优先于 GCC
- **五类修改关系**：新增、删除替换、修改/扩展、间接引用、无修改
- **智能条款查找**：三阶段查找策略 — 直接条款编号匹配 → 关键词索引匹配（支持中英文） → LLM 辅助子句识别（回退）
- **Not Used 条款过滤**：自动排除约 55 条标记为 "(Not used)" 的 SCC 条款
- **交叉引用专用 Prompt 模板**：自动构建包含修改类型标注（删除替换/大幅修改/扩展等）的精准提示词，引导 AI 明确标注"以 SCC 为准"

### 2.5 强大的阅读与辅助外设
- **三栏式工作区布局**：左侧书签导航栏 + 中间主阅读区 + 右侧参考视图 (Reference View)；面板宽度可拖拽调整，每合同独立记忆
- **双重阅读模式**：
  - 引用模式 (Ref)：点击条款内蓝色 `Clause X` 链接，右侧面板展示被引用条款的英文原文
  - 翻译模式 (Trans)：点击条款标题，右侧面板展示该条款的完整中文译文
- **跨合同引用**：当条款中出现 `[其他合同简称] Clause X` 格式时，自动链接并支持跨合同查看
- **反向引用索引**：自动构建"谁引用了我"的索引，在 Reference View 底部展示
- **引用导航历史**：前进/后退按钮 + 上一条/下一条快捷导航
- **中英同步滚动**：针对双语版本，开启后中间原文与右侧译文双屏自动精准对齐（基于条款标题正则匹配 + 滚动同步引擎）
- **简繁中文切换**：支持在简体中文和繁体中文字体译文之间一键切换

### 2.6 书签与层级管理
- **可折叠双层书签树**：支持 Level 0（父级）和 Level 1（子级）两层结构，父级可折叠
- **拖拽排序**：书签项支持拖拽重排
- **书签操作**：添加书签（自动捕获当前可见条款）、重命名、删除、升级/降级层级、一键重置
- **删除模式**：开启后可视化管理书签删除
- **精确滚动定位**：每个书签记录创建时的精确滚动位置，点击后恢复到当时浏览的准确位置

### 2.7 批注与行内富文本编辑
- **浮动格式工具栏**：选中文本后自动弹出，提供高亮颜色（橙/绿/蓝/紫）、字体颜色（红/黄/蓝/紫）、加粗、清除格式
- **备注 (Note) 批注**：选中文本添加备注，备注区域以特殊样式高亮，鼠标悬停时显示气泡提示
- **编辑模式锁**：正常模式下条款为只读（防止误改），开启编辑模式后解锁 contenteditable

### 2.8 版本对比
- **原始数据副本**：导入时自动创建 `ORIGINAL_CONTRACTS` 深拷贝快照
- **修改检测**：自动对比当前内容与原始内容（经过 HTML 标签规范化和空白归一化），在条款标题旁显示"已修改"标记
- **原文对比弹窗**：点击修改标记展示并排对比视图

### 2.9 全文搜索
- **两级优先搜索**：第一优先搜索书签名称 (label)，命中则显示匹配书签；第二优先搜索正文内容，显示匹配内容所属章节的书签
- **正文高亮**：搜索词在中间主阅读区高亮显示，支持上一个/下一个跳转
- **搜索清除**：输入框右侧显示清除按钮

### 2.10 文档导入导出
- **导入**：
  - 导入标准 TXT 合同条款文件（自动解析 Markdown 格式的条款标题和正文、提取 CONTRACT_META 元数据块）
  - 导入本地 JSON 修改数据备份（恢复之前导出的修改）
- **导出**：
  - 导出为带审阅批注的 Word (.docx) — 包含高亮、字体颜色、备注等修改痕迹
  - 导出为基础版 Word (.docx) — 纯净版本，无批注标记
  - 导出为 PDF — 基于 html2pdf.js
- **自动保存**：每 30 秒自动保存当前编辑内容到 localStorage

### 2.11 云备份与多端同步 (Firebase)
- **Firebase Auth 认证**：支持邮箱/密码登录和注册
- **子集合分片存储**：突破 Firestore 单文档 1 MiB 限制，采用主文档（元数据）+ modifications/bookmarks/contract_data 子集合架构，超大合同自动分批存储
- **字段级智能合并同步**：比较本地和云端每个条款的 `modifiedAt` 时间戳，逐字段保留较新版本，避免简单覆盖导致数据丢失
- **自动定时同步**：登录后每 5 分钟自动执行双向同步
- **手动同步操作**：支持"立即同步"、"强制上传本地数据"、"强制下载云端数据"
- **同步范围**：条款修改内容、书签（含层级和折叠状态）、AI 模型配置、Embedding/Rerank 配置、系统提示词、主题设置、Firebase 配置本身、完整合同数据（条款原文+译文）
- **格式兼容**：新格式（子集合）自动兼容旧格式（单文档存储），保存时自动迁移
- **离线感知**：在线状态检测，离线时自动暂停同步并显示黄色提示条

### 2.12 主题与用户体验
- **三主题切换**：日间模式 ☀️ / 护眼模式 🌿 / 夜间模式 🌙
- **PWA 离线支持**：Service Worker 注册，完全离线可用（AI 和云同步除外）
- **离线状态提示**：顶部黄色警告条提示当前离线状态
- **运行日志系统**：双槽位轮转日志（512KB × 2），自动记录时间戳/级别/模块来源，拦截 `console.error`/`console.warn` 和全局未捕获错误，支持控制台查看和导出
- **自定义异步对话框**：替代原生 alert/confirm/prompt，风格与应用统一
- **状态提示条**：页面底部浮动状态提示（成功/错误/警告/加载中）
- **响应式布局**：适配桌面端和移动端（小屏幕自动切换面板显隐模式）

---

## 3. 系统架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      index.html (DOM 骨架)                    │
│   Header (标签栏+工具栏) | Workspace (三栏布局) | Modals     │
└──────────────────────────┬──────────────────────────────────┘
                           │
    ┌──────────────────────┼──────────────────────┐
    │                      │                      │
    ▼                      ▼                      ▼
┌──────────┐    ┌──────────────────┐    ┌──────────────────┐
│  CSS 层   │    │    JS 业务逻辑层   │    │   外部服务层      │
│ style.css │    │  (19 个模块文件)   │    │                  │
│  · 主题   │    │                  │    │ · Firebase Auth  │
│  · 布局   │    │  详见 3.2 模块表   │    │ · Firestore DB   │
│  · 动效   │    │                  │    │ · AI API (OpenAI │
└──────────┘    └──────────────────┘    │   兼容格式)       │
                                        │ · Embedding API  │
                                        │ · Rerank API     │
                                        └──────────────────┘
```

### 3.2 文件结构与模块职责

```
General Contract Manager/
├── index.html              # 系统主界面入口，包含完整 DOM 结构定义与外部库加载
├── css/
│   └── style.css           # 全局样式：三栏布局、主题配色、交互动效、响应式
├── js/
│   ├── utils.js            # [基础层] 通用工具：HTML 转义/净化、状态提示条、
│   │                       #   API Key 混淆加密、自定义异步对话框 (alert/confirm/prompt)
│   ├── logger.js           # [基础层] 运行日志系统：双槽位轮转日志 (512KB×2)、
│   │                       #   四级日志级别、console 拦截、全局错误捕获、导出/查看
│   ├── config.js           # [基础层] 全局 AI 配置常量、默认 Embedding/Rerank 模型、
│   │                       #   默认 System Prompt、动态提示词生成函数
│   ├── vectors-data.js     # [数据层] 预构建向量索引数据 (可选，由 RAG 懒加载)
│   ├── cross-ref-data.js   # [数据层] GCC↔SCC 交叉引用索引数据 (90条GCC + ~130条SCC)
│   ├── firebase-config.js  # [数据层] Firebase 项目配置占位符
│   │
│   ├── app.js              # [核心层] 应用主控制器
│   │                       #   · 全局状态管理 (contracts, fullClauseDatabase, etc.)
│   │                       #   · 合同注册/移除/切换 (registerContract, switchContract, removeContract)
│   │                       #   · 动态标签栏渲染 (renderTabs)
│   │                       #   · IndexedDB 数据持久化 (LocalForage)
│   │                       #   · 欢迎页控制台 (showWelcomePage)
│   │                       #   · 主题切换 (cycleTheme, applyTheme)
│   │                       #   · 主文档渲染 (renderMainDocument)
│   │                       #   · 反向引用索引构建 (buildReverseIndex)
│   │                       #   · 自动条款链接 (autoLinkClauses)
│   │                       #   · 引用导航 (navigateToRef, goRefBack/Forward/Step)
│   │                       #   · 跨合同引用 (showCrossContractRef)
│   │                       #   · 浮动格式工具栏 (checkSelection, applyFormat)
│   │                       #   · 拖拽面板分隔条 (initResizers, setupResizer)
│   │                       #   · 每合同独立状态持久化
│   │
│   ├── bookmark.js         # [核心层] 书签管理模块
│   │                       #   · 书签树初始化与渲染
│   │                       #   · 层级管理 (Level 0/1 折叠)
│   │                       #   · 拖拽排序 (HTML5 Drag & Drop)
│   │                       #   · 精确滚动定位 (记录 scrollTop)
│   │                       #   · 删除模式 / 重命名 / 重置
│   │
│   ├── editor.js           # [核心层] 编辑与导出模块
│   │                       #   · 编辑模式锁定/解锁
│   │                       #   · 备注 (Note) 添加/编辑/气泡显示
│   │                       #   · 自动保存 (30秒定时器，仅当有修改)
│   │                       #   · 导出 Word (.docx) — 含批注版 & 纯净版
│   │                       #   · 导出 PDF (html2pdf.js)
│   │                       #   · 用户修改提取 (extractAllUserModifications)
│   │                       #   · 撤销/重做 (max 50 步)
│   │
│   ├── sync.js             # [核心层] 同步滚动引擎
│   │                       #   · 中英原文译文双屏同步滚动
│   │                       #   · 基于条款标题正则匹配的段落对齐
│   │                       #   · 每合同独立同步状态
│   │                       #   · 高亮当前段落指示
│   │
│   ├── search.js           # [核心层] 全文搜索模块
│   │                       #   · 两级优先搜索 (书签名 → 正文内容)
│   │                       #   · 正文搜索词高亮 + 上/下一个跳转
│   │                       #   · 搜索结果统计
│   │
│   ├── comparison.js       # [核心层] 版本对比模块
│   │                       #   · ORIGINAL_CONTRACTS 原始快照对比
│   │                       #   · 修改检测（HTML 规范化 + 空白归一化）
│   │                       #   · 原文对比弹窗（并排展示原始 vs 当前）
│   │
│   ├── import.js           # [核心层] 文件导入模块
│   │                       #   · TXT 合同条款解析 (Markdown 格式)
│   │                       #   · CONTRACT_META 元数据提取
│   │                       #   · JSON 修改数据备份导入
│   │                       #   · 重复合同覆盖确认
│   │
│   ├── ai-assistant.js     # [AI 层] AI 管理助手核心
│   │                       #   · 助手面板切换 (switchToAssistant)
│   │                       #   · SSE 流式 API 调用与响应解析
│   │                       #   · 思考模式 (reasoning_content 处理)
│   │                       #   · Markdown 渲染 + 条款超链接自动转换
│   │                       #   · 条款引用选择器 (双栏弹窗)
│   │                       #   · 助手右侧条款参考面板
│   │                       #   · 知识库模式 (RAG + 交叉引用联合查找)
│   │                       #   · 关键词提取与多策略条款检索
│   │                       #   · 聊天记录 IndexedDB 持久化
│   │
│   ├── ai-settings.js      # [AI 层] AI 设置与模型管理
│   │                       #   · 设置弹窗三标签页 (AI/Firebase/合同管理)
│   │                       #   · 多模型 CRUD (增删改查)
│   │                       #   · 模型选择下拉框渲染与切换
│   │                       #   · 当前模型持久化 (localStorage)
│   │                       #   · AI 设置保存/加载 (含 API Key 混淆)
│   │                       #   · Firebase 配置保存/刷新
│   │                       #   · 合同管理 Tab (行内编辑标签名/名称)
│   │
│   ├── rag.js              # [AI 层] RAG 向量检索模块
│   │                       #   · IndexedDB 向量数据库管理
│   │                       #   · Embedding API 调用 (兼容 OpenAI 格式)
│   │                       #   · 余弦相似度计算
│   │                       #   · 批量向量索引构建 (分批、进度回调)
│   │                       #   · 语义搜索 (top-K)
│   │                       #   · Rerank 二次精排 (兼容 DashScope 格式)
│   │                       #   · 向量导出为 JS 文件
│   │                       #   · 预构建向量懒加载
│   │                       #   · 预构建向量分批导入 (每批 25 条 + setTimeout 让出 UI)
│   │
│   ├── cross-ref.js        # [AI 层] GCC↔SCC 交叉引用查询引擎
│   │                       #   · 交叉引用内存索引构建 (initCrossRefIndex)
│   │                       #   · 核心查找函数 (lookupCrossRef) — GCC → SCC 映射
│   │                       #   · 多策略条款查找 (findByCrossRef)：
│   │                       #     Phase A: 条款编号直接匹配
│   │                       #     Phase B: 关键词索引匹配
│   │                       #     Phase C: LLM 辅助子句识别 (回退)
│   │                       #   · SCC 引用解析 (parseSCCRef) — 支持多种键名格式
│   │                       #   · 交叉引用专用 Prompt 模板 (buildCrossRefPrompt)
│   │                       #   · 一致性校验 (verifyCrossRefConsistency)
│   │                       #   · Not Used SCC 过滤
│   │
│   ├── cloud-storage.js    # [云端层] Firebase 云存储模块
│   │                       #   · Firebase 初始化与 SDK 等待
│   │                       #   · 邮箱/密码认证 (登录/注册/登出)
│   │                       #   · 子集合分片存储 (主文档 + modifications/bookmarks/contract_data)
│   │                       #   · 自动分批 (单合同 >900KB 时拆分为多批次)
│   │                       #   · 字段级智能合并同步 (比较 modifiedAt 逐字段决策)
│   │                       #   · 自动定时同步 (每5分钟)
│   │                       #   · 旧格式自动迁移 (单文档 → 子集合)
│   │                       #   · 云端数据下载并应用到本地 (applyCloudDataToLocal)
│   │                       #   · 云备份 UI (登录/同步/强制上传/强制下载 对话框)
│   │                       #   · 诊断工具 (Firestore 文档大小分析)
│   │
│   └── cross-ref-data.js   # [数据层] GCC↔SCC 交叉引用索引
│       # (已在上面列出，此处属于数据文件)
│
├── MD base/                 # 合同知识库文档
│   ├── GCC.md              # 通用合同条件原文 (90 条条款)
│   ├── SCC.md              # 特别合同条件原文 (~130 条特别条款)
│   ├── cross-reference.md  # GCC↔SCC 交叉索引表 (条款映射、修改类型、SCC 分类)
│   └── OVERVIEW.md         # 合同查询系统总体说明 (双层文件体系、查询逻辑)
│
├── sw.js                   # Service Worker (PWA 离线支持)
└── README.md               # 本文件
```

### 3.3 模块依赖关系图

```
                    ┌─────────────┐
                    │  utils.js   │ (最先加载，零依赖)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌───────────┐
        │logger.js │ │config.js │ │vectors-   │
        │          │ │          │ │data.js    │
        └──────────┘ └────┬─────┘ └───────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────────┐
        │ rag.js   │ │cross-ref │ │cross-ref-    │
        │          │ │-data.js  │ │.js (引擎)     │
        └────┬─────┘ └──────────┘ └──────┬───────┘
             │                           │
             └───────────┬───────────────┘
                         ▼
                   ┌──────────┐
                   │ app.js   │ (主控制器)
                   └────┬─────┘
                        │
     ┌──────────────────┼──────────────────────┐
     │        │         │         │            │
     ▼        ▼         ▼         ▼            ▼
┌────────┐┌────────┐┌────────┐┌──────────┐┌──────────┐
│bookmark││editor  ││sync    ││search    ││comparison│
│.js     ││.js     ││.js     ││.js       ││.js       │
└────────┘└────┬───┘└────────┘└──────────┘└──────────┘
               │
               ▼
        ┌──────────┐
        │import.js │
        └──────────┘

     ┌──────────────────────────┐
     │  (依赖 app.js + config)   │
     ├──────────────────────────┤
     │  ai-settings.js          │
     │  ai-assistant.js         │
     │  cloud-storage.js        │
     └──────────────────────────┘
```

### 3.4 数据流架构

```
┌─────────────────────────────────────────────────────────────┐
│                        数据存储层                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  LocalForage  │  │  localStorage │  │  IndexedDB (RAG) │  │
│  │  (合同数据)    │  │  (AI设置/主题) │  │  (向量数据库)     │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Firebase Firestore (云端)                 │   │
│  │  · 主文档 (元数据)                                      │   │
│  │  · modifications 子集合                                │   │
│  │  · bookmarks 子集合                                    │   │
│  │  · contract_data 子集合 (含自动分批)                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        运行时状态                              │
│                                                             │
│  contracts: { key → { title, data, bookmarks } }            │
│  activeContractKey: string                                  │
│  fullClauseDatabase: { clauseId → { title, content, ... } } │
│  savedBookmarks: [{ id, label, uid, level, collapsed }]     │
│  isSyncMode / isEditMode / isKnowledgeBaseMode / ...        │
│                                                             │
│  每合同独立状态 (Per-Contract State):                         │
│  searchStatePerContract, refViewStatePerContract,           │
│  navScrollPerContract, mainScrollPerContract,               │
│  syncStatePerContract, navWidthPerContract, ...             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 运行逻辑与机制

### 4.1 初始化流程
1. `window.onload` → 恢复主题 → 加载 AI 设置 → 初始化模型选择器
2. 初始化 RAG 向量数据库 (IndexedDB)
3. 初始化交叉引用索引 (`cross-ref-data.js` → `cross-ref.js`)
4. 初始化面板拖拽分隔条
5. 启动自动保存定时器
6. 从 IndexedDB 加载合同数据 → 如有数据则切换到第一个合同，否则显示欢迎页
7. `DOMContentLoaded` → 初始化 Firebase 云存储（异步，不阻塞主流程）

### 4.2 合同切换流程
1. 保存当前合同全部状态到 `*PerContract` 对象
2. 同步当前编辑内容到内存 (`captureCurrentContent`)
3. 同步书签到合同对象 (`contracts[key].bookmarks = savedBookmarks`)
4. 重置交叉引用状态 → 切换 `activeContractKey` → 恢复新合同的独立状态
5. 重新渲染主文档、书签、反向引用索引 → 恢复搜索状态、同步状态、面板宽度和折叠状态

### 4.3 AI 问答流程
1. 用户发送消息 → `sendMessage()` → 检查 AI 是否已配置
2. 构建消息列表 (`buildMessagesForAPI`):
   - 如开启知识库模式 → 先查交叉引用索引 (确定性) → 再查 RAG (语义搜索) → 构建专用 Prompt
   - 如开启思考模式 → 追加 `<think>` 标签提示
3. 发起 SSE 流式请求 → 实时解析 `data:` 行 → 分流处理 `reasoning_content` 和 `content`
4. 渲染 Markdown (marked.js) → 自动将条款引用转换为可点击超链接
5. 保存聊天记录到 IndexedDB

### 4.4 云同步流程
1. 登录后自动触发：云端优先下载 (`loadFromCloud` → `applyCloudDataToLocal`)
2. 本地修改时更新 `modifiedAt` 时间戳
3. 自动同步定时器触发 → 字段级合并 (`mergeFieldLevel`):
   - 比较每个条款的本地和云端 `modifiedAt`
   - 本地较新 → 保留本地；云端较新 → 应用到本地
   - 合并结果上传到云端（`writeDataToSubcollections`）

---

## 5. 操作与使用说明

### 5.1 初始化与系统设置
1. 点击界面顶部 ⚙️ 按钮进入设置面板，包含三个标签页：
   - **AI 助手设置**：管理对话模型（添加/编辑/删除）、配置 Embedding 模型、Rerank 模型、自定义 System Prompt
   - **Firebase 配置设置**：填写 Firebase 项目凭证，用于云端同步
   - **📁 合同管理**：表格化管理已导入合同，支持行内重命名和删除
2. 在 AI 助手设置中点击"添加新模型"，填入模型名称、Base URL、API Key 和 Model 名称
3. AI 助手工具栏的下拉框中选择当前使用的模型

### 5.2 导入与合同管理
1. 点击顶部 📥 导入按钮，选择：
   - **导入本地修改数据 (.json)**：恢复之前导出的修改备份
   - **导入合同条款 (.txt)**：导入标准 Markdown 格式合同文件
2. 合同文件头部可包含 `[CONTRACT_META]` 元数据块，定义合同简称和全称：
   ```markdown
   [CONTRACT_META]
   shortName: GCC
   fullName: General Conditions of Contract
   [/CONTRACT_META]
   ```
3. 导入成功后左侧自动生成可折叠书签导航树，顶部标签栏新增合同标签
4. 欢迎页控制台支持原地重命名（点击短名或完整名称编辑）和删除操作

### 5.3 沉浸式阅读与批注审阅
1. 点击左侧书签导航某条款，中间主面板自动滚动到对应位置
2. **批注与排版**：鼠标选中条款文本，松开后弹出浮动工具栏，可选择高亮颜色、字体颜色、加粗或添加备注批注
3. **右侧 Reference 视图**：
   - 点击主视图内的蓝色条款标题 → 右侧展开该条款完整中文译文
   - 点击条款内的蓝色 `Clause X` 链接 → 右侧展示被引用条款的完整英文原文
   - 跨合同引用自动链接（如 GCC 条款中引用 SCC 条款）
4. **同步滚动**：点击顶部 🔗 按钮开启中英同步滚动
5. **编辑模式**：点击 🔒 按钮切换编辑/锁定状态

### 5.4 AI 分析助手
1. 点击顶部"管理助手"标签切换至 AI 面板
2. 使用"引用条款"按钮可视化选择条款全文并插入输入框
3. 切换"思考模式"查看 AI 推理过程
4. 切换"知识库模式"启用 RAG 语义搜索 + 交叉引用索引
5. 点击 AI 回复中的条款链接直接跳转到对应原文

### 5.5 导出审阅文档
1. 点击顶部 📤 导出按钮：
   - **导出为带批注 Word (.docx)**：包含高亮、颜色、备注的完整审阅稿
   - **导出为基础版 Word (.docx)**：纯净版，无批注
   - **导出为 PDF**：生成 PDF 文档

### 5.6 云备份操作
1. 点击 ☁️ 按钮打开云备份对话框
2. 首次使用需登录或注册（邮箱/密码）
3. 登录后自动从云端下载数据并合并
4. 支持手动同步、强制上传、强制下载
5. 自动每 5 分钟同步一次

---

## 6. 技术细节与注意事项

### 6.1 数据安全
- **本地优先架构**：合同本体通过 IndexedDB (LocalForage) 完全存储在用户浏览器中，无后端服务器
- **API Key 保护**：所有第三方大模型 API Key 仅静态保存在浏览器 localStorage 中，使用简单 Base64 混淆，不经过任何中间服务器
- **Firebase 安全规则**：建议配置仅允许已登录用户读写自己的数据（见第 7 章）

### 6.2 浏览器兼容性
- 推荐使用最新版 Google Chrome 或 Microsoft Edge（基于 Chromium 内核）
- 需要支持：Service Worker、IndexedDB、CSS Custom Properties、ES6+
- Firefox 和 Safari 基本兼容，但部分 CSS 动效和 PWA 功能可能表现差异

### 6.3 数据备份提醒
- **重要**：在执行"清理浏览器缓存"操作前，务必使用导出 `.json` 功能备份未云化的批注数据
- 开启 Firebase 云同步的用户：数据自动备份，但合同原始文件（.txt）需要在每台设备上重新导入

### 6.4 性能考量
- `vectors-data.js` 可能较大（约 22MB），采用动态懒加载机制，仅在首次开启知识库模式时加载
- 预构建向量导入使用分批策略（每批 25 条 + setTimeout），避免阻塞 UI 线程
- 云同步采用子集合分片存储，突破 Firestore 单文档 1 MiB 限制

### 6.5 API 兼容性
- AI 对话接口：兼容 OpenAI Chat Completions API 格式 (SSE 流式)
- Embedding 接口：兼容 OpenAI Embeddings API 格式
- Rerank 接口：兼容阿里云 DashScope Rerank API 格式

---

## 7. 将配置数据同步到 Firebase 的完整操作步骤

您的项目已经内置了完整的 Firebase 同步框架，只需完成以下几步来激活它：

### 7.1 创建 Firebase 项目
1. 打开 [Firebase Console](https://console.firebase.google.com)，用 Google 账号登录
2. 点击 **"添加项目"**，填写项目名称（如 `contract-manager`），点击继续
3. 可以关闭 Google Analytics（非必须），点击 **"创建项目"**

### 7.2 启用 Firestore 数据库
1. 在 Firebase 项目控制台左侧菜单，点击 **"Firestore Database"**（数据库）
2. 点击 **"创建数据库"**
3. 选择 **"以生产模式启动"**，然后选择离你最近的地区（如 `asia-east2` 香港 或 `asia-northeast1` 东京）
4. 点击 **"完成"**

### 7.3 启用邮箱/密码登录
1. 左侧菜单点击 **"Authentication"**（身份认证）
2. 点击 **"开始使用"**
3. 找到 **"电子邮件地址/密码"**，点击右侧的编辑按钮，将其**启用**，点击 **"保存"**
4. 在 Authentication 的 **"Users"（用户）** 标签下，点击 **"添加用户"**，填写您的邮箱和密码并保存

### 7.4 配置 Firestore 安全规则
1. 在 Firestore Database 页面，点击顶部的 **"规则"** 标签
2. 将内容替换为以下规则，只允许已登录用户读写自己的数据：
```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /general_contract_mods/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
3. 点击 **"发布"**

### 7.5 获取 Firebase 配置信息
1. 在 Firebase 控制台，点击左上角的 **"⚙️ 项目设置"**（齿轮图标）
2. 在 **"常规"** 标签页，向下滚动到 **"您的应用"** 部分
3. 如果没有 Web 应用，点击 **`</>`** 图标添加一个（应用名随意填写，不需要勾选 Firebase Hosting）
4. 注册后会显示配置代码，**复制以下这些值**：
```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",           // ← 复制这个
  authDomain: "your-project.firebaseapp.com",  // ← 复制这个
  projectId: "your-project-id",  // ← 复制这个
  storageBucket: "your-project.appspot.com",   // ← 复制这个
  messagingSenderId: "123456789", // ← 复制这个
  appId: "1:123456789:web:abc"   // ← 复制这个
};
```

### 7.6 在程序中填入 Firebase 配置
1. 打开您的程序网址（如 Netlify 部署的网址）
2. 点击右上角 **⚙️ 设置** 按钮
3. 切换到 **"Firebase配置设置"** 标签
4. 将上一步复制的各项值分别填入对应字段
5. 点击 **"保存"**，页面会自动刷新并连接到 Firebase

### 7.7 登录并激活云端同步
1. 设置页面刷新后，重新打开 **⚙️ 设置 → Firebase配置设置**
2. 使用之前创建的邮箱和密码**登录**
3. 登录成功后，程序会**自动从云端下载数据**（首次为空则上传本地数据）
4. 之后每次打开程序，只要登录，所有配置（书签、高亮、AI模型配置等）都会自动同步

**同步范围说明：**
- 📑 **书签栏**：所有合同的书签（包含层级、折叠状态）
- ✏️ **条款修改/高亮**：在条款中做的所有编辑内容
- 🤖 **AI 模型配置**：API Endpoint、API Key、模型名称
- 🔧 **AI 其他配置**：Embedding、Rerank、系统提示词
- 🎨 **主题**：当前选择的界面主题（亮/暗/护眼）
- ☁️ **Firebase 配置本身**：多设备间无缝切换

> **注意**：合同原始数据（JSON/TXT 文件等）不会同步到 Firebase，需要在新设备上重新导入。Firebase 只同步您的**个人配置和编辑内容**。

---

## 8. 将项目部署到 Netlify 的操作步骤

将已经上传到 GitHub 的项目部署到 Netlify 非常简单，一旦连接成功，以后你每次推送到 GitHub，Netlify 都会自动重新部署最新的代码。

### 8.1 注册或登录 Netlify
1. 打开 [Netlify 官网](https://www.netlify.com/)
2. 点击右上角的 **"Sign Up"**（注册）或者 **"Log In"**（登录）
3. 建议直接选择 **"GitHub"** 方式进行授权登录，后续连接仓库会更方便

### 8.2 导入 GitHub 项目
1. 登录成功后，进入 Netlify 的控制台（Dashboard）
2. 在左侧导航栏选择 **"Sites"**，然后点击页面上的 **"Add new site"** 按钮
3. 在下拉菜单中选择 **"Import an existing project"**（导入一个现有项目）
4. 在 "Connect to Git provider"（连接 Git 提供商）页面，点击 **"GitHub"** 按钮
5. 此时会弹出 GitHub 的授权窗口，请点击 **"Authorize Netlify"** 同意 Netlify 访问你的 GitHub 仓库

### 8.3 选择你的仓库
1. 授权成功后，会显示你的 GitHub 仓库列表
2. 找到并点击你的 **通用合同管理 (General Contract Management)** 项目仓库
   - *提示：如果未显示该仓库，可能是未授予所有仓库的访问权限。点击列表底部的 "Configure the Netlify app on GitHub" 去修改权限，选择 "All repositories"（所有仓库）或者手动勾选你的目标仓库。*

### 8.4 配置部署设置 (Build Settings)
进入 "Site settings" 页面后，对于普通的纯前端项目，通常**不需要修改任何设置**：
- **Branch to deploy**: 默认 `main` 或 `master`
- **Base directory**: 留空即可
- **Build command**: 留空（无需打包）
- **Publish directory**: 留空 或填 `/`

### 8.5 开始部署
1. 点击页面底部的 **"Deploy site"** 按钮
2. Netlify 会开始部署，状态显示为 "Site deploy in progress"
3. 当状态变成绿色的 **"Published"** 时，部署成功！

### 8.6 访问和自定义网站
1. 部署成功后，Netlify 会自动生成一个随机二级域名（例如：`https://cheerful-turing-12345.netlify.app`），点击即可访问
2. **自定义域名 (可选)**：
   - 点击 **"Site configuration"** -> **"Domain management"**
   - 点击 **"Options"** -> **"Edit site name"**，可以修改域名前缀（例如改成 `general-contract-manager.netlify.app`）
   - 如果拥有独立域名，也可以通过 "Add custom domain" 进行绑定
