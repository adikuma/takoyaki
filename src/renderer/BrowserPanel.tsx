import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { colors, fonts, sizes } from './design'
import type { BrowserPanelState } from '../shared/browser'

interface BrowserPanelProps {
  rootRef: RefObject<HTMLDivElement | null>
  state: BrowserPanelState
}

interface BrowserIconButtonProps {
  disabled?: boolean
  label: string
  onClick: () => void
  children: ReactNode
}

// keeps the browser controls quiet and utility-first
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
        event.currentTarget.style.background = colors.bgActive
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

// renders the browser chrome and keeps the main process view pinned to the host box
export function BrowserPanel({ rootRef, state }: BrowserPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState('')
  const browserOverlayInset = 2

  useEffect(() => {
    setAddress(state.url || state.lastUrl || '')
  }, [state.lastUrl, state.url])

  useEffect(() => {
    if (!state.visible) return
    const root = rootRef.current
    const host = hostRef.current
    if (!root || !host) return

    let frame = 0
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        if (state.error) {
          void window.takoyaki.browser.setBounds({
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          })
          return
        }
        const rootRect = root.getBoundingClientRect()
        const hostRect = host.getBoundingClientRect()
        if (hostRect.width < 1 || hostRect.height < 1) return
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
    }
  }, [rootRef, state.error, state.visible])

  const submitAddress = (event?: FormEvent<HTMLFormElement> | KeyboardEvent<HTMLInputElement>) => {
    event?.preventDefault()
    if (!address.trim()) return
    void window.takoyaki.browser.navigate(address)
  }

  const currentUrl = state.url || state.lastUrl

  return (
    <div
      className="relative flex h-full min-w-0 flex-col overflow-hidden"
      style={{
        background: colors.bg,
        borderLeft: `1px solid ${colors.separator}`,
      }}
    >
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
        <div ref={hostRef} className="absolute inset-x-0 bottom-0" style={{ top: browserOverlayInset }} />

        {state.error && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
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
