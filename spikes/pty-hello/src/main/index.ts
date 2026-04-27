import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import * as pty from 'node-pty'
import stripAnsi from 'strip-ansi'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface PermissionHit {
  text: string
  firedAt: number
}

interface PtySession {
  proc: pty.IPty
  alive: boolean
  /** Sliding window of recent stripped output for sniffer regex matching. */
  buffer: string
  /** Last fired prompt-text → timestamp, for de-duplication. */
  recentHits: Map<string, number>
}

const sessions = new Map<string, PtySession>()
let mainWindow: BrowserWindow | null = null
let quitting = false
let sandboxDir: string | null = null

const BUFFER_MAX = 4096
const DEDUP_WINDOW_MS = 2000

/**
 * Sniffer patterns for claude-code-style permission prompts.
 * See SNIFFER-PATTERNS.md for the full rationale and rejected candidates.
 *
 * IMPORTANT: this is a *fallback* signal. Production cockpit should consume
 * claude-code hooks (PreToolUse/PostToolUse JSON over stdin/stdout) as the
 * primary signal. The PTY sniffer exists to catch UI prompts that bypass the
 * hooks layer (e.g. interactive TUI prompts, version drift).
 */
const SNIFFER_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'allow_yn', re: /Allow .+\? \(y\/n\)/i },
  { kind: 'do_you_want', re: /Do you want me to/i },
  { kind: 'approve_action', re: /Approve this (edit|tool|action)/i },
  { kind: 'generic_yn_eol', re: /\[y\/n\]\s*$/i },
  // Additional reasonable patterns observed in claude-code public docs / TUI:
  { kind: 'continue_yn', re: /Continue\?\s*\(y\/n\)/i },
  { kind: 'proceed_yn', re: /Proceed with .+\?\s*\(y\/n\)/i },
  { kind: 'numbered_choice', re: /^\s*1\.\s*Yes\b[\s\S]*^\s*2\.\s*No\b/m },
]

function pickShell(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    const candidates = ['pwsh.exe', 'powershell.exe', 'cmd.exe']
    return { shell: candidates[0]!, args: [] }
  }
  if (process.platform === 'darwin') {
    return { shell: process.env.SHELL || '/bin/zsh', args: [] }
  }
  return { shell: process.env.SHELL || '/bin/bash', args: [] }
}

function ensureSandboxDir(): string {
  if (sandboxDir && fs.existsSync(sandboxDir)) return sandboxDir
  const rand = crypto.randomBytes(6).toString('hex')
  sandboxDir = join(os.tmpdir(), `pty-hello-sandbox-${rand}`)
  fs.mkdirSync(sandboxDir, { recursive: true })
  console.log(`[pty-hello] sandbox dir: ${sandboxDir}`)
  return sandboxDir
}

function attachSession(id: string, proc: pty.IPty): PtySession {
  const session: PtySession = {
    proc,
    alive: true,
    buffer: '',
    recentHits: new Map(),
  }

  proc.onData((data: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`pty:data:${id}`, data)
    }
    // Strip ANSI before sniffing; keep raw chunk routed to xterm.
    const cleaned = stripAnsi(data)
    session.buffer = (session.buffer + cleaned).slice(-BUFFER_MAX)
    runSniffer(id, session, cleaned)
  })

  proc.onExit(({ exitCode, signal }) => {
    session.alive = false
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`pty:exit:${id}`, { exitCode, signal })
    }
    sessions.delete(id)
  })

  sessions.set(id, session)
  return session
}

function runSniffer(id: string, session: PtySession, _chunk: string) {
  // Match against the buffer tail (last few lines) for stability across chunk boundaries.
  // We match on the buffer, not the chunk, because a prompt can split across PTY writes.
  const haystack = session.buffer
  const now = Date.now()

  for (const { kind, re } of SNIFFER_PATTERNS) {
    const m = haystack.match(re)
    if (!m) continue
    const text = m[0].trim()
    if (!text) continue

    // Coalesce duplicates: same text in last DEDUP_WINDOW_MS → skip.
    const last = session.recentHits.get(text)
    if (last && now - last < DEDUP_WINDOW_MS) continue
    session.recentHits.set(text, now)

    // GC old hits.
    for (const [k, t] of session.recentHits) {
      if (now - t > DEDUP_WINDOW_MS * 5) session.recentHits.delete(k)
    }

    const hitId = `${id}:${now}:${crypto.randomBytes(3).toString('hex')}`
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:permission', {
        id: hitId,
        sessionId: id,
        text,
        kind,
      })
    }
    console.log(`[sniffer] hit kind=${kind} text=${JSON.stringify(text)}`)
    // After we surface one, trim buffer so we don't match the same trailing content again.
    session.buffer = ''
    break
  }
}

function spawnShellPty(id: string): PtySession {
  const { shell, args } = pickShell()
  const proc = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME || process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' } as { [key: string]: string },
    useConptyDll: false,
  } as pty.IWindowsPtyForkOptions & pty.IPtyForkOptions)
  return attachSession(id, proc)
}

function spawnClaudePty(id: string): PtySession {
  const cwd = ensureSandboxDir()
  // Resolve `claude` from PATH (node-pty handles PATH lookup via the shell).
  // On Windows, prefer `claude.cmd` if present, else fall back to `claude`.
  const cmd = process.platform === 'win32' ? 'claude.cmd' : 'claude'
  const proc = pty.spawn(cmd, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' } as { [key: string]: string },
    useConptyDll: false,
  } as pty.IWindowsPtyForkOptions & pty.IPtyForkOptions)
  return attachSession(id, proc)
}

function registerIpc() {
  ipcMain.handle('pty:spawn', (_e: IpcMainInvokeEvent, id: string) => {
    if (sessions.has(id)) return { ok: false, error: 'already exists' }
    try {
      const s = spawnShellPty(id)
      return { ok: true, pid: s.proc.pid, shell: pickShell().shell }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('pty:spawnClaude', (_e: IpcMainInvokeEvent, id: string) => {
    if (sessions.has(id)) return { ok: false, error: 'already exists' }
    try {
      const s = spawnClaudePty(id)
      return { ok: true, pid: s.proc.pid, cwd: sandboxDir }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.on('pty:write', (_e, id: string, data: string) => {
    const s = sessions.get(id)
    if (s && s.alive) s.proc.write(data)
  })

  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => {
    const s = sessions.get(id)
    if (!s || !s.alive) return
    try {
      if (s.proc.pid !== undefined) {
        s.proc.resize(Math.max(1, cols | 0), Math.max(1, rows | 0))
      }
    } catch (err) {
      console.warn('[pty] resize failed (likely already exited):', err)
    }
  })

  ipcMain.handle('pty:kill', async (_e, id: string) => {
    const s = sessions.get(id)
    if (!s) return { ok: false, error: 'no such session' }
    if (!s.alive) return { ok: true, alreadyDead: true }
    return await new Promise<{ ok: true }>((resolve) => {
      const sub = s.proc.onExit(() => {
        sub.dispose()
        resolve({ ok: true })
      })
      try {
        s.proc.kill()
      } catch (err) {
        console.warn('[pty] kill threw:', err)
        resolve({ ok: true })
      }
    })
  })

  // Permission response from renderer.
  ipcMain.on(
    'pty:permission:respond',
    (_e, payload: { sessionId: string; allow: boolean }) => {
      const s = sessions.get(payload.sessionId)
      if (!s || !s.alive) return
      try {
        s.proc.write(payload.allow ? 'y\n' : 'n\n')
      } catch (err) {
        console.warn('[pty] permission write failed:', err)
      }
    },
  )
}

async function gracefulShutdown() {
  const closes = Array.from(sessions.values()).map((s) => {
    if (!s.alive) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const sub = s.proc.onExit(() => {
        sub.dispose()
        resolve()
      })
      try {
        s.proc.kill()
      } catch {
        resolve()
      }
      setTimeout(() => resolve(), 2000)
    })
  })
  await Promise.all(closes)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    title: 'pty-hello (T-DESIGN-003)',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  ensureSandboxDir()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', async (e) => {
  if (quitting) return
  if (sessions.size === 0) return
  e.preventDefault()
  quitting = true
  await gracefulShutdown()
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

console.log(
  `[pty-hello] platform=${process.platform} arch=${process.arch} node=${process.version} os=${os.release()}`,
)
