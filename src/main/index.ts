import { app, BrowserWindow, safeStorage } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { sidepadPaths } from './paths.js';
import { openSidepadDb } from './store/db.js';
import { SecretStore } from './secret/secret-store.js';
import { appRouter } from './ipc/trpc.js';
import { registry } from './providers/index.js';
import { loadProviders } from './providers/factory.js';
import { createMCPRegistry } from './mcp/registry.js';
import { log } from './logger.js';

// electron-trpc 0.7.1 ships a single ESM bundle that statically imports
// `ipcRenderer` from 'electron'. In Electron's main process those exports
// don't exist, so a top-level ESM `import` crashes on load. Resolve via CJS
// require — CJS named imports are lazy and the runtime usage path never
// touches ipcRenderer in the main process.
const require = createRequire(import.meta.url);
const { createIPCHandler } = require('electron-trpc/main') as typeof import('electron-trpc/main');

process.on('uncaughtException', (err) => {
  console.error('[main:uncaughtException]', err);
  log.error({ err: { message: err.message, stack: err.stack } }, 'uncaught exception');
});
process.on('unhandledRejection', (reason) => {
  console.error('[main:unhandledRejection]', reason);
  log.error({ reason: String(reason) }, 'unhandled rejection');
});

const __dirname = dirname(fileURLToPath(import.meta.url));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });

  app.whenReady().then(() => {
    const paths = sidepadPaths();
    log.info({ dbPath: paths.dbPath }, 'opening sidepad db');
    const db = openSidepadDb(paths.dbPath);
    const secrets = new SecretStore(db);
    log.info({ encryption: secrets.isEncryptionAvailable() }, 'secret store ready');

    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('safeStorage encryption unavailable — secrets will be stored in plaintext on this OS');
    }

    // expose to global for IPC routers in Task 11
    const mcp = createMCPRegistry();
    (globalThis as any).sidepad = { db, secrets, paths, mcp };

    // load configured providers
    loadProviders(db, secrets, registry);
    log.info({ count: registry.list().length }, 'providers loaded');

    const win = new BrowserWindow({
      width: 1200, height: 800,
      webPreferences: {
        preload: join(__dirname, '../preload/index.mjs'),
        contextIsolation: true,
        sandbox: false,
      },
    });
    createIPCHandler({ router: appRouter, windows: [win] });

    if (process.env.ELECTRON_RENDERER_URL) {
      win.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'));
    }

    app.on('before-quit', () => { try { db.close(); log.info('db closed'); } catch (e) { log.error(e); } });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
