# sidepad

Multi-LLM group-chat desktop app — talk to OpenAI, Anthropic, Ollama, and any OpenAI-compatible endpoint side by side.
Local-only, zero telemetry. Per-voice personas, skills, and MCP tool integration.

> Design spec: `docs/superpowers/specs/2026-04-22-sidepad-design.md`

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
npm run lint
```

## Build & package

The `build` step compiles main / preload / renderer into `out/`.
The `package` step wraps that in a platform-specific Electron app under `release/`.

```bash
npm run build                # compile only
npm run package:mac-arm      # → release/sidepad-darwin-arm64/sidepad.app
npm run package:mac-x64      # → release/sidepad-darwin-x64/sidepad.app
npm run package:win          # → release/sidepad-win32-x64/sidepad.exe
npm run package:linux        # → release/sidepad-linux-x64/sidepad
```

`release/` is git-ignored. Native modules (`better-sqlite3`) are rebuilt for Electron automatically; if you switch between dev and packaged use, run `npm run rebuild:electron` (for Electron) or `npm run rebuild:node` (for tests).

## Release (CI)

Tag a version to trigger a multi-platform build + GitHub Release:

```bash
git tag v0.0.2
git push origin v0.0.2
```

The `release` workflow (`.github/workflows/release.yml`) runs in parallel on `macos-14` (arm64), `macos-13` (x64), `windows-latest`, and `ubuntu-latest`, then uploads zipped artifacts and attaches them to the release. Manual run: GitHub → Actions → release → "Run workflow".

## License

Private — not yet open-sourced.
