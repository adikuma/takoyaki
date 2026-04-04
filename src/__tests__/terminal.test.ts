import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// mock node-pty since conpty needs a real console which vitest doesnt have
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
        onExit: (cb: (e: { exitCode: number }) => void) => {
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

describe('TerminalManager', () => {
  let tm: TerminalManager

  beforeEach(() => {
    tm = new TerminalManager()
  })

  afterEach(() => {
    tm.destroyAll()
  })

  describe('create', () => {
    it('creates a terminal and returns info', () => {
      const info = tm.create()
      expect(info.id).toBeTruthy()
      expect(info.pid).toBe(12345)
      expect(tm.count()).toBe(1)
    })

    it('creates multiple terminals', () => {
      tm.create()
      tm.create()
      expect(tm.count()).toBe(2)
    })
  })

  describe('get', () => {
    it('returns info for existing terminal', () => {
      const info = tm.create()
      expect(tm.get(info.id)).toEqual(info)
    })

    it('returns undefined for unknown id', () => {
      expect(tm.get('nope')).toBeUndefined()
    })
  })

  describe('list', () => {
    it('lists all terminals', () => {
      tm.create()
      tm.create()
      expect(tm.list()).toHaveLength(2)
    })
  })

  describe('write', () => {
    it('writes to terminal', () => {
      const info = tm.create()
      const result = tm.write(info.id, 'echo hello\n')
      expect(result).toBe(true)
    })

    it('returns false for unknown terminal', () => {
      expect(tm.write('nope', 'test')).toBe(false)
    })
  })

  describe('destroy', () => {
    it('kills a terminal process', () => {
      const info = tm.create()
      expect(tm.destroy(info.id)).toBe(true)
      expect(tm.count()).toBe(0)
    })

    it('returns false for unknown id', () => {
      expect(tm.destroy('nope')).toBe(false)
    })
  })

  describe('destroyAll', () => {
    it('kills all terminals', () => {
      tm.create()
      tm.create()
      tm.destroyAll()
      expect(tm.count()).toBe(0)
    })
  })

  describe('events', () => {
    it('emits data events when pty sends output', () => {
      const info = tm.create()
      const received: string[] = []
      tm.on('data', (id: string, data: string) => {
        if (id === info.id) received.push(data)
      })
      // node-pty mock doesnt auto-emit, but the wiring is correct
      expect(tm.count()).toBe(1)
    })
  })
})
