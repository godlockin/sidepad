import { app, BrowserWindow, safeStorage } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createIPCHandler } from 'electron-trpc/main';
import { sidepadPaths } from './paths.js';
import { openSidepadDb } from './store/db.js';
import { SecretStore } from './secret/secret-store.js';
import { appRouter } from './ipc/trpc.js';
import { log } from './logger.js';

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
    (globalThis as any).sidepad = { db, secrets, paths };

    const win = new BrowserWindow({
      width: 1200, height: 800,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
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
