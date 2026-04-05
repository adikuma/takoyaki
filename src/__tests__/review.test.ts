import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ReviewService } from '../main/review'
import type { Workspace } from '../main/workspace'

const tempRoots: string[] = []

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  })
}

function createRepo(): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'takoyaki-review-'))
  tempRoots.push(repoRoot)
  runGit(repoRoot, ['init', '-q'])
  runGit(repoRoot, ['config', 'core.autocrlf', 'false'])
  runGit(repoRoot, ['config', 'user.email', 'takoyaki@example.com'])
  runGit(repoRoot, ['config', 'user.name', 'takoyaki'])
  return repoRoot
}

function writeFile(repoRoot: string, relativePath: string, content: string | Buffer): void {
  const absolutePath = path.join(repoRoot, relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, content)
}

function commitAll(repoRoot: string, message = 'commit'): void {
  runGit(repoRoot, ['add', '.'])
  runGit(repoRoot, ['commit', '-qm', message])
}

function createWorkspace(repoRoot: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'workspace-1',
    title: 'repo',
    kind: 'project',
    parentProjectId: null,
    focusedSurfaceId: null,
    workingDirectory: repoRoot,
    projectRoot: repoRoot,
    branchName: 'main',
    baseBranch: null,
    ...overrides,
  }
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('ReviewService', () => {
  it('reports staged and unstaged changes together against HEAD', async () => {
    const repoRoot = createRepo()
    writeFile(repoRoot, 'src/app.ts', 'console.log("one")\n')
    commitAll(repoRoot, 'init')

    writeFile(repoRoot, 'src/app.ts', 'console.log("two")\n')
    runGit(repoRoot, ['add', 'src/app.ts'])
    writeFile(repoRoot, 'src/app.ts', 'console.log("three")\n')

    const service = new ReviewService()
    const snapshot = await service.getSnapshot(createWorkspace(repoRoot))

    expect(snapshot.files).toEqual([
      expect.objectContaining({
        path: 'src/app.ts',
        status: 'modified',
        stagedStatus: 'M',
        unstagedStatus: 'M',
      }),
    ])
  })

  it('returns a synthesized added-file patch for untracked files', async () => {
    const repoRoot = createRepo()
    writeFile(repoRoot, 'README.md', '# repo\n')
    commitAll(repoRoot, 'init')
    writeFile(repoRoot, 'notes/todo.txt', 'ship review mode\n')

    const service = new ReviewService()
    const workspace = createWorkspace(repoRoot)
    const snapshot = await service.getSnapshot(workspace)
    const patch = await service.getFilePatch(workspace, 'notes/todo.txt')

    expect(snapshot.files).toEqual([
      expect.objectContaining({
        path: 'notes/todo.txt',
        status: 'untracked',
      }),
    ])
    expect(patch.renderMode).toBe('text')
    expect(patch.patch).toContain('+++ b/notes/todo.txt')
    expect(patch.patch).toContain('+ship review mode')
  })

  it('marks deleted tracked files as deleted', async () => {
    const repoRoot = createRepo()
    writeFile(repoRoot, 'src/old.ts', 'export const oldValue = true\n')
    commitAll(repoRoot, 'init')
    fs.rmSync(path.join(repoRoot, 'src', 'old.ts'))

    const service = new ReviewService()
    const workspace = createWorkspace(repoRoot)
    const snapshot = await service.getSnapshot(workspace)
    const patch = await service.getFilePatch(workspace, 'src/old.ts')

    expect(snapshot.files).toEqual([
      expect.objectContaining({
        path: 'src/old.ts',
        status: 'deleted',
      }),
    ])
    expect(patch.renderMode).toBe('text')
    expect(patch.patch).toContain('deleted file mode')
  })

  it('tracks renamed files with previous paths', async () => {
    const repoRoot = createRepo()
    writeFile(repoRoot, 'src/old-name.ts', 'export const value = 1\n')
    commitAll(repoRoot, 'init')
    runGit(repoRoot, ['mv', 'src/old-name.ts', 'src/new-name.ts'])

    const service = new ReviewService()
    const workspace = createWorkspace(repoRoot)
    const snapshot = await service.getSnapshot(workspace)
    const patch = await service.getFilePatch(workspace, 'src/new-name.ts')

    expect(snapshot.files).toEqual([
      expect.objectContaining({
        path: 'src/new-name.ts',
        previousPath: 'src/old-name.ts',
        status: 'renamed',
      }),
    ])
    expect(patch.renderMode).toBe('text')
    expect(patch.patch).toContain('rename from src/old-name.ts')
    expect(patch.patch).toContain('rename to src/new-name.ts')
  })

  it('limits project review to the selected subtree', async () => {
    const repoRoot = createRepo()
    writeFile(repoRoot, 'server/app.ts', 'server\n')
    writeFile(repoRoot, 'client/app.ts', 'client\n')
    commitAll(repoRoot, 'init')
    writeFile(repoRoot, 'server/app.ts', 'server changed\n')
    writeFile(repoRoot, 'client/app.ts', 'client changed\n')

    const service = new ReviewService()
    const snapshot = await service.getSnapshot(
      createWorkspace(repoRoot, {
        workingDirectory: path.join(repoRoot, 'server'),
      }),
    )

    expect(snapshot.scopePath).toBe('server')
    expect(snapshot.files).toHaveLength(1)
    expect(snapshot.files[0].path).toBe('server/app.ts')
  })

  it('returns binary placeholders instead of inline patches', async () => {
    const repoRoot = createRepo()
    writeFile(repoRoot, 'assets/logo.bin', Buffer.from([1, 2, 3, 4, 5]))
    commitAll(repoRoot, 'init')
    writeFile(repoRoot, 'assets/logo.bin', Buffer.from([0, 1, 2, 3, 4, 5]))

    const service = new ReviewService()
    const workspace = createWorkspace(repoRoot)
    const patch = await service.getFilePatch(workspace, 'assets/logo.bin')

    expect(patch.renderMode).toBe('binary')
    expect(patch.detail).toContain('Binary file')
  })

  it('returns a non-reviewable snapshot outside git', async () => {
    const folderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'takoyaki-review-non-git-'))
    tempRoots.push(folderPath)

    const service = new ReviewService()
    const snapshot = await service.getSnapshot(createWorkspace(folderPath, { projectRoot: folderPath }))

    expect(snapshot.isReviewable).toBe(false)
    expect(snapshot.detail).toContain('git')
    expect(snapshot.files).toHaveLength(0)
  })
})
