import type { PaneTree, Workspace } from './types'

export interface PaneLeaf {
  surfaceId: string
  terminalId: string
  fontSize: number
}

export interface WorkspaceTerminal extends PaneLeaf {
  workspaceId: string
}

export interface TerminalFrame {
  top: number
  left: number
  width: number
  height: number
}

export const MAX_HIDDEN_MOUNTED_WORKSPACES = 0

// flatten the pane tree so the terminal stage can track live terminals by id
export function collectLeaves(tree: PaneTree): PaneLeaf[] {
  if (tree.type === 'leaf') {
    return [{ surfaceId: tree.surfaceId, terminalId: tree.terminalId, fontSize: tree.fontSize }]
  }
  return [...collectLeaves(tree.first), ...collectLeaves(tree.second)]
}

export function collectWorkspaceTerminals(
  workspaces: Workspace[],
  workspaceTrees: Record<string, PaneTree | null | undefined>,
): WorkspaceTerminal[] {
  const terminals: WorkspaceTerminal[] = []

  for (const workspace of workspaces) {
    const tree = workspaceTrees[workspace.id]
    if (!tree) continue

    // keep layout discovery separate from terminal rendering so pane changes stay cheap
    for (const leaf of collectLeaves(tree)) {
      terminals.push({
        workspaceId: workspace.id,
        surfaceId: leaf.surfaceId,
        terminalId: leaf.terminalId,
        fontSize: leaf.fontSize,
      })
    }
  }

  return terminals
}

// keep mounted workspace order stable so we can bound hidden renderer terminals later
export function reconcileMountedWorkspaceIds({
  currentWorkspaceIds,
  currentMountedWorkspaceIds,
  activeWorkspaceId,
  maxHiddenWorkspaceCount = MAX_HIDDEN_MOUNTED_WORKSPACES,
}: {
  currentWorkspaceIds: string[]
  currentMountedWorkspaceIds: string[]
  activeWorkspaceId: string | null
  maxHiddenWorkspaceCount?: number
}): string[] {
  const validWorkspaceIdSet = new Set(currentWorkspaceIds)
  const boundedHiddenWorkspaceCount = Math.max(0, maxHiddenWorkspaceCount)
  const hiddenWorkspaceIds = currentMountedWorkspaceIds.filter(
    (workspaceId) => workspaceId !== activeWorkspaceId && validWorkspaceIdSet.has(workspaceId),
  )
  const boundedHiddenWorkspaceIds =
    boundedHiddenWorkspaceCount === 0
      ? []
      : hiddenWorkspaceIds.length > boundedHiddenWorkspaceCount
        ? hiddenWorkspaceIds.slice(-boundedHiddenWorkspaceCount)
        : hiddenWorkspaceIds

  if (
    activeWorkspaceId &&
    validWorkspaceIdSet.has(activeWorkspaceId) &&
    !boundedHiddenWorkspaceIds.includes(activeWorkspaceId)
  ) {
    return [...boundedHiddenWorkspaceIds, activeWorkspaceId]
  }

  return boundedHiddenWorkspaceIds
}

// flatten only the workspaces we are willing to keep mounted in the renderer
export function collectMountedWorkspaceTerminals(
  mountedWorkspaceIds: string[],
  workspaceTrees: Record<string, PaneTree | null | undefined>,
): WorkspaceTerminal[] {
  const terminals: WorkspaceTerminal[] = []

  for (const workspaceId of mountedWorkspaceIds) {
    const tree = workspaceTrees[workspaceId]
    if (!tree) continue

    for (const leaf of collectLeaves(tree)) {
      terminals.push({
        workspaceId,
        surfaceId: leaf.surfaceId,
        terminalId: leaf.terminalId,
        fontSize: leaf.fontSize,
      })
    }
  }

  return terminals
}

// avoid rerender work when the measured terminal frames have not actually changed
// compare measured frames structurally so pane layout updates only rerender when geometry changes
export function equalTerminalFrames(
  first: Record<string, TerminalFrame>,
  second: Record<string, TerminalFrame>,
): boolean {
  const firstKeys = Object.keys(first)
  const secondKeys = Object.keys(second)
  if (firstKeys.length !== secondKeys.length) return false

  for (const key of firstKeys) {
    const firstFrame = first[key]
    const secondFrame = second[key]
    if (!secondFrame) return false
    if (
      firstFrame.top !== secondFrame.top ||
      firstFrame.left !== secondFrame.left ||
      firstFrame.width !== secondFrame.width ||
      firstFrame.height !== secondFrame.height
    ) {
      return false
    }
  }

  return true
}
