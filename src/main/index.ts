import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { SerialPort } from 'serialport'
import icon from '../../resources/icon.png?asset'

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
let portOperationQueue: Promise<void> = Promise.resolve()

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

async function closePort(path: string): Promise<void> {
  const active = openPorts.get(path)
  openPorts.delete(path)
  writeQueues.delete(path)
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
        emit('serial:data', { path: options.path, base64: chunk.toString('base64') })
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
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
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

app.on('before-quit', () => void closeAllPorts())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
