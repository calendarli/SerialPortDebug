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
  openModbusMap: () => ipcRenderer.invoke('modbus:openMap'),
  saveModbusMap: (config: unknown) => ipcRenderer.invoke('modbus:saveMap', config),
  listPorts: () => ipcRenderer.invoke('serial:list'),
  getVirtualPortStatus: () => ipcRenderer.invoke('virtualPorts:status'),
  createVirtualPortPair: (first: string, second: string) =>
    ipcRenderer.invoke('virtualPorts:create', first, second),
  removeVirtualPortPair: (first: string, second: string) =>
    ipcRenderer.invoke('virtualPorts:remove', first, second),
  openVirtualPortManager: () => ipcRenderer.invoke('virtualPorts:openManager'),
  installVirtualPortCertificate: () => ipcRenderer.invoke('virtualPorts:installCertificate'),
  openVirtualPortDownload: () => ipcRenderer.invoke('virtualPorts:openDownload'),
  selectTransferFile: () => ipcRenderer.invoke('fileTransfer:selectFile'),
  selectTransferDirectory: () => ipcRenderer.invoke('fileTransfer:selectDirectory'),
  setFileReceiver: (port: string, directory?: string) =>
    ipcRenderer.invoke('fileTransfer:setReceiver', port, directory),
  startFileTransfer: (port: string, filePath: string, chunkSize: number) =>
    ipcRenderer.invoke('fileTransfer:send', port, filePath, chunkSize),
  cancelFileTransfer: (taskId: string) => ipcRenderer.invoke('fileTransfer:cancel', taskId),
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
  },
  onFileTransferProgress: (callback: (progress: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown): void =>
      callback(progress)
    ipcRenderer.on('fileTransfer:progress', listener)
    return () => ipcRenderer.removeListener('fileTransfer:progress', listener)
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
