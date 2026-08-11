import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const extensionRoot = resolve(import.meta.dirname, '..');
const dist = join(extensionRoot, 'dist');
const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
const require = createRequire(import.meta.url);

test('Markdown source retains stable typography and selection contracts', () => {
  for (const relativePath of [
    'webview-src/extensions/hybridCodeBlocks.ts',
    'webview-src/extensions/hybridRendering.ts',
    'webview-src/extensions/hybridStyles.ts',
  ]) {
    const source = readFileSync(join(extensionRoot, relativePath), 'utf8');
    if (relativePath.endsWith('hybridCodeBlocks.ts')) {
      assert.match(source, /formatActiveCodeBlockFence/);
      assert.match(source, /blockIsActive/);
    }
  }

  const source = readFileSync(
    join(extensionRoot, 'webview-src/markdown-editor.ts'),
    'utf8',
  );
  assert.match(source, /--vscode-editor-inactiveSelectionBackground/);
  assert.match(source, /--vscode-editor-selectionBackground/);
  assert.match(
    source,
    /\.cm-lineNumbers': \{[\s\S]{0,700}--vscode-editorLineNumber-foreground[\s\S]{0,700}--vscode-editor-font-family[\s\S]{0,700}--vscode-editor-font-size[\s\S]{0,700}fontVariantNumeric: 'tabular-nums'/,
  );
  assert.match(
    source,
    /\.cm-lineNumbers \.cm-gutterElement': \{[\s\S]{0,500}cursor: 'default'/,
  );
  assert.match(source, /\.cm-active-inline-code': \{[\s\S]{0,500}fontFamily: 'var\(--hl-editor-font-family/);
  assert.match(source, /\.cm-active-footnote-def-label': \{[\s\S]{0,300}fontSize: '0\.85em'/);
});

test('build emits all VS Code extension and webview runtime artifacts', () => {
  for (const file of [
    'extension.js',
    'markdown-editor.js',
    'pdf-viewer.js',
    'experimental-owned-browser.js',
    'pdfium.wasm',
  ]) {
    assert.equal(
      existsSync(join(dist, file)),
      true,
      `missing dist artifact: ${file}`,
    );
  }
  assert.equal(existsSync(join(dist, 'sql-wasm.wasm')), false);
  assert.equal(existsSync(join(dist, 'src')), false);
  assert.equal(existsSync(join(dist, 'webview-src')), false);
  assert.equal(existsSync(join(dist, 'tsconfig.tsbuildinfo')), false);
});

test('combined extension host and package omit the legacy SQLite runtime', () => {
  const bundle = readFileSync(join(dist, 'extension.js'), 'utf8');
  assert.doesNotMatch(bundle, /require\(["']sql\.js["']\)/);
  assert.equal(bundle.includes('initSqlJsPromise'), false);
  assert.equal(manifest.dependencies['sql.js'], undefined);
});

test('VSIX packaging excludes development sources, tests, declarations, and source maps', () => {
  const ignore = readFileSync(join(extensionRoot, '.vscodeignore'), 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (const pattern of [
    'node_modules/**',
    'src/**',
    'test/**',
    'webview-src/**',
    'dist/src/**',
    'dist/webview-src/**',
    'dist/tsconfig.tsbuildinfo',
    'dist/**/*.d.ts',
    'dist/**/*.map',
  ]) {
    assert.ok(ignore.includes(pattern), `missing VSIX exclusion: ${pattern}`);
  }
});

test('VSIX metadata includes package-local documentation, license, and repository provenance', () => {
  assert.equal(existsSync(join(extensionRoot, 'README.md')), true);
  assert.equal(existsSync(join(extensionRoot, 'LICENSE')), true);
  assert.match(
    readFileSync(join(extensionRoot, 'README.md'), 'utf8'),
    /Human Learning repository/,
  );
  assert.match(readFileSync(join(extensionRoot, 'LICENSE'), 'utf8'), /MIT License/);
  assert.deepEqual(manifest.repository, {
    type: 'git',
    url: 'https://github.com/t04dJ14n9/human-learning.git',
  });
});

test('webview bundles do not depend on webpack automatic publicPath detection', () => {
  for (const file of [
    'markdown-editor.js',
    'pdf-viewer.js',
    'experimental-owned-browser.js',
  ]) {
    const bundle = readFileSync(join(dist, file), 'utf8');
    assert.equal(
      bundle.includes('Automatic publicPath is not supported in this browser'),
      false,
      `${file} still uses webpack automatic publicPath detection`,
    );
  }
});

test('combined PDF bundle includes the Ask PDF panel protocol', () => {
  const bundle = readFileSync(join(dist, 'pdf-viewer.js'), 'utf8');
  assert.match(bundle, /pdfDiscussionPrepare/);
  assert.match(bundle, /pdfDiscussionLoadSnapshot/);
  assert.match(bundle, /Ask PDF/);
  assert.match(bundle, /Ask about selection/);
});

test('webview webpack entries use VS Code webview size budgets', () => {
  const configs = require('../webpack.config.js');
  const byName = new Map(configs.map(config => [config.name, config]));

  for (const name of ['pdf-viewer', 'markdown-editor', 'experimental-owned-browser']) {
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

test('manifest routes immutable Human Learning anchor bridge files to their dedicated editor', () => {
  const anchorEditor = manifest.contributes.customEditors.find(
    editor => editor.viewType === 'human-learning.anchorFile',
  );
  assert.ok(anchorEditor, 'missing Human Learning anchor-file custom editor contribution');
  assert.equal(anchorEditor.priority, 'default');
  assert.deepEqual(anchorEditor.selector, [{ filenamePattern: '*.hlanchor' }]);
  assert.equal(
    (manifest.activationEvents ?? []).includes(
      'onCustomEditor:human-learning.anchorFile',
    ),
    true,
  );
});

test('manifest contributes a command palette toggle for markdown Vim mode', () => {
  const toggleVimCommand = manifest.contributes.commands.find(
    command => command.command === 'human-learning.toggleVimMode',
  );
  assert.ok(toggleVimCommand, 'missing markdown Vim mode toggle command');
  assert.equal(toggleVimCommand.title, 'Human Learning: Toggle Vim Mode');
});

test('manifest contributes context-aware Markdown and PDF outlines to the main Explorer sidebar', () => {
  const humanLearningViews = manifest.contributes.views['human-learning'] ?? [];
  const explorerViews = manifest.contributes.views.explorer ?? [];

  assert.equal(
    humanLearningViews.some(view => view.id.includes('outline')),
    false,
    'outlines should not remain in the separate Human Learning activity view',
  );
  assert.deepEqual(
    explorerViews.map(view => ({
      id: view.id,
      name: view.name,
      type: view.type,
      when: view.when,
    })),
    [
      {
        id: 'hl-markdown-outline',
        name: 'Markdown Outline',
        type: 'tree',
        when: "activeCustomEditorId == 'human-learning.markdownEditor'",
      },
      {
        id: 'hl-pdf-outline',
        name: 'PDF Outline',
        type: 'tree',
        when: "activeCustomEditorId == 'human-learning.pdfViewer'",
      },
    ],
  );
});

test('manifest exposes selection export command while omitting Agent Context and Problems UI', () => {
  const viewIds = (manifest.contributes.views['human-learning'] ?? []).map(view => view.id);
  const commandIds = (manifest.contributes.commands ?? []).map(command => command.command);

  assert.equal(viewIds.includes('hl-agent-context'), false);
  assert.equal(viewIds.includes('hl-problems'), false);
  assert.equal(commandIds.includes('human-learning.addSelectionToContext'), true);
  assert.equal(commandIds.includes('human-learning.addSelectionToChat'), true);
  assert.equal(commandIds.includes('human-learning.addCursorBrowserSelectionToChat'), true);
  assert.equal(commandIds.includes('human-learning.experimentalBrowser.open'), true);
  assert.equal((manifest.activationEvents ?? []).includes('onUri'), true);
  assert.equal(
    commandIds.includes('human-learning.experimentalBrowser.sendSelection'),
    true,
  );
  assert.equal(
    (manifest.contributes.commands ?? []).some(
      command => command.command === 'human-learning.ingestCurrentFile',
    ),
    false,
  );
  assert.equal(
    (manifest.contributes.commands ?? []).some(
      command => command.command === 'human-learning.showBacklinks',
    ),
    false,
  );
});

test('manifest exposes provider-neutral Add to Chat on Markdown and PDF selection surfaces', () => {
  const command = manifest.contributes.commands.find(
    item => item.command === 'human-learning.addSelectionToChat',
  );
  assert.equal(command?.title, 'Human Learning: Add to Chat');

  const titleItems = (manifest.contributes.menus['editor/title'] ?? [])
    .filter(item => item.command === command.command);
  assert.deepEqual(
    titleItems.map(item => item.when).sort(),
    [
      "activeCustomEditorId == 'human-learning.markdownEditor'",
      'humanLearningPdfOpen && humanLearningPdfHasSelection',
    ],
  );
  assert.equal(
    (manifest.contributes.menus['editor/context'] ?? []).some(
      item => item.command === command.command
        && item.when === 'editorLangId == markdown && editorHasSelection',
    ),
    true,
  );
  assert.equal(
    (manifest.contributes.keybindings ?? []).some(
      item => item.command === command.command
        && item.key === 'ctrl+l'
        && item.mac === 'cmd+l'
        && item.when.includes('humanLearningMarkdownHasSelection')
        && item.when.includes('humanLearningPdfHasSelection'),
    ),
    true,
  );
  assert.equal(
    (manifest.activationEvents ?? []).includes('onView:human-learning.learningChat'),
    false,
  );
  assert.equal(
    (manifest.contributes.views?.['human-learning'] ?? []).some(
      item => item.id === 'human-learning.learningChat',
    ),
    false,
  );
});

test('manifest omits the redundant Human Learning jump stack view and commands', () => {
  const humanLearningViews = manifest.contributes.views['human-learning'] ?? [];
  const commandIds = (manifest.contributes.commands ?? []).map(command => command.command);

  assert.equal(humanLearningViews.some(view => view.id === 'hl-jump-stack'), false);
  assert.equal(commandIds.includes('human-learning.jumpBack'), false);
  assert.equal(commandIds.includes('human-learning.retractToJump'), false);
  assert.equal(commandIds.includes('human-learning.clearJumpStack'), false);
});
