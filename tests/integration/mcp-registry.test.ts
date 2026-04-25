import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createMCPRegistry } from '@main/mcp/registry';
import type { MCPServerRecord } from '@main/store/mcp-store';

describe('mcp registry', () => {
  it('connects to stub server, lists tools, calls echo', async () => {
    const reg = createMCPRegistry();
    const rec: MCPServerRecord = {
      id: 's1',
      name: 'stub',
      transport: 'stdio',
      config: {
        command: 'node',
        args: [path.resolve('tests/fixtures/mcp-stub.mjs')],
      },
      enabled: true,
      createdAt: 0,
    };
    await reg.connect(rec);
    expect(reg.isConnected('s1')).toBe(true);

    const tools = await reg.listTools('s1');
    expect(tools.map((t) => t.name)).toContain('echo');

    const all = await reg.listAllTools();
    expect(all.find((t) => t.name === 'echo')?.serverId).toBe('s1');

    const result = await reg.callTool('s1', 'echo', { text: 'hi' });
    expect(JSON.stringify(result)).toContain('echo:hi');

    await reg.disconnect('s1');
    expect(reg.isConnected('s1')).toBe(false);
  }, 30_000);
});
