import { describe, expect, it } from 'vitest'
import {
  createDefaultBrowserPanelState,
  getBrowserStateUrl,
  getBrowserUrlDisposition,
  getBrowserWindowOpenDisposition,
  normalizeBrowserInput,
  sanitizeBrowserUserAgent,
} from '../shared/browser'

describe('browser helpers', () => {
  it('starts with a clean hidden state', () => {
    expect(createDefaultBrowserPanelState()).toEqual({
      visible: false,
      url: null,
      title: null,
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      lastUrl: null,
      error: null,
    })
  })

  it('normalizes bare domains into https urls', () => {
    expect(normalizeBrowserInput('example.com')).toBe('https://example.com/')
  })

  it('keeps explicit localhost urls valid', () => {
    expect(normalizeBrowserInput('http://localhost:3000')).toBe('http://localhost:3000/')
  })

  it('rejects plain search text and ambiguous localhost shortcuts', () => {
    expect(normalizeBrowserInput('browser helpers')).toBeNull()
    expect(normalizeBrowserInput('nba')).toBeNull()
    expect(normalizeBrowserInput('localhost:3000')).toBeNull()
  })

  it('classifies web urls for the embedded panel', () => {
    expect(getBrowserUrlDisposition('https://example.com')).toBe('panel')
    expect(getBrowserUrlDisposition('http://example.com')).toBe('panel')
    expect(getBrowserUrlDisposition('about:blank')).toBe('panel')
  })

  it('blocks non web protocols from embedded navigation', () => {
    expect(getBrowserUrlDisposition('mailto:test@example.com')).toBe('blocked')
    expect(getBrowserUrlDisposition('slack://channel')).toBe('blocked')
    expect(getBrowserUrlDisposition('javascript:alert(1)')).toBe('blocked')
    expect(getBrowserUrlDisposition('file:///c:/secret.txt')).toBe('blocked')
  })

  it('only allows normal web popup urls to open externally', () => {
    expect(getBrowserWindowOpenDisposition('https://example.com')).toBe('external-web')
    expect(getBrowserWindowOpenDisposition('http://example.com')).toBe('external-web')
    expect(getBrowserWindowOpenDisposition('about:blank')).toBe('block')
    expect(getBrowserWindowOpenDisposition('slack://channel')).toBe('block')
  })

  it('hides about blank from renderer state', () => {
    expect(getBrowserStateUrl('about:blank')).toBeNull()
    expect(getBrowserStateUrl('https://example.com')).toBe('https://example.com')
  })

  it('removes electron app branding from browser user agents', () => {
    expect(
      sanitizeBrowserUserAgent(
        'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36 Electron/33.2.1 takoyaki/0.2.1 cmux-windows/0.2.1',
      ),
    ).toBe('Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36')
  })
})
