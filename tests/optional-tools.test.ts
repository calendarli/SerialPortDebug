import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'
import { esptoolAssets, fetchEsptool, resourceTarget } from '../scripts/fetch-esptool'
import { optional } from '../scripts/optional'

const warnings = spyOn(console, 'warn').mockImplementation(() => {
  /* Assert warnings without printing fixtures. */
})
afterEach(() => warnings.mockClear())
afterAll(() => warnings.mockRestore())

test('resource targets match electron-builder OS and architecture names', () => {
  expect(resourceTarget('win32', 'x64')).toBe('win-x64')
  expect(resourceTarget('darwin', 'arm64')).toBe('mac-arm64')
  expect(resourceTarget('linux', 'arm')).toBe('linux-armv7l')
  expect(esptoolAssets[resourceTarget('linux', 'arm64')].platform).toBe('linux-aarch64')
  for (const asset of Object.values(esptoolAssets)) expect(asset.digest).toMatch(/^[a-f0-9]{64}$/)
})

test('unsupported esptool targets warn without downloading a different architecture', async () => {
  const download = spyOn(globalThis, 'fetch')
  try {
    await fetchEsptool('win32', 'arm64')
    expect(download).not.toHaveBeenCalled()
    expect(warnings).toHaveBeenCalledWith(
      expect.stringContaining('No official esptool binary for win-arm64')
    )
  } finally {
    download.mockRestore()
  }
})

test('optional failures do not abort installation', async () => {
  await expect(
    optional('fixture', () => {
      throw new Error('toolchain missing')
    })
  ).resolves.toBeUndefined()
  expect(warnings).toHaveBeenCalledWith('[optional] fixture unavailable: toolchain missing')
})
