import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { getTerminalTheme, fonts, colors, sizes } from './design'
import type { TerminalRuntimeInfo } from './types'
import type { TerminalFrame } from './terminal-layout'
import '@xterm/xterm/css/xterm.css'

let terminalRuntimeInfoPromise: Promise<TerminalRuntimeInfo> | null = null

function getTerminalRuntimeInfo(): Promise<TerminalRuntimeInfo> {
  if (!terminalRuntimeInfoPromise) {
    if (window.takoyaki?.terminal.getRuntimeInfo) {
      terminalRuntimeInfoPromise = window.takoyaki.terminal.getRuntimeInfo().catch(() => ({
        platform: 'unknown',
        windowsPty: null,
      }))
    } else {
      terminalRuntimeInfoPromise = Promise.resolve({ platform: 'unknown', windowsPty: null })
    }
  }
  return terminalRuntimeInfoPromise
}

interface Props {
  surfaceId: string
  terminalId: string
  frame: TerminalFrame | null
  isFocused?: boolean
}

export function Terminal({ surfaceId, terminalId, frame, isFocused }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const frameRef = useRef<TerminalFrame | null>(frame)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAlternateScreen, setIsAlternateScreen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isVisible = Boolean(frame && frame.width >= 24 && frame.height >= 24)

  // keep the latest frame outside the setup effect so visibility changes do not recreate xterm
  useEffect(() => {
    frameRef.current = frame
  }, [frame])

  const clearPendingResize = useCallback(() => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current)
      resizeTimeoutRef.current = null
    }
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = null
    }
  }, [])

  const requestResize = useCallback(() => {
    clearPendingResize()
    const nextFrame = frameRef.current
    if (!nextFrame || nextFrame.width < 24 || nextFrame.height < 24) return

    resizeTimeoutRef.current = setTimeout(() => {
      resizeTimeoutRef.current = null
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null

        const mountNode = containerRef.current
        const term = termRef.current
        const fit = fitRef.current
        if (!mountNode?.isConnected || !term || !fit) return

        const rect = mountNode.getBoundingClientRect()
        if (rect.width < 24 || rect.height < 24) return

        try {
          const dims = fit.proposeDimensions()
          if (!dims || dims.cols < 2 || dims.rows < 1) return

          if (term.cols !== dims.cols || term.rows !== dims.rows) {
            term.resize(dims.cols, dims.rows)
            void window.takoyaki.terminal.resize(terminalId, dims.cols, dims.rows)
          }
        } catch {
          // xterm can throw while tearing down during fast pane changes
        }
      })
    }, 32)
  }, [clearPendingResize, terminalId])

  useEffect(() => {
    if (!containerRef.current || !window.takoyaki) return

    let disposed = false
    let inputDispose: { dispose: () => void } | null = null
    let parsedDispose: { dispose: () => void } | null = null
    let ptyDataCleanup: (() => void) | null = null
    let ptyExitCleanup: (() => void) | null = null
    let observer: ResizeObserver | null = null

    const onThemeChanged = (event: Event) => {
      const mode = (event as CustomEvent).detail as 'dark' | 'light'
      if (termRef.current) termRef.current.options.theme = getTerminalTheme(mode)
    }

    // create one xterm per terminal id and let later frame changes only move and resize it
    void getTerminalRuntimeInfo()
      .then((runtimeInfo) => {
        if (disposed || !containerRef.current) return

        const term = new XTerm({
          fontFamily: fonts.mono,
          fontSize: 14,
          lineHeight: 1.25,
          cursorBlink: false,
          cursorStyle: 'bar',
          cursorInactiveStyle: 'none',
          scrollback: 5000,
          allowProposedApi: true,
          theme: getTerminalTheme((localStorage.getItem('takoyaki-theme') as 'dark' | 'light') || 'dark'),
          windowsPty: runtimeInfo.windowsPty || undefined,
        })

        const fit = new FitAddon()
        const search = new SearchAddon()
        term.loadAddon(fit)
        term.loadAddon(search)

        term.attachCustomKeyEventHandler((event) => {
          if (event.type !== 'keydown') return true
          if (event.ctrlKey && event.key === 'v') {
            event.preventDefault()
            window.takoyaki.clipboard.readText().then((text) => {
              if (text) term.paste(text)
            })
            return false
          }
          if (event.ctrlKey && event.key === 'c') {
            const selection = term.getSelection()
            if (selection) {
              void window.takoyaki.clipboard.writeText(selection)
              term.clearSelection()
              return false
            }
            return true
          }
          return true
        })

        termRef.current = term
        fitRef.current = fit
        searchAddonRef.current = search

        const mountNode = containerRef.current
        mountNode.style.width = '100%'
        mountNode.style.height = '100%'
        mountNode.style.padding = '8px 10px 4px 10px'
        term.open(mountNode)

        window.addEventListener('takoyaki-theme-changed', onThemeChanged)

        inputDispose = term.onData((data) => {
          void window.takoyaki.terminal.write(terminalId, data)
        })

        parsedDispose = term.onWriteParsed(() => {
          const nextAlternate = term.buffer.active.type === 'alternate'
          setIsAlternateScreen((current) => (current === nextAlternate ? current : nextAlternate))
        })

        ptyDataCleanup = window.takoyaki.terminal.onData((id, data) => {
          if (id === terminalId) term.write(data)
        })

        ptyExitCleanup = window.takoyaki.terminal.onExit((id, code) => {
          if (id === terminalId) term.write(`\r\n[exited: ${code}]`)
        })

        observer = new ResizeObserver(() => requestResize())
        observer.observe(mountNode)
        requestResize()
      })
      .catch(() => {
        // terminal init failed, keep pane empty
      })

    return () => {
      disposed = true
      clearPendingResize()
      observer?.disconnect()
      inputDispose?.dispose()
      parsedDispose?.dispose()
      ptyDataCleanup?.()
      ptyExitCleanup?.()
      window.removeEventListener('takoyaki-theme-changed', onThemeChanged)
      searchAddonRef.current = null
      fitRef.current = null
      termRef.current?.dispose()
      termRef.current = null
      setIsAlternateScreen(false)
    }
  }, [clearPendingResize, requestResize, terminalId])

  useEffect(() => {
    if (!isVisible) {
      termRef.current?.blur()
      return
    }

    // visible frame changes should only trigger resize and never rebuild the terminal
    requestResize()
  }, [frame?.height, frame?.left, frame?.top, frame?.width, isVisible, requestResize])

  useEffect(() => {
    const term = termRef.current
    if (!term) return

    if (isFocused && isVisible) {
      term.focus()
      requestResize()
      return
    }

    term.blur()
  }, [isFocused, isVisible, requestResize])

  useEffect(() => {
    if (!window.takoyaki) return
    const cleanup = window.takoyaki.onShortcut((action: string) => {
      if (action === 'find' && isFocused && isVisible) {
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 50)
      }
    })
    return cleanup
  }, [isFocused, isVisible])

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
    if (!isVisible) return
    void window.takoyaki?.surface.focus(surfaceId)
    termRef.current?.focus()
  }

  const wrapperStyle = frame
    ? {
        top: frame.top,
        left: frame.left,
        width: frame.width,
        height: frame.height,
        opacity: 1,
        visibility: 'visible' as const,
        pointerEvents: 'auto' as const,
      }
    : {
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        opacity: 0,
        visibility: 'hidden' as const,
        pointerEvents: 'none' as const,
      }

  return (
    <div
      className={`absolute flex flex-col overflow-hidden ${isAlternateScreen ? 'takoyaki-pane-alt' : 'takoyaki-pane-shell'}`}
      style={{
        ...wrapperStyle,
        background: colors.terminalBg,
        zIndex: isFocused && isVisible ? 2 : 1,
      }}
      onClick={handleClick}
    >
      {isFocused && isVisible && <div style={{ height: 2, background: colors.accentSoft, flexShrink: 0 }} />}

      {searchOpen && isVisible && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 shrink-0"
          style={{ borderBottom: `1px solid ${colors.separator}` }}
        >
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value)
              doSearch(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') doSearch(searchQuery, event.shiftKey ? 'prev' : 'next')
              if (event.key === 'Escape') closeSearch()
            }}
            placeholder="find..."
            className="flex-1 bg-transparent text-[12px] outline-none takoyaki-input"
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
          <button onClick={closeSearch} style={{ color: colors.textMuted }} aria-label="close terminal search">
            <X size={sizes.iconSm} strokeWidth={1.8} />
          </button>
        </div>
      )}

      <div ref={containerRef} className="flex-1 min-h-0" data-surface-id={surfaceId} />
    </div>
  )
}
