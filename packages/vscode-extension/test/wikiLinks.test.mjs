import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadTsModule(relativePath) {
  const filename = join(packageRoot, relativePath);
  const source = readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(dirname(filename));
  mod._compile(outputText, filename);
  return mod.exports;
}

test('wikilink resolver preserves native note paths with spaces', () => {
  const { notePathToUri, wikiLinkTargetToUri } = loadTsModule('src/wikiLinks.ts');

  assert.equal(
    wikiLinkTargetToUri('Online Softmax'),
    'notes/Concepts/Online Softmax.md',
  );
  assert.equal(
    wikiLinkTargetToUri('FlashAttention#Algorithm|paper section'),
    'notes/Concepts/FlashAttention.md#Algorithm',
  );
  assert.equal(
    notePathToUri('notes/Concepts/Online Softmax.md'),
    'notes/Concepts/Online Softmax.md',
  );
});

test('wikilink resolver preserves Obsidian folder-qualified note paths', () => {
  const { wikiLinkTargetToUri } = loadTsModule('src/wikiLinks.ts');

  assert.equal(
    wikiLinkTargetToUri('Daily Notes/2026-05-25|today'),
    'notes/Daily Notes/2026-05-25.md',
  );
  assert.equal(
    wikiLinkTargetToUri('notes/Projects/Roadmap.md#Milestones'),
    'notes/Projects/Roadmap.md#Milestones',
  );
});

test('wikilink resolver matches Obsidian basename lookup across vault folders', () => {
  const { parseWikiLinkTarget, wikiLinkTargetToUri } = loadTsModule('src/wikiLinks.ts');
  const notePaths = [
    'notes/Concepts/Online Softmax.md',
    'notes/Papers/FlashAttention Paper.md',
  ];

  assert.equal(
    wikiLinkTargetToUri('FlashAttention Paper', 'notes/Daily Notes/2026-05-25.md', notePaths),
    'notes/Papers/FlashAttention Paper.md',
  );
  assert.equal(
    parseWikiLinkTarget('FlashAttention Paper#Algorithm', 'notes/Daily Notes/2026-05-25.md', notePaths)?.label,
    'FlashAttention Paper > Algorithm',
  );
});

test('wikilink labels match Obsidian basename rendering for folder-qualified notes', () => {
  const { parseWikiLinkTarget } = loadTsModule('src/wikiLinks.ts');

  assert.equal(
    parseWikiLinkTarget('Concepts/FlashAttention')?.label,
    'FlashAttention',
  );
  assert.equal(
    parseWikiLinkTarget('notes/Projects/Roadmap.md#Milestones')?.label,
    'Roadmap > Milestones',
  );
  assert.equal(
    parseWikiLinkTarget('Daily Notes/2026-05-25|today')?.label,
    'today',
  );
});

test('wikilink resolver supports same-note heading links like Obsidian', () => {
  const { wikiLinkTargetToUri } = loadTsModule('src/wikiLinks.ts');

  assert.equal(
    wikiLinkTargetToUri('#Why This Matters|this section', 'notes/Concepts/Online Softmax.md'),
    'notes/Concepts/Online Softmax.md#Why This Matters',
  );
  assert.equal(
    wikiLinkTargetToUri('#Why This Matters'),
    null,
  );
});
