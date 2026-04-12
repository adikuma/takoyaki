import { button, colors } from '../design'

interface RemoveTaskState {
  id: string
  title: string
  detail?: string
  force: boolean
}

interface RemoveTaskModalProps {
  task: RemoveTaskState | null
  busy: boolean
  onClose: () => void
  onConfirm: (taskId: string, force: boolean) => void
}

// confirm task removal and surface the force remove retry path for dirty worktrees
export function RemoveTaskModal({ task, busy, onClose, onConfirm }: RemoveTaskModalProps) {
  if (!task) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--takoyaki-backdrop)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col gap-4 rounded-xl"
        style={{
          width: 'min(360px, calc(100vw - 24px))',
          background: colors.bg,
          border: `1px solid ${colors.separator}`,
          padding: '20px 22px',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-[13px] font-semibold" style={{ color: colors.textPrimary }}>
          Remove Task
        </div>
        <div className="text-[12px] leading-5" style={{ color: colors.textSecondary }}>
          {task.force
            ? task.detail || `Force remove "${task.title}"? The worktree will be deleted but the branch will be kept.`
            : `Remove "${task.title}"? The worktree will be deleted but the branch will be kept.`}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="takoyaki-btn px-3 py-1.5 rounded-md text-[11px] cursor-pointer"
            style={{ ...button.base, color: colors.textSecondary }}
            onMouseEnter={(event) => Object.assign(event.currentTarget.style, button.hover)}
            onMouseLeave={(event) =>
              Object.assign(event.currentTarget.style, { ...button.base, color: colors.textSecondary })
            }
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(task.id, task.force)}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-[11px] cursor-pointer disabled:opacity-50"
            style={{ background: colors.diffDelBg, color: colors.error }}
            onMouseEnter={(event) => {
              event.currentTarget.style.opacity = '0.8'
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.opacity = '1'
            }}
          >
            {busy ? 'Removing...' : task.force ? 'Force Remove' : 'Remove Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
