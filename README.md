# Human Learning (`hl`)

本地优先的 VS Code 学习工作区，将原始学习材料（PDF、网页快照、代码、Markdown 笔记）通过 AI 代理转化为一个**可溯源的知识图谱**。

> 不是通用笔记应用，不是 PDF 编辑器，不是 Zotero 替代品，也不是 Obsidian 克隆。
> 是一个以源文档为地址的学习图谱，以 PDF 和 Markdown 为前端界面。

---

## 核心概念

**Source Anchor（源锚点）** 是项目的核心抽象——对任意文档片段的稳定、可寻址引用。每一个有意义的选区都可以成为：

- 一个稳定锚点（`anchors.jsonl`）
- 一条 Markdown 引用
- SQLite 链接图中的一条边
- 一个可选的嵌入向量块
- 一个代理上下文包

---

## 项目结构

```
human-learning/
├── docs/                        # 设计文档、PRD、MVP 规划
│   ├── all-in-one plan.md       # 主 PRD（25 节完整产品规格）
│   ├── product proposal.md      # 产品提案与相关工作
│   └── superpowers/
│       ├── plans/               # MVP 实施计划
│       └── specs/               # MVP 设计规格
├── packages/
│   ├── core/                    # @human-learning/core — 核心服务层
│   ├── cli/                     # @human-learning/cli — `hl` 命令行工具
│   └── vscode-extension/        # VS Code 扩展（PDF 查看器 + Markdown 编辑器）
├── package.json                 # pnpm monorepo 根配置
├── pnpm-workspace.yaml
└── playwright.config.ts         # E2E 测试配置
```

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 数据库 | `sql.js`（WASM SQLite，零原生依赖） |
| PDF 渲染 | `@embedpdf/pdfium`（VS Code webview） |
| Markdown 编辑器 | CodeMirror 6 + Vim 模式 |
| 图表渲染 | Mermaid 11 |
| 数学公式 | MathJax 4 |
| CLI | Commander 12 |
| 测试 | Node `node:test` + Playwright |
| 构建 | TypeScript 5.4 + Webpack 5 |
| 包管理 | pnpm workspaces |

---

## 核心数据流

```
原始文件（PDF/MD/代码/文本）
  → registerSource()       # 注册来源，哈希去重
  → ingestFile()           # 分块，写入 chunks + search_index
  → rebuildAllLinks()      # 解析 Markdown 链接，构建链接图
  → refreshEmbeddings()    # 生成向量，写入 chunk_embeddings
  → search()               # 词法 / 语义 / 混合搜索
  → createPdfAnchor()      # 创建 PDF 锚点，写入 anchors.jsonl
  → exportSourceContext()  # 导出代理上下文（context.md + context.json）
```

---

## Vault 目录结构

`hl init` 初始化后的工作区布局：

```
vault/
  raw/pdf/, raw/web/, raw/code/, raw/images/, raw/text/
  notes/Concepts/, notes/Papers/, notes/Projects/,
  notes/Daily Notes/, notes/Literature Notes/
  .hl/
    config.yaml
    index.sqlite              # 派生数据，可重建
    anchors/anchors.jsonl     # 锚点规范文件
    agent/                    # context.md, context.json, today.md
    annotations/pdf/
    embeddings/, cache/, logs/
  AGENTS.md
  CLAUDE.md
```

---

## URI 方案

项目使用**原生相对路径**作为链接 URI：

| 类型 | 示例 |
|------|------|
| 笔记 | `notes/Concepts/FlashAttention.md` |
| 笔记标题锚点 | `notes/Concepts/FlashAttention.md#Online Softmax` |
| PDF 页面锚点 | `raw/pdf/paper.pdf#page=3&anchor=anc_pdf_abc123` |
| PDF 块引用 | `raw/pdf/paper.pdf#page=7&chunk=chk_pdf_abc123` |
| 代码行范围 | `raw/code/kernel.cu#L42-L57` |
| 网页目标 | `https://example.com/article#hl-web=web_abc123` |

---

## CLI 命令

```bash
hl init                          # 初始化 vault
hl status                        # 显示 vault 状态
hl doctor                        # 检查环境健康
hl ingest <file>                 # 摄入文件
hl search <query>                # 搜索
hl links rebuild                 # 重建链接图
hl links check                   # 检查断链
hl links backlinks <file>        # 查看反向链接
hl anchor create-pdf             # 创建 PDF 锚点
hl anchor resolve <id>           # 解析锚点
hl context export                # 导出代理上下文
hl embeddings refresh            # 刷新嵌入向量
hl skills install                # 安装技能
hl hooks install --target claude # 安装 Claude 钩子
hl today                         # 今日学习摘要
```

---

## 已实现功能

- **PDF 查看器**：PDFium 渲染，支持选区锚点创建、引用覆盖层、反向链接高亮
- **Markdown 编辑器**：CodeMirror 6，双向同步，Vim 模式，Mermaid/MathJax 渲染，代码高亮
- **反向链接面板**：TreeView 展示入链、出链、问题诊断
- **链接图谱**：构建、检查、修复（大小写不敏感路径匹配）
- **搜索**：词法搜索（token 索引）+ 语义搜索 + 混合搜索
- **代理上下文导出**：生成 `context.md` + `context.json` 供 AI 代理使用
- **活动追踪**：`activity` 表完整写入，`hl today` 返回真实事件计数
- **真实语义嵌入**：支持 Ollama 和 OpenAI-compatible 接口，通过 `config.yaml` 切换（默认本地哈希向量）
- **MCP 服务器**：`hl mcp stdio` 实现 JSON-RPC 2.0 over stdio，暴露 7 个工具给 AI 工具（Claude、Cursor 等）
- **间隔重复系统**：SM-2 算法，`hl review add/list/due/record/history/suspend` 完整 CLI
- **完整 CLI**：`hl` 命令覆盖初始化、摄入、搜索、链接、锚点、上下文、嵌入、MCP、复习等全流程

---

## 待完成事项

### 中优先级

| 功能 | 状态 | 说明 |
|------|------|------|
| 链接修复增强 | 部分实现 | `safeRepairLinks()` 仅支持大小写不敏感路径匹配，PRD 要求哈希/模糊匹配 |
| HTML 快照查看器 | 未实现 | `web_targets` 表和函数存在，无 webview 实现 |
| 跨平台浏览器打开 | macOS 限定 | `openInChrome()` 使用 macOS `open` 命令，无跨平台回退 |

### 低优先级（未启动）

- 移动端/iPad 注释导入（`hl mobile import`）
- Zotero / Obsidian 导入适配器
- 知识图谱可视化
- 符号感知代码锚点（语言服务器集成）
- 分割扩展包构建流程（`vscode-markdown-extension` + `vscode-pdf-extension`）

---

## 开发

```bash
# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 运行核心测试
pnpm --filter @human-learning/core test

# 运行 CLI 测试
pnpm --filter @human-learning/cli test

# 运行 E2E 测试
pnpm playwright test
```

---

## 许可证

MIT
