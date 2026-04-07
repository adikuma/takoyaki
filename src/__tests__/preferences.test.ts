import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { PreferencesService } from '../main/preferences'

describe('PreferencesService', () => {
  let tempDir: string
  let preferencesPath: string
  let service: PreferencesService

  beforeEach(() => {
    tempDir = path.join(process.cwd(), '.tmp-preferences-test')
    fs.rmSync(tempDir, { recursive: true, force: true })
    fs.mkdirSync(tempDir, { recursive: true })
    preferencesPath = path.join(tempDir, 'preferences.json')
    service = new PreferencesService(preferencesPath)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('reads older preferences files that only stored the default editor', () => {
    fs.writeFileSync(preferencesPath, JSON.stringify({ defaultEditor: 'zed' }, null, 2), 'utf-8')

    expect(service.getDefaultEditor()).toBe('zed')
    expect(service.getPinnedProjectRoots()).toEqual([])
  })

  it('normalizes and dedupes pinned project roots', () => {
    const pinnedProjectRoots = service.setPinnedProjectRoots([
      'C:/Users/Adity/Desktop/project',
      'c:\\users\\adity\\desktop\\project\\',
      'C:/Users/Adity/Desktop/another',
    ])

    expect(pinnedProjectRoots).toEqual(['c:\\users\\adity\\desktop\\project', 'c:\\users\\adity\\desktop\\another'])
    expect(service.getPinnedProjectRoots()).toEqual([
      'c:\\users\\adity\\desktop\\project',
      'c:\\users\\adity\\desktop\\another',
    ])
  })

  it('preserves pinned project roots when the editor preference changes', () => {
    service.setPinnedProjectRoots(['C:/Users/Adity/Desktop/project'])

    service.setDefaultEditor('vscode')

    expect(service.getDefaultEditor()).toBe('vscode')
    expect(service.getPinnedProjectRoots()).toEqual(['c:\\users\\adity\\desktop\\project'])
  })
})
