import * as vscode from 'vscode';
import {
  closeDatabase,
  openDatabase,
  persistWebPageSnapshot,
  runMigrations,
} from '@human-learning/core';

export interface MarkdownInsertTarget {
  insertMarkdown(markdown: string): Promise<boolean>;
}

type WebPersistAction = 'copyLink' | 'insertLink' | 'copyQuoteAndLink' | 'insertQuoteAndLink';

interface PersistWebPageMessage {
  type: 'persistWebPage';
  url?: string;
  title?: string;
  html?: string;
  selectedText?: string;
  textFragment?: string;
  cssSelector?: string;
  xpath?: string;
  action?: WebPersistAction;
}

interface LoadWebPageMessage {
  type: 'loadWebPage';
  url?: string;
}

export class WebBrowserProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly vaultRoot: string,
    private readonly markdownInsertTarget?: MarkdownInsertTarget,
  ) {}

  open(initialUrl = 'https://example.com'): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      void this.panel.webview.postMessage({ type: 'navigate', url: normalizeUrl(initialUrl) });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'human-learning.webBrowser',
      'Human Learning Web',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
      },
    );
    this.panel = panel;
    panel.onDidDispose(() => {
      this.panel = undefined;
    });
    panel.webview.onDidReceiveMessage(async message => {
      if (message?.type === 'loadWebPage') {
        await this.loadWebPage(panel.webview, message as LoadWebPageMessage);
      } else if (message?.type === 'persistWebPage') {
        await this.persistWebPage(panel.webview, message as PersistWebPageMessage);
      }
    });
    panel.webview.html = this.getHtml(panel.webview, normalizeUrl(initialUrl));
  }

  private async loadWebPage(webview: vscode.Webview, message: LoadWebPageMessage): Promise<void> {
    const url = normalizeUrl(message.url ?? '');
    if (!isHttpUrl(url)) {
      await webview.postMessage({
        type: 'loadWebPageError',
        url,
        message: 'Human Learning web browsing requires an HTTP(S) URL.',
      });
      return;
    }

    try {
      const html = await fetchHtml(url);
      const title = normalizedTitle(undefined, titleFromHtml(html), url);
      await webview.postMessage({
        type: 'loadedWebPage',
        url,
        title,
        html,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await webview.postMessage({ type: 'loadWebPageError', url, message: messageText });
    }
  }

  private async persistWebPage(webview: vscode.Webview, message: PersistWebPageMessage): Promise<void> {
    const url = normalizeUrl(message.url ?? '');
    if (!isHttpUrl(url)) {
      vscode.window.showErrorMessage('Human Learning web persistence requires an HTTP(S) URL.');
      return;
    }

    try {
      const html = typeof message.html === 'string' ? message.html : await fetchHtml(url);
      const title = normalizedTitle(message.title, titleFromHtml(html), url);
      const db = await openDatabase(this.vaultRoot);
      let result: ReturnType<typeof persistWebPageSnapshot>;
      try {
        runMigrations(db);
        result = persistWebPageSnapshot(db, this.vaultRoot, {
          url,
          title,
          html,
          selectedText: message.selectedText,
          textFragment: message.textFragment,
          cssSelector: message.cssSelector,
          xpath: message.xpath,
        });
      } finally {
        closeDatabase(db);
      }

      const action = message.action ?? 'copyLink';
      const markdown = action === 'copyQuoteAndLink' || action === 'insertQuoteAndLink'
        ? result.quoteMarkdown
        : result.markdownLink;

      if (action === 'insertLink' || action === 'insertQuoteAndLink') {
        if (!(await this.markdownInsertTarget?.insertMarkdown(markdown))) {
          await vscode.env.clipboard.writeText(markdown);
          vscode.window.showWarningMessage('No markdown editor is visible. Web link copied to clipboard.');
        } else {
          vscode.window.showInformationMessage('Human Learning web link inserted');
        }
      } else {
        await vscode.env.clipboard.writeText(markdown);
        vscode.window.showInformationMessage('Human Learning web link copied');
      }

      await webview.postMessage({
        type: 'persistedWebPage',
        href: result.href,
        markdown: result.markdownLink,
        persistedPath: result.persistedPath,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to persist web page: ${messageText}`);
      await webview.postMessage({ type: 'persistWebPageError', message: messageText });
    }
  }

  private getHtml(webview: vscode.Webview, initialUrl: string): string {
    const nonce = String(Date.now());
    const initialJson = JSON.stringify(initialUrl);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' http: https:; img-src ${webview.cspSource} http: https: data:; font-src http: https: data:; connect-src http: https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Human Learning Web</title>
  <style>
    html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); }
    #toolbar { height: 38px; display: grid; grid-template-columns: minmax(220px, 1fr) auto auto auto auto auto; gap: 6px; align-items: center; padding: 0 8px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); box-sizing: border-box; }
    #url { min-width: 0; height: 26px; padding: 0 8px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
    button { height: 26px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; padding: 0 9px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; white-space: nowrap; }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button.active { outline: 1px solid var(--vscode-focusBorder); background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    #status { position: absolute; right: 10px; bottom: 8px; max-width: min(680px, calc(100% - 20px)); padding: 5px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-editorWidget-background); color: var(--vscode-descriptionForeground); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #content { height: calc(100% - 38px); min-height: 0; }
    #web { height: 100%; overflow: auto; background: #ffffff; color: #213547; box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    #page { height: 100%; overflow: auto; background: var(--vscode-editor-background); box-sizing: border-box; }
    [hidden] { display: none !important; }
    .web-shell { min-height: 100%; background: #ffffff; color: #213547; }
    .web-topbar { position: sticky; top: 0; z-index: 2; height: 52px; display: flex; align-items: center; gap: 18px; padding: 0 28px; border-bottom: 1px solid #e2e2e3; background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(10px); }
    .web-brand { display: flex; align-items: center; gap: 9px; min-width: 160px; font-size: 16px; font-weight: 600; color: #213547; }
    .web-brand-mark { width: 24px; height: 24px; border-radius: 6px; background: linear-gradient(135deg, #42b883 0%, #42b883 55%, #35495e 55%, #35495e 100%); }
    .web-host { min-width: 0; color: #476582; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .web-layout { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 820px); gap: 36px; max-width: 1180px; margin: 0 auto; padding: 28px 34px 80px; }
    .web-sidebar { position: sticky; top: 78px; align-self: start; max-height: calc(100vh - 130px); overflow: auto; padding-right: 14px; border-right: 1px solid #e2e2e3; color: #476582; font-size: 13px; }
    .web-sidebar h2, .web-sidebar .title, .web-sidebar .title-text { margin: 18px 0 8px; color: #213547; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
    .web-sidebar a { display: block; padding: 4px 0; color: #476582; text-decoration: none; }
    .web-sidebar a:hover { color: #42b883; }
    .web-article { min-width: 0; padding-bottom: 60px; font-size: 16px; line-height: 1.7; }
    .web-article h1 { margin: 6px 0 24px; font-size: 42px; line-height: 1.15; letter-spacing: 0; color: #213547; }
    .web-article h2 { margin: 44px 0 18px; padding-top: 22px; border-top: 1px solid #e2e2e3; font-size: 27px; line-height: 1.3; letter-spacing: 0; color: #213547; }
    .web-article h3 { margin: 30px 0 12px; font-size: 21px; line-height: 1.35; color: #213547; }
    .web-article p, .web-article li, .web-article blockquote { max-width: 760px; }
    .web-article p { margin: 16px 0; }
    .web-article a { color: #42b883; text-decoration: none; font-weight: 500; }
    .web-article a:hover { text-decoration: underline; }
    .web-article blockquote { margin: 24px 0; padding: 1px 18px; border-left: 4px solid #42b883; background: #f6f6f7; color: #476582; }
    .web-article pre { max-width: 820px; overflow: auto; padding: 16px; border-radius: 8px; background: #24292e; color: #e1e4e8; }
    .web-article code { padding: 2px 5px; border-radius: 4px; background: #f6f6f7; color: #476582; }
    .web-article pre code { padding: 0; background: transparent; color: inherit; }
    .web-article img { max-width: 100%; height: auto; }
    .web-article .header-anchor, .web-article .copy, .web-article .lang, .web-article .options-api { display: none !important; }
    .web-article .hl-web-selected, .web-sidebar .hl-web-selected { outline: 2px solid #42b883; background: rgba(66, 184, 131, 0.16); }
    .web-empty { padding: 32px; color: #476582; }
    @media (max-width: 860px) {
      .web-layout { grid-template-columns: 1fr; padding: 24px 22px 70px; }
      .web-sidebar { position: static; max-height: none; border-right: 0; border-bottom: 1px solid #e2e2e3; padding: 0 0 18px; }
      .web-article h1 { font-size: 34px; }
      .web-article h2 { font-size: 24px; }
    }
    .snapshot { max-width: 920px; margin: 0 auto; padding: 30px 36px 70px; color: var(--vscode-editor-foreground); line-height: 1.65; font-size: 15px; }
    .snapshot h1 { font-size: 34px; line-height: 1.2; margin: 24px 0; }
    .snapshot h2 { font-size: 24px; margin: 32px 0 12px; padding-top: 8px; border-top: 1px solid var(--vscode-panel-border); }
    .snapshot h3 { font-size: 19px; margin: 26px 0 10px; }
    .snapshot p, .snapshot li, .snapshot blockquote { max-width: 780px; }
    .snapshot a { color: var(--vscode-textLink-foreground); }
    .snapshot pre { max-width: 820px; overflow: auto; padding: 14px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); }
    .snapshot code { padding: 1px 4px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); }
    .snapshot img { max-width: 100%; height: auto; }
    .snapshot header, .snapshot nav, .snapshot aside, .snapshot [role="navigation"], .snapshot .VPNav, .snapshot .VPSidebar, .snapshot .VPDocAside, .snapshot .VPContentDocOutline, .snapshot .VPSkipLink, .snapshot .header-anchor, .snapshot [hidden], .snapshot [aria-hidden="true"], .snapshot .visually-hidden { display: none !important; }
    .snapshot .hl-web-selected { outline: 2px solid var(--vscode-focusBorder); background: color-mix(in srgb, var(--vscode-editor-selectionBackground) 45%, transparent); }
    .empty { padding: 32px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <form id="toolbar">
    <input id="url" aria-label="URL" spellcheck="false">
    <button id="go" type="submit">Go</button>
    <button id="modeLive" class="active" type="button">Web</button>
    <button id="modeReader" type="button">Reader</button>
    <button id="persist" class="primary" type="button" title="Persist this page and copy a markdown link">Persist Page</button>
    <button id="insert" type="button" title="Persist this page and insert a markdown link">Insert Link</button>
  </form>
  <section id="content">
    <main id="web" aria-label="Rendered web page"><div class="web-empty">Loading...</div></main>
    <main id="page" hidden><div class="empty">Loading...</div></main>
  </section>
  <div id="status">Loading...</div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const urlInput = document.getElementById('url');
    const web = document.getElementById('web');
    const page = document.getElementById('page');
    const status = document.getElementById('status');
    const modeLive = document.getElementById('modeLive');
    const modeReader = document.getElementById('modeReader');
    let currentUrl = ${initialJson};
    let currentHtml = '';
    let currentTitle = '';
    let viewMode = 'web';
    let selectedElement = null;
    let selectedText = '';
    let selectedCssSelector = '';
    let selectedXpath = '';
    let selectedTextFragment = '';

    function normalizeUrl(value) {
      const raw = String(value || '').trim();
      if (!raw) return 'https://example.com';
      if (/^https?:\\/\\//i.test(raw)) return raw;
      return 'https://' + raw;
    }

    function load(value) {
      currentUrl = normalizeUrl(value);
      urlInput.value = currentUrl;
      currentHtml = '';
      currentTitle = '';
      clearSelection();
      setWebMessage('Loading page', 'Fetching ' + currentUrl + ' through the extension host...');
      page.innerHTML = '<div class="empty">Loading ' + escapeHtml(currentUrl) + '...</div>';
      setMode('web');
      status.textContent = 'Loading ' + currentUrl;
      vscode.postMessage({ type: 'loadWebPage', url: currentUrl });
    }

    document.getElementById('toolbar').addEventListener('submit', event => {
      event.preventDefault();
      load(urlInput.value);
    });
    modeLive.addEventListener('click', () => setMode('web'));
    modeReader.addEventListener('click', () => setMode('reader'));
    document.getElementById('persist').addEventListener('click', () => persist('copyLink'));
    document.getElementById('insert').addEventListener('click', () => persist('insertLink'));
    web.addEventListener('mouseup', () => setTimeout(captureSelection, 0));
    web.addEventListener('click', handleReadableClick);
    page.addEventListener('mouseup', () => setTimeout(captureSelection, 0));
    page.addEventListener('click', handleReadableClick);

    function handleReadableClick(event) {
      const link = event.target.closest('a[href]');
      if (link) {
        const href = link.getAttribute('href');
        if (href) {
          event.preventDefault();
          load(new URL(href, currentUrl).toString());
        }
        return;
      }

      const block = event.target.closest('p, li, blockquote, pre, h1, h2, h3, h4, h5, h6');
      const activeSelection = String(window.getSelection()?.toString() || '').trim();
      if (block && !activeSelection) {
        selectElement(block);
      }
    }

    function persist(action) {
      status.textContent = 'Persisting ' + currentUrl + '...';
      vscode.postMessage({
        type: 'persistWebPage',
        url: currentUrl,
        title: currentTitle,
        html: currentHtml,
        selectedText: selectedText || undefined,
        textFragment: selectedTextFragment || undefined,
        cssSelector: selectedCssSelector || undefined,
        xpath: selectedXpath || undefined,
        action,
      });
    }

    function setMode(nextMode) {
      viewMode = nextMode === 'reader' ? 'reader' : 'web';
      web.hidden = viewMode !== 'web';
      page.hidden = viewMode !== 'reader';
      modeLive.classList.toggle('active', viewMode === 'web');
      modeReader.classList.toggle('active', viewMode === 'reader');
      if (viewMode === 'reader' && !currentHtml) {
        status.textContent = 'Fetching reader copy for ' + currentUrl;
      }
    }

    function renderSnapshot(html, url, title) {
      currentHtml = html;
      currentTitle = title || titleFromHtml(html) || hostTitle(url);
      renderWebPage(html, url, currentTitle);

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const sourceRoot = readableRootFor(doc);
      const snapshot = document.createElement('article');
      snapshot.className = 'snapshot';
      snapshot.innerHTML = sourceRoot ? sourceRoot.innerHTML : '<p>No readable page body was found.</p>';
      sanitizeSnapshot(snapshot, url);
      page.replaceChildren(snapshot);
      clearSelection();
      page.scrollTop = 0;
      status.textContent = viewMode === 'reader'
        ? 'Reader copy loaded for ' + currentUrl
        : 'Rendered web page loaded. Reader copy is ready for paragraph links.';
    }

    function renderWebPage(html, url, title) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const shell = document.createElement('div');
      shell.className = 'web-shell';

      const header = document.createElement('header');
      header.className = 'web-topbar';
      header.innerHTML = '<div class="web-brand"><span class="web-brand-mark"></span><span>' + escapeHtml(siteTitleFor(doc, url)) + '</span></div><div class="web-host">' + escapeHtml(title || hostTitle(url)) + ' - ' + escapeHtml(url) + '</div>';

      const layout = document.createElement('div');
      layout.className = 'web-layout';

      const sidebarSource = doc.querySelector('.VPSidebar, aside, nav[aria-labelledby*="sidebar"], .VPContentDocOutline');
      if (sidebarSource && meaningfulText(sidebarSource)) {
        const sidebar = document.createElement('aside');
        sidebar.className = 'web-sidebar';
        sidebar.innerHTML = sidebarSource.innerHTML;
        sanitizeWebPage(sidebar, url);
        layout.appendChild(sidebar);
      }

      const sourceRoot = readableRootFor(doc);
      const article = document.createElement('article');
      article.className = 'web-article';
      article.innerHTML = sourceRoot ? sourceRoot.innerHTML : '<p>No readable page body was found.</p>';
      sanitizeWebPage(article, url);
      layout.appendChild(article);

      shell.append(header, layout);
      web.replaceChildren(shell);
      web.scrollTop = 0;
    }

    function setWebMessage(heading, message) {
      web.innerHTML = '<div class="web-empty"><h1>' + escapeHtml(heading) + '</h1><p>' + escapeHtml(message) + '</p></div>';
    }

    function siteTitleFor(doc, url) {
      return normalizeWhitespace(doc.querySelector('.VPNavBarTitle .text, header .text, [aria-label="Home"]')?.textContent || '') || hostTitle(url);
    }

    function sanitizeWebPage(root, baseUrl) {
      root.querySelectorAll('script, iframe, object, embed, style, noscript, canvas, form, button.copy, [hidden], [aria-hidden="true"], .visually-hidden, .VPSkipLink').forEach(element => element.remove());
      for (const element of root.querySelectorAll('*')) {
        for (const attribute of Array.from(element.attributes)) {
          const name = attribute.name.toLowerCase();
          const value = attribute.value.trim();
          if (name.startsWith('on') || name === 'srcdoc' || name === 'style') {
            element.removeAttribute(attribute.name);
          } else if ((name === 'href' || name === 'src') && value) {
            if (/^javascript:/i.test(value)) {
              element.removeAttribute(attribute.name);
            } else {
              try {
                element.setAttribute(attribute.name, new URL(value, baseUrl).toString());
              } catch {
                element.removeAttribute(attribute.name);
              }
            }
          }
        }
      }
    }

    function readableRootFor(doc) {
      const selectors = [
        'main .vt-doc',
        'main .vp-doc',
        '.VPContentDoc .content main',
        '.VPContentDoc main',
        '[class*="ContentDoc"] main',
        '[role="main"] article',
        '[role="main"] .vt-doc',
        '[role="main"] .vp-doc',
        'article',
        '[role="main"]',
        'main',
        'body',
      ];
      for (const selector of selectors) {
        const candidate = doc.querySelector(selector);
        if (candidate && meaningfulText(candidate)) return candidate;
      }
      return doc.body;
    }

    function meaningfulText(element) {
      return normalizeWhitespace(element.textContent || '').length >= 40
        || Boolean(element.querySelector('h1, h2, p, pre, article'));
    }

    function sanitizeSnapshot(root, baseUrl) {
      root.querySelectorAll('script, iframe, object, embed, style, noscript, canvas, header, nav, aside, [role="navigation"], [hidden], [aria-hidden="true"], .visually-hidden, .VPSkipLink').forEach(element => element.remove());
      for (const element of root.querySelectorAll('*')) {
        for (const attribute of Array.from(element.attributes)) {
          const name = attribute.name.toLowerCase();
          const value = attribute.value.trim();
          if (name.startsWith('on') || name === 'srcdoc') {
            element.removeAttribute(attribute.name);
          } else if ((name === 'href' || name === 'src') && value) {
            if (/^javascript:/i.test(value)) {
              element.removeAttribute(attribute.name);
            } else {
              try {
                element.setAttribute(attribute.name, new URL(value, baseUrl).toString());
              } catch {
                element.removeAttribute(attribute.name);
              }
            }
          }
        }
        if (element instanceof HTMLAnchorElement) {
          element.target = '_blank';
          element.rel = 'noreferrer noopener';
        }
      }
    }

    function captureSelection() {
      const selection = window.getSelection();
      const text = normalizeWhitespace(selection?.toString() || '');
      if (!text) return;
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      const container = range?.commonAncestorContainer;
      const element = container?.nodeType === Node.ELEMENT_NODE
        ? container
        : container?.parentElement;
      selectElement(element?.closest('p, li, blockquote, pre, h1, h2, h3, h4, h5, h6') || element, text);
    }

    function selectElement(element, explicitText) {
      if (!(element instanceof HTMLElement)) return;
      clearSelection();
      selectedElement = element;
      selectedElement.classList.add('hl-web-selected');
      selectedText = normalizeWhitespace(explicitText || element.innerText || element.textContent || '');
      selectedCssSelector = cssSelectorFor(element);
      selectedXpath = xpathFor(element);
      selectedTextFragment = selectedText ? textFragmentFor(currentUrl, selectedText) : '';
      status.textContent = selectedText
        ? 'Selected: ' + truncate(selectedText, 140)
        : 'Selected element ' + selectedCssSelector;
    }

    function clearSelection() {
      if (selectedElement) selectedElement.classList.remove('hl-web-selected');
      selectedElement = null;
      selectedText = '';
      selectedCssSelector = '';
      selectedXpath = '';
      selectedTextFragment = '';
    }

    function cssSelectorFor(element) {
      const parts = [];
      let node = element;
      while (node && node instanceof HTMLElement && node.id !== 'page' && node.id !== 'web') {
        if (node.id) {
          parts.unshift('#' + cssEscape(node.id));
          break;
        }
        const tag = node.tagName.toLowerCase();
        let index = 1;
        let sibling = node;
        while ((sibling = sibling.previousElementSibling)) {
          if (sibling.tagName.toLowerCase() === tag) index += 1;
        }
        parts.unshift(tag + ':nth-of-type(' + index + ')');
        node = node.parentElement;
      }
      return parts.join(' > ');
    }

    function cssEscape(value) {
      return window.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
    }

    function xpathFor(element) {
      const parts = [];
      let node = element;
      while (node && node instanceof HTMLElement && node.id !== 'page' && node.id !== 'web') {
        const tag = node.tagName.toLowerCase();
        let index = 1;
        let sibling = node;
        while ((sibling = sibling.previousElementSibling)) {
          if (sibling.tagName.toLowerCase() === tag) index += 1;
        }
        parts.unshift(tag + '[' + index + ']');
        node = node.parentElement;
      }
      return '/' + parts.join('/');
    }

    function textFragmentFor(url, text) {
      try {
        const parsed = new URL(url);
        parsed.hash = '';
        return parsed.toString() + '#:~:text=' + encodeURIComponent(normalizeWhitespace(text).slice(0, 300));
      } catch {
        return '';
      }
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (message && message.type === 'navigate') {
        load(message.url);
      } else if (message && message.source === 'human-learning-web-frame' && message.type === 'navigate') {
        load(message.url);
      } else if (message && message.type === 'loadedWebPage') {
        if (normalizeUrl(message.url) === currentUrl) {
          renderSnapshot(String(message.html || ''), currentUrl, String(message.title || ''));
        }
      } else if (message && message.type === 'loadWebPageError') {
        setWebMessage('Could not render page', String(message.message || ''));
        page.innerHTML = '<div class="empty">Could not render this page in VS Code. You can still persist it if the extension host can fetch it.<br>' + escapeHtml(message.message || '') + '</div>';
        status.textContent = 'Load failed: ' + message.message;
      } else if (message && message.type === 'persistedWebPage') {
        status.textContent = 'Persisted ' + message.persistedPath + ' -> ' + message.href;
      } else if (message && message.type === 'persistWebPageError') {
        status.textContent = 'Persist failed: ' + message.message;
      }
    });

    load(currentUrl);

    function titleFromHtml(html) {
      const match = String(html).match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i);
      return match ? normalizeWhitespace(match[1]) : '';
    }

    function hostTitle(url) {
      try {
        return new URL(url).hostname || 'Web Page';
      } catch {
        return 'Web Page';
      }
    }

    function normalizeWhitespace(value) {
      return String(value || '').replace(/\\s+/g, ' ').trim();
    }

    function truncate(value, maxLength) {
      return value.length > maxLength ? value.slice(0, maxLength - 1) + '...' : value;
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  </script>
</body>
</html>`;
  }
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return await response.text();
}

function normalizeUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return 'https://example.com';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function titleFromHtml(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim();
}

function normalizedTitle(messageTitle: string | undefined, htmlTitle: string | undefined, url: string): string {
  const cleanMessageTitle = messageTitle?.replace(/\s+/g, ' ').trim();
  if (cleanMessageTitle) return cleanMessageTitle;
  if (htmlTitle) return htmlTitle;
  try {
    return new URL(url).hostname || 'Web Page';
  } catch {
    return 'Web Page';
  }
}
