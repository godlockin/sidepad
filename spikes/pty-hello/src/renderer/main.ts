import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

declare global {
  interface Window {
    pty: import('../preload/index').PtyApi
  }
}

const SHELL_SESSION = 'main'
const CLAUDE_SESSION = 'claude'

const statusEl = document.getElementById('status') as HTMLSpanElement
const echoBtn = document.getElementById('btn-echo') as HTMLButtonElement
const claudeBtn = document.getElementById('btn-claude') as HTMLButtonElement
const killBtn = document.getElementById('btn-kill') as HTMLButtonElement
const termHost = document.getElementById('term') as HTMLDivElement
const overlayRoot = document.getElementById('overlay-root') as HTMLDivElement

/** ID of the PTY session currently bound to the visible xterm. */
let activeSession: string = SHELL_SESSION
const dataUnsubs = new Map<string, () => void>()
const exitUnsubs = new Map<string, () => void>()

function setStatus(s: string, color = '#79c2a3') {
  statusEl.textContent = s
  statusEl.style.color = color
}

const term = new Terminal({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13,
  cursorBlink: true,
  convertEol: false,
  theme: {
    background: '#0b0d10',
    foreground: '#d8dee4',
    cursor: '#7fdbca',
  },
})
const fit = new FitAddon()
term.loadAddon(fit)
term.open(termHost)

// Streaming UTF-8 decoder kept here as a doc note (we still receive strings from
// node-pty over IPC; survey-recommended fallback if we ever switch to Buffer).
new TextDecoder('utf-8', { fatal: false })

function bindSession(id: string) {
  // Tear down previous bindings so xterm only renders the active session.
  for (const [k, off] of dataUnsubs) {
    off()
    dataUnsubs.delete(k)
  }
  for (const [k, off] of exitUnsubs) {
    off()
    exitUnsubs.delete(k)
  }
  activeSession = id

  dataUnsubs.set(
    id,
    window.pty.onData(id, (data) => term.write(data)),
  )
  exitUnsubs.set(
    id,
    window.pty.onExit(id, ({ exitCode, signal }) => {
      setStatus(
        `exited (code=${exitCode}${signal != null ? ` sig=${signal}` : ''})`,
        '#f06b6b',
      )
      term.write(`\r\n[pty exited code=${exitCode}]\r\n`)
    }),
  )
}

async function startShell() {
  setStatus('spawning shell…', '#e0c66b')
  const r = await window.pty.spawn(SHELL_SESSION)
  if (!r.ok) {
    setStatus(`spawn failed: ${r.error ?? 'unknown'}`, '#f06b6b')
    return
  }
  setStatus(`pid=${r.pid} shell=${r.shell}`)
  bindSession(SHELL_SESSION)

  term.onData((d) => window.pty.write(activeSession, d))

  const doFit = () => {
    try {
      fit.fit()
      const { cols, rows } = term
      window.pty.resize(activeSession, cols, rows)
    } catch (err) {
      console.warn('fit/resize failed:', err)
    }
  }
  doFit()
  window.addEventListener('resize', doFit)
  setTimeout(doFit, 200)
}

async function startClaude() {
  claudeBtn.disabled = true
  setStatus('spawning claude…', '#e0c66b')
  const r = await window.pty.spawnClaude(CLAUDE_SESSION)
  if (!r.ok) {
    setStatus(`claude spawn failed: ${r.error ?? 'unknown'}`, '#f06b6b')
    claudeBtn.disabled = false
    return
  }
  setStatus(`claude pid=${r.pid} cwd=${r.cwd ?? '?'}`)
  term.write(`\r\n[spawned claude in sandbox: ${r.cwd ?? '?'}]\r\n`)
  bindSession(CLAUDE_SESSION)
  // Force a resize so claude TUI lays out correctly.
  try {
    fit.fit()
    window.pty.resize(CLAUDE_SESSION, term.cols, term.rows)
  } catch (err) {
    console.warn('claude resize failed:', err)
  }
}

echoBtn.addEventListener('click', () => {
  window.pty.write(activeSession, 'echo hello\n')
})

claudeBtn.addEventListener('click', () => {
  startClaude().catch((err) => {
    console.error(err)
    setStatus(`claude error: ${(err as Error).message}`, '#f06b6b')
    claudeBtn.disabled = false
  })
})

killBtn.addEventListener('click', async () => {
  setStatus('killing…', '#e0c66b')
  const r = await window.pty.kill(activeSession)
  if (r.ok) {
    setStatus(r.alreadyDead ? 'already dead' : 'killed', '#f06b6b')
  } else {
    setStatus(`kill failed: ${r.error ?? 'unknown'}`, '#f06b6b')
  }
})

// ----- Permission overlay cards -----

interface PermissionPayload {
  id: string
  sessionId: string
  text: string
  kind: string
}

function renderPermissionCard(p: PermissionPayload) {
  const card = document.createElement('div')
  card.className = 'permission-card'
  card.dataset.permissionId = p.id

  const title = document.createElement('div')
  title.className = 'pc-title'
  const titleText = document.createElement('span')
  titleText.textContent = 'Permission requested'
  const kindBadge = document.createElement('span')
  kindBadge.className = 'pc-kind'
  kindBadge.textContent = p.kind
  title.appendChild(titleText)
  title.appendChild(kindBadge)

  const body = document.createElement('div')
  body.className = 'pc-body'
  body.textContent = p.text

  const actions = document.createElement('div')
  actions.className = 'pc-actions'
  const denyBtn = document.createElement('button')
  denyBtn.className = 'deny'
  denyBtn.textContent = 'Deny'
  const allowBtn = document.createElement('button')
  allowBtn.className = 'allow'
  allowBtn.textContent = 'Allow'

  const dispose = (allow: boolean) => {
    window.pty.respondPermission(p.sessionId, allow)
    card.remove()
  }
  allowBtn.addEventListener('click', () => dispose(true))
  denyBtn.addEventListener('click', () => dispose(false))

  actions.appendChild(denyBtn)
  actions.appendChild(allowBtn)
  card.appendChild(title)
  card.appendChild(body)
  card.appendChild(actions)

  // Stack newer cards below older ones.
  const existing = overlayRoot.querySelectorAll('.permission-card')
  card.style.top = `${16 + existing.length * 12}px`
  overlayRoot.appendChild(card)
}

window.pty.onPermission((p) => {
  console.log('[renderer] permission hit', p)
  renderPermissionCard(p)
})

startShell().catch((err) => {
  console.error(err)
  setStatus(`error: ${(err as Error).message}`, '#f06b6b')
})
