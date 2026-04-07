import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { HookSessionMetadata, PlanSnapshot, PlanSnapshotOptions } from '../shared/plan'

const CLAUDE_PLANS_DIR = path.join(os.homedir(), '.claude', 'plans')
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')
const TRANSCRIPT_TAIL_SIZES = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024]
const PLAN_RETRY_DELAYS_MS = [0, 120, 400, 1200]
const MAX_TRANSCRIPT_FILES_PER_WORKSPACE = 12

interface CachedPlanRecord {
  slug: string
  sourcePath: string
  updatedAt: string
  markdownFallback: string | null
}

type TranscriptPlanRecord = CachedPlanRecord
interface WorkspacePlanContext {
  workspaceId: string
  workingDirectory?: string | null
  projectRoot?: string | null
  surfaceIds?: string[] | null
}

interface CandidateTranscript {
  filePath: string
  lastModified: number
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase()
}

function isMainSessionPlanPath(filePath: string, slug?: string | null): boolean {
  const normalized = normalizePath(filePath)
  const expectedDir = normalizePath(CLAUDE_PLANS_DIR) + '/'
  if (!normalized.startsWith(expectedDir) || !normalized.endsWith('.md')) return false
  const baseName = path.basename(filePath, path.extname(filePath))
  if (baseName.includes('-agent-')) return false
  if (slug && baseName.toLowerCase() !== slug.toLowerCase()) return false
  return true
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function extractPlanRecordFromToolUseResult(
  toolUseResult: Record<string, unknown>,
  slug: string | null,
  updatedAt: string,
): TranscriptPlanRecord | null {
  const filePath = firstString(toolUseResult.filePath, toolUseResult.planFilePath)
  if (!filePath || !isMainSessionPlanPath(filePath, slug)) return null

  const markdownFallback = firstString(toolUseResult.plan, toolUseResult.content)

  return {
    slug: slug || path.basename(filePath, path.extname(filePath)),
    sourcePath: filePath,
    updatedAt,
    markdownFallback,
  }
}

function extractPlanRecordFromMessageContent(
  contentItem: Record<string, unknown>,
  slug: string | null,
  updatedAt: string,
): TranscriptPlanRecord | null {
  if (contentItem.type !== 'tool_use') return null

  const input = asRecord(contentItem.input)
  if (!input) return null

  if (contentItem.name === 'ExitPlanMode') {
    const filePath = firstString(input.planFilePath, input.filePath, input.file_path)
    if (!filePath || !isMainSessionPlanPath(filePath, slug)) return null

    return {
      slug: slug || path.basename(filePath, path.extname(filePath)),
      sourcePath: filePath,
      updatedAt,
      markdownFallback: firstString(input.plan, input.content, input.markdown),
    }
  }

  if (contentItem.name !== 'Write') return null

  const filePath = firstString(input.file_path, input.filePath, input.planFilePath)
  if (!filePath || !isMainSessionPlanPath(filePath, slug)) return null

  const markdownFallback = firstString(input.content, input.plan, input.markdown)

  return {
    slug: slug || path.basename(filePath, path.extname(filePath)),
    sourcePath: filePath,
    updatedAt,
    markdownFallback,
  }
}

function extractPlanRecord(line: string): TranscriptPlanRecord | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>
    const slug = typeof parsed.slug === 'string' ? parsed.slug : null
    const updatedAt = typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString()

    const toolUseResult = asRecord(parsed.toolUseResult)
    const resultRecord = toolUseResult ? extractPlanRecordFromToolUseResult(toolUseResult, slug, updatedAt) : null
    if (resultRecord) return resultRecord

    const message = asRecord(parsed.message)
    const content = Array.isArray(message?.content) ? message.content : []
    for (const contentItem of content) {
      const itemRecord = asRecord(contentItem)
      if (!itemRecord) continue
      const messageRecord = extractPlanRecordFromMessageContent(itemRecord, slug, updatedAt)
      if (messageRecord) return messageRecord
    }

    return null
  } catch {
    return null
  }
}

function findLatestPlanInTail(tailText: string): TranscriptPlanRecord | null {
  const lines = tailText.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim()
    if (!line) continue
    const record = extractPlanRecord(line)
    if (record) return record
  }
  return null
}

function readTranscriptTail(filePath: string, bytes: number): string {
  const stats = fs.statSync(filePath)
  const start = Math.max(0, stats.size - bytes)
  const length = stats.size - start
  const buffer = Buffer.alloc(length)
  const fd = fs.openSync(filePath, 'r')

  try {
    fs.readSync(fd, buffer, 0, length, start)
  } finally {
    fs.closeSync(fd)
  }

  const text = buffer.toString('utf8')
  // drop the first partial line when we start mid-file
  return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
}

export function resolveLatestPlanRecord(transcriptPath: string): TranscriptPlanRecord | null {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null

  for (const tailSize of TRANSCRIPT_TAIL_SIZES) {
    const tailText = readTranscriptTail(transcriptPath, tailSize)
    const record = findLatestPlanInTail(tailText)
    if (record) return record
  }

  return null
}

function parseIsoTimestamp(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function claudeProjectDirectoryName(cwd: string): string {
  return path.resolve(cwd).replace(/[:\\/]/g, '-')
}

function uniquePaths(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const next: string[] = []

  for (const value of values) {
    if (!value) continue
    const resolved = path.resolve(value)
    const normalized = normalizePath(resolved)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    next.push(resolved)
  }

  return next
}

function listCandidateTranscriptFilesFromDirectory(directoryPath: string): CandidateTranscript[] {
  if (!fs.existsSync(directoryPath)) return []

  return fs
    .readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => {
      const filePath = path.join(directoryPath, entry.name)
      return {
        filePath,
        lastModified: fs.statSync(filePath).mtimeMs,
      }
    })
    .sort((first, second) => second.lastModified - first.lastModified)
    .slice(0, MAX_TRANSCRIPT_FILES_PER_WORKSPACE)
}

export class PlanService {
  private surfaceSessions = new Map<string, HookSessionMetadata>()
  private workspacePlans = new Map<string, CachedPlanRecord>()
  private activeClaudeSurfaces = new Set<string>()

  noteSurfaceSession(surfaceId: string, metadata: HookSessionMetadata): void {
    if (!surfaceId) return

    const current = this.surfaceSessions.get(surfaceId) || {}
    this.surfaceSessions.set(surfaceId, {
      sessionId: metadata.sessionId !== undefined ? metadata.sessionId : (current.sessionId ?? null),
      transcriptPath:
        metadata.transcriptPath !== undefined ? metadata.transcriptPath : (current.transcriptPath ?? null),
      cwd: metadata.cwd !== undefined ? metadata.cwd : (current.cwd ?? null),
      permissionMode:
        metadata.permissionMode !== undefined ? metadata.permissionMode : (current.permissionMode ?? null),
      slug: metadata.slug !== undefined ? metadata.slug : (current.slug ?? null),
    })
  }

  noteSurfaceEvent(surfaceId: string, eventName: string): boolean {
    if (!surfaceId) return false

    if (eventName === 'SessionEnd') {
      return this.activeClaudeSurfaces.delete(surfaceId)
    }

    const session = this.surfaceSessions.get(surfaceId)
    const hasClaudeSession = Boolean(session?.sessionId || session?.transcriptPath || session?.cwd || session?.slug)
    if (!hasClaudeSession || this.activeClaudeSurfaces.has(surfaceId)) return false

    this.activeClaudeSurfaces.add(surfaceId)
    return true
  }

  getActiveSurfaceIds(): string[] {
    return [...this.activeClaudeSurfaces]
  }

  pruneSurfaceIds(surfaceIds: Iterable<string>): boolean {
    const validSurfaceIds = new Set(surfaceIds)
    let changed = false

    for (const surfaceId of [...this.activeClaudeSurfaces]) {
      if (validSurfaceIds.has(surfaceId)) continue
      this.activeClaudeSurfaces.delete(surfaceId)
      changed = true
    }

    for (const surfaceId of [...this.surfaceSessions.keys()]) {
      if (validSurfaceIds.has(surfaceId)) continue
      this.surfaceSessions.delete(surfaceId)
    }

    return changed
  }

  private transcriptHintsForWorkspace(surfaceIds: string[] | null | undefined): CandidateTranscript[] {
    if (!surfaceIds?.length) return []

    const candidates = new Map<string, CandidateTranscript>()
    for (const surfaceId of surfaceIds) {
      const transcriptPath = this.surfaceSessions.get(surfaceId)?.transcriptPath
      if (!transcriptPath || !fs.existsSync(transcriptPath)) continue

      const normalized = normalizePath(transcriptPath)
      if (candidates.has(normalized)) continue
      candidates.set(normalized, {
        filePath: transcriptPath,
        lastModified: fs.statSync(transcriptPath).mtimeMs,
      })
    }

    return [...candidates.values()].sort((first, second) => second.lastModified - first.lastModified)
  }

  private transcriptDirectoryCandidates(context: WorkspacePlanContext): CandidateTranscript[] {
    const cwdCandidates = uniquePaths([context.workingDirectory, context.projectRoot])
    const transcriptFiles = new Map<string, CandidateTranscript>()

    for (const cwd of cwdCandidates) {
      const transcriptDirectory = path.join(CLAUDE_PROJECTS_DIR, claudeProjectDirectoryName(cwd))
      for (const transcript of listCandidateTranscriptFilesFromDirectory(transcriptDirectory)) {
        transcriptFiles.set(normalizePath(transcript.filePath), transcript)
      }
    }

    for (const transcript of this.transcriptHintsForWorkspace(context.surfaceIds)) {
      transcriptFiles.set(normalizePath(transcript.filePath), transcript)
    }

    return [...transcriptFiles.values()]
      .sort((first, second) => second.lastModified - first.lastModified)
      .slice(0, MAX_TRANSCRIPT_FILES_PER_WORKSPACE)
  }

  private resolveLatestPlanForWorkspace(context: WorkspacePlanContext): TranscriptPlanRecord | null {
    const transcriptCandidates = this.transcriptDirectoryCandidates(context)
    if (!transcriptCandidates.length) return null

    let latest: TranscriptPlanRecord | null = null
    let latestScore = 0

    for (const transcript of transcriptCandidates) {
      const record = resolveLatestPlanRecord(transcript.filePath)
      if (!record) continue

      const score = parseIsoTimestamp(record.updatedAt) || transcript.lastModified
      if (!latest || score >= latestScore) {
        latest = record
        latestScore = score
      }
    }

    return latest
  }

  async handleStatusUpdate(
    surfaceId: string,
    workspaceId: string | null,
    status: 'running' | 'finished' | 'failed',
  ): Promise<void> {
    if (!surfaceId || !workspaceId || (status !== 'finished' && status !== 'failed')) return

    const session = this.surfaceSessions.get(surfaceId)
    if (!session?.transcriptPath || session.permissionMode !== 'plan') return

    const record = await this.resolveLatestPlanWithRetry(session.transcriptPath)
    if (!record) return

    const current = this.workspacePlans.get(workspaceId)
    if (current && current.sourcePath === record.sourcePath && current.updatedAt === record.updatedAt) return

    this.workspacePlans.set(workspaceId, record)
  }

  async getSnapshot(context: WorkspacePlanContext, options: PlanSnapshotOptions = {}): Promise<PlanSnapshot | null> {
    const record =
      options.refresh || !this.workspacePlans.has(context.workspaceId)
        ? this.resolveLatestPlanForWorkspace(context)
        : this.workspacePlans.get(context.workspaceId)

    if (!record) return null

    const current = this.workspacePlans.get(context.workspaceId)
    if (!current || current.sourcePath !== record.sourcePath || current.updatedAt !== record.updatedAt) {
      this.workspacePlans.set(context.workspaceId, record)
    }

    let markdown = ''
    if (fs.existsSync(record.sourcePath)) {
      markdown = await fs.promises.readFile(record.sourcePath, 'utf-8')
    } else if (record.markdownFallback) {
      markdown = record.markdownFallback
    } else {
      return null
    }

    return {
      workspaceId: context.workspaceId,
      slug: record.slug,
      sourcePath: record.sourcePath,
      updatedAt: record.updatedAt,
      markdown,
    }
  }
  private async resolveLatestPlanWithRetry(transcriptPath: string): Promise<TranscriptPlanRecord | null> {
    for (const delayMs of PLAN_RETRY_DELAYS_MS) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }

      const record = resolveLatestPlanRecord(transcriptPath)
      if (record) return record
    }

    return null
  }
}
