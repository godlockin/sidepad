#!/usr/bin/env node
// Smoke test for pty-hello spike.
// Spawns `npx electron .` in this package and watches stdout/stderr for the
// boot log line emitted by src/main/index.ts:
//   [pty-hello] platform=... arch=... node=... os=...
// Exits 0 on hit (then kills the process), 1 on 10s timeout.
//
// Wrap with `xvfb-run` from outside on Linux runners (no display).
// Self-contained: only Node stdlib + npx (which ships with Node).

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createWriteStream } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const cwd = resolve(__dirname, '..')

const TIMEOUT_MS = 10_000
const BOOT_RE = /\[pty-hello\] platform=\S+ arch=\S+ node=\S+ os=/

const logPath = process.env.SMOKE_LOG || resolve(cwd, 'smoke.log')
const logStream = createWriteStream(logPath, { flags: 'w' })

const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const child = spawn(cmd, ['electron', '.'], {
  cwd,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
})

let hit = false
let timer

function done(code, reason) {
  if (timer) clearTimeout(timer)
  logStream.write(`\n[smoke] ${reason}\n`)
  try { child.kill('SIGTERM') } catch {}
  // Force kill after grace period in case Electron hangs on quit.
  setTimeout(() => {
    try { child.kill('SIGKILL') } catch {}
  }, 3000).unref()
  // Allow log flush.
  logStream.end(() => process.exit(code))
}

function watch(streamName, stream) {
  stream.on('data', (chunk) => {
    const text = chunk.toString('utf8')
    process.stdout.write(`[${streamName}] ${text}`)
    logStream.write(text)
    if (!hit && BOOT_RE.test(text)) {
      hit = true
      done(0, `boot line detected on ${streamName}`)
    }
  })
}

watch('out', child.stdout)
watch('err', child.stderr)

child.on('error', (err) => {
  logStream.write(`\n[smoke] spawn error: ${err.message}\n`)
  done(1, `spawn error: ${err.message}`)
})

child.on('exit', (code, signal) => {
  if (hit) return
  done(1, `child exited before boot line (code=${code} signal=${signal})`)
})

timer = setTimeout(() => {
  if (hit) return
  done(1, `timeout after ${TIMEOUT_MS}ms without boot line`)
}, TIMEOUT_MS)
