import { randomBytes } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import * as path from 'node:path';
import * as vscode from 'vscode';

const MAX_REQUEST_BYTES = 16 * 1024;
const ENDPOINT_RELATIVE_PATH = path.join('.llm_wiki', 'runtime', 'cli-endpoint');

export function registerTerminalCliBridge(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  const token = randomBytes(24).toString('hex');
  const endpointPath = path.join(workspaceRoot, ENDPOINT_RELATIVE_PATH);
  const server = createServer((request, response) => {
    void handleRequest(request, response, token);
  });

  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return;
    const endpoint = `http://127.0.0.1:${address.port}/open-markdown?token=${token}`;
    void publishEndpoint(endpointPath, endpoint).catch(error => {
      vscode.window.showWarningMessage(
        `LLM Wiki terminal routing could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  });

  context.subscriptions.push({
    dispose() {
      server.close();
    },
  });
}

async function publishEndpoint(endpointPath: string, endpoint: string): Promise<void> {
  await mkdir(path.dirname(endpointPath), { recursive: true });
  await writeFile(endpointPath, `${endpoint}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(endpointPath, 0o600);
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
): Promise<void> {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (
      request.method !== 'POST'
      || requestUrl.pathname !== '/open-markdown'
      || requestUrl.searchParams.get('token') !== token
    ) {
      respond(response, 404, 'Not found');
      return;
    }

    const body = new URLSearchParams(await readRequestBody(request));
    const cwd = body.get('cwd');
    const requestedPath = body.get('path');
    if (!cwd || !requestedPath || path.extname(requestedPath).toLowerCase() !== '.md') {
      respond(response, 400, 'Expected a Markdown path');
      return;
    }

    const fileUri = vscode.Uri.file(path.resolve(cwd, requestedPath));
    if (!vscode.workspace.getWorkspaceFolder(fileUri)) {
      respond(response, 403, 'The Markdown path is outside this workspace');
      return;
    }

    let documentUri = fileUri;
    try {
      await vscode.workspace.fs.stat(fileUri);
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
      documentUri = fileUri.with({ scheme: 'untitled' });
    }

    const document = await vscode.workspace.openTextDocument(documentUri);
    await vscode.window.showTextDocument(document, { preview: false });
    respond(response, 204, '');
  } catch (error) {
    respond(response, 500, error instanceof Error ? error.message : String(error));
  }
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer | string) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += bytes.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error('Terminal CLI request is too large'));
        request.destroy();
        return;
      }
      chunks.push(bytes);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function respond(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}
