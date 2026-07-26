import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const textLayerSource = join(packageRoot, '../pdf-editor/src/webview/pdfTextLayer.ts');

function compileTsModule(filename, mocks) {
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
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    mod._compile(outputText, filename);
  } finally {
    Module._load = originalLoad;
  }
  return mod.exports;
}

class FakeNode {
  static TEXT_NODE = 3;

  constructor(nodeType = 1) {
    this.nodeType = nodeType;
    this.parentElement = null;
  }
}

class FakeElement extends FakeNode {
  constructor(tagName) {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = '';
    this._textContent = '';
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map(child => child.textContent ?? '').join('');
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    this.children = [];
  }

  get innerHTML() {
    return '';
  }

  set innerHTML(_value) {
    this._textContent = '';
    this.children = [];
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  closest(selector) {
    if (
      selector === 'span[data-item-index]'
      && this.tagName === 'SPAN'
      && this.dataset.itemIndex !== undefined
    ) {
      return this;
    }
    return this.parentElement?.closest(selector) ?? null;
  }

  getBoundingClientRect() {
    const left = Number.parseFloat(this.style.left ?? '0') || 0;
    const top = Number.parseFloat(this.style.top ?? '0') || 0;
    const width = Number.parseFloat(this.style.width ?? '0') || 0;
    const height = Number.parseFloat(this.style.height ?? '0') || 0;
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    };
  }
}

class FakeTextNode extends FakeNode {
  constructor(text, parentElement) {
    super(FakeNode.TEXT_NODE);
    this.textContent = text;
    this.parentElement = parentElement;
  }
}

class FakeRange {
  selectNodeContents(node) {
    this.selectedNode = node;
  }

  setEnd(_node, offset) {
    this.endOffset = offset;
  }

  toString() {
    return 'x'.repeat(Math.max(0, this.endOffset ?? 0));
  }

  getBoundingClientRect() {
    const parentBounds = this.selectedNode?.parentElement?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
    };
    return {
      left: parentBounds.left + 2,
      top: parentBounds.top + 1,
      width: 20,
      height: 5,
      right: parentBounds.left + 22,
      bottom: parentBounds.top + 6,
    };
  }

  detach() {}
}

const originalDocument = globalThis.document;
const originalHTMLElement = globalThis.HTMLElement;
const originalNode = globalThis.Node;
globalThis.HTMLElement = FakeElement;
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: tagName => new FakeElement(tagName),
  createRange: () => new FakeRange(),
};

const pdfTextLayer = compileTsModule(textLayerSource, {
  './domain/pdfSelection': {
    pdfTextItemSelectionSeparator: (_items, itemIndex) => itemIndex === 0,
  },
  './domain/pdfTextExtraction': {
    isPdfWordJoinMarker: value => value === '\u00ad',
  },
  './pdfLayout': {
    formatCssPx: value => `${Math.round(value * 1000) / 1000}px`,
  },
});

test.after(() => {
  globalThis.document = originalDocument;
  globalThis.HTMLElement = originalHTMLElement;
  globalThis.Node = originalNode;
});

test('PDF text layer preserves source indexes while rendering aligned selectable spans', () => {
  const layer = new FakeElement('div');
  layer.appendChild(new FakeElement('old'));
  const items = [
    {
      content: 'Alpha',
      rect: { origin: { x: 10, y: 20 }, size: { width: 40, height: 10 } },
      font: { family: ' Example Serif ', size: 8, weight: 600, italic: true },
    },
    {
      content: '\u00ad',
      rect: { origin: { x: 50, y: 20 }, size: { width: 1, height: 10 } },
    },
    {
      content: 'Beta',
      rect: { origin: { x: 52, y: 20 }, size: { width: 30, height: 10 } },
    },
  ];

  pdfTextLayer.renderPdfTextLayer(layer, items, 2);

  assert.equal(layer.children.length, 3);
  const [first, separator, second] = layer.children;
  assert.equal(first.dataset.itemIndex, '0');
  assert.equal(first.dataset.contentLength, '5');
  assert.equal(first.style.left, '20px');
  assert.equal(first.style.top, '40px');
  assert.equal(first.style.width, '80px');
  assert.equal(first.style.height, '20px');

  const glyphs = first.children[0];
  assert.equal(glyphs.textContent, 'Alpha');
  assert.equal(glyphs.style.fontFamily, 'Example Serif');
  assert.equal(glyphs.style.fontSize, '16px');
  assert.equal(glyphs.style.fontWeight, '600');
  assert.equal(glyphs.style.fontStyle, 'italic');
  assert.equal(glyphs.style.transform, 'matrix(4, 0, 0, 4, -8, -4)');

  assert.equal(separator.className, 'pdf-text-selection-separator');
  assert.equal(separator.textContent, ' ');
  assert.equal(separator.style.left, '100px');
  assert.equal(second.dataset.itemIndex, '2');
  assert.equal(second.children[0].textContent, 'Beta');
});

test('PDF text layer maps descendant nodes to their indexed span and clamps offsets', () => {
  const span = new FakeElement('span');
  span.dataset.itemIndex = '7';
  span.dataset.contentLength = '5';
  const glyphs = new FakeElement('span');
  span.appendChild(glyphs);
  const text = new FakeTextNode('Alpha', glyphs);

  assert.equal(pdfTextLayer.closestPdfTextSpan(glyphs), span);
  assert.equal(pdfTextLayer.closestPdfTextSpan(text), span);
  assert.equal(pdfTextLayer.pdfTextOffset(text, 3, span), 3);
  assert.equal(pdfTextLayer.pdfTextOffset(text, 99, span), 5);
});
