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

let imageResourceContext: ImageResourceContext = {};

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
  const container = document.createElement('span');
  container.className = 'cm-hybrid-image';
  container.dataset.sourceFrom = String(sourceFrom);
  container.dataset.sourceTo = String(sourceTo);
  container.dataset.resolvedSrc = url;
  const image = document.createElement('img');
  image.className = 'cm-hybrid-image-img';
  image.alt = alt;
  image.src = url;
  image.dataset.sourceFrom = String(sourceFrom);
  image.dataset.sourceTo = String(sourceTo);
  if (dimensions) {
    image.width = dimensions.width;
    image.style.width = `${dimensions.width}px`;
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
  container.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
    view.dispatch({ selection: { anchor: sourceFrom } });
    view.focus();
  });
  return container;
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

function isAbsoluteImageResource(url: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url);
}

function normalizeResourceBaseUri(uri: string | undefined): string | undefined {
  if (typeof uri !== 'string') return undefined;
  const trimmed = uri.trim();
  if (!trimmed) return undefined;
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}
