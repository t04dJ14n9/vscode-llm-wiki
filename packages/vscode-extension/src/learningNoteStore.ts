import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';

const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30, 60, 90] as const;
const MESSAGE_MARKER_PREFIX = 'human-learning:discussion-message';
const ENCODED_MESSAGES_KEY = 'discussion_messages_b64';

export const MANUAL_NOTES_START = '<!-- human-learning:manual-notes:start -->';
export const MANUAL_NOTES_END = '<!-- human-learning:manual-notes:end -->';

export type LearningNoteDate = string | Date;

export interface LearningNoteSource {
  kind: 'pdf' | 'markdown';
  path: string;
  uri?: string;
  link?: string;
  location: string;
  quote: string;
  prefix?: string;
  suffix?: string;
  startLine?: number;
  endLine?: number;
  from?: number;
  to?: number;
}

export interface LearningNoteMessage {
  role: 'user' | 'assistant';
  markdown: string;
  createdAt?: LearningNoteDate;
}

export interface UpsertDiscussionInput {
  discussionId: string;
  source: LearningNoteSource;
  messages: LearningNoteMessage[];
  /** Optional concise answer-only Markdown. The store renders the Q/A labels. */
  summaryMarkdown?: string;
  createdAt?: LearningNoteDate;
  updatedAt?: LearningNoteDate;
}

export interface LearningNoteResult {
  absolutePath: string;
  relativePath: string;
  markdown: string;
}

export interface LoadedLearningDiscussion {
  discussionId: string;
  source: LearningNoteSource;
  messages: LearningNoteMessage[];
  createdAt?: string;
  updatedAt?: string;
  note: LearningNoteResult;
}

export interface LearningSourceAnnotation {
  discussionId: string;
  notePath: string;
  quote: string;
  question: string;
  questionCount: number;
  summary: string;
  startLine?: number;
  endLine?: number;
  from?: number;
  to?: number;
}

interface ExistingNote {
  absolutePath: string;
  relativePath: string;
  markdown: string;
  createdAt?: string;
}

/**
 * Persists one human-readable Markdown learning page per discussion.
 *
 * The discussion id is the only identity/index required. A short hash of it is
 * embedded in the filename, so the same page can be found again after restart
 * without a database or generated index.
 */
export class LearningNoteStore {
  private readonly workspaceRoot: string;
  private readonly learningDirectory: string;
  private readonly pendingWrites = new Map<string, Promise<void>>();

  constructor(workspaceRoot: string) {
    if (workspaceRoot.trim().length === 0) {
      throw new TypeError('workspaceRoot must not be empty');
    }

    this.workspaceRoot = resolve(workspaceRoot);
    this.learningDirectory = join(this.workspaceRoot, 'wiki', 'learning');
  }

  async upsertDiscussion(input: UpsertDiscussionInput): Promise<LearningNoteResult> {
    validateInput(input);

    const previousWrite = this.pendingWrites.get(input.discussionId) ?? Promise.resolve();
    const operation = previousWrite.then(() => this.upsertUnlocked(input));
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    this.pendingWrites.set(input.discussionId, settled);

    try {
      return await operation;
    } finally {
      if (this.pendingWrites.get(input.discussionId) === settled) {
        this.pendingWrites.delete(input.discussionId);
      }
    }
  }

  async findDiscussion(discussionId: string): Promise<LearningNoteResult | undefined> {
    if (discussionId.trim().length === 0) return undefined;
    const existing = await this.findExistingNote(
      discussionId,
      discussionShortId(discussionId),
    );
    if (!existing) return undefined;
    return {
      absolutePath: existing.absolutePath,
      relativePath: existing.relativePath,
      markdown: existing.markdown,
    };
  }

  /**
   * Reconstructs the canonical source and full transcript from a durable
   * learning note. When notePath is supplied, both it and discussionId must
   * identify the same workspace-local learning note.
   */
  async loadDiscussion(
    discussionId: string,
    notePath?: string,
  ): Promise<LoadedLearningDiscussion | undefined> {
    if (discussionId.trim().length === 0) return undefined;

    let note: LearningNoteResult | undefined;
    if (notePath === undefined) {
      note = await this.findDiscussion(discussionId);
    } else {
      const absolutePath = workspaceLearningNotePath(
        this.workspaceRoot,
        this.learningDirectory,
        notePath,
      );
      if (!absolutePath) return undefined;
      let markdown: string;
      try {
        markdown = await readFile(absolutePath, 'utf8');
      } catch (error) {
        if (isNodeError(error, 'ENOENT')) return undefined;
        throw error;
      }
      if (frontmatterString(markdown, 'id') !== discussionId) return undefined;
      note = {
        absolutePath,
        relativePath: toPosix(relative(this.workspaceRoot, absolutePath)),
        markdown,
      };
    }

    return note ? parseLearningDiscussion(note) : undefined;
  }

  async listAnnotationsForSource(sourcePath: string): Promise<LearningSourceAnnotation[]> {
    let entries;
    try {
      entries = await readdir(this.learningDirectory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return [];
      throw error;
    }
    const target = toPosix(sourcePath).replace(/^\.\//u, '').toLocaleLowerCase('en-US');
    const annotations: LearningSourceAnnotation[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const absolutePath = join(this.learningDirectory, entry.name);
      const markdown = await readFile(absolutePath, 'utf8');
      const storedSourcePath = nestedFrontmatterString(markdown, 'source', 'path');
      if (
        !storedSourcePath
        || toPosix(storedSourcePath).replace(/^\.\//u, '').toLocaleLowerCase('en-US') !== target
      ) {
        continue;
      }
      const discussionId = frontmatterString(markdown, 'id');
      if (!discussionId) continue;
      const messages = discussionMessages(markdown);
      const question = questionText(markdown, messages);
      annotations.push({
        discussionId,
        notePath: toPosix(relative(this.workspaceRoot, absolutePath)),
        quote: quotedPassage(markdown),
        question,
        questionCount: Math.max(
          messages.filter(message => message.role === 'user').length,
          question ? 1 : 0,
        ),
        summary: summaryText(markdown, messages),
        ...optionalNumber('startLine', frontmatterNumber(markdown, 'source_start_line')),
        ...optionalNumber('endLine', frontmatterNumber(markdown, 'source_end_line')),
        ...optionalNumber('from', frontmatterNumber(markdown, 'source_from')),
        ...optionalNumber('to', frontmatterNumber(markdown, 'source_to')),
      });
    }
    return annotations;
  }

  private async upsertUnlocked(input: UpsertDiscussionInput): Promise<LearningNoteResult> {
    await mkdir(this.learningDirectory, { recursive: true });

    const shortId = discussionShortId(input.discussionId);
    const existing = await this.findExistingNote(input.discussionId, shortId);
    const createdAt = existing?.createdAt
      ?? normalizeDate(
        input.createdAt ?? input.messages[0]?.createdAt,
        'createdAt',
      );
    const updatedAt = normalizeDate(
      input.updatedAt ?? input.messages.at(-1)?.createdAt,
      'updatedAt',
    );

    const firstQuestion = firstMessage(input.messages, 'user')?.markdown ?? 'Learning discussion';
    const relativePath = existing?.relativePath
      ?? toPosix(join(
        'wiki',
        'learning',
        `${datePart(createdAt)}-${questionSlug(firstQuestion)}-${shortId}.md`,
      ));
    const absolutePath = existing?.absolutePath
      ?? resolve(this.workspaceRoot, ...relativePath.split('/'));
    const manualNotes = existing === undefined
      ? defaultManualNotesRegion()
      : extractManualNotesRegion(existing.markdown) ?? defaultManualNotesRegion();

    const markdown = renderLearningNote({
      input,
      absolutePath,
      createdAt,
      updatedAt,
      manualNotes,
      workspaceRoot: this.workspaceRoot,
    });

    await atomicWrite(absolutePath, markdown);
    return { absolutePath, relativePath, markdown };
  }

  private async findExistingNote(
    discussionId: string,
    shortId: string,
  ): Promise<ExistingNote | undefined> {
    let entries;
    try {
      entries = await readdir(this.learningDirectory, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return undefined;
      throw error;
    }

    const suffix = `-${shortId}.md`;
    const candidates = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => entry.name)
      .sort();

    for (const filename of candidates) {
      const absolutePath = join(this.learningDirectory, filename);
      const markdown = await readFile(absolutePath, 'utf8');
      if (frontmatterString(markdown, 'id') !== discussionId) continue;

      return {
        absolutePath,
        relativePath: toPosix(relative(this.workspaceRoot, absolutePath)),
        markdown,
        createdAt: frontmatterString(markdown, 'created'),
      };
    }

    return undefined;
  }
}

interface RenderLearningNoteOptions {
  input: UpsertDiscussionInput;
  absolutePath: string;
  workspaceRoot: string;
  createdAt: string;
  updatedAt: string;
  manualNotes: string;
}

function renderLearningNote(options: RenderLearningNoteOptions): string {
  const { input, absolutePath, workspaceRoot, createdAt, updatedAt, manualNotes } = options;
  const source = input.source;
  const firstQuestion = firstMessage(input.messages, 'user')?.markdown ?? 'Learning discussion';
  const latestQuestion = lastMessage(input.messages, 'user')?.markdown ?? firstQuestion;
  const latestAnswer = lastMessage(input.messages, 'assistant')?.markdown ?? '';
  const answerSummary = firstParagraph(input.summaryMarkdown ?? latestAnswer);
  const portableSourceLink = workspaceSourceLink(source);
  const sourceTarget = sourceLinkTarget(
    workspaceRoot,
    dirname(absolutePath),
    source,
  );

  const lines = [
    '---',
    `id: ${yamlString(input.discussionId)}`,
    'type: learning-note',
    'status: draft',
    'source:',
    `  kind: ${yamlString(source.kind)}`,
    `  path: ${yamlString(toPosix(source.path))}`,
  ];

  if (source.uri !== undefined && !isFileUri(source.uri)) {
    lines.push(`  uri: ${yamlString(source.uri)}`);
  }
  lines.push(`  link: ${yamlString(portableSourceLink)}`);
  lines.push(`  location: ${yamlString(source.location)}`);
  appendOptionalNumber(lines, 'source_start_line', source.startLine);
  appendOptionalNumber(lines, 'source_end_line', source.endLine);
  appendOptionalNumber(lines, 'source_from', source.from);
  appendOptionalNumber(lines, 'source_to', source.to);
  lines.push(
    `${ENCODED_MESSAGES_KEY}: ${yamlString(encodeDiscussionMessages(input.messages))}`,
    `created: ${yamlString(createdAt)}`,
    `updated: ${yamlString(updatedAt)}`,
    'review_dates:',
    ...reviewDates(createdAt).map((date) => `  - ${yamlString(date)}`),
    '---',
    '',
    `# ${questionTitle(firstQuestion)}`,
    '',
    '## Summary',
    '',
    `**Question:** ${firstParagraph(latestQuestion) || 'Learning discussion'}`,
    '',
    `**Answer:** ${answerSummary || 'No assistant answer has been recorded yet.'}`,
    '',
    '## Source',
    '',
    `[Open source](<${markdownDestination(sourceTarget)}>)`,
    '',
    `**Location:** ${source.location}`,
    '',
    '### Quoted passage',
    '',
    fencedText(source.quote),
  );

  if (source.prefix !== undefined && source.prefix.length > 0) {
    lines.push('', '<details>', '<summary>Context before selection</summary>', '', fencedText(source.prefix), '', '</details>');
  }
  if (source.suffix !== undefined && source.suffix.length > 0) {
    lines.push('', '<details>', '<summary>Context after selection</summary>', '', fencedText(source.suffix), '', '</details>');
  }

  lines.push('', '## Discussion', '');
  if (input.messages.length === 0) {
    lines.push('_No messages recorded._', '');
  } else {
    let questionNumber = 0;
    let answerNumber = 0;
    for (const [messageIndex, message] of input.messages.entries()) {
      const number = message.role === 'user' ? ++questionNumber : ++answerNumber;
      const label = message.role === 'user' ? 'Question' : 'Answer';
      const markerIndex = messageIndex + 1;
      lines.push(
        `<!-- ${MESSAGE_MARKER_PREFIX}:${markerIndex}:start -->`,
        `### ${label} ${number}`,
        '',
      );
      if (message.createdAt !== undefined) {
        lines.push(`_${normalizeDate(message.createdAt, 'message.createdAt')}_`, '');
      }
      lines.push(
        message.markdown.trim() || '_Empty message._',
        `<!-- ${MESSAGE_MARKER_PREFIX}:${markerIndex}:end -->`,
        '',
      );
    }
  }

  lines.push('## Personal notes', '', manualNotes, '');
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

function validateInput(input: UpsertDiscussionInput): void {
  if (input.discussionId.trim().length === 0) {
    throw new TypeError('discussionId must not be empty');
  }
  if (input.source.path.trim().length === 0) {
    throw new TypeError('source.path must not be empty');
  }
  if (input.source.location.trim().length === 0) {
    throw new TypeError('source.location must not be empty');
  }
  if (typeof input.source.quote !== 'string') {
    throw new TypeError('source.quote must be a string');
  }
  for (const [name, value] of [
    ['source.startLine', input.source.startLine],
    ['source.endLine', input.source.endLine],
    ['source.from', input.source.from],
    ['source.to', input.source.to],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new TypeError(`${name} must be a non-negative integer`);
    }
  }
  for (const message of input.messages) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new TypeError(`Unsupported message role: ${String(message.role)}`);
    }
    if (typeof message.markdown !== 'string') {
      throw new TypeError('message.markdown must be a string');
    }
  }
}

function firstMessage(
  messages: readonly LearningNoteMessage[],
  role: LearningNoteMessage['role'],
): LearningNoteMessage | undefined {
  return messages.find((message) => message.role === role);
}

function lastMessage(
  messages: readonly LearningNoteMessage[],
  role: LearningNoteMessage['role'],
): LearningNoteMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === role) return message;
  }
  return undefined;
}

function discussionShortId(discussionId: string): string {
  return createHash('sha256').update(discussionId).digest('hex').slice(0, 10);
}

function questionSlug(markdown: string): string {
  const slug = plainText(markdown)
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)
    .replace(/-+$/u, '');
  return slug || 'learning-discussion';
}

function questionTitle(markdown: string): string {
  const title = plainText(firstParagraph(markdown)).replace(/\s+/gu, ' ').trim();
  if (title.length === 0) return 'Learning discussion';
  return title.length <= 120 ? title : `${title.slice(0, 117).trimEnd()}…`;
}

function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[*_~>#]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function firstParagraph(markdown: string): string {
  return markdown
    .trim()
    .split(/\r?\n[ \t]*\r?\n/u, 1)[0]
    ?.replace(/\r?\n/gu, ' ')
    .trim() ?? '';
}

function normalizeDate(value: LearningNoteDate | undefined, name: string): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${name} must be a valid date`);
  }
  return date.toISOString();
}

function datePart(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) throw new TypeError('createdAt must be a valid date');
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function reviewDates(createdAt: string): string[] {
  const [yearText, monthText, dayText] = datePart(createdAt).split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return REVIEW_INTERVALS_DAYS.map((interval) => {
    const due = new Date(year, month - 1, day + interval);
    return datePart(due.toISOString());
  });
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function appendOptionalNumber(lines: string[], key: string, value: number | undefined): void {
  if (value !== undefined) lines.push(`${key}: ${String(value)}`);
}

function fencedText(value: string): string {
  const longestFence = Math.max(
    2,
    ...Array.from(value.matchAll(/`+/gu), (match) => match[0].length),
  );
  const fence = '`'.repeat(longestFence + 1);
  return `${fence}text\n${value}\n${fence}`;
}

function defaultManualNotesRegion(): string {
  return [
    MANUAL_NOTES_START,
    '_Add your own notes here. This region is preserved when the discussion updates._',
    MANUAL_NOTES_END,
  ].join('\n');
}

function extractManualNotesRegion(markdown: string): string | undefined {
  const start = markdown.lastIndexOf(MANUAL_NOTES_START);
  if (start < 0) return undefined;
  const end = markdown.indexOf(MANUAL_NOTES_END, start + MANUAL_NOTES_START.length);
  if (end < 0) return undefined;
  return markdown.slice(start, end + MANUAL_NOTES_END.length);
}

function relativeSourceTarget(
  workspaceRoot: string,
  noteDirectory: string,
  sourcePath: string,
): string {
  const absoluteSource = isAbsolute(sourcePath)
    ? sourcePath
    : resolve(workspaceRoot, sourcePath);
  return toPosix(relative(noteDirectory, absoluteSource));
}

function sourceLinkTarget(
  workspaceRoot: string,
  noteDirectory: string,
  source: LearningNoteSource,
): string {
  return `${relativeSourceTarget(workspaceRoot, noteDirectory, source.path)}${sourceFragment(source)}`;
}

function workspaceSourceLink(source: LearningNoteSource): string {
  return `${toPosix(source.path)}${sourceFragment(source)}`;
}

function sourceFragment(source: LearningNoteSource): string {
  if (source.kind === 'markdown' && source.startLine !== undefined) {
    const endLine = Math.max(source.startLine, source.endLine ?? source.startLine);
    return `#L${source.startLine}${endLine === source.startLine ? '' : `-L${endLine}`}`;
  }
  for (const candidate of [source.link, source.uri]) {
    const fragmentIndex = candidate?.indexOf('#') ?? -1;
    if (candidate && fragmentIndex >= 0) return candidate.slice(fragmentIndex);
  }
  if (source.kind === 'pdf' && source.startLine !== undefined) {
    return `#page=${source.startLine}`;
  }
  return '';
}

function isFileUri(value: string): boolean {
  return /^file:/iu.test(value);
}

function markdownDestination(value: string): string {
  return value
    .replace(/[\r\n]/gu, '')
    .replace(/</gu, '%3C')
    .replace(/>/gu, '%3E');
}

function toPosix(value: string): string {
  return value.replace(/\\/gu, '/');
}

function frontmatterString(markdown: string, key: string): string | undefined {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)?.[1];
  if (frontmatter === undefined) return undefined;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const scalar = frontmatter.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, 'mu'))?.[1]?.trim();
  if (scalar === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(scalar);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return scalar;
  }
}

function nestedFrontmatterString(
  markdown: string,
  parent: string,
  key: string,
): string | undefined {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)?.[1];
  if (frontmatter === undefined) return undefined;
  const parentPattern = parent.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const keyPattern = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const section = frontmatter.match(
    new RegExp(`^${parentPattern}:\\s*\\r?\\n((?:[ \\t]+.*(?:\\r?\\n|$))*)`, 'mu'),
  )?.[1];
  const scalar = section?.match(
    new RegExp(`^[ \\t]+${keyPattern}:\\s*(.+)$`, 'mu'),
  )?.[1]?.trim();
  if (scalar === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(scalar);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return scalar;
  }
}

function frontmatterNumber(markdown: string, key: string): number | undefined {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)?.[1];
  if (frontmatter === undefined) return undefined;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const raw = frontmatter.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, 'mu'))?.[1]?.trim();
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function optionalNumber<Key extends 'startLine' | 'endLine' | 'from' | 'to'>(
  key: Key,
  value: number | undefined,
): { [Property in Key]?: number } {
  return value === undefined ? {} : { [key]: value } as { [Property in Key]?: number };
}

function quotedPassage(markdown: string): string {
  const section = markdown.match(
    /^### Quoted passage[ \t]*\r?\n+(`{3,})text[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/mu,
  );
  return section?.[2] ?? '';
}

function summaryField(markdown: string, label: 'Question' | 'Answer'): string {
  const section = markdown.match(
    /^## Summary[ \t]*\r?\n+([\s\S]*?)(?=^## Source[ \t]*$)/mu,
  )?.[1]?.trim();
  if (!section) return '';
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^\\*\\*${escapedLabel}:\\*\\*[ \\t]*(.*)$`, 'mu')
    .exec(section)?.[1]?.trim() ?? '';
}

function annotationPreview(markdown: string, limit = 600): string {
  const preview = plainText(firstParagraph(markdown));
  return preview.length <= limit ? preview : `${preview.slice(0, limit - 1).trimEnd()}…`;
}

function isNestedSummaryLabel(value: string): boolean {
  return /^(?:Question|Answer):\s*/iu.test(value);
}

function questionText(
  markdown: string,
  messages = discussionMessages(markdown),
): string {
  const stored = annotationPreview(summaryField(markdown, 'Question'));
  if (stored && !isNestedSummaryLabel(stored)) return stored;
  return annotationPreview(lastMessage(messages, 'user')?.markdown ?? '');
}

function summaryText(
  markdown: string,
  messages = discussionMessages(markdown),
): string {
  const stored = annotationPreview(summaryField(markdown, 'Answer'));
  if (stored && !isNestedSummaryLabel(stored)) return stored;
  const latestAnswer = annotationPreview(lastMessage(messages, 'assistant')?.markdown ?? '');
  if (latestAnswer) return latestAnswer;
  const section = markdown.match(
    /^## Summary[ \t]*\r?\n+([\s\S]*?)(?=^## Source[ \t]*$)/mu,
  )?.[1] ?? '';
  return annotationPreview(section);
}

function workspaceLearningNotePath(
  workspaceRoot: string,
  learningDirectory: string,
  notePath: string,
): string | undefined {
  if (!notePath.trim() || isAbsolute(notePath)) return undefined;
  const absolutePath = resolve(workspaceRoot, ...toPosix(notePath).split('/'));
  const fromLearningDirectory = relative(learningDirectory, absolutePath);
  if (
    fromLearningDirectory === '..'
    || fromLearningDirectory.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(fromLearningDirectory)
    || !absolutePath.toLowerCase().endsWith('.md')
  ) {
    return undefined;
  }
  return absolutePath;
}

function parseLearningDiscussion(
  note: LearningNoteResult,
): LoadedLearningDiscussion | undefined {
  const markdown = note.markdown;
  const discussionId = frontmatterString(markdown, 'id');
  const kind = nestedFrontmatterString(markdown, 'source', 'kind');
  const path = nestedFrontmatterString(markdown, 'source', 'path');
  const location = nestedFrontmatterString(markdown, 'source', 'location');
  if (
    !discussionId
    || (kind !== 'pdf' && kind !== 'markdown')
    || !path
    || location === undefined
  ) {
    return undefined;
  }

  const uri = nestedFrontmatterString(markdown, 'source', 'uri');
  const link = nestedFrontmatterString(markdown, 'source', 'link');
  const prefix = contextPassage(markdown, 'before');
  const suffix = contextPassage(markdown, 'after');
  const source: LearningNoteSource = {
    kind,
    path,
    ...(uri !== undefined ? { uri } : {}),
    ...(link !== undefined ? { link } : {}),
    location,
    quote: quotedPassage(markdown),
    ...(prefix !== undefined ? { prefix } : {}),
    ...(suffix !== undefined ? { suffix } : {}),
    ...optionalNumber('startLine', frontmatterNumber(markdown, 'source_start_line')),
    ...optionalNumber('endLine', frontmatterNumber(markdown, 'source_end_line')),
    ...optionalNumber('from', frontmatterNumber(markdown, 'source_from')),
    ...optionalNumber('to', frontmatterNumber(markdown, 'source_to')),
  };
  const createdAt = frontmatterString(markdown, 'created');
  const updatedAt = frontmatterString(markdown, 'updated');

  return {
    discussionId,
    source,
    messages: discussionMessages(markdown),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    note,
  };
}

function discussionMessages(markdown: string): LearningNoteMessage[] {
  const encodedMessages = frontmatterString(markdown, ENCODED_MESSAGES_KEY);
  if (encodedMessages !== undefined) {
    const decodedMessages = decodeDiscussionMessages(encodedMessages);
    if (decodedMessages !== undefined) return decodedMessages;
  }
  const section = markdown.match(
    /^## Discussion[ \t]*\r?\n+([\s\S]*?)(?=^## Personal notes[ \t]*$)/mu,
  )?.[1];
  if (!section) return [];

  const markerPattern = new RegExp(
    `^<!-- ${MESSAGE_MARKER_PREFIX}:(\\d+):start -->[ \\t]*\\r?\\n`
      + `([\\s\\S]*?)`
      + `^<!-- ${MESSAGE_MARKER_PREFIX}:\\1:end -->[ \\t]*(?:\\r?\\n|$)`,
    'gmu',
  );
  const markedMessages = [...section.matchAll(markerPattern)]
    .map(match => storedMessage(match[2] ?? ''))
    .filter((message): message is LearningNoteMessage => message !== undefined);
  if (markedMessages.length > 0) return markedMessages;

  const headingPattern = /^### (Question|Answer) \d+[ \t]*\r?\n/gmu;
  const headings = [...section.matchAll(headingPattern)];
  return headings.map((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? section.length;
    return {
      role: heading[1] === 'Question' ? 'user' : 'assistant',
      ...storedMessageBody(section.slice(start, end)),
    };
  });
}

function encodeDiscussionMessages(messages: readonly LearningNoteMessage[]): string {
  return Buffer.from(JSON.stringify(messages), 'utf8').toString('base64url');
}

function decodeDiscussionMessages(value: string): LearningNoteMessage[] | undefined {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(decoded)) return undefined;
    const messages: LearningNoteMessage[] = [];
    const candidates: readonly unknown[] = decoded;
    for (const candidate of candidates) {
      if (
        typeof candidate !== 'object'
        || candidate === null
      ) {
        return undefined;
      }
      const record = candidate as Record<string, unknown>;
      const role = record.role;
      const markdown = record.markdown;
      if (
        (role !== 'user' && role !== 'assistant')
        || typeof markdown !== 'string'
      ) {
        return undefined;
      }
      const createdAt = record.createdAt;
      if (createdAt !== undefined && (typeof createdAt !== 'string' || !isStoredDate(createdAt))) {
        return undefined;
      }
      messages.push({
        role,
        markdown,
        ...(createdAt !== undefined ? { createdAt } : {}),
      });
    }
    return messages;
  } catch {
    return undefined;
  }
}

function storedMessage(block: string): LearningNoteMessage | undefined {
  const heading = /^### (Question|Answer) \d+[ \t]*\r?\n/u.exec(block);
  if (!heading) return undefined;
  return {
    role: heading[1] === 'Question' ? 'user' : 'assistant',
    ...storedMessageBody(block.slice(heading[0].length)),
  };
}

function storedMessageBody(block: string): Pick<LearningNoteMessage, 'markdown' | 'createdAt'> {
  let body = block.replace(/^\r?\n/u, '').replace(/\r?\n+$/u, '');
  const timestamp = /^_([^_\r\n]+)_\r?\n(?:\r?\n)?/u.exec(body);
  let createdAt: string | undefined;
  if (timestamp && isStoredDate(timestamp[1])) {
    createdAt = timestamp[1];
    body = body.slice(timestamp[0].length);
  }
  if (body === '_Empty message._') body = '';
  return {
    markdown: body,
    ...(createdAt !== undefined ? { createdAt } : {}),
  };
}

function contextPassage(
  markdown: string,
  position: 'before' | 'after',
): string | undefined {
  const label = position === 'before'
    ? 'Context before selection'
    : 'Context after selection';
  const details = markdown.match(
    new RegExp(
      `<summary>${label}</summary>[ \\t]*\\r?\\n+([\\s\\S]*?)\\r?\\n[ \\t]*</details>`,
      'u',
    ),
  )?.[1];
  if (!details) return undefined;
  return fencedBlockText(details);
}

function fencedBlockText(markdown: string): string | undefined {
  return /(`{3,})text[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/u.exec(markdown)?.[2];
}

function isStoredDate(value: string | undefined): value is string {
  return value !== undefined && !Number.isNaN(new Date(value).getTime());
}

async function atomicWrite(absolutePath: string, markdown: string): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });
  const temporaryPath = join(
    dirname(absolutePath),
    `.${basename(absolutePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, markdown, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, absolutePath);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isNodeError(error, 'ENOENT')) throw error;
    });
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
