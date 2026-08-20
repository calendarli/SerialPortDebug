import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { SerialPort } from 'serialport'
import icon from '../../resources/icon-v3.png?asset'
import { FileTransferManager } from './file-transfer'

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
let fileTransferManager: FileTransferManager | null = null

function virtualSerialPaths(): { manager: string; inf: string } {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'virtual-serial')
    : join(app.getAppPath(), 'driver', 'SerialFlowVirtualSerial')
  return {
    manager: app.isPackaged
      ? join(root, 'SerialFlowVirtualSerialManager.exe')
      : join(root, 'Manager', 'x64', 'Release', 'SerialFlowVirtualSerialManager.exe'),
    inf: app.isPackaged
      ? join(root, 'virtualserial2um.inf')
      : join(root, 'ComPort', 'x64', 'Debug', 'VirtualSerial2um', 'virtualserial2um.inf')
  }
}

function virtualSerialCertificatePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'virtual-serial', 'SerialFlowVirtualSerial.cer')
    : join(
        app.getAppPath(),
        'driver',
        'SerialFlowVirtualSerial',
        'ComPort',
        'x64',
        'Debug',
        'SerialFlowVirtualSerial.cer'
      )
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 30000 },
      (error, stdout, stderr) => {
        if (!error) return resolve(String(stdout).trim())
        reject(new Error(String(stderr || stdout || error.message).trim()))
      }
    )
  )
}

async function isVirtualSerialCertificateInstalled(certificatePath: string): Promise<boolean> {
  if (!existsSync(certificatePath)) return false
  const script = `$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(${quotePowerShell(certificatePath)}); $root = Test-Path ('Cert:\\LocalMachine\\Root\\' + $certificate.Thumbprint); $publisher = Test-Path ('Cert:\\LocalMachine\\TrustedPublisher\\' + $certificate.Thumbprint); Write-Output ($root -and $publisher)`
  return (await runPowerShell(script)).trim().toLowerCase() === 'true'
}

function installVirtualSerialCertificate(certificatePath: string): Promise<string> {
  const innerScript = `$ErrorActionPreference = 'Stop'; Import-Certificate -FilePath ${quotePowerShell(certificatePath)} -CertStoreLocation 'Cert:\\LocalMachine\\Root' | Out-Null; Import-Certificate -FilePath ${quotePowerShell(certificatePath)} -CertStoreLocation 'Cert:\\LocalMachine\\TrustedPublisher' | Out-Null`
  const encoded = Buffer.from(innerScript, 'utf16le').toString('base64')
  const outerScript = `$process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','${encoded}') -Verb RunAs -WindowStyle Hidden -Wait -PassThru; Write-Output $process.ExitCode`
  return runPowerShell(outerScript).then((output) => {
    if (Number(output) !== 0) throw new Error(`证书安装失败，安装程序退出码：${output}`)
    return 'SerialFlow 测试签名证书已安装'
  })
}

async function getVirtualPortAvailability(): Promise<{
  occupiedPorts: string[]
  availablePorts: string[]
}> {
  const occupiedPorts = (await SerialPort.list())
    .map((item) => item.path.trim().toUpperCase())
    .filter((path) => /^COM(?:[1-9]|[1-9]\d|[1-9]\d{2})$/.test(path))
    .filter((path, index, ports) => ports.indexOf(path) === index)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const occupied = new Set(occupiedPorts)
  const availablePorts = Array.from({ length: 999 }, (_, index) => `COM${index + 1}`).filter(
    (path) => !occupied.has(path)
  )
  return { occupiedPorts, availablePorts }
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function runTool(path: string, args: string[]): Promise<string> {
  const argumentList = args.map(quotePowerShell).join(',')
  const command = `$process = Start-Process -FilePath ${quotePowerShell(path)} -ArgumentList @(${argumentList}) -Verb RunAs -WindowStyle Hidden -Wait -PassThru; Write-Output $process.ExitCode`
  return new Promise((resolve, reject) =>
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 120000 },
      (error, stdout, stderr) => {
        const exitCode = Number(String(stdout).trim())
        if (!error && (exitCode === 0 || exitCode === 1)) {
          resolve(exitCode === 1 ? '操作完成，需要重启系统后完全生效' : '操作成功')
          return
        }
        if (error) {
          const detail = String(stderr || stdout || error.message).trim()
          reject(
            new Error(
              /cancel|canceled|取消|1223/i.test(detail)
                ? '已取消管理员授权，未更改虚拟串口配置'
                : `SerialFlow 虚拟串口操作失败：${detail}`
            )
          )
          return
        }
        reject(new Error(`SerialFlow 虚拟串口操作失败，管理程序退出码：${exitCode}`))
      }
    )
  )
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
  if (fileTransferManager?.handleIncoming(path, chunk)) return
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

async function writeRawPort(path: string, data: Buffer): Promise<void> {
  const active = openPorts.get(path)
  if (!active?.isOpen) throw new Error(`串口 ${path} 未打开`)
  await new Promise<void>((resolve, reject) =>
    active.write(data, (error) => (error ? reject(error) : resolve()))
  )
}

function registerSerialHandlers(): void {
  fileTransferManager = new FileTransferManager(writeRawPort, (progress) =>
    emit('fileTransfer:progress', progress)
  )
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
  ipcMain.handle('virtualPorts:status', async () => {
    const paths = virtualSerialPaths()
    const certificatePath = virtualSerialCertificatePath()
    const endpoints = (await SerialPort.list())
      .filter((item) => item.manufacturer === 'SerialFlow')
      .map((item) => item.path)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const { occupiedPorts, availablePorts } = await getVirtualPortAvailability()
    const pairs: string[] = []
    for (let index = 0; index < endpoints.length; index += 2)
      pairs.push(`${endpoints[index]} ↔ ${endpoints[index + 1] || '等待对端'}`)
    return {
      installed: endpoints.length > 0 || (existsSync(paths.manager) && existsSync(paths.inf)),
      pairs,
      occupiedPorts,
      availablePorts,
      commandPath: paths.manager,
      certificateAvailable: existsSync(certificatePath),
      certificateInstalled: await isVirtualSerialCertificateInstalled(certificatePath),
      message: endpoints.length ? `SerialFlow 驱动已启动，共 ${endpoints.length} 个端点` : undefined
    }
  })
  ipcMain.handle('virtualPorts:installCertificate', async () => {
    const certificatePath = virtualSerialCertificatePath()
    if (!existsSync(certificatePath)) throw new Error('未找到 SerialFlow 测试签名证书')
    try {
      return await installVirtualSerialCertificate(certificatePath)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        /cancel|canceled|取消|1223/i.test(detail)
          ? '已取消管理员授权，证书未安装'
          : `安装 SerialFlow 测试签名证书失败：${detail}`
      )
    }
  })
  ipcMain.handle('virtualPorts:create', async (_event, first: string, second: string) => {
    const paths = virtualSerialPaths()
    if (!existsSync(paths.manager) || !existsSync(paths.inf))
      throw new Error('SerialFlow 虚拟串口驱动包不完整')
    const portA = first.trim().toUpperCase()
    const portB = second.trim().toUpperCase()
    if (
      !/^COM(?:[1-9]|[1-9]\d|[1-9]\d{2})$/.test(portA) ||
      !/^COM(?:[1-9]|[1-9]\d|[1-9]\d{2})$/.test(portB)
    )
      throw new Error('端口名称必须是 COM1–COM999')
    if (portA === portB) throw new Error('串口对的两个端口不能相同')
    const { occupiedPorts } = await getVirtualPortAvailability()
    const before = new Set(occupiedPorts)
    if (before.has(portA) || before.has(portB)) throw new Error('所选 COM 端口已被系统占用')
    const output = await runTool(paths.manager, ['create-pair', paths.inf, portA, portB])
    const created = (await SerialPort.list())
      .filter((item) => item.manufacturer === 'SerialFlow' && !before.has(item.path))
      .map((item) => item.path)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    return { first: created[0] || portA, second: created[1] || portB, output }
  })
  ipcMain.handle('virtualPorts:remove', async (_event, first: string, second: string) => {
    const { manager } = virtualSerialPaths()
    if (!existsSync(manager)) throw new Error('未检测到 SerialFlow 管理程序')
    for (const port of [first, second]) if (openPorts.has(port)) await closePort(port)
    return runTool(manager, ['remove-pair', first, second])
  })
  ipcMain.handle('virtualPorts:openManager', async () => {
    const { manager } = virtualSerialPaths()
    if (!existsSync(manager)) throw new Error('未检测到 SerialFlow 管理程序')
    shell.showItemInFolder(manager)
  })
  ipcMain.handle('virtualPorts:openDownload', () => Promise.resolve())
  ipcMain.handle('fileTransfer:selectFile', async () => {
    if (!mainWindow) throw new Error('应用窗口尚未就绪')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择要通过串口发送的文件',
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    const info = await stat(filePath)
    return { path: filePath, name: filePath.split(/[\\/]/).at(-1) || '未命名文件', size: info.size }
  })
  ipcMain.handle('fileTransfer:selectDirectory', async () => {
    if (!mainWindow) throw new Error('应用窗口尚未就绪')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择串口接收文件的保存目录',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0] || null
  })
  ipcMain.handle('fileTransfer:setReceiver', async (_event, port: string, directory?: string) => {
    await fileTransferManager!.setReceiver(port, directory)
  })
  ipcMain.handle(
    'fileTransfer:send',
    (_event, port: string, filePath: string, chunkSize: number, protocol: 'serialflow' | 'raw') =>
      fileTransferManager!.sendFile(port, filePath, chunkSize, protocol)
  )
  ipcMain.handle('fileTransfer:cancel', (_event, taskId: string) =>
    fileTransferManager!.cancel(taskId)
  )
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
  ipcMain.handle('modbus:openMap', async () => {
    if (!mainWindow) throw new Error('应用窗口尚未就绪')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入 Modbus Poll 寄存器映射',
      properties: ['openFile'],
      filters: [
        { name: 'Modbus 配置', extensions: ['mbp', 'json'] },
        { name: 'Modbus Poll 配置', extensions: ['mbp'] },
        { name: 'SerialFlow Modbus 配置', extensions: ['json'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const content = await readFile(result.filePaths[0])
    return {
      path: result.filePaths[0],
      name: result.filePaths[0].split(/[\\/]/).at(-1) || 'Modbus map.mbp',
      base64: content.toString('base64')
    }
  })
  ipcMain.handle('modbus:saveMap', async (_event, config: unknown) => {
    if (!mainWindow) throw new Error('应用窗口尚未就绪')
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出 Modbus RTU 配置',
      defaultPath: 'modbus-register-map.json',
      filters: [{ name: 'SerialFlow Modbus 配置', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, JSON.stringify(config, null, 2), 'utf8')
    return result.filePath
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
      const isProgrammingManual = target.pathname.endsWith('/programming-manual.html')
      const isLocalManual =
        isProgrammingManual &&
        (target.protocol === 'file:' ||
          (is.dev &&
            Boolean(process.env['ELECTRON_RENDERER_URL']) &&
            target.origin === new URL(process.env['ELECTRON_RENDERER_URL']!).origin))
      if (isLocalManual)
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 980,
            height: 760,
            minWidth: 720,
            minHeight: 520,
            autoHideMenuBar: true,
            title: 'SerialFlow 编程参数手册',
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
          }
        }
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.serialportdebug.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  registerSerialHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  void closeAllPorts()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
