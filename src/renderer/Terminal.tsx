import { useCallback, useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ChevronDown, ChevronUp, Columns2, Rows2, X } from 'lucide-react'
import { button, getTerminalTheme, fonts, colors, sizes } from './design'
import type { TerminalEvent, TerminalRuntimeInfo, TerminalSnapshot } from './types'
import type { TerminalFrame } from './terminal-layout'
import { matchTakoyakiShortcut } from '../shared/shortcuts'
import { Tooltip } from './Tooltip'
import '@xterm/xterm/css/xterm.css'
import { DEFAULT_TERMINAL_FONT_SIZE, TERMINAL_FONT_SIZE_STEP, clampTerminalFontSize } from '../shared/terminal-zoom'

let terminalRuntimeInfoPromise: Promise<TerminalRuntimeInfo> | null = null
const TERMINAL_SCROLL_SENSITIVITY = 2
const SCROLL_TO_BOTTOM_THRESHOLD = 2
const TERMINAL_SCROLLBAR_WIDTH = 8

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

function formatTerminalExitMessage(exitCode: number | null, exitSignal: number | null): string {
  if (exitCode !== null) return `\r\n[exited: ${exitCode}]`
  if (exitSignal !== null) return `\r\n[exited: signal ${exitSignal}]`
  return '\r\n[exited]'
}

function snapshotRestoreData(snapshot: TerminalSnapshot): string {
  return snapshot.serializedState || snapshot.history
}

function shouldLetTerminalOwnControlKey(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false

  const key = event.key.toLowerCase()
  if (
    matchTakoyakiShortcut({
      key: event.key,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    })
  ) {
    return false
  }

  if (key === 'c') return false
  if (key === 'v') return false
  if (key === 'tab') return false

  return true
}

interface Props {
  surfaceId: string
  terminalId: string
  fontSize: number
  frame: TerminalFrame | null
  isFocused?: boolean
}

function PaneToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        className="flex h-6 w-6 items-center justify-center"
        style={{
          background: 'transparent',
          border: 'none',
          borderRadius: sizes.radiusMd,
          color: colors.textSecondary,
        }}
        onClick={(event) => {
          event.stopPropagation()
          onClick()
        }}
        onMouseEnter={(event) => {
          Object.assign(event.currentTarget.style, {
            background: colors.bgHover,
            color: colors.textPrimary,
          })
        }}
        onMouseLeave={(event) => {
          Object.assign(event.currentTarget.style, {
            background: 'transparent',
            borderRadius: `${sizes.radiusMd}px`,
            color: colors.textSecondary,
          })
        }}
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function Terminal({ surfaceId, terminalId, fontSize, frame, isFocused }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const webLinksAddonRef = useRef<WebLinksAddon | null>(null)
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const frameRef = useRef<TerminalFrame | null>(frame)
  const pendingEventsRef = useRef<TerminalEvent[]>([])
  const hydratedRef = useRef(false)
  const lastAppliedEventIdRef = useRef(0)
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const fontSizeRef = useRef(clampTerminalFontSize(fontSize ?? DEFAULT_TERMINAL_FONT_SIZE))
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAlternateScreen, setIsAlternateScreen] = useState(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
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
            // sidebar and layout changes need to settle into one real resize not a stream of animated widths
            term.resize(dims.cols, dims.rows)
            void window.takoyaki.terminal.resize(terminalId, dims.cols, dims.rows)
          }
        } catch {
          // xterm can throw while tearing down during fast pane changes
        }
      })
    }, 32)
  }, [clearPendingResize, terminalId])

  const applyTerminalFontSize = useCallback(
    (nextFontSize: number) => {
      const clamped = clampTerminalFontSize(nextFontSize)
      fontSizeRef.current = clamped
      const term = termRef.current
      if (!term || term.options.fontSize === clamped) return
      term.options.fontSize = clamped
      requestResize()
    },
    [requestResize],
  )

  const setPaneFontSize = useCallback(
    (nextFontSize: number) => {
      const clamped = clampTerminalFontSize(nextFontSize)
      if (clamped === fontSizeRef.current) return
      applyTerminalFontSize(clamped)
      void window.takoyaki?.workspace.setSurfaceFontSize(surfaceId, clamped)
    },
    [applyTerminalFontSize, surfaceId],
  )

  const adjustPaneFontSize = useCallback(
    (delta: number) => {
      setPaneFontSize(fontSizeRef.current + delta)
    },
    [setPaneFontSize],
  )

  useEffect(() => {
    applyTerminalFontSize(fontSize)
  }, [applyTerminalFontSize, fontSize])

  const queueTerminalTask = useCallback((task: () => Promise<void> | void) => {
    writeQueueRef.current = writeQueueRef.current.then(async () => {
      await task()
    })
    writeQueueRef.current = writeQueueRef.current.catch(() => {
      // keep the queue alive even if one render step fails
    })
    return writeQueueRef.current
  }, [])

  const writeToTerminal = useCallback((term: XTerm, data: string) => {
    if (!data) return Promise.resolve()
    return new Promise<void>((resolve) => {
      try {
        term.write(data, () => resolve())
      } catch {
        resolve()
      }
    })
  }, [])

  const syncScrollAffordances = useCallback((term: XTerm) => {
    const alternateScreen = term.buffer.active.type === 'alternate'
    setIsAlternateScreen((current) => (current === alternateScreen ? current : alternateScreen))

    if (alternateScreen) {
      setShowScrollToBottom(false)
      return
    }

    const hiddenLineCount = term.buffer.active.baseY - term.buffer.active.viewportY
    setShowScrollToBottom(hiddenLineCount > SCROLL_TO_BOTTOM_THRESHOLD)
  }, [])

  const applySnapshot = useCallback(
    (term: XTerm, snapshot: TerminalSnapshot) =>
      queueTerminalTask(async () => {
        // rebuild the view from backend truth before replaying later events
        term.reset()
        const serializedState = snapshotRestoreData(snapshot)
        if (serializedState) await writeToTerminal(term, serializedState)
        if (snapshot.status === 'exited') {
          await writeToTerminal(term, formatTerminalExitMessage(snapshot.exitCode, snapshot.exitSignal))
        }
        lastAppliedEventIdRef.current = snapshot.lastEventId
        syncScrollAffordances(term)
      }),
    [queueTerminalTask, syncScrollAffordances, writeToTerminal],
  )

  const applyEvent = useCallback(
    (term: XTerm, event: TerminalEvent) =>
      queueTerminalTask(async () => {
        if (event.eventId <= lastAppliedEventIdRef.current) return

        if (event.type === 'started') {
          term.reset()
          const serializedState = snapshotRestoreData(event.snapshot)
          if (serializedState) await writeToTerminal(term, serializedState)
          if (event.snapshot.status === 'exited') {
            await writeToTerminal(term, formatTerminalExitMessage(event.snapshot.exitCode, event.snapshot.exitSignal))
          }
          lastAppliedEventIdRef.current = Math.max(event.eventId, event.snapshot.lastEventId)
          syncScrollAffordances(term)
          return
        }

        if (event.type === 'output') {
          await writeToTerminal(term, event.data)
        } else if (event.type === 'exited') {
          await writeToTerminal(term, formatTerminalExitMessage(event.exitCode, event.exitSignal))
        } else if (event.type === 'error') {
          await writeToTerminal(term, `\r\n[error: ${event.message}]`)
        }

        lastAppliedEventIdRef.current = event.eventId
        syncScrollAffordances(term)
      }),
    [queueTerminalTask, syncScrollAffordances, writeToTerminal],
  )

  useEffect(() => {
    if (!containerRef.current || !window.takoyaki) return

    let disposed = false
    let inputDispose: { dispose: () => void } | null = null
    let parsedDispose: { dispose: () => void } | null = null
    let scrollDispose: { dispose: () => void } | null = null
    let terminalEventCleanup: (() => void) | null = null
    let observer: ResizeObserver | null = null

    pendingEventsRef.current = []
    hydratedRef.current = false
    lastAppliedEventIdRef.current = 0
    writeQueueRef.current = Promise.resolve()

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
          fontSize: fontSizeRef.current,
          lineHeight: 1.25,
          cursorBlink: false,
          cursorStyle: 'bar',
          cursorInactiveStyle: 'none',
          scrollback: 5000,
          scrollSensitivity: TERMINAL_SCROLL_SENSITIVITY,
          overviewRuler: { width: TERMINAL_SCROLLBAR_WIDTH },
          allowProposedApi: true,
          theme: getTerminalTheme((localStorage.getItem('takoyaki-theme') as 'dark' | 'light') || 'dark'),
          windowsPty: runtimeInfo.windowsPty || undefined,
        })

        const fit = new FitAddon()
        const search = new SearchAddon()
        const webLinks = new WebLinksAddon((event, uri) => {
          event.preventDefault()
          event.stopPropagation()
          void window.takoyaki.window.openExternal(uri)
        })
        term.loadAddon(fit)
        term.loadAddon(search)
        term.loadAddon(webLinks)

        term.attachCustomKeyEventHandler((event) => {
          if (event.type !== 'keydown') return true
          const modifierKey = event.ctrlKey || event.metaKey
          const key = event.key
          if (modifierKey && !event.altKey) {
            const wantsZoomIn = key === '=' || key === '+' || event.code === 'NumpadAdd'
            const wantsZoomOut = key === '-' || event.code === 'NumpadSubtract'
            const wantsZoomReset =
              (!event.shiftKey && key === '0') ||
              (!event.shiftKey && event.code === 'Digit0') ||
              event.code === 'Numpad0'
            if (wantsZoomIn || wantsZoomOut || wantsZoomReset) {
              event.preventDefault()
              event.stopPropagation()
              if (wantsZoomReset) {
                setPaneFontSize(DEFAULT_TERMINAL_FONT_SIZE)
              } else {
                adjustPaneFontSize(wantsZoomIn ? TERMINAL_FONT_SIZE_STEP : -TERMINAL_FONT_SIZE_STEP)
              }
              return false
            }
          }
          if (
            event.ctrlKey &&
            !event.altKey &&
            !event.metaKey &&
            !event.shiftKey &&
            event.key === 'End' &&
            term.buffer.active.type !== 'alternate'
          ) {
            event.preventDefault()
            event.stopPropagation()
            term.scrollToBottom()
            syncScrollAffordances(term)
            return false
          }
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
          if (shouldLetTerminalOwnControlKey(event)) {
            // block browser defaults like select all while still letting xterm send the control byte
            event.preventDefault()
            event.stopPropagation()
            return true
          }
          return true
        })

        termRef.current = term
        fitRef.current = fit
        searchAddonRef.current = search
        webLinksAddonRef.current = webLinks

        const mountNode = containerRef.current
        mountNode.style.width = '100%'
        mountNode.style.height = '100%'
        mountNode.style.padding = '8px 0 4px 10px'
        term.open(mountNode)

        window.addEventListener('takoyaki-theme-changed', onThemeChanged)

        inputDispose = term.onData((data) => {
          void window.takoyaki.terminal.write(terminalId, data)
        })

        parsedDispose = term.onWriteParsed(() => {
          syncScrollAffordances(term)
        })
        scrollDispose = term.onScroll(() => {
          syncScrollAffordances(term)
        })

        terminalEventCleanup = window.takoyaki.terminal.onEvent((event) => {
          if (event.terminalId !== terminalId) return
          if (!hydratedRef.current) {
            pendingEventsRef.current.push(event)
            return
          }
          void applyEvent(term, event)
        })

        // subscribe first so nothing is lost while the snapshot is loading
        void window.takoyaki.terminal
          .open(terminalId)
          .then(async (snapshot) => {
            if (disposed || !termRef.current) return

            if (snapshot) {
              await applySnapshot(term, snapshot)

              // keep replaying until the buffer stays empty so older events never get skipped
              while (pendingEventsRef.current.length > 0) {
                const replayable = pendingEventsRef.current
                  .filter((event) => event.eventId > lastAppliedEventIdRef.current)
                  .sort((first, second) => first.eventId - second.eventId)

                pendingEventsRef.current = []
                for (const event of replayable) {
                  await applyEvent(term, event)
                }
              }
            }

            hydratedRef.current = true
            syncScrollAffordances(term)
            requestResize()
          })
          .catch(() => {
            hydratedRef.current = true
          })

        observer = new ResizeObserver(() => requestResize())
        observer.observe(mountNode)

        queueTerminalTask(() => {
          requestResize()
        })
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
      scrollDispose?.dispose()
      terminalEventCleanup?.()
      window.removeEventListener('takoyaki-theme-changed', onThemeChanged)
      searchAddonRef.current = null
      webLinksAddonRef.current = null
      fitRef.current = null
      termRef.current?.dispose()
      termRef.current = null
      hydratedRef.current = false
      pendingEventsRef.current = []
      lastAppliedEventIdRef.current = 0
      setIsAlternateScreen(false)
      setShowScrollToBottom(false)
    }
  }, [
    adjustPaneFontSize,
    applyEvent,
    applySnapshot,
    clearPendingResize,
    queueTerminalTask,
    requestResize,
    setPaneFontSize,
    syncScrollAffordances,
    terminalId,
  ])

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
      return
    }

    term.blur()
  }, [isFocused, isVisible])

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

  const handleScrollToBottom = () => {
    const term = termRef.current
    if (!term) return
    term.scrollToBottom()
    syncScrollAffordances(term)
    term.focus()
  }

  const handleSplitRight = () => {
    void window.takoyaki?.workspace.splitSurface(surfaceId, 'horizontal')
  }

  const handleSplitDown = () => {
    void window.takoyaki?.workspace.splitSurface(surfaceId, 'vertical')
  }

  const handleClosePane = () => {
    void window.takoyaki?.workspace.closeSurface(surfaceId)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!isVisible) return
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    void window.takoyaki?.surface.focus(surfaceId)
    termRef.current?.focus()
    if (event.deltaY === 0) return
    adjustPaneFontSize(event.deltaY < 0 ? TERMINAL_FONT_SIZE_STEP : -TERMINAL_FONT_SIZE_STEP)
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
      className={`group absolute flex flex-col overflow-hidden ${isAlternateScreen ? 'takoyaki-pane-alt' : 'takoyaki-pane-shell'}`}
      style={{
        ...wrapperStyle,
        background: colors.terminalBg,
        zIndex: isFocused && isVisible ? 2 : 1,
      }}
      onClick={handleClick}
      onWheel={handleWheel}
    >
      {isFocused && isVisible && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: colors.accentSoft,
            pointerEvents: 'none',
            zIndex: 3,
          }}
        />
      )}

      {isVisible && (
        <div
          className="shrink-0 flex items-center justify-end px-2 py-1"
          style={{
            minHeight: 30,
            background: colors.terminalBg,
          }}
        >
          <div className="inline-flex items-center gap-0.5" onMouseDown={(event) => event.stopPropagation()}>
            <PaneToolbarButton label="Split right" onClick={handleSplitRight}>
              <Columns2 size={sizes.iconSm} strokeWidth={1.8} />
            </PaneToolbarButton>
            <PaneToolbarButton label="Split down" onClick={handleSplitDown}>
              <Rows2 size={sizes.iconSm} strokeWidth={1.8} />
            </PaneToolbarButton>
            <PaneToolbarButton label="Close pane" onClick={handleClosePane}>
              <X size={sizes.iconSm} strokeWidth={1.8} />
            </PaneToolbarButton>
          </div>
        </div>
      )}

      {isVisible && showScrollToBottom && !isAlternateScreen && (
        <div className="absolute bottom-4 left-1/2 z-[4] -translate-x-1/2" style={{ pointerEvents: 'auto' }}>
          <Tooltip content="Scroll to bottom (Ctrl+End)" side="top">
            <button
              type="button"
              className="takoyaki-btn flex h-9 items-center justify-center gap-1.5 rounded-full px-3"
              style={{
                ...button.base,
                color: colors.textSecondary,
                fontSize: sizes.textSm,
                fontFamily: fonts.ui,
                fontWeight: 500,
              }}
              onClick={(event) => {
                event.stopPropagation()
                handleScrollToBottom()
              }}
              onMouseEnter={(event) => {
                Object.assign(event.currentTarget.style, {
                  ...button.hover,
                  color: colors.textPrimary,
                })
              }}
              onMouseLeave={(event) => {
                Object.assign(event.currentTarget.style, {
                  ...button.base,
                  color: colors.textSecondary,
                })
              }}
              aria-label="Scroll to bottom"
            >
              <ChevronDown size={sizes.iconBase} strokeWidth={2} />
              <span>Scroll to bottom</span>
            </button>
          </Tooltip>
        </div>
      )}

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
