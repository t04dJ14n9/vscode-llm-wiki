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

test('jump stack lists newest navigation first and deduplicates adjacent destinations', async () => {
  const vscode = createVscodeMock();
  const { NavigationHistoryProvider } = loadTsModule('src/navigationHistory.ts', { vscode });
  const provider = new NavigationHistoryProvider();

  provider.record({
    kind: 'markdown',
    label: 'FlashAttention',
    description: 'notes/FlashAttention.md',
    target: {
      kind: 'markdown',
      uri: 'file:///vault/notes/FlashAttention.md',
    },
  });
  provider.record({
    kind: 'pdf',
    label: 'paper.pdf p.7',
    description: 'raw/pdf/paper.pdf',
    target: {
      kind: 'pdf',
      pdfPath: 'raw/pdf/paper.pdf',
      page: 7,
      textFragment: {
        textStart: 'selected text',
        prefix: 'before',
        suffix: 'after',
      },
    },
  });
  provider.record({
    kind: 'pdf',
    label: 'paper.pdf p.7',
    description: 'raw/pdf/paper.pdf',
    target: {
      kind: 'pdf',
      pdfPath: 'raw/pdf/paper.pdf',
      page: 7,
      textFragment: {
        textStart: 'selected text',
        prefix: 'before',
        suffix: 'after',
      },
    },
  });

  const children = await provider.getChildren();

  assert.deepEqual(children.map(item => item.label), ['paper.pdf p.7', 'FlashAttention']);
  assert.equal(children[0].description, 'current');
  assert.equal(children[1].description, 'notes/FlashAttention.md');
  assert.equal(children[0].iconPath.id, 'file-pdf');
  assert.equal(children[1].iconPath.id, 'markdown');
  assert.equal(children[1].command.command, 'human-learning.retractToJump');
  assert.equal(provider.entries.length, 2);
});

test('jump stack retracts to any earlier entry and drops newer jumps', async () => {
  const vscode = createVscodeMock();
  const { NavigationHistoryProvider } = loadTsModule('src/navigationHistory.ts', { vscode });
  const provider = new NavigationHistoryProvider();
  const openedTargets = [];

  const markdown = provider.record({
    kind: 'markdown',
    label: 'FlashAttention',
    target: {
      kind: 'markdown',
      uri: 'file:///vault/notes/FlashAttention.md',
    },
  });
  provider.record({
    kind: 'web',
    label: 'Vue Props',
    target: {
      kind: 'web',
      url: 'https://vuejs.org/guide/components/props.html',
    },
  });
  provider.record({
    kind: 'pdf',
    label: 'paper.pdf p.7',
    target: {
      kind: 'pdf',
      pdfPath: 'raw/pdf/paper.pdf',
      page: 7,
      textFragment: {
        textStart: 'selected text',
        prefix: 'before',
        suffix: 'after',
      },
    },
  });

  const retracted = await provider.retractTo(markdown.id, async target => {
    openedTargets.push(target);
  });

  assert.equal(retracted, true);
  assert.deepEqual(openedTargets, [{
    kind: 'markdown',
    uri: 'file:///vault/notes/FlashAttention.md',
  }]);
  assert.deepEqual(provider.entries.map(entry => entry.label), ['FlashAttention']);
});

test('jump stack back opens the previous entry and suppresses duplicate recording during the retract', async () => {
  const vscode = createVscodeMock();
  const { NavigationHistoryProvider } = loadTsModule('src/navigationHistory.ts', { vscode });
  const provider = new NavigationHistoryProvider();
  const openedTargets = [];

  provider.record({
    kind: 'markdown',
    label: 'FlashAttention',
    target: {
      kind: 'markdown',
      uri: 'file:///vault/notes/FlashAttention.md',
    },
  });
  provider.record({
    kind: 'pdf',
    label: 'paper.pdf p.7',
    target: {
      kind: 'pdf',
      pdfPath: 'raw/pdf/paper.pdf',
      page: 7,
      textFragment: {
        textStart: 'selected text',
        prefix: 'before',
        suffix: 'after',
      },
    },
  });

  const wentBack = await provider.back(async target => {
    openedTargets.push(target);
    provider.record({
      kind: 'markdown',
      label: 'FlashAttention',
      target,
    });
  });

  assert.equal(wentBack, true);
  assert.deepEqual(openedTargets, [{
    kind: 'markdown',
    uri: 'file:///vault/notes/FlashAttention.md',
  }]);
  assert.deepEqual(provider.entries.map(entry => entry.label), ['FlashAttention']);
});

function createVscodeMock() {
  return {
    EventEmitter: class EventEmitter {
      constructor() {
        this.listeners = [];
        this.event = listener => {
          this.listeners.push(listener);
          return { dispose() {} };
        };
      }
      fire(event) {
        for (const listener of this.listeners) listener(event);
      }
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
  };
}
