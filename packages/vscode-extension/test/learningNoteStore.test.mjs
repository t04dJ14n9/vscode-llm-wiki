import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadStoreModule() {
  const filename = join(packageRoot, 'src', 'learningNoteStore.ts');
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

const {
  LearningNoteStore,
  MANUAL_NOTES_END,
  MANUAL_NOTES_START,
} = loadStoreModule();

function discussion(overrides = {}) {
  return {
    discussionId: 'discussion-stable-123',
    source: {
      kind: 'pdf',
      path: 'raw/papers/Attention Is All You Need.pdf',
      uri: 'file:///vault/raw/papers/Attention%20Is%20All%20You%20Need.pdf#page=3',
      location: 'page 3',
      quote: 'The exact selected passage.\nIt keeps punctuation: a:b and `code`.',
      prefix: 'Text immediately before.',
      suffix: 'Text immediately after.',
    },
    messages: [
      {
        role: 'user',
        markdown: 'Why does scaled dot-product attention divide by the square root?',
        createdAt: '2026-01-10T08:00:00.000Z',
      },
      {
        role: 'assistant',
        markdown: 'It keeps the softmax logits in a useful range.\n\nThe variance otherwise grows with dimension.',
        createdAt: '2026-01-10T08:01:00.000Z',
      },
    ],
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-01-10T08:01:00.000Z',
    ...overrides,
  };
}

async function withWorkspace(run) {
  const root = await mkdtemp(join(tmpdir(), 'llm-wiki-learning-note-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function manualRegion(markdown) {
  const start = markdown.lastIndexOf(MANUAL_NOTES_START);
  const end = markdown.indexOf(MANUAL_NOTES_END, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return markdown.slice(start, end + MANUAL_NOTES_END.length);
}

function summarySection(markdown) {
  const match = markdown.match(/^## Summary\n\n([\s\S]*?)\n\n## Source$/mu);
  assert.ok(match, 'missing Summary section');
  return match[1];
}

test('creates a deterministic filesystem-first learning note with source provenance', async () => {
  await withWorkspace(async (root) => {
    const store = new LearningNoteStore(root);
    const input = discussion({
      source: {
        ...discussion().source,
        startLine: 12,
        endLine: 14,
        from: 240,
        to: 318,
      },
    });
    const result = await store.upsertDiscussion(input);

    assert.match(
      result.relativePath,
      /^wiki\/learning\/2026-01-10-why-does-scaled-dot-product-attention-divide-by-[a-f0-9]{10}\.md$/u,
    );
    assert.equal(result.absolutePath, join(root, ...result.relativePath.split('/')));
    assert.equal(await readFile(result.absolutePath, 'utf8'), result.markdown);
    assert.match(result.markdown, /^id: "discussion-stable-123"$/mu);
    assert.match(result.markdown, /^type: learning-note$/mu);
    assert.match(result.markdown, /^status: draft$/mu);
    assert.match(result.markdown, /^ {2}kind: "pdf"$/mu);
    assert.match(result.markdown, /^ {2}path: "raw\/papers\/Attention Is All You Need\.pdf"$/mu);
    assert.match(result.markdown, /^source_start_line: 12$/mu);
    assert.match(result.markdown, /^source_end_line: 14$/mu);
    assert.match(result.markdown, /^source_from: 240$/mu);
    assert.match(result.markdown, /^source_to: 318$/mu);
    assert.ok(result.markdown.includes(input.source.quote), 'the exact selection is retained');
    assert.ok(
      result.markdown.includes(
        '[Open source](<../../raw/papers/Attention Is All You Need.pdf#page=3>)',
      ),
      'the source remains portable and clickable',
    );
    assert.doesNotMatch(result.markdown, /file:\/\//);
    assert.ok(result.markdown.includes('### Question 1'));
    assert.ok(result.markdown.includes(input.messages[0].markdown));
    assert.ok(result.markdown.includes('### Answer 1'));
    assert.ok(result.markdown.includes(input.messages[1].markdown));

    const found = await store.findDiscussion(input.discussionId);
    assert.equal(found?.relativePath, result.relativePath);
    const annotations = await store.listAnnotationsForSource(input.source.path);
    assert.deepEqual(annotations, [{
      discussionId: input.discussionId,
      notePath: result.relativePath,
      quote: input.source.quote,
      question: 'Why does scaled dot-product attention divide by the square root?',
      questionCount: 1,
      summary: 'It keeps the softmax logits in a useful range.',
      startLine: 12,
      endLine: 14,
      from: 240,
      to: 318,
    }]);
  });
});

test('emits a workspace-portable Markdown source link with an exact line range', async () => {
  await withWorkspace(async (root) => {
    const result = await new LearningNoteStore(root).upsertDiscussion(discussion({
      source: {
        kind: 'markdown',
        path: 'notes/Concepts/Tiling.md',
        uri: 'file:///vault/notes/Concepts/Tiling.md',
        link: 'file:///vault/notes/Concepts/Tiling.md#L4-L5',
        location: 'lines 4–5',
        quote: 'Tiling loads each block once.',
        startLine: 4,
        endLine: 5,
        from: 81,
        to: 110,
      },
    }));

    assert.match(
      result.markdown,
      /^ {2}link: "notes\/Concepts\/Tiling\.md#L4-L5"$/mu,
    );
    assert.ok(
      result.markdown.includes(
        '[Open source](<../../notes/Concepts/Tiling.md#L4-L5>)',
      ),
    );
    assert.doesNotMatch(result.markdown, /file:\/\//);
  });
});

test('reloads the exact source and complete transcript from a durable note', async () => {
  await withWorkspace(async (root) => {
    const store = new LearningNoteStore(root);
    const input = discussion({
      source: {
        ...discussion().source,
        link: 'raw/papers/Attention Is All You Need.pdf#page=3:~:text=exact',
        startLine: 3,
        endLine: 3,
        from: 91,
        to: 145,
      },
      messages: [
        discussion().messages[0],
        {
          ...discussion().messages[1],
          markdown: [
            discussion().messages[1].markdown,
            '',
            '### Question 2',
            '',
            'This heading belongs to the answer and must not split the transcript.',
          ].join('\n'),
        },
        {
          role: 'user',
          markdown: 'How does this connect to initialization?\n\nKeep this second paragraph.',
          createdAt: '2026-01-10T08:02:00.000Z',
        },
        {
          role: 'assistant',
          markdown: 'Both control variance.\n\nThe full follow-up answer is durable.',
          createdAt: '2026-01-10T08:03:00.000Z',
        },
      ],
      updatedAt: '2026-01-10T08:03:00.000Z',
    });
    const note = await store.upsertDiscussion(input);

    const loaded = await store.loadDiscussion(input.discussionId, note.relativePath);

    assert.equal(loaded?.discussionId, input.discussionId);
    assert.deepEqual(
      loaded?.source,
      Object.fromEntries(Object.entries(input.source).filter(([key]) => key !== 'uri')),
    );
    assert.deepEqual(loaded?.messages, input.messages);
    assert.equal(loaded?.createdAt, '2026-01-10T08:00:00.000Z');
    assert.equal(loaded?.updatedAt, '2026-01-10T08:03:00.000Z');
    assert.equal(loaded?.note.absolutePath, note.absolutePath);
    assert.equal(loaded?.note.markdown, note.markdown);
  });
});

test('reloads transcript content that imitates note delimiters and section headings', async () => {
  await withWorkspace(async (root) => {
    const store = new LearningNoteStore(root);
    const input = discussion({
      messages: [
        {
          role: 'user',
          markdown: [
            'Can delimiter-shaped text survive?',
            '<!-- llm-wiki:discussion-message:1:end -->',
            '## Personal notes',
          ].join('\n\n'),
          createdAt: '2026-01-10T08:00:00.000Z',
        },
        {
          role: 'assistant',
          markdown: [
            '<!-- llm-wiki:discussion-message:2:start -->',
            'Yes. This remains ordinary answer text.',
            '## Personal notes',
          ].join('\n\n'),
          createdAt: '2026-01-10T08:01:00.000Z',
        },
      ],
    });
    const note = await store.upsertDiscussion(input);

    const loaded = await store.loadDiscussion(input.discussionId, note.relativePath);

    assert.deepEqual(loaded?.messages, input.messages);
    assert.match(note.markdown, /^discussion_messages_b64: "[A-Za-z0-9_-]+"$/mu);
  });
});

test('refuses traversal and mismatched annotation identities when loading a discussion', async () => {
  await withWorkspace(async (root) => {
    const store = new LearningNoteStore(root);
    const note = await store.upsertDiscussion(discussion());

    assert.equal(
      await store.loadDiscussion(discussion().discussionId, '../outside.md'),
      undefined,
    );
    assert.equal(
      await store.loadDiscussion('different-discussion', note.relativePath),
      undefined,
    );
  });
});

test('renders the fixed Ebbinghaus review dates from the immutable creation date', async () => {
  await withWorkspace(async (root) => {
    const result = await new LearningNoteStore(root).upsertDiscussion(discussion());
    const expected = [
      '2026-01-11',
      '2026-01-13',
      '2026-01-17',
      '2026-01-24',
      '2026-02-09',
      '2026-03-11',
      '2026-04-10',
    ];

    assert.match(result.markdown, /^review_dates:\n(?: {2}- "\d{4}-\d{2}-\d{2}"\n){7}/mu);
    for (const date of expected) {
      assert.ok(result.markdown.includes(`  - "${date}"`), `missing review date ${date}`);
    }
  });
});

test('uses the desktop local calendar day for filenames and review dates near UTC midnight', async () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  try {
    await withWorkspace(async (root) => {
      const result = await new LearningNoteStore(root).upsertDiscussion(discussion({
        createdAt: '2026-08-09T18:15:00.000Z',
        updatedAt: '2026-08-09T18:16:00.000Z',
      }));

      assert.match(result.relativePath, /^wiki\/learning\/2026-08-10-/u);
      for (const date of [
        '2026-08-11',
        '2026-08-13',
        '2026-08-17',
        '2026-08-24',
        '2026-09-09',
        '2026-10-09',
        '2026-11-08',
      ]) {
        assert.ok(result.markdown.includes(`  - "${date}"`), `missing review date ${date}`);
      }
    });
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('follow-up messages update the same note and use the supplied concise summary', async () => {
  await withWorkspace(async (root) => {
    const store = new LearningNoteStore(root);
    const initial = await store.upsertDiscussion(discussion());
    const followUpMessages = [
      ...discussion().messages,
      {
        role: 'user',
        markdown: 'How does that relate to initialization?',
        createdAt: '2026-01-11T09:00:00.000Z',
      },
      {
        role: 'assistant',
        markdown: 'Both aim to control variance through a deep computation.',
        createdAt: '2026-01-11T09:01:00.000Z',
      },
    ];
    const updated = await store.upsertDiscussion(discussion({
      messages: followUpMessages,
      summaryMarkdown: 'Scaling attention is a variance-control technique.',
      updatedAt: '2026-01-11T09:01:00.000Z',
    }));

    assert.equal(updated.absolutePath, initial.absolutePath);
    assert.equal(updated.relativePath, initial.relativePath);
    assert.ok(updated.markdown.includes('### Question 2'));
    assert.ok(updated.markdown.includes('How does that relate to initialization?'));
    assert.ok(updated.markdown.includes('### Answer 2'));
    assert.ok(updated.markdown.includes('Scaling attention is a variance-control technique.'));
    assert.equal(
      summarySection(updated.markdown),
      [
        '**Question:** How does that relate to initialization?',
        '',
        '**Answer:** Scaling attention is a variance-control technique.',
      ].join('\n'),
    );
    assert.doesNotMatch(summarySection(updated.markdown), /\*\*Answer:\*\*\s+\*\*Question:\*\*/u);
    assert.match(updated.markdown, /^created: "2026-01-10T08:00:00\.000Z"$/mu);
    assert.match(updated.markdown, /^updated: "2026-01-11T09:01:00\.000Z"$/mu);

    const annotations = await store.listAnnotationsForSource(discussion().source.path);
    assert.equal(annotations.length, 1);
    assert.equal(annotations[0].question, 'How does that relate to initialization?');
    assert.equal(annotations[0].questionCount, 2);
    assert.equal(annotations[0].summary, 'Scaling attention is a variance-control technique.');
  });
});

test('recovers annotation previews from a malformed legacy summary', async () => {
  await withWorkspace(async (root) => {
    const store = new LearningNoteStore(root);
    const result = await store.upsertDiscussion(discussion());
    await writeFile(
      result.absolutePath,
      result.markdown.replace(
        '**Answer:** It keeps the softmax logits in a useful range.',
        '**Answer:** **Question:** broken nested label',
      ),
      'utf8',
    );

    const [annotation] = await store.listAnnotationsForSource(discussion().source.path);
    assert.equal(
      annotation.question,
      'Why does scaled dot-product attention divide by the square root?',
    );
    assert.equal(annotation.summary, 'It keeps the softmax logits in a useful range.');
  });
});

test('derives a concise latest-turn summary without altering the full transcript', async () => {
  await withWorkspace(async (root) => {
    const messages = [
      ...discussion().messages,
      {
        role: 'user',
        markdown: 'What is the IO connection?\n\nPlease include an example.',
        createdAt: '2026-01-11T09:00:00.000Z',
      },
      {
        role: 'assistant',
        markdown: 'Tiling reduces transfers between slow and fast memory.\n\nThe complete explanation remains here.',
        createdAt: '2026-01-11T09:01:00.000Z',
      },
    ];
    const result = await new LearningNoteStore(root).upsertDiscussion(discussion({
      messages,
      updatedAt: '2026-01-11T09:01:00.000Z',
    }));

    assert.equal(
      summarySection(result.markdown),
      [
        '**Question:** What is the IO connection?',
        '',
        '**Answer:** Tiling reduces transfers between slow and fast memory.',
      ].join('\n'),
    );
    for (const message of messages) {
      assert.ok(result.markdown.includes(message.markdown), `missing transcript message: ${message.markdown}`);
    }
    assert.ok(result.markdown.includes(discussion().source.quote), 'the exact source quote is retained');
  });
});

test('preserves the manual-notes region verbatim when generated content changes', async () => {
  await withWorkspace(async (root) => {
    const store = new LearningNoteStore(root);
    const initial = await store.upsertDiscussion(discussion());
    const handwritten = [
      MANUAL_NOTES_START,
      '',
      '- My own connection to residual streams.',
      '- Keep this **formatting** and spacing.',
      '',
      '```text',
      'private scratch',
      '```',
      MANUAL_NOTES_END,
    ].join('\n');
    const edited = initial.markdown.replace(manualRegion(initial.markdown), handwritten);
    await writeFile(initial.absolutePath, edited, 'utf8');

    const updated = await store.upsertDiscussion(discussion({
      messages: [
        ...discussion().messages,
        { role: 'user', markdown: 'A follow-up question.' },
        { role: 'assistant', markdown: 'A follow-up answer.' },
      ],
      updatedAt: '2026-01-12T10:00:00.000Z',
    }));

    assert.equal(manualRegion(updated.markdown), handwritten);
    assert.equal(await readFile(initial.absolutePath, 'utf8'), updated.markdown);
  });
});

test('finds the same page after restart even when update timestamps cross a day boundary', async () => {
  await withWorkspace(async (root) => {
    const created = await new LearningNoteStore(root).upsertDiscussion(discussion());
    const restartedStore = new LearningNoteStore(root);
    const updated = await restartedStore.upsertDiscussion(discussion({
      createdAt: undefined,
      updatedAt: '2026-02-20T12:00:00.000Z',
      messages: [
        ...discussion().messages,
        { role: 'user', markdown: 'A much later question.' },
        { role: 'assistant', markdown: 'A much later answer.' },
      ],
    }));

    assert.equal(updated.relativePath, created.relativePath);
    assert.match(updated.markdown, /^created: "2026-01-10T08:00:00\.000Z"$/mu);
  });
});
