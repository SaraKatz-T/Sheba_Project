import { Check, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { Field, FieldValueSource, Page } from '../api/types'
import { isValidIsraeliId } from '../lib/israeliId'
import { FieldCrop, SentCrop } from './FieldCrop'
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
  /** For the name fields: the exact image the model read the name from, shown instead of a slice. */
  sentImageUrl?: string | null
}

/**
 * A field to check: amber, editable, with a thin slice of the real form showing exactly
 * this field. Enter keeps the value (or saves the edit) and moves on.
 */
export function ReviewField({ field, page, cache, inputRef, onSave, onNavigate, onOpenImage, sentImageUrl }: ReviewProps) {
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

  // Approves just this field: keeps the value as is, or saves the edit, and it stops being yellow.
  const approve = () => {
    if (dirty) void save(draft, 'manual')
    else void save(field.value, 'confirmed')
  }
  const badId = field.type === 'id_number' && !!draft.trim() && !isValidIsraeliId(draft)

  return (
    <div className={`rfield${done ? ' is-done' : ''}`} style={{ viewTransitionName: `field-${field.key}` }}>
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
            placeholder="לא נמצא"
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
          {saving && <LoaderCircle size={18} className="spin rfield-state" aria-label="שומר" />}
        </div>
        {/* One fixed-size slot: the approve button, then the same circle filled, so nothing moves */}
        {done ? (
          <span className="rfield-approve is-done" role="img" aria-label={`${field.label}: אושר`} data-tip="אושר">
            <Check size={14} strokeWidth={3} aria-hidden="true" />
          </span>
        ) : (
          <button
            type="button"
            className="rfield-approve"
            onClick={approve}
            disabled={saving}
            aria-label={`אישור ${field.label}`}
            data-tip="אישור"
          >
            <Check size={14} strokeWidth={3} aria-hidden="true" />
          </button>
        )}
      </div>
      {badId && <p className="rfield-hint">ספרת ביקורת לא תקינה</p>}
      {error && (
        <p className="rfield-hint" role="alert">
          {error}
        </p>
      )}
      {sentImageUrl ? (
        <SentCrop url={sentImageUrl} label={field.label} cache={cache} onOpen={onOpenImage} />
      ) : (
        page &&
        field.box && <FieldCrop page={page} box={field.box} label={field.label} cache={cache} onOpen={onOpenImage} />
      )}
    </div>
  )
}

interface PlainProps {
  field: Field
  /** Given only while the form can still be changed: a double click then opens the value for editing. */
  onSave?: SaveField
}

/**
 * Every other field: plain text. While the form is waiting for review, a double click opens it
 * for a correction (the model may have been wrong), confirmed with a small check or Enter.
 */
export function PlainField({ field, onSave }: PlainProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(field.value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ltr = LTR_TYPES.has(field.type)

  const open = () => {
    if (!onSave || editing) return
    setDraft(field.value)
    setError(null)
    setEditing(true)
  }
  const cancel = () => {
    setEditing(false)
    setError(null)
  }
  const confirm = async () => {
    if (!onSave) return
    if (draft.trim() === field.value) return cancel()
    setSaving(true)
    setError(null)
    try {
      await onSave(field.key, draft, 'manual')
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'השמירה נכשלה.')
    } finally {
      setSaving(false)
    }
  }
  const badId = editing && field.type === 'id_number' && !!draft.trim() && !isValidIsraeliId(draft)

  return (
    <div
      className={`pfield${onSave ? ' is-editable' : ''}`}
      style={{ viewTransitionName: `field-${field.key}` }}
      onDoubleClick={open}
      title={onSave && !editing ? 'לחיצה כפולה לתיקון' : undefined}
    >
      <dt>{field.label}</dt>
      <dd>
        {editing ? (
          <span className="pfield-edit">
            <input
              className={`input pfield-input${ltr ? ' ltr' : ''}`}
              value={draft}
              placeholder="לא נמצא"
              autoFocus
              aria-label={field.label}
              aria-invalid={badId || undefined}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void confirm()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  cancel()
                }
              }}
            />
            <button
              type="button"
              className="rfield-approve"
              onClick={() => void confirm()}
              disabled={saving}
              aria-label={`אישור התיקון של ${field.label}`}
              data-tip="אישור"
            >
              {saving ? (
                <LoaderCircle size={14} className="spin" aria-hidden="true" />
              ) : (
                <Check size={14} strokeWidth={3} aria-hidden="true" />
              )}
            </button>
          </span>
        ) : field.value ? (
          <span className={ltr ? 'ltr num' : undefined}>{field.value}</span>
        ) : (
          <span className="muted">לא נמצא</span>
        )}
        {badId && <span className="rfield-hint">ספרת ביקורת לא תקינה</span>}
        {error && (
          <span className="rfield-hint" role="alert">
            {error}
          </span>
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
