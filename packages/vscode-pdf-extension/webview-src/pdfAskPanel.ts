import DOMPurify from 'dompurify';
import { marked } from 'marked';

const ASK_PDF_ACCENT = '#4dabf7';
const ASK_PDF_MAX_PNG_BYTES = 5 * 1024 * 1024;
const ASK_PDF_MAX_CROP_EDGE = 1600;
const ASK_PDF_CROP_PADDING_POINTS = 24;
const ASK_PDF_MIN_WIDTH = 320;
const ASK_PDF_DEFAULT_WIDTH = 380;
const ASK_PDF_MAX_WIDTH = 560;
const ASK_PDF_MIN_HEIGHT = 260;
const ASK_PDF_DEFAULT_HEIGHT = 520;
const ASK_PDF_MAX_HEIGHT = 720;
const ASK_PDF_VIEWPORT_INSET = 12;
const ASK_PDF_ANCHOR_GAP = 16;
const ASK_PDF_NARROW_BREAKPOINT = 620;
const ASK_PDF_OVERVIEW_KEY = '__overview__';

type PdfDiscussionTurnStatus = 'idle' | 'running' | 'failed' | 'cancelled';
type PdfRect = [number, number, number, number];

export interface PdfAskSelection {
  page: number;
  snippet?: string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  rects: number[][];
  textItemIndex?: number;
  charOffset?: number;
  endTextItemIndex?: number;
  endCharOffset?: number;
}

interface PdfDiscussionMessageSnapshot {
  id: string;
  role: 'user' | 'assistant';
  markdown: string;
  createdAt: string;
  codexTurnId?: string;
}

interface PdfDiscussionAnnotationSnapshot {
  id: string;
  kind: 'agent_discussion';
  selectionKey: string;
  anchor: {
    page: number;
    quote: string;
    prefix?: string;
    suffix?: string;
    rects: PdfRect[];
    textItemIndex?: number;
    charOffset?: number;
    endTextItemIndex?: number;
    endCharOffset?: number;
  };
  snapshot?: {
    sha256: string;
    width: number;
    height: number;
    mimeType: 'image/png';
  };
  messages: PdfDiscussionMessageSnapshot[];
  summaryMarkdown?: string;
  lastTurn: {
    status: PdfDiscussionTurnStatus;
    questionMessageId?: string;
    error?: string;
  };
  promotion?: {
    threadId: string;
    promotedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface PdfAskPageSurface {
  canvas: HTMLCanvasElement;
  pageWidth: number;
  pageHeight: number;
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

interface AskPdfWebviewState {
  askPdfPanelWidth?: number;
  askPdfDraft?: string;
  askPdfDrafts?: Record<string, string>;
  askPdfWindows?: Record<string, AskPdfWindowState>;
}

interface AskPdfWindowState {
  left: number;
  top: number;
  width: number;
  height: number;
  detached: boolean;
  minimized: boolean;
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
): string | undefined {
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
      if (base64ByteLength(dataUrl.split(',')[1] ?? '') <= ASK_PDF_MAX_PNG_BYTES) return dataUrl;
    } catch {
      return undefined;
    }
    outputScale *= 0.72;
  }
  return undefined;
}

class PdfAskPanelController implements PdfAskPanel {
  private readonly panel: HTMLElement;
  private readonly header: HTMLElement;
  private readonly content: HTMLElement;
  private readonly liveRegion: HTMLElement;
  private readonly countButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly resetPositionButton: HTMLButtonElement;
  private readonly resizer: HTMLElement;
  private readonly windows: Record<string, AskPdfWindowState>;
  private readonly drafts: Record<string, string>;
  private readonly legacyPanelWidth: number;
  private annotations: PdfDiscussionAnnotationSnapshot[] = [];
  private consentGranted = false;
  private activeAnnotationId: string | undefined;
  private activeWindowKey: string | undefined;
  private currentSelection: PdfAskSelection | undefined;
  private currentCropDataUrl: string | undefined;
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
    installAskPdfStyles();
    const restored = stateRecord(options.vscode.getState());
    this.windows = normalizeAskPdfWindows(restored.askPdfWindows);
    this.drafts = normalizeAskPdfDrafts(restored.askPdfDrafts);
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

    this.panel = document.createElement('aside');
    this.panel.id = 'ask-pdf-panel';
    this.panel.className = 'ask-pdf-panel';
    this.panel.setAttribute('aria-label', 'Ask PDF');
    this.panel.hidden = true;
    this.panel.style.width = `${this.legacyPanelWidth}px`;
    this.panel.style.height = `${ASK_PDF_DEFAULT_HEIGHT}px`;

    this.resizer = this.resizeHandle('se', true);

    this.header = document.createElement('header');
    this.header.className = 'ask-pdf-header';
    const titleGroup = document.createElement('div');
    const eyebrow = document.createElement('span');
    eyebrow.className = 'ask-pdf-eyebrow';
    eyebrow.textContent = 'SCHOLARLY MARGINALIA';
    const title = document.createElement('h2');
    title.textContent = 'Ask PDF';
    titleGroup.append(eyebrow, title);
    const headerActions = document.createElement('div');
    headerActions.className = 'ask-pdf-header-actions';
    this.resetPositionButton = iconButton('Reset Ask PDF position', '↺');
    this.resetPositionButton.addEventListener('click', () => this.reattachPanel());
    this.closeButton = iconButton('Close Ask PDF', '×');
    this.closeButton.addEventListener('click', () => {
      if (this.overviewOpen) this.closePanel();
      else this.minimizePanel();
    });
    headerActions.append(this.resetPositionButton, this.closeButton);
    this.header.append(titleGroup, headerActions);
    this.setupDrag(this.header);

    this.content = document.createElement('div');
    this.content.className = 'ask-pdf-content';
    this.liveRegion = document.createElement('p');
    this.liveRegion.className = 'ask-pdf-live-region';
    this.liveRegion.setAttribute('role', 'status');
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.liveRegion.setAttribute('aria-atomic', 'false');
    this.liveRegion.setAttribute('aria-label', 'Codex response updates');
    const resizeHandles = ['n', 'ne', 'e', 's', 'sw', 'w', 'nw'].map(direction => this.resizeHandle(direction, false));
    this.panel.append(this.resizer, ...resizeHandles, this.header, this.content, this.liveRegion);
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
    this.currentCropDataUrl = capturePdfSelectionCrop(
      this.options.getPageSurface(selection.page) ?? { canvas: document.createElement('canvas'), pageWidth: 1, pageHeight: 1 },
      this.currentSelection,
    );
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
      const rects = validRects(annotation.anchor.rects);
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
    let next = this.boundGeometry({
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
    const active = document.activeElement;
    const composerFocus = active instanceof HTMLTextAreaElement && this.content.contains(active)
      ? {
          start: active.selectionStart,
          end: active.selectionEnd,
          direction: active.selectionDirection,
          scrollTop: active.scrollTop,
        }
      : undefined;
    const controlFocus = !composerFocus && active instanceof HTMLElement && this.content.contains(active)
      ? {
          tagName: active.tagName,
          ariaLabel: active.getAttribute('aria-label'),
          text: active.textContent?.trim() ?? '',
        }
      : undefined;
    this.renderContent();
    if (composerFocus && !this.pendingPanelFocus) {
      const textarea = this.content.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)');
      if (textarea) {
        textarea.focus({ preventScroll: true });
        const length = textarea.value.length;
        textarea.setSelectionRange(
          Math.min(composerFocus.start, length),
          Math.min(composerFocus.end, length),
          composerFocus.direction,
        );
        textarea.scrollTop = composerFocus.scrollTop;
      }
    } else if (controlFocus && !this.pendingPanelFocus) {
      const replacement = Array.from(this.content.querySelectorAll<HTMLElement>(
        'button, a, summary, input, select, [tabindex]',
      )).find(candidate => (
        candidate.tagName === controlFocus.tagName
        && candidate.getAttribute('aria-label') === controlFocus.ariaLabel
        && (controlFocus.ariaLabel !== null || candidate.textContent?.trim() === controlFocus.text)
      ));
      replacement?.focus({ preventScroll: true });
    }
    if (this.pendingPanelFocus) {
      this.pendingPanelFocus = false;
      queueMicrotask(() => this.focusPrimaryPanelControl());
    }
  }

  private renderContent(): void {
    this.content.replaceChildren();
    const closeLabel = this.overviewOpen ? 'Close Ask PDF' : 'Minimize Ask PDF';
    this.closeButton.ariaLabel = closeLabel;
    this.closeButton.title = closeLabel;
    this.closeButton.textContent = this.overviewOpen ? '×' : '−';
    this.resetPositionButton.hidden = this.overviewOpen || !this.activeWindowKey || !this.currentWindowState().detached;
    if (this.overviewOpen) {
      this.renderOverview();
      return;
    }
    const annotation = this.activeAnnotation();
    const selection = annotation ? selectionFromAnnotation(annotation) : this.currentSelection;
    if (!selection) {
      const empty = document.createElement('div');
      empty.className = 'ask-pdf-empty';
      empty.innerHTML = '<span class="ask-pdf-index">✦</span><p>Select a passage, then choose <strong>Ask about selection…</strong>.</p>';
      this.content.appendChild(empty);
      if (this.errorMessage) this.content.appendChild(this.errorElement(this.errorMessage));
      return;
    }

    this.content.appendChild(this.sourceCard(selection, annotation));
    const transcript = document.createElement('section');
    transcript.className = 'ask-pdf-transcript';
    transcript.setAttribute('aria-label', 'Ask PDF transcript');
    if (annotation) {
      for (const message of annotation.messages) transcript.appendChild(this.messageElement(message));
    }
    const turnState = this.activeTurnState(annotation);
    const streaming = this.activeAnnotationId ? this.streaming.get(this.activeAnnotationId) : undefined;
    if (streaming) {
      const live = this.messageElement({
        id: 'streaming',
        role: 'assistant',
        markdown: streaming,
        createdAt: new Date().toISOString(),
      });
      live.classList.add('streaming');
      live.setAttribute('aria-label', 'Codex is responding');
      transcript.appendChild(live);
    } else if (turnState.status === 'running') {
      const live = document.createElement('p');
      live.className = 'ask-pdf-status-note';
      live.setAttribute('aria-label', 'Codex is responding');
      live.textContent = 'Codex is responding…';
      transcript.appendChild(live);
    }
    if (!annotation?.messages.length && !streaming) {
      const note = document.createElement('p');
      note.className = 'ask-pdf-transcript-empty';
      note.textContent = 'Your question and the cited response will appear here.';
      transcript.appendChild(note);
    }
    this.content.appendChild(transcript);

    if (this.errorMessage) this.content.appendChild(this.errorElement(this.errorMessage));
    if (turnState.status === 'failed') {
      this.content.appendChild(this.errorElement(turnState.error ?? annotation?.lastTurn.error ?? 'Codex could not answer this question.'));
      if (annotation) {
        if (this.consentGranted) {
          const retry = primaryButton('Retry answer');
          retry.addEventListener('click', () => this.post({ type: 'pdfDiscussionRetry', annotationId: annotation.id }));
          this.content.appendChild(retry);
        }
      }
    } else if (turnState.status === 'cancelled') {
      const cancelled = document.createElement('p');
      cancelled.className = 'ask-pdf-status-note';
      cancelled.textContent = 'Response stopped. You can revise the question and send again.';
      this.content.appendChild(cancelled);
    }

    if (!this.consentGranted) this.content.appendChild(this.consentNotice());
    this.content.appendChild(this.composer(annotation, turnState.status));
    if (annotation && annotationHasAnswer(annotation) && turnState.status !== 'running') {
      if (this.consentGranted || annotation.promotion) this.content.appendChild(this.codexActions(annotation));
    }
  }

  private renderOverview(): void {
    const region = document.createElement('section');
    region.className = 'ask-pdf-overview';
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', 'PDF discussion overview');
    const heading = document.createElement('div');
    heading.className = 'ask-pdf-section-heading';
    heading.innerHTML = '<span>DISCUSSIONS</span><strong>Page order · recent first</strong>';
    region.appendChild(heading);
    if (!this.annotations.length) {
      const empty = document.createElement('p');
      empty.className = 'ask-pdf-transcript-empty';
      empty.textContent = 'No PDF discussions yet.';
      region.appendChild(empty);
    }
    sortAnnotations(this.annotations).forEach((annotation, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ask-pdf-overview-item ${annotationVisualStatus(annotation, annotation.lastTurn.status)}`;
      const number = document.createElement('span');
      number.className = 'ask-pdf-overview-number';
      number.textContent = String(index + 1);
      const copy = document.createElement('span');
      const page = document.createElement('span');
      page.className = 'ask-pdf-overview-page';
      page.textContent = `PAGE ${annotation.anchor.page}`;
      const question = document.createElement('strong');
      question.textContent = annotation.messages.find(message => message.role === 'user')?.markdown ?? annotation.anchor.quote;
      copy.append(page, question);
      button.append(number, copy);
      button.addEventListener('click', () => this.openAnnotation(annotation));
      region.appendChild(button);
    });
    this.content.appendChild(region);
  }

  private sourceCard(selection: PdfAskSelection, annotation: PdfDiscussionAnnotationSnapshot | undefined): HTMLElement {
    const source = document.createElement('section');
    source.className = 'ask-pdf-source';
    const heading = document.createElement('div');
    heading.className = 'ask-pdf-source-heading';
    const label = document.createElement('span');
    label.textContent = 'SOURCE';
    const page = document.createElement('a');
    page.href = '#';
    page.textContent = `Page ${selection.page}`;
    page.addEventListener('click', event => {
      event.preventDefault();
      void this.options.navigateTo(selection.page, validRects(selection.rects), annotation?.id);
    });
    const actions = document.createElement('span');
    actions.className = 'ask-pdf-source-actions';
    const copyLink = document.createElement('button');
    copyLink.type = 'button';
    copyLink.textContent = 'Copy link';
    copyLink.ariaLabel = 'Copy portable selection link';
    copyLink.title = 'Copy portable page/text link';
    copyLink.addEventListener('click', () => this.post({
      type: 'pdfDiscussionCopyPortableLink',
      ...(annotation ? { annotationId: annotation.id } : { selection }),
    }));
    actions.append(page, copyLink);
    heading.append(label, actions);
    source.appendChild(heading);
    if (this.linkCopyNotice) {
      const copied = document.createElement('span');
      copied.className = 'ask-pdf-link-copied';
      copied.setAttribute('role', 'status');
      copied.textContent = this.linkCopyNotice;
      source.appendChild(copied);
    }
    const crop = this.availableCrop(annotation);
    if (crop) {
      const image = document.createElement('img');
      image.className = 'ask-pdf-crop';
      image.alt = `Selected PDF passage on page ${selection.page}`;
      image.src = crop;
      source.appendChild(image);
    }
    const details = document.createElement('details');
    details.className = 'ask-pdf-context';
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'Exact selected passage';
    const context = document.createElement('blockquote');
    const quote = selection.quote ?? selection.snippet ?? '';
    context.textContent = quote;
    details.append(summary, context);
    source.appendChild(details);
    const nearbyEntries = [
      ...(selection.prefix ? [{ label: 'Before', text: selection.prefix }] : []),
      ...(selection.suffix ? [{ label: 'After', text: selection.suffix }] : []),
    ];
    if (nearbyEntries.length) {
      const nearby = document.createElement('section');
      nearby.className = 'ask-pdf-nearby-context';
      nearby.setAttribute('aria-label', 'Nearby context');
      const nearbyHeading = document.createElement('h3');
      nearbyHeading.textContent = 'Nearby context';
      const list = document.createElement('dl');
      for (const entry of nearbyEntries) {
        const row = document.createElement('div');
        row.className = 'ask-pdf-nearby-row';
        const term = document.createElement('dt');
        term.textContent = entry.label;
        const description = document.createElement('dd');
        description.textContent = entry.text;
        row.append(term, description);
        list.appendChild(row);
      }
      nearby.append(nearbyHeading, list);
      source.appendChild(nearby);
    }
    return source;
  }

  private messageElement(message: PdfDiscussionMessageSnapshot): HTMLElement {
    const element = document.createElement('article');
    element.className = `ask-pdf-message ${message.role}`;
    const rail = document.createElement('span');
    rail.className = 'ask-pdf-message-rail';
    const label = document.createElement('span');
    label.className = 'ask-pdf-role';
    label.textContent = message.role === 'user' ? 'YOU' : 'CODEX';
    const body = document.createElement('div');
    body.className = 'ask-pdf-markdown';
    if (message.role === 'assistant') {
      body.innerHTML = sanitizedMarkdown(message.markdown);
      for (const link of Array.from(body.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
        const href = link.href;
        link.href = '#';
        link.removeAttribute('target');
        const openThroughHost = (event: Event) => {
          event.preventDefault();
          this.post({ type: 'pdfDiscussionOpenLink', href });
        };
        link.addEventListener('click', openThroughHost);
        link.addEventListener('auxclick', openThroughHost);
      }
    } else {
      body.textContent = message.markdown;
    }
    element.append(rail, label, body);
    return element;
  }

  private consentNotice(): HTMLElement {
    const notice = document.createElement('section');
    notice.className = 'ask-pdf-consent';
    notice.setAttribute('aria-label', 'Ask PDF first-use notice');
    const title = document.createElement('strong');
    title.textContent = 'Before the first question';
    const body = document.createElement('p');
    body.textContent = this.availableCrop(this.activeAnnotation())
      ? 'Selected text and crop are sent to Codex, and cached web search may be used when it helps answer the question.'
      : 'Selected text is sent to Codex, and cached web search may be used when it helps answer the question. The page crop is unavailable, so Ask PDF will use text-only context.';
    const accept = primaryButton('Accept and continue');
    accept.addEventListener('click', () => {
      accept.disabled = true;
      this.pendingPanelFocus = true;
      this.post({ type: 'pdfDiscussionConsent', accepted: true });
    });
    notice.append(title, body, accept);
    return notice;
  }

  private composer(annotation: PdfDiscussionAnnotationSnapshot | undefined, status: PdfDiscussionTurnStatus): HTMLElement {
    const composer = document.createElement('section');
    composer.className = 'ask-pdf-composer';
    composer.setAttribute('aria-label', 'Ask PDF composer');
    const textarea = document.createElement('textarea');
    textarea.rows = 3;
    textarea.placeholder = 'Ask about this selection';
    textarea.ariaLabel = 'Ask about this selection';
    textarea.value = this.draft;
    const pendingSubmit = this.pendingSubmitFor(annotation);
    textarea.disabled = !this.consentGranted || status === 'running' || Boolean(pendingSubmit);
    const selectionPrepared = Boolean(annotation || this.currentSelectionKey);
    let sendButton: HTMLButtonElement | undefined;
    textarea.addEventListener('input', () => {
      this.draft = textarea.value;
      this.saveActiveDraft();
      if (sendButton) {
        sendButton.disabled = !this.consentGranted
          || !selectionPrepared
          || Boolean(pendingSubmit)
          || !this.draft.trim();
      }
    });
    textarea.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      this.submit(annotation);
    });
    composer.appendChild(textarea);
    const footer = document.createElement('div');
    footer.className = 'ask-pdf-composer-footer';
    const hint = document.createElement('span');
    hint.textContent = '⌘/Ctrl + Enter';
    footer.appendChild(hint);
    if (status === 'running') {
      const stop = dangerButton('Stop');
      stop.addEventListener('click', () => {
        const annotationId = annotation?.id ?? this.activeAnnotationId;
        if (annotationId) this.post({ type: 'pdfDiscussionCancel', annotationId });
      });
      footer.appendChild(stop);
    } else {
      const send = primaryButton('Ask Codex');
      sendButton = send;
      send.disabled = !this.consentGranted
        || !selectionPrepared
        || Boolean(pendingSubmit)
        || !this.draft.trim();
      send.addEventListener('click', () => this.submit(annotation));
      footer.appendChild(send);
    }
    composer.appendChild(footer);
    return composer;
  }

  private codexActions(annotation: PdfDiscussionAnnotationSnapshot): HTMLElement {
    const actions = document.createElement('section');
    actions.className = 'ask-pdf-actions';
    if (!annotation.promotion) {
      const promote = primaryButton('Continue in Codex');
      promote.addEventListener('click', () => this.post({ type: 'pdfDiscussionPromote', annotationId: annotation.id }));
      actions.appendChild(promote);
      return actions;
    }
    const open = primaryButton('Open Codex task');
    open.addEventListener('click', () => this.post({ type: 'pdfDiscussionOpenPromotedTask', annotationId: annotation.id }));
    actions.appendChild(open);
    if (this.promotionError?.annotationId === annotation.id) {
      const error = this.errorElement(this.promotionError.error);
      const retry = secondaryButton('Retry opening');
      retry.addEventListener('click', () => this.post({ type: 'pdfDiscussionOpenPromotedTask', annotationId: annotation.id }));
      const copy = secondaryButton('Copy task ID');
      copy.addEventListener('click', () => void copyText(this.promotionError?.threadId ?? annotation.promotion!.threadId));
      actions.append(error, retry, copy);
    }
    return actions;
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
    this.errorMessage = undefined;
    this.transientActionError = undefined;
    const draft = this.draft;
    const requestId = this.post({
      type: 'pdfDiscussionSubmit',
      ...(annotation ? { annotationId: annotation.id } : {}),
      ...(!annotation && this.currentSelection ? { selection: this.currentSelection } : {}),
      question,
      ...(base64 ? { snapshotPngBase64: base64 } : {}),
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

  private errorElement(message: string): HTMLElement {
    const error = document.createElement('p');
    error.className = 'ask-pdf-error';
    error.setAttribute('role', 'alert');
    error.textContent = message;
    return error;
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
      delete this.windows[migrateFrom];
      delete this.drafts[migrateFrom];
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
        left: ASK_PDF_VIEWPORT_INSET,
        top: ASK_PDF_VIEWPORT_INSET,
        width: Math.round(availableWidth),
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
    const candidate = candidates.find(fits)
      ?? candidates.map(clampCandidate).find(value => !overlapsAnchor(value))
      ?? clampCandidate(candidates[0]!);
    return {
      state: this.boundGeometry({ ...state, left: candidate.left, top: candidate.top, detached: false }),
      attachment: candidate.attachment,
    };
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
      const fixedWidth = Math.round(availableWidth);
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
    if (this.panel.hidden) return;
    const target = this.content.querySelector<HTMLElement>('textarea:not(:disabled)')
      ?? this.content.querySelector<HTMLElement>('.ask-pdf-consent button:not(:disabled)')
      ?? this.content.querySelector<HTMLElement>('.ask-pdf-overview-item')
      ?? this.closeButton;
    target.focus({ preventScroll: true });
  }

  private post(message: Record<string, unknown>): string {
    const requestId = `ask-pdf-${++this.requestSequence}`;
    this.requestContexts.set(requestId, {
      revision: this.viewRevision,
      type: String(message.type ?? ''),
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

function installAskPdfStyles(): void {
  if (document.getElementById('ask-pdf-styles')) return;
  const style = document.createElement('style');
  style.id = 'ask-pdf-styles';
  style.textContent = `
    #viewer-shell { position: relative; }
    #toolbar .ask-pdf-count { min-width: 42px; font-variant-numeric: tabular-nums; }
    .ask-pdf-panel { box-sizing: border-box; position: absolute; z-index: 55; display: flex; flex-direction: column; border: 1px solid var(--vscode-panel-border); border-left: 2px solid color-mix(in srgb, ${ASK_PDF_ACCENT} 82%, var(--vscode-panel-border)); border-radius: 3px; background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background, var(--vscode-editor-background))); box-shadow: 0 8px 24px rgba(0,0,0,.34), 0 1px 4px rgba(0,0,0,.28); color: var(--vscode-editor-foreground); font: 12px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif); }
    .ask-pdf-panel[hidden] { display: none; }
    .ask-pdf-panel.attached::before { content: ''; position: absolute; z-index: -1; display: block; background: ${ASK_PDF_ACCENT}; pointer-events: none; }
    .ask-pdf-panel.attached[data-attachment="left"]::before { top: 31px; left: -17px; width: 16px; height: 1px; }
    .ask-pdf-panel.attached[data-attachment="right"]::before { top: 31px; right: -17px; width: 16px; height: 1px; }
    .ask-pdf-panel.attached[data-attachment="top"]::before { top: -17px; left: 31px; width: 1px; height: 16px; }
    .ask-pdf-panel.attached[data-attachment="bottom"]::before { bottom: -17px; left: 31px; width: 1px; height: 16px; }
    .ask-pdf-live-region { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .ask-pdf-resize-handle { position: absolute; z-index: 3; touch-action: none; }
    .ask-pdf-resize-n { top: -4px; right: 8px; left: 8px; height: 8px; cursor: ns-resize; }
    .ask-pdf-resize-ne { top: -4px; right: -4px; width: 12px; height: 12px; cursor: nesw-resize; }
    .ask-pdf-resize-e { top: 8px; right: -4px; bottom: 8px; width: 8px; cursor: ew-resize; }
    .ask-pdf-resize-se { right: -5px; bottom: -5px; width: 14px; height: 14px; cursor: nwse-resize; }
    .ask-pdf-resize-s { right: 8px; bottom: -4px; left: 8px; height: 8px; cursor: ns-resize; }
    .ask-pdf-resize-sw { bottom: -4px; left: -4px; width: 12px; height: 12px; cursor: nesw-resize; }
    .ask-pdf-resize-w { top: 8px; bottom: 8px; left: -4px; width: 8px; cursor: ew-resize; }
    .ask-pdf-resize-nw { top: -4px; left: -4px; width: 12px; height: 12px; cursor: nwse-resize; }
    .ask-pdf-resizer:focus-visible, .ask-pdf-panel button:focus-visible, .ask-pdf-panel a:focus-visible, .ask-pdf-panel textarea:focus-visible, .pdf-discussion-marker:focus-visible { outline: 2px solid var(--vscode-focusBorder, ${ASK_PDF_ACCENT}); outline-offset: 1px; }
    .ask-pdf-header { box-sizing: border-box; display: flex; min-height: 56px; flex: 0 0 auto; align-items: center; justify-content: space-between; padding: 8px 8px 8px 13px; border-bottom: 1px solid var(--vscode-panel-border); cursor: grab; user-select: none; touch-action: none; }
    .ask-pdf-header:active { cursor: grabbing; }
    .ask-pdf-header h2 { margin: 1px 0 0; font-size: 15px; font-weight: 650; letter-spacing: -.01em; }
    .ask-pdf-header-actions { display: inline-flex; align-items: center; gap: 1px; }
    .ask-pdf-eyebrow, .ask-pdf-role, .ask-pdf-source-heading, .ask-pdf-section-heading, .ask-pdf-overview-page { font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 9px; font-weight: 650; letter-spacing: .11em; color: var(--vscode-descriptionForeground); }
    .ask-pdf-header button, .ask-pdf-panel button { border: 1px solid transparent; border-radius: 3px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
    .ask-pdf-header button { width: 28px; height: 28px; font-size: 18px; }
    .ask-pdf-header button:hover, .ask-pdf-panel button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)); }
    .ask-pdf-content { min-height: 0; flex: 1 1 auto; overflow: auto; padding: 0 14px 18px; }
    .ask-pdf-source { margin: 0 -14px; padding: 11px 14px 12px; border-bottom: 1px solid var(--vscode-panel-border); background: color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); }
    .ask-pdf-source-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .ask-pdf-source-actions { display: inline-flex; align-items: center; gap: 8px; }
    .ask-pdf-source-heading a, .ask-pdf-source-heading button { color: ${ASK_PDF_ACCENT}; font-family: var(--vscode-font-family, sans-serif); font-size: 11px; letter-spacing: 0; text-decoration: none; }
    .ask-pdf-source-heading button { padding: 0; }
    .ask-pdf-source-heading a:hover { text-decoration: underline; }
    .ask-pdf-link-copied { display: block; margin: -3px 0 7px; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .ask-pdf-crop { box-sizing: border-box; display: block; width: 100%; max-height: 190px; margin: 0 0 9px; border: 1px solid color-mix(in srgb, ${ASK_PDF_ACCENT} 55%, var(--vscode-panel-border)); object-fit: contain; background: #fff; }
    .ask-pdf-context summary { cursor: pointer; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .ask-pdf-context blockquote { margin: 8px 0 0; padding: 0 0 0 10px; border-left: 2px solid ${ASK_PDF_ACCENT}; line-height: 1.5; }
    .ask-pdf-nearby-context { margin-top: 10px; color: var(--vscode-descriptionForeground); }
    .ask-pdf-nearby-context h3 { margin: 0 0 5px; font-size: 10px; font-weight: 600; }
    .ask-pdf-nearby-context dl { display: grid; gap: 4px; margin: 0; }
    .ask-pdf-nearby-row { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 6px; }
    .ask-pdf-nearby-context dt { font-size: 9px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; }
    .ask-pdf-nearby-context dd { margin: 0; line-height: 1.4; }
    .ask-pdf-transcript { position: relative; display: flex; flex-direction: column; gap: 13px; padding: 16px 0 12px; }
    .ask-pdf-message { position: relative; display: grid; grid-template-columns: 8px 43px minmax(0, 1fr); align-items: start; }
    .ask-pdf-message-rail { width: 1px; height: 100%; min-height: 25px; margin-left: 3px; background: color-mix(in srgb, ${ASK_PDF_ACCENT} 62%, var(--vscode-panel-border)); }
    .ask-pdf-message.user .ask-pdf-message-rail { background: var(--vscode-panel-border); }
    .ask-pdf-role { padding-top: 2px; }
    .ask-pdf-markdown { min-width: 0; font-size: 12.5px; line-height: 1.55; overflow-wrap: anywhere; }
    .ask-pdf-markdown > :first-child { margin-top: 0; }
    .ask-pdf-markdown > :last-child { margin-bottom: 0; }
    .ask-pdf-markdown p { margin: 0 0 8px; }
    .ask-pdf-markdown pre { overflow: auto; padding: 8px; background: var(--vscode-textCodeBlock-background); }
    .ask-pdf-markdown code { font-family: var(--vscode-editor-font-family, monospace); }
    .ask-pdf-markdown a { color: ${ASK_PDF_ACCENT}; }
    .ask-pdf-message.streaming .ask-pdf-message-rail { animation: ask-pdf-stream 1.4s ease-in-out infinite; }
    .ask-pdf-transcript-empty, .ask-pdf-status-note { margin: 0; color: var(--vscode-descriptionForeground); line-height: 1.45; }
    .ask-pdf-consent { margin: 6px 0 12px; padding: 11px; border: 1px solid var(--vscode-panel-border); border-left: 2px solid ${ASK_PDF_ACCENT}; }
    .ask-pdf-consent p { margin: 5px 0 10px; color: var(--vscode-descriptionForeground); line-height: 1.45; }
    .ask-pdf-error { margin: 6px 0 10px; color: var(--vscode-errorForeground); line-height: 1.45; }
    .ask-pdf-composer { margin-top: 8px; border-top: 1px solid var(--vscode-panel-border); padding-top: 12px; }
    .ask-pdf-composer textarea { box-sizing: border-box; display: block; width: 100%; min-height: 72px; resize: vertical; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; outline: 0; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font: inherit; line-height: 1.45; }
    .ask-pdf-composer textarea::placeholder { color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground)); }
    .ask-pdf-composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 7px; }
    .ask-pdf-composer-footer > span { color: var(--vscode-descriptionForeground); font-size: 10px; }
    .ask-pdf-panel .ask-pdf-primary, .ask-pdf-panel .ask-pdf-danger, .ask-pdf-panel .ask-pdf-secondary { min-height: 27px; padding: 3px 10px; }
    .ask-pdf-panel .ask-pdf-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .ask-pdf-panel .ask-pdf-primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
    .ask-pdf-panel .ask-pdf-secondary { border-color: var(--vscode-button-border, var(--vscode-panel-border)); }
    .ask-pdf-panel .ask-pdf-danger { border-color: color-mix(in srgb, var(--vscode-errorForeground) 55%, transparent); color: var(--vscode-errorForeground); }
    .ask-pdf-panel button:disabled { cursor: default; opacity: .5; }
    .ask-pdf-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; padding-top: 11px; border-top: 1px solid var(--vscode-panel-border); }
    .ask-pdf-actions .ask-pdf-error { flex: 0 0 100%; margin: 0; }
    .ask-pdf-overview { padding-top: 13px; }
    .ask-pdf-section-heading { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .ask-pdf-section-heading strong { color: var(--vscode-descriptionForeground); font: inherit; letter-spacing: 0; }
    .ask-pdf-overview-item { box-sizing: border-box; display: grid; width: 100%; grid-template-columns: 26px minmax(0, 1fr); gap: 8px; align-items: start; padding: 9px 5px; border-top: 1px solid var(--vscode-panel-border) !important; text-align: left; }
    .ask-pdf-overview-item > span:last-child { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
    .ask-pdf-overview-item strong { overflow: hidden; font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
    .ask-pdf-overview-number { box-sizing: border-box; display: inline-flex; width: 20px; height: 20px; align-items: center; justify-content: center; border: 1px solid ${ASK_PDF_ACCENT}; border-radius: 50%; color: ${ASK_PDF_ACCENT}; font: 600 10px var(--vscode-editor-font-family, monospace); }
    .ask-pdf-overview-item.answered .ask-pdf-overview-number, .ask-pdf-overview-item.promoted .ask-pdf-overview-number { background: ${ASK_PDF_ACCENT}; color: #10212e; }
    .ask-pdf-overview-item.failed .ask-pdf-overview-number { border-color: var(--vscode-errorForeground); color: var(--vscode-errorForeground); }
    .ask-pdf-empty { display: grid; place-items: center; min-height: 220px; padding: 24px; color: var(--vscode-descriptionForeground); text-align: center; line-height: 1.55; }
    .ask-pdf-index { color: ${ASK_PDF_ACCENT}; font-size: 20px; }
    .highlight-layer .pdf-discussion-outline { position: absolute; z-index: 22; box-sizing: border-box; border: 1.5px solid ${ASK_PDF_ACCENT}; border-radius: 1px; padding: 0; background: transparent; pointer-events: none; }
    .highlight-layer .pdf-discussion-outline:hover, .highlight-layer .pdf-discussion-outline.active { background: color-mix(in srgb, ${ASK_PDF_ACCENT} 9%, transparent); }
    .highlight-layer .pdf-discussion-outline.failed { border-color: var(--vscode-errorForeground, #f48771); }
    .highlight-layer .pdf-discussion-marker { position: absolute; z-index: 24; display: flex; width: 18px; height: 18px; min-width: 18px; align-items: center; justify-content: center; border: 1px solid ${ASK_PDF_ACCENT}; border-radius: 50%; padding: 0; background: var(--vscode-editor-background, #1e1e1e); color: ${ASK_PDF_ACCENT}; font: 650 9px var(--vscode-editor-font-family, monospace); pointer-events: auto; cursor: pointer; }
    .highlight-layer .pdf-discussion-marker.answered, .highlight-layer .pdf-discussion-marker.active, .highlight-layer .pdf-discussion-marker.promoted { background: ${ASK_PDF_ACCENT}; color: #10212e; }
    .highlight-layer .pdf-discussion-marker.running { animation: ask-pdf-marker 1.6s ease-in-out infinite; }
    .highlight-layer .pdf-discussion-marker.failed { border-color: var(--vscode-errorForeground, #f48771); color: var(--vscode-errorForeground, #f48771); }
    @keyframes ask-pdf-stream { 0%,100% { opacity: .42; } 50% { opacity: 1; } }
    @keyframes ask-pdf-marker { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, ${ASK_PDF_ACCENT} 30%, transparent); } 50% { box-shadow: 0 0 0 4px transparent; } }
    @media (max-width: 619px) { .ask-pdf-header { cursor: default; } .ask-pdf-resize-handle { cursor: default; } }
    @media (prefers-reduced-motion: reduce) { .ask-pdf-message.streaming .ask-pdf-message-rail, .highlight-layer .pdf-discussion-marker.running { animation: none; } }
  `;
  document.head.appendChild(style);
}

function selectionFromAnnotation(annotation: PdfDiscussionAnnotationSnapshot): PdfAskSelection {
  return {
    page: annotation.anchor.page,
    snippet: annotation.anchor.quote,
    quote: annotation.anchor.quote,
    prefix: annotation.anchor.prefix,
    suffix: annotation.anchor.suffix,
    rects: annotation.anchor.rects,
    textItemIndex: annotation.anchor.textItemIndex,
    charOffset: annotation.anchor.charOffset,
    endTextItemIndex: annotation.anchor.endTextItemIndex,
    endCharOffset: annotation.anchor.endCharOffset,
  };
}

function sortAnnotations(annotations: PdfDiscussionAnnotationSnapshot[]): PdfDiscussionAnnotationSnapshot[] {
  return [...annotations].sort((left, right) => (
    left.anchor.page - right.anchor.page
    || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    || left.id.localeCompare(right.id)
  ));
}

function annotationVisualStatus(annotation: PdfDiscussionAnnotationSnapshot, turnStatus: PdfDiscussionTurnStatus): string {
  if (annotation.promotion) return 'promoted';
  if (turnStatus === 'running' || turnStatus === 'failed' || turnStatus === 'cancelled') return turnStatus;
  return annotationHasAnswer(annotation) ? 'answered' : 'draft';
}

function annotationHasAnswer(annotation: PdfDiscussionAnnotationSnapshot): boolean {
  return annotation.messages.some(message => message.role === 'assistant');
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

function iconButton(label: string, text: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.ariaLabel = label;
  button.title = label;
  button.textContent = text;
  return button;
}

function primaryButton(label: string): HTMLButtonElement {
  return actionButton(label, 'ask-pdf-primary');
}

function secondaryButton(label: string): HTMLButtonElement {
  return actionButton(label, 'ask-pdf-secondary');
}

function dangerButton(label: string): HTMLButtonElement {
  return actionButton(label, 'ask-pdf-danger');
}

function actionButton(label: string, className: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

function validRects(value: unknown): PdfRect[] {
  if (!Array.isArray(value)) return [];
  return value.filter((rect): rect is PdfRect => (
    Array.isArray(rect)
    && rect.length === 4
    && rect.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))
    && rect[2]! > rect[0]!
    && rect[3]! > rect[1]!
  ));
}

function positionRect(element: HTMLElement, rect: PdfRect, scale: number): void {
  element.style.left = `${rect[0] * scale}px`;
  element.style.top = `${rect[1] * scale}px`;
  element.style.width = `${Math.max(1, (rect[2] - rect[0]) * scale)}px`;
  element.style.height = `${Math.max(1, (rect[3] - rect[1]) * scale)}px`;
}

function normalizeTurnStatus(value: unknown): PdfDiscussionTurnStatus {
  return value === 'running' || value === 'failed' || value === 'cancelled' ? value : 'idle';
}

function isTransientActionError(requestType: string, message: string): boolean {
  if (requestType !== 'pdfDiscussionSubmit'
    && requestType !== 'pdfDiscussionRetry'
    && requestType !== 'pdfDiscussionCancel') return false;
  return /\bactive turn\b|\bno (?:active|running) turn\b|\bturn (?:is )?not (?:currently )?running\b/i.test(message);
}

function stateRecord(value: unknown): AskPdfWebviewState {
  return value && typeof value === 'object' ? value as AskPdfWebviewState : {};
}

function normalizeAskPdfWindows(value: unknown): Record<string, AskPdfWindowState> {
  if (!value || typeof value !== 'object') return {};
  const windows: Record<string, AskPdfWindowState> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Partial<AskPdfWindowState>;
    if (![record.left, record.top, record.width, record.height].every(number => (
      typeof number === 'number' && Number.isFinite(number)
    ))) continue;
    windows[key] = {
      left: record.left!,
      top: record.top!,
      width: record.width!,
      height: record.height!,
      detached: record.detached === true,
      minimized: record.minimized === true,
    };
  }
  return windows;
}

function normalizeAskPdfDrafts(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function isTransientWindowKey(key: string | undefined): boolean {
  return Boolean(key?.startsWith('draft:') || key?.startsWith('selection:'));
}

function clampPanelWidth(value: unknown): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : ASK_PDF_DEFAULT_WIDTH;
  return Math.round(clamp(number, ASK_PDF_MIN_WIDTH, ASK_PDF_MAX_WIDTH));
}

function base64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
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
