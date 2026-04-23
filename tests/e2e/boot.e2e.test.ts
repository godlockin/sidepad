import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

test('app boots, IPC heartbeat reports ok, db file is created', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sidepad-e2e-'));
  const app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: { ...process.env, NODE_ENV: 'test', SIDEPAD_USER_DATA: userData },
  });
  const window = await app.firstWindow();
  await expect(window.locator('h1')).toHaveText('sidepad');
  await expect(window.locator('text=IPC ok')).toBeVisible({ timeout: 10_000 });

  const dbExists = fs.existsSync(path.join(userData, 'sidepad.db'));
  expect(dbExists).toBe(true);

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
});
