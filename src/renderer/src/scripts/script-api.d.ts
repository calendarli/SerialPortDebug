type ScriptMessageType = 'send' | 'received'
type ScriptEncoding = 'ascii' | 'hex' | 'json' | 'bytes'

interface SerialScriptContext {
  port: string
  encoding: ScriptEncoding
  timestamp: number
  byteLength: number
  scriptName: string
  direction: ScriptMessageType
  index: number
}

interface SerialScriptResult {
  value?: unknown
  encoding?: ScriptEncoding
  display?: string
  tags?: string[]
  dropDisplay?: boolean
}

type SerialHandler = (
  value: unknown,
  msgType: ScriptMessageType,
  index: number,
  context: SerialScriptContext
) => unknown | SerialScriptResult

declare function execute(handler: SerialHandler): void
