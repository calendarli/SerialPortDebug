import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReceivePanel } from './components/ReceivePanel'
import { AutoReplyPanel } from './components/AutoReplyPanel'
import { CommandsPanel } from './components/CommandsPanel'
import { SendPanel } from './components/SendPanel'
import { SerialConfigPanel } from './components/SerialConfigPanel'
import { Sidebar } from './components/Sidebar'
import {
  appendCrc,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  convertSerialText,
  encodeSerialData,
  formatTime
} from './serial-utils'
import type {
  CommandGroup,
  CrcMode,
  DataBits,
  InteractionEntry,
  Parity,
  Port,
  Rule,
  SavedCommand,
  SerialConfig,
  StopBits
} from './types'

const defaultRules: Rule[] = [
  {
    id: 1,
    name: 'AT 应答',
    pattern: '^AT$',
    reply: 'OK\\r\\n',
    hex: false,
    enabled: true,
    parameters: []
  }
]

function loadRules(): Rule[] {
  try {
    const saved = JSON.parse(localStorage.getItem('serialflow.autoReplyRules') || 'null') as
      Partial<Rule>[] | null
    if (!Array.isArray(saved)) return defaultRules
    return saved.map((rule, index) => ({
      id: typeof rule.id === 'number' ? rule.id : Date.now() + index,
      name: rule.name || `规则 ${index + 1}`,
      pattern: rule.pattern || '',
      regex: rule.regex !== false,
      receiveHex:
        typeof rule.receiveHex === 'boolean'
          ? rule.receiveHex
          : Boolean(rule.hex && /^(?:[0-9a-f]{2}\s*)+$/i.test(rule.pattern || '')),
      reply: rule.reply || '',
      hex: Boolean(rule.hex),
      enabled: rule.enabled !== false,
      targetPort: typeof rule.targetPort === 'string' ? rule.targetPort : '',
      parameters: Array.isArray(rule.parameters)
        ? rule.parameters
            .filter((item) => item?.id)
            .map((item) => ({ id: item.id, value: item.value || '' }))
        : []
    }))
  } catch {
    return defaultRules
  }
}

function inferParameterByteLength(parameter: SavedCommand['parameters'][number]): number {
  if (Number.isInteger(parameter.byteLength) && parameter.byteLength > 0)
    return Math.min(64, parameter.byteLength)
  const value = parameter.value?.trim()
  if (!value) return 1
  try {
    const mode = parameter.inputMode || (parameter.inputHex ? 'hex' : 'dec')
    if (mode === 'ascii') return 1
    if (mode === 'hex' && /^[0-9a-f]+$/i.test(value))
      return Math.min(64, Math.max(1, Math.ceil(value.length / 2)))
    if (mode === 'dec' && /^\d+$/.test(value)) {
      const numericValue = BigInt(value)
      return Math.min(64, Math.max(1, Math.ceil(numericValue.toString(2).length / 8)))
    }
  } catch {
    /* Keep the safe default for malformed legacy values. */
  }
  return 1
}

function loadCommands(): SavedCommand[] {
  try {
    const saved = JSON.parse(localStorage.getItem('serialflow.commands') || '[]') as SavedCommand[]
    return Array.isArray(saved)
      ? saved.map((command) => ({
          ...command,
          parentId: command.parentId ?? null,
          autoSend: Boolean(command.autoSend),
          autoSendInterval: Math.max(1, command.autoSendInterval || 1000),
          autoSendCount:
            Number.isInteger(command.autoSendCount) && command.autoSendCount >= 0
              ? command.autoSendCount
              : 0,
          crcMode: ['crc8', 'modbus', 'ccitt-false', 'xmodem', 'crc32'].includes(
            command.crcMode || ''
          )
            ? command.crcMode
            : null,
          targetPort: typeof command.targetPort === 'string' ? command.targetPort : '',
          parameters: Array.isArray(command.parameters)
            ? command.parameters.map((parameter) => ({
                ...parameter,
                inputMode: parameter.inputMode || (parameter.inputHex ? 'hex' : 'dec'),
                byteLength: inferParameterByteLength(parameter)
              }))
            : []
        }))
      : []
  } catch {
    return []
  }
}

function loadCommandGroups(): CommandGroup[] {
  try {
    const saved = JSON.parse(
      localStorage.getItem('serialflow.commandGroups') || '[]'
    ) as CommandGroup[]
    return Array.isArray(saved)
      ? saved.map((group) => ({
          ...group,
          parentId: group.parentId ?? null,
          autoLoop: Boolean(group.autoLoop),
          loopDelay: Math.max(1, group.loopDelay || 100),
          loopCount: Number.isInteger(group.loopCount) && group.loopCount >= 0 ? group.loopCount : 0
        }))
      : []
  } catch {
    return []
  }
}

function fillRuleParameters(rule: Rule): string {
  return rule.parameters.reduce(
    (template, parameter) => template.replaceAll(`{{${parameter.id}}}`, parameter.value),
    rule.reply
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function explainUiError(error: unknown, fallback = '操作失败，请重试'): string {
  let message = error instanceof Error ? error.message : String(error || '')
  message = message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error occurred in handler for '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return message || fallback
}

const sendPanelHeightKey = 'serialflow.sendPanelHeight'
function clampSendPanelHeight(value: number): number {
  const maximum = Math.max(160, window.innerHeight - 365)
  return Math.min(Math.max(Math.round(value), 160), maximum)
}
function loadSendPanelHeight(): number {
  const saved = Number(localStorage.getItem(sendPanelHeightKey))
  return clampSendPanelHeight(Number.isFinite(saved) && saved > 0 ? saved : 230)
}

const cacheSizeKey = 'serialflow.interactionCacheMb'
const cacheEntryKey = 'serialflow.interactionCacheEntries'
const interactionFontSizeKey = 'serialflow.interactionFontSize'
const receiveHexKey = 'serialflow.receiveHex'
const timestampKey = 'serialflow.timestamp'
const sendCrcEnabledKey = 'serialflow.sendCrcEnabled'
const sendCrcModeKey = 'serialflow.sendCrcMode'
const sendIntervalKey = 'serialflow.sendInterval'
const sendCountKey = 'serialflow.sendCount'
const autoPauseEnabledKey = 'serialflow.autoPauseEnabled'
const autoPausePatternKey = 'serialflow.autoPausePattern'
const autoPauseRegexKey = 'serialflow.autoPauseRegex'
const autoPauseHexKey = 'serialflow.autoPauseHex'
const serialConfigKey = 'serialflow.serialConfig'
const serialConfigsKey = 'serialflow.serialConfigs'
type PersistedSerialConfig = {
  path: string
  baudRate: number
  dataBits: DataBits
  stopBits: StopBits
  parity: Parity
}
function loadSerialConfig(): PersistedSerialConfig {
  const fallback: PersistedSerialConfig = {
    path: '',
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none'
  }
  try {
    const saved = JSON.parse(
      localStorage.getItem(serialConfigKey) || 'null'
    ) as Partial<PersistedSerialConfig> | null
    if (!saved) return fallback
    const dataBits = [5, 6, 7, 8].includes(Number(saved.dataBits))
      ? (saved.dataBits as DataBits)
      : fallback.dataBits
    let stopBits = [1, 1.5, 2].includes(Number(saved.stopBits))
      ? (saved.stopBits as StopBits)
      : fallback.stopBits
    if ((dataBits === 5 && stopBits === 2) || (dataBits !== 5 && stopBits === 1.5)) stopBits = 1
    const parity = ['none', 'even', 'odd', 'mark', 'space'].includes(String(saved.parity))
      ? (saved.parity as Parity)
      : fallback.parity
    const baudRate =
      Number.isInteger(saved.baudRate) && Number(saved.baudRate) > 0
        ? Number(saved.baudRate)
        : fallback.baudRate
    return {
      path: typeof saved.path === 'string' ? saved.path : '',
      baudRate,
      dataBits,
      stopBits,
      parity
    }
  } catch {
    return fallback
  }
}
function loadSerialConfigs(): SerialConfig[] {
  try {
    const saved = JSON.parse(localStorage.getItem(serialConfigsKey) || 'null') as
      SerialConfig[] | null
    if (Array.isArray(saved) && saved.length) {
      return saved.map((config, index) => ({
        ...config,
        id: Number(config.id) || Date.now() + index
      }))
    }
  } catch {
    /* Migrate the previous single-port setting below. */
  }
  return [{ id: Date.now(), ...loadSerialConfig() }]
}
function loadPositiveSetting(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}
function loadNonnegativeSetting(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key))
  return Number.isInteger(value) && value >= 0 ? value : fallback
}
function loadBooleanSetting(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key)
  return value === null ? fallback : value === 'true'
}
function loadCrcMode(): CrcMode {
  const saved = localStorage.getItem(sendCrcModeKey)
  return ['crc8', 'modbus', 'ccitt-false', 'xmodem', 'crc32'].includes(saved || '')
    ? (saved as CrcMode)
    : 'modbus'
}
function loadEntryLimit(): number {
  const saved = localStorage.getItem(cacheEntryKey)
  if (saved === null) return 5000
  const value = Number(saved)
  return Number.isFinite(value) && value >= 0 ? value : 5000
}
function trimInteractionEntries(
  entries: InteractionEntry[],
  maxBytes: number,
  maxEntries: number
): InteractionEntry[] {
  let start = entries.length
  let bytes = 0
  let count = 0
  const entryLimit = maxEntries === 0 ? Number.POSITIVE_INFINITY : maxEntries
  while (start > 0 && count < entryLimit) {
    const nextBytes = entries[start - 1].bytes
    if (count > 0 && bytes + nextBytes > maxBytes) break
    start -= 1
    count += 1
    bytes += nextBytes
  }
  return start === 0 ? entries : entries.slice(start)
}

function App(): React.JSX.Element {
  const [ports, setPorts] = useState<Port[]>([])
  const [serialConfigs, setSerialConfigs] = useState<SerialConfig[]>(loadSerialConfigs)
  const [openedPorts, setOpenedPorts] = useState<Set<string>>(new Set())
  const [sendPort, setSendPort] = useState('')
  const connected = openedPorts.size > 0
  const configuredPorts = useMemo(
    () => [...new Set(serialConfigs.map((config) => config.path).filter(Boolean))],
    [serialConfigs]
  )
  const openedPortList = useMemo(() => [...openedPorts], [openedPorts])
  const [connectionBusy, setConnectionBusy] = useState(false)
  const [rxHex, setRxHex] = useState(() => loadBooleanSetting(receiveHexKey, false))
  const [timestamp, setTimestamp] = useState(() => loadBooleanSetting(timestampKey, true))
  const [paused, setPaused] = useState(false)
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(() =>
    loadBooleanSetting(autoPauseEnabledKey, false)
  )
  const [autoPausePattern, setAutoPausePattern] = useState(
    () => localStorage.getItem(autoPausePatternKey) || ''
  )
  const [autoPauseRegex, setAutoPauseRegex] = useState(() =>
    loadBooleanSetting(autoPauseRegexKey, false)
  )
  const [autoPauseHex, setAutoPauseHex] = useState(() => loadBooleanSetting(autoPauseHexKey, true))
  const [interactionCache, setInteractionCache] = useState<{
    entries: InteractionEntry[]
    bytes: number
  }>({ entries: [], bytes: 0 })
  const [sendText, setSendText] = useState('')
  const [sendHex, setSendHex] = useState(false)
  const [appendCrlf, setAppendCrlf] = useState(false)
  const [sendCrcEnabled, setSendCrcEnabled] = useState(() =>
    loadBooleanSetting(sendCrcEnabledKey, false)
  )
  const [sendCrcMode, setSendCrcMode] = useState<CrcMode>(loadCrcMode)
  const [autoSend, setAutoSend] = useState(false)
  const [autoSendRunning, setAutoSendRunning] = useState(false)
  const [interval, setIntervalValue] = useState(() => loadPositiveSetting(sendIntervalKey, 1000))
  const [autoSendCount, setAutoSendCount] = useState(() => loadNonnegativeSetting(sendCountKey, 0))
  const [rules, setRules] = useState<Rule[]>(loadRules)
  const [commands, setCommands] = useState<SavedCommand[]>(loadCommands)
  const [commandGroups, setCommandGroups] = useState<CommandGroup[]>(loadCommandGroups)
  const [sideTab, setSideTab] = useState<'serial' | 'commands' | 'rules'>('serial')
  const [rxCount, setRxCount] = useState(0)
  const [txCount, setTxCount] = useState(0)
  const [rxCommunicationCount, setRxCommunicationCount] = useState(0)
  const [txCommunicationCount, setTxCommunicationCount] = useState(0)
  const [rxFrequency, setRxFrequency] = useState(0)
  const [txFrequency, setTxFrequency] = useState(0)
  const [message, setMessage] = useState('就绪')
  const [errorDialog, setErrorDialog] = useState<string | null>(null)
  const [sendPanelHeight, setSendPanelHeight] = useState(loadSendPanelHeight)
  const [interactionCacheMb, setInteractionCacheMb] = useState(() =>
    loadPositiveSetting(cacheSizeKey, 8)
  )
  const [interactionCacheEntries, setInteractionCacheEntries] = useState(loadEntryLimit)
  const [interactionFontSize, setInteractionFontSize] = useState(() =>
    Math.min(24, Math.max(8, loadPositiveSetting(interactionFontSizeKey, 10)))
  )
  const lineBuffers = useRef(new Map<string, string>())
  const hexBuffers = useRef(new Map<string, string>())
  const pauseLineBuffers = useRef(new Map<string, string>())
  const pauseHexBuffers = useRef(new Map<string, string>())
  const connectionBusyRef = useRef(false)
  const textDecoders = useRef(new Map<string, TextDecoder>())
  const entryIdRef = useRef(0)
  const pendingFrameRef = useRef<number | null>(null)
  const pendingInteractionsRef = useRef<{
    entries: InteractionEntry[]
    rxBytes: number
    txBytes: number
    rxEvents: number
    txEvents: number
  }>({ entries: [], rxBytes: 0, txBytes: 0, rxEvents: 0, txEvents: 0 })
  const trafficEventsRef = useRef({ rx: 0, tx: 0 })
  const frequencySampleRef = useRef({ rx: 0, tx: 0, time: 0 })
  const interactionSettingsRef = useRef({
    maxBytes: interactionCacheMb * 1024 * 1024,
    maxEntries: interactionCacheEntries,
    timestamp
  })
  const autoSendCompletedRef = useRef(0)

  useEffect(() => {
    interactionSettingsRef.current = {
      maxBytes: interactionCacheMb * 1024 * 1024,
      maxEntries: interactionCacheEntries,
      timestamp
    }
  }, [interactionCacheEntries, interactionCacheMb, timestamp])

  const showProblem = useCallback((problem: string): void => {
    setMessage(problem)
    setErrorDialog(problem)
  }, [])

  const showError = useCallback(
    (error: unknown, fallback: string): void => {
      showProblem(explainUiError(error, fallback))
    },
    [showProblem]
  )

  const flushInteractions = useCallback((): void => {
    pendingFrameRef.current = null
    const pending = pendingInteractionsRef.current
    pendingInteractionsRef.current = {
      entries: [],
      rxBytes: 0,
      txBytes: 0,
      rxEvents: 0,
      txEvents: 0
    }
    if (pending.rxBytes) setRxCount((count) => count + pending.rxBytes)
    if (pending.txBytes) setTxCount((count) => count + pending.txBytes)
    if (pending.rxEvents) setRxCommunicationCount((count) => count + pending.rxEvents)
    if (pending.txEvents) setTxCommunicationCount((count) => count + pending.txEvents)
    if (!pending.entries.length) return
    const addedBytes = pending.entries.reduce((total, entry) => total + entry.bytes, 0)
    setInteractionCache((current) => {
      const entries = [...current.entries, ...pending.entries]
      const settings = interactionSettingsRef.current
      let totalBytes = current.bytes + addedBytes
      let start = 0
      while (
        start < entries.length &&
        ((settings.maxEntries > 0 && entries.length - start > settings.maxEntries) ||
          totalBytes > settings.maxBytes)
      ) {
        totalBytes -= entries[start].bytes
        start += 1
      }
      return { entries: start ? entries.slice(start) : entries, bytes: totalBytes }
    })
  }, [])

  const queueInteraction = useCallback(
    (direction: 'rx' | 'tx', port: string, text: string, bytes: number, visible = true): void => {
      const pending = pendingInteractionsRef.current
      if (direction === 'rx') {
        pending.rxBytes += bytes
        pending.rxEvents += 1
        trafficEventsRef.current.rx += 1
      } else {
        pending.txBytes += bytes
        pending.txEvents += 1
        trafficEventsRef.current.tx += 1
      }
      if (visible) {
        pending.entries.push({
          id: ++entryIdRef.current,
          direction,
          port,
          text,
          bytes,
          time: interactionSettingsRef.current.timestamp ? formatTime() : undefined
        })
      }
      if (pendingFrameRef.current === null)
        pendingFrameRef.current = window.requestAnimationFrame(flushInteractions)
    },
    [flushInteractions]
  )

  const compiledRules = useMemo(
    () =>
      rules.flatMap((rule) => {
        if (!rule.enabled) return []
        try {
          const literal = rule.receiveHex
            ? rule.pattern.trim().replace(/\s+/g, ' ').toUpperCase()
            : rule.pattern
          const source = rule.regex === false ? `^${escapeRegExp(literal)}$` : rule.pattern
          return [{ rule, expression: new RegExp(source, 'm') }]
        } catch {
          return []
        }
      }),
    [rules]
  )
  const autoPauseExpression = useMemo(() => {
    if (!autoPauseEnabled || !autoPausePattern.trim()) return null
    try {
      const literal = autoPauseHex
        ? autoPausePattern.trim().replace(/\s+/g, ' ').toUpperCase()
        : autoPausePattern
      return new RegExp(autoPauseRegex ? autoPausePattern : `^${escapeRegExp(literal)}$`, 'm')
    } catch {
      return null
    }
  }, [autoPauseEnabled, autoPauseHex, autoPausePattern, autoPauseRegex])

  const refreshPorts = useCallback(async () => {
    try {
      const list = await window.api.listPorts()
      setPorts(list)
      setSerialConfigs((current) =>
        current.map((config, index) =>
          index === 0 && !config.path && list[0]?.path ? { ...config, path: list[0].path } : config
        )
      )
      setMessage(
        list.length
          ? `发现 ${list.length} 个串口`
          : '未发现串口设备，请检查 USB 连接、驱动安装和设备供电'
      )
    } catch (error) {
      showError(error, '刷新串口列表失败')
    }
  }, [showError])

  const send = useCallback(
    async (override?: {
      text: string
      hex: boolean
      crcMode?: CrcMode | null
      targetPort?: string
    }): Promise<boolean> => {
      const targetPort = override?.targetPort || sendPort
      if (!targetPort || !openedPorts.has(targetPort)) {
        showProblem(targetPort ? `目标串口 ${targetPort} 尚未打开` : '请选择一个已打开的发送串口')
        return false
      }
      try {
        const source = override?.text ?? sendText
        const effectiveHex = override?.hex ?? sendHex
        let bytes = encodeSerialData(source, effectiveHex)
        if (!override && appendCrlf) {
          const merged = new Uint8Array(bytes.length + 2)
          merged.set(bytes)
          merged.set(new Uint8Array([13, 10]), bytes.length)
          bytes = merged
        }
        const crcMode = override ? override.crcMode : sendCrcEnabled ? sendCrcMode : null
        if (crcMode) bytes = appendCrc(bytes, crcMode)
        if (!bytes.length) {
          showProblem('发送内容不能为空；如需发送换行，请启用“加回车换行”')
          return false
        }
        await window.api.write(targetPort, bytesToBase64(bytes))
        queueInteraction(
          'tx',
          targetPort,
          effectiveHex || crcMode ? bytesToHex(bytes) : new TextDecoder().decode(bytes),
          bytes.length
        )
        setMessage(`已通过 ${targetPort} 发送 ${bytes.length} 字节`)
        return true
      } catch (error) {
        showError(error, '发送失败')
        return false
      }
    },
    [
      appendCrlf,
      openedPorts,
      queueInteraction,
      sendPort,
      sendCrcEnabled,
      sendCrcMode,
      sendHex,
      sendText,
      showError,
      showProblem
    ]
  )
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  }, [send])
  const sendCommandData = useCallback(
    (text: string, hex: boolean, crcMode?: CrcMode | null, targetPort?: string): Promise<boolean> =>
      sendRef.current({ text, hex, crcMode, targetPort }),
    []
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshPorts(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshPorts])

  useEffect(() => {
    frequencySampleRef.current = { ...trafficEventsRef.current, time: performance.now() }
    const timer = window.setInterval(() => {
      const now = performance.now()
      const previous = frequencySampleRef.current
      const elapsedSeconds = Math.max((now - previous.time) / 1000, 0.001)
      const current = trafficEventsRef.current
      setRxFrequency((current.rx - previous.rx) / elapsedSeconds)
      setTxFrequency((current.tx - previous.tx) / elapsedSeconds)
      frequencySampleRef.current = { rx: current.rx, tx: current.tx, time: now }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const offData = window.api.onData(({ path: sourcePort, base64 }) => {
      const bytes = base64ToBytes(base64)
      let decoder = textDecoders.current.get(sourcePort)
      if (!decoder) {
        decoder = new TextDecoder()
        textDecoders.current.set(sourcePort, decoder)
      }
      const text = decoder.decode(bytes, { stream: true })
      const lineBuffer = ((lineBuffers.current.get(sourcePort) || '') + text).slice(-8192)
      lineBuffers.current.set(sourcePort, lineBuffer)
      const previousHex = hexBuffers.current.get(sourcePort) || ''
      const hexBuffer = `${previousHex}${previousHex ? ' ' : ''}${bytesToHex(bytes)}`
        .split(/\s+/)
        .slice(-8192)
        .join(' ')
      hexBuffers.current.set(sourcePort, hexBuffer)
      const pauseLineBuffer = ((pauseLineBuffers.current.get(sourcePort) || '') + text).slice(-8192)
      pauseLineBuffers.current.set(sourcePort, pauseLineBuffer)
      const previousPauseHex = pauseHexBuffers.current.get(sourcePort) || ''
      const pauseHexBuffer = `${previousPauseHex}${previousPauseHex ? ' ' : ''}${bytesToHex(bytes)}`
        .split(/\s+/)
        .slice(-8192)
        .join(' ')
      pauseHexBuffers.current.set(sourcePort, pauseHexBuffer)
      let shouldAutoPause = false
      if (!paused && autoPauseExpression) {
        const pauseCandidates = autoPauseHex
          ? [pauseHexBuffer, bytesToHex(bytes)]
          : [
              pauseLineBuffer,
              ...pauseLineBuffer.split(/\r?\n/).map((line) => line.replace(/\r$/, ''))
            ]
        shouldAutoPause = pauseCandidates.some((candidate) => {
          autoPauseExpression.lastIndex = 0
          return autoPauseExpression.test(candidate)
        })
      }
      for (const { rule, expression } of compiledRules) {
        if (rule.targetPort && rule.targetPort !== sourcePort) continue
        const candidates = rule.receiveHex
          ? [hexBuffer, bytesToHex(bytes)]
          : [lineBuffer, ...lineBuffer.split(/\r?\n/).map((line) => line.replace(/\r$/, ''))]
        const matched = candidates.some((candidate) => {
          expression.lastIndex = 0
          return expression.test(candidate)
        })
        if (matched) {
          lineBuffers.current.set(sourcePort, '')
          hexBuffers.current.set(sourcePort, '')
          const reply = fillRuleParameters(rule).replace(/\\r/g, '\r').replace(/\\n/g, '\n')
          void send({ text: reply, hex: rule.hex, targetPort: rule.targetPort || sourcePort })
          break
        }
      }
      const rendered = rxHex ? `${bytesToHex(bytes)} ` : text
      queueInteraction('rx', sourcePort, rendered, bytes.length, !paused)
      if (shouldAutoPause) {
        pauseLineBuffers.current.set(sourcePort, '')
        pauseHexBuffers.current.set(sourcePort, '')
        setPaused(true)
        setMessage(`已按条件自动暂停：${autoPausePattern}`)
      }
    })
    const offStatus = window.api.onStatus((status) => {
      setOpenedPorts((current) => {
        const next = new Set(current)
        if (status.open) next.add(status.path)
        else next.delete(status.path)
        return next
      })
      if (status.open) setSendPort((current) => current || status.path)
      else if (sendPort === status.path) {
        setSendPort('')
        setAutoSend(false)
        setAutoSendRunning(false)
      }
    })
    const offError = window.api.onError((error) =>
      showError(error.message, `${error.path} 串口通信异常`)
    )
    return () => {
      offData()
      offStatus()
      offError()
    }
  }, [
    autoPauseExpression,
    autoPauseHex,
    autoPausePattern,
    compiledRules,
    paused,
    queueInteraction,
    rxHex,
    send,
    sendPort,
    showError
  ])

  useEffect(() => {
    if (!autoSendRunning || !connected) return
    let cancelled = false
    let timer = 0
    const period = Math.max(1, interval)
    let nextDeadline = performance.now() + period
    const run = async (): Promise<void> => {
      const success = await send()
      if (!success) {
        setAutoSendRunning(false)
        return
      }
      autoSendCompletedRef.current += 1
      if (autoSendCount > 0 && autoSendCompletedRef.current >= autoSendCount) {
        setAutoSendRunning(false)
        setMessage(`自动发送已完成，共发送 ${autoSendCompletedRef.current} 次`)
        return
      }
      if (!cancelled) {
        nextDeadline += period
        const now = performance.now()
        if (nextDeadline < now) nextDeadline = now
        timer = window.setTimeout(() => void run(), Math.max(0, nextDeadline - now))
      }
    }
    timer = window.setTimeout(() => void run(), period)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [autoSendCount, autoSendRunning, connected, interval, send])

  const triggerSend = useCallback(async (): Promise<void> => {
    if (autoSend && autoSendRunning) {
      setAutoSendRunning(false)
      setMessage('已停止自动发送')
      return
    }
    const success = await send()
    if (success && autoSend) {
      autoSendCompletedRef.current = 1
      if (autoSendCount === 1) {
        setMessage('自动发送已完成，共发送 1 次')
        return
      }
      setAutoSendRunning(true)
      setMessage(
        `自动发送已启动，周期 ${Math.max(1, interval)}ms，${autoSendCount === 0 ? '无限次数' : `共 ${autoSendCount} 次`}`
      )
    }
  }, [autoSend, autoSendCount, autoSendRunning, interval, send])

  const changeAutoSend = useCallback((enabled: boolean): void => {
    setAutoSend(enabled)
    if (!enabled) setAutoSendRunning(false)
    setMessage(enabled ? '已启用自动发送，请点击“启动发送”开始' : '已关闭自动发送')
  }, [])

  useEffect(() => {
    localStorage.setItem('serialflow.autoReplyRules', JSON.stringify(rules))
  }, [rules])

  useEffect(() => {
    localStorage.setItem('serialflow.commands', JSON.stringify(commands))
  }, [commands])

  useEffect(() => {
    const resize = (): void => setSendPanelHeight((current) => clampSendPanelHeight(current))
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    localStorage.setItem('serialflow.commandGroups', JSON.stringify(commandGroups))
  }, [commandGroups])

  useEffect(() => {
    localStorage.setItem(sendIntervalKey, String(interval))
  }, [interval])

  useEffect(() => {
    localStorage.setItem(sendCountKey, String(autoSendCount))
  }, [autoSendCount])

  useEffect(() => {
    localStorage.setItem(receiveHexKey, String(rxHex))
  }, [rxHex])

  useEffect(() => {
    localStorage.setItem(timestampKey, String(timestamp))
  }, [timestamp])

  useEffect(() => {
    localStorage.setItem(sendCrcEnabledKey, String(sendCrcEnabled))
    localStorage.setItem(sendCrcModeKey, sendCrcMode)
  }, [sendCrcEnabled, sendCrcMode])

  useEffect(() => {
    localStorage.setItem(autoPauseEnabledKey, String(autoPauseEnabled))
    localStorage.setItem(autoPausePatternKey, autoPausePattern)
    localStorage.setItem(autoPauseRegexKey, String(autoPauseRegex))
    localStorage.setItem(autoPauseHexKey, String(autoPauseHex))
  }, [autoPauseEnabled, autoPauseHex, autoPausePattern, autoPauseRegex])

  useEffect(() => {
    localStorage.setItem(serialConfigsKey, JSON.stringify(serialConfigs))
  }, [serialConfigs])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault()
        void triggerSend()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [triggerSend])

  const updateSerialConfig = (id: number, patch: Partial<SerialConfig>): void => {
    setSerialConfigs((current) =>
      current.map((config) => (config.id === id ? { ...config, ...patch } : config))
    )
  }

  const addSerialConfig = (): void => {
    const unused = ports.find((port) => !serialConfigs.some((config) => config.path === port.path))
    setSerialConfigs((current) => [
      ...current,
      {
        id: Date.now(),
        path: unused?.path || '',
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none'
      }
    ])
  }

  const removeSerialConfig = (id: number): void => {
    setSerialConfigs((current) => current.filter((config) => config.id !== id))
  }

  const toggleConnection = async (config: SerialConfig): Promise<void> => {
    if (connectionBusyRef.current) return
    connectionBusyRef.current = true
    setConnectionBusy(true)
    const isOpen = openedPorts.has(config.path)
    try {
      if (isOpen) await window.api.closePort(config.path)
      else {
        if (!config.path) return showProblem('请选择串口；如果列表为空，请先点击刷新并检查设备连接')
        if (openedPorts.has(config.path)) return showProblem(`${config.path} 已经打开`)
        await window.api.openPort(config)
        setMessage(
          `已打开 ${config.path}（${config.baudRate} baud，${config.dataBits}${config.parity === 'none' ? 'N' : config.parity[0].toUpperCase()}${config.stopBits}）`
        )
      }
      if (isOpen) setMessage(`已断开 ${config.path}`)
    } catch (error) {
      showError(error, isOpen ? '断开串口失败' : '打开串口失败')
    } finally {
      connectionBusyRef.current = false
      setConnectionBusy(false)
    }
  }

  const changeDataBits = (config: SerialConfig, next: DataBits): void => {
    let nextStopBits = config.stopBits
    if (next === 5 && config.stopBits === 2) nextStopBits = 1.5
    if (next !== 5 && config.stopBits === 1.5) nextStopBits = 1
    updateSerialConfig(config.id, { dataBits: next, stopBits: nextStopBits })
  }

  const changeSendMode = (nextHex: boolean): void => {
    if (nextHex === sendHex) return
    try {
      setSendText((current) => convertSerialText(current, nextHex))
      setSendHex(nextHex)
      setMessage(nextHex ? '发送内容已转换为 HEX' : '发送内容已转换为 ASCII')
    } catch (error) {
      showError(error, '发送格式转换失败')
    }
  }

  const clearReceive = (): void => {
    pendingInteractionsRef.current = {
      entries: [],
      rxBytes: 0,
      txBytes: 0,
      rxEvents: 0,
      txEvents: 0
    }
    trafficEventsRef.current = { rx: 0, tx: 0 }
    frequencySampleRef.current = { rx: 0, tx: 0, time: performance.now() }
    setInteractionCache({ entries: [], bytes: 0 })
    setRxCount(0)
    setTxCount(0)
    setRxCommunicationCount(0)
    setTxCommunicationCount(0)
    setRxFrequency(0)
    setTxFrequency(0)
  }
  const changeInteractionCacheMb = (value: number): void => {
    const next = Math.min(1024, Math.max(1, Number.isFinite(value) ? Math.round(value) : 8))
    setInteractionCacheMb(next)
    localStorage.setItem(cacheSizeKey, String(next))
    setInteractionCache((current) => {
      const entries = trimInteractionEntries(
        current.entries,
        next * 1024 * 1024,
        interactionCacheEntries
      )
      return { entries, bytes: entries.reduce((total, entry) => total + entry.bytes, 0) }
    })
  }
  const changeInteractionEntryLimit = (value: number): void => {
    const next = Math.min(1_000_000, Math.max(0, Number.isFinite(value) ? Math.round(value) : 5000))
    setInteractionCacheEntries(next)
    localStorage.setItem(cacheEntryKey, String(next))
    setInteractionCache((current) => {
      const entries = trimInteractionEntries(
        current.entries,
        interactionCacheMb * 1024 * 1024,
        next
      )
      return { entries, bytes: entries.reduce((total, entry) => total + entry.bytes, 0) }
    })
  }
  const changeInteractionFontSize = (value: number): void => {
    const next = Math.min(24, Math.max(8, Math.round(value)))
    setInteractionFontSize(next)
    localStorage.setItem(interactionFontSizeKey, String(next))
  }

  return (
    <main className="app-shell">
      <header>
        <div className="brand">
          <span className="brand-icon">S</span>
          <div>
            <h1>SerialFlow</h1>
            <small>高速串口调试助手</small>
          </div>
        </div>
        <div className={`status ${connected ? 'online' : ''}`}>
          <i />
          {connected
            ? `已打开 ${openedPorts.size} 个串口：${[...openedPorts].join('、')}`
            : '未连接'}
        </div>
      </header>
      <section className="workspace">
        <Sidebar
          activeTab={sideTab}
          onTabChange={setSideTab}
          commandCount={commands.length}
          enabledRuleCount={rules.filter((rule) => rule.enabled).length}
          serialContent={
            <SerialConfigPanel
              ports={ports}
              configs={serialConfigs}
              openedPorts={openedPorts}
              busy={connectionBusy}
              onChange={updateSerialConfig}
              onAdd={addSerialConfig}
              onRemove={removeSerialConfig}
              onDataBitsChange={changeDataBits}
              onRefresh={() => void refreshPorts()}
              onToggle={(config) => void toggleConnection(config)}
            />
          }
          commandsContent={
            <CommandsPanel
              key={connected ? 'commands-connected' : 'commands-disconnected'}
              commands={commands}
              setCommands={setCommands}
              groups={commandGroups}
              setGroups={setCommandGroups}
              connected={connected}
              targetPorts={configuredPorts}
              onSend={sendCommandData}
            />
          }
          rulesContent={
            <AutoReplyPanel rules={rules} setRules={setRules} targetPorts={configuredPorts} />
          }
        />
        <section
          className="content"
          style={{ gridTemplateRows: `minmax(200px, 1fr) ${sendPanelHeight}px` }}
        >
          <ReceivePanel
            entries={interactionCache.entries}
            cacheBytes={interactionCache.bytes}
            rxHex={rxHex}
            rxCommunicationCount={rxCommunicationCount}
            txCommunicationCount={txCommunicationCount}
            rxFrequency={rxFrequency}
            txFrequency={txFrequency}
            timestamp={timestamp}
            paused={paused}
            autoPauseEnabled={autoPauseEnabled}
            autoPausePattern={autoPausePattern}
            autoPauseRegex={autoPauseRegex}
            autoPauseHex={autoPauseHex}
            cacheSizeMb={interactionCacheMb}
            cacheEntryLimit={interactionCacheEntries}
            fontSize={interactionFontSize}
            onClear={clearReceive}
            onRxHexChange={setRxHex}
            onTimestampChange={setTimestamp}
            onPausedChange={setPaused}
            onAutoPauseEnabledChange={setAutoPauseEnabled}
            onAutoPausePatternChange={setAutoPausePattern}
            onAutoPauseRegexChange={setAutoPauseRegex}
            onAutoPauseHexChange={setAutoPauseHex}
            onCacheSizeChange={changeInteractionCacheMb}
            onCacheEntryLimitChange={changeInteractionEntryLimit}
            onFontSizeChange={changeInteractionFontSize}
          />
          <SendPanel
            text={sendText}
            hex={sendHex}
            appendCrlf={appendCrlf}
            autoSend={autoSend}
            autoSendRunning={autoSendRunning}
            interval={interval}
            autoSendCount={autoSendCount}
            crcEnabled={sendCrcEnabled}
            crcMode={sendCrcMode}
            openedPorts={openedPortList}
            targetPort={sendPort}
            onTextChange={setSendText}
            onHexChange={changeSendMode}
            onAppendCrlfChange={setAppendCrlf}
            onAutoSendChange={changeAutoSend}
            onIntervalChange={setIntervalValue}
            onAutoSendCountChange={setAutoSendCount}
            onSend={() => void triggerSend()}
            onCrcEnabledChange={setSendCrcEnabled}
            onCrcModeChange={setSendCrcMode}
            onTargetPortChange={setSendPort}
            height={sendPanelHeight}
            onHeightChange={(value) => setSendPanelHeight(clampSendPanelHeight(value))}
            onHeightCommit={(value) => {
              const height = clampSendPanelHeight(value)
              setSendPanelHeight(height)
              localStorage.setItem(sendPanelHeightKey, String(height))
            }}
          />
        </section>
      </section>
      {errorDialog && (
        <div
          className="modal-backdrop app-error-backdrop"
          role="presentation"
          onPointerDown={() => setErrorDialog(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setErrorDialog(null)
          }}
        >
          <section
            className="app-error-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="app-error-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="app-error-icon">!</div>
            <div className="app-error-content">
              <h2 id="app-error-title">操作未完成</h2>
              <p>{errorDialog}</p>
            </div>
            <button className="app-error-close" title="关闭" onClick={() => setErrorDialog(null)}>
              ×
            </button>
            <div className="app-error-actions">
              <button autoFocus onClick={() => setErrorDialog(null)}>
                知道了
              </button>
            </div>
          </section>
        </div>
      )}
      <footer>
        <span>{message}</span>
        <div>
          <span className="rx">↓ RX {rxCount.toLocaleString()}</span>
          <span className="tx">↑ TX {txCount.toLocaleString()}</span>
        </div>
      </footer>
    </main>
  )
}

export default App
