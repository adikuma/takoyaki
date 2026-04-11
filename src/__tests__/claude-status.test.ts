import { describe, expect, it } from 'vitest'
import {
  aggregateClaudeWorkspaceStatus,
  createDefaultClaudeSurfaceStatus,
  getClaudeAttentionLabel,
  reduceClaudeSurfaceStatus,
} from '../shared/claude-status'

describe('claude status reducer', () => {
  it('marks prompt submit as running and clears attention', () => {
    const previous = {
      ...createDefaultClaudeSurfaceStatus(1),
      activity: 'finished' as const,
      attention: 'permission' as const,
    }

    const next = reduceClaudeSurfaceStatus(previous, { status: 'running', eventName: 'UserPromptSubmit' }, 2)

    expect(next.activity).toBe('running')
    expect(next.attention).toBe('none')
  })

  it('treats ExitPlanMode permission requests as plan approval', () => {
    const next = reduceClaudeSurfaceStatus(
      createDefaultClaudeSurfaceStatus(1),
      { status: 'running', eventName: 'PermissionRequest', toolName: 'ExitPlanMode' },
      2,
    )

    expect(next.activity).toBe('running')
    expect(next.attention).toBe('plan_approval')
  })

  it('does not downgrade plan approval on a generic permission notification', () => {
    const previous = reduceClaudeSurfaceStatus(
      createDefaultClaudeSurfaceStatus(1),
      { status: 'running', eventName: 'PermissionRequest', toolName: 'ExitPlanMode' },
      2,
    )

    const next = reduceClaudeSurfaceStatus(
      previous,
      { status: 'running', eventName: 'Notification', notificationType: 'permission_prompt' },
      3,
    )

    expect(next.attention).toBe('plan_approval')
  })

  it('maps elicitation notifications to question attention', () => {
    const next = reduceClaudeSurfaceStatus(
      createDefaultClaudeSurfaceStatus(1),
      { status: 'running', eventName: 'Notification', notificationType: 'elicitation_dialog' },
      2,
    )

    expect(next.attention).toBe('question')
  })

  it('tracks subagent counts across start and stop', () => {
    const started = reduceClaudeSurfaceStatus(
      createDefaultClaudeSurfaceStatus(1),
      { status: 'running', eventName: 'SubagentStart', subagentType: 'Plan' },
      2,
    )
    const stopped = reduceClaudeSurfaceStatus(
      started,
      { status: 'running', eventName: 'SubagentStop', subagentType: 'Plan' },
      3,
    )

    expect(started.subagentCount).toBe(1)
    expect(stopped.subagentCount).toBe(0)
  })

  it('marks stop failure as failed and clears attention', () => {
    const previous = reduceClaudeSurfaceStatus(
      createDefaultClaudeSurfaceStatus(1),
      { status: 'running', eventName: 'PermissionRequest', toolName: 'ExitPlanMode' },
      2,
    )

    const next = reduceClaudeSurfaceStatus(previous, { status: 'failed', eventName: 'StopFailure' }, 3)

    expect(next.activity).toBe('failed')
    expect(next.attention).toBe('none')
    expect(next.subagentCount).toBe(0)
  })
})

describe('claude workspace aggregation', () => {
  it('prioritizes attention over running', () => {
    const status = aggregateClaudeWorkspaceStatus(
      {
        one: reduceClaudeSurfaceStatus(
          createDefaultClaudeSurfaceStatus(1),
          { status: 'running', eventName: 'UserPromptSubmit' },
          2,
        ),
        two: reduceClaudeSurfaceStatus(
          createDefaultClaudeSurfaceStatus(1),
          { status: 'running', eventName: 'PermissionRequest', toolName: 'ExitPlanMode' },
          3,
        ),
      },
      ['one', 'two'],
    )

    expect(status).toEqual({ kind: 'attention', attention: 'plan_approval' })
  })

  it('falls back to failed then finished when there is no attention', () => {
    const failed = reduceClaudeSurfaceStatus(
      createDefaultClaudeSurfaceStatus(1),
      { status: 'failed', eventName: 'StopFailure' },
      2,
    )
    const finished = reduceClaudeSurfaceStatus(
      createDefaultClaudeSurfaceStatus(1),
      { status: 'finished', eventName: 'Stop' },
      3,
    )

    expect(aggregateClaudeWorkspaceStatus({ one: failed, two: finished }, ['one', 'two'])).toEqual({
      kind: 'failed',
      attention: 'none',
    })
  })

  it('returns the expected labels for attention states', () => {
    expect(getClaudeAttentionLabel('plan_approval')).toBe('Plan approval needed')
    expect(getClaudeAttentionLabel('permission')).toBe('Permission needed')
    expect(getClaudeAttentionLabel('question')).toBe('Claude asked a question')
    expect(getClaudeAttentionLabel('idle_prompt')).toBe('Claude is waiting for input')
  })
})
