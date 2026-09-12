import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { UpdateManager } from '../src/main/update-manager'
import { updateAction, updateButtonLabel } from '../src/common/update'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  allowPrerelease = true
  checks = 0
  downloads = 0
  installs = 0
  checkForUpdates = async (): Promise<unknown> => {
    this.checks++
    this.emit('update-available', { version: '3.3.0' })
    return {}
  }
  downloadUpdate = async (): Promise<string[]> => {
    this.downloads++
    return []
  }
  quitAndInstall = (): void => {
    this.installs++
  }
}

function setup(reason?: string) {
  const updater = new FakeUpdater()
  let confirmed = false
  let prompts = 0
  let preparations = 0
  const manager = new UpdateManager(
    updater as unknown as ConstructorParameters<typeof UpdateManager>[0],
    () => undefined,
    async () => {
      prompts++
      return confirmed
    },
    async () => {
      preparations++
    },
    reason
  )
  return {
    updater,
    manager,
    confirm: () => {
      confirmed = true
    },
    prompts: () => prompts,
    preparations: () => preparations
  }
}

test('startup checks once without automatic download or installation', async () => {
  const { updater, manager } = setup()
  await manager.checkOnStartup()
  await manager.checkOnStartup()
  assert.equal(updater.checks, 1)
  assert.equal(updater.downloads, 0)
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.allowPrerelease, false)
  assert.equal(manager.getState().status, 'available')
})

test('unsupported runtime does not contact the update server', async () => {
  const { updater, manager } = setup('Development mode')
  await manager.checkOnStartup()
  await manager.check()
  await manager.download()
  await manager.install()
  assert.equal(updater.checks, 0)
  assert.equal(updater.downloads, 0)
  assert.equal(updater.installs, 0)
})

test('concurrent checks are deduplicated and the latest version is shown', async () => {
  const { updater, manager } = setup()
  let finish!: () => void
  updater.checkForUpdates = async () => {
    updater.checks++
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    updater.emit('update-not-available', { version: '3.2.26' })
    return {}
  }
  const pending = manager.check()
  await manager.check()
  assert.equal(updater.checks, 1)
  finish()
  await pending
  assert.equal(manager.getState().status, 'current')
})

test('download tracks progress, blocks duplicate requests and preserves downloaded state', async () => {
  const { updater, manager } = setup()
  await manager.check()
  let finish!: () => void
  updater.downloadUpdate = async () => {
    updater.downloads++
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    updater.emit('update-downloaded', { version: '3.3.0' })
    return []
  }
  const pending = manager.download()
  await manager.download()
  await manager.check()
  updater.emit('download-progress', {
    percent: 42.5,
    transferred: 425,
    total: 1000,
    bytesPerSecond: 100
  })
  assert.equal(manager.getState().percent, 42.5)
  assert.equal(updater.downloads, 1)
  assert.equal(updater.checks, 1)
  finish()
  await pending
  await manager.check()
  assert.equal(manager.getState().status, 'downloaded')
  assert.equal(updateButtonLabel(manager.getState()), '安装更新')
  assert.equal(updater.installs, 0)
})

test('installation requires downloaded update and explicit confirmation before preparation', async () => {
  const fixture = setup()
  await fixture.manager.install()
  assert.equal(fixture.prompts(), 0)
  fixture.updater.emit('update-downloaded', { version: '3.3.0' })
  await fixture.manager.install()
  assert.equal(fixture.preparations(), 0)
  assert.equal(fixture.updater.installs, 0)
  assert.equal(fixture.manager.getState().status, 'downloaded')
  fixture.confirm()
  await Promise.all([fixture.manager.install(), fixture.manager.install()])
  assert.equal(fixture.prompts(), 2)
  assert.equal(fixture.preparations(), 1)
  assert.equal(fixture.updater.installs, 1)
})

test('download errors retain a retry action, installation errors retain the installer', async () => {
  const fixture = setup()
  await fixture.manager.check()
  fixture.updater.downloadUpdate = async () => {
    throw new Error('offline')
  }
  await fixture.manager.download()
  assert.equal(updateAction(fixture.manager.getState()), 'download')
  assert.match(fixture.manager.getState().message, /offline/)
  fixture.updater.downloadUpdate = async () => {
    fixture.updater.emit('update-downloaded', { version: '3.3.0' })
    return []
  }
  await fixture.manager.download()
  fixture.confirm()
  fixture.updater.quitAndInstall = () => {
    fixture.updater.emit('error', new Error('installer failed'))
  }
  await fixture.manager.install()
  assert.equal(updateAction(fixture.manager.getState()), 'install')
  assert.equal(updateButtonLabel(fixture.manager.getState()), '安装更新')
  await fixture.manager.check()
  assert.equal(fixture.updater.checks, 1)
})

test('network failure is recoverable by a new check', async () => {
  const { updater, manager } = setup()
  updater.checkForUpdates = async () => {
    throw new Error('network unavailable')
  }
  await manager.checkOnStartup()
  assert.equal(updateAction(manager.getState()), 'check')
  updater.checkForUpdates = async () => {
    updater.emit('update-not-available', {})
    return {}
  }
  await manager.check()
  assert.equal(manager.getState().status, 'current')
})
