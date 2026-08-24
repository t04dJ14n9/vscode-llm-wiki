---
name: arxiv
description: Discover, inspect, and version-pin arXiv papers for research or source-backed knowledge work. Use when searching arXiv by topic, author, category, title, or identifier; selecting primary papers; checking versions or withdrawal status; or ingesting eligible papers into an LLM Wiki. Do not treat search rank as evidence or copy a paper into a vault without checking its license.
license: MIT
metadata:
  version: "1.0.0"
  tags: [research, arxiv, papers, academic, provenance]
  source: https://github.com/NousResearch/hermes-agent/tree/main/skills/research/arxiv
---

# arXiv research

Use arXiv for discovery and primary-paper retrieval. Separate finding a paper
from establishing what it supports.

## Discovery workflow

1. Turn the question into two or three searches using titles, authors, phrases,
   categories, and common terminology variants.
2. Search the official arXiv API or website. Prefer narrow queries first, then
   broaden deliberately. Respect arXiv's published API rate limits.
3. Inspect promising abstracts, submission history, categories, author list,
   comments, DOI or journal reference, and withdrawal or replacement notices.
4. Open the paper itself before using it as evidence. Use the PDF skill when a
   figure, table, equation, page region, or layout is load-bearing.
5. Record the exact versioned identifier, such as `2401.01234v2`. An
   unversioned identifier is acceptable for discovery, not for a durable claim
   whose supporting text may change between versions.
6. Search within the selected paper for the actual claim. Report whether the
   support is direct, limited, contradictory, or only an inference.

Official entry points:

- Abstract and version history: `https://arxiv.org/abs/<versioned-id>`
- PDF: `https://arxiv.org/pdf/<versioned-id>`
- Export API: `https://export.arxiv.org/api/query?...`

Useful API fields include `search_query`, `id_list`, `start`, `max_results`,
`sortBy`, and `sortOrder`. Combine fielded terms such as `ti:`, `au:`, `abs:`,
`cat:`, and `all:` with `AND`, `OR`, and `ANDNOT`. Encode query parameters
properly rather than constructing ambiguous URLs.

## Evidence and vault rules

- Prefer the paper over blogs, generated summaries, search snippets, or citation
  counts. Use secondary sources to discover terminology or disagreements.
- Do not invent authors, dates, titles, identifiers, versions, venues, DOIs, or
  quotations. If metadata cannot be confirmed, say so.
- Check whether a later version changes the relevant result. Preserve the
  studied version even when noting that a newer version exists.
- A citation supports only the claim actually present in the cited passage.
  Distinguish the authors' result from your inference.
- Before archiving full text or a PDF, check the paper's explicit license. A
  public arXiv page does not by itself grant redistribution rights.
- When `tools/llm-wiki/ingest_arxiv.py` is available, use it only with an exact
  versioned identifier and a license accepted by that producer. Otherwise cite
  the canonical versioned URL without copying the paper.
- Store immutable textual evidence in `raw/`, eligible binary papers in
  `assets/`, and synthesis in the applicable `wiki/` page. Preserve hashes and
  source identifiers required by the vault schema.

## Result format

Return a short, ranked set of papers when discovery is the goal. For each one,
include the title, versioned arXiv ID, authors, date, why it is relevant, and a
canonical link. For evidence work, add the precise section/page or passage and
state any limitation, disagreement, or newer-version risk.

## Attribution

Adapted from the NousResearch arXiv research skill, MIT licensed. This version
is rewritten for framework-neutral repository and knowledge-vault workflows.
