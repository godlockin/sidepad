// Note: electron-trpc 0.7.1 (latest stable) only exposes `./main` and `./renderer`
// subpaths. The plan's mandate to import from `electron-trpc/preload` is impossible
// with this version — the official 0.7.x docs use `electron-trpc/main` for both
// processes. Functionally identical at runtime (same exposeElectronTRPC fn).
//
// Loaded via CJS require (same reason as src/main/index.ts): electron-trpc 0.7.1's
// ESM bundle statically imports ipcMain/ipcRenderer/contextBridge from 'electron'.
// In each Electron context only a subset of those exists, so ESM strict checks
// crash module load. CJS named imports are lazy and only the touched fields fail.
import { contextBridge, ipcRenderer } from 'electron';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { exposeElectronTRPC } = require('electron-trpc/main') as typeof import('electron-trpc/main');

process.once('loaded', () => {
  exposeElectronTRPC();
});

contextBridge.exposeInMainWorld('cockpit', {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
});
