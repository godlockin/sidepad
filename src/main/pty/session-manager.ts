import * as pty from 'node-pty';
import type { BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import stripAnsi from 'strip-ansi';
import { isInsideRoot } from '../sandbox/jail.js';
import { PermissionSniffer } from './sniffer.js';

export interface PtySpawnOpts {
  id: string;
  cwd: string;
  roots: string[];
  cols?: number;
  rows?: number;
  /** Chat session id for permission/audit correlation. */
  chatSessionId?: string;
}

interface LiveSession {
  proc: pty.IPty;
  alive: boolean;
  cwd: string;
  chatSessionId?: string;
  sniffer: PermissionSniffer;
}

function pickShell(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return { shell: process.env.ComSpec || 'cmd.exe', args: [] };
  }
  if (process.platform === 'darwin') {
    return { shell: process.env.SHELL || '/bin/zsh', args: [] };
  }
  return { shell: process.env.SHELL || '/bin/bash', args: [] };
}

/**
 * Multi-session PTY manager for the main process.
 * Interactive xterm bridge lives in the renderer; this owns spawn/write/resize/kill.
 * Optional CLI permission sniffer is a fallback (hooks remain the preferred path).
 */
export class PtySessionManager {
  private sessions = new Map<string, LiveSession>();
  private win: BrowserWindow | null = null;

  setWindow(win: BrowserWindow | null): void {
    this.win = win;
  }

  spawn(opts: PtySpawnOpts): { ok: true; pid: number; shell: string } | { ok: false; error: string } {
    if (this.sessions.has(opts.id)) return { ok: false, error: 'session already exists' };
    if (!opts.roots.some((root) => isInsideRoot(root, opts.cwd))) {
      return { ok: false, error: 'working directory is outside the project sandbox' };
    }
    try {
      const { shell, args } = pickShell();
      const proc = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: opts.cols ?? 80,
        rows: opts.rows ?? 24,
        cwd: opts.cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
        } as { [key: string]: string },
        useConptyDll: false,
      } as pty.IWindowsPtyForkOptions & pty.IPtyForkOptions);

      const session: LiveSession = {
        proc,
        alive: true,
        cwd: opts.cwd,
        chatSessionId: opts.chatSessionId,
        sniffer: new PermissionSniffer(),
      };
      proc.onData((data: string) => {
        const w = this.win;
        if (w && !w.isDestroyed()) w.webContents.send(`pty:data:${opts.id}`, data);
        try {
          const hit = session.sniffer.feed(stripAnsi(data));
          if (hit && w && !w.isDestroyed()) {
            w.webContents.send('pty:permission', {
              id: `${opts.id}:${Date.now()}:${randomBytes(3).toString('hex')}`,
              ptyId: opts.id,
              chatSessionId: opts.chatSessionId ?? null,
              text: hit.text,
              kind: hit.kind,
            });
          }
        } catch {
          /* sniffer must never break the stream */
        }
      });
      proc.onExit(({ exitCode, signal }) => {
        session.alive = false;
        const w = this.win;
        if (w && !w.isDestroyed()) {
          w.webContents.send(`pty:exit:${opts.id}`, { exitCode, signal });
        }
        this.sessions.delete(opts.id);
      });
      this.sessions.set(opts.id, session);
      return { ok: true, pid: proc.pid, shell };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (s?.alive) s.proc.write(data);
  }

  respondPermission(ptyId: string, allow: boolean): boolean {
    const s = this.sessions.get(ptyId);
    if (!s?.alive) return false;
    try {
      s.proc.write(allow ? 'y\n' : 'n\n');
      return true;
    } catch {
      return false;
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s?.alive || s.proc.pid === undefined) return;
    try {
      s.proc.resize(Math.max(1, cols | 0), Math.max(1, rows | 0));
    } catch {
      /* exited between check and resize */
    }
  }

  async kill(id: string): Promise<{ ok: boolean; alreadyDead?: boolean; error?: string }> {
    const s = this.sessions.get(id);
    if (!s) return { ok: false, error: 'no such session' };
    if (!s.alive) return { ok: true, alreadyDead: true };
    return await new Promise((resolve) => {
      const sub = s.proc.onExit(() => {
        sub.dispose();
        resolve({ ok: true });
      });
      try {
        s.proc.kill();
      } catch {
        resolve({ ok: true });
      }
      setTimeout(() => resolve({ ok: true }), 2000);
    });
  }

  async killAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.kill(id)));
  }
}

export const ptyManager = new PtySessionManager();
