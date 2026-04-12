import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { EditorKind } from './editor'

export interface AppPreferences {
  defaultEditor: EditorKind
  pinnedProjectRoots: string[]
}

const DEFAULT_EDITOR: EditorKind = 'cursor'
const DEFAULT_PREFERENCES: AppPreferences = {
  defaultEditor: DEFAULT_EDITOR,
  pinnedProjectRoots: [],
}

// accepts only the editor kinds the app can actually persist and launch
function isEditorKind(value: unknown): value is EditorKind {
  return value === 'cursor' || value === 'vscode' || value === 'zed' || value === 'explorer'
}

// normalizes project roots so the same project is not pinned twice with different slash styles
export function normalizePinnedProjectRoot(projectRoot: string): string {
  const trimmed = projectRoot.trim()
  if (!trimmed) return ''

  let normalized = path.normalize(trimmed)
  if (normalized.length > 3) {
    normalized = normalized.replace(/[\\/]+$/, '')
  }
  if (/^[A-Za-z]:\\/.test(normalized)) {
    normalized = normalized.toLowerCase()
  }
  return normalized
}

// dedupes and normalizes the stored pin list before it hits disk
function normalizePinnedProjectRoots(projectRoots: readonly string[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const projectRoot of projectRoots) {
    const next = normalizePinnedProjectRoot(projectRoot)
    if (!next || seen.has(next)) continue
    seen.add(next)
    normalized.push(next)
  }

  return normalized
}

export class PreferencesService {
  constructor(private readonly filePath = path.join(os.homedir(), '.takoyaki', 'preferences.json')) {}

  getDefaultEditor(): EditorKind {
    return this.read().defaultEditor
  }

  setDefaultEditor(editor: EditorKind): EditorKind {
    const current = this.read()
    this.write({ ...current, defaultEditor: editor })
    return editor
  }

  getPinnedProjectRoots(): string[] {
    return this.read().pinnedProjectRoots
  }

  setPinnedProjectRoots(projectRoots: string[]): string[] {
    const current = this.read()
    const pinnedProjectRoots = normalizePinnedProjectRoots(projectRoots)
    this.write({ ...current, pinnedProjectRoots })
    return pinnedProjectRoots
  }

  private read(): AppPreferences {
    try {
      if (!fs.existsSync(this.filePath)) return DEFAULT_PREFERENCES
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<AppPreferences>
      return {
        defaultEditor: isEditorKind(raw.defaultEditor) ? raw.defaultEditor : DEFAULT_EDITOR,
        pinnedProjectRoots: Array.isArray(raw.pinnedProjectRoots)
          ? normalizePinnedProjectRoots(
              raw.pinnedProjectRoots.filter((value): value is string => typeof value === 'string'),
            )
          : [],
      }
    } catch {
      return DEFAULT_PREFERENCES
    }
  }

  private write(preferences: AppPreferences): void {
    // keep editor and pin state together in one small user preferences file
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(preferences, null, 2), 'utf-8')
  }
}
