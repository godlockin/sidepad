# sidepad

> **Think in parallel. Decide with confidence. Own your data.**

One question. Multiple AI brains answering simultaneously. You pick the winner — or let them build on each other.

---

## Why sidepad?

| Pain | What others give you | What sidepad gives you |
|------|---------------------|----------------------|
| Locked into one model's blind spots | ChatGPT / Claude.ai — single answer, take it or leave it | Ask GPT-4o, Claude, Gemini, and your local Llama **simultaneously** — compare, contrast, decide |
| Cloud apps own your conversations | Everything synced to their servers | **Local-first, zero telemetry** — data never leaves your machine |
| Sequential back-and-forth is slow | One-shot Q&A | **Relay mode**: AI A drafts → AI B refines → AI C critiques, like a real team |
| Generic responses for specialized work | No context persistence | **Skills + Personas**: inject domain knowledge, give each AI a distinct voice |

---

## What makes it different

### 🔀 Parallel mode — ask everyone at once
Pose one question to GPT-4o, Claude Sonnet, Gemini Pro, and your local Ollama model in a single send. See four answers side by side. Stop wondering "what would the other model say?"

### 🔗 Relay mode — AI assembly line
```
You: "Draft a product spec for X"
  → Claude writes the first draft
  → GPT-4o stress-tests the assumptions
  → Gemini rewrites for clarity
  → You ship the final version
```
Each model sees the previous output and builds on it. Complex tasks that need multiple perspectives, handled automatically.

### 🎯 Lead-and-comment mode — one answers, others critique
Designate one AI as the lead. The rest read its response and add commentary, corrections, or alternatives. Peer review for AI outputs, in real time.

---

## Features

- **Multi-provider group chat** — OpenAI, Anthropic, Google Gemini, Ollama, and any OpenAI-compatible endpoint
- **Relay mode** — sequential AI pipeline where each model builds on the last
- **Lead-and-comment mode** — primary responder + AI peer reviewers
- **Parallel mode** — simultaneous responses from all active models
- **Persona system** — custom names, system prompts, and personalities per AI voice
- **Skill system** — inject domain knowledge (code style guides, brand voice, technical specs) into any session
- **MCP tool integration** — AI agents call your local tools directly (file system, search, custom scripts)
- **Local-first, zero telemetry** — no accounts, no cloud sync, no data collection
- **SQLite persistence** — conversation history stored locally
- **Cross-platform** — macOS (arm64 + x64), Windows, Linux

---

## Requirements

- Node 22 (use `nvm use` — version pinned in `.nvmrc`)
- npm 10+
- macOS / Windows / Linux

## Develop

```bash
nvm use
npm install
npm run dev          # electron-vite dev server with HMR
```

## Test

```bash
npm test             # vitest (unit + integration)
npm run typecheck    # tsc --noEmit on main + node configs
npm run test:e2e     # playwright (boots packaged Electron)
npm run test:e2e:regression  # focused regression suite for shipped features
npm run lint
```

### Regression suite

`npm run test:e2e:regression` runs specs under `tests/e2e/regression/`.
Designed to pass on a fresh clone with **no API keys**: cloud-dependent assertions are gated on env vars (e.g. `AZURE_OPENAI_*`, `BRAVE_API_KEY`, `TAVILY_API_KEY`) and skipped when missing.

## Build & package

```bash
npm run build                # compile only (out/)
npm run package:mac-arm      # → release/sidepad-darwin-arm64/sidepad.app
npm run package:mac-x64      # → release/sidepad-darwin-x64/sidepad.app
npm run package:win          # → release/sidepad-win32-x64/sidepad.exe
npm run package:linux        # → release/sidepad-linux-x64/sidepad
```

`release/` is git-ignored. Native modules (`better-sqlite3`) are rebuilt for Electron automatically. If you switch between dev and packaged use, run `npm run rebuild:electron` (for Electron) or `npm run rebuild:node` (for tests).

## Release (CI)

Tag a version to trigger multi-platform build + GitHub Release:

```bash
git tag v0.0.2
git push origin v0.0.2
```

`.github/workflows/release.yml` runs in parallel on `macos-14` (arm64), `macos-13` (x64), `windows-latest`, `ubuntu-latest` — uploads zipped artifacts and attaches to the release. Manual run: GitHub → Actions → release → "Run workflow".

---

> Design spec: `docs/superpowers/specs/2026-04-22-sidepad-design.md`

## License

Private — not yet open-sourced.
