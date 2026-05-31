import DOMPurify from 'dompurify';
import TurndownService from 'turndown';

const literalTextTurndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
});

export function markdownFromPastedHtml(html: string): string | null {
  const cleanHtml = DOMPurify.sanitize(removeBlockedPasteContainers(html), {
    ADD_TAGS: ['annotation', 'math', 'mjx-container', 'mrow', 'semantics'],
    ADD_ATTR: ['data-display', 'data-tex', 'display', 'encoding', 'jax'],
    ALLOW_UNKNOWN_PROTOCOLS: true,
  });
  const document = new DOMParser().parseFromString(cleanHtml, 'text/html');
  const blocks = Array.from(document.body.childNodes)
    .map(node => markdownBlockFromHtmlNode(node))
    .map(block => block.trim())
    .filter(block => block.length > 0);
  return blocks.length === 0 ? null : blocks.join('\n\n');
}

function removeBlockedPasteContainers(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script, style, iframe, object, embed').forEach(element => element.remove());
  return document.body.innerHTML;
}

function markdownBlockFromHtmlNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeInlineWhitespace(node.textContent ?? '');
  }
  if (!(node instanceof HTMLElement)) return '';

  const tagName = node.tagName.toLowerCase();
  const math = markdownMathFromHtml(node);
  if (math) return math;

  const callout = markdownCalloutFromHtml(node);
  if (callout) return callout;

  if (/^h[1-6]$/.test(tagName)) {
    return `${'#'.repeat(Number(tagName[1]))} ${markdownInlineChildren(node).trim()}`;
  }
  if (tagName === 'p' || tagName === 'div' || tagName === 'section' || tagName === 'article') {
    return markdownInlineChildren(node).trim();
  }
  if (tagName === 'pre') {
    return markdownCodeBlockFromHtml(node);
  }
  if (tagName === 'blockquote') {
    return markdownBlocksFromChildren(node)
      .split('\n')
      .map(line => line.length > 0 ? `> ${line}` : '>')
      .join('\n');
  }
  if (tagName === 'ul' || tagName === 'ol') {
    return markdownListFromHtml(node, tagName === 'ol');
  }
  if (tagName === 'table') {
    return markdownTableFromHtml(node);
  }
  if (tagName === 'br') return '\n';
  return markdownInlineChildren(node).trim();
}

function markdownBlocksFromChildren(element: HTMLElement): string {
  return Array.from(element.childNodes)
    .map(node => markdownBlockFromHtmlNode(node))
    .map(block => block.trim())
    .filter(block => block.length > 0)
    .join('\n\n');
}

function markdownInlineChildren(element: HTMLElement): string {
  return Array.from(element.childNodes).map(markdownInlineFromHtmlNode).join('').replace(/[ \t]+\n/g, '\n');
}

function markdownCalloutFromHtml(callout: HTMLElement): string | null {
  if (!callout.classList.contains('callout') && !callout.hasAttribute('data-callout')) {
    return null;
  }

  const type = callout.getAttribute('data-callout')?.trim();
  if (!type) return null;

  const titleElement = callout.querySelector('.callout-title-inner');
  const contentElement = callout.querySelector('.callout-content');
  const rawTitle = titleElement instanceof HTMLElement
    ? markdownInlineChildren(titleElement).trim()
    : '';
  const title = isDefaultCalloutTitle(type, rawTitle) ? '' : rawTitle;
  const body = contentElement instanceof HTMLElement
    ? markdownBlocksFromChildren(contentElement)
    : '';
  const fold = markdownCalloutFold(callout);
  const firstLine = title.length > 0
    ? `> [!${type}]${fold} ${title}`
    : `> [!${type}]${fold}`;
  if (!body) return firstLine;

  return [
    firstLine,
    ...body.split('\n').map(line => line.length > 0 ? `> ${line}` : '>'),
  ].join('\n');
}

function markdownCalloutFold(callout: HTMLElement): string {
  const fold = callout.getAttribute('data-callout-fold')?.trim();
  return fold === '+' || fold === '-' ? fold : '';
}

function isDefaultCalloutTitle(type: string, title: string): boolean {
  return normalizeCalloutTitle(title) === normalizeCalloutTitle(humanizeCalloutType(type));
}

function humanizeCalloutType(type: string): string {
  return type
    .replace(/[-_]+/g, ' ')
    .replace(/\b\p{L}/gu, letter => letter.toLocaleUpperCase());
}

function normalizeCalloutTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function markdownInlineFromHtmlNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeInlineWhitespace(node.textContent ?? '');
  }
  if (!(node instanceof HTMLElement)) return '';

  const tagName = node.tagName.toLowerCase();
  const math = markdownMathFromHtml(node);
  if (math) return math;

  if (tagName === 'br') return '\n';
  if (tagName === 'strong' || tagName === 'b') return wrapInlineMarkdown('**', markdownInlineChildren(node));
  if (tagName === 'em' || tagName === 'i') return wrapInlineMarkdown('*', markdownInlineChildren(node));
  if (tagName === 's' || tagName === 'del' || tagName === 'strike') return wrapInlineMarkdown('~~', markdownInlineChildren(node));
  if (isHighlightElement(node, tagName)) return wrapInlineMarkdown('==', markdownInlineChildren(node));
  if (tagName === 'code' && node.closest('pre') == null) {
    return `\`${(node.textContent ?? '').replace(/`/g, '\\`')}\``;
  }
  if (node instanceof HTMLImageElement) {
    return markdownImageFromHtml(node);
  }
  if (node instanceof HTMLAnchorElement) {
    return markdownLinkFromHtml(node);
  }
  return markdownInlineChildren(node);
}

function markdownMathFromHtml(element: HTMLElement): string | null {
  if (!isMathContainerElement(element)) return null;

  const tex = texAnnotationFromMathElement(element);
  if (!tex) return null;
  return isDisplayMathElement(element)
    ? `$$\n${tex}\n$$`
    : `$${tex}$`;
}

function isMathContainerElement(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();
  return tagName === 'mjx-container'
    || element.classList.contains('katex')
    || element.classList.contains('katex-display')
    || element.classList.contains('math')
    || element.classList.contains('math-inline')
    || element.classList.contains('math-display')
    || element.classList.contains('cm-hybrid-inline-math')
    || element.classList.contains('cm-hybrid-math-block');
}

function texAnnotationFromMathElement(element: HTMLElement): string | null {
  const dataTex = element.dataset.tex?.trim()
    ?? element.querySelector<HTMLElement>('[data-tex]')?.dataset.tex?.trim();
  if (dataTex && dataTex.length > 0) return dataTex;

  const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
  const tex = annotation?.textContent?.trim();
  return tex && tex.length > 0 ? tex : null;
}

function isDisplayMathElement(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();
  const dataDisplay = element.dataset.display
    ?? element.querySelector<HTMLElement>('[data-display]')?.dataset.display;
  return element.classList.contains('katex-display')
    || element.classList.contains('math-display')
    || element.classList.contains('cm-hybrid-math-block')
    || dataDisplay === 'true'
    || (tagName === 'mjx-container' && element.getAttribute('display') === 'true');
}

function isHighlightElement(element: HTMLElement, tagName: string): boolean {
  return tagName === 'mark'
    || element.classList.contains('cm-highlight')
    || element.classList.contains('cm-active-highlight')
    || element.classList.contains('cm-hybrid-highlight');
}

function markdownLinkFromHtml(anchor: HTMLAnchorElement): string {
  const wikilink = markdownWikilinkFromHtml(anchor);
  if (wikilink) return wikilink;

  const label = markdownInlineChildren(anchor).trim() || anchor.textContent?.trim() || '';
  const href = anchor.getAttribute('href')?.trim();
  return href ? `[${escapeMarkdownLinkLabel(label)}](${href})` : label;
}

function markdownWikilinkFromHtml(anchor: HTMLAnchorElement): string | null {
  if (!anchor.classList.contains('internal-link') && !anchor.hasAttribute('data-href')) {
    return null;
  }

  const target = anchor.getAttribute('data-href')?.trim();
  if (!target) return null;

  const label = markdownInlineChildren(anchor).trim() || anchor.textContent?.trim() || target;
  const escapedTarget = escapeWikilinkPart(target);
  return label === target
    ? `[[${escapedTarget}]]`
    : `[[${escapedTarget}|${escapeWikilinkPart(label)}]]`;
}

function markdownCodeBlockFromHtml(pre: HTMLElement): string {
  const code = pre.querySelector('code');
  const language = code ? codeLanguageFromClassName(code.className) : '';
  const text = (code?.textContent ?? pre.textContent ?? '').replace(/\n+$/g, '');
  return [`\`\`\`${language}`, text, '```'].join('\n');
}

function codeLanguageFromClassName(className: string): string {
  const match = className.match(/(?:^|\s)(?:language-|lang-)([^\s]+)/);
  return match?.[1] ?? '';
}

function markdownTableFromHtml(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll('tr'))
    .map(markdownTableRowFromHtml)
    .filter(row => row.length > 0);
  if (rows.length === 0) return '';

  const columnCount = Math.max(...rows.map(row => row.length));
  const normalizedRows = rows.map(row => normalizeTableRow(row, columnCount));
  const [header = [], ...body] = normalizedRows;
  return [
    markdownTableLine(header),
    markdownTableLine(Array.from({ length: columnCount }, () => '---')),
    ...body.map(markdownTableLine),
  ].join('\n');
}

function markdownTableRowFromHtml(row: HTMLTableRowElement): string[] {
  return Array.from(row.children)
    .filter((cell): cell is HTMLElement => {
      const tagName = cell.tagName.toLowerCase();
      return tagName === 'th' || tagName === 'td';
    })
    .map(cell => escapeMarkdownTableCell(markdownInlineChildren(cell).trim()));
}

function normalizeTableRow(row: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? '');
}

function markdownTableLine(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\n+/g, ' ').replace(/\|/g, '\\|');
}

function markdownListFromHtml(list: HTMLElement, ordered: boolean): string {
  const items = Array.from(list.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === 'li');

  return items.map((item, index) => {
    const marker = ordered ? `${index + 1}.` : '-';
    const task = markdownTaskPrefixFromListItem(item);
    const content = markdownListItemInlineContent(item);
    const nested = markdownNestedListsFromListItem(item);
    const lines = markdownListItemLines(`${task}${content}`.trim());
    const firstLine = lines.shift() ?? '';
    const itemLines = [`${marker} ${firstLine}`];
    itemLines.push(...lines.map(line => `  ${line}`));
    itemLines.push(...nested.flatMap(block => block.split('\n').map(line => `  ${line}`)));
    return itemLines.join('\n');
  }).join('\n');
}

function markdownListItemInlineContent(item: HTMLElement): string {
  return Array.from(item.childNodes)
    .filter(node => !isNestedListElement(node) && !isCheckboxInputElement(node))
    .map(node => markdownListItemChildMarkdown(node))
    .map(block => block.trim())
    .filter(block => block.length > 0)
    .join('\n');
}

function markdownListItemChildMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeInlineWhitespace(node.textContent ?? '');
  }
  if (!(node instanceof HTMLElement)) return '';

  const tagName = node.tagName.toLowerCase();
  if (tagName === 'p' || tagName === 'div' || tagName === 'section' || tagName === 'article') {
    return markdownInlineChildren(node).trim();
  }
  if (tagName === 'pre' || tagName === 'blockquote') {
    return markdownBlockFromHtmlNode(node);
  }
  return markdownInlineFromHtmlNode(node);
}

function markdownNestedListsFromListItem(item: HTMLElement): string[] {
  return Array.from(item.childNodes)
    .filter(isNestedListElement)
    .map(list => markdownListFromHtml(list, list.tagName.toLowerCase() === 'ol'))
    .filter(block => block.length > 0);
}

function markdownListItemLines(content: string): string[] {
  return content.length > 0 ? content.split('\n') : [''];
}

function markdownImageFromHtml(image: HTMLImageElement): string {
  const embed = markdownEmbeddedWikilinkFromHtml(image);
  if (embed) return embed;

  const src = image.getAttribute('src')?.trim();
  if (!src) return image.alt.trim();
  return `![${escapeMarkdownLinkLabel(image.alt.trim())}](${src})`;
}

function markdownEmbeddedWikilinkFromHtml(image: HTMLImageElement): string | null {
  const embedElement = image.closest<HTMLElement>('.internal-embed, .image-embed, [data-href]');
  const target = embedElement?.getAttribute('data-href')?.trim()
    || image.getAttribute('data-href')?.trim();
  if (!target) return null;

  const alt = image.alt.trim();
  const escapedTarget = escapeWikilinkPart(target);
  if (!alt || alt === target) return `![[${escapedTarget}]]`;
  return `![[${escapedTarget}|${escapeWikilinkPart(alt)}]]`;
}

function escapeMarkdownLinkLabel(value: string): string {
  return value.replace(/([\\\]])/g, '\\$1');
}

function escapeWikilinkPart(value: string): string {
  return value.replace(/([\\\]\|])/g, '\\$1');
}

function markdownTaskPrefixFromListItem(item: HTMLElement): string {
  const checkbox = Array.from(item.children).find(isCheckboxInputElement);
  if (!checkbox) return '';
  return checkbox.checked ? '[x] ' : '[ ] ';
}

function isNestedListElement(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && (node.tagName.toLowerCase() === 'ul' || node.tagName.toLowerCase() === 'ol');
}

function isCheckboxInputElement(node: Node): node is HTMLInputElement {
  return node instanceof HTMLInputElement && node.type === 'checkbox';
}

function wrapInlineMarkdown(delimiter: string, value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? `${delimiter}${trimmed}${delimiter}` : '';
}

function normalizeInlineWhitespace(value: string): string {
  return escapeLiteralMarkdownText(value.replace(/\s+/g, ' '));
}

function escapeLiteralMarkdownText(value: string): string {
  const leadingSpace = value.startsWith(' ') ? ' ' : '';
  const trailingSpace = value.endsWith(' ') ? ' ' : '';
  const core = value.trim();
  if (!core) return value;
  return `${leadingSpace}${turndownEscapedText(core)}${trailingSpace}`;
}

function turndownEscapedText(value: string): string {
  const span = document.createElement('span');
  span.textContent = value;
  return literalTextTurndown.turndown(span.innerHTML);
}
