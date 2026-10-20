import { CircleCheck, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { getForm } from '../api/endpoints'
import { keys, queryClient, useForms } from '../api/queries'
import { EmptyState } from '../components/EmptyState'
import { YellowChip } from '../components/StatusChip'
import { formatNumber } from '../lib/format'
import { FormReview } from '../review/FormReview'

const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' })

export function ReviewPage() {
  const [params, setParams] = useSearchParams()
  const forms = useForms()
  const formId = params.get('form')
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null)

  // The review queue: waiting forms, oldest first.
  const queue = useMemo(
    () =>
      (forms.data?.items ?? [])
        .filter((f) => f.status === 'pending_review')
        .sort((a, b) => a.received_at.localeCompare(b.received_at)),
    [forms.data],
  )
  const position = queue.findIndex((f) => f.id === formId)

  // No form chosen: open the oldest waiting one.
  useEffect(() => {
    if (!formId && queue.length) setParams({ form: queue[0].id }, { replace: true })
  }, [formId, queue, setParams])

  // Have the next form ready before it is needed.
  useEffect(() => {
    const next = queue[position + 1]
    if (next) void queryClient.prefetchQuery({ queryKey: keys.form(next.id), queryFn: () => getForm(next.id) })
  }, [queue, position])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const goTo = (id: string | null, message?: string) => {
    if (message) setToast({ text: message, n: Date.now() })
    setParams(id ? { form: id } : {})
  }

  if (forms.isPending) {
    return (
      <div className="review-loading" role="status">
        <LoaderCircle size={24} className="spin" aria-hidden="true" />
        טוען את תור הבדיקה…
      </div>
    )
  }

  const toastEl = (
    <p className="toast" role="status" aria-live="polite" key={toast?.n}>
      {toast && (
        <>
          <CircleCheck size={18} aria-hidden="true" />
          {toast.text}
        </>
      )}
    </p>
  )

  if (!formId) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>בדיקה ואישור</h1>
          </div>
        </div>
        <EmptyState
          icon={<CircleCheck size={26} />}
          title="אין טפסים ממתינים 🎉"
          action={
            <Link className="btn btn-outline" to="/">
              לרשומות
            </Link>
          }
        >
          כל הטפסים נבדקו. טפסים חדשים יופיעו כאן אוטומטית כשיסתיים העיבוד שלהם.
        </EmptyState>
        {toastEl}
      </>
    )
  }

  return (
    <div className="review-layout">
      <aside className="review-queue" aria-labelledby="queue-title">
        <h2 id="queue-title">
          תור הבדיקה <span className="badge">{formatNumber(queue.length)}</span>
        </h2>
        {queue.length === 0 ? (
          <p className="muted review-queue-empty">אין טפסים ממתינים 🎉</p>
        ) : (
          <ol className="review-queue-list">
            {queue.map((f) => (
              <li key={f.id}>
                <Link
                  to={`/review?form=${encodeURIComponent(f.id)}`}
                  className="review-queue-item"
                  aria-current={f.id === formId ? 'page' : undefined}
                >
                  <span className="rq-key ltr num">{f.commitment_number ?? '—'}</span>
                  <span className="rq-name">{f.person_name ?? ''}</span>
                  <span className="rq-meta">
                    <span className="num muted">{timeFmt.format(new Date(f.received_at))}</span>
                    {f.uncertain_count > 0 ? <YellowChip count={f.uncertain_count} /> : <span className="chip chip-ok">נקי</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </aside>

      <div className="review-main">
        <p className="review-position">
          {position >= 0
            ? `טופס ${formatNumber(position + 1)} מתוך ${formatNumber(queue.length)} בתור`
            : queue.length
              ? `הטופס הזה לא בתור הבדיקה · ${formatNumber(queue.length)} ממתינים`
              : 'הטופס הזה לא בתור הבדיקה'}
          {position < 0 && queue.length > 0 && (
            <Link to={`/review?form=${encodeURIComponent(queue[0].id)}`}>לטופס הבא בתור</Link>
          )}
        </p>
        <FormReview key={formId} id={formId} queue={queue} onGoTo={goTo} />
      </div>
      {toastEl}
    </div>
  )
}
