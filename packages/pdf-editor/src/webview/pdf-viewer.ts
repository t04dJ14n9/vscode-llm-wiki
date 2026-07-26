// Canonical PDF webview entry shared by the combined and standalone extensions.
/// <reference path="./vscode.d.ts" />

import { createPdfiumEngine } from '@embedpdf/engines/pdfium-direct-engine';
import {
  PdfAnnotationSubtype,
  type PdfDestinationObject,
  type PdfLinkAnnoObject,
} from '@embedpdf/models';
import {
  canScrollPdfViewport,
  capturePdfViewportProgress,
  normalizePdfAnnotationRect,
  pdfDestinationViewerTarget,
  pdfInternalDestination,
  pdfNavigationTarget,
  pdfPresentationMode,
  pdfPresentationPolicy,
  pdfSpreadPageNumbers,
  restorePdfViewportProgress,
  spreadGridPosition,
  type PdfPresentationMode,
  type PdfViewportMetrics,
  type PdfViewportProgress,
} from './domain/pdfNavigation';
import {
  buildPdfSearchIndex,
  isAsciiSearchQuery,
  isWholeWordSearchMatch,
  normalizeSearchText,
  segmentsForPdfTextFragment,
  segmentsForSearchRange,
  type PdfSearchSegment,
  type PdfTextFragment,
} from './domain/pdfSearch';
import {
  buildPdfSelectionLines,
  comparePdfCarets,
  isPdfWordCharacter,
  nextSelectablePdfTextItem,
  orderedPdfCarets,
  pdfSearchRangeForSelection,
  pdfSelectionContainsPage,
  pdfTextFragmentForSelection,
  pdfTextItemsJoinWord,
  pdfTextLineItemRange,
  previousSelectablePdfTextItem,
  samePdfCaret,
  type PdfSelectionCaret,
  type PdfSelectionLine,
  type PdfSelectionState,
} from './domain/pdfSelection';
import {
  finitePdfTextRect,
  isPdfWordJoinMarker,
  normalizeBasicPdfTextRects,
  normalizePdfTextRuns,
  type PdfSelectionGlyph,
} from './domain/pdfTextExtraction';
import { createPdfPageLayout, formatCssPx, type PdfPageLayout } from './pdfLayout';
import {
  closestPdfTextSpan,
  pdfTextOffset,
  renderPdfTextLayer,
} from './pdfTextLayer';
import { showObsidianContextMenu } from './obsidianContextMenu';
import { createPdfAskPanel, type PdfAskPanel, type PdfAskSelection } from './pdfAskPanel';
import { normalizePdfTextBands, type PdfRect } from './pdfTextBands';

const vscode = acquireVsCodeApi();

type HighlightColor = 'yellow' | 'red' | 'green' | 'purple';

const PDF_PAGE_GAP_PX = 12;
const PDF_FIT_HORIZONTAL_PADDING_PX = 24;
const PDF_FIT_VERTICAL_PADDING_PX = 76;
const PDF_PINCH_COMMIT_DELAY_MS = 160;
const PDF_PAGINATED_GESTURE_IDLE_MS = 160;
const PDF_PAGINATED_AXIS_LOCK_THRESHOLD = 6;

const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: 'rgba(255, 213, 79, 0.42)',
  red: 'rgba(255, 107, 107, 0.42)',
  green: 'rgba(105, 219, 124, 0.42)',
  purple: 'rgba(177, 151, 252, 0.42)',
};

interface PdfAnchor {
  id?: string;
  page: number;
  multiPage?: boolean;
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

interface PdfSelectionDrag {
  pointerId: number;
  wrapper: HTMLElement;
  origin: PdfSelectionCaret;
  initialStart: PdfSelectionCaret;
  initialEnd: PdfSelectionCaret;
  anchor: PdfSelectionCaret;
  focus: PdfSelectionCaret;
  granularity: 'character' | 'word' | 'line';
  clientX: number;
  clientY: number;
}

interface PdfViewerStateV1 {
  version: 1;
  page: number;
  scale: number;
  fitMode: 'custom' | 'width' | 'height' | 'page';
  continuous: boolean;
  twoPage: boolean;
  spreadParity: 'odd' | 'even';
  scrollMode: 'vertical' | 'horizontal' | 'wrapped';
  adaptToTheme: boolean;
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
  selectionGlyphs: PdfSelectionGlyph[][];
  selectionLines: PdfSelectionLine[];
  renderGeneration: number;
  rendered: boolean;
  thumbnailButton: HTMLButtonElement;
  thumbnailCanvas: HTMLCanvasElement;
  thumbnailRendered: boolean;
}

interface PdfPinchZoomAnchor {
  clientX: number;
  clientY: number;
  contentX: number;
  contentY: number;
  scale: number;
  page?: number;
  pdfX?: number;
  pdfY?: number;
}

interface PdfViewLocation {
  page: number;
  pdfX: number;
  pdfY: number;
  viewportX: number;
  viewportY: number;
  fallbackScrollLeft: number;
  fallbackScrollTop: number;
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
  private readonly historyBackButton = document.getElementById('pdf-history-back') as HTMLButtonElement;
  private readonly pages = new Map<number, PageState>();
  private scale = 1;
  private currentPage = 1;
  private continuousScroll = true;
  private twoPageView = false;
  private scrollMode: 'vertical' | 'horizontal' | 'wrapped' = 'vertical';
  private spreadParity: 'odd' | 'even' = 'even';
  private fitMode: 'custom' | 'width' | 'height' | 'page' = 'page';
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
  private rerenderRunId = 0;
  private currentPageTrackingSequence = 0;
  private currentPageTrackingLock: number | undefined;
  private currentPageTrackingReleaseTimer: number | undefined;
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
  private paginatedWheelDelta = 0;
  private paginatedWheelDirection: -1 | 0 | 1 = 0;
  private paginatedWheelNavigationInFlight = false;
  private paginatedWheelAxis: 'horizontal' | 'vertical' | undefined;
  private paginatedWheelAxisDeltaX = 0;
  private paginatedWheelAxisDeltaY = 0;
  private paginatedWheelLastEventAt = 0;
  private paginatedWheelStartScrollLeft = 0;
  private paginatedWheelStartScrollTop = 0;
  private paginatedWheelPannedWithinGesture = false;
  private paginatedWheelTurnedWithinGesture = false;
  private pinchZoomTargetScale: number | undefined;
  private pinchZoomVisualScale: number | undefined;
  private pinchZoomAnchor: PdfPinchZoomAnchor | undefined;
  private pinchZoomFrame: number | undefined;
  private pinchZoomCommitTimer: number | undefined;
  private pinchZoomCommitting = false;
  private readonly pinchZoomPreviewPages = new Set<number>();
  private latestSelectionAnchor: PdfAnchor | null = null;
  private selectionUpdateTimer: number | undefined;
  private selectionState: PdfSelectionState | null = null;
  private selectionDrag: PdfSelectionDrag | null = null;
  private selectionClickCount = 0;
  private selectionLastPointerDownAt = 0;
  private selectionLastPointerDownX = Number.NaN;
  private selectionLastPointerDownY = Number.NaN;
  private selectionLastPointerDownPage = 0;
  private selectionAutoScrollFrame: number | undefined;
  private selectionToolbarPositionFrame: number | undefined;
  private readonly pdfNavigationHistory: PdfViewLocation[] = [];
  private readonly viewerResizeObserver: ResizeObserver | null;
  private readonly askPanel: PdfAskPanel;

  constructor() {
    this.restoreViewerState();
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
        const valid = normalizePdfTextBands(rects);
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
    this.setupTextSelection();
    this.historyBackButton.addEventListener('click', () => void this.goBackInPdfHistory());
    const scheduleFitForResize = () => {
      if (this.fitMode === 'custom' || !this.loaded) return;
      if (this.fitResizeTimer !== undefined) window.clearTimeout(this.fitResizeTimer);
      this.fitResizeTimer = window.setTimeout(() => {
        this.fitResizeTimer = undefined;
        void this.reapplyFitMode();
      }, 80);
    };
    window.addEventListener('resize', scheduleFitForResize);
    this.viewerResizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(scheduleFitForResize)
      : null;
    this.viewerResizeObserver?.observe(this.container);
    this.pageContainer.addEventListener('mouseup', event => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement | null)?.closest('.pdf-link-overlay')) return;
      this.scheduleSelectionUpdate();
    });
    document.addEventListener('copy', event => this.copyNativeSelection(event), true);
    this.container.addEventListener('scroll', () => {
      // Preview dismisses the transient selection controls when the document
      // moves; leaving a toolbar behind makes it appear detached from the text.
      document.getElementById('selection-toolbar')?.remove();
    }, { passive: true });
    this.container.addEventListener('wheel', event => this.handlePaginatedWheel(event), { passive: false });
    this.pageContainer.addEventListener('contextmenu', event => this.handleContextMenu(event));
    vscode.postMessage({ type: 'ready' });
  }

  private restoreViewerState(): void {
    const root = recordValue(vscode.getState());
    const stored = recordValue(root.pdfViewer);
    if (stored.version !== 1) return;
    const page = Number(stored.page);
    const scale = Number(stored.scale);
    if (Number.isInteger(page) && page > 0) this.currentPage = page;
    if (Number.isFinite(scale) && scale >= 0.1 && scale <= 3.5) this.scale = scale;
    if (stored.fitMode === 'custom' || stored.fitMode === 'width' || stored.fitMode === 'height' || stored.fitMode === 'page') {
      this.fitMode = stored.fitMode;
    }
    if (typeof stored.continuous === 'boolean') this.continuousScroll = stored.continuous;
    if (typeof stored.twoPage === 'boolean') this.twoPageView = stored.twoPage;
    if (stored.spreadParity === 'odd' || stored.spreadParity === 'even') this.spreadParity = stored.spreadParity;
    if (stored.scrollMode === 'vertical' || stored.scrollMode === 'horizontal' || stored.scrollMode === 'wrapped') {
      this.scrollMode = stored.scrollMode;
    }
    // Preview treats page count and continuity as one four-way presentation
    // choice. Older state already stores the two dimensions independently, so
    // every combination remains meaningful.
    if (!this.continuousScroll || this.twoPageView) this.scrollMode = 'vertical';
    if (this.twoPageView) this.spreadParity = 'even';
    if (typeof stored.adaptToTheme === 'boolean') this.adaptToTheme = stored.adaptToTheme;
  }

  private persistViewerState(): void {
    const root = recordValue(vscode.getState());
    const pdfViewer: PdfViewerStateV1 = {
      version: 1,
      page: this.currentPage,
      scale: this.scale,
      fitMode: this.fitMode,
      continuous: this.continuousScroll,
      twoPage: this.twoPageView,
      spreadParity: this.spreadParity,
      scrollMode: this.scrollMode,
      adaptToTheme: this.adaptToTheme,
    };
    vscode.setState({ ...root, pdfViewer });
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
      void this.commitPageInput().finally(() => {
        // Preview returns keyboard focus to the document after a page number
        // is committed, so Option+Arrow can turn the next page immediately.
        this.container.tabIndex = -1;
        this.container.focus({ preventScroll: true });
      });
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
      this.zoomInput.blur();
      // Return the keyboard context to the document after committing zoom so
      // Preview-style Option+Arrow page turns work immediately.
      this.container.tabIndex = -1;
      this.container.focus({ preventScroll: true });
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
      if (
        event.altKey
        && !event.metaKey
        && !event.ctrlKey
        && !event.shiftKey
        && !isEditableTarget(event.target)
        && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')
      ) {
        event.preventDefault();
        void this.navigate(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (
        !event.altKey
        && !event.metaKey
        && !event.ctrlKey
        && !event.shiftKey
        && !isEditableTarget(event.target)
        && !this.continuousScroll
        && (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown')
        && this.handlePaginatedArrowKey(event)
      ) {
        return;
      }
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
    this.cancelPinchZoom();
    const nextScale = Math.max(0.1, Math.min(3.5, percentage / 100));
    // Pressing Enter commits and then blurs the field. Treat the blur as a no-op
    // so two overlapping rerenders cannot tear down a selection restored by the
    // first one.
    if (this.fitMode === 'custom' && Math.abs(this.scale - nextScale) < 0.0001) {
      this.updatePageInfo();
      return;
    }
    this.fitMode = 'custom';
    this.scale = nextScale;
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

  private setupTextSelection(): void {
    this.pageContainer.addEventListener('pointerdown', event => {
      if (this.rectangleSelection || event.button !== 0 || event.pointerType === 'touch') return;
      if ((event.target as HTMLElement | null)?.closest('.pdf-link-overlay')) return;
      const layer = (event.target as HTMLElement | null)?.closest<HTMLElement>('.text-layer');
      const wrapper = layer?.closest<HTMLElement>('.page-wrapper');
      const page = Number(layer?.dataset.page ?? 0);
      const state = this.pages.get(page);
      if (!layer || !wrapper || !state?.rendered) return;
      const caret = this.hitTestSelectionCaret(state, event.clientX, event.clientY);
      if (!caret) return;

      event.preventDefault();
      document.getElementById('selection-toolbar')?.remove();
      const now = performance.now();
      const repeatsPreviousClick = page === this.selectionLastPointerDownPage
        && now - this.selectionLastPointerDownAt <= 600
        && Math.hypot(
          event.clientX - this.selectionLastPointerDownX,
          event.clientY - this.selectionLastPointerDownY,
        ) <= 6;
      const inferredClickCount = repeatsPreviousClick ? this.selectionClickCount + 1 : 1;
      const clickCount = Math.max(Number(event.detail) || 1, inferredClickCount);
      this.selectionClickCount = clickCount;
      this.selectionLastPointerDownAt = now;
      this.selectionLastPointerDownX = event.clientX;
      this.selectionLastPointerDownY = event.clientY;
      this.selectionLastPointerDownPage = page;
      const granularity = clickCount >= 3
        ? 'line'
        : clickCount === 2
          ? 'word'
          : 'character';
      const initial = granularity === 'line'
        ? this.lineSelectionAtCaret(state, caret)
        : granularity === 'word'
          ? this.wordSelectionAtCaret(state, caret)
          : undefined;
      const anchor = initial?.anchor ?? caret;
      const focus = initial?.focus ?? caret;
      this.selectionDrag = {
        pointerId: event.pointerId,
        wrapper,
        origin: caret,
        initialStart: anchor,
        initialEnd: focus,
        anchor,
        focus,
        granularity,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      this.setSelectionState({ page, anchor, focus });
      try {
        wrapper.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events used by tests do not own an active pointer.
      }
    }, true);

    this.pageContainer.addEventListener('pointermove', event => {
      const drag = this.selectionDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      this.updateSelectionDragAtPoint(drag, event.clientX, event.clientY);
      this.startSelectionAutoScroll();
    }, true);

    const finish = (event: PointerEvent) => {
      const drag = this.selectionDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.clientX = event.clientX;
      drag.clientY = event.clientY;
      this.updateSelectionDragAtPoint(drag, event.clientX, event.clientY);
      try {
        drag.wrapper.releasePointerCapture(event.pointerId);
      } catch {
        // The pointer may already have been released.
      }
      this.selectionDrag = null;
      this.stopSelectionAutoScroll();
      if (samePdfCaret(drag.anchor, drag.focus)) {
        window.getSelection()?.removeAllRanges();
        this.clearSelection();
      } else {
        this.scheduleSelectionUpdate();
      }
    };
    this.pageContainer.addEventListener('pointerup', finish, true);
    this.pageContainer.addEventListener('pointercancel', event => {
      if (this.selectionDrag?.pointerId !== event.pointerId) return;
      this.selectionDrag = null;
      this.stopSelectionAutoScroll();
    }, true);
  }

  private updateSelectionDragAtPoint(drag: PdfSelectionDrag, clientX: number, clientY: number): void {
    const state = this.pageStateForSelectionPoint(clientX, clientY, drag.focus.page);
    if (!state?.rendered) return;
    const caret = this.hitTestSelectionCaret(state, clientX, clientY);
    if (!caret) return;

    if (drag.granularity === 'character') {
      drag.anchor = drag.initialStart;
      drag.focus = caret;
    } else {
      const unit = drag.granularity === 'line'
        ? this.lineSelectionAtCaret(state, caret)
        : this.wordSelectionAtCaret(state, caret);
      if (!unit) return;
      if (comparePdfCarets(caret, drag.origin) < 0) {
        drag.anchor = drag.initialEnd;
        drag.focus = unit.anchor;
      } else {
        drag.anchor = drag.initialStart;
        drag.focus = unit.focus;
      }
    }
    this.setSelectionState({ page: drag.origin.page, anchor: drag.anchor, focus: drag.focus });
  }

  private pageStateForSelectionPoint(
    clientX: number,
    clientY: number,
    preferredPage: number,
  ): PageState | undefined {
    let nearest: { state: PageState; distance: number } | undefined;
    for (const state of this.pages.values()) {
      if (!state.rendered || state.wrapper.style.display === 'none') continue;
      const bounds = state.wrapper.getBoundingClientRect();
      if (clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom) {
        return state;
      }
      const dx = clientX < bounds.left ? bounds.left - clientX : clientX > bounds.right ? clientX - bounds.right : 0;
      const dy = clientY < bounds.top ? bounds.top - clientY : clientY > bounds.bottom ? clientY - bounds.bottom : 0;
      const distance = Math.hypot(dx, dy) - (state.pageNum === preferredPage ? 0.01 : 0);
      if (!nearest || distance < nearest.distance) nearest = { state, distance };
    }
    return nearest?.state;
  }

  private hitTestSelectionCaret(state: PageState, clientX: number, clientY: number): PdfSelectionCaret | undefined {
    const bounds = state.wrapper.getBoundingClientRect();
    const x = (clientX - bounds.left) / this.scale;
    const y = (clientY - bounds.top) / this.scale;
    if (!state.selectionLines.length) return undefined;
    let bestLine: PdfSelectionLine | undefined;
    let bestLineDistance = Number.POSITIVE_INFINITY;
    let bestLineCenterDistance = Number.POSITIVE_INFINITY;
    for (const line of state.selectionLines) {
      const verticalDistance = y < line.top ? line.top - y : y > line.bottom ? y - line.bottom : 0;
      const centerDistance = Math.abs(y - line.center);
      if (
        verticalDistance < bestLineDistance
        || (verticalDistance === bestLineDistance && centerDistance < bestLineCenterDistance)
      ) {
        bestLine = line;
        bestLineDistance = verticalDistance;
        bestLineCenterDistance = centerDistance;
      }
    }
    if (!bestLine) return undefined;

    let best: { glyph: PdfSelectionGlyph; itemIndex: number } | undefined;
    let bestHorizontalDistance = Number.POSITIVE_INFINITY;
    let bestVerticalDistance = Number.POSITIVE_INFINITY;
    for (const candidate of bestLine.glyphs) {
      const [left, top, right, bottom] = candidate.glyph.hitRect;
      const horizontalDistance = x < left ? left - x : x > right ? x - right : 0;
      const verticalDistance = y < top ? top - y : y > bottom ? y - bottom : 0;
      if (
        horizontalDistance < bestHorizontalDistance
        || (horizontalDistance === bestHorizontalDistance && verticalDistance < bestVerticalDistance)
      ) {
        best = candidate;
        bestHorizontalDistance = horizontalDistance;
        bestVerticalDistance = verticalDistance;
      }
    }
    if (!best) return undefined;
    const [left, , right] = best.glyph.hitRect;
    return {
      page: state.pageNum,
      itemIndex: best.itemIndex,
      offset: x < (left + right) / 2 ? best.glyph.offsetStart : best.glyph.offsetEnd,
    };
  }

  private wordSelectionAtCaret(
    state: PageState,
    caret: PdfSelectionCaret,
  ): { anchor: PdfSelectionCaret; focus: PdfSelectionCaret } | undefined {
    let startItemIndex = caret.itemIndex;
    let endItemIndex = caret.itemIndex;
    const content = String(state.textRects[startItemIndex]?.content ?? '');
    if (!content) return undefined;
    let cursor = Math.min(Math.max(0, caret.offset), content.length - 1);
    if (!isPdfWordCharacter(content.charAt(cursor)) && cursor > 0 && isPdfWordCharacter(content.charAt(cursor - 1))) {
      cursor--;
    }
    let from = cursor;
    let to = cursor + 1;
    const word = isPdfWordCharacter(content.charAt(cursor));
    while (from > 0 && isPdfWordCharacter(content.charAt(from - 1)) === word) from--;
    while (to < content.length && isPdfWordCharacter(content.charAt(to)) === word) to++;
    while (word && to < content.length && isPdfWordJoinMarker(content.charAt(to))) to++;

    if (word) {
      while (from === 0) {
        const previous = previousSelectablePdfTextItem(state.textRects, startItemIndex);
        if (previous < 0 || !pdfTextItemsJoinWord(state.textRects, previous, startItemIndex)) break;
        const previousContent = String(state.textRects[previous]?.content ?? '');
        let previousWordEnd = previousContent.length;
        while (previousWordEnd > 0 && isPdfWordJoinMarker(previousContent.charAt(previousWordEnd - 1))) {
          previousWordEnd--;
        }
        if (!isPdfWordCharacter(previousContent.charAt(previousWordEnd - 1))) break;
        startItemIndex = previous;
        from = previousWordEnd;
        while (from > 0 && isPdfWordCharacter(previousContent.charAt(from - 1))) from--;
      }
      while (to === String(state.textRects[endItemIndex]?.content ?? '').length) {
        const next = nextSelectablePdfTextItem(state.textRects, endItemIndex);
        if (next < 0 || !pdfTextItemsJoinWord(state.textRects, endItemIndex, next)) break;
        const nextContent = String(state.textRects[next]?.content ?? '');
        if (!isPdfWordCharacter(nextContent.charAt(0))) break;
        endItemIndex = next;
        to = 0;
        while (to < nextContent.length && isPdfWordCharacter(nextContent.charAt(to))) to++;
      }
    }
    return {
      anchor: { page: state.pageNum, itemIndex: startItemIndex, offset: from },
      focus: { page: state.pageNum, itemIndex: endItemIndex, offset: to },
    };
  }

  private lineSelectionAtCaret(
    state: PageState,
    caret: PdfSelectionCaret,
  ): { anchor: PdfSelectionCaret; focus: PdfSelectionCaret } | undefined {
    const line = pdfTextLineItemRange(state.textRects, caret.itemIndex);
    if (!line) return this.wordSelectionAtCaret(state, caret);
    const endContent = String(state.textRects[line.to]?.content ?? '');
    return {
      anchor: { page: state.pageNum, itemIndex: line.from, offset: 0 },
      focus: { page: state.pageNum, itemIndex: line.to, offset: endContent.length },
    };
  }

  private setSelectionState(selection: PdfSelectionState): void {
    this.selectionState = selection;
    this.applyNativeSelection(selection);
    this.drawSelectionOverlays();
  }

  private applyNativeSelection(selection: PdfSelectionState): Range | undefined {
    const [start, end] = orderedPdfCarets(selection.anchor, selection.focus);
    const startNode = this.textNodeForCaret(start);
    const endNode = this.textNodeForCaret(end);
    if (!startNode || !endNode) return undefined;
    const range = document.createRange();
    range.setStart(startNode, Math.min(start.offset, startNode.textContent?.length ?? 0));
    range.setEnd(endNode, Math.min(end.offset, endNode.textContent?.length ?? 0));
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);
    if (comparePdfCarets(selection.anchor, selection.focus) > 0) {
      nativeSelection?.setBaseAndExtent?.(
        endNode,
        Math.min(end.offset, endNode.textContent?.length ?? 0),
        startNode,
        Math.min(start.offset, startNode.textContent?.length ?? 0),
      );
    }
    return range;
  }

  private textNodeForCaret(caret: PdfSelectionCaret): Text | undefined {
    const state = this.pages.get(caret.page);
    const span = state?.textLayer.querySelector<HTMLElement>(`span[data-item-index="${caret.itemIndex}"] .pdf-text-glyphs`);
    const node = span?.firstChild;
    return node?.nodeType === Node.TEXT_NODE ? node as Text : undefined;
  }

  private restoreSelectionForPage(page: number): void {
    if (!this.selectionState || !pdfSelectionContainsPage(this.selectionState, page)) return;
    this.applyNativeSelection(this.selectionState);
    this.drawSelectionOverlay(page);
  }

  private drawSelectionOverlays(): void {
    for (const page of this.pages.keys()) this.drawSelectionOverlay(page);
  }

  private drawSelectionOverlay(page: number): void {
    const state = this.pages.get(page);
    if (!state) return;
    state.highlightLayer.querySelectorAll('.pdf-selection-rect').forEach(element => element.remove());
    if (!this.selectionState || !pdfSelectionContainsPage(this.selectionState, page)) return;
    for (const rect of this.selectionRectsForState(this.selectionState, page)) {
      const element = document.createElement('div');
      element.className = 'pdf-selection-rect';
      element.style.left = formatCssPx(rect[0] * this.scale);
      element.style.top = formatCssPx(rect[1] * this.scale);
      element.style.width = formatCssPx((rect[2] - rect[0]) * this.scale);
      element.style.height = formatCssPx((rect[3] - rect[1]) * this.scale);
      state.highlightLayer.appendChild(element);
    }
  }

  private selectionRectsForState(selection: PdfSelectionState, page = selection.page): PdfRect[] {
    const state = this.pages.get(page);
    if (!state) return [];
    const [start, end] = orderedPdfCarets(selection.anchor, selection.focus);
    if (page < start.page || page > end.page) return [];
    const startItemIndex = page === start.page ? start.itemIndex : 0;
    const endItemIndex = page === end.page ? end.itemIndex : Math.max(0, state.textRects.length - 1);
    const rects: PdfRect[] = [];
    for (let itemIndex = startItemIndex; itemIndex <= endItemIndex; itemIndex++) {
      const from = page === start.page && itemIndex === start.itemIndex ? start.offset : 0;
      const contentLength = String(state.textRects[itemIndex]?.content ?? '').length;
      const to = page === end.page && itemIndex === end.itemIndex ? end.offset : contentLength;
      for (const glyph of state.selectionGlyphs[itemIndex] ?? []) {
        if (glyph.offsetEnd <= from || glyph.offsetStart >= to) continue;
        rects.push(glyph.looseRect);
      }
    }
    return normalizePdfTextBands(rects);
  }

  private selectionAutoScrollDelta(clientX: number, clientY: number): { left: number; top: number } {
    const bounds = this.container.getBoundingClientRect();
    const edge = 42;
    const axisDelta = (value: number, minimum: number, maximum: number): number => {
      if (value < minimum + edge) return -Math.ceil(4 + 20 * (minimum + edge - value) / edge);
      if (value > maximum - edge) return Math.ceil(4 + 20 * (value - (maximum - edge)) / edge);
      return 0;
    };
    return {
      left: axisDelta(clientX, bounds.left, bounds.right),
      top: axisDelta(clientY, bounds.top, bounds.bottom),
    };
  }

  private startSelectionAutoScroll(): void {
    const drag = this.selectionDrag;
    if (!drag) return;
    const delta = this.selectionAutoScrollDelta(drag.clientX, drag.clientY);
    if (!delta.left && !delta.top) {
      this.stopSelectionAutoScroll();
      return;
    }
    if (this.selectionAutoScrollFrame !== undefined) return;
    const tick = () => {
      const active = this.selectionDrag;
      if (!active) {
        this.selectionAutoScrollFrame = undefined;
        return;
      }
      const next = this.selectionAutoScrollDelta(active.clientX, active.clientY);
      if (!next.left && !next.top) {
        this.selectionAutoScrollFrame = undefined;
        return;
      }
      this.container.scrollBy({ left: next.left, top: next.top });
      this.updateSelectionDragAtPoint(active, active.clientX, active.clientY);
      this.selectionAutoScrollFrame = window.requestAnimationFrame(tick);
    };
    this.selectionAutoScrollFrame = window.requestAnimationFrame(tick);
  }

  private stopSelectionAutoScroll(): void {
    if (this.selectionAutoScrollFrame === undefined) return;
    window.cancelAnimationFrame(this.selectionAutoScrollFrame);
    this.selectionAutoScrollFrame = undefined;
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
    else if (action === 'presentation-single') void this.setPresentationMode('single');
    else if (action === 'presentation-single-continuous') void this.setPresentationMode('single-continuous');
    else if (action === 'presentation-two') void this.setPresentationMode('two');
    else if (action === 'presentation-two-continuous') void this.setPresentationMode('two-continuous');
    else if (action === 'continuous') void this.setContinuousScroll(!this.continuousScroll);
    else if (action === 'scroll-vertical') void this.setScrollMode('vertical');
    else if (action === 'scroll-horizontal') void this.setScrollMode('horizontal');
    else if (action === 'scroll-wrapped') void this.setScrollMode('wrapped');
    else if (action === 'spread-single') void this.setSpreadMode(false, this.spreadParity);
    else if (action === 'spread-odd') void this.setSpreadMode(true, 'odd');
    else if (action === 'spread-even') void this.setSpreadMode(true, 'even');
    else if (action === 'adapt-theme') {
      this.adaptToTheme = !this.adaptToTheme;
      document.body.classList.toggle('pdf-adapt-theme', this.adaptToTheme);
      this.updateToolbarState();
      this.persistViewerState();
    } else if (action === 'defaults') {
      this.adaptToTheme = false;
      this.scrollMode = 'vertical';
      this.continuousScroll = true;
      this.twoPageView = false;
      this.spreadParity = 'even';
      document.body.classList.remove('pdf-adapt-theme');
      this.applyViewMode();
      this.fitPage();
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
      this.currentPage = clamp(Math.round(this.currentPage), 1, Math.max(1, pdfDoc.pageCount));
      if (this.fitMode === 'custom') {
        await this.renderVisiblePages();
        this.scrollCurrentViewIntoView('auto', 'nearest');
      } else {
        await this.reapplyFitMode();
      }
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
        selectionGlyphs: [],
        selectionLines: [],
        renderGeneration: 0,
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
      if (this.currentPageTrackingLock !== undefined) return;
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
    const renderGeneration = ++state.renderGeneration;
    state.rendered = true;

    try {
      const dpr = window.devicePixelRatio || 1;
      const layout = this.applyPageLayout(state, dpr);
      const blob: Blob = await engine
        .renderPage(pdfDoc, state.pageObj, { scaleFactor: layout.scale, dpr: layout.dpr, withAnnotations: true })
        .toPromise();
      if (renderGeneration !== state.renderGeneration) return;
      const url = URL.createObjectURL(blob);
      const image = new Image();
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = reject;
          image.src = url;
        });
        if (renderGeneration !== state.renderGeneration) return;
        state.canvas.width = layout.bitmapWidth;
        state.canvas.height = layout.bitmapHeight;
        const context = state.canvas.getContext('2d')!;
        context.clearRect(0, 0, layout.bitmapWidth, layout.bitmapHeight);
        context.drawImage(image, 0, 0, layout.bitmapWidth, layout.bitmapHeight);
      } finally {
        URL.revokeObjectURL(url);
      }

      const rects = await this.loadTextRects(state);
      if (renderGeneration !== state.renderGeneration) return;
      state.textRects = rects;
      state.selectionGlyphs = rects.map(item => Array.isArray(item.selectionGlyphs) ? item.selectionGlyphs : []);
      state.selectionLines = buildPdfSelectionLines(state.selectionGlyphs);
      renderPdfTextLayer(state.textLayer, rects, layout.scale);
      await this.drawPdfLinksForPage(state, layout, renderGeneration);
      if (renderGeneration !== state.renderGeneration) return;
      this.drawHighlightsForPage(pageNum);
      this.drawSearchHighlightsForPage(pageNum);
      this.drawDiscussionMarkersForPage(pageNum);
      this.restoreSelectionForPage(pageNum);
    } catch (error) {
      console.error(`Failed to render page ${pageNum}`, error);
      if (renderGeneration === state.renderGeneration) state.rendered = false;
    }
  }

  private async drawPdfLinksForPage(
    state: PageState,
    layout: PdfPageLayout,
    renderGeneration: number,
  ): Promise<void> {
    if (typeof engine.getPageAnnotations !== 'function') return;
    let annotations: unknown;
    try {
      annotations = await engine.getPageAnnotations(pdfDoc, state.pageObj).toPromise();
    } catch (error) {
      console.warn(`Could not load PDF links on page ${state.pageNum}`, error);
      return;
    }
    if (renderGeneration !== state.renderGeneration || !Array.isArray(annotations)) return;

    for (const value of annotations) {
      const annotation = value as PdfLinkAnnoObject;
      if (annotation?.type !== PdfAnnotationSubtype.LINK) continue;
      const destination = pdfInternalDestination(annotation);
      if (
        !destination
        || !Number.isInteger(destination.pageIndex)
        || destination.pageIndex < 0
        || destination.pageIndex >= (pdfDoc?.pageCount ?? 0)
      ) {
        continue;
      }
      const rect = normalizePdfAnnotationRect(annotation.rect, state.pageObj.size);
      if (!rect) continue;

      const targetPage = destination.pageIndex + 1;
      const linkText = this.pdfLinkText(state, rect);
      const accessibleTarget = linkText || `PDF page ${targetPage}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pdf-link-overlay';
      button.dataset.sourcePage = String(state.pageNum);
      button.dataset.targetPage = String(targetPage);
      button.ariaLabel = `Go to ${accessibleTarget}, page ${targetPage}`;
      button.title = linkText ? `Go to ${linkText}` : `Go to PDF page ${targetPage}`;
      button.style.left = formatCssPx(rect.left * layout.scale);
      button.style.top = formatCssPx(rect.top * layout.scale);
      button.style.width = formatCssPx(rect.width * layout.scale);
      button.style.height = formatCssPx(rect.height * layout.scale);
      button.addEventListener('pointerdown', event => event.stopPropagation());
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void this.followPdfDestination(state.pageNum, destination);
      });
      state.textLayer.appendChild(button);
    }
  }

  private pdfLinkText(
    state: PageState,
    link: { left: number; top: number; width: number; height: number },
  ): string {
    const right = link.left + link.width;
    const bottom = link.top + link.height;
    return state.textRects
      .filter(item => {
        const rect = item?.rect;
        const left = Number(rect?.origin?.x);
        const top = Number(rect?.origin?.y);
        const width = Number(rect?.size?.width);
        const height = Number(rect?.size?.height);
        return [left, top, width, height].every(Number.isFinite)
          && Math.min(right, left + width) > Math.max(link.left, left)
          && Math.min(bottom, top + height) > Math.max(link.top, top);
      })
      .map(item => String(item.content ?? ''))
      .join(' ')
      .replace(/[\u00ad\u200b\u2060\ufeff\ufffe\uffff]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 160);
  }

  private loadTextRects(state: PageState): Promise<any[]> {
    if (!state.textRectsPromise) {
      state.textRectsPromise = (async () => {
        if (typeof engine.getPageTextRuns === 'function') {
          try {
            const [pageTextRuns, pageGlyphs] = await Promise.all([
              engine.getPageTextRuns(pdfDoc, state.pageObj).toPromise(),
              typeof engine.getPageGlyphs === 'function'
                ? engine.getPageGlyphs(pdfDoc, state.pageObj).toPromise().catch(() => [])
                : Promise.resolve([]),
            ]);
            const sourceCharacters = await this.loadPdfRunSourceCharacters(state, pageTextRuns?.runs);
            const rects = normalizePdfTextRuns(pageTextRuns?.runs, pageGlyphs, sourceCharacters);
            if (rects.length > 0) {
              state.textRects = rects;
              state.selectionGlyphs = rects.map(item => Array.isArray(item.selectionGlyphs) ? item.selectionGlyphs : []);
              state.selectionLines = buildPdfSelectionLines(state.selectionGlyphs);
              return rects;
            }
          } catch (error) {
            console.warn(`Falling back to basic PDF text extraction on page ${state.pageNum}`, error);
          }
        }

        const basicRects = await engine.getPageTextRects(pdfDoc, state.pageObj).toPromise();
        const rects = normalizeBasicPdfTextRects(basicRects);
        state.textRects = rects;
        state.selectionGlyphs = rects.map(item => Array.isArray(item.selectionGlyphs) ? item.selectionGlyphs : []);
        state.selectionLines = buildPdfSelectionLines(state.selectionGlyphs);
        return rects;
      })();
    }
    return state.textRectsPromise!;
  }

  private async loadPdfRunSourceCharacters(
    state: PageState,
    value: unknown,
  ): Promise<Map<number, string[]> | undefined> {
    if (!Array.isArray(value) || typeof engine.getTextSlices !== 'function') return undefined;
    const slices: Array<{ pageIndex: number; charIndex: number; charCount: number }> = [];
    const targets: Array<{ runIndex: number; offset: number }> = [];
    value.forEach((run, runIndex) => {
      const charIndex = Number(run?.charIndex);
      const charCount = Number(run?.charCount);
      const visibleCount = Array.from(typeof run?.text === 'string' ? run.text : '').length;
      if (
        !Number.isInteger(charIndex)
        || charIndex < 0
        || !Number.isInteger(charCount)
        || charCount <= 0
        || charCount === visibleCount
      ) {
        return;
      }
      for (let offset = 0; offset < charCount; offset++) {
        slices.push({ pageIndex: state.pageNum - 1, charIndex: charIndex + offset, charCount: 1 });
        targets.push({ runIndex, offset });
      }
    });
    if (!slices.length) return undefined;
    try {
      const values: string[] = await engine.getTextSlices(pdfDoc, slices).toPromise();
      const result = new Map<number, string[]>();
      targets.forEach((target, index) => {
        const characters = result.get(target.runIndex) ?? [];
        characters[target.offset] = String(values[index] ?? '');
        result.set(target.runIndex, characters);
      });
      return result;
    } catch (error) {
      console.warn(`Could not restore PDF word-join markers on page ${state.pageNum}`, error);
      return undefined;
    }
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
    if (anchor.multiPage) {
      document.getElementById('selection-toolbar')?.remove();
      return;
    }
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
    this.showSelectionToolbar(anchor, this.selectionViewportRect(anchor) ?? range.getBoundingClientRect());
  }

  private selectionAnchorFromNativeRange(): { anchor: PdfAnchor; range: Range } | undefined {
    const custom = this.selectionAnchorFromState();
    if (custom) return custom;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return undefined;
    }
    const range = selection.getRangeAt(0);
    const nativeText = normalizeSearchText(selection.toString(), true, true);

    const startSpan = closestPdfTextSpan(range.startContainer);
    const endSpan = closestPdfTextSpan(range.endContainer);
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
    const startOffset = pdfTextOffset(range.startContainer, range.startOffset, startSpan);
    const endOffset = pdfTextOffset(range.endContainer, range.endOffset, endSpan);
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

  private selectionAnchorFromState(): { anchor: PdfAnchor; range: Range } | undefined {
    const selection = this.selectionState;
    if (!selection || samePdfCaret(selection.anchor, selection.focus)) return undefined;
    // Rendering replaces every text node. Rebuild the native Range from the
    // canonical PDF carets instead of assuming Chromium kept a live range.
    const range = this.applyNativeSelection(selection);
    const nativeSelection = window.getSelection();
    if (!range || !nativeSelection || nativeSelection.isCollapsed) return undefined;
    const [start, end] = orderedPdfCarets(selection.anchor, selection.focus);
    if (start.page !== end.page) {
      const text = this.selectionTextFromState(selection);
      if (!text) return undefined;
      return {
        range,
        anchor: {
          page: start.page,
          multiPage: true,
          rects: this.selectionRectsForState(selection, start.page),
          snippet: text,
        },
      };
    }
    const textRects = this.pages.get(selection.page)?.textRects ?? [];
    const text = pdfSearchRangeForSelection(
      textRects,
      'geometry',
      start.itemIndex,
      start.offset,
      end.itemIndex,
      end.offset,
    )?.text ?? normalizeSearchText(nativeSelection.toString(), true, true);
    if (!text) return undefined;
    const textFragment = pdfTextFragmentForSelection(
      textRects,
      start.itemIndex,
      start.offset,
      end.itemIndex,
      end.offset,
      text,
    );
    const { textStart: _textStart, ...selectionContext } = textFragment;
    return {
      range,
      anchor: {
        page: selection.page,
        textItemIndex: start.itemIndex,
        charOffset: start.offset,
        endTextItemIndex: end.itemIndex,
        endCharOffset: end.offset,
        length: start.itemIndex === end.itemIndex ? Math.abs(end.offset - start.offset) : 0,
        rects: this.selectionRectsForState(selection),
        snippet: text,
        ...selectionContext,
        textFragment,
      },
    };
  }

  private selectionTextFromState(selection: PdfSelectionState): string {
    const [start, end] = orderedPdfCarets(selection.anchor, selection.focus);
    const parts: string[] = [];
    for (let page = start.page; page <= end.page; page++) {
      const state = this.pages.get(page);
      if (!state?.textRects.length) continue;
      const fromItem = page === start.page ? start.itemIndex : 0;
      const fromOffset = page === start.page ? start.offset : 0;
      const toItem = page === end.page ? end.itemIndex : state.textRects.length - 1;
      const toContent = String(state.textRects[toItem]?.content ?? '');
      const toOffset = page === end.page ? end.offset : toContent.length;
      const text = pdfSearchRangeForSelection(
        state.textRects,
        'geometry',
        fromItem,
        fromOffset,
        toItem,
        toOffset,
      )?.text;
      if (text) parts.push(text);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  private selectionViewportRect(anchor: PdfAnchor): DOMRect | undefined {
    const wrapper = this.pages.get(anchor.page)?.wrapper.getBoundingClientRect();
    const rects = validPdfRects(anchor.rects);
    if (!wrapper || !rects.length) return undefined;
    const left = wrapper.left + Math.min(...rects.map(rect => rect[0])) * this.scale;
    const top = wrapper.top + Math.min(...rects.map(rect => rect[1])) * this.scale;
    const right = wrapper.left + Math.max(...rects.map(rect => rect[2])) * this.scale;
    const bottom = wrapper.top + Math.max(...rects.map(rect => rect[3])) * this.scale;
    return new DOMRect(left, top, right - left, bottom - top);
  }

  private copyNativeSelection(event: ClipboardEvent): void {
    const current = this.selectionAnchorFromNativeRange();
    const text = current?.anchor.snippet?.trim();
    if (!text || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
  }

  private clearSelection(): void {
    this.cancelSelectionUpdate();
    this.stopSelectionAutoScroll();
    if (this.selectionToolbarPositionFrame !== undefined) {
      window.cancelAnimationFrame(this.selectionToolbarPositionFrame);
      this.selectionToolbarPositionFrame = undefined;
    }
    document.getElementById('selection-toolbar')?.remove();
    this.selectionState = null;
    this.selectionDrag = null;
    for (const page of this.pages.values()) {
      page.highlightLayer.querySelectorAll('.pdf-selection-rect').forEach(element => element.remove());
    }
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
      && !current.anchor.multiPage
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

    const presentationMode = this.presentationMode();
    showObsidianContextMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      items: [
        {
          id: 'auto-resize',
          label: 'Automatically Resize',
          role: 'menuitemcheckbox',
          checked: this.fitMode !== 'custom',
          onSelect: () => this.toggleAutomaticResize(),
        },
        { id: 'zoom-in', label: 'Zoom In', onSelect: () => this.zoom(0.15) },
        { id: 'zoom-out', label: 'Zoom Out', onSelect: () => this.zoom(-0.15) },
        { id: 'actual-size', label: 'Actual Size', onSelect: () => this.setActualSize() },
        { type: 'separator' },
        {
          id: 'presentation-single',
          label: 'Single Page',
          role: 'menuitemradio',
          checked: presentationMode === 'single',
          onSelect: () => void this.setPresentationMode('single'),
        },
        {
          id: 'presentation-single-continuous',
          label: 'Single Page Continuous',
          role: 'menuitemradio',
          checked: presentationMode === 'single-continuous',
          onSelect: () => void this.setPresentationMode('single-continuous'),
        },
        {
          id: 'presentation-two',
          label: 'Two Pages',
          role: 'menuitemradio',
          checked: presentationMode === 'two',
          onSelect: () => void this.setPresentationMode('two'),
        },
        {
          id: 'presentation-two-continuous',
          label: 'Two Pages Continuous',
          role: 'menuitemradio',
          checked: presentationMode === 'two-continuous',
          onSelect: () => void this.setPresentationMode('two-continuous'),
        },
        { type: 'separator' },
        {
          id: 'next-page',
          label: 'Next Page',
          disabled: this.navigationTarget(1) === undefined,
          onSelect: () => void this.navigate(1),
        },
        {
          id: 'previous-page',
          label: 'Previous Page',
          disabled: this.navigationTarget(-1) === undefined,
          onSelect: () => void this.navigate(-1),
        },
        { type: 'separator' },
        {
          id: 'copy-page-link',
          label: 'Copy link to page',
          onSelect: () => vscode.postMessage({ type: 'copyPageLink', page }),
        },
      ],
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
        if (action === 'highlight') {
          window.getSelection()?.removeAllRanges();
          this.clearSelection();
        }
        vscode.postMessage({ type: 'selectionAction', action, anchor: actionAnchor });
        toolbar.remove();
      });
      menu.appendChild(button);
    }
    toolbar.appendChild(menu);

    document.body.appendChild(toolbar);
    requestAnimationFrame(() => this.positionSelectionToolbar(toolbar, rect));
  }

  private scheduleSelectionToolbarPosition(): void {
    if (this.selectionToolbarPositionFrame !== undefined) return;
    this.selectionToolbarPositionFrame = window.requestAnimationFrame(() => {
      this.selectionToolbarPositionFrame = undefined;
      const toolbar = document.getElementById('selection-toolbar');
      const selection = this.selectionState;
      if (!toolbar || !selection) return;
      const [start, end] = orderedPdfCarets(selection.anchor, selection.focus);
      if (start.page !== end.page) {
        toolbar.remove();
        return;
      }
      const current = this.selectionAnchorFromState();
      const rect = current && this.selectionViewportRect(current.anchor);
      if (!rect) {
        toolbar.remove();
        return;
      }
      const viewport = this.container.getBoundingClientRect();
      if (rect.bottom < viewport.top || rect.top > viewport.bottom) {
        toolbar.remove();
        return;
      }
      this.positionSelectionToolbar(toolbar, rect);
    });
  }

  private positionSelectionToolbar(toolbar: HTMLElement, rect: DOMRect): void {
    const box = toolbar.getBoundingClientRect();
    const half = box.width / 2;
    const minLeft = window.scrollX + 12 + half;
    const maxLeft = window.scrollX + window.innerWidth - 12 - half;
    toolbar.style.left = `${Math.max(minLeft, Math.min(maxLeft, rect.left + rect.width / 2 + window.scrollX))}px`;
    const above = rect.top - box.height - 10 + window.scrollY;
    toolbar.style.top = `${above >= window.scrollY + 8 ? above : rect.bottom + 10 + window.scrollY}px`;
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
      const exactRects = normalizePdfTextBands(anchor.rects);
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
      const exactRects = normalizePdfTextBands(anchor.rects);
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

  private handlePaginatedArrowKey(event: KeyboardEvent): boolean {
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const direction: -1 | 1 = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    event.preventDefault();
    if (this.canScrollDocument(horizontal ? 'horizontal' : 'vertical', direction)) {
      this.container.scrollBy({
        left: horizontal ? direction * 40 : 0,
        top: horizontal ? 0 : direction * 40,
        behavior: 'auto',
      });
      return true;
    }
    void this.navigateFromPageBoundary(direction, horizontal ? 'horizontal' : 'vertical');
    return true;
  }

  private handlePaginatedWheel(event: WheelEvent): void {
    // Chromium represents a macOS trackpad pinch as a cancelable wheel event
    // with ctrlKey set. VS Code webviews do not apply the browser's native page
    // zoom, so consume that gesture and resize the PDF itself like Preview.
    if (event.ctrlKey) {
      this.handleTrackpadPinch(event);
      return;
    }
    if (this.continuousScroll || event.metaKey) {
      this.resetPaginatedWheelGesture();
      return;
    }
    if (this.paginatedWheelNavigationInFlight) {
      event.preventDefault();
      return;
    }

    const now = performance.now();
    if (
      this.paginatedWheelLastEventAt === 0
      || now - this.paginatedWheelLastEventAt > PDF_PAGINATED_GESTURE_IDLE_MS
    ) {
      this.resetPaginatedWheelGesture();
      this.paginatedWheelStartScrollLeft = this.container.scrollLeft;
      this.paginatedWheelStartScrollTop = this.container.scrollTop;
    }
    this.paginatedWheelLastEventAt = now;
    this.paginatedWheelAxisDeltaX += Math.abs(event.deltaX);
    this.paginatedWheelAxisDeltaY += Math.abs(event.deltaY);
    if (!this.paginatedWheelAxis) {
      const dominantDelta = Math.max(this.paginatedWheelAxisDeltaX, this.paginatedWheelAxisDeltaY);
      if (dominantDelta < PDF_PAGINATED_AXIS_LOCK_THRESHOLD) return;
      this.paginatedWheelAxis = this.paginatedWheelAxisDeltaX > this.paginatedWheelAxisDeltaY
        ? 'horizontal'
        : 'vertical';
    }

    const horizontal = this.paginatedWheelAxis === 'horizontal';
    const rawDelta = horizontal ? event.deltaX : event.deltaY;
    if (Math.abs(rawDelta) < 0.01) return;
    const direction: -1 | 1 = rawDelta < 0 ? -1 : 1;
    if (this.paginatedWheelTurnedWithinGesture) {
      event.preventDefault();
      return;
    }
    if (
      !this.paginatedWheelPannedWithinGesture
      && this.canScrollDocumentAt(
        horizontal ? 'horizontal' : 'vertical',
        direction,
        this.paginatedWheelStartScrollLeft,
        this.paginatedWheelStartScrollTop,
      )
    ) {
      this.paginatedWheelPannedWithinGesture = true;
    }
    if (this.canScrollDocument(horizontal ? 'horizontal' : 'vertical', direction)) {
      this.paginatedWheelPannedWithinGesture = true;
      this.paginatedWheelDelta = 0;
      this.paginatedWheelDirection = 0;
      return;
    }

    event.preventDefault();
    if (this.paginatedWheelPannedWithinGesture) return;
    if (this.paginatedWheelDirection !== direction) {
      this.paginatedWheelDirection = direction;
      this.paginatedWheelDelta = 0;
    }
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(1, horizontal ? this.container.clientWidth : this.container.clientHeight)
        : 1;
    this.paginatedWheelDelta += Math.abs(rawDelta) * deltaScale;
    if (this.paginatedWheelDelta < 48) return;
    this.paginatedWheelDelta = 0;
    this.paginatedWheelTurnedWithinGesture = true;
    this.paginatedWheelNavigationInFlight = true;
    void this.navigateFromPageBoundary(direction, horizontal ? 'horizontal' : 'vertical').finally(() => {
      this.paginatedWheelNavigationInFlight = false;
    });
  }

  private handleTrackpadPinch(event: WheelEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.resetPaginatedWheelGesture();
    if (!this.loaded) return;

    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(1, this.container.clientHeight)
        : 1;
    const pixelDelta = event.deltaY * deltaScale;
    if (!Number.isFinite(pixelDelta) || Math.abs(pixelDelta) < 0.01) return;

    const baseline = this.pinchZoomTargetScale ?? this.pinchZoomVisualScale ?? this.scale;
    const boundedDelta = clamp(pixelDelta, -60, 60);
    const nextScale = clamp(baseline * Math.exp(-boundedDelta * 0.006), 0.1, 3.5);
    this.pinchZoomTargetScale = nextScale;
    this.pinchZoomAnchor = this.capturePinchZoomAnchor(event.clientX, event.clientY, event.target);
    this.fitMode = 'custom';
    document.getElementById('selection-toolbar')?.remove();
    this.schedulePinchZoomRender();
    this.schedulePinchZoomCommit();
  }

  private capturePinchZoomAnchor(
    clientX: number,
    clientY: number,
    target: EventTarget | null,
  ): PdfPinchZoomAnchor {
    const viewport = this.container.getBoundingClientRect();
    const visualScale = this.pinchZoomVisualScale ?? this.scale;
    const anchorClientX = clamp(clientX, viewport.left, viewport.right);
    const anchorClientY = clamp(clientY, viewport.top, viewport.bottom);
    const anchor: PdfPinchZoomAnchor = {
      clientX: anchorClientX,
      clientY: anchorClientY,
      contentX: this.container.scrollLeft + anchorClientX - viewport.left,
      contentY: this.container.scrollTop + anchorClientY - viewport.top,
      scale: visualScale,
    };
    const targetElement = target instanceof Element
      ? target
      : document.elementFromPoint(anchorClientX, anchorClientY);
    const wrapper = targetElement?.closest<HTMLDivElement>('.page-wrapper')
      ?? document.elementFromPoint(anchorClientX, anchorClientY)?.closest<HTMLDivElement>('.page-wrapper');
    const page = Number(wrapper?.dataset.page ?? 0);
    const bounds = wrapper?.getBoundingClientRect();
    if (!wrapper || !bounds || !this.pages.has(page) || visualScale <= 0) return anchor;
    anchor.page = page;
    anchor.pdfX = clamp((anchorClientX - bounds.left) / visualScale, 0, Number(this.pages.get(page)!.pageObj.size.width));
    anchor.pdfY = clamp((anchorClientY - bounds.top) / visualScale, 0, Number(this.pages.get(page)!.pageObj.size.height));
    return anchor;
  }

  private schedulePinchZoomRender(): void {
    if (this.pinchZoomFrame !== undefined) return;
    this.pinchZoomFrame = requestAnimationFrame(() => {
      this.pinchZoomFrame = undefined;
      this.flushPinchZoomPreview();
    });
  }

  private flushPinchZoomPreview(): void {
    const targetScale = this.pinchZoomTargetScale;
    const anchor = this.pinchZoomAnchor;
    if (targetScale === undefined || !anchor) return;
    const ratio = targetScale / Math.max(0.0001, this.scale);
    const previewPages = this.pinchZoomPreviewPageNumbers(anchor);
    for (const pageNumber of this.pinchZoomPreviewPages) {
      if (previewPages.has(pageNumber)) continue;
      const page = this.pages.get(pageNumber);
      if (!page) continue;
      this.applyPageLayout(page);
      this.clearPinchZoomLayerTransforms(page);
    }
    for (const pageNumber of previewPages) {
      const page = this.pages.get(pageNumber);
      if (!page) continue;
      const width = formatCssPx(Number(page.pageObj.size.width) * targetScale);
      const height = formatCssPx(Number(page.pageObj.size.height) * targetScale);
      page.wrapper.style.width = width;
      page.wrapper.style.height = height;
      for (const layer of [page.canvas, page.textLayer, page.highlightLayer]) {
        layer.style.transformOrigin = '0 0';
        layer.style.transform = `scale(${ratio})`;
        layer.style.willChange = 'transform';
      }
    }
    this.pinchZoomPreviewPages.clear();
    for (const pageNumber of previewPages) this.pinchZoomPreviewPages.add(pageNumber);
    this.pinchZoomVisualScale = targetScale;
    this.restorePinchZoomAnchor(anchor, targetScale);
    this.updatePinchZoomInfo(targetScale);
  }

  private pinchZoomPreviewPageNumbers(anchor: PdfPinchZoomAnchor): Set<number> {
    const pageNumber = anchor.page ?? this.currentPage;
    if (!this.continuousScroll) return new Set(this.visiblePageNumbers());
    if (this.twoPageView) return new Set(this.spreadPageNumbers(pageNumber));
    const result = new Set<number>();
    const total = pdfDoc?.pageCount ?? this.pages.size;
    for (let candidate = pageNumber - 1; candidate <= pageNumber + 1; candidate++) {
      if (candidate >= 1 && candidate <= total) result.add(candidate);
    }
    return result;
  }

  private schedulePinchZoomCommit(): void {
    if (this.pinchZoomCommitTimer !== undefined) {
      window.clearTimeout(this.pinchZoomCommitTimer);
    }
    this.pinchZoomCommitTimer = window.setTimeout(() => {
      this.pinchZoomCommitTimer = undefined;
      void this.commitPinchZoom();
    }, PDF_PINCH_COMMIT_DELAY_MS);
  }

  private async commitPinchZoom(): Promise<void> {
    if (this.pinchZoomCommitting) return;
    if (this.pinchZoomFrame !== undefined) {
      cancelAnimationFrame(this.pinchZoomFrame);
      this.pinchZoomFrame = undefined;
      this.flushPinchZoomPreview();
    }
    const targetScale = this.pinchZoomTargetScale;
    const anchor = this.pinchZoomAnchor;
    if (targetScale === undefined || !anchor) return;
    if (Math.abs(targetScale - this.scale) < 0.0001) {
      this.clearPinchZoomPreview();
      this.finishPinchZoom();
      this.updatePageInfo();
      return;
    }

    this.pinchZoomCommitting = true;
    this.scale = targetScale;
    this.clearPinchZoomPreview();
    try {
      await this.rerender(anchor);
    } finally {
      this.pinchZoomCommitting = false;
    }
    const pendingScale = this.pinchZoomTargetScale;
    if (pendingScale !== undefined && Math.abs(pendingScale - targetScale) >= 0.0001) {
      this.schedulePinchZoomRender();
      this.schedulePinchZoomCommit();
      return;
    }
    this.finishPinchZoom();
  }

  private clearPinchZoomPreview(): void {
    for (const pageNumber of this.pinchZoomPreviewPages) {
      const page = this.pages.get(pageNumber);
      if (page) this.clearPinchZoomLayerTransforms(page);
    }
    this.pinchZoomPreviewPages.clear();
    this.pinchZoomVisualScale = undefined;
  }

  private cancelPinchZoom(): void {
    if (this.pinchZoomCommitTimer !== undefined) {
      window.clearTimeout(this.pinchZoomCommitTimer);
      this.pinchZoomCommitTimer = undefined;
    }
    if (this.pinchZoomFrame !== undefined) {
      cancelAnimationFrame(this.pinchZoomFrame);
      this.pinchZoomFrame = undefined;
    }
    this.clearPinchZoomPreview();
    this.finishPinchZoom();
  }

  private clearPinchZoomLayerTransforms(page: PageState): void {
    for (const layer of [page.canvas, page.textLayer, page.highlightLayer]) {
      layer.style.removeProperty('transform-origin');
      layer.style.removeProperty('transform');
      layer.style.removeProperty('will-change');
    }
  }

  private finishPinchZoom(): void {
    this.pinchZoomTargetScale = undefined;
    this.pinchZoomAnchor = undefined;
    this.pinchZoomVisualScale = undefined;
  }

  private updatePinchZoomInfo(scale: number): void {
    const percentage = Math.round(scale * 100);
    if (document.activeElement !== this.zoomInput) {
      this.zoomInput.value = String(percentage);
    }
    this.zoomInput.setAttribute('aria-valuenow', String(percentage));
    this.zoomInput.setAttribute('aria-valuetext', `${percentage}%`);
    const total = pdfDoc?.pageCount ?? 0;
    this.pageInfo.textContent = total ? `Page ${this.currentPage} / ${total}  ${percentage}%` : '';
  }

  private canScrollDocument(axis: 'horizontal' | 'vertical', direction: -1 | 1): boolean {
    return this.canScrollDocumentAt(
      axis,
      direction,
      this.container.scrollLeft,
      this.container.scrollTop,
    );
  }

  private canScrollDocumentAt(
    axis: 'horizontal' | 'vertical',
    direction: -1 | 1,
    scrollLeft: number,
    scrollTop: number,
  ): boolean {
    return canScrollPdfViewport(axis, direction, this.viewportMetrics(scrollLeft, scrollTop));
  }

  private resetPaginatedWheelGesture(): void {
    this.paginatedWheelDelta = 0;
    this.paginatedWheelDirection = 0;
    this.paginatedWheelAxis = undefined;
    this.paginatedWheelAxisDeltaX = 0;
    this.paginatedWheelAxisDeltaY = 0;
    this.paginatedWheelLastEventAt = 0;
    this.paginatedWheelStartScrollLeft = this.container.scrollLeft;
    this.paginatedWheelStartScrollTop = this.container.scrollTop;
    this.paginatedWheelPannedWithinGesture = false;
    this.paginatedWheelTurnedWithinGesture = false;
  }

  private async navigateFromPageBoundary(
    direction: -1 | 1,
    axis: 'horizontal' | 'vertical',
  ): Promise<void> {
    const viewportProgress = this.capturePaginatedViewportProgress();
    const target = this.navigationTarget(direction);
    if (target === undefined || !await this.goToPage(target, {
      scrollCurrentView: false,
      behavior: 'auto',
    })) {
      return;
    }
    await nextAnimationFrame();
    this.restorePaginatedViewportProgress(viewportProgress, {
      x: axis === 'horizontal' ? (direction > 0 ? 0 : 1) : undefined,
      y: axis === 'vertical' ? (direction > 0 ? 0 : 1) : undefined,
    });
  }

  private async navigate(direction: -1 | 1): Promise<void> {
    const target = this.navigationTarget(direction);
    if (target === undefined) return;
    if (this.continuousScroll) {
      await this.goToPage(target);
      return;
    }

    // Preview keeps the same normalized viewport position when explicitly
    // turning a magnified page (toolbar or Option+Arrow), in both directions.
    const viewportProgress = this.capturePaginatedViewportProgress();
    if (!await this.goToPage(target, {
      scrollCurrentView: false,
      behavior: 'auto',
    })) {
      return;
    }
    await nextAnimationFrame();
    this.restorePaginatedViewportProgress(viewportProgress);
  }

  private capturePaginatedViewportProgress(): PdfViewportProgress {
    return capturePdfViewportProgress(this.viewportMetrics());
  }

  private restorePaginatedViewportProgress(
    progress: PdfViewportProgress,
    override: Partial<PdfViewportProgress> = {},
  ): void {
    const target = restorePdfViewportProgress(progress, this.viewportMetrics(), override);
    this.container.scrollTo({
      left: target.left,
      top: target.top,
      behavior: 'auto',
    });
  }

  private viewportMetrics(
    scrollLeft = this.container.scrollLeft,
    scrollTop = this.container.scrollTop,
  ): PdfViewportMetrics {
    return {
      scrollLeft,
      scrollTop,
      scrollWidth: this.container.scrollWidth,
      scrollHeight: this.container.scrollHeight,
      clientWidth: this.container.clientWidth,
      clientHeight: this.container.clientHeight,
    };
  }

  private async followPdfDestination(
    sourcePage: number,
    destination: PdfDestinationObject,
  ): Promise<void> {
    const sourceLocation = this.capturePdfViewLocation(sourcePage);
    const targetPage = destination.pageIndex + 1;
    if (!sourceLocation || !await this.goToPage(targetPage, {
      scrollCurrentView: false,
      behavior: 'auto',
    })) {
      return;
    }

    await nextAnimationFrame();
    const trackingToken = this.beginCurrentPageTrackingLock();
    this.currentPage = targetPage;
    this.scrollToPdfDestination(destination);
    this.pdfNavigationHistory.push(sourceLocation);
    if (this.pdfNavigationHistory.length > 100) this.pdfNavigationHistory.shift();
    this.updatePdfHistoryButton();
    window.getSelection()?.removeAllRanges();
    this.clearSelection();
    this.container.tabIndex = -1;
    this.container.focus({ preventScroll: true });
    this.updatePageInfo();
    this.releaseCurrentPageTrackingLock(trackingToken, 'auto');
  }

  private capturePdfViewLocation(page: number): PdfViewLocation | undefined {
    const wrapper = this.pages.get(page)?.wrapper;
    if (!wrapper || wrapper.style.display === 'none') return undefined;
    const viewport = this.container.getBoundingClientRect();
    const bounds = wrapper.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return undefined;
    const clientX = clamp(
      viewport.left + viewport.width / 2,
      bounds.left,
      bounds.right,
    );
    const clientY = clamp(
      viewport.top + Math.min(24, viewport.height / 4),
      bounds.top,
      bounds.bottom,
    );
    return {
      page,
      pdfX: (clientX - bounds.left) / Math.max(0.0001, this.scale),
      pdfY: (clientY - bounds.top) / Math.max(0.0001, this.scale),
      viewportX: clientX - viewport.left,
      viewportY: clientY - viewport.top,
      fallbackScrollLeft: this.container.scrollLeft,
      fallbackScrollTop: this.container.scrollTop,
    };
  }

  private scrollToPdfDestination(destination: PdfDestinationObject): void {
    const targetPage = destination.pageIndex + 1;
    const state = this.pages.get(targetPage);
    if (!state) return;
    const viewport = this.container.getBoundingClientRect();
    const bounds = state.wrapper.getBoundingClientRect();
    const target = pdfDestinationViewerTarget(destination, state.pageObj, Boolean(pdfDoc?.normalizedRotation));
    const margin = Math.min(24, Math.max(8, viewport.height * 0.04));
    let left = this.container.scrollLeft
      + (bounds.left + bounds.right) / 2
      - (viewport.left + viewport.right) / 2;
    if (target.alignX) {
      left = this.container.scrollLeft + bounds.left - viewport.left + target.x * this.scale - margin;
    }
    const top = this.container.scrollTop + bounds.top - viewport.top + target.y * this.scale - margin;
    this.container.scrollTo({
      left: clamp(left, 0, Math.max(0, this.container.scrollWidth - this.container.clientWidth)),
      top: clamp(top, 0, Math.max(0, this.container.scrollHeight - this.container.clientHeight)),
      behavior: 'auto',
    });
  }

  private async goBackInPdfHistory(): Promise<void> {
    const location = this.pdfNavigationHistory.at(-1);
    if (!location) return;
    this.historyBackButton.disabled = true;
    try {
      if (!await this.goToPage(location.page, {
        scrollCurrentView: false,
        behavior: 'auto',
      })) {
        return;
      }
      await nextAnimationFrame();
      const trackingToken = this.beginCurrentPageTrackingLock();
      const viewport = this.container.getBoundingClientRect();
      const wrapper = this.pages.get(location.page)?.wrapper;
      if (wrapper && wrapper.style.display !== 'none') {
        const bounds = wrapper.getBoundingClientRect();
        const left = this.container.scrollLeft
          + bounds.left
          + location.pdfX * this.scale
          - viewport.left
          - location.viewportX;
        const top = this.container.scrollTop
          + bounds.top
          + location.pdfY * this.scale
          - viewport.top
          - location.viewportY;
        this.container.scrollTo({
          left: clamp(left, 0, Math.max(0, this.container.scrollWidth - this.container.clientWidth)),
          top: clamp(top, 0, Math.max(0, this.container.scrollHeight - this.container.clientHeight)),
          behavior: 'auto',
        });
      } else {
        this.container.scrollTo({
          left: location.fallbackScrollLeft,
          top: location.fallbackScrollTop,
          behavior: 'auto',
        });
      }
      this.currentPage = location.page;
      this.pdfNavigationHistory.pop();
      this.updatePdfHistoryButton();
      this.container.tabIndex = -1;
      this.container.focus({ preventScroll: true });
      this.updatePageInfo();
      this.releaseCurrentPageTrackingLock(trackingToken, 'auto');
    } finally {
      this.historyBackButton.disabled = false;
    }
  }

  private updatePdfHistoryButton(): void {
    const previous = this.pdfNavigationHistory.at(-1);
    this.historyBackButton.hidden = !previous;
    this.historyBackButton.title = previous
      ? `Go back to page ${previous.page}`
      : 'Go back to previous PDF location';
    this.historyBackButton.setAttribute(
      'aria-label',
      previous ? `Go back to page ${previous.page}` : 'Go back to previous PDF location',
    );
  }

  private async goToPage(
    page: number,
    options: { scrollCurrentView?: boolean; behavior?: ScrollBehavior } = {},
  ): Promise<boolean> {
    if (!pdfDoc) return false;
    const runId = ++this.pageNavigationRunId;
    const target = Math.max(1, Math.min(pdfDoc.pageCount, page));
    const trackingToken = this.beginCurrentPageTrackingLock();
    this.currentPage = target;
    this.applyViewMode();
    this.updatePageInfo();
    if (this.fitMode !== 'custom') {
      await this.reapplyFitMode();
    } else {
      await this.renderVisiblePages();
    }
    const behavior = options.behavior ?? 'smooth';
    if (runId !== this.pageNavigationRunId) {
      this.releaseCurrentPageTrackingLock(trackingToken, 'auto');
      return false;
    }
    if (this.fitMode === 'custom' && options.scrollCurrentView !== false) {
      this.scrollCurrentViewIntoView(behavior, this.continuousScroll ? 'center' : 'nearest');
    }
    this.updatePageInfo();
    this.releaseCurrentPageTrackingLock(
      trackingToken,
      options.scrollCurrentView === false ? 'auto' : behavior,
    );
    return true;
  }

  private zoom(delta: number): void {
    this.cancelPinchZoom();
    this.fitMode = 'custom';
    this.scale = Math.max(0.1, Math.min(3.5, this.scale + delta));
    void this.rerender();
  }

  private setActualSize(): void {
    this.cancelPinchZoom();
    this.fitMode = 'custom';
    this.scale = 1;
    void this.rerender();
  }

  private toggleAutomaticResize(): void {
    if (this.fitMode === 'custom') {
      this.fitPage();
      return;
    }
    this.fitMode = 'custom';
    this.updatePageInfo();
  }

  private fitWidth(): void {
    this.cancelPinchZoom();
    this.fitMode = 'width';
    void this.reapplyFitMode();
  }

  private fitHeight(): void {
    this.cancelPinchZoom();
    this.fitMode = 'height';
    void this.reapplyFitMode();
  }

  private fitPage(): void {
    this.cancelPinchZoom();
    this.fitMode = 'page';
    void this.reapplyFitMode();
  }

  private async reapplyFitMode(): Promise<void> {
    if (this.fitMode === 'custom') return;
    const targetPages = this.fitTargetPageNumbers()
      .map(page => this.pages.get(page))
      .filter((page): page is PageState => Boolean(page));
    if (!targetPages.length) return;
    const spreadGap = targetPages.length > 1 && this.continuousScroll ? PDF_PAGE_GAP_PX : 0;
    const contentWidth = targetPages.reduce((sum, page) => sum + Number(page.pageObj.size.width), 0);
    const contentHeight = Math.max(...targetPages.map(page => Number(page.pageObj.size.height)));
    const availableWidth = Math.max(1, this.container.clientWidth - PDF_FIT_HORIZONTAL_PADDING_PX);
    const availableHeight = Math.max(1, this.container.clientHeight - PDF_FIT_VERTICAL_PADDING_PX);
    const widthScale = Math.max(1, availableWidth - spreadGap) / Math.max(1, contentWidth);
    const heightScale = availableHeight / Math.max(1, contentHeight);
    const nextScale = this.fitMode === 'width'
      ? widthScale
      : this.fitMode === 'height'
        ? heightScale
        : Math.min(widthScale, heightScale);
    this.scale = clamp(nextScale, 0.1, 3.5);
    await this.rerender();
  }

  private async rerender(pinchAnchor?: PdfPinchZoomAnchor): Promise<void> {
    const runId = ++this.rerenderRunId;
    const navigationRunId = this.pageNavigationRunId;
    const activePage = this.currentPage;
    const trackingToken = this.beginCurrentPageTrackingLock();
    for (const page of this.pages.values()) {
      page.renderGeneration++;
      page.rendered = false;
      this.applyPageLayout(page);
      page.textLayer.innerHTML = '';
      page.highlightLayer.innerHTML = '';
    }
    this.applyViewMode();
    await this.renderVisiblePages();
    if (runId !== this.rerenderRunId || navigationRunId !== this.pageNavigationRunId) {
      this.releaseCurrentPageTrackingLock(trackingToken, 'auto');
      return;
    }
    this.currentPage = activePage;
    if (!pinchAnchor || !this.restorePinchZoomAnchor(pinchAnchor)) {
      this.scrollCurrentViewIntoView('auto', this.continuousScroll ? 'center' : 'nearest');
    }
    this.redrawAllHighlights();
    this.redrawAllSearchHighlights();
    this.redrawAllDiscussionMarkers();
    this.refreshSelectionAfterRender();
    this.updatePageInfo();
    this.releaseCurrentPageTrackingLock(trackingToken, 'auto');
  }

  private restorePinchZoomAnchor(
    anchor: PdfPinchZoomAnchor,
    effectiveScale = this.pinchZoomVisualScale ?? this.scale,
  ): boolean {
    const viewport = this.container.getBoundingClientRect();
    let left: number;
    let top: number;
    if (
      anchor.page !== undefined
      && anchor.pdfX !== undefined
      && anchor.pdfY !== undefined
    ) {
      const wrapper = this.pages.get(anchor.page)?.wrapper;
      if (!wrapper || wrapper.style.display === 'none') return false;
      const bounds = wrapper.getBoundingClientRect();
      left = this.container.scrollLeft + bounds.left + anchor.pdfX * effectiveScale - anchor.clientX;
      top = this.container.scrollTop + bounds.top + anchor.pdfY * effectiveScale - anchor.clientY;
    } else {
      const scaleRatio = effectiveScale / Math.max(0.0001, anchor.scale);
      left = anchor.contentX * scaleRatio - (anchor.clientX - viewport.left);
      top = anchor.contentY * scaleRatio - (anchor.clientY - viewport.top);
    }
    const maxLeft = Math.max(0, this.container.scrollWidth - this.container.clientWidth);
    const maxTop = Math.max(0, this.container.scrollHeight - this.container.clientHeight);
    this.container.scrollTo({
      left: clamp(left, 0, maxLeft),
      top: clamp(top, 0, maxTop),
      behavior: 'auto',
    });
    return true;
  }

  private refreshSelectionAfterRender(): void {
    const selection = this.selectionState;
    if (!selection) return;
    this.applyNativeSelection(selection);
    this.drawSelectionOverlays();
    const current = this.selectionAnchorFromState();
    if (!current) return;
    this.latestSelectionAnchor = current.anchor;
    if (!this.directHighlight && !current.anchor.multiPage) {
      this.showSelectionToolbar(
        current.anchor,
        this.selectionViewportRect(current.anchor) ?? current.range.getBoundingClientRect(),
      );
    }
  }

  private updatePageInfo(): void {
    const total = pdfDoc?.pageCount ?? 0;
    this.pageInfo.textContent = total ? `Page ${this.currentPage} / ${total}  ${Math.round(this.scale * 100)}%` : '';
    if (document.activeElement !== this.pageInput) {
      this.pageInput.value = String(this.currentPage);
    }
    this.pageInput.max = String(Math.max(1, total));
    this.pageInput.setAttribute('aria-valuenow', String(this.currentPage));
    this.pageTotal.textContent = `of ${total}`;
    const zoomPercentage = Math.round(this.scale * 100);
    if (document.activeElement !== this.zoomInput) {
      this.zoomInput.value = String(zoomPercentage);
    }
    this.zoomInput.setAttribute('aria-valuenow', String(zoomPercentage));
    this.zoomInput.setAttribute('aria-valuetext', `${zoomPercentage}%`);
    const previous = document.getElementById('prev') as HTMLButtonElement | null;
    const next = document.getElementById('next') as HTMLButtonElement | null;
    if (previous) previous.disabled = this.navigationTarget(-1) === undefined;
    if (next) next.disabled = this.navigationTarget(1) === undefined;
    for (const page of this.pages.values()) {
      if (page.pageNum === this.currentPage) page.thumbnailButton.setAttribute('aria-current', 'page');
      else page.thumbnailButton.removeAttribute('aria-current');
    }
    if (!this.sidebar.hidden) {
      this.pages.get(this.currentPage)?.thumbnailButton.scrollIntoView({ block: 'nearest' });
    }
    this.updateToolbarState();
    this.persistViewerState();
    vscode.postMessage({ type: 'pageChanged', page: this.currentPage, totalPages: total });
  }

  private async toggleContinuousScroll(): Promise<void> {
    await this.setContinuousScroll(!this.continuousScroll);
  }

  private async setContinuousScroll(continuous: boolean): Promise<void> {
    await this.setPresentationMode(
      this.twoPageView
        ? continuous ? 'two-continuous' : 'two'
        : continuous ? 'single-continuous' : 'single',
    );
  }

  private async setScrollMode(mode: 'vertical' | 'horizontal' | 'wrapped'): Promise<void> {
    this.scrollMode = mode;
    this.continuousScroll = true;
    if (mode !== 'vertical') this.twoPageView = false;
    this.applyViewMode();
    if (this.fitMode === 'custom') await this.renderVisiblePages();
    else await this.reapplyFitMode();
    this.scrollCurrentViewIntoView('smooth', 'center');
    this.updatePageInfo();
  }

  private async toggleTwoPageView(): Promise<void> {
    await this.setPresentationMode(
      this.continuousScroll
        ? this.twoPageView ? 'single-continuous' : 'two-continuous'
        : this.twoPageView ? 'single' : 'two',
    );
  }

  private async setSpreadMode(twoPage: boolean, parity: 'odd' | 'even'): Promise<void> {
    void parity;
    await this.setPresentationMode(
      this.continuousScroll
        ? twoPage ? 'two-continuous' : 'single-continuous'
        : twoPage ? 'two' : 'single',
    );
  }

  private async setPresentationMode(mode: PdfPresentationMode): Promise<void> {
    const policy = pdfPresentationPolicy(mode);
    this.continuousScroll = policy.continuousScroll;
    this.twoPageView = policy.twoPageView;
    this.spreadParity = policy.spreadParity;
    this.scrollMode = policy.scrollMode;
    this.resetPaginatedWheelGesture();
    if (this.fitMode !== 'custom') {
      await this.reapplyFitMode();
      this.scrollCurrentViewIntoView('smooth', 'nearest');
      return;
    }
    this.applyViewMode();
    await this.renderVisiblePages();
    this.scrollCurrentViewIntoView('smooth', 'nearest');
    this.updatePageInfo();
  }

  private presentationMode(): PdfPresentationMode {
    return pdfPresentationMode(this.continuousScroll, this.twoPageView);
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
    return pdfSpreadPageNumbers(this.currentPage, pdfDoc.pageCount, this.spreadParity);
  }

  private navigationTarget(direction: -1 | 1): number | undefined {
    if (!pdfDoc) return undefined;
    return pdfNavigationTarget(
      this.currentPage,
      direction,
      pdfDoc.pageCount,
      this.twoPageView,
      this.spreadParity,
    );
  }

  private fitTargetPageNumbers(): number[] {
    if (!pdfDoc) return [];
    if (!this.twoPageView) return [this.currentPage];
    return this.spreadPageNumbers(this.currentPage);
  }

  private spreadPageNumbers(page: number): number[] {
    if (!pdfDoc) return [];
    return pdfSpreadPageNumbers(page, pdfDoc.pageCount, this.spreadParity);
  }

  private scrollCurrentViewIntoView(
    behavior: ScrollBehavior,
    block: 'center' | 'nearest',
  ): void {
    const pageNumbers = this.twoPageView
      ? this.spreadPageNumbers(this.currentPage)
      : [this.currentPage];
    const wrappers = pageNumbers
      .map(pageNumber => this.pages.get(pageNumber)?.wrapper)
      .filter((wrapper): wrapper is HTMLDivElement => Boolean(wrapper));
    if (wrappers.length <= 1) {
      wrappers[0]?.scrollIntoView({ behavior, block, inline: 'center' });
      return;
    }

    const bounds = wrappers.map(wrapper => wrapper.getBoundingClientRect());
    const viewport = this.container.getBoundingClientRect();
    const left = Math.min(...bounds.map(rect => rect.left));
    const right = Math.max(...bounds.map(rect => rect.right));
    const top = Math.min(...bounds.map(rect => rect.top));
    const bottom = Math.max(...bounds.map(rect => rect.bottom));
    const targetLeft = this.container.scrollLeft
      + ((left + right) / 2 - (viewport.left + viewport.right) / 2);
    let targetTop = this.container.scrollTop;
    if (block === 'center') {
      targetTop += (top + bottom) / 2 - (viewport.top + viewport.bottom) / 2;
    } else if (top < viewport.top) {
      targetTop += top - viewport.top;
    } else if (bottom > viewport.bottom) {
      targetTop += bottom - viewport.bottom;
    }
    this.container.scrollTo({
      left: Math.max(0, targetLeft),
      top: Math.max(0, targetTop),
      behavior,
    });
  }

  private beginCurrentPageTrackingLock(): number {
    if (this.currentPageTrackingReleaseTimer !== undefined) {
      window.clearTimeout(this.currentPageTrackingReleaseTimer);
      this.currentPageTrackingReleaseTimer = undefined;
    }
    const token = ++this.currentPageTrackingSequence;
    this.currentPageTrackingLock = token;
    return token;
  }

  private releaseCurrentPageTrackingLock(token: number, behavior: ScrollBehavior): void {
    const release = () => {
      if (this.currentPageTrackingLock !== token) return;
      this.currentPageTrackingLock = undefined;
      if (this.currentPageTrackingReleaseTimer !== undefined) {
        window.clearTimeout(this.currentPageTrackingReleaseTimer);
        this.currentPageTrackingReleaseTimer = undefined;
      }
    };
    if (behavior === 'smooth') {
      this.currentPageTrackingReleaseTimer = window.setTimeout(release, 600);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(release));
  }

  private applyViewMode(): void {
    const useAlternativeContinuousFlow = this.continuousScroll && !this.twoPageView;
    this.pageContainer.classList.toggle('paginated', !this.continuousScroll);
    this.pageContainer.classList.toggle('two-page', this.twoPageView);
    this.pageContainer.classList.toggle(
      'scroll-horizontal',
      useAlternativeContinuousFlow && this.scrollMode === 'horizontal',
    );
    this.pageContainer.classList.toggle(
      'scroll-wrapped',
      useAlternativeContinuousFlow && this.scrollMode === 'wrapped',
    );
    this.pageContainer.dataset.spreadParity = this.spreadParity;
    const visible = new Set(this.visiblePageNumbers());
    for (const page of this.pages.values()) {
      page.wrapper.style.display = this.continuousScroll || visible.has(page.pageNum) ? '' : 'none';
      page.wrapper.style.gridColumn = '';
      page.wrapper.style.gridRow = '';
      if (this.twoPageView) {
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
    checkedActions.add(`presentation-${this.presentationMode()}`);
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

function nextAnimationFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
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

function isEditableTarget(value: EventTarget | null): boolean {
  const element = value instanceof HTMLElement ? value : null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function recordValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
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

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]!));
}
