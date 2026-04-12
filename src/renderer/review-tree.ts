import type { ReviewFile } from './types'

export interface ReviewTreeFolderNode {
  kind: 'folder'
  name: string
  path: string
  children: ReviewTreeNode[]
}

export interface ReviewTreeFileNode {
  kind: 'file'
  name: string
  path: string
  file: ReviewFile
}

export type ReviewTreeNode = ReviewTreeFolderNode | ReviewTreeFileNode

interface MutableFolderNode {
  name: string
  path: string
  folders: Map<string, MutableFolderNode>
  files: ReviewTreeFileNode[]
}

// builds a mutable folder node while the tree is still being assembled
function createMutableFolder(name: string, path: string): MutableFolderNode {
  return {
    name,
    path,
    folders: new Map(),
    files: [],
  }
}

// converts the mutable tree into the renderer shape with stable folder first ordering
function sortNodes(folder: MutableFolderNode): ReviewTreeNode[] {
  const folders = [...folder.folders.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map<ReviewTreeFolderNode>((child) => ({
      kind: 'folder',
      name: child.name,
      path: child.path,
      children: sortNodes(child),
    }))

  const files = [...folder.files].sort(
    (left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path),
  )

  return [...folders, ...files]
}

// groups changed files by parent folders so the review rail shows structure before detail
export function buildReviewTree(files: ReviewFile[]): ReviewTreeNode[] {
  const root = createMutableFolder('', '')

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean)
    if (segments.length === 0) continue

    let current = root
    const fileName = segments[segments.length - 1]
    let currentPath = ''

    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      let next = current.folders.get(segment)
      if (!next) {
        next = createMutableFolder(segment, currentPath)
        current.folders.set(segment, next)
      }
      current = next
    }

    current.files.push({
      kind: 'file',
      name: fileName,
      path: file.path,
      file,
    })
  }

  return sortNodes(root)
}
