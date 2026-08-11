// DOM view primitives for the annotation-owned Ask PDF window.
export type AskPdfTurnStatus = 'idle' | 'running' | 'failed' | 'cancelled';
export type AskPdfResponsiveMode = 'floating' | 'overlay' | 'full-width';

export interface AskPdfModelOption {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

export interface AskPdfSourceModel {
  key: string;
  page: number;
  quote: string;
  prefix?: string;
  suffix?: string;
  cropUrl?: string;
  linkNotice?: string;
}

export interface AskPdfMessageModel {
  id: string;
  role: 'user' | 'assistant';
  markdown: string;
  codexModel?: string;
  streaming?: boolean;
}

export interface AskPdfComposerModel {
  draft: string;
  ariaLabel: string;
  placeholder: string;
  disabled: boolean;
  sendDisabled: boolean;
  running: boolean;
  models: AskPdfModelOption[];
  selectedModel?: string;
  modelError?: string;
}

export interface AskPdfConsentModel {
  body: string;
}

export interface AskPdfActionModel {
  kind: 'retry' | 'open-note' | 'promote' | 'open-task' | 'retry-open' | 'copy-task-id';
  label: string;
  primary?: boolean;
}

export interface AskPdfOverviewItemModel {
  id: string;
  number: number;
  page: number;
  title: string;
  status: string;
}

export interface AskPdfNoticeModel {
  kind: 'error' | 'status';
  text: string;
}

export interface AskPdfViewModel {
  mode: 'empty' | 'discussion' | 'overview';
  responsiveMode: AskPdfResponsiveMode;
  resetPositionVisible: boolean;
  closeMode: 'minimize' | 'close';
  source?: AskPdfSourceModel;
  messages: AskPdfMessageModel[];
  streamingMarkdown?: string;
  running: boolean;
  transcriptEmptyText?: string;
  notices: AskPdfNoticeModel[];
  consent?: AskPdfConsentModel;
  composer?: AskPdfComposerModel;
  actions: AskPdfActionModel[];
  overviewItems: AskPdfOverviewItemModel[];
  emptyText?: string;
}

export type AskPdfViewEvent =
  | { type: 'changeDraft'; value: string }
  | { type: 'selectModel'; model: string | undefined }
  | { type: 'submit' }
  | { type: 'stop' }
  | { type: 'retry' }
  | { type: 'copyPortableLink' }
  | { type: 'navigateSource' }
  | { type: 'openTranscriptLink'; href: string }
  | { type: 'promote' }
  | { type: 'openLearningNote' }
  | { type: 'openPromotedTask' }
  | { type: 'retryOpening' }
  | { type: 'copyTaskId' }
  | { type: 'acceptConsent' }
  | { type: 'openAnnotation'; annotationId: string }
  | { type: 'minimize' }
  | { type: 'close' }
  | { type: 'resetPosition' };

export interface AskPdfPanelView {
  element: HTMLElement;
  header: HTMLElement;
  liveRegion: HTMLElement;
  resetPositionButton: HTMLButtonElement;
  update(model: AskPdfViewModel): void;
  focusPrimary(): void;
}

export function createAskPdfPanelView(
  onEvent: (event: AskPdfViewEvent) => void,
  renderMarkdown: (markdown: string) => string,
): AskPdfPanelView {
  const panel = document.createElement('aside');
  panel.id = 'ask-pdf-panel';
  panel.className = 'ask-pdf-panel';
  panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'ask-pdf-title');

  const header = document.createElement('header');
  header.className = 'ask-pdf-header';
  const titleGroup = document.createElement('div');
  titleGroup.className = 'ask-pdf-title-group';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'ask-pdf-eyebrow';
  eyebrow.textContent = 'ASK PDF';
  const title = document.createElement('h2');
  title.id = 'ask-pdf-title';
  title.textContent = 'Ask about selection';
  titleGroup.append(eyebrow, title);

  const headerActions = document.createElement('div');
  headerActions.className = 'ask-pdf-header-actions';
  const resetPositionButton = iconButton('Reset Ask PDF position', resetIcon());
  resetPositionButton.addEventListener('click', () => onEvent({ type: 'resetPosition' }));
  const closeButton = iconButton('Minimize Ask PDF', minimizeIcon());
  let closeMode: AskPdfViewModel['closeMode'] = 'minimize';
  closeButton.addEventListener('click', () => onEvent({ type: closeMode }));
  headerActions.append(resetPositionButton, closeButton);
  header.append(titleGroup, headerActions);

  const content = document.createElement('div');
  content.className = 'ask-pdf-content';
  const body = document.createElement('div');
  body.className = 'ask-pdf-body';

  const empty = document.createElement('section');
  empty.className = 'ask-pdf-empty';
  const emptyGlyph = document.createElement('span');
  emptyGlyph.className = 'ask-pdf-index';
  emptyGlyph.textContent = '✦';
  const emptyCopy = document.createElement('p');
  empty.append(emptyGlyph, emptyCopy);

  const overview = document.createElement('section');
  overview.className = 'ask-pdf-overview';
  overview.setAttribute('role', 'region');
  overview.setAttribute('aria-label', 'PDF discussion overview');
  const overviewHeading = document.createElement('div');
  overviewHeading.className = 'ask-pdf-section-heading';
  const overviewLabel = document.createElement('span');
  overviewLabel.textContent = 'DISCUSSIONS';
  const overviewOrder = document.createElement('strong');
  overviewOrder.textContent = 'Page order · recent first';
  overviewHeading.append(overviewLabel, overviewOrder);
  const overviewList = document.createElement('div');
  overviewList.className = 'ask-pdf-overview-list';
  overview.append(overviewHeading, overviewList);

  const discussion = document.createElement('div');
  discussion.className = 'ask-pdf-discussion';
  const source = document.createElement('section');
  source.className = 'ask-pdf-source';
  const sourceMeta = document.createElement('div');
  sourceMeta.className = 'ask-pdf-source-meta';
  const sourcePage = document.createElement('a');
  sourcePage.href = '#';
  sourcePage.className = 'ask-pdf-source-page';
  sourcePage.addEventListener('click', event => {
    event.preventDefault();
    onEvent({ type: 'navigateSource' });
  });
  const copyLink = document.createElement('button');
  copyLink.type = 'button';
  copyLink.className = 'ask-pdf-source-copy';
  copyLink.textContent = 'Copy link';
  copyLink.ariaLabel = 'Copy portable selection link';
  copyLink.addEventListener('click', () => onEvent({ type: 'copyPortableLink' }));
  sourceMeta.append(sourcePage, copyLink);
  const linkNotice = document.createElement('span');
  linkNotice.className = 'ask-pdf-link-copied';
  linkNotice.setAttribute('role', 'status');
  const sourceDetails = document.createElement('details');
  sourceDetails.className = 'ask-pdf-context';
  sourceDetails.dataset.askSource = '';
  const sourceSummary = document.createElement('summary');
  const sourceSummaryLabel = document.createElement('span');
  sourceSummaryLabel.textContent = 'Selected passage';
  const sourcePreview = document.createElement('span');
  sourcePreview.className = 'ask-pdf-source-preview';
  sourceSummary.append(sourceSummaryLabel, sourcePreview);
  const sourceBody = document.createElement('div');
  sourceBody.className = 'ask-pdf-source-body';
  sourceDetails.append(sourceSummary, sourceBody);
  source.append(sourceMeta, linkNotice, sourceDetails);

  const transcript = document.createElement('ol');
  transcript.className = 'ask-pdf-transcript';
  transcript.setAttribute('aria-label', 'Ask PDF transcript');
  const transcriptEmpty = document.createElement('p');
  transcriptEmpty.className = 'ask-pdf-transcript-empty';
  const noticeRegion = document.createElement('div');
  noticeRegion.className = 'ask-pdf-notices';
  const consent = document.createElement('section');
  consent.className = 'ask-pdf-consent';
  consent.setAttribute('aria-label', 'Ask PDF first-use notice');
  const consentTitle = document.createElement('strong');
  consentTitle.textContent = 'Before the first question';
  const consentBody = document.createElement('p');
  const consentButton = actionButton('Accept and continue', 'ask-pdf-primary');
  consentButton.addEventListener('click', () => onEvent({ type: 'acceptConsent' }));
  consent.append(consentTitle, consentBody, consentButton);
  const actionRegion = document.createElement('section');
  actionRegion.className = 'ask-pdf-actions';
  discussion.append(source, transcript, transcriptEmpty, noticeRegion, consent, actionRegion);
  body.append(empty, overview, discussion);

  const composerSection = document.createElement('section');
  composerSection.className = 'ask-pdf-composer';
  composerSection.setAttribute('aria-label', 'Ask PDF composer');
  const composer = document.createElement('textarea');
  composer.rows = 3;
  composer.addEventListener('input', () => onEvent({ type: 'changeDraft', value: composer.value }));
  composer.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    onEvent({ type: 'submit' });
  });
  const composerFooter = document.createElement('div');
  composerFooter.className = 'ask-pdf-composer-footer';
  const modelWrap = document.createElement('label');
  modelWrap.className = 'ask-pdf-model-control';
  const modelLabel = document.createElement('span');
  modelLabel.className = 'ask-pdf-sr-only';
  modelLabel.textContent = 'Codex model';
  const modelSelect = document.createElement('select');
  modelSelect.ariaLabel = 'Codex model';
  modelSelect.addEventListener('change', () => onEvent({
    type: 'selectModel',
    model: modelSelect.value || undefined,
  }));
  modelWrap.append(modelLabel, sparkleIcon(), modelSelect);
  const composerRight = document.createElement('div');
  composerRight.className = 'ask-pdf-composer-actions';
  const shortcut = document.createElement('span');
  shortcut.className = 'ask-pdf-shortcut';
  shortcut.textContent = '⌘↵';
  const sendButton = document.createElement('button');
  sendButton.type = 'button';
  sendButton.className = 'ask-pdf-send';
  let running = false;
  sendButton.addEventListener('click', () => onEvent({ type: running ? 'stop' : 'submit' }));
  composerRight.append(shortcut, sendButton);
  composerFooter.append(modelWrap, composerRight);
  composerSection.append(composer, composerFooter);
  content.append(body, composerSection);

  const liveRegion = document.createElement('p');
  liveRegion.className = 'ask-pdf-live-region';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'false');
  liveRegion.setAttribute('aria-label', 'Codex response updates');
  panel.append(header, content, liveRegion);

  let sourceKey: string | undefined;
  let modelSignature = '';
  const messageElements = new Map<string, HTMLElement>();

  function update(model: AskPdfViewModel): void {
    panel.dataset.responsiveMode = model.responsiveMode;
    closeMode = model.closeMode;
    resetPositionButton.hidden = !model.resetPositionVisible;
    const closeLabel = model.closeMode === 'close' ? 'Close Ask PDF' : 'Minimize Ask PDF';
    closeButton.ariaLabel = closeLabel;
    closeButton.title = closeLabel;
    closeButton.replaceChildren(model.closeMode === 'close' ? closeIcon() : minimizeIcon());

    empty.hidden = model.mode !== 'empty';
    overview.hidden = model.mode !== 'overview';
    discussion.hidden = model.mode !== 'discussion';
    composerSection.hidden = model.mode !== 'discussion' || !model.composer;
    if (model.mode === 'empty') emptyCopy.textContent = model.emptyText ?? 'Select a passage, then choose Ask about selection…';
    if (model.mode === 'overview') renderOverview(model.overviewItems);
    if (model.mode !== 'discussion' || !model.source || !model.composer) return;

    renderSource(model.source);
    renderTranscript(model.messages, model.streamingMarkdown, model.running);
    transcriptEmpty.hidden = !model.transcriptEmptyText;
    transcriptEmpty.textContent = model.transcriptEmptyText ?? '';
    renderNotices(model.notices);
    consent.hidden = !model.consent;
    consentBody.textContent = model.consent?.body ?? '';
    consentButton.disabled = false;
    renderActions(model.actions);
    updateComposer(model.composer);
  }

  function renderSource(model: AskPdfSourceModel): void {
    sourcePage.textContent = `Page ${model.page}`;
    linkNotice.hidden = !model.linkNotice;
    linkNotice.textContent = model.linkNotice ?? '';
    sourcePreview.textContent = model.quote;
    if (sourceKey === model.key && sourceBody.dataset.signature === sourceSignature(model)) return;
    if (sourceKey !== model.key) sourceDetails.open = false;
    sourceKey = model.key;
    sourceBody.dataset.signature = sourceSignature(model);
    const children: Node[] = [];
    if (model.cropUrl) {
      const image = document.createElement('img');
      image.className = 'ask-pdf-crop';
      image.alt = `Selected PDF passage on page ${model.page}`;
      image.src = model.cropUrl;
      children.push(image);
    }
    const quote = document.createElement('blockquote');
    quote.textContent = model.quote;
    children.push(quote);
    const nearby = nearbyContext(model);
    if (nearby) children.push(nearby);
    sourceBody.replaceChildren(...children);
  }

  function renderTranscript(messages: AskPdfMessageModel[], streamingMarkdown: string | undefined, isRunning: boolean): void {
    const entries = [
      ...messages,
      ...(streamingMarkdown
        ? [{ id: 'active-stream', role: 'assistant' as const, markdown: streamingMarkdown, streaming: true }]
        : []),
    ];
    const keys = new Set(entries.map(entry => entry.id));
    for (const [key, element] of messageElements) {
      if (keys.has(key)) continue;
      element.remove();
      messageElements.delete(key);
    }
    for (const entry of entries) {
      let element = messageElements.get(entry.id);
      if (!element) {
        element = document.createElement('li');
        element.className = `ask-pdf-message ${entry.role}`;
        messageElements.set(entry.id, element);
      }
      element.className = `ask-pdf-message ${entry.role}${entry.streaming ? ' streaming' : ''}`;
      if (entry.streaming) element.setAttribute('aria-label', 'Codex is responding');
      else element.removeAttribute('aria-label');
      const signature = `${entry.role}\u0000${entry.markdown}\u0000${entry.codexModel ?? ''}`;
      if (element.dataset.signature !== signature) {
        element.dataset.signature = signature;
        const body = document.createElement('div');
        body.className = 'ask-pdf-markdown';
        if (entry.role === 'assistant') {
          if (entry.codexModel) {
            const provenance = document.createElement('span');
            provenance.className = 'ask-pdf-model-provenance';
            provenance.textContent = entry.codexModel;
            element.replaceChildren(provenance, body);
          } else {
            element.replaceChildren(body);
          }
          body.innerHTML = renderMarkdown(entry.markdown);
          for (const link of Array.from(body.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
            const href = link.href;
            link.href = '#';
            link.removeAttribute('target');
            const openThroughHost = (event: Event) => {
              event.preventDefault();
              onEvent({ type: 'openTranscriptLink', href });
            };
            link.addEventListener('click', openThroughHost);
            link.addEventListener('auxclick', openThroughHost);
          }
        } else {
          body.textContent = entry.markdown;
          element.replaceChildren(body);
        }
      }
      transcript.appendChild(element);
    }
    if (isRunning && !streamingMarkdown) {
      let waiting = messageElements.get('active-waiting');
      if (!waiting) {
        waiting = document.createElement('li');
        waiting.className = 'ask-pdf-running-note';
        waiting.id = 'ask-pdf-running-note';
        waiting.setAttribute('aria-label', 'Codex is responding');
        waiting.innerHTML = '<span aria-hidden="true"></span>Thinking…';
        messageElements.set('active-waiting', waiting);
      }
      transcript.appendChild(waiting);
    } else {
      messageElements.get('active-waiting')?.remove();
      messageElements.delete('active-waiting');
    }
  }

  function renderNotices(notices: AskPdfNoticeModel[]): void {
    noticeRegion.replaceChildren(...notices.map(notice => {
      const element = document.createElement('p');
      element.className = notice.kind === 'error' ? 'ask-pdf-error' : 'ask-pdf-status-note';
      if (notice.kind === 'error') element.setAttribute('role', 'alert');
      element.textContent = notice.text;
      return element;
    }));
  }

  function renderActions(actions: AskPdfActionModel[]): void {
    actionRegion.hidden = actions.length === 0;
    actionRegion.replaceChildren(...actions.map(action => {
      const button = actionButton(action.label, action.primary ? 'ask-pdf-primary' : 'ask-pdf-secondary');
      button.addEventListener('click', () => {
        const typeByKind: Record<AskPdfActionModel['kind'], AskPdfViewEvent['type']> = {
          retry: 'retry',
          'open-note': 'openLearningNote',
          promote: 'promote',
          'open-task': 'openPromotedTask',
          'retry-open': 'retryOpening',
          'copy-task-id': 'copyTaskId',
        };
        onEvent({ type: typeByKind[action.kind] } as AskPdfViewEvent);
      });
      return button;
    }));
  }

  function updateComposer(model: AskPdfComposerModel): void {
    if (composer.value !== model.draft) composer.value = model.draft;
    composer.ariaLabel = model.ariaLabel;
    composer.placeholder = model.placeholder;
    composer.disabled = model.disabled;
    running = model.running;
    updateModels(model);
    sendButton.disabled = model.running ? false : model.sendDisabled;
    sendButton.classList.toggle('running', model.running);
    sendButton.ariaLabel = model.running ? 'Stop response' : 'Send question';
    sendButton.title = model.running ? 'Stop response' : 'Send question';
    sendButton.replaceChildren(model.running ? stopIcon() : sendIcon());
  }

  function updateModels(model: AskPdfComposerModel): void {
    const signature = model.models.map(option => `${option.model}:${option.displayName}:${option.isDefault}`).join('|');
    if (signature !== modelSignature) {
      modelSignature = signature;
      if (!model.models.length) {
        const fallback = document.createElement('option');
        fallback.value = '';
        fallback.textContent = 'Default model';
        modelSelect.replaceChildren(fallback);
      } else {
        modelSelect.replaceChildren(...model.models.map(option => {
          const element = document.createElement('option');
          element.value = option.model;
          element.textContent = option.displayName;
          return element;
        }));
      }
    }
    const fallbackModel = model.models.find(option => option.isDefault)?.model
      ?? model.models[0]?.model
      ?? '';
    modelSelect.value = model.selectedModel && model.models.some(option => option.model === model.selectedModel)
      ? model.selectedModel
      : fallbackModel;
    modelSelect.disabled = model.disabled;
    modelSelect.title = model.modelError
      ?? model.models.find(option => option.model === modelSelect.value)?.description
      ?? 'Use the current Codex default model';
    modelWrap.classList.toggle('unavailable', Boolean(model.modelError));
  }

  function renderOverview(items: AskPdfOverviewItemModel[]): void {
    if (!items.length) {
      const emptyOverview = document.createElement('p');
      emptyOverview.className = 'ask-pdf-transcript-empty';
      emptyOverview.textContent = 'No PDF discussions yet.';
      overviewList.replaceChildren(emptyOverview);
      return;
    }
    overviewList.replaceChildren(...items.map(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ask-pdf-overview-item ${item.status}`;
      const number = document.createElement('span');
      number.className = 'ask-pdf-overview-number';
      number.textContent = String(item.number);
      const copy = document.createElement('span');
      const page = document.createElement('span');
      page.className = 'ask-pdf-overview-page';
      page.textContent = `PAGE ${item.page}`;
      const title = document.createElement('strong');
      title.textContent = item.title;
      copy.append(page, title);
      button.append(number, copy);
      button.addEventListener('click', () => onEvent({ type: 'openAnnotation', annotationId: item.id }));
      return button;
    }));
  }

  function focusPrimary(): void {
    if (panel.hidden) return;
    const target = !consent.hidden && !consentButton.disabled
      ? consentButton
      : !composerSection.hidden && !composer.disabled
        ? composer
        : overviewList.querySelector<HTMLElement>('button')
          ?? sourceDetails.querySelector<HTMLElement>('summary')
          ?? closeButton;
    target.focus({ preventScroll: true });
  }

  return {
    element: panel,
    header,
    liveRegion,
    resetPositionButton,
    update,
    focusPrimary,
  };
}

function sourceSignature(model: AskPdfSourceModel): string {
  return [model.page, model.quote, model.prefix ?? '', model.suffix ?? '', model.cropUrl ?? ''].join('\u0000');
}

function nearbyContext(model: AskPdfSourceModel): HTMLElement | undefined {
  const entries = [
    ...(model.prefix ? [{ label: 'Before', text: model.prefix }] : []),
    ...(model.suffix ? [{ label: 'After', text: model.suffix }] : []),
  ];
  if (!entries.length) return undefined;
  const section = document.createElement('section');
  section.className = 'ask-pdf-nearby-context';
  section.setAttribute('aria-label', 'Nearby context');
  const heading = document.createElement('h3');
  heading.textContent = 'Nearby context';
  const list = document.createElement('dl');
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'ask-pdf-nearby-row';
    const term = document.createElement('dt');
    term.textContent = entry.label;
    const description = document.createElement('dd');
    description.textContent = entry.text;
    row.append(term, description);
    list.appendChild(row);
  }
  section.append(heading, list);
  return section;
}

function actionButton(label: string, className: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

function iconButton(label: string, icon: SVGElement): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.ariaLabel = label;
  button.title = label;
  button.appendChild(icon);
  return button;
}

function icon(children: SVGElement[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.append(...children);
  return svg;
}

function path(data: string): SVGPathElement {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  element.setAttribute('d', data);
  element.setAttribute('fill', 'none');
  element.setAttribute('stroke', 'currentColor');
  element.setAttribute('stroke-width', '1.7');
  element.setAttribute('stroke-linecap', 'round');
  element.setAttribute('stroke-linejoin', 'round');
  return element;
}

function sendIcon(): SVGSVGElement {
  return icon([path('M10 15.5V4.5M5.75 8.75 10 4.5l4.25 4.25')]);
}

function stopIcon(): SVGSVGElement {
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', '6');
  rect.setAttribute('y', '6');
  rect.setAttribute('width', '8');
  rect.setAttribute('height', '8');
  rect.setAttribute('rx', '1.5');
  rect.setAttribute('fill', 'currentColor');
  return icon([rect]);
}

function minimizeIcon(): SVGSVGElement {
  return icon([path('M5 10h10')]);
}

function closeIcon(): SVGSVGElement {
  return icon([path('m6 6 8 8M14 6l-8 8')]);
}

function resetIcon(): SVGSVGElement {
  return icon([path('M5.4 7.2A5.5 5.5 0 1 1 4.7 12M5.4 7.2V3.8M5.4 7.2H2')]);
}

function sparkleIcon(): SVGSVGElement {
  const svg = icon([path('M10 3.5c.5 3 1.5 4 4.5 4.5-3 .5-4 1.5-4.5 4.5-.5-3-1.5-4-4.5-4.5 3-.5 4-1.5 4.5-4.5Z')]);
  svg.classList.add('ask-pdf-model-icon');
  return svg;
}
