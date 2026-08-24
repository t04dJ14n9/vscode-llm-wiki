import { type EditorView, WidgetType } from '@codemirror/view';

export interface ImageResourceContext {
  baseUri?: string;
  rootUri?: string;
}

export interface ImageDimensions {
  width: number;
  height?: number;
}

export interface ParsedImageEmbed {
  alt: string;
  dimensions?: ImageDimensions;
  url: string;
}

export interface ParsedMarkdownImageLabel {
  alt: string;
  dimensions?: ImageDimensions;
}

let imageResourceContext: ImageResourceContext = {};
const imageDoubleClickState = new WeakMap<EditorView, {
  pending?: {
    at: number;
    alt: string;
    url: string;
    trigger: HTMLElement;
  };
}>();

const imageDialogStylesId = 'llm-wiki-image-dialog-styles';

const imageDialogStyles = `
/* A modal in a webview cannot paint outside its iframe, so "expand" can only
   ever fill the editor pane. Fill what we do have rather than capping it
   smaller. */
.cm-hybrid-image-dialog {
  box-sizing: border-box;
  width: 96vw;
  height: 96vh;
  margin: auto;
  padding: 42px 16px 16px;
  border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
  border-radius: 6px;
  color: var(--vscode-editor-foreground);
  background-color: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  overflow: hidden;
}
.cm-hybrid-image-dialog::backdrop {
  background-color: var(--vscode-editorWidget-background, rgba(0, 0, 0, 0.72));
  opacity: 0.84;
}
.cm-hybrid-image-dialog-img {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.cm-hybrid-image-dialog-close {
  position: absolute;
  top: 10px;
  right: 12px;
  border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-panel-border));
  border-radius: 3px;
  padding: 3px 8px;
  color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
  background-color: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
  font: inherit;
  cursor: pointer;
}
.cm-hybrid-image-dialog-close:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}
`;

export function setImageResourceContext(context: ImageResourceContext): void {
  imageResourceContext = {
    baseUri: normalizeResourceBaseUri(context.baseUri),
    rootUri: normalizeResourceBaseUri(context.rootUri),
  };
}

export class ImageWidget extends WidgetType {
  constructor(
    private readonly alt: string,
    private readonly url: string,
    private readonly sourceFrom: number,
    private readonly sourceTo: number,
    private readonly dimensions?: ImageDimensions,
  ) {
    super();
  }

  override toDOM(view: EditorView): HTMLElement {
    return renderedImageElement(this.alt, this.url, this.sourceFrom, this.sourceTo, this.dimensions, view);
  }

  override eq(other: ImageWidget): boolean {
    return this.alt === other.alt
      && this.url === other.url
      && this.sourceFrom === other.sourceFrom
      && this.sourceTo === other.sourceTo
      && this.dimensions?.width === other.dimensions?.width
      && this.dimensions?.height === other.dimensions?.height;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

export function renderedImageElement(
  alt: string,
  url: string,
  sourceFrom: number,
  sourceTo: number,
  dimensions: ImageDimensions | undefined,
  view: EditorView,
): HTMLElement {
  ensureImageDoubleClickHandler(view);
  const container = document.createElement('span');
  container.className = 'cm-hybrid-image';
  container.dataset.sourceFrom = String(sourceFrom);
  container.dataset.sourceTo = String(sourceTo);
  container.dataset.resolvedSrc = url;
  const image = document.createElement('img');
  image.className = 'cm-hybrid-image-img';
  image.alt = alt;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.src = url;
  image.dataset.sourceFrom = String(sourceFrom);
  image.dataset.sourceTo = String(sourceTo);
  if (dimensions) {
    image.width = dimensions.width;
    image.style.width = `${dimensions.width}px`;
    // Explicit dimensions should win over the preview's default max-height.
    // Keep max-width so an oversized image still fits the editor pane.
    image.style.maxHeight = 'none';
    if (dimensions.height != null) {
      image.height = dimensions.height;
      image.style.height = `${dimensions.height}px`;
    }
  }
  image.onerror = () => {
    image.remove();
    const fallback = document.createElement('span');
    fallback.className = 'cm-hybrid-image-fallback';
    fallback.textContent = alt || url;
    container.appendChild(fallback);
  };
  container.appendChild(image);
  const expand = document.createElement('button');
  expand.type = 'button';
  expand.className = 'cm-hybrid-image-expand';
  expand.setAttribute('aria-label', 'Expand image');
  expand.title = 'Expand image';
  expand.textContent = 'Expand image';
  expand.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  expand.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openImageDialog(alt, url, expand, view);
  });
  image.addEventListener('error', () => expand.remove(), { once: true });
  container.appendChild(expand);
  container.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
    view.dispatch({ selection: { anchor: sourceFrom } });
    view.focus();
  });
  return container;
}

function ensureImageDoubleClickHandler(view: EditorView): void {
  if (imageDoubleClickState.has(view)) return;
  const state = {} as { pending?: {
    at: number;
    x: number;
    y: number;
    alt: string;
    url: string;
    trigger: HTMLElement;
  } };
  imageDoubleClickState.set(view, state);
  view.dom.addEventListener('mousedown', event => {
    if (!(event instanceof MouseEvent) || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const image = target?.closest<HTMLImageElement>('.cm-hybrid-image-img');
    const now = performance.now();
    const pending = state.pending;
    if (
      pending
      && now - pending.at <= 600
      && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= 8
    ) {
      state.pending = undefined;
      event.preventDefault();
      event.stopPropagation();
      openImageDialog(pending.alt, pending.url, pending.trigger, view);
      return;
    }
    if (!image) return;
    const container = image.closest('.cm-hybrid-image');
    const trigger = container?.querySelector<HTMLElement>('.cm-hybrid-image-expand');
    if (!trigger) return;
    state.pending = {
      at: now,
      x: event.clientX,
      y: event.clientY,
      alt: image.alt,
      url: image.src,
      trigger,
    };
  }, true);
  view.dom.addEventListener('click', event => {
    if (!(event instanceof MouseEvent)) return;
    const target = event.target instanceof Element ? event.target : null;
    const image = target?.closest<HTMLImageElement>('.cm-hybrid-image-img');
    const now = performance.now();
    if (event.detail >= 2) {
      const pending = state.pending;
      state.pending = undefined;
      if (pending && now - pending.at <= 600) {
        openImageDialog(pending.alt, pending.url, pending.trigger, view);
      }
      return;
    }
    if (!image) return;
    const container = image.closest('.cm-hybrid-image');
    const trigger = container?.querySelector<HTMLElement>('.cm-hybrid-image-expand');
    if (!trigger) return;
    state.pending = {
      at: now,
      x: event.clientX,
      y: event.clientY,
      alt: image.alt,
      url: image.src,
      trigger,
    };
  });
}

export function parseObsidianImageEmbed(rawTarget: string): ParsedImageEmbed | null {
  const [rawUrl, rawAlt] = splitUnescaped(rawTarget, '|');
  const url = unescapeWikilinkPart(rawUrl.trim());
  if (!url) return null;

  const dimensions = rawAlt == null ? null : parseImageSizeAlias(rawAlt.trim());
  const alt = rawAlt == null || dimensions
    ? url
    : unescapeWikilinkPart(rawAlt.trim());
  return { alt, dimensions: dimensions ?? undefined, url };
}

export function parseMarkdownImageLabel(label: string, fallbackAlt: string): ParsedMarkdownImageLabel {
  const dimensions = parseImageSizeAlias(label.trim());
  return dimensions
    ? { alt: fallbackAlt, dimensions }
    : { alt: label };
}

export function resolveImageResource(url: string, mode: 'relative' | 'vault'): string {
  const trimmed = url.trim();
  if (!trimmed || isAbsoluteImageResource(trimmed)) return trimmed;

  const baseUri = trimmed.startsWith('/')
    ? imageResourceContext.rootUri
    : mode === 'vault'
      ? imageResourceContext.rootUri ?? imageResourceContext.baseUri
      : imageResourceContext.baseUri ?? imageResourceContext.rootUri;
  if (!baseUri) return trimmed;

  try {
    return new URL(trimmed.replace(/^\/+/, ''), baseUri).href;
  } catch {
    return trimmed;
  }
}

function splitUnescaped(input: string, separator: string): [string, string | undefined] {
  let escaped = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === separator) {
      return [input.slice(0, index), input.slice(index + separator.length)];
    }
  }
  return [input, undefined];
}

function unescapeWikilinkPart(value: string): string {
  return value.replace(/\\([\\|\]])/g, '$1');
}

function parseImageSizeAlias(value: string): ImageDimensions | null {
  const match = value.match(/^(\d+)(?:x(\d+))?$/i);
  if (!match) return null;
  const width = Number.parseInt(match[1]!, 10);
  const height = match[2] == null ? undefined : Number.parseInt(match[2], 10);
  return height == null ? { width } : { width, height };
}

function openImageDialog(alt: string, url: string, trigger: HTMLElement, view: EditorView): void {
  ensureImageDialogStyles();
  const dialog = document.createElement('dialog');
  dialog.className = 'cm-hybrid-image-dialog';
  dialog.setAttribute('aria-label', alt || 'Expanded image');

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'cm-hybrid-image-dialog-close';
  close.textContent = 'Close';
  close.addEventListener('click', () => dialog.close());

  const image = document.createElement('img');
  image.className = 'cm-hybrid-image-dialog-img';
  image.alt = alt;
  image.src = url;
  dialog.append(close, image);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (trigger.isConnected) trigger.focus();
    else view.focus();
  }, { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
  close.focus();
}

function ensureImageDialogStyles(): void {
  if (document.getElementById(imageDialogStylesId)) return;
  const style = document.createElement('style');
  style.id = imageDialogStylesId;
  style.textContent = imageDialogStyles;
  document.head.appendChild(style);
}

function isAbsoluteImageResource(url: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url);
}

function normalizeResourceBaseUri(uri: string | undefined): string | undefined {
  if (typeof uri !== 'string') return undefined;
  const trimmed = uri.trim();
  if (!trimmed) return undefined;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}
