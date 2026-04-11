import { ArrowUpRight, Diff, Pin, Trash2 } from 'lucide-react'
import { aggregateClaudeWorkspaceStatus } from '../../shared/claude-status'
import { colors, fonts, sizes } from '../design'
import { GitBranchIcon } from '../icons'
import { isPinnedProject } from '../pinned-projects'
import type { HookSurfaceStatus, Workspace } from '../types'
import {
  FolderIcon,
  RowActionButton,
  RowActionCluster,
  RowActionMenu,
  type RowMenuItem,
  StatusGlyph,
} from './SidebarPrimitives'
import { canUseProjectGitActions, getProjectBranchLabel } from './sidebar-utils'

interface ProjectTreeProps {
  projects: Workspace[]
  tasksByProjectId: Map<string, Workspace[]>
  activeId: string | null
  surfaceStatuses: Record<string, HookSurfaceStatus>
  pinnedProjectRoots: string[]
  onSelectWorkspace: (workspaceId: string) => void
  onTogglePinnedProject: (projectRoot: string) => void
  onOpenTaskModal: (projectId: string) => void
  onOpenReview: (workspaceId: string) => void
  onOpenInEditor: (workspaceId: string) => void
  onConfirmCloseProject: (project: { id: string; title: string }) => void
  onConfirmRemoveTask: (task: { id: string; title: string }) => void
}

export function ProjectTree({
  projects,
  tasksByProjectId,
  activeId,
  surfaceStatuses,
  pinnedProjectRoots,
  onSelectWorkspace,
  onTogglePinnedProject,
  onOpenTaskModal,
  onOpenReview,
  onOpenInEditor,
  onConfirmCloseProject,
  onConfirmRemoveTask,
}: ProjectTreeProps) {
  return (
    <div
      className="flex-1 overflow-y-auto flex flex-col gap-1.5"
      style={{ padding: '8px 8px 10px', borderTop: `1px solid ${colors.borderSubtle}` }}
    >
      {projects.map((workspace) => (
        <ProjectTreeSection
          key={workspace.id}
          workspace={workspace}
          tasks={tasksByProjectId.get(workspace.id) || []}
          activeId={activeId}
          surfaceStatuses={surfaceStatuses}
          pinnedProjectRoots={pinnedProjectRoots}
          onSelectWorkspace={onSelectWorkspace}
          onTogglePinnedProject={onTogglePinnedProject}
          onOpenTaskModal={onOpenTaskModal}
          onOpenReview={onOpenReview}
          onOpenInEditor={onOpenInEditor}
          onConfirmCloseProject={onConfirmCloseProject}
          onConfirmRemoveTask={onConfirmRemoveTask}
        />
      ))}
    </div>
  )
}

function ProjectTreeSection({
  workspace,
  tasks,
  activeId,
  surfaceStatuses,
  pinnedProjectRoots,
  onSelectWorkspace,
  onTogglePinnedProject,
  onOpenTaskModal,
  onOpenReview,
  onOpenInEditor,
  onConfirmCloseProject,
  onConfirmRemoveTask,
}: {
  workspace: Workspace
  tasks: Workspace[]
  activeId: string | null
  surfaceStatuses: Record<string, HookSurfaceStatus>
  pinnedProjectRoots: string[]
  onSelectWorkspace: (workspaceId: string) => void
  onTogglePinnedProject: (projectRoot: string) => void
  onOpenTaskModal: (projectId: string) => void
  onOpenReview: (workspaceId: string) => void
  onOpenInEditor: (workspaceId: string) => void
  onConfirmCloseProject: (project: { id: string; title: string }) => void
  onConfirmRemoveTask: (task: { id: string; title: string }) => void
}) {
  const projectSelected = workspace.id === activeId
  const projectRoot = workspace.projectRoot || null
  const gitEnabled = canUseProjectGitActions(workspace)
  const projectPinned = isPinnedProject(workspace.projectRoot, pinnedProjectRoots)
  const status = aggregateClaudeWorkspaceStatus(surfaceStatuses, workspace.surfaceIds || [])
  const taskLabel = tasks.length ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}` : null
  const branchLabel = getProjectBranchLabel(workspace)
  const projectMenuItems: RowMenuItem[] = [
    {
      label: 'New task',
      icon: <GitBranchIcon size={sizes.iconSm} />,
      disabled: !gitEnabled,
      hint: !gitEnabled ? 'git required' : undefined,
      onSelect: () => {
        if (!gitEnabled) return
        onOpenTaskModal(workspace.id)
      },
    },
    {
      label: 'Open in review',
      icon: <Diff size={sizes.iconSm} strokeWidth={1.8} />,
      disabled: !gitEnabled,
      hint: !gitEnabled ? 'git required' : undefined,
      onSelect: () => {
        if (!gitEnabled) return
        onOpenReview(workspace.id)
      },
    },
    {
      label: 'Open in editor',
      icon: <ArrowUpRight size={sizes.iconSm} strokeWidth={1.8} />,
      onSelect: () => {
        onOpenInEditor(workspace.id)
      },
    },
    {
      label: 'Close project',
      icon: <Trash2 size={sizes.iconSm} strokeWidth={1.8} />,
      danger: true,
      onSelect: () => {
        onConfirmCloseProject({ id: workspace.id, title: workspace.title })
      },
    },
  ]

  return (
    <div>
      <div
        onClick={() => onSelectWorkspace(workspace.id)}
        className="group cursor-pointer"
        style={{ padding: '10px 14px' }}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex-shrink-0">
            <FolderIcon active={projectSelected} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className="truncate flex-1 text-[13px] font-semibold"
                style={{ color: projectSelected ? colors.textPrimary : colors.textSecondary }}
              >
                {workspace.title}
              </span>
              <RowActionCluster>
                {projectRoot && (
                  <RowActionButton
                    label={projectPinned ? 'Unpin project' : 'Pin project'}
                    active={projectPinned}
                    onClick={(event) => {
                      event.stopPropagation()
                      onTogglePinnedProject(projectRoot)
                    }}
                  >
                    <Pin size={sizes.iconSm} strokeWidth={1.8} />
                  </RowActionButton>
                )}
                <RowActionMenu label="Project actions" items={projectMenuItems} />
              </RowActionCluster>
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

      {tasks.map((task, taskIndex) => (
        <TaskRow
          key={task.id}
          task={task}
          isLast={taskIndex === tasks.length - 1}
          activeId={activeId}
          surfaceStatuses={surfaceStatuses}
          onSelectWorkspace={onSelectWorkspace}
          onOpenReview={onOpenReview}
          onOpenInEditor={onOpenInEditor}
          onConfirmRemoveTask={onConfirmRemoveTask}
        />
      ))}
    </div>
  )
}

function TaskRow({
  task,
  isLast,
  activeId,
  surfaceStatuses,
  onSelectWorkspace,
  onOpenReview,
  onOpenInEditor,
  onConfirmRemoveTask,
}: {
  task: Workspace
  isLast: boolean
  activeId: string | null
  surfaceStatuses: Record<string, HookSurfaceStatus>
  onSelectWorkspace: (workspaceId: string) => void
  onOpenReview: (workspaceId: string) => void
  onOpenInEditor: (workspaceId: string) => void
  onConfirmRemoveTask: (task: { id: string; title: string }) => void
}) {
  const taskSelected = task.id === activeId
  const taskStatus = aggregateClaudeWorkspaceStatus(surfaceStatuses, task.surfaceIds || [])
  const taskMenuItems: RowMenuItem[] = [
    {
      label: 'Open in review',
      icon: <Diff size={sizes.iconSm} strokeWidth={1.8} />,
      onSelect: () => {
        onOpenReview(task.id)
      },
    },
    {
      label: 'Open in editor',
      icon: <ArrowUpRight size={sizes.iconSm} strokeWidth={1.8} />,
      onSelect: () => {
        onOpenInEditor(task.id)
      },
    },
    {
      label: 'Remove task',
      icon: <Trash2 size={sizes.iconSm} strokeWidth={1.8} />,
      danger: true,
      onSelect: () => {
        onConfirmRemoveTask({ id: task.id, title: task.title })
      },
    },
  ]

  return (
    <div
      className="group/task flex cursor-pointer"
      style={{ marginLeft: 14 }}
      onClick={() => {
        onSelectWorkspace(task.id)
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
            background: colors.separator,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 8,
            top: '50%',
            width: 10,
            height: 1,
            background: colors.separator,
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
              background: colors.separator,
            }}
          />
        )}
      </div>
      <div className="flex items-start gap-2.5" style={{ flex: 1, minWidth: 0, padding: '8px 10px' }}>
        <div className="mt-0.5 flex-shrink-0">
          <GitBranchIcon size={sizes.iconSm} color={taskSelected ? colors.accentSoft : colors.textMuted} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
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
            <RowActionCluster>
              <RowActionMenu label="Task actions" items={taskMenuItems} />
            </RowActionCluster>
          </div>
          <div
            style={{
              fontSize: 9,
              color: taskSelected ? colors.textSecondary : colors.textGhost,
              fontFamily: fonts.mono,
              marginTop: 2,
            }}
          >
            <div className="flex items-center gap-1">
              <span>{getProjectBranchLabel(task)}</span>
              {taskStatus && (
                <span style={{ marginLeft: 4 }}>
                  <StatusGlyph status={taskStatus} />
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
