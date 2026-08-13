import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const filesystemWiki = loadTsModule('src/filesystemWiki.ts');

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

test('filesystem wiki resolves Markdown links, wikilinks, headings, and graph edges', () => {
  const wiki = filesystemWiki.createFilesystemWiki([
    {
      path: 'Home.md',
      text: [
        '# Home',
        '[Stable algorithm](Concepts/Online%20Softmax.md#Stable-softmax)',
        '[[Concepts/Online Softmax#Stable Softmax|Softmax concept]]',
        '[Missing heading](Concepts/Online%20Softmax.md#Nope)',
        '[[Missing Note]]',
        '[Website](https://example.com)',
        '`[[Ignored Code Link]]`',
      ].join('\n'),
    },
    {
      path: 'Concepts/Online Softmax.md',
      text: '# Online Softmax\n\n## Stable Softmax\n\nDetails.',
    },
  ]);

  const forward = filesystemWiki.getForwardLinks(wiki, 'Home.md');
  const backlinks = filesystemWiki.getBacklinks(wiki, 'Concepts/Online Softmax.md');
  const broken = filesystemWiki.getBrokenLinks(wiki);
  const graph = filesystemWiki.getConceptGraph(wiki);

  assert.equal(forward.length, 5);
  assert.equal(backlinks.length, 3);
  assert.equal(forward[0].targetPath, 'Concepts/Online Softmax.md');
  assert.equal(forward[0].headingExists, true);
  assert.deepEqual(
    broken.map(issue => issue.reason),
    ['missing-heading', 'missing-note'],
  );
  assert.deepEqual(
    graph.nodes.map(node => [node.id, node.label]),
    [
      ['Concepts/Online Softmax.md', 'Online Softmax'],
      ['Home.md', 'Home'],
    ],
  );
  assert.deepEqual(graph.edges, [{
    id: 'Home.md->Concepts/Online Softmax.md',
    source: 'Home.md',
    target: 'Concepts/Online Softmax.md',
    count: 2,
    labels: ['Softmax concept', 'Stable algorithm'],
  }]);
});

test('filesystem wiki resolves basename wikilinks to the closest note', () => {
  const wiki = filesystemWiki.createFilesystemWiki([
    { path: 'Areas/AI/Overview.md', text: 'See [[Attention]].' },
    { path: 'Areas/AI/Attention.md', text: '# Local Attention' },
    { path: 'Archive/Attention.md', text: '# Archived Attention' },
  ]);

  const [link] = filesystemWiki.getForwardLinks(wiki, 'Areas/AI/Overview.md');

  assert.equal(link.targetPath, 'Areas/AI/Attention.md');
  assert.equal(link.resolved, true);
});

test('filesystem wiki resolves OKF concept IDs and directory indexes', () => {
  const wiki = filesystemWiki.createFilesystemWiki([
    {
      path: 'index.md',
      text: [
        '# Home',
        '[Concepts](concepts/)',
        '[Tokenization](/concepts/tokenization)',
      ].join('\n'),
    },
    {
      path: 'concepts/index.md',
      text: '# Concepts',
    },
    {
      path: 'concepts.md',
      text: '# Concepts note',
    },
    {
      path: 'concepts/tokenization.md',
      text: '# Tokenization',
    },
  ]);

  const forward = filesystemWiki.getForwardLinks(wiki, 'index.md');
  const graph = filesystemWiki.getConceptGraph(wiki);

  assert.deepEqual(
    forward.map(link => [link.targetPath, link.resolved]),
    [
      ['concepts/index.md', true],
      ['concepts/tokenization.md', true],
    ],
  );
  assert.deepEqual(
    graph.edges.map(edge => [edge.source, edge.target]),
    [
      ['index.md', 'concepts/index.md'],
      ['index.md', 'concepts/tokenization.md'],
    ],
  );
});

test('filesystem scan recursively excludes generated and private directories', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-wiki-'));
  try {
    writeMarkdown(root, 'README.md', '# Root');
    writeMarkdown(root, 'notes/Included.md', '# Included');
    for (const excluded of ['.git', '.llm_wiki', 'dist', 'node_modules', 'out']) {
      writeMarkdown(root, `${excluded}/Ignored.md`, '# Ignore me');
    }

    const wiki = await filesystemWiki.loadFilesystemWiki(root);

    assert.deepEqual(
      wiki.documents.map(document => document.path),
      ['notes/Included.md', 'README.md'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('backlinks provider reads the active custom markdown tab when no text editor is active', async () => {
  const activeTabUri = fileUri('/vault/notes/Concepts/Online Softmax.md');
  const wiki = filesystemWiki.createFilesystemWiki([
    {
      path: 'notes/Concepts/Online Softmax.md',
      text: '# Online Softmax',
    },
    {
      path: 'notes/Concepts/FlashAttention.md',
      text: '# FlashAttention\n\nSee [[Online Softmax]].',
    },
  ]);
  const vscode = createVscodeMock({ activeTabUri });
  const { BacklinksProvider } = loadBacklinksProvider(vscode, wiki);
  const provider = new BacklinksProvider('/vault', 'backlinks');

  const children = await provider.getChildren();

  assert.equal(children.length, 1);
  assert.equal(children[0].label, 'notes/Concepts/FlashAttention.md:3');
  assert.equal(children[0].description, 'Online Softmax');
  assert.equal(children[0].tooltip, 'notes/Concepts/Online Softmax.md');
  assert.deepEqual(children[0].command.arguments, ['notes/Concepts/FlashAttention.md']);
});

test('forward links provider reads the active custom markdown tab when no text editor is active', async () => {
  const activeTabUri = fileUri('/vault/notes/Concepts/FlashAttention.md');
  const wiki = filesystemWiki.createFilesystemWiki([
    {
      path: 'notes/Concepts/FlashAttention.md',
      text: '# FlashAttention\n\nSee [Online Softmax](./Online%20Softmax.md).',
    },
    {
      path: 'notes/Concepts/Online Softmax.md',
      text: '# Online Softmax',
    },
  ]);
  const vscode = createVscodeMock({ activeTabUri });
  const { BacklinksProvider } = loadBacklinksProvider(vscode, wiki);
  const provider = new BacklinksProvider('/vault', 'forward');

  const children = await provider.getChildren();

  assert.equal(children.length, 1);
  assert.equal(children[0].label, 'Online Softmax');
  assert.equal(children[0].description, 'line 3');
  assert.equal(children[0].tooltip, 'notes/Concepts/Online Softmax.md');
  assert.deepEqual(children[0].command.arguments, ['notes/Concepts/Online Softmax.md']);
});

test('forward links provider falls back to decoded target note title', () => {
  const { formatForwardLinkLabel } = loadBacklinksProvider(createVscodeMock(), {
    documents: [],
    links: [],
  });

  assert.equal(
    formatForwardLinkLabel({
      line: 12,
      href: 'notes/Papers/FlashAttention%20Paper.md#Algorithm',
      label: '',
    }),
    'FlashAttention Paper',
  );
});

function loadBacklinksProvider(vscode, wiki) {
  return loadTsModule('src/backlinksProvider.ts', {
    vscode,
    './filesystemWiki': {
      ...filesystemWiki,
      loadFilesystemWiki: async () => wiki,
    },
  });
}

function writeMarkdown(root, relativePath, text) {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, text);
}

function fileUri(fsPath) {
  return {
    scheme: 'file',
    fsPath,
    toString: () => `file://${encodeURI(fsPath)}`,
  };
}

function createVscodeMock({ activeTabUri } = {}) {
  return {
    EventEmitter: class EventEmitter {
      constructor() {
        this.event = () => ({ dispose() {} });
      }
      fire() {}
    },
    ThemeIcon: class ThemeIcon {
      constructor(id) {
        this.id = id;
      }
    },
    TreeItem: class TreeItem {
      constructor(label, collapsibleState) {
        this.label = label;
        this.collapsibleState = collapsibleState;
      }
    },
    TreeItemCollapsibleState: {
      None: 0,
    },
    workspace: {},
    window: {
      activeTextEditor: undefined,
      tabGroups: {
        activeTabGroup: {
          activeTab: activeTabUri ? { input: { uri: activeTabUri } } : undefined,
        },
      },
    },
  };
}
