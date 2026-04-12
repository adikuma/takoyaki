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

// start every surface from an idle status so later hook events can layer on cleanly
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

// map older running or finished updates into the newer activity model
function normalizeLegacyActivity(status: string): ClaudeActivityState | null {
  if (status === 'running' || status === 'finished' || status === 'failed') return status
  return null
}

// fold one claude hook update into the current surface runtime status
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

// treat any active attention value as a user facing interruption
export function isAttentionActive(status: ClaudeSurfaceStatus | null | undefined): boolean {
  return Boolean(status && status.attention !== 'none')
}

// keep only statuses that still matter after the latest event stream quiets down
export function shouldKeepClaudeSurfaceStatus(status: ClaudeSurfaceStatus | null | undefined): boolean {
  if (!status) return false
  if (status.attention !== 'none') return true
  return status.activity === 'running'
}

// schedule a stale running cleanup only for panes that are active without pending attention
export function shouldScheduleClaudeRunningExpiry(status: ClaudeSurfaceStatus | null | undefined): boolean {
  return Boolean(status && status.activity === 'running' && status.attention === 'none')
}

// downgrade abandoned running panes back to idle after the stale timeout
export function staleClaudeSurfaceStatus(status: ClaudeSurfaceStatus, receivedAt: number): ClaudeSurfaceStatus {
  return {
    ...status,
    activity: 'idle',
    lastUpdatedAt: receivedAt,
    subagentCount: 0,
  }
}

// roll surface level claude state up into one workspace status for the sidebar
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

// convert the attention enum into human facing copy for tooltips
export function getClaudeAttentionLabel(attention: ClaudeAttentionState): string | null {
  if (attention === 'plan_approval') return 'Plan approval needed'
  if (attention === 'permission') return 'Permission needed'
  if (attention === 'question') return 'Claude asked a question'
  if (attention === 'idle_prompt') return 'Claude is waiting for input'
  return null
}
