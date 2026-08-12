# Authoring Workflow

Use this reference when compiling evidence, updating concepts, answering
queries, or handling conflicting sources.

## Orient and search

1. Read the root index and the nearest category index.
2. Read the newest bundle-log entry.
3. Search titles, aliases, tags, and body text before creating a page.
4. Follow existing sources into raw evidence or exact project files.
5. Confirm project submodules are initialized before making code claims.

## Choose the smallest durable page

Enrich an existing page when the new evidence answers the same durable
question. Create a page when the subject is central, recurs across sources, or
would otherwise require expensive rediscovery.

Use these roles:

- `Summary`: narrative entry point spanning several concepts.
- `Entity`: named dataset, model family, organization, or artifact.
- `Concept`: one mechanism or durable idea.
- `Comparison`: decision frame across approaches.
- `Query`: substantial answer worth preserving.

Keep project orientation in its `Software Project` card. Keep mechanically
captured source text in raw companions.

## Ground the body

Start with a direct definition or answer. Separate source facts from
synthesis. Link to exact project files when describing implementation.

For every external or internal source:

1. Add a stable `sources[].id`.
2. Put the source beside the claim with a matching footnote.
3. Define the footnote using the human-readable source title.
4. Add related compiled-page links only where the relationship helps a reader.

Do not use a source list as decoration; remove unused sources.

## Queries

Read compiled knowledge first and open raw/code evidence only as needed. File
an answer under `queries/` only when it is substantial, recurring, and
expensive to derive. A saved query contains:

- a direct answer;
- an evidence trail;
- limits or uncertainty; and
- links to the concepts that carry reusable detail.

## Conflicts

Do not overwrite one sourced position with another or invent a majority
verdict.

1. Keep the affected concept `status: draft`.
2. State both positions with dates and sources.
3. Add structured conflict entries linking the affected concepts.
4. Make the links symmetric.
5. Ask a human to resolve policy or truth claims that evidence alone cannot
   settle.

## Finish

Rebuild every affected local index, run check mode and full validation, inspect
the diff for unsupported claims or accidental raw edits, and add a newest-first
log entry for material compilation or conflict changes.
