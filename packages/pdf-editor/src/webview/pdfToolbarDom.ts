import type { PdfToolbarDock } from './domain/pdfToolbarLayout';

export function ensurePdfReaderLayout(toolbar: HTMLElement): HTMLElement {
  const existing = document.getElementById('pdf-reader-layout');
  if (existing) return existing;

  const viewerShell = document.getElementById('viewer-shell');
  if (!viewerShell) throw new Error('PDF viewer shell is unavailable');
  const layout = document.createElement('div');
  layout.id = 'pdf-reader-layout';
  toolbar.parentElement?.insertBefore(layout, toolbar);
  layout.append(toolbar, viewerShell);
  return layout;
}

export function ensurePdfToolbarGrip(toolbar: HTMLElement): HTMLButtonElement {
  const existing = document.getElementById('pdf-toolbar-grip');
  if (existing instanceof HTMLButtonElement) return existing;

  const grip = document.createElement('button');
  grip.id = 'pdf-toolbar-grip';
  grip.type = 'button';
  grip.setAttribute('aria-label', 'Move PDF toolbar');
  grip.title = 'Move PDF toolbar';
  grip.textContent = '⠿';
  toolbar.prepend(grip);
  return grip;
}

export function ensurePdfToolbarDropTargets(
  layout: HTMLElement,
): ReadonlyMap<PdfToolbarDock, HTMLElement> {
  const targets = new Map<PdfToolbarDock, HTMLElement>();
  for (const dock of ['top', 'left'] as const) {
    let target = layout.querySelector<HTMLElement>(
      `.pdf-toolbar-drop-target[data-dock="${dock}"]`,
    );
    if (!target) {
      target = document.createElement('div');
      target.className = 'pdf-toolbar-drop-target';
      target.dataset.dock = dock;
      target.dataset.active = 'false';
      target.setAttribute('aria-hidden', 'true');
      layout.append(target);
    }
    targets.set(dock, target);
  }
  return targets;
}

export function ensurePdfToolbarMenuActions(displayMenu: HTMLElement): void {
  if (displayMenu.querySelector('[data-display-action="toolbar-top"]')) return;
  const defaults = displayMenu.querySelector('[data-display-action="defaults"]');
  const section = document.createElement('div');
  section.className = 'menu-section';
  section.textContent = 'Toolbar';
  const top = pdfToolbarMenuAction('toolbar-top', 'Move toolbar to top', 'menuitemradio');
  const left = pdfToolbarMenuAction('toolbar-left', 'Move toolbar to left', 'menuitemradio');
  const hide = pdfToolbarMenuAction('toolbar-hide', 'Hide toolbar', 'menuitem');
  for (const element of [section, top, left, hide]) {
    displayMenu.insertBefore(element, defaults);
  }
}

function pdfToolbarMenuAction(
  action: string,
  label: string,
  role: 'menuitem' | 'menuitemradio',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.displayAction = action;
  button.setAttribute('role', role);
  if (role === 'menuitemradio') button.setAttribute('aria-checked', 'false');
  button.textContent = label;
  return button;
}
