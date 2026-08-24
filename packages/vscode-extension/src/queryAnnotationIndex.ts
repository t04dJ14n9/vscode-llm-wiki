import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  readdir,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';
import YAML from 'yaml';
import type {
  LearningNoteStore,
  LearningSourceAnnotation,
} from './learningNoteStore';

export type QueryStatus = 'draft' | 'stable' | 'deprecated';

export interface QueryIndexDiagnostic {
  code: string;
  path?: string;
  message: string;
}

export interface SourceRange {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
}

interface BaseSourceAnchor {
  sourceId: string;
  resource: string;
  sourcePath: string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  sha256?: string;
}

export interface MarkdownSourceAnchor extends BaseSourceAnchor {
  kind: 'markdown';
  from?: number;
  to?: number;
  startLine?: number;
  endLine?: number;
}

export interface PdfSourceAnchor extends BaseSourceAnchor {
  kind: 'pdf';
  page: number;
  rects: readonly (readonly [number, number, number, number])[];
}

export interface CodeSourceAnchor extends BaseSourceAnchor {
  kind: 'code';
  repository: string;
  revision: string;
  path: string;
  symbol?: string;
  startLine: number;
  endLine: number;
}

export type QuerySourceAnchor =
  | MarkdownSourceAnchor
  | PdfSourceAnchor
  | CodeSourceAnchor;

export interface QueryNavigationTarget {
  kind: 'query';
  queryPath: string;
  selectionId: string;
}

export interface LegacyNavigationTarget {
  kind: 'legacy';
  discussionId: string;
  notePath: string;
}

export interface LoadedLegacyNavigationTarget extends LegacyNavigationTarget {
  absolutePath: string;
}

export type AnnotationNavigationTarget = QueryNavigationTarget | LegacyNavigationTarget;

export interface QuerySourceAnnotation {
  queryPath: string;
  title: string;
  status: QueryStatus;
  condensedSummary: string;
  project?: string;
  updatedTime: string;
  sourcePath: string;
  anchor: QuerySourceAnchor;
  navigationTarget: AnnotationNavigationTarget;
  compatibility?: 'legacy-learning-note';
}

export interface MarkdownAnchorResolution {
  range?: SourceRange;
  relocated?: boolean;
  diagnostic?: QueryIndexDiagnostic;
}

export interface PdfAnchorResolution {
  geometry?: {
    page: number;
    rects: readonly (readonly [number, number, number, number])[];
  };
  diagnostic?: QueryIndexDiagnostic;
}

interface LegacyStoreAdapter {
  listAnnotationsForSource(sourcePath: string): Promise<LearningSourceAnnotation[]>;
  loadDiscussion(
    discussionId: string,
    notePath?: string,
  ): ReturnType<LearningNoteStore['loadDiscussion']>;
}

export interface QueryAnnotationIndexOptions {
  legacyStore?: LegacyStoreAdapter;
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface AnnotationListOptions {
  refresh?: boolean;
}

export interface AnnotationNavigationLookup {
  kind?: 'query' | 'legacy';
  queryPath?: string;
  selectionId?: string;
  discussionId?: string;
  notePath?: string;
}

interface ParsedQuery {
  navigationTarget: QueryNavigationTarget;
  annotations: QuerySourceAnnotation[];
}

interface QuerySource {
  id: string;
  resource: string;
  title: string;
  sha256?: string;
  repository?: string;
  revision?: string;
  path?: string;
}

interface WatcherDisposable {
  dispose(): void;
}

interface QueryWatcher {
  onDidChange(listener: () => void): unknown;
  onDidCreate(listener: () => void): unknown;
  onDidDelete(listener: () => void): unknown;
  dispose(): void;
}

interface QueryWatcherHost {
  createFileSystemWatcher(pattern: string): QueryWatcher;
}

interface SubscriptionContext {
  subscriptions: { push(...items: WatcherDisposable[]): unknown };
}

interface QueryInvalidator {
  invalidate(): void;
}

export interface QueryWatcherOptions {
  debounceMs?: number;
}

const QUERY_PATTERNS = [
  'queries/*.md',
  'projects/*/queries/*.md',
  'wiki/learning/*.md',
] as const;
const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const MAX_TITLE_CODE_POINTS = 512;
const MAX_DESCRIPTION_CODE_POINTS = 8_192;
const MAX_SELECTION_ID_CODE_POINTS = 1_024;
const MAX_RESOURCE_CODE_POINTS = 4_096;
const MAX_QUOTE_CODE_POINTS = 64 * 1_024;
const MAX_CONTEXT_CODE_POINTS = 8 * 1_024;
const SHA256 = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const ACTOR = /^(?:human:\S+|process:\S+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:+-]+)$/u;
const STATUS_ORDER: Record<QueryStatus, number> = {
  stable: 0,
  draft: 1,
  deprecated: 2,
};

export function compareQueryAnnotations(
  left: QuerySourceAnnotation,
  right: QuerySourceAnnotation,
): number {
  return STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
    || right.updatedTime.localeCompare(left.updatedTime)
    || left.queryPath.localeCompare(right.queryPath)
    || left.anchor.sourceId.localeCompare(right.anchor.sourceId);
}

export function resolveMarkdownAnchor(
  input: MarkdownSourceAnchor | Record<string, unknown>,
  currentText: string,
): MarkdownAnchorResolution {
  const quote = optionalString(input.quote);
  const expectedHash = optionalString(input.sha256);
  const from = integerField(input, 'from');
  const to = integerField(input, 'to');
  const currentHash = sha256(currentText);
  if (
    expectedHash
    && SHA256.test(expectedHash)
    && expectedHash === currentHash
    && from !== undefined
    && to !== undefined
    && validOffsetRange(from, to, currentText.length)
    && (!quote || currentText.slice(from, to) === quote)
  ) {
    return {
      range: rangeFromOffsets(currentText, from, to),
      relocated: false,
    };
  }

  if (!quote) {
    return diagnostic('markdown-relocation-missing', 'Markdown quote is unavailable for relocation.');
  }
  const matches = quoteMatches(
    currentText,
    quote,
    optionalString(input.prefix),
    optionalString(input.suffix),
  );
  if (matches.length === 0) {
    return diagnostic('markdown-relocation-missing', 'Markdown quote no longer occurs with its context.');
  }
  if (matches.length !== 1) {
    return diagnostic('markdown-relocation-ambiguous', 'Markdown quote occurs more than once.');
  }
  const relocatedFrom = matches[0];
  if (relocatedFrom === undefined) {
    return diagnostic('markdown-relocation-missing', 'Markdown quote could not be relocated.');
  }
  return {
    range: rangeFromOffsets(currentText, relocatedFrom, relocatedFrom + quote.length),
    relocated: true,
  };
}

export function resolvePdfAnchor(
  input: PdfSourceAnchor | Record<string, unknown>,
  currentBytes: Uint8Array,
): PdfAnchorResolution {
  const page = integerField(input, 'page');
  const rects = pdfRects(input);
  if (page === undefined || page < 1 || rects === undefined) {
    return diagnostic('pdf-geometry-invalid', 'PDF page and rectangles must be finite and positive.');
  }
  const expectedHash = optionalString(input.sha256);
  if (!expectedHash || !SHA256.test(expectedHash) || expectedHash !== sha256(currentBytes)) {
    return diagnostic('pdf-stale', 'PDF bytes differ from the Query anchor hash.');
  }
  return { geometry: { page, rects } };
}

export class QueryAnnotationIndex {
  private readonly workspaceRoot: string;
  private readonly legacyStore?: LegacyStoreAdapter;
  private readonly maxFiles: number;
  private readonly maxFileBytes: number;
  private readonly listeners = new Set<() => void>();
  private annotationsBySource = new Map<string, QuerySourceAnnotation[]>();
  private navigationByPath = new Map<string, QueryNavigationTarget>();
  private navigationBySelection = new Map<string, QueryNavigationTarget>();
  private diagnosticEntries: QueryIndexDiagnostic[] = [];
  private loaded = false;
  private loading: Promise<void> | undefined;
  private disposed = false;

  constructor(workspaceRoot: string, options: QueryAnnotationIndexOptions = {}) {
    if (!workspaceRoot.trim()) throw new TypeError('workspaceRoot must not be empty');
    this.workspaceRoot = resolve(workspaceRoot);
    this.legacyStore = options.legacyStore;
    this.maxFiles = positiveInteger(options.maxFiles, DEFAULT_MAX_FILES);
    this.maxFileBytes = positiveInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  }

  get diagnostics(): readonly QueryIndexDiagnostic[] {
    return this.diagnosticEntries;
  }

  onDidChange(listener: () => void): WatcherDisposable {
    if (this.disposed) return { dispose() {} };
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  invalidate(): void {
    if (this.disposed) return;
    this.loaded = false;
    for (const listener of this.listeners) listener();
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.loading) return this.loading;
    const refresh = this.refreshUnlocked();
    this.loading = refresh;
    try {
      await refresh;
    } finally {
      if (this.loading === refresh) this.loading = undefined;
    }
  }

  async listAnnotationsForSource(
    sourcePath: string,
    options: AnnotationListOptions = {},
  ): Promise<QuerySourceAnnotation[]> {
    const normalized = normalizeWorkspacePath(sourcePath);
    if (!normalized) return [];
    if (options.refresh) this.loaded = false;
    await this.ensureLoaded();
    const queryAnnotations = this.annotationsBySource.get(sourceKey(normalized)) ?? [];
    const legacyAnnotations = await this.legacyAnnotations(normalized);
    return [...queryAnnotations, ...legacyAnnotations].sort(compareQueryAnnotations);
  }

  async loadNavigationTarget(
    target: AnnotationNavigationLookup,
  ): Promise<QueryNavigationTarget | LoadedLegacyNavigationTarget | undefined> {
    if (target.kind === 'legacy' || target.discussionId !== undefined) {
      if (!this.legacyStore) return undefined;
      const discussionId = boundedString(target.discussionId, MAX_SELECTION_ID_CODE_POINTS);
      const notePath = normalizeWorkspacePath(target.notePath ?? '');
      if (!discussionId || !notePath || !isLegacyPath(notePath)) return undefined;
      const loaded = await this.legacyStore.loadDiscussion(discussionId, notePath);
      if (!loaded) return undefined;
      return {
        kind: 'legacy',
        discussionId,
        notePath,
        absolutePath: loaded.note.absolutePath,
      };
    }
    await this.ensureLoaded();
    const selectionId = boundedString(target.selectionId, MAX_SELECTION_ID_CODE_POINTS);
    if (selectionId) return this.navigationBySelection.get(selectionId);
    const queryPath = normalizeWorkspacePath(target.queryPath ?? '');
    return queryPath ? this.navigationByPath.get(queryPath) : undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.annotationsBySource.clear();
    this.navigationByPath.clear();
    this.navigationBySelection.clear();
    this.diagnosticEntries = [];
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.refresh();
  }

  private async refreshUnlocked(): Promise<void> {
    const diagnostics: QueryIndexDiagnostic[] = [];
    const files = await queryFiles(this.workspaceRoot);
    if (files.length > this.maxFiles) {
      diagnostics.push({
        code: 'query-file-limit',
        message: `Query discovery is limited to ${this.maxFiles} files.`,
      });
    }
    const annotationsBySource = new Map<string, QuerySourceAnnotation[]>();
    const navigationByPath = new Map<string, QueryNavigationTarget>();
    const navigationBySelection = new Map<string, QueryNavigationTarget>();
    for (const absolutePath of files.slice(0, this.maxFiles)) {
      const queryPath = workspaceRelativePath(this.workspaceRoot, absolutePath);
      if (!queryPath) continue;
      const size = await ordinaryFileSize(absolutePath);
      if (size === undefined) continue;
      if (size > this.maxFileBytes) {
        diagnostics.push({
          code: 'query-size',
          path: queryPath,
          message: `Query page exceeds ${this.maxFileBytes} bytes.`,
        });
        continue;
      }
      let markdown: string;
      try {
        markdown = await readFile(absolutePath, 'utf8');
      } catch (error) {
        diagnostics.push({
          code: 'query-read',
          path: queryPath,
          message: errorMessage(error),
        });
        continue;
      }
      const parsed = parseQuery(
        this.workspaceRoot,
        absolutePath,
        queryPath,
        markdown,
        diagnostics,
      );
      if (!parsed) continue;
      if (!navigationByPath.has(queryPath)) {
        navigationByPath.set(queryPath, parsed.navigationTarget);
      }
      if (!navigationBySelection.has(parsed.navigationTarget.selectionId)) {
        navigationBySelection.set(parsed.navigationTarget.selectionId, parsed.navigationTarget);
      }
      for (const annotation of parsed.annotations) {
        const key = sourceKey(annotation.sourcePath);
        const current = annotationsBySource.get(key) ?? [];
        current.push(annotation);
        annotationsBySource.set(key, current);
      }
    }
    for (const annotations of annotationsBySource.values()) {
      annotations.sort(compareQueryAnnotations);
    }
    this.annotationsBySource = annotationsBySource;
    this.navigationByPath = navigationByPath;
    this.navigationBySelection = navigationBySelection;
    this.diagnosticEntries = diagnostics;
    this.loaded = true;
  }

  private async legacyAnnotations(sourcePath: string): Promise<QuerySourceAnnotation[]> {
    if (!this.legacyStore) return [];
    const legacy = await this.legacyStore.listAnnotationsForSource(sourcePath);
    return legacy.map(annotation => adaptLegacyAnnotation(sourcePath, annotation));
  }
}

export function registerQueryAnnotationWatchers(
  context: SubscriptionContext,
  host: QueryWatcherHost,
  index: QueryInvalidator,
  options: QueryWatcherOptions = {},
): WatcherDisposable {
  const debounceMs = options.debounceMs ?? 150;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const schedule = (): void => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      if (!disposed) index.invalidate();
    }, debounceMs);
    timer.unref?.();
  };
  const watchers = QUERY_PATTERNS.map(pattern => host.createFileSystemWatcher(pattern));
  for (const watcher of watchers) {
    watcher.onDidChange(schedule);
    watcher.onDidCreate(schedule);
    watcher.onDidDelete(schedule);
  }
  const controller = {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
  context.subscriptions.push(...watchers, controller);
  return controller;
}

function parseQuery(
  workspaceRoot: string,
  absolutePath: string,
  queryPath: string,
  markdown: string,
  diagnostics: QueryIndexDiagnostic[],
): ParsedQuery | undefined {
  let metadata: unknown;
  try {
    metadata = frontmatter(markdown);
  } catch (error) {
    diagnostics.push({ code: 'query-yaml', path: queryPath, message: errorMessage(error) });
    return undefined;
  }
  if (!record(metadata) || metadata.type !== 'Query') {
    diagnostics.push({ code: 'query-schema', path: queryPath, message: 'Expected type: Query.' });
    return undefined;
  }
  const title = boundedString(metadata.title, MAX_TITLE_CODE_POINTS);
  const description = boundedString(metadata.description, MAX_DESCRIPTION_CODE_POINTS);
  const condensedSummary = validSummary(metadata.condensed_summary);
  const status = queryStatus(metadata.status);
  const generated = record(metadata.generated) ? metadata.generated : undefined;
  const generatedAt = generated && isoDate(generated.at) ? generated.at : undefined;
  const generatedBy = generated && boundedString(generated.by, 512);
  const project = metadata.project === undefined
    ? undefined
    : projectId(metadata.project);
  const conversation = record(metadata.conversation) ? metadata.conversation : undefined;
  const selectionId = conversation
    ? boundedString(conversation.selection_id, MAX_SELECTION_ID_CODE_POINTS)
    : undefined;
  if (
    !title
    || !description
    || !condensedSummary
    || !status
    || !generatedAt
    || !generatedBy
    || !ACTOR.test(generatedBy)
    || (metadata.project !== undefined && !project)
    || !selectionId
  ) {
    diagnostics.push({ code: 'query-schema', path: queryPath, message: 'Query fields are invalid.' });
    return undefined;
  }
  const sources = querySources(metadata.sources);
  if (!sources) {
    diagnostics.push({ code: 'query-source', path: queryPath, message: 'Query sources are invalid.' });
    return undefined;
  }
  const updatedTime = isoDate(metadata.updated) ? metadata.updated : generatedAt;
  const navigationTarget: QueryNavigationTarget = {
    kind: 'query',
    queryPath,
    selectionId,
  };
  const anchors = queryAnchors(
    workspaceRoot,
    absolutePath,
    queryPath,
    metadata.anchors,
    sources,
    status,
  );
  if (!anchors) {
    diagnostics.push({ code: 'query-anchor', path: queryPath, message: 'Query anchors are invalid.' });
    return undefined;
  }
  return {
    navigationTarget,
    annotations: anchors.map(anchor => ({
      queryPath,
      title,
      status,
      condensedSummary,
      ...(project ? { project } : {}),
      updatedTime,
      sourcePath: anchor.sourcePath,
      anchor,
      navigationTarget,
    })),
  };
}

function querySources(input: unknown): Map<string, QuerySource> | undefined {
  if (!Array.isArray(input) || input.length === 0 || input.length > 256) return undefined;
  const sources = new Map<string, QuerySource>();
  for (const value of input) {
    if (!record(value)) return undefined;
    const id = boundedString(value.id, 512);
    const resource = boundedString(value.resource, MAX_RESOURCE_CODE_POINTS);
    const title = boundedString(value.title, MAX_TITLE_CODE_POINTS);
    if (!id || !resource || !title || sources.has(id)) return undefined;
    sources.set(id, {
      id,
      resource,
      title,
      ...(optionalString(value.sha256) ? { sha256: optionalString(value.sha256) } : {}),
      ...(optionalString(value.repository) ? { repository: optionalString(value.repository) } : {}),
      ...(optionalString(value.revision) ? { revision: optionalString(value.revision) } : {}),
      ...(optionalString(value.path) ? { path: optionalString(value.path) } : {}),
    });
  }
  return sources;
}

function queryAnchors(
  workspaceRoot: string,
  queryAbsolutePath: string,
  queryPath: string,
  input: unknown,
  sources: Map<string, QuerySource>,
  status: QueryStatus,
): QuerySourceAnchor[] | undefined {
  if (!Array.isArray(input) || input.length === 0 || input.length > 1_024) return undefined;
  const anchors: QuerySourceAnchor[] = [];
  for (const value of input) {
    if (!record(value)) return undefined;
    const sourceId = boundedString(value.source_id, 512);
    const source = sourceId ? sources.get(sourceId) : undefined;
    const resource = boundedString(value.resource, MAX_RESOURCE_CODE_POINTS);
    if (!sourceId || !source || !resource || resource !== source.resource) return undefined;
    const sourcePath = resolveSourcePath(workspaceRoot, queryAbsolutePath, resource);
    if (!sourcePath) return undefined;
    const common = anchorCommon(value, sourceId, resource, sourcePath);
    if (!common) return undefined;
    let anchor: QuerySourceAnchor | undefined;
    if (value.kind === 'markdown') {
      anchor = markdownAnchor(value, common, status);
    } else if (value.kind === 'pdf') {
      anchor = pdfAnchor(value, common, status);
    } else if (value.kind === 'code') {
      anchor = codeAnchor(value, source, common, status);
    }
    if (!anchor) return undefined;
    anchors.push(anchor);
  }
  if (!isQueryPagePath(queryPath)) return undefined;
  return anchors;
}

function anchorCommon(
  value: Record<string, unknown>,
  sourceId: string,
  resource: string,
  sourcePath: string,
): BaseSourceAnchor | undefined {
  const quote = boundedOptionalString(value.quote, MAX_QUOTE_CODE_POINTS);
  const prefix = boundedOptionalString(value.prefix, MAX_CONTEXT_CODE_POINTS);
  const suffix = boundedOptionalString(value.suffix, MAX_CONTEXT_CODE_POINTS);
  const digest = optionalString(value.sha256);
  if (
    value.quote !== undefined && quote === undefined
    || value.prefix !== undefined && prefix === undefined
    || value.suffix !== undefined && suffix === undefined
    || digest !== undefined && !SHA256.test(digest)
  ) return undefined;
  return {
    sourceId,
    resource,
    sourcePath,
    ...(quote ? { quote } : {}),
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
    ...(digest ? { sha256: digest } : {}),
  };
}

function markdownAnchor(
  value: Record<string, unknown>,
  common: BaseSourceAnchor,
  status: QueryStatus,
): MarkdownSourceAnchor | undefined {
  const from = integerField(value, 'from');
  const to = integerField(value, 'to');
  const startLine = integerField(value, 'start_line');
  const endLine = integerField(value, 'end_line');
  const offsetsValid = from !== undefined && to !== undefined && from >= 0 && to > from;
  const linesValid = validLines(startLine, endLine);
  if (!offsetsValid && !linesValid) return undefined;
  if (status === 'stable' && (!common.sha256 || !common.quote)) return undefined;
  return {
    ...common,
    kind: 'markdown',
    ...(offsetsValid ? { from, to } : {}),
    ...(linesValid ? { startLine, endLine } : {}),
  };
}

function pdfAnchor(
  value: Record<string, unknown>,
  common: BaseSourceAnchor,
  status: QueryStatus,
): PdfSourceAnchor | undefined {
  const page = integerField(value, 'page');
  const rects = pdfRects(value);
  if (page === undefined || page < 1 || !rects) return undefined;
  if (status === 'stable' && (!common.sha256 || !common.quote)) return undefined;
  return { ...common, kind: 'pdf', page, rects };
}

function codeAnchor(
  value: Record<string, unknown>,
  source: QuerySource,
  common: BaseSourceAnchor,
  status: QueryStatus,
): CodeSourceAnchor | undefined {
  const repository = boundedString(value.repository, 512);
  const revision = optionalString(value.revision);
  const path = normalizeRepositoryPath(value.path);
  const symbol = boundedOptionalString(value.symbol, 1_024);
  const startLine = integerField(value, 'start_line');
  const endLine = integerField(value, 'end_line');
  const digest = common.sha256 ?? source.sha256;
  if (
    !repository
    || repository !== source.repository
    || !revision
    || revision !== source.revision
    || !REVISION.test(revision)
    || !path
    || path !== source.path
    || startLine === undefined
    || endLine === undefined
    || !validLines(startLine, endLine)
    || (value.symbol !== undefined && symbol === undefined)
    || (status === 'stable' && (!digest || !SHA256.test(digest)))
  ) return undefined;
  return {
    ...common,
    ...(digest ? { sha256: digest } : {}),
    kind: 'code',
    repository,
    revision,
    path,
    ...(symbol ? { symbol } : {}),
    startLine,
    endLine,
  };
}

function adaptLegacyAnnotation(
  sourcePath: string,
  annotation: LearningSourceAnnotation,
): QuerySourceAnnotation {
  const anchor: MarkdownSourceAnchor = {
    kind: 'markdown',
    sourceId: `legacy:${annotation.discussionId}`,
    resource: sourcePath,
    sourcePath,
    quote: annotation.quote,
    ...(annotation.from !== undefined ? { from: annotation.from } : {}),
    ...(annotation.to !== undefined ? { to: annotation.to } : {}),
    ...(annotation.startLine !== undefined ? { startLine: annotation.startLine } : {}),
    ...(annotation.endLine !== undefined ? { endLine: annotation.endLine } : {}),
  };
  return {
    queryPath: annotation.notePath,
    title: annotation.question || 'Legacy learning note',
    status: 'deprecated',
    condensedSummary: annotation.summary,
    updatedTime: '1970-01-01T00:00:00.000Z',
    sourcePath,
    anchor,
    navigationTarget: {
      kind: 'legacy',
      discussionId: annotation.discussionId,
      notePath: annotation.notePath,
    },
    compatibility: 'legacy-learning-note',
  };
}

async function queryFiles(workspaceRoot: string): Promise<string[]> {
  const results: string[] = [];
  results.push(...await directMarkdownFiles(resolve(workspaceRoot, 'queries')));
  const projectsRoot = resolve(workspaceRoot, 'projects');
  for (const project of await directDirectories(projectsRoot)) {
    results.push(...await directMarkdownFiles(resolve(projectsRoot, project, 'queries')));
  }
  return results.sort((left, right) => left.localeCompare(right));
}

async function directDirectories(directory: string): Promise<string[]> {
  if (!await ordinaryDirectory(directory)) return [];
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function directMarkdownFiles(directory: string): Promise<string[]> {
  if (!await ordinaryDirectory(directory)) return [];
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && !entry.isSymbolicLink() && entry.name.toLowerCase().endsWith('.md'))
      .map(entry => resolve(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function ordinaryDirectory(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function ordinaryFileSize(path: string): Promise<number | undefined> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink() ? metadata.size : undefined;
  } catch {
    return undefined;
  }
}

function frontmatter(markdown: string): unknown {
  const normalized = markdown.replace(/\r\n/gu, '\n');
  if (!normalized.startsWith('---\n')) throw new Error('Query frontmatter is missing.');
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('Query frontmatter is unterminated.');
  const document = YAML.parseDocument(normalized.slice(4, end), {
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(document.errors[0]?.message ?? 'Query YAML is invalid.');
  }
  return document.toJS({ maxAliasCount: 0 });
}

function resolveSourcePath(
  workspaceRoot: string,
  queryAbsolutePath: string,
  resource: string,
): string | undefined {
  if (
    isAbsolute(resource)
    || resource.includes('\\')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(resource)
  ) return undefined;
  const target = resolve(dirname(queryAbsolutePath), ...resource.split('/'));
  return workspaceRelativePath(workspaceRoot, target);
}

function workspaceRelativePath(workspaceRoot: string, absolutePath: string): string | undefined {
  const value = relative(workspaceRoot, absolutePath).replace(/\\/gu, '/');
  return normalizeWorkspacePath(value);
}

function normalizeWorkspacePath(value: string): string | undefined {
  if (!value || isAbsolute(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) return undefined;
  const parts: string[] = [];
  for (const part of value.replace(/\\/gu, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.length > 0 ? parts.join('/') : undefined;
}

function normalizeRepositoryPath(input: unknown): string | undefined {
  if (typeof input !== 'string' || !input || isAbsolute(input) || input.includes('\\')) return undefined;
  const normalized = normalizeWorkspacePath(input);
  return normalized === input ? normalized : undefined;
}

function sourceKey(sourcePath: string): string {
  return sourcePath.toLocaleLowerCase('en-US');
}

export function isQueryPagePath(queryPath: string): boolean {
  const parts = queryPath.split('/');
  return parts.length === 2 && parts[0] === 'queries'
    || parts.length === 4 && parts[0] === 'projects' && parts[2] === 'queries';
}

function isLegacyPath(path: string): boolean {
  const parts = path.split('/');
  return parts.length === 3
    && parts[0] === 'wiki'
    && parts[1] === 'learning'
    && parts[2]?.toLowerCase().endsWith('.md') === true;
}

function queryStatus(value: unknown): QueryStatus | undefined {
  return value === 'draft' || value === 'stable' || value === 'deprecated'
    ? value
    : undefined;
}

function projectId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/u.test(value)
    ? value
    : undefined;
}

function validSummary(value: unknown): string | undefined {
  const summary = boundedString(value, 360);
  if (!summary) return undefined;
  const sentenceCount = [...summary.matchAll(/[.!?](?=\s|$)/gu)].length;
  return sentenceCount >= 1 && sentenceCount <= 2 ? summary : undefined;
}

function boundedString(value: unknown, maxCodePoints: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && [...trimmed].length <= maxCodePoints ? trimmed : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function boundedOptionalString(value: unknown, maxCodePoints: number): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' && [...value].length <= maxCodePoints ? value : undefined;
}

function integerField(value: object, key: string): number | undefined {
  const candidate = (value as Record<string, unknown>)[key];
  return Number.isSafeInteger(candidate) ? candidate as number : undefined;
}

function validLines(
  startLine: number | undefined,
  endLine: number | undefined,
): startLine is number {
  return startLine !== undefined && endLine !== undefined && startLine >= 1 && endLine >= startLine;
}

function validOffsetRange(from: number, to: number, length: number): boolean {
  return from >= 0 && to > from && to <= length;
}

function rangeFromOffsets(text: string, from: number, to: number): SourceRange {
  return {
    from,
    to,
    startLine: lineAt(text, from),
    endLine: lineAt(text, Math.max(from, to - 1)),
  };
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function quoteMatches(
  text: string,
  quote: string,
  prefix: string | undefined,
  suffix: string | undefined,
): number[] {
  const matches: number[] = [];
  let from = 0;
  while (from <= text.length - quote.length) {
    const index = text.indexOf(quote, from);
    if (index < 0) break;
    const prefixMatches = prefix === undefined
      || text.slice(Math.max(0, index - prefix.length), index) === prefix;
    const suffixMatches = suffix === undefined
      || text.slice(index + quote.length, index + quote.length + suffix.length) === suffix;
    if (prefixMatches && suffixMatches) matches.push(index);
    from = index + Math.max(1, quote.length);
  }
  return matches;
}

function pdfRects(
  input: object,
): readonly (readonly [number, number, number, number])[] | undefined {
  const value = input as Record<string, unknown>;
  const candidates = Array.isArray(value.rects)
    ? value.rects
    : Array.isArray(value.viewrect)
      ? [value.viewrect]
      : undefined;
  if (!candidates || candidates.length === 0 || candidates.length > 1_000) return undefined;
  const rects: [number, number, number, number][] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length !== 4) return undefined;
    const values = candidate as unknown[];
    const left = values[0];
    const top = values[1];
    const width = values[2];
    const height = values[3];
    if (
      typeof left !== 'number'
      || typeof top !== 'number'
      || typeof width !== 'number'
      || typeof height !== 'number'
      || !Number.isFinite(left)
      || !Number.isFinite(top)
      || !Number.isFinite(width)
      || !Number.isFinite(height)
      || left < 0
      || top < 0
      || width <= 0
      || height <= 0
    ) return undefined;
    rects.push([left, top, width, height]);
  }
  return rects;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}

function isoDate(value: unknown): value is string {
  return typeof value === 'string'
    && value.includes('T')
    && Number.isFinite(Date.parse(value));
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function diagnostic(code: string, message: string): { diagnostic: QueryIndexDiagnostic } {
  return { diagnostic: { code, message } };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
