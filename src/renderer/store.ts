// this is my first time with zustand so don't roast me
import { create } from 'zustand'
import type {
  EditorAvailability,
  EditorKind,
  HookSurfaceStatus,
  ReviewPatch,
  ReviewSnapshot,
  ReviewView,
  Workspace,
} from './types'
import { normalizePinnedProjectRoot } from './pinned-projects'
import {
  createActivityOperationId,
  type ActivityOperation,
  type ActivityOperationStatus,
  type StartActivityOperationInput,
  type UpdateActivityOperationInput,
} from '../shared/activity'

// guard for when running outside electron (e.g. vite dev server in browser)
const api = typeof window !== 'undefined' && window.takoyaki ? window.takoyaki : null

interface ToastState {
  message: string
  workspaceId?: string
  dot?: string
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
const maxActivityOperations = 40

// normalizes unknown review errors into one renderer friendly message
function getReviewErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load review.'
}

interface MuxStore {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  sidebarCollapsed: boolean
  surfaceStatuses: Record<string, HookSurfaceStatus>
  ready: boolean

  refresh: () => Promise<void>
  openProjectFolder: () => Promise<void>
  selectWorkspace: (id: string) => void
  closeWorkspace: (id: string) => Promise<void>
  toggleSidebar: () => void
  setSurfaceStatuses: (statuses: Record<string, HookSurfaceStatus>) => void
  workspaceActivity: Record<string, number>
  setWorkspaceActivity: (data: Record<string, number>) => void
  pinnedProjectRoots: string[]
  loadPinnedProjects: () => Promise<void>
  togglePinnedProject: (projectRoot: string) => Promise<void>
  editorPreference: EditorKind
  editorAvailability: EditorAvailability[]
  loadEditorState: () => Promise<void>
  setEditorPreference: (editor: EditorKind) => Promise<EditorKind | null>
  theme: 'dark' | 'light'
  toggleTheme: () => void
  toast: ToastState | null
  showToast: (toast: ToastState, durationMs?: number) => void
  clearToast: () => void
  activityOperations: ActivityOperation[]
  activityPanelOpen: boolean
  startActivityOperation: (input: StartActivityOperationInput) => string
  updateActivityOperation: (id: string, input: UpdateActivityOperationInput) => void
  finishActivityOperation: (
    id: string,
    status: ActivityOperationStatus,
    input?: Omit<UpdateActivityOperationInput, 'status'>,
  ) => void
  clearActivityOperation: (id: string) => void
  clearFinishedActivityOperations: () => void
  toggleActivityPanel: () => void
  setActivityPanelOpen: (open: boolean) => void
  activeView: ReviewView
  reviewWorkspaceId: string | null
  selectedReviewFilePath: string | null
  reviewSnapshots: Record<string, ReviewSnapshot | undefined>
  reviewPatches: Record<string, Record<string, ReviewPatch | undefined> | undefined>
  reviewFocusMode: boolean
  paneFocusSurfaceId: string | null
  reviewLoading: boolean
  reviewPatchLoading: boolean
  reviewError: string | null
  openReview: (workspaceId: string) => Promise<void>
  closeReview: () => void
  refreshReview: () => Promise<void>
  selectReviewFile: (filePath: string) => Promise<void>
  toggleReviewFocusMode: () => void
  togglePaneFocusMode: (surfaceId: string) => void
  setPaneFocusSurfaceId: (surfaceId: string | null) => void
  clearPaneFocusMode: () => void
}

export const useStore = create<MuxStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  sidebarCollapsed: false,
  surfaceStatuses: {},
  ready: false,

  refresh: async () => {
    if (!api) return
    const workspaces = await api.workspace.list()
    const current = await api.workspace.current()
    set({ workspaces, activeWorkspaceId: current?.id || null, ready: true })
  },

  openProjectFolder: async () => {
    if (!api) return
    const operationId = get().startActivityOperation({
      kind: 'workspace',
      title: 'Opening project',
      detail: 'Waiting for folder selection.',
    })
    try {
      const ws = await api.workspace.openFolder()
      if (!ws) {
        get().finishActivityOperation(operationId, 'blocked', {
          title: 'Project open canceled',
          detail: 'No folder was selected.',
        })
        return
      }
      set({ activeWorkspaceId: ws.id })
      get().finishActivityOperation(operationId, 'success', {
        title: 'Project opened',
        detail: ws.title,
        workspaceId: ws.id,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unable to open project.'
      get().finishActivityOperation(operationId, 'failed', { title: 'Project open failed', detail })
      get().showToast(
        { message: 'Project open failed. Open Activity for details.', dot: 'var(--takoyaki-error)' },
        4200,
      )
    }
  },

  selectWorkspace: async (id) => {
    if (!api) return
    set({
      activeWorkspaceId: id,
      activeView: 'terminal',
      reviewWorkspaceId: null,
      selectedReviewFilePath: null,
      reviewFocusMode: false,
      paneFocusSurfaceId: null,
    })
    await api.workspace.select(id)
  },

  closeWorkspace: async (id) => {
    if (!api) return
    const workspace = get().workspaces.find((candidate) => candidate.id === id)
    const operationId = get().startActivityOperation({
      kind: 'workspace',
      title: workspace?.kind === 'project' ? 'Closing project' : 'Closing workspace',
      detail: workspace?.title || id,
      workspaceId: id,
    })
    try {
      const ok = await api.workspace.close(id)
      get().finishActivityOperation(operationId, ok ? 'success' : 'failed', {
        title: ok ? 'Workspace closed' : 'Workspace close failed',
        detail: workspace?.title || id,
      })
      if (!ok) {
        get().showToast(
          { message: 'Workspace close failed. Open Activity for details.', dot: 'var(--takoyaki-error)' },
          4200,
        )
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unable to close workspace.'
      get().finishActivityOperation(operationId, 'failed', { title: 'Workspace close failed', detail })
      get().showToast(
        { message: 'Workspace close failed. Open Activity for details.', dot: 'var(--takoyaki-error)' },
        4200,
      )
    }
  },

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setSurfaceStatuses: (statuses: Record<string, HookSurfaceStatus>) => set({ surfaceStatuses: statuses }),

  workspaceActivity: {},
  setWorkspaceActivity: (data: Record<string, number>) => set({ workspaceActivity: data }),

  pinnedProjectRoots: [],
  loadPinnedProjects: async () => {
    if (!api?.preferences) return
    const pinnedProjectRoots = await api.preferences.getPinnedProjectRoots()
    set({ pinnedProjectRoots })
  },
  togglePinnedProject: async (projectRoot) => {
    if (!api?.preferences) return

    // match the local optimistic update with the shape saved by main
    const normalizedProjectRoot = normalizePinnedProjectRoot(projectRoot)
    const current = get().pinnedProjectRoots
    const next = current.includes(normalizedProjectRoot)
      ? current.filter((root) => root !== normalizedProjectRoot)
      : [...current, normalizedProjectRoot]

    set({ pinnedProjectRoots: next })

    try {
      const pinnedProjectRoots = await api.preferences.setPinnedProjectRoots(next)
      set({ pinnedProjectRoots })
    } catch {
      set({ pinnedProjectRoots: current })
    }
  },

  editorPreference: 'cursor',
  editorAvailability: [],
  loadEditorState: async () => {
    if (!api?.editor) return
    const [editorPreference, editorAvailability] = await Promise.all([
      api.editor.getPreference(),
      api.editor.listAvailability(),
    ])
    set({ editorPreference, editorAvailability })
  },
  setEditorPreference: async (editor) => {
    if (!api?.editor) return null
    const next = await api.editor.setPreference(editor)
    set({ editorPreference: next })
    return next
  },

  theme:
    (typeof localStorage !== 'undefined' && (localStorage.getItem('takoyaki-theme') as 'dark' | 'light')) || 'dark',
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next === 'light' ? 'light' : ''
      localStorage.setItem('takoyaki-theme', next)
      window.dispatchEvent(new CustomEvent('takoyaki-theme-changed', { detail: next }))
      return { theme: next }
    }),

  toast: null,
  showToast: (toast, durationMs = 2500) => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast })
    toastTimer = setTimeout(() => {
      toastTimer = null
      set({ toast: null })
    }, durationMs)
  },
  clearToast: () => {
    if (toastTimer) {
      clearTimeout(toastTimer)
      toastTimer = null
    }
    set({ toast: null })
  },
  activityOperations: [],
  activityPanelOpen: false,
  startActivityOperation: (input) => {
    const id = createActivityOperationId(input.kind)
    const now = Date.now()
    const operation: ActivityOperation = {
      id,
      kind: input.kind,
      title: input.title,
      detail: input.detail || null,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      workspaceId: input.workspaceId,
    }
    set((state) => ({
      activityOperations: [operation, ...state.activityOperations].slice(0, maxActivityOperations),
    }))
    return id
  },
  updateActivityOperation: (id, input) =>
    set((state) => ({
      activityOperations: state.activityOperations.map((operation) =>
        operation.id === id
          ? {
              ...operation,
              ...input,
              detail: input.detail === undefined ? operation.detail : input.detail,
              updatedAt: Date.now(),
            }
          : operation,
      ),
    })),
  finishActivityOperation: (id, status, input = {}) =>
    get().updateActivityOperation(id, {
      ...input,
      status,
    }),
  clearActivityOperation: (id) =>
    set((state) => ({
      activityOperations: state.activityOperations.filter((operation) => operation.id !== id),
    })),
  clearFinishedActivityOperations: () =>
    set((state) => ({
      activityOperations: state.activityOperations.filter((operation) => operation.status === 'running'),
    })),
  toggleActivityPanel: () => set((state) => ({ activityPanelOpen: !state.activityPanelOpen })),
  setActivityPanelOpen: (open) => set({ activityPanelOpen: open }),

  activeView: 'terminal',
  reviewWorkspaceId: null,
  selectedReviewFilePath: null,
  reviewSnapshots: {},
  reviewPatches: {},
  reviewFocusMode: false,
  paneFocusSurfaceId: null,
  reviewLoading: false,
  reviewPatchLoading: false,
  reviewError: null,

  openReview: async (workspaceId) => {
    if (!api?.review || !api.workspace) return

    set({
      activeWorkspaceId: workspaceId,
      activeView: 'review',
      reviewWorkspaceId: workspaceId,
      reviewLoading: true,
      reviewPatchLoading: false,
      reviewFocusMode: false,
      paneFocusSurfaceId: null,
      reviewError: null,
    })
    await api.workspace.select(workspaceId)

    try {
      const snapshot = await api.review.getSnapshot(workspaceId)
      if (get().reviewWorkspaceId !== workspaceId) return

      const currentSelection = get().selectedReviewFilePath
      const nextSelection =
        currentSelection && snapshot.files.some((file) => file.path === currentSelection)
          ? currentSelection
          : snapshot.files[0]?.path || null

      set((state) => ({
        reviewSnapshots: { ...state.reviewSnapshots, [workspaceId]: snapshot },
        reviewPatches: { ...state.reviewPatches, [workspaceId]: {} },
        selectedReviewFilePath: nextSelection,
        reviewLoading: false,
        reviewPatchLoading: false,
        reviewError: snapshot.isReviewable ? null : snapshot.detail,
      }))

      if (snapshot.isReviewable && nextSelection) {
        await get().selectReviewFile(nextSelection)
      }
    } catch (error) {
      if (get().reviewWorkspaceId !== workspaceId) return
      set({
        reviewLoading: false,
        reviewPatchLoading: false,
        reviewError: getReviewErrorDetail(error),
      })
    }
  },

  closeReview: () =>
    set({
      activeView: 'terminal',
      reviewWorkspaceId: null,
      selectedReviewFilePath: null,
      reviewFocusMode: false,
      paneFocusSurfaceId: null,
      reviewLoading: false,
      reviewPatchLoading: false,
      reviewError: null,
    }),

  refreshReview: async () => {
    const workspaceId = get().reviewWorkspaceId
    if (!workspaceId || !api?.review) return

    set((state) => ({
      reviewLoading: true,
      reviewPatchLoading: false,
      reviewError: null,
      reviewPatches: { ...state.reviewPatches, [workspaceId]: {} },
    }))

    try {
      const snapshot = await api.review.getSnapshot(workspaceId)
      if (get().reviewWorkspaceId !== workspaceId) return

      const currentSelection = get().selectedReviewFilePath
      const nextSelection =
        currentSelection && snapshot.files.some((file) => file.path === currentSelection)
          ? currentSelection
          : snapshot.files[0]?.path || null

      set((state) => ({
        reviewSnapshots: { ...state.reviewSnapshots, [workspaceId]: snapshot },
        selectedReviewFilePath: nextSelection,
        reviewLoading: false,
        reviewPatchLoading: false,
        reviewError: snapshot.isReviewable ? null : snapshot.detail,
      }))

      if (snapshot.isReviewable && nextSelection) {
        await get().selectReviewFile(nextSelection)
      }
    } catch (error) {
      if (get().reviewWorkspaceId !== workspaceId) return
      set({
        reviewLoading: false,
        reviewPatchLoading: false,
        reviewError: getReviewErrorDetail(error),
      })
    }
  },

  selectReviewFile: async (filePath) => {
    const workspaceId = get().reviewWorkspaceId
    if (!workspaceId || !api?.review) return

    set({ selectedReviewFilePath: filePath, reviewPatchLoading: true, reviewError: null })

    const cachedPatch = get().reviewPatches[workspaceId]?.[filePath]
    if (cachedPatch) {
      set({ reviewPatchLoading: false })
      return
    }

    try {
      const patch = await api.review.getFilePatch(workspaceId, filePath)
      if (get().reviewWorkspaceId !== workspaceId) return

      set((state) => ({
        reviewPatches: {
          ...state.reviewPatches,
          [workspaceId]: {
            ...(state.reviewPatches[workspaceId] || {}),
            [filePath]: patch,
          },
        },
        reviewPatchLoading: false,
      }))
    } catch (error) {
      if (get().reviewWorkspaceId !== workspaceId) return
      set({
        reviewPatchLoading: false,
        reviewError: getReviewErrorDetail(error),
      })
    }
  },

  toggleReviewFocusMode: () => set((state) => ({ reviewFocusMode: !state.reviewFocusMode })),
  togglePaneFocusMode: (surfaceId) =>
    set((state) => ({
      paneFocusSurfaceId: state.paneFocusSurfaceId === surfaceId ? null : surfaceId,
    })),
  setPaneFocusSurfaceId: (surfaceId) => set({ paneFocusSurfaceId: surfaceId }),
  clearPaneFocusMode: () => set({ paneFocusSurfaceId: null }),
}))
