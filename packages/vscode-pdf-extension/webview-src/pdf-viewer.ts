/// <reference path="./vscode.d.ts" />

import { createPdfiumEngine } from '@embedpdf/engines/pdfium-direct-engine';
import { createPdfPageLayout, formatCssPx, type PdfPageLayout } from './pdfLayout';

const vscode = acquireVsCodeApi();

interface PdfAnchor {
  id?: string;
  page: number;
  textItemIndex?: number;
  charOffset?: number;
  endTextItemIndex?: number;
  endCharOffset?: number;
  length?: number;
  snippet?: string;
}

interface HighlightSpec {
  anchor: PdfAnchor;
  kind: 'referenced' | 'annotated';
}

interface ReferenceListItem {
  source: string;
  sourceLine: number;
  snippet?: string;
  contextLine?: string;
}

interface PdfSearchMatch {
  page: number;
  textItemIndex: number;
  from: number;
  to: number;
}

interface PageState {
  pageNum: number;
  pageObj: any;
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  highlightLayer: HTMLDivElement;
  textRects: any[];
  rendered: boolean;
}

let engine: any;
let pdfDoc: any;

class PdfViewer {
  private readonly container = document.getElementById('viewer-container')!;
  private readonly pageContainer = document.getElementById('page-container')!;
  private readonly pageInfo = document.getElementById('page-info')!;
  private readonly searchPanel = document.getElementById('pdf-search') as HTMLDivElement;
  private readonly searchInput = document.getElementById('pdf-search-input') as HTMLInputElement;
  private readonly searchCount = document.getElementById('pdf-search-count')!;
  private readonly pages = new Map<number, PageState>();
  private scale = 1.35;
  private currentPage = 1;
  private continuousScroll = true;
  private twoPageView = false;
  private intersectionObserver: IntersectionObserver | null = null;
  private pendingAnchor: PdfAnchor | null = null;
  private highlights: HighlightSpec[] = [];
  private pendingPopoverAnchor: PdfAnchor | null = null;
  private pendingPopoverElement: HTMLElement | null = null;
  private popoverCleanup: (() => void) | null = null;
  private loading = false;
  private loaded = false;
  private searchQuery = '';
  private searchMatches: PdfSearchMatch[] = [];
  private selectedSearchIndex = -1;
  private searchRunId = 0;

  constructor() {
    this.setupMessages();
    this.setupToolbar();
    this.setupSearch();
    this.pageContainer.addEventListener('mouseup', () => {
      setTimeout(() => this.handleSelection(), 40);
    });
    vscode.postMessage({ type: 'ready' });
  }

  private setupMessages(): void {
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message?.type) {
        case 'loadPdf':
          void this.loadPdf(message.data);
          break;
        case 'goToAnchor':
          void this.goToAnchor(message.anchor);
          break;
        case 'navigate':
          void this.navigate(message.direction === 'prev' ? -1 : 1);
          break;
        case 'zoom':
          this.zoom(Number(message.delta ?? 0));
          break;
        case 'fitWidth':
          this.fitWidth();
          break;
        case 'toggleContinuousScroll':
          void this.toggleContinuousScroll();
          break;
        case 'toggleTwoPageView':
          void this.toggleTwoPageView();
          break;
        case 'setHighlights':
          this.highlights = [
            ...(message.referenced ?? []).map((item: any) => ({ anchor: item.anchor, kind: 'referenced' as const })),
            ...(message.annotated ?? []).map((item: any) => ({ anchor: item.anchor, kind: 'annotated' as const })),
          ];
          this.redrawAllHighlights();
          break;
        case 'referencesForAnchor':
          this.showReferencePopover(message.anchor, message.items ?? []);
          break;
      }
    });
  }

  private setupToolbar(): void {
    document.getElementById('prev')?.addEventListener('click', () => void this.navigate(-1));
    document.getElementById('next')?.addEventListener('click', () => void this.navigate(1));
    document.getElementById('zoom-in')?.addEventListener('click', () => this.zoom(0.15));
    document.getElementById('zoom-out')?.addEventListener('click', () => this.zoom(-0.15));
    document.getElementById('fit')?.addEventListener('click', () => this.fitWidth());
    document.getElementById('search-open')?.addEventListener('click', () => this.openSearch());
    document.getElementById('toggle-continuous')?.addEventListener('click', () => void this.toggleContinuousScroll());
    document.getElementById('toggle-spread')?.addEventListener('click', () => void this.toggleTwoPageView());
    this.updateToolbarState();
  }

  private setupSearch(): void {
    this.searchInput.addEventListener('input', () => {
      void this.updateSearch(this.searchInput.value);
    });
    this.searchInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.stepSearch(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.closeSearch();
      }
    });
    document.getElementById('pdf-search-prev')?.addEventListener('click', () => void this.stepSearch(-1));
    document.getElementById('pdf-search-next')?.addEventListener('click', () => void this.stepSearch(1));
    document.getElementById('pdf-search-close')?.addEventListener('click', () => this.closeSearch());
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        this.openSearch();
      } else if (event.key === 'Escape' && !this.searchPanel.classList.contains('hidden')) {
        this.closeSearch();
      }
    });
  }

  private openSearch(): void {
    this.searchPanel.classList.remove('hidden');
    requestAnimationFrame(() => {
      this.searchInput.focus();
      this.searchInput.select();
    });
    if (this.searchInput.value.trim()) {
      void this.updateSearch(this.searchInput.value);
    }
  }

  private closeSearch(): void {
    this.searchPanel.classList.add('hidden');
    this.searchMatches = [];
    this.selectedSearchIndex = -1;
    this.searchRunId++;
    this.updateSearchCount();
    this.redrawAllSearchHighlights();
  }

  private async updateSearch(rawQuery: string): Promise<void> {
    const runId = ++this.searchRunId;
    const query = rawQuery.trim();
    this.searchQuery = query;
    if (!query) {
      this.searchMatches = [];
      this.selectedSearchIndex = -1;
      this.updateSearchCount();
      this.redrawAllSearchHighlights();
      return;
    }

    await this.renderAllPagesForSearch();
    if (runId !== this.searchRunId) return;

    this.searchMatches = this.collectSearchMatches(query);
    this.selectedSearchIndex = this.searchMatches.length > 0 ? 0 : -1;
    this.redrawAllSearchHighlights();
    if (this.selectedSearchIndex >= 0) {
      await this.revealSearchMatch(this.selectedSearchIndex);
    } else {
      this.updateSearchCount();
    }
  }

  private async stepSearch(direction: -1 | 1): Promise<void> {
    if (!this.searchMatches.length && this.searchInput.value.trim()) {
      await this.updateSearch(this.searchInput.value);
      return;
    }
    if (!this.searchMatches.length) return;
    const next = (this.selectedSearchIndex + direction + this.searchMatches.length) % this.searchMatches.length;
    await this.revealSearchMatch(next);
  }

  private async renderAllPagesForSearch(): Promise<void> {
    for (const pageNum of this.pages.keys()) {
      await this.renderPage(pageNum);
    }
  }

  private collectSearchMatches(query: string): PdfSearchMatch[] {
    const needle = query.toLocaleLowerCase();
    const matches: PdfSearchMatch[] = [];
    for (const page of this.pages.values()) {
      for (let itemIndex = 0; itemIndex < page.textRects.length; itemIndex++) {
        const content = String(page.textRects[itemIndex]?.content ?? '');
        const haystack = content.toLocaleLowerCase();
        let from = haystack.indexOf(needle);
        while (from >= 0) {
          matches.push({
            page: page.pageNum,
            textItemIndex: itemIndex,
            from,
            to: from + query.length,
          });
          from = haystack.indexOf(needle, from + Math.max(1, needle.length));
        }
      }
    }
    return matches;
  }

  private async revealSearchMatch(index: number): Promise<void> {
    const match = this.searchMatches[index];
    if (!match) return;
    this.selectedSearchIndex = index;
    this.currentPage = match.page;
    this.applyViewMode();
    await this.renderPage(match.page);
    this.redrawAllSearchHighlights();
    this.updatePageInfo();
    this.updateSearchCount();
    const element = this.pageContainer.querySelector<HTMLElement>(`[data-search-index="${index}"]`);
    element?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
  }

  private updateSearchCount(): void {
    if (!this.searchQuery) {
      this.searchCount.textContent = '';
    } else if (!this.searchMatches.length) {
      this.searchCount.textContent = 'No results';
    } else {
      this.searchCount.textContent = `${this.selectedSearchIndex + 1} / ${this.searchMatches.length}`;
    }
  }

  private async loadPdf(base64Data: string): Promise<void> {
    if (this.loading || this.loaded) return;
    this.loading = true;
    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      pdfDoc = await engine
        .openDocumentBuffer({ id: `doc-${Date.now()}`, content: bytes.buffer })
        .toPromise();

      await this.layoutPages();
      await this.renderVisiblePages();
      this.updatePageInfo();
      this.loaded = true;

      if (this.pendingAnchor) {
        const anchor = this.pendingAnchor;
        this.pendingAnchor = null;
        await this.goToAnchor(anchor);
      }
    } catch (error: any) {
      this.pageContainer.innerHTML = `<div class="error">Failed to load PDF: ${escapeHtml(String(error?.message ?? error))}</div>`;
      vscode.postMessage({ type: 'error', message: String(error?.message ?? error) });
    } finally {
      this.loading = false;
    }
  }

  private async layoutPages(): Promise<void> {
    this.pageContainer.innerHTML = '';
    this.pages.clear();
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    const pageCount = pdfDoc?.pageCount ?? 0;

    for (let index = 0; index < pageCount; index++) {
      const pageObj = pdfDoc.pages[index];
      const pageNum = index + 1;
      const wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper';
      wrapper.id = `page-${pageNum}`;

      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-canvas';
      const textLayer = document.createElement('div');
      textLayer.className = 'text-layer';
      textLayer.dataset.page = String(pageNum);
      const highlightLayer = document.createElement('div');
      highlightLayer.className = 'highlight-layer';

      wrapper.append(canvas, textLayer, highlightLayer);
      this.pageContainer.appendChild(wrapper);
      this.pages.set(pageNum, {
        pageNum,
        pageObj,
        wrapper,
        canvas,
        textLayer,
        highlightLayer,
        textRects: [],
        rendered: false,
      });
      this.applyPageLayout(this.pages.get(pageNum)!);
    }

    this.applyViewMode();

    this.intersectionObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const page = Number((entry.target as HTMLElement).id.replace('page-', ''));
        void this.renderPage(page);
      }
    }, { root: this.container, rootMargin: '300px' });

    for (const page of this.pages.values()) this.intersectionObserver.observe(page.wrapper);
  }

  private async renderPage(pageNum: number): Promise<void> {
    const state = this.pages.get(pageNum);
    if (!state || state.rendered || !pdfDoc) return;
    state.rendered = true;

    try {
      const dpr = window.devicePixelRatio || 1;
      const layout = this.applyPageLayout(state, dpr);
      const blob: Blob = await engine
        .renderPage(pdfDoc, state.pageObj, { scaleFactor: layout.scale, dpr: layout.dpr, withAnnotations: true })
        .toPromise();
      const url = URL.createObjectURL(blob);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => {
          state.canvas.width = layout.bitmapWidth;
          state.canvas.height = layout.bitmapHeight;
          const context = state.canvas.getContext('2d')!;
          context.clearRect(0, 0, layout.bitmapWidth, layout.bitmapHeight);
          context.drawImage(image, 0, 0, layout.bitmapWidth, layout.bitmapHeight);
          URL.revokeObjectURL(url);
          resolve();
        };
        image.onerror = reject;
        image.src = url;
      });

      const rects: any[] = await engine.getPageTextRects(pdfDoc, state.pageObj).toPromise();
      state.textRects = rects;
      state.textLayer.innerHTML = '';
      rects.forEach((item, itemIndex) => {
        const span = document.createElement('span');
        span.textContent = item.content;
        span.dataset.itemIndex = String(itemIndex);
        span.style.left = formatCssPx(item.rect.origin.x * layout.scale);
        span.style.top = formatCssPx(item.rect.origin.y * layout.scale);
        span.style.width = formatCssPx(item.rect.size.width * layout.scale);
        span.style.height = formatCssPx(item.rect.size.height * layout.scale);
        span.style.lineHeight = formatCssPx(item.rect.size.height * layout.scale);
        span.style.fontSize = formatCssPx(Math.max(1, item.rect.size.height * layout.scale));
        state.textLayer.appendChild(span);
      });
      this.drawHighlightsForPage(pageNum);
      this.drawSearchHighlightsForPage(pageNum);
    } catch (error) {
      console.error(`Failed to render page ${pageNum}`, error);
      state.rendered = false;
    }
  }

  private async handleSelection(): Promise<void> {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const text = selection.toString().replace(/\s+/g, ' ').trim();
    if (!text) return;

    const startSpan = closestTextSpan(range.startContainer);
    const endSpan = closestTextSpan(range.endContainer);
    if (!startSpan || !endSpan) return;

    const startLayer = startSpan.closest<HTMLElement>('.text-layer');
    const endLayer = endSpan.closest<HTMLElement>('.text-layer');
    if (!startLayer || startLayer !== endLayer) return;

    const page = Number(startLayer.dataset.page ?? '1');
    const startIndex = Number(startSpan.dataset.itemIndex ?? '0');
    const endIndex = Number(endSpan.dataset.itemIndex ?? String(startIndex));
    const startOffset = textOffset(range.startContainer, range.startOffset, startSpan);
    const endOffset = textOffset(range.endContainer, range.endOffset, endSpan);
    const anchor: PdfAnchor = {
      page,
      textItemIndex: Math.min(startIndex, endIndex),
      charOffset: startIndex <= endIndex ? startOffset : endOffset,
      endTextItemIndex: Math.max(startIndex, endIndex),
      endCharOffset: startIndex <= endIndex ? endOffset : startOffset,
      length: startIndex === endIndex ? Math.abs(endOffset - startOffset) : 0,
      snippet: text,
    };
    this.showSelectionToolbar(anchor, range.getBoundingClientRect());
  }

  private showSelectionToolbar(anchor: PdfAnchor, rect: DOMRect): void {
    document.getElementById('selection-toolbar')?.remove();
    const toolbar = document.createElement('div');
    toolbar.id = 'selection-toolbar';
    toolbar.className = 'selection-toolbar';
    toolbar.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
    toolbar.style.top = `${Math.max(8, rect.top - 42 + window.scrollY)}px`;

    const addButton = (
      label: string,
      action: 'copyLink' | 'insertLink' | 'copyQuoteAndLink' | 'insertQuoteAndLink' | 'highlight',
      className = '',
    ) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.className = className;
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (action === 'highlight') window.getSelection()?.removeAllRanges();
        vscode.postMessage({ type: 'selectionAction', action, anchor });
        toolbar.remove();
      });
      toolbar.appendChild(button);
      return button;
    };

    addButton('Copy Link', 'copyLink');
    addButton('Insert Link', 'insertLink', 'secondary');

    const menu = document.createElement('div');
    menu.className = 'menu';
    const more = document.createElement('button');
    more.type = 'button';
    more.textContent = 'More';
    more.className = 'secondary';
    more.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      menu.classList.toggle('open');
    });
    toolbar.appendChild(more);

    for (const [label, action] of [
      ['Copy Quote and Link', 'copyQuoteAndLink'],
      ['Insert Quote and Link', 'insertQuoteAndLink'],
      ['Highlight Selection', 'highlight'],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.className = 'secondary';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        vscode.postMessage({ type: 'selectionAction', action, anchor });
        toolbar.remove();
      });
      menu.appendChild(button);
    }
    toolbar.appendChild(menu);

    document.body.appendChild(toolbar);
    requestAnimationFrame(() => {
      const box = toolbar.getBoundingClientRect();
      const half = box.width / 2;
      const minLeft = window.scrollX + 12 + half;
      const maxLeft = window.scrollX + window.innerWidth - 12 - half;
      toolbar.style.left = `${Math.max(minLeft, Math.min(maxLeft, rect.left + rect.width / 2 + window.scrollX))}px`;
      if (box.top < 8) {
        toolbar.style.top = `${rect.bottom + 10 + window.scrollY}px`;
      }
    });
  }

  private async goToAnchor(anchor: PdfAnchor): Promise<void> {
    if (!anchor?.page) return;
    const page = this.pages.get(anchor.page);
    if (!page) {
      this.pendingAnchor = anchor;
      return;
    }
    this.currentPage = anchor.page;
    this.applyViewMode();
    await this.renderVisiblePages();
    page.wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.updatePageInfo();
    this.flashAnchor(anchor);
  }

  private flashAnchor(anchor: PdfAnchor): void {
    const page = this.pages.get(anchor.page);
    if (!page) return;
    page.highlightLayer.querySelectorAll('.anchor-highlight').forEach(element => element.remove());
    const start = anchor.textItemIndex ?? 0;
    const end = anchor.endTextItemIndex ?? start;
    const startOffset = anchor.charOffset ?? 0;
    const endOffset = anchor.endCharOffset;

    for (let index = start; index <= end; index++) {
      const item = page.textRects[index];
      if (!item?.content) continue;
      const contentLength = item.content.length;
      const itemStart = index === start ? startOffset : 0;
      const itemEnd = index === end ? Math.min(endOffset ?? contentLength, contentLength) : contentLength;
      if (itemEnd <= itemStart) continue;

      const fullLeft = item.rect.origin.x * this.scale;
      const fullTop = item.rect.origin.y * this.scale;
      const fullWidth = item.rect.size.width * this.scale;
      const fullHeight = item.rect.size.height * this.scale;
      const perChar = fullWidth / contentLength;
      const highlight = document.createElement('div');
      highlight.className = 'anchor-highlight';
      highlight.style.left = `${fullLeft + perChar * itemStart}px`;
      highlight.style.top = `${fullTop}px`;
      highlight.style.width = `${Math.max(4, perChar * (itemEnd - itemStart))}px`;
      highlight.style.height = `${fullHeight}px`;
      page.highlightLayer.appendChild(highlight);
    }

    setTimeout(() => {
      page.highlightLayer.querySelectorAll('.anchor-highlight').forEach(element => element.remove());
    }, 2200);
  }

  private drawHighlightsForPage(pageNum: number): void {
    const page = this.pages.get(pageNum);
    if (!page?.textRects.length) return;
    page.highlightLayer.querySelectorAll('.annotation-highlight').forEach(element => element.remove());

    for (const highlight of this.highlights) {
      const anchor = highlight.anchor;
      if (anchor.page !== pageNum || !anchorHasSelection(anchor)) continue;

      const key = anchorKey(anchor);
      const start = anchor.textItemIndex ?? 0;
      const end = anchor.endTextItemIndex ?? start;
      const startOffset = anchor.charOffset ?? 0;
      const endOffset = anchor.endCharOffset ?? ((anchor.charOffset ?? 0) + (anchor.length ?? 0));

      for (let index = start; index <= end; index++) {
        const item = page.textRects[index];
        if (!item?.content) continue;
        const contentLength = item.content.length;
        const itemStart = index === start ? Math.max(0, startOffset) : 0;
        const itemEnd = index === end ? Math.min(contentLength, endOffset) : contentLength;
        if (itemEnd <= itemStart) continue;

        const fullLeft = item.rect.origin.x * this.scale;
        const fullTop = item.rect.origin.y * this.scale;
        const fullWidth = item.rect.size.width * this.scale;
        const fullHeight = item.rect.size.height * this.scale;
        const perChar = fullWidth / contentLength;
        const element = document.createElement('div');
        element.className = `annotation-highlight ${highlight.kind}`;
        element.dataset.anchorKey = key;
        element.style.left = `${fullLeft + perChar * itemStart}px`;
        element.style.top = `${fullTop}px`;
        element.style.width = `${Math.max(4, perChar * (itemEnd - itemStart))}px`;
        element.style.height = `${fullHeight}px`;
        element.title = highlight.kind === 'referenced'
          ? 'Click to see markdown notes referencing this'
          : 'Click to inspect this PDF highlight';

        element.addEventListener('mouseenter', () => this.setHighlightHover(page, key, true));
        element.addEventListener('mouseleave', () => this.setHighlightHover(page, key, false));
        element.addEventListener('click', event => {
          event.stopPropagation();
          this.pendingPopoverAnchor = anchor;
          this.pendingPopoverElement = element;
          vscode.postMessage({ type: 'requestReferencesForAnchor', anchor });
        });
        page.highlightLayer.appendChild(element);
      }
    }
  }

  private setHighlightHover(page: PageState, key: string, enabled: boolean): void {
    for (const element of Array.from(page.highlightLayer.querySelectorAll(`[data-anchor-key="${CSS.escape(key)}"]`))) {
      element.classList.toggle('hover-active', enabled);
    }
  }

  private redrawAllHighlights(): void {
    for (const [pageNum, page] of this.pages) {
      if (page.rendered) this.drawHighlightsForPage(pageNum);
    }
  }

  private drawSearchHighlightsForPage(pageNum: number): void {
    const page = this.pages.get(pageNum);
    if (!page?.textRects.length) return;
    page.highlightLayer.querySelectorAll('.pdf-search-match').forEach(element => element.remove());

    this.searchMatches.forEach((match, searchIndex) => {
      if (match.page !== pageNum) return;
      const item = page.textRects[match.textItemIndex];
      if (!item?.content) return;
      const contentLength = item.content.length;
      const itemStart = Math.max(0, Math.min(match.from, contentLength));
      const itemEnd = Math.max(itemStart, Math.min(match.to, contentLength));
      if (itemEnd <= itemStart) return;

      const fullLeft = item.rect.origin.x * this.scale;
      const fullTop = item.rect.origin.y * this.scale;
      const fullWidth = item.rect.size.width * this.scale;
      const fullHeight = item.rect.size.height * this.scale;
      const perChar = fullWidth / contentLength;
      const element = document.createElement('div');
      element.className = `pdf-search-match${searchIndex === this.selectedSearchIndex ? ' selected' : ''}`;
      element.dataset.searchIndex = String(searchIndex);
      element.style.left = `${fullLeft + perChar * itemStart}px`;
      element.style.top = `${fullTop}px`;
      element.style.width = `${Math.max(4, perChar * (itemEnd - itemStart))}px`;
      element.style.height = `${fullHeight}px`;
      page.highlightLayer.appendChild(element);
    });
  }

  private redrawAllSearchHighlights(): void {
    for (const [pageNum, page] of this.pages) {
      if (page.rendered) this.drawSearchHighlightsForPage(pageNum);
    }
  }

  private showReferencePopover(anchor: PdfAnchor, items: ReferenceListItem[]): void {
    this.dismissPopover();
    if (!this.pendingPopoverAnchor || !this.pendingPopoverElement) return;
    if (anchorKey(this.pendingPopoverAnchor) !== anchorKey(anchor)) return;

    const popover = document.createElement('div');
    popover.className = 'ref-popover';
    popover.id = 'ref-popover';
    popover.style.position = 'fixed';
    popover.style.zIndex = '1001';
    popover.style.pointerEvents = 'auto';
    const header = document.createElement('div');
    header.className = 'header';
    header.textContent = items.length === 1 ? '1 markdown note references this' : `${items.length} markdown notes reference this`;
    popover.appendChild(header);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No markdown references found.';
      popover.appendChild(empty);
    } else {
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'item';
        row.tabIndex = 0;
        const context = document.createElement('div');
        context.className = 'context';
        context.textContent = item.contextLine || item.snippet || '(empty line)';
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = `${item.source}:${item.sourceLine}`;
        row.append(context, meta);
        row.addEventListener('click', () => {
          vscode.postMessage({ type: 'openMarkdownAtLocation', path: item.source, line: item.sourceLine });
          this.dismissPopover();
        });
        row.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') row.click();
        });
        popover.appendChild(row);
      }
    }

    document.body.appendChild(popover);
    const rect = this.pendingPopoverElement.getBoundingClientRect();
    popover.style.left = `${rect.left}px`;
    popover.style.top = `${rect.bottom + 6}px`;
    requestAnimationFrame(() => {
      const box = popover.getBoundingClientRect();
      if (box.right > window.innerWidth - 10) {
        popover.style.left = `${Math.max(10, window.innerWidth - box.width - 10)}px`;
      }
      if (box.bottom > window.innerHeight - 10) {
        popover.style.top = `${Math.max(10, rect.top - box.height - 6)}px`;
      }
    });

    const onDown = (event: MouseEvent) => {
      if (!popover.contains(event.target as Node)) this.dismissPopover();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') this.dismissPopover();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }, 0);
    this.popoverCleanup = () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }

  private dismissPopover(): void {
    document.getElementById('ref-popover')?.remove();
    this.popoverCleanup?.();
    this.popoverCleanup = null;
  }

  private async navigate(direction: -1 | 1): Promise<void> {
    const step = !this.continuousScroll && this.twoPageView ? 2 : 1;
    const origin = !this.continuousScroll && this.twoPageView
      ? this.spreadStartFor(this.currentPage)
      : this.currentPage;
    await this.goToPage(origin + direction * step);
  }

  private async goToPage(page: number): Promise<void> {
    if (!pdfDoc) return;
    const target = Math.max(1, Math.min(pdfDoc.pageCount, page));
    this.currentPage = target;
    this.applyViewMode();
    await this.renderVisiblePages();
    this.pages.get(target)?.wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.updatePageInfo();
  }

  private zoom(delta: number): void {
    this.scale = Math.max(0.5, Math.min(3.5, this.scale + delta));
    void this.rerender();
  }

  private fitWidth(): void {
    const first = this.pages.get(1);
    if (!first) return;
    const pagesPerRow = this.twoPageView ? 2 : 1;
    const spreadGap = this.twoPageView ? 18 : 0;
    this.scale = Math.max(0.5, (this.container.clientWidth - 48 - spreadGap) / (first.pageObj.size.width * pagesPerRow));
    void this.rerender();
  }

  private async rerender(): Promise<void> {
    for (const page of this.pages.values()) {
      page.rendered = false;
      this.applyPageLayout(page);
      page.textLayer.innerHTML = '';
      page.highlightLayer.innerHTML = '';
    }
    this.applyViewMode();
    await this.renderVisiblePages();
    this.redrawAllHighlights();
    this.redrawAllSearchHighlights();
    this.updatePageInfo();
  }

  private updatePageInfo(): void {
    const total = pdfDoc?.pageCount ?? 0;
    this.pageInfo.textContent = total ? `Page ${this.currentPage} / ${total}  ${Math.round(this.scale * 100)}%` : '';
    vscode.postMessage({ type: 'pageChanged', page: this.currentPage, totalPages: total });
  }

  private async toggleContinuousScroll(): Promise<void> {
    this.continuousScroll = !this.continuousScroll;
    this.applyViewMode();
    await this.renderVisiblePages();
    this.pages.get(this.currentPage)?.wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.updatePageInfo();
  }

  private async toggleTwoPageView(): Promise<void> {
    this.twoPageView = !this.twoPageView;
    this.applyViewMode();
    await this.renderVisiblePages();
    this.pages.get(this.currentPage)?.wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.updatePageInfo();
  }

  private async renderVisiblePages(): Promise<void> {
    const pagesToRender = this.continuousScroll
      ? [this.currentPage]
      : this.visiblePageNumbers();
    for (const pageNum of pagesToRender) {
      await this.renderPage(pageNum);
    }
  }

  private visiblePageNumbers(): number[] {
    if (!pdfDoc) return [];
    if (this.continuousScroll) return Array.from(this.pages.keys());
    if (!this.twoPageView) return [this.currentPage];
    const start = this.spreadStartFor(this.currentPage);
    return [start, start + 1].filter(page => page <= pdfDoc.pageCount);
  }

  private spreadStartFor(page: number): number {
    return Math.max(1, page % 2 === 0 ? page - 1 : page);
  }

  private applyViewMode(): void {
    this.pageContainer.classList.toggle('paginated', !this.continuousScroll);
    this.pageContainer.classList.toggle('two-page', this.twoPageView);
    const visible = new Set(this.visiblePageNumbers());
    for (const page of this.pages.values()) {
      page.wrapper.style.display = this.continuousScroll || visible.has(page.pageNum) ? '' : 'none';
    }
    this.updateToolbarState();
  }

  private updateToolbarState(): void {
    const continuousButton = document.getElementById('toggle-continuous') as HTMLButtonElement | null;
    if (continuousButton) {
      continuousButton.setAttribute('aria-pressed', String(this.continuousScroll));
      continuousButton.textContent = this.continuousScroll ? 'Continuous' : 'Paged';
      continuousButton.title = this.continuousScroll ? 'Switch to page-turning mode' : 'Switch to continuous scroll';
    }

    const spreadButton = document.getElementById('toggle-spread') as HTMLButtonElement | null;
    if (spreadButton) {
      spreadButton.setAttribute('aria-pressed', String(this.twoPageView));
      spreadButton.textContent = this.twoPageView ? 'Two Page' : 'One Page';
      spreadButton.title = this.twoPageView ? 'Switch to one-page view' : 'Switch to two-page view';
    }
  }

  private applyPageLayout(state: PageState, rawDpr = window.devicePixelRatio || 1): PdfPageLayout {
    const layout = createPdfPageLayout(state.pageObj.size, this.scale, rawDpr);
    const width = formatCssPx(layout.cssWidth);
    const height = formatCssPx(layout.cssHeight);
    for (const element of [state.wrapper, state.canvas, state.textLayer, state.highlightLayer]) {
      element.style.width = width;
      element.style.height = height;
    }
    return layout;
  }
}

void (async function boot() {
  const wasmUrl = (window as any).__pdfiumWasmUrl;
  try {
    engine = await createPdfiumEngine(wasmUrl);
    new PdfViewer();
  } catch (error: any) {
    document.getElementById('page-container')!.innerHTML = `<div class="error">Failed to initialize PDFium: ${escapeHtml(String(error?.message ?? error))}</div>`;
    vscode.postMessage({ type: 'error', message: String(error?.message ?? error) });
  }
})();

function closestTextSpan(node: Node): HTMLElement | null {
  if (node instanceof HTMLElement) return node.closest<HTMLElement>('span[data-item-index]');
  return node.parentElement?.closest<HTMLElement>('span[data-item-index]') ?? null;
}

function textOffset(node: Node, offset: number, span: HTMLElement): number {
  if (node.nodeType === Node.TEXT_NODE) return Math.min(offset, node.textContent?.length ?? 0);
  if (node === span) return offset === 0 ? 0 : (span.textContent?.length ?? 0);
  return Math.min(offset, span.textContent?.length ?? 0);
}

function anchorKey(anchor: PdfAnchor): string {
  if (anchor.id) return anchor.id;
  return [
    anchor.page,
    anchor.textItemIndex ?? 0,
    anchor.charOffset ?? 0,
    anchor.endTextItemIndex ?? anchor.textItemIndex ?? 0,
    anchor.endCharOffset ?? ((anchor.charOffset ?? 0) + (anchor.length ?? 0)),
  ].join(':');
}

function anchorHasSelection(anchor: PdfAnchor): boolean {
  return (
    typeof anchor.textItemIndex === 'number' &&
    typeof anchor.charOffset === 'number' &&
    (
      (typeof anchor.endTextItemIndex === 'number' && typeof anchor.endCharOffset === 'number') ||
      Number(anchor.length ?? 0) > 0
    )
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]!));
}
