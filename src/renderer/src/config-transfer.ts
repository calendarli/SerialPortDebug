import { normalizeGroupGlobals } from './scripts/group-globals'
import type { AutoReplyGroup, CommandGroup, Rule, SavedCommand } from './types'

type JsonRecord = Record<string, unknown>

export type QuickCommandsTransfer = {
  format: 'serialflow-quick-commands'
  version: 1
  exportedAt: string
  groups: CommandGroup[]
  commands: SavedCommand[]
}

export type AutoReplyTransfer = {
  format: 'serialflow-auto-replies'
  version: 1
  exportedAt: string
  groups: AutoReplyGroup[]
  rules: Rule[]
}

const crcModes = new Set(['crc8', 'modbus', 'ccitt-false', 'xmodem', 'crc32'])
const parameterModes = new Set(['ascii', 'dec', 'hex'])

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}格式不正确`)
  return value as JsonRecord
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  return value
}

function text(value: unknown, label: string, allowEmpty = true): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()))
    throw new Error(`${label}必须是${allowEmpty ? '文本' : '非空文本'}`)
  return value
}

function identifier(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error(`${label}不是有效编号`)
  return value
}

function optionalIdentifier(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : identifier(value, label)
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function nonnegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function assertUniqueIds(items: Array<{ id: number }>, label: string): void {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    throw new Error(`${label}中存在重复编号`)
}

function parseRoot(content: string, format: string): JsonRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('文件不是有效的 JSON')
  }
  const root = record(parsed, '文件')
  if (root.format !== format || root.version !== 1) throw new Error('不是受支持的配置文件')
  return root
}

function parseCommandGroup(value: unknown, index: number): CommandGroup {
  const item = record(value, `第 ${index + 1} 个快捷指令分组`)
  return {
    id: identifier(item.id, `第 ${index + 1} 个快捷指令分组编号`),
    parentId: optionalIdentifier(item.parentId, `第 ${index + 1} 个快捷指令分组的上级编号`),
    name: text(item.name, `第 ${index + 1} 个快捷指令分组名称`, false).trim(),
    autoLoop: boolean(item.autoLoop, false),
    loopDelay: positiveInteger(item.loopDelay, 100),
    loopCount: nonnegativeInteger(item.loopCount, 0),
    globals: normalizeGroupGlobals(item.globals)
  }
}

function parseCommand(value: unknown, index: number): SavedCommand {
  const item = record(value, `第 ${index + 1} 条快捷指令`)
  const hex = boolean(item.hex, false)
  const parameters = array(item.parameters, `第 ${index + 1} 条快捷指令的参数`).map(
    (parameterValue, parameterIndex) => {
      const parameter = record(
        parameterValue,
        `第 ${index + 1} 条快捷指令的第 ${parameterIndex + 1} 个参数`
      )
      const inputMode = parameterModes.has(String(parameter.inputMode))
        ? (parameter.inputMode as 'ascii' | 'dec' | 'hex')
        : hex
          ? 'hex'
          : 'ascii'
      return {
        id: text(parameter.id, `第 ${index + 1} 条快捷指令的参数名称`, false).trim(),
        value: typeof parameter.value === 'string' ? parameter.value : '',
        inputMode,
        byteLength: Math.min(64, positiveInteger(parameter.byteLength, 1))
      }
    }
  )
  if (new Set(parameters.map((parameter) => parameter.id)).size !== parameters.length)
    throw new Error(`第 ${index + 1} 条快捷指令中存在重复参数名称`)
  return {
    id: identifier(item.id, `第 ${index + 1} 条快捷指令编号`),
    parentId: optionalIdentifier(item.parentId, `第 ${index + 1} 条快捷指令的分组编号`),
    name: text(item.name, `第 ${index + 1} 条快捷指令名称`, false).trim(),
    template: text(item.template, `第 ${index + 1} 条快捷指令内容`),
    releaseTemplate: typeof item.releaseTemplate === 'string' ? item.releaseTemplate : '',
    hex,
    autoSend: boolean(item.autoSend, false),
    autoSendInterval: positiveInteger(item.autoSendInterval, 1000),
    autoSendCount: nonnegativeInteger(item.autoSendCount, 0),
    crcMode: crcModes.has(String(item.crcMode)) ? (item.crcMode as SavedCommand['crcMode']) : null,
    targetPort: typeof item.targetPort === 'string' ? item.targetPort : '',
    parameters
  }
}

export function createQuickCommandsTransfer(
  groups: CommandGroup[],
  commands: SavedCommand[]
): QuickCommandsTransfer {
  return {
    format: 'serialflow-quick-commands',
    version: 1,
    exportedAt: new Date().toISOString(),
    groups,
    commands
  }
}

export function parseQuickCommandsTransfer(content: string): {
  groups: CommandGroup[]
  commands: SavedCommand[]
} {
  const root = parseRoot(content, 'serialflow-quick-commands')
  const groups = array(root.groups, '快捷指令分组').map(parseCommandGroup)
  const commands = array(root.commands, '快捷指令').map(parseCommand)
  assertUniqueIds(groups, '快捷指令分组')
  assertUniqueIds(commands, '快捷指令')
  const groupIds = new Set(groups.map((group) => group.id))
  for (const group of groups) {
    if (group.parentId !== null && !groupIds.has(group.parentId))
      throw new Error(`分组“${group.name}”引用了不存在的上级分组`)
    if (group.parentId === group.id) throw new Error(`分组“${group.name}”不能以自身作为上级分组`)
  }
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  for (const group of groups) {
    const visited = new Set<number>([group.id])
    let parentId = group.parentId
    while (parentId !== null) {
      if (visited.has(parentId)) throw new Error(`分组“${group.name}”存在循环嵌套`)
      visited.add(parentId)
      parentId = groupsById.get(parentId)?.parentId ?? null
    }
  }
  for (const command of commands)
    if (command.parentId !== null && !groupIds.has(command.parentId))
      throw new Error(`快捷指令“${command.name}”引用了不存在的分组`)
  return { groups, commands }
}

function parseAutoReplyGroup(value: unknown, index: number): AutoReplyGroup {
  const item = record(value, `第 ${index + 1} 个自动回复分组`)
  return {
    id: identifier(item.id, `第 ${index + 1} 个自动回复分组编号`),
    name: text(item.name, `第 ${index + 1} 个自动回复分组名称`, false).trim(),
    globals: normalizeGroupGlobals(item.globals)
  }
}

function parseRule(value: unknown, index: number): Rule {
  const item = record(value, `第 ${index + 1} 条自动回复规则`)
  const pattern = text(item.pattern, `第 ${index + 1} 条自动回复规则的接收内容`)
  const regex = boolean(item.regex, true)
  if (regex) {
    try {
      new RegExp(pattern)
    } catch {
      throw new Error(`自动回复规则“${String(item.name || index + 1)}”包含无效正则表达式`)
    }
  }
  const hex = boolean(item.hex, false)
  const parameters = array(item.parameters, `第 ${index + 1} 条自动回复规则的参数`).map(
    (parameterValue, parameterIndex) => {
      const parameter = record(
        parameterValue,
        `第 ${index + 1} 条自动回复规则的第 ${parameterIndex + 1} 个参数`
      )
      return {
        id: text(parameter.id, `第 ${index + 1} 条自动回复规则的参数名称`, false).trim(),
        value: typeof parameter.value === 'string' ? parameter.value : '',
        inputMode: parameterModes.has(String(parameter.inputMode))
          ? (parameter.inputMode as 'ascii' | 'dec' | 'hex')
          : hex
            ? ('hex' as const)
            : ('ascii' as const)
      }
    }
  )
  if (new Set(parameters.map((parameter) => parameter.id)).size !== parameters.length)
    throw new Error(`第 ${index + 1} 条自动回复规则中存在重复参数名称`)
  return {
    id: identifier(item.id, `第 ${index + 1} 条自动回复规则编号`),
    groupId: identifier(item.groupId, `第 ${index + 1} 条自动回复规则的分组编号`),
    name: text(item.name, `第 ${index + 1} 条自动回复规则名称`, false).trim(),
    pattern,
    regex,
    receiveHex: boolean(item.receiveHex, hex),
    reply: text(item.reply, `第 ${index + 1} 条自动回复规则的发送内容`),
    hex,
    enabled: boolean(item.enabled, true),
    targetPort: typeof item.targetPort === 'string' ? item.targetPort : '',
    parameterMode: item.parameterMode === 'program' ? 'program' : 'parameters',
    parameterProgram: typeof item.parameterProgram === 'string' ? item.parameterProgram : '',
    parameters
  }
}

export function createAutoReplyTransfer(
  groups: AutoReplyGroup[],
  rules: Rule[]
): AutoReplyTransfer {
  return {
    format: 'serialflow-auto-replies',
    version: 1,
    exportedAt: new Date().toISOString(),
    groups,
    rules
  }
}

export function parseAutoReplyTransfer(content: string): {
  groups: AutoReplyGroup[]
  rules: Rule[]
} {
  const root = parseRoot(content, 'serialflow-auto-replies')
  const groups = array(root.groups, '自动回复分组').map(parseAutoReplyGroup)
  const rules = array(root.rules, '自动回复规则').map(parseRule)
  if (!groups.length) throw new Error('自动回复配置至少需要一个分组')
  assertUniqueIds(groups, '自动回复分组')
  assertUniqueIds(rules, '自动回复规则')
  const groupIds = new Set(groups.map((group) => group.id))
  for (const rule of rules)
    if (!groupIds.has(rule.groupId)) throw new Error(`自动回复规则“${rule.name}”引用了不存在的分组`)
  return { groups, rules }
}
