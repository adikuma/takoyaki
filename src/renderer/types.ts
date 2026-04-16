import type {
  ClaudeActivityState,
  ClaudeRuntimeEvent,
  ClaudeSurfaceStatus,
  ManagedClaudeHookEvent,
} from '../shared/claude-status'
import type { BrowserPanelBounds, BrowserPanelState } from '../shared/browser'

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
  gitEnabled?: boolean
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
  | { type: 'leaf'; surfaceId: string; terminalId: string; fontSize: number }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; first: PaneTree; second: PaneTree }

// state of the application to reload on app restart
export interface WorkspaceSnapshot {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  tree: PaneTree | null
  focusedSurfaceId: string | null
}

export type HookStatusState = ClaudeActivityState
export type HookSurfaceStatus = ClaudeSurfaceStatus
export type HookRuntimeEvent = ClaudeRuntimeEvent

export type HookCommandState = 'current' | 'missing' | 'invalid'

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
  hookStates: Record<ManagedClaudeHookEvent, HookCommandState>
  installedHooks: Record<ManagedClaudeHookEvent, boolean>
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

export interface WindowsPtyInfo {
  backend: 'conpty'
  buildNumber: number
}

export interface TerminalRuntimeInfo {
  platform: string
  windowsPty: WindowsPtyInfo | null
}

export type TerminalSessionStatus = 'running' | 'exited' | 'error'

export interface TerminalSnapshot {
  terminalId: string
  cwd: string
  title: string | null
  cols: number
  rows: number
  status: TerminalSessionStatus
  pid: number | null
  serializedState: string
  history: string
  exitCode: number | null
  exitSignal: number | null
  lastEventId: number
  updatedAt: string
}

export interface TerminalMetadata {
  terminalId: string
  cwd: string
  title: string | null
  updatedAt: string
}

export type TerminalEvent =
  | {
      terminalId: string
      eventId: number
      createdAt: string
      type: 'started'
      snapshot: TerminalSnapshot
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
      type: 'metadata'
      cwd: string
      title: string | null
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

export type ReviewView = 'terminal' | 'review'
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

export type ShortcutAction = 'toggle-sidebar' | 'find' | 'find-projects' | 'toggle-pane-focus'

// just declaring that these methods exist on window.takoyaki as well
declare global {
  interface Window {
    takoyakiOpenSettings?: () => void
    takoyaki: {
      clipboard: {
        readText: () => Promise<string>
        writeText: (text: string) => Promise<void>
      }
      browser: {
        getState: () => Promise<BrowserPanelState>
        toggle: (url?: string) => Promise<BrowserPanelState>
        show: (url?: string) => Promise<BrowserPanelState>
        hide: () => Promise<BrowserPanelState>
        navigate: (url: string) => Promise<BrowserPanelState>
        goBack: () => Promise<BrowserPanelState>
        goForward: () => Promise<BrowserPanelState>
        reload: () => Promise<BrowserPanelState>
        setBounds: (bounds: BrowserPanelBounds) => Promise<void>
        onStateChange: (cb: (state: BrowserPanelState) => void) => () => void
      }
      terminal: {
        create: (cwd?: string) => Promise<{ id: string; pid: number; cwd: string }>
        open: (id: string) => Promise<TerminalSnapshot | null>
        metadata: (id: string) => Promise<TerminalMetadata | null>
        write: (id: string, data: string) => Promise<boolean>
        resize: (id: string, cols: number, rows: number) => Promise<void>
        destroy: (id: string) => Promise<boolean>
        getRuntimeInfo: () => Promise<TerminalRuntimeInfo>
        onEvent: (cb: (event: TerminalEvent) => void) => () => void
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
        createPane: (workspaceId: string) => Promise<boolean>
        splitSurface: (surfaceId: string, direction: 'horizontal' | 'vertical') => Promise<boolean>
        closeSurface: (surfaceId: string) => Promise<boolean>
        setSurfaceFontSize: (surfaceId: string, fontSize: number) => Promise<boolean>
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
      review: {
        getSnapshot: (workspaceId: string) => Promise<ReviewSnapshot>
        getFilePatch: (workspaceId: string, filePath: string) => Promise<ReviewPatch>
      }
      activity: {
        get: () => Promise<Record<string, number>>
        onChange: (cb: (data: Record<string, number>) => void) => () => void
      }
      preferences: {
        getPinnedProjectRoots: () => Promise<string[]>
        setPinnedProjectRoots: (projectRoots: string[]) => Promise<string[]>
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
        openExternal: (url: string) => Promise<boolean>
      }
      onShortcut: (cb: (action: ShortcutAction) => void) => () => void
    }
  }
}
