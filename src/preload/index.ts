import { contextBridge, ipcRenderer } from 'electron'

// Sandboxed preload scripts can only load Electron's built-in modules.
// Keep the renderer-facing compatibility surface deliberately small.
const electron = {
  process: {
    versions: {
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? ''
    }
  }
}

const api = {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  startSession: () => ipcRenderer.invoke('session:start'),
  stopSession: () => ipcRenderer.invoke('session:stop'),
  replaySession: () => ipcRenderer.invoke('session:replay'),
  stopReplay: () => ipcRenderer.invoke('session:stopReplay'),
  saveProject: (project: unknown) => ipcRenderer.invoke('project:save', project),
  openProject: () => ipcRenderer.invoke('project:open'),
  listPorts: () => ipcRenderer.invoke('serial:list'),
  openPort: (options: unknown) => ipcRenderer.invoke('serial:open', options),
  closePort: (path: string) => ipcRenderer.invoke('serial:close', path),
  write: (path: string, base64: string) => ipcRenderer.invoke('serial:write', path, base64),
  onData: (callback: (data: { path: string; chunks: Uint8Array[]; replay?: boolean }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { path: string; chunks: Uint8Array[]; replay?: boolean }
    ): void => callback(data)
    ipcRenderer.on('serial:data', listener)
    return () => ipcRenderer.removeListener('serial:data', listener)
  },
  onStatus: (callback: (status: { open: boolean; path: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: { open: boolean; path: string }
    ): void => callback(status)
    ipcRenderer.on('serial:status', listener)
    return () => ipcRenderer.removeListener('serial:status', listener)
  },
  onError: (callback: (error: { path: string; message: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      error: { path: string; message: string }
    ): void => callback(error)
    ipcRenderer.on('serial:error', listener)
    return () => ipcRenderer.removeListener('serial:error', listener)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electron)
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore injected global
  window.electron = electron
  // @ts-ignore injected global
  window.api = api
}
