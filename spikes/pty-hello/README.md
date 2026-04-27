# pty-hello — minimal node-pty + xterm.js spike (T-DESIGN-002)

A standalone Electron app that proves we can spawn a real PTY (zsh / bash / pwsh)
from the Electron main process and bidirectionally bridge it to an xterm.js
terminal in the renderer. This spike is the predecessor for T-DESIGN-003
(spawn `claude` CLI) and T-DESIGN-004 (cross-platform CI).

It is **completely self-contained** — its own `package.json` and `node_modules`,
sitting under `code_repo/spikes/pty-hello/`. The parent sidepad project is not
touched.

## Stack

| Component | Pin | Why |
|---|---|---|
| Electron | `^41.3.0` | Match parent project (`code_repo/package.json`) |
| node-pty | `^1.1.0-beta36` | Survey floor: ≥1.1.0 (post-#733 hang fix); first version shipping prebuilds |
| @xterm/xterm | `^5.5.0` | Current xterm.js |
| @xterm/addon-fit | `^0.10.0` | Auto-fit terminal to container |
| electron-vite | `^5.0.0` | Dev/build pipeline (matches parent) |
| @electron/rebuild | `^4.0.4` | Rebuild node-pty native binding for Electron's Node ABI |

## Install

```bash
cd code_repo/spikes/pty-hello
npm install
# postinstall runs electron-rebuild for node-pty automatically.
# If it fails, run it manually:
npm run rebuild
```

## Run (dev)

```bash
npm run dev
```

You should see an Electron window with:
- A toolbar (status, "Send `echo hello`" button, "Kill PTY" button)
- A black xterm pane showing your shell prompt

Type any command; output streams back live.

## Acceptance gates (T-DESIGN-002)

- [x] `cd code_repo/spikes/pty-hello && npm install` succeeds (with electron-rebuild for node-pty)
- [x] `npm run dev` launches Electron, xterm shows shell prompt, typing works
- [x] Click **Send `echo hello`** → terminal prints `hello`
- [x] Click **Kill PTY** → terminal stops responding, app stays alive (no crash, no zombies)
- [x] Cmd-Q exits cleanly (no SIGABRT dialog) thanks to graceful `before-quit` shutdown

## Survey-constraints honored

All from `docs/superpowers/specs/2026-04-27-pty-spike-survey.md` §8:

1. **Cleanup ordering**: `app.before-quit` → `pty.kill()` → await `exit` → `app.quit()`. See
   `gracefulShutdown()` in `src/main/index.ts`.
2. **Defensive resize**: `pty.resize` is wrapped in `try/catch` and gated on `pty.pid !== undefined`
   to avoid Windows issue #827.
3. **`useConptyDll: false`**: set unconditionally in spawn options (no-op on macOS/Linux,
   avoids 3.5s startup delay on Windows per #894).
4. **UTF-8 streaming decode**: noted in renderer (`TextDecoder` ready); current IPC delivers
   already-decoded strings from node-pty's default `encoding: 'utf8'`. If we ever switch to
   Buffer pass-through, the decoder is in place.
5. **Pin floor**: `node-pty@^1.1.0-beta36` — ≥1.1.0 fixes the Electron-quit hang (#733)
   and is the first version that ships prebuilt N-API binaries for darwin-arm64/x64.

## IPC surface (exposed via preload `window.pty`)

```ts
spawn(id): Promise<{ ok, pid?, shell?, error? }>
write(id, data): void
resize(id, cols, rows): void
kill(id): Promise<{ ok, alreadyDead?, error? }>
onData(id, cb): unsubscribe
onExit(id, cb): unsubscribe
```

This shape is intentionally minimal but multi-session-ready (each session is keyed
by an opaque `id` string), so T-DESIGN-003 can layer multiple PTYs (one per agent
process) without redesigning the preload contract.

## Shell selection

- darwin: `process.env.SHELL || /bin/zsh`
- linux: `process.env.SHELL || /bin/bash`
- win32: `pwsh.exe` (no fallback chain implemented in this spike — T-DESIGN-004 will harden)

## Known issues / sharp edges

- **node-pty native rebuild**: on first `npm install`, `electron-rebuild` runs in
  `postinstall`. If you see `was compiled against a different Node.js version` at runtime,
  run `npm run rebuild` manually.
- **`@electron/universal`** (#863): not exercised here; mentioned for downstream packagers.
- **macOS SIGABRT-on-quit (#904)**: the graceful shutdown path mitigates but does not
  fully eliminate this. If you observe a crash dialog on quit, capture the stack and
  attach to T-DESIGN-001 follow-up.
- **Windows**: not validated on this dev machine (macOS arm64 only). T-DESIGN-004 owns CI matrix.
- **xterm sizing**: `FitAddon` is naive about devicePixelRatio changes; live monitor swap
  may need a manual refit.

## Build / package

```bash
npm run build   # produces out/main, out/preload, out/renderer
npm start       # electron-vite preview (runs from out/)
```

Packaging (e.g. `electron-packager`) is intentionally **not wired** in this spike —
the deliverable is `npm run dev` working. Packaging gets settled at the cockpit-app
level, not per spike.

## Files

```
spikes/pty-hello/
├── package.json
├── tsconfig.json
├── electron.vite.config.ts
├── .gitignore
├── README.md
└── src/
    ├── main/index.ts        # PTY spawn + IPC handlers + graceful shutdown
    ├── preload/index.ts     # contextBridge: window.pty.{spawn,write,resize,kill,onData,onExit}
    └── renderer/
        ├── index.html
        ├── main.ts          # xterm.js wiring + buttons
        └── style.css
```
