import type { RefObject } from 'react'
import { FolderClosed } from 'lucide-react'
import { button, colors, sizes } from '../design'
import { GitBranchIcon } from '../icons'
import { BranchSelect } from './BranchSelect'

interface TaskCreateModalProps {
  open: boolean
  taskTitle: string
  taskBranchName: string
  taskBranches: string[]
  taskBranchesLoading: boolean
  taskBaseBranch: string
  taskCreateError: string | null
  taskCreating: boolean
  taskTitleRef: RefObject<HTMLInputElement | null>
  taskBranchNameRef: RefObject<HTMLInputElement | null>
  onTaskTitleChange: (value: string) => void
  onTaskBranchNameChange: (value: string) => void
  onTaskBaseBranchChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
}

// render the task creation form while keeping validation and submit state controlled by the parent hook
export function TaskCreateModal({
  open,
  taskTitle,
  taskBranchName,
  taskBranches,
  taskBranchesLoading,
  taskBaseBranch,
  taskCreateError,
  taskCreating,
  taskTitleRef,
  taskBranchNameRef,
  onTaskTitleChange,
  onTaskBranchNameChange,
  onTaskBaseBranchChange,
  onClose,
  onSubmit,
}: TaskCreateModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--takoyaki-backdrop)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col gap-4 rounded-xl"
        style={{
          width: 'min(380px, calc(100vw - 24px))',
          background: colors.bg,
          border: `1px solid ${colors.separator}`,
          padding: '20px 22px',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <div className="text-[13px] font-semibold" style={{ color: colors.textPrimary }}>
            New Task
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            className="text-[10px] font-semibold"
            style={{ color: colors.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}
          >
            Task Name
          </label>
          <div
            className="flex items-center gap-2"
            style={{ padding: '8px 10px', borderRadius: 8, background: colors.bgInput, color: colors.textMuted }}
          >
            <FolderClosed size={sizes.iconSm} strokeWidth={1.8} />
            <input
              ref={taskTitleRef}
              value={taskTitle}
              onChange={(event) => onTaskTitleChange(event.target.value)}
              placeholder="sidebar label and folder name"
              className="flex-1 bg-transparent text-[12px] outline-none min-w-0 takoyaki-input"
              style={{ color: colors.textPrimary }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !taskCreating) {
                  event.preventDefault()
                  onSubmit()
                }
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            className="text-[10px] font-semibold"
            style={{ color: colors.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}
          >
            Branch Name
          </label>
          <div
            className="flex items-center gap-2"
            style={{ padding: '8px 10px', borderRadius: 8, background: colors.bgInput, color: colors.textMuted }}
          >
            <GitBranchIcon size={sizes.iconSm} />
            <input
              ref={taskBranchNameRef}
              value={taskBranchName}
              onChange={(event) => onTaskBranchNameChange(event.target.value)}
              placeholder="exact git branch name"
              className="flex-1 bg-transparent text-[12px] outline-none min-w-0 takoyaki-input"
              style={{ color: colors.textPrimary, fontFamily: 'var(--font-mono, monospace)' }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !taskCreating) {
                  event.preventDefault()
                  onSubmit()
                }
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            className="text-[10px] font-semibold"
            style={{ color: colors.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}
          >
            Base Branch
          </label>
          <BranchSelect
            value={taskBaseBranch}
            options={taskBranches}
            disabled={taskBranchesLoading}
            onChange={onTaskBaseBranchChange}
          />
        </div>

        {taskCreateError && (
          <div className="text-[11px]" style={{ color: colors.error }}>
            {taskCreateError}
          </div>
        )}

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
            onClick={onSubmit}
            disabled={taskCreating}
            className="takoyaki-btn px-3 py-1.5 rounded-md text-[11px] cursor-pointer disabled:opacity-50"
            style={{ ...button.base, color: colors.textPrimary }}
            onMouseEnter={(event) => {
              if (!taskCreating) Object.assign(event.currentTarget.style, button.hover)
            }}
            onMouseLeave={(event) =>
              Object.assign(event.currentTarget.style, { ...button.base, color: colors.textPrimary })
            }
          >
            {taskCreating ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
