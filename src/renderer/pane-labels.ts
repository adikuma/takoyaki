import type { HookSurfaceStatus, TerminalMetadata } from './types'
import type { WorkspaceTerminal } from './terminal-layout'

const FRONTEND_FOLDER_NAMES = new Set(['frontend', 'web', 'client', 'ui', 'site', 'app'])
const BACKEND_FOLDER_NAMES = new Set(['backend', 'api', 'server'])

// normalizes folder names into calm human friendly labels
function titleCaseWords(input: string): string {
  return input
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

// pulls the last folder name from a cwd so pane labels can fall back cleanly
function basenameFromCwd(cwd: string | null | undefined): string | null {
  if (!cwd) return null
  const trimmed = cwd.replace(/[\\/]+$/, '')
  if (!trimmed) return null
  const segments = trimmed.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) || null
}

// treats claude hook activity as the strongest pane identity signal
function hasClaudeIdentity(status: HookSurfaceStatus | undefined, metadata: TerminalMetadata | undefined): boolean {
  if (status && (status.sessionPresent || status.lastEventName !== null || status.activity !== 'idle')) {
    return true
  }
  const title = metadata?.title?.toLowerCase() || ''
  return title.includes('claude')
}

// uses the terminal title for tool specific labels when the title exposes one
function labelFromTitle(title: string | null | undefined): string | null {
  const normalized = title?.toLowerCase() || ''
  if (normalized.includes('claude')) return 'Claude'
  if (normalized.includes('codex')) return 'Codex'
  return null
}

// maps common workspace folders to role labels before falling back to the raw folder name
function labelFromCwd(cwd: string | null | undefined): string | null {
  const basename = basenameFromCwd(cwd)
  if (!basename) return null

  const normalized = basename.toLowerCase()
  if (FRONTEND_FOLDER_NAMES.has(normalized)) return 'Frontend'
  if (BACKEND_FOLDER_NAMES.has(normalized)) return 'Backend'
  return titleCaseWords(basename)
}

// keeps repeated pane labels readable when several panes resolve to the same identity
function dedupeLabels(labels: Array<{ surfaceId: string; label: string }>): Record<string, string> {
  const counts = new Map<string, number>()
  const deduped: Record<string, string> = {}

  for (const item of labels) {
    const nextCount = (counts.get(item.label) || 0) + 1
    counts.set(item.label, nextCount)
    deduped[item.surfaceId] = nextCount === 1 ? item.label : `${item.label} ${nextCount}`
  }

  return deduped
}

// resolves the visible label for each pane from the safest metadata we have
export function resolvePaneLabels({
  paneLeaves,
  terminalViews,
  surfaceStatuses,
  terminalMetadataById,
}: {
  paneLeaves: Array<{ surfaceId: string }>
  terminalViews: WorkspaceTerminal[]
  surfaceStatuses: Record<string, HookSurfaceStatus>
  terminalMetadataById: Record<string, TerminalMetadata>
}): Record<string, string> {
  const terminalIdBySurfaceId = new Map(terminalViews.map((terminal) => [terminal.surfaceId, terminal.terminalId]))

  return dedupeLabels(
    paneLeaves.map((leaf, index) => {
      const terminalId = terminalIdBySurfaceId.get(leaf.surfaceId) || ''
      const metadata = terminalMetadataById[terminalId]
      const status = surfaceStatuses[leaf.surfaceId]
      const label =
        (hasClaudeIdentity(status, metadata) ? 'Claude' : null) ||
        labelFromTitle(metadata?.title) ||
        labelFromCwd(metadata?.cwd) ||
        `Pane ${index + 1}`

      return { surfaceId: leaf.surfaceId, label }
    }),
  )
}
