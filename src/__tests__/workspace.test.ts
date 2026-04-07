import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

type PtyDataCallback = (data: string) => void
type PtyExitCallback = (event: { exitCode: number; signal?: number }) => void

// mock node-pty
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

import { WorkspaceManager } from '../main/workspace'
import { TerminalManager } from '../main/terminal'

describe('WorkspaceManager', () => {
  let wm: WorkspaceManager
  let tm: TerminalManager

  beforeEach(() => {
    tm = new TerminalManager()
    wm = new WorkspaceManager(tm)
  })

  describe('create', () => {
    it('creates a workspace with a terminal', () => {
      const ws = wm.create('test')
      expect(ws.title).toBe('test')
      expect(ws.focusedSurfaceId).toBeTruthy()
      expect(wm.list()).toHaveLength(1)

      const tree = wm.getTree(ws.id)
      expect(tree?.type).toBe('leaf')
      if (tree?.type === 'leaf') {
        expect(tree.terminalId).toBeTruthy()
      }
    })

    it('sets first workspace as active', () => {
      const ws = wm.create()
      expect(wm.activeWorkspaceId).toBe(ws.id)
    })

    it('uses default title when none provided', () => {
      const ws = wm.create()
      expect(ws.title).toBe('project')
    })

    it('stores a canonical project root separately from the terminal cwd', () => {
      const ws = wm.create('test', '/workspace/app/backend', '/workspace/app', true)
      expect(ws.workingDirectory).toBe('/workspace/app/backend')
      expect(ws.projectRoot).toBe('/workspace/app')
      expect(ws.gitEnabled).toBe(true)
    })

    it('creates projects as top-level workspaces', () => {
      const ws = wm.create('test')
      expect(ws.kind).toBe('project')
      expect(ws.parentProjectId).toBeNull()
    })

    it('defaults plain projects to non git until main marks them otherwise', () => {
      const ws = wm.create('plain-folder')
      expect(ws.gitEnabled).toBe(false)
    })
  })

  describe('createTask', () => {
    it('creates a task under the parent project and activates it', () => {
      const project = wm.create('slapback', '/repos/slapback', '/repos/slapback', true)
      const task = wm.createTask(project.id, 'auth refactor', '/tmp/task-auth', 'task/auth-refactor', 'main')

      expect(task?.kind).toBe('task')
      expect(task?.parentProjectId).toBe(project.id)
      expect(task?.gitEnabled).toBe(true)
      expect(task?.branchName).toBe('task/auth-refactor')
      expect(task?.baseBranch).toBe('main')
      expect(wm.activeWorkspaceId).toBe(task?.id)
    })

    it('returns null when the parent project does not exist', () => {
      expect(wm.createTask('missing', 'auth refactor', '/tmp/task-auth', 'task/auth-refactor', 'main')).toBeNull()
    })
  })

  describe('promoteProjectToGit', () => {
    it('upgrades a plain project in place when git is detected later', () => {
      const project = wm.create('plain-folder', '/repos/plain-folder', '/repos/plain-folder', false)

      const updated = wm.promoteProjectToGit(project.id, '/repos/plain-folder', 'main')

      expect(updated?.gitEnabled).toBe(true)
      expect(updated?.branchName).toBe('main')
      expect(updated?.projectRoot).toBe('/repos/plain-folder')
      expect(wm.get(project.id)?.gitEnabled).toBe(true)
      expect(wm.get(project.id)?.branchName).toBe('main')
    })

    it('does nothing for task workspaces', () => {
      const project = wm.create('slapback', '/repos/slapback', '/repos/slapback', true)
      const task = wm.createTask(project.id, 'auth refactor', '/tmp/task-auth', 'task/auth-refactor', 'main')

      expect(wm.promoteProjectToGit(task!.id, '/tmp/task-auth', 'task/auth-refactor')).toBeNull()
    })
  })

  describe('syncRecoveredTasks', () => {
    it('creates recovered task workspaces without changing the active project', () => {
      const project = wm.create('slapback', '/repos/slapback', '/repos/slapback', true)

      const recovered = wm.syncRecoveredTasks(project.id, [
        {
          title: 'Recovered Auth Refactor',
          worktreePath: '/tmp/task-auth',
          branchName: 'task/auth-refactor',
          baseBranch: 'main',
        },
      ])

      expect(recovered).toHaveLength(1)
      expect(recovered[0].kind).toBe('task')
      expect(recovered[0].parentProjectId).toBe(project.id)
      expect(wm.activeWorkspaceId).toBe(project.id)
    })

    it('deduplicates repeated recovery for the same worktree', () => {
      const project = wm.create('slapback', '/repos/slapback', '/repos/slapback', true)

      const first = wm.syncRecoveredTasks(project.id, [
        {
          title: 'Recovered Auth Refactor',
          worktreePath: '/tmp/task-auth',
          branchName: 'task/auth-refactor',
          baseBranch: 'main',
        },
      ])
      const second = wm.syncRecoveredTasks(project.id, [
        {
          title: 'Recovered Auth Refactor',
          worktreePath: '/tmp/task-auth',
          branchName: 'task/auth-refactor',
          baseBranch: 'main',
        },
      ])

      expect(first[0].id).toBe(second[0].id)
      expect(wm.list().filter((workspace) => workspace.kind === 'task')).toHaveLength(1)
    })

    it('updates recovered task metadata when a matching task already exists', () => {
      const project = wm.create('slapback', '/repos/slapback', '/repos/slapback', true)
      const task = wm.createTask(project.id, 'Old Title', '/tmp/task-auth', 'task/auth-refactor', 'main')

      const recovered = wm.syncRecoveredTasks(project.id, [
        {
          title: 'Recovered Auth Refactor',
          worktreePath: '/tmp/task-auth',
          branchName: 'task/auth-refactor',
          baseBranch: 'develop',
        },
      ])

      expect(recovered[0].id).toBe(task?.id)
      expect(wm.get(task!.id)?.title).toBe('Recovered Auth Refactor')
      expect(wm.get(task!.id)?.baseBranch).toBe('develop')
    })
  })

  describe('select', () => {
    it('switches active workspace', () => {
      wm.create('one')
      const ws2 = wm.create('two')
      wm.select(ws2.id)
      expect(wm.activeWorkspaceId).toBe(ws2.id)
    })

    it('returns false for unknown id', () => {
      expect(wm.select('nope')).toBe(false)
    })
  })

  describe('cycleWorkspace', () => {
    it('cycles through base workspaces and child tasks in visible order', () => {
      const projectA = wm.create('alpha', '/repos/alpha', '/repos/alpha')
      const taskA1 = wm.createTask(projectA.id, 'task one', '/tmp/alpha-task-one', 'task/task-one', 'main')
      const taskA2 = wm.createTask(projectA.id, 'task two', '/tmp/alpha-task-two', 'task/task-two', 'main')
      const projectB = wm.create('beta', '/repos/beta', '/repos/beta')

      wm.select(projectA.id)
      expect(wm.cycleWorkspace('next')).toBe(taskA1!.id)
      expect(wm.cycleWorkspace('next')).toBe(taskA2!.id)
      expect(wm.cycleWorkspace('next')).toBe(projectB.id)
      expect(wm.cycleWorkspace('next')).toBe(projectA.id)
    })

    it('cycles backwards through the same flattened order', () => {
      const projectA = wm.create('alpha', '/repos/alpha', '/repos/alpha')
      const taskA1 = wm.createTask(projectA.id, 'task one', '/tmp/alpha-task-one', 'task/task-one', 'main')
      const projectB = wm.create('beta', '/repos/beta', '/repos/beta')

      wm.select(projectB.id)
      expect(wm.cycleWorkspace('prev')).toBe(taskA1!.id)
      expect(wm.cycleWorkspace('prev')).toBe(projectA.id)
    })
  })

  describe('close', () => {
    it('removes workspace and kills terminals', () => {
      const ws = wm.create()
      wm.close(ws.id)
      expect(wm.list()).toHaveLength(0)
    })

    it('switches active to next workspace', () => {
      const ws1 = wm.create('one')
      const ws2 = wm.create('two')
      wm.select(ws1.id)
      wm.close(ws1.id)
      expect(wm.activeWorkspaceId).toBe(ws2.id)
    })

    it('returns false for unknown id', () => {
      expect(wm.close('nope')).toBe(false)
    })

    it('closes child tasks when a parent project is closed', () => {
      const project = wm.create('slapback', '/repos/slapback', '/repos/slapback')
      const task = wm.createTask(project.id, 'auth refactor', '/tmp/task-auth', 'task/auth-refactor', 'main')

      expect(wm.list()).toHaveLength(2)
      wm.close(project.id)

      expect(wm.get(task!.id)).toBeNull()
      expect(wm.list()).toHaveLength(0)
    })

    it('returns to the parent project when the active task is closed', () => {
      const project = wm.create('slapback', '/repos/slapback', '/repos/slapback')
      const task = wm.createTask(project.id, 'auth refactor', '/tmp/task-auth', 'task/auth-refactor', 'main')

      wm.close(task!.id)

      expect(wm.activeWorkspaceId).toBe(project.id)
    })
  })

  describe('splitFocused', () => {
    it('splits into two panes with separate terminals', () => {
      const ws = wm.create()
      const originalSurfaceId = ws.focusedSurfaceId!

      wm.splitFocused('horizontal')

      const tree = wm.getTree(ws.id)
      expect(tree?.type).toBe('split')
      if (tree?.type === 'split') {
        expect(tree.direction).toBe('horizontal')
        expect(tree.first.type).toBe('leaf')
        expect(tree.second.type).toBe('leaf')
        // original surface preserved in first leaf
        if (tree.first.type === 'leaf') {
          expect(tree.first.surfaceId).toBe(originalSurfaceId)
        }
        // each leaf has its own terminal
        if (tree.first.type === 'leaf' && tree.second.type === 'leaf') {
          expect(tree.first.terminalId).not.toBe(tree.second.terminalId)
        }
      }
    })

    it('focuses the new surface after split', () => {
      const ws = wm.create()
      const originalId = ws.focusedSurfaceId!
      wm.splitFocused('horizontal')
      expect(wm.current()?.focusedSurfaceId).not.toBe(originalId)
    })

    it('can split repeatedly without breaking', () => {
      wm.create()

      wm.splitFocused('horizontal')
      wm.splitFocused('vertical')
      wm.splitFocused('horizontal')

      const tree = wm.getTree()!
      const ids = wm.collectSurfaceIds(tree)
      expect(ids).toHaveLength(4)

      // all surface ids are unique
      expect(new Set(ids).size).toBe(4)
    })

    it('preserves existing terminal ids on split', () => {
      wm.create()
      const tree1 = wm.getTree()!
      const firstTermId = tree1.type === 'leaf' ? tree1.terminalId : null

      wm.splitFocused('horizontal')
      const tree2 = wm.getTree()!

      // the original leaf's terminal id should be unchanged
      if (tree2.type === 'split' && tree2.first.type === 'leaf') {
        expect(tree2.first.terminalId).toBe(firstTermId)
      }
    })

    it('returns false when no workspace is active', () => {
      expect(wm.splitFocused('horizontal')).toBe(false)
    })

    it('includes pane counts and surface ids in workspace summaries', () => {
      const ws = wm.create()
      wm.splitFocused('horizontal')

      const summary = wm.list().find((workspace) => workspace.id === ws.id)
      expect(summary?.paneCount).toBe(2)
      expect(summary?.surfaceIds).toHaveLength(2)
    })
  })

  describe('closeFocused', () => {
    it('removes focused surface and collapses', () => {
      const ws = wm.create()
      wm.splitFocused('horizontal')
      wm.closeFocused()

      const tree = wm.getTree(ws.id)
      expect(tree?.type).toBe('leaf')
    })

    it('does not close the last surface', () => {
      wm.create()
      expect(wm.closeFocused()).toBe(false)
    })

    it('updates focus to remaining surface', () => {
      const ws = wm.create()
      const originalId = ws.focusedSurfaceId!
      wm.splitFocused('horizontal')
      wm.closeFocused()
      expect(wm.current()?.focusedSurfaceId).toBe(originalId)
    })
  })

  describe('focusSurface', () => {
    it('updates focused surface', () => {
      const ws = wm.create()
      const originalId = ws.focusedSurfaceId!
      wm.splitFocused('horizontal')

      wm.focusSurface(originalId)
      expect(wm.current()?.focusedSurfaceId).toBe(originalId)
    })

    it('returns false for unknown surface', () => {
      expect(wm.focusSurface('nope')).toBe(false)
    })
  })

  describe('persistence', () => {
    it('save and load round-trips workspace layout', () => {
      wm.create('project-a', '/workspace/app/backend', '/workspace/app', true)
      wm.splitFocused('horizontal')
      wm.create('project-b')

      // save
      wm.save()

      // load into a fresh manager
      const tm2 = new TerminalManager()
      const wm2 = new WorkspaceManager(tm2)
      wm2.load()

      expect(wm2.list()).toHaveLength(2)
      expect(wm2.list().map((w) => w.title)).toContain('project-a')
      expect(wm2.list().map((w) => w.title)).toContain('project-b')
      expect(wm2.list().find((w) => w.title === 'project-a')?.projectRoot).toBe('/workspace/app')
      expect(wm2.list().find((w) => w.title === 'project-a')?.gitEnabled).toBe(true)
      expect(wm2.list().find((w) => w.title === 'project-b')?.gitEnabled).toBe(false)
    })

    it('persists and restores task metadata', () => {
      // load() skips tasks where the working directory doesnt exist on disk
      // use a real temp directory so the existence check passes
      const taskDir = path.join(os.tmpdir(), 'takoyaki-test-task-' + Date.now())
      fs.mkdirSync(taskDir, { recursive: true })

      try {
        const project = wm.create('project-a', '/workspace/app', '/workspace/app', true)
        wm.createTask(project.id, 'auth refactor', taskDir, 'task/auth-refactor', 'main')

        wm.save()

        const tm2 = new TerminalManager()
        const wm2 = new WorkspaceManager(tm2)
        wm2.load()

        const restoredTask = wm2.list().find((workspace) => workspace.kind === 'task')
        expect(restoredTask?.parentProjectId).toBe(project.id)
        expect(restoredTask?.branchName).toBe('task/auth-refactor')
        expect(restoredTask?.baseBranch).toBe('main')
      } finally {
        fs.rmSync(taskDir, { recursive: true, force: true })
      }
    })
  })
})
