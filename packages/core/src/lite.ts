// Filesystem-only surface used by the desktop extension. Keep this entry free
// of database, search, embedding, activity, and review imports.
export {
  classifyReferenceTarget,
  pdfHref,
} from './links/reference-target';
export type {
  PdfTextFragment,
  ReferenceTarget,
} from './links/reference-target';

export type {
  PdfDiscussionAnchorV1,
  PdfDiscussionAnnotationV1,
  PdfDiscussionDocumentV1,
  PdfDiscussionMessageV1,
  PdfDiscussionPromotionAttemptV1,
  PdfDiscussionSnapshotV1,
} from './pdf-discussions/schema';

export {
  createPdfDiscussionSelectionKey,
  importGlobalPdfDiscussions,
  PdfDiscussionStore,
} from './pdf-discussions/store';
export type {
  PdfDiscussionImportResult,
  PdfDiscussionSnapshotCapture,
} from './pdf-discussions/store';
export {
  HUMAN_LEARNING_CONTEXT,
  PDF_FRAGMENT_CONFORMS_TO,
  scanPortablePdfAnnotations,
  toPortablePdfAnnotation,
} from './pdf-discussions/portable';
export type {
  PortablePdfAnnotation,
  PortablePdfAnnotationInput,
  ScannedPortablePdfAnnotation,
} from './pdf-discussions/portable';
