// titlebar: takoyaki / project-name, window controls on right

import { Globe, Menu } from 'lucide-react'
import { useStore } from './store'
import { colors, sizes } from './design'
import { Tooltip } from './Tooltip'
import takoyakiLogo from '../assets/takoyaki-logo.svg?raw'

interface Props {
  narrow?: boolean
  onToggleSidebar?: () => void
  browserVisible?: boolean
  onToggleBrowser?: () => void
}

export function Titlebar({ narrow = false, onToggleSidebar, browserVisible = false, onToggleBrowser }: Props) {
  const theme = useStore((s) => s.theme)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null
  // show the parent project name when a task workspace is active
  const renderProjectTitle = (() => {
    if (!activeWorkspace) return null
    if (activeWorkspace.kind === 'task' && activeWorkspace.parentProjectId) {
      return workspaces.find((workspace) => workspace.id === activeWorkspace.parentProjectId)?.title || null
    }
    return activeWorkspace.title
  })()
  // append the task title after the project breadcrumb when viewing a task
  const renderTaskTitle = (() => {
    if (!activeWorkspace || activeWorkspace.kind !== 'task') return null
    return activeWorkspace.title
  })()

  return (
    <div
      className="drag-region flex items-center h-10 select-none shrink-0"
      style={{ background: colors.bg, borderBottom: `1px solid ${colors.separator}` }}
    >
      <div className="flex items-center gap-2.5 pl-3">
        {narrow && (
          <button
            onClick={onToggleSidebar}
            className="no-drag flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-[120ms]"
            style={{ color: colors.textSecondary }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = colors.textPrimary
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = colors.textSecondary
            }}
            aria-label="toggle sidebar"
          >
            <Menu size={sizes.iconBase} strokeWidth={1.9} />
          </button>
        )}
        <span
          className="inline-flex h-[18px] w-[18px] items-center justify-center"
          style={{ filter: theme === 'dark' ? 'invert(1)' : 'none' }}
          dangerouslySetInnerHTML={{ __html: takoyakiLogo }}
        />
        <span className="text-[12px] font-semibold" style={{ letterSpacing: '0.03em', color: colors.textSecondary }}>
          Takoyaki
        </span>
        {renderProjectTitle && (
          <>
            <span style={{ color: colors.textGhost }}>/</span>
            <span className="text-[12px]" style={{ color: colors.textMuted }}>
              {renderProjectTitle}
            </span>
            {renderTaskTitle && (
              <>
                <span style={{ color: colors.textGhost }}>/</span>
                <span className="text-[12px]" style={{ color: colors.textGhost }}>
                  {renderTaskTitle}
                </span>
              </>
            )}
          </>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex h-full no-drag">
        <Tooltip content={browserVisible ? 'Close browser' : 'Open browser'} side="bottom" delay={150}>
          <button
            onClick={onToggleBrowser}
            className="w-[46px] h-full flex items-center justify-center transition-colors duration-[120ms]"
            style={{ color: browserVisible ? colors.accent : colors.textGhost }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = browserVisible ? colors.accent : colors.textSecondary
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = browserVisible ? colors.accent : colors.textGhost
            }}
            aria-label={browserVisible ? 'close browser' : 'open browser'}
          >
            <Globe size={sizes.iconSm} strokeWidth={1.9} />
          </button>
        </Tooltip>
        <div className="h-full w-px" style={{ background: colors.separator }} aria-hidden="true" />
        <button
          onClick={() => window.takoyaki?.window.minimize()}
          className="w-[46px] h-full flex items-center justify-center transition-colors duration-[120ms]"
          style={{ color: colors.textGhost }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = colors.textSecondary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = colors.textGhost
          }}
          aria-label="minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>
        <button
          onClick={() => window.takoyaki?.window.maximize()}
          className="w-[46px] h-full flex items-center justify-center transition-colors duration-[120ms]"
          style={{ color: colors.textGhost }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = colors.textSecondary
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = colors.textGhost
          }}
          aria-label="maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
          </svg>
        </button>
        <button
          onClick={() => window.takoyaki?.window.close()}
          className="w-[46px] h-full flex items-center justify-center transition-colors duration-[120ms]"
          style={{ color: colors.textGhost }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = colors.error
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = colors.textGhost
          }}
          aria-label="close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  )
}
