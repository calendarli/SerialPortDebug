export type ScriptLanguage = 'javascript' | 'typescript'
export type ScriptDirection = 'send' | 'received' | 'all'
export type ScriptEncoding = 'ascii' | 'hex' | 'json' | 'bytes'
export type ScriptDisplayMode = 'append' | 'replace' | 'hidden'
export type ScriptFramingMode = 'chunk' | 'delimiter' | 'fixed' | 'header-footer' | 'idle'

export type ScriptFraming = {
  mode: ScriptFramingMode
  delimiter: string
  fixedLength: number
  header: string
  footer: string
  idleTimeout: number
}

export type SavedScript = {
  id: string
  name: string
  language: ScriptLanguage
  source: string
  compiledCode: string
  sourceHash: string
  enabled: boolean
  direction: ScriptDirection
  ports: string[]
  encoding: ScriptEncoding
  displayMode: ScriptDisplayMode
  framing: ScriptFraming
  createdAt: number
  updatedAt: number
}

export type ScriptMessageType = 'send' | 'received'
export type ScriptContext = {
  port: string
  encoding: ScriptEncoding
  timestamp: number
  byteLength: number
  scriptName: string
  direction: ScriptMessageType
  index: number
}

export type ScriptResult = {
  value?: unknown
  encoding?: ScriptEncoding
  display?: string
  tags?: string[]
  dropDisplay?: boolean
}

export type ScriptRunResult = ScriptResult | string | number[] | Record<string, unknown> | null

export const defaultScriptSource = `/**
 * value: 当前发送或接收的数据
 * msgType: "send" | "received"
 * index: 自动发送序号，普通收发为 0
 * context: 当前串口上下文
 */
/** @type {SerialHandler} */
const handleSerial = (value, msgType, index, context) => {
  if (msgType === 'received') {
    return {
      value,
      display: \`\${context.port}：\${String(value)}\`,
      tags: ['脚本']
    }
  }
  return value
}

execute(handleSerial)
`

export const defaultTypeScriptSource = defaultScriptSource.replace(
  '/** @type {SerialHandler} */\nconst handleSerial =',
  'const handleSerial: SerialHandler ='
)

export function createScript(language: ScriptLanguage = 'typescript'): SavedScript {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name: '新建脚本',
    language,
    source: language === 'javascript' ? defaultScriptSource : defaultTypeScriptSource,
    compiledCode: language === 'javascript' ? defaultScriptSource : '',
    sourceHash: '',
    enabled: false,
    direction: 'all',
    ports: [],
    encoding: 'hex',
    displayMode: 'append',
    framing: {
      mode: 'chunk',
      delimiter: '\\n',
      fixedLength: 8,
      header: 'AA',
      footer: 'BB',
      idleTimeout: 20
    },
    createdAt: now,
    updatedAt: now
  }
}

export function normalizeScript(value: Partial<SavedScript>): SavedScript {
  const fallback = createScript(value.language === 'javascript' ? 'javascript' : 'typescript')
  return {
    ...fallback,
    ...value,
    id: typeof value.id === 'string' && value.id ? value.id : fallback.id,
    name: typeof value.name === 'string' && value.name ? value.name : fallback.name,
    source: typeof value.source === 'string' ? value.source : fallback.source,
    compiledCode: typeof value.compiledCode === 'string' ? value.compiledCode : '',
    ports: Array.isArray(value.ports) ? value.ports.filter((port) => typeof port === 'string') : [],
    framing: { ...fallback.framing, ...(value.framing || {}) }
  }
}
