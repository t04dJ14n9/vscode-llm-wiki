// PDF discussion UI orchestration shared by every PDF editor host.
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  createAskPdfPanelView,
  type AskPdfPanelView,
  type AskPdfViewEvent,
  type AskPdfViewModel,
} from './pdfAskPanelView';
import {
  annotationHasAnswer,
  annotationVisualStatus,
  base64ByteLength,
  clampAskPdfPanelWidth as clampPanelWidth,
  isTransientAskPdfWindowKey as isTransientWindowKey,
  normalizeAskPdfDrafts,
  normalizeAskPdfModelSelections,
  normalizeAskPdfState as stateRecord,
  normalizeAskPdfWindows,
  normalizePdfDiscussionModels,
  normalizeTurnStatus,
  selectionFromAnnotation,
  sortAnnotations,
  validPdfRects as validRects,
  type AskPdfWebviewState,
  type AskPdfWindowState,
  type PdfAskSelection,
  type PdfDiscussionAnnotationSnapshot,
  type PdfDiscussionModelSnapshot,
  type PdfDiscussionTurnStatus,
} from './domain/pdfAskState';
import { installAskPdfPanelStyles } from './pdfAskPanelStyles';
import { normalizePdfTextBands, type PdfRect } from './pdfTextBands';

export type { PdfAskSelection } from './domain/pdfAskState';

const ASK_PDF_ACCENT = '#4dabf7';
const ASK_PDF_MAX_PNG_BYTES = 5 * 1024 * 1024;
const ASK_PDF_MAX_CROP_EDGE = 1600;
const ASK_PDF_CROP_PADDING_POINTS = 24;
const ASK_PDF_MIN_WIDTH = 320;
const ASK_PDF_MAX_WIDTH = 560;
const ASK_PDF_MIN_HEIGHT = 260;
const ASK_PDF_DEFAULT_HEIGHT = 520;
const ASK_PDF_MAX_HEIGHT = 720;
const ASK_PDF_VIEWPORT_INSET = 12;
const ASK_PDF_ANCHOR_GAP = 16;
const ASK_PDF_NARROW_BREAKPOINT = 620;
const ASK_PDF_OVERVIEW_KEY = '__overview__';

interface PdfAskPageSurface {
  canvas: HTMLCanvasElement;
  pageWidth: number;
  pageHeight: number;
}

interface PdfSelectionCrop {
  dataUrl: string;
  cropRect: PdfRect;
}

interface VsCodeWebviewApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

export interface PdfAskPanelOptions {
  vscode: VsCodeWebviewApi;
  toolbar: HTMLElement;
  viewerShell: HTMLElement;
  getPageSurface(page: number): PdfAskPageSurface | undefined;
  getAnchorViewportRect(page: number, rects: PdfRect[]): { left: number; top: number; right: number; bottom: number } | undefined;
  navigateTo(page: number, rects: PdfRect[], annotationId?: string): void | Promise<void>;
  redrawMarkers(): void;
}

export interface PdfAskPanel {
  openForSelection(selection: PdfAskSelection): void;
  showSelectionError(message: string): void;
  handleHostMessage(message: any): boolean;
  renderMarkersForPage(page: number, layer: HTMLElement, scale: number): void;
}

type AskPdfResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

interface AskPdfRequestContext {
  revision: number;
  type: string;
  annotationId?: string;
  selectionKey?: string;
}

interface PendingSubmit {
  requestId: string;
  annotationId?: string;
  selectionKey?: string;
  draft: string;
  question: string;
  priorUserMessageIds: string[];
}

interface TransientActionError {
  annotationId?: string;
  selectionKey?: string;
}

export function createPdfAskPanel(options: PdfAskPanelOptions): PdfAskPanel {
  return new PdfAskPanelController(options);
}

export function capturePdfSelectionCrop(
  surface: PdfAskPageSurface,
  selection: PdfAskSelection,
  options?: { throwOnCaptureError?: boolean },
): string | undefined {
  return capturePdfSelectionSnapshot(surface, selection, options)?.dataUrl;
}

function capturePdfSelectionSnapshot(
  surface: PdfAskPageSurface,
  selection: PdfAskSelection,
  options?: { throwOnCaptureError?: boolean },
): PdfSelectionCrop | undefined {
  const rects = validRects(selection.rects);
  if (!rects.length || surface.canvas.width < 1 || surface.canvas.height < 1) return undefined;
  const union = rects.reduce((current, rect) => ({
    left: Math.min(current.left, rect[0]),
    top: Math.min(current.top, rect[1]),
    right: Math.max(current.right, rect[2]),
    bottom: Math.max(current.bottom, rect[3]),
  }), { left: rects[0]![0], top: rects[0]![1], right: rects[0]![2], bottom: rects[0]![3] });
  const left = clamp(union.left - ASK_PDF_CROP_PADDING_POINTS, 0, surface.pageWidth);
  const top = clamp(union.top - ASK_PDF_CROP_PADDING_POINTS, 0, surface.pageHeight);
  const right = clamp(union.right + ASK_PDF_CROP_PADDING_POINTS, left, surface.pageWidth);
  const bottom = clamp(union.bottom + ASK_PDF_CROP_PADDING_POINTS, top, surface.pageHeight);
  const widthPoints = right - left;
  const heightPoints = bottom - top;
  if (widthPoints <= 0 || heightPoints <= 0) return undefined;

  const sourceScaleX = surface.canvas.width / surface.pageWidth;
  const sourceScaleY = surface.canvas.height / surface.pageHeight;
  let outputScale = Math.min(
    sourceScaleX,
    sourceScaleY,
    ASK_PDF_MAX_CROP_EDGE / Math.max(widthPoints, heightPoints),
  );
  if (!Number.isFinite(outputScale) || outputScale <= 0) return undefined;

  for (let attempt = 0; attempt < 8; attempt++) {
    const output = document.createElement('canvas');
    output.width = Math.max(1, Math.round(widthPoints * outputScale));
    output.height = Math.max(1, Math.round(heightPoints * outputScale));
    const context = output.getContext('2d');
    if (!context) return undefined;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(
      surface.canvas,
      left * sourceScaleX,
      top * sourceScaleY,
      widthPoints * sourceScaleX,
      heightPoints * sourceScaleY,
      0,
      0,
      output.width,
      output.height,
    );
    context.strokeStyle = ASK_PDF_ACCENT;
    context.lineWidth = Math.max(2, Math.min(4, outputScale * 1.35));
    for (const rect of rects) {
      const outlineLeft = (rect[0] - left) * outputScale;
      const outlineTop = (rect[1] - top) * outputScale;
      const outlineWidth = (rect[2] - rect[0]) * outputScale;
      const outlineHeight = (rect[3] - rect[1]) * outputScale;
      context.strokeRect(outlineLeft, outlineTop, outlineWidth, outlineHeight);
    }
    try {
      const dataUrl = output.toDataURL('image/png');
      if (base64ByteLength(dataUrl.split(',')[1] ?? '') <= ASK_PDF_MAX_PNG_BYTES) {
        return {
          dataUrl,
          cropRect: [left, top, right, bottom],
        };
      }
    } catch (cause) {
      if (options?.throwOnCaptureError) throw cause;
      return undefined;
    }
    outputScale *= 0.72;
  }
  return undefined;
}

class PdfAskPanelController implements PdfAskPanel {
  private readonly view: AskPdfPanelView;
  private readonly panel: HTMLElement;
  private readonly header: HTMLElement;
  private readonly liveRegion: HTMLElement;
  private readonly countButton: HTMLButtonElement;
  private readonly resetPositionButton: HTMLButtonElement;
  private readonly resizer: HTMLElement;
  private readonly windows: Record<string, AskPdfWindowState>;
  private readonly drafts: Record<string, string>;
  private readonly modelSelections: Record<string, string>;
  private readonly legacyPanelWidth: number;
  private annotations: PdfDiscussionAnnotationSnapshot[] = [];
  private models: PdfDiscussionModelSnapshot[] = [];
  private modelCatalogRequested = false;
  private modelCatalogResolved = false;
  private modelCatalogError: string | undefined;
  private consentGranted = false;
  private activeAnnotationId: string | undefined;
  private activeWindowKey: string | undefined;
  private currentSelection: PdfAskSelection | undefined;
  private currentCropDataUrl: string | undefined;
  private currentCropRect: PdfRect | undefined;
  private currentSelectionKey: string | undefined;
  private draft: string;
  private legacyDraftClaimed = false;
  private transientWindowSequence = 0;
  private overviewOpen = false;
  private closedByUser = false;
  private errorMessage: string | undefined;
  private transientActionError: TransientActionError | undefined;
  private readonly pendingSubmits = new Map<string, PendingSubmit>();
  private linkCopyNotice: string | undefined;
  private promotionError: { annotationId: string; threadId: string; error: string } | undefined;
  private readonly streaming = new Map<string, string>();
  private readonly turnStates = new Map<string, { status: PdfDiscussionTurnStatus; error?: string }>();
  private readonly snapshotImages = new Map<string, string>();
  private readonly snapshotRequests = new Set<string>();
  private readonly unavailableSnapshots = new Set<string>();
  private readonly requestContexts = new Map<string, AskPdfRequestContext>();
  private requestSequence = 0;
  private viewRevision = 0;
  private pendingPanelFocus = false;
  private returnFocus: HTMLElement | undefined;
  private placementFrame: number | undefined;

  constructor(private readonly options: PdfAskPanelOptions) {
    installAskPdfPanelStyles();
    const restored = stateRecord(options.vscode.getState());
    this.windows = normalizeAskPdfWindows(restored.askPdfWindows);
    this.drafts = normalizeAskPdfDrafts(restored.askPdfDrafts);
    this.modelSelections = normalizeAskPdfModelSelections(restored.askPdfModelSelections);
    this.legacyPanelWidth = clampPanelWidth(restored.askPdfPanelWidth);
    this.draft = typeof restored.askPdfDraft === 'string' ? restored.askPdfDraft : '';

    this.countButton = document.createElement('button');
    this.countButton.id = 'ask-pdf-count';
    this.countButton.type = 'button';
    this.countButton.className = 'ask-pdf-count';
    this.countButton.textContent = '✦ 0';
    this.countButton.ariaLabel = 'PDF discussions (0)';
    this.countButton.addEventListener('click', () => {
      this.viewRevision++;
      this.overviewOpen = true;
      this.activateWindow(ASK_PDF_OVERVIEW_KEY, { detached: true, restore: true });
      this.closedByUser = false;
      this.pendingPanelFocus = true;
      this.openPanel();
      this.render();
    });
    options.toolbar.insertBefore(this.countButton, document.getElementById('page-info'));

    this.view = createAskPdfPanelView(
      event => this.handleViewEvent(event),
      markdown => sanitizedMarkdown(markdown),
    );
    this.panel = this.view.element;
    this.header = this.view.header;
    this.liveRegion = this.view.liveRegion;
    this.resetPositionButton = this.view.resetPositionButton;
    this.panel.style.width = `${this.legacyPanelWidth}px`;
    this.panel.style.height = `${ASK_PDF_DEFAULT_HEIGHT}px`;

    this.resizer = this.resizeHandle('se', true);
    this.setupDrag(this.header);
    const resizeHandles = ['n', 'ne', 'e', 's', 'sw', 'w', 'nw'].map(direction => this.resizeHandle(direction, false));
    this.panel.prepend(this.resizer, ...resizeHandles);
    window.addEventListener('keydown', event => {
      const target = event.target;
      const targetIsInsidePanel = target instanceof Node && this.panel.contains(target);
      if (
        event.key !== 'Escape'
        || event.defaultPrevented
        || this.panel.hidden
        || this.overviewOpen
        || !this.activeAnnotationId
        || !(target instanceof Node)
        || !this.options.viewerShell.contains(target)
        || (!targetIsInsidePanel && target instanceof Element && target.closest('button, input, textarea, select, [role="menu"], [role="dialog"]'))
      ) return;
      event.preventDefault();
      this.minimizePanel();
    });
    if (!options.viewerShell.hasAttribute('tabindex')) options.viewerShell.tabIndex = -1;
    options.viewerShell.appendChild(this.panel);
    options.viewerShell.addEventListener('scroll', () => this.schedulePlacement(), true);
    window.addEventListener('resize', () => this.schedulePlacement());
    this.render();
    this.post({ type: 'pdfDiscussionList' });
  }

  openForSelection(selection: PdfAskSelection): void {
    const rects = validRects(selection.rects);
    if (!rects.length) {
      this.showSelectionError('Select text on one page');
      return;
    }
    this.viewRevision++;
    this.currentSelection = { ...selection, rects };
    this.activeAnnotationId = undefined;
    this.currentSelectionKey = undefined;
    const crop = capturePdfSelectionSnapshot(
      this.options.getPageSurface(selection.page) ?? { canvas: document.createElement('canvas'), pageWidth: 1, pageHeight: 1 },
      this.currentSelection,
    );
    this.currentCropDataUrl = crop?.dataUrl;
    this.currentCropRect = crop?.cropRect;
    this.errorMessage = undefined;
    this.transientActionError = undefined;
    this.linkCopyNotice = undefined;
    this.promotionError = undefined;
    this.overviewOpen = false;
    this.activateWindow(`draft:${++this.transientWindowSequence}`, { restore: true });
    this.closedByUser = false;
    this.pendingPanelFocus = true;
    this.openPanel();
    this.render();
    this.post({ type: 'pdfDiscussionPrepare', selection: this.currentSelection });
  }

  showSelectionError(message: string): void {
    this.viewRevision++;
    this.errorMessage = message;
    this.overviewOpen = false;
    if (!this.activeWindowKey) this.activateWindow(`draft:${++this.transientWindowSequence}`, { restore: true });
    this.closedByUser = false;
    this.pendingPanelFocus = true;
    this.openPanel();
    this.render();
  }

  handleHostMessage(message: any): boolean {
    switch (message?.type) {
      case 'pdfDiscussionSnapshot': {
        this.annotations = sortAnnotations(Array.isArray(message.annotations) ? message.annotations : []);
        this.consentGranted = message.consentGranted === true;
        this.ensureModelCatalog();
        if (typeof message.activeAnnotationId === 'string') {
          const candidate = this.annotations.find(annotation => annotation.id === message.activeAnnotationId);
          if (candidate && this.shouldAdoptSnapshotActive(message, candidate)) {
            this.adoptAnnotation(candidate);
            if (!this.closedByUser) this.openPanel();
          }
        }
        if (!this.activeAnnotationId && this.currentSelectionKey) {
          const candidate = this.annotations.find(annotation => annotation.selectionKey === this.currentSelectionKey);
          if (candidate) {
            this.adoptAnnotation(candidate);
            if (!this.closedByUser) this.openPanel();
          }
        }
        for (const annotation of this.annotations) {
          if (annotation.lastTurn.status !== 'running') this.streaming.delete(annotation.id);
          this.turnStates.set(annotation.id, annotation.lastTurn);
        }
        this.acknowledgePendingSubmit(this.annotations);
        this.clearResolvedTransientError(this.annotations);
        this.updateCount();
        this.requestActiveSnapshot();
        this.options.redrawMarkers();
        this.render();
        return true;
      }
      case 'pdfDiscussionModels': {
        this.modelCatalogRequested = false;
        this.modelCatalogResolved = true;
        this.models = normalizePdfDiscussionModels(message.models);
        this.modelCatalogError = typeof message.error === 'string' && message.error.trim()
          ? message.error.trim()
          : undefined;
        this.render();
        return true;
      }
      case 'pdfDiscussionHighlights':
        this.applyHighlightState(Array.isArray(message.highlights) ? message.highlights : []);
        this.options.redrawMarkers();
        this.render();
        return true;
      case 'pdfDiscussionPrepared': {
        if (!this.isCurrentResponse(message)) return true;
        this.currentSelectionKey = typeof message.selectionKey === 'string' ? message.selectionKey : undefined;
        if (message.annotation) {
          this.annotations = sortAnnotations([
            message.annotation,
            ...this.annotations.filter(annotation => annotation.id !== message.annotation.id),
          ]);
          this.adoptAnnotation(message.annotation);
          this.updateCount();
          this.requestActiveSnapshot();
          this.options.redrawMarkers();
        } else if (this.currentSelectionKey) {
          this.activateWindow(`selection:${this.currentSelectionKey}`, {
            migrateFrom: isTransientWindowKey(this.activeWindowKey) ? this.activeWindowKey : undefined,
          });
        }
        this.render();
        return true;
      }
      case 'pdfDiscussionSnapshotImage':
        if (typeof message.annotationId === 'string') {
          const annotationId = message.annotationId;
          this.snapshotRequests.delete(annotationId);
          if (typeof message.snapshotPngBase64 === 'string' && message.snapshotPngBase64.length > 0) {
            this.unavailableSnapshots.delete(annotationId);
            this.snapshotImages.set(annotationId, `data:image/png;base64,${message.snapshotPngBase64}`);
          } else {
            this.snapshotImages.delete(annotationId);
            this.unavailableSnapshots.add(annotationId);
          }
          if (this.activeAnnotationId === annotationId) this.currentCropDataUrl = undefined;
        }
        this.render();
        return true;
      case 'pdfDiscussionDelta': {
        if (typeof message.annotationId !== 'string') return true;
        const delta = String(message.delta ?? '');
        this.streaming.set(message.annotationId, `${this.streaming.get(message.annotationId) ?? ''}${delta}`);
        if (delta && message.annotationId === this.activeAnnotationId) this.liveRegion.textContent = delta;
        if (!this.closedByUser) this.openPanel();
        this.render();
        return true;
      }
      case 'pdfDiscussionTurnState': {
        if (typeof message.annotationId !== 'string') return true;
        const status = normalizeTurnStatus(message.status);
        this.turnStates.set(message.annotationId, {
          status,
          ...(typeof message.error === 'string' ? { error: message.error } : {}),
        });
        if (status === 'running') {
          const annotation = this.annotations.find(candidate => candidate.id === message.annotationId);
          const pending = this.pendingSubmitEntry(annotation, message.annotationId);
          if (pending) this.clearPendingSubmit(...pending, annotation);
        }
        if (message.status !== 'running') this.streaming.delete(message.annotationId);
        if (!this.closedByUser) this.openPanel();
        this.options.redrawMarkers();
        this.render();
        return true;
      }
      case 'pdfDiscussionPromotionState':
        if (!this.isRelevantAnnotationResponse(message)) return true;
        this.promotionError = message.opened === false && typeof message.error === 'string'
          ? { annotationId: String(message.annotationId), threadId: String(message.threadId), error: message.error }
          : undefined;
        this.render();
        return true;
      case 'pdfDiscussionPortableLinkCopied':
        if (!this.isCurrentResponse(message)) return true;
        this.linkCopyNotice = 'Portable selection link copied.';
        this.render();
        return true;
      case 'pdfDiscussionError': {
        const matchingPendingSubmit = typeof message.requestId === 'string'
          ? Array.from(this.pendingSubmits.entries()).find(([, pending]) => pending.requestId === message.requestId)
          : undefined;
        if (matchingPendingSubmit) this.pendingSubmits.delete(matchingPendingSubmit[0]);
        if (!this.isRelevantError(message)) {
          if (matchingPendingSubmit) this.render();
          return true;
        }
        {
          const errorMessage = typeof message.message === 'string' ? message.message : 'Ask PDF could not complete that action.';
          this.errorMessage = errorMessage;
          const context = this.currentRequestContext(message);
          this.transientActionError = context && isTransientActionError(context.type, errorMessage)
            ? {
                ...(typeof message.annotationId === 'string'
                  ? { annotationId: message.annotationId }
                  : context.annotationId ? { annotationId: context.annotationId } : {}),
                ...(context.selectionKey ? { selectionKey: context.selectionKey } : {}),
              }
            : undefined;
        }
        if (!this.closedByUser) this.openPanel();
        this.render();
        return true;
      }
      default:
        return false;
    }
  }

  renderMarkersForPage(page: number, layer: HTMLElement, scale: number): void {
    layer.querySelectorAll('.pdf-discussion-outline, .pdf-discussion-marker').forEach(element => element.remove());
    const ordered = sortAnnotations(this.annotations);
    ordered.forEach((annotation, index) => {
      if (annotation.anchor.page !== page) return;
      const rects = normalizePdfTextBands(annotation.anchor.rects);
      const state = this.turnStates.get(annotation.id) ?? annotation.lastTurn;
      const status = annotationVisualStatus(annotation, state.status);
      rects.forEach((rect, rectIndex) => {
        const outline = document.createElement('div');
        outline.className = `pdf-discussion-outline ${status}${annotation.id === this.activeAnnotationId ? ' active' : ''}`;
        outline.dataset.annotationId = annotation.id;
        outline.setAttribute('aria-hidden', 'true');
        positionRect(outline, rect, scale);
        layer.appendChild(outline);
        if (rectIndex !== 0) return;
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = `pdf-discussion-marker ${status}${annotation.id === this.activeAnnotationId ? ' active' : ''}`;
        marker.dataset.annotationId = annotation.id;
        marker.ariaLabel = `Open PDF discussion ${index + 1}`;
        marker.style.left = `${rect[2] * scale - 9}px`;
        marker.style.top = `${rect[1] * scale - 9}px`;
        const number = document.createElement('span');
        number.className = 'number';
        number.textContent = String(index + 1);
        marker.appendChild(number);
        marker.addEventListener('click', event => {
          event.stopPropagation();
          this.openAnnotation(annotation);
        });
        layer.appendChild(marker);
      });
    });
    // Marker DOM is rebuilt after snapshots and page rerenders. Re-run
    // placement on the next frame so the floating inspector can avoid nearby
    // discussion controls that did not exist during the first geometry pass.
    this.schedulePlacement();
  }

  private resizeHandle(direction: string, accessible: boolean): HTMLElement {
    const handle = document.createElement('div');
    handle.className = `ask-pdf-resize-handle ask-pdf-resize-${direction}${accessible ? ' ask-pdf-resizer' : ''}`;
    handle.dataset.direction = direction;
    handle.setAttribute('aria-hidden', accessible ? 'false' : 'true');
    if (accessible) {
      const range = this.resizeWidthRange();
      const initialWidth = Math.round(clamp(this.legacyPanelWidth, range.minimum, range.maximum));
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-label', 'Resize Ask PDF');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-valuemin', String(range.minimum));
      handle.setAttribute('aria-valuemax', String(range.maximum));
      handle.setAttribute('aria-valuenow', String(initialWidth));
      handle.setAttribute('aria-valuetext', `${initialWidth} by ${ASK_PDF_DEFAULT_HEIGHT} pixels`);
      handle.tabIndex = 0;
    }
    this.setupResizeHandle(handle, direction as AskPdfResizeDirection, accessible);
    return handle;
  }

  private setupResizeHandle(handle: HTMLElement, direction: AskPdfResizeDirection, accessible: boolean): void {
    handle.addEventListener('pointerdown', event => {
      if (window.innerWidth < ASK_PDF_NARROW_BREAKPOINT || !this.activeWindowKey) return;
      event.preventDefault();
      event.stopPropagation();
      const start = { ...this.currentWindowState() };
      const startX = event.clientX;
      const startY = event.clientY;
      handle.setPointerCapture?.(event.pointerId);
      const onMove = (move: PointerEvent): void => {
        this.resizeActiveWindow(start, direction, move.clientX - startX, move.clientY - startY);
      };
      const onUp = (up: PointerEvent): void => {
        handle.releasePointerCapture?.(up.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
    if (!accessible) return;
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const state = this.currentWindowState();
      const next = this.boundGeometry({
        ...state,
        width: state.width + (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0),
        height: state.height + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0),
        detached: true,
      });
      this.commitWindowState(next);
    });
  }

  private resizeActiveWindow(
    start: AskPdfWindowState,
    direction: AskPdfResizeDirection,
    deltaX: number,
    deltaY: number,
  ): void {
    let { left, top, width, height } = start;
    if (direction.includes('e')) width += deltaX;
    if (direction.includes('s')) height += deltaY;
    if (direction.includes('w')) {
      left += deltaX;
      width -= deltaX;
    }
    if (direction.includes('n')) {
      top += deltaY;
      height -= deltaY;
    }
    const next = this.boundGeometry({
      ...start,
      left,
      top,
      width,
      height,
      detached: true,
    });
    if (direction.includes('w')) next.left = start.left + start.width - next.width;
    if (direction.includes('n')) next.top = start.top + start.height - next.height;
    this.commitWindowState(this.boundGeometry(next));
  }

  private setupDrag(header: HTMLElement): void {
    header.addEventListener('pointerdown', event => {
      if (
        window.innerWidth < ASK_PDF_NARROW_BREAKPOINT
        || event.button !== 0
        || !this.activeWindowKey
        || (event.target instanceof Element && event.target.closest('button'))
      ) return;
      const start = { ...this.currentWindowState() };
      const startX = event.clientX;
      const startY = event.clientY;
      let intentionalMove = false;
      header.setPointerCapture?.(event.pointerId);
      const onMove = (move: PointerEvent): void => {
        const deltaX = move.clientX - startX;
        const deltaY = move.clientY - startY;
        if (!intentionalMove && Math.hypot(deltaX, deltaY) < 4) return;
        intentionalMove = true;
        move.preventDefault();
        this.commitWindowState(this.boundGeometry({
          ...start,
          left: start.left + deltaX,
          top: start.top + deltaY,
          detached: true,
        }));
      };
      const onUp = (up: PointerEvent): void => {
        header.releasePointerCapture?.(up.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  private reattachPanel(): void {
    if (this.overviewOpen || !this.activeWindowKey) return;
    const state = this.currentWindowState();
    this.commitWindowState({ ...state, detached: false });
    this.schedulePlacement();
  }

  private render(): void {
    this.view.update(this.createViewModel());
    if (this.pendingPanelFocus) {
      this.pendingPanelFocus = false;
      queueMicrotask(() => this.focusPrimaryPanelControl());
    }
  }

  private createViewModel(): AskPdfViewModel {
    const responsiveMode: AskPdfViewModel['responsiveMode'] = window.innerWidth < ASK_PDF_NARROW_BREAKPOINT
      ? 'full-width'
      : window.innerWidth < 900
        ? 'overlay'
        : 'floating';
    const resetPositionVisible = !this.overviewOpen
      && Boolean(this.activeWindowKey)
      && this.currentWindowState().detached;
    const base = {
      responsiveMode,
      resetPositionVisible,
      closeMode: this.overviewOpen ? 'close' as const : 'minimize' as const,
      messages: [],
      running: false,
      notices: [],
      actions: [],
      overviewItems: [],
    };
    if (this.overviewOpen) {
      return {
        ...base,
        mode: 'overview',
        overviewItems: sortAnnotations(this.annotations).map((annotation, index) => ({
          id: annotation.id,
          number: index + 1,
          page: annotation.anchor.page,
          title: annotation.messages.find(message => message.role === 'user')?.markdown
            ?? annotation.anchor.quote,
          status: annotationVisualStatus(annotation, annotation.lastTurn.status),
        })),
      };
    }
    const annotation = this.activeAnnotation();
    const selection = annotation ? selectionFromAnnotation(annotation) : this.currentSelection;
    if (!selection) {
      return {
        ...base,
        mode: 'empty',
        emptyText: this.errorMessage
          ?? 'Select a passage, then choose Ask about selection…',
      };
    }

    const turnState = this.activeTurnState(annotation);
    const streaming = this.activeAnnotationId ? this.streaming.get(this.activeAnnotationId) : undefined;
    const notices: AskPdfViewModel['notices'] = [];
    if (this.errorMessage) notices.push({ kind: 'error', text: this.errorMessage });
    const actions: AskPdfViewModel['actions'] = [];
    if (turnState.status === 'failed') {
      notices.push({
        kind: 'error',
        text: turnState.error ?? annotation?.lastTurn.error ?? 'Codex could not answer this question.',
      });
      if (annotation && this.consentGranted) actions.push({ kind: 'retry', label: 'Retry answer', primary: true });
    } else if (turnState.status === 'cancelled') {
      notices.push({ kind: 'status', text: 'Response stopped. You can revise the question and send again.' });
    }
    if (annotation && annotationHasAnswer(annotation) && turnState.status !== 'running') {
      if (annotation.learningNotePath) {
        actions.push({ kind: 'open-note', label: 'Open learning note', primary: true });
      }
      if (!annotation.promotion && this.consentGranted) {
        actions.push({
          kind: 'promote',
          label: 'Continue in Codex',
          primary: !annotation.learningNotePath,
        });
      } else if (annotation.promotion) {
        actions.push({ kind: 'open-task', label: 'Open Codex task', primary: true });
        if (this.promotionError?.annotationId === annotation.id) {
          notices.push({ kind: 'error', text: this.promotionError.error });
          actions.push(
            { kind: 'retry-open', label: 'Retry opening' },
            { kind: 'copy-task-id', label: 'Copy task ID' },
          );
        }
      }
    }
    const pendingSubmit = this.pendingSubmitFor(annotation);
    return {
      ...base,
      mode: 'discussion',
      source: {
        key: annotation?.id ?? this.currentSelectionKey ?? `selection:${selection.page}:${selection.quote ?? selection.snippet ?? ''}`,
        page: selection.page,
        quote: selection.quote ?? selection.snippet ?? '',
        ...(selection.prefix ? { prefix: selection.prefix } : {}),
        ...(selection.suffix ? { suffix: selection.suffix } : {}),
        ...(this.availableCrop(annotation) ? { cropUrl: this.availableCrop(annotation) } : {}),
        ...(this.linkCopyNotice ? { linkNotice: this.linkCopyNotice } : {}),
      },
      messages: annotation?.messages.map(message => ({
        id: message.id,
        role: message.role,
        markdown: message.markdown,
        ...(message.codexModel ? { codexModel: message.codexModel } : {}),
      })) ?? [],
      ...(streaming ? { streamingMarkdown: streaming } : {}),
      running: turnState.status === 'running',
      ...(!annotation?.messages.length && !streaming
        ? { transcriptEmptyText: 'Your question and the cited response will appear here.' }
        : {}),
      notices,
      ...(!this.consentGranted
        ? {
            consent: {
              body: this.availableCrop(annotation)
                ? 'Selected text and crop are sent to Codex. Cached web search may be used when it helps answer the question.'
                : 'Selected text is sent to Codex. Cached web search may be used when it helps answer the question. The page crop is unavailable, so Ask PDF will use text-only context.',
            },
          }
        : {}),
      composer: {
        draft: this.draft,
        ariaLabel: 'Ask about this selection',
        placeholder: 'Ask about this selection',
        disabled: !this.consentGranted || turnState.status === 'running' || Boolean(pendingSubmit),
        sendDisabled: !this.consentGranted
          || !Boolean(annotation || this.currentSelectionKey)
          || Boolean(pendingSubmit)
          || !this.draft.trim(),
        running: turnState.status === 'running',
        models: this.models,
        ...(this.selectedModel(annotation) ? { selectedModel: this.selectedModel(annotation) } : {}),
        ...(this.modelCatalogError ? { modelError: this.modelCatalogError } : {}),
      },
      actions,
    };
  }

  private handleViewEvent(event: AskPdfViewEvent): void {
    const annotation = this.activeAnnotation();
    const selection = annotation ? selectionFromAnnotation(annotation) : this.currentSelection;
    switch (event.type) {
      case 'changeDraft':
        this.draft = event.value;
        this.saveActiveDraft();
        this.render();
        return;
      case 'selectModel':
        if (this.activeWindowKey && this.activeWindowKey !== ASK_PDF_OVERVIEW_KEY) {
          if (event.model) this.modelSelections[this.activeWindowKey] = event.model;
          else delete this.modelSelections[this.activeWindowKey];
          this.persistWindowState();
          this.render();
        }
        return;
      case 'submit':
        this.submit(annotation);
        return;
      case 'stop': {
        const annotationId = annotation?.id ?? this.activeAnnotationId;
        if (annotationId) this.post({ type: 'pdfDiscussionCancel', annotationId });
        return;
      }
      case 'retry':
        if (annotation) this.post({ type: 'pdfDiscussionRetry', annotationId: annotation.id });
        return;
      case 'copyPortableLink':
        if (annotation) this.post({ type: 'pdfDiscussionCopyPortableLink', annotationId: annotation.id });
        else if (selection) this.post({ type: 'pdfDiscussionCopyPortableLink', selection });
        return;
      case 'navigateSource':
        if (selection) void this.options.navigateTo(selection.page, validRects(selection.rects), annotation?.id);
        return;
      case 'openTranscriptLink':
        this.post({ type: 'pdfDiscussionOpenLink', href: event.href });
        return;
      case 'openLearningNote':
        if (annotation) {
          this.post({ type: 'pdfDiscussionOpenLearningNote', annotationId: annotation.id });
        }
        return;
      case 'promote':
        if (annotation) this.post({ type: 'pdfDiscussionPromote', annotationId: annotation.id });
        return;
      case 'openPromotedTask':
      case 'retryOpening':
        if (annotation) this.post({ type: 'pdfDiscussionOpenPromotedTask', annotationId: annotation.id });
        return;
      case 'copyTaskId':
        if (annotation?.promotion) {
          void copyText(this.promotionError?.threadId ?? annotation.promotion.threadId);
        }
        return;
      case 'acceptConsent':
        this.pendingPanelFocus = true;
        this.post({ type: 'pdfDiscussionConsent', accepted: true });
        return;
      case 'openAnnotation': {
        const candidate = this.annotations.find(item => item.id === event.annotationId);
        if (candidate) this.openAnnotation(candidate);
        return;
      }
      case 'minimize':
        this.minimizePanel();
        return;
      case 'close':
        this.closePanel();
        return;
      case 'resetPosition':
        this.reattachPanel();
    }
  }

  private ensureModelCatalog(): void {
    if (
      !this.consentGranted
      || this.modelCatalogRequested
      || this.modelCatalogResolved
    ) return;
    this.modelCatalogRequested = true;
    this.post({ type: 'pdfDiscussionListModels' });
  }

  private selectedModel(annotation: PdfDiscussionAnnotationSnapshot | undefined): string | undefined {
    const key = this.activeWindowKey && this.activeWindowKey !== ASK_PDF_OVERVIEW_KEY
      ? this.activeWindowKey
      : undefined;
    const candidate = (key ? this.modelSelections[key] : undefined) ?? annotation?.lastTurn.model;
    if (candidate && (!this.modelCatalogResolved || this.models.some(model => model.model === candidate))) {
      return candidate;
    }
    return this.models.find(model => model.isDefault)?.model ?? this.models[0]?.model;
  }

  private submit(annotation: PdfDiscussionAnnotationSnapshot | undefined): void {
    const question = this.draft.trim();
    const pendingOwnerKey = this.pendingSubmitOwnerKey(annotation);
    if (
      !question
      || !this.consentGranted
      || !pendingOwnerKey
      || this.pendingSubmitFor(annotation)
    ) return;
    const base64 = this.currentCropDataUrl?.split(',')[1];
    const model = this.selectedModel(annotation);
    this.errorMessage = undefined;
    this.transientActionError = undefined;
    const draft = this.draft;
    const requestId = this.post({
      type: 'pdfDiscussionSubmit',
      ...(annotation ? { annotationId: annotation.id } : {}),
      ...(!annotation && this.currentSelection ? { selection: this.currentSelection } : {}),
      question,
      ...(model ? { model } : {}),
      ...(base64 ? { snapshotPngBase64: base64 } : {}),
      ...(base64 && this.currentCropRect
        ? {
            snapshotCropRect: this.currentCropRect,
            snapshotPadding: ASK_PDF_CROP_PADDING_POINTS,
          }
        : {}),
    });
    this.pendingSubmits.set(pendingOwnerKey, {
      requestId,
      ...(annotation ? { annotationId: annotation.id } : {}),
      ...(annotation?.selectionKey ?? this.currentSelectionKey
        ? { selectionKey: annotation?.selectionKey ?? this.currentSelectionKey }
        : {}),
      draft,
      question,
      priorUserMessageIds: annotation?.messages
        .filter(message => message.role === 'user')
        .map(message => message.id) ?? [],
    });
    this.render();
  }

  private openAnnotation(annotation: PdfDiscussionAnnotationSnapshot): void {
    this.viewRevision++;
    this.activeAnnotationId = annotation.id;
    this.currentSelection = selectionFromAnnotation(annotation);
    this.currentSelectionKey = annotation.selectionKey;
    this.currentCropDataUrl = undefined;
    this.currentCropRect = undefined;
    this.overviewOpen = false;
    this.activateWindow(annotation.id, { restore: true });
    this.closedByUser = false;
    this.errorMessage = undefined;
    this.transientActionError = undefined;
    this.linkCopyNotice = undefined;
    this.pendingPanelFocus = true;
    this.openPanel();
    this.requestActiveSnapshot();
    void this.options.navigateTo(annotation.anchor.page, annotation.anchor.rects, annotation.id);
    this.post({ type: 'pdfDiscussionOpen', annotationId: annotation.id });
    this.options.redrawMarkers();
    this.render();
  }

  private requestActiveSnapshot(): void {
    const annotation = this.activeAnnotation();
    if (
      !annotation?.snapshot
      || this.snapshotImages.has(annotation.id)
      || this.snapshotRequests.has(annotation.id)
      || this.unavailableSnapshots.has(annotation.id)
    ) return;
    this.snapshotRequests.add(annotation.id);
    this.post({ type: 'pdfDiscussionLoadSnapshot', annotationId: annotation.id });
  }

  private availableCrop(annotation: PdfDiscussionAnnotationSnapshot | undefined): string | undefined {
    if (!annotation) return this.currentCropDataUrl;
    if (this.unavailableSnapshots.has(annotation.id)) return undefined;
    return this.snapshotImages.get(annotation.id) ?? this.currentCropDataUrl;
  }

  private applyHighlightState(highlights: any[]): void {
    for (const highlight of highlights) {
      if (typeof highlight?.annotationId !== 'string') continue;
      const annotation = this.annotations.find(candidate => candidate.id === highlight.annotationId);
      if (!annotation) continue;
      annotation.lastTurn = {
        ...annotation.lastTurn,
        status: normalizeTurnStatus(highlight.status),
      };
      if (Array.isArray(highlight.rects)) annotation.anchor.rects = validRects(highlight.rects);
      if (typeof highlight.summaryMarkdown === 'string') annotation.summaryMarkdown = highlight.summaryMarkdown;
    }
  }

  private activeAnnotation(): PdfDiscussionAnnotationSnapshot | undefined {
    return this.annotations.find(annotation => annotation.id === this.activeAnnotationId);
  }

  private activeTurnState(annotation: PdfDiscussionAnnotationSnapshot | undefined): { status: PdfDiscussionTurnStatus; error?: string } {
    if (this.activeAnnotationId && this.turnStates.has(this.activeAnnotationId)) return this.turnStates.get(this.activeAnnotationId)!;
    return annotation?.lastTurn ?? { status: 'idle' };
  }

  private acknowledgePendingSubmit(annotations: PdfDiscussionAnnotationSnapshot[]): void {
    for (const [ownerKey, pending] of Array.from(this.pendingSubmits.entries())) {
      const annotation = annotations.find(candidate => (
        (pending.annotationId && candidate.id === pending.annotationId)
        || (pending.selectionKey && candidate.selectionKey === pending.selectionKey)
      ));
      if (!annotation) continue;
      const priorUserMessageIds = new Set(pending.priorUserMessageIds);
      const persisted = annotation.messages.some(
        message => message.role === 'user' && !priorUserMessageIds.has(message.id),
      );
      if (persisted || annotation.lastTurn.status === 'running') {
        this.clearPendingSubmit(ownerKey, pending, annotation);
      }
    }
  }

  private clearPendingSubmit(
    ownerKey: string,
    pending: PendingSubmit,
    annotation?: PdfDiscussionAnnotationSnapshot,
  ): void {
    if (this.pendingSubmits.get(ownerKey) !== pending) return;
    this.pendingSubmits.delete(ownerKey);
    const annotationWindowKey = pending.annotationId ?? annotation?.id;
    const selectionWindowKey = pending.selectionKey ? `selection:${pending.selectionKey}` : undefined;
    const draftWindowKey = annotationWindowKey && (
      annotationWindowKey in this.drafts || this.activeWindowKey === annotationWindowKey
    )
      ? annotationWindowKey
      : selectionWindowKey && (selectionWindowKey in this.drafts || this.activeWindowKey === selectionWindowKey)
        ? selectionWindowKey
        : annotationWindowKey ?? selectionWindowKey;
    if (!draftWindowKey || this.drafts[draftWindowKey] !== pending.draft) return;
    this.drafts[draftWindowKey] = '';
    if (this.activeWindowKey === draftWindowKey && this.draft === pending.draft) this.draft = '';
    this.persistWindowState();
  }

  private pendingSubmitOwnerKey(annotation: PdfDiscussionAnnotationSnapshot | undefined): string | undefined {
    if (annotation) return `annotation:${annotation.id}`;
    return this.currentSelectionKey ? `selection:${this.currentSelectionKey}` : undefined;
  }

  private pendingSubmitEntry(
    annotation: PdfDiscussionAnnotationSnapshot | undefined,
    annotationId = annotation?.id,
  ): [string, PendingSubmit] | undefined {
    const annotationKey = annotationId ? `annotation:${annotationId}` : undefined;
    if (annotationKey) {
      const pending = this.pendingSubmits.get(annotationKey);
      if (pending) return [annotationKey, pending];
    }
    const selectionKey = annotation?.selectionKey ? `selection:${annotation.selectionKey}` : undefined;
    if (selectionKey) {
      const pending = this.pendingSubmits.get(selectionKey);
      if (pending) return [selectionKey, pending];
    }
    return undefined;
  }

  private pendingSubmitFor(annotation: PdfDiscussionAnnotationSnapshot | undefined): PendingSubmit | undefined {
    return this.pendingSubmitEntry(annotation)?.[1]
      ?? (!annotation && this.currentSelectionKey
        ? this.pendingSubmits.get(`selection:${this.currentSelectionKey}`)
        : undefined);
  }

  private clearResolvedTransientError(annotations: PdfDiscussionAnnotationSnapshot[]): void {
    const transient = this.transientActionError;
    if (!transient) return;
    const annotation = annotations.find(candidate => (
      (transient.annotationId && candidate.id === transient.annotationId)
      || (!transient.annotationId && transient.selectionKey && candidate.selectionKey === transient.selectionKey)
    ));
    if (!annotation || (annotation.lastTurn.status !== 'idle' && annotation.lastTurn.status !== 'cancelled')) return;
    this.errorMessage = undefined;
    this.transientActionError = undefined;
  }

  private updateCount(): void {
    const count = this.annotations.length;
    this.countButton.textContent = `✦ ${count}`;
    this.countButton.ariaLabel = `PDF discussions (${count})`;
  }

  private adoptAnnotation(annotation: PdfDiscussionAnnotationSnapshot): void {
    const migrateFrom = this.currentSelectionKey === annotation.selectionKey && isTransientWindowKey(this.activeWindowKey)
      ? this.activeWindowKey
      : undefined;
    this.activeAnnotationId = annotation.id;
    this.currentSelection = selectionFromAnnotation(annotation);
    this.currentSelectionKey = annotation.selectionKey;
    if (!(annotation.id in this.modelSelections) && annotation.lastTurn.model) {
      this.modelSelections[annotation.id] = annotation.lastTurn.model;
    }
    if (!this.overviewOpen) this.activateWindow(annotation.id, { migrateFrom });
  }

  private activateWindow(
    key: string,
    options: { migrateFrom?: string; detached?: boolean; restore?: boolean } = {},
  ): void {
    if (this.activeWindowKey && this.activeWindowKey !== ASK_PDF_OVERVIEW_KEY) this.saveActiveDraft(false);
    const migrateFrom = options.migrateFrom;
    if (migrateFrom && migrateFrom !== key) {
      if (!this.windows[key] && this.windows[migrateFrom]) this.windows[key] = { ...this.windows[migrateFrom] };
      if (!(key in this.drafts) && migrateFrom in this.drafts) this.drafts[key] = this.drafts[migrateFrom]!;
      if (!(key in this.modelSelections) && migrateFrom in this.modelSelections) {
        this.modelSelections[key] = this.modelSelections[migrateFrom]!;
      }
      delete this.windows[migrateFrom];
      delete this.drafts[migrateFrom];
      delete this.modelSelections[migrateFrom];
    }
    this.activeWindowKey = key;
    if (key in this.drafts) {
      this.legacyDraftClaimed = true;
    } else if (key !== ASK_PDF_OVERVIEW_KEY) {
      this.drafts[key] = this.legacyDraftClaimed ? '' : this.draft;
      this.legacyDraftClaimed = true;
    }
    this.draft = key === ASK_PDF_OVERVIEW_KEY ? '' : this.drafts[key] ?? '';
    const state = this.ensureWindowState(key, options.detached === true);
    if (options.restore) state.minimized = false;
    this.persistWindowState();
    this.applyWindowGeometry();
  }

  private ensureWindowState(key: string, detached = false): AskPdfWindowState {
    const existing = this.windows[key];
    if (existing) return existing;
    const bounds = this.shellBounds();
    const width = Math.min(this.legacyPanelWidth, Math.max(1, bounds.width - ASK_PDF_VIEWPORT_INSET * 2));
    const height = Math.min(ASK_PDF_DEFAULT_HEIGHT, Math.max(1, bounds.height - ASK_PDF_VIEWPORT_INSET * 2));
    const state: AskPdfWindowState = {
      left: detached ? Math.max(ASK_PDF_VIEWPORT_INSET, Math.round((bounds.width - width) / 2)) : ASK_PDF_VIEWPORT_INSET,
      top: ASK_PDF_VIEWPORT_INSET,
      width,
      height,
      detached,
      minimized: false,
    };
    this.windows[key] = state;
    return state;
  }

  private currentWindowState(): AskPdfWindowState {
    if (!this.activeWindowKey) throw new Error('Ask PDF window state is unavailable');
    return this.ensureWindowState(this.activeWindowKey, this.activeWindowKey === ASK_PDF_OVERVIEW_KEY);
  }

  private shellBounds(): { width: number; height: number } {
    const rect = this.options.viewerShell.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  private boundGeometry(state: AskPdfWindowState): AskPdfWindowState {
    const bounds = this.shellBounds();
    const availableWidth = Math.max(1, bounds.width - ASK_PDF_VIEWPORT_INSET * 2);
    const availableHeight = Math.max(1, bounds.height - ASK_PDF_VIEWPORT_INSET * 2);
    const maximumWidth = Math.min(ASK_PDF_MAX_WIDTH, availableWidth);
    const maximumHeight = Math.min(ASK_PDF_MAX_HEIGHT, availableHeight);
    const minimumWidth = Math.min(ASK_PDF_MIN_WIDTH, maximumWidth);
    const minimumHeight = Math.min(ASK_PDF_MIN_HEIGHT, maximumHeight);
    const width = Math.round(clamp(state.width, minimumWidth, maximumWidth));
    const height = Math.round(clamp(state.height, minimumHeight, maximumHeight));
    if (window.innerWidth < ASK_PDF_NARROW_BREAKPOINT) {
      return {
        ...state,
        left: 0,
        top: 0,
        width: Math.round(bounds.width),
        height,
      };
    }
    return {
      ...state,
      left: Math.round(clamp(state.left, ASK_PDF_VIEWPORT_INSET, Math.max(ASK_PDF_VIEWPORT_INSET, bounds.width - width - ASK_PDF_VIEWPORT_INSET))),
      top: Math.round(clamp(state.top, ASK_PDF_VIEWPORT_INSET, Math.max(ASK_PDF_VIEWPORT_INSET, bounds.height - height - ASK_PDF_VIEWPORT_INSET))),
      width,
      height,
    };
  }

  private commitWindowState(state: AskPdfWindowState): void {
    if (!this.activeWindowKey) return;
    this.windows[this.activeWindowKey] = state;
    this.persistWindowState();
    this.applyWindowGeometry();
    this.renderContentHeaderState();
  }

  private applyWindowGeometry(): void {
    if (!this.activeWindowKey) return;
    let state = this.boundGeometry(this.currentWindowState());
    let attachment: 'left' | 'right' | 'top' | 'bottom' | undefined;
    const annotation = this.activeAnnotation();
    const selection = annotation ? selectionFromAnnotation(annotation) : this.currentSelection;
    const anchor = !this.overviewOpen && !state.detached && selection
      ? this.options.getAnchorViewportRect(selection.page, validRects(selection.rects))
      : undefined;
    if (anchor && window.innerWidth >= ASK_PDF_NARROW_BREAKPOINT) {
      const placed = this.attachedGeometry(state, anchor);
      state = placed.state;
      attachment = placed.attachment;
    }
    if (window.innerWidth >= ASK_PDF_NARROW_BREAKPOINT) {
      this.windows[this.activeWindowKey] = state;
      this.persistWindowState();
    }
    this.panel.style.left = `${state.left}px`;
    this.panel.style.top = `${state.top}px`;
    this.panel.style.width = `${state.width}px`;
    this.panel.style.height = `${state.height}px`;
    this.panel.dataset.responsiveMode = window.innerWidth < ASK_PDF_NARROW_BREAKPOINT
      ? 'full-width'
      : window.innerWidth < 900
        ? 'overlay'
        : 'floating';
    this.panel.classList.toggle('attached', Boolean(attachment));
    if (attachment) this.panel.dataset.attachment = attachment;
    else delete this.panel.dataset.attachment;
    this.updateResizeAccessibility(state);
  }

  private attachedGeometry(
    state: AskPdfWindowState,
    anchor: { left: number; top: number; right: number; bottom: number },
  ): { state: AskPdfWindowState; attachment: 'left' | 'right' | 'top' | 'bottom' } {
    const centerX = (anchor.left + anchor.right) / 2;
    const centerY = (anchor.top + anchor.bottom) / 2;
    const candidates: Array<{ left: number; top: number; attachment: 'left' | 'right' | 'top' | 'bottom' }> = [
      { left: anchor.right + ASK_PDF_ANCHOR_GAP, top: centerY - state.height / 2, attachment: 'left' },
      { left: anchor.left - state.width - ASK_PDF_ANCHOR_GAP, top: centerY - state.height / 2, attachment: 'right' },
      { left: centerX - state.width / 2, top: anchor.bottom + ASK_PDF_ANCHOR_GAP, attachment: 'top' },
      { left: centerX - state.width / 2, top: anchor.top - state.height - ASK_PDF_ANCHOR_GAP, attachment: 'bottom' },
    ];
    const bounds = this.shellBounds();
    const fits = (candidate: { left: number; top: number }): boolean => (
      candidate.left >= ASK_PDF_VIEWPORT_INSET
      && candidate.top >= ASK_PDF_VIEWPORT_INSET
      && candidate.left + state.width <= bounds.width - ASK_PDF_VIEWPORT_INSET
      && candidate.top + state.height <= bounds.height - ASK_PDF_VIEWPORT_INSET
    );
    const clampCandidate = (candidate: typeof candidates[number]): typeof candidates[number] => ({
      ...candidate,
      left: clamp(candidate.left, ASK_PDF_VIEWPORT_INSET, Math.max(ASK_PDF_VIEWPORT_INSET, bounds.width - state.width - ASK_PDF_VIEWPORT_INSET)),
      top: clamp(candidate.top, ASK_PDF_VIEWPORT_INSET, Math.max(ASK_PDF_VIEWPORT_INSET, bounds.height - state.height - ASK_PDF_VIEWPORT_INSET)),
    });
    const overlapsAnchor = (candidate: { left: number; top: number }): boolean => !(
      candidate.left + state.width <= anchor.left
      || candidate.left >= anchor.right
      || candidate.top + state.height <= anchor.top
      || candidate.top >= anchor.bottom
    );
    const markerObstacles = this.discussionMarkerObstacles();
    const overlapsMarker = (candidate: { left: number; top: number }): boolean => markerObstacles.some(marker => !(
      candidate.left + state.width <= marker.left
      || candidate.left >= marker.right
      || candidate.top + state.height <= marker.top
      || candidate.top >= marker.bottom
    ));
    const candidate = candidates.find(value => fits(value) && !overlapsMarker(value))
      ?? candidates.map(clampCandidate).find(value => !overlapsAnchor(value) && !overlapsMarker(value))
      ?? clampCandidate(candidates[0]!);
    return {
      state: this.boundGeometry({ ...state, left: candidate.left, top: candidate.top, detached: false }),
      attachment: candidate.attachment,
    };
  }

  private discussionMarkerObstacles(): Array<{ left: number; top: number; right: number; bottom: number }> {
    const shell = this.options.viewerShell.getBoundingClientRect();
    return Array.from(this.options.viewerShell.querySelectorAll<HTMLElement>('.pdf-discussion-marker'))
      .filter(marker => marker.dataset.annotationId !== this.activeAnnotationId)
      .map(marker => {
        const rect = marker.getBoundingClientRect();
        const clearance = 4;
        return {
          left: rect.left - shell.left - clearance,
          top: rect.top - shell.top - clearance,
          right: rect.right - shell.left + clearance,
          bottom: rect.bottom - shell.top + clearance,
        };
      });
  }

  private updateResizeAccessibility(state: AskPdfWindowState): void {
    const range = this.resizeWidthRange();
    const value = Math.round(clamp(state.width, range.minimum, range.maximum));
    this.resizer.setAttribute('aria-valuemin', String(range.minimum));
    this.resizer.setAttribute('aria-valuemax', String(range.maximum));
    this.resizer.setAttribute('aria-valuenow', String(value));
    this.resizer.setAttribute('aria-valuetext', `${Math.round(state.width)} by ${Math.round(state.height)} pixels`);
  }

  private resizeWidthRange(): { minimum: number; maximum: number } {
    const availableWidth = Math.max(1, this.shellBounds().width - ASK_PDF_VIEWPORT_INSET * 2);
    if (window.innerWidth < ASK_PDF_NARROW_BREAKPOINT) {
      const fixedWidth = Math.round(this.shellBounds().width);
      return { minimum: fixedWidth, maximum: fixedWidth };
    }
    const maximum = Math.round(Math.min(ASK_PDF_MAX_WIDTH, availableWidth));
    return { minimum: Math.round(Math.min(ASK_PDF_MIN_WIDTH, maximum)), maximum };
  }

  private renderContentHeaderState(): void {
    if (!this.activeWindowKey || this.overviewOpen) return;
    this.resetPositionButton.hidden = !this.currentWindowState().detached;
  }

  private schedulePlacement(): void {
    if (this.placementFrame !== undefined) return;
    this.placementFrame = window.requestAnimationFrame(() => {
      this.placementFrame = undefined;
      this.applyWindowGeometry();
    });
  }

  private saveActiveDraft(persist = true): void {
    if (this.activeWindowKey && this.activeWindowKey !== ASK_PDF_OVERVIEW_KEY) {
      this.drafts[this.activeWindowKey] = this.draft;
    }
    if (persist) this.persistWindowState();
  }

  private persistWindowState(): void {
    this.saveState({
      askPdfDraft: this.draft,
      askPdfDrafts: { ...this.drafts },
      askPdfModelSelections: { ...this.modelSelections },
      askPdfWindows: Object.fromEntries(
        Object.entries(this.windows).map(([key, value]) => [key, { ...value }]),
      ),
    });
  }

  private openPanel(): void {
    if (!this.overviewOpen && this.activeWindowKey && this.currentWindowState().minimized) return;
    if (this.panel.hidden) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !this.panel.contains(active)) {
        this.returnFocus = active;
      }
    }
    this.panel.hidden = false;
    this.applyWindowGeometry();
  }

  private minimizePanel(): void {
    if (!this.activeWindowKey) return;
    const state = this.currentWindowState();
    this.windows[this.activeWindowKey] = { ...state, minimized: true };
    this.persistWindowState();
    this.closedByUser = true;
    this.hidePanelAndRestoreFocus();
  }

  private closePanel(): void {
    this.closedByUser = true;
    this.hidePanelAndRestoreFocus();
  }

  private hidePanelAndRestoreFocus(): void {
    this.panel.hidden = true;
    const target = this.returnFocus?.isConnected ? this.returnFocus : this.options.viewerShell;
    queueMicrotask(() => target.focus({ preventScroll: true }));
  }

  private focusPrimaryPanelControl(): void {
    this.view.focusPrimary();
  }

  private post(message: Record<string, unknown>): string {
    const requestId = `ask-pdf-${++this.requestSequence}`;
    this.requestContexts.set(requestId, {
      revision: this.viewRevision,
      type: typeof message.type === 'string' ? message.type : '',
      ...(typeof message.annotationId === 'string' ? { annotationId: message.annotationId } : {}),
      ...(this.activeAnnotation()?.selectionKey ?? this.currentSelectionKey
        ? { selectionKey: this.activeAnnotation()?.selectionKey ?? this.currentSelectionKey }
        : {}),
    });
    while (this.requestContexts.size > 200) {
      const oldest = this.requestContexts.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.requestContexts.delete(oldest);
    }
    this.options.vscode.postMessage({ ...message, requestId });
    return requestId;
  }

  private currentRequestContext(message: any): AskPdfRequestContext | undefined {
    if (typeof message?.requestId !== 'string') return undefined;
    const context = this.requestContexts.get(message.requestId);
    return context?.revision === this.viewRevision ? context : undefined;
  }

  private isCurrentResponse(message: any): boolean {
    return Boolean(this.currentRequestContext(message));
  }

  private isRelevantAnnotationResponse(message: any): boolean {
    const annotationId = typeof message?.annotationId === 'string' ? message.annotationId : undefined;
    if (!annotationId) return false;
    if (annotationId === this.activeAnnotationId) return true;
    const context = this.currentRequestContext(message);
    return Boolean(context?.annotationId && context.annotationId === annotationId);
  }

  private isRelevantError(message: any): boolean {
    if (typeof message?.requestId === 'string') return this.isCurrentResponse(message);
    return typeof message?.annotationId === 'string' && message.annotationId === this.activeAnnotationId;
  }

  private shouldAdoptSnapshotActive(message: any, candidate: PdfDiscussionAnnotationSnapshot): boolean {
    if (candidate.id === this.activeAnnotationId) return true;
    if (!this.activeAnnotationId && this.currentSelectionKey === candidate.selectionKey) return true;
    const context = this.currentRequestContext(message);
    if (context?.annotationId === candidate.id) return true;
    return this.viewRevision === 0 && !this.activeAnnotationId && !this.currentSelection;
  }

  private saveState(patch: Partial<AskPdfWebviewState>): void {
    this.options.vscode.setState({ ...stateRecord(this.options.vscode.getState()), ...patch });
  }
}

function sanitizedMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'li', 'ol', 'p', 'pre', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'th',
      'thead', 'tr', 'ul',
    ],
    ALLOWED_ATTR: ['class', 'href', 'start', 'title'],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  });
}

function positionRect(element: HTMLElement, rect: PdfRect, scale: number): void {
  element.style.left = `${rect[0] * scale}px`;
  element.style.top = `${rect[1] * scale}px`;
  element.style.width = `${Math.max(1, (rect[2] - rect[0]) * scale)}px`;
  element.style.height = `${Math.max(1, (rect[3] - rect[1]) * scale)}px`;
}

function isTransientActionError(requestType: string, message: string): boolean {
  if (requestType !== 'pdfDiscussionSubmit'
    && requestType !== 'pdfDiscussionRetry'
    && requestType !== 'pdfDiscussionCancel') return false;
  return /\bactive turn\b|\bno (?:active|running) turn\b|\bturn (?:is )?not (?:currently )?running\b/i.test(message);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
}
