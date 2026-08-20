type SerialPortInfo = {
  path: string
  manufacturer?: string
  serialNumber?: string
  friendlyName?: string
  vendorId?: string
  productId?: string
}
type SerialOptions = {
  path: string
  baudRate: number
  dataBits: 5 | 6 | 7 | 8
  stopBits: 1 | 1.5 | 2
  parity: 'none' | 'even' | 'odd' | 'mark' | 'space'
}
type FileTransferProgress = {
  taskId: string
  direction: 'send' | 'receive'
  port: string
  fileName: string
  filePath?: string
  totalBytes: number
  transferredBytes: number
  state:
    'preparing' | 'waiting' | 'transferring' | 'verifying' | 'completed' | 'error' | 'cancelled'
  message: string
  retries: number
  startedAt: number
  bytesPerSecond: number
  protocol: 'serialflow' | 'raw'
}

declare global {
  interface Window {
    electron: {
      process: {
        versions: {
          electron: string
          chrome: string
          node: string
        }
      }
    }
    api: {
      getAppInfo(): Promise<{ version: string; platform: string; arch: string }>
      startSession(): Promise<{ path: string } | null>
      stopSession(): Promise<{ path: string; events: number; bytes: number } | null>
      replaySession(): Promise<{ path: string; events: number; stopped: boolean } | null>
      stopReplay(): Promise<void>
      saveProject(project: unknown): Promise<string | null>
      openProject(): Promise<{ path: string; content: string } | null>
      openModbusMap(): Promise<{ path: string; name: string; base64: string } | null>
      saveModbusMap(config: unknown): Promise<string | null>
      listPorts(): Promise<SerialPortInfo[]>
      getVirtualPortStatus(): Promise<{
        installed: boolean
        pairs: string[]
        occupiedPorts: string[]
        availablePorts: string[]
        commandPath?: string
        certificateAvailable: boolean
        certificateInstalled: boolean
        message?: string
      }>
      createVirtualPortPair(
        first: string,
        second: string
      ): Promise<{ first: string; second: string; output: string }>
      removeVirtualPortPair(first: string, second: string): Promise<string>
      openVirtualPortManager(): Promise<void>
      installVirtualPortCertificate(): Promise<string>
      openVirtualPortDownload(): Promise<void>
      selectTransferFile(): Promise<{ path: string; name: string; size: number } | null>
      selectTransferDirectory(): Promise<string | null>
      setFileReceiver(port: string, directory?: string): Promise<void>
      startFileTransfer(
        port: string,
        filePath: string,
        chunkSize: number,
        protocol: 'serialflow' | 'raw'
      ): Promise<string>
      cancelFileTransfer(taskId: string): Promise<void>
      openPort(options: SerialOptions): Promise<boolean>
      closePort(path: string): Promise<void>
      write(path: string, base64: string): Promise<number>
      onData(
        callback: (data: { path: string; chunks: Uint8Array[]; replay?: boolean }) => void
      ): () => void
      onStatus(callback: (status: { open: boolean; path: string }) => void): () => void
      onError(callback: (error: { path: string; message: string }) => void): () => void
      onFileTransferProgress(callback: (progress: FileTransferProgress) => void): () => void
    }
  }
}

export {}
