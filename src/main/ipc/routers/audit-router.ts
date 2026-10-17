import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { listAuditEvents } from '../../store/audit-store.js';

const t = initTRPC.create({ isServer: true });

function db(): Database.Database {
  const d = (globalThis as any).sidepad?.db as Database.Database | undefined;
  if (!d) throw new Error('database not available');
  return d;
}

export const auditRouter = t.router({
  list: t.procedure
    .input(
      z
        .object({
          sessionId: z.string().optional(),
          limit: z.number().int().positive().max(200).optional(),
        })
        .optional(),
    )
    .query(({ input }) => {
      return listAuditEvents(db(), {
        sessionId: input?.sessionId,
        limit: input?.limit,
      });
    }),

  exportMarkdown: t.procedure
    .input(
      z
        .object({
          sessionId: z.string().optional(),
          limit: z.number().int().positive().max(500).default(100),
        })
        .optional(),
    )
    .query(({ input }) => {
      const events = listAuditEvents(db(), {
        sessionId: input?.sessionId,
        limit: input?.limit ?? 100,
      });
      const lines = [
        '# Audit log',
        '',
        `- Exported: ${new Date().toISOString()}`,
        input?.sessionId ? `- Session: \`${input.sessionId}\`` : '- Scope: all sessions',
        `- Events: ${events.length}`,
        '',
      ];
      for (const ev of events) {
        lines.push(`## ${ev.kind} · ${new Date(ev.createdAt * 1000).toISOString()}`);
        lines.push('');
        lines.push(ev.summary);
        if (ev.sessionId) lines.push(`- session: \`${ev.sessionId}\``);
        if (ev.detail) {
          lines.push('```json');
          lines.push(JSON.stringify(ev.detail, null, 2).slice(0, 4000));
          lines.push('```');
        }
        lines.push('');
      }
      return lines.join('\n');
    }),
});
