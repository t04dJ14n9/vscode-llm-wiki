import { undo } from '@codemirror/commands';
import type { Text, Transaction } from '@codemirror/state';
import { WidgetType } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { isMap, isScalar, isSeq, parse as parseYamlValue, parseDocument } from 'yaml';

export interface FrontmatterProperty {
  name: string;
  value: string;
  rawValue: string;
  chips: string[];
  table?: FrontmatterTable;
  yamlStyle: 'scalar' | 'inline-list' | 'block-list';
  lineFrom: number;
  lineTo: number;
}

export interface FrontmatterTable {
  columns: string[];
  rows: string[][];
  paths: Array<Array<Array<string | number>>>;
}

export interface FrontmatterBlock {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  bodyFrom: number;
  insertBefore: number;
  properties: FrontmatterProperty[];
}

export class FrontmatterPropertiesWidget extends WidgetType {
  constructor(
    private readonly properties: FrontmatterProperty[],
    private readonly bodyFrom: number,
    private readonly insertBefore: number,
  ) {
    super();
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-hybrid-properties';

    const heading = document.createElement('button');
    heading.type = 'button';
    heading.className = 'cm-hybrid-properties-heading';
    heading.ariaLabel = 'Properties';
    heading.setAttribute('aria-expanded', 'true');
    const headingChevron = document.createElement('span');
    headingChevron.className = 'cm-hybrid-properties-chevron';
    headingChevron.setAttribute('aria-hidden', 'true');
    headingChevron.textContent = '⌄';
    const headingLabel = document.createElement('span');
    headingLabel.textContent = 'Properties';
    heading.append(headingChevron, headingLabel);
    wrapper.appendChild(heading);

    const rows = document.createElement('div');
    rows.className = 'cm-hybrid-properties-rows';
    for (const [propertyIndex, property] of this.properties.entries()) {
      const row = document.createElement('div');
      row.className = 'cm-hybrid-property-row';
      if (property.table) {
        row.classList.add('cm-hybrid-property-row-structured');
      }

      const name = this.createPropertyNameInput(view, property, propertyIndex);
      const nameCell = document.createElement('div');
      nameCell.className = 'cm-hybrid-property-name-cell';
      nameCell.append(createPropertyIcon(property.name), name);

      const value = document.createElement('span');
      value.className = 'cm-hybrid-property-value';
      if (property.table) {
        value.appendChild(renderFrontmatterTable(property.table, view, property));
      } else if (property.chips.length > 0) {
        const display = document.createElement('div');
        display.className = 'cm-hybrid-property-chip-display';
        display.ariaLabel = `${property.name} property display`;
        display.tabIndex = 0;
        for (const [chipIndex, chipValue] of property.chips.entries()) {
          const chip = document.createElement('span');
          chip.className = 'cm-hybrid-property-chip-shell';
          const label = document.createElement('span');
          label.className = 'cm-hybrid-property-chip';
          label.textContent = chipValue;
          const remove = document.createElement('span');
          remove.className = 'cm-hybrid-property-chip-remove';
          remove.setAttribute('role', 'button');
          remove.tabIndex = 0;
          remove.ariaLabel = `Remove ${chipValue} from ${property.name}`;
          remove.textContent = '×';
          const removeChip = (event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            const nextChips = property.chips.filter((_, index) => index !== chipIndex);
            commitPropertyListValue(view, property, nextChips.join(', '), false);
            requestAnimationFrame(() => view.focus());
          };
          remove.addEventListener('mousedown', event => {
            event.preventDefault();
            event.stopPropagation();
          });
          remove.addEventListener('click', removeChip);
          remove.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') removeChip(event);
          });
          chip.append(label, remove);
          display.appendChild(chip);
        }
        value.appendChild(display);
        const input = document.createElement('input');
        input.className = 'cm-hybrid-property-list-input';
        input.type = 'text';
        input.value = property.chips.join(', ');
        input.ariaLabel = `${property.name} property values`;
        input.spellcheck = false;
        input.hidden = true;
        let lastCommittedValue = input.value;
        let skipBlurCommit = false;
        isolateFrontmatterInput(input);

        const hideInput = () => {
          input.hidden = true;
          display.hidden = false;
        };
        const showInput = () => {
          skipBlurCommit = false;
          display.hidden = true;
          input.hidden = false;
          input.focus({ preventScroll: true });
          input.select();
        };
        display.addEventListener('mousedown', event => {
          event.preventDefault();
          event.stopPropagation();
        });
        display.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          showInput();
        });
        display.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          showInput();
        });

        const commitInputValue = () => {
          const nextValue = input.value;
          if (nextValue === lastCommittedValue) return;
          lastCommittedValue = nextValue;
          skipBlurCommit = true;
          commitPropertyListValue(view, property, nextValue);
        };

        input.addEventListener('keydown', event => {
          event.stopPropagation();
          if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            skipBlurCommit = true;
            undoAndRefocus(event, () => {
              undo(view);
              refocusPropertyListInput(view, property.name);
            });
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            skipBlurCommit = true;
            input.value = property.chips.join(', ');
            hideInput();
            input.blur();
            view.focus();
          }
        });
        input.addEventListener('blur', () => {
          if (skipBlurCommit) return;
          commitInputValue();
          hideInput();
        });
        value.appendChild(input);
      } else {
        const display = document.createElement('button');
        display.type = 'button';
        display.className = 'cm-hybrid-property-scalar-display';
        display.textContent = property.value;
        const linkLikeValue = isLinkLikePropertyValue(property.name, property.value);
        const displayControl = linkLikeValue
          ? document.createElement('span')
          : display;
        let edit: HTMLButtonElement | undefined;
        if (linkLikeValue) {
          displayControl.className = 'cm-hybrid-property-scalar-controls';
          display.classList.add('cm-hybrid-property-link');
          display.ariaLabel = `Open ${property.name} property`;
          configureFrontmatterLink(display, property.value, property.value);
          edit = document.createElement('button');
          edit.type = 'button';
          edit.className = 'cm-hybrid-property-edit';
          edit.ariaLabel = `Edit ${property.name} property`;
          edit.textContent = property.value;
          displayControl.append(display, edit);
        } else {
          display.ariaLabel = `${property.name} property display`;
        }
        const input = document.createElement('input');
        input.className = 'cm-hybrid-property-value-input';
        input.type = 'text';
        input.value = property.value;
        input.ariaLabel = `${property.name} property value`;
        input.spellcheck = false;
        input.hidden = true;
        let lastCommittedValue = property.value;
        let skipBlurCommit = false;
        isolateFrontmatterInput(input);

        const hideInput = () => {
          input.hidden = true;
          displayControl.hidden = false;
        };
        const showInput = () => {
          skipBlurCommit = false;
          displayControl.hidden = true;
          input.hidden = false;
          input.focus({ preventScroll: true });
          input.select();
        };
        if (linkLikeValue) {
          edit!.addEventListener('mousedown', stopFrontmatterPointer);
          edit!.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            showInput();
          });
        } else {
          display.addEventListener('mousedown', stopFrontmatterPointer);
          display.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            showInput();
          });
        }

        const commitInputValue = () => {
          const nextValue = input.value;
          if (nextValue === lastCommittedValue) return;
          lastCommittedValue = nextValue;
          skipBlurCommit = true;
          commitPropertyValue(view, property, nextValue);
        };

        input.addEventListener('keydown', event => {
          event.stopPropagation();
          if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            skipBlurCommit = true;
            undoAndRefocus(event, () => {
              undo(view);
              refocusPropertyInput(view, property.name);
            });
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            skipBlurCommit = true;
            input.value = property.value;
            hideInput();
            input.blur();
            view.focus();
          }
        });
        input.addEventListener('blur', () => {
          if (skipBlurCommit) return;
          commitInputValue();
          hideInput();
        });
        value.append(displayControl, input);
      }

      row.append(nameCell, value);
      rows.appendChild(row);
    }

    const addProperty = document.createElement('button');
    addProperty.type = 'button';
    addProperty.className = 'cm-hybrid-property-add';
    addProperty.textContent = '+ Add property';
    addProperty.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    addProperty.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.showNewPropertyRow(rows, addProperty, view);
    });
    rows.appendChild(addProperty);
    wrapper.appendChild(rows);

    heading.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    heading.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      rows.hidden = !rows.hidden;
      heading.setAttribute('aria-expanded', String(!rows.hidden));
      headingChevron.textContent = rows.hidden ? '›' : '⌄';
    });

    wrapper.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.bodyFrom }, scrollIntoView: true });
      view.focus();
    });

    return wrapper;
  }

  private createPropertyNameInput(view: EditorView, property: FrontmatterProperty, propertyIndex: number): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'cm-hybrid-property-name cm-hybrid-property-name-input';
    input.type = 'text';
    input.value = property.name;
    input.ariaLabel = `${property.name} property name`;
    input.spellcheck = false;
    let lastCommittedName = property.name;
    let skipBlurCommit = false;
    isolateFrontmatterInput(input);

    const commitInputValue = () => {
      const nextName = normalizePropertyName(input.value);
      if (nextName.length === 0) {
        input.value = lastCommittedName;
        return;
      }
      if (nextName === lastCommittedName) {
        input.value = nextName;
        return;
      }
      lastCommittedName = nextName;
      skipBlurCommit = true;
      commitPropertyName(view, property, nextName);
    };

    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        skipBlurCommit = true;
        undoAndRefocus(event, () => {
          undo(view);
          refocusPropertyNameInputAtIndex(view, propertyIndex);
        });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        commitInputValue();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        skipBlurCommit = true;
        input.value = property.name;
        input.blur();
        view.focus();
      }
    });
    input.addEventListener('blur', () => {
      if (skipBlurCommit) return;
      commitInputValue();
    });
    return input;
  }

  private showNewPropertyRow(rows: HTMLElement, addProperty: HTMLElement, view: EditorView): void {
    const existing = rows.querySelector<HTMLInputElement>('.cm-hybrid-new-property-name-input');
    if (existing) {
      existing.focus();
      existing.select();
      return;
    }

    const row = document.createElement('div');
    row.className = 'cm-hybrid-property-row cm-hybrid-new-property-row';

    const nameInput = document.createElement('input');
    nameInput.className = 'cm-hybrid-new-property-name-input';
    nameInput.type = 'text';
    nameInput.ariaLabel = 'new property name';
    nameInput.placeholder = 'Property';
    nameInput.spellcheck = false;

    const valueInput = document.createElement('input');
    valueInput.className = 'cm-hybrid-new-property-value-input';
    valueInput.type = 'text';
    valueInput.ariaLabel = 'new property value';
    valueInput.placeholder = 'Value';
    valueInput.spellcheck = false;

    for (const input of [nameInput, valueInput]) {
      isolateFrontmatterInput(input);
    }

    const commitNewProperty = () => {
      const name = normalizePropertyName(nameInput.value);
      if (name.length === 0) {
        nameInput.focus();
        return;
      }
      const serialized = `${name}: ${serializeFrontmatterValue(valueInput.value)}\n`;
      view.dispatch({
        changes: { from: this.insertBefore, to: this.insertBefore, insert: serialized },
      });
      refocusPropertyInput(view, name);
    };

    nameInput.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        valueInput.focus();
        valueInput.select();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        row.remove();
        view.focus();
      }
    });
    valueInput.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commitNewProperty();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        row.remove();
        view.focus();
      }
    });

    row.append(nameInput, valueInput);
    rows.insertBefore(row, addProperty);
    nameInput.focus();
  }

  override eq(other: FrontmatterPropertiesWidget): boolean {
    return this.bodyFrom === other.bodyFrom
      && JSON.stringify(this.properties) === JSON.stringify(other.properties);
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

export function findFrontmatterBlock(doc: Text): FrontmatterBlock | null {
  if (doc.lines < 2 || doc.line(1).text.trim() !== '---') return null;

  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber++) {
    const line = doc.line(lineNumber);
    if (line.text.trim() === '---') {
      return {
        from: doc.line(1).from,
        to: line.to,
        startLine: 1,
        endLine: lineNumber,
        bodyFrom: frontmatterBodyStart(doc, lineNumber),
        insertBefore: line.from,
        properties: parseFrontmatterProperties(doc, 2, lineNumber - 1),
      };
    }
  }

  return null;
}

export function updateFrontmatterBlock(
  current: FrontmatterBlock | null,
  transaction: Transaction,
): FrontmatterBlock | null {
  if (!transaction.docChanged) return current;

  const frontmatterEnd = current?.to ?? 0;
  let touchesFrontmatter = false;
  transaction.changes.iterChangedRanges((from) => {
    if (from <= frontmatterEnd) touchesFrontmatter = true;
  });
  return touchesFrontmatter
    ? findFrontmatterBlock(transaction.newDoc)
    : current;
}

export function initialBodyPositionAfterFrontmatter(text: string): number | null {
  const firstLineEnd = text.indexOf('\n');
  if (firstLineEnd < 0 || text.slice(0, firstLineEnd).trim() !== '---') return null;

  let lineStart = firstLineEnd + 1;
  while (lineStart <= text.length) {
    const lineEnd = text.indexOf('\n', lineStart);
    const end = lineEnd === -1 ? text.length : lineEnd;
    if (text.slice(lineStart, end).trim() === '---') {
      let bodyStart = lineEnd === -1 ? text.length : lineEnd + 1;
      while (bodyStart < text.length) {
        const nextLineEnd = text.indexOf('\n', bodyStart);
        const nextEnd = nextLineEnd === -1 ? text.length : nextLineEnd;
        if (text.slice(bodyStart, nextEnd).trim().length > 0) return bodyStart;
        if (nextLineEnd === -1) return text.length;
        bodyStart = nextLineEnd + 1;
      }
      return bodyStart;
    }
    if (lineEnd === -1) return null;
    lineStart = lineEnd + 1;
  }

  return null;
}

function frontmatterBodyStart(doc: Text, closingLineNumber: number): number {
  for (let lineNumber = closingLineNumber + 1; lineNumber <= doc.lines; lineNumber++) {
    const line = doc.line(lineNumber);
    if (line.text.trim().length > 0) return line.from;
  }
  return doc.line(closingLineNumber).to;
}

function parseFrontmatterProperties(
  doc: Text,
  startLine: number,
  endLine: number,
): FrontmatterProperty[] {
  const yamlProperties = parseYamlFrontmatterProperties(doc, startLine, endLine);
  if (yamlProperties) return yamlProperties;

  const properties: FrontmatterProperty[] = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    const line = doc.line(lineNumber);
    const match = line.text.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const rawValue = match[2] ?? '';
    const value = unquotePropertyValue(rawValue);
    properties.push({
      name: match[1]!,
      value,
      rawValue,
      chips: parseInlineArray(value),
      yamlStyle: parseInlineArray(value).length > 0 ? 'inline-list' : 'scalar',
      lineFrom: line.from,
      lineTo: line.to,
    });
  }
  return properties;
}

function parseYamlFrontmatterProperties(
  doc: Text,
  startLine: number,
  endLine: number,
): FrontmatterProperty[] | null {
  const lines: string[] = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    lines.push(doc.line(lineNumber).text);
  }

  const source = lines.join('\n');
  if (source.trim().length === 0) return [];

  let parsed: ReturnType<typeof parseDocument>;
  try {
    parsed = parseDocument(source, { strict: false, stringKeys: true });
  } catch {
    return null;
  }
  if (parsed.errors.length > 0 || !isMap(parsed.contents)) return null;

  const lineStarts = yamlLineStartOffsets(source);
  const properties: FrontmatterProperty[] = [];
  for (const pair of parsed.contents.items) {
    const key = pair.key;
    if (!key || !isScalar(key) || typeof key.value !== 'string' || !key.range) continue;

    const value = pair.value;
    const valueRange = yamlNodeRange(value);
    const name = key.value;
    const lineFromNumber = yamlOffsetToDocumentLine(source, lineStarts, startLine, key.range[0], false);
    const lineToNumber = yamlOffsetToDocumentLine(
      source,
      lineStarts,
      startLine,
      valueRange?.[2] ?? key.range[2],
      true,
    );
    const lineFrom = doc.line(lineFromNumber).from;
    const lineTo = doc.line(lineToNumber).to;
    const sourceRange = doc.sliceString(lineFrom, lineTo);
    const rawValue = sourceRange.slice(sourceRange.indexOf(':') + 1);
    const chips = yamlSequenceValues(value);
    const table = yamlTableValue(value);
    const firstLineAfterColon = doc.line(lineFromNumber).text.slice(doc.line(lineFromNumber).text.indexOf(':') + 1).trim();
    const yamlStyle = chips.length > 0
      ? (firstLineAfterColon.length === 0 ? 'block-list' : 'inline-list')
      : 'scalar';

    properties.push({
      name,
      value: chips.length > 0 ? chips.join(', ') : table ? '' : yamlScalarValue(value),
      rawValue: yamlStyle === 'block-list' ? rawValue : rawValue.trimStart(),
      chips,
      table,
      yamlStyle,
      lineFrom,
      lineTo,
    });
  }

  return properties;
}

function isolateFrontmatterInput(input: HTMLInputElement): void {
  const stopEditorHandling = (event: Event) => {
    event.stopPropagation();
  };

  for (const eventName of [
    'beforeinput',
    'input',
    'keydown',
    'keyup',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'paste',
    'compositionstart',
    'compositionupdate',
    'compositionend',
  ]) {
    input.addEventListener(eventName, stopEditorHandling);
  }
}

function commitPropertyValue(view: EditorView, property: FrontmatterProperty, nextValue: string): void {
  const serialized = `${property.name}: ${serializeFrontmatterValue(nextValue)}`;
  view.dispatch({
    changes: { from: property.lineFrom, to: property.lineTo, insert: serialized },
  });

  refocusPropertyInput(view, property.name);
}

function commitPropertyName(view: EditorView, property: FrontmatterProperty, nextName: string): void {
  const serialized = property.yamlStyle === 'block-list'
    ? `${nextName}:${property.rawValue}`
    : `${nextName}: ${property.rawValue}`;
  view.dispatch({
    changes: { from: property.lineFrom, to: property.lineTo, insert: serialized },
  });

  refocusPropertyNameInput(view, nextName);
}

function commitPropertyListValue(
  view: EditorView,
  property: FrontmatterProperty,
  nextValue: string,
  refocus = true,
): void {
  const serialized = property.yamlStyle === 'block-list'
    ? `${property.name}:${serializeFrontmatterBlockArray(nextValue)}`
    : `${property.name}: ${serializeFrontmatterArray(nextValue)}`;
  view.dispatch({
    changes: { from: property.lineFrom, to: property.lineTo, insert: serialized },
  });

  if (refocus) refocusPropertyListInput(view, property.name);
}

function createPropertyIcon(propertyName: string): HTMLSpanElement {
  const icon = document.createElement('span');
  icon.className = 'cm-hybrid-property-icon';
  icon.setAttribute('aria-hidden', 'true');
  const normalized = propertyName.trim().toLowerCase();
  const kind = normalized === 'tags' || normalized === 'tag'
    ? 'tags'
    : normalized === 'aliases' || normalized === 'alias'
      ? 'aliases'
      : 'property';
  icon.dataset.propertyIcon = kind;
  icon.innerHTML = kind === 'tags'
    ? '<svg viewBox="0 0 24 24"><path d="M20 13 13 20 4 11V4h7l9 9Z"/><circle cx="8.5" cy="8.5" r="1.25"/></svg>'
    : kind === 'aliases'
      ? '<svg viewBox="0 0 24 24"><path d="M4 12h14M13 7l5 5-5 5"/></svg>'
      : '<svg viewBox="0 0 24 24"><circle cx="7" cy="7" r="1"/><circle cx="7" cy="12" r="1"/><circle cx="7" cy="17" r="1"/><path d="M11 7h8M11 12h8M11 17h8"/></svg>';
  return icon;
}

function refocusPropertyInput(view: EditorView, propertyName: string): void {
  scheduleFrontmatterInputFocus(() => {
    const selector = `.cm-hybrid-property-value-input[aria-label="${cssEscape(`${propertyName} property value`)}"]`;
    return revealFrontmatterValueInput(view.dom.querySelector<HTMLInputElement>(selector));
  });
}

function refocusPropertyNameInput(view: EditorView, propertyName: string): void {
  scheduleFrontmatterInputFocus(() => {
    const selector = `.cm-hybrid-property-name-input[aria-label="${cssEscape(`${propertyName} property name`)}"]`;
    return view.dom.querySelector<HTMLInputElement>(selector);
  });
}

function refocusPropertyNameInputAtIndex(view: EditorView, propertyIndex: number): void {
  scheduleFrontmatterInputFocus(() =>
    view.dom.querySelectorAll<HTMLInputElement>('.cm-hybrid-property-name-input')[propertyIndex] ?? null,
  );
}

function refocusPropertyListInput(view: EditorView, propertyName: string): void {
  scheduleFrontmatterInputFocus(() => {
    const selector = `.cm-hybrid-property-list-input[aria-label="${cssEscape(`${propertyName} property values`)}"]`;
    return revealFrontmatterValueInput(view.dom.querySelector<HTMLInputElement>(selector));
  });
}

function revealFrontmatterValueInput(input: HTMLInputElement | null): HTMLInputElement | null {
  if (!input) return null;
  const display = input.parentElement?.querySelector<HTMLElement>(
    '.cm-hybrid-property-chip-display, .cm-hybrid-property-scalar-display',
  );
  if (display) display.hidden = true;
  input.hidden = false;
  return input;
}

function yamlLineStartOffsets(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function yamlOffsetToDocumentLine(
  source: string,
  lineStarts: number[],
  startLine: number,
  offset: number | undefined,
  biasPreviousLine: boolean,
): number {
  let target = Math.max(0, Math.min(offset ?? 0, source.length));
  if (biasPreviousLine && target > 0 && source[target - 1] === '\n') target -= 1;

  let lineIndex = 0;
  for (let index = 0; index < lineStarts.length; index++) {
    if (lineStarts[index]! <= target) lineIndex = index;
    else break;
  }
  return startLine + lineIndex;
}

function yamlSequenceValues(value: unknown): string[] {
  if (!isSeq(value)) return [];
  return value.items
    .map(item => isScalar(item) && item.value != null ? item.toString() : '')
    .filter(Boolean);
}

function yamlTableValue(value: unknown): FrontmatterTable | undefined {
  if (isMap(value)) {
    const entries = yamlMapEntries(value);
    if (entries.length === 0 || !entries.every(entry => isScalar(entry.value))) return undefined;
    return {
      columns: entries.map(entry => entry.key),
      rows: [entries.map(entry => yamlCellValue(entry.value))],
      paths: [entries.map(entry => [entry.key])],
    };
  }

  if (!isSeq(value) || value.items.length === 0 || !value.items.every(isMap)) return undefined;
  const rows = value.items.map(item => yamlMapEntries(item));
  const columns = [...new Set(rows.flatMap(row => row.map(entry => entry.key)))];
  if (columns.length === 0) return undefined;
  return {
    columns,
    rows: rows.map(row => {
      const values = new Map(row.map(entry => [entry.key, yamlCellValue(entry.value)]));
      return columns.map(column => values.get(column) ?? '');
    }),
    paths: rows.map((_row, rowIndex) =>
      columns.map(column => [rowIndex, column]),
    ),
  };
}

function yamlMapEntries(value: unknown): Array<{ key: string; value: unknown }> {
  if (!isMap(value)) return [];
  return value.items.flatMap(pair => {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string') return [];
    return [{ key: pair.key.value, value: pair.value }];
  });
}

function yamlCellValue(value: unknown): string {
  if (isScalar(value)) return value.value == null ? '' : value.toString();
  if (isSeq(value)) return value.items.map(yamlCellValue).filter(Boolean).join(', ');
  if (isMap(value)) {
    return yamlMapEntries(value)
      .map(entry => `${entry.key}: ${yamlCellValue(entry.value)}`)
      .join(', ');
  }
  return '';
}

function yamlScalarValue(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  if (isScalar(value)) return value.value == null ? '' : value.toString();
  if (isMap(value) || isSeq(value)) return value.toString();
  return '';
}

function yamlNodeRange(value: unknown): [number, number, number] | undefined {
  if (!value || typeof value !== 'object' || !('range' in value)) return undefined;
  const range = (value as { range?: unknown }).range;
  if (
    Array.isArray(range)
    && typeof range[0] === 'number'
    && typeof range[1] === 'number'
    && typeof range[2] === 'number'
  ) {
    return [range[0], range[1], range[2]];
  }
  return undefined;
}

function parseInlineArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  return trimmed
    .slice(1, -1)
    .split(',')
    .map(item => unquotePropertyValue(item.trim()))
    .filter(Boolean);
}

function renderFrontmatterTable(
  table: FrontmatterTable,
  view: EditorView,
  property: FrontmatterProperty,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'cm-hybrid-property-structured-table-wrap';
  const element = document.createElement('table');
  element.className = 'cm-hybrid-property-structured-table';
  element.ariaLabel = 'Structured property value';

  const head = document.createElement('thead');
  const headingRow = document.createElement('tr');
  for (const column of table.columns) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = column;
    cell.dataset.column = column;
    headingRow.appendChild(cell);
  }
  head.appendChild(headingRow);
  element.appendChild(head);

  const body = document.createElement('tbody');
  for (const [rowIndex, row] of table.rows.entries()) {
    const rowElement = document.createElement('tr');
    for (const [columnIndex, cellValue] of row.entries()) {
      const cell = document.createElement('td');
      const column = table.columns[columnIndex];
      if (column) cell.dataset.column = column;
      const path = table.paths[rowIndex]?.[columnIndex];
      if (!path) {
        cell.textContent = cellValue;
        rowElement.appendChild(cell);
        continue;
      }
      const display = document.createElement('button');
      display.type = 'button';
      display.className = 'cm-hybrid-property-structured-cell';
      const cellLabel = structuredCellLabel(property.name, path);
      display.textContent = cellValue;
      if (isStructuredResourceLink(property.name, path, cellValue)) {
        const controls = document.createElement('span');
        controls.className = 'cm-hybrid-property-structured-cell-controls';
        display.classList.add('cm-hybrid-property-link');
        display.ariaLabel = `Open ${cellLabel}`;
        configureFrontmatterLink(display, cellValue, cellValue);
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'cm-hybrid-property-structured-cell-edit cm-hybrid-property-edit';
        edit.ariaLabel = `Edit ${cellLabel}`;
        edit.textContent = cellValue;
        edit.addEventListener('mousedown', stopFrontmatterPointer);
        edit.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          showStructuredCellInput(view, property, path, display, controls);
        });
        controls.append(display, edit);
        cell.appendChild(controls);
      } else {
        display.ariaLabel = `Edit ${cellLabel}`;
        display.addEventListener('mousedown', stopFrontmatterPointer);
        display.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          showStructuredCellInput(view, property, path, display);
        });
        cell.appendChild(display);
      }
      rowElement.appendChild(cell);
    }
    body.appendChild(rowElement);
  }
  element.appendChild(body);
  wrapper.appendChild(element);
  return wrapper;
}

function showStructuredCellInput(
  view: EditorView,
  property: FrontmatterProperty,
  path: Array<string | number>,
  display: HTMLButtonElement,
  displayControl: HTMLElement = display,
): void {
  const input = document.createElement('input');
  input.className = 'cm-hybrid-property-structured-cell-input';
  input.type = 'text';
  input.value = display.textContent ?? '';
  input.ariaLabel = structuredCellLabel(property.name, path);
  input.spellcheck = false;
  isolateFrontmatterInput(input);
  const inputHost = displayControl.parentElement ?? display.parentElement;
  displayControl.hidden = true;
  inputHost?.appendChild(input);
  input.focus({ preventScroll: true });
  input.select();

  let committed = false;
  const finish = (commit: boolean) => {
    if (committed) return;
    committed = true;
    if (commit && input.value !== display.textContent) {
      commitStructuredPropertyCell(view, property, path, input.value);
      return;
    }
    input.remove();
    displayControl.hidden = false;
    view.focus();
  };
  input.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

function commitStructuredPropertyCell(
  view: EditorView,
  property: FrontmatterProperty,
  path: Array<string | number>,
  nextValue: string,
): void {
  let parsed: unknown;
  try {
    parsed = parseYamlValue(property.rawValue.trim());
  } catch {
    return;
  }
  if (parsed === null || typeof parsed !== 'object') return;
  let target: unknown = parsed;
  for (let index = 0; index < path.length - 1; index++) {
    const segment = path[index]!;
    if (typeof target !== 'object' || target === null || !(segment in target)) return;
    target = (target as Record<string | number, unknown>)[segment];
  }
  const finalSegment = path.at(-1);
  if (finalSegment === undefined || typeof target !== 'object' || target === null) return;
  (target as Record<string | number, unknown>)[finalSegment] = nextValue;

  const serialized = serializeStructuredPropertyValue(property.name, parsed);
  view.dispatch({
    changes: { from: property.lineFrom, to: property.lineTo, insert: serialized },
  });
  scheduleFrontmatterInputFocus(() =>
      view.dom.querySelector<HTMLInputElement>(
      `.cm-hybrid-property-structured-cell-input[aria-label="${cssEscape(structuredCellLabel(property.name, path))}"]`,
    ),
  );
}

function structuredCellLabel(propertyName: string, path: Array<string | number>): string {
  return `${propertyName}${typeof path[0] === 'number' ? `[${path[0]}]` : `.${String(path[0] ?? 'value')}`}${
    typeof path[0] === 'number' && typeof path[1] === 'string' ? `.${path[1]}` : ''
  }`;
}

function isStructuredResourceLink(
  propertyName: string,
  path: Array<string | number>,
  value: string,
): boolean {
  return propertyName.trim().toLowerCase() === 'sources'
    && String(path.at(-1) ?? '').trim().toLowerCase() === 'resource'
    && value.trim().length > 0;
}

function isLinkLikePropertyValue(propertyName: string, value: string): boolean {
  if (!value.trim()) return false;
  const name = propertyName.trim().toLowerCase();
  if (['resource', 'source', 'url', 'uri', 'href', 'link'].includes(name)) return true;
  return /^(?:https?:|mailto:|llm-wiki:)/i.test(value)
    || /(?:^|[/\\])[^/\\]+\.(?:md|markdown|txt|text|pdf)(?:[?#].*)?$/i.test(value);
}

function configureFrontmatterLink(
  button: HTMLButtonElement,
  uri: string,
  label: string,
): void {
  button.dataset.linkPreviewTarget = uri;
  button.dataset.linkPreviewLabel = label;
  if (isDocumentRelativeUri(uri)) {
    button.dataset.linkPreviewRelativeToDocument = 'true';
  }
  button.addEventListener('mousedown', stopFrontmatterPointer);
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    button.dispatchEvent(new CustomEvent('llm-wiki-open-uri', {
      bubbles: true,
      detail: {
        uri,
        ...(isDocumentRelativeUri(uri) ? { relativeToDocument: true } : {}),
      },
    }));
  });
}

function isDocumentRelativeUri(uri: string): boolean {
  return Boolean(uri)
    && !uri.startsWith('#')
    && !uri.startsWith('/')
    && !/^[a-z][a-z0-9+.-]*:/i.test(uri);
}

function stopFrontmatterPointer(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

function serializeStructuredPropertyValue(name: string, value: unknown): string {
  // JSON is a valid YAML flow value and keeps a structured property as one
  // atom, so the next parse can recover the same cell paths regardless of the
  // original inline or block formatting.
  return `${name}: ${JSON.stringify(value)}`;
}

function unquotePropertyValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function serializeFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '""';
  if (/[:#\n\r]/.test(trimmed)) {
    return JSON.stringify(trimmed);
  }
  return trimmed;
}

function serializeFrontmatterArray(value: string): string {
  const items = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return `[${items.map(serializeFrontmatterArrayItem).join(', ')}]`;
}

function serializeFrontmatterBlockArray(value: string): string {
  const items = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return items.length === 0
    ? ' []'
    : `\n${items.map(item => `  - ${serializeFrontmatterBlockArrayItem(item)}`).join('\n')}`;
}

function serializeFrontmatterArrayItem(value: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function serializeFrontmatterBlockArrayItem(value: string): string {
  if (/[:#\n\r]/.test(value) || value.trim() !== value || value.length === 0) {
    return JSON.stringify(value);
  }
  return value;
}

function normalizePropertyName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '');
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape?.(value) ?? value.replace(/["\\]/g, '\\$&');
}

let frontmatterFocusLease = 0;

function scheduleFrontmatterInputFocus(findInput: () => HTMLInputElement | null): void {
  const lease = ++frontmatterFocusLease;
  const expiresAt = performance.now() + 1_000;
  let selected = false;
  let trackedInput: HTMLInputElement | null = null;
  let cleanedUp = false;

  const isActiveLease = () => lease === frontmatterFocusLease && performance.now() <= expiresAt;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    document.removeEventListener('focusin', refocusAfterEditorFocus, true);
    document.removeEventListener('pointerdown', cancelOnPointerDown, true);
  };

  const focus = () => {
    if (!isActiveLease()) {
      cleanup();
      return;
    }
    const input = findInput();
    if (!input) return;
    if (trackedInput !== input) {
      trackedInput = input;
      input.addEventListener('blur', refocusAfterBlur, { once: true });
    }
    if (document.activeElement !== input) {
      input.focus({ preventScroll: true });
    }
    if (!selected && document.activeElement === input) {
      input.select();
      selected = true;
    }
  };
  const refocusAfterBlur = () => {
    if (!isActiveLease()) return;
    focus();
    queueMicrotask(focus);
    requestAnimationFrame(focus);
  };
  const refocusAfterEditorFocus = (event: FocusEvent) => {
    if (!isActiveLease()) return;
    const input = findInput();
    const target = event.target;
    if (!input || target === input) return;
    if (target instanceof Element && target.closest('.cm-hybrid-properties input')) return;
    focus();
    queueMicrotask(focus);
  };
  const cancelOnPointerDown = (event: PointerEvent) => {
    const input = findInput();
    const target = event.target;
    if (!input || !(target instanceof Node) || input.contains(target)) return;
    frontmatterFocusLease += 1;
    cleanup();
  };

  document.addEventListener('focusin', refocusAfterEditorFocus, true);
  document.addEventListener('pointerdown', cancelOnPointerDown, true);
  focus();
  queueMicrotask(focus);
  requestAnimationFrame(focus);
  for (const delay of [0, 25, 75, 150, 300, 500, 750]) {
    window.setTimeout(focus, delay);
  }
  window.setTimeout(cleanup, 1_100);
}

function undoAndRefocus(event: KeyboardEvent, run: () => void): void {
  const modifierKey = event.metaKey ? 'Meta' : event.ctrlKey ? 'Control' : null;
  if (!modifierKey) {
    window.setTimeout(run, 0);
    return;
  }

  runAfterKeyRelease([modifierKey, ...(modifierKey === 'Meta' ? ['OS'] : [])], run);
}

function runAfterKeyRelease(releaseKeys: string[], run: () => void): void {
  let didRun = false;
  const flush = () => {
    if (didRun) return;
    didRun = true;
    window.removeEventListener('keyup', handleKeyUp, true);
    run();
  };
  const handleKeyUp = (keyUpEvent: KeyboardEvent) => {
    if (releaseKeys.includes(keyUpEvent.key)) {
      flush();
    }
  };

  window.addEventListener('keyup', handleKeyUp, true);
  window.setTimeout(flush, 250);
}
