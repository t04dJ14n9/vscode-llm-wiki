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
    /\.cm-lineNumbers \.cm-gutterElement': \{[\s\S]{0,500}cursor: 'pointer'/,
  );
  assert.match(source, /\.cm-active-inline-code': \{[\s\S]{0,500}fontFamily: 'var\(--llm-wiki-editor-font-family/);
  assert.match(source, /\.cm-active-footnote-def-label': \{[\s\S]{0,300}fontSize: '0\.85em'/);
});

test('agent rules require reusing the generated host link instead of the anchor bridge', () => {
  const repositoryRoot = resolve(extensionRoot, '..', '..');
  for (const relativePath of [
    'README.md',
    'AGENTS.md',
    'demo-vault/AGENTS.md',
  ]) {
    const rules = readFileSync(join(repositoryRoot, relativePath), 'utf8');
    assert.match(rules, /cursor:\/\/llm-wiki\.llm-wiki-vscode\/open-anchor/);
    assert.match(rules, /vscode:\/\/llm-wiki\.llm-wiki-vscode\/open-anchor/);
    assert.match(rules, /open_uri/);
    assert.match(
      rules,
      /(?:never|do not)[\s\S]{0,120}\.llm_wiki_anchor|\.llm_wiki_anchor[\s\S]{0,120}(?:never|do not)/i,
    );
    assert.match(rules, /wikilink|relative Markdown link/i);
  }
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
    /LLM Wiki repository/,
  );
  assert.match(readFileSync(join(extensionRoot, 'LICENSE'), 'utf8'), /MIT License/);
  assert.deepEqual(manifest.repository, {
    type: 'git',
    url: 'https://github.com/t04dJ14n9/vscode-llm-wiki.git',
  });
});

test('VSIX package includes the ready-to-unpack empty vault', () => {
  assert.equal(
    existsSync(join(extensionRoot, 'resources', 'llm-wiki-empty-vault.zip')),
    true,
  );
  const ignore = readFileSync(join(extensionRoot, '.vscodeignore'), 'utf8');
  assert.doesNotMatch(ignore, /^resources(?:\/|\*\*)/m);
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

test('combined PDF artifacts omit removed selection actions', () => {
  const pdfBundle = readFileSync(join(dist, 'pdf-viewer.js'), 'utf8');
  const hostBundle = readFileSync(join(dist, 'extension.js'), 'utf8');
  for (const artifact of [pdfBundle, hostBundle]) {
    for (const removed of [
      'Insert Quote and Link',
      'Copy Quote and Link',
      'Insert Link',
      'copy-link-format',
      'Ask PDF',
      'Ask about selection',
      'pdfDiscussionPrepare',
      'pdfDiscussionLoadSnapshot',
    ]) {
      assert.equal(artifact.includes(removed), false);
    }
  }
});

test('provider-specific selection controls are absent from production Markdown and PDF bundles', () => {
  for (const file of ['markdown-editor.js', 'pdf-viewer.js']) {
    const bundle = readFileSync(join(dist, file), 'utf8');
    assert.equal(bundle.includes('Copy for Agent'), true, `${file} must expose Copy for Agent`);
    assert.equal(bundle.includes('Add to Chat'), true, `${file} must retain the Cursor action`);
    assert.equal(bundle.includes('cursorAgent'), true, `${file} must gate Add to Chat on Cursor`);
    for (const removed of [
      'sendToAgent',
      'Send to ',
      'Send to Codex',
      'Send to Claude Code',
      'Send to CodeBuddy',
      'provider-action',
    ]) assert.equal(bundle.includes(removed), false, `${file} still exposes ${removed}`);
  }
  const pdfBundle = readFileSync(join(dist, 'pdf-viewer.js'), 'utf8');
  assert.equal(pdfBundle.includes('__llmWikiAddToCursorChat'), false);
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

test('manifest leaves Markdown ownership optional so missing files become native untitled buffers first', () => {
  const markdownEditor = manifest.contributes.customEditors.find(
    editor => editor.viewType === 'llm-wiki.markdownEditor',
  );
  assert.ok(markdownEditor, 'missing markdown custom editor contribution');
  assert.equal(
    markdownEditor.priority,
    'option',
    'Markdown must first receive VS Code\'s associated untitled text model',
  );
  assert.equal(
    manifest.contributes.configurationDefaults['workbench.editorAssociations']['*.md'],
    undefined,
    'a default association claims missing paths before VS Code can make them untitled',
  );
});

test('manifest leaves the terminal Backquote shortcut to VS Code in Vim mode', () => {
  const consumedShortcutBindings = (manifest.contributes.keybindings ?? [])
    .filter(binding => binding.command === 'llm-wiki.consumeVimHostShortcut');

  for (const binding of consumedShortcutBindings) {
    for (const platformKey of ['key', 'mac', 'win', 'linux']) {
      assert.doesNotMatch(
        binding[platformKey] ?? '',
        /(?:ctrl|cmd)\+`/i,
        `${platformKey} must not reserve the terminal Backquote shortcut`,
      );
    }
  }
});

test('manifest routes immutable LLM Wiki anchor bridge files to their dedicated editor', () => {
  const anchorEditor = manifest.contributes.customEditors.find(
    editor => editor.viewType === 'llm-wiki.anchorFile',
  );
  assert.ok(anchorEditor, 'missing LLM Wiki anchor-file custom editor contribution');
  assert.equal(anchorEditor.priority, 'default');
  assert.deepEqual(anchorEditor.selector, [{ filenamePattern: '*.llm_wiki_anchor' }]);
  assert.equal(
    (manifest.activationEvents ?? []).includes(
      'onCustomEditor:llm-wiki.anchorFile',
    ),
    true,
  );
});

test('manifest contributes a command palette toggle for markdown Vim mode', () => {
  const toggleVimCommand = manifest.contributes.commands.find(
    command => command.command === 'llm-wiki.toggleVimMode',
  );
  assert.ok(toggleVimCommand, 'missing markdown Vim mode toggle command');
  assert.equal(toggleVimCommand.title, 'LLM Wiki: Toggle Vim Mode');
});

test('manifest contributes a PDF toolbar recovery command', () => {
  const command = manifest.contributes.commands.find(
    candidate => candidate.command === 'llm-wiki.togglePdfToolbar',
  );
  assert.ok(command, 'missing PDF toolbar toggle command');
  assert.equal(command.title, 'LLM Wiki: Toggle PDF Toolbar');
});

test('manifest contributes context-aware Markdown and PDF outlines to the main Explorer sidebar', () => {
  const llmWikiViews = manifest.contributes.views['llm-wiki'] ?? [];
  const explorerViews = manifest.contributes.views.explorer ?? [];

  assert.equal(
    llmWikiViews.some(view => view.id.includes('outline')),
    false,
    'outlines should not remain in the separate LLM Wiki activity view',
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
        id: 'llm-wiki-markdown-outline',
        name: 'Markdown Outline',
        type: 'tree',
        when: "activeCustomEditorId == 'llm-wiki.markdownEditor'",
      },
      {
        id: 'llm-wiki-pdf-outline',
        name: 'PDF Outline',
        type: 'tree',
        when: "activeCustomEditorId == 'llm-wiki.pdfViewer'",
      },
    ],
  );
});

test('manifest exposes Copy for Agent while omitting the selection export command, Agent Context, and Problems UI', () => {
  const viewIds = (manifest.contributes.views['llm-wiki'] ?? []).map(view => view.id);
  const commandIds = (manifest.contributes.commands ?? []).map(command => command.command);

  assert.equal(viewIds.includes('llm-wiki-agent-context'), false);
  assert.equal(viewIds.includes('llm-wiki-problems'), false);
  assert.equal(commandIds.includes('llm-wiki.copySelectionForAgent'), true);
  assert.equal(commandIds.includes('llm-wiki.addSelectionToContext'), false);
  assert.equal(commandIds.includes('llm-wiki.addSelectionToChat'), true);
  assert.equal(commandIds.includes('llm-wiki.addCursorBrowserSelectionToChat'), true);
  assert.equal(commandIds.includes('llm-wiki.experimentalBrowser.open'), true);
  assert.equal((manifest.activationEvents ?? []).includes('onUri'), true);
  assert.equal(
    commandIds.includes('llm-wiki.experimentalBrowser.sendSelection'),
    true,
  );
  assert.equal(
    (manifest.contributes.commands ?? []).some(
      command => command.command === 'llm-wiki.ingestCurrentFile',
    ),
    false,
  );
  assert.equal(
    (manifest.contributes.commands ?? []).some(
      command => command.command === 'llm-wiki.showBacklinks',
    ),
    false,
  );
});

test('manifest exposes Copy for Agent in both hosts while Add to Chat stays Cursor-only', () => {
  const addToChat = manifest.contributes.commands.find(
    item => item.command === 'llm-wiki.addSelectionToChat',
  );
  assert.equal(addToChat?.title, 'LLM Wiki: Add to Chat');
  assert.equal(addToChat?.enablement, 'llmWikiHostIsCursor');

  const addToChatContributions = [
    ...Object.values(manifest.contributes.menus ?? {}).flat(),
    ...(manifest.contributes.keybindings ?? []),
  ].filter(item => item.command === addToChat.command);
  assert.ok(addToChatContributions.length > 0);
  assert.ok(addToChatContributions.every(
    item => item.when.includes('llmWikiHostIsCursor'),
  ));

  const copyForAgent = manifest.contributes.commands.find(
    item => item.command === 'llm-wiki.copySelectionForAgent',
  );
  assert.equal(copyForAgent?.title, 'LLM Wiki: Copy for Agent');
  assert.equal(copyForAgent?.icon, '$(copy)');
  assert.equal(copyForAgent?.enablement, undefined);
  const copyForAgentContributions = Object.values(manifest.contributes.menus ?? {})
    .flat()
    .filter(item => item.command === copyForAgent.command);
  assert.ok(copyForAgentContributions.length > 0);
  assert.ok(copyForAgentContributions.every(
    item => !item.when.includes('llmWikiHostIsCursor'),
  ));
  assert.ok(copyForAgentContributions.some(
    item => item.when.includes("activeCustomEditorId == 'llm-wiki.markdownEditor'")
      && item.when.includes('llmWikiMarkdownHasSelection'),
  ));
  assert.ok(copyForAgentContributions.some(
    item => item.when.includes('llmWikiPdfOpen')
      && item.when.includes('llmWikiPdfHasAgentClipboardSelection'),
  ));
  const pdfAddToChat = addToChatContributions.find(
    item => item.when.includes('llmWikiPdfOpen'),
  );
  assert.match(pdfAddToChat?.when ?? '', /llmWikiPdfHasSelection/);
  assert.doesNotMatch(pdfAddToChat?.when ?? '', /llmWikiPdfHasAgentClipboardSelection/);
  assert.ok(copyForAgentContributions.some(
    item => item.when.includes('editorLangId == markdown') && item.when.includes('editorHasSelection'),
  ));
  const copyForAgentKeybinding = (manifest.contributes.keybindings ?? []).find(
    item => item.command === copyForAgent.command,
  );
  assert.deepEqual(copyForAgentKeybinding, {
    command: 'llm-wiki.copySelectionForAgent',
    key: 'ctrl+alt+c',
    mac: 'cmd+alt+c',
    when: [
      "(activeCustomEditorId == 'llm-wiki.markdownEditor' && llmWikiMarkdownHasSelection)",
      "(llmWikiPdfOpen && llmWikiPdfHasAgentClipboardSelection)",
      '(editorLangId == markdown && editorHasSelection)',
    ].join(' || '),
  });
  assert.equal(
    (manifest.activationEvents ?? []).includes('onView:llm-wiki.learningChat'),
    false,
  );
  assert.equal(
    (manifest.contributes.views?.['llm-wiki'] ?? []).some(
      item => item.id === 'llm-wiki.learningChat',
    ),
    false,
  );
});

test('manifest contributes guarded focus restoration for an active Cursor handoff', () => {
  const command = manifest.contributes.commands.find(
    item => item.command === 'llm-wiki.focusMarkdownEditor',
  );
  assert.equal(command?.title, 'LLM Wiki: Focus Markdown Editor');

  const escapeBinding = (manifest.contributes.keybindings ?? []).find(
    item => item.command === 'llm-wiki.focusMarkdownEditor'
      && item.key === 'escape',
  );
  assert.ok(escapeBinding, 'missing guarded Escape focus binding');
  assert.match(escapeBinding.when, /llmWikiAgentHandoffActive/);
  assert.match(
    escapeBinding.when,
    /activeCustomEditorId == 'llm-wiki\.markdownEditor'/,
  );
});

test('manifest omits the redundant LLM Wiki jump stack view and commands', () => {
  const llmWikiViews = manifest.contributes.views['llm-wiki'] ?? [];
  const commandIds = (manifest.contributes.commands ?? []).map(command => command.command);

  assert.equal(llmWikiViews.some(view => view.id === 'llm-wiki-jump-stack'), false);
  assert.equal(commandIds.includes('llm-wiki.jumpBack'), false);
  assert.equal(commandIds.includes('llm-wiki.retractToJump'), false);
  assert.equal(commandIds.includes('llm-wiki.clearJumpStack'), false);
});
