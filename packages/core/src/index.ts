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
export type { ReferenceTarget, ReferenceKind } from './links/reference-target';
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
export { upsertWebTarget, resolveWebTarget } from './web/targets';
export type { WebTargetRecord, UpsertWebTargetInput } from './web/targets';

// Activity
export { recordActivity } from './activity/record';
export type { ActivityEvent } from './activity/record';

// Review / Spaced Repetition
export {
  createLearningObject,
  getLearningObject,
  listLearningObjects,
  updateLearningObject,
  suspendLearningObject,
  retireLearningObject,
} from './review/cards';
export type { LearningObjectRecord, CreateLearningObjectInput } from './review/cards';
export { computeNextReview, getDueCards, getLastReview } from './review/scheduler';
export type { Sm2State, ScheduleResult, ReviewHistoryRow } from './review/scheduler';
export { recordReview, getReviewHistory } from './review/session';
export type { RecordReviewInput, ReviewHistoryRecord } from './review/session';
