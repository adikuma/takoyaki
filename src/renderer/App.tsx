import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useStore } from './store'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { Terminal } from './Terminal'
import { Settings } from './Settings'
import { Review } from './Review'
import { Plan } from './Plan'
import { colors, fonts } from './design'
import { collectLeaves, collectWorkspaceTerminals, equalTerminalFrames } from './terminal-layout'
import type { PaneTree, WorkspaceSnapshot } from './types'

const DEFAULT_PLAN_DRAWER_WIDTH = 480
const MIN_PLAN_DRAWER_WIDTH = 360
const MAX_PLAN_DRAWER_WIDTH = 760
const MIN_PLAN_PRIMARY_WIDTH = 420
const PLAN_DRAWER_WIDTH_KEY = 'takoyaki-plan-drawer-width'

function getPlanDrawerMaxWidth(stageWidth: number): number {
  if (stageWidth <= 0) return MAX_PLAN_DRAWER_WIDTH
  return Math.max(
    MIN_PLAN_DRAWER_WIDTH,
    Math.min(MAX_PLAN_DRAWER_WIDTH, Math.floor(stageWidth - MIN_PLAN_PRIMARY_WIDTH)),
  )
}

function clampPlanDrawerWidth(next: number, maxWidth = MAX_PLAN_DRAWER_WIDTH): number {
  return Math.max(MIN_PLAN_DRAWER_WIDTH, Math.min(Math.max(MIN_PLAN_DRAWER_WIDTH, maxWidth), Math.round(next)))
}

function getStoredPlanDrawerWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_PLAN_DRAWER_WIDTH
  const raw = Number(window.localStorage.getItem(PLAN_DRAWER_WIDTH_KEY))
  return Number.isFinite(raw) ? clampPlanDrawerWidth(raw) : DEFAULT_PLAN_DRAWER_WIDTH
}

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
  const planWorkspaceId = useStore((s) => s.planWorkspaceId)
  const planSurfaceId = useStore((s) => s.planSurfaceId)
  const activeClaudeSurfaceIds = useStore((s) => s.activeClaudeSurfaceIds)
  const closePlan = useStore((s) => s.closePlan)
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeId) || null
  const reviewWorkspace = workspaces.find((workspace) => workspace.id === reviewWorkspaceId) || null
  const planWorkspace = workspaces.find((workspace) => workspace.id === planWorkspaceId) || null
  const hasPlanDrawer = Boolean(planWorkspace)
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
  const [planDrawerWidth, setPlanDrawerWidth] = useState(getStoredPlanDrawerWidth)
  const [planStageWidth, setPlanStageWidth] = useState(0)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const terminalViewportRef = useRef<HTMLDivElement>(null)
  const planStageRef = useRef<HTMLDivElement>(null)

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
    if (!planWorkspaceId) return
    if (workspaces.some((workspace) => workspace.id === planWorkspaceId)) return
    closePlan()
  }, [closePlan, planWorkspaceId, workspaces])

  useEffect(() => {
    if (!planSurfaceId) return
    if (activeClaudeSurfaceIds.includes(planSurfaceId)) return
    closePlan()
  }, [activeClaudeSurfaceIds, closePlan, planSurfaceId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(PLAN_DRAWER_WIDTH_KEY, String(planDrawerWidth))
  }, [planDrawerWidth])

  useEffect(() => {
    const nextWidth = clampPlanDrawerWidth(planDrawerWidth, getPlanDrawerMaxWidth(planStageWidth))
    if (nextWidth === planDrawerWidth) return
    setPlanDrawerWidth(nextWidth)
  }, [planDrawerWidth, planStageWidth])

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
    const planApi = window.takoyaki?.plan
    if (!planApi?.getActiveSurfaceIds || !planApi?.onActiveSurfacesChange) return

    let disposed = false
    void planApi.getActiveSurfaceIds().then((surfaceIds) => {
      if (disposed) return
      useStore.getState().setActiveClaudeSurfaceIds(surfaceIds)
    })

    const cleanup = planApi.onActiveSurfacesChange((surfaceIds) => {
      useStore.getState().setActiveClaudeSurfaceIds(surfaceIds)
    })

    return () => {
      disposed = true
      cleanup()
    }
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

  useLayoutEffect(() => {
    const node = planStageRef.current
    if (!node) {
      setPlanStageWidth(0)
      return
    }

    const update = () => {
      setPlanStageWidth(Math.round(node.getBoundingClientRect().width))
    }

    update()

    const observer = new ResizeObserver(() => update())
    observer.observe(node)
    window.addEventListener('resize', update)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [hasPlanDrawer, isNarrowLayout])

  const handlePlanResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isNarrowLayout) return

      const stageNode = planStageRef.current
      if (!stageNode) return

      event.preventDefault()
      event.stopPropagation()

      const startWidth = clampPlanDrawerWidth(
        planDrawerWidth,
        getPlanDrawerMaxWidth(stageNode.getBoundingClientRect().width),
      )
      const startX = event.clientX
      const body = document.body
      const previousCursor = body.style.cursor
      const previousUserSelect = body.style.userSelect

      body.style.cursor = 'col-resize'
      body.style.userSelect = 'none'

      const handleMove = (moveEvent: PointerEvent) => {
        const stageWidth = stageNode.getBoundingClientRect().width
        const delta = startX - moveEvent.clientX
        setPlanDrawerWidth(clampPlanDrawerWidth(startWidth + delta, getPlanDrawerMaxWidth(stageWidth)))
      }

      const handleFinish = () => {
        body.style.cursor = previousCursor
        body.style.userSelect = previousUserSelect
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleFinish)
        window.removeEventListener('pointercancel', handleFinish)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleFinish)
      window.addEventListener('pointercancel', handleFinish)
    },
    [isNarrowLayout, planDrawerWidth],
  )

  const resolvedPlanDrawerWidth = clampPlanDrawerWidth(planDrawerWidth, getPlanDrawerMaxWidth(planStageWidth))

  const renderPrimaryStage = (narrow: boolean) => (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
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
                  workspaceId={terminal.workspaceId}
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
    </div>
  )

  const renderTerminalStage = (narrow: boolean) => (
    <div ref={planStageRef} className="relative flex min-w-0 flex-1 overflow-hidden">
      {renderPrimaryStage(narrow)}

      {activeView === 'terminal' && planWorkspace && !narrow && (
        <>
          <div
            className="split-handle shrink-0"
            data-direction="horizontal"
            style={{ width: 3, cursor: 'col-resize', touchAction: 'none' }}
            onPointerDown={handlePlanResizeStart}
          />
          <Plan workspace={planWorkspace} width={resolvedPlanDrawerWidth} />
        </>
      )}

      {activeView === 'terminal' && planWorkspace && narrow && (
        <div
          className="absolute inset-y-0 right-0 z-[6] max-w-full"
          style={{
            width: 'min(420px, calc(100vw - 24px))',
            boxShadow: '-14px 0 36px rgba(0, 0, 0, 0.28)',
          }}
        >
          <Plan workspace={planWorkspace} narrow width="100%" />
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
