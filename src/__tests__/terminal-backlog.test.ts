import { describe, expect, it } from 'vitest'
import type { TerminalEvent } from '../renderer/types'
import {
  TERMINAL_FAST_FORWARD_MAX_QUEUED_BYTES,
  TERMINAL_FAST_FORWARD_MAX_QUEUED_EVENTS,
  filterTerminalEventsAfterEventId,
  shouldCollapseRestoredShellPadding,
  shouldFastForwardTerminalBacklog,
  terminalEventPayloadBytes,
} from '../renderer/terminal-backlog'

function outputEvent(eventId: number, data: string): TerminalEvent {
  return {
    terminalId: 'term-1',
    eventId,
    createdAt: new Date(0).toISOString(),
    type: 'output',
    data,
  }
}

describe('terminal backlog helpers', () => {
  it('measures output payload bytes', () => {
    expect(terminalEventPayloadBytes(outputEvent(1, 'hello'))).toBe(5)
  })

  it('measures error payload bytes', () => {
    const event: TerminalEvent = {
      terminalId: 'term-1',
      eventId: 1,
      createdAt: new Date(0).toISOString(),
      type: 'error',
      message: 'bad',
    }

    expect(terminalEventPayloadBytes(event)).toBe(3)
  })

  it('ignores non-payload events', () => {
    const event: TerminalEvent = {
      terminalId: 'term-1',
      eventId: 1,
      createdAt: new Date(0).toISOString(),
      type: 'exited',
      exitCode: 0,
      exitSignal: null,
    }

    expect(terminalEventPayloadBytes(event)).toBe(0)
  })

  it('fast-forwards only once backlog exceeds the byte or event threshold', () => {
    expect(
      shouldFastForwardTerminalBacklog({
        queuedBytes: TERMINAL_FAST_FORWARD_MAX_QUEUED_BYTES,
        queuedEvents: 1,
      }),
    ).toBe(false)

    expect(
      shouldFastForwardTerminalBacklog({
        queuedBytes: TERMINAL_FAST_FORWARD_MAX_QUEUED_BYTES + 1,
        queuedEvents: 1,
      }),
    ).toBe(true)

    expect(
      shouldFastForwardTerminalBacklog({
        queuedBytes: 1,
        queuedEvents: TERMINAL_FAST_FORWARD_MAX_QUEUED_EVENTS,
      }),
    ).toBe(false)

    expect(
      shouldFastForwardTerminalBacklog({
        queuedBytes: 1,
        queuedEvents: TERMINAL_FAST_FORWARD_MAX_QUEUED_EVENTS + 1,
      }),
    ).toBe(true)
  })

  it('drops stale events after a snapshot event id', () => {
    const events = [outputEvent(1, 'old'), outputEvent(2, 'current'), outputEvent(3, 'new')]

    expect(filterTerminalEventsAfterEventId(events, 2)).toEqual([outputEvent(3, 'new')])
  })

  it('collapses restored shell padding when only blank rows exist before the cursor', () => {
    expect(
      shouldCollapseRestoredShellPadding({
        bufferType: 'normal',
        baseY: 0,
        viewportY: 0,
        cursorY: 6,
        leadingVisibleLines: ['', '', '', '', '', ''],
      }),
    ).toBe(true)
  })

  it('keeps restored shell padding when real content exists above the cursor', () => {
    expect(
      shouldCollapseRestoredShellPadding({
        bufferType: 'normal',
        baseY: 0,
        viewportY: 0,
        cursorY: 6,
        leadingVisibleLines: ['', '', 'npm run dev', '', '', ''],
      }),
    ).toBe(false)
  })

  it('keeps alternate-screen restores exact', () => {
    expect(
      shouldCollapseRestoredShellPadding({
        bufferType: 'alternate',
        baseY: 0,
        viewportY: 0,
        cursorY: 8,
        leadingVisibleLines: ['', '', '', '', '', '', '', ''],
      }),
    ).toBe(false)
  })
})
