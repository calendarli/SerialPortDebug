// Run after npm run build:
// node_modules/.bin/electron scripts/firmware-ui-smoke.cjs
// Uses an isolated profile and a hidden real Electron window; never flashes hardware.
const { app, BrowserWindow, dialog } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const Module = require('node:module')
const realChildProcess = require('node:child_process')
const load = Module._load
let finishFirmware
const openedOptions = []
class FakeSerialPort extends EventEmitter {
  static async list() { return [{ path: 'COM991', manufacturer: 'Test fixture (no hardware)' }] }
  constructor(options) { super(); this.path = options.path; this.settings = options; this.baudRate = options.baudRate; this.isOpen = false; openedOptions.push(options) }
  open(callback) { this.isOpen = true; setImmediate(() => callback(null)) }
  close(callback) { this.isOpen = false; setImmediate(() => { this.emit('close'); callback(null) }) }
  write(_data, callback) { setImmediate(() => callback(null)) }
  drain(callback) { setImmediate(() => callback(null)) }
}
Module._load = function (name, ...args) {
  if (name === 'serialport') return { SerialPort: FakeSerialPort }
  if (name === 'child_process') return { ...realChildProcess, spawn(exe, argv, options) {
    if (!argv.includes('write-flash')) return realChildProcess.spawn(exe, argv, options)
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.kill = () => child.emit('close', null)
    finishFirmware = () => { child.stdout.write('Writing at 0x1000 (100 %)\nHash of data verified.\n'); child.emit('close', 0) }
    return child
  } }
  return load.call(this, name, ...args)
}
const root = path.resolve(__dirname, '..')
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('in-process-gpu')
const profile = fs.mkdtempSync(path.join(root, 'build', 'firmware-qa-'))
app.setPath('appData', profile)
app.setPath('userData', profile)
app.setAppPath(root)
BrowserWindow.prototype.show = function () {}
const fixture = path.join(profile, 'application.bin')
fs.writeFileSync(fixture, Buffer.from([1, 2, 3, 4]))
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] })
const errors = []
app.on('web-contents-created', (_event, contents) => {
  contents.setBackgroundThrottling(false)
  contents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message) })
})
require('../out/main/index.js')
async function until(fn, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('UI condition timed out')
}
const deadline = setTimeout(() => { console.error('Electron QA timed out'); app.exit(1) }, 60000)
app.whenReady().then(async () => {
  try {
    await until(() => BrowserWindow.getAllWindows().length)
    const window = BrowserWindow.getAllWindows()[0]
    const run = source => window.webContents.executeJavaScript(source)
    await until(() => run('Boolean(document.querySelector(".send-mode-tabs"))'))
    await run(`Array.from(document.querySelectorAll('.send-mode-tabs button')).find(b => b.textContent === '固件烧录').click()`)
    assert(await run(`!document.querySelector('.firmware-host').hidden`))
    assert(await run(`document.querySelector('[aria-label="芯片系列"]').value === 'stm32'`))
    await run(`(() => { const s = document.querySelector('[aria-label="芯片系列"]'); s.value = 'esp32'; s.dispatchEvent(new Event('change', {bubbles:true})); })()`)
    await until(() => run(`Boolean(document.querySelector('.firmware-tool-ok')?.textContent.includes('5.3.1'))`))
    await run(`Array.from(document.querySelectorAll('.firmware-panel button')).find(b => b.textContent === '添加 BIN').click()`)
    await until(() => run(`document.querySelectorAll('.firmware-file').length === 1`))
    assert(await run(`Array.from(document.querySelectorAll('.firmware-panel button')).find(b => b.textContent === '开始烧录').disabled`))
    await run(`Array.from(document.querySelectorAll('.send-mode-tabs button')).find(b => b.textContent === '发送消息').click()`)
    assert(await run(`document.querySelector('.firmware-host').hidden`))
    await run(`Array.from(document.querySelectorAll('.send-mode-tabs button')).find(b => b.textContent === '固件烧录').click()`)
    assert.equal(await run(`document.querySelectorAll('.firmware-file').length`), 1)
    await run(`Array.from(document.querySelectorAll('.firmware-panel button')).find(b => b.textContent.includes('高级设置')).click()`)
    await new Promise(resolve => setTimeout(resolve, 1200))
    const layout = await run(`(() => { const panel = document.querySelector('.firmware-panel').getBoundingClientRect(); const footer = document.querySelector('.firmware-footer').getBoundingClientRect(); return { panel: panel.toJSON(), footer: footer.toJSON(), overflow: document.documentElement.scrollWidth > innerWidth }; })()`)
    assert(!layout.overflow, 'page must not overflow horizontally')
    assert(layout.footer.bottom <= layout.panel.bottom + 1, 'actions must remain in the panel')
    assert(layout.footer.height > 25)
    fs.writeFileSync(path.join(root, 'build', 'firmware-ui.png'), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    window.setContentSize(980, 650)
    await new Promise(resolve => setTimeout(resolve, 1200))
    fs.writeFileSync(path.join(root, 'build', 'firmware-ui-compact.png'), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    assert(await run(`document.documentElement.scrollWidth <= innerWidth`))
    const serialOptions = { path: 'COM991', baudRate: 57600, dataBits: 8, stopBits: 1, parity: 'none' }
    await run(`window.api.openPort(${JSON.stringify(serialOptions)})`)
    const request = { family: 'esp32', transport: 'uart', port: 'COM991', probe: '', chip: 'auto', baudRate: 115200, files: [{ path: fixture, name: 'application.bin', size: 4, address: '0x1000' }], verify: true, reset: true, restorePort: true, eraseAll: false, manualBoot: false, connectMode: 'NORMAL', toolPath: '' }
    await run(`window.api.startFirmware(${JSON.stringify(request)}, 'flash')`)
    await until(() => Boolean(finishFirmware))
    assert.deepEqual(await run(`window.api.getOpenedPortPaths()`), [])
    const deniedOpen = await run(`window.api.openPort(${JSON.stringify(serialOptions)}).then(() => '', e => e.message)`)
    assert.match(deniedOpen, /独占/)
    assert.match(await run(`window.api.write('COM991', 'AQ==').then(() => '', e => e.message)`), /独占/)
    finishFirmware()
    await until(() => run(`window.api.getFirmwareState().then(s => !s.busy)`))
    assert.equal(await run(`window.api.getFirmwareState().then(s => s.outcome)`), 'success')
    assert.deepEqual(await run(`window.api.getOpenedPortPaths()`), ['COM991'])
    assert.equal(openedOptions.at(-1).baudRate, 57600, 'original serial settings must be restored')
    await run(`window.api.closePort('COM991')`)
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log('PASS: real Electron preload, third tab, esptool discovery, file picker, state persistence, compact layout, and main-process serial exclusion/restoration using simulated hardware.')
    clearTimeout(deadline)
    app.quit()
  } catch (error) { console.error(error); clearTimeout(deadline); app.exit(1) }
})
