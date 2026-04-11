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
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => testState.home }
})

vi.mock('child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: `${testState.nodePath}\n` })),
  spawn: vi.fn(),
}))

import {
  getHookDiagnostics,
  initializeHooks,
  installHooks,
  type ClaudeHookMatcher,
  type ClaudeSettings,
} from '../main/hooks'
import { MANAGED_CLAUDE_HOOK_EVENTS, type ManagedClaudeHookEvent } from '../shared/claude-status'

const settingsPath = path.join(testState.home, '.claude', 'settings.json')
const socketAddrPath = path.join(testState.home, '.takoyaki', 'socket_addr')
const currentNotifyPath = path.join(testState.home, '.takoyaki', 'bin', 'takoyaki-notify.js').replace(/\\/g, '/')

function commandEntry(command: string): ClaudeHookMatcher {
  return {
    matcher: '.*',
    hooks: [{ type: 'command', command, timeout: 5000 }],
  }
}

function writeSettings(settings: ClaudeSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
}

function readSettings(): ClaudeSettings {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as ClaudeSettings
}

function getHookEntries(settings: ClaudeSettings, eventName: ManagedClaudeHookEvent): ClaudeHookMatcher[] {
  const entries = settings.hooks?.[eventName]
  return Array.isArray(entries) ? (entries as ClaudeHookMatcher[]) : []
}

describe('hooks', () => {
  beforeEach(() => {
    fs.rmSync(testState.home, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  afterEach(() => {
    fs.rmSync(testState.home, { recursive: true, force: true })
  })

  it('reports missing takoyaki hooks when settings are empty', () => {
    writeSettings({
      hooks: {},
    })

    const diagnostics = getHookDiagnostics()

    expect(diagnostics.health).toBe('missing')
    for (const eventName of MANAGED_CLAUDE_HOOK_EVENTS) {
      expect(diagnostics.hookStates[eventName]).toBe('missing')
    }
    expect(diagnostics.detail).toContain('Missing Takoyaki hooks')
    expect(diagnostics.installedHooks.Stop).toBe(false)
  })

  it('replaces managed takoyaki hook installs and preserves unrelated hooks', () => {
    writeSettings({
      hooks: {
        Stop: [
          commandEntry(`${testState.nodePath} ${currentNotifyPath} --event Stop`),
          commandEntry('bark notify --title Claude'),
        ],
        SessionStart: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event SessionStart`)],
        PermissionRequest: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event PermissionRequest`)],
        Notification: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event Notification`)],
        SubagentStart: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event SubagentStart`)],
        SubagentStop: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event SubagentStop`)],
        StopFailure: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event StopFailure`)],
        UserPromptSubmit: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event UserPromptSubmit`)],
      },
    })

    expect(installHooks()).toBe(true)

    const settings = readSettings()
    const serialized = JSON.stringify(settings)
    expect(serialized).toContain('.takoyaki/bin/takoyaki-notify.js')
    expect(getHookEntries(settings, 'Stop').some((entry) => JSON.stringify(entry).includes('bark notify'))).toBe(true)

    const diagnostics = getHookDiagnostics()
    for (const eventName of MANAGED_CLAUDE_HOOK_EVENTS) {
      expect(diagnostics.hookStates[eventName]).toBe('current')
    }
  })

  it('reports current .takoyaki installs as connected when the socket is available', () => {
    writeSettings({ hooks: {} })
    initializeHooks()
    expect(installHooks()).toBe(true)
    fs.mkdirSync(path.dirname(socketAddrPath), { recursive: true })
    fs.writeFileSync(socketAddrPath, '127.0.0.1:4222', 'utf-8')

    const diagnostics = getHookDiagnostics()

    expect(diagnostics.health).toBe('connected')
    expect(diagnostics.notifyScriptPath.replace(/\\/g, '/')).toBe(currentNotifyPath)
    for (const eventName of MANAGED_CLAUDE_HOOK_EVENTS) {
      expect(diagnostics.installedHooks[eventName]).toBe(true)
    }
  })

  it('marks malformed managed commands as degraded', () => {
    writeSettings({
      hooks: {
        Stop: [commandEntry(`${testState.nodePath} /tmp/takoyaki-notify.js --event Stop`)],
        SessionStart: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event SessionStart`)],
        PermissionRequest: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event PermissionRequest`)],
        Notification: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event Notification`)],
        SubagentStart: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event SubagentStart`)],
        SubagentStop: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event SubagentStop`)],
        StopFailure: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event StopFailure`)],
        UserPromptSubmit: [commandEntry(`${testState.nodePath} ${currentNotifyPath} --event UserPromptSubmit`)],
      },
    })

    const diagnostics = getHookDiagnostics()

    expect(diagnostics.health).toBe('degraded')
    expect(diagnostics.hookStates.Stop).toBe('invalid')
    expect(diagnostics.detail).toContain('Malformed Takoyaki hook commands detected')
  })
})
