import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) =>
      key === 'userData' ? '/tmp/sidepad-test/userdata' : '',
    ),
  },
}));

import { sidepadPaths, _resetPathsCacheForTests } from '@main/paths';

describe('sidepadPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPathsCacheForTests();
  });

  it('returns dbPath under userData', () => {
    expect(sidepadPaths().dbPath).toBe(
      path.join('/tmp/sidepad-test/userdata', 'sidepad.db'),
    );
  });

  it('returns dataDir = userData', () => {
    expect(sidepadPaths().dataDir).toBe('/tmp/sidepad-test/userdata');
  });

  it('caches the resolved object across calls', () => {
    const a = sidepadPaths();
    const b = sidepadPaths();
    expect(a).toBe(b);
  });

  it('honors SIDEPAD_USER_DATA env override', () => {
    _resetPathsCacheForTests();
    const old = process.env.SIDEPAD_USER_DATA;
    process.env.SIDEPAD_USER_DATA = '/tmp/sidepad-override';
    try {
      expect(sidepadPaths().dataDir).toBe('/tmp/sidepad-override');
    } finally {
      if (old === undefined) delete process.env.SIDEPAD_USER_DATA;
      else process.env.SIDEPAD_USER_DATA = old;
    }
  });
});
