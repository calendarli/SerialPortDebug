import { createScript, normalizeScript, type SavedScript } from './script-types'

const storageKey = 'serialflow.scripts'

export function loadScripts(): SavedScript[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]') as Partial<SavedScript>[]
    return Array.isArray(parsed) ? parsed.map(normalizeScript) : []
  } catch {
    return []
  }
}

export function saveScripts(scripts: SavedScript[]): void {
  localStorage.setItem(storageKey, JSON.stringify(scripts))
}

export function ensureInitialScripts(scripts: SavedScript[]): SavedScript[] {
  return scripts.length ? scripts : [createScript('typescript')]
}
