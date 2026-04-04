import { useEffect, useMemo, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useStore } from './store'
import { Titlebar } from './Titlebar'
import { Sidebar } from './Sidebar'
import { Terminal } from './Terminal'
import { Settings } from './Settings'
import { colors, fonts } from './design'
import type { PaneTree, WorkspaceSnapshot } from './types'

// renders the pane tree recursive
// key={surfaceId} on terminals ensures react reuses existing instances on split
// so this is just rendering the pane tree (if it's a leaf then render a terminal, if it's a split then render a panel group with two panels)
function PaneView({ tree, focusedSurfaceId }: { tree: PaneTree; focusedSurfaceId: string | null }) {
  if (tree.type === 'leaf') {
    return (
      <Terminal
        key={tree.surfaceId}
        surfaceId={tree.surfaceId}
        terminalId={tree.terminalId}
        isFocused={tree.surfaceId === focusedSurfaceId}
      />
    )
  }

  return (
    <PanelGroup direction={tree.direction}>
      <Panel minSize={15}>
        <PaneView tree={tree.first} focusedSurfaceId={focusedSurfaceId} />
      </Panel>
      <PanelResizeHandle className="split-handle" data-direction={tree.direction} />
      <Panel minSize={15}>
        <PaneView tree={tree.second} focusedSurfaceId={focusedSurfaceId} />
      </Panel>
    </PanelGroup>
  )
}

function EmptyState() {
  return <div className="flex-1" />
}

interface PaneLeaf {
  surfaceId: string
  terminalId: string
}

function collectLeaves(tree: PaneTree): PaneLeaf[] {
  if (tree.type === 'leaf') {
    return [{ surfaceId: tree.surfaceId, terminalId: tree.terminalId }]
  }
  return [...collectLeaves(tree.first), ...collectLeaves(tree.second)]
}

// main app component
export function App() {
  const workspaces = useStore((s) => s.workspaces)
  const activeId = useStore((s) => s.activeWorkspaceId)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const loadEditorState = useStore((s) => s.loadEditorState)
  const toast = useStore((s) => s.toast)
  const showToast = useStore((s) => s.showToast)
  const clearToast = useStore((s) => s.clearToast)
  const activeWorkspace = workspaces.find((w) => w.id === activeId)

  const [tree, setTree] = useState<PaneTree | null>(null)
  const [focusedSurfaceId, setFocusedSurfaceId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isNarrowLayout, setIsNarrowLayout] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 900 : false,
  )
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false)
  const [activeVisibleSurfaceId, setActiveVisibleSurfaceId] = useState<string | null>(null)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const paneLeaves = useMemo(() => (tree ? collectLeaves(tree) : []), [tree])
  const visibleLeaf = useMemo(() => {
    if (!paneLeaves.length) return null
    return (
      paneLeaves.find((leaf) => leaf.surfaceId === activeVisibleSurfaceId) ||
      paneLeaves.find((leaf) => leaf.surfaceId === focusedSurfaceId) ||
      paneLeaves[0]
    )
  }, [activeVisibleSurfaceId, focusedSurfaceId, paneLeaves])

  // initialize theme from the storage (previous session)
  useEffect(() => {
    const saved = localStorage.getItem('mux-theme')
    if (saved === 'light') document.documentElement.dataset.theme = 'light'
  }, [])

  // open the frickin settings for gear icon
  useEffect(() => {
    window.muxOpenSettings = () => setSettingsOpen(true)
    return () => {
      delete window.muxOpenSettings
    }
  }, [])

  // listen for workspace snapshots from main process
  useEffect(() => {
    if (!window.mux) return

    // initial load
    // get the list of workspaces and then put them in store
    window.mux.workspace.list().then((wsList) => {
      useStore.setState({ workspaces: wsList })
    })
    // get current workspace and set it in store so that the right project is highlighteds
    window.mux.workspace.current().then((ws) => {
      if (ws) {
        useStore.setState({ activeWorkspaceId: ws.id })
        setFocusedSurfaceId(ws.focusedSurfaceId)
      }
    })
    // get the pane tree and set it in store so that the right panes are shown
    window.mux.workspace.tree().then((t) => {
      if (t) setTree(t)
    })

    // on every change the main process sends a full snapshot of the current workspace
    const cleanup = window.mux.workspace.onChange((snapshot: WorkspaceSnapshot) => {
      if (snapshot) {
        useStore.setState({
          workspaces: snapshot.workspaces || [],
          activeWorkspaceId: snapshot.activeWorkspaceId || null,
        })
        // update the pane tree in the store so that the right panes are shown
        setTree(snapshot.tree || null)
        if (snapshot.focusedSurfaceId !== undefined) setFocusedSurfaceId(snapshot.focusedSurfaceId)
      }
    })

    return cleanup
  }, [])

  // check which editors are installed and the default form main process
  useEffect(() => {
    void loadEditorState()
  }, [loadEditorState])

  // listen for window resize to set the narrow layout
  useEffect(() => {
    const onResize = () => setIsNarrowLayout(window.innerWidth < 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // if the layout is not narrow, then close the sidebar drawer
  useEffect(() => {
    if (!isNarrowLayout) {
      setSidebarDrawerOpen(false)
      return
    }
    if (activeId) setSidebarDrawerOpen(false)
  }, [activeId, isNarrowLayout])

  // if there are no pane then set the active visible surface to empty state
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

  // status updates (running/finished)
  useEffect(() => {
    if (!window.mux) return
    const cleanup = window.mux.status.onChange((statuses) => {
      useStore.getState().setSurfaceStatuses(statuses)
    })
    return cleanup
  }, [])

  // workspace activity tracking
  useEffect(() => {
    if (!window.mux?.activity) return
    window.mux.activity.get().then((data) => {
      useStore.getState().setWorkspaceActivity(data)
    })
    const cleanup = window.mux.activity.onChange((data) => {
      useStore.getState().setWorkspaceActivity(data)
    })
    return cleanup
  }, [])

  // session save toast
  useEffect(() => {
    if (!window.mux) return
    const cleanup = window.mux.session.onSaved(() => {
      showToast({ message: 'Session saved' }, 2000)
    })
    return cleanup
  }, [showToast])

  // project-aware agent toast
  useEffect(() => {
    if (!window.mux?.toast) return
    const cleanup = window.mux.toast.onAgentEvent((event) => {
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

  // ui shortcuts
  useEffect(() => {
    if (!window.mux) return
    const cleanup = window.mux.onShortcut((action: string) => {
      if (action === 'toggle-sidebar') {
        if (isNarrowLayout) setSidebarDrawerOpen((open) => !open)
        else toggleSidebar()
      }
    })
    return cleanup
  }, [isNarrowLayout, toggleSidebar])

  useEffect(() => {
    if (!window.mux?.workspace) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.altKey) return
      if (event.key !== 'Tab') return
      event.preventDefault()
      event.stopPropagation()
      void window.mux.workspace.cycleVisible(event.shiftKey ? 'prev' : 'next')
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  return (
    <div className="relative flex flex-col h-screen w-screen overflow-hidden" style={{ background: colors.bg }}>
      <Titlebar
        narrow={isNarrowLayout}
        onToggleSidebar={() => {
          if (isNarrowLayout) setSidebarDrawerOpen((open) => !open)
          else toggleSidebar()
        }}
      />
      <div className="flex flex-1 overflow-hidden">
        {isNarrowLayout ? (
          <>
            <Sidebar
              narrow
              drawerOpen={sidebarDrawerOpen}
              onRequestOpen={() => setSidebarDrawerOpen(true)}
              onRequestClose={() => setSidebarDrawerOpen(false)}
            />
            {activeWorkspace && tree && visibleLeaf ? (
              <div key={activeWorkspace.id} className="flex-1 overflow-hidden flex flex-col">
                {paneLeaves.length > 1 && (
                  <div
                    className="flex items-center gap-1 overflow-x-auto px-3 pt-2 shrink-0"
                    style={{ borderBottom: `1px solid ${colors.separator}` }}
                  >
                    {paneLeaves.map((leaf, index) => {
                      const active = visibleLeaf.surfaceId === leaf.surfaceId
                      return (
                        <button
                          key={leaf.surfaceId}
                          onClick={() => {
                            setActiveVisibleSurfaceId(leaf.surfaceId)
                            void window.mux?.surface.focus(leaf.surfaceId)
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
                <div className="flex-1 overflow-hidden">
                  <Terminal
                    key={visibleLeaf.surfaceId}
                    surfaceId={visibleLeaf.surfaceId}
                    terminalId={visibleLeaf.terminalId}
                    isFocused
                  />
                </div>
              </div>
            ) : (
              <EmptyState />
            )}
          </>
        ) : (
          <>
            <Sidebar />
            {activeWorkspace && tree ? (
              <div key={activeWorkspace.id} className="flex-1 overflow-hidden">
                <PaneView tree={tree} focusedSurfaceId={focusedSurfaceId} />
              </div>
            ) : (
              <EmptyState />
            )}
          </>
        )}
      </div>
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {toast && (
        <div
          className="fixed z-50 mux-toast-in"
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
