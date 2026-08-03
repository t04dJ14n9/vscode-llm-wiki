import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';

const extensionRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(extensionRoot, '../..');
const packagesRoot = join(repoRoot, 'packages');
const markdownRoot = join(packagesRoot, 'vscode-markdown-extension');
const pdfRoot = join(packagesRoot, 'vscode-pdf-extension');
const sharedPdfRoot = join(packagesRoot, 'pdf-editor');
const sharedPdfWebviewEntry = join(sharedPdfRoot, 'src/webview/pdf-viewer.ts');
const require = createRequire(import.meta.url);

test('shared PDF implementation and independent extension delivery surfaces exist', () => {
  assertPackageFile(sharedPdfRoot, 'package.json');
  assertPackageFile(sharedPdfRoot, 'src/webview/pdf-viewer.ts');
  assertPackageFile(sharedPdfRoot, 'src/webview/pdfAskPanel.ts');
  assertPackageFile(sharedPdfRoot, 'src/webview/pdfAskPanelStyles.ts');
  assertPackageFile(sharedPdfRoot, 'src/webview/pdfAskPanelView.ts');
  assertPackageFile(sharedPdfRoot, 'src/webview/pdfTextBands.ts');
  assertPackageFile(sharedPdfRoot, 'src/webview/pdfTextLayer.ts');
  assertPackageFile(sharedPdfRoot, 'src/webview/pdfLayout.ts');
  assertPackageFile(sharedPdfRoot, 'src/webview/domain/pdfAskState.ts');
  assertPackageFile(sharedPdfRoot, 'src/webview/domain/pdfNavigation.ts');
  assertPackageFile(sharedPdfRoot, 'src/webview/domain/pdfOutline.ts');
  assertPackageFile(sharedPdfRoot, 'src/webview/domain/pdfSearch.ts');
  assertPackageFile(sharedPdfRoot, 'src/webview/domain/pdfSelection.ts');
  assertPackageFile(sharedPdfRoot, 'src/webview/domain/pdfTextExtraction.ts');

  assertPackageFile(extensionRoot, 'package.json');
  assertPackageFile(extensionRoot, 'src/extension.ts');
  assertPackageFile(extensionRoot, 'src/pdfEditorProvider.ts');
  assertPackageFile(extensionRoot, 'webview-src/pdf-viewer.ts');
  assertPackageFile(extensionRoot, 'webpack.config.js');

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

test('combined and standalone builds resolve the canonical shared PDF webview entry', () => {
  for (const packageRoot of [extensionRoot, pdfRoot]) {
    const manifest = readJson(join(packageRoot, 'package.json'));
    assert.equal(
      manifest.dependencies?.['@human-learning/pdf-editor'],
      'workspace:*',
      `${manifest.name} must depend on the shared PDF editor package`,
    );

    const webpackPath = join(packageRoot, 'webpack.config.js');
    const webpackSource = readFileSync(webpackPath, 'utf8');
    assert.match(
      webpackSource,
      /@human-learning\/pdf-editor\/webview/,
      `${relative(repoRoot, webpackPath)} must resolve the shared webview package entry`,
    );

    delete require.cache[require.resolve(webpackPath)];
    const webpackConfigs = require(webpackPath);
    const pdfViewerConfig = webpackConfigs.find(config => config.name === 'pdf-viewer');
    assert.ok(pdfViewerConfig, `${manifest.name} must define a pdf-viewer build`);
    assert.equal(
      resolveWebpackEntry(packageRoot, pdfViewerConfig.entry),
      sharedPdfWebviewEntry,
      `${manifest.name} must build the canonical shared PDF webview source`,
    );
  }
});

test('combined and standalone manifests retain their intended editor surfaces', () => {
  const combinedManifest = readJson(join(extensionRoot, 'package.json'));
  const markdownManifest = readJson(join(markdownRoot, 'package.json'));
  const pdfManifest = readJson(join(pdfRoot, 'package.json'));

  assert.equal(combinedManifest.name, 'human-learning-vscode');
  assert.deepEqual(
    customEditorViewTypes(combinedManifest).sort(),
    ['human-learning.markdownEditor', 'human-learning.pdfViewer'],
  );

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

test('delivery packages do not duplicate the shared PDF webview implementation', async () => {
  const combinedFiles = await sourceFiles(extensionRoot);
  const markdownFiles = await sourceFiles(markdownRoot);
  const pdfFiles = await sourceFiles(pdfRoot);

  assertNoFile(markdownFiles, /(^|\/)(pdfEditorProvider\.ts|embedpdf\.d\.ts)$/);
  assertNoFile(markdownFiles, /(^|\/)pdf-viewer\.ts$/);
  assertNoSourceText(markdownRoot, markdownFiles, /@embedpdf\/|from ['"].*pdfEditorProvider|pdf-viewer/);

  assertNoFile(pdfFiles, /(^|\/)(markdownEditorProvider\.ts|markdownSymbols\.ts|markdownHeadingSyntax\.ts)$/);
  assertNoFile(pdfFiles, /(^|\/)(markdown-editor|markdownClipboard|markdownPaste|markdownSpans|markdownFences)\.ts$/);
  assertNoSourceText(pdfRoot, pdfFiles, /@codemirror\/|from ['"].*markdownEditorProvider|markdown-editor/);

  const sharedImplementationFiles = /(^|\/)(pdfAskPanel|pdfAskPanelStyles|pdfAskPanelView|pdfTextBands|pdfTextLayer|pdfLayout|pdfAskState|pdfNavigation|pdfOutline|pdfSearch|pdfSelection|pdfTextExtraction)\.ts$/;
  assertNoFile(combinedFiles, sharedImplementationFiles);
  assertNoFile(pdfFiles, sharedImplementationFiles);

  for (const packageRoot of [extensionRoot, pdfRoot]) {
    const wrapper = readFileSync(join(packageRoot, 'webview-src/pdf-viewer.ts'), 'utf8');
    const substantiveLines = wrapper
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    assert.ok(
      substantiveLines.length <= 5,
      `${relative(repoRoot, packageRoot)} must not retain a full PDF viewer implementation`,
    );
    assert.match(wrapper, /@human-learning\/pdf-editor\/webview/);
  }
});

test('source package dependencies are scoped to their owned implementation', () => {
  const markdownManifest = readJson(join(markdownRoot, 'package.json'));
  const pdfManifest = readJson(join(pdfRoot, 'package.json'));
  const sharedPdfManifest = readJson(join(sharedPdfRoot, 'package.json'));

  const markdownDependencies = Object.keys(markdownManifest.dependencies ?? {});
  const pdfDependencies = Object.keys(pdfManifest.dependencies ?? {});
  const sharedPdfDependencies = Object.keys(sharedPdfManifest.dependencies ?? {});

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
  assert.equal(
    sharedPdfDependencies.some(dependency => dependency.startsWith('@embedpdf/')),
    true,
    'shared PDF package must own its PDF engine dependencies',
  );
  assert.equal(sharedPdfDependencies.includes('dompurify'), true);
  assert.equal(sharedPdfDependencies.includes('marked'), true);
});

test('Ask PDF keeps the vetted Marked major on the repository Node 20 floor', () => {
  const rootManifest = readJson(join(repoRoot, 'package.json'));
  assert.equal(rootManifest.engines.node, '>=20.19.0');
  for (const root of [extensionRoot, pdfRoot, sharedPdfRoot]) {
    const manifest = readJson(join(root, 'package.json'));
    const version = manifest.dependencies?.marked;
    if (version === undefined) {
      continue;
    }
    const major = Number.parseInt(String(version).match(/\d+/)?.[0] ?? '', 10);
    assert.ok(
      Number.isFinite(major) && major <= 13,
      `${manifest.name} must keep the vetted Marked major until its upgrade is reviewed`,
    );
  }
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

function resolveWebpackEntry(packageRoot, entry) {
  assert.equal(typeof entry, 'string', 'pdf-viewer webpack entry must be a single file');
  return resolve(packageRoot, entry);
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
