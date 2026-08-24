---
name: research-paper-writing
description: Plan, draft, revise, and prepare an evidence-backed academic research paper, especially in computer science and machine learning. Use for contribution framing, literature review, experiment design, result analysis, paper structure, rebuttals, or submission checks. Do not fabricate experiments, results, statistics, citations, authorship, or approvals, and do not submit work without explicit authorization.
license: MIT
metadata:
  version: "1.1.0"
  tags: [research, paper-writing, experiments, academic, latex]
  source: https://github.com/NousResearch/hermes-agent/tree/main/skills/research/research-paper-writing
---

# Research paper writing

Treat a paper as a chain of claims supported by literature, methods,
experiments, and analysis. Clear prose cannot repair missing evidence.

## Establish the research contract

Before drafting, identify:

- the one-sentence contribution and the problem it addresses;
- the intended audience or venue and its current format, page, anonymity,
  ethics, artifact, and disclosure requirements;
- the evidence already available and what remains proposed or unverified;
- the responsible human decisions about authorship, compute, data access,
  research ethics, release, and submission;
- the files and repository state that are authoritative for results.

Never infer that an experiment ran because code exists, or that a result is
valid because it appears in a draft. Do not launch costly jobs, change shared
infrastructure, publish artifacts, submit a manuscript, or write to external
systems without explicit authorization.

## End-to-end workflow

### 1. Frame claims and contribution

Write the central claim, scope, novelty, and expected evidence. List plausible
alternative explanations and the nearest prior work. Reject framing that
depends on inflated significance or an untestable contribution.

### 2. Build a verified literature map

Use the arXiv skill for paper discovery, grounded-citations for claim-level
verification, and the PDF skill for figures, tables, equations, and exact page
regions. Prefer primary sources and exact versions. Maintain a claim-to-source
map; a related paper is not automatically support for the current sentence.

Organize related work by the technical distinction that matters to the paper,
not as a list of summaries. State how the proposed work extends, contrasts
with, or depends on each relevant line of work.

### 3. Design experiments before interpreting them

For every empirical claim, specify:

- the experiment that could support or falsify it;
- strong, current, and fair baselines;
- datasets, splits, preprocessing, metrics, and leakage controls;
- ablations and controls that isolate the claimed mechanism;
- seeds, sample sizes, uncertainty, statistical tests, and stopping rules;
- compute, software, hardware, and configuration needed for reproduction;
- failure handling and how incomplete runs will be reported.

Record decisions before seeing results when practical. Keep negative, null, and
failed experiments; they constrain the paper's honest conclusion.

### 4. Execute and preserve evidence

Run only authorized experiments through the repository's normal workflow.
Capture immutable configurations, code revisions, environment details, raw
outputs, logs, and checksums. Do not overwrite prior results. Separate raw
measurements from analysis scripts and presentation artifacts.

### 5. Analyze without manufacturing a story

Validate data completeness and metric definitions before aggregation. Report
central estimates with appropriate dispersion or intervals. Use statistical
tests only when their assumptions fit the design, and distinguish statistical
from practical significance. Investigate anomalies and alternative
explanations. Narrow or withdraw claims when the evidence is weak.

Figures and tables should expose the comparison, units, uncertainty, sample
size, and experimental condition. Captions must be interpretable without
guessing hidden setup details.

### 6. Draft in claim-first order

A common structure is:

1. **Abstract:** problem, method, evidence, principal result, and scope.
2. **Introduction:** motivation, gap, contribution, and evidence preview.
3. **Related work:** technical positioning with verified citations.
4. **Method:** enough precision to understand and reproduce the approach.
5. **Experimental setup:** data, baselines, metrics, implementation, and
   evaluation protocol.
6. **Results and analysis:** claim-aligned findings, ablations, uncertainty,
   failures, and limitations.
7. **Conclusion:** what the evidence establishes, without new claims.

Include limitations, broader impacts, ethics, data statements, and artifact
details when the work or venue requires them. Draft the abstract after the
claim and evidence are stable.

### 7. Review and revise

Perform separate passes for contribution clarity, methodological validity,
claim-to-evidence support, citation accuracy, reproducibility, statistical
reasoning, visual legibility, anonymity, and prose. Prioritize correctness and
missing evidence over style. Track which reviewer concern each revision
addresses and preserve disagreements rather than silently rewriting history.

For rebuttals, restate the concern accurately, answer with existing evidence,
correct genuine mistakes, and distinguish a clarification from a promised new
experiment. Never claim that unrun work is complete.

### 8. Prepare the submission artifact

Check the current venue instructions at submission time. Verify page limits,
template version, anonymity, references, figure files, labels, supplemental
material, ethics and disclosure forms, and metadata. Compile LaTeX through the
available LaTeX workflow and inspect the rendered PDF visually; a successful
compile does not prove the layout is correct.

Submission, author list, public release, code upload, and external write-back
remain explicit human actions.

## Repository and vault placement

Keep operational work in `tasks/` or `scratch/`, immutable textual evidence in
`raw/`, eligible binaries and rendered artifacts in `assets/`, durable
source-backed synthesis in `wiki/`, and polished manuscript or report outputs
in `output/`, following the nearest schema. Repository-specific experiments
and code-owned documentation stay with the code repository. A paper draft is
synthesis, not evidence for its own claims.

## Final quality bar

The paper's contribution, scope, evidence, and limitations should agree across
the abstract, body, tables, figures, and conclusion. Every citation must exist
and support the adjacent claim; every reported number must trace to preserved
results; every figure and table must match the analyzed data; and no statement
may imply an experiment, verification, approval, or submission that did not
occur.

## Attribution

Adapted from the NousResearch research-paper-writing skill, MIT licensed. This
version is rewritten for framework-neutral repository and knowledge-vault
workflows.
