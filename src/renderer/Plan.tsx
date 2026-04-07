import type { ReactNode } from 'react'
import { RefreshCcw } from 'lucide-react'
import { button, colors, fonts } from './design'
import { TakoyakiMarkdown } from './TakoyakiMarkdown'
import { Tooltip } from './Tooltip'
import { useStore } from './store'
import type { Workspace } from './types'

interface PlanProps {
  workspace: Workspace
  narrow?: boolean
  width?: number | string
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        onClick={onClick}
        className="takoyaki-btn flex h-7 w-7 items-center justify-center rounded-md"
        style={{ ...button.base, color: colors.textSecondary }}
        onMouseEnter={(event) =>
          Object.assign(event.currentTarget.style, { ...button.hover, color: colors.textPrimary })
        }
        onMouseLeave={(event) =>
          Object.assign(event.currentTarget.style, { ...button.base, color: colors.textSecondary })
        }
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  )
}

function PlanPlaceholder({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-[420px] text-center">
        <div className="text-[12px] font-semibold" style={{ color: colors.textPrimary }}>
          {title}
        </div>
        <div className="mt-2 text-[11px] leading-6" style={{ color: colors.textSecondary }}>
          {detail}
        </div>
      </div>
    </div>
  )
}

export function Plan({ workspace, narrow = false, width }: PlanProps) {
  const openPlan = useStore((state) => state.openPlan)
  const planSnapshots = useStore((state) => state.planSnapshots)
  const planLoading = useStore((state) => state.planLoading)
  const planError = useStore((state) => state.planError)

  const snapshot = planSnapshots[workspace.id] || null
  const drawerWidth =
    typeof width === 'number' ? `${width}px` : width || (narrow ? 'min(420px, calc(100vw - 24px))' : '480px')

  return (
    <aside
      className="flex h-full shrink-0 flex-col"
      style={{
        width: drawerWidth,
        maxWidth: '100%',
        background: colors.bg,
        borderLeft: `1px solid ${colors.separator}`,
        fontFamily: fonts.ui,
      }}
    >
      <div
        className="flex shrink-0 items-center justify-between gap-3 px-4 py-3"
        style={{ borderBottom: `1px solid ${colors.separator}` }}
      >
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold" style={{ color: colors.textPrimary }}>
            {workspace.title}
          </div>
          {snapshot ? (
            <div className="mt-1 text-[11px]" style={{ color: colors.textGhost, fontFamily: fonts.mono }}>
              {snapshot.slug}.md
            </div>
          ) : (
            <div className="mt-1 text-[11px]" style={{ color: colors.textGhost, fontFamily: fonts.mono }}>
              manual transcript lookup
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <IconButton
            label={planLoading ? 'Refreshing plan' : 'Refresh plan'}
            onClick={() => void openPlan(workspace.id)}
          >
            <RefreshCcw size={12} strokeWidth={1.8} className={planLoading ? 'takoyaki-spin' : undefined} />
          </IconButton>
        </div>
      </div>

      <div className="takoyaki-plan-scroll min-h-0 flex-1 overflow-y-auto">
        {!snapshot && planLoading ? (
          <PlanPlaceholder title="Loading plan" detail="Reading the latest Claude plan for this workspace." />
        ) : planError && !snapshot ? (
          <PlanPlaceholder title="Plan unavailable" detail={planError} />
        ) : !snapshot ? (
          <PlanPlaceholder
            title="No plan yet"
            detail="Claude has not written a main session plan for this workspace yet."
          />
        ) : (
          <div className="px-5 py-4">
            <TakoyakiMarkdown markdown={snapshot.markdown} />
          </div>
        )}
      </div>
    </aside>
  )
}
