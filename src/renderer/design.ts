// my mux design system

export const colors = {
  // surfaces
  bg: 'var(--mux-bg)',
  bgHover: 'var(--mux-bg-hover)',
  bgActive: 'var(--mux-bg-active)',
  bgInput: 'var(--mux-bg-input)',
  bgSubtle: 'var(--mux-bg-subtle)',
  bgCard: 'var(--mux-bg-card)',

  // borders
  separator: 'var(--mux-separator)',
  borderSubtle: 'var(--mux-border-subtle)',

  // text hierarchy
  textPrimary: 'var(--mux-text-primary)',
  textSecondary: 'var(--mux-text-secondary)',
  textMuted: 'var(--mux-text-muted)',
  textGhost: 'var(--mux-text-ghost)',

  // accent
  accent: 'var(--mux-accent)',
  accentSoft: 'var(--mux-accent-soft)',
  accentMuted: 'rgba(245, 158, 11, 0.4)',

  // status
  success: 'var(--mux-success)',
  error: 'var(--mux-error)',

  // diff
  diffAddBg: 'var(--mux-diff-add-bg)',
  diffDelBg: 'var(--mux-diff-del-bg)',
  diffAddText: 'var(--mux-diff-add-text)',
  diffDelText: 'var(--mux-diff-del-text)',
  diffHunkText: 'var(--mux-diff-hunk-text)',

  // terminal container
  terminalBg: 'var(--mux-terminal-bg)',

  // tooltip
  tooltipBg: 'var(--mux-tooltip-bg)',
  tooltipText: 'var(--mux-tooltip-text)',
} as const

export const fonts = {
  ui: "'DM Sans', system-ui, sans-serif",
  mono: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
} as const

export const sizes = {
  // spacing scale (multiples of 2)
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,

  // sidebar
  sidebarWidth: 300,
  sidebarMinWidth: 220,
  sidebarMaxWidth: 400,

  // titlebar
  titlebarHeight: 40,
  windowControlWidth: 46,

  // typography
  textXs: 11,
  textSm: 12,
  textBase: 14,
  textLg: 16,

  // icons
  iconSm: 13,
  iconBase: 15,

  // border radius
  radiusSm: 5,
  radiusMd: 8,
  radiusLg: 10,
} as const

// xterm terminal themes (hardcoded hex because xterm doesnt support css vars)
export function getTerminalTheme(mode: 'dark' | 'light') {
  if (mode === 'light') {
    return {
      background: '#ffffff',
      foreground: '#1c1917',
      cursor: '#ffffff',
      cursorAccent: '#ffffff',
      selectionBackground: 'rgba(217, 119, 6, 0.15)',
      selectionForeground: undefined,
      black: '#d6d3d1',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#d97706',
      blue: '#2563eb',
      magenta: '#9333ea',
      cyan: '#0891b2',
      white: '#1c1917',
      brightBlack: '#a8a29e',
      brightRed: '#ef4444',
      brightGreen: '#22c55e',
      brightYellow: '#f59e0b',
      brightBlue: '#3b82f6',
      brightMagenta: '#a855f7',
      brightCyan: '#06b6d4',
      brightWhite: '#0a0a0b',
    } as const
  }

  return {
    background: '#0a0a0b',
    foreground: '#d6d3d1',
    cursor: '#0a0a0b',
    cursorAccent: '#0a0a0b',
    selectionBackground: 'rgba(245, 158, 11, 0.12)',
    selectionForeground: undefined,
    black: '#1c1917',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#f59e0b',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#d6d3d1',
    brightBlack: '#57534e',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#fbbf24',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#fafaf9',
  } as const
}

// default terminal theme for initial render
export const terminalTheme = getTerminalTheme('dark')

// button style tokens
export const button = {
  base: {
    background: 'var(--mux-btn-bg)',
    boxShadow: '0 0 0 1px var(--mux-btn-ring), inset 0 1px 0 var(--mux-btn-highlight)',
    border: 'none',
  },
  hover: {
    background: 'var(--mux-btn-bg)',
    boxShadow: '0 0 0 1px var(--mux-btn-ring-hover), inset 0 1px 0 var(--mux-btn-highlight)',
  },
  active: {
    background: 'var(--mux-btn-bg)',
    boxShadow: '0 0 0 1px var(--mux-btn-ring), inset 0 1px 2px var(--mux-btn-highlight)',
  },
} as const

// tailwind class helpers
export const tw = {
  label: 'text-[11px] font-medium',
  title: 'text-[13px] font-medium',
  transition: 'transition-colors duration-[120ms]',
} as const
