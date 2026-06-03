import {
  openDatabase,
  runMigrations,
  searchLexical,
  searchSemantic,
  searchHybrid,
  getBacklinks,
  getForwardLinks,
  resolveAnchor,
  exportSourceContext,
  listSources,
} from '@human-learning/core';

export interface McpServerOptions {
  vaultRoot: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const TOOLS = [
  {
    name: 'search',
    description: 'Search the vault using lexical, semantic, or hybrid mode',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        mode: { type: 'string', enum: ['lexical', 'semantic', 'hybrid'] },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_backlinks',
    description: 'Get all notes that link to a given URI',
    inputSchema: {
      type: 'object',
      properties: { uri: { type: 'string' } },
      required: ['uri'],
    },
  },
  {
    name: 'get_forward_links',
    description: 'Get all links from a given note path',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'resolve_anchor',
    description: 'Resolve an anchor ID to its text and location',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'export_context',
    description: 'Export agent-readable context for a source path',
    inputSchema: {
      type: 'object',
      properties: { source_path: { type: 'string' } },
      required: ['source_path'],
    },
  },
  {
    name: 'list_sources',
    description: 'List all ingested sources',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string' } },
    },
  },
  {
    name: 'get_chunk',
    description: 'Get a specific chunk by ID',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
];

function respond(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function error(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

type Db = Awaited<ReturnType<typeof openDatabase>>;

async function handleToolCall(
  db: Db,
  vaultRoot: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'search': {
      const query = args.query as string;
      const mode = (args.mode as string) ?? 'lexical';
      const limit = (args.limit as number) ?? 10;
      let results;
      if (mode === 'semantic') results = searchSemantic(db, query, limit);
      else if (mode === 'hybrid') results = searchHybrid(db, query, limit);
      else results = searchLexical(db, query, limit);
      return { results };
    }
    case 'get_backlinks': {
      const uri = args.uri as string;
      return { backlinks: getBacklinks(db, uri) };
    }
    case 'get_forward_links': {
      const path = args.path as string;
      return { forward_links: getForwardLinks(db, path) };
    }
    case 'resolve_anchor': {
      const id = args.id as string;
      return { anchor: resolveAnchor(db, id) };
    }
    case 'export_context': {
      const sourcePath = args.source_path as string;
      return exportSourceContext(db, vaultRoot, { sourcePath });
    }
    case 'list_sources': {
      const kind = args.kind as string | undefined;
      const sources = listSources(db, kind);
      return { sources };
    }
    case 'get_chunk': {
      const id = args.id as string;
      const chunk = db.prepare('SELECT * FROM chunks WHERE id = ?').get(id);
      return { chunk };
    }
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

async function dispatch(
  db: Db,
  vaultRoot: string,
  req: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  const { id, method, params } = req;

  if (method === 'initialize') {
    return respond(id, {
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'human-learning', version: '0.1.0' },
      capabilities: { tools: {} },
    });
  }

  if (method === 'tools/list') {
    return respond(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const name = params?.name as string | undefined;
    if (!name) return error(id, -32602, 'Missing required param: name');
    const args = (params?.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await handleToolCall(db, vaultRoot, name, args);
      return respond(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
    } catch (e: any) {
      const code = e.code === -32602 ? -32602 : -32603;
      return error(id, code, e.message ?? 'Internal error');
    }
  }

  return error(id, -32601, `Method not found: ${method}`);
}

export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const db = await openDatabase(options.vaultRoot);
  runMigrations(db);

  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let req: JsonRpcRequest;
      try {
        req = JSON.parse(trimmed);
      } catch {
        const resp = error(null, -32700, 'Parse error');
        process.stdout.write(JSON.stringify(resp) + '\n');
        continue;
      }

      if (req.jsonrpc !== '2.0' || !req.method) {
        const resp = error(req.id ?? null, -32600, 'Invalid Request');
        process.stdout.write(JSON.stringify(resp) + '\n');
        continue;
      }

      const resp = await dispatch(db, options.vaultRoot, req);
      process.stdout.write(JSON.stringify(resp) + '\n');
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });
}
