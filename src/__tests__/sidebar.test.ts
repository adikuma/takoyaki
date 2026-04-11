import { describe, expect, it } from 'vitest'
import {
  canUseProjectGitActions,
  getActiveProjectId,
  getProjectBranchLabel,
  getTaskBranchValidationError,
  getTaskTitleValidationError,
  TASK_BRANCH_REQUIRED_ERROR,
  TASK_TITLE_REQUIRED_ERROR,
} from '../renderer/Sidebar'
import { sortProjectsByPinned } from '../renderer/pinned-projects'
import type { Workspace } from '../renderer/types'

function project(id: string, title: string, projectRoot?: string, gitEnabled = true): Workspace {
  return {
    id,
    title,
    kind: 'project',
    parentProjectId: null,
    focusedSurfaceId: null,
    projectRoot,
    gitEnabled,
  }
}

describe('sidebar active project selection', () => {
  it('returns the project id when a top-level project is selected', () => {
    expect(getActiveProjectId({ id: 'project-alpha', parentProjectId: null })).toBe('project-alpha')
  })

  it('returns the parent project id when a task is selected', () => {
    expect(getActiveProjectId({ id: 'task-auth', parentProjectId: 'project-alpha' })).toBe('project-alpha')
  })

  it('returns null when no workspace is selected', () => {
    expect(getActiveProjectId(null)).toBeNull()
  })

  it('shows no git when a project is not backed by git', () => {
    expect(getProjectBranchLabel({ gitEnabled: false, branchName: null })).toBe('no git')
  })

  it('shows the current branch when git is available', () => {
    expect(getProjectBranchLabel({ gitEnabled: true, branchName: 'feature/pins' })).toBe('@feature/pins')
  })

  it('shows detached when git exists without a named branch', () => {
    expect(getProjectBranchLabel({ gitEnabled: true, branchName: null })).toBe('detached')
  })

  it('requires a non-empty task title', () => {
    expect(getTaskTitleValidationError('')).toBe(TASK_TITLE_REQUIRED_ERROR)
    expect(getTaskTitleValidationError('   ')).toBe(TASK_TITLE_REQUIRED_ERROR)
    expect(getTaskTitleValidationError('feature/activate')).toBeNull()
  })

  it('requires a non-empty task branch name', () => {
    expect(getTaskBranchValidationError('')).toBe(TASK_BRANCH_REQUIRED_ERROR)
    expect(getTaskBranchValidationError('   ')).toBe(TASK_BRANCH_REQUIRED_ERROR)
    expect(getTaskBranchValidationError('feature/activate')).toBeNull()
  })

  it('disables git only actions for non git projects', () => {
    expect(canUseProjectGitActions({ kind: 'project', gitEnabled: false })).toBe(false)
    expect(canUseProjectGitActions({ kind: 'project', gitEnabled: true })).toBe(true)
  })

  it('sorts pinned projects to the top while keeping the project order stable', () => {
    const projects = [
      project('project-alpha', 'Alpha', 'C:/Code/Alpha'),
      project('project-beta', 'Beta', 'C:/Code/Beta'),
      project('project-gamma', 'Gamma', 'C:/Code/Gamma'),
    ]

    const sorted = sortProjectsByPinned(projects, ['c:\\code\\gamma', 'c:\\code\\alpha'])

    expect(sorted.map((workspace) => workspace.id)).toEqual(['project-alpha', 'project-gamma', 'project-beta'])
  })

  it('leaves projects without a root in the unpinned bucket', () => {
    const projects = [project('project-alpha', 'Alpha'), project('project-beta', 'Beta', 'C:/Code/Beta')]

    const sorted = sortProjectsByPinned(projects, ['c:\\code\\beta'])

    expect(sorted.map((workspace) => workspace.id)).toEqual(['project-beta', 'project-alpha'])
  })
})
