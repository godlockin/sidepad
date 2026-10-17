import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { SessionStore } from '../../store/session-store.js';
import { resolveProjectContext } from '../../store/project-cwd.js';
import {
  parseSandboxMode,
  SANDBOX_SETTING_KEY,
  sandboxRoots,
} from '../../sandbox/jail.js';
import { runPtyCommand } from '../../pty/exec.js';
import { appendAuditEvent } from '../../store/audit-store.js';
import { createAppSettingsStore } from '../../store/app-settings-store.js';

const t = initTRPC.create({ isServer: true });

function db(): Database.Database {
  const d = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!d) throw new Error('database not available');
  return d;
}

export const ptyRouter = t.router({
  /**
   * Run a sandboxed shell command in the session's project cwd.
   * Interactive node-pty + xterm remains in spikes/pty-hello; this is the in-app expert surface.
   */
  run: t.procedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        command: z.string().min(1).max(4000),
      }),
    )
    .mutation(async ({ input }) => {
      const session = new SessionStore(db()).getSession(input.sessionId);
      if (!session?.projectId) {
        return { ok: false as const, error: 'Link a project to this chat first' };
      }
      const ctx = resolveProjectContext(db(), session.projectId);
      if (!ctx?.cwd) {
        return { ok: false as const, error: 'Project has no working directory' };
      }
      const sandbox =
        parseSandboxMode(createAppSettingsStore(db()).getSetting(SANDBOX_SETTING_KEY)) === 'project';
      const roots = sandboxRoots(ctx.cwd, ctx.mounts.map((m) => m.path));
      if (sandbox && roots.length === 0) {
        return { ok: false as const, error: 'Sandbox is on but no project roots are configured' };
      }
      try {
        const result = await runPtyCommand({
          command: input.command,
          cwd: ctx.cwd,
          roots: roots.length > 0 ? roots : [ctx.cwd],
        });
        appendAuditEvent(db(), {
          sessionId: input.sessionId,
          kind: result.timedOut || (result.exitCode != null && result.exitCode !== 0) ? 'pty.error' : 'pty.exec',
          summary: `$ ${input.command.slice(0, 120)}`,
          detail: {
            cwd: ctx.cwd,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            outputPreview: result.output.slice(0, 2000),
          },
        });
        return {
          ok: true as const,
          cwd: ctx.cwd,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          output: result.output,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendAuditEvent(db(), {
          sessionId: input.sessionId,
          kind: 'pty.error',
          summary: `$ ${input.command.slice(0, 120)} — ${message}`,
          detail: { cwd: ctx.cwd },
        });
        return { ok: false as const, error: message };
      }
    }),
});
