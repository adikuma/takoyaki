import { useEffect, useMemo, useRef, useState } from 'react'
import { Moon, Plus, Settings2, Sun, X } from 'lucide-react'
import { useStore } from './store'
import { colors, sizes } from './design'
import { Tooltip } from './Tooltip'
import { sortProjectsByPinned } from './pinned-projects'
import type { EditorKind, Workspace } from './types'
import { CloseProjectModal } from './sidebar/CloseProjectModal'
import { ProjectTree } from './sidebar/ProjectTree'
import { RemoveTaskModal } from './sidebar/RemoveTaskModal'
import { SearchIcon } from './sidebar/SidebarPrimitives'
import { TaskCreateModal } from './sidebar/TaskCreateModal'
import { useTaskCreationController } from './sidebar/useTaskCreationController'
import { useTaskRemovalController } from './sidebar/useTaskRemovalController'

const editorMenuItems: { target: EditorKind; label: string }[] = [
  { target: 'cursor', label: 'Cursor' },
  { target: 'vscode', label: 'VS Code' },
  { target: 'zed', label: 'Zed' },
  { target: 'explorer', label: 'Explorer' },
]

interface SidebarProps {
  narrow?: boolean
  drawerOpen?: boolean
  onRequestOpen?: () => void
  onRequestClose?: () => void
}

export function Sidebar({ narrow = false, drawerOpen = true, onRequestOpen, onRequestClose }: SidebarProps) {
  const workspaces = useStore((state) => state.workspaces)
  const activeId = useStore((state) => state.activeWorkspaceId)
  const collapsed = useStore((state) => state.sidebarCollapsed)
  const surfaceStatuses = useStore((state) => state.surfaceStatuses)
  const selectWorkspace = useStore((state) => state.selectWorkspace)
  const closeWorkspace = useStore((state) => state.closeWorkspace)
  const openProjectFolder = useStore((state) => state.openProjectFolder)
  const toggleSidebar = useStore((state) => state.toggleSidebar)
  const pinnedProjectRoots = useStore((state) => state.pinnedProjectRoots)
  const togglePinnedProject = useStore((state) => state.togglePinnedProject)
  const theme = useStore((state) => state.theme)
  const toggleTheme = useStore((state) => state.toggleTheme)
  const showToast = useStore((state) => state.showToast)
  const editorAvailability = useStore((state) => state.editorAvailability)
  const openReview = useStore((state) => state.openReview)

  const [search, setSearch] = useState('')
  const [confirmClose, setConfirmClose] = useState<{ id: string; title: string } | null>(null)
  const [openingWorkspaceId, setOpeningWorkspaceId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const {
    taskModalProjectId,
    taskTitle,
    taskBranchName,
    taskBranches,
    taskBranchesLoading,
    taskBaseBranch,
    taskCreateError,
    taskCreating,
    taskTitleRef,
    taskBranchNameRef,
    openTaskModal,
    closeTaskModal,
    setTaskTitleValue,
    setTaskBranchNameValue,
    setTaskBaseBranch,
    createTask,
  } = useTaskCreationController()
  const { confirmRemoveTask, taskRemoveBusy, promptRemoveTask, closeRemoveTaskModal, removeTask } =
    useTaskRemovalController()

  const projects = useMemo(() => workspaces.filter((workspace) => workspace.kind === 'project'), [workspaces])
  const tasksByProjectId = useMemo(() => {
    const grouped = new Map<string, Workspace[]>()
    for (const workspace of workspaces) {
      if (workspace.kind !== 'task' || !workspace.parentProjectId) continue
      const existing = grouped.get(workspace.parentProjectId)
      if (existing) existing.push(workspace)
      else grouped.set(workspace.parentProjectId, [workspace])
    }
    return grouped
  }, [workspaces])

  const filtered = useMemo(() => {
    const visibleProjects = search
      ? projects.filter((workspace) => workspace.title.toLowerCase().includes(search.toLowerCase()))
      : projects
    return sortProjectsByPinned(visibleProjects, pinnedProjectRoots)
  }, [pinnedProjectRoots, projects, search])

  const availableEditors = useMemo(
    () =>
      editorMenuItems
        .filter((item) => editorAvailability.find((candidate) => candidate.kind === item.target)?.available)
        .map((item) => item.target),
    [editorAvailability],
  )

  // bind the project search shortcut to either the drawer or the full sidebar shell
  useEffect(() => {
    if (!window.takoyaki) return
    const cleanup = window.takoyaki.onShortcut((action: string) => {
      if (action !== 'find-projects') return
      if (narrow) {
        if (!drawerOpen) onRequestOpen?.()
        setTimeout(() => searchInputRef.current?.focus(), drawerOpen ? 40 : 120)
        return
      }
      if (collapsed) toggleSidebar()
      setTimeout(() => searchInputRef.current?.focus(), collapsed ? 120 : 40)
    })
    return cleanup
  }, [collapsed, drawerOpen, narrow, onRequestOpen, toggleSidebar])

  // select a workspace and close the mobile drawer when needed
  const handleSelectWorkspace = (workspaceId: string) => {
    void selectWorkspace(workspaceId)
    if (narrow) onRequestClose?.()
  }

  // launch the chosen workspace in the user's preferred editor and surface launch errors as toasts
  const handleOpenInEditor = async (workspaceId: string) => {
    if (openingWorkspaceId === workspaceId) return
    if (!availableEditors.length) {
      showToast({ message: 'No supported editors are installed.', dot: colors.error }, 3200)
      return
    }
    setOpeningWorkspaceId(workspaceId)
    let result
    try {
      result = await window.takoyaki.editor.openWorkspace(workspaceId, 'preferred')
    } finally {
      setOpeningWorkspaceId(null)
    }
    if (!result.ok) {
      showToast({ message: result.detail, dot: colors.error }, 3200)
    }
    if (result.ok && narrow) onRequestClose?.()
  }

  // open review for the selected workspace and close the narrow drawer if present
  const handleOpenReview = (workspaceId: string) => {
    void openReview(workspaceId)
    if (narrow) onRequestClose?.()
  }

  if (narrow && !drawerOpen) return null

  const sidebarContent = (
    <div
      className={`flex flex-col h-full shrink-0 overflow-hidden ${narrow ? 'transition-[width] duration-200' : ''}`}
      style={{
        width: narrow ? 'min(300px, calc(100vw - 24px))' : collapsed ? 0 : sizes.sidebarWidth,
        background: colors.bg,
        borderRight: `1px solid ${colors.separator}`,
      }}
    >
      <div className="px-3 pt-3 pb-3 flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <span
            className="text-[10px] font-semibold"
            style={{ letterSpacing: '0.1em', textTransform: 'uppercase', color: colors.textMuted }}
          >
            Projects
          </span>
          <button
            onClick={() => {
              void openProjectFolder()
              if (narrow) onRequestClose?.()
            }}
            className="transition-colors duration-[120ms] cursor-pointer"
            style={{ color: colors.textMuted }}
            onMouseEnter={(event) => {
              event.currentTarget.style.color = colors.textPrimary
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.color = colors.textMuted
            }}
            aria-label="new project"
          >
            <Plus size={sizes.iconBase} strokeWidth={1.7} />
          </button>
        </div>
        <div
          className="flex items-center gap-2"
          style={{ padding: '7px 9px', borderRadius: 8, background: colors.bgInput, color: colors.textMuted }}
        >
          <SearchIcon />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="filter projects..."
            className="flex-1 bg-transparent text-[12px] outline-none min-w-0 takoyaki-input"
            style={{ color: colors.textPrimary }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ color: colors.textGhost }}
              onMouseEnter={(event) => {
                event.currentTarget.style.color = colors.textSecondary
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = colors.textGhost
              }}
              aria-label="clear project search"
            >
              <X size={sizes.iconSm} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      <ProjectTree
        projects={filtered}
        tasksByProjectId={tasksByProjectId}
        activeId={activeId}
        theme={theme}
        surfaceStatuses={surfaceStatuses}
        pinnedProjectRoots={pinnedProjectRoots}
        onSelectWorkspace={handleSelectWorkspace}
        onTogglePinnedProject={(projectRoot) => {
          void togglePinnedProject(projectRoot)
        }}
        onOpenTaskModal={openTaskModal}
        onOpenReview={handleOpenReview}
        onOpenInEditor={(workspaceId) => {
          void handleOpenInEditor(workspaceId)
        }}
        onConfirmCloseProject={setConfirmClose}
        onConfirmRemoveTask={promptRemoveTask}
      />

      <CloseProjectModal
        project={confirmClose}
        onClose={() => setConfirmClose(null)}
        onConfirm={(projectId) => {
          closeWorkspace(projectId)
        }}
      />

      <TaskCreateModal
        open={Boolean(taskModalProjectId)}
        taskTitle={taskTitle}
        taskBranchName={taskBranchName}
        taskBranches={taskBranches}
        taskBranchesLoading={taskBranchesLoading}
        taskBaseBranch={taskBaseBranch}
        taskCreateError={taskCreateError}
        taskCreating={taskCreating}
        taskTitleRef={taskTitleRef}
        taskBranchNameRef={taskBranchNameRef}
        onTaskTitleChange={setTaskTitleValue}
        onTaskBranchNameChange={setTaskBranchNameValue}
        onTaskBaseBranchChange={setTaskBaseBranch}
        onClose={closeTaskModal}
        onSubmit={() => {
          void createTask()
        }}
      />

      <RemoveTaskModal
        task={confirmRemoveTask}
        busy={taskRemoveBusy}
        onClose={closeRemoveTaskModal}
        onConfirm={(taskId, force) => {
          void removeTask(taskId, force)
        }}
      />

      <div className="px-3 py-3 flex items-center gap-1" style={{ borderTop: `1px solid ${colors.separator}` }}>
        <button
          onClick={() => {
            window.takoyakiOpenSettings?.()
            if (narrow) onRequestClose?.()
          }}
          className="flex-1 flex items-center gap-2 transition-colors duration-[120ms] cursor-pointer px-2 py-2 rounded-lg"
          style={{ color: colors.textMuted }}
          onMouseEnter={(event) => {
            event.currentTarget.style.color = colors.textPrimary
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.color = colors.textMuted
          }}
          aria-label="settings"
        >
          <Settings2 size={sizes.iconBase} strokeWidth={1.8} />
          <span className="text-[12px]">Settings</span>
        </button>
        <Tooltip content={theme === 'dark' ? 'Light mode' : 'Dark mode'} side="top">
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors duration-[120ms] cursor-pointer"
            style={{ color: colors.textMuted }}
            onMouseEnter={(event) => {
              event.currentTarget.style.color = colors.textPrimary
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.color = colors.textMuted
            }}
            aria-label="toggle theme"
          >
            {theme === 'dark' ? (
              <Sun size={sizes.iconBase} strokeWidth={1.8} />
            ) : (
              <Moon size={sizes.iconBase} strokeWidth={1.8} />
            )}
          </button>
        </Tooltip>
      </div>
    </div>
  )

  if (!narrow) return sidebarContent

  return (
    <>
      <div
        className="absolute inset-0 z-40"
        style={{ background: 'var(--takoyaki-backdrop)' }}
        onClick={onRequestClose}
      />
      <div className="absolute inset-y-0 left-0 z-50">{sidebarContent}</div>
    </>
  )
}
