import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

const SANDBOX_ROOT = '__llm_wiki_vscode_e2e_sandboxes__';
export const MULTIPAGE_PDF_FIXTURE = 'raw/pdf/multipage-fixture.pdf';

export const VIM_SANDBOXES = Object.freeze({
  modifierShortcuts: sandbox('vim-modifier-shortcuts.md', 'LLM Wiki E2E Vim modifier shortcuts'),
  commandO: sandbox('vim-command-o.md', 'LLM Wiki E2E Vim command O'),
  delayedFocus: sandbox('vim-delayed-focus.md', 'LLM Wiki E2E Vim delayed focus'),
  deleteLine: sandbox('vim-delete-line.md', 'LLM Wiki E2E Vim delete line'),
  deleteHeading: sandbox('vim-delete-heading.md', 'LLM Wiki E2E Vim delete heading'),
  headingCommands: sandbox('vim-heading-commands.md', 'LLM Wiki E2E Vim heading commands'),
});

export function prepareSandboxFixtures(vaultRoot) {
  for (const fixture of Object.values(VIM_SANDBOXES)) {
    const file = resolve(vaultRoot, fixture.relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${fixture.marker}\n`, 'utf8');
  }

  const multipagePdf = resolve(vaultRoot, MULTIPAGE_PDF_FIXTURE);
  mkdirSync(dirname(multipagePdf), { recursive: true });
  writeFileSync(multipagePdf, buildMultipagePdf(67));
}

export function cleanupSandboxFixtures(vaultRoot) {
  rmSync(resolve(vaultRoot, SANDBOX_ROOT), { recursive: true, force: true });
  rmSync(resolve(vaultRoot, MULTIPAGE_PDF_FIXTURE), { force: true });
}

function sandbox(fileName, marker) {
  return Object.freeze({
    relativePath: `${SANDBOX_ROOT}/${fileName}`,
    marker,
  });
}

function buildMultipagePdf(pageCount) {
  const fontObjectId = 3 + pageCount * 2;
  const outlineRootObjectId = fontObjectId + 1;
  const outlineItemObjectId = outlineRootObjectId + 1;
  const pageObjectIds = Array.from({ length: pageCount }, (_, index) => 3 + index * 2);
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R /Outlines ${outlineRootObjectId} 0 R /PageMode /UseOutlines >>`,
    `<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
  ];

  pageObjectIds.forEach((pageObjectId, index) => {
    const contentObjectId = pageObjectId + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      pdfStream(`BT /F1 18 Tf 72 300 Td (Synthetic page ${index + 1}) Tj ET`),
    );
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push(
    `<< /Type /Outlines /First ${outlineItemObjectId} 0 R /Last ${outlineItemObjectId} 0 R /Count 1 >>`,
    `<< /Title (Slide 3: Outline and goals) /Parent ${outlineRootObjectId} 0 R /Dest [${pageObjectIds[1]} 0 R /XYZ 72 330 0] >>`,
  );

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
