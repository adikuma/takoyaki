import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const testState = vi.hoisted(() => ({
  home: require('path').join(process.cwd(), '.tmp-plan-home'),
}))

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => testState.home }
})

import { PlanService, resolveLatestPlanRecord } from '../main/plan'

const transcriptPath = path.join(testState.home, '.claude', 'projects', 'demo', 'session.jsonl')
const mainPlanPath = path.join(testState.home, '.claude', 'plans', 'steady-orbit.md')
const agentPlanPath = path.join(testState.home, '.claude', 'plans', 'steady-orbit-agent-a1.md')
const workspacePath = path.join(testState.home, 'workspace', 'steady-orbit')
const encodedWorkspacePath = workspacePath.replace(/[:\\/]/g, '-')
const workspaceTranscriptDirectory = path.join(testState.home, '.claude', 'projects', encodedWorkspacePath)

function writeTranscript(lines: unknown[]): void {
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true })
  fs.writeFileSync(transcriptPath, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf-8')
}

function writeWorkspaceTranscript(fileName: string, lines: unknown[]): string {
  const nextPath = path.join(workspaceTranscriptDirectory, fileName)
  fs.mkdirSync(path.dirname(nextPath), { recursive: true })
  fs.writeFileSync(nextPath, lines.map((line) => JSON.stringify(line)).join('\n'), 'utf-8')
  return nextPath
}

describe('plan service', () => {
  beforeEach(() => {
    fs.rmSync(testState.home, { recursive: true, force: true })
  })

  afterEach(() => {
    fs.rmSync(testState.home, { recursive: true, force: true })
  })

  it('resolves the latest main-session plan write from a transcript tail', () => {
    writeTranscript([
      {
        slug: 'steady-orbit',
        timestamp: '2026-04-06T10:00:00.000Z',
        toolUseResult: {
          filePath: agentPlanPath,
          content: '# agent plan',
        },
      },
      {
        slug: 'steady-orbit',
        timestamp: '2026-04-06T10:01:00.000Z',
        toolUseResult: {
          filePath: mainPlanPath,
          content: '# main plan',
        },
      },
    ])

    const record = resolveLatestPlanRecord(transcriptPath)

    expect(record).not.toBeNull()
    expect(record?.slug).toBe('steady-orbit')
    expect(record?.sourcePath).toBe(mainPlanPath)
    expect(record?.markdownFallback).toContain('main plan')
  })

  it('resolves a plan from the real assistant write tool shape', () => {
    writeTranscript([
      {
        slug: 'steady-orbit',
        timestamp: '2026-04-06T10:02:00.000Z',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: {
                file_path: mainPlanPath,
                content: '# real plan shape',
              },
            },
          ],
        },
      },
    ])

    const record = resolveLatestPlanRecord(transcriptPath)

    expect(record).not.toBeNull()
    expect(record?.slug).toBe('steady-orbit')
    expect(record?.sourcePath).toBe(mainPlanPath)
    expect(record?.markdownFallback).toContain('real plan shape')
  })

  it('resolves a plan from exit plan mode tool payloads', () => {
    writeTranscript([
      {
        slug: 'steady-orbit',
        timestamp: '2026-04-06T10:03:00.000Z',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'ExitPlanMode',
              input: {
                planFilePath: mainPlanPath,
                plan: '# exit plan mode shape',
              },
            },
          ],
        },
      },
    ])

    const record = resolveLatestPlanRecord(transcriptPath)

    expect(record).not.toBeNull()
    expect(record?.slug).toBe('steady-orbit')
    expect(record?.sourcePath).toBe(mainPlanPath)
    expect(record?.markdownFallback).toContain('exit plan mode shape')
  })

  it('loads markdown lazily from the detected plan file', async () => {
    fs.mkdirSync(path.dirname(mainPlanPath), { recursive: true })
    fs.writeFileSync(mainPlanPath, '# rendered plan\n\nhello world', 'utf-8')
    writeTranscript([
      {
        slug: 'steady-orbit',
        timestamp: '2026-04-06T10:01:00.000Z',
        toolUseResult: {
          filePath: mainPlanPath,
          content: '# fallback plan',
        },
      },
    ])

    const service = new PlanService()
    service.noteSurfaceSession('surface-1', {
      transcriptPath,
      permissionMode: 'plan',
    })

    await service.handleStatusUpdate('surface-1', 'workspace-1', 'finished')
    const snapshot = await service.getSnapshot({ workspaceId: 'workspace-1' })

    expect(snapshot?.markdown).toContain('rendered plan')
    expect(snapshot?.sourcePath).toBe(mainPlanPath)
  })

  it('tracks active Claude surfaces by session lifecycle events', () => {
    const service = new PlanService()

    service.noteSurfaceSession('surface-1', {
      sessionId: 'session-1',
      transcriptPath,
      cwd: workspacePath,
    })

    expect(service.noteSurfaceEvent('surface-1', 'SessionStart')).toBe(true)
    expect(service.getActiveSurfaceIds()).toEqual(['surface-1'])
    expect(service.noteSurfaceEvent('surface-1', 'Stop')).toBe(false)
    expect(service.noteSurfaceEvent('surface-1', 'SessionEnd')).toBe(true)
    expect(service.getActiveSurfaceIds()).toEqual([])
  })

  it('prunes stale active surfaces when panes disappear', () => {
    const service = new PlanService()

    service.noteSurfaceSession('surface-1', {
      sessionId: 'session-1',
      transcriptPath,
      cwd: workspacePath,
    })
    service.noteSurfaceEvent('surface-1', 'SessionStart')

    expect(service.pruneSurfaceIds(['surface-2'])).toBe(true)
    expect(service.getActiveSurfaceIds()).toEqual([])
  })

  it('resolves the latest plan on demand from the workspace transcript directory', async () => {
    fs.mkdirSync(path.dirname(mainPlanPath), { recursive: true })
    fs.writeFileSync(mainPlanPath, '# on demand plan', 'utf-8')
    writeWorkspaceTranscript('session-a.jsonl', [
      {
        slug: 'steady-orbit',
        timestamp: '2026-04-06T10:04:00.000Z',
        toolUseResult: {
          filePath: mainPlanPath,
          content: '# on demand fallback',
        },
      },
    ])

    const service = new PlanService()
    const snapshot = await service.getSnapshot({
      workspaceId: 'workspace-2',
      workingDirectory: workspacePath,
    })

    expect(snapshot).not.toBeNull()
    expect(snapshot?.markdown).toContain('on demand plan')
    expect(snapshot?.sourcePath).toBe(mainPlanPath)
  })
})
