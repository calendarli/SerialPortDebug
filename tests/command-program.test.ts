import type { Rule, SavedCommand } from '../src/renderer/src/types'
import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { getQuickJS } from 'quickjs-emscripten'
import { highlightProgram } from '../src/renderer/src/scripts/program-highlight'
import { buildCommandProgram } from '../src/renderer/src/scripts/command-program'
import { compileProgramSource } from '../src/renderer/src/scripts/program-source'
import { compileAutoReplyProgram } from '../src/renderer/src/scripts/auto-reply-program'
import {
  createQuickCommandsTransfer,
  parseQuickCommandsTransfer,
  createAutoReplyTransfer,
  parseAutoReplyTransfer
} from '../src/renderer/src/config-transfer'
test('highlighting preserves incomplete code, Chinese text and template interpolation', () => {
  for (const source of [
    '// 中文注释\nconst 数据: number = 42\n',
    'const message = `值: ${count + 1}`; const re = /a\\/b/g',
    'function process(data: number[]) {\n  return "未完成',
    '/** 参数说明 */\nfunction calculate() { return {计数: 1} }',
    '<script>alert("text")</script>',
    ''
  ])
    assert.equal(
      highlightProgram(source)
        .map((token) => token.text)
        .join(''),
      source
    )
  const tokens = highlightProgram('const value: number = 42; // note\nconst re = /abc/g')
  assert.ok(tokens.some((token) => token.text === 'const' && token.tone === 'keyword'))
  assert.ok(tokens.some((token) => token.text === '42' && token.tone === 'number'))
  assert.ok(tokens.some((token) => token.text.includes('// note') && token.tone === 'comment'))
  assert.ok(tokens.some((token) => token.text === '/abc/g' && token.tone === 'string'))
})

test('TypeScript types, generics and enums execute as command bytes in QuickJS', async () => {
  assert.deepEqual(
    await execute(
      `
    interface Context { phase: string }
    type Byte = number
    enum Marker { End = 255 }
    function copy<T>(value: T): T { return value }
    function process(data: Byte[], context: Context): Uint8Array {
      return new Uint8Array([...copy(data), context.phase === 'press' ? Marker.End : 0])
    }
  `,
      [1, 2],
      { phase: 'press' }
    ),
    [1, 2, 255]
  )
})

test('TypeScript auto replies preserve top-level and group state in QuickJS', async () => {
  const code = await compileAutoReplyProgram({
    id: 1,
    groupId: 1,
    name: 'test',
    pattern: '',
    reply: '',
    enabled: true,
    hex: false,
    parameters: [],
    parameterProgram: `
    interface Result { count: number; input: string }
    let count: number = 0
    function calculate(input: string, match: string[], context: object): Result {
      global.total = (global.total ?? 0) + 1
      return { count: ++count, input }
    }
  `
  })
  const quickjs = await getQuickJS()
  const engine = quickjs.newContext()
  try {
    const result = engine.evalCode(`let handler; function execute(fn) { handler = fn }
      ${code}
      const first = handler('a', 'received', 0, {global:{total: 5}});
      const second = handler('b', 'received', 1, {global:first.__serialflowGlobal});
      [first.__serialflowOutput.count, second.__serialflowOutput.count, second.__serialflowOutput.input, second.__serialflowGlobal.total]`)
    if (result.error) {
      const error = engine.dump(result.error)
      result.error.dispose()
      throw Error(JSON.stringify(error))
    }
    assert.deepEqual(engine.dump(result.value), [1, 2, 'b', 7])
    result.value.dispose()
  } finally {
    engine.dispose()
  }
})

test('TypeScript reports syntax locations and rejects unsupported module loading', async () => {
  await assert.rejects(compileProgramSource('const broken: = 1'), /1/)
  for (const source of ["import x from 'x'", 'export const x = 1', "const x = import('x')"])
    await assert.rejects(compileProgramSource(source), /import \/ export/)
})

test('auto reply transfer preserves TS source without a language setting', () => {
  const source = 'function calculate(input: string): object { return {input} }'
  const rule: Rule = {
    enabled: true,
    hex: false,
    id: 1,
    groupId: 1,
    name: 'TS',
    pattern: 'AT',
    reply: '{{input}}',
    parameters: [],
    parameterMode: 'program',
    parameterProgram: source
  }
  const roundTrip = (value: Rule) =>
    parseAutoReplyTransfer(
      JSON.stringify(createAutoReplyTransfer([{ id: 1, name: 'Group', globals: {} }], [value]))
    ).rules[0]
  assert.equal(roundTrip(rule).parameterProgram, source)
})

async function execute(source: string, data: number[], context: Record<string, unknown> = {}) {
  const compiled = await compileProgramSource(source)
  const quickjs = await getQuickJS()
  const runtime = quickjs.newRuntime()
  const deadline = Date.now() + 30
  runtime.setInterruptHandler(() => Date.now() > deadline)
  const engine = runtime.newContext()
  try {
    const evaluation = engine.evalCode(`let handler; function execute(fn) { handler = fn }
      ${buildCommandProgram(compiled)}
      handler(${JSON.stringify(data)}, 'send', 0, ${JSON.stringify(context)})`)
    if (evaluation.error) {
      const error = engine.dump(evaluation.error)
      evaluation.error.dispose()
      throw Error(JSON.stringify(error))
    }
    const result = engine.dump(evaluation.value)
    evaluation.value.dispose()
    return result
  } finally {
    engine.dispose()
    runtime.dispose()
  }
}

test('processing receives full packet and can append nonstandard checksum', async () => {
  assert.deepEqual(
    await execute(
      'function process(data) { return [...data, data.reduce((a,b) => a ^ b, 0)] }',
      [0xaa, 1]
    ),
    [0xaa, 1, 0xab]
  )
})

test('typed arrays and phase-specific processing work in the actual QuickJS engine', async () => {
  assert.deepEqual(
    await execute(
      'function process(data, context) { return new Uint8Array([...data, context.phase === "companion" ? 2 : 1]) }',
      [3],
      { phase: 'companion' }
    ),
    [3, 2]
  )
  assert.deepEqual(await execute('', [0, 255]), [0, 255])
})

test('missing function, syntax errors, invalid bytes and async output fail without a packet', async () => {
  for (const source of [
    'const x = 1',
    'function process( {',
    'function process() { return [256] }',
    'function process() { return [-1] }',
    'function process() { return [1.5] }',
    'function process() { return [] }',
    'async function process(data) { return data }'
  ])
    await assert.rejects(execute(source, [1]))
})

test('nonterminating processing is interrupted', async () => {
  await assert.rejects(execute('function process() { while (true) {} }', [1]), /interrupted/)
})

test('both attachment sources and program source survive configuration round trips', () => {
  const commands: SavedCommand[] = (['command', 'custom'] as const).map((source, i) => ({
    id: i + 1,
    parentId: null,
    name: 'Move' + i,
    template: 'AA 01',
    releaseTemplate: '00',
    hex: true,
    autoSend: false,
    autoSendInterval: 100,
    autoSendCount: 0,
    parameters: [],
    processingMode: 'program',
    processingProgram: 'function process(data: number[]): number[] { return data }',
    companion: { enabled: true, source, commandId: 2, template: 'GET X', loop: true, interval: 200 }
  }))
  const parsed = parseQuickCommandsTransfer(
    JSON.stringify(createQuickCommandsTransfer([], commands))
  )
  for (let i = 0; i < 2; i++) {
    assert.equal(
      JSON.stringify(parsed.commands[i].companion),
      JSON.stringify({
        enabled: true,
        source: commands[i].companion!.source,
        template: 'GET X',
        commandId: 2,
        loop: true,
        interval: 200
      })
    )
    assert.equal(parsed.commands[i].processingProgram, commands[i].processingProgram)
  }
})

test('legacy commands retain normal processing with no attachment', () => {
  const commands = [{ id: 1, parentId: null, name: 'Legacy', template: 'AT', parameters: [] }]
  const parsed = parseQuickCommandsTransfer(
    JSON.stringify({ ...createQuickCommandsTransfer([], []), commands })
  )
  assert.equal(parsed.commands[0].processingMode, 'template')
  assert.equal(parsed.commands[0].companion!.enabled, false)
  assert.equal(parsed.commands[0].companion!.interval, 200)
})
