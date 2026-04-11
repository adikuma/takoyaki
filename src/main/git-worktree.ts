import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const GIT_TIMEOUT_MS = 12_000
const TASKS_METADATA_FILE = 'takoyaki-tasks.json'
const REMOVE_RETRY_DELAYS_MS = [120, 300, 700]

export interface CreateTaskOptions {
  projectRoot: string
  taskTitle: string
  baseBranch?: string
  branchName?: string
}

export interface CreateTaskResult {
  taskTitle: string
  branchName: string
  baseBranch: string
  worktreePath: string
}

export interface RemoveTaskResult {
  ok: boolean
  blocked: boolean
  detail: string
}

interface TaskMetadata {
  taskTitle: string
  branchName: string
  baseBranch: string | null
  worktreePath: string
  createdAt: number
}

interface TaskMetadataFile {
  tasks: TaskMetadata[]
}

interface ParsedWorktreeEntry {
  worktreePath: string
  branchName: string | null
  headRef: string | null
}

export interface ManagedWorktree {
  taskTitle: string
  branchName: string
  baseBranch: string | null
  worktreePath: string
  headRef: string | null
  isDirty: boolean
  createdAt: number | null
}

export interface ManagedTaskMatch {
  projectRoot: string
  taskTitle: string
  branchName: string
  baseBranch: string | null
  worktreePath: string
}

function runGit(cwd: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || stdout || error.message || '').trim() || `git ${args.join(' ')} failed`))
          return
        }
        resolve(stdout)
      },
    )
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isLikelyWorktreeInUseError(message: string): boolean {
  return /access is denied|device or resource busy|resource busy|permission denied|directory not empty|in use|being used by another process|cannot access the file|used by another process/i.test(
    message,
  )
}

function formatRemoveTaskError(message: string): string {
  if (isLikelyWorktreeInUseError(message)) {
    return 'Task worktree is still in use. Close running processes, terminals, or editors using it and try again.'
  }
  return message || 'Unable to remove task worktree'
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'task'
  )
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/')
}

function taskMetadataPath(projectRoot: string): string {
  return path.join(projectRoot, '.git', TASKS_METADATA_FILE)
}

function deriveTaskTitle(branchName: string, worktreePath: string): string {
  const raw = branchName.startsWith('task/') ? branchName.slice(5) : branchName
  const source = raw || path.basename(worktreePath)
  return (
    source
      .split(/[/-]+/)
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ') || 'Recovered Task'
  )
}

function parseWorktreeList(output: string): ParsedWorktreeEntry[] {
  const entries: ParsedWorktreeEntry[] = []
  const lines = output.split(/\r?\n/)
  let current: ParsedWorktreeEntry | null = null

  const commit = () => {
    if (!current?.worktreePath) return
    entries.push(current)
    current = null
  }

  for (const line of lines) {
    if (!line.trim()) {
      commit()
      continue
    }

    if (line.startsWith('worktree ')) {
      commit()
      current = {
        worktreePath: normalizePath(line.slice('worktree '.length).trim()),
        branchName: null,
        headRef: null,
      }
      continue
    }

    if (!current) continue
    if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim()
      current.headRef = ref || null
      current.branchName = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref || null
      continue
    }
    if (line.startsWith('detached')) {
      current.branchName = null
      current.headRef = null
    }
  }

  commit()
  return entries
}

function readTaskMetadata(projectRoot: string): TaskMetadata[] {
  try {
    const filePath = taskMetadataPath(projectRoot)
    if (!fs.existsSync(filePath)) return []
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TaskMetadataFile | TaskMetadata[]
    const tasks = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.tasks) ? parsed.tasks : []
    return tasks.filter((task) =>
      Boolean(
        task &&
        typeof task.taskTitle === 'string' &&
        typeof task.branchName === 'string' &&
        typeof task.worktreePath === 'string',
      ),
    )
  } catch {
    return []
  }
}

function writeTaskMetadata(projectRoot: string, tasks: TaskMetadata[]): void {
  const filePath = taskMetadataPath(projectRoot)
  if (!tasks.length) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true })
    return
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const payload: TaskMetadataFile = {
    tasks: tasks.slice().sort((a, b) => a.createdAt - b.createdAt || a.worktreePath.localeCompare(b.worktreePath)),
  }
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
}

function upsertTaskMetadata(projectRoot: string, nextTask: TaskMetadata): void {
  const normalizedPath = normalizePath(nextTask.worktreePath)
  const tasks = readTaskMetadata(projectRoot).filter((task) => normalizePath(task.worktreePath) !== normalizedPath)
  tasks.push({ ...nextTask, worktreePath: normalizedPath })
  writeTaskMetadata(projectRoot, tasks)
}

function removeTaskMetadata(projectRoot: string, worktreePath: string): void {
  const normalizedPath = normalizePath(worktreePath)
  const remaining = readTaskMetadata(projectRoot).filter((task) => normalizePath(task.worktreePath) !== normalizedPath)
  const filePath = taskMetadataPath(projectRoot)
  if (!remaining.length) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true })
    return
  }
  writeTaskMetadata(projectRoot, remaining)
}

async function refExists(projectRoot: string, refName: string): Promise<boolean> {
  try {
    await runGit(projectRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${refName}`])
    return true
  } catch {
    return false
  }
}

async function uniqueBranchName(projectRoot: string, preferred: string): Promise<string> {
  if (!(await refExists(projectRoot, preferred))) return preferred
  let index = 2
  while (await refExists(projectRoot, `${preferred}-${index}`)) index += 1
  return `${preferred}-${index}`
}

function uniqueWorktreePath(projectRoot: string, slug: string): string {
  const repoRootName = slugify(path.basename(projectRoot))
  const parentDir = path.dirname(projectRoot)
  let candidate = path.join(parentDir, `${repoRootName}-${slug}`)
  let index = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(parentDir, `${repoRootName}-${slug}-${index}`)
    index += 1
  }
  return candidate
}

export class GitWorktreeService {
  async findManagedTaskForPath(inputPath: string | null | undefined): Promise<ManagedTaskMatch | null> {
    if (!inputPath) return null

    const worktreePath = await this.detectRepoRoot(inputPath)
    if (!worktreePath) return null

    try {
      const [commonDir, absoluteGitDir] = await Promise.all([
        runGit(inputPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
        runGit(inputPath, ['rev-parse', '--path-format=absolute', '--absolute-git-dir']),
      ])

      const normalizedCommonDir = normalizePath(commonDir.trim())
      const normalizedAbsoluteGitDir = normalizePath(absoluteGitDir.trim())
      if (!normalizedCommonDir || !normalizedAbsoluteGitDir || normalizedCommonDir === normalizedAbsoluteGitDir) {
        return null
      }

      const projectRoot = normalizePath(path.dirname(normalizedCommonDir))
      if (!projectRoot || projectRoot === normalizePath(worktreePath)) return null

      const metadata = readTaskMetadata(projectRoot)
      const task = metadata.find((entry) => normalizePath(entry.worktreePath) === normalizePath(worktreePath))
      if (!task) return null

      return {
        projectRoot,
        taskTitle: task.taskTitle,
        branchName: task.branchName,
        baseBranch: task.baseBranch,
        worktreePath: normalizePath(worktreePath),
      }
    } catch {
      return null
    }
  }

  async detectRepoRoot(inputPath: string | null | undefined): Promise<string | null> {
    if (!inputPath) return null
    try {
      const root = (await runGit(inputPath, ['rev-parse', '--show-toplevel'])).trim()
      return root ? normalizePath(root) : null
    } catch {
      return null
    }
  }

  async resolveProjectRoot(inputPath: string): Promise<string> {
    return (await this.detectRepoRoot(inputPath)) || normalizePath(inputPath)
  }

  async isTaskDirty(worktreePath: string): Promise<boolean> {
    const dirty = (await runGit(worktreePath, ['status', '--porcelain=v1', '-uall']).catch(() => '')).trim()
    return Boolean(dirty)
  }

  async getCurrentBranch(projectRoot: string): Promise<string> {
    const branch = (await runGit(projectRoot, ['branch', '--show-current'])).trim()
    if (!branch) throw new Error('Repository is not on a named branch')
    return branch
  }

  async listBranches(projectRoot: string): Promise<string[]> {
    const currentBranch = await this.getCurrentBranch(projectRoot).catch(() => '')
    const output = await runGit(projectRoot, [
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads',
      'refs/remotes',
    ])
    const branches = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.endsWith('/HEAD'))
      .filter((line, index, list) => list.indexOf(line) === index)
      .sort((a, b) => a.localeCompare(b))
    if (!currentBranch) return branches
    return [currentBranch, ...branches.filter((branch) => branch !== currentBranch)]
  }

  async listManagedWorktrees(projectRoot: string): Promise<ManagedWorktree[]> {
    const output = await runGit(projectRoot, ['worktree', 'list', '--porcelain'])
    const allEntries = parseWorktreeList(output)
    const metadata = readTaskMetadata(projectRoot)
    const metadataByPath = new Map(metadata.map((task) => [normalizePath(task.worktreePath), task]))
    const managedEntries = allEntries.filter((entry) => metadataByPath.has(normalizePath(entry.worktreePath)))
    const validPaths = new Set(managedEntries.map((entry) => normalizePath(entry.worktreePath)))
    const prunedMetadata = metadata.filter(
      (task) => validPaths.has(normalizePath(task.worktreePath)) && fs.existsSync(task.worktreePath),
    )
    if (prunedMetadata.length !== metadata.length) writeTaskMetadata(projectRoot, prunedMetadata)

    const tasks = await Promise.all(
      managedEntries.map(async (entry) => {
        const normalizedPath = normalizePath(entry.worktreePath)
        const saved = metadataByPath.get(normalizedPath)
        const branchName = entry.branchName || saved?.branchName || path.basename(entry.worktreePath)
        return {
          taskTitle: saved?.taskTitle || deriveTaskTitle(branchName, entry.worktreePath),
          branchName,
          baseBranch: saved?.baseBranch || null,
          worktreePath: normalizedPath,
          headRef: entry.headRef,
          isDirty: await this.isTaskDirty(entry.worktreePath),
          createdAt: saved?.createdAt || null,
        }
      }),
    )

    return tasks.sort((a, b) => {
      const aCreated = a.createdAt ?? Number.MAX_SAFE_INTEGER
      const bCreated = b.createdAt ?? Number.MAX_SAFE_INTEGER
      return aCreated - bCreated || a.worktreePath.localeCompare(b.worktreePath)
    })
  }

  async createTask(options: CreateTaskOptions): Promise<CreateTaskResult> {
    const taskTitle = options.taskTitle.trim()
    if (!taskTitle) throw new Error('Task title is required')

    const baseBranch = options.baseBranch?.trim() || (await this.getCurrentBranch(options.projectRoot))
    const slug = slugify(taskTitle)
    const branchName = options.branchName?.trim()
      ? options.branchName.trim()
      : await uniqueBranchName(options.projectRoot, `task/${slug}`)
    const worktreePath = uniqueWorktreePath(options.projectRoot, slug)

    fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
    await runGit(options.projectRoot, ['worktree', 'add', '-b', branchName, worktreePath, baseBranch])
    upsertTaskMetadata(options.projectRoot, {
      taskTitle,
      branchName,
      baseBranch,
      worktreePath,
      createdAt: Date.now(),
    })

    return {
      taskTitle,
      branchName,
      baseBranch,
      worktreePath,
    }
  }

  async removeTask(projectRoot: string, worktreePath: string, force = false): Promise<RemoveTaskResult> {
    const dirty = await this.isTaskDirty(worktreePath)
    if (dirty && !force) {
      return {
        ok: false,
        blocked: true,
        detail: 'Task has uncommitted changes. Force remove to delete the worktree.',
      }
    }

    try {
      let lastError: Error | null = null
      const removeArgs = ['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath]

      for (let attempt = 0; attempt <= REMOVE_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          await runGit(projectRoot, removeArgs)
          lastError = null
          break
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Unable to remove task worktree')
          const shouldRetry =
            process.platform === 'win32' &&
            attempt < REMOVE_RETRY_DELAYS_MS.length &&
            isLikelyWorktreeInUseError(lastError.message)
          if (!shouldRetry) {
            throw lastError
          }
          await delay(REMOVE_RETRY_DELAYS_MS[attempt]!)
        }
      }

      if (lastError) throw lastError
      await runGit(projectRoot, ['worktree', 'prune']).catch(() => '')
      removeTaskMetadata(projectRoot, worktreePath)
      return {
        ok: true,
        blocked: false,
        detail: 'Task worktree removed. Branch was kept.',
      }
    } catch (error) {
      return {
        ok: false,
        blocked: false,
        detail: formatRemoveTaskError(error instanceof Error ? error.message : 'Unable to remove task worktree'),
      }
    }
  }
}
