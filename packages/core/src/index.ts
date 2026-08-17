export {
  classifyReferenceTarget,
  pdfHref,
} from './links/reference-target';
export type {
  PdfTextFragment,
  PdfViewRect,
  ReferenceKind,
  ReferenceTarget,
} from './links/reference-target';

export type {
  PdfDiscussionAnchorV1,
  PdfDiscussionAnnotationV1,
  PdfDiscussionDocumentV1,
  PdfDiscussionLastTurnV1,
  PdfDiscussionMessageV1,
  PdfDiscussionPromotionAttemptV1,
  PdfDiscussionPromotionV1,
  PdfDiscussionRectV1,
  PdfDiscussionSnapshotV1,
} from './pdf-discussions/schema';
export {
  PdfDiscussionAnnotationV1Schema,
  PdfDiscussionDocumentV1Schema,
} from './pdf-discussions/schema';

export {
  computePdfSha256,
  createPdfDiscussionSelectionKey,
  ConflictingPdfDiscussionWriteError,
  importGlobalPdfDiscussions,
  InvalidPdfDiscussionSidecarError,
  InvalidPdfDiscussionSnapshotError,
  PDF_DISCUSSION_SNAPSHOT_MAX_BYTES,
  PdfDiscussionLockError,
  PdfDiscussionStore,
} from './pdf-discussions/store';
export type {
  PdfDiscussionImportResult,
  PdfDiscussionLayout,
  PdfDiscussionSelectionKeyInput,
  PdfDiscussionSnapshotCapture,
  PdfDiscussionStoreOptions,
  PdfDiscussionUpdate,
  PdfPathLike,
} from './pdf-discussions/store';

export {
  LLM_WIKI_CONTEXT,
  PDF_FRAGMENT_CONFORMS_TO,
  scanPortablePdfAnnotations,
  toPortablePdfAnnotation,
} from './pdf-discussions/portable';
export type {
  PortablePdfAnnotation,
  PortablePdfAnnotationInput,
  ScannedPortablePdfAnnotation,
} from './pdf-discussions/portable';
