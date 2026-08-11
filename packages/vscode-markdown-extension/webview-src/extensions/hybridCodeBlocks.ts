import { Decoration, type EditorView, WidgetType } from '@codemirror/view';
import type { EditorState, Range } from '@codemirror/state';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash.js';
import 'prismjs/components/prism-css.js';
import 'prismjs/components/prism-go.js';
import 'prismjs/components/prism-javascript.js';
import 'prismjs/components/prism-json.js';
import 'prismjs/components/prism-jsx.js';
import 'prismjs/components/prism-latex.js';
import 'prismjs/components/prism-markdown.js';
import 'prismjs/components/prism-python.js';
import 'prismjs/components/prism-sql.js';
import 'prismjs/components/prism-typescript.js';
import 'prismjs/components/prism-tsx.js';
import 'prismjs/components/prism-yaml.js';
import { dispatchCopyTextEvent, writeTextToClipboard } from '../webviewClipboard';

export interface CodeBlockPreview {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  language?: string;
  content: string;
}

class CodeBlockHeaderWidget extends WidgetType {
  constructor(
    private readonly language: string,
    private readonly code: string,
    private readonly blockFrom: number,
    private readonly blockTo: number,
    private readonly blockIsActive: boolean,
  ) {
    super();
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-hybrid-codeblock';
    wrapper.dataset.sourceFrom = String(this.blockFrom);
    wrapper.dataset.sourceTo = String(this.blockTo);
    const inner = document.createElement('div');
    inner.className = 'cm-hybrid-codeblock-inner';

    const header = document.createElement('div');
    header.className = 'cm-hybrid-codeblock-header';

    const label = document.createElement('div');
    label.className = 'cm-hybrid-codeblock-language';
    label.textContent = this.blockIsActive
      ? formatActiveCodeBlockFence(this.language)
      : formatCodeBlockLanguage(this.language);

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'cm-hybrid-codeblock-copy';
    copyButton.setAttribute('aria-label', 'Copy code');
    copyButton.title = 'Copy code';
    const copyIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    copyIcon.classList.add('cm-hybrid-codeblock-copy-icon');
    copyIcon.setAttribute('viewBox', '0 0 16 16');
    copyIcon.setAttribute('aria-hidden', 'true');
    copyIcon.setAttribute('focusable', 'false');
    const copyBack = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    copyBack.setAttribute('x', '5.5');
    copyBack.setAttribute('y', '1.5');
    copyBack.setAttribute('width', '8');
    copyBack.setAttribute('height', '10');
    copyBack.setAttribute('rx', '1.25');
    const copyFront = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    copyFront.setAttribute('x', '2.5');
    copyFront.setAttribute('y', '4.5');
    copyFront.setAttribute('width', '8');
    copyFront.setAttribute('height', '10');
    copyFront.setAttribute('rx', '1.25');
    copyIcon.append(copyBack, copyFront);
    copyButton.appendChild(copyIcon);
    copyButton.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    copyButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void writeTextToClipboard(this.code, text => dispatchCopyTextEvent(view.dom, text));
    });

    header.append(label, copyButton);
    inner.append(header);
    wrapper.appendChild(inner);

    wrapper.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.focus();
      view.dispatch({ selection: { anchor: this.blockFrom } });
    });

    return wrapper;
  }

  override eq(other: CodeBlockHeaderWidget): boolean {
    return this.language === other.language
      && this.code === other.code
      && this.blockFrom === other.blockFrom
      && this.blockTo === other.blockTo
      && this.blockIsActive === other.blockIsActive;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const codeBlockLanguageLabels: Record<string, string> = {
  bash: 'Bash',
  css: 'CSS',
  html: 'HTML',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  latex: 'LaTeX',
  markdown: 'Markdown',
  md: 'Markdown',
  py: 'Python',
  python: 'Python',
  shell: 'Shell',
  sh: 'Shell',
  sql: 'SQL',
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  yaml: 'YAML',
  yml: 'YAML',
  zsh: 'Zsh',
};

function formatCodeBlockLanguage(language: string): string {
  const normalized = language.trim();
  if (!normalized) return 'Text';
  const label = codeBlockLanguageLabels[normalized.toLowerCase()];
  if (label) return label;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

const codeBlockLanguageNames: Record<string, string> = {
  js: 'javascript',
  md: 'markdown',
  py: 'python',
  sh: 'shell',
  ts: 'typescript',
  yml: 'yaml',
};

function formatActiveCodeBlockFence(language: string): string {
  const normalized = language.trim().toLowerCase();
  return `\`\`\`${codeBlockLanguageNames[normalized] ?? normalized}`;
}

class CodeBlockFooterWidget extends WidgetType {
  constructor(private readonly closingLineFrom: number) {
    super();
  }

  override toDOM(view: EditorView): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'cm-hybrid-codeblock-footer';
    footer.dataset.sourceFrom = String(this.closingLineFrom);
    footer.textContent = '\u200B';
    footer.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      view.focus();
      view.dispatch({ selection: { anchor: this.closingLineFrom } });
    });
    return footer;
  }

  override eq(other: CodeBlockFooterWidget): boolean {
    return this.closingLineFrom === other.closingLineFrom;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const codeBlockContentLineDeco = Decoration.line({
  class: 'cm-hybrid-codeblock-content-line',
});

const activeCodeBlockOpeningLineDeco = Decoration.line({
  class: 'cm-hybrid-codeblock-active-opening-line',
});

const activeCodeBlockClosingLineDeco = Decoration.line({
  class: 'cm-hybrid-codeblock-active-closing-line',
});

const prismLanguageAliases: Record<string, string> = {
  bash: 'bash',
  css: 'css',
  go: 'go',
  golang: 'go',
  html: 'markup',
  javascript: 'javascript',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  latex: 'latex',
  markdown: 'markdown',
  md: 'markdown',
  py: 'python',
  python: 'python',
  shell: 'bash',
  sh: 'bash',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'tsx',
  typescript: 'typescript',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

export function addCodeBlockDecorations(
  state: EditorState,
  block: CodeBlockPreview,
  decorations: Range<Decoration>[],
  activeLines: Set<number> = new Set(),
): void {
  const openingLine = state.doc.line(block.startLine);
  const closingLine = state.doc.line(block.endLine);
  const blockIsActive = [...activeLines].some(lineNumber => (
    lineNumber >= block.startLine && lineNumber <= block.endLine
  ));
  if (activeLines.has(block.startLine)) {
    decorations.push(activeCodeBlockOpeningLineDeco.range(openingLine.from));
  } else {
    decorations.push(Decoration.replace({
      widget: new CodeBlockHeaderWidget(
        block.language ?? '',
        block.content,
        block.from,
        block.to,
        blockIsActive,
      ),
    }).range(openingLine.from, openingLine.to));
  }

  for (let lineNumber = block.startLine + 1; lineNumber < block.endLine; lineNumber++) {
    decorations.push(codeBlockContentLineDeco.range(state.doc.line(lineNumber).from));
  }

  if (activeLines.has(block.endLine)) {
    decorations.push(activeCodeBlockClosingLineDeco.range(closingLine.from));
  } else {
    decorations.push(Decoration.replace({
      widget: new CodeBlockFooterWidget(closingLine.from),
    }).range(closingLine.from, closingLine.to));
  }
}

export function addCodeSyntaxDecorations(
  state: EditorState,
  block: CodeBlockPreview,
  decorations: Range<Decoration>[],
): void {
  const grammar = prismGrammarForLanguage(block.language ?? '');
  if (!grammar) return;

  for (let lineNumber = block.startLine + 1; lineNumber < block.endLine; lineNumber++) {
    const line = state.doc.line(lineNumber);
    addPrismTokenDecorations(line.from, line.text, grammar, decorations);
  }
}

function prismGrammarForLanguage(language: string): Prism.Grammar | null {
  const normalized = prismLanguageAliases[language.trim().toLowerCase()] ?? language.trim().toLowerCase();
  if (!normalized) return null;
  return Prism.languages[normalized] ?? null;
}

function addPrismTokenDecorations(
  lineFrom: number,
  text: string,
  grammar: Prism.Grammar,
  decorations: Range<Decoration>[],
): void {
  let offset = 0;
  for (const token of Prism.tokenize(text, grammar)) {
    const length = prismTokenLength(token);
    addPrismTokenDecoration(lineFrom, offset, token, decorations);
    offset += length;
  }
}

function addPrismTokenDecoration(
  lineFrom: number,
  offset: number,
  token: string | Prism.Token,
  decorations: Range<Decoration>[],
): void {
  if (typeof token === 'string') return;

  const length = prismTokenLength(token);
  if (length > 0) {
    decorations.push(Decoration.mark({
      class: prismTokenClass(token),
    }).range(lineFrom + offset, lineFrom + offset + length));
  }

  let childOffset = offset;
  const children = Array.isArray(token.content) ? token.content : [token.content];
  for (const child of children) {
    addPrismTokenDecoration(lineFrom, childOffset, child, decorations);
    childOffset += prismTokenLength(child);
  }
}

function prismTokenLength(token: string | Prism.Token): number {
  if (typeof token === 'string') return token.length;
  if (Array.isArray(token.content)) {
    return token.content.reduce((length, child) => length + prismTokenLength(child), 0);
  }
  return prismTokenLength(token.content);
}

function prismTokenClass(token: Prism.Token): string {
  const aliases = Array.isArray(token.alias)
    ? token.alias
    : token.alias
      ? [token.alias]
      : [];
  const classes = ['cm-hybrid-prism-token', 'token', token.type, ...aliases]
    .map(prismClassName)
    .filter(Boolean);
  return [...new Set(classes)].join(' ');
}

function prismClassName(className: string): string {
  return className.replace(/[^\w-]/g, '');
}
