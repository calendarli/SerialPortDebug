import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { createWriteStream, type WriteStream } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { SerialPort } from 'serialport'
import icon from '../../resources/icon-v3.png?asset'

type PortOptions = {
  path: string
  baudRate: number
  dataBits: 5 | 6 | 7 | 8
  stopBits: 1 | 1.5 | 2
  parity: 'none' | 'even' | 'odd' | 'mark' | 'space'
}

function validatePortOptions(options: PortOptions): void {
  if (!options || typeof options !== 'object') throw new Error('串口配置无效，请重新选择参数')
  if (!options.path?.trim()) throw new Error('串口名称不能为空')
  if (!Number.isInteger(options.baudRate) || options.baudRate <= 0)
    throw new Error('波特率必须是正整数')
  if (![5, 6, 7, 8].includes(options.dataBits)) throw new Error('数据位只能选择 5、6、7 或 8')
  if (![1, 1.5, 2].includes(options.stopBits)) throw new Error('停止位只能选择 1、1.5 或 2')
  if (!['none', 'even', 'odd', 'mark', 'space'].includes(options.parity))
    throw new Error('校验位参数无效')
  if (options.stopBits === 1.5 && options.dataBits !== 5) {
    throw new Error('Windows 仅允许 5 数据位搭配 1.5 停止位，请改为 1 停止位')
  }
  if (options.stopBits === 2 && options.dataBits === 5) {
    throw new Error('Windows 的 5 数据位不能搭配 2 停止位，请使用 1.5 停止位')
  }
}

function explainOpenError(error: unknown, options: PortOptions): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/SetCommState|parameter is incorrect|参数错误/i.test(message)) {
    return new Error(
      `驱动拒绝串口参数：${options.path}，${options.baudRate} baud，${options.dataBits}${options.parity === 'none' ? 'N' : options.parity[0].toUpperCase()}${options.stopBits}。` +
        '请先尝试 115200/8/N/1；若可打开，说明当前 USB 转串口芯片或驱动不支持所选波特率。'
    )
  }
  if (/access denied|permission denied|resource busy|busy/i.test(message)) {
    return new Error(
      `无法打开 ${options.path}：端口正被其他程序占用。请关闭其他串口工具、烧录软件或旧的应用进程后重试`
    )
  }
  if (/file not found|cannot find|no such file|not found/i.test(message)) {
    return new Error(`找不到串口 ${options.path}：设备可能已拔出或端口号已变化，请刷新端口列表`)
  }
  if (/not functioning|i\/o error|input\/output|device.*error/i.test(message)) {
    return new Error(`无法使用 ${options.path}：设备或驱动工作异常，请重新插拔设备并检查驱动`)
  }
  return new Error(`打开 ${options.path} 失败：${message.replace(/^Error:\s*/i, '')}`)
}

function explainRuntimeError(
  error: unknown,
  action: '读取端口列表' | '关闭串口' | '发送数据' | '串口通信',
  path?: string
): Error {
  const message = (error instanceof Error ? error.message : String(error)).replace(
    /^Error:\s*/i,
    ''
  )
  if (/port is not open|not open|串口未打开/i.test(message))
    return new Error('串口未打开或已经断开，请重新打开串口')
  if (/access denied|permission denied|resource busy|busy/i.test(message))
    return new Error(`${action}失败：串口被其他程序占用或当前账户没有访问权限`)
  if (/file not found|cannot find|no such file|not found/i.test(message))
    return new Error(`${path ? `串口 ${path}` : '串口设备'} 不存在，请刷新端口列表并检查设备连接`)
  if (/disconnected|device.*removed|not functioning|i\/o error|input\/output/i.test(message))
    return new Error(`${path ? `串口 ${path}` : '串口设备'} 已断开或驱动异常，请重新插拔设备`)
  if (/timeout|timed out/i.test(message))
    return new Error(`${action}超时，请检查设备连接、波特率和流控状态`)
  return new Error(`${action}失败：${message}`)
}

const openPorts = new Map<string, SerialPort>()
let mainWindow: BrowserWindow | null = null
const writeQueues = new Map<string, Promise<void>>()
const receiveBatches = new Map<
  string,
  { chunks: Uint8Array[]; bytes: number; timer?: NodeJS.Timeout }
>()
let portOperationQueue: Promise<void> = Promise.resolve()
let sessionStream: WriteStream | null = null
let sessionFile = ''
let sessionEvents = 0
let sessionBytes = 0
let replayGeneration = 0

function recordSession(direction: 'rx' | 'tx', path: string, data: Uint8Array): void {
  if (!sessionStream) return
  const entry = JSON.stringify({
    type: 'data',
    timestamp: Date.now(),
    direction,
    port: path,
    bytes: data.length,
    base64: Buffer.from(data).toString('base64')
  })
  sessionStream.write(`${entry}\n`)
  sessionEvents += 1
  sessionBytes += data.length
}

async function stopSession(): Promise<{
  path: string
  events: number
  bytes: number
} | null> {
  if (!sessionStream) return null
  const stream = sessionStream
  const result = { path: sessionFile, events: sessionEvents, bytes: sessionBytes }
  sessionStream = null
  sessionFile = ''
  await new Promise<void>((resolve, reject) =>
    stream.end((error?: Error | null) => (error ? reject(error) : resolve()))
  )
  return result
}

function enqueuePortOperation<T>(operation: () => Promise<T>): Promise<T> {
  const task = portOperationQueue.catch(() => undefined).then(operation)
  portOperationQueue = task.then(
    () => undefined,
    () => undefined
  )
  return task
}

function emit(channel: string, value: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value)
}

function flushReceiveBatch(path: string): void {
  const batch = receiveBatches.get(path)
  if (!batch) return
  if (batch.timer) clearTimeout(batch.timer)
  receiveBatches.delete(path)
  if (batch.chunks.length) emit('serial:data', { path, chunks: batch.chunks })
}

function queueReceivedData(path: string, chunk: Buffer): void {
  recordSession('rx', path, chunk)
  const batch = receiveBatches.get(path) || { chunks: [], bytes: 0 }
  batch.chunks.push(new Uint8Array(chunk))
  batch.bytes += chunk.length
  receiveBatches.set(path, batch)
  if (batch.bytes >= 64 * 1024) flushReceiveBatch(path)
  else if (!batch.timer) batch.timer = setTimeout(() => flushReceiveBatch(path), 4)
}

async function closePort(path: string): Promise<void> {
  const active = openPorts.get(path)
  openPorts.delete(path)
  writeQueues.delete(path)
  flushReceiveBatch(path)
  if (active?.isOpen) {
    try {
      await new Promise<void>((resolve, reject) =>
        active.close((error) => (error ? reject(error) : resolve()))
      )
    } catch (error) {
      throw explainRuntimeError(error, '关闭串口', active.path)
    }
  }
  emit('serial:status', { path, open: false })
}

async function closeAllPorts(): Promise<void> {
  await Promise.allSettled([...openPorts.keys()].map(closePort))
}

function registerSerialHandlers(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  }))
  ipcMain.handle('serial:list', async () => {
    try {
      return await SerialPort.list()
    } catch (error) {
      throw explainRuntimeError(error, '读取端口列表')
    }
  })
  ipcMain.handle('session:start', async () => {
    if (!mainWindow) throw new Error('应用窗口尚未就绪')
    if (sessionStream) return { path: sessionFile }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存串口会话',
      defaultPath: `SerialFlow-${new Date().toISOString().replace(/[:.]/g, '-')}.serialflow-session`,
      filters: [{ name: 'SerialFlow 会话', extensions: ['serialflow-session'] }]
    })
    if (result.canceled || !result.filePath) return null
    sessionFile = result.filePath
    sessionEvents = 0
    sessionBytes = 0
    sessionStream = createWriteStream(sessionFile, { encoding: 'utf8' })
    sessionStream.write(
      `${JSON.stringify({ type: 'header', version: 1, application: 'SerialFlow', createdAt: Date.now() })}\n`
    )
    return { path: sessionFile }
  })
  ipcMain.handle('session:stop', () => stopSession())
  ipcMain.handle('session:replay', async () => {
    if (!mainWindow) throw new Error('应用窗口尚未就绪')
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '回放串口会话',
      properties: ['openFile'],
      filters: [{ name: 'SerialFlow 会话', extensions: ['serialflow-session'] }]
    })
    if (selected.canceled || !selected.filePaths[0]) return null
    const generation = ++replayGeneration
    const lines = (await readFile(selected.filePaths[0], 'utf8')).split(/\r?\n/)
    let previousTimestamp = 0
    let events = 0
    for (const line of lines) {
      if (generation !== replayGeneration) break
      if (!line.trim()) continue
      const item = JSON.parse(line) as {
        type?: string
        timestamp?: number
        direction?: string
        port?: string
        base64?: string
      }
      if (item.type !== 'data' || item.direction !== 'rx' || !item.base64) continue
      const timestamp = Number(item.timestamp) || previousTimestamp
      if (previousTimestamp && timestamp > previousTimestamp)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(2000, timestamp - previousTimestamp))
        )
      previousTimestamp = timestamp
      emit('serial:data', {
        path: `[回放] ${item.port || '串口'}`,
        chunks: [new Uint8Array(Buffer.from(item.base64, 'base64'))],
        replay: true
      })
      events += 1
    }
    return { path: selected.filePaths[0], events, stopped: generation !== replayGeneration }
  })
  ipcMain.handle('session:stopReplay', () => {
    replayGeneration += 1
  })
  ipcMain.handle('project:save', async (_event, project: unknown) => {
    if (!mainWindow) throw new Error('应用窗口尚未就绪')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 SerialFlow 工程',
      defaultPath: 'SerialFlow-project.serialflow',
      filters: [{ name: 'SerialFlow 工程', extensions: ['serialflow'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, JSON.stringify(project, null, 2), 'utf8')
    return result.filePath
  })
  ipcMain.handle('project:open', async () => {
    if (!mainWindow) throw new Error('应用窗口尚未就绪')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入 SerialFlow 工程',
      properties: ['openFile'],
      filters: [{ name: 'SerialFlow 工程', extensions: ['serialflow', 'json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return { path: result.filePaths[0], content: await readFile(result.filePaths[0], 'utf8') }
  })
  ipcMain.handle('serial:open', async (_event, options: PortOptions) =>
    enqueuePortOperation(async () => {
      validatePortOptions(options)
      await closePort(options.path)
      let next: SerialPort
      try {
        next = new SerialPort({ ...options, autoOpen: false })
        await new Promise<void>((resolve, reject) =>
          next.open((error) => (error ? reject(error) : resolve()))
        )
      } catch (error) {
        throw explainOpenError(error, options)
      }
      openPorts.set(options.path, next)
      next.on('data', (chunk: Buffer) => {
        queueReceivedData(options.path, chunk)
      })
      next.on('error', (error) =>
        emit('serial:error', {
          path: options.path,
          message: explainRuntimeError(error, '串口通信', next.path).message
        })
      )
      next.on('close', () => {
        const unexpected = openPorts.get(options.path) === next
        if (unexpected) {
          openPorts.delete(options.path)
          writeQueues.delete(options.path)
          emit('serial:error', {
            path: options.path,
            message: `串口 ${next.path} 连接意外中断，请检查 USB 连接、供电和驱动状态`
          })
        }
        emit('serial:status', { path: options.path, open: false })
      })
      emit('serial:status', { open: true, path: options.path })
      return true
    })
  )
  ipcMain.handle('serial:close', async (_event, path: string) =>
    enqueuePortOperation(() => closePort(path))
  )
  ipcMain.handle('serial:write', async (_event, path: string, base64: string) => {
    if (!path) throw new Error('请选择发送串口')
    if (typeof base64 !== 'string' || !base64) throw new Error('发送内容不能为空')
    const data = Buffer.from(base64, 'base64')
    if (!data.length) throw new Error('发送内容不能为空')
    const previous = writeQueues.get(path) || Promise.resolve()
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        const active = openPorts.get(path)
        if (!active?.isOpen) throw new Error('串口未打开')
        try {
          await new Promise<void>((resolve, reject) => {
            active.write(data, (error) => {
              if (error) return reject(error)
              active.drain((drainError) => (drainError ? reject(drainError) : resolve()))
            })
          })
          recordSession('tx', path, data)
        } catch (error) {
          throw explainRuntimeError(error, '发送数据', active.path)
        }
      })
    writeQueues.set(
      path,
      task.catch(() => undefined)
    )
    await task
    return data.length
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'https:' || target.protocol === 'http:') void shell.openExternal(url)
    } catch {
      /* Ignore invalid or unsafe external URLs. */
    }
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL'])
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.serialportdebug.app')
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
    registerSerialHandlers()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => {
  void stopSession()
  void closeAllPorts()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
