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

  if (url.pathname === '/fixtures/two-page.pdf') {
    serveBuffer(twoPagePdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/four-page.pdf') {
    serveBuffer(fourPagePdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/split-search.pdf') {
    serveBuffer(splitSearchPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/selector-edge.pdf') {
    serveBuffer(selectorEdgePdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/unicode-selector.pdf') {
    serveBuffer(unicodeSelectorPdfFixture(), 'application/pdf', res);
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

function twoPagePdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    pdfStream('BT /F1 18 Tf 72 300 Td (Page One) Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    pdfStream('BT /F1 18 Tf 72 300 Td (Page Two) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'ascii');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index++) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

function fourPagePdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R 9 0 R] /Count 4 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 11 0 R >> >> /Contents 4 0 R >>',
    pdfStream('BT /F1 18 Tf 72 300 Td (Page One) Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 11 0 R >> >> /Contents 6 0 R >>',
    pdfStream('BT /F1 18 Tf 72 300 Td (Page Two) Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 11 0 R >> >> /Contents 8 0 R >>',
    pdfStream('BT /F1 18 Tf 72 300 Td (Page Three) Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 11 0 R >> >> /Contents 10 0 R >>',
    pdfStream('BT /F1 18 Tf 72 300 Td (Page Four) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'ascii');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index++) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

function splitSearchPdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    pdfStream('BT /F1 18 Tf 72 150 Td (Page ) Tj ET\nBT /F1 18 Tf 124 150 Td (Two) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'ascii');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index++) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

function selectorEdgePdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 280] /Resources << /Font << /F1 10 0 R >> >> /Contents [4 0 R 5 0 R 6 0 R 7 0 R 8 0 R 9 0 R] >>',
    pdfStream('BT /F1 18 Tf 72 220 Td (Page) Tj ET'),
    pdfStream('BT /F1 18 Tf 160 220 Td (Two) Tj ET'),
    pdfStream('BT /F1 18 Tf 72 170 Td (Flash) Tj ET'),
    pdfStream('BT /F1 18 Tf 115 170 Td (Attention) Tj ET'),
    pdfStream('BT /F1 18 Tf 72 120 Td (aaaaa tail) Tj ET'),
    pdfStream('BT /F1 18 Tf 72 70 Td (start aaaa tail) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  return pdfFixture(objects);
}

function unicodeSelectorPdfFixture() {
  const toUnicode = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /ReviewUnicode def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    '5 beginbfchar',
    '<0001> <039F>',
    '<0002> <03A3>',
    '<0003> <0020>',
    '<0004> <0130>',
    '<0005> <0058>',
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    pdfStream('BT /F1 18 Tf 72 150 Td <00010002000300040005> Tj ET'),
    '<< /Type /Font /Subtype /Type0 /BaseFont /ReviewUnicode /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ReviewUnicode /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 8 0 R /DW 1000 /CIDToGIDMap /Identity >>',
    pdfStream(toUnicode),
    '<< /Type /FontDescriptor /FontName /ReviewUnicode /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>',
  ];
  return pdfFixture(objects);
}

function pdfFixture(objects) {
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'ascii');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index++) {
    body += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

function pdfStream(content) {
  return `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`;
}
