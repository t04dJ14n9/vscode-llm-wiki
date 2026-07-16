#!/usr/bin/env node

import process from 'node:process';
import { closeSync } from 'node:fs';

const EXPECTED_ARGS = ['app-server', '--listen', 'stdio://'];
const EXPECTED_CLIENT_NAME = 'human-learning-pdf';
const EXPECTED_CLIENT_TITLE = 'Human Learning PDF';
const VISIBLE_MODELS = new Set(['gpt-5.4', 'gpt-5.4-mini']);

if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(EXPECTED_ARGS)) {
  process.stderr.write('fixture: invalid app-server arguments\n');
  process.exit(64);
}

let buffer = '';
let initializeCount = 0;
let initializeResponseSent = false;
let initialized = false;
let accountReadCount = 0;
let accountReadResponseSent = false;
let clientVersion;
let lastRequestId = -1;
let turnSequence = 0;
let pendingServerRequest;
const activeTurns = new Map();

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  drainLines();
});
process.stdin.on('end', () => process.exit(0));

function drainLines() {
  while (true) {
    const newline = buffer.indexOf('\n');
    if (newline < 0) return;
    const line = buffer.slice(0, newline).replace(/\r$/, '');
    buffer = buffer.slice(newline + 1);
    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stderr.write('fixture: client sent malformed JSON\n');
      process.exit(65);
    }
    handleMessage(message);
  }
}

function handleMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    protocolFailure('fixture: client sent a non-object message');
    return;
  }
  if ('jsonrpc' in message) {
    protocolFailure('fixture: unexpected jsonrpc envelope field');
    return;
  }

  if (!('id' in message)) {
    handleNotification(message);
    return;
  }

  if (typeof message.method !== 'string') {
    handleClientResponse(message);
    return;
  }

  if (!Number.isSafeInteger(message.id) || message.id <= lastRequestId) {
    protocolFailure('fixture: request IDs must be increasing integers');
    return;
  }
  lastRequestId = message.id;

  if (message.method === 'initialize') {
    handleInitialize(message);
    return;
  }
  if (!initialized) {
    protocolFailure('fixture: request arrived before initialized notification');
    return;
  }
  if (message.method === 'account/read') {
    handleAccountRead(message);
    return;
  }
  if (!accountReadResponseSent) {
    protocolFailure('fixture: request arrived before account/read preflight');
    return;
  }

  switch (message.method) {
    case 'model/list':
      handleModelList(message);
      break;
    case 'thread/start':
      handleThreadStart(message);
      break;
    case 'turn/start':
      handleTurnStart(message);
      break;
    case 'turn/interrupt':
      handleTurnInterrupt(message);
      break;
    default:
      respondError(message.id, -32601, 'fixture method not found');
  }
}

function handleModelList(message) {
  const params = message.params ?? {};
  if (params.includeHidden !== false || ('limit' in params && params.limit !== null)) {
    respondError(message.id, -32602, 'fixture invalid model/list params');
    return;
  }
  if (params.cursor === 'page-2') {
    respond(message.id, {
      data: [model('model-fast', 'gpt-5.4-mini', 'GPT-5.4-Mini', false)],
      nextCursor: null,
    });
    return;
  }
  if (params.cursor !== undefined) {
    respondError(message.id, -32602, 'fixture invalid model/list cursor');
    return;
  }
  respond(message.id, {
    data: [model('model-default', 'gpt-5.4', 'GPT-5.4', true)],
    nextCursor: 'page-2',
  });
}

function model(id, slug, displayName, isDefault) {
  return {
    id,
    model: slug,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName,
    description: isDefault ? 'Default model' : 'Fast answers',
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: 'medium',
    inputModalities: ['text', 'image'],
    supportsPersonality: true,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault,
  };
}

function handleNotification(message) {
  if (message.method !== 'initialized') {
    protocolFailure('fixture: unexpected client notification');
    return;
  }
  if (!initializeResponseSent || initializeCount !== 1 || initialized || 'params' in message) {
    protocolFailure('fixture: invalid initialize/initialized ordering');
    return;
  }
  initialized = true;
  process.stderr.write('fixture: initialized\n');
}

function handleInitialize(message) {
  initializeCount += 1;
  if (initializeCount !== 1 || initialized) {
    respondError(message.id, -32600, 'fixture duplicate initialize');
    return;
  }
  const clientInfo = message.params?.clientInfo;
  if (
    clientInfo?.name !== EXPECTED_CLIENT_NAME
    || clientInfo?.title !== EXPECTED_CLIENT_TITLE
    || typeof clientInfo?.version !== 'string'
    || clientInfo.version.length === 0
  ) {
    respondError(message.id, -32602, 'fixture invalid clientInfo');
    return;
  }
  const userAgent = clientInfo.version === 'fixture-unsupported-version'
    ? 'codex_cli_rs/0.143.9 (fixture)'
    : clientInfo.version === 'fixture-unparseable-version'
      ? 'codex_cli_rs/version-unknown (fixture)'
      : clientInfo.version === 'fixture-desktop-version'
        ? 'Codex Desktop/0.144.1 (Mac OS 26.5.2; arm64) fixture'
        : clientInfo.version === 'fixture-integration-user-agent'
          ? 'human-learning-pdf/0.144.1 (Mac OS 26.5.2; arm64) dumb (human-learning-pdf; 0.1.0)'
          : 'codex_cli_rs/0.144.1 (fixture)';
  clientVersion = clientInfo.version;
  initializeResponseSent = true;
  respond(message.id, {
    userAgent,
    platformFamily: 'unix',
    platformOs: process.platform === 'darwin' ? 'macos' : process.platform,
    codexHome: '/tmp/fake-codex-home',
  });
}

function handleAccountRead(message) {
  accountReadCount += 1;
  if (
    accountReadCount !== 1
    || accountReadResponseSent
    || JSON.stringify(message.params) !== JSON.stringify({ refreshToken: false })
  ) {
    respondError(message.id, -32602, 'fixture invalid account/read preflight');
    return;
  }
  accountReadResponseSent = true;
  if (clientVersion === 'fixture-account-unauthenticated') {
    respond(message.id, {
      account: null,
      requiresOpenaiAuth: true,
    });
    return;
  }
  respond(message.id, {
    account: {
      type: 'chatgpt',
      email: 'PRIVATE-account@example.test',
      planType: 'plus',
      accessToken: 'PRIVATE-access-token',
    },
    requiresOpenaiAuth: true,
  });
}

function handleThreadStart(message) {
  const params = message.params ?? {};
  const mode = params.config?.fixtureMode;

  if (params.model !== undefined && !VISIBLE_MODELS.has(params.model)) {
    respondError(message.id, -32602, 'fixture thread/start received an unavailable model');
    return;
  }
  if (mode === 'policy' && !isExpectedPolicyParams(params)) {
    respondError(message.id, -32602, 'fixture invalid thread policy params');
    return;
  }
  if (mode === 'rpcError') {
    respondError(message.id, -32001, 'fixture RPC failure', { kind: 'fixture' });
    return;
  }
  if (mode === 'authError') {
    respondError(message.id, -32000, 'fixture authentication failure: PRIVATE server detail', {
      codexErrorInfo: 'unauthorized',
    });
    return;
  }
  if (mode === 'crash') {
    process.stderr.write('fixture: crashing\n');
    process.exit(17);
  }
  if (mode === 'malformed') {
    process.stdout.write('this is not JSON\n');
    return;
  }
  if (mode === 'hang') {
    writeNotification('fixture/requestReceived', { mode: 'hang' });
    process.stderr.write('fixture: hanging request\n');
    return;
  }
  if (mode === 'closeStdin') {
    writeNotification('fixture/transportReady', { mode: 'stdin' });
    closeSync(0);
    process.stdin.destroy();
    setInterval(() => undefined, 1_000);
    process.stderr.write('fixture: stdin closed\n');
    return;
  }
  if (mode === 'closeStdout') {
    writeNotification('fixture/transportReady', { mode: 'stdout' });
    process.stderr.write('fixture: stdout closed\n', () => {
      closeSync(1);
      process.stdout.destroy();
      setInterval(() => undefined, 1_000);
    });
    return;
  }

  const delay = mode === 'slow' ? 25 : 0;
  const label = typeof params.config?.fixtureLabel === 'string'
    ? params.config.fixtureLabel
    : mode ?? 'default';
  setTimeout(() => respond(message.id, makeThreadStartResponse(params, label)), delay);
}

function isExpectedPolicyParams(params) {
  return JSON.stringify(params) === JSON.stringify({
    model: 'gpt-5.4',
    ephemeral: true,
    cwd: '/tmp/ask-pdf-vault',
    sandbox: 'read-only',
    approvalPolicy: 'never',
    developerInstructions: 'Answer only from supplied PDF context.',
    config: {
      fixtureMode: 'policy',
      reasoning_effort: 'medium',
    },
  });
}

function makeThreadStartResponse(params, label) {
  const cwd = params.cwd ?? '/tmp/fake-vault';
  const threadId = `thread-${label}-${process.pid}`;
  return {
    thread: {
      id: threadId,
      preview: '',
      ephemeral: params.ephemeral ?? false,
      modelProvider: 'openai',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
      status: { type: 'idle' },
      cwd,
      cliVersion: '0.144.1',
      source: 'appServer',
      turns: [],
      sessionId: `session-${process.pid}`,
    },
    model: params.model ?? 'gpt-5.4',
    modelProvider: 'openai',
    cwd,
    approvalPolicy: params.approvalPolicy ?? 'on-request',
    approvalsReviewer: 'user',
    sandbox: sandboxPolicy(params.sandbox),
    instructionSources: [],
    reasoningEffort: null,
    serviceTier: null,
  };
}

function sandboxPolicy(sandbox) {
  switch (sandbox) {
    case 'danger-full-access':
      return { type: 'dangerFullAccess' };
    case 'workspace-write':
      return {
        type: 'workspaceWrite',
        writableRoots: [],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
    default:
      return { type: 'readOnly', networkAccess: false };
  }
}

function handleTurnStart(message) {
  const params = message.params ?? {};
  const turnId = `turn-${++turnSequence}-${process.pid}`;
  const text = params.input?.find(input => input?.type === 'text')?.text;

  if (params.model !== undefined && !VISIBLE_MODELS.has(params.model)) {
    respondError(message.id, -32602, 'fixture turn/start received an unavailable model');
    return;
  }
  if (text === 'model-override' && params.model !== 'gpt-5.4-mini') {
    respondError(message.id, -32602, 'fixture turn/start did not receive the model override');
    return;
  }

  if (text === 'Validate local image input') {
    const expected = [
      { type: 'text', text: 'Validate local image input' },
      { type: 'localImage', path: '/tmp/pdf-page-7.png' },
    ];
    if (JSON.stringify(params.input) !== JSON.stringify(expected)) {
      respondError(message.id, -32602, 'fixture invalid localImage input');
      return;
    }
  }
  if (text === 'hang') {
    process.stderr.write('fixture: hanging turn\n');
    return;
  }

  const turn = {
    id: turnId,
    status: 'inProgress',
    items: [],
    startedAt: 1_700_000_001,
  };
  activeTurns.set(turnId, { threadId: params.threadId, turn });
  if (text === 'late-response') {
    setTimeout(() => {
      respond(message.id, { turn });
      writeNotification('fixture/lateResponseSent', { turnId });
    }, 80);
    return;
  }
  respond(message.id, { turn });

  if (text === 'hold') return;
  if (text?.includes('crash-after-start')) {
    setTimeout(() => process.exit(18), 5);
    return;
  }
  if (text === 'server-error') {
    writeNotification('error', {
      error: {
        message: 'PRIVATE fixture server error',
        additionalDetails: 'PRIVATE additional details',
        codexErrorInfo: 'internalServerError',
      },
      threadId: params.threadId,
      turnId,
      willRetry: false,
    });
    writeNotification('turn/completed', {
      threadId: params.threadId,
      turn: {
        ...turn,
        status: 'failed',
        completedAt: 1_700_000_002,
        durationMs: 10,
        error: {
          message: 'PRIVATE fixture server error',
          additionalDetails: 'PRIVATE additional details',
          codexErrorInfo: 'internalServerError',
        },
      },
    });
    return;
  }
  if (text === 'server-request') {
    pendingServerRequest = {
      id: 'fixture-server-request-1',
      threadId: params.threadId,
      turn,
    };
    process.stdout.write(`${JSON.stringify({
      id: pendingServerRequest.id,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: params.threadId,
        turnId,
        itemId: `item-${turnId}`,
        startedAtMs: 1_700_000_001_000,
        command: 'echo fixture',
        cwd: '/tmp/fake-vault',
      },
    })}\n`);
    return;
  }

  emitCompletedTurn(params.threadId, turn);
}

function handleClientResponse(message) {
  if (!pendingServerRequest || message.id !== pendingServerRequest.id) {
    protocolFailure('fixture: unexpected client response');
    return;
  }
  if (
    message.error?.code !== -32601
    || typeof message.error?.message !== 'string'
    || 'result' in message
  ) {
    protocolFailure('fixture: invalid unsupported-server-request response');
    return;
  }
  emitCompletedTurn(pendingServerRequest.threadId, pendingServerRequest.turn);
  pendingServerRequest = undefined;
}

function emitCompletedTurn(threadId, turn) {
  const item = {
    id: `item-${turn.id}`,
    type: 'agentMessage',
    text: 'A streamed fixture answer.',
  };
  const delta = line('item/agentMessage/delta', {
    threadId,
    turnId: turn.id,
    itemId: item.id,
    delta: 'A streamed ',
  });
  const completed = line('item/completed', {
    threadId,
    turnId: turn.id,
    item,
    completedAtMs: 1_700_000_002_000,
  });
  const turnCompleted = line('turn/completed', {
    threadId,
    turn: {
      ...turn,
      status: 'completed',
      items: [item],
      completedAt: 1_700_000_002,
      durationMs: 10,
    },
  });

  const split = Math.max(1, Math.floor(delta.length / 2));
  process.stdout.write(delta.slice(0, split));
  setTimeout(() => process.stdout.write(delta.slice(split) + completed + turnCompleted), 5);
}

function handleTurnInterrupt(message) {
  const params = message.params ?? {};
  const active = activeTurns.get(params.turnId);
  if (!active || active.threadId !== params.threadId) {
    respondError(message.id, -32602, 'fixture interrupt requires matching IDs');
    return;
  }
  respond(message.id, {});
  writeNotification('turn/completed', {
    threadId: params.threadId,
    turn: {
      ...active.turn,
      status: 'interrupted',
      completedAt: 1_700_000_002,
      durationMs: 10,
    },
  });
  activeTurns.delete(params.turnId);
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ id, result })}\n`);
}

function respondError(id, code, message, data) {
  process.stdout.write(`${JSON.stringify({
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  })}\n`);
}

function writeNotification(method, params) {
  process.stdout.write(line(method, params));
}

function line(method, params) {
  return `${JSON.stringify({ method, params })}\n`;
}

function protocolFailure(message) {
  process.stderr.write(`${message}\n`);
  process.exit(66);
}
