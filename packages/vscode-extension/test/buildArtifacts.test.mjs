import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const extensionRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(extensionRoot, '../..');
const markdownExtensionRoot = join(repoRoot, 'packages', 'vscode-markdown-extension');
const pdfExtensionRoot = join(repoRoot, 'packages', 'vscode-pdf-extension');
const dist = join(extensionRoot, 'dist');
const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
const require = createRequire(import.meta.url);

test('build emits all VS Code extension and webview runtime artifacts', () => {
  for (const file of ['extension.js', 'markdown-editor.js', 'pdf-viewer.js', 'pdfium.wasm', 'sql-wasm.wasm']) {
    assert.equal(
      existsSync(join(dist, file)),
      true,
      `missing dist artifact: ${file}`,
    );
  }
});

test('separate markdown and PDF extension manifests can be shipped independently', () => {
  const markdownManifest = JSON.parse(readFileSync(join(markdownExtensionRoot, 'package.json'), 'utf8'));
  const pdfManifest = JSON.parse(readFileSync(join(pdfExtensionRoot, 'package.json'), 'utf8'));

  assert.equal(markdownManifest.name, 'human-learning-markdown');
  assert.equal(markdownManifest.private, undefined);
  assert.equal(markdownManifest.main, 'dist/extension.js');
  assert.deepEqual(
    markdownManifest.contributes.customEditors.map(editor => editor.viewType),
    ['human-learning.markdownEditor'],
  );
  assert.equal(
    markdownManifest.contributes.configurationDefaults['workbench.editorAssociations']['*.md'],
    'human-learning.markdownEditor',
  );
  assert.equal(markdownManifest.contributes.configurationDefaults['workbench.editorAssociations']['*.pdf'], undefined);

  assert.equal(pdfManifest.name, 'human-learning-pdf');
  assert.equal(pdfManifest.private, undefined);
  assert.equal(pdfManifest.main, 'dist/extension.js');
  assert.deepEqual(
    pdfManifest.contributes.customEditors.map(editor => editor.viewType),
    ['human-learning.pdfViewer'],
  );
  assert.equal(
    pdfManifest.contributes.configurationDefaults['workbench.editorAssociations']['*.pdf'],
    'human-learning.pdfViewer',
  );
  assert.equal(pdfManifest.contributes.configurationDefaults['workbench.editorAssociations']['*.md'], undefined);
});

test('split package preparation materializes isolated markdown and PDF package roots', async () => {
  await rm(join(extensionRoot, 'dist-split'), { recursive: true, force: true });
  execFileSync(process.execPath, ['scripts/prepare-split-packages.mjs'], {
    cwd: extensionRoot,
    stdio: 'pipe',
  });

  const markdownDist = await readdir(join(extensionRoot, 'dist-split', 'markdown', 'dist'));
  const pdfDist = await readdir(join(extensionRoot, 'dist-split', 'pdf', 'dist'));
  const markdownManifest = JSON.parse(readFileSync(join(extensionRoot, 'dist-split', 'markdown', 'package.json'), 'utf8'));
  const pdfManifest = JSON.parse(readFileSync(join(extensionRoot, 'dist-split', 'pdf', 'package.json'), 'utf8'));

  assert.equal(markdownManifest.main, 'dist/extension.js');
  assert.ok(markdownDist.includes('extension.js'));
  assert.ok(markdownDist.includes('markdown-editor.js'));
  assert.equal(markdownDist.includes('pdf-extension.js'), false);
  assert.equal(markdownDist.includes('pdf-viewer.js'), false);
  assert.equal(markdownDist.includes('pdfium.wasm'), false);

  assert.equal(pdfManifest.main, 'dist/extension.js');
  assert.ok(pdfDist.includes('extension.js'));
  assert.ok(pdfDist.includes('pdf-viewer.js'));
  assert.ok(pdfDist.includes('pdfium.wasm'));
  assert.equal(pdfDist.includes('markdown-extension.js'), false);
  assert.equal(pdfDist.includes('markdown-editor.js'), false);
});

test('extension host keeps sql.js external for VS Code runtime loading', () => {
  const bundle = readFileSync(join(dist, 'extension.js'), 'utf8');
  assert.match(bundle, /require\(["']sql\.js["']\)/);
  assert.equal(
    bundle.includes('initSqlJsPromise'),
    false,
    'extension host bundle should not inline the sql.js UMD/Emscripten loader',
  );
});

test('webview bundles do not depend on webpack automatic publicPath detection', () => {
  for (const file of ['markdown-editor.js', 'pdf-viewer.js']) {
    const bundle = readFileSync(join(dist, file), 'utf8');
    assert.equal(
      bundle.includes('Automatic publicPath is not supported in this browser'),
      false,
      `${file} still uses webpack automatic publicPath detection`,
    );
  }
});

test('webview webpack entries use VS Code webview size budgets', () => {
  const configs = require('../webpack.config.js');
  const byName = new Map(configs.map(config => [config.name, config]));

  for (const name of ['pdf-viewer', 'markdown-editor']) {
    const performance = byName.get(name)?.performance;
    assert.ok(performance, `${name} should define an explicit performance budget`);
    assert.equal(performance.maxAssetSize, 7 * 1024 * 1024);
    assert.equal(performance.maxEntrypointSize, 7 * 1024 * 1024);
  }
});

test('manifest opens markdown notes in the Human Learning custom editor by default', () => {
  const markdownEditor = manifest.contributes.customEditors.find(
    editor => editor.viewType === 'human-learning.markdownEditor',
  );
  assert.ok(markdownEditor, 'missing markdown custom editor contribution');
  assert.equal(
    markdownEditor.priority,
    'default',
    'markdown custom editor should be the default editor for Obsidian-like note editing',
  );
  assert.equal(
    manifest.contributes.configurationDefaults['workbench.editorAssociations']['*.md'],
    'human-learning.markdownEditor',
    'workspace defaults should route markdown files into the custom editor',
  );
});

test('manifest contributes a command palette toggle for markdown Vim mode', () => {
  const toggleVimCommand = manifest.contributes.commands.find(
    command => command.command === 'human-learning.toggleVimMode',
  );
  assert.ok(toggleVimCommand, 'missing markdown Vim mode toggle command');
  assert.equal(toggleVimCommand.title, 'Human Learning: Toggle Vim Mode');
});

test('manifest contributes a Human Learning outline view for custom markdown editor navigation', () => {
  const humanLearningViews = manifest.contributes.views['human-learning'] ?? [];
  const outlineView = humanLearningViews.find(view => view.id === 'hl-outline');

  assert.ok(outlineView, 'missing Human Learning outline view contribution');
  assert.equal(outlineView.name, 'Outline');
  assert.equal(outlineView.type, 'tree');
});
