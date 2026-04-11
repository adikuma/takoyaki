export const DEFAULT_TERMINAL_FONT_SIZE = 14
export const MIN_TERMINAL_FONT_SIZE = 10
export const MAX_TERMINAL_FONT_SIZE = 24
export const TERMINAL_FONT_SIZE_STEP = 1

export function clampTerminalFontSize(fontSize: number): number {
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(fontSize)))
}
