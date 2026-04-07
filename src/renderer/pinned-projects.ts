import type { Workspace } from './types'

// keep project pin matching consistent with the persisted preferences data
export function normalizePinnedProjectRoot(projectRoot: string): string {
  const trimmed = projectRoot.trim()
  if (!trimmed) return ''

  let normalized = trimmed.replace(/\//g, '\\')
  if (normalized.length > 3) normalized = normalized.replace(/[\\/]+$/, '')
  if (/^[A-Za-z]:\\/.test(normalized)) normalized = normalized.toLowerCase()
  return normalized
}

export function isPinnedProject(projectRoot: string | undefined, pinnedProjectRoots: readonly string[]): boolean {
  if (!projectRoot) return false
  const normalized = normalizePinnedProjectRoot(projectRoot)
  return pinnedProjectRoots.includes(normalized)
}

// sort pinned projects to the top without disturbing the order inside each bucket
export function sortProjectsByPinned(projects: Workspace[], pinnedProjectRoots: readonly string[]): Workspace[] {
  const pinned: Workspace[] = []
  const unpinned: Workspace[] = []

  for (const project of projects) {
    if (isPinnedProject(project.projectRoot, pinnedProjectRoots)) pinned.push(project)
    else unpinned.push(project)
  }

  return [...pinned, ...unpinned]
}
