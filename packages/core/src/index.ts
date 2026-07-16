export { openDatabase, runMigrations, closeDatabase } from './db/connection';
export { SCHEMA_VERSION, MIGRATIONS } from './db/schema';
export {
  detectVaultRoot,
  isVaultRoot,
  initVault,
  readConfig,
  writeConfig,
  HlConfigSchema,
  DEFAULT_VAULT_LAYOUT,
} from './workspace';
export type { HlConfig } from './workspace';

// Sources
export { registerSource, getSource, listSources } from './sources/registry';
export type { SourceRecord } from './sources/registry';
export { ingestFile, chunkMarkdown, chunkCode, chunkPdfText, getChunks } from './sources/chunks';
export type { ChunkRecord } from './sources/chunks';
export { extractPdfText, extractPdfFullText } from './sources/pdf-extract';
export type { PdfPageText } from './sources/pdf-extract';

// Links
export {
  classifyReferenceTarget,
  noteHref,
  pdfHref,
  codeHref,
  normalizeRelativePath,
} from './links/reference-target';
export type { ReferenceTarget, ReferenceKind, PdfTextFragment } from './links/reference-target';
export { parseMarkdownLinks, hasLinks } from './links/link-parser';
export type { ParsedLink } from './links/link-parser';
export {
  rebuildLinksForNote, rebuildAllLinks,
  getBacklinks, getForwardLinks,
  checkLinks, safeRepairLinks,
} from './links/graph';
export type { LinkRecord } from './links/graph';

// Search
export { searchLexical, searchNotes } from './search/search';
export type { SearchResult, SearchMode } from './search/search';

// Embeddings
export {
  LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_DIMENSIONS,
  embedText,
  refreshEmbeddings,
  getEmbeddingStatus,
} from './embeddings/local';
export type { EmbeddingRefreshResult, EmbeddingStatus } from './embeddings/local';
export { searchSemantic, searchHybrid } from './search/search';

// Anchors
export {
  createPdfAnchorFromQuote,
  createPdfAnchorFromSelection,
  resolveAnchor,
} from './anchors/pdf';
export type { AnchorRecord, CreatePdfAnchorOptions } from './anchors/pdf';
export {
  readAnchorsFile,
  appendAnchorToFile,
  anchorsFromJsonl,
  writeAnchorsFile,
} from './anchors/store';

// Agent context
export { exportSourceContext } from './context/export';
export type { ExportContextOptions, ExportedContext } from './context/export';
export { generateAgentInstructions } from './context/agent-files';

// Web targets
export {
  upsertWebTarget,
  resolveWebTarget,
  persistWebPageSnapshot,
  webTargetHref,
} from './web/targets';
export type {
  WebTargetRecord,
  UpsertWebTargetInput,
  PersistWebPageSnapshotInput,
  PersistWebPageSnapshotResult,
  WebAnchorRecord,
} from './web/targets';

// PDF discussions
export {
  PdfDiscussionAnnotationV1Schema,
  PdfDiscussionDocumentV1Schema,
} from './pdf-discussions/schema';
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
  PdfDiscussionStoreOptions,
  PdfDiscussionUpdate,
  PdfPathLike,
} from './pdf-discussions/store';
