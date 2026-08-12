// Styles for the annotation-owned Ask PDF window.
const ASK_PDF_STYLE_ID = 'llm-wiki-ask-pdf-styles';

export function installAskPdfPanelStyles(): void {
  if (document.getElementById(ASK_PDF_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = ASK_PDF_STYLE_ID;
  style.textContent = `
    :root {
      --ask-panel-bg: var(--vscode-editorWidget-background, var(--vscode-sideBar-background, var(--vscode-editor-background)));
      --ask-panel-raised: color-mix(in srgb, var(--ask-panel-bg) 92%, var(--vscode-editor-foreground) 8%);
      --ask-panel-border: color-mix(in srgb, var(--vscode-panel-border) 82%, transparent);
      --ask-muted: var(--vscode-descriptionForeground);
      --ask-source-accent: #4dabf7;
      --ask-agent-accent: #e88968;
      --ask-radius-panel: 14px;
      --ask-radius-card: 11px;
      --ask-radius-control: 8px;
    }
    #viewer-shell { position: relative; }
    #toolbar .ask-pdf-count { min-width: 42px; font-variant-numeric: tabular-nums; }
    .ask-pdf-sr-only, .ask-pdf-live-region { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .ask-pdf-panel { box-sizing: border-box; position: absolute; z-index: 55; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--ask-panel-border); border-radius: var(--ask-radius-panel); background: var(--ask-panel-bg); box-shadow: 0 18px 48px rgba(0,0,0,.34), 0 2px 10px rgba(0,0,0,.22); color: var(--vscode-editor-foreground); font: 13px/1.5 var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif); }
    .ask-pdf-panel[hidden] { display: none; }
    .ask-pdf-panel.attached::before { content: ''; position: absolute; z-index: -1; display: block; background: var(--ask-source-accent); pointer-events: none; }
    .ask-pdf-panel.attached[data-attachment="left"]::before { top: 27px; left: -17px; width: 16px; height: 1px; }
    .ask-pdf-panel.attached[data-attachment="right"]::before { top: 27px; right: -17px; width: 16px; height: 1px; }
    .ask-pdf-panel.attached[data-attachment="top"]::before { top: -17px; left: 27px; width: 1px; height: 16px; }
    .ask-pdf-panel.attached[data-attachment="bottom"]::before { bottom: -17px; left: 27px; width: 1px; height: 16px; }
    .ask-pdf-panel[data-responsive-mode="overlay"] { box-shadow: 0 24px 64px rgba(0,0,0,.46), 0 3px 14px rgba(0,0,0,.28); }
    .ask-pdf-header { box-sizing: border-box; display: flex; min-height: 52px; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 9px 8px 14px; border-bottom: 1px solid var(--ask-panel-border); cursor: grab; user-select: none; touch-action: none; }
    .ask-pdf-header:active { cursor: grabbing; }
    .ask-pdf-title-group { display: flex; min-width: 0; flex-direction: column; }
    .ask-pdf-eyebrow, .ask-pdf-section-heading, .ask-pdf-overview-page, .ask-pdf-model-provenance { font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 9px; font-weight: 650; letter-spacing: .1em; color: var(--ask-muted); }
    .ask-pdf-header h2 { overflow: hidden; margin: -1px 0 0; font-size: 13.5px; font-weight: 620; letter-spacing: -.01em; text-overflow: ellipsis; white-space: nowrap; }
    .ask-pdf-header-actions { display: inline-flex; align-items: center; gap: 1px; }
    .ask-pdf-header button, .ask-pdf-panel button { border: 1px solid transparent; background: transparent; color: inherit; font: inherit; cursor: pointer; }
    .ask-pdf-header button { display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center; border-radius: 8px; }
    .ask-pdf-header button svg { width: 17px; height: 17px; }
    .ask-pdf-header button:hover, .ask-pdf-panel button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)); }
    .ask-pdf-content { display: flex; min-height: 0; flex: 1 1 auto; flex-direction: column; }
    .ask-pdf-body { min-height: 0; flex: 1 1 auto; overflow: auto; overscroll-behavior: contain; padding: 0 14px 12px; }
    .ask-pdf-discussion[hidden], .ask-pdf-overview[hidden], .ask-pdf-empty[hidden], .ask-pdf-composer[hidden], .ask-pdf-consent[hidden], .ask-pdf-actions[hidden], .ask-pdf-link-copied[hidden], .ask-pdf-transcript-empty[hidden] { display: none; }
    .ask-pdf-source { margin: 0 -14px; padding: 10px 14px 11px; border-bottom: 1px solid var(--ask-panel-border); background: color-mix(in srgb, var(--vscode-editor-background) 58%, transparent); }
    .ask-pdf-source-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .ask-pdf-source-page, .ask-pdf-source-copy { padding: 2px 0 !important; color: var(--ask-source-accent) !important; font-size: 11px !important; }
    .ask-pdf-source-page { font-weight: 600 !important; }
    .ask-pdf-source-page:hover, .ask-pdf-source-copy:hover { background: transparent !important; text-decoration: underline; }
    .ask-pdf-link-copied { display: block; margin: 3px 0 0; color: var(--ask-muted); font-size: 10px; }
    .ask-pdf-context { margin-top: 4px; }
    .ask-pdf-context summary { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; align-items: center; padding: 4px 0; color: var(--ask-muted); cursor: pointer; font-size: 11px; list-style-position: inside; }
    .ask-pdf-context summary::marker { color: var(--ask-muted); }
    .ask-pdf-source-preview { overflow: hidden; color: color-mix(in srgb, var(--vscode-editor-foreground) 72%, var(--ask-muted)); text-overflow: ellipsis; white-space: nowrap; }
    .ask-pdf-source-body { margin-top: 7px; }
    .ask-pdf-crop { box-sizing: border-box; display: block; width: 100%; max-height: 190px; margin: 0 0 10px; border: 1px solid color-mix(in srgb, var(--ask-source-accent) 50%, var(--ask-panel-border)); border-radius: 7px; object-fit: contain; background: #fff; }
    .ask-pdf-context blockquote { margin: 0; padding: 7px 9px; border-left: 2px solid var(--ask-source-accent); border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--ask-source-accent) 7%, transparent); line-height: 1.48; }
    .ask-pdf-nearby-context { margin-top: 9px; color: var(--ask-muted); }
    .ask-pdf-nearby-context h3 { margin: 0 0 5px; font-size: 10px; font-weight: 600; }
    .ask-pdf-nearby-context dl { display: grid; gap: 4px; margin: 0; }
    .ask-pdf-nearby-row { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 6px; }
    .ask-pdf-nearby-context dt { font-size: 9px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; }
    .ask-pdf-nearby-context dd { margin: 0; line-height: 1.4; }
    .ask-pdf-transcript { display: flex; flex-direction: column; gap: 14px; margin: 0; padding: 16px 0 8px; list-style: none; }
    .ask-pdf-message { display: flex; min-width: 0; flex-direction: column; }
    .ask-pdf-message.user { align-items: flex-end; }
    .ask-pdf-message.user .ask-pdf-markdown { max-width: 88%; padding: 7px 10px; border: 1px solid color-mix(in srgb, var(--ask-panel-border) 82%, transparent); border-radius: 12px 12px 3px 12px; background: var(--ask-panel-raised); white-space: pre-wrap; }
    .ask-pdf-message.assistant { position: relative; padding-left: 12px; }
    .ask-pdf-message.assistant::before { content: ''; position: absolute; top: 4px; bottom: 3px; left: 0; width: 2px; border-radius: 2px; background: color-mix(in srgb, var(--ask-agent-accent) 78%, var(--ask-panel-border)); }
    .ask-pdf-message.assistant.streaming::before { animation: ask-pdf-stream 1.4s ease-in-out infinite; }
    .ask-pdf-model-provenance { margin-bottom: 4px; letter-spacing: .04em; text-transform: none; }
    .ask-pdf-markdown { min-width: 0; overflow-wrap: anywhere; }
    .ask-pdf-markdown > :first-child { margin-top: 0; }
    .ask-pdf-markdown > :last-child { margin-bottom: 0; }
    .ask-pdf-markdown p { margin: 0 0 8px; }
    .ask-pdf-markdown ul, .ask-pdf-markdown ol { padding-left: 19px; }
    .ask-pdf-markdown pre { overflow: auto; padding: 9px; border-radius: 7px; background: var(--vscode-textCodeBlock-background); }
    .ask-pdf-markdown code { font-family: var(--vscode-editor-font-family, monospace); }
    .ask-pdf-markdown a { color: var(--ask-source-accent); }
    .ask-pdf-running-note { display: flex; align-items: center; gap: 8px; padding-left: 12px; color: var(--ask-muted); font-size: 12px; }
    .ask-pdf-running-note > span { width: 6px; height: 6px; border-radius: 50%; background: var(--ask-agent-accent); animation: ask-pdf-running 1.4s ease-in-out infinite; }
    .ask-pdf-transcript-empty, .ask-pdf-status-note { margin: 4px 0 8px; color: var(--ask-muted); line-height: 1.45; }
    .ask-pdf-notices { display: grid; gap: 5px; }
    .ask-pdf-error { margin: 4px 0; color: var(--vscode-errorForeground); line-height: 1.45; }
    .ask-pdf-consent { margin: 10px 0 4px; padding: 11px 12px; border: 1px solid var(--ask-panel-border); border-radius: var(--ask-radius-card); background: var(--ask-panel-raised); }
    .ask-pdf-consent p { margin: 5px 0 10px; color: var(--ask-muted); line-height: 1.45; }
    .ask-pdf-composer { flex: 0 0 auto; margin: 0 10px 10px; padding: 7px; border: 1px solid var(--vscode-input-border, var(--ask-panel-border)); border-radius: 12px; background: var(--vscode-input-background); box-shadow: 0 1px 0 color-mix(in srgb, var(--vscode-editor-foreground) 5%, transparent) inset; }
    .ask-pdf-composer:focus-within { border-color: color-mix(in srgb, var(--vscode-focusBorder, var(--ask-source-accent)) 78%, var(--ask-panel-border)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder, var(--ask-source-accent)) 42%, transparent); }
    .ask-pdf-composer textarea { box-sizing: border-box; display: block; width: 100%; min-height: 62px; max-height: 180px; resize: vertical; border: 0; outline: 0; padding: 3px 5px 6px; background: transparent; color: var(--vscode-input-foreground); font: inherit; line-height: 1.45; }
    .ask-pdf-composer textarea::placeholder { color: var(--vscode-input-placeholderForeground, var(--ask-muted)); }
    .ask-pdf-composer-footer { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; padding: 1px; }
    .ask-pdf-model-control { display: inline-flex; min-width: 0; max-width: calc(100% - 70px); align-items: center; gap: 4px; padding: 3px 5px; border-radius: 7px; color: var(--ask-muted); }
    .ask-pdf-model-control:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,.31)); }
    .ask-pdf-model-control.unavailable { color: var(--vscode-errorForeground); }
    .ask-pdf-model-icon { width: 13px; height: 13px; flex: 0 0 auto; }
    .ask-pdf-model-control select { min-width: 0; max-width: 190px; border: 0; outline: 0; background: transparent; color: inherit; font: 11px var(--vscode-font-family, sans-serif); cursor: pointer; text-overflow: ellipsis; }
    .ask-pdf-model-control select:disabled { cursor: default; opacity: .58; }
    .ask-pdf-composer-actions { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; }
    .ask-pdf-shortcut { color: var(--ask-muted); font: 9px var(--vscode-editor-font-family, monospace); }
    .ask-pdf-send { display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center; border-radius: 50% !important; background: var(--vscode-button-background) !important; color: var(--vscode-button-foreground) !important; }
    .ask-pdf-send:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)) !important; }
    .ask-pdf-send.running { background: transparent !important; border-color: color-mix(in srgb, var(--vscode-errorForeground) 58%, transparent) !important; color: var(--vscode-errorForeground) !important; }
    .ask-pdf-send svg { width: 17px; height: 17px; }
    .ask-pdf-panel button:disabled { cursor: default; opacity: .46; }
    .ask-pdf-panel .ask-pdf-primary, .ask-pdf-panel .ask-pdf-secondary { min-height: 28px; padding: 4px 10px; border-radius: var(--ask-radius-control); }
    .ask-pdf-panel .ask-pdf-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .ask-pdf-panel .ask-pdf-primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
    .ask-pdf-panel .ask-pdf-secondary { border-color: var(--vscode-button-border, var(--ask-panel-border)); }
    .ask-pdf-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; padding: 11px 0 3px; border-top: 1px solid var(--ask-panel-border); }
    .ask-pdf-overview { padding-top: 13px; }
    .ask-pdf-section-heading { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .ask-pdf-section-heading strong { color: var(--ask-muted); font: inherit; letter-spacing: 0; }
    .ask-pdf-overview-item { box-sizing: border-box; display: grid; width: 100%; grid-template-columns: 26px minmax(0, 1fr); gap: 8px; align-items: start; padding: 9px 5px; border-top: 1px solid var(--ask-panel-border) !important; border-radius: 0; text-align: left; }
    .ask-pdf-overview-item > span:last-child { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
    .ask-pdf-overview-item strong { overflow: hidden; font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
    .ask-pdf-overview-number { box-sizing: border-box; display: inline-flex; width: 20px; height: 20px; align-items: center; justify-content: center; border: 1px solid var(--ask-source-accent); border-radius: 50%; color: var(--ask-source-accent); font: 600 10px var(--vscode-editor-font-family, monospace); }
    .ask-pdf-overview-item.answered .ask-pdf-overview-number, .ask-pdf-overview-item.promoted .ask-pdf-overview-number { background: var(--ask-source-accent); color: #10212e; }
    .ask-pdf-overview-item.failed .ask-pdf-overview-number { border-color: var(--vscode-errorForeground); color: var(--vscode-errorForeground); }
    .ask-pdf-empty { display: grid; place-items: center; min-height: 220px; padding: 24px; color: var(--ask-muted); text-align: center; line-height: 1.55; }
    .ask-pdf-index { color: var(--ask-source-accent); font-size: 20px; }
    .ask-pdf-resize-handle { position: absolute; z-index: 3; touch-action: none; }
    .ask-pdf-resize-n { top: -4px; right: 8px; left: 8px; height: 8px; cursor: ns-resize; }
    .ask-pdf-resize-ne { top: -4px; right: -4px; width: 12px; height: 12px; cursor: nesw-resize; }
    .ask-pdf-resize-e { top: 8px; right: -4px; bottom: 8px; width: 8px; cursor: ew-resize; }
    .ask-pdf-resize-se { right: -5px; bottom: -5px; width: 14px; height: 14px; cursor: nwse-resize; }
    .ask-pdf-resize-s { right: 8px; bottom: -4px; left: 8px; height: 8px; cursor: ns-resize; }
    .ask-pdf-resize-sw { bottom: -4px; left: -4px; width: 12px; height: 12px; cursor: nesw-resize; }
    .ask-pdf-resize-w { top: 8px; bottom: 8px; left: -4px; width: 8px; cursor: ew-resize; }
    .ask-pdf-resize-nw { top: -4px; left: -4px; width: 12px; height: 12px; cursor: nwse-resize; }
    .ask-pdf-resizer:focus-visible, .ask-pdf-panel button:focus-visible, .ask-pdf-panel summary:focus-visible, .ask-pdf-panel textarea:focus-visible, .ask-pdf-panel select:focus-visible, .pdf-discussion-marker:focus-visible { outline: 2px solid var(--vscode-focusBorder, var(--ask-source-accent)); outline-offset: 1px; }
    .highlight-layer .pdf-discussion-outline { position: absolute; z-index: 22; box-sizing: border-box; border: 0; border-radius: 0; padding: 0; background: color-mix(in srgb, var(--ask-source-accent) 14%, transparent); pointer-events: none; }
    .highlight-layer .pdf-discussion-outline:hover, .highlight-layer .pdf-discussion-outline.active { background: color-mix(in srgb, var(--ask-source-accent) 22%, transparent); }
    .highlight-layer .pdf-discussion-outline.failed { background: color-mix(in srgb, var(--vscode-errorForeground, #f48771) 14%, transparent); }
    .highlight-layer .pdf-discussion-outline.failed.active { background: color-mix(in srgb, var(--vscode-errorForeground, #f48771) 22%, transparent); }
    .highlight-layer .pdf-discussion-marker { position: absolute; z-index: 24; display: flex; width: 18px; height: 18px; min-width: 18px; align-items: center; justify-content: center; border: 1px solid var(--ask-source-accent); border-radius: 50%; padding: 0; background: var(--vscode-editor-background, #1e1e1e); color: var(--ask-source-accent); font: 650 9px var(--vscode-editor-font-family, monospace); pointer-events: auto; cursor: pointer; }
    .highlight-layer .pdf-discussion-marker.answered, .highlight-layer .pdf-discussion-marker.active, .highlight-layer .pdf-discussion-marker.promoted { background: var(--ask-source-accent); color: #10212e; }
    .highlight-layer .pdf-discussion-marker.running { animation: ask-pdf-marker 1.6s ease-in-out infinite; }
    .highlight-layer .pdf-discussion-marker.failed { border-color: var(--vscode-errorForeground, #f48771); color: var(--vscode-errorForeground, #f48771); }
    @keyframes ask-pdf-stream { 0%,100% { opacity: .42; } 50% { opacity: 1; } }
    @keyframes ask-pdf-running { 0%,100% { opacity: .38; transform: scale(.82); } 50% { opacity: 1; transform: scale(1); } }
    @keyframes ask-pdf-marker { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ask-source-accent) 30%, transparent); } 50% { box-shadow: 0 0 0 4px transparent; } }
    @media (max-width: 899px) { .ask-pdf-panel { box-shadow: 0 24px 68px rgba(0,0,0,.48); } }
    @media (max-width: 619px) { .ask-pdf-panel { border-radius: 0; } .ask-pdf-header { cursor: default; } .ask-pdf-resize-handle { display: none; cursor: default; } .ask-pdf-source-preview { display: none; } .ask-pdf-model-control select { max-width: 145px; } }
    @media (forced-colors: active) { .ask-pdf-panel, .ask-pdf-source, .ask-pdf-composer, .ask-pdf-consent { border-color: CanvasText; } .ask-pdf-message.assistant::before { background: Highlight; } }
    @media (prefers-reduced-motion: reduce) { .ask-pdf-message.streaming::before, .ask-pdf-running-note > span, .highlight-layer .pdf-discussion-marker.running { animation: none !important; } }
  `;
  document.head.appendChild(style);
}
