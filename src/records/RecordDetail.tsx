// A record opened in place in the records table: the fields to check (amber, editable,
// each with a slice of the real form), every other field as plain text, and the whole
// form small at the side; zoom only when asked for.
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, CircleAlert, LoaderCircle, RotateCcw, X, ZoomIn } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { approveForm, getForm, retryForm, updateField } from '../api/endpoints'
import { keys, queryClient, upsertForm } from '../api/queries'
import type { FormDetail } from '../api/types'
import { formatDateTime } from '../lib/format'
import { PlainField, ReviewField, type Direction, type SaveField } from '../review/FieldCards'
import { usePageImageCache, useCachedImage, type PageImageCache } from '../review/imageCache'
import { PageViewer } from '../review/PageViewer'
import { RejectControl } from '../review/RejectControl'
import { ShortcutsDialog } from '../review/ShortcutsDialog'
import { recordLink } from './filters'

interface Props {
  id: string
  /** The next waiting record in the table, worked out when this one is done. */
  nextPending: (afterId: string) => string | null
  onDone: (nextId: string | null, message: string) => void
  onClose: () => void
}

function withCounts(form: FormDetail): FormDetail {
  return {
    ...form,
    uncertain_count: form.fields.filter((f) => f.uncertain).length,
    corrected_count: form.fields.filter((f) => f.corrected).length,
  }
}

/** The whole first page, small, with the fields under review outlined. */
function FormThumb({ form, marks, cache, onOpen }: { form: FormDetail; marks: FormDetail['fields']; cache: PageImageCache; onOpen: () => void }) {
  const page = form.pages[0]
  const image = useCachedImage(cache, page?.image_url ?? null)
  if (!page) return null
  return (
    <button type="button" className="form-thumb" onClick={onOpen} aria-label="הטופס כולו: פתיחה בהגדלה" tabIndex={-1}>
      <span className="form-thumb-frame" style={{ aspectRatio: `${page.width} / ${page.height}` }}>
        {image.status === 'ready' ? (
          <img src={image.src} alt="" draggable={false} />
        ) : (
          <span className="crop-loading" aria-hidden="true" />
        )}
        {marks
          .filter((f) => f.box && f.box.page === page.number)
          .map((f) => (
            <span
              key={f.key}
              className={`form-thumb-mark${f.uncertain ? '' : ' is-done'}`}
              style={{ left: `${f.box!.x * 100}%`, top: `${f.box!.y * 100}%`, width: `${f.box!.w * 100}%`, height: `${f.box!.h * 100}%` }}
            />
          ))}
      </span>
      <span className="form-thumb-label">
        <ZoomIn size={14} aria-hidden="true" />
        הגדלה
      </span>
    </button>
  )
}

export function RecordDetail({ id, nextPending, onDone, onClose }: Props) {
  const detail = useQuery({ queryKey: keys.form(id), queryFn: () => getForm(id) })
  const form = detail.data
  const cache = usePageImageCache()

  const pending = form?.status === 'pending_review'

  // Fields that needed checking when the record opened stay amber (marked done once
  // handled) so the reviewer keeps the context; only they are editable.
  const [reviewKeys, setReviewKeys] = useState<string[] | null>(null)
  useEffect(() => {
    if (form && reviewKeys === null) {
      setReviewKeys(form.status === 'pending_review' ? form.fields.filter((f) => f.uncertain).map((f) => f.key) : [])
    }
  }, [form, reviewKeys])

  const reviewFields = useMemo(
    () => (form && reviewKeys ? reviewKeys.map((k) => form.fields.find((f) => f.key === k)!).filter(Boolean) : []),
    [form, reviewKeys],
  )
  const plainFields = useMemo(
    () => (form && reviewKeys ? form.fields.filter((f) => !reviewKeys.includes(f.key)) : []),
    [form, reviewKeys],
  )
  const unresolved = reviewFields.filter((f) => f.uncertain)

  const inputs = useRef(new Map<string, HTMLInputElement>())
  const approveRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pendingSaves = useRef(new Set<Promise<unknown>>())
  const [viewer, setViewer] = useState<{ page: number; key: string | null } | null>(null)
  const [showKeys, setShowKeys] = useState(false)

  const saveField: SaveField = async (key, value, source) => {
    const p = updateField(id, key, value, source).then((field) => {
      queryClient.setQueryData<FormDetail>(keys.form(id), (old) =>
        old ? withCounts({ ...old, fields: old.fields.map((f) => (f.key === key ? field : f)) }) : old,
      )
    })
    pendingSaves.current.add(p)
    try {
      await p
    } finally {
      pendingSaves.current.delete(p)
    }
  }

  const approve = useMutation({
    mutationFn: async () => {
      // A field edit still on its way must land before the approval.
      await Promise.allSettled([...pendingSaves.current])
      return approveForm(id)
    },
    onSuccess: (summary) => {
      const next = nextPending(id)
      upsertForm(summary)
      onDone(next, 'הטופס אושר')
    },
  })
  const retry = useMutation({ mutationFn: () => retryForm(id), onSuccess: upsertForm })

  const focusField = (key: string) => {
    const el = inputs.current.get(key)
    el?.focus()
    el?.select()
  }
  const navigate = (fromKey: string, dir: Direction) => {
    const order = reviewKeys ?? []
    const target = order[order.indexOf(fromKey) + (dir === 'next' ? 1 : -1)]
    if (target) focusField(target)
    else if (dir === 'next') approveRef.current?.focus()
  }

  // Start where the work is: the first open field, or the approve button.
  const started = useRef(false)
  useEffect(() => {
    if (started.current || !form || reviewKeys === null) return
    started.current = true
    if (!pending) return
    const first = reviewKeys.find((k) => form.fields.find((f) => f.key === k)?.uncertain)
    if (first) focusField(first)
    else approveRef.current?.focus({ preventScroll: true })
  })

  // Zoom: wherever it was opened from, closing it puts the keyboard back there.
  const returnFocus = useRef<HTMLElement | null>(null)
  const showViewer = (key: string | null) => {
    const f = key ? form?.fields.find((x) => x.key === key) : undefined
    returnFocus.current = (key && inputs.current.get(key)) || (document.activeElement as HTMLElement | null)
    setViewer({ page: f?.box?.page ?? 1, key: f?.box ? key : null })
  }
  const closeViewer = () => {
    setViewer(null)
    const back = returnFocus.current
    requestAnimationFrame(() => back?.focus())
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null
      const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]')
      const plain = !e.altKey && !e.ctrlKey && !e.metaKey
      if (e.code === 'KeyI' && (e.altKey || (plain && !typing))) {
        e.preventDefault()
        if (viewer) closeViewer()
        else showViewer([...inputs.current].find(([, el]) => el === document.activeElement)?.[0] ?? reviewFields.find((f) => f.box)?.key ?? null)
        return
      }
      if (viewer || showKeys) return
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && pending) {
        e.preventDefault()
        approve.mutate()
      } else if (!typing && e.key === '?') {
        e.preventDefault()
        setShowKeys(true)
      } else if (!typing && e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (detail.isPending) {
    return (
      <div className="detail-loading" role="status">
        <LoaderCircle size={20} className="spin" aria-hidden="true" />
        פותח את הטופס…
      </div>
    )
  }
  if (detail.isError || !form) {
    return (
      <p className="alert alert-danger detail-error" role="alert">
        <CircleAlert size={18} aria-hidden="true" />
        {detail.error?.message ?? 'הטופס לא נמצא.'}
      </p>
    )
  }

  const pageOf = (n: number) => form.pages.find((p) => p.number === n) ?? null

  return (
    <div ref={rootRef} className="detail" role="region" aria-label={`טופס ${form.commitment_number ?? ''}`}>
      <div className="detail-main">
        {(form.status === 'received' || form.status === 'processing') && (
          <p className="detail-note" role="status">
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
            הטופס עוד בעיבוד{form.progress ? `: ${form.progress.step}` : ''}.
          </p>
        )}
        {form.status === 'failed' && (
          <div className="detail-note is-error">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{form.error ?? 'המערכת לא הצליחה לקרוא את הטופס.'}</span>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
              <RotateCcw size={15} aria-hidden="true" />
              לנסות שוב
            </button>
          </div>
        )}
        {(form.status === 'approved' || form.status === 'rejected') && form.reviewed_at && (
          <p className="detail-note">
            {form.status === 'approved' ? 'אושר' : 'נדחה'} ב-<span className="num">{formatDateTime(form.reviewed_at)}</span>
            {form.merged_into && (
              <>
                {' · '}
                <Link to={recordLink(form.merged_into)}>מוזג לטופס אחר</Link>
              </>
            )}
          </p>
        )}

        {reviewFields.length > 0 && (
          <div className="rfields">
            {reviewFields.map((f) => (
              <ReviewField
                key={f.key}
                field={f}
                page={f.box ? pageOf(f.box.page) : null}
                cache={cache}
                inputRef={(el) => {
                  if (el) inputs.current.set(f.key, el)
                  else inputs.current.delete(f.key)
                }}
                onSave={saveField}
                onNavigate={(dir) => navigate(f.key, dir)}
                onOpenImage={() => showViewer(f.key)}
              />
            ))}
          </div>
        )}

        {plainFields.length > 0 && (
          <dl className="pfields">
            {plainFields.map((f) => (
              <PlainField key={f.key} field={f} />
            ))}
          </dl>
        )}

        {pending && (
          <div className="detail-actions">
            <button
              ref={approveRef}
              type="button"
              className="btn btn-primary btn-approve"
              onClick={() => approve.mutate()}
              disabled={approve.isPending}
            >
              {approve.isPending ? <LoaderCircle size={20} className="spin" aria-hidden="true" /> : <Check size={20} aria-hidden="true" />}
              אישור והבא
              <kbd aria-hidden="true">Enter</kbd>
            </button>
            <RejectControl formId={id} onRejected={() => onDone(nextPending(id), 'הטופס נדחה')} />
            {unresolved.length > 0 && (
              <span className="detail-left muted">
                {unresolved.length === 1 ? 'נשאר שדה אחד לבדיקה' : `נשארו ${unresolved.length} שדות לבדיקה`}
              </span>
            )}
            <button type="button" className="link-btn detail-keys" onClick={() => setShowKeys(true)}>
              קיצורי מקלדת (?)
            </button>
          </div>
        )}
        {approve.error && (
          <p className="alert alert-danger" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            {approve.error.message}
          </p>
        )}
      </div>

      <aside className="detail-side">
        <button type="button" className="icon-btn detail-close" onClick={onClose} aria-label="סגירת הרשומה" title="סגירה (Esc)">
          <X size={18} />
        </button>
        <FormThumb form={form} marks={reviewFields} cache={cache} onOpen={() => showViewer(reviewFields.find((f) => f.uncertain && f.box)?.key ?? null)} />
      </aside>

      {viewer && (
        <PageViewer
          pages={form.pages}
          initialPage={viewer.page}
          focus={(() => {
            const f = viewer.key ? form.fields.find((x) => x.key === viewer.key) : undefined
            return f?.box ? { box: f.box, label: f.label } : null
          })()}
          cache={cache}
          onClose={closeViewer}
        />
      )}
      {showKeys && <ShortcutsDialog onClose={() => setShowKeys(false)} />}
    </div>
  )
}
