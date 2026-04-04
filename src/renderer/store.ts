// this is my first time with zustand so don't roast me
import { create } from 'zustand'
import type { EditorAvailability, EditorKind, HookSurfaceStatus, Workspace } from './types'

// guard for when running outside electron (e.g. vite dev server in browser)
const api = typeof window !== 'undefined' && window.mux ? window.mux : null

interface ToastState {
  message: string
  workspaceId?: string
  dot?: string
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

interface MuxStore {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  sidebarCollapsed: boolean
  surfaceStatuses: Record<string, HookSurfaceStatus>
  ready: boolean

  refresh: () => Promise<void>
  openProjectFolder: () => Promise<void>
  selectWorkspace: (id: string) => void
  closeWorkspace: (id: string) => void
  toggleSidebar: () => void
  setSurfaceStatuses: (statuses: Record<string, HookSurfaceStatus>) => void
  workspaceActivity: Record<string, number>
  setWorkspaceActivity: (data: Record<string, number>) => void
  editorPreference: EditorKind
  editorAvailability: EditorAvailability[]
  loadEditorState: () => Promise<void>
  setEditorPreference: (editor: EditorKind) => Promise<EditorKind | null>
  theme: 'dark' | 'light'
  toggleTheme: () => void
  toast: ToastState | null
  showToast: (toast: ToastState, durationMs?: number) => void
  clearToast: () => void
}

export const useStore = create<MuxStore>((set) => ({
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
    const ws = await api.workspace.openFolder()
    if (!ws) return
    set({ activeWorkspaceId: ws.id })
  },

  selectWorkspace: async (id) => {
    if (!api) return
    set({ activeWorkspaceId: id })
    await api.workspace.select(id)
  },

  closeWorkspace: (id) => {
    if (!api) return
    void api.workspace.close(id)
  },

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setSurfaceStatuses: (statuses: Record<string, HookSurfaceStatus>) => set({ surfaceStatuses: statuses }),

  workspaceActivity: {},
  setWorkspaceActivity: (data: Record<string, number>) => set({ workspaceActivity: data }),

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

  theme: (typeof localStorage !== 'undefined' && (localStorage.getItem('mux-theme') as 'dark' | 'light')) || 'dark',
  toggleTheme: () =>
    set((s) => {
      const next = s.theme === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next === 'light' ? 'light' : ''
      localStorage.setItem('mux-theme', next)
      window.dispatchEvent(new CustomEvent('mux-theme-changed', { detail: next }))
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
}))
