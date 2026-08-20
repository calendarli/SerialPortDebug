import { memo, useEffect, useRef, useState } from 'react'
import { bytesToHex, convertSerialText } from '../serial-utils'
import type { CommandGroup, CrcMode, SavedCommand, TargetPortOption } from '../types'
import { evaluateGlobalPlaceholders } from '../scripts/group-globals'

type Props = {
  commands: SavedCommand[]
  setCommands: (value: SavedCommand[]) => void
  groups: CommandGroup[]
  setGroups: (value: CommandGroup[]) => void
  connected: boolean
  targetPorts: TargetPortOption[]
  onSend: (
    text: string,
    hex: boolean,
    crcMode?: CrcMode | null,
    targetPort?: string
  ) => Promise<boolean>
}
type Draft = {
  name: string
  template: string
  releaseTemplate: string
  hex: boolean
  autoSend: boolean
  autoSendInterval: number
  autoSendCount: number
  crcEnabled: boolean
  crcMode: CrcMode
  targetPort: string
  parameters: Array<{ id: string; byteLength: number }>
}
type Menu = { x: number; y: number; type: 'root' | 'group' | 'command'; id: number | null }
const emptyDraft = (): Draft => ({
  name: '',
  template: '',
  releaseTemplate: '',
  hex: false,
  autoSend: false,
  autoSendInterval: 1000,
  autoSendCount: 0,
  crcEnabled: false,
  crcMode: 'modbus',
  targetPort: '',
  parameters: []
})

type ParameterMode = SavedCommand['parameters'][number]['inputMode']

function convertNumericParameter(
  value: string,
  inputHex: boolean,
  outputHex: boolean,
  byteLength?: number
): string {
  const clean = value.trim()
  if (!clean) return ''
  if (inputHex ? !/^[0-9a-f]+$/i.test(clean) : !/^\d+$/.test(clean)) {
    throw new Error(inputHex ? 'HEX 参数只能包含 0-9、A-F' : 'DEC 参数只能输入十进制数字 0-9')
  }
  const numericValue = BigInt(inputHex ? `0x${clean}` : clean)
  if (byteLength) {
    const maximum = (1n << BigInt(byteLength * 8)) - 1n
    if (numericValue > maximum) {
      throw new Error(
        `${byteLength} 字节参数超出范围（HEX 最大 ${maximum
          .toString(16)
          .toUpperCase()
          .padStart(byteLength * 2, '0')}，DEC 最大 ${maximum.toString(10)}）`
      )
    }
  }
  const converted = numericValue.toString(outputHex ? 16 : 10).toUpperCase()
  if (!outputHex) return converted
  return converted.padStart(
    byteLength ? byteLength * 2 : converted.length + (converted.length % 2),
    '0'
  )
}

function convertParameterForCommand(
  value: string,
  mode: ParameterMode,
  outputHex: boolean,
  byteLength: number
): string {
  if (!value) return ''
  if (mode === 'ascii') return outputHex ? bytesToHex(new TextEncoder().encode(value)) : value
  return convertNumericParameter(value, mode === 'hex', outputHex, byteLength)
}

function convertParameterMode(value: string, from: ParameterMode, to: ParameterMode): string {
  if (!value || from === to) return value
  if (from === 'ascii' && to === 'hex') return convertSerialText(value, true).replace(/\s+/g, '')
  if (from === 'hex' && to === 'ascii') return convertSerialText(value, false)
  if (from === 'ascii' && to === 'dec') return convertNumericParameter(value, false, false)
  if (from === 'dec' && to === 'ascii') return value
  return convertNumericParameter(value, from === 'hex', to === 'hex')
}

function numericParameterFits(value: string, mode: ParameterMode, byteLength: number): boolean {
  if (!value || mode === 'ascii') return true
  if (mode === 'hex' ? !/^[0-9a-f]+$/i.test(value) : !/^\d+$/.test(value)) return false
  const numericValue = BigInt(mode === 'hex' ? `0x${value}` : value)
  return numericValue <= (1n << BigInt(byteLength * 8)) - 1n
}

function numericParameterPlaceholder(mode: ParameterMode, byteLength: number): string {
  if (mode === 'ascii') return 'ASCII 文本'
  const maximum = (1n << BigInt(byteLength * 8)) - 1n
  if (mode === 'dec') return `DEC 0-${maximum.toString(10)}`
  const hexMaximum = maximum
    .toString(16)
    .toUpperCase()
    .padStart(byteLength * 2, '0')
  return byteLength <= 4
    ? `HEX ${'0'.repeat(byteLength * 2)}-${hexMaximum}`
    : `HEX 最多 ${byteLength * 2} 位`
}

function buildCommand(
  command: SavedCommand,
  template = command.template,
  globals: Record<string, unknown> = {}
): string {
  const result = command.parameters.reduce((current, parameter) => {
    const value = convertParameterForCommand(
      parameter.value,
      parameter.inputMode,
      command.hex,
      parameter.byteLength
    )
    return current.replaceAll(`{{${parameter.id}}}`, value)
  }, template)
  const withGlobals = evaluateGlobalPlaceholders(result, globals, command.hex)
  return command.hex ? withGlobals : withGlobals.replace(/\\r/g, '\r').replace(/\\n/g, '\n')
}

export const CommandsPanel = memo(function CommandsPanel(props: Props): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [targetParentId, setTargetParentId] = useState<number | null>(null)
  const [editingCommandId, setEditingCommandId] = useState<number | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupTargetPort, setGroupTargetPort] = useState('')
  const [groupAutoLoop, setGroupAutoLoop] = useState(false)
  const [groupLoopDelay, setGroupLoopDelay] = useState(100)
  const [groupLoopCount, setGroupLoopCount] = useState(0)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [error, setError] = useState('')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [activeAutoSendIds, setActiveAutoSendIds] = useState<Set<number>>(new Set())
  const [activeGroupLoopIds, setActiveGroupLoopIds] = useState<Set<number>>(new Set())
  const autoSendCountsRef = useRef(new Map<number, number>())
  const groupLoopTokensRef = useRef(new Map<number, number>())
  const pressedCommandIdsRef = useRef(new Set<number>())
  const groupGlobalsRef = useRef(
    new Map(props.groups.map((group) => [group.id, { ...group.globals }]))
  )

  useEffect(() => {
    for (const group of props.groups)
      groupGlobalsRef.current.set(group.id, { ...group.globals })
    for (const id of groupGlobalsRef.current.keys())
      if (!props.groups.some((group) => group.id === id)) groupGlobalsRef.current.delete(id)
  }, [props.groups])

  const buildGroupedCommand = (command: SavedCommand, template = command.template): string => {
    const group = props.groups.find((item) => item.id === command.parentId)
    if (!group) return buildCommand(command, template)
    const globals = { ...(groupGlobalsRef.current.get(group.id) || group.globals) }
    const result = buildCommand(command, template, globals)
    if (JSON.stringify(globals) !== JSON.stringify(groupGlobalsRef.current.get(group.id))) {
      groupGlobalsRef.current.set(group.id, globals)
      props.setGroups(
        props.groups.map((item) => (item.id === group.id ? { ...item, globals } : item))
      )
    }
    return result
  }

  useEffect(() => {
    if (!props.connected) return
    let cancelled = false
    const timers = new Set<number>()
    for (const command of props.commands.filter(
      (item) => item.autoSend && activeAutoSendIds.has(item.id)
    )) {
      const period = Math.max(1, command.autoSendInterval)
      let nextDeadline = performance.now() + period
      const run = async (): Promise<void> => {
        try {
          const success = await props.onSend(
            buildGroupedCommand(command),
            command.hex,
            command.crcMode,
            command.targetPort
          )
          if (!success && !cancelled) {
            autoSendCountsRef.current.delete(command.id)
            setActiveAutoSendIds((current) => {
              const next = new Set(current)
              next.delete(command.id)
              return next
            })
            return
          }
          const completed = (autoSendCountsRef.current.get(command.id) || 0) + 1
          autoSendCountsRef.current.set(command.id, completed)
          if (command.autoSendCount > 0 && completed >= command.autoSendCount) {
            if (command.releaseTemplate) {
              await props.onSend(
                buildGroupedCommand(command, command.releaseTemplate),
                command.hex,
                command.crcMode,
                command.targetPort
              )
            }
            autoSendCountsRef.current.delete(command.id)
            setActiveAutoSendIds((current) => {
              const next = new Set(current)
              next.delete(command.id)
              return next
            })
            return
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
          autoSendCountsRef.current.delete(command.id)
          setActiveAutoSendIds((current) => {
            const next = new Set(current)
            next.delete(command.id)
            return next
          })
          return
        }
        if (!cancelled) {
          nextDeadline += period
          const now = performance.now()
          if (nextDeadline < now) nextDeadline = now
          const timer = window.setTimeout(
            () => {
              timers.delete(timer)
              void run()
            },
            Math.max(0, nextDeadline - now)
          )
          timers.add(timer)
        }
      }
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        void run()
      }, period)
      timers.add(timer)
    }
    return () => {
      cancelled = true
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [activeAutoSendIds, props.commands, props.connected, props.onSend])

  useEffect(() => {
    const close = (): void => setMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
    }
  }, [])

  useEffect(
    () => () => {
      for (const [id, token] of groupLoopTokensRef.current) {
        groupLoopTokensRef.current.set(id, token + 1)
      }
    },
    []
  )

  const update = (id: number, patch: Partial<SavedCommand>): void =>
    props.setCommands(
      props.commands.map((command) => (command.id === id ? { ...command, ...patch } : command))
    )
  const updateParameter = (
    command: SavedCommand,
    parameterId: string,
    patch: Partial<SavedCommand['parameters'][number]>
  ): void =>
    update(command.id, {
      parameters: command.parameters.map((parameter) =>
        parameter.id === parameterId ? { ...parameter, ...patch } : parameter
      )
    })
  const switchParameterMode = (
    command: SavedCommand,
    parameterId: string,
    inputMode: ParameterMode
  ): void => {
    const parameter = command.parameters.find((item) => item.id === parameterId)
    if (!parameter || parameter.inputMode === inputMode) return
    try {
      const value = convertParameterMode(parameter.value, parameter.inputMode, inputMode)
      if (!numericParameterFits(value, inputMode, parameter.byteLength)) {
        throw new Error(`${parameter.byteLength} 字节不足以保存当前参数值`)
      }
      updateParameter(command, parameterId, {
        inputMode,
        value
      })
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const sendCommand = async (command: SavedCommand): Promise<void> => {
    const isRunning = props.connected && activeAutoSendIds.has(command.id)
    if (command.autoSend && isRunning) {
      autoSendCountsRef.current.delete(command.id)
      setActiveAutoSendIds((current) => {
        const next = new Set(current)
        next.delete(command.id)
        return next
      })
      if (command.releaseTemplate) {
        try {
          await props.onSend(
            buildGroupedCommand(command, command.releaseTemplate),
            command.hex,
            command.crcMode,
            command.targetPort
          )
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }
      return
    }
    if (!props.connected) return setError('请先打开串口')
    try {
      setError('')
      const success = await props.onSend(
        buildGroupedCommand(command),
        command.hex,
        command.crcMode,
        command.targetPort
      )
      if (success && command.autoSend) {
        if (command.autoSendCount === 1) {
          if (command.releaseTemplate)
            await props.onSend(
              buildGroupedCommand(command, command.releaseTemplate),
              command.hex,
              command.crcMode,
              command.targetPort
            )
        } else {
          autoSendCountsRef.current.set(command.id, 1)
          setActiveAutoSendIds((current) => new Set(current).add(command.id))
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const pressCommand = async (command: SavedCommand): Promise<void> => {
    if (command.autoSend || pressedCommandIdsRef.current.has(command.id)) return
    if (!props.connected) return setError('请先打开串口')
    pressedCommandIdsRef.current.add(command.id)
    try {
      setError('')
      const success = await props.onSend(
        buildGroupedCommand(command),
        command.hex,
        command.crcMode,
        command.targetPort
      )
      if (!success) pressedCommandIdsRef.current.delete(command.id)
    } catch (cause) {
      pressedCommandIdsRef.current.delete(command.id)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const releaseCommand = async (command: SavedCommand): Promise<void> => {
    if (command.autoSend || !pressedCommandIdsRef.current.delete(command.id)) return
    if (!command.releaseTemplate) return
    try {
      await props.onSend(
        buildGroupedCommand(command, command.releaseTemplate),
        command.hex,
        command.crcMode,
        command.targetPort
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const openMenu = (event: React.MouseEvent, type: Menu['type'], id: number | null): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 170),
      y: Math.min(event.clientY, window.innerHeight - 150),
      type,
      id
    })
  }
  const openCommandCreator = (parentId: number | null): void => {
    setEditingCommandId(null)
    setTargetParentId(parentId)
    setDraft({ ...emptyDraft(), targetPort: props.targetPorts[0]?.path || '' })
    setError('')
    setCreating(true)
    setMenu(null)
  }
  const openCommandEditor = (id: number): void => {
    const command = props.commands.find((item) => item.id === id)
    if (!command) return
    setEditingCommandId(id)
    setTargetParentId(command.parentId)
    setDraft({
      name: command.name,
      template: command.template,
      releaseTemplate: command.releaseTemplate || '',
      hex: command.hex,
      autoSend: command.autoSend,
      autoSendInterval: command.autoSendInterval,
      autoSendCount: command.autoSendCount || 0,
      crcEnabled: Boolean(command.crcMode),
      crcMode: command.crcMode || 'modbus',
      targetPort: command.targetPort || props.targetPorts[0]?.path || '',
      parameters: command.parameters.map((parameter) => ({
        id: parameter.id,
        byteLength: parameter.byteLength || 1
      }))
    })
    setError('')
    setCreating(true)
    setMenu(null)
  }
  const openGroupCreator = (parentId: number | null): void => {
    setEditingGroupId(null)
    setTargetParentId(parentId)
    setGroupName('')
    setGroupTargetPort('')
    setGroupAutoLoop(false)
    setGroupLoopDelay(100)
    setGroupLoopCount(0)
    setError('')
    setCreatingGroup(true)
    setMenu(null)
  }
  const openGroupEditor = (id: number): void => {
    const group = props.groups.find((item) => item.id === id)
    if (!group) return
    setEditingGroupId(id)
    setTargetParentId(group.parentId)
    setGroupName(group.name)
    setGroupTargetPort('')
    setGroupAutoLoop(group.autoLoop)
    setGroupLoopDelay(group.loopDelay)
    setGroupLoopCount(group.loopCount)
    setError('')
    setCreatingGroup(true)
    setMenu(null)
  }
  const createGroup = (): void => {
    if (!groupName.trim()) return setError('请输入组名称')
    if (!Number.isInteger(groupLoopDelay) || groupLoopDelay < 1)
      return setError('组循环延迟不能小于 1ms')
    if (!Number.isInteger(groupLoopCount) || groupLoopCount < 0)
      return setError('组循环次数必须是大于或等于 0 的整数')
    if (editingGroupId !== null && activeGroupLoopIds.has(editingGroupId))
      stopGroupLoop(editingGroupId)
    if (editingGroupId === null)
      props.setGroups([
        ...props.groups,
        {
          id: Date.now(),
          parentId: targetParentId,
          name: groupName.trim(),
          autoLoop: groupAutoLoop,
          loopDelay: groupLoopDelay,
          loopCount: groupLoopCount,
          globals: {}
        }
      ])
    else
      props.setGroups(
        props.groups.map((group) =>
          group.id === editingGroupId
            ? {
                ...group,
                name: groupName.trim(),
                autoLoop: groupAutoLoop,
                loopDelay: groupLoopDelay,
                loopCount: groupLoopCount
              }
            : group
        )
      )
    if (editingGroupId !== null && groupTargetPort) {
      const groupIds = new Set(descendantGroupIds(editingGroupId))
      props.setCommands(
        props.commands.map((command) =>
          command.parentId !== null && groupIds.has(command.parentId)
            ? { ...command, targetPort: groupTargetPort }
            : command
        )
      )
    }
    setCreatingGroup(false)
    setEditingGroupId(null)
    setError('')
  }
  const createCommand = (): void => {
    if (!draft.name.trim()) return setError('请输入指令名称')
    if (!draft.template) return setError('请输入发送指令')
    if (!draft.targetPort) return setError('请选择目标端口')
    if (!Number.isFinite(draft.autoSendInterval) || draft.autoSendInterval < 1)
      return setError('自动发送周期不能小于 1ms')
    if (!Number.isInteger(draft.autoSendCount) || draft.autoSendCount < 0)
      return setError('自动发送次数必须是大于或等于 0 的整数')
    const definitions = draft.parameters
      .map((parameter) => ({ ...parameter, id: parameter.id.trim() }))
      .filter((parameter) => parameter.id)
    const ids = definitions.map((parameter) => parameter.id)
    if (ids.some((id) => /[{}]/.test(id))) return setError('参数名字不能包含花括号')
    if (new Set(ids).size !== ids.length) return setError('参数名字不能重复')
    if (
      definitions.some(
        (parameter) =>
          !Number.isInteger(parameter.byteLength) ||
          parameter.byteLength < 1 ||
          parameter.byteLength > 64
      )
    )
      return setError('参数字节数必须是 1-64 的整数')
    if (editingCommandId === null) {
      props.setCommands([
        ...props.commands,
        {
          id: Date.now(),
          parentId: targetParentId,
          name: draft.name.trim(),
          template: draft.template,
          releaseTemplate: draft.releaseTemplate,
          hex: draft.hex,
          autoSend: draft.autoSend,
          autoSendInterval: draft.autoSendInterval,
          autoSendCount: draft.autoSendCount,
          crcMode: draft.crcEnabled ? draft.crcMode : null,
          targetPort: draft.targetPort,
          parameters: definitions.map(({ id, byteLength }) => ({
            id,
            byteLength,
            value: '',
            inputMode: draft.hex ? 'hex' : 'ascii'
          }))
        }
      ])
    } else {
      const current = props.commands.find((command) => command.id === editingCommandId)
      if (!current) return setError('要编辑的指令不存在')
      const parameters = definitions.map(({ id, byteLength }) => {
        const existing = current.parameters.find((parameter) => parameter.id === id)
        return existing
          ? { ...existing, byteLength }
          : {
              id,
              byteLength,
              value: '',
              inputMode: draft.hex ? ('hex' as const) : ('ascii' as const)
            }
      })
      props.setCommands(
        props.commands.map((command) =>
          command.id === editingCommandId
            ? {
                ...command,
                name: draft.name.trim(),
                template: draft.template,
                releaseTemplate: draft.releaseTemplate,
                hex: draft.hex,
                autoSend: draft.autoSend,
                autoSendInterval: draft.autoSendInterval,
                autoSendCount: draft.autoSendCount,
                crcMode: draft.crcEnabled ? draft.crcMode : null,
                targetPort: draft.targetPort,
                parameters
              }
            : command
        )
      )
    }
    setCreating(false)
    setEditingCommandId(null)
    setError('')
  }
  const descendantGroupIds = (id: number): number[] => {
    const children = props.groups
      .filter((group) => group.parentId === id)
      .flatMap((group) => descendantGroupIds(group.id))
    return [id, ...children]
  }
  const deleteGroup = (id: number): void => {
    const ids = new Set(descendantGroupIds(id))
    ids.forEach((groupId) =>
      groupLoopTokensRef.current.set(groupId, (groupLoopTokensRef.current.get(groupId) || 0) + 1)
    )
    setActiveGroupLoopIds((current) => new Set([...current].filter((groupId) => !ids.has(groupId))))
    props.setGroups(props.groups.filter((group) => !ids.has(group.id)))
    props.setCommands(
      props.commands.filter((command) => command.parentId === null || !ids.has(command.parentId))
    )
    setActiveAutoSendIds(
      (current) =>
        new Set(
          [...current].filter((commandId) => {
            const command = props.commands.find((item) => item.id === commandId)
            return command && (command.parentId === null || !ids.has(command.parentId))
          })
        )
    )
    setMenu(null)
  }
  const toggleGroup = (id: number): void =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const groupCommandCount = (id: number): number => {
    const directCount = props.commands.filter((command) => command.parentId === id).length
    return (
      directCount +
      props.groups
        .filter((group) => group.parentId === id)
        .reduce((total, group) => total + groupCommandCount(group.id), 0)
    )
  }
  const groupCommandsInOrder = (id: number): SavedCommand[] => [
    ...props.groups
      .filter((group) => group.parentId === id)
      .flatMap((group) => groupCommandsInOrder(group.id)),
    ...props.commands.filter((command) => command.parentId === id)
  ]
  const stopGroupLoop = (id: number): void => {
    groupLoopTokensRef.current.set(id, (groupLoopTokensRef.current.get(id) || 0) + 1)
    setActiveGroupLoopIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }
  const toggleGroupLoop = (group: CommandGroup): void => {
    if (activeGroupLoopIds.has(group.id)) return stopGroupLoop(group.id)
    if (!props.connected) return setError('请先打开串口')
    const commands = groupCommandsInOrder(group.id)
    if (!commands.length) return setError('当前组及子组内没有可发送的指令')
    const token = (groupLoopTokensRef.current.get(group.id) || 0) + 1
    groupLoopTokensRef.current.set(group.id, token)
    setActiveGroupLoopIds((current) => new Set(current).add(group.id))
    setError('')
    const run = async (): Promise<void> => {
      let completedLoops = 0
      while (
        groupLoopTokensRef.current.get(group.id) === token &&
        (group.loopCount === 0 || completedLoops < group.loopCount)
      ) {
        for (let index = 0; index < commands.length; index += 1) {
          if (groupLoopTokensRef.current.get(group.id) !== token) return
          const command = commands[index]
          try {
            const success = await props.onSend(
              buildGroupedCommand(command),
              command.hex,
              command.crcMode,
              command.targetPort
            )
            if (!success) return stopGroupLoop(group.id)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause))
            return stopGroupLoop(group.id)
          }
          const isLastSend =
            group.loopCount > 0 &&
            completedLoops + 1 >= group.loopCount &&
            index === commands.length - 1
          if (!isLastSend) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, group.loopDelay))
          }
        }
        completedLoops += 1
      }
      if (groupLoopTokensRef.current.get(group.id) === token) stopGroupLoop(group.id)
    }
    void run()
  }
  const copyPlaceholder = async (id: string, index: number): Promise<void> => {
    if (!id.trim()) return
    try {
      await navigator.clipboard.writeText(`{{${id.trim()}}}`)
      setCopiedIndex(index)
      window.setTimeout(() => setCopiedIndex(null), 1200)
    } catch {
      setError('复制失败，请检查剪贴板权限')
    }
  }
  const renderCommand = (command: SavedCommand): React.JSX.Element => (
    <section
      className="command-item"
      key={`command-${command.id}`}
      onContextMenu={(event) => openMenu(event, 'command', command.id)}
    >
      <div
        className="command-head"
        title={
          command.releaseTemplate
            ? `按下：${command.template}\n抬起：${command.releaseTemplate}`
            : command.template
        }
      >
        <div>
          <strong>{command.name}</strong>
          <span className={`format-badge ${command.hex ? 'hex' : ''}`}>
            {command.hex ? 'HEX' : 'ASCII'}
          </span>
          <span className="port-badge">{command.targetPort || '未指定端口'}</span>
          {command.crcMode && (
            <span className="crc-badge">
              {command.crcMode === 'modbus' ? 'CRC-16/MODBUS' : command.crcMode.toUpperCase()}
            </span>
          )}
          {command.autoSend && (
            <span
              className={`auto-send-badge ${props.connected && activeAutoSendIds.has(command.id) ? 'running' : ''}`}
            >
              {props.connected && activeAutoSendIds.has(command.id)
                ? '发送中'
                : `自动 ${command.autoSendInterval}ms / ${command.autoSendCount === 0 ? '∞' : `${command.autoSendCount}次`}`}
            </span>
          )}
        </div>
        <button
          className={`command-send ${props.connected && activeAutoSendIds.has(command.id) ? 'stop' : ''}`}
          onPointerDown={(event) => {
            if (command.autoSend) return
            event.currentTarget.setPointerCapture(event.pointerId)
            void pressCommand(command)
          }}
          onPointerUp={(event) => {
            if (command.autoSend) return
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
            void releaseCommand(command)
          }}
          onPointerCancel={() => void releaseCommand(command)}
          onKeyDown={(event) => {
            if (!command.autoSend && !event.repeat && (event.key === 'Enter' || event.key === ' '))
              void pressCommand(command)
          }}
          onKeyUp={(event) => {
            if (!command.autoSend && (event.key === 'Enter' || event.key === ' '))
              void releaseCommand(command)
          }}
          onClick={() => {
            if (command.autoSend) void sendCommand(command)
          }}
        >
          {command.autoSend
            ? props.connected && activeAutoSendIds.has(command.id)
              ? '停止'
              : '启动'
            : command.releaseTemplate
              ? '按住发送'
              : '发送'}
        </button>
      </div>
      {command.parameters.map((parameter) => (
        <div className="command-parameter" key={parameter.id}>
          <label>
            <span>
              {parameter.id} · {parameter.byteLength} 字节
            </span>
            <input
              inputMode={parameter.inputMode === 'dec' ? 'numeric' : 'text'}
              maxLength={parameter.inputMode === 'hex' ? parameter.byteLength * 2 : undefined}
              value={parameter.value}
              placeholder={numericParameterPlaceholder(parameter.inputMode, parameter.byteLength)}
              onChange={(event) => {
                const value = event.target.value
                if (numericParameterFits(value, parameter.inputMode, parameter.byteLength))
                  updateParameter(command, parameter.id, {
                    value: parameter.inputMode === 'hex' ? value.toUpperCase() : value
                  })
              }}
            />
          </label>
          <select
            className="parameter-mode-select"
            aria-label={`${parameter.id} 参数格式`}
            value={parameter.inputMode}
            onChange={(event) =>
              switchParameterMode(command, parameter.id, event.target.value as ParameterMode)
            }
          >
            <option value="ascii">ASCII</option>
            <option value="dec">DEC</option>
            <option value="hex">HEX</option>
          </select>
        </div>
      ))}
    </section>
  )
  const renderLevel = (parentId: number | null, depth = 0): React.JSX.Element[] => {
    const nodes: React.JSX.Element[] = []
    for (const group of props.groups.filter((item) => item.parentId === parentId)) {
      const isCollapsed = collapsed.has(group.id)
      nodes.push(
        <section
          className={`command-group ${depth === 0 ? 'root-group' : 'nested-group'}`}
          key={`group-${group.id}`}
          style={{ '--tree-depth': depth } as React.CSSProperties}
          onContextMenu={(event) => openMenu(event, 'group', group.id)}
        >
          <div className="group-title-row">
            <button className="group-title" onClick={() => toggleGroup(group.id)}>
              <span className="group-arrow">{isCollapsed ? '▸' : '▾'}</span>
              <b className="folder-icon">▰</b>
              <strong>{group.name}</strong>
              <em>{groupCommandCount(group.id)} 条指令</em>
              <span className="group-global-badge">
                global · {Object.keys(group.globals).length}
              </span>
            </button>
            {group.autoLoop && (
              <button
                className={`group-loop-button ${activeGroupLoopIds.has(group.id) ? 'stop' : ''}`}
                onClick={() => toggleGroupLoop(group)}
              >
                {activeGroupLoopIds.has(group.id) ? '停止' : '循环'}
              </button>
            )}
          </div>
          {!isCollapsed && <div className="group-children">{renderLevel(group.id, depth + 1)}</div>}
        </section>
      )
    }
    nodes.push(
      ...props.commands.filter((command) => command.parentId === parentId).map(renderCommand)
    )
    return nodes
  }

  return (
    <div className="commands-panel" onContextMenu={(event) => openMenu(event, 'root', null)}>
      <div className="side-section-head">
        <div>
          <strong>快捷指令</strong>
          <small>右键新建组或指令</small>
        </div>
        <span>{props.commands.length} 条</span>
      </div>
      <div className="command-list">
        {renderLevel(null)}
        {!props.commands.length && !props.groups.length && (
          <div className="empty-rules">在空白处右键新建组或指令</div>
        )}
      </div>
      {error && !creating && !creatingGroup && <p className="side-error">{error}</p>}

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {menu.type !== 'command' && (
            <>
              <button onClick={() => openGroupCreator(menu.id)}>＋ 新建组</button>
              <button onClick={() => openCommandCreator(menu.id)}>›_ 新建指令</button>
            </>
          )}
          {menu.type === 'command' && (
            <>
              <button onClick={() => openCommandEditor(menu.id!)}>✎ 编辑指令</button>
              <div className="menu-separator" />
              <button
                className="danger"
                onClick={() => {
                  props.setCommands(props.commands.filter((item) => item.id !== menu.id))
                  setMenu(null)
                }}
              >
                删除当前指令
              </button>
            </>
          )}
          {menu.type === 'group' && (
            <>
              <button onClick={() => openGroupEditor(menu.id!)}>✎ 编辑组</button>
              <button
                onClick={() => {
                  props.setGroups(
                    props.groups.map((group) =>
                      group.id === menu.id ? { ...group, globals: {} } : group
                    )
                  )
                  setMenu(null)
                  setError('当前快捷指令组的 global 已重置')
                }}
              >
                ↻ 重置 global
              </button>
              <div className="menu-separator" />
              <button className="danger" onClick={() => deleteGroup(menu.id!)}>
                删除组及内容
              </button>
            </>
          )}
        </div>
      )}

      {creatingGroup && (
        <div className="modal-backdrop rule-create-backdrop">
          <div className="modal group-modal">
            <div className="modal-head">
              <div>
                <h2>{editingGroupId === null ? '新建指令组' : '编辑指令组'}</h2>
                <p>{editingGroupId === null ? '组内可继续创建子组和指令' : '修改当前组的名称'}</p>
              </div>
              <button onClick={() => setCreatingGroup(false)}>×</button>
            </div>
            <div className="create-rule-form">
              <label>
                组名称
                <input
                  autoFocus
                  value={groupName}
                  placeholder="例如：电机控制"
                  onChange={(event) => setGroupName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') createGroup()
                  }}
                />
              </label>
              <div className="command-auto-settings group-loop-settings">
                <label>
                  <input
                    type="checkbox"
                    checked={groupAutoLoop}
                    onChange={(event) => setGroupAutoLoop(event.target.checked)}
                  />
                  启用组自动循环
                </label>
                <div className={groupAutoLoop ? '' : 'disabled'}>
                  <input
                    aria-label="组内指令发送延迟"
                    type="number"
                    min="1"
                    disabled={!groupAutoLoop}
                    value={groupLoopDelay}
                    onChange={(event) => setGroupLoopDelay(Number(event.target.value))}
                  />
                  <span>ms 延迟</span>
                </div>
                <div className={groupAutoLoop ? '' : 'disabled'}>
                  <input
                    aria-label="组循环次数，0 表示无限"
                    type="number"
                    min="0"
                    disabled={!groupAutoLoop}
                    value={groupLoopCount}
                    onChange={(event) => setGroupLoopCount(Number(event.target.value))}
                  />
                  <span>次</span>
                </div>
              </div>
              <small className="group-loop-help">
                循环次数为 0 时持续循环，延迟作用于每两条指令之间
              </small>
              {editingGroupId !== null && (
                <label>
                  批量修改组内指令目标端口
                  <select
                    value={groupTargetPort}
                    onChange={(event) => setGroupTargetPort(event.target.value)}
                  >
                    <option value="">不修改</option>
                    {props.targetPorts.map((port) => (
                      <option key={port.path} value={port.path}>{port.name}（{port.path}）</option>
                    ))}
                  </select>
                  <small>保存后同时修改当前组及所有子组内的指令</small>
                </label>
              )}
              {error && <p className="form-error">{error}</p>}
            </div>
            <div className="modal-foot">
              <button className="cancel-button" onClick={() => setCreatingGroup(false)}>
                取消
              </button>
              <button onClick={createGroup}>
                {editingGroupId === null ? '创建组' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <div className="modal-backdrop rule-create-backdrop">
          <div className="modal create-rule-modal">
            <div className="modal-head">
              <div>
                <h2>{editingCommandId === null ? '新建快捷指令' : '编辑快捷指令'}</h2>
                <p>定义模板、参数及最终发送编码</p>
              </div>
              <button onClick={() => setCreating(false)}>×</button>
            </div>
            <div className="create-rule-form">
              <label>
                指令名称
                <input
                  autoFocus
                  value={draft.name}
                  placeholder="例如：设置 PID"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label>
                按下发送指令
                <textarea
                  value={draft.template}
                  placeholder={
                    draft.hex
                      ? '例如：01 06 {{目标值}}'
                      : '例如：PID {{比例参数}} {{积分参数}} {{微分参数}}\\r\\n'
                  }
                  onChange={(event) => setDraft({ ...draft, template: event.target.value })}
                />
                <small>
                  使用完整参数名字定位，例如 <code>{'{{目标速度}}'}</code>
                </small>
              </label>
              <div className="form-row">
                <span>收发编码</span>
                <div className="mini-segment">
                  <button
                    className={!draft.hex ? 'active' : ''}
                    onClick={() => setDraft({ ...draft, hex: false })}
                  >
                    ASCII
                  </button>
                  <button
                    className={draft.hex ? 'active' : ''}
                    onClick={() => setDraft({ ...draft, hex: true })}
                  >
                    HEX
                  </button>
                </div>
              </div>
              <label>
                抬起发送指令（可选）
                <textarea
                  className="command-release-input"
                  value={draft.releaseTemplate}
                  placeholder={draft.hex ? '例如：01 06 00 00' : '例如：STOP {{目标速度}}\\r\\n'}
                  onChange={(event) => setDraft({ ...draft, releaseTemplate: event.target.value })}
                />
                <small>普通指令按钮抬起时发送；自动发送停止或完成时发送一次</small>
              </label>
              <label>
                目标端口
                <select
                  value={draft.targetPort}
                  onChange={(event) => setDraft({ ...draft, targetPort: event.target.value })}
                >
                  <option value="">选择目标端口</option>
                  {props.targetPorts.map((port) => (
                    <option key={port.path} value={port.path}>{port.name}（{port.path}）</option>
                  ))}
                </select>
                <small>发送时该端口必须处于已打开状态</small>
              </label>
              <div className="command-crc-settings">
                <label>
                  <input
                    type="checkbox"
                    checked={draft.crcEnabled}
                    onChange={(event) => setDraft({ ...draft, crcEnabled: event.target.checked })}
                  />
                  尾部附加 CRC 校验
                </label>
                <select
                  disabled={!draft.crcEnabled}
                  value={draft.crcMode}
                  onChange={(event) =>
                    setDraft({ ...draft, crcMode: event.target.value as CrcMode })
                  }
                >
                  <option value="crc8">CRC-8</option>
                  <option value="modbus">CRC-16/MODBUS（低字节在前）</option>
                  <option value="ccitt-false">CRC-16/CCITT-FALSE</option>
                  <option value="xmodem">CRC-16/XMODEM</option>
                  <option value="crc32">CRC-32</option>
                </select>
              </div>
              <div className="command-auto-settings">
                <label>
                  <input
                    type="checkbox"
                    checked={draft.autoSend}
                    onChange={(event) => setDraft({ ...draft, autoSend: event.target.checked })}
                  />
                  允许自动发送（列表中点击启动）
                </label>
                <div className={draft.autoSend ? '' : 'disabled'}>
                  <input
                    type="number"
                    min="1"
                    disabled={!draft.autoSend}
                    value={draft.autoSendInterval}
                    onChange={(event) =>
                      setDraft({ ...draft, autoSendInterval: Number(event.target.value) })
                    }
                  />
                  <span>ms</span>
                </div>
                <div className={draft.autoSend ? '' : 'disabled'}>
                  <input
                    aria-label="自动发送次数，0 表示无限"
                    type="number"
                    min="0"
                    disabled={!draft.autoSend}
                    value={draft.autoSendCount}
                    onChange={(event) =>
                      setDraft({ ...draft, autoSendCount: Number(event.target.value) })
                    }
                  />
                  <span>次</span>
                </div>
              </div>
              <small className="auto-send-count-help">发送次数为 0 时持续发送，直到手动停止</small>
              <div className="parameter-editor">
                <div className="parameter-editor-head">
                  <span>参数名字与占用字节（支持中文，任意数量）</span>
                  <button
                    onClick={() =>
                      setDraft({
                        ...draft,
                        parameters: [...draft.parameters, { id: '', byteLength: 1 }]
                      })
                    }
                  >
                    ＋ 添加参数
                  </button>
                </div>
                {draft.parameters.map((parameter, index) => (
                  <div className="parameter-edit-row command-parameter-edit-row" key={index}>
                    <input
                      value={parameter.id}
                      placeholder="参数名字，例如 目标速度"
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          parameters: draft.parameters.map((value, itemIndex) =>
                            itemIndex === index ? { ...value, id: event.target.value } : value
                          )
                        })
                      }
                    />
                    <label className="parameter-byte-length">
                      <input
                        type="number"
                        min="1"
                        max="64"
                        value={parameter.byteLength}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            parameters: draft.parameters.map((value, itemIndex) =>
                              itemIndex === index
                                ? { ...value, byteLength: Number(event.target.value) }
                                : value
                            )
                          })
                        }
                      />
                      <span>字节</span>
                    </label>
                    <button
                      className="copy-placeholder"
                      disabled={!parameter.id.trim()}
                      onClick={() => void copyPlaceholder(parameter.id, index)}
                    >
                      {copiedIndex === index
                        ? '已复制'
                        : parameter.id.trim()
                          ? `{{${parameter.id.trim()}}}`
                          : '{{参数名字}}'}
                    </button>
                    <button
                      className="remove-parameter"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          parameters: draft.parameters.filter((_, itemIndex) => itemIndex !== index)
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                {draft.parameters.length > 0 && (
                  <small className="parameter-byte-help">
                    DEC/HEX 参数按无符号数限制范围；发送 HEX 指令时按大端顺序左侧补零，例如 2 字节
                    DEC 10 → 00 0A
                  </small>
                )}
              </div>
              {error && <p className="form-error">{error}</p>}
            </div>
            <div className="modal-foot">
              <button className="cancel-button" onClick={() => setCreating(false)}>
                取消
              </button>
              <button onClick={createCommand}>
                {editingCommandId === null ? '创建指令' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
