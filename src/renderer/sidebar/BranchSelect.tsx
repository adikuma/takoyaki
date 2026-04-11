import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { colors, fonts, sizes } from '../design'

// searchable dropdown for the git branches
export function BranchSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string
  options: string[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const filterInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setFilterQuery('')
      return
    }
    setTimeout(() => filterInputRef.current?.focus(), 40)
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const filtered = filterQuery
    ? options.filter((option) => option.toLowerCase().includes(filterQuery.toLowerCase()))
    : options

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled && options.length > 0) setOpen((current) => !current)
        }}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-[12px] transition-colors duration-[120ms]"
        style={{
          background: colors.bgInput,
          color: disabled ? colors.textMuted : colors.textPrimary,
          opacity: disabled ? 0.7 : 1,
        }}
      >
        <span className="truncate text-left" style={{ fontFamily: fonts.mono }}>
          {value || 'Select branch'}
        </span>
        <ChevronDown size={sizes.iconSm} strokeWidth={1.9} color={colors.textMuted} />
      </button>

      {open && !disabled && options.length > 0 && (
        <div
          className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-md"
          style={{
            background: colors.bg,
            border: `1px solid ${colors.separator}`,
            boxShadow: '0 12px 32px rgba(0,0,0,0.22)',
          }}
        >
          <div style={{ padding: '6px 8px', borderBottom: `1px solid ${colors.separator}` }}>
            <input
              ref={filterInputRef}
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="filter branches..."
              className="w-full bg-transparent text-[12px] outline-none takoyaki-input"
              style={{ color: colors.textPrimary, fontFamily: fonts.mono }}
            />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 180 }}>
            {filtered.map((option) => {
              const selected = option === value
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    onChange(option)
                    setOpen(false)
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-[12px] transition-colors duration-[120ms]"
                  style={{
                    fontFamily: fonts.mono,
                    color: selected ? colors.textPrimary : colors.textSecondary,
                    background: selected ? colors.bgInput : 'transparent',
                  }}
                  onMouseEnter={(event) => {
                    if (!selected) event.currentTarget.style.background = colors.bgInput
                    event.currentTarget.style.color = colors.textPrimary
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = selected ? colors.bgInput : 'transparent'
                    event.currentTarget.style.color = selected ? colors.textPrimary : colors.textSecondary
                  }}
                >
                  <span className="truncate">{option}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
