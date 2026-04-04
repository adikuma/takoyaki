// xterm.js terminal component
// connects to an existing pty in main process
import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { getTerminalTheme, fonts, colors, sizes } from './design'
import '@xterm/xterm/css/xterm.css'

// each terminal receives
interface Props {
  surfaceId: string
  terminalId: string
  isFocused?: boolean
}

export function Terminal({ surfaceId, terminalId, isFocused }: Props) {
  // using a ref and not state so that the terminal is not recreated on every render
  // data that code uses internally but the UI doesn't need to see
  const containerRef = useRef<HTMLDivElement>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const isReadyRef = useRef(false)
  const [searchOpen, setSearchOpen] = useState(false) // state for search bar open/closed
  const [searchQuery, setSearchQuery] = useState('') // state for search query
  const [isAlternateScreen, setIsAlternateScreen] = useState(false) // state for alternate screen mode
  const searchInputRef = useRef<HTMLInputElement>(null) // ref for search input

  useEffect(() => {
    if (!containerRef.current || !window.mux) return
    let disposed = false

    // xterm terminal instance
    // with addons for search and fit
    const term = new XTerm({
      fontFamily: fonts.mono,
      fontSize: 14,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'none',
      scrollback: 5000,
      allowProposedApi: true,
      theme: getTerminalTheme((localStorage.getItem('mux-theme') as 'dark' | 'light') || 'dark'),
    })

    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    termRef.current = term
    fitRef.current = fit
    searchAddonRef.current = search

    // update terminal theme when user toggles light/dark mode
    const onThemeChanged = (e: Event) => {
      const mode = (e as CustomEvent).detail as 'dark' | 'light'
      term.options.theme = getTerminalTheme(mode)
    }
    window.addEventListener('mux-theme-changed', onThemeChanged)

    const syncFit = () => {
      requestAnimationFrame(() => {
        if (disposed || !containerRef.current?.isConnected || !fitRef.current || !termRef.current) return
        try {
          fit.fit()
          window.mux.terminal.resize(terminalId, term.cols, term.rows)
        } catch {
          // fit or resize can fail during teardown
        }
      })
    }

    term.open(containerRef.current)
    isReadyRef.current = true
    syncFit()

    const dataCleanup = window.mux.terminal.onData((id, data) => {
      if (id === terminalId) term.write(data)
    })

    const exitCleanup = window.mux.terminal.onExit((id, code) => {
      if (id === terminalId) term.write(`\r\n[exited: ${code}]`)
    })

    const inputDispose = term.onData((data) => {
      window.mux.terminal.write(terminalId, data)
    })

    const resizeDispose = term.onResize(({ cols, rows }) => {
      window.mux.terminal.resize(terminalId, cols, rows)
    })

    let didSettledFit = false
    const parsedDispose = term.onWriteParsed(() => {
      const nextAlternate = term.buffer.active.type === 'alternate'
      setIsAlternateScreen((current) => (current === nextAlternate ? current : nextAlternate))
      if (!didSettledFit) {
        didSettledFit = true
        syncFit()
      }
    })

    const observer = new ResizeObserver(() => syncFit())
    observer.observe(containerRef.current)

    return () => {
      disposed = true
      isReadyRef.current = false
      window.removeEventListener('mux-theme-changed', onThemeChanged)
      observer.disconnect()
      dataCleanup?.()
      exitCleanup?.()
      inputDispose.dispose()
      resizeDispose.dispose()
      parsedDispose.dispose()
      termRef.current = null
      fitRef.current = null
      searchAddonRef.current = null
      setIsAlternateScreen(false)
      term.dispose()
    }
  }, [terminalId])

  useEffect(() => {
    const term = termRef.current
    if (!term || !isReadyRef.current) return

    if (isFocused) {
      requestAnimationFrame(() => {
        if (!termRef.current || !fitRef.current || !containerRef.current?.isConnected) return
        try {
          term.focus()
          fitRef.current.fit()
          window.mux?.terminal.resize(terminalId, term.cols, term.rows)
        } catch {
          // fit or resize can fail during teardown
        }
      })
      return
    }

    term.blur()
  }, [isFocused, terminalId])

  // ctrl+f opens search (registered in main process before-input-event)
  useEffect(() => {
    if (!window.mux) return
    const cleanup = window.mux.onShortcut((action: string) => {
      if (action === 'find' && isFocused) {
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 50)
      }
    })
    return cleanup
  }, [isFocused])

  const doSearch = (query: string, direction: 'next' | 'prev' = 'next') => {
    if (!searchAddonRef.current || !query) return
    if (direction === 'next') searchAddonRef.current.findNext(query)
    else searchAddonRef.current.findPrevious(query)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    searchAddonRef.current?.clearDecorations()
  }

  const handleClick = () => {
    if (window.mux) window.mux.surface.focus(surfaceId)
    termRef.current?.focus()
  }

  return (
    <div
      className={`w-full h-full flex flex-col ${isAlternateScreen ? 'mux-pane-alt' : 'mux-pane-shell'}`}
      style={{ background: colors.terminalBg }}
      onClick={handleClick}
    >
      {isFocused && <div style={{ height: 2, background: colors.accentSoft, flexShrink: 0 }} />}

      {/* search bar */}
      {searchOpen && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 shrink-0"
          style={{ borderBottom: `1px solid ${colors.separator}` }}
        >
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              doSearch(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doSearch(searchQuery, e.shiftKey ? 'prev' : 'next')
              if (e.key === 'Escape') closeSearch()
            }}
            placeholder="find..."
            className="flex-1 bg-transparent text-[12px] outline-none mux-input"
            style={{ color: colors.textPrimary }}
          />
          <button
            onClick={() => doSearch(searchQuery, 'prev')}
            style={{ color: colors.textMuted }}
            aria-label="previous terminal match"
          >
            <ChevronUp size={sizes.iconSm} strokeWidth={1.8} />
          </button>
          <button
            onClick={() => doSearch(searchQuery, 'next')}
            style={{ color: colors.textMuted }}
            aria-label="next terminal match"
          >
            <ChevronDown size={sizes.iconSm} strokeWidth={1.8} />
          </button>
          <button onClick={closeSearch} style={{ color: colors.textMuted }}>
            <X size={sizes.iconSm} strokeWidth={1.8} />
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 min-h-0"
        style={{ padding: '8px 10px 4px 10px' }}
        data-surface-id={surfaceId}
      />
    </div>
  )
}
