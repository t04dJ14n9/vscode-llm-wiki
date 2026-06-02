/// <reference path="./vscode.d.ts" />

import { acceptCompletion, autocompletion, startCompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorSelection, EditorState, Prec } from '@codemirror/state';
import type { Range, Text } from '@codemirror/state';
import { search, searchKeymap } from '@codemirror/search';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import type { CodeMirrorV, InputStateInterface, MotionArgs, Pos, vimState } from '@replit/codemirror-vim';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  drawSelection,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { applyInsertText } from './insertText';
import { copySelectionToClipboard, handleCopy, handlePaste } from './markdownClipboard';
import {
  hybridRendering,
  initialBodyPositionAfterFrontmatter,
  isHybridPreviewEnabled,
  setDocumentTitle,
  setImageResourceContext,
  toggleHybridPreview,
} from './extensions/hybridRendering';
import { isCodeFenceClosing, parseCodeFenceOpening } from './markdownFences';
import {
  inlineCodeSourceSpans,
  isEscapedAt,
  markdownLinkSourceSpans,
  markdownReferenceDefinitions,
  markdownReferenceLinkSourceSpans,
  parseMarkdownLinkDestination,
} from './markdownSpans';
import { setextHeadingLevelForLines } from '../src/markdownHeadingSyntax';
import { parseWikiLinkTarget } from '../src/wikiLinks';

const vscode = acquireVsCodeApi();

class HlLinkWidget extends WidgetType {
  constructor(
    readonly uri: string,
    readonly label: string,
    readonly sourceFrom: number,
    readonly sourceTo: number,
  ) {
    super();
  }

  override toDOM(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-hl-link';
    button.dataset.sourceFrom = String(this.sourceFrom);
    button.dataset.sourceTo = String(this.sourceTo);
    if (isExternalUri(this.uri)) {
      button.classList.add('cm-external-link');
    }
    button.textContent = this.label || this.uri;
    button.title = this.uri;
    const stopEditorSelection = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    button.addEventListener('pointerdown', stopEditorSelection);
    button.addEventListener('mousedown', stopEditorSelection);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      vscode.postMessage({ type: 'openUri', uri: this.uri });
    });
    return button;
  }

  override eq(other: HlLinkWidget): boolean {
    return this.uri === other.uri
      && this.label === other.label
      && this.sourceFrom === other.sourceFrom
      && this.sourceTo === other.sourceTo;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class TextReplacementWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.textContent = this.text;
    return span;
  }

  override eq(other: TextReplacementWidget): boolean {
    return this.text === other.text;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const hlLinkRendering = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      isHybridPreviewEnabled(update.startState) !== isHybridPreviewEnabled(update.state)
    ) {
      this.decorations = buildDecorations(update.view);
    }
  }
}, {
  decorations: plugin => plugin.decorations,
});

let view: EditorView | undefined;
let applyingHostUpdate = false;
let vimModeEnabled = false;
let currentNotePath: string | undefined;
let knownNotePaths: string[] = [];
let humanLearningVimMotionsInstalled = false;
let humanLearningVimExCommandsInstalled = false;
let humanLearningVimMarkdownKeysInstalled = false;
let wikiLinkCompletionPending = false;

type EditorCommand = (view: EditorView) => boolean;
type EditorPresentationSettings = Partial<Record<'fontFamily' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing', string>>;
type MarkdownEditorTestWindow = Window & {
  __cmView?: EditorView;
  __hlCommands?: Record<string, EditorCommand>;
  __hlVimModeEnabled?: () => boolean;
};

const editorSettingToCssVariable = {
  fontFamily: '--hl-editor-font-family',
  fontSize: '--hl-editor-font-size',
  fontWeight: '--hl-editor-font-weight',
  lineHeight: '--hl-editor-line-height',
  letterSpacing: '--hl-editor-letter-spacing',
} satisfies Record<keyof EditorPresentationSettings, string>;

const vimModeCompartment = new Compartment();
const activeLinkLabelMark = Decoration.mark({ class: 'cm-active-link-label' });
const activeExternalLinkLabelMark = Decoration.mark({ class: 'cm-active-link-label cm-active-external-link' });
const activeBoldMark = Decoration.mark({ class: 'cm-active-bold' });
const activeItalicMark = Decoration.mark({ class: 'cm-active-italic' });
const activeStrikeMark = Decoration.mark({ class: 'cm-active-strikethrough' });
const activeHighlightMark = Decoration.mark({ class: 'cm-active-highlight' });
const activeInlineCodeMark = Decoration.mark({ class: 'cm-active-inline-code' });
const activeMathDelimiterMark = Decoration.mark({ class: 'cm-active-math-delimiter' });
const activeMathSourceMark = Decoration.mark({ class: 'cm-active-math-source' });
const activeTagMark = Decoration.mark({ class: 'cm-active-tag' });
const activeFootnoteRefMark = Decoration.mark({ class: 'cm-active-footnote-ref' });
const activeFootnoteDefLabelMark = Decoration.mark({ class: 'cm-active-footnote-def-label' });

const obsidianLikeCommands: Record<string, EditorCommand> = {
  'markdown:toggle-preview': toggleHybridPreview,
  'editor:toggle-source': toggleHybridPreview,
  'editor:toggle-bold': view => toggleDelimited(view, '**', '**', 'bold text'),
  'editor:toggle-italics': view => toggleDelimited(view, '*', '*', 'italic text'),
  'editor:toggle-strikethrough': view => toggleDelimited(view, '~~', '~~', 'struck text'),
  'editor:toggle-highlight': view => toggleDelimited(view, '==', '==', 'highlighted text'),
  'editor:toggle-code': view => toggleDelimited(view, '`', '`', 'code'),
  'editor:toggle-inline-math': view => toggleDelimited(view, '$', '$', 'math'),
  'editor:insert-mathblock': insertMathBlock,
  'editor:insert-link': insertMarkdownLink,
  'editor:insert-wikilink': view => toggleDelimited(view, '[[', ']]', 'Note name'),
  'editor:lookup-selection': lookupSelection,
  'editor:toggle-checklist-status': toggleChecklistStatus,
  'editor:insert-table': insertTable,
  'editor:insert-horizontal-rule': insertHorizontalRule,
  'editor:follow-link': followLinkAtCursor,
  'editor:set-heading-0': view => setHeading(view, 0),
  'editor:set-heading-1': view => setHeading(view, 1),
  'editor:set-heading-2': view => setHeading(view, 2),
  'editor:set-heading-3': view => setHeading(view, 3),
  'editor:set-heading-4': view => setHeading(view, 4),
  'editor:set-heading-5': view => setHeading(view, 5),
  'editor:set-heading-6': view => setHeading(view, 6),
};

installHumanLearningVimMotions();
installHumanLearningVimExCommands();
installHumanLearningVimMarkdownKeys();

function installHumanLearningVimMotions(): void {
  if (humanLearningVimMotionsInstalled) return;

  // The upstream Vim motion falls back to visual coordinates when it sees
  // replaced ranges. Hybrid markdown previews deliberately replace inactive
  // source lines, so document-line movement is the behavior we need here.
  Vim.defineMotion('moveByLines', moveByDocumentLines);
  humanLearningVimMotionsInstalled = true;
}

function installHumanLearningVimExCommands(): void {
  if (humanLearningVimExCommandsInstalled) return;

  Vim.defineEx('write', 'w', () => {
    vscode.postMessage({ type: 'save' });
  });
  Vim.defineEx('quit', 'q', () => {
    vscode.postMessage({ type: 'close' });
  });
  Vim.defineEx('wq', 'wq', () => {
    vscode.postMessage({ type: 'saveAndClose' });
  });
  Vim.defineEx('x', 'x', () => {
    vscode.postMessage({ type: 'saveAndClose' });
  });
  humanLearningVimExCommandsInstalled = true;
}

function installHumanLearningVimMarkdownKeys(): void {
  if (humanLearningVimMarkdownKeysInstalled) return;

  Vim.defineAction('humanLearningInsertOpenBracket', cm => {
    insertMarkdownPunctuationFromVimAction(cm, '[');
  });
  Vim.defineAction('humanLearningInsertDash', cm => {
    insertMarkdownPunctuationFromVimAction(cm, '-');
  });
  Vim.mapCommand('[', 'action', 'humanLearningInsertOpenBracket', {}, { context: 'normal', isEdit: true });
  Vim.mapCommand('-', 'action', 'humanLearningInsertDash', {}, { context: 'normal', isEdit: true });
  humanLearningVimMarkdownKeysInstalled = true;
}

function moveByDocumentLines(
  cm: CodeMirrorV,
  head: Pos,
  motionArgs: MotionArgs,
  vimState: vimState,
  _inputState: InputStateInterface,
): Pos {
  let targetColumn = head.ch;
  if (vimState.lastMotion === moveByDocumentLines) {
    targetColumn = vimState.lastHPos;
  } else {
    vimState.lastHPos = targetColumn;
  }

  const repeat = motionArgs.repeat + (motionArgs.repeatOffset ?? 0);
  const rawTargetLine = head.line + (motionArgs.forward ? repeat : -repeat);
  const firstLine = cm.firstLine();
  const lastLine = cm.lastLine();

  if (rawTargetLine < firstLine && head.line === firstLine) {
    targetColumn = 0;
  } else if (rawTargetLine > lastLine && head.line === lastLine) {
    targetColumn = cm.getLine(lastLine).length;
  }

  const targetLine = Math.min(Math.max(rawTargetLine, firstLine), lastLine);
  const lineText = cm.getLine(targetLine);
  if (motionArgs.toFirstChar) {
    targetColumn = firstNonWhitespaceColumn(lineText);
    vimState.lastHPos = targetColumn;
  }

  const clippedColumn = Math.min(Math.max(0, targetColumn), lineText.length);
  try {
    vimState.lastHSPos = cm.charCoords({ line: targetLine, ch: clippedColumn }, 'div').left;
  } catch {
    vimState.lastHSPos = clippedColumn;
  }

  return { line: targetLine, ch: clippedColumn };
}

function firstNonWhitespaceColumn(text: string): number {
  const match = /\S/.exec(text);
  return match?.index ?? text.length;
}

function createView(text: string, title?: string): EditorView {
  const initialBodyPosition = initialBodyPositionAfterFrontmatter(text);
  const editorView = new EditorView({
    parent: document.getElementById('editor')!,
    state: EditorState.create({
      doc: text,
      selection: initialBodyPosition == null
        ? undefined
        : EditorSelection.cursor(initialBodyPosition),
      extensions: [
        lineNumbers(),
        vimModeCompartment.of(vimModeEnabled ? [vim()] : []),
        history(),
        drawSelection(),
        markdown({ codeLanguages: languages }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        search({ top: true }),
        autocompletion({
          activateOnTyping: true,
          icons: false,
          interactionDelay: 0,
          override: [wikiLinkCompletionSource],
        }),
        hybridRendering(),
        hlLinkRendering,
        Prec.highest(keymap.of([
          { key: 'Ctrl-o', run: handleControlO, preventDefault: true },
          { key: 'Ctrl-O', run: handleControlO, preventDefault: true },
          { key: 'Enter', run: editorView => acceptCompletion(editorView) || handleObsidianEnter(editorView), preventDefault: true },
          { key: 'Backspace', run: handleObsidianListBackspace, preventDefault: true },
        ])),
        EditorView.domEventHandlers({
          copy(event, editorView) {
            return handleCopy(event, editorView);
          },
          paste(event, editorView) {
            return handlePaste(event, editorView);
          },
          mousedown(event, editorView) {
            return handleModifiedLinkClick(event, editorView);
          },
          contextmenu(event, editorView) {
            return handleSelectionContextMenu(event, editorView);
          },
        }),
        EditorView.lineWrapping,
        EditorView.updateListener.of(update => {
          if (update.docChanged && !applyingHostUpdate) {
            vscode.postMessage({ type: 'edit', text: update.state.doc.toString() });
          }
          if (update.docChanged || update.selectionSet) {
            postSelection(update.view);
          }
          if (update.docChanged && !applyingHostUpdate) {
            scheduleWikiLinkCompletion(update.view);
          }
        }),
        Prec.high(keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              vscode.postMessage({ type: 'save' });
              return true;
            },
            preventDefault: true,
          },
          { key: 'Mod-e', run: obsidianLikeCommands['markdown:toggle-preview']!, preventDefault: true },
          { key: 'Mod-b', run: obsidianLikeCommands['editor:toggle-bold']!, preventDefault: true },
          { key: 'Mod-i', run: obsidianLikeCommands['editor:toggle-italics']!, preventDefault: true },
          { key: 'Mod-Shift-x', run: obsidianLikeCommands['editor:toggle-strikethrough']!, preventDefault: true },
          { key: 'Mod-c', run: editorView => copySelectionToClipboard(editorView, postCopyTextToHost) },
          { key: 'Mod-`', run: obsidianLikeCommands['editor:toggle-code']!, preventDefault: true },
          { key: 'Mod-k', run: obsidianLikeCommands['editor:insert-link']!, preventDefault: true },
          { key: 'Mod-l', run: obsidianLikeCommands['editor:toggle-checklist-status']!, preventDefault: true },
          { key: 'Mod-Enter', run: obsidianLikeCommands['editor:follow-link']!, preventDefault: true },
          { key: 'Alt-Enter', run: obsidianLikeCommands['editor:follow-link']!, preventDefault: true },
          { key: 'Tab', run: indentCodeOrListItems, preventDefault: true },
          { key: 'Shift-Tab', run: outdentCodeOrListItems, preventDefault: true },
          { key: 'Mod-Alt-0', run: obsidianLikeCommands['editor:set-heading-0']!, preventDefault: true },
          { key: 'Mod-Alt-1', run: obsidianLikeCommands['editor:set-heading-1']!, preventDefault: true },
          { key: 'Mod-Alt-2', run: obsidianLikeCommands['editor:set-heading-2']!, preventDefault: true },
          { key: 'Mod-Alt-3', run: obsidianLikeCommands['editor:set-heading-3']!, preventDefault: true },
          { key: 'Mod-Alt-4', run: obsidianLikeCommands['editor:set-heading-4']!, preventDefault: true },
          { key: 'Mod-Alt-5', run: obsidianLikeCommands['editor:set-heading-5']!, preventDefault: true },
          { key: 'Mod-Alt-6', run: obsidianLikeCommands['editor:set-heading-6']!, preventDefault: true },
          { key: 'Mod-Shift-t', run: obsidianLikeCommands['editor:insert-table']!, preventDefault: true },
          { key: 'Mod-Shift-h', run: obsidianLikeCommands['editor:toggle-highlight']!, preventDefault: true },
        ])),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        EditorView.theme({
          '&': {
            height: '100%',
            backgroundColor: 'var(--vscode-editor-background)',
            color: 'var(--vscode-editor-foreground)',
            fontFamily: 'var(--hl-editor-font-family, var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif))',
            fontSize: 'var(--hl-editor-font-size, var(--vscode-editor-font-size, 14px))',
            fontWeight: 'var(--hl-editor-font-weight, var(--vscode-editor-font-weight, normal))',
            lineHeight: 'var(--hl-editor-line-height, 1.55)',
            letterSpacing: 'var(--hl-editor-letter-spacing, normal)',
            caretColor: 'var(--vscode-editorCursor-foreground, currentColor)',
          },
          '.cm-scroller': {
            fontFamily: 'inherit',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            lineHeight: 'inherit',
            letterSpacing: 'inherit',
          },
          '.cm-content': {
            padding: '8px 0',
            lineHeight: 'inherit',
            letterSpacing: 'inherit',
            boxSizing: 'border-box',
            flex: '0 1 min(100%, 52rem)',
            maxWidth: '52rem',
            minWidth: '0',
            width: 'min(100%, 52rem)',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--vscode-editorGutter-background)',
            color: 'var(--vscode-editorGutter-foreground)',
            borderRight: '1px solid var(--vscode-editorGutter-border, transparent)',
          },
          '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: 'var(--vscode-editorCursor-foreground, currentColor)',
          },
          '.cm-panels.cm-panels-top:has(.cm-search)': {
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
            zIndex: '50',
            borderBottom: '0',
            backgroundColor: 'transparent',
            pointerEvents: 'none',
          },
          '.cm-panel.cm-search': {
            pointerEvents: 'auto',
            boxSizing: 'border-box',
            display: 'grid',
            gridTemplateColumns: 'minmax(128px, 1fr) repeat(7, 24px)',
            alignItems: 'center',
            gap: '2px',
            width: 'min(420px, calc(100% - 16px))',
            minHeight: '34px',
            margin: '8px 8px 0 auto',
            padding: '4px',
            border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border, #454545))',
            borderRadius: '3px',
            backgroundColor: 'var(--vscode-editorWidget-background, var(--vscode-sideBar-background, #252526))',
            boxShadow: '0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36))',
            color: 'var(--vscode-editorWidget-foreground, var(--vscode-foreground, var(--vscode-editor-foreground, inherit)))',
            fontFamily: 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
            fontSize: '12px',
          },
          '.cm-panel.cm-search input.cm-textfield[name="search"]': {
            boxSizing: 'border-box',
            width: '100%',
            height: '26px',
            minWidth: '0',
            margin: '0',
            padding: '2px 6px',
            border: '1px solid var(--vscode-input-border, transparent)',
            borderRadius: '2px',
            outline: '0',
            backgroundColor: 'var(--vscode-input-background, var(--vscode-editor-background))',
            color: 'var(--vscode-input-foreground, var(--vscode-editor-foreground))',
            font: 'inherit',
          },
          '.cm-panel.cm-search input.cm-textfield[name="search"]:focus': {
            borderColor: 'var(--vscode-focusBorder, var(--vscode-inputOption-activeBorder, #007fd4))',
          },
          '.cm-panel.cm-search input.cm-textfield[name="replace"], .cm-panel.cm-search button[name="replace"], .cm-panel.cm-search button[name="replaceAll"], .cm-panel.cm-search br': {
            display: 'none',
          },
          '.cm-panel.cm-search button, .cm-panel.cm-search label': {
            boxSizing: 'border-box',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            minWidth: '24px',
            margin: '0',
            padding: '0',
            border: '1px solid transparent',
            borderRadius: '3px',
            appearance: 'none',
            WebkitAppearance: 'none',
            background: 'transparent',
            backgroundColor: 'transparent',
            backgroundImage: 'none',
            boxShadow: 'none',
            color: 'var(--vscode-icon-foreground, var(--vscode-foreground, var(--vscode-editor-foreground, inherit)))',
            font: 'inherit',
            lineHeight: '1',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          },
          '.cm-panel.cm-search button': {
            fontSize: '0',
          },
          '.cm-panel.cm-search button:hover, .cm-panel.cm-search label:hover': {
            backgroundColor: 'var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31))',
          },
          '.cm-panel.cm-search button:focus-visible, .cm-panel.cm-search label:focus-within': {
            outline: '1px solid var(--vscode-focusBorder, #007fd4)',
            outlineOffset: '-1px',
          },
          '.cm-panel.cm-search button::before': {
            fontSize: '13px',
            lineHeight: '1',
          },
          '.cm-panel.cm-search button[name="prev"]::before': {
            content: '"↑"',
          },
          '.cm-panel.cm-search button[name="next"]::before': {
            content: '"↓"',
          },
          '.cm-panel.cm-search button[name="select"]::before': {
            content: '"≡"',
          },
          '.cm-panel.cm-search button[name="close"]': {
            position: 'static',
            inset: 'auto',
            border: '1px solid transparent',
            backgroundColor: 'transparent',
            fontSize: '13px',
          },
          '.cm-panel.cm-search label': {
            position: 'relative',
            overflow: 'hidden',
            fontSize: '0',
          },
          '.cm-panel.cm-search label input[type="checkbox"]': {
            position: 'absolute',
            width: '1px',
            height: '1px',
            opacity: '0',
            pointerEvents: 'none',
          },
          '.cm-panel.cm-search label::after': {
            fontSize: '10px',
            fontWeight: '600',
            letterSpacing: '0',
            lineHeight: '1',
          },
          '.cm-panel.cm-search label:has(input[name="case"])::after': {
            content: '"Aa"',
          },
          '.cm-panel.cm-search label:has(input[name="re"])::after': {
            content: '".*"',
          },
          '.cm-panel.cm-search label:has(input[name="word"])::after': {
            content: '"ab"',
          },
          '.cm-panel.cm-search label:has(input[type="checkbox"]:checked)': {
            borderColor: 'var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder, #007fd4))',
            backgroundColor: 'var(--vscode-inputOption-activeBackground, rgba(0, 127, 212, 0.18))',
            color: 'var(--vscode-inputOption-activeForeground, var(--vscode-foreground, inherit))',
          },
          '.cm-tooltip-autocomplete': {
            overflow: 'hidden',
            border: '1px solid var(--vscode-widget-border, var(--vscode-panel-border, #454545))',
            borderRadius: '4px',
            backgroundColor: 'var(--vscode-editorWidget-background, var(--vscode-sideBar-background, #252526))',
            boxShadow: '0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36))',
            color: 'var(--vscode-editorWidget-foreground, var(--vscode-editor-foreground, inherit))',
            fontFamily: 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
            fontSize: '12px',
          },
          '.cm-tooltip-autocomplete > ul': {
            maxHeight: '14rem',
            minWidth: '14rem',
          },
          '.cm-tooltip-autocomplete ul li[role="option"]': {
            padding: '3px 8px',
            lineHeight: '1.45',
          },
          '.cm-tooltip-autocomplete ul li[aria-selected]': {
            backgroundColor: 'var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground, rgba(90, 93, 94, 0.31)))',
            color: 'var(--vscode-list-activeSelectionForeground, var(--vscode-editor-foreground, inherit))',
          },
          '.cm-hl-link': {
            display: 'inline',
            maxWidth: '32rem',
            border: '0',
            borderRadius: '0',
            padding: '0',
            color: 'var(--vscode-textLink-foreground)',
            backgroundColor: 'transparent',
            font: 'inherit',
            fontWeight: '500',
            cursor: 'pointer',
            textDecoration: 'underline',
            textDecorationThickness: '1.5px',
            textUnderlineOffset: '2px',
            whiteSpace: 'normal',
            verticalAlign: 'baseline',
          },
          '.cm-hl-link:hover': {
            color: 'var(--vscode-textLink-activeForeground)',
            backgroundColor: 'transparent',
          },
          '.cm-hl-link.cm-external-link::after': {
            content: '"↗"',
            display: 'inline-block',
            marginLeft: '4px',
            fontSize: '0.8em',
            opacity: '0.85',
            verticalAlign: 'text-top',
          },
          '.cm-active-link-label': {
            color: 'var(--vscode-textLink-foreground)',
            backgroundColor: 'transparent',
            borderRadius: '0',
            padding: '0',
            fontWeight: '500',
            cursor: 'pointer',
            textDecoration: 'underline',
            textDecorationThickness: '1.5px',
            textUnderlineOffset: '2px',
          },
          '.cm-active-link-label.cm-active-link-label *': {
            color: 'inherit',
            opacity: '1',
            fontWeight: 'inherit',
          },
          '.cm-active-external-link::after': {
            content: '"↗"',
            display: 'inline-block',
            marginLeft: '4px',
            fontSize: '0.8em',
            opacity: '0.85',
            verticalAlign: 'text-top',
          },
          '.cm-active-bold': { fontWeight: '700' },
          '.cm-active-italic': { fontStyle: 'italic' },
          '.cm-active-strikethrough': { textDecoration: 'line-through', opacity: '0.75' },
          '.cm-active-highlight': {
            backgroundColor: 'var(--vscode-editor-wordHighlightStrongBackground, rgba(255, 214, 10, 0.22))',
            borderRadius: '4px',
            padding: '0 2px',
          },
          '.cm-active-inline-code': {
            backgroundColor: 'var(--vscode-textCodeBlock-background, rgba(127,127,127,.18))',
            borderRadius: '4px',
            padding: '1px 5px',
            color: 'var(--vscode-textPreformat-foreground, inherit)',
            fontFamily: 'var(--vscode-editor-font-family, ui-monospace, Menlo, monospace)',
          },
          '.cm-active-math-delimiter': {
            color: 'var(--vscode-symbolIcon-operatorForeground, #c586c0)',
            fontWeight: '600',
          },
          '.cm-active-math-source': {
            color: 'var(--vscode-symbolIcon-variableForeground, #4ec9b0)',
            fontStyle: 'italic',
          },
          '.cm-active-tag': {
            color: 'var(--vscode-textLink-foreground)',
            backgroundColor: 'var(--vscode-editor-wordHighlightBackground, rgba(64, 128, 255, 0.16))',
            borderRadius: '4px',
            padding: '0 4px',
            fontWeight: '500',
          },
          '.cm-active-footnote-ref, .cm-active-footnote-def-label': {
            color: 'var(--vscode-textLink-foreground)',
            fontSize: '0.78em',
            verticalAlign: 'super',
            lineHeight: '0',
            fontWeight: '600',
          },
        }),
      ],
    }),
  });
  if (typeof title === 'string') {
    editorView.dispatch({ effects: setDocumentTitle.of(title) });
  }
  editorView.dom.addEventListener('copy', event => {
    handleCopy(event, editorView);
  }, true);
  editorView.dom.addEventListener('human-learning-title-rename', event => {
    const nextTitle = (event as CustomEvent<{ title?: unknown }>).detail?.title;
    if (typeof nextTitle === 'string') {
      vscode.postMessage({ type: 'renameTitle', title: nextTitle });
    }
  });
  editorView.dom.addEventListener('human-learning-open-uri', event => {
    const uri = (event as CustomEvent<{ uri?: unknown }>).detail?.uri;
    if (typeof uri === 'string' && uri.length > 0) {
      vscode.postMessage({ type: 'openUri', uri });
    }
  });
  editorView.dom.addEventListener('human-learning-copy-text', event => {
    const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
    if (typeof text === 'string') {
      vscode.postMessage({ type: 'copyText', text });
    }
  });
  editorView.dom.addEventListener('webkitmouseforcedown', event => {
    handleForceLookup(event as MouseEvent, editorView);
  }, true);
  (window as MarkdownEditorTestWindow).__cmView = editorView;
  postSelection(editorView);
  queueInitialFocus(editorView, { retries: typeof title !== 'string' });
  ensureVimInsertMode(editorView);
  return editorView;
}

function postSelection(editorView: EditorView): void {
  const selection = editorView.state.selection.main;
  vscode.postMessage({
    type: 'selectionChanged',
    selection: {
      from: selection.from,
      to: selection.to,
    },
  });
}

function queueInitialFocus(
  editorView: EditorView,
  options: { retries?: boolean } = {},
): void {
  let cancelled = false;
  const cancelAutofocus = () => {
    cancelled = true;
    window.removeEventListener('pointerdown', cancelAutofocus, true);
    window.removeEventListener('keydown', cancelAutofocus, true);
  };
  const focusEditor = () => {
    if (cancelled || !editorView.dom.isConnected) return;
    if (editorView.hasFocus) {
      cancelAutofocus();
      return;
    }
    if (shouldPreserveFocusedElement()) return;
    const frame = window.frameElement as { focus?: () => void } | null;
    frame?.focus?.();
    window.focus();
    editorView.focus();
    if (editorView.hasFocus) cancelAutofocus();
  };

  window.addEventListener('pointerdown', cancelAutofocus, true);
  window.addEventListener('keydown', cancelAutofocus, true);
  requestAnimationFrame(focusEditor);
  if (options.retries === false) {
    window.setTimeout(cancelAutofocus, 100);
    return;
  }
  for (const delay of [50, 150, 300, 600]) {
    window.setTimeout(focusEditor, delay);
  }
  window.setTimeout(cancelAutofocus, 700);
}

function shouldPreserveFocusedElement(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active === document.body || active === document.documentElement) return false;
  if (active.closest('.cm-editor')) {
    return active.matches('input, textarea, select, button, [contenteditable="true"]');
  }
  return true;
}

function toggleDelimited(
  editorView: EditorView,
  left: string,
  right = left,
  placeholder = 'text',
): boolean {
  editorView.dispatch(editorView.state.changeByRange(range => {
    const doc = editorView.state.doc;
    const before = doc.sliceString(Math.max(0, range.from - left.length), range.from);
    const after = doc.sliceString(range.to, Math.min(doc.length, range.to + right.length));

    if (!range.empty && before === left && after === right) {
      return {
        changes: [
          { from: range.from - left.length, to: range.from, insert: '' },
          { from: range.to, to: range.to + right.length, insert: '' },
        ],
        range: EditorSelection.range(range.from - left.length, range.to - left.length),
      };
    }

    const selected = doc.sliceString(range.from, range.to);
    const selectedDelimiters = findSelectedDelimiters(selected, left, right);
    if (!range.empty && selectedDelimiters) {
      const contentFrom = range.from + selectedDelimiters.leftTo;
      const contentTo = range.from + selectedDelimiters.rightFrom;
      return {
        changes: [
          {
            from: range.from + selectedDelimiters.rightFrom,
            to: range.from + selectedDelimiters.rightTo,
            insert: '',
          },
          {
            from: range.from + selectedDelimiters.leftFrom,
            to: range.from + selectedDelimiters.leftTo,
            insert: '',
          },
        ],
        range: EditorSelection.range(
          contentFrom - left.length,
          contentTo - left.length,
        ),
      };
    }

    if (range.empty) {
      const enclosing = findEnclosingDelimiters(doc, range.from, left, right);
      if (enclosing) {
        const adjustedCursor = Math.max(
          enclosing.contentFrom,
          range.from - left.length,
        );
        return {
          changes: [
            { from: enclosing.rightFrom, to: enclosing.rightTo, insert: '' },
            { from: enclosing.leftFrom, to: enclosing.leftTo, insert: '' },
          ],
          range: EditorSelection.cursor(adjustedCursor),
        };
      }
    }

    const text = selected || placeholder;
    const insert = `${left}${text}${right}`;
    const anchor = range.from + left.length;
    const head = anchor + text.length;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(anchor, head),
    };
  }));
  editorView.focus();
  return true;
}

function insertMathBlock(editorView: EditorView): boolean {
  editorView.dispatch(editorView.state.changeByRange(range => {
    const doc = editorView.state.doc;
    const existingBlock = findDisplayMathBlock(doc, range.from);
    if (existingBlock && range.to <= existingBlock.to) {
      const opening = doc.line(existingBlock.startLine);
      const closing = doc.line(existingBlock.endLine);
      const closingTo = closing.to < doc.length ? closing.to + 1 : closing.to;
      const openingTo = opening.to < doc.length ? opening.to + 1 : opening.to;
      const cursor = Math.min(range.from, opening.from);
      return {
        changes: [
          { from: closing.from, to: closingTo, insert: '' },
          { from: opening.from, to: openingTo, insert: '' },
        ],
        range: EditorSelection.cursor(cursor),
      };
    }

    const selected = doc.sliceString(range.from, range.to);
    const content = selected || 'math';
    const insert = `$$\n${content}\n$$`;
    const anchor = range.from + 3;
    const head = anchor + content.length;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(anchor, head),
    };
  }));
  editorView.focus();
  return true;
}

function insertMarkdownLink(editorView: EditorView): boolean {
  const placeholderLabel = 'link text';
  const placeholderUrl = 'url';
  editorView.dispatch(editorView.state.changeByRange(range => {
    const label = editorView.state.doc.sliceString(range.from, range.to) || placeholderLabel;
    const insert = `[${label}](${placeholderUrl})`;
    const urlFrom = range.from + label.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlFrom, urlFrom + placeholderUrl.length),
    };
  }));
  editorView.focus();
  return true;
}

function lookupSelection(editorView: EditorView): boolean {
  const lookup = lookupRequestForSelection(editorView);
  if (!lookup) return false;
  vscode.postMessage({ type: 'lookupSelection', ...lookup });
  editorView.focus();
  return true;
}

function handleForceLookup(event: MouseEvent, editorView: EditorView): void {
  const lookup = lookupRequestForSelection(editorView) ?? lookupRequestAtEvent(editorView, event);
  if (!lookup) return;
  event.preventDefault();
  event.stopPropagation();
  document.getElementById('selection-toolbar')?.remove();
  vscode.postMessage({ type: 'lookupSelection', ...lookup });
}

function handleSelectionContextMenu(event: MouseEvent, editorView: EditorView): boolean {
  const selection = editorView.state.selection.main;
  if (selection.empty) return false;
  const lookup = lookupRequestForSelection(editorView);
  if (!lookup) return false;

  event.preventDefault();
  event.stopPropagation();
  showMarkdownSelectionToolbar(editorView, event.clientX, event.clientY);
  return true;
}

function showMarkdownSelectionToolbar(editorView: EditorView, clientX: number, clientY: number): void {
  ensureMarkdownSelectionToolbarStyles();
  document.getElementById('selection-toolbar')?.remove();

  const toolbar = document.createElement('div');
  toolbar.id = 'selection-toolbar';
  toolbar.className = 'selection-toolbar markdown-selection-toolbar';
  toolbar.style.left = `${clientX + window.scrollX}px`;
  toolbar.style.top = `${Math.max(8, clientY - 42 + window.scrollY)}px`;
  toolbar.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();
  });

  const runCommand = (command: string) => {
    obsidianLikeCommands[command]?.(editorView);
    toolbar.remove();
  };

  const addButton = (label: string, command: string, ariaLabel = label, className = '') => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = className;
    button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      runCommand(command);
    });
    toolbar.appendChild(button);
    return button;
  };

  addButton('B', 'editor:toggle-bold', 'Bold');
  addButton('I', 'editor:toggle-italics', 'Italic', 'secondary');
  addButton('Code', 'editor:toggle-code', 'Inline Code', 'secondary');
  addButton('Mark', 'editor:toggle-highlight', 'Highlight', 'secondary');
  addButton('Look Up', 'editor:lookup-selection', 'Look Up', 'secondary');

  const menu = document.createElement('div');
  menu.className = 'menu';
  const heading = document.createElement('button');
  heading.type = 'button';
  heading.textContent = 'Heading';
  heading.className = 'secondary';
  heading.setAttribute('aria-label', 'Heading');
  heading.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    menu.classList.toggle('open');
  });
  toolbar.appendChild(heading);

  for (const [label, command] of [
    ['Paragraph', 'editor:set-heading-0'],
    ['H1', 'editor:set-heading-1'],
    ['H2', 'editor:set-heading-2'],
    ['H3', 'editor:set-heading-3'],
    ['H4', 'editor:set-heading-4'],
    ['H5', 'editor:set-heading-5'],
    ['H6', 'editor:set-heading-6'],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = 'secondary';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      runCommand(command);
    });
    menu.appendChild(button);
  }
  toolbar.appendChild(menu);

  document.body.appendChild(toolbar);
  requestAnimationFrame(() => {
    const box = toolbar.getBoundingClientRect();
    const half = box.width / 2;
    const minLeft = window.scrollX + 12 + half;
    const maxLeft = window.scrollX + window.innerWidth - 12 - half;
    toolbar.style.left = `${Math.max(minLeft, Math.min(maxLeft, clientX + window.scrollX))}px`;
    if (box.top < 8) {
      toolbar.style.top = `${clientY + 10 + window.scrollY}px`;
    }
  });

  const dismiss = (event: Event) => {
    if (toolbar.contains(event.target as Node)) return;
    toolbar.remove();
    document.removeEventListener('pointerdown', dismiss, true);
    document.removeEventListener('keydown', dismissOnEscape, true);
  };
  const dismissOnEscape = (event: Event) => {
    if ((event as KeyboardEvent).key !== 'Escape') return;
    toolbar.remove();
    document.removeEventListener('pointerdown', dismiss, true);
    document.removeEventListener('keydown', dismissOnEscape, true);
  };
  setTimeout(() => {
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', dismissOnEscape, true);
  }, 0);
}

function ensureMarkdownSelectionToolbarStyles(): void {
  if (document.getElementById('markdown-selection-toolbar-styles')) return;
  const style = document.createElement('style');
  style.id = 'markdown-selection-toolbar-styles';
  style.textContent = `
    .selection-toolbar {
      position: absolute;
      transform: translateX(-50%);
      z-index: 50;
      display: flex;
      gap: 4px;
      padding: 4px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editorWidget-background);
      box-shadow: 0 4px 16px rgba(0,0,0,.3);
      color: var(--vscode-editor-foreground);
      font: 12px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      user-select: none;
    }
    .selection-toolbar button {
      min-width: 24px;
      min-height: 24px;
      border: 0;
      border-radius: 4px;
      padding: 4px 8px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font: inherit;
      white-space: nowrap;
    }
    .selection-toolbar .secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .selection-toolbar .menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      min-width: 160px;
      display: none;
      flex-direction: column;
      gap: 3px;
      padding: 4px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editorWidget-background);
      box-shadow: 0 4px 16px rgba(0,0,0,.3);
    }
    .selection-toolbar .menu.open { display: flex; }
  `;
  document.head.appendChild(style);
}

interface LookupRequest {
  text: string;
  from: number;
  to: number;
}

function lookupRequestForSelection(editorView: EditorView): LookupRequest | null {
  const range = editorView.state.selection.main;
  if (range.empty) return null;
  return normalizeLookupRequest(editorView.state.doc, range.from, range.to);
}

function lookupRequestAtEvent(editorView: EditorView, event: MouseEvent): LookupRequest | null {
  const position = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position == null) return null;
  return lookupRequestAtPosition(editorView.state.doc, position);
}

function lookupRequestAtPosition(doc: Text, position: number): LookupRequest | null {
  const line = doc.lineAt(position);
  let from = position;
  let to = position;
  while (from > line.from && isLookupWordCharacter(doc.sliceString(from - 1, from))) {
    from -= 1;
  }
  while (to < line.to && isLookupWordCharacter(doc.sliceString(to, to + 1))) {
    to += 1;
  }
  return normalizeLookupRequest(doc, from, to);
}

function normalizeLookupRequest(doc: Text, from: number, to: number): LookupRequest | null {
  let start = Math.max(0, Math.min(from, to));
  let end = Math.min(doc.length, Math.max(from, to));
  while (start < end && /\s/.test(doc.sliceString(start, start + 1))) start += 1;
  while (end > start && /\s/.test(doc.sliceString(end - 1, end))) end -= 1;
  if (end <= start) return null;
  const text = doc.sliceString(start, end).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return {
    text: text.slice(0, 200),
    from: start,
    to: end,
  };
}

function isLookupWordCharacter(character: string): boolean {
  return /^[A-Za-z0-9_'’-]$/.test(character);
}

interface SelectedDelimiters {
  leftFrom: number;
  leftTo: number;
  rightFrom: number;
  rightTo: number;
}

interface EnclosingDelimiters {
  leftFrom: number;
  leftTo: number;
  contentFrom: number;
  rightFrom: number;
  rightTo: number;
}

interface DisplayMathBlock {
  startLine: number;
  endLine: number;
  from: number;
  to: number;
}

function findDisplayMathBlock(
  doc: EditorView['state']['doc'],
  position: number,
): DisplayMathBlock | null {
  const line = doc.lineAt(position);
  for (let startLine = line.number; startLine >= 1; startLine--) {
    const opening = doc.line(startLine);
    if (!isDisplayMathDelimiterLine(opening.text)) continue;

    for (let endLine = startLine + 1; endLine <= doc.lines; endLine++) {
      const closing = doc.line(endLine);
      if (!isDisplayMathDelimiterLine(closing.text)) continue;
      if (line.number >= startLine && line.number <= endLine) {
        return {
          startLine,
          endLine,
          from: opening.from,
          to: closing.to,
        };
      }
      break;
    }
  }
  return null;
}

function isDisplayMathDelimiterLine(text: string): boolean {
  return /^\s*\$\$\s*$/.test(text);
}

function findSelectedDelimiters(
  text: string,
  left: string,
  right: string,
): SelectedDelimiters | null {
  const rightFrom = text.length - right.length;
  if (
    rightFrom < left.length
    || !isDelimiterAt(text, 0, left)
    || !isDelimiterAt(text, rightFrom, right)
  ) {
    return null;
  }
  return {
    leftFrom: 0,
    leftTo: left.length,
    rightFrom,
    rightTo: text.length,
  };
}

function findEnclosingDelimiters(
  doc: EditorView['state']['doc'],
  position: number,
  left: string,
  right: string,
): EnclosingDelimiters | null {
  const line = doc.lineAt(position);
  const cursor = position - line.from;
  const text = line.text;
  for (let leftIndex = cursor - left.length; leftIndex >= 0; leftIndex--) {
    if (!isDelimiterAt(text, leftIndex, left)) continue;
    const contentFrom = leftIndex + left.length;
    if (cursor < contentFrom) continue;

    for (let rightIndex = Math.max(cursor, contentFrom); rightIndex <= text.length - right.length; rightIndex++) {
      if (!isDelimiterAt(text, rightIndex, right)) continue;
      if (rightIndex < cursor) continue;
      return {
        leftFrom: line.from + leftIndex,
        leftTo: line.from + contentFrom,
        contentFrom: line.from + contentFrom,
        rightFrom: line.from + rightIndex,
        rightTo: line.from + rightIndex + right.length,
      };
    }
  }
  return null;
}

function isDelimiterAt(text: string, index: number, delimiter: string): boolean {
  if (index < 0 || !text.startsWith(delimiter, index)) return false;
  if (delimiter === '*') {
    return text[index - 1] !== '*' && text[index + 1] !== '*';
  }
  if (delimiter === '`') {
    return text[index - 1] !== '`' && text[index + 1] !== '`';
  }
  return true;
}

function toggleChecklistStatus(editorView: EditorView): boolean {
  const lineNumbers = selectedLineNumbers(editorView);
  const changes: { from: number; to?: number; insert: string }[] = [];

  for (const lineNumber of lineNumbers) {
    const line = editorView.state.doc.line(lineNumber);
    const checklist = line.text.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([^\]])(\]\s*)/);
    if (checklist) {
      const statusFrom = line.from + checklist[1]!.length;
      changes.push({
        from: statusFrom,
        to: statusFrom + 1,
        insert: isCheckedTaskStatus(checklist[2]!) ? ' ' : 'x',
      });
      continue;
    }

    const list = line.text.match(/^(\s*(?:[-*+]|\d+[.)])\s+)/);
    if (list) {
      changes.push({ from: line.from + list[1]!.length, insert: '[ ] ' });
      continue;
    }

    changes.push({ from: line.from, insert: '- [ ] ' });
  }

  editorView.dispatch({ changes });
  editorView.focus();
  return true;
}

function selectedLineNumbers(editorView: EditorView): number[] {
  const lineNumbers = new Set<number>();
  for (const range of editorView.state.selection.ranges) {
    const start = editorView.state.doc.lineAt(range.from).number;
    const endLine = editorView.state.doc.lineAt(range.to);
    const end = !range.empty && range.to === endLine.from && endLine.number > start
      ? endLine.number - 1
      : endLine.number;
    for (let line = start; line <= end; line++) lineNumbers.add(line);
  }
  return [...lineNumbers].sort((a, b) => a - b);
}

function indentListItems(editorView: EditorView): boolean {
  return shiftSelectedListItems(editorView, 'indent');
}

function outdentListItems(editorView: EditorView): boolean {
  return shiftSelectedListItems(editorView, 'outdent');
}

function indentCodeOrListItems(editorView: EditorView): boolean {
  return shiftSelectedFencedCodeLines(editorView, 'indent') || indentListItems(editorView);
}

function outdentCodeOrListItems(editorView: EditorView): boolean {
  return shiftSelectedFencedCodeLines(editorView, 'outdent') || outdentListItems(editorView);
}

function shiftSelectedFencedCodeLines(editorView: EditorView, direction: 'indent' | 'outdent'): boolean {
  const lineNumbers = selectedLineNumbers(editorView);
  if (!lineNumbers.every(lineNumber => isLineInsideFencedCodeContent(editorView.state.doc, lineNumber))) {
    return false;
  }

  const changes: { from: number; to?: number; insert: string }[] = [];
  for (const lineNumber of lineNumbers) {
    const line = editorView.state.doc.line(lineNumber);
    if (direction === 'indent') {
      changes.push({ from: line.from, insert: '    ' });
      continue;
    }

    if (line.text.startsWith('\t')) {
      changes.push({ from: line.from, to: line.from + 1, insert: '' });
      continue;
    }

    const spacesToRemove = line.text.match(/^ {1,4}/)?.[0].length ?? 0;
    if (spacesToRemove > 0) {
      changes.push({ from: line.from, to: line.from + spacesToRemove, insert: '' });
    }
  }

  if (changes.length === 0) return false;
  editorView.dispatch({ changes });
  editorView.focus();
  return true;
}

function isLineInsideFencedCodeContent(doc: Text, targetLine: number): boolean {
  let fence: string | null = null;

  for (let lineNumber = 1; lineNumber <= targetLine; lineNumber++) {
    const line = doc.line(lineNumber);
    if (fence) {
      if (isCodeFenceClosing(line.text, fence)) {
        if (lineNumber === targetLine) return false;
        fence = null;
        continue;
      }
      if (lineNumber === targetLine) return true;
      continue;
    }

    const opening = parseCodeFenceOpening(line.text);
    if (!opening) continue;
    if (lineNumber === targetLine) return false;
    fence = opening.marker;
  }

  return false;
}

function shiftSelectedListItems(editorView: EditorView, direction: 'indent' | 'outdent'): boolean {
  const changes: { from: number; to?: number; insert: string }[] = [];

  for (const lineNumber of selectedLineNumbers(editorView)) {
    const line = editorView.state.doc.line(lineNumber);
    const list = line.text.match(/^(\s*)(?:[-*+]|\d+[.)])\s/);
    if (!list) continue;

    if (direction === 'indent') {
      changes.push({ from: line.from, insert: '  ' });
      continue;
    }

    const remove = listOutdentColumnCount(line.text);
    if (remove > 0) {
      changes.push({ from: line.from, to: line.from + remove, insert: '' });
    }
  }

  if (changes.length === 0) return false;
  editorView.dispatch({ changes });
  editorView.focus();
  return true;
}

function isCheckedTaskStatus(status: string): boolean {
  return status !== ' ';
}

function outdentNestedListItemOnBackspace(editorView: EditorView): boolean {
  const selection = editorView.state.selection.main;
  if (!selection.empty) return false;

  const line = editorView.state.doc.lineAt(selection.from);
  const list = line.text.match(/^(\s+)((?:[-*+]|\d+[.)])\s+(?:\[[^\]]\]\s*)?)/);
  if (!list) return false;

  const markerEnd = line.from + list[0]!.length;
  if (selection.from !== markerEnd) return false;

  const remove = listOutdentColumnCount(line.text);
  if (remove === 0) return false;

  editorView.dispatch({
    changes: { from: line.from, to: line.from + remove, insert: '' },
    selection: { anchor: selection.from - remove },
  });
  editorView.focus();
  return true;
}

function handleObsidianListBackspace(editorView: EditorView): boolean {
  return outdentNestedListItemOnBackspace(editorView)
    || removeTaskCheckboxOnBackspace(editorView);
}

function handleObsidianEnter(editorView: EditorView): boolean {
  return continueOrExitOrderedTaskOnEnter(editorView)
    || exitEmptyBlockquote(editorView);
}

function continueOrExitOrderedTaskOnEnter(editorView: EditorView): boolean {
  const selection = editorView.state.selection.main;
  if (!selection.empty) return false;

  const line = editorView.state.doc.lineAt(selection.from);
  if (selection.from !== line.to) return false;

  const task = line.text.match(/^(\s*)(\d+)([.)])\s+\[([^\]])\]\s*(.*)$/);
  if (!task) return false;

  const content = task[5] ?? '';
  if (content.trim().length === 0) {
    const from = line.number === 1 ? line.from : line.from - 1;
    editorView.dispatch({
      changes: { from, to: line.to, insert: '' },
      selection: { anchor: from },
    });
    editorView.focus();
    return true;
  }

  const indent = task[1] ?? '';
  const nextNumber = Number.parseInt(task[2]!, 10) + 1;
  const delimiter = task[3] ?? '.';
  const marker = `\n${indent}${nextNumber}${delimiter} [ ] `;
  editorView.dispatch({
    changes: { from: selection.from, insert: marker },
    selection: { anchor: selection.from + marker.length },
  });
  editorView.focus();
  return true;
}

function removeTaskCheckboxOnBackspace(editorView: EditorView): boolean {
  const selection = editorView.state.selection.main;
  if (!selection.empty) return false;

  const line = editorView.state.doc.lineAt(selection.from);
  const task = line.text.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(\[[^\]]\]\s+)/);
  if (!task) return false;

  const listMarkerEnd = line.from + task[1]!.length;
  const taskMarkerEnd = listMarkerEnd + task[2]!.length;
  if (selection.from !== taskMarkerEnd) return false;

  editorView.dispatch({
    changes: { from: listMarkerEnd, to: taskMarkerEnd, insert: '' },
    selection: { anchor: listMarkerEnd },
  });
  editorView.focus();
  return true;
}

function listOutdentColumnCount(lineText: string): number {
  const list = lineText.match(/^(\s+)((?:[-*+]|\d+[.)])\s+)/);
  if (!list) return 0;

  const leadingSpaces = list[1] ?? '';
  const marker = list[2] ?? '';
  const markerWidth = /^\d+[.)]\s+$/.test(marker) ? marker.length : 2;
  return Math.min(markerWidth, leadingSpaces.length);
}

function insertTable(editorView: EditorView): boolean {
  const table = [
    '| Column 1 | Column 2 |',
    '| --- | --- |',
    '|  |  |',
  ].join('\n');
  editorView.dispatch(editorView.state.replaceSelection(table));
  editorView.focus();
  return true;
}

function insertHorizontalRule(editorView: EditorView): boolean {
  const selection = editorView.state.selection.main;
  const line = editorView.state.doc.lineAt(selection.from);
  const prefix = line.text.trim() ? '\n\n' : '';
  editorView.dispatch(editorView.state.replaceSelection(`${prefix}---\n`));
  editorView.focus();
  return true;
}

function exitEmptyBlockquote(editorView: EditorView): boolean {
  const selection = editorView.state.selection.main;
  if (!selection.empty) return false;

  const line = editorView.state.doc.lineAt(selection.from);
  const quoteLine = line.text.match(/^(\s*)((?:>\s*)+)$/);
  if (!quoteLine) return false;

  const quoteDepth = quoteLine[2]!.match(/>/g)?.length ?? 0;
  const replacement = quoteDepth > 1
    ? `${quoteLine[1] ?? ''}${'> '.repeat(quoteDepth - 1)}`
    : '';

  editorView.dispatch({
    changes: { from: line.from, to: line.to, insert: replacement },
    selection: { anchor: line.from + replacement.length },
  });
  editorView.focus();
  return true;
}

function setHeading(editorView: EditorView, level: number): boolean {
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const lineNumber of selectedLineNumbers(editorView)) {
    const line = editorView.state.doc.line(lineNumber);
    const previousLine = lineNumber > 1 ? editorView.state.doc.line(lineNumber - 1).text : undefined;
    if (setextHeadingLevelForLines(previousLine ?? '', line.text) != null) continue;

    const heading = line.text.match(/^(#{1,6})\s+/);
    const setextLevel = lineNumber < editorView.state.doc.lines
      ? setextHeadingLevelForLines(line.text, editorView.state.doc.line(lineNumber + 1).text)
      : null;
    const contentFrom = heading ? line.from + heading[0].length : line.from;
    const atxLevel = heading ? heading[1]!.length : null;
    const currentLevel = atxLevel ?? setextLevel;
    const nextPrefix = level > 0 && currentLevel !== level ? `${'#'.repeat(level)} ` : '';
    changes.push({
      from: line.from,
      to: contentFrom,
      insert: nextPrefix,
    });
    if (setextLevel != null) {
      const underlineLine = editorView.state.doc.line(lineNumber + 1);
      changes.push({
        from: underlineLine.from,
        to: underlineLine.to < editorView.state.doc.length ? underlineLine.to + 1 : underlineLine.to,
        insert: '',
      });
    }
  }
  editorView.dispatch({ changes });
  editorView.focus();
  return true;
}

function followLinkAtCursor(editorView: EditorView): boolean {
  const cursor = editorView.state.selection.main.head;
  return followLinkAtPosition(editorView, cursor);
}

function insertMarkdownPunctuationFromVimAction(cm: CodeMirrorV, text: '[' | '-'): void {
  const editorView = cm.cm6;
  editorView.dispatch(editorView.state.changeByRange(range => ({
    changes: { from: range.from, to: range.to, insert: text },
    range: EditorSelection.cursor(range.from + text.length),
  })), { scrollIntoView: true });
  enterVimInsertMode(cm);
  scheduleWikiLinkCompletion(editorView);
}

function handleControlO(editorView: EditorView): boolean {
  editorView.focus();
  return true;
}

function ensureVimInsertMode(editorView: EditorView): void {
  if (!vimModeEnabled) return;
  if (enterVimInsertModeForView(editorView)) return;

  queueMicrotask(() => {
    if (vimModeEnabled) enterVimInsertModeForView(editorView);
  });
}

function enterVimInsertModeForView(editorView: EditorView): boolean {
  const cm = getCM(editorView) as CodeMirrorV | null;
  if (!cm?.state.vim) return false;
  editorView.focus();
  enterVimInsertMode(cm);
  return true;
}

function enterVimInsertMode(cm: CodeMirrorV): void {
  if (cm.state.vim.insertMode) return;
  Vim.handleKey(cm, 'i', 'keyboard');
}

function wikiLinkCompletionSource(context: CompletionContext): CompletionResult | null {
  const openWikiLink = openWikiLinkBeforePosition(context.state, context.pos);
  if (!openWikiLink) return null;

  const options = wikiLinkCompletionOptions();
  if (options.length === 0) return null;

  return {
    from: openWikiLink.from,
    to: context.pos,
    options,
    validFor: /^[^\]\|\n]*$/,
  };
}

function openWikiLinkBeforePosition(state: EditorState, position: number): { from: number } | null {
  const line = state.doc.lineAt(position);
  const beforeCursor = line.text.slice(0, position - line.from);
  const openerIndex = beforeCursor.lastIndexOf('[[');
  if (openerIndex < 0) return null;
  if (openerIndex > 0 && beforeCursor[openerIndex - 1] === '!') return null;

  const query = beforeCursor.slice(openerIndex + 2);
  if (query.includes(']') || query.includes('|') || query.includes('\n')) return null;

  return { from: line.from + openerIndex + 2 };
}

function scheduleWikiLinkCompletion(editorView: EditorView): void {
  if (wikiLinkCompletionPending) return;
  wikiLinkCompletionPending = true;
  queueMicrotask(() => {
    wikiLinkCompletionPending = false;
    if (!openWikiLinkBeforePosition(editorView.state, editorView.state.selection.main.head)) return;
    if (wikiLinkCompletionOptions().length === 0) return;
    startCompletion(editorView);
  });
}

function wikiLinkCompletionOptions(): Completion[] {
  const labels = new Set<string>();
  for (const notePath of knownNotePaths) {
    const label = wikiNoteLabelFromTarget(notePath);
    if (label.length === 0) continue;
    labels.add(label);
  }

  return [...labels]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(label => ({
      label,
      type: 'text',
      apply: (editorView: EditorView, _completion: Completion, from: number, to: number) => {
        const closingAlreadyPresent = editorView.state.doc.sliceString(to, Math.min(to + 2, editorView.state.doc.length)) === ']]';
        const insert = closingAlreadyPresent ? label : `${label}]]`;
        editorView.dispatch({
          changes: { from, to, insert },
          selection: EditorSelection.cursor(from + label.length + 2),
          scrollIntoView: true,
        });
      },
    }));
}

function followLinkAtPosition(editorView: EditorView, position: number): boolean {
  const line = editorView.state.doc.lineAt(position);
  const offset = position - line.from;
  const referenceDefinitions = markdownReferenceDefinitions(editorView.state.doc.toString());
  const target = findLinkTarget(line.text, offset, referenceDefinitions);
  if (!target) return false;
  vscode.postMessage({ type: 'openUri', uri: target });
  return true;
}

function handleModifiedLinkClick(event: MouseEvent, editorView: EditorView): boolean {
  if (event.button !== 0 || (!event.metaKey && !event.ctrlKey)) return false;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.closest('.cm-active-link-label')) return false;
  const position = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position == null) return false;
  const followed = followLinkAtPosition(editorView, position);
  if (!followed) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

function postCopyTextToHost(text: string): void {
  vscode.postMessage({ type: 'copyText', text });
}

function findLinkTarget(
  text: string,
  offset: number,
  referenceDefinitions: ReturnType<typeof markdownReferenceDefinitions>,
): string | null {
  for (const link of markdownLinkSourceSpans(0, text)) {
    if (link.image) continue;
    if (offset < link.from || offset > link.to) continue;
    return parseMarkdownLinkDestination(link.destination);
  }

  for (const link of markdownReferenceLinkSourceSpans(0, text, referenceDefinitions)) {
    if (link.image) continue;
    if (offset < link.from || offset > link.to) continue;
    return link.definition.destination;
  }

  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (offset < from || offset > to) continue;
    return parseWikiLinkTarget(match[1] ?? '', currentNotePath, knownNotePaths)?.uri ?? null;
  }

  for (const match of autolinkMatches(text)) {
    if (offset < match.from || offset > match.to) continue;
    return match.uri;
  }

  return null;
}

window.addEventListener('message', event => {
  const message = event.data;
  switch (message?.type) {
    case 'setText': {
      if (typeof message.text !== 'string') return;
      const documentTitle = typeof message.title === 'string' ? message.title : undefined;
      currentNotePath = typeof message.currentNotePath === 'string' ? message.currentNotePath : undefined;
      knownNotePaths = Array.isArray(message.notePaths)
        ? message.notePaths.filter((path: unknown): path is string => typeof path === 'string')
        : [];
      setImageResourceContext({
        baseUri: typeof message.resourceBaseUri === 'string' ? message.resourceBaseUri : undefined,
        rootUri: typeof message.resourceRootUri === 'string' ? message.resourceRootUri : undefined,
      });
      if (!view) {
        view = createView(message.text, documentTitle);
        return;
      }

      const current = view.state.doc.toString();
      if (current === message.text) {
        if (documentTitle !== undefined) {
          view.dispatch({ effects: setDocumentTitle.of(documentTitle) });
        }
        return;
      }
      applyingHostUpdate = true;
      const selection = preserveSelectionByLineAndColumn(view.state, message.text);
      view.dispatch({
        changes: { from: 0, to: current.length, insert: message.text },
        selection,
        effects: documentTitle === undefined ? undefined : setDocumentTitle.of(documentTitle),
      });
      applyingHostUpdate = false;
      break;
    }

    case 'insertText': {
      if (!view || typeof message.text !== 'string') return;
      const current = view.state.doc.toString();
      const result = applyInsertText(
        current,
        view.state.selection.ranges.map(range => ({ from: range.from, to: range.to })),
        message.text,
      );
      const selections = result.cursorPositions.map(position => EditorSelection.cursor(position));
      view.dispatch({
        changes: { from: 0, to: current.length, insert: result.text },
        selection: EditorSelection.create(selections, selections.length - 1),
        scrollIntoView: true,
      });
      view.focus();
      break;
    }

    case 'executeCommand': {
      if (!view || typeof message.command !== 'string') return;
      obsidianLikeCommands[message.command]?.(view);
      break;
    }

    case 'focus':
      if (!view) return;
      queueInitialFocus(view);
      break;

    case 'updateSettings':
      applyEditorPresentationSettings(message.settings);
      break;

    case 'setVimMode':
      if (typeof message.enabled !== 'boolean') return;
      vimModeEnabled = message.enabled;
      if (!view) return;
      applyVimMode(view, message.enabled);
      break;

    case 'revealPosition':
      if (!view) return;
      if (typeof message.anchor !== 'number' || typeof message.head !== 'number') return;
      view.dispatch({
        selection: EditorSelection.range(message.anchor, message.head),
        scrollIntoView: true,
      });
      view.focus();
      ensureVimInsertMode(view);
      break;
  }
});

window.addEventListener('error', event => {
  vscode.postMessage({ type: 'error', message: String(event.message) });
});

vscode.postMessage({ type: 'ready' });
(window as MarkdownEditorTestWindow).__hlCommands = obsidianLikeCommands;
(window as MarkdownEditorTestWindow).__hlVimModeEnabled = () => vimModeEnabled;

function applyEditorPresentationSettings(settings: unknown): void {
  const style = document.documentElement.style;
  const nextSettings = settings as EditorPresentationSettings | undefined;
  for (const [key, cssVariable] of Object.entries(editorSettingToCssVariable) as [keyof EditorPresentationSettings, string][]) {
    const value = nextSettings?.[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      style.setProperty(cssVariable, value);
      continue;
    }
    style.removeProperty(cssVariable);
  }
}

interface LineColumn {
  line: number;
  column: number;
}

interface SelectionLineColumnRange {
  anchor: LineColumn;
  head: LineColumn;
}

function preserveSelectionByLineAndColumn(state: EditorState, nextText: string): EditorSelection {
  const ranges = state.selection.ranges.map(range => ({
    anchor: documentPositionToLineColumn(state.doc, range.anchor),
    head: documentPositionToLineColumn(state.doc, range.head),
  }));
  return restoreSelectionByLineAndColumn(nextText, ranges, state.selection.mainIndex);
}

function documentPositionToLineColumn(doc: Text, position: number): LineColumn {
  const line = doc.lineAt(position);
  return {
    line: line.number,
    column: position - line.from,
  };
}

function restoreSelectionByLineAndColumn(
  text: string,
  ranges: SelectionLineColumnRange[],
  mainIndex: number,
): EditorSelection {
  const lineStarts = lineStartOffsets(text);
  const selectionRanges = ranges.length > 0
    ? ranges.map(range => EditorSelection.range(
      lineColumnToDocumentPosition(text, lineStarts, range.anchor),
      lineColumnToDocumentPosition(text, lineStarts, range.head),
    ))
    : [EditorSelection.cursor(0)];
  return EditorSelection.create(
    selectionRanges,
    Math.min(Math.max(0, mainIndex), selectionRanges.length - 1),
  );
}

function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function lineColumnToDocumentPosition(
  text: string,
  lineStarts: number[],
  location: LineColumn,
): number {
  const lineIndex = Math.min(Math.max(1, location.line), lineStarts.length) - 1;
  const lineStart = lineStarts[lineIndex] ?? 0;
  const nextLineStart = lineStarts[lineIndex + 1];
  const lineEnd = nextLineStart === undefined ? text.length : nextLineStart - 1;
  return lineStart + Math.min(Math.max(0, location.column), Math.max(0, lineEnd - lineStart));
}

function applyVimMode(editorView: EditorView, enabled: boolean): void {
  vimModeEnabled = enabled;
  editorView.dispatch({
    effects: vimModeCompartment.reconfigure(enabled ? [vim()] : []),
  });
  editorView.focus();
  ensureVimInsertMode(editorView);
}

function buildDecorations(view: EditorView): DecorationSet {
  if (!isHybridPreviewEnabled(view.state)) return Decoration.none;

  const decorations: Range<Decoration>[] = [];
  const activeLines = getActiveLines(view);
  const activeSelectionRanges = getActiveSelectionRanges(view);
  const referenceDefinitions = markdownReferenceDefinitions(view.state.doc.toString());

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (isLineInsideFencedCodeBlock(view.state.doc, line.number)) {
        pos = line.to + 1;
        continue;
      }
      if (activeLines.has(line.number)) {
        collectActiveLineDecorations(line.from, line.text, referenceDefinitions, activeSelectionRanges, decorations);
      } else {
        collectLineDecorations(line.from, line.text, referenceDefinitions, decorations);
      }
      pos = line.to + 1;
    }
  }

  return Decoration.set(decorations, true);
}

function isLineInsideFencedCodeBlock(doc: Text, targetLine: number): boolean {
  let fence: string | null = null;
  let fenceStartLine = 0;

  for (let lineNumber = 1; lineNumber <= targetLine; lineNumber++) {
    const line = doc.line(lineNumber);
    if (fence) {
      if (isCodeFenceClosing(line.text, fence)) {
        if (targetLine <= lineNumber) return true;
        fence = null;
        fenceStartLine = 0;
      }
      continue;
    }

    const opening = parseCodeFenceOpening(line.text);
    if (!opening) continue;

    fence = opening.marker;
    fenceStartLine = lineNumber;
    if (targetLine === fenceStartLine) return true;
  }

  return fence != null && targetLine >= fenceStartLine;
}

function collectLineDecorations(
  lineFrom: number,
  text: string,
  referenceDefinitions: ReturnType<typeof markdownReferenceDefinitions>,
  decorations: Range<Decoration>[],
): void {
  const occupied: { from: number; to: number }[] = inlineCodeSourceSpans(lineFrom, text);
  let match: RegExpExecArray | null;
  for (const link of markdownLinkSourceSpans(lineFrom, text)) {
    const sourceFrom = link.from;
    const sourceTo = link.to;
    if (occupied.some(span => sourceFrom < span.to && sourceTo > span.from)) continue;
    if (link.image) {
      occupied.push({ from: sourceFrom, to: sourceTo });
      continue;
    }
    const uri = parseMarkdownLinkDestination(link.destination);
    if (!uri) continue;
    decorations.push(Decoration.replace({
      widget: new HlLinkWidget(uri, link.label, sourceFrom, sourceTo),
    }).range(sourceFrom, sourceTo));
    occupied.push({ from: sourceFrom, to: sourceTo });
  }

  for (const link of markdownReferenceLinkSourceSpans(lineFrom, text, referenceDefinitions)) {
    const sourceFrom = link.from;
    const sourceTo = link.to;
    if (occupied.some(span => sourceFrom < span.to && sourceTo > span.from)) continue;
    if (link.image) {
      occupied.push({ from: sourceFrom, to: sourceTo });
      continue;
    }
    decorations.push(Decoration.replace({
      widget: new HlLinkWidget(link.definition.destination, link.label, sourceFrom, sourceTo),
    }).range(sourceFrom, sourceTo));
    occupied.push({ from: sourceFrom, to: sourceTo });
  }

  const wikiLink = /\[\[([^\]]+)\]\]/g;
  while ((match = wikiLink.exec(text)) !== null) {
    const raw = match[0]!;
    const sourceFrom = lineFrom + match.index;
    const sourceTo = sourceFrom + raw.length;
    if (isEscapedAt(text, match.index)) continue;
    if (occupied.some(span => sourceFrom < span.to && sourceTo > span.from)) continue;
    if (match.index > 0 && text[match.index - 1] === '!') {
      occupied.push({ from: sourceFrom, to: sourceTo });
      continue;
    }
    const target = parseWikiLinkTarget(match[1] ?? '', currentNotePath, knownNotePaths);
    if (!target) continue;
    decorations.push(Decoration.replace({
      widget: new HlLinkWidget(target.uri, target.label, sourceFrom, sourceTo),
    }).range(sourceFrom, sourceTo));
    occupied.push({ from: sourceFrom, to: sourceTo });
  }

  for (const link of autolinkMatches(text)) {
    const sourceFrom = lineFrom + link.from;
    const sourceTo = lineFrom + link.to;
    if (occupied.some(span => sourceFrom < span.to && sourceTo > span.from)) continue;
    decorations.push(Decoration.replace({
      widget: new HlLinkWidget(link.uri, link.uri, sourceFrom, sourceTo),
    }).range(sourceFrom, sourceTo));
    occupied.push({ from: sourceFrom, to: sourceTo });
  }
}

function collectActiveLineDecorations(
  lineFrom: number,
  text: string,
  referenceDefinitions: ReturnType<typeof markdownReferenceDefinitions>,
  activeSelectionRanges: { from: number; to: number }[],
  decorations: Range<Decoration>[],
): void {
  const reserved: { from: number; to: number }[] = [];
  const inlineCodeSpans = inlineCodeSourceSpans(lineFrom, text);
  const rawLinkSourceSpans: { from: number; to: number }[] = [];

  addActiveDisplayMathMarks(lineFrom, text, decorations, reserved);

  for (const link of markdownLinkSourceSpans(lineFrom, text)) {
    if (link.image) continue;
    const uri = parseMarkdownLinkDestination(link.destination);
    if (!uri) continue;
    const sourceFrom = link.from;
    const sourceTo = link.to;
    if (inlineCodeSpans.some(span => sourceFrom < span.to && sourceTo > span.from)) continue;
    const from = link.labelFrom;
    const to = link.labelTo;
    decorations.push((isExternalUri(uri) ? activeExternalLinkLabelMark : activeLinkLabelMark).range(from, to));
    reserved.push({ from, to });
    rawLinkSourceSpans.push({ from: sourceFrom, to: sourceTo });
  }

  for (const link of markdownReferenceLinkSourceSpans(lineFrom, text, referenceDefinitions)) {
    if (link.image) continue;
    const sourceFrom = link.from;
    const sourceTo = link.to;
    if (inlineCodeSpans.some(span => sourceFrom < span.to && sourceTo > span.from)) continue;
    const from = link.labelFrom;
    const to = link.labelTo;
    decorations.push((isExternalUri(link.definition.destination) ? activeExternalLinkLabelMark : activeLinkLabelMark).range(from, to));
    reserved.push({ from, to });
    rawLinkSourceSpans.push({ from: sourceFrom, to: sourceTo });
  }

  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    if (isEscapedAt(text, match.index ?? 0)) continue;
    const rawTarget = match[1] ?? '';
    if (rawTarget.trim().length === 0) continue;
    const sourceFrom = lineFrom + (match.index ?? 0);
    const sourceTo = sourceFrom + match[0].length;
    if (inlineCodeSpans.some(span => sourceFrom < span.to && sourceTo > span.from)) continue;
    if ((match.index ?? 0) > 0 && text[(match.index ?? 0) - 1] === '!') continue;
    const target = parseWikiLinkTarget(rawTarget, currentNotePath, knownNotePaths);
    if (!target) continue;
    if (selectionTouchesSource(activeSelectionRanges, sourceFrom, sourceTo)) {
      decorations.push(activeLinkLabelMark.range(sourceFrom, sourceTo));
      reserved.push({ from: sourceFrom, to: sourceTo });
      rawLinkSourceSpans.push({ from: sourceFrom, to: sourceTo });
      continue;
    }
    addActiveWikiLinkDecorations(rawTarget, target.label, sourceFrom, sourceTo, decorations, reserved);
    rawLinkSourceSpans.push({ from: sourceFrom, to: sourceTo });
  }

  addActiveInlineCodeMarks(lineFrom, text, decorations, reserved);
  addActiveFootnoteMarks(lineFrom, text, decorations, reserved);
  addActiveAutolinkMarks(lineFrom, text, decorations, reserved, rawLinkSourceSpans);
  addActiveTagMarks(lineFrom, text, decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /\*\*\*(?=\S)(.+?\S)\*\*\*/g, 3, [activeBoldMark, activeItalicMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /(?<![A-Za-z0-9_])___(?=\S)(.+?\S)___(?![A-Za-z0-9_])/g, 3, [activeBoldMark, activeItalicMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /\*\*(?=\S)(.+?\S)\*\*/g, 2, [activeBoldMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /(?<![A-Za-z0-9_])__(?=\S)(.+?\S)__(?![A-Za-z0-9_])/g, 2, [activeBoldMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /(?<!\*)\*(?=\S)(.+?\S)\*(?!\*)/g, 1, [activeItalicMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /(?<![A-Za-z0-9_])_(?=\S)(.+?\S)_(?![A-Za-z0-9_])/g, 1, [activeItalicMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /~~(?=\S)(.+?\S)~~/g, 2, [activeStrikeMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /==(?=\S)(.+?\S)==/g, 2, [activeHighlightMark], decorations, reserved);
}

interface ActiveWikiLinkDisplayPlan {
  labelRanges: { from: number; to: number }[];
  replacements: { from: number; to: number; text?: string }[];
}

function addActiveWikiLinkDecorations(
  rawTarget: string,
  label: string,
  sourceFrom: number,
  sourceTo: number,
  decorations: Range<Decoration>[],
  reserved: { from: number; to: number }[],
): void {
  const plan = activeWikiLinkDisplayPlan(rawTarget, label, sourceFrom, sourceTo);
  for (const replacement of plan.replacements) {
    if (replacement.from >= replacement.to) continue;
    decorations.push(Decoration.replace({
      widget: replacement.text == null ? undefined : new TextReplacementWidget(replacement.text),
    }).range(replacement.from, replacement.to));
    reserved.push({ from: replacement.from, to: replacement.to });
  }
  for (const range of plan.labelRanges) {
    if (range.from >= range.to) continue;
    decorations.push(activeLinkLabelMark.range(range.from, range.to));
    reserved.push(range);
  }
}

function activeWikiLinkDisplayPlan(
  rawTarget: string,
  label: string,
  sourceFrom: number,
  sourceTo: number,
): ActiveWikiLinkDisplayPlan {
  const innerFrom = sourceFrom + 2;
  const innerTo = sourceTo - 2;
  const aliasSeparator = rawTarget.indexOf('|');
  if (aliasSeparator >= 0) {
    const alias = rawTarget.slice(aliasSeparator + 1);
    const labelIndex = Math.max(0, alias.indexOf(label));
    const labelFrom = innerFrom + aliasSeparator + 1 + labelIndex;
    const labelTo = labelFrom + label.length;
    return {
      labelRanges: [{ from: labelFrom, to: labelTo }],
      replacements: [
        { from: sourceFrom, to: labelFrom },
        { from: labelTo, to: sourceTo },
      ],
    };
  }

  const [noteTarget, headingTarget] = splitOnce(rawTarget, '#');
  const noteLabel = noteTarget.trim().length > 0 ? wikiNoteLabelFromTarget(noteTarget) : undefined;
  const headingLabel = headingTarget?.trim();

  if (noteLabel && headingLabel) {
    const noteStart = rawTarget.lastIndexOf(noteLabel, noteTarget.length);
    const hashIndex = rawTarget.indexOf('#', noteTarget.length);
    const headingStart = rawTarget.indexOf(headingLabel, hashIndex + 1);
    if (noteStart >= 0 && hashIndex >= 0 && headingStart >= 0) {
      const noteFrom = innerFrom + noteStart;
      const noteTo = noteFrom + noteLabel.length;
      const hashFrom = innerFrom + hashIndex;
      const headingFrom = innerFrom + headingStart;
      const headingTo = headingFrom + headingLabel.length;
      return {
        labelRanges: [
          { from: noteFrom, to: noteTo },
          { from: headingFrom, to: headingTo },
        ],
        replacements: [
          { from: sourceFrom, to: noteFrom },
          { from: noteTo, to: hashFrom },
          { from: hashFrom, to: hashFrom + 1, text: ' > ' },
          { from: headingTo, to: sourceTo },
        ],
      };
    }
  }

  const visibleLabel = headingLabel && !noteLabel ? headingLabel : noteLabel ?? label;
  const labelStart = rawTarget.lastIndexOf(visibleLabel);
  if (labelStart >= 0) {
    const labelFrom = innerFrom + labelStart;
    const labelTo = labelFrom + visibleLabel.length;
    return {
      labelRanges: [{ from: labelFrom, to: labelTo }],
      replacements: [
        { from: sourceFrom, to: labelFrom },
        { from: labelTo, to: sourceTo },
      ],
    };
  }

  return {
    labelRanges: [{ from: innerFrom, to: innerTo }],
    replacements: [
      { from: sourceFrom, to: innerFrom },
      { from: innerTo, to: sourceTo },
    ],
  };
}

function wikiNoteLabelFromTarget(noteTarget: string): string {
  const segments = noteTarget
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean);
  const fileName = segments.at(-1) ?? noteTarget.trim();
  return fileName.replace(/\.md$/i, '');
}

function splitOnce(input: string, separator: string): [string, string | undefined] {
  const index = input.indexOf(separator);
  if (index < 0) return [input, undefined];
  return [input.slice(0, index), input.slice(index + separator.length)];
}

function addActiveDisplayMathMarks(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  reserved: { from: number; to: number }[],
): void {
  const singleLine = text.match(/^(\s*)(\$\$)(.+?)(\$\$)(\s*)$/);
  if (singleLine) {
    const leading = singleLine[1]?.length ?? 0;
    const openerFrom = lineFrom + leading;
    const openerTo = openerFrom + 2;
    const sourceFrom = openerTo;
    const sourceTo = sourceFrom + (singleLine[3]?.length ?? 0);
    const closerFrom = sourceTo;
    const closerTo = closerFrom + 2;

    decorations.push(activeMathDelimiterMark.range(openerFrom, openerTo));
    decorations.push(activeMathSourceMark.range(sourceFrom, sourceTo));
    decorations.push(activeMathDelimiterMark.range(closerFrom, closerTo));
    reserved.push({ from: openerFrom, to: closerTo });
    return;
  }

  const delimiterOnly = text.match(/^(\s*)(\$\$)(\s*)$/);
  if (!delimiterOnly) return;

  const from = lineFrom + (delimiterOnly[1]?.length ?? 0);
  const to = from + 2;
  decorations.push(activeMathDelimiterMark.range(from, to));
  reserved.push({ from, to });
}

interface AutolinkMatch {
  from: number;
  to: number;
  uri: string;
}

function autolinkMatches(text: string): AutolinkMatch[] {
  const matches: AutolinkMatch[] = [];
  for (const match of text.matchAll(/<((?:https?|mailto):[^<>\s]+)>/g)) {
    matches.push({
      from: match.index ?? 0,
      to: (match.index ?? 0) + match[0].length,
      uri: match[1] ?? '',
    });
  }

  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>()]+/g)) {
    const from = match.index ?? 0;
    if (from > 0 && text[from - 1] === '<') continue;
    const raw = trimTrailingUrlPunctuation(match[0]);
    if (!raw) continue;
    matches.push({ from, to: from + raw.length, uri: raw });
  }

  return matches.sort((a, b) => a.from - b.from || a.to - b.to);
}

function trimTrailingUrlPunctuation(value: string): string {
  return value.replace(/[),.;:!?]+$/g, '');
}

function addActiveDelimitedMarks(
  lineFrom: number,
  text: string,
  pattern: RegExp,
  delimiterLength: number,
  marks: Decoration[],
  decorations: Range<Decoration>[],
  reserved: { from: number; to: number }[],
): void {
  for (const match of text.matchAll(pattern)) {
    const from = lineFrom + (match.index ?? 0) + delimiterLength;
    const to = from + (match[1] ?? '').length;
    if (isEscapedAt(text, match.index ?? 0) || isEscapedAt(text, to - lineFrom)) continue;
    if (reserved.some(span => from < span.to && to > span.from)) continue;
    for (const mark of marks) {
      decorations.push(mark.range(from, to));
    }
    reserved.push({ from, to });
  }
}

function addActiveInlineCodeMarks(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  reserved: { from: number; to: number }[],
): void {
  for (const span of inlineCodeSourceSpans(lineFrom, text)) {
    const from = span.contentFrom;
    const to = span.contentTo;
    if (reserved.some(span => from < span.to && to > span.from)) continue;
    decorations.push(activeInlineCodeMark.range(from, to));
    reserved.push({ from, to });
  }
}

function addActiveFootnoteMarks(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  reserved: { from: number; to: number }[],
): void {
  const definition = text.match(/^(\s*)\[\^([^\]\s]+)\]:/);
  if (definition && !isEscapedAt(text, definition[1]!.length)) {
    const id = definition[2] ?? '';
    const from = lineFrom + definition[1]!.length + 2;
    const to = from + id.length;
    if (!reserved.some(span => from < span.to && to > span.from)) {
      decorations.push(activeFootnoteDefLabelMark.range(from, to));
      reserved.push({ from, to });
    }
  }

  for (const match of text.matchAll(/\[\^([^\]\s]+)\]/g)) {
    if (isEscapedAt(text, match.index ?? 0)) continue;
    const id = match[1] ?? '';
    const from = lineFrom + (match.index ?? 0) + 2;
    const to = from + id.length;
    if (reserved.some(span => from < span.to && to > span.from)) continue;
    decorations.push(activeFootnoteRefMark.range(from, to));
    reserved.push({ from, to });
  }
}

function addActiveAutolinkMarks(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  reserved: { from: number; to: number }[],
  rawLinkSourceSpans: { from: number; to: number }[],
): void {
  for (const match of autolinkMatches(text)) {
    const from = lineFrom + match.from;
    const to = lineFrom + match.to;
    if (reserved.some(span => from < span.to && to > span.from)) continue;
    if (rawLinkSourceSpans.some(span => from < span.to && to > span.from)) continue;
    decorations.push(activeExternalLinkLabelMark.range(from, to));
    reserved.push({ from, to });
  }
}

function addActiveTagMarks(
  lineFrom: number,
  text: string,
  decorations: Range<Decoration>[],
  reserved: { from: number; to: number }[],
): void {
  for (const match of text.matchAll(obsidianTagPattern())) {
    const from = lineFrom + (match.index ?? 0);
    const to = from + match[0].length;
    if (isEscapedAt(text, match.index ?? 0)) continue;
    if (reserved.some(span => from < span.to && to > span.from)) continue;
    decorations.push(activeTagMark.range(from, to));
    reserved.push({ from, to });
  }
}

function obsidianTagPattern(): RegExp {
  return /(?<![A-Za-z0-9_/#])#(?=[A-Za-z0-9_/-]*[A-Za-z_])(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)/g;
}

function getActiveLines(view: EditorView): Set<number> {
  const active = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const start = view.state.doc.lineAt(range.from).number;
    const end = view.state.doc.lineAt(range.to).number;
    for (let line = start; line <= end; line++) active.add(line);
  }
  return active;
}

function getActiveSelectionRanges(view: EditorView): { from: number; to: number }[] {
  return view.state.selection.ranges.map(range => ({ from: range.from, to: range.to }));
}

function selectionTouchesSource(
  ranges: { from: number; to: number }[],
  sourceFrom: number,
  sourceTo: number,
): boolean {
  return ranges.some(range => {
    if (range.from === range.to) {
      return range.from >= sourceFrom && range.from <= sourceTo;
    }
    return range.from < sourceTo && range.to > sourceFrom;
  });
}

function isExternalUri(uri: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(uri) && !uri.startsWith('hl://');
}
