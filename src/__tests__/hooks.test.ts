import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const testState = vi.hoisted(() => {
  const path = require('path')
  return {
    home: path.join(process.cwd(), '.tmp-hooks-home'),
    nodePath: process.platform === 'win32' ? 'C:/Program Files/nodejs/node.exe' : '/usr/bin/node',
  }
})

vi.mock('os', async () => {
  const actual = await vi.importActual<any>('os')
  return { ...actual, homedir: () => testState.home }
})

vi.mock('child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: `${testState.nodePath}\n` })),
  spawn: vi.fn(),
}))

import { getHookDiagnostics, initializeHooks, installHooks } from '../main/hooks'

const settingsPath = path.join(testState.home, '.claude', 'settings.json')
const socketAddrPath = path.join(testState.home, '.mux', 'socket_addr')
const currentNotifyPath = path.join(testState.home, '.mux', 'bin', 'mux-notify.js').replace(/\\/g, '/')
const legacyNotifyPath = path.join(testState.home, '.cmux', 'bin', 'cmux-notify.js').replace(/\\/g, '/')

function commandEntry(command: string) {
  return {
    matcher: '.*',
    hooks: [{ type: 'command', command, timeout: 5000 }],
  }
}

function writeSettings(settings: any): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
}

function readSettings(): any {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
}

function legacyCommand(eventName: string): string {
  return `${testState.nodePath} ${legacyNotifyPath} --event ${eventName}`
}

describe('hooks', () => {
  beforeEach(() => {
    fs.rmSync(testState.home, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    fs.rmSync(testState.home, { recursive: true, force: true })
  })

  it('reports legacy .cmux hook installs as degraded', () => {
    writeSettings({
      hooks: {
        Stop: [commandEntry(legacyCommand('Stop'))],
        StopFailure: [commandEntry(legacyCommand('StopFailure'))],
        UserPromptSubmit: [commandEntry(legacyCommand('UserPromptSubmit'))],
      },
    })

    const diagnostics = getHookDiagnostics()

    expect(diagnostics.health).toBe('degraded')
    expect(diagnostics.hookStates.Stop).toBe('legacy')
    expect(diagnostics.hookStates.StopFailure).toBe('legacy')
    expect(diagnostics.hookStates.UserPromptSubmit).toBe('legacy')
    expect(diagnostics.detail).toContain('Legacy .cmux hook install detected')
    expect(diagnostics.installedHooks.Stop).toBe(false)
  })

  it('rewrites legacy installs to .mux and preserves unrelated hooks', () => {
    writeSettings({
      hooks: {
        Stop: [commandEntry(legacyCommand('Stop')), commandEntry('bark notify --title Claude')],
        StopFailure: [commandEntry(legacyCommand('StopFailure'))],
        UserPromptSubmit: [commandEntry(legacyCommand('UserPromptSubmit'))],
      },
    })

    expect(installHooks()).toBe(true)

    const settings = readSettings()
    const serialized = JSON.stringify(settings)
    expect(serialized).toContain('.mux/bin/mux-notify.js')
    expect(serialized).not.toContain('.cmux/bin/cmux-notify.js')
    expect(settings.hooks.Stop.some((entry: any) => JSON.stringify(entry).includes('bark notify'))).toBe(true)

    const diagnostics = getHookDiagnostics()
    expect(diagnostics.hookStates.Stop).toBe('current')
    expect(diagnostics.hookStates.StopFailure).toBe('current')
    expect(diagnostics.hookStates.UserPromptSubmit).toBe('current')
  })

  it('reports current .mux installs as connected when the socket is available', () => {
    writeSettings({ hooks: {} })
    initializeHooks()
    expect(installHooks()).toBe(true)
    fs.mkdirSync(path.dirname(socketAddrPath), { recursive: true })
    fs.writeFileSync(socketAddrPath, '127.0.0.1:4222', 'utf-8')

    const diagnostics = getHookDiagnostics()

    expect(diagnostics.health).toBe('connected')
    expect(diagnostics.notifyScriptPath.replace(/\\/g, '/')).toBe(currentNotifyPath)
    expect(diagnostics.installedHooks.Stop).toBe(true)
    expect(diagnostics.installedHooks.StopFailure).toBe(true)
    expect(diagnostics.installedHooks.UserPromptSubmit).toBe(true)
  })

  it('marks malformed managed commands as degraded', () => {
    writeSettings({
      hooks: {
        Stop: [commandEntry(`${testState.nodePath} /tmp/mux-notify.js --event Stop`)],
        StopFailure: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event StopFailure`)],
        UserPromptSubmit: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event UserPromptSubmit`)],
      },
    })

    const diagnostics = getHookDiagnostics()

    expect(diagnostics.health).toBe('degraded')
    expect(diagnostics.hookStates.Stop).toBe('invalid')
    expect(diagnostics.detail).toContain('Malformed mux hook commands detected')
  })
})
