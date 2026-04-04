// domain types
// workspace is the main unit of organization in the application
export interface Workspace {
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

// the pane tree sent from main as a single json blob
// pane tree is a union of leaf and split nodes
// leaf is a single terminal pane and if leaf then i just need the surfaceId and terminalId
// split is a horizontal or vertical split of two panes and if split then i just need the direction and the first and second children (for more splits)
export type PaneTree =
  | { type: 'leaf'; surfaceId: string; terminalId: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; first: PaneTree; second: PaneTree }

// state of the application to reload on app restart
export interface WorkspaceSnapshot {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  tree: PaneTree | null
  focusedSurfaceId: string | null
}

// claude hook status states
export type HookStatusState = 'running' | 'finished' | 'failed'

// claude hook surface status
export interface HookSurfaceStatus {
  status: HookStatusState
  eventName: string
  receivedAt: number
}
// same thing but with surfaceId attached so mux knows WHICH pane it is at
export interface HookRuntimeEvent extends HookSurfaceStatus {
  surfaceId: string
}

// test result from claude hook
export interface HookTestResult {
  ok: boolean
  detail: string
  testedAt?: number
}

export interface HookDiagnostics {
  // file checks
  settingsPath: string
  notifyScriptPath: string
  socketAddrPath: string
  settingsExists: boolean
  notifyScriptExists: boolean
  // hook registration
  hookStates: {
    Stop: 'current' | 'legacy' | 'missing' | 'invalid'
    StopFailure: 'current' | 'legacy' | 'missing' | 'invalid'
    UserPromptSubmit: 'current' | 'legacy' | 'missing' | 'invalid'
  }
  installedHooks: {
    Stop: boolean
    StopFailure: boolean
    UserPromptSubmit: boolean
  }
  //socket
  socketAddress: string | null
  nodeExecutable: string | null
  restartRequired: boolean
  externalNote?: string
  lastInstalledAt?: number | null
  health: 'connected' | 'degraded' | 'missing'
  detail: string
  lastEvent?: HookRuntimeEvent | null
  lastTest?: HookTestResult | null
}

// result from creating a task
export interface CreateTaskResult {
  ok: boolean
  workspace?: Workspace | null
  detail?: string
}

// result from removing a task
export interface RemoveTaskResult {
  ok: boolean
  blocked: boolean
  detail: string
}

// agent toast event
export interface AgentToastEvent {
  status: HookStatusState
  workspaceId: string
  workspaceTitle: string
  tool: string
}

// editor kinds
export type EditorKind = 'cursor' | 'vscode' | 'zed' | 'explorer'
export type EditorLaunchTarget = 'preferred' | EditorKind

export interface EditorAvailability {
  kind: EditorKind
  available: boolean
}

export interface EditorOpenResult {
  ok: boolean
  detail: string
}

export type ShortcutAction = 'toggle-sidebar' | 'find' | 'find-projects'

// just declaring that these methods exist on windows.mux as well
declare global {
  interface Window {
    muxOpenSettings?: () => void
    mux: {
      terminal: {
        create: (cwd?: string) => Promise<{ id: string; pid: number; cwd: string }>
        write: (id: string, data: string) => Promise<boolean>
        resize: (id: string, cols: number, rows: number) => Promise<void>
        destroy: (id: string) => Promise<boolean>
        onData: (cb: (id: string, data: string) => void) => () => void
        onExit: (cb: (id: string, code: number) => void) => () => void
      }
      workspace: {
        create: (title?: string, cwd?: string) => Promise<Workspace>
        openFolder: () => Promise<Workspace | null>
        list: () => Promise<Workspace[]>
        listBranches: (projectId: string) => Promise<string[]>
        createTask: (
          projectId: string,
          payload: { taskTitle: string; baseBranch?: string; branchName?: string },
        ) => Promise<CreateTaskResult>
        removeTask: (taskId: string, force?: boolean) => Promise<RemoveTaskResult>
        cycleVisible: (direction: 'next' | 'prev') => Promise<string | null>
        select: (id: string) => Promise<boolean>
        close: (id: string) => Promise<boolean>
        current: () => Promise<Workspace | null>
        tree: (wsId?: string) => Promise<PaneTree | null>
        onChange: (cb: (snapshot: WorkspaceSnapshot) => void) => () => void
      }
      surface: {
        focus: (surfaceId: string) => Promise<boolean>
      }
      hooks: {
        shouldShow: () => Promise<boolean>
        install: () => Promise<boolean>
        dismiss: () => Promise<void>
        diagnostics: () => Promise<HookDiagnostics>
        test: () => Promise<HookTestResult>
      }
      editor: {
        getPreference: () => Promise<EditorKind>
        setPreference: (editor: EditorKind) => Promise<EditorKind>
        listAvailability: () => Promise<EditorAvailability[]>
        openWorkspace: (workspaceId: string, target?: EditorLaunchTarget) => Promise<EditorOpenResult>
      }
      activity: {
        get: () => Promise<Record<string, number>>
        onChange: (cb: (data: Record<string, number>) => void) => () => void
      }
      status: {
        onChange: (cb: (statuses: Record<string, HookSurfaceStatus>) => void) => () => void
      }
      session: {
        onSaved: (cb: () => void) => () => void
      }
      toast: {
        onAgentEvent: (cb: (event: AgentToastEvent) => void) => () => void
      }
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
      }
      onShortcut: (cb: (action: ShortcutAction) => void) => () => void
    }
  }
}
