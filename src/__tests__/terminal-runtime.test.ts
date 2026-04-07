import { describe, expect, it } from 'vitest'
import { getTerminalRuntimeInfo, parseWindowsBuildNumber } from '../main/terminal-runtime'

describe('terminal runtime', () => {
  it('parses the windows build number from os.release()', () => {
    expect(parseWindowsBuildNumber('10.0.26200')).toBe(26200)
  })

  it('falls back to a modern conpty build when parsing fails', () => {
    expect(parseWindowsBuildNumber('bad-release')).toBe(21376)
  })

  it('returns conpty metadata on windows', () => {
    expect(getTerminalRuntimeInfo('win32', '10.0.26200')).toEqual({
      platform: 'win32',
      windowsPty: {
        backend: 'conpty',
        buildNumber: 26200,
      },
    })
  })

  it('returns null windows pty info on non-windows platforms', () => {
    expect(getTerminalRuntimeInfo('darwin', '24.0.0')).toEqual({
      platform: 'darwin',
      windowsPty: null,
    })
  })
})
