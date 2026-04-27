import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Plus } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useStore } from './store'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { Terminal } from './Terminal'
import { Settings } from './Settings'
import { Review } from './Review'
import { BrowserPanel } from './BrowserPanel'
import { DEFAULT_ACTIVITY_PANEL_HEIGHT, ActivityPanel } from './ActivityPanel'
import { button, colors, fonts, sizes } from './design'
import {
  MAX_HIDDEN_MOUNTED_WORKSPACES,
  collectLeaves,
  collectMountedWorkspaceTerminals,
  equalTerminalFrames,
  reconcileMountedWorkspaceIds,
} from './terminal-layout'
import { resolvePaneLabels } from './pane-labels'
import type { PaneTree, TerminalMetadata, WorkspaceSnapshot } from './types'
import { createDefaultBrowserPanelState, type BrowserDisplayMode, type BrowserPanelState } from '../shared/browser'
import type { UpdateState } from '../shared/updates'

// normalizes terminal snapshots into the lighter metadata shape the app caches
function snapshotToTerminalMetadata(snapshot: {
  terminalId: string
  cwd: string
  title: string | null
  updatedAt: string
}): TerminalMetadata {
  return {
    terminalId: snapshot.terminalId,
    cwd: snapshot.cwd,
    title: snapshot.title,
    updatedAt: snapshot.updatedAt,
  }
}

// avoids rerender churn when a metadata event repeats the same tracked values
function sameTerminalMetadata(
  first: TerminalMetadata | undefined,
  second: TerminalMetadata | null | undefined,
): boolean {
  if (!first || !second) return false
  return first.cwd === second.cwd && first.title === second.title && first.updatedAt === second.updatedAt
}

// marks where a rendered pane leaf lives so the stage can measure it later
function PaneSlot({ surfaceId, measurable = true }: { surfaceId: string; measurable?: boolean }) {
  return <div className="h-full w-full min-h-0" data-surface-slot={measurable ? surfaceId : undefined} />
}

// the tree only describes layout and never owns the terminal instances
function PaneLayout({ tree, measurable = true }: { tree: PaneTree; measurable?: boolean }) {
  if (tree.type === 'leaf') {
    return <PaneSlot surfaceId={tree.surfaceId} measurable={measurable} />
  }

  return (
    <PanelGroup direction={tree.direction}>
      <Panel minSize={15}>
        <PaneLayout tree={tree.first} measurable={measurable} />
      </Panel>
      <PanelResizeHandle className="split-handle" data-direction={tree.direction} />
      <Panel minSize={15}>
        <PaneLayout tree={tree.second} measurable={measurable} />
      </Panel>
    </PanelGroup>
  )
}

function EmptyState() {
  return <div className="flex-1" />
}

// gives empty workspaces a lightweight way to open the first pane
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

// owns the renderer shell and keeps workspace state, pane layout, and review mode in sync
export function App() {
  const rootShellRef = useRef<HTMLDivElement>(null)
  const workspaces = useStore((s) => s.workspaces)
  const activeId = useStore((s) => s.activeWorkspaceId)
  const surfaceStatuses = useStore((s) => s.surfaceStatuses)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const loadPinnedProjects = useStore((s) => s.loadPinnedProjects)
  const loadEditorState = useStore((s) => s.loadEditorState)
  const toast = useStore((s) => s.toast)
  const showToast = useStore((s) => s.showToast)
  const clearToast = useStore((s) => s.clearToast)
  const startActivityOperation = useStore((s) => s.startActivityOperation)
  const updateActivityOperation = useStore((s) => s.updateActivityOperation)
  const finishActivityOperation = useStore((s) => s.finishActivityOperation)
  const clearActivityOperation = useStore((s) => s.clearActivityOperation)
  const activeView = useStore((s) => s.activeView)
  const reviewWorkspaceId = useStore((s) => s.reviewWorkspaceId)
  const reviewFocusMode = useStore((s) => s.reviewFocusMode)
  const paneFocusSurfaceId = useStore((s) => s.paneFocusSurfaceId)
  const closeReview = useStore((s) => s.closeReview)
  const togglePaneFocusMode = useStore((s) => s.togglePaneFocusMode)
  const setPaneFocusSurfaceId = useStore((s) => s.setPaneFocusSurfaceId)
  const clearPaneFocusMode = useStore((s) => s.clearPaneFocusMode)
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
  const [browserState, setBrowserState] = useState<BrowserPanelState>(() => createDefaultBrowserPanelState())
  const [updateState, setUpdateState] = useState<UpdateState | null>(null)
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null)
  const [browserDisplayMode, setBrowserDisplayMode] = useState<BrowserDisplayMode>('side')
  const [browserWidth, setBrowserWidth] = useState(420)
  const [activityPanelHeight, setActivityPanelHeight] = useState(DEFAULT_ACTIVITY_PANEL_HEIGHT)
  const [mountedWorkspaceIds, setMountedWorkspaceIds] = useState<string[]>([])
  const [browserResizeState, setBrowserResizeState] = useState<{
    pointerId: number
    startX: number
    startWidth: number
  } | null>(null)
  const [terminalFocusRequest, setTerminalFocusRequest] = useState<{ surfaceId: string; token: number } | null>(null)
  const [terminalFrames, setTerminalFrames] = useState<
    Record<string, { top: number; left: number; width: number; height: number }>
  >({})
  const [terminalMetadataById, setTerminalMetadataById] = useState<Record<string, TerminalMetadata>>({})
  const browserLoadOperationRef = useRef<{ id: string; url: string | null } | null>(null)
  const updateOperationRef = useRef<string | null>(null)
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
  const paneFocusLeaf = useMemo(() => {
    if (!paneFocusSurfaceId) return null
    return paneLeaves.find((leaf) => leaf.surfaceId === paneFocusSurfaceId) || null
  }, [paneFocusSurfaceId, paneLeaves])
  // keep the renderer stage bounded so background workspaces do not leave hidden xterms mounted
  const terminalViews = useMemo(
    () => collectMountedWorkspaceTerminals(mountedWorkspaceIds, workspaceTrees),
    [mountedWorkspaceIds, workspaceTrees],
  )
  const paneLabels = useMemo(
    () => resolvePaneLabels({ paneLeaves, terminalViews, surfaceStatuses, terminalMetadataById }),
    [paneLeaves, surfaceStatuses, terminalMetadataById, terminalViews],
  )
  const browserVisible = browserState.visible && !isNarrowLayout
  const browserSideVisible = browserVisible && browserDisplayMode === 'side'
  const browserFocusVisible = browserVisible && browserDisplayMode === 'focus'
  const updateReadyVersion =
    updateState?.status === 'downloaded' &&
    updateState.availableVersion &&
    dismissedUpdateVersion !== updateState.availableVersion
      ? updateState.availableVersion
      : null

  // keep the browser width inside a safe desktop-only range
  const clampBrowserWidth = useCallback((nextWidth: number) => {
    const minWidth = 360
    const maxWidth = Math.max(minWidth, Math.min(640, window.innerWidth - 120))
    return Math.min(Math.max(nextWidth, minWidth), maxWidth)
  }, [])

  // keep icon and shortcut toggles on the same focus-mode path
  const togglePaneFocusForSurface = useCallback(
    (surfaceId: string) => {
      setActiveVisibleSurfaceId(surfaceId)
      togglePaneFocusMode(surfaceId)
      void window.takoyaki?.surface.focus(surfaceId)
    },
    [togglePaneFocusMode],
  )

  // remembers the latest tree for each workspace so panes survive workspace switching
  const rememberTree = useCallback((workspaceId: string | null, nextTree: PaneTree | null) => {
    if (!workspaceId) return
    setWorkspaceTrees((current) => ({ ...current, [workspaceId]: nextTree }))
  }, [])

  const checkForUpdates = useCallback(() => {
    void window.takoyaki?.updates.check()
  }, [])

  const installUpdate = useCallback(() => {
    void window.takoyaki?.updates.install()
  }, [])

  // restores the saved theme before the app does its first visible paint
  useEffect(() => {
    const saved = localStorage.getItem('takoyaki-theme')
    if (saved === 'light') document.documentElement.dataset.theme = 'light'
  }, [])

  // mirror browser controller state into the renderer and restore xterm focus when the browser closes
  useEffect(() => {
    if (!window.takoyaki?.browser) return
    let disposed = false

    void window.takoyaki.browser.getState().then((state) => {
      if (!disposed) setBrowserState(state)
    })

    const cleanupState = window.takoyaki.browser.onStateChange((state) => {
      if (!disposed) setBrowserState(state)
    })

    const cleanupReturnFocus = window.takoyaki.browser.onReturnFocus((surfaceId) => {
      if (disposed || !surfaceId || activeView !== 'terminal') return
      setActiveVisibleSurfaceId(surfaceId)
      setTerminalFocusRequest({ surfaceId, token: Date.now() })
      void window.takoyaki.surface.focus(surfaceId)
    })

    return () => {
      disposed = true
      cleanupState()
      cleanupReturnFocus()
    }
  }, [activeView])

  // mirror updater state so settings and the restart prompt stay in sync with main
  useEffect(() => {
    if (!window.takoyaki?.updates) return
    let disposed = false

    void window.takoyaki.updates.getState().then((state) => {
      if (!disposed) setUpdateState(state)
    })

    const cleanup = window.takoyaki.updates.onStateChange((state) => {
      if (!disposed) setUpdateState(state)
    })

    return () => {
      disposed = true
      cleanup()
    }
  }, [])

  // lets the titlebar open settings without threading that handler through every layer
  useEffect(() => {
    window.takoyakiOpenSettings = () => setSettingsOpen(true)
    return () => {
      delete window.takoyakiOpenSettings
    }
  }, [])

  // hydrates the initial workspace snapshot and then keeps the renderer synced with main process changes
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

  // lazily loads trees for workspaces that become active after the initial snapshot
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

  // drops cached trees for workspaces that no longer exist
  useEffect(() => {
    setWorkspaceTrees((current) => {
      const validIds = new Set(workspaces.map((workspace) => workspace.id))
      const nextEntries = Object.entries(current).filter(([workspaceId]) => validIds.has(workspaceId))
      if (nextEntries.length === Object.keys(current).length) return current
      return Object.fromEntries(nextEntries)
    })
  }, [workspaces])

  // keep only the active workspace mounted for now and preserve lru ordering for a future warm cache
  useEffect(() => {
    const currentWorkspaceIds = workspaces.map((workspace) => workspace.id)
    setMountedWorkspaceIds((current) => {
      const next = reconcileMountedWorkspaceIds({
        currentWorkspaceIds,
        currentMountedWorkspaceIds: current,
        activeWorkspaceId: activeId,
        maxHiddenWorkspaceCount: MAX_HIDDEN_MOUNTED_WORKSPACES,
      })
      return next.length === current.length && next.every((workspaceId, index) => workspaceId === current[index])
        ? current
        : next
    })
  }, [activeId, workspaces])

  // keeps terminal metadata scoped to the terminals that are still part of the active stage
  useEffect(() => {
    const validTerminalIds = new Set(terminalViews.map((terminal) => terminal.terminalId))
    setTerminalMetadataById((current) => {
      const nextEntries = Object.entries(current).filter(([terminalId]) => validTerminalIds.has(terminalId))
      if (nextEntries.length === Object.keys(current).length) return current
      return Object.fromEntries(nextEntries)
    })

    if (!window.takoyaki?.terminal) return
    let disposed = false

    for (const terminal of terminalViews) {
      void window.takoyaki.terminal.metadata(terminal.terminalId).then((metadata) => {
        if (disposed || !metadata) return
        setTerminalMetadataById((current) => {
          if (sameTerminalMetadata(current[metadata.terminalId], metadata)) return current
          return { ...current, [metadata.terminalId]: metadata }
        })
      })
    }

    return () => {
      disposed = true
    }
  }, [terminalViews])

  // loads persisted pin state once and lets the store own future updates
  useEffect(() => {
    // load sidebar preferences once and let the store keep the renderer copy in sync
    void loadPinnedProjects()
  }, [loadPinnedProjects])

  // loads editor preference state once at startup
  useEffect(() => {
    void loadEditorState()
  }, [loadEditorState])

  // switches the app into narrow layout mode when the window crosses the responsive breakpoint
  useEffect(() => {
    const onResize = () => setIsNarrowLayout(window.innerWidth < 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // keep the browser width clamped when the window changes size
  useEffect(() => {
    const onResize = () => setBrowserWidth((current) => clampBrowserWidth(current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampBrowserWidth])

  // dragging the browser edge should only resize the overlay and never touch pane layout state
  useEffect(() => {
    if (!browserResizeState) return

    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== browserResizeState.pointerId) return
      const delta = browserResizeState.startX - event.clientX
      setBrowserWidth(clampBrowserWidth(browserResizeState.startWidth + delta))
    }

    const stopResize = (event: PointerEvent) => {
      if (event.pointerId !== browserResizeState.pointerId) return
      setBrowserResizeState(null)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)

    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }
  }, [browserResizeState, clampBrowserWidth])

  // keep the browser out of narrow layouts where the companion would crowd the shell
  useEffect(() => {
    if (!isNarrowLayout || !browserState.visible) return
    void window.takoyaki?.browser.hide()
  }, [browserState.visible, isNarrowLayout])

  // browser focus is temporary and should not become the next default open mode
  useEffect(() => {
    if (!browserVisible) setBrowserDisplayMode('side')
  }, [browserVisible])

  // mirrors browser loading into the activity drawer so slow pages are visible
  useEffect(() => {
    const currentUrl = browserState.url || browserState.lastUrl
    const operation = browserLoadOperationRef.current

    if (!browserState.visible) {
      if (operation) {
        clearActivityOperation(operation.id)
        browserLoadOperationRef.current = null
      }
      return
    }

    if (browserState.isLoading) {
      if (operation?.url === currentUrl) return
      if (operation) {
        clearActivityOperation(operation.id)
      }
      const id = startActivityOperation({
        kind: 'browser',
        title: 'Loading browser page',
        detail: currentUrl || 'Opening page.',
      })
      browserLoadOperationRef.current = { id, url: currentUrl }
      return
    }

    if (!operation) return
    browserLoadOperationRef.current = null
    finishActivityOperation(operation.id, browserState.error ? 'failed' : 'success', {
      title: browserState.error ? 'Browser page failed' : 'Browser page loaded',
      detail: browserState.error || operation.url || currentUrl || null,
    })
  }, [
    browserState.error,
    browserState.isLoading,
    browserState.lastUrl,
    browserState.url,
    browserState.visible,
    clearActivityOperation,
    finishActivityOperation,
    startActivityOperation,
  ])

  // page failures should be visible even when the activity drawer is closed
  useEffect(() => {
    if (!browserState.error) return
    showToast({ message: 'Browser failed to load. Open Activity for details.', dot: colors.error }, 4200)
  }, [browserState.error, showToast])

  // mirrors update checks into activity so downloads and failures are visible
  useEffect(() => {
    if (!updateState || updateState.status === 'idle' || updateState.status === 'disabled') return

    const runningStatus =
      updateState.status === 'checking' || updateState.status === 'available' || updateState.status === 'downloading'
    const title =
      updateState.status === 'downloading'
        ? 'Downloading update'
        : updateState.status === 'downloaded'
          ? 'Update ready'
          : updateState.status === 'not-available'
            ? 'No update available'
            : updateState.status === 'error'
              ? 'Update check failed'
              : 'Checking for updates'
    const detail =
      updateState.status === 'downloading' && updateState.downloadPercent !== null
        ? `${updateState.downloadPercent}% downloaded.`
        : updateState.detail

    if (runningStatus) {
      if (updateOperationRef.current) {
        updateActivityOperation(updateOperationRef.current, { status: 'running', title, detail })
        return
      }
      updateOperationRef.current = startActivityOperation({ kind: 'updates', title, detail })
      return
    }

    const operationId = updateOperationRef.current || startActivityOperation({ kind: 'updates', title, detail })
    updateOperationRef.current = null
    finishActivityOperation(operationId, updateState.status === 'error' ? 'failed' : 'success', { title, detail })
  }, [finishActivityOperation, startActivityOperation, updateActivityOperation, updateState])

  // closes the drawer whenever the layout or active workspace makes the drawer stale
  useEffect(() => {
    if (!isNarrowLayout) {
      setSidebarDrawerOpen(false)
      return
    }
    if (activeId) setSidebarDrawerOpen(false)
  }, [activeId, isNarrowLayout])

  // forces the drawer shut while review focus mode hides sidebar chrome
  useEffect(() => {
    if (hideSidebar) setSidebarDrawerOpen(false)
  }, [hideSidebar])

  // keeps a visible surface selected even when focus or the pane tree changes underneath it
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

  // when pane focus mode is active, follow real focus changes from main so the visible pane stays in sync
  useEffect(() => {
    if (!paneFocusSurfaceId || !focusedSurfaceId) return
    if (focusedSurfaceId === paneFocusSurfaceId) return
    if (!paneLeaves.some((leaf) => leaf.surfaceId === focusedSurfaceId)) return
    setActiveVisibleSurfaceId(focusedSurfaceId)
    setPaneFocusSurfaceId(focusedSurfaceId)
  }, [focusedSurfaceId, paneFocusSurfaceId, paneLeaves, setPaneFocusSurfaceId])

  // clear pane focus mode whenever the focused pane disappears or the workspace changes underneath it
  useEffect(() => {
    if (!paneFocusSurfaceId) return
    if (paneLeaves.some((leaf) => leaf.surfaceId === paneFocusSurfaceId)) return
    clearPaneFocusMode()
  }, [clearPaneFocusMode, paneFocusSurfaceId, paneLeaves])

  // keep pane focus mode scoped to terminal view only
  useEffect(() => {
    if (activeView === 'terminal' || !paneFocusSurfaceId) return
    clearPaneFocusMode()
  }, [activeView, clearPaneFocusMode, paneFocusSurfaceId])

  // exits review mode if the reviewed workspace disappears from the workspace list
  useEffect(() => {
    if (activeView !== 'review' || !reviewWorkspaceId) return
    if (workspaces.some((workspace) => workspace.id === reviewWorkspaceId)) return
    closeReview()
  }, [activeView, closeReview, reviewWorkspaceId, workspaces])

  // mirrors claude hook status events into the zustand store
  useEffect(() => {
    if (!window.takoyaki) return
    const cleanup = window.takoyaki.status.onChange((statuses) => {
      useStore.getState().setSurfaceStatuses(statuses)
    })
    return cleanup
  }, [])

  // keeps terminal titles and cwd metadata live as terminals start and emit metadata events
  useEffect(() => {
    if (!window.takoyaki?.terminal) return
    const cleanup = window.takoyaki.terminal.onEvent((event) => {
      if (event.type === 'metadata') {
        const nextMetadata = snapshotToTerminalMetadata({
          terminalId: event.terminalId,
          cwd: event.cwd,
          title: event.title,
          updatedAt: event.createdAt,
        })
        setTerminalMetadataById((current) => {
          if (sameTerminalMetadata(current[event.terminalId], nextMetadata)) return current
          return { ...current, [event.terminalId]: nextMetadata }
        })
        return
      }

      if (event.type === 'started') {
        const nextMetadata = snapshotToTerminalMetadata(event.snapshot)
        setTerminalMetadataById((current) => {
          if (sameTerminalMetadata(current[event.terminalId], nextMetadata)) return current
          return { ...current, [event.terminalId]: nextMetadata }
        })
      }
    })
    return cleanup
  }, [])

  // mirrors workspace activity updates into the renderer store
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

  // shows a short toast after the session is saved
  useEffect(() => {
    if (!window.takoyaki) return
    const cleanup = window.takoyaki.session.onSaved(() => {
      showToast({ message: 'Session saved' }, 2000)
    })
    return cleanup
  }, [showToast])

  // surfaces claude completion and failure events as lightweight toasts
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

  // routes global shortcuts through the current renderer state and the latest workspace focus
  useEffect(() => {
    if (!window.takoyaki?.workspace) return
    let disposed = false

    const cleanup = window.takoyaki.onShortcut((action: string) => {
      if (action === 'toggle-sidebar') {
        if (isNarrowLayout) setSidebarDrawerOpen((open) => !open)
        else toggleSidebar()
        return
      }

      if (action === 'toggle-pane-focus' && activeView === 'terminal') {
        void window.takoyaki.workspace.current().then((current) => {
          if (disposed) return
          const currentFocusedSurfaceId = current?.focusedSurfaceId
          if (!currentFocusedSurfaceId) return
          togglePaneFocusForSurface(currentFocusedSurfaceId)
        })
      }
    })
    return () => {
      disposed = true
      cleanup()
    }
  }, [activeView, isNarrowLayout, togglePaneFocusForSurface, toggleSidebar])

  // binds ctrl tab cycling so visible workspace navigation works outside the native menu system
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

  // measures rendered pane slots after layout so floating terminal surfaces can be positioned accurately
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
  }, [activeId, activeVisibleSurfaceId, activeView, isNarrowLayout, paneFocusSurfaceId, tree])

  const renderTerminalStage = (narrow: boolean) => (
    <div className="relative flex-1 overflow-hidden flex flex-col">
      {narrow && paneLeaves.length > 1 && !paneFocusLeaf && (
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
                  fontFamily: fonts.ui,
                  fontWeight: 500,
                }}
                onMouseEnter={(event) => {
                  if (!active) event.currentTarget.style.color = colors.textPrimary
                }}
                onMouseLeave={(event) => {
                  if (!active) event.currentTarget.style.color = colors.textSecondary
                }}
              >
                {paneLabels[leaf.surfaceId] || `Pane ${index + 1}`}
              </button>
            )
          })}
        </div>
      )}

      <div ref={terminalViewportRef} className="relative flex-1 overflow-hidden">
        {activeWorkspace && tree ? (
          narrow && paneFocusLeaf ? (
            <PaneSlot surfaceId={paneFocusLeaf.surfaceId} />
          ) : narrow && visibleLeaf ? (
            <PaneSlot surfaceId={visibleLeaf.surfaceId} />
          ) : !narrow ? (
            <>
              <div
                className="absolute inset-0"
                style={{
                  visibility: paneFocusLeaf ? 'hidden' : 'visible',
                  pointerEvents: paneFocusLeaf ? 'none' : 'auto',
                }}
                aria-hidden={paneFocusLeaf ? true : undefined}
              >
                <PaneLayout tree={tree} measurable={!paneFocusLeaf} />
              </div>
              {paneFocusLeaf && (
                <div className="absolute inset-0">
                  <PaneSlot surfaceId={paneFocusLeaf.surfaceId} />
                </div>
              )}
            </>
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
                fontSize={terminal.fontSize}
                frame={frame}
                paneLabel={paneLabels[terminal.surfaceId] || null}
                isPaneFocusMode={paneFocusSurfaceId === terminal.surfaceId}
                isFocused={Boolean(
                  frame &&
                  activeView === 'terminal' &&
                  terminal.workspaceId === activeId &&
                  terminal.surfaceId === focusedSurfaceId,
                )}
                focusRequestKey={
                  terminalFocusRequest?.surfaceId === terminal.surfaceId ? terminalFocusRequest.token : 0
                }
                onTogglePaneFocusMode={() => togglePaneFocusForSurface(terminal.surfaceId)}
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
      <ActivityPanel height={activityPanelHeight} onHeightChange={setActivityPanelHeight} />
    </div>
  )

  return (
    <div
      ref={rootShellRef}
      className="relative flex flex-col h-screen w-screen overflow-hidden"
      style={{ background: colors.bg }}
    >
      <Titlebar
        narrow={isNarrowLayout && !hideSidebar}
        browserVisible={browserVisible}
        onToggleBrowser={() => {
          if (isNarrowLayout || !window.takoyaki?.browser) return
          if (!browserState.visible) setBrowserDisplayMode('side')
          void window.takoyaki.browser.toggle(browserState.lastUrl || undefined)
        }}
        onToggleSidebar={() => {
          if (hideSidebar) return
          if (isNarrowLayout) setSidebarDrawerOpen((open) => !open)
          else toggleSidebar()
        }}
      />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 overflow-hidden">
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
        {browserSideVisible && <div style={{ width: browserWidth, flexShrink: 0 }} aria-hidden="true" />}
      </div>
      {browserVisible && (
        <div className="pointer-events-none absolute inset-0 z-30">
          <div
            className="pointer-events-auto absolute bottom-0 right-0"
            style={{
              top: sizes.titlebarHeight,
              ...(browserFocusVisible ? { left: 0 } : { width: browserWidth }),
            }}
          >
            <BrowserPanel
              rootRef={rootShellRef}
              state={browserState}
              mode={browserDisplayMode}
              isResizing={Boolean(browserResizeState)}
              onResizePointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
                event.preventDefault()
                if (browserDisplayMode !== 'side') return
                setBrowserResizeState({
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startWidth: browserWidth,
                })
              }}
              onToggleFocusMode={() => {
                setBrowserDisplayMode((mode) => (mode === 'focus' ? 'side' : 'focus'))
              }}
            />
          </div>
        </div>
      )}
      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        updateState={updateState}
        onCheckForUpdates={checkForUpdates}
        onInstallUpdate={installUpdate}
      />
      {updateReadyVersion && (
        <div
          className="fixed z-50 takoyaki-toast-in"
          style={{
            bottom: toast ? 72 : 20,
            right: 20,
            width: 300,
            background: colors.bg,
            border: `1px solid ${colors.separator}`,
            borderRadius: 10,
            padding: 14,
            boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold" style={{ color: colors.textPrimary }}>
                Update ready
              </p>
              <p className="mt-1 text-[12px] leading-5" style={{ color: colors.textSecondary }}>
                Version {updateReadyVersion} has downloaded. Restart Takoyaki to install it.
              </p>
            </div>
            <button
              type="button"
              aria-label="dismiss update"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ color: colors.textGhost }}
              onClick={() => setDismissedUpdateVersion(updateReadyVersion)}
            >
              x
            </button>
          </div>
          <button
            type="button"
            className="mt-3 rounded-md px-3 py-2 text-[12px] font-medium"
            style={{ ...button.base, color: colors.accent }}
            onClick={installUpdate}
          >
            Restart to update
          </button>
        </div>
      )}
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
