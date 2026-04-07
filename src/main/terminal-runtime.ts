import * as os from 'os'

export interface WindowsPtyRuntimeInfo {
  backend: 'conpty'
  buildNumber: number
}

export interface TerminalRuntimeInfo {
  platform: NodeJS.Platform
  windowsPty: WindowsPtyRuntimeInfo | null
}

const MODERN_CONPTY_BUILD = 21_376

export function parseWindowsBuildNumber(release: string): number {
  const buildNumber = Number.parseInt(release.split('.')[2] || '', 10)
  return Number.isFinite(buildNumber) ? buildNumber : MODERN_CONPTY_BUILD
}

export function getTerminalRuntimeInfo(
  platform: NodeJS.Platform = process.platform,
  release: string = os.release(),
): TerminalRuntimeInfo {
  if (platform !== 'win32') {
    return { platform, windowsPty: null }
  }

  return {
    platform,
    windowsPty: {
      backend: 'conpty',
      buildNumber: parseWindowsBuildNumber(release),
    },
  }
}
