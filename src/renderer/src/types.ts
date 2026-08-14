export type Port = { path: string; manufacturer?: string }
export type SerialConfig = {
  id: number
  path: string
  baudRate: number
  dataBits: DataBits
  stopBits: StopBits
  parity: Parity
}

export type Rule = {
  id: number
  name: string
  pattern: string
  regex?: boolean
  receiveHex?: boolean
  reply: string
  hex: boolean
  enabled: boolean
  targetPort?: string
  parameters: Array<{ id: string; value: string }>
}

export type CommandParameter = {
  id: string
  value: string
  inputMode: 'ascii' | 'dec' | 'hex'
  byteLength: number
  inputHex?: boolean
}
export type CrcMode = 'crc8' | 'modbus' | 'ccitt-false' | 'xmodem' | 'crc32'

export type SavedCommand = {
  id: number
  parentId: number | null
  name: string
  template: string
  hex: boolean
  autoSend: boolean
  autoSendInterval: number
  crcMode?: CrcMode | null
  targetPort?: string
  parameters: CommandParameter[]
}

export type CommandGroup = { id: number; parentId: number | null; name: string }

export type InteractionEntry = {
  id: number
  direction: 'rx' | 'tx'
  text: string
  bytes: number
  port: string
  time?: string
}

export type DataBits = 5 | 6 | 7 | 8
export type StopBits = 1 | 1.5 | 2
export type Parity = 'none' | 'even' | 'odd' | 'mark' | 'space'
