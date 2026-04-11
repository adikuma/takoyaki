import { beforeEach, describe, expect, it, vi } from 'vitest'

type PtyDataCallback = (data: string) => void
type PtyExitCallback = (event: { exitCode: number; signal?: number }) => void

vi.mock('node-pty', () => {
  const EventEmitter = require('events')
  return {
    spawn: vi.fn(() => {
      const emitter = new EventEmitter()
      return {
        pid: 12345,
        onData: (cb: PtyDataCallback) => {
          emitter.on('data', cb)
          return { dispose: () => {} }
        },
        onExit: (cb: PtyExitCallback) => {
          emitter.on('exit', cb)
          return { dispose: () => {} }
        },
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      }
    }),
  }
})

import { TerminalManager } from '../main/terminal'
import { removeTaskWorkspaceAndWorktree } from '../main/task-removal'
import { WorkspaceManager } from '../main/workspace'

describe('removeTaskWorkspaceAndWorktree', () => {
  let terminals: TerminalManager
  let workspaces: WorkspaceManager

  beforeEach(() => {
    terminals = new TerminalManager()
    workspaces = new WorkspaceManager(terminals)
  })

  it('closes the task workspace before removing its worktree and restores it on failure', async () => {
    const project = workspaces.create('project', '/repos/project', '/repos/project', true)
    const task = workspaces.createTask(project.id, 'Task', '/repos/project-task', 'feature/task', 'main')
    expect(task).not.toBeNull()

    const worktreeService = {
      isTaskDirty: vi.fn().mockResolvedValue(false),
      removeTask: vi.fn(async () => {
        expect(workspaces.get(task!.id)).toBeNull()
        return {
          ok: false,
          blocked: false,
          detail:
            'Task worktree is still in use. Close running processes, terminals, or editors using it and try again.',
        }
      }),
    }

    const result = await removeTaskWorkspaceAndWorktree({
      workspaces,
      worktreeService,
      taskId: task!.id,
    })

    expect(result.ok).toBe(false)
    expect(worktreeService.removeTask).toHaveBeenCalledWith('/repos/project', '/repos/project-task', false)
    expect(workspaces.get(task!.id)?.kind).toBe('task')
    expect(workspaces.get(task!.id)?.branchName).toBe('feature/task')
    expect(workspaces.activeWorkspaceId).toBe(task!.id)
  })

  it('keeps the previously active workspace selected when restoring a background task after failure', async () => {
    const project = workspaces.create('project', '/repos/project', '/repos/project', true)
    const task = workspaces.createTask(project.id, 'Task', '/repos/project-task', 'feature/task', 'main')
    const other = workspaces.create('other', '/repos/other', '/repos/other', true)
    workspaces.select(other.id)

    const worktreeService = {
      isTaskDirty: vi.fn().mockResolvedValue(false),
      removeTask: vi.fn().mockResolvedValue({
        ok: false,
        blocked: false,
        detail: 'Task worktree is still in use. Close running processes, terminals, or editors using it and try again.',
      }),
    }

    const result = await removeTaskWorkspaceAndWorktree({
      workspaces,
      worktreeService,
      taskId: task!.id,
    })

    expect(result.ok).toBe(false)
    expect(workspaces.get(task!.id)?.kind).toBe('task')
    expect(workspaces.activeWorkspaceId).toBe(other.id)
  })

  it('keeps the task removed when worktree deletion succeeds', async () => {
    const project = workspaces.create('project', '/repos/project', '/repos/project', true)
    const task = workspaces.createTask(project.id, 'Task', '/repos/project-task', 'feature/task', 'main')

    const worktreeService = {
      isTaskDirty: vi.fn().mockResolvedValue(false),
      removeTask: vi.fn().mockResolvedValue({
        ok: true,
        blocked: false,
        detail: 'Task worktree removed. Branch was kept.',
      }),
    }

    const result = await removeTaskWorkspaceAndWorktree({
      workspaces,
      worktreeService,
      taskId: task!.id,
    })

    expect(result.ok).toBe(true)
    expect(workspaces.get(task!.id)).toBeNull()
  })
})
