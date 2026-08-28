---
name: grounded-citations
description: Research, fact-check, and write claim-level citations that directly support source-backed answers, reports, and LLM Wiki pages. Use when claims need sources, existing citations need verification, evidence conflicts, or provenance must be preserved. Do not add decorative citations, cite search-result pages, or present inference as a source's conclusion.
license: MIT
metadata:
  version: "1.1.0"
  tags: [research, citations, grounding, sources, fact-checking]
  source: https://github.com/NousResearch/hermes-agent/tree/main/skills/research/grounded-citations
---

# Grounded citations

A citation is useful only when the cited source supports the adjacent claim.
Build the answer from verified evidence instead of drafting first and attaching
plausible-looking references afterward.

## Research workflow

1. Break the requested answer into independently checkable claims. Mark which
   claims are factual, interpretive, methodological, or recommendations.
2. Search for the strongest available source for each load-bearing factual
   claim. Prefer primary papers, official specifications, authoritative
   datasets, repository content at an immutable revision, and first-party
   documentation over summaries and commentary.
3. Open and read the relevant source passage. Search snippets and result pages
   are discovery aids, not evidence.
4. Record the source identity, exact version or date, relevant location, and the
   claim it supports. For code, record repository, immutable revision, path,
   symbol when meaningful, and verified content hash.
5. Compare sources when results depend on definitions, populations, versions,
   or experimental conditions. Preserve unresolved contradictions instead of
   averaging them into certainty.
6. Write the claim at the strength the evidence permits. Label synthesis and
   inference explicitly.
7. Place the citation immediately after the supported sentence or paragraph,
   then perform a final claim-to-source audit.

## Source selection

Use this preference order unless the question requires another perspective:

1. Primary research, official standards, laws, specifications, datasets, and
   repository evidence.
2. Authoritative first-party documentation and institutional reports.
3. High-quality reviews or systematic syntheses that expose their method.
4. Reputable secondary reporting for context or contemporary reactions.
5. Community discussion only for clearly attributed experience or opinion.

Generated documentation proves what that document says, not the behavior of
the underlying system. Claims about behavior also require code, tests,
configuration, protocols, measurements, or another primary source.

## Writing and citation rules

- Cite claims, not topic areas. One source may support only part of a sentence.
- Preserve source qualifications, scope, uncertainty, and negative or null
  results. Do not strengthen correlation into causation.
- Use an exact paper version, specification edition, release, revision, or
  access date when changes could alter the claim.
- Prefer a canonical landing page or DOI over a search-result URL. Link to the
  page that contains the evidence.
- Quote only when exact wording matters; otherwise paraphrase faithfully. Keep
  quotations short and obey license and copyright constraints.
- Never fabricate a citation, identifier, page, quotation, source field, or
  retrieval result. State when adequate support could not be found.
- Do not pad an answer with multiple sources that merely repeat one another.
  Add sources when they contribute independent evidence or a relevant contrast.

## LLM Wiki representation

Follow the nearest vault schema. A typical source declaration and footnote use
stable matching IDs:

```yaml
sources: [{"id": "source-paper-v2", "resource": "https://arxiv.org/abs/2401.01234v2", "title": "Exact paper title"}]
```

```markdown
The directly supported claim appears here.[^source-paper-v2]

[^source-paper-v2]: Exact section, page, table, figure, passage, or revision
    that supports the claim, including relevant limits.
```

Use source anchors required by Query pages for viewer selections. Keep body
links for navigation and `relations[]` for knowledge-graph edges; neither is a
substitute for provenance. If evidence conflicts, keep the page draft and use
the schema's conflict record plus explanatory prose.

## Final audit

Before publishing, verify that every load-bearing factual claim has direct
support, every citation resolves, source metadata matches the opened source,
versions are explicit where needed, quotations are exact, inferences are
labeled, and limitations or contradictions remain visible.

## Attribution

Adapted from the NousResearch grounded-citations skill, MIT licensed. This
version is rewritten for framework-neutral repository and knowledge-vault
workflows.
