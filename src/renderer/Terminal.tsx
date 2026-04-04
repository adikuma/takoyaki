// xterm.js terminal component
// uses a module-level pool so xterm instances survive react remounts (splits/closes)
// the react component just attaches/detaches the pool's container div
import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { getTerminalTheme, fonts, colors, sizes } from './design'
import type { TerminalRuntimeInfo } from './types'
import '@xterm/xterm/css/xterm.css'

// pool entry: xterm instance + addons + container div + persistent listeners
interface PoolEntry {
  term: XTerm
  fit: FitAddon
  search: SearchAddon
  container: HTMLDivElement
  dataCleanup: (() => void) | null
  exitCleanup: (() => void) | null
  exited: boolean
}

// xterm instances live here, outside react lifecycle
const terminalPool = new Map<string, PoolEntry>()
const terminalPoolPending = new Map<string, Promise<PoolEntry>>()
let terminalRuntimeInfoPromise: Promise<TerminalRuntimeInfo> | null = null

interface XTermWithViewportCore extends XTerm {
  _core?: {
    viewport?: {
      syncScrollArea: (immediate?: boolean) => void
    }
  }
}

function syncViewportAfterAttach(term: XTerm): void {
  const viewportY = term.buffer.active.viewportY
  const core = term as XTermWithViewportCore

  // xterm does not expose a public reattach hook, but syncing the internal viewport
  // preserves the existing scroll position and recalculates the scrollbar geometry.
  core._core?.viewport?.syncScrollArea(true)
  term.refresh(0, term.rows - 1)

  // if the viewport sync hook is unavailable, fall back to the old behavior
  if (!core._core?.viewport) {
    term.scrollToBottom()
    if (viewportY !== term.buffer.active.viewportY) term.scrollToLine(viewportY)
  }
}

function getTerminalRuntimeInfo(): Promise<TerminalRuntimeInfo> {
  if (!terminalRuntimeInfoPromise) {
    if (window.mux?.terminal.getRuntimeInfo) {
      terminalRuntimeInfoPromise = window.mux.terminal.getRuntimeInfo().catch(() => ({
        platform: 'unknown',
        windowsPty: null,
      }))
    } else {
      terminalRuntimeInfoPromise = Promise.resolve({ platform: 'unknown', windowsPty: null })
    }
  }
  return terminalRuntimeInfoPromise
}

async function createEntry(terminalId: string): Promise<PoolEntry> {
  const runtimeInfo = await getTerminalRuntimeInfo()
  const existing = terminalPool.get(terminalId)
  if (existing) return existing

  const term = new XTerm({
    fontFamily: fonts.mono,
    fontSize: 14,
    lineHeight: 1.25,
    cursorBlink: false,
    cursorStyle: 'bar',
    cursorInactiveStyle: 'none',
    scrollback: 5000,
    allowProposedApi: true,
    theme: getTerminalTheme((localStorage.getItem('mux-theme') as 'dark' | 'light') || 'dark'),
    windowsPty: runtimeInfo.windowsPty || undefined,
  })

  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)

  // clipboard: ctrl+v pastes, ctrl+c copies selection or sends SIGINT
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    if (e.ctrlKey && e.key === 'v') {
      e.preventDefault()
      window.mux.clipboard.readText().then((text) => {
        if (text) term.paste(text)
      })
      return false
    }
    if (e.ctrlKey && e.key === 'c') {
      const sel = term.getSelection()
      if (sel) {
        void window.mux.clipboard.writeText(sel)
        term.clearSelection()
        return false
      }
      return true
    }
    return true
  })

  // container div that xterm renders into (created once, moved via appendChild)
  const container = document.createElement('div')
  container.style.width = '100%'
  container.style.height = '100%'
  container.style.padding = '8px 10px 4px 10px'
  term.open(container)

  const entry: PoolEntry = { term, fit, search, container, dataCleanup: null, exitCleanup: null, exited: false }

  // persistent listeners: pty data flows to xterm even while detached
  entry.dataCleanup = window.mux.terminal.onData((id, data) => {
    if (id === terminalId) term.write(data)
  })

  entry.exitCleanup = window.mux.terminal.onExit((id, code) => {
    if (id === terminalId) {
      term.write(`\r\n[exited: ${code}]`)
      entry.exited = true
    }
  })

  terminalPool.set(terminalId, entry)
  return entry
}

function getOrCreateEntry(terminalId: string): Promise<PoolEntry> {
  const existing = terminalPool.get(terminalId)
  if (existing) return Promise.resolve(existing)

  const pending = terminalPoolPending.get(terminalId)
  if (pending) return pending

  const nextEntry = createEntry(terminalId)
    .then((entry) => {
      terminalPoolPending.delete(terminalId)
      return entry
    })
    .catch((error) => {
      terminalPoolPending.delete(terminalId)
      throw error
    })

  terminalPoolPending.set(terminalId, nextEntry)
  return nextEntry
}

function disposeEntry(terminalId: string): void {
  const entry = terminalPool.get(terminalId)
  if (!entry) return
  entry.dataCleanup?.()
  entry.exitCleanup?.()
  entry.term.dispose()
  terminalPool.delete(terminalId)
}

interface Props {
  surfaceId: string
  terminalId: string
  isFocused?: boolean
}

export function Terminal({ surfaceId, terminalId, isFocused }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const isReadyRef = useRef(false)
  const isFocusedRef = useRef(Boolean(isFocused))
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const requestStableResizeRef = useRef<(() => void) | null>(null)
  const didSyncViewportAfterAttachRef = useRef(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAlternateScreen, setIsAlternateScreen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const clearPendingResize = () => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current)
      resizeTimeoutRef.current = null
    }
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = null
    }
  }

  useEffect(() => {
    isFocusedRef.current = Boolean(isFocused)
  }, [isFocused])

  useEffect(() => {
    if (!containerRef.current || !window.mux) return
    let disposed = false
    const mountNode = containerRef.current
    let entry: PoolEntry | null = null
    let inputDispose: { dispose: () => void } | null = null
    let parsedDispose: { dispose: () => void } | null = null
    let observer: ResizeObserver | null = null
    const onThemeChanged = (e: Event) => {
      const mode = (e as CustomEvent).detail as 'dark' | 'light'
      if (termRef.current) termRef.current.options.theme = getTerminalTheme(mode)
    }

    void getOrCreateEntry(terminalId)
      .then((nextEntry) => {
        if (disposed) return

        entry = nextEntry
        const { term, fit, search } = nextEntry

        termRef.current = term
        fitRef.current = fit
        searchAddonRef.current = search

        mountNode.appendChild(nextEntry.container)
        isReadyRef.current = true
        didSyncViewportAfterAttachRef.current = false

        requestStableResizeRef.current = () => {
          clearPendingResize()
          resizeTimeoutRef.current = setTimeout(() => {
            resizeTimeoutRef.current = null

            const measureStableSize = (
              previousRect?: { width: number; height: number },
              previousDims?: { cols: number; rows: number },
            ) => {
              resizeFrameRef.current = requestAnimationFrame(() => {
                resizeFrameRef.current = null
                if (disposed) return

                const activeMountNode = containerRef.current
                const activeTerm = termRef.current
                const activeFit = fitRef.current
                if (!activeMountNode?.isConnected || !activeTerm || !activeFit) return

                try {
                  const dims = activeFit.proposeDimensions()
                  if (!dims) return

                  const rect = activeMountNode.getBoundingClientRect()
                  const nextRect = { width: Math.round(rect.width), height: Math.round(rect.height) }
                  const nextDims = { cols: dims.cols, rows: dims.rows }

                  if (!previousRect || !previousDims) {
                    measureStableSize(nextRect, nextDims)
                    return
                  }

                  const rectStable = previousRect.width === nextRect.width && previousRect.height === nextRect.height
                  const dimsStable = previousDims.cols === nextDims.cols && previousDims.rows === nextDims.rows
                  if (!rectStable || !dimsStable) {
                    requestStableResizeRef.current?.()
                    return
                  }

                  if (activeTerm.cols !== nextDims.cols || activeTerm.rows !== nextDims.rows) {
                    activeTerm.resize(nextDims.cols, nextDims.rows)
                    window.mux.terminal.resize(terminalId, nextDims.cols, nextDims.rows)
                  }

                  if (!didSyncViewportAfterAttachRef.current) {
                    didSyncViewportAfterAttachRef.current = true
                    syncViewportAfterAttach(activeTerm)
                  }
                } catch {
                  // fit or resize can fail during teardown
                }
              })
            }

            measureStableSize()
          }, 48)
        }

        window.addEventListener('mux-theme-changed', onThemeChanged)
        inputDispose = term.onData((data) => {
          window.mux.terminal.write(terminalId, data)
        })

        let didSettledFit = false
        parsedDispose = term.onWriteParsed(() => {
          const nextAlternate = term.buffer.active.type === 'alternate'
          setIsAlternateScreen((current) => (current === nextAlternate ? current : nextAlternate))
          if (!didSettledFit) {
            didSettledFit = true
            requestStableResizeRef.current?.()
          }
        })

        observer = new ResizeObserver(() => requestStableResizeRef.current?.())
        observer.observe(mountNode)

        requestStableResizeRef.current()
        if (isFocusedRef.current) term.focus()
        else term.blur()
      })
      .catch(() => {
        // terminal init failed, keep pane empty
      })

    return () => {
      disposed = true
      isReadyRef.current = false
      clearPendingResize()
      requestStableResizeRef.current = null
      window.removeEventListener('mux-theme-changed', onThemeChanged)
      observer?.disconnect()
      inputDispose?.dispose()
      parsedDispose?.dispose()
      termRef.current = null
      fitRef.current = null
      searchAddonRef.current = null
      setIsAlternateScreen(false)

      // detach container from dom (do NOT dispose xterm)
      if (entry && mountNode.contains(entry.container)) {
        mountNode.removeChild(entry.container)
      }

      // only dispose if the pty is dead (workspace closed this terminal)
      if (entry?.exited) {
        disposeEntry(terminalId)
      }
    }
  }, [terminalId])

  useEffect(() => {
    const term = termRef.current
    if (!term || !isReadyRef.current) return

    if (isFocused) {
      term.focus()
      requestStableResizeRef.current?.()
      return
    }

    term.blur()
  }, [isFocused, terminalId])

  // ctrl+f opens search
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

      <div ref={containerRef} className="flex-1 min-h-0" data-surface-id={surfaceId} />
    </div>
  )
}
