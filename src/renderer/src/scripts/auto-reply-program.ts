import type { Rule } from '../types'
import { ScriptRuntime } from './script-runtime'
import type { SavedScript, ScriptRunResult } from './script-types'

const legacyAutoReplyComment = '// 顶层变量会在多次触发间保留，点击“重置状态”后清零'
const autoReplyProgramComment = `/**
 * 自动回复编程规则
 *
 * 1. 每次收到匹配数据时执行 calculate(input, match, context)。
 * 2. 返回对象的键是参数名，可在发送指令中用双花括号占位符引用。
 *    返回对象示例：{ 计数: i, PWM: 100 }
 * 3. input 是匹配内容，match 是正则结果，context 包含端口和命名捕获组等信息。
 * 4. 顶层变量会在多次触发间保留；点击“重置状态”可清除累计数据。
 * 5. 最终编码为 HEX 时，数字自动转换并补齐完整字节：1→01、10→0A、256→0100。
 * 6. 编辑器快捷键：Tab 插入制表符，Ctrl+S 保存规则。
 */`

export const defaultAutoReplyProgram = `let i = 0

function calculate(input, match, context) {
  i++
  return {
    计数: i
  }
}`

export function upgradeAutoReplyProgram(source: string | undefined): string {
  if (!source?.trim()) return defaultAutoReplyProgram
  if (source.startsWith(autoReplyProgramComment))
    return source.slice(autoReplyProgramComment.length).trimStart()
  if (source.startsWith(legacyAutoReplyComment))
    return source.slice(legacyAutoReplyComment.length).trimStart()
  return source
}

export type AutoReplyProgramInput = {
  input: string
  match: string[]
  groups: Record<string, string>
  port: string
}

const autoReplyScriptRuntime = new ScriptRuntime()

function hashSource(source: string): string {
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function runtimeId(ruleId: number): string {
  return `auto-reply:${ruleId}`
}

function buildProgram(rule: Rule): string {
  return `'use strict';
${rule.parameterProgram || defaultAutoReplyProgram}

if (typeof calculate !== 'function') {
  throw new TypeError('编程模式必须定义 calculate(input, match, context) 函数')
}

execute((value, _msgType, _index, context) => {
  const output = calculate(value, context.match || [], context)
  if (output === null || typeof output !== 'object' || Array.isArray(output)) {
    throw new TypeError('calculate 必须返回以参数名字为键的对象')
  }
  return output
})`
}

function unsignedIntegerHex(value: number | bigint): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))
    throw new Error('HEX 编码的数字参数必须是非负安全整数')
  if (typeof value === 'bigint' && value < 0n) throw new Error('HEX 编码的数字参数不能是负数')
  const hex = value.toString(16).toUpperCase()
  return hex.length % 2 ? `0${hex}` : hex
}

function printableValue(value: unknown, hex: boolean): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (hex) {
    if (typeof value === 'number' || typeof value === 'bigint') return unsignedIntegerHex(value)
    if (typeof value === 'boolean') return value ? '01' : '00'
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value)
  return JSON.stringify(value)
}

function normalizeOutput(rule: Rule, result: ScriptRunResult): Record<string, string> {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('编程模式没有返回参数对象')
  const output = result as Record<string, unknown>
  const values: Record<string, string> = {}
  for (const parameter of rule.parameters) {
    if (!(parameter.id in output)) throw new Error(`程序没有输出参数“${parameter.id}”`)
    values[parameter.id] = printableValue(output[parameter.id], rule.hex)
  }
  return values
}

class AutoReplyProgramRuntime {
  private queues = new Map<number, Promise<Record<string, string>>>()
  private revisions = new Map<number, number>()
  private triggerCounts = new Map<number, number>()

  run(rule: Rule, input: AutoReplyProgramInput): Promise<Record<string, string>> {
    const revision = this.revisions.get(rule.id) || 0
    const previous = this.queues.get(rule.id)
    const task = (previous ? previous.catch(() => ({})) : Promise.resolve({})).then(async () => {
      if ((this.revisions.get(rule.id) || 0) !== revision) throw new Error('规则状态已重置')
      const count = (this.triggerCounts.get(rule.id) || 0) + 1
      const code = buildProgram(rule)
      const now = Date.now()
      const script: SavedScript = {
        id: runtimeId(rule.id),
        name: rule.name,
        language: 'javascript',
        source: rule.parameterProgram || defaultAutoReplyProgram,
        compiledCode: code,
        sourceHash: hashSource(code),
        enabled: true,
        direction: 'received',
        ports: rule.targetPort ? [rule.targetPort] : [],
        encoding: 'ascii',
        displayMode: 'hidden',
        framing: {
          mode: 'chunk',
          delimiter: '\\n',
          fixedLength: 1,
          header: '',
          footer: '',
          idleTimeout: 20
        },
        createdAt: now,
        updatedAt: now
      }
      const result = await autoReplyScriptRuntime.run(
        script,
        input.input,
        'received',
        count - 1,
        {
          port: input.port,
          encoding: 'ascii',
          timestamp: now,
          byteLength: new TextEncoder().encode(input.input).length,
          scriptName: rule.name,
          direction: 'received',
          index: count - 1,
          match: input.match,
          groups: input.groups,
          parameters: Object.fromEntries(
            rule.parameters.map((parameter) => [parameter.id, parameter.value])
          )
        },
        50
      )
      if ((this.revisions.get(rule.id) || 0) !== revision) throw new Error('规则状态已重置')
      this.triggerCounts.set(rule.id, count)
      return normalizeOutput(rule, result)
    })
    this.queues.set(rule.id, task)
    void task.then(
      () => {
        if (this.queues.get(rule.id) === task) this.queues.delete(rule.id)
      },
      () => {
        if (this.queues.get(rule.id) === task) this.queues.delete(rule.id)
      }
    )
    return task
  }

  reset(ruleId: number): void {
    this.revisions.set(ruleId, (this.revisions.get(ruleId) || 0) + 1)
    this.triggerCounts.delete(ruleId)
    this.queues.delete(ruleId)
    autoReplyScriptRuntime.disposeScript(runtimeId(ruleId))
  }
}

export const autoReplyProgramRuntime = new AutoReplyProgramRuntime()
