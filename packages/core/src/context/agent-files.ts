import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

const LEGACY_GENERATED_CLAUDE_COMMANDS: Record<string, string> = {
  'hl-ingest': 'Run `hl ingest` on the current file and report what was indexed.',
  'hl-repair-links': 'Run `hl links check --fix` and report any remaining broken links.',
  'hl-today': 'Run `hl today` to generate a daily study summary.',
};

/** Generate AGENTS.md, CLAUDE.md, .codex/config.toml, and .claude/commands/ */
export function generateAgentInstructions(vaultRoot: string): string[] {
  const created: string[] = [];

  const rules = `# Human Learning Vault Instructions

Human Learning is an editor-first VS Code and Cursor workspace for reading,
annotating, and connecting Markdown notes and PDFs.

## Vault Surfaces

- Open notes in the Human Learning Markdown editor and sources in the Human Learning PDF viewer.
- Use Markdown Outline and PDF Outline in the main Explorer sidebar.
- Select a passage and use **Add to Chat** (or Cmd/Ctrl+L) to attach it to the active supported agent draft. Human Learning never submits the message.

## Rules for Agents

- Do not edit \`raw/\` unless explicitly asked.
- Prefer updating existing notes over creating duplicates.
- Use native Markdown/Obsidian links in notes: wikilinks for notes, relative markdown links for code/PDF, and normal URLs for web references.
- Read \`.hl/agent/selection.md\` when the user refers to "the current selection."
- When present, \`.hl/agent/selection.png\` is visual evidence for the current PDF selection.
- Cite exact PDF text with \`raw/pdf/file.pdf#page=N:~:text=selected%20text\`; use \`raw/pdf/file.pdf#page=N\` when exact text is unavailable.
- Never put internal anchor or chunk row IDs in a PDF URL.
- Do not invent PDF text, page numbers, rectangle coordinates, or anchor IDs.
`;

  writeFileSync(join(vaultRoot, 'AGENTS.md'), rules);
  writeFileSync(join(vaultRoot, 'CLAUDE.md'), rules);
  created.push('AGENTS.md', 'CLAUDE.md');

  // Claude commands
  const cmdsDir = join(vaultRoot, '.claude', 'commands');
  if (!existsSync(cmdsDir)) mkdirSync(cmdsDir, { recursive: true });
  const commands: Record<string, string> = {
    'hl-explain-selection': 'Read `.hl/agent/selection.md` and, when present, `.hl/agent/selection.png`. Explain the selected content with source citations.',
  };
  for (const [legacyName, generatedContent] of Object.entries(LEGACY_GENERATED_CLAUDE_COMMANDS)) {
    const legacyPath = join(cmdsDir, `${legacyName}.md`);
    if (existsSync(legacyPath) && readFileSync(legacyPath, 'utf8') === generatedContent) {
      unlinkSync(legacyPath);
    }
  }
  for (const [name, content] of Object.entries(commands)) {
    writeFileSync(join(cmdsDir, `${name}.md`), content);
    created.push(`.claude/commands/${name}.md`);
  }

  // Codex skill
  const codexSkillDir = join(vaultRoot, '.agents', 'skills', 'human-learning');
  if (!existsSync(codexSkillDir)) mkdirSync(codexSkillDir, { recursive: true });
  writeFileSync(join(codexSkillDir, 'SKILL.md'), `# Human Learning Skill for Codex

## Description
Editor-first, source-grounded reading and note-making inside a Human Learning vault.

## When to use
- User references a PDF paper, web snapshot, code file, or markdown note in the vault
- User asks to create, update, or cite source material
- User refers to the current Markdown or PDF selection

## Rules
- Do not edit \`raw/\` unless explicitly asked.
- Prefer updating existing notes over creating duplicates.
- Use native Markdown/Obsidian links in notes: \`[[Note#Heading]]\`, \`[code](raw/code/file.ts#L1-L5)\`, \`[quote](raw/pdf/file.pdf#page=N:~:text=selected%20text)\`, \`[page](raw/pdf/file.pdf#page=N)\`, and normal web URLs.
- Read \`.hl/agent/selection.md\` when the user refers to "the current selection."
- When present, use \`.hl/agent/selection.png\` as visual evidence for a PDF selection.
- Never put internal anchor or chunk row IDs in a PDF URL.
- Use a text-fragment PDF URI when exact text is available and a page-only URI otherwise.
- Do not invent PDF text, page numbers, rectangle coordinates, or anchor IDs.
- **Add to Chat** attaches the selection to the active supported agent draft and never submits it.
`);
  created.push('.agents/skills/human-learning/SKILL.md');

  // .codex/config.toml
  const codexConfigDir = join(vaultRoot, '.codex');
  if (!existsSync(codexConfigDir)) mkdirSync(codexConfigDir, { recursive: true });
  writeFileSync(join(codexConfigDir, 'config.toml'), `# Human Learning Codex configuration
[skills]
enabled = ["human-learning"]
`);
  created.push('.codex/config.toml');

  return created;
}
