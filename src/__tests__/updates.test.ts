import { describe, expect, it } from 'vitest'
import { createDefaultUpdateState } from '../shared/updates'

describe('update helpers', () => {
  it('starts idle when updates are enabled', () => {
    expect(createDefaultUpdateState('0.2.2', true)).toEqual({
      status: 'idle',
      currentVersion: '0.2.2',
      availableVersion: null,
      downloadPercent: null,
      detail: null,
      checkedAt: null,
      downloadedAt: null,
    })
  })

  it('starts disabled with a packaged-app hint when updates are unavailable', () => {
    expect(createDefaultUpdateState('0.2.2', false)).toEqual({
      status: 'disabled',
      currentVersion: '0.2.2',
      availableVersion: null,
      downloadPercent: null,
      detail: 'Updates are available only in the packaged app.',
      checkedAt: null,
      downloadedAt: null,
    })
  })
})
