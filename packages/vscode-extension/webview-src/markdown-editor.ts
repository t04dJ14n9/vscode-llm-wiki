/// <reference path="./vscode.d.ts" />

import { acceptCompletion, autocompletion, completionStatus, startCompletion } from '@codemirror/autocomplete';
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, foldGutter, syntaxHighlighting } from '@codemirror/language';
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
} from '@codemirror/state';
import type { Range, SelectionRange, Text } from '@codemirror/state';
import { search, searchKeymap } from '@codemirror/search';
import { vim, Vim } from '@replit/codemirror-vim';
import type { CodeMirrorV, InputStateInterface, MotionArgs, Pos, vimState } from '@replit/codemirror-vim';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  drawSelection,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { applyInsertText } from './insertText';
import { copySelectionToClipboard, handleCopy, handlePaste } from './markdownClipboard';
import { closeObsidianContextMenu, showObsidianContextMenu } from './obsidianContextMenu';
import { llmWikiHighlightStyle } from './markdownTheme';
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
    readonly relativeToDocument = false,
  ) {
    super();
  }

  override toDOM(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-llm-wiki-link';
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
      vscode.postMessage({
        type: 'openUri',
        uri: this.uri,
        ...(this.relativeToDocument ? { relativeToDocument: true } : {}),
      });
    });
    return button;
  }

  override eq(other: HlLinkWidget): boolean {
    return this.uri === other.uri
      && this.label === other.label
      && this.sourceFrom === other.sourceFrom
      && this.sourceTo === other.sourceTo
      && this.relativeToDocument === other.relativeToDocument;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

interface LearningAnnotation {
  discussionId: string;
  notePath: string;
  quote: string;
  question: string;
  questionCount: number;
  summary: string;
  from?: number;
  to?: number;
}

interface ResolvedLearningAnnotation extends LearningAnnotation {
  from: number;
  to: number;
}

const setLearningAnnotations = StateEffect.define<readonly LearningAnnotation[]>();

class LearningNoteWidget extends WidgetType {
  constructor(readonly annotation: LearningAnnotation) {
    super();
  }

  override toDOM(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-learning-note-link';
    button.dataset.learningDiscussionId = this.annotation.discussionId;
    button.textContent = '✦ Note';
    button.setAttribute(
      'aria-label',
      `Open learning note: ${this.annotation.question || this.annotation.summary || this.annotation.notePath}`,
    );
    const stopSelection = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    button.addEventListener('pointerdown', stopSelection);
    button.addEventListener('mousedown', stopSelection);
    button.addEventListener('click', event => {
      stopSelection(event);
      vscode.postMessage({
        type: 'openLearningNote',
        notePath: this.annotation.notePath,
        discussionId: this.annotation.discussionId,
      });
    });
    return button;
  }

  override eq(other: LearningNoteWidget): boolean {
    return other.annotation.discussionId === this.annotation.discussionId
      && other.annotation.notePath === this.annotation.notePath
      && other.annotation.question === this.annotation.question
      && other.annotation.questionCount === this.annotation.questionCount
      && other.annotation.summary === this.annotation.summary;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const learningAnnotationField = StateField.define<readonly ResolvedLearningAnnotation[]>({
  create: () => [],
  update(annotations, transaction) {
    let next = annotations.flatMap(annotation => {
      const from = transaction.changes.mapPos(annotation.from, 1);
      const to = transaction.changes.mapPos(annotation.to, -1);
      return to > from ? [{ ...annotation, from, to }] : [];
    });
    for (const effect of transaction.effects) {
      if (effect.is(setLearningAnnotations)) {
        next = resolveLearningAnnotations(transaction.state.doc, effect.value);
      }
    }
    return next;
  },
  provide: field => EditorView.decorations.from(field, buildLearningAnnotationDecorations),
});

function resolveLearningAnnotations(
  doc: Text,
  annotations: readonly LearningAnnotation[],
): ResolvedLearningAnnotation[] {
  const text = doc.toString();
  const resolved: ResolvedLearningAnnotation[] = [];
  for (const annotation of annotations) {
    let from = annotation.from;
    let to = annotation.to;
    if (
      from === undefined
      || to === undefined
      || from < 0
      || to <= from
      || to > text.length
      || (annotation.quote && text.slice(from, to) !== annotation.quote)
    ) {
      const match = annotation.quote ? text.indexOf(annotation.quote) : -1;
      if (match < 0) continue;
      from = match;
      to = match + annotation.quote.length;
    }
    resolved.push({ ...annotation, from, to });
  }
  return resolved;
}

function buildLearningAnnotationDecorations(
  annotations: readonly ResolvedLearningAnnotation[],
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const annotation of annotations) {
    ranges.push(
      Decoration.mark({
        class: 'cm-learning-annotation',
        attributes: {
          'data-learning-discussion-id': annotation.discussionId,
        },
      }).range(annotation.from, annotation.to),
      Decoration.widget({
        widget: new LearningNoteWidget(annotation),
        side: 1,
      }).range(annotation.to),
    );
  }
  return Decoration.set(ranges, true);
}

class LearningAnnotationPopover {
  private readonly popover = document.createElement('div');
  private hoveredDiscussionId: string | undefined;
  private hoverAnchor: HTMLElement | undefined;
  private dismissedDiscussionId: string | undefined;
  private activeAnnotation: ResolvedLearningAnnotation | undefined;
  private lastCaretPosition = -1;
  private positionFrame: number | undefined;

  private readonly onPointerOver = (event: PointerEvent) => {
    const target = learningAnnotationElement(event.target, this.view.dom);
    if (!target) return;
    this.hoveredDiscussionId = target.dataset.learningDiscussionId;
    this.hoverAnchor = target;
    this.dismissedDiscussionId = undefined;
    this.sync();
  };

  private readonly onPointerOut = (event: PointerEvent) => {
    const current = learningAnnotationElement(event.target, this.view.dom);
    if (!current) return;
    const related = learningAnnotationElement(event.relatedTarget, this.view.dom);
    if (
      related
      && related.dataset.learningDiscussionId === current.dataset.learningDiscussionId
    ) {
      this.hoverAnchor = related;
      return;
    }
    this.hoveredDiscussionId = undefined;
    this.hoverAnchor = undefined;
    this.sync();
  };

  private readonly onFocusIn = (event: FocusEvent) => {
    const target = learningAnnotationElement(event.target, this.view.dom);
    if (!target?.classList.contains('cm-learning-note-link')) return;
    this.hoveredDiscussionId = target.dataset.learningDiscussionId;
    this.hoverAnchor = target;
    this.dismissedDiscussionId = undefined;
    this.sync();
  };

  private readonly onFocusOut = (event: FocusEvent) => {
    const current = learningAnnotationElement(event.target, this.view.dom);
    if (!current?.classList.contains('cm-learning-note-link')) return;
    const related = learningAnnotationElement(event.relatedTarget, this.view.dom);
    if (
      related
      && related.dataset.learningDiscussionId === current.dataset.learningDiscussionId
    ) {
      return;
    }
    this.hoveredDiscussionId = undefined;
    this.hoverAnchor = undefined;
    this.sync();
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.activeAnnotation) return;
    this.dismissedDiscussionId = this.activeAnnotation.discussionId;
    this.hoveredDiscussionId = undefined;
    this.hoverAnchor = undefined;
    this.hide();
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly reposition = () => this.schedulePosition();

  constructor(private readonly view: EditorView) {
    this.popover.id = 'cm-learning-note-popover';
    this.popover.className = 'cm-learning-note-popover';
    this.popover.setAttribute('role', 'tooltip');
    this.popover.hidden = true;
    this.view.dom.append(this.popover);
    this.view.dom.addEventListener('pointerover', this.onPointerOver);
    this.view.dom.addEventListener('pointerout', this.onPointerOut);
    this.view.dom.addEventListener('focusin', this.onFocusIn);
    this.view.dom.addEventListener('focusout', this.onFocusOut);
    this.view.dom.addEventListener('keydown', this.onKeyDown, true);
    this.view.scrollDOM.addEventListener('scroll', this.reposition);
    window.addEventListener('resize', this.reposition);
    this.sync();
  }

  update(update: ViewUpdate): void {
    const caretPosition = update.state.selection.main.empty
      ? update.state.selection.main.head
      : -1;
    if (caretPosition !== this.lastCaretPosition) {
      this.dismissedDiscussionId = undefined;
      this.lastCaretPosition = caretPosition;
    }
    if (
      update.docChanged
      || update.selectionSet
      || update.geometryChanged
      || update.transactions.some(transaction =>
        transaction.effects.some(effect => effect.is(setLearningAnnotations))
      )
    ) {
      this.sync();
    }
  }

  destroy(): void {
    this.view.dom.removeEventListener('pointerover', this.onPointerOver);
    this.view.dom.removeEventListener('pointerout', this.onPointerOut);
    this.view.dom.removeEventListener('focusin', this.onFocusIn);
    this.view.dom.removeEventListener('focusout', this.onFocusOut);
    this.view.dom.removeEventListener('keydown', this.onKeyDown, true);
    this.view.scrollDOM.removeEventListener('scroll', this.reposition);
    window.removeEventListener('resize', this.reposition);
    if (this.positionFrame !== undefined) cancelAnimationFrame(this.positionFrame);
    this.popover.remove();
  }

  private sync(): void {
    const annotations = this.view.state.field(learningAnnotationField);
    const hovered = this.hoveredDiscussionId
      ? annotations.find(annotation => annotation.discussionId === this.hoveredDiscussionId)
      : undefined;
    const selection = this.view.state.selection.main;
    const caret = selection.empty
      ? annotations
        .filter(annotation => annotation.from <= selection.head && selection.head < annotation.to)
        .sort((left, right) => (left.to - left.from) - (right.to - right.from))[0]
      : undefined;
    const annotation = hovered ?? caret;
    if (!annotation || annotation.discussionId === this.dismissedDiscussionId) {
      this.hide();
      return;
    }
    this.show(annotation);
  }

  private show(annotation: ResolvedLearningAnnotation): void {
    this.activeAnnotation = annotation;
    const count = Math.max(1, annotation.questionCount);
    const label = count === 1 ? 'Previous question' : `${count} previous questions`;
    const question = annotation.question || 'Previous learning note';
    const summary = annotation.summary || 'No answer recorded yet.';
    this.popover.replaceChildren(
      popoverText('cm-learning-note-popover-label', label),
      popoverText('cm-learning-note-popover-question', question),
      popoverText('cm-learning-note-popover-summary', summary),
      popoverText(
        'cm-learning-note-popover-hint',
        'Open ✦ Note for the full discussion',
      ),
    );
    this.popover.hidden = false;
    this.view.dom.querySelectorAll<HTMLElement>('.cm-learning-note-link').forEach(marker => {
      if (marker.dataset.learningDiscussionId === annotation.discussionId) {
        marker.setAttribute('aria-describedby', this.popover.id);
      } else {
        marker.removeAttribute('aria-describedby');
      }
    });
    this.schedulePosition();
  }

  private hide(): void {
    if (this.positionFrame !== undefined) {
      cancelAnimationFrame(this.positionFrame);
      this.positionFrame = undefined;
    }
    this.activeAnnotation = undefined;
    this.popover.hidden = true;
    this.popover.style.removeProperty('visibility');
    this.view.dom.querySelectorAll<HTMLElement>('.cm-learning-note-link').forEach(marker => {
      marker.removeAttribute('aria-describedby');
    });
  }

  private schedulePosition(): void {
    if (this.positionFrame !== undefined) cancelAnimationFrame(this.positionFrame);
    this.popover.style.visibility = 'hidden';
    this.positionFrame = requestAnimationFrame(() => {
      this.positionFrame = undefined;
      this.position();
    });
  }

  private position(): void {
    if (this.popover.hidden || !this.activeAnnotation) return;
    const selection = this.view.state.selection.main;
    let caret: ReturnType<EditorView['coordsAtPos']> | undefined;
    if (
      selection.empty
      && this.activeAnnotation.from <= selection.head
      && selection.head < this.activeAnnotation.to
    ) {
      try {
        caret = this.view.coordsAtPos(selection.head);
      } catch {
        caret = undefined;
      }
    }
    const anchor = this.hoverAnchor?.isConnected
      ? this.hoverAnchor.getBoundingClientRect()
      : caret ?? learningAnnotationMarker(this.view.dom, this.activeAnnotation.discussionId)
        ?.getBoundingClientRect();
    if (!anchor) {
      this.hide();
      return;
    }
    const gap = 8;
    const bounds = this.popover.getBoundingClientRect();
    const maxLeft = Math.max(gap, window.innerWidth - bounds.width - gap);
    const left = Math.min(Math.max(gap, anchor.left), maxLeft);
    let top = anchor.bottom + gap;
    if (top + bounds.height > window.innerHeight - gap) {
      top = anchor.top - bounds.height - gap;
    }
    top = Math.min(
      Math.max(gap, top),
      Math.max(gap, window.innerHeight - bounds.height - gap),
    );
    this.popover.style.left = `${Math.round(left)}px`;
    this.popover.style.top = `${Math.round(top)}px`;
    this.popover.style.visibility = 'visible';
  }
}

const learningAnnotationPopover = ViewPlugin.fromClass(LearningAnnotationPopover);

function learningAnnotationElement(
  target: EventTarget | null,
  root: HTMLElement,
): HTMLElement | undefined {
  if (!(target instanceof Element)) return undefined;
  const element = target.closest<HTMLElement>('[data-learning-discussion-id]');
  return element && root.contains(element) ? element : undefined;
}

function learningAnnotationMarker(
  root: HTMLElement,
  discussionId: string,
): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-learning-discussion-id]'))
    .find(element => element.dataset.learningDiscussionId === discussionId);
}

function popoverText(className: string, text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
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

const llmWikiLinkRendering = ViewPlugin.fromClass(class {
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
let llmWikiVimMotionsInstalled = false;
let llmWikiVimExCommandsInstalled = false;
let llmWikiVimMarkdownKeysInstalled = false;
let wikiLinkCompletionPending = false;

type EditorCommand = (view: EditorView) => boolean;
type EditorPresentationSettings = Partial<Record<'fontFamily' | 'fontSize' | 'fontWeight' | 'lineHeight' | 'letterSpacing', string>>;
type MarkdownEditorTestWindow = Window & {
  __cmView?: EditorView;
  __llmWikiCommands?: Record<string, EditorCommand>;
  __llmWikiVimModeEnabled?: () => boolean;
};

const editorSettingToCssVariable = {
  fontFamily: '--llm-wiki-editor-font-family',
  fontSize: '--llm-wiki-editor-font-size',
  fontWeight: '--llm-wiki-editor-font-weight',
  lineHeight: '--llm-wiki-editor-line-height',
  letterSpacing: '--llm-wiki-editor-letter-spacing',
} satisfies Record<keyof EditorPresentationSettings, string>;

const vimModeCompartment = new Compartment();
const activeLinkLabelMark = Decoration.mark({ class: 'cm-active-link-label' });
const activeExternalLinkLabelMark = Decoration.mark({ class: 'cm-active-link-label cm-active-external-link' });
const activeLinkDestinationMark = Decoration.mark({ class: 'cm-active-link-destination' });
const activeLinkPunctuationMark = Decoration.mark({ class: 'cm-active-link-punctuation' });
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

function runOutsideVimMode(command: EditorCommand): EditorCommand {
  return editorView => {
    if (vimModeEnabled) {
      restoreEditorFocusAfterShortcut(editorView);
      return true;
    }
    return command(editorView);
  };
}

const consumeInVimMode: EditorCommand = editorView => {
  if (!vimModeEnabled) return false;
  restoreEditorFocusAfterShortcut(editorView);
  return true;
};

function handleVimBacktickKeydown(event: KeyboardEvent, editorView: EditorView): boolean {
  if (!vimModeEnabled || !isPlainBacktickKeydown(event)) return false;
  const state = vimStateForEditorView(editorView);
  if (state?.insertMode) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  restoreEditorFocusAfterShortcut(editorView);
  return true;
}

function handleVimNormalModeBeforeInput(event: InputEvent, editorView: EditorView): boolean {
  if (!vimModeEnabled || !isRawBacktickInsertion(event)) return false;
  const state = vimStateForEditorView(editorView);
  if (state?.insertMode) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  restoreEditorFocusAfterShortcut(editorView);
  return true;
}

function isPlainBacktickKeydown(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  return event.key === '`' || event.code === 'Backquote';
}

function isRawBacktickInsertion(event: InputEvent): boolean {
  return event.inputType === 'insertText'
    && typeof event.data === 'string'
    && /^`+$/.test(event.data);
}

function vimStateForEditorView(editorView: EditorView): { insertMode?: boolean } | undefined {
  return (editorView as unknown as {
    cm?: { state?: { vim?: { insertMode?: boolean } } };
  }).cm?.state?.vim;
}

const nonVimLogicalVerticalMove = Annotation.define<boolean>();
const nonVimVerticalGoalColumns = new WeakMap<EditorView, number>();

const vimBacktickGuard = ViewPlugin.define((editorView: EditorView) => {
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      nonVimVerticalGoalColumns.delete(editorView);
    }
    preserveHeadingTextBoundaryOnVimEscape(event, editorView);
    handleVimBacktickKeydown(event, editorView);
  };
  const beforeinput = (event: Event) => {
    if (event instanceof InputEvent) {
      handleVimNormalModeBeforeInput(event, editorView);
    }
  };
  editorView.dom.addEventListener('keydown', keydown, true);
  editorView.dom.addEventListener('beforeinput', beforeinput, true);
  return {
    update(update: ViewUpdate) {
      const isLogicalVerticalMove = update.transactions.some(transaction => (
        transaction.annotation(nonVimLogicalVerticalMove) === true
      ));
      if ((update.docChanged || update.selectionSet) && !isLogicalVerticalMove) {
        nonVimVerticalGoalColumns.delete(editorView);
      }
    },
    destroy() {
      nonVimVerticalGoalColumns.delete(editorView);
      editorView.dom.removeEventListener('keydown', keydown, true);
      editorView.dom.removeEventListener('beforeinput', beforeinput, true);
    },
  };
});

function preserveHeadingTextBoundaryOnVimEscape(
  event: KeyboardEvent,
  editorView: EditorView,
): void {
  if (!vimModeEnabled || event.key !== 'Escape') return;
  if (!vimStateForEditorView(editorView)?.insertMode) return;

  const selection = editorView.state.selection.main;
  if (!selection.empty) return;
  const line = editorView.state.doc.lineAt(selection.head);
  const heading = /^( {0,3}#{1,6}\s+)/.exec(line.text);
  if (!heading) return;

  const contentFrom = line.from + heading[0].length;
  if (selection.head !== contentFrom) return;

  const restoreBoundary = () => {
    if (vimStateForEditorView(editorView)?.insertMode !== false) return;
    const currentSelection = editorView.state.selection.main;
    if (!currentSelection.empty || currentSelection.head !== contentFrom - 1) return;
    const currentLine = editorView.state.doc.lineAt(currentSelection.head);
    if (currentLine.from !== line.from || currentLine.text !== line.text) return;
    editorView.dispatch({
      selection: EditorSelection.cursor(contentFrom),
      scrollIntoView: true,
    });
  };
  queueMicrotask(restoreBoundary);
  window.setTimeout(restoreBoundary, 0);
}

function restoreEditorFocusAfterShortcut(editorView: EditorView): void {
  editorView.focus();
  window.requestAnimationFrame(() => editorView.focus());
  window.setTimeout(() => editorView.focus(), 0);
}

installLlmWikiVimMotions();
installLlmWikiVimExCommands();
installLlmWikiVimMarkdownKeys();

function installLlmWikiVimMotions(): void {
  if (llmWikiVimMotionsInstalled) return;

  // The upstream Vim motion falls back to visual coordinates when it sees
  // replaced ranges. Hybrid markdown previews deliberately replace inactive
  // source lines, so document-line movement is the behavior we need here.
  Vim.defineMotion('moveByLines', moveByDocumentLines);
  llmWikiVimMotionsInstalled = true;
}

function installLlmWikiVimExCommands(): void {
  if (llmWikiVimExCommandsInstalled) return;

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
  llmWikiVimExCommandsInstalled = true;
}

function installLlmWikiVimMarkdownKeys(): void {
  if (llmWikiVimMarkdownKeysInstalled) return;

  Vim.defineAction('llmWikiInsertOpenBracket', cm => {
    insertMarkdownPunctuationFromVimAction(cm, '[');
  });
  Vim.defineAction('llmWikiInsertDash', cm => {
    insertMarkdownPunctuationFromVimAction(cm, '-');
  });
  Vim.mapCommand('[', 'action', 'llmWikiInsertOpenBracket', {}, { context: 'normal', isEdit: true });
  Vim.mapCommand('-', 'action', 'llmWikiInsertDash', {}, { context: 'normal', isEdit: true });
  llmWikiVimMarkdownKeysInstalled = true;
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
  const editorCaret = 'var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground))';
  const editorView = new EditorView({
    parent: document.getElementById('editor')!,
    state: EditorState.create({
      doc: text,
      selection: initialBodyPosition == null
        ? undefined
        : EditorSelection.cursor(initialBodyPosition),
      extensions: [
        lineNumbers(),
        foldGutter({ openText: '⌄', closedText: '›' }),
        vimBacktickGuard,
        vimModeCompartment.of(vimModeEnabled ? [vim()] : []),
        history(),
        drawSelection(),
        markdown({ codeLanguages: languages }),
        syntaxHighlighting(llmWikiHighlightStyle, { fallback: true }),
        bracketMatching(),
        search({ top: true }),
        autocompletion({
          activateOnTyping: true,
          icons: false,
          interactionDelay: 0,
          override: [wikiLinkCompletionSource],
        }),
        hybridRendering(),
        llmWikiLinkRendering,
        learningAnnotationField,
        learningAnnotationPopover,
        EditorView.baseTheme({
          '.cm-learning-annotation': {
            backgroundColor: 'var(--vscode-editor-wordHighlightStrongBackground, rgba(255, 205, 64, .24))',
            borderBottom: '1px solid var(--vscode-editorInfo-foreground, rgba(255, 205, 64, .9))',
            borderRadius: '2px',
          },
          '.cm-learning-note-link': {
            marginLeft: '5px',
            padding: '1px 5px',
            border: '1px solid var(--vscode-button-border, var(--vscode-widget-border))',
            borderRadius: '9px',
            color: 'var(--vscode-textLink-foreground)',
            background: 'var(--vscode-editorWidget-background)',
            font: '11px var(--vscode-font-family)',
            cursor: 'pointer',
          },
          '.cm-learning-note-popover': {
            position: 'fixed',
            zIndex: '1000',
            boxSizing: 'border-box',
            width: 'min(360px, calc(100vw - 16px))',
            maxHeight: 'min(280px, calc(100vh - 16px))',
            padding: '10px 12px',
            overflow: 'auto',
            border: '1px solid var(--vscode-editorHoverWidget-border, var(--vscode-widget-border))',
            borderRadius: '6px',
            color: 'var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground))',
            background: 'var(--vscode-editorHoverWidget-background, var(--vscode-editorWidget-background))',
            boxShadow: '0 4px 14px var(--vscode-widget-shadow, rgba(0, 0, 0, .3))',
            font: '13px/1.45 var(--vscode-font-family)',
            whiteSpace: 'normal',
            pointerEvents: 'none',
          },
          '.cm-learning-note-popover[hidden]': {
            display: 'none',
          },
          '.cm-learning-note-popover-label': {
            marginBottom: '4px',
            color: 'var(--vscode-descriptionForeground)',
            fontSize: '11px',
            fontWeight: '600',
            letterSpacing: '.02em',
            textTransform: 'uppercase',
          },
          '.cm-learning-note-popover-question': {
            fontWeight: '600',
          },
          '.cm-learning-note-popover-summary': {
            marginTop: '6px',
          },
          '.cm-learning-note-popover-hint': {
            marginTop: '8px',
            color: 'var(--vscode-descriptionForeground)',
            fontSize: '11px',
          },
        }),
        Prec.highest(keymap.of([
          { key: 'Ctrl-o', run: handleControlO, preventDefault: true },
          { key: 'Ctrl-O', run: handleControlO, preventDefault: true },
          { key: 'ArrowUp', run: editorView => moveNonVimCursorByDocumentLine(editorView, -1) },
          { key: 'ArrowDown', run: editorView => moveNonVimCursorByDocumentLine(editorView, 1) },
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
          mouseup(_event, editorView) {
            queueMicrotask(() => syncNativeSelectionToEditorSelection(editorView));
            return false;
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
          { key: 'Mod-o', run: consumeInVimMode, preventDefault: true },
          { key: 'Mod-b', run: runOutsideVimMode(obsidianLikeCommands['editor:toggle-bold']!), preventDefault: true },
          { key: 'Mod-i', run: runOutsideVimMode(obsidianLikeCommands['editor:toggle-italics']!), preventDefault: true },
          { key: 'Mod-Shift-x', run: runOutsideVimMode(obsidianLikeCommands['editor:toggle-strikethrough']!), preventDefault: true },
          { key: 'Mod-c', run: editorView => copySelectionToClipboard(editorView, postCopyTextToHost) },
          { key: 'Mod-`', run: runOutsideVimMode(obsidianLikeCommands['editor:toggle-code']!), preventDefault: true },
          { key: 'Mod-k', run: runOutsideVimMode(obsidianLikeCommands['editor:insert-link']!), preventDefault: true },
          {
            key: 'Mod-l',
            run: editorView => (
              addSelectionToCursorChat(editorView)
              || runOutsideVimMode(obsidianLikeCommands['editor:toggle-checklist-status']!)(editorView)
            ),
            preventDefault: true,
          },
          { key: 'Mod-Enter', run: obsidianLikeCommands['editor:follow-link']!, preventDefault: true },
          { key: 'Alt-Enter', run: obsidianLikeCommands['editor:follow-link']!, preventDefault: true },
          { key: 'Tab', run: indentCodeOrListItems, preventDefault: true },
          { key: 'Shift-Tab', run: outdentCodeOrListItems, preventDefault: true },
          { key: 'Mod-Alt-0', run: runOutsideVimMode(obsidianLikeCommands['editor:set-heading-0']!), preventDefault: true },
          { key: 'Mod-Alt-1', run: runOutsideVimMode(obsidianLikeCommands['editor:set-heading-1']!), preventDefault: true },
          { key: 'Mod-Alt-2', run: runOutsideVimMode(obsidianLikeCommands['editor:set-heading-2']!), preventDefault: true },
          { key: 'Mod-Alt-3', run: runOutsideVimMode(obsidianLikeCommands['editor:set-heading-3']!), preventDefault: true },
          { key: 'Mod-Alt-4', run: runOutsideVimMode(obsidianLikeCommands['editor:set-heading-4']!), preventDefault: true },
          { key: 'Mod-Alt-5', run: runOutsideVimMode(obsidianLikeCommands['editor:set-heading-5']!), preventDefault: true },
          { key: 'Mod-Alt-6', run: runOutsideVimMode(obsidianLikeCommands['editor:set-heading-6']!), preventDefault: true },
          { key: 'Mod-Shift-t', run: runOutsideVimMode(obsidianLikeCommands['editor:insert-table']!), preventDefault: true },
          { key: 'Mod-Shift-h', run: runOutsideVimMode(obsidianLikeCommands['editor:toggle-highlight']!), preventDefault: true },
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
            fontFamily: 'var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
            fontSize: 'var(--llm-wiki-editor-font-size, 16px)',
            fontWeight: 'var(--llm-wiki-editor-font-weight, var(--vscode-editor-font-weight, normal))',
            lineHeight: 'var(--llm-wiki-editor-line-height, 24px)',
            letterSpacing: 'var(--llm-wiki-editor-letter-spacing, normal)',
            caretColor: editorCaret,
          },
          '.cm-scroller': {
            fontFamily: 'inherit',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            lineHeight: 'inherit',
            letterSpacing: 'inherit',
          },
          '.cm-content': {
            padding: '0',
            lineHeight: 'inherit',
            letterSpacing: 'inherit',
            boxSizing: 'border-box',
            flex: '0 0 calc(100% - 160px)',
            maxWidth: 'calc(100% - 160px)',
            minWidth: '0',
            width: 'calc(100% - 160px)',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--vscode-editorGutter-background)',
            color: 'var(--vscode-editorGutter-foreground)',
            borderRight: '0',
            boxSizing: 'border-box',
            minWidth: '66px',
            width: '66px',
            paddingLeft: '18px',
            paddingRight: '8px',
          },
          '.cm-lineNumbers': {
            minWidth: '22px',
            width: '22px',
            color: 'var(--vscode-editorLineNumber-foreground, var(--vscode-editorGutter-foreground))',
            fontFamily: 'var(--vscode-editor-font-family, ui-monospace, Menlo, Monaco, Consolas, monospace)',
            fontSize: 'var(--vscode-editor-font-size, 14px)',
            fontWeight: 'var(--vscode-editor-font-weight, normal)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: 'var(--llm-wiki-editor-letter-spacing, normal)',
          },
          '.cm-foldGutter': {
            minWidth: '18px',
            width: '18px',
            color: 'var(--vscode-editorGutter-foreground)',
          },
          '.cm-foldGutter .cm-gutterElement': {
            boxSizing: 'border-box',
            width: '18px',
            padding: '0',
            textAlign: 'center',
            cursor: 'pointer',
            opacity: '0',
            transition: 'opacity 80ms ease',
          },
          '.cm-foldGutter .cm-gutterElement:hover': {
            opacity: '1',
          },
          '.cm-lineNumbers .cm-gutterElement': {
            boxSizing: 'border-box',
            minWidth: '22px',
            width: '22px',
            height: 'var(--llm-wiki-editor-line-height, 24px)',
            padding: '0',
            lineHeight: 'var(--llm-wiki-editor-line-height, 24px)',
            textAlign: 'right',
            cursor: 'default',
          },
          '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: editorCaret,
          },
          '.cm-vimCursorLayer .cm-fat-cursor': {
            backgroundColor: `${editorCaret} !important`,
            color: 'var(--vscode-editor-background) !important',
          },
          '&:not(.cm-focused) .cm-vimCursorLayer .cm-fat-cursor': {
            background: 'none !important',
            outlineColor: `${editorCaret} !important`,
          },
          '.cm-selectionBackground': {
            backgroundColor: 'var(--vscode-editor-inactiveSelectionBackground, rgba(127, 127, 127, 0.24))',
          },
          '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
            backgroundColor: 'var(--vscode-editor-selectionBackground, rgba(38, 79, 120, 0.65))',
          },
          '.cm-panel.cm-vim-panel': {
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            minHeight: '30px',
            padding: '4px 10px 4px 76px',
            borderTop: '1px solid var(--vscode-panel-border, #3e3e3e)',
            backgroundColor: 'var(--vscode-editorWidget-background, var(--vscode-sideBar-background, #252526))',
            color: 'var(--vscode-editor-foreground)',
            boxShadow: '0 -2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.28))',
            fontFamily: 'var(--llm-wiki-editor-font-family, var(--vscode-editor-font-family, ui-monospace, Menlo, monospace))',
            fontSize: 'var(--llm-wiki-editor-font-size, var(--vscode-editor-font-size, 14px))',
            lineHeight: 'var(--llm-wiki-editor-line-height, 20px)',
          },
          '.cm-panel.cm-vim-panel input': {
            flex: '1 1 auto',
            minWidth: '0',
            height: 'calc(var(--llm-wiki-editor-line-height, 20px) + 2px)',
            margin: '0 0 0 6px',
            padding: '0',
            border: '0',
            outline: 'none',
            appearance: 'none',
            WebkitAppearance: 'none',
            backgroundColor: 'transparent',
            color: 'inherit',
            caretColor: editorCaret,
            font: 'inherit',
          },
          '.cm-panel.cm-vim-panel input::selection': {
            backgroundColor: 'var(--vscode-editor-selectionBackground, rgba(38, 79, 120, 0.65))',
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
            caretColor: editorCaret,
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
          '.cm-llm-wiki-link': {
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
          '.cm-llm-wiki-link:hover': {
            color: 'var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground))',
            backgroundColor: 'transparent',
          },
          '.cm-llm-wiki-link:focus-visible, .cm-active-link-label:focus-visible': {
            outline: '1px solid var(--vscode-contrastBorder, var(--vscode-focusBorder, currentColor))',
            outlineOffset: '1px',
          },
          '.cm-llm-wiki-link.cm-external-link::after': {
            content: '"↗"',
            display: 'inline-block',
            marginLeft: '4px',
            fontSize: '0.8em',
            lineHeight: '1',
            opacity: '0.85',
            verticalAlign: '0.15em',
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
          '.cm-active-link-label:hover': {
            color: 'var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground))',
          },
          '.cm-active-link-destination, .cm-active-link-punctuation': {
            color: 'var(--vscode-descriptionForeground, var(--vscode-editor-foreground))',
            fontWeight: '400',
          },
          '.cm-active-link-destination *, .cm-active-link-punctuation *': {
            color: 'inherit',
            fontWeight: 'inherit',
          },
          '.cm-active-external-link::after': {
            content: '"↗"',
            display: 'inline-block',
            marginLeft: '4px',
            fontSize: '0.8em',
            lineHeight: '1',
            opacity: '0.85',
            verticalAlign: '0.15em',
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
            fontFamily: 'var(--llm-wiki-editor-font-family, var(--vscode-editor-font-family, ui-monospace, Menlo, monospace))',
          },
          '.cm-active-math-delimiter': {
            color: 'var(--vscode-symbolIcon-operatorForeground, var(--vscode-editor-foreground))',
            fontWeight: '600',
          },
          '.cm-active-math-source': {
            color: 'var(--vscode-symbolIcon-variableForeground, var(--vscode-editor-foreground))',
            fontStyle: 'italic',
          },
          '.cm-active-tag': {
            color: 'var(--vscode-textLink-foreground)',
            backgroundColor: 'var(--vscode-editor-wordHighlightBackground, rgba(64, 128, 255, 0.16))',
            borderRadius: '4px',
            padding: '0 4px',
            fontWeight: '500',
          },
          '.cm-active-footnote-ref': {
            color: 'var(--vscode-textLink-foreground)',
            fontSize: '0.78em',
            verticalAlign: 'super',
            lineHeight: '0',
            fontWeight: '600',
          },
          '.cm-active-footnote-def-label': {
            color: 'var(--vscode-textLink-foreground)',
            fontSize: '0.85em',
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
  const postActive = () => {
    vscode.postMessage({ type: 'active' });
  };
  editorView.dom.addEventListener('focusin', postActive);
  editorView.dom.addEventListener('mousedown', postActive, true);
  editorView.dom.addEventListener('keydown', postActive, true);
  editorView.dom.addEventListener('copy', event => {
    handleCopy(event, editorView);
  }, true);
  editorView.dom.addEventListener('llm-wiki-title-rename', event => {
    const nextTitle = (event as CustomEvent<{ title?: unknown }>).detail?.title;
    if (typeof nextTitle === 'string') {
      vscode.postMessage({ type: 'renameTitle', title: nextTitle });
    }
  });
  editorView.dom.addEventListener('llm-wiki-open-uri', event => {
    const detail = (event as CustomEvent<{
      uri?: unknown;
      relativeToDocument?: unknown;
    }>).detail;
    const uri = detail?.uri;
    if (typeof uri === 'string' && uri.length > 0) {
      vscode.postMessage({
        type: 'openUri',
        uri,
        ...(detail.relativeToDocument === true
          ? { relativeToDocument: true }
          : {}),
      });
    }
  });
  editorView.dom.addEventListener('llm-wiki-copy-text', event => {
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
  editorView.scrollDOM.addEventListener('scroll', () => updateCursorSelectionPrompt(editorView), {
    passive: true,
  });
  window.addEventListener('resize', () => updateCursorSelectionPrompt(editorView));
  queueInitialFocus(editorView, { retries: typeof title !== 'string' });
  return editorView;
}

function postSelection(editorView: EditorView): void {
  const selection = editorView.state.selection.main;
  updateCursorSelectionPrompt(editorView);
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
  closeObsidianContextMenu();
  vscode.postMessage({ type: 'lookupSelection', ...lookup });
}

function handleSelectionContextMenu(event: MouseEvent, editorView: EditorView): boolean {
  syncNativeSelectionToEditorSelection(editorView);
  const selection = editorView.state.selection.main;
  if (selection.empty) return false;
  const lookup = lookupRequestForSelection(editorView);
  if (!lookup) return false;

  event.preventDefault();
  event.stopPropagation();
  showMarkdownSelectionContextMenu(editorView, event.clientX, event.clientY);
  return true;
}

function syncNativeSelectionToEditorSelection(editorView: EditorView): void {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  if (
    !editorView.dom.contains(range.startContainer)
    || !editorView.dom.contains(range.endContainer)
  ) {
    return;
  }

  try {
    const anchor = editorView.posAtDOM(selection.anchorNode!, selection.anchorOffset);
    const head = editorView.posAtDOM(selection.focusNode!, selection.focusOffset);
    const current = editorView.state.selection.main;
    if (
      anchor !== head
      && (current.anchor !== anchor || current.head !== head)
    ) {
      editorView.dispatch({ selection: { anchor, head } });
    }
  } catch {
    // Some rendered widgets do not map cleanly back to document positions.
  }
}

function showMarkdownSelectionContextMenu(editorView: EditorView, clientX: number, clientY: number): void {
  const runCommand = (command: string) => {
    obsidianLikeCommands[command]?.(editorView);
  };

  showObsidianContextMenu({
    clientX,
    clientY,
    items: [
      {
        id: 'add-selection-to-cursor-chat',
        label: `${cursorSelectionShortcutLabel()}  Add to Chat`,
        onSelect: () => {
          addSelectionToCursorChat(editorView);
          editorView.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Copy',
        onSelect: () => {
          copySelectionToClipboard(editorView, postCopyTextToHost);
          editorView.focus();
        },
      },
      { type: 'separator' },
      { label: 'Bold', onSelect: () => runCommand('editor:toggle-bold') },
      { label: 'Italic', onSelect: () => runCommand('editor:toggle-italics') },
      { label: 'Strikethrough', onSelect: () => runCommand('editor:toggle-strikethrough') },
      { label: 'Inline code', onSelect: () => runCommand('editor:toggle-code') },
      { label: 'Highlight', onSelect: () => runCommand('editor:toggle-highlight') },
      { label: 'Link', onSelect: () => runCommand('editor:insert-link') },
      { type: 'separator' },
      { label: 'Look Up', onSelect: () => runCommand('editor:lookup-selection') },
    ],
  });
}

function addSelectionToCursorChat(editorView: EditorView): boolean {
  syncNativeSelectionToEditorSelection(editorView);
  const selection = editorView.state.selection.main;
  if (selection.empty) return false;
  vscode.postMessage({ type: 'addSelectionToCursorChat' });
  return true;
}

let cursorSelectionPrompt:
  | { button: HTMLButtonElement; editorView: EditorView }
  | undefined;

function updateCursorSelectionPrompt(editorView: EditorView): void {
  const selection = editorView.state.selection.main;
  if (selection.empty || !editorView.dom.isConnected) {
    cursorSelectionPrompt?.button.remove();
    cursorSelectionPrompt = undefined;
    return;
  }

  if (!cursorSelectionPrompt) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'llm-wiki-cursor-selection-prompt';
    button.setAttribute('aria-label', `Add to Chat ${cursorSelectionShortcutLabel()}`);
    const label = document.createElement('span');
    label.className = 'add-to-chat-label';
    label.textContent = 'Add to Chat';
    const shortcut = document.createElement('span');
    shortcut.className = 'add-to-chat-shortcut';
    shortcut.textContent = cursorSelectionShortcutLabel();
    button.append(label, shortcut);
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const current = cursorSelectionPrompt?.editorView;
      if (current) {
        addSelectionToCursorChat(current);
        current.focus();
      }
    });
    ensureCursorSelectionPromptStyles();
    document.body.appendChild(button);
    cursorSelectionPrompt = { button, editorView };
  } else {
    cursorSelectionPrompt.editorView = editorView;
  }

  const button = cursorSelectionPrompt.button;
  button.style.visibility = 'hidden';
  const forward = selection.head >= selection.anchor;
  const coords = editorView.coordsAtPos(selection.head, forward ? -1 : 1);
  if (!coords) {
    button.remove();
    cursorSelectionPrompt = undefined;
    return;
  }
  const box = button.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - box.width - 8, coords.left - box.width / 2));
  const above = coords.top - box.height - 8;
  const top = above >= 8 ? above : Math.min(window.innerHeight - box.height - 8, coords.bottom + 8);
  button.style.left = `${left}px`;
  button.style.top = `${Math.max(8, top)}px`;
  button.style.visibility = 'visible';
}

function cursorSelectionShortcutLabel(): string {
  return /Mac|iPhone|iPad/u.test(navigator.platform) ? '⌘L' : 'Ctrl+L';
}

function ensureCursorSelectionPromptStyles(): void {
  if (document.getElementById('llm-wiki-cursor-selection-prompt-styles')) return;
  const style = document.createElement('style');
  style.id = 'llm-wiki-cursor-selection-prompt-styles';
  style.textContent = `
    .llm-wiki-cursor-selection-prompt {
      position: fixed;
      z-index: 1000;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 28px;
      padding: 2px 6px 2px 8px;
      border: 1px solid var(--vscode-commandCenter-inactiveBorder, var(--vscode-widget-border, rgba(127, 127, 127, .35)));
      border-radius: 8px;
      background: var(--vscode-editorWidget-background, var(--vscode-editorHoverWidget-background));
      color: var(--vscode-editorWidget-foreground, var(--vscode-editorHoverWidget-foreground));
      box-shadow: 0 6px 18px var(--vscode-inlineChat-shadow, var(--vscode-widget-shadow, rgba(0, 0, 0, .3)));
      font: 12px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      white-space: nowrap;
      cursor: pointer;
    }
    .llm-wiki-cursor-selection-prompt:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, .16));
    }
    .llm-wiki-cursor-selection-prompt:focus-visible {
      outline: 2px solid var(--vscode-focusBorder, #007fd4);
      outline-offset: 1px;
    }
    .llm-wiki-cursor-selection-prompt .add-to-chat-shortcut {
      display: inline-flex;
      align-items: center;
      height: 18px;
      padding: 0 4px;
      border: 0;
      border-radius: 4px;
      background: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, .16));
      color: var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground, inherit));
      font: 11px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    }
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

  const markerEnd = line.from + list[0].length;
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

function moveNonVimCursorByDocumentLine(
  editorView: EditorView,
  direction: -1 | 1,
): boolean {
  if (vimModeEnabled || completionStatus(editorView.state) != null) return false;
  if (document.activeElement !== editorView.contentDOM) return false;
  const selection = editorView.state.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) return false;

  const line = editorView.state.doc.lineAt(selection.main.head);
  const nativeTarget = editorView.moveVertically(selection.main, direction > 0);
  const targetLine = editorView.state.doc.lineAt(nativeTarget.head);
  if (targetLine.number === line.number) return false;
  if (
    !isSingleVisualLine(editorView, selection.main, line.from, line.to)
    || !isSingleVisualLine(editorView, nativeTarget, targetLine.from, targetLine.to)
  ) {
    return false;
  }
  const column = nonVimVerticalGoalColumns.get(editorView)
    ?? selection.main.head - line.from;
  nonVimVerticalGoalColumns.set(editorView, column);
  editorView.dispatch({
    selection: EditorSelection.cursor(targetLine.from + Math.min(column, targetLine.length)),
    scrollIntoView: true,
    annotations: nonVimLogicalVerticalMove.of(true),
  });
  return true;
}

function isSingleVisualLine(
  editorView: EditorView,
  range: SelectionRange,
  lineFrom: number,
  lineTo: number,
): boolean {
  const visualFrom = editorView.moveToLineBoundary(range, false, true).head;
  const visualTo = editorView.moveToLineBoundary(range, true, true).head;
  return visualFrom === lineFrom && visualTo === lineTo;
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
  vscode.postMessage({
    type: 'openUri',
    uri: target.uri,
    ...(target.relativeToDocument ? { relativeToDocument: true } : {}),
  });
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
): { uri: string; relativeToDocument: boolean } | null {
  for (const link of markdownLinkSourceSpans(0, text)) {
    if (link.image) continue;
    if (offset < link.from || offset > link.to) continue;
    const uri = parseMarkdownLinkDestination(link.destination);
    return uri ? { uri, relativeToDocument: isDocumentRelativeUri(uri) } : null;
  }

  for (const link of markdownReferenceLinkSourceSpans(0, text, referenceDefinitions)) {
    if (link.image) continue;
    if (offset < link.from || offset > link.to) continue;
    const uri = link.definition.destination;
    return { uri, relativeToDocument: isDocumentRelativeUri(uri) };
  }

  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (offset < from || offset > to) continue;
    const uri = parseWikiLinkTarget(
      match[1] ?? '',
      currentNotePath,
      knownNotePaths,
    )?.uri;
    return uri ? { uri, relativeToDocument: false } : null;
  }

  for (const match of autolinkMatches(text)) {
    if (offset < match.from || offset > match.to) continue;
    return { uri: match.uri, relativeToDocument: false };
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
      const requestId = typeof message.requestId === 'string' ? message.requestId : undefined;
      if (!view || typeof message.text !== 'string') {
        if (requestId) vscode.postMessage({ type: 'insertTextApplied', requestId, applied: false });
        return;
      }
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
      if (requestId) vscode.postMessage({ type: 'insertTextApplied', requestId, applied: true });
      break;
    }

    case 'setLearningAnnotations':
      if (!view) return;
      view.dispatch({
        effects: setLearningAnnotations.of(normalizeLearningAnnotations(message.annotations)),
      });
      break;

    case 'requestSelection': {
      if (typeof message.requestId !== 'string') return;
      if (view) {
        syncNativeSelectionToEditorSelection(view);
      }
      const selection = view?.state.selection.main;
      vscode.postMessage({
        type: 'selectionResponse',
        requestId: message.requestId,
        selection: {
          from: selection?.from ?? 0,
          to: selection?.to ?? 0,
        },
      });
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

    case 'restoreFocus':
      if (!view) return;
      restoreEditorFocusAfterShortcut(view);
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
      break;
  }
});

window.addEventListener('error', event => {
  vscode.postMessage({ type: 'error', message: String(event.message) });
});

vscode.postMessage({ type: 'ready' });

function normalizeLearningAnnotations(value: unknown): LearningAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 1_000).flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object') return [];
    const raw = candidate as Record<string, unknown>;
    if (
      typeof raw.discussionId !== 'string'
      || typeof raw.notePath !== 'string'
      || typeof raw.quote !== 'string'
      || typeof raw.summary !== 'string'
      || raw.discussionId.length > 200
      || raw.notePath.length > 1_024
      || raw.quote.length > 1_000_000
      || raw.summary.length > 2_000
    ) {
      return [];
    }
    const question = typeof raw.question === 'string' ? raw.question : '';
    if (question.length > 2_000) return [];
    const rawQuestionCount = nonNegativeInteger(raw.questionCount);
    const questionCount = Math.min(
      10_000,
      Math.max(rawQuestionCount ?? 0, question ? 1 : 0),
    );
    const from = nonNegativeInteger(raw.from);
    const to = nonNegativeInteger(raw.to);
    return [{
      discussionId: raw.discussionId,
      notePath: raw.notePath,
      quote: raw.quote,
      question,
      questionCount,
      summary: raw.summary,
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
    }];
  });
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
(window as MarkdownEditorTestWindow).__llmWikiCommands = obsidianLikeCommands;
(window as MarkdownEditorTestWindow).__llmWikiVimModeEnabled = () => vimModeEnabled;

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
}

function buildDecorations(view: EditorView): DecorationSet {
  if (!isHybridPreviewEnabled(view.state)) return Decoration.none;

  const decorations: Range<Decoration>[] = [];
  const activeLines = getActiveLines(view);
  const activeSelectionRanges = getActiveSelectionRanges(view);
  const referenceDefinitions = markdownReferenceDefinitions(view.state.doc.toString());
  const decoratedLines = new Set<number>();

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (decoratedLines.has(line.number)) {
        pos = line.to + 1;
        continue;
      }
      decoratedLines.add(line.number);
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
      widget: new HlLinkWidget(
        uri,
        link.label,
        sourceFrom,
        sourceTo,
        isDocumentRelativeUri(uri),
      ),
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
      widget: new HlLinkWidget(
        link.definition.destination,
        link.label,
        sourceFrom,
        sourceTo,
        isDocumentRelativeUri(link.definition.destination),
      ),
    }).range(sourceFrom, sourceTo));
    occupied.push({ from: sourceFrom, to: sourceTo });
  }

  const wikiLink = /\[\[([^\]]+)\]\]/g;
  while ((match = wikiLink.exec(text)) !== null) {
    const raw = match[0];
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
    if (link.destinationFrom < link.destinationTo) {
      decorations.push(activeLinkDestinationMark.range(link.destinationFrom, link.destinationTo));
    }
    for (const range of [
      { from: sourceFrom, to: link.labelFrom },
      { from: link.labelTo, to: link.destinationFrom },
      { from: link.destinationTo, to: sourceTo },
    ]) {
      if (range.from < range.to) {
        decorations.push(activeLinkPunctuationMark.range(range.from, range.to));
      }
    }
    reserved.push({ from: sourceFrom, to: sourceTo });
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
    for (const range of [
      { from: sourceFrom, to: link.labelFrom },
      { from: link.labelTo, to: sourceTo },
    ]) {
      if (range.from < range.to) {
        decorations.push(activeLinkPunctuationMark.range(range.from, range.to));
      }
    }
    reserved.push({ from: sourceFrom, to: sourceTo });
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

  addActiveInlineCodeMarks(lineFrom, text, activeSelectionRanges, decorations, reserved);
  addActiveFootnoteMarks(lineFrom, text, activeSelectionRanges, decorations, reserved);
  addActiveAutolinkMarks(lineFrom, text, decorations, reserved, rawLinkSourceSpans);
  addActiveTagMarks(lineFrom, text, activeSelectionRanges, decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /\*\*\*(?=\S)(.+?\S)\*\*\*/g, 3, activeSelectionRanges, [activeBoldMark, activeItalicMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /(?<![A-Za-z0-9_])___(?=\S)(.+?\S)___(?![A-Za-z0-9_])/g, 3, activeSelectionRanges, [activeBoldMark, activeItalicMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /\*\*(?=\S)(.+?\S)\*\*/g, 2, activeSelectionRanges, [activeBoldMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /(?<![A-Za-z0-9_])__(?=\S)(.+?\S)__(?![A-Za-z0-9_])/g, 2, activeSelectionRanges, [activeBoldMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /(?<!\*)\*(?=\S)(.+?\S)\*(?!\*)/g, 1, activeSelectionRanges, [activeItalicMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /(?<![A-Za-z0-9_])_(?=\S)(.+?\S)_(?![A-Za-z0-9_])/g, 1, activeSelectionRanges, [activeItalicMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /~~(?=\S)(.+?\S)~~/g, 2, activeSelectionRanges, [activeStrikeMark], decorations, reserved);
  addActiveDelimitedMarks(lineFrom, text, /==(?=\S)(.+?\S)==/g, 2, activeSelectionRanges, [activeHighlightMark], decorations, reserved);
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
  activeSelectionRanges: { from: number; to: number }[],
  marks: Decoration[],
  decorations: Range<Decoration>[],
  reserved: { from: number; to: number }[],
): void {
  for (const match of text.matchAll(pattern)) {
    const sourceFrom = lineFrom + (match.index ?? 0);
    const sourceTo = sourceFrom + match[0].length;
    if (!selectionTouchesSource(activeSelectionRanges, sourceFrom, sourceTo)) continue;
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
  activeSelectionRanges: { from: number; to: number }[],
  decorations: Range<Decoration>[],
  reserved: { from: number; to: number }[],
): void {
  for (const span of inlineCodeSourceSpans(lineFrom, text)) {
    if (!selectionTouchesSource(activeSelectionRanges, span.from, span.to)) continue;
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
  activeSelectionRanges: { from: number; to: number }[],
  decorations: Range<Decoration>[],
  reserved: { from: number; to: number }[],
): void {
  const definition = text.match(/^(\s*)\[\^([^\]\s]+)\]:/);
  if (definition && !isEscapedAt(text, definition[1]!.length)) {
    const id = definition[2] ?? '';
    const sourceFrom = lineFrom + definition[1]!.length;
    const sourceTo = sourceFrom + definition[0].trimStart().length;
    const from = lineFrom + definition[1]!.length + 2;
    const to = from + id.length;
    if (
      selectionTouchesSource(activeSelectionRanges, sourceFrom, sourceTo)
      && !reserved.some(span => from < span.to && to > span.from)
    ) {
      decorations.push(activeFootnoteDefLabelMark.range(from, to));
      reserved.push({ from, to });
    }
  }

  for (const match of text.matchAll(/\[\^([^\]\s]+)\]/g)) {
    if (isEscapedAt(text, match.index ?? 0)) continue;
    const id = match[1] ?? '';
    const sourceFrom = lineFrom + (match.index ?? 0);
    const sourceTo = sourceFrom + match[0].length;
    const from = lineFrom + (match.index ?? 0) + 2;
    const to = from + id.length;
    if (!selectionTouchesSource(activeSelectionRanges, sourceFrom, sourceTo)) continue;
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
  activeSelectionRanges: { from: number; to: number }[],
  decorations: Range<Decoration>[],
  reserved: { from: number; to: number }[],
): void {
  for (const match of text.matchAll(obsidianTagPattern())) {
    const from = lineFrom + (match.index ?? 0);
    const to = from + match[0].length;
    if (isEscapedAt(text, match.index ?? 0)) continue;
    if (!selectionTouchesSource(activeSelectionRanges, from, to)) continue;
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
      return range.from >= sourceFrom && range.from < sourceTo;
    }
    return range.from < sourceTo && range.to > sourceFrom;
  });
}

function isExternalUri(uri: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(uri) && !uri.startsWith('llm-wiki://');
}

function isDocumentRelativeUri(uri: string): boolean {
  return Boolean(uri)
    && !uri.startsWith('#')
    && !uri.startsWith('/')
    && !/^[a-z][a-z0-9+.-]*:/i.test(uri);
}
