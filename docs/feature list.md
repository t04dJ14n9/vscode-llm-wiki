Below is the **latest consolidated feature list** for **Human Learning (`hl`)**, updated with the newer positioning:

> **Machine learning teaches machines to learn. Human Learning uses machines to help humans learn better.**

Human Learning is therefore not just an AI knowledge-base tool. It is a **local-first VS Code learning environment** where AI improves human understanding, retention, review, and source-grounded study.

---

# Human Learning — Latest Feature List

## 1. Core product definition

**Human Learning** is an open-source, local-first VS Code workspace for **AI-assisted human learning**. Users add raw materials—PDFs, webpages, code, markdown notes, images, handwritten annotations—and the system helps transform them into source-grounded understanding.

The project still follows a **Karpathy Wiki–style** source-to-wiki workflow, but the main objective is not “make agents learn the repo.” It is to help the human learner trace claims to sources, connect concepts, preserve study history, review knowledge, and build durable understanding. Your existing abstract already says this clearly: the goal is “not just to help LLMs get work done, but to help humans learn with machines.” [oai_citation:0‡VSCode Research Workspace.txt](sediment://file_000000007d5c71fd981570bd90ee0597)

Sharp definition:

```text
Human Learning is a local-first VS Code workspace where AI helps humans understand, retain, and connect knowledge from PDFs, code, webpages, notes, and annotations.
```

---

## 2. Workspace and vault layout

Use the renamed **Human Learning** layout consistently:

```text
vault/
  raw/                    # immutable source corpus
    pdf/
    web/
    code/
    images/
    text/

  notes/                  # markdown knowledge base
    Concepts/
    Papers/
    Projects/
    Daily Notes/
    Literature Notes/
    assets/
      ink/

  .hl/                    # local metadata, indexes, activity, context
    config.yaml
    index.sqlite
    embeddings/
    cache/
    logs/
    reports/
    annotations/
      pdf/
    references/
      pdf/
      html/
      code/
    anchors/
    agent/
      selection.md
      selection.json
      related.md
      today.md
      context.md
      context.json
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

This updates the older `.kwiki` naming to `.hl`, which your implementation plan explicitly requires: old `kwiki`, `.kwiki/`, `kwiki CLI`, and `raw://` links should become `Human Learning`, `.hl/`, `hl CLI`, and `hl://` links. [oai_citation:1‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

Sync policy:

```text
Commit/sync:
  notes/
  notes/assets/ink/
  AGENTS.md
  CLAUDE.md
  .agents/skills/
  .claude/commands/
  .hl/config.yaml
  optionally .hl/annotations/

Do not commit by default:
  .hl/index.sqlite
  .hl/embeddings/
  .hl/cache/
  .hl/logs/
  .hl/activity.jsonl
```

The existing plan already treats the local index and embeddings as rebuildable from `raw/` and `notes/`, and marks activity as privacy-sensitive / opt-in for sync. [oai_citation:2‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

## 3. Raw corpus management

The `raw/` folder is the canonical evidence layer.

Supported source types:

```text
PDF papers
HTML/web snapshots
source code
markdown files
images/screenshots
plain text
agent-generated context files
```

Features:

| Feature              | Description                                             |
| -------------------- | ------------------------------------------------------- |
| Add raw source       | Add PDF, HTML, code, image, or text to `raw/`.          |
| Immutable raw corpus | Agents do not modify `raw/` by default.                 |
| Content hashing      | Detect moved, changed, or duplicate sources.            |
| Source registry      | Track sources in SQLite.                                |
| Source metadata      | Store title, URL, author, date, source hash, file type. |
| Web snapshotting     | Save webpages locally to avoid link rot.                |
| Re-ingestion         | Re-extract chunks and metadata when sources change.     |
| Deduplication        | Detect same source under different names.               |

---

## 4. Markdown knowledge base

The `notes/` folder is the durable human understanding layer.

Features:

| Feature                  | Description                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Concept notes            | Reusable pages for concepts like `FlashAttention`, `Online Softmax`, `Shared Memory`. |
| Paper notes              | Source-grounded summaries of papers or documents.                                     |
| Project notes            | Implementation plans, design decisions, research logs.                                |
| Daily notes              | Date-based study logs and daily summaries.                                            |
| Literature notes         | Longer source-grounded synthesis notes.                                               |
| YAML frontmatter         | IDs, aliases, tags, sources, status, created/updated dates.                           |
| Tags                     | `#tag` and frontmatter tags.                                                          |
| Note templates           | Templates for concepts, papers, projects, daily notes.                                |
| Agent-maintained updates | Agents can update notes while preserving source links.                                |
| Duplicate-note detection | Warn when a new note duplicates an existing concept.                                  |

The markdown layer should remain portable and readable outside the extension. Your plan explicitly says plain markdown notes are a requirement. [oai_citation:3‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

## 5. Source anchors as the central abstraction

This is the technical heart of the project.

Every meaningful selection should become:

```text
1. a stable anchor
2. a markdown link
3. a graph edge
4. an optional embedding chunk
5. an activity event
6. an agent context bundle
7. an optional MCP resource
8. optionally, a learning/review object
```

Supported anchor types:

| Source type      | Anchor example                                              |
| ---------------- | ----------------------------------------------------------- |
| Markdown note    | `hl://note/notes/Concepts/FlashAttention.md`                |
| Markdown heading | `hl://note/notes/Concepts/FlashAttention.md#online-softmax` |
| Markdown block   | `hl://anchor/anc_note_8f21`                                 |
| PDF region       | `hl://pdf/raw/pdf/flash-attention.pdf?anchor=anc_pdf_8f21`  |
| HTML element     | `hl://web/raw/web/triton.html?selector=main/article/p[12]`  |
| Code range       | `hl://code/src/kernel.cu?lines=80-145`                      |
| Code symbol      | `hl://code/src/kernel.cu?symbol=flash_attention_kernel`     |
| Image region     | `hl://image/raw/images/diagram.png?rect=20,40,300,200`      |

Anchor record:

```json
{
  "id": "anc_pdf_8f21",
  "source_id": "src_...",
  "kind": "pdf_rect",
  "uri": "hl://pdf/raw/pdf/fa.pdf?anchor=anc_pdf_8f21",
  "locator": {
    "page": 3,
    "rects": [[120, 240, 530, 310]]
  },
  "text_quote": "FlashAttention uses tiling...",
  "text_hash": "sha256:...",
  "source_hash": "sha256:...",
  "status": "resolved",
  "created_by": "human_selection",
  "created_at": "..."
}
```

Your PDF/markdown design doc correctly states the reliability rule: agents should not invent PDF rectangle geometry; instead, the agent should ask `hl` to validate text or create the anchor, then insert the returned URI. [oai_citation:4‡PDF vs Markdown Editors.txt](sediment://file_0000000071c471fdb683c727036140ae)

---

## 6. Canonical link model

Use **standard markdown links** as the persisted format wherever possible:

```md
[FlashAttention tiling](hl://pdf/raw/pdf/fa.pdf?anchor=anc_pdf_8f21)

[CUDA kernel](hl://code/src/attention/kernel.cu?lines=80-145)

[Online Softmax](hl://note/notes/Concepts/Online%20Softmax.md#online-softmax)
```

Support Obsidian-style wikilinks as authoring sugar:

```md
[[FlashAttention]]
[[FlashAttention#Online Softmax]]
[[FlashAttention|FA]]
```

But normalize or index them into canonical `hl://` graph edges.

Rationale:

```text
standard markdown = portable
hl:// URI = semantic target
SQLite = derived link graph
sidecars = durable precise anchor metadata
```

---

## 7. Bidirectional link graph

The graph connects notes, sources, anchors, and learning objects.

Features:

| Feature               | Description                                          |
| --------------------- | ---------------------------------------------------- | --------- |
| Wikilink parsing      | Parse `[[Note]]`, `[[Note#Heading]]`, `[[Note        | Alias]]`. |
| Markdown link parsing | Parse `[label](hl://...)`.                           |
| Source-link parsing   | Resolve PDF/code/web/image/note anchors.             |
| Backlinks             | Incoming links to current note/source/anchor.        |
| Forward links         | Outgoing links from current note/source/anchor.      |
| Broken-link detection | Detect unresolved notes, moved files, stale anchors. |
| Safe repair           | Auto-fix only exact or high-confidence cases.        |
| Ambiguity reports     | Write ambiguous fixes to `.hl/reports/`.             |
| Problems panel        | Surface broken/stale links in VS Code.               |
| Graph export          | Export graph as JSON for agents and visualization.   |

Your feature inventory already identifies backlinks, forward links, broken-link detection, safe repair, graph export, and Problems panel integration as graph requirements. [oai_citation:5‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

## 8. Human learning objects and review system

This is the most important new addition versus the older feature list.

Human Learning should introduce a first-class **Learning Object** model. Anchors tell us _where knowledge comes from_; learning objects tell us _what the human should learn and review_.

Learning object types:

```text
concept_card
cloze_card
code_trace
explain_from_memory
bug_hunt
implementation_drill
compare_and_contrast
paper_claim_check
summary_reconstruction
transfer_task
```

Schema sketch:

```ts
type LearningObjectKind =
  | "concept_card"
  | "cloze_card"
  | "code_trace"
  | "explain_from_memory"
  | "bug_hunt"
  | "implementation_drill"
  | "compare_and_contrast"
  | "paper_claim_check"
  | "summary_reconstruction"
  | "transfer_task";

interface LearningObject {
  id: string;
  kind: LearningObjectKind;
  title: string;
  prompt: string;
  idealAnswer?: string;
  hints?: string[];
  anchorIds: string[];
  tags: string[];
  difficultySeed: number;
  importance: number;
  retentionTarget: number;
  status: "draft" | "active" | "suspended" | "retired";
}
```

Review features:

| Feature                           | Description                                                           |
| --------------------------------- | --------------------------------------------------------------------- |
| Create review item from selection | Turn PDF/code/markdown/web selection into a learning object.          |
| Review queue sidebar              | Show due items, new items, forgotten items, and transfer tasks.       |
| Active recall                     | User answers before seeing source/answer.                             |
| Source reveal                     | Reveal exact source anchor after attempting recall.                   |
| Teach-back mode                   | User explains concept; AI checks against anchored sources.            |
| Code-trace mode                   | Predict behavior/output/invariants of code.                           |
| Transfer mode                     | Apply learned concept to a new situation.                             |
| Review history                    | Store attempts, confidence, latency, hints used, source reveals.      |
| Mastery state                     | Track difficulty, stability, retrievability, correctness, confidence. |
| Review debt                       | Estimate future burden before generating too many cards.              |

Scheduling:

```text
MVP:
  simple bootstrap intervals

First serious release:
  review queue + manual grading

Advanced:
  FSRS-like adaptive scheduling
```

FSRS is a good model because Anki’s current FSRS explanation describes memory state using retrievability, stability, and difficulty; retrievability is the probability of recall, stability is the time for recall probability to decay to 90%, and difficulty captures how hard the item is to increase in stability. [oai_citation:6‡Anki FAQs](https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html?highlight=reset+all&utm_source=chatgpt.com)

---

## 9. Hybrid markdown editor

MVP should start with native VS Code markdown plus link providers. The first serious release can add a CodeMirror 6 custom editor.

Features:

| Feature                | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| Source mode            | Raw markdown everywhere.                             |
| Hybrid live preview    | Active line raw, inactive lines rendered.            |
| Reading mode           | Fully rendered markdown.                             |
| Wikilink rendering     | Render `[[Note]]` links.                             |
| Source-link chips      | Render PDF/code/web links as readable chips.         |
| Link autocomplete      | Suggest notes, headings, anchors, sources.           |
| Hover preview          | Preview note, PDF snippet, code range, web fragment. |
| Math rendering         | Render LaTeX math.                                   |
| Code blocks            | Syntax-highlight fenced code.                        |
| Callouts               | Support Obsidian-style callouts.                     |
| Frontmatter editor     | Edit/display YAML metadata.                          |
| Inline backlink badges | Show incoming references near headings/blocks.       |
| Selection export       | Export selected block to `.hl/agent/selection.*`.    |

CodeMirror is suitable because it provides a modular editor system and official decoration APIs. Its decoration model supports mark, widget, replacing, and line decorations, which are exactly the primitives needed for hybrid markdown rendering. [oai_citation:7‡CodeMirror](https://codemirror.net/docs/?utm_source=chatgpt.com)

Design rule:

```text
The CodeMirror document remains raw markdown.
Rendered output is decoration/widget state.
```

Your plan already states this exact rule. [oai_citation:8‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

## 10. PDF viewer and PDF anchors

PDF is a first-class source type.

Features:

| Feature                      | Description                                               |
| ---------------------------- | --------------------------------------------------------- |
| Open PDF in VS Code          | Custom PDF viewer/editor inside VS Code.                  |
| Render pages                 | Zoom, navigation, outline.                                |
| Text selection               | Select sentence, paragraph, equation region, table text.  |
| Page/rect anchors            | Store page, rects, quote, hash, source hash.              |
| Create anchor from selection | Convert current PDF selection into stable anchor.         |
| Insert PDF source link       | Insert canonical `hl://pdf/...` link into active note.    |
| Note → PDF jump              | Click source link and open exact PDF page/region.         |
| PDF → note jump              | Click referenced region and see citing notes.             |
| Reference overlays           | Automatically highlight PDF regions cited by notes.       |
| User highlights              | Manual study highlights separate from reference overlays. |
| Margin notes                 | Attach comments/notes to PDF regions.                     |
| Annotation sidecars          | Store annotations outside raw PDFs.                       |
| Raw PDF immutability         | Do not mutate original PDFs by default.                   |

The PDF design doc emphasizes that the PDF engine should not own the product model: the engine handles rendering, text extraction, selection geometry, and maybe annotation primitives; Human Learning owns `hl://`, anchor IDs, the graph, sidecars, note/PDF navigation, context export, and repair. [oai_citation:9‡PDF vs Markdown Editors.txt](sediment://file_0000000071c471fdb683c727036140ae)

Recommended engine strategy:

```text
Primary prototype:
  EmbedPDF / PDFium if VS Code webview packaging works

Fallback:
  PDF.js

Optional advanced:
  MuPDF / MuPDF.js if licensing and packaging fit
```

---

## 11. PDF reference highlighting and annotations

Separate generated reference highlights from human study annotations.

```text
Reference highlights:
  generated from notes that cite PDF regions

User annotations:
  human-created highlights, ink, comments, margin notes
```

Reference sidecar:

```text
.hl/references/pdf/fa.references.json
```

Annotation sidecar:

```text
.hl/annotations/pdf/fa.annotations.json
```

Features:

| Feature               | Description                                       |
| --------------------- | ------------------------------------------------- |
| Reference overlay     | Cited regions highlighted automatically.          |
| Referenced-by popup   | Click region to see notes that cite it.           |
| Open note from PDF    | Jump from cited PDF region to note line.          |
| Open PDF from note    | Jump from note link to exact PDF anchor.          |
| Multiple references   | Same anchor can be cited by many notes.           |
| User annotation layer | Human-created highlights/comments/ink.            |
| Optional export       | Export annotated copy if desired.                 |
| Anchor validation     | Validate whether anchors still match source.      |
| Anchor repair         | Repair stale anchors by quote/hash when possible. |

Your current PDF plan already distinguishes “user annotations” from “reference highlights,” which is crucial because “I highlighted this while reading” and “this region is cited by the wiki” mean different things. [oai_citation:10‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

## 12. HTML/web snapshot viewer

Webpages should be stored locally to avoid link rot.

Features:

| Feature                | Description                                         |
| ---------------------- | --------------------------------------------------- |
| Save webpage snapshot  | Store HTML under `raw/web/`.                        |
| Preserve original URL  | Store URL and fetch timestamp.                      |
| Sanitize/sandbox HTML  | Do not execute arbitrary remote scripts by default. |
| DOM selection          | Select element, paragraph, or range.                |
| Web anchors            | Store selector, quote, source hash, original URL.   |
| Insert web source link | Link note to exact webpage fragment.                |
| Note → web jump        | Open snapshot and scroll to element.                |
| Reference overlays     | Show which HTML fragments are cited.                |
| Agent context export   | Export selected fragment with metadata.             |

---

## 13. Code anchors

VS Code remains the native code editor. Human Learning adds a source graph layer.

Features:

| Feature                     | Description                                                           |
| --------------------------- | --------------------------------------------------------------------- |
| Code line-range anchors     | `hl://code/src/kernel.cu?lines=80-145`.                               |
| Symbol anchors              | Later: function/class/module anchors via language server/tree-sitter. |
| Link notes to code          | Concept notes cite implementations.                                   |
| Link code to notes          | Code ranges show related notes/concepts.                              |
| Code-reference highlighting | Show note references near code ranges.                                |
| Agent context export        | Export selected code plus source/note context.                        |
| Repair moved ranges         | Use text quote/fuzzy matching to repair changed line ranges.          |

---

## 14. Search and embeddings

Search should be local-first and anchor-preserving.

Core rule:

```text
Every search result should resolve to a source anchor.
```

MVP:

```text
SQLite FTS5 / BM25 lexical search
chunk table
source/anchor identity
agent-readable JSON output
```

Advanced:

```text
optional remote embeddings
optional local embeddings
hybrid lexical + vector search
reciprocal rank fusion
optional reranking
QMD-inspired collection/context model
```

Features:

| Feature             | Description                                         |
| ------------------- | --------------------------------------------------- |
| Lexical search      | Works without GPU or embeddings.                    |
| Vector search       | Optional semantic search.                           |
| Hybrid search       | Combine lexical and vector.                         |
| Incremental refresh | Embed only changed chunks.                          |
| Chunk hashing       | Avoid re-embedding unchanged content.               |
| Collection metadata | Notes, PDFs, web, code, daily notes, agent context. |
| Related context     | Find related notes/source chunks.                   |
| Duplicate detection | Detect redundant notes/chunks.                      |
| Rebuildable index   | Rebuild from `raw/` and `notes/`.                   |
| Non-GPU support     | Core features work without GPU.                     |

Your QMD addition says Human Learning should borrow QMD’s retrieval architecture—BM25, vector search, hybrid fusion, optional reranking—but preserve the source-anchor graph as the primary unit. [oai_citation:11‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

## 15. Agent context handoff

This remains one of the most important feature groups.

Features:

| Feature           | Description                                      |
| ----------------- | ------------------------------------------------ |
| Selection export  | Export selected PDF/markdown/code/HTML fragment. |
| Context markdown  | Write `.hl/agent/selection.md`.                  |
| Context JSON      | Write `.hl/agent/selection.json`.                |
| Related context   | Write `.hl/agent/related.md`.                    |
| Today context     | Write `.hl/agent/today.md`.                      |
| Clipboard prompt  | Copy compact prompt for any agent.               |
| Source provenance | Include anchor URI, quote, source metadata.      |
| Link expansion    | Include backlinks/forward links.                 |
| Suggested task    | Include suggested agent instruction.             |

Example:

```text
.hl/agent/selection.md
.hl/agent/selection.json
.hl/agent/related.md
.hl/agent/today.md
```

This is critical because selections inside a custom webview are not automatically visible to Claude Code or Codex; your feature plan explicitly says the extension must export context. [oai_citation:12‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

## 16. Claude Code compatibility

Features:

| Feature                | Description                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `CLAUDE.md` generation | Repository-level instructions for Claude Code.                                      |
| `.claude/commands`     | Reusable commands: explain selection, ingest source, repair links, summarize today. |
| Optional hooks         | Run link checks/embedding refresh after edits.                                      |
| Optional MCP config    | Allow Claude to query `hl` tools/resources.                                         |
| File-based context     | Claude reads `.hl/agent/selection.md`.                                              |
| Raw protection         | Tell Claude not to edit `raw/`.                                                     |
| Maintenance workflow   | Tell Claude to run `hl links check --fix` after note edits.                         |

Example commands:

```text
.claude/commands/hl-explain-selection.md
.claude/commands/hl-ingest.md
.claude/commands/hl-repair-links.md
.claude/commands/hl-today.md
```

Hooks should remain opt-in because they automate lifecycle actions after agent edits.

---

## 17. Codex compatibility

Features:

| Feature                | Description                                                       |
| ---------------------- | ----------------------------------------------------------------- |
| `AGENTS.md` generation | Instructions for Codex and other agents.                          |
| Codex skill            | `.agents/skills/human-learning/SKILL.md`.                         |
| Optional MCP config    | `.codex/config.toml`.                                             |
| File-based context     | Codex reads `.hl/agent/selection.md`.                             |
| CLI workflows          | Codex can run `hl` commands directly.                             |
| Agent-safe rules       | Preserve source links, avoid duplicate notes, protect raw corpus. |

Example `AGENTS.md` rules:

```md
# Human Learning Vault Instructions

Rules:

- Do not edit raw/ unless explicitly asked.
- Prefer updating existing notes over creating duplicates.
- Preserve source links in hl:// format.
- Read .hl/agent/selection.md when the user mentions current selection.
- Do not invent PDF rectangle coordinates.
- After note edits, run:
  - hl links check --fix
  - hl embeddings refresh --changed
```

---

## 18. Optional MCP server

MCP is optional but first-class for advanced agent integration.

Default should be **read-only**.

Tools:

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
hl.learning.get_due
hl.learning.record_review
```

Resources:

```text
hl://selection/current
hl://activity/today
hl://anchor/{anchorId}
hl://source/{sourceId}
hl://notes/{path}
hl://learning/due
```

Prompts:

```text
hl_explain_selection
hl_ingest_source
hl_update_note
hl_repair_links
hl_daily_summary
hl_create_review_items
hl_teach_back
```

Security defaults:

```text
read-only tools enabled by default
mutating tools disabled unless explicitly configured
no generic shell execution
all mutations logged to .hl/logs/audit.jsonl
raw/ write protection enforced
paths must stay inside vault root
```

Your implementation plan already says mutating MCP tools must be narrow, explicit, auditable, and should avoid generic `run_shell_command`. [oai_citation:13‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

## 19. CLI features

The CLI is the headless interface for agents and scripts.

Commands:

```bash
hl init
hl status
hl add <path-or-url>
hl ingest <path> [--recursive]
hl index rebuild
hl links check [--fix] [--dry-run]
hl links rebuild
hl anchors create-pdf
hl anchors create-note-block
hl anchors resolve
hl anchors validate
hl embeddings refresh [--changed|--all]
hl search "<query>" --mode lexical|semantic|hybrid
hl context current
hl context export --anchor <anchor-uri>
hl today [--date YYYY-MM-DD]
hl review due
hl review create --anchor <anchor-uri>
hl review record --item <id>
hl doctor
hl mcp stdio
hl skills install --target codex|claude|all
hl hooks install --target claude
hl mobile import
```

CLI rules:

```text
every mutating command has --dry-run where practical
every command supports --json for agents
errors are structured and actionable
no command mutates raw/ unless explicit
```

---

## 20. VS Code UI views

Feature views:

| View                   | Description                                                       |
| ---------------------- | ----------------------------------------------------------------- |
| Human Learning sidebar | Main extension view container.                                    |
| Navigation / Outline   | Markdown headings, PDF outline, referenced regions, code symbols. |
| Backlinks panel        | Incoming links to current note/source/anchor.                     |
| Forward links panel    | Outgoing links from current note/source/anchor.                   |
| Review queue           | Due learning objects, forgotten items, transfer tasks.            |
| Agent context panel    | Current selection, related context, export controls.              |
| Raw corpus panel       | Sources, metadata, ingestion status.                              |
| Activity panel         | Viewed sources, selections, links, exports.                       |
| Problems panel         | Broken links, stale anchors, missing embeddings.                  |
| Mobile inbox panel     | iPad captures and annotations awaiting import.                    |
| PDF viewer             | PDF rendering, selection, anchors, reference highlights.          |
| Hybrid markdown editor | CodeMirror-based live preview editor.                             |
| HTML snapshot viewer   | Local web snapshots with DOM anchors.                             |

The uploaded plan already includes the key VS Code views: hybrid markdown editor, PDF viewer, HTML snapshot viewer, backlinks, forward links, agent context, raw corpus, activity, problems, and mobile inbox. [oai_citation:14‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

## 21. Activity tracking and study history

Activity tracking should support learning, not surveillance.

Features:

| Feature                | Description                                       |
| ---------------------- | ------------------------------------------------- |
| Open tracking          | Track opened notes, PDFs, webpages, code files.   |
| View tracking          | Track PDF pages, HTML sections, code ranges.      |
| Selection tracking     | Track selected source anchors.                    |
| Link creation tracking | Track new note/source links.                      |
| Agent handoff tracking | Track exported context.                           |
| Review tracking        | Track review attempts, correctness, confidence.   |
| Daily summary          | Generate a study summary.                         |
| Open questions         | Extract unresolved questions from notes/activity. |
| Suggested updates      | Suggest notes/links/review objects to create.     |
| Privacy controls       | Disable or limit tracking.                        |

Daily note template:

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

## Review items created

- Explain online softmax from memory
- Trace FlashAttention tiling over one block

## Suggested updates

- Update [[FlashAttention]]
- Link [[Online Softmax]] to [[Numerical Stability]]
```

---

## 22. Optional iPad companion workflow

The iPad is optional. It should not own indexing, embeddings, agents, or graph repair.

iPad role:

```text
read
annotate
handwrite
capture
send to mobile inbox
```

VS Code desktop role:

```text
index
embed
repair links
run agents
maintain wiki
schedule reviews
```

Features:

| Feature                     | Description                        |
| --------------------------- | ---------------------------------- |
| PDF reading                 | Open synced PDFs from `raw/pdf/`.  |
| Apple Pencil PDF annotation | Freehand PDF annotation.           |
| PDF highlights              | Personal highlights.               |
| Margin handwriting          | Freehand comments around page.     |
| Markdown handwriting        | Insert drawings as image files.    |
| Mobile inbox                | Store captures for desktop import. |
| Sidecar annotations         | Keep annotations outside raw PDFs. |
| Desktop import              | `hl mobile import`.                |

Markdown handwriting should stay simple:

```md
![handwritten note](assets/ink/2026-05-23-flashattention-note.png)
```

Your current plan correctly says the iPad should remain optional and should avoid making mobile Git/indexing/agent workflows part of MVP. [oai_citation:15‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

## 23. Sync features

Features:

| Feature                         | Description                                            |
| ------------------------------- | ------------------------------------------------------ |
| Git sync for notes              | Version control markdown notes and agent instructions. |
| WebDAV/rclone/Syncthing for raw | Sync large raw corpus outside Git.                     |
| Optional annotation sync        | Sync PDF annotations and handwritten images.           |
| Rebuild index per device        | `.hl/index.sqlite` can be rebuilt locally.             |
| Conflict reporting              | Detect note conflicts after Git merges.                |
| Hash-based source recovery      | Repair moved raw files by hash.                        |
| Mobile import                   | Import iPad captures into desktop workspace.           |

---

## 24. Non-GPU and GPU modes

GPU must not be required.

| Mode                      | Capabilities                                                                  |
| ------------------------- | ----------------------------------------------------------------------------- |
| No GPU, no embeddings     | Anchors, notes, backlinks, CLI, context export, lexical search, review queue. |
| No GPU, remote embeddings | Semantic search through configured provider.                                  |
| Apple Silicon Mac         | Local or remote embeddings, good daily UX.                                    |
| GPU PC                    | Local embeddings, reranking, local LLM experiments, faster ingestion.         |

Core principle:

```text
GPU accelerates local AI.
GPU is not required for Human Learning.
```

Your feature list already states this explicitly. [oai_citation:16‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

## 25. Security and privacy

Features:

| Feature                   | Description                                        |
| ------------------------- | -------------------------------------------------- |
| Workspace trust           | Disable risky automation in untrusted workspaces.  |
| Raw corpus protection     | Agents do not edit `raw/` by default.              |
| Explicit cloud config     | Remote embeddings require explicit configuration.  |
| Local-first default       | No mandatory server.                               |
| Activity opt-out          | User can disable or limit tracking.                |
| MCP safety                | Mutating tools are narrow and explicit.            |
| Audit logs                | Record agent-triggered maintenance actions.        |
| Path sandboxing           | Tools cannot access outside vault root by default. |
| Webview sandboxing        | Local HTML/PDF rendering avoids unsafe scripts.    |
| Prompt-injection handling | Treat PDFs/webpages as untrusted source content.   |

Your existing feature list already includes workspace trust, raw protection, explicit cloud config, local-first default, activity opt-out, MCP safety, and audit logs. [oai_citation:17‡VSCode Research Workspace.txt](sediment://file_0000000079cc71f8b579551c33498c2f)

---

# Revised release prioritization

## MVP — prove the core invariant

Goal:

```text
Every meaningful selection can become:
  stable anchor
  markdown link
  graph edge
  agent context bundle
  simple learning object
```

MVP features:

```text
1. .hl workspace layout
2. hl init
3. SQLite schema
4. source registry
5. markdown/code ingestion
6. basic PDF text ingestion
7. hl:// URI parser
8. standard markdown link parser
9. backlinks / forward links
10. hl links check
11. native VS Code DocumentLinkProvider
12. VS Code command: Add Selection to Agent Context
13. .hl/agent/selection.md and selection.json
14. code range open
15. AGENTS.md and CLAUDE.md generation
16. Codex skill skeleton
17. Claude command skeleton
18. lexical search
19. basic learning object schema
20. manual review item creation from selection
21. hl doctor
```

This mostly matches the existing MVP list, but moves **basic learning objects** earlier because Human Learning should not postpone the “learning” part. [oai_citation:18‡VSCode Research Workspace.txt](sediment://file_000000003e0471fd98a5f5f903073357)

---

## First serious release

```text
1. PDF viewer with text selection
2. PDF page/rect anchors
3. PDF reference highlights
4. note → PDF jump
5. PDF → note referenced-by popup
6. Review queue sidebar
7. Teach-back review mode
8. Code-trace review mode
9. Bootstrap spaced review scheduler
10. CodeMirror hybrid markdown editor
11. Activity tracking
12. hl today daily summary
13. Optional embeddings
14. MCP read-only server
15. Claude/Codex workflow polish
```

---

## Advanced release

```text
1. FSRS-like adaptive scheduler
2. Transfer tasks and mastery dashboard
3. HTML snapshot viewer with DOM anchors
4. Full iPad companion workflow
5. Handwritten PDF annotation sidecars
6. Markdown handwriting image insertion
7. Symbol-aware code anchors
8. Graph visualization
9. Zotero metadata import
10. Obsidian import/export
11. Annotated PDF export copy
12. Local reranking / advanced hybrid retrieval
```

---

# Complete feature map

```text
Human Learning
├── Human-centered AI positioning
│   ├── AI helps humans learn
│   ├── not just agent memory
│   ├── source-grounded understanding
│   └── durable retention
├── Workspace
│   ├── raw/
│   ├── notes/
│   ├── .hl/
│   ├── AGENTS.md
│   └── CLAUDE.md
├── Raw Corpus
│   ├── PDFs
│   ├── HTML snapshots
│   ├── code
│   ├── images
│   ├── metadata
│   ├── hashing
│   └── immutable evidence
├── Markdown Wiki
│   ├── concept notes
│   ├── paper notes
│   ├── project notes
│   ├── daily notes
│   ├── literature notes
│   ├── wikilinks
│   └── source links
├── Source Anchors
│   ├── PDF regions
│   ├── markdown headings/blocks
│   ├── code ranges/symbols
│   ├── HTML DOM nodes
│   ├── image regions
│   └── stable hl:// URIs
├── Learning Objects
│   ├── concept cards
│   ├── cloze cards
│   ├── code traces
│   ├── explain-from-memory
│   ├── bug hunts
│   ├── implementation drills
│   ├── paper claim checks
│   └── transfer tasks
├── Review System
│   ├── review queue
│   ├── active recall
│   ├── source reveal
│   ├── teach-back mode
│   ├── review history
│   ├── mastery state
│   ├── review debt
│   └── FSRS-like scheduler later
├── Markdown Editor
│   ├── native editor MVP
│   ├── CodeMirror hybrid editor later
│   ├── source mode
│   ├── live preview
│   ├── reading mode
│   ├── math
│   ├── callouts
│   └── source-link chips
├── PDF System
│   ├── rendering
│   ├── text selection
│   ├── page/rect anchors
│   ├── reference highlights
│   ├── user annotations
│   ├── note → PDF jump
│   ├── PDF → note jump
│   └── anchor repair
├── HTML System
│   ├── snapshots
│   ├── DOM anchors
│   ├── reference overlays
│   └── agent export
├── Code Anchors
│   ├── line ranges
│   ├── symbols
│   ├── code → note links
│   └── note → code links
├── Link Graph
│   ├── backlinks
│   ├── forward links
│   ├── stale anchors
│   ├── broken links
│   ├── safe repair
│   └── diagnostics
├── Search / Retrieval
│   ├── SQLite FTS5 / BM25
│   ├── optional remote embeddings
│   ├── optional local embeddings
│   ├── hybrid search
│   ├── QMD-inspired retrieval
│   └── anchor-preserving results
├── Agent Integration
│   ├── selection.md
│   ├── selection.json
│   ├── related.md
│   ├── today.md
│   ├── AGENTS.md
│   ├── CLAUDE.md
│   ├── Codex skill
│   ├── Claude commands
│   └── MCP server
├── CLI
│   ├── init
│   ├── ingest
│   ├── links check/fix
│   ├── anchors create/resolve/validate
│   ├── search
│   ├── context export
│   ├── review due/create/record
│   ├── today
│   ├── mobile import
│   └── doctor
├── Activity
│   ├── viewed sources
│   ├── selections
│   ├── agent exports
│   ├── daily summaries
│   ├── open questions
│   └── review history
├── iPad Companion
│   ├── PDF reading
│   ├── Apple Pencil annotations
│   ├── markdown drawing images
│   ├── mobile inbox
│   └── desktop import
├── Sync
│   ├── Git for notes
│   ├── WebDAV/rclone/Syncthing for raw
│   ├── optional annotation sync
│   └── rebuildable index
└── Security / Privacy
    ├── workspace trust
    ├── raw protection
    ├── local-first default
    ├── cloud opt-in
    ├── activity opt-out
    ├── MCP read-only default
    ├── audit logs
    └── webview sandboxing
```

The current best one-sentence product definition is:

> **Human Learning is a local-first VS Code workspace where AI helps humans learn better by turning PDFs, code, webpages, notes, annotations, and review history into one source-grounded learning graph.**
