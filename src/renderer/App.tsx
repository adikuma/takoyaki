import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useStore } from './store'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { Terminal } from './Terminal'
import { Settings } from './Settings'
import { Review } from './Review'
import { button, colors, fonts, sizes } from './design'
import { collectLeaves, collectWorkspaceTerminals, equalTerminalFrames } from './terminal-layout'
import type { PaneTree, WorkspaceSnapshot } from './types'

function PaneSlot({ surfaceId }: { surfaceId: string }) {
  return <div className="h-full w-full min-h-0" data-surface-slot={surfaceId} />
}

// the tree only describes layout and never owns the terminal instances
function PaneLayout({ tree }: { tree: PaneTree }) {
  if (tree.type === 'leaf') {
    return <PaneSlot surfaceId={tree.surfaceId} />
  }

  return (
    <PanelGroup direction={tree.direction}>
      <Panel minSize={15}>
        <PaneLayout tree={tree.first} />
      </Panel>
      <PanelResizeHandle className="split-handle" data-direction={tree.direction} />
      <Panel minSize={15}>
        <PaneLayout tree={tree.second} />
      </Panel>
    </PanelGroup>
  )
}

function EmptyState() {
  return <div className="flex-1" />
}

function EmptyWorkspaceToolbar({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="absolute right-3 top-3 z-[5] flex items-center" style={{ pointerEvents: 'auto' }}>
      <button
        type="button"
        className="flex items-center gap-1.5 px-2.5 py-1.5"
        style={{
          ...button.base,
          borderRadius: sizes.radiusMd,
          color: colors.textSecondary,
          fontFamily: fonts.ui,
          fontSize: sizes.textSm,
          fontWeight: 500,
        }}
        onClick={() => {
          void window.takoyaki?.workspace.createPane(workspaceId)
        }}
        onMouseEnter={(event) => {
          Object.assign(event.currentTarget.style, {
            ...button.hover,
            borderRadius: `${sizes.radiusMd}px`,
            color: colors.textPrimary,
          })
        }}
        onMouseLeave={(event) => {
          Object.assign(event.currentTarget.style, {
            ...button.base,
            borderRadius: `${sizes.radiusMd}px`,
            color: colors.textSecondary,
          })
        }}
      >
        <Plus size={sizes.iconBase} strokeWidth={1.8} />
        <span>New pane</span>
      </button>
    </div>
  )
}

export function App() {
  const workspaces = useStore((s) => s.workspaces)
  const activeId = useStore((s) => s.activeWorkspaceId)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const loadPinnedProjects = useStore((s) => s.loadPinnedProjects)
  const loadEditorState = useStore((s) => s.loadEditorState)
  const toast = useStore((s) => s.toast)
  const showToast = useStore((s) => s.showToast)
  const clearToast = useStore((s) => s.clearToast)
  const activeView = useStore((s) => s.activeView)
  const reviewWorkspaceId = useStore((s) => s.reviewWorkspaceId)
  const reviewFocusMode = useStore((s) => s.reviewFocusMode)
  const closeReview = useStore((s) => s.closeReview)
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeId) || null
  const reviewWorkspace = workspaces.find((workspace) => workspace.id === reviewWorkspaceId) || null
  const hideSidebar = activeView === 'review' && reviewFocusMode

  const [workspaceTrees, setWorkspaceTrees] = useState<Record<string, PaneTree | null | undefined>>({})
  const [focusedSurfaceId, setFocusedSurfaceId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isNarrowLayout, setIsNarrowLayout] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 900 : false,
  )
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false)
  const [activeVisibleSurfaceId, setActiveVisibleSurfaceId] = useState<string | null>(null)
  const [terminalFrames, setTerminalFrames] = useState<
    Record<string, { top: number; left: number; width: number; height: number }>
  >({})
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const terminalViewportRef = useRef<HTMLDivElement>(null)

  const tree = activeId ? workspaceTrees[activeId] || null : null
  const paneLeaves = useMemo(() => (tree ? collectLeaves(tree) : []), [tree])
  const visibleLeaf = useMemo(() => {
    if (!paneLeaves.length) return null
    return (
      paneLeaves.find((leaf) => leaf.surfaceId === activeVisibleSurfaceId) ||
      paneLeaves.find((leaf) => leaf.surfaceId === focusedSurfaceId) ||
      paneLeaves[0]
    )
  }, [activeVisibleSurfaceId, focusedSurfaceId, paneLeaves])
  // build the persistent terminal stage from cached trees so pane churn does not recreate xterm
  const terminalViews = useMemo(
    () => collectWorkspaceTerminals(workspaces, workspaceTrees),
    [workspaces, workspaceTrees],
  )

  const rememberTree = useCallback((workspaceId: string | null, nextTree: PaneTree | null) => {
    if (!workspaceId) return
    setWorkspaceTrees((current) => ({ ...current, [workspaceId]: nextTree }))
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('takoyaki-theme')
    if (saved === 'light') document.documentElement.dataset.theme = 'light'
  }, [])

  useEffect(() => {
    window.takoyakiOpenSettings = () => setSettingsOpen(true)
    return () => {
      delete window.takoyakiOpenSettings
    }
  }, [])

  useEffect(() => {
    if (!window.takoyaki) return
    let disposed = false

    void Promise.all([
      window.takoyaki.workspace.list(),
      window.takoyaki.workspace.current(),
      window.takoyaki.workspace.tree(),
    ]).then(([workspaceList, currentWorkspace, currentTree]) => {
      if (disposed) return
      useStore.setState({
        workspaces: workspaceList,
        activeWorkspaceId: currentWorkspace?.id || null,
      })
      setFocusedSurfaceId(currentWorkspace?.focusedSurfaceId || null)
      rememberTree(currentWorkspace?.id || null, currentTree || null)
    })

    const cleanup = window.takoyaki.workspace.onChange((snapshot: WorkspaceSnapshot) => {
      useStore.setState({
        workspaces: snapshot.workspaces || [],
        activeWorkspaceId: snapshot.activeWorkspaceId || null,
      })
      if (snapshot.focusedSurfaceId !== undefined) setFocusedSurfaceId(snapshot.focusedSurfaceId)
      rememberTree(snapshot.activeWorkspaceId, snapshot.tree || null)
    })

    return () => {
      disposed = true
      cleanup()
    }
  }, [rememberTree])

  useEffect(() => {
    if (!activeId || workspaceTrees[activeId] !== undefined || !window.takoyaki?.workspace) return
    let disposed = false

    void window.takoyaki.workspace.tree(activeId).then((nextTree) => {
      if (disposed) return
      setWorkspaceTrees((current) => {
        if (current[activeId] !== undefined) return current
        return { ...current, [activeId]: nextTree || null }
      })
    })

    return () => {
      disposed = true
    }
  }, [activeId, workspaceTrees])

  useEffect(() => {
    setWorkspaceTrees((current) => {
      const validIds = new Set(workspaces.map((workspace) => workspace.id))
      const nextEntries = Object.entries(current).filter(([workspaceId]) => validIds.has(workspaceId))
      if (nextEntries.length === Object.keys(current).length) return current
      return Object.fromEntries(nextEntries)
    })
  }, [workspaces])

  useEffect(() => {
    // load sidebar preferences once and let the store keep the renderer copy in sync
    void loadPinnedProjects()
  }, [loadPinnedProjects])

  useEffect(() => {
    void loadEditorState()
  }, [loadEditorState])

  useEffect(() => {
    const onResize = () => setIsNarrowLayout(window.innerWidth < 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!isNarrowLayout) {
      setSidebarDrawerOpen(false)
      return
    }
    if (activeId) setSidebarDrawerOpen(false)
  }, [activeId, isNarrowLayout])

  useEffect(() => {
    if (hideSidebar) setSidebarDrawerOpen(false)
  }, [hideSidebar])

  useEffect(() => {
    if (!paneLeaves.length) {
      setActiveVisibleSurfaceId(null)
      return
    }
    if (focusedSurfaceId && paneLeaves.some((leaf) => leaf.surfaceId === focusedSurfaceId)) {
      setActiveVisibleSurfaceId(focusedSurfaceId)
      return
    }
    if (!activeVisibleSurfaceId || !paneLeaves.some((leaf) => leaf.surfaceId === activeVisibleSurfaceId)) {
      setActiveVisibleSurfaceId(paneLeaves[0].surfaceId)
    }
  }, [activeVisibleSurfaceId, focusedSurfaceId, paneLeaves])

  useEffect(() => {
    if (activeView !== 'review' || !reviewWorkspaceId) return
    if (workspaces.some((workspace) => workspace.id === reviewWorkspaceId)) return
    closeReview()
  }, [activeView, closeReview, reviewWorkspaceId, workspaces])

  useEffect(() => {
    if (!window.takoyaki) return
    const cleanup = window.takoyaki.status.onChange((statuses) => {
      useStore.getState().setSurfaceStatuses(statuses)
    })
    return cleanup
  }, [])

  useEffect(() => {
    if (!window.takoyaki?.activity) return
    void window.takoyaki.activity.get().then((data) => {
      useStore.getState().setWorkspaceActivity(data)
    })
    const cleanup = window.takoyaki.activity.onChange((data) => {
      useStore.getState().setWorkspaceActivity(data)
    })
    return cleanup
  }, [])

  useEffect(() => {
    if (!window.takoyaki) return
    const cleanup = window.takoyaki.session.onSaved(() => {
      showToast({ message: 'Session saved' }, 2000)
    })
    return cleanup
  }, [showToast])

  useEffect(() => {
    if (!window.takoyaki?.toast) return
    const cleanup = window.takoyaki.toast.onAgentEvent((event) => {
      const label = event.status === 'failed' ? 'failed' : 'finished'
      showToast(
        {
          message: `Claude ${label} in ${event.workspaceTitle}`,
          workspaceId: event.workspaceId,
          dot: event.status === 'failed' ? colors.error : colors.success,
        },
        3000,
      )
    })
    return cleanup
  }, [showToast])

  useEffect(() => {
    if (!window.takoyaki) return
    const cleanup = window.takoyaki.onShortcut((action: string) => {
      if (action === 'toggle-sidebar') {
        if (isNarrowLayout) setSidebarDrawerOpen((open) => !open)
        else toggleSidebar()
      }
    })
    return cleanup
  }, [isNarrowLayout, toggleSidebar])

  useEffect(() => {
    if (!window.takoyaki?.workspace) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.altKey) return
      if (event.key !== 'Tab') return
      event.preventDefault()
      event.stopPropagation()
      void window.takoyaki.workspace.cycleVisible(event.shiftKey ? 'prev' : 'next')
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  useLayoutEffect(() => {
    const viewport = terminalViewportRef.current
    if (!viewport) {
      setTerminalFrames((current) => (Object.keys(current).length ? {} : current))
      return
    }

    let frame = 0
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0

        const rootRect = viewport.getBoundingClientRect()
        const nextFrames: Record<string, { top: number; left: number; width: number; height: number }> = {}
        // measure the rendered slots after layout instead of driving state from ref callbacks
        const nodes = viewport.querySelectorAll<HTMLDivElement>('[data-surface-slot]')
        for (const node of nodes) {
          const surfaceId = node.dataset.surfaceSlot
          if (!surfaceId || !node.isConnected) continue
          if (!node.isConnected) continue
          const rect = node.getBoundingClientRect()
          if (rect.width < 1 || rect.height < 1) continue
          nextFrames[surfaceId] = {
            top: Math.round(rect.top - rootRect.top),
            left: Math.round(rect.left - rootRect.left),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
        }

        setTerminalFrames((current) => (equalTerminalFrames(current, nextFrames) ? current : nextFrames))
      })
    }

    schedule()

    const observer = new ResizeObserver(() => schedule())
    observer.observe(viewport)
    viewport.querySelectorAll<HTMLDivElement>('[data-surface-slot]').forEach((node) => observer.observe(node))
    window.addEventListener('resize', schedule)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [activeId, activeVisibleSurfaceId, activeView, isNarrowLayout, tree])

  const renderTerminalStage = (narrow: boolean) => (
    <div className="relative flex-1 overflow-hidden flex flex-col">
      {narrow && paneLeaves.length > 1 && (
        <div
          className="flex items-center gap-1 overflow-x-auto px-3 pt-2 shrink-0"
          style={{ borderBottom: `1px solid ${colors.separator}` }}
        >
          {paneLeaves.map((leaf, index) => {
            const active = visibleLeaf?.surfaceId === leaf.surfaceId
            return (
              <button
                key={leaf.surfaceId}
                onClick={() => {
                  setActiveVisibleSurfaceId(leaf.surfaceId)
                  void window.takoyaki?.surface.focus(leaf.surfaceId)
                }}
                className="whitespace-nowrap rounded-none border-b-2 px-2.5 pb-2 pt-1 text-[11px] transition-colors duration-[120ms]"
                style={{
                  background: 'transparent',
                  borderBottomColor: active ? colors.accent : 'transparent',
                  color: active ? colors.textPrimary : colors.textSecondary,
                  fontFamily: fonts.mono,
                }}
                onMouseEnter={(event) => {
                  if (!active) event.currentTarget.style.color = colors.textPrimary
                }}
                onMouseLeave={(event) => {
                  if (!active) event.currentTarget.style.color = colors.textSecondary
                }}
              >
                Pane {index + 1}
              </button>
            )
          })}
        </div>
      )}

      <div ref={terminalViewportRef} className="relative flex-1 overflow-hidden">
        {activeWorkspace && tree ? (
          narrow && visibleLeaf ? (
            <PaneSlot surfaceId={visibleLeaf.surfaceId} />
          ) : !narrow ? (
            <PaneLayout tree={tree} />
          ) : (
            <EmptyState />
          )
        ) : (
          <EmptyState />
        )}
        {activeView === 'terminal' && activeWorkspace && !tree && (
          <EmptyWorkspaceToolbar workspaceId={activeWorkspace.id} />
        )}
        {/* keep the live terminals mounted above the layout and only update their frame */}
        <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
          {terminalViews.map((terminal) => {
            const frame =
              activeView === 'terminal' && terminal.workspaceId === activeId
                ? terminalFrames[terminal.surfaceId] || null
                : null
            return (
              <Terminal
                key={terminal.terminalId}
                surfaceId={terminal.surfaceId}
                terminalId={terminal.terminalId}
                frame={frame}
                isFocused={Boolean(
                  frame &&
                  activeView === 'terminal' &&
                  terminal.workspaceId === activeId &&
                  terminal.surfaceId === focusedSurfaceId,
                )}
              />
            )
          })}
        </div>
      </div>

      {activeView === 'review' && reviewWorkspace && (
        <div className="absolute inset-0 overflow-hidden" style={{ background: colors.bg }}>
          <Review workspace={reviewWorkspace} narrow={narrow} />
        </div>
      )}
    </div>
  )

  return (
    <div className="relative flex flex-col h-screen w-screen overflow-hidden" style={{ background: colors.bg }}>
      <Titlebar
        narrow={isNarrowLayout && !hideSidebar}
        onToggleSidebar={() => {
          if (hideSidebar) return
          if (isNarrowLayout) setSidebarDrawerOpen((open) => !open)
          else toggleSidebar()
        }}
      />
      <div className="flex flex-1 overflow-hidden">
        {isNarrowLayout ? (
          <>
            {!hideSidebar && (
              <Sidebar
                narrow
                drawerOpen={sidebarDrawerOpen}
                onRequestOpen={() => setSidebarDrawerOpen(true)}
                onRequestClose={() => setSidebarDrawerOpen(false)}
              />
            )}
            {renderTerminalStage(true)}
          </>
        ) : (
          <>
            {!hideSidebar && <Sidebar />}
            {renderTerminalStage(false)}
          </>
        )}
      </div>
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {toast && (
        <div
          className="fixed z-50 takoyaki-toast-in"
          style={{
            bottom: 20,
            right: 20,
            background: colors.bg,
            border: `1px solid ${colors.separator}`,
            borderRadius: 8,
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: toast.workspaceId ? 'pointer' : 'default',
            pointerEvents: toast.workspaceId ? 'auto' : 'none',
          }}
          onClick={() => {
            if (toast.workspaceId) {
              selectWorkspace(toast.workspaceId)
              clearToast()
            }
          }}
        >
          <span
            style={{ width: 6, height: 6, borderRadius: '50%', background: toast.dot || colors.accent, flexShrink: 0 }}
          />
          <span style={{ color: colors.textPrimary, fontSize: 13 }}>{toast.message}</span>
        </div>
      )}
    </div>
  )
}
