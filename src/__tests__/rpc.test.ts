import { describe, it, expect, beforeEach, vi } from 'vitest'

type PtyDataCallback = (data: string) => void
type PtyExitCallback = (event: { exitCode: number; signal?: number }) => void
type CapabilitiesResult = { name: string; version: string; capabilities: string[] }
type WorkspaceSummaryResult = { workspace_id: string; title: string }

function expectCapabilitiesResult(value: unknown): CapabilitiesResult {
  expect(value).not.toBeNull()
  expect(typeof value).toBe('object')
  const result = value as Record<string, unknown>
  expect(typeof result.name).toBe('string')
  expect(typeof result.version).toBe('string')
  expect(Array.isArray(result.capabilities)).toBe(true)
  return result as CapabilitiesResult
}

function expectWorkspaceSummaryResult(value: unknown): WorkspaceSummaryResult {
  expect(value).not.toBeNull()
  expect(typeof value).toBe('object')
  const result = value as Record<string, unknown>
  expect(typeof result.workspace_id).toBe('string')
  expect(typeof result.title).toBe('string')
  return result as WorkspaceSummaryResult
}

function expectWorkspaceListResult(value: unknown): WorkspaceSummaryResult[] {
  expect(Array.isArray(value)).toBe(true)
  const result = value as unknown[]
  result.forEach((entry) => {
    expectWorkspaceSummaryResult(entry)
  })
  return result as WorkspaceSummaryResult[]
}

vi.mock('node-pty', () => {
  const EventEmitter = require('events')
  return {
    spawn: vi.fn(() => {
      const emitter = new EventEmitter()
      return {
        pid: 12345,
        onData: (cb: PtyDataCallback) => {
          emitter.on('data', cb)
          return { dispose: () => {} }
        },
        onExit: (cb: PtyExitCallback) => {
          emitter.on('exit', cb)
          return { dispose: () => {} }
        },
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
      }
    }),
  }
})

import { RpcHandler } from '../main/rpc'
import { WorkspaceManager } from '../main/workspace'
import { TerminalManager } from '../main/terminal'
describe('RpcHandler', () => {
  let rpc: RpcHandler
  let workspaces: WorkspaceManager
  let terminals: TerminalManager

  beforeEach(() => {
    terminals = new TerminalManager()
    workspaces = new WorkspaceManager(terminals)
    rpc = new RpcHandler(workspaces, terminals)
  })

  describe('v1 text protocol', () => {
    it('responds PONG to ping', () => {
      expect(rpc.handleV1('ping')).toBe('PONG')
    })

    it('responds to list_windows', () => {
      expect(rpc.handleV1('list_windows')).toBe('main')
    })

    it('returns error for unknown command', () => {
      expect(rpc.handleV1('nope')).toContain('error')
    })
  })

  describe('v2 json-rpc', () => {
    it('returns capabilities', () => {
      const res = rpc.handleV2({ id: 1, method: 'system.capabilities' })
      expect(res.ok).toBe(true)
      expect(expectCapabilitiesResult(res.result).name).toBe('takoyaki')
    })

    it('creates a workspace', () => {
      const res = rpc.handleV2({ id: 1, method: 'workspace.create', params: { title: 'test' } })
      expect(res.ok).toBe(true)
      expect(expectWorkspaceSummaryResult(res.result).title).toBe('test')
    })

    it('creates a workspace with an explicit project root', () => {
      rpc.handleV2({
        id: 1,
        method: 'workspace.create',
        params: { title: 'test', working_directory: '/workspace/app/backend', project_root: '/workspace/app' },
      })
      expect(workspaces.current()?.projectRoot).toBe('/workspace/app')
    })

    it('lists workspaces', () => {
      workspaces.create('one')
      workspaces.create('two')
      const res = rpc.handleV2({ id: 1, method: 'workspace.list' })
      expect(res.ok).toBe(true)
      expect(expectWorkspaceListResult(res.result)).toHaveLength(2)
    })

    it('closes a workspace', () => {
      const ws = workspaces.create('doomed')
      const res = rpc.handleV2({ id: 1, method: 'workspace.close', params: { workspace_id: ws.id } })
      expect(res.ok).toBe(true)
      expect(workspaces.list()).toHaveLength(0)
    })

    it('returns not_found for unknown workspace close', () => {
      const res = rpc.handleV2({ id: 1, method: 'workspace.close', params: { workspace_id: 'nope' } })
      expect(res.ok).toBe(false)
      expect(res.error?.code).toBe('not_found')
    })

    it('selects a workspace', () => {
      workspaces.create('one')
      const ws2 = workspaces.create('two')
      rpc.handleV2({ id: 1, method: 'workspace.select', params: { workspace_id: ws2.id } })
      expect(workspaces.activeWorkspaceId).toBe(ws2.id)
    })

    it('returns current workspace', () => {
      workspaces.create('active')
      const res = rpc.handleV2({ id: 1, method: 'workspace.current' })
      expect(res.ok).toBe(true)
      expect(expectWorkspaceSummaryResult(res.result).title).toBe('active')
    })

    it('returns null current when no workspaces', () => {
      const res = rpc.handleV2({ id: 1, method: 'workspace.current' })
      expect(res.ok).toBe(true)
      expect(res.result).toBeNull()
    })

    it('splits the focused surface', () => {
      workspaces.create()
      const res = rpc.handleV2({ id: 1, method: 'surface.split', params: { direction: 'right' } })
      expect(res.ok).toBe(true)
    })

    it('closes the focused surface', () => {
      workspaces.create()
      workspaces.splitFocused('horizontal')
      const res = rpc.handleV2({ id: 1, method: 'surface.close' })
      expect(res.ok).toBe(true)
    })

    it('requires surface_id for status updates', () => {
      const res = rpc.handleV2({ id: 1, method: 'status.update', params: { status: 'running' } })
      expect(res.ok).toBe(false)
      expect(res.error?.code).toBe('invalid_params')
    })

    it('returns method_not_found for unknown method', () => {
      const res = rpc.handleV2({ id: 1, method: 'does.not.exist' })
      expect(res.ok).toBe(false)
      expect(res.error?.code).toBe('method_not_found')
    })
  })
})
