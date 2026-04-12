import type { RemoveTaskResult } from './git-worktree'
import type { WorkspaceManager } from './workspace'

interface TaskRemovalTask {
  id: string
  kind: 'project' | 'task'
  parentProjectId: string | null
  workingDirectory: string
  projectRoot: string
}

interface TaskRemovalWorktreeService {
  isTaskDirty(worktreePath: string): Promise<boolean>
  removeTask(projectRoot: string, worktreePath: string, force?: boolean): Promise<RemoveTaskResult>
}

interface TaskRemovalDeps {
  workspaces: WorkspaceManager
  worktreeService: TaskRemovalWorktreeService
  taskId: string
  force?: boolean
}

// closes a task workspace first and then removes its worktree so windows file locks do not block cleanup
export async function removeTaskWorkspaceAndWorktree({
  workspaces,
  worktreeService,
  taskId,
  force = false,
}: TaskRemovalDeps): Promise<RemoveTaskResult> {
  const task = workspaces.get(taskId) as TaskRemovalTask | null
  if (!task || task.kind !== 'task' || !task.parentProjectId) {
    return { ok: false, blocked: false, detail: 'Task not found' }
  }

  const parentProject = workspaces.get(task.parentProjectId) as TaskRemovalTask | null
  if (!parentProject) {
    return { ok: false, blocked: false, detail: 'Parent project not found' }
  }

  const worktreePath = task.workingDirectory || ''
  const projectRoot = parentProject.projectRoot || parentProject.workingDirectory || ''

  const isDirty = await worktreeService.isTaskDirty(worktreePath)
  if (isDirty && !force) {
    return {
      ok: false,
      blocked: true,
      detail: 'Task has uncommitted changes. Force remove to delete the worktree.',
    }
  }

  const snapshot = workspaces.snapshotWorkspace(taskId)
  const previousActiveWorkspaceId = workspaces.activeWorkspaceId
  if (!workspaces.close(taskId)) {
    return {
      ok: false,
      blocked: false,
      detail: 'Task workspace could not be closed before removal.',
    }
  }

  const removal = await worktreeService.removeTask(projectRoot, worktreePath, force)
  if (removal.ok) return removal

  if (snapshot) {
    workspaces.restoreWorkspace(snapshot)
    if (
      previousActiveWorkspaceId &&
      previousActiveWorkspaceId !== taskId &&
      workspaces.get(previousActiveWorkspaceId)
    ) {
      workspaces.select(previousActiveWorkspaceId)
    }
  }

  return removal
}
