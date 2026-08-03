import { Decoration, type EditorView, WidgetType } from '@codemirror/view';
import type { EditorState, Range } from '@codemirror/state';
import { browserAdaptor } from '@mathjax/src/cjs/adaptors/browserAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/cjs/handlers/html.js';
import { mathjax } from '@mathjax/src/cjs/mathjax.js';
import { TeX } from '@mathjax/src/cjs/input/tex.js';
import { SVG } from '@mathjax/src/cjs/output/svg.js';
import '@mathjax/src/cjs/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/cjs/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/cjs/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/cjs/input/tex/noundefined/NoUndefinedConfiguration.js';

interface MathBlockPreview {
  content: string;
  from: number;
  to: number;
  startLine: number;
  endLine: number;
}

const mathJaxAdaptor = browserAdaptor();
RegisterHTMLHandler(mathJaxAdaptor);
const mathJaxInput = new TeX({
  packages: ['base', 'ams', 'mathtools', 'newcommand', 'noundefined'],
});
const mathJaxOutput = new SVG({ fontCache: 'local' });
const mathJaxDocument = mathjax.document(document, {
  InputJax: mathJaxInput,
  OutputJax: mathJaxOutput,
});
const mathJaxRenderOptions = {
  em: 16,
  ex: 8,
  containerWidth: 80 * 16,
};

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
    renderMathInto(inner, this.expression, true);
    wrapper.appendChild(inner);

    wrapper.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.blockFrom } });
    });

    return wrapper;
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

class HiddenSourceWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-hybrid-hidden-source';
    element.ariaHidden = 'true';
    element.textContent = '\u00A0';
    return element;
  }

  override eq(): boolean {
    return true;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

export function addSingleLineMathDecorations(
  state: EditorState,
  block: MathBlockPreview,
  decorations: Range<Decoration>[],
): void {
  const line = state.doc.line(block.startLine);
  hideSourceLine(line.from, line.to, decorations);
  decorations.push(Decoration.widget({
    widget: new MathBlockWidget(block.content, block.from, block.to),
    block: true,
    side: 1,
  }).range(line.to));
}

export function addMultiLineMathDecorations(
  state: EditorState,
  block: MathBlockPreview,
  decorations: Range<Decoration>[],
): void {
  for (let lineNumber = block.startLine; lineNumber <= block.endLine; lineNumber++) {
    const line = state.doc.line(lineNumber);
    hideSourceLine(line.from, line.to, decorations);
  }

  const closingLine = state.doc.line(block.endLine);
  decorations.push(Decoration.widget({
    widget: new MathBlockWidget(block.content, block.from, block.to),
    block: true,
    side: 1,
  }).range(closingLine.to));
}

function hideSourceLine(
  from: number,
  to: number,
  decorations: Range<Decoration>[],
): void {
  decorations.push(Decoration.replace({
    widget: new HiddenSourceWidget(),
  }).range(from, to));
}

export function renderMathInto(container: HTMLElement, expression: string, displayMode: boolean): void {
  const rendered = renderMathJax(expression, displayMode);
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

function renderMathJax(
  expression: string,
  displayMode: boolean,
): { ok: true; html: string } | { ok: false; error: string } {
  try {
    const node = mathJaxDocument.convert(expression, {
      ...mathJaxRenderOptions,
      display: displayMode,
    });
    const html = mathJaxAdaptor.outerHTML(node as HTMLElement);
    const error = mathJaxErrorFromHtml(html);
    if (error) return { ok: false, error };
    return { ok: true, html };
  } catch (error) {
    return { ok: false, error: mathErrorMessage(error) };
  }
}

function mathJaxErrorFromHtml(html: string): string | null {
  const match = html.match(/\sdata-mjx-error="([^"]+)"/);
  if (!match) return null;
  return decodeHtmlEntities(match[1] ?? '').trim() || 'MathJax could not parse this expression.';
}

function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
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
