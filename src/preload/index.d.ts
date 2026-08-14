import { ElectronAPI } from '@electron-toolkit/preload'

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
    electron: ElectronAPI
    api: {
      listPorts(): Promise<SerialPortInfo[]>
      openPort(options: SerialOptions): Promise<boolean>
      closePort(path: string): Promise<void>
      write(path: string, base64: string): Promise<number>
      onData(callback: (data: { path: string; base64: string }) => void): () => void
      onStatus(callback: (status: { open: boolean; path: string }) => void): () => void
      onError(callback: (error: { path: string; message: string }) => void): () => void
    }
  }
}
