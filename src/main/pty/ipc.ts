import { ipcMain, type BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { SessionStore } from '../store/session-store.js';
import { resolveProjectContext } from '../store/project-cwd.js';
import {
  parseSandboxMode,
  SANDBOX_SETTING_KEY,
  sandboxRoots,
} from '../sandbox/jail.js';
import { createAppSettingsStore } from '../store/app-settings-store.js';
import { appendAuditEvent } from '../store/audit-store.js';
import { ptyManager } from './session-manager.js';

function resolveSessionCwd(db: Database.Database, chatSessionId: string): {
  cwd: string;
  roots: string[];
} | { error: string } {
  const session = new SessionStore(db).getSession(chatSessionId);
  if (!session?.projectId) return { error: 'Link a project to this chat first' };
  const ctx = resolveProjectContext(db, session.projectId);
  if (!ctx?.cwd) return { error: 'Project has no working directory' };
  const sandboxOn =
    parseSandboxMode(createAppSettingsStore(db).getSetting(SANDBOX_SETTING_KEY)) === 'project';
  const roots = sandboxRoots(ctx.cwd, ctx.mounts.map((m) => m.path));
  if (sandboxOn && roots.length === 0) {
    return { error: 'Sandbox is on but no project roots are configured' };
  }
  return { cwd: ctx.cwd, roots: roots.length > 0 ? roots : [ctx.cwd] };
}

/** Register raw IPC channels for interactive PTY (high-frequency data path). */
export function registerPtyIpc(getDb: () => Database.Database, getWin: () => BrowserWindow | null): void {
  ptyManager.setWindow(getWin());

  ipcMain.handle(
    'pty:spawn',
    (_e, payload: { id: string; chatSessionId: string; cols?: number; rows?: number }) => {
      ptyManager.setWindow(getWin());
      const resolved = resolveSessionCwd(getDb(), payload.chatSessionId);
      if ('error' in resolved) return { ok: false as const, error: resolved.error };
      const result = ptyManager.spawn({
        id: payload.id,
        cwd: resolved.cwd,
        roots: resolved.roots,
        cols: payload.cols,
        rows: payload.rows,
      });
      if (result.ok) {
        try {
          appendAuditEvent(getDb(), {
            sessionId: payload.chatSessionId,
            kind: 'pty.spawn',
            summary: `Interactive shell @ ${resolved.cwd}`,
            detail: { ptyId: payload.id, cwd: resolved.cwd, shell: result.shell },
          });
        } catch {
          /* ignore */
        }
      }
      return result;
    },
  );

  ipcMain.on('pty:write', (_e, id: string, data: string) => {
    ptyManager.write(id, data);
  });

  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => {
    ptyManager.resize(id, cols, rows);
  });

  ipcMain.handle('pty:kill', async (_e, id: string) => ptyManager.kill(id));
}

export async function shutdownPtySessions(): Promise<void> {
  await ptyManager.killAll();
}
