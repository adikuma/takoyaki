import { ArrowLeft, ArrowRight, ExternalLink, Globe, Maximize2, Minimize2, RotateCw, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { colors, fonts, sizes } from './design'
import type { BrowserDisplayMode, BrowserPanelState } from '../shared/browser'

interface BrowserPanelProps {
  rootRef: RefObject<HTMLDivElement | null>
  state: BrowserPanelState
  mode: BrowserDisplayMode
  bottomInset?: number
  isResizing: boolean
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onToggleFocusMode: () => void
}

interface BrowserIconButtonProps {
  disabled?: boolean
  label: string
  onClick: () => void
  children: ReactNode
}

// keep browser buttons light so the panel still feels like part of the shell
function BrowserIconButton({ disabled = false, label, onClick, children }: BrowserIconButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-[120ms]"
      style={{
        background: 'transparent',
        color: disabled ? colors.textGhost : colors.textSecondary,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
      onClick={onClick}
      onMouseEnter={(event) => {
        if (disabled) return
        event.currentTarget.style.background = colors.bgHover
        event.currentTarget.style.color = colors.textPrimary
      }}
      onMouseLeave={(event) => {
        if (disabled) return
        event.currentTarget.style.background = 'transparent'
        event.currentTarget.style.color = colors.textSecondary
      }}
    >
      {children}
    </button>
  )
}

// keep the native browser view locked to this host box and out of the rest of the layout
export function BrowserPanel({
  rootRef,
  state,
  mode,
  bottomInset = 0,
  isResizing,
  onResizePointerDown,
  onToggleFocusMode,
}: BrowserPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState('')
  const currentUrl = state.url || state.lastUrl

  useEffect(() => {
    setAddress(currentUrl || '')
  }, [currentUrl])

  useEffect(() => {
    const clearBounds = () =>
      void window.takoyaki.browser.setBounds({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      })

    if (!state.visible || state.error || !currentUrl) {
      clearBounds()
      return clearBounds
    }

    const root = rootRef.current
    const host = hostRef.current
    if (!root || !host) {
      clearBounds()
      return clearBounds
    }

    let frame = 0
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        const rootRect = root.getBoundingClientRect()
        const hostRect = host.getBoundingClientRect()
        if (hostRect.width < 1 || hostRect.height < 1) {
          clearBounds()
          return
        }
        void window.takoyaki.browser.setBounds({
          x: Math.round(hostRect.left - rootRect.left),
          y: Math.round(hostRect.top - rootRect.top),
          width: Math.round(hostRect.width),
          height: Math.round(hostRect.height),
        })
      })
    }

    schedule()

    const observer = new ResizeObserver(() => schedule())
    observer.observe(root)
    observer.observe(host)
    window.addEventListener('resize', schedule)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      clearBounds()
    }
  }, [currentUrl, rootRef, state.error, state.visible])

  const submitAddress = (event?: FormEvent<HTMLFormElement> | KeyboardEvent<HTMLInputElement>) => {
    event?.preventDefault()
    if (!address.trim()) return
    void window.takoyaki.browser.navigate(address)
  }

  return (
    <div
      className="relative flex h-full min-w-0 flex-col overflow-hidden"
      style={{
        background: colors.bg,
        borderLeft: `1px solid ${colors.separator}`,
        boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.28)',
      }}
    >
      {mode === 'side' && (
        <div
          onPointerDown={onResizePointerDown}
          className="group absolute inset-y-0 left-0 z-[3] w-3 cursor-col-resize"
          style={{ touchAction: 'none' }}
          aria-hidden="true"
        >
          <div
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-[120ms]"
            style={{
              background: isResizing ? colors.accent : colors.separator,
            }}
          />
        </div>
      )}

      <div
        className="shrink-0 px-3 py-2"
        style={{
          background: colors.bg,
          borderBottom: `1px solid ${colors.separator}`,
        }}
      >
        <div className="flex items-center gap-2">
          <BrowserIconButton
            label="Go back"
            disabled={!state.canGoBack}
            onClick={() => {
              void window.takoyaki.browser.goBack()
            }}
          >
            <ArrowLeft size={sizes.iconSm} strokeWidth={1.9} />
          </BrowserIconButton>
          <BrowserIconButton
            label="Go forward"
            disabled={!state.canGoForward}
            onClick={() => {
              void window.takoyaki.browser.goForward()
            }}
          >
            <ArrowRight size={sizes.iconSm} strokeWidth={1.9} />
          </BrowserIconButton>
          <BrowserIconButton
            label="Reload"
            onClick={() => {
              void window.takoyaki.browser.reload()
            }}
          >
            <RotateCw size={sizes.iconSm} strokeWidth={1.9} className={state.isLoading ? 'takoyaki-spin' : undefined} />
          </BrowserIconButton>

          <form className="flex min-w-0 flex-1" onSubmit={submitAddress}>
            <div
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-3"
              style={{
                background: colors.bgInput,
              }}
            >
              <Globe size={sizes.iconSm} strokeWidth={1.85} style={{ color: colors.textGhost, flexShrink: 0 }} />
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitAddress(event)
                }}
                placeholder="Enter a URL"
                className="takoyaki-input h-full min-w-0 flex-1 bg-transparent outline-none"
                style={{
                  color: colors.textPrimary,
                  fontFamily: fonts.ui,
                  fontSize: sizes.textSm,
                }}
              />
            </div>
          </form>

          <div className="flex items-center gap-1">
            <BrowserIconButton
              label={mode === 'focus' ? 'Exit browser focus' : 'Focus browser'}
              onClick={onToggleFocusMode}
            >
              {mode === 'focus' ? (
                <Minimize2 size={sizes.iconSm} strokeWidth={1.9} />
              ) : (
                <Maximize2 size={sizes.iconSm} strokeWidth={1.9} />
              )}
            </BrowserIconButton>
            <BrowserIconButton
              label="Open externally"
              disabled={!currentUrl}
              onClick={() => {
                if (!currentUrl) return
                void window.takoyaki.window.openExternal(currentUrl)
              }}
            >
              <ExternalLink size={sizes.iconSm} strokeWidth={1.9} />
            </BrowserIconButton>
            <BrowserIconButton
              label="Close browser"
              onClick={() => {
                void window.takoyaki.browser.hide()
              }}
            >
              <X size={sizes.iconSm} strokeWidth={1.9} />
            </BrowserIconButton>
          </div>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden" style={{ background: colors.bg }}>
        <div
          className="absolute left-0 right-0 top-0 z-[2] h-[2px] transition-opacity duration-[160ms]"
          style={{
            background: colors.accent,
            opacity: state.isLoading ? 1 : 0,
          }}
        />
        <div ref={hostRef} className="absolute left-0 right-0 top-0" style={{ bottom: bottomInset }} />

        {state.error && (
          <div
            className="absolute left-0 right-0 top-0 flex items-center justify-center px-8 text-center"
            style={{ bottom: bottomInset }}
          >
            <div className="max-w-[280px] space-y-2">
              <p style={{ fontFamily: fonts.ui, fontSize: sizes.textBase, color: colors.textPrimary }}>
                That page did not load cleanly.
              </p>
              <p style={{ fontFamily: fonts.ui, fontSize: sizes.textSm, color: colors.textSecondary, lineHeight: 1.5 }}>
                {state.error}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
