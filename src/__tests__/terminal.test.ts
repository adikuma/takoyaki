import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as nodePty from 'node-pty'
import type { TerminalEvent, TerminalPromptEvent } from '../main/terminal'

vi.mock('node-pty', () => {
  const EventEmitter = require('events')
  return {
    spawn: vi.fn(() => {
      const emitter = new EventEmitter()
      return {
        pid: 12345,
        onData: (cb: (data: string) => void) => {
          emitter.on('data', cb)
          return { dispose: () => emitter.removeAllListeners('data') }
        },
        onExit: (cb: (event: { exitCode: number; signal?: number }) => void) => {
          emitter.on('exit', cb)
          return { dispose: () => emitter.removeAllListeners('exit') }
        },
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(() => {
          emitter.emit('exit', { exitCode: 0 })
        }),
        _emitter: emitter,
      }
    }),
  }
})

import { TerminalManager } from '../main/terminal'

type MockPty = {
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  _emitter: {
    emit: (event: string, payload: unknown) => void
  }
}

describe('TerminalManager', () => {
  let tm: TerminalManager

  beforeEach(() => {
    tm = new TerminalManager()
  })

  afterEach(() => {
    tm.destroyAll()
  })

  function latestPty(): MockPty {
    const spawnMock = vi.mocked(nodePty.spawn)
    const result = spawnMock.mock.results.at(-1)
    if (!result) throw new Error('expected a spawned pty')
    return result.value as MockPty
  }

  async function settleTerminal(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('creates a terminal and returns info', () => {
    const info = tm.create()
    expect(info.id).toBeTruthy()
    expect(info.pid).toBe(12345)
    expect(tm.count()).toBe(1)
  })

  it('open returns the current snapshot for a terminal', () => {
    const info = tm.create()
    const snapshot = tm.open(info.id)

    expect(snapshot).toMatchObject({
      terminalId: info.id,
      cwd: info.cwd,
      title: null,
      recentCommand: null,
      cols: 120,
      rows: 30,
      status: 'running',
      pid: 12345,
      history: '',
    })
    expect(snapshot?.lastEventId).toBe(1)
  })

  it('captures pty output in snapshot history', async () => {
    const info = tm.create()
    latestPty()._emitter.emit('data', 'hello from pty')
    await settleTerminal()

    const snapshot = tm.open(info.id)
    expect(snapshot?.history).toContain('hello from pty')
    expect(snapshot?.serializedState).toContain('hello from pty')
    expect(snapshot?.lastEventId).toBe(2)
  })

  it('emits a prompt event after the cwd marker returns in terminal output', async () => {
    const prompts: TerminalPromptEvent[] = []
    tm.on('prompt', (event: TerminalPromptEvent) => {
      prompts.push(event)
    })

    const info = tm.create()
    const cwd = process.cwd().replace(/\\/g, '/')
    latestPty()._emitter.emit('data', `\x1b]633;takoyaki-cwd=${encodeURIComponent(cwd)}\x07`)
    await settleTerminal()

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({
      terminalId: info.id,
      cwd,
    })
  })

  it('tracks terminal title metadata from osc output', async () => {
    const events: TerminalEvent[] = []
    tm.on('event', (event: TerminalEvent) => {
      events.push(event)
    })

    const info = tm.create()
    latestPty()._emitter.emit('data', '\x1b]0;Codex - Takoyaki\x07')
    await settleTerminal()

    const snapshot = tm.open(info.id)
    expect(snapshot?.title).toBe('Codex - Takoyaki')

    const metadataEvent = events.find((event) => event.type === 'metadata')
    if (!metadataEvent || metadataEvent.type !== 'metadata') throw new Error('expected metadata event')
    expect(metadataEvent.title).toBe('Codex - Takoyaki')
  })

  it('tracks the most recent submitted command as terminal metadata', () => {
    const events: TerminalEvent[] = []
    tm.on('event', (event: TerminalEvent) => {
      events.push(event)
    })

    const info = tm.create()
    expect(tm.write(info.id, 'codex --continue\r')).toBe(true)

    const snapshot = tm.open(info.id)
    expect(snapshot?.recentCommand).toBe('codex --continue')

    const metadataEvent = events.at(-1)
    if (!metadataEvent || metadataEvent.type !== 'metadata') throw new Error('expected metadata event')
    expect(metadataEvent.recentCommand).toBe('codex --continue')
  })

  it('emits ordered started output and exited events', async () => {
    const events: TerminalEvent[] = []
    tm.on('event', (event: TerminalEvent) => {
      events.push(event)
    })

    const info = tm.create()
    latestPty()._emitter.emit('data', 'one line')
    latestPty()._emitter.emit('exit', { exitCode: 7, signal: 0 })
    await settleTerminal()

    expect(events.map((event) => event.type)).toEqual(['started', 'output', 'exited'])
    expect(events.every((event) => event.terminalId === info.id)).toBe(true)
    expect(events.map((event) => event.eventId)).toEqual([1, 2, 3])

    const started = events[0]
    if (started.type !== 'started') throw new Error('expected started event')
    expect(started.snapshot.lastEventId).toBe(1)
  })

  it('writes and resizes the live pty', async () => {
    const info = tm.create()
    const pty = latestPty()

    expect(tm.write(info.id, 'echo hi\n')).toBe(true)
    expect(pty.write).toHaveBeenCalledWith('echo hi\n')

    tm.resize(info.id, 140, 42)
    await settleTerminal()
    expect(pty.resize).toHaveBeenCalledWith(140, 42)

    const snapshot = tm.open(info.id)
    expect(snapshot?.cols).toBe(140)
    expect(snapshot?.rows).toBe(42)
  })

  it('keeps exited sessions available for snapshot reopen', async () => {
    const info = tm.create()
    latestPty()._emitter.emit('data', 'before exit')
    latestPty()._emitter.emit('exit', { exitCode: 3, signal: 0 })
    await settleTerminal()

    const snapshot = tm.open(info.id)
    expect(snapshot?.status).toBe('exited')
    expect(snapshot?.exitCode).toBe(3)
    expect(snapshot?.history).toContain('before exit')
  })

  it('destroy removes the session entirely', () => {
    const info = tm.create()
    expect(tm.destroy(info.id)).toBe(true)
    expect(tm.open(info.id)).toBeNull()
    expect(tm.count()).toBe(0)
  })
})
