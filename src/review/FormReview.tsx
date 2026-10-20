import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, CircleAlert, FileImage, Keyboard, LoaderCircle, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { approveForm, getForm, retryForm, updateField } from '../api/endpoints'
import { keys, queryClient, upsertForm } from '../api/queries'
import type { FormDetail } from '../api/types'
import { StatusChip } from '../components/StatusChip'
import { formatDate, formatDateTime } from '../lib/format'
import { FieldRow, YellowField, type Direction, type SaveField } from './FieldCards'
import { useCachedImage, PageImageCache } from './imageCache'
import { PageViewer } from './PageViewer'
import { RejectControl } from './RejectControl'
import { ShortcutsDialog } from './ShortcutsDialog'

interface Props {
  id: string
  /** Waiting forms, oldest first. */
  queue: { id: string }[]
  onGoTo: (id: string | null, message?: string) => void
}

function withCounts(form: FormDetail): FormDetail {
  return {
    ...form,
    uncertain_count: form.fields.filter((f) => f.uncertain).length,
    corrected_count: form.fields.filter((f) => f.corrected).length,
  }
}

function PagePreview({ url, cache, label, onOpen }: { url: string; cache: PageImageCache; label: string; onOpen: () => void }) {
  const image = useCachedImage(cache, url)
  return (
    <button type="button" className="page-thumb" onClick={onOpen} aria-label={`${label}: פתיחה בהגדלה`}>
      {image.status === 'ready' ? <img src={image.src} alt="" /> : <span className="crop-loading" aria-hidden="true" />}
    </button>
  )
}

export function FormReview({ id, queue, onGoTo }: Props) {
  const detail = useQuery({ queryKey: keys.form(id), queryFn: () => getForm(id) })
  const form = detail.data
  const cache = useMemo(() => new PageImageCache(), [])
  useEffect(() => () => cache.dispose(), [cache])

  // The fields that needed review when the form opened stay in the review list after
  // they are resolved, so the reviewer keeps the context of what was checked.
  const [reviewKeys, setReviewKeys] = useState<string[] | null>(null)
  useEffect(() => {
    if (form && reviewKeys === null) setReviewKeys(form.fields.filter((f) => f.uncertain).map((f) => f.key))
  }, [form, reviewKeys])

  const inputs = useRef(new Map<string, HTMLInputElement>())
  const approveRef = useRef<HTMLButtonElement>(null)
  const pendingSaves = useRef(new Set<Promise<unknown>>())
  const [viewer, setViewer] = useState<{ page: number; key: string | null } | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const [pagesOpen, setPagesOpen] = useState(false)

  const pending = form?.status === 'pending_review'
  const idx = queue.findIndex((f) => f.id === id)
  const nextId = idx >= 0 ? (queue[idx + 1] ?? queue[idx - 1])?.id ?? null : (queue[0]?.id ?? null)

  const reviewFields = useMemo(
    () => (form && reviewKeys ? reviewKeys.map((k) => form.fields.find((f) => f.key === k)!).filter(Boolean) : []),
    [form, reviewKeys],
  )
  const otherFields = useMemo(
    () => (form && reviewKeys ? form.fields.filter((f) => !reviewKeys.includes(f.key)) : []),
    [form, reviewKeys],
  )
  const unresolved = reviewFields.filter((f) => f.uncertain)
  const hasBoxes = !!form?.fields.some((f) => f.box)
  const pageOf = (n: number) => form?.pages.find((p) => p.number === n) ?? null

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
      upsertForm(summary)
      onGoTo(nextId, 'הטופס אושר')
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
    const i = order.indexOf(fromKey)
    const target = order[dir === 'next' ? i + 1 : i - 1]
    if (target) focusField(target)
    else if (dir === 'next') approveRef.current?.focus()
  }

  // Start where the work is: the first open yellow field, or the approve button.
  const focusedOnce = useRef(false)
  useEffect(() => {
    if (focusedOnce.current || !form || reviewKeys === null || !pending) return
    focusedOnce.current = true
    const first = reviewKeys.find((k) => form.fields.find((f) => f.key === k)?.uncertain)
    if (first) focusField(first)
    else approveRef.current?.focus()
  })

  // Wherever the viewer is opened from, closing it puts the keyboard back there.
  const returnFocus = useRef<HTMLElement | null>(null)
  const showViewer = (page: number, key: string | null) => {
    // Opened for a field (even by clicking its crop): come back to that field's input.
    const fieldInput = key ? inputs.current.get(key) : undefined
    returnFocus.current = fieldInput ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setViewer({ page, key })
  }
  const closeViewer = () => {
    setViewer(null)
    const back = returnFocus.current
    requestAnimationFrame(() => back?.focus())
  }

  const openImage = (key: string | null) => {
    const field = key ? form?.fields.find((f) => f.key === key) : undefined
    if (hasBoxes) showViewer(field?.box?.page ?? form?.fields.find((f) => f.box)?.box?.page ?? 1, field?.box ? key : null)
    else setPagesOpen((o) => !o)
  }

  const toggleImage = () => {
    if (viewer) return closeViewer()
    const active = document.activeElement
    const key = [...inputs.current].find(([, el]) => el === active)?.[0] ?? reviewFields.find((f) => f.box)?.key ?? null
    openImage(key)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null
      const typing = !!target?.closest('input, textarea, select, [contenteditable="true"]')
      const plain = !e.altKey && !e.ctrlKey && !e.metaKey
      if (e.code === 'KeyI' && (e.altKey || (plain && !typing))) {
        e.preventDefault()
        toggleImage()
        return
      }
      if (viewer || showKeys) return
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && pending) {
        e.preventDefault()
        approve.mutate()
        return
      }
      if (typing) return
      if (e.key === '?') {
        e.preventDefault()
        setShowKeys(true)
      } else if (e.key === 'Enter' && plain && pending && !target?.closest('button, a, summary')) {
        e.preventDefault()
        if (unresolved[0]) focusField(unresolved[0].key)
        else approve.mutate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (detail.isPending) {
    return (
      <div className="review-loading" role="status">
        <LoaderCircle size={24} className="spin" aria-hidden="true" />
        טוען את הטופס…
      </div>
    )
  }
  if (detail.isError || !form) {
    return (
      <div className="review-card">
        <p className="alert alert-danger" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          {detail.error?.message ?? 'הטופס לא נמצא.'}
        </p>
      </div>
    )
  }

  const readOnly = !pending

  return (
    <section className="review-card" aria-labelledby="review-title">
      <header className="review-head">
        <div className="review-id">
          <span className="eyebrow">מספר התחייבות</span>
          <h1 id="review-title" className="ltr num">
            {form.commitment_number ?? <span className="muted">טרם חולץ</span>}
          </h1>
          <p className="review-person">
            {form.person_name && <strong>{form.person_name}</strong>}
            {form.id_number && (
              <span>
                ת"ז <span className="ltr num">{form.id_number}</span>
              </span>
            )}
            {form.form_date && <span className="num">טופס מ-{formatDate(form.form_date)}</span>}
          </p>
          <p className="review-meta muted">
            {form.file_name} · התקבל <span className="num">{formatDateTime(form.received_at)}</span>
            {form.page_count > 1 && ` · ${form.page_count} עמודים`}
          </p>
        </div>
        <div className="review-actions">
          {!pending && <StatusChip status={form.status} />}
          {pending && <RejectControl formId={id} onRejected={() => onGoTo(nextId, 'הטופס נדחה')} />}
          {pending && (
            <button
              ref={approveRef}
              type="button"
              className="btn btn-primary btn-approve"
              onClick={() => approve.mutate()}
              disabled={approve.isPending}
            >
              {approve.isPending ? (
                <LoaderCircle size={20} className="spin" aria-hidden="true" />
              ) : (
                <Check size={20} aria-hidden="true" />
              )}
              אישור הטופס
              <kbd aria-hidden="true">Enter</kbd>
            </button>
          )}
        </div>
      </header>

      {approve.error && (
        <p className="alert alert-danger" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          {approve.error.message}
        </p>
      )}

      {pending && (
        <p className={`review-summary${unresolved.length ? ' is-flag' : ' is-ok'}`} role="status">
          {unresolved.length === 0
            ? reviewFields.length
              ? 'כל השדות הצהובים טופלו. Enter מאשר ועובר לטופס הבא.'
              : 'כל השדות ודאיים. Enter מאשר ועובר לטופס הבא.'
            : `${unresolved.length === 1 ? 'שדה אחד' : `${unresolved.length} שדות`} לבדיקה · Enter אחרי כל שדה · `}
          {unresolved.length > 0 && (
            <button type="button" className="link-btn" onClick={() => setShowKeys(true)}>
              <Keyboard size={15} aria-hidden="true" />
              כל הקיצורים (?)
            </button>
          )}
        </p>
      )}

      {(form.status === 'received' || form.status === 'processing') && (
        <p className="review-note" role="status">
          <LoaderCircle size={18} className="spin" aria-hidden="true" />
          הטופס עוד בעיבוד{form.progress ? `: ${form.progress.step}` : ''}. הוא יופיע בתור הבדיקה כשיהיה מוכן.
        </p>
      )}
      {form.status === 'failed' && (
        <div className="review-note is-error">
          <CircleAlert size={18} aria-hidden="true" />
          <span>{form.error ?? 'המערכת לא הצליחה לקרוא את הטופס.'}</span>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => retry.mutate()} disabled={retry.isPending}>
            <RotateCcw size={15} aria-hidden="true" />
            לנסות שוב
          </button>
        </div>
      )}
      {(form.status === 'approved' || form.status === 'rejected') && form.reviewed_at && (
        <p className="review-note">
          {form.status === 'approved' ? 'אושר' : 'נדחה'} ב-<span className="num">{formatDateTime(form.reviewed_at)}</span>
          {form.corrected_count > 0 && ` · ${form.corrected_count === 1 ? 'שדה אחד תוקן' : `${form.corrected_count} שדות תוקנו`}`}
          {form.merged_into && (
            <>
              {' · '}
              <Link to={`/review?form=${encodeURIComponent(form.merged_into)}`}>מוזג לטופס אחר</Link>
            </>
          )}
        </p>
      )}

      {/* Without coordinates there is nothing to crop: the whole form, folded away until asked for. */}
      {!hasBoxes && form.pages.length > 0 && reviewFields.length > 0 && (
        <div className={`pages-panel${pagesOpen ? ' is-open' : ''}`}>
          <button type="button" className="pages-toggle" aria-expanded={pagesOpen} onClick={() => setPagesOpen((o) => !o)}>
            <FileImage size={18} aria-hidden="true" />
            {pagesOpen ? 'הסתרת הטופס' : 'הצגת הטופס'} <kbd aria-hidden="true">I</kbd>
            <ChevronDown size={18} className="pages-chevron" aria-hidden="true" />
          </button>
          {pagesOpen && (
            <div className="pages-grid">
              {form.pages.map((p) => (
                <PagePreview
                  key={p.number}
                  url={p.image_url}
                  cache={cache}
                  label={`עמוד ${p.number}`}
                  onOpen={() => showViewer(p.number, null)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {reviewFields.length > 0 && (
        <section className="review-section" aria-label="שדות לבדיקה">
          <h2>{readOnly ? 'שדות שסומנו לבדיקה' : 'שדות לבדיקה'}</h2>
          <div className="yfields">
            {reviewFields.map((f) => (
              <YellowField
                key={f.key}
                field={f}
                page={f.box ? pageOf(f.box.page) : null}
                cache={cache}
                readOnly={readOnly}
                inputRef={(el) => {
                  if (el) inputs.current.set(f.key, el)
                  else inputs.current.delete(f.key)
                }}
                onSave={saveField}
                onNavigate={(dir) => navigate(f.key, dir)}
                onOpenImage={() => openImage(f.key)}
              />
            ))}
          </div>
        </section>
      )}

      {otherFields.length > 0 && (
        <section className="review-section" aria-label="שדות הטופס">
          <h2>{reviewFields.length ? 'שאר השדות' : 'השדות בטופס'}</h2>
          <dl className="fields-grid">
            {otherFields.map((f) => (
              <FieldRow key={f.key} field={f} readOnly={readOnly} onSave={saveField} />
            ))}
          </dl>
        </section>
      )}

      {form.pages.length > 0 && (hasBoxes || reviewFields.length === 0) && (
        <p className="review-foot">
          <button type="button" className="link-btn" onClick={() => showViewer(1, null)}>
            <FileImage size={15} aria-hidden="true" />
            הצגת הטופס המלא
          </button>
        </p>
      )}

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
    </section>
  )
}
