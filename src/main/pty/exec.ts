import { spawn } from 'node:child_process';
import { isInsideRoot } from '../sandbox/jail.js';

const MAX_OUTPUT = 16_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface PtyExecResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

/**
 * One-shot shell command inside a sandbox root.
 * Uses a real shell process with a bounded capture (interactive node-pty stays in spikes/pty-hello).
 */
export function runPtyCommand(opts: {
  command: string;
  cwd: string;
  roots: string[];
  timeoutMs?: number;
}): Promise<PtyExecResult> {
  const command = opts.command.trim();
  if (!command) return Promise.reject(new Error('pty_exec requires a command'));
  if (command.length > 4000) return Promise.reject(new Error('command is too long'));
  if (!opts.roots.some((root) => isInsideRoot(root, opts.cwd))) {
    return Promise.reject(new Error('working directory is outside the project sandbox'));
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const shell = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];

  return new Promise((resolvePromise, reject) => {
    const child = spawn(shell, args, {
      cwd: opts.cwd,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        LANG: process.env.LANG ?? 'C.UTF-8',
        TERM: 'xterm-256color',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    const append = (chunk: Buffer) => {
      if (output.length >= MAX_OUTPUT) return;
      output += chunk.toString('utf8');
      if (output.length > MAX_OUTPUT) output = `${output.slice(0, MAX_OUTPUT)}\n… truncated`;
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, output: output.trim(), timedOut });
    });
  });
}
