// manages terminal processes using node-pty for proper pty support
// this gives us real interactive shells with cursor movement, colors, etc.

import * as pty from 'node-pty'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { existsSync, statSync } from 'fs'

const CWD_MARKER_PREFIX = '\x1b]633;mux-cwd='
const CWD_MARKER_SUFFIX = '\x07'
const POWERSHELL_BOOTSTRAP = [
  '$global:__mux_original_prompt = ${function:prompt}',
  'function global:__mux_emit_cwd {',
  '  try {',
  '    $encoded = [Uri]::EscapeDataString((Get-Location).Path)',
  `    [Console]::Out.Write("${CWD_MARKER_PREFIX}$encoded${CWD_MARKER_SUFFIX}")`,
  '  } catch {}',
  '}',
  'function global:prompt {',
  '  __mux_emit_cwd',
  '  if ($global:__mux_original_prompt) {',
  '    & $global:__mux_original_prompt',
  '  } else {',
  '    "PS $(Get-Location)> "',
  '  }',
  '}',
  '__mux_emit_cwd',
].join('\n')

export interface TerminalInfo {
  id: string
  pid: number
  cwd: string
}

export class TerminalManager extends EventEmitter {
  private processes = new Map<string, pty.IPty>()
  private info = new Map<string, TerminalInfo>()

  create(cwd?: string, surfaceId?: string): TerminalInfo {
    const id = randomUUID()
    const workingDir = cwd || homedir()
    const isWindows = process.platform === 'win32'
    const shell = isWindows ? 'powershell.exe' : process.env.SHELL || 'bash'
    const shellArgs = isWindows ? ['-NoLogo', '-NoExit', '-Command', POWERSHELL_BOOTSTRAP] : []

    const proc = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workingDir,
      env: { ...process.env, MUX_SURFACE_ID: surfaceId || id } as Record<string, string>,
      useConpty: true,
    })

    this.processes.set(id, proc)
    const termInfo: TerminalInfo = { id, pid: proc.pid, cwd: workingDir }
    this.info.set(id, termInfo)

    // buffer for incomplete osc sequences that get split across data chunks
    let escapeBuffer = ''

    proc.onData((data: string) => {
      this.emit('data', id, data)
      // track cwd from prompt markers and fallback title escape sequences.
      // conpty may split sequences across multiple data events.
      escapeBuffer = this.parseTerminalMetadata(id, escapeBuffer + data)
    })

    proc.onExit(({ exitCode }) => {
      this.emit('exit', id, exitCode)
      this.processes.delete(id)
      this.info.delete(id)
    })

    return termInfo
  }

  write(id: string, data: string): boolean {
    const proc = this.processes.get(id)
    if (!proc) return false
    proc.write(data)
    return true
  }

  resize(id: string, cols: number, rows: number): void {
    const proc = this.processes.get(id)
    if (proc) proc.resize(cols, rows)
  }

  destroy(id: string): boolean {
    const proc = this.processes.get(id)
    if (!proc) return false
    proc.kill()
    this.processes.delete(id)
    this.info.delete(id)
    return true
  }

  destroyAll(): void {
    for (const [id] of this.processes) {
      this.destroy(id)
    }
  }

  get(id: string): TerminalInfo | undefined {
    return this.info.get(id)
  }

  list(): TerminalInfo[] {
    return Array.from(this.info.values())
  }

  count(): number {
    return this.processes.size
  }

  getCwd(id: string): string {
    const info = this.info.get(id)
    return info?.cwd || homedir()
  }

  private parseTerminalMetadata(id: string, data: string): string {
    let lastIndex = 0
    let match: RegExpExecArray | null

    // eslint-disable-next-line no-control-regex
    const cwdRegex = /\x1b\]633;mux-cwd=([^\x07]*?)\x07/g
    while ((match = cwdRegex.exec(data)) !== null) {
      lastIndex = match.index + match[0].length
      try {
        this.applyTrackedCwd(id, decodeURIComponent(match[1]))
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
      if (psMatch) this.applyTrackedCwd(id, psMatch[1].trim())
    }

    const lastOsc = data.lastIndexOf('\x1b]')
    if (lastOsc >= lastIndex && !data.substring(lastOsc).includes('\x07')) {
      return data.substring(lastOsc)
    }
    return ''
  }

  private applyTrackedCwd(id: string, cwd: string): void {
    try {
      if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) return
      const info = this.info.get(id)
      if (info && info.cwd !== cwd) {
        info.cwd = cwd
        this.emit('cwd', id, cwd)
      }
    } catch {
      // cwd validation failed, ignore
    }
  }
}
