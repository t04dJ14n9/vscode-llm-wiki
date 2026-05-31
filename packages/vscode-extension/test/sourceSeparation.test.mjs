import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const extensionRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(extensionRoot, '../..');
const packagesRoot = join(repoRoot, 'packages');
const markdownRoot = join(packagesRoot, 'vscode-markdown-extension');
const pdfRoot = join(packagesRoot, 'vscode-pdf-extension');

test('markdown and PDF extension source packages have independent roots', () => {
  assertPackageFile(markdownRoot, 'package.json');
  assertPackageFile(markdownRoot, 'src/extension.ts');
  assertPackageFile(markdownRoot, 'src/markdownEditorProvider.ts');
  assertPackageFile(markdownRoot, 'webview-src/markdown-editor.ts');
  assertPackageFile(markdownRoot, 'webpack.config.js');

  assertPackageFile(pdfRoot, 'package.json');
  assertPackageFile(pdfRoot, 'src/extension.ts');
  assertPackageFile(pdfRoot, 'src/pdfEditorProvider.ts');
  assertPackageFile(pdfRoot, 'webview-src/pdf-viewer.ts');
  assertPackageFile(pdfRoot, 'webpack.config.js');
});

test('separate source package manifests only expose their editor surface', () => {
  const markdownManifest = readJson(join(markdownRoot, 'package.json'));
  const pdfManifest = readJson(join(pdfRoot, 'package.json'));

  assert.equal(markdownManifest.name, 'human-learning-markdown');
  assert.equal(markdownManifest.private, undefined);
  assert.equal(markdownManifest.main, 'dist/extension.js');
  assert.deepEqual(customEditorViewTypes(markdownManifest), ['human-learning.markdownEditor']);
  assert.equal(editorAssociation(markdownManifest, '*.md'), 'human-learning.markdownEditor');
  assert.equal(editorAssociation(markdownManifest, '*.pdf'), undefined);

  assert.equal(pdfManifest.name, 'human-learning-pdf');
  assert.equal(pdfManifest.private, undefined);
  assert.equal(pdfManifest.main, 'dist/extension.js');
  assert.deepEqual(customEditorViewTypes(pdfManifest), ['human-learning.pdfViewer']);
  assert.equal(editorAssociation(pdfManifest, '*.pdf'), 'human-learning.pdfViewer');
  assert.equal(editorAssociation(pdfManifest, '*.md'), undefined);
});

test('separate source packages do not carry the other editor implementation', async () => {
  const markdownFiles = await sourceFiles(markdownRoot);
  const pdfFiles = await sourceFiles(pdfRoot);

  assertNoFile(markdownFiles, /(^|\/)(pdfEditorProvider\.ts|embedpdf\.d\.ts)$/);
  assertNoFile(markdownFiles, /(^|\/)pdf-viewer\.ts$/);
  assertNoSourceText(markdownRoot, markdownFiles, /@embedpdf\/|from ['"].*pdfEditorProvider|pdf-viewer/);

  assertNoFile(pdfFiles, /(^|\/)(markdownEditorProvider\.ts|markdownSymbols\.ts|markdownHeadingSyntax\.ts)$/);
  assertNoFile(pdfFiles, /(^|\/)(markdown-editor|markdownClipboard|markdownPaste|markdownSpans|markdownFences)\.ts$/);
  assertNoSourceText(pdfRoot, pdfFiles, /@codemirror\/|from ['"].*markdownEditorProvider|markdown-editor/);
});

test('source package dependencies are scoped to their shipped editor', () => {
  const markdownManifest = readJson(join(markdownRoot, 'package.json'));
  const pdfManifest = readJson(join(pdfRoot, 'package.json'));

  const markdownDependencies = Object.keys(markdownManifest.dependencies ?? {});
  const pdfDependencies = Object.keys(pdfManifest.dependencies ?? {});

  assert.equal(
    markdownDependencies.some(dependency => dependency.startsWith('@embedpdf/')),
    false,
    'markdown package should not depend on the PDF engine packages',
  );
  assert.equal(
    pdfDependencies.some(dependency => dependency.startsWith('@codemirror/')),
    false,
    'PDF package should not depend on the markdown editor packages',
  );
  assert.equal(pdfDependencies.includes('@mathjax/src'), false);
  assert.equal(pdfDependencies.includes('mermaid'), false);
  assert.equal(pdfDependencies.includes('turndown'), false);
});

function assertPackageFile(packageRoot, file) {
  assert.equal(
    existsSync(join(packageRoot, file)),
    true,
    `missing package file: ${relative(repoRoot, join(packageRoot, file))}`,
  );
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function customEditorViewTypes(manifest) {
  return (manifest.contributes?.customEditors ?? []).map(editor => editor.viewType);
}

function editorAssociation(manifest, pattern) {
  return manifest.contributes?.configurationDefaults?.['workbench.editorAssociations']?.[pattern];
}

async function sourceFiles(packageRoot) {
  const files = [];
  for (const dir of ['src', 'webview-src']) {
    const dirPath = join(packageRoot, dir);
    if (!existsSync(dirPath)) {
      continue;
    }
    await collectSourceFiles(packageRoot, dirPath, files);
  }
  return files.sort();
}

async function collectSourceFiles(packageRoot, dirPath, files) {
  for (const entry of await readdir(dirPath, { withFileTypes: true })) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(packageRoot, entryPath, files);
      continue;
    }
    if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(relative(packageRoot, entryPath));
    }
  }
}

function assertNoFile(files, pattern) {
  const matches = files.filter(file => pattern.test(file));
  assert.deepEqual(matches, []);
}

function assertNoSourceText(packageRoot, files, pattern) {
  const matches = [];
  for (const file of files) {
    const text = readFileSync(join(packageRoot, file), 'utf8');
    if (pattern.test(text)) {
      matches.push(file);
    }
  }
  assert.deepEqual(matches, []);
}
