import type { TerminalEvent } from './types'

export const TERMINAL_FAST_FORWARD_MAX_QUEUED_BYTES = 512 * 1024
export const TERMINAL_FAST_FORWARD_MAX_QUEUED_EVENTS = 200
export const TERMINAL_OUTPUT_BATCH_BYTES = 64 * 1024

const terminalTextEncoder = new TextEncoder()

export interface TerminalBacklogCounter {
  queuedBytes: number
  queuedEvents: number
}

export interface TerminalRestorePaddingInspection {
  bufferType: 'normal' | 'alternate'
  baseY: number
  viewportY: number
  cursorY: number
  leadingVisibleLines: string[]
}

export function terminalEventPayloadBytes(event: TerminalEvent): number {
  switch (event.type) {
    case 'output':
      return terminalTextEncoder.encode(event.data).byteLength
    case 'error':
      return terminalTextEncoder.encode(event.message).byteLength
    default:
      return 0
  }
}

export function shouldFastForwardTerminalBacklog(backlog: TerminalBacklogCounter): boolean {
  return (
    backlog.queuedBytes > TERMINAL_FAST_FORWARD_MAX_QUEUED_BYTES ||
    backlog.queuedEvents > TERMINAL_FAST_FORWARD_MAX_QUEUED_EVENTS
  )
}

export function filterTerminalEventsAfterEventId(events: TerminalEvent[], lastEventId: number): TerminalEvent[] {
  return events.filter((event) => event.eventId > lastEventId)
}

export function shouldCollapseRestoredShellPadding(inspection: TerminalRestorePaddingInspection): boolean {
  if (inspection.bufferType !== 'normal') return false
  if (inspection.baseY !== 0 || inspection.viewportY !== 0) return false
  if (inspection.cursorY < 4) return false
  if (inspection.leadingVisibleLines.length < inspection.cursorY) return false
  return inspection.leadingVisibleLines.every((line) => line.trim().length === 0)
}
