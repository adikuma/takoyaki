export interface HookSessionMetadata {
  sessionId?: string | null
  transcriptPath?: string | null
  cwd?: string | null
  permissionMode?: string | null
  slug?: string | null
}

export interface PlanSnapshot {
  slug: string
  sourcePath: string
  updatedAt: string
  workspaceId: string
  markdown: string
}

export interface PlanSnapshotOptions {
  refresh?: boolean
}
