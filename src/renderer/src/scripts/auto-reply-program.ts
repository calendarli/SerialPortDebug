import type { Rule } from '../types'
import { ScriptRuntime } from './script-runtime'
import type { SavedScript, ScriptRunResult } from './script-types'

export const defaultAutoReplyProgram = `// 顶层变量会在多次触发间保留，点击“重置状态”后清零
let i = 0

function calculate(input, match, context) {
  i++
  return {
    计数: i
  }
}`

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

function printableValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
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
    values[parameter.id] = printableValue(output[parameter.id])
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
