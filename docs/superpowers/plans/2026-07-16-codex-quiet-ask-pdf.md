# Codex-Quiet Ask PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dense Ask PDF panel with the approved Codex-quiet annotation window and add a dynamic, durable Codex model picker in both PDF extensions.

**Architecture:** Keep `PdfAskPanelController` authoritative for PDF geometry, host messages, annotation ownership, and lifecycle state. Move stable semantic DOM and keyed rendering into `pdfAskPanelView.ts`, move presentation tokens into `pdfAskPanelStyles.ts`, and expose only typed view models/events across that seam. Extend the existing app-server client, controller, sidecar schema, and host/webview protocol narrowly for `model/list` and per-turn model provenance.

**Tech Stack:** TypeScript, DOM APIs, VS Code webviews/theme tokens, Codex app-server JSONL protocol, Zod, Marked, DOMPurify, Node test runner, Playwright, pnpm, webpack.

## Global Constraints

- Keep Codex CLI `0.144.1` as the minimum supported baseline.
- Do not add React, React DOM, Tailwind CSS, shadcn/ui, Apps SDK UI, or another presentation dependency.
- Keep PDF pages white in every VS Code theme.
- Keep `#4dabf7` reserved for PDF provenance and `#e88968` reserved for agent activity.
- Keep Ask PDF available without `.hl`, with PDF bytes unmodified and no internal anchor ID in portable links or prompts.
- Keep combined and standalone implementations byte-identical for every mirrored source file.
- Preserve the current dirty worktree; do not reset, stash, broadly format, or stage generated artifacts and live test-vault residue.
- Treat assistant Markdown and webview-provided model IDs as untrusted input.
- Do not send PDF text, questions, crops, answers, or model-visible context to diagnostics.

---

## File Structure

### Core

- Modify `packages/core/src/pdf-discussions/schema.ts`: optional `codexModel` message provenance and `lastTurn.model` validation.
- Modify `packages/core/test/pdf-discussions.test.mjs`: schema compatibility and provenance round-trip coverage.

### Extension host (mirrored)

- Modify `packages/vscode-extension/src/codexAppServerClient.ts` and `packages/vscode-pdf-extension/src/codexAppServerClient.ts`: paginated `model/list`, thread/turn model overrides.
- Modify `packages/vscode-extension/src/pdfDiscussionController.ts` and `packages/vscode-pdf-extension/src/pdfDiscussionController.ts`: visible model catalog, model validation, retry/restart provenance.
- Modify `packages/vscode-extension/src/pdfDiscussionProtocol.ts` and `packages/vscode-pdf-extension/src/pdfDiscussionProtocol.ts`: typed model messages and optional submit model.
- Modify `packages/vscode-extension/src/pdfEditorProvider.ts` and `packages/vscode-pdf-extension/src/pdfEditorProvider.ts`: route model catalog requests and selected models.

### Webview presentation (mirrored)

- Modify `packages/vscode-extension/webview-src/pdfAskPanel.ts` and `packages/vscode-pdf-extension/webview-src/pdfAskPanel.ts`: controller/view-model adapter, markers, geometry, host messages.
- Create `packages/vscode-extension/webview-src/pdfAskPanelView.ts` and `packages/vscode-pdf-extension/webview-src/pdfAskPanelView.ts`: stable semantic panel DOM and keyed updates.
- Create `packages/vscode-extension/webview-src/pdfAskPanelStyles.ts` and `packages/vscode-pdf-extension/webview-src/pdfAskPanelStyles.ts`: Codex-quiet tokens, responsive rules, reduced motion, high contrast.

### Tests and fixtures

- Modify `packages/vscode-extension/test/fixtures/fake-codex-app-server.mjs`: deterministic paginated model catalog and model assertions.
- Modify `packages/vscode-extension/test/codexAppServerClient.test.mjs`: app-server model catalog and override coverage.
- Modify `packages/vscode-extension/test/pdfDiscussionController.test.mjs`: model validation, persistence, retry, and restart coverage.
- Modify `packages/vscode-extension/test/pdfDiscussionHostIntegration.test.mjs`: host/webview model routing and input validation.
- Modify `packages/vscode-extension/test/e2e/ask-pdf.spec.ts`: semantic view, model picker, stable stream rendering, SVG controls, responsive/minimized states.
- Replace Ask PDF PNG baselines under `packages/vscode-extension/test/e2e/ask-pdf.spec.ts-snapshots/` only after semantic assertions pass.

---

### Task 1: Durable Model Provenance in Core

**Files:**
- Modify: `packages/core/src/pdf-discussions/schema.ts`
- Test: `packages/core/test/pdf-discussions.test.mjs`

**Interfaces:**
- Produces: `PdfDiscussionMessageV1.codexModel?: string`
- Produces: `PdfDiscussionLastTurnV1.model?: string`
- Preserves: `PdfDiscussionDocumentV1.version === 1`

- [ ] **Step 1: Write the failing schema round-trip test**

```js
test('round-trips optional Codex model provenance without changing version 1', () => {
  const annotation = makeAnnotation({
    messages: [{
      id: 'message-1',
      role: 'assistant',
      markdown: 'Model-specific answer.',
      createdAt: NOW,
      codexTurnId: 'turn-1',
      codexModel: 'gpt-5.4',
    }],
    lastTurn: {
      status: 'idle',
      questionMessageId: 'message-1',
      model: 'gpt-5.4',
    },
  });
  assert.deepEqual(PdfDiscussionAnnotationV1Schema.parse(annotation), annotation);
  assert.throws(
    () => PdfDiscussionAnnotationV1Schema.parse({
      ...annotation,
      lastTurn: { ...annotation.lastTurn, model: '' },
    }),
  );
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm --filter @human-learning/core build && node --test --test-name-pattern="Codex model provenance" packages/core/test/pdf-discussions.test.mjs`

Expected: FAIL because Zod strips `codexModel` and `lastTurn.model`.

- [ ] **Step 3: Add optional non-empty model fields**

```ts
export const PdfDiscussionMessageV1Schema = z.object({
  id: NonEmptyStringSchema,
  role: z.enum(['user', 'assistant']),
  markdown: z.string(),
  createdAt: NonEmptyStringSchema,
  codexTurnId: NonEmptyStringSchema.optional(),
  codexModel: NonEmptyStringSchema.optional(),
});

export const PdfDiscussionLastTurnV1Schema = z.object({
  status: z.enum(['idle', 'running', 'failed', 'cancelled']),
  questionMessageId: NonEmptyStringSchema.optional(),
  model: NonEmptyStringSchema.optional(),
  ownerId: NonEmptyStringSchema.optional(),
  ownerPid: z.number().int().positive().optional(),
  startedAt: NonEmptyStringSchema.optional(),
  error: NonEmptyStringSchema.optional(),
});
```

- [ ] **Step 4: Run core tests**

Run: `pnpm --filter @human-learning/core test`

Expected: all core tests PASS and existing version-1 documents remain valid.

- [ ] **Step 5: Commit the core increment**

```bash
git add packages/core/src/pdf-discussions/schema.ts packages/core/test/pdf-discussions.test.mjs
git commit -m "feat(core): persist Ask PDF model provenance"
```

---

### Task 2: Codex App-Server Model Catalog

**Files:**
- Modify: `packages/vscode-extension/src/codexAppServerClient.ts`
- Modify: `packages/vscode-pdf-extension/src/codexAppServerClient.ts`
- Modify: `packages/vscode-extension/test/fixtures/fake-codex-app-server.mjs`
- Test: `packages/vscode-extension/test/codexAppServerClient.test.mjs`

**Interfaces:**
- Produces: `CodexModel`, `ModelListParams`, `ModelListResponse`
- Produces: `CodexAppServerClient.listModels(): Promise<CodexModel[]>`
- Extends: `ThreadStartParams.model?: string | null`
- Extends: `TurnStartParams.model?: string | null`

- [ ] **Step 1: Make the fake app-server expose two model pages and validate overrides**

```js
case 'model/list':
  respond(message.id, message.params?.cursor
    ? {
        data: [{
          id: 'model-fast', model: 'gpt-5.4-mini', displayName: 'GPT-5.4-Mini',
          description: 'Fast answers', hidden: false, isDefault: false,
          supportedReasoningEfforts: [], defaultReasoningEffort: 'medium',
          inputModalities: ['text', 'image'], supportsPersonality: true,
          additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
          upgrade: null, upgradeInfo: null, availabilityNux: null,
        }],
        nextCursor: null,
      }
    : {
        data: [{
          id: 'model-default', model: 'gpt-5.4', displayName: 'GPT-5.4',
          description: 'Default model', hidden: false, isDefault: true,
          supportedReasoningEfforts: [], defaultReasoningEffort: 'medium',
          inputModalities: ['text', 'image'], supportsPersonality: true,
          additionalSpeedTiers: [], serviceTiers: [], defaultServiceTier: null,
          upgrade: null, upgradeInfo: null, availabilityNux: null,
        }],
        nextCursor: 'page-2',
      });
  break;
```

Update `handleThreadStart` and `handleTurnStart` so `model` is accepted only when it is `gpt-5.4` or `gpt-5.4-mini`.

- [ ] **Step 2: Write failing client tests**

```js
test('lists every visible Codex model page and forwards model overrides', async t => {
  const { CodexAppServerClient } = loadClientModule();
  const client = createClient(CodexAppServerClient);
  t.after(() => client.dispose());

  const models = await client.listModels();
  assert.deepEqual(models.map(model => [model.model, model.isDefault]), [
    ['gpt-5.4', true],
    ['gpt-5.4-mini', false],
  ]);

  const thread = await client.startThread({ model: 'gpt-5.4' });
  await client.startTurn({
    threadId: thread.threadId,
    model: 'gpt-5.4-mini',
    input: [{ type: 'text', text: 'model-override' }],
  });
});
```

- [ ] **Step 3: Run the client test and confirm it fails**

Run: `pnpm --filter human-learning-vscode build && node --test --test-name-pattern="lists every visible Codex model" packages/vscode-extension/test/codexAppServerClient.test.mjs`

Expected: FAIL because `listModels` does not exist and model overrides are stripped.

- [ ] **Step 4: Implement paginated `model/list` and model forwarding**

```ts
export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
}

export interface ModelListResponse {
  data: CodexModel[];
  nextCursor?: string | null;
}

async listModels(): Promise<CodexModel[]> {
  const { state } = await this.ensureInitializedState();
  const models: CodexModel[] = [];
  let cursor: string | null | undefined;
  do {
    const page = await this.request<ModelListResponse>(
      state,
      'model/list',
      { ...(cursor ? { cursor } : {}), includeHidden: false },
      this.requestTimeoutMs,
    );
    models.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);
  return models;
}
```

Copy `model` with `copyDefined` in `startThread`, and include it in the `turn/start` wire params only when defined.

- [ ] **Step 5: Run client tests and mirrored-source checks**

Run: `pnpm --filter human-learning-vscode test`

Run: `cmp packages/vscode-extension/src/codexAppServerClient.ts packages/vscode-pdf-extension/src/codexAppServerClient.ts`

Expected: tests PASS and `cmp` exits 0.

- [ ] **Step 6: Commit the app-server increment**

```bash
git add packages/vscode-extension/src/codexAppServerClient.ts packages/vscode-pdf-extension/src/codexAppServerClient.ts packages/vscode-extension/test/fixtures/fake-codex-app-server.mjs packages/vscode-extension/test/codexAppServerClient.test.mjs
git commit -m "feat: expose Codex models to Ask PDF"
```

---

### Task 3: Model-Aware Discussion Controller and Host Protocol

**Files:**
- Modify: `packages/vscode-extension/src/pdfDiscussionController.ts`
- Modify: `packages/vscode-pdf-extension/src/pdfDiscussionController.ts`
- Modify: `packages/vscode-extension/src/pdfDiscussionProtocol.ts`
- Modify: `packages/vscode-pdf-extension/src/pdfDiscussionProtocol.ts`
- Modify: `packages/vscode-extension/src/pdfEditorProvider.ts`
- Modify: `packages/vscode-pdf-extension/src/pdfEditorProvider.ts`
- Test: `packages/vscode-extension/test/pdfDiscussionController.test.mjs`
- Test: `packages/vscode-extension/test/pdfDiscussionHostIntegration.test.mjs`

**Interfaces:**
- Produces: `PdfDiscussionModelSnapshot`
- Produces: `PdfDiscussionController.listModels(): Promise<PdfDiscussionModelSnapshot[]>`
- Extends: `PdfDiscussionSubmitInput.model?: string`
- Extends protocol: `pdfDiscussionListModels`, `pdfDiscussionModels`, and submit `model?: string`

- [ ] **Step 1: Extend recording clients and write failing controller tests**

```js
class RecordingClient {
  async listModels() {
    return [
      { id: 'model-default', model: 'gpt-5.4', displayName: 'GPT-5.4', description: '', hidden: false, isDefault: true },
      { id: 'model-fast', model: 'gpt-5.4-mini', displayName: 'GPT-5.4-Mini', description: '', hidden: false, isDefault: false },
      { id: 'model-hidden', model: 'internal-model', displayName: 'Internal', description: '', hidden: true, isDefault: false },
    ];
  }
}

test('validates, forwards, persists, retries, and restores the selected model', async t => {
  const { root, store } = await tempDocument();
  t.after(() => rm(root, { recursive: true, force: true }));
  const client = createFixtureClient();
  const { PdfDiscussionController } = controllerModule();
  const controller = new PdfDiscussionController({ client });
  t.after(() => { controller.dispose(); client.dispose(); });

  const submitted = await controller.submit(store, {
    anchor: anchor(), question: 'Use the fast model.', model: 'gpt-5.4-mini',
  });
  await waitFor(() => controller.list(store)[0]?.lastTurn.status === 'idle');
  const saved = controller.list(store)[0];
  assert.equal(saved.lastTurn.model, 'gpt-5.4-mini');
  assert.equal(saved.messages.at(-1).codexModel, 'gpt-5.4-mini');
  assert.equal(client.threadCalls[0].model, 'gpt-5.4-mini');
  await assert.rejects(
    controller.submit(store, { annotationId: submitted.annotationId, question: 'No.', model: 'internal-model' }),
    /available Codex model/i,
  );
});
```

- [ ] **Step 2: Run focused controller tests and confirm failure**

Run: `pnpm --filter human-learning-vscode build && node --test --test-name-pattern="selected model" packages/vscode-extension/test/pdfDiscussionController.test.mjs`

Expected: FAIL because the client/controller interfaces and sidecar state do not carry a model.

- [ ] **Step 3: Add catalog validation and model-aware turn lifecycle**

```ts
export interface PdfDiscussionModelSnapshot {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

async listModels(): Promise<PdfDiscussionModelSnapshot[]> {
  return (await this.client.listModels())
    .filter(model => !model.hidden)
    .map(({ id, model, displayName, description, isDefault }) => ({
      id, model, displayName, description, isDefault,
    }));
}
```

Use this validation boundary, then store the returned value in `lastTurn.model`, pass it to both `startThread` and `startTurn`, reuse it during `retry`, and attach it as `codexModel` to the committed assistant message:

```ts
private async resolveRequestedModel(requested: string | undefined): Promise<string | undefined> {
  if (requested === undefined) return undefined;
  const models = await this.listModels();
  const match = models.find(candidate => candidate.model === requested);
  if (!match) {
    throw new PdfDiscussionControllerError(
      'invalid-input',
      'Choose an available Codex model before submitting this PDF question.',
    );
  }
  return match.model;
}
```

If no model is selected, omit the wire field so app-server applies its current default.

- [ ] **Step 4: Write failing host protocol tests**

```js
await provider.handlePdfDiscussionMessage(webview, pdfUri, {
  type: 'pdfDiscussionListModels', requestId: 'models-1',
});
assert.deepEqual(posted.at(-1), {
  type: 'pdfDiscussionModels',
  models: [{ id: 'model-default', model: 'gpt-5.4', displayName: 'GPT-5.4', description: '', isDefault: true }],
  requestId: 'models-1',
});

await provider.handlePdfDiscussionMessage(webview, pdfUri, {
  type: 'pdfDiscussionSubmit', annotationId: 'annotation-1',
  question: 'Explain.', model: 'gpt-5.4', requestId: 'submit-1',
});
assert.equal(controller.submissions.at(-1).model, 'gpt-5.4');
```

- [ ] **Step 5: Implement protocol/provider routing and snapshot fields**

```ts
export interface PdfDiscussionModelSnapshot {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
}

// webview -> host
| { type: 'pdfDiscussionListModels'; requestId?: string }
| {
    type: 'pdfDiscussionSubmit';
    requestId?: string;
    annotationId?: string;
    selection?: PdfDiscussionSelection;
    question: string;
    model?: string;
    snapshotPngBase64?: string;
  }

// host -> webview
| { type: 'pdfDiscussionModels'; models: PdfDiscussionModelSnapshot[]; requestId?: string; error?: string }
```

Route `pdfDiscussionListModels` only after consent; on failure return an empty catalog plus a sanitized actionable error:

```ts
case 'pdfDiscussionListModels': {
  this.assertPdfDiscussionConsent();
  try {
    const models = await controller.listModels();
    await this.postDiscussionMessage(webview, {
      type: 'pdfDiscussionModels', models, requestId: message.requestId,
    });
  } catch (cause) {
    await this.postDiscussionMessage(webview, {
      type: 'pdfDiscussionModels',
      models: [],
      error: cause instanceof Error ? cause.message : 'Codex models are unavailable.',
      requestId: message.requestId,
    });
  }
  return;
}
```

Normalize `model` with the same 8 KiB string limit as questions, reject empty values, and rely on the controller's current-catalog check for authorization.

- [ ] **Step 6: Run controller and host tests plus parity checks**

Run: `pnpm --filter human-learning-vscode test`

Run: `cmp packages/vscode-extension/src/pdfDiscussionController.ts packages/vscode-pdf-extension/src/pdfDiscussionController.ts && cmp packages/vscode-extension/src/pdfDiscussionProtocol.ts packages/vscode-pdf-extension/src/pdfDiscussionProtocol.ts && cmp packages/vscode-extension/src/pdfEditorProvider.ts packages/vscode-pdf-extension/src/pdfEditorProvider.ts`

Expected: tests PASS and every `cmp` exits 0.

- [ ] **Step 7: Commit controller and protocol increment**

```bash
git add packages/vscode-extension/src packages/vscode-pdf-extension/src packages/vscode-extension/test/pdfDiscussionController.test.mjs packages/vscode-extension/test/pdfDiscussionHostIntegration.test.mjs
git commit -m "feat: make Ask PDF turns model-aware"
```

---

### Task 4: Stable Codex-Quiet Semantic View

**Files:**
- Create: `packages/vscode-extension/webview-src/pdfAskPanelView.ts`
- Create: `packages/vscode-pdf-extension/webview-src/pdfAskPanelView.ts`
- Create: `packages/vscode-extension/webview-src/pdfAskPanelStyles.ts`
- Create: `packages/vscode-pdf-extension/webview-src/pdfAskPanelStyles.ts`
- Modify: `packages/vscode-extension/webview-src/pdfAskPanel.ts`
- Modify: `packages/vscode-pdf-extension/webview-src/pdfAskPanel.ts`
- Test: `packages/vscode-extension/test/e2e/ask-pdf.spec.ts`

**Interfaces:**
- Produces: `AskPdfViewModel`, `AskPdfViewEvent`, `AskPdfPanelView`
- Produces: `createAskPdfPanelView(onEvent): AskPdfPanelView`
- Produces: `installAskPdfPanelStyles(): void`
- Consumes: existing sanitized Markdown renderer and controller host messages

- [ ] **Step 1: Add failing semantic Playwright assertions**

```ts
test('Ask PDF renders a stable Codex-quiet semantic conversation surface', async ({ page }) => {
  await openPdf(page);
  await openAnsweredDiscussion(page);
  const panel = page.getByRole('complementary', { name: 'Ask about selection' });
  await expect(panel.getByRole('heading', { name: 'Ask about selection' })).toBeVisible();
  await expect(panel.locator('details[data-ask-source]')).not.toHaveAttribute('open', '');
  await expect(panel.getByText('YOU')).toHaveCount(0);
  await expect(panel.getByText('CODEX')).toHaveCount(0);
  await expect(panel.getByTestId('ask-pdf-attachment')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Send question' }).locator('svg')).toHaveCount(1);
});
```

Add concrete tests for source expansion, text-only fallback, stable textarea identity/focus during deltas, model selection and running disablement, minimize/restore, overflow reset/close, SVG Stop transition, overlay/full-width layout, and reduced motion. The stability assertion must capture and compare the same textarea node:

```ts
const sameComposerNode = await panel.getByRole('textbox', { name: 'Ask a follow-up' })
  .evaluate(element => {
    (window as any).__askComposerNode = element;
    return true;
  });
expect(sameComposerNode).toBe(true);
await postHost(page, { type: 'pdfDiscussionDelta', annotationId: cited.id, delta: 'streamed' });
await expect.poll(() => panel.getByRole('textbox', { name: 'Ask a follow-up' })
  .evaluate(element => element === (window as any).__askComposerNode)).toBe(true);
await expect(panel.getByRole('textbox', { name: 'Ask a follow-up' })).toBeFocused();
```

- [ ] **Step 2: Run the Ask PDF Playwright spec and confirm semantic failures**

Run: `pnpm --filter human-learning-vscode build && pnpm exec playwright test packages/vscode-extension/test/e2e/ask-pdf.spec.ts --project=chromium`

Expected: FAIL on the new heading/details/model/SVG/stability assertions.

- [ ] **Step 3: Create typed view contracts and one stable DOM tree**

```ts
export interface AskPdfViewModel {
  mode: 'draft' | 'discussion' | 'overview';
  header: AskPdfHeaderModel;
  source?: AskPdfSourceModel;
  messages: AskPdfMessageModel[];
  streamingMarkdown?: string;
  composer: AskPdfComposerModel;
  actions: AskPdfActionModel[];
  notice?: AskPdfNoticeModel;
  consent?: AskPdfConsentModel;
  minimized: boolean;
  responsiveMode: 'floating' | 'overlay' | 'full-width';
}

export type AskPdfViewEvent =
  | { type: 'changeDraft'; value: string }
  | { type: 'selectModel'; model: string | undefined }
  | { type: 'submit' }
  | { type: 'stop' }
  | { type: 'retry' }
  | { type: 'toggleSource'; expanded: boolean }
  | { type: 'copyPortableLink' }
  | { type: 'openPortableLink' }
  | { type: 'openTranscriptLink'; href: string }
  | { type: 'promote' }
  | { type: 'openPromotedTask' }
  | { type: 'acceptConsent' }
  | { type: 'minimize' }
  | { type: 'close' }
  | { type: 'resetPosition' };
```

Create the `<aside>`, header, controlled `<details>`, ordered transcript, persistent textarea, model menu, SVG send/stop button, notice, consent region, promotion action, ARIA live region, drag handle, and resize handle once. Update keyed message nodes by message ID and keep a separate `active-stream` node.

- [ ] **Step 4: Install the approved local token/style layer**

```ts
const ASK_PDF_STYLE_ID = 'human-learning-ask-pdf-styles';

export function installAskPdfPanelStyles(): void {
  if (document.getElementById(ASK_PDF_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = ASK_PDF_STYLE_ID;
  style.textContent = `
    :root {
      --ask-panel-bg: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      --ask-source-accent: #4dabf7;
      --ask-agent-accent: #e88968;
      --ask-radius-panel: 16px;
      --ask-radius-card: 12px;
      --ask-radius-control: 8px;
    }
    .ask-pdf-panel { border-radius: var(--ask-radius-panel); }
    @media (max-width: 620px) { .ask-pdf-panel { inset: auto 0 0 !important; width: 100% !important; } }
    @media (prefers-reduced-motion: reduce) { .ask-pdf-running { animation: none !important; } }
  `;
  document.head.appendChild(style);
}
```

The installed stylesheet must cover the approved shell, source card, open assistant content, compact user bubble, composer, model menu, minimized chip states, high-contrast borders, responsive rules, and quiet resize handles. Use only the semantic class names emitted by `pdfAskPanelView.ts`; do not load external assets or fonts.

- [ ] **Step 5: Convert `PdfAskPanelController` into the view-model adapter**

Instantiate the view once, append `view.element` to the viewer shell, map controller state to immutable `AskPdfViewModel`, and handle every `AskPdfViewEvent`. Keep marker layers, crop capture, annotation-owned geometry, navigation, pending request correlation, host message parsing, and webview-state persistence in `pdfAskPanel.ts`.

On first consented panel open send `pdfDiscussionListModels`; use the catalog default unless `annotation.lastTurn.model` is still available; include `selectedModel` in `pdfDiscussionSubmit`; keep the current picker usable with **Default model** when the catalog fails.

- [ ] **Step 6: Run semantic and interaction tests**

Run: `pnpm --filter human-learning-vscode build && pnpm exec playwright test packages/vscode-extension/test/e2e/ask-pdf.spec.ts --project=chromium`

Expected: semantic, streaming, model-picker, drag/resize, minimized, responsive, and accessibility tests PASS.

- [ ] **Step 7: Verify mirrored webview sources and bundle constraints**

Run: `cmp packages/vscode-extension/webview-src/pdfAskPanel.ts packages/vscode-pdf-extension/webview-src/pdfAskPanel.ts && cmp packages/vscode-extension/webview-src/pdfAskPanelView.ts packages/vscode-pdf-extension/webview-src/pdfAskPanelView.ts && cmp packages/vscode-extension/webview-src/pdfAskPanelStyles.ts packages/vscode-pdf-extension/webview-src/pdfAskPanelStyles.ts`

Run: `git diff -- package.json pnpm-lock.yaml packages/vscode-extension/package.json packages/vscode-pdf-extension/package.json`

Expected: all `cmp` commands exit 0 and no presentation dependency was added.

- [ ] **Step 8: Commit the presentation increment**

```bash
git add packages/vscode-extension/webview-src packages/vscode-pdf-extension/webview-src packages/vscode-extension/test/e2e/ask-pdf.spec.ts
git commit -m "feat: redesign Ask PDF with Codex-quiet UI"
```

---

### Task 5: Visual Baselines, Regression Coverage, and Documentation

**Files:**
- Modify: `packages/vscode-extension/test/e2e/ask-pdf.spec.ts`
- Replace: `packages/vscode-extension/test/e2e/ask-pdf.spec.ts-snapshots/ask-pdf-answered-desktop-darwin.png`
- Replace: `packages/vscode-extension/test/e2e/ask-pdf.spec.ts-snapshots/ask-pdf-answered-narrow-darwin.png`
- Create: additional deterministic Ask PDF PNG baselines referenced by the spec
- Modify: `docs/PDF viewer detail.md`

**Interfaces:**
- Consumes: deterministic fake model catalog and completed fake app-server turns
- Produces: stable visual and regression gates for both extension bundles

- [ ] **Step 1: Add deterministic visual states**

Add screenshot tests for:

```ts
await expect(panel).toHaveScreenshot('ask-pdf-running-desktop.png', { animations: 'disabled' });
await sourceDetails.evaluate(element => { element.open = true; element.dispatchEvent(new Event('toggle')); });
await expect(panel).toHaveScreenshot('ask-pdf-source-expanded.png', { animations: 'disabled' });
await minimizeButton.click();
await expect(page.getByRole('button', { name: /Restore PDF discussion/ })).toHaveScreenshot('ask-pdf-minimized-answered.png', { animations: 'disabled' });
```

Also cover a failed turn with Retry and a narrow full-width overlay.

- [ ] **Step 2: Run screenshot tests before updating baselines**

Run: `pnpm exec playwright test packages/vscode-extension/test/e2e/ask-pdf.spec.ts --project=chromium`

Expected: only intentional Ask PDF screenshot comparisons FAIL; semantic assertions PASS.

- [ ] **Step 3: Update and inspect baselines**

Run: `pnpm exec playwright test packages/vscode-extension/test/e2e/ask-pdf.spec.ts --project=chromium --update-snapshots`

Inspect every generated PNG for white PDF pages, blue source provenance, warm running state, quiet transcript hierarchy, visible SVG control, model picker, focus outline, and absence of fixed-side-panel behavior.

- [ ] **Step 4: Run standalone and viewer regression suites**

Run: `pnpm --filter human-learning-vscode test:e2e`

Run: `pnpm exec playwright test packages/vscode-extension/test/e2e/pdf-viewer.spec.ts packages/vscode-extension/test/e2e/ask-pdf.spec.ts --project=chromium`

Expected: single-page navigation, text-layer alignment, context menu, white pages, existing highlight colors, and Ask PDF all PASS.

- [ ] **Step 5: Document model behavior and local-only storage**

Document that Ask PDF loads the visible signed-in Codex catalog, defaults to the account's current model, persists the annotation's most recent selected model, falls back safely when that model disappears, and does not force the lightweight model onto promoted tasks.

- [ ] **Step 6: Commit verification assets and docs**

```bash
git add packages/vscode-extension/test/e2e/ask-pdf.spec.ts packages/vscode-extension/test/e2e/ask-pdf.spec.ts-snapshots docs/PDF\ viewer\ detail.md
git commit -m "test: cover Codex-quiet Ask PDF workflow"
```

---

### Task 6: Full Verification and Real Logged-In Smoke Test

**Files:**
- No planned source edits; fix only failures attributable to Tasks 1–5.

**Interfaces:**
- Consumes: complete combined and standalone Ask PDF implementation
- Produces: release-quality evidence for the acceptance criteria

- [ ] **Step 1: Run required automated verification**

```bash
pnpm --filter @human-learning/core test
pnpm --filter human-learning-vscode test
pnpm --filter human-learning-vscode test:e2e
pnpm --filter human-learning-vscode test:vscode-e2e
pnpm build:extension
pnpm build:pdf-extension
```

Expected: every command exits 0. CI continues to use only the fake app server.

- [ ] **Step 2: Run parity and dependency checks**

```bash
cmp packages/vscode-extension/src/codexAppServerClient.ts packages/vscode-pdf-extension/src/codexAppServerClient.ts
cmp packages/vscode-extension/src/pdfDiscussionController.ts packages/vscode-pdf-extension/src/pdfDiscussionController.ts
cmp packages/vscode-extension/src/pdfDiscussionProtocol.ts packages/vscode-pdf-extension/src/pdfDiscussionProtocol.ts
cmp packages/vscode-extension/src/pdfEditorProvider.ts packages/vscode-pdf-extension/src/pdfEditorProvider.ts
cmp packages/vscode-extension/webview-src/pdfAskPanel.ts packages/vscode-pdf-extension/webview-src/pdfAskPanel.ts
cmp packages/vscode-extension/webview-src/pdfAskPanelView.ts packages/vscode-pdf-extension/webview-src/pdfAskPanelView.ts
cmp packages/vscode-extension/webview-src/pdfAskPanelStyles.ts packages/vscode-pdf-extension/webview-src/pdfAskPanelStyles.ts
git diff --check
```

Expected: all comparisons and diff checks exit 0.

- [ ] **Step 3: Smoke-test the combined extension through Computer Use**

Use the dedicated Extension Development Host and `/Users/t04dj14n9/Downloads/_OceanofPDF.com_Game_Engine_Architecture_4th_Edtion_Volume_2_-_Jason_Gregory.pdf`:

1. Select the fourth-edition paragraph on page 2.
2. Open **Ask about selection…** and confirm the floating window is annotation-adjacent, movable, and resizable.
3. Expand the source card and verify crop, exact quote, context, and portable link.
4. Select a non-default visible Codex model.
5. Ask a real question and verify stream, SVG Stop, final persistence, and model provenance.
6. Minimize to the annotation chip, restore, close/reopen the PDF, and ask a follow-up.
7. Promote and open the normal Codex task.

- [ ] **Step 4: Smoke-test the standalone PDF extension**

Repeat selection, model choice, real question, streaming, minimize, restore, and PDF reopen using the standalone PDF extension build.

- [ ] **Step 5: Review final worktree scope**

Run: `git status --short` and `git diff --stat HEAD~5..HEAD`

Expected: only planned source, tests, snapshots, and documentation are committed; pre-existing `artifacts/` and live fixture residue remain untracked and untouched.

- [ ] **Step 6: Commit any verification-only correction**

If verification required a source correction, stage only its exact planned files and commit with `fix: correct Codex-quiet Ask PDF verification issue`. If no correction was required, do not create an empty commit.
