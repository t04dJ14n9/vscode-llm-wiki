import { createPluginRegistration, type PluginRegistry } from '@embedpdf/core';
import { EmbedPDF, useRegistry } from '@embedpdf/core/react';
import { usePdfiumEngine } from '@embedpdf/engines/react';
import { formatUnknownError, structuredErrorCode } from '@llm-wiki/core';
import {
  PdfActionType,
  PdfAnnotationSubtype,
  PdfErrorCode,
  PdfZoomMode,
  type PdfBookmarkObject,
  type PdfDestinationObject,
  type PdfDocumentObject,
  type PdfLinkAnnoObject,
  type PdfPageGeometry,
  type Rect,
} from '@embedpdf/models';
import {
  BookmarkPluginPackage,
  useBookmarkCapability,
} from '@embedpdf/plugin-bookmark/react';
import {
  DocumentContent,
  DocumentManagerPluginPackage,
} from '@embedpdf/plugin-document-manager/react';
import {
  InteractionManagerPluginPackage,
  PagePointerProvider,
} from '@embedpdf/plugin-interaction-manager/react';
import { PanMode, PanPluginPackage, usePan } from '@embedpdf/plugin-pan/react';
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react';
import {
  Scroller,
  ScrollPluginPackage,
  useScroll,
} from '@embedpdf/plugin-scroll/react';
import {
  SearchLayer,
  SearchPluginPackage,
  useSearch,
} from '@embedpdf/plugin-search/react';
import {
  SelectionLayer,
  SelectionPluginPackage,
  type SelectionCapability,
  type SelectionSelectionMenuProps,
  useSelectionCapability,
} from '@embedpdf/plugin-selection/react';
import {
  SpreadMode,
  SpreadPluginPackage,
  useSpread,
} from '@embedpdf/plugin-spread/react';
import {
  ThumbImg,
  ThumbnailPluginPackage,
  ThumbnailsPane,
} from '@embedpdf/plugin-thumbnail/react';
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import {
  MarqueeZoom,
  ZoomGestureWrapper,
  ZoomMode,
  ZoomPluginPackage,
  useZoom,
} from '@embedpdf/plugin-zoom/react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
  normalizePdfQueryAnnotations,
  type PdfQueryAnnotation,
} from '../webview/pdfQueryAnnotations';

interface EmbedPdfFormattedSelection {
  pageIndex: number;
  segmentRects: Array<{
    origin: { x: number; y: number };
    size: { width: number; height: number };
  }>;
}

interface PdfAnchor {
  area?: boolean;
  page: number;
  rects: number[][];
  snippet: string;
  multiPage: boolean;
}

declare const acquireVsCodeApi: () => {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

declare global {
  interface Window {
    __embedPdfSpike?: {
      registry: PluginRegistry;
      selection: SelectionCapability;
      formatError(value: unknown): string;
    };
    __pdfiumWasmUrl?: string;
  }
}

const vscode = acquireVsCodeApi();
const root = document.getElementById('embedpdf-spike-root') ?? document.body.appendChild(
  Object.assign(document.createElement('div'), { id: 'embedpdf-spike-root' }),
);
const reactRoot = createRoot(root);
let latestAnchor: PdfAnchor | undefined;
const pendingViewerMessages: unknown[] = [];

root.style.width = '100%';
root.style.height = '100%';
installHeadlessStyles();

window.addEventListener('message', event => {
  const message = event.data;
  if (message?.type !== 'loadPdf') {
    pendingViewerMessages.push(message);
    window.dispatchEvent(new CustomEvent('embedpdf-host-message', { detail: message }));
    return;
  }
  const buffer = pdfArrayBuffer(message.data);
  if (!buffer) {
    vscode.postMessage({ type: 'error', message: 'The PDF byte payload is invalid.' });
    return;
  }
  reactRoot.render(<HeadlessPdfViewer buffer={buffer} />);
});

vscode.postMessage({ type: 'ready' });

function HeadlessPdfViewer({ buffer }: { buffer: ArrayBuffer }): React.JSX.Element {
  const { engine, isLoading, error } = usePdfiumEngine({
    worker: false,
    wasmUrl: window.__pdfiumWasmUrl,
  });
  const plugins = useMemo(() => [
    createPluginRegistration(DocumentManagerPluginPackage, {
      initialDocuments: [{
        buffer,
        name: 'document.pdf',
        documentId: 'llm-wiki-document',
      }],
    }),
    createPluginRegistration(ViewportPluginPackage),
    createPluginRegistration(SpreadPluginPackage, {
      defaultSpreadMode: SpreadMode.None,
    }),
    createPluginRegistration(ScrollPluginPackage, {
      defaultPageGap: 12,
    }),
    createPluginRegistration(RenderPluginPackage),
    createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(SelectionPluginPackage),
    createPluginRegistration(ZoomPluginPackage, {
      defaultZoomLevel: ZoomMode.FitPage,
      minZoom: 0.1,
      maxZoom: 3.5,
      zoomStep: 0.15,
    }),
    createPluginRegistration(PanPluginPackage, { defaultMode: 'never' }),
    createPluginRegistration(SearchPluginPackage, { showAllResults: true }),
    createPluginRegistration(ThumbnailPluginPackage, {
      width: 116,
      gap: 10,
      labelHeight: 18,
      autoScroll: true,
    }),
    createPluginRegistration(BookmarkPluginPackage),
  ], [buffer]);

  useEffect(() => {
    if (!error) return;
    vscode.postMessage({ type: 'error', message: formatUnknownError(error, 'PDF engine failed') });
  }, [error]);

  if (isLoading || !engine) return <div className="embedpdf-loading">Loading PDF engine…</div>;

  return (
    <EmbedPDF engine={engine} plugins={plugins}>
      {({ activeDocumentId }) => activeDocumentId && (
        <DocumentContent documentId={activeDocumentId}>
          {({ isLoaded, documentState }) => isLoaded && documentState.document && (
            <HeadlessDocument
              documentId={activeDocumentId}
              document={documentState.document}
            />
          )}
        </DocumentContent>
      )}
    </EmbedPDF>
  );
}

type PresentationMode = 'single' | 'single-continuous' | 'two' | 'two-continuous';
const PRESENTATION_OPTIONS: ReadonlyArray<readonly [PresentationMode, string]> = [
  ['single', 'Single Page'],
  ['single-continuous', 'Single Page Continuous'],
  ['two', 'Two Pages'],
  ['two-continuous', 'Two Pages Continuous'],
];
type SidebarMode = 'thumbnails' | 'outline';
type ReduceAnimation = 'on' | 'off' | 'system';

interface ToolbarPreference {
  dock: 'top' | 'left';
  hidden: boolean;
}

interface PdfViewLocation {
  page: number;
}

interface AnchorHighlight {
  page: number;
  rects: number[][];
  key: number;
}

interface ColumnSelection {
  page: number;
  rects: number[][];
  text: string;
  phase: 'corridor' | 'drag' | 'committed';
}

interface AreaSelection {
  page: number;
  rect: number[];
}

interface PaginatedTransition {
  targetPage: number;
  direction: 'forward' | 'backward';
}

interface ColumnDragStart {
  pageIndex: number;
  x: number;
  y: number;
  generation: number;
  rectangular: boolean;
  pointerId: number;
  captured: boolean;
}

interface ColumnPreviewRequest {
  pageIndex: number;
  rect: Rect;
  generation: number;
  version: number;
}

function HeadlessDocument({
  documentId,
  document,
}: {
  documentId: string;
  document: PdfDocumentObject;
}): React.JSX.Element {
  const { registry } = useRegistry();
  const { provides: scroll, state: scrollState } = useScroll(documentId);
  const { provides: zoom, state: zoomState } = useZoom(documentId);
  const { provides: spread, spreadMode } = useSpread(documentId);
  const { provides: pan, isPanning } = usePan(documentId);
  const { provides: search, state: searchState } = useSearch(documentId);
  const { provides: selectionCapability } = useSelectionCapability();
  const { provides: bookmarks } = useBookmarkCapability();
  const [presentation, setPresentation] = useState<PresentationMode>('single-continuous');
  const [paginatedPage, setPaginatedPage] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('thumbnails');
  const [displayMenuOpen, setDisplayMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [outline, setOutline] = useState<PdfBookmarkObject[]>([]);
  const [history, setHistory] = useState<PdfViewLocation[]>([]);
  const [queryAnnotations, setQueryAnnotations] = useState<PdfQueryAnnotation[]>([]);
  const [anchorHighlight, setAnchorHighlight] = useState<AnchorHighlight>();
  const [columnSelection, setColumnSelection] = useState<ColumnSelection>();
  const [areaSelection, setAreaSelection] = useState<AreaSelection>();
  const [paginatedTransition, setPaginatedTransition] = useState<PaginatedTransition>();
  const [adaptTheme, setAdaptTheme] = useState(false);
  const [reduceAnimation, setReduceAnimation] = useState<ReduceAnimation>('system');
  const [toolbarPreference, setToolbarPreference] = useState<ToolbarPreference>({
    dock: 'top',
    hidden: false,
  });
  const [pageDraft, setPageDraft] = useState('1');
  const [zoomDraft, setZoomDraft] = useState('100');
  const columnDragStart = useRef<ColumnDragStart | undefined>(undefined);
  const columnDragGeneration = useRef(0);
  const columnPreviewVersion = useRef(0);
  const columnPreviewFrame = useRef<number | undefined>(undefined);
  const pendingColumnPreview = useRef<ColumnPreviewRequest | undefined>(undefined);
  const columnGeometryCache = useRef(new Map<number, Promise<PdfPageGeometry>>());
  const paginatedWheelDelta = useRef(0);
  const paginatedWheelLocked = useRef(false);
  const paginatedWheelIdleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const continuous = presentation.endsWith('continuous');
  const twoPage = presentation.startsWith('two');
  const currentPage = continuous ? scrollState.currentPage : paginatedPage;
  const paginatedLayout = useMemo(() => {
    if (continuous || !scroll) return undefined;
    const items = scroll.getLayout().virtualItems;
    const activeItemIndex = items.findIndex(item => (
      item.pageNumbers.includes(currentPage)
    ));
    if (activeItemIndex < 0) return undefined;
    return {
      activeItem: items[activeItemIndex]!,
      bufferedItems: items.slice(
        Math.max(0, activeItemIndex - 1),
        Math.min(items.length, activeItemIndex + 2),
      ),
    };
  }, [continuous, currentPage, scroll, spreadMode]);
  const smoothBehavior: ScrollBehavior = shouldReduceAnimation(reduceAnimation)
    ? 'auto'
    : 'smooth';

  const resetPaginatedWheel = useCallback((): void => {
    paginatedWheelDelta.current = 0;
    paginatedWheelLocked.current = false;
    if (paginatedWheelIdleTimer.current !== undefined) {
      clearTimeout(paginatedWheelIdleTimer.current);
      paginatedWheelIdleTimer.current = undefined;
    }
  }, []);

  const clearAreaSelection = useCallback((notifyHost = true): void => {
    setAreaSelection(undefined);
    if (!latestAnchor?.area) return;
    latestAnchor = undefined;
    if (notifyHost) vscode.postMessage({ type: 'selectionChanged' });
  }, []);

  useEffect(() => setPageDraft(String(currentPage)), [currentPage]);
  useEffect(() => {
    setZoomDraft(String(Math.round(zoomState.currentZoomLevel * 100)));
  }, [zoomState.currentZoomLevel]);

  useEffect(() => {
    columnGeometryCache.current.clear();
    return () => {
      if (columnPreviewFrame.current !== undefined) {
        cancelAnimationFrame(columnPreviewFrame.current);
        columnPreviewFrame.current = undefined;
      }
    };
  }, [document]);

  useEffect(() => {
    if (continuous) resetPaginatedWheel();
    return () => {
      if (paginatedWheelIdleTimer.current !== undefined) {
        clearTimeout(paginatedWheelIdleTimer.current);
        paginatedWheelIdleTimer.current = undefined;
      }
    };
  }, [continuous, resetPaginatedWheel]);

  useEffect(() => {
    if (continuous) return;
    const frameId = requestAnimationFrame(() => {
      const frame = globalThis.document.querySelector<HTMLElement>('.embedpdf-paginated-frame');
      if (!frame) return;
      frame.scrollLeft = Math.max(0, (frame.scrollWidth - frame.clientWidth) / 2);
      frame.scrollTop = paginatedTransition?.targetPage === currentPage
        && paginatedTransition.direction === 'backward'
        ? Math.max(0, frame.scrollHeight - frame.clientHeight)
        : 0;
    });
    return () => cancelAnimationFrame(frameId);
  }, [continuous, currentPage, paginatedTransition, spreadMode, twoPage]);

  useEffect(() => {
    if (!bookmarks) return;
    let active = true;
    vscode.postMessage({ type: 'pdfOutline', items: [], loading: true });
    const task = bookmarks.forDocument(documentId).getBookmarks();
    task.wait(result => {
      if (!active) return;
      setOutline(result.bookmarks);
      vscode.postMessage({
        type: 'pdfOutline',
        items: serializePdfOutline(result.bookmarks),
        inferred: false,
        loading: false,
      });
    }, () => {
      if (!active) return;
      setOutline([]);
      vscode.postMessage({ type: 'pdfOutline', items: [], inferred: false, loading: false });
    });
    return () => {
      active = false;
      task.abort({ code: 1, message: 'Viewer disposed' });
    };
  }, [bookmarks, documentId]);

  useEffect(() => {
    if (!selectionCapability) return;
    const scope = selectionCapability.forDocument(documentId);
    const stopMarqueeEnd = scope.onMarqueeEnd(({ pageIndex, rect }) => {
      if (rect.size.width < 2 || rect.size.height < 2) return;
      const next: AreaSelection = {
        page: pageIndex + 1,
        rect: rectArray(rect),
      };
      setColumnSelection(undefined);
      setAreaSelection(next);
      publishAreaSelection(next);
    });
    const stopEmptySpaceClick = scope.onEmptySpaceClick(() => clearAreaSelection());
    return () => {
      stopMarqueeEnd();
      stopEmptySpaceClick();
    };
  }, [clearAreaSelection, documentId, selectionCapability]);

  const goToPage = useCallback((
    page: number,
    behavior: ScrollBehavior = smoothBehavior,
    modeContinuous = continuous,
  ) => {
    if (!scroll) return;
    const target = Math.max(1, Math.min(document.pageCount, Math.round(page)));
    if (!modeContinuous && target !== currentPage) {
      setPaginatedTransition({
        targetPage: target,
        direction: target > currentPage ? 'forward' : 'backward',
      });
    }
    if (!modeContinuous) {
      setPaginatedPage(target);
      return;
    }
    scroll.scrollToPage({ pageNumber: target, behavior, alignY: 0 });
    const applyViewportPosition = (): boolean => {
      const viewport = globalThis.document.querySelector<HTMLElement>('.embedpdf-headless-viewport');
      const item = scroll.getLayout().virtualItems.find(candidate => candidate.pageNumbers.includes(target));
      if (!viewport || !item || viewport.scrollHeight <= viewport.clientHeight) return false;
      const scaledOffset = item.offset * zoomState.currentZoomLevel;
      const scaledHeight = item.height * zoomState.currentZoomLevel;
      const scaledWidth = item.width * zoomState.currentZoomLevel;
      const centeredOffset = scaledOffset - Math.max(0, (viewport.clientHeight - scaledHeight) / 2);
      viewport.scrollTo({
        top: Math.max(0, modeContinuous ? scaledOffset : centeredOffset),
        left: Math.max(0, item.x * zoomState.currentZoomLevel - Math.max(0, (viewport.clientWidth - scaledWidth) / 2)),
        behavior: modeContinuous ? behavior : 'auto',
      });
      requestAnimationFrame(() => {
        const renderedPage = globalThis.document.querySelector<HTMLElement>(
          `.embedpdf-headless-page[data-page-index="${target - 1}"]`,
        );
        if (!renderedPage) return;
        const viewportBounds = viewport.getBoundingClientRect();
        const pageBounds = renderedPage.getBoundingClientRect();
        const desiredTop = modeContinuous
          ? viewportBounds.top + 10
          : viewportBounds.top + Math.max(0, (viewportBounds.height - pageBounds.height) / 2);
        viewport.scrollBy({ top: pageBounds.top - desiredTop, behavior: 'auto' });
      });
      return true;
    };
    if (!applyViewportPosition()) {
      window.setTimeout(() => {
        if (!applyViewportPosition()) window.setTimeout(applyViewportPosition, 180);
      }, 40);
    }
  }, [continuous, currentPage, document.pageCount, scroll, smoothBehavior, zoomState.currentZoomLevel]);

  const applyDestination = useCallback((destination: PdfDestinationObject, remember = true) => {
    if (remember) setHistory(current => [...current.slice(-49), { page: currentPage }]);
    if (destination.zoom.mode === PdfZoomMode.XYZ) {
      const requested = destination.zoom.params.zoom;
      if (Number.isFinite(requested) && requested > 0) zoom?.requestZoom(requested);
    } else if (destination.zoom.mode === PdfZoomMode.FitPage) {
      zoom?.requestZoom(ZoomMode.FitPage);
    } else if (
      destination.zoom.mode === PdfZoomMode.FitHorizontal
      || destination.zoom.mode === PdfZoomMode.FitBoundingBoxHorizontal
    ) {
      zoom?.requestZoom(ZoomMode.FitWidth);
    }
    const coordinates = destination.zoom.mode === PdfZoomMode.XYZ
      ? { x: destination.zoom.params.x, y: destination.zoom.params.y }
      : undefined;
    goToPage(destination.pageIndex + 1);
    if (coordinates) {
      requestAnimationFrame(() => {
        const viewport = globalThis.document.querySelector<HTMLElement>('.embedpdf-headless-viewport');
        if (!viewport) return;
        viewport.scrollBy({
          left: coordinates.x * zoomState.currentZoomLevel,
          top: coordinates.y * zoomState.currentZoomLevel,
          behavior: smoothBehavior,
        });
      });
    }
  }, [currentPage, goToPage, smoothBehavior, zoom, zoomState.currentZoomLevel]);

  const navigate = useCallback((direction: -1 | 1) => {
    const step = twoPage ? 2 : 1;
    goToPage(currentPage + direction * step);
  }, [currentPage, goToPage, twoPage]);

  const applyPresentation = useCallback((mode: PresentationMode) => {
    const nextContinuous = mode.endsWith('continuous');
    resetPaginatedWheel();
    setPaginatedTransition(undefined);
    if (!nextContinuous) setPaginatedPage(currentPage);
    setPresentation(mode);
    spread?.setSpreadMode(mode.startsWith('two') ? SpreadMode.Even : SpreadMode.None);
    requestAnimationFrame(() => goToPage(currentPage, 'auto', nextContinuous));
  }, [currentPage, goToPage, resetPaginatedWheel, spread]);

  const goBack = useCallback(() => {
    setHistory(current => {
      const previous = current.at(-1);
      if (previous) goToPage(previous.page);
      return previous ? current.slice(0, -1) : current;
    });
  }, [goToPage]);

  const goToAnchor = useCallback((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const anchor = raw as Record<string, unknown>;
    const page = Number(anchor.page);
    if (Number.isSafeInteger(page) && page > 0) goToPage(page);
    const rects = normalizeAnchorRects(anchor.rects);
    if (rects.length && Number.isSafeInteger(page) && page > 0) {
      setAnchorHighlight({ page, rects, key: Date.now() });
    }
    const fragment = anchor.textFragment;
    if (!fragment || typeof fragment !== 'object' || !search) return;
    const textStart = (fragment as Record<string, unknown>).textStart;
    if (typeof textStart !== 'string' || !textStart.trim()) return;
    search.startSearch();
    search.searchAllPages(textStart.trim()).wait(result => {
      if (result.total > 0) search.goToResult(0);
    }, () => undefined);
  }, [goToPage, search]);

  useEffect(() => {
    const handleMessage = (message: any): void => {
      switch (message?.type) {
        case 'pdfToolbarPreference':
          setToolbarPreference(normalizeToolbarPreference(message.preference));
          break;
        case 'setQueryAnnotations':
          setQueryAnnotations(normalizePdfQueryAnnotations(message.annotations));
          break;
        case 'goToAnchor':
          goToAnchor(message.anchor ?? { page: message.page, textFragment: message.textFragment });
          break;
        case 'goToPdfDestination':
          if (message.destination) applyDestination(message.destination as PdfDestinationObject);
          break;
        case 'navigate':
          navigate(message.direction === 'prev' ? -1 : 1);
          break;
        case 'zoom':
          zoom?.requestZoomBy(Number(message.delta ?? 0));
          break;
        case 'fitWidth':
          zoom?.requestZoom(ZoomMode.FitWidth);
          break;
        case 'toggleContinuousScroll':
          applyPresentation(twoPage
            ? continuous ? 'two' : 'two-continuous'
            : continuous ? 'single' : 'single-continuous');
          break;
        case 'toggleTwoPageView':
          applyPresentation(continuous
            ? twoPage ? 'single-continuous' : 'two-continuous'
            : twoPage ? 'single' : 'two');
          break;
        case 'addSelectionToCursorChat':
          postSelectionAction('addToCursorChat');
          break;
        default:
          break;
      }
    };
    pendingViewerMessages.splice(0).forEach(handleMessage);
    const handleHostEvent = (event: Event): void => {
      handleMessage((event as CustomEvent).detail);
    };
    window.addEventListener('embedpdf-host-message', handleHostEvent);
    return () => window.removeEventListener('embedpdf-host-message', handleHostEvent);
  }, [applyDestination, applyPresentation, continuous, goToAnchor, navigate, twoPage, zoom]);

  useEffect(() => {
    vscode.postMessage({
      type: 'pageChanged',
      page: currentPage,
      totalPages: scrollState.totalPages,
    });
  }, [currentPage, scrollState.totalPages]);

  useEffect(() => {
    if (!search || !searchOpen) return;
    const timer = window.setTimeout(() => {
      const query = searchQuery.trim();
      if (!query) {
        search.stopSearch();
        return;
      }
      search.startSearch();
      search.searchAllPages(query).wait(() => undefined, () => undefined);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [search, searchOpen, searchQuery]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => globalThis.document.getElementById('embedpdf-search-input')?.focus());
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l' && !editing) {
        if (latestAnchor && !latestAnchor.multiPage) {
          event.preventDefault();
          postSelectionAction('addToCursorChat');
        }
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === 't' && !editing) {
        event.preventDefault();
        const next = { ...toolbarPreference, hidden: !toolbarPreference.hidden };
        setToolbarPreference(next);
        vscode.postMessage({ type: 'pdfToolbarPreferenceChanged', preference: next });
        return;
      }
      if (event.altKey && !editing && event.key.startsWith('Arrow')) {
        event.preventDefault();
        navigate(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (!continuous && !editing && event.key.startsWith('Arrow')) {
        event.preventDefault();
        navigate(event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1);
      }
      if (event.key === 'Escape') {
        setDisplayMenuOpen(false);
        setSearchOpen(false);
        clearAreaSelection();
      }
    };
    globalThis.document.addEventListener('keydown', handleKeyDown);
    return () => globalThis.document.removeEventListener('keydown', handleKeyDown);
  }, [clearAreaSelection, continuous, navigate, toolbarPreference]);

  const handlePaginatedWheel = (event: React.WheelEvent): void => {
    if (continuous) return;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(1, event.currentTarget.clientHeight)
        : 1;
    const delta = event.deltaY * unit;
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.1) return;
    const frame = event.currentTarget.querySelector<HTMLElement>('.embedpdf-paginated-frame');
    const maximumScrollTop = frame ? Math.max(0, frame.scrollHeight - frame.clientHeight) : 0;
    const canPanWithinPage = Boolean(frame) && maximumScrollTop > 4 && (
      delta < 0 ? frame!.scrollTop > 1 : frame!.scrollTop < maximumScrollTop - 1
    );
    if (canPanWithinPage) {
      resetPaginatedWheel();
      return;
    }
    event.preventDefault();
    if (paginatedWheelIdleTimer.current !== undefined) {
      clearTimeout(paginatedWheelIdleTimer.current);
    }
    paginatedWheelIdleTimer.current = setTimeout(() => {
      paginatedWheelDelta.current = 0;
      paginatedWheelLocked.current = false;
      paginatedWheelIdleTimer.current = undefined;
    }, 160);
    if (paginatedWheelLocked.current) return;
    paginatedWheelDelta.current += delta;
    if (Math.abs(paginatedWheelDelta.current) < 48) return;
    paginatedWheelLocked.current = true;
    const direction = paginatedWheelDelta.current < 0 ? -1 : 1;
    paginatedWheelDelta.current = 0;
    navigate(direction);
  };

  const commitPage = (): void => {
    const page = Number.parseInt(pageDraft, 10);
    if (Number.isFinite(page)) goToPage(page);
    else setPageDraft(String(currentPage));
  };
  const commitZoom = (): void => {
    const percentage = Number.parseFloat(zoomDraft);
    if (Number.isFinite(percentage)) zoom?.requestZoom(Math.max(0.1, Math.min(3.5, percentage / 100)));
    else setZoomDraft(String(Math.round(zoomState.currentZoomLevel * 100)));
  };

  const beginPotentialColumnSelection = (
    event: React.PointerEvent<HTMLDivElement>,
    pageIndex: number,
    scale: number,
  ): void => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    if ((event.target as HTMLElement | null)?.closest('.embedpdf-selection-menu')) return;
    clearAreaSelection();
    const bounds = event.currentTarget.getBoundingClientRect();
    columnDragStart.current = {
      pageIndex,
      x: (event.clientX - bounds.left) / scale,
      y: (event.clientY - bounds.top) / scale,
      generation: ++columnDragGeneration.current,
      rectangular: false,
      pointerId: event.pointerId,
      captured: false,
    };
    columnPreviewVersion.current += 1;
    pendingColumnPreview.current = undefined;
    if (columnPreviewFrame.current !== undefined) {
      cancelAnimationFrame(columnPreviewFrame.current);
      columnPreviewFrame.current = undefined;
    }
    setColumnSelection(undefined);
    void loadColumnGeometry(registry, document, pageIndex, columnGeometryCache.current);
  };

  const updatePotentialColumnSelection = (
    event: React.PointerEvent<HTMLDivElement>,
    pageIndex: number,
    scale: number,
  ): void => {
    const start = columnDragStart.current;
    if (!start || start.pageIndex !== pageIndex || !registry) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const end = {
      x: (event.clientX - bounds.left) / scale,
      y: (event.clientY - bounds.top) / scale,
    };
    const rect = columnDragRect(start, end);
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    if (!start.captured && Math.hypot(dx, dy) >= 3) {
      try {
        event.currentTarget.setPointerCapture(start.pointerId);
        start.captured = true;
      } catch {
        // The pointer may already have been cancelled by the host browser.
      }
    }
    if (dy < 8 || dx > Math.max(18, dy * 0.35)) return;

    // Give immediate feedback even before PDFium geometry has resolved. The
    // corridor is replaced with glyph-accurate boxes below as soon as the
    // page geometry is available.
    setColumnSelection({
      page: pageIndex + 1,
      rects: [rectArray(rect)],
      text: '',
      phase: 'corridor',
    });

    const request: ColumnPreviewRequest = {
      pageIndex,
      rect,
      generation: start.generation,
      version: ++columnPreviewVersion.current,
    };
    pendingColumnPreview.current = request;
    if (columnPreviewFrame.current !== undefined) return;
    columnPreviewFrame.current = requestAnimationFrame(() => {
      columnPreviewFrame.current = undefined;
      const pending = pendingColumnPreview.current;
      pendingColumnPreview.current = undefined;
      if (!pending) return;
      void loadColumnGeometry(registry, document, pending.pageIndex, columnGeometryCache.current)
        .then(geometry => {
          const active = columnDragStart.current;
          if (
            !active
            || active.generation !== pending.generation
            || pending.version !== columnPreviewVersion.current
          ) return;
          const result = rectangularRunsForGeometry(geometry, pending.rect);
          if (!active.rectangular) {
            if (result.rowCount < 3) return;
            if (!result.columnLike) {
              setColumnSelection(undefined);
              return;
            }
          }
          if (!active.rectangular) {
            active.rectangular = true;
            selectionCapability?.forDocument(documentId).clear();
          }
          if (!result.rects.length) return;
          setColumnSelection({
            page: pending.pageIndex + 1,
            rects: result.rects,
            text: '',
            phase: 'drag',
          });
        })
        .catch(() => undefined);
    });
  };

  const finishPotentialColumnSelection = (
    event: React.PointerEvent<HTMLDivElement>,
    pageIndex: number,
    scale: number,
  ): void => {
    const start = columnDragStart.current;
    columnDragStart.current = undefined;
    if (start?.captured && event.currentTarget.hasPointerCapture(start.pointerId)) {
      event.currentTarget.releasePointerCapture(start.pointerId);
    }
    columnPreviewVersion.current += 1;
    pendingColumnPreview.current = undefined;
    if (columnPreviewFrame.current !== undefined) {
      cancelAnimationFrame(columnPreviewFrame.current);
      columnPreviewFrame.current = undefined;
    }
    if (!start || start.pageIndex !== pageIndex || !registry) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const end = {
      x: (event.clientX - bounds.left) / scale,
      y: (event.clientY - bounds.top) / scale,
    };
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    if (dy < 18 || dx > Math.max(18, dy * 0.35)) return;
    const rect = columnDragRect(start, end);
    const generation = start.generation;
    void loadColumnGeometry(registry, document, pageIndex, columnGeometryCache.current)
      .then(geometry => extractRectangularText(
        registry,
        document,
        pageIndex,
        rect,
        geometry,
        start.rectangular ? 1 : 3,
      ))
      .then(result => {
        if (generation !== columnDragGeneration.current) return;
        if (!result || result.rowCount < 3) {
          setColumnSelection(undefined);
          return;
        }
        selectionCapability?.forDocument(documentId).clear();
        const next: ColumnSelection = {
          page: pageIndex + 1,
          rects: result.rects,
          text: result.text,
          phase: 'committed',
        };
        setColumnSelection(next);
        publishCustomSelection(next);
      })
      .catch(() => setColumnSelection(undefined));
  };

  const cancelPotentialColumnSelection = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = columnDragStart.current;
    columnDragStart.current = undefined;
    if (start?.captured && event.currentTarget.hasPointerCapture(start.pointerId)) {
      event.currentTarget.releasePointerCapture(start.pointerId);
    }
    columnPreviewVersion.current += 1;
    pendingColumnPreview.current = undefined;
    if (columnPreviewFrame.current !== undefined) {
      cancelAnimationFrame(columnPreviewFrame.current);
      columnPreviewFrame.current = undefined;
    }
    setColumnSelection(undefined);
  };

  const renderDocumentPage = (
    pageIndex: number,
    width: number,
    height: number,
    paginatedActive?: boolean,
  ): React.JSX.Element => {
    const scale = width / Math.max(1, document.pages[pageIndex]?.size.width ?? width);
    const interactive = paginatedActive !== false;
    return (
      <PagePointerProvider
        documentId={documentId}
        pageIndex={pageIndex}
        scale={scale}
        data-page-index={pageIndex}
        data-paginated-active={paginatedActive}
        className="embedpdf-headless-page"
        style={{ width, height }}
        onPointerDown={interactive
          ? event => beginPotentialColumnSelection(event, pageIndex, scale)
          : undefined}
        onPointerMove={interactive
          ? event => updatePotentialColumnSelection(event, pageIndex, scale)
          : undefined}
        onPointerUp={interactive
          ? event => finishPotentialColumnSelection(event, pageIndex, scale)
          : undefined}
        onPointerCancel={interactive ? cancelPotentialColumnSelection : undefined}
      >
        <RenderLayer
          documentId={documentId}
          pageIndex={pageIndex}
          scale={scale}
          draggable={false}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        />
        <SearchLayer documentId={documentId} pageIndex={pageIndex} scale={scale} />
        <PdfLinkLayer
          registry={registry}
          document={document}
          pageIndex={pageIndex}
          scale={scale}
          onDestination={applyDestination}
        />
        <PdfQueryLayer
          page={pageIndex + 1}
          scale={scale}
          annotations={queryAnnotations}
        />
        <AnchorHighlightLayer
          page={pageIndex + 1}
          scale={scale}
          highlight={anchorHighlight}
        />
        <AreaSelectionLayer
          documentId={documentId}
          page={pageIndex + 1}
          scale={scale}
          selection={areaSelection}
        />
        <ColumnSelectionLayer
          page={pageIndex + 1}
          scale={scale}
          selection={columnSelection}
        />
        <div className="embedpdf-native-selection-layer">
          <SelectionLayer
            documentId={documentId}
            pageIndex={pageIndex}
            scale={scale}
            textStyle={{
              background: 'var(--embedpdf-selection-fill)',
            }}
            marqueeStyle={{
              background: 'var(--embedpdf-selection-soft)',
              borderColor: 'var(--embedpdf-selection-edge)',
              borderStyle: 'solid',
            }}
            marqueeClassName="embedpdf-area-selection-marquee"
            selectionMenu={props => (
              <SelectionMenu {...props} documentId={documentId} />
            )}
          />
        </div>
        <MarqueeZoom documentId={documentId} pageIndex={pageIndex} />
      </PagePointerProvider>
    );
  };

  return (
    <div
      className={`embedpdf-headless-shell toolbar-${toolbarPreference.dock}`}
      data-toolbar-hidden={toolbarPreference.hidden}
      data-adapt-theme={adaptTheme}
      data-reduce-animation={shouldReduceAnimation(reduceAnimation)}
    >
      {!toolbarPreference.hidden && (
        <PdfToolbar
          currentPage={currentPage}
          totalPages={scrollState.totalPages}
          pageDraft={pageDraft}
          zoomDraft={zoomDraft}
          presentation={presentation}
          displayMenuOpen={displayMenuOpen}
          sidebarOpen={sidebarOpen}
          isPanning={isPanning}
          canGoBack={history.length > 0}
          adaptTheme={adaptTheme}
          reduceAnimation={reduceAnimation}
          dock={toolbarPreference.dock}
          onPageDraft={setPageDraft}
          onCommitPage={commitPage}
          onZoomDraft={setZoomDraft}
          onCommitZoom={commitZoom}
          onPrevious={() => navigate(-1)}
          onNext={() => navigate(1)}
          onZoomIn={() => zoom?.zoomIn()}
          onZoomOut={() => zoom?.zoomOut()}
          onToggleSidebar={() => setSidebarOpen(open => !open)}
          onToggleSearch={() => setSearchOpen(open => !open)}
          onTogglePan={() => pan?.togglePan()}
          onToggleDisplayMenu={() => setDisplayMenuOpen(open => !open)}
          onPresentation={mode => {
            applyPresentation(mode);
            setDisplayMenuOpen(false);
          }}
          onFit={mode => {
            zoom?.requestZoom(mode);
            setDisplayMenuOpen(false);
          }}
          onAdaptTheme={() => setAdaptTheme(value => !value)}
          onReduceAnimation={setReduceAnimation}
          onDock={dock => {
            const next = { dock, hidden: false };
            setToolbarPreference(next);
            vscode.postMessage({ type: 'pdfToolbarPreferenceChanged', preference: next });
          }}
          onBack={goBack}
        />
      )}
      <div className="embedpdf-viewer-shell">
        {sidebarOpen && (
          <PdfSidebar
            documentId={documentId}
            mode={sidebarMode}
            currentPage={currentPage}
            outline={outline}
            onMode={setSidebarMode}
            onClose={() => setSidebarOpen(false)}
            onPage={page => goToPage(page)}
            onDestination={applyDestination}
          />
        )}
        <div className="embedpdf-document-area">
          {searchOpen && (
            <PdfSearchBar
              query={searchQuery}
              state={searchState}
              onQuery={setSearchQuery}
              onPrevious={() => search?.previousResult()}
              onNext={() => search?.nextResult()}
              onClose={() => {
                setSearchOpen(false);
                search?.stopSearch();
              }}
            />
          )}
          <Viewport
            documentId={documentId}
            className={`embedpdf-headless-viewport${continuous ? '' : ' paginated'}`}
            style={{
              overflow: continuous ? 'auto' : 'hidden',
              padding: continuous ? 10 : 0,
            }}
            onWheel={handlePaginatedWheel}
          >
            <ZoomGestureWrapper documentId={documentId}>
              {continuous ? (
                <Scroller
                  documentId={documentId}
                  renderPage={({ width, height, pageIndex }) => (
                    renderDocumentPage(pageIndex, width, height)
                  )}
                />
              ) : paginatedLayout ? (
                <div className="embedpdf-paginated-frame">
                  <div
                    className="embedpdf-paginated-stage"
                    style={{
                      width: `max(100%, ${paginatedLayout.activeItem.width * zoomState.currentZoomLevel}px)`,
                      height: `max(100%, ${paginatedLayout.activeItem.height * zoomState.currentZoomLevel}px)`,
                    }}
                  >
                    {paginatedLayout.bufferedItems.map(item => {
                      const active = item.index === paginatedLayout.activeItem.index;
                      const transition = active
                        && paginatedTransition?.targetPage === currentPage
                        ? paginatedTransition.direction
                        : undefined;
                      return (
                        <div
                          className="embedpdf-paginated-spread"
                          data-paginated-active={active}
                          data-page-transition={transition}
                          aria-hidden={!active}
                          key={item.id}
                          style={{
                            gap: 12 * zoomState.currentZoomLevel,
                            visibility: active ? 'visible' : 'hidden',
                            pointerEvents: active ? 'auto' : 'none',
                          }}
                        >
                          {item.pageLayouts.map(layout => (
                            <React.Fragment key={layout.pageNumber}>
                              {renderDocumentPage(
                                layout.pageIndex,
                                layout.rotatedWidth * zoomState.currentZoomLevel,
                                layout.rotatedHeight * zoomState.currentZoomLevel,
                                active,
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </ZoomGestureWrapper>
          </Viewport>
          {history.length > 0 && toolbarPreference.hidden && (
            <button className="embedpdf-history-back floating" type="button" onClick={goBack} aria-label="Go back">
              ←
            </button>
          )}
        </div>
      </div>
      <PanMode />
      <SelectionBridge documentId={documentId} />
    </div>
  );
}

interface PdfToolbarProps {
  currentPage: number;
  totalPages: number;
  pageDraft: string;
  zoomDraft: string;
  presentation: PresentationMode;
  displayMenuOpen: boolean;
  sidebarOpen: boolean;
  isPanning: boolean;
  canGoBack: boolean;
  adaptTheme: boolean;
  reduceAnimation: ReduceAnimation;
  dock: ToolbarPreference['dock'];
  onPageDraft(value: string): void;
  onCommitPage(): void;
  onZoomDraft(value: string): void;
  onCommitZoom(): void;
  onPrevious(): void;
  onNext(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onToggleSidebar(): void;
  onToggleSearch(): void;
  onTogglePan(): void;
  onToggleDisplayMenu(): void;
  onPresentation(mode: PresentationMode): void;
  onFit(mode: ZoomMode): void;
  onAdaptTheme(): void;
  onReduceAnimation(value: ReduceAnimation): void;
  onDock(value: ToolbarPreference['dock']): void;
  onBack(): void;
}

function PdfToolbar(props: PdfToolbarProps): React.JSX.Element {
  const beginToolbarDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    let candidate = props.dock;
    const move = (pointer: PointerEvent): void => {
      candidate = pointer.clientX < 84 && pointer.clientY > 76 ? 'left' : 'top';
      globalThis.document.body.dataset.embedpdfToolbarDrag = candidate;
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      delete globalThis.document.body.dataset.embedpdfToolbarDrag;
      props.onDock(candidate);
    };
    const cancel = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      delete globalThis.document.body.dataset.embedpdfToolbarDrag;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
  };
  return (
    <div className="embedpdf-headless-toolbar" role="toolbar" aria-label="PDF toolbar">
      <button
        type="button"
        aria-label="Move PDF toolbar"
        title="Move PDF toolbar"
        className="toolbar-grip"
        onPointerDown={beginToolbarDrag}
      >⠿</button>
      <button type="button" aria-label="Toggle sidebar" aria-expanded={props.sidebarOpen} onClick={props.onToggleSidebar}>▤</button>
      <button type="button" aria-label="Search" title="Search" onClick={props.onToggleSearch}>⌕</button>
      <span className="toolbar-separator" />
      <div className="toolbar-group" aria-label="Zoom controls">
        <button type="button" aria-label="Zoom out" onClick={props.onZoomOut}>−</button>
        <label className="toolbar-number">
          <input
            aria-label="Zoom"
            inputMode="decimal"
            value={props.zoomDraft}
            onChange={event => props.onZoomDraft(event.currentTarget.value)}
            onBlur={props.onCommitZoom}
            onKeyDown={event => {
              if (event.key === 'Enter') props.onCommitZoom();
            }}
          />
          <span>%</span>
        </label>
        <button type="button" aria-label="Zoom in" onClick={props.onZoomIn}>+</button>
        <button
          type="button"
          aria-label="Display options"
          aria-expanded={props.displayMenuOpen}
          onClick={props.onToggleDisplayMenu}
        >⌄</button>
      </div>
      <span className="toolbar-separator" />
      <select
        className="toolbar-layout-select"
        aria-label="Page layout"
        title={`Page layout: ${PRESENTATION_OPTIONS.find(([mode]) => mode === props.presentation)?.[1] ?? ''}`}
        value={props.presentation}
        onChange={event => props.onPresentation(event.currentTarget.value as PresentationMode)}
      >
        {PRESENTATION_OPTIONS.map(([mode, label]) => (
          <option value={mode} key={mode}>{label}</option>
        ))}
      </select>
      <span className="toolbar-separator" />
      <div className="toolbar-group" aria-label="Page controls">
        <button type="button" aria-label="Previous page" disabled={props.currentPage <= 1} onClick={props.onPrevious}>‹</button>
        <label className="toolbar-number">
          <input
            aria-label="Page"
            inputMode="numeric"
            value={props.pageDraft}
            onChange={event => props.onPageDraft(event.currentTarget.value)}
            onBlur={props.onCommitPage}
            onKeyDown={event => {
              if (event.key === 'Enter') props.onCommitPage();
            }}
          />
          <span>of {props.totalPages}</span>
        </label>
        <button type="button" aria-label="Next page" disabled={props.currentPage >= props.totalPages} onClick={props.onNext}>›</button>
      </div>
      <span className="toolbar-separator" />
      <button
        type="button"
        aria-label="Pan tool"
        aria-pressed={props.isPanning}
        title="Pan tool"
        onClick={props.onTogglePan}
      >✋</button>
      {props.canGoBack && (
        <button type="button" className="embedpdf-history-back" aria-label="Go back" title="Go back" onClick={props.onBack}>←</button>
      )}
      <span className="toolbar-spacer" />
      <button
        type="button"
        className="cursor-chat-action"
        disabled={!latestAnchor || latestAnchor.multiPage}
        onClick={() => postSelectionAction('addToCursorChat')}
      >Add to Chat</button>
      <button type="button" disabled={!latestAnchor} onClick={() => vscode.postMessage({ type: 'copySelectionForAgent' })}>
        Copy for Agent
      </button>
      {props.displayMenuOpen && (
        <div className="embedpdf-display-menu" role="menu" aria-label="Display options">
          <div className="menu-section">View</div>
          {PRESENTATION_OPTIONS.map(([mode, label]) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={props.presentation === mode}
              key={mode}
              onClick={() => props.onPresentation(mode)}
            >{label}</button>
          ))}
          <div className="menu-section">Fit</div>
          <button type="button" role="menuitem" onClick={() => props.onFit(ZoomMode.FitWidth)}>Fit width</button>
          <button type="button" role="menuitem" onClick={() => props.onFit(ZoomMode.FitPage)}>Fit page</button>
          <div className="menu-section">Appearance</div>
          <button type="button" role="menuitemcheckbox" aria-checked={props.adaptTheme} onClick={props.onAdaptTheme}>
            Adapt to theme
          </button>
          <div className="menu-section">Reduce Animation</div>
          {(['on', 'off', 'system'] as const).map(value => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={props.reduceAnimation === value}
              key={value}
              onClick={() => props.onReduceAnimation(value)}
            >{value[0]!.toUpperCase() + value.slice(1)}</button>
          ))}
          <div className="menu-section">Toolbar</div>
          <button type="button" role="menuitemradio" aria-checked={props.dock === 'top'} onClick={() => props.onDock('top')}>Dock top</button>
          <button type="button" role="menuitemradio" aria-checked={props.dock === 'left'} onClick={() => props.onDock('left')}>Dock left</button>
        </div>
      )}
    </div>
  );
}

function PdfSearchBar({
  query,
  state,
  onQuery,
  onPrevious,
  onNext,
  onClose,
}: {
  query: string;
  state: { total: number; activeResultIndex: number; loading: boolean };
  onQuery(value: string): void;
  onPrevious(): void;
  onNext(): void;
  onClose(): void;
}): React.JSX.Element {
  return (
    <div className="embedpdf-search" role="search" aria-label="Find in PDF">
      <input
        id="embedpdf-search-input"
        type="search"
        aria-label="Find in PDF"
        placeholder="Find"
        value={query}
        onChange={event => onQuery(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') event.shiftKey ? onPrevious() : onNext();
          if (event.key === 'Escape') onClose();
        }}
        autoFocus
      />
      <button type="button" aria-label="Previous match" onClick={onPrevious}>↑</button>
      <button type="button" aria-label="Next match" onClick={onNext}>↓</button>
      <span className="search-count">
        {state.loading ? '…' : state.total ? `${state.activeResultIndex + 1} / ${state.total}` : '0 / 0'}
      </span>
      <button type="button" aria-label="Close search" onClick={onClose}>×</button>
    </div>
  );
}

function PdfSidebar({
  documentId,
  mode,
  currentPage,
  outline,
  onMode,
  onClose,
  onPage,
  onDestination,
}: {
  documentId: string;
  mode: SidebarMode;
  currentPage: number;
  outline: PdfBookmarkObject[];
  onMode(mode: SidebarMode): void;
  onClose(): void;
  onPage(page: number): void;
  onDestination(destination: PdfDestinationObject): void;
}): React.JSX.Element {
  return (
    <aside className="embedpdf-sidebar" aria-label="PDF navigation">
      <div className="embedpdf-sidebar-header">
        <div role="tablist" className="embedpdf-sidebar-tabs">
          <button type="button" role="tab" aria-selected={mode === 'thumbnails'} onClick={() => onMode('thumbnails')}>Pages</button>
          <button type="button" role="tab" aria-selected={mode === 'outline'} onClick={() => onMode('outline')}>Outline</button>
        </div>
        <button type="button" aria-label="Close sidebar" onClick={onClose}>×</button>
      </div>
      {mode === 'thumbnails' ? (
        <ThumbnailsPane documentId={documentId} className="embedpdf-thumbnail-list">
          {(meta: { pageIndex: number; width: number; height: number }) => (
            <button
              type="button"
              className="embedpdf-thumbnail"
              aria-current={meta.pageIndex + 1 === currentPage ? 'page' : undefined}
              onClick={() => onPage(meta.pageIndex + 1)}
            >
              <ThumbImg documentId={documentId} meta={meta as never} />
              <span>{meta.pageIndex + 1}</span>
            </button>
          )}
        </ThumbnailsPane>
      ) : (
        <div className="embedpdf-outline-list">
          {outline.length ? (
            <BookmarkTree bookmarks={outline} onDestination={onDestination} />
          ) : <div className="empty-state">No outline available</div>}
        </div>
      )}
    </aside>
  );
}

function BookmarkTree({
  bookmarks,
  onDestination,
}: {
  bookmarks: PdfBookmarkObject[];
  onDestination(destination: PdfDestinationObject): void;
}): React.JSX.Element {
  return (
    <ul className="embedpdf-outline-tree">
      {bookmarks.map((bookmark, index) => {
        const destination = targetDestination(bookmark.target);
        return (
          <li key={`${bookmark.title}:${index}`}>
            <button
              type="button"
              className="embedpdf-outline-row"
              disabled={!destination}
              onClick={() => destination && onDestination(destination)}
            >{bookmark.title}</button>
            {bookmark.children?.length ? (
              <BookmarkTree bookmarks={bookmark.children} onDestination={onDestination} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function serializePdfOutline(bookmarks: PdfBookmarkObject[]): Array<{
  title: string;
  destination?: PdfDestinationObject;
  children: ReturnType<typeof serializePdfOutline>;
}> {
  return bookmarks.map(bookmark => {
    const destination = bookmark.target ? targetDestination(bookmark.target) : undefined;
    return {
      title: bookmark.title,
      ...(destination ? { destination } : {}),
      children: serializePdfOutline(bookmark.children ?? []),
    };
  });
}

function PdfLinkLayer({
  registry,
  document,
  pageIndex,
  scale,
  onDestination,
}: {
  registry: PluginRegistry | null;
  document: PdfDocumentObject;
  pageIndex: number;
  scale: number;
  onDestination(destination: PdfDestinationObject): void;
}): React.JSX.Element | null {
  const [links, setLinks] = useState<Array<{ annotation: PdfLinkAnnoObject; destination: PdfDestinationObject }>>([]);
  const [preview, setPreview] = useState<{ rect: Rect; page: number; excerpt: string }>();

  useEffect(() => {
    if (!registry || !document.pages[pageIndex]) return;
    const engine = registry.getEngine();
    const task = engine.getPageAnnotations(document, document.pages[pageIndex]!);
    task.wait(annotations => {
      setLinks(annotations.flatMap(annotation => {
        if (annotation.type !== PdfAnnotationSubtype.LINK) return [];
        const link = annotation as PdfLinkAnnoObject;
        const destination = targetDestination(link.target);
        return destination ? [{ annotation: link, destination }] : [];
      }));
    }, () => setLinks([]));
    return () => task.abort({ code: 1, message: 'Page disposed' });
  }, [document, pageIndex, registry]);

  const showPreview = (rect: Rect, destination: PdfDestinationObject): void => {
    setPreview({ rect, page: destination.pageIndex + 1, excerpt: 'Loading destination preview…' });
    if (!registry || !document.pages[destination.pageIndex]) return;
    const engine = registry.getEngine();
    const page = document.pages[destination.pageIndex]!;
    const geometryTask = engine.getPageGeometry(document, page);
    geometryTask.wait(geometry => {
      const charCount = geometry.runs.reduce((maximum, run) => (
        Math.max(maximum, run.charStart + run.glyphs.length)
      ), 0);
      const textTask = engine.getTextSlices(document, [{
        pageIndex: destination.pageIndex,
        charIndex: 0,
        charCount,
      }]);
      textTask.wait(lines => {
        setPreview(current => current?.page === destination.pageIndex + 1
          ? { ...current, excerpt: lines.join(' ').replace(/\s+/gu, ' ').trim().slice(0, 480) }
          : current);
      }, () => undefined);
    }, () => undefined);
  };

  return (
    <div className="embedpdf-link-layer">
      {links.map(({ annotation, destination }) => {
        const rect = annotation.rect;
        return (
          <button
            type="button"
            className="embedpdf-link-overlay"
            aria-label={`Go to PDF page ${destination.pageIndex + 1}`}
            key={annotation.id}
            style={{
              left: rect.origin.x * scale,
              top: rect.origin.y * scale,
              width: rect.size.width * scale,
              height: rect.size.height * scale,
            }}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              onDestination(destination);
            }}
            onPointerEnter={() => showPreview(rect, destination)}
            onPointerLeave={() => setPreview(undefined)}
            onFocus={() => showPreview(rect, destination)}
            onBlur={() => setPreview(undefined)}
          />
        );
      })}
      {preview && (
        <div
          className="embedpdf-link-preview"
          role="tooltip"
          style={{ left: preview.rect.origin.x * scale, top: (preview.rect.origin.y + preview.rect.size.height) * scale + 8 }}
        >
          <strong>Internal PDF link</strong>
          <div className="preview-page">Page {preview.page}</div>
          <div className="preview-excerpt">{preview.excerpt || 'Destination text is unavailable.'}</div>
        </div>
      )}
    </div>
  );
}

function PdfQueryLayer({
  page,
  scale,
  annotations,
}: {
  page: number;
  scale: number;
  annotations: PdfQueryAnnotation[];
}): React.JSX.Element | null {
  const [active, setActive] = useState<PdfQueryAnnotation>();
  const pageAnnotations = annotations.filter(annotation => annotation.page === page);
  if (!pageAnnotations.length) return null;
  return (
    <div className="embedpdf-query-layer">
      {pageAnnotations.flatMap(annotation => annotation.rects.map((rect, index) => (
        <div
          className="embedpdf-query-highlight"
          key={`${annotation.annotationId}:rect:${index}`}
          style={{
            left: rect[0] * scale,
            top: rect[1] * scale,
            width: (rect[2] - rect[0]) * scale,
            height: (rect[3] - rect[1]) * scale,
          }}
        />
      )))}
      {pageAnnotations.map(annotation => {
        const rect = annotation.rects[0]!;
        return (
          <button
            type="button"
            className="embedpdf-query-marker"
            key={annotation.annotationId}
            style={{ left: rect[2] * scale + 4, top: rect[1] * scale }}
            onPointerEnter={() => setActive(annotation)}
            onPointerLeave={() => setActive(undefined)}
            onFocus={() => setActive(annotation)}
            onClick={() => setActive(annotation)}
          >✦ Query</button>
        );
      })}
      {active && (
        <div className="embedpdf-query-popover" role="dialog">
          <strong>{active.title}</strong>
          <div className="query-meta">{active.status} · {active.updatedTime.slice(0, 10)}</div>
          <p>{active.condensedSummary}</p>
          <button type="button" onClick={() => vscode.postMessage({ type: 'openQuery', navigation: active.navigationTarget })}>
            Open Query
          </button>
        </div>
      )}
    </div>
  );
}

function AnchorHighlightLayer({
  page,
  scale,
  highlight,
}: {
  page: number;
  scale: number;
  highlight?: AnchorHighlight;
}): React.JSX.Element | null {
  if (!highlight || highlight.page !== page) return null;
  return (
    <div className="embedpdf-anchor-layer" key={highlight.key}>
      {highlight.rects.map((rect, index) => (
        <div
          className="embedpdf-anchor-highlight"
          key={index}
          style={{
            left: rect[0]! * scale,
            top: rect[1]! * scale,
            width: (rect[2]! - rect[0]!) * scale,
            height: (rect[3]! - rect[1]!) * scale,
          }}
        />
      ))}
    </div>
  );
}

function ColumnSelectionLayer({
  page,
  scale,
  selection,
}: {
  page: number;
  scale: number;
  selection?: ColumnSelection;
}): React.JSX.Element | null {
  if (!selection || selection.page !== page) return null;
  return (
    <div className="embedpdf-column-selection-layer" data-phase={selection.phase}>
      {selection.rects.map((rect, index) => (
        <div
          className="embedpdf-column-selection-rect"
          key={index}
          style={{
            left: rect[0]! * scale,
            top: rect[1]! * scale,
            width: (rect[2]! - rect[0]!) * scale,
            height: (rect[3]! - rect[1]!) * scale,
          }}
        />
      ))}
    </div>
  );
}

function AreaSelectionLayer({
  documentId,
  page,
  scale,
  selection,
}: {
  documentId: string;
  page: number;
  scale: number;
  selection?: AreaSelection;
}): React.JSX.Element | null {
  if (!selection || selection.page !== page) return null;
  const [left, top, right, bottom] = selection.rect;
  const scaledLeft = left! * scale;
  const scaledTop = top! * scale;
  const scaledWidth = (right! - left!) * scale;
  const scaledHeight = (bottom! - top!) * scale;
  const menuTop = scaledTop > 38 ? scaledTop - 34 : scaledTop + scaledHeight + 6;
  return (
    <div className="embedpdf-area-selection-layer">
      <div
        className="embedpdf-area-selection-rect"
        style={{
          left: scaledLeft,
          top: scaledTop,
          width: scaledWidth,
          height: scaledHeight,
        }}
      />
      <div
        className="embedpdf-selection-menu area-selection-menu"
        data-no-interaction=""
        role="toolbar"
        aria-label="PDF region actions"
        onPointerDownCapture={event => event.stopPropagation()}
        style={{
          left: scaledLeft + scaledWidth / 2,
          top: menuTop,
          transform: 'translateX(-50%)',
        }}
      >
        <SelectionActionButtons documentId={documentId} includeCopyText={false} />
      </div>
    </div>
  );
}

async function extractRectangularText(
  registry: PluginRegistry,
  document: PdfDocumentObject,
  pageIndex: number,
  rect: Rect,
  geometry?: PdfPageGeometry,
  minimumRows = 3,
): Promise<{ text: string; rects: number[][]; rowCount: number } | undefined> {
  const page = document.pages[pageIndex];
  if (!page) return undefined;
  const engine = registry.getEngine();
  const pageGeometry = geometry ?? await engine.getPageGeometry(document, page).toPromise();
  const selection = rectangularRunsForGeometry(pageGeometry, rect);
  if (selection.rowCount < minimumRows || !selection.columnLike) return undefined;
  const text = (await engine.getTextSlices(document, selection.runs.map(run => ({
    pageIndex,
    charIndex: run.charIndex,
    charCount: run.charCount,
  }))).toPromise())
    .map(value => value.replace(/\s+/gu, ' ').trim())
    .filter(Boolean)
    .join(' ');
  if (!text) return undefined;
  return { text, rects: selection.rects, rowCount: selection.rowCount };
}

function loadColumnGeometry(
  registry: PluginRegistry | null,
  document: PdfDocumentObject,
  pageIndex: number,
  cache: Map<number, Promise<PdfPageGeometry>>,
): Promise<PdfPageGeometry> {
  const cached = cache.get(pageIndex);
  if (cached) return cached;
  const page = document.pages[pageIndex];
  if (!registry || !page) return Promise.reject(new Error('PDF page geometry is unavailable'));
  const task = registry.getEngine().getPageGeometry(document, page).toPromise();
  cache.set(pageIndex, task);
  void task.catch(() => cache.delete(pageIndex));
  return task;
}

function columnDragRect(
  start: Pick<ColumnDragStart, 'x' | 'y'>,
  end: { x: number; y: number },
): Rect {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  return {
    origin: { x: Math.min(start.x, end.x) - 3, y: Math.min(start.y, end.y) - 2 },
    size: { width: Math.max(6, dx + 6), height: dy + 4 },
  };
}

function rectArray(rect: Rect): number[] {
  return [
    rect.origin.x,
    rect.origin.y,
    rect.origin.x + rect.size.width,
    rect.origin.y + rect.size.height,
  ];
}

function rectangularRunsForGeometry(
  geometry: PdfPageGeometry,
  rect: Rect,
): {
  runs: Array<{ charIndex: number; charCount: number; rect: number[] }>;
  rects: number[][];
  rowCount: number;
  columnLike: boolean;
} {
  const right = rect.origin.x + rect.size.width;
  const bottom = rect.origin.y + rect.size.height;
  const selectedRuns: Array<{
    charIndex: number;
    charCount: number;
    rect: number[];
    coverage: number;
  }> = [];

  for (const run of geometry.runs) {
    const selected = run.glyphs.flatMap((glyph, index) => {
      if (glyph.width <= 0 || glyph.height <= 0) return [];
      const intersects = Math.min(right, glyph.x + glyph.width) > Math.max(rect.origin.x, glyph.x)
        && Math.min(bottom, glyph.y + glyph.height) > Math.max(rect.origin.y, glyph.y);
      return intersects ? [{ glyph, index }] : [];
    });
    if (!selected.length) continue;
    const first = selected[0]!;
    const last = selected.at(-1)!;
    const left = Math.min(...selected.map(item => item.glyph.x));
    const top = Math.min(...selected.map(item => item.glyph.y));
    const selectedRight = Math.max(...selected.map(item => item.glyph.x + item.glyph.width));
    const selectedBottom = Math.max(...selected.map(item => item.glyph.y + item.glyph.height));
    const visibleGlyphCount = run.glyphs.reduce((count, glyph) => (
      glyph.width > 0 && glyph.height > 0 ? count + 1 : count
    ), 0);
    selectedRuns.push({
      charIndex: run.charStart + first.index,
      charCount: last.index - first.index + 1,
      rect: [left, top, selectedRight, selectedBottom],
      coverage: visibleGlyphCount ? selected.length / visibleGlyphCount : 0,
    });
  }
  selectedRuns.sort((left, rightRun) => left.rect[1]! - rightRun.rect[1]! || left.rect[0]! - rightRun.rect[0]!);
  const rows: Array<{ center: number; rect: number[]; coverage: number }> = [];
  for (const run of selectedRuns) {
    const center = (run.rect[1]! + run.rect[3]!) / 2;
    const row = rows.find(candidate => Math.abs(candidate.center - center) < 3);
    if (row) {
      row.rect = [
        Math.min(row.rect[0]!, run.rect[0]!),
        Math.min(row.rect[1]!, run.rect[1]!),
        Math.max(row.rect[2]!, run.rect[2]!),
        Math.max(row.rect[3]!, run.rect[3]!),
      ];
      row.coverage = Math.max(row.coverage, run.coverage);
    } else {
      rows.push({ center, rect: [...run.rect], coverage: run.coverage });
    }
  }
  const sortedMedian = (values: number[]): number => {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  };
  const widths = rows.map(row => row.rect[2]! - row.rect[0]!);
  const medianWidth = sortedMedian(widths);
  const leftEdges = rows.map(row => row.rect[0]!);
  const rightEdges = rows.map(row => row.rect[2]!);
  const leftSpread = leftEdges.length ? Math.max(...leftEdges) - Math.min(...leftEdges) : Infinity;
  const rightSpread = rightEdges.length ? Math.max(...rightEdges) - Math.min(...rightEdges) : Infinity;
  const widthSpread = widths.length ? Math.max(...widths) - Math.min(...widths) : Infinity;
  const alignedEdge = Math.min(leftSpread, rightSpread) <= Math.max(2.5, medianWidth * 0.2);
  const consistentWidth = widthSpread <= Math.max(4, medianWidth * 0.35);
  const mostlyWholeRuns = sortedMedian(rows.map(row => row.coverage)) >= 0.55;
  const columnLike = rows.length >= 3 && alignedEdge && consistentWidth && mostlyWholeRuns;
  return {
    runs: selectedRuns,
    rects: selectedRuns.map(run => run.rect),
    rowCount: rows.length,
    columnLike,
  };
}

function publishCustomSelection(selection: ColumnSelection): void {
  latestAnchor = {
    page: selection.page,
    rects: selection.rects,
    snippet: selection.text,
    multiPage: false,
  };
  vscode.postMessage({
    type: 'selectionChanged',
    anchor: latestAnchor,
    clipboardSelection: {
      kind: 'text',
      startPage: selection.page,
      endPage: selection.page,
      selectedText: selection.text,
      pages: [{ page: selection.page, rects: selection.rects }],
    },
  });
}

function publishAreaSelection(selection: AreaSelection): void {
  latestAnchor = {
    area: true,
    page: selection.page,
    rects: [selection.rect],
    snippet: 'Selected PDF region.',
    multiPage: false,
  };
  vscode.postMessage({
    type: 'selectionChanged',
    anchor: latestAnchor,
    clipboardSelection: {
      kind: 'area',
      startPage: selection.page,
      endPage: selection.page,
      pages: [{ page: selection.page, rects: [selection.rect] }],
    },
  });
}

function targetDestination(
  target: PdfBookmarkObject['target'] | PdfLinkAnnoObject['target'],
): PdfDestinationObject | undefined {
  if (!target) return undefined;
  if (target.type === 'destination') return target.destination;
  if (target.action.type === PdfActionType.Goto) return target.action.destination;
  return undefined;
}

function normalizeAnchorRects(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    if (!Array.isArray(candidate) || candidate.length !== 4) return [];
    const rect = candidate.map(Number);
    if (!rect.every(Number.isFinite) || rect[2]! <= rect[0]! || rect[3]! <= rect[1]!) return [];
    return [rect];
  });
}

function normalizeToolbarPreference(value: unknown): ToolbarPreference {
  if (!value || typeof value !== 'object') return { dock: 'top', hidden: false };
  const raw = value as Record<string, unknown>;
  return {
    dock: raw.dock === 'left' ? 'left' : 'top',
    hidden: raw.hidden === true,
  };
}

function shouldReduceAnimation(value: ReduceAnimation): boolean {
  if (value === 'on') return true;
  if (value === 'off') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function installHeadlessStyles(): void {
  if (globalThis.document.getElementById('embedpdf-headless-styles')) return;
  const style = globalThis.document.createElement('style');
  style.id = 'embedpdf-headless-styles';
  style.textContent = `
    html, body, #embedpdf-spike-root { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { color: var(--vscode-editor-foreground, #ddd); background: var(--vscode-editor-background, #1e1e1e); font: 12px var(--vscode-font-family, system-ui, sans-serif); }
    button, input { font: inherit; }
    .embedpdf-loading { display: grid; height: 100%; place-items: center; }
    .embedpdf-headless-shell { position: relative; display: grid; width: 100%; height: 100%; min-width: 0; min-height: 0; --embedpdf-selection-source: var(--vscode-editor-selectionBackground, #0078d4); --embedpdf-selection-focus-source: var(--vscode-focusBorder, #007fd4); --embedpdf-selection-fill: rgba(0, 120, 212, .18); --embedpdf-selection-edge: rgba(0, 127, 212, .62); --embedpdf-selection-soft: rgba(0, 120, 212, .10); }
    @supports (background: color-mix(in srgb, red 50%, transparent)) {
      .embedpdf-headless-shell { --embedpdf-selection-fill: color-mix(in srgb, var(--embedpdf-selection-source) 34%, transparent); --embedpdf-selection-edge: color-mix(in srgb, var(--embedpdf-selection-focus-source) 68%, transparent); --embedpdf-selection-soft: color-mix(in srgb, var(--embedpdf-selection-source) 16%, transparent); }
    }
    .embedpdf-headless-shell.toolbar-top { grid-template: auto minmax(0, 1fr) / minmax(0, 1fr); }
    .embedpdf-headless-shell.toolbar-left { grid-template: minmax(0, 1fr) / 48px minmax(0, 1fr); }
    .embedpdf-headless-shell[data-toolbar-hidden="true"] { grid-template: minmax(0, 1fr) / minmax(0, 1fr); }
    .embedpdf-headless-toolbar { z-index: 30; box-sizing: border-box; display: flex; min-width: 0; gap: 4px; align-items: center; padding: 5px 6px; border-bottom: 1px solid var(--vscode-panel-border, #444); background: var(--vscode-sideBar-background, #252526); }
    .toolbar-top > .embedpdf-headless-toolbar { grid-area: 1 / 1; height: 38px; }
    .toolbar-left > .embedpdf-headless-toolbar { grid-area: 1 / 1; width: 48px; height: 100%; min-height: 0; flex-direction: column; overflow: auto; padding: 6px 3px; border-right: 1px solid var(--vscode-panel-border, #444); border-bottom: 0; }
    .embedpdf-headless-toolbar button { box-sizing: border-box; min-width: 26px; height: 27px; padding: 0 6px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; color: var(--vscode-button-secondaryForeground, #fff); background: transparent; cursor: pointer; white-space: nowrap; }
    .embedpdf-headless-toolbar button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, #ffffff20); }
    .embedpdf-headless-toolbar button[aria-pressed="true"] { color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #0e639c); }
    .embedpdf-headless-toolbar button:disabled { opacity: .45; cursor: default; }
    .toolbar-left > .embedpdf-headless-toolbar button { width: 100%; overflow: hidden; padding: 0 3px; text-overflow: ellipsis; }
    .toolbar-grip { cursor: grab !important; font-size: 15px !important; }
    .toolbar-group { display: inline-flex; align-items: center; gap: 2px; }
    .toolbar-left .toolbar-group { width: 100%; flex-direction: column; }
    .toolbar-spacer { flex: 1 1 auto; }
    .toolbar-separator { flex: 0 0 auto; width: 1px; height: 20px; margin: 0 3px; background: var(--vscode-panel-border, #444); }
    .toolbar-left .toolbar-separator { width: 32px; height: 1px; margin: 3px 0; }
    .toolbar-number { display: inline-flex; align-items: center; height: 26px; border: 1px solid var(--vscode-panel-border, #444); border-radius: 3px; background: var(--vscode-input-background, #1e1e1e); }
    .toolbar-number input { box-sizing: border-box; width: 43px; height: 24px; border: 0; outline: 0; padding: 0 3px; color: var(--vscode-input-foreground, #ddd); background: transparent; text-align: right; }
    .toolbar-number span { padding-right: 5px; color: var(--vscode-descriptionForeground, #aaa); white-space: nowrap; }
    .toolbar-layout-select { box-sizing: border-box; width: clamp(108px, 16vw, 190px); height: 27px; min-width: 0; flex: 0 1 190px; overflow: hidden; border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border, #444)); border-radius: 3px; outline: 0; padding: 0 22px 0 6px; color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground, #ddd)); background: var(--vscode-dropdown-background, var(--vscode-input-background, #1e1e1e)); text-overflow: ellipsis; white-space: nowrap; }
    .toolbar-layout-select:focus-visible { outline: 2px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px; }
    .toolbar-left .toolbar-number { width: 100%; height: auto; flex-direction: column; }
    .toolbar-left .toolbar-number input { width: 100%; text-align: center; }
    .toolbar-left .toolbar-number span { padding: 0 2px 2px; font-size: 10px; }
    .toolbar-left .toolbar-layout-select { width: 40px; max-width: 40px; flex: 0 0 27px; padding: 0 16px 0 3px; font-size: 10px; }
    .cursor-chat-action { color: var(--vscode-button-foreground, #fff) !important; background: var(--vscode-button-background, #0e639c) !important; }
    .embedpdf-display-menu { position: fixed; z-index: 100; top: 42px; left: 105px; display: flex; width: 220px; flex-direction: column; gap: 1px; padding: 5px; border: 1px solid var(--vscode-panel-border, #444); border-radius: 5px; color: var(--vscode-editorWidget-foreground, #ddd); background: var(--vscode-editorWidget-background, #252526); box-shadow: 0 6px 20px #0008; }
    .toolbar-left .embedpdf-display-menu { top: 50px; left: 52px; }
    .embedpdf-display-menu .menu-section { padding: 5px 8px 2px; color: var(--vscode-descriptionForeground, #aaa); font-size: 11px; }
    .embedpdf-display-menu button { display: block; width: 100%; min-height: 26px; height: auto; border: 0; padding: 4px 8px 4px 24px; color: inherit; background: transparent; text-align: left; }
    .embedpdf-display-menu button[aria-checked="true"]::before { content: '✓'; position: absolute; margin-left: -17px; }
    .embedpdf-viewer-shell { position: relative; display: flex; min-width: 0; min-height: 0; }
    .toolbar-top > .embedpdf-viewer-shell { grid-area: 2 / 1; }
    .toolbar-left > .embedpdf-viewer-shell { grid-area: 1 / 2; }
    [data-toolbar-hidden="true"] > .embedpdf-viewer-shell { grid-area: 1 / 1; }
    .embedpdf-document-area { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; }
    .embedpdf-headless-viewport { box-sizing: border-box; width: 100%; height: 100%; min-height: 0; overflow: auto; padding: 10px; background: #303030; }
    .embedpdf-headless-viewport.paginated { overflow: hidden; padding: 0 !important; }
    .embedpdf-headless-viewport.paginated > div { display: block !important; box-sizing: border-box !important; width: 100% !important; height: 100% !important; min-width: 0; min-height: 0; margin-left: 0 !important; }
    .embedpdf-paginated-frame { box-sizing: border-box; width: 100%; height: 100%; overflow: auto; padding: 10px; overscroll-behavior: contain; }
    .embedpdf-paginated-stage { position: relative; box-sizing: border-box; }
    .embedpdf-paginated-spread { position: absolute; top: 50%; left: 50%; display: flex; align-items: center; justify-content: center; transform: translate(-50%, -50%); }
    .embedpdf-headless-page { position: relative; background: #fff; box-shadow: 0 1px 8px #0007; }
    .embedpdf-paginated-spread[data-page-transition="forward"] { animation: embedpdf-page-enter-forward 180ms cubic-bezier(.2, .8, .2, 1) both; }
    .embedpdf-paginated-spread[data-page-transition="backward"] { animation: embedpdf-page-enter-backward 180ms cubic-bezier(.2, .8, .2, 1) both; }
    [data-reduce-animation="true"] .embedpdf-paginated-spread[data-page-transition] { animation: none; }
    [data-adapt-theme="true"] .embedpdf-headless-page canvas { filter: invert(.9) hue-rotate(180deg); }
    .embedpdf-search { position: absolute; z-index: 80; top: 8px; right: 8px; display: grid; grid-template-columns: minmax(150px, 1fr) 26px 26px auto 26px; align-items: center; gap: 2px; width: min(420px, calc(100% - 16px)); padding: 4px; border: 1px solid var(--vscode-widget-border, #555); border-radius: 4px; color: var(--vscode-editorWidget-foreground, #ddd); background: var(--vscode-editorWidget-background, #252526); box-shadow: 0 2px 8px #0008; }
    .embedpdf-search input { box-sizing: border-box; width: 100%; height: 26px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; outline: 0; padding: 2px 6px; color: var(--vscode-input-foreground, #ddd); background: var(--vscode-input-background, #1e1e1e); }
    .embedpdf-search button { width: 26px; height: 26px; border: 0; border-radius: 3px; color: inherit; background: transparent; }
    .search-count { min-width: 45px; color: var(--vscode-descriptionForeground, #aaa); text-align: center; }
    .embedpdf-sidebar { box-sizing: border-box; flex: 0 0 240px; width: 240px; min-height: 0; border-right: 1px solid var(--vscode-panel-border, #444); color: var(--vscode-editor-foreground, #ddd); background: var(--vscode-sideBar-background, #252526); }
    .embedpdf-sidebar-header { display: flex; height: 38px; align-items: stretch; justify-content: space-between; border-bottom: 1px solid var(--vscode-panel-border, #444); }
    .embedpdf-sidebar-tabs { display: flex; }
    .embedpdf-sidebar-header button { border: 0; padding: 0 9px; color: var(--vscode-descriptionForeground, #aaa); background: transparent; }
    .embedpdf-sidebar-header button[aria-selected="true"] { color: var(--vscode-editor-foreground, #fff); border-bottom: 2px solid var(--vscode-focusBorder, #007fd4); }
    .embedpdf-thumbnail-list, .embedpdf-outline-list { box-sizing: border-box; height: calc(100% - 38px); overflow: auto; padding: 8px; }
    .embedpdf-thumbnail { display: flex; width: 100%; flex-direction: column; align-items: center; gap: 4px; margin-bottom: 8px; border: 1px solid transparent; border-radius: 4px; padding: 6px; color: inherit; background: transparent; }
    .embedpdf-thumbnail[aria-current="page"] { border-color: var(--vscode-focusBorder, #007fd4); background: var(--vscode-list-activeSelectionBackground, #094771); }
    .embedpdf-thumbnail img { display: block; max-width: 116px; background: #fff; box-shadow: 0 1px 5px #0008; }
    .embedpdf-outline-tree { margin: 0; padding: 0; list-style: none; }
    .embedpdf-outline-tree .embedpdf-outline-tree { padding-left: 12px; }
    .embedpdf-outline-row { display: block; width: 100%; min-height: 26px; border: 0; border-radius: 3px; padding: 4px 7px; overflow: hidden; color: inherit; background: transparent; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
    .embedpdf-outline-row:hover:not(:disabled) { background: var(--vscode-list-hoverBackground, #2a2d2e); }
    .empty-state { padding: 12px; color: var(--vscode-descriptionForeground, #aaa); }
    .embedpdf-selection-menu { position: absolute; z-index: 120; left: 0; display: flex; box-sizing: border-box; gap: 1px; align-items: center; width: max-content; max-width: calc(100vw - 24px); overflow-x: auto; padding: 3px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, #444)); border-radius: 6px; color: var(--vscode-editorWidget-foreground, var(--vscode-foreground, #ddd)); background: var(--vscode-editorWidget-background, #252526); box-shadow: 0 4px 12px var(--vscode-widget-shadow, rgba(0, 0, 0, .32)); pointer-events: auto; scrollbar-width: none; white-space: nowrap; }
    .embedpdf-selection-menu::-webkit-scrollbar { display: none; }
    .embedpdf-selection-menu button { display: inline-flex; min-height: 24px; align-items: center; gap: 5px; border: 0; border-radius: 4px; padding: 0 7px; color: inherit; background: transparent; cursor: pointer; white-space: nowrap; }
    .embedpdf-selection-menu button.primary { color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #0e639c); }
    .embedpdf-selection-menu button.primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background, #1177bb)); }
    .embedpdf-selection-menu button.secondary:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, .16)); }
    .embedpdf-selection-menu button:focus-visible { outline: 2px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px; }
    .embedpdf-selection-menu kbd { height: 15px; padding: 0 3px; border: 0; border-radius: 3px; color: var(--vscode-keybindingLabel-foreground, var(--vscode-descriptionForeground, #aaa)); background: var(--vscode-keybindingLabel-background, var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, .16))); font: 10px/15px var(--vscode-font-family, system-ui, sans-serif); }
    .selection-menu-separator { flex: 0 0 auto; width: 1px; height: 15px; margin: 0 2px; background: var(--vscode-widget-border, var(--vscode-panel-border, #444)); }
    .embedpdf-link-layer, .embedpdf-query-layer, .embedpdf-anchor-layer, .embedpdf-column-selection-layer, .embedpdf-area-selection-layer { position: absolute; z-index: 20; inset: 0; pointer-events: none; }
    .embedpdf-native-selection-layer { display: contents; }
    .embedpdf-native-selection-layer > div:first-child { z-index: 18; isolation: auto !important; mix-blend-mode: normal !important; }
    .embedpdf-native-selection-layer > div:first-child > div { border-radius: 2px; box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--embedpdf-selection-edge) 32%, transparent); }
    .embedpdf-link-overlay { position: absolute; z-index: 2; border: 0; padding: 0; background: transparent; cursor: pointer; pointer-events: auto; }
    .embedpdf-link-overlay:hover, .embedpdf-link-overlay:focus-visible { outline: 1px solid color-mix(in srgb, var(--vscode-focusBorder, #4dabf7) 50%, transparent); background: #4dabf71a; }
    .embedpdf-link-preview { position: absolute; z-index: 40; box-sizing: border-box; width: min(380px, 80vw); max-height: 250px; overflow: hidden; padding: 10px 12px; border: 1px solid var(--vscode-editorHoverWidget-border, #555); border-radius: 6px; color: var(--vscode-editorHoverWidget-foreground, #ddd); background: var(--vscode-editorHoverWidget-background, #252526); box-shadow: 0 4px 14px #0009; font-size: 13px; line-height: 1.42; pointer-events: none; }
    .preview-page, .query-meta { margin-top: 3px; color: var(--vscode-descriptionForeground, #aaa); font-size: 11px; }
    .preview-excerpt { margin-top: 7px; }
    .embedpdf-query-highlight { position: absolute; box-sizing: border-box; border-bottom: 2px solid var(--vscode-editorInfo-foreground, #4daafc); background: #4daafc2e; border-radius: 2px; }
    .embedpdf-query-marker { position: absolute; z-index: 3; border: 1px solid var(--vscode-widget-border, #555); border-radius: 9px; padding: 1px 6px; color: var(--vscode-textLink-foreground, #4daafc); background: var(--vscode-editorWidget-background, #252526); pointer-events: auto; white-space: nowrap; }
    .embedpdf-query-popover { position: absolute; z-index: 50; top: 16px; right: 8px; box-sizing: border-box; width: min(380px, 80vw); max-height: 280px; overflow: auto; padding: 10px 12px; border: 1px solid var(--vscode-editorHoverWidget-border, #555); border-radius: 6px; color: var(--vscode-editorHoverWidget-foreground, #ddd); background: var(--vscode-editorHoverWidget-background, #252526); box-shadow: 0 4px 14px #0008; pointer-events: auto; }
    .embedpdf-query-popover button { padding: 3px 8px; border: 0; border-radius: 3px; color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #0e639c); }
    .embedpdf-anchor-highlight { position: absolute; border-radius: 2px; background: #0096ff59; animation: embedpdf-anchor-fade 2400ms ease-out forwards; }
    .embedpdf-column-selection-layer { isolation: isolate; }
    .embedpdf-column-selection-rect { position: absolute; z-index: 4; box-sizing: border-box; border-radius: 2px; background: var(--embedpdf-selection-fill); box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--embedpdf-selection-edge) 32%, transparent); }
    .embedpdf-column-selection-layer[data-phase="corridor"] .embedpdf-column-selection-rect { border: 1px solid var(--embedpdf-selection-edge); border-radius: 4px; background: var(--embedpdf-selection-soft); box-shadow: 0 0 0 1px color-mix(in srgb, var(--embedpdf-selection-edge) 18%, transparent); }
    .embedpdf-column-selection-layer[data-phase="drag"] .embedpdf-column-selection-rect { background: color-mix(in srgb, var(--embedpdf-selection-fill) 88%, transparent); }
    .embedpdf-area-selection-marquee, .embedpdf-area-selection-rect { box-sizing: border-box; border: 1px solid var(--embedpdf-selection-edge); border-radius: 4px; background: var(--embedpdf-selection-soft); box-shadow: 0 0 0 1px color-mix(in srgb, var(--embedpdf-selection-edge) 18%, transparent); }
    .embedpdf-area-selection-rect { position: absolute; pointer-events: none; }
    .area-selection-menu { pointer-events: auto; }
    @media (forced-colors: active) {
      .embedpdf-native-selection-layer > div:first-child,
      .embedpdf-column-selection-layer { isolation: auto !important; mix-blend-mode: normal !important; }
      .embedpdf-native-selection-layer > div:first-child > div,
      .embedpdf-column-selection-rect,
      .embedpdf-area-selection-marquee,
      .embedpdf-area-selection-rect { border: 1px solid Highlight; background: Highlight !important; box-shadow: none; opacity: .42; forced-color-adjust: none; }
    }
    @keyframes embedpdf-anchor-fade { 0%, 72% { opacity: 1; } 100% { opacity: 0; } }
    @keyframes embedpdf-page-enter-forward { from { opacity: .68; transform: translate(-50%, -50%) translateY(14px); } to { opacity: 1; transform: translate(-50%, -50%) translateY(0); } }
    @keyframes embedpdf-page-enter-backward { from { opacity: .68; transform: translate(-50%, -50%) translateY(-14px); } to { opacity: 1; transform: translate(-50%, -50%) translateY(0); } }
    .embedpdf-history-back.floating { position: absolute; z-index: 70; left: 14px; bottom: 14px; width: 32px; height: 32px; border: 1px solid var(--vscode-widget-border, #555); border-radius: 5px; color: var(--vscode-button-secondaryForeground, #fff); background: var(--vscode-button-secondaryBackground, #3a3d41); box-shadow: 0 2px 8px #0008; }
  `;
  globalThis.document.head.append(style);
}

function SelectionBridge({ documentId }: { documentId: string }): null {
  const { registry } = useRegistry();
  const { provides: selection } = useSelectionCapability();

  useEffect(() => {
    if (!registry || !selection) return;
    window.__embedPdfSpike = { registry, selection, formatError: formatUnknownError };
    vscode.postMessage({ type: 'embedPdfReady', implementation: 'headless' });
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    const publishWhenSettled = (): void => {
      if (publishTimer) clearTimeout(publishTimer);
      publishTimer = setTimeout(() => {
        if (!selection.forDocument(documentId).getState().selecting) {
          publishSelection(selection, documentId);
        }
      }, 50);
    };
    const handlePointerUp = (): void => {
      if (selection.forDocument(documentId).getState().selection) publishWhenSettled();
    };
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('mouseup', handlePointerUp, true);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('mouseup', handlePointerUp, true);
      if (publishTimer) clearTimeout(publishTimer);
    };
  }, [documentId, registry, selection]);

  return null;
}

function SelectionMenu({
  rect,
  menuWrapperProps,
  placement,
  documentId,
}: SelectionSelectionMenuProps & { documentId: string }): React.JSX.Element {
  const top = placement.suggestTop ? -42 : rect.size.height + 6;
  return (
    <div {...menuWrapperProps}>
      <div
        className="embedpdf-selection-menu"
        data-no-interaction=""
        role="toolbar"
        aria-label="PDF text selection actions"
        style={{ top }}
      >
        <SelectionActionButtons documentId={documentId} includeCopyText />
      </div>
    </div>
  );
}

function SelectionActionButtons({
  documentId,
  includeCopyText,
}: {
  documentId: string;
  includeCopyText: boolean;
}): React.JSX.Element {
  const { provides: selection } = useSelectionCapability();
  return (
    <>
      <button
        className="primary cursor-chat-action"
        type="button"
        onClick={() => postSelectionAction('addToCursorChat')}
      >
        <span>Add to Chat</span>
        <kbd aria-hidden="true">⌘L</kbd>
      </button>
      <span className="selection-menu-separator" aria-hidden="true" />
      <button
        className="secondary"
        type="button"
        onClick={() => vscode.postMessage({ type: 'copySelectionForAgent' })}
      >
        Copy for Agent
      </button>
      {includeCopyText && (
        <button
          className="secondary"
          type="button"
          onClick={() => selection?.forDocument(documentId).copyToClipboard()}
        >
          Copy text
        </button>
      )}
    </>
  );
}

function postSelectionAction(action: 'addToCursorChat'): void {
  if (!latestAnchor || latestAnchor.multiPage) return;
  vscode.postMessage({ type: 'selectionAction', action, anchor: latestAnchor });
}

function publishSelection(selection: SelectionCapability, documentId: string): void {
  const scope = selection.forDocument(documentId);
  scope.getSelectedText().wait(lines => {
    const formatted = scope.getFormattedSelection();
    if (!formatted.length) return;
    const selectedText = lines.join(' ').replace(/\s+/gu, ' ').trim();
    const pages = formatted.map(selectionPage);
    const first = pages[0]!;
    const last = pages[pages.length - 1]!;
    latestAnchor = {
      page: first.page,
      rects: first.rects,
      snippet: selectedText,
      multiPage: first.page !== last.page,
    };

    vscode.postMessage({
      type: 'selectionChanged',
      anchor: latestAnchor,
      clipboardSelection: {
        kind: 'text',
        startPage: first.page,
        endPage: last.page,
        selectedText,
        pages,
      },
    });
  }, error => {
    const code = structuredErrorCode(error);
    if (
      code === PdfErrorCode.Cancelled
      || (code === PdfErrorCode.NotFound && !scope.getState().selection)
    ) return;
    vscode.postMessage({
      type: 'error',
      message: formatUnknownError(error, 'Unable to read the PDF selection'),
    });
  });
}

function selectionPage(selection: EmbedPdfFormattedSelection): { page: number; rects: number[][] } {
  return {
    page: selection.pageIndex + 1,
    rects: selection.segmentRects.map(rect => [
      rect.origin.x,
      rect.origin.y,
      rect.origin.x + rect.size.width,
      rect.origin.y + rect.size.height,
    ]),
  };
}

function pdfArrayBuffer(value: unknown): ArrayBuffer | undefined {
  if (value instanceof ArrayBuffer) return value;
  if (!ArrayBuffer.isView(value)) return undefined;
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
