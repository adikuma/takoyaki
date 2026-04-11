import type { Workspace } from '../types'

// if active workspace is a task return its parent project id otherwise return its own id
export function getActiveProjectId(activeWorkspace: Pick<Workspace, 'id' | 'parentProjectId'> | null): string | null {
  if (!activeWorkspace) return null
  return activeWorkspace.parentProjectId || activeWorkspace.id
}

export function canUseProjectGitActions(workspace: Pick<Workspace, 'kind' | 'gitEnabled'>): boolean {
  return workspace.kind === 'project' && Boolean(workspace.gitEnabled)
}

// say no git for plain folders and detached when git exists without a branch name
export function getProjectBranchLabel(workspace: Pick<Workspace, 'gitEnabled' | 'branchName'>): string {
  if (!workspace.gitEnabled) return 'no git'
  return workspace.branchName ? `@${workspace.branchName}` : 'detached'
}

export const TASK_TITLE_REQUIRED_ERROR = 'Task name is required.'
export const TASK_BRANCH_REQUIRED_ERROR = 'Branch name is required.'

export function getTaskTitleValidationError(taskTitle: string): string | null {
  return taskTitle.trim() ? null : TASK_TITLE_REQUIRED_ERROR
}

export function getTaskBranchValidationError(branchName: string): string | null {
  return branchName.trim() ? null : TASK_BRANCH_REQUIRED_ERROR
}
