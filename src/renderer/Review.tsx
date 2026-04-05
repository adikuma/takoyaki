import { useMemo, type ReactNode } from 'react'
import { ArrowLeft, Maximize2, Minimize2, RefreshCcw, X } from 'lucide-react'
import { button, colors, fonts, sizes } from './design'
import { useStore } from './store'
import { Tooltip } from './Tooltip'
import type { ReviewFile, ReviewPatch, ReviewFileStatus, Workspace } from './types'

interface ReviewProps {
  workspace: Workspace
  narrow?: boolean
}

interface PatchRow {
  kind: 'meta' | 'hunk' | 'context' | 'add' | 'delete'
  content: string
  oldLine: number | null
  newLine: number | null
}

function getStatusLabel(status: ReviewFileStatus): string {
  if (status === 'modified') return 'M'
  if (status === 'added' || status === 'untracked') return 'A'
  if (status === 'deleted') return 'D'
  if (status === 'renamed') return 'R'
  if (status === 'copied') return 'C'
  return 'T'
}

function getStatusColor(status: ReviewFileStatus): string {
  if (status === 'added' || status === 'untracked') return colors.diffAddText
  if (status === 'deleted') return colors.diffDelText
  if (status === 'renamed' || status === 'copied') return colors.accent
  return colors.textSecondary
}

function getRowStyles(kind: PatchRow['kind']): { background: string; color: string; boxShadow: string } {
  if (kind === 'add') {
    return { background: colors.diffAddBg, color: colors.diffAddText, boxShadow: 'none' }
  }
  if (kind === 'delete') {
    return { background: colors.diffDelBg, color: colors.diffDelText, boxShadow: 'none' }
  }
  if (kind === 'hunk') {
    return {
      background: colors.bgSubtle,
      color: colors.diffHunkText,
      boxShadow: `inset 0 1px 0 ${colors.borderSubtle}, inset 0 -1px 0 ${colors.borderSubtle}`,
    }
  }
  if (kind === 'meta') {
    return { background: colors.bgCard, color: colors.textMuted, boxShadow: 'none' }
  }
  return { background: 'transparent', color: colors.textSecondary, boxShadow: 'none' }
}

function parsePatchRows(patch: string): PatchRow[] {
  const rawLines = patch.split(/\r?\n/)
  if (rawLines[rawLines.length - 1] === '') rawLines.pop()

  const rows: PatchRow[] = []
  let oldLine = 0
  let newLine = 0

  for (const line of rawLines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunkMatch) {
      oldLine = Number.parseInt(hunkMatch[1], 10)
      newLine = Number.parseInt(hunkMatch[2], 10)
      rows.push({ kind: 'hunk', content: line, oldLine: null, newLine: null })
      continue
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      rows.push({ kind: 'add', content: line, oldLine: null, newLine })
      newLine += 1
      continue
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      rows.push({ kind: 'delete', content: line, oldLine, newLine: null })
      oldLine += 1
      continue
    }

    if (line.startsWith(' ')) {
      rows.push({ kind: 'context', content: line, oldLine, newLine })
      oldLine += 1
      newLine += 1
      continue
    }

    rows.push({ kind: 'meta', content: line, oldLine: null, newLine: null })
  }

  return rows
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        onClick={onClick}
        className="takoyaki-btn flex h-8 w-8 items-center justify-center rounded-md"
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

function FileList({
  files,
  selectedFilePath,
  onSelect,
}: {
  files: ReviewFile[]
  selectedFilePath: string | null
  onSelect: (path: string) => void
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ borderRight: `1px solid ${colors.separator}` }}>
      <div
        className="shrink-0 px-4 py-3 text-[10px] font-semibold uppercase"
        style={{ color: colors.textMuted, letterSpacing: '0.08em', borderBottom: `1px solid ${colors.borderSubtle}` }}
      >
        Changed Files
      </div>
      <div className="flex-1 overflow-y-auto">
        {files.map((file) => {
          const active = file.path === selectedFilePath
          const statusColor = getStatusColor(file.status)
          return (
            <button
              key={file.path}
              onClick={() => onSelect(file.path)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-[120ms]"
              style={{
                background: active ? colors.bgInput : 'transparent',
                borderBottom: `1px solid ${colors.borderSubtle}`,
              }}
              onMouseEnter={(event) => {
                if (!active) event.currentTarget.style.background = colors.bgCard
              }}
              onMouseLeave={(event) => {
                if (!active) event.currentTarget.style.background = 'transparent'
              }}
            >
              <span
                className="mt-0.5 shrink-0 text-[11px] font-semibold"
                style={{ color: statusColor, width: 14, textAlign: 'center' }}
              >
                {getStatusLabel(file.status)}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[12px]"
                  style={{ color: colors.textPrimary, fontFamily: fonts.mono }}
                >
                  {file.path}
                </span>
                {file.previousPath && (
                  <span
                    className="mt-1 block truncate text-[10px]"
                    style={{ color: colors.textGhost, fontFamily: fonts.mono }}
                  >
                    from {file.previousPath}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DiffPlaceholder({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string
  detail: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-[420px] text-center">
        <div className="text-[13px] font-semibold" style={{ color: colors.textPrimary }}>
          {title}
        </div>
        <div className="mt-2 text-[12px] leading-6" style={{ color: colors.textSecondary }}>
          {detail}
        </div>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="takoyaki-btn mt-4 rounded-md px-3 py-1.5 text-[11px]"
            style={{ ...button.base, color: colors.textPrimary }}
            onMouseEnter={(event) => Object.assign(event.currentTarget.style, button.hover)}
            onMouseLeave={(event) =>
              Object.assign(event.currentTarget.style, { ...button.base, color: colors.textPrimary })
            }
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}

function DiffPane({ file, patch, loading }: { file: ReviewFile | null; patch: ReviewPatch | null; loading: boolean }) {
  const rows = useMemo(() => {
    if (!patch || patch.renderMode !== 'text') return []
    return parsePatchRows(patch.patch)
  }, [patch])

  if (!file) {
    return (
      <DiffPlaceholder title="Select a file" detail="Choose a changed file to inspect the current workspace diff." />
    )
  }

  if (loading && !patch) {
    return <DiffPlaceholder title="Loading diff" detail="Fetching the latest patch for this file." />
  }

  if (!patch) {
    return (
      <DiffPlaceholder
        title="Diff unavailable"
        detail="This file is no longer available in the current review snapshot."
      />
    )
  }

  if (patch.renderMode === 'binary') {
    return (
      <DiffPlaceholder title="Binary file" detail={patch.detail || 'Binary file changes are not rendered inline.'} />
    )
  }

  if (patch.renderMode === 'oversized') {
    return (
      <DiffPlaceholder title="Diff too large" detail={patch.detail || 'This diff is too large to render inline.'} />
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div
        className="shrink-0 px-4 py-3"
        style={{ borderBottom: `1px solid ${colors.borderSubtle}`, background: colors.bgCard }}
      >
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold" style={{ color: getStatusColor(file.status) }}>
            {getStatusLabel(file.status)}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-[12px]"
            style={{ color: colors.textPrimary, fontFamily: fonts.mono }}
          >
            {file.path}
          </span>
        </div>
        {file.previousPath && (
          <div className="mt-1 text-[10px]" style={{ color: colors.textGhost, fontFamily: fonts.mono }}>
            from {file.previousPath}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        <div style={{ minWidth: '100%', width: 'max-content' }}>
          {rows.map((row, index) => {
            const rowStyle = getRowStyles(row.kind)
            return (
              <div
                key={`${index}-${row.content}`}
                className="grid"
                style={{
                  gridTemplateColumns: '56px 56px auto',
                  background: rowStyle.background,
                  boxShadow: rowStyle.boxShadow,
                }}
              >
                <div
                  className="px-3 py-1 text-right text-[10px]"
                  style={{
                    color: colors.textGhost,
                    fontFamily: fonts.mono,
                    borderRight: `1px solid ${colors.borderSubtle}`,
                  }}
                >
                  {row.oldLine ?? ''}
                </div>
                <div
                  className="px-3 py-1 text-right text-[10px]"
                  style={{
                    color: colors.textGhost,
                    fontFamily: fonts.mono,
                    borderRight: `1px solid ${colors.borderSubtle}`,
                  }}
                >
                  {row.newLine ?? ''}
                </div>
                <div
                  className="px-3 py-1 pr-6 text-[11px]"
                  style={{ color: rowStyle.color, fontFamily: fonts.mono, whiteSpace: 'pre' }}
                >
                  {row.content || ' '}
                </div>
              </div>
            )
          })}
          <div className="grid" style={{ gridTemplateColumns: '56px 56px auto' }}>
            <div
              style={{
                height: 1,
                borderTop: `1px solid ${colors.borderSubtle}`,
                borderRight: `1px solid ${colors.borderSubtle}`,
              }}
            />
            <div
              style={{
                height: 1,
                borderTop: `1px solid ${colors.borderSubtle}`,
                borderRight: `1px solid ${colors.borderSubtle}`,
              }}
            />
            <div style={{ height: 1, borderTop: `1px solid ${colors.borderSubtle}` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function Review({ workspace, narrow = false }: ReviewProps) {
  const reviewWorkspaceId = useStore((state) => state.reviewWorkspaceId)
  const selectedReviewFilePath = useStore((state) => state.selectedReviewFilePath)
  const reviewSnapshots = useStore((state) => state.reviewSnapshots)
  const reviewPatches = useStore((state) => state.reviewPatches)
  const reviewLoading = useStore((state) => state.reviewLoading)
  const reviewPatchLoading = useStore((state) => state.reviewPatchLoading)
  const reviewError = useStore((state) => state.reviewError)
  const reviewFocusMode = useStore((state) => state.reviewFocusMode)
  const closeReview = useStore((state) => state.closeReview)
  const refreshReview = useStore((state) => state.refreshReview)
  const selectReviewFile = useStore((state) => state.selectReviewFile)
  const toggleReviewFocusMode = useStore((state) => state.toggleReviewFocusMode)

  const snapshot = (reviewWorkspaceId && reviewSnapshots[reviewWorkspaceId]) || null
  const selectedFile = snapshot?.files.find((file) => file.path === selectedReviewFilePath) || null
  const selectedPatch =
    reviewWorkspaceId && selectedReviewFilePath
      ? reviewPatches[reviewWorkspaceId]?.[selectedReviewFilePath] || null
      : null
  const showFileList = !narrow || !selectedFile

  return (
    <div className="flex h-full flex-col" style={{ background: colors.bg }}>
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${colors.separator}` }}>
        <div className="flex items-center gap-2">
          {narrow && selectedFile && (
            <IconButton
              label="Back to files"
              onClick={() => {
                useStore.setState({ selectedReviewFilePath: null })
              }}
            >
              <ArrowLeft size={sizes.iconBase} strokeWidth={1.8} />
            </IconButton>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold" style={{ color: colors.textPrimary }}>
            {snapshot?.workspaceTitle || workspace.title}
          </div>
          <div
            className="mt-1 flex items-center gap-3 text-[10px]"
            style={{ color: colors.textGhost, fontFamily: fonts.mono }}
          >
            <span>@{snapshot?.branchName || workspace.branchName || 'detached'}</span>
            <span>{snapshot?.files.length || 0} files</span>
            <span>{snapshot?.baseRef || 'HEAD'}</span>
            {snapshot?.scopePath && <span>{snapshot.scopePath}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            label={reviewLoading ? 'Refreshing review' : 'Refresh review'}
            onClick={() => {
              void refreshReview()
            }}
          >
            <RefreshCcw
              size={sizes.iconBase}
              strokeWidth={1.8}
              className={reviewLoading ? 'takoyaki-spin' : undefined}
            />
          </IconButton>
          <IconButton label={reviewFocusMode ? 'Exit focus mode' : 'Enter focus mode'} onClick={toggleReviewFocusMode}>
            {reviewFocusMode ? (
              <Minimize2 size={sizes.iconBase} strokeWidth={1.8} />
            ) : (
              <Maximize2 size={sizes.iconBase} strokeWidth={1.8} />
            )}
          </IconButton>
          <IconButton label="Close review" onClick={closeReview}>
            <X size={sizes.iconBase} strokeWidth={1.8} />
          </IconButton>
        </div>
      </div>

      {!snapshot && reviewLoading ? (
        <DiffPlaceholder title="Loading review" detail="Collecting the current workspace change set from git." />
      ) : reviewError && !snapshot?.isReviewable ? (
        <DiffPlaceholder title="Review unavailable" detail={reviewError} />
      ) : snapshot && snapshot.files.length === 0 ? (
        <DiffPlaceholder
          title="No changes"
          detail="This workspace currently matches HEAD. Open review again after the agent changes files."
          actionLabel="Refresh"
          onAction={() => {
            void refreshReview()
          }}
        />
      ) : (
        <div className="flex min-h-0 flex-1" style={{ flexDirection: showFileList ? 'row' : 'column' }}>
          {showFileList && (
            <div
              className="min-h-0 shrink-0"
              style={{
                width: narrow ? '100%' : 320,
                borderRight: narrow ? 'none' : `1px solid ${colors.separator}`,
              }}
            >
              {snapshot ? (
                <FileList
                  files={snapshot.files}
                  selectedFilePath={selectedReviewFilePath}
                  onSelect={(filePath) => {
                    void selectReviewFile(filePath)
                  }}
                />
              ) : null}
            </div>
          )}
          {(!narrow || selectedFile) && (
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <DiffPane file={selectedFile} patch={selectedPatch} loading={reviewPatchLoading} />
            </div>
          )}
        </div>
      )}
      {reviewError && snapshot?.isReviewable && (
        <div
          className="shrink-0 px-4 py-2 text-[11px]"
          style={{ color: colors.error, borderTop: `1px solid ${colors.borderSubtle}`, background: colors.bgCard }}
        >
          {reviewError}
        </div>
      )}
    </div>
  )
}
