import { execFile, spawn, type SpawnOptions } from 'child_process'
import { shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { PreferencesService } from './preferences'

export type EditorKind = 'cursor' | 'vscode' | 'zed' | 'explorer'
export type EditorLaunchTarget = 'preferred' | EditorKind

export interface EditorAvailability {
  kind: EditorKind
  available: boolean
}

const SUCCESS_TIMEOUT_MS = 1_500
const ALL_EDITORS: EditorKind[] = ['cursor', 'vscode', 'zed', 'explorer']
const CODE_EDITORS = ['cursor', 'vscode', 'zed'] as const

const editorCommands: Record<(typeof CODE_EDITORS)[number], string> = {
  cursor: 'cursor',
  vscode: 'code',
  zed: 'zed',
}

// finds the first executable path for a command on windows
function resolveCommand(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('where', [command], { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      const first =
        stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean) || null
      resolve(first)
    })
  })
}

// converts slash normalized paths into the windows launch form external editors expect
function normalizeWindowsLaunchPath(targetPath: string): string {
  if (/^[A-Za-z]:\//.test(targetPath)) {
    return targetPath.replace(/\//g, '\\')
  }
  return targetPath
}

// keeps editor launching behind the current windows only support boundary
function isWindows(): boolean {
  return process.platform === 'win32'
}

// centralizes launch arguments so editor specific behavior stays easy to extend later
function launchArgs(editor: EditorKind, targetPath: string): string[] {
  return [targetPath]
}

// quotes one powershell argument without losing embedded single quotes
function quoteForPowerShell(arg: string): string {
  return `'${arg.replace(/'/g, "''")}'`
}

// prefers real executable paths when where resolves a command shim without an extension
function normalizeResolvedExecutable(resolved: string): string {
  if (path.extname(resolved)) return resolved
  const candidates = ['.cmd', '.bat', '.exe'].map((ext) => `${resolved}${ext}`)
  const match = candidates.find((candidate) => fs.existsSync(candidate))
  return match ?? resolved
}

// launches editors through powershell so cmd shims work the same as real executables
function buildWindowsShellSpawn(
  command: string,
  args: string[],
): { command: string; args: string[]; options: SpawnOptions; mode: 'shell-shim' | 'direct' } {
  const invocation = `& ${quoteForPowerShell(command)} ${args.map(quoteForPowerShell).join(' ')}; exit $LASTEXITCODE`
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-Command', invocation],
    options: {
      windowsHide: true,
    },
    mode: 'shell-shim',
  }
}

// waits just long enough to treat the editor launch as successful without blocking on the child forever
function spawnAndWait(
  command: string,
  args: string[],
  options: SpawnOptions,
  label: string,
): Promise<{ ok: boolean; detail: string; exitCode?: number }> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, options)
      let settled = false
      let successTimer: NodeJS.Timeout | null = null
      const finish = (result: { ok: boolean; detail: string; exitCode?: number }) => {
        if (settled) return
        settled = true
        if (successTimer) clearTimeout(successTimer)
        resolve(result)
      }
      child.once('error', () => {
        finish({ ok: false, detail: `Unable to open ${label}.` })
      })
      child.once('exit', (code) => {
        if (code && code !== 0) {
          finish({ ok: false, detail: `${label} failed to open.`, exitCode: code })
          return
        }
        finish({ ok: true, detail: `Opened in ${label}.`, exitCode: code ?? 0 })
      })
      child.once('spawn', () => {
        successTimer = setTimeout(() => finish({ ok: true, detail: `Opened in ${label}.` }), SUCCESS_TIMEOUT_MS)
      })
      child.unref()
    } catch {
      resolve({ ok: false, detail: `Unable to open ${label}.` })
    }
  })
}

export class EditorService {
  constructor(private readonly preferences = new PreferencesService()) {}

  async getPreference(): Promise<EditorKind> {
    return this.preferences.getDefaultEditor()
  }

  async setPreference(editor: EditorKind): Promise<EditorKind> {
    return this.preferences.setDefaultEditor(editor)
  }

  async listAvailability(): Promise<EditorAvailability[]> {
    if (!isWindows()) {
      return ALL_EDITORS.map((kind) => ({ kind, available: false }))
    }
    const codeEditors = await Promise.all(
      CODE_EDITORS.map(async (kind) => ({
        kind,
        available: Boolean(await resolveCommand(editorCommands[kind])),
      })),
    )
    return [...codeEditors, { kind: 'explorer', available: true }]
  }

  async openPath(
    targetPath: string,
    launchTarget: EditorLaunchTarget = 'preferred',
  ): Promise<{ ok: boolean; detail: string }> {
    if (!isWindows()) {
      // TODO(mac): add native CLI resolution once editor launch can be tested on macOS
      // TODO(linux): add distro/package-manager aware editor launch once Linux behavior can be tested directly
      return { ok: false, detail: 'Editor open is only supported on Windows right now.' }
    }

    const normalizedTargetPath = normalizeWindowsLaunchPath(targetPath)
    const editor = launchTarget === 'preferred' ? await this.getPreference() : launchTarget
    if (editor === 'explorer') {
      const result = await shell.openPath(normalizedTargetPath)
      return result === ''
        ? { ok: true, detail: 'Opened in File Explorer.' }
        : { ok: false, detail: 'File Explorer failed to open.' }
    }

    const command = editorCommands[editor]
    const resolved = await resolveCommand(command)
    if (!resolved) {
      return { ok: false, detail: `${this.labelFor(editor)} is not installed or not on PATH.` }
    }
    const executable = normalizeResolvedExecutable(resolved)

    const launch = buildWindowsShellSpawn(executable, launchArgs(editor, normalizedTargetPath))
    const primaryResult = await spawnAndWait(launch.command, launch.args, launch.options, this.labelFor(editor))
    return primaryResult
  }

  private labelFor(editor: EditorKind): string {
    if (editor === 'cursor') return 'Cursor'
    if (editor === 'vscode') return 'VS Code'
    if (editor === 'explorer') return 'File Explorer'
    return 'Zed'
  }
}
