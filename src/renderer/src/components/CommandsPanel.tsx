import { memo, useEffect, useState } from 'react'
import { bytesToHex, convertSerialText } from '../serial-utils'
import type { CommandGroup, CrcMode, SavedCommand } from '../types'

type Props = {
  commands: SavedCommand[]
  setCommands: (value: SavedCommand[]) => void
  groups: CommandGroup[]
  setGroups: (value: CommandGroup[]) => void
  connected: boolean
  targetPorts: string[]
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
  hex: boolean
  autoSend: boolean
  autoSendInterval: number
  crcEnabled: boolean
  crcMode: CrcMode
  targetPort: string
  parameterIds: string[]
}
type Menu = { x: number; y: number; type: 'root' | 'group' | 'command'; id: number | null }
const emptyDraft = (): Draft => ({
  name: '',
  template: '',
  hex: false,
  autoSend: false,
  autoSendInterval: 1000,
  crcEnabled: false,
  crcMode: 'modbus',
  targetPort: '',
  parameterIds: []
})

type ParameterMode = SavedCommand['parameters'][number]['inputMode']

function convertNumericParameter(value: string, inputHex: boolean, outputHex: boolean): string {
  const clean = value.trim()
  if (!clean) return ''
  if (inputHex ? !/^[0-9a-f]+$/i.test(clean) : !/^\d+$/.test(clean)) {
    throw new Error(inputHex ? 'HEX 参数只能包含 0-9、A-F' : 'DEC 参数只能输入十进制数字 0-9')
  }
  const numericValue = BigInt(inputHex ? `0x${clean}` : clean)
  const converted = numericValue.toString(outputHex ? 16 : 10).toUpperCase()
  return outputHex && converted.length % 2 ? `0${converted}` : converted
}

function convertParameterForCommand(
  value: string,
  mode: ParameterMode,
  outputHex: boolean
): string {
  if (!value) return ''
  if (mode === 'ascii') return outputHex ? bytesToHex(new TextEncoder().encode(value)) : value
  return convertNumericParameter(value, mode === 'hex', outputHex)
}

function convertParameterMode(value: string, from: ParameterMode, to: ParameterMode): string {
  if (!value || from === to) return value
  if (from === 'ascii' && to === 'hex') return convertSerialText(value, true).replace(/\s+/g, '')
  if (from === 'hex' && to === 'ascii') return convertSerialText(value, false)
  if (from === 'ascii' && to === 'dec') return convertNumericParameter(value, false, false)
  if (from === 'dec' && to === 'ascii') return value
  return convertNumericParameter(value, from === 'hex', to === 'hex')
}

function buildCommand(command: SavedCommand): string {
  const result = command.parameters.reduce((current, parameter) => {
    const value = convertParameterForCommand(parameter.value, parameter.inputMode, command.hex)
    return current.replaceAll(`{{${parameter.id}}}`, value)
  }, command.template)
  return command.hex ? result : result.replace(/\\r/g, '\r').replace(/\\n/g, '\n')
}

export const CommandsPanel = memo(function CommandsPanel(props: Props): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [targetParentId, setTargetParentId] = useState<number | null>(null)
  const [editingCommandId, setEditingCommandId] = useState<number | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupTargetPort, setGroupTargetPort] = useState('')
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [error, setError] = useState('')
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [activeAutoSendIds, setActiveAutoSendIds] = useState<Set<number>>(new Set())

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
            buildCommand(command),
            command.hex,
            command.crcMode,
            command.targetPort
          )
          if (!success && !cancelled) {
            setActiveAutoSendIds((current) => {
              const next = new Set(current)
              next.delete(command.id)
              return next
            })
            return
          }
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
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
      updateParameter(command, parameterId, {
        inputMode,
        value: convertParameterMode(parameter.value, parameter.inputMode, inputMode)
      })
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const sendCommand = async (command: SavedCommand): Promise<void> => {
    const isRunning = props.connected && activeAutoSendIds.has(command.id)
    if (command.autoSend && isRunning) {
      setActiveAutoSendIds((current) => {
        const next = new Set(current)
        next.delete(command.id)
        return next
      })
      return
    }
    if (!props.connected) return setError('请先打开串口')
    try {
      setError('')
      const success = await props.onSend(
        buildCommand(command),
        command.hex,
        command.crcMode,
        command.targetPort
      )
      if (success && command.autoSend)
        setActiveAutoSendIds((current) => new Set(current).add(command.id))
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
    setDraft({ ...emptyDraft(), targetPort: props.targetPorts[0] || '' })
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
      hex: command.hex,
      autoSend: command.autoSend,
      autoSendInterval: command.autoSendInterval,
      crcEnabled: Boolean(command.crcMode),
      crcMode: command.crcMode || 'modbus',
      targetPort: command.targetPort || props.targetPorts[0] || '',
      parameterIds: command.parameters.map((parameter) => parameter.id)
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
    setError('')
    setCreatingGroup(true)
    setMenu(null)
  }
  const createGroup = (): void => {
    if (!groupName.trim()) return setError('请输入组名称')
    if (editingGroupId === null)
      props.setGroups([
        ...props.groups,
        { id: Date.now(), parentId: targetParentId, name: groupName.trim() }
      ])
    else
      props.setGroups(
        props.groups.map((group) =>
          group.id === editingGroupId ? { ...group, name: groupName.trim() } : group
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
    const ids = draft.parameterIds.map((id) => id.trim()).filter(Boolean)
    if (ids.some((id) => /[{}]/.test(id))) return setError('参数名字不能包含花括号')
    if (new Set(ids).size !== ids.length) return setError('参数名字不能重复')
    if (editingCommandId === null) {
      props.setCommands([
        ...props.commands,
        {
          id: Date.now(),
          parentId: targetParentId,
          name: draft.name.trim(),
          template: draft.template,
          hex: draft.hex,
          autoSend: draft.autoSend,
          autoSendInterval: draft.autoSendInterval,
          crcMode: draft.crcEnabled ? draft.crcMode : null,
          targetPort: draft.targetPort,
          parameters: ids.map((id) => ({ id, value: '', inputMode: draft.hex ? 'hex' : 'ascii' }))
        }
      ])
    } else {
      const current = props.commands.find((command) => command.id === editingCommandId)
      if (!current) return setError('要编辑的指令不存在')
      const parameters = ids.map(
        (id) =>
          current.parameters.find((parameter) => parameter.id === id) || {
            id,
            value: '',
            inputMode: draft.hex ? ('hex' as const) : ('ascii' as const)
          }
      )
      props.setCommands(
        props.commands.map((command) =>
          command.id === editingCommandId
            ? {
                ...command,
                name: draft.name.trim(),
                template: draft.template,
                hex: draft.hex,
                autoSend: draft.autoSend,
                autoSendInterval: draft.autoSendInterval,
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
      <div className="command-head" title={command.template}>
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
                : `自动 ${command.autoSendInterval}ms`}
            </span>
          )}
        </div>
        <button
          className={`command-send ${props.connected && activeAutoSendIds.has(command.id) ? 'stop' : ''}`}
          onClick={() => void sendCommand(command)}
        >
          {command.autoSend
            ? props.connected && activeAutoSendIds.has(command.id)
              ? '停止'
              : '启动'
            : '发送'}
        </button>
      </div>
      {command.parameters.map((parameter) => (
        <div className="command-parameter" key={parameter.id}>
          <label>
            <span>{parameter.id}</span>
            <input
              inputMode={parameter.inputMode === 'dec' ? 'numeric' : 'text'}
              value={parameter.value}
              placeholder={
                parameter.inputMode === 'ascii'
                  ? 'ASCII 文本'
                  : parameter.inputMode === 'dec'
                    ? 'DEC 数值'
                    : 'HEX 数值'
              }
              onChange={(event) => {
                const value = event.target.value
                if (
                  parameter.inputMode === 'ascii' ||
                  value === '' ||
                  (parameter.inputMode === 'hex' ? /^[0-9a-f]+$/i.test(value) : /^\d+$/.test(value))
                )
                  updateParameter(command, parameter.id, {
                    value: parameter.inputMode === 'hex' ? value.toUpperCase() : value
                  })
              }}
            />
          </label>
          <div className="mini-segment parameter-modes">
            <button
              title="ASCII 文本"
              className={parameter.inputMode === 'ascii' ? 'active' : ''}
              onClick={() => switchParameterMode(command, parameter.id, 'ascii')}
            >
              ASCII
            </button>
            <button
              title="十进制（Decimal）"
              className={parameter.inputMode === 'dec' ? 'active' : ''}
              onClick={() => switchParameterMode(command, parameter.id, 'dec')}
            >
              DEC
            </button>
            <button
              title="十六进制（Hexadecimal）"
              className={parameter.inputMode === 'hex' ? 'active' : ''}
              onClick={() => switchParameterMode(command, parameter.id, 'hex')}
            >
              HEX
            </button>
          </div>
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
          <button className="group-title" onClick={() => toggleGroup(group.id)}>
            <span className="group-arrow">{isCollapsed ? '▸' : '▾'}</span>
            <b className="folder-icon">▰</b>
            <strong>{group.name}</strong>
            <em>{groupCommandCount(group.id)} 条指令</em>
          </button>
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
              {editingGroupId !== null && (
                <label>
                  批量修改组内指令目标端口
                  <select
                    value={groupTargetPort}
                    onChange={(event) => setGroupTargetPort(event.target.value)}
                  >
                    <option value="">不修改</option>
                    {props.targetPorts.map((port) => (
                      <option key={port}>{port}</option>
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
                发送指令
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
              <label>
                目标端口
                <select
                  value={draft.targetPort}
                  onChange={(event) => setDraft({ ...draft, targetPort: event.target.value })}
                >
                  <option value="">选择目标端口</option>
                  {props.targetPorts.map((port) => (
                    <option key={port}>{port}</option>
                  ))}
                </select>
                <small>发送时该端口必须处于已打开状态</small>
              </label>
              <div className="form-row">
                <span>最终发送编码</span>
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
              </div>
              <div className="parameter-editor">
                <div className="parameter-editor-head">
                  <span>参数名字（支持中文，任意数量）</span>
                  <button
                    onClick={() =>
                      setDraft({ ...draft, parameterIds: [...draft.parameterIds, ''] })
                    }
                  >
                    ＋ 添加参数
                  </button>
                </div>
                {draft.parameterIds.map((id, index) => (
                  <div className="parameter-edit-row" key={index}>
                    <input
                      value={id}
                      placeholder="参数名字，例如 目标速度"
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          parameterIds: draft.parameterIds.map((value, itemIndex) =>
                            itemIndex === index ? event.target.value : value
                          )
                        })
                      }
                    />
                    <button
                      className="copy-placeholder"
                      disabled={!id.trim()}
                      onClick={() => void copyPlaceholder(id, index)}
                    >
                      {copiedIndex === index
                        ? '已复制'
                        : id.trim()
                          ? `{{${id.trim()}}}`
                          : '{{参数名字}}'}
                    </button>
                    <button
                      className="remove-parameter"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          parameterIds: draft.parameterIds.filter(
                            (_, itemIndex) => itemIndex !== index
                          )
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
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
