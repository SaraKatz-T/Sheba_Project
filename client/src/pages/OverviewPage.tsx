import { CircleAlert, ClipboardCheck, Inbox, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import { useForms } from '../api/queries'
import { BrandRings, RingsLoader } from '../components/BrandRings'
import { EmptyState } from '../components/EmptyState'
import { formatNumber } from '../lib/format'
import { useNow } from '../lib/useNow'
import { sortForms } from '../records/filters'
import { Overview } from '../records/Overview'

const longDate = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Jerusalem',
})

export function OverviewPage() {
  const navigate = useNavigate()
  const forms = useForms()
  const all = useMemo(() => forms.data?.items ?? [], [forms.data])
  const now = useNow(60_000)

  const pending = useMemo(
    () => sortForms(all.filter((f) => f.status === 'pending_review'), 'received', 'desc'),
    [all],
  )

  // Review happens in the records: only the waiting forms, the first one already open.
  const startReview = () => {
    const first = pending[0]?.id
    navigate(`/records?status=pending_review${first ? `&open=${encodeURIComponent(first)}` : ''}`)
  }

  return (
    <>
      <BrandRings className="page-rings" />
      <div className="page-head">
        <div>
          <h1>סקירה</h1>
          <p>{longDate.format(now)}</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={startReview} disabled={pending.length === 0}>
            <ClipboardCheck size={18} aria-hidden="true" />
            ממתינים לבדיקה
            {pending.length > 0 && <span className="badge">{formatNumber(pending.length)}</span>}
          </button>
        </div>
      </div>

      {forms.isPending ? (
        <div className="records-loading" role="status">
          <RingsLoader />
          טוען…
        </div>
      ) : forms.isError ? (
        <EmptyState
          icon={<CircleAlert size={26} />}
          title="לא הצלחנו לטעון את הנתונים"
          action={
            <button type="button" className="btn btn-primary" onClick={() => forms.refetch()}>
              <RefreshCw size={18} aria-hidden="true" />
              לנסות שוב
            </button>
          }
        >
          {forms.error.message}
        </EmptyState>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<Inbox size={26} />}
          title="עוד לא נקלטו טפסים"
          action={
            <Link className="btn btn-primary" to="/intake">
              לקליטת טפסים
            </Link>
          }
        >
          המדדים וציר הזמן יופיעו כאן אחרי שייקלטו הטפסים הראשונים.
        </EmptyState>
      ) : (
        <Overview
          forms={all}
          onSelectDay={(day) => navigate(`/records?from=${day}&to=${day}`)}
          onStartReview={startReview}
        />
      )}
    </>
  )
}
