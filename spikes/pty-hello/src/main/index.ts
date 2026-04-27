import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as os from 'node:os'
import * as pty from 'node-pty'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface PtySession {
  proc: pty.IPty
  alive: boolean
}

const sessions = new Map<string, PtySession>()
let mainWindow: BrowserWindow | null = null
let quitting = false

function pickShell(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    // Prefer pwsh.exe, fall back to powershell.exe, then cmd.exe
    const candidates = ['pwsh.exe', 'powershell.exe', 'cmd.exe']
    return { shell: candidates[0]!, args: [] }
  }
  if (process.platform === 'darwin') {
    return { shell: process.env.SHELL || '/bin/zsh', args: [] }
  }
  return { shell: process.env.SHELL || '/bin/bash', args: [] }
}

function spawnPty(id: string): PtySession {
  const { shell, args } = pickShell()
  // Survey constraint: useConptyDll: false on Windows to avoid 3.5s startup delay (#894).
  const proc = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME || process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' } as { [key: string]: string },
    // useConptyDll only meaningful on Windows; ignored elsewhere.
    useConptyDll: false,
  } as pty.IWindowsPtyForkOptions & pty.IPtyForkOptions)

  const session: PtySession = { proc, alive: true }

  proc.onData((data: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`pty:data:${id}`, data)
    }
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

function registerIpc() {
  ipcMain.handle('pty:spawn', (_e: IpcMainInvokeEvent, id: string) => {
    if (sessions.has(id)) return { ok: false, error: 'already exists' }
    const s = spawnPty(id)
    return { ok: true, pid: s.proc.pid, shell: pickShell().shell }
  })

  ipcMain.on('pty:write', (_e, id: string, data: string) => {
    const s = sessions.get(id)
    if (s && s.alive) s.proc.write(data)
  })

  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => {
    const s = sessions.get(id)
    if (!s || !s.alive) return
    // Survey constraint: defensive resize (issue #827)
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
}

async function gracefulShutdown() {
  // Survey constraint: kill PTYs and await exit before app.quit (#733, #904)
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
      // Safety net: never block longer than 2s
      setTimeout(() => resolve(), 2000)
    })
  })
  await Promise.all(closes)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    title: 'pty-hello (T-DESIGN-002)',
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

// Log host info for the spike record
console.log(`[pty-hello] platform=${process.platform} arch=${process.arch} node=${process.version} os=${os.release()}`)
