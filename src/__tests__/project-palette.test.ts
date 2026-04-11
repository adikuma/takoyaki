import { describe, expect, it } from 'vitest'
import { getProjectAccent } from '../renderer/sidebar/project-palette'

describe('project palette', () => {
  it('returns the same accent tokens for the same project seed', () => {
    expect(getProjectAccent('C:/Code/Takoyaki')).toEqual(getProjectAccent('C:/Code/Takoyaki'))
  })

  it('uses different palette entries for different project seeds', () => {
    const alpha = getProjectAccent('C:/Code/Alpha', 'dark')
    const beta = getProjectAccent('C:/Code/Beta', 'dark')

    expect(alpha.accent).not.toBe(beta.accent)
  })

  it('switches between cool dark accents and warm light accents', () => {
    const dark = getProjectAccent('C:/Code/Takoyaki', 'dark')
    const light = getProjectAccent('C:/Code/Takoyaki', 'light')

    expect(dark.accent).not.toBe(light.accent)
  })

  it('produces muted rgba tokens for sidebar treatments', () => {
    const accent = getProjectAccent('C:/Code/Takoyaki', 'dark')

    expect(accent.hoverWash).toContain('linear-gradient')
    expect(accent.activeWash).toContain('linear-gradient')
    expect(accent.taskWash).toContain('linear-gradient')
    expect(accent.connector).toMatch(/^rgba\(/)
  })
})
