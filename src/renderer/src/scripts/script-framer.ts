import { hexToBytes } from '../serial-utils'
import type { SavedScript } from './script-types'

type FrameCallback = (frame: Uint8Array) => void
type FrameState = { bytes: number[]; timer?: number }

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
  return new TextEncoder().encode(value.replace(/\\r/g, '\r').replace(/\\n/g, '\n'))
}

export class ScriptFramer {
  private states = new Map<string, FrameState>()

  push(script: SavedScript, port: string, chunk: Uint8Array, emit: FrameCallback): void {
    const framing = script.framing
    if (framing.mode === 'chunk') return emit(chunk)
    const key = `${script.id}:${port}`
    const state = this.states.get(key) || { bytes: [] }
    state.bytes.push(...chunk)
    if (state.bytes.length > 8 * 1024 * 1024) {
      state.bytes = state.bytes.slice(-1024 * 1024)
      throw new Error(`脚本“${script.name}”分帧缓存超过 8MB`)
    }
    this.states.set(key, state)
    if (framing.mode === 'idle') {
      if (state.timer) window.clearTimeout(state.timer)
      state.timer = window.setTimeout(
        () => {
          state.timer = undefined
          if (!state.bytes.length) return
          const frame = Uint8Array.from(state.bytes)
          state.bytes = []
          emit(frame)
        },
        Math.max(1, framing.idleTimeout)
      )
      return
    }
    if (framing.mode === 'fixed') {
      const length = Math.max(1, Math.floor(framing.fixedLength))
      while (state.bytes.length >= length) emit(Uint8Array.from(state.bytes.splice(0, length)))
      return
    }
    if (framing.mode === 'delimiter') {
      const delimiter = escapedTextBytes(framing.delimiter || '\\n')
      let index = findSequence(state.bytes, delimiter)
      while (index >= 0) {
        emit(Uint8Array.from(state.bytes.splice(0, index + delimiter.length)))
        index = findSequence(state.bytes, delimiter)
      }
      return
    }
    const header = hexToBytes(framing.header || 'AA')
    const footer = hexToBytes(framing.footer || 'BB')
    let headerIndex = findSequence(state.bytes, header)
    if (headerIndex < 0) {
      state.bytes = state.bytes.slice(-Math.max(0, header.length - 1))
      return
    }
    if (headerIndex > 0) state.bytes.splice(0, headerIndex)
    let footerIndex = findSequence(state.bytes, footer, header.length)
    while (footerIndex >= 0) {
      emit(Uint8Array.from(state.bytes.splice(0, footerIndex + footer.length)))
      headerIndex = findSequence(state.bytes, header)
      if (headerIndex < 0) break
      if (headerIndex > 0) state.bytes.splice(0, headerIndex)
      footerIndex = findSequence(state.bytes, footer, header.length)
    }
  }

  clear(scriptId?: string): void {
    for (const [key, state] of this.states) {
      if (scriptId && !key.startsWith(`${scriptId}:`)) continue
      if (state.timer) window.clearTimeout(state.timer)
      this.states.delete(key)
    }
  }
}
