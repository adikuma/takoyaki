import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FolderClosed } from 'lucide-react'
import { colors, fonts, sizes } from './design'
import { buildReviewTree, type ReviewTreeNode } from './review-tree'
import type { ReviewFile, ReviewFileStatus } from './types'

interface ReviewTreeProps {
  files: ReviewFile[]
  selectedFilePath: string | null
  onSelect: (path: string) => void
}

// reuses the diff color mapping so tree rows hint at change type without extra badges
function getStatusColor(status: ReviewFileStatus): string {
  if (status === 'added' || status === 'untracked') return colors.diffAddText
  if (status === 'deleted') return colors.diffDelText
  if (status === 'renamed' || status === 'copied') return colors.accent
  return colors.textSecondary
}

// keeps parent folders visually active when they contain the selected file
function nodeContainsSelectedPath(node: ReviewTreeNode, selectedFilePath: string | null): boolean {
  if (!selectedFilePath) return false
  if (node.kind === 'file') return node.path === selectedFilePath
  return node.children.some((child) => nodeContainsSelectedPath(child, selectedFilePath))
}

// renders the changed file tree with local expand and collapse state
export function ReviewTree({ files, selectedFilePath, onSelect }: ReviewTreeProps) {
  const tree = useMemo(() => buildReviewTree(files), [files])
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())

  // resets folder expansion when the review snapshot changes to a new file set
  useEffect(() => {
    setCollapsedFolders(new Set())
  }, [files])

  const toggleFolder = (folderPath: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      return next
    })
  }

  const renderNode = (node: ReviewTreeNode, depth: number): ReactNode => {
    if (node.kind === 'folder') {
      const collapsed = collapsedFolders.has(node.path)
      const hasSelectedDescendant = nodeContainsSelectedPath(node, selectedFilePath)
      return (
        <div key={node.path}>
          <button
            onClick={() => toggleFolder(node.path)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors duration-[120ms]"
            style={{
              paddingLeft: 16 + depth * 16,
              color: hasSelectedDescendant ? colors.textPrimary : colors.textSecondary,
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = colors.bgCard
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = 'transparent'
            }}
          >
            {collapsed ? (
              <ChevronRight size={sizes.iconSm} strokeWidth={1.8} color={colors.textMuted} />
            ) : (
              <ChevronDown size={sizes.iconSm} strokeWidth={1.8} color={colors.textMuted} />
            )}
            <FolderClosed size={sizes.iconBase} strokeWidth={1.8} color={colors.textMuted} />
            <span className="min-w-0 truncate text-[12px]">{node.name}</span>
          </button>
          {!collapsed && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    const active = node.path === selectedFilePath
    const statusColor = getStatusColor(node.file.status)
    return (
      <button
        key={node.path}
        onClick={() => onSelect(node.path)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-[120ms]"
        style={{
          paddingLeft: 16 + depth * 16 + 12,
          background: active ? colors.bgInput : 'transparent',
        }}
        onMouseEnter={(event) => {
          if (!active) event.currentTarget.style.background = colors.bgCard
        }}
        onMouseLeave={(event) => {
          if (!active) event.currentTarget.style.background = 'transparent'
        }}
      >
        <span
          className="shrink-0 rounded-full"
          style={{
            width: 8,
            height: 8,
            background: statusColor,
            opacity: active ? 1 : 0.82,
          }}
        />
        <span
          className="min-w-0 truncate text-[12px]"
          style={{
            color: active ? colors.textPrimary : colors.textSecondary,
            fontFamily: fonts.mono,
          }}
        >
          {node.name}
        </span>
      </button>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ borderRight: `1px solid ${colors.separator}` }}>
      <div
        className="shrink-0 px-4 py-3 text-[10px] font-semibold uppercase"
        style={{ color: colors.textMuted, letterSpacing: '0.08em', borderBottom: `1px solid ${colors.borderSubtle}` }}
      >
        Changed Tree
      </div>
      <div className="flex-1 overflow-y-auto">{tree.map((node) => renderNode(node, 0))}</div>
    </div>
  )
}
