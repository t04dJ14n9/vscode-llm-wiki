import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadResolver() {
  const filename = join(packageRoot, 'src/linkPreviewResolver.ts');
  if (!existsSync(filename)) return undefined;
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
  return mod.exports.resolveLinkPreviewTarget;
}

const resolveLinkPreviewTarget = loadResolver();

async function resolvePreview(input, fileSystem) {
  if (typeof resolveLinkPreviewTarget !== 'function') return undefined;
  return resolveLinkPreviewTarget(input, fileSystem);
}

function createWorkspace() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-link-preview-'));
  mkdirSync(join(workspaceRoot, 'notes'), { recursive: true });
  mkdirSync(join(workspaceRoot, 'raw'), { recursive: true });
  writeFileSync(join(workspaceRoot, 'notes', 'current.md'), '# Current\n');
  return workspaceRoot;
}

test('local Markdown and text previews stay bounded and resolve from the correct base', async (t) => {
  const workspaceRoot = createWorkspace();
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  writeFileSync(
    join(workspaceRoot, 'raw', 'source.md'),
    `# Source title\n\nEvidence starts here. ${'bounded evidence '.repeat(80)}`,
  );
  writeFileSync(join(workspaceRoot, 'raw', 'notes.txt'), 'Plain text evidence for the preview.');

  const markdown = await resolvePreview({
    workspaceRoot,
    documentPath: join(workspaceRoot, 'notes', 'current.md'),
    target: '../raw/source.md#Evidence',
    relativeToDocument: true,
  });
  const text = await resolvePreview({
    workspaceRoot,
    documentPath: join(workspaceRoot, 'notes', 'current.md'),
    target: 'raw/notes.txt',
    relativeToDocument: false,
  });

  assert.equal(markdown?.kind, 'markdown');
  assert.equal(markdown?.target, '../raw/source.md#Evidence');
  assert.equal(markdown?.title, 'Source title');
  assert.equal(markdown?.path, 'raw/source.md');
  assert.match(markdown?.excerpt ?? '', /Evidence starts here/);
  assert.ok((markdown?.excerpt?.length ?? 0) <= 480);
  assert.deepEqual(text, {
    kind: 'text',
    target: 'raw/notes.txt',
    title: 'notes.txt',
    path: 'raw/notes.txt',
    excerpt: 'Plain text evidence for the preview.',
  });
});

test('workspace traversal and symlinks outside the workspace are never read', async (t) => {
  const workspaceRoot = createWorkspace();
  const outsideRoot = mkdtempSync(join(tmpdir(), 'llm-wiki-link-preview-outside-'));
  t.after(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  });
  const outsideFile = join(outsideRoot, 'secret.md');
  writeFileSync(outsideFile, '# Secret\nMust not be read.');
  symlinkSync(outsideFile, join(workspaceRoot, 'raw', 'escaped.md'));
  const reads = [];
  const fileSystem = {
    realpath: async filePath => realpathSync(filePath),
    readText: async (filePath, maxBytes) => {
      reads.push(filePath);
      return readFileSync(filePath, 'utf8').slice(0, maxBytes);
    },
  };

  const traversal = await resolvePreview({
    workspaceRoot,
    documentPath: join(workspaceRoot, 'notes', 'current.md'),
    target: '../../secret.md',
    relativeToDocument: true,
  }, fileSystem);
  const symlink = await resolvePreview({
    workspaceRoot,
    documentPath: join(workspaceRoot, 'notes', 'current.md'),
    target: 'raw/escaped.md',
    relativeToDocument: false,
  }, fileSystem);

  assert.deepEqual(traversal, {
    kind: 'unavailable',
    target: '../../secret.md',
    title: '../../secret.md',
  });
  assert.deepEqual(symlink, {
    kind: 'unavailable',
    target: 'raw/escaped.md',
    title: 'raw/escaped.md',
  });
  assert.deepEqual(reads, []);
});

test('PDF and external previews return labels without reading files or fetching URLs', async () => {
  const reads = [];
  const fileSystem = {
    realpath: async filePath => filePath,
    readText: async filePath => {
      reads.push(filePath);
      return '';
    },
  };

  assert.deepEqual(await resolvePreview({
    workspaceRoot: '/vault',
    documentPath: '/vault/notes/current.md',
    target: 'raw/paper.pdf#page=7',
    relativeToDocument: false,
  }, fileSystem), {
    kind: 'pdf',
    target: 'raw/paper.pdf#page=7',
    title: 'paper.pdf — page 7',
    path: 'raw/paper.pdf',
    page: 7,
  });
  assert.deepEqual(await resolvePreview({
    workspaceRoot: '/vault',
    documentPath: '/vault/notes/current.md',
    target: 'https://example.com/paper',
    relativeToDocument: false,
  }, fileSystem), {
    kind: 'external',
    target: 'https://example.com/paper',
    title: 'https://example.com/paper',
  });
  assert.deepEqual(reads, []);
});

test('malformed preview targets are rejected before any filesystem access', async () => {
  const probed = [];
  const fileSystem = {
    realpath: async filePath => {
      probed.push(filePath);
      return filePath;
    },
    readText: async filePath => {
      probed.push(filePath);
      return '';
    },
  };

  for (const target of ['', 'bad\u0000target.md', '%E0%A4%A']) {
    assert.equal(await resolvePreview({
      workspaceRoot: '/vault',
      documentPath: '/vault/notes/current.md',
      target,
      relativeToDocument: true,
    }, fileSystem), null);
  }
  assert.deepEqual(probed, []);
});
