import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'

const childState = vi.hoisted(() => ({
  whereResponses: new Map<string, string | null>(),
  spawnCalls: [] as Array<{ command: string; args: string[]; options: unknown }>,
  spawnPlans: [] as Array<{ exitCode?: number | null; error?: string }>,
  shellOpenPathCalls: [] as string[],
  shellOpenPathResult: '',
  home: path.join(process.cwd(), '.tmp-editor-home'),
}))

vi.mock('os', async () => {
  const actual = await vi.importActual<any>('os')
  return { ...actual, homedir: () => childState.home }
})

vi.mock('child_process', () => ({
  execFile: vi.fn(
    (
      command: string,
      args: string[],
      _options: unknown,
      cb: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (command !== 'where') {
        cb(new Error('unsupported command'), '', '')
        return
      }
      const resolved = childState.whereResponses.get(args[0])
      if (!resolved) {
        cb(new Error('missing'), '', '')
        return
      }
      cb(null, `${resolved}\n`, '')
    },
  ),
  spawn: vi.fn((command: string, args: string[], options: unknown) => {
    childState.spawnCalls.push({ command, args, options })
    const emitter = new EventEmitter() as EventEmitter & { unref: () => void }
    emitter.unref = () => {}
    const plan = childState.spawnPlans.shift() || { exitCode: 0 }
    process.nextTick(() => {
      emitter.emit('spawn')
      if (plan.error) {
        emitter.emit('error', new Error(plan.error))
        return
      }
      emitter.emit('exit', plan.exitCode ?? 0)
    })
    return emitter
  }),
}))

vi.mock('electron', () => ({
  shell: {
    openPath: vi.fn(async (targetPath: string) => {
      childState.shellOpenPathCalls.push(targetPath)
      return childState.shellOpenPathResult
    }),
  },
}))

import { EditorService } from '../main/editor'

describe('EditorService', () => {
  let service: EditorService
  const originalPlatform = process.platform
  const samplePath = 'C:/Users/adity/Desktop/coding projects/project'
  const normalizedSamplePath = 'C:\\Users\\adity\\Desktop\\coding projects\\project'

  beforeEach(() => {
    childState.whereResponses.clear()
    childState.spawnCalls = []
    childState.spawnPlans = []
    childState.shellOpenPathCalls = []
    childState.shellOpenPathResult = ''
    fs.rmSync(childState.home, { recursive: true, force: true })
    fs.mkdirSync(childState.home, { recursive: true })
    service = new EditorService()
    Object.defineProperty(process, 'platform', { value: 'win32' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('launches zed with new-window args', async () => {
    childState.whereResponses.set('zed', path.join(childState.home, 'Zed', 'bin', 'zed'))
    childState.spawnPlans.push({ exitCode: 0 })

    const result = await service.openPath(samplePath, 'zed')

    expect(result.ok).toBe(true)
    expect(childState.spawnCalls[0]?.command).toBe('powershell.exe')
    expect(childState.spawnCalls[0]?.args).toEqual([
      '-NoProfile',
      '-Command',
      `& '${path.join(childState.home, 'Zed', 'bin', 'zed.exe')}' '${normalizedSamplePath}'; exit $LASTEXITCODE`,
    ])
  })

  it('uses cursor official cli args without fallback', async () => {
    childState.whereResponses.set('cursor', path.join(childState.home, 'Cursor', 'bin', 'cursor'))
    childState.spawnPlans.push({ exitCode: 0 })

    fs.mkdirSync(path.join(childState.home, 'Cursor', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(childState.home, 'Cursor', 'bin', 'cursor.cmd'), '', 'utf8')

    const result = await service.openPath(samplePath, 'cursor')

    expect(result.ok).toBe(true)
    expect(childState.spawnCalls).toHaveLength(1)
    expect(childState.spawnCalls[0]?.command).toBe('powershell.exe')
    expect(childState.spawnCalls[0]?.args).toEqual([
      '-NoProfile',
      '-Command',
      `& '${path.join(childState.home, 'Cursor', 'bin', 'cursor.cmd')}' '${normalizedSamplePath}'; exit $LASTEXITCODE`,
    ])
  })

  it('uses vscode official cli args without fallback', async () => {
    childState.whereResponses.set('code', path.join(childState.home, 'Code', 'bin', 'code'))
    childState.spawnPlans.push({ exitCode: 0 })

    fs.mkdirSync(path.join(childState.home, 'Code', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(childState.home, 'Code', 'bin', 'code.cmd'), '', 'utf8')

    const result = await service.openPath(samplePath, 'vscode')

    expect(result.ok).toBe(true)
    expect(childState.spawnCalls).toHaveLength(1)
    expect(childState.spawnCalls[0]?.command).toBe('powershell.exe')
    expect(childState.spawnCalls[0]?.args).toEqual([
      '-NoProfile',
      '-Command',
      `& '${path.join(childState.home, 'Code', 'bin', 'code.cmd')}' '${normalizedSamplePath}'; exit $LASTEXITCODE`,
    ])
  })

  it('launches explorer directly for folders', async () => {
    const result = await service.openPath(samplePath, 'explorer')

    expect(result.ok).toBe(true)
    expect(childState.spawnCalls).toHaveLength(0)
    expect(childState.shellOpenPathCalls).toEqual([normalizedSamplePath])
  })

  it('returns an unsupported message outside windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })

    const result = await service.openPath('/home/adity/project', 'zed')

    expect(result).toEqual({
      ok: false,
      detail: 'Editor open is only supported on Windows right now.',
    })
    expect(childState.spawnCalls).toHaveLength(0)
  })
})
