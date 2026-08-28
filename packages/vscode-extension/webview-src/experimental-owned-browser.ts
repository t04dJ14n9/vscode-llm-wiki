import DOMPurify from 'dompurify';
import type {
  ExperimentalBrowserHostMessage,
  ExperimentalBrowserRect,
  ExperimentalBrowserSelectionCapture,
  ExperimentalBrowserWebviewMessage,
} from '../src/experimentalOwnedBrowserProtocol';
import {
  boundedExperimentalCaptureExcerpt,
  boundedExperimentalCaptureSize,
  experimentalBrowserSelectionFingerprintInput,
} from '../src/experimentalOwnedBrowserProtocol';

const vscode = acquireVsCodeApi();
const app = requiredElement('app');
const MAX_CONTEXT_CHARS = 1_500;
const MAX_SELECTION_CHARS = 32_000;

let currentToken = '';
let currentUrl = '';
let currentTitle = '';
let currentSelection: ExperimentalBrowserSelectionCapture | undefined;
let selectionCaptureGeneration = 0;

app.innerHTML = `
  <div class="shell">
    <form class="toolbar" id="toolbar">
      <nav class="navigation" aria-label="Browser navigation">
        <button type="button" id="back" class="icon-button" title="Back" aria-label="Back" disabled>←</button>
        <button type="button" id="forward" class="icon-button" title="Forward" aria-label="Forward" disabled>→</button>
        <button type="button" id="reload" class="icon-button" title="Reload" aria-label="Reload" disabled>↻</button>
      </nav>
      <input id="url" aria-label="Public page URL" autocomplete="off" spellcheck="false">
      <button type="submit" class="primary">Go</button>
      <button type="button" id="external" title="Open the live page in VS Code's browser when available">Open live</button>
    </form>
    <div class="selection-actions" aria-label="Selection actions">
      <span class="selection-label">Select a passage to use it as grounded agent context.</span>
      <button type="button" id="copy-link" disabled>Copy source link</button>
      <button type="button" id="copy-agent" disabled>Copy for Agent</button>
      <button type="button" id="send" class="primary" disabled>Add to Agent</button>
    </div>
    <div class="notice">
      <strong>Safe public-page reader.</strong>
      Scripts, sign-in, cookies, forms, hidden controls, media, remote images, and full-page
      persistence are disabled. Some sites will be unsupported.
      <span id="screenshot-note"></span>
    </div>
    <div id="status" role="status" aria-live="polite">Enter a public HTTP(S) page.</div>
    <main id="reader" tabindex="0" aria-label="Sanitized page reader"></main>
  </div>
`;
installStyles();

const toolbar = requiredElement<HTMLFormElement>('toolbar');
const urlInput = requiredElement<HTMLInputElement>('url');
const backButton = requiredElement<HTMLButtonElement>('back');
const forwardButton = requiredElement<HTMLButtonElement>('forward');
const reloadButton = requiredElement<HTMLButtonElement>('reload');
const externalButton = requiredElement<HTMLButtonElement>('external');
const copyLinkButton = requiredElement<HTMLButtonElement>('copy-link');
const copyAgentButton = requiredElement<HTMLButtonElement>('copy-agent');
const sendButton = requiredElement<HTMLButtonElement>('send');
const reader = requiredElement<HTMLElement>('reader');
const status = requiredElement<HTMLElement>('status');
const screenshotNote = requiredElement<HTMLElement>('screenshot-note');

toolbar.addEventListener('submit', event => {
  event.preventDefault();
  post({ type: 'navigate', url: urlInput.value });
});
externalButton.addEventListener('click', () => {
  if (currentUrl) post({ type: 'openExternal', url: currentUrl });
});
backButton.addEventListener('click', () => post({ type: 'navigateHistory', direction: 'back' }));
forwardButton.addEventListener('click', () => post({ type: 'navigateHistory', direction: 'forward' }));
reloadButton.addEventListener('click', () => post({ type: 'navigateHistory', direction: 'reload' }));
copyLinkButton.addEventListener('click', () => {
  if (!currentSelection) return;
  post({
    type: 'copySelectionLink',
    token: currentSelection.token,
    fingerprint: currentSelection.fingerprint,
  });
});
copyAgentButton.addEventListener('click', () => {
  if (!currentSelection) return;
  post({
    type: 'copySelectionForAgent',
    token: currentSelection.token,
    fingerprint: currentSelection.fingerprint,
  });
});
sendButton.addEventListener('click', () => {
  void sendSelectionWithBestEffortCrop();
});
reader.addEventListener('mouseup', deferCaptureSelection);
reader.addEventListener('keyup', deferCaptureSelection);
reader.addEventListener('click', event => {
  const target = event.target;
  const link = target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
  if (!link) return;
  event.preventDefault();
  post({ type: 'navigate', url: link.href });
});
window.addEventListener('keydown', event => {
  if (event.altKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    post({ type: 'navigateHistory', direction: 'back' });
  } else if (event.altKey && event.key === 'ArrowRight') {
    event.preventDefault();
    post({ type: 'navigateHistory', direction: 'forward' });
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    post({ type: 'navigateHistory', direction: 'reload' });
  }
});

window.addEventListener('message', event => {
  const message = event.data as ExperimentalBrowserHostMessage;
  if (!message || typeof message.type !== 'string') return;
  switch (message.type) {
    case 'navigate':
      urlInput.value = message.url;
      post({ type: 'navigate', url: message.url });
      return;
    case 'loading':
      currentToken = message.token;
      currentUrl = message.url;
      currentTitle = '';
      currentSelection = undefined;
      selectionCaptureGeneration += 1;
      urlInput.value = message.url;
      setSelectionActionsEnabled(false);
      reloadButton.disabled = true;
      status.textContent = `Loading ${message.url}…`;
      reader.replaceChildren(emptyState('Loading safe reader copy…'));
      return;
    case 'loaded':
      if (message.token !== currentToken) return;
      currentUrl = message.url;
      currentTitle = message.title;
      urlInput.value = message.url;
      backButton.disabled = !message.canGoBack;
      forwardButton.disabled = !message.canGoForward;
      reloadButton.disabled = false;
      screenshotNote.textContent = message.screenshotAvailable
        ? ' Add to Agent includes a bounded synthetic selection image when capture succeeds.'
        : ` ${message.screenshotReason ?? 'Screenshot capture is unavailable.'}`;
      renderReaderPage(message.html, message.url, message.title);
      return;
    case 'loadError':
      if (message.token !== currentToken) return;
      currentSelection = undefined;
      selectionCaptureGeneration += 1;
      setSelectionActionsEnabled(false);
      reloadButton.disabled = false;
      status.textContent = `Unsupported page: ${message.message}`;
      reader.replaceChildren(emptyState(
        'This page could not be rendered by the safe reader.',
        message.message,
      ));
      return;
    case 'sendResult':
      status.textContent = message.message;
      return;
    case 'selectionActionResult':
      status.textContent = message.message;
  }
});

post({ type: 'ready' });

function renderReaderPage(html: string, baseUrl: string, fallbackTitle: string): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  removeNeverCaptureContent(parsed);
  const root = readableRoot(parsed);
  const article = document.createElement('article');
  article.className = 'reader-article';
  const title = cleanTitle(parsed.title) || cleanTitle(fallbackTitle) || hostname(baseUrl);
  const heading = document.createElement('h1');
  heading.textContent = title;
  article.appendChild(heading);

  const sanitized = DOMPurify.sanitize(root?.innerHTML ?? '', {
    ALLOWED_TAGS: [
      'a', 'abbr', 'article', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details',
      'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4',
      'h5', 'h6', 'hr', 'i', 'kbd', 'li', 'main', 'mark', 'ol', 'p', 'pre', 'q',
      's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup',
      'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var',
    ],
    ALLOWED_ATTR: ['href', 'title', 'lang', 'dir', 'datetime', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: [
      'script', 'style', 'template', 'iframe', 'object', 'embed', 'form', 'input',
      'textarea', 'select', 'option', 'button', 'label', 'img', 'picture', 'video',
      'audio', 'source', 'track', 'canvas', 'svg', 'math',
    ],
    FORBID_ATTR: ['style', 'src', 'srcset', 'poster', 'target', 'rel', 'hidden'],
  });
  const content = document.createElement('div');
  content.className = 'reader-content';
  content.innerHTML = sanitized;
  normalizeLinks(content, baseUrl);
  removeEmptyNoise(content);
  article.appendChild(content);
  reader.replaceChildren(article);
  reader.scrollTop = 0;
  currentSelection = undefined;
  setSelectionActionsEnabled(false);
  post({ type: 'selectionChanged' });

  const textLength = normalizeWhitespace(content.textContent ?? '').length;
  if (textLength < 80) {
    status.textContent =
      'Limited reader copy. This may be a client-rendered, sign-in-only, or unsupported page.';
    const warning = document.createElement('div');
    warning.className = 'unsupported';
    warning.textContent =
      'The fetched HTML contained little readable public text. Open externally for the full page.';
    article.prepend(warning);
  } else {
    status.textContent = `Safe reader copy loaded from ${hostname(baseUrl)}. Select text to attach context.`;
  }
}

function removeNeverCaptureContent(documentValue: Document): void {
  documentValue.querySelectorAll([
    'script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed',
    'form', 'input', 'textarea', 'select', 'option', 'button', 'label',
    'img', 'picture', 'video', 'audio', 'source', 'track', 'canvas', 'svg',
    'dialog', 'nav', 'aside', 'header', 'footer',
    '[hidden]', '[aria-hidden="true"]', '[inert]',
    '[type="password"]', '[autocomplete*="password"]',
    '[style*="display:none" i]', '[style*="display: none" i]',
    '[style*="visibility:hidden" i]', '[style*="visibility: hidden" i]',
    '[class~="hidden"]',
    '.sr-only', '.visually-hidden', '.screen-reader-text',
  ].join(',')).forEach(element => element.remove());
}

function readableRoot(documentValue: Document): Element | null {
  const candidates = [
    'main article',
    '[role="main"] article',
    'article',
    'main',
    '[role="main"]',
    '.content',
    '.post',
    '.entry-content',
    'body',
  ];
  for (const selector of candidates) {
    const elements = Array.from(documentValue.querySelectorAll(selector));
    const candidate = elements.sort(
      (left, right) => readableScore(right) - readableScore(left),
    )[0];
    if (candidate && readableScore(candidate) >= 40) return candidate;
  }
  return documentValue.body;
}

function readableScore(element: Element): number {
  const text = normalizeWhitespace(element.textContent ?? '');
  const paragraphs = element.querySelectorAll('p,li,pre,blockquote').length;
  return text.length + paragraphs * 40;
}

function normalizeLinks(root: Element, baseUrl: string): void {
  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    try {
      const url = new URL(link.getAttribute('href') ?? '', baseUrl);
      if (
        (url.protocol !== 'http:' && url.protocol !== 'https:')
        || url.username
        || url.password
      ) {
        link.removeAttribute('href');
        continue;
      }
      link.href = url.toString();
      link.removeAttribute('target');
      link.removeAttribute('rel');
    } catch {
      link.removeAttribute('href');
    }
  }
}

function removeEmptyNoise(root: Element): void {
  for (const element of Array.from(root.querySelectorAll('div,section,span,p')).reverse()) {
    if (!element.textContent?.trim() && !element.querySelector('hr,br')) element.remove();
  }
}

function deferCaptureSelection(): void {
  window.setTimeout(() => {
    void captureSelection().catch(error => {
      currentSelection = undefined;
      setSelectionActionsEnabled(false);
      status.textContent = `Could not capture selection: ${errorMessage(error)}`;
      post({ type: 'selectionChanged' });
    });
  }, 0);
}

async function captureSelection(): Promise<void> {
  const generation = ++selectionCaptureGeneration;
  const tokenAtStart = currentToken;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    currentSelection = undefined;
    setSelectionActionsEnabled(false);
    post({ type: 'selectionChanged' });
    return;
  }
  const range = selection.getRangeAt(0);
  if (!reader.contains(range.commonAncestorContainer)) return;
  const exactText = selection.toString();
  if (exactText.length > MAX_SELECTION_CHARS) {
    currentSelection = undefined;
    setSelectionActionsEnabled(false);
    status.textContent =
      `Selection is too large. Select at most ${MAX_SELECTION_CHARS.toLocaleString()} characters.`;
    post({ type: 'selectionChanged' });
    return;
  }
  if (!exactText.trim()) return;

  const article = reader.querySelector('.reader-content');
  if (!article) return;
  const beforeRange = range.cloneRange();
  beforeRange.selectNodeContents(article);
  try {
    beforeRange.setEnd(range.startContainer, range.startOffset);
  } catch {
    return;
  }
  const afterRange = range.cloneRange();
  afterRange.selectNodeContents(article);
  try {
    afterRange.setStart(range.endContainer, range.endOffset);
  } catch {
    return;
  }

  const anchor = commonElement(range)?.closest(
    'p,li,pre,blockquote,h1,h2,h3,h4,h5,h6,td,th',
  ) ?? commonElement(range);
  const candidate: Omit<ExperimentalBrowserSelectionCapture, 'fingerprint'> = {
    token: currentToken,
    url: currentUrl,
    title: currentTitle,
    text: exactText,
    prefix: tail(beforeRange.toString(), MAX_CONTEXT_CHARS),
    suffix: head(afterRange.toString(), MAX_CONTEXT_CHARS),
    ...(anchor ? { cssSelector: cssSelectorFor(anchor), xpath: xpathFor(anchor) } : {}),
    rects: Array.from(range.getClientRects()).slice(0, 64).map(rectToCapture),
  };
  let fingerprint: string;
  try {
    fingerprint = await sha256Hex(experimentalBrowserSelectionFingerprintInput(candidate));
  } catch (error) {
    if (generation !== selectionCaptureGeneration || tokenAtStart !== currentToken) return;
    throw error;
  }
  if (generation !== selectionCaptureGeneration || tokenAtStart !== currentToken) return;
  currentSelection = { ...candidate, fingerprint };
  setSelectionActionsEnabled(true);
  status.textContent = `Selected ${exactText.trim().length.toLocaleString()} characters.`;
  post({ type: 'selectionChanged', selection: currentSelection });
}

async function sendSelectionWithBestEffortCrop(): Promise<void> {
  if (!currentSelection) {
    status.textContent = 'No active sanitized-reader selection was available.';
    return;
  }
  const selectionToSend = currentSelection;
  setSelectionActionsEnabled(false);
  status.textContent = 'Preparing a bounded selection crop…';
  try {
    const selectionPngBase64 = await rasterizeSelectionContext(selectionToSend);
    post({
      type: 'sendSelection',
      token: selectionToSend.token,
      fingerprint: selectionToSend.fingerprint,
      selectionPngBase64,
    });
  } catch (error) {
    post({
      type: 'sendSelection',
      token: selectionToSend.token,
      fingerprint: selectionToSend.fingerprint,
      screenshotReason: `Best-effort selection crop failed: ${errorMessage(error)}`,
    });
  } finally {
    if (
      currentSelection?.fingerprint === selectionToSend.fingerprint
      && currentToken === selectionToSend.token
    ) {
      setSelectionActionsEnabled(true);
    }
  }
}

/**
 * Rasterizes a synthetic crop containing only the selected passage and bounded
 * text context. It never serializes the reader root or remote image/media.
 */
async function rasterizeSelectionContext(
  capture: ExperimentalBrowserSelectionCapture,
): Promise<string> {
  const excerpt = boundedExperimentalCaptureExcerpt(capture);
  const card = buildCaptureCard(excerpt);
  document.body.appendChild(card);
  const measured = card.getBoundingClientRect();
  const size = boundedExperimentalCaptureSize(measured.width, measured.height);
  card.remove();

  const cardHtml = captureCardMarkup(excerpt, size.width);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">
    <foreignObject width="100%" height="100%">
      <div xmlns="http://www.w3.org/1999/xhtml">${cardHtml}</div>
    </foreignObject>
  </svg>`;
  const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = await loadImage(blobUrl);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D is unavailable.');
    context.fillStyle = '#1f1f1f';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const png = await canvasPng(canvas);
    if (png.size === 0 || png.size > 5 * 1024 * 1024) {
      throw new Error('Rasterized crop exceeded the 5 MiB safety limit.');
    }
    const bytes = new Uint8Array(await png.arrayBuffer());
    if (!hasPngSignature(bytes)) throw new Error('Canvas did not return a valid PNG.');
    return bytesToBase64(bytes);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function buildCaptureCard(
  excerpt: { prefix: string; text: string; suffix: string },
): HTMLElement {
  const card = document.createElement('section');
  card.setAttribute('aria-hidden', 'true');
  card.className = 'capture-measure';
  const warning = document.createElement('div');
  warning.textContent = 'UNTRUSTED WEB EXCERPT — reference only';
  warning.className = 'capture-measure-warning';
  const label = document.createElement('div');
  label.textContent = `${currentTitle || hostname(currentUrl)} · ${hostname(currentUrl)}`;
  label.className = 'capture-measure-label';
  const passage = document.createElement('div');
  passage.append(
    document.createTextNode(excerpt.prefix),
    Object.assign(document.createElement('mark'), { textContent: excerpt.text }),
    document.createTextNode(excerpt.suffix),
  );
  const mark = passage.querySelector('mark');
  if (mark) mark.className = 'capture-measure-selection';
  card.append(warning, label, passage);
  return card;
}

function captureCardMarkup(
  excerpt: { prefix: string; text: string; suffix: string },
  width: number,
): string {
  const source = escapeHtml(`${currentTitle || hostname(currentUrl)} · ${hostname(currentUrl)}`);
  return `<section style="box-sizing:border-box;width:${width}px;padding:20px 22px;border:1px solid #454545;border-radius:8px;background:#1f1f1f;color:#cccccc;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:pre-wrap;overflow-wrap:anywhere">
    <div style="margin-bottom:5px;color:#f0a000;font-size:11px;font-weight:700;letter-spacing:.04em">UNTRUSTED WEB EXCERPT — reference only</div>
    <div style="margin-bottom:12px;color:#8c8c8c;font-size:12px">${source}</div>
    <div>${escapeHtml(excerpt.prefix)}<mark style="padding:1px 2px;border-radius:2px;background:#264f78;color:#fff">${escapeHtml(excerpt.text)}</mark>${escapeHtml(excerpt.suffix)}</div>
  </section>`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('SVG crop could not be decoded.')), {
      once: true,
    });
    image.src = url;
  });
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas PNG encoding failed.'));
    }, 'image/png');
  });
}

function hasPngSignature(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return signature.every((value, index) => bytes[index] === value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function commonElement(range: Range): Element | undefined {
  const container = range.commonAncestorContainer;
  return container.nodeType === Node.ELEMENT_NODE
    ? container as Element
    : container.parentElement ?? undefined;
}

function cssSelectorFor(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== reader) {
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children)
        .filter(value => value.tagName === current!.tagName)
      : [];
    const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
    parts.unshift(`${tag}${suffix}`);
    current = current.parentElement;
    if (parts.length >= 12) break;
  }
  return parts.join(' > ');
}

function xpathFor(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== reader) {
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children)
        .filter(value => value.tagName === current!.tagName)
      : [];
    parts.unshift(`${current.tagName.toLowerCase()}[${siblings.indexOf(current) + 1}]`);
    current = current.parentElement;
    if (parts.length >= 12) break;
  }
  return `/${parts.join('/')}`;
}

function rectToCapture(rect: DOMRect): ExperimentalBrowserRect {
  return {
    x: round(rect.left + reader.scrollLeft),
    y: round(rect.top + reader.scrollTop),
    width: round(rect.width),
    height: round(rect.height),
  };
}

function installStyles(): void {
  const style = document.createElement('style');
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="llm-wiki-csp-nonce"]')?.content;
  if (nonce) style.nonce = nonce;
  style.textContent = `
    *{box-sizing:border-box}
    .shell{height:100%;display:grid;grid-template-rows:auto auto auto 28px minmax(0,1fr)}
    .toolbar{display:flex;gap:6px;align-items:center;padding:7px 9px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background)}
    .navigation{display:flex;gap:2px;align-items:center}
    input{min-width:140px;flex:1;height:27px;padding:0 8px;border:1px solid var(--vscode-input-border,transparent);outline:none;border-radius:3px;background:var(--vscode-input-background);color:var(--vscode-input-foreground)}
    input:focus{border-color:var(--vscode-focusBorder)}
    button{height:27px;padding:0 9px;border:1px solid var(--vscode-button-border,transparent);border-radius:3px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer}
    button.primary,#send:not(:disabled){background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
    button:disabled{opacity:.55;cursor:default}
    .icon-button{width:28px;padding:0;font-size:16px}
    .selection-actions{display:flex;gap:6px;align-items:center;padding:6px 9px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editorWidget-background)}
    .selection-label{min-width:160px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground);font-size:12px}
    .notice{padding:7px 12px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-textBlockQuote-background);color:var(--vscode-descriptionForeground);font-size:12px;line-height:1.45}
    .notice strong{color:var(--vscode-editor-foreground)}
    #status{padding:5px 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-bottom:1px solid var(--vscode-panel-border);color:var(--vscode-descriptionForeground);font-size:11px}
    #reader{overflow:auto;padding:0 28px 72px;outline:none;background:var(--vscode-editor-background)}
    .reader-article{max-width:780px;margin:0 auto;padding:28px 0;color:var(--vscode-editor-foreground);font-size:15px;line-height:1.65}
    .reader-article>h1{margin:0 0 24px;font-size:30px;line-height:1.2}
    .reader-content h1,.reader-content h2,.reader-content h3,.reader-content h4{line-height:1.3}
    .reader-content h1{font-size:26px}.reader-content h2{margin-top:34px;font-size:22px}.reader-content h3{margin-top:28px;font-size:18px}
    .reader-content p,.reader-content li,.reader-content blockquote{max-width:740px}
    .reader-content a{color:var(--vscode-textLink-foreground);text-decoration:none}
    .reader-content a:hover{text-decoration:underline}
    .reader-content blockquote{margin:18px 0;padding:1px 14px;border-left:3px solid var(--vscode-textBlockQuote-border);background:var(--vscode-textBlockQuote-background)}
    .reader-content pre{overflow:auto;padding:12px 14px;border-radius:4px;background:var(--vscode-textCodeBlock-background);font:var(--vscode-editor-font-size,13px)/1.55 var(--vscode-editor-font-family,monospace)}
    .reader-content :not(pre)>code{padding:1px 4px;border-radius:3px;background:var(--vscode-textCodeBlock-background);font-family:var(--vscode-editor-font-family,monospace)}
    .reader-content table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}
    .reader-content th,.reader-content td{padding:6px 9px;border:1px solid var(--vscode-panel-border);text-align:left}
    .reader-content ::selection{background:var(--vscode-editor-selectionBackground);color:var(--vscode-editor-selectionForeground,inherit)}
    .unsupported{margin:0 0 22px;padding:10px 12px;border-left:3px solid var(--vscode-editorWarning-foreground);background:var(--vscode-inputValidation-warningBackground);color:var(--vscode-inputValidation-warningForeground)}
    .empty{max-width:620px;margin:54px auto;padding:24px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-editorWidget-background)}
    .empty h1{margin:0 0 8px;font-size:18px}.empty p{color:var(--vscode-descriptionForeground);line-height:1.5}
    .capture-measure{position:fixed;left:-100000px;top:0;width:720px;padding:20px 22px;border:1px solid #454545;border-radius:8px;background:#1f1f1f;color:#ccc;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}
    .capture-measure-warning{margin-bottom:5px;color:#f0a000;font-size:11px;font-weight:700;letter-spacing:.04em}
    .capture-measure-label{margin-bottom:12px;color:#8c8c8c;font-size:12px}
    .capture-measure-selection{padding:1px 2px;border-radius:2px;background:#264f78;color:#fff}
    @media(max-width:760px){.shell{grid-template-rows:auto auto auto 28px minmax(0,1fr)}.toolbar,.selection-actions{flex-wrap:wrap}.selection-label{flex-basis:100%}#reader{padding-inline:16px}.reader-article{padding-top:20px}}
  `;
  document.head.appendChild(style);
}

function setSelectionActionsEnabled(enabled: boolean): void {
  copyLinkButton.disabled = !enabled;
  copyAgentButton.disabled = !enabled;
  sendButton.disabled = !enabled;
}

function emptyState(heading: string, detail = ''): HTMLElement {
  const element = document.createElement('section');
  element.className = 'empty';
  const title = document.createElement('h1');
  title.textContent = heading;
  element.appendChild(title);
  if (detail) {
    const paragraph = document.createElement('p');
    paragraph.textContent = detail;
    element.appendChild(paragraph);
  }
  return element;
}

function post(message: ExperimentalBrowserWebviewMessage): void {
  vscode.postMessage(message);
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function cleanTitle(value: string): string {
  return normalizeWhitespace(value).slice(0, 500);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'web page';
  }
}

function head(value: string, count: number): string {
  return value.slice(0, count);
}

function tail(value: string, count: number): string {
  return value.slice(-count);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
