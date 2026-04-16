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

export type BrowserUrlDisposition = 'panel' | 'external' | 'blocked'
export type BrowserWindowOpenDisposition = 'external-web' | 'block'

// keeps the browser panel state shape consistent across main and renderer
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

// parses the browser bar input into a real url with minimal first-pass rules
export function normalizeBrowserInput(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const isExplicitUrl = /^https?:\/\//i.test(trimmed) || trimmed === 'about:blank'
  const looksLikeBareWebHost =
    /^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+(?::\d{2,5})?(?:[/?#].*)?$/i.test(trimmed) ||
    /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?:[/?#].*)?$/.test(trimmed)

  const withScheme = isExplicitUrl
    ? trimmed
    : trimmed.includes(' ') || !looksLikeBareWebHost
      ? null
      : `https://${trimmed}`

  if (!withScheme) return null

  try {
    return new URL(withScheme).toString()
  } catch {
    return null
  }
}

// keeps popup and target blank links constrained to normal web urls only
export function getBrowserWindowOpenDisposition(rawUrl: string): BrowserWindowOpenDisposition {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? 'external-web' : 'block'
  } catch {
    return 'block'
  }
}

// keeps the embedded browser restricted to normal web content only
export function getBrowserUrlDisposition(rawUrl: string): BrowserUrlDisposition {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'http:' || url.protocol === 'https:') return 'panel'
    if (url.protocol === 'about:' && url.toString() === 'about:blank') return 'panel'
    if (url.protocol === 'javascript:' || url.protocol === 'data:' || url.protocol === 'file:') return 'blocked'
    return 'external'
  } catch {
    return 'blocked'
  }
}

// hides about blank from the renderer so the panel can render a cleaner empty state
export function getBrowserStateUrl(rawUrl: string): string | null {
  if (!rawUrl || rawUrl === 'about:blank') return null
  return rawUrl
}
