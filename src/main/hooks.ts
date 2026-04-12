// claude code hook integration
// writes a tiny node script to ~/.takoyaki/bin/takoyaki-notify.js
// adds takoyaki-owned hooks to claude code user settings

import { spawn, spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { MANAGED_CLAUDE_HOOK_EVENTS, type ManagedClaudeHookEvent } from '../shared/claude-status'

const TAKOYAKI_DIR = path.join(os.homedir(), '.takoyaki')
const HOOKS_STATE_FILE = path.join(TAKOYAKI_DIR, 'hooks-setup.json')
const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json')
const NOTIFY_SCRIPT = path.join(TAKOYAKI_DIR, 'bin', 'takoyaki-notify.js')
const SOCKET_ADDR_FILE = path.join(TAKOYAKI_DIR, 'socket_addr')
const REQUIRED_HOOK_EVENTS = MANAGED_CLAUDE_HOOK_EVENTS
type RequiredHookEvent = ManagedClaudeHookEvent
type HookCommandState = 'current' | 'missing' | 'invalid'
type JsonObject = Record<string, unknown>

export interface ClaudeHookCommand {
  type?: string
  command?: string
  timeout?: number
  [key: string]: unknown
}

export interface ClaudeHookMatcher {
  matcher?: string
  hooks?: ClaudeHookCommand[]
  [key: string]: unknown
}

export interface ClaudeSettings {
  hooks?: Partial<Record<RequiredHookEvent, ClaudeHookMatcher[]>> & Record<string, unknown>
  enabledPlugins?: Record<string, unknown>
  [key: string]: unknown
}

interface HooksState {
  dismissed?: boolean
  installed?: boolean
  lastInstalledAt?: number
}

export interface HookDiagnostics {
  settingsPath: string
  notifyScriptPath: string
  socketAddrPath: string
  settingsExists: boolean
  notifyScriptExists: boolean
  installedHooks: Record<RequiredHookEvent, boolean>
  hookStates: Record<RequiredHookEvent, HookCommandState>
  socketAddress: string | null
  nodeExecutable: string | null
  restartRequired: boolean
  externalNote?: string
  lastInstalledAt?: number | null
  health: 'connected' | 'degraded' | 'missing'
  detail: string
}

export interface HookTestResult {
  ok: boolean
  detail: string
}

let cachedNodeExecutable: string | null | undefined

const NOTIFY_SCRIPT_CONTENT = `const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

const EVENT_TO_STATUS = {
  SessionStart: 'running',
  UserPromptSubmit: 'running',
  PermissionRequest: 'running',
  Notification: 'running',
  SubagentStart: 'running',
  SubagentStop: 'running',
  Stop: 'finished',
  StopFailure: 'failed'
}

const isTest = process.env.TAKOYAKI_HOOK_TEST === '1'
let settled = false

function finish(message) {
  if (settled) return
  settled = true
  if (isTest && message) process.stdout.write(message + '\\n')
  process.exit(0)
}

function fail(message) {
  if (settled) return
  settled = true
  if (isTest && message) process.stderr.write(message + '\\n')
  process.exit(isTest ? 1 : 0)
}

function readArg(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] || '' : ''
}

function firstString(input, keys) {
  if (!input || typeof input !== 'object') return ''
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function firstNestedString(input, keyGroups) {
  if (!input || typeof input !== 'object') return ''
  for (const keys of keyGroups) {
    let current = input
    let valid = true
    for (const key of keys.slice(0, -1)) {
      if (!current || typeof current !== 'object') {
        valid = false
        break
      }
      current = current[key]
    }
    if (!valid || !current || typeof current !== 'object') continue
    const finalKey = keys[keys.length - 1]
    const value = current[finalKey]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function readStdinJson() {
  if (process.stdin.isTTY) return Promise.resolve(null)
  return new Promise((resolve) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      raw += chunk
    })
    process.stdin.on('end', () => {
      const trimmed = raw.trim()
      if (!trimmed) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(trimmed))
      } catch {
        resolve(null)
      }
    })
    process.stdin.on('error', () => resolve(null))
  })
}

async function main() {
  setTimeout(() => fail('timed out waiting for takoyaki hook delivery'), isTest ? 4000 : 3000)

  const payload = await readStdinJson()
  const eventName = readArg('--event') ||
    firstString(payload, ['hookEventName', 'hook_event_name', 'eventName', 'event_name'])
  const surfaceId = readArg('--surface-id') ||
    process.env.TAKOYAKI_SURFACE_ID ||
    firstString(payload, ['surfaceId', 'surface_id'])
  const status = EVENT_TO_STATUS[eventName] ||
    firstString(payload, ['status']) ||
    'finished'
  const normalizedEventName = eventName || ''
  const notificationType = firstString(payload, ['notification_type', 'notificationType'])
  const toolName = firstString(payload, ['tool_name', 'toolName']) ||
    firstNestedString(payload, [['tool_input', 'tool_name'], ['toolInput', 'toolName']])
  const sessionSource = firstString(payload, ['source', 'session_source', 'sessionSource'])
  const subagentType = firstString(payload, ['agent_type', 'agentType'])

  try {
    const addrFile = path.join(os.homedir(), '.takoyaki', 'socket_addr')
    if (!fs.existsSync(addrFile)) fail('takoyaki socket_addr not found')

    const addr = fs.readFileSync(addrFile, 'utf-8').trim()
    const [host, port] = addr.split(':')
    if (!host || !port) fail('takoyaki socket address is invalid')

    const params = { status }
    if (surfaceId) params.surface_id = surfaceId
    if (normalizedEventName) params.event_name = normalizedEventName
    if (notificationType) params.notification_type = notificationType
    if (toolName) params.tool_name = toolName
    if (sessionSource) params.session_source = sessionSource
    if (subagentType) params.subagent_type = subagentType

    const msg = JSON.stringify({ id: 1, method: 'status.update', params })
    const client = net.createConnection({ host, port: parseInt(port, 10) }, () => {
      client.write(msg + '\\n')
    })

    client.on('data', () => finish('status.update acknowledged'))
    client.on('end', () => finish('status.update sent'))
    client.on('error', (error) => fail(error.message))
  } catch (error) {
    fail(error && error.message ? error.message : 'unexpected hook failure')
  }
}

main().catch((error) => fail(error && error.message ? error.message : 'unexpected hook failure'))
`

// make sure the generated notify bridge script exists before any diagnostics or installs run
export function initializeHooks(): void {
  ensureNotifyScript()
}

// rewrite the notify script so claude always calls the current takoyaki bridge
function ensureNotifyScript(): void {
  const binDir = path.join(TAKOYAKI_DIR, 'bin')
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(NOTIFY_SCRIPT, NOTIFY_SCRIPT_CONTENT, 'utf-8')
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asHookMatchers(value: unknown): ClaudeHookMatcher[] {
  return Array.isArray(value) ? (value.filter(isJsonObject) as ClaudeHookMatcher[]) : []
}

// show the setup banner only when claude exists but takoyaki managed hooks are still missing
export function shouldShowHooksBanner(): boolean {
  initializeHooks()

  if (isHooksConfigured()) return false

  const state = readHooksState()
  if (state.dismissed) return false
  if (!fs.existsSync(CLAUDE_SETTINGS)) return false

  return true
}

// verify that every managed hook event points at the current takoyaki notify command
export function isHooksConfigured(): boolean {
  try {
    const settings = readClaudeSettings()
    const installedHooks = getInstalledHooks(getHookCommandStates(settings))
    return REQUIRED_HOOK_EVENTS.every((eventName) => installedHooks[eventName])
  } catch {
    return false
  }
}

// remove old takoyaki hook entries before rewriting the current managed command set
function removeManagedHookEntries(hookArray: ClaudeHookMatcher[]): ClaudeHookMatcher[] {
  return hookArray.filter((entry) => {
    const serialized = JSON.stringify(entry)
    return !serialized.includes('takoyaki-notify')
  })
}

// install or repair the managed hook commands inside claude's settings file
export function installHooks(): boolean {
  try {
    initializeHooks()
    const settings = readClaudeSettings()
    const settingsDir = path.dirname(CLAUDE_SETTINGS)
    const hookCommand = (eventName: RequiredHookEvent) => buildHookCommand(eventName)

    if (!settings.hooks) settings.hooks = {}
    if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true })

    for (const eventName of REQUIRED_HOOK_EVENTS) {
      const existing = Array.isArray(settings.hooks[eventName]) ? settings.hooks[eventName] : []
      settings.hooks[eventName] = removeManagedHookEntries(existing)
      settings.hooks[eventName].push({
        matcher: '.*',
        hooks: [
          {
            type: 'command',
            command: hookCommand(eventName),
            timeout: 5000,
          },
        ],
      })
    }

    fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2), 'utf-8')
    saveState({ dismissed: false, installed: true, lastInstalledAt: Date.now() })
    return true
  } catch {
    return false
  }
}

// remember that the user dismissed the banner without a valid install
export function dismissHooksBanner(): void {
  saveState({ ...readHooksState(), dismissed: true, installed: false })
}

// describe hook health in one payload for the settings panel
export function getHookDiagnostics(): HookDiagnostics {
  initializeHooks()

  const settingsExists = fs.existsSync(CLAUDE_SETTINGS)
  const notifyScriptExists = fs.existsSync(NOTIFY_SCRIPT)
  const socketAddress = readSocketAddress()
  const nodeExecutable = resolveNodeExecutable()
  const hooksState = readHooksState()
  const base = {
    settingsPath: CLAUDE_SETTINGS,
    notifyScriptPath: NOTIFY_SCRIPT,
    socketAddrPath: SOCKET_ADDR_FILE,
    settingsExists,
    notifyScriptExists,
    socketAddress,
    nodeExecutable,
    restartRequired: false,
    lastInstalledAt: hooksState.lastInstalledAt || null,
  }

  if (!settingsExists) {
    return {
      ...base,
      installedHooks: emptyInstalledHooks(),
      hookStates: emptyHookStates(),
      health: 'missing',
      detail: 'Claude settings.json was not found',
    }
  }

  try {
    const settings = readClaudeSettings()
    const hookStates = getHookCommandStates(settings)
    const installedHooks = getInstalledHooks(hookStates)
    const missingHooks = REQUIRED_HOOK_EVENTS.filter((eventName) => hookStates[eventName] === 'missing')
    const invalidHooks = REQUIRED_HOOK_EVENTS.filter((eventName) => hookStates[eventName] === 'invalid')
    const externalNote = settings?.enabledPlugins?.['superpowers@claude-plugins-official']
      ? 'SessionStart hook errors are likely coming from a Claude plugin, not Takoyaki.'
      : undefined

    if (invalidHooks.length > 0) {
      return {
        ...base,
        installedHooks,
        hookStates,
        externalNote,
        health: 'degraded',
        detail: `Malformed Takoyaki hook commands detected for ${invalidHooks.join(', ')}`,
      }
    }

    if (missingHooks.length > 0) {
      return {
        ...base,
        installedHooks,
        hookStates,
        externalNote,
        health: 'missing',
        detail: `Missing Takoyaki hooks for ${missingHooks.join(', ')}`,
      }
    }

    if (!notifyScriptExists) {
      return {
        ...base,
        installedHooks,
        hookStates,
        externalNote,
        health: 'degraded',
        detail: 'Takoyaki notify script is missing',
      }
    }

    if (!socketAddress) {
      return {
        ...base,
        installedHooks,
        hookStates,
        externalNote,
        health: 'degraded',
        detail: 'Takoyaki is not currently exposing a socket address',
      }
    }

    if (!nodeExecutable) {
      return {
        ...base,
        installedHooks,
        hookStates,
        externalNote,
        health: 'degraded',
        detail: 'Node executable could not be resolved; hooks may rely on bare node',
      }
    }

    return {
      ...base,
      installedHooks,
      hookStates,
      externalNote,
      health: 'connected',
      detail: 'Hooks are installed and the Takoyaki socket is available',
    }
  } catch {
    return {
      ...base,
      installedHooks: emptyInstalledHooks(),
      hookStates: emptyHookStates(),
      health: 'degraded',
      detail: 'Claude settings.json could not be parsed',
    }
  }
}

// run the generated notify script end to end and wait for the socket roundtrip result
export function testHooks(surfaceId: string, eventName: RequiredHookEvent = 'Stop'): Promise<HookTestResult> {
  initializeHooks()

  if (!surfaceId) {
    return Promise.resolve({ ok: false, detail: 'No focused surface is available for hook testing' })
  }

  const runner = resolveNodeExecutable() || 'node'

  return new Promise((resolve) => {
    const child = spawn(runner, [NOTIFY_SCRIPT, '--event', eventName], {
      env: { ...process.env, TAKOYAKI_SURFACE_ID: surfaceId, TAKOYAKI_HOOK_TEST: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, detail: 'Hook test timed out' })
    }, 5000)

    child.stdin.end(JSON.stringify({ hook_event_name: eventName }))

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, detail: error.message })
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ ok: true, detail: stdout.trim() || 'Hook script exited successfully' })
        return
      }
      resolve({ ok: false, detail: stderr.trim() || `Hook script exited with code ${code}` })
    })
  })
}

// persist the small local setup state used by the banner and diagnostics
function saveState(state: HooksState): void {
  try {
    if (!fs.existsSync(TAKOYAKI_DIR)) fs.mkdirSync(TAKOYAKI_DIR, { recursive: true })
    fs.writeFileSync(HOOKS_STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
  } catch {
    // state persistence failed, non-fatal
  }
}

// read the local setup state without letting parse failures break settings ui
function readHooksState(): HooksState {
  try {
    if (!fs.existsSync(HOOKS_STATE_FILE)) return {}
    return JSON.parse(fs.readFileSync(HOOKS_STATE_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

// build an all false installed map for diagnostics fallback cases
function emptyInstalledHooks(): Record<RequiredHookEvent, boolean> {
  return Object.fromEntries(REQUIRED_HOOK_EVENTS.map((eventName) => [eventName, false])) as Record<
    RequiredHookEvent,
    boolean
  >
}

// build an all missing hook state map for diagnostics fallback cases
function emptyHookStates(): Record<RequiredHookEvent, HookCommandState> {
  return Object.fromEntries(REQUIRED_HOOK_EVENTS.map((eventName) => [eventName, 'missing'])) as Record<
    RequiredHookEvent,
    HookCommandState
  >
}

// read claude settings defensively because the file can be absent or user edited
function readClaudeSettings(): ClaudeSettings {
  if (!fs.existsSync(CLAUDE_SETTINGS)) return {}
  const parsed: unknown = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf-8'))
  return isJsonObject(parsed) ? (parsed as ClaudeSettings) : {}
}

// reduce hook command states into a simple installed boolean map for the ui
function getInstalledHooks(states: Record<RequiredHookEvent, HookCommandState>): Record<RequiredHookEvent, boolean> {
  return Object.fromEntries(
    REQUIRED_HOOK_EVENTS.map((eventName) => [eventName, states[eventName] === 'current']),
  ) as Record<RequiredHookEvent, boolean>
}

// inspect every managed hook slot and label it current missing or invalid
function getHookCommandStates(settings: ClaudeSettings): Record<RequiredHookEvent, HookCommandState> {
  const hooks = isJsonObject(settings.hooks) ? settings.hooks : {}
  return Object.fromEntries(
    REQUIRED_HOOK_EVENTS.map((eventName) => [
      eventName,
      getHookCommandState(asHookMatchers(hooks[eventName]), eventName),
    ]),
  ) as Record<RequiredHookEvent, HookCommandState>
}

// decide whether the commands for one hook event are missing current or stale
function getHookCommandState(entries: ClaudeHookMatcher[], eventName: RequiredHookEvent): HookCommandState {
  const commands = extractHookCommands(entries).filter((command) => isManagedHookCommand(command, eventName))

  if (commands.length === 0) return 'missing'

  const currentCount = commands.filter((command) => isCurrentHookCommand(command, eventName)).length

  if (currentCount === commands.length) return 'current'
  return 'invalid'
}

// flatten command-type hook entries so command matching stays simple
function extractHookCommands(entries: ClaudeHookMatcher[]): string[] {
  const commands: string[] = []
  for (const entry of entries) {
    const hooks = Array.isArray(entry.hooks) ? entry.hooks : []
    for (const hook of hooks) {
      if (hook.type === 'command' && typeof hook.command === 'string') {
        commands.push(hook.command)
      }
    }
  }
  return commands
}

// normalize path separators before comparing shell commands across platforms
function normalizeCommand(command: string): string {
  return command.replace(/\\/g, '/').trim()
}

// recognize any takoyaki-owned command for one event even if it is stale
function isManagedHookCommand(command: string, eventName: RequiredHookEvent): boolean {
  const normalized = normalizeCommand(command)
  return normalized.includes(`--event ${eventName}`) && normalized.includes('takoyaki-notify.js')
}

// match only the exact command string takoyaki currently wants to install
function isCurrentHookCommand(command: string, eventName: RequiredHookEvent): boolean {
  const normalized = normalizeCommand(command)
  return normalized.includes(normalizeCommand(NOTIFY_SCRIPT)) && normalized.includes(`--event ${eventName}`)
}

// read the current socket address if takoyaki has already started its rpc server
function readSocketAddress(): string | null {
  try {
    if (!fs.existsSync(SOCKET_ADDR_FILE)) return null
    const value = fs.readFileSync(SOCKET_ADDR_FILE, 'utf-8').trim()
    return value || null
  } catch {
    return null
  }
}

// build the shell command claude should run for one hook event
function buildHookCommand(eventName: RequiredHookEvent): string {
  const runner = resolveNodeExecutable()
  const notifyPath = process.platform === 'win32' ? NOTIFY_SCRIPT.replace(/\\/g, '/') : NOTIFY_SCRIPT
  return `${quoteCommandSegment(runner || 'node')} ${quoteCommandSegment(notifyPath)} --event ${eventName}`
}

// quote command segments so the generated hook survives paths with spaces
function quoteCommandSegment(value: string): string {
  if (!/[\s"]/u.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

// resolve a stable node executable path for generated hook commands and tests
function resolveNodeExecutable(): string | null {
  if (cachedNodeExecutable !== undefined) return cachedNodeExecutable

  const lookup =
    process.platform === 'win32' ? { command: 'where.exe', args: ['node'] } : { command: 'which', args: ['node'] }

  try {
    const result = spawnSync(lookup.command, lookup.args, { encoding: 'utf-8' })
    if (result.status === 0) {
      const firstLine = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      if (firstLine) {
        cachedNodeExecutable = firstLine
        return cachedNodeExecutable
      }
    }
  } catch {
    // node lookup failed, non-fatal
  }

  const execBase = path.basename(process.execPath).toLowerCase()
  if (execBase === 'node' || execBase === 'node.exe') {
    cachedNodeExecutable = process.execPath
    return cachedNodeExecutable
  }

  cachedNodeExecutable = null
  return cachedNodeExecutable
}
