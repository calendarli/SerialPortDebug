import type { SavedCommand } from './types'

export function normalizeCommandExtensions(value: {
  processingMode?: unknown
  processingProgram?: unknown
  companion?: unknown
}): Pick<SavedCommand, 'processingMode' | 'processingProgram' | 'companion'> {
  const companion =
    value.companion && typeof value.companion === 'object'
      ? (value.companion as Record<string, unknown>)
      : {}
  return {
    processingMode: value.processingMode === 'program' ? 'program' : 'template',
    processingProgram: typeof value.processingProgram === 'string' ? value.processingProgram : '',
    companion: {
      enabled: companion.enabled === true,
      source: companion.source === 'custom' ? 'custom' : 'command',
      template: typeof companion.template === 'string' ? companion.template : '',
      commandId:
        typeof companion.commandId === 'number' && Number.isSafeInteger(companion.commandId)
          ? companion.commandId
          : null,
      loop: companion.loop === true,
      interval:
        typeof companion.interval === 'number' &&
        Number.isInteger(companion.interval) &&
        companion.interval >= 1 &&
        companion.interval <= 2147483647
          ? companion.interval
          : 200
    }
  }
}
