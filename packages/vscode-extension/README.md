# LLM Wiki for VS Code

LLM Wiki for VS Code is a local-first Markdown, PDF, and code knowledge workbench for
VS Code and Cursor. It combines:

- an Obsidian-style live Markdown editor;
- a PDF reader with portable text-fragment links and Query annotations;
- backlinks, outlines, daily notes, and a filesystem-backed knowledge graph;
- explicit **Add to Chat** handoff for supported agent extensions; and
- a sanitized public-page browser for copying or attaching selected passages.

The extension keeps durable OKF Queries in ordinary Markdown, displays their
condensed answers on original source ranges, and reads legacy learning notes
without creating new ones. Agent handoff attaches immutable context to a draft;
the extension neither submits nor scrapes conversations.

The installed extension also carries `resources/llm-wiki-empty-vault.zip`.
Extract it into a new directory to start with a knowledge-empty vault containing
the complete AGENTS workflow, schema, templates, indexes, workbench folders,
and Git LFS configuration. The archive does not embed a Git repository or any
sample knowledge.

Source, documentation, development instructions, and issue tracking are in the
[LLM Wiki repository](https://github.com/t04dJ14n9/vscode-llm-wiki).

Licensed under the MIT License.
