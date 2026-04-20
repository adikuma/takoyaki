export interface BrowserPanelBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserPanelState {
  visible: boolean
  url: string | null
  title: string | null
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  lastUrl: string | null
  error: string | null
}

export type BrowserUrlDisposition = 'panel' | 'blocked'
export type BrowserWindowOpenDisposition = 'external-web' | 'block'

// keep the browser state shape shared across main and renderer
export function createDefaultBrowserPanelState(): BrowserPanelState {
  return {
    visible: false,
    url: null,
    title: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    lastUrl: null,
    error: null,
  }
}

// accept explicit web urls and simple domains without adding search glue
export function normalizeBrowserInput(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const isExplicitUrl = /^https?:\/\//i.test(trimmed) || trimmed === 'about:blank'
  const looksLikeBareWebHost =
    /^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+(?::\d{2,5})?(?:[/?#].*)?$/i.test(trimmed) ||
    /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?:[/?#].*)?$/.test(trimmed)

  const withScheme = isExplicitUrl ? trimmed : looksLikeBareWebHost ? `https://${trimmed}` : null
  if (!withScheme) return null

  try {
    return new URL(withScheme).toString()
  } catch {
    return null
  }
}

// keep popup windows constrained to normal web pages
export function getBrowserWindowOpenDisposition(rawUrl: string): BrowserWindowOpenDisposition {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? 'external-web' : 'block'
  } catch {
    return 'block'
  }
}

// only allow normal web pages inside the embedded browser
export function getBrowserUrlDisposition(rawUrl: string): BrowserUrlDisposition {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'http:' || url.protocol === 'https:') return 'panel'
    if (url.protocol === 'about:' && url.toString() === 'about:blank') return 'panel'
    return 'blocked'
  } catch {
    return 'blocked'
  }
}

// hide about blank so the renderer can keep an empty panel truly empty
export function getBrowserStateUrl(rawUrl: string): string | null {
  if (!rawUrl || rawUrl === 'about:blank') return null
  return rawUrl
}
