import { browserAdaptor } from '@mathjax/src/cjs/adaptors/browserAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/cjs/handlers/html.js';
import { mathjax } from '@mathjax/src/cjs/mathjax.js';
import { TeX } from '@mathjax/src/cjs/input/tex.js';
import { SVG } from '@mathjax/src/cjs/output/svg.js';
import '@mathjax/src/cjs/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/cjs/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/cjs/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/cjs/input/tex/noundefined/NoUndefinedConfiguration.js';

export type MathRenderResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

const adaptor = browserAdaptor();
RegisterHTMLHandler(adaptor);
const document = mathjax.document(globalThis.document, {
  InputJax: new TeX({ packages: ['base', 'ams', 'mathtools', 'newcommand', 'noundefined'] }),
  OutputJax: new SVG({ fontCache: 'local' }),
});

export function renderMath(expression: string, displayMode: boolean): MathRenderResult {
  try {
    const node = document.convert(expression, {
      em: 16,
      ex: 8,
      containerWidth: 80 * 16,
      display: displayMode,
    }) as unknown;
    const html = adaptor.outerHTML(node as HTMLElement);
    const error = mathJaxErrorFromHtml(html);
    return error ? { ok: false, error } : { ok: true, html };
  } catch (error) {
    return { ok: false, error: mathErrorMessage(error) };
  }
}

function mathJaxErrorFromHtml(html: string): string | null {
  const match = html.match(/\sdata-mjx-error="([^"]+)"/);
  if (!match) return null;
  const textarea = globalThis.document.createElement('textarea');
  textarea.innerHTML = match[1] ?? '';
  return textarea.value.trim() || 'MathJax could not parse this expression.';
}

function mathErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : 'MathJax could not parse this expression.';
}
