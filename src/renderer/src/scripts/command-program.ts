import { encodeSerialData } from '../serial-utils'
import type { SavedCommand } from '../types'
import { ScriptRuntime } from './script-runtime'
import type { SavedScript } from './script-types'
import { compileProgramSource } from './program-source'

export type CommandPhase = 'press' | 'release' | 'companion'

export const defaultCommandProgram = `/**
 * data: 替换参数并编码后的字节数组，每项为 0~255。
 * context.phase: "press" 主指令 / "release" 抬起 / "companion" 附带。
 * context.text: 替换参数后的文本；context.parameters: 输入参数。
 * 返回处理后的完整字节数组或 Uint8Array，同步执行。
 * 如已在这里追加校验，请关闭界面中的标准 CRC，避免重复追加。
 */
function process(data, context) {
  // 示例：对所有字节异或，将结果作为校验字节追加到末尾。
  // const checksum = data.reduce((value, byte) => value ^ byte, 0)
  // return [...data, checksum]
  return data
}`

export function buildCommandProgram(source: string): string {
  return `'use strict';
${source || defaultCommandProgram}
if (typeof process !== 'function') {
  throw new TypeError('编程模式必须定义 process(data, context) 函数')
}
execute((data, _type, _index, context) => {
  const result = process(data, context)
  const bytes = result instanceof Uint8Array ? Array.from(result) : result
  if (!Array.isArray(bytes) || bytes.length === 0 ||
      bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new TypeError('process 必须返回非空字节数组或 Uint8Array，每项为 0~255 的整数')
  }
  return bytes
})`
}

export class CommandProgramRuntime {
  private runtime = new ScriptRuntime()

  async run(command: SavedCommand, text: string, phase: CommandPhase): Promise<Uint8Array> {
    const bytes = encodeSerialData(text, command.hex)
    const code = buildCommandProgram(
      await compileProgramSource(command.processingProgram || defaultCommandProgram)
    )
    const now = Date.now()
    const script: SavedScript = {
      id: `quick-command:${command.id}`,
      name: command.name,
      language: 'typescript',
      source: command.processingProgram || defaultCommandProgram,
      compiledCode: code,
      sourceHash: code,
      enabled: true,
      direction: 'send',
      ports: command.targetPort ? [command.targetPort] : [],
      encoding: 'bytes',
      displayMode: 'hidden',
      framing: {
        mode: 'chunk',
        delimiter: '',
        fixedLength: 1,
        header: '',
        footer: '',
        idleTimeout: 20
      },
      createdAt: now,
      updatedAt: now
    }
    const result = await this.runtime.run(script, Array.from(bytes), 'send', 0, {
      port: command.targetPort || '',
      encoding: command.hex ? 'hex' : 'ascii',
      timestamp: now,
      byteLength: bytes.length,
      scriptName: command.name,
      direction: 'send',
      index: 0,
      phase,
      text,
      parameters: Object.fromEntries(
        command.parameters.map((parameter) => [parameter.id, parameter.value])
      )
    })
    if (
      !Array.isArray(result) ||
      !result.length ||
      result.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    )
      throw new Error('编程模式没有返回有效的字节数组')
    return Uint8Array.from(result)
  }

  reset(id: number): void {
    this.runtime.disposeScript(`quick-command:${id}`)
  }

  dispose(): void {
    this.runtime.restart()
  }
}
