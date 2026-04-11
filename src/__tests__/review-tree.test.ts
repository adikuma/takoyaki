import { describe, expect, it } from 'vitest'
import { buildReviewTree, type ReviewTreeNode } from '../renderer/review-tree'
import type { ReviewFile } from '../renderer/types'

function createFile(path: string, status: ReviewFile['status'] = 'modified'): ReviewFile {
  return {
    path,
    previousPath: null,
    status,
    stagedStatus: 'M',
    unstagedStatus: ' ',
  }
}

function serializeTree(nodes: ReviewTreeNode[]): unknown[] {
  return nodes.map((node) => {
    if (node.kind === 'file') return node.path
    return {
      folder: node.path,
      children: serializeTree(node.children),
    }
  })
}

describe('buildReviewTree', () => {
  it('groups changed files by parent folders and preserves nested structure', () => {
    const tree = buildReviewTree([
      createFile('src/app.ts'),
      createFile('src/lib/format.ts'),
      createFile('src/lib/math.ts'),
      createFile('server/routes/auth.ts'),
      createFile('README.md'),
    ])

    expect(serializeTree(tree)).toEqual([
      {
        folder: 'server',
        children: [
          {
            folder: 'server/routes',
            children: ['server/routes/auth.ts'],
          },
        ],
      },
      {
        folder: 'src',
        children: [
          {
            folder: 'src/lib',
            children: ['src/lib/format.ts', 'src/lib/math.ts'],
          },
          'src/app.ts',
        ],
      },
      'README.md',
    ])
  })

  it('sorts folders before files and orders siblings alphabetically', () => {
    const tree = buildReviewTree([
      createFile('z-last.ts'),
      createFile('alpha/file-b.ts'),
      createFile('alpha/file-a.ts'),
      createFile('beta/index.ts'),
      createFile('a-first.ts'),
    ])

    expect(serializeTree(tree)).toEqual([
      {
        folder: 'alpha',
        children: ['alpha/file-a.ts', 'alpha/file-b.ts'],
      },
      {
        folder: 'beta',
        children: ['beta/index.ts'],
      },
      'a-first.ts',
      'z-last.ts',
    ])
  })
})
