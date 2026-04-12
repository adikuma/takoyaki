// handles json-rpc v1 (text) and v2 (json) protocol

import { WorkspaceManager } from './workspace'
import { TerminalManager } from './terminal'
import type { ClaudeStatusUpdate } from '../shared/claude-status'

export interface RpcRequest {
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

export interface RpcResponse {
  id?: string | number
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}

// wraps a successful rpc result in the shared response shape
function ok(id: unknown, result: unknown): RpcResponse {
  return { id: id as string, ok: true, result }
}

// wraps a failed rpc result with a stable error shape
function err(id: unknown, code: string, message: string): RpcResponse {
  return { id: id as string, ok: false, error: { code, message } }
}

export class RpcHandler {
  onStatusUpdate: ((surfaceId: string, update: ClaudeStatusUpdate) => void) | null = null

  constructor(
    private workspaces: WorkspaceManager,
    private terminals: TerminalManager,
  ) {}

  handleV1(line: string): string {
    const cmd = line.trim().split(/\s+/)[0]
    switch (cmd) {
      case 'ping':
        return 'PONG'
      case 'list_windows':
        return 'main'
      case 'new_window':
        return 'OK'
      case 'current_window':
        return 'main'
      case 'close_window':
        return 'OK'
      case 'focus_window':
        return 'OK'
      default:
        return `error: unknown command ${cmd}`
    }
  }

  handleV2(req: RpcRequest): RpcResponse {
    const p = req.params || {}

    switch (req.method) {
      case 'system.capabilities':
        return ok(req.id, { name: 'takoyaki', version: '0.1.1', capabilities: ['workspace', 'surface'] })

      case 'workspace.list':
        return ok(
          req.id,
          this.workspaces.list().map((w) => ({ workspace_id: w.id, title: w.title })),
        )

      case 'workspace.create': {
        const ws = this.workspaces.create(
          p.title as string,
          p.working_directory as string,
          (p.project_root as string) || (p.working_directory as string),
        )
        return ok(req.id, { workspace_id: ws.id, title: ws.title })
      }

      case 'workspace.close': {
        const id = p.workspace_id as string
        if (!id) return err(req.id, 'invalid_params', 'workspace_id required')
        return this.workspaces.close(id)
          ? ok(req.id, { closed: true })
          : err(req.id, 'not_found', 'workspace not found')
      }

      case 'workspace.select': {
        const id = p.workspace_id as string
        if (!id) return err(req.id, 'invalid_params', 'workspace_id required')
        return this.workspaces.select(id) ? ok(req.id, {}) : err(req.id, 'not_found', 'workspace not found')
      }

      case 'workspace.current': {
        const ws = this.workspaces.current()
        return ok(req.id, ws ? { workspace_id: ws.id, title: ws.title } : null)
      }

      case 'surface.list':
        return ok(
          req.id,
          this.workspaces.surfacesForWorkspace((p.workspace_id as string) || this.workspaces.activeWorkspaceId || ''),
        )

      case 'surface.split': {
        const dir = (p.direction as string) === 'down' ? ('vertical' as const) : ('horizontal' as const)
        return this.workspaces.splitFocused(dir) ? ok(req.id, {}) : err(req.id, 'failed', 'split failed')
      }

      case 'surface.close': {
        return this.workspaces.closeFocused() ? ok(req.id, { closed: true }) : err(req.id, 'failed', 'close failed')
      }

      case 'surface.focus': {
        const sid = (p.surface_id || p.panel_id) as string
        if (!sid) return err(req.id, 'invalid_params', 'surface_id required')
        return this.workspaces.focusSurface(sid) ? ok(req.id, {}) : err(req.id, 'not_found', 'surface not found')
      }

      case 'status.update': {
        const surfaceId = p.surface_id as string
        const status = p.status as string
        const eventName = (p.event_name as string) || ''
        if (!surfaceId) return err(req.id, 'invalid_params', 'surface_id required')
        if (!status) return err(req.id, 'invalid_params', 'status required')
        if (this.onStatusUpdate) {
          this.onStatusUpdate(surfaceId, {
            status,
            eventName,
            notificationType: (p.notification_type as string) || '',
            toolName: (p.tool_name as string) || '',
            sessionSource: (p.session_source as string) || '',
            subagentType: (p.subagent_type as string) || '',
          })
        }
        return ok(req.id, {})
      }

      default:
        return err(req.id, 'method_not_found', `unknown method "${req.method}"`)
    }
  }
}
