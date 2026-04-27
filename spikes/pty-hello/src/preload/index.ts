import { contextBridge, ipcRenderer } from 'electron'

export interface PtyApi {
  spawn(id: string): Promise<{ ok: boolean; pid?: number; shell?: string; error?: string }>
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): Promise<{ ok: boolean; alreadyDead?: boolean; error?: string }>
  onData(id: string, cb: (data: string) => void): () => void
  onExit(id: string, cb: (info: { exitCode: number; signal?: number }) => void): () => void
}

const api: PtyApi = {
  spawn: (id) => ipcRenderer.invoke('pty:spawn', id),
  write: (id, data) => ipcRenderer.send('pty:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: (id) => ipcRenderer.invoke('pty:kill', id),
  onData: (id, cb) => {
    const ch = `pty:data:${id}`
    const fn = (_e: Electron.IpcRendererEvent, data: string) => cb(data)
    ipcRenderer.on(ch, fn)
    return () => ipcRenderer.removeListener(ch, fn)
  },
  onExit: (id, cb) => {
    const ch = `pty:exit:${id}`
    const fn = (_e: Electron.IpcRendererEvent, info: { exitCode: number; signal?: number }) => cb(info)
    ipcRenderer.on(ch, fn)
    return () => ipcRenderer.removeListener(ch, fn)
  },
}

contextBridge.exposeInMainWorld('pty', api)
