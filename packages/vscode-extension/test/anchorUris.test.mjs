import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadAnchorUris(uriScheme = 'cursor') {
  const filename = join(packageRoot, 'src/anchorUris.ts');
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
    if (request === 'vscode') {
      return {
        env: { uriScheme },
        Uri: {
          parse: value => {
            const parsed = new URL(value);
            return {
              scheme: parsed.protocol.slice(0, -1),
              authority: parsed.host,
              path: parsed.pathname,
              query: decodeURIComponent(parsed.search.slice(1)),
            };
          },
        },
      };
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

test('LLM Wiki anchor URIs use the current product scheme and round-trip the portable target', () => {
  const {
    llmWikiAnchorTarget,
    llmWikiAnchorTargetFromString,
    llmWikiOpenAnchorUri,
  } = loadAnchorUris();
  const target =
    'raw/pdf/ddia.pdf#page=25:~:text=The%20Internet%20was%20done%20so%20well';
  const actionUri = llmWikiOpenAnchorUri(target);

  assert.equal(
    actionUri,
    'cursor://llm-wiki.llm-wiki-vscode/open-anchor?target='
      + `v1.${Buffer.from(target, 'utf8').toString('base64url')}`,
  );
  assert.equal(
    llmWikiAnchorTarget({
      scheme: 'cursor',
      authority: 'llm-wiki.llm-wiki-vscode',
      path: '/open-anchor',
      query: decodeURIComponent(actionUri.slice(actionUri.indexOf('?') + 1)),
    }),
    target,
  );
  assert.equal(llmWikiAnchorTargetFromString(actionUri), target);

  const webTarget = 'https://example.com/paper?one=1&target=two#section';
  assert.equal(
    llmWikiAnchorTargetFromString(llmWikiOpenAnchorUri(webTarget)),
    webTarget,
  );
});

test('LLM Wiki anchor URIs round-trip Markdown line ranges in both host schemes', () => {
  const target = 'notes/Concepts/FlashAttention.md#L12-L18';

  for (const uriScheme of ['cursor', 'vscode']) {
    const { llmWikiAnchorTargetFromString, llmWikiOpenAnchorUri } = loadAnchorUris(uriScheme);
    const actionUri = llmWikiOpenAnchorUri(target);

    assert.equal(
      actionUri,
      `${uriScheme}://llm-wiki.llm-wiki-vscode/open-anchor?target=`
        + `v1.${Buffer.from(target, 'utf8').toString('base64url')}`,
    );
    assert.equal(llmWikiAnchorTargetFromString(actionUri), target);
  }
});

test('LLM Wiki anchor URIs round-trip Markdown targets containing spaces', () => {
  const target = 'notes/Concepts/Online Softmax.md#L5-L7';
  const { llmWikiAnchorTargetFromString, llmWikiOpenAnchorUri } = loadAnchorUris();
  const actionUri = llmWikiOpenAnchorUri(target);

  assert.ok(actionUri);
  assert.doesNotMatch(actionUri, / /);
  assert.equal(llmWikiAnchorTargetFromString(actionUri), target);
});

test('LLM Wiki anchor URIs preserve the exact DDIA text fragment after VS Code URI parsing', () => {
  const {
    llmWikiAnchorTargetFromString,
    llmWikiOpenAnchorUri,
  } = loadAnchorUris();
  const target =
    'raw/pdf/ddia.pdf#page=25:~:text=and%20Maintainable%20Applications-,'
    + 'The%20Internet%20was%20done%20so%20well%20that%20most%20people%20think%20of%20it'
    + '%20as%20a%20natural%20resource%20like%20the%20Pacific%20Ocean%2C%20rather%20than'
    + '%20something%20that%20was%20man%2Dmade.%20When%20was%20the%20last%20time%20a'
    + '%20tech%E2%80%90nology%20with%20a%20scale%20like%20that%20was%20so%20error'
    + '%2Dfree%3F,-%E2%80%94Alan%20Kay%2C%20in%20interview%20with%20Dr';

  const actionUri = llmWikiOpenAnchorUri(target);

  assert.ok(actionUri);
  assert.equal(llmWikiAnchorTargetFromString(actionUri), target);
});

test('LLM Wiki anchor URI parsing rejects malformed or foreign targets', () => {
  const {
    llmWikiAnchorTarget,
    llmWikiAnchorTargetFromString,
    llmWikiOpenAnchorUri,
  } = loadAnchorUris('vscode');

  assert.equal(llmWikiOpenAnchorUri(' \n '), undefined);
  assert.equal(llmWikiOpenAnchorUri(`raw/pdf/paper.pdf\u0000#page=2`), undefined);
  assert.equal(llmWikiOpenAnchorUri('x'.repeat((32 * 1024) + 1)), undefined);
  assert.equal(llmWikiAnchorTargetFromString('not a URI'), undefined);
  assert.equal(
    llmWikiAnchorTarget({
      scheme: 'vscode',
      authority: 'llm-wiki.llm-wiki-vscode',
      path: '/open-anchor',
      query: `target=v1.${'A'.repeat((32 * 1024 * 4) + 1)}`,
    }),
    undefined,
  );
  assert.equal(
    llmWikiAnchorTarget({
      scheme: 'cursor',
      authority: 'llm-wiki.llm-wiki-vscode',
      path: '/other',
      query: 'target=raw%2Fpdf%2Fpaper.pdf',
    }),
    undefined,
  );
  assert.equal(
    llmWikiAnchorTarget({
      scheme: 'cursor',
      authority: 'llm-wiki.llm-wiki-vscode',
      path: '/open-anchor',
      query: 'target=raw%2Fpdf%2Fpaper.pdf',
    }),
    undefined,
  );
  assert.equal(
    llmWikiAnchorTarget({
      scheme: 'cursor',
      authority: 'llm-wiki.llm-wiki-vscode',
      path: '/open-anchor',
      query: 'target=v1.cmF3L3BkZi9vbmUucGRm&target=v1.cmF3L3BkZi90d28ucGRm',
    }),
    undefined,
  );
  assert.equal(
    llmWikiAnchorTarget({
      scheme: 'cursor',
      authority: 'llm-wiki.llm-wiki-vscode',
      path: '/open-anchor',
      query: 'target=v1.cmF3L3BkZi9wYXBlci5wZGY&other=value',
    }),
    undefined,
  );
  assert.equal(
    llmWikiAnchorTarget({
      scheme: 'https',
      authority: 'llm-wiki.llm-wiki-vscode',
      path: '/open-anchor',
      query: 'target=v1.cmF3L3BkZi9wYXBlci5wZGY',
    }),
    undefined,
  );
});
