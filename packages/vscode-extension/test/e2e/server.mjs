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

  if (url.pathname === '/fixtures/ddia-local.pdf') {
    serveFile(join(__dirname, '..', '..', '..', '..', 'demo-vault', 'raw', 'pdf', 'ddia.pdf'), 'application/pdf', res);
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

  if (url.pathname === '/fixtures/unicode-selector.pdf') {
    serveBuffer(unicodeSelectorPdfFixture(), 'application/pdf', res);
    return;
  }

  if (url.pathname === '/fixtures/internal-destinations.pdf') {
    serveBuffer(internalDestinationsPdfFixture(), 'application/pdf', res);
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
      'BT /F1 18 Tf 72 670 Td (It is standard attention with exact results.) Tj ET',
    ].join('\n')),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
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

function pdfStream(content) {
  return `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`;
}
