import type { AppUpdater } from 'electron-updater'
import type { UpdateState } from '../common/update'

type Updater = Pick<
  AppUpdater,
  | 'on'
  | 'autoDownload'
  | 'autoInstallOnAppQuit'
  | 'allowPrerelease'
  | 'checkForUpdates'
  | 'downloadUpdate'
  | 'quitAndInstall'
>

export class UpdateManager {
  private state: UpdateState
  private busy = false
  private started = false

  constructor(
    private readonly updater: Updater,
    private readonly publish: (state: UpdateState) => void,
    private readonly confirmInstall: () => Promise<boolean>,
    private readonly prepareInstall: () => Promise<void>,
    unavailableReason?: string
  ) {
    this.state = unavailableReason
      ? { status: 'unsupported', message: unavailableReason }
      : { status: 'idle', message: '启动时自动检查更新，也可以手动检查。' }
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.on('update-available', (info) =>
      this.set({
        status: 'available',
        version: info.version,
        message: `发现新版本 v${info.version}，可下载更新。`
      })
    )
    updater.on('update-not-available', () =>
      this.set({ status: 'current', message: '当前已是最新版本。' })
    )
    updater.on('download-progress', (progress) => {
      if (this.state.status !== 'downloading') return
      this.set({
        ...this.state,
        percent: Math.max(0, Math.min(100, progress.percent)),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
      })
    })
    updater.on('update-downloaded', (info) =>
      this.set({
        status: 'downloaded',
        version: info.version,
        percent: 100,
        message: `v${info.version} 已下载完成，点击“安装更新”开始安装。`
      })
    )
    updater.on('error', (error) => this.fail(error))
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  private set(state: UpdateState): void {
    this.state = state
    this.publish(this.getState())
  }

  private fail(error: unknown): void {
    const retry = ['installing', 'downloaded'].includes(this.state.status)
      ? 'install'
      : this.state.status === 'downloading'
        ? 'download'
        : (this.state.retry ?? 'check')
    this.set({
      ...this.state,
      status: 'error',
      retry,
      message: `更新失败：${error instanceof Error ? error.message : String(error)}`
    })
  }

  async checkOnStartup(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.check()
  }

  async check(): Promise<void> {
    if (
      this.busy ||
      ['unsupported', 'downloaded', 'installing'].includes(this.state.status) ||
      this.state.retry === 'install'
    )
      return
    this.busy = true
    this.set({ status: 'checking', message: '正在检查新版本…' })
    try {
      const result = await this.updater.checkForUpdates()
      if (!result)
        this.set({
          status: 'unsupported',
          message: '当前运行方式不支持自动更新，请使用已安装的正式版本。'
        })
    } catch (error) {
      this.fail(error)
    } finally {
      this.busy = false
    }
  }

  async download(): Promise<void> {
    if (
      this.busy ||
      !(
        this.state.status === 'available' ||
        (this.state.status === 'error' && this.state.retry === 'download')
      )
    )
      return
    this.busy = true
    this.set({
      status: 'downloading',
      version: this.state.version,
      percent: 0,
      message: '正在下载更新，可继续使用程序。'
    })
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      this.fail(error)
    } finally {
      this.busy = false
    }
  }

  async install(): Promise<void> {
    if (
      this.busy ||
      !(
        this.state.status === 'downloaded' ||
        (this.state.status === 'error' && this.state.retry === 'install')
      )
    )
      return
    this.busy = true
    try {
      if (!(await this.confirmInstall())) return
      this.set({
        ...this.state,
        status: 'installing',
        message: '正在关闭串口和运行任务，准备安装更新…'
      })
      await this.prepareInstall()
      this.updater.quitAndInstall(false, true)
    } catch (error) {
      this.fail(error)
    } finally {
      this.busy = false
    }
  }
}
