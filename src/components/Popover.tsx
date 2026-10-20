import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

interface Props {
  /** Button text; should say the current choice, e.g. "סטטוס: הכל". */
  label: ReactNode
  /** Highlights the button when its filter is narrowing the list. */
  active?: boolean
  /** Accessible name of the panel. */
  title: string
  children: (close: () => void) => ReactNode
}

/** A button that opens a small panel below it. Closes on Escape, outside click, or focus leaving. */
export function Popover({ label, active, title, children }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const close = (returnFocus = true) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>('input:checked, input, button')?.focus()
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      className="popover"
      ref={wrapRef}
      onBlur={(e) => {
        if (open && !wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`filter-button${active ? ' is-active' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <ChevronDown size={16} className="filter-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div id={panelId} ref={panelRef} className="popover-panel" role="dialog" aria-label={title}>
          {children(close)}
        </div>
      )}
    </div>
  )
}
