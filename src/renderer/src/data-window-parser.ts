export type DataField = { name: string; offset: number; length: number }
export type DataPattern = { bytes: (number | null)[]; fields: DataField[] }
export type DataMatch = { fields: { name: string; hex: string }[]; frame: string }

export function compileDataPattern(template: string): DataPattern {
  const bytes: (number | null)[] = []
  const fields: DataField[] = []
  const tokens = template
    .trim()
    .split(/\s*(\{[^{}]*\})\s*|\s+/)
    .filter(Boolean)
  for (const token of tokens) {
    if (token.startsWith('{')) {
      const field = /^\{([^{}:]+):([1-9]\d*)\}$/.exec(token)
      if (!field) throw new Error('数据字段格式应为 {名称:字节数}，例如 {数据:4}')
      const name = field[1].trim()
      const length = Number(field[2])
      if (!name || fields.some((entry) => entry.name === name))
        throw new Error('字段名称不能为空或重复')
      if (length > 4096) throw new Error('单个字段最多 4096 字节')
      fields.push({ name, offset: bytes.length, length })
      bytes.push(...Array<number | null>(length).fill(null))
    } else {
      if (!/^(?:[0-9a-fA-F]{2}|\?\?)+$/.test(token))
        throw new Error(`无效的模板内容：${token}；请使用 HEX 字节、?? 或 {名称:字节数}`)
      for (let index = 0; index < token.length; index += 2) {
        const byte = token.slice(index, index + 2)
        bytes.push(byte === '??' ? null : parseInt(byte, 16))
      }
    }
    if (bytes.length > 4096) throw new Error('一条模板最多匹配 4096 字节')
  }
  if (!fields.length) throw new Error('请至少添加一个显示字段，例如 {数据:4}')
  return { bytes, fields }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

// Signed fields use two's complement at the exact field width; scaling stays integer-based.
export function formatDataValue(
  value: string,
  signed = false,
  decimals = 0
): { hex: string; dec: string } {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 20)
    throw new Error('小数位必须为 0 到 20 的整数')
  const raw = value.replace(/\s/g, '')
  let integer = BigInt(`0x${raw}`)
  const width = BigInt(raw.length * 4)
  if (signed && integer & (BigInt(1) << (width - BigInt(1)))) integer -= BigInt(1) << width
  const negative = integer < BigInt(0)
  const magnitude = negative ? -integer : integer
  const digits = magnitude.toString(10).padStart(decimals + 1, '0')
  const dec = `${negative ? '-' : ''}${decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits}`
  const hexDigits = magnitude.toString(16).toUpperCase()
  const signedHex = hexDigits
    .padStart(Math.ceil(hexDigits.length / 2) * 2, '0')
    .match(/.{2}/g)!
    .join(' ')
  return { hex: negative ? `-${signedHex}` : value, dec }
}

export function dataHexToDecimal(value: string): string {
  return formatDataValue(value).dec
}

// Retain only an incomplete frame; matching is independent of serial chunk boundaries.
export class DataWindowParser {
  private pending = new Uint8Array(0)
  constructor(private readonly pattern: DataPattern) {}
  clear(): void {
    this.pending = new Uint8Array(0)
  }
  push(chunk: Uint8Array): { count: number; latest: DataMatch | null } {
    const input = new Uint8Array(this.pending.length + chunk.length)
    input.set(this.pending)
    input.set(chunk, this.pending.length)
    const length = this.pattern.bytes.length
    let offset = 0
    let count = 0
    let latest: DataMatch | null = null
    while (offset + length <= input.length) {
      const matched = this.pattern.bytes.every(
        (byte, index) => byte === null || byte === input[offset + index]
      )
      if (!matched) {
        offset++
        continue
      }
      count++
      latest = {
        frame: hex(input.subarray(offset, offset + length)),
        fields: this.pattern.fields.map((field) => ({
          name: field.name,
          hex: hex(input.subarray(offset + field.offset, offset + field.offset + field.length))
        }))
      }
      offset += length
    }
    this.pending = input.slice(offset)
    return { count, latest }
  }
}
