export const MANAGED_CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PermissionRequest',
  'Notification',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
] as const

export type ManagedClaudeHookEvent = (typeof MANAGED_CLAUDE_HOOK_EVENTS)[number]

export type ClaudeActivityState = 'idle' | 'running' | 'finished' | 'failed'
export type ClaudeAttentionState = 'none' | 'plan_approval' | 'permission' | 'question' | 'idle_prompt'
export type ClaudeWorkspaceStatusKind = 'attention' | 'running' | 'failed' | 'finished'

export interface ClaudeSurfaceStatus {
  activity: ClaudeActivityState
  attention: ClaudeAttentionState
  lastEventName: string | null
  lastUpdatedAt: number
  sessionPresent: boolean
  subagentCount: number
}

export interface ClaudeRuntimeEvent extends ClaudeSurfaceStatus {
  surfaceId: string
}

export interface ClaudeStatusUpdate {
  status: string
  eventName: string
  notificationType?: string
  toolName?: string
  sessionSource?: string
  subagentType?: string
}

export interface ClaudeWorkspaceStatus {
  kind: ClaudeWorkspaceStatusKind
  attention: ClaudeAttentionState
}

export const CLAUDE_RUNNING_STALE_TTL_MS = 30 * 60 * 1000

const ATTENTION_PRIORITY: Record<ClaudeAttentionState, number> = {
  none: 0,
  idle_prompt: 1,
  question: 2,
  permission: 3,
  plan_approval: 4,
}

function mergeAttention(current: ClaudeAttentionState, next: ClaudeAttentionState): ClaudeAttentionState {
  return ATTENTION_PRIORITY[next] > ATTENTION_PRIORITY[current] ? next : current
}

export function createDefaultClaudeSurfaceStatus(receivedAt = 0): ClaudeSurfaceStatus {
  return {
    activity: 'idle',
    attention: 'none',
    lastEventName: null,
    lastUpdatedAt: receivedAt,
    sessionPresent: false,
    subagentCount: 0,
  }
}

function normalizeLegacyActivity(status: string): ClaudeActivityState | null {
  if (status === 'running' || status === 'finished' || status === 'failed') return status
  return null
}

export function reduceClaudeSurfaceStatus(
  previous: ClaudeSurfaceStatus | undefined,
  update: ClaudeStatusUpdate,
  receivedAt: number,
): ClaudeSurfaceStatus {
  const next = {
    ...(previous || createDefaultClaudeSurfaceStatus(receivedAt)),
    lastEventName: update.eventName || previous?.lastEventName || null,
    lastUpdatedAt: receivedAt,
  }

  switch (update.eventName) {
    case 'SessionStart':
      next.sessionPresent = true
      return next
    case 'UserPromptSubmit':
      next.sessionPresent = true
      next.activity = 'running'
      next.attention = 'none'
      return next
    case 'PermissionRequest':
      next.sessionPresent = true
      next.activity = 'running'
      next.attention = mergeAttention(
        next.attention,
        update.toolName === 'ExitPlanMode' ? 'plan_approval' : 'permission',
      )
      return next
    case 'Notification':
      next.sessionPresent = true
      if (update.notificationType === 'permission_prompt') {
        next.activity = 'running'
        next.attention = mergeAttention(next.attention, 'permission')
      } else if (update.notificationType === 'elicitation_dialog') {
        next.activity = 'running'
        next.attention = mergeAttention(next.attention, 'question')
      } else if (update.notificationType === 'idle_prompt') {
        next.attention = mergeAttention(next.attention, 'idle_prompt')
      }
      return next
    case 'SubagentStart':
      next.sessionPresent = true
      next.activity = 'running'
      next.subagentCount += 1
      return next
    case 'SubagentStop':
      next.sessionPresent = true
      next.subagentCount = Math.max(0, next.subagentCount - 1)
      return next
    case 'Stop':
      next.sessionPresent = true
      next.activity = 'finished'
      next.attention = 'none'
      next.subagentCount = 0
      return next
    case 'StopFailure':
      next.sessionPresent = true
      next.activity = 'failed'
      next.attention = 'none'
      next.subagentCount = 0
      return next
    default: {
      const legacyActivity = normalizeLegacyActivity(update.status)
      if (legacyActivity) next.activity = legacyActivity
      return next
    }
  }
}

export function isAttentionActive(status: ClaudeSurfaceStatus | null | undefined): boolean {
  return Boolean(status && status.attention !== 'none')
}

export function shouldKeepClaudeSurfaceStatus(status: ClaudeSurfaceStatus | null | undefined): boolean {
  if (!status) return false
  if (status.attention !== 'none') return true
  return status.activity === 'running'
}

export function shouldScheduleClaudeRunningExpiry(status: ClaudeSurfaceStatus | null | undefined): boolean {
  return Boolean(status && status.activity === 'running' && status.attention === 'none')
}

export function staleClaudeSurfaceStatus(status: ClaudeSurfaceStatus, receivedAt: number): ClaudeSurfaceStatus {
  return {
    ...status,
    activity: 'idle',
    lastUpdatedAt: receivedAt,
    subagentCount: 0,
  }
}

export function aggregateClaudeWorkspaceStatus(
  surfaceStatuses: Record<string, ClaudeSurfaceStatus>,
  workspaceSurfaceIds: string[],
): ClaudeWorkspaceStatus | null {
  let attention: ClaudeAttentionState = 'none'
  let hasRunning = false
  let hasFailed = false
  let hasFinished = false

  for (const surfaceId of workspaceSurfaceIds) {
    const status = surfaceStatuses[surfaceId]
    if (!status) continue
    attention = mergeAttention(attention, status.attention)
    if (status.activity === 'running') hasRunning = true
    if (status.activity === 'failed') hasFailed = true
    if (status.activity === 'finished') hasFinished = true
  }

  if (attention !== 'none') return { kind: 'attention', attention }
  if (hasRunning) return { kind: 'running', attention: 'none' }
  if (hasFailed) return { kind: 'failed', attention: 'none' }
  return hasFinished ? { kind: 'finished', attention: 'none' } : null
}

export function getClaudeAttentionLabel(attention: ClaudeAttentionState): string | null {
  if (attention === 'plan_approval') return 'Plan approval needed'
  if (attention === 'permission') return 'Permission needed'
  if (attention === 'question') return 'Claude asked a question'
  if (attention === 'idle_prompt') return 'Claude is waiting for input'
  return null
}
