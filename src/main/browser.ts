import { WebContentsView, session, shell, type BrowserWindow, type WebContents } from 'electron'
import {
  createDefaultBrowserPanelState,
  getBrowserStateUrl,
  getBrowserUrlDisposition,
  getBrowserWindowOpenDisposition,
  normalizeBrowserInput,
  type BrowserPanelBounds,
  type BrowserPanelState,
} from '../shared/browser'

interface BrowserPanelControllerOptions {
  window: BrowserWindow
  send: (channel: string, ...args: unknown[]) => void
  bindShortcutRouter?: (contents: WebContents) => void
}

const browserSessionPartition = 'takoyaki-browser'

// keeps one lightweight browser companion attached to the main window
export class BrowserPanelController {
  private readonly window: BrowserWindow
  private readonly send: (channel: string, ...args: unknown[]) => void
  private readonly bindShortcutRouter?: (contents: WebContents) => void
  private readonly browserSession = session.fromPartition(browserSessionPartition)
  private view: WebContentsView | null = null
  private bounds: BrowserPanelBounds | null = null
  private state: BrowserPanelState = createDefaultBrowserPanelState()

  constructor({ window, send, bindShortcutRouter }: BrowserPanelControllerOptions) {
    this.window = window
    this.send = send
    this.bindShortcutRouter = bindShortcutRouter
    this.browserSession.setPermissionRequestHandler((_, __, callback) => callback(false))
  }

  getState(): BrowserPanelState {
    return { ...this.state }
  }

  async toggle(url?: string): Promise<BrowserPanelState> {
    return this.state.visible ? this.hide() : this.show(url)
  }

  async show(url?: string): Promise<BrowserPanelState> {
    const target = normalizeBrowserInput(url || '') || this.state.lastUrl
    this.state = {
      ...this.state,
      visible: true,
      error: null,
    }
    this.emit()

    if (target) {
      await this.openTarget(target)
    }

    return this.getState()
  }

  hide(): BrowserPanelState {
    this.destroyView()
    this.state = {
      ...this.state,
      visible: false,
      url: null,
      title: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
    }
    this.emit()
    return this.getState()
  }

  async navigate(input: string): Promise<BrowserPanelState> {
    const target = normalizeBrowserInput(input)
    if (!target) {
      this.state = {
        ...this.state,
        visible: true,
        error: 'Enter a valid web address.',
      }
      this.emit()
      return this.getState()
    }

    this.state = {
      ...this.state,
      visible: true,
    }
    this.emit()
    await this.openTarget(target)
    return this.getState()
  }

  goBack(): BrowserPanelState {
    if (this.view && this.view.webContents.canGoBack()) {
      this.view.webContents.goBack()
    }
    return this.getState()
  }

  goForward(): BrowserPanelState {
    if (this.view && this.view.webContents.canGoForward()) {
      this.view.webContents.goForward()
    }
    return this.getState()
  }

  reload(): BrowserPanelState {
    if (this.view) {
      this.view.webContents.reload()
    }
    return this.getState()
  }

  setBounds(bounds: BrowserPanelBounds): BrowserPanelState {
    this.bounds = bounds
    if (this.view) {
      this.view.setBounds(bounds)
    }
    return this.getState()
  }

  dispose(): void {
    this.destroyView()
  }

  private async openTarget(target: string): Promise<void> {
    const disposition = getBrowserUrlDisposition(target)
    if (disposition === 'external') {
      await shell.openExternal(target)
      this.state = {
        ...this.state,
        error: null,
      }
      this.emit()
      return
    }

    if (disposition === 'blocked') {
      this.state = {
        ...this.state,
        error: 'Only normal web pages can be opened here.',
      }
      this.emit()
      return
    }

    const view = this.ensureView()
    this.state = {
      ...this.state,
      visible: true,
      url: getBrowserStateUrl(target),
      title: this.state.title,
      isLoading: true,
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward(),
      lastUrl: target === 'about:blank' ? this.state.lastUrl : target,
      error: null,
    }
    this.emit()

    try {
      await view.webContents.loadURL(target)
    } catch (error) {
      this.state = {
        ...this.state,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unable to open that page.',
      }
      this.emit()
    }
  }

  private showBlockedNavigationError(message = 'That link cannot be opened inside the browser panel.'): void {
    this.state = {
      ...this.state,
      error: message,
      isLoading: false,
    }
    this.emit()
  }

  private ensureView(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) {
      if (!this.bounds) return this.view
      this.view.setBounds(this.bounds)
      return this.view
    }

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        session: this.browserSession,
      },
    })

    view.webContents.setWindowOpenHandler(({ url }) => {
      const disposition = getBrowserWindowOpenDisposition(url)
      if (disposition === 'external-web') {
        void shell.openExternal(url)
      } else {
        this.showBlockedNavigationError()
      }
      return { action: 'deny' }
    })

    view.webContents.on('will-navigate', (event, url) => {
      const disposition = getBrowserUrlDisposition(url)
      if (disposition === 'panel') return
      event.preventDefault()
      this.showBlockedNavigationError()
    })

    view.webContents.on('did-start-loading', () => {
      this.syncState({ isLoading: true, error: null })
    })

    view.webContents.on('did-stop-loading', () => {
      this.syncState({ isLoading: false, error: null })
    })

    view.webContents.on('page-title-updated', (event) => {
      event.preventDefault()
      this.syncState()
    })

    view.webContents.on('did-navigate', () => {
      this.syncState()
    })

    view.webContents.on('did-navigate-in-page', () => {
      this.syncState()
    })

    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      this.state = {
        ...this.state,
        visible: true,
        url: getBrowserStateUrl(validatedUrl),
        isLoading: false,
        error: errorDescription || 'Unable to open that page.',
      }
      this.emit()
    })

    this.window.contentView.addChildView(view)
    if (this.bounds) {
      view.setBounds(this.bounds)
    }
    this.bindShortcutRouter?.(view.webContents)
    this.view = view
    return view
  }

  private destroyView(): void {
    const view = this.view
    this.view = null
    if (!view) return

    try {
      if (!view.webContents.isDestroyed()) {
        const currentUrl = getBrowserStateUrl(view.webContents.getURL())
        if (currentUrl) {
          this.state = {
            ...this.state,
            lastUrl: currentUrl,
          }
        }
      }
    } catch {
      // the host window may already be tearing down, so url capture is best effort only
    }

    try {
      if (!this.window.isDestroyed()) {
        this.window.contentView.removeChildView(view)
      }
    } catch {
      // removing the child view is not required once the window is already gone
    }

    try {
      if (!view.webContents.isDestroyed()) {
        view.webContents.close()
      }
    } catch {
      // shutdown can destroy the guest before we reach explicit cleanup
    }
  }

  private syncState(overrides: Partial<BrowserPanelState> = {}): void {
    if (!this.view || this.view.webContents.isDestroyed()) {
      this.emit()
      return
    }

    const currentUrl = getBrowserStateUrl(this.view.webContents.getURL())
    this.state = {
      ...this.state,
      visible: true,
      url: currentUrl,
      title: this.view.webContents.getTitle() || null,
      isLoading: this.view.webContents.isLoading(),
      canGoBack: this.view.webContents.canGoBack(),
      canGoForward: this.view.webContents.canGoForward(),
      lastUrl: currentUrl || this.state.lastUrl,
      ...overrides,
    }
    this.emit()
  }

  private emit(): void {
    this.send('browser:state-changed', this.getState())
  }
}
