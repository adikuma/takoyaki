import type { HookSurfaceStatus, TerminalMetadata } from './types'
import type { WorkspaceTerminal } from './terminal-layout'

const FRONTEND_FOLDER_NAMES = new Set(['frontend', 'web', 'client', 'ui', 'site', 'app'])
const BACKEND_FOLDER_NAMES = new Set(['backend', 'api', 'server'])
const TOOL_COMMAND_NAMES = {
  claude: 'Claude',
  codex: 'Codex',
} as const

function titleCaseWords(input: string): string {
  return input
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function basenameFromCwd(cwd: string | null | undefined): string | null {
  if (!cwd) return null
  const trimmed = cwd.replace(/[\\/]+$/, '')
  if (!trimmed) return null
  const segments = trimmed.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) || null
}

function hasClaudeIdentity(status: HookSurfaceStatus | undefined, metadata: TerminalMetadata | undefined): boolean {
  if (status && (status.sessionPresent || status.lastEventName !== null || status.activity !== 'idle')) {
    return true
  }
  const title = metadata?.title?.toLowerCase() || ''
  return title.includes('claude')
}

function parseCommandTokens(command: string | null | undefined): string[] {
  if (!command) return []
  return command
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
}

function labelFromCommand(command: string | null | undefined): string | null {
  const tokens = parseCommandTokens(command)
  for (const [commandName, label] of Object.entries(TOOL_COMMAND_NAMES)) {
    if (
      tokens.some((token) => token === commandName || token === `${commandName}.cmd` || token === `${commandName}.exe`)
    ) {
      return label
    }
  }
  return null
}

function labelFromTitle(title: string | null | undefined): string | null {
  const normalized = title?.toLowerCase() || ''
  if (normalized.includes('claude')) return 'Claude'
  if (normalized.includes('codex')) return 'Codex'
  return null
}

function labelFromCwd(cwd: string | null | undefined): string | null {
  const basename = basenameFromCwd(cwd)
  if (!basename) return null

  const normalized = basename.toLowerCase()
  if (FRONTEND_FOLDER_NAMES.has(normalized)) return 'Frontend'
  if (BACKEND_FOLDER_NAMES.has(normalized)) return 'Backend'
  return titleCaseWords(basename)
}

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
        labelFromCommand(metadata?.recentCommand) ||
        labelFromTitle(metadata?.title) ||
        labelFromCwd(metadata?.cwd) ||
        `Pane ${index + 1}`

      return { surfaceId: leaf.surfaceId, label }
    }),
  )
}
