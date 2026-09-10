export const interactionDisplayKey = 'serialflow.interactionDisplay'
export const displayEncodings = [
  'utf-8',
  'gbk',
  'gb18030',
  'big5',
  'utf-16le',
  'utf-16be',
  'windows-1252'
] as const
export type DisplayEncoding = (typeof displayEncodings)[number]
export type DirectionDisplay = { color: string; font: string; size: number | null }
export type InteractionDisplay = {
  rx: DirectionDisplay
  tx: DirectionDisplay
  encoding: DisplayEncoding
}
export function normalizeInteractionDisplay(value: unknown): InteractionDisplay {
  const source = value as Partial<InteractionDisplay> | null
  const direction = (value: unknown, color: string): DirectionDisplay => {
    const item = value as Partial<DirectionDisplay> | null
    return {
      color:
        typeof item?.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : color,
      font:
        typeof item?.font === 'string' &&
        item.font.trim() &&
        item.font.length <= 80 &&
        !/[;{}"\\]/.test(item.font)
          ? item.font.trim()
          : 'Consolas',
      size:
        typeof item?.size === 'number' &&
        Number.isInteger(item.size) &&
        item.size >= 8 &&
        item.size <= 24
          ? item.size
          : null
    }
  }
  return {
    rx: direction(source?.rx, '#344258'),
    tx: direction(source?.tx, '#1f6048'),
    encoding: displayEncodings.includes(source?.encoding as DisplayEncoding)
      ? source!.encoding!
      : 'utf-8'
  }
}
export function loadInteractionDisplay(): InteractionDisplay {
  try {
    return normalizeInteractionDisplay(
      JSON.parse(localStorage.getItem(interactionDisplayKey) || 'null')
    )
  } catch {
    return normalizeInteractionDisplay(null)
  }
}

// Display decoding is separate from protocol matching and keeps split characters per port.
export class InteractionTextDecoder {
  private decoders = new Map<string, { encoding: DisplayEncoding; decoder: TextDecoder }>()
  decode(port: string, bytes: Uint8Array, encoding: DisplayEncoding): string {
    let state = this.decoders.get(port)
    if (!state || state.encoding !== encoding) {
      state = { encoding, decoder: new TextDecoder(encoding) }
      this.decoders.set(port, state)
    }
    return state.decoder.decode(bytes, { stream: true })
  }
  clear(port: string): void {
    this.decoders.delete(port)
  }
}
