import { createHash } from 'node:crypto';
import {
  readFile,
  readdir,
} from 'node:fs/promises';
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';

const MESSAGE_MARKER_PREFIX = 'llm-wiki:discussion-message';
const ENCODED_MESSAGES_KEY = 'discussion_messages_b64';

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
  createdAt?: string;
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
 * Read-only compatibility adapter for one-release `wiki/learning` notes.
 * New knowledge is written as ordinary Query pages by agents, never here.
 */
export class LearningNoteStore {
  private readonly workspaceRoot: string;
  private readonly learningDirectory: string;

  constructor(workspaceRoot: string) {
    if (workspaceRoot.trim().length === 0) {
      throw new TypeError('workspaceRoot must not be empty');
    }

    this.workspaceRoot = resolve(workspaceRoot);
    this.learningDirectory = join(this.workspaceRoot, 'wiki', 'learning');
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

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
