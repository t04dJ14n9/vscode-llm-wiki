---
name: humanizer
description: Rewrite or review user-facing prose so it sounds natural and specific while preserving facts, citations, technical meaning, and the writer's voice. Use when asked to humanize, de-AI, remove formulaic prose, match a writing sample, or polish reports and documentation. Do not use on immutable evidence, quotations, code, generated navigation/history, or human-owned vault regions.
license: MIT
metadata:
  version: "1.0.0"
  tags: [writing, editing, humanize, voice, prose]
  source: https://github.com/blader/humanizer
---

# Humanizer

Make prose sound like a person wrote it. Preserve what the text says. Do not
invent facts, sources, experiences, opinions, names, numbers, dates, or quotes.

## Preserve before polishing

- Keep every factual claim, qualification, limitation, citation, link, and
  technical term unless the user asks to change substance.
- Never alter quoted text to make it sound smoother.
- Preserve Markdown structure that carries meaning, including footnotes,
  source anchors, frontmatter, relations, identifiers, and human-owned markers.
- For an LLM Wiki, do not rewrite `raw/`, generated `_index.md`, `_log.md`,
  selection artifacts, or source excerpts. Humanize synthesized prose in
  `wiki/`, `output/`, project cards, and ordinary documentation when requested.
- Keep technical, legal, reference, and evidence-heavy writing neutral. Add
  personality only when the genre and the writer's voice support it.

## Rewrite workflow

1. Identify the audience, genre, intended tone, and any supplied voice sample.
2. Mark formulaic passages without treating the checklist below as a word ban.
3. Rewrite the smallest sections that need work. Prefer concrete subjects,
   direct verbs, specific evidence, and natural sentence rhythm.
4. Compare the rewrite with the input claim by claim. Restore anything lost and
   remove anything newly invented.
5. Read it once for cadence. Break repetitive sentence shapes, but keep useful
   repetition and deliberate quirks from the writer.
6. Return the polished text. For file edits, make targeted changes and summarize
   them; show a detailed style audit only when the user asks for one.

When a writing sample is provided, it overrides generic style preferences.
Match its vocabulary, sentence length, punctuation, paragraph openings,
transitions, and degree of formality without caricaturing the writer.

## Patterns worth fixing

Fix a pattern only when it weakens the actual passage.

- **Inflated significance:** "pivotal," "a testament," "underscores," or broad
  historical claims that the evidence does not support.
- **Sales language:** "groundbreaking," "vibrant," "seamless," "powerful," or
  feature descriptions that read like advertising.
- **Vague authority:** "experts say," "industry reports," or "critics argue"
  without a named, cited source.
- **Decorative analysis:** trailing `-ing` phrases, forced metaphors, false
  ranges, or abstract statements that add importance without information.
- **Chat residue:** "Great question," "I hope this helps," "let's dive in," or
  offers to continue that do not belong in the document.
- **Filler and stacked hedging:** "in order to," "it is important to note,"
  "could potentially possibly," and similar padding.
- **Mechanical rhetoric:** repeated rules of three, "not just X but Y," instant
  question-and-answer hooks, punchy fragments, or a slogan at every ending.
- **Synthetic variation:** cycling through synonyms instead of repeating the
  clearest noun, or avoiding simple verbs such as `is`, `has`, and `uses`.
- **Uniform structure:** identical sentence lengths, repeated paragraph shapes,
  unnecessary mini-headings, and lists that would read better as prose.
- **Formatting habits:** excessive boldface, emojis, title-case headings, em
  dashes, or parenthetical asides. Preserve these when they are part of the
  writer's demonstrated voice or a real formatting convention.
- **Hidden actors:** passive or subjectless sentences when naming the actor
  would make responsibility clearer.
- **Generic endings:** optimistic summaries, reassurance, or "future outlook"
  paragraphs that add no new fact or decision.

## Quality bar

The result should be clearer and less assembled, not merely more casual. It
should retain the original evidence and uncertainty, fit the document's genre,
and sound natural when read aloud. If polishing would require missing facts or
an unsupported opinion, leave the point plain or ask the user.

## Attribution

Adapted from Siqi Chen's [humanizer](https://github.com/blader/humanizer), MIT
licensed, which draws on Wikipedia's "Signs of AI writing" guidance. This
version is rewritten for repository and knowledge-vault workflows.
