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
    serveBuffer(flashAttentionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/gqa-paper.pdf') {
    serveFile(join(
      __dirname,
      '..', '..', '..', '..',
      'demo-vault', 'assets',
      'gqa-training-generalized-multi-query-transformer-models-from-multi-head-checkpoints.pdf',
    ), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/large-search.pdf') {
    serveBuffer(largeSearchPdfFixture(), 'application/pdf', res);
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

  if (url.pathname === '/fixtures/body-caption-selection.pdf') {
    serveBuffer(bodyCaptionSelectionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/mixed-style-selection.pdf') {
    serveBuffer(mixedStyleSelectionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/short-row-selection.pdf') {
    serveBuffer(shortRowSelectionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/formula-selection.pdf') {
    serveBuffer(formulaSelectionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/two-column-selection-regression.pdf') {
    serveBuffer(twoColumnSelectionRegressionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/source-aligned-column-continuation-regression.pdf') {
    serveBuffer(sourceAlignedColumnContinuationRegressionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/stacked-equation-selection-regression.pdf') {
    serveBuffer(stackedEquationSelectionRegressionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/preview-footnote-selection-regression.pdf') {
    serveBuffer(previewFootnoteSelectionRegressionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/staggered-band-bridge-regression.pdf') {
    serveBuffer(staggeredBandBridgeRegressionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/author-grid-selection-regression.pdf') {
    serveBuffer(authorGridSelectionRegressionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/numeric-table-selection-regression.pdf') {
    serveBuffer(numericTableSelectionRegressionPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/centered-masthead-selection-regression.pdf') {
    serveBuffer(centeredMastheadSelectionRegressionPdfFixture(), 'application/pdf', res);
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

  if (url.pathname === '/fixtures/inferred-outline.pdf') {
    serveBuffer(inferredOutlinePdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/shifted-contents-links.pdf') {
    serveBuffer(shiftedContentsLinksPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/shifted-single-link.pdf') {
    serveBuffer(shiftedSingleLinkPdfFixture(), 'application/pdf', res);
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

function flashAttentionPdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    pdfStream([
      'BT /F1 18 Tf 72 700 Td (FlashAttention uses tiling to reduce HBM accesses.) Tj ET',
      'BT /F1 10 Tf 72 680 Td (By splitting Q, K, V into blocks that fit in on-chip SRAM, the algorithm avoids materializing) Tj ET',
      'BT /F1 10 Tf 72 660 Td (the full NxN attention matrix.) Tj ET',
      'BT /F1 10 Tf 72 640 Td (Online softmax computes normalization incrementally across tiles.) Tj ET',
      'BT /F1 10 Tf 72 620 Td (This yields 2-4x speedup over standard attention with exact results.) Tj ET',
    ].join('\n')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  return pdfFixture(objects);
}

function largeSearchPdfFixture() {
  const pageCount = 613;
  const fontObjectNumber = 3 + pageCount * 2;
  const pageObjectNumbers = Array.from(
    { length: pageCount },
    (_, index) => 3 + index * 2,
  );
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjectNumbers.map(number => `${number} 0 R`).join(' ')}] /Count ${pageCount} >>`,
  ];

  pageObjectNumbers.forEach((pageObjectNumber, index) => {
    const contentObjectNumber = pageObjectNumber + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
      pdfStream(`BT /F1 18 Tf 72 300 Td (Searchable page ${index + 1}) Tj ET`),
    );
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  return pdfFixture(objects);
}

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

function bodyCaptionSelectionPdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 520 320] /Resources << /Font << /F1 10 0 R >> >> /Contents [4 0 R 5 0 R 6 0 R 7 0 R 8 0 R 9 0 R] >>',
    pdfStream('BT /F1 14 Tf 48 240 Td (Body paragraph starts in the main column.) Tj ET'),
    pdfStream('BT /F1 14 Tf 48 220 Td (Its second line stays in that reading lane.) Tj ET'),
    pdfStream('BT /F1 12 Tf 390 225 Td (Figure side caption.) Tj ET'),
    pdfStream('BT /F1 12 Tf 390 205 Td (Do not select this.) Tj ET'),
    pdfStream('BT /F1 14 Tf 48 200 Td (The third body line follows beside the caption.) Tj ET'),
    pdfStream('BT /F1 14 Tf 48 180 Td (The body paragraph ends here.) Tj ET'),
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

function shortRowSelectionPdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 260] /Resources << /Font << /F1 7 0 R >> >> /Contents [4 0 R 5 0 R 6 0 R] >>',
    pdfStream('BT /F1 16 Tf 48 190 Td (The preceding row is intentionally much longer than the row below.) Tj ET'),
    pdfStream('BT /F1 16 Tf 48 160 Td (Short.) Tj ET'),
    pdfStream('BT /F1 16 Tf 48 130 Td (The following row is also long enough to challenge nearest-glyph hit testing.) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  return pdfFixture(objects);
}

function formulaSelectionPdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << /Font << /F1 9 0 R >> >> /Contents [4 0 R 5 0 R 6 0 R 7 0 R 8 0 R] >>',
    pdfStream('BT /F1 24 Tf 48 140 Td (E=mc) Tj ET'),
    pdfStream('BT /F1 14 Tf 110 153 Td (2) Tj ET'),
    pdfStream('BT /F1 24 Tf 124 140 Td ( + H) Tj ET'),
    pdfStream('BT /F1 14 Tf 174 133 Td (2) Tj ET'),
    pdfStream('BT /F1 24 Tf 183 140 Td (O) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  return pdfFixture(objects);
}

function twoColumnSelectionRegressionPdfFixture() {
  return positionedTextPdfFixture({
    mediaBox: [0, 0, 640, 400],
    fonts: ['Helvetica'],
    runs: [
      'BT /F1 16 Tf 48 280 Td (Left line one.) Tj ET',
      'BT /F1 16 Tf 350 280 Td (Right line one.) Tj ET',
      'BT /F1 16 Tf 48 250 Td (Left line two.) Tj ET',
      'BT /F1 16 Tf 350 250 Td (Right line two.) Tj ET',
      'BT /F1 16 Tf 48 220 Td (Left line three.) Tj ET',
      'BT /F1 16 Tf 350 220 Td (Right line three.) Tj ET',
    ],
  });
}

function sourceAlignedColumnContinuationRegressionPdfFixture() {
  return positionedTextPdfFixture({
    mediaBox: [0, 0, 640, 440],
    fonts: ['Helvetica'],
    runs: [
      'BT /F1 10 Tf 48 380 Td (A wide heading overlaps both prose columns for repeated lane evidence.) Tj ET',
      'BT /F1 10 Tf 48 360 Td (A second wide heading also overlaps both prose columns for lane evidence.) Tj ET',
      'BT /F1 10 Tf 48 340 Td (A third wide heading supplies another overlapping row for lane evidence.) Tj ET',
      'BT /F1 10 Tf 48 300 Td (Left section label.) Tj ET',
      'BT /F1 10 Tf 48 270 Td (Left paragraph line.) Tj ET',
      'BT /F1 10 Tf 350 300 Td (Right continuation one.) Tj ET',
      'BT /F1 10 Tf 350 283 Td (Right continuation two.) Tj ET',
      'BT /F1 10 Tf 350 266 Td (Right continuation three.) Tj ET',
    ],
  });
}

function stackedEquationSelectionRegressionPdfFixture() {
  return positionedTextPdfFixture({
    mediaBox: [0, 0, 420, 260],
    fonts: ['Helvetica', 'Helvetica-Oblique'],
    runs: [
      'BT /F1 14 Tf 48 180 Td (states ) Tj ET',
      'BT /F1 14 Tf 91 180 Td (OPEN) Tj ET',
      'BT /F1 9 Tf 98 190 Td (FA) Tj ET',
      'BT /F2 14 Tf 111 180 Td (h) Tj ET',
      'BT /F1 8 Tf 121 176 Td (1) Tj ET',
      'BT /F1 14 Tf 128 180 Td (, ..., ) Tj ET',
      'BT /F1 9 Tf 163 190 Td (FB) Tj ET',
      'BT /F2 14 Tf 177 180 Td (h) Tj ET',
      'BT /F1 8 Tf 187 176 Td (m) Tj ET',
      'BT /F1 14 Tf 196 180 Td (CLOSE and a backward sequence) Tj ET',
      'BT /F1 14 Tf 48 156 Td (OPEN) Tj ET',
      'BT /F1 9 Tf 55 166 Td (BA) Tj ET',
      'BT /F2 14 Tf 69 156 Td (k) Tj ET',
      'BT /F1 8 Tf 79 152 Td (1) Tj ET',
      'BT /F1 14 Tf 86 156 Td (, ..., ) Tj ET',
      'BT /F1 9 Tf 121 166 Td (BB) Tj ET',
      'BT /F2 14 Tf 135 156 Td (k) Tj ET',
      'BT /F1 8 Tf 145 152 Td (m) Tj ET',
      'BT /F1 14 Tf 154 156 Td (CLOSE. The hidden states) Tj ET',
      'BT /F1 14 Tf 48 132 Td (continue in prose.) Tj ET',
    ],
  });
}

function previewFootnoteSelectionRegressionPdfFixture() {
  return positionedTextPdfFixture({
    mediaBox: [0, 0, 640, 420],
    fonts: ['Helvetica', 'Times-Roman'],
    runs: [
      'BT /F1 16 Tf 48 300 Td (Left body line one.) Tj ET',
      'BT /F1 16 Tf 48 275 Td (Left body line two.) Tj ET',
      'BT /F1 16 Tf 48 250 Td (Left body line three.) Tj ET',
      'BT /F2 10 Tf 48 190 Td (Footnote line one.) Tj ET',
      'BT /F2 10 Tf 48 178.8 Td (Footnote line two.) Tj ET',
      'BT /F1 16 Tf 350 298 Td (Right continuation one.) Tj ET',
      'BT /F1 16 Tf 350 273 Td (Right continuation two.) Tj ET',
      'BT /F1 16 Tf 350 248 Td (Right continuation three.) Tj ET',
    ],
  });
}

function staggeredBandBridgeRegressionPdfFixture() {
  return positionedTextPdfFixture({
    mediaBox: [0, 0, 640, 400],
    fonts: ['Helvetica'],
    runs: [
      'BT /F1 10 Tf 48 300 Td (Left local row one has complete coverage.) Tj ET',
      'BT /F1 10 Tf 48 286 Td (Left local row two has complete coverage.) Tj ET',
      'BT /F1 10 Tf 48 272 Td (Left local row three has complete coverage.) Tj ET',
      'BT /F1 10 Tf 350 294 Td (Right staggered row one remains independent.) Tj ET',
      'BT /F1 10 Tf 350 280 Td (Right staggered row two remains independent.) Tj ET',
      'BT /F1 10 Tf 350 266 Td (Right staggered row three remains independent.) Tj ET',
    ],
  });
}

function authorGridSelectionRegressionPdfFixture() {
  return positionedTextPdfFixture({
    mediaBox: [0, 0, 640, 360],
    fonts: ['Helvetica-Bold', 'Helvetica'],
    runs: [
      'BT /F1 16 Tf 48 260 Td (Rafael Alpha) Tj ET',
      'BT /F1 16 Tf 250 260 Td (Archit Beta) Tj ET',
      'BT /F1 16 Tf 500 260 Td (Eric Gamma) Tj ET',
      'BT /F1 16 Tf 48 235 Td (Stefano Delta) Tj ET',
      'BT /F1 16 Tf 250 235 Td (Christopher Epsilon) Tj ET',
      'BT /F1 16 Tf 500 235 Td (Chelsea Zeta) Tj ET',
      'BT /F2 14 Tf 48 210 Td (authors@example.test) Tj ET',
    ],
  });
}

function numericTableSelectionRegressionPdfFixture() {
  const rows = [
    ['BERT Base Score ', '88', '19 76', '89', '88.09'],
    ['BERT Large Score ', '90', '87 89', '65', '90.94'],
    ['GPT3 126M Score ', '19', '01 28', '37', '19.43'],
    ['GPT3 1.3B Score ', '10', '19 12', '74', '10.29'],
    ['GPT3 6.7B Score ', '8', '51 10', '29', '8.41'],
  ];
  const runs = ['BT /F1 12 Tf 80 310 Td (Model Metric FP16 int8 FP8) Tj ET'];
  rows.forEach((row, index) => {
    const baseline = 280 - index * 24;
    const firstDot = row[1].length === 1 ? 367 : 373;
    const middleValue = firstDot + 4;
    const secondDot = middleValue + 30;
    const finalPlainValue = secondDot + 4;
    runs.push(
      `BT /F1 12 Tf 80 ${baseline} Td (${row[0]}) Tj ET`,
      `BT /F1 12 Tf 360 ${baseline} Td (${row[1]}) Tj ET`,
      `BT /F2 12 Tf ${firstDot} ${baseline} Td (.) Tj ET`,
      `BT /F1 12 Tf ${middleValue} ${baseline} Td (${row[2]}) Tj ET`,
      `BT /F2 12 Tf ${secondDot} ${baseline} Td (.) Tj ET`,
      `BT /F1 12 Tf ${finalPlainValue} ${baseline} Td (${row[3]}) Tj ET`,
      `BT /F3 12 Tf 446 ${baseline} Td (${row[4]}) Tj ET`,
    );
  });
  return positionedTextPdfFixture({
    mediaBox: [0, 0, 640, 420],
    fonts: ['Helvetica', 'Times-Italic', 'Courier-Bold'],
    runs,
  });
}

function centeredMastheadSelectionRegressionPdfFixture() {
  return positionedTextPdfFixture({
    mediaBox: [0, 0, 612, 500],
    fonts: ['Helvetica', 'Helvetica-Bold', 'Courier'],
    runs: [
      'BT /F1 14 Tf 172 410 Td (FP8 F) Tj ET',
      'BT /F1 11 Tf 217 407 Td (ORMATS ) Tj ET',
      'BT /F1 14 Tf 282 410 Td (F) Tj ET',
      'BT /F1 11 Tf 292 407 Td (OR ) Tj ET',
      'BT /F1 14 Tf 317 410 Td (D) Tj ET',
      'BT /F1 11 Tf 331 407 Td (EEP ) Tj ET',
      'BT /F1 14 Tf 362 410 Td (L) Tj ET',
      'BT /F1 11 Tf 373 407 Td (EARNING) Tj ET',
      'BT /F2 9 Tf 87 338 Td (Paulius Micikevicius, Dusan Stosic, Patrick Judd, John Kamalu, Stuart Oberman, Mohammad Shoeybi,) Tj ET',
      'BT /F2 9 Tf 261 327 Td (Michael Siu, Hao Wu) Tj ET',
      'BT /F1 11 Tf 288 316 Td (NVIDIA) Tj ET',
      'BT /F3 8.7 Tf 102 304 Td ({pauliusm, dstosic, pjudd, jkamalu, soberman, mshoeybi, msiu, skyw}@nvidia.com) Tj ET',
      'BT /F2 9 Tf 199 277 Td (Neil Burgess, Sangwon Ha, Richard Grisenthwaite) Tj ET',
      'BT /F1 11 Tf 297 266 Td (Arm) Tj ET',
      'BT /F3 8.7 Tf 157 254 Td ({neil.burgess, sangwon.ha, richard.grisenthwaite}@arm.com) Tj ET',
      'BT /F2 9 Tf 148 227 Td (Naveen Mellempudi, Marius Cornea, Alexander Heinecke, Pradeep Dubey) Tj ET',
      'BT /F1 11 Tf 297 216 Td (Intel) Tj ET',
      'BT /F3 8.7 Tf 94 204 Td ({naveen.k.mellempudi, marius.cornea, alexander.heinecke, pradeep.dubey}@intel.com) Tj ET',
      'BT /F2 12 Tf 276 150 Td (Abstract) Tj ET',
    ],
  });
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
    '<< /Type /Catalog /Pages 2 0 R /Names << /Dests 12 0 R >> /Outlines 14 0 R /PageMode /UseOutlines >>',
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
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 600] /Resources << /Font << /F1 11 0 R >> >> /Contents 8 0 R /Annots [13 0 R 17 0 R] >>',
    pdfStream([
      'BT /F1 18 Tf 42 286 Td (Figure 11.1 target) Tj ET',
      'BT /F1 12 Tf 42 260 Td (The direct destination should align the figure here.) Tj ET',
      '0 0 1 rg BT /F1 14 Tf 42 360 Td (Figure 11.1 detail) Tj ET',
      '0 0 1 rg BT /F1 14 Tf 42 220 Td (Section 12.2) Tj ET',
    ].join('\n')),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 600] /Resources << /Font << /F1 11 0 R >> >> /Contents 10 0 R /Annots [18 0 R] >>',
    pdfStream([
      'BT /F1 18 Tf 42 500 Td (Section 12.2 target) Tj ET',
      'BT /F1 12 Tf 42 474 Td (The named destination should align the section here.) Tj ET',
      '0 0 1 rg BT /F1 12 Tf 42 400 Td (See Figure 3-12 source reference above the figure.) Tj ET',
      'q 0.95 g 42 200 216 150 re f 0.2 G 42 200 216 150 re S Q',
      '0 g BT /F1 12 Tf 80 270 Td (Figure artwork region) Tj ET',
      'BT /F1 12 Tf 42 170 Td (Figure 3-12. Caption below the artwork.) Tj ET',
    ].join('\n')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Names [(section.12.2) [9 0 R /XYZ 42 516 0]] >>',
    '<< /Type /Annot /Subtype /Link /Rect [40 210 140 234] /Border [0 0 0] /Contents (Section 12.2) /Dest (section.12.2) >>',
    '<< /Type /Outlines /First 15 0 R /Last 15 0 R /Count 2 >>',
    '<< /Title (Internal destinations) /Parent 14 0 R /Dest [3 0 R /Fit] /First 16 0 R /Last 16 0 R /Count 1 >>',
    '<< /Title (Section 12.2) /Parent 15 0 R /Dest (section.12.2) >>',
    '<< /Type /Annot /Subtype /Link /Rect [40 350 174 374] /Border [0 0 0] /Contents (Figure 11.1 detail) /Dest [7 0 R /XYZ 42 302 0] >>',
    '<< /Type /Annot /Subtype /Link /Rect [64 390 132 406] /Border [0 0 0] /Contents (Figure 3-12 source reference) /Dest [9 0 R /XYZ 42 370 0] >>',
  ];
  return pdfFixture(objects);
}

function inferredOutlinePdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents 4 0 R >>',
    pdfStream([
      'BT /F2 16 Tf 72 700 Td (1 Introduction) Tj ET',
      'BT /F1 10 Tf 72 675 Td (This paragraph establishes the ordinary document body typography.) Tj ET',
      'BT /F1 10 Tf 72 660 Td (It contains enough text for a conservative document profile.) Tj ET',
      'BT /F1 10 Tf 72 645 Td (The remaining prose deliberately uses the same body style.) Tj ET',
      'BT /F1 10 Tf 72 630 Td (A fourth line makes the body median stable and predictable.) Tj ET',
      'BT /F2 13 Tf 72 580 Td (1.1 Motivation) Tj ET',
      'BT /F1 10 Tf 72 555 Td (Motivation body text follows the nested section heading.) Tj ET',
      'BT /F1 10 Tf 72 540 Td (It remains ordinary prose and must not become an outline entry.) Tj ET',
      'BT /F1 10 Tf 72 525 Td (Figure 1: this caption is intentionally plain body text.) Tj ET',
      'BT /F1 10 Tf 72 510 Td (Another body line completes the first page fixture.) Tj ET',
    ].join('\n')),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents 6 0 R >>',
    pdfStream([
      'BT /F2 16 Tf 72 700 Td (2 Method) Tj ET',
      'BT /F1 10 Tf 72 675 Td (The method page repeats the same body typography.) Tj ET',
      'BT /F1 10 Tf 72 660 Td (Inference should navigate here without authored bookmarks.) Tj ET',
      'BT /F1 10 Tf 72 645 Td (The detector remains local deterministic and conservative.) Tj ET',
      'BT /F1 10 Tf 72 630 Td (This final body line stabilizes the second page profile.) Tj ET',
    ].join('\n')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  return pdfFixture(objects);
}

function shiftedContentsLinksPdfFixture() {
  const shiftedPage = (contentsRef, annotationRefs = '') => (
    `<< /Type /Page /Parent 2 0 R /MediaBox [36 36 336 636] /CropBox [36 36 336 636] `
    + `/Resources << /Font << /F1 17 0 R >> >> /Contents ${contentsRef} 0 R`
    + `${annotationRefs ? ` /Annots [${annotationRefs}]` : ''} >>`
  );
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 9 0 R 11 0 R 13 0 R 15 0 R] /Count 5 >>',
    shiftedPage(4, '5 0 R 6 0 R 7 0 R 8 0 R'),
    pdfStream([
      'BT /F1 20 Tf 78 576 Td (Shifted contents) Tj ET',
      '0 0 1 rg BT /F1 14 Tf 78 506 Td (12.1 Lighting Problem) Tj ET',
      '0 0 1 rg BT /F1 14 Tf 250 506 Td (136) Tj ET',
      '0 0 1 rg BT /F1 14 Tf 78 486 Td (12.2 Radiometry) Tj ET',
      '0 0 1 rg BT /F1 14 Tf 250 486 Td (141) Tj ET',
      '0 0 1 rg BT /F1 14 Tf 78 466 Td (12.3 Rendering Equation) Tj ET',
      '0 0 1 rg BT /F1 14 Tf 250 466 Td (157) Tj ET',
      '0 0 1 rg BT /F1 14 Tf 78 446 Td (12.4 Shading Equation) Tj ET',
      '0 0 1 rg BT /F1 14 Tf 250 446 Td (168) Tj ET',
    ].join('\n')),
    // Deliberately out of visual order. With the engine's uncorrected box
    // origin, the 12.4 rectangle lands over the visible 12.2 row.
    '<< /Type /Annot /Subtype /Link /Rect [76 436 296 454] /Border [0 0 0] /Dest [15 0 R /FitH 536] >>',
    '<< /Type /Annot /Subtype /Link /Rect [76 476 296 494] /Border [0 0 0] /Dest [11 0 R /FitH 536] >>',
    '<< /Type /Annot /Subtype /Link /Rect [76 496 296 514] /Border [0 0 0] /Dest [9 0 R /FitH 536] >>',
    '<< /Type /Annot /Subtype /Link /Rect [76 456 296 474] /Border [0 0 0] /Dest [13 0 R /FitH 536] >>',
    shiftedPage(10),
    pdfStream('BT /F1 18 Tf 78 536 Td (Section 12.1 target) Tj ET'),
    shiftedPage(12),
    pdfStream('BT /F1 18 Tf 78 536 Td (Section 12.2 target) Tj ET'),
    shiftedPage(14),
    pdfStream('BT /F1 18 Tf 78 536 Td (Section 12.3 target) Tj ET'),
    shiftedPage(16),
    pdfStream('BT /F1 18 Tf 78 536 Td (Section 12.4 target) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  return pdfFixture(objects);
}

function shiftedSingleLinkPdfFixture() {
  const shiftedPage = (contentsRef, annotationRefs = '') => (
    `<< /Type /Page /Parent 2 0 R /MediaBox [36 36 336 636] /CropBox [36 36 336 636] `
    + `/Resources << /Font << /F1 8 0 R >> >> /Contents ${contentsRef} 0 R`
    + `${annotationRefs ? ` /Annots [${annotationRefs}]` : ''} >>`
  );
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    shiftedPage(4, '5 0 R'),
    pdfStream([
      'BT /F1 14 Tf 91 486 Td (An unrelated line occupies the raw link rectangle.) Tj ET',
      '0 0 1 rg BT /F1 14 Tf 103 450 Td (Section 12.2.4.1) Tj ET',
      '0 g BT /F1 14 Tf 103 420 Td (The visible reference itself must receive the click.) Tj ET',
    ].join('\n')),
    '<< /Type /Annot /Subtype /Link /Rect [103 447 204.2 463] /Border [0 0 0] /Dest [6 0 R /FitH 536] >>',
    shiftedPage(7),
    pdfStream('BT /F1 18 Tf 78 536 Td (Section 12.2.4.1 target) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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

function positionedTextPdfFixture({ mediaBox, fonts, runs }) {
  const firstContentObject = 4;
  const firstFontObject = firstContentObject + runs.length;
  const contents = runs
    .map((_, index) => `${firstContentObject + index} 0 R`)
    .join(' ');
  const resources = fonts
    .map((_, index) => `/F${index + 1} ${firstFontObject + index} 0 R`)
    .join(' ');
  return pdfFixture([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(' ')}] /Resources << /Font << ${resources} >> >> /Contents [${contents}] >>`,
    ...runs.map(pdfStream),
    ...fonts.map(font => `<< /Type /Font /Subtype /Type1 /BaseFont /${font} >>`),
  ]);
}

function pdfStream(content) {
  return `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`;
}
