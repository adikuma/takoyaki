// electron main process entry

import { app, BrowserWindow, ipcMain, nativeTheme, dialog } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { TerminalManager } from './terminal'
import { WorkspaceManager } from './workspace'
import { RpcHandler } from './rpc'
import { SocketServer } from './socket-server'
import { GitWorktreeService } from './git-worktree'
import { EditorService, type EditorKind, type EditorLaunchTarget } from './editor'
import {
  shouldShowHooksBanner,
  installHooks,
  dismissHooksBanner,
  initializeHooks,
  getHookDiagnostics,
  testHooks,
} from './hooks'

let mainWindow: BrowserWindow | null = null
const terminals = new TerminalManager()
const workspaces = new WorkspaceManager(terminals)
const rpc = new RpcHandler(workspaces, terminals)
const socketServer = new SocketServer(rpc)
const worktreeService = new GitWorktreeService()
const editorService = new EditorService()

type HookStatusState = 'running' | 'finished' | 'failed'
interface SurfaceStatusRecord {
  status: HookStatusState
  eventName: string
  receivedAt: number
}

const RUNNING_STATUS_TTL_MS = 12_000
const surfaceStatuses = new Map<string, SurfaceStatusRecord>()
const runningExpiryTimers = new Map<string, NodeJS.Timeout>()
let lastHookEvent: ({ surfaceId: string } & SurfaceStatusRecord) | null = null
let lastHookTest: { ok: boolean; detail: string; testedAt: number } | null = null
let lastVisitedWorkspaceId: string | null = null
const workspaceLastActivity = new Map<string, number>()

// activity heatmap persistence
const ACTIVITY_FILE = path.join(os.homedir(), '.mux', 'activity.json')
let yearActivity: Record<string, number> = {}
let activityDirty = false
let activityFlushTimer: NodeJS.Timeout | null = null

function loadYearActivity(): void {
  try {
    if (fs.existsSync(ACTIVITY_FILE)) {
      yearActivity = JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf-8'))
    }
  } catch {
    yearActivity = {}
  }
}

function saveYearActivity(): void {
  if (!activityDirty) return
  try {
    const dir = path.dirname(ACTIVITY_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(yearActivity), 'utf-8')
    activityDirty = false
  } catch {
    // activity save failed, non-fatal
  }
}

function incrementDayActivity(): void {
  const today = new Date().toISOString().slice(0, 10)
  yearActivity[today] = (yearActivity[today] || 0) + 1
  activityDirty = true
  if (!activityFlushTimer) {
    activityFlushTimer = setTimeout(() => {
      activityFlushTimer = null
      saveYearActivity()
    }, 60_000)
  }
}

function sendActivity(): void {
  send('activity:changed', Object.fromEntries(workspaceLastActivity))
}

function noteWorkspaceActivity(workspaceId: string | null): void {
  if (!workspaceId) return
  const projectId = workspaces.projectIdForWorkspace(workspaceId) || workspaceId
  workspaceLastActivity.set(projectId, Date.now())
  incrementDayActivity()
  sendActivity()
}

function sendStatusUpdate(): void {
  send('status:changed', Object.fromEntries(surfaceStatuses))
}

async function waitForHookEvent(startedAt: number, surfaceId: string, status: string): Promise<boolean> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (
      lastHookEvent &&
      lastHookEvent.receivedAt >= startedAt &&
      lastHookEvent.surfaceId === surfaceId &&
      lastHookEvent.status === status
    ) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

function clearStatusesForWorkspace(workspaceId: string | null): void {
  if (!workspaceId) return
  let changed = false
  for (const surfaceId of workspaces.surfacesForWorkspace(workspaceId)) {
    const status = surfaceStatuses.get(surfaceId)
    if (status?.status === 'finished' || status?.status === 'failed') {
      clearRunningExpiry(surfaceId)
      surfaceStatuses.delete(surfaceId)
      changed = true
    }
  }
  if (changed) sendStatusUpdate()
}

function clearRunningExpiry(surfaceId: string): void {
  const timer = runningExpiryTimers.get(surfaceId)
  if (!timer) return
  clearTimeout(timer)
  runningExpiryTimers.delete(surfaceId)
}

function scheduleRunningExpiry(surfaceId: string, receivedAt: number): void {
  clearRunningExpiry(surfaceId)
  const timer = setTimeout(() => {
    const current = surfaceStatuses.get(surfaceId)
    if (!current || current.status !== 'running' || current.receivedAt !== receivedAt) return
    surfaceStatuses.delete(surfaceId)
    runningExpiryTimers.delete(surfaceId)
    sendStatusUpdate()
  }, RUNNING_STATUS_TTL_MS)
  runningExpiryTimers.set(surfaceId, timer)
}

function defaultEventName(status: HookStatusState): string {
  if (status === 'running') return 'UserPromptSubmit'
  if (status === 'failed') return 'StopFailure'
  return 'Stop'
}

rpc.onStatusUpdate = (surfaceId: string, update: { status: string; eventName: string }) => {
  if (!surfaceId) return

  const status = update.status as HookStatusState
  if (status !== 'running' && status !== 'finished' && status !== 'failed') return

  const record: SurfaceStatusRecord = {
    status,
    eventName: update.eventName || defaultEventName(status),
    receivedAt: Date.now(),
  }

  clearRunningExpiry(surfaceId)
  surfaceStatuses.set(surfaceId, record)
  if (record.status === 'running') {
    scheduleRunningExpiry(surfaceId, record.receivedAt)
  }

  lastHookEvent = { surfaceId, ...record }

  // resolve workspace for this surface and track activity
  const eventWsId = workspaces.workspaceIdForSurface(surfaceId)
  if (eventWsId) {
    noteWorkspaceActivity(eventWsId)
  }

  // send project-aware toast for finished/failed events (only for non-active workspaces)
  if ((status === 'finished' || status === 'failed') && eventWsId && eventWsId !== workspaces.activeWorkspaceId) {
    const ws = workspaces.get(eventWsId)
    if (ws) {
      send('toast:agent-event', { status, workspaceId: eventWsId, workspaceTitle: ws.title, tool: 'claude' })
    }
  }

  sendStatusUpdate()
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

async function recoverProjectTasks(projectId: string): Promise<void> {
  const project = workspaces.get(projectId)
  if (!project || project.kind !== 'project') return
  const recovered = await worktreeService.listManagedWorktrees(project.projectRoot || project.workingDirectory || '')
  if (!recovered.length) return
  workspaces.syncRecoveredTasks(
    projectId,
    recovered.map((task) => ({
      title: task.taskTitle,
      worktreePath: task.worktreePath,
      branchName: task.branchName,
      baseBranch: task.baseBranch,
    })),
  )
}

function noteSelection(workspaceId: string | null): void {
  if (!workspaceId) return
  noteWorkspaceActivity(workspaceId)
  const workspace = workspaces.get(workspaceId)
  if (workspace?.kind === 'project') {
    void recoverProjectTasks(workspaceId)
  }
}

async function openProjectFolder(): Promise<ReturnType<typeof workspaces.create> | null> {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Open project folder',
  })
  if (result.canceled || !result.filePaths[0]) return null

  const folderPath = result.filePaths[0]
  const projectRoot = await worktreeService.resolveProjectRoot(folderPath)
  const title = path.basename(projectRoot || folderPath)
  const workspace = workspaces.create(title, folderPath, projectRoot)
  await recoverProjectTasks(workspace.id)
  noteWorkspaceActivity(workspace.id)
  return workspace
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 360,
    minHeight: 520,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // keyboard shortcuts - executed in main process with fresh state
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!input.control && !input.meta) return
    if (input.type !== 'keyDown') return

    const key = input.key.toLowerCase()
    if (key === 'b' && !input.shift) {
      event.preventDefault()
      send('shortcut', 'toggle-sidebar')
    }
    if (key === 'd' && !input.shift) {
      event.preventDefault()
      workspaces.splitFocused('horizontal')
    }
    if (key === 'u' && !input.shift) {
      event.preventDefault()
      workspaces.splitFocused('vertical')
    }
    if (key === 'w' && !input.shift) {
      event.preventDefault()
      workspaces.closeFocused()
    }
    if (input.alt && (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown')) {
      event.preventDefault()
      const direction = key.replace('arrow', '') as 'left' | 'right' | 'up' | 'down'
      if (workspaces.moveFocus(direction)) noteWorkspaceActivity(workspaces.activeWorkspaceId)
    }
    // ctrl+f: find in terminal
    if (key === 'f' && !input.shift) {
      event.preventDefault()
      send('shortcut', 'find')
    }
    // ctrl+shift+f: focus sidebar project search
    if (key === 'f' && input.shift) {
      event.preventDefault()
      send('shortcut', 'find-projects')
    }
    // ctrl+o: open folder as new project
    if (key === 'o' && !input.shift) {
      event.preventDefault()
      void openProjectFolder()
    }
    // ctrl+shift+s: save session
    if (key === 's' && input.shift) {
      event.preventDefault()
      workspaces.save()
      send('session:saved')
    }
    // ctrl+1 through ctrl+9: jump to project by number
    if (key >= '1' && key <= '9' && !input.shift) {
      event.preventDefault()
      const list = workspaces.list().filter((workspace) => workspace.kind === 'project')
      const idx = parseInt(key) - 1
      if (idx < list.length && workspaces.select(list[idx].id)) noteSelection(list[idx].id)
    }
  })
}

function setupIpc(): void {
  // terminal
  ipcMain.handle('terminal:create', (_, cwd?: string) => terminals.create(cwd))
  ipcMain.handle('terminal:write', (_, id: string, data: string) => {
    // track keyboard input for workspace activity
    const wsId = workspaces.workspaceForTerminal(id)
    if (wsId) noteWorkspaceActivity(wsId)
    return terminals.write(id, data)
  })
  ipcMain.handle('terminal:resize', (_, id: string, cols: number, rows: number) => terminals.resize(id, cols, rows))
  ipcMain.handle('terminal:destroy', (_, id: string) => terminals.destroy(id))

  // workspace
  ipcMain.handle('workspace:create', (_, title?: string, cwd?: string) => {
    const workspace = workspaces.create(title, cwd)
    noteWorkspaceActivity(workspace.id)
    return workspace
  })
  ipcMain.handle('workspace:open-folder', () => openProjectFolder())
  ipcMain.handle('workspace:list', () => workspaces.list())
  ipcMain.handle('workspace:list-branches', async (_, projectId: string) => {
    const workspace = workspaces.get(projectId)
    if (!workspace || workspace.kind !== 'project') return []
    return worktreeService.listBranches(workspace.projectRoot)
  })
  ipcMain.handle(
    'workspace:create-task',
    async (_, projectId: string, payload: { taskTitle: string; baseBranch?: string; branchName?: string }) => {
      const project = workspaces.get(projectId)
      if (!project || project.kind !== 'project') {
        return { ok: false, detail: 'Project not found', workspace: null }
      }
      try {
        const created = await worktreeService.createTask({
          projectRoot: project.projectRoot || project.workingDirectory || '',
          taskTitle: payload.taskTitle,
          baseBranch: payload.baseBranch,
          branchName: payload.branchName,
        })
        const workspace = workspaces.createTask(
          projectId,
          created.taskTitle,
          created.worktreePath,
          created.branchName,
          created.baseBranch,
        )
        if (!workspace) {
          return { ok: false, detail: 'Task workspace could not be created', workspace: null }
        }
        noteWorkspaceActivity(projectId)
        return { ok: true, workspace, detail: 'Task created' }
      } catch (error) {
        return {
          ok: false,
          workspace: null,
          detail: error instanceof Error ? error.message : 'Unable to create task',
        }
      }
    },
  )
  ipcMain.handle('workspace:remove-task', async (_, taskId: string, force = false) => {
    const task = workspaces.get(taskId)
    if (!task || task.kind !== 'task' || !task.parentProjectId) {
      return { ok: false, blocked: false, detail: 'Task not found' }
    }

    const parentProject = workspaces.get(task.parentProjectId)
    if (!parentProject) {
      return { ok: false, blocked: false, detail: 'Parent project not found' }
    }

    const snapshot = workspaces.snapshotWorkspace(taskId)
    if (!snapshot) {
      return { ok: false, blocked: false, detail: 'Task could not be snapshotted' }
    }

    const isDirty = await worktreeService.isTaskDirty(task.workingDirectory || '')
    if (isDirty && !force) {
      return {
        ok: false,
        blocked: true,
        detail: 'Task has uncommitted changes. Force remove to delete the worktree.',
      }
    }

    workspaces.close(taskId)
    const removal = await worktreeService.removeTask(
      parentProject.projectRoot || parentProject.workingDirectory || '',
      task.workingDirectory || '',
      true,
    )
    if (!removal.ok) {
      workspaces.restoreWorkspace(snapshot)
      return removal
    }

    noteWorkspaceActivity(task.parentProjectId)
    return removal
  })
  ipcMain.handle('workspace:cycle-visible', (_, direction: 'next' | 'prev') => {
    const nextWorkspaceId = workspaces.cycleWorkspace(direction)
    noteSelection(nextWorkspaceId)
    return nextWorkspaceId
  })
  ipcMain.handle('workspace:select', (_, id: string) => {
    const selected = workspaces.select(id)
    if (selected) noteSelection(id)
    return selected
  })
  ipcMain.handle('workspace:close', (_, id: string) => workspaces.close(id))
  ipcMain.handle('workspace:current', () => workspaces.current())
  // pane tree - single call gets the full tree
  ipcMain.handle('workspace:tree', (_, wsId?: string) => workspaces.getTree(wsId))

  // surface
  ipcMain.handle('surface:focus', (_, surfaceId: string) => {
    const focused = workspaces.focusSurface(surfaceId)
    if (focused) noteWorkspaceActivity(workspaces.workspaceIdForSurface(surfaceId))
    return focused
  })

  // claude code hooks
  ipcMain.handle('hooks:should-show', () => shouldShowHooksBanner())
  ipcMain.handle('hooks:install', () => installHooks())
  ipcMain.handle('hooks:dismiss', () => dismissHooksBanner())
  ipcMain.handle('hooks:diagnostics', () => {
    const diagnostics = getHookDiagnostics()
    return {
      ...diagnostics,
      restartRequired: Boolean(
        diagnostics.lastInstalledAt && (!lastHookEvent || lastHookEvent.receivedAt < diagnostics.lastInstalledAt),
      ),
      lastEvent: lastHookEvent,
      lastTest: lastHookTest,
    }
  })
  ipcMain.handle('hooks:test', async () => {
    const current = workspaces.current()
    const focusedSurfaceId = current?.focusedSurfaceId || current?.surfaceIds?.[0] || `test-${Date.now()}`
    const startedAt = Date.now()
    const result = await testHooks(focusedSurfaceId, 'Stop')
    const delivered = result.ok ? await waitForHookEvent(startedAt, focusedSurfaceId, 'finished') : false
    const finalResult =
      result.ok && delivered
        ? { ok: true, detail: 'Hook script ran and status.update was received' }
        : { ok: false, detail: result.ok ? 'Hook script ran but no status.update was observed' : result.detail }
    lastHookTest = { ...finalResult, testedAt: Date.now() }
    return finalResult
  })

  // workspace activity
  ipcMain.handle('activity:get', () => Object.fromEntries(workspaceLastActivity))

  ipcMain.handle('editor:get-preference', () => editorService.getPreference())
  ipcMain.handle('editor:set-preference', (_, editor: EditorKind) => editorService.setPreference(editor))
  ipcMain.handle('editor:list-availability', () => editorService.listAvailability())
  ipcMain.handle('editor:open-workspace', async (_, workspaceId: string, target: EditorLaunchTarget = 'preferred') => {
    const workspace = workspaces.get(workspaceId)
    if (!workspace) {
      return { ok: false, detail: 'Workspace not found.' }
    }
    const targetPath =
      workspace.kind === 'task'
        ? workspace.workingDirectory || workspace.projectRoot || ''
        : workspace.projectRoot || workspace.workingDirectory || ''
    if (!targetPath) {
      return { ok: false, detail: 'Workspace path is unavailable.' }
    }
    if (workspace.kind === 'task') {
      if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
        return { ok: false, detail: 'Task folder no longer exists.' }
      }
      const repoRoot = await worktreeService.detectRepoRoot(targetPath)
      if (!repoRoot) {
        return { ok: false, detail: 'Task worktree is no longer valid.' }
      }
    }
    if (target !== 'preferred') {
      await editorService.setPreference(target)
    }
    return editorService.openPath(targetPath, target)
  })

  // window controls
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())

  // forward terminal events to renderer
  terminals.on('data', (id: string, data: string) => send('terminal:data', id, data))
  terminals.on('exit', (id: string, code: number) => send('terminal:exit', id, code))
  // send full snapshot on every change so renderer never needs to re-fetch
  workspaces.on('change', () => {
    const ws = workspaces.current()
    if (workspaces.activeWorkspaceId && workspaces.activeWorkspaceId !== lastVisitedWorkspaceId) {
      lastVisitedWorkspaceId = workspaces.activeWorkspaceId
      clearStatusesForWorkspace(workspaces.activeWorkspaceId)
    }
    send('workspace:changed', {
      workspaces: workspaces.list(),
      activeWorkspaceId: workspaces.activeWorkspaceId,
      tree: workspaces.getTree(),
      focusedSurfaceId: ws?.focusedSurfaceId || null,
    })
  })
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'
  loadYearActivity()
  initializeHooks()
  setupIpc()
  // restore saved layout before creating window
  workspaces.load()
  await Promise.all(workspaces.listProjects().map((project) => recoverProjectTasks(project.id)))
  lastVisitedWorkspaceId = workspaces.activeWorkspaceId
  await socketServer.start()
  createWindow()
})

app.on('window-all-closed', () => {
  saveYearActivity()
  terminals.destroyAll()
  socketServer.stop()
  app.quit()
})
