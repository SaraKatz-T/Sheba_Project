import {
  Check,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  EyeOff,
  GitCompareArrows,
  Hash,
  Info,
  LoaderCircle,
  Pencil,
} from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Field, FieldValueSource, Page, ReasonCode } from '../api/types'
import { isValidIsraeliId } from '../lib/israeliId'
import { FieldCrop } from './FieldCrop'
import type { PageImageCache } from './imageCache'

const REASON_ICON: Record<ReasonCode, typeof Info> = {
  models_disagree: GitCompareArrows,
  checksum_failed: Hash,
  illegible: EyeOff,
  missing: CircleDashed,
  low_confidence: CircleHelp,
  other: Info,
}

const MODEL_NAMES: Record<string, string> = { gemini: 'Gemini', qwen: 'Qwen' }

export type SaveField = (key: string, value: string, source: FieldValueSource) => Promise<void>
export type Direction = 'next' | 'prev'

function IdCheck({ value }: { value: string }) {
  if (!value.trim()) return null
  const ok = isValidIsraeliId(value)
  return (
    <span className={ok ? 'id-check is-ok' : 'id-check is-bad'} role="status">
      {ok ? <CircleCheck size={15} aria-hidden="true" /> : <Hash size={15} aria-hidden="true" />}
      {ok ? 'ספרת ביקורת תקינה' : 'ספרת ביקורת לא תקינה'}
    </span>
  )
}

interface YellowProps {
  field: Field
  page: Page | null
  cache: PageImageCache
  readOnly: boolean
  inputRef: (el: HTMLInputElement | null) => void
  onSave: SaveField
  onNavigate: (dir: Direction) => void
  onOpenImage: () => void
}

/** A field the system is unsure about: why, where it is on the form, and the readings to pick from. */
export function YellowField({ field, page, cache, readOnly, inputRef, onSave, onNavigate, onOpenImage }: YellowProps) {
  const inputId = useId()
  const reasonId = useId()
  const [draft, setDraft] = useState(field.value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitted = useRef<string | null>(null)

  // Follow the server once our own change has landed (or when nothing is being edited).
  useEffect(() => {
    if (submitted.current === null || submitted.current === field.value) {
      submitted.current = null
      setDraft(field.value)
    }
  }, [field.value])

  const save = async (value: string, source: FieldValueSource) => {
    submitted.current = value
    setSaving(true)
    setError(null)
    try {
      await onSave(field.key, value, source)
    } catch (e) {
      submitted.current = null
      setError(e instanceof Error ? e.message : 'השמירה נכשלה.')
    } finally {
      setSaving(false)
    }
  }

  const dirty = draft !== field.value && draft !== submitted.current
  const readings = Object.entries(field.readings ?? {})
  const Icon = field.reason_code ? REASON_ICON[field.reason_code] : Info
  const resolved = !field.uncertain

  return (
    <article className={`yfield${resolved ? ' is-resolved' : ''}`} aria-labelledby={`${inputId}-label`}>
      <div className="yfield-main">
        <div className="yfield-head">
          <label id={`${inputId}-label`} htmlFor={inputId} className="yfield-label">
            {field.label}
          </label>
          {resolved ? (
            <span className="chip chip-ok">
              <Check size={13} aria-hidden="true" />
              {field.corrected ? 'תוקן' : 'אושר'}
            </span>
          ) : (
            <span className="chip chip-flag">לבדיקה</span>
          )}
        </div>
        {field.reason && (
          <p id={reasonId} className="yfield-reason">
            <Icon size={16} aria-hidden="true" />
            {field.reason}
          </p>
        )}

        <div className="yfield-edit">
          <input
            ref={inputRef}
            id={inputId}
            className={`input yfield-input${field.type === 'id_number' || field.type === 'number' || field.type === 'phone' ? ' ltr' : ''}`}
            value={draft}
            readOnly={readOnly}
            aria-describedby={field.reason ? reasonId : undefined}
            aria-invalid={field.type === 'id_number' && !!draft && !isValidIsraeliId(draft) ? true : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (!readOnly && dirty) void save(draft, 'manual')
            }}
            onKeyDown={(e) => {
              if (readOnly) return
              if (e.key === 'Enter') {
                e.preventDefault()
                if (dirty) void save(draft, 'manual')
                else if (field.uncertain) void save(field.value, 'confirmed')
                onNavigate('next')
              } else if (e.key === 'Tab') {
                e.preventDefault()
                if (dirty) void save(draft, 'manual')
                onNavigate(e.shiftKey ? 'prev' : 'next')
              } else if (e.key === 'Escape' && dirty) {
                e.preventDefault()
                setDraft(field.value)
              } else if (e.altKey && (e.key === '1' || e.key === '2')) {
                const reading = readings[Number(e.key) - 1]
                if (reading?.[1]) {
                  e.preventDefault()
                  setDraft(reading[1])
                  void save(reading[1], reading[0] as FieldValueSource)
                }
              }
            }}
          />
          {!readOnly && field.uncertain && !dirty && (
            <button type="button" className="btn btn-sm btn-outline" onClick={() => void save(field.value, 'confirmed')} disabled={saving}>
              <Check size={15} aria-hidden="true" />
              הערך נכון
            </button>
          )}
          {saving && <LoaderCircle size={18} className="spin yfield-saving" aria-label="שומר" />}
        </div>

        {field.type === 'id_number' && <IdCheck value={draft} />}

        {readings.length > 0 && (
          <div className="readings" role="group" aria-label="מה קראו המודלים">
            {readings.map(([model, value], i) => {
              const chosen = value !== null && value === field.value
              return (
                <button
                  key={model}
                  type="button"
                  className={`reading${chosen ? ' is-chosen' : ''}`}
                  disabled={readOnly || value === null || saving}
                  aria-pressed={chosen}
                  onClick={() => {
                    if (value === null) return
                    setDraft(value)
                    void save(value, model as FieldValueSource)
                  }}
                >
                  <span className="reading-model">{MODEL_NAMES[model] ?? model}</span>
                  <span className={`reading-value${value === null ? ' muted' : ''}`}>{value ?? 'לא הצליח לקרוא'}</span>
                  {!readOnly && value !== null && <kbd aria-hidden="true">Alt+{i + 1}</kbd>}
                </button>
              )
            })}
          </div>
        )}

        {field.original_value !== null && field.corrected && (
          <p className="yfield-original">
            הערך המקורי: <span className="ltr-safe">{field.original_value || 'ריק'}</span>
          </p>
        )}
        {error && (
          <p className="alert alert-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      {page && field.box && (
        <div className="yfield-crop">
          <FieldCrop page={page} box={field.box} label={field.label} cache={cache} onOpen={onOpenImage} />
        </div>
      )}
    </article>
  )
}

interface RowProps {
  field: Field
  readOnly: boolean
  onSave: SaveField
}

/** A field the system is confident about: shown plainly, editable on demand. */
export function FieldRow({ field, readOnly, onSave }: RowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(field.value)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const editId = useId()

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = async () => {
    setEditing(false)
    if (draft === field.value) return
    try {
      await onSave(field.key, draft, 'manual')
      setError(null)
    } catch (e) {
      setDraft(field.value)
      setError(e instanceof Error ? e.message : 'השמירה נכשלה.')
    }
  }

  let value: ReactNode = field.value ? (
    <span className={field.type === 'id_number' || field.type === 'number' || field.type === 'phone' ? 'ltr num' : undefined}>
      {field.value}
    </span>
  ) : (
    <span className="muted">ריק</span>
  )
  if (editing) {
    value = (
      <input
        ref={inputRef}
        id={editId}
        className="input field-row-input"
        value={draft}
        aria-label={field.label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(field.value)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div className="field-row">
      <dt>{field.label}</dt>
      <dd>
        {value}
        {field.corrected && field.original_value !== null && !editing && (
          <span className="field-row-original">
            תוקן · המקורי: <span className="ltr-safe">{field.original_value || 'ריק'}</span>
          </span>
        )}
        {error && <span className="field-row-error">{error}</span>}
      </dd>
      {!readOnly && !editing && (
        <button
          type="button"
          className="icon-btn field-row-edit"
          onClick={() => {
            setDraft(field.value)
            setEditing(true)
          }}
          aria-label={`עריכת ${field.label}`}
          title="עריכה"
        >
          <Pencil size={16} />
        </button>
      )}
    </div>
  )
}
