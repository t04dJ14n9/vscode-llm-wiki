# Agent skill discovery

`.agents/skills/` is the only canonical copy of each skill package in this
repository. Codex reads it directly. Claude Code and Cursor can discover the
same packages through per-skill links; Cursor also gets a thin command adapter
that points back to the canonical `SKILL.md`.

```bash
python3 tools/llm-wiki/install_agent_skills.py --vault /path/to/vault
```

The command is idempotent when its links and adapters already match. It stops
on a conflicting path unless `--force` is explicit. On Windows it falls back
to directory junctions when ordinary symlinks are unavailable. It never copies
a package, installs a CLI, or writes MCP configuration.

| Client | Discovery path | Explicit invocation |
|---|---|---|
| Codex | `.agents/skills/<skill>/SKILL.md` | `$<skill-name>` |
| Claude Code | `.claude/skills/<skill>/SKILL.md` | `/<skill-name>` |
| Cursor | `.cursor/skills/<skill>/SKILL.md` | `/<skill-name>` through `.cursor/commands/` |

Treat links and adapters as device-local setup. Keep tokens, cookies, login
state, external CLI configuration, and MCP credentials in the local
environment or secret manager, never in this repository or a vault.
