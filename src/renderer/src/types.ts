export type Port = { path: string; manufacturer?: string }
export type SerialConfig = {
  id: number
  path: string
  baudRate: number
  dataBits: DataBits
  stopBits: StopBits
  parity: Parity
  framing: SerialFraming
  plotEnabled: boolean
}

export type SerialFramingMode = 'raw' | 'delimiter' | 'fixed' | 'header-footer' | 'idle'
export type SerialFraming = {
  mode: SerialFramingMode
  delimiter: string
  fixedLength: number
  header: string
  footer: string
  idleTimeout: number
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
  parameters: Array<{ id: string; value: string; mode?: 'manual' | 'program' }>
  parameterMode?: 'parameters' | 'program'
  parameterProgram?: string
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
  releaseTemplate?: string
  hex: boolean
  autoSend: boolean
  autoSendInterval: number
  autoSendCount: number
  crcMode?: CrcMode | null
  targetPort?: string
  parameters: CommandParameter[]
}

export type CommandGroup = {
  id: number
  parentId: number | null
  name: string
  autoLoop: boolean
  loopDelay: number
  loopCount: number
}

export type InteractionEntry = {
  id: number
  direction: 'rx' | 'tx' | 'script'
  text: string
  plotText?: string
  timestampMs?: number
  bytes: number
  port: string
  time?: string
}

export type DataBits = 5 | 6 | 7 | 8
export type StopBits = 1 | 1.5 | 2
export type Parity = 'none' | 'even' | 'odd' | 'mark' | 'space'
