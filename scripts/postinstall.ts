import { createRequire } from 'node:module'
import { run } from './optional'
import { buildDriver } from './build-driver'
import { fetchEsptool } from './fetch-esptool'

const require = createRequire(import.meta.url)
// Electron 42+ no longer downloads its binary in the package's postinstall.
// Reuse the Bun executable running this script, including when it is not on PATH.
run(process.execPath, [require.resolve('electron/install.js')])
run(process.execPath, [require.resolve('electron-builder/cli.js'), 'install-app-deps'])
await buildDriver()
await fetchEsptool()
