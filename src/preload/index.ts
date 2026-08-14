import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  listPorts: () => ipcRenderer.invoke('serial:list'),
  openPort: (options: unknown) => ipcRenderer.invoke('serial:open', options),
  closePort: (path: string) => ipcRenderer.invoke('serial:close', path),
  write: (path: string, base64: string) => ipcRenderer.invoke('serial:write', path, base64),
  onData: (callback: (data: { path: string; base64: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { path: string; base64: string }
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
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore injected global
  window.electron = electronAPI
  // @ts-ignore injected global
  window.api = api
}
