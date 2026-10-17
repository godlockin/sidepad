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

import type { PtyApi } from '../shared/types/pty';

const ptyApi: PtyApi = {
  spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
  write: (id, data) => ipcRenderer.send('pty:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: (id) => ipcRenderer.invoke('pty:kill', id),
  onData: (id, cb) => {
    const ch = `pty:data:${id}`;
    const fn = (_e: Electron.IpcRendererEvent, data: string) => cb(data);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
  onExit: (id, cb) => {
    const ch = `pty:exit:${id}`;
    const fn = (_e: Electron.IpcRendererEvent, info: { exitCode: number; signal?: number }) =>
      cb(info);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
  onPermission: (cb) => {
    const fn = (_e: Electron.IpcRendererEvent, p: import('../shared/types/pty').PtyPermissionPayload) =>
      cb(p);
    ipcRenderer.on('pty:permission', fn);
    return () => ipcRenderer.removeListener('pty:permission', fn);
  },
  respondPermission: (ptyId, allow, chatSessionId) =>
    ipcRenderer.send('pty:permission:respond', { ptyId, allow, chatSessionId }),
};

contextBridge.exposeInMainWorld('pty', ptyApi);
