import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

const REVIEW_START = '<!-- human-learning:review-plan:start -->';
const REVIEW_END = '<!-- human-learning:review-plan:end -->';
const CARRIED_START = '<!-- human-learning:carried-tasks:start -->';
const CARRIED_END = '<!-- human-learning:carried-tasks:end -->';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface GenerateDailyNoteOptions {
  workspaceRoot: string;
  date?: string | Date;
  now?: Date;
}

export interface DueReview {
  title: string;
  dueDate: string;
  relativePath: string;
  link: string;
}

export interface GeneratedDailyNote {
  absolutePath: string;
  relativePath: string;
  markdown: string;
  dueReviews: DueReview[];
  carriedTodos: string[];
}

interface LearningNote {
  title: string;
  relativePath: string;
  reviewDates: string[];
}

export async function generateDailyNote(
  options: GenerateDailyNoteOptions,
): Promise<GeneratedDailyNote> {
  if (options.workspaceRoot.trim() === '') {
    throw new Error('workspaceRoot must not be empty');
  }

  const workspaceRoot = resolve(options.workspaceRoot);
  const date = resolveDate(options.date, options.now);
  const dailyDirectory = join(workspaceRoot, 'wiki', 'daily');
  const absolutePath = join(dailyDirectory, `${date}.md`);
  const relativePath = toPosixPath(relative(workspaceRoot, absolutePath));
  const learningDirectory = join(workspaceRoot, 'wiki', 'learning');

  const learningNotes = await readLearningNotes(learningDirectory, workspaceRoot);
  const completedReviews = await readCompletedReviewKeys(
    dailyDirectory,
    date,
    workspaceRoot,
  );
  const dueReviews = buildDueReviews(
    learningNotes,
    date,
    dirname(absolutePath),
    workspaceRoot,
    completedReviews,
  );
  const previousDailyPath = await findPreviousDailyNote(dailyDirectory, date);
  const previousMarkdown = previousDailyPath
    ? await readFile(previousDailyPath, 'utf8')
    : '';
  const carriedTodos = extractUncheckedTasks(previousMarkdown);
  const existing = await readOptionalFile(absolutePath);
  const markdown = renderDailyNote(existing, date, dueReviews, carriedTodos);

  if (existing !== markdown) {
    await atomicWriteFile(absolutePath, markdown);
  }

  return {
    absolutePath,
    relativePath,
    markdown,
    dueReviews,
    carriedTodos,
  };
}

function resolveDate(date: string | Date | undefined, now: Date | undefined): string {
  if (typeof date === 'string') {
    assertDateKey(date);
    return date;
  }

  return dateKey(date ?? now ?? new Date());
}

function dateKey(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('date must be valid');
  }

  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function assertDateKey(value: string): void {
  if (!DATE_PATTERN.test(value)) {
    throw new Error('date must use YYYY-MM-DD');
  }

  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    throw new Error('date must be valid');
  }
}

async function readLearningNotes(
  learningDirectory: string,
  workspaceRoot: string,
): Promise<LearningNote[]> {
  const paths = await findMarkdownFiles(learningDirectory);
  const notes = await Promise.all(paths.map(async path => {
    const markdown = await readFile(path, 'utf8');
    const frontmatter = readFrontmatter(markdown);
    return {
      title: readTitle(frontmatter, markdown, path),
      relativePath: toPosixPath(relative(workspaceRoot, path)),
      reviewDates: readReviewDates(frontmatter),
    };
  }));

  return notes.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath));
}

async function findMarkdownFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return [];
    }
    throw error;
  }

  const paths = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return findMarkdownFiles(path);
    }
    return entry.isFile() && entry.name.toLowerCase().endsWith('.md')
      ? [path]
      : [];
  }));

  return paths.flat().sort();
}

function readFrontmatter(markdown: string): string {
  const normalized = markdown.replace(/^\uFEFF/, '');
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(normalized);
  return match?.[1] ?? '';
}

function readTitle(frontmatter: string, markdown: string, path: string): string {
  const titleLine = /^title:[ \t]*(.+?)[ \t]*$/m.exec(frontmatter)?.[1];
  if (titleLine) {
    return stripYamlScalar(titleLine);
  }

  const heading = /^#[ \t]+(.+?)[ \t]*$/m.exec(markdown)?.[1];
  return heading?.trim() || basename(path, '.md');
}

function readReviewDates(frontmatter: string): string[] {
  const lines = frontmatter.split(/\r?\n/);
  const dates = new Set<string>();
  let readingReviewDates = false;

  for (const line of lines) {
    const keyMatch = /^review_dates:[ \t]*(.*)$/.exec(line);
    if (keyMatch) {
      readingReviewDates = true;
      collectDateKeys(keyMatch[1] ?? '', dates);
      continue;
    }

    if (!readingReviewDates) {
      continue;
    }

    const itemMatch = /^[ \t]+-[ \t]+(.+)$/.exec(line);
    if (itemMatch) {
      collectDateKeys(itemMatch[1] ?? '', dates);
      continue;
    }

    if (line.trim() !== '') {
      readingReviewDates = false;
    }
  }

  return [...dates].sort();
}

function collectDateKeys(value: string, dates: Set<string>): void {
  for (const match of value.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
    const date = match[0];
    try {
      assertDateKey(date);
      dates.add(date);
    } catch {
      // Ignore malformed frontmatter values while scanning the rest of the wiki.
    }
  }
}

function stripYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function buildDueReviews(
  notes: LearningNote[],
  date: string,
  dailyDirectory: string,
  workspaceRoot: string,
  completedReviews: ReadonlySet<string>,
): DueReview[] {
  return notes.flatMap(note => {
    const notePath = join(workspaceRoot, ...note.relativePath.split('/'));
    const link = markdownRelativeLink(dailyDirectory, notePath);
    return note.reviewDates
      .filter(reviewDate =>
        reviewDate <= date
        && !completedReviews.has(reviewKey(note.relativePath, reviewDate)))
      .map(reviewDate => ({
        title: note.title,
        dueDate: reviewDate,
        relativePath: note.relativePath,
        link,
      }));
  }).sort((left, right) =>
    left.dueDate.localeCompare(right.dueDate)
      || left.title.localeCompare(right.title)
      || left.relativePath.localeCompare(right.relativePath));
}

async function readCompletedReviewKeys(
  dailyDirectory: string,
  date: string,
  workspaceRoot: string,
): Promise<Set<string>> {
  let entries;
  try {
    entries = await readdir(dailyDirectory, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return new Set();
    throw error;
  }

  const completed = new Set<string>();
  const dailyFiles = entries
    .filter(entry => entry.isFile())
    .map(entry => ({
      date: /^(\d{4}-\d{2}-\d{2})\.md$/.exec(entry.name)?.[1],
      path: join(dailyDirectory, entry.name),
    }))
    .filter((entry): entry is { date: string; path: string } =>
      entry.date !== undefined && entry.date < date)
    .sort((left, right) => left.date.localeCompare(right.date));

  for (const daily of dailyFiles) {
    const markdown = await readFile(daily.path, 'utf8');
    const reviewRegion = readRegion(markdown, REVIEW_START, REVIEW_END);
    if (!reviewRegion) continue;
    for (const match of reviewRegion.matchAll(
      /^[ \t]*-[ \t]+\[[xX]\][ \t]+\[[^\]\r\n]*\]\((<[^>\r\n]+>|[^)\r\n]+)\)[ \t]+—[ \t]+due[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*$/gm,
    )) {
      const rawDestination = (match[1] ?? '').replace(/^<|>$/gu, '');
      const dueDate = match[2];
      if (!dueDate) continue;
      const rawPath = rawDestination.split('#', 1)[0] ?? '';
      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(rawPath);
      } catch {
        continue;
      }
      const absoluteTarget = resolve(dirname(daily.path), decodedPath);
      const relativeTarget = relative(workspaceRoot, absoluteTarget);
      if (
        relativeTarget === ''
        || relativeTarget === '..'
        || relativeTarget.startsWith(`..${sep}`)
      ) {
        continue;
      }
      completed.add(reviewKey(toPosixPath(relativeTarget), dueDate));
    }
  }
  return completed;
}

async function findPreviousDailyNote(
  dailyDirectory: string,
  date: string,
): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(dailyDirectory, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }

  const previous = entries
    .filter(entry => entry.isFile())
    .map(entry => /^(\d{4}-\d{2}-\d{2})\.md$/.exec(entry.name)?.[1])
    .filter((entryDate): entryDate is string =>
      entryDate !== undefined && entryDate < date)
    .sort()
    .at(-1);
  return previous ? join(dailyDirectory, `${previous}.md`) : undefined;
}

function extractUncheckedTasks(markdown: string): string[] {
  const reviewRegion = readRegion(markdown, REVIEW_START, REVIEW_END);
  const taskMarkdown = reviewRegion
    ? markdown.replace(reviewRegion, '')
    : markdown;
  const tasks: string[] = [];
  const seen = new Set<string>();
  for (const match of taskMarkdown.matchAll(/^[ \t]*-[ \t]+\[[ \t]\][ \t]+(.+?)[ \t]*$/gim)) {
    const task = (match[1] ?? '').trim();
    const key = normalizeTask(task);
    if (task !== '' && !seen.has(key)) {
      seen.add(key);
      tasks.push(task);
    }
  }
  return tasks;
}

function renderDailyNote(
  existing: string | undefined,
  date: string,
  dueReviews: DueReview[],
  carriedTodos: string[],
): string {
  const existingReviewRegion = existing
    ? readRegion(existing, REVIEW_START, REVIEW_END)
    : undefined;
  const reviewStates = readTaskStates(existingReviewRegion ?? '');
  const reviewRegion = renderReviewRegion(dueReviews, reviewStates);
  const existingCarriedRegion = existing
    ? readRegion(existing, CARRIED_START, CARRIED_END)
    : undefined;
  const carriedStates = readTaskStates(existingCarriedRegion ?? '');
  const carriedRegion = renderCarriedRegion(carriedTodos, carriedStates);

  if (existing === undefined) {
    return [
      `# ${date}`,
      '',
      reviewRegion,
      '',
      renderTodaySection(),
      '',
      carriedRegion,
      '',
    ].join('\n');
  }

  let markdown = upsertRegion(existing, REVIEW_START, REVIEW_END, reviewRegion);
  if (!/^##[ \t]+Today[ \t]*$/m.test(markdown)) {
    markdown = appendBlock(markdown, renderTodaySection());
  }
  markdown = upsertRegion(markdown, CARRIED_START, CARRIED_END, carriedRegion);
  return ensureTrailingNewline(markdown);
}

function renderReviewRegion(
  reviews: DueReview[],
  existingStates: ReadonlyMap<string, string>,
): string {
  const lines = [
    REVIEW_START,
    '## Review plan',
    '',
  ];
  if (reviews.length === 0) {
    lines.push('No reviews due.');
  } else {
    for (const review of reviews) {
      const body = `[${escapeLinkText(review.title)}](${review.link}) — due ${review.dueDate}`;
      const state = existingStates.get(normalizeTask(body)) ?? ' ';
      lines.push(`- [${state}] ${body}`);
    }
  }
  lines.push(REVIEW_END);
  return lines.join('\n');
}

function renderTodaySection(): string {
  return [
    '## Today',
    '',
    '<!-- Add notes and tasks here. This section is preserved when the note is regenerated. -->',
  ].join('\n');
}

function renderCarriedRegion(
  tasks: string[],
  existingStates: ReadonlyMap<string, string> = new Map(),
): string {
  const lines = [
    CARRIED_START,
    '## Carried forward',
    '',
  ];
  if (tasks.length === 0) {
    lines.push('No unfinished tasks to carry forward.');
  } else {
    lines.push(...tasks.map(task => {
      const state = existingStates.get(normalizeTask(task)) ?? ' ';
      return `- [${state}] ${task}`;
    }));
  }
  lines.push(CARRIED_END);
  return lines.join('\n');
}

function readTaskStates(markdown: string): Map<string, string> {
  const states = new Map<string, string>();
  for (const match of markdown.matchAll(/^[ \t]*-[ \t]+\[([ xX])\][ \t]+(.+?)[ \t]*$/gm)) {
    const body = match[2] ?? '';
    states.set(normalizeTask(body), (match[1] ?? ' ').toLowerCase());
  }
  return states;
}

function normalizeTask(task: string): string {
  return task.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function reviewKey(relativePath: string, dueDate: string): string {
  return `${toPosixPath(relativePath).toLocaleLowerCase()}\u0000${dueDate}`;
}

function readRegion(
  markdown: string,
  startMarker: string,
  endMarker: string,
): string | undefined {
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1) {
    return undefined;
  }
  return markdown.slice(start, end + endMarker.length);
}

function upsertRegion(
  markdown: string,
  startMarker: string,
  endMarker: string,
  region: string,
): string {
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1) {
    return appendBlock(markdown, region);
  }
  return markdown.slice(0, start) + region + markdown.slice(end + endMarker.length);
}

function appendBlock(markdown: string, block: string): string {
  return `${markdown.replace(/\s*$/, '')}\n\n${block}\n`;
}

function ensureTrailingNewline(markdown: string): string {
  return `${markdown.replace(/\n*$/, '')}\n`;
}

function markdownRelativeLink(fromDirectory: string, targetPath: string): string {
  const path = toPosixPath(relative(fromDirectory, targetPath));
  return path
    .split('/')
    .map(segment => encodeURIComponent(segment).replace(/[!'()*]/g, character =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function escapeLinkText(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1');
}

function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/');
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
}

async function atomicWriteFile(path: string, markdown: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, markdown, 'utf8');
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === code;
}
