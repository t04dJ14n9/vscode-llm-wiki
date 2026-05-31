import { readFileSync } from 'fs';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', '..', 'dist');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.css': 'text/css',
  '.pdf': 'application/pdf',
};

const server = createServer((_req, res) => {
  const url = new URL(_req.url ?? '/', `http://localhost:8979`);
  let filePath;

  if (url.pathname === '/' || url.pathname === '/test.html') {
    serveFile(join(__dirname, 'test.html'), 'text/html', res);
    return;
  }

  if (url.pathname === '/fixtures/flash-attention.pdf') {
    serveFile(join(__dirname, '..', '..', '..', '..', 'demo-vault', 'raw', 'pdf', 'flash-attention.pdf'), 'application/pdf', res);
    return;
  }

  if (url.pathname.endsWith('/pixel.gif')) {
    serveBuffer(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'), 'image/gif', res);
    return;
  }

  if (url.pathname.startsWith('/dist/')) {
    filePath = join(distDir, url.pathname.slice(6));
  } else {
    filePath = join(__dirname, url.pathname.slice(1));
  }

  const ext = filePath.slice(filePath.lastIndexOf('.'));
  const contentType = MIME[ext] || 'application/octet-stream';

  serveFile(filePath, contentType, res);
});

function serveFile(filePath, contentType, res) {
  try {
    const data = readFileSync(filePath);
    serveBuffer(data, contentType, res);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function serveBuffer(data, contentType, res) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  res.end(data);
}

server.listen(8979, () => {
  process.stdout.write('E2E server listening on http://localhost:8979\n');
});
