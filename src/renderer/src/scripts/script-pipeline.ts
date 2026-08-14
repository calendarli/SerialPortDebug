import { bytesToHex, encodeSerialData, hexToBytes } from '../serial-utils'
import { scriptRuntime } from './script-runtime'
import type {
  SavedScript,
  ScriptEncoding,
  ScriptMessageType,
  ScriptResult,
  ScriptRunResult
} from './script-types'

export type ScriptPayload = { value: unknown; encoding: ScriptEncoding }
export type ScriptDisplay = { scriptId: string; scriptName: string; text: string; tags: string[] }
export type ScriptPipelineResult = { payload: ScriptPayload; displays: ScriptDisplay[] }

export function hashScriptSource(source: string): string {
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export function payloadToBytes(payload: ScriptPayload): Uint8Array {
  if (payload.encoding === 'bytes') {
    if (payload.value instanceof Uint8Array) return payload.value
    if (Array.isArray(payload.value)) {
      if (payload.value.some((value) => !Number.isInteger(value) || value < 0 || value > 255))
        throw new Error('脚本字节数组只能包含 0-255 的整数')
      return Uint8Array.from(payload.value as number[])
    }
    throw new Error('bytes 编码必须返回 Uint8Array 或数字数组')
  }
  if (payload.encoding === 'hex') return hexToBytes(String(payload.value ?? ''))
  if (payload.encoding === 'json')
    return new TextEncoder().encode(
      typeof payload.value === 'string' ? payload.value : JSON.stringify(payload.value)
    )
  return encodeSerialData(String(payload.value ?? ''), false)
}

export function bytesToPayload(bytes: Uint8Array, encoding: ScriptEncoding): ScriptPayload {
  if (encoding === 'bytes') return { value: Array.from(bytes), encoding }
  if (encoding === 'hex') return { value: bytesToHex(bytes), encoding }
  const text = new TextDecoder().decode(bytes)
  if (encoding === 'json') {
    try {
      return { value: JSON.parse(text), encoding }
    } catch {
      throw new Error('当前数据不是有效的 JSON')
    }
  }
  return { value: text, encoding }
}

export function convertPayload(payload: ScriptPayload, encoding: ScriptEncoding): ScriptPayload {
  if (payload.encoding === encoding) return payload
  return bytesToPayload(payloadToBytes(payload), encoding)
}

function normalizeResult(result: ScriptRunResult, fallback: ScriptPayload): ScriptResult {
  if (
    result &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    ('value' in result ||
      'encoding' in result ||
      'display' in result ||
      'tags' in result ||
      'dropDisplay' in result)
  )
    return result as ScriptResult
  return { value: result === null || result === undefined ? fallback.value : result }
}

function applies(script: SavedScript, type: ScriptMessageType, port: string): boolean {
  return (
    script.enabled &&
    Boolean(script.compiledCode) &&
    (script.direction === 'all' || script.direction === type) &&
    (!script.ports.length || script.ports.includes(port))
  )
}

export async function runScriptPipeline(
  scripts: SavedScript[],
  type: ScriptMessageType,
  port: string,
  initialPayload: ScriptPayload,
  index = 0
): Promise<ScriptPipelineResult> {
  let payload = initialPayload
  const displays: ScriptDisplay[] = []
  for (const script of scripts) {
    if (!applies(script, type, port)) continue
    const input = convertPayload(payload, script.encoding)
    const bytes = payloadToBytes(input)
    let rawResult: ScriptRunResult
    try {
      rawResult = await scriptRuntime.run(script, input.value, type, index, {
        port,
        encoding: input.encoding,
        timestamp: Date.now(),
        byteLength: bytes.length,
        scriptName: script.name,
        direction: type,
        index
      })
    } catch (cause) {
      throw new Error(
        `脚本“${script.name}”执行失败：${cause instanceof Error ? cause.message : String(cause)}`
      )
    }
    const result = normalizeResult(rawResult, input)
    const nextEncoding = result.encoding || input.encoding
    if (result.value !== undefined) payload = { value: result.value, encoding: nextEncoding }
    else payload = { ...input, encoding: nextEncoding }
    const displayValue =
      result.display !== undefined
        ? result.display
        : type === 'received' && result.value !== undefined
          ? typeof result.value === 'string'
            ? result.value
            : JSON.stringify(result.value)
          : undefined
    if (displayValue !== undefined && !result.dropDisplay && script.displayMode !== 'hidden') {
      displays.push({
        scriptId: script.id,
        scriptName: script.name,
        text: String(displayValue),
        tags: Array.isArray(result.tags) ? result.tags.map(String) : []
      })
    }
  }
  return { payload, displays }
}

export function activeScriptCount(
  scripts: SavedScript[],
  type?: ScriptMessageType,
  port?: string
): number {
  return scripts.filter(
    (script) =>
      script.enabled &&
      (!type || script.direction === 'all' || script.direction === type) &&
      (!port || !script.ports.length || script.ports.includes(port))
  ).length
}
