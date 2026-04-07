import { describe, expect, it } from 'vitest'
import { collectLeaves, collectWorkspaceTerminals, equalTerminalFrames } from '../renderer/terminal-layout'
import type { PaneTree, Workspace } from '../renderer/types'

describe('terminal layout helpers', () => {
  const tree: PaneTree = {
    type: 'split',
    direction: 'horizontal',
    first: { type: 'leaf', surfaceId: 'surface-a', terminalId: 'terminal-a' },
    second: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', surfaceId: 'surface-b', terminalId: 'terminal-b' },
      second: { type: 'leaf', surfaceId: 'surface-c', terminalId: 'terminal-c' },
    },
  }

  it('collects leaf terminals in tree order', () => {
    expect(collectLeaves(tree)).toEqual([
      { surfaceId: 'surface-a', terminalId: 'terminal-a' },
      { surfaceId: 'surface-b', terminalId: 'terminal-b' },
      { surfaceId: 'surface-c', terminalId: 'terminal-c' },
    ])
  })

  it('collects terminals for workspaces with cached trees only', () => {
    const workspaces: Workspace[] = [
      { id: 'project-1', title: 'project-1', kind: 'project', parentProjectId: null, focusedSurfaceId: null },
      { id: 'project-2', title: 'project-2', kind: 'project', parentProjectId: null, focusedSurfaceId: null },
    ]

    expect(
      collectWorkspaceTerminals(workspaces, {
        'project-1': tree,
        'project-2': null,
      }),
    ).toEqual([
      { workspaceId: 'project-1', surfaceId: 'surface-a', terminalId: 'terminal-a' },
      { workspaceId: 'project-1', surfaceId: 'surface-b', terminalId: 'terminal-b' },
      { workspaceId: 'project-1', surfaceId: 'surface-c', terminalId: 'terminal-c' },
    ])
  })

  it('compares terminal frame maps by geometry', () => {
    const first = {
      'surface-a': { top: 10, left: 20, width: 300, height: 200 },
      'surface-b': { top: 10, left: 340, width: 300, height: 200 },
    }
    const second = {
      'surface-a': { top: 10, left: 20, width: 300, height: 200 },
      'surface-b': { top: 10, left: 340, width: 300, height: 200 },
    }
    const third = {
      'surface-a': { top: 10, left: 20, width: 300, height: 200 },
      'surface-b': { top: 11, left: 340, width: 300, height: 200 },
    }

    expect(equalTerminalFrames(first, second)).toBe(true)
    expect(equalTerminalFrames(first, third)).toBe(false)
  })
})
