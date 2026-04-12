type ThemeMode = 'dark' | 'light'

const DARK_PROJECT_ACCENT_PALETTE = ['#5F6CFF', '#5668F6', '#4D73FF', '#6670F0', '#4C7BEA', '#7164F4'] as const
const LIGHT_PROJECT_ACCENT_PALETTE = ['#D98A24', '#CF7A1D', '#D68F2E', '#C87420', '#D28934', '#BE6C18'] as const

export interface ProjectAccent {
  accent: string
  icon: string
  taskIcon: string
  connector: string
  hoverWash: string
  activeWash: string
  taskWash: string
}

// hashes a project seed into a stable palette index without storing per project settings
function hashSeed(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

// converts a hex accent into rgba values for the softer sidebar treatments
function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

// layers a bloom and gradient wash so project identity reads as atmosphere instead of chrome
function buildFlowingWash(accent: string, startAlpha: number, endAlpha: number, glowAlpha: number): string {
  return [
    `radial-gradient(140px 72px at 14% 50%, ${hexToRgba(accent, glowAlpha)} 0%, ${hexToRgba(accent, glowAlpha * 0.55)} 34%, transparent 72%)`,
    `linear-gradient(270deg, ${hexToRgba(accent, startAlpha)} 0%, ${hexToRgba(accent, (startAlpha + endAlpha) / 2)} 56%, ${hexToRgba(accent, endAlpha)} 100%)`,
  ].join(', ')
}

// returns the full sidebar accent treatment for a project in the active theme
export function getProjectAccent(seed: string | null | undefined, mode: ThemeMode = 'dark'): ProjectAccent {
  const normalizedSeed = seed?.trim().toLowerCase() || 'takoyaki'
  const palette = mode === 'light' ? LIGHT_PROJECT_ACCENT_PALETTE : DARK_PROJECT_ACCENT_PALETTE
  const accent = palette[hashSeed(normalizedSeed) % palette.length]

  if (mode === 'light') {
    return {
      accent,
      icon: hexToRgba(accent, 0.84),
      taskIcon: hexToRgba(accent, 0.58),
      connector: hexToRgba(accent, 0.24),
      hoverWash: buildFlowingWash(accent, 0.012, 0.048, 0.06),
      activeWash: buildFlowingWash(accent, 0.028, 0.108, 0.12),
      taskWash: buildFlowingWash(accent, 0.014, 0.052, 0.05),
    }
  }

  return {
    accent,
    icon: hexToRgba(accent, 0.72),
    taskIcon: hexToRgba(accent, 0.5),
    connector: hexToRgba(accent, 0.2),
    hoverWash: buildFlowingWash(accent, 0.01, 0.04, 0.045),
    activeWash: buildFlowingWash(accent, 0.02, 0.086, 0.09),
    taskWash: buildFlowingWash(accent, 0.012, 0.042, 0.038),
  }
}
