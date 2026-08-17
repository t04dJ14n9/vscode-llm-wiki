import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
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
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function productAnchorUri(target) {
  return 'cursor://llm-wiki.llm-wiki-vscode/open-anchor?target='
    + `v1.${Buffer.from(target, 'utf8').toString('base64url')}`;
}

function loadTsModule(relativePath, mocks = {}) {
  const moduleMocks = {
    './anchorUris': {
      llmWikiAnchorTargetFromString: value => {
        const prefix = ['cursor', 'vscode']
          .map(scheme => `${scheme}://llm-wiki.llm-wiki-vscode/open-anchor?target=`)
          .find(candidate => value.startsWith(candidate));
        if (!prefix) return undefined;
        const encoded = value.slice(prefix.length);
        if (!encoded.startsWith('v1.')) return undefined;
        return Buffer.from(encoded.slice(3), 'base64url').toString('utf8');
      },
    },
    ...mocks,
  };
  const compiled = new Map();
  const compileTs = filename => {
    const cached = compiled.get(filename);
    if (cached) return cached.exports;
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
    compiled.set(filename, mod);
    mod._compile(outputText, filename);
    return mod.exports;
  };
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(moduleMocks, request)) {
      if (request === 'fs') {
        return {
          ...originalLoad.call(this, request, parent, isMain),
          ...moduleMocks[request],
        };
      }
      return moduleMocks[request];
    }
    // Unmocked sibling sources compile for real so resolution logic is exercised
    // rather than stubbed.
    if (request.startsWith('.') && parent?.filename) {
      const sibling = resolve(dirname(parent.filename), `${request}.ts`);
      if (existsSync(sibling)) return compileTs(sibling);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return compileTs(join(packageRoot, relativePath));
  } finally {
    Module._load = originalLoad;
  }
}

test('dispatchUri opens markdown note links with the LLM Wiki markdown editor', async () => {
  const executeCommandCalls = [];
  const openTextDocumentCalls = [];
  const showTextDocumentCalls = [];
  const document = {
    uri: { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
    getText: () => '# Online Softmax\n',
    positionAt: () => ({ line: 0, character: 0 }),
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls,
    showTextDocumentCalls,
    document,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@llm-wiki/core': {
      classifyReferenceTarget: () => ({
        kind: 'note',
        path: 'notes/Concepts/Online Softmax.md',
      }),
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri('/vault', 'notes/Concepts/Online Softmax.md');

  assert.deepEqual(executeCommandCalls, [
    [
      'vscode.openWith',
      { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
      'llm-wiki.markdownEditor',
    ],
  ]);
  assert.deepEqual(openTextDocumentCalls, []);
  assert.deepEqual(showTextDocumentCalls, []);
});

test('dispatchUri opens OKF concept IDs, bundle-relative paths, and underscore directory indexes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-okf-links-'));
  const executeCommandCalls = [];
  const errorMessages = [];
  try {
    mkdirSync(join(root, 'concepts'), { recursive: true });
    mkdirSync(join(root, 'summaries'), { recursive: true });
    mkdirSync(join(root, 'legacy'), { recursive: true });
    writeFileSync(join(root, 'concepts', 'tokenization.md'), '# Tokenization\n');
    writeFileSync(join(root, 'summaries', '_index.md'), '# Summary\n');
    writeFileSync(join(root, 'legacy', 'index.md'), '# Legacy summary\n');

    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: undefined,
      errorMessages,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: uri => {
          const [targetPath, heading] = uri.split('#', 2);
          return targetPath.endsWith('.md')
            ? {
                kind: 'note',
                path: targetPath,
                heading,
              }
            : {
                kind: 'unknown',
                path: targetPath,
                heading,
              };
        },
      },
    });

    await dispatchUri(root, 'concepts/tokenization');
    await dispatchUri(root, '/concepts/tokenization.md');
    await dispatchUri(root, 'summaries/');
    await dispatchUri(root, 'legacy/');

    assert.deepEqual(executeCommandCalls, [
      [
        'vscode.openWith',
        { fsPath: join(root, 'concepts', 'tokenization.md') },
        'llm-wiki.markdownEditor',
      ],
      [
        'vscode.openWith',
        { fsPath: join(root, 'concepts', 'tokenization.md') },
        'llm-wiki.markdownEditor',
      ],
      [
        'vscode.openWith',
        { fsPath: join(root, 'summaries', '_index.md') },
        'llm-wiki.markdownEditor',
      ],
    ]);
    assert.deepEqual(errorMessages, ['Cannot open link target: legacy/']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatchUri refuses to create a note through a workspace symlink', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-uri-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'llm-wiki-uri-outside-'));
  const executeCommandCalls = [];
  const errorMessages = [];
  try {
    mkdirSync(join(root, 'notes'), { recursive: true });
    symlinkSync(outside, join(root, 'notes', 'out'), 'dir');
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: {
        getText: () => '',
        positionAt: () => ({ line: 0, character: 0 }),
      },
      errorMessages,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: () => ({
          kind: 'note',
          path: 'notes/out/Escape.md',
        }),
      },
    });

    await dispatchUri(root, 'notes/out/Escape.md');

    assert.deepEqual(executeCommandCalls, []);
    assert.equal(existsSync(join(outside, 'Escape.md')), false);
    assert.deepEqual(errorMessages, [
      'Cannot open link outside the workspace: notes/out/Escape.md',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('dispatchUri creates missing markdown note links before opening them', async () => {
  const executeCommandCalls = [];
  const createdDirectories = [];
  const writtenFiles = [];
  const document = {
    uri: { fsPath: '/vault/notes/Concepts/Linked Concept.md' },
    getText: () => '',
    positionAt: () => ({ line: 0, character: 0 }),
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@llm-wiki/core': {
      classifyReferenceTarget: () => ({
        kind: 'note',
        path: 'notes/Concepts/Linked Concept.md',
      }),
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: {
      existsSync: () => false,
      mkdirSync: (...args) => createdDirectories.push(args),
      writeFileSync: (...args) => writtenFiles.push(args),
    },
  });

  await dispatchUri('/vault', 'notes/Concepts/Linked Concept.md');

  assert.deepEqual(createdDirectories, [
    ['/vault/notes/Concepts', { recursive: true }],
  ]);
  assert.deepEqual(writtenFiles, [
    ['/vault/notes/Concepts/Linked Concept.md', '', { flag: 'wx' }],
  ]);
  assert.deepEqual(executeCommandCalls, [
    [
      'vscode.openWith',
      { fsPath: '/vault/notes/Concepts/Linked Concept.md' },
      'llm-wiki.markdownEditor',
    ],
  ]);
});

test('dispatchUri rejects note targets that would create files outside the workspace', async () => {
  const executeCommandCalls = [];
  const openTextDocumentCalls = [];
  const writtenFiles = [];
  const createdDirectories = [];
  const errorMessages = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls,
    showTextDocumentCalls: [],
    errorMessages,
    document: undefined,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@llm-wiki/core': {
      classifyReferenceTarget: () => ({
        kind: 'note',
        path: '../outside.md',
      }),
    },
    fs: {
      existsSync: () => false,
      mkdirSync: (...args) => createdDirectories.push(args),
      writeFileSync: (...args) => writtenFiles.push(args),
    },
  });

  await dispatchUri('/vault', '../outside.md');

  assert.deepEqual(executeCommandCalls, []);
  assert.deepEqual(openTextDocumentCalls, []);
  assert.deepEqual(createdDirectories, []);
  assert.deepEqual(writtenFiles, []);
  assert.deepEqual(errorMessages, [
    'Cannot open link outside the workspace: ../outside.md',
  ]);
});

test('dispatchUri rejects relative code, asset, and PDF targets outside the workspace', async () => {
  for (const kind of ['code', 'image', 'text', 'unknown', 'pdf']) {
    const executeCommandCalls = [];
    const openTextDocumentCalls = [];
    const showTextDocumentCalls = [];
    const errorMessages = [];
    const path = `../../outside.${kind === 'pdf' ? 'pdf' : kind === 'code' ? 'ts' : 'txt'}`;
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls,
      showTextDocumentCalls,
      errorMessages,
      document: undefined,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: () => ({ kind, path }),
      },
      fs: { existsSync: () => true },
    });

    await dispatchUri('/vault', path);

    assert.deepEqual(executeCommandCalls, [], kind);
    assert.deepEqual(openTextDocumentCalls, [], kind);
    assert.deepEqual(showTextDocumentCalls, [], kind);
    assert.deepEqual(errorMessages, [
      `Cannot open link outside the workspace: ${path}`,
    ], kind);
  }
});

test('dispatchUri without a workspace allows only web and absolute PDF viewing', async () => {
  const executeCommandCalls = [];
  const openExternalCalls = [];
  const errorMessages = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    openExternalCalls,
    errorMessages,
    document: undefined,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@llm-wiki/core': {
      classifyReferenceTarget: uri => {
        if (uri.startsWith('https://')) return { kind: 'web', url: uri };
        if (uri.startsWith('/')) {
          return { kind: 'pdf', path: '/outside/read-only.pdf', page: 4 };
        }
        return { kind: 'note', path: uri };
      },
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri(undefined, '/outside/read-only.pdf#page=4');
  await dispatchUri(undefined, 'https://example.com/reference');
  await dispatchUri(undefined, 'notes/relative.md');

  assert.deepEqual(executeCommandCalls, [[
    'llm-wiki.openPdfTarget',
    { pdfPath: '/outside/read-only.pdf', page: 4 },
  ]]);
  assert.equal(openExternalCalls.length, 1);
  assert.equal(
    openExternalCalls[0][0].toString(),
    'https://example.com/reference',
  );
  assert.deepEqual(errorMessages, [
    'Open a workspace folder before opening this relative link: notes/relative.md',
  ]);
});

test('dispatchUri reveals note headings inside the LLM Wiki markdown editor after opening', async () => {
  const executeCommandCalls = [];
  const document = {
    uri: { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
    getText: () => '# Intro\n\n## Online Softmax\nBody\n',
    positionAt: offset => ({ line: offset, character: 0 }),
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@llm-wiki/core': {
      classifyReferenceTarget: () => ({
        kind: 'note',
        path: 'notes/Concepts/Online Softmax.md',
        heading: 'Online Softmax',
      }),
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri('/vault', 'notes/Concepts/Online Softmax.md#Online Softmax');

  assert.deepEqual(executeCommandCalls, [
    [
      'vscode.openWith',
      { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
      'llm-wiki.markdownEditor',
    ],
    [
      'llm-wiki.revealInMarkdownEditor',
      {
        uri: { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
        selection: { from: 9, to: 9 },
      },
    ],
  ]);
});

test('dispatchUri reveals Markdown line fragments as complete line ranges', async () => {
  const executeCommandCalls = [];
  const text = 'one\nsecond\nthird\nfourth\nfifth\nsixth';
  const lineStarts = [0, 4, 11, 17, 24, 30];
  const document = {
    uri: { fsPath: '/vault/notes/Concepts/Memory.md' },
    lineCount: lineStarts.length,
    getText: () => text,
    offsetAt: position => lineStarts[position.line] ?? text.length,
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@llm-wiki/core': {
      classifyReferenceTarget: () => ({
        kind: 'note',
        path: 'notes/Concepts/Memory.md',
        lines: { start: 4, end: 5 },
      }),
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri('/vault', 'notes/Concepts/Memory.md#L4-L5');

  assert.deepEqual(executeCommandCalls.at(-1), [
    'llm-wiki.revealInMarkdownEditor',
    {
      uri: { fsPath: '/vault/notes/Concepts/Memory.md' },
      selection: { from: 17, to: 30 },
    },
  ]);
});

test('dispatchUri reveals Obsidian block references inside markdown notes', async () => {
  const executeCommandCalls = [];
  const document = {
    uri: { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
    getText: () => '# Intro\n\nImportant fact ^fact123\nMore text\n',
    positionAt: offset => ({ line: offset, character: 0 }),
  };
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@llm-wiki/core': {
      classifyReferenceTarget: () => ({
        kind: 'note',
        path: 'notes/Concepts/Online Softmax.md',
        heading: '^fact123',
      }),
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri('/vault', 'notes/Concepts/Online Softmax.md#^fact123');

  assert.deepEqual(executeCommandCalls, [
    [
      'vscode.openWith',
      { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
      'llm-wiki.markdownEditor',
    ],
    [
      'llm-wiki.revealInMarkdownEditor',
      {
        uri: { fsPath: '/vault/notes/Concepts/Online Softmax.md' },
        selection: { from: 9, to: 9 },
      },
    ],
  ]);
});

test('dispatchUri transports portable PDF text fragments without database lookup', async () => {
  const textFragment = {
    textStart: 'selected text',
    textEnd: 'range end',
    prefix: 'before',
    suffix: 'after',
  };
  const uri = 'raw/pdf/paper.pdf#page=7:~:text=before-,selected%20text,range%20end,-after';

  for (const relativePath of ['src/uriDispatcher.ts']) {
    const executeCommandCalls = [];
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: {
        uri: { fsPath: '/vault/raw/pdf/paper.pdf' },
        getText: () => '',
        positionAt: () => ({ line: 0, character: 0 }),
      },
    });
    const { dispatchUri } = loadTsModule(relativePath, {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: () => ({
          kind: 'pdf',
          uri,
          path: 'raw/pdf/paper.pdf',
          page: 7,
          textFragment,
        }),
        openDatabase: () => { throw new Error('portable PDF dispatch must not open the database'); },
        closeDatabase: () => undefined,
        runMigrations: () => undefined,
        resolveWebTarget: () => undefined,
      },
      fs: { existsSync: () => true },
    });

    await dispatchUri('/vault', uri);

    assert.deepEqual(executeCommandCalls, [[
      'llm-wiki.openPdfTarget',
      {
        pdfPath: 'raw/pdf/paper.pdf',
        page: 7,
        textFragment,
      },
    ]], relativePath);
  }
});

test('dispatchUri unwraps LLM Wiki product links before opening an anchored PDF', async () => {
  const executeCommandCalls = [];
  const classifiedUris = [];
  const portableUri =
    'raw/pdf/ddia.pdf#page=25:~:text=The%20Internet%20was%20done%20so%20well';
  const productUri = productAnchorUri(portableUri);
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document: undefined,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@llm-wiki/core': {
      classifyReferenceTarget: uri => {
        classifiedUris.push(uri);
        return {
          kind: 'pdf',
          uri,
          path: 'raw/pdf/ddia.pdf',
          page: 25,
          textFragment: { textStart: 'The Internet was done so well' },
        };
      },
    },
  });

  await dispatchUri('/vault', productUri);

  assert.deepEqual(classifiedUris, [portableUri]);
  assert.deepEqual(executeCommandCalls, [[
    'llm-wiki.openPdfTarget',
    {
      pdfPath: 'raw/pdf/ddia.pdf',
      page: 25,
      textFragment: { textStart: 'The Internet was done so well' },
    },
  ]]);
});

test('dispatchUri prefers an explicit absolute note when a root-looking link also exists in the vault', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'llm-wiki-conflict-'));
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-conflict-vault-'));
  const executeCommandCalls = [];
  const errorMessages = [];
  try {
    // The link text below strips to this bundle-relative path, so both
    // interpretations name a file that really exists.
    const bundleRelative = relative('/', join(outside, 'guide.md'));
    mkdirSync(dirname(join(root, bundleRelative)), { recursive: true });
    writeFileSync(join(root, bundleRelative), '# Vault\n');
    writeFileSync(join(outside, 'guide.md'), '# Outside\n');

    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: undefined,
      errorMessages,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: uri => ({ kind: 'note', path: uri }),
      },
    });

    await dispatchUri(root, join(outside, 'guide.md'), { allowAbsoluteTargets: true });

    assert.deepEqual(executeCommandCalls, [[
      'vscode.openWith',
      { fsPath: join(outside, 'guide.md') },
      'llm-wiki.markdownEditor',
    ]]);
    assert.deepEqual(errorMessages, []);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatchUri opens an existing absolute Markdown target when the vault has no match', async () => {
  const outside = mkdtempSync(join(tmpdir(), 'llm-wiki-absolute-'));
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-absolute-vault-'));
  const executeCommandCalls = [];
  const errorMessages = [];
  try {
    mkdirSync(join(outside, 'playbook'), { recursive: true });
    mkdirSync(join(root, 'playbook'), { recursive: true });
    writeFileSync(join(outside, 'playbook', 'guide.md'), '# Outside\n');
    writeFileSync(join(root, 'playbook', 'guide.md'), '# Vault\n');

    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: undefined,
      errorMessages,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: uri => ({ kind: 'note', path: uri }),
      },
    });

    await dispatchUri(
      root,
      join(outside, 'playbook', 'guide.md'),
      { allowAbsoluteTargets: true },
    );

    assert.deepEqual(executeCommandCalls, [[
      'vscode.openWith',
      { fsPath: join(outside, 'playbook', 'guide.md') },
      'llm-wiki.markdownEditor',
    ]]);
    assert.deepEqual(errorMessages, []);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatchUri falls back to the vault when a root-looking target is absent on disk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-absolute-fallback-'));
  const executeCommandCalls = [];
  const errorMessages = [];
  try {
    mkdirSync(join(root, 'playbook'), { recursive: true });
    writeFileSync(join(root, 'playbook', 'guide.md'), '# Vault\n');

    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: undefined,
      errorMessages,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: uri => ({ kind: 'note', path: uri }),
      },
    });

    await dispatchUri(root, '/playbook/guide.md');

    assert.deepEqual(executeCommandCalls, [[
      'vscode.openWith',
      { fsPath: join(root, 'playbook', 'guide.md') },
      'llm-wiki.markdownEditor',
    ]]);
    assert.deepEqual(errorMessages, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatchUri creates a missing root-looking note only inside the vault', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-absolute-create-'));
  const executeCommandCalls = [];
  const errorMessages = [];
  try {
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: undefined,
      errorMessages,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: uri => ({ kind: 'note', path: uri }),
      },
    });

    await dispatchUri(root, '/playbook/new-note.md');

    assert.equal(existsSync(join(root, 'playbook', 'new-note.md')), true);
    assert.deepEqual(executeCommandCalls, [[
      'vscode.openWith',
      { fsPath: join(root, 'playbook', 'new-note.md') },
      'llm-wiki.markdownEditor',
    ]]);
    assert.deepEqual(errorMessages, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatchUri refuses a root-looking target that escapes the vault', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-absolute-escape-'));
  const executeCommandCalls = [];
  const errorMessages = [];
  try {
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: undefined,
      errorMessages,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: uri => ({ kind: 'note', path: uri }),
      },
    });

    // Absolute targets are permitted here, so this exercises the absolute branch
    // missing and proves the vault fallback still refuses to climb out.
    await dispatchUri(root, '/../llm-wiki-escaped.md', { allowAbsoluteTargets: true });

    assert.deepEqual(executeCommandCalls, []);
    assert.equal(errorMessages.length, 1);
    assert.match(errorMessages[0], /outside the workspace/i);
    assert.equal(existsSync(resolve(root, '..', 'llm-wiki-escaped.md')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dispatchUri leaves an absolute path alone when the caller has not opted in', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-absolute-optout-'));
  const outside = mkdtempSync(join(tmpdir(), 'llm-wiki-absolute-optout-outside-'));
  const executeCommandCalls = [];
  const errorMessages = [];
  try {
    const target = join(outside, 'guide.md');
    writeFileSync(target, '# Outside\n');

    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: undefined,
      errorMessages,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: uri => ({ kind: 'note', path: uri }),
      },
    });

    await dispatchUri(root, target);

    assert.equal(
      executeCommandCalls.some(([, opened]) => opened?.fsPath === target),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('dispatchUri keeps product deep links from reaching absolute filesystem paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-deep-link-vault-'));
  const outside = mkdtempSync(join(tmpdir(), 'llm-wiki-deep-link-secret-'));
  const executeCommandCalls = [];
  const errorMessages = [];
  try {
    const secret = join(outside, 'id_rsa');
    writeFileSync(secret, 'PRIVATE KEY\n');

    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: undefined,
      errorMessages,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: uri => ({ kind: 'unknown', path: uri, uri }),
      },
    });

    // The default: no caller opt-in, which is how the externally triggerable
    // product URI handler dispatches.
    await dispatchUri(root, productAnchorUri(secret));

    assert.equal(
      executeCommandCalls.some(([, target]) => target?.fsPath === secret),
      false,
    );
    assert.equal(errorMessages.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('dispatchUri reveals an exact Markdown range from either host product link', async () => {
  const text = 'one\nsecond\nthird\nfourth\nfifth\nsixth';
  const lineStarts = [0, 4, 11, 17, 24, 30];

  for (const scheme of ['cursor', 'vscode']) {
    const executeCommandCalls = [];
    const classifiedUris = [];
    const portableUri = 'notes/Concepts/Memory.md#L4-L5';
    const productUri = `${scheme}://llm-wiki.llm-wiki-vscode/open-anchor?target=`
      + `v1.${Buffer.from(portableUri, 'utf8').toString('base64url')}`;
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: {
        uri: { fsPath: '/vault/notes/Concepts/Memory.md' },
        lineCount: lineStarts.length,
        getText: () => text,
        offsetAt: position => lineStarts[position.line] ?? text.length,
      },
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: uri => {
          classifiedUris.push(uri);
          return {
            kind: 'note',
            path: 'notes/Concepts/Memory.md',
            lines: { start: 4, end: 5 },
          };
        },
      },
      fs: { existsSync: () => true },
    });

    await dispatchUri('/vault', productUri);

    assert.deepEqual(classifiedUris, [portableUri]);
    assert.deepEqual(executeCommandCalls.at(-1), [
      'llm-wiki.revealInMarkdownEditor',
      {
        uri: { fsPath: '/vault/notes/Concepts/Memory.md' },
        selection: { from: 17, to: 30 },
      },
    ]);
  }
});

test('dispatchUri opens local anchor bridge file links with their dedicated editor', async () => {
  const executeCommandCalls = [];
  const errorMessages = [];
  const anchorUri =
    'file:///vault/.llm_wiki/agent/exports/export-1/'
    + `source-${'a'.repeat(64)}.llm_wiki_anchor`;
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    document: undefined,
    errorMessages,
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@llm-wiki/core': {
      classifyReferenceTarget: uri => ({
        kind: 'unknown',
        uri,
        path: uri,
      }),
    },
  });

  await dispatchUri('/vault', anchorUri);

  assert.equal(executeCommandCalls.length, 1);
  assert.equal(executeCommandCalls[0][0], 'vscode.openWith');
  assert.equal(executeCommandCalls[0][1].toString(), anchorUri);
  assert.equal(executeCommandCalls[0][2], 'llm-wiki.anchorFile');
  assert.deepEqual(errorMessages, []);
});

test('trusted workspaces can open a final PDF file symlink without allowing symlinked directories', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-uri-pdf-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'llm-wiki-uri-pdf-outside-'));
  try {
    mkdirSync(join(root, 'raw', 'pdf'), { recursive: true });
    const outsidePdf = join(outside, 'paper.pdf');
    writeFileSync(outsidePdf, '%PDF-1.7\n');
    symlinkSync(outsidePdf, join(root, 'raw', 'pdf', 'paper.pdf'));
    symlinkSync(outside, join(root, 'linked-pdfs'), 'dir');

    const executeCommandCalls = [];
    const errorMessages = [];
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      errorMessages,
      document: undefined,
      workspaceTrusted: true,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: uri => ({
          kind: 'pdf',
          uri,
          path: uri.split('#')[0],
          page: 2,
        }),
      },
    });

    await dispatchUri(root, 'raw/pdf/paper.pdf#page=2');
    await dispatchUri(root, 'linked-pdfs/paper.pdf#page=2');

    assert.deepEqual(executeCommandCalls, [[
      'llm-wiki.openPdfTarget',
      { pdfPath: 'raw/pdf/paper.pdf', page: 2 },
    ]]);
    assert.deepEqual(errorMessages, [
      'Cannot open link outside the workspace: linked-pdfs/paper.pdf',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('untrusted workspaces reject final PDF file symlinks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-uri-pdf-untrusted-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'llm-wiki-uri-pdf-untrusted-outside-'));
  try {
    mkdirSync(join(root, 'raw', 'pdf'), { recursive: true });
    const outsidePdf = join(outside, 'paper.pdf');
    writeFileSync(outsidePdf, '%PDF-1.7\n');
    symlinkSync(outsidePdf, join(root, 'raw', 'pdf', 'paper.pdf'));

    const executeCommandCalls = [];
    const errorMessages = [];
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      errorMessages,
      document: undefined,
      workspaceTrusted: false,
    });
    const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: uri => ({
          kind: 'pdf',
          uri,
          path: 'raw/pdf/paper.pdf',
          page: 2,
        }),
      },
    });

    await dispatchUri(root, 'raw/pdf/paper.pdf#page=2');

    assert.deepEqual(executeCommandCalls, []);
    assert.deepEqual(errorMessages, [
      'Cannot open link outside the workspace: raw/pdf/paper.pdf',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('dispatchUri no longer resolves direct internal PDF anchor IDs', async () => {
  for (const relativePath of ['src/uriDispatcher.ts']) {
    const executeCommandCalls = [];
    const errorMessages = [];
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      errorMessages,
      document: {
        uri: { fsPath: '/vault/raw/pdf/paper.pdf' },
        getText: () => '',
        positionAt: () => ({ line: 0, character: 0 }),
      },
    });
    const { dispatchUri } = loadTsModule(relativePath, {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: uri => ({ kind: 'unknown', uri }),
        openDatabase: () => { throw new Error('direct anchor IDs must not open the database'); },
        closeDatabase: () => undefined,
        runMigrations: () => undefined,
        resolveWebTarget: () => undefined,
      },
      fs: { existsSync: () => false },
    });

    await dispatchUri('/vault', 'anc_pdf_123');

    assert.deepEqual(executeCommandCalls, [], relativePath);
    assert.deepEqual(errorMessages, ['Cannot open link target: anc_pdf_123'], relativePath);
  }
});

test('dispatchUri can route web targets into the LLM Wiki web browser instead of Chrome', async () => {
  const executeCommandCalls = [];
  const openExternalCalls = [];
  const openedWebTargets = [];
  const vscode = createVscodeMock({
    executeCommandCalls,
    openTextDocumentCalls: [],
    showTextDocumentCalls: [],
    openExternalCalls,
    document: {
      uri: { fsPath: '/vault/raw/web/vue-props.html' },
      getText: () => '',
      positionAt: () => ({ line: 0, character: 0 }),
    },
  });
  const { dispatchUri } = loadTsModule('src/uriDispatcher.ts', {
    vscode,
    '@llm-wiki/core': {
      classifyReferenceTarget: () => ({
        kind: 'web',
        url: 'https://vuejs.org/guide/components/props.html',
      }),
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      resolveWebTarget: () => undefined,
    },
    fs: { existsSync: () => true },
  });

  await dispatchUri('/vault', 'https://vuejs.org/guide/components/props.html', {
    openWebTarget: async url => {
      openedWebTargets.push(url);
    },
  });

  assert.deepEqual(openedWebTargets, ['https://vuejs.org/guide/components/props.html']);
  assert.deepEqual(openExternalCalls, []);
  assert.deepEqual(executeCommandCalls, []);
});

test('dispatchUri preserves absolute PDF paths in default-editor fallback', async () => {
  const textFragment = { textStart: 'selected text' };
  const pdfPath = '/external/papers/paper.pdf';

  for (const relativePath of ['src/uriDispatcher.ts']) {
    const executeCommandCalls = [];
    const vscode = createVscodeMock({
      executeCommandCalls,
      openTextDocumentCalls: [],
      showTextDocumentCalls: [],
      document: {
        uri: { fsPath: pdfPath },
        getText: () => '',
        positionAt: () => ({ line: 0, character: 0 }),
      },
      executeCommand: async (...args) => {
        executeCommandCalls.push(args);
        if (args[0] === 'llm-wiki.openPdfTarget') {
          throw new Error("command 'llm-wiki.openPdfTarget' not found");
        }
      },
    });
    const { dispatchUri } = loadTsModule(relativePath, {
      vscode,
      '@llm-wiki/core': {
        classifyReferenceTarget: () => ({
          kind: 'pdf',
          path: pdfPath,
          page: 7,
          textFragment,
        }),
        openDatabase: () => { throw new Error('absolute PDF fallback must not open a database'); },
        closeDatabase: () => undefined,
        runMigrations: () => undefined,
        resolveWebTarget: () => undefined,
      },
      fs: { existsSync: () => true },
    });

    await dispatchUri('/vault', `${pdfPath}#page=7:~:text=selected%20text`);

    assert.deepEqual(executeCommandCalls, [
      [
        'llm-wiki.openPdfTarget',
        { pdfPath, page: 7, textFragment },
      ],
      [
        'vscode.open',
        { fsPath: pdfPath },
      ],
    ], relativePath);
  }
});

function createVscodeMock({
  executeCommandCalls,
  openTextDocumentCalls,
  showTextDocumentCalls,
  document,
  executeCommand,
  openExternalCalls = [],
  errorMessages = [],
  workspaceTrusted = true,
}) {
  return {
    Uri: {
      file: fsPath => ({ fsPath }),
      parse: value => ({ toString: () => value }),
    },
    workspace: {
      isTrusted: workspaceTrusted,
      openTextDocument: async (...args) => {
        openTextDocumentCalls.push(args);
        return document;
      },
    },
    window: {
      showTextDocument: async (...args) => {
        showTextDocumentCalls.push(args);
        return {
          revealRange() {},
          selection: null,
        };
      },
      showErrorMessage: message => { errorMessages.push(message); },
    },
    env: {
      openExternal: async (...args) => {
        openExternalCalls.push(args);
        return true;
      },
    },
    commands: {
      executeCommand: executeCommand ?? (async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 0));
        executeCommandCalls.push(args);
        return undefined;
      }),
    },
    Range: class Range {
      constructor() {}
    },
    Selection: class Selection {
      constructor() {}
    },
    TextEditorRevealType: {
      AtTop: 0,
    },
    Position: class Position {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
  };
}
