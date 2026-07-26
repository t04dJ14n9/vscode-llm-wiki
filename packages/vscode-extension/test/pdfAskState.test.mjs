import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateModulePath = resolve(
  packageRoot,
  '../pdf-editor/src/webview/domain/pdfAskState.ts',
);

function loadPdfAskState() {
  const source = readFileSync(stateModulePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: stateModulePath,
  });
  const mod = new Module(stateModulePath);
  mod.filename = stateModulePath;
  mod.paths = Module._nodeModulePaths(dirname(stateModulePath));
  mod._compile(outputText, stateModulePath);
  return mod.exports;
}

const state = loadPdfAskState();

function annotation(overrides = {}) {
  return {
    id: 'annotation-1',
    kind: 'agent_discussion',
    selectionKey: 'selection-1',
    anchor: {
      page: 3,
      quote: 'Selected text',
      prefix: 'Before',
      suffix: 'After',
      rects: [[10, 20, 30, 40]],
      textItemIndex: 2,
      charOffset: 4,
      endTextItemIndex: 5,
      endCharOffset: 7,
    },
    messages: [],
    lastTurn: { status: 'idle' },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  };
}

test('persisted Ask PDF state rejects hostile window, draft, and model values', () => {
  assert.deepEqual(state.normalizeAskPdfState(null), {});
  assert.deepEqual(state.normalizeAskPdfState('hostile'), {});

  assert.deepEqual(state.normalizeAskPdfWindows({
    valid: {
      left: -25,
      top: 10.5,
      width: 420,
      height: 510,
      detached: true,
      minimized: false,
    },
    missingGeometry: { left: 0, top: 0, width: 400 },
    infinite: { left: 0, top: 0, width: Infinity, height: 400 },
    strings: { left: '0', top: 0, width: 400, height: 400 },
    nullish: null,
  }), {
    valid: {
      left: -25,
      top: 10.5,
      width: 420,
      height: 510,
      detached: true,
      minimized: false,
    },
  });

  assert.deepEqual(state.normalizeAskPdfDrafts({
    kept: 'question',
    emptyAlsoKept: '',
    object: {},
    number: 4,
  }), {
    kept: 'question',
    emptyAlsoKept: '',
  });

  assert.deepEqual(state.normalizeAskPdfModelSelections({
    annotation: 'gpt-5',
    whitespace: '   ',
    empty: '',
    nonString: 42,
  }), {
    annotation: 'gpt-5',
  });
});

test('model normalization deduplicates model identifiers and preserves default metadata', () => {
  assert.deepEqual(state.normalizePdfDiscussionModels([
    {
      id: 'primary',
      model: 'gpt-5',
      displayName: '',
      description: 'Default model',
      isDefault: true,
    },
    {
      id: 'duplicate',
      model: 'gpt-5',
      displayName: 'Duplicate',
      description: 'Ignored',
      isDefault: false,
    },
    {
      id: 'secondary',
      model: 'gpt-5-mini',
      displayName: 'GPT-5 mini',
      description: 'Fast model',
      isDefault: false,
    },
    {
      id: 'invalid',
      model: '   ',
      displayName: 'Invalid',
      description: '',
      isDefault: false,
    },
    null,
  ]), [
    {
      id: 'primary',
      model: 'gpt-5',
      displayName: 'gpt-5',
      description: 'Default model',
      isDefault: true,
    },
    {
      id: 'secondary',
      model: 'gpt-5-mini',
      displayName: 'GPT-5 mini',
      description: 'Fast model',
      isDefault: false,
    },
  ]);

  assert.deepEqual(state.normalizePdfDiscussionModels({}), []);
});

test('rectangle validation retains only finite, positive-area PDF rectangles', () => {
  const valid = [10, 20, 30, 40];
  assert.deepEqual(state.validPdfRects([
    valid,
    [0, 0, 0, 10],
    [0, 0, 10, 0],
    [0, 0, Number.NaN, 10],
    [0, 0, 10],
    ['0', 0, 10, 10],
    null,
  ]), [valid]);
  assert.deepEqual(state.validPdfRects('not an array'), []);
});

test('annotation selection, ordering, and visual status preserve discussion semantics', () => {
  const selected = annotation();
  assert.deepEqual(state.selectionFromAnnotation(selected), {
    page: 3,
    snippet: 'Selected text',
    quote: 'Selected text',
    prefix: 'Before',
    suffix: 'After',
    rects: [[10, 20, 30, 40]],
    textItemIndex: 2,
    charOffset: 4,
    endTextItemIndex: 5,
    endCharOffset: 7,
  });

  const earlierPage = annotation({
    id: 'page-1',
    anchor: { ...selected.anchor, page: 1 },
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
  const recent = annotation({
    id: 'recent',
    updatedAt: '2026-07-04T00:00:00.000Z',
  });
  const older = annotation({
    id: 'older',
    updatedAt: '2026-07-03T00:00:00.000Z',
  });
  const input = [older, recent, earlierPage];
  assert.deepEqual(
    state.sortAnnotations(input).map(item => item.id),
    ['page-1', 'recent', 'older'],
  );
  assert.deepEqual(input.map(item => item.id), ['older', 'recent', 'page-1']);

  assert.equal(state.annotationHasAnswer(selected), false);
  assert.equal(state.annotationVisualStatus(selected, 'idle'), 'draft');
  assert.equal(state.annotationVisualStatus(selected, 'running'), 'running');
  assert.equal(state.annotationVisualStatus(selected, 'failed'), 'failed');
  assert.equal(state.annotationVisualStatus(selected, 'cancelled'), 'cancelled');

  const answered = annotation({
    messages: [{
      id: 'answer',
      role: 'assistant',
      markdown: 'Answer',
      createdAt: '2026-07-02T00:00:00.000Z',
    }],
  });
  assert.equal(state.annotationHasAnswer(answered), true);
  assert.equal(state.annotationVisualStatus(answered, 'idle'), 'answered');
  assert.equal(
    state.annotationVisualStatus(annotation({
      promotion: {
        threadId: 'thread-1',
        promotedAt: '2026-07-03T00:00:00.000Z',
      },
    }), 'failed'),
    'promoted',
  );
});

test('turn and window key helpers normalize persisted values', () => {
  assert.equal(state.normalizeTurnStatus('running'), 'running');
  assert.equal(state.normalizeTurnStatus('failed'), 'failed');
  assert.equal(state.normalizeTurnStatus('cancelled'), 'cancelled');
  assert.equal(state.normalizeTurnStatus('idle'), 'idle');
  assert.equal(state.normalizeTurnStatus('unknown'), 'idle');
  assert.equal(state.normalizeTurnStatus(null), 'idle');

  assert.equal(state.isTransientAskPdfWindowKey('draft:3'), true);
  assert.equal(state.isTransientAskPdfWindowKey('selection:key'), true);
  assert.equal(state.isTransientAskPdfWindowKey('annotation-id'), false);
  assert.equal(state.isTransientAskPdfWindowKey(undefined), false);
});

test('panel width clamping and base64 byte estimates match persisted UI behavior', () => {
  assert.equal(state.clampAskPdfPanelWidth(undefined), 380);
  assert.equal(state.clampAskPdfPanelWidth(Number.NaN), 380);
  assert.equal(state.clampAskPdfPanelWidth(100), 320);
  assert.equal(state.clampAskPdfPanelWidth(450.6), 451);
  assert.equal(state.clampAskPdfPanelWidth(900), 560);

  assert.equal(state.base64ByteLength(''), 0);
  assert.equal(state.base64ByteLength('Zg=='), 1);
  assert.equal(state.base64ByteLength('Zm8='), 2);
  assert.equal(state.base64ByteLength('Zm9v'), 3);
});
