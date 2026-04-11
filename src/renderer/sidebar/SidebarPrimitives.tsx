import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Check, CircleAlert, FolderClosed, MoreVertical, Search, X, Zap } from 'lucide-react'
import { colors, sizes } from '../design'
import { Tooltip } from '../Tooltip'
import { getClaudeAttentionLabel, type ClaudeWorkspaceStatus } from '../../shared/claude-status'

// folder icon that lights up amber when the project is selected
export function FolderIcon({ active }: { active?: boolean }) {
  return (
    <FolderClosed
      size={sizes.iconBase}
      strokeWidth={1.8}
      color={active ? colors.accentSoft : colors.textMuted}
      style={{ flexShrink: 0 }}
    />
  )
}

export function SearchIcon() {
  return <Search size={sizes.iconSm} strokeWidth={2} style={{ flexShrink: 0 }} />
}

function Checkmark() {
  return <Check size={sizes.iconSm} strokeWidth={2} color={colors.success} style={{ flexShrink: 0 }} />
}

function LightningIcon() {
  return <Zap size={sizes.iconSm} strokeWidth={2} color={colors.accent} style={{ flexShrink: 0 }} />
}

function FailureIcon() {
  return <X size={sizes.iconSm} strokeWidth={2} color={colors.error} style={{ flexShrink: 0 }} />
}

function AttentionIcon() {
  return <CircleAlert size={sizes.iconSm} strokeWidth={2} color={colors.accent} style={{ flexShrink: 0 }} />
}

export function RowActionCluster({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-center gap-0 shrink-0"
      style={{
        padding: 0,
        borderRadius: sizes.radiusMd,
        background: 'transparent',
        border: 'none',
      }}
    >
      {children}
    </div>
  )
}

export function RowActionButton({
  label,
  active = false,
  danger = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  danger?: boolean
  disabled?: boolean
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  const restingColor = disabled
    ? colors.textGhost
    : active
      ? colors.accentSoft
      : danger
        ? colors.textGhost
        : colors.textMuted
  const hoverColor = danger ? colors.error : colors.textPrimary

  return (
    <Tooltip content={label} side="top">
      <button
        disabled={disabled}
        onClick={onClick}
        className="transition-colors duration-[120ms] shrink-0"
        style={{
          width: 24,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: sizes.radiusMd,
          color: restingColor,
          opacity: disabled ? 0.55 : 1,
        }}
        onMouseEnter={(event) => {
          if (disabled) return
          event.currentTarget.style.color = hoverColor
          event.currentTarget.style.background = colors.bgHover
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.color = restingColor
          event.currentTarget.style.background = 'transparent'
        }}
        aria-label={label.toLowerCase()}
      >
        {children}
      </button>
    </Tooltip>
  )
}

export interface RowMenuItem {
  label: string
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
  hint?: string
}

export function RowActionMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative shrink-0">
      <RowActionButton
        label={label}
        active={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
      >
        <MoreVertical size={sizes.iconSm} strokeWidth={1.8} />
      </RowActionButton>

      {open && (
        <div
          className="absolute right-0 top-full z-40 mt-2 min-w-[180px] overflow-hidden rounded-lg"
          style={{
            background: colors.bg,
            border: `1px solid ${colors.separator}`,
            boxShadow: '0 10px 28px rgba(0,0,0,0.18)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {items.map((item) => {
            const restingColor = item.disabled ? colors.textGhost : item.danger ? colors.error : colors.textSecondary
            const menuButton = (
              <button
                key={item.label}
                type="button"
                disabled={item.disabled}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12px] transition-colors duration-[120ms]"
                style={{
                  color: restingColor,
                  opacity: item.disabled ? 0.7 : 1,
                }}
                onClick={() => {
                  if (item.disabled) return
                  setOpen(false)
                  item.onSelect()
                }}
                onMouseEnter={(event) => {
                  if (item.disabled) return
                  event.currentTarget.style.background = colors.bgInput
                  event.currentTarget.style.color = item.danger ? colors.error : colors.textPrimary
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = 'transparent'
                  event.currentTarget.style.color = restingColor
                }}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </span>
              </button>
            )

            if (item.disabled && item.hint) {
              return (
                <Tooltip key={item.label} content={item.hint} side="left" delay={150}>
                  <div style={{ width: '100%' }}>{menuButton}</div>
                </Tooltip>
              )
            }

            return menuButton
          })}
        </div>
      )}
    </div>
  )
}

export function StatusGlyph({ status }: { status: ClaudeWorkspaceStatus | null }) {
  if (!status) return null

  let icon: ReactNode = null
  if (status.kind === 'attention') icon = <AttentionIcon />
  if (status.kind === 'running') icon = <LightningIcon />
  if (status.kind === 'finished') icon = <Checkmark />
  if (status.kind === 'failed') icon = <FailureIcon />
  if (!icon) return null

  const attentionLabel = getClaudeAttentionLabel(status.attention)
  if (!attentionLabel) return <>{icon}</>

  return (
    <Tooltip content={attentionLabel} side="top">
      <span className="inline-flex items-center">{icon}</span>
    </Tooltip>
  )
}
