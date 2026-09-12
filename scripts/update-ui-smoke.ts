// Isolated Electron QA: simulated updates, no network, installation or user profile changes.
import { app, BrowserWindow, dialog } from 'electron'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import NodeModule, { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const root = process.cwd()
process.on('uncaughtException', (error) => {
  console.error(error)
  app.exit(1)
})
app.on('web-contents-created', (_event, contents) => {
  contents.setBackgroundThrottling(false)
  contents.on('console-message', (details) => {
    if (details.level === 'error') console.error(details.message)
  })
  contents.on('render-process-gone', (_event, details) => console.error('Renderer exited', details))
})
const require = createRequire(join(root, 'package.json'))
const Module = NodeModule as unknown as { _load: (name: string, ...args: unknown[]) => unknown }
const load = Module._load
let checks = 0
let downloads = 0
let installs = 0
let confirmation = false
let prompts = 0
const updater = Object.assign(new EventEmitter(), {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  checkForUpdates: async () => {
    checks++
    updater.emit('update-available', { version: '99.0.0' })
    return {}
  },
  downloadUpdate: async () => {
    downloads++
    return []
  },
  quitAndInstall: () => {
    installs++
  }
})
class FakeSerialPort extends EventEmitter {
  static async list() {
    return []
  }
}
Module._load = function (name, ...args) {
  if (name === 'electron-updater') return { autoUpdater: updater }
  if (name === 'serialport') return { SerialPort: FakeSerialPort }
  return load.call(this, name, ...args)
}
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('in-process-gpu')
const profile = mkdtempSync(join(root, '.tmp', 'ui-smoke', 'firmware-qa-updates-'))
app.setPath('appData', profile)
app.setPath('userData', profile)
app.getAppPath = () => root
Object.defineProperty(app, 'isPackaged', { get: () => true })
BrowserWindow.prototype.show = function () {
  /* Keep QA hidden. */
}
dialog.showMessageBox = (async (...args: unknown[]) => {
  const options = args.at(-1) as { message: string; defaultId: number; cancelId: number }
  assert.match(options.message, /程序将关闭并安装更新/)
  assert.equal(options.defaultId, 0)
  assert.equal(options.cancelId, 0)
  prompts++
  return { response: confirmation ? 1 : 0, checkboxChecked: false }
}) as typeof dialog.showMessageBox
require(join(root, 'out/main/index.js'))
const deadline = setTimeout(() => {
  console.error('Update UI deadline exceeded')
  app.exit(1)
}, 45000)
async function until(predicate: () => unknown | Promise<unknown>) {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error('Update UI condition timed out')
}
void app.whenReady().then(async () => {
  try {
    await until(() => BrowserWindow.getAllWindows().length)
    const window = BrowserWindow.getAllWindows()[0]
    const run = (source: string) => window.webContents.executeJavaScript(source)
    await until(() =>
      run(`document.querySelector('.update-notice')?.textContent.includes('99.0.0')`)
    )
    assert.equal(checks, 1)
    assert.equal(downloads, 0)
    assert.equal(updater.autoInstallOnAppQuit, false)
    await run(`document.querySelector('[aria-label="关于"]').click()`)
    await until(() =>
      run(`document.querySelector('.about-update button')?.textContent === '下载更新'`)
    )
    await run(`document.querySelector('.about-update button').click()`)
    await until(() => downloads === 1)
    updater.emit('download-progress', {
      percent: 42.5,
      transferred: 44564480,
      total: 104857600,
      bytesPerSecond: 2097152
    })
    await until(() => run(`document.querySelector('.about-update progress')?.value === 42.5`))
    await run(`document.querySelector('.about-update').scrollIntoView({block: 'nearest'})`)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    writeFileSync(
      join(profile, 'update-progress.png'),
      (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG()
    )
    assert(await run(`document.documentElement.scrollWidth <= innerWidth`))
    await run(`document.querySelector('[aria-label="串口"]').click()`)
    updater.emit('update-downloaded', { version: '99.0.0' })
    await until(() =>
      run(`document.querySelector('.update-notice')?.textContent.includes('更新已下载完成')`)
    )
    await run(`document.querySelector('.update-notice .update-controls button').click()`)
    await until(() => prompts === 1)
    assert.equal(installs, 0)
    assert(
      await run(
        `document.querySelector('.update-notice .update-controls button').textContent === '安装更新'`
      )
    )
    confirmation = true
    await run(`document.querySelector('.update-notice .update-controls button').click()`)
    await until(() => installs === 1)
    assert.equal(prompts, 2)
    console.log(`Update UI checks passed. Screenshot: ${join(profile, 'update-progress.png')}`)
    clearTimeout(deadline)
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
