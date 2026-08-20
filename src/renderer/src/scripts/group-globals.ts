export type GroupGlobals = Record<string, unknown>

export function normalizeGroupGlobals(value: unknown): GroupGlobals {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  try {
    return JSON.parse(JSON.stringify(value)) as GroupGlobals
  } catch {
    return {}
  }
}

export function printableGlobal(value: unknown, hex: boolean): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return hex ? (value ? '01' : '00') : String(value)
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (!hex) return String(value)
    if ((typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) ||
        (typeof value === 'bigint' && value < 0n))
      throw new Error('HEX 全局变量必须是非负整数')
    const result = value.toString(16).toUpperCase()
    return result.length % 2 ? `0${result}` : result
  }
  return JSON.stringify(value)
}

export function fillGlobalPlaceholders(
  template: string,
  globals: GroupGlobals,
  hex: boolean
): string {
  return template.replace(/\{\{\s*global\.([\p{L}_$][\p{L}\p{N}_$]*)\s*\}\}/gu, (_match, key) =>
    printableGlobal(globals[key], hex)
  )
}

export function evaluateGlobalPlaceholders(
  template: string,
  globals: GroupGlobals,
  hex: boolean
): string {
  return template.replace(/\{\{\s*(\+\+)?global\.([\p{L}_$][\p{L}\p{N}_$]*)(\+\+)?\s*\}\}/gu,
    (_match, prefix, key, suffix) => {
      let value = globals[key]
      if (prefix || suffix) {
        const numeric = Number(value ?? 0)
        if (!Number.isFinite(numeric)) throw new Error(`global.${key} 不是可递增的数字`)
        globals[key] = numeric + 1
        if (prefix) value = globals[key]
        else value = numeric
      }
      return printableGlobal(value, hex)
    })
}
