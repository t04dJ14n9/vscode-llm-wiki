# Project repositories

`projects/repositories.yaml` is authoritative for repository ID, VCS (`git`,
`p4`, or `svn`), URL, default ref, flat card, paired vault, canonical
`projects/code/<id>/` checkout,
in-place workspace policy, update strategy, and LFS policy. The working copy
may be absent but is never stored by the outer repository.
Do not create `.gitmodules` or Git submodule entries; Git, P4, and SVN working
copies remain ignored in-place directories.

Prefer `git show <revision>:<path>`. Record repository, full revision,
repository-relative path, optional symbol, and content SHA-256. Checkout
advancement creates currentness debt without invalidating matching historical
objects. Uncommitted or unavailable source supports draft findings only.

Keep repository documentation in the code vault. A committed document supports
what it says at its revision. Import DeepWiki and other generated prose into
`summaries/` with its indexed revision and `provenance_state: unverified`; claims
about code behavior additionally require code, tests, configuration, protocols,
or other primary evidence.

For Nanochat, use `tools/llm-wiki/import_deepwiki.py` to import every embedded
page deterministically. Do not hand-copy a partial page set or mark imports
stable merely because their indexed revision matches the project card.
