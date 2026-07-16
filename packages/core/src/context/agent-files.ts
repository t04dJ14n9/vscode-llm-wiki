import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

/** Generate AGENTS.md, CLAUDE.md, .codex/config.toml, and .claude/commands/ */
export function generateAgentInstructions(vaultRoot: string): string[] {
  const created: string[] = [];

  const rules = `# Human Learning Vault Instructions

## Rules for Agents

- Do not edit \`raw/\` unless explicitly asked.
- Prefer updating existing notes over creating duplicates.
- Use native Markdown/Obsidian links in notes: wikilinks for notes, relative markdown links for code/PDF, and normal URLs for web references.
- Read \`.hl/agent/selection.md\` when the user refers to "the current selection."
- Cite exact PDF text with \`raw/pdf/file.pdf#page=N:~:text=selected%20text\`; use \`raw/pdf/file.pdf#page=N\` when exact text is unavailable.
- Never put internal anchor or chunk row IDs in a PDF URL.
- Use \`hl anchor create-pdf --quote\` only to create a persisted annotation; its database ID remains internal and its URI remains portable.
- If \`hl anchor create-pdf\` returns ambiguous or not_found, do not fabricate a citation.
- After note edits, run \`hl links check --fix\`.
- If embeddings are enabled, run \`hl embeddings refresh --changed\`.
- When \`qmd\` is available, prefer it for local hybrid retrieval and reranking, with a Qwen embedding GGUF model for bilingual notes when configured.

## Commands

- \`hl search "<query>"\` — Search vault
- \`hl links check --fix\` — Check and repair links
- \`hl ingest <path>\` — Ingest sources
- \`hl context export --anchor <uri>\` — Export anchor context
- \`hl today\` — Generate daily study summary
`;

  writeFileSync(join(vaultRoot, 'AGENTS.md'), rules);
  writeFileSync(join(vaultRoot, 'CLAUDE.md'), rules);
  created.push('AGENTS.md', 'CLAUDE.md');

  // Claude commands
  const cmdsDir = join(vaultRoot, '.claude', 'commands');
  if (!existsSync(cmdsDir)) mkdirSync(cmdsDir, { recursive: true });
  const commands: Record<string, string> = {
    'hl-explain-selection': 'Read .hl/agent/selection.md and explain the selected content with source citations.',
    'hl-ingest': 'Run `hl ingest` on the current file and report what was indexed.',
    'hl-repair-links': 'Run `hl links check --fix` and report any remaining broken links.',
    'hl-today': 'Run `hl today` to generate a daily study summary.',
  };
  for (const [name, content] of Object.entries(commands)) {
    writeFileSync(join(cmdsDir, `${name}.md`), content);
    created.push(`.claude/commands/${name}.md`);
  }

  // Codex skill
  const codexSkillDir = join(vaultRoot, '.agents', 'skills', 'human-learning');
  if (!existsSync(codexSkillDir)) mkdirSync(codexSkillDir, { recursive: true });
  writeFileSync(join(codexSkillDir, 'SKILL.md'), `# Human Learning Skill for Codex

## Description
Source-grounded reading, annotation, and knowledge-graph management inside a Human Learning vault.

## When to use
- User references a PDF paper, web snapshot, code file, or markdown note in the vault
- User asks to create, update, or cite source material
- User asks to search the vault or check/repair links

## Rules
- Do not edit \`raw/\` unless explicitly asked.
- Prefer updating existing notes over creating duplicates.
- Use native Markdown/Obsidian links in notes: \`[[Note#Heading]]\`, \`[code](raw/code/file.ts#L1-L5)\`, \`[quote](raw/pdf/file.pdf#page=N:~:text=selected%20text)\`, \`[page](raw/pdf/file.pdf#page=N)\`, and normal web URLs.
- Read \`.hl/agent/selection.md\` when the user refers to "the current selection."
- Never put internal anchor or chunk row IDs in a PDF URL.
- Cite the portable PDF URI returned by search. Use a text-fragment URI when exact text is available and a page-only URI otherwise.
- Use \`hl anchor create-pdf --quote\` only for a persisted annotation; its database ID remains internal.
- If \`hl anchor create-pdf\` returns ambiguous or not_found, do not fabricate a citation.
- After note edits, run \`hl links check --fix\`.

## Retrieval
- Prefer \`qmd\` for local hybrid retrieval/reranking when it is installed in the Human Learning skill environment.
- Do not build custom qmd wheels; use the local \`tobi/qmd\` setup directly.
- Prefer a Qwen embedding GGUF model for bilingual English/Chinese notes when qmd is configured for local embeddings.
- Human Learning owns citation link generation and locator metadata for portable PDF references, persisted PDF annotations, and web targets.

## Available CLI commands
- \`hl search "<query>"\` — Search vault
- \`hl links check --fix\` — Check and repair broken links
- \`hl links backlinks <uri>\` — Show backlinks
- \`hl links forward <path>\` — Show forward links
- \`hl anchor create-pdf <path> --quote "..."\` — Create PDF anchor
- \`hl anchor resolve <id-or-uri>\` — Resolve anchor
- \`hl context export --source <path>\` — Export source context
- \`hl context export --anchor <id>\` — Export anchor context
- \`hl ingest <path> --recursive\` — Ingest sources
- \`hl status\` — Show vault status
- \`hl doctor\` — Validate vault
`);
  created.push('.agents/skills/human-learning/SKILL.md');

  // .codex/config.toml
  const codexConfigDir = join(vaultRoot, '.codex');
  if (!existsSync(codexConfigDir)) mkdirSync(codexConfigDir, { recursive: true });
  writeFileSync(join(codexConfigDir, 'config.toml'), `# Human Learning Codex configuration
[skills]
enabled = ["human-learning"]

[tools]
allow_hl_cli = true
`);
  created.push('.codex/config.toml');

  return created;
}
