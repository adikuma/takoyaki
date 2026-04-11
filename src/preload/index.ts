// the bridge between electron main and renderer
// this file runs in a context that can talk to both sides
// it exposes window.takoyaki to the renderer with typed ipc methods
// types are duplicated here because preload cant import from the renderer
import { contextBridge, ipcRenderer } from 'electron'
import type { ClaudeActivityState, ClaudeAttentionState } from '../shared/claude-status'

interface PreloadWorkspace {
  id: string
  title: string
  kind: 'project' | 'task'
  parentProjectId: string | null
  focusedSurfaceId: string | null
  workingDirectory?: string
  projectRoot?: string
  gitEnabled?: boolean
  branchName?: string | null
  baseBranch?: string | null
  paneCount?: number
  surfaceIds?: string[]
}

type PreloadPaneTree =
  | { type: 'leaf'; surfaceId: string; terminalId: string; fontSize: number }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; first: PreloadPaneTree; second: PreloadPaneTree }

interface PreloadWorkspaceSnapshot {
  workspaces: PreloadWorkspace[]
  activeWorkspaceId: string | null
  tree: PreloadPaneTree | null
  focusedSurfaceId: string | null
}

interface PreloadHookSurfaceStatus {
  activity: ClaudeActivityState
  attention: ClaudeAttentionState
  lastEventName: string | null
  lastUpdatedAt: number
  sessionPresent: boolean
  subagentCount: number
}

interface PreloadAgentToastEvent {
  status: ClaudeActivityState
  workspaceId: string
  workspaceTitle: string
  tool: string
}

interface PreloadWindowsPtyInfo {
  backend: 'conpty'
  buildNumber: number
}

interface PreloadTerminalRuntimeInfo {
  platform: string
  windowsPty: PreloadWindowsPtyInfo | null
}

type PreloadTerminalSessionStatus = 'running' | 'exited' | 'error'

interface PreloadTerminalSnapshot {
  terminalId: string
  cwd: string
  cols: number
  rows: number
  status: PreloadTerminalSessionStatus
  pid: number | null
  serializedState: string
  history: string
  exitCode: number | null
  exitSignal: number | null
  lastEventId: number
  updatedAt: string
}

type PreloadTerminalEvent =
  | {
      terminalId: string
      eventId: number
      createdAt: string
      type: 'started'
      snapshot: PreloadTerminalSnapshot
    }
  | {
      terminalId: string
      eventId: number
      createdAt: string
      type: 'output'
      data: string
    }
  | {
      terminalId: string
      eventId: number
      createdAt: string
      type: 'exited'
      exitCode: number | null
      exitSignal: number | null
    }
  | {
      terminalId: string
      eventId: number
      createdAt: string
      type: 'error'
      message: string
    }

type PreloadReviewFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'untracked'
type PreloadReviewRenderMode = 'text' | 'binary' | 'oversized'

interface PreloadReviewFile {
  path: string
  previousPath: string | null
  status: PreloadReviewFileStatus
  stagedStatus: string
  unstagedStatus: string
}

interface PreloadReviewSnapshot {
  workspaceId: string
  workspaceTitle: string
  branchName: string | null
  baseRef: 'HEAD'
  scopePath: string | null
  isReviewable: boolean
  detail: string | null
  files: PreloadReviewFile[]
}

interface PreloadReviewPatch {
  path: string
  previousPath: string | null
  status: PreloadReviewFileStatus
  renderMode: PreloadReviewRenderMode
  patch: string
  detail: string | null
}

type PreloadEditorKind = 'cursor' | 'vscode' | 'zed' | 'explorer'
type PreloadEditorLaunchTarget = 'preferred' | PreloadEditorKind
type PreloadShortcutAction = 'toggle-sidebar' | 'find' | 'find-projects'

// each invoke sends a message to main and awaits the response
// each on listener subscribes to events from main and returns a cleanup function
const api = {
  // system clipboard via main process (renderer is sandboxed)
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:read-text'),
    writeText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text),
  },
  // shell management (create, write keystrokes, resize, destroy)
  terminal: {
    create: (cwd?: string) => ipcRenderer.invoke('terminal:create', cwd),
    open: (id: string) => ipcRenderer.invoke('terminal:open', id) as Promise<PreloadTerminalSnapshot | null>,
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    destroy: (id: string) => ipcRenderer.invoke('terminal:destroy', id),
    getRuntimeInfo: () => ipcRenderer.invoke('terminal:get-runtime-info') as Promise<PreloadTerminalRuntimeInfo>,
    onEvent: (cb: (event: PreloadTerminalEvent) => void) => {
      const handler = (_: unknown, event: PreloadTerminalEvent) => cb(event)
      ipcRenderer.on('terminal:event', handler)
      return () => {
        ipcRenderer.removeListener('terminal:event', handler)
      }
    },
  },
  workspace: {
    create: (title?: string, cwd?: string) => ipcRenderer.invoke('workspace:create', title, cwd),
    openFolder: () => ipcRenderer.invoke('workspace:open-folder'),
    list: () => ipcRenderer.invoke('workspace:list'),
    listBranches: (projectId: string) => ipcRenderer.invoke('workspace:list-branches', projectId),
    createTask: (projectId: string, payload: { taskTitle: string; baseBranch?: string; branchName?: string }) =>
      ipcRenderer.invoke('workspace:create-task', projectId, payload),
    removeTask: (taskId: string, force?: boolean) => ipcRenderer.invoke('workspace:remove-task', taskId, force),
    cycleVisible: (direction: 'next' | 'prev') => ipcRenderer.invoke('workspace:cycle-visible', direction),
    select: (id: string) => ipcRenderer.invoke('workspace:select', id),
    close: (id: string) => ipcRenderer.invoke('workspace:close', id),
    createPane: (workspaceId: string) => ipcRenderer.invoke('workspace:create-pane', workspaceId),
    splitSurface: (surfaceId: string, direction: 'horizontal' | 'vertical') =>
      ipcRenderer.invoke('workspace:split-surface', surfaceId, direction),
    closeSurface: (surfaceId: string) => ipcRenderer.invoke('workspace:close-surface', surfaceId),
    setSurfaceFontSize: (surfaceId: string, fontSize: number) =>
      ipcRenderer.invoke('workspace:set-surface-font-size', surfaceId, fontSize),
    current: () => ipcRenderer.invoke('workspace:current'),
    tree: (wsId?: string) => ipcRenderer.invoke('workspace:tree', wsId),
    onChange: (cb: (snapshot: PreloadWorkspaceSnapshot) => void) => {
      const handler = (_: Electron.IpcRendererEvent, snapshot: PreloadWorkspaceSnapshot) => cb(snapshot)
      ipcRenderer.on('workspace:changed', handler)
      return () => {
        ipcRenderer.removeListener('workspace:changed', handler)
      }
    },
  },
  surface: {
    focus: (surfaceId: string) => ipcRenderer.invoke('surface:focus', surfaceId),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    openExternal: (url: string) => ipcRenderer.invoke('window:open-external', url) as Promise<boolean>,
  },
  hooks: {
    shouldShow: () => ipcRenderer.invoke('hooks:should-show'),
    install: () => ipcRenderer.invoke('hooks:install'),
    dismiss: () => ipcRenderer.invoke('hooks:dismiss'),
    diagnostics: () => ipcRenderer.invoke('hooks:diagnostics'),
    test: () => ipcRenderer.invoke('hooks:test'),
  },
  editor: {
    getPreference: () => ipcRenderer.invoke('editor:get-preference'),
    setPreference: (editor: PreloadEditorKind) => ipcRenderer.invoke('editor:set-preference', editor),
    listAvailability: () => ipcRenderer.invoke('editor:list-availability'),
    openWorkspace: (workspaceId: string, target?: PreloadEditorLaunchTarget) =>
      ipcRenderer.invoke('editor:open-workspace', workspaceId, target),
  },
  review: {
    getSnapshot: (workspaceId: string) =>
      ipcRenderer.invoke('review:get-snapshot', workspaceId) as Promise<PreloadReviewSnapshot>,
    getFilePatch: (workspaceId: string, filePath: string) =>
      ipcRenderer.invoke('review:get-file-patch', workspaceId, filePath) as Promise<PreloadReviewPatch>,
  },
  status: {
    onChange: (cb: (statuses: Record<string, PreloadHookSurfaceStatus>) => void) => {
      const handler = (_: Electron.IpcRendererEvent, statuses: Record<string, PreloadHookSurfaceStatus>) => cb(statuses)
      ipcRenderer.on('status:changed', handler)
      return () => {
        ipcRenderer.removeListener('status:changed', handler)
      }
    },
  },
  activity: {
    get: () => ipcRenderer.invoke('activity:get'),
    onChange: (cb: (data: Record<string, number>) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: Record<string, number>) => cb(data)
      ipcRenderer.on('activity:changed', handler)
      return () => {
        ipcRenderer.removeListener('activity:changed', handler)
      }
    },
  },
  preferences: {
    getPinnedProjectRoots: () => ipcRenderer.invoke('preferences:get-pinned-project-roots') as Promise<string[]>,
    setPinnedProjectRoots: (projectRoots: string[]) =>
      ipcRenderer.invoke('preferences:set-pinned-project-roots', projectRoots) as Promise<string[]>,
  },
  session: {
    onSaved: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('session:saved', handler)
      return () => {
        ipcRenderer.removeListener('session:saved', handler)
      }
    },
  },
  toast: {
    onAgentEvent: (cb: (event: PreloadAgentToastEvent) => void) => {
      const handler = (_: Electron.IpcRendererEvent, event: PreloadAgentToastEvent) => cb(event)
      ipcRenderer.on('toast:agent-event', handler)
      return () => {
        ipcRenderer.removeListener('toast:agent-event', handler)
      }
    },
  },
  onShortcut: (cb: (action: PreloadShortcutAction) => void) => {
    const handler = (_: Electron.IpcRendererEvent, action: PreloadShortcutAction) => cb(action)
    ipcRenderer.on('shortcut', handler)
    return () => {
      ipcRenderer.removeListener('shortcut', handler)
    }
  },
}

contextBridge.exposeInMainWorld('takoyaki', api)
