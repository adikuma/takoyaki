import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { ChevronDown, ChevronUp, FileText, X } from 'lucide-react'
import { getTerminalTheme, fonts, colors, sizes } from './design'
import type { TerminalEvent, TerminalRuntimeInfo, TerminalSnapshot } from './types'
import type { TerminalFrame } from './terminal-layout'
import { matchTakoyakiShortcut } from '../shared/shortcuts'
import { Tooltip } from './Tooltip'
import { useStore } from './store'
import '@xterm/xterm/css/xterm.css'

let terminalRuntimeInfoPromise: Promise<TerminalRuntimeInfo> | null = null
const DEFAULT_TERMINAL_FONT_SIZE = 14
const MIN_TERMINAL_FONT_SIZE = 11
const MAX_TERMINAL_FONT_SIZE = 22
const TERMINAL_FONT_SIZE_STEP = 1
const TERMINAL_FONT_SIZE_KEY = 'takoyaki-terminal-font-size'
const TERMINAL_FONT_SIZE_EVENT = 'takoyaki-terminal-font-size-changed'

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

function clampTerminalFontSize(next: number): number {
  return Math.max(MIN_TERMINAL_FONT_SIZE, Math.min(MAX_TERMINAL_FONT_SIZE, next))
}

function getStoredTerminalFontSize(): number {
  if (typeof window === 'undefined') return DEFAULT_TERMINAL_FONT_SIZE
  const raw = window.localStorage.getItem(TERMINAL_FONT_SIZE_KEY)
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? clampTerminalFontSize(parsed) : DEFAULT_TERMINAL_FONT_SIZE
}

function persistTerminalFontSize(next: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TERMINAL_FONT_SIZE_KEY, String(next))
  window.dispatchEvent(new CustomEvent(TERMINAL_FONT_SIZE_EVENT, { detail: next }))
}

interface Props {
  surfaceId: string
  terminalId: string
  workspaceId: string
  frame: TerminalFrame | null
  isFocused?: boolean
}

export function Terminal({ surfaceId, terminalId, workspaceId, frame, isFocused }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const initialFontSizeRef = useRef(getStoredTerminalFontSize())
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const frameRef = useRef<TerminalFrame | null>(frame)
  const pendingEventsRef = useRef<TerminalEvent[]>([])
  const hydratedRef = useRef(false)
  const lastAppliedEventIdRef = useRef(0)
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [fontSize, setFontSize] = useState(getStoredTerminalFontSize)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isAlternateScreen, setIsAlternateScreen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isVisible = Boolean(frame && frame.width >= 24 && frame.height >= 24)
  const openPlan = useStore((state) => state.openPlan)
  const closePlan = useStore((state) => state.closePlan)
  const planWorkspaceId = useStore((state) => state.planWorkspaceId)
  const planSurfaceId = useStore((state) => state.planSurfaceId)
  const planLoading = useStore((state) => state.planLoading)
  const activeClaudeSurfaceIds = useStore((state) => state.activeClaudeSurfaceIds)

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
      }),
    [queueTerminalTask, writeToTerminal],
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
      }),
    [queueTerminalTask, writeToTerminal],
  )

  useEffect(() => {
    if (!containerRef.current || !window.takoyaki) return

    let disposed = false
    let inputDispose: { dispose: () => void } | null = null
    let parsedDispose: { dispose: () => void } | null = null
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
          fontSize: initialFontSizeRef.current,
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
      terminalEventCleanup?.()
      window.removeEventListener('takoyaki-theme-changed', onThemeChanged)
      searchAddonRef.current = null
      fitRef.current = null
      termRef.current?.dispose()
      termRef.current = null
      hydratedRef.current = false
      pendingEventsRef.current = []
      lastAppliedEventIdRef.current = 0
      setIsAlternateScreen(false)
    }
  }, [applyEvent, applySnapshot, clearPendingResize, queueTerminalTask, requestResize, terminalId])

  useEffect(() => {
    const handleTerminalFontSizeChanged = (event: Event) => {
      const next = Number((event as CustomEvent).detail)
      if (!Number.isFinite(next)) return
      setFontSize(clampTerminalFontSize(next))
    }

    window.addEventListener(TERMINAL_FONT_SIZE_EVENT, handleTerminalFontSizeChanged)
    return () => {
      window.removeEventListener(TERMINAL_FONT_SIZE_EVENT, handleTerminalFontSizeChanged)
    }
  }, [])

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
    const term = termRef.current
    if (!term) return
    if (term.options.fontSize === fontSize) return

    term.options.fontSize = fontSize
    if (isVisible) requestResize()
  }, [fontSize, isVisible, requestResize])

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

  const showPlanButton = activeClaudeSurfaceIds.includes(surfaceId)
  const isPlanOpen = planWorkspaceId === workspaceId && planSurfaceId === surfaceId
  const handlePlanClick = () => {
    if (isPlanOpen) {
      closePlan()
      return
    }
    void openPlan(workspaceId, surfaceId)
  }

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return

    event.preventDefault()
    event.stopPropagation()

    const direction = event.deltaY < 0 ? 1 : -1
    const next = clampTerminalFontSize(fontSize + direction * TERMINAL_FONT_SIZE_STEP)
    if (next === fontSize) return

    persistTerminalFontSize(next)
    setFontSize(next)
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

      {isVisible && showPlanButton && (
        <div className="absolute right-2 top-3 z-[4]" style={{ pointerEvents: 'auto' }}>
          <Tooltip content={isPlanOpen ? 'hide plan' : 'view plan'} side="bottom">
            <button
              type="button"
              className={`takoyaki-ghost-btn flex h-8 w-8 items-center justify-center rounded-md${isPlanOpen ? ' always-visible' : ''}`}
              style={{
                background: 'transparent',
                border: 'none',
                color: isPlanOpen ? colors.textPrimary : colors.textSecondary,
                opacity: planLoading && isPlanOpen ? 0.78 : undefined,
              }}
              onClick={(event) => {
                event.stopPropagation()
                handlePlanClick()
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = colors.bgHover
                event.currentTarget.style.color = colors.textPrimary
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = 'transparent'
                event.currentTarget.style.color = isPlanOpen ? colors.textPrimary : colors.textSecondary
              }}
              aria-label={isPlanOpen ? 'hide plan' : 'view plan'}
            >
              <FileText size={sizes.iconBase} strokeWidth={1.8} />
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
