/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Plain JavaScript Node test harness. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')
const { getQuickJS } = require('quickjs-emscripten')

function loadTs(relative) {
  const file = path.resolve(__dirname, '../src/renderer/src', relative)
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInNewContext(code, {
    exports,
    require: (request) =>
      request === './script-runtime'
        ? { ScriptRuntime: class {} }
        : loadTs(path.resolve(path.dirname(file), request + '.ts'))
  })
  return exports
}
const { buildCommandProgram } = loadTs('scripts/command-program.ts')
const { createQuickCommandsTransfer, parseQuickCommandsTransfer } = loadTs('config-transfer.ts')

async function execute(source, data, context = {}) {
  const quickjs = await getQuickJS()
  const runtime = quickjs.newRuntime()
  const deadline = Date.now() + 30
  runtime.setInterruptHandler(() => Date.now() > deadline)
  const engine = runtime.newContext()
  try {
    const evaluation = engine.evalCode(`let handler; function execute(fn) { handler = fn }
      ${buildCommandProgram(source)}
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
  const commands = ['command', 'custom'].map((source, i) => ({
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
    processingProgram: 'function process(data) { return data }',
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
        source: commands[i].companion.source,
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
    JSON.stringify(createQuickCommandsTransfer([], commands))
  )
  assert.equal(parsed.commands[0].processingMode, 'template')
  assert.equal(parsed.commands[0].companion.enabled, false)
  assert.equal(parsed.commands[0].companion.interval, 200)
})
