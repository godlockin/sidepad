import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPtyCommand } from '@main/pty/exec';

describe('runPtyCommand', () => {
  it('runs a short command in cwd', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sidepad-pty-'));
    const result = await runPtyCommand({
      command: process.platform === 'win32' ? 'echo hello' : 'echo hello',
      cwd,
      roots: [cwd],
    });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/hello/);
  });

  it('rejects cwd outside roots', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'sidepad-pty-'));
    await expect(
      runPtyCommand({ command: 'echo x', cwd, roots: ['/tmp/other-root-xyz'] }),
    ).rejects.toThrow(/outside/);
  });
});
