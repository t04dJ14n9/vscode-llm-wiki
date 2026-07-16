import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_TURN_TIMEOUT_MS = 10 * 60 * 1000;
export const MINIMUM_CODEX_CLI_VERSION = '0.144.1';
const MINIMUM_CODEX_CLI_VERSION_PARTS: [number, number, number] = [0, 144, 1];

export type CodexAppServerErrorCode =
  | 'disposed'
  | 'executable-not-found'
  | 'malformed-response'
  | 'process-error'
  | 'process-exited'
  | 'request-timeout'
  | 'rpc-error'
  | 'unauthenticated'
  | 'unsupported-version';

export class CodexAppServerError extends Error {
  readonly code: CodexAppServerErrorCode;

  constructor(code: CodexAppServerErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export class CodexExecutableNotFoundError extends CodexAppServerError {
  readonly executable: string;

  constructor(executable: string, cause?: unknown) {
    super(
      'executable-not-found',
      'Codex executable was not found at the configured path: ' + executable,
      cause,
    );
    this.executable = executable;
  }
}

export type CodexProcessErrorCode = 'malformed-response' | 'process-error' | 'process-exited';

export class CodexProcessError extends CodexAppServerError {
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;

  constructor(
    code: CodexProcessErrorCode,
    message: string,
    options: {
      cause?: unknown;
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
    } = {},
  ) {
    super(code, message, options.cause);
    this.exitCode = options.exitCode;
    this.signal = options.signal;
  }
}

export class CodexRpcError extends CodexAppServerError {
  readonly method: string;
  readonly rpcCode: number;
  readonly data?: unknown;

  constructor(method: string, rpcCode: number, message: string, data?: unknown) {
    super('rpc-error', message || 'Codex app-server request failed.');
    this.method = method;
    this.rpcCode = rpcCode;
    this.data = data;
  }
}

export class CodexUnauthenticatedError extends CodexAppServerError {
  readonly method: string;
  readonly rpcCode?: number;
  readonly data?: unknown;

  constructor(method: string, rpcCode?: number, data?: unknown) {
    super(
      'unauthenticated',
      'Codex is not authenticated. Sign in with `codex login`, then retry.',
    );
    this.method = method;
    this.rpcCode = rpcCode;
    this.data = data;
  }
}

export class CodexUnsupportedVersionError extends CodexAppServerError {
  readonly detectedVersion?: string;
  readonly minimumVersion: string;

  constructor(detectedVersion?: string) {
    super(
      'unsupported-version',
      detectedVersion
        ? 'Codex CLI ' + detectedVersion + ' is unsupported. Update the Codex CLI to '
          + MINIMUM_CODEX_CLI_VERSION + ' or newer, then retry.'
        : 'The Codex CLI version could not be determined. Update the Codex CLI to '
          + MINIMUM_CODEX_CLI_VERSION + ' or newer, then retry.',
    );
    this.detectedVersion = detectedVersion;
    this.minimumVersion = MINIMUM_CODEX_CLI_VERSION;
  }
}

export class CodexRequestTimeoutError extends CodexAppServerError {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(
      'request-timeout',
      'Codex app-server request timed out after ' + timeoutMs + 'ms (' + method + ').',
    );
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class CodexClientDisposedError extends CodexAppServerError {
  constructor() {
    super('disposed', 'Codex app-server client has been disposed.');
  }
}

export type CodexDiagnosticLogger = (message: string) => void;

export interface CodexAppServerClientOptions {
  executable: string;
  extensionVersion: string;
  logger?: CodexDiagnosticLogger;
  requestTimeoutMs?: number;
  turnTimeoutMs?: number;
}

export interface RequestOptions {
  timeoutMs?: number;
}

export interface InitializeResponse {
  codexHome: string;
  platformFamily: string;
  platformOs: string;
  userAgent: string;
}

export interface AccountReadParams {
  refreshToken: false;
}

export interface CodexAccount {
  type: string;
  [key: string]: unknown;
}

export interface AccountReadResponse {
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
}

export interface ModelListParams {
  cursor?: string | null;
  limit?: number | null;
  includeHidden?: boolean | null;
}

export interface ModelListResponse {
  data: CodexModel[];
  nextCursor?: string | null;
}

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface GranularApprovalPolicy {
  granular: {
    mcp_elicitations: boolean;
    request_permissions?: boolean;
    rules: boolean;
    sandbox_approval: boolean;
    skill_approval?: boolean;
  };
}

export type ApprovalPolicy = 'untrusted' | 'on-request' | 'never' | GranularApprovalPolicy;

export interface ThreadStartParams {
  model?: string | null;
  ephemeral?: boolean | null;
  cwd?: string | null;
  sandbox?: SandboxMode | null;
  approvalPolicy?: ApprovalPolicy | null;
  developerInstructions?: string | null;
  config?: Record<string, unknown> | null;
}

export interface CodexThreadStatus {
  type: 'notLoaded' | 'idle' | 'systemError' | 'active';
  activeFlags?: unknown[];
}

export interface CodexTurnError {
  message: string;
  additionalDetails?: string | null;
  codexErrorInfo?: unknown;
}

export interface CodexThreadItem {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface CodexTurn {
  id: string;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  items: CodexThreadItem[];
  completedAt?: number | null;
  durationMs?: number | null;
  error?: CodexTurnError | null;
  itemsView?: 'notLoaded' | 'summary' | 'full';
  startedAt?: number | null;
}

export interface CodexThread {
  id: string;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: CodexThreadStatus;
  cwd: string;
  cliVersion: string;
  source: unknown;
  turns: CodexTurn[];
  sessionId: string;
  agentNickname?: string | null;
  agentRole?: string | null;
  forkedFromId?: string | null;
  gitInfo?: unknown;
  name?: string | null;
  parentThreadId?: string | null;
  path?: string | null;
  recencyAt?: number | null;
  threadSource?: string | null;
}

export interface ThreadStartResponse {
  thread: CodexThread;
  model: string;
  modelProvider: string;
  cwd: string;
  approvalPolicy: ApprovalPolicy;
  approvalsReviewer: 'user' | 'auto_review' | 'guardian_subagent';
  sandbox: { type: string; [key: string]: unknown };
  instructionSources?: string[];
  reasoningEffort?: string | null;
  serviceTier?: string | null;
}

export type StartThreadResult = ThreadStartResponse & { threadId: string };

export interface TextElement {
  byteRange: {
    start: number;
    end: number;
  };
  placeholder?: string | null;
}

export interface TextUserInput {
  type: 'text';
  text: string;
  text_elements?: TextElement[];
}

export interface LocalImageUserInput {
  type: 'localImage';
  path: string;
  detail?: 'auto' | 'low' | 'high' | 'original' | null;
}

export type TurnUserInput = TextUserInput | LocalImageUserInput;

export interface TurnStartParams {
  threadId: string;
  input: TurnUserInput[];
  model?: string | null;
}

export interface TurnStartResponse {
  turn: CodexTurn;
}

export type StartTurnResult = TurnStartResponse & {
  threadId: string;
  turnId: string;
};

export interface AgentMessageDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ItemCompletedNotification {
  threadId: string;
  turnId: string;
  item: CodexThreadItem;
  completedAtMs: number;
}

export interface TurnCompletedNotification {
  threadId: string;
  turn: CodexTurn;
}

export interface ErrorNotification {
  threadId: string;
  turnId: string;
  error: CodexTurnError;
  willRetry: boolean;
}

export interface CodexNotificationMap {
  'item/agentMessage/delta': AgentMessageDeltaNotification;
  'item/completed': ItemCompletedNotification;
  'turn/completed': TurnCompletedNotification;
  error: ErrorNotification;
}

export interface CodexDisposable {
  dispose(): void;
}

interface RpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

interface PendingRequest {
  method: string;
  startedAt: number;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

interface ProcessState {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  readySettled: boolean;
  failed: boolean;
  failure?: Error;
  stdoutBuffer: string;
  pending: Map<number, PendingRequest>;
  initializePromise?: Promise<InitializeResponse>;
}

type NotificationListener = (params: unknown) => void;
type TransportErrorListener = (error: Error) => void;

export class CodexAppServerClient {
  private readonly executable: string;
  private readonly extensionVersion: string;
  private readonly logger?: CodexDiagnosticLogger;
  private readonly requestTimeoutMs: number;
  private readonly turnTimeoutMs: number;
  private current?: ProcessState;
  private nextRequestId = 1;
  private disposed = false;
  private readonly notificationListeners = new Map<string, Set<NotificationListener>>();
  private readonly transportErrorListeners = new Set<TransportErrorListener>();

  constructor(options: CodexAppServerClientOptions) {
    if (!options.executable) {
      throw new TypeError('Codex executable path is required.');
    }
    if (!options.extensionVersion) {
      throw new TypeError('Extension version is required.');
    }
    this.executable = options.executable;
    this.extensionVersion = options.extensionVersion;
    this.logger = options.logger;
    this.requestTimeoutMs = validTimeout(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      'requestTimeoutMs',
    );
    this.turnTimeoutMs = validTimeout(
      options.turnTimeoutMs,
      DEFAULT_TURN_TIMEOUT_MS,
      'turnTimeoutMs',
    );
  }

  async initialize(): Promise<InitializeResponse> {
    const initialized = await this.ensureInitializedState();
    return initialized.result;
  }

  async listModels(options: RequestOptions = {}): Promise<CodexModel[]> {
    const { state } = await this.ensureInitializedState();
    const models: CodexModel[] = [];
    let cursor: string | null | undefined;
    do {
      const params: ModelListParams = { includeHidden: false };
      copyDefined(params, 'cursor', cursor);
      const response = await this.request<ModelListResponse>(
        state,
        'model/list',
        params,
        validTimeout(options.timeoutMs, this.requestTimeoutMs, 'timeoutMs'),
      );
      models.push(...response.data);
      cursor = response.nextCursor;
    } while (cursor);
    return models;
  }

  async startThread(
    params: ThreadStartParams,
    options: RequestOptions = {},
  ): Promise<StartThreadResult> {
    const { state } = await this.ensureInitializedState();
    const wireParams: ThreadStartParams = {};
    copyDefined(wireParams, 'model', params.model);
    copyDefined(wireParams, 'ephemeral', params.ephemeral);
    copyDefined(wireParams, 'cwd', params.cwd);
    copyDefined(wireParams, 'sandbox', params.sandbox);
    copyDefined(wireParams, 'approvalPolicy', params.approvalPolicy);
    copyDefined(wireParams, 'developerInstructions', params.developerInstructions);
    copyDefined(wireParams, 'config', params.config);
    const response = await this.request<ThreadStartResponse>(
      state,
      'thread/start',
      wireParams,
      validTimeout(options.timeoutMs, this.requestTimeoutMs, 'timeoutMs'),
    );
    return { ...response, threadId: response.thread.id };
  }

  async startTurn(
    params: TurnStartParams,
    options: RequestOptions = {},
  ): Promise<StartTurnResult> {
    const { state } = await this.ensureInitializedState();
    const wireParams: TurnStartParams = {
      threadId: params.threadId,
      input: params.input,
    };
    copyDefined(wireParams, 'model', params.model);
    const response = await this.request<TurnStartResponse>(
      state,
      'turn/start',
      wireParams,
      validTimeout(options.timeoutMs, this.turnTimeoutMs, 'timeoutMs'),
    );
    return {
      ...response,
      threadId: params.threadId,
      turnId: response.turn.id,
    };
  }

  async interruptTurn(
    threadId: string,
    turnId: string,
    options: RequestOptions = {},
  ): Promise<void> {
    const { state } = await this.ensureInitializedState();
    await this.request<Record<string, never>>(
      state,
      'turn/interrupt',
      { threadId, turnId },
      validTimeout(options.timeoutMs, this.requestTimeoutMs, 'timeoutMs'),
    );
  }

  onNotification<K extends keyof CodexNotificationMap>(
    method: K,
    listener: (params: CodexNotificationMap[K]) => void,
  ): CodexDisposable;
  onNotification(method: string, listener: (params: unknown) => void): CodexDisposable;
  onNotification(method: string, listener: NotificationListener): CodexDisposable {
    let listeners = this.notificationListeners.get(method);
    if (!listeners) {
      listeners = new Set();
      this.notificationListeners.set(method, listeners);
    }
    listeners.add(listener);
    let active = true;
    return {
      dispose: () => {
        if (!active) return;
        active = false;
        listeners?.delete(listener);
        if (listeners?.size === 0) this.notificationListeners.delete(method);
      },
    };
  }

  onTransportError(listener: TransportErrorListener): CodexDisposable {
    this.transportErrorListeners.add(listener);
    let active = true;
    return {
      dispose: () => {
        if (!active) return;
        active = false;
        this.transportErrorListeners.delete(listener);
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const state = this.current;
    if (state) {
      this.failProcess(state, new CodexClientDisposedError(), true);
    }
    this.notificationListeners.clear();
    this.transportErrorListeners.clear();
    this.logDiagnostic('Codex app-server client disposed.');
  }

  private async ensureInitializedState(): Promise<{
    state: ProcessState;
    result: InitializeResponse;
  }> {
    const state = await this.getProcess();
    if (!state.initializePromise) {
      state.initializePromise = this.initializeProcess(state);
    }
    const result = await state.initializePromise;
    if (state.failed) {
      throw state.failure ?? new CodexProcessError(
        'process-error',
        'Codex app-server became unavailable during initialization.',
      );
    }
    return { state, result };
  }

  private async initializeProcess(state: ProcessState): Promise<InitializeResponse> {
    try {
      const result = await this.request<InitializeResponse>(
        state,
        'initialize',
        {
          clientInfo: {
            name: 'human-learning-pdf',
            title: 'Human Learning PDF',
            version: this.extensionVersion,
          },
        },
        this.requestTimeoutMs,
      );
      assertSupportedCodexCliVersion(result);
      await this.writeMessage(state, { method: 'initialized' });
      const account = await this.request<AccountReadResponse>(
        state,
        'account/read',
        { refreshToken: false } satisfies AccountReadParams,
        this.requestTimeoutMs,
      );
      assertAuthenticatedAccount(account);
      this.logDiagnostic('Codex app-server process initialized.');
      return result;
    } catch (cause) {
      const error = asError(cause);
      if (!state.failed) this.failProcess(state, error, true);
      throw error;
    }
  }

  private async getProcess(): Promise<ProcessState> {
    if (this.disposed) throw new CodexClientDisposedError();
    let state = this.current;
    if (!state) {
      state = this.spawnProcess();
      this.current = state;
    }
    await state.ready;
    if (state.failed) {
      throw state.failure ?? new CodexProcessError(
        'process-error',
        'Codex app-server failed to start.',
      );
    }
    return state;
  }

  private spawnProcess(): ProcessState {
    this.logDiagnostic('Codex app-server process starting.');
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.executable, ['app-server', '--listen', 'stdio://'], {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (cause) {
      const error = this.classifyProcessError(cause);
      this.logDiagnostic(
        'Codex app-server process failed (code=' + diagnosticErrorCode(error) + ').',
      );
      throw error;
    }

    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const state: ProcessState = {
      child,
      ready,
      resolveReady,
      rejectReady,
      readySettled: false,
      failed: false,
      stdoutBuffer: '',
      pending: new Map(),
    };

    child.once('spawn', () => {
      if (state.readySettled) return;
      state.readySettled = true;
      state.resolveReady();
      this.logDiagnostic('Codex app-server process started.');
    });
    child.once('error', cause => {
      this.failProcess(state, this.classifyProcessError(cause), true);
    });
    child.once('exit', (code, signal) => {
      this.failProcess(
        state,
        new CodexProcessError(
          'process-exited',
          'Codex app-server exited (code ' +
            (code ?? 'null') +
            ', signal ' +
            (signal ?? 'null') +
            ').',
          { exitCode: code, signal },
        ),
        false,
      );
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.handleStdout(state, String(chunk)));
    child.stdout.on('error', cause => {
      this.failProcess(
        state,
        new CodexProcessError('process-error', 'Codex app-server stdout failed.', { cause }),
        true,
      );
    });
    child.stdout.once('end', () => {
      const grace = setTimeout(() => {
        if (state.failed || child.exitCode !== null || child.signalCode !== null) return;
        this.failProcess(
          state,
          new CodexProcessError('process-error', 'Codex app-server stdout closed unexpectedly.'),
          true,
        );
      }, 25);
      grace.unref();
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      const byteCount = Buffer.byteLength(String(chunk), 'utf8');
      this.logDiagnostic('Codex app-server stderr output received (' + byteCount + ' bytes).');
    });
    child.stderr.on('error', cause => {
      this.failProcess(
        state,
        new CodexProcessError('process-error', 'Codex app-server stderr failed.', { cause }),
        true,
      );
    });
    child.stdin.on('error', cause => {
      this.failProcess(
        state,
        new CodexProcessError(
          'process-error',
          'Codex app-server stdin failed.',
          { cause },
        ),
        true,
      );
    });
    return state;
  }

  private request<T>(
    state: ProcessState,
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new CodexClientDisposedError());
    if (state.failed) {
      return Promise.reject(
        state.failure ?? new CodexProcessError('process-error', 'Codex app-server is unavailable.'),
      );
    }

    const id = this.nextRequestId++;
    const startedAt = Date.now();
    this.logDiagnostic(
      'Codex app-server request started (id=' + id + ', method=' + method + ').',
    );
    const response = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = state.pending.get(id);
        if (!pending) return;
        state.pending.delete(id);
        const error = new CodexRequestTimeoutError(method, timeoutMs);
        this.logRequestFailure(id, pending, error);
        reject(error);
      }, timeoutMs);
      timeout.unref();
      state.pending.set(id, {
        method,
        startedAt,
        resolve: value => resolve(value as T),
        reject,
        timeout,
      });
    });

    void this.writeMessage(state, { id, method, params }).catch(cause => {
      const pending = state.pending.get(id);
      if (!pending) return;
      state.pending.delete(id);
      clearTimeout(pending.timeout);
      const error = asError(cause);
      this.logRequestFailure(id, pending, error);
      pending.reject(error);
    });
    return response;
  }

  private async writeMessage(state: ProcessState, message: unknown): Promise<void> {
    if (state.failed) {
      throw state.failure ?? new CodexProcessError(
        'process-error',
        'Codex app-server is unavailable.',
      );
    }
    const line = JSON.stringify(message) + '\n';
    await new Promise<void>((resolve, reject) => {
      try {
        state.child.stdin.write(line, 'utf8', cause => {
          if (!cause) {
            resolve();
            return;
          }
          const error = new CodexProcessError(
            'process-error',
            'Unable to write to Codex app-server.',
            { cause },
          );
          this.failProcess(state, error, true);
          reject(error);
        });
      } catch (cause) {
        const error = new CodexProcessError(
          'process-error',
          'Unable to write to Codex app-server.',
          { cause },
        );
        this.failProcess(state, error, true);
        reject(error);
      }
    });
  }

  private handleStdout(state: ProcessState, chunk: string): void {
    if (state.failed) return;
    state.stdoutBuffer += chunk;
    while (!state.failed) {
      const newline = state.stdoutBuffer.indexOf('\n');
      if (newline < 0) return;
      const line = state.stdoutBuffer.slice(0, newline).replace(/\r$/, '');
      state.stdoutBuffer = state.stdoutBuffer.slice(newline + 1);
      if (!line) continue;

      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch (cause) {
        this.rejectMalformedStdout(state, cause);
        return;
      }
      if (!isRecord(message)) {
        this.rejectMalformedStdout(state);
        return;
      }

      if (typeof message.method === 'string') {
        if ('id' in message) {
          if (!isRpcRequestId(message.id)) {
            this.rejectMalformedStdout(state);
            return;
          }
          this.rejectUnsupportedServerRequest(state, message.id);
        } else {
          this.dispatchNotification(message.method, message.params);
        }
        continue;
      }
      if ('id' in message) {
        if (!Number.isSafeInteger(message.id)) {
          this.rejectMalformedStdout(state);
          return;
        }
        this.handleResponse(state, message.id as number, message);
        continue;
      }
      this.rejectMalformedStdout(state);
      return;
    }
  }

  private handleResponse(
    state: ProcessState,
    id: number,
    message: Record<string, unknown>,
  ): void {
    const pending = state.pending.get(id);
    if (!pending) return;
    state.pending.delete(id);
    clearTimeout(pending.timeout);

    if ('error' in message) {
      const error = parseRpcError(message.error);
      if (!error) {
        const malformedError = new CodexProcessError(
          'malformed-response',
          'Codex app-server returned a malformed RPC error.',
        );
        this.logRequestFailure(id, pending, malformedError);
        pending.reject(malformedError);
        this.rejectMalformedStdout(state);
        return;
      }
      const requestError = isAuthenticationRpcError(error)
        ? new CodexUnauthenticatedError(pending.method, error.code, error.data)
        : new CodexRpcError(pending.method, error.code, error.message, error.data);
      this.logRequestFailure(id, pending, requestError);
      pending.reject(requestError);
      return;
    }
    if (!('result' in message)) {
      const malformedError = new CodexProcessError(
        'malformed-response',
        'Codex app-server returned a response without a result.',
      );
      this.logRequestFailure(id, pending, malformedError);
      pending.reject(malformedError);
      this.rejectMalformedStdout(state);
      return;
    }
    this.logDiagnostic(
      'Codex app-server request completed (id=' + id
        + ', method=' + pending.method
        + ', latencyMs=' + elapsedMilliseconds(pending.startedAt) + ').',
    );
    pending.resolve(message.result);
  }

  private rejectUnsupportedServerRequest(
    state: ProcessState,
    id: string | number,
  ): void {
    void this.writeMessage(state, {
      id,
      error: {
        code: -32601,
        message: 'This client does not support server-initiated requests.',
      },
    }).catch(() => undefined);
  }

  private dispatchNotification(method: string, params: unknown): void {
    this.logNotificationDiagnostic(method, params);
    const listeners = this.notificationListeners.get(method);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(params);
      } catch {
        // Notification consumers are isolated from the transport.
      }
    }
  }

  private logNotificationDiagnostic(method: string, params: unknown): void {
    if (!isRecord(params)) return;
    if (method === 'error') {
      const error = isRecord(params.error) ? params.error : undefined;
      const status = params.willRetry === true
        ? 'retrying'
        : params.willRetry === false
          ? 'failed'
          : 'unknown';
      this.logDiagnostic(
        'Codex app-server error notification (threadId='
          + diagnosticIdentifier(params.threadId)
          + ', turnId=' + diagnosticIdentifier(params.turnId)
          + ', status=' + status
          + ', category=' + diagnosticErrorCategory(error?.codexErrorInfo) + ').',
      );
      return;
    }
    if (method !== 'turn/completed' || !isRecord(params.turn)) return;
    const turn = params.turn;
    if (turn.status !== 'failed') return;
    const error = isRecord(turn.error) ? turn.error : undefined;
    this.logDiagnostic(
      'Codex app-server turn completed (threadId='
        + diagnosticIdentifier(params.threadId)
        + ', turnId=' + diagnosticIdentifier(turn.id)
        + ', status=failed, category='
        + diagnosticErrorCategory(error?.codexErrorInfo) + ').',
    );
  }

  private rejectMalformedStdout(state: ProcessState, cause?: unknown): void {
    this.failProcess(
      state,
      new CodexProcessError(
        'malformed-response',
        'Codex app-server produced malformed stdout.',
        { cause },
      ),
      true,
    );
  }

  private failProcess(state: ProcessState, error: Error, terminate: boolean): void {
    if (state.failed) return;
    state.failed = true;
    state.failure = error;
    this.logDiagnostic(
      error instanceof CodexClientDisposedError
        ? 'Codex app-server process stopped (reason=disposed).'
        : 'Codex app-server process failed (code=' + diagnosticErrorCode(error) + ').',
    );
    if (!state.readySettled) {
      state.readySettled = true;
      state.rejectReady(error);
    }
    if (this.current === state) this.current = undefined;
    for (const [id, pending] of state.pending) {
      clearTimeout(pending.timeout);
      this.logRequestFailure(id, pending, error);
      pending.reject(error);
    }
    state.pending.clear();
    for (const listener of [...this.transportErrorListeners]) {
      try {
        listener(error);
      } catch {
        // Transport consumers are isolated from process lifecycle handling.
      }
    }
    if (terminate && !state.child.killed) {
      try {
        state.child.kill();
      } catch {
        // The process has already gone away.
      }
    }
  }

  private logRequestFailure(id: number, pending: PendingRequest, error: Error): void {
    this.logDiagnostic(
      'Codex app-server request failed (id=' + id
        + ', method=' + pending.method
        + ', latencyMs=' + elapsedMilliseconds(pending.startedAt)
        + ', code=' + diagnosticErrorCode(error) + ').',
    );
  }

  private logDiagnostic(message: string): void {
    try {
      this.logger?.(message);
    } catch {
      // A diagnostic sink must not interfere with the protocol.
    }
  }

  private classifyProcessError(cause: unknown): Error {
    if (isErrnoException(cause) && cause.code === 'ENOENT') {
      return new CodexExecutableNotFoundError(this.executable, cause);
    }
    return new CodexProcessError(
      'process-error',
      'Codex app-server process failed.',
      { cause },
    );
  }
}

function copyDefined<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

function validTimeout(value: number | undefined, fallback: number, name: string): number {
  const timeout = value ?? fallback;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new RangeError(name + ' must be a positive finite number.');
  }
  return timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRpcRequestId(value: unknown): value is string | number {
  return typeof value === 'string' || Number.isSafeInteger(value);
}

function parseRpcError(value: unknown): RpcErrorPayload | undefined {
  if (!isRecord(value) || typeof value.code !== 'number' || typeof value.message !== 'string') {
    return undefined;
  }
  return {
    code: value.code,
    message: value.message,
    ...('data' in value ? { data: value.data } : {}),
  };
}

function assertSupportedCodexCliVersion(response: unknown): void {
  const userAgent = isRecord(response) && typeof response.userAgent === 'string'
    ? response.userAgent
    : undefined;
  const detected = parseCodexCliVersion(userAgent);
  if (!detected || compareVersions(detected.parts, MINIMUM_CODEX_CLI_VERSION_PARTS) < 0) {
    throw new CodexUnsupportedVersionError(detected?.version);
  }
}

function assertAuthenticatedAccount(response: unknown): asserts response is AccountReadResponse {
  if (
    !isRecord(response)
    || !('account' in response)
    || (response.account !== null && !isRecord(response.account))
    || typeof response.requiresOpenaiAuth !== 'boolean'
  ) {
    throw new CodexProcessError(
      'malformed-response',
      'Codex app-server returned a malformed account/read response.',
    );
  }
  if (response.account === null && response.requiresOpenaiAuth) {
    throw new CodexUnauthenticatedError('account/read');
  }
}

function parseCodexCliVersion(
  userAgent: string | undefined,
): { version: string; parts: [number, number, number] } | undefined {
  if (!userAgent) return undefined;
  const match = userAgent.match(
    /^\s*[A-Za-z0-9][A-Za-z0-9._ -]{0,127}\/v?(\d+)\.(\d+)\.(\d+)\b/,
  );
  if (!match) return undefined;
  return {
    version: match[1] + '.' + match[2] + '.' + match[3],
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
  };
}

function compareVersions(
  left: [number, number, number],
  right: [number, number, number],
): number {
  if (left[0] !== right[0]) return left[0] - right[0];
  if (left[1] !== right[1]) return left[1] - right[1];
  return left[2] - right[2];
}

function isAuthenticationRpcError(error: RpcErrorPayload): boolean {
  if (error.code === 401) return true;
  return containsAuthenticationMarker(error.message)
    || containsAuthenticationMarker(error.data);
}

function containsAuthenticationMarker(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (typeof value === 'string') {
    return /unauthenticated|unauthorized|authentication required|login required|not logged in|token expired/i
      .test(value);
  }
  if (Array.isArray(value)) {
    return value.some(item => containsAuthenticationMarker(item, depth + 1));
  }
  if (!isRecord(value)) return false;
  return Object.values(value).some(item => containsAuthenticationMarker(item, depth + 1));
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function diagnosticErrorCode(error: Error): CodexAppServerErrorCode | 'unknown' {
  return error instanceof CodexAppServerError ? error.code : 'unknown';
}

function diagnosticIdentifier(value: unknown): string {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    ? value
    : 'unknown';
}

function diagnosticErrorCategory(value: unknown): string {
  if (typeof value === 'string') return diagnosticIdentifier(value);
  if (!isRecord(value)) return 'unknown';
  const keys = Object.keys(value);
  return keys.length === 1 ? diagnosticIdentifier(keys[0]) : 'unknown';
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error('Unknown Codex app-server failure.');
}
