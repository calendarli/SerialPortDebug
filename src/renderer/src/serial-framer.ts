import { hexToBytes } from './serial-utils'
import type { SerialFraming } from './types'

type FrameCallback = (frame: Uint8Array) => void
type FrameState = {
  bytes: number[]
  timer?: number
  signature: string
  scan: number
  inFrame: boolean
}

export const defaultSerialFraming: SerialFraming = {
  mode: 'raw',
  delimiter: '\\n',
  fixedLength: 8,
  header: 'AA',
  footer: 'BB',
  idleTimeout: 20
}

function findSequence(source: number[], target: Uint8Array, start = 0): number {
  if (!target.length) return -1
  outer: for (let index = start; index <= source.length - target.length; index += 1) {
    for (let offset = 0; offset < target.length; offset += 1) {
      if (source[index + offset] !== target[offset]) continue outer
    }
    return index
  }
  return -1
}

function escapedTextBytes(value: string): Uint8Array {
  return new TextEncoder().encode(
    value.replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  )
}

export class SerialFramer {
  private states = new Map<string, FrameState>()

  push(port: string, framing: SerialFraming, chunk: Uint8Array, emit: FrameCallback): void {
    if (framing.mode === 'raw') {
      this.clear(port)
      return emit(chunk)
    }
    const signature = JSON.stringify(framing)
    let state = this.states.get(port)
    if (!state || state.signature !== signature) {
      if (state?.timer) window.clearTimeout(state.timer)
      state = { bytes: [], signature, scan: 0, inFrame: false }
      this.states.set(port, state)
    }
    for (const byte of chunk) state.bytes.push(byte)
    if (state.bytes.length > 8 * 1024 * 1024) {
      this.clear(port)
      throw new Error(`${port} 分帧缓存超过 8 MB，请检查分帧参数`)
    }

    if (framing.mode === 'idle') {
      if (state.timer) window.clearTimeout(state.timer)
      state.timer = window.setTimeout(
        () => {
          state!.timer = undefined
          if (!state!.bytes.length) return
          const frame = Uint8Array.from(state!.bytes)
          state!.bytes = []
          emit(frame)
        },
        Math.max(1, Math.floor(framing.idleTimeout))
      )
      return
    }

    let consumed = 0
    if (framing.mode === 'fixed') {
      const length = Math.max(1, Math.floor(framing.fixedLength))
      while (state.bytes.length - consumed >= length) {
        emit(Uint8Array.from(state.bytes.slice(consumed, consumed + length)))
        consumed += length
      }
    } else if (framing.mode === 'delimiter') {
      const delimiter = escapedTextBytes(framing.delimiter || '\\n')
      let index = findSequence(state.bytes, delimiter, state.scan)
      while (index >= 0) {
        const end = index + delimiter.length
        emit(Uint8Array.from(state.bytes.slice(consumed, end)))
        consumed = end
        index = findSequence(state.bytes, delimiter, consumed)
      }
      state.scan = Math.max(consumed, state.bytes.length - delimiter.length + 1)
    } else {
      const header = hexToBytes(framing.header || 'AA')
      const footer = hexToBytes(framing.footer || 'BB')
      if (!header.length || !footer.length) throw new Error('帧头和帧尾不能为空')
      while (true) {
        if (!state.inFrame) {
          const index = findSequence(state.bytes, header, consumed)
          if (index < 0) {
            consumed = Math.max(consumed, state.bytes.length - header.length + 1)
            state.scan = consumed
            break
          }
          consumed = index
          state.inFrame = true
          state.scan = index + header.length
        }
        const index = findSequence(state.bytes, footer, state.scan)
        if (index < 0) {
          state.scan = Math.max(consumed + header.length, state.bytes.length - footer.length + 1)
          break
        }
        const end = index + footer.length
        emit(Uint8Array.from(state.bytes.slice(consumed, end)))
        consumed = end
        state.inFrame = false
      }
    }
    if (consumed) {
      state.bytes = state.bytes.slice(consumed)
      state.scan = Math.max(0, state.scan - consumed)
    }
  }

  clear(port?: string): void {
    for (const [key, state] of this.states) {
      if (port && key !== port) continue
      if (state.timer) window.clearTimeout(state.timer)
      this.states.delete(key)
    }
  }
}
