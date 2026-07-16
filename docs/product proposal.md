# Human Learning: Product Proposal

## **Abstract**

**Human Learning** is an open-source, local-first VS Code vault for **Karpathy Wiki–style agentic learning**: users add raw materials, and agents help digest them into a source-grounded markdown knowledge base. The project extends the LLM Wiki pattern from a prompt/skill workflow into an interactive research environment where PDFs, webpages, source code, markdown notes, handwritten annotations, and agent context become one bidirectionally linked graph. Karpathy’s gist frames the core idea as a raw-source → wiki → index workflow for LLM agents, and `karpathy-llm-wiki` shows this pattern can be packaged for Claude Code, Cursor, and Codex.

Obsidian and Zotero are excellent at parts of this workflow, but modern technical study increasingly crosses papers, code, web docs, and agent-generated context. **Human Learning** uses VS Code as the host because it already contains code navigation, Git, terminals, extensions, and Claude Code / Codex-style agents. Its goal is not just to help LLMs get work done, but to help humans learn with machines: trace claims to sources, connect concepts across media, preserve study history, and turn raw material into durable understanding.

## Current Implementation Update

The MVP reference model now uses native Markdown and Obsidian-compatible links
as the user-facing persisted format. Human Learning does not generate `hl://`
links for notes, code, PDFs, or web targets. Current examples are:

```md
[[Online Softmax#Why This Matters]]
[kernel](raw/code/attention.cu#L42-L57)
[paper p7](raw/pdf/flash-attention.pdf#page=7)
[selected text](raw/pdf/flash-attention.pdf#page=7:~:text=selected%20text)
[quote](https://example.com/article#:~:text=selected%20text)
[DOM block](https://example.com/article#hl-web=web_abc123)
```

PDF search results and selection links use portable page/text-fragment targets.
Chunks remain retrieval units, while sparse annotation anchors remain internal
database records and never appear as identifiers in Markdown links.
Chrome is the default web-open target, with VS Code's external URL opener as the
current fallback. See [reference model.md](reference%20model.md) for the current
authoritative link and locator model.

---

## 1. Introduction

Technical learning is becoming increasingly agentic, but the surrounding tools have not caught up. Large language models can explain code, summarize papers, compare implementations, generate notes, and maintain files, yet most research workflows still scatter learning material across separate tools: Zotero for papers and citations, Obsidian for markdown notes, a browser for web documentation, VS Code for source code, and Claude Code or Codex for agentic reasoning.

This fragmentation matters because the objects being studied are no longer just documents. A machine-learning systems learner may read a PDF paper, inspect its CUDA implementation, compare it with a blog post, annotate equations on an iPad, and ask an agent to explain a selected paragraph in the context of the code. Obsidian’s local markdown vault and link model are powerful for personal knowledge work, and Zotero’s research-management model is powerful for bibliographic workflows, but neither is designed around mixed source-code / PDF / web / agent context as one addressable workspace. Obsidian describes itself around linked notes and personal knowledge bases, while Zotero describes itself as a tool to collect, organize, annotate, cite, and share research. Those are adjacent but not sufficient for source-grounded agentic study.  [oai_citation:0‡Obsidian](https://obsidian.md/?utm_source=chatgpt.com)

Karpathy’s LLM Wiki pattern points toward a better architecture: raw materials are collected, and the LLM maintains a directory of generated markdown pages—summaries, concept pages, comparisons, overviews, and cross-references. The wiki becomes the durable knowledge substrate: readable by humans, editable by agents, and grounded in source material. Karpathy explicitly frames the idea as a pattern for personal knowledge bases using LLM agents such as Codex, Claude Code, OpenCode, or similar tools.  [oai_citation:1‡Gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f?utm_source=chatgpt.com)

Existing projects such as `Astro-Han/karpathy-llm-wiki` show that this idea can be packaged for agents: the repository describes itself as an Agent Skills-compatible LLM wiki for Claude Code, Cursor, and Codex, focused on raw sources, citations, and linting.  [oai_citation:2‡GitHub](https://github.com/Astro-Han/karpathy-llm-wiki?utm_source=chatgpt.com) Human Learning extends that idea from an agent skill into an interactive VS Code workspace.

The central abstraction is the **source anchor**: a stable reference to a precise fragment of a source. An anchor may point to a PDF page rectangle, a markdown heading, a code line range, a code symbol, an HTML DOM element, or an image region. Once every selected fragment can become an addressable anchor, the system can support source-grounded notes, bidirectional links, backlink repair, reference highlights, embeddings, activity history, daily study summaries, and reliable context handoff to agents.

VS Code is the right substrate because its extension platform supports custom editors and webviews. VS Code custom editors are implemented using webviews, and webviews can build custom interfaces with standard HTML, CSS, and JavaScript while communicating with the extension host by message passing.  [oai_citation:3‡Visual Studio Code](https://code.visualstudio.com/api/extension-guides/custom-editors?utm_source=chatgpt.com) This makes it feasible to build a CodeMirror-based hybrid markdown editor, a PDF reader, an HTML snapshot viewer, link panels, and agent context panels inside one workspace.

---

## 2. Product Vision

**Human Learning** is an open-source, local-first VS Code vault for agentic study.

It turns:

```text
PDFs
webpages
HTML snapshots
source code
markdown notes
handwritten annotations
agent-generated explanations
daily study activity
```

into one source-grounded, bidirectionally linked knowledge graph.

The intended users are technical learners, researchers, and engineers using macOS or GPU-capable PCs with VS Code or VS Code-compatible forks. A GPU is not required: all structural features work with lexical search, remote embeddings, or agent-driven corpus search. GPU-equipped machines simply unlock faster local embeddings, local reranking, and offline model workflows.

The product should be open-source because the knowledge base is personal infrastructure. Users should own their sources, notes, indexes, and agent workflows.

---

## 3. Problem Statement

Current workflows split learning across incompatible systems.

Zotero is strong for reference management, citation metadata, PDFs, and bibliographies. Obsidian is strong for linked markdown notes, local vaults, backlinks, daily notes, and knowledge graphs. VS Code is strong for source code, terminals, Git, language servers, notebooks, and coding agents. Claude Code and Codex are strong for repository-aware reasoning and file modification. But none of these tools provides a unified model where a PDF paragraph, a code function, an HTML element, and a markdown section are all first-class, addressable, linkable, and exportable to agents.

The common Zotero + Obsidian workflow demonstrates both the value and the difficulty of bridging tools. Many workflows require Better BibTeX citation keys, custom templates, Obsidian community plugins, export settings, and fragile filename/citekey conventions. Users report that Zotero/Obsidian workflows can break when citation-key or export behavior changes, and even recent forum discussions around Zotero 8 and Better BibTeX show how brittle these integrations can become.  [oai_citation:4‡marianamontes.me](https://www.marianamontes.me/post/obsidian-and-zotero/?utm_source=chatgpt.com)

The core problems are:

```text
Weak source provenance:
  Notes often cite a paper generally, not the exact paragraph, equation, figure, or code implementation.

Manual context handoff:
  Users copy text from PDFs or webpages into an agent and lose source identity, page, location, backlinks, and study history.

Fragmented link models:
  Obsidian links notes well, Zotero manages references well, and VS Code navigates code well, but cross-format anchors are not unified.

Agent inconsistency:
  Agents can update notes, but without a stable graph they may duplicate pages, break links, or lose citation provenance.

Underused activity history:
  The system usually does not know what the user viewed, selected, linked, or asked an agent about today.
```

Human Learning addresses these problems by making sources, anchors, links, notes, context bundles, and agent workflows part of one local workspace.

---

## 4. Goals

1. **Source-grounded knowledge creation**
   Every important claim should trace back to a source anchor.

2. **Cross-format linking**
   Notes should link to notes, PDF regions, HTML elements, code ranges, code symbols, image regions, and handwritten annotations.

3. **Agent-compatible context handoff**
   Any selected fragment should be exportable to Claude Code, Codex, or another agent via context files, clipboard prompts, CLI commands, or MCP tools.

4. **Obsidian-like markdown editing inside VS Code**
   The markdown editor should support source mode, reading mode, and hybrid live preview where the active line remains raw markdown and inactive lines render visually.

5. **Portable markdown**
   Notes should remain useful outside Human Learning. Canonical persisted links should prefer Obsidian wikilinks, relative markdown links to vault files, normal web URLs, and native URL fragments. `hl://` is not generated for MVP note content.

6. **Local-first and open-source**
   Raw sources and notes remain local files by default. Indexes, embeddings, activity logs, and metadata are inspectable and rebuildable.

7. **Composable agent workflows**
   The system generates `AGENTS.md`, `CLAUDE.md`, skills, commands, hooks, and optional MCP tools.

8. **Maintainable link graph**
   The system validates and repairs backlinks, forward links, stale anchors, moved notes, renamed headings, moved raw files, and shifted code ranges.

---

## 5. Non-goals

Human Learning is not primarily:

```text
a commercial SaaS note app
a full Zotero replacement
a full Obsidian clone
a generic browser
a general PDF editor for forms/signatures/redaction
a closed cloud RAG product
a proprietary agent platform
```

Zotero integration should be supported, but Human Learning should not try to replace Zotero’s bibliographic database and citation ecosystem. Obsidian import/export should be supported, but Human Learning should not become a clone of Obsidian. The core deliverable is a source-addressable, agent-compatible research workspace inside VS Code.

---

## 6. Proposed System

A Human Learning vault uses a transparent workspace layout:

```text
vault/
  raw/                    # immutable source corpus
    pdf/
    web/
    code/
    images/

  notes/                  # human/agent-maintained markdown wiki
    Concepts/
    Papers/
    Projects/
    Daily Notes/
    assets/
      ink/

  .hl/                    # local state, indexes, activity, context
    index.sqlite
    embeddings/
    annotations/
    references/
    activity.jsonl
    agent/
      selection.md
      selection.json
      related.md
      today.md
    mobile-inbox/

  AGENTS.md
  CLAUDE.md
```

The architectural rule is simple:

```text
raw/    = canonical evidence
notes/  = durable understanding
.hl/    = rebuildable index, metadata, context, activity
agents  = readers/writers of the knowledge layer, not owners of raw evidence
```

The CLI name is `hl`:

```bash
hl init
hl ingest raw/pdf/flash-attention.pdf
hl links check --fix
hl embeddings refresh --changed
hl context current
hl today
hl mcp stdio
```

---

## 7. Proposed Feature Set

### 7.1 Raw Corpus Management

The raw corpus stores immutable study material.

Features:

```text
Add PDFs, webpages, HTML snapshots, code, images, and text
Hash raw sources
Detect duplicates and moved files
Extract source metadata
Snapshot web pages to avoid link rot
Register sources in SQLite
Sync raw corpus through WebDAV, rclone, Syncthing, or similar tools
Prevent agents from modifying raw/ by default
```

### 7.2 Markdown Wiki

The wiki is plain markdown, readable by humans and agents.

Features:

```text
Concept notes
Paper/source notes
Project notes
Daily notes
Literature notes
YAML frontmatter
Aliases and tags
Git synchronization
Agent-generated changelogs
Duplicate-note detection
```

### 7.3 Hybrid Markdown Editor

The built-in VS Code markdown editor is insufficient because it does not provide Obsidian-style hybrid rendering. CodeMirror is a natural basis because it is an extensible editor component designed around modular behavior.  [oai_citation:5‡Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=JoelRodriguezGuzman.markdown-view&utm_source=chatgpt.com)

Features:

```text
Source mode
Live Preview / hybrid mode
Reading mode
Raw syntax on active line
Rendered inactive lines
Wikilink autocomplete
Source-link autocomplete
Hover previews
Backlink badges
Math rendering
Code block rendering
Callouts
Tags
Frontmatter editor
Cmd-click / Ctrl-click link navigation
```

### 7.4 Link Syntax and Navigation

Canonical persisted links should be valid markdown links:

```md
[FlashAttention tiling explanation](raw/pdf/flash-attention.pdf#page=3)

[CUDA kernel](raw/code/attention.cu#L80-L145)

[Triton docs paragraph](https://triton-lang.org/main/getting-started/tutorials/06-fused-attention.html#:~:text=FlashAttention)

[[Online Softmax#Why This Matters]]
```

Human Learning can still support Obsidian-style authoring syntax:

```md
[[Online Softmax]]
[[pdf:flash-attention#page=3|paper section]]
```

but the default saved form should be markdown-compatible. In VS Code, the extension can provide document links and custom URI handling so Cmd-click / Ctrl-click opens the correct target: PDF viewer, source code range, HTML snapshot, note heading, or image region.

### 7.5 PDF Viewer and PDF Anchors

PDF support is central. MuPDF WebViewer is relevant because it provides web-based PDF viewing and supports text extraction, annotations, highlights, and markup workflows.  [oai_citation:6‡GitHub](https://github.com/lewislulu/llm-wiki-skill?utm_source=chatgpt.com)

Features:

```text
Open PDF inside VS Code
Render pages
Select text
Create page/rect anchors
Extract selected text
Insert source links into markdown
Jump from note to exact PDF region
Jump from PDF region to referencing notes
Track viewed pages
Export PDF selection to agent context
```

PDF anchor:

```json
{
  "kind": "pdf_rect",
  "source": "raw/pdf/flash-attention.pdf",
  "page": 3,
  "rects": [[120, 240, 530, 310]],
  "text_quote": "FlashAttention uses tiling...",
  "source_hash": "sha256:..."
}
```

### 7.6 PDF Reference Highlights and Annotations

PDF regions referenced by notes should be visibly highlighted. These highlights are not the same as manual study annotations.

```text
Reference highlights:
  generated from markdown links and the link graph

User annotations:
  manually created highlights, ink, underlines, margin notes
```

Features:

```text
Reference overlays for cited PDF regions
Referenced-by popup in PDF viewer
Click PDF highlight -> open citing note
Click note source link -> open PDF region
Multiple notes can cite the same region
Sidecar metadata for reference overlays
Raw PDF remains immutable by default
Optional export to annotated PDF copy
```

### 7.7 HTML Snapshot Viewer

The system should store web pages as local snapshots, not depend only on live URLs.

Features:

```text
Save webpage snapshot under raw/web/
Store original URL and fetch timestamp
Select DOM element or text range
Create HTML source anchors
Insert source link into notes
Jump from note to exact HTML element
Export selected HTML fragment to agent context
```

### 7.8 Code Source Anchors

VS Code remains the native code editor. Human Learning adds a knowledge graph layer on top.

Features:

```text
Code line-range anchors
Future symbol anchors via language-server data
Link markdown notes to source code
Link source code regions to concepts
Repair moved line ranges using text quotes
Export selected code with related notes and sources
```

Example:

```md
[FlashAttention CUDA kernel](raw/code/attention.cu#L80-L145)
```

### 7.9 Bidirectional Link Graph

The link graph connects notes, sources, and anchors.

Features:

```text
Parse note links
Parse source links
Build backlinks
Build outgoing links
Detect unresolved links
Detect stale anchors
Detect duplicate notes
Repair safe broken links
Generate link reports
Expose graph to agents
```

The graph should connect any anchor to any anchor:

```text
note heading -> PDF paragraph
PDF paragraph -> code function
HTML section -> markdown note
code range -> paper section
daily note -> source anchor
```

### 7.10 Embeddings and Search

Embeddings are optional support infrastructure, not the source of truth.

Features:

```text
Lexical search
Optional vector search
Hybrid search
Chunk raw sources
Chunk notes
Hash chunks
Embed only changed chunks
Related notes
Related source chunks
Duplicate detection
Context expansion for agents
Rebuildable index
```

Embedding modes:

```yaml
embeddings:
  mode: disabled | remote | local
  provider: openai-compatible | ollama | sentence-transformers | custom
  model: ...
  endpoint: ...
```

A GPU is not required. Non-GPU users can use lexical search, remote embeddings, or let agents search the raw corpus through CLI/MCP. GPU users can run local embeddings, reranking, or local LLM workflows.

### 7.11 Activity Tracking and Daily Summaries

Activity tracking turns the system into a study environment.

Features:

```text
Track opened notes
Track viewed PDF pages
Track viewed HTML sections
Track selected text
Track inserted links
Track context exports
Track agent handoffs
Generate daily summaries
Create review queues
Suggest missing notes
Privacy controls and opt-out
```

Example daily note:

```md
# 2026-05-23 Study Summary

## Sources studied
- raw/pdf/flash-attention.pdf pages 3-8
- notes/CUDA Shared Memory.md
- src/kernel.cu L80-L145

## Concepts touched
- FlashAttention
- Online Softmax
- Shared Memory Tiling

## Open questions
- How does online softmax preserve numerical stability across tiles?

## Suggested updates
- Update [FlashAttention](../Concepts/FlashAttention.md)
- Link [Online Softmax](../Concepts/Online%20Softmax.md) to Numerical Stability
```

### 7.12 Agent Integration

Agent integration is central.

The system should support:

```text
AGENTS.md
CLAUDE.md
Codex skill
Claude commands
Optional Claude hooks
Optional MCP server
File-based context bundles
Clipboard prompts
CLI commands
```

`AGENTS.md` is an emerging convention for giving coding agents repository instructions, and Codex documents Agent Skills as packages of instructions, resources, and optional scripts for task-specific workflows.  [oai_citation:7‡Zotero](https://www.zotero.org/?utm_source=chatgpt.com) MCP is the long-term standard interface for exposing tools, resources, and prompts to agents. The initial release should still rely on file-based context bundles because they are transparent and robust.

Context files:

```text
.hl/agent/selection.md
.hl/agent/selection.json
.hl/agent/related.md
.hl/agent/today.md
```

MCP tools:

```text
hl.get_current_selection
hl.search
hl.get_anchor
hl.get_related
hl.get_backlinks
hl.get_forward_links
hl.check_links
hl.refresh_embeddings
hl.ingest
hl.summarize_today
```

### 7.13 Optional iPad Companion

The iPad is optional and should not own the main workflow. Its role is reading, handwriting, and lightweight capture.

Features:

```text
Open synced PDFs
Apple Pencil PDF annotation
Highlight and margin notes
Handwritten markdown notes inserted as images
Mobile inbox for later desktop import
Sidecar annotation metadata
Jump from note to PDF region
Tap PDF reference highlight to see citing notes
```

For markdown, handwriting should simply be inserted as an image:

```md
![handwritten note](assets/ink/2026-05-23-flashattention-note.png)
```

For PDFs, the ideal experience is full handwritten annotation with sidecar metadata so raw PDFs remain immutable.

---

## 8. Related Work

### 8.1 Karpathy’s LLM Wiki

Karpathy’s LLM Wiki is the conceptual foundation. It proposes raw sources plus an LLM-maintained directory of markdown wiki files: summaries, entity pages, concept pages, comparisons, overviews, and syntheses.  [oai_citation:8‡Gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f?utm_source=chatgpt.com) Human Learning adopts this pattern but adds interactive source anchors, VS Code custom editors, PDF/code/web selection, link repair, activity history, and agent context handoff.

### 8.2 `karpathy-llm-wiki`

`Astro-Han/karpathy-llm-wiki` is the closest implementation-level precedent. It already targets Claude Code, Cursor, Codex, Agent Skills, raw sources, citations, and linting.  [oai_citation:9‡GitHub](https://github.com/Astro-Han/karpathy-llm-wiki?utm_source=chatgpt.com) Human Learning should interoperate with that direction, but its scope is broader: it is an interactive VS Code research workspace rather than only an agent skill.

### 8.3 Obsidian

Obsidian is the key UX precedent for local markdown knowledge work. It popularized local vaults, bidirectional note links, graph-oriented thinking, daily notes, and hybrid live preview. Obsidian’s own positioning emphasizes linking notes to create a personal Wikipedia-like knowledge base.  [oai_citation:10‡Obsidian](https://obsidian.md/?utm_source=chatgpt.com)

Human Learning differs in three ways:

```text
It is built inside VS Code.
It treats PDFs, code, webpages, and images as first-class source anchors.
It is designed from the start for Claude Code, Codex, CLI, and MCP workflows.
```

### 8.4 Zotero

Zotero remains the best reference-management tool in this ecosystem. It should not be replaced. It collects, organizes, annotates, cites, and shares research.  [oai_citation:11‡Zotero](https://www.zotero.org/?utm_source=chatgpt.com) Human Learning should integrate with Zotero metadata and citation keys, but its core responsibility is different: source-addressed study, markdown synthesis, and agent context.

The Zotero–Obsidian ecosystem shows why native source anchoring matters. Current workflows often depend on Better BibTeX, citation-key conventions, note templates, and community plugins; discussions around plugin breakage, Zotero 8 changes, and citation-key/export mismatches show that this bridge can be fragile.  [oai_citation:12‡marianamontes.me](https://www.marianamontes.me/post/obsidian-and-zotero/?utm_source=chatgpt.com) Human Learning should reduce this fragility by treating source anchors and notes as one graph, while still importing Zotero metadata where useful.

### 8.5 CodeMirror

CodeMirror is the right basis for the custom markdown editor because it is an extensible browser editor component suitable for syntax highlighting, decorations, widgets, and custom editing behavior. Existing VS Code markdown editor extensions already use webview-based editors and CodeMirror-like approaches, which supports the feasibility of this direction.  [oai_citation:13‡Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=JoelRodriguezGuzman.markdown-view&utm_source=chatgpt.com)

### 8.6 MuPDF WebViewer

MuPDF WebViewer is relevant for browser-compatible PDF viewing, text extraction, annotations, highlights, and markup.  [oai_citation:14‡GitHub](https://github.com/lewislulu/llm-wiki-skill?utm_source=chatgpt.com) Human Learning’s PDF use case is not general PDF editing; it is precise source anchoring, reference highlighting, handwritten annotation support, and agent context export.

### 8.7 VS Code Extension Platform

VS Code provides the host environment. Its webview API supports fully customizable views and complex UI beyond native APIs; custom editors use webviews and communicate with the extension host via message passing.  [oai_citation:15‡Visual Studio Code](https://code.visualstudio.com/api/extension-guides/webview?utm_source=chatgpt.com) This makes VS Code suitable for a research workspace that spans markdown, PDFs, HTML snapshots, code, and agent panels.

---

## 9. Proposed Contribution

Human Learning’s contribution is not “Obsidian in VS Code” or “RAG over markdown.” It is the combination of:

```text
1. Agent-maintained markdown wiki
2. Immutable raw source corpus
3. Cross-format source anchors
4. Obsidian-like hybrid editing
5. PDF/HTML/code selection as first-class context
6. Reference highlights and bidirectional jumps
7. Backlink/forward-link repair
8. Optional local or remote embeddings
9. Study activity summaries
10. CLI + skill + MCP interfaces
11. Claude Code and Codex compatibility
12. Optional iPad handwriting and PDF annotation workflow
```

The system’s core invariant:

```text
Every meaningful selection can become:
  a stable anchor
  a markdown link
  a graph edge
  an optional embedding chunk
  an activity event
  an agent context bundle
  an optional MCP resource
```

That invariant is the technical heart of the product.

---

## 10. Open-source Positioning

Human Learning should optimize for trust, portability, and hackability:

```text
MIT or Apache-2.0 license
Local-first by default
No required cloud service
No GPU requirement
Plain markdown notes
Standard markdown links where possible
Transparent SQLite index
Rebuildable embeddings
Provider-agnostic model APIs
Documented native reference model
Composable hl CLI
Optional MCP server
Minimal lock-in
```

It should explicitly invite integrations:

```text
Zotero metadata import
Obsidian import/export
Pandoc export
WebDAV/rclone/Syncthing sync
Local embedding backends
Remote embedding providers
Claude Code workflows
Codex workflows
Cursor/OpenCode workflows
MCP clients
iPad annotation companion
```

---

## 11. One-sentence Proposal

**Human Learning is an open-source, local-first VS Code vault that helps humans learn with machines by turning PDFs, webpages, source code, markdown notes, handwritten annotations, and agent context into one source-grounded, bidirectionally linked knowledge graph.**
