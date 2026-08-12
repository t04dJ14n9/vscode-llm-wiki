# LLM Wiki — Implementation Timeline

> Current status: this is a historical roadmap. It still mentions planned
> `llm-wiki://` work because that was the earlier design. The implemented MVP now uses
> native Markdown/Obsidian-compatible links. See
> [reference model.md](reference%20model.md) for current link formats.

## Assumptions

- **Solo developer** working full-time (~40h/week)
- **Part-time multiplier**: multiply all durations by 2–3× if working evenings/weekends
- **TypeScript expertise** assumed; VS Code extension and native Node addon experience not assumed
- **Estimates are ranges** (optimistic / expected / pessimistic) to account for research unknowns

---

## Phase 0: Foundation (Weeks 1–3)

**Goal**: Monorepo exists, CLI works, SQLite stores sources, lexical search returns results.

| Task | Effort | Notes |
|---|---|---|
| pnpm monorepo scaffolding | 2d | Workspaces, tsconfig paths, eslint, build scripts |
| `packages/core` — workspace/config | 2d | `.llm_wiki/config.yaml` read/write, vault detection |
| SQLite migration system | 2d | better-sqlite3, migration runner, schema versioning |
| `llm_wiki init`, `llm_wiki status`, `llm_wiki doctor` | 2d | Workspace bootstrap, validation, diagnostics |
| Source registry + hashing | 3d | `sources` table, SHA256, metadata extraction |
| Markdown ingestion | 2d | Frontmatter parse, heading extraction, chunking |
| Code file ingestion | 1d | Line-range chunking, language detection |
| Basic PDF text ingestion | 2d | Extract text per page via PDF.js headless; no layout index yet |
| Chunks table + SQLite FTS5 | 2d | Content hashing, incremental chunk updates |
| `llm_wiki ingest`, `llm_wiki add` | 2d | CLI commands with `--recursive`, `--json` |
| `llm_wiki search --mode lexical` | 2d | BM25 via FTS5, JSON output for agents |

**Deliverables**:
- `llm_wiki init demo-vault && llm_wiki doctor --json` succeeds
- `llm_wiki ingest notes/ && llm_wiki search "FlashAttention" --json` returns results

**Risk**: better-sqlite3 native compilation. Verify VS Code extension host + Electron compatibility during this phase. If problematic, evaluate `sql.js` (WASM) as fallback.

---

## Phase 1: Link Graph + Agent Context (Weeks 4–6)

**Goal**: Links parse into graph edges, backlinks/forward links resolve, agent context exports.

| Task | Effort | Notes |
|---|---|---|
| `llm-wiki://` URI parser | 2d | Formal grammar, normalization, validation |
| Standard markdown link parser | 2d | `[label](llm-wiki://...)` extraction |
| Wikilink parser | 1d | `[[Note]]`, `[[Note#Heading]]`, `[[Note\|Alias]]` |
| Links table + queries | 2d | Forward links, backlinks by note/source/anchor |
| `llm_wiki links rebuild` | 1d | Full reparse of all notes |
| `llm_wiki links check` | 2d | Resolve targets, detect broken/stale, diagnostics |
| `llm_wiki links check --fix --dry-run` | 2d | Safe auto-repair (exact matches only), ambiguity reports |
| Agent context export | 2d | `.llm_wiki/agent/selection.md` + `selection.json` |
| `llm_wiki context export`, `llm_wiki context current` | 1d | CLI with `--anchor`, `--source`, `--lines` flags |
| `AGENTS.md` + `CLAUDE.md` generation | 2d | Templates with vault rules, raw protection, citation rules |
| Codex skill skeleton | 1d | `.agents/skills/llm-wiki/SKILL.md` |
| Claude commands skeleton | 1d | `.claude/commands/llm-wiki-*.md` |

**Deliverables**:
- `llm_wiki links rebuild && llm_wiki links check --json` resolves real links
- `llm_wiki context export --source notes/Concepts/Foo.md` writes selection files
- `AGENTS.md` and `CLAUDE.md` exist with correct rules

---

## Phase 2: VS Code Extension MVP (Weeks 7–9)

**Goal**: VS Code extension activates, `llm-wiki://` links are clickable, backlinks panel works, context export works from editor.

| Task | Effort | Notes |
|---|---|---|
| Extension skeleton | 2d | `extension.ts`, activation events, package.json manifest |
| Workspace detection | 1d | Detect `.llm_wiki/` presence, activate accordingly |
| `llm-wiki://` DocumentLinkProvider | 2d | Cmd-click routing for `llm-wiki://note`, `llm-wiki://code` links |
| URI dispatcher | 2d | Route `llm-wiki://note/...` → open note; `llm-wiki://code/...` → open at line |
| HoverProvider | 2d | Preview note heading, code snippet on hover |
| Command: Add Selection to Agent Context | 2d | Write `.llm_wiki/agent/selection.*` from native editor selection |
| Command: Open Anchor | 1d | Parse `llm-wiki://` URI and dispatch |
| Backlinks TreeView | 2d | `TreeDataProvider`, refresh on file changes |
| Forward Links TreeView | 1d | Same pattern as backlinks |
| Agent Context TreeView | 1d | Show current `selection.md`, export controls |
| DiagnosticCollection | 2d | Broken links, stale anchors from `links` table |
| FileSystemWatcher | 1d | Re-parse on note changes, debounced |

**Deliverables**:
- Click `[source](llm-wiki://code/src/kernel.cu?lines=80-145)` → opens file at line 80
- Sidebar shows backlinks/forward links for current note
- "Add Selection to Agent Context" populates `.llm_wiki/agent/selection.md`

---

## Phase 3: PDF System (Weeks 10–16)

**Goal**: PDF viewer works, text selection creates anchors, `llm-wiki://pdf` links navigate bidirectionally.

### Phase 3a — Engine Research Spike (Weeks 10–11)

| Task | Effort | Notes |
|---|---|---|
| Create `packages/pdf` with engine interfaces | 1d | `PdfEngine`, `PdfViewerAdapter`, types |
| EmbedPDF adapter prototype | 4d | WASM bundling, VS Code webview, selection API |
| PDF.js fallback adapter prototype | 3d | Worker loading, text layer, selection geometry |
| 20-PDF test corpus assembly | 1d | arXiv ML papers, 2-column, textbook, equations-heavy, scanned |
| Pass/fail evaluation | 2d | Render, select, rect accuracy, text extraction, coordinate stability |

**Decision gate**: If EmbedPDF fails **selection-rect extraction** or **rect-to-text** at <95% accuracy on the test corpus, PDF.js becomes primary engine immediately. No sunk-cost exception.

### Phase 3b — Anchor Service (Weeks 12–13)

| Task | Effort | Notes |
|---|---|---|
| PDF layout index tables | 3d | `pdf_pages`, `pdf_text_blocks`, `pdf_text_spans`, `pdf_char_map` |
| Headless PDF extraction helper | 3d | CLI-side quote-to-rect via PDF.js (or PyMuPDF subprocess if needed) |
| `llm_wiki anchor create-pdf --quote` | 2d | Normalize, search, validate, persist anchor |
| `llm_wiki anchor resolve`, `llm_wiki anchor validate` | 2d | Lookup, source hash check, text quote re-extraction |
| `llm_wiki anchor repair` | 1d | Search by text_quote when rects stale |

### Phase 3c — PDF Viewer + Navigation (Weeks 14–16)

| Task | Effort | Notes |
|---|---|---|
| PDF webview custom editor | 3d | `CustomReadonlyEditorProvider`, webview host |
| Page rendering + navigation | 2d | Zoom, scroll, page thumbnails |
| Text selection → anchor | 2d | Selection → page rects → anchor creation |
| Insert source link from PDF | 1d | Write `llm-wiki://pdf/...` link into active markdown editor |
| Note → PDF jump (`jumpToAnchor`) | 2d | Scroll to page, highlight rect, pulse animation |
| Reference sidecar generation | 2d | `.llm_wiki/references/pdf/*.json` from SQLite links |
| Reference overlay rendering | 2d | Draw highlights from sidecar, distinct from user annotations |
| PDF → note referenced-by popup | 2d | Click overlay → list of citing notes → open at line |

**Deliverables**:
- Select PDF paragraph → insert source link into note → Cmd-click link → PDF opens at highlighted region → click region → popup shows referencing note

---

## Phase 4: Learning System (Weeks 17–20)

**Goal**: Users can create review items from selections, review queue surfaces due items, bootstrap scheduler works.

| Task | Effort | Notes |
|---|---|---|
| LearningObjects table + schema | 2d | Implement the `LearningObject` interface from feature list §8 |
| `llm_wiki review create --anchor` | 2d | Create concept_card, cloze_card, code_trace from anchor |
| `llm_wiki review due` | 1d | Query due items sorted by priority |
| `llm_wiki review record --item` | 2d | Record attempt, confidence, latency, hints used |
| Bootstrap spaced scheduler | 3d | Simple interval doubling (1d, 3d, 7d, 14d, 30d, 90d) |
| Review queue TreeView | 2d | Due items, new items, forgotten items |
| Review session webview | 3d | Active recall prompt → reveal answer → self-grade → next |
| Source reveal | 1d | Show source anchor after attempt |
| Teach-back mode (agent-driven) | 2d | User explains concept; agent prompt checks against anchored sources |
| Code-trace mode (agent-driven) | 2d | Predict output; agent prompt evaluates against actual behavior |

**Deliverables**:
- Select PDF paragraph → "Create Review Item" → item appears in queue → review → record score → reschedule

**Note**: Teach-back and code-trace modes are agent-driven in this phase — they generate a prompt for Claude Code/Codex to evaluate, rather than implementing native evaluation.

---

## Phase 5: Editor, Activity, MCP (Weeks 21–26)

### Phase 5a — CodeMirror Hybrid Editor (Weeks 21–23)

| Task | Effort | Notes |
|---|---|---|
| CustomTextEditorProvider | 2d | Register for `.md` files in vault |
| CodeMirror 6 webview integration | 3d | Mirror VS Code TextDocument, sync edits |
| Source mode + reading mode | 2d | Toggle between raw and rendered |
| Hybrid live preview mode | 3d | Active line raw, inactive lines rendered via decorations |
| Link rendering (chips) | 2d | Render `llm-wiki://` links as styled chips |
| Inline backlink badges | 1d | Show count near headings |
| Selection bridge | 1d | Webview selection → `.llm_wiki/agent/selection.*` |

### Phase 5b — Activity + Daily Summaries (Weeks 24–25)

| Task | Effort | Notes |
|---|---|---|
| Activity logging (opt-in) | 2d | Open/view/select/export events to `activity.jsonl` |
| `llm_wiki today` | 2d | Generate daily study summary markdown |
| `llm_wiki today --write` | 1d | Write into `notes/Daily Notes/` |
| Activity TreeView | 1d | Today's viewed sources, selections, links |
| Privacy controls | 1d | Opt-in default, disable per event type, inspectable data |

### Phase 5c — MCP Server (Week 26)

| Task | Effort | Notes |
|---|---|---|
| MCP stdio server | 2d | `llm_wiki mcp stdio` |
| Read-only tools | 2d | `get_current_selection`, `search`, `get_anchor`, `get_related`, `get_backlinks`, `get_forward_links`, `check_links`, `summarize_today`, `learning.get_due` |
| Mutating tools (config-gated) | 1d | `ingest`, `refresh_embeddings`, `learning.record_review` |
| Resources + prompts | 1d | `llm-wiki://selection/current`, prompt templates |

**Deliverables**:
- CodeMirror editor: active line shows raw markdown, inactive lines render
- `llm_wiki today --write` produces a daily study summary
- Claude Code configured with MCP can call `llm_wiki.search`, `llm_wiki.get_backlinks`

---

## Phase 6: Advanced Features (Weeks 27+)

**Goal**: Embeddings, HTML snapshots, iPad companion, import/export, FSRS.

| Task | Effort | Notes |
|---|---|---|
| Embedding provider abstraction | 3d | OpenAI-compatible, ollama, local GGUF adapters |
| Remote embeddings + hybrid search | 3d | RRF fusion, `llm_wiki search --mode hybrid` |
| Incremental embedding refresh | 2d | Hash-based change detection, `llm_wiki embeddings refresh --changed` |
| HTML snapshot viewer | 4d | Sanitize, render, DOM selection, anchors |
| Zotero metadata import | 2d | Better BibTeX key mapping, source metadata enrichment |
| Obsidian import/export | 2d | Wikilink conversion, frontmatter mapping |
| FSRS-like adaptive scheduler | 5d | Replace bootstrap intervals with FSRS parameters |
| Transfer tasks + mastery dashboard | 3d | Apply concept to new context, visualize progress |
| iPad companion | 8d | Separate app/repo; annotation sidecar sync, mobile inbox |
| Graph visualization | 3d | D3/vis-network render of link graph |
| Symbol-aware code anchors | 3d | tree-sitter or LSP integration |

---

## Cumulative Timeline (Expected)

```
Week  1–3   ████████  Phase 0: Foundation
Week  4–6   ████████  Phase 1: Link Graph + Agent Context
Week  7–9   ████████  Phase 2: VS Code Extension MVP          ← first user-visible milestone
Week 10–16  ██████████████  Phase 3: PDF System              ← core innovation ships
Week 17–20  ██████████  Phase 4: Learning System             ← "learning" product identity
Week 21–26  ██████████████  Phase 5: Editor, Activity, MCP   ← first serious release
Week 27+    ████████  Phase 6: Advanced Features             ← ongoing
```

**Key milestones**:

| Milestone | Week | What ships |
|---|---|---|
| **M0: CLI works** | 3 | `llm_wiki init`, `llm_wiki ingest`, `llm_wiki search`, `llm_wiki links check` |
| **M1: VS Code clickable** | 9 | `llm-wiki://` links navigate, backlinks visible, context exports |
| **M2: PDF anchors work** | 16 | Select text → anchor → link → bidirectional jump |
| **M3: Review works** | 20 | Create review items, review queue, bootstrap scheduler |
| **M4: First serious release** | 26 | Hybrid editor, activity, daily summaries, MCP |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| better-sqlite3 incompatible with VS Code Electron | Medium | High | Prototype in Phase 0; fallback to `sql.js` (WASM, no native deps) |
| EmbedPDF fails selection-to-rect gate | Medium | High | Hard go/no-go gate in Phase 3a; PDF.js fallback already built |
| CodeMirror 6 hybrid mode performance on large notes | Medium | Medium | Test with 5000+ line markdown files; fallback to source-only mode |
| PDF quote-to-rect accuracy insufficient for durable anchors | Medium | Critical | Page-level anchor fallback; fuzzy matching with confidence threshold |
| Solo developer burnout / context switching | High | High | Ship M1 before starting PDF; defer iPad/HTML/embeddings aggressively |
| Anchor ID collision across synced devices | Low | High | Use content-addressed anchor IDs (hash-based) before Phase 1 ships |
| VS Code API limitations block custom PDF viewer UX | Low | Medium | PDF.js has proven webview compatibility; EmbedPDF is the risk |

---

## Parallelization Opportunities

If a second developer joins:

| Phase | What can parallelize |
|---|---|
| Phase 0–1 | CLI (`packages/cli`) and core (`packages/core`) are sequential |
| Phase 2 | VS Code panels (Backlinks, Forward Links, Agent Context) can be built in parallel |
| Phase 3 | PDF.js fallback adapter can be built in parallel with EmbedPDF prototype |
| Phase 4 | Review queue TreeView and review session webview are parallel |
| Phase 5 | Activity tracking and MCP server are independent of CodeMirror editor |

---

## What's Deferred (Not in Timeline)

These are explicitly deferred beyond the first serious release:

- iPad companion app (separate codebase)
- HTML snapshot viewer
- FSRS-like adaptive scheduler (bootstrap intervals ship in Phase 4)
- Local GGUF embeddings + reranking
- Graph visualization
- Symbol-aware code anchors
- Zotero/Obsidian import/export
- Annotated PDF export
