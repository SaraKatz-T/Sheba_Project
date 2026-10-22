import { Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormStatus } from '../api/types'
import { Popover } from '../components/Popover'
import { formatDate, formatNumber } from '../lib/format'
import { israelDateKey } from '../lib/hebrewSearch'
import { currentPreset, defaultFilters, hasActiveFilters, presetRange, type DatePreset, type Filters } from './filters'

interface StatusOption {
  label: string
  hint: string
  statuses: FormStatus[]
}

// "Received" lasts seconds, so it shares an option with "processing".
const STATUS_OPTIONS: StatusOption[] = [
  { label: 'בעיבוד', hint: 'המערכת קוראת את הטופס עכשיו', statuses: ['received', 'processing'] },
  { label: 'ממתין לבדיקה', hint: 'מחכה שאדם יעבור ויאשר', statuses: ['pending_review'] },
  { label: 'אושר', hint: 'נבדק ואושר', statuses: ['approved'] },
  { label: 'נכשל', hint: 'המערכת לא הצליחה לקרוא את הטופס. אפשר לנסות שוב', statuses: ['failed'] },
  { label: 'נדחה', hint: 'אדם החליט לא לקבל את הטופס, למשל כפילות', statuses: ['rejected'] },
]

const DATE_OPTIONS: Array<{ key: DatePreset; label: string }> = [
  { key: 'all', label: 'כל התאריכים' },
  { key: 'today', label: 'היום' },
  { key: 'yesterday', label: 'אתמול' },
  { key: 'week', label: '7 הימים האחרונים' },
  { key: 'month', label: '30 הימים האחרונים' },
  { key: 'custom', label: 'טווח תאריכים' },
]

interface Props {
  filters: Filters
  counts: Partial<Record<FormStatus, number>>
  onChange: (patch: Partial<Filters>) => void
}

function statusLabel(selected: FormStatus[]) {
  const chosen = STATUS_OPTIONS.filter((o) => o.statuses.every((s) => selected.includes(s)))
  if (selected.length === 0) return 'כל הסטטוסים'
  if (chosen.length === 1) return chosen[0].label
  return `${chosen.length} סטטוסים`
}

function dateLabel(f: Filters) {
  const preset = currentPreset(f)
  if (preset !== 'custom') return DATE_OPTIONS.find((o) => o.key === preset)!.label
  if (f.from && f.to) return f.from === f.to ? formatDate(f.from) : `${formatDate(f.from)} – ${formatDate(f.to)}`
  if (f.from) return `מ-${formatDate(f.from)}`
  return `עד ${formatDate(f.to!)}`
}

export function RecordsToolbar({ filters, counts, onChange }: Props) {
  const searchId = useId()
  const fromId = useId()
  const toId = useId()
  const yellowId = useId()
  const [q, setQ] = useState(filters.q)
  const lastSent = useRef(filters.q)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Typing updates the list after a short pause, not on every keystroke.
  useEffect(() => {
    if (q === lastSent.current) return
    const t = setTimeout(() => {
      lastSent.current = q
      onChangeRef.current({ q })
    }, 180)
    return () => clearTimeout(t)
  }, [q])

  // Follow outside changes (e.g. "clear filters").
  useEffect(() => {
    if (filters.q !== lastSent.current) {
      lastSent.current = filters.q
      setQ(filters.q)
    }
  }, [filters.q])

  const toggleStatus = (option: StatusOption, on: boolean) => {
    const rest = filters.statuses.filter((s) => !option.statuses.includes(s))
    onChange({ statuses: on ? [...rest, ...option.statuses] : rest })
  }

  const preset = currentPreset(filters)
  const [customOpen, setCustomOpen] = useState(preset === 'custom')
  const today = israelDateKey(new Date().toISOString())

  const pickDate = (key: DatePreset) => {
    setCustomOpen(key === 'custom')
    if (key === 'all') onChange({ from: null, to: null })
    else if (key !== 'custom') onChange(presetRange(key))
  }

  return (
    <section className="toolbar" aria-label="חיפוש וסינון">
      <div className="search">
        <label htmlFor={searchId} className="visually-hidden">
          חיפוש
        </label>
        <Search size={20} className="search-icon" aria-hidden="true" />
        <input
          id={searchId}
          className="input search-input"
          type="search"
          placeholder='חיפוש לפי מספר התחייבות, שם, ת"ז או תאריך'
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

      <div className="toolbar-filters">
        <Popover
          title="סינון לפי סטטוס"
          active={filters.statuses.length > 0}
          label={
            <>
              <span className="filter-button-name">סטטוס:</span> {statusLabel(filters.statuses)}
            </>
          }
        >
          {(close) => (
            <>
              <fieldset className="pop-options">
                <legend className="visually-hidden">סטטוס</legend>
                {STATUS_OPTIONS.map((o) => {
                  const on = o.statuses.every((s) => filters.statuses.includes(s))
                  const count = o.statuses.reduce((n, s) => n + (counts[s] ?? 0), 0)
                  return (
                    <label key={o.label} className="pop-option">
                      <input type="checkbox" checked={on} onChange={(e) => toggleStatus(o, e.target.checked)} />
                      <span className="pop-option-text">
                        <span className="pop-option-label">{o.label}</span>
                        <span className="pop-option-hint">{o.hint}</span>
                      </span>
                      <span className="filter-count">{formatNumber(count)}</span>
                    </label>
                  )
                })}
              </fieldset>
              <div className="pop-foot">
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => onChange({ statuses: [] })}
                  disabled={filters.statuses.length === 0}
                >
                  הצגת כל הסטטוסים
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => close()}>
                  סגירה
                </button>
              </div>
            </>
          )}
        </Popover>

        <Popover
          title="סינון לפי תאריך קליטה"
          active={preset !== 'today' && preset !== 'all'}
          label={
            <>
              <span className="filter-button-name">תאריך קליטה:</span> {dateLabel(filters)}
            </>
          }
        >
          {(close) => (
            <>
              <fieldset className="pop-options">
                <legend className="visually-hidden">תאריך קליטה</legend>
                {DATE_OPTIONS.map((o) => (
                  <label key={o.key} className="pop-option">
                    <input
                      type="radio"
                      name="intake-date"
                      checked={o.key === 'custom' ? customOpen || preset === 'custom' : !customOpen && preset === o.key}
                      onChange={() => pickDate(o.key)}
                    />
                    <span className="pop-option-label">{o.label}</span>
                  </label>
                ))}
              </fieldset>
              {(customOpen || preset === 'custom') && (
                <div className="pop-range">
                  <label htmlFor={fromId}>מתאריך</label>
                  <input
                    id={fromId}
                    className="input date-input"
                    type="date"
                    value={filters.from ?? ''}
                    max={filters.to ?? today}
                    onChange={(e) => onChange({ from: e.target.value || null })}
                  />
                  <label htmlFor={toId}>עד תאריך</label>
                  <input
                    id={toId}
                    className="input date-input"
                    type="date"
                    value={filters.to ?? ''}
                    min={filters.from ?? undefined}
                    max={today}
                    onChange={(e) => onChange({ to: e.target.value || null })}
                  />
                </div>
              )}
              <div className="pop-foot">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => close()}>
                  סגירה
                </button>
              </div>
            </>
          )}
        </Popover>

        <label className="switch" htmlFor={yellowId}>
          <input
            id={yellowId}
            type="checkbox"
            role="switch"
            checked={filters.yellow}
            onChange={(e) => onChange({ yellow: e.target.checked })}
          />
          <span className="switch-track" aria-hidden="true" />
          ממתין לבדיקה
        </label>

        {hasActiveFilters(filters) && (
          <button
            type="button"
            className="btn btn-sm btn-quiet clear-filters"
            onClick={() => {
              setCustomOpen(false)
              onChange(defaultFilters())
            }}
          >
            <X size={16} aria-hidden="true" />
            ניקוי הסינון
          </button>
        )}
      </div>
    </section>
  )
}
