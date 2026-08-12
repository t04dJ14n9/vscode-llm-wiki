import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function productAnchorUri(target) {
  return 'cursor://human-learning.human-learning-vscode/open-anchor?target='
    + `v1.${Buffer.from(target, 'utf8').toString('base64url')}`;
}

function encodedAnchorFile(target) {
  const text = JSON.stringify({ version: 1, target }, null, 2);
  return {
    fileName: `source-${createHash('sha256').update(text).digest('hex')}.hlanchor`,
    text,
    payload: { version: 1, target },
  };
}

function loadTsModule(relativePath, mocks = {}) {
  const moduleMocks = {
    './anchorFileCodec': {
      encodeAnchorFile: encodedAnchorFile,
    },
    './anchorUris': {
      humanLearningOpenAnchorUri: productAnchorUri,
    },
    ...mocks,
  };
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
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(moduleMocks, request)) {
      return moduleMocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    mod._compile(outputText, filename);
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const filesystemWiki = loadTsModule('src/filesystemWiki.ts');

test('addSelectionToContext exports a custom markdown editor selection when no native editor is active', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-'));
  const errors = [];
  const informationMessages = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace(`${vaultRoot}/`, ''),
    },
    window: {
      activeTextEditor: undefined,
      showErrorMessage: message => errors.push(message),
      showInformationMessage: message => informationMessages.push(message),
    },
  };
  const { addSelectionToContext } = loadTsModule('src/agentContext.ts', {
    vscode,
    '@human-learning/core': {
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      runMigrations: () => undefined,
    },
    './filesystemWiki': filesystemWiki,
    './wikiLinks': {
      notePathToUri: value => `hl://note/${value.split('/').map(encodeURIComponent).join('/')}`,
    },
  });

  try {
    const exported = await addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: () => ({
        uri: { fsPath: `${vaultRoot}/notes/Concepts/Online Softmax.md` },
        text: '## Standard Softmax\n\n$softmax(x_i)$',
        startLine: 5,
        endLine: 7,
      }),
    });

    const markdown = readFileSync(join(vaultRoot, '.hl', 'agent', 'selection.md'), 'utf8');
    const json = JSON.parse(readFileSync(join(vaultRoot, '.hl', 'agent', 'selection.json'), 'utf8'));

    assert.equal(errors.length, 0);
    assert.ok(exported);
    assert.equal(isAbsolute(exported.directoryPath), true);
    assert.equal(dirname(exported.directoryPath), join(vaultRoot, '.hl', 'agent', 'exports'));
    assert.equal(readFileSync(exported.markdownPath, 'utf8'), markdown);
    assert.deepEqual(JSON.parse(readFileSync(exported.jsonPath, 'utf8')), json);
    assert.match(
      markdown,
      /\*\*Source\*\*: \[notes\/Concepts\/Online Softmax\.md \(lines 5–7\)\]\(<file:\/\//,
    );
    assert.match(
      markdown,
      /\*\*Citation requirement\*\*: In chat responses, reuse the exact Source link above\./,
    );
    assert.doesNotMatch(markdown, /\*\*(?:Open in Human Learning|Portable anchor)\*\*/);
    assert.match(
      markdown,
      /\*\*Visual evidence\*\*: \[selection\.png\]\(\.\/selection\.png\) when present/,
    );
    assert.match(markdown, /## Standard Softmax\n\n\$softmax\(x_i\)\$/);
    assert.equal(json.source, 'notes/Concepts/Online Softmax.md');
    assert.equal(json.anchor_uri, 'hl://note/notes/Concepts/Online%20Softmax.md#L5-L7');
    assert.equal(fileURLToPath(json.chat_uri), exported.anchorPath);
    assert.equal(markdown.includes(`](<${json.chat_uri}>)`), true);
    assert.deepEqual(
      JSON.parse(readFileSync(exported.anchorPath, 'utf8')),
      { version: 1, target: json.anchor_uri },
    );
    const anchorBytes = readFileSync(exported.anchorPath);
    assert.equal(
      basename(exported.anchorPath),
      `source-${createHash('sha256').update(anchorBytes).digest('hex')}.hlanchor`,
    );
    assert.equal(
      json.open_uri,
      productAnchorUri(json.anchor_uri),
    );
    assert.deepEqual(json.lines, { start: 5, end: 7 });
    assert.equal(json.text, '## Standard Softmax\n\n$softmax(x_i)$');
    assert.deepEqual(informationMessages, [
      'Selection exported to .hl/agent/selection.md + .hl/agent/selection.json',
    ]);
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test('addSelectionToContext preserves explicit source labels and anchors for PDF selections', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-pdf-'));
  const errors = [];
  const informationMessages = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace(`${vaultRoot}/`, ''),
    },
    window: {
      activeTextEditor: undefined,
      showErrorMessage: message => errors.push(message),
      showInformationMessage: message => informationMessages.push(message),
    },
  };
  const { addSelectionToContext } = loadTsModule('src/agentContext.ts', {
    vscode,
    '@human-learning/core': {
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [{ from_note_path: 'notes/Paper Notes.md', from_line: 12 }],
      getForwardLinks: () => [],
      runMigrations: () => undefined,
    },
    './filesystemWiki': filesystemWiki,
    './wikiLinks': {
      notePathToUri: value => `hl://note/${value.split('/').map(encodeURIComponent).join('/')}`,
    },
  });

  try {
    mkdirSync(join(vaultRoot, 'notes'), { recursive: true });
    writeFileSync(
      join(vaultRoot, 'notes', 'Paper Notes.md'),
      '[Source](../raw/papers/attention.pdf#page=2)\n',
    );
    const exported = await addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: async () => ({
        uri: { fsPath: `${vaultRoot}/raw/papers/attention.pdf` },
        text: 'FlashAttention uses tiling',
        startLine: 2,
        endLine: 2,
        sourceLabel: 'raw/papers/attention.pdf',
        rangeLabel: 'page 2',
        anchorUri: 'raw/papers/attention.pdf#page=2:~:text=FlashAttention%20uses%20tiling',
        metadata: {
          kind: 'pdf',
          page: 2,
          anchorId: 'anc_pdf_context',
        },
      }),
    });

    const markdown = readFileSync(join(vaultRoot, '.hl', 'agent', 'selection.md'), 'utf8');
    const json = JSON.parse(readFileSync(join(vaultRoot, '.hl', 'agent', 'selection.json'), 'utf8'));

    assert.equal(errors.length, 0);
    assert.ok(exported);
    assert.equal(readFileSync(exported.markdownPath, 'utf8'), markdown);
    assert.deepEqual(JSON.parse(readFileSync(exported.jsonPath, 'utf8')), json);
    assert.match(
      markdown,
      /\*\*Source\*\*: \[raw\/papers\/attention\.pdf \(page 2\)\]\(<file:\/\//,
    );
    assert.match(
      markdown,
      /\*\*Citation requirement\*\*: In chat responses, reuse the exact Source link above\./,
    );
    assert.doesNotMatch(markdown, /raw\/papers\/attention\.pdf#page=2:~:text=/);
    assert.match(markdown, /FlashAttention uses tiling/);
    assert.equal(json.source, 'raw/papers/attention.pdf');
    assert.equal(
      json.anchor_uri,
      'raw/papers/attention.pdf#page=2:~:text=FlashAttention%20uses%20tiling',
    );
    assert.equal(
      json.open_uri,
      productAnchorUri(json.anchor_uri),
    );
    assert.equal(fileURLToPath(json.chat_uri), exported.anchorPath);
    assert.equal(markdown.includes(`](<${json.chat_uri}>)`), true);
    assert.deepEqual(
      JSON.parse(readFileSync(exported.anchorPath, 'utf8')),
      { version: 1, target: json.anchor_uri },
    );
    assert.deepEqual(json.lines, { start: 2, end: 2 });
    assert.equal(json.location, 'page 2');
    assert.equal(json.text, 'FlashAttention uses tiling');
    assert.deepEqual(json.metadata, {
      kind: 'pdf',
      page: 2,
      anchorId: 'anc_pdf_context',
    });
    assert.deepEqual(json.backlinks, [{ from: 'notes/Paper Notes.md', line: 1 }]);
    assert.deepEqual(informationMessages, [
      'Selection exported to .hl/agent/selection.md + .hl/agent/selection.json',
    ]);
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test('web selections keep their directly clickable HTTPS source instead of an anchor bridge', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-web-'));
  const { addSelectionToContext } = loadAgentContext(vscodeMock(vaultRoot));
  const anchorUri =
    'https://example.com/article?edition=full#:~:text=selected%20web%20passage';
  try {
    const exported = await addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: () => ({
        uri: { fsPath: join(vaultRoot, 'raw', 'web', 'article.html') },
        text: 'selected web passage',
        startLine: 1,
        endLine: 1,
        sourceLabel: 'Example article',
        rangeLabel: 'selected passage',
        anchorUri,
      }),
    });

    assert.ok(exported);
    const markdown = readFileSync(exported.markdownPath, 'utf8');
    const json = JSON.parse(readFileSync(exported.jsonPath, 'utf8'));
    assert.equal(json.chat_uri, anchorUri);
    assert.equal(markdown.includes(`](<${anchorUri}>)`), true);
    assert.equal(markdown.includes('.hlanchor'), false);
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test('native code selections export a clickable local code anchor bridge', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-code-'));
  const { addSelectionToContext } = loadAgentContext(vscodeMock(vaultRoot));
  try {
    const exported = await addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: () => ({
        uri: { fsPath: join(vaultRoot, 'raw', 'code', 'kernel.ts') },
        text: 'const tile = 128;',
        startLine: 3,
        endLine: 4,
      }),
    });

    assert.ok(exported);
    assert.ok(exported.anchorPath);
    const markdown = readFileSync(exported.markdownPath, 'utf8');
    const json = JSON.parse(readFileSync(exported.jsonPath, 'utf8'));
    assert.equal(json.anchor_uri, 'raw/code/kernel.ts#L3-L4');
    assert.equal(fileURLToPath(json.chat_uri), exported.anchorPath);
    assert.equal(markdown.includes(`](<${json.chat_uri}>)`), true);
    assert.deepEqual(JSON.parse(readFileSync(exported.anchorPath, 'utf8')), {
      version: 1,
      target: json.anchor_uri,
    });
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test('selection markdown uses a fence longer than every backtick run in the selected text', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-fence-'));
  const { addSelectionToContext } = loadAgentContext(vscodeMock(vaultRoot));
  const text = [
    '```ts',
    'const value = `inline`;',
    '````',
  ].join('\n');
  try {
    const exported = await addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: () => selection(vaultRoot, text),
    });
    assert.ok(exported);
    const markdown = readFileSync(exported.markdownPath, 'utf8');
    assert.match(markdown, new RegExp(`\\n${'`'.repeat(5)}\\n`));
    assert.match(markdown, new RegExp(`\\n${'`'.repeat(5)}\\n$`));
    assert.match(markdown, /```ts\nconst value = `inline`;\n````/);
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test('selection export remains usable when bounded backlink context cannot be loaded', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-link-failure-'));
  const vscode = vscodeMock(vaultRoot);
  const { addSelectionToContext } = loadTsModule('src/agentContext.ts', {
    vscode,
    './filesystemWiki': {
      loadFilesystemWiki: async () => {
        throw new Error('vault scan limit reached');
      },
      getBacklinks: () => {
        throw new Error('must not run without an index');
      },
      getForwardLinks: () => {
        throw new Error('must not run without an index');
      },
    },
    './wikiLinks': { notePathToUri: value => `hl://note/${value}` },
  });
  try {
    const exported = await addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: () => selection(vaultRoot, 'bounded handoff'),
    });
    assert.ok(exported);
    const json = JSON.parse(readFileSync(exported.jsonPath, 'utf8'));
    assert.deepEqual(json.backlinks, []);
    assert.deepEqual(json.forward_links, []);
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test('concurrent selection exports publish distinct matched immutable snapshots and matched latest aliases', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-concurrent-'));
  const vscode = vscodeMock(vaultRoot);
  const { addSelectionToContext } = loadAgentContext(vscode);

  try {
    const exportSelection = text => addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: () => ({
        uri: { fsPath: join(vaultRoot, 'notes', `${text}.md`) },
        text,
        startLine: 1,
        endLine: 1,
      }),
    });
    const [alpha, beta] = await Promise.all([
      exportSelection('alpha immutable passage'),
      exportSelection('beta immutable passage'),
    ]);

    assert.ok(alpha);
    assert.ok(beta);
    assert.notEqual(alpha.directoryPath, beta.directoryPath);
    for (const exported of [alpha, beta]) {
      const markdown = readFileSync(exported.markdownPath, 'utf8');
      const json = JSON.parse(readFileSync(exported.jsonPath, 'utf8'));
      assert.match(markdown, new RegExp(json.text));
      assert.equal(dirname(exported.markdownPath), exported.directoryPath);
      assert.equal(dirname(exported.jsonPath), exported.directoryPath);
      assert.equal(dirname(exported.anchorPath), exported.directoryPath);
      assert.equal(fileURLToPath(json.chat_uri), exported.anchorPath);
      assert.deepEqual(
        JSON.parse(readFileSync(exported.anchorPath, 'utf8')),
        { version: 1, target: json.anchor_uri },
      );
    }
    const latestMarkdown = readFileSync(join(vaultRoot, '.hl', 'agent', 'selection.md'), 'utf8');
    const latestJson = JSON.parse(
      readFileSync(join(vaultRoot, '.hl', 'agent', 'selection.json'), 'utf8'),
    );
    assert.match(latestMarkdown, new RegExp(latestJson.text));
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

for (const unsafePath of [
  ['.hl'],
  ['.hl', 'agent'],
  ['.hl', 'agent', 'exports'],
  ['.hl', 'agent', 'selection.md'],
  ['.hl', 'agent', 'selection.json'],
]) {
  test(`selection export rejects symlinked ${unsafePath.join('/')}`, async () => {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-symlink-'));
    const outside = mkdtempSync(join(tmpdir(), 'hl-agent-context-outside-'));
    const linkPath = join(vaultRoot, ...unsafePath);
    const isAlias = unsafePath.at(-1)?.startsWith('selection.');
    const target = isAlias ? join(outside, 'sentinel') : outside;
    try {
      if (isAlias) writeFileSync(target, 'outside');
      mkdirSync(dirname(linkPath), { recursive: true });
      symlinkSync(target, linkPath, isAlias ? 'file' : 'dir');
      const { addSelectionToContext } = loadAgentContext(vscodeMock(vaultRoot));

      await assert.rejects(
        addSelectionToContext(vaultRoot, {
          getActiveSelectionContext: () => selection(vaultRoot, 'secure passage'),
        }),
        /Unsafe selection export/,
      );
      if (isAlias) assert.equal(readFileSync(target, 'utf8'), 'outside');
    } finally {
      rmSync(vaultRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
}

test('selection crop sync writes immutable and latest copies, then removes only the latest alias', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-attachment-'));
  const {
    addSelectionToContext,
    syncSelectionExportAttachment,
  } = loadAgentContext(vscodeMock(vaultRoot));
  try {
    const exported = await addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: () => selection(vaultRoot, 'crop passage'),
    });
    assert.ok(exported);
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const immutablePath = await syncSelectionExportAttachment(
      exported,
      'selection.png',
      bytes,
    );
    const aliasPath = join(vaultRoot, '.hl', 'agent', 'selection.png');
    assert.equal(immutablePath, join(exported.directoryPath, 'selection.png'));
    assert.deepEqual(readFileSync(immutablePath), Buffer.from(bytes));
    assert.deepEqual(readFileSync(aliasPath), Buffer.from(bytes));

    assert.equal(
      await syncSelectionExportAttachment(exported, 'selection.png'),
      undefined,
    );
    assert.equal(existsSync(aliasPath), false);
    assert.deepEqual(readFileSync(immutablePath), Buffer.from(bytes));
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test('a new selection export clears the prior crop alias but preserves its immutable snapshot', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-fresh-selection-'));
  const {
    addSelectionToContext,
    syncSelectionExportAttachment,
  } = loadAgentContext(vscodeMock(vaultRoot));
  try {
    const first = await addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: () => selection(vaultRoot, 'PDF crop A'),
    });
    assert.ok(first);
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const immutableCrop = await syncSelectionExportAttachment(
      first,
      'selection.png',
      bytes,
    );
    const latestCrop = join(vaultRoot, '.hl', 'agent', 'selection.png');
    assert.ok(immutableCrop);
    assert.equal(existsSync(latestCrop), true);

    const second = await addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: () => selection(vaultRoot, 'generic selection B'),
    });

    assert.ok(second);
    assert.equal(existsSync(latestCrop), false);
    assert.equal(existsSync(join(vaultRoot, '.hl', 'agent', 'selection.png')), false);
    assert.deepEqual(readFileSync(immutableCrop), Buffer.from(bytes));
    assert.match(
      readFileSync(second.markdownPath, 'utf8'),
      /\[selection\.png\]\(\.\/selection\.png\) when present/,
    );
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test('selection crop sync never follows immutable or latest target symlinks', async () => {
  for (const targetKind of ['immutable', 'alias']) {
    const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-attachment-link-'));
    const outside = join(
      mkdtempSync(join(tmpdir(), 'hl-agent-context-attachment-outside-')),
      'sentinel',
    );
    writeFileSync(outside, 'outside');
    const api = loadAgentContext(vscodeMock(vaultRoot));
    try {
      const exported = await api.addSelectionToContext(vaultRoot, {
        getActiveSelectionContext: () => selection(vaultRoot, 'linked crop passage'),
      });
      assert.ok(exported);
      const target = targetKind === 'immutable'
        ? join(exported.directoryPath, 'selection.png')
        : join(vaultRoot, '.hl', 'agent', 'selection.png');
      symlinkSync(outside, target);

      await assert.rejects(
        api.syncSelectionExportAttachment(
          exported,
          'selection.png',
          Uint8Array.from([1, 2, 3]),
        ),
        /Selection export attachment already exists|Unsafe selection export alias/,
      );
      assert.equal(readFileSync(outside, 'utf8'), 'outside');
    } finally {
      rmSync(vaultRoot, { recursive: true, force: true });
      rmSync(dirname(outside), { recursive: true, force: true });
    }
  }
});

function vscodeMock(vaultRoot) {
  return {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace(`${vaultRoot}/`, ''),
    },
    window: {
      activeTextEditor: undefined,
      showErrorMessage: () => undefined,
      showInformationMessage: () => undefined,
    },
  };
}

function selection(vaultRoot, text) {
  return {
    uri: { fsPath: join(vaultRoot, 'notes', 'selection.md') },
    text,
    startLine: 1,
    endLine: 1,
  };
}

function loadAgentContext(vscode) {
  return loadTsModule('src/agentContext.ts', {
    vscode,
    './filesystemWiki': {
      loadFilesystemWiki: async () => ({}),
      getBacklinks: () => [],
      getForwardLinks: () => [],
    },
    './wikiLinks': { notePathToUri: value => `hl://note/${value}` },
  });
}

test('addSelectionToContext returns false and skips files when no exportable selection exists', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-empty-'));
  const errors = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace(`${vaultRoot}/`, ''),
    },
    window: {
      activeTextEditor: undefined,
      showErrorMessage: message => errors.push(message),
      showInformationMessage: () => undefined,
    },
  };
  const { addSelectionToContext } = loadTsModule('src/agentContext.ts', {
    vscode,
    '@human-learning/core': {
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      runMigrations: () => undefined,
    },
    './filesystemWiki': filesystemWiki,
    './wikiLinks': {
      notePathToUri: value => `hl://note/${value}`,
    },
  });

  try {
    const exported = await addSelectionToContext(vaultRoot, {
      getActiveSelectionContext: () => ({
        uri: { fsPath: `${vaultRoot}/notes/empty.md` },
        text: '   \n',
        startLine: 1,
        endLine: 1,
      }),
    });

    assert.equal(exported, false);
    assert.deepEqual(errors, ['No text selected']);
    assert.throws(() => readFileSync(join(vaultRoot, '.hl', 'agent', 'selection.md'), 'utf8'), {
      code: 'ENOENT',
    });
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test('addSelectionToContext never expands an empty native selection to the whole document', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'hl-agent-context-native-empty-'));
  const errors = [];
  const vscode = {
    workspace: {
      asRelativePath: uri => uri.fsPath.replace(`${vaultRoot}/`, ''),
    },
    window: {
      activeTextEditor: {
        selection: {
          isEmpty: true,
          start: { line: 3 },
          end: { line: 3 },
        },
        document: {
          uri: { fsPath: `${vaultRoot}/notes/private.md` },
          lineCount: 20,
          getText: () => 'the whole document must not be exported',
        },
      },
      showErrorMessage: message => errors.push(message),
      showInformationMessage: () => undefined,
    },
  };
  const { addSelectionToContext } = loadTsModule('src/agentContext.ts', {
    vscode,
    '@human-learning/core': {
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      getBacklinks: () => [],
      getForwardLinks: () => [],
      runMigrations: () => undefined,
    },
    './filesystemWiki': filesystemWiki,
    './wikiLinks': {
      notePathToUri: value => `hl://note/${value}`,
    },
  });

  try {
    const exported = await addSelectionToContext(vaultRoot);

    assert.equal(exported, false);
    assert.deepEqual(errors, ['No text selected']);
    assert.throws(() => readFileSync(join(vaultRoot, '.hl', 'agent', 'selection.md'), 'utf8'), {
      code: 'ENOENT',
    });
  } finally {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});
