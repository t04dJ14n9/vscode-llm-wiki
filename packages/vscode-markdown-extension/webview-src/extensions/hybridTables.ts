import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type { EditorState, Range } from '@codemirror/state';

export type TableAlignment = 'left' | 'center' | 'right';

export interface TableCell {
  from: number;
  text: string;
  to: number;
}

export interface TableBlock {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  rows: TableCell[][];
  alignments: TableAlignment[];
}

export interface TableDecorationOptions {
  activeLines: Set<number>;
  renderCellInlineMarkdown: (
    container: HTMLElement,
    source: string,
    classPrefix: string,
    sourceFrom: number,
    view: EditorView,
  ) => void;
  skipBlockAtLine: (lineNumber: number) => { endLine: number } | null;
}

class TableWidget extends WidgetType {
  constructor(
    private readonly rows: TableCell[][],
    private readonly alignments: TableAlignment[],
    private readonly blockFrom: number,
    private readonly blockTo: number,
    private readonly renderCellInlineMarkdown: TableDecorationOptions['renderCellInlineMarkdown'],
  ) {
    super();
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-hybrid-table-widget';
    wrapper.dataset.sourceFrom = String(this.blockFrom);
    wrapper.dataset.sourceTo = String(this.blockTo);
    const inner = document.createElement('div');
    inner.className = 'cm-hybrid-table-widget-inner';

    const table = document.createElement('table');
    table.className = 'cm-hybrid-table';
    const tbody = document.createElement('tbody');

    this.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      for (const [cellIndex, cell] of row.entries()) {
        const element = document.createElement(rowIndex === 0 ? 'th' : 'td');
        applyTableCellAlignment(element, this.alignments[cellIndex]);
        this.renderCellInlineMarkdown(element, cell.text, 'cm-hybrid-table', cell.from, view);
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
      view.dispatch({ selection: { anchor: this.blockFrom } });
      view.focus();
    });

    return wrapper;
  }

  override eq(other: TableWidget): boolean {
    return JSON.stringify(this.rows) === JSON.stringify(other.rows)
      && JSON.stringify(this.alignments) === JSON.stringify(other.alignments)
      && this.blockFrom === other.blockFrom
      && this.blockTo === other.blockTo;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

export function buildTableDecorations(
  state: EditorState,
  options: TableDecorationOptions,
): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  let lineNumber = 1;
  while (lineNumber <= state.doc.lines) {
    const skippedBlock = options.skipBlockAtLine(lineNumber);
    if (skippedBlock) {
      lineNumber = skippedBlock.endLine + 1;
      continue;
    }

    const table = findTableBlock(state.doc, lineNumber);
    if (!table) {
      lineNumber++;
      continue;
    }
    const tableHasSelection = [...options.activeLines].some(activeLine => (
      activeLine >= table.startLine && activeLine <= table.endLine
    ));
    if (!tableHasSelection) {
      decorations.push(Decoration.replace({
        widget: new TableWidget(
          table.rows,
          table.alignments,
          table.from,
          table.to,
          options.renderCellInlineMarkdown,
        ),
        block: true,
      }).range(table.from, table.to));
    }
    lineNumber = table.endLine + 1;
  }
  decorations.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(decorations, true);
}

export function findTableBlock(
  doc: EditorState['doc'],
  startLine: number,
): TableBlock | null {
  if (startLine >= doc.lines) return null;
  const headerLine = doc.line(startLine);
  const separatorLine = doc.line(startLine + 1);
  const header = parseTableRowCells(headerLine.text, headerLine.from);
  const alignments = tableAlignmentsFromSeparator(separatorLine.text);
  if (!header || !alignments) return null;

  const rows: TableCell[][] = [header];
  let endLine = startLine + 1;
  for (let lineNumber = startLine + 2; lineNumber <= doc.lines; lineNumber++) {
    const line = doc.line(lineNumber);
    const row = parseTableRowCells(line.text, line.from);
    if (!row) break;
    rows.push(row);
    endLine = lineNumber;
  }

  return {
    from: headerLine.from,
    to: doc.line(endLine).to,
    startLine,
    endLine,
    rows,
    alignments,
  };
}

export function parseTableRow(text: string): string[] | null {
  return parseTableRowCells(text, 0)?.map(cell => cell.text) ?? null;
}

export function parseTableRowCells(text: string, lineFrom: number): TableCell[] | null {
  const trimmed = text.trim();
  if (!trimmed.includes('|')) return null;

  let bodyFrom = text.search(/\S/);
  let bodyTo = text.search(/\s*$/);
  if (bodyFrom < 0) return null;
  if (bodyTo < bodyFrom) bodyTo = text.length;

  if (text[bodyFrom] === '|') bodyFrom++;
  if (bodyTo > bodyFrom && text[bodyTo - 1] === '|' && !isEscaped(text, bodyTo - 1)) {
    bodyTo--;
  }

  const cells = splitTableCellRanges(text, bodyFrom, bodyTo).map(cell => {
    const from = trimLeadingWhitespace(text, cell.from, cell.to);
    const to = trimTrailingWhitespace(text, from, cell.to);
    return {
      from: lineFrom + from,
      text: unescapeTableCellPipes(text.slice(from, to)),
      to: lineFrom + to,
    };
  });
  return cells.length >= 2 ? cells : null;
}

function trimLeadingWhitespace(text: string, from: number, to: number): number {
  let index = from;
  while (index < to && /\s/.test(text[index]!)) index++;
  return index;
}

function trimTrailingWhitespace(text: string, from: number, to: number): number {
  let index = to;
  while (index > from && /\s/.test(text[index - 1]!)) index--;
  return index;
}

function splitTableCellRanges(text: string, from: number, to: number): Array<{ from: number; to: number }> {
  const cells: Array<{ from: number; to: number }> = [];
  let cellFrom = from;
  let codeFenceLength = 0;

  for (let index = from; index < to; index++) {
    const char = text[index]!;
    if (char === '`') {
      const runLength = countBacktickRun(text, index);
      if (codeFenceLength === 0) {
        codeFenceLength = runLength;
      } else if (runLength === codeFenceLength) {
        codeFenceLength = 0;
      }
      index += runLength - 1;
      continue;
    }

    if (char === '|' && codeFenceLength === 0 && !isEscaped(text, index)) {
      cells.push({ from: cellFrom, to: index });
      cellFrom = index + 1;
    }
  }

  cells.push({ from: cellFrom, to });
  return cells;
}

function unescapeTableCellPipes(text: string): string {
  let output = '';
  let codeFenceLength = 0;

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '`') {
      const runLength = countBacktickRun(text, index);
      const run = text.slice(index, index + runLength);
      output += run;
      if (codeFenceLength === 0) {
        codeFenceLength = runLength;
      } else if (runLength === codeFenceLength) {
        codeFenceLength = 0;
      }
      index += runLength - 1;
      continue;
    }

    if (char === '\\' && text[index + 1] === '|' && codeFenceLength === 0) {
      output += '|';
      index++;
      continue;
    }

    output += char;
  }

  return output;
}

function countBacktickRun(text: string, start: number): number {
  let end = start + 1;
  while (end < text.length && text[end] === '`') end++;
  return end - start;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let position = index - 1; position >= 0 && text[position] === '\\'; position--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

export function tableAlignmentsFromSeparator(text: string): TableAlignment[] | null {
  const cells = parseTableRow(text);
  if (!cells || !cells.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  return cells.map(tableAlignmentFromSeparatorCell);
}

function tableAlignmentFromSeparatorCell(cell: string): TableAlignment {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

export function applyTableCellAlignment(cell: HTMLTableCellElement, alignment: TableAlignment | undefined): void {
  if (alignment) {
    cell.style.textAlign = alignment;
  }
}
