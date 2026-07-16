/// <reference path="./vscode.d.ts" />

import { createPdfiumEngine } from '@embedpdf/engines/pdfium-direct-engine';
import { createPdfPageLayout, formatCssPx, type PdfPageLayout } from './pdfLayout';
import { showObsidianContextMenu } from './obsidianContextMenu';
import { createPdfAskPanel, type PdfAskPanel, type PdfAskSelection } from './pdfAskPanel';

const vscode = acquireVsCodeApi();

type HighlightColor = 'yellow' | 'red' | 'green' | 'purple';
type PdfRect = [number, number, number, number];

const PDF_TEXT_FRAGMENT_CONTEXT_LENGTH = 32;

const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: 'rgba(255, 213, 79, 0.42)',
  red: 'rgba(255, 107, 107, 0.42)',
  green: 'rgba(105, 219, 124, 0.42)',
  purple: 'rgba(177, 151, 252, 0.42)',
};

interface PdfAnchor {
  id?: string;
  page: number;
  textItemIndex?: number;
  charOffset?: number;
  endTextItemIndex?: number;
  endCharOffset?: number;
  length?: number;
  rects?: PdfRect[];
  snippet?: string;
  prefix?: string;
  suffix?: string;
  textFragment?: PdfTextFragment;
  highlightColor?: HighlightColor;
}

interface PdfTextFragment {
  textStart: string;
  textEnd?: string;
  prefix?: string;
  suffix?: string;
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
  segments: PdfSearchSegment[];
}

interface PdfSearchSegment {
  textItemIndex: number;
  from: number;
  to: number;
}

interface PdfSearchIndexChar {
  value: string;
  textItemIndex?: number;
  offset?: number;
}

interface PageState {
  pageNum: number;
  pageObj: any;
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  highlightLayer: HTMLDivElement;
  textRects: any[];
  textRectsPromise?: Promise<any[]>;
  rendered: boolean;
  thumbnailButton: HTMLButtonElement;
  thumbnailCanvas: HTMLCanvasElement;
  thumbnailRendered: boolean;
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
  private readonly searchSettingsMenu = document.getElementById('pdf-search-settings-menu') as HTMLElement;
  private readonly sidebar = document.getElementById('pdf-sidebar') as HTMLElement;
  private readonly thumbnailList = document.getElementById('thumbnail-list') as HTMLElement;
  private readonly pageInput = document.getElementById('page-input') as HTMLInputElement;
  private readonly pageTotal = document.getElementById('page-total') as HTMLElement;
  private readonly zoomInput = document.getElementById('zoom-input') as HTMLInputElement;
  private readonly displayMenu = document.getElementById('display-menu') as HTMLElement;
  private readonly pages = new Map<number, PageState>();
  private scale = 1.35;
  private currentPage = 1;
  private continuousScroll = true;
  private twoPageView = false;
  private scrollMode: 'vertical' | 'horizontal' | 'in-page' | 'wrapped' = 'vertical';
  private spreadParity: 'odd' | 'even' = 'odd';
  private fitMode: 'custom' | 'width' | 'height' | 'page' = 'custom';
  private adaptToTheme = false;
  private intersectionObserver: IntersectionObserver | null = null;
  private readonly pageVisibilityRatios = new Map<number, number>();
  private thumbnailObserver: IntersectionObserver | null = null;
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
  private pageNavigationRunId = 0;
  private pageInputNavigationPointer: {
    pointerId: number;
    button: HTMLButtonElement;
    blurDeferred: boolean;
    releasedOutside: boolean;
  } | null = null;
  private matchCase = false;
  private highlightAllSearchMatches = false;
  private matchDiacritics = false;
  private wholeWords = false;
  private selectedHighlightColor: HighlightColor = 'yellow';
  private copyLinkFormat: 'link' | 'quote' = 'link';
  private directHighlight = false;
  private rectangleSelection = false;
  private rectangleDrag: {
    pointerId: number;
    page: number;
    wrapper: HTMLElement;
    overlay: HTMLDivElement;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null = null;
  private fitResizeTimer: number | undefined;
  private latestSelectionAnchor: PdfAnchor | null = null;
  private selectionUpdateTimer: number | undefined;
  private readonly askPanel: PdfAskPanel;

  constructor() {
    document.body.classList.toggle('pdf-adapt-theme', this.adaptToTheme);
    this.askPanel = createPdfAskPanel({
      vscode,
      toolbar: document.getElementById('toolbar')!,
      viewerShell: document.getElementById('viewer-shell')!,
      getPageSurface: pageNumber => {
        const page = this.pages.get(pageNumber);
        if (!page) return undefined;
        return {
          canvas: page.canvas,
          pageWidth: Number(page.pageObj.size.width),
          pageHeight: Number(page.pageObj.size.height),
        };
      },
      getAnchorViewportRect: (pageNumber, rects) => {
        const page = this.pages.get(pageNumber);
        const valid = rects.filter(rect => (
          rect.length === 4
          && rect.every(value => Number.isFinite(value))
          && rect[2] > rect[0]
          && rect[3] > rect[1]
        ));
        if (!page || !valid.length) return undefined;
        const wrapper = page.wrapper.getBoundingClientRect();
        const shell = document.getElementById('viewer-shell')!.getBoundingClientRect();
        return {
          left: wrapper.left - shell.left + Math.min(...valid.map(rect => rect[0])) * this.scale,
          top: wrapper.top - shell.top + Math.min(...valid.map(rect => rect[1])) * this.scale,
          right: wrapper.left - shell.left + Math.max(...valid.map(rect => rect[2])) * this.scale,
          bottom: wrapper.top - shell.top + Math.max(...valid.map(rect => rect[3])) * this.scale,
        };
      },
      navigateTo: async (page, _rects, annotationId) => {
        const navigationCurrent = await this.goToPage(page);
        if (!navigationCurrent) return;
        if (annotationId) {
          this.pages.get(page)?.highlightLayer
            .querySelector<HTMLElement>(`[data-annotation-id="${CSS.escape(annotationId)}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      },
      redrawMarkers: () => this.redrawAllDiscussionMarkers(),
    });
    this.setupMessages();
    this.setupToolbar();
    this.setupSearch();
    this.setupRectangleSelection();
    window.addEventListener('resize', () => {
      if (this.fitMode === 'custom') return;
      if (this.fitResizeTimer !== undefined) window.clearTimeout(this.fitResizeTimer);
      this.fitResizeTimer = window.setTimeout(() => {
        this.fitResizeTimer = undefined;
        void this.reapplyFitMode();
      }, 80);
    });
    this.pageContainer.addEventListener('mouseup', event => {
      if (event.button !== 0) return;
      this.scheduleSelectionUpdate();
    });
    this.pageContainer.addEventListener('contextmenu', event => this.handleContextMenu(event));
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
          void this.goToAnchor(message.anchor ?? {
            page: Number(message.page),
            textFragment: message.textFragment,
          });
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
        case 'pdfDiscussionOpenForSelection':
          this.openAskPdfForNativeSelection();
          break;
        default:
          this.askPanel.handleHostMessage(message);
          break;
      }
    });
  }

  private setupToolbar(): void {
    const previousPageButton = document.getElementById('prev') as HTMLButtonElement | null;
    const nextPageButton = document.getElementById('next') as HTMLButtonElement | null;
    const finishDeferredPageInputPointer = (pointerId: number, waitForClick: boolean): void => {
      const pending = this.pageInputNavigationPointer;
      if (!pending || pending.pointerId !== pointerId) return;
      const finish = () => {
        if (this.pageInputNavigationPointer !== pending) return;
        this.pageInputNavigationPointer = null;
        if (pending.blurDeferred) void this.commitPageInput();
      };
      if (waitForClick) window.setTimeout(finish, 0);
      else finish();
    };
    for (const [button, direction] of [[previousPageButton, -1], [nextPageButton, 1]] as const) {
      if (!button) continue;
      button.addEventListener('pointerdown', event => {
        if (event.button === 0 && document.activeElement === this.pageInput) {
          this.pageInputNavigationPointer = {
            pointerId: event.pointerId,
            button,
            blurDeferred: false,
            releasedOutside: false,
          };
          try {
            button.setPointerCapture(event.pointerId);
          } catch {
            // Synthetic pointer events used by tests do not own an active pointer.
          }
        }
      });
      button.addEventListener('lostpointercapture', event => {
        finishDeferredPageInputPointer(event.pointerId, true);
      });
      button.addEventListener('click', event => {
        const pending = this.pageInputNavigationPointer;
        this.pageInputNavigationPointer = null;
        if (pending?.button === button && pending.releasedOutside) {
          event.preventDefault();
          if (pending.blurDeferred) void this.commitPageInput();
          return;
        }
        void this.navigate(direction);
      });
    }
    window.addEventListener('pointerup', event => {
      const pending = this.pageInputNavigationPointer;
      if (!pending || pending.pointerId !== event.pointerId) return;
      const bounds = pending.button.getBoundingClientRect();
      pending.releasedOutside = event.clientX < bounds.left
        || event.clientX > bounds.right
        || event.clientY < bounds.top
        || event.clientY > bounds.bottom;
      finishDeferredPageInputPointer(event.pointerId, true);
    });
    window.addEventListener('pointercancel', event => {
      finishDeferredPageInputPointer(event.pointerId, false);
    });
    document.getElementById('zoom-in')?.addEventListener('click', () => this.zoom(0.15));
    document.getElementById('zoom-out')?.addEventListener('click', () => this.zoom(-0.15));
    document.getElementById('search-open')?.addEventListener('click', () => this.openSearch());
    document.getElementById('toggle-sidebar')?.addEventListener('click', () => this.toggleSidebar());
    document.getElementById('close-sidebar')?.addEventListener('click', () => this.toggleSidebar(false));

    this.pageInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void this.commitPageInput();
    });
    this.pageInput.addEventListener('blur', () => {
      if (this.pageInputNavigationPointer) {
        this.pageInputNavigationPointer.blurDeferred = true;
        return;
      }
      void this.commitPageInput();
    });
    this.pageInput.addEventListener('focus', () => this.pageInput.select());
    this.zoomInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.commitZoomInput();
    });
    this.zoomInput.addEventListener('blur', () => this.commitZoomInput());
    this.zoomInput.addEventListener('focus', () => this.zoomInput.select());

    const displayButton = document.getElementById('display-menu-button') as HTMLButtonElement | null;
    displayButton?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.setDisplayMenuOpen(this.displayMenu.classList.contains('hidden'));
    });
    this.displayMenu.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-display-action]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      this.applyDisplayAction(button.dataset.displayAction ?? '');
      this.setDisplayMenuOpen(false);
    });

    const colorTrigger = document.getElementById('highlight-color') as HTMLButtonElement | null;
    const colorMenu = document.getElementById('highlight-color-menu') as HTMLElement | null;
    const paletteButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-palette-highlight-color]'));
    const selectHighlightColor = (value: unknown): void => {
      this.selectedHighlightColor = normalizeHighlightColor(value) ?? 'yellow';
      colorTrigger?.setAttribute('data-highlight-color', this.selectedHighlightColor);
      for (const item of Array.from(colorMenu?.querySelectorAll<HTMLButtonElement>('[data-highlight-color]') ?? [])) {
        item.setAttribute('aria-checked', String(item.dataset.highlightColor === this.selectedHighlightColor));
      }
      for (const item of paletteButtons) {
        item.setAttribute('aria-pressed', String(item.dataset.paletteHighlightColor === this.selectedHighlightColor));
      }
    };
    colorTrigger?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const open = colorMenu?.classList.contains('hidden') ?? false;
      colorMenu?.classList.toggle('hidden', !open);
      colorTrigger.setAttribute('aria-expanded', String(open));
    });
    colorMenu?.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-highlight-color]');
      if (!button) return;
      selectHighlightColor(button.dataset.highlightColor);
      colorMenu.classList.add('hidden');
      colorTrigger?.setAttribute('aria-expanded', 'false');
    });
    for (const button of paletteButtons) {
      button.addEventListener('click', () => selectHighlightColor(button.dataset.paletteHighlightColor));
    }

    const copyTrigger = document.getElementById('copy-link-format') as HTMLButtonElement | null;
    const copyMenu = document.getElementById('copy-link-format-menu') as HTMLElement | null;
    copyTrigger?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const open = copyMenu?.classList.contains('hidden') ?? false;
      copyMenu?.classList.toggle('hidden', !open);
      copyTrigger.setAttribute('aria-expanded', String(open));
    });
    copyMenu?.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-link-format]');
      if (!button) return;
      this.copyLinkFormat = button.dataset.copyLinkFormat === 'quote' ? 'quote' : 'link';
      copyTrigger?.setAttribute('data-copy-link-format', this.copyLinkFormat);
      for (const item of Array.from(copyMenu.querySelectorAll<HTMLButtonElement>('[data-copy-link-format]'))) {
        item.setAttribute('aria-checked', String(item === button));
      }
      copyMenu.classList.add('hidden');
      copyTrigger?.setAttribute('aria-expanded', 'false');
    });

    const rectangleButton = document.getElementById('rectangle-selection') as HTMLButtonElement | null;
    rectangleButton?.addEventListener('click', () => {
      this.setRectangleSelection(!this.rectangleSelection);
    });
    const directButton = document.getElementById('direct-highlight') as HTMLButtonElement | null;
    directButton?.addEventListener('click', () => {
      this.directHighlight = directButton.getAttribute('aria-pressed') !== 'true';
      directButton.setAttribute('aria-pressed', String(this.directHighlight));
      if (this.directHighlight) this.setRectangleSelection(false);
    });

    document.addEventListener('mousedown', event => {
      const target = event.target as Node;
      if (!this.displayMenu.classList.contains('hidden')
        && !this.displayMenu.contains(target)
        && !displayButton?.contains(target)) {
        this.setDisplayMenuOpen(false);
      }
      if (colorMenu && !colorMenu.classList.contains('hidden') && !colorMenu.contains(target) && !colorTrigger?.contains(target)) {
        colorMenu.classList.add('hidden');
        colorTrigger?.setAttribute('aria-expanded', 'false');
      }
      if (copyMenu && !copyMenu.classList.contains('hidden') && !copyMenu.contains(target) && !copyTrigger?.contains(target)) {
        copyMenu.classList.add('hidden');
        copyTrigger?.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !this.displayMenu.classList.contains('hidden')) {
        event.preventDefault();
        this.setDisplayMenuOpen(false);
        displayButton?.focus();
      }
      if (event.key === 'Escape' && colorMenu && !colorMenu.classList.contains('hidden')) {
        event.preventDefault();
        colorMenu.classList.add('hidden');
        colorTrigger?.setAttribute('aria-expanded', 'false');
        colorTrigger?.focus();
      }
      if (event.key === 'Escape' && copyMenu && !copyMenu.classList.contains('hidden')) {
        event.preventDefault();
        copyMenu.classList.add('hidden');
        copyTrigger?.setAttribute('aria-expanded', 'false');
        copyTrigger?.focus();
      }
      if (event.key === 'Escape' && (this.rectangleSelection || this.rectangleDrag)) {
        event.preventDefault();
        this.cancelRectangleSelection();
        rectangleButton?.focus();
      }
    });
    this.updateToolbarState();
    selectHighlightColor(this.selectedHighlightColor);
  }

  private async commitPageInput(): Promise<void> {
    const page = Number.parseInt(this.pageInput.value, 10);
    if (!Number.isFinite(page)) {
      this.updatePageInfo();
      return;
    }
    await this.goToPage(page);
  }

  private commitZoomInput(): void {
    const percentage = Number.parseFloat(this.zoomInput.value);
    if (!Number.isFinite(percentage)) {
      this.updatePageInfo();
      return;
    }
    this.fitMode = 'custom';
    this.scale = Math.max(0.5, Math.min(3.5, percentage / 100));
    void this.rerender();
  }

  private toggleSidebar(force?: boolean): void {
    const open = force ?? this.sidebar.hidden;
    this.sidebar.hidden = !open;
    const button = document.getElementById('toggle-sidebar');
    button?.setAttribute('aria-expanded', String(open));
    if (open) {
      void this.renderThumbnail(this.currentPage);
      void this.renderThumbnail(Math.min(this.pages.size, this.currentPage + 1));
      this.pages.get(this.currentPage)?.thumbnailButton.scrollIntoView({ block: 'nearest' });
    }
    if (this.fitMode !== 'custom') {
      requestAnimationFrame(() => void this.reapplyFitMode());
    }
  }

  private setupRectangleSelection(): void {
    this.pageContainer.addEventListener('pointerdown', event => this.startRectangleDrag(event), true);
    this.pageContainer.addEventListener('pointermove', event => this.updateRectangleDrag(event), true);
    this.pageContainer.addEventListener('pointerup', event => this.finishRectangleDrag(event), true);
    this.pageContainer.addEventListener('pointercancel', () => this.cancelRectangleSelection(), true);
  }

  private setRectangleSelection(enabled: boolean): void {
    this.rectangleSelection = enabled;
    document.getElementById('rectangle-selection')?.setAttribute('aria-pressed', String(enabled));
    this.pageContainer.classList.toggle('rectangle-mode', enabled);
    if (enabled) {
      this.directHighlight = false;
      document.getElementById('direct-highlight')?.setAttribute('aria-pressed', 'false');
      window.getSelection()?.removeAllRanges();
      this.clearSelection();
    } else if (!this.rectangleDrag) {
      this.pageContainer.classList.remove('rectangle-mode');
    }
  }

  private startRectangleDrag(event: PointerEvent): void {
    if (!this.rectangleSelection || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const wrapper = target?.closest<HTMLElement>('.page-wrapper');
    if (!wrapper) return;
    const page = Number(wrapper.dataset.page ?? wrapper.id.replace('page-', ''));
    if (!Number.isFinite(page)) return;

    event.preventDefault();
    event.stopPropagation();
    const bounds = wrapper.getBoundingClientRect();
    const startX = clamp(event.clientX - bounds.left, 0, bounds.width);
    const startY = clamp(event.clientY - bounds.top, 0, bounds.height);
    const overlay = document.createElement('div');
    overlay.className = 'rectangle-selection-overlay';
    overlay.style.left = `${startX}px`;
    overlay.style.top = `${startY}px`;
    overlay.style.width = '0px';
    overlay.style.height = '0px';
    wrapper.appendChild(overlay);
    wrapper.setPointerCapture?.(event.pointerId);
    this.rectangleDrag = {
      pointerId: event.pointerId,
      page,
      wrapper,
      overlay,
      startX,
      startY,
      currentX: startX,
      currentY: startY,
    };
  }

  private updateRectangleDrag(event: PointerEvent): void {
    const drag = this.rectangleDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const bounds = drag.wrapper.getBoundingClientRect();
    drag.currentX = clamp(event.clientX - bounds.left, 0, bounds.width);
    drag.currentY = clamp(event.clientY - bounds.top, 0, bounds.height);
    const left = Math.min(drag.startX, drag.currentX);
    const top = Math.min(drag.startY, drag.currentY);
    drag.overlay.style.left = `${left}px`;
    drag.overlay.style.top = `${top}px`;
    drag.overlay.style.width = `${Math.abs(drag.currentX - drag.startX)}px`;
    drag.overlay.style.height = `${Math.abs(drag.currentY - drag.startY)}px`;
  }

  private finishRectangleDrag(event: PointerEvent): void {
    const drag = this.rectangleDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.updateRectangleDrag(event);
    drag.wrapper.releasePointerCapture?.(event.pointerId);
    const width = Math.abs(drag.currentX - drag.startX);
    const height = Math.abs(drag.currentY - drag.startY);
    const left = Math.min(drag.startX, drag.currentX);
    const top = Math.min(drag.startY, drag.currentY);
    const right = Math.max(drag.startX, drag.currentX);
    const bottom = Math.max(drag.startY, drag.currentY);
    drag.overlay.remove();
    this.rectangleDrag = null;
    this.setRectangleSelection(false);
    if (width < 4 || height < 4) return;

    const rect = [left, top, right, bottom].map(value => Math.round(value / this.scale));
    vscode.postMessage({
      type: 'selectionAction',
      action: 'copyRectEmbed',
      anchor: { page: drag.page, rects: [rect], snippet: '' },
    });
  }

  private cancelRectangleSelection(): void {
    const drag = this.rectangleDrag;
    drag?.overlay.remove();
    if (drag) drag.wrapper.releasePointerCapture?.(drag.pointerId);
    this.rectangleDrag = null;
    this.setRectangleSelection(false);
  }

  private setDisplayMenuOpen(open: boolean): void {
    this.displayMenu.classList.toggle('hidden', !open);
    document.getElementById('display-menu-button')?.setAttribute('aria-expanded', String(open));
  }

  private applyDisplayAction(action: string): void {
    if (action === 'fit-width') this.fitWidth();
    else if (action === 'fit-height') this.fitHeight();
    else if (action === 'fit-page') this.fitPage();
    else if (action === 'scroll-vertical') void this.setScrollMode('vertical');
    else if (action === 'scroll-horizontal') void this.setScrollMode('horizontal');
    else if (action === 'scroll-in-page') void this.setScrollMode('in-page');
    else if (action === 'scroll-wrapped') void this.setScrollMode('wrapped');
    else if (action === 'spread-single') void this.setSpreadMode(false, 'odd');
    else if (action === 'spread-odd') void this.setSpreadMode(true, 'odd');
    else if (action === 'spread-even') void this.setSpreadMode(true, 'even');
    else if (action === 'adapt-theme') {
      this.adaptToTheme = !this.adaptToTheme;
      document.body.classList.toggle('pdf-adapt-theme', this.adaptToTheme);
      this.updateToolbarState();
    } else if (action === 'defaults') {
      this.adaptToTheme = false;
      this.scrollMode = 'vertical';
      this.continuousScroll = true;
      this.twoPageView = false;
      this.spreadParity = 'odd';
      document.body.classList.remove('pdf-adapt-theme');
      this.applyViewMode();
      this.fitWidth();
    }
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
        event.stopPropagation();
        if (!this.searchSettingsMenu.classList.contains('hidden')) {
          this.setSearchSettingsOpen(false);
          document.getElementById('pdf-search-settings')?.focus();
        } else {
          this.closeSearch();
        }
      }
    });
    document.getElementById('pdf-search-prev')?.addEventListener('click', () => void this.stepSearch(-1));
    document.getElementById('pdf-search-next')?.addEventListener('click', () => void this.stepSearch(1));
    document.getElementById('pdf-search-close')?.addEventListener('click', () => this.closeSearch());
    const matchCaseButton = document.getElementById('pdf-search-case') as HTMLButtonElement | null;
    matchCaseButton?.addEventListener('click', () => {
      this.matchCase = !this.matchCase;
      matchCaseButton.setAttribute('aria-pressed', String(this.matchCase));
      void this.updateSearch(this.searchInput.value);
    });
    const settingsButton = document.getElementById('pdf-search-settings') as HTMLButtonElement | null;
    settingsButton?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.setSearchSettingsOpen(this.searchSettingsMenu.classList.contains('hidden'));
    });
    this.searchSettingsMenu.addEventListener('change', event => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-search-setting]');
      if (!input) return;
      const enabled = input.checked;
      if (input.dataset.searchSetting === 'highlight-all') {
        this.highlightAllSearchMatches = enabled;
        this.redrawAllSearchHighlights();
      } else if (input.dataset.searchSetting === 'match-diacritics') {
        this.matchDiacritics = enabled;
        void this.updateSearch(this.searchInput.value);
      } else if (input.dataset.searchSetting === 'whole-words') {
        this.wholeWords = enabled;
        void this.updateSearch(this.searchInput.value);
      }
    });
    document.addEventListener('pointerdown', event => {
      const target = event.target as Node;
      if (!this.searchSettingsMenu.classList.contains('hidden')
        && !this.searchSettingsMenu.contains(target)
        && !settingsButton?.contains(target)) {
        this.setSearchSettingsOpen(false);
      }
    });
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        this.openSearch();
      } else if (event.key === 'Escape' && !this.searchSettingsMenu.classList.contains('hidden')) {
        event.preventDefault();
        this.setSearchSettingsOpen(false);
        settingsButton?.focus();
      } else if (event.key === 'Escape' && !this.searchPanel.classList.contains('hidden')) {
        event.preventDefault();
        this.closeSearch();
      }
    });
  }

  private setSearchSettingsOpen(open: boolean): void {
    this.searchSettingsMenu.classList.toggle('hidden', !open);
    document.getElementById('pdf-search-settings')?.setAttribute('aria-expanded', String(open));
  }

  private openSearch(): void {
    this.searchPanel.classList.remove('hidden');
    this.searchInput.focus();
    this.searchInput.select();
    if (this.searchInput.value.trim()) {
      void this.updateSearch(this.searchInput.value);
    }
  }

  private closeSearch(): void {
    this.setSearchSettingsOpen(false);
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
    for (const page of this.pages.values()) {
      await this.loadTextRects(page);
    }
  }

  private collectSearchMatches(query: string): PdfSearchMatch[] {
    const needle = normalizeSearchText(query, this.matchCase, this.matchDiacritics);
    if (!needle) return [];
    const allowLenientAsciiSearch = isAsciiSearchQuery(needle);
    const matches: PdfSearchMatch[] = [];
    const seen = new Set<string>();
    for (const page of this.pages.values()) {
      const indexes = [
        buildPdfSearchIndex(page.textRects, true, false, this.matchCase, this.matchDiacritics),
        buildPdfSearchIndex(page.textRects, false, false, this.matchCase, this.matchDiacritics),
      ];
      if (allowLenientAsciiSearch) {
        indexes.push(
          buildPdfSearchIndex(page.textRects, true, true, this.matchCase, this.matchDiacritics),
          buildPdfSearchIndex(page.textRects, false, true, this.matchCase, this.matchDiacritics)
        );
      }
      for (const index of indexes) {
        const haystack = index.map(char => char.value).join('');
        let from = haystack.indexOf(needle);
        while (from >= 0) {
          const segments = segmentsForSearchRange(index, from, from + needle.length);
          if (segments.length && (!this.wholeWords || isWholeWordSearchMatch(haystack, from, needle.length))) {
            const key = `${page.pageNum}:${segments
              .map(segment => `${segment.textItemIndex}:${segment.from}:${segment.to}`)
              .join('|')}`;
            if (!seen.has(key)) {
              seen.add(key);
              matches.push({ page: page.pageNum, segments });
            }
          }
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
      this.searchCount.textContent = `${this.selectedSearchIndex + 1} of ${this.searchMatches.length}`;
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
    this.thumbnailList.innerHTML = '';
    this.pages.clear();
    this.pageVisibilityRatios.clear();
    this.intersectionObserver?.disconnect();
    this.intersectionObserver = null;
    this.thumbnailObserver?.disconnect();
    this.thumbnailObserver = null;
    const pageCount = pdfDoc?.pageCount ?? 0;

    for (let index = 0; index < pageCount; index++) {
      const pageObj = pdfDoc.pages[index];
      const pageNum = index + 1;
      const wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper';
      wrapper.id = `page-${pageNum}`;
      wrapper.dataset.page = String(pageNum);

      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-canvas';
      const textLayer = document.createElement('div');
      textLayer.className = 'text-layer';
      textLayer.dataset.page = String(pageNum);
      const highlightLayer = document.createElement('div');
      highlightLayer.className = 'highlight-layer';

      const thumbnailButton = document.createElement('button');
      thumbnailButton.type = 'button';
      thumbnailButton.className = 'pdf-thumbnail';
      thumbnailButton.ariaLabel = `Page ${pageNum} thumbnail`;
      const thumbnailCanvas = document.createElement('canvas');
      const thumbnailLabel = document.createElement('span');
      thumbnailLabel.textContent = String(pageNum);
      thumbnailButton.append(thumbnailCanvas, thumbnailLabel);
      thumbnailButton.addEventListener('click', () => void this.goToPage(pageNum));
      this.thumbnailList.appendChild(thumbnailButton);

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
        thumbnailButton,
        thumbnailCanvas,
        thumbnailRendered: false,
      });
      this.applyPageLayout(this.pages.get(pageNum)!);
    }

    this.applyViewMode();

    this.intersectionObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).id.replace('page-', ''));
        this.pageVisibilityRatios.set(page, entry.isIntersecting ? entry.intersectionRatio : 0);
        if (entry.isIntersecting) {
          void this.renderPage(page);
        }
      }
      let mostVisible: { page: number; ratio: number } | undefined;
      for (const [page, ratio] of this.pageVisibilityRatios) {
        if (
          !mostVisible
          || ratio > mostVisible.ratio
          || (ratio === mostVisible.ratio && page === this.currentPage)
        ) {
          mostVisible = { page, ratio };
        }
      }
      if (this.continuousScroll && mostVisible && mostVisible.ratio > 0 && mostVisible.page !== this.currentPage) {
        this.currentPage = mostVisible.page;
        this.updatePageInfo();
      }
    }, { root: this.container, rootMargin: '300px', threshold: [0, 0.25, 0.5, 0.75, 1] });

    for (const page of this.pages.values()) this.intersectionObserver.observe(page.wrapper);

    this.thumbnailObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const page = Number((entry.target as HTMLElement).dataset.pageThumbnail ?? 0);
        if (page > 0) void this.renderThumbnail(page);
      }
    }, { root: this.thumbnailList, rootMargin: '180px' });
    for (const page of this.pages.values()) {
      page.thumbnailButton.dataset.pageThumbnail = String(page.pageNum);
      this.thumbnailObserver.observe(page.thumbnailButton);
    }
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

      const rects = await this.loadTextRects(state);
      state.textRects = rects;
      state.textLayer.innerHTML = '';
      rects.forEach((item, itemIndex) => {
        const span = document.createElement('span');
        span.dataset.itemIndex = String(itemIndex);
        const left = item.rect.origin.x * layout.scale;
        const top = item.rect.origin.y * layout.scale;
        const width = item.rect.size.width * layout.scale;
        const height = item.rect.size.height * layout.scale;
        span.style.left = formatCssPx(left);
        span.style.top = formatCssPx(top);
        span.style.width = formatCssPx(width);
        span.style.height = formatCssPx(height);
        span.style.lineHeight = formatCssPx(height);
        span.style.overflow = 'hidden';
        const glyphs = document.createElement('span');
        glyphs.className = 'pdf-text-glyphs';
        glyphs.textContent = item.content;
        glyphs.style.left = '0px';
        glyphs.style.top = '0px';
        glyphs.style.width = 'max-content';
        glyphs.style.height = 'max-content';
        glyphs.style.lineHeight = formatCssPx(height);
        const declaredFontSize = Number(item.font?.size);
        glyphs.style.fontSize = formatCssPx(Math.max(
          1,
          (Number.isFinite(declaredFontSize) && declaredFontSize > 0 ? declaredFontSize : item.rect.size.height) * layout.scale,
        ));
        const declaredFontFamily = typeof item.font?.family === 'string' ? item.font.family.trim() : '';
        if (declaredFontFamily) glyphs.style.fontFamily = declaredFontFamily;
        glyphs.style.transformOrigin = '0 0';
        span.appendChild(glyphs);
        state.textLayer.appendChild(span);
        alignPdfTextSpanToRect(span, glyphs, { left, top, width, height });
      });
      this.drawHighlightsForPage(pageNum);
      this.drawSearchHighlightsForPage(pageNum);
      this.drawDiscussionMarkersForPage(pageNum);
    } catch (error) {
      console.error(`Failed to render page ${pageNum}`, error);
      state.rendered = false;
    }
  }

  private loadTextRects(state: PageState): Promise<any[]> {
    if (!state.textRectsPromise) {
      state.textRectsPromise = engine.getPageTextRects(pdfDoc, state.pageObj).toPromise()
        .then((rects: any[]) => {
          state.textRects = rects;
          return rects;
        });
    }
    return state.textRectsPromise!;
  }

  private async renderThumbnail(pageNum: number): Promise<void> {
    const state = this.pages.get(pageNum);
    if (!state || state.thumbnailRendered || !pdfDoc) return;
    state.thumbnailRendered = true;
    try {
      const cssWidth = 116;
      const cssScale = cssWidth / state.pageObj.size.width;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const bitmapWidth = Math.max(1, Math.round(state.pageObj.size.width * cssScale * dpr));
      const bitmapHeight = Math.max(1, Math.round(state.pageObj.size.height * cssScale * dpr));
      const blob: Blob = await engine
        .renderPage(pdfDoc, state.pageObj, { scaleFactor: cssScale, dpr, withAnnotations: true })
        .toPromise();
      const url = URL.createObjectURL(blob);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => {
          state.thumbnailCanvas.width = bitmapWidth;
          state.thumbnailCanvas.height = bitmapHeight;
          state.thumbnailCanvas.style.height = formatCssPx(state.pageObj.size.height * cssScale);
          const context = state.thumbnailCanvas.getContext('2d')!;
          context.clearRect(0, 0, bitmapWidth, bitmapHeight);
          context.drawImage(image, 0, 0, bitmapWidth, bitmapHeight);
          URL.revokeObjectURL(url);
          resolve();
        };
        image.onerror = reject;
        image.src = url;
      });
    } catch (error) {
      console.error(`Failed to render thumbnail ${pageNum}`, error);
      state.thumbnailRendered = false;
    }
  }

  private scheduleSelectionUpdate(): void {
    this.cancelSelectionUpdate();
    this.selectionUpdateTimer = window.setTimeout(() => {
      this.selectionUpdateTimer = undefined;
      this.handleSelection();
    }, 40);
  }

  private cancelSelectionUpdate(): void {
    if (this.selectionUpdateTimer === undefined) return;
    window.clearTimeout(this.selectionUpdateTimer);
    this.selectionUpdateTimer = undefined;
  }

  private handleSelection(): void {
    const current = this.selectionAnchorFromNativeRange();
    if (!current) {
      this.clearSelection();
      return;
    }

    const { anchor, range } = current;
    this.latestSelectionAnchor = anchor;
    vscode.postMessage({ type: 'selectionChanged', anchor });
    if (this.directHighlight) {
      window.getSelection()?.removeAllRanges();
      this.clearSelection();
      vscode.postMessage({
        type: 'selectionAction',
        action: 'highlight',
        anchor: { ...anchor, highlightColor: this.selectedHighlightColor },
      });
      return;
    }
    this.showSelectionToolbar(anchor, range.getBoundingClientRect());
  }

  private selectionAnchorFromNativeRange(): { anchor: PdfAnchor; range: Range } | undefined {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return undefined;
    }
    const range = selection.getRangeAt(0);
    const nativeText = normalizeSearchText(selection.toString(), true, true);

    const startSpan = closestTextSpan(range.startContainer);
    const endSpan = closestTextSpan(range.endContainer);
    if (!startSpan || !endSpan) {
      return undefined;
    }

    const startLayer = startSpan.closest<HTMLElement>('.text-layer');
    const endLayer = endSpan.closest<HTMLElement>('.text-layer');
    if (!startLayer || startLayer !== endLayer) {
      return undefined;
    }

    const page = Number(startLayer.dataset.page ?? '1');
    const pageWrapper = startLayer.closest<HTMLElement>('.page-wrapper');
    const pageBounds = pageWrapper?.getBoundingClientRect();
    const rects = pageBounds
      ? Array.from(range.getClientRects())
        .filter(rect => rect.width > 0 && rect.height > 0)
        .map(rect => [
          roundPdfCoordinate((rect.left - pageBounds.left) / this.scale),
          roundPdfCoordinate((rect.top - pageBounds.top) / this.scale),
          roundPdfCoordinate((rect.right - pageBounds.left) / this.scale),
          roundPdfCoordinate((rect.bottom - pageBounds.top) / this.scale),
        ] as PdfRect)
      : [];
    const startIndex = Number(startSpan.dataset.itemIndex ?? '0');
    const endIndex = Number(endSpan.dataset.itemIndex ?? String(startIndex));
    const startOffset = textOffset(range.startContainer, range.startOffset, startSpan);
    const endOffset = textOffset(range.endContainer, range.endOffset, endSpan);
    const firstTextItemIndex = Math.min(startIndex, endIndex);
    const firstCharOffset = startIndex <= endIndex ? startOffset : endOffset;
    const lastTextItemIndex = Math.max(startIndex, endIndex);
    const lastCharOffset = startIndex <= endIndex ? endOffset : startOffset;
    const textRects = this.pages.get(page)?.textRects ?? [];
    const text = pdfSearchRangeForSelection(
      textRects,
      'geometry',
      firstTextItemIndex,
      firstCharOffset,
      lastTextItemIndex,
      lastCharOffset,
    )?.text ?? nativeText;
    if (!text) return undefined;
    const textFragment = pdfTextFragmentForSelection(
      textRects,
      firstTextItemIndex,
      firstCharOffset,
      lastTextItemIndex,
      lastCharOffset,
      text,
    );
    const { textStart: _textStart, ...selectionContext } = textFragment;
    return {
      range,
      anchor: {
        page,
        textItemIndex: firstTextItemIndex,
        charOffset: firstCharOffset,
        endTextItemIndex: lastTextItemIndex,
        endCharOffset: lastCharOffset,
        length: startIndex === endIndex ? Math.abs(endOffset - startOffset) : 0,
        rects,
        snippet: text,
        ...selectionContext,
        textFragment,
      },
    };
  }

  private clearSelection(): void {
    this.cancelSelectionUpdate();
    document.getElementById('selection-toolbar')?.remove();
    this.latestSelectionAnchor = null;
    vscode.postMessage({ type: 'selectionChanged' });
  }

  private handleContextMenu(event: MouseEvent): void {
    const page = this.pageNumberForContextMenuTarget(event.target);
    if (!page) return;

    this.cancelSelectionUpdate();
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('selection-toolbar')?.remove();

    const current = this.selectionAnchorFromNativeRange();
    if (
      current
      && current.anchor.page === page
      && this.contextMenuTargetsSelection(event, current.range)
    ) {
      if (!samePdfSelectionRange(this.latestSelectionAnchor, current.anchor)) {
        vscode.postMessage({ type: 'selectionChanged', anchor: current.anchor });
      }
      this.latestSelectionAnchor = current.anchor;
      this.showSelectionContextMenu(event.clientX, event.clientY, current.anchor);
      return;
    }
    if (this.latestSelectionAnchor) this.clearSelection();

    showObsidianContextMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      items: [{
        label: 'Copy link to page',
        onSelect: () => vscode.postMessage({ type: 'copyPageLink', page }),
      }],
    });
  }

  private contextMenuTargetsSelection(event: MouseEvent, range: Range): boolean {
    return Array.from(range.getClientRects()).some(rect =>
      rect.width > 0
      && rect.height > 0
      && event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom
    );
  }

  private pageNumberForContextMenuTarget(target: EventTarget | null): number | undefined {
    if (!(target instanceof Element)) return undefined;
    const wrapper = target.closest<HTMLElement>('.page-wrapper');
    if (!wrapper || !this.pageContainer.contains(wrapper)) return undefined;
    const page = Number(wrapper.dataset.page);
    return Number.isSafeInteger(page) && page > 0 && this.pages.has(page) ? page : undefined;
  }

  private showSelectionContextMenu(clientX: number, clientY: number, anchor: PdfAnchor): void {
    const postSelectionAction = (
      action: 'copyLink' | 'insertLink' | 'copyQuoteAndLink' | 'insertQuoteAndLink' | 'highlight',
    ) => {
      const actionAnchor = action === 'highlight'
        ? { ...anchor, highlightColor: this.selectedHighlightColor }
        : anchor;
      if (action === 'highlight') {
        window.getSelection()?.removeAllRanges();
        this.clearSelection();
      }
      vscode.postMessage({ type: 'selectionAction', action, anchor: actionAnchor });
    };

    showObsidianContextMenu({
      clientX,
      clientY,
      items: [
        { label: 'Look up ...', onSelect: () => vscode.postMessage({ type: 'lookupSelection', text: anchor.snippet }) },
        { label: 'Ask about selection…', onSelect: () => this.openAskPdfForSelection(anchor) },
        { type: 'separator' },
        { label: 'Copy link to selection', onSelect: () => postSelectionAction('copyLink') },
        { label: 'Highlight selection', onSelect: () => postSelectionAction('highlight') },
        { label: 'Copy selected text', onSelect: () => vscode.postMessage({ type: 'copyText', text: anchor.snippet }) },
        { label: 'Copy quote and link', onSelect: () => postSelectionAction('copyQuoteAndLink') },
        { type: 'separator' },
        { label: 'Insert link', onSelect: () => postSelectionAction('insertLink') },
        { label: 'Insert quote and link', onSelect: () => postSelectionAction('insertQuoteAndLink') },
      ],
    });
  }

  private openAskPdfForNativeSelection(): void {
    const current = this.selectionAnchorFromNativeRange();
    if (!current) {
      this.askPanel.showSelectionError('Select text on one page');
      return;
    }
    this.openAskPdfForSelection(current.anchor);
  }

  private openAskPdfForSelection(anchor: PdfAnchor): void {
    const rects = validPdfRects(anchor.rects);
    if (!anchor.snippet?.trim() || !rects.length) {
      this.askPanel.showSelectionError('Select text on one page');
      return;
    }
    const selection: PdfAskSelection = {
      page: anchor.page,
      snippet: anchor.snippet,
      quote: anchor.snippet,
      rects,
      ...(anchor.prefix ? { prefix: anchor.prefix } : {}),
      ...(anchor.suffix ? { suffix: anchor.suffix } : {}),
      ...(anchor.textItemIndex !== undefined ? { textItemIndex: anchor.textItemIndex } : {}),
      ...(anchor.charOffset !== undefined ? { charOffset: anchor.charOffset } : {}),
      ...(anchor.endTextItemIndex !== undefined ? { endTextItemIndex: anchor.endTextItemIndex } : {}),
      ...(anchor.endCharOffset !== undefined ? { endCharOffset: anchor.endCharOffset } : {}),
    };
    this.askPanel.openForSelection(selection);
    window.getSelection()?.removeAllRanges();
    this.clearSelection();
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
        const actionAnchor = action === 'highlight'
          ? { ...anchor, highlightColor: this.selectedHighlightColor }
          : anchor;
        if (action === 'highlight') {
          window.getSelection()?.removeAllRanges();
          this.clearSelection();
        }
        vscode.postMessage({ type: 'selectionAction', action, anchor: actionAnchor });
        toolbar.remove();
      });
      toolbar.appendChild(button);
      return button;
    };

    addButton(
      this.copyLinkFormat === 'quote' ? 'Copy Quote and Link' : 'Copy Link',
      this.copyLinkFormat === 'quote' ? 'copyQuoteAndLink' : 'copyLink',
    );
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
        const actionAnchor = action === 'highlight'
          ? { ...anchor, highlightColor: this.selectedHighlightColor }
          : anchor;
        vscode.postMessage({ type: 'selectionAction', action, anchor: actionAnchor });
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
    await this.loadTextRects(page);
    this.updatePageInfo();
    const selectorSegments = anchor.textFragment
      ? segmentsForPdfTextFragment(page.textRects, anchor.textFragment)
      : undefined;
    const highlighted = selectorSegments
      ? selectorSegments.length > 0
        ? this.flashAnchor(anchor, selectorSegments)
        : undefined
      : anchorHasSelection(anchor)
        ? this.flashAnchor(anchor)
        : undefined;
    if (!highlighted && anchor.textFragment) {
      page.highlightLayer.querySelectorAll('.anchor-highlight').forEach(element => element.remove());
    }
    (highlighted ?? page.wrapper).scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }

  private flashAnchor(anchor: PdfAnchor, segments?: PdfSearchSegment[]): HTMLElement | undefined {
    const page = this.pages.get(anchor.page);
    if (!page) return undefined;
    page.highlightLayer.querySelectorAll('.anchor-highlight').forEach(element => element.remove());
    const highlights: HTMLElement[] = [];
    const appendHighlight = (left: number, top: number, width: number, height: number): void => {
      const highlight = document.createElement('div');
      highlight.className = 'anchor-highlight';
      highlight.style.left = `${left}px`;
      highlight.style.top = `${top}px`;
      highlight.style.width = `${Math.max(1, width)}px`;
      highlight.style.height = `${Math.max(1, height)}px`;
      page.highlightLayer.appendChild(highlight);
      highlights.push(highlight);
    };

    if (segments) {
      for (const segment of segments) {
        const item = page.textRects[segment.textItemIndex];
        if (!item?.content) continue;
        const contentLength = item.content.length;
        const itemStart = Math.max(0, Math.min(segment.from, contentLength));
        const itemEnd = Math.max(itemStart, Math.min(segment.to, contentLength));
        if (itemEnd <= itemStart) continue;
        const fullWidth = item.rect.size.width * this.scale;
        const perChar = fullWidth / contentLength;
        appendHighlight(
          item.rect.origin.x * this.scale + perChar * itemStart,
          item.rect.origin.y * this.scale,
          perChar * (itemEnd - itemStart),
          item.rect.size.height * this.scale,
        );
      }
    } else {
      const exactRects = validPdfRects(anchor.rects);
      for (const rect of exactRects) {
        appendHighlight(
          rect[0] * this.scale,
          rect[1] * this.scale,
          (rect[2] - rect[0]) * this.scale,
          (rect[3] - rect[1]) * this.scale,
        );
      }
      const start = anchor.textItemIndex ?? 0;
      const end = anchor.endTextItemIndex ?? start;
      const startOffset = anchor.charOffset ?? 0;
      const endOffset = anchor.endCharOffset;

      for (let index = start; exactRects.length === 0 && index <= end; index++) {
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
        appendHighlight(
          fullLeft + perChar * itemStart,
          fullTop,
          Math.max(4, perChar * (itemEnd - itemStart)),
          fullHeight,
        );
      }
    }

    setTimeout(() => {
      page.highlightLayer.querySelectorAll('.anchor-highlight').forEach(element => element.remove());
    }, 2200);
    return highlights[0];
  }

  private drawHighlightsForPage(pageNum: number): void {
    const page = this.pages.get(pageNum);
    if (!page) return;
    page.highlightLayer.querySelectorAll('.annotation-highlight').forEach(element => element.remove());

    for (const highlight of this.highlights) {
      const anchor = highlight.anchor;
      if (anchor.page !== pageNum || !anchorHasSelection(anchor)) continue;

      const key = anchorKey(anchor);
      const exactRects = validPdfRects(anchor.rects);
      if (exactRects.length > 0) {
        for (const rect of exactRects) {
          this.appendAnnotationHighlight(
            page,
            highlight,
            anchor,
            key,
            rect[0] * this.scale,
            rect[1] * this.scale,
            (rect[2] - rect[0]) * this.scale,
            (rect[3] - rect[1]) * this.scale,
          );
        }
        continue;
      }
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
        this.appendAnnotationHighlight(
          page,
          highlight,
          anchor,
          key,
          fullLeft + perChar * itemStart,
          fullTop,
          Math.max(4, perChar * (itemEnd - itemStart)),
          fullHeight,
        );
      }
    }
  }

  private appendAnnotationHighlight(
    page: PageState,
    highlight: HighlightSpec,
    anchor: PdfAnchor,
    key: string,
    left: number,
    top: number,
    width: number,
    height: number,
  ): void {
    const element = document.createElement('div');
    element.className = `annotation-highlight ${highlight.kind}`;
    const color = normalizeHighlightColor(anchor.highlightColor)
      ?? (highlight.kind === 'referenced' ? 'green' : 'yellow');
    element.dataset.highlightColor = color;
    element.style.backgroundColor = HIGHLIGHT_COLORS[color];
    element.dataset.anchorKey = key;
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = `${Math.max(1, width)}px`;
    element.style.height = `${Math.max(1, height)}px`;
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

  private drawDiscussionMarkersForPage(pageNum: number): void {
    const page = this.pages.get(pageNum);
    if (!page?.rendered) return;
    this.askPanel.renderMarkersForPage(pageNum, page.highlightLayer, this.scale);
  }

  private redrawAllDiscussionMarkers(): void {
    for (const [pageNum, page] of this.pages) {
      if (page.rendered) this.drawDiscussionMarkersForPage(pageNum);
    }
  }

  private drawSearchHighlightsForPage(pageNum: number): void {
    const page = this.pages.get(pageNum);
    if (!page?.textRects.length) return;
    page.highlightLayer.querySelectorAll('.pdf-search-match').forEach(element => element.remove());

    this.searchMatches.forEach((match, searchIndex) => {
      if (match.page !== pageNum) return;
      if (!this.highlightAllSearchMatches && searchIndex !== this.selectedSearchIndex) return;
      for (const segment of match.segments) {
        const item = page.textRects[segment.textItemIndex];
        if (!item?.content) continue;
        const contentLength = item.content.length;
        const itemStart = Math.max(0, Math.min(segment.from, contentLength));
        const itemEnd = Math.max(itemStart, Math.min(segment.to, contentLength));
        if (itemEnd <= itemStart) continue;

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
      }
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
      if (event.key === 'Escape') {
        event.preventDefault();
        this.dismissPopover();
      }
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

  private async goToPage(page: number): Promise<boolean> {
    if (!pdfDoc) return false;
    const runId = ++this.pageNavigationRunId;
    const target = Math.max(1, Math.min(pdfDoc.pageCount, page));
    this.currentPage = target;
    this.applyViewMode();
    await this.renderVisiblePages();
    if (runId !== this.pageNavigationRunId) return false;
    this.pages.get(target)?.wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.updatePageInfo();
    return true;
  }

  private zoom(delta: number): void {
    this.fitMode = 'custom';
    this.scale = Math.max(0.5, Math.min(3.5, this.scale + delta));
    void this.rerender();
  }

  private fitWidth(): void {
    this.fitMode = 'width';
    void this.reapplyFitMode();
  }

  private fitHeight(): void {
    this.fitMode = 'height';
    void this.reapplyFitMode();
  }

  private fitPage(): void {
    this.fitMode = 'page';
    void this.reapplyFitMode();
  }

  private async reapplyFitMode(): Promise<void> {
    const first = this.pages.get(1);
    if (!first || this.fitMode === 'custom') return;
    const pagesPerRow = this.twoPageView ? 2 : 1;
    const spreadGap = this.twoPageView ? 18 : 0;
    const widthScale = (this.container.clientWidth - 36 - spreadGap) / (first.pageObj.size.width * pagesPerRow);
    const heightScale = (this.container.clientHeight - 36) / first.pageObj.size.height;
    const nextScale = this.fitMode === 'width'
      ? widthScale
      : this.fitMode === 'height'
        ? heightScale
        : Math.min(widthScale, heightScale);
    this.scale = clamp(nextScale, 0.5, 3.5);
    await this.rerender();
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
    this.redrawAllDiscussionMarkers();
    this.updatePageInfo();
  }

  private updatePageInfo(): void {
    const total = pdfDoc?.pageCount ?? 0;
    this.pageInfo.textContent = total ? `Page ${this.currentPage} / ${total}  ${Math.round(this.scale * 100)}%` : '';
    this.pageInput.value = String(this.currentPage);
    this.pageInput.max = String(Math.max(1, total));
    this.pageInput.setAttribute('aria-valuenow', String(this.currentPage));
    this.pageTotal.textContent = `of ${total}`;
    const zoomPercentage = Math.round(this.scale * 100);
    this.zoomInput.value = String(zoomPercentage);
    this.zoomInput.setAttribute('aria-valuenow', String(zoomPercentage));
    this.zoomInput.setAttribute('aria-valuetext', `${zoomPercentage}%`);
    const previous = document.getElementById('prev') as HTMLButtonElement | null;
    const next = document.getElementById('next') as HTMLButtonElement | null;
    if (previous) previous.disabled = this.currentPage <= 1;
    if (next) next.disabled = total > 0 && this.currentPage >= total;
    for (const page of this.pages.values()) {
      if (page.pageNum === this.currentPage) page.thumbnailButton.setAttribute('aria-current', 'page');
      else page.thumbnailButton.removeAttribute('aria-current');
    }
    if (!this.sidebar.hidden) {
      this.pages.get(this.currentPage)?.thumbnailButton.scrollIntoView({ block: 'nearest' });
    }
    this.updateToolbarState();
    vscode.postMessage({ type: 'pageChanged', page: this.currentPage, totalPages: total });
  }

  private async toggleContinuousScroll(): Promise<void> {
    await this.setScrollMode(this.continuousScroll ? 'in-page' : 'vertical');
  }

  private async setScrollMode(mode: 'vertical' | 'horizontal' | 'in-page' | 'wrapped'): Promise<void> {
    this.scrollMode = mode;
    this.continuousScroll = mode !== 'in-page';
    this.applyViewMode();
    await this.renderVisiblePages();
    this.pages.get(this.currentPage)?.wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.updatePageInfo();
  }

  private async toggleTwoPageView(): Promise<void> {
    await this.setSpreadMode(!this.twoPageView, this.spreadParity);
  }

  private async setSpreadMode(twoPage: boolean, parity: 'odd' | 'even'): Promise<void> {
    this.twoPageView = twoPage;
    this.spreadParity = parity;
    if (this.fitMode !== 'custom') {
      await this.reapplyFitMode();
      this.pages.get(this.currentPage)?.wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
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
    if (this.spreadParity === 'even' && start === 1) return [1];
    return [start, start + 1].filter(page => page <= pdfDoc.pageCount);
  }

  private spreadStartFor(page: number): number {
    if (this.spreadParity === 'even') {
      if (page <= 1) return 1;
      return page % 2 === 0 ? page : page - 1;
    }
    return Math.max(1, page % 2 === 0 ? page - 1 : page);
  }

  private applyViewMode(): void {
    this.pageContainer.classList.toggle('paginated', !this.continuousScroll);
    this.pageContainer.classList.toggle('two-page', this.twoPageView);
    this.pageContainer.classList.toggle('scroll-horizontal', this.scrollMode === 'horizontal');
    this.pageContainer.classList.toggle('scroll-wrapped', this.scrollMode === 'wrapped');
    this.pageContainer.dataset.spreadParity = this.spreadParity;
    const visible = new Set(this.visiblePageNumbers());
    for (const page of this.pages.values()) {
      page.wrapper.style.display = this.continuousScroll || visible.has(page.pageNum) ? '' : 'none';
      page.wrapper.style.gridColumn = '';
      page.wrapper.style.gridRow = '';
      if (this.twoPageView && this.scrollMode !== 'horizontal' && this.scrollMode !== 'wrapped') {
        const position = spreadGridPosition(page.pageNum, this.spreadParity);
        page.wrapper.style.gridColumn = String(position.column);
        page.wrapper.style.gridRow = String(this.continuousScroll ? position.row : 1);
      }
    }
    this.updateToolbarState();
  }

  private updateToolbarState(): void {
    const checkedActions = new Set<string>();
    if (this.fitMode !== 'custom') checkedActions.add(`fit-${this.fitMode}`);
    checkedActions.add(`scroll-${this.scrollMode}`);
    checkedActions.add(this.twoPageView ? `spread-${this.spreadParity}` : 'spread-single');
    if (this.adaptToTheme) checkedActions.add('adapt-theme');
    for (const button of Array.from(this.displayMenu.querySelectorAll<HTMLButtonElement>('[data-display-action][aria-checked]'))) {
      button.setAttribute('aria-checked', String(checkedActions.has(button.dataset.displayAction ?? '')));
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

function samePdfSelectionRange(left: PdfAnchor | null, right: PdfAnchor): boolean {
  return Boolean(
    left
    && left.page === right.page
    && left.textItemIndex === right.textItemIndex
    && left.charOffset === right.charOffset
    && left.endTextItemIndex === right.endTextItemIndex
    && left.endCharOffset === right.endCharOffset
    && left.snippet === right.snippet
  );
}

interface PdfSelectionSearchRange {
  index: PdfSearchIndexChar[];
  from: number;
  to: number;
  text: string;
}

type PdfItemGapMode = boolean | 'geometry';

function pdfTextFragmentForSelection(
  textRects: any[],
  startTextItemIndex: number,
  startOffset: number,
  endTextItemIndex: number,
  endOffset: number,
  selectedText: string,
): PdfTextFragment {
  const normalizedSelection = normalizeSearchText(selectedText, true, true);
  const selectionRange = ([true, false, 'geometry'] satisfies PdfItemGapMode[])
    .map(insertItemGaps => pdfSearchRangeForSelection(
      textRects,
      insertItemGaps,
      startTextItemIndex,
      startOffset,
      endTextItemIndex,
      endOffset,
    ))
    .find((candidate): candidate is PdfSelectionSearchRange =>
      candidate?.text === normalizedSelection
    );
  if (!selectionRange) return { textStart: normalizedSelection };

  const pageText = selectionRange.index.map(char => char.value).join('');
  const prefix = boundedTextFragmentPrefix(pageText.slice(0, selectionRange.from));
  const suffix = boundedTextFragmentSuffix(pageText.slice(selectionRange.to));
  return {
    textStart: normalizedSelection,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  };
}

function pdfSearchRangeForSelection(
  textRects: any[],
  itemGapMode: PdfItemGapMode,
  startTextItemIndex: number,
  startOffset: number,
  endTextItemIndex: number,
  endOffset: number,
): PdfSelectionSearchRange | undefined {
  const index = buildPdfSearchIndex(textRects, itemGapMode, false, true, true);
  let from = -1;
  let to = -1;
  for (let cursor = 0; cursor < index.length; cursor++) {
    const char = index[cursor];
    if (typeof char?.textItemIndex !== 'number' || typeof char.offset !== 'number') continue;
    const afterStart = char.textItemIndex > startTextItemIndex
      || (char.textItemIndex === startTextItemIndex && char.offset >= startOffset);
    const beforeEnd = char.textItemIndex < endTextItemIndex
      || (char.textItemIndex === endTextItemIndex && char.offset < endOffset);
    if (!afterStart || !beforeEnd) continue;
    if (from < 0) from = cursor;
    to = cursor + 1;
  }
  if (from < 0 || to <= from) return undefined;
  while (from < to && index[from]?.value === ' ') from++;
  while (to > from && index[to - 1]?.value === ' ') to--;
  if (from >= to) return undefined;
  return {
    index,
    from,
    to,
    text: index.slice(from, to).map(char => char.value).join(''),
  };
}

function boundedTextFragmentPrefix(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  const characters = Array.from(normalized);
  if (characters.length <= PDF_TEXT_FRAGMENT_CONTEXT_LENGTH) return normalized;
  const start = characters.length - PDF_TEXT_FRAGMENT_CONTEXT_LENGTH;
  let bounded = characters.slice(start);
  if (!isSearchWhitespace(characters[start - 1] ?? '') && !isSearchWhitespace(bounded[0] ?? '')) {
    const boundary = bounded.findIndex(isSearchWhitespace);
    bounded = boundary >= 0 ? bounded.slice(boundary + 1) : [];
  }
  const result = bounded.join('').trim();
  return result || undefined;
}

function boundedTextFragmentSuffix(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  const characters = Array.from(normalized);
  if (characters.length <= PDF_TEXT_FRAGMENT_CONTEXT_LENGTH) return normalized;
  let bounded = characters.slice(0, PDF_TEXT_FRAGMENT_CONTEXT_LENGTH);
  if (!isSearchWhitespace(bounded[bounded.length - 1] ?? '')
    && !isSearchWhitespace(characters[PDF_TEXT_FRAGMENT_CONTEXT_LENGTH] ?? '')) {
    let boundary = bounded.length - 1;
    while (boundary >= 0 && !isSearchWhitespace(bounded[boundary] ?? '')) boundary--;
    bounded = boundary >= 0 ? bounded.slice(0, boundary) : [];
  }
  const result = bounded.join('').trim();
  return result || undefined;
}

function segmentsForPdfTextFragment(textRects: any[], fragment: PdfTextFragment): PdfSearchSegment[] {
  const textStart = normalizeSearchText(fragment.textStart, false, true);
  if (!textStart) return [];
  const textEnd = typeof fragment.textEnd === 'string'
    ? normalizeSearchText(fragment.textEnd, false, true)
    : '';
  const prefix = typeof fragment.prefix === 'string'
    ? normalizeSearchText(fragment.prefix, false, true)
    : '';
  const suffix = typeof fragment.suffix === 'string'
    ? normalizeSearchText(fragment.suffix, false, true)
    : '';
  for (const itemGapMode of ([true, false, 'geometry'] satisfies PdfItemGapMode[])) {
    const index = buildPdfSearchIndex(textRects, itemGapMode, false, false, true);
    const haystack = index.map(char => char.value).join('');
    let from = haystack.indexOf(textStart);
    while (from >= 0) {
      const startTo = from + textStart.length;
      const prefixMatches = !prefix || haystack.slice(0, from).trimEnd().endsWith(prefix);
      if (prefixMatches) {
        let endFrom = textEnd ? haystack.indexOf(textEnd, startTo) : startTo;
        while (endFrom >= 0) {
          const to = textEnd ? endFrom + textEnd.length : startTo;
          const suffixMatches = !suffix || haystack.slice(to).trimStart().startsWith(suffix);
          if (suffixMatches) {
            const segments = segmentsForSearchRange(index, from, to);
            if (segments.length > 0) return segments;
          }
          if (!textEnd) break;
          endFrom = haystack.indexOf(textEnd, endFrom + 1);
        }
      }
      from = haystack.indexOf(textStart, from + 1);
    }
  }
  return [];
}

function buildPdfSearchIndex(
  textRects: any[],
  itemGapMode: PdfItemGapMode,
  skipNonAsciiArtifacts: boolean,
  matchCase: boolean,
  matchDiacritics: boolean,
): PdfSearchIndexChar[] {
  const index: PdfSearchIndexChar[] = [];
  let previousTextItemIndex: number | undefined;
  for (let itemIndex = 0; itemIndex < textRects.length; itemIndex++) {
    const content = String(textRects[itemIndex]?.content ?? '');
    if (!content) continue;
    const firstValue = firstSearchValue(content, skipNonAsciiArtifacts, matchCase, matchDiacritics);
    if (!firstValue) continue;
    const insertGap = itemGapMode === true
      || (itemGapMode === 'geometry'
        && previousTextItemIndex !== undefined
        && shouldInsertGeometryGap(textRects[previousTextItemIndex], textRects[itemIndex]));
    if (insertGap && shouldInsertSearchGap(index, firstValue)) {
      index.push({ value: ' ' });
    }
    for (let offset = 0; offset < content.length; offset++) {
      appendSearchChar(index, content.charAt(offset), itemIndex, offset, skipNonAsciiArtifacts, matchCase, matchDiacritics);
    }
    previousTextItemIndex = itemIndex;
  }
  while (index.length) {
    const last = index[index.length - 1];
    if (!last || last.value !== ' ') break;
    index.pop();
  }
  return index;
}

function firstSearchValue(content: string, skipNonAsciiArtifacts: boolean, matchCase: boolean, matchDiacritics: boolean): string | undefined {
  for (let offset = 0; offset < content.length; offset++) {
    const value = searchCharValue(content.charAt(offset), skipNonAsciiArtifacts, matchCase, matchDiacritics);
    if (value) return value.charAt(0);
  }
  return undefined;
}

function shouldInsertSearchGap(index: PdfSearchIndexChar[], nextValue: string): boolean {
  if (!index.length) return false;
  const last = index[index.length - 1];
  if (!last || last.value === ' ') return false;
  return nextValue !== ' ';
}

function shouldInsertGeometryGap(previousItem: any, nextItem: any): boolean {
  const previousContent = String(previousItem?.content ?? '').trimEnd();
  if (/[-\u00ad\u2010\u2011]$/u.test(previousContent)) return false;

  const previousRect = finitePdfTextRect(previousItem?.rect);
  const nextRect = finitePdfTextRect(nextItem?.rect);
  if (!previousRect || !nextRect) return false;

  const previousCenterY = previousRect.top + previousRect.height / 2;
  const nextCenterY = nextRect.top + nextRect.height / 2;
  const sameLineTolerance = Math.max(1, Math.min(previousRect.height, nextRect.height) * 0.5);
  if (Math.abs(previousCenterY - nextCenterY) > sameLineTolerance) return true;

  const horizontalGap = Math.max(
    nextRect.left - (previousRect.left + previousRect.width),
    previousRect.left - (nextRect.left + nextRect.width),
    0,
  );
  const wordGapThreshold = Math.max(0.5, Math.min(previousRect.height, nextRect.height) * 0.18);
  return horizontalGap > wordGapThreshold;
}

function finitePdfTextRect(value: any): { left: number; top: number; width: number; height: number } | undefined {
  const left = Number(value?.origin?.x);
  const top = Number(value?.origin?.y);
  const width = Number(value?.size?.width);
  const height = Number(value?.size?.height);
  if (![left, top, width, height].every(Number.isFinite) || width < 0 || height <= 0) return undefined;
  return { left, top, width, height };
}

function appendSearchChar(
  index: PdfSearchIndexChar[],
  char: string,
  textItemIndex: number,
  offset: number,
  skipNonAsciiArtifacts: boolean,
  matchCase: boolean,
  matchDiacritics: boolean,
): void {
  const value = searchCharValue(char, skipNonAsciiArtifacts, matchCase, matchDiacritics);
  if (!value) return;
  for (let valueOffset = 0; valueOffset < value.length; valueOffset++) {
    const outputUnit = value.charAt(valueOffset);
    const last = index[index.length - 1];
    if (outputUnit === ' ' && (!last || last.value === ' ')) continue;
    index.push({ value: outputUnit, textItemIndex, offset });
  }
}

function searchCharValue(char: string, skipNonAsciiArtifacts: boolean, matchCase: boolean, matchDiacritics: boolean): string | undefined {
  if (char === '\u00ad') return undefined;
  if (isSearchWhitespace(char)) return ' ';
  const codePoint = char.codePointAt(0);
  if (typeof codePoint !== 'number') return undefined;
  if (isPdfExtractionArtifact(codePoint, skipNonAsciiArtifacts)) return undefined;
  const normalized = matchDiacritics ? char : stripSearchDiacritics(char);
  if (!normalized) return undefined;
  return matchCase ? normalized : foldSearchCase(normalized);
}

function foldSearchCase(text: string): string {
  return text.toLowerCase().replace(/\u03c2/g, '\u03c3');
}

function isPdfExtractionArtifact(codePoint: number, skipNonAsciiArtifacts: boolean): boolean {
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  if (codePoint >= 0xe000 && codePoint <= 0xf8ff) return true;
  return skipNonAsciiArtifacts && codePoint > 0x7f;
}

function segmentsForSearchRange(index: PdfSearchIndexChar[], from: number, to: number): PdfSearchSegment[] {
  const segments: PdfSearchSegment[] = [];
  for (let cursor = from; cursor < to; cursor++) {
    const char = index[cursor];
    if (typeof char?.textItemIndex !== 'number' || typeof char.offset !== 'number') continue;
    const last = segments[segments.length - 1];
    if (last && last.textItemIndex === char.textItemIndex && char.offset <= last.to) {
      last.to = Math.max(last.to, char.offset + 1);
    } else {
      segments.push({
        textItemIndex: char.textItemIndex,
        from: char.offset,
        to: char.offset + 1,
      });
    }
  }
  return segments;
}

function normalizeSearchText(text: string, matchCase: boolean, matchDiacritics: boolean): string {
  const output: string[] = [];
  for (let offset = 0; offset < text.length; offset++) {
    const value = searchCharValue(text.charAt(offset), false, matchCase, matchDiacritics);
    if (!value) continue;
    for (let valueOffset = 0; valueOffset < value.length; valueOffset++) {
      const outputUnit = value.charAt(valueOffset);
      if (outputUnit === ' ' && (!output.length || output[output.length - 1] === ' ')) continue;
      output.push(outputUnit);
    }
  }
  while (output[0] === ' ') output.shift();
  while (output[output.length - 1] === ' ') output.pop();
  return output.join('');
}

function stripSearchDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '');
}

function isWholeWordSearchMatch(haystack: string, from: number, length: number): boolean {
  const before = from > 0 ? haystack.charAt(from - 1) : '';
  const after = from + length < haystack.length ? haystack.charAt(from + length) : '';
  return !isSearchWordCharacter(before) && !isSearchWordCharacter(after);
}

function isSearchWordCharacter(char: string): boolean {
  return Boolean(char) && /[\p{L}\p{N}_]/u.test(char);
}

function isAsciiSearchQuery(text: string): boolean {
  return /^[\x00-\x7f]*$/.test(text);
}

function isSearchWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function anchorKey(anchor: PdfAnchor): string {
  if (anchor.id) return anchor.id;
  return [
    anchor.page,
    anchor.textItemIndex ?? 0,
    anchor.charOffset ?? 0,
    anchor.endTextItemIndex ?? anchor.textItemIndex ?? 0,
    anchor.endCharOffset ?? ((anchor.charOffset ?? 0) + (anchor.length ?? 0)),
    JSON.stringify(validPdfRects(anchor.rects)),
  ].join(':');
}

function anchorHasSelection(anchor: PdfAnchor): boolean {
  return validPdfRects(anchor.rects).length > 0 || (
    typeof anchor.textItemIndex === 'number' &&
    typeof anchor.charOffset === 'number' &&
    (
      (typeof anchor.endTextItemIndex === 'number' && typeof anchor.endCharOffset === 'number') ||
      Number(anchor.length ?? 0) > 0
    )
  );
}

function validPdfRects(rects: unknown): PdfRect[] {
  if (!Array.isArray(rects)) return [];
  return rects.filter((rect): rect is PdfRect =>
    Array.isArray(rect)
    && rect.length === 4
    && rect.every(value => typeof value === 'number' && Number.isFinite(value))
    && rect[2]! > rect[0]!
    && rect[3]! > rect[1]!
  );
}

function alignPdfTextSpanToRect(
  span: HTMLElement,
  glyphs: HTMLElement,
  target: { left: number; top: number; width: number; height: number },
): void {
  if (![target.left, target.top, target.width, target.height].every(Number.isFinite)
    || target.width <= 0
    || target.height <= 0
    || !span.textContent) return;

  const range = document.createRange();
  range.selectNodeContents(glyphs);
  const spanBounds = span.getBoundingClientRect();
  const textBounds = range.getBoundingClientRect();
  range.detach();
  if (textBounds.width <= 0 || textBounds.height <= 0) return;

  const scaleX = clamp(target.width / textBounds.width, 0.05, 20);
  const scaleY = clamp(target.height / textBounds.height, 0.05, 20);
  const offsetX = textBounds.left - spanBounds.left;
  const offsetY = textBounds.top - spanBounds.top;
  glyphs.style.transform = `matrix(${[
    scaleX,
    0,
    0,
    scaleY,
    -offsetX * scaleX,
    -offsetY * scaleY,
  ].map(roundPdfCoordinate).join(', ')})`;
}

function roundPdfCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeHighlightColor(value: unknown): HighlightColor | undefined {
  return value === 'yellow' || value === 'red' || value === 'green' || value === 'purple'
    ? value
    : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function spreadGridPosition(page: number, parity: 'odd' | 'even'): { row: number; column: number } {
  if (parity === 'even') {
    if (page <= 1) return { row: 1, column: 2 };
    return {
      row: Math.floor(page / 2) + 1,
      column: page % 2 === 0 ? 1 : 2,
    };
  }
  return {
    row: Math.floor((Math.max(1, page) - 1) / 2) + 1,
    column: page % 2 === 0 ? 2 : 1,
  };
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
