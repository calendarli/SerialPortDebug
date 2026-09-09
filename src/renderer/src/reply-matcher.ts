// Keep original candidate input/capture semantics while reporting a buffer consumption offset.
export function findReplyMatch(
  expression: RegExp,
  input: string,
  text: boolean
): {
  input: string
  match: RegExpExecArray
  start: number
  end: number
} | null {
  expression.lastIndex = 0
  const full = expression.exec(input)
  // Empty matches cannot consume a request and must never trigger an infinite reply loop.
  if (full?.[0].length) {
    let end = full.index + full[0].length
    if (text) end += /^(?:\r\n|\n)/.exec(input.slice(end))?.[0].length || 0
    return { input, match: full, start: full.index, end }
  }
  if (!text) return null
  let offset = 0
  for (const line of input.split('\n')) {
    const candidate = line.replace(/\r$/, '')
    expression.lastIndex = 0
    const match = expression.exec(candidate)
    if (match?.[0].length) {
      const end = offset + match.index + match[0].length
      return {
        input: candidate,
        match,
        start: offset + match.index,
        end:
          end === offset + candidate.length
            ? offset + line.length + (offset + line.length < input.length ? 1 : 0)
            : end
      }
    }
    offset += line.length + 1
  }
  return null
}

// Map UTF-16 string offsets back to original bytes, including split or malformed UTF-8.
export function replyByteOffset(bytes: Uint8Array, offset: number, hex: boolean): number {
  if (hex) return Math.min(bytes.length, Math.ceil(offset / 3))
  const decoder = new TextDecoder()
  let characters = 0
  for (let index = 0; index < bytes.length && offset > 0; index++) {
    characters += decoder.decode(bytes.subarray(index, index + 1), { stream: true }).length
    if (characters >= offset) return index + 1
  }
  return offset > 0 ? bytes.length : 0
}
