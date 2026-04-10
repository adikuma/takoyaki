// manages workspaces and pane layout
// ptys are created here and live in terminal manager
// layout is saved to ~/.takoyaki/state.json

import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { TerminalManager } from './terminal'

function resolveGitBranch(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        if (error || !stdout.trim()) return resolve(null)
        resolve(stdout.trim())
      },
    )
  })
}

export interface Workspace {
  id: string
  title: string
  kind: 'project' | 'task'
  parentProjectId: string | null
  focusedSurfaceId: string | null
  workingDirectory: string
  projectRoot: string
  gitEnabled: boolean
  branchName: string | null
  baseBranch: string | null
  paneCount?: number
  surfaceIds?: string[]
}

export interface RecoveredTaskWorkspace {
  title: string
  worktreePath: string
  branchName: string
  baseBranch: string | null
}

// pane tree with terminal ids baked in
export type PaneTree =
  | { type: 'leaf'; surfaceId: string; terminalId: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; first: PaneTree; second: PaneTree }

interface WorkspaceState {
  workspace: Workspace
  paneTree: PaneTree | null
}

interface SavedWorkspaceState {
  id: string
  title: string
  kind: 'project' | 'task'
  parentProjectId: string | null
  focusedSurfaceId: string | null
  workingDirectory: string
  projectRoot: string
  gitEnabled?: boolean
  branchName: string | null
  baseBranch: string | null
  paneTree: SavedPaneTree | null
}

type SavedPaneTree =
  | { type: 'leaf'; surfaceId: string; cwd?: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; first: SavedPaneTree; second: SavedPaneTree }

type FocusDirection = 'left' | 'right' | 'up' | 'down'
type PathStep = 'first' | 'second'
type WorkspaceCycleDirection = 'next' | 'prev'

const STATE_FILE = path.join(os.homedir(), '.takoyaki', 'state.json')
const LEGACY_TASK_ROOT = path.join(os.homedir(), '.takoyaki', 'worktrees')

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/')
}

export class WorkspaceManager extends EventEmitter {
  private state = new Map<string, WorkspaceState>()
  private terminals: TerminalManager
  activeWorkspaceId: string | null = null

  constructor(terminals: TerminalManager) {
    super()
    this.terminals = terminals
  }

  create(title?: string, cwd?: string, projectRoot?: string, gitEnabled = false): Workspace {
    const id = randomUUID()
    const surfaceId = randomUUID()
    const workingDirectory = cwd || os.homedir()

    // create pty in main process, pass surface id so the env var matches
    const termInfo = this.terminals.create(workingDirectory, surfaceId)

    const workspace: Workspace = {
      id,
      title: title || 'project',
      kind: 'project',
      parentProjectId: null,
      focusedSurfaceId: surfaceId,
      workingDirectory,
      projectRoot: projectRoot || workingDirectory,
      gitEnabled,
      branchName: null,
      baseBranch: null,
    }

    const paneTree: PaneTree = { type: 'leaf', surfaceId, terminalId: termInfo.id }
    const entry = { workspace, paneTree }

    this.state.set(id, entry)
    // always switch to the new project
    this.activeWorkspaceId = id

    this.emitChange()

    // only resolve branch names for repos we already know are git backed
    if (gitEnabled) {
      resolveGitBranch(workingDirectory).then((branch) => {
        if (branch && this.state.has(id)) {
          entry.workspace.branchName = branch
          this.emitChange()
        }
      })
    }

    return this.serializeWorkspace(entry)
  }

  list(): Workspace[] {
    return Array.from(this.state.values()).map((entry) => this.serializeWorkspace(entry))
  }

  listProjects(): Workspace[] {
    return this.list().filter((workspace) => workspace.kind === 'project')
  }

  get(id: string): Workspace | null {
    const entry = this.state.get(id)
    return entry ? this.serializeWorkspace(entry) : null
  }

  workspaceIdForSurface(surfaceId: string): string | null {
    for (const [workspaceId, entry] of this.state.entries()) {
      if (this.collectSurfaceIds(entry.paneTree).includes(surfaceId)) return workspaceId
    }
    return null
  }

  current(): Workspace | null {
    if (!this.activeWorkspaceId) return null
    const entry = this.state.get(this.activeWorkspaceId)
    return entry ? this.serializeWorkspace(entry) : null
  }

  projectIdForWorkspace(workspaceId: string | null | undefined): string | null {
    if (!workspaceId) return null
    const workspace = this.state.get(workspaceId)?.workspace || null
    if (!workspace) return null
    return workspace.parentProjectId || workspace.id
  }

  setProjectRoot(workspaceId: string, projectRoot: string): boolean {
    const entry = this.state.get(workspaceId)
    if (!entry) return false
    entry.workspace.projectRoot = projectRoot
    this.emitChange()
    return true
  }

  promoteProjectToGit(workspaceId: string, projectRoot: string, branchName: string | null): Workspace | null {
    const entry = this.state.get(workspaceId)
    if (!entry || entry.workspace.kind !== 'project') return null

    let changed = false
    if (!entry.workspace.gitEnabled) {
      entry.workspace.gitEnabled = true
      changed = true
    }
    if (projectRoot && entry.workspace.projectRoot !== projectRoot) {
      entry.workspace.projectRoot = projectRoot
      changed = true
    }
    if (entry.workspace.branchName !== branchName) {
      entry.workspace.branchName = branchName
      changed = true
    }

    if (changed) this.emitChange()
    return this.serializeWorkspace(entry)
  }

  createTask(
    parentProjectId: string,
    title: string,
    worktreePath: string,
    branchName: string,
    baseBranch: string,
  ): Workspace | null {
    const parent = this.state.get(parentProjectId)
    if (!parent || parent.workspace.kind !== 'project') return null

    const existing = this.findTaskEntry(parentProjectId, worktreePath, branchName)
    if (existing) {
      existing.workspace.title = title
      existing.workspace.gitEnabled = true
      existing.workspace.branchName = branchName
      existing.workspace.baseBranch = baseBranch
      existing.workspace.workingDirectory = worktreePath
      existing.workspace.projectRoot = worktreePath
      this.activeWorkspaceId = existing.workspace.id
      this.emitChange()
      return this.serializeWorkspace(existing)
    }

    const id = randomUUID()
    const surfaceId = randomUUID()
    const termInfo = this.terminals.create(worktreePath, surfaceId)

    const workspace: Workspace = {
      id,
      title,
      kind: 'task',
      parentProjectId,
      focusedSurfaceId: surfaceId,
      workingDirectory: worktreePath,
      projectRoot: worktreePath,
      gitEnabled: true,
      branchName,
      baseBranch,
    }

    const paneTree: PaneTree = { type: 'leaf', surfaceId, terminalId: termInfo.id }
    this.state.set(id, { workspace, paneTree })
    this.activeWorkspaceId = id
    this.emitChange()
    return this.serializeWorkspace({ workspace, paneTree })
  }

  syncRecoveredTasks(parentProjectId: string, tasks: RecoveredTaskWorkspace[]): Workspace[] {
    const parent = this.state.get(parentProjectId)
    if (!parent || parent.workspace.kind !== 'project') return []

    let changed = false
    const recovered: Workspace[] = []

    for (const task of tasks) {
      const existing = this.findTaskEntry(parentProjectId, task.worktreePath, task.branchName)
      if (existing) {
        const nextBaseBranch = task.baseBranch ?? existing.workspace.baseBranch
        if (
          existing.workspace.title !== task.title ||
          existing.workspace.gitEnabled !== true ||
          existing.workspace.branchName !== task.branchName ||
          existing.workspace.baseBranch !== nextBaseBranch ||
          existing.workspace.workingDirectory !== task.worktreePath ||
          existing.workspace.projectRoot !== task.worktreePath
        ) {
          existing.workspace.title = task.title
          existing.workspace.gitEnabled = true
          existing.workspace.branchName = task.branchName
          existing.workspace.baseBranch = nextBaseBranch
          existing.workspace.workingDirectory = task.worktreePath
          existing.workspace.projectRoot = task.worktreePath
          changed = true
        }
        recovered.push(this.serializeWorkspace(existing))
        continue
      }

      const id = randomUUID()
      const surfaceId = randomUUID()
      const termInfo = this.terminals.create(task.worktreePath, surfaceId)
      const workspace: Workspace = {
        id,
        title: task.title,
        kind: 'task',
        parentProjectId,
        focusedSurfaceId: surfaceId,
        workingDirectory: task.worktreePath,
        projectRoot: task.worktreePath,
        gitEnabled: true,
        branchName: task.branchName,
        baseBranch: task.baseBranch,
      }
      const paneTree: PaneTree = { type: 'leaf', surfaceId, terminalId: termInfo.id }
      const entry = { workspace, paneTree }
      this.state.set(id, entry)
      recovered.push(this.serializeWorkspace(entry))
      changed = true
    }

    if (changed) this.emitChange()
    return recovered
  }

  select(id: string): boolean {
    if (!this.state.has(id)) return false
    this.activeWorkspaceId = id
    this.emitChange()
    return true
  }

  cycleWorkspace(direction: WorkspaceCycleDirection): string | null {
    const orderedIds = this.getVisibleWorkspaceOrder()
    if (orderedIds.length <= 1) return null

    const currentIndex = this.activeWorkspaceId ? orderedIds.indexOf(this.activeWorkspaceId) : -1
    const offset = direction === 'next' ? 1 : -1
    const nextIndex =
      currentIndex === -1
        ? direction === 'next'
          ? 0
          : orderedIds.length - 1
        : (currentIndex + offset + orderedIds.length) % orderedIds.length
    const nextId = orderedIds[nextIndex]

    if (!nextId || nextId === this.activeWorkspaceId) return null
    this.activeWorkspaceId = nextId
    this.emitChange()
    return nextId
  }

  close(id: string): boolean {
    const entry = this.state.get(id)
    if (!entry) return false

    const removeIds =
      entry.workspace.kind === 'project'
        ? [
            id,
            ...Array.from(this.state.values())
              .filter((child) => child.workspace.parentProjectId === id)
              .map((child) => child.workspace.id),
          ]
        : [id]

    for (const removeId of removeIds) {
      const removeEntry = this.state.get(removeId)
      if (!removeEntry) continue
      const termIds = this.collectTerminalIds(removeEntry.paneTree)
      for (const tid of termIds) this.terminals.destroy(tid)
      this.state.delete(removeId)
    }

    if (this.activeWorkspaceId === id) {
      const fallbackParentId = entry.workspace.parentProjectId
      if (fallbackParentId && this.state.has(fallbackParentId)) {
        this.activeWorkspaceId = fallbackParentId
      } else {
        const remainingProjects = this.listProjects()
        this.activeWorkspaceId = remainingProjects[0]?.id || Array.from(this.state.keys())[0] || null
      }
    } else if (this.activeWorkspaceId && !this.state.has(this.activeWorkspaceId)) {
      const parentId = entry.workspace.parentProjectId
      this.activeWorkspaceId =
        parentId && this.state.has(parentId)
          ? parentId
          : this.listProjects()[0]?.id || Array.from(this.state.keys())[0] || null
    }

    this.emitChange()
    return true
  }

  getTree(workspaceId?: string): PaneTree | null {
    const id = workspaceId || this.activeWorkspaceId
    if (!id) return null
    return this.state.get(id)?.paneTree || null
  }

  createPane(workspaceId: string): boolean {
    const entry = this.state.get(workspaceId)
    if (!entry || entry.paneTree) return false

    const surfaceId = randomUUID()
    const termInfo = this.terminals.create(entry.workspace.workingDirectory, surfaceId)
    entry.paneTree = { type: 'leaf', surfaceId, terminalId: termInfo.id }
    entry.workspace.focusedSurfaceId = surfaceId

    this.emitChange()
    return true
  }

  splitFocused(direction: 'horizontal' | 'vertical'): boolean {
    const ws = this.activeWorkspaceId ? this.state.get(this.activeWorkspaceId) : null
    if (!ws || !ws.workspace.focusedSurfaceId) return false
    return this.splitSurface(ws.workspace.focusedSurfaceId, direction)
  }

  splitSurface(surfaceId: string, direction: 'horizontal' | 'vertical'): boolean {
    for (const entry of this.state.values()) {
      if (!entry.paneTree || !this.collectSurfaceIds(entry.paneTree).includes(surfaceId)) continue

      const newSurfaceId = randomUUID()
      const focusedTerminalId = this.findTerminalId(entry.paneTree, surfaceId)
      const splitCwd = focusedTerminalId ? this.terminals.getCwd(focusedTerminalId) : entry.workspace.workingDirectory
      const termInfo = this.terminals.create(splitCwd, newSurfaceId)

      entry.paneTree = this.splitLeaf(entry.paneTree, surfaceId, newSurfaceId, termInfo.id, direction)
      entry.workspace.focusedSurfaceId = newSurfaceId
      this.emitChange()
      return true
    }

    return false
  }

  closeFocused(): boolean {
    const ws = this.activeWorkspaceId ? this.state.get(this.activeWorkspaceId) : null
    if (!ws || !ws.workspace.focusedSurfaceId) return false
    return this.closeSurface(ws.workspace.focusedSurfaceId)
  }

  closeSurface(surfaceId: string): boolean {
    for (const entry of this.state.values()) {
      if (!entry.paneTree || !this.collectSurfaceIds(entry.paneTree).includes(surfaceId)) continue

      const termId = this.findTerminalId(entry.paneTree, surfaceId)
      if (termId) {
        entry.workspace.workingDirectory = this.terminals.getCwd(termId)
        this.terminals.destroy(termId)
      }

      entry.paneTree = this.removeLeaf(entry.paneTree, surfaceId)
      const remaining = this.collectSurfaceIds(entry.paneTree)
      entry.workspace.focusedSurfaceId = remaining[0] || null

      this.emitChange()
      return true
    }

    return false
  }

  focusSurface(surfaceId: string): boolean {
    for (const entry of this.state.values()) {
      const ids = this.collectSurfaceIds(entry.paneTree)
      if (ids.includes(surfaceId)) {
        entry.workspace.focusedSurfaceId = surfaceId
        this.emit('change')
        return true
      }
    }
    return false
  }

  moveFocus(direction: FocusDirection): boolean {
    const ws = this.activeWorkspaceId ? this.state.get(this.activeWorkspaceId) : null
    const focusedSurfaceId = ws?.workspace.focusedSurfaceId
    if (!ws || !ws.paneTree || !focusedSurfaceId) return false

    const path = this.findSurfacePath(ws.paneTree, focusedSurfaceId)
    if (!path) return false

    const siblingPath = this.findAdjacentPath(ws.paneTree, path, direction)
    if (!siblingPath) return false

    const nextSurfaceId = this.resolveSurfaceIdAtPath(ws.paneTree, siblingPath)
    if (!nextSurfaceId || nextSurfaceId === focusedSurfaceId) return false

    ws.workspace.focusedSurfaceId = nextSurfaceId
    this.emit('change')
    return true
  }

  workspaceForTerminal(terminalId: string): string | null {
    for (const [workspaceId, entry] of this.state.entries()) {
      if (this.collectTerminalIds(entry.paneTree).includes(terminalId)) return workspaceId
    }
    return null
  }

  surfacesForWorkspace(workspaceId: string): string[] {
    const ws = this.state.get(workspaceId)
    if (!ws) return []
    return this.collectSurfaceIds(ws.paneTree)
  }

  focusedCwd(workspaceId?: string): string | null {
    const id = workspaceId || this.activeWorkspaceId
    if (!id) return null
    const entry = this.state.get(id)
    if (!entry) return null
    if (!entry.workspace.focusedSurfaceId || !entry.paneTree) return entry.workspace.workingDirectory
    const terminalId = this.findTerminalId(entry.paneTree, entry.workspace.focusedSurfaceId)
    return terminalId ? this.terminals.getCwd(terminalId) : entry.workspace.workingDirectory
  }

  snapshotWorkspace(id: string): SavedWorkspaceState | null {
    const entry = this.state.get(id)
    if (!entry) return null
    return {
      id: entry.workspace.id,
      title: entry.workspace.title,
      kind: entry.workspace.kind,
      parentProjectId: entry.workspace.parentProjectId,
      focusedSurfaceId: entry.workspace.focusedSurfaceId,
      workingDirectory: entry.workspace.workingDirectory,
      projectRoot: entry.workspace.projectRoot,
      gitEnabled: entry.workspace.gitEnabled,
      branchName: entry.workspace.branchName,
      baseBranch: entry.workspace.baseBranch,
      paneTree: this.stripTerminalIds(entry.paneTree),
    }
  }

  restoreWorkspace(snapshot: SavedWorkspaceState): Workspace | null {
    const paneTree = this.restoreTerminalIds(snapshot.paneTree, snapshot.workingDirectory)
    const surfaceIds = this.collectSurfaceIds(paneTree)
    const workspace: Workspace = {
      id: snapshot.id,
      title: snapshot.title,
      kind: snapshot.kind,
      parentProjectId: snapshot.parentProjectId,
      focusedSurfaceId: surfaceIds.includes(snapshot.focusedSurfaceId || '')
        ? snapshot.focusedSurfaceId
        : surfaceIds[0] || null,
      workingDirectory: snapshot.workingDirectory,
      projectRoot: snapshot.projectRoot,
      gitEnabled: snapshot.kind === 'task' ? true : Boolean(snapshot.gitEnabled ?? snapshot.branchName),
      branchName: snapshot.branchName,
      baseBranch: snapshot.baseBranch,
    }

    this.state.set(snapshot.id, { workspace, paneTree })
    this.activeWorkspaceId = snapshot.id
    this.emitChange()
    return this.serializeWorkspace({ workspace, paneTree })
  }

  collectSurfaceIds(tree: PaneTree | null): string[] {
    if (!tree) return []
    if (tree.type === 'leaf') return [tree.surfaceId]
    return [...this.collectSurfaceIds(tree.first), ...this.collectSurfaceIds(tree.second)]
  }

  // persistence: save layout to disk
  save(): void {
    try {
      const dir = path.dirname(STATE_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

      const data = {
        activeWorkspaceId: this.activeWorkspaceId,
        workspaces: Array.from(this.state.entries()).map(([id, entry]) => ({
          id,
          title: entry.workspace.title,
          kind: entry.workspace.kind,
          parentProjectId: entry.workspace.parentProjectId,
          focusedSurfaceId: entry.workspace.focusedSurfaceId,
          workingDirectory: entry.workspace.workingDirectory,
          projectRoot: entry.workspace.projectRoot,
          gitEnabled: entry.workspace.gitEnabled,
          branchName: entry.workspace.branchName,
          baseBranch: entry.workspace.baseBranch,
          // save tree structure without terminal ids (they'll be recreated)
          paneTree: this.stripTerminalIds(entry.paneTree),
        })),
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf-8')
    } catch {
      // non-fatal
    }
  }

  // persistence: restore layout from disk (creates new ptys)
  load(): void {
    try {
      if (!fs.existsSync(STATE_FILE)) return
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))

      for (const ws of raw.workspaces || []) {
        const normalizedWorkingDirectory =
          typeof ws.workingDirectory === 'string' ? normalizePath(ws.workingDirectory) : ''
        const isLegacyTask =
          ws.kind === 'task' && normalizedWorkingDirectory.startsWith(`${normalizePath(LEGACY_TASK_ROOT)}/`)
        const isMissingTaskPath =
          ws.kind === 'task' && (!normalizedWorkingDirectory || !fs.existsSync(ws.workingDirectory))
        if (isLegacyTask || isMissingTaskPath) continue

        const paneTree = this.restoreTerminalIds(ws.paneTree, ws.workingDirectory)
        const surfaceIds = this.collectSurfaceIds(paneTree)

        const workspace: Workspace = {
          id: ws.id,
          title: ws.title,
          kind: ws.kind || 'project',
          parentProjectId: ws.parentProjectId || null,
          focusedSurfaceId: surfaceIds.includes(ws.focusedSurfaceId) ? ws.focusedSurfaceId : surfaceIds[0] || null,
          workingDirectory: ws.workingDirectory,
          projectRoot: ws.projectRoot || ws.workingDirectory,
          // old state files will not have gitEnabled so fall back to branch data when needed
          gitEnabled: ws.kind === 'task' ? true : Boolean(ws.gitEnabled ?? ws.branchName),
          branchName: ws.branchName || null,
          baseBranch: ws.baseBranch || null,
        }

        this.state.set(ws.id, { workspace, paneTree })
      }

      for (const [id, entry] of Array.from(this.state.entries())) {
        if (
          entry.workspace.kind === 'task' &&
          entry.workspace.parentProjectId &&
          !this.state.has(entry.workspace.parentProjectId)
        ) {
          const termIds = this.collectTerminalIds(entry.paneTree)
          for (const tid of termIds) this.terminals.destroy(tid)
          this.state.delete(id)
        }
      }

      this.activeWorkspaceId = raw.activeWorkspaceId || null
      if (this.activeWorkspaceId && !this.state.has(this.activeWorkspaceId)) {
        this.activeWorkspaceId = this.listProjects()[0]?.id || Array.from(this.state.keys())[0] || null
      }

      this.emit('change')
    } catch {
      // corrupted state file, start fresh
    }
  }

  private emitChange(): void {
    this.emit('change')
  }

  private serializeWorkspace(entry: WorkspaceState): Workspace {
    const surfaceIds = this.collectSurfaceIds(entry.paneTree)
    return {
      ...entry.workspace,
      paneCount: surfaceIds.length,
      surfaceIds,
    }
  }

  private splitLeaf(
    tree: PaneTree,
    targetId: string,
    newSurfaceId: string,
    newTerminalId: string,
    direction: 'horizontal' | 'vertical',
  ): PaneTree {
    if (tree.type === 'leaf') {
      if (tree.surfaceId === targetId) {
        return {
          type: 'split',
          direction,
          first: tree,
          second: { type: 'leaf', surfaceId: newSurfaceId, terminalId: newTerminalId },
        }
      }
      return tree
    }
    return {
      ...tree,
      first: this.splitLeaf(tree.first, targetId, newSurfaceId, newTerminalId, direction),
      second: this.splitLeaf(tree.second, targetId, newSurfaceId, newTerminalId, direction),
    }
  }

  private removeLeaf(tree: PaneTree, targetId: string): PaneTree | null {
    if (tree.type === 'leaf') {
      return tree.surfaceId === targetId ? null : tree
    }
    const first = this.removeLeaf(tree.first, targetId)
    const second = this.removeLeaf(tree.second, targetId)
    if (!first) return second
    if (!second) return first
    return { ...tree, first, second }
  }

  private findTerminalId(tree: PaneTree | null, surfaceId: string): string | null {
    if (!tree) return null
    if (tree.type === 'leaf') {
      return tree.surfaceId === surfaceId ? tree.terminalId : null
    }
    return this.findTerminalId(tree.first, surfaceId) || this.findTerminalId(tree.second, surfaceId)
  }

  private collectTerminalIds(tree: PaneTree | null): string[] {
    if (!tree) return []
    if (tree.type === 'leaf') return [tree.terminalId]
    return [...this.collectTerminalIds(tree.first), ...this.collectTerminalIds(tree.second)]
  }

  private getVisibleWorkspaceOrder(): string[] {
    const orderedIds: string[] = []
    const projects = Array.from(this.state.values())
      .map((entry) => entry.workspace)
      .filter((workspace) => workspace.kind === 'project')

    for (const project of projects) {
      orderedIds.push(project.id)
      const tasks = Array.from(this.state.values())
        .map((entry) => entry.workspace)
        .filter((workspace) => workspace.kind === 'task' && workspace.parentProjectId === project.id)
      for (const task of tasks) orderedIds.push(task.id)
    }

    return orderedIds
  }

  private findTaskEntry(parentProjectId: string, worktreePath: string, branchName: string): WorkspaceState | null {
    for (const entry of this.state.values()) {
      const workspace = entry.workspace
      if (workspace.kind !== 'task' || workspace.parentProjectId !== parentProjectId) continue
      if (workspace.workingDirectory === worktreePath) return entry
      if (workspace.branchName === branchName) return entry
    }
    return null
  }

  private findSurfacePath(tree: PaneTree, surfaceId: string, path: PathStep[] = []): PathStep[] | null {
    if (tree.type === 'leaf') return tree.surfaceId === surfaceId ? path : null
    return (
      this.findSurfacePath(tree.first, surfaceId, [...path, 'first']) ||
      this.findSurfacePath(tree.second, surfaceId, [...path, 'second'])
    )
  }

  private findAdjacentPath(tree: PaneTree, path: PathStep[], direction: FocusDirection): PathStep[] | null {
    const orientation = direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical'
    const targetSide: PathStep = direction === 'left' || direction === 'up' ? 'first' : 'second'
    const oppositeSide: PathStep = targetSide === 'first' ? 'second' : 'first'

    for (let depth = path.length - 1; depth >= 0; depth--) {
      const parent = this.resolveNodeAtPath(tree, path.slice(0, depth))
      if (!parent || parent.type === 'leaf' || parent.direction !== orientation) continue
      if (path[depth] !== oppositeSide) continue

      const siblingBranch = targetSide === 'first' ? parent.first : parent.second
      return [...path.slice(0, depth), targetSide, ...this.edgePathForDirection(siblingBranch, direction)]
    }

    return null
  }

  private edgePathForDirection(tree: PaneTree, direction: FocusDirection): PathStep[] {
    if (tree.type === 'leaf') return []

    const preferredSide: PathStep =
      direction === 'left' ? 'second' : direction === 'right' ? 'first' : direction === 'up' ? 'second' : 'first'

    const nextTree = preferredSide === 'first' ? tree.first : tree.second
    return [preferredSide, ...this.edgePathForDirection(nextTree, direction)]
  }

  private resolveNodeAtPath(tree: PaneTree, path: PathStep[]): PaneTree | null {
    let current: PaneTree = tree
    for (const step of path) {
      if (current.type === 'leaf') return null
      current = step === 'first' ? current.first : current.second
    }
    return current
  }

  private resolveSurfaceIdAtPath(tree: PaneTree, path: PathStep[]): string | null {
    const node = this.resolveNodeAtPath(tree, path)
    return node?.type === 'leaf' ? node.surfaceId : null
  }

  // serialize tree for saving (strip terminal ids, add per-leaf cwd)
  private stripTerminalIds(tree: PaneTree | null): SavedPaneTree | null {
    if (!tree) return null
    if (tree.type === 'leaf') {
      return { type: 'leaf', surfaceId: tree.surfaceId, cwd: this.terminals.getCwd(tree.terminalId) }
    }
    return {
      type: 'split',
      direction: tree.direction,
      first: this.stripTerminalIds(tree.first)!,
      second: this.stripTerminalIds(tree.second)!,
    }
  }

  // deserialize tree on load (spawn new ptys with per-leaf cwd)
  private restoreTerminalIds(tree: SavedPaneTree | null, fallbackCwd: string): PaneTree | null {
    if (!tree) return null
    if (tree.type === 'leaf') {
      // validate saved cwd is an actual directory, fall back if not
      let leafCwd = fallbackCwd
      if (tree.cwd) {
        try {
          if (fs.existsSync(tree.cwd) && fs.statSync(tree.cwd).isDirectory()) {
            leafCwd = tree.cwd
          }
        } catch {
          // saved cwd validation failed, use fallback
        }
      }
      const sid = tree.surfaceId || randomUUID()
      const termInfo = this.terminals.create(leafCwd, sid)
      return { type: 'leaf', surfaceId: sid, terminalId: termInfo.id }
    }
    return {
      type: 'split',
      direction: tree.direction,
      first: this.restoreTerminalIds(tree.first, fallbackCwd)!,
      second: this.restoreTerminalIds(tree.second, fallbackCwd)!,
    }
  }
}
