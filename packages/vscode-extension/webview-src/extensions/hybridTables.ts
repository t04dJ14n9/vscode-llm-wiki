import { Decoration, type EditorView, WidgetType } from '@codemirror/view';
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
    const draftRows = this.rows.map(row => row.map(cell => cell.text));
    let activeInput: HTMLInputElement | null = null;
    let cancelled = false;
    let committed = false;
    const editableCells: Array<{ rowIndex: number; cellIndex: number }> = [];
    const inner = document.createElement('div');
    inner.className = 'cm-hybrid-table-widget-inner';

    const table = document.createElement('table');
    table.className = 'cm-hybrid-table';
    const tbody = document.createElement('tbody');

    this.rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      for (const [cellIndex, cell] of row.entries()) {
        const element = document.createElement(rowIndex === 0 ? 'th' : 'td');
        element.dataset.sourceFrom = String(cell.from);
        element.dataset.sourceTo = String(cell.to);
        applyTableCellAlignment(element, this.alignments[cellIndex]);
        const display = document.createElement('span');
        display.className = 'cm-hybrid-table-cell-display';
        this.renderCellInlineMarkdown(display, cell.text, 'cm-hybrid-table', cell.from, view);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cm-hybrid-table-cell-input';
        input.value = cell.text;
        input.hidden = true;
        input.spellcheck = false;
        input.autocomplete = 'off';
        input.setAttribute('aria-label', `Table cell ${cell.text}`);
        input.dataset.tableRow = String(rowIndex);
        input.dataset.tableColumn = String(cellIndex);
        editableCells.push({ rowIndex, cellIndex });
        input.addEventListener('input', () => {
          draftRows[rowIndex]![cellIndex] = input.value;
        });

        const activateInput = () => {
          if (activeInput && activeInput !== input) {
            activeInput.hidden = true;
            const previousDisplay = activeInput.previousElementSibling;
            if (previousDisplay instanceof HTMLElement) previousDisplay.hidden = false;
          }
          display.hidden = true;
          input.hidden = false;
          activeInput = input;
          input.focus({ preventScroll: true });
          input.select();
        };
        const activate = (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
          activateInput();
        };
        display.addEventListener('mousedown', activate);
        display.addEventListener('click', event => event.stopPropagation());
        element.append(display, input);
        tr.appendChild(element);

        input.addEventListener('keydown', event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            commit();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancel();
            return;
          }
          if (event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            const currentIndex = editableCells.findIndex(cellPosition => (
              cellPosition.rowIndex === rowIndex && cellPosition.cellIndex === cellIndex
            ));
            if (currentIndex < 0) return;
            commit();
            const direction = event.shiftKey ? -1 : 1;
            const nextIndex = (currentIndex + direction + editableCells.length) % editableCells.length;
            const next = editableCells[nextIndex]!;
            focusTableInput(view, this.blockFrom, next.rowIndex, next.cellIndex);
          }
        });
      }
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    inner.appendChild(table);
    wrapper.appendChild(inner);

    const closeActiveInput = () => {
      if (!activeInput) return;
      activeInput.hidden = true;
      const display = activeInput.previousElementSibling;
      if (display instanceof HTMLElement) display.hidden = false;
      activeInput = null;
    };
    const commit = (): boolean => {
      if (committed || cancelled) return false;
      committed = true;
      const source = serializeMarkdownTable(draftRows, this.alignments);
      if (source !== view.state.doc.sliceString(this.blockFrom, this.blockTo)) {
        view.dispatch({
          changes: { from: this.blockFrom, to: this.blockTo, insert: source },
        });
      }
      closeActiveInput();
      return true;
    };
    const cancel = () => {
      if (cancelled || committed) return;
      cancelled = true;
      closeActiveInput();
    };

    wrapper.addEventListener('focusout', event => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && wrapper.contains(nextTarget)) return;
      commit();
    });
    wrapper.addEventListener('mousedown', event => {
      event.stopPropagation();
      if (
        event.target instanceof Element
        && event.target.closest('.cm-hybrid-table-cell-input')
      ) {
        return;
      }
      event.preventDefault();
      const cell = event.target instanceof Element
        ? event.target.closest<HTMLElement>('th,td')
        : null;
      const sourceFrom = cell?.dataset.sourceFrom ? Number(cell.dataset.sourceFrom) : this.blockFrom;
      const anchor = Number.isFinite(sourceFrom) ? sourceFrom : this.blockFrom;
      view.dispatch({ selection: { anchor } });
      view.focus();
    });
    wrapper.addEventListener('keydown', event => event.stopPropagation());
    wrapper.addEventListener('input', event => event.stopPropagation());

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

function focusTableInput(
  view: EditorView,
  blockFrom: number,
  rowIndex: number,
  cellIndex: number,
  attempt = 0,
): void {
  requestAnimationFrame(() => {
    const input = view.dom.querySelector<HTMLInputElement>(
      `.cm-hybrid-table-widget[data-source-from="${blockFrom}"] `
        + `.cm-hybrid-table-cell-input[data-table-row="${rowIndex}"][data-table-column="${cellIndex}"]`,
    );
    if (!input) {
      if (attempt < 3) focusTableInput(view, blockFrom, rowIndex, cellIndex, attempt + 1);
      return;
    }
    const display = input.previousElementSibling;
    if (display instanceof HTMLElement) display.hidden = true;
    input.hidden = false;
    input.focus({ preventScroll: true });
    input.select();
  });
}

function serializeMarkdownTable(rows: string[][], alignments: TableAlignment[]): string {
  const columnCount = Math.max(alignments.length, ...rows.map(row => row.length));
  const escapedRows = rows.map(row => Array.from({ length: columnCount }, (_, index) => (
    escapeTableCell(row[index] ?? '')
  )));
  const widths = Array.from({ length: columnCount }, (_, index) => {
    const contentWidth = Math.max(0, ...escapedRows.map(row => row[index]!.length));
    const minimum = alignments[index] === 'center' ? 5 : alignments[index] === 'right' ? 4 : 3;
    return Math.max(contentWidth, minimum);
  });
  const rowLine = (row: string[]) => `| ${row
    .map((cell, index) => cell.padEnd(widths[index]!))
    .join(' | ')} |`;
  const separator = widths.map((width, index) => {
    if (alignments[index] === 'center') return `:${'-'.repeat(width - 2)}:`;
    if (alignments[index] === 'right') return `${'-'.repeat(width - 1)}:`;
    return '-'.repeat(width);
  });
  const [header = Array.from({ length: columnCount }, () => ''), ...body] = escapedRows;
  return [rowLine(header), rowLine(separator), ...body.map(rowLine)].join('\n');
}

function escapeTableCell(value: string): string {
  return value.trim().replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
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
