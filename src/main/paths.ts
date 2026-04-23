import { app } from 'electron';
import path from 'node:path';

export interface SidepadPaths {
  dataDir: string;
  dbPath: string;
}

let cached: SidepadPaths | null = null;

export function sidepadPaths(): SidepadPaths {
  if (cached) return cached;
  // Tests / e2e can override via env var. In normal app runs, electron's userData is used.
  const override = process.env.SIDEPAD_USER_DATA;
  const dataDir = override ?? app.getPath('userData');
  cached = { dataDir, dbPath: path.join(dataDir, 'sidepad.db') };
  return cached;
}

/** Test-only reset hook. */
export function _resetPathsCacheForTests() {
  cached = null;
}
