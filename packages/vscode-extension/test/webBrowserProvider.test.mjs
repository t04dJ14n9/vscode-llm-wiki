import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadTsModule(relativePath, mocks = {}) {
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
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
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

test('web browser provider persists the current page and inserts the markdown link', async () => {
  const postedMessages = [];
  const insertedMarkdown = [];
  const panels = [];
  let receiveMessage;
  const vscode = createVscodeMock({
    postedMessages,
    panels,
    onMessage: handler => {
      receiveMessage = handler;
    },
  });
  const persistCalls = [];

  const { WebBrowserProvider } = loadTsModule('src/webBrowserProvider.ts', {
    vscode,
    '@human-learning/core': {
      openDatabase: async () => ({}),
      closeDatabase: () => undefined,
      runMigrations: () => undefined,
      persistWebPageSnapshot: (_db, vaultRoot, input) => {
        persistCalls.push({ vaultRoot, input });
        return {
          status: 'ok',
          persistedPath: 'raw/web/example-abc123.html',
          source: { id: 'src_web', path: 'raw/web/example-abc123.html', kind: 'html', sha256: 'sha' },
          target: { id: 'web_abc123', url: input.url, title: input.title, selected_text: null },
          anchor: { id: 'anc_web_abc123', kind: 'dom_range' },
          href: `${input.url}#hl-web=web_abc123`,
          markdownLink: `[${input.title}](${input.url}#hl-web=web_abc123)`,
          quoteMarkdown: `[${input.title}](${input.url}#hl-web=web_abc123)`,
        };
      },
    },
  });

  const provider = new WebBrowserProvider(
    { extensionUri: createUri('/extension') },
    '/vault',
    {
      insertMarkdown: async markdown => {
        insertedMarkdown.push(markdown);
        return true;
      },
    },
  );

  provider.open('https://example.com/article');
  assert.equal(typeof receiveMessage, 'function');

  await receiveMessage({
    type: 'persistWebPage',
    url: 'https://example.com/article',
    title: 'Example Article',
    html: '<html><title>Example Article</title><body>Article</body></html>',
    action: 'insertLink',
  });

  assert.equal(persistCalls.length, 1);
  assert.equal(persistCalls[0].vaultRoot, '/vault');
  assert.equal(persistCalls[0].input.url, 'https://example.com/article');
  assert.equal(persistCalls[0].input.title, 'Example Article');
  assert.equal(
    persistCalls[0].input.html,
    '<html><title>Example Article</title><body>Article</body></html>',
  );
  assert.deepEqual(insertedMarkdown, [
    '[Example Article](https://example.com/article#hl-web=web_abc123)',
  ]);
  assert.deepEqual(postedMessages.at(-1), {
    type: 'persistedWebPage',
    href: 'https://example.com/article#hl-web=web_abc123',
    markdown: '[Example Article](https://example.com/article#hl-web=web_abc123)',
    persistedPath: 'raw/web/example-abc123.html',
  });
});

test('web browser provider renders fetched pages into a local web surface with a reader copy', async () => {
  const postedMessages = [];
  const panels = [];
  let receiveMessage;
  const vscode = createVscodeMock({
    postedMessages,
    panels,
    onMessage: handler => {
      receiveMessage = handler;
    },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => '<!doctype html><html><head><title>Props | Vue.js</title></head><body><main><h1>Props</h1><p>Props declaration paragraph.</p><script>danger()</script></main></body></html>',
  });

  try {
    const { WebBrowserProvider } = loadTsModule('src/webBrowserProvider.ts', {
      vscode,
      '@human-learning/core': {
        openDatabase: async () => ({}),
        closeDatabase: () => undefined,
        runMigrations: () => undefined,
        persistWebPageSnapshot: () => {
          throw new Error('not used');
        },
      },
    });

    const provider = new WebBrowserProvider({ extensionUri: createUri('/extension') }, '/vault');
    provider.open('https://vuejs.org/guide/components/props.html');

    assert.equal(typeof receiveMessage, 'function');
    assert.equal(panels.length, 1);
    assert.match(panels[0].webview.html, /id="web"/);
    assert.match(panels[0].webview.html, /id="page"/);
    assert.match(panels[0].webview.html, /function renderWebPage/);
    assert.match(panels[0].webview.html, /function sanitizeWebPage/);
    assert.match(panels[0].webview.html, /function readableRootFor/);
    assert.match(panels[0].webview.html, /querySelectorAll\('script, iframe, object, embed/);
    assert.match(panels[0].webview.html, /main \.vt-doc/);
    assert.doesNotMatch(panels[0].webview.html, /<iframe id="live"/);
    assert.doesNotMatch(panels[0].webview.html, /live\.src = currentUrl/);

    await receiveMessage({
      type: 'loadWebPage',
      url: 'https://vuejs.org/guide/components/props.html',
    });

    assert.deepEqual(postedMessages.at(-1), {
      type: 'loadedWebPage',
      url: 'https://vuejs.org/guide/components/props.html',
      title: 'Props | Vue.js',
      html: '<!doctype html><html><head><title>Props | Vue.js</title></head><body><main><h1>Props</h1><p>Props declaration paragraph.</p><script>danger()</script></main></body></html>',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createVscodeMock({ postedMessages, panels = [], onMessage }) {
  return {
    ViewColumn: {
      Beside: 2,
    },
    Uri: {
      joinPath: (...parts) => createUri(parts.map(part => part.fsPath ?? part.path ?? String(part)).join('/')),
      parse: value => ({ toString: () => value }),
    },
    window: {
      createWebviewPanel: () => {
        const panel = {
        webview: {
          options: undefined,
          html: '',
          asWebviewUri: uri => ({ toString: () => `webview://${uri.fsPath}` }),
          onDidReceiveMessage: onMessage,
          postMessage: async message => {
            postedMessages.push(message);
            return true;
          },
        },
        reveal() {},
        onDidDispose() {},
        };
        panels.push(panel);
        return panel;
      },
      showInformationMessage: () => undefined,
      showWarningMessage: () => undefined,
      showErrorMessage: () => undefined,
    },
    env: {
      clipboard: {
        writeText: async () => undefined,
      },
    },
  };
}

function createUri(fsPath) {
  return {
    fsPath,
    path: fsPath,
    scheme: 'file',
    toString: () => `file://${fsPath}`,
  };
}
