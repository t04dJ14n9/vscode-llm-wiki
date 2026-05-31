import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Range, Transaction } from '@codemirror/state';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import {
  inlineCodeSourceSpans,
  isEscapedAt,
  markdownLinkSourceSpans,
  markdownReferenceDefinitions,
  markdownReferenceDefinitionSourceSpans,
  markdownReferenceLinkSourceSpans,
  overlapsSpan,
  parseMarkdownLinkDestination,
} from '../markdownSpans';
import { isCodeFenceClosing, parseCodeFenceOpening } from '../markdownFences';
import { setextHeadingLevelForLines } from '../../src/markdownHeadingSyntax';
import { parseWikiLinkTarget } from '../../src/wikiLinks';
import { addCodeBlockDecorations, addCodeSyntaxDecorations } from './hybridCodeBlocks';
import {
  ImageWidget,
  parseObsidianImageEmbed,
  renderedImageElement,
  resolveImageResource,
} from './hybridImages';
import type { ImageDimensions } from './hybridImages';
import { hybridStyles } from './hybridStyles';
import { FrontmatterPropertiesWidget, findFrontmatterBlock } from './hybridFrontmatter';
import {
  addMultiLineMathDecorations,
  addSingleLineMathDecorations,
  InlineMathWidget,
  MathBlockWidget,
  renderMathInto,
} from './hybridMath';
import {
  applyTableCellAlignment,
  buildTableDecorations as buildTableRenderingDecorations,
  findTableBlock,
  parseTableRowCells,
  tableAlignmentsFromSeparator,
} from './hybridTables';
import type { TableAlignment, TableCell } from './hybridTables';
export { initialBodyPositionAfterFrontmatter } from './hybridFrontmatter';
export { setImageResourceContext } from './hybridImages';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'dark',
});
let mermaidRenderSequence = 0;

class EmptyWidget extends WidgetType {
  override toDOM(): HTMLElement {
    return document.createElement('span');
  }

  override eq(): boolean {
    return true;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class FootnoteDefinitionSeparatorWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-hybrid-footnote-def-separator';
    span.textContent = '. ';
    return span;
  }

  override eq(other: FootnoteDefinitionSeparatorWidget): boolean {
    return other instanceof FootnoteDefinitionSeparatorWidget;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class InlineHtmlWidget extends WidgetType {
  constructor(
    private readonly html: string,
    private readonly sourceFrom: number,
    private readonly sourceTo: number,
  ) {
    super();
  }

  override toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-hybrid-inline-html';
    span.dataset.sourceFrom = String(this.sourceFrom);
    span.dataset.sourceTo = String(this.sourceTo);

    const sanitized = DOMPurify.sanitize(this.html, { USE_PROFILES: { html: true } });
    if (sanitized.trim().length > 0) {
      const template = document.createElement('template');
      template.innerHTML = sanitized;
      span.append(...Array.from(template.content.childNodes));
    }

    span.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.sourceFrom } });
      view.focus();
    });

    return span;
  }

  override eq(other: InlineHtmlWidget): boolean {
    return this.html === other.html
      && this.sourceFrom === other.sourceFrom
      && this.sourceTo === other.sourceTo;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

class DocumentTitleWidget extends WidgetType {
  constructor(private readonly title: string) {
    super();
  }

  override toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.className = 'cm-hybrid-document-title cm-hybrid-document-title-input';
    input.type = 'text';
    input.value = this.title;
    input.ariaLabel = 'note title';
    input.contentEditable = 'false';
    input.spellcheck = false;
    let lastCommittedTitle = this.title;
    let skipBlurCommit = false;

    const restoreTitleFocus = () => {
      if (!input.isConnected) return;
      input.focus({ preventScroll: true });
      input.select();
    };

    const restoreTitleFocusSoon = () => {
      restoreTitleFocus();
      window.requestAnimationFrame(restoreTitleFocus);
      window.setTimeout(restoreTitleFocus, 0);
      window.setTimeout(restoreTitleFocus, 25);
      window.setTimeout(() => {
        skipBlurCommit = false;
        restoreTitleFocus();
      }, 75);
    };

    const commitTitle = () => {
      const nextTitle = input.value.trim();
      if (nextTitle.length === 0) {
        input.value = lastCommittedTitle;
        return;
      }
      if (nextTitle === lastCommittedTitle) {
        input.value = nextTitle;
        return;
      }
      lastCommittedTitle = nextTitle;
      skipBlurCommit = true;
      view.dom.dispatchEvent(new CustomEvent('human-learning-title-rename', {
        bubbles: true,
        detail: { title: nextTitle },
      }));
      restoreTitleFocusSoon();
    };

    const stopEditorHandling = (event: Event) => {
      event.stopPropagation();
    };
    input.addEventListener('pointerdown', stopEditorHandling);
    input.addEventListener('mousedown', stopEditorHandling);
    input.addEventListener('mouseup', stopEditorHandling);
    input.addEventListener('click', stopEditorHandling);
    input.addEventListener('dblclick', stopEditorHandling);
    input.addEventListener('beforeinput', stopEditorHandling);
    input.addEventListener('input', stopEditorHandling);
    input.addEventListener('compositionstart', stopEditorHandling);
    input.addEventListener('compositionupdate', stopEditorHandling);
    input.addEventListener('compositionend', stopEditorHandling);
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commitTitle();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        skipBlurCommit = true;
        input.value = this.title;
        input.blur();
        view.focus();
      }
    });
    input.addEventListener('blur', () => {
      if (skipBlurCommit) return;
      commitTitle();
    });
    return input;
  }

  override eq(other: DocumentTitleWidget): boolean {
    return this.title === other.title;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class HorizontalRuleWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const element = document.createElement('div');
    element.className = 'cm-hybrid-hr';
    return element;
  }

  override eq(): boolean {
    return true;
  }
}

class BulletWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-hybrid-bullet';
    element.textContent = '-';
    return element;
  }
}

class NumberWidget extends WidgetType {
  constructor(private readonly value: string) {
    super();
  }

  override toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-hybrid-number';
    element.textContent = this.value;
    return element;
  }

  override eq(other: NumberWidget): boolean {
    return this.value === other.value;
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly statusFrom: number,
    private readonly orderedMarker?: string,
  ) {
    super();
  }

  override toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('input');
    element.type = 'checkbox';
    element.className = 'cm-hybrid-task-checkbox';
    element.checked = this.checked;
    element.title = this.checked ? 'Mark incomplete' : 'Mark complete';
    element.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    element.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        changes: { from: this.statusFrom, to: this.statusFrom + 1, insert: this.checked ? ' ' : 'x' },
        selection: { anchor: this.statusFrom + 1 },
      });
      view.focus();
    });
    if (this.orderedMarker) {
      const wrapper = document.createElement('span');
      wrapper.className = 'cm-hybrid-task-prefix';
      const marker = document.createElement('span');
      marker.className = 'cm-hybrid-number';
      marker.textContent = this.orderedMarker;
      wrapper.append(marker, element);
      return wrapper;
    }
    return element;
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return this.checked === other.checked
      && this.statusFrom === other.statusFrom
      && this.orderedMarker === other.orderedMarker;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class CalloutWidget extends WidgetType {
  constructor(
    private readonly type: string,
    private readonly title: string,
    private readonly titleFrom: number,
    private readonly body: string,
    private readonly foldMarker: '+' | '-' | undefined,
    private readonly blockFrom: number,
    private readonly blockTo: number,
  ) {
    super();
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `cm-hybrid-callout cm-hybrid-callout-${this.type.toLowerCase()}`;
    wrapper.dataset.sourceFrom = String(this.blockFrom);
    wrapper.dataset.sourceTo = String(this.blockTo);

    const title = document.createElement('div');
    title.className = 'cm-hybrid-callout-title';
    let body: HTMLDivElement | undefined;
    const folded = this.foldMarker === '-';
    if (this.foldMarker && this.body.trim().length > 0) {
      const foldButton = document.createElement('button');
      foldButton.type = 'button';
      foldButton.className = 'cm-hybrid-callout-fold';
      foldButton.ariaLabel = folded ? 'Expand callout' : 'Collapse callout';
      foldButton.textContent = folded ? '>' : 'v';
      foldButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      foldButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!body) return;
        body.hidden = !body.hidden;
        foldButton.textContent = body.hidden ? '>' : 'v';
        foldButton.ariaLabel = body.hidden ? 'Expand callout' : 'Collapse callout';
      });
      title.appendChild(foldButton);
    }
    appendCalloutInlineMarkdownLine(title, this.title, calloutInlineContext(view, this.titleFrom));
    wrapper.appendChild(title);

    if (this.body.trim().length > 0) {
      body = document.createElement('div');
      body.className = 'cm-hybrid-callout-body';
      body.hidden = folded;
      appendCalloutBodyMarkdown(body, view, this.blockFrom, this.blockTo, this.body);
      wrapper.appendChild(body);
    }

    wrapper.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.blockFrom } });
    });

    return wrapper;
  }

  override eq(other: CalloutWidget): boolean {
    return this.type === other.type
      && this.title === other.title
      && this.body === other.body
      && this.foldMarker === other.foldMarker
      && this.blockFrom === other.blockFrom
      && this.blockTo === other.blockTo;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

interface InlineTextMatch {
  kind: 'bold' | 'code' | 'highlight' | 'italic' | 'math' | 'strike';
  from: number;
  to: number;
  text: string;
}

interface InlineLinkMatch {
  kind: 'markdown-link' | 'wiki-link';
  from: number;
  to: number;
  text: string;
  uri: string;
}

interface InlineImageMatch {
  kind: 'markdown-image' | 'wiki-image';
  from: number;
  to: number;
  alt: string;
  url: string;
  sourceFrom: number;
  sourceTo: number;
  dimensions?: ImageDimensions;
}

type InlineMatch = InlineTextMatch | InlineLinkMatch | InlineImageMatch;

interface CalloutInlineContext {
  lineFrom: number;
  referenceDefinitions: ReturnType<typeof markdownReferenceDefinitions>;
  view: EditorView;
}

interface CalloutBodySourceLine {
  content: string;
  contentFrom: number;
}

interface CalloutTableBlock {
  rows: TableCell[][];
  alignments: TableAlignment[];
  startIndex: number;
  endIndex: number;
  sourceFrom: number;
  sourceTo: number;
}

function appendCalloutInlineMarkdown(container: HTMLElement, source: string): void {
  source.split('\n').forEach((line, index) => {
    if (index > 0) container.appendChild(document.createElement('br'));
    appendCalloutInlineMarkdownLine(container, line);
  });
}

function appendCalloutBodyMarkdown(
  container: HTMLElement,
  view: EditorView,
  blockFrom: number,
  blockTo: number,
  fallbackBody: string,
): void {
  const sourceLines = calloutBodySourceLines(view, blockFrom, blockTo);
  const lines = sourceLines.length > 0
    ? sourceLines
    : fallbackBody.split('\n').map(content => ({ content, contentFrom: -1 }));

  let index = 0;
  while (index < lines.length) {
    const table = calloutTableBlock(lines, index);
    if (table) {
      container.appendChild(calloutTableElement(table, view));
      index = table.endIndex + 1;
      continue;
    }
    container.appendChild(calloutBodyLineElement(lines[index]!, view));
    index++;
  }
}

function calloutTableBlock(lines: CalloutBodySourceLine[], startIndex: number): CalloutTableBlock | null {
  if (startIndex + 1 >= lines.length) return null;
  const header = parseTableRowCells(lines[startIndex]!.content, lines[startIndex]!.contentFrom);
  const alignments = tableAlignmentsFromSeparator(lines[startIndex + 1]!.content);
  if (!header || !alignments) return null;

  const rows: TableCell[][] = [header];
  let endIndex = startIndex + 1;
  for (let index = startIndex + 2; index < lines.length; index++) {
    const row = parseTableRowCells(lines[index]!.content, lines[index]!.contentFrom);
    if (!row) break;
    rows.push(row);
    endIndex = index;
  }

  const lastLine = lines[endIndex]!;
  return {
    rows,
    alignments,
    startIndex,
    endIndex,
    sourceFrom: lines[startIndex]!.contentFrom,
    sourceTo: lastLine.contentFrom + lastLine.content.length,
  };
}

function calloutTableElement(block: CalloutTableBlock, view: EditorView): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'cm-hybrid-callout-table-widget cm-hybrid-table-widget';
  wrapper.dataset.sourceFrom = String(block.sourceFrom);
  wrapper.dataset.sourceTo = String(block.sourceTo);

  const inner = document.createElement('div');
  inner.className = 'cm-hybrid-table-widget-inner';
  const table = document.createElement('table');
  table.className = 'cm-hybrid-table';
  const tbody = document.createElement('tbody');

  block.rows.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    for (const [cellIndex, cell] of row.entries()) {
      const element = document.createElement(rowIndex === 0 ? 'th' : 'td');
      applyTableCellAlignment(element, block.alignments[cellIndex]);
      appendCalloutInlineMarkdownLine(element, cell.text, calloutInlineContext(view, cell.from), 'cm-hybrid-table');
      tr.appendChild(element);
    }
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  inner.appendChild(table);
  wrapper.appendChild(inner);
  wrapper.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
    view.dispatch({ selection: { anchor: block.sourceFrom } });
    view.focus();
  });
  return wrapper;
}

function calloutBodySourceLines(
  view: EditorView,
  blockFrom: number,
  blockTo: number,
): CalloutBodySourceLine[] {
  const firstLine = view.state.doc.lineAt(blockFrom);
  const lastLine = view.state.doc.lineAt(blockTo);
  const lines: CalloutBodySourceLine[] = [];
  for (let lineNumber = firstLine.number + 1; lineNumber <= lastLine.number; lineNumber++) {
    const line = view.state.doc.line(lineNumber);
    const match = line.text.match(/^(\s*>\s?)(.*)$/);
    if (!match) break;
    lines.push({
      content: match[2] ?? '',
      contentFrom: line.from + (match[1]?.length ?? 0),
    });
  }
  return lines;
}

function calloutBodyLineElement(sourceLine: CalloutBodySourceLine, view: EditorView): HTMLElement {
  const line = document.createElement('div');
  line.className = 'cm-hybrid-callout-line';
  const content = sourceLine.content;

  const task = content.match(/^(\s*)((?:[-*+]|\d+[.)]))\s+\[([ xX])\]\s*(.*)$/);
  if (task) {
    line.classList.add('cm-hybrid-callout-task-line');
    applyCalloutLineIndent(line, task[1] ?? '');
    if (/^\d/.test(task[2] ?? '')) {
      const marker = document.createElement('span');
      marker.className = 'cm-hybrid-callout-list-marker';
      marker.textContent = task[2]!;
      line.appendChild(marker);
    }
    line.appendChild(calloutTaskCheckbox(
      task[3]!.toLowerCase() === 'x',
      sourceLine.contentFrom + task[0].indexOf('[') + 1,
      view,
    ));
    const textContent = task[4] ?? '';
    const textFrom = sourceLine.contentFrom + content.length - textContent.length;
    const text = document.createElement('span');
    text.className = 'cm-hybrid-callout-list-content';
    appendCalloutInlineMarkdownLine(text, textContent, calloutInlineContext(view, textFrom));
    line.appendChild(text);
    return line;
  }

  const list = content.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  if (list) {
    line.classList.add('cm-hybrid-callout-list-line');
    applyCalloutLineIndent(line, list[1] ?? '');
    const marker = document.createElement('span');
    marker.className = 'cm-hybrid-callout-list-marker';
    marker.textContent = /^\d/.test(list[2] ?? '') ? list[2]! : '•';
    const textContent = list[3] ?? '';
    const textFrom = sourceLine.contentFrom + content.length - textContent.length;
    const text = document.createElement('span');
    text.className = 'cm-hybrid-callout-list-content';
    appendCalloutInlineMarkdownLine(text, textContent, calloutInlineContext(view, textFrom));
    line.append(marker, text);
    return line;
  }

  if (content.length === 0) {
    line.append('\u200B');
    return line;
  }
  appendCalloutInlineMarkdownLine(line, content, calloutInlineContext(view, sourceLine.contentFrom));
  return line;
}

function calloutInlineContext(view: EditorView, lineFrom: number): CalloutInlineContext | undefined {
  return lineFrom >= 0
    ? { view, lineFrom, referenceDefinitions: markdownReferenceDefinitions(view.state.doc.toString()) }
    : undefined;
}

function applyCalloutLineIndent(line: HTMLElement, leadingWhitespace: string): void {
  const indentLevel = Math.floor(leadingWhitespace.replace(/\t/g, '  ').length / 2);
  if (indentLevel > 0) {
    line.style.paddingLeft = `${indentLevel * 18}px`;
  }
}

function calloutTaskCheckbox(checked: boolean, statusFrom: number, view: EditorView): HTMLInputElement {
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'cm-hybrid-callout-task-checkbox';
  checkbox.checked = checked;
  checkbox.title = checked ? 'Mark incomplete' : 'Mark complete';
  checkbox.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  checkbox.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (statusFrom < 0) return;
    view.dispatch({
      changes: { from: statusFrom, to: statusFrom + 1, insert: checked ? ' ' : 'x' },
      selection: { anchor: statusFrom + 1 },
    });
    view.focus();
  });
  return checkbox;
}

function appendCalloutInlineMarkdownLine(
  container: HTMLElement,
  source: string,
  context?: CalloutInlineContext,
  classPrefix = 'cm-hybrid-callout',
): void {
  let position = 0;
  while (position < source.length) {
    const match = nextCalloutInlineMatch(source, position, context);
    if (!match) {
      container.append(source.slice(position));
      break;
    }
    if (match.from > position) {
      container.append(source.slice(position, match.from));
    }
    container.appendChild(calloutInlineElement(match, context, classPrefix));
    position = match.to;
  }
}

function nextCalloutInlineMatch(
  source: string,
  position: number,
  context?: CalloutInlineContext,
): InlineMatch | null {
  const candidates = [
    context ? calloutMarkdownImageMatch(source, position, context) : null,
    context ? calloutReferenceImageMatch(source, position, context) : null,
    context ? calloutWikiImageMatch(source, position, context) : null,
    calloutMarkdownLinkMatch(source, position),
    context ? calloutReferenceLinkMatch(source, position, context) : null,
    calloutWikiLinkMatch(source, position),
    calloutInlineMatch(source, position, /\$(?!\$)([^$\n]+?)\$(?!\$)/g, 'math'),
    calloutInlineMatch(source, position, /`([^`\n]+)`/g, 'code'),
    calloutInlineMatch(source, position, /\*\*(?=\S)(.+?\S)\*\*/g, 'bold'),
    calloutInlineMatch(source, position, /==(?=\S)(.+?\S)==/g, 'highlight'),
    calloutInlineMatch(source, position, /~~(?=\S)(.+?\S)~~/g, 'strike'),
    calloutInlineMatch(source, position, /(?<!\*)\*(?=\S)(.+?\S)\*(?!\*)/g, 'italic'),
  ].filter((match): match is InlineMatch => match != null);
  candidates.sort((first, second) => first.from - second.from || second.to - first.to);
  return candidates[0] ?? null;
}

function calloutMarkdownImageMatch(
  source: string,
  position: number,
  context: CalloutInlineContext,
): InlineImageMatch | null {
  for (const link of markdownLinkSourceSpans(0, source)) {
    if (link.from < position) continue;
    if (!link.image) continue;
    const url = parseMarkdownLinkDestination(link.destination);
    if (!url) continue;
    return {
      kind: 'markdown-image',
      from: link.from,
      to: link.to,
      alt: link.label,
      url: resolveImageResource(url, 'relative'),
      sourceFrom: context.lineFrom + link.from,
      sourceTo: context.lineFrom + link.to,
    };
  }
  return null;
}

function calloutReferenceImageMatch(
  source: string,
  position: number,
  context: CalloutInlineContext,
): InlineImageMatch | null {
  for (const link of markdownReferenceLinkSourceSpans(0, source, context.referenceDefinitions)) {
    if (link.from < position) continue;
    if (!link.image) continue;
    return {
      kind: 'markdown-image',
      from: link.from,
      to: link.to,
      alt: link.label,
      url: resolveImageResource(link.definition.destination, 'relative'),
      sourceFrom: context.lineFrom + link.from,
      sourceTo: context.lineFrom + link.to,
    };
  }
  return null;
}

function calloutWikiImageMatch(
  source: string,
  position: number,
  context: CalloutInlineContext,
): InlineImageMatch | null {
  const pattern = /!\[\[([^\]\n]+)\]\]/g;
  pattern.lastIndex = position;
  const match = pattern.exec(source);
  if (!match) return null;
  const from = match.index;
  if (isEscapedAt(source, from)) {
    return calloutWikiImageMatch(source, from + 1, context);
  }
  const image = parseObsidianImageEmbed(match[1] ?? '');
  if (!image) return calloutWikiImageMatch(source, from + 1, context);
  return {
    kind: 'wiki-image',
    from,
    to: from + match[0].length,
    alt: image.alt,
    url: resolveImageResource(image.url, 'vault'),
    sourceFrom: context.lineFrom + from,
    sourceTo: context.lineFrom + from + match[0].length,
    dimensions: image.dimensions,
  };
}

function calloutInlineMatch(
  source: string,
  position: number,
  pattern: RegExp,
  kind: InlineTextMatch['kind'],
): InlineTextMatch | null {
  pattern.lastIndex = position;
  const match = pattern.exec(source);
  if (!match) return null;
  const from = match.index;
  if (kind === 'math' && from > 0 && source[from - 1] === '\\') {
    return calloutInlineMatch(source, from + 1, pattern, kind);
  }
  return {
    kind,
    from,
    to: from + match[0].length,
    text: match[1] ?? '',
  };
}

function calloutMarkdownLinkMatch(source: string, position: number): InlineLinkMatch | null {
  for (const link of markdownLinkSourceSpans(0, source)) {
    if (link.from < position) continue;
    if (link.image) continue;
    const uri = parseMarkdownLinkDestination(link.destination);
    if (!uri) continue;
    return {
      kind: 'markdown-link',
      from: link.from,
      to: link.to,
      text: link.label,
      uri,
    };
  }
  return null;
}

function calloutReferenceLinkMatch(
  source: string,
  position: number,
  context: CalloutInlineContext,
): InlineLinkMatch | null {
  for (const link of markdownReferenceLinkSourceSpans(0, source, context.referenceDefinitions)) {
    if (link.from < position) continue;
    if (link.image) continue;
    return {
      kind: 'markdown-link',
      from: link.from,
      to: link.to,
      text: link.label,
      uri: link.definition.destination,
    };
  }
  return null;
}

function calloutWikiLinkMatch(source: string, position: number): InlineLinkMatch | null {
  const pattern = /\[\[([^\]\n]+)\]\]/g;
  pattern.lastIndex = position;
  const match = pattern.exec(source);
  if (!match) return null;
  const from = match.index;
  if (from > 0 && source[from - 1] === '!') {
    return calloutWikiLinkMatch(source, from + 1);
  }

  const target = parseWikiLinkTarget(match[1] ?? '');
  if (!target) return calloutWikiLinkMatch(source, from + 1);
  return {
    kind: 'wiki-link',
    from,
    to: from + match[0].length,
    text: target.label,
    uri: target.uri,
  };
}

function calloutInlineElement(
  match: InlineMatch,
  context?: CalloutInlineContext,
  classPrefix = 'cm-hybrid-callout',
): HTMLElement {
  if (match.kind === 'markdown-image' || match.kind === 'wiki-image') {
    return renderedImageElement(match.alt, match.url, match.sourceFrom, match.sourceTo, match.dimensions, context!.view);
  }
  if (match.kind === 'math') return calloutInlineMathElement(match.text, classPrefix);
  if (match.kind === 'markdown-link' || match.kind === 'wiki-link') {
    return calloutInlineLinkElement(match, classPrefix);
  }

  const textKind = match.kind as Exclude<InlineTextMatch['kind'], 'math'>;
  const element = document.createElement(calloutInlineTagName(textKind));
  element.className = `${classPrefix}-${calloutInlineClassSuffix(textKind)}`;
  element.textContent = (match as InlineTextMatch).text;
  return element;
}

function calloutInlineLinkElement(match: InlineLinkMatch, classPrefix = 'cm-hybrid-callout'): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${classPrefix}-link`;
  button.textContent = match.text || match.uri;
  button.title = match.uri;

  const stopEditorSelection = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  button.addEventListener('pointerdown', stopEditorSelection);
  button.addEventListener('mousedown', stopEditorSelection);
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    button.dispatchEvent(new CustomEvent('human-learning-open-uri', {
      bubbles: true,
      detail: { uri: match.uri },
    }));
  });
  return button;
}

function calloutInlineMathElement(expression: string, classPrefix = 'cm-hybrid-callout'): HTMLElement {
  const element = document.createElement('span');
  element.className = `${classPrefix}-inline-math`;
  renderMathInto(element, expression, false);
  return element;
}

function calloutInlineTagName(kind: Exclude<InlineTextMatch['kind'], 'math'>): keyof HTMLElementTagNameMap {
  if (kind === 'bold') return 'strong';
  if (kind === 'code') return 'code';
  if (kind === 'highlight') return 'mark';
  if (kind === 'strike') return 's';
  return 'em';
}

function calloutInlineClassSuffix(kind: Exclude<InlineTextMatch['kind'], 'math'>): string {
  return kind === 'code' ? 'inline-code' : kind;
}

class MermaidBlockWidget extends WidgetType {
  constructor(
    private readonly source: string,
    private readonly blockFrom: number,
    private readonly blockTo: number,
  ) {
    super();
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-hybrid-mermaid-block';
    wrapper.dataset.sourceFrom = String(this.blockFrom);
    wrapper.dataset.sourceTo = String(this.blockTo);

    const inner = document.createElement('div');
    inner.className = 'cm-hybrid-mermaid-block-inner';
    inner.textContent = 'Rendering Mermaid diagram...';
    wrapper.appendChild(inner);

    void renderMermaidInto(inner, this.source, `cm-hybrid-mermaid-${++mermaidRenderSequence}`, wrapper);

    wrapper.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.focus();
      view.dispatch({ selection: { anchor: this.editableAnchor(view) } });
    });

    return wrapper;
  }

  private editableAnchor(view: EditorView): number {
    const openingLine = view.state.doc.lineAt(this.blockFrom);
    const closingLine = view.state.doc.lineAt(this.blockTo);
    if (openingLine.number + 1 < closingLine.number) {
      return view.state.doc.line(openingLine.number + 1).from;
    }
    return this.blockFrom;
  }

  override eq(other: MermaidBlockWidget): boolean {
    return this.source === other.source
      && this.blockFrom === other.blockFrom
      && this.blockTo === other.blockTo;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

async function renderMermaidInto(
  container: HTMLElement,
  source: string,
  id: string,
  root: HTMLElement,
): Promise<void> {
  try {
    const { svg, bindFunctions } = await mermaid.render(id, source);
    if (!root.isConnected) return;
    container.innerHTML = svg;
    bindFunctions?.(container);
  } catch (error) {
    if (!root.isConnected) return;
    container.replaceChildren();
    const fallback = document.createElement('pre');
    fallback.className = 'cm-hybrid-mermaid-error';
    fallback.textContent = error instanceof Error ? error.message : source;
    container.appendChild(fallback);
  }
}

export const setHybridPreviewEnabled = StateEffect.define<boolean>();
export const setDocumentTitle = StateEffect.define<string | null>();

export const hybridPreviewEnabled = StateField.define<boolean>({
  create: () => true,
  update(value, transaction) {
    for (const effect of transaction.effects ?? []) {
      if (effect.is(setHybridPreviewEnabled)) return effect.value;
    }
    return value;
  },
});

export function isHybridPreviewEnabled(state: EditorState): boolean {
  return state.field(hybridPreviewEnabled, false) !== false;
}

export function toggleHybridPreview(view: EditorView): boolean {
  view.dispatch({
    effects: setHybridPreviewEnabled.of(!isHybridPreviewEnabled(view.state)),
  });
  return true;
}

function buildDocumentTitleDecorations(title: string | null): DecorationSet {
  const trimmed = title?.trim() ?? '';
  if (trimmed.length === 0) return Decoration.none;
  return Decoration.set([
    Decoration.widget({
      widget: new DocumentTitleWidget(trimmed),
      block: true,
      side: -1,
    }).range(0),
  ]);
}

const documentTitleRendering = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects ?? []) {
      if (effect.is(setDocumentTitle)) {
        return buildDocumentTitleDecorations(effect.value);
      }
    }
    return value.map(transaction.changes);
  },
  provide: field => EditorView.decorations.from(field),
});

const emptyWidget = new EmptyWidget();
const footnoteDefinitionSeparatorWidget = new FootnoteDefinitionSeparatorWidget();
const boldMark = Decoration.mark({ class: 'cm-hybrid-bold' });
const italicMark = Decoration.mark({ class: 'cm-hybrid-italic' });
const strikeMark = Decoration.mark({ class: 'cm-hybrid-strikethrough' });
const highlightMark = Decoration.mark({ class: 'cm-hybrid-highlight' });
const inlineCodeMark = Decoration.mark({ class: 'cm-hybrid-inline-code' });
const linkTextMark = Decoration.mark({ class: 'cm-hybrid-link-text' });
const tagMark = Decoration.mark({ class: 'cm-hybrid-tag' });
const footnoteRefMark = Decoration.mark({ class: 'cm-hybrid-footnote-ref' });
const footnoteDefLabelMark = Decoration.mark({ class: 'cm-hybrid-footnote-def-label' });
const displayMathDelimiterMark = Decoration.mark({ class: 'cm-hybrid-math-delimiter' });
const displayMathSourceMark = Decoration.mark({ class: 'cm-hybrid-math-source' });
const blockquoteLine = Decoration.line({ class: 'cm-hybrid-blockquote-line' });
const listLine = Decoration.line({ class: 'cm-hybrid-list-line' });
const taskLine = Decoration.line({ class: 'cm-hybrid-task-list-line' });

interface Span {
  from: number;
  to: number;
}

function activeLinesFromState(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number;
    const end = state.doc.lineAt(range.to).number;
    for (let line = start; line <= end; line++) lines.add(line);
  }
  return lines;
}

function overlaps(span: Span, reserved: Span[]): boolean {
  return overlapsSpan(span, reserved);
}

function lineOverlapsSpan(lineFrom: number, lineTo: number, spans: Span[]): boolean {
  return overlapsSpan({ from: lineFrom, to: lineTo }, spans);
}

function addReplace(
  decorations: Range<Decoration>[],
  reserved: Span[],
  from: number,
  to: number,
  widget: WidgetType = emptyWidget,
): void {
  if (to <= from || overlaps({ from, to }, reserved)) return;
  decorations.push(Decoration.replace({ widget }).range(from, to));
  reserved.push({ from, to });
}

function addMark(
  decorations: Range<Decoration>[],
  reserved: Span[],
  from: number,
  to: number,
  mark: Decoration,
): void {
  if (to <= from || overlaps({ from, to }, reserved)) return;
  decorations.push(mark.range(from, to));
}

function hasHybridPreviewToggle(transaction: Transaction): boolean {
  return (transaction.effects ?? []).some(effect => effect.is(setHybridPreviewEnabled));
}

function buildHybridDecorations(state: EditorState): DecorationSet {
  if (!isHybridPreviewEnabled(state)) return Decoration.none;

  const decorations: Range<Decoration>[] = [];
  const active = activeLinesFromState(state);
  const frontmatter = findFrontmatterBlock(state.doc);
  const commentRanges = [
    ...findObsidianCommentRanges(state.doc),
    ...findHtmlCommentRanges(state.doc),
  ];
  const referenceDefinitions = markdownReferenceDefinitions(state.doc.toString());
  const referenceDefinitionSpans = markdownReferenceDefinitionSourceSpans(state.doc.toString());

  let lineNumber = 1;
  while (lineNumber <= state.doc.lines) {
    const line = state.doc.line(lineNumber);
    if (frontmatter && line.number >= frontmatter.startLine && line.number <= frontmatter.endLine) {
      lineNumber = frontmatter.endLine + 1;
      continue;
    }

    const callout = findCalloutBlock(state.doc, line.number);
    if (callout) {
      const calloutHasSelection = [...active].some(activeLine => (
        activeLine >= callout.startLine && activeLine <= callout.endLine
      ));
      if (!calloutHasSelection) {
        lineNumber = callout.endLine + 1;
        continue;
      }
    }

    const specialBlock = findSpecialBlock(state.doc, line.number)
      ?? findContainingCodeBlock(state.doc, line.number);
    if (specialBlock) {
      if (specialBlock.kind === 'code' && !isMermaidBlock(specialBlock)) {
        lineNumber = specialBlock.endLine + 1;
        continue;
      }

      const blockHasSelection = [...active].some(activeLine => (
        activeLine >= specialBlock.startLine && activeLine <= specialBlock.endLine
      ));
      if (!blockHasSelection) {
        lineNumber = specialBlock.endLine + 1;
        continue;
      }
    }

    const table = findTableBlock(state.doc, line.number);
    if (table) {
      const tableHasSelection = [...active].some(activeLine => (
        activeLine >= table.startLine && activeLine <= table.endLine
      ));
      if (!tableHasSelection) {
        lineNumber = table.endLine + 1;
        continue;
      }
    }

    decorateLineShell(
      line.from,
      line.text,
      decorations,
      setextHeadingLevelForLine(state.doc, line.number),
    );
    if (!active.has(line.number)) {
      if (isSetextHeadingUnderlineLine(state.doc, line.number)) {
        hideRenderedLineSource(line.from, line.to, decorations);
      } else {
        decorateRenderedLine(
          line.from,
          line.to,
          line.text,
          commentRanges,
          referenceDefinitions,
          referenceDefinitionSpans,
          decorations,
        );
      }
    }
    lineNumber = line.number + 1;
  }

  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(decorations, true);
}

const hybridLineRendering = StateField.define<DecorationSet>({
  create: buildHybridDecorations,
  update(value, transaction) {
    if (
      transaction.docChanged ||
      transaction.selection ||
      hasHybridPreviewToggle(transaction)
    ) {
      return buildHybridDecorations(transaction.state);
    }
    return value.map(transaction.changes);
  },
  provide: field => EditorView.decorations.from(field),
});

function buildFrontmatterDecorations(state: EditorState): DecorationSet {
  if (!isHybridPreviewEnabled(state)) return Decoration.none;
  const frontmatter = findFrontmatterBlock(state.doc);
  if (!frontmatter) return Decoration.none;

  return Decoration.set([
    Decoration.replace({
      widget: new FrontmatterPropertiesWidget(frontmatter.properties, frontmatter.bodyFrom, frontmatter.insertBefore),
      block: true,
    }).range(frontmatter.from, frontmatter.to),
  ]);
}

function buildCalloutDecorations(state: EditorState): DecorationSet {
  if (!isHybridPreviewEnabled(state)) return Decoration.none;

  const decorations: Range<Decoration>[] = [];
  const active = activeLinesFromState(state);
  let lineNumber = 1;
  while (lineNumber <= state.doc.lines) {
    const callout = findCalloutBlock(state.doc, lineNumber);
    if (!callout) {
      lineNumber++;
      continue;
    }

    const calloutHasSelection = [...active].some(activeLine => (
      activeLine >= callout.startLine && activeLine <= callout.endLine
    ));
    if (!calloutHasSelection) {
      decorations.push(Decoration.replace({
        widget: new CalloutWidget(
          callout.type,
          callout.title,
          callout.titleFrom,
          callout.body,
          callout.foldMarker,
          callout.from,
          callout.to,
        ),
        block: true,
      }).range(callout.from, callout.to));
    }
    lineNumber = callout.endLine + 1;
  }

  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(decorations, true);
}

interface CalloutBlock {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  type: string;
  title: string;
  titleFrom: number;
  body: string;
  foldMarker?: '+' | '-';
}

interface SpecialBlock {
  kind: 'code' | 'math';
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  language?: string;
  content: string;
}

function buildTableDecorations(state: EditorState): DecorationSet {
  if (!isHybridPreviewEnabled(state)) return Decoration.none;

  return buildTableRenderingDecorations(state, {
    activeLines: activeLinesFromState(state),
    renderCellInlineMarkdown: (container, source, classPrefix, sourceFrom, view) => {
      appendCalloutInlineMarkdownLine(container, source, calloutInlineContext(view, sourceFrom), classPrefix);
    },
    skipBlockAtLine(lineNumber) {
      const callout = findCalloutBlock(state.doc, lineNumber);
      if (callout) return callout;

      const specialBlock = findSpecialBlock(state.doc, lineNumber);
      if (specialBlock) return specialBlock;
      return null;
    },
  });
}

function buildSpecialBlockDecorations(state: EditorState): DecorationSet {
  if (!isHybridPreviewEnabled(state)) return Decoration.none;

  const decorations: Range<Decoration>[] = [];
  const active = activeLinesFromState(state);
  let lineNumber = 1;
  while (lineNumber <= state.doc.lines) {
    const callout = findCalloutBlock(state.doc, lineNumber);
    if (callout) {
      lineNumber = callout.endLine + 1;
      continue;
    }

    const block = findSpecialBlock(state.doc, lineNumber);
    if (!block) {
      lineNumber++;
      continue;
    }

    const blockHasSelection = [...active].some(activeLine => (
      activeLine >= block.startLine && activeLine <= block.endLine
    ));
    if (block.kind === 'code') {
      if (isMermaidBlock(block)) {
        if (!blockHasSelection) {
          decorations.push(Decoration.replace({
            widget: new MermaidBlockWidget(block.content, block.from, block.to),
            block: true,
          }).range(block.from, block.to));
        }
      } else {
        addCodeBlockDecorations(state, block, decorations);
        addCodeSyntaxDecorations(state, block, decorations);
      }
    } else {
      if (blockHasSelection) {
        const endLine = state.doc.line(block.endLine);
        decorations.push(Decoration.widget({
          widget: new MathBlockWidget(block.content, block.from, block.to, true),
          block: true,
          side: 1,
        }).range(endLine.to));
      } else if (block.startLine === block.endLine) {
        addSingleLineMathDecorations(state, block, decorations);
      } else {
        addMultiLineMathDecorations(state, block, decorations);
      }
    }

    lineNumber = block.endLine + 1;
  }

  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(decorations, true);
}

function isMermaidBlock(block: SpecialBlock): boolean {
  return block.kind === 'code'
    && block.language?.trim().toLowerCase() === 'mermaid';
}

const specialBlockRendering = StateField.define<DecorationSet>({
  create: buildSpecialBlockDecorations,
  update(value, transaction) {
    if (
      transaction.docChanged ||
      transaction.selection ||
      hasHybridPreviewToggle(transaction)
    ) {
      return buildSpecialBlockDecorations(transaction.state);
    }
    return value.map(transaction.changes);
  },
  provide: field => [
    EditorView.decorations.from(field),
  ],
});

const calloutRendering = StateField.define<DecorationSet>({
  create: buildCalloutDecorations,
  update(value, transaction) {
    if (
      transaction.docChanged ||
      transaction.selection ||
      hasHybridPreviewToggle(transaction)
    ) {
      return buildCalloutDecorations(transaction.state);
    }
    return value.map(transaction.changes);
  },
  provide: field => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of(view => view.state.field(field, false) ?? Decoration.none),
  ],
});

const hybridTableRendering = StateField.define<DecorationSet>({
  create: buildTableDecorations,
  update(value, transaction) {
    if (
      transaction.docChanged ||
      transaction.selection ||
      hasHybridPreviewToggle(transaction)
    ) {
      return buildTableDecorations(transaction.state);
    }
    return value.map(transaction.changes);
  },
  provide: field => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of(view => view.state.field(field, false) ?? Decoration.none),
  ],
});

const frontmatterRendering = StateField.define<DecorationSet>({
  create: buildFrontmatterDecorations,
  update(value, transaction) {
    if (
      transaction.docChanged ||
      hasHybridPreviewToggle(transaction)
    ) {
      return buildFrontmatterDecorations(transaction.state);
    }
    return value.map(transaction.changes);
  },
  provide: field => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of(view => view.state.field(field, false) ?? Decoration.none),
  ],
});

function findCalloutBlock(
  doc: EditorView['state']['doc'],
  startLine: number,
): CalloutBlock | null {
  const firstLine = doc.line(startLine);
  const match = firstLine.text.match(/^\s*>\s*\[!([A-Za-z][\w-]*)\]([+-])?\s*(.*)$/);
  if (!match) return null;

  let endLine = startLine;
  const bodyLines: string[] = [];
  for (let lineNumber = startLine + 1; lineNumber <= doc.lines; lineNumber++) {
    const line = doc.line(lineNumber);
    const bodyLine = stripBlockquoteMarker(line.text);
    if (bodyLine == null) break;
    bodyLines.push(bodyLine);
    endLine = lineNumber;
  }

  const type = match[1]!.toLowerCase();
  const foldMarker = match[2] === '+' || match[2] === '-' ? match[2] : undefined;
  const rawTitleSource = match[3] ?? '';
  const rawTitle = rawTitleSource.trim();
  const titlePrefixLength = match[0].length - rawTitleSource.length;
  const titleTrimOffset = rawTitle.length > 0 ? rawTitleSource.search(/\S/) : -1;
  return {
    from: firstLine.from,
    to: doc.line(endLine).to,
    startLine,
    endLine,
    type,
    title: rawTitle || titleFromCalloutType(type),
    titleFrom: rawTitle
      ? firstLine.from + titlePrefixLength + Math.max(0, titleTrimOffset)
      : -1,
    body: bodyLines.join('\n').trimEnd(),
    foldMarker,
  };
}

function stripBlockquoteMarker(text: string): string | null {
  const match = text.match(/^\s*>\s?(.*)$/);
  return match ? match[1] ?? '' : null;
}

function titleFromCalloutType(type: string): string {
  return type
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Note';
}

function findSpecialBlock(
  doc: EditorView['state']['doc'],
  startLine: number,
): SpecialBlock | null {
  const line = doc.line(startLine);
  const codeFence = parseCodeFenceOpening(line.text);
  if (codeFence) {
    const marker = codeFence.marker;
    for (let lineNumber = startLine + 1; lineNumber <= doc.lines; lineNumber++) {
      const current = doc.line(lineNumber);
      if (isCodeFenceClosing(current.text, marker)) {
        return {
          kind: 'code',
          from: line.from,
          to: current.to,
          startLine,
          endLine: lineNumber,
          language: codeFence.language,
          content: collectBlockContent(doc, startLine + 1, lineNumber - 1),
        };
      }
    }
    return null;
  }

  // Multi-line block math: $$ on its own line
  if (/^\s*\$\$\s*$/.test(line.text)) {
    for (let lineNumber = startLine + 1; lineNumber <= doc.lines; lineNumber++) {
      const current = doc.line(lineNumber);
      if (/^\s*\$\$\s*$/.test(current.text)) {
        return {
          kind: 'math',
          from: line.from,
          to: current.to,
          startLine,
          endLine: lineNumber,
          content: collectBlockContent(doc, startLine + 1, lineNumber - 1),
        };
      }
    }
  }

  // Single-line block math: $$...$$ on one line
  const singleLineMatch = line.text.match(/^\s*\$\$(.+)\$\$\s*$/);
  if (singleLineMatch) {
    return {
      kind: 'math',
      from: line.from,
      to: line.to,
      startLine,
      endLine: startLine,
      content: singleLineMatch[1] ?? '',
    };
  }

  return null;
}

function findContainingCodeBlock(
  doc: EditorView['state']['doc'],
  lineNumber: number,
): SpecialBlock | null {
  let opening: { lineNumber: number; marker: string; language?: string; from: number } | null = null;

  for (let currentLineNumber = 1; currentLineNumber <= doc.lines; currentLineNumber++) {
    const line = doc.line(currentLineNumber);
    if (!opening) {
      const codeFence = parseCodeFenceOpening(line.text);
      if (codeFence) {
        opening = {
          lineNumber: currentLineNumber,
          marker: codeFence.marker,
          language: codeFence.language,
          from: line.from,
        };
      }
    } else if (isCodeFenceClosing(line.text, opening.marker)) {
      if (lineNumber >= opening.lineNumber && lineNumber <= currentLineNumber) {
        return {
          kind: 'code',
          from: opening.from,
          to: line.to,
          startLine: opening.lineNumber,
          endLine: currentLineNumber,
          language: opening.language,
          content: collectBlockContent(doc, opening.lineNumber + 1, currentLineNumber - 1),
        };
      }
      opening = null;
    }

    if (currentLineNumber >= lineNumber && !opening) {
      return null;
    }
  }

  if (opening && lineNumber >= opening.lineNumber) {
    return {
      kind: 'code',
      from: opening.from,
      to: doc.line(doc.lines).to,
      startLine: opening.lineNumber,
      endLine: doc.lines,
      language: opening.language,
      content: collectBlockContent(doc, opening.lineNumber + 1, doc.lines),
    };
  }
  return null;
}

function collectBlockContent(
  doc: EditorView['state']['doc'],
  startLine: number,
  endLine: number,
): string {
  if (endLine < startLine) return '';
  const lines: string[] = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    lines.push(doc.line(lineNumber).text);
  }
  return lines.join('\n');
}

function setextHeadingLevelForLine(
  doc: EditorView['state']['doc'],
  lineNumber: number,
): 1 | 2 | null {
  if (lineNumber >= doc.lines) return null;
  return setextHeadingLevelForLines(doc.line(lineNumber).text, doc.line(lineNumber + 1).text);
}

function isSetextHeadingUnderlineLine(
  doc: EditorView['state']['doc'],
  lineNumber: number,
): boolean {
  if (lineNumber <= 1) return false;
  return setextHeadingLevelForLines(doc.line(lineNumber - 1).text, doc.line(lineNumber).text) != null;
}

function hideRenderedLineSource(
  lineFrom: number,
  lineTo: number,
  decorations: Range<Decoration>[],
): void {
  if (lineTo <= lineFrom) return;
  decorations.push(Decoration.replace({ widget: emptyWidget }).range(lineFrom, lineTo));
}

function decorateLineShell(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  setextLevel: 1 | 2 | null = null,
): void {
  if (setextLevel != null) {
    decorations.push(Decoration.line({
      class: `cm-hybrid-heading-line cm-hybrid-heading-line-${setextLevel}`,
    }).range(lineFrom));
    return;
  }

  const heading = text.match(/^( {0,3})(#{1,6})\s+/);
  if (heading) {
    decorations.push(Decoration.line({
      class: `cm-hybrid-heading-line cm-hybrid-heading-line-${heading[2]!.length}`,
    }).range(lineFrom));
    return;
  }

  if (/^\s*>/.test(text)) {
    decorations.push(blockquoteLine.range(lineFrom));
  }
  const bodyText = text.slice(blockquotePrefixLength(text));
  if (/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+/.test(bodyText)) {
    decorations.push(taskLine.range(lineFrom));
    return;
  }
  if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(bodyText)) {
    decorations.push(listLine.range(lineFrom));
  }
}

function decorateRenderedLine(
  lineFrom: number,
  lineTo: number,
  text: string,
  obsidianComments: Span[],
  referenceDefinitions: ReturnType<typeof markdownReferenceDefinitions>,
  referenceDefinitionSpans: Span[],
  decorations: Range<Decoration>[],
): void {
  const reserved: Span[] = [];

  if (lineOverlapsSpan(lineFrom, lineTo, referenceDefinitionSpans)) {
    hideRenderedLineSource(lineFrom, lineTo, decorations);
    return;
  }

  if (/^\s*[-*_](?:\s*[-*_]){2,}\s*$/.test(text)) {
    addReplace(decorations, reserved, lineFrom, lineTo, new HorizontalRuleWidget());
    return;
  }

  const heading = text.match(/^( {0,3})(#{1,6})\s+/);
  if (heading) {
    addReplace(decorations, reserved, lineFrom, lineFrom + heading[0].length);
    const closing = closingAtxHeadingMarkerSpan(text);
    if (closing) {
      addReplace(decorations, reserved, lineFrom + closing.from, lineFrom + closing.to);
    }
  }

  const blockquote = text.match(/^(\s*(?:>\s*)+)/);
  const blockquoteLength = blockquote && !heading ? blockquote[1]!.length : 0;
  const markerLineFrom = lineFrom + blockquoteLength;
  const markerText = text.slice(blockquoteLength);
  if (blockquote && !heading) {
    addReplace(decorations, reserved, lineFrom, markerLineFrom);
  }

  const task = markerText.match(/^(\s*)((?:[-*+]|\d+[.)]))\s+\[([ xX])\]\s+/);
  if (task && !heading) {
    const statusFrom = markerLineFrom + task[0].indexOf('[') + 1;
    const marker = task[2]!;
    addReplace(
      decorations,
      reserved,
      markerLineFrom + task[1]!.length,
      markerLineFrom + task[0].length,
      new TaskCheckboxWidget(
        task[3]!.toLowerCase() === 'x',
        statusFrom,
        /^\d/.test(marker) ? marker : undefined,
      ),
    );
  } else {
    const list = markerText.match(/^(\s*)([-*+]|\d+[.)])\s+/);
    if (list && !heading) {
      const marker = list[2]!;
      addReplace(
        decorations,
        reserved,
        markerLineFrom + list[1]!.length,
        markerLineFrom + list[0].length,
        /^\d/.test(marker) ? new NumberWidget(marker) : new BulletWidget(),
      );
    }
  }

  replaceImages(lineFrom, text, referenceDefinitions, decorations, reserved);
  renderObsidianComments(lineFrom, lineTo, obsidianComments, decorations, reserved);
  renderInlineHtml(lineFrom, text, decorations, reserved);
  renderFootnotes(lineFrom, text, decorations, reserved);
  renderInlineCode(lineFrom, text, decorations, reserved);
  renderMarkdownLinks(lineFrom, text, referenceDefinitions, decorations, reserved);
  renderObsidianTags(lineFrom, text, decorations, reserved);
  renderInlineMath(lineFrom, text, decorations, reserved);
  renderDelimited(lineFrom, text, /\*\*\*(?=\S)(.+?\S)\*\*\*/g, 3, [boldMark, italicMark], decorations, reserved);
  renderDelimited(lineFrom, text, /(?<![A-Za-z0-9_])___(?=\S)(.+?\S)___(?![A-Za-z0-9_])/g, 3, [boldMark, italicMark], decorations, reserved);
  renderDelimited(lineFrom, text, /\*\*(?=\S)(.+?\S)\*\*/g, 2, [boldMark], decorations, reserved);
  renderDelimited(lineFrom, text, /(?<![A-Za-z0-9_])__(?=\S)(.+?\S)__(?![A-Za-z0-9_])/g, 2, [boldMark], decorations, reserved);
  renderDelimited(lineFrom, text, /(?<!\*)\*(?=\S)(.+?\S)\*(?!\*)/g, 1, [italicMark], decorations, reserved);
  renderDelimited(lineFrom, text, /(?<![A-Za-z0-9_])_(?=\S)(.+?\S)_(?![A-Za-z0-9_])/g, 1, [italicMark], decorations, reserved);
  renderDelimited(lineFrom, text, /~~(?=\S)(.+?\S)~~/g, 2, [strikeMark], decorations, reserved);
  renderDelimited(lineFrom, text, /==(?=\S)(.+?\S)==/g, 2, [highlightMark], decorations, reserved);
  renderBlockId(lineFrom, text, decorations, reserved);
  renderEscapedMarkdownPunctuation(lineFrom, text, decorations, reserved);
}

function blockquotePrefixLength(text: string): number {
  return text.match(/^(\s*(?:>\s*)+)/)?.[1]?.length ?? 0;
}

function closingAtxHeadingMarkerSpan(text: string): Span | null {
  const match = text.match(/\s+#{1,}\s*$/);
  if (!match || match.index == null) return null;
  return { from: match.index, to: text.length };
}

function renderBlockId(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  reserved: Span[],
): void {
  const match = text.match(/(?:^|\s)(\^[A-Za-z0-9_-]+)\s*$/);
  if (!match || match.index == null) return;
  const markerIndex = match.index + match[0].indexOf('^');
  if (isEscapedAt(text, markerIndex)) return;
  const from = lineFrom + match.index;
  const to = lineFrom + text.length;
  addReplace(decorations, reserved, from, to);
}

function renderInlineHtml(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  reserved: Span[],
): void {
  const codeSpans = inlineCodeSourceSpans(lineFrom, text);
  const pattern = /<([A-Za-z][A-Za-z0-9:-]*)(?:\s+[^<>]*?)?>(.*?)<\/\1>/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const from = lineFrom + start;
    const to = from + match[0].length;
    if (isEscapedAt(text, start)) continue;
    if (overlaps({ from, to }, codeSpans)) continue;
    addReplace(decorations, reserved, from, to, new InlineHtmlWidget(match[0], from, to));
  }

  const voidPattern = /<([A-Za-z][A-Za-z0-9:-]*)(?:\s+[^<>]*?)?\s*\/?>/g;
  for (const match of text.matchAll(voidPattern)) {
    const tagName = match[1]?.toLowerCase() ?? '';
    if (!htmlVoidElements.has(tagName)) continue;
    const start = match.index ?? 0;
    const from = lineFrom + start;
    const to = from + match[0].length;
    if (isEscapedAt(text, start)) continue;
    if (overlaps({ from, to }, codeSpans)) continue;
    if (overlaps({ from, to }, reserved)) continue;
    addReplace(decorations, reserved, from, to, new InlineHtmlWidget(match[0], from, to));
  }
}

const htmlVoidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function renderFootnotes(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  reserved: Span[],
): void {
  const codeSpans = inlineCodeSourceSpans(lineFrom, text);
  const definition = text.match(/^(\s*)\[\^([^\]\s]+)\]:\s*/);
  if (definition && !isEscapedAt(text, definition[1]!.length)) {
    const markerStart = definition[1]!.length;
    const id = definition[2] ?? '';
    const idFrom = lineFrom + markerStart + 2;
    const idTo = idFrom + id.length;
    const markerTo = lineFrom + definition[0]!.length;
    addReplace(decorations, reserved, lineFrom + markerStart, idFrom);
    addMark(decorations, reserved, idFrom, idTo, footnoteDefLabelMark);
    reserved.push({ from: idFrom, to: idTo });
    addReplace(decorations, reserved, idTo, markerTo, footnoteDefinitionSeparatorWidget);
  }

  for (const match of text.matchAll(/\[\^([^\]\s]+)\]/g)) {
    const sourceFrom = lineFrom + (match.index ?? 0);
    const sourceTo = sourceFrom + match[0].length;
    if (isEscapedAt(text, match.index ?? 0)) continue;
    if (overlaps({ from: sourceFrom, to: sourceTo }, codeSpans)) continue;
    if (overlaps({ from: sourceFrom, to: sourceTo }, reserved)) continue;
    const id = match[1] ?? '';
    const idFrom = sourceFrom + 2;
    const idTo = idFrom + id.length;
    addReplace(decorations, reserved, sourceFrom, idFrom);
    addMark(decorations, reserved, idFrom, idTo, footnoteRefMark);
    reserved.push({ from: idFrom, to: idTo });
    addReplace(decorations, reserved, idTo, sourceTo);
  }
}

function renderObsidianComments(
  lineFrom: number,
  lineTo: number,
  obsidianComments: Span[],
  decorations: Range<Decoration>[],
  reserved: Span[],
): void {
  for (const comment of obsidianComments) {
    const from = Math.max(lineFrom, comment.from);
    const to = Math.min(lineTo, comment.to);
    addReplace(decorations, reserved, from, to);
  }
}

function findObsidianCommentRanges(doc: EditorView['state']['doc']): Span[] {
  const text = doc.toString();
  const ranges: Span[] = [];
  let start: number | null = null;
  let index = 0;

  while (index < text.length - 1) {
    if (text[index] !== '%' || text[index + 1] !== '%') {
      index++;
      continue;
    }

    if (start == null) {
      start = index;
    } else {
      ranges.push({ from: start, to: index + 2 });
      start = null;
    }
    index += 2;
  }

  if (start != null) {
    ranges.push({ from: start, to: text.length });
  }
  return ranges;
}

function findHtmlCommentRanges(doc: EditorView['state']['doc']): Span[] {
  const text = doc.toString();
  const ranges: Span[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const start = text.indexOf('<!--', searchFrom);
    if (start < 0) break;
    const end = text.indexOf('-->', start + 4);
    if (end < 0) {
      ranges.push({ from: start, to: text.length });
      break;
    }
    ranges.push({ from: start, to: end + 3 });
    searchFrom = end + 3;
  }

  return ranges;
}

function renderInlineMath(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  reserved: Span[],
): void {
  for (const span of inlineMathSourceSpans(text)) {
    const from = lineFrom + span.from;
    const to = lineFrom + span.to;
    addReplace(
      decorations,
      reserved,
      from,
      to,
      new InlineMathWidget(span.content, from, to),
    );
  }
}

function inlineMathSourceSpans(text: string): Array<{ from: number; to: number; content: string }> {
  const spans: Array<{ from: number; to: number; content: string }> = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const opening = nextSingleDollar(text, searchFrom);
    if (opening < 0) break;
    const closing = nextSingleDollar(text, opening + 1);
    if (closing < 0) break;

    if (!isValidInlineMathPair(text, opening, closing)) {
      searchFrom = opening + 1;
      continue;
    }

    spans.push({
      from: opening,
      to: closing + 1,
      content: text.slice(opening + 1, closing),
    });
    searchFrom = closing + 1;
  }

  return spans;
}

function nextSingleDollar(text: string, start: number): number {
  for (let index = start; index < text.length; index++) {
    if (text[index] !== '$') continue;
    if (text[index - 1] === '$' || text[index + 1] === '$') continue;
    if (isEscapedAt(text, index)) continue;
    return index;
  }
  return -1;
}

function isValidInlineMathPair(text: string, opening: number, closing: number): boolean {
  const afterOpening = text[opening + 1];
  const beforeClosing = text[closing - 1];
  const afterClosing = text[closing + 1];
  if (!afterOpening || !beforeClosing) return false;
  if (/\s/.test(afterOpening) || /\s/.test(beforeClosing)) return false;
  return !afterClosing || !/\d/.test(afterClosing);
}

function replaceImages(
  lineFrom: number,
  text: string,
  referenceDefinitions: ReturnType<typeof markdownReferenceDefinitions>,
  decorations: Range<Decoration>[],
  reserved: Span[],
): void {
  const codeSpans = inlineCodeSourceSpans(lineFrom, text);
  for (const image of markdownLinkSourceSpans(lineFrom, text).filter(span => span.image)) {
    const url = parseMarkdownLinkDestination(image.destination);
    if (!url) continue;
    const from = image.from;
    const to = image.to;
    if (overlaps({ from, to }, codeSpans)) continue;
    addReplace(
      decorations,
      reserved,
      from,
      to,
      new ImageWidget(image.label, resolveImageResource(url, 'relative'), from, to),
    );
  }

  for (const image of markdownReferenceLinkSourceSpans(lineFrom, text, referenceDefinitions).filter(span => span.image)) {
    const from = image.from;
    const to = image.to;
    if (overlaps({ from, to }, codeSpans)) continue;
    addReplace(
      decorations,
      reserved,
      from,
      to,
      new ImageWidget(image.label, resolveImageResource(image.definition.destination, 'relative'), from, to),
    );
  }

  for (const match of text.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    const image = parseObsidianImageEmbed(match[1] ?? '');
    if (!image) continue;
    const from = lineFrom + match.index!;
    const to = from + match[0].length;
    if (isEscapedAt(text, match.index!)) continue;
    if (overlaps({ from, to }, codeSpans)) continue;
    addReplace(
      decorations,
      reserved,
      from,
      to,
      new ImageWidget(image.alt, resolveImageResource(image.url, 'vault'), from, to, image.dimensions),
    );
  }
}

function renderInlineCode(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  reserved: Span[],
): void {
  for (const span of inlineCodeSourceSpans(lineFrom, text)) {
    const from = span.from;
    const to = span.to;
    const contentFrom = span.contentFrom;
    const contentTo = span.contentTo;
    addMark(decorations, reserved, contentFrom, contentTo, inlineCodeMark);
    addReplace(decorations, reserved, from, contentFrom);
    addReplace(decorations, reserved, contentTo, to);
    reserved.push({ from: contentFrom, to: contentTo });
  }
}

function renderObsidianTags(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  reserved: Span[],
): void {
  for (const match of text.matchAll(obsidianTagPattern())) {
    const from = lineFrom + (match.index ?? 0);
    const to = from + match[0].length;
    if (isEscapedAt(text, match.index ?? 0)) continue;
    if (overlaps({ from, to }, reserved)) continue;
    decorations.push(tagMark.range(from, to));
  }
}

function obsidianTagPattern(): RegExp {
  return /(?<![A-Za-z0-9_/#])#(?=[A-Za-z0-9_/-]*[A-Za-z_])(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)/g;
}

function renderMarkdownLinks(
  lineFrom: number,
  text: string,
  referenceDefinitions: ReturnType<typeof markdownReferenceDefinitions>,
  decorations: Range<Decoration>[],
  reserved: Span[],
): void {
  for (const link of markdownLinkSourceSpans(lineFrom, text)) {
    if (link.image) continue;
    const href = link.destination;
    if (href.startsWith('hl://')) continue;
    addMark(decorations, reserved, link.labelFrom, link.labelTo, linkTextMark);
    addReplace(decorations, reserved, link.from, link.labelFrom);
    addReplace(decorations, reserved, link.labelTo, link.to);
  }

  for (const link of markdownReferenceLinkSourceSpans(lineFrom, text, referenceDefinitions)) {
    if (link.image) continue;
    if (overlaps({ from: link.from, to: link.to }, reserved)) continue;
    addMark(decorations, reserved, link.labelFrom, link.labelTo, linkTextMark);
    addReplace(decorations, reserved, link.from, link.labelFrom);
    addReplace(decorations, reserved, link.labelTo, link.to);
  }
}

function renderDelimited(
  lineFrom: number,
  text: string,
  pattern: RegExp,
  delimiterLength: number,
  marks: Decoration[],
  decorations: Range<Decoration>[],
  reserved: Span[],
): void {
  for (const match of text.matchAll(pattern)) {
    const from = lineFrom + match.index!;
    const to = from + match[0].length;
    const contentFrom = from + delimiterLength;
    const contentTo = to - delimiterLength;
    if (isEscapedAt(text, match.index ?? 0) || isEscapedAt(text, contentTo - lineFrom)) continue;
    if (overlaps({ from, to }, reserved)) continue;
    for (const mark of marks) {
      decorations.push(mark.range(contentFrom, contentTo));
    }
    addReplace(decorations, reserved, from, contentFrom);
    addReplace(decorations, reserved, contentTo, to);
  }
}

function renderEscapedMarkdownPunctuation(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  reserved: Span[],
): void {
  for (const match of text.matchAll(/\\([\\`*_[\]{}()#+\-.!|>])/g)) {
    const from = lineFrom + (match.index ?? 0);
    addReplace(decorations, reserved, from, from + 1);
  }
}

export function hybridRendering() {
  return [
    hybridPreviewEnabled,
    documentTitleRendering,
    frontmatterRendering,
    calloutRendering,
    hybridTableRendering,
    specialBlockRendering,
    hybridLineRendering,
    hybridStyles(),
  ];
}
