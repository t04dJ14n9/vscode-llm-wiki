import type { PdfRect } from './pdfTextBands';

export interface PdfQueryAnnotation {
  annotationId: string;
  queryPath: string;
  title: string;
  status: 'draft' | 'stable' | 'deprecated';
  condensedSummary: string;
  project?: string;
  updatedTime: string;
  navigationTarget: Record<string, unknown>;
  page: number;
  rects: PdfRect[];
}

export interface PdfQueryPageSurface {
  rendered: boolean;
  interactionScale: number;
  highlightLayer: HTMLDivElement;
}

interface PdfQueryGroup {
  key: string;
  page: number;
  rects: PdfRect[];
  queries: PdfQueryAnnotation[];
}

export class PdfQueryAnnotationLayer {
  private annotations: PdfQueryAnnotation[] = [];
  private popover: HTMLDivElement | undefined;
  private activeGroup: PdfQueryGroup | undefined;
  private pinnedGroupKey: string | undefined;

  constructor(
    private readonly pages: ReadonlyMap<number, PdfQueryPageSurface>,
    private readonly postMessage: (message: unknown) => void,
  ) {}

  get active(): boolean {
    return this.activeGroup !== undefined;
  }

  set(value: unknown): void {
    this.annotations = normalizePdfQueryAnnotations(value);
    this.dismiss();
    for (const page of this.pages.keys()) this.drawPage(page);
  }

  dismiss(): void {
    this.pinnedGroupKey = undefined;
    this.activeGroup = undefined;
    if (this.popover) this.popover.hidden = true;
  }

  handleDocumentPointerDown(target: EventTarget | null): void {
    if (!this.pinnedGroupKey || !(target instanceof Node)) return;
    if (
      this.popover?.contains(target)
      || (target instanceof Element && target.closest('.pdf-query-marker'))
    ) return;
    this.dismiss();
  }

  drawPage(page: number): void {
    const state = this.pages.get(page);
    if (!state || !state.rendered) return;
    state.highlightLayer
      .querySelectorAll('.pdf-query-highlight, .pdf-query-marker')
      .forEach(element => element.remove());
    const scale = state.interactionScale;
    for (const group of this.groupsForPage(page)) {
      for (const rect of group.rects) {
        const highlight = document.createElement('div');
        highlight.className = 'pdf-query-highlight';
        highlight.style.left = cssPx(rect[0] * scale);
        highlight.style.top = cssPx(rect[1] * scale);
        highlight.style.width = cssPx((rect[2] - rect[0]) * scale);
        highlight.style.height = cssPx((rect[3] - rect[1]) * scale);
        state.highlightLayer.appendChild(highlight);
      }
      const first = group.rects[0];
      if (!first) continue;
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'pdf-query-marker';
      marker.dataset.queryGroup = group.key;
      marker.textContent = group.queries.length === 1
        ? '✦ Query'
        : `✦ ${group.queries.length} Queries`;
      marker.setAttribute(
        'aria-label',
        `${group.queries.length} linked ${group.queries.length === 1 ? 'Query' : 'Queries'}`,
      );
      marker.style.left = cssPx(first[2] * scale + 4);
      marker.style.top = cssPx(first[1] * scale);
      marker.addEventListener('pointerenter', () => this.show(group, marker));
      marker.addEventListener('focus', () => this.show(group, marker));
      marker.addEventListener('pointerleave', event => {
        if (this.pinnedGroupKey === group.key) return;
        if (event.relatedTarget instanceof Node && this.popover?.contains(event.relatedTarget)) return;
        this.hide();
      });
      marker.addEventListener('blur', event => {
        if (this.pinnedGroupKey === group.key) return;
        if (event.relatedTarget instanceof Node && this.popover?.contains(event.relatedTarget)) return;
        this.hide();
      });
      marker.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this.pinnedGroupKey = this.pinnedGroupKey === group.key ? undefined : group.key;
        if (this.pinnedGroupKey) this.show(group, marker);
        else this.hide();
      });
      state.highlightLayer.appendChild(marker);
    }
  }

  private groupsForPage(page: number): PdfQueryGroup[] {
    const groups = new Map<string, PdfQueryGroup>();
    for (const annotation of this.annotations) {
      if (annotation.page !== page) continue;
      const key = `${page}:${JSON.stringify(annotation.rects)}`;
      const current = groups.get(key);
      if (current) current.queries.push(annotation);
      else groups.set(key, { key, page, rects: annotation.rects, queries: [annotation] });
    }
    return [...groups.values()];
  }

  private show(group: PdfQueryGroup, marker: HTMLElement): void {
    const popover = this.popover ?? document.createElement('div');
    this.popover = popover;
    popover.className = 'pdf-query-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Linked Queries');
    popover.replaceChildren(...group.queries.map(query => this.item(query)));
    if (!popover.isConnected) document.body.append(popover);
    const bounds = marker.getBoundingClientRect();
    popover.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - 388))}px`;
    popover.style.top = `${Math.max(8, Math.min(bounds.bottom + 8, window.innerHeight - 288))}px`;
    popover.hidden = false;
    this.activeGroup = group;
  }

  private item(query: PdfQueryAnnotation): HTMLElement {
    const item = document.createElement('section');
    item.className = 'pdf-query-popover-item';
    const title = document.createElement('strong');
    title.textContent = query.title;
    const meta = document.createElement('div');
    meta.className = 'pdf-query-popover-meta';
    meta.textContent = [query.status, query.project, query.updatedTime.slice(0, 10)]
      .filter(Boolean)
      .join(' · ');
    const summary = document.createElement('div');
    summary.className = 'pdf-query-popover-summary';
    summary.textContent = query.condensedSummary;
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open Query';
    open.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.postMessage({ type: 'openQuery', navigation: query.navigationTarget });
    });
    item.append(title, meta, summary, open);
    return item;
  }

  private hide(): void {
    this.activeGroup = undefined;
    if (this.popover) this.popover.hidden = true;
  }
}

export function normalizePdfQueryAnnotations(value: unknown): PdfQueryAnnotation[] {
  if (!Array.isArray(value)) return [];
  const statusOrder = { stable: 0, draft: 1, deprecated: 2 } as const;
  return value.slice(0, 1_000).flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const raw = candidate as Record<string, unknown>;
    const rects = validRects(raw.rects);
    const page = Number(raw.page);
    const navigation = raw.navigationTarget;
    const status: PdfQueryAnnotation['status'] | undefined =
      raw.status === 'draft' || raw.status === 'stable' || raw.status === 'deprecated'
        ? raw.status
        : undefined;
    if (
      typeof raw.annotationId !== 'string'
      || typeof raw.queryPath !== 'string'
      || typeof raw.title !== 'string'
      || !status
      || typeof raw.condensedSummary !== 'string'
      || typeof raw.updatedTime !== 'string'
      || !Number.isSafeInteger(page)
      || page < 1
      || rects.length === 0
      || !navigation
      || typeof navigation !== 'object'
      || Array.isArray(navigation)
      || (navigation as Record<string, unknown>).kind !== 'query'
      || typeof (navigation as Record<string, unknown>).queryPath !== 'string'
      || raw.title.length > 512
      || raw.condensedSummary.length > 2_000
    ) return [];
    const annotation: PdfQueryAnnotation = {
      annotationId: raw.annotationId,
      queryPath: raw.queryPath,
      title: raw.title,
      status,
      condensedSummary: raw.condensedSummary,
      ...(typeof raw.project === 'string' ? { project: raw.project } : {}),
      updatedTime: raw.updatedTime,
      navigationTarget: navigation as Record<string, unknown>,
      page,
      rects,
    };
    return [annotation];
  }).sort((left, right) => (
    statusOrder[left.status] - statusOrder[right.status]
    || right.updatedTime.localeCompare(left.updatedTime)
    || left.queryPath.localeCompare(right.queryPath)
  ));
}

function validRects(value: unknown): PdfRect[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1_000) return [];
  const rects: PdfRect[] = [];
  for (const candidate of value) {
    if (!Array.isArray(candidate) || candidate.length !== 4) return [];
    const rect = candidate as unknown[];
    if (!rect.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))) return [];
    const typed = rect as PdfRect;
    if (typed[0] < 0 || typed[1] < 0 || typed[2] <= typed[0] || typed[3] <= typed[1]) return [];
    rects.push([...typed] as PdfRect);
  }
  return rects;
}

function cssPx(value: number): string {
  return `${Math.round(value * 1000) / 1000}px`;
}
