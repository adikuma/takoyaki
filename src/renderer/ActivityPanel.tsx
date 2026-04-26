import { AlertTriangle, Check, Clock3, Copy, Loader2, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { colors, fonts, sizes } from './design'
import { useStore } from './store'
import { Tooltip } from './Tooltip'
import type { ActivityOperation, ActivityOperationStatus } from '../shared/activity'

export const DEFAULT_ACTIVITY_PANEL_HEIGHT = 280

const minActivityPanelHeight = 160
const maxActivityPanelViewportRatio = 0.55

const statusLabel: Record<ActivityOperationStatus, string> = {
  running: 'Running',
  success: 'Done',
  failed: 'Failed',
  blocked: 'Blocked',
}

function getStatusColor(status: ActivityOperationStatus): string {
  if (status === 'running') return colors.accent
  if (status === 'success') return colors.success
  if (status === 'failed') return colors.error
  return colors.textSecondary
}

function getStatusIcon(operation: ActivityOperation) {
  const iconProps = { size: sizes.iconSm, strokeWidth: 1.9, style: { color: getStatusColor(operation.status) } }
  if (operation.status === 'running') return <Loader2 {...iconProps} className="takoyaki-spin" />
  if (operation.status === 'success') return <Check {...iconProps} />
  if (operation.status === 'failed') return <AlertTriangle {...iconProps} />
  return <Clock3 {...iconProps} />
}

function formatAge(timestamp: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

function copyOperationDetail(operation: ActivityOperation) {
  const lines = [
    `${operation.title} (${statusLabel[operation.status]})`,
    operation.detail ? `detail: ${operation.detail}` : null,
  ].filter(Boolean)
  void window.takoyaki?.clipboard.writeText(lines.join('\n'))
}

function clampPanelHeight(height: number): number {
  const maxHeight =
    typeof window === 'undefined'
      ? 420
      : Math.max(minActivityPanelHeight, Math.round(window.innerHeight * maxActivityPanelViewportRatio))
  return Math.min(Math.max(Math.round(height), minActivityPanelHeight), maxHeight)
}

function ActivityRow({ operation }: { operation: ActivityOperation }) {
  const clearActivityOperation = useStore((state) => state.clearActivityOperation)

  return (
    <div
      className="group px-5 py-3.5"
      style={{
        borderBottom: `1px solid ${colors.borderSubtle}`,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-5 w-5 items-center justify-center">{getStatusIcon(operation)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[13px] font-medium" style={{ color: colors.textPrimary, fontFamily: fonts.ui }}>
              {operation.title}
            </p>
            <span className="shrink-0 text-[10px]" style={{ color: getStatusColor(operation.status) }}>
              {statusLabel[operation.status]}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] capitalize" style={{ color: colors.textMuted }}>
            <span>{operation.kind}</span>
            <span>/</span>
            <span>{formatAge(operation.updatedAt)}</span>
          </div>
          {operation.detail && (
            <p className="mt-2 break-words text-[12px] leading-5" style={{ color: colors.textSecondary }}>
              {operation.detail}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100">
          {operation.detail && (
            <button
              type="button"
              aria-label="copy detail"
              className="flex h-7 w-7 items-center justify-center rounded-md"
              style={{ color: colors.textGhost }}
              onClick={() => copyOperationDetail(operation)}
            >
              <Copy size={sizes.iconSm} strokeWidth={1.9} />
            </button>
          )}
          {operation.status !== 'running' && (
            <button
              type="button"
              aria-label="clear activity"
              className="flex h-7 w-7 items-center justify-center rounded-md"
              style={{ color: colors.textGhost }}
              onClick={() => clearActivityOperation(operation.id)}
            >
              <Trash2 size={sizes.iconSm} strokeWidth={1.9} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface ActivityPanelProps {
  height: number
  onHeightChange: (height: number) => void
}

export function ActivityPanel({ height, onHeightChange }: ActivityPanelProps) {
  const open = useStore((state) => state.activityPanelOpen)
  const operations = useStore((state) => state.activityOperations)
  const clearFinishedActivityOperations = useStore((state) => state.clearFinishedActivityOperations)
  const setActivityPanelOpen = useStore((state) => state.setActivityPanelOpen)
  const [resizeState, setResizeState] = useState<{
    pointerId: number
    startY: number
    startHeight: number
    openOnDrag: boolean
  } | null>(null)
  const runningCount = useMemo(
    () => operations.filter((operation) => operation.status === 'running').length,
    [operations],
  )
  const failedCount = useMemo(
    () => operations.filter((operation) => operation.status === 'failed' || operation.status === 'blocked').length,
    [operations],
  )
  const statusColor = failedCount ? colors.error : runningCount ? colors.accent : colors.textMuted
  const clampedHeight = clampPanelHeight(height)

  const beginResize = (event: ReactPointerEvent<HTMLElement>, openOnDrag: boolean) => {
    event.preventDefault()
    setResizeState({
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: open ? clampedHeight : minActivityPanelHeight,
      openOnDrag,
    })
  }

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActivityPanelOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, setActivityPanelOpen])

  useEffect(() => {
    const nextHeight = clampPanelHeight(height)
    if (nextHeight !== height) onHeightChange(nextHeight)
  }, [height, onHeightChange])

  useEffect(() => {
    if (!resizeState) return

    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== resizeState.pointerId) return
      const delta = resizeState.startY - event.clientY
      if (resizeState.openOnDrag && delta > 8) setActivityPanelOpen(true)
      onHeightChange(clampPanelHeight(resizeState.startHeight + delta))
    }

    const stopResize = (event: PointerEvent) => {
      if (event.pointerId !== resizeState.pointerId) return
      setResizeState(null)
    }

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)

    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
    }
  }, [onHeightChange, resizeState, setActivityPanelOpen])

  if (!open) {
    return (
      <div className="no-drag pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center">
        <Tooltip content="Open activity" side="top" delay={150}>
          <button
            type="button"
            aria-label="open activity"
            className="pointer-events-auto relative flex h-5 w-14 items-center justify-center rounded-full"
            style={{ background: colors.bg, border: `1px solid ${colors.separator}` }}
            onClick={() => setActivityPanelOpen(true)}
            onPointerDown={(event) => beginResize(event, true)}
          >
            <span className="h-px w-7 rounded-full" style={{ background: colors.textGhost }} />
            {(runningCount > 0 || failedCount > 0) && (
              <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
            )}
          </button>
        </Tooltip>
      </div>
    )
  }

  return (
    <aside
      className="no-drag absolute bottom-0 left-0 right-0 z-20 flex flex-col overflow-hidden"
      style={{
        height: clampedHeight,
        background: colors.bg,
        borderTop: `1px solid ${colors.separator}`,
        boxShadow: '0 -18px 44px rgba(0, 0, 0, 0.36)',
      }}
    >
      <div
        className="absolute left-0 right-0 top-0 z-[2] flex h-3 cursor-row-resize justify-center"
        style={{ touchAction: 'none' }}
        onPointerDown={(event) => beginResize(event, false)}
        aria-hidden="true"
      >
        <span className="mt-1 h-px w-12 rounded-full" style={{ background: colors.borderSubtle }} />
      </div>
      <div className="flex h-12 shrink-0 items-center justify-between px-5">
        <div className="flex min-w-0 items-baseline gap-3">
          <p className="text-[13px] font-semibold" style={{ color: colors.textPrimary }}>
            Activity
          </p>
          {(runningCount > 0 || failedCount > 0) && (
            <p className="truncate text-[11px]" style={{ color: statusColor }}>
              {failedCount ? `${failedCount} need attention` : `${runningCount} running`}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="close activity"
          className="flex h-8 w-8 items-center justify-center rounded-md"
          style={{ color: colors.textSecondary }}
          onClick={() => setActivityPanelOpen(false)}
        >
          <X size={sizes.iconBase} strokeWidth={1.8} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {operations.length ? (
          <div>
            {operations.map((operation) => (
              <ActivityRow key={operation.id} operation={operation} />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-start px-5 pt-6">
            <p className="text-[12px]" style={{ color: colors.textMuted }}>
              No activity yet.
            </p>
          </div>
        )}
      </div>
      {operations.some((operation) => operation.status !== 'running') && (
        <div
          className="flex h-11 shrink-0 items-center justify-end px-4"
          style={{ borderTop: `1px solid ${colors.separator}` }}
        >
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[11px]"
            style={{ color: colors.error }}
            onClick={clearFinishedActivityOperations}
          >
            <Trash2 size={sizes.iconSm} strokeWidth={1.9} />
            Clear completed
          </button>
        </div>
      )}
    </aside>
  )
}
