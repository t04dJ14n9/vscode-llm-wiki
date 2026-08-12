# LLM Wiki Clean Rename Design

## Objective

Rename the project to LLM Wiki while it is still under development. This is a
clean break: the renamed product will not read prior
identifiers, register legacy aliases, or migrate legacy vault layouts at
runtime.

## Naming Contract

The rename uses the naming form appropriate to each platform:

| Surface | New value |
| --- | --- |
| Product and UI copy | `LLM Wiki` |
| Vault state directory | `.llm_wiki/` |
| Repository name and URL segment | `llm_wiki` |
| npm package and VS Code identifier stem | `llm-wiki` |
| npm package scope | `@llm-wiki/*` |
| VS Code command and custom-editor namespace | `llm-wiki.*` |
| TypeScript and VS Code context-key prefix | `llmWiki` |
| Uppercase constants and environment-style identifiers | `LLM_WIKI` |
| Generated anchor extension | `.llm_wiki_anchor` |
| JSON-LD compact prefix | `llm_wiki:` |
| JSON-LD namespace | `urn:llm_wiki:` |

Underscores are used for the requested persisted state and repository name.
Hyphens are used for npm and VS Code manifest identifiers because those
ecosystems conventionally restrict package-style identifiers. The display name
is title-cased and contains a space.

## Rename Scope

The clean rename covers:

- root, core, PDF editor, and VS Code extension package metadata;
- pnpm workspace dependency names, filters, lockfile importers, and build
  configuration;
- extension publisher/name metadata, activation events, commands, keybindings,
  menus, view containers, views, custom-editor types, configuration keys,
  context keys, URI authorities, webview titles, notifications, and logs;
- TypeScript exports, imports, constants, helper names, CSS identifiers,
  temporary-directory prefixes, generated artifact names, and protocol values;
- vault state paths for agent exports, PDF annotations, snapshots, configuration,
  indexes, and other local state;
- generated passage-link filenames and validators;
- portable PDF annotation contexts, properties, selectors, scanners, and
  fixtures;
- unit, integration, Playwright, and VS Code-host tests and fixtures;
- root and package READMEs, architecture/product/reference documentation,
  current design specifications, current implementation plans, launch
  configuration, CI, ignore rules, and demo-vault agent instructions;
- current ignored demo-vault integration files, including renaming
  its state directory to `demo-vault/.llm_wiki/`, its provider instructions,
  and project-specific skill/command paths.

The Git history and the absolute filesystem path of the current checkout are
not repository content and are not rewritten. The local Git remote is not
changed because renaming the GitHub repository is an external operation; tracked
repository metadata will use the intended `llm_wiki` URL.

## Compatibility Policy

There is no backward-compatibility layer:

- no prior state-directory fallback or runtime migration;
- no old command, view, editor, URI, configuration, or context-key aliases;
- no prior generated-anchor reader;
- no old npm package aliases;
- no support for the prior JSON-LD vocabulary.

The existing ignored demo-vault state is moved in place so development data is
not deleted. Generated development artifacts inside that state may be rewritten
to the new anchor extension and path where needed for the live demo to remain
usable, but production code will understand only the new contract.

## Implementation Boundaries

The rename should centralize recurring identity values where that reduces drift,
but it will not introduce a general branding framework or unrelated
refactoring. Existing behavior for Markdown, PDF viewing, Vim mode, theme
colors, outlines, annotations, and agent handoff remains unchanged except for
the renamed identifiers and paths.

Filesystem safety checks must retain their existing confinement, symlink, file
mode, atomic-write, and immutable-export guarantees after the directory and
anchor names change.

## Verification

The implementation is complete only when:

1. focused tests demonstrate the new vault layout, anchors, package identifiers,
   commands, editor types, JSON-LD vocabulary, and user-facing name;
2. focused tests were observed failing before production changes and passing
   afterward;
3. `pnpm check` passes;
4. the full Playwright suite passes;
5. production extension bundles build successfully;
6. a source audit of tracked, current code/document/configuration files finds no
   prior product-name, identifier, state-directory, anchor-extension, or
   JSON-LD-vocabulary references;
7. a fresh demo vault creates and uses `.llm_wiki/`;
8. the renamed existing demo vault opens Markdown and PDF content, renders both
   outlines, exports a selection below `.llm_wiki/agent/`, and prepares agent
   handoff context without submitting a prompt.

After all verification succeeds on the feature branch, the branch is merged
locally into `main`, the merged result is verified again, and the feature
worktree is removed.
