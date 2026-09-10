const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { test } = require('node:test')
const ts = require('typescript')

function loadTs(filename, mocks = {}, cache = new Map()) {
  filename = path.resolve(filename)
  if (cache.has(filename)) return cache.get(filename).exports
  const loaded = new Module(filename, module)
  cache.set(filename, loaded)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  loaded.require = (name) => {
    if (mocks[name]) return mocks[name]
    if (name.startsWith('.')) return loadTs(path.resolve(path.dirname(filename), name + '.ts'), mocks, cache)
    return require(name)
  }
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
  return loaded.exports
}
const validation = loadTs('src/main/firmware/validation.ts')
const { flashCommands } = loadTs('src/main/firmware/manager.ts')
const base = {
  family: 'stm32', transport: 'uart', port: 'COM9', probe: '', chip: 'auto', baudRate: 115200,
  files: [], verify: true, reset: true, restorePort: true, eraseAll: false, manualBoot: false,
  connectMode: 'NORMAL', toolPath: ''
}
function record(type, address, data = []) {
  const bytes = [data.length, address >> 8, address & 255, type, ...data]
  bytes.push((-bytes.reduce((sum, n) => sum + n, 0)) & 255)
  return ':' + Buffer.from(bytes).toString('hex').toUpperCase()
}
const hex = [record(4, 0, [8, 0]), record(0, 16, [1, 2, 3, 4]), record(1, 0)].join('\n')

test('HEX validates extended addresses, checksums, EOF, overlaps and unsupported records', () => {
  assert.deepEqual(validation.parseIntelHex(hex), [{ start: 0x08000010, end: 0x08000014 }])
  assert.deepEqual(validation.parseIntelHex([record(2, 0, [0x12, 0x34]), record(0, 2, [1]), record(1, 0)].join('\n')), [{ start: 0x12342, end: 0x12343 }])
  for (const bad of [hex.replace('01020304', '01020305'), hex.split('\n').slice(0, 2).join('\n'), hex + '\n' + record(0, 0, [1]), [record(0, 1, [1, 2]), record(0, 2, [3]), record(1, 0)].join('\n'), [record(6, 0), record(1, 0)].join('\n')])
    assert.throws(() => validation.parseIntelHex(bad))
  assert.throws(() => validation.parseAddress('0x1000 -e all'))
  assert.throws(() => validation.parseAddress('4294967296'))
})

test('preflight rejects protected STM32 regions, ESP overlaps, missing addresses and unsupported formats', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'serialflow-test-'))
  try {
    const bin = path.join(directory, 'firmware with spaces.bin')
    const hexPath = path.join(directory, 'firmware.hex')
    fs.writeFileSync(bin, Buffer.alloc(16))
    fs.writeFileSync(hexPath, hex)
    const file = { path: bin, name: path.basename(bin), size: 16, address: '0x08000000' }
    assert.equal((await validation.inspectFirmware({ ...base, files: [file] }))[0].address, 0x08000000)
    assert.equal((await validation.inspectFirmware({ ...base, files: [{ ...file, path: hexPath, address: '' }] }))[0].address, 0x08000010)
    await assert.rejects(validation.inspectFirmware({ ...base, files: [{ ...file, address: '0x1FFF7800' }] }), /Flash/)
    const esp = { ...base, family: 'esp32', files: [{ ...file, address: '0x1000' }, { ...file, address: '0x1008' }] }
    await assert.rejects(validation.inspectFirmware(esp), /重叠/)
    await assert.rejects(validation.inspectFirmware({ ...esp, files: [{ ...file, address: '' }] }), /地址/)
    await assert.rejects(validation.inspectFirmware({ ...esp, files: [{ ...file, path: hexPath }] }), /BIN/)
    fs.writeFileSync(hexPath, [record(4, 0, [0x1f, 0xff]), record(0, 0x7800, [1]), record(1, 0)].join('\n'))
    await assert.rejects(validation.inspectFirmware({ ...base, files: [{ ...file, path: hexPath }] }), /Flash/)
    const largeHex = []
    for (let i = 0; i < 150000; i++) {
      if (i % 65536 === 0) largeHex.push(record(4, 0, [8, Math.floor(i / 65536)]))
      largeHex.push(record(0, i % 65536, [i & 255]))
    }
    largeHex.push(record(1, 0))
    fs.writeFileSync(hexPath, largeHex.join('\n'))
    assert.equal((await validation.inspectFirmware({ ...base, files: [{ ...file, path: hexPath }] }))[0].ranges.length, 150000)
    fs.writeFileSync(bin, '')
    await assert.rejects(validation.inspectFirmware({ ...base, files: [file] }), /为空/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('commands preserve arguments and avoid unsupported UART reset or forced security bypass', () => {
  const file = { path: 'C:\\firmware with spaces.bin', address: '0x08000000' }
  const uart = flashCommands({ ...base, files: [file] }, [file.path])[0].args
  assert(uart.includes(file.path))
  assert(uart.includes('-v'))
  assert(!uart.includes('-rst'))
  assert(!uart.includes('-e'))
  const swd = flashCommands({ ...base, transport: 'swd', probe: '1234567890', files: [file], eraseAll: true }, [file.path])[0].args
  assert(swd.includes('-rst'))
  assert(swd.includes('-e'))
  const esp = flashCommands({ ...base, family: 'esp32', manualBoot: true, files: [{ ...file, address: '0x1000' }] }, [file.path])[0].args
  assert(esp.includes('no-reset'))
  assert(esp.includes('write-flash'))
  assert(!esp.includes('--force'))
  assert(!esp.includes('--trust-flash-content'))
  assert.deepEqual(esp.slice(-2), ['0x1000', file.path])
})

function harness(directory, behavior = 'success') {
  const calls = []
  let released = 0
  let acquired = 0
  let current
  const mocks = {
    child_process: {
      spawn(exe, args, options) {
        assert.equal(options.shell, false)
        assert.equal(options.windowsHide, true)
        calls.push(args)
        const child = new EventEmitter()
        child.pid = 123456
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        let closed = false
        child.kill = () => { if (!closed) { closed = true; setImmediate(() => child.emit('close', null)) } }
        current = child
        setImmediate(() => {
          if (args[0] === 'version') { child.stdout.write('esptool v5.3.1\n'); child.emit('close', 0); return }
          if (behavior === 'hang') return
          if (behavior === 'error') { child.stderr.write('A fatal error occurred: disconnected'); child.emit('close', 0); return }
          child.stdout.write('Chip is ESP32\nWriting at 0x1000 (50 %)\nHash of data verified.\n')
          child.emit('close', 0)
        })
        return child
      },
      execFile(_exe, args, _options, callback) { assert(args.includes('/T')); current.kill(); setImmediate(callback) }
    }
  }
  const { FirmwareManager } = loadTs('src/main/firmware/manager.ts', mocks)
  const manager = new FirmwareManager({ resources: directory, temp: directory, emit() {}, acquire: async () => {
    acquired++
    if (behavior === 'busy') throw new Error('端口正在传输文件')
    return async () => { released++; if (behavior === 'restore-error') throw new Error('device removed') }
  } })
  return { manager, calls, acquired: () => acquired, released: () => released }
}

async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)) }
  throw new Error('test condition timed out')
}

test('task success, failures, cancellation, duplicate starts and restoration release resources', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'serialflow-manager-test-'))
  try {
    const exe = path.join(directory, process.platform === 'win32' ? 'esptool.exe' : 'esptool')
    fs.writeFileSync(exe, '')
    const bin = path.join(directory, 'firmware.bin')
    fs.writeFileSync(bin, Buffer.from([1, 2, 3, 4]))
    const request = { ...base, family: 'esp32', toolPath: exe, files: [{ path: bin, name: 'firmware.bin', size: 4, address: '0x1000' }] }
    for (const behavior of ['success', 'error', 'hang', 'busy', 'restore-error']) {
      const h = harness(directory, behavior)
      const id = h.manager.start(request, 'flash')
      assert.throws(() => h.manager.start(request, 'flash'), /已有任务/)
      if (behavior === 'hang') {
        await until(() => h.calls.length === 2)
        h.manager.cancel('incorrect-task-id')
        assert(h.manager.snapshot().busy)
        h.manager.cancel(id)
      }
      await until(() => !h.manager.snapshot().busy)
      const state = h.manager.snapshot()
      assert.equal(state.outcome, behavior === 'hang' ? 'cancelled' : ['error', 'busy'].includes(behavior) ? 'error' : 'success')
      assert.equal(h.released(), behavior === 'busy' ? 0 : 1)
      if (behavior === 'restore-error') assert.match(state.restoreWarning, /恢复串口失败/)
      if (behavior === 'success') {
        assert.equal(state.percent, 100)
        const copied = h.calls[1].at(-1)
        assert.notEqual(copied, bin)
        assert(!fs.existsSync(copied), 'temporary firmware must be removed')
      }
      assert.equal(fs.readdirSync(directory).filter(name => name.startsWith('serialflow-flash-')).length, 0)
    }
    const h = harness(directory)
    const bad = { ...request, files: [{ ...request.files[0], address: '' }] }
    h.manager.start(bad, 'flash')
    await until(() => !h.manager.snapshot().busy)
    assert.equal(h.acquired(), 0, 'invalid firmware must fail before taking the serial port')
    assert.equal(h.calls.length, 1, 'invalid firmware must not invoke a device command')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
