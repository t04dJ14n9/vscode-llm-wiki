import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadResolver() {
  const filename = join(packageRoot, 'src/localLinkTargetResolver.ts');
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
  return mod.exports.resolveLocalLinkTarget;
}

const resolveLocalLinkTarget = loadResolver();

function probeFor(existing = [], directories = []) {
  const files = new Set(existing);
  const dirs = new Set(directories);
  return {
    exists: path => files.has(path) || dirs.has(path),
    isDirectory: path => dirs.has(path),
  };
}

const ABSOLUTE_ALLOWED = { allowAbsoluteTargets: true };

test('an opted-in absolute file wins over a same-named vault file', () => {
  const probe = probeFor(['/playbook/guide.md', '/vault/playbook/guide.md']);

  assert.deepEqual(
    resolveLocalLinkTarget('/vault', '/playbook/guide.md', probe, ABSOLUTE_ALLOWED),
    { uri: '/playbook/guide.md', origin: 'absolute' },
  );
});

test('an existing absolute file resolves when the vault has no match', () => {
  const probe = probeFor(['/playbook/guide.md']);

  assert.deepEqual(
    resolveLocalLinkTarget('/vault', '/playbook/guide.md', probe, ABSOLUTE_ALLOWED),
    { uri: '/playbook/guide.md', origin: 'absolute' },
  );
});

test('absolute targets are refused unless the caller opts in', () => {
  const probe = probeFor(['/playbook/guide.md']);
  // No vault copy exists, so only the opt-in decides whether the real file wins.

  assert.deepEqual(
    resolveLocalLinkTarget('/vault', '/playbook/guide.md', probe),
    { uri: 'playbook/guide.md', origin: 'vault' },
  );
  assert.deepEqual(
    resolveLocalLinkTarget('/vault', '/playbook/guide.md', probe, { allowAbsoluteTargets: false }),
    { uri: 'playbook/guide.md', origin: 'vault' },
  );
});

test('a UNC path is never probed even when absolute targets are allowed', () => {
  const probed = [];
  const probe = {
    exists: path => {
      probed.push(path);
      return true;
    },
    isDirectory: () => false,
  };

  const resolved = resolveLocalLinkTarget(
    '/vault',
    '//attacker/share/payload.md',
    probe,
    ABSOLUTE_ALLOWED,
  );

  assert.equal(resolved.origin, 'vault');
  assert.equal(probed.some(path => path.startsWith('//') || path.startsWith('\\\\')), false);
});

test('a root-looking target keeps its fragment and query when it resolves absolutely', () => {
  const probe = probeFor(['/playbook/guide.md']);

  assert.deepEqual(
    resolveLocalLinkTarget('/vault', '/playbook/guide.md#L4-L9', probe, ABSOLUTE_ALLOWED),
    { uri: '/playbook/guide.md#L4-L9', origin: 'absolute' },
  );
});

test('a missing absolute target falls back under the vault root', () => {
  const probe = probeFor(['/vault/playbook/guide.md']);

  assert.deepEqual(
    resolveLocalLinkTarget('/vault', '/playbook/guide.md', probe, ABSOLUTE_ALLOWED),
    { uri: 'playbook/guide.md', origin: 'vault' },
  );
});

test('a target missing in both places stays a contained vault path', () => {
  assert.deepEqual(
    resolveLocalLinkTarget('/vault', '/playbook/guide.md', probeFor(), ABSOLUTE_ALLOWED),
    { uri: 'playbook/guide.md', origin: 'vault' },
  );
});

test('an existing absolute directory does not hijack a root-looking target', () => {
  const probe = probeFor(['/vault/playbook/_index.md'], ['/playbook', '/vault/playbook']);

  assert.deepEqual(
    resolveLocalLinkTarget('/vault', '/playbook', probe, ABSOLUTE_ALLOWED),
    { uri: 'playbook/_index.md', origin: 'vault' },
  );
});

test('plain and encoded traversal never resolve beneath the vault root', () => {
  const probe = probeFor(['/vault/notes/keep.md']);

  for (const uri of ['/../secret.md', '/%2e%2e/secret.md', '/notes/../../secret.md']) {
    const resolved = resolveLocalLinkTarget('/vault', uri, probe, ABSOLUTE_ALLOWED);
    assert.equal(resolved.origin, 'vault', uri);
    assert.equal(resolved.uri.startsWith('/'), false, uri);
    assert.equal(resolved.uri.includes('secret.md'), true, uri);
    // Containment is the dispatcher's job; the resolver must not hand back a
    // path that already claims to live inside the vault.
    assert.equal(resolve('/vault', resolved.uri).startsWith('/vault/'), false, uri);
  }
});

test('a NUL byte leaves the target untouched', () => {
  const probe = probeFor(['/vault/notes/keep.md']);

  assert.deepEqual(
    resolveLocalLinkTarget('/vault', '/notes/keep.md\u0000.png', probe, ABSOLUTE_ALLOWED),
    { uri: '/notes/keep.md\u0000.png', origin: 'unchanged' },
  );
});

test('URLs, product deep links, fragments, and Windows drives are left alone', () => {
  const probe = probeFor(['/vault/notes/keep.md']);

  for (const uri of [
    'https://example.com/a.md',
    'cursor://llm-wiki.llm-wiki-vscode/open-anchor?target=v1.abc',
    'vscode://llm-wiki.llm-wiki-vscode/open-anchor?target=v1.abc',
    '#heading',
    'C:/vault/notes/keep.md',
    'file:///vault/notes/keep.md',
  ]) {
    assert.deepEqual(
      resolveLocalLinkTarget('/vault', uri, probe, ABSOLUTE_ALLOWED),
      { uri, origin: 'unchanged' },
    );
  }
});

test('without a vault root every target is left unchanged', () => {
  const probe = probeFor(['/playbook/guide.md']);

  assert.deepEqual(
    resolveLocalLinkTarget(undefined, '/playbook/guide.md', probe, ABSOLUTE_ALLOWED),
    { uri: '/playbook/guide.md', origin: 'unchanged' },
  );
});

test('vault directories resolve to their underscore index and concept IDs gain the Markdown suffix', () => {
  const probe = probeFor(
    ['/vault/summaries/_index.md', '/vault/concepts/tokenization.md'],
    ['/vault/summaries'],
  );

  assert.deepEqual(
    resolveLocalLinkTarget('/vault', 'summaries/', probe),
    { uri: 'summaries/_index.md', origin: 'vault' },
  );
  assert.deepEqual(
    resolveLocalLinkTarget('/vault', 'concepts/tokenization', probe),
    { uri: 'concepts/tokenization.md', origin: 'vault' },
  );
});

test('vault directories do not fall back to index.md', () => {
  const probe = probeFor(
    ['/vault/summaries/index.md'],
    ['/vault/summaries'],
  );

  assert.deepEqual(
    resolveLocalLinkTarget('/vault', 'summaries/', probe),
    { uri: 'summaries/', origin: 'unchanged' },
  );
});

test('a relative target that matches nothing is left for classification', () => {
  assert.deepEqual(
    resolveLocalLinkTarget('/vault', 'notes/missing.md', probeFor()),
    { uri: 'notes/missing.md', origin: 'unchanged' },
  );
});
