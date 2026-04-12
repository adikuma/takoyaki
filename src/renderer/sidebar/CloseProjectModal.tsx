import { button, colors } from '../design'

interface CloseProjectModalProps {
  project: { id: string; title: string } | null
  onClose: () => void
  onConfirm: (projectId: string) => void
}

// confirm closing a project before the workspace tree and its terminals are torn down
export function CloseProjectModal({ project, onClose, onConfirm }: CloseProjectModalProps) {
  if (!project) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--takoyaki-backdrop)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col gap-4"
        style={{
          background: colors.bg,
          border: `1px solid ${colors.separator}`,
          borderRadius: 12,
          padding: '20px 24px',
          width: 'min(380px, calc(100vw - 24px))',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-[13px]" style={{ color: colors.textSecondary }}>
          Close{' '}
          <span className="font-semibold" style={{ color: colors.textPrimary }}>
            "{project.title}"
          </span>
          ? All terminals in this project will be killed.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="takoyaki-btn px-4 py-1.5 text-[12px] rounded-md cursor-pointer"
            style={{ ...button.base, color: colors.textSecondary }}
            onMouseEnter={(event) => Object.assign(event.currentTarget.style, button.hover)}
            onMouseLeave={(event) =>
              Object.assign(event.currentTarget.style, { ...button.base, color: colors.textSecondary })
            }
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm(project.id)
              onClose()
            }}
            className="px-4 py-1.5 text-[12px] rounded-md cursor-pointer transition-colors duration-[120ms]"
            style={{ background: colors.diffDelBg, color: colors.error }}
            onMouseEnter={(event) => {
              event.currentTarget.style.opacity = '0.8'
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.opacity = '1'
            }}
          >
            Close project
          </button>
        </div>
      </div>
    </div>
  )
}
