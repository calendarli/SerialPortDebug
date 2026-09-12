import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  esptoolAssets,
  fetchEsptool,
  pruneEsptoolBundle,
  resourceTarget
} from '../scripts/fetch-esptool'
import { optional, run } from '../scripts/optional'

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

test('quiet command failures preserve stdout and stderr in optional warnings', async () => {
  await optional('driver fixture', () => {
    run(
      process.execPath,
      [
        '-e',
        'console.log("error MSB8020: toolset missing"); console.error("compiler details"); process.exit(1)'
      ],
      process.cwd(),
      true
    )
  })
  expect(warnings).toHaveBeenCalledTimes(1)
  const message = String(warnings.mock.calls[0][0])
  expect(message).toContain('exited with 1')
  expect(message).toContain('\nerror MSB8020: toolset missing\ncompiler details')
  expect(message).toContain('Command:')
  expect(message).toContain(`Working directory: ${process.cwd()}`)
})

test('cached esptool pruning removes companion tools but preserves runtime and license files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'serialflow-esptool-'))
  try {
    const retained = ['esptool', 'esptool.exe', 'LICENSE', 'README.md', 'install.json']
    const removed = ['espefuse', 'espsecure', 'esp_rfc2217_server'].flatMap((name) => [
      name,
      `${name}.exe`
    ])
    for (const name of [...retained, ...removed]) await writeFile(join(directory, name), name)
    await mkdir(join(directory, '_internal'))
    await writeFile(join(directory, '_internal', 'runtime'), 'runtime dependency')
    await pruneEsptoolBundle(directory)
    await pruneEsptoolBundle(directory)
    expect((await readdir(directory)).sort()).toEqual([...retained, '_internal'].sort())
    expect(await readFile(join(directory, '_internal', 'runtime'), 'utf8')).toBe(
      'runtime dependency'
    )
    expect(await readFile(join(directory, 'esptool.exe'), 'utf8')).toBe('esptool.exe')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
