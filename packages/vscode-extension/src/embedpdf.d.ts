declare module '@embedpdf/engines/pdfium-direct-engine' {
  export function createPdfiumEngine(wasmUrl: string, options?: Record<string, unknown>): Promise<any>;
}
