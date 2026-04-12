import { useState, useRef, useEffect, type ReactElement } from 'react'
import { colors } from './design'

interface Props {
  content: string
  children: ReactElement
  side?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
}

export function Tooltip({ content, children, side = 'top', delay = 400 }: Props) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // wait briefly before showing the tooltip so quick passes do not flicker
  const show = () => {
    timer.current = setTimeout(() => {
      if (!ref.current) return
      const r = ref.current.getBoundingClientRect()
      const pos = {
        top: { x: r.left + r.width / 2, y: r.top - 6 },
        bottom: { x: r.left + r.width / 2, y: r.bottom + 6 },
        left: { x: r.left - 6, y: r.top + r.height / 2 },
        right: { x: r.right + 6, y: r.top + r.height / 2 },
      }
      setCoords(pos[side])
      setVisible(true)
    }, delay)
  }

  // cancel any pending tooltip show and hide immediately
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setVisible(false)
  }

  // clear delayed timers when the tooltip unmounts
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const transform =
    side === 'top'
      ? 'translate(-50%, -100%)'
      : side === 'bottom'
        ? 'translate(-50%, 0)'
        : side === 'left'
          ? 'translate(-100%, -50%)'
          : 'translate(0, -50%)'

  return (
    <div ref={ref} onMouseEnter={show} onMouseLeave={hide} style={{ display: 'inline-flex' }}>
      {children}
      {visible && (
        <div
          className="fixed z-[70] pointer-events-none takoyaki-tooltip"
          style={{
            left: coords.x,
            top: coords.y,
            transform,
            background: colors.tooltipBg,
            color: colors.tooltipText,
            fontSize: 11,
            padding: '4px 8px',
            borderRadius: 5,
            border: `1px solid ${colors.separator}`,
            whiteSpace: 'nowrap',
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}
