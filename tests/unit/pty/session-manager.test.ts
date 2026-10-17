import { describe, it, expect, vi } from 'vitest';

vi.mock('node-pty', () => {
  const handlers: Record<string, Function[]> = { data: [], exit: [] };
  return {
    spawn: vi.fn(() => ({
      pid: 4242,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(() => {
        for (const fn of handlers.exit) fn({ exitCode: 0 });
      }),
      onData: (fn: (d: string) => void) => {
        handlers.data.push(fn);
      },
      onExit: (fn: (info: { exitCode: number }) => void) => {
        handlers.exit.push(fn);
        return { dispose: () => {} };
      },
    })),
  };
});

import { PtySessionManager } from '@main/pty/session-manager';

describe('PtySessionManager', () => {
  it('rejects cwd outside roots', () => {
    const mgr = new PtySessionManager();
    const res = mgr.spawn({
      id: 't1',
      cwd: '/tmp/outside',
      roots: ['/tmp/project'],
    });
    expect(res.ok).toBe(false);
  });

  it('spawns when cwd is inside roots', () => {
    const mgr = new PtySessionManager();
    const res = mgr.spawn({
      id: 't2',
      cwd: '/tmp/project',
      roots: ['/tmp/project'],
    });
    expect(res).toMatchObject({ ok: true, pid: 4242 });
  });
});
