// Temporary screens for stage 0; each is replaced by its real screen in a later stage.
import { ClipboardCheck, LoaderCircle, Table2 } from 'lucide-react'
import type { FormStatus } from '../api/types'
import { useForms } from '../api/queries'
import { EmptyState } from '../components/EmptyState'
import { STATUS_LABELS, formatNumber } from '../lib/format'

export function RecordsPage() {
  const forms = useForms()
  const items = forms.data?.items ?? []
  const counts = items.reduce<Partial<Record<FormStatus, number>>>((acc, f) => {
    acc[f.status] = (acc[f.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <>
      <div className="page-head">
        <div>
          <h1>רשומות</h1>
          <p aria-live="polite">
            {forms.isPending ? (
              <LoaderCircle size={16} className="spin" aria-label="טוען" />
            ) : forms.isError ? (
              forms.error.message
            ) : (
              <>
                {formatNumber(items.length)} טפסים התקבלו מהשרת ·{' '}
                {(Object.keys(counts) as FormStatus[])
                  .map((s) => `${STATUS_LABELS[s]} ${formatNumber(counts[s] ?? 0)}`)
                  .join(' · ')}
              </>
            )}
          </p>
        </div>
      </div>
      <EmptyState icon={<Table2 size={26} />} title="טבלת הרשומות תיבנה בשלב 2">
        החיבור לשרת עובד. כאן תופיע הטבלה עם חיפוש, סינון ותצוגת קנבן.
      </EmptyState>
    </>
  )
}

export function ReviewPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>בדיקה ואישור</h1>
        </div>
      </div>
      <EmptyState icon={<ClipboardCheck size={26} />} title="מסך הבדיקה ייבנה בשלב 3">
        כאן עוברים על שדות צהובים ומאשרים טפסים.
      </EmptyState>
    </>
  )
}
