import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '@main/store/migrator';
import { _loadMigrationsFromFs } from '@main/store/db';
import { sessionRouter } from '@main/ipc/routers/session-router';
import { projectRouter } from '@main/ipc/routers/project-router';
import { randomUUID } from 'node:crypto';

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, _loadMigrationsFromFs());
  (globalThis as any).sidepad = { db };
});

describe('session governance (project + audit)', () => {
  it('setProject links and unlinks a project', async () => {
    const sessions = sessionRouter.createCaller({});
    const projects = projectRouter.createCaller({});
    const s = await sessions.create({ title: 't' });
    const p = await projects.create({ name: 'Work' });
    const linked = await sessions.setProject({ sessionId: s.id, projectId: p.id });
    expect(linked.projectId).toBe(p.id);
    const cleared = await sessions.setProject({ sessionId: s.id, projectId: null });
    expect(cleared.projectId).toBeNull();
  });

  it('exportAudit includes tokens, effort, and tool rows', async () => {
    const sessions = sessionRouter.createCaller({});
    const s = await sessions.create({ title: 'Audit me' });
    const db = (globalThis as any).sidepad.db as Database.Database;
    const now = Math.floor(Date.now() / 1000);
    const msgId = randomUUID();
    db.prepare(
      `INSERT INTO messages(id, session_id, turn_id, role, model_id, content, prompt_tokens, completion_tokens, status, meta_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      msgId,
      s.id,
      't1',
      'assistant',
      'gpt-4o',
      'hello',
      100,
      50,
      'done',
      JSON.stringify({ agentId: 'openai', effort: 'high' }),
      now,
    );
    db.prepare(
      `INSERT INTO mcp_tool_usage(id, message_id, server_id, tool_name, args_json, result_json, error, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(randomUUID(), msgId, 'bundled-web-search', 'web_search', '{"q":"x"}', '"ok"', null, Date.now());

    const md = await sessions.exportAudit({ sessionId: s.id, includeToolBodies: true });
    expect(md).toContain('Audit — Audit me');
    expect(md).toContain('effort: high');
    expect(md).toContain('100 in / 50 out');
    expect(md).toContain('web_search');
    expect(md).toContain('"q":"x"');
    expect(md).toContain('Tool invocations: 1');
  });
});
