export interface ShortcutInput {
  key: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

export type RoutedShortcutAction = 'toggle-sidebar' | 'find' | 'find-projects'
export type FocusDirection = 'left' | 'right' | 'up' | 'down'

export type ShortcutMatch =
  | {
      kind: 'shortcut'
      action: RoutedShortcutAction
    }
  | {
      kind: 'split'
      direction: 'horizontal' | 'vertical'
    }
  | {
      kind: 'close-pane'
    }
  | {
      kind: 'open-project'
    }
  | {
      kind: 'save-session'
    }
  | {
      kind: 'jump-project'
      index: number
    }
  | {
      kind: 'move-focus'
      direction: FocusDirection
    }

export const shortcutDisplayRows: Array<{ description: string; label: string }> = [
  { description: 'Open project', label: 'Ctrl+Shift+O' },
  { description: 'Split right', label: 'Ctrl+Shift+D' },
  { description: 'Split down', label: 'Ctrl+Shift+U' },
  { description: 'Close pane', label: 'Ctrl+Shift+W' },
  { description: 'Toggle sidebar', label: 'Ctrl+Shift+B' },
  { description: 'Search terminal', label: 'Ctrl+Shift+L' },
  { description: 'Search projects', label: 'Ctrl+Shift+F' },
  { description: 'Save session', label: 'Ctrl+Shift+S' },
  { description: 'Move focus', label: 'Ctrl+Alt+Arrow' },
  { description: 'Next item', label: 'Ctrl+Tab' },
  { description: 'Previous item', label: 'Ctrl+Shift+Tab' },
  { description: 'Jump to project', label: 'Ctrl+Shift+1-9' },
]

export function matchTakoyakiShortcut(input: ShortcutInput): ShortcutMatch | null {
  if (!(input.ctrlKey || input.metaKey)) return null

  const key = input.key.toLowerCase()

  if (input.altKey) {
    if (input.shiftKey) return null
    if (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup' || key === 'arrowdown') {
      return {
        kind: 'move-focus',
        direction: key.replace('arrow', '') as FocusDirection,
      }
    }
    return null
  }

  if (!input.shiftKey) return null

  if (key === 'b') return { kind: 'shortcut', action: 'toggle-sidebar' }
  if (key === 'd') return { kind: 'split', direction: 'horizontal' }
  if (key === 'u') return { kind: 'split', direction: 'vertical' }
  if (key === 'w') return { kind: 'close-pane' }
  if (key === 'o') return { kind: 'open-project' }
  if (key === 'l') return { kind: 'shortcut', action: 'find' }
  if (key === 'f') return { kind: 'shortcut', action: 'find-projects' }
  if (key === 's') return { kind: 'save-session' }
  if (/^[1-9]$/.test(key)) return { kind: 'jump-project', index: Number.parseInt(key, 10) - 1 }

  return null
}
