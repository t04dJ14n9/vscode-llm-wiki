import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const extensionRoot = resolve(import.meta.dirname, '../..');
const repoRoot = resolve(extensionRoot, '../..');
const markdownExtensionRoot = join(repoRoot, 'packages', 'vscode-markdown-extension');
const pdfExtensionRoot = join(repoRoot, 'packages', 'vscode-pdf-extension');

test('separate markdown and PDF extension manifests can be shipped independently', () => {
  const markdownManifest = JSON.parse(readFileSync(join(markdownExtensionRoot, 'package.json'), 'utf8'));
  const pdfManifest = JSON.parse(readFileSync(join(pdfExtensionRoot, 'package.json'), 'utf8'));

  assert.equal(markdownManifest.name, 'human-learning-markdown');
  assert.equal(markdownManifest.private, undefined);
  assert.equal(markdownManifest.main, 'dist/extension.js');
  assert.deepEqual(
    markdownManifest.contributes.customEditors.map(editor => editor.viewType),
    ['human-learning.markdownEditor'],
  );
  assert.equal(
    markdownManifest.contributes.configurationDefaults['workbench.editorAssociations']['*.md'],
    'human-learning.markdownEditor',
  );
  assert.equal(markdownManifest.contributes.configurationDefaults['workbench.editorAssociations']['*.pdf'], undefined);

  assert.equal(pdfManifest.name, 'human-learning-pdf');
  assert.equal(pdfManifest.private, undefined);
  assert.equal(pdfManifest.main, 'dist/extension.js');
  assert.ok(
    pdfManifest.activationEvents.includes('onCommand:human-learning.openPdfTarget'),
    'standalone PDF extension must activate when Markdown dispatches a portable PDF target',
  );
  assert.deepEqual(
    pdfManifest.contributes.customEditors.map(editor => editor.viewType),
    ['human-learning.pdfViewer'],
  );
  assert.equal(
    pdfManifest.contributes.configurationDefaults['workbench.editorAssociations']['*.pdf'],
    'human-learning.pdfViewer',
  );
  assert.equal(pdfManifest.contributes.configurationDefaults['workbench.editorAssociations']['*.md'], undefined);
});

test('split package preparation materializes isolated markdown and PDF package roots', async () => {
  const splitRoot = join(extensionRoot, 'dist-split');
  const markdownDist = await readdir(join(splitRoot, 'markdown', 'dist'));
  const pdfDist = await readdir(join(splitRoot, 'pdf', 'dist'));
  const markdownManifest = JSON.parse(readFileSync(join(splitRoot, 'markdown', 'package.json'), 'utf8'));
  const pdfManifest = JSON.parse(readFileSync(join(splitRoot, 'pdf', 'package.json'), 'utf8'));

  assert.equal(markdownManifest.main, 'dist/extension.js');
  assert.ok(markdownDist.includes('extension.js'));
  assert.ok(markdownDist.includes('markdown-editor.js'));
  assert.equal(markdownDist.includes('pdf-extension.js'), false);
  assert.equal(markdownDist.includes('pdf-viewer.js'), false);
  assert.equal(markdownDist.includes('pdfium.wasm'), false);

  assert.equal(pdfManifest.main, 'dist/extension.js');
  assert.ok(pdfDist.includes('extension.js'));
  assert.ok(pdfDist.includes('pdf-viewer.js'));
  assert.ok(pdfDist.includes('pdfium.wasm'));
  assert.equal(pdfDist.includes('markdown-extension.js'), false);
  assert.equal(pdfDist.includes('markdown-editor.js'), false);
});

test('standalone PDF bundle includes the Ask PDF panel protocol', () => {
  const bundle = readFileSync(join(pdfExtensionRoot, 'dist', 'pdf-viewer.js'), 'utf8');
  assert.match(bundle, /pdfDiscussionPrepare/);
  assert.match(bundle, /pdfDiscussionLoadSnapshot/);
  assert.match(bundle, /Ask PDF/);
  assert.match(bundle, /Ask about selection/);
});

test('combined and standalone extensions ship the same shared PDF runtime', () => {
  for (const file of ['pdf-viewer.js', 'pdfium.wasm']) {
    assert.deepEqual(
      readFileSync(join(extensionRoot, 'dist', file)),
      readFileSync(join(pdfExtensionRoot, 'dist', file)),
      `${file} drifted between the combined and standalone PDF extensions`,
    );
  }
});
