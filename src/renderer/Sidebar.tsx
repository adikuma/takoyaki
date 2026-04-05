import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Diff,
  FolderClosed,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { useStore } from './store'
import { button, colors, fonts, sizes } from './design'
import { Tooltip } from './Tooltip'
import { GitBranchIcon } from './icons'
import type { EditorKind, HookStatusState, HookSurfaceStatus, Workspace } from './types'

// folder icon that lights up amber when the project is selected
function FolderIcon({ active }: { active?: boolean }) {
  return (
    <FolderClosed
      size={sizes.iconBase}
      strokeWidth={1.8}
      color={active ? colors.accentSoft : colors.textMuted}
      style={{ flexShrink: 0 }}
    />
  )
}

function SearchIcon() {
  return <Search size={13} strokeWidth={2} style={{ flexShrink: 0 }} />
}

function Checkmark() {
  return <Check size={sizes.iconSm} strokeWidth={2} color={colors.success} style={{ flexShrink: 0 }} />
}

function LightningIcon() {
  return <Zap size={sizes.iconSm} strokeWidth={2} color={colors.accent} style={{ flexShrink: 0 }} />
}

function FailureIcon() {
  return <X size={sizes.iconSm} strokeWidth={2} color={colors.error} style={{ flexShrink: 0 }} />
}

// shows a lightning bolt when running andcheckmark when done and  x when failed
function StatusGlyph({ status }: { status: HookStatusState | null }) {
  if (status === 'running') return <LightningIcon />
  if (status === 'finished') return <Checkmark />
  if (status === 'failed') return <FailureIcon />
  return null
}

// resolves the  status for a workspace from its surface statuses
// running takes max prior, then failed, then finished
function getWorkspaceStatus(
  surfaceStatuses: Record<string, HookSurfaceStatus>,
  workspaceSurfaceIds: string[],
): HookStatusState | null {
  let hasFinished = false
  let hasFailed = false
  for (const sid of workspaceSurfaceIds) {
    const status = surfaceStatuses[sid]?.status
    if (status === 'running') return 'running'
    if (status === 'failed') hasFailed = true
    if (status === 'finished') hasFinished = true
  }
  if (hasFailed) return 'failed'
  return hasFinished ? 'finished' : null
}

// if active workspace is a task return its parent project id otherwise return its own id
export function getActiveProjectId(activeWorkspace: Pick<Workspace, 'id' | 'parentProjectId'> | null): string | null {
  if (!activeWorkspace) return null
  return activeWorkspace.parentProjectId || activeWorkspace.id
}

const editorMenuItems: { target: EditorKind; label: string }[] = [
  { target: 'cursor', label: 'Cursor' },
  { target: 'vscode', label: 'VS Code' },
  { target: 'zed', label: 'Zed' },
  { target: 'explorer', label: 'Explorer' },
]

// searchable dropdown for the git branches
function BranchSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string
  options: string[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setFilterQuery('')
      return
    }
    setTimeout(() => filterInputRef.current?.focus(), 40)
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const filtered = filterQuery ? options.filter((o) => o.toLowerCase().includes(filterQuery.toLowerCase())) : options

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled && options.length > 0) setOpen((current) => !current)
        }}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-[12px] transition-colors duration-[120ms]"
        style={{
          background: colors.bgInput,
          color: disabled ? colors.textMuted : colors.textPrimary,
          opacity: disabled ? 0.7 : 1,
        }}
      >
        <span className="truncate text-left" style={{ fontFamily: fonts.mono }}>
          {value || 'Select branch'}
        </span>
        <ChevronDown size={12} strokeWidth={1.9} color={colors.textMuted} />
      </button>

      {open && !disabled && options.length > 0 && (
        <div
          className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-md"
          style={{
            background: colors.bg,
            border: `1px solid ${colors.separator}`,
            boxShadow: '0 12px 32px rgba(0,0,0,0.22)',
          }}
        >
          <div style={{ padding: '6px 8px', borderBottom: `1px solid ${colors.borderSubtle}` }}>
            <input
              ref={filterInputRef}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="filter branches..."
              className="w-full bg-transparent text-[12px] outline-none takoyaki-input"
              style={{ color: colors.textPrimary, fontFamily: fonts.mono }}
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 180 }}>
            {filtered.map((option) => {
              const selected = option === value
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    onChange(option)
                    setOpen(false)
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-[12px] transition-colors duration-[120ms]"
                  style={{
                    fontFamily: fonts.mono,
                    color: selected ? colors.textPrimary : colors.textSecondary,
                    background: selected ? colors.bgInput : 'transparent',
                  }}
                  onMouseEnter={(event) => {
                    if (!selected) event.currentTarget.style.background = colors.bgInput
                    event.currentTarget.style.color = colors.textPrimary
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = selected ? colors.bgInput : 'transparent'
                    event.currentTarget.style.color = selected ? colors.textPrimary : colors.textSecondary
                  }}
                >
                  <span className="truncate">{option}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

interface SidebarProps {
  narrow?: boolean
  drawerOpen?: boolean
  onRequestOpen?: () => void
  onRequestClose?: () => void
}

export function Sidebar({ narrow = false, drawerOpen = true, onRequestOpen, onRequestClose }: SidebarProps) {
  const workspaces = useStore((s) => s.workspaces)
  const activeId = useStore((s) => s.activeWorkspaceId)
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const surfaceStatuses = useStore((s) => s.surfaceStatuses)
  const selectWorkspace = useStore((s) => s.selectWorkspace)
  const closeWorkspace = useStore((s) => s.closeWorkspace)
  const openProjectFolder = useStore((s) => s.openProjectFolder)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const showToast = useStore((s) => s.showToast)
  const editorAvailability = useStore((s) => s.editorAvailability)
  const openReview = useStore((s) => s.openReview)

  const [search, setSearch] = useState('')
  const [confirmClose, setConfirmClose] = useState<{ id: string; title: string } | null>(null)
  const [taskModalProjectId, setTaskModalProjectId] = useState<string | null>(null)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskBranches, setTaskBranches] = useState<string[]>([])
  const [taskBranchesLoading, setTaskBranchesLoading] = useState(false)
  const [taskBaseBranch, setTaskBaseBranch] = useState('')
  const [taskCreateError, setTaskCreateError] = useState<string | null>(null)
  const [taskCreating, setTaskCreating] = useState(false)
  const [confirmRemoveTask, setConfirmRemoveTask] = useState<{
    id: string
    title: string
    detail?: string
    force: boolean
  } | null>(null)
  const [taskRemoveBusy, setTaskRemoveBusy] = useState(false)
  const [openingWorkspaceId, setOpeningWorkspaceId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const taskTitleRef = useRef<HTMLInputElement>(null)

  // split workspaces into projects and group tasks by parent
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

  const filtered = search ? projects.filter((ws) => ws.title.toLowerCase().includes(search.toLowerCase())) : projects
  const availableEditors = useMemo(
    () =>
      editorMenuItems
        .filter((item) => editorAvailability.find((candidate) => candidate.kind === item.target)?.available)
        .map((item) => item.target),
    [editorAvailability],
  )

  // ctrl+shift+f focuses the project search input
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

  // when task modal opens reset all fields and load branches for that project
  useEffect(() => {
    if (!taskModalProjectId) return
    setTaskTitle('')
    setTaskBaseBranch('')
    setTaskCreateError(null)
    setTaskCreating(false)
    setTaskBranches([])
    setTaskBranchesLoading(true)
    void window.takoyaki.workspace
      .listBranches(taskModalProjectId)
      .then((branches) => {
        setTaskBranches(branches)
        setTaskBaseBranch(branches[0] || '')
      })
      .finally(() => setTaskBranchesLoading(false))
    setTimeout(() => taskTitleRef.current?.focus(), 40)
  }, [taskModalProjectId])

  const openTaskModal = (projectId: string) => {
    setTaskModalProjectId(projectId)
  }

  // creates a git worktree task under the selected project
  const createTask = async () => {
    if (!taskModalProjectId || !taskTitle.trim()) return
    setTaskCreating(true)
    setTaskCreateError(null)
    const result = await window.takoyaki.workspace.createTask(taskModalProjectId, {
      taskTitle: taskTitle.trim(),
      baseBranch: taskBaseBranch || undefined,
    })
    setTaskCreating(false)
    if (!result.ok) {
      setTaskCreateError(result.detail || 'Unable to create task')
      return
    }
    setTaskModalProjectId(null)
  }

  // deletes a git worktree task and its branch if not blocked by uncommitted changes
  const removeTask = async (taskId: string, force: boolean) => {
    setTaskRemoveBusy(true)
    const result = await window.takoyaki.workspace.removeTask(taskId, force)
    setTaskRemoveBusy(false)
    if (result.ok) {
      setConfirmRemoveTask(null)
      return
    }
    if (result.blocked) {
      setConfirmRemoveTask((current) => (current ? { ...current, detail: result.detail, force: true } : current))
      return
    }
    setConfirmRemoveTask((current) => (current ? { ...current, detail: result.detail } : current))
  }

  const handleSelectWorkspace = (workspaceId: string) => {
    void selectWorkspace(workspaceId)
    if (narrow) onRequestClose?.()
  }

  const openInEditor = async (workspaceId: string) => {
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

  if (narrow && !drawerOpen) return null

  const sidebarContent = (
    <div
      className="flex flex-col h-full shrink-0 overflow-hidden transition-[width] duration-200"
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
            onMouseEnter={(e) => {
              e.currentTarget.style.color = colors.textPrimary
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = colors.textMuted
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter projects..."
            className="flex-1 bg-transparent text-[12px] outline-none min-w-0 takoyaki-input"
            style={{ color: colors.textPrimary }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ color: colors.textGhost }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = colors.textSecondary
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = colors.textGhost
              }}
              aria-label="clear project search"
            >
              <X size={sizes.iconSm} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto flex flex-col gap-1.5"
        style={{ padding: '8px 8px 10px', borderTop: `1px solid ${colors.borderSubtle}` }}
      >
        {filtered.map((ws) => {
          const tasks = tasksByProjectId.get(ws.id) || []
          const projectSelected = ws.id === activeId
          const status = getWorkspaceStatus(surfaceStatuses, ws.surfaceIds || [])
          const taskLabel = tasks.length ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}` : null
          const branchLabel = `@${ws.branchName || 'main'}`
          return (
            <div key={ws.id}>
              <div
                onClick={() => handleSelectWorkspace(ws.id)}
                className="group cursor-pointer"
                style={{ padding: '8px 12px' }}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex-shrink-0">
                    <FolderIcon active={projectSelected} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="truncate flex-1 text-[13px] font-semibold"
                        style={{ color: projectSelected ? colors.textPrimary : colors.textSecondary }}
                      >
                        {ws.title}
                      </span>
                      <Tooltip content="New task" side="top">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            openTaskModal(ws.id)
                          }}
                          className="transition-colors duration-[120ms] shrink-0 p-1"
                          style={{ color: colors.textMuted }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = colors.textPrimary
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = colors.textMuted
                          }}
                          aria-label="new task"
                        >
                          <GitBranchIcon size={13} />
                        </button>
                      </Tooltip>
                      <Tooltip content="Open in review" side="top">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void openReview(ws.id)
                            if (narrow) onRequestClose?.()
                          }}
                          className="transition-colors duration-[120ms] shrink-0 p-1"
                          style={{ color: colors.textMuted }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = colors.textPrimary
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = colors.textMuted
                          }}
                          aria-label="open in review"
                        >
                          <Diff size={13} strokeWidth={1.8} />
                        </button>
                      </Tooltip>
                      <Tooltip content="Open in editor" side="top">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            void openInEditor(ws.id)
                          }}
                          className="transition-colors duration-[120ms] shrink-0 p-1"
                          style={{ color: colors.textMuted }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = colors.textPrimary
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = colors.textMuted
                          }}
                          aria-label="open in editor"
                        >
                          <ArrowUpRight size={13} strokeWidth={1.8} />
                        </button>
                      </Tooltip>
                      <Tooltip content="Close project" side="top">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmClose({ id: ws.id, title: ws.title })
                          }}
                          className="transition-colors duration-[120ms] shrink-0 p-1"
                          style={{ color: colors.textMuted }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = colors.error
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = colors.textMuted
                          }}
                          aria-label="close project"
                        >
                          <Trash2 size={13} strokeWidth={1.8} />
                        </button>
                      </Tooltip>
                    </div>
                    <div style={{ marginTop: 2, fontSize: 10, color: colors.textGhost, fontFamily: fonts.mono }}>
                      <div className="flex items-center gap-1">
                        <span>{branchLabel}</span>
                        {status && (
                          <span style={{ marginLeft: 4 }}>
                            <StatusGlyph status={status} />
                          </span>
                        )}
                      </div>
                      {taskLabel && <div style={{ marginTop: 1 }}>{taskLabel}</div>}
                    </div>
                  </div>
                </div>
              </div>

              {tasks.map((task, taskIndex) => {
                const taskSelected = task.id === activeId
                const taskStatus = getWorkspaceStatus(surfaceStatuses, task.surfaceIds || [])
                const isLast = taskIndex === tasks.length - 1
                return (
                  <div
                    key={task.id}
                    className="group/task flex cursor-pointer"
                    style={{ marginLeft: 14 }}
                    onClick={() => {
                      handleSelectWorkspace(task.id)
                    }}
                  >
                    <div style={{ width: 18, flexShrink: 0, position: 'relative' }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: 8,
                          top: 0,
                          height: '50%',
                          width: 1,
                          background: colors.borderSubtle,
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: 8,
                          top: '50%',
                          width: 10,
                          height: 1,
                          background: colors.borderSubtle,
                        }}
                      />
                      {!isLast && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 8,
                            top: '50%',
                            bottom: 0,
                            width: 1,
                            background: colors.borderSubtle,
                          }}
                        />
                      )}
                    </div>
                    <div className="flex items-start gap-2.5" style={{ flex: 1, minWidth: 0, padding: '6px 8px' }}>
                      <div className="mt-0.5 flex-shrink-0">
                        <GitBranchIcon size={13} color={taskSelected ? colors.accentSoft : colors.textMuted} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="truncate flex-1"
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: taskSelected ? colors.textPrimary : colors.textSecondary,
                            }}
                          >
                            {task.title}
                          </span>
                          {taskStatus && <StatusGlyph status={taskStatus} />}
                          <Tooltip content="Open in review" side="top">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                void openReview(task.id)
                                if (narrow) onRequestClose?.()
                              }}
                              className="transition-colors duration-[120ms] shrink-0 p-1"
                              style={{ color: colors.textMuted }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = colors.textPrimary
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = colors.textMuted
                              }}
                              aria-label="open in review"
                            >
                              <Diff size={13} strokeWidth={1.8} />
                            </button>
                          </Tooltip>
                          <Tooltip content="Open in editor" side="top">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                void openInEditor(task.id)
                              }}
                              className="transition-colors duration-[120ms] shrink-0 p-1"
                              style={{ color: colors.textMuted }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = colors.textPrimary
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = colors.textMuted
                              }}
                              aria-label="open in editor"
                            >
                              <ArrowUpRight size={13} strokeWidth={1.8} />
                            </button>
                          </Tooltip>
                          <Tooltip content="Remove task" side="top">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmRemoveTask({ id: task.id, title: task.title, force: false })
                              }}
                              className="transition-colors duration-[120ms] shrink-0"
                              style={{ color: colors.textGhost }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = colors.error
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = colors.textGhost
                              }}
                              aria-label="remove task"
                            >
                              <Trash2 size={13} strokeWidth={1.8} />
                            </button>
                          </Tooltip>
                        </div>
                        <div
                          style={{
                            fontSize: 9,
                            color: taskSelected ? colors.textSecondary : colors.textGhost,
                            fontFamily: fonts.mono,
                            marginTop: 2,
                          }}
                        >
                          task/{task.branchName?.replace('task/', '') || task.title}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      {confirmClose && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'var(--takoyaki-backdrop)' }}
          onClick={() => setConfirmClose(null)}
        >
          <div
            className="flex flex-col gap-4"
            style={{
              background: colors.bg,
              border: `1px solid ${colors.separator}`,
              borderRadius: 12,
              padding: '20px 24px',
              width: 'min(380px, calc(100vw - 24px))',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[13px]" style={{ color: colors.textSecondary }}>
              Close{' '}
              <span className="font-semibold" style={{ color: colors.textPrimary }}>
                "{confirmClose.title}"
              </span>
              ? All terminals in this project will be killed.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmClose(null)}
                className="takoyaki-btn px-4 py-1.5 text-[12px] rounded-md cursor-pointer"
                style={{ ...button.base, color: colors.textSecondary }}
                onMouseEnter={(e) => Object.assign(e.currentTarget.style, button.hover)}
                onMouseLeave={(e) =>
                  Object.assign(e.currentTarget.style, { ...button.base, color: colors.textSecondary })
                }
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  closeWorkspace(confirmClose.id)
                  setConfirmClose(null)
                }}
                className="px-4 py-1.5 text-[12px] rounded-md cursor-pointer transition-colors duration-[120ms]"
                style={{ background: colors.diffDelBg, color: colors.error }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.8'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1'
                }}
              >
                Close project
              </button>
            </div>
          </div>
        </div>
      )}

      {taskModalProjectId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'var(--takoyaki-backdrop)' }}
          onClick={() => setTaskModalProjectId(null)}
        >
          <div
            className="flex flex-col gap-4 rounded-xl"
            style={{
              width: 'min(380px, calc(100vw - 24px))',
              background: colors.bg,
              border: `1px solid ${colors.separator}`,
              padding: '20px 22px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-[13px] font-semibold" style={{ color: colors.textPrimary }}>
                New Task
              </div>
              <div className="mt-1 text-[11px]" style={{ color: colors.textMuted }}>
                Create an isolated worktree and branch under this project.
              </div>
            </div>

            <div
              className="flex items-center gap-2"
              style={{ padding: '8px 10px', borderRadius: 8, background: colors.bgInput, color: colors.textMuted }}
            >
              <GitBranchIcon size={13} />
              <input
                ref={taskTitleRef}
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="task title"
                className="flex-1 bg-transparent text-[12px] outline-none min-w-0 takoyaki-input"
                style={{ color: colors.textPrimary, fontFamily: fonts.mono }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && taskTitle.trim() && !taskCreating) {
                    void createTask()
                  }
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                className="text-[10px] font-semibold"
                style={{ color: colors.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}
              >
                Base Branch
              </label>
              <BranchSelect
                value={taskBaseBranch}
                options={taskBranches}
                disabled={taskBranchesLoading}
                onChange={setTaskBaseBranch}
              />
            </div>

            {taskCreateError && (
              <div className="text-[11px]" style={{ color: colors.error }}>
                {taskCreateError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setTaskModalProjectId(null)}
                className="takoyaki-btn px-3 py-1.5 rounded-md text-[11px] cursor-pointer"
                style={{ ...button.base, color: colors.textSecondary }}
                onMouseEnter={(e) => Object.assign(e.currentTarget.style, button.hover)}
                onMouseLeave={(e) =>
                  Object.assign(e.currentTarget.style, { ...button.base, color: colors.textSecondary })
                }
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void createTask()
                }}
                disabled={!taskTitle.trim() || taskCreating}
                className="takoyaki-btn px-3 py-1.5 rounded-md text-[11px] cursor-pointer disabled:opacity-50"
                style={{ ...button.base, color: colors.textPrimary }}
                onMouseEnter={(e) => {
                  if (!taskCreating) Object.assign(e.currentTarget.style, button.hover)
                }}
                onMouseLeave={(e) =>
                  Object.assign(e.currentTarget.style, { ...button.base, color: colors.textPrimary })
                }
              >
                {taskCreating ? 'Creating...' : 'Create Task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmRemoveTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'var(--takoyaki-backdrop)' }}
          onClick={() => setConfirmRemoveTask(null)}
        >
          <div
            className="flex flex-col gap-4 rounded-xl"
            style={{
              width: 'min(360px, calc(100vw - 24px))',
              background: colors.bg,
              border: `1px solid ${colors.separator}`,
              padding: '20px 22px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[13px] font-semibold" style={{ color: colors.textPrimary }}>
              Remove Task
            </div>
            <div className="text-[12px] leading-5" style={{ color: colors.textSecondary }}>
              {confirmRemoveTask.force
                ? confirmRemoveTask.detail ||
                  `Force remove "${confirmRemoveTask.title}"? The worktree will be deleted but the branch will be kept.`
                : `Remove "${confirmRemoveTask.title}"? The worktree will be deleted but the branch will be kept.`}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmRemoveTask(null)}
                className="takoyaki-btn px-3 py-1.5 rounded-md text-[11px] cursor-pointer"
                style={{ ...button.base, color: colors.textSecondary }}
                onMouseEnter={(e) => Object.assign(e.currentTarget.style, button.hover)}
                onMouseLeave={(e) =>
                  Object.assign(e.currentTarget.style, { ...button.base, color: colors.textSecondary })
                }
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void removeTask(confirmRemoveTask.id, confirmRemoveTask.force)
                }}
                disabled={taskRemoveBusy}
                className="px-3 py-1.5 rounded-md text-[11px] cursor-pointer disabled:opacity-50"
                style={{ background: colors.diffDelBg, color: colors.error }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.8'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1'
                }}
              >
                {taskRemoveBusy ? 'Removing...' : confirmRemoveTask.force ? 'Force Remove' : 'Remove Task'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="px-3 py-3 flex items-center gap-1" style={{ borderTop: `1px solid ${colors.separator}` }}>
        <button
          onClick={() => {
            window.takoyakiOpenSettings?.()
            if (narrow) onRequestClose?.()
          }}
          className="flex-1 flex items-center gap-2 transition-colors duration-[120ms] cursor-pointer px-2 py-2 rounded-lg"
          style={{ color: colors.textMuted }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = colors.textPrimary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = colors.textMuted
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
            onMouseEnter={(e) => {
              e.currentTarget.style.color = colors.textPrimary
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = colors.textMuted
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
