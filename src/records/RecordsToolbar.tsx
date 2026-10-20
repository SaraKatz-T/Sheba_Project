import { Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormStatus } from '../api/types'
import { formatNumber } from '../lib/format'
import { israelDateKey } from '../lib/hebrewSearch'
import { hasActiveFilters, presetRange, type Filters } from './filters'

interface StatusOption {
  label: string
  statuses: FormStatus[]
}

// "Received" lasts seconds, so it shares a chip with "processing".
const STATUS_OPTIONS: StatusOption[] = [
  { label: 'בעיבוד', statuses: ['received', 'processing'] },
  { label: 'ממתין לבדיקה', statuses: ['pending_review'] },
  { label: 'אושר', statuses: ['approved'] },
  { label: 'נכשל', statuses: ['failed'] },
  { label: 'נדחה', statuses: ['rejected'] },
]

const PRESETS = [
  { label: 'היום', days: 1 },
  { label: '7 ימים', days: 7 },
  { label: '30 ימים', days: 30 },
]

interface Props {
  filters: Filters
  counts: Partial<Record<FormStatus, number>>
  onChange: (patch: Partial<Filters>) => void
}

export function RecordsToolbar({ filters, counts, onChange }: Props) {
  const searchId = useId()
  const fromId = useId()
  const toId = useId()
  const yellowId = useId()
  const [q, setQ] = useState(filters.q)
  const lastSent = useRef(filters.q)

  // Typing updates the list after a short pause, not on every keystroke.
  useEffect(() => {
    if (q === lastSent.current) return
    const t = setTimeout(() => {
      lastSent.current = q
      onChange({ q })
    }, 180)
    return () => clearTimeout(t)
  }, [q, onChange])

  // Follow outside changes (e.g. "clear filters").
  useEffect(() => {
    if (filters.q !== lastSent.current) {
      lastSent.current = filters.q
      setQ(filters.q)
    }
  }, [filters.q])

  const toggleStatus = (option: StatusOption) => {
    const on = option.statuses.every((s) => filters.statuses.includes(s))
    const next = on
      ? filters.statuses.filter((s) => !option.statuses.includes(s))
      : [...filters.statuses, ...option.statuses.filter((s) => !filters.statuses.includes(s))]
    onChange({ statuses: next })
  }

  const today = israelDateKey(new Date().toISOString())
  const activePreset = PRESETS.find((p) => {
    const r = presetRange(p.days)
    return filters.from === r.from && filters.to === r.to
  })

  return (
    <section className="toolbar" aria-label="חיפוש וסינון">
      <div className="toolbar-row">
        <div className="search">
          <label htmlFor={searchId} className="visually-hidden">
            חיפוש
          </label>
          <Search size={20} className="search-icon" aria-hidden="true" />
          <input
            id={searchId}
            className="input search-input"
            type="search"
            placeholder='חיפוש לפי שם, ת"ז או תאריך (למשל 20.10)'
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && q) {
                e.preventDefault()
                setQ('')
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
          {q && (
            <button type="button" className="icon-btn search-clear" onClick={() => setQ('')} aria-label="ניקוי החיפוש">
              <X size={18} />
            </button>
          )}
        </div>

        <label className="switch" htmlFor={yellowId}>
          <input
            id={yellowId}
            type="checkbox"
            role="switch"
            checked={filters.yellow}
            onChange={(e) => onChange({ yellow: e.target.checked })}
          />
          <span className="switch-track" aria-hidden="true" />
          רק עם שדות צהובים
        </label>
      </div>

      <div className="toolbar-row toolbar-row-wrap">
        <div className="filter-group" role="group" aria-label="סטטוס">
          <span className="filter-label">סטטוס</span>
          {STATUS_OPTIONS.map((option) => {
            const on = option.statuses.every((s) => filters.statuses.includes(s))
            const count = option.statuses.reduce((n, s) => n + (counts[s] ?? 0), 0)
            return (
              <button
                key={option.label}
                type="button"
                className="filter-chip"
                aria-pressed={on}
                onClick={() => toggleStatus(option)}
              >
                {option.label}
                <span className="filter-count">{formatNumber(count)}</span>
              </button>
            )
          })}
        </div>

        <div className="filter-group" role="group" aria-label="תאריך קליטה">
          <span className="filter-label">תאריך קליטה</span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="filter-chip"
              aria-pressed={activePreset === p}
              onClick={() => onChange(activePreset === p ? { from: null, to: null } : presetRange(p.days))}
            >
              {p.label}
            </button>
          ))}
          <span className="date-range">
            <label htmlFor={fromId} className="visually-hidden">
              מתאריך
            </label>
            <input
              id={fromId}
              className="input date-input"
              type="date"
              value={filters.from ?? ''}
              max={filters.to ?? today}
              onChange={(e) => onChange({ from: e.target.value || null })}
            />
            <span className="muted" aria-hidden="true">
              עד
            </span>
            <label htmlFor={toId} className="visually-hidden">
              עד תאריך
            </label>
            <input
              id={toId}
              className="input date-input"
              type="date"
              value={filters.to ?? ''}
              min={filters.from ?? undefined}
              max={today}
              onChange={(e) => onChange({ to: e.target.value || null })}
            />
          </span>
        </div>

        {hasActiveFilters(filters) && (
          <button
            type="button"
            className="btn btn-sm btn-quiet clear-filters"
            onClick={() => onChange({ q: '', statuses: [], from: null, to: null, yellow: false })}
          >
            <X size={16} aria-hidden="true" />
            ניקוי הסינון
          </button>
        )}
      </div>
    </section>
  )
}
