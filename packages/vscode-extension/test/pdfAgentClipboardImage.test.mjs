import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadTsModule(relativePath) {
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
  mod._compile(outputText, filename);
  return mod.exports;
}

test('persists a content-addressed PDF crop in the workspace agent cache', () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-agent-clipboard-'));
  const { persistPdfAgentClipboardImage } = loadTsModule(
    'src/pdfAgentClipboardImage.ts',
  );

  const result = persistPdfAgentClipboardImage({
    rootPath: root,
    sourceIdentity: 'file:///vault/raw/paper.pdf',
    selectionKey: 'selection-key',
    bytes: Buffer.from('validated png bytes'),
  });

  assert.match(
    result.relativePath,
    /^\.llm_wiki\/agent\/clipboard\/pdf-selection-[a-f0-9]{64}\.png$/,
  );
  assert.equal(
    result.absolutePath,
    join(realpathSync(root), ...result.relativePath.split('/')),
  );
  assert.deepEqual(readFileSync(result.absolutePath), Buffer.from('validated png bytes'));
  assert.equal(lstatSync(result.absolutePath).isFile(), true);
});

test('never follows a symlinked PDF crop cache directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-agent-clipboard-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'llm-wiki-agent-clipboard-outside-'));
  const { persistPdfAgentClipboardImage } = loadTsModule(
    'src/pdfAgentClipboardImage.ts',
  );
  symlinkSync(outside, join(root, '.llm_wiki'));

  assert.throws(
    () => persistPdfAgentClipboardImage({
      rootPath: root,
      sourceIdentity: 'file:///vault/raw/paper.pdf',
      selectionKey: 'selection-key',
      bytes: Buffer.from('validated png bytes'),
    }),
    /unsafe/i,
  );
  assert.equal(existsSync(join(outside, 'agent', 'clipboard')), false);
});

test('bounds the workspace PDF crop cache while retaining the current image', () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-wiki-agent-clipboard-bounded-'));
  const { persistPdfAgentClipboardImage } = loadTsModule(
    'src/pdfAgentClipboardImage.ts',
  );
  let current;
  for (let index = 0; index < 20; index++) {
    current = persistPdfAgentClipboardImage({
      rootPath: root,
      sourceIdentity: 'file:///vault/raw/paper.pdf',
      selectionKey: `selection-${index}`,
      bytes: Buffer.from(`validated png bytes ${index}`),
    });
  }

  const cachePath = join(root, '.llm_wiki', 'agent', 'clipboard');
  const files = readdirSync(cachePath)
    .filter(name => /^pdf-selection-[a-f0-9]{64}\.png$/.test(name));
  assert.equal(files.length, 16);
  assert.equal(existsSync(current.absolutePath), true);
});
