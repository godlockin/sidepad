import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

declare global {
  interface Window {
    pty: import('../preload/index').PtyApi
  }
}

const SESSION_ID = 'main'

const statusEl = document.getElementById('status') as HTMLSpanElement
const echoBtn = document.getElementById('btn-echo') as HTMLButtonElement
const killBtn = document.getElementById('btn-kill') as HTMLButtonElement
const termHost = document.getElementById('term') as HTMLDivElement

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

// Streaming UTF-8 decoder per survey constraint (multi-byte safe).
const decoder = new TextDecoder('utf-8', { fatal: false })

async function start() {
  setStatus('spawning…', '#e0c66b')
  const r = await window.pty.spawn(SESSION_ID)
  if (!r.ok) {
    setStatus(`spawn failed: ${r.error ?? 'unknown'}`, '#f06b6b')
    return
  }
  setStatus(`pid=${r.pid} shell=${r.shell}`)

  window.pty.onData(SESSION_ID, (data) => {
    // node-pty IPC delivers strings (utf8). If we ever switch to Buffer,
    // route through `decoder.decode(buf, { stream: true })` instead.
    term.write(data)
  })

  window.pty.onExit(SESSION_ID, ({ exitCode, signal }) => {
    setStatus(`exited (code=${exitCode}${signal != null ? ` sig=${signal}` : ''})`, '#f06b6b')
    term.write(`\r\n[pty exited code=${exitCode}]\r\n`)
  })

  term.onData((d) => window.pty.write(SESSION_ID, d))

  const doFit = () => {
    try {
      fit.fit()
      const { cols, rows } = term
      window.pty.resize(SESSION_ID, cols, rows)
    } catch (err) {
      console.warn('fit/resize failed:', err)
    }
  }
  doFit()
  window.addEventListener('resize', doFit)
  // also after fonts load
  setTimeout(doFit, 200)
}

echoBtn.addEventListener('click', () => {
  // Survey-flavored: keep it minimal — write the literal command to PTY stdin.
  window.pty.write(SESSION_ID, 'echo hello\n')
})

killBtn.addEventListener('click', async () => {
  setStatus('killing…', '#e0c66b')
  const r = await window.pty.kill(SESSION_ID)
  if (r.ok) {
    setStatus(r.alreadyDead ? 'already dead' : 'killed', '#f06b6b')
  } else {
    setStatus(`kill failed: ${r.error ?? 'unknown'}`, '#f06b6b')
  }
})

start().catch((err) => {
  console.error(err)
  setStatus(`error: ${(err as Error).message}`, '#f06b6b')
})
