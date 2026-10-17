import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  isInsideRoot,
  jailToolArgs,
  parseSandboxMode,
  SandboxViolation,
  sandboxRoots,
} from '@main/sandbox/jail';

describe('sandbox jail', () => {
  const root = '/tmp/sidepad-proj';

  it('defaults sandbox to project', () => {
    expect(parseSandboxMode(undefined)).toBe('project');
    expect(parseSandboxMode('off')).toBe('off');
  });

  it('detects paths inside roots', () => {
    expect(isInsideRoot(root, join(root, 'src/a.ts'))).toBe(true);
    expect(isInsideRoot(root, '/etc/passwd')).toBe(false);
  });

  it('rewrites and jails relative paths', () => {
    const out = jailToolArgs({ path: 'readme.md', q: 1 }, [root], root);
    expect(out.path).toBe(join(root, 'readme.md'));
    expect(out.q).toBe(1);
  });

  it('rejects escape', () => {
    expect(() => jailToolArgs({ path: '../outside' }, [root], root)).toThrow(SandboxViolation);
  });

  it('builds unique roots from cwd and mounts', () => {
    expect(sandboxRoots(root, [root, '/tmp/mount'])).toEqual([root, '/tmp/mount']);
  });
});
