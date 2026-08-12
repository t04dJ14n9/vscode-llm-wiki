import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadTsModule(relativePath, mocks = {}) {
  const filename = join(packageRoot, relativePath);
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
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
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    mod._compile(outputText, filename);
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

class TabInputCustom {
  constructor(uri, viewType) {
    this.uri = uri;
    this.viewType = viewType;
  }
}

function createUri(fsPath, overrides = {}) {
  return {
    scheme: 'file',
    authority: '',
    query: '',
    fragment: '',
    fsPath,
    toString: () => `file://${fsPath}`,
    ...overrides,
  };
}

function createHarness() {
  const registrations = [];
  const closes = [];
  const errors = [];
  const tabGroups = {
    all: [],
    close: async (...args) => {
      closes.push(args);
      return true;
    },
  };
  const vscode = {
    CancellationError: class CancellationError extends Error {},
    TabInputCustom,
    workspace: {
      isTrusted: true,
      getWorkspaceFolder: () => ({ uri: { fsPath: '/vault' } }),
    },
    window: {
      tabGroups,
      registerCustomEditorProvider: (...args) => {
        registrations.push(args);
        return { dispose() {} };
      },
      showErrorMessage: message => {
        errors.push(message);
      },
    },
  };
  const dispatchCalls = [];
  const dispatchUri = async (...args) => {
    dispatchCalls.push(args);
  };
  const core = {
    classifyReferenceTarget: value => {
      if (/^https?:/i.test(value)) return { kind: 'web', url: value };
      const path = value.split('#', 1)[0];
      if (/\.pdf$/i.test(path)) {
        return {
          kind: 'pdf',
          path,
          page: Number(/(?:^|&)page=(\d+)/.exec(value.split('#', 2)[1] ?? '')?.[1])
            || undefined,
        };
      }
      if (/\.md$/i.test(path)) return { kind: 'note', path };
      if (/\.(?:ts|py)$/i.test(path)) return { kind: 'code', path };
      if (/\.(?:png|jpg)$/i.test(path)) return { kind: 'image', path };
      if (/\.txt$/i.test(path)) return { kind: 'text', path };
      return { kind: 'unknown', path };
    },
  };
  const codec = loadTsModule('src/anchorFileCodec.ts', {
    '@llm-wiki/core': core,
  });
  const module = loadTsModule('src/anchorFileEditorProvider.ts', {
    vscode,
    './anchorFileCodec': codec,
    './uriDispatcher': { dispatchUri },
  });
  return {
    module,
    codec,
    vscode,
    tabGroups,
    registrations,
    closes,
    errors,
    dispatchCalls,
  };
}

test('shared anchor codec supports local code and safely bounds oversized targets', () => {
  const { codec } = createHarness();
  const code = codec.encodeAnchorFile('raw/code/example.ts#L3-L8', '/vault');
  assert.ok(code);
  assert.match(code.fileName, /^source-[a-f0-9]{64}\.llm_wiki_anchor$/);
  assert.deepEqual(JSON.parse(code.text), {
    version: 1,
    target: 'raw/code/example.ts#L3-L8',
  });

  const longPdf = codec.encodeAnchorFile(
    `raw/pdf/ddia.pdf#page=25:~:text=${'x'.repeat(codec.ANCHOR_FILE_MAX_TARGET_CHARS)}`,
    '/vault',
  );
  assert.ok(longPdf);
  assert.deepEqual(JSON.parse(longPdf.text), {
    version: 1,
    target: 'raw/pdf/ddia.pdf#page=25',
  });
  assert.equal(
    codec.encodeAnchorFile(
      `raw/code/example.ts#L1-${'9'.repeat(codec.ANCHOR_FILE_MAX_TARGET_CHARS)}`,
      '/vault',
    ),
    undefined,
  );
});

async function withTempDirectory(run) {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-anchor-provider-'));
  try {
    return await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeAnchorFile(root, payload, options = {}) {
  const bytes = options.bytes ?? Buffer.from(JSON.stringify(payload), 'utf8');
  const hash = options.hash
    ?? createHash('sha256').update(bytes).digest('hex');
  const directory = join(
    root,
    '.llm_wiki',
    'agent',
    'exports',
    options.exportId ?? '019fe660-3c41-7d43-9a0c-cd2b224cd5ed',
  );
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, `source-${hash}.llm_wiki_anchor`);
  writeFileSync(filePath, bytes);
  return { filePath, bytes, hash };
}

test('anchor payload parser accepts the exact v1 schema', () => {
  const { module } = createHarness();
  const payload = module.parseAnchorFilePayload(JSON.stringify({
    version: 1,
    target: 'raw/pdf/ddia.pdf#page=25:~:text=Alan%20Kay',
  }), '/vault');

  assert.deepEqual(payload, {
    version: 1,
    target: 'raw/pdf/ddia.pdf#page=25:~:text=Alan%20Kay',
  });
  assert.equal(Object.isFrozen(payload), true);
  assert.deepEqual(
    module.parseAnchorFilePayload(JSON.stringify({
      version: 1,
      target: 'notes/Concepts/Online Softmax.md#Online%20Version',
    }), '/vault'),
    {
      version: 1,
      target: 'notes/Concepts/Online Softmax.md#Online%20Version',
    },
  );
  assert.deepEqual(
    module.parseAnchorFilePayload(JSON.stringify({
      version: 1,
      target: 'raw/code/example.ts#L3-L8',
    }), '/vault'),
    {
      version: 1,
      target: 'raw/code/example.ts#L3-L8',
    },
  );
});

test('anchor payload parser rejects malformed, unsupported, padded, and control targets', () => {
  const { module } = createHarness();
  const invalidPayloads = [
    '{',
    '[]',
    JSON.stringify({ version: 2, target: 'raw/pdf/a.pdf' }),
    JSON.stringify({ version: 1, target: 'raw/pdf/a.pdf', extra: true }),
    JSON.stringify({ version: 1, target: '' }),
    JSON.stringify({ version: 1, target: ' raw/pdf/a.pdf' }),
    JSON.stringify({ version: 1, target: 'raw/pdf/a.pdf\n#page=1' }),
    JSON.stringify({ version: 1, target: 'raw/pdf/a\u202e.pdf' }),
    JSON.stringify({ version: 1, target: '\ud800' }),
    JSON.stringify({ version: 1, target: 'https://example.com/a.pdf' }),
    JSON.stringify({ version: 1, target: '/tmp/a.pdf#page=1' }),
    JSON.stringify({ version: 1, target: '../outside.pdf#page=1' }),
    JSON.stringify({ version: 1, target: 'raw/archive/example.bin' }),
    JSON.stringify({
      version: 1,
      target: 'x'.repeat(module.ANCHOR_FILE_MAX_TARGET_CHARS + 1),
    }),
  ];

  for (const value of invalidPayloads) {
    assert.throws(() => module.parseAnchorFilePayload(value, '/vault'), value);
  }
});

test('anchor file reader verifies trusted export placement, type, size, and hash', async () => {
  const harness = createHarness();
  const { module } = harness;
  await withTempDirectory(root => {
    const valid = writeAnchorFile(root, {
      version: 1,
      target: 'raw/pdf/ddia.pdf#page=25',
    });
    assert.deepEqual(module.readAnchorFilePayload(createUri(valid.filePath), root), {
      version: 1,
      target: 'raw/pdf/ddia.pdf#page=25',
    });

    assert.throws(
      () => module.readAnchorFilePayload(
        createUri(valid.filePath, { scheme: 'untitled' }),
        root,
      ),
      /local file URI/,
    );

    const outsidePath = join(root, 'source.llm_wiki_anchor');
    writeFileSync(outsidePath, valid.bytes);
    assert.throws(
      () => module.readAnchorFilePayload(createUri(outsidePath), root),
      /directly inside one export directory/,
    );

    const nestedPath = join(
      root,
      '.llm_wiki',
      'agent',
      'exports',
      'outer-export',
      'nested-export',
      `source-${valid.hash}.llm_wiki_anchor`,
    );
    mkdirSync(dirname(nestedPath), { recursive: true });
    writeFileSync(nestedPath, valid.bytes);
    assert.throws(
      () => module.readAnchorFilePayload(createUri(nestedPath), root),
      /directly inside one export directory/,
    );

    const uppercaseHashPath = join(
      root,
      '.llm_wiki',
      'agent',
      'exports',
      'uppercase-export',
      `source-${valid.hash.toUpperCase()}.llm_wiki_anchor`,
    );
    mkdirSync(dirname(uppercaseHashPath), { recursive: true });
    writeFileSync(uppercaseHashPath, valid.bytes);
    assert.throws(
      () => module.readAnchorFilePayload(createUri(uppercaseHashPath), root),
      /lowercase SHA-256 filename/,
    );

    const directoryPath = join(
      root,
      '.llm_wiki',
      'agent',
      'exports',
      'directory-export',
      `source-${'0'.repeat(64)}.llm_wiki_anchor`,
    );
    mkdirSync(dirname(directoryPath), { recursive: true });
    mkdirSync(directoryPath);
    assert.throws(
      () => module.readAnchorFilePayload(createUri(directoryPath), root),
      /invalid file type/,
    );

    const symlinkDirectory = join(
      root,
      '.llm_wiki',
      'agent',
      'exports',
      'symlink-export',
    );
    mkdirSync(symlinkDirectory, { recursive: true });
    const symlinkPath = join(
      symlinkDirectory,
      `source-${valid.hash}.llm_wiki_anchor`,
    );
    symlinkSync(valid.filePath, symlinkPath, 'file');
    assert.throws(
      () => module.readAnchorFilePayload(createUri(symlinkPath), root),
      /symbolic links/,
    );

    const actualExportDirectory = join(root, 'actual-export-directory');
    mkdirSync(actualExportDirectory);
    writeFileSync(
      join(actualExportDirectory, `source-${valid.hash}.llm_wiki_anchor`),
      valid.bytes,
    );
    const ancestorSymlink = join(
      root,
      '.llm_wiki',
      'agent',
      'exports',
      'ancestor-symlink',
    );
    symlinkSync(actualExportDirectory, ancestorSymlink, 'dir');
    assert.throws(
      () => module.readAnchorFilePayload(
        createUri(join(
          ancestorSymlink,
          `source-${valid.hash}.llm_wiki_anchor`,
        )),
        root,
      ),
      /symbolic links/,
    );

    const oversized = writeAnchorFile(
      root,
      {},
      {
        bytes: Buffer.alloc(module.ANCHOR_FILE_MAX_BYTES + 1, 0x20),
        exportId: 'oversized-export',
      },
    );
    assert.throws(
      () => module.readAnchorFilePayload(createUri(oversized.filePath), root),
      /too large/,
    );

    const mismatched = writeAnchorFile(
      root,
      {
        version: 1,
        target: 'raw/pdf/ddia.pdf#page=25',
      },
      {
        hash: '0'.repeat(64),
        exportId: 'mismatched-export',
      },
    );
    assert.throws(
      () => module.readAnchorFilePayload(createUri(mismatched.filePath), root),
      /does not match its SHA-256 filename/,
    );

    harness.vscode.workspace.isTrusted = false;
    assert.throws(
      () => module.readAnchorFilePayload(createUri(valid.filePath), root),
      /trusted workspace/,
    );
  });
});

test('readonly provider dispatches, renders scriptless status, and closes its precise tab', async () => {
  const harness = createHarness();
  await withTempDirectory(async root => {
    const target = 'raw/pdf/ddia.pdf#page=25:~:text=Alan%20Kay';
    const anchor = writeAnchorFile(root, { version: 1, target });
    const uri = createUri(anchor.filePath);
    const dispatches = [];
    const provider = new harness.module.AnchorFileEditorProvider({
      resolveVaultRoot: () => root,
      dispatchTarget: async (_vaultRoot, value) => {
        dispatches.push(value);
      },
    });
    const document = await provider.openCustomDocument(
      uri,
      {},
      { isCancellationRequested: false },
    );
    const ownTab = {
      input: new TabInputCustom(uri, harness.module.ANCHOR_FILE_VIEW_TYPE),
    };
    const unrelatedTab = {
      input: new TabInputCustom(
        createUri(join(root, 'other.llm_wiki_anchor')),
        harness.module.ANCHOR_FILE_VIEW_TYPE,
      ),
    };
    harness.tabGroups.all = [{ tabs: [unrelatedTab, ownTab] }];
    const panel = { webview: { options: undefined, html: '' } };

    await provider.resolveCustomEditor(
      document,
      panel,
      { isCancellationRequested: false },
    );

    assert.deepEqual(dispatches, [target]);
    assert.deepEqual(panel.webview.options, {
      enableScripts: false,
      localResourceRoots: [],
    });
    assert.match(panel.webview.html, /default-src 'none'/);
    assert.match(panel.webview.html, /Linked passage opened/);
    assert.doesNotMatch(panel.webview.html, /<script|<style/i);
    assert.doesNotMatch(panel.webview.html, /Alan%20Kay/);
    assert.deepEqual(harness.closes, [[ownTab, true]]);
    assert.deepEqual(harness.errors, []);
  });
});

test('readonly provider resolves the workspace folder that owns each anchor file', async () => {
  const harness = createHarness();
  await withTempDirectory(async firstRoot => {
    await withTempDirectory(async secondRoot => {
      const target = 'raw/pdf/ddia.pdf#page=25';
      const anchor = writeAnchorFile(secondRoot, { version: 1, target });
      const uri = createUri(anchor.filePath);
      const dispatches = [];
      const provider = new harness.module.AnchorFileEditorProvider({
        resolveVaultRoot: candidate =>
          candidate.fsPath.startsWith(secondRoot) ? secondRoot : firstRoot,
        dispatchTarget: async (...args) => {
          dispatches.push(args);
        },
        closeAfterDispatch: false,
      });

      const document = await provider.openCustomDocument(
        uri,
        {},
        { isCancellationRequested: false },
      );
      await provider.resolveCustomEditor(
        document,
        { webview: { options: undefined, html: '' } },
        { isCancellationRequested: false },
      );

      assert.equal(document.vaultRoot, resolve(secondRoot));
      assert.deepEqual(dispatches, [[resolve(secondRoot), target]]);
    });
  });
});

test('readonly provider keeps a safe error surface and does not close after dispatch failure', async () => {
  const harness = createHarness();
  const uri = createUri('/vault/failure.llm_wiki_anchor');
  const provider = new harness.module.AnchorFileEditorProvider({
    resolveVaultRoot: () => '/vault',
    dispatchTarget: async () => {
      throw new Error('<unsafe failure>');
    },
  });
  const panel = { webview: { options: undefined, html: '' } };

  await provider.resolveCustomEditor(
    new harness.module.AnchorFileDocument(uri, '/vault', 1, 'raw/pdf/failure.pdf'),
    panel,
    { isCancellationRequested: false },
  );

  assert.match(panel.webview.html, /Could not open linked passage/);
  assert.match(panel.webview.html, /&lt;unsafe failure&gt;/);
  assert.doesNotMatch(panel.webview.html, /<unsafe failure>/);
  assert.deepEqual(harness.closes, []);
  assert.deepEqual(harness.errors, [
    'LLM Wiki could not open this anchor: <unsafe failure>',
  ]);
});

test('registration exposes a stable readonly custom-editor hook and dispatchUri fallback', async () => {
  const harness = createHarness();
  const context = { subscriptions: [] };
  const provider = harness.module.registerAnchorFileEditorProvider(context, {
    closeAfterDispatch: false,
  });

  assert.equal(context.subscriptions.length, 1);
  assert.equal(harness.registrations.length, 1);
  assert.equal(
    harness.registrations[0][0],
    harness.module.ANCHOR_FILE_VIEW_TYPE,
  );
  assert.equal(harness.registrations[0][1], provider);
  assert.deepEqual(harness.registrations[0][2], {
    webviewOptions: { retainContextWhenHidden: false },
    supportsMultipleEditorsPerDocument: false,
  });

  await provider.resolveCustomEditor(
    new harness.module.AnchorFileDocument(
      createUri('/vault/passage.llm_wiki_anchor'),
      '/vault',
      1,
      'raw/pdf/ddia.pdf#page=25',
    ),
    { webview: { options: undefined, html: '' } },
    { isCancellationRequested: false },
  );
  assert.deepEqual(harness.dispatchCalls, [[
    '/vault',
    'raw/pdf/ddia.pdf#page=25',
  ]]);
});
