import { describe, expect, it } from 'vitest'
import { matchTakoyakiShortcut } from '../shared/shortcuts'

describe('matchTakoyakiShortcut', () => {
  it('matches pane shortcuts on ctrl shift combos', () => {
    expect(
      matchTakoyakiShortcut({
        key: 'd',
        shiftKey: true,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
      }),
    ).toEqual({ kind: 'split', direction: 'horizontal' })

    expect(
      matchTakoyakiShortcut({
        key: 'u',
        shiftKey: true,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
      }),
    ).toEqual({ kind: 'split', direction: 'vertical' })
  })

  it('keeps raw ctrl letter combos out of the app shortcut map', () => {
    expect(
      matchTakoyakiShortcut({
        key: 'd',
        shiftKey: false,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
      }),
    ).toBeNull()

    expect(
      matchTakoyakiShortcut({
        key: 'f',
        shiftKey: false,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
      }),
    ).toBeNull()
  })

  it('matches project jumps on ctrl shift numbers', () => {
    expect(
      matchTakoyakiShortcut({
        key: '4',
        shiftKey: true,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
      }),
    ).toEqual({ kind: 'jump-project', index: 3 })
  })

  it('matches focus movement on ctrl alt arrows', () => {
    expect(
      matchTakoyakiShortcut({
        key: 'ArrowLeft',
        shiftKey: false,
        altKey: true,
        ctrlKey: true,
        metaKey: false,
      }),
    ).toEqual({ kind: 'move-focus', direction: 'left' })
  })
})
