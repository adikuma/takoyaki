import { execFile, spawn, type SpawnOptions } from 'child_process'
import { shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export type EditorKind = 'cursor' | 'vscode' | 'zed' | 'explorer'
export type EditorLaunchTarget = 'preferred' | EditorKind

export interface EditorAvailability {
  kind: EditorKind
  available: boolean
}

interface EditorPreferences {
  defaultEditor: EditorKind
}

const PREFERENCES_FILE = path.join(os.homedir(), '.mux', 'preferences.json')
const DEFAULT_EDITOR: EditorKind = 'cursor'
const SUCCESS_TIMEOUT_MS = 1_500
const ALL_EDITORS: EditorKind[] = ['cursor', 'vscode', 'zed', 'explorer']
const CODE_EDITORS = ['cursor', 'vscode', 'zed'] as const

const editorCommands: Record<(typeof CODE_EDITORS)[number], string> = {
  cursor: 'cursor',
  vscode: 'code',
  zed: 'zed',
}

function readPreferences(): EditorPreferences {
  try {
    if (!fs.existsSync(PREFERENCES_FILE)) return { defaultEditor: DEFAULT_EDITOR }
    const raw = JSON.parse(fs.readFileSync(PREFERENCES_FILE, 'utf-8')) as Partial<EditorPreferences>
    if (
      raw.defaultEditor === 'cursor' ||
      raw.defaultEditor === 'vscode' ||
      raw.defaultEditor === 'zed' ||
      raw.defaultEditor === 'explorer'
    ) {
      return { defaultEditor: raw.defaultEditor }
    }
  } catch {
    // editor resolution failed, non-fatal
  }
  return { defaultEditor: DEFAULT_EDITOR }
}

function writePreferences(preferences: EditorPreferences): void {
  fs.mkdirSync(path.dirname(PREFERENCES_FILE), { recursive: true })
  fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(preferences, null, 2), 'utf-8')
}

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

function normalizeWindowsLaunchPath(targetPath: string): string {
  if (/^[A-Za-z]:\//.test(targetPath)) {
    return targetPath.replace(/\//g, '\\')
  }
  return targetPath
}

function isWindows(): boolean {
  return process.platform === 'win32'
}

function launchArgs(editor: EditorKind, targetPath: string): string[] {
  return [targetPath]
}

function quoteForPowerShell(arg: string): string {
  return `'${arg.replace(/'/g, "''")}'`
}

function normalizeResolvedExecutable(resolved: string): string {
  if (path.extname(resolved)) return resolved
  const candidates = ['.cmd', '.bat', '.exe'].map((ext) => `${resolved}${ext}`)
  const match = candidates.find((candidate) => fs.existsSync(candidate))
  return match ?? resolved
}

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
  async getPreference(): Promise<EditorKind> {
    return readPreferences().defaultEditor
  }

  async setPreference(editor: EditorKind): Promise<EditorKind> {
    writePreferences({ defaultEditor: editor })
    return editor
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
