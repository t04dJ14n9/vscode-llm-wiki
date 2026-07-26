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

  if (url.pathname === '/fixtures/out-of-order-text.pdf') {
    serveBuffer(outOfOrderTextPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/mixed-style-selection.pdf') {
    serveBuffer(mixedStyleSelectionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/unicode-selector.pdf') {
    serveBuffer(unicodeSelectorPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/internal-destinations.pdf') {
    serveBuffer(internalDestinationsPdfFixture(), 'application/pdf', res);
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

function outOfOrderTextPdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 320] /Resources << /Font << /F1 9 0 R >> >> /Contents [4 0 R 5 0 R 6 0 R 7 0 R 8 0 R] >>',
    pdfStream('BT /F1 16 Tf 48 250 Td (First line starts the paragraph.) Tj ET'),
    pdfStream('BT /F1 16 Tf 48 160 Td (Fourth line should not jump ahead.) Tj ET'),
    pdfStream('BT /F1 16 Tf 48 130 Td (Fifth line ends the paragraph.) Tj ET'),
    pdfStream('BT /F1 16 Tf 48 220 Td (\\007Second line continues in visual order.) Tj ET'),
    pdfStream('BT /F1 16 Tf 48 190 Td (Third line remains part of selection.) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  return pdfFixture(objects);
}

function mixedStyleSelectionPdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 240] /Resources << /Font << /F1 8 0 R /F2 9 0 R >> >> /Contents [4 0 R 5 0 R 6 0 R 7 0 R] >>',
    pdfStream('BT /F1 18 Tf 48 160 Td (Normal text before ) Tj ET'),
    pdfStream('BT /F2 18 Tf 201 160 Td (bold words) Tj ET'),
    pdfStream('BT /F1 18 Tf 298 160 Td ( and after.) Tj ET'),
    pdfStream('BT /F1 18 Tf 48 140 Td (Tightly spaced normal second line.) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
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

function internalDestinationsPdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Names << /Dests 12 0 R >> >>',
    '<< /Type /Pages /Kids [3 0 R 7 0 R 9 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 600] /Resources << /Font << /F1 11 0 R >> >> /Contents 4 0 R /Annots [5 0 R 6 0 R] >>',
    pdfStream([
      'BT /F1 20 Tf 42 540 Td (Internal destinations) Tj ET',
      '0 0 1 rg BT /F1 16 Tf 42 470 Td (Figure 11.1) Tj ET',
      '0 0 1 rg BT /F1 16 Tf 42 420 Td (Section 12.2) Tj ET',
      '0 g BT /F1 12 Tf 42 120 Td (Return should restore this exact reading position.) Tj ET',
    ].join('\n')),
    '<< /Type /Annot /Subtype /Link /Rect [40 460 137 486] /Border [0 0 0] /Contents (Figure 11.1) /Dest [7 0 R /XYZ 42 302 0] >>',
    '<< /Type /Annot /Subtype /Link /Rect [40 410 140 436] /Border [0 0 0] /Contents (Section 12.2) /A << /S /GoTo /D (section.12.2) >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 600] /Resources << /Font << /F1 11 0 R >> >> /Contents 8 0 R /Annots [13 0 R] >>',
    pdfStream([
      'BT /F1 18 Tf 42 286 Td (Figure 11.1 target) Tj ET',
      'BT /F1 12 Tf 42 260 Td (The direct destination should align the figure here.) Tj ET',
      '0 0 1 rg BT /F1 14 Tf 42 220 Td (Section 12.2) Tj ET',
    ].join('\n')),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 600] /Resources << /Font << /F1 11 0 R >> >> /Contents 10 0 R >>',
    pdfStream([
      'BT /F1 18 Tf 42 500 Td (Section 12.2 target) Tj ET',
      'BT /F1 12 Tf 42 474 Td (The named destination should align the section here.) Tj ET',
    ].join('\n')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Names [(section.12.2) [9 0 R /XYZ 42 516 0]] >>',
    '<< /Type /Annot /Subtype /Link /Rect [40 210 140 234] /Border [0 0 0] /Contents (Section 12.2) /Dest (section.12.2) >>',
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
