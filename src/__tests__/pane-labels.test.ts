import { describe, expect, it } from 'vitest'
import { resolvePaneLabels } from '../renderer/pane-labels'
import type { HookSurfaceStatus, TerminalMetadata } from '../renderer/types'
import type { WorkspaceTerminal } from '../renderer/terminal-layout'

function metadata(overrides: Partial<TerminalMetadata>): TerminalMetadata {
  return {
    terminalId: 'term-1',
    cwd: 'C:/Code/project',
    title: null,
    recentCommand: null,
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  }
}

function claudeStatus(): HookSurfaceStatus {
  return {
    activity: 'running',
    attention: 'none',
    lastEventName: 'UserPromptSubmit',
    lastUpdatedAt: Date.now(),
    sessionPresent: true,
    subagentCount: 0,
  }
}

describe('pane labels', () => {
  it('labels Claude panes from Claude surface status', () => {
    const labels = resolvePaneLabels({
      paneLeaves: [{ surfaceId: 'surface-1' }],
      terminalViews: [{ workspaceId: 'ws-1', surfaceId: 'surface-1', terminalId: 'term-1', fontSize: 14 }],
      surfaceStatuses: { 'surface-1': claudeStatus() },
      terminalMetadataById: { 'term-1': metadata({ terminalId: 'term-1' }) },
    })

    expect(labels['surface-1']).toBe('Claude')
  })

  it('labels Codex panes from the tracked command', () => {
    const labels = resolvePaneLabels({
      paneLeaves: [{ surfaceId: 'surface-1' }],
      terminalViews: [{ workspaceId: 'ws-1', surfaceId: 'surface-1', terminalId: 'term-1', fontSize: 14 }],
      surfaceStatuses: {},
      terminalMetadataById: {
        'term-1': metadata({ terminalId: 'term-1', recentCommand: 'codex --approval-mode suggest' }),
      },
    })

    expect(labels['surface-1']).toBe('Codex')
  })

  it('maps common role folders to friendly labels', () => {
    const views: WorkspaceTerminal[] = [
      { workspaceId: 'ws-1', surfaceId: 'surface-front', terminalId: 'term-front', fontSize: 14 },
      { workspaceId: 'ws-1', surfaceId: 'surface-back', terminalId: 'term-back', fontSize: 14 },
    ]
    const labels = resolvePaneLabels({
      paneLeaves: [{ surfaceId: 'surface-front' }, { surfaceId: 'surface-back' }],
      terminalViews: views,
      surfaceStatuses: {},
      terminalMetadataById: {
        'term-front': metadata({ terminalId: 'term-front', cwd: 'C:/Code/project/frontend' }),
        'term-back': metadata({ terminalId: 'term-back', cwd: 'C:/Code/project/api' }),
      },
    })

    expect(labels['surface-front']).toBe('Frontend')
    expect(labels['surface-back']).toBe('Backend')
  })

  it('falls back to a title-cased folder name', () => {
    const labels = resolvePaneLabels({
      paneLeaves: [{ surfaceId: 'surface-1' }],
      terminalViews: [{ workspaceId: 'ws-1', surfaceId: 'surface-1', terminalId: 'term-1', fontSize: 14 }],
      surfaceStatuses: {},
      terminalMetadataById: {
        'term-1': metadata({ terminalId: 'term-1', cwd: 'C:/Code/project/review-service' }),
      },
    })

    expect(labels['surface-1']).toBe('Review Service')
  })

  it('dedupes repeated labels by suffixing later panes', () => {
    const labels = resolvePaneLabels({
      paneLeaves: [{ surfaceId: 'surface-1' }, { surfaceId: 'surface-2' }],
      terminalViews: [
        { workspaceId: 'ws-1', surfaceId: 'surface-1', terminalId: 'term-1', fontSize: 14 },
        { workspaceId: 'ws-1', surfaceId: 'surface-2', terminalId: 'term-2', fontSize: 14 },
      ],
      surfaceStatuses: {},
      terminalMetadataById: {
        'term-1': metadata({ terminalId: 'term-1', recentCommand: 'codex' }),
        'term-2': metadata({ terminalId: 'term-2', recentCommand: 'codex --continue' }),
      },
    })

    expect(labels['surface-1']).toBe('Codex')
    expect(labels['surface-2']).toBe('Codex 2')
  })
})
