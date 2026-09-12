import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { optional, run } from './optional'

export async function buildDriver(
  arch = process.env.SERIALFLOW_ARCH || process.arch,
  required = process.env.SERIALFLOW_REQUIRE_DRIVER === '1'
): Promise<void> {
  if (process.platform !== 'win32') {
    if (required) throw new Error('Windows virtual serial driver requires Windows')
    return
  }
  const build = async (): Promise<void> => {
    if (!['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported architecture: ${arch}`)
    const root = resolve(import.meta.dirname, '..')
    const destination = join(root, 'resources', 'virtual-serial', `win-${arch}`)
    // A failed rebuild must not silently package an older driver.
    await rm(destination, { recursive: true, force: true })
    const vswhere = join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe'
    )
    // WDK verification DLLs run inside MSBuild, so select a 64-bit host even
    // when cross-compiling. Recent WDKs do not ship the x86 InfVerif DLL.
    const msbuildHost = process.arch === 'arm64' ? 'arm64' : 'amd64'
    const msbuild =
      process.env.MSBUILD_PATH ||
      execFileSync(
        vswhere,
        [
          '-latest',
          '-products',
          '*',
          '-requires',
          'Microsoft.Component.MSBuild',
          '-find',
          `MSBuild\\**\\Bin\\${msbuildHost}\\MSBuild.exe`
        ],
        { encoding: 'utf8', windowsHide: true }
      )
        .trim()
        .split(/\r?\n/)[0]
    if (!msbuild || !existsSync(msbuild))
      throw new Error('64-bit MSBuild not found; set MSBUILD_PATH or install Visual Studio')
    console.log(`Driver build MSBuild: ${msbuild}`)
    const source = join(root, 'driver', 'SerialFlowVirtualSerial')
    const platform = arch === 'arm64' ? 'ARM64' : 'x64'
    const configuration = 'Release'
    const output = join(root, '.tmp', 'virtual-serial', arch)
    // Let MSBuild resolve the installed SDK version. A global "10.0" override also
    // becomes WDKBuildFolder, preventing versioned WDK props from loading.
    for (const project of [
      'Manager/SerialFlowVirtualSerialManager.vcxproj',
      'ComPort/VirtualSerial2um.vcxproj'
    ]) {
      run(
        msbuild,
        [
          join(source, project),
          '/t:Rebuild',
          `/p:Configuration=${configuration}`,
          `/p:Platform=${platform}`,
          `/p:OutDir=${join(output, project.split('/')[0])}\\`,
          `/p:IntDir=${join(output, project.split('/')[0], 'obj')}\\`,
          '/m'
        ],
        source
      )
    }
    await mkdir(join(root, 'resources', 'virtual-serial'), { recursive: true })
    const stage = await mkdtemp(join(root, 'resources', 'virtual-serial', '.stage-'))
    try {
      const driverOutput = join(output, 'ComPort')
      await cp(join(driverOutput, 'VirtualSerial2um'), stage, { recursive: true })
      await copyFile(
        join(output, 'Manager', 'SerialFlowVirtualSerialManager.exe'),
        join(stage, 'SerialFlowVirtualSerialManager.exe')
      )
      const certificate = join(driverOutput, 'SerialFlowVirtualSerial.cer')
      if (existsSync(certificate))
        await copyFile(certificate, join(stage, 'SerialFlowVirtualSerial.cer'))
      for (const file of [
        'virtualserial2um.inf',
        'SerialFlowVirtualSerial.dll',
        'serialflowvirtualserial.cat',
        'SerialFlowVirtualSerialManager.exe',
        ...(required ? ['SerialFlowVirtualSerial.cer'] : [])
      ]) {
        if (!existsSync(join(stage, file))) throw new Error(`Incomplete driver output: ${file}`)
      }
      await rename(stage, destination)
      console.log(`Virtual serial driver ready: ${destination}`)
    } finally {
      await rm(stage, { recursive: true, force: true })
    }
  }
  if (required) await build()
  else await optional('Windows virtual serial driver (requires Visual Studio C++ and WDK)', build)
}

if (import.meta.main) await buildDriver()
