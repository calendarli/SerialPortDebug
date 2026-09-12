import { createHash } from 'node:crypto'
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import extract from 'extract-zip'
import { optional, run } from './optional'

export const esptoolVersion = '5.3.1'
// Pinned digests from the official GitHub release; never substitute another architecture.
export const esptoolAssets: Record<string, { platform: string; digest: string }> = {
  'win-x64': {
    platform: 'windows-amd64',
    digest: '2b4a73c45db27426685896f64ce3e557f63a64f43cc100cb65c0cc3486af96d3'
  },
  'linux-x64': {
    platform: 'linux-amd64',
    digest: 'e9cc641f8e4a0b644b52836d7a6b59f3c6d3261213c5ccc41f8f3c3035d06aa4'
  },
  'linux-arm64': {
    platform: 'linux-aarch64',
    digest: 'dd2613cdc8e73d1200a3daff2025ff51daa5bbdb3a352fe35d6b7377891aecc8'
  },
  'linux-armv7l': {
    platform: 'linux-armv7',
    digest: '54a2f902acf47dd4542c1ed6958eb9442fe818a16a7ecfaeaab57b872e7e8460'
  },
  'mac-x64': {
    platform: 'macos-amd64',
    digest: 'f8ec4fcaf7d79845a0e8ad60b24be9f584d8fe03f341b5ad4ec0df0ec855e670'
  },
  'mac-arm64': {
    platform: 'macos-arm64',
    digest: 'f63f7203d88cfe4c17aea34d6cf82769458ce204e49a05816c6384c2d299e6ca'
  }
}

export function resourceTarget(platform: string, arch: string): string {
  const os = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : platform
  return `${os}-${arch === 'arm' ? 'armv7l' : arch}`
}

export async function fetchEsptool(
  platform = process.env.SERIALFLOW_PLATFORM || process.platform,
  arch = process.env.SERIALFLOW_ARCH || process.arch
): Promise<void> {
  await optional('esptool', async () => {
    const target = resourceTarget(platform, arch)
    const asset = esptoolAssets[target]
    if (!asset) throw new Error(`No official esptool binary for ${target}`)
    const root = resolve(import.meta.dirname, '../resources/firmware/esp32')
    const destination = join(root, target)
    const executable = target.startsWith('win-') ? 'esptool.exe' : 'esptool'
    try {
      const marker = JSON.parse(await readFile(join(destination, 'install.json'), 'utf8')) as {
        version: string
        sha256: string
      }
      const binary = await readFile(join(destination, executable))
      if (
        marker.version === esptoolVersion &&
        marker.sha256 === createHash('sha256').update(binary).digest('hex')
      )
        return
    } catch {
      /* Missing or incomplete installation: fetch again. */
    }
    await rm(destination, { recursive: true, force: true })
    await mkdir(root, { recursive: true })
    const stage = await mkdtemp(join(root, '.download-'))
    try {
      const extension = target.startsWith('win-') ? 'zip' : 'tar.gz'
      const name = `esptool-v${esptoolVersion}-${asset.platform}.${extension}`
      const response = await fetch(
        `https://github.com/espressif/esptool/releases/download/v${esptoolVersion}/${name}`,
        { signal: AbortSignal.timeout(120000) }
      )
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`)
      const data = Buffer.from(await response.arrayBuffer())
      if (createHash('sha256').update(data).digest('hex') !== asset.digest)
        throw new Error('Release SHA-256 mismatch')
      const archive = join(stage, name)
      await writeFile(archive, data)
      const unpacked = join(stage, 'unpacked')
      await mkdir(unpacked)
      if (extension === 'zip') await extract(archive, { dir: unpacked })
      else run('tar', ['-xzf', archive, '-C', unpacked])
      const bundle = join(unpacked, `esptool-${asset.platform}`)
      const binary = await readFile(join(bundle, executable))
      const ready = join(stage, 'ready')
      await cp(bundle, ready, { recursive: true })
      if (!target.startsWith('win-')) await chmod(join(ready, executable), 0o755)
      await writeFile(
        join(ready, 'install.json'),
        JSON.stringify({
          version: esptoolVersion,
          sha256: createHash('sha256').update(binary).digest('hex')
        })
      )
      await rename(ready, destination)
      console.log(`esptool ${esptoolVersion} ready: ${target}`)
    } finally {
      await rm(stage, { recursive: true, force: true })
    }
  })
}

if (import.meta.main) await fetchEsptool()
