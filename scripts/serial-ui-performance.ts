// Run after a production build with bun run test:ui:serial. No real port is opened.
import { app, BrowserWindow } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import assert from 'node:assert/strict'
import NodeModule, { createRequire } from 'node:module'

const root = process.cwd()
const moduleRequire = createRequire(path.join(root, 'package.json'))
const Module = NodeModule as unknown as { _load: (name: string, ...args: unknown[]) => unknown }
const load = Module._load
Module._load = function (name, ...args) {
  if (name === 'serialport')
    return {
      SerialPort: class {
        static async list() {
          return [{ path: 'COM991', manufacturer: 'Simulated UI benchmark' }]
        }
      }
    }
  return load.call(this, name, ...args)
}
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('in-process-gpu')
const profile = fs.mkdtempSync(path.join(root, 'build', 'firmware-qa-serial-'))
app.setPath('appData', profile)
app.setPath('userData', profile)
app.getAppPath = () => root
BrowserWindow.prototype.show = function () {
  /* Isolated benchmark window. */
}
const errors: string[] = []
app.on('web-contents-created', (_event, contents) => {
  contents.setBackgroundThrottling(false)
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message)
  })
})
moduleRequire(path.join(root, 'out/main/index.js'))
async function until(fn: () => unknown | Promise<unknown>, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await fn()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('UI condition timed out')
}
const deadline = setTimeout(() => {
  console.error('Serial UI benchmark timed out')
  app.exit(1)
}, 60000)
app.whenReady().then(async () => {
  let timer: ReturnType<typeof setInterval> | undefined
  try {
    await until(() => BrowserWindow.getAllWindows().length)
    const window = BrowserWindow.getAllWindows()[0]
    window.setOpacity(0)
    window.setSkipTaskbar(true)
    window.showInactive()
    const run = (source: string) => window.webContents.executeJavaScript(source)
    await until(() => run('Boolean(document.querySelector(".send-mode-tabs"))'))
    await run(
      `Array.from(document.querySelectorAll('.send-mode-tabs button')).find(b => b.textContent === '固件烧录').click()`
    )
    await run(
      `window.__lags = []; window.__tasks = []; window.__observer = new PerformanceObserver(list => window.__tasks.push(...list.getEntries().map(e => e.duration))); window.__observer.observe({entryTypes:['longtask']}); window.__tick = performance.now(); window.__timer = setInterval(() => { const now = performance.now(); window.__lags.push(Math.max(0, now-window.__tick-10)); window.__tick=now }, 10)`
    )
    const bytes = new Uint8Array(Buffer.from('2,22,551'))
    let sent = 0
    console.log('READY')
    const start = Date.now()
    timer = setInterval(() => {
      const due = Math.min(100, Math.floor((Date.now() - start) / 10) * 10 - sent)
      if (due <= 0) return
      sent += due
      window.webContents.send('serial:data', {
        path: 'COM991',
        chunks: Array.from({ length: due }, () => bytes)
      })
    }, 10)
    const latencies: number[] = []
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const before = Date.now()
      await run(
        `new Promise(resolve => { const s = document.querySelector('[aria-label="芯片系列"]'); s.value = '${i % 2 ? 'stm32' : 'esp32'}'; s.dispatchEvent(new Event('change', {bubbles:true})); setTimeout(() => resolve(s.value), 0); })`
      )
      latencies.push(Date.now() - before)
    }
    clearInterval(timer)
    await new Promise((resolve) => setTimeout(resolve, 500))
    const metrics = await run(
      `(() => { clearInterval(window.__timer); window.__observer.disconnect(); const lag=window.__lags.sort((a,b)=>a-b); return {lagP95:lag[Math.floor(lag.length*.95)],lagMax:Math.max(...lag),longTasks:window.__tasks.length,longTaskMs:window.__tasks.reduce((a,b)=>a+b,0),lastId:Math.max(...Array.from(document.querySelectorAll('[data-interaction-id]')).map(e=>Number(e.dataset.interactionId))),footer:document.querySelector('footer')?.textContent} })()`
    )
    console.log(JSON.stringify({ sent, latencies, ...metrics }))
    assert.equal(metrics.lastId, sent, 'Display must catch up to the last received frame')
    assert.equal(
      Number(/RX ([\d,]+) 次/.exec(metrics.footer)?.[1].replaceAll(',', '')),
      sent,
      'Every received frame must be counted'
    )
    assert(errors.length === 0, errors.join('\n'))
    clearTimeout(deadline)
    app.exit(0)
  } catch (error) {
    if (timer) clearInterval(timer)
    console.error(error)
    app.exit(1)
  }
})
