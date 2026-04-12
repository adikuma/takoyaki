import type { Workspace } from './types'

// keeps renderer side pin matching aligned with persisted preferences
export function normalizePinnedProjectRoot(projectRoot: string): string {
  const trimmed = projectRoot.trim()
  if (!trimmed) return ''

  let normalized = trimmed.replace(/\//g, '\\')
  if (normalized.length > 3) normalized = normalized.replace(/[\\/]+$/, '')
  if (/^[A-Za-z]:\\/.test(normalized)) normalized = normalized.toLowerCase()
  return normalized
}

// checks pin membership after normalizing path differences from windows paths
export function isPinnedProject(projectRoot: string | undefined, pinnedProjectRoots: readonly string[]): boolean {
  if (!projectRoot) return false
  const normalized = normalizePinnedProjectRoot(projectRoot)
  return pinnedProjectRoots.includes(normalized)
}

// lifts pinned projects to the top without reordering items inside each bucket
export function sortProjectsByPinned(projects: Workspace[], pinnedProjectRoots: readonly string[]): Workspace[] {
  const pinned: Workspace[] = []
  const unpinned: Workspace[] = []

  for (const project of projects) {
    if (isPinnedProject(project.projectRoot, pinnedProjectRoots)) pinned.push(project)
    else unpinned.push(project)
  }

  return [...pinned, ...unpinned]
}
