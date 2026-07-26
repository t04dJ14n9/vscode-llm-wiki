export interface ObsidianContextMenuAction {
  type?: 'action';
  id?: string;
  label: string;
  icon?: string;
  role?: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ObsidianContextMenuSeparator {
  type: 'separator';
}

export type ObsidianContextMenuItem = ObsidianContextMenuAction | ObsidianContextMenuSeparator;

export interface ObsidianContextMenuOptions {
  clientX: number;
  clientY: number;
  items: readonly ObsidianContextMenuItem[];
}

let activeMenu: HTMLElement | undefined;
let activeAnimationFrame: number | undefined;
let removeActiveListeners: (() => void) | undefined;
let focusTarget: HTMLElement | null = null;

export function closeObsidianContextMenu(): void {
  const menu = activeMenu;
  const animationFrame = activeAnimationFrame;
  const removeListeners = removeActiveListeners;
  const target = focusTarget;

  activeMenu = undefined;
  activeAnimationFrame = undefined;
  removeActiveListeners = undefined;
  focusTarget = null;

  if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
  removeListeners?.();
  menu?.remove();
  if (target?.isConnected) target.focus({ preventScroll: true });
}

export function showObsidianContextMenu(options: ObsidianContextMenuOptions): HTMLElement {
  closeObsidianContextMenu();
  ensureObsidianContextMenuStyles();

  focusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const menu = document.createElement('div');
  menu.className = 'obsidian-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Context menu');
  menu.style.left = `${options.clientX}px`;
  menu.style.top = `${options.clientY}px`;

  const menuItems: HTMLButtonElement[] = [];
  for (const item of options.items) {
    if (item.type === 'separator') {
      const separator = document.createElement('div');
      separator.className = 'obsidian-context-menu__separator';
      separator.setAttribute('role', 'separator');
      menu.appendChild(separator);
      continue;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'obsidian-context-menu__item';
    button.setAttribute('role', item.role ?? 'menuitem');
    button.tabIndex = -1;
    if (item.id) button.dataset.contextAction = item.id;
    if (item.checked !== undefined) button.setAttribute('aria-checked', String(item.checked));
    if (item.disabled) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    }

    if (item.icon) {
      const icon = document.createElement('span');
      icon.className = 'obsidian-context-menu__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = item.icon;
      button.appendChild(icon);
    }

    const label = document.createElement('span');
    label.className = 'obsidian-context-menu__label';
    label.textContent = item.label;
    button.appendChild(label);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      closeObsidianContextMenu();
      item.onSelect();
    });

    if (!item.disabled) menuItems.push(button);
    menu.appendChild(button);
  }

  menu.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  document.body.appendChild(menu);
  activeMenu = menu;

  const dismissOutside = (event: PointerEvent) => {
    if (menu.contains(event.target as Node)) return;
    closeObsidianContextMenu();
  };
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeObsidianContextMenu();
      return;
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || menuItems.length === 0) return;
    event.preventDefault();
    event.stopPropagation();

    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = menuItems.length - 1;
    } else if (event.key === 'ArrowDown') {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % menuItems.length;
    } else {
      nextIndex = currentIndex < 0 ? menuItems.length - 1 : (currentIndex - 1 + menuItems.length) % menuItems.length;
    }
    const nextItem = menuItems[nextIndex];
    nextItem?.focus({ preventScroll: true });
    nextItem?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  document.addEventListener('pointerdown', dismissOutside, true);
  document.addEventListener('keydown', handleKeydown, true);
  removeActiveListeners = () => {
    document.removeEventListener('pointerdown', dismissOutside, true);
    document.removeEventListener('keydown', handleKeydown, true);
  };

  activeAnimationFrame = window.requestAnimationFrame(() => {
    activeAnimationFrame = undefined;
    if (!menu.isConnected) return;
    const viewportPadding = 8;
    const bounds = menu.getBoundingClientRect();
    const maxLeft = Math.max(viewportPadding, window.innerWidth - bounds.width - viewportPadding);
    const maxTop = Math.max(viewportPadding, window.innerHeight - bounds.height - viewportPadding);
    menu.style.left = `${Math.min(Math.max(viewportPadding, options.clientX), maxLeft)}px`;
    menu.style.top = `${Math.min(Math.max(viewportPadding, options.clientY), maxTop)}px`;
  });

  menuItems[0]?.focus({ preventScroll: true });
  return menu;
}

function ensureObsidianContextMenuStyles(): void {
  if (document.getElementById('obsidian-context-menu-styles')) return;

  const style = document.createElement('style');
  style.id = 'obsidian-context-menu-styles';
  style.textContent = `
    .obsidian-context-menu {
      position: fixed;
      z-index: 1000;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      min-width: min(180px, calc(100vw - 16px));
      max-width: min(260px, calc(100vw - 16px));
      max-height: calc(100vh - 16px);
      overflow-y: auto;
      padding: 4px;
      border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, var(--vscode-panel-border)));
      border-radius: 4px;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
      box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, .32));
      color: var(--vscode-menu-foreground, var(--vscode-editor-foreground));
      font: 12px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      user-select: none;
    }
    .obsidian-context-menu__item {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      min-height: 24px;
      padding: 3px 8px;
      border: 0;
      border-radius: 3px;
      background: transparent;
      color: inherit;
      cursor: default;
      font: inherit;
      line-height: 18px;
      text-align: left;
      white-space: nowrap;
    }
    .obsidian-context-menu__item:hover {
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-hoverForeground, inherit));
    }
    .obsidian-context-menu__item:focus {
      outline: none;
      background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground));
      box-shadow: inset 0 0 0 1px var(--vscode-focusBorder, var(--vscode-contrastActiveBorder, transparent));
      color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground, inherit));
    }
    .obsidian-context-menu__item[aria-checked="true"] {
      box-shadow: inset 2px 0 0 var(--vscode-focusBorder, var(--vscode-menu-selectionBackground));
      font-weight: 600;
    }
    .obsidian-context-menu__item:disabled {
      opacity: .45;
    }
    .obsidian-context-menu__icon {
      flex: 0 0 16px;
      width: 16px;
      overflow: hidden;
      text-align: center;
    }
    .obsidian-context-menu__label {
      flex: 1 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .obsidian-context-menu__separator {
      height: 1px;
      margin: 4px;
      background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border, rgba(127, 127, 127, .28)));
    }
  `;
  document.head.appendChild(style);
}
