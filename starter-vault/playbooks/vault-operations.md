---
type: "Playbook"
title: "Vault operations"
description: "Run the evidence-first capture, synthesis, reference maintenance, daily-note, and task-closing loop."
tags: ["operations", "provenance"]
status: "stable"
scope: "vault"
generated: {"by": "codex/gpt-5.6", "at": "2026-08-25T17:15:00+08:00"}
---

# Vault operations

Use this playbook for ordinary vault work. Large legacy migrations start with
[Source corpus curation](source-corpus-curation.md); large related source sets
then use [Bulk corpus ingestion](bulk-corpus-ingestion.md).

## 1. Open a bounded session

Read the files required by `AGENTS.md`, use the `Asia/Shanghai` date, and state
one concrete outcome in one task file. Search titles, aliases, tags, source
IDs, selection IDs, relations, and body text before creating anything. Prefer
updating an existing durable page when its scope already fits.

## 2. Capture evidence before interpretation

Create the `raw/<source-id>.md` snapshot before writing a Summary, Concept,
Entity, Comparison, or Query. Use `templates/raw-source.md.tmpl` and record the
canonical URI, retrieval or export time, source revision, capture method, body
SHA-256, omissions, and original attachment identity.

- Native Markdown or plain text keeps its wording and order verbatim.
- HTML, PDF, meeting, and document exports become conservative Markdown. Keep
  headings, paragraph order, lists, tables, code, speaker labels, timestamps,
  links, and visible image captions when present.
- Do not summarize, translate, repair grammar, normalize claims, or fill an
  inaudible or unreadable span. Mark the gap where it occurs and list it in
  `snapshot.omissions`.
- Preserve referenced images and available original non-Markdown bytes under
  flat `assets/`; record their hashes. Rewriting an attachment path for local
  resolution must not change its label or meaning.
- Treat a new upstream revision as a new snapshot. Never silently replace an
  immutable body.

## 3. Distill durable knowledge

Extract evidence-bound claims with exact source locations. Decide whether the
result belongs in an existing page, a new durable page, a Query, or the
workbench. Write the conclusion first, keep one page centered on one reusable
idea, separate observations from inference, and state uncertainty or conflict.
Every load-bearing claim must resolve through a stable source ID to the raw
snapshot or a canonical pinned source.

Add only useful graph edges. `sources` answer "what supports this?";
`relations` answer "how does this durable idea connect to another?"; body links
provide navigation. Do not manufacture reciprocal relations merely to create a
backlink.

## 4. Maintain references atomically

Before renaming, moving, merging, superseding, or deleting a page, search the
owning vault for its path, title, aliases, source ID, and selection ID. Classify
each hit as an incoming relation, outgoing relation, source resource, footnote,
daily-note reference, task/report link, or ordinary body link.

Apply the structural change and all repairs together:

1. Preserve or deliberately revise scope, evidence, status, and outgoing edges.
2. Rewrite every incoming `relations[].target`; reconsider its kind and caption
   rather than changing only the filename.
3. Repair body links, source resources, anchors, daily entries, and selection
   references without weakening provenance.
4. For a merge, move nonduplicate evidence and edges to the survivor. For
   supersession, retain the old page only when its history remains useful.
5. Never create cross-vault relations; use a vault card and pinned body link.
6. Rebuild indexes and reject the operation if an old target, unresolved edge,
   accidental duplicate, or unsupported orphan remains.

## 5. Create or refresh today's note

Create `wiki/daily/YYYY-MM-DD.md` only on the first active study or maintenance
session of that local day. If it exists, update only agent-owned marker blocks;
preserve Goals, human answer regions, Notes, completed outcomes, and stable
review occurrence IDs verbatim.

Build the learned cohort from linked `**Learned**` log entries for today. Add
fixed reviews due at +1, +3, +7, +14, +30, +60, and +90 days. Carry unfinished
occurrences forward, show at most ten ordered by oldest due date and then Query,
Concept, Comparison, Entity, and fallback statement, and never reschedule from
Again/Hard/Good/Easy. Routine daily-note creation gets no log event.

## 6. Close the operation

Rebuild navigation, perform the checks required by `AGENTS.md`, and refresh
affected Query annotations. Append one material event to `_log.md` only after
the vault is coherent; never rewrite an earlier event. Keep transient output in
`scratch/`, durable reports in `output/`, and one actionable outcome per task.
Commit or sync only with explicit user authority.
