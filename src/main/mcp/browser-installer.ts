import { app } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { sidepadPaths } from '../paths.js';

const requireFromHere = createRequire(import.meta.url);

export function getBrowsersPath(): string {
  // Prefer Electron's userData (real app run); fall back to sidepadPaths()
  // for tests / non-electron contexts.
  try {
    return path.join(app.getPath('userData'), 'playwright-browsers');
  } catch {
    return path.join(sidepadPaths().dataDir, 'playwright-browsers');
  }
}

/**
 * True iff the browsers dir exists AND contains at least one `chromium-*`
 * subdir. Playwright lays out browsers as `<root>/chromium-<rev>/...`.
 */
export function isChromiumInstalled(): boolean {
  const root = getBrowsersPath();
  if (!fs.existsSync(root)) return false;
  try {
    const entries = fs.readdirSync(root);
    return entries.some((e) => e.startsWith('chromium-'));
  } catch {
    return false;
  }
}

export interface InstallResult {
  ok: boolean;
  code: number;
  error?: string;
}

/**
 * Install Playwright Chromium into the user's data dir without relying on
 * `npx`. We re-invoke the Electron binary with `ELECTRON_RUN_AS_NODE=1`,
 * which makes it behave like a plain Node runtime — perfect for packaged
 * apps where there is no `npx` on PATH.
 */
export function installChromium(
  onProgress: (line: string) => void,
): Promise<InstallResult> {
  return new Promise<InstallResult>((resolve) => {
    let cliPath: string;
    try {
      cliPath = requireFromHere.resolve('playwright/cli.js');
    } catch (err) {
      resolve({
        ok: false,
        code: -1,
        error: `Could not resolve playwright/cli.js: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const browsersPath = getBrowsersPath();
    try {
      fs.mkdirSync(browsersPath, { recursive: true });
    } catch {
      /* best-effort */
    }

    const env = {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath,
      ELECTRON_RUN_AS_NODE: '1',
    };

    let child;
    try {
      child = spawn(process.execPath, [cliPath, 'install', 'chromium'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({
        ok: false,
        code: -1,
        error: `Failed to spawn installer: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const emitChunks = (buf: Buffer) => {
      const text = buf.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) onProgress(line);
      }
    };

    child.stdout?.on('data', emitChunks);
    child.stderr?.on('data', emitChunks);

    let lastError: string | undefined;
    child.on('error', (err) => {
      lastError = err.message;
      onProgress(`[error] ${err.message}`);
    });

    child.on('close', (code) => {
      const exitCode = code ?? -1;
      resolve({
        ok: exitCode === 0,
        code: exitCode,
        error: exitCode === 0 ? undefined : lastError ?? `exited with code ${exitCode}`,
      });
    });
  });
}
