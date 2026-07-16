import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const fixtureExecutable = join(packageRoot, 'test', 'fixtures', 'fake-codex-app-server.mjs');

function loadClientModule(relativePath = 'src/codexAppServerClient.ts') {
  const filename = join(packageRoot, relativePath);
  const source = readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(dirname(filename));
  mod._compile(outputText, filename);
  return mod.exports;
}

test('spawns the configured executable and completes initialize/initialized before thread/start', async t => {
  const diagnostics = [];
  const { CodexAppServerClient } = loadClientModule();
  const client = new CodexAppServerClient({
    executable: fixtureExecutable,
    extensionVersion: '9.8.7-test',
    logger: message => diagnostics.push(message),
  });
  t.after(() => client.dispose());

  const result = await client.startThread({ ephemeral: true });

  assert.match(result.threadId, /^thread-default-\d+$/);
  assert.equal(result.thread.id, result.threadId);
  assert.equal(result.thread.ephemeral, true);
  await waitFor(() => diagnostics.length > 0);
  assertSanitizedDiagnostics(diagnostics);
});

test('logs lifecycle, request IDs, response latency, and disposal without protocol payloads', async () => {
  const diagnostics = [];
  const { CodexAppServerClient } = loadClientModule();
  const client = createClient(CodexAppServerClient, {
    logger: message => diagnostics.push(message),
  });

  await client.startThread({
    developerInstructions: 'PRIVATE developer instructions must never be logged',
    config: {
      fixtureLabel: 'PRIVATE-thread-label',
      privateValue: 'PRIVATE-config-value',
    },
  });
  client.dispose();

  const joined = diagnostics.join('\n');
  assert.match(joined, /^Codex app-server process starting\.$/m);
  assert.match(joined, /^Codex app-server process started\.$/m);
  assert.match(joined, /^Codex app-server process initialized\.$/m);
  assert.match(joined, /^Codex app-server request started \(id=1, method=initialize\)\.$/m);
  assert.match(
    joined,
    /^Codex app-server request completed \(id=1, method=initialize, latencyMs=\d+\)\.$/m,
  );
  assert.match(joined, /^Codex app-server request started \(id=2, method=account\/read\)\.$/m);
  assert.match(
    joined,
    /^Codex app-server request completed \(id=2, method=account\/read, latencyMs=\d+\)\.$/m,
  );
  assert.match(joined, /^Codex app-server request started \(id=3, method=thread\/start\)\.$/m);
  assert.match(
    joined,
    /^Codex app-server request completed \(id=3, method=thread\/start, latencyMs=\d+\)\.$/m,
  );
  assert.match(joined, /^Codex app-server client disposed\.$/m);
  assert.doesNotMatch(joined, /PRIVATE|developer instructions|privateValue|thread-default/);
  assertSanitizedDiagnostics(diagnostics);
});

test('rejects Codex CLI versions older than the supported app-server protocol minimum', async t => {
  const {
    CodexAppServerClient,
    CodexUnsupportedVersionError,
    MINIMUM_CODEX_CLI_VERSION,
  } = loadClientModule();
  const client = createClient(CodexAppServerClient, {
    extensionVersion: 'fixture-unsupported-version',
  });
  t.after(() => client.dispose());

  assert.equal(MINIMUM_CODEX_CLI_VERSION, '0.144.1');
  await assert.rejects(client.initialize(), error => {
    assert.ok(error instanceof CodexUnsupportedVersionError);
    assert.equal(error.code, 'unsupported-version');
    assert.equal(error.detectedVersion, '0.143.9');
    assert.equal(error.minimumVersion, MINIMUM_CODEX_CLI_VERSION);
    assert.match(error.message, /update the Codex CLI/i);
    assert.match(error.message, /0\.144\.1/);
    return true;
  });
});

test('rejects initialize responses whose Codex CLI version cannot be identified', async t => {
  const { CodexAppServerClient, CodexUnsupportedVersionError } = loadClientModule();
  const client = createClient(CodexAppServerClient, {
    extensionVersion: 'fixture-unparseable-version',
  });
  t.after(() => client.dispose());

  await assert.rejects(client.initialize(), error => {
    assert.ok(error instanceof CodexUnsupportedVersionError);
    assert.equal(error.code, 'unsupported-version');
    assert.equal(error.detectedVersion, undefined);
    assert.match(error.message, /could not be determined/i);
    return true;
  });
});

test('accepts the live Codex Desktop userAgent at the minimum supported version', async t => {
  const { CodexAppServerClient } = loadClientModule();
  const client = createClient(CodexAppServerClient, {
    extensionVersion: 'fixture-desktop-version',
  });
  t.after(() => client.dispose());

  const initialized = await client.initialize();

  assert.equal(
    initialized.userAgent,
    'Codex Desktop/0.144.1 (Mac OS 26.5.2; arm64) fixture',
  );
});

test('accepts the live integration-name userAgent at the minimum supported version', async t => {
  const { CodexAppServerClient } = loadClientModule();
  const client = createClient(CodexAppServerClient, {
    extensionVersion: 'fixture-integration-user-agent',
  });
  t.after(() => client.dispose());

  const initialized = await client.initialize();

  assert.equal(
    initialized.userAgent,
    'human-learning-pdf/0.144.1 (Mac OS 26.5.2; arm64) dumb (human-learning-pdf; 0.1.0)',
  );
});

test('preflights account/read and rejects required OpenAI auth without logging account data', async t => {
  const diagnostics = [];
  const { CodexAppServerClient, CodexUnauthenticatedError } = loadClientModule();
  const client = createClient(CodexAppServerClient, {
    extensionVersion: 'fixture-account-unauthenticated',
    logger: message => diagnostics.push(message),
  });
  t.after(() => client.dispose());

  await assert.rejects(client.initialize(), error => {
    assert.ok(error instanceof CodexUnauthenticatedError);
    assert.equal(error.code, 'unauthenticated');
    assert.equal(error.method, 'account/read');
    assert.equal(error.rpcCode, undefined);
    assert.match(error.message, /sign in|log in|login/i);
    return true;
  });

  const joined = diagnostics.join('\n');
  assert.match(joined, /^Codex app-server request started \(id=2, method=account\/read\)\.$/m);
  assert.match(
    joined,
    /^Codex app-server request completed \(id=2, method=account\/read, latencyMs=\d+\)\.$/m,
  );
  assert.match(joined, /^Codex app-server process failed \(code=unauthenticated\)\.$/m);
  assert.doesNotMatch(joined, /PRIVATE|account@example|accessToken|refreshToken/);
  assertSanitizedDiagnostics(diagnostics);
});

test('performs one handshake for concurrent requests and correlates numeric IDs out of order', async t => {
  const { CodexAppServerClient } = loadClientModule();
  const client = createClient(CodexAppServerClient);
  t.after(() => client.dispose());

  const [slow, fast] = await Promise.all([
    client.startThread({ config: { fixtureMode: 'slow', fixtureLabel: 'slow' } }),
    client.startThread({ config: { fixtureMode: 'fast', fixtureLabel: 'fast' } }),
  ]);

  assert.match(slow.threadId, /^thread-slow-\d+$/);
  assert.match(fast.threadId, /^thread-fast-\d+$/);
  assert.notEqual(slow.threadId, fast.threadId);
});

test('initialize is public and reuses the live process handshake', async t => {
  const { CodexAppServerClient } = loadClientModule();
  const client = createClient(CodexAppServerClient);
  t.after(() => client.dispose());

  const first = await client.initialize();
  const second = await client.initialize();
  const thread = await client.startThread({});

  assert.equal(first.codexHome, '/tmp/fake-codex-home');
  assert.equal(second, first);
  assert.match(thread.threadId, /^thread-default-\d+$/);
});

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
  assert.equal(thread.model, 'gpt-5.4');
  await client.startTurn({
    threadId: thread.threadId,
    model: 'gpt-5.4-mini',
    input: [{ type: 'text', text: 'model-override' }],
  });
});

test('forwards supported v2 thread policy and model fields while keeping protocol data out of diagnostics', async t => {
  const diagnostics = [];
  const { CodexAppServerClient } = loadClientModule();
  const client = createClient(CodexAppServerClient, {
    logger: message => diagnostics.push(message),
  });
  t.after(() => client.dispose());

  const response = await client.startThread({
    ephemeral: true,
    cwd: '/tmp/ask-pdf-vault',
    sandbox: 'read-only',
    approvalPolicy: 'never',
    developerInstructions: 'Answer only from supplied PDF context.',
    config: {
      fixtureMode: 'policy',
      reasoning_effort: 'medium',
    },
    model: 'gpt-5.4',
  });

  assert.equal(response.thread.ephemeral, true);
  assert.equal(response.cwd, '/tmp/ask-pdf-vault');
  assert.equal(response.approvalPolicy, 'never');
  assert.deepEqual(response.sandbox, { type: 'readOnly', networkAccess: false });
  await waitFor(() => diagnostics.length > 0);
  assertSanitizedDiagnostics(diagnostics);
  assert.doesNotMatch(diagnostics.join(''), /Answer only|ask-pdf-vault|gpt-5\.4/);
});

test('sends text and localImage inputs and routes fragmented and coalesced completion notifications', async t => {
  const { CodexAppServerClient } = loadClientModule();
  const diagnostics = [];
  const client = createClient(CodexAppServerClient, {
    logger: message => diagnostics.push(message),
  });
  t.after(() => client.dispose());
  const received = [];
  const subscriptions = [
    client.onNotification('item/agentMessage/delta', params => received.push(['delta', params])),
    client.onNotification('item/completed', params => received.push(['item', params])),
    client.onNotification('turn/completed', params => received.push(['turn', params])),
  ];
  t.after(() => subscriptions.forEach(subscription => subscription.dispose()));
  const thread = await client.startThread({ ephemeral: true });

  const result = await client.startTurn({
    threadId: thread.threadId,
    input: [
      { type: 'text', text: 'Validate local image input' },
      { type: 'localImage', path: '/tmp/pdf-page-7.png' },
    ],
  });
  await waitFor(() => received.length === 3);

  assert.equal(result.threadId, thread.threadId);
  assert.equal(result.turnId, result.turn.id);
  assert.deepEqual(received.map(([kind]) => kind), ['delta', 'item', 'turn']);
  assert.equal(received[0][1].threadId, thread.threadId);
  assert.equal(received[0][1].turnId, result.turnId);
  assert.equal(received[0][1].delta, 'A streamed ');
  assert.equal(received[1][1].item.type, 'agentMessage');
  assert.equal(received[1][1].item.text, 'A streamed fixture answer.');
  assert.equal(received[2][1].turn.status, 'completed');
  assert.doesNotMatch(
    diagnostics.join(''),
    /Validate local image input|pdf-page-7\.png|A streamed fixture answer/,
  );
  assertSanitizedDiagnostics(diagnostics);
});

test('routes server error notifications without converting them into transport failures', async t => {
  const diagnostics = [];
  const { CodexAppServerClient } = loadClientModule();
  const client = createClient(CodexAppServerClient, {
    logger: message => diagnostics.push(message),
  });
  t.after(() => client.dispose());
  const errors = [];
  client.onNotification('error', params => errors.push(params));
  const thread = await client.startThread({});

  const turn = await client.startTurn({
    threadId: thread.threadId,
    input: [{ type: 'text', text: 'server-error' }],
  });
  await waitFor(() => errors.length === 1);

  assert.equal(errors[0].threadId, thread.threadId);
  assert.equal(errors[0].turnId, turn.turnId);
  assert.equal(errors[0].willRetry, false);
  assert.equal(errors[0].error.codexErrorInfo, 'internalServerError');
  assert.ok(diagnostics.includes(
    'Codex app-server error notification (threadId=' + thread.threadId
      + ', turnId=' + turn.turnId
      + ', status=failed, category=internalServerError).',
  ));
  assert.ok(diagnostics.includes(
    'Codex app-server turn completed (threadId=' + thread.threadId
      + ', turnId=' + turn.turnId
      + ', status=failed, category=internalServerError).',
  ));
  assert.doesNotMatch(diagnostics.join('\n'), /PRIVATE|fixture server error|additional details/);
  assertSanitizedDiagnostics(diagnostics);
});

test('rejects unsupported server requests without poisoning the bidirectional transport', async t => {
  const { CodexAppServerClient } = loadClientModule();
  const client = createClient(CodexAppServerClient);
  t.after(() => client.dispose());
  const completed = [];
  client.onNotification('turn/completed', params => completed.push(params));
  const thread = await client.startThread({});

  const turn = await client.startTurn({
    threadId: thread.threadId,
    input: [{ type: 'text', text: 'server-request' }],
  });
  await waitFor(() => completed.some(event => event.turn.id === turn.turnId));

  const next = await client.startThread({ config: { fixtureLabel: 'after-server-request' } });
  assert.match(next.threadId, /^thread-after-server-request-\d+$/);
});

test('interruptTurn sends both IDs and receives an interrupted completion', async t => {
  const { CodexAppServerClient } = loadClientModule();
  const client = createClient(CodexAppServerClient);
  t.after(() => client.dispose());
  const completed = [];
  client.onNotification('turn/completed', params => completed.push(params));
  const thread = await client.startThread({});
  const turn = await client.startTurn({
    threadId: thread.threadId,
    input: [{ type: 'text', text: 'hold' }],
  });

  const result = await client.interruptTurn(thread.threadId, turn.turnId);
  await waitFor(() => completed.length === 1);

  assert.equal(result, undefined);
  assert.equal(completed[0].threadId, thread.threadId);
  assert.equal(completed[0].turn.id, turn.turnId);
  assert.equal(completed[0].turn.status, 'interrupted');
});

test('turn requests default to ten minutes and support a short test override', async t => {
  const {
    CodexAppServerClient,
    CodexRequestTimeoutError,
    DEFAULT_TURN_TIMEOUT_MS,
  } = loadClientModule();
  assert.equal(DEFAULT_TURN_TIMEOUT_MS, 10 * 60 * 1000);
  const client = createClient(CodexAppServerClient, { turnTimeoutMs: 40 });
  t.after(() => client.dispose());
  const thread = await client.startThread({});

  await assert.rejects(
    client.startTurn({
      threadId: thread.threadId,
      input: [{ type: 'text', text: 'hang' }],
    }),
    error => {
      assert.ok(error instanceof CodexRequestTimeoutError);
      assert.equal(error.code, 'request-timeout');
      assert.equal(error.method, 'turn/start');
      return true;
    },
  );
});

test('a late response after timeout is ignored without poisoning current work', async t => {
  const { CodexAppServerClient, CodexRequestTimeoutError } = loadClientModule();
  const client = createClient(CodexAppServerClient, { turnTimeoutMs: 30 });
  t.after(() => client.dispose());
  const lateResponses = [];
  client.onNotification('fixture/lateResponseSent', params => lateResponses.push(params));
  const thread = await client.startThread({});

  await assert.rejects(
    client.startTurn({
      threadId: thread.threadId,
      input: [{ type: 'text', text: 'late-response' }],
    }),
    CodexRequestTimeoutError,
  );
  await waitFor(() => lateResponses.length === 1);

  const next = await client.startThread({ config: { fixtureLabel: 'after-late-response' } });
  assert.match(next.threadId, /^thread-after-late-response-\d+$/);
});

test('a process crash rejects the active request and the next request starts a fresh process', async t => {
  const { CodexAppServerClient, CodexProcessError } = loadClientModule();
  const client = createClient(CodexAppServerClient);
  t.after(() => client.dispose());

  await assert.rejects(
    client.startThread({ config: { fixtureMode: 'crash' } }),
    error => {
      assert.ok(error instanceof CodexProcessError);
      assert.equal(error.code, 'process-exited');
      assert.equal(error.exitCode, 17);
      return true;
    },
  );

  const restarted = await client.startThread({ config: { fixtureLabel: 'restarted' } });
  assert.match(restarted.threadId, /^thread-restarted-\d+$/);
});

test('malformed stdout rejects active work and the next request reinitializes', async t => {
  const { CodexAppServerClient, CodexProcessError } = loadClientModule();
  const client = createClient(CodexAppServerClient);
  t.after(() => client.dispose());

  await assert.rejects(
    client.startThread({ config: { fixtureMode: 'malformed' } }),
    error => {
      assert.ok(error instanceof CodexProcessError);
      assert.equal(error.code, 'malformed-response');
      return true;
    },
  );

  const restarted = await client.startThread({ config: { fixtureLabel: 'after-malformed' } });
  assert.match(restarted.threadId, /^thread-after-malformed-\d+$/);
});

test('missing executables use an actionable executable-not-found error', async t => {
  const { CodexAppServerClient, CodexExecutableNotFoundError } = loadClientModule();
  const executable = join(packageRoot, 'test', 'fixtures', 'does-not-exist-codex');
  const client = new CodexAppServerClient({
    executable,
    extensionVersion: '9.8.7-test',
  });
  t.after(() => client.dispose());

  await assert.rejects(client.startThread({}), error => {
    assert.ok(error instanceof CodexExecutableNotFoundError);
    assert.equal(error.code, 'executable-not-found');
    assert.equal(error.executable, executable);
    return true;
  });
});

test('RPC failures preserve the server code and data without poisoning the process', async t => {
  const { CodexAppServerClient, CodexRpcError } = loadClientModule();
  const client = createClient(CodexAppServerClient);
  t.after(() => client.dispose());

  await assert.rejects(
    client.startThread({ config: { fixtureMode: 'rpcError' } }),
    error => {
      assert.ok(error instanceof CodexRpcError);
      assert.equal(error.code, 'rpc-error');
      assert.equal(error.rpcCode, -32001);
      assert.deepEqual(error.data, { kind: 'fixture' });
      return true;
    },
  );

  const next = await client.startThread({ config: { fixtureLabel: 'after-rpc-error' } });
  assert.match(next.threadId, /^thread-after-rpc-error-\d+$/);
});

test('classifies authentication RPC failures as actionable unauthenticated errors', async t => {
  const diagnostics = [];
  const { CodexAppServerClient, CodexUnauthenticatedError } = loadClientModule();
  const client = createClient(CodexAppServerClient, {
    logger: message => diagnostics.push(message),
  });
  t.after(() => client.dispose());

  await assert.rejects(
    client.startThread({ config: { fixtureMode: 'authError', privateToken: 'PRIVATE-auth-token' } }),
    error => {
      assert.ok(error instanceof CodexUnauthenticatedError);
      assert.equal(error.code, 'unauthenticated');
      assert.equal(error.method, 'thread/start');
      assert.equal(error.rpcCode, -32000);
      assert.match(error.message, /sign in|log in|login/i);
      return true;
    },
  );

  const joined = diagnostics.join('\n');
  assert.match(
    joined,
    /^Codex app-server request failed \(id=3, method=thread\/start, latencyMs=\d+, code=unauthenticated\)\.$/m,
  );
  assert.doesNotMatch(joined, /PRIVATE|auth-token|fixture authentication failure|unauthorized/);
  assertSanitizedDiagnostics(diagnostics);
});

test('write-side transport failure rejects active work, terminates the child, and restarts', async t => {
  const diagnostics = [];
  const { CodexAppServerClient, CodexProcessError } = loadClientModule();
  const client = createClient(CodexAppServerClient, {
    logger: message => diagnostics.push(message),
    requestTimeoutMs: 1_000,
  });
  const transportReady = [];
  client.onNotification('fixture/transportReady', params => transportReady.push(params));
  let fixturePid;
  t.after(() => {
    client.dispose();
    terminateFixture(fixturePid);
  });
  const started = await client.startThread({ config: { fixtureLabel: 'before-write-error' } });
  fixturePid = pidFromThreadId(started.threadId);

  const closing = client.startThread({ config: { fixtureMode: 'closeStdin' } });
  await waitFor(() => transportReady.some(event => event.mode === 'stdin'));
  const trigger = client.startThread({ config: { fixtureLabel: 'trigger-write-error' } });
  const failures = await Promise.allSettled([closing, trigger]);

  assert.equal(failures.every(result => result.status === 'rejected'), true);
  for (const failure of failures) {
    assert.ok(failure.reason instanceof CodexProcessError);
    assert.equal(failure.reason.code, 'process-error');
  }
  await waitFor(() => !isProcessAlive(fixturePid));
  assertSanitizedDiagnostics(diagnostics);
  const restarted = await client.startThread({ config: { fixtureLabel: 'after-write-error' } });
  assert.match(restarted.threadId, /^thread-after-write-error-\d+$/);
});

test('premature stdout closure rejects active work, terminates the child, and restarts', async t => {
  const diagnostics = [];
  const { CodexAppServerClient, CodexProcessError } = loadClientModule();
  const client = createClient(CodexAppServerClient, {
    logger: message => diagnostics.push(message),
    requestTimeoutMs: 500,
  });
  const transportReady = [];
  client.onNotification('fixture/transportReady', params => transportReady.push(params));
  let fixturePid;
  t.after(() => {
    client.dispose();
    terminateFixture(fixturePid);
  });
  const started = await client.startThread({ config: { fixtureLabel: 'before-stdout-close' } });
  fixturePid = pidFromThreadId(started.threadId);

  await assert.rejects(
    client.startThread({ config: { fixtureMode: 'closeStdout' } }),
    error => {
      assert.ok(error instanceof CodexProcessError);
      assert.equal(error.code, 'process-error');
      return true;
    },
  );
  await waitFor(() => transportReady.some(event => event.mode === 'stdout'));
  assertSanitizedDiagnostics(diagnostics);
  await waitFor(() => !isProcessAlive(fixturePid));
  const restarted = await client.startThread({ config: { fixtureLabel: 'after-stdout-close' } });
  assert.match(restarted.threadId, /^thread-after-stdout-close-\d+$/);
});

test('dispose terminates the child, rejects pending work, and blocks later requests', async () => {
  const { CodexAppServerClient, CodexClientDisposedError } = loadClientModule();
  const client = createClient(CodexAppServerClient);
  const received = [];
  client.onNotification('fixture/requestReceived', params => received.push(params));
  const started = await client.startThread({ config: { fixtureLabel: 'before-dispose' } });
  const fixturePid = pidFromThreadId(started.threadId);
  const pending = client.startThread({ config: { fixtureMode: 'hang' } });
  await waitFor(() => received.some(event => event.mode === 'hang'));

  client.dispose();

  await assert.rejects(pending, error => {
    assert.ok(error instanceof CodexClientDisposedError);
    assert.equal(error.code, 'disposed');
    return true;
  });
  await assert.rejects(client.startThread({}), CodexClientDisposedError);
  await waitFor(() => !isProcessAlive(fixturePid));
});

test('the full and standalone PDF client modules stay byte-identical and VS Code-free', () => {
  const fullClientPath = join(packageRoot, 'src', 'codexAppServerClient.ts');
  const pdfClientPath = join(
    repoRoot,
    'packages',
    'vscode-pdf-extension',
    'src',
    'codexAppServerClient.ts',
  );
  const fullClient = readFileSync(fullClientPath);
  const pdfClient = readFileSync(pdfClientPath);

  assert.deepEqual(pdfClient, fullClient);
  assert.doesNotMatch(fullClient.toString('utf8'), /from\s+['"]vscode['"]|require\(['"]vscode['"]\)/);
});

function createClient(CodexAppServerClient, overrides = {}) {
  return new CodexAppServerClient({
    executable: fixtureExecutable,
    extensionVersion: '9.8.7-test',
    ...overrides,
  });
}

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail('Timed out waiting for fake app-server activity');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function pidFromThreadId(threadId) {
  const match = threadId.match(/-(\d+)$/);
  assert.ok(match, `thread ID does not contain a fixture PID: ${threadId}`);
  return Number(match[1]);
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function terminateFixture(pid) {
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function assertSanitizedDiagnostics(diagnostics) {
  assert.ok(diagnostics.length > 0, 'expected at least one diagnostic event');
  const safePatterns = [
    /^Codex app-server process starting\.$/,
    /^Codex app-server process started\.$/,
    /^Codex app-server process initialized\.$/,
    /^Codex app-server process stopped \(reason=disposed\)\.$/,
    /^Codex app-server process failed \(code=[a-z-]+\)\.$/,
    /^Codex app-server client disposed\.$/,
    /^Codex app-server request started \(id=\d+, method=[a-z/]+\)\.$/,
    /^Codex app-server request completed \(id=\d+, method=[a-z/]+, latencyMs=\d+\)\.$/,
    /^Codex app-server request failed \(id=\d+, method=[a-z/]+, latencyMs=\d+, code=[a-z-]+\)\.$/,
    /^Codex app-server error notification \(threadId=[A-Za-z0-9._:-]+, turnId=[A-Za-z0-9._:-]+, status=(?:failed|retrying|unknown), category=[A-Za-z0-9._:-]+\)\.$/,
    /^Codex app-server turn completed \(threadId=[A-Za-z0-9._:-]+, turnId=[A-Za-z0-9._:-]+, status=failed, category=[A-Za-z0-9._:-]+\)\.$/,
    /^Codex app-server stderr output received \(\d+ bytes\)\.$/,
  ];
  for (const message of diagnostics) {
    assert.ok(
      safePatterns.some(pattern => pattern.test(message)),
      `unexpected or content-bearing diagnostic: ${message}`,
    );
  }
}
