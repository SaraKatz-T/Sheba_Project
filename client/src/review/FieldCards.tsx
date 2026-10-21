import { Check, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { Field, FieldValueSource, Page } from '../api/types'
import { isValidIsraeliId } from '../lib/israeliId'
import { FieldCrop } from './FieldCrop'
import type { PageImageCache } from './imageCache'

export type SaveField = (key: string, value: string, source: FieldValueSource) => Promise<void>
export type Direction = 'next' | 'prev'

const LTR_TYPES = new Set(['id_number', 'number', 'phone'])

interface ReviewProps {
  field: Field
  page: Page | null
  cache: PageImageCache
  inputRef: (el: HTMLInputElement | null) => void
  onSave: SaveField
  onNavigate: (dir: Direction) => void
  onOpenImage: () => void
}

/**
 * A field to check: amber, editable, with a thin slice of the real form showing exactly
 * this field. Enter keeps the value (or saves the edit) and moves on.
 */
export function ReviewField({ field, page, cache, inputRef, onSave, onNavigate, onOpenImage }: ReviewProps) {
  const inputId = useId()
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
  const done = !field.uncertain
  const badId = field.type === 'id_number' && !!draft.trim() && !isValidIsraeliId(draft)

  return (
    <div className={`rfield${done ? ' is-done' : ''}`}>
      <div className="rfield-row">
        <label htmlFor={inputId} className="rfield-label">
          {field.label}
        </label>
        <div className="rfield-input-wrap">
          <input
            ref={inputRef}
            id={inputId}
            className={`input rfield-input${LTR_TYPES.has(field.type) ? ' ltr' : ''}`}
            value={draft}
            aria-invalid={badId || undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (dirty) void save(draft, 'manual')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
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
                e.stopPropagation()
                setDraft(field.value)
              }
            }}
          />
          {saving ? (
            <LoaderCircle size={18} className="spin rfield-state" aria-label="שומר" />
          ) : (
            done && <Check size={18} className="rfield-state is-ok" aria-label="נבדק" />
          )}
        </div>
      </div>
      {badId && <p className="rfield-hint">ספרת ביקורת לא תקינה</p>}
      {error && (
        <p className="rfield-hint" role="alert">
          {error}
        </p>
      )}
      {page && field.box && (
        <FieldCrop page={page} box={field.box} label={field.label} cache={cache} onOpen={onOpenImage} />
      )}
    </div>
  )
}

/** Every other field: plain text, not editable. */
export function PlainField({ field }: { field: Field }) {
  return (
    <div className="pfield">
      <dt>{field.label}</dt>
      <dd>
        {field.value ? (
          <span className={LTR_TYPES.has(field.type) ? 'ltr num' : undefined}>{field.value}</span>
        ) : (
          <span className="muted">—</span>
        )}
        {field.corrected && field.original_value !== null && (
          <span className="pfield-original">
            תוקן · המקורי: <bdi>{field.original_value || 'ריק'}</bdi>
          </span>
        )}
      </dd>
    </div>
  )
}
