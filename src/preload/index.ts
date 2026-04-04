// the bridge between electron main and renderer
// this file runs in a context that can talk to both sides
// it exposes window.mux to the renderer with typed ipc methods
// types are duplicated here because preload cant import from the renderer
import { contextBridge, ipcRenderer } from 'electron'

interface PreloadWorkspace {
  id: string
  title: string
  kind: 'project' | 'task'
  parentProjectId: string | null
  focusedSurfaceId: string | null
  workingDirectory?: string
  projectRoot?: string
  branchName?: string | null
  baseBranch?: string | null
  paneCount?: number
  surfaceIds?: string[]
}

type PreloadPaneTree =
  | { type: 'leaf'; surfaceId: string; terminalId: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; first: PreloadPaneTree; second: PreloadPaneTree }

interface PreloadWorkspaceSnapshot {
  workspaces: PreloadWorkspace[]
  activeWorkspaceId: string | null
  tree: PreloadPaneTree | null
  focusedSurfaceId: string | null
}

interface PreloadHookSurfaceStatus {
  status: 'running' | 'finished' | 'failed'
  eventName: string
  receivedAt: number
}

interface PreloadAgentToastEvent {
  status: 'running' | 'finished' | 'failed'
  workspaceId: string
  workspaceTitle: string
  tool: string
}

type PreloadEditorKind = 'cursor' | 'vscode' | 'zed' | 'explorer'
type PreloadEditorLaunchTarget = 'preferred' | PreloadEditorKind
type PreloadShortcutAction = 'toggle-sidebar' | 'find' | 'find-projects'

// each invoke sends a message to main and awaits the response
// each on listener subscribes to events from main and returns a cleanup function
const api = {
  // shell management (create, write keystrokes, resize, destroy)
  terminal: {
    create: (cwd?: string) => ipcRenderer.invoke('terminal:create', cwd),
    write: (id: string, data: string) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    destroy: (id: string) => ipcRenderer.invoke('terminal:destroy', id),
    onData: (cb: (id: string, data: string) => void) => {
      const handler = (_: unknown, id: string, data: string) => cb(id, data)
      ipcRenderer.on('terminal:data', handler)
      return () => {
        ipcRenderer.removeListener('terminal:data', handler)
      }
    },
    onExit: (cb: (id: string, code: number) => void) => {
      const handler = (_: unknown, id: string, code: number) => cb(id, code)
      ipcRenderer.on('terminal:exit', handler)
      return () => {
        ipcRenderer.removeListener('terminal:exit', handler)
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

contextBridge.exposeInMainWorld('mux', api)
