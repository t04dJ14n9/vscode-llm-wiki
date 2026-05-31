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
export { parseHlUri, formatHlUri, normalizeUri } from './links/uri-parser';
export type { HlUri } from './links/uri-parser';
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
