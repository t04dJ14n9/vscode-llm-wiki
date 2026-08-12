import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';

const extensionRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(extensionRoot, '../..');
const sharedPdfRoot = join(repoRoot, 'packages', 'pdf-editor');
const sharedPdfWebviewEntry = join(sharedPdfRoot, 'src/webview/pdf-viewer.ts');
const require = createRequire(import.meta.url);

test('combined extension owns both editors and uses the shared PDF implementation', () => {
  for (const file of [
    'package.json',
    'src/webview/pdf-viewer.ts',
    'src/webview/pdfAskPanel.ts',
    'src/webview/pdfAskPanelStyles.ts',
    'src/webview/pdfAskPanelView.ts',
    'src/webview/pdfTextBands.ts',
    'src/webview/pdfTextLayer.ts',
    'src/webview/pdfLayout.ts',
    'src/webview/domain/pdfAskState.ts',
    'src/webview/domain/pdfNavigation.ts',
    'src/webview/domain/pdfOutline.ts',
    'src/webview/domain/pdfSearch.ts',
    'src/webview/domain/pdfSelection.ts',
    'src/webview/domain/pdfTextExtraction.ts',
  ]) {
    assertPackageFile(sharedPdfRoot, file);
  }

  for (const file of [
    'package.json',
    'src/extension.ts',
    'src/anchorFileCodec.ts',
    'src/anchorFileEditorProvider.ts',
    'src/markdownEditorProvider.ts',
    'src/pdfEditorProvider.ts',
    'webview-src/markdown-editor.ts',
    'webpack.config.js',
  ]) {
    assertPackageFile(extensionRoot, file);
  }

  const manifest = readJson(join(extensionRoot, 'package.json'));
  assert.equal(manifest.name, 'llm-wiki-vscode');
  assert.deepEqual(
    customEditorViewTypes(manifest).sort(),
    [
      'llm-wiki.anchorFile',
      'llm-wiki.markdownEditor',
      'llm-wiki.pdfViewer',
    ],
  );
  assert.equal(
    manifest.dependencies?.['@llm-wiki/pdf-editor'],
    'workspace:*',
  );
});

test('combined build resolves the canonical shared PDF webview entry', () => {
  const webpackPath = join(extensionRoot, 'webpack.config.js');
  const webpackSource = readFileSync(webpackPath, 'utf8');
  assert.match(webpackSource, /@llm-wiki\/pdf-editor\/webview/);

  delete require.cache[require.resolve(webpackPath)];
  const webpackConfigs = require(webpackPath);
  const pdfViewerConfig = webpackConfigs.find(config => config.name === 'pdf-viewer');
  assert.ok(pdfViewerConfig, 'combined extension must define a pdf-viewer build');
  assert.equal(
    resolveWebpackEntry(extensionRoot, pdfViewerConfig.entry),
    sharedPdfWebviewEntry,
  );
});

test('combined delivery does not duplicate shared PDF implementation modules', async () => {
  const combinedFiles = await sourceFiles(extensionRoot);
  const sharedImplementationFiles = /(^|\/)(pdfAskPanel|pdfAskPanelStyles|pdfAskPanelView|pdfTextBands|pdfTextLayer|pdfLayout|pdfAskState|pdfNavigation|pdfOutline|pdfSearch|pdfSelection|pdfTextExtraction)\.ts$/;

  assertNoFile(combinedFiles, sharedImplementationFiles);
  assert.equal(
    existsSync(join(extensionRoot, 'webview-src/pdf-viewer.ts')),
    false,
    'combined extension should build the shared entry directly without a forwarding wrapper',
  );
});

test('PDF engine and Markdown rendering dependencies belong to their source packages', () => {
  const combinedManifest = readJson(join(extensionRoot, 'package.json'));
  const sharedPdfManifest = readJson(join(sharedPdfRoot, 'package.json'));
  const combinedDependencies = Object.keys(combinedManifest.dependencies ?? {});
  const sharedPdfDependencies = Object.keys(sharedPdfManifest.dependencies ?? {});

  assert.equal(
    combinedDependencies.some(dependency => dependency.startsWith('@embedpdf/')),
    false,
    'combined package should consume PDF engine dependencies through pdf-editor',
  );
  assert.equal(combinedDependencies.includes('marked'), false);
  assert.equal(
    sharedPdfDependencies.some(dependency => dependency.startsWith('@embedpdf/')),
    true,
  );
  assert.equal(sharedPdfDependencies.includes('dompurify'), true);
  assert.equal(sharedPdfDependencies.includes('marked'), true);
});

test('Ask PDF keeps the vetted Marked major on the repository Node 20 floor', () => {
  const rootManifest = readJson(join(repoRoot, 'package.json'));
  const sharedPdfManifest = readJson(join(sharedPdfRoot, 'package.json'));
  const version = sharedPdfManifest.dependencies?.marked;
  const major = Number.parseInt(String(version).match(/\d+/)?.[0] ?? '', 10);

  assert.equal(rootManifest.engines.node, '>=20.19.0');
  assert.ok(
    Number.isFinite(major) && major <= 13,
    'pdf-editor must keep the vetted Marked major until its upgrade is reviewed',
  );
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

async function sourceFiles(root) {
  const files = [];
  for (const directory of ['src', 'webview-src']) {
    const directoryRoot = join(root, directory);
    if (!existsSync(directoryRoot)) continue;
    await collect(directoryRoot, directory, files);
  }
  return files;
}

async function collect(absoluteRoot, relativeRoot, files) {
  for (const entry of await readdir(absoluteRoot, { withFileTypes: true })) {
    const absolutePath = join(absoluteRoot, entry.name);
    const relativePath = join(relativeRoot, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      await collect(absolutePath, relativePath, files);
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
}

function assertNoFile(files, pattern) {
  const match = files.find(file => pattern.test(file));
  assert.equal(match, undefined, `unexpected duplicate implementation file: ${match}`);
}
