import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { Workspace } from './workspace'

const GIT_TIMEOUT_MS = 12_000
const PATCH_SIZE_LIMIT = 200_000
const FILE_SIZE_LIMIT = 200_000
const BINARY_SNIFF_BYTES = 8_000

export type ReviewFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'untracked'
export type ReviewRenderMode = 'text' | 'binary' | 'oversized'

export interface ReviewFile {
  path: string
  previousPath: string | null
  status: ReviewFileStatus
  stagedStatus: string
  unstagedStatus: string
}

export interface ReviewSnapshot {
  workspaceId: string
  workspaceTitle: string
  branchName: string | null
  baseRef: 'HEAD'
  scopePath: string | null
  isReviewable: boolean
  detail: string | null
  files: ReviewFile[]
}

export interface ReviewPatch {
  path: string
  previousPath: string | null
  status: ReviewFileStatus
  renderMode: ReviewRenderMode
  patch: string
  detail: string | null
}

interface ReviewScope {
  repoRoot: string
  scopePath: string | null
}

interface GitStatusEntry {
  path: string
  previousPath: string | null
  stagedStatus: string
  unstagedStatus: string
  status: ReviewFileStatus
}

// normalize git paths so renderer and review logic can compare them consistently across platforms
function normalizePath(input: string): string {
  return input.replace(/\\/g, '/')
}

// compare working directories through real paths so scoped reviews survive symlinks
function resolveComparablePath(input: string): string {
  try {
    return fs.realpathSync.native(input)
  } catch {
    return path.resolve(input)
  }
}

// run a git command with shared timeout and error normalization for review flows
function runGit(cwd: string, args: string[], encoding: BufferEncoding = 'utf8'): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      {
        encoding,
        windowsHide: true,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || stdout || error.message || '').trim() || `git ${args.join(' ')} failed`))
          return
        }
        resolve(String(stdout))
      },
    )
  })
}

// keep only files that live inside the current workspace review scope
function pathInScope(filePath: string, scopePath: string | null): boolean {
  if (!scopePath) return true
  return filePath === scopePath || filePath.startsWith(`${scopePath}/`)
}

// map porcelain status codes into the smaller review status enum
function classifyStatus(code: string): ReviewFileStatus {
  if (code === '??') return 'untracked'
  if (code.includes('R')) return 'renamed'
  if (code.includes('C')) return 'copied'
  if (code.includes('D')) return 'deleted'
  if (code.includes('A')) return 'added'
  if (code.includes('T')) return 'typechange'
  return 'modified'
}

// parse git porcelain output into structured review file entries
function parseStatus(output: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = []
  const tokens = output.split('\0').filter(Boolean)

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const code = token.slice(0, 2)
    const filePath = token.slice(3)
    if (!filePath) continue

    let previousPath: string | null = null
    if (code.includes('R') || code.includes('C')) {
      previousPath = tokens[index + 1] || null
      index += 1
    }

    entries.push({
      path: filePath,
      previousPath,
      stagedStatus: code[0] || ' ',
      unstagedStatus: code[1] || ' ',
      status: classifyStatus(code),
    })
  }

  return entries
}

// keep review file ordering stable between refreshes
function compareReviewFiles(left: GitStatusEntry, right: GitStatusEntry): number {
  return left.path.localeCompare(right.path) || (left.previousPath || '').localeCompare(right.previousPath || '')
}

// limit project reviews to the surviving workspace cwd when the user is inside a subdirectory
function resolveScopePath(workspace: Workspace, repoRoot: string): string | null {
  if (workspace.kind !== 'project') return null
  const comparableRoot = resolveComparablePath(repoRoot)
  const comparableWorkingDirectory = resolveComparablePath(workspace.workingDirectory || repoRoot)
  if (comparableWorkingDirectory === comparableRoot) return null
  const relativePath = normalizePath(path.relative(comparableRoot, comparableWorkingDirectory))
  if (!relativePath || relativePath === '.' || relativePath.startsWith('../')) return null
  return relativePath
}

// convert a repo relative path back into an absolute filesystem path
function toAbsolutePath(repoRoot: string, relativePath: string): string {
  return path.join(repoRoot, ...relativePath.split('/'))
}

// sniff binary files quickly so review does not try to render unreadable data as text
function isBinaryContent(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, BINARY_SNIFF_BYTES)
  for (let index = 0; index < limit; index += 1) {
    if (buffer[index] === 0) return true
  }
  return false
}

// synthesize a git-style patch for untracked files so they can still be reviewed
function buildAddedFilePatch(filePath: string, content: string): string {
  const normalizedContent = content.replace(/\r\n/g, '\n')
  const lines = normalizedContent.length ? normalizedContent.split('\n') : []
  const endsWithNewline = normalizedContent.endsWith('\n')
  const renderedLines = endsWithNewline ? lines.slice(0, -1) : lines
  const hunkHeader = `@@ -0,0 +1,${renderedLines.length} @@`
  const body = renderedLines.map((line) => `+${line}`).join('\n')
  const noNewlineMarker = content.length && !endsWithNewline ? '\n\\ No newline at end of file' : ''
  return (
    [
      `diff --git a/${filePath} b/${filePath}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${filePath}`,
      ...(content.length ? [hunkHeader, body] : []),
    ].join('\n') +
    noNewlineMarker +
    '\n'
  )
}

export class ReviewService {
  // resolve the git root and optional review scope for one workspace
  private async resolveScope(workspace: Workspace): Promise<ReviewScope | null> {
    const rootCandidate = workspace.projectRoot || workspace.workingDirectory
    if (!rootCandidate) return null

    try {
      const repoRoot = normalizePath((await runGit(rootCandidate, ['rev-parse', '--show-toplevel'])).trim())
      if (!repoRoot) return null
      return { repoRoot, scopePath: resolveScopePath(workspace, repoRoot) }
    } catch {
      return null
    }
  }

  // list changed files and apply workspace scoping before the renderer sees them
  private async listStatusEntries(workspace: Workspace, scope: ReviewScope): Promise<GitStatusEntry[]> {
    const output = await runGit(scope.repoRoot, ['status', '--porcelain=v1', '-z', '-uall'])
    return parseStatus(output)
      .filter(
        (entry) => pathInScope(entry.path, scope.scopePath) || pathInScope(entry.previousPath || '', scope.scopePath),
      )
      .sort(compareReviewFiles)
  }

  // build the review sidebar snapshot for the current workspace selection
  async getSnapshot(workspace: Workspace): Promise<ReviewSnapshot> {
    const scope = await this.resolveScope(workspace)
    if (!scope) {
      return {
        workspaceId: workspace.id,
        workspaceTitle: workspace.title,
        branchName: workspace.branchName,
        baseRef: 'HEAD',
        scopePath: null,
        isReviewable: false,
        detail: 'Review is only available for git workspaces.',
        files: [],
      }
    }

    const files = await this.listStatusEntries(workspace, scope)
    return {
      workspaceId: workspace.id,
      workspaceTitle: workspace.title,
      branchName: workspace.branchName,
      baseRef: 'HEAD',
      scopePath: scope.scopePath,
      isReviewable: true,
      detail: null,
      files: files.map((entry) => ({
        path: entry.path,
        previousPath: entry.previousPath,
        status: entry.status,
        stagedStatus: entry.stagedStatus,
        unstagedStatus: entry.unstagedStatus,
      })),
    }
  }

  // load one file patch and fall back to binary or oversized placeholders when needed
  async getFilePatch(workspace: Workspace, filePath: string): Promise<ReviewPatch> {
    const scope = await this.resolveScope(workspace)
    if (!scope) {
      return {
        path: filePath,
        previousPath: null,
        status: 'modified',
        renderMode: 'oversized',
        patch: '',
        detail: 'Review is only available for git workspaces.',
      }
    }

    const entries = await this.listStatusEntries(workspace, scope)
    const entry = entries.find((candidate) => candidate.path === filePath)
    if (!entry) {
      throw new Error('File is no longer part of the current review snapshot.')
    }

    if (entry.status === 'untracked') {
      const absolutePath = toAbsolutePath(scope.repoRoot, entry.path)
      const fileStat = fs.statSync(absolutePath)
      if (fileStat.size > FILE_SIZE_LIMIT) {
        return {
          path: entry.path,
          previousPath: entry.previousPath,
          status: entry.status,
          renderMode: 'oversized',
          patch: '',
          detail: 'This file is too large to render inline.',
        }
      }

      const fileBuffer = fs.readFileSync(absolutePath)
      if (isBinaryContent(fileBuffer)) {
        return {
          path: entry.path,
          previousPath: entry.previousPath,
          status: entry.status,
          renderMode: 'binary',
          patch: '',
          detail: 'Binary file changes are not rendered inline.',
        }
      }

      return {
        path: entry.path,
        previousPath: entry.previousPath,
        status: entry.status,
        renderMode: 'text',
        patch: buildAddedFilePatch(entry.path, fileBuffer.toString('utf8')),
        detail: null,
      }
    }

    const pathArgs = ['--', ...(entry.previousPath ? [entry.previousPath] : []), entry.path]
    const numstat = await runGit(scope.repoRoot, ['diff', '--find-renames', '--numstat', 'HEAD', ...pathArgs])
    const numstatLine = numstat.split(/\r?\n/).find((line) => line.trim())
    if (numstatLine?.startsWith('-\t-')) {
      return {
        path: entry.path,
        previousPath: entry.previousPath,
        status: entry.status,
        renderMode: 'binary',
        patch: '',
        detail: 'Binary file changes are not rendered inline.',
      }
    }

    const patch = await runGit(scope.repoRoot, ['diff', '--find-renames', '--no-ext-diff', 'HEAD', ...pathArgs])
    if (patch.length > PATCH_SIZE_LIMIT) {
      return {
        path: entry.path,
        previousPath: entry.previousPath,
        status: entry.status,
        renderMode: 'oversized',
        patch: '',
        detail: 'This diff is too large to render inline.',
      }
    }

    return {
      path: entry.path,
      previousPath: entry.previousPath,
      status: entry.status,
      renderMode: 'text',
      patch,
      detail: null,
    }
  }
}
