export type ActivityOperationStatus = 'running' | 'success' | 'failed' | 'blocked'

export type ActivityOperationKind = 'git' | 'browser' | 'editor' | 'hooks' | 'workspace'

export interface ActivityOperation {
  id: string
  kind: ActivityOperationKind
  title: string
  detail: string | null
  status: ActivityOperationStatus
  startedAt: number
  updatedAt: number
  workspaceId?: string
}

export interface StartActivityOperationInput {
  kind: ActivityOperationKind
  title: string
  detail?: string | null
  workspaceId?: string
}

export interface UpdateActivityOperationInput {
  title?: string
  detail?: string | null
  status?: ActivityOperationStatus
  workspaceId?: string
}

export function createActivityOperationId(kind: ActivityOperationKind): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
