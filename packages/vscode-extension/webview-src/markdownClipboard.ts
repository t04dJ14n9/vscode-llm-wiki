import type { EditorView } from '@codemirror/view';
import { isCodeFenceClosing, parseCodeFenceOpening } from './markdownFences';
import { markdownFromPastedHtml } from './markdownPaste';
import { inlineCodeSourceSpans, isEscapedAt, overlapsSpan } from './markdownSpans';
import { writeTextToClipboard } from './webviewClipboard';
import type { CopyTextFallback } from './webviewClipboard';

const renderedPreviewBlockSelector = [
  '.cm-hybrid-callout',
  '.cm-hybrid-codeblock',
  '.cm-hybrid-mermaid-block',
  '.cm-hybrid-math-block',
  '.cm-hybrid-table-widget',
].join(',');

const sourcedPreviewWidgetSelector = [
  '.cm-hl-link',
  '.cm-hybrid-callout',
  '.cm-hybrid-codeblock',
  '.cm-hybrid-image',
  '.cm-hybrid-image-img',
  '.cm-hybrid-inline-html',
  '.cm-hybrid-inline-math',
  '.cm-hybrid-math-block',
  '.cm-hybrid-mermaid-block',
  '.cm-hybrid-table-widget',
].join(',');

export function handleCopy(event: ClipboardEvent, editorView: EditorView): boolean {
  if (!event.clipboardData) return false;

  const selectedMarkdown = selectedMarkdownFromNativeSelection(editorView)
    ?? selectedMarkdownFromEditorSelection(editorView);
  if (selectedMarkdown == null) return false;

  event.clipboardData.clearData();
  event.clipboardData.setData('text/plain', selectedMarkdown);
  event.preventDefault();
  return true;
}

export function copySelectionToClipboard(
  editorView: EditorView,
  copyTextFallback: CopyTextFallback,
): boolean {
  const selectedMarkdown = selectedMarkdownFromNativeSelection(editorView)
    ?? selectedMarkdownFromEditorSelection(editorView);
  if (selectedMarkdown == null) return false;

  void writeTextToClipboard(selectedMarkdown, copyTextFallback);
  return true;
}

export function handlePaste(event: ClipboardEvent, editorView: EditorView): boolean {
  if (!event.clipboardData || isFormField(event.target)) return false;

  const html = event.clipboardData.getData('text/html');
  if (!html.trim()) return false;

  const markdown = markdownFromPastedHtml(html);
  if (!markdown) return false;

  editorView.dispatch(editorView.state.replaceSelection(markdown));
  editorView.focus();
  event.preventDefault();
  return true;
}

function isFormField(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}

function selectedMarkdownFromEditorSelection(editorView: EditorView): string | null {
  const ranges = editorView.state.selection.ranges.filter(range => !range.empty);
  if (ranges.length === 0) return null;
  return ranges
    .map(range => editorView.state.sliceDoc(range.from, range.to))
    .join('\n');
}

function selectedMarkdownFromNativeSelection(editorView: EditorView): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index));
  if (!ranges.some(range => intersectsNode(range, editorView.dom))) return null;

  const titleInput = editorView.dom.querySelector('.cm-hybrid-document-title-input');
  if (titleInput && ranges.some(range => intersectsNode(range, titleInput))) {
    return editorView.state.doc.toString();
  }

  const endpointRange = sourceRangeFromDomSelectionEndpoints(editorView, selection);
  const widgetRange = sourceRangeFromSourcedPreviewWidgets(editorView.dom, ranges);
  if (
    widgetRange
    && endpointRange
    && (
      editorView.state.sliceDoc(endpointRange.from, endpointRange.to).trim() === ''
      || addsOnlyWhitespaceAroundRange(editorView, endpointRange, widgetRange)
    )
  ) {
    return editorView.state.sliceDoc(widgetRange.from, widgetRange.to);
  }
  const selectedRange = unionOptionalSourceRanges(endpointRange, widgetRange);
  if (!selectedRange) {
    return editorView.state.doc.toString();
  }

  if (!endpointRange || endpointRange.from === endpointRange.to) {
    return editorView.state.sliceDoc(selectedRange.from, selectedRange.to);
  }

  const range = expandRangeThroughSourceBlockBoundaries(
    editorView.state.doc,
    expandRangeThroughIntersectingSourceBlocks(
      editorView.state.doc,
      expandRangeThroughRenderedPreviewBlocks(
        editorView.dom,
        expandRangeThroughRenderedInlineSyntax(editorView.state.doc, selectedRange),
      ),
    ),
  );
  return editorView.state.sliceDoc(range.from, range.to);
}

function sourceRangeFromDomSelectionEndpoints(
  editorView: EditorView,
  selection: Selection,
): SourceRange | null {
  const positions = [
    positionFromDomSelection(editorView, selection.anchorNode, selection.anchorOffset),
    positionFromDomSelection(editorView, selection.focusNode, selection.focusOffset),
  ].filter((position): position is number => typeof position === 'number');
  if (positions.length === 0) return null;
  if (positions.length === 1) return { from: positions[0]!, to: positions[0]! };
  return {
    from: Math.min(positions[0]!, positions[1]!),
    to: Math.max(positions[0]!, positions[1]!),
  };
}

function addsOnlyWhitespaceAroundRange(
  editorView: EditorView,
  outer: SourceRange,
  inner: SourceRange,
): boolean {
  if (outer.from > inner.from || outer.to < inner.to) return false;
  return editorView.state.sliceDoc(outer.from, inner.from).trim() === ''
    && editorView.state.sliceDoc(inner.to, outer.to).trim() === '';
}

function intersectsNode(range: globalThis.Range, node: Node): boolean {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

interface SourceRange {
  from: number;
  to: number;
}

function expandRangeThroughRenderedPreviewBlocks(root: ParentNode, range: SourceRange): SourceRange {
  let expanded = { ...range };
  let changed = true;
  while (changed) {
    changed = false;
    for (const span of renderedPreviewBlockSpans(root)) {
      if (!touchesSourceSpan(expanded, span)) continue;
      const next = {
        from: Math.min(expanded.from, span.from),
        to: Math.max(expanded.to, span.to),
      };
      if (next.from !== expanded.from || next.to !== expanded.to) {
        expanded = next;
        changed = true;
      }
    }
  }
  return expanded;
}

function touchesSourceSpan(range: SourceRange, span: SourceRange): boolean {
  return span.from <= range.to && span.to >= range.from;
}

function unionSourceRanges(first: SourceRange, second: SourceRange): SourceRange {
  return {
    from: Math.min(first.from, second.from),
    to: Math.max(first.to, second.to),
  };
}

function unionOptionalSourceRanges(
  first: SourceRange | null,
  second: SourceRange | null,
): SourceRange | null {
  if (!first) return second;
  if (!second) return first;
  return unionSourceRanges(first, second);
}

interface InlineSyntaxSpan extends SourceRange {
  contentFrom: number;
  contentTo: number;
}

function expandRangeThroughRenderedInlineSyntax(
  doc: EditorView['state']['doc'],
  range: SourceRange,
): SourceRange {
  let expanded = { ...range };
  const startLine = doc.lineAt(range.from).number;
  const endLine = doc.lineAt(Math.max(range.from, Math.min(range.to, doc.length))).number;

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    const line = doc.line(lineNumber);
    for (const span of renderedInlineSyntaxSpans(line.from, line.text)) {
      if (expanded.from <= span.contentFrom && expanded.to >= span.contentTo) {
        expanded = unionSourceRanges(expanded, span);
      }
    }
  }

  return expanded;
}

function renderedInlineSyntaxSpans(lineFrom: number, text: string): InlineSyntaxSpan[] {
  const spans: InlineSyntaxSpan[] = [];
  addInlineSyntaxSpans(lineFrom, text, /`([^`]+)`/g, 1, spans);
  addInlineSyntaxSpans(lineFrom, text, /\*\*\*(?=\S)(.+?\S)\*\*\*/g, 3, spans);
  addInlineSyntaxSpans(lineFrom, text, /___(?=\S)(.+?\S)___/g, 3, spans);
  addInlineSyntaxSpans(lineFrom, text, /\*\*(?=\S)(.+?\S)\*\*/g, 2, spans);
  addInlineSyntaxSpans(lineFrom, text, /__(?=\S)(.+?\S)__/g, 2, spans);
  addInlineSyntaxSpans(lineFrom, text, /(?<!\*)\*(?=\S)(.+?\S)\*(?!\*)/g, 1, spans);
  addInlineSyntaxSpans(lineFrom, text, /(?<!_)_(?=\S)(.+?\S)_(?!_)/g, 1, spans);
  addInlineSyntaxSpans(lineFrom, text, /~~(?=\S)(.+?\S)~~/g, 2, spans);
  addInlineSyntaxSpans(lineFrom, text, /==(?=\S)(.+?\S)==/g, 2, spans);
  addEscapedMarkdownPunctuationSpans(lineFrom, text, spans);
  addFootnoteSyntaxSpans(lineFrom, text, spans);
  return spans.sort((a, b) => a.from - b.from || a.to - b.to);
}

function addInlineSyntaxSpans(
  lineFrom: number,
  text: string,
  pattern: RegExp,
  delimiterLength: number,
  spans: InlineSyntaxSpan[],
): void {
  for (const match of text.matchAll(pattern)) {
    const from = lineFrom + (match.index ?? 0);
    const to = from + match[0].length;
    spans.push({
      from,
      to,
      contentFrom: from + delimiterLength,
      contentTo: to - delimiterLength,
    });
  }
}

function addEscapedMarkdownPunctuationSpans(
  lineFrom: number,
  text: string,
  spans: InlineSyntaxSpan[],
): void {
  const codeSpans = inlineCodeSourceSpans(lineFrom, text);
  for (const match of text.matchAll(/\\([\\`*_[\]{}()#+\-.!|>])/g)) {
    const from = lineFrom + (match.index ?? 0);
    const to = from + match[0].length;
    if (overlapsSpan({ from, to }, codeSpans)) continue;
    spans.push({
      from,
      to,
      contentFrom: from + 1,
      contentTo: to,
    });
  }
}

function addFootnoteSyntaxSpans(
  lineFrom: number,
  text: string,
  spans: InlineSyntaxSpan[],
): void {
  const codeSpans = inlineCodeSourceSpans(lineFrom, text);
  const definition = text.match(/^(\s*)\[\^([^\]\s]+)\]:\s*/);
  if (definition && !isEscapedAt(text, definition[1]!.length)) {
    const markerStart = definition[1]!.length;
    const id = definition[2] ?? '';
    const from = lineFrom + markerStart;
    const idFrom = from + 2;
    const idTo = idFrom + id.length;
    const to = lineFrom + definition[0]!.length;
    spans.push({
      from,
      to,
      contentFrom: idFrom,
      contentTo: idTo,
    });
  }

  for (const match of text.matchAll(/\[\^([^\]\s]+)\]/g)) {
    const sourceIndex = match.index ?? 0;
    const from = lineFrom + sourceIndex;
    const to = from + match[0].length;
    if (isEscapedAt(text, sourceIndex)) continue;
    if (overlapsSpan({ from, to }, codeSpans)) continue;
    spans.push({
      from,
      to,
      contentFrom: from + 2,
      contentTo: to - 1,
    });
  }
}

function expandRangeThroughSourceBlockBoundaries(
  doc: EditorView['state']['doc'],
  range: SourceRange,
): SourceRange {
  let expanded = { ...range };
  let changed = true;
  while (changed) {
    changed = false;
    const nextBlock = sourceBlockStartingAt(doc, expanded.to);
    if (nextBlock && nextBlock.to > expanded.to) {
      expanded = { ...expanded, to: nextBlock.to };
      changed = true;
    }

    const previousBlock = sourceBlockEndingAt(doc, expanded.from);
    if (previousBlock && previousBlock.from < expanded.from) {
      expanded = { ...expanded, from: previousBlock.from };
      changed = true;
    }
  }
  return expanded;
}

function expandRangeThroughIntersectingSourceBlocks(
  doc: EditorView['state']['doc'],
  range: SourceRange,
): SourceRange {
  let expanded = { ...range };
  let changed = true;
  while (changed) {
    changed = false;
    for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
      const block = sourceBlockFromLine(doc, lineNumber);
      if (!block || !sourceRangesIntersect(expanded, block)) continue;
      const next = unionSourceRanges(expanded, block);
      if (next.from !== expanded.from || next.to !== expanded.to) {
        expanded = next;
        changed = true;
      }
    }
  }
  return expanded;
}

function sourceRangesIntersect(first: SourceRange, second: SourceRange): boolean {
  return first.from < second.to && first.to > second.from;
}

function sourceBlockStartingAt(doc: EditorView['state']['doc'], position: number): SourceRange | null {
  if (position < 0 || position > doc.length) return null;
  const line = doc.lineAt(position);
  if (line.from !== position) return null;
  return sourceBlockFromLine(doc, line.number);
}

function sourceBlockEndingAt(doc: EditorView['state']['doc'], position: number): SourceRange | null {
  if (position <= 0 || position > doc.length) return null;
  const line = doc.lineAt(position - 1);
  if (line.to !== position) return null;

  for (let lineNumber = line.number; lineNumber >= 1; lineNumber--) {
    const block = sourceBlockFromLine(doc, lineNumber);
    if (block && block.to === position) return block;
    if (block && block.to < position) return null;
  }
  return null;
}

function sourceBlockFromLine(doc: EditorView['state']['doc'], lineNumber: number): SourceRange | null {
  const line = doc.line(lineNumber);
  const codeFence = parseCodeFenceOpening(line.text);
  if (codeFence) {
    const marker = codeFence.marker;
    for (let currentLineNumber = lineNumber + 1; currentLineNumber <= doc.lines; currentLineNumber++) {
      const current = doc.line(currentLineNumber);
      if (isCodeFenceClosing(current.text, marker)) {
        return { from: line.from, to: current.to };
      }
    }
    return null;
  }

  if (/^\s*\$\$\s*$/.test(line.text)) {
    for (let currentLineNumber = lineNumber + 1; currentLineNumber <= doc.lines; currentLineNumber++) {
      const current = doc.line(currentLineNumber);
      if (/^\s*\$\$\s*$/.test(current.text)) {
        return { from: line.from, to: current.to };
      }
    }
  }

  return null;
}

function renderedPreviewBlockSpans(root: ParentNode): SourceRange[] {
  const previewBlocks = root.querySelectorAll<HTMLElement>(renderedPreviewBlockSelector);
  const spans: SourceRange[] = [];
  for (const element of Array.from(previewBlocks)) {
    const range = sourceRangeFromElement(element);
    if (range) spans.push(range);
  }
  return spans;
}

function sourceRangeFromSourcedPreviewWidgets(root: ParentNode, ranges: globalThis.Range[]): SourceRange | null {
  const widgets = root.querySelectorAll<HTMLElement>(sourcedPreviewWidgetSelector);
  let exactRange: SourceRange | null = null;
  for (const widget of Array.from(widgets)) {
    if (!ranges.some(range => selectsNodeExactly(range, widget))) continue;
    exactRange = unionOptionalSourceRanges(exactRange, sourceRangeFromElement(widget));
  }
  if (exactRange) return exactRange;

  let sourceRange: SourceRange | null = null;
  for (const widget of Array.from(widgets)) {
    if (!ranges.some(range => intersectsNode(range, widget))) continue;
    sourceRange = unionOptionalSourceRanges(sourceRange, sourceRangeFromElement(widget));
  }
  return sourceRange;
}

function selectsNodeExactly(range: globalThis.Range, node: Node): boolean {
  const nodeRange = document.createRange();
  nodeRange.selectNode(node);
  return range.compareBoundaryPoints(Range.START_TO_START, nodeRange) === 0
    && range.compareBoundaryPoints(Range.END_TO_END, nodeRange) === 0;
}

function sourceRangeFromElement(element: HTMLElement): SourceRange | null {
  const from = Number.parseInt(element.dataset.sourceFrom ?? '', 10);
  const to = Number.parseInt(element.dataset.sourceTo ?? '', 10);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return { from, to };
}

function positionFromDomSelection(editorView: EditorView, node: Node | null, offset: number): number | null {
  if (!node || !editorView.contentDOM.contains(node)) return null;
  try {
    return editorView.posAtDOM(node, offset);
  } catch {
    return null;
  }
}
