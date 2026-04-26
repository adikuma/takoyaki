import { WebContentsView, session, shell, type BrowserWindow, type WebContents } from 'electron'
import {
  createDefaultBrowserPanelState,
  getBrowserStateUrl,
  getBrowserUrlDisposition,
  getBrowserWindowOpenDisposition,
  normalizeBrowserInput,
  sanitizeBrowserUserAgent,
  type BrowserPanelBounds,
  type BrowserPanelState,
} from '../shared/browser'

interface BrowserPanelControllerOptions {
  window: BrowserWindow
  send: (channel: string, ...args: unknown[]) => void
  bindShortcutRouter?: (contents: WebContents) => void
  getFocusedSurfaceId: () => string | null
  restoreSurfaceFocus: (surfaceId: string | null) => void
}

const browserSessionPartition = 'persist:takoyaki-browser'

// keep the browser as a separate companion so it never owns workspace layout state
export class BrowserPanelController {
  private readonly window: BrowserWindow
  private readonly send: (channel: string, ...args: unknown[]) => void
  private readonly bindShortcutRouter?: (contents: WebContents) => void
  private readonly getFocusedSurfaceId: () => string | null
  private readonly restoreSurfaceFocus: (surfaceId: string | null) => void
  private readonly browserSession = session.fromPartition(browserSessionPartition)
  private view: WebContentsView | null = null
  private bounds: BrowserPanelBounds | null = null
  private state: BrowserPanelState = createDefaultBrowserPanelState()
  private returnFocusSurfaceId: string | null = null

  constructor({
    window,
    send,
    bindShortcutRouter,
    getFocusedSurfaceId,
    restoreSurfaceFocus,
  }: BrowserPanelControllerOptions) {
    this.window = window
    this.send = send
    this.bindShortcutRouter = bindShortcutRouter
    this.getFocusedSurfaceId = getFocusedSurfaceId
    this.restoreSurfaceFocus = restoreSurfaceFocus
    this.browserSession.setPermissionRequestHandler((_, __, callback) => callback(false))
  }

  getState(): BrowserPanelState {
    return { ...this.state }
  }

  async toggle(url?: string): Promise<BrowserPanelState> {
    return this.state.visible ? this.hide() : this.show(url)
  }

  async show(url?: string): Promise<BrowserPanelState> {
    if (!this.state.visible) {
      this.returnFocusSurfaceId = this.getFocusedSurfaceId()
    }

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
    this.restoreFocus()
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

    if (!this.state.visible) {
      this.returnFocusSurfaceId = this.getFocusedSurfaceId()
    }

    this.state = {
      ...this.state,
      visible: true,
      error: null,
    }
    this.emit()
    await this.openTarget(target)
    return this.getState()
  }

  goBack(): BrowserPanelState {
    if (this.view && !this.view.webContents.isDestroyed() && this.view.webContents.canGoBack()) {
      this.view.webContents.goBack()
      this.view.webContents.focus()
    }
    return this.getState()
  }

  goForward(): BrowserPanelState {
    if (this.view && !this.view.webContents.isDestroyed() && this.view.webContents.canGoForward()) {
      this.view.webContents.goForward()
      this.view.webContents.focus()
    }
    return this.getState()
  }

  reload(): BrowserPanelState {
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.webContents.reload()
      this.view.webContents.focus()
    }
    return this.getState()
  }

  setBounds(bounds: BrowserPanelBounds): BrowserPanelState {
    this.bounds = bounds
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.setBounds(bounds)
    }
    return this.getState()
  }

  dispose(): void {
    this.destroyView()
  }

  private async openTarget(target: string): Promise<void> {
    const disposition = getBrowserUrlDisposition(target)
    if (disposition === 'blocked') {
      this.state = {
        ...this.state,
        error: 'Only normal web pages can be opened here.',
        isLoading: false,
      }
      this.emit()
      return
    }

    const view = this.ensureView()
    this.state = {
      ...this.state,
      visible: true,
      url: getBrowserStateUrl(target),
      isLoading: true,
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward(),
      lastUrl: target === 'about:blank' ? this.state.lastUrl : target,
      error: null,
    }
    this.emit()

    try {
      await view.webContents.loadURL(target)
      if (!view.webContents.isDestroyed()) {
        view.webContents.focus()
      }
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
      if (this.bounds) {
        this.view.setBounds(this.bounds)
      }
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
    view.webContents.setUserAgent(sanitizeBrowserUserAgent(view.webContents.getUserAgent()))

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
      if (getBrowserUrlDisposition(url) === 'panel') return
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
    view.setBounds(this.bounds || { x: 0, y: 0, width: 0, height: 0 })
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
      // url capture is best effort during shutdown
    }

    try {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    } catch {
      // bounds cleanup is best effort if the view is already tearing down
    }

    try {
      if (!this.window.isDestroyed()) {
        this.window.contentView.removeChildView(view)
      }
    } catch {
      // removal is not required once the host window is already gone
    }

    try {
      if (!view.webContents.isDestroyed()) {
        view.webContents.close()
      }
    } catch {
      // shutdown can destroy the guest before explicit cleanup runs
    }
  }

  private restoreFocus(): void {
    const surfaceId = this.getFocusedSurfaceId() || this.returnFocusSurfaceId
    this.returnFocusSurfaceId = null

    try {
      if (!this.window.isDestroyed()) {
        this.window.webContents.focus()
      }
    } catch {
      // renderer focus is best effort during window teardown
    }

    this.restoreSurfaceFocus(surfaceId)
    this.send('browser:return-focus', surfaceId)
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
