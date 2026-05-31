# Human Learning PRD

## 1. Introduction

**Human Learning (`hl`)** is an open-source, local-first VS Code workspace for **Karpathy Wiki–style agentic learning**. Users collect raw learning materials—PDF papers, web snapshots, source code, images, text, and handwritten captures—and use AI agents to help transform them into a durable, source-grounded markdown knowledge base.

The project is not a generic note app, PDF reader, Zotero clone, or Obsidian clone. Its core product is a **source-addressable learning graph** where every meaningful selection can become a stable anchor, every anchor can be cited from markdown, and every citation becomes part of a bidirectional graph that humans and agents can navigate.

The existing project direction already defines Human Learning as a local-first VS Code / VS Code-fork workspace with `raw/`, `notes/`, `.hl/`, source anchors, CodeMirror hybrid markdown editing, PDF/web/code anchors, backlinks, embeddings, agent context files, Claude/Codex compatibility, optional MCP, and optional iPad annotation workflow.  [oai_citation:0‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

The core invariant is:

```text
Selection
→ Anchor
→ Citation
→ Link Edge
→ Reference Overlay / Backlink
→ Agent Context
```

The previous plan said “any user selection should become a stable anchor, a markdown link, a graph edge, an optional embedding chunk, an activity event, an agent context bundle, and an optional MCP resource.” That remains the product foundation, but the terminology should be cleaned up to avoid ambiguous meanings of “source.”  [oai_citation:1‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

# 2. Product vision

Human Learning helps humans learn with machines, rather than merely instructing machines to learn.

The system should let a user:

```text
Read a PDF paper.
Select a paragraph.
Create a durable anchor.
Insert a source-grounded markdown citation.
See backlinks from the PDF region to the note.
Ask Claude Code / Codex to explain or update the note using exported context.
Repair stale links when files move or text changes.
Search notes and raw material together.
Review learning activity over time.
```

The sharp product definition:

```text
A local-first, source-addressable VS Code learning workspace where raw materials,
markdown notes, annotations, citations, links, search, and agent context become
one bidirectionally navigable knowledge graph.
```

---

# 3. Non-goals

Human Learning should not try to be everything.

## Not a generic note app

It uses markdown notes, but the product differentiation is not “better markdown editing.” Markdown is the durable knowledge layer and agent-readable surface.

## Not a generic PDF editor

PDF rendering, selection, and annotation matter only because they support anchors, citations, reference overlays, and learning workflows. The PDF engine should be replaceable; anchors are the product-owned abstraction.  [oai_citation:2‡PDF vs Markdown Editors.txt](sediment://file_00000000420c71fdb7138e9f677605e5)

## Not a Zotero replacement

Zotero-like metadata import can be an adapter later, but the core workflow is source-addressable reading and agentic learning inside VS Code.

## Not an Obsidian clone

Obsidian-style wikilinks are useful authoring sugar, but the product needs stronger source anchors, graph repair, PDF/web/code navigation, and agent context handoff.

## Not an AI-only RAG system

Embeddings and search help, but they are support infrastructure. The canonical knowledge remains local files, anchors, links, and notes.

---

# 4. Canonical terminology

The word **source** must be reserved for evidence material only. This eliminates ambiguity.

| Term | Meaning |
|---|---|
| **Raw Source** | Immutable evidence artifact under `raw/`: PDF, HTML snapshot, image, text, imported code snapshot. |
| **Note** | Human/agent-authored markdown file under `notes/`. |
| **Document** | Internal abstraction for any addressable file: raw source, note, workspace code, image, generated context. |
| **Anchor** | Stable locator inside a document: PDF rect, markdown block, heading, code range, DOM node, image rect. |
| **Citation** | Markdown link from a note to a document or anchor. |
| **Link Edge** | Parsed graph relation stored in SQLite. |
| **Reference Overlay** | Generated UI highlight showing “this region is cited by notes.” |
| **Annotation** | Human-created highlight, comment, handwritten ink, margin note. |
| **Chunk** | Search/embedding unit extracted from a document. |
| **Context Bundle** | Agent handoff package written under `.hl/agent/`. |

Strict rule:

```text
Raw Source ≠ Note
Citation ≠ Link Edge
Reference Overlay ≠ Annotation
Chunk ≠ Anchor
SQLite index ≠ Canonical knowledge base
```

The PDF/markdown design already states the correct architecture: source selection becomes stable anchor → markdown link → graph edge → agent context, while markdown remains raw text and visual rendering stays an editor/view-layer enhancement.  [oai_citation:3‡PDF vs Markdown Editors.txt](sediment://file_0000000071c471fdb683c727036140ae)

---

# 5. Naming standard

Use the new names everywhere.

```text
Product name: Human Learning
CLI: hl
Metadata directory: .hl/
URI scheme: hl://
Agent skill: human-learning
```

Deprecated names:

```text
kwiki       → hl
.kwiki/     → .hl/
kwiki CLI   → hl CLI
raw://      → hl://
note://     → hl://note/...
code://     → hl://code/...
web://      → hl://web/...
```

The existing implementation plan already requires renaming `kwiki`, `.kwiki`, `kwiki CLI`, and `raw://` to `Human Learning`, `.hl`, `hl CLI`, and `hl://` links.  [oai_citation:4‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

# 6. User personas

## 6.1 Technical learner

Reads papers, code, docs, blog posts, and lecture notes. Wants durable understanding, not just summaries.

## 6.2 AI-assisted researcher

Uses Claude Code, Codex, Cursor, or similar agents. Needs source-grounded context handoff and safe link repair after agent edits.

## 6.3 Builder-learning-through-code

Studies implementations while reading papers. Needs PDF ↔ code ↔ markdown concept links.

## 6.4 iPad-heavy reader

Reads and annotates PDFs with Apple Pencil, then imports annotations into the desktop learning workspace.

---

# 7. Core user stories

## 7.1 Create a source-grounded note from a PDF

As a user, I can select text in a PDF, create an anchor, and insert a markdown citation so that my note points back to the exact PDF region.

Acceptance criteria:

```text
- User selects PDF text.
- System creates a durable anchor.
- System inserts [label](hl://anchor/<id>) into the active note.
- Clicking the citation opens the PDF at the selected region.
- Opening the PDF shows a generated reference overlay for cited regions.
- Clicking the overlay shows notes that cite it.
```

## 7.2 Use AI without losing provenance

As a user, I can export my current selection and related links to `.hl/agent/selection.md` and `.hl/agent/selection.json`, so Claude Code or Codex can act on grounded context.

Acceptance criteria:

```text
- Exported context includes selected text, anchor URI, document metadata, backlinks, outgoing links, and suggested task.
- Agent instructions tell agents not to invent PDF geometry.
- Agents use hl tools to create anchors instead of fabricating links.
```

## 7.3 Keep markdown portable

As a user, my notes remain plain markdown, readable outside the extension.

Acceptance criteria:

```text
- Notes are stored as normal .md files.
- Visual rendering is editor state, not file state.
- Links are standard markdown links where possible.
- Wikilinks are supported as authoring sugar.
```

VS Code custom editors are implemented with webviews, and `CustomTextEditorProvider` uses VS Code’s standard `TextDocument` model, which fits the requirement that markdown remains plain text while the webview provides a richer editing surface.  [oai_citation:5‡Visual Studio Code](https://code.visualstudio.com/api/extension-guides/custom-editors?utm_source=chatgpt.com)

## 7.4 Repair links safely

As a user, if a note, heading, raw source, or code range moves, the system can repair unambiguous links and report ambiguous ones.

Acceptance criteria:

```text
- Exact file hash match repairs moved raw sources.
- Frontmatter ID/title repairs moved notes.
- Heading ID or quote repairs renamed headings.
- Text quote repairs moved code ranges and PDF anchors.
- Ambiguous repairs are not auto-applied.
```

The current plan already defines safe repair logic for moved notes, renamed headings, moved raw files, moved code ranges, and stale PDF anchors.  [oai_citation:6‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

# 8. Product requirements

## 8.1 Workspace layout

`hl init` creates:

```text
vault/
  raw/
    pdf/
    web/
    images/
    text/
    code-snapshots/

  notes/
    Concepts/
    Papers/
    Projects/
    Daily Notes/
    Literature Notes/
    assets/
      ink/

  .hl/
    config.yaml
    anchors/
      anchors.jsonl
    index.sqlite
    cache/
    embeddings/
    references/
      pdf/
      web/
      code/
    annotations/
      pdf/
    agent/
      selection.md
      selection.json
      related.md
      today.md
      context.md
      context.json
    reports/
    logs/
    mobile-inbox/

  AGENTS.md
  CLAUDE.md
  .agents/
    skills/
      human-learning/
        SKILL.md
  .claude/
    commands/
  .codex/
    config.toml
```

## 8.2 Canonical vs derived data

Canonical data:

```text
notes/**/*.md
raw/**
.hl/anchors/anchors.jsonl
.hl/annotations/**
.hl/config.yaml
AGENTS.md
CLAUDE.md
.agents/skills/**
.claude/commands/**
```

Derived/rebuildable data:

```text
.hl/index.sqlite
.hl/references/**
.hl/cache/**
.hl/embeddings/**
.hl/reports/**
.hl/logs/**
```

The existing design already says source files are truth and SQLite is an index, with markdown/raw/annotations/anchors as canonical and SQLite/references/cache/embeddings as derived.  [oai_citation:7‡PDF vs Markdown Editors.txt](sediment://file_00000000420c71fdb7138e9f677605e5)

Important correction: `.hl/anchors/anchors.jsonl` should be canonical, not optional, if persisted markdown links use `hl://anchor/<id>`.

---

# 9. URI and link model

## 9.1 Canonical precise citation

Use this for exact PDF regions, markdown blocks, DOM nodes, image rects, and stable code selections:

```md
[label](hl://anchor/anc_xxx)
```

## 9.2 Whole document link

Use this for whole notes or raw sources:

```md
[label](hl://doc/doc_xxx)
```

Readable aliases may be supported:

```md
[label](hl://note/notes/Concepts/FlashAttention.md)
[label](hl://source/raw/pdf/flash-attention.pdf)
```

## 9.3 Wikilink sugar

Support:

```md
[[FlashAttention]]
[[FlashAttention#Online Softmax]]
[[FlashAttention|FA]]
```

Internally resolve these into link edges.

## 9.4 Debug/import-only geometry links

This should not be normal authored output:

```md
[source](hl://pdf/raw/pdf/fa.pdf?page=3&rect=120,240,530,310)
```

Agents must not fabricate geometry. Instead:

```text
agent quotes/searches text
→ hl tool validates against document
→ hl creates anchor
→ agent inserts returned URI
```

The current PDF/markdown plan explicitly says agents should not hallucinate geometry and should call the `hl` tool to validate and create anchors.  [oai_citation:8‡PDF vs Markdown Editors.txt](sediment://file_0000000071c471fdb683c727036140ae)

---

# 10. Anchor model

## 10.1 Anchor record

```json
{
  "id": "anc_pdf_8f21",
  "document_id": "doc_fa",
  "kind": "pdf_rect",
  "uri": "hl://anchor/anc_pdf_8f21",
  "locator": {
    "page": 3,
    "rects": [[120, 240, 530, 310]]
  },
  "text_quote": "FlashAttention uses tiling...",
  "text_hash": "sha256:...",
  "document_hash_at_creation": "sha256:...",
  "status": "resolved",
  "created_by": "human_selection",
  "created_at": "2026-05-25T00:00:00Z",
  "updated_at": "2026-05-25T00:00:00Z"
}
```

## 10.2 Supported anchor kinds

```text
pdf_rect
dom_range
line_range
heading
block
symbol
image_rect
```

## 10.3 Hash names

Use:

```text
content_hash                  full document/file hash
text_hash                     normalized selected quote hash
locator_hash                  canonical locator JSON hash, optional
document_hash_at_creation     document hash when anchor was created
```

Avoid `source_hash` except in legacy migration code.

---

# 11. Data model

Use SQLite as a rebuildable local index. Do not treat it as the canonical knowledge base.

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,              -- raw_source, note, workspace_code, generated_context
  path TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,        -- pdf, markdown, html, code, image, text
  content_hash TEXT NOT NULL,
  title TEXT,
  original_url TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE anchors (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  uri TEXT NOT NULL UNIQUE,
  locator_json TEXT NOT NULL,
  text_quote TEXT,
  text_hash TEXT,
  document_hash_at_creation TEXT,
  status TEXT NOT NULL DEFAULT 'resolved',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id)
);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  from_document_id TEXT,
  from_anchor_id TEXT,
  from_note_path TEXT,
  from_line INTEGER,
  to_uri TEXT NOT NULL,
  to_document_id TEXT,
  to_anchor_id TEXT,
  label TEXT,
  relation TEXT NOT NULL DEFAULT 'cites',
  created_by TEXT NOT NULL DEFAULT 'parser',
  status TEXT NOT NULL DEFAULT 'resolved',
  confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  anchor_id TEXT,
  text TEXT NOT NULL,
  token_count INTEGER,
  content_hash TEXT NOT NULL,
  embedding_model TEXT,
  embedding_ref TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  anchor_id TEXT,
  event_type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  duration_ms INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE diagnostics (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  kind TEXT NOT NULL,
  document_path TEXT,
  line INTEGER,
  message TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
```

The previous schema already included sources, anchors, links, chunks, activity, jobs, and diagnostics; this version renames `sources` to `documents` to avoid ambiguity.  [oai_citation:9‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

# 12. PDF requirements

## 12.1 Design principle

```text
PDF engine is replaceable.
Anchors are permanent.
```

PDF engine owns:

```text
rendering
text extraction
selection geometry
page coordinate conversion
optional annotation drawing primitives
```

Human Learning owns:

```text
hl:// URI scheme
anchor IDs
SQLite graph
anchor sidecars
reference sidecars
annotation sidecars
PDF → note backlinks
note → PDF jump
agent context export
anchor repair
```

The existing PDF plan explicitly says the PDF engine should not own the product model and that Human Learning owns the URI scheme, anchor IDs, graph, sidecars, backlinks, jumps, context export, and repair.  [oai_citation:10‡PDF vs Markdown Editors.txt](sediment://file_0000000071c471fdb683c727036140ae)

## 12.2 PDF engine strategy

Default:

```text
EmbedPDF / PDFium prototype
```

Fallback:

```text
PDF.js
```

Optional advanced backend:

```text
MuPDF
```

The previous final recommendation was EmbedPDF/PDFium as primary, PDF.js as fallback, and MuPDF as optional advanced backend.  [oai_citation:11‡PDF vs Markdown Editors.txt](sediment://file_00000000420c71fdb7138e9f677605e5)

## 12.3 PDF acceptance criteria

```text
- Open local PDF offline.
- Render page.
- Select text.
- Extract selected text_quote.
- Extract page-space rects.
- Create hl://anchor/<id>.
- Insert markdown citation.
- Click citation to open PDF at region.
- Draw reference overlay.
- Click overlay to show referenced-by notes.
- Keep user annotations separate from generated reference overlays.
```

Reference overlays and user annotations must remain separate because “this region is cited by the wiki” and “I highlighted this while reading” are semantically different.  [oai_citation:12‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

# 13. Markdown requirements

## 13.1 MVP: native markdown first

Start with normal VS Code markdown editor plus:

```text
DocumentLinkProvider for hl:// links
HoverProvider for previews
Selection export command
Backlinks panel
Forward links panel
Diagnostics
```

## 13.2 First serious release: CodeMirror hybrid editor

Use CodeMirror 6 for:

```text
source mode
hybrid mode
reading mode
active-line raw syntax
inactive-line rendered syntax
link chips
source badges
inline backlink badges
selection export
```

CodeMirror’s decoration model supports mark decorations, widget decorations, replacing decorations, and line decorations, which maps directly to hybrid markdown rendering.  [oai_citation:13‡CodeMirror](https://codemirror.net/examples/decoration/?utm_source=chatgpt.com)

## 13.3 Markdown invariant

```text
The markdown document remains raw markdown.
Rendered output is decoration/widget state.
```

The current plan already states this invariant and explains that it keeps notes portable and agent-readable.  [oai_citation:14‡PDF vs Markdown Editors.txt](sediment://file_00000000420c71fdb7138e9f677605e5)

---

# 14. Web snapshot requirements

Web pages should be saved as local snapshots to prevent link rot.

Requirements:

```text
- Save HTML under raw/web/.
- Preserve original URL and fetch timestamp.
- Sanitize or sandbox rendering.
- Allow DOM element selection.
- Create DOM-range anchors.
- Insert hl://anchor/<id> citation.
- Click citation to open snapshot and scroll to target.
- Show reference overlays for cited DOM nodes.
```

The current feature list already includes saving web snapshots, preserving original URLs, DOM selection, web anchors, link insertion, jump-to-target, reference overlays, and agent context export.  [oai_citation:15‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

# 15. Code anchor requirements

Code has two modes:

```text
raw/code-snapshots/     immutable imported code evidence
workspace code          active implementation files
```

Requirements:

```text
- Support line-range anchors.
- Support symbol anchors later.
- Link notes to implementations.
- Link implementation ranges back to notes.
- Repair moved code ranges by exact quote first, fuzzy match second.
- Mark ambiguous repairs instead of auto-fixing.
```

The earlier plan already says code anchors should support line ranges, later symbols, note/code linking, agent context export, line-range repair, language-server integration, and code-reference highlighting.  [oai_citation:16‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

# 16. Agent integration requirements

## 16.1 Agent context files

Write:

```text
.hl/agent/selection.md
.hl/agent/selection.json
.hl/agent/related.md
.hl/agent/today.md
.hl/agent/context.md
.hl/agent/context.json
```

Context bundle includes:

```json
{
  "kind": "selection_context",
  "vault": "/path/to/vault",
  "selection": {
    "anchor_uri": "hl://anchor/anc_xxx",
    "document_path": "notes/Concepts/FlashAttention.md",
    "start_line": 20,
    "end_line": 29,
    "text": "..."
  },
  "document": {
    "role": "note",
    "media_type": "markdown",
    "content_hash": "sha256:..."
  },
  "outgoing_links": [],
  "backlinks": [],
  "related": [],
  "created_at": "..."
}
```

The current implementation plan already defines `.hl/agent/selection.md`, `.hl/agent/selection.json`, `.hl/agent/related.md`, `.hl/agent/today.md`, and a context export command.  [oai_citation:17‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

## 16.2 AGENTS.md / CLAUDE.md source rules

```md
## Human Learning source rules

- “Raw Source” means immutable evidence under raw/.
- “Note” means markdown knowledge under notes/.
- Do not call notes “sources” unless discussing the internal document graph.
- Do not edit raw/ unless explicitly asked.
- Do not invent hl:// PDF rectangle coordinates.
- For precise PDF, image, web, markdown-block, or code citations, call the hl anchor tool and insert only the returned URI.
- Use hl://anchor/<id> for precise citations.
- Use [[Note]] or hl://note/... only for whole-note or heading links.
- After editing notes, run hl links check --fix.
```

Codex uses `AGENTS.md` files for repository-level instructions, including coding conventions and verification commands; nested files can define scoped guidance, with deeper files taking precedence.  [oai_citation:18‡OpenAI](https://openai.com/index/introducing-codex/?utm_source=chatgpt.com)

---

# 17. MCP requirements

MCP is optional but first-class.

Read-only tools by default:

```text
hl.get_current_selection
hl.search
hl.get_anchor
hl.get_related
hl.get_backlinks
hl.get_forward_links
hl.check_links
```

Mutating tools require explicit configuration:

```text
hl.create_anchor
hl.ingest
hl.refresh_embeddings
hl.repair_links
hl.summarize_today
```

Resources:

```text
hl://selection/current
hl://anchor/{anchorId}
hl://doc/{documentId}
hl://note/{path}
hl://activity/today
```

Prompts:

```text
hl_explain_selection
hl_ingest_source
hl_update_note
hl_repair_links
hl_daily_summary
```

MCP resources are identified by URIs and allow servers to expose application data such as files or schemas; MCP prompts expose reusable prompt templates that clients can discover and invoke.  [oai_citation:19‡Model Context Protocol](https://modelcontextprotocol.io/docs/concepts/resources?utm_source=chatgpt.com)

Security rules:

```text
- Default MCP mode is read-only.
- Mutating tools require allow_mutating_mcp_tools: true.
- No generic shell execution.
- Validate every URI.
- Prevent path traversal outside vault root.
- Log every mutation to .hl/logs/audit.jsonl.
```

The MCP resource spec also emphasizes URI validation and access controls for sensitive resources.  [oai_citation:20‡Model Context Protocol](https://modelcontextprotocol.io/docs/concepts/resources?utm_source=chatgpt.com)

---

# 18. Search and embeddings

## 18.1 MVP

```text
SQLite FTS5 lexical search
document/chunk indexing
no embedding requirement
```

## 18.2 Optional advanced modes

```yaml
embeddings:
  mode: disabled | remote | local
  provider: openai-compatible | ollama | sentence-transformers | custom
  model: text-embedding-3-small
  endpoint: null
  dimensions: 1536
  batch_size: 64
```

## 18.3 Non-GPU requirement

The project must work without a GPU:

```text
No GPU:
  anchors
  notes
  backlinks
  CLI
  context export
  lexical search

Optional:
  remote embeddings

GPU:
  local embeddings
  reranking
  local LLM experiments
```

The feature plan already states GPU is not required, GPU only improves local AI performance, and all structural features work without GPU.  [oai_citation:21‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

# 19. VS Code extension architecture

Use stable public VS Code APIs.

## 19.1 Extension components

```text
workspace detection
command registration
DocumentLinkProvider for hl://
custom URI dispatcher
native editor selection export
custom markdown editor later
PDF webview editor
HTML snapshot viewer
tree views
diagnostics
file watchers
activity tracking
agent context export
```

VS Code custom editors are webview-based and can be used for text or binary/non-text files; `CustomTextEditorProvider` is the simpler fit for markdown because it uses VS Code’s standard text document model, while custom readonly/custom document providers fit PDF/HTML-style views.  [oai_citation:22‡Visual Studio Code](https://code.visualstudio.com/api/extension-guides/custom-editors?utm_source=chatgpt.com)

## 19.2 Commands

```text
Human Learning: Initialize Vault
Human Learning: Add Selection to Agent Context
Human Learning: Copy Selection as Agent Prompt
Human Learning: Insert Source Citation
Human Learning: Create Anchor from Selection
Human Learning: Open Anchor
Human Learning: Check Links
Human Learning: Repair Links
Human Learning: Refresh Embeddings
Human Learning: Summarize Today
```

The existing VS Code MVP already includes extension activation, workspace detection, commands, DocumentLinkProvider, URI dispatcher, side panels, diagnostics, file watchers, and `hl://` link routing.  [oai_citation:23‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

# 20. UI requirements

VS Code view container:

```text
Human Learning
├── Navigation
├── Links
├── Agent Context
├── Raw Corpus
├── Activity
├── Problems
└── Mobile Inbox
```

Views:

```text
Navigation:
  outline, headings, PDF outline, referenced regions

Links:
  forward links, backlinks, broken/stale links

Agent Context:
  current selection, exported files, related context

Raw Corpus:
  raw sources, metadata, ingestion status

Problems:
  broken links, stale anchors, missing files, ambiguous repairs

Mobile Inbox:
  imported handwritten notes and PDF annotations
```

The existing feature list already includes Hybrid Markdown Editor, PDF Viewer, HTML Snapshot Viewer, Backlinks Panel, Forward Links Panel, Agent Context Panel, Raw Corpus Panel, Activity Panel, Problems Panel, and Mobile Inbox Panel.  [oai_citation:24‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

# 21. CLI requirements

Commands:

```bash
hl init
hl status
hl add <path-or-url>
hl ingest <path> [--recursive]
hl index rebuild
hl links check [--fix] [--dry-run]
hl links rebuild
hl anchor create --document <path> --quote "..." [--page-hint N]
hl anchor resolve <uri>
hl anchor validate <uri>
hl references rebuild
hl embeddings refresh [--changed|--all]
hl search "<query>"
hl context current
hl context export --anchor <anchor-uri>
hl today [--date YYYY-MM-DD]
hl doctor
hl mcp stdio
hl skills install --target codex|claude|all
hl hooks install --target claude
hl mobile import
```

CLI rules:

```text
- Every mutating command supports --dry-run where practical.
- Every command supports --json for agent use.
- No command mutates raw/ unless explicit.
- Errors must be structured enough for agents to act on.
```

The old CLI feature list includes init, add, ingest, index, refresh embeddings, link check/fix, search, context export, today, mobile import, doctor, MCP stdio, skills install, and hooks install; this version normalizes names to `hl`.  [oai_citation:25‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

# 22. Sync and privacy requirements

Recommended sync:

```text
Sync:
  raw/
  notes/
  notes/assets/ink/
  .hl/anchors/
  .hl/annotations/
  AGENTS.md
  CLAUDE.md
  .agents/skills/
  .claude/commands/

Do not sync by default:
  .hl/index.sqlite
  .hl/embeddings/
  .hl/cache/
  .hl/logs/
  .hl/activity.jsonl unless user opts in
```

Security:

```text
- Workspace trust gates automation.
- Raw corpus is protected by default.
- Remote embeddings require explicit configuration.
- Local-first default.
- Activity tracking can be disabled.
- Mutating MCP tools are narrow and explicit.
- Agent-triggered maintenance is logged.
```

The existing plan already recommends Git for notes, WebDAV/rclone for raw files, rebuildable indexes per device, conflict reporting, hash-based source recovery, and not syncing index/embeddings/cache/activity by default.  [oai_citation:26‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

# 23. Release plan

## 23.1 MVP

Goal:

```text
Every meaningful selection can become:
  stable anchor
  markdown citation
  graph edge
  agent context bundle
```

Deliverables:

```text
1. pnpm TypeScript monorepo
2. packages/core workspace/config module
3. .hl workspace layout
4. .hl/anchors/anchors.jsonl
5. SQLite migration system
6. documents / anchors / links / chunks / diagnostics schema
7. hl init
8. hl doctor
9. hl:// URI parser
10. markdown link parser
11. raw source registry and hashing
12. markdown/code ingestion
13. basic PDF text ingestion
14. link graph build
15. hl links check
16. hl links check --fix --dry-run
17. context bundle generator
18. .hl/agent/selection.md/json
19. VS Code extension skeleton
20. DocumentLinkProvider for hl://
21. Add Selection to Agent Context command
22. AGENTS.md / CLAUDE.md generation
23. Codex skill skeleton
24. Claude command skeleton
25. lexical search
```

The earlier MVP scope already includes `hl init`, SQLite schema, raw/notes layout, source registry, markdown/code ingestion, PDF text ingestion, URI parser, markdown link parser, backlinks/outgoing links, link check, context export, DocumentLinkProvider, agent instruction generation, lexical search, and doctor.  [oai_citation:27‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

## 23.2 First serious release

Deliverables:

```text
1. CodeMirror hybrid markdown editor
2. PDF viewer with text selection
3. PDF page/rect anchor creation
4. PDF reference overlays
5. note → PDF jump
6. PDF → note referenced-by popup
7. PDF user highlights/comments
8. markdown heading/block anchors
9. anchor repair by quote/hash
10. Navigation side panel
11. Activity tracking
12. hl today
13. optional embeddings
14. read-only MCP tools
15. search over notes + PDF anchors
```

The PDF/markdown plan already lists CodeMirror hybrid editor, PDF reference highlights, PDF-to-note popup, user highlights/comments, markdown block anchors, anchor repair, navigation panel, activity tracking, MCP read-only tools, and search over notes/PDF anchors for the first serious release.  [oai_citation:28‡PDF vs Markdown Editors.txt](sediment://file_00000000420c71fdb7138e9f677605e5)

## 23.3 Advanced release

Deliverables:

```text
1. HTML snapshot viewer with DOM anchors
2. full iPad/mobile annotation import
3. handwritten PDF annotations
4. markdown handwriting image insertion
5. mobile inbox import
6. symbol-aware code anchors
7. graph visualization
8. review queue / spaced repetition
9. Zotero import/export adapter
10. Obsidian import/export adapter
11. annotated PDF export copy
```

---

# 24. Implementation task list

## Phase 0 — Normalize terminology

```text
[ ] Replace kwiki with hl.
[ ] Replace .kwiki with .hl.
[ ] Replace raw://, note://, code://, web:// as persisted schemes with hl:// forms.
[ ] Define Raw Source, Note, Document, Anchor, Citation, Link Edge, Reference Overlay, Annotation, Chunk, Context Bundle.
[ ] Update AGENTS.md and CLAUDE.md with source rules.
[ ] Add migration notes for legacy links.
```

## Phase 1 — Monorepo and core

```text
[ ] Create pnpm workspace.
[ ] Create packages/core.
[ ] Create packages/cli.
[ ] Create packages/vscode-extension.
[ ] Create packages/mcp-server.
[ ] Create packages/schemas.
[ ] Add zod schemas for document, anchor, link, context bundle.
[ ] Implement workspace discovery.
[ ] Implement config loader.
```

## Phase 2 — Storage

```text
[ ] Create .hl/config.yaml.
[ ] Create .hl/anchors/anchors.jsonl.
[ ] Implement SQLite migrations.
[ ] Create documents table.
[ ] Create anchors table.
[ ] Create links table.
[ ] Create chunks table.
[ ] Create activity table.
[ ] Create diagnostics table.
[ ] Implement rebuild from canonical files.
```

## Phase 3 — URI and anchors

```text
[ ] Implement hl:// URI parser.
[ ] Implement hl://anchor/<id>.
[ ] Implement hl://doc/<id>.
[ ] Implement hl://note/<path>.
[ ] Implement hl://source/<path>.
[ ] Implement hl://code/<path>.
[ ] Implement legacy URI parser for migration.
[ ] Implement anchor create/resolve/validate.
[ ] Implement deterministic IDs.
[ ] Implement quote normalization and text_hash.
```

## Phase 4 — Ingestion

```text
[ ] Ingest markdown notes.
[ ] Extract frontmatter.
[ ] Extract headings.
[ ] Extract markdown links.
[ ] Extract wikilinks.
[ ] Ingest code line ranges.
[ ] Ingest basic PDF text by page.
[ ] Ingest HTML snapshot text blocks.
[ ] Create document rows.
[ ] Create chunk rows.
```

## Phase 5 — Link graph

```text
[ ] Parse [label](hl://...).
[ ] Parse [[Note]].
[ ] Parse [[Note#Heading]].
[ ] Parse [[Note|Alias]].
[ ] Resolve outgoing links.
[ ] Build backlinks.
[ ] Mark unresolved links.
[ ] Mark stale anchors.
[ ] Implement safe repair.
[ ] Implement ambiguity reports.
[ ] Surface diagnostics.
```

## Phase 6 — Agent context

```text
[ ] Implement hl context export --anchor.
[ ] Implement hl context current.
[ ] Write .hl/agent/selection.md.
[ ] Write .hl/agent/selection.json.
[ ] Include backlinks and outgoing links.
[ ] Include related chunks when search is available.
[ ] Generate AGENTS.md.
[ ] Generate CLAUDE.md.
[ ] Generate .agents/skills/human-learning/SKILL.md.
[ ] Generate .claude/commands.
```

## Phase 7 — VS Code MVP

```text
[ ] Extension activation.
[ ] Workspace detection.
[ ] Commands.
[ ] DocumentLinkProvider for hl://.
[ ] URI dispatcher.
[ ] Open note target.
[ ] Open code range target.
[ ] Native editor selection export.
[ ] Backlinks panel.
[ ] Forward links panel.
[ ] Agent Context panel.
[ ] Problems diagnostics.
[ ] File watcher debounce.
```

## Phase 8 — PDF prototype

```text
[ ] PDF webview shell.
[ ] Bundle PDF engine locally.
[ ] Open local PDF.
[ ] Render pages.
[ ] Select text.
[ ] Extract text_quote.
[ ] Extract page-space rects.
[ ] Create PDF anchor.
[ ] Insert citation into active markdown note.
[ ] Open PDF at anchor.
[ ] Draw reference overlay.
[ ] Click overlay to show referenced-by notes.
[ ] Keep annotation sidecar separate from reference sidecar.
```

## Phase 9 — CodeMirror editor

```text
[ ] CustomTextEditorProvider for markdown.
[ ] CodeMirror webview.
[ ] Source mode.
[ ] Hybrid mode.
[ ] Reading mode.
[ ] Active-line raw syntax.
[ ] Inactive-line rendered syntax.
[ ] Link chips.
[ ] Source badges.
[ ] Selection export bridge.
[ ] Open link bridge.
[ ] Diagnostics decorations.
```

## Phase 10 — MCP

```text
[ ] Implement hl mcp stdio.
[ ] Expose read-only tools.
[ ] Expose resources.
[ ] Expose prompts.
[ ] Validate URIs.
[ ] Enforce path confinement.
[ ] Add mutation config gate.
[ ] Add audit logs.
```

## Phase 11 — Search

```text
[ ] SQLite FTS5 lexical search.
[ ] Search notes.
[ ] Search raw extracted chunks.
[ ] Search anchors.
[ ] Optional embedding provider abstraction.
[ ] Incremental embedding refresh.
[ ] Hybrid search.
```

## Phase 12 — Tests

```text
[ ] URI parser tests.
[ ] Markdown parser tests.
[ ] Wikilink parser tests.
[ ] Anchor create/resolve tests.
[ ] Link graph tests.
[ ] Safe repair tests.
[ ] Context export tests.
[ ] CLI JSON output tests.
[ ] VS Code link open tests.
[ ] PDF selection tests.
[ ] PDF anchor overlay tests.
[ ] Engine swap test.
[ ] MCP URI validation tests.
```

The PDF/markdown plan already defines the key test categories: PDF open/render/select/extract/reopen/jump/repair tests, markdown parse/rename/anchor/export tests, and an engine swap test proving anchors remain stable across PDF engines.  [oai_citation:29‡PDF vs Markdown Editors.txt](sediment://file_0000000071c471fdb683c727036140ae)

---

# 25. Final source-of-truth statement

Use this as the project’s governing principle:

```text
Human Learning does not treat “source” as a vague synonym for file, note, link,
citation, annotation, or context.

A Raw Source is immutable evidence.
A Note is authored understanding.
A Document is an internal addressable file.
An Anchor is a stable location inside a document.
A Citation is markdown syntax.
A Link Edge is graph data.
A Reference Overlay is generated from citations.
An Annotation is human-created.
A Chunk is for search.
A Context Bundle is for agents.

The product is the graph connecting them.
```

Final implementation rule:

```text
Do not build a PDF editor.
Do not build a generic note app.
Build a source-addressable learning graph.

PDF and markdown are frontends over:
  anchors
  citations
  link graph
  reference overlays
  annotations
  search
  repair
  agent context
```

This matches the previous final recommendation that PDF and markdown are frontends over anchors, links, graph, context, repair, and agent handoff.  [oai_citation:30‡PDF vs Markdown Editors.txt](sediment://file_0000000071c471fdb683c727036140ae)