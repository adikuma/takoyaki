import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, FolderOpen, X } from 'lucide-react'
import { colors, button, fonts, sizes } from './design'
import { useStore } from './store'
import type { EditorKind, HookDiagnostics } from './types'
import { shortcutDisplayRows } from '../shared/shortcuts'
import { MANAGED_CLAUDE_HOOK_EVENTS } from '../shared/claude-status'
import claudeLogo from './assets/providers/claude.svg?raw'
import cursorLogo from './assets/providers/cursor.svg?raw'
import vscodeLogo from './assets/providers/vscode.svg?raw'
import zedLogo from './assets/providers/zed.svg?raw'

interface Props {
  open: boolean
  onClose: () => void
}

// renders an editor logo svg inline using the shared base icon size
function ProviderIcon({ svg, color = colors.textSecondary }: { svg: string; color?: string }) {
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{ color, width: sizes.iconBase, height: sizes.iconBase }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

// file explorer uses a lucide icon instead of a bundled svg
function ExplorerIcon({ color = colors.textSecondary }: { color?: string }) {
  return <FolderOpen size={sizes.iconBase} strokeWidth={1.9} color={color} />
}

function Checkmark() {
  return <Check size={sizes.iconSm} strokeWidth={2} color={colors.success} />
}

function MissingMark() {
  return <X size={sizes.iconSm} strokeWidth={2} color={colors.textGhost} />
}

// render the settings drawer and its hook and editor preference controls
export function Settings({ open, onClose }: Props) {
  const [diagnostics, setDiagnostics] = useState<HookDiagnostics | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installResult, setInstallResult] = useState<'installed' | 'failed' | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'passed' | 'failed' | null>(null)
  const [editorSaving, setEditorSaving] = useState<EditorKind | null>(null)
  const [editorDropdownOpen, setEditorDropdownOpen] = useState(false)
  const editorDropdownRef = useRef<HTMLDivElement>(null)
  const defaultEditor = useStore((s) => s.editorPreference)
  const editorAvailability = useStore((s) => s.editorAvailability)
  const loadEditorState = useStore((s) => s.loadEditorState)
  const setEditorPreference = useStore((s) => s.setEditorPreference)
  const startActivityOperation = useStore((s) => s.startActivityOperation)
  const finishActivityOperation = useStore((s) => s.finishActivityOperation)
  const showToast = useStore((s) => s.showToast)

  // fetches hook health info from main process
  const loadDiagnostics = async () => {
    if (!window.takoyaki?.hooks) return
    const next = await window.takoyaki.hooks.diagnostics()
    setDiagnostics(next)
  }

  // refresh hook diagnostics whenever the drawer opens
  useEffect(() => {
    if (open && window.takoyaki?.hooks) {
      loadDiagnostics()
    }
  }, [open])

  // load editor availability and preference only while the drawer is visible
  useEffect(() => {
    if (!open || !window.takoyaki?.editor) return
    void loadEditorState()
  }, [loadEditorState, open])

  // close editor dropdown on click outside or escape
  useEffect(() => {
    if (!editorDropdownOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (editorDropdownRef.current && !editorDropdownRef.current.contains(event.target as Node)) {
        setEditorDropdownOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditorDropdownOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [editorDropdownOpen])

  if (!open) return null

  // writes hook scripts and registers them in claude settings
  const handleInstall = async () => {
    if (!window.takoyaki?.hooks) return
    setInstalling(true)
    setInstallResult(null)
    const operationId = startActivityOperation({
      kind: 'hooks',
      title: 'Installing Claude hooks',
      detail: 'Writing Takoyaki hook commands into Claude settings.',
    })
    try {
      const ok = await window.takoyaki.hooks.install()
      await loadDiagnostics()
      setInstallResult(ok ? 'installed' : 'failed')
      finishActivityOperation(operationId, ok ? 'success' : 'failed', {
        title: ok ? 'Claude hooks installed' : 'Claude hook install failed',
        detail: ok ? 'Claude can now report session status to Takoyaki.' : 'The hook installer returned false.',
      })
      if (!ok) showToast({ message: 'Hook install failed. Open Activity for details.', dot: colors.error }, 4200)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unable to install Claude hooks.'
      setInstallResult('failed')
      finishActivityOperation(operationId, 'failed', { title: 'Claude hook install failed', detail })
      showToast({ message: 'Hook install failed. Open Activity for details.', dot: colors.error }, 4200)
    } finally {
      setInstalling(false)
      setTimeout(() => setInstallResult(null), 2500)
    }
  }

  // runs the hook script and checks if the status update arrives back via socket
  const handleTest = async () => {
    if (!window.takoyaki?.hooks) return
    setTesting(true)
    setTestResult(null)
    const operationId = startActivityOperation({
      kind: 'hooks',
      title: 'Testing Claude hooks',
      detail: 'Waiting for a status event from the hook bridge.',
    })
    try {
      const result = await window.takoyaki.hooks.test()
      await loadDiagnostics()
      setTestResult(result.ok ? 'passed' : 'failed')
      finishActivityOperation(operationId, result.ok ? 'success' : 'failed', {
        title: result.ok ? 'Claude hook test passed' : 'Claude hook test failed',
        detail: result.detail,
      })
      if (!result.ok) showToast({ message: 'Hook test failed. Open Activity for details.', dot: colors.error }, 4200)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unable to test Claude hooks.'
      setTestResult('failed')
      finishActivityOperation(operationId, 'failed', { title: 'Claude hook test failed', detail })
      showToast({ message: 'Hook test failed. Open Activity for details.', dot: colors.error }, 4200)
    } finally {
      setTesting(false)
      setTimeout(() => setTestResult(null), 2500)
    }
  }

  const installedHooks = diagnostics?.installedHooks
  const editorOptions: { kind: EditorKind; label: string; svg: string }[] = [
    { kind: 'cursor', label: 'Cursor', svg: cursorLogo },
    { kind: 'vscode', label: 'VS Code', svg: vscodeLogo },
    { kind: 'zed', label: 'Zed', svg: zedLogo },
    { kind: 'explorer', label: 'File Explorer', svg: '' },
  ]

  // NOTE: claude code has hooks and the others are placeholders for future
  const claudeHooks = installedHooks
    ? MANAGED_CLAUDE_HOOK_EVENTS.map((eventName) => ({
        name: eventName,
        ok: installedHooks[eventName],
      }))
    : null
  const claudeCount = claudeHooks ? claudeHooks.filter((h) => h.ok).length : 0
  const claudeTotal = claudeHooks ? claudeHooks.length : 0

  const sectionBorder = `1px solid ${colors.borderSubtle}`

  return (
    <div className="absolute inset-0 z-50 flex">
      <div className="absolute inset-0" style={{ background: 'var(--takoyaki-backdrop)' }} onClick={onClose} />

      <div
        className="relative ml-auto h-full flex flex-col"
        style={{
          width: 'min(360px, calc(100vw - 24px))',
          background: colors.bg,
          borderLeft: `1px solid ${colors.separator}`,
        }}
      >
        {/* sticky header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: sectionBorder, background: colors.bg, zIndex: 1 }}
        >
          <span className="text-[13px] font-medium" style={{ color: colors.textPrimary }}>
            Settings
          </span>
          <button
            onClick={onClose}
            className="transition-colors duration-[120ms]"
            style={{ color: colors.textGhost }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = colors.textSecondary
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = colors.textGhost
            }}
          >
            <X size={sizes.iconSm} strokeWidth={1.8} />
          </button>
        </div>

        {/* scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4" style={{ borderBottom: sectionBorder }}>
            <span
              className="text-[10px] font-semibold"
              style={{ color: colors.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase' }}
            >
              Default Open
            </span>

            <div className="mt-1 text-[11px]" style={{ color: colors.textGhost }}>
              Choose what the sidebar open action uses by default.
            </div>

            <div ref={editorDropdownRef} className="relative mt-3">
              <button
                type="button"
                onClick={() => setEditorDropdownOpen((v) => !v)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-[120ms]"
                style={{
                  background: colors.bgInput,
                  border: `1px solid ${editorDropdownOpen ? colors.separator : colors.borderSubtle}`,
                }}
              >
                {defaultEditor === 'explorer' ? (
                  <ExplorerIcon />
                ) : (
                  <ProviderIcon svg={editorOptions.find((e) => e.kind === defaultEditor)?.svg || ''} />
                )}
                <span className="flex-1 text-[12px]" style={{ color: colors.textPrimary }}>
                  {editorOptions.find((e) => e.kind === defaultEditor)?.label || defaultEditor}
                </span>
                <ChevronDown
                  size={sizes.iconSm}
                  strokeWidth={1.9}
                  color={colors.textMuted}
                  style={{ transform: editorDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}
                />
              </button>

              {editorDropdownOpen && (
                <div
                  className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-lg"
                  style={{
                    background: colors.bg,
                    border: `1px solid ${colors.separator}`,
                    boxShadow: '0 12px 32px rgba(0,0,0,0.22)',
                  }}
                >
                  {editorOptions.map((editor, index) => {
                    const isSelected = defaultEditor === editor.kind
                    const available = editorAvailability.find((item) => item.kind === editor.kind)?.available ?? false
                    return (
                      <button
                        key={editor.kind}
                        disabled={!available}
                        onClick={async () => {
                          if (!available) return
                          setEditorSaving(editor.kind)
                          try {
                            await setEditorPreference(editor.kind)
                          } finally {
                            setEditorSaving(null)
                            setEditorDropdownOpen(false)
                          }
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors duration-[120ms]"
                        style={{
                          color: available ? colors.textSecondary : colors.textMuted,
                          opacity: available ? 1 : 0.4,
                          cursor: available ? 'pointer' : 'not-allowed',
                          background: isSelected ? colors.bgInput : 'transparent',
                          borderTop: index > 0 ? `1px solid ${colors.borderSubtle}` : 'none',
                        }}
                        onMouseEnter={(e) => {
                          if (available) e.currentTarget.style.background = colors.bgInput
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isSelected ? colors.bgInput : 'transparent'
                        }}
                      >
                        {editor.kind === 'explorer' ? <ExplorerIcon /> : <ProviderIcon svg={editor.svg} />}
                        <span className="flex-1">{editor.label}</span>
                        {!available && (
                          <span className="text-[10px]" style={{ color: colors.error }}>
                            not found
                          </span>
                        )}
                        {editorSaving === editor.kind && (
                          <span className="text-[10px]" style={{ color: colors.textGhost }}>
                            saving
                          </span>
                        )}
                        {isSelected && available && (
                          <Check size={sizes.iconSm} strokeWidth={2} color={colors.success} />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* hooks section */}
          <div className="px-5 py-4" style={{ borderBottom: sectionBorder }}>
            <span
              className="text-[10px] font-semibold"
              style={{ color: colors.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase' }}
            >
              Hooks
            </span>

            <div className="mt-3 flex flex-col gap-1.5">
              {/* claude code block */}
              <div className="rounded-md" style={{ background: colors.bgCard, padding: '12px 14px' }}>
                <div className="flex items-center gap-2">
                  <ProviderIcon svg={claudeLogo} color={colors.textPrimary} />
                  <span className="text-[12px] font-medium flex-1" style={{ color: colors.textPrimary }}>
                    Claude Code
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block rounded-full"
                      style={{
                        width: 6,
                        height: 6,
                        background: claudeCount === claudeTotal && claudeTotal > 0 ? colors.success : colors.error,
                        boxShadow:
                          claudeCount === claudeTotal && claudeTotal > 0
                            ? '0 0 6px rgba(34,197,94,0.3)'
                            : '0 0 6px rgba(239,68,68,0.3)',
                      }}
                    />
                    <span className="text-[10px]" style={{ color: colors.textGhost }}>
                      {claudeCount}/{claudeTotal}
                    </span>
                  </div>
                </div>
                {claudeHooks && (
                  <div className="mt-2 flex flex-col gap-0.5" style={{ paddingLeft: 22 }}>
                    {claudeHooks.map((h) => (
                      <div
                        key={h.name}
                        className="flex items-center gap-1.5"
                        style={{ fontSize: 11, lineHeight: 1.8, color: colors.textSecondary }}
                      >
                        {h.ok ? <Checkmark /> : <MissingMark />}
                        <span>{h.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handleInstall}
                disabled={installing}
                className="takoyaki-btn px-3 py-1.5 rounded-md text-[11px] disabled:opacity-50 cursor-pointer"
                style={{
                  ...button.base,
                  color:
                    installResult === 'installed'
                      ? colors.success
                      : installResult === 'failed'
                        ? colors.error
                        : colors.textSecondary,
                }}
                onMouseEnter={(e) => {
                  if (!installing && !installResult) Object.assign(e.currentTarget.style, button.hover)
                }}
                onMouseLeave={(e) => {
                  Object.assign(e.currentTarget.style, {
                    ...button.base,
                    color:
                      installResult === 'installed'
                        ? colors.success
                        : installResult === 'failed'
                          ? colors.error
                          : colors.textSecondary,
                  })
                }}
                onMouseDown={(e) => {
                  Object.assign(e.currentTarget.style, button.active)
                }}
                onMouseUp={(e) => {
                  Object.assign(e.currentTarget.style, button.hover)
                }}
              >
                {installing
                  ? 'Installing...'
                  : installResult === 'installed'
                    ? 'Installed'
                    : installResult === 'failed'
                      ? 'Failed'
                      : 'Install / Repair'}
              </button>
              <button
                onClick={handleTest}
                disabled={testing || !diagnostics?.installedHooks.Stop || !diagnostics?.installedHooks.UserPromptSubmit}
                className="takoyaki-btn px-3 py-1.5 rounded-md text-[11px] disabled:opacity-50 cursor-pointer"
                style={{
                  ...button.base,
                  color:
                    testResult === 'passed'
                      ? colors.success
                      : testResult === 'failed'
                        ? colors.error
                        : colors.textSecondary,
                }}
                onMouseEnter={(e) => {
                  if (!testing && !testResult) Object.assign(e.currentTarget.style, button.hover)
                }}
                onMouseLeave={(e) => {
                  Object.assign(e.currentTarget.style, {
                    ...button.base,
                    color:
                      testResult === 'passed'
                        ? colors.success
                        : testResult === 'failed'
                          ? colors.error
                          : colors.textSecondary,
                  })
                }}
                onMouseDown={(e) => {
                  Object.assign(e.currentTarget.style, button.active)
                }}
                onMouseUp={(e) => {
                  Object.assign(e.currentTarget.style, button.hover)
                }}
              >
                {testing
                  ? 'Testing...'
                  : testResult === 'passed'
                    ? 'Passed'
                    : testResult === 'failed'
                      ? 'Failed'
                      : 'Test pane'}
              </button>
            </div>
          </div>

          {/* diagnostics terminal block */}
          {diagnostics && (
            <div className="px-5 py-4" style={{ borderBottom: sectionBorder }}>
              <div
                className="rounded-md"
                style={{
                  background: colors.bgCard,
                  padding: '14px 16px',
                  fontFamily: fonts.mono,
                  fontSize: 11,
                  lineHeight: 1.7,
                }}
              >
                <div className="flex gap-2" style={{ color: colors.textSecondary }}>
                  <span style={{ color: colors.textMuted }}>node</span>
                  <span style={{ color: colors.textGhost }}>{diagnostics.nodeExecutable || 'unresolved'}</span>
                </div>
                <div className="flex gap-2" style={{ color: colors.textSecondary }}>
                  <span style={{ color: colors.textMuted }}>socket</span>
                  <span style={{ color: colors.textGhost }}>
                    {diagnostics.socketAddress || diagnostics.socketAddrPath}
                  </span>
                </div>
                {diagnostics.lastEvent && (
                  <div className="flex gap-2" style={{ color: colors.textSecondary }}>
                    <span style={{ color: colors.textMuted }}>last</span>
                    <span style={{ color: colors.textGhost }}>
                      {diagnostics.lastEvent.lastEventName || diagnostics.lastEvent.activity}
                    </span>
                  </div>
                )}
                <div
                  className="mt-2"
                  style={{ color: diagnostics.health === 'connected' ? colors.textSecondary : colors.error }}
                >
                  {diagnostics.detail}
                </div>
                {diagnostics.externalNote && (
                  <div className="mt-1" style={{ color: colors.textGhost }}>
                    {diagnostics.externalNote}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* shortcuts section */}
          <div className="px-5 py-4">
            <span
              className="text-[10px] font-semibold"
              style={{ color: colors.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase' }}
            >
              Shortcuts
            </span>
            <div className="mt-3 flex flex-col">
              {shortcutDisplayRows.map((shortcut) => (
                <div key={shortcut.label} className="flex items-center justify-between py-[5px]">
                  <span className="text-[12px]" style={{ color: colors.textSecondary }}>
                    {shortcut.description}
                  </span>
                  <span className="text-[11px]" style={{ fontFamily: fonts.mono, color: colors.textGhost }}>
                    {shortcut.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* end scrollable content */}
      </div>
    </div>
  )
}
