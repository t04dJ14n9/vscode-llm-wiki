import {
  buildPdfSearchIndex,
  isAsciiSearchQuery,
  isWholeWordSearchMatch,
  normalizeSearchText,
  segmentsForSearchRange,
  type PdfSearchSegment,
} from './domain/pdfSearch';

export interface PdfSearchPage {
  pageNum: number;
  textRects: PdfSearchTextItem[];
  highlightLayer: HTMLDivElement;
  rendered: boolean;
}

export interface PdfSearchHost {
  pages(): PdfSearchPage[];
  currentPage(): number;
  scale(): number;
  loadTextRects(page: PdfSearchPage): Promise<PdfSearchTextItem[]>;
  revealPage(page: number): Promise<void>;
}

interface PdfSearchMatch {
  page: number;
  segments: PdfSearchSegment[];
}

interface PdfSearchTextItem {
  content?: string;
  rect?: {
    origin?: { x?: number; y?: number };
    size?: { width?: number; height?: number };
  };
}

export class PdfSearchController {
  private readonly panel = document.getElementById('pdf-search') as HTMLDivElement;
  private readonly input = document.getElementById('pdf-search-input') as HTMLInputElement;
  private readonly count = document.getElementById('pdf-search-count') as HTMLElement;
  private readonly settingsMenu = document.getElementById('pdf-search-settings-menu') as HTMLElement;
  private query = '';
  private matches: PdfSearchMatch[] = [];
  private selectedIndex = -1;
  private runId = 0;
  private inProgress = false;
  private matchCase = false;
  private highlightAll = false;
  private matchDiacritics = false;
  private wholeWords = false;

  constructor(private readonly host: PdfSearchHost) {
    this.setupEvents();
  }

  open(): void {
    this.panel.classList.remove('hidden');
    this.input.focus();
    this.input.select();
    if (this.input.value.trim()) void this.update(this.input.value);
  }

  drawPage(pageNumber: number): void {
    const page = this.host.pages().find(candidate => candidate.pageNum === pageNumber);
    if (!page?.textRects.length) return;
    page.highlightLayer.querySelectorAll('.pdf-search-match').forEach(element => element.remove());

    this.matches.forEach((match, searchIndex) => {
      if (match.page !== pageNumber) return;
      if (!this.highlightAll && searchIndex !== this.selectedIndex) return;
      for (const segment of match.segments) {
        const item = page.textRects[segment.textItemIndex];
        const content = item?.content;
        if (!content) continue;
        const contentLength = content.length;
        const itemStart = Math.max(0, Math.min(segment.from, contentLength));
        const itemEnd = Math.max(itemStart, Math.min(segment.to, contentLength));
        if (itemEnd <= itemStart) continue;

        const scale = this.host.scale();
        const fullLeft = Number(item.rect?.origin?.x) * scale;
        const fullTop = Number(item.rect?.origin?.y) * scale;
        const fullWidth = Number(item.rect?.size?.width) * scale;
        const fullHeight = Number(item.rect?.size?.height) * scale;
        if (![fullLeft, fullTop, fullWidth, fullHeight].every(Number.isFinite)) continue;
        const perChar = fullWidth / contentLength;
        const element = document.createElement('div');
        element.className = `pdf-search-match${searchIndex === this.selectedIndex ? ' selected' : ''}`;
        element.dataset.searchIndex = String(searchIndex);
        element.style.left = `${fullLeft + perChar * itemStart}px`;
        element.style.top = `${fullTop}px`;
        element.style.width = `${Math.max(4, perChar * (itemEnd - itemStart))}px`;
        element.style.height = `${fullHeight}px`;
        page.highlightLayer.appendChild(element);
      }
    });
  }

  redraw(): void {
    for (const page of this.host.pages()) {
      if (page.rendered) this.drawPage(page.pageNum);
    }
  }

  private setupEvents(): void {
    this.input.addEventListener('input', () => void this.update(this.input.value));
    this.input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.step(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!this.settingsMenu.classList.contains('hidden')) {
          this.setSettingsOpen(false);
          document.getElementById('pdf-search-settings')?.focus();
        } else {
          this.close();
        }
      }
    });
    document.getElementById('pdf-search-prev')?.addEventListener('click', () => void this.step(-1));
    document.getElementById('pdf-search-next')?.addEventListener('click', () => void this.step(1));
    document.getElementById('pdf-search-close')?.addEventListener('click', () => this.close());

    const matchCaseButton = document.getElementById('pdf-search-case') as HTMLButtonElement | null;
    matchCaseButton?.addEventListener('click', () => {
      this.matchCase = !this.matchCase;
      matchCaseButton.setAttribute('aria-pressed', String(this.matchCase));
      void this.update(this.input.value);
    });
    const settingsButton = document.getElementById('pdf-search-settings') as HTMLButtonElement | null;
    settingsButton?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.setSettingsOpen(this.settingsMenu.classList.contains('hidden'));
    });
    this.settingsMenu.addEventListener('change', event => {
      const input = (event.target as HTMLElement).closest<HTMLInputElement>('input[data-search-setting]');
      if (!input) return;
      const enabled = input.checked;
      if (input.dataset.searchSetting === 'highlight-all') {
        this.highlightAll = enabled;
        this.redraw();
      } else if (input.dataset.searchSetting === 'match-diacritics') {
        this.matchDiacritics = enabled;
        void this.update(this.input.value);
      } else if (input.dataset.searchSetting === 'whole-words') {
        this.wholeWords = enabled;
        void this.update(this.input.value);
      }
    });
    document.addEventListener('pointerdown', event => {
      const target = event.target as Node;
      if (!this.settingsMenu.classList.contains('hidden')
        && !this.settingsMenu.contains(target)
        && !settingsButton?.contains(target)) {
        this.setSettingsOpen(false);
      }
    });
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        this.open();
      } else if (event.key === 'Escape' && !this.settingsMenu.classList.contains('hidden')) {
        event.preventDefault();
        this.setSettingsOpen(false);
        settingsButton?.focus();
      } else if (event.key === 'Escape' && !this.panel.classList.contains('hidden')) {
        event.preventDefault();
        this.close();
      }
    });
  }

  private setSettingsOpen(open: boolean): void {
    this.settingsMenu.classList.toggle('hidden', !open);
    document.getElementById('pdf-search-settings')?.setAttribute('aria-expanded', String(open));
  }

  private close(): void {
    this.setSettingsOpen(false);
    this.panel.classList.add('hidden');
    this.matches = [];
    this.selectedIndex = -1;
    this.runId++;
    this.inProgress = false;
    this.updateCount();
    this.redraw();
  }

  private async update(rawQuery: string): Promise<void> {
    const runId = ++this.runId;
    const query = rawQuery.trim();
    this.query = query;
    this.matches = [];
    this.selectedIndex = -1;
    this.inProgress = Boolean(query);
    this.updateCount();
    this.redraw();
    if (!query) return;

    const pages = this.host.pages();
    const currentIndex = Math.max(0, pages.findIndex(page => page.pageNum === this.host.currentPage()));
    const orderedPages = [...pages.slice(currentIndex), ...pages.slice(0, currentIndex)];
    for (let index = 0; index < orderedPages.length; index++) {
      const page = orderedPages[index]!;
      await this.host.loadTextRects(page);
      if (runId !== this.runId) return;

      const pageMatches = this.collectMatches(query, page);
      if (pageMatches.length) {
        this.matches.push(...pageMatches);
        if (this.selectedIndex < 0) {
          this.selectedIndex = 0;
          await this.reveal(0);
          if (runId !== this.runId) return;
        } else {
          if (page.rendered) this.drawPage(page.pageNum);
          this.updateCount();
        }
      }

      if (index === 0 || (index + 1) % 8 === 0) {
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        if (runId !== this.runId) return;
      }
    }

    this.inProgress = false;
    this.redraw();
    this.updateCount();
  }

  private async step(direction: -1 | 1): Promise<void> {
    if (!this.matches.length && this.input.value.trim()) {
      if (!this.inProgress) await this.update(this.input.value);
      return;
    }
    if (!this.matches.length) return;
    const next = (this.selectedIndex + direction + this.matches.length) % this.matches.length;
    await this.reveal(next);
  }

  private collectMatches(query: string, page: PdfSearchPage): PdfSearchMatch[] {
    const needle = normalizeSearchText(query, this.matchCase, this.matchDiacritics);
    if (!needle) return [];
    const indexes = [
      buildPdfSearchIndex(page.textRects, true, false, this.matchCase, this.matchDiacritics),
      buildPdfSearchIndex(page.textRects, false, false, this.matchCase, this.matchDiacritics),
    ];
    if (isAsciiSearchQuery(needle)) {
      indexes.push(
        buildPdfSearchIndex(page.textRects, true, true, this.matchCase, this.matchDiacritics),
        buildPdfSearchIndex(page.textRects, false, true, this.matchCase, this.matchDiacritics),
      );
    }

    const matches: PdfSearchMatch[] = [];
    const seen = new Set<string>();
    for (const searchIndex of indexes) {
      const haystack = searchIndex.map(char => char.value).join('');
      let from = haystack.indexOf(needle);
      while (from >= 0) {
        const segments = segmentsForSearchRange(searchIndex, from, from + needle.length);
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
    return matches;
  }

  private async reveal(index: number): Promise<void> {
    const match = this.matches[index];
    if (!match) return;
    this.selectedIndex = index;
    await this.host.revealPage(match.page);
    this.redraw();
    this.updateCount();
    document.querySelector<HTMLElement>(`[data-search-index="${index}"]`)
      ?.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
  }

  private updateCount(): void {
    if (!this.query) {
      this.count.textContent = '';
    } else if (this.inProgress) {
      this.count.textContent = this.matches.length
        ? `${this.selectedIndex + 1} of ${this.matches.length} · Searching…`
        : 'Searching…';
    } else if (!this.matches.length) {
      this.count.textContent = 'No results';
    } else {
      this.count.textContent = `${this.selectedIndex + 1} of ${this.matches.length}`;
    }
  }
}
