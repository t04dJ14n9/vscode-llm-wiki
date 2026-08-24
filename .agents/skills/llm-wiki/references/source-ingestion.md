# Source ingestion

Stage unprocessed repository documentation in the project code-vault inbox.
Preserve papers and other higher-level textual evidence as flat immutable
Markdown in outer `raw/`; preserve their PDFs and other binaries in outer
`assets/` through Git LFS. Reserve project `raw/` and `assets/` for immutable
repository-specific evidence. Record origin, version/time, media type, byte
count, SHA-256, lossiness, and attachment role `original` or `derived`.

Paper ingesters default to the outer vault; use an explicit project only for
repository-specific evidence. Never overwrite an existing snapshot. A
collision receives the deterministic digest suffix. Keep synthesis out of raw
companions.
