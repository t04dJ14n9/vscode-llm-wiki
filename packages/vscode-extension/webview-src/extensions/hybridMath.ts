import { Decoration, type EditorView, WidgetType } from '@codemirror/view';
import type { EditorState, Range } from '@codemirror/state';
import type * as MathJaxRuntime from './mathJaxRuntime';
import type { MathRenderResult } from './mathJaxRuntime';

interface MathBlockPreview {
  content: string;
  from: number;
  to: number;
  startLine: number;
  endLine: number;
}

let mathJaxRuntime: Promise<typeof MathJaxRuntime> | undefined;

export class InlineMathWidget extends WidgetType {
  constructor(
    private readonly expression: string,
    private readonly sourceFrom: number,
    private readonly sourceTo: number,
  ) {
    super();
  }

  override toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-hybrid-inline-math';
    element.dataset.sourceFrom = String(this.sourceFrom);
    element.dataset.sourceTo = String(this.sourceTo);
    renderMathInto(element, this.expression, false);
    return element;
  }

  override eq(other: InlineMathWidget): boolean {
    return this.expression === other.expression
      && this.sourceFrom === other.sourceFrom
      && this.sourceTo === other.sourceTo;
  }
}

export class MathBlockWidget extends WidgetType {
  constructor(
    private readonly expression: string,
    private readonly blockFrom: number,
    private readonly blockTo: number,
    private readonly activePreview = false,
    private readonly compactLinePreview = false,
  ) {
    super();
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = [
      'cm-hybrid-math-block',
      this.activePreview ? 'cm-hybrid-math-block-active-preview' : '',
      this.compactLinePreview ? 'cm-hybrid-math-block-line-preview' : '',
    ].filter(Boolean).join(' ');
    wrapper.dataset.sourceFrom = String(this.blockFrom);
    wrapper.dataset.sourceTo = String(this.blockTo);
    const inner = document.createElement('div');
    inner.className = 'cm-hybrid-math-block-inner';
    const content = document.createElement('div');
    content.className = 'cm-hybrid-math-block-content';
    renderMathInto(content, this.expression, true);

    const editSource = document.createElement('button');
    editSource.type = 'button';
    editSource.className = 'cm-hybrid-math-block-edit';
    editSource.textContent = '</>';
    editSource.title = 'Edit this block';
    editSource.ariaLabel = 'Edit this block';
    inner.append(content, editSource);
    wrapper.appendChild(inner);

    const revealSource = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: this.editableSelection(view) });
      view.focus();
    };

    wrapper.addEventListener('mousedown', revealSource);
    editSource.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      revealSource(event);
    });

    return wrapper;
  }

  private editableSelection(view: EditorView): { anchor: number; head?: number } {
    const openingLine = view.state.doc.lineAt(this.blockFrom);
    const closingLine = view.state.doc.lineAt(this.blockTo);

    if (openingLine.number === closingLine.number) {
      const opener = openingLine.text.indexOf('$$');
      const closer = openingLine.text.lastIndexOf('$$');
      if (opener >= 0 && closer > opener) {
        return {
          anchor: openingLine.from + opener + 2,
          head: openingLine.from + closer,
        };
      }
      return { anchor: this.blockFrom };
    }

    if (openingLine.number + 1 < closingLine.number) {
      return {
        anchor: view.state.doc.line(openingLine.number + 1).from,
        head: view.state.doc.line(closingLine.number - 1).to,
      };
    }

    return { anchor: closingLine.from };
  }

  override eq(other: MathBlockWidget): boolean {
    return this.expression === other.expression
      && this.blockFrom === other.blockFrom
      && this.blockTo === other.blockTo
      && this.activePreview === other.activePreview
      && this.compactLinePreview === other.compactLinePreview;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

export function addSingleLineMathDecorations(
  _state: EditorState,
  block: MathBlockPreview,
  decorations: Range<Decoration>[],
): void {
  decorations.push(Decoration.replace({
    widget: new MathBlockWidget(block.content, block.from, block.to),
    block: true,
  }).range(block.from, block.to));
}

export function addMultiLineMathDecorations(
  _state: EditorState,
  block: MathBlockPreview,
  decorations: Range<Decoration>[],
): void {
  decorations.push(Decoration.replace({
    widget: new MathBlockWidget(block.content, block.from, block.to),
    block: true,
  }).range(block.from, block.to));
}

export function renderMathInto(container: HTMLElement, expression: string, displayMode: boolean): void {
  container.setAttribute('aria-busy', 'true');
  mathJaxRuntime ??= import(
    /* webpackChunkName: "markdown-mathjax" */ './mathJaxRuntime'
  );
  void mathJaxRuntime.then(runtime => {
    container.removeAttribute('aria-busy');
    applyMathRender(container, expression, displayMode, runtime.renderMath(expression, displayMode));
  }).catch(error => {
    container.removeAttribute('aria-busy');
    container.replaceChildren(createMathErrorElement(expression, mathErrorMessage(error), displayMode));
  });
}

function applyMathRender(
  container: HTMLElement,
  expression: string,
  displayMode: boolean,
  rendered: MathRenderResult,
): void {
  if (rendered.ok) {
    container.innerHTML = rendered.html;
    const mathContainer = container.querySelector<HTMLElement>('mjx-container');
    if (mathContainer) {
      mathContainer.dataset.tex = expression;
      mathContainer.dataset.display = displayMode ? 'true' : 'false';
      mathContainer.setAttribute('role', 'math');
      mathContainer.setAttribute('aria-label', expression);
    }
    return;
  }

  container.replaceChildren(createMathErrorElement(expression, rendered.error, displayMode));
}

function createMathErrorElement(
  expression: string,
  message: string,
  displayMode: boolean,
): HTMLElement {
  const wrapper = document.createElement(displayMode ? 'div' : 'span');
  wrapper.className = [
    'cm-hybrid-math-error',
    displayMode ? 'cm-hybrid-math-error-display' : 'cm-hybrid-math-error-inline',
  ].join(' ');
  wrapper.title = message;

  const title = document.createElement('span');
  title.className = 'cm-hybrid-math-error-title';
  title.textContent = 'Invalid TeX';
  wrapper.appendChild(title);

  const details = document.createElement('span');
  details.className = 'cm-hybrid-math-error-message';
  details.textContent = message;
  wrapper.appendChild(details);

  const source = document.createElement('code');
  source.className = 'cm-hybrid-math-error-source';
  source.textContent = expression;
  wrapper.appendChild(source);

  return wrapper;
}

function mathErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  const message = String(error).trim();
  return message || 'MathJax could not parse this expression.';
}
