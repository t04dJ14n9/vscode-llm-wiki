import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
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

const { generateDailyNote } = loadTsModule('src/dailyNotes.ts');

test('discovers every due review and renders POSIX relative links', async () => {
  const workspaceRoot = createWorkspace();
  try {
    writeMarkdown(
      workspaceRoot,
      'wiki/learning/Memory Systems.md',
      [
        '---',
        'title: Memory Systems',
        'review_dates:',
        '  - 2026-08-08',
        '  - 2026-08-10',
        '  - 2026-08-11',
        '---',
        '# Memory',
      ].join('\n'),
    );
    writeMarkdown(
      workspaceRoot,
      'wiki/learning/nested/Spaced Repetition.md',
      [
        '---',
        'review_dates:',
        '  - 2026-08-09',
        '---',
        '# Spaced Repetition',
      ].join('\n'),
    );
    writeMarkdown(
      workspaceRoot,
      'wiki/learning/Future.md',
      [
        '---',
        'review_dates:',
        '  - 2026-09-01',
        '---',
      ].join('\n'),
    );

    const result = await generateDailyNote({
      workspaceRoot,
      date: '2026-08-10',
    });

    assert.equal(result.absolutePath, join(workspaceRoot, 'wiki/daily/2026-08-10.md'));
    assert.equal(result.relativePath, 'wiki/daily/2026-08-10.md');
    assert.deepEqual(
      result.dueReviews.map(review => [
        review.title,
        review.dueDate,
        review.relativePath,
        review.link,
      ]),
      [
        [
          'Memory Systems',
          '2026-08-08',
          'wiki/learning/Memory Systems.md',
          '../learning/Memory%20Systems.md',
        ],
        [
          'Spaced Repetition',
          '2026-08-09',
          'wiki/learning/nested/Spaced Repetition.md',
          '../learning/nested/Spaced%20Repetition.md',
        ],
        [
          'Memory Systems',
          '2026-08-10',
          'wiki/learning/Memory Systems.md',
          '../learning/Memory%20Systems.md',
        ],
      ],
    );
    assert.match(
      result.markdown,
      /- \[ \] \[Memory Systems\]\(\.\.\/learning\/Memory%20Systems\.md\) — due 2026-08-10/,
    );
    assert.doesNotMatch(result.markdown, /2026-08-11|Future/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('carries unchecked tasks from the latest earlier daily note and deduplicates them', async () => {
  const workspaceRoot = createWorkspace();
  try {
    writeMarkdown(
      workspaceRoot,
      'wiki/daily/2026-08-07.md',
      '- [ ] An older task\n',
    );
    writeMarkdown(
      workspaceRoot,
      'wiki/daily/2026-08-09.md',
      [
        '# 2026-08-09',
        '',
        '- [ ] Read chapter 4',
        '- [x] Finished task',
        '- [ ]   Draft   concept map',
        '- [ ] read CHAPTER 4',
      ].join('\n'),
    );

    const result = await generateDailyNote({
      workspaceRoot,
      date: '2026-08-10',
    });

    assert.deepEqual(result.carriedTodos, [
      'Read chapter 4',
      'Draft   concept map',
    ]);
    assert.match(result.markdown, /## Today/);
    assert.match(result.markdown, /## Carried forward/);
    assert.match(result.markdown, /- \[ \] Read chapter 4/);
    assert.match(result.markdown, /- \[ \] Draft {3}concept map/);
    assert.doesNotMatch(result.markdown, /Finished task|An older task/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('completed review dates stay completed and review checkboxes are not carried as todos', async () => {
  const workspaceRoot = createWorkspace();
  try {
    writeMarkdown(
      workspaceRoot,
      'wiki/learning/Recall.md',
      [
        '---',
        'title: Active Recall',
        'review_dates:',
        '  - 2026-08-08',
        '  - 2026-08-09',
        '  - 2026-08-10',
        '---',
        '# Active Recall',
      ].join('\n'),
    );
    writeMarkdown(
      workspaceRoot,
      'wiki/daily/2026-08-09.md',
      [
        '# 2026-08-09',
        '',
        '<!-- human-learning:review-plan:start -->',
        '## Review plan',
        '',
        '- [x] [Active Recall](../learning/Recall.md) — due 2026-08-08',
        '- [ ] [Active Recall](../learning/Recall.md) — due 2026-08-09',
        '<!-- human-learning:review-plan:end -->',
        '',
        '## Today',
        '',
        '- [ ] Explain the idea from memory',
      ].join('\n'),
    );

    const result = await generateDailyNote({
      workspaceRoot,
      date: '2026-08-10',
    });

    assert.deepEqual(
      result.dueReviews.map(review => review.dueDate),
      ['2026-08-09', '2026-08-10'],
    );
    assert.deepEqual(result.carriedTodos, ['Explain the idea from memory']);
    assert.doesNotMatch(result.markdown, /due 2026-08-08/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('regeneration is idempotent and preserves manual content and checkbox edits', async () => {
  const workspaceRoot = createWorkspace();
  try {
    writeMarkdown(
      workspaceRoot,
      'wiki/learning/Recall.md',
      [
        '---',
        'title: Active Recall',
        'review_dates:',
        '  - 2026-08-10',
        '---',
      ].join('\n'),
    );
    writeMarkdown(
      workspaceRoot,
      'wiki/daily/2026-08-09.md',
      '- [ ] Explain retrieval practice\n',
    );

    const first = await generateDailyNote({
      workspaceRoot,
      date: '2026-08-10',
    });
    const edited = first.markdown
      .replace(
        '<!-- Add notes and tasks here. This section is preserved when the note is regenerated. -->',
        [
          'Retrieval feels effortful, which is useful.',
          '',
          '- [ ] Write a concrete example',
        ].join('\n'),
      )
      .replace(
        '- [ ] [Active Recall](../learning/Recall.md)',
        '- [x] [Active Recall](../learning/Recall.md)',
      )
      .replace(
        '- [ ] Explain retrieval practice',
        '- [x] Explain retrieval practice',
      );
    writeFileSync(first.absolutePath, edited, 'utf8');
    writeMarkdown(
      workspaceRoot,
      'wiki/daily/2026-08-09.md',
      [
        '- [ ] Explain retrieval practice',
        '- [ ] Interleave two topics',
      ].join('\n'),
    );

    const second = await generateDailyNote({
      workspaceRoot,
      date: '2026-08-10',
    });
    const third = await generateDailyNote({
      workspaceRoot,
      date: '2026-08-10',
    });

    assert.equal(second.markdown, third.markdown);
    assert.equal(readFileSync(second.absolutePath, 'utf8'), third.markdown);
    assert.match(second.markdown, /Retrieval feels effortful, which is useful\./);
    assert.match(second.markdown, /- \[ \] Write a concrete example/);
    assert.match(
      second.markdown,
      /- \[x\] \[Active Recall\]\(\.\.\/learning\/Recall\.md\)/,
    );
    assert.match(second.markdown, /- \[x\] Explain retrieval practice/);
    assert.match(second.markdown, /- \[ \] Interleave two topics/);
    assert.equal(
      [...second.markdown.matchAll(/Explain retrieval practice/g)].length,
      1,
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

function createWorkspace() {
  return mkdtempSync(join(tmpdir(), 'human-learning-daily-'));
}

function writeMarkdown(workspaceRoot, relativePath, markdown) {
  const path = join(workspaceRoot, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, markdown, 'utf8');
}
