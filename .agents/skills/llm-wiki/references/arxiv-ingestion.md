# arXiv Ingestion

Use this reference when archiving an arXiv paper as raw Markdown plus a local
PDF.

## Before download

1. Require an exact version such as `1508.07909v5`.
2. Read the canonical arXiv record.
3. Confirm the requested version appears in its submission history.
4. Confirm the exact record grants a redistribution license accepted by the
   vault. Do not infer permission from another version or from public access.
5. Search `raw/` for the arXiv ID and canonical title.

## Capture

Use the repository's ingester. It should:

- fetch exact-version metadata and PDF;
- derive both filenames from the canonical title;
- stage work in a temporary directory;
- verify the payload is a PDF;
- extract text mechanically;
- calculate Markdown-body and PDF SHA-256 hashes;
- record PDF byte size and extraction-tool version;
- publish the Markdown/PDF pair atomically; and
- refuse to overwrite a different existing snapshot.

Example:

```bash
python3 tools/okf/ingest_arxiv.py \
  --vault . \
  --id 1508.07909v5
```

An identical re-ingest may report `unchanged`. Different bytes for the same
version are an integrity failure, not an update.

## Companion boundary

The companion contains source metadata, abstract, local PDF link, extraction
notice, and mechanically extracted full text. It does not contain an agent
summary, conclusions, or reconciled claims.

Compile durable interpretation into `summaries/`, `entities/`, `concepts/`,
`comparisons/`, or `queries/` and cite the raw companion.

## Finish

Rebuild indexes, validate hashes and links, confirm the PDF is tracked by Git
LFS while `raw/assets/index.md` is not, inspect the diff, and record a
newest-first ingest entry in `log.md`.
