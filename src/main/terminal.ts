// manages terminal processes using node-pty for proper pty support
// this gives us real interactive shells with cursor movement, colors, etc.

import { SerializeAddon } from '@xterm/addon-serialize'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import * as pty from 'node-pty'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { existsSync, statSync } from 'fs'
import { getTerminalRuntimeInfo } from './terminal-runtime'

const CWD_MARKER_PREFIX = '\x1b]633;takoyaki-cwd='
const CWD_MARKER_SUFFIX = '\x07'
const POWERSHELL_BOOTSTRAP = [
  '$global:__takoyaki_original_prompt = ${function:prompt}',
  'function global:__takoyaki_emit_cwd {',
  '  try {',
  '    $encoded = [Uri]::EscapeDataString((Get-Location).Path)',
  `    [Console]::Out.Write("${CWD_MARKER_PREFIX}$encoded${CWD_MARKER_SUFFIX}")`,
  '  } catch {}',
  '}',
  'function global:prompt {',
  '  __takoyaki_emit_cwd',
  '  if ($global:__takoyaki_original_prompt) {',
  '    & $global:__takoyaki_original_prompt',
  '  } else {',
  '    "PS $(Get-Location)> "',
  '  }',
  '}',
  '__takoyaki_emit_cwd',
].join('\n')

export interface TerminalInfo {
  id: string
  pid: number
  cwd: string
}

export type TerminalSessionStatus = 'running' | 'exited' | 'error'

export interface TerminalSnapshot {
  terminalId: string
  cwd: string
  cols: number
  rows: number
  status: TerminalSessionStatus
  pid: number | null
  serializedState: string
  history: string
  exitCode: number | null
  exitSignal: number | null
  lastEventId: number
  updatedAt: string
}

export interface TerminalPromptEvent {
  terminalId: string
  cwd: string
}

export type TerminalEvent =
  | {
      terminalId: string
      eventId: number
      createdAt: string
      type: 'started'
      snapshot: TerminalSnapshot
    }
  | {
      terminalId: string
      eventId: number
      createdAt: string
      type: 'output'
      data: string
    }
  | {
      terminalId: string
      eventId: number
      createdAt: string
      type: 'exited'
      exitCode: number | null
      exitSignal: number | null
    }
  | {
      terminalId: string
      eventId: number
      createdAt: string
      type: 'error'
      message: string
    }

interface TerminalSession {
  info: TerminalInfo
  process: pty.IPty | null
  emulator: HeadlessTerminal
  serializer: SerializeAddon
  cols: number
  rows: number
  status: TerminalSessionStatus
  historyChunks: string[]
  historyBytes: number
  exitCode: number | null
  exitSignal: number | null
  lastEventId: number
  updatedAt: string
  metadataBuffer: string
  pendingActions: PendingTerminalAction[]
  isDraining: boolean
}

type PendingTerminalAction =
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number | null; exitSignal: number | null }
  | { type: 'resize'; cols: number; rows: number }

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 30
const MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024
const TERMINAL_SCROLLBACK = 5000
const terminalRuntimeInfo = getTerminalRuntimeInfo()

export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>()

  create(cwd?: string, surfaceId?: string): TerminalInfo {
    const id = randomUUID()
    const workingDir = cwd || homedir()
    const isWindows = process.platform === 'win32'
    const shell = isWindows ? 'powershell.exe' : process.env.SHELL || 'bash'
    const shellArgs = isWindows ? ['-NoLogo', '-NoExit', '-Command', POWERSHELL_BOOTSTRAP] : []

    const proc = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: workingDir,
      env: { ...process.env, TAKOYAKI_SURFACE_ID: surfaceId || id } as Record<string, string>,
      useConpty: true,
    })

    const termInfo: TerminalInfo = { id, pid: proc.pid, cwd: workingDir }
    const emulator = new HeadlessTerminal({
      allowProposedApi: true,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      scrollback: TERMINAL_SCROLLBACK,
      windowsPty: terminalRuntimeInfo.windowsPty || undefined,
    })
    const serializer = new SerializeAddon()
    emulator.loadAddon(serializer)
    const session: TerminalSession = {
      info: termInfo,
      process: proc,
      emulator,
      serializer,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      status: 'running',
      historyChunks: [],
      historyBytes: 0,
      exitCode: null,
      exitSignal: null,
      lastEventId: 0,
      updatedAt: new Date().toISOString(),
      metadataBuffer: '',
      pendingActions: [],
      isDraining: false,
    }

    this.sessions.set(id, session)
    this.emitEvent(session, {
      type: 'started',
    })

    proc.onData((data: string) => {
      if (!this.sessions.has(id)) return
      this.enqueueSessionAction(session, { type: 'output', data })
    })

    proc.onExit(({ exitCode, signal }) => {
      if (!this.sessions.has(id)) return
      this.enqueueSessionAction(session, {
        type: 'exit',
        exitCode: exitCode ?? null,
        exitSignal: signal ?? null,
      })
    })

    return termInfo
  }

  open(id: string): TerminalSnapshot | null {
    const session = this.sessions.get(id)
    return session ? this.snapshotOf(session) : null
  }

  write(id: string, data: string): boolean {
    const proc = this.sessions.get(id)?.process
    if (!proc) return false
    proc.write(data)
    return true
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.enqueueSessionAction(session, { type: 'resize', cols, rows })
  }

  destroy(id: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    if (session.process) session.process.kill()
    session.emulator.dispose()
    this.sessions.delete(id)
    return true
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroy(id)
    }
  }

  get(id: string): TerminalInfo | undefined {
    return this.sessions.get(id)?.info
  }

  list(): TerminalInfo[] {
    return Array.from(this.sessions.values()).map((session) => session.info)
  }

  count(): number {
    return this.sessions.size
  }

  getCwd(id: string): string {
    return this.sessions.get(id)?.info.cwd || homedir()
  }

  private snapshotOf(session: TerminalSession): TerminalSnapshot {
    return {
      terminalId: session.info.id,
      cwd: session.info.cwd,
      cols: session.cols,
      rows: session.rows,
      status: session.status,
      pid: session.process?.pid || null,
      serializedState: session.serializer.serialize(),
      history: session.historyChunks.join(''),
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
      lastEventId: session.lastEventId,
      updatedAt: session.updatedAt,
    }
  }

  private appendHistory(session: TerminalSession, data: string): void {
    const size = Buffer.byteLength(data, 'utf8')
    session.historyChunks.push(data)
    session.historyBytes += size

    while (session.historyBytes > MAX_TRANSCRIPT_BYTES && session.historyChunks.length > 1) {
      const removed = session.historyChunks.shift()
      if (!removed) break
      session.historyBytes -= Buffer.byteLength(removed, 'utf8')
    }
  }

  private enqueueSessionAction(session: TerminalSession, action: PendingTerminalAction): void {
    session.pendingActions.push(action)
    if (session.isDraining) return
    session.isDraining = true
    void this.drainSessionActions(session)
  }

  private async drainSessionActions(session: TerminalSession): Promise<void> {
    while (session.pendingActions.length > 0) {
      const action = session.pendingActions.shift()
      if (!action) continue
      if (!this.sessions.has(session.info.id)) continue

      if (action.type === 'output') {
        session.updatedAt = new Date().toISOString()
        this.appendHistory(session, action.data)
        // track cwd markers without making the renderer the source of truth
        const metadata = this.parseTerminalMetadata(session, session.metadataBuffer + action.data)
        session.metadataBuffer = metadata.remainingBuffer
        await this.writeToEmulator(session.emulator, action.data)
        this.emitEvent(session, {
          type: 'output',
          data: action.data,
        })
        if (metadata.sawPromptMarker) {
          this.emit('prompt', {
            terminalId: session.info.id,
            cwd: session.info.cwd,
          } satisfies TerminalPromptEvent)
        }
        continue
      }

      if (action.type === 'resize') {
        session.cols = action.cols
        session.rows = action.rows
        session.updatedAt = new Date().toISOString()
        if (session.process) session.process.resize(action.cols, action.rows)
        session.emulator.resize(action.cols, action.rows)
        continue
      }

      session.process = null
      session.status = 'exited'
      session.exitCode = action.exitCode
      session.exitSignal = action.exitSignal
      session.updatedAt = new Date().toISOString()
      this.emitEvent(session, {
        type: 'exited',
        exitCode: session.exitCode,
        exitSignal: session.exitSignal,
      })
    }

    session.isDraining = false
    if (session.pendingActions.length > 0) {
      session.isDraining = true
      void this.drainSessionActions(session)
    }
  }

  private writeToEmulator(emulator: HeadlessTerminal, data: string): Promise<void> {
    if (!data) return Promise.resolve()
    return new Promise((resolve) => {
      emulator.write(data, () => resolve())
    })
  }

  private emitEvent(
    session: TerminalSession,
    payload:
      | { type: 'started' }
      | { type: 'output'; data: string }
      | { type: 'exited'; exitCode: number | null; exitSignal: number | null }
      | { type: 'error'; message: string },
  ): void {
    session.lastEventId += 1
    const base = {
      terminalId: session.info.id,
      eventId: session.lastEventId,
      createdAt: new Date().toISOString(),
    }
    if (payload.type === 'started') {
      // the snapshot should reflect the same event boundary the renderer starts from
      this.emit('event', { ...base, type: 'started', snapshot: this.snapshotOf(session) } satisfies TerminalEvent)
      return
    }

    this.emit('event', { ...base, ...payload } satisfies TerminalEvent)
  }

  private parseTerminalMetadata(
    session: TerminalSession,
    data: string,
  ): { remainingBuffer: string; sawPromptMarker: boolean } {
    let lastIndex = 0
    let match: RegExpExecArray | null
    let sawPromptMarker = false

    // eslint-disable-next-line no-control-regex
    const cwdRegex = /\x1b\]633;takoyaki-cwd=([^\x07]*?)\x07/g
    while ((match = cwdRegex.exec(data)) !== null) {
      lastIndex = match.index + match[0].length
      sawPromptMarker = true
      try {
        this.applyTrackedCwd(session, decodeURIComponent(match[1]))
      } catch {
        // parse failed, ignore malformed sequence
      }
    }

    // eslint-disable-next-line no-control-regex
    const oscRegex = /\x1b\]0;([^\x07]*?)\x07/g
    while ((match = oscRegex.exec(data)) !== null) {
      lastIndex = Math.max(lastIndex, match.index + match[0].length)
      const title = match[1]
      const psMatch = title.match(/^PS\s+([A-Za-z]:\\.+)/)
      if (psMatch) this.applyTrackedCwd(session, psMatch[1].trim())
    }

    const lastOsc = data.lastIndexOf('\x1b]')
    if (lastOsc >= lastIndex && !data.substring(lastOsc).includes('\x07')) {
      return { remainingBuffer: data.substring(lastOsc), sawPromptMarker }
    }
    return { remainingBuffer: '', sawPromptMarker }
  }

  private applyTrackedCwd(session: TerminalSession, cwd: string): void {
    try {
      if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) return
      if (session.info.cwd !== cwd) {
        session.info.cwd = cwd
      }
    } catch {
      // cwd validation failed, ignore
    }
  }
}
