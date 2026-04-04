import { describe, expect, it } from 'vitest'
import { getActiveProjectId } from '../renderer/Sidebar'

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
})
