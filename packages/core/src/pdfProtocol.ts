export type PdfWebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'pdfToolbarPreferenceChanged'; preference: unknown }
  | { type: 'selectionAction'; action: unknown; anchor: unknown }
  | { type: 'copyText'; text: unknown }
  | { type: 'copySelectionForAgent' }
  | { type: 'lookupSelection'; text: unknown }
  | { type: 'copyPageLink'; page: unknown }
  | { type: 'selectionChanged'; anchor?: unknown; clipboardSelection?: unknown }
  | { type: 'openQuery'; navigation: unknown }
  | { type: 'pdfOutline'; items: unknown; inferred?: unknown; loading?: unknown }
  | { type: 'pageChanged'; page: unknown; totalPages: unknown }
  | { type: 'error'; message: unknown };

const pdfWebviewMessageTypes = new Set<PdfWebviewToHostMessage['type']>([
  'ready',
  'pdfToolbarPreferenceChanged',
  'selectionAction',
  'copyText',
  'copySelectionForAgent',
  'lookupSelection',
  'copyPageLink',
  'selectionChanged',
  'openQuery',
  'pdfOutline',
  'pageChanged',
  'error',
]);

export function pdfWebviewToHostMessage(value: unknown): PdfWebviewToHostMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !pdfWebviewMessageTypes.has(type as PdfWebviewToHostMessage['type'])) {
    return undefined;
  }
  return value as PdfWebviewToHostMessage;
}
