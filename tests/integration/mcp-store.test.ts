import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openSidepadDb } from '@main/store/db';
import { createMCPStore } from '@main/store/mcp-store';

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-mcpstore-'));
  dbPath = path.join(tmpDir, 'sidepad.db');
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('mcp-store', () => {
  it('CRUD on mcp_servers', () => {
    const db = openSidepadDb(dbPath);
    const store = createMCPStore(db);
    expect(store.list()).toHaveLength(0);

    const id = store.create({
      name: 'fs',
      transport: 'stdio',
      config: { command: 'npx', args: ['-y', '@mcp/server-fs'] },
      enabled: true,
    });

    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('fs');
    expect(list[0].transport).toBe('stdio');
    expect(list[0].enabled).toBe(true);
    expect(list[0].config).toEqual({ command: 'npx', args: ['-y', '@mcp/server-fs'] });

    const got = store.get(id)!;
    expect(got.id).toBe(id);

    store.setEnabled(id, false);
    expect(store.list()[0].enabled).toBe(false);

    store.update(id, { name: 'fs2', config: { command: 'true' } });
    const after = store.get(id)!;
    expect(after.name).toBe('fs2');
    expect(after.config).toEqual({ command: 'true' });

    store.remove(id);
    expect(store.list()).toHaveLength(0);
    db.close();
  });
});
