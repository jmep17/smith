# smith

A Claude Code-like coding agent that runs entirely on **local models**, served by [LM Studio](https://lmstudio.ai). TypeScript + Bun, [Vercel AI SDK](https://ai-sdk.dev) transport with a hand-owned agent loop, [Ink](https://github.com/vadimdemedes/ink) TUI.

```
smith                       # interactive TUI in the current directory
smith -p "fix the TODO"     # one-shot headless run
smith -c                    # resume the latest session
```

## Requirements

- [Bun](https://bun.sh) (`brew install oven-sh/bun/bun`)
- LM Studio serving on `localhost:1234` — the sibling repo `~/src/local-claude` handles install + model download (`./setup.sh && ./server.sh start`)

## Install

```bash
cd ~/src/smith
bun install
bun run build            # produces dist/smith (single binary)
ln -s ~/src/smith/dist/smith /opt/homebrew/bin/smith
```

Or run from source: `bun src/index.ts`.

## Hardware profiles

Auto-detected by RAM (override: `SMITH_PROFILE=m4|air` or `--profile`):

| | `m4` (≥40GB) | `air` (<40GB) |
|---|---|---|
| Model | `qwen/qwen3-coder-30b` | `qwen/qwen3.5-9b` |
| Context | 131,072 | 16,384 |
| Max tool result | 30k chars | 4k chars |

Point at a different server with `SMITH_BASE_URL`.

## Tools

Read · Write · Edit · Bash · Glob · Grep · WebFetch · WebSearch (DuckDuckGo, or Brave with `BRAVE_API_KEY`) · TaskWrite

Design notes for local models: a small flat toolset, malformed tool calls are fed back as errors for self-repair (3 strikes per turn), oversized results spill to `~/.local/share/smith/spill/`, and history auto-compacts near the context limit.

## Permissions

Read-only tools run freely; Write/Edit/Bash/WebFetch prompt (allow once / always / deny). "Always" persists a rule to `.smith/settings.json`:

```json
{ "allow": ["Bash(npm *)", "Edit(src/**)", "WebFetch(domain:bun.com)"], "deny": ["Read(secrets/**)"] }
```

Global rules live in `~/.config/smith/settings.json`. Deny beats allow. Headless runs deny by default — pass `--yes` or `--allow "…"`.

## Sessions & memory

- Every turn appends to `~/.local/share/smith/sessions/<timestamp>.jsonl`; `-c/--continue` resumes the latest, `--resume <file>` a specific one.
- An `AGENT.md` in the project root is loaded into the system prompt (project conventions, build commands, etc.).
- `/help`, `/clear`, `/compact`, `/model`, `/quit` in the TUI; `esc` interrupts a turn.

## Development

```bash
bun test                 # unit tests (tools, permissions)
bun run typecheck        # tsc --noEmit
bun run lint             # biome check (lint + format)
test/smoke.sh            # end-to-end against live LM Studio
```

Linting/formatting is [Biome](https://biomejs.dev) (`biome.json`). Git hooks live in `.githooks/` and are enabled by `bun install` (via the `prepare` script): `pre-commit` runs biome + typecheck + tests; `commit-msg` enforces [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `chore:`, … with optional scope).
