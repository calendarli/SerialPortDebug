import { createHash, randomBytes } from 'crypto'
import { createReadStream } from 'fs'
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'fs/promises'
import { basename, join } from 'path'

const MAGIC = Buffer.from([0x53, 0x46])
const VERSION = 1
const HEADER_SIZE = 14
const CRC_SIZE = 4
const MAX_PAYLOAD = 60 * 1024

const FrameType = {
  Begin: 0x01,
  BeginAck: 0x02,
  Data: 0x03,
  DataAck: 0x04,
  End: 0x05,
  Complete: 0x06,
  Error: 0x07,
  Cancel: 0x08
} as const

type TransferState =
  'preparing' | 'waiting' | 'transferring' | 'verifying' | 'completed' | 'error' | 'cancelled'

export type TransferProgress = {
  taskId: string
  direction: 'send' | 'receive'
  port: string
  fileName: string
  filePath?: string
  totalBytes: number
  transferredBytes: number
  state: TransferState
  message: string
  retries: number
  startedAt: number
  bytesPerSecond: number
  protocol: 'serialflow' | 'raw'
}

type Frame = { type: number; sessionId: number; sequence: number; payload: Buffer }
type SenderTask = TransferProgress & { cancelled: boolean; sessionId: number }
type ReceiverTask = TransferProgress & {
  sessionId: number
  chunkSize: number
  sha256: string
  tempPath: string
  metaPath: string
  nextSequence: number
  handle: Awaited<ReturnType<typeof open>>
}
type Waiter = {
  types: number[]
  sequence?: number
  resolve: (frame: Frame) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const value of data) {
    crc ^= value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function encodeFrame(
  type: number,
  sessionId: number,
  sequence: number,
  payload = Buffer.alloc(0)
): Buffer {
  if (payload.length > MAX_PAYLOAD) throw new Error('文件传输帧负载过大')
  const frame = Buffer.alloc(HEADER_SIZE + payload.length + CRC_SIZE)
  MAGIC.copy(frame, 0)
  frame.writeUInt8(VERSION, 2)
  frame.writeUInt8(type, 3)
  frame.writeUInt32LE(sessionId, 4)
  frame.writeUInt32LE(sequence, 8)
  frame.writeUInt16LE(payload.length, 12)
  payload.copy(frame, HEADER_SIZE)
  frame.writeUInt32LE(
    crc32(frame.subarray(0, HEADER_SIZE + payload.length)),
    HEADER_SIZE + payload.length
  )
  return frame
}

class FrameParser {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer, callback: (frame: Frame) => void): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= HEADER_SIZE + CRC_SIZE) {
      const magicIndex = this.buffer.indexOf(MAGIC)
      if (magicIndex < 0) {
        this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 1))
        return
      }
      if (magicIndex > 0) this.buffer = this.buffer.subarray(magicIndex)
      if (this.buffer.length < HEADER_SIZE + CRC_SIZE) return
      if (this.buffer.readUInt8(2) !== VERSION) {
        this.buffer = this.buffer.subarray(2)
        continue
      }
      const payloadLength = this.buffer.readUInt16LE(12)
      const frameLength = HEADER_SIZE + payloadLength + CRC_SIZE
      if (payloadLength > MAX_PAYLOAD) {
        this.buffer = this.buffer.subarray(2)
        continue
      }
      if (this.buffer.length < frameLength) return
      const candidate = this.buffer.subarray(0, frameLength)
      this.buffer = this.buffer.subarray(frameLength)
      if (
        candidate.readUInt32LE(frameLength - CRC_SIZE) !==
        crc32(candidate.subarray(0, frameLength - CRC_SIZE))
      )
        continue
      callback({
        type: candidate.readUInt8(3),
        sessionId: candidate.readUInt32LE(4),
        sequence: candidate.readUInt32LE(8),
        payload: Buffer.from(candidate.subarray(HEADER_SIZE, frameLength - CRC_SIZE))
      })
    }
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

function safeFileName(name: string): string {
  const invalid = '<>:"/\\|?*'
  const safe = [...basename(name)]
    .map((character) =>
      character.charCodeAt(0) < 32 || invalid.includes(character) ? '_' : character
    )
    .join('')
    .trim()
  return safe && safe !== '.' && safe !== '..' ? safe : `received-${Date.now()}.bin`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class FileTransferManager {
  private parsers = new Map<string, FrameParser>()
  private receiveDirectories = new Map<string, string>()
  private senders = new Map<string, SenderTask>()
  private receivers = new Map<number, ReceiverTask>()
  private waiters = new Map<number, Waiter>()
  private completionFrames = new Map<number, Buffer>()
  private lastProgressEmits = new Map<string, number>()

  constructor(
    private writePort: (port: string, data: Buffer) => Promise<void>,
    private emitProgress: (progress: TransferProgress) => void
  ) {}

  isReserved(port: string): boolean {
    return (
      this.receiveDirectories.has(port) ||
      [...this.senders.values()].some(
        (task) =>
          task.port === port &&
          task.protocol === 'serialflow' &&
          !['completed', 'error', 'cancelled'].includes(task.state)
      )
    )
  }

  private isPortBusy(port: string): boolean {
    return (
      this.receiveDirectories.has(port) ||
      [...this.senders.values()].some(
        (task) => task.port === port && !['completed', 'error', 'cancelled'].includes(task.state)
      )
    )
  }

  async setReceiver(port: string, directory?: string): Promise<void> {
    if (!port) throw new Error('请选择接收串口')
    if (directory) {
      await mkdir(directory, { recursive: true })
      this.receiveDirectories.set(port, directory)
      return
    }
    this.receiveDirectories.delete(port)
  }

  handleIncoming(port: string, chunk: Buffer): boolean {
    if (!this.isReserved(port)) return false
    const parser = this.parsers.get(port) || new FrameParser()
    this.parsers.set(port, parser)
    parser.push(chunk, (frame) => void this.handleFrame(port, frame))
    return true
  }

  async sendFile(
    port: string,
    filePath: string,
    chunkSize = 1024,
    protocol: 'serialflow' | 'raw' = 'serialflow'
  ): Promise<string> {
    if (!port) throw new Error('请选择发送串口')
    if (this.isPortBusy(port)) throw new Error(`${port} 正在进行其他文件传输任务`)
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('请选择有效文件')
    const normalizedChunkSize = Math.min(32 * 1024, Math.max(256, Math.floor(chunkSize)))
    const sessionId = randomBytes(4).readUInt32LE(0)
    const taskId = `send-${sessionId}`
    const task: SenderTask = {
      taskId,
      direction: 'send',
      port,
      fileName: basename(filePath),
      filePath,
      totalBytes: info.size,
      transferredBytes: 0,
      state: 'preparing',
      message: protocol === 'raw' ? '正在准备原始二进制发送…' : '正在计算文件 SHA-256…',
      retries: 0,
      startedAt: Date.now(),
      bytesPerSecond: 0,
      protocol,
      cancelled: false,
      sessionId
    }
    this.senders.set(taskId, task)
    this.publish(task)
    const runner =
      protocol === 'raw'
        ? this.runRawSender(task, normalizedChunkSize)
        : this.runSender(task, normalizedChunkSize)
    void runner.catch((error) => {
      if (task.cancelled) return
      task.state = 'error'
      task.message = errorMessage(error)
      this.publish(task)
    })
    return taskId
  }

  private async runRawSender(task: SenderTask, chunkSize: number): Promise<void> {
    task.state = 'transferring'
    task.message = '正在发送原始二进制数据…'
    this.publish(task)
    const handle = await open(task.filePath!, 'r')
    let offset = 0
    try {
      while (offset < task.totalBytes) {
        this.ensureActive(task)
        const length = Math.min(chunkSize, task.totalBytes - offset)
        const buffer = Buffer.allocUnsafe(length)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        if (!bytesRead) throw new Error('读取文件时意外到达结尾')
        await this.writePort(task.port, buffer.subarray(0, bytesRead))
        offset += bytesRead
        task.transferredBytes = offset
        this.publish(task)
      }
    } finally {
      await handle.close()
    }
    task.state = 'completed'
    task.message = '原始数据已全部写入串口；下位机接收结果未知'
    task.transferredBytes = task.totalBytes
    this.publish(task)
  }

  async cancel(taskId: string): Promise<void> {
    const sender = this.senders.get(taskId)
    if (sender) {
      sender.cancelled = true
      sender.state = 'cancelled'
      sender.message = '传输已取消'
      this.rejectWaiter(sender.sessionId, new Error('传输已取消'))
      if (sender.protocol === 'serialflow')
        await this.writePort(sender.port, encodeFrame(FrameType.Cancel, sender.sessionId, 0)).catch(
          () => undefined
        )
      this.publish(sender)
      return
    }
    const receiver = [...this.receivers.values()].find((task) => task.taskId === taskId)
    if (receiver) {
      await receiver.handle.close()
      this.receivers.delete(receiver.sessionId)
      receiver.state = 'cancelled'
      receiver.message = '接收已取消，临时文件已保留以便续传'
      this.publish(receiver)
    }
  }

  private async runSender(task: SenderTask, chunkSize: number): Promise<void> {
    const sha256 = await sha256File(task.filePath!)
    this.ensureActive(task)
    task.state = 'waiting'
    task.message = '等待接收端确认…'
    this.publish(task)
    const beginPayload = Buffer.from(
      JSON.stringify({
        name: task.fileName,
        size: task.totalBytes,
        modifiedAt: (await stat(task.filePath!)).mtimeMs,
        sha256,
        chunkSize
      }),
      'utf8'
    )
    const beginAck = await this.sendWithRetry(
      task,
      encodeFrame(FrameType.Begin, task.sessionId, 0, beginPayload),
      [FrameType.BeginAck],
      0
    )
    const beginResult = JSON.parse(beginAck.payload.toString('utf8')) as {
      accepted?: boolean
      resumeOffset?: number
      message?: string
    }
    if (!beginResult.accepted) throw new Error(beginResult.message || '接收端拒绝了文件')
    let offset = Math.min(task.totalBytes, Math.max(0, Number(beginResult.resumeOffset) || 0))
    offset -= offset % chunkSize
    let sequence = Math.floor(offset / chunkSize)
    task.transferredBytes = offset
    task.state = 'transferring'
    task.message = offset ? `从 ${offset} 字节处继续传输` : '正在发送文件…'
    this.publish(task)
    const handle = await open(task.filePath!, 'r')
    try {
      while (offset < task.totalBytes) {
        this.ensureActive(task)
        const length = Math.min(chunkSize, task.totalBytes - offset)
        const buffer = Buffer.allocUnsafe(length)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        if (!bytesRead) throw new Error('读取文件时意外到达结尾')
        await this.sendWithRetry(
          task,
          encodeFrame(FrameType.Data, task.sessionId, sequence, buffer.subarray(0, bytesRead)),
          [FrameType.DataAck],
          sequence
        )
        offset += bytesRead
        sequence += 1
        task.transferredBytes = offset
        task.message = '正在发送文件…'
        this.publish(task)
      }
    } finally {
      await handle.close()
    }
    task.state = 'verifying'
    task.message = '接收端正在校验文件…'
    this.publish(task)
    const result = await this.sendWithRetry(
      task,
      encodeFrame(FrameType.End, task.sessionId, sequence),
      [FrameType.Complete],
      sequence,
      10000
    )
    const complete = JSON.parse(result.payload.toString('utf8')) as {
      success?: boolean
      message?: string
    }
    if (!complete.success) throw new Error(complete.message || '接收端文件校验失败')
    task.state = 'completed'
    task.message = '文件发送完成，SHA-256 校验通过'
    task.transferredBytes = task.totalBytes
    this.publish(task)
  }

  private async sendWithRetry(
    task: SenderTask,
    frame: Buffer,
    types: number[],
    sequence: number,
    timeout = 1500
  ): Promise<Frame> {
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt += 1) {
      this.ensureActive(task)
      try {
        const response = this.waitFor(task.sessionId, types, sequence, timeout)
        try {
          await this.writePort(task.port, frame)
        } catch (error) {
          this.rejectWaiter(
            task.sessionId,
            error instanceof Error ? error : new Error(String(error))
          )
          await response.catch(() => undefined)
          throw error
        }
        return await response
      } catch (error) {
        lastError = error
        task.retries += 1
        task.message = `等待确认超时，正在重试（${attempt + 1}/5）…`
        this.publish(task)
      }
    }
    throw lastError || new Error('接收端无响应')
  }

  private waitFor(
    sessionId: number,
    types: number[],
    sequence: number,
    timeout: number
  ): Promise<Frame> {
    this.rejectWaiter(sessionId, new Error('等待已被新请求替代'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(sessionId)
        reject(new Error('等待接收端确认超时'))
      }, timeout)
      this.waiters.set(sessionId, { types, sequence, resolve, reject, timer })
    })
  }

  private async handleFrame(port: string, frame: Frame): Promise<void> {
    const waiter = this.waiters.get(frame.sessionId)
    if (
      waiter &&
      (waiter.types.includes(frame.type) || frame.type === FrameType.Error) &&
      (waiter.sequence === undefined || waiter.sequence === frame.sequence)
    ) {
      clearTimeout(waiter.timer)
      this.waiters.delete(frame.sessionId)
      if (frame.type === FrameType.Error)
        waiter.reject(new Error(frame.payload.toString('utf8') || '接收端返回错误'))
      else waiter.resolve(frame)
      return
    }
    if (frame.type === FrameType.End && this.completionFrames.has(frame.sessionId)) {
      await this.writePort(port, this.completionFrames.get(frame.sessionId)!)
    } else if (frame.type === FrameType.Begin) await this.beginReceive(port, frame)
    else if (frame.type === FrameType.Data) await this.receiveData(port, frame)
    else if (frame.type === FrameType.End) await this.finishReceive(port, frame)
    else if (frame.type === FrameType.Cancel) await this.cancelReceiver(frame.sessionId)
  }

  private async beginReceive(port: string, frame: Frame): Promise<void> {
    const directory = this.receiveDirectories.get(port)
    if (!directory) return
    try {
      const metadata = JSON.parse(frame.payload.toString('utf8')) as {
        name?: string
        size?: number
        sha256?: string
        chunkSize?: number
      }
      if (
        !metadata.name ||
        !Number.isSafeInteger(metadata.size) ||
        Number(metadata.size) < 0 ||
        !/^[a-f0-9]{64}$/i.test(metadata.sha256 || '')
      )
        throw new Error('文件信息无效')
      const fileName = safeFileName(metadata.name)
      const chunkSize = Math.min(32 * 1024, Math.max(256, Number(metadata.chunkSize) || 1024))
      const finalPath = join(directory, fileName)
      const tempPath = `${finalPath}.serialflow-part`
      const metaPath = `${tempPath}.json`
      let resumeOffset = 0
      try {
        const saved = JSON.parse(await readFile(metaPath, 'utf8')) as {
          size?: number
          sha256?: string
          chunkSize?: number
        }
        const tempInfo = await stat(tempPath)
        if (
          saved.size === metadata.size &&
          saved.sha256 === metadata.sha256 &&
          saved.chunkSize === chunkSize
        )
          resumeOffset = Math.min(tempInfo.size, Number(metadata.size))
      } catch {
        /* Start a new temporary file. */
      }
      resumeOffset -= resumeOffset % chunkSize
      const handle = await open(tempPath, resumeOffset ? 'r+' : 'w')
      if (resumeOffset) await handle.truncate(resumeOffset)
      await writeFile(
        metaPath,
        JSON.stringify({ size: metadata.size, sha256: metadata.sha256, chunkSize }),
        'utf8'
      )
      const existing = this.receivers.get(frame.sessionId)
      if (existing) await existing.handle.close()
      const task: ReceiverTask = {
        taskId: `receive-${frame.sessionId}`,
        direction: 'receive',
        port,
        fileName,
        filePath: finalPath,
        totalBytes: Number(metadata.size),
        transferredBytes: resumeOffset,
        state: 'transferring',
        message: resumeOffset ? `从 ${resumeOffset} 字节处继续接收` : '正在接收文件…',
        retries: 0,
        startedAt: Date.now(),
        bytesPerSecond: 0,
        protocol: 'serialflow',
        sessionId: frame.sessionId,
        chunkSize,
        sha256: metadata.sha256!,
        tempPath,
        metaPath,
        nextSequence: Math.floor(resumeOffset / chunkSize),
        handle
      }
      this.receivers.set(frame.sessionId, task)
      this.publish(task)
      await this.writePort(
        port,
        encodeFrame(
          FrameType.BeginAck,
          frame.sessionId,
          0,
          Buffer.from(JSON.stringify({ accepted: true, resumeOffset }), 'utf8')
        )
      )
    } catch (error) {
      await this.writePort(
        port,
        encodeFrame(
          FrameType.BeginAck,
          frame.sessionId,
          0,
          Buffer.from(JSON.stringify({ accepted: false, message: errorMessage(error) }), 'utf8')
        )
      )
    }
  }

  private async receiveData(port: string, frame: Frame): Promise<void> {
    const task = this.receivers.get(frame.sessionId)
    if (!task || task.port !== port) return
    try {
      if (frame.sequence === task.nextSequence) {
        await task.handle.write(frame.payload, 0, frame.payload.length, task.transferredBytes)
        task.transferredBytes += frame.payload.length
        task.nextSequence += 1
        task.message = '正在接收文件…'
        this.publish(task)
      }
      if (frame.sequence <= task.nextSequence)
        await this.writePort(port, encodeFrame(FrameType.DataAck, frame.sessionId, frame.sequence))
    } catch (error) {
      await this.writePort(
        port,
        encodeFrame(
          FrameType.Error,
          frame.sessionId,
          frame.sequence,
          Buffer.from(errorMessage(error), 'utf8')
        )
      )
    }
  }

  private async finishReceive(port: string, frame: Frame): Promise<void> {
    const task = this.receivers.get(frame.sessionId)
    if (!task || task.port !== port) return
    task.state = 'verifying'
    task.message = '正在校验文件 SHA-256…'
    this.publish(task)
    await task.handle.close()
    try {
      if (task.transferredBytes !== task.totalBytes)
        throw new Error(`文件大小不符：收到 ${task.transferredBytes}，应为 ${task.totalBytes}`)
      const actualHash = await sha256File(task.tempPath)
      if (actualHash.toLowerCase() !== task.sha256.toLowerCase())
        throw new Error('文件 SHA-256 校验失败')
      try {
        await unlink(task.filePath!)
      } catch {
        /* No existing destination file. */
      }
      await rename(task.tempPath, task.filePath!)
      try {
        await unlink(task.metaPath)
      } catch {
        /* Metadata may already be absent. */
      }
      task.state = 'completed'
      task.message = '文件接收完成，SHA-256 校验通过'
      this.publish(task)
      const completionFrame = encodeFrame(
        FrameType.Complete,
        frame.sessionId,
        frame.sequence,
        Buffer.from(JSON.stringify({ success: true }), 'utf8')
      )
      this.cacheCompletion(frame.sessionId, completionFrame)
      await this.writePort(port, completionFrame)
      this.receivers.delete(frame.sessionId)
    } catch (error) {
      task.state = 'error'
      task.message = errorMessage(error)
      this.publish(task)
      const completionFrame = encodeFrame(
        FrameType.Complete,
        frame.sessionId,
        frame.sequence,
        Buffer.from(JSON.stringify({ success: false, message: task.message }), 'utf8')
      )
      this.cacheCompletion(frame.sessionId, completionFrame)
      await this.writePort(port, completionFrame)
      this.receivers.delete(frame.sessionId)
    }
  }

  private async cancelReceiver(sessionId: number): Promise<void> {
    const task = this.receivers.get(sessionId)
    if (!task) return
    await task.handle.close()
    this.receivers.delete(sessionId)
    task.state = 'cancelled'
    task.message = '发送端已取消，临时文件已保留以便续传'
    this.publish(task)
  }

  private ensureActive(task: SenderTask): void {
    if (task.cancelled) throw new Error('传输已取消')
  }

  private rejectWaiter(sessionId: number, error: Error): void {
    const waiter = this.waiters.get(sessionId)
    if (!waiter) return
    clearTimeout(waiter.timer)
    this.waiters.delete(sessionId)
    waiter.reject(error)
  }

  private cacheCompletion(sessionId: number, frame: Buffer): void {
    this.completionFrames.set(sessionId, frame)
    setTimeout(() => this.completionFrames.delete(sessionId), 60_000).unref()
  }

  private publish(task: TransferProgress): void {
    const now = Date.now()
    const lastEmit = this.lastProgressEmits.get(task.taskId) || 0
    if (
      task.state === 'transferring' &&
      task.transferredBytes < task.totalBytes &&
      now - lastEmit < 100
    )
      return
    this.lastProgressEmits.set(task.taskId, now)
    const elapsed = Math.max(0.001, (Date.now() - task.startedAt) / 1000)
    task.bytesPerSecond = Math.round(task.transferredBytes / elapsed)
    this.emitProgress({ ...task })
  }
}
