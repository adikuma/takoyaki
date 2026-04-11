import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const gitState = vi.hoisted(() => ({
  responses: new Map<string, { stdout?: string; stderr?: string; error?: string }>(),
  home: process.cwd() + '/.tmp-worktree-home',
}))

function gitKey(cwd: string, args: string[]): string {
  return JSON.stringify([cwd.replace(/\\/g, '/'), args])
}

function mockGit(cwd: string, args: string[], stdout: string, error?: string): void {
  gitState.responses.set(gitKey(cwd, args), { stdout, error })
}

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => gitState.home }
})

vi.mock('child_process', () => ({
  execFile: vi.fn(
    (
      _command: string,
      args: string[],
      _options: unknown,
      cb: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const cwd = args[1]
      const gitArgs = args.slice(2)
      const response = gitState.responses.get(gitKey(cwd, gitArgs))
      if (!response || response.error) {
        cb(new Error(response?.error || `No mock for ${cwd} ${gitArgs.join(' ')}`), '', response?.stderr || '')
        return
      }
      cb(null, response.stdout || '', response.stderr || '')
    },
  ),
}))

import { GitWorktreeService } from '../main/git-worktree'

describe('GitWorktreeService', () => {
  let service: GitWorktreeService
  let repoRoot: string
  let repoParent: string

  beforeEach(() => {
    gitState.responses.clear()
    fs.rmSync(gitState.home, { recursive: true, force: true })
    repoRoot = path.join(gitState.home, 'repo')
    repoParent = path.dirname(repoRoot)
    fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true })
    service = new GitWorktreeService()
  })

  it('lists branches with the current branch first', async () => {
    mockGit(repoRoot, ['branch', '--show-current'], 'feature/current\n')
    mockGit(
      repoRoot,
      ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
      'main\nfeature/current\norigin/main\n',
    )

    await expect(service.listBranches(repoRoot)).resolves.toEqual(['feature/current', 'main', 'origin/main'])
  })

  it('creates a task from the current branch with an auto-generated unique branch name', async () => {
    const managedPath = path.join(repoParent, 'repo-auth-refactor')
    mockGit(repoRoot, ['branch', '--show-current'], 'main\n')
    mockGit(repoRoot, ['show-ref', '--verify', '--quiet', 'refs/heads/task/auth-refactor'], '', 'missing')
    mockGit(repoRoot, ['worktree', 'add', '-b', 'task/auth-refactor', managedPath, 'main'], '')

    const result = await service.createTask({
      projectRoot: repoRoot,
      taskTitle: 'Auth Refactor',
    })

    expect(result.branchName).toBe('task/auth-refactor')
    expect(result.baseBranch).toBe('main')
    expect(result.worktreePath).toBe(managedPath)
    const metadataPath = path.join(repoRoot, '.git', 'takoyaki-tasks.json')
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
    expect(metadata.tasks).toHaveLength(1)
    expect(metadata.tasks[0].taskTitle).toBe('Auth Refactor')
  })

  it('adds a numeric suffix when the auto-generated branch already exists', async () => {
    const managedPath = path.join(repoParent, 'repo-auth-refactor')
    mockGit(repoRoot, ['branch', '--show-current'], 'main\n')
    mockGit(repoRoot, ['show-ref', '--verify', '--quiet', 'refs/heads/task/auth-refactor'], '')
    mockGit(repoRoot, ['show-ref', '--verify', '--quiet', 'refs/heads/task/auth-refactor-2'], '', 'missing')
    mockGit(repoRoot, ['worktree', 'add', '-b', 'task/auth-refactor-2', managedPath, 'main'], '')

    const result = await service.createTask({
      projectRoot: repoRoot,
      taskTitle: 'Auth Refactor',
    })

    expect(result.branchName).toBe('task/auth-refactor-2')
  })

  it('blocks removal when the task worktree is dirty', async () => {
    const worktreePath = path.join(repoParent, 'repo-task-a')
    mockGit(worktreePath, ['status', '--porcelain=v1', '-uall'], ' M src/app.ts\n')

    await expect(service.removeTask(repoRoot, worktreePath)).resolves.toEqual({
      ok: false,
      blocked: true,
      detail: 'Task has uncommitted changes. Force remove to delete the worktree.',
    })
  })

  it('removes the worktree and prunes metadata when forced', async () => {
    const metadataDir = path.join(repoRoot, '.git')
    const worktreePath = path.join(repoParent, 'repo-task-a')
    fs.mkdirSync(metadataDir, { recursive: true })
    fs.writeFileSync(
      path.join(metadataDir, 'takoyaki-tasks.json'),
      JSON.stringify({
        tasks: [
          {
            taskTitle: 'Task A',
            branchName: 'task/task-a',
            baseBranch: 'main',
            worktreePath,
            createdAt: 1,
          },
        ],
      }),
      'utf-8',
    )
    mockGit(worktreePath, ['status', '--porcelain=v1', '-uall'], ' M src/app.ts\n')
    mockGit(repoRoot, ['worktree', 'remove', '--force', worktreePath], '')
    mockGit(repoRoot, ['worktree', 'prune'], '')

    await expect(service.removeTask(repoRoot, worktreePath, true)).resolves.toEqual({
      ok: true,
      blocked: false,
      detail: 'Task worktree removed. Branch was kept.',
    })
    expect(fs.existsSync(path.join(metadataDir, 'takoyaki-tasks.json'))).toBe(false)
  })

  it('lists only metadata-backed worktrees and restores titles from metadata', async () => {
    const managedPath = path.join(repoParent, 'repo-auth-refactor')
    const metadataDir = path.join(repoRoot, '.git')
    fs.mkdirSync(managedPath, { recursive: true })
    fs.mkdirSync(metadataDir, { recursive: true })
    fs.writeFileSync(
      path.join(metadataDir, 'takoyaki-tasks.json'),
      JSON.stringify({
        tasks: [
          {
            taskTitle: 'Auth Refactor',
            branchName: 'task/auth-refactor',
            baseBranch: 'main',
            worktreePath: managedPath,
            createdAt: 5,
          },
        ],
      }),
      'utf-8',
    )

    mockGit(
      repoRoot,
      ['worktree', 'list', '--porcelain'],
      [
        `worktree ${repoRoot}`,
        `HEAD abc123`,
        `branch refs/heads/main`,
        '',
        `worktree ${managedPath}`,
        `HEAD def456`,
        `branch refs/heads/task/auth-refactor`,
        '',
        `worktree /manual/worktree`,
        `HEAD aaa111`,
        `branch refs/heads/manual`,
        '',
      ].join('\n'),
    )
    mockGit(managedPath, ['status', '--porcelain=v1', '-uall'], ' M src/app.ts\n')

    await expect(service.listManagedWorktrees(repoRoot)).resolves.toEqual([
      expect.objectContaining({
        taskTitle: 'Auth Refactor',
        branchName: 'task/auth-refactor',
        baseBranch: 'main',
        worktreePath: managedPath.replace(/\\/g, '/'),
        isDirty: true,
      }),
    ])
  })

  it('prunes stale metadata during managed worktree discovery', async () => {
    const metadataDir = path.join(repoRoot, '.git')
    const livePath = path.join(repoParent, 'repo-live-task')
    const stalePath = path.join(repoParent, 'repo-stale-task')
    fs.mkdirSync(livePath, { recursive: true })
    fs.mkdirSync(metadataDir, { recursive: true })
    fs.writeFileSync(
      path.join(metadataDir, 'takoyaki-tasks.json'),
      JSON.stringify({
        tasks: [
          {
            taskTitle: 'Live Task',
            branchName: 'task/live-task',
            baseBranch: 'main',
            worktreePath: livePath,
            createdAt: 1,
          },
          {
            taskTitle: 'Stale Task',
            branchName: 'task/stale-task',
            baseBranch: 'main',
            worktreePath: stalePath,
            createdAt: 2,
          },
        ],
      }),
      'utf-8',
    )
    mockGit(
      repoRoot,
      ['worktree', 'list', '--porcelain'],
      [
        `worktree ${repoRoot}`,
        `HEAD abc123`,
        `branch refs/heads/main`,
        '',
        `worktree ${livePath}`,
        `HEAD def456`,
        `branch refs/heads/task/live-task`,
        '',
      ].join('\n'),
    )
    mockGit(livePath, ['status', '--porcelain=v1', '-uall'], '')

    const recovered = await service.listManagedWorktrees(repoRoot)

    expect(recovered).toHaveLength(1)
    const metadata = JSON.parse(fs.readFileSync(path.join(metadataDir, 'takoyaki-tasks.json'), 'utf-8'))
    expect(metadata.tasks).toHaveLength(1)
    expect(metadata.tasks[0].taskTitle).toBe('Live Task')
  })

  it('detects when an opened folder is a managed task worktree', async () => {
    const managedPath = path.join(repoParent, 'repo-auth-refactor')
    const worktreeGitDir = path.join(repoRoot, '.git', 'worktrees', 'repo-auth-refactor')
    const metadataDir = path.join(repoRoot, '.git')
    fs.mkdirSync(managedPath, { recursive: true })
    fs.mkdirSync(metadataDir, { recursive: true })
    fs.writeFileSync(
      path.join(metadataDir, 'takoyaki-tasks.json'),
      JSON.stringify({
        tasks: [
          {
            taskTitle: 'Auth Refactor',
            branchName: 'feature/auth-refactor',
            baseBranch: 'main',
            worktreePath: managedPath,
            createdAt: 5,
          },
        ],
      }),
      'utf-8',
    )

    mockGit(managedPath, ['rev-parse', '--show-toplevel'], `${managedPath}\n`)
    mockGit(managedPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'], `${metadataDir}\n`)
    mockGit(managedPath, ['rev-parse', '--path-format=absolute', '--absolute-git-dir'], `${worktreeGitDir}\n`)

    await expect(service.findManagedTaskForPath(managedPath)).resolves.toEqual({
      projectRoot: repoRoot.replace(/\\/g, '/'),
      taskTitle: 'Auth Refactor',
      branchName: 'feature/auth-refactor',
      baseBranch: 'main',
      worktreePath: managedPath.replace(/\\/g, '/'),
    })
  })

  it('does not treat the primary repo root as a managed task worktree', async () => {
    const metadataDir = path.join(repoRoot, '.git')
    mockGit(repoRoot, ['rev-parse', '--show-toplevel'], `${repoRoot}\n`)
    mockGit(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'], `${metadataDir}\n`)
    mockGit(repoRoot, ['rev-parse', '--path-format=absolute', '--absolute-git-dir'], `${metadataDir}\n`)

    await expect(service.findManagedTaskForPath(repoRoot)).resolves.toBeNull()
  })
})
