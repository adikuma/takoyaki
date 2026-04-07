import { create } from 'zustand'
import type {
  EditorAvailability,
  EditorKind,
  HookSurfaceStatus,
  PlanSnapshot,
  ReviewPatch,
  ReviewSnapshot,
  ReviewView,
  Workspace,
} from './types'
import { normalizePinnedProjectRoot } from './pinned-projects'

// guard for when running outside electron (e.g. vite dev server in browser)
const api = typeof window !== 'undefined' && window.takoyaki ? window.takoyaki : null

interface ToastState {
  message: string
  workspaceId?: string
  dot?: string
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

function getReviewErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load review.'
}

function getPlanErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load plan.'
}

interface MuxStore {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  sidebarCollapsed: boolean
  surfaceStatuses: Record<string, HookSurfaceStatus>
  activeClaudeSurfaceIds: string[]
  ready: boolean

  refresh: () => Promise<void>
  openProjectFolder: () => Promise<void>
  selectWorkspace: (id: string) => void
  closeWorkspace: (id: string) => void
  toggleSidebar: () => void
  setSurfaceStatuses: (statuses: Record<string, HookSurfaceStatus>) => void
  setActiveClaudeSurfaceIds: (surfaceIds: string[]) => void
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
  activeView: ReviewView
  reviewWorkspaceId: string | null
  selectedReviewFilePath: string | null
  reviewSnapshots: Record<string, ReviewSnapshot | undefined>
  reviewPatches: Record<string, Record<string, ReviewPatch | undefined> | undefined>
  reviewFocusMode: boolean
  reviewLoading: boolean
  reviewPatchLoading: boolean
  reviewError: string | null
  openReview: (workspaceId: string) => Promise<void>
  closeReview: () => void
  refreshReview: () => Promise<void>
  selectReviewFile: (filePath: string) => Promise<void>
  toggleReviewFocusMode: () => void
  planWorkspaceId: string | null
  planSurfaceId: string | null
  planSnapshots: Record<string, PlanSnapshot | undefined>
  planLoading: boolean
  planError: string | null
  openPlan: (workspaceId: string, surfaceId?: string) => Promise<void>
  closePlan: () => void
}

export const useStore = create<MuxStore>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  sidebarCollapsed: false,
  surfaceStatuses: {},
  activeClaudeSurfaceIds: [],
  ready: false,

  refresh: async () => {
    if (!api) return
    const workspaces = await api.workspace.list()
    const current = await api.workspace.current()
    set({ workspaces, activeWorkspaceId: current?.id || null, ready: true })
  },

  openProjectFolder: async () => {
    if (!api) return
    const ws = await api.workspace.openFolder()
    if (!ws) return
    set({ activeWorkspaceId: ws.id })
  },

  selectWorkspace: async (id) => {
    if (!api) return
    set({
      activeWorkspaceId: id,
      activeView: 'terminal',
      reviewWorkspaceId: null,
      planWorkspaceId: null,
      planSurfaceId: null,
      selectedReviewFilePath: null,
      reviewFocusMode: false,
      planLoading: false,
      planError: null,
    })
    await api.workspace.select(id)
  },

  closeWorkspace: (id) => {
    if (!api) return
    void api.workspace.close(id)
  },

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setSurfaceStatuses: (statuses: Record<string, HookSurfaceStatus>) => set({ surfaceStatuses: statuses }),
  setActiveClaudeSurfaceIds: (surfaceIds: string[]) => set({ activeClaudeSurfaceIds: surfaceIds }),

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

  activeView: 'terminal',
  reviewWorkspaceId: null,
  selectedReviewFilePath: null,
  reviewSnapshots: {},
  reviewPatches: {},
  reviewFocusMode: false,
  reviewLoading: false,
  reviewPatchLoading: false,
  reviewError: null,
  planWorkspaceId: null,
  planSurfaceId: null,
  planSnapshots: {},
  planLoading: false,
  planError: null,

  openReview: async (workspaceId) => {
    if (!api?.review || !api.workspace) return

    set({
      activeWorkspaceId: workspaceId,
      activeView: 'review',
      reviewWorkspaceId: workspaceId,
      planWorkspaceId: null,
      planSurfaceId: null,
      reviewLoading: true,
      reviewPatchLoading: false,
      reviewFocusMode: false,
      reviewError: null,
      planLoading: false,
      planError: null,
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

  openPlan: async (workspaceId, surfaceId) => {
    if (!api?.plan || !api?.workspace) return
    const resolvedSurfaceId = surfaceId ?? get().planSurfaceId

    set({
      activeWorkspaceId: workspaceId,
      activeView: 'terminal',
      planWorkspaceId: workspaceId,
      planSurfaceId: resolvedSurfaceId,
      planLoading: true,
      planError: null,
      reviewWorkspaceId: null,
      selectedReviewFilePath: null,
      reviewFocusMode: false,
    })
    await api.workspace.select(workspaceId)

    try {
      const snapshot = await api.plan.getSnapshot(workspaceId, { refresh: true })
      if (get().planWorkspaceId !== workspaceId) return
      if (!snapshot) {
        set({
          planLoading: false,
          planError: 'No plan is available for this workspace yet.',
        })
        return
      }

      set((state) => ({
        planSnapshots: { ...state.planSnapshots, [workspaceId]: snapshot },
        planLoading: false,
        planError: null,
      }))
    } catch (error) {
      if (get().planWorkspaceId !== workspaceId) return
      set({
        planLoading: false,
        planError: getPlanErrorDetail(error),
      })
    }
  },
  closePlan: () =>
    set({
      activeView: 'terminal',
      planWorkspaceId: null,
      planSurfaceId: null,
      planLoading: false,
      planError: null,
    }),
}))
