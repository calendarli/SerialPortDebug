type SerialPortInfo = {
  path: string
  manufacturer?: string
  serialNumber?: string
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
      listPorts(): Promise<SerialPortInfo[]>
      openPort(options: SerialOptions): Promise<boolean>
      closePort(path: string): Promise<void>
      write(path: string, base64: string): Promise<number>
      onData(
        callback: (data: { path: string; chunks: Uint8Array[]; replay?: boolean }) => void
      ): () => void
      onStatus(callback: (status: { open: boolean; path: string }) => void): () => void
      onError(callback: (error: { path: string; message: string }) => void): () => void
    }
  }
}

export {}
