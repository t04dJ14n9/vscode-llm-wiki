# Codex-Quiet Ask PDF Presentation Design

**Status:** Approved in conversation on 2026-07-16

**Scope:** Ask PDF presentation in the combined and standalone PDF extensions

**Decision:** Keep the existing TypeScript/DOM controller and replace only its presentation with a small semantic view and local token layer. Do not adopt React, Tailwind CSS, shadcn/ui, or Apps SDK UI in this phase.

## Context

Ask PDF already has the difficult behavioral foundations in place:

- Annotation-owned movable and resizable windows.
- Selection crops, exact quotes, nearby context, and portable PDF links.
- Lightweight Codex sessions, streaming, interruption, retry, and promotion.
- Durable discussions, minimized state, markers, overview navigation, and restart recovery.
- Combined and standalone PDF implementations that remain byte-identical.

The current `pdfAskPanel.ts` also owns imperative DOM construction, rendering, state transitions, geometry, styling, accessibility, and host messaging. Its “scholarly marginalia” presentation is visually dense and makes future visual iteration harder than necessary.

The approved direction is “Codex quiet”: a neutral floating conversation surface with a compact source card, natural transcript hierarchy, integrated composer, and annotation-owned minimized chip. OpenAI's Apps SDK UI and Figma library are visual references only; this extension is a VS Code webview rather than a ChatGPT app, and the official package would introduce React and Tailwind solely for one panel.

## Goals

1. Make the Ask PDF inspector feel close to Codex's quiet conversation hierarchy while remaining native to VS Code.
2. Preserve every existing Ask PDF workflow and persisted state contract.
3. Isolate presentation behind a typed, dependency-free seam that can later be replaced by React without rewriting the controller.
4. Keep PDF provenance visually distinct from agent activity.
5. Maintain identical behavior and source across the combined and standalone PDF extensions.
6. Preserve keyboard access, screen-reader behavior, reduced motion, safe Markdown, and narrow-screen operation.

## Non-goals

- Migrating the PDF viewer, Markdown editor, web browser, or extension host to React.
- Adding React, React DOM, Tailwind CSS, shadcn/ui, Apps SDK UI, or another component framework.
- Changing sidecar routing, Codex thread lifecycle, or the promotion model. The only protocol/schema additions in this phase are optional model provenance and the model-catalog messages required by the approved model picker.
- Changing annotation selection, crop capture, marker geometry, portable links, or PDF rendering.
- Adding attachments, new agent tools, or controls that do not already have behavior.
- Synchronizing full Codex task turns back into PDF annotations after promotion.
- Reproducing Codex branding exactly. The design borrows hierarchy and restraint, not proprietary assets.

## Architectural Decision

The controller remains the behavioral authority. A new view model and semantic view own presentation only.

```text
pdf-viewer.ts
    │ createPdfAskPanel(options)
    ▼
PdfAskPanelController
  - host messages and typed requests
  - annotation and draft ownership
  - streaming and lifecycle state
  - geometry, focus, and persistence
  - derives immutable AskPdfViewModel
    │ update(model)
    ▼
AskPdfPanelView
  - stable semantic DOM
  - keyed transcript updates
  - safe Markdown rendering
  - emits typed UI events
    │ AskPdfViewEvent
    └──────────────────────────► controller
```

### File responsibilities

The following files exist byte-for-byte in both `packages/vscode-extension/webview-src/` and `packages/vscode-pdf-extension/webview-src/`.

#### `pdfAskPanel.ts`

- Keeps `createPdfAskPanel`, `capturePdfSelectionCrop`, `PdfAskPanel`, and `PdfAskPanelOptions` public behavior unchanged.
- Owns annotations, draft ownership, request correlation, consent, streaming state, promotion, window geometry, focus restoration, markers, and VS Code webview state.
- Loads the signed-in Codex model catalog through the host, tracks the selected model per annotation, and passes that model with submissions and retries.
- Derives `AskPdfViewModel` from controller state.
- Handles `AskPdfViewEvent` values and performs all state mutations and host messages.
- Keeps source-card expansion in an in-memory map keyed by annotation ID or draft selection key. Expansion survives streaming renders and minimize/restore within the current webview session, but resets to collapsed after a webview reload.
- Continues to render page-layer discussion markers and the minimized annotation chip because those elements live beside PDF selection geometry rather than inside the panel root.

#### `pdfAskPanelView.ts`

- Creates one stable panel root and semantic child regions.
- Updates existing regions instead of replacing the whole panel.
- Keeps the textarea, its selection, focused controls, transcript scroll position, and message nodes stable across streaming updates.
- Keys transcript entries by durable message ID and uses a separate keyed node for the active in-memory stream.
- Sanitizes every Markdown render using the existing Marked and DOMPurify boundary before inserting it into the DOM.
- Uses event delegation and `data-action` attributes so rerenders do not create stale listeners.
- Emits typed events and cannot call `vscode.postMessage`, write webview state, navigate the PDF, or mutate annotations.

#### `pdfAskPanelStyles.ts`

- Exports the style installer and local semantic token definitions.
- Contains no state or event logic.
- Maps surfaces, text, borders, focus, and error states to VS Code theme variables.
- Defines the fixed PDF provenance blue and restrained agent accent.
- Owns desktop, overlay, full-width, high-contrast, and reduced-motion rules.

### View contract

The presentation boundary uses these contracts:

```ts
interface AskPdfViewModel {
  mode: "draft" | "discussion" | "overview";
  header: AskPdfHeaderModel;
  source?: AskPdfSourceModel;
  messages: AskPdfMessageModel[];
  streamingMarkdown?: string;
  composer: AskPdfComposerModel;
  actions: AskPdfActionModel[];
  notice?: AskPdfNoticeModel;
  consent?: AskPdfConsentModel;
  minimized: boolean;
  responsiveMode: "floating" | "overlay" | "full-width";
}

interface AskPdfComposerModel {
  value: string;
  placeholder: string;
  running: boolean;
  models: Array<{
    id: string;
    displayName: string;
    description?: string;
    isDefault: boolean;
  }>;
  selectedModel?: string;
  modelCatalogStatus: "idle" | "loading" | "ready" | "failed";
}

type AskPdfViewEvent =
  | { type: "changeDraft"; value: string }
  | { type: "selectModel"; model: string | undefined }
  | { type: "submit" }
  | { type: "stop" }
  | { type: "retry" }
  | { type: "toggleSource"; expanded: boolean }
  | { type: "copyPortableLink" }
  | { type: "openPortableLink" }
  | { type: "openTranscriptLink"; href: string }
  | { type: "promote" }
  | { type: "openPromotedTask" }
  | { type: "openOverview" }
  | { type: "openAnnotation"; annotationId: string }
  | { type: "acceptConsent" }
  | { type: "minimize" }
  | { type: "close" }
  | { type: "restore" }
  | { type: "resetPosition" };

interface AskPdfPanelView {
  readonly element: HTMLElement;
  update(model: AskPdfViewModel): void;
  focusPrimaryControl(): void;
  dispose(): void;
}
```

Drag and resize gestures remain controller-owned. The stable view root exposes explicit drag and resize handles through `data-ask-drag-handle` and `data-resize-direction` attributes.

## Visual System

### Design signature

The panel uses two accents with separate meanings:

- `#4dabf7` is PDF provenance: selection outline, page chip, source seam, and annotation connector.
- `#e88968` is agent activity: Codex spark, active stream, and running state.

The two colors must not be swapped or used as broad surface fills. The rest of the interface remains neutral and derives from VS Code.

### Semantic tokens

`pdfAskPanelStyles.ts` defines local properties rather than scattering raw values:

```css
--ask-panel-bg: var(--vscode-editorWidget-background, var(--vscode-editor-background));
--ask-surface-raised: color-mix(in srgb, var(--ask-panel-bg) 88%, var(--vscode-editor-foreground) 12%);
--ask-surface-input: var(--vscode-input-background, var(--ask-surface-raised));
--ask-border: var(--vscode-widget-border, var(--vscode-panel-border));
--ask-text: var(--vscode-editor-foreground);
--ask-text-muted: var(--vscode-descriptionForeground);
--ask-focus: var(--vscode-focusBorder, #4dabf7);
--ask-source-accent: #4dabf7;
--ask-agent-accent: #e88968;
--ask-error: var(--vscode-errorForeground);
--ask-radius-panel: 16px;
--ask-radius-card: 12px;
--ask-radius-control: 8px;
```

High-contrast themes may replace shadows with stronger borders. The implementation does not load fonts; VS Code's UI font remains authoritative.

### Panel shell

- Rounded 16 px floating surface with a one-pixel theme border.
- Soft two-stage shadow in normal themes; no blur or translucent backdrop dependency.
- A two-pixel provenance seam appears only beside the source region, not around the full window.
- Existing 320–560 px width and 260–720 px height constraints remain authoritative.
- Resize handles stay visually quiet until hover or keyboard focus.

### Header

- A small, original four-point spark glyph is decorative and does not reproduce an OpenAI trademark asset.
- Primary copy: **Ask about selection**.
- Secondary copy: the PDF filename or compact document label.
- Controls: overflow menu and **Minimize**. **Reset position** appears in the overflow menu when the window is detached, and **Close** remains available there without changing the annotation's persisted minimized state.
- The header remains the drag handle on floating layouts.

### Source card

- Implemented as controlled semantic `<details>` and `<summary>` content.
- Collapsed by default on every new open and after webview reload.
- Collapsed state shows page chip, “Selected passage,” and a two-line exact-quote preview.
- Expanded state shows the rendered PNG crop when available, complete exact quote, explicitly labelled nearby context, portable link, **Copy link**, and **Open page**.
- Text-only fallback is quiet and does not reserve an empty crop frame.

### Transcript

- Rendered as an ordered discussion list with screen-reader sender labels.
- User questions are compact, right-aligned neutral bubbles.
- Assistant answers are open content aligned with a small warm spark.
- Visible `YOU`/`CODEX` labels and provenance rails are removed.
- Failed or cancelled turns expose a quiet **Retry** action with a tooltip and accessible name.
- Streaming uses the same assistant node plus a restrained cursor/status treatment; it does not create a durable partial message.
- Sanitized links route through the existing host-owned link handler.

### Composer

- One rounded input surface containing the persistent textarea and action row.
- Placeholder is **Ask a follow-up** for discussions and **Ask about this selection** for drafts.
- A compact model picker sits at the lower left of the composer. It is populated from the signed-in account through app-server `model/list`, filters hidden models, marks the catalog default, and uses that default until the user chooses another model.
- The chosen model is annotation-scoped and durable. Submitting a question stores it as optional model provenance for the turn; reopening the annotation selects its latest model when it is still available, otherwise it falls back to the current catalog default.
- Changing the picker before a follow-up sends the model override through `turn/start`; changing it before the first question sends it through `thread/start`. The picker is disabled while a turn is running.
- A model-catalog failure does not block asking with the user's Codex default. The picker collapses to **Default model** and exposes the loading error through an accessible tooltip/status.
- `Cmd/Ctrl+Enter` sends.
- The Send action occupies one consistent location at the lower right, uses an inline SVG up-arrow icon, and changes in place to an inline SVG stop-square during a running turn.
- No attachment or plus control is shown because v1 has no attachment workflow.
- Validation and transport errors appear immediately above the composer without replacing transcript content.

### Model catalog and provenance

- `CodexAppServerClient` adds a paginated `model/list` request using the schema generated by the installed CLI. The controller returns only `id`, `model`, `displayName`, `description`, `hidden`, and `isDefault`, and the provider sends only visible entries to the webview.
- The host/webview protocol adds `pdfDiscussionListModels`, `pdfDiscussionModels`, and an optional `model` field on submit. Model IDs are validated against the current non-hidden catalog before they are passed to Codex.
- `ThreadStartParams` and `TurnStartParams` gain optional model overrides. Promotion intentionally omits the lightweight selection so the normal Codex task continues to use the user's regular defaults.
- The sidecar schema keeps version 1 and adds optional `codexModel` provenance to discussion messages plus optional `model` on `lastTurn`. Old sidecars remain valid without migration.
- Retry reuses the failed or cancelled turn's stored model. A restarted ephemeral session starts with the annotation's newest available model and seeds the same visible transcript as before.

### Promotion

- **Continue in Codex** appears as a quiet text action beneath the newest complete answer.
- After promotion, it becomes **Open Codex task**.
- Promotion failure retains the annotation and task ID behavior already owned by the controller.

### Minimized state

- Minimize and PDF-origin Escape persist minimized state and collapse the window into a small annotation-owned chip near the blue discussion marker. Close only hides the current panel, preserving its existing non-minimized reopen behavior.
- The chip includes the annotation number, **Ask PDF**, and status indication.
- Clicking or keyboard-activating it restores the exact annotation window and its saved geometry.
- Running state uses a restrained warm pulse; answered is static; failed uses the theme error color; reduced motion disables the pulse.

### Overview

- The toolbar count remains the entry point.
- Overview uses the same floating shell and header, titled **PDF discussions**.
- Entries show page, a one-line summary, status, and recent activity without chat bubbles.
- Selecting an entry restores its annotation-owned window and navigates to the source.

## Responsive Behavior

- Desktop keeps the annotation-adjacent floating window and saved geometry.
- Constrained layouts keep the existing overlay behavior and prevent the window from leaving the PDF viewport.
- Below the existing 620 px narrow breakpoint, the panel becomes a full-width overlay; pointer dragging and resizing are disabled, while keyboard focus and scrolling remain available.
- Source content starts collapsed in constrained modes.
- The composer remains visible at the bottom of the panel without covering transcript content.
- Leaving narrow mode restores the annotation's saved floating geometry rather than overwriting it with overlay dimensions.

## State and Error Behavior

The redesign does not alter lifecycle semantics:

| State | Presentation |
| --- | --- |
| Draft | Collapsed source card, empty transcript, enabled composer after consent. |
| Model loading | Default-model fallback remains usable; picker shows a quiet loading state. |
| Consent required | Compact consent card above the composer; no Codex-starting action proceeds before acceptance. |
| Running | In-memory assistant stream, warm activity indicator, Stop action, transcript retained. |
| Answered | Durable assistant answer and promotion action. |
| Failed | Question remains durable, no partial answer, actionable inline error and Retry. |
| Cancelled | Question remains, stream disappears, quiet cancelled status and Retry. |
| Promoted | Original transcript remains; Open Codex task replaces promotion. |
| Overview | Discussion list replaces source/transcript while using the same shell. |

Stale host responses, background annotation updates, concurrent ownership, retries, and promotion attempts continue to use the existing controller logic. The view only renders the resulting model.

## Accessibility

- The window remains an `<aside>` with an accessible name.
- Header controls, source summary, transcript actions, composer, resize handles, minimized chips, and overview entries are keyboard reachable.
- The transcript uses semantic list/article structure and visually hidden sender labels.
- Streaming deltas continue through the existing polite ARIA live region without rereading the full cumulative answer.
- Focus stays in the persistent composer across stream updates.
- Opening a new draft focuses the composer; restoring a discussion focuses the last logical panel control; closing or minimizing restores PDF focus.
- Escape continues to yield to active PDF tools before minimizing the panel.
- Focus outlines use `--ask-focus` and remain visible in high-contrast themes.
- `prefers-reduced-motion` disables stream and marker animation.

## Security and Trust Boundaries

- Assistant Markdown remains untrusted and is sanitized before DOM insertion.
- Model IDs from the webview are untrusted and must match a currently visible `model/list` entry before use.
- Transcript links never navigate directly inside the webview; the view emits `openTranscriptLink` and the host validates/opens them.
- The view cannot access the PDF URI, annotation store paths, VS Code API, or Codex client.
- Crop data and quote text continue through the existing validated protocol and storage limits.
- No external font, stylesheet, script, or runtime asset is loaded.

## Testing Strategy

### Existing behavior

All existing Ask PDF and PDF viewer tests remain passing. Tests must continue to cover:

- Draft preparation and crop capture.
- Annotation-owned geometry and minimized state.
- Streaming, cancellation, retry, consent, failure, promotion, and safe links.
- Responsive layouts, resize behavior, focus, ARIA announcements, markers, overview, and selection interactions.
- Single-page navigation and text-layer alignment regressions.

### New semantic coverage

Add Playwright assertions for:

- Semantic panel header and accessible title.
- Collapsed and expanded source `<details>` behavior.
- Text-only source fallback without an empty crop frame.
- Stable composer node, selection, and focus during streaming updates.
- Keyed message nodes across background annotation refreshes.
- Screen-reader sender labels without visible `YOU`/`CODEX` rails.
- Send-to-Stop action transition in one stable composer location.
- Model-catalog loading, default selection, annotation-scoped selection, running-state disablement, model fallback, and keyboard operation.
- Inline SVG send/stop icons with stable accessible names and no text-glyph fallback.
- Annotation-owned minimized chip state and restoration.
- Overview list semantics and return to a discussion.
- No non-functional attachment control.

### Visual coverage

Replace the approved desktop and narrow Ask PDF baselines and add stable baselines for:

- Minimized answered chip.
- Running desktop discussion.
- Expanded source card with crop.
- Failed turn with inline recovery.

Snapshots use deterministic fixture content and the fake app server. No real Codex call runs in CI.

### Parity and dependency coverage

- Combined and standalone `pdfAskPanel.ts`, `pdfAskPanelView.ts`, and `pdfAskPanelStyles.ts` remain byte-identical.
- Combined and standalone app-server, controller, provider, and protocol model-selection behavior remains identical.
- Both bundles expose the same Ask PDF behavior.
- `package.json` and `pnpm-lock.yaml` must not gain React, Tailwind, shadcn/ui, Apps SDK UI, or another presentation dependency for this feature.
- Existing webview size budgets remain enforced.

### Manual acceptance

Use Computer Use in the dedicated Extension Development Host with the Game Engine Architecture textbook:

1. Select a one-page paragraph and open **Ask about selection…**.
2. Confirm the floating window appears beside the selection and remains movable and resizable.
3. Expand the source card and verify the quote, crop, context, and portable page link.
4. Submit a real question through the logged-in Codex account and observe streaming, Stop availability, and final automatic persistence.
5. Choose a non-default model before a follow-up and confirm the selected model is sent, retained after reopen, and disabled while the turn runs.
6. Minimize and restore the annotation-owned chip.
7. Close and reopen the PDF and confirm the discussion and window state restore.
8. Ask a follow-up and promote the discussion to a normal Codex task.
9. Repeat the critical open/ask/model-select/minimize flow in the standalone PDF extension.

## Acceptance Criteria

- The desktop and narrow implementations match the approved “Codex quiet” direction.
- Every existing Ask PDF capability remains usable and durable.
- Presentation is isolated behind `AskPdfViewModel`, `AskPdfViewEvent`, and `AskPdfPanelView`.
- The model picker is populated by the signed-in app-server catalog, uses the account default initially, applies a validated override to lightweight turns, and preserves model provenance without invalidating existing sidecars.
- Combined and standalone PDF sources remain identical.
- No new UI framework or presentation dependency is introduced.
- Automated suites and both extension builds pass.
- The real textbook workflow completes successfully through Computer Use.

## Future React Migration Trigger

React is reconsidered only when at least one of these becomes true:

1. A second non-PDF agent surface needs the same transcript, source card, composer, and streaming components.
2. Multiple webviews begin duplicating stateful accessible component behavior that the local view cannot share cleanly.
3. The presentation layer requires complex nested routing or component composition beyond the stable `AskPdfViewModel` boundary.
4. The team explicitly adopts React and Tailwind as the baseline for all extension webviews.

At that point, React replaces `pdfAskPanelView.ts` and `pdfAskPanelStyles.ts`; `PdfAskPanelController`, the view model, typed events, host protocol, annotation storage, and tests remain the migration boundary. Apps SDK UI may then be evaluated against VS Code theming and bundle constraints. shadcn/ui remains optional and is not assumed to be the correct visual system.
