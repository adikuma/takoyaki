import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createDefaultUpdateState, type UpdateState } from '../shared/updates'

type SendUpdateState = (channel: string, state: UpdateState) => void

// wraps electron-updater so the renderer only sees a tiny serializable state machine
export class UpdateService {
  private readonly send: SendUpdateState
  private readonly enabled = app.isPackaged
  private state: UpdateState = createDefaultUpdateState(app.getVersion(), app.isPackaged)
  private started = false

  constructor(send: SendUpdateState) {
    this.send = send
  }

  start(): void {
    if (this.started) return
    this.started = true

    if (!this.enabled) {
      this.emit()
      return
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.logger = null

    autoUpdater.on('checking-for-update', () => {
      this.setState({
        status: 'checking',
        detail: 'Checking for updates.',
        downloadPercent: null,
        checkedAt: Date.now(),
      })
    })

    autoUpdater.on('update-available', (info) => {
      this.setState({
        status: 'available',
        availableVersion: info.version,
        detail: `Version ${info.version} is available. Downloading now.`,
        downloadPercent: null,
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      this.setState({
        status: 'downloading',
        detail: 'Downloading update.',
        downloadPercent: Math.round(progress.percent),
      })
    })

    autoUpdater.on('update-downloaded', (event) => {
      this.setState({
        status: 'downloaded',
        availableVersion: event.version,
        detail: `Version ${event.version} is ready to install.`,
        downloadPercent: 100,
        downloadedAt: Date.now(),
      })
    })

    autoUpdater.on('update-not-available', (info) => {
      this.setState({
        status: 'not-available',
        availableVersion: info.version,
        detail: 'Takoyaki is up to date.',
        downloadPercent: null,
        checkedAt: Date.now(),
      })
    })

    autoUpdater.on('error', (error) => {
      this.setState({
        status: 'error',
        detail: error.message || 'Unable to check for updates.',
        downloadPercent: null,
      })
    })

    setTimeout(() => {
      void this.check()
    }, 5000)
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  async check(): Promise<UpdateState> {
    if (!this.enabled) return this.getState()
    if (this.state.status === 'checking' || this.state.status === 'downloading') return this.getState()

    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.setState({
        status: 'error',
        detail: error instanceof Error ? error.message : 'Unable to check for updates.',
        downloadPercent: null,
      })
    }

    return this.getState()
  }

  install(): UpdateState {
    if (this.state.status !== 'downloaded') return this.getState()
    autoUpdater.quitAndInstall(false, true)
    return this.getState()
  }

  private setState(next: Partial<UpdateState>): void {
    this.state = {
      ...this.state,
      ...next,
    }
    this.emit()
  }

  private emit(): void {
    this.send('updates:state-changed', this.getState())
  }
}
